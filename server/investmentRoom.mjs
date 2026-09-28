import fs from "node:fs";
import path from "node:path";

const STATE_FILE = process.env.INVESTMENT_ROOM_STATE_FILE || "/opt/tradebotzi/data/investment-room.json";
const PROCHART_URL = "https://prochart-engine-gateway.hankenayati.workers.dev";
const STRATEGY_REFRESH_MS = 10 * 60 * 1000;
const COUNCIL_REFRESH_MS = 5 * 60 * 1000;
const MARK_MS = 15000;
const FEE_RATE = 0.001;
const DEFAULT_CRYPTO = ["BTC","ETH","SOL","BNB","XRP","DOGE","ADA","AVAX","LINK","SUI","LTC","BCH","DOT","NEAR","APT","ATOM"];
const EQUITY_SYMBOLS = ["NVDA","AAPL","MSFT","AMZN","META","TSLA","GOOGL","AMD","COIN","MSTR"];
const ETF_SYMBOLS = ["SPY","QQQ","IWM","GLD","SLV","TLT","USO","XLE","XLK","XLF"];
const STATIC_SYMBOLS = [...DEFAULT_CRYPTO,...EQUITY_SYMBOLS,...ETF_SYMBOLS];
const STABLE_CRYPTO = new Set(["USDC","USDP","FDUSD","TUSD","DAI","USDE","PYUSD","EUR","EURC"]);
const ASSET_META = Object.fromEntries([
  ...DEFAULT_CRYPTO.map(symbol=>[symbol,{symbol,label:symbol,market:"crypto",assetClass:"crypto"}]),
  ...EQUITY_SYMBOLS.map(symbol=>[symbol,{symbol,label:symbol,market:"equity",assetClass:"equity"}]),
  ...ETF_SYMBOLS.map(symbol=>[symbol,{symbol,label:symbol,market:"etf",assetClass:"etf"}]),
]);
const LEVERAGES = [1,2,3,5,10];
const PROCHART_STRATEGIES = [
  ["ema_cross","EMA Crossover"],
  ["rsi_reversion","RSI Mean Reversion"],
  ["macd_cross","MACD Crossover"],
  ["bb_reversion","Bollinger Reversion"],
  ["supertrend","SuperTrend"],
];

function now(){ return Date.now(); }
function id(prefix){ return prefix+"-"+now()+"-"+Math.random().toString(36).slice(2,8); }
function finite(v,f=0){ const n=Number(v); return Number.isFinite(n)?n:f; }
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function decodeXml(s=""){
  return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1")
    .replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'")
    .replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/<[^>]+>/g,"").trim();
}
function safeJson(file,fallback=null){ try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch{return fallback;} }
function freshState(){
  return {
    enabled:false,
    capitalPerBook:1000,
    leverage:2,
    selectedStrategy:"council_auto",
    councilUniverse:{mode:"discover",markets:["crypto","equity","etf"],symbols:[],maxCandidates:12},
    latestUniverse:{mode:"discover",markets:["crypto","equity","etf"],symbols:[],candidates:[],reason:"Not scanned yet",updatedAt:null},
    books:{},
    orders:[],
    fills:[],
    trades:[],
    transcript:[],
    evidence:{rooms:[],updatedAt:null},
    strategyResults:{},
    latestCouncil:null,
    lastStrategyRefreshAt:null,
    lastCouncilAt:null,
    updatedAt:now()
  };
}
function newBook(key,label,capital){
  return {
    key,label,initialCapital:capital,cash:capital,equity:capital,peakEquity:capital,
    realizedPnl:0,unrealizedPnl:0,totalFees:0,drawdown:0,
    positions:[],tradeCount:0,wins:0,losses:0,lastDecision:null,updatedAt:now()
  };
}

export function createInvestmentRoom({serverMarketSnapshot, botIntegrations, callProvider}){
  fs.mkdirSync(path.dirname(STATE_FILE),{recursive:true});
  let state=Object.assign(freshState(),safeJson(STATE_FILE,{})||{});
  state.councilUniverse=Object.assign({mode:"discover",markets:["crypto","equity","etf"],symbols:[],maxCandidates:12},state.councilUniverse||{});
  state.latestUniverse=Object.assign({mode:state.councilUniverse.mode,markets:state.councilUniverse.markets,symbols:[],candidates:[],reason:"Not scanned yet",updatedAt:null},state.latestUniverse||{});
  let cycleBusy=false;
  const providers=[
    {provider:"nvidia",role:"Portfolio Manager"},
    {provider:"nvidia-ultra",role:"Strategic Allocator"},
    {provider:"nvidia-critic",role:"Independent Reasoning Critic"},
    {provider:"nvidia-gemma",role:"Technical Pattern Analyst"},
    {provider:"omniroute",role:"Independent Market Analyst"},
    {provider:"hermes",role:"Risk Critic"},
    {provider:"freellm",role:"Macro & Event Analyst"},
    {provider:"ollama",role:"Technical Explainer"},
  ];

  function ensureBooks(capital=state.capitalPerBook||1000){
    const defs=[
      ["user_selected","My Selected Strategy"],
      ["council_auto","Council Auto"],
      ...PROCHART_STRATEGIES.map(([k,l])=>["prochart_"+k,"ProChart · "+l]),
      ["cabbage","CABBAGE RSI + EMA"],
      ["stonkfly","Stonkfly Connectome"],
      ["momentum","24h Momentum"],
    ];
    for(const [key,label] of defs){
      if(!state.books[key]) state.books[key]=newBook(key,label,capital);
    }
  }
  ensureBooks();

  function save(){
    state.updatedAt=now();
    const tmp=STATE_FILE+".tmp";
    fs.writeFileSync(tmp,JSON.stringify(state,null,2));
    fs.renameSync(tmp,STATE_FILE);
  }
  function marketMap(snapshot){
    const map=new Map();
    for(const row of snapshot?.observations||[]){
      const p=finite(row?.price,NaN);
      if(!row?.canonicalSymbol||!Number.isFinite(p)||p<=0) continue;
      const prev=map.get(row.canonicalSymbol);
      if(!prev||row.provider==="binance"||(!prev.change24h&&row.change24h!=null)) map.set(row.canonicalSymbol,row);
    }
    return map;
  }

  function marketKind(symbol,row=null){
    if(ASSET_META[symbol]) return ASSET_META[symbol].market;
    if(row?.assetClass==="crypto") return "crypto";
    return row?.assetClass||"unknown";
  }

  async function fetchYahooObservation(symbol){
    try{
      const url="https://query1.finance.yahoo.com/v8/finance/chart/"+encodeURIComponent(symbol)+"?range=5d&interval=1d";
      const res=await fetch(url,{headers:{"user-agent":"Mozilla/5.0"}});
      if(!res.ok) throw new Error("yahoo_http_"+res.status);
      const data=await res.json();
      const result=data?.chart?.result?.[0];
      const meta=result?.meta||{};
      const price=finite(meta.regularMarketPrice,NaN);
      if(!Number.isFinite(price)||price<=0) return null;
      const previous=finite(meta.chartPreviousClose||meta.previousClose,price);
      const change24h=previous>0?(price-previous)/previous*100:0;
      const kind=ASSET_META[symbol]?.market||"equity";
      return {
        provider:"yahoo",canonicalSymbol:symbol,providerSymbol:symbol,
        assetClass:kind,marketType:"SPOT",timestamp:now(),receivedAt:now(),
        price,bid:null,ask:null,spread:null,change24h,
        volume24h:finite(meta.regularMarketVolume),high24h:finite(meta.regularMarketDayHigh,null),
        low24h:finite(meta.regularMarketDayLow,null),freshness:"LIVE",dataQuality:"good"
      };
    }catch{return null;}
  }

  async function augmentSnapshot(snapshot,symbols=[]){
    const existing=marketMap(snapshot);
    const yahooSymbols=[...new Set(symbols.map(s=>String(s).toUpperCase().trim()))]
      .filter(s=>s&&!existing.has(s));
    if(!yahooSymbols.length) return snapshot;
    const rows=(await Promise.all(yahooSymbols.map(fetchYahooObservation))).filter(Boolean);
    return {...snapshot,observations:[...(snapshot?.observations||[]),...rows]};
  }

  function cryptoOptions(snapshot,limit=30){
    const seen=new Set();
    return (snapshot?.observations||[])
      .filter(row=>row.provider==="binance"&&row.assetClass==="crypto"&&row.canonicalSymbol&&!STABLE_CRYPTO.has(row.canonicalSymbol))
      .filter(row=>{ if(seen.has(row.canonicalSymbol)) return false; seen.add(row.canonicalSymbol); return true; })
      .sort((a,b)=>finite(b.volume24h)-finite(a.volume24h))
      .slice(0,limit)
      .map(row=>({symbol:row.canonicalSymbol,label:row.canonicalSymbol,market:"crypto",assetClass:"crypto"}));
  }

  function candidateRow(symbol,markets){
    const row=markets.get(symbol);
    if(!row) return null;
    const change=finite(row.change24h);
    const volume=Math.max(0,finite(row.volume24h));
    const score=Math.abs(change)*1.5+Math.min(6,Math.log10(volume+1)*0.45);
    return {
      symbol,market:marketKind(symbol,row),price:finite(row.price),change24h:change,
      volume24h:volume,provider:row.provider,discoveryScore:Number(score.toFixed(3))
    };
  }

  async function resolveUniverse(baseSnapshot){
    const cfg=state.councilUniverse||{};
    const mode=["discover","manual","news"].includes(cfg.mode)?cfg.mode:"discover";
    const selectedMarkets=(Array.isArray(cfg.markets)?cfg.markets:["crypto","equity","etf"]).filter(m=>["crypto","equity","etf"].includes(m));
    const maxCandidates=clamp(Math.round(finite(cfg.maxCandidates,12)),3,25);
    const crypto=cryptoOptions(baseSnapshot,35);
    const staticForMarkets=[
      ...(selectedMarkets.includes("equity")?EQUITY_SYMBOLS:[]),
      ...(selectedMarkets.includes("etf")?ETF_SYMBOLS:[])
    ];
    const manualRequested=mode==="manual"&&Array.isArray(cfg.symbols)?cfg.symbols:[];
    let snapshot=await augmentSnapshot(baseSnapshot,[...staticForMarkets,...manualRequested]);
    const markets=marketMap(snapshot);
    let symbols=[];
    let reason="";

    if(mode==="manual"){
      symbols=[...new Set((cfg.symbols||[]).map(s=>String(s).toUpperCase().trim()))]
        .filter(s=>markets.has(s)&&selectedMarkets.includes(marketKind(s,markets.get(s))))
        .slice(0,maxCandidates);
      reason=symbols.length?"User-selected assets.":"No selected asset currently has live market data.";
    }else if(mode==="news"){
      const pool=[
        ...(selectedMarkets.includes("crypto")?crypto.map(x=>x.symbol):[]),
        ...staticForMarkets
      ].filter(s=>markets.has(s));
      const newsPick=await discoverFromNews(pool,snapshot);
      symbols=newsPick.symbols.slice(0,maxCandidates);
      reason=newsPick.reason;
    }else{
      const pool=[
        ...(selectedMarkets.includes("crypto")?crypto.map(x=>x.symbol):[]),
        ...staticForMarkets
      ];
      symbols=pool.map(s=>candidateRow(s,markets)).filter(Boolean)
        .sort((a,b)=>b.discoveryScore-a.discoveryScore)
        .slice(0,maxCandidates).map(x=>x.symbol);
      reason="Ranked supported assets by current absolute move and liquidity before council analysis.";
    }

    const candidates=symbols.map(s=>candidateRow(s,markets)).filter(Boolean);
    state.latestUniverse={mode,markets:selectedMarkets,symbols,candidates,reason,updatedAt:now()};
    save();
    return {snapshot,symbols,candidates,reason,mode,markets:selectedMarkets};
  }
  function markBook(book){
    book.unrealizedPnl=book.positions.reduce((s,p)=>s+finite(p.unrealizedPnl),0);
    book.equity=Math.max(0,finite(book.cash)+book.positions.reduce((s,p)=>s+finite(p.margin)+finite(p.unrealizedPnl),0));
    book.peakEquity=Math.max(finite(book.peakEquity),book.equity);
    book.drawdown=book.peakEquity>0?(book.equity-book.peakEquity)/book.peakEquity:0;
    book.updatedAt=now();
  }
  function transcript(kind,speaker,message,meta={}){
    state.transcript.push({id:id("msg"),timestamp:now(),kind,speaker,message,meta});
    state.transcript=state.transcript.slice(-400);
  }

  function closePosition(book,position,price,reason){
    const exitFriction=0.00045;
    const exitPrice=position.direction==="LONG"?price*(1-exitFriction):price*(1+exitFriction);
    const gross=position.direction==="LONG"
      ? position.quantity*(exitPrice-position.entryPrice)
      : position.quantity*(position.entryPrice-exitPrice);
    const exitFee=position.quantity*exitPrice*FEE_RATE;
    const net=gross-finite(position.openFee)-exitFee;
    book.cash=Math.max(0,finite(book.cash)+finite(position.margin)+gross-exitFee);
    book.realizedPnl+=net;
    book.totalFees+=exitFee;
    book.tradeCount+=1;
    if(net>0) book.wins+=1; else if(net<0) book.losses+=1;
    book.positions=book.positions.filter(p=>p.id!==position.id);
    const trade={...position,status:"CLOSED",exitPrice,exitFee,grossPnl:gross,netPnl:net,closedAt:now(),closeReason:reason,bookId:book.key,bookLabel:book.label};
    state.trades.push(trade);
    const order={id:id("ord"),timestamp:now(),bookId:book.key,bookLabel:book.label,symbol:position.symbol,side:position.direction==="LONG"?"SELL":"BUY",positionSide:position.direction,type:"MARKET",action:"CLOSE",leverage:position.leverage,quantity:position.quantity,notional:position.quantity*exitPrice,status:"FILLED",reason};
    state.orders.push(order);
    state.fills.push({id:id("fill"),orderId:order.id,timestamp:now(),bookId:book.key,bookLabel:book.label,symbol:position.symbol,side:order.side,positionSide:position.direction,action:"CLOSE",price:exitPrice,quantity:position.quantity,fees:exitFee,reason});
    transcript("execution","Paper Broker",book.label+" closed "+position.direction+" "+position.symbol+" at "+exitPrice.toFixed(4)+" · "+reason+" · P&L "+net.toFixed(2),{bookId:book.key,symbol:position.symbol});
    markBook(book);
    return trade;
  }

  function openPosition(book,rec,market){
    if(!rec||!["LONG","SHORT"].includes(rec.side)||!market) return null;
    if(book.positions.some(p=>p.symbol===rec.symbol)) return null;
    const leverage=clamp(Math.round(finite(rec.leverage,state.leverage||2)),1,10);
    const margin=Math.max(1,Math.min(book.equity*0.10,book.cash*0.45));
    if(margin<=0||margin>=book.cash) return null;
    const px=finite(market.price);
    const friction=0.00045;
    const entry=rec.side==="LONG"?px*(1+friction):px*(1-friction);
    const notional=margin*leverage;
    const quantity=notional/entry;
    const fee=notional*FEE_RATE;
    if(margin+fee>book.cash) return null;
    const stopPct=finite(rec.stopPct,2.5);
    const takePct=finite(rec.takePct,5);
    const position={
      id:id("pos"),bookId:book.key,bookLabel:book.label,symbol:rec.symbol,direction:rec.side,
      leverage,margin,notional,quantity,entryPrice:entry,currentPrice:px,unrealizedPnl:0,
      stopLossPrice:rec.side==="LONG"?entry*(1-stopPct/100):entry*(1+stopPct/100),
      takeProfitPrice:rec.side==="LONG"?entry*(1+takePct/100):entry*(1-takePct/100),
      liquidationPriceEstimate:rec.side==="LONG"?Math.max(0,entry*(1-0.9/leverage)):entry*(1+0.9/leverage),
      openFee:fee,source:rec.source||book.key,thesis:rec.reason||"",strategy:rec.strategy||book.key,
      openedAt:now(),lastMarkedAt:now(),status:"OPEN"
    };
    book.cash-=margin+fee; book.totalFees+=fee; book.positions.push(position);
    book.lastDecision={timestamp:now(),...rec};
    const order={id:id("ord"),timestamp:now(),bookId:book.key,bookLabel:book.label,symbol:rec.symbol,side:rec.side==="LONG"?"BUY":"SELL",positionSide:rec.side,type:"MARKET",action:"OPEN",leverage,margin,notional,quantity,status:"FILLED",strategy:position.strategy,reason:position.thesis};
    state.orders.push(order);
    state.fills.push({id:id("fill"),orderId:order.id,timestamp:now(),bookId:book.key,bookLabel:book.label,symbol:rec.symbol,side:order.side,positionSide:rec.side,action:"OPEN",price:entry,quantity,fees:fee,strategy:position.strategy,reason:position.thesis});
    transcript("execution","Paper Broker",book.label+" opened "+rec.side+" "+rec.symbol+" "+leverage+"× · margin $"+margin.toFixed(2)+" · "+position.thesis,{bookId:book.key,symbol:rec.symbol});
    markBook(book);
    return position;
  }

  function reconcileBookSignal(book,rec,markets){
    if(!rec||!rec.symbol) return;
    const market=markets.get(rec.symbol);
    if(!market) return;
    const current=book.positions.find(p=>p.symbol===rec.symbol);
    if(rec.side==="EXIT"){
      if(current) closePosition(book,current,finite(market.price),"strategy_exit");
      book.lastDecision={timestamp:now(),...rec};
      return;
    }
    if(rec.side==="HOLD"){
      book.lastDecision={timestamp:now(),...rec};
      return;
    }
    if(current&&current.direction!==rec.side){
      closePosition(book,current,finite(market.price),"strategy_reversal");
    }
    if(!book.positions.some(p=>p.symbol===rec.symbol)) openPosition(book,rec,market);
  }

  function markAndProtect(snapshot){
    const markets=marketMap(snapshot);
    for(const book of Object.values(state.books)){
      for(const p of [...book.positions]){
        const m=markets.get(p.symbol); if(!m) continue;
        const price=finite(m.price);
        p.currentPrice=price;
        p.unrealizedPnl=p.direction==="LONG"?p.quantity*(price-p.entryPrice):p.quantity*(p.entryPrice-price);
        p.lastMarkedAt=now();
        let reason=null;
        if(p.direction==="LONG"){
          if(price<=p.liquidationPriceEstimate) reason="estimated_liquidation";
          else if(price<=p.stopLossPrice) reason="stop_loss";
          else if(price>=p.takeProfitPrice) reason="take_profit";
        }else{
          if(price>=p.liquidationPriceEstimate) reason="estimated_liquidation";
          else if(price>=p.stopLossPrice) reason="stop_loss";
          else if(price<=p.takeProfitPrice) reason="take_profit";
        }
        if(reason) closePosition(book,p,price,reason);
      }
      markBook(book);
    }
    save();
  }

  async function prochartBacktest(symbol,strategy){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),45000);
    try{
      const response=await fetch(PROCHART_URL+"/api/backtest",{
        method:"POST",
        headers:{"content-type":"application/json"},
        signal:controller.signal,
        body:JSON.stringify({
          symbol:"BINANCE:"+symbol+"USDT",
          timeframe:"60",
          strategy,
          range:300,
          settings:{initialCapital:1000,positionSize:10,commission:0.1}
        })
      });
      if(!response.ok) throw new Error("prochart_http_"+response.status);
      return await response.json();
    }finally{ clearTimeout(timer); }
  }

  async function refreshStrategies(symbols=state.latestUniverse?.symbols||DEFAULT_CRYPTO.slice(0,3)){
    const results={};
    const tasks=[];
    const targets=[...new Set(symbols)]
      .filter(symbol=>!EQUITY_SYMBOLS.includes(symbol)&&!ETF_SYMBOLS.includes(symbol))
      .slice(0,8);
    for(const symbol of targets){
      for(const [strategy,label] of PROCHART_STRATEGIES){
        tasks.push((async()=>{
          try{
            const r=await prochartBacktest(symbol,strategy);
            results[symbol+":"+strategy]={ok:true,label,...r};
          }catch(error){
            results[symbol+":"+strategy]={ok:false,label,symbol,strategy,error:String(error)};
          }
        })());
      }
    }
    await Promise.all(tasks);
    state.strategyResults=results;
    state.lastStrategyRefreshAt=now();
    transcript("evidence","ProChart","Refreshed "+Object.values(results).filter(x=>x.ok).length+" live TradingView backtests across "+(targets.join(", ")||"no crypto assets")+" in the current council universe.",{source:"prochart",symbols:targets});
    save();
    return results;
  }

  async function fetchPolymarket(){
    try{
      const res=await fetch("https://gamma-api.polymarket.com/markets?closed=false&limit=60&order=volume24hr&ascending=false",{headers:{accept:"application/json"}});
      if(!res.ok) throw new Error("HTTP "+res.status);
      const data=await res.json();
      const rows=(Array.isArray(data)?data:(data?.data||[])).filter(m=>{
        const q=String(m.question||"").toLowerCase();
        return /bitcoin|btc|ethereum|eth|crypto|fed|rate|inflation|recession|sec|gold|oil|stock|s&p|nasdaq|nvidia|tesla|apple/.test(q);
      }).slice(0,12).map(m=>{
        let outcomes=[],prices=[];
        try{ outcomes=JSON.parse(m.outcomes||"[]"); prices=JSON.parse(m.outcomePrices||"[]"); }catch{}
        return {
          id:m.id,question:m.question,slug:m.slug,volume24hr:finite(m.volume24hr),
          endDate:m.endDate,outcomes:outcomes.map((o,i)=>({label:o,probability:finite(prices[i])}))
        };
      });
      return {source:"Polymarket",kind:"prediction",items:rows};
    }catch(error){ return {source:"Polymarket",kind:"prediction",error:String(error),items:[]}; }
  }

  async function fetchGoogleNewsRoom(source,query,kind="news"){
    try{
      const url="https://news.google.com/rss/search?q="+encodeURIComponent(query)+"&hl=en-US&gl=US&ceid=US:en";
      const res=await fetch(url);
      if(!res.ok) throw new Error("HTTP "+res.status);
      const xml=await res.text();
      const items=[...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0,10).map(match=>{
        const block=match[1];
        const pick=(tag)=>decodeXml((block.match(new RegExp("<"+tag+"[^>]*>([\\s\\S]*?)<\\/"+tag+">"))||[])[1]||"");
        return {title:pick("title"),link:pick("link"),publishedAt:pick("pubDate"),source:pick("source")};
      });
      return {source,kind,items};
    }catch(error){ return {source,kind,error:String(error),items:[]}; }
  }

  async function fetchNews(){
    return fetchGoogleNewsRoom("Market News","stocks crypto bitcoin technology gold oil markets today","news");
  }
  async function fetchMacro(){
    return fetchGoogleNewsRoom("Macro","Federal Reserve inflation CPI rates recession dollar yields oil markets today","macro");
  }
  async function fetchResearch(){
    return fetchGoogleNewsRoom("Research","market outlook stocks crypto bitcoin gold oil technology investment research","research");
  }

  async function fetchDefiLlama(){
    try{
      const res=await fetch("https://api.llama.fi/overview/fees?dataType=dailyFees");
      if(!res.ok) throw new Error("HTTP "+res.status);
      const d=await res.json();
      return {source:"DefiLlama",kind:"onchain",items:[{
        title:"Protocol fee activity",
        total24h:finite(d.total24h),
        total7d:finite(d.total7d),
        total30d:finite(d.total30d),
        change1d:finite(d.change_1d),
        change7d:finite(d.change_7d)
      }]};
    }catch(error){ return {source:"DefiLlama",kind:"onchain",error:String(error),items:[]}; }
  }

  async function gatherEvidence(){
    const [poly,news,macro,research,llama]=await Promise.all([
      fetchPolymarket(),fetchNews(),fetchMacro(),fetchResearch(),fetchDefiLlama()
    ]);
    const cabbage=botIntegrations?.get?.("cabbage")||null;
    const stonkfly=botIntegrations?.get?.("stonkfly")||null;
    const rooms=[
      poly,news,macro,research,llama,
      {source:"CABBAGE",kind:"machine",items:cabbage?[{status:cabbage.runtimeStatus,latest:cabbage.latest,portfolio:cabbage.portfolio}]:[]},
      {source:"Stonkfly",kind:"machine",items:stonkfly?[{status:stonkfly.runtimeStatus,latest:stonkfly.latest||null,reason:stonkfly.reason}]:[]}
    ];
    state.evidence={rooms,updatedAt:now()};
    save();
    return state.evidence;
  }

  function parseJsonObject(text){
    const raw=String(text||"").trim();
    try{return JSON.parse(raw);}catch{}
    const start=raw.indexOf("{"),end=raw.lastIndexOf("}");
    if(start>=0&&end>start){ try{return JSON.parse(raw.slice(start,end+1));}catch{} }
    return null;
  }

  async function discoverFromNews(pool,snapshot){
    if(!state.evidence?.updatedAt||now()-state.evidence.updatedAt>COUNCIL_REFRESH_MS) await gatherEvidence();
    const allowed=[...new Set(pool)].filter(Boolean).slice(0,60);
    if(!allowed.length) return {symbols:[],reason:"No supported assets are available in the selected markets."};
    const evidenceItems=(state.evidence?.rooms||[]).flatMap(room=>(room.items||[]).slice(0,8).map(item=>({
      room:room.source,
      text:item.title||item.question||item.reason||item.status||""
    }))).filter(x=>x.text).slice(0,40);
    try{
      const prompt=[
        {role:"system",content:
          "You are the News Discovery Scout for a PAPER multi-asset trading system. Select only assets from the allowed list that current news, macro events or prediction-market evidence makes unusually relevant for analysis now. Do not make a trade. Return ONLY JSON: "+
          '{"symbols":["SYM1","SYM2"],"reason":"one concise explanation"}. Select 3 to 12 symbols when evidence supports them; fewer is acceptable if evidence is narrow.'},
        {role:"user",content:JSON.stringify({allowedAssets:allowed,evidence:evidenceItems})}
      ];
      const result=await callProvider("nvidia",prompt);
      const content=result?.data?.choices?.[0]?.message?.content||"";
      const parsed=parseJsonObject(content);
      const symbols=[...new Set((parsed?.symbols||[]).map(s=>String(s).toUpperCase()))].filter(s=>allowed.includes(s));
      if(result?.ok&&symbols.length) return {symbols,reason:String(parsed.reason||"AI news scout selected assets from current evidence.").slice(0,500)};
    }catch{}

    const text=evidenceItems.map(x=>x.text.toLowerCase()).join(" ");
    const keywordMap=[
      ["bitcoin","BTC"],["btc","BTC"],["ethereum","ETH"],["ether","ETH"],["solana","SOL"],
      ["nvidia","NVDA"],["apple","AAPL"],["microsoft","MSFT"],["amazon","AMZN"],["meta","META"],
      ["tesla","TSLA"],["google","GOOGL"],["alphabet","GOOGL"],["amd","AMD"],["coinbase","COIN"],
      ["microstrategy","MSTR"],["gold","GLD"],["silver","SLV"],["oil","USO"],["energy","XLE"],
      ["nasdaq","QQQ"],["technology","XLK"],["financial","XLF"],["small cap","IWM"],["treasury","TLT"],["bond","TLT"]
    ];
    const hits=[];
    for(const [keyword,symbol] of keywordMap) if(text.includes(keyword)&&allowed.includes(symbol)&&!hits.includes(symbol)) hits.push(symbol);
    const markets=marketMap(snapshot);
    const fallback=allowed.map(s=>candidateRow(s,markets)).filter(Boolean).sort((a,b)=>b.discoveryScore-a.discoveryScore).map(x=>x.symbol);
    const symbols=[...hits,...fallback.filter(s=>!hits.includes(s))].slice(0,Math.min(12,allowed.length));
    return {symbols,reason:hits.length?"Keyword fallback matched current evidence to supported assets.":"News scout fallback used current market opportunity ranking because no direct asset mentions were found."};
  }

  function compactContext(snapshot,symbols=state.latestUniverse?.symbols||DEFAULT_CRYPTO.slice(0,3)){
    const markets=marketMap(snapshot);
    const marketRows=symbols.map(s=>{
      const m=markets.get(s);
      return m?{symbol:s,market:marketKind(s,m),price:finite(m.price),change24h:finite(m.change24h),volume24h:finite(m.volume24h),provider:m.provider}:null;
    }).filter(Boolean);
    const strategies={};
    for(const [key,row] of Object.entries(state.strategyResults||{})){
      if(!row?.ok) continue;
      strategies[key]={
        strategy:row.strategy,label:row.label,symbol:row.symbol,latestSignal:row.latestSignal,
        netProfitPercent:row.netProfitPercent,winRate:row.winRate,profitFactor:row.profitFactor,
        maxDrawdownPercent:row.maxDrawdownPercent,totalTrades:row.totalTrades,latestValues:row.latestValues
      };
    }
    return {
      market:marketRows,
      prochart:strategies,
      cabbage:botIntegrations?.get?.("cabbage")||null,
      stonkfly:botIntegrations?.get?.("stonkfly")||null,
      evidence:state.evidence,
      leverageCap:state.leverage,
      paperOnly:true
    };
  }

  async function askAgent(provider,role,context){
    const allowedSymbols=(context.market||[]).map(row=>row.symbol);
    if(!allowedSymbols.length) return {provider,role,ok:false,error:"no_assets_in_council_universe",symbol:null,side:"HOLD",confidence:0};
    const prompt=[
      {role:"system",content:
        "You are "+role+" in a PAPER multi-asset trading council. Use only supplied evidence. This is simulated execution on real market data. "+
        "Choose at most one asset from this allowed list: "+allowedSymbols.join(", ")+". Respond ONLY JSON: "+
        '{"symbol":"one allowed symbol","side":"LONG|SHORT|HOLD","strategy":"short name","confidence":0.0,"leverage":1,"reason":"one concise evidence-based sentence"}. '+
        "Never claim a live-money order. Do not choose an asset outside the allowed list. If evidence conflicts or is weak, HOLD."
      },
      {role:"user",content:JSON.stringify(context)}
    ];
    const result=await callProvider(provider,prompt);
    let content=provider==="ollama"?result?.data?.message?.content:result?.data?.choices?.[0]?.message?.content;
    let parsed=parseJsonObject(content);
    let repaired=false;
    if(result?.ok && content && !parsed){
      const repairPrompt=[
        {role:"system",content:"Convert the supplied trading vote into ONLY one valid JSON object with keys symbol, side, strategy, confidence, leverage, reason. Allowed symbols: "+allowedSymbols.join(", ")+". Allowed sides: LONG, SHORT, HOLD. Do not add markdown."},
        {role:"user",content:String(content).slice(0,4000)}
      ];
      const retry=await callProvider(provider,repairPrompt);
      const retryContent=provider==="ollama"?retry?.data?.message?.content:retry?.data?.choices?.[0]?.message?.content;
      const retryParsed=parseJsonObject(retryContent);
      if(retry?.ok && retryParsed){
        content=retryContent;
        parsed=retryParsed;
        repaired=true;
      }
    }
    if(!result?.ok||!parsed){
      const detail=!result?.ok
        ? "provider_request_failed_status_"+String(result?.status||0)
        : !content
          ? "empty_provider_response"
          : "invalid_json_response";
      return {provider,role,ok:false,error:detail,providerStatus:result?.status||0,raw:String(content||"").slice(0,1000)};
    }
    const rawSymbol=String(parsed.symbol||"").toUpperCase();
    const symbol=allowedSymbols.includes(rawSymbol)?rawSymbol:allowedSymbols[0];
    const side=["LONG","SHORT","HOLD"].includes(String(parsed.side||"").toUpperCase())?String(parsed.side).toUpperCase():"HOLD";
    return {
      provider,role,ok:true,symbol,side,strategy:String(parsed.strategy||role),
      confidence:clamp(finite(parsed.confidence,0.5),0,1),
      leverage:clamp(Math.round(finite(parsed.leverage,1)),1,state.leverage),
      reason:String(parsed.reason||"").slice(0,500),
      repaired
    };
  }

  function machineVotes(snapshot,symbols=state.latestUniverse?.symbols||DEFAULT_CRYPTO.slice(0,3)){
    const votes=[];
    const markets=marketMap(snapshot);
    for(const symbol of symbols){
      const m=markets.get(symbol);
      const ch=finite(m?.change24h);
      votes.push({
        source:"Momentum",symbol,side:ch>=1.5?"LONG":ch<=-1.5?"SHORT":"HOLD",
        weight:0.7,reason:"24h change "+ch.toFixed(2)+"%"
      });
    }
    for(const row of Object.values(state.strategyResults||{})){
      if(!row?.ok||!symbols.includes(row.symbol)) continue;
      const signal=finite(row.latestSignal);
      const quality=Math.max(0.25,Math.min(0.8,
        0.35+(finite(row.profitFactor,1)-1)*0.15+Math.max(0,finite(row.netProfitPercent))*0.02-Math.max(0,finite(row.maxDrawdownPercent))*0.01
      ));
      votes.push({
        source:"ProChart · "+row.label,symbol:row.symbol,
        side:signal>0?"LONG":signal<0?"SHORT":"HOLD",weight:quality,
        reason:"latest signal "+signal+" · win "+finite(row.winRate).toFixed(1)+"% · PF "+(row.profitFactor==null?"—":finite(row.profitFactor).toFixed(2))
      });
    }
    const cabbage=botIntegrations?.get?.("cabbage");
    const ca=String(cabbage?.latest?.action||"HOLD").toUpperCase();
    if(symbols.includes("BTC")){
      votes.push({source:"CABBAGE",symbol:"BTC",side:ca==="BUY"?"LONG":ca==="SELL"?"SHORT":"HOLD",weight:1.2,reason:cabbage?.latest?.decisionTraces?.[0]?.summary||"CABBAGE latest persisted decision"});
    }
    const fly=botIntegrations?.get?.("stonkfly");
    const latest=fly?.latest||{};
    const flyHasReadout=fly?.latestAvailable===true && latest && Object.keys(latest).length>0;
    if(flyHasReadout){
      const flySide=String(latest.side||latest?.neural?.side||"HOLD").toUpperCase();
      const product=String(latest.product||"BTC-USDC").split("-")[0];
      const flySymbol=symbols.includes(product)?product:null;
      if(flySymbol) votes.push({
        source:"Stonkfly",symbol:flySymbol,
        side:["BUY","LONG"].includes(flySide)?"LONG":["SELL","SHORT"].includes(flySide)?"SHORT":"HOLD",
        weight:1.2,
        reason:"Actual persisted connectome readout"
      });
    }
    return votes;
  }

  function summarizeScore(votes,symbols=state.latestUniverse?.symbols||DEFAULT_CRYPTO.slice(0,3)){
    const board={};
    for(const s of symbols) board[s]={LONG:0,SHORT:0,HOLD:0,net:0,votes:[]};
    for(const v of votes){
      if(!board[v.symbol]) continue;
      const w=Math.max(0,finite(v.weight,finite(v.confidence,0.5)));
      if(v.side==="LONG"){board[v.symbol].LONG+=w;board[v.symbol].net+=w;}
      else if(v.side==="SHORT"){board[v.symbol].SHORT+=w;board[v.symbol].net-=w;}
      else board[v.symbol].HOLD+=w;
      board[v.symbol].votes.push(v);
    }
    return board;
  }

  function strategyRecommendations(snapshot,symbols=state.latestUniverse?.symbols||DEFAULT_CRYPTO.slice(0,3)){
    const recs=[];
    for(const [strategy,label] of PROCHART_STRATEGIES){
      const candidates=symbols.map(symbol=>state.strategyResults[symbol+":"+strategy]).filter(r=>r?.ok&&finite(r.latestSignal)!==0);
      candidates.sort((a,b)=>{
        const qa=Math.abs(finite(a.netProfitPercent))*0.2+finite(a.profitFactor,0)-finite(a.maxDrawdownPercent)*0.05;
        const qb=Math.abs(finite(b.netProfitPercent))*0.2+finite(b.profitFactor,0)-finite(b.maxDrawdownPercent)*0.05;
        return qb-qa;
      });
      const best=candidates[0];
      recs.push({
        bookId:"prochart_"+strategy,
        rec:best?{
          symbol:best.symbol,side:finite(best.latestSignal)>0?"LONG":"SHORT",leverage:state.leverage,
          strategy:label,source:"prochart",
          reason:label+" latest signal; backtest "+finite(best.netProfitPercent).toFixed(2)+"% net, "+finite(best.winRate).toFixed(1)+"% win rate, max DD "+finite(best.maxDrawdownPercent).toFixed(2)+"%."
        }:null
      });
    }
    const cabbage=botIntegrations?.get?.("cabbage");
    const ca=String(cabbage?.latest?.action||"HOLD").toUpperCase();
    recs.push({bookId:"cabbage",rec:{
      symbol:"BTC",side:ca==="BUY"?"LONG":ca==="SELL"?"EXIT":"HOLD",leverage:1,
      strategy:"CABBAGE RSI + EMA",source:"cabbage",
      reason:cabbage?.latest?.decisionTraces?.[0]?.summary||"CABBAGE persisted decision"
    }});
    const fly=botIntegrations?.get?.("stonkfly");
    const fl=fly?.latest||{};
    const flySide=String(fl.side||fl?.neural?.side||"HOLD").toUpperCase();
    const flySymbol=String(fl.product||"BTC-USDC").split("-")[0];
    recs.push({bookId:"stonkfly",rec:{
      symbol:marketMap(snapshot).has(flySymbol)?flySymbol:"BTC",
      side:["BUY","LONG"].includes(flySide)?"LONG":["SELL","SHORT"].includes(flySide)?"EXIT":"HOLD",
      leverage:1,
      strategy:"Stonkfly Connectome",source:"stonkfly",
      reason:(fly?.runtimeStatus==="RUNNING"||fly?.runtimeStatus==="READY")?"Actual connectome readout.":"No actual fly readout available; HOLD."
    }});
    const markets=marketMap(snapshot);
    const top=symbols.map(symbol=>({symbol,change24h:finite(markets.get(symbol)?.change24h)})).filter(x=>markets.has(x.symbol)).sort((a,b)=>Math.abs(b.change24h)-Math.abs(a.change24h))[0];
    recs.push({bookId:"momentum",rec:top?{
      symbol:top.symbol,side:top.change24h>=1.5?"LONG":top.change24h<=-1.5?"SHORT":"HOLD",
      leverage:state.leverage,strategy:"24h Momentum",source:"momentum",
      reason:"Largest 24h move in the current council universe: "+top.symbol+" "+top.change24h.toFixed(2)+"%."
    }:null});
    return recs;
  }

  async function runCouncil(snapshot,universe=state.latestUniverse){
    const symbols=universe?.symbols||[];
    if(!state.lastStrategyRefreshAt||now()-state.lastStrategyRefreshAt>STRATEGY_REFRESH_MS) await refreshStrategies(symbols);
    if(!state.evidence?.updatedAt||now()-state.evidence.updatedAt>COUNCIL_REFRESH_MS) await gatherEvidence();
    const context=compactContext(snapshot,symbols);
    transcript("round","Council","New investment round started with real market data and PAPER-only execution.",{});
    const aiVotes=await Promise.all(providers.map(async p=>{
      try{
        const deadlineMs=p.provider==="nvidia-ultra"?35000:p.provider.startsWith("nvidia")?28000:22000;
        const deadlineVote=new Promise(resolve=>setTimeout(()=>resolve({
          provider:p.provider,role:p.role,ok:false,error:"agent_deadline_exceeded",
          symbol:"BTC",side:"HOLD",confidence:0
        }),deadlineMs));
        const vote=await Promise.race([askAgent(p.provider,p.role,context),deadlineVote]);
        transcript("agent",p.role,(vote.ok?vote.side+" "+vote.symbol+" · "+vote.reason:"Unavailable: "+vote.error),{provider:p.provider,vote});
        return vote;
      }catch(error){
        const vote={provider:p.provider,role:p.role,ok:false,error:String(error),symbol:"BTC",side:"HOLD",confidence:0};
        transcript("agent",p.role,"Unavailable: "+String(error),{provider:p.provider,vote});
        return vote;
      }
    }));
    const machines=machineVotes(snapshot,symbols);
    for(const v of machines){
      transcript("machine",v.source,v.side+" "+v.symbol+" · "+v.reason,{vote:v});
    }
    const normalizedAi=aiVotes.filter(v=>v.ok).map(v=>({...v,source:v.role,weight:0.6+v.confidence*0.6}));
    const allVotes=[...machines,...normalizedAi];
    const scoreboard=summarizeScore(allVotes,symbols);
    const threshold=1.6;
    const ranked=Object.entries(scoreboard).sort((a,b)=>Math.abs(b[1].net)-Math.abs(a[1].net));
    if(!ranked.length){
      const decision={
        id:id("council"),timestamp:now(),symbol:null,side:"HOLD",leverage:null,score:0,threshold,
        longWeight:0,shortWeight:0,holdWeight:0,scoreboard:{},votes:allVotes,
        universeMode:universe?.mode||state.councilUniverse?.mode,
        reason:"No live asset is available in the current council universe, so no PAPER order was opened."
      };
      state.latestCouncil=decision; state.lastCouncilAt=now();
      transcript("decision","Council Decision","NO TRADE · "+decision.reason,{decision});
      save();
      return decision;
    }
    const [symbol,best]=ranked[0];
    const side=Math.abs(best.net)<threshold?"HOLD":best.net>0?"LONG":"SHORT";
    const supporting=best.votes.filter(v=>v.side===side).map(v=>v.source);
    const conflicting=best.votes.filter(v=>v.side!=="HOLD"&&v.side!==side).map(v=>v.source);
    const decision={
      id:id("council"),timestamp:now(),symbol,side,leverage:side==="HOLD"?null:state.leverage,
      score:best.net,threshold,
      longWeight:best.LONG,shortWeight:best.SHORT,holdWeight:best.HOLD,
      scoreboard,votes:allVotes,universeMode:universe?.mode||state.councilUniverse?.mode,universeSymbols:symbols,
      reason:side==="HOLD"
        ?"No asset cleared the deterministic council agreement threshold, so no PAPER order was opened."
        : side+" "+symbol+" because "+supporting.join(", ")+" aligned"+(conflicting.length?"; disagreement: "+conflicting.join(", "):".")
    };
    state.latestCouncil=decision;
    state.lastCouncilAt=now();
    transcript("decision","Council Decision",
      (decision.side==="HOLD"?"NO TRADE "+decision.symbol:decision.side+" "+decision.symbol+" "+decision.leverage+"×")+" · "+decision.reason,
      {decision});
    const markets=marketMap(snapshot);
    const councilRec={symbol,side,leverage:state.leverage,strategy:"Council Auto",source:"council",reason:decision.reason,councilId:decision.id};
    reconcileBookSignal(state.books.council_auto,councilRec,markets);
    if(state.selectedStrategy==="council_auto"){
      reconcileBookSignal(state.books.user_selected,{...councilRec,strategy:"My Selected · Council Auto",source:"user_selected:council_auto"},markets);
    }
    return decision;
  }

  async function runStrategyBooks(snapshot,symbols=state.latestUniverse?.symbols||DEFAULT_CRYPTO.slice(0,3)){
    const markets=marketMap(snapshot);
    const recommendations=strategyRecommendations(snapshot,symbols);
    for(const item of recommendations){
      if(!item.rec||!state.books[item.bookId]) continue;
      reconcileBookSignal(state.books[item.bookId],item.rec,markets);
    }
    if(state.selectedStrategy!=="council_auto"){
      const chosen=recommendations.find(item=>item.bookId===state.selectedStrategy);
      if(chosen?.rec){
        reconcileBookSignal(state.books.user_selected,{
          ...chosen.rec,
          strategy:"My Selected · "+(chosen.rec.strategy||state.selectedStrategy),
          source:"user_selected:"+state.selectedStrategy
        },markets);
      }
    }
  }

  async function scanUniverse(){
    const baseSnapshot=await serverMarketSnapshot();
    const universe=await resolveUniverse(baseSnapshot);
    transcript("universe","Opportunity Scanner",
      "Scanned "+universe.markets.join(", ")+" · "+universe.mode+" mode · candidates: "+(universe.symbols.join(", ")||"none")+". "+universe.reason,
      {universe:{mode:universe.mode,markets:universe.markets,symbols:universe.symbols,candidates:universe.candidates,reason:universe.reason}});
    save();
    return state.latestUniverse;
  }

  async function cycle(force=false){
    if(cycleBusy) return {skipped:true,state:publicState()};
    cycleBusy=true;
    try{
      const baseSnapshot=await serverMarketSnapshot();
      const openSymbols=Object.values(state.books||{}).flatMap(book=>(book.positions||[]).map(p=>p.symbol));
      const markSnapshot=await augmentSnapshot(baseSnapshot,openSymbols);
      markAndProtect(markSnapshot);
      if(!state.enabled&&!force) return {state:publicState()};

      let universe;
      if(force||!state.latestUniverse?.updatedAt||now()-state.latestUniverse.updatedAt>COUNCIL_REFRESH_MS){
        universe=await resolveUniverse(baseSnapshot);
      }else{
        const snapshot=await augmentSnapshot(baseSnapshot,state.latestUniverse.symbols||[]);
        universe={...state.latestUniverse,snapshot};
      }

      const snapshot=universe.snapshot||await augmentSnapshot(baseSnapshot,universe.symbols||[]);
      if(force||!state.lastStrategyRefreshAt||now()-state.lastStrategyRefreshAt>STRATEGY_REFRESH_MS) await refreshStrategies(universe.symbols||[]);
      await runStrategyBooks(snapshot,universe.symbols||[]);
      if(force||!state.lastCouncilAt||now()-state.lastCouncilAt>COUNCIL_REFRESH_MS) await runCouncil(snapshot,universe);
      const finalBase=await serverMarketSnapshot();
      const finalSymbols=[...(universe.symbols||[]),...Object.values(state.books||{}).flatMap(book=>(book.positions||[]).map(p=>p.symbol))];
      markAndProtect(await augmentSnapshot(finalBase,finalSymbols));
      save();
      return {state:publicState()};
    }finally{cycleBusy=false;}
  }

  function resetBooks(capital){
    state.books={};
    state.capitalPerBook=clamp(finite(capital,1000),10,1000000);
    ensureBooks(state.capitalPerBook);
    state.orders=[];state.fills=[];state.trades=[];state.transcript=[];
    state.latestCouncil=null;state.lastCouncilAt=null;state.lastStrategyRefreshAt=null;
    save();
  }
  function start({capital=1000,leverage=2,reset=false}={}){
    state.leverage=LEVERAGES.includes(Number(leverage))?Number(leverage):clamp(Math.round(finite(leverage,2)),1,10);
    const untouched = state.orders.length === 0 && state.trades.length === 0
      && Object.values(state.books || {}).every(book => !book.positions?.length);
    if(reset||untouched||!Object.keys(state.books||{}).length) resetBooks(capital);
    state.enabled=true;save();cycle(true).catch(error=>transcript("error","System",String(error)));
    return publicState();
  }
  function stop(){state.enabled=false;save();return publicState();}
  function configureUniverse({mode,markets,symbols,maxCandidates}={}){
    const nextMode=["discover","manual","news"].includes(mode)?mode:state.councilUniverse.mode;
    const nextMarkets=[...new Set((Array.isArray(markets)?markets:state.councilUniverse.markets).filter(m=>["crypto","equity","etf"].includes(m)))];
    const nextSymbols=[...new Set((Array.isArray(symbols)?symbols:state.councilUniverse.symbols).map(s=>String(s).toUpperCase().trim()).filter(s=>/^[A-Z0-9]{1,20}$/.test(s)))].slice(0,25);
    state.councilUniverse={
      mode:nextMode,
      markets:nextMarkets.length?nextMarkets:["crypto"],
      symbols:nextSymbols,
      maxCandidates:clamp(Math.round(finite(maxCandidates,state.councilUniverse.maxCandidates||12)),3,25)
    };
    state.latestUniverse={mode:nextMode,markets:state.councilUniverse.markets,symbols:[],candidates:[],reason:"Universe settings changed; scan pending.",updatedAt:null};
    transcript("selection","User","Council universe changed to "+nextMode+" · markets "+state.councilUniverse.markets.join(", ")+(nextMode==="manual"?" · assets "+(nextSymbols.join(", ")||"none"):""),{councilUniverse:state.councilUniverse});
    save();
    if(state.enabled) cycle(true).catch(()=>{});
    return publicState();
  }

  function selectStrategy(strategy){
    const valid=["council_auto",...PROCHART_STRATEGIES.map(([key])=>"prochart_"+key),"cabbage","stonkfly","momentum"];
    if(!valid.includes(strategy)) throw new Error("unknown_selected_strategy");
    if(state.selectedStrategy!==strategy){
      state.selectedStrategy=strategy;
      state.books.user_selected=newBook("user_selected","My Selected Strategy",state.capitalPerBook);
      transcript("selection","User","My Selected Strategy changed to "+strategy+". Its PAPER track record restarted from "+state.capitalPerBook+".",{strategy});
      save();
      if(state.enabled) cycle(true).catch(()=>{});
    }
    return publicState();
  }
  function publicState(){
    return {
      paperOnly:true,realMarketData:true,enabled:state.enabled,capitalPerBook:state.capitalPerBook,leverage:state.leverage,
      selectedStrategy:state.selectedStrategy,
      strategyChoices:[
        {key:"council_auto",label:"Council Auto"},
        ...PROCHART_STRATEGIES.map(([key,label])=>({key:"prochart_"+key,label:"ProChart · "+label})),
        {key:"cabbage",label:"CABBAGE RSI + EMA"},
        {key:"stonkfly",label:"Stonkfly Connectome"},
        {key:"momentum",label:"24h Momentum"}
      ],
      leverageOptions:LEVERAGES,
      councilUniverse:state.councilUniverse,
      latestUniverse:state.latestUniverse,
      assetCatalog:{
        crypto:DEFAULT_CRYPTO.map(symbol=>({symbol,label:symbol,market:"crypto"})),
        equity:EQUITY_SYMBOLS.map(symbol=>({symbol,label:symbol,market:"equity"})),
        etf:ETF_SYMBOLS.map(symbol=>({symbol,label:symbol,market:"etf"}))
      },
      books:Object.values(state.books).map(b=>({...b,winRate:b.tradeCount?b.wins/b.tradeCount:0})),
      positions:Object.values(state.books).flatMap(b=>b.positions),
      orders:state.orders.slice(-300).reverse(),
      fills:state.fills.slice(-300).reverse(),
      trades:state.trades.slice(-300).reverse(),
      transcript:state.transcript.slice(-300).reverse(),
      evidence:state.evidence,
      strategyResults:state.strategyResults,
      latestCouncil:state.latestCouncil,
      lastStrategyRefreshAt:state.lastStrategyRefreshAt,lastCouncilAt:state.lastCouncilAt,updatedAt:state.updatedAt
    };
  }

  const timer=setInterval(()=>cycle(false).catch(()=>{}),MARK_MS);
  if(timer.unref) timer.unref();

  return {state:publicState,start,stop,selectStrategy,configureUniverse,scanUniverse,cycle,refreshStrategies,gatherEvidence};
}
