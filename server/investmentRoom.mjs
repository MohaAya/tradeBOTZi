import fs from "node:fs";
import path from "node:path";

const STATE_FILE = process.env.INVESTMENT_ROOM_STATE_FILE || "/opt/tradebotzi/data/investment-room.json";
const PROCHART_URL = "https://prochart-engine-gateway.hankenayati.workers.dev";
const STRATEGY_REFRESH_MS = 10 * 60 * 1000;
const COUNCIL_REFRESH_MS = 5 * 60 * 1000;
const MARK_MS = 15000;
const FEE_RATE = 0.001;
const SYMBOLS = ["BTC","ETH","SOL"];
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
  let cycleBusy=false;
  const providers=[
    {provider:"nvidia",role:"Portfolio Manager"},
    {provider:"nvidia-critic",role:"Independent Reasoning Critic"},
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
      if(!prev||row.provider==="binance") map.set(row.canonicalSymbol,row);
    }
    return map;
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

  async function refreshStrategies(){
    const results={};
    const tasks=[];
    for(const symbol of SYMBOLS){
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
    transcript("evidence","ProChart","Refreshed "+Object.values(results).filter(x=>x.ok).length+" live TradingView backtests across BTC, ETH and SOL.",{source:"prochart"});
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
        return /bitcoin|btc|ethereum|eth|crypto|fed|rate|inflation|recession|sec/.test(q);
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
    return fetchGoogleNewsRoom("Crypto News","bitcoin ethereum crypto markets today","news");
  }
  async function fetchMacro(){
    return fetchGoogleNewsRoom("Macro","Federal Reserve inflation CPI rates recession markets today","macro");
  }
  async function fetchResearch(){
    return fetchGoogleNewsRoom("Research","bitcoin ethereum crypto market analysis outlook research","research");
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

  function compactContext(snapshot){
    const markets=marketMap(snapshot);
    const marketRows=SYMBOLS.map(s=>{
      const m=markets.get(s);
      return m?{symbol:s,price:finite(m.price),change24h:finite(m.change24h),provider:m.provider}:null;
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
    const prompt=[
      {role:"system",content:
        "You are "+role+" in a PAPER trading council. Use only supplied evidence. This is simulated execution on real market data. "+
        "Choose at most one asset from BTC, ETH, SOL. Respond ONLY JSON: "+
        '{"symbol":"BTC|ETH|SOL","side":"LONG|SHORT|HOLD","strategy":"short name","confidence":0.0,"leverage":1,"reason":"one concise evidence-based sentence"}. '+
        "Never claim a live-money order. If evidence conflicts or is weak, HOLD."
      },
      {role:"user",content:JSON.stringify(context)}
    ];
    const result=await callProvider(provider,prompt);
    let content=provider==="ollama"?result?.data?.message?.content:result?.data?.choices?.[0]?.message?.content;
    let parsed=parseJsonObject(content);
    let repaired=false;
    if(result?.ok && content && !parsed){
      const repairPrompt=[
        {role:"system",content:"Convert the supplied trading vote into ONLY one valid JSON object with keys symbol, side, strategy, confidence, leverage, reason. Allowed symbols: BTC, ETH, SOL. Allowed sides: LONG, SHORT, HOLD. Do not add markdown."},
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
    const symbol=SYMBOLS.includes(String(parsed.symbol||"").toUpperCase())?String(parsed.symbol).toUpperCase():"BTC";
    const side=["LONG","SHORT","HOLD"].includes(String(parsed.side||"").toUpperCase())?String(parsed.side).toUpperCase():"HOLD";
    return {
      provider,role,ok:true,symbol,side,strategy:String(parsed.strategy||role),
      confidence:clamp(finite(parsed.confidence,0.5),0,1),
      leverage:clamp(Math.round(finite(parsed.leverage,1)),1,state.leverage),
      reason:String(parsed.reason||"").slice(0,500),
      repaired
    };
  }

  function machineVotes(snapshot){
    const votes=[];
    const markets=marketMap(snapshot);
    for(const symbol of SYMBOLS){
      const m=markets.get(symbol);
      const ch=finite(m?.change24h);
      votes.push({
        source:"Momentum",symbol,side:ch>=1.5?"LONG":ch<=-1.5?"SHORT":"HOLD",
        weight:0.7,reason:"24h change "+ch.toFixed(2)+"%"
      });
    }
    for(const row of Object.values(state.strategyResults||{})){
      if(!row?.ok||!SYMBOLS.includes(row.symbol)) continue;
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
    votes.push({source:"CABBAGE",symbol:"BTC",side:ca==="BUY"?"LONG":ca==="SELL"?"SHORT":"HOLD",weight:1.2,reason:cabbage?.latest?.decisionTraces?.[0]?.summary||"CABBAGE latest persisted decision"});
    const fly=botIntegrations?.get?.("stonkfly");
    const latest=fly?.latest||{};
    const flyHasReadout=fly?.latestAvailable===true && latest && Object.keys(latest).length>0;
    if(flyHasReadout){
      const flySide=String(latest.side||latest?.neural?.side||"HOLD").toUpperCase();
      const product=String(latest.product||"BTC-USDC").split("-")[0];
      votes.push({
        source:"Stonkfly",symbol:SYMBOLS.includes(product)?product:"BTC",
        side:["BUY","LONG"].includes(flySide)?"LONG":["SELL","SHORT"].includes(flySide)?"SHORT":"HOLD",
        weight:1.2,
        reason:"Actual persisted connectome readout"
      });
    }
    return votes;
  }

  function summarizeScore(votes){
    const board={};
    for(const s of SYMBOLS) board[s]={LONG:0,SHORT:0,HOLD:0,net:0,votes:[]};
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

  function strategyRecommendations(snapshot){
    const recs=[];
    for(const [strategy,label] of PROCHART_STRATEGIES){
      const candidates=SYMBOLS.map(symbol=>state.strategyResults[symbol+":"+strategy]).filter(r=>r?.ok&&finite(r.latestSignal)!==0);
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
      symbol:SYMBOLS.includes(flySymbol)?flySymbol:"BTC",
      side:["BUY","LONG"].includes(flySide)?"LONG":["SELL","SHORT"].includes(flySide)?"EXIT":"HOLD",
      leverage:1,
      strategy:"Stonkfly Connectome",source:"stonkfly",
      reason:(fly?.runtimeStatus==="RUNNING"||fly?.runtimeStatus==="READY")?"Actual connectome readout.":"No actual fly readout available; HOLD."
    }});
    const markets=marketMap(snapshot);
    const top=SYMBOLS.map(symbol=>({symbol,change24h:finite(markets.get(symbol)?.change24h)})).sort((a,b)=>Math.abs(b.change24h)-Math.abs(a.change24h))[0];
    recs.push({bookId:"momentum",rec:top?{
      symbol:top.symbol,side:top.change24h>=1.5?"LONG":top.change24h<=-1.5?"SHORT":"HOLD",
      leverage:state.leverage,strategy:"24h Momentum",source:"momentum",
      reason:"Largest BTC/ETH/SOL 24h move: "+top.change24h.toFixed(2)+"%."
    }:null});
    return recs;
  }

  async function runCouncil(snapshot){
    if(!state.lastStrategyRefreshAt||now()-state.lastStrategyRefreshAt>STRATEGY_REFRESH_MS) await refreshStrategies();
    if(!state.evidence?.updatedAt||now()-state.evidence.updatedAt>COUNCIL_REFRESH_MS) await gatherEvidence();
    const context=compactContext(snapshot);
    transcript("round","Council","New investment round started with real market data and PAPER-only execution.",{});
    const aiVotes=await Promise.all(providers.map(async p=>{
      try{
        const vote=await askAgent(p.provider,p.role,context);
        transcript("agent",p.role,(vote.ok?vote.side+" "+vote.symbol+" · "+vote.reason:"Unavailable: "+vote.error),{provider:p.provider,vote});
        return vote;
      }catch(error){
        const vote={provider:p.provider,role:p.role,ok:false,error:String(error),symbol:"BTC",side:"HOLD",confidence:0};
        transcript("agent",p.role,"Unavailable: "+String(error),{provider:p.provider});
        return vote;
      }
    }));
    const machines=machineVotes(snapshot);
    for(const v of machines){
      transcript("machine",v.source,v.side+" "+v.symbol+" · "+v.reason,{vote:v});
    }
    const normalizedAi=aiVotes.filter(v=>v.ok).map(v=>({...v,source:v.role,weight:0.6+v.confidence*0.6}));
    const allVotes=[...machines,...normalizedAi];
    const scoreboard=summarizeScore(allVotes);
    const ranked=Object.entries(scoreboard).sort((a,b)=>Math.abs(b[1].net)-Math.abs(a[1].net));
    const [symbol,best]=ranked[0];
    const threshold=1.6;
    const side=Math.abs(best.net)<threshold?"HOLD":best.net>0?"LONG":"SHORT";
    const supporting=best.votes.filter(v=>v.side===side).map(v=>v.source);
    const conflicting=best.votes.filter(v=>v.side!=="HOLD"&&v.side!==side).map(v=>v.source);
    const decision={
      id:id("council"),timestamp:now(),symbol,side,leverage:side==="HOLD"?null:state.leverage,
      score:best.net,threshold,
      longWeight:best.LONG,shortWeight:best.SHORT,holdWeight:best.HOLD,
      scoreboard,votes:allVotes,
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

  async function runStrategyBooks(snapshot){
    const markets=marketMap(snapshot);
    const recommendations=strategyRecommendations(snapshot);
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

  async function cycle(force=false){
    if(cycleBusy) return {skipped:true,state:publicState()};
    cycleBusy=true;
    try{
      const snapshot=await serverMarketSnapshot();
      markAndProtect(snapshot);
      if(!state.enabled&&!force) return {state:publicState()};
      if(force||!state.lastStrategyRefreshAt||now()-state.lastStrategyRefreshAt>STRATEGY_REFRESH_MS) await refreshStrategies();
      await runStrategyBooks(snapshot);
      if(force||!state.lastCouncilAt||now()-state.lastCouncilAt>COUNCIL_REFRESH_MS) await runCouncil(snapshot);
      markAndProtect(await serverMarketSnapshot());
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

  return {state:publicState,start,stop,selectStrategy,cycle,refreshStrategies,gatherEvidence};
}
