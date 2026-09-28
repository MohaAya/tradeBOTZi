import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bot,
  Brain,
  CandlestickChart,
  CheckCircle2,
  Clock3,
  Database,
  Newspaper,
  Pause,
  Play,
  RefreshCw,
  Shield,
  Sparkles,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from 'lucide-react';
import BrokerChart from './BrokerChart';

const leverageOptions = [1, 2, 3, 5, 10];

const providerLabels: Record<string, string> = {
  nvidia: 'Nemotron 3.5 Lightning',
  'nvidia-ultra': 'Nemotron 3 Ultra',
  'nvidia-critic': 'GPT-OSS 20B',
  'nvidia-gemma': 'Gemma 4 31B',
  omniroute: 'OmniRoute',
  hermes: 'Hermes',
  freellm: 'FreeLLM',
  ollama: 'Ollama',
};

const providerRoles: Record<string, string> = {
  nvidia: 'Portfolio Manager',
  'nvidia-ultra': 'Strategic Allocator',
  'nvidia-critic': 'Independent Reasoning Critic',
  'nvidia-gemma': 'Technical Pattern Analyst',
  omniroute: 'Independent Market Analyst',
  hermes: 'Risk Critic',
  freellm: 'Macro & Event Analyst',
  ollama: 'Technical Explainer',
};

const nvidiaProviderIds = ['nvidia', 'nvidia-ultra', 'nvidia-critic', 'nvidia-gemma'];
const existingProviderIds = ['omniroute', 'hermes', 'freellm', 'ollama'];

function money(value: any) {
  const n = Number(value);
  return Number.isFinite(n)
    ? new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n)
    : '—';
}
function num(value: any, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}
function pct(value: any, scale = 100) {
  const n = Number(value);
  return Number.isFinite(n) ? (n * scale).toFixed(1) + '%' : '—';
}
function sideClass(side: string) {
  return side === 'LONG' ? 'text-emerald-300' : side === 'SHORT' ? 'text-red-300' : 'text-gray-400';
}

function SectionHelp({ title = 'What this means · How to use it', children }: { title?: string; children: React.ReactNode }) {
  return (
    <details className="mt-3 rounded-lg border border-gray-800 bg-gray-950/50">
      <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-medium text-cyan-300 hover:text-cyan-200">
        {title}
      </summary>
      <div className="border-t border-gray-800 px-3 py-3 text-[11px] leading-relaxed text-gray-400">
        {children}
      </div>
    </details>
  );
}

export default function InvestmentRoom() {
  const [room, setRoom] = useState<any>(null);
  const [aiProviders, setAiProviders] = useState<any[]>([]);
  const [capital, setCapital] = useState(1000);
  const [leverage, setLeverage] = useState(2);
  const [selectedBook, setSelectedBook] = useState('council_auto');
  const [symbol, setSymbol] = useState('BTC');
  const [universeMode, setUniverseMode] = useState('discover');
  const [universeMarkets, setUniverseMarkets] = useState<string[]>(['crypto', 'equity', 'etf']);
  const [universeSymbols, setUniverseSymbols] = useState<string[]>([]);
  const [maxCandidates, setMaxCandidates] = useState(12);
  const [customSymbol, setCustomSymbol] = useState('');
  const universeInitialized = useRef(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const refresh = async () => {
    try {
      const [roomRes, providerRes] = await Promise.all([
        fetch('/api/investment-room/state', { cache: 'no-store' }),
        fetch('/api/ai/providers', { cache: 'no-store' }),
      ]);
      const roomData = await roomRes.json();
      const providerData = await providerRes.json();
      if (roomRes.ok && roomData.ok) {
        setRoom(roomData.room);
        if (roomData.room?.leverage) setLeverage(Number(roomData.room.leverage));
        if (!universeInitialized.current && roomData.room?.councilUniverse) {
          const cfg = roomData.room.councilUniverse;
          setUniverseMode(cfg.mode || 'discover');
          setUniverseMarkets(Array.isArray(cfg.markets) && cfg.markets.length ? cfg.markets : ['crypto']);
          setUniverseSymbols(Array.isArray(cfg.symbols) ? cfg.symbols : []);
          setMaxCandidates(Number(cfg.maxCandidates || 12));
          universeInitialized.current = true;
        }
      }
      if (providerRes.ok && Array.isArray(providerData.providers)) {
        setAiProviders(providerData.providers);
      }
    } catch {}
  };

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, []);

  const post = async (url: string, body: any = {}) => {
    setError('');
    setNotice('');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Action failed');
    await refresh();
    return data;
  };

  const start = async (reset = false) => {
    setBusy('start');
    try {
      await post('/api/investment-room/start', { capital, leverage, reset });
      setNotice('Paper Investment Room is running on real market data. Each strategy portfolio is tracked independently.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const stop = async () => {
    setBusy('stop');
    try {
      await post('/api/investment-room/stop');
      setNotice('New strategy/council entries are paused. Existing PAPER positions remain marked and protected.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const runNow = async () => {
    setBusy('run');
    try {
      await post('/api/investment-room/run');
      setNotice('Council round completed and strategy portfolios were refreshed.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const chooseStrategy = async (strategy: string) => {
    setBusy('strategy');
    try {
      await post('/api/investment-room/select-strategy', { strategy });
      setSelectedBook('user_selected');
      setNotice('My Selected Strategy is now following ' + strategy + ' in a fresh PAPER portfolio.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const toggleUniverseMarket = (market: string) => {
    setUniverseMarkets(current => current.includes(market)
      ? current.filter(item => item !== market)
      : [...current, market]);
  };

  const toggleUniverseSymbol = (asset: string) => {
    setUniverseSymbols(current => current.includes(asset)
      ? current.filter(item => item !== asset)
      : [...current, asset]);
  };

  const addCustomSymbol = () => {
    const clean = customSymbol.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
    if (!clean) return;
    setUniverseSymbols(current => current.includes(clean) ? current : [...current, clean]);
    setCustomSymbol('');
  };

  const applyUniverse = async (scanOnly = true) => {
    if (!universeMarkets.length) {
      setError('Select at least one market.');
      return;
    }
    if (universeMode === 'manual' && universeSymbols.length === 0) {
      setError('Choose at least one asset in manual mode.');
      return;
    }
    setBusy('universe');
    try {
      await post('/api/investment-room/universe', {
        mode: universeMode,
        markets: universeMarkets,
        symbols: universeSymbols,
        maxCandidates: universeMode === 'manual'
          ? Math.min(25, Math.max(3, universeSymbols.length))
          : maxCandidates,
      });
      if (scanOnly) await post('/api/investment-room/universe/scan');
      setNotice(scanOnly
        ? 'Council universe updated and scanned. Review the candidates before running the council.'
        : 'Council universe settings updated.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const books = room?.books || [];
  const currentBook = books.find((b: any) => b.key === selectedBook) || books[0];
  const positions = room?.positions || [];
  const bookPositions = positions.filter((p: any) => p.bookId === currentBook?.key);
  const fills = room?.fills || [];
  const recentOrders = room?.orders || [];
  const transcript = room?.transcript || [];
  const evidenceRooms = room?.evidence?.rooms || [];
  const council = room?.latestCouncil;
  const strategyResults = room?.strategyResults || {};
  const latestUniverse = room?.latestUniverse || {};
  const assetCatalog = room?.assetCatalog || { crypto: [], equity: [], etf: [] };
  const selectableAssets = [
    ...(universeMarkets.includes('crypto') ? assetCatalog.crypto || [] : []),
    ...(universeMarkets.includes('equity') ? assetCatalog.equity || [] : []),
    ...(universeMarkets.includes('etf') ? assetCatalog.etf || [] : []),
  ];
  const chartSymbols = useMemo(() => {
    const values = [
      ...(latestUniverse?.symbols || []),
      ...positions.map((p: any) => p.symbol),
      symbol,
      'BTC',
      'ETH',
      'SOL',
    ].filter(Boolean);
    return [...new Set(values)].slice(0, 16);
  }, [latestUniverse?.symbols, positions, symbol]);
  const buildProviderCards = (ids: string[]) => ids.map(id => {
    const provider = aiProviders.find((item: any) => item.id === id) || { id, status: 'unknown', healthy: false, model: '' };
    const latest = transcript.find((msg: any) => msg.kind === 'agent' && msg.meta?.provider === id);
    return { ...provider, latest };
  });
  const nvidiaProviders = buildProviderCards(nvidiaProviderIds);
  const existingProviders = buildProviderCards(existingProviderIds);

  const strategiesForSymbol = useMemo(() => {
    return Object.values(strategyResults)
      .filter((r: any) => r?.ok && r.symbol === symbol)
      .sort((a: any, b: any) => String(a.label).localeCompare(String(b.label)));
  }, [strategyResults, symbol]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <WalletCards className="w-6 h-6 text-emerald-400" />
            <h2 className="text-2xl font-bold text-white">Investment Room</h2>
          </div>
          <p className="text-gray-400 text-sm mt-1 max-w-3xl">
            Real market data, simulated broker execution. AI agents, ProChart strategies, CABBAGE and Stonkfly can each run their own PAPER portfolio while the Council runs a combined portfolio.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={'text-xs px-3 py-1.5 rounded-full border ' + (
            room?.enabled
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-gray-900 border-gray-700 text-gray-400'
          )}>
            {room?.enabled ? 'AUTONOMOUS PAPER RUNNING' : 'PAUSED'}
          </span>
          <span className="text-xs px-3 py-1.5 rounded-full border bg-cyan-500/10 border-cyan-500/20 text-cyan-300">
            REAL MARKET DATA
          </span>
        </div>
      </div>

      <SectionHelp title="Start here · what the Investment Room is doing">
        <p><span className="text-gray-200 font-medium">REAL MARKET DATA</span> means prices/candles come from live market sources. <span className="text-gray-200 font-medium">PAPER</span> means the orders and money are simulated — no real broker/exchange order is being placed.</p>
        <p className="mt-2"><span className="text-gray-200 font-medium">AUTONOMOUS PAPER RUNNING</span> means new strategy/council evaluations may create PAPER entries automatically. <span className="text-gray-200 font-medium">PAUSED</span> means no new automatic entries, while existing PAPER positions can still be marked and protected.</p>
        <p className="mt-2">A useful workflow is: choose capital/leverage → start or run one round → inspect AI disagreement → compare strategy portfolios → inspect chart/fills → verify the ledger → repeat over time before drawing conclusions.</p>
      </SectionHelp>

      {notice && <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">{notice}</div>}
      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

      <div className="bg-gray-800/50 border border-gray-700 rounded-2xl p-5">
        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-5">
          <div>
            <label className="text-xs text-gray-400">Capital for each strategy portfolio</label>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-gray-500">$</span>
              <input
                type="number"
                min={10}
                step="any"
                value={capital}
                onChange={e => setCapital(Math.max(10, Number(e.target.value) || 10))}
                className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white outline-none focus:border-emerald-500/50"
              />
            </div>
            <p className="text-[11px] text-gray-600 mt-1">Minimum $10. Each portfolio receives the same starting capital for fair comparison.</p>
          </div>
          <div>
            <label className="text-xs text-gray-400">Maximum PAPER leverage</label>
            <div className="flex flex-wrap gap-2 mt-2">
              {leverageOptions.map(value => (
                <button
                  key={value}
                  onClick={() => setLeverage(value)}
                  className={'px-4 py-2 rounded-lg border text-sm font-medium ' + (
                    leverage === value
                      ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                      : 'border-gray-700 bg-gray-950 text-gray-400 hover:text-white'
                  )}
                >
                  {value}×
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-600 mt-1">Council and strategy books may use up to this leverage. Stonkfly remains spot-style when its real runtime provides a vote.</p>
          </div>
        </div>

        <div className="mt-5">
          <label className="text-xs text-gray-400">My Selected Strategy</label>
          <div className="flex flex-col md:flex-row gap-2 mt-2">
            <select
              value={room?.selectedStrategy || 'council_auto'}
              onChange={e => chooseStrategy(e.target.value)}
              disabled={busy === 'strategy'}
              className="min-w-[280px] bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-violet-500/50"
            >
              {(room?.strategyChoices || []).map((choice: any) => (
                <option key={choice.key} value={choice.key}>{choice.label}</option>
              ))}
            </select>
            <div className="text-[11px] text-gray-500 self-center">
              This creates a separate track record in <span className="text-gray-300">My Selected Strategy</span>; comparison portfolios continue running independently.
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-5">
          {!room?.enabled ? (
            <button onClick={() => start(false)} disabled={!!busy}
              className="px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white text-sm font-semibold flex items-center gap-2">
              <Play className="w-4 h-4" /> Start Paper Investment Room
            </button>
          ) : (
            <button onClick={stop} disabled={!!busy}
              className="px-4 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm flex items-center gap-2">
              <Pause className="w-4 h-4" /> Pause New Entries
            </button>
          )}
          <button onClick={runNow} disabled={!!busy}
            className="px-4 py-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 disabled:opacity-40 text-sm flex items-center gap-2">
            <RefreshCw className={'w-4 h-4 ' + (busy === 'run' ? 'animate-spin' : '')} /> Run Council + Strategies Now
          </button>
          <button onClick={() => start(true)} disabled={!!busy}
            className="px-4 py-2.5 rounded-lg bg-gray-900 border border-gray-700 text-gray-400 hover:text-white text-sm">
            Reset All Paper Portfolios
          </button>
        </div>

        <SectionHelp title="How to use the controls">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <p><span className="text-gray-200 font-medium">Capital</span> sets the starting PAPER cash for every comparison portfolio. Use the same amount so strategy results are comparable.</p>
            <p><span className="text-gray-200 font-medium">Maximum leverage</span> caps how much simulated exposure a strategy or council trade may use. Higher leverage magnifies both gains and losses.</p>
            <p><span className="text-gray-200 font-medium">My Selected Strategy</span> is your own follow-along portfolio. Changing it starts a fresh track record for that one portfolio only.</p>
            <p><span className="text-gray-200 font-medium">Start</span> enables recurring PAPER decisions. <span className="text-gray-200 font-medium">Pause</span> stops new entries but keeps existing positions marked and protected.</p>
            <p><span className="text-gray-200 font-medium">Run Council + Strategies Now</span> forces one immediate evaluation using current market/evidence data even while continuous entries are paused.</p>
            <p><span className="text-gray-200 font-medium">Reset</span> clears PAPER portfolios and starts their performance histories again from the capital you entered.</p>
          </div>
        </SectionHelp>
      </div>

      <div className="rounded-2xl border border-cyan-500/30 bg-gradient-to-br from-cyan-500/10 via-gray-900 to-gray-950 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-cyan-400" />
              <h3 className="text-white text-lg font-semibold">Council Universe</h3>
              <span className="text-[10px] px-2 py-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
                MULTI-MARKET
              </span>
            </div>
            <p className="text-gray-400 text-xs mt-2 max-w-3xl">
              Decide what the council is allowed to analyze before it votes. Discovery and scanning do not place a PAPER trade; the council still needs to clear the execution threshold.
            </p>
          </div>
          <button onClick={() => applyUniverse(true)} disabled={!!busy}
            className="px-3 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 disabled:opacity-40 text-xs flex items-center gap-2">
            <RefreshCw className={'w-3.5 h-3.5 ' + (busy === 'universe' ? 'animate-spin' : '')} />
            Apply + Scan Universe
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-5">
          {[
            ['discover', 'Discover Opportunities', 'Scan the selected markets first, rank supported assets by current movement and liquidity, then give the strongest candidates to the council.'],
            ['manual', 'Choose Markets / Assets', 'You choose exactly which markets and symbols the council may analyze. Useful when you already have a watchlist or thesis.'],
            ['news', 'News-Driven Discovery', 'Use current news, macro, research and prediction-market evidence to decide which supported assets deserve council attention now.'],
          ].map(([mode, title, copy]) => (
            <button key={mode} onClick={() => setUniverseMode(mode)}
              className={'text-left rounded-xl border p-4 transition ' + (
                universeMode === mode
                  ? 'border-cyan-500/50 bg-cyan-500/10'
                  : 'border-gray-700 bg-gray-950/60 hover:border-gray-600'
              )}>
              <p className={universeMode === mode ? 'text-cyan-200 text-sm font-semibold' : 'text-white text-sm font-semibold'}>{title}</p>
              <p className="text-gray-500 text-[11px] mt-2 leading-relaxed">{copy}</p>
            </button>
          ))}
        </div>

        <div className="mt-5">
          <p className="text-[10px] uppercase tracking-wide text-gray-500">Markets to include</p>
          <div className="flex flex-wrap gap-2 mt-2">
            {[
              ['crypto', 'Crypto'],
              ['equity', 'US Equities'],
              ['etf', 'ETFs / Macro Proxies'],
            ].map(([market, label]) => (
              <button key={market} onClick={() => toggleUniverseMarket(market)}
                className={'px-3 py-2 rounded-lg border text-xs ' + (
                  universeMarkets.includes(market)
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                    : 'border-gray-700 bg-gray-950 text-gray-500'
                )}>
                {universeMarkets.includes(market) ? '✓ ' : ''}{label}
              </button>
            ))}
          </div>
        </div>

        {universeMode === 'manual' && (
          <div className="mt-5 rounded-xl border border-gray-800 bg-gray-950/60 p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-white text-sm font-medium">Assets the council may analyze</p>
                <p className="text-gray-500 text-[10px] mt-1">Select from the supported catalog or add a ticker. Assets without a live quote are ignored rather than invented.</p>
              </div>
              <span className="text-[10px] text-cyan-300">{universeSymbols.length} selected</span>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3 max-h-[180px] overflow-y-auto">
              {selectableAssets.map((asset: any) => (
                <button key={asset.symbol} onClick={() => toggleUniverseSymbol(asset.symbol)}
                  className={'px-2.5 py-1.5 rounded-md border text-[11px] ' + (
                    universeSymbols.includes(asset.symbol)
                      ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-200'
                      : 'border-gray-800 bg-gray-900 text-gray-500 hover:text-gray-300'
                  )}>
                  {asset.symbol}
                </button>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <input value={customSymbol} onChange={e => setCustomSymbol(e.target.value.toUpperCase())}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomSymbol(); } }}
                placeholder="Add ticker e.g. PLTR"
                className="w-52 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-cyan-500/50" />
              <button onClick={addCustomSymbol}
                className="px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-gray-300 text-xs">
                Add
              </button>
              {universeSymbols.length > 0 && (
                <button onClick={() => setUniverseSymbols([])}
                  className="px-3 py-2 rounded-lg border border-gray-800 bg-gray-950 text-gray-500 text-xs">
                  Clear
                </button>
              )}
            </div>
            {universeSymbols.length > 0 && (
              <p className="text-[10px] text-gray-500 mt-3">Selected: <span className="text-gray-300">{universeSymbols.join(', ')}</span></p>
            )}
          </div>
        )}

        {universeMode !== 'manual' && (
          <div className="mt-5 flex items-center gap-3 flex-wrap">
            <label className="text-xs text-gray-400">Candidates passed to council</label>
            <select value={maxCandidates} onChange={e => setMaxCandidates(Number(e.target.value))}
              className="bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white outline-none">
              {[6, 8, 12, 16, 20, 25].map(value => <option key={value} value={value}>{value}</option>)}
            </select>
            <span className="text-[10px] text-gray-600">The scanner may inspect a broader market, then narrows it before AI voting.</span>
          </div>
        )}

        <div className="mt-5 rounded-xl border border-gray-800 bg-gray-950/70 p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-white text-sm font-medium">Current council candidates</p>
              <p className="text-gray-500 text-[10px] mt-1">
                {latestUniverse?.updatedAt ? new Date(latestUniverse.updatedAt).toLocaleTimeString() : 'Not scanned yet'}
                {latestUniverse?.mode ? ' · ' + latestUniverse.mode : ''}
              </p>
            </div>
            <button onClick={runNow} disabled={!!busy || !(latestUniverse?.symbols || []).length}
              className="px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/30 text-violet-300 disabled:opacity-40 text-xs">
              Run Council on Candidates
            </button>
          </div>
          <p className="text-gray-400 text-[11px] mt-3">{latestUniverse?.reason || 'Scan a universe to generate candidates.'}</p>
          <div className="flex flex-wrap gap-2 mt-3">
            {(latestUniverse?.candidates || []).map((candidate: any) => (
              <button key={candidate.symbol} onClick={() => setSymbol(candidate.symbol)}
                className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-left hover:border-cyan-500/30">
                <div className="flex items-center gap-2">
                  <span className="text-white text-xs font-semibold">{candidate.symbol}</span>
                  <span className="text-[9px] uppercase text-gray-600">{candidate.market}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-gray-400 text-[10px]">{money(candidate.price)}</span>
                  <span className={(Number(candidate.change24h) >= 0 ? 'text-emerald-300' : 'text-red-300') + ' text-[10px]'}>
                    {Number(candidate.change24h) >= 0 ? '+' : ''}{num(candidate.change24h)}%
                  </span>
                </div>
              </button>
            ))}
            {!(latestUniverse?.candidates || []).length && (
              <p className="text-gray-600 text-xs">No candidates yet.</p>
            )}
          </div>
        </div>

        <SectionHelp title="How to use Council Universe">
          <p><span className="text-gray-200 font-medium">Discover Opportunities</span> is for broad scanning. Use it when you want the system to find what is moving or liquid enough to deserve analysis rather than starting with a ticker.</p>
          <p className="mt-2"><span className="text-gray-200 font-medium">Choose Markets / Assets</span> is for a controlled watchlist. The council cannot vote on anything outside your selected symbols.</p>
          <p className="mt-2"><span className="text-gray-200 font-medium">News-Driven Discovery</span> first asks which supported assets are made relevant by current news/macro/event evidence, then the trading council evaluates those candidates.</p>
          <p className="mt-2"><span className="text-gray-200 font-medium">Apply + Scan Universe</span> only finds candidates. It does not place a PAPER order. <span className="text-gray-200 font-medium">Run Council on Candidates</span> is the separate step that can produce a PAPER order if the deterministic threshold is cleared.</p>
        </SectionHelp>
      </div>

      <div className="rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-500/10 via-gray-900 to-gray-950 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-violet-400" />
              <h3 className="text-white text-lg font-semibold">AI Council Agents</h3>
              <span className="text-[10px] px-2 py-1 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-300">
                ALL PROVIDERS
              </span>
            </div>
            <p className="text-gray-400 text-xs mt-2">
              NVIDIA models are added to the existing council. OmniRoute, Hermes, FreeLLM and Ollama remain active and visible.
            </p>
          </div>
          <button onClick={runNow} disabled={!!busy}
            className="px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/30 text-violet-300 disabled:opacity-40 text-xs flex items-center gap-2">
            <RefreshCw className={'w-3.5 h-3.5 ' + (busy === 'run' ? 'animate-spin' : '')} />
            Ask Full Council Now
          </button>
        </div>

        <SectionHelp title="How to read and use the AI agents">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <p><span className="text-gray-200 font-medium">CONNECTED</span> means the provider endpoint is reachable. It does not guarantee that every individual vote will finish before the council deadline.</p>
            <p><span className="text-gray-200 font-medium">Latest vote</span> is that model's independent LONG, SHORT or HOLD opinion for one asset, based only on the evidence supplied in that council round.</p>
            <p><span className="text-gray-200 font-medium">Confidence</span> is the model's self-reported confidence. Treat it as one input, not a probability of profit.</p>
            <p><span className="text-gray-200 font-medium">UNAVAILABLE</span> means the model timed out, rate-limited, or returned an unusable response. Its vote is excluded rather than fabricated.</p>
            <p><span className="text-gray-200 font-medium">How to use this</span> — compare disagreement. If several independent agents and machine strategies align, the council score grows; if they conflict, the system should often make no trade.</p>
            <p><span className="text-gray-200 font-medium">Ask Full Council Now</span> runs a fresh PAPER-only round using current market data and evidence so you can inspect each agent's reasoning side by side.</p>
          </div>
        </SectionHelp>

        <div className="mt-5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-emerald-300">NVIDIA MODELS</span>
            <span className="text-[10px] text-gray-600">4 independent hosted agents</span>
          </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mt-3">
          {nvidiaProviders.map((agent: any) => {
            const vote = agent.latest?.meta?.vote;
            const connected = agent.status === 'connected' && agent.healthy !== false;
            const voteOk = vote?.ok === true;
            return (
              <div key={agent.id} className="rounded-xl border border-gray-700 bg-gray-950/80 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-white text-sm font-semibold">{providerLabels[agent.id] || agent.label}</p>
                    <p className="text-emerald-300 text-[10px] mt-1">{providerRoles[agent.id]}</p>
                  </div>
                  <span className={'shrink-0 text-[9px] px-2 py-1 rounded-full border ' + (
                    connected
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      : 'border-red-500/30 bg-red-500/10 text-red-300'
                  )}>
                    {connected ? 'CONNECTED' : 'UNAVAILABLE'}
                  </span>
                </div>
                <p className="text-gray-600 text-[9px] mt-2 break-all">{agent.model || 'model unavailable'}</p>
                <div className="mt-4 rounded-lg border border-gray-800 bg-gray-900/80 p-3">
                  <p className="text-[9px] uppercase tracking-wide text-gray-600">Latest vote</p>
                  {agent.latest ? (
                    <>
                      <div className="flex items-center justify-between gap-2 mt-1.5">
                        <p className={'text-sm font-bold ' + (voteOk ? sideClass(vote.side) : 'text-red-300')}>
                          {voteOk ? vote.side + ' ' + vote.symbol : 'UNAVAILABLE'}
                        </p>
                        {voteOk && Number.isFinite(Number(vote.confidence)) && (
                          <span className="text-[10px] text-gray-500">{Math.round(Number(vote.confidence) * 100)}% confidence</span>
                        )}
                      </div>
                      <p className="text-gray-400 text-[10px] mt-2 leading-relaxed line-clamp-4">{agent.latest.message}</p>
                      <p className="text-gray-600 text-[9px] mt-2">{new Date(agent.latest.timestamp).toLocaleTimeString()}</p>
                    </>
                  ) : (
                    <p className="text-gray-500 text-xs mt-2">No council vote yet. Run the council to ask this model.</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        </div>

        <div className="mt-6 pt-5 border-t border-gray-800">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-cyan-300">EXISTING AI AGENTS</span>
            <span className="text-[10px] text-gray-600">kept active — not replaced</span>
          </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mt-3">
          {existingProviders.map((agent: any) => {
            const vote = agent.latest?.meta?.vote;
            const connected = agent.status === 'connected' && agent.healthy !== false;
            const voteOk = vote?.ok === true;
            return (
              <div key={agent.id} className="rounded-xl border border-gray-700 bg-gray-950/80 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-white text-sm font-semibold">{providerLabels[agent.id] || agent.label}</p>
                    <p className="text-cyan-300 text-[10px] mt-1">{providerRoles[agent.id]}</p>
                  </div>
                  <span className={'shrink-0 text-[9px] px-2 py-1 rounded-full border ' + (
                    connected
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      : 'border-red-500/30 bg-red-500/10 text-red-300'
                  )}>
                    {connected ? 'CONNECTED' : 'UNAVAILABLE'}
                  </span>
                </div>
                <p className="text-gray-600 text-[9px] mt-2 break-all">{agent.model || 'model unavailable'}</p>
                <div className="mt-4 rounded-lg border border-gray-800 bg-gray-900/80 p-3">
                  <p className="text-[9px] uppercase tracking-wide text-gray-600">Latest vote</p>
                  {agent.latest ? (
                    <>
                      <div className="flex items-center justify-between gap-2 mt-1.5">
                        <p className={'text-sm font-bold ' + (voteOk ? sideClass(vote.side) : 'text-red-300')}>
                          {voteOk ? vote.side + ' ' + vote.symbol : 'UNAVAILABLE'}
                        </p>
                        {voteOk && Number.isFinite(Number(vote.confidence)) && (
                          <span className="text-[10px] text-gray-500">{Math.round(Number(vote.confidence) * 100)}% confidence</span>
                        )}
                      </div>
                      <p className="text-gray-400 text-[10px] mt-2 leading-relaxed line-clamp-4">{agent.latest.message}</p>
                      <p className="text-gray-600 text-[9px] mt-2">{new Date(agent.latest.timestamp).toLocaleTimeString()}</p>
                    </>
                  ) : (
                    <p className="text-gray-500 text-xs mt-2">No council vote yet. Run the council to ask this model.</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Database className="w-4 h-4 text-violet-400" />
          <h3 className="text-white font-semibold">Strategy portfolios</h3>
          <span className="text-[10px] text-gray-500">Independent PAPER accounts · same starting capital</span>
        </div>

        <SectionHelp title="What each portfolio is · how to compare them">
          <div className="space-y-2">
            <p><span className="text-gray-200 font-medium">My Selected Strategy</span> follows whichever strategy you chose above. Use it as your personal benchmark without stopping the other comparison portfolios.</p>
            <p><span className="text-gray-200 font-medium">Council Auto</span> trades only when the combined AI + machine vote clears the deterministic action threshold.</p>
            <p><span className="text-gray-200 font-medium">ProChart portfolios</span> each follow one technical strategy independently — EMA Crossover, RSI Mean Reversion, MACD, Bollinger Reversion, or SuperTrend.</p>
            <p><span className="text-gray-200 font-medium">CABBAGE</span> follows the real CABBAGE RSI + EMA machine decision. <span className="text-gray-200 font-medium">Stonkfly</span> follows its actual connectome readout when one exists. <span className="text-gray-200 font-medium">24h Momentum</span> reacts to the strongest daily move among BTC, ETH and SOL.</p>
            <p><span className="text-gray-200 font-medium">Click any portfolio card</span> to make it the active portfolio for the chart and explanation panels below.</p>
            <p><span className="text-gray-200 font-medium">Equity</span> = current marked account value. <span className="text-gray-200 font-medium">P&L</span> = gain/loss versus starting capital. <span className="text-gray-200 font-medium">Win rate</span> = profitable closed trades / all closed trades. <span className="text-gray-200 font-medium">Drawdown</span> = decline from that portfolio's highest equity point.</p>
            <p><span className="text-gray-200 font-medium">How to use this</span> — compare returns together with drawdown and trade count. A portfolio with higher P&L but much deeper drawdown may be taking substantially more risk.</p>
          </div>
        </SectionHelp>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mt-3">
          {books.map((book: any) => {
            const selected = currentBook?.key === book.key;
            const pnl = Number(book.equity || 0) - Number(book.initialCapital || 0);
            return (
              <button
                key={book.key}
                onClick={() => {
                  setSelectedBook(book.key);
                  const p = book.positions?.[0];
                  if (p?.symbol) setSymbol(p.symbol);
                }}
                className={'text-left rounded-xl border p-4 transition ' + (
                  selected
                    ? 'border-cyan-500/50 bg-cyan-500/10'
                    : 'border-gray-700 bg-gray-800/40 hover:border-gray-600'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-white text-sm font-medium">{book.label}</p>
                    <p className="text-[10px] text-gray-500 mt-1">{book.positions?.length || 0} open · {book.tradeCount || 0} closed</p>
                  </div>
                  {book.key === 'council_auto' ? <Brain className="w-4 h-4 text-violet-400" /> :
                   book.key === 'cabbage' || book.key === 'stonkfly' ? <Bot className="w-4 h-4 text-amber-400" /> :
                   <CandlestickChart className="w-4 h-4 text-cyan-400" />}
                </div>
                <div className="grid grid-cols-2 gap-2 mt-4">
                  <div>
                    <p className="text-[10px] text-gray-500">Equity</p>
                    <p className="text-white text-sm font-semibold">{money(book.equity)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500">P&L</p>
                    <p className={(pnl >= 0 ? 'text-emerald-300' : 'text-red-300') + ' text-sm font-semibold'}>{money(pnl)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500">Win rate</p>
                    <p className="text-gray-300 text-xs">{pct(book.winRate || 0)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500">Drawdown</p>
                    <p className="text-gray-300 text-xs">{pct(book.drawdown || 0)}</p>
                  </div>
                </div>
                {book.lastDecision && (
                  <div className="mt-3 pt-3 border-t border-gray-800">
                    <p className={'text-xs font-medium ' + sideClass(book.lastDecision.side)}>{book.lastDecision.side} {book.lastDecision.symbol}</p>
                    <p className="text-[10px] text-gray-500 mt-1 line-clamp-2">{book.lastDecision.reason}</p>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,2fr)_minmax(360px,1fr)] gap-5">
        <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-white font-medium">{currentBook?.label || 'Portfolio'} · {symbol}USDT</p>
              <p className="text-gray-500 text-xs">Real Binance 1h candles · PAPER fills shown as chart markers · entry/stop/target lines when a position is open</p>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {chartSymbols.map(s => (
                <button key={s} onClick={() => setSymbol(s)}
                  className={'px-3 py-1.5 rounded-lg border text-xs ' + (
                    symbol === s ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300' : 'border-gray-700 bg-gray-950 text-gray-500'
                  )}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="px-4">
            <SectionHelp title="How to use the chart">
              <p><span className="text-gray-200 font-medium">Candles</span> are real Binance 1-hour OHLC data. <span className="text-gray-200 font-medium">Markers</span> show PAPER fills for the selected portfolio. Open positions also draw entry, stop-loss and take-profit levels.</p>
              <p className="mt-2"><span className="text-gray-200 font-medium">BTC / ETH / SOL buttons</span> change the asset shown without changing the selected portfolio. Use the chart to check whether the strategy entered near a breakout, reversal, trend continuation, or weak signal.</p>
              <p className="mt-2"><span className="text-gray-200 font-medium">Best use</span> — after a trade, compare the entry marker with the strategy reason and later price action. This helps you learn whether a strategy's logic matched what actually happened.</p>
            </SectionHelp>
          </div>
          <BrokerChart symbol={symbol} fills={fills} positions={positions} bookId={currentBook?.key || 'council_auto'} />
        </div>

        <div className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden flex flex-col min-h-[520px]">
          <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-400" />
              <div>
                <p className="text-white font-semibold text-sm">Live Council Room</p>
                <p className="text-gray-500 text-[10px]">Nemotron 3.5 · Nemotron 3 Ultra · GPT-OSS 20B · Gemma 4 31B · OmniRoute · Hermes · FreeLLM · Ollama · ProChart · CABBAGE · Stonkfly</p>
              </div>
            </div>
            <span className="text-[10px] text-gray-500">{room?.lastCouncilAt ? new Date(room.lastCouncilAt).toLocaleTimeString() : 'not run yet'}</span>
          </div>

          {council && (
            <div className="m-3 p-3 rounded-xl bg-violet-500/10 border border-violet-500/20">
              <div className="flex items-center justify-between gap-2">
                <p className="text-violet-200 text-xs font-semibold">Latest Council Decision</p>
                <span className={'text-xs font-bold ' + sideClass(council.side)}>
                  {council.side === 'HOLD' ? 'NO TRADE · ' + council.symbol : council.side + ' ' + council.symbol + ' · ' + council.leverage + '×'}
                </span>
              </div>
              <p className="text-gray-300 text-xs mt-2">{council.reason}</p>
              <p className="text-gray-500 text-[10px] mt-2">
                Action score {num(council.score)} · execution threshold ±{num(council.threshold ?? 1.6)} ·
                LONG {num(council.longWeight ?? 0)} · SHORT {num(council.shortWeight ?? 0)} · HOLD {num(council.holdWeight ?? 0)}
              </p>
            </div>
          )}

          <div className="px-3 pb-3">
            <SectionHelp title="How to read the council decision">
              <p><span className="text-gray-200 font-medium">Action score</span> is the signed sum of weighted LONG and SHORT support for the strongest asset. It is not a probability.</p>
              <p className="mt-2"><span className="text-gray-200 font-medium">Execution threshold</span> is the minimum absolute score required before Council Auto can open a PAPER trade. Below it, the correct result is NO TRADE.</p>
              <p className="mt-2"><span className="text-gray-200 font-medium">LONG / SHORT / HOLD weights</span> show how much evidence supported each stance. Use the transcript underneath to see exactly which agent or machine contributed each vote and why.</p>
            </SectionHelp>
          </div>

          <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2">
            {transcript.length === 0 && (
              <div className="h-full flex items-center justify-center text-xs text-gray-500 text-center px-8">
                Start the room or run a council round. Agent statements and machine votes will appear here before broker execution.
              </div>
            )}
            {transcript.slice(0, 80).map((msg: any) => (
              <div key={msg.id} className={'rounded-lg border p-3 ' + (
                msg.kind === 'decision' ? 'bg-violet-500/5 border-violet-500/20' :
                msg.kind === 'execution' ? 'bg-emerald-500/5 border-emerald-500/20' :
                msg.kind === 'agent' ? 'bg-cyan-500/5 border-cyan-500/10' :
                'bg-gray-950/60 border-gray-800'
              )}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] uppercase tracking-wide text-gray-400">{msg.speaker}</span>
                    {msg.meta?.provider && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-900 border border-gray-700 text-cyan-300 truncate">
                        {providerLabels[msg.meta.provider] || msg.meta.provider}
                      </span>
                    )}
                    {msg.meta?.vote?.ok && Number.isFinite(Number(msg.meta.vote.confidence)) && (
                      <span className="text-[9px] text-gray-600">
                        {Math.round(Number(msg.meta.vote.confidence) * 100)}% conf.
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-gray-600 shrink-0">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                </div>
                <p className="text-xs text-gray-300 mt-1.5">{msg.message}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_1fr] gap-5">
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <CandlestickChart className="w-4 h-4 text-cyan-400" />
                <h3 className="text-white font-semibold">ProChart strategy lab · {symbol}</h3>
              </div>
              <p className="text-gray-500 text-xs mt-1">Backtests come from your ProTradingView engine on live TradingView historical candles.</p>
            </div>
            <span className="text-[10px] text-gray-500">{room?.lastStrategyRefreshAt ? new Date(room.lastStrategyRefreshAt).toLocaleTimeString() : 'not refreshed'}</span>
          </div>
          <SectionHelp title="How to use the ProChart strategy lab">
            <p><span className="text-gray-200 font-medium">Signal</span> is the strategy's latest LONG, SHORT or HOLD output. <span className="text-gray-200 font-medium">Net</span> is backtest return over the tested range. <span className="text-gray-200 font-medium">Win</span> is winning-trade percentage.</p>
            <p className="mt-2"><span className="text-gray-200 font-medium">PF</span> means profit factor: gross profits divided by gross losses. Above 1 means historical profits exceeded losses; below 1 means the opposite. <span className="text-gray-200 font-medium">Max DD</span> is the deepest backtest drawdown.</p>
            <p className="mt-2"><span className="text-gray-200 font-medium">How to use this</span> — do not pick a strategy from one metric. Prefer combinations of positive net return, acceptable drawdown, enough trades, and a profit factor above 1; then compare its live PAPER portfolio over time.</p>
          </SectionHelp>
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-700">
                  <th className="text-left py-2 pr-3">Strategy</th>
                  <th className="text-right py-2 px-2">Signal</th>
                  <th className="text-right py-2 px-2">Net</th>
                  <th className="text-right py-2 px-2">Win</th>
                  <th className="text-right py-2 px-2">PF</th>
                  <th className="text-right py-2 pl-2">Max DD</th>
                </tr>
              </thead>
              <tbody>
                {strategiesForSymbol.map((row: any) => (
                  <tr key={row.strategy} className="border-b border-gray-800">
                    <td className="py-2.5 pr-3 text-gray-200">{row.label}</td>
                    <td className={'text-right py-2.5 px-2 font-semibold ' + (
                      Number(row.latestSignal) > 0 ? 'text-emerald-300' : Number(row.latestSignal) < 0 ? 'text-red-300' : 'text-gray-500'
                    )}>
                      {Number(row.latestSignal) > 0 ? 'LONG' : Number(row.latestSignal) < 0 ? 'SHORT' : 'HOLD'}
                    </td>
                    <td className={Number(row.netProfitPercent) >= 0 ? 'text-right py-2.5 px-2 text-emerald-300' : 'text-right py-2.5 px-2 text-red-300'}>
                      {num(row.netProfitPercent)}%
                    </td>
                    <td className="text-right py-2.5 px-2 text-gray-300">{num(row.winRate)}%</td>
                    <td className="text-right py-2.5 px-2 text-gray-300">{row.profitFactor == null ? '—' : num(row.profitFactor)}</td>
                    <td className="text-right py-2.5 pl-2 text-red-300">{num(row.maxDrawdownPercent)}%</td>
                  </tr>
                ))}
                {strategiesForSymbol.length === 0 && (
                  <tr><td colSpan={6} className="py-8 text-center text-gray-500">Run the room to fetch ProChart strategy results.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-violet-400" />
            <h3 className="text-white font-semibold">Why this portfolio traded</h3>
          </div>
          <SectionHelp title="How to use this explanation">
            <p>This panel explains the most recent decision for the portfolio you clicked above. <span className="text-gray-200 font-medium">Strategy</span> tells you the decision rule; <span className="text-gray-200 font-medium">Source</span> tells you which engine or agent produced it.</p>
            <p className="mt-2">Use this together with the chart and ledger: first read the thesis, then inspect the entry on the real candles, then watch whether stop/target and later P&amp;L support or contradict the original reasoning.</p>
          </SectionHelp>
          {currentBook?.lastDecision ? (
            <div className="mt-4">
              <div className="flex items-center gap-2">
                {currentBook.lastDecision.side === 'LONG' ? <TrendingUp className="w-4 h-4 text-emerald-400" /> :
                 currentBook.lastDecision.side === 'SHORT' ? <TrendingDown className="w-4 h-4 text-red-400" /> :
                 <Shield className="w-4 h-4 text-gray-500" />}
                <span className={'font-semibold ' + sideClass(currentBook.lastDecision.side)}>
                  {currentBook.lastDecision.side} {currentBook.lastDecision.symbol}
                </span>
                <span className="text-amber-300 text-xs">{currentBook.lastDecision.leverage || room?.leverage || 1}× max</span>
              </div>
              <p className="text-gray-300 text-sm mt-3">{currentBook.lastDecision.reason}</p>
              <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
                <div className="bg-gray-950/70 rounded-lg p-3">
                  <p className="text-gray-500">Strategy</p>
                  <p className="text-gray-200 mt-1">{currentBook.lastDecision.strategy || currentBook.label}</p>
                </div>
                <div className="bg-gray-950/70 rounded-lg p-3">
                  <p className="text-gray-500">Source</p>
                  <p className="text-gray-200 mt-1">{currentBook.lastDecision.source || currentBook.key}</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-gray-500 text-sm mt-4">This strategy portfolio has not opened a trade yet. When it does, the reason and source will be stored here and in the broker ledger.</p>
          )}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Newspaper className="w-4 h-4 text-amber-400" />
          <h3 className="text-white font-semibold">Evidence rooms</h3>
          <span className="text-[10px] text-gray-500">Context for the AI agents · not copied blindly into trades</span>
        </div>

        <SectionHelp title="What each evidence room is · how to use it">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <p><span className="text-gray-200 font-medium">Polymarket</span> shows market-implied probabilities for relevant macro/crypto events. Treat them as crowd pricing, not facts.</p>
            <p><span className="text-gray-200 font-medium">Crypto News</span> supplies current headlines that may explain volatility or new catalysts.</p>
            <p><span className="text-gray-200 font-medium">Macro</span> surfaces inflation, rates, recession and central-bank context that can affect risk assets.</p>
            <p><span className="text-gray-200 font-medium">Research</span> adds analytical/outlook material that agents can contrast with short-term signals.</p>
            <p><span className="text-gray-200 font-medium">DefiLlama</span> contributes on-chain/protocol activity such as fee trends.</p>
            <p><span className="text-gray-200 font-medium">CABBAGE / Stonkfly</span> expose machine-state evidence from the connected strategy engines.</p>
          </div>
          <p className="mt-2"><span className="text-gray-200 font-medium">How to use this</span> — open the evidence rooms when an AI gives a surprising vote. Check whether its thesis is actually supported by current evidence instead of trusting the model label.</p>
        </SectionHelp>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3 mt-3">
          {evidenceRooms.map((evidence: any) => (
            <div key={evidence.source} className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 min-h-[170px]">
              <div className="flex items-center justify-between gap-2">
                <p className="text-white text-sm font-medium">{evidence.source}</p>
                <span className="text-[9px] uppercase text-gray-600">{evidence.kind}</span>
              </div>
              {evidence.error && <p className="text-red-400 text-[10px] mt-2">{evidence.error}</p>}
              <div className="space-y-2 mt-3 max-h-[210px] overflow-y-auto">
                {(evidence.items || []).slice(0, 8).map((item: any, index: number) => (
                  <div key={index} className="bg-gray-950/60 rounded-lg p-2.5">
                    {evidence.source === 'Polymarket' ? (
                      <>
                        <p className="text-gray-300 text-[11px] leading-relaxed">{item.question}</p>
                        <p className="text-cyan-300 text-[10px] mt-1">
                          {(item.outcomes || []).map((o: any) => o.label + ' ' + Math.round(Number(o.probability) * 100) + '%').join(' · ')}
                        </p>
                      </>
                    ) : ['news','macro','research'].includes(evidence.kind) ? (
                      <>
                        <p className="text-gray-300 text-[11px] leading-relaxed">{item.title}</p>
                        <p className="text-gray-600 text-[9px] mt-1">{item.source || item.publishedAt}</p>
                      </>
                    ) : evidence.source === 'DefiLlama' ? (
                      <>
                        <p className="text-gray-300 text-[11px]">{item.title}</p>
                        <p className="text-gray-500 text-[10px] mt-1">24h {money(item.total24h)} · 7d {money(item.total7d)}</p>
                      </>
                    ) : (
                      <>
                        <p className="text-gray-300 text-[11px]">{item.status || item.reason || 'Machine state'}</p>
                        {item.latest?.action && <p className="text-cyan-300 text-[10px] mt-1">Latest {item.latest.action}</p>}
                      </>
                    )}
                  </div>
                ))}
                {(!evidence.items || evidence.items.length === 0) && !evidence.error && (
                  <p className="text-gray-600 text-[11px]">No current items.</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.4fr] gap-5">
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              <p className="text-white font-semibold text-sm">Open positions</p>
            </div>
            <p className="text-gray-500 text-[10px] mt-1">Broker-style open positions across every strategy portfolio.</p>
            <SectionHelp title="How to read open positions">
              <p><span className="text-gray-200 font-medium">Side</span> is LONG or SHORT. <span className="text-gray-200 font-medium">Lev</span> is simulated leverage. <span className="text-gray-200 font-medium">Margin</span> is PAPER capital committed to the position. <span className="text-gray-200 font-medium">P&amp;L</span> is the current unrealized gain/loss.</p>
              <p className="mt-2">Use this table to compare live exposure across strategies. A strategy can look good on equity while carrying a large open risk, so always inspect positions together with drawdown and leverage.</p>
            </SectionHelp>
          </div>
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-900">
                <tr className="text-gray-500 border-b border-gray-800">
                  <th className="text-left px-3 py-2">Portfolio</th>
                  <th className="text-left px-3 py-2">Asset</th>
                  <th className="text-left px-3 py-2">Side</th>
                  <th className="text-right px-3 py-2">Lev</th>
                  <th className="text-right px-3 py-2">Margin</th>
                  <th className="text-right px-3 py-2">P&L</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p: any) => (
                  <tr key={p.id} className="border-b border-gray-800/70">
                    <td className="px-3 py-2.5 text-gray-300">{p.bookLabel}</td>
                    <td className="px-3 py-2.5 text-white">{p.symbol}</td>
                    <td className={'px-3 py-2.5 font-semibold ' + sideClass(p.direction)}>{p.direction}</td>
                    <td className="px-3 py-2.5 text-right text-amber-300">{p.leverage}×</td>
                    <td className="px-3 py-2.5 text-right text-gray-300">{money(p.margin)}</td>
                    <td className={(Number(p.unrealizedPnl) >= 0 ? 'text-emerald-300' : 'text-red-300') + ' px-3 py-2.5 text-right'}>
                      {money(p.unrealizedPnl)}
                    </td>
                  </tr>
                ))}
                {positions.length === 0 && (
                  <tr><td colSpan={6} className="py-10 text-center text-gray-500">No open PAPER positions yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Clock3 className="w-4 h-4 text-cyan-400" />
                  <p className="text-white font-semibold text-sm">Paper broker ledger</p>
                </div>
                <p className="text-gray-500 text-[10px] mt-1">Every strategy/council order is stored with portfolio, side, leverage, size, status and reason.</p>
              </div>
              <span className="text-[10px] text-gray-500">{recentOrders.length} retained</span>
            </div>
            <SectionHelp title="How to read the broker ledger">
              <p><span className="text-gray-200 font-medium">Order</span> shows OPEN/CLOSE plus LONG/SHORT. <span className="text-gray-200 font-medium">Notional</span> is total simulated market exposure after leverage. <span className="text-gray-200 font-medium">Status</span> confirms whether the PAPER order was filled.</p>
              <p className="mt-2">Use the ledger as the audit trail. When an agent or strategy claims something happened, verify the actual PAPER order here and then find its fill marker on the chart.</p>
            </SectionHelp>
          </div>
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-900">
                <tr className="text-gray-500 border-b border-gray-800">
                  <th className="text-left px-3 py-2">Time</th>
                  <th className="text-left px-3 py-2">Portfolio</th>
                  <th className="text-left px-3 py-2">Order</th>
                  <th className="text-right px-3 py-2">Lev</th>
                  <th className="text-right px-3 py-2">Notional</th>
                  <th className="text-left px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.slice(0, 120).map((order: any) => (
                  <tr key={order.id} className="border-b border-gray-800/70" title={order.reason || ''}>
                    <td className="px-3 py-2.5 text-gray-500">{new Date(order.timestamp).toLocaleTimeString()}</td>
                    <td className="px-3 py-2.5 text-gray-300">{order.bookLabel}</td>
                    <td className="px-3 py-2.5">
                      <span className={order.positionSide === 'LONG' ? 'text-emerald-300' : 'text-red-300'}>
                        {order.action} {order.positionSide}
                      </span>
                      <span className="text-gray-500"> {order.symbol}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-amber-300">{order.leverage || '—'}×</td>
                    <td className="px-3 py-2.5 text-right text-gray-300">{money(order.notional)}</td>
                    <td className="px-3 py-2.5 text-emerald-300">{order.status}</td>
                  </tr>
                ))}
                {recentOrders.length === 0 && (
                  <tr><td colSpan={6} className="py-10 text-center text-gray-500">No broker orders yet. Start the Investment Room to begin recording PAPER activity.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <h3 className="text-white font-semibold">How to learn from what the agents are doing</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
          {[
            ['1', 'Watch the council', 'Read how Nemotron 3.5, Nemotron 3 Ultra, GPT-OSS 20B, Gemma 4 31B, OmniRoute, Hermes, FreeLLM, Ollama, CABBAGE, Stonkfly and ProChart agree or disagree.'],
            ['2', 'Inspect the chart', 'Every PAPER fill is marked on real candles. Open positions also show entry, stop and target levels.'],
            ['3', 'Compare portfolios', 'Each strategy has the same starting capital, so equity, drawdown and win rate can be compared over time.'],
            ['4', 'Read the ledger', 'Every simulated order is recorded like a broker statement, including the strategy and reason that caused it.'],
          ].map(([n, title, copy]) => (
            <div key={n} className="bg-gray-950/60 border border-gray-800 rounded-xl p-4">
              <div className="w-7 h-7 rounded-full bg-emerald-500/10 text-emerald-300 flex items-center justify-center text-xs font-bold">{n}</div>
              <p className="text-white text-sm font-medium mt-3">{title}</p>
              <p className="text-gray-500 text-xs mt-1">{copy}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
