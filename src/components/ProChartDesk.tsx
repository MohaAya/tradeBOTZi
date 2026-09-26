import React, { useEffect, useRef, useState } from 'react';
import { Activity, ExternalLink, Loader2, Play, RefreshCw, Send } from 'lucide-react';
import type { AppStore } from '../lib/useAppStore';

type AgentEvent = {
  id: string;
  timestamp: number;
  type: string;
  message: string;
};

export default function ProChartDesk({ store }: { store: AppStore }) {
  const [command, setCommand] = useState('Open ProChart BTCUSDT, inspect indicators, and run a backtest.');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [screenshotVersion, setScreenshotVersion] = useState(0);
  const [browserInstalled, setBrowserInstalled] = useState(false);
  const lastEventAt = useRef(0);

  const pollActivity = async () => {
    try {
      const res = await fetch('/api/agents/activity?since=' + lastEventAt.current, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const incoming = (data.events || []).filter((e: AgentEvent) => e.type === 'prochart' || e.type === 'error');
      if (incoming.length) {
        lastEventAt.current = Math.max(lastEventAt.current, ...incoming.map((e: AgentEvent) => e.timestamp));
        setEvents(prev => [...prev, ...incoming].slice(-100));
      } else if (data.now) {
        lastEventAt.current = Math.max(lastEventAt.current, Number(data.now) - 1);
      }
    } catch {}
  };

  const refreshStatus = async () => {
    try {
      const res = await fetch('/api/agents/status', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setBrowserInstalled(Boolean(data.browser?.installed));
      if (data.browser?.screenshotAvailable) setScreenshotVersion(Date.now());
    } catch {}
  };

  useEffect(() => {
    refreshStatus();
    pollActivity();
    const timer = setInterval(() => {
      pollActivity();
      refreshStatus();
    }, 2500);
    return () => clearInterval(timer);
  }, []);

  const pollJob = async (jobId: string) => {
    const deadline = Date.now() + 300000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1800));
      const res = await fetch('/api/agents/jobs/' + encodeURIComponent(jobId), { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Agent job polling failed');
      if (data.status === 'done') return data;
      if (data.status === 'error') throw new Error(data.error || 'Agent job failed');
    }
    throw new Error('ProChart agent job timed out');
  };

  const runAgent = async (override?: string) => {
    const text = (override ?? command).trim();
    if (!text || running) return;
    setRunning(true);
    setStatus('Starting agent browser...');
    try {
      const res = await fetch('/api/agents/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: text,
          agents: [
            { provider: 'omniroute', role: 'Technical Analyst' },
            { provider: 'hermes', role: 'Risk & Operations Agent' },
          ],
          context: {
            markets: store.markets.slice(0, 40),
            portfolios: store.portfolios,
            latestRanking: store.latestRanking,
            providerStatuses: store.providerStatuses,
          },
        }),
      });
      const submitted = await res.json();
      if (!res.ok || !submitted.ok) throw new Error(submitted.error || 'Could not start ProChart agent');
      setStatus('Agent browser is working in ProChart...');
      const result = await pollJob(submitted.jobId);
      if (result.proChart?.ok) {
        const actions = (result.proChart.actions || [])
          .map((a: any) => a.action + ': ' + (a.ok ? 'OK' : 'FAILED'))
          .join(' | ');
        setStatus('Completed: ' + actions);
        setScreenshotVersion(Date.now());
      } else {
        setStatus('Browser action failed: ' + (result.proChart?.error || 'unknown error'));
      }
      await pollActivity();
    } catch (e: any) {
      setStatus('Error: ' + (e.message || 'unknown error'));
    } finally {
      setRunning(false);
    }
  };

  const quickActions = [
    'Open ProChart BTCUSDT and inspect indicators.',
    'Open ProChart ETHUSDT and run a backtest.',
    'Open ProChart SOLUSDT, inspect indicators, and run a backtest.',
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-white">ProChart Agent Workspace</h2>
          <p className="text-gray-400 text-sm mt-1">
            Live ProChart plus a separate VPS agent browser. Activity and snapshots below come from real browser actions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={'text-xs px-3 py-1.5 rounded-full border ' + (
            browserInstalled
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
              : 'bg-amber-500/10 border-amber-500/20 text-amber-300'
          )}>
            Agent Browser {browserInstalled ? 'READY' : 'NOT READY'}
          </span>
          <a href="https://prochart-1le.pages.dev/" target="_blank" rel="noreferrer"
            className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white flex items-center gap-1.5">
            <ExternalLink className="w-3.5 h-3.5" /> Open separately
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 2xl:grid-cols-3 gap-5">
        <div className="2xl:col-span-2 bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
            <div>
              <p className="text-white font-medium text-sm">Embedded ProChart</p>
              <p className="text-gray-500 text-xs">This is the live site you can use directly.</p>
            </div>
            <RefreshCw className="w-4 h-4 text-gray-500" />
          </div>
          <iframe
            title="ProChart"
            src="https://prochart-1le.pages.dev/"
            className="w-full border-0 bg-black"
            style={{ height: '760px' }}
            allow="clipboard-read; clipboard-write; fullscreen"
          />
        </div>

        <div className="space-y-5">
          <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
            <h3 className="text-white font-semibold text-sm mb-2">Command Agent Browser</h3>
            <textarea
              value={command}
              onChange={e => setCommand(e.target.value)}
              disabled={running}
              className="w-full min-h-[92px] bg-gray-950 border border-gray-700 rounded-lg px-3 py-3 text-sm text-white resize-none focus:outline-none focus:border-cyan-500/50"
            />
            <button onClick={() => runAgent()} disabled={running || !command.trim()}
              className="w-full mt-3 px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-600 disabled:opacity-40 text-gray-950 font-semibold text-sm flex items-center justify-center gap-2">
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Run Real ProChart Action
            </button>
            <p className="text-xs text-gray-400 mt-3 whitespace-pre-wrap">{status}</p>
          </div>

          <div className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-700">
              <p className="text-white font-semibold text-sm">Agent Browser Snapshot</p>
              <p className="text-gray-500 text-[11px]">Captured by Chromium on the VPS after real actions.</p>
            </div>
            <div className="bg-black min-h-[180px] flex items-center justify-center">
              {screenshotVersion > 0 ? (
                <img
                  src={'/api/agents/prochart/screenshot?v=' + screenshotVersion}
                  alt="Latest agent browser ProChart snapshot"
                  className="w-full h-auto"
                  onError={() => setScreenshotVersion(0)}
                />
              ) : (
                <p className="text-gray-600 text-xs p-8 text-center">Run a ProChart agent command to capture a snapshot.</p>
              )}
            </div>
          </div>

          <div className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-700 flex items-center gap-2">
              <Activity className="w-4 h-4 text-violet-400" />
              <p className="text-white font-semibold text-sm">Real Browser Activity</p>
            </div>
            <div className="h-[260px] overflow-y-auto p-3 space-y-2">
              {events.length === 0 && <p className="text-gray-500 text-xs p-2">No ProChart browser actions yet.</p>}
              {[...events].reverse().map(event => (
                <div key={event.id} className="bg-gray-900/70 border border-gray-800 rounded-lg p-2.5">
                  <div className="flex justify-between gap-2 mb-1">
                    <span className="text-[10px] uppercase text-violet-300">{event.type}</span>
                    <span className="text-[10px] text-gray-600">{new Date(event.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <p className="text-xs text-gray-300">{event.message}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {quickActions.map(text => (
          <button key={text} onClick={() => setCommand(text)} disabled={running}
            className="text-xs px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-cyan-300 hover:border-cyan-500/40 disabled:opacity-40">
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}