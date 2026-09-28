import React, { useEffect, useMemo, useState } from 'react';
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

export default function InvestmentRoom() {
  const [room, setRoom] = useState<any>(null);
  const [aiProviders, setAiProviders] = useState<any[]>([]);
  const [capital, setCapital] = useState(1000);
  const [leverage, setLeverage] = useState(2);
  const [selectedBook, setSelectedBook] = useState('council_auto');
  const [symbol, setSymbol] = useState('BTC');
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
  const nvidiaProviders = nvidiaProviderIds.map(id => {
    const provider = aiProviders.find((item: any) => item.id === id) || { id, status: 'unknown', healthy: false, model: '' };
    const latest = transcript.find((msg: any) => msg.kind === 'agent' && msg.meta?.provider === id);
    return { ...provider, latest };
  });

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
      </div>

      <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-gray-900 to-gray-950 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-emerald-400" />
              <h3 className="text-white text-lg font-semibold">NVIDIA AI Council Agents</h3>
              <span className="text-[10px] px-2 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                LIVE PROVIDERS
              </span>
            </div>
            <p className="text-gray-400 text-xs mt-2">
              These are four separate NVIDIA-hosted models. Each casts its own investment vote; unavailable models are excluded from the council score.
            </p>
          </div>
          <button onClick={runNow} disabled={!!busy}
            className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 disabled:opacity-40 text-xs flex items-center gap-2">
            <RefreshCw className={'w-3.5 h-3.5 ' + (busy === 'run' ? 'animate-spin' : '')} />
            Ask NVIDIA + Council Now
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mt-4">
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

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Database className="w-4 h-4 text-violet-400" />
          <h3 className="text-white font-semibold">Strategy portfolios</h3>
          <span className="text-[10px] text-gray-500">Independent PAPER accounts · same starting capital</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
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
            <div className="flex items-center gap-1.5">
              {['BTC','ETH','SOL'].map(s => (
                <button key={s} onClick={() => setSymbol(s)}
                  className={'px-3 py-1.5 rounded-lg border text-xs ' + (
                    symbol === s ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300' : 'border-gray-700 bg-gray-950 text-gray-500'
                  )}>
                  {s}
                </button>
              ))}
            </div>
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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
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
          <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Clock3 className="w-4 h-4 text-cyan-400" />
                <p className="text-white font-semibold text-sm">Paper broker ledger</p>
              </div>
              <p className="text-gray-500 text-[10px] mt-1">Every strategy/council order is stored with portfolio, side, leverage, size, status and reason.</p>
            </div>
            <span className="text-[10px] text-gray-500">{recentOrders.length} retained</span>
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
