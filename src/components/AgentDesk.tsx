import React, { useEffect, useRef, useState } from 'react';
import {
  Activity, Bot, Brain, CheckCircle2, Cpu, DollarSign, ExternalLink,
  Loader2, Play, RefreshCw, Send, Shield, XCircle
} from 'lucide-react';
import type { AppStore } from '../lib/useAppStore';

type Assignment = {
  provider: string;
  role: string;
  enabled?: boolean;
};

type AgentMessage = {
  kind: 'user' | 'agent' | 'system';
  provider?: string;
  role?: string;
  content: string;
  ok?: boolean;
};

type AgentEvent = {
  id: string;
  timestamp: number;
  type: string;
  message: string;
  provider?: string;
  role?: string;
  portfolioId?: string;
};

const ROLE_OPTIONS = [
  'Portfolio Manager',
  'Quant Researcher',
  'Risk & Operations Agent',
  'Execution Monitor',
  'Technical Analyst',
  'Macro Analyst',
  'Liquidity Agent',
  'Derivatives Agent',
  'Bear Case',
  'Bull Case',
];

const PROVIDER_LABELS: Record<string, string> = {
  omniroute: 'OmniRoute',
  freellm: 'FreeLLM',
  hermes: 'Hermes',
  ollama: 'Ollama',
};

export default function AgentDesk({
  store,
  onOpenProChart,
}: {
  store: AppStore;
  onOpenProChart: () => void;
}) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [providerHealth, setProviderHealth] = useState<Record<string, any>>({});
  const [command, setCommand] = useState('');
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [paperAccounts, setPaperAccounts] = useState<any[]>([]);
  const [paperTransactions, setPaperTransactions] = useState<any[]>([]);
  const [running, setRunning] = useState(false);
  const [activeJob, setActiveJob] = useState<string | null>(null);
  const [browserInstalled, setBrowserInstalled] = useState(false);
  const lastEventAt = useRef(0);

  const refreshStatus = async () => {
    try {
      const [statusRes, providersRes, paperRes] = await Promise.all([
        fetch('/api/agents/status', { cache: 'no-store' }),
        fetch('/api/ai/providers', { cache: 'no-store' }),
        fetch('/api/paper/accounts', { cache: 'no-store' }),
      ]);
      if (statusRes.ok) {
        const data = await statusRes.json();
        setBrowserInstalled(Boolean(data.browser?.installed));
        if (assignments.length === 0 && Array.isArray(data.assignments)) {
          setAssignments(data.assignments.map((a: Assignment) => ({ ...a, enabled: true })));
        }
      }
      if (providersRes.ok) {
        const data = await providersRes.json();
        const next: Record<string, any> = {};
        for (const p of data.providers || []) next[p.id] = p;
        setProviderHealth(next);
      }
      if (paperRes.ok) {
        const data = await paperRes.json();
        setPaperAccounts(data.accounts || []);
        setPaperTransactions(data.transactions || []);
      }
    } catch {}
  };

  const pollEvents = async () => {
    try {
      const res = await fetch('/api/agents/activity?since=' + lastEventAt.current, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const incoming = data.events || [];
      if (incoming.length) {
        lastEventAt.current = Math.max(lastEventAt.current, ...incoming.map((e: AgentEvent) => e.timestamp));
        setEvents(prev => [...prev, ...incoming].slice(-160));
      }
    } catch {}
  };

  useEffect(() => {
    refreshStatus();
    pollEvents();
    const statusTimer = setInterval(refreshStatus, 10000);
    const eventTimer = setInterval(pollEvents, 1500);
    return () => {
      clearInterval(statusTimer);
      clearInterval(eventTimer);
    };
  }, []);

  const setRole = (provider: string, role: string) => {
    setAssignments(prev => prev.map(a => a.provider === provider ? { ...a, role } : a));
  };

  const toggleProvider = (provider: string) => {
    setAssignments(prev => prev.map(a => a.provider === provider ? { ...a, enabled: !a.enabled } : a));
  };

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
    throw new Error('Agent command timed out');
  };

  const submitCommand = async (override?: string) => {
    const text = (override ?? command).trim();
    if (!text || running) return;
    const enabledAgents = assignments.filter(a => a.enabled !== false);
    if (enabledAgents.length === 0) {
      setMessages(prev => [...prev, { kind: 'system', content: 'Enable at least one AI agent first.', ok: false }]);
      return;
    }

    setMessages(prev => [...prev, { kind: 'user', content: text }]);
    setCommand('');
    setRunning(true);

    try {
      let commandPortfolios = store.portfolios;
      const wantsPortfolioBuild = /\b(generate|create|build|make)\b.*\bportfolio/i.test(text);
      const wantsInvestment = /\b(invest|execute|buy|paper invest|deploy capital|rebalance)\b/i.test(text);
      if (wantsPortfolioBuild || (wantsInvestment && commandPortfolios.length === 0)) {
        setMessages(prev => [...prev, { kind: 'system', content: 'Generating fresh deterministic portfolios before the AI council runs...' }]);
        await store.generateNewPortfolios();
        try {
          const saved = JSON.parse(localStorage.getItem('zbot_portfolios') || '[]');
          if (Array.isArray(saved) && saved.length > 0) commandPortfolios = saved;
        } catch {}
      }

      const response = await fetch('/api/agents/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: text,
          agents: enabledAgents.map(a => ({ provider: a.provider, role: a.role })),
          capital: store.settings.portfolio.defaultCapital,
          context: {
            markets: store.markets.slice(0, 50),
            portfolios: commandPortfolios,
            latestRanking: store.latestRanking,
            providerStatuses: store.providerStatuses,
          },
        }),
      });
      const submitted = await response.json();
      if (!response.ok || !submitted.ok) throw new Error(submitted.error || 'Could not start agent command');
      setActiveJob(submitted.jobId);
      const result = await pollJob(submitted.jobId);

      const agentMessages: AgentMessage[] = (result.results || []).map((item: any) => ({
        kind: 'agent',
        provider: item.provider,
        role: item.role,
        ok: item.ok,
        content: item.ok
          ? item.content
          : ('Agent failed: ' + (item.error || 'unknown provider error')),
      }));

      if (result.proChart) {
        agentMessages.push({
          kind: 'system',
          ok: result.proChart.ok,
          content: result.proChart.ok
            ? ('ProChart agent browser worked on ' + result.proChart.symbol + '. ' +
              (result.proChart.actions || []).map((a: any) => a.action + ': ' + (a.ok ? 'OK' : 'FAILED')).join(' | '))
            : ('ProChart action failed: ' + result.proChart.error),
        });
      }

      if (result.paperExecution) {
        const exec = result.paperExecution;
        if (exec.ok) {
          const account = exec.account;
          agentMessages.push({
            kind: 'system',
            ok: true,
            content:
              'PAPER investment executed for ' + account.portfolioId +
              '. ' + account.positions.length + ' simulated positions opened. ' +
              'Equity $' + Number(account.equity).toLocaleString(undefined, { maximumFractionDigits: 2 }) +
              ', cash $' + Number(account.cash).toLocaleString(undefined, { maximumFractionDigits: 2 }) + '.',
          });
        } else {
          agentMessages.push({
            kind: 'system',
            ok: false,
            content: 'Risk engine rejected PAPER execution: ' + exec.error,
          });
        }
      }

      setMessages(prev => [...prev, ...agentMessages]);
      await refreshStatus();
      await pollEvents();
    } catch (e: any) {
      setMessages(prev => [...prev, {
        kind: 'system',
        content: 'Agent command failed: ' + (e.message || 'unknown error'),
        ok: false,
      }]);
    } finally {
      setRunning(false);
      setActiveJob(null);
    }
  };

  const generatePortfolios = async () => {
    setMessages(prev => [...prev, { kind: 'system', content: 'Running deterministic portfolio generator...' }]);
    await store.generateNewPortfolios();
    setMessages(prev => [...prev, {
      kind: 'system',
      content: 'Portfolio generator finished. Open Portfolio Builder to inspect the candidates, then ask the AI council to challenge them.',
      ok: true,
    }]);
  };

  const quickCommands = [
    'Analyze the current portfolios. Each agent should challenge the allocations from its own role.',
    'Open ProChart BTCUSDT, inspect indicators, and run a backtest. Report what actually happened.',
    'Compare BTC, ETH and SOL risk and explain which portfolio exposures concern you most.',
    'Invest the top-ranked eligible portfolio in PAPER mode after deterministic risk checks.',
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-white">Agent Desk</h2>
          <p className="text-gray-400 text-sm mt-1">
            Command multiple live AIs, assign their roles, watch real activity, and execute PAPER investments.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300">
            PAPER ONLY
          </span>
          <span className={'text-xs px-3 py-1.5 rounded-full border ' + (
            browserInstalled
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
              : 'bg-gray-800 border-gray-700 text-gray-400'
          )}>
            ProChart Browser {browserInstalled ? 'READY' : 'INSTALLING / OFFLINE'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {assignments.map(assignment => {
          const health = providerHealth[assignment.provider];
          const enabled = assignment.enabled !== false;
          return (
            <div key={assignment.provider}
              className={'rounded-xl border p-4 ' + (enabled ? 'bg-gray-800/60 border-gray-700' : 'bg-gray-900/30 border-gray-800 opacity-60')}>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <Brain className="w-5 h-5 text-cyan-400" />
                  <div>
                    <p className="text-white font-medium">{PROVIDER_LABELS[assignment.provider] || assignment.provider}</p>
                    <p className="text-[11px] text-gray-500 break-all">{health?.model || 'provider model'}</p>
                  </div>
                </div>
                <button
                  onClick={() => toggleProvider(assignment.provider)}
                  className={'text-[11px] px-2 py-1 rounded ' + (enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gray-700 text-gray-400')}>
                  {enabled ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className="flex items-center gap-2 mb-3 text-xs">
                <span className={'w-2 h-2 rounded-full ' + (health?.healthy ? 'bg-emerald-400' : 'bg-red-400')} />
                <span className={health?.healthy ? 'text-emerald-400' : 'text-red-400'}>
                  {health?.healthy ? 'connected' : 'unavailable'}
                </span>
                {health?.latencyMs != null && <span className="text-gray-500">{health.latencyMs} ms</span>}
              </div>
              <label className="text-[11px] text-gray-500 block mb-1">Agent role</label>
              <select
                value={assignment.role}
                onChange={e => setRole(assignment.provider, e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-2 text-xs text-gray-200 focus:outline-none focus:border-cyan-500/50">
                {ROLE_OPTIONS.map(role => <option key={role} value={role}>{role}</option>)}
              </select>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between">
            <div>
              <h3 className="text-white font-semibold">Command the AI Council</h3>
              <p className="text-gray-500 text-xs">Selected providers receive the same command with different assigned roles.</p>
            </div>
            {activeJob && (
              <div className="flex items-center gap-2 text-xs text-cyan-300">
                <Loader2 className="w-4 h-4 animate-spin" /> {activeJob}
              </div>
            )}
          </div>

          <div className="h-[430px] overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="h-full flex items-center justify-center text-center">
                <div>
                  <Bot className="w-9 h-9 text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-300 font-medium">Give the agents a task</p>
                  <p className="text-gray-500 text-sm mt-1">They can analyze portfolios, inspect ProChart, challenge risk, and trigger PAPER execution.</p>
                </div>
              </div>
            )}
            {messages.map((message, index) => (
              <div key={index} className={'rounded-lg p-3 border ' + (
                message.kind === 'user'
                  ? 'ml-12 bg-emerald-500/10 border-emerald-500/20'
                  : message.kind === 'agent'
                  ? 'mr-6 bg-gray-900/70 border-gray-700'
                  : message.ok === false
                  ? 'bg-red-500/10 border-red-500/20'
                  : 'bg-cyan-500/10 border-cyan-500/20'
              )}>
                <div className="flex items-center gap-2 mb-1">
                  {message.kind === 'agent' && <Cpu className="w-4 h-4 text-cyan-400" />}
                  {message.kind === 'user' && <Send className="w-4 h-4 text-emerald-400" />}
                  {message.kind === 'system' && (message.ok === false
                    ? <XCircle className="w-4 h-4 text-red-400" />
                    : <CheckCircle2 className="w-4 h-4 text-cyan-400" />)}
                  <span className="text-xs font-medium text-gray-300">
                    {message.kind === 'user'
                      ? 'You'
                      : message.kind === 'agent'
                      ? ((message.role || 'Agent') + ' · ' + (PROVIDER_LABELS[message.provider || ''] || message.provider))
                      : 'System'}
                  </span>
                </div>
                <p className="text-sm text-gray-200 whitespace-pre-wrap">{message.content}</p>
              </div>
            ))}
            {running && (
              <div className="flex items-center gap-2 text-sm text-gray-400 px-3 py-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Agents are working...
              </div>
            )}
          </div>

          <div className="p-4 border-t border-gray-700">
            <textarea
              value={command}
              onChange={e => setCommand(e.target.value)}
              placeholder="Example: Open ProChart for SOLUSDT, run a backtest, challenge portfolio PB, then invest it in PAPER mode if the risk engine accepts it."
              className="w-full min-h-[92px] bg-gray-950 border border-gray-700 rounded-lg px-3 py-3 text-sm text-white resize-none focus:outline-none focus:border-emerald-500/50"
              disabled={running}
            />
            <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
              <div className="flex gap-2">
                <button onClick={generatePortfolios} disabled={running}
                  className="text-xs px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-gray-300 hover:text-white">
                  Generate Portfolios
                </button>
                <button onClick={store.runRanking} disabled={running || store.portfolios.length === 0}
                  className="text-xs px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-gray-300 hover:text-white disabled:opacity-40">
                  Run Ranking
                </button>
                <button onClick={onOpenProChart}
                  className="text-xs px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-gray-300 hover:text-white flex items-center gap-1.5">
                  <ExternalLink className="w-3.5 h-3.5" /> ProChart
                </button>
              </div>
              <button onClick={() => submitCommand()} disabled={running || !command.trim()}
                className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white text-sm font-medium flex items-center gap-2">
                {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Command Agents
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-700 flex items-center gap-2">
              <Activity className="w-4 h-4 text-violet-400" />
              <h3 className="text-white font-semibold text-sm">Live Agent Activity</h3>
            </div>
            <div className="h-[330px] overflow-y-auto p-3 space-y-2">
              {events.length === 0 && (
                <p className="text-gray-500 text-xs p-2">No agent activity yet.</p>
              )}
              {[...events].reverse().map(event => (
                <div key={event.id} className="bg-gray-900/60 border border-gray-800 rounded-lg p-2.5">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[10px] uppercase tracking-wide text-violet-300">{event.type.replace(/_/g, ' ')}</span>
                    <span className="text-[10px] text-gray-600">{new Date(event.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <p className="text-xs text-gray-300">{event.message}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-700 flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-400" />
              <div>
                <h3 className="text-white font-semibold text-sm">PAPER Investments</h3>
                <p className="text-[10px] text-gray-500">Persisted on the VPS</p>
              </div>
            </div>
            <div className="max-h-[360px] overflow-y-auto p-3 space-y-3">
              {paperAccounts.length === 0 && (
                <div className="p-4 text-center">
                  <Shield className="w-6 h-6 text-gray-600 mx-auto mb-2" />
                  <p className="text-gray-400 text-xs">No PAPER portfolio invested yet.</p>
                </div>
              )}
              {paperAccounts.map(account => (
                <div key={account.portfolioId} className="bg-gray-900/70 border border-gray-800 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-white text-sm font-semibold">{account.portfolioId} · {account.portfolioName}</p>
                      <p className="text-emerald-400 text-[10px]">PAPER ACTIVE</p>
                    </div>
                    <p className="text-white text-sm font-bold">
                      $${Number(account.equity).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] mb-2">
                    <div><span className="text-gray-500">Cash</span><p className="text-gray-200">$${Number(account.cash).toLocaleString(undefined, { maximumFractionDigits: 0 })}</p></div>
                    <div><span className="text-gray-500">Fees</span><p className="text-gray-200">$${Number(account.totalFees).toFixed(2)}</p></div>
                  </div>
                  <div className="space-y-1">
                    {(account.positions || []).map((position: any) => (
                      <div key={position.canonicalSymbol} className="flex justify-between gap-2 text-[11px]">
                        <span className="text-gray-300">{position.canonicalSymbol}</span>
                        <span className="text-gray-500">{Number(position.quantity).toFixed(5)} · $${Number(position.marketValue).toFixed(0)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div>
        <p className="text-gray-500 text-xs mb-2">Quick commands</p>
        <div className="flex gap-2 flex-wrap">
          {quickCommands.map(text => (
            <button key={text} onClick={() => setCommand(text)} disabled={running}
              className="text-xs px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:border-cyan-500/40 hover:text-cyan-300 disabled:opacity-40">
              {text}
            </button>
          ))}
        </div>
      </div>

      {paperTransactions.length > 0 && (
        <div className="bg-gray-800/40 border border-gray-700 rounded-xl p-4">
          <h3 className="text-white text-sm font-semibold mb-3">Recent PAPER Fills</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-700">
                  <th className="text-left py-2">Time</th>
                  <th className="text-left py-2">Portfolio</th>
                  <th className="text-left py-2">Side</th>
                  <th className="text-left py-2">Symbol</th>
                  <th className="text-right py-2">Qty</th>
                  <th className="text-right py-2">Fill</th>
                  <th className="text-right py-2">Fees</th>
                </tr>
              </thead>
              <tbody>
                {[...paperTransactions].slice(-12).reverse().map((tx: any) => (
                  <tr key={tx.id} className="border-b border-gray-800 text-gray-300">
                    <td className="py-2">{new Date(tx.timestamp).toLocaleTimeString()}</td>
                    <td className="py-2">{tx.portfolioId}</td>
                    <td className="py-2 text-emerald-400 uppercase">{tx.side}</td>
                    <td className="py-2">{tx.canonicalSymbol}</td>
                    <td className="py-2 text-right">{Number(tx.quantity).toFixed(6)}</td>
                    <td className="py-2 text-right">$${Number(tx.price).toFixed(4)}</td>
                    <td className="py-2 text-right">$${Number(tx.fees).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}