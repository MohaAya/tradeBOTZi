import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bot, CheckCircle2, Lock, Pause, Play, RefreshCw, Shield, TrendingDown, TrendingUp } from 'lucide-react';

const riskCopy: Record<string, { title: string; copy: string }> = {
  conservative: { title: 'Conservative', copy: '1× leverage, fewer positions, wider safety margin.' },
  balanced: { title: 'Balanced', copy: 'Up to 2× leverage with moderate position sizing.' },
  aggressive: { title: 'Aggressive', copy: 'Up to 3× leverage. Faster gains and faster losses.' },
};

export default function BeginnerInvest() {
  const [demo, setDemo] = useState<any>(null);
  const [proposals, setProposals] = useState<any[]>([]);
  const [capital, setCapital] = useState(1000);
  const [riskLevel, setRiskLevel] = useState('balanced');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [permissionPhrase, setPermissionPhrase] = useState('');

  const refresh = async () => {
    try {
      const [stateRes, proposalRes] = await Promise.all([
        fetch('/api/demo/state', { cache: 'no-store' }),
        fetch('/api/demo/proposals', { cache: 'no-store' }),
      ]);
      const stateData = await stateRes.json();
      const proposalData = await proposalRes.json();
      if (stateRes.ok && stateData.ok) setDemo(stateData.demo);
      if (proposalRes.ok && proposalData.ok) setProposals(proposalData.proposals || []);
    } catch {}
  };

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, []);

  const post = async (url: string, body: any = {}) => {
    setError('');
    setMessage('');
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Action failed');
    await refresh();
    return data;
  };

  const start = async (resetAccount = false) => {
    setBusy('start');
    try {
      await post('/api/demo/start', { capital, riskLevel, resetAccount });
      setMessage('Demo Autopilot is running. It may open PAPER long or short positions when the demo signal threshold is met.');
    } catch (e: any) { setError(e.message); }
    finally { setBusy(''); }
  };

  const stop = async () => {
    setBusy('stop');
    try {
      await post('/api/demo/stop');
      setMessage('Autopilot paused. Existing PAPER positions continue to be marked and protected by their exits.');
    } catch (e: any) { setError(e.message); }
    finally { setBusy(''); }
  };

  const scanNow = async () => {
    setBusy('scan');
    try {
      await post('/api/demo/run');
      setMessage('The bot scanned the market and updated its PAPER positions.');
    } catch (e: any) { setError(e.message); }
    finally { setBusy(''); }
  };
  const openProposal = async (proposal: any) => {
    if (proposal.direction === 'HOLD') return;
    setBusy('open-' + proposal.symbol);
    try {
      await post('/api/demo/open', {
        symbol: proposal.symbol,
        direction: proposal.direction,
        leverage: proposal.leverage,
        source: 'beginner_manual',
        reason: proposal.reason,
      });
      setMessage('Opened a PAPER ' + proposal.direction + ' on ' + proposal.symbol + ' at ' + proposal.leverage + '× leverage.');
    } catch (e: any) { setError(e.message); }
    finally { setBusy(''); }
  };

  const closePosition = async (position: any) => {
    setBusy('close-' + position.id);
    try {
      await post('/api/demo/positions/' + encodeURIComponent(position.id) + '/close', { reason: 'manual_beginner_close' });
      setMessage('Closed the PAPER ' + position.direction + ' on ' + position.symbol + '.');
    } catch (e: any) { setError(e.message); }
    finally { setBusy(''); }
  };

  const recordPermission = async () => {
    setBusy('permission');
    try {
      await post('/api/demo/live-permission', { phrase: permissionPhrase });
      setMessage('Your live-trading intent was recorded, but real-money execution remains locked until a broker/exchange is connected and separately activated.');
      setPermissionPhrase('');
    } catch (e: any) { setError(e.message); }
    finally { setBusy(''); }
  };

  const money = (value: any) => {
    const n = Number(value);
    return Number.isFinite(n)
      ? new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n)
      : '—';
  };
  const price = (value: any) => {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—';
  };
  const percent = (value: any, multiplier = 100) => {
    const n = Number(value);
    return Number.isFinite(n) ? (n * multiplier).toFixed(1) + '%' : '—';
  };

  const account = demo?.account;
  const positions = demo?.positions || [];
  const training = demo?.training;
  const autopilot = demo?.autopilot;
  const topIdeas = useMemo(() => proposals.slice(0, 6), [proposals]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Invest / Demo</h2>
        <p className="text-gray-400 text-sm mt-1">Beginner mode: the bot can open and manage simulated LONG and SHORT trades. No real money is used.</p>
      </div>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>}
      {message && <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-300">{message}</div>}

      <div className="bg-gradient-to-br from-gray-800/80 to-gray-900 border border-gray-700 rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-emerald-400" />
              <h3 className="text-white text-lg font-semibold">Demo Autopilot</h3>
              <span className={'text-[10px] px-2 py-1 rounded-full border ' + (autopilot?.enabled ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' : 'text-gray-400 border-gray-700 bg-gray-900')}>
                {autopilot?.enabled ? 'RUNNING' : 'PAUSED'}
              </span>
            </div>
            <p className="text-gray-400 text-sm mt-2 max-w-2xl">Give it demo capital and a risk level. It scans liquid crypto markets and can simulate LONG or SHORT positions with leverage, stops and profit targets.</p>
          </div>
          {account && (
            <div className="text-right">
              <p className="text-gray-500 text-xs">PAPER equity</p>
              <p className="text-white text-xl font-bold">{money(account.equity)}</p>
              <p className={Number(account.realizedPnl) >= 0 ? 'text-emerald-400 text-xs' : 'text-red-400 text-xs'}>Realized {money(account.realizedPnl)}</p>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
          <div>
            <label className="text-xs text-gray-400">Demo capital</label>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-gray-500">$</span>
              <input type="number" min={100} step={100} value={capital} onChange={e => setCapital(Number(e.target.value))}
                className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white outline-none focus:border-emerald-500/50" />
            </div>
          </div>
          <div className="lg:col-span-2">
            <label className="text-xs text-gray-400">Risk level</label>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {Object.entries(riskCopy).map(([id, item]) => (
                <button key={id} onClick={() => setRiskLevel(id)}
                  className={'text-left p-3 rounded-xl border transition ' + (riskLevel === id ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-gray-700 bg-gray-950 hover:border-gray-600')}>
                  <p className="text-white text-sm font-medium">{item.title}</p>
                  <p className="text-gray-500 text-[11px] mt-1">{item.copy}</p>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-5">
          {!autopilot?.enabled ? (
            <button onClick={() => start(!account)} disabled={!!busy}
              className="px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium flex items-center gap-2">
              <Play className="w-4 h-4" /> {account ? 'Start Autopilot' : 'Start Demo Investing'}
            </button>
          ) : (
            <button onClick={stop} disabled={!!busy}
              className="px-4 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm flex items-center gap-2">
              <Pause className="w-4 h-4" /> Pause Autopilot
            </button>
          )}
          <button onClick={scanNow} disabled={!!busy || !account}
            className="px-4 py-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 disabled:opacity-40 text-sm flex items-center gap-2">
            <RefreshCw className={'w-4 h-4 ' + (busy === 'scan' ? 'animate-spin' : '')} /> Scan Now
          </button>
        </div>
      </div>

      {account && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            ['Cash available', money(account.cash)],
            ['Open P&L', money(account.unrealizedPnl)],
            ['Realized P&L', money(account.realizedPnl)],
            ['Open positions', String(positions.length)],
            ['Drawdown', percent(account.drawdown)],
          ].map(([label, value]) => (
            <div key={label} className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
              <p className="text-gray-500 text-xs">{label}</p>
              <p className="text-white font-semibold mt-1">{value}</p>
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-white font-semibold">What the bot sees now</h3>
              <p className="text-gray-500 text-xs mt-1">Demo ideas from current 24h momentum. You can paper-trade one manually or let Autopilot act.</p>
            </div>
            <span className="text-[10px] text-gray-500">PAPER SIGNALS</span>
          </div>
          <div className="space-y-3 mt-4">
            {topIdeas.map(idea => (
              <div key={idea.symbol} className="bg-gray-950/70 border border-gray-800 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      {idea.direction === 'LONG' ? <TrendingUp className="w-4 h-4 text-emerald-400" /> :
                       idea.direction === 'SHORT' ? <TrendingDown className="w-4 h-4 text-red-400" /> :
                       <Shield className="w-4 h-4 text-gray-500" />}
                      <p className="text-white font-semibold">{idea.symbol}</p>
                      <span className={'text-[10px] px-2 py-0.5 rounded ' + (
                        idea.direction === 'LONG' ? 'bg-emerald-500/10 text-emerald-300' :
                        idea.direction === 'SHORT' ? 'bg-red-500/10 text-red-300' :
                        'bg-gray-800 text-gray-400'
                      )}>{idea.direction}</span>
                    </div>
                    <p className="text-gray-500 text-xs mt-1">{idea.reason}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-white text-sm">{price(idea.price)}</p>
                    <p className={idea.change24h >= 0 ? 'text-emerald-400 text-xs' : 'text-red-400 text-xs'}>
                      {idea.change24h >= 0 ? '+' : ''}{Number(idea.change24h).toFixed(2)}%
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 mt-3">
                  <p className="text-gray-500 text-[11px]">{idea.direction === 'HOLD' ? 'No trade suggested' : idea.leverage + '× demo leverage'}</p>
                  {idea.direction !== 'HOLD' && (
                    <button onClick={() => openProposal(idea)} disabled={!!busy || positions.some((p: any) => p.symbol === idea.symbol)}
                      className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-xs text-white">
                      Paper {idea.direction} {idea.leverage}×
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
          <h3 className="text-white font-semibold">Open PAPER positions</h3>
          <p className="text-gray-500 text-xs mt-1">These are simulated leveraged positions. The engine checks stops and profit targets every 15 seconds.</p>
          <div className="space-y-3 mt-4">
            {positions.length === 0 && (
              <div className="border border-dashed border-gray-700 rounded-xl p-8 text-center text-sm text-gray-500">
                No open PAPER positions yet.
              </div>
            )}
            {positions.map((position: any) => {
              const pnl = Number(position.unrealizedPnl || 0);
              return (
                <div key={position.id} className="bg-gray-950/70 border border-gray-800 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        {position.direction === 'LONG' ? <TrendingUp className="w-4 h-4 text-emerald-400" /> : <TrendingDown className="w-4 h-4 text-red-400" />}
                        <p className="text-white font-semibold">{position.symbol}</p>
                        <span className={position.direction === 'LONG' ? 'text-emerald-300 text-xs' : 'text-red-300 text-xs'}>{position.direction}</span>
                        <span className="text-amber-300 text-xs">{position.leverage}×</span>
                      </div>
                      <p className="text-gray-500 text-[11px] mt-1">{position.reason || position.source}</p>
                    </div>
                    <p className={pnl >= 0 ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>{money(pnl)}</p>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-xs">
                    <div><p className="text-gray-500">Margin</p><p className="text-white">{money(position.margin)}</p></div>
                    <div><p className="text-gray-500">Exposure</p><p className="text-white">{money(position.notional)}</p></div>
                    <div><p className="text-gray-500">Entry</p><p className="text-white">{price(position.entryPrice)}</p></div>
                    <div><p className="text-gray-500">Now</p><p className="text-white">{price(position.currentPrice)}</p></div>
                    <div><p className="text-gray-500">Stop loss</p><p className="text-red-300">{price(position.stopLossPrice)}</p></div>
                    <div><p className="text-gray-500">Take profit</p><p className="text-emerald-300">{price(position.takeProfitPrice)}</p></div>
                    <div><p className="text-gray-500">Est. liquidation</p><p className="text-amber-300">{price(position.liquidationPriceEstimate)}</p></div>
                    <div><p className="text-gray-500">Opened</p><p className="text-gray-300">{new Date(position.openedAt).toLocaleTimeString()}</p></div>
                  </div>
                  <button onClick={() => closePosition(position)} disabled={!!busy}
                    className="mt-4 px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-900 hover:bg-gray-800 text-xs text-gray-300">
                    Close PAPER position
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-white font-semibold">Training / PAPER track record</h3>
              <p className="text-gray-500 text-xs mt-1">The bot earns a track record from closed demo trades. This is evidence, not a promise of live performance.</p>
            </div>
            <span className="text-emerald-300 font-semibold">{training?.readinessScore ?? 0}/100</span>
          </div>
          <div className="w-full h-2 bg-gray-900 rounded-full overflow-hidden mt-4">
            <div className="h-full bg-emerald-500" style={{ width: Math.max(0, Math.min(100, training?.readinessScore || 0)) + '%' }} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-xs">
            <div><p className="text-gray-500">Closed trades</p><p className="text-white">{training?.sampleSize ?? 0} / {training?.targetSampleSize ?? 30}</p></div>
            <div><p className="text-gray-500">Win rate</p><p className="text-white">{percent(training?.winRate)}</p></div>
            <div><p className="text-gray-500">Net P&L</p><p className="text-white">{money(training?.netPnl)}</p></div>
            <div><p className="text-gray-500">Avg / trade</p><p className="text-white">{money(training?.expectancyPerTrade)}</p></div>
          </div>
          <p className="text-gray-500 text-[11px] mt-4">{training?.note}</p>
        </div>

        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-400" />
            <h3 className="text-white font-semibold">Real market</h3>
            <span className="text-[10px] px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20 text-amber-300">LOCKED</span>
          </div>
          <p className="text-gray-400 text-sm mt-3">
            The real-money path is intentionally separate from Demo. A PAPER score never turns live trading on automatically.
          </p>
          <div className="space-y-2 mt-4">
            {(demo?.live?.blockers || []).map((item: string) => (
              <div key={item} className="flex items-start gap-2 text-xs text-gray-400">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-amber-400 shrink-0" />
                <span>{item}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 rounded-lg bg-gray-950 border border-gray-800">
            <p className="text-gray-400 text-xs">Permission gate</p>
            <p className="text-gray-600 text-[11px] mt-1">Type the exact phrase below only when you want your intent recorded. This still does not enable live orders.</p>
            <code className="block text-[11px] text-amber-300 mt-2">I UNDERSTAND LIVE TRADING USES REAL MONEY</code>
            <div className="flex gap-2 mt-3">
              <input value={permissionPhrase} onChange={e => setPermissionPhrase(e.target.value)}
                placeholder="Type the permission phrase"
                className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white outline-none" />
              <button onClick={recordPermission} disabled={busy === 'permission' || !permissionPhrase}
                className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 disabled:opacity-40 text-xs">
                Record intent
              </button>
            </div>
            {demo?.live?.userPermissionRecorded && (
              <div className="flex items-center gap-2 mt-3 text-xs text-emerald-300">
                <CheckCircle2 className="w-4 h-4" /> Intent recorded. Live execution is still OFF.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-white font-semibold">How to use this if you are new</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4 text-sm">
          {[
            ['1', 'Pick demo capital', 'Use money you are comfortable pretending to risk. It is simulated.'],
            ['2', 'Choose risk', 'Conservative uses 1×. Balanced can use 2×. Aggressive can use 3×.'],
            ['3', 'Let it trade', 'Autopilot can open LONG or SHORT PAPER positions and manage exits.'],
            ['4', 'Judge the track record', 'Watch closed trades, drawdown and expectancy before even considering a live connection.'],
          ].map(([n, title, copy]) => (
            <div key={n} className="bg-gray-950/60 border border-gray-800 rounded-xl p-4">
              <div className="w-7 h-7 rounded-full bg-emerald-500/10 text-emerald-300 flex items-center justify-center text-xs font-bold">{n}</div>
              <p className="text-white font-medium mt-3">{title}</p>
              <p className="text-gray-500 text-xs mt-1">{copy}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
