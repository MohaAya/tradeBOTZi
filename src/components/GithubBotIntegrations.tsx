import React, { useEffect, useState } from 'react';
import { Bot, CheckCircle2, ExternalLink, Loader2, Play, RefreshCw } from 'lucide-react';

type Props = {
  onAskAgent: (prompt: string) => void;
};

export default function GithubBotIntegrations({ onAskAgent }: Props) {
  const [bots, setBots] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<string | null>('cabbage');
  const [jobs, setJobs] = useState<Record<string, any>>({});

  const refresh = async () => {
    try {
      const response = await fetch('/api/bot-integrations', { cache: 'no-store' });
      const data = await response.json();
      if (response.ok && data.ok && Array.isArray(data.bots)) setBots(data.bots);
    } catch {}
  };

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, []);

  const runAction = async (botId: string, action: string) => {
    const response = await fetch('/api/bots/' + botId + '/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Bot action failed');
    const jobId = data.job.jobId;
    setJobs(prev => ({ ...prev, [botId]: data.job }));
    const deadline = Date.now() + 300000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1200));
      const poll = await fetch('/api/bots/jobs/' + encodeURIComponent(jobId), { cache: 'no-store' });
      const jobData = await poll.json();
      if (!poll.ok || !jobData.ok) throw new Error(jobData.error || 'Bot job polling failed');
      const job = jobData.job;
      setJobs(prev => ({ ...prev, [botId]: job }));
      if (job.status === 'done') {
        await refresh();
        return;
      }
      if (job.status === 'error') throw new Error(job.error || 'Bot action failed');
    }
    throw new Error('Bot action timed out');
  };

  const money = (value: any, currency = 'EUR') => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n);
  };
  const number = (value: any, digits = 2) => {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(digits) : '—';
  };

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-white font-semibold">GitHub Bot Integrations</h3>
          <p className="text-gray-500 text-xs mt-1">Real external runtimes. Status and output come from the bot adapters, not UI labels.</p>
        </div>
        <span className="text-[10px] px-2 py-1 rounded bg-gray-900 border border-gray-700 text-gray-400">{bots.length} sources</span>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {bots.map(bot => {
          const active = bot.runtimeStatus === 'RUNNING';
          const blocked = bot.runtimeStatus === 'RESOURCE_BLOCKED';
          const job = jobs[bot.id];
          const busy = job?.status === 'pending' || job?.status === 'running';
          const isOpen = expanded === bot.id;
          return (
            <div key={bot.id} className="bg-gray-950/60 border border-gray-700 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Bot className="w-4 h-4 text-cyan-400" />
                    <h4 className="text-white font-medium">{bot.name}</h4>
                  </div>
                  <p className="text-gray-500 text-[11px] mt-1">{bot.repository}</p>
                </div>
                <span className={'text-[10px] px-2 py-1 rounded border ' + (
                  active ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' :
                  blocked ? 'bg-amber-500/10 border-amber-500/20 text-amber-300' :
                  'bg-gray-800 border-gray-700 text-gray-300'
                )}>{bot.runtimeStatus}</span>
              </div>
              <p className="text-gray-300 text-xs mt-3">{bot.description}</p>
              <div className="grid grid-cols-2 gap-2 mt-3 text-[11px]">
                <div className="bg-gray-900 rounded p-2">
                  <p className="text-gray-500">Source</p>
                  <p className={bot.sourceConnected ? 'text-emerald-300' : 'text-red-300'}>{bot.sourceConnected ? 'CONNECTED' : 'MISSING'}</p>
                </div>
                <div className="bg-gray-900 rounded p-2">
                  <p className="text-gray-500">Execution</p>
                  <p className="text-amber-300">{bot.executionMode}</p>
                </div>
              </div>
              {bot.id === 'cabbage' && (
                <div className="flex flex-wrap gap-2 mt-4">
                  <button onClick={() => setExpanded(isOpen ? null : bot.id)}
                    className="px-3 py-2 text-xs rounded-lg bg-gray-800 border border-gray-700 text-gray-200 hover:text-white">
                    {isOpen ? 'Close Bot' : 'Open Bot'}
                  </button>
                  <button onClick={() => runAction(bot.id, 'run_once')} disabled={busy || !bot.runtimeReady}
                    className="px-3 py-2 text-xs rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 disabled:opacity-40 flex items-center gap-1.5">
                    {busy && job?.action === 'run_once' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Run Now
                  </button>
                  <button onClick={() => runAction(bot.id, 'backtest')} disabled={busy || !bot.runtimeReady}
                    className="px-3 py-2 text-xs rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 disabled:opacity-40 flex items-center gap-1.5">
                    {busy && job?.action === 'backtest' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    Backtest
                  </button>
                  <button onClick={() => onAskAgent('Ask CABBAGE for its current BTC/EUR signal, decision trace, indicators, PAPER portfolio state and latest trades. Explain what the actual bot output means. Do not invent missing data.')}
                    className="px-3 py-2 text-xs rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-300">
                    Ask AI to Explain
                  </button>
                </div>
              )}

              {job && (
                <div className={'mt-3 rounded-lg border p-3 text-xs ' + (
                  job.status === 'done' ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-200' :
                  job.status === 'error' ? 'bg-red-500/5 border-red-500/20 text-red-300' :
                  'bg-cyan-500/5 border-cyan-500/20 text-cyan-200'
                )}>
                  <div className="flex items-center gap-2">
                    {(job.status === 'pending' || job.status === 'running') && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {job.status === 'done' && <CheckCircle2 className="w-3.5 h-3.5" />}
                    <span>{job.action} · {job.status}</span>
                  </div>
                  {job.error && <p className="mt-1">{job.error}</p>}
                  {job.result?.output && <pre className="mt-2 text-[10px] whitespace-pre-wrap max-h-24 overflow-y-auto text-gray-400">{job.result.output}</pre>}
                </div>
              )}
              {bot.id === 'cabbage' && isOpen && (
                <div className="mt-4 pt-4 border-t border-gray-800 space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                    <div className="bg-gray-900 rounded p-2"><p className="text-gray-500">Latest action</p><p className="text-white font-semibold">{bot.latest?.action || '—'}</p></div>
                    <div className="bg-gray-900 rounded p-2"><p className="text-gray-500">Closed candle</p><p className="text-white">{money(bot.latest?.closedCandlePrice)}</p></div>
                    <div className="bg-gray-900 rounded p-2"><p className="text-gray-500">RSI</p><p className="text-white">{number(bot.latest?.rsi)}</p></div>
                    <div className="bg-gray-900 rounded p-2"><p className="text-gray-500">Trades</p><p className="text-white">{bot.counts?.trades ?? 0}</p></div>
                    <div className="bg-gray-900 rounded p-2"><p className="text-gray-500">EMA short</p><p className="text-white">{number(bot.latest?.emaShort)}</p></div>
                    <div className="bg-gray-900 rounded p-2"><p className="text-gray-500">EMA long</p><p className="text-white">{number(bot.latest?.emaLong)}</p></div>
                    <div className="bg-gray-900 rounded p-2"><p className="text-gray-500">Paper equity</p><p className="text-white">{money(bot.portfolio?.netSize)}</p></div>
                    <div className="bg-gray-900 rounded p-2"><p className="text-gray-500">Net gain</p><p className="text-white">{money(bot.portfolio?.totalNetGain)}</p></div>
                  </div>

                  <div>
                    <p className="text-gray-500 text-[10px] uppercase tracking-wide mb-2">Decision trace</p>
                    <div className="space-y-2">
                      {(bot.latest?.decisionTraces || []).map((trace: any, index: number) => (
                        <div key={index} className="bg-gray-900 rounded-lg p-3 text-xs">
                          <div className="flex justify-between gap-3">
                            <p className="text-gray-200">{trace.side || 'decision'}</p>
                            <p className={trace.decision === 'ACCEPTED' ? 'text-emerald-300' : 'text-gray-400'}>{trace.decision || '—'}</p>
                          </div>
                          <p className="text-gray-400 mt-1">{trace.summary || 'No summary'}</p>
                          <p className="text-gray-600 mt-1">Score {trace.score ?? '—'} / {trace.minimumScore ?? '—'}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[11px]">
                    <div><p className="text-gray-500">Ticket</p><p className="text-gray-200">{money(bot.configuredRisk?.ticket)}</p></div>
                    <div><p className="text-gray-500">Stop loss</p><p className="text-gray-200">{bot.configuredRisk?.stopLossPercent ?? '—'}%</p></div>
                    <div><p className="text-gray-500">Fee</p><p className="text-gray-200">{bot.configuredRisk?.feePercent ?? '—'}%</p></div>
                  </div>
                </div>
              )}

              {bot.reason && <p className="text-gray-500 text-[11px] mt-3">{bot.reason}</p>}
              <a href={bot.url} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-cyan-400 hover:text-cyan-300 text-xs mt-3">
                <ExternalLink className="w-3.5 h-3.5" /> Open source repository
              </a>
            </div>
          );
        })}
        {bots.length === 0 && (
          <div className="xl:col-span-2 bg-gray-950/50 border border-gray-800 rounded-lg p-4 text-xs text-gray-500">
            Waiting for bot adapter status...
          </div>
        )}
      </div>
    </div>
  );
}
