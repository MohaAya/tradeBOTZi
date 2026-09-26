import React, { useEffect, useState } from 'react';
import { 
  Bot, LayoutDashboard, Users, BarChart3, History, Settings, Zap, 
  Layers, Target, Trophy, Route, Play, Pause, Square, AlertTriangle,
  ChevronDown, ChevronUp, Clock, TrendingUp, TrendingDown, Search,
  Download, Filter, ArrowUpRight, ArrowDownRight, Shield, Bell, Globe,
  Key, Database, Save, Check, Cpu, Server, Loader2, WifiOff, Award,
  Droplet, Link2, DollarSign, Brain, RefreshCw, MessageSquare, Send
} from 'lucide-react';
import { useAppStore } from './lib/useAppStore';
import type { AppStore } from './lib/useAppStore';
import type { TradingAgent, Portfolio, MarketObservation, RankingRun } from './types';
import { compareAcrossVenues } from './lib/providers';

// ============================================================
// SIDEBAR
// ============================================================
const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'agents', label: 'Trading Agents', icon: Users },
  { id: 'portfolio-builder', label: 'Portfolio Builder', icon: Layers },
  { id: 'evaluation', label: 'Evaluation', icon: Target },
  { id: 'ranking', label: 'Ranking & AI', icon: Trophy },
  { id: 'cross-venue', label: 'Cross-Venue', icon: Link2 },
  { id: 'chat', label: 'Copilot', icon: MessageSquare },
  { id: 'omniroute', label: 'OmniRoute', icon: Route },
  { id: 'market', label: 'Market Data', icon: BarChart3 },
  { id: 'trades', label: 'Trade History', icon: History },
  { id: 'settings', label: 'Settings', icon: Settings },
];

function Sidebar({ activeTab, onTabChange }: { activeTab: string; onTabChange: (t: string) => void }) {
  return (
    <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col min-h-screen">
      <div className="p-6 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-cyan-500 rounded-xl flex items-center justify-center">
            <Bot className="w-6 h-6 text-gray-900" />
          </div>
          <div>
            <h1 className="text-white font-bold text-lg">Zbot</h1>
            <p className="text-gray-500 text-xs">Research Center</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map(item => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button key={item.id} onClick={() => onTabChange(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                isActive ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}>
              <Icon className="w-5 h-5" />{item.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

// ============================================================
// IMPORT DASHBOARD
// ============================================================
import Dashboard from './components/Dashboard';

// ============================================================
// AGENTS PANEL
// ============================================================
function AgentsPanel({ store }: { store: AppStore }) {
  const { agents, updateAgent, createAgent } = store;
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');

  const handleCreate = () => {
    if (!newName.trim()) return;
    createAgent({
      id: `agent-${Date.now()}`,
      name: newName,
      strategy: 'custom',
      status: 'stopped',
      market: 'crypto',
      universe: [],
      timeframe: '1h',
      riskProfile: 'moderate',
      capitalAllocation: 10000,
      enabled: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastTradeAt: null,
      totalTrades: 0,
      pnl: 0,
    });
    setNewName('');
    setShowCreate(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Trading Agents</h2>
          <p className="text-gray-400 text-sm mt-1">Persistent agent state — survives page refresh</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
          <Zap className="w-4 h-4" />Create Agent
        </button>
      </div>

      {showCreate && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 flex items-center gap-3">
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Agent name..."
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-emerald-500/50" />
          <button onClick={handleCreate} className="bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm">Create</button>
        </div>
      )}

      {agents.length === 0 && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-12 text-center">
          <Users className="w-8 h-8 text-gray-500 mx-auto mb-4" />
          <p className="text-white font-medium">No agents created</p>
          <p className="text-gray-400 text-sm mt-2">Create an agent to start monitoring markets</p>
        </div>
      )}

      <div className="space-y-4">
        {agents.map(agent => (
          <div key={agent.id} className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`w-3 h-3 rounded-full ${
                  agent.status === 'running' ? 'bg-emerald-400 animate-pulse' :
                  agent.status === 'paused' ? 'bg-amber-400' :
                  agent.status === 'error' ? 'bg-red-400' : 'bg-gray-400'
                }`} />
                <div>
                  <h3 className="text-white font-semibold">{agent.name}</h3>
                  <p className="text-gray-400 text-xs">{agent.strategy} • {agent.market} • {agent.riskProfile}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {agent.status !== 'running' && (
                  <button onClick={() => updateAgent(agent.id, { status: 'running' })}
                    className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"><Play className="w-4 h-4" /></button>
                )}
                {agent.status === 'running' && (
                  <button onClick={() => updateAgent(agent.id, { status: 'paused' })}
                    className="p-2 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"><Pause className="w-4 h-4" /></button>
                )}
                <button onClick={() => updateAgent(agent.id, { status: 'stopped' })}
                  className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20"><Square className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t border-gray-700/50">
              <div><p className="text-gray-500 text-xs">Status</p><p className="text-white text-sm">{agent.status}</p></div>
              <div><p className="text-gray-500 text-xs">Capital</p><p className="text-white text-sm">${agent.capitalAllocation.toLocaleString()}</p></div>
              <div><p className="text-gray-500 text-xs">Trades</p><p className="text-white text-sm">{agent.totalTrades}</p></div>
              <div><p className="text-gray-500 text-xs">P&L</p><p className={`text-sm ${agent.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>${agent.pnl.toFixed(2)}</p></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// PORTFOLIO BUILDER
// ============================================================
function PortfolioBuilder({ store }: { store: AppStore }) {
  const { markets, portfolios, providerStatuses, generateNewPortfolios, portfoliosLoading, marketsLoading, marketsError } = store;
  const connectedProviders = providerStatuses.filter(p => p.status === 'connected');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Portfolio Builder</h2>
          <p className="text-gray-400 text-sm mt-1">Generate portfolios from real market data</p>
        </div>
        <button onClick={generateNewPortfolios} disabled={markets.length === 0 || portfoliosLoading}
          className="bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-700 disabled:text-gray-500 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
          {portfoliosLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Generate Five Portfolios
        </button>
      </div>

      {portfolios.length > 0 && !portfoliosLoading && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
          <p className="text-emerald-400 text-sm font-medium">
            Portfolio generation complete: {portfolios.length} portfolios generated from {markets.length} live market observations.
          </p>
        </div>
      )}

      {marketsError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-400 text-sm font-medium">Portfolio generation error</p>
            <p className="text-red-300/80 text-xs mt-1">{marketsError}</p>
          </div>
        </div>
      )}

      {/* Provider Status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {providerStatuses.map(p => (
          <div key={p.id} className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <Database className="w-5 h-5 text-emerald-400" />
                <span className="text-white font-medium">{p.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${p.status === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
                <span className={`text-xs ${p.status === 'connected' ? 'text-emerald-400' : 'text-red-400'}`}>{p.status}</span>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-400">Latency</span><span className="text-white">{p.latencyMs ? `${p.latencyMs}ms` : '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Last Heartbeat</span><span className="text-white">{p.lastHeartbeat ? `${Math.round((Date.now() - p.lastHeartbeat) / 1000)}s ago` : '—'}</span></div>
            </div>
          </div>
        ))}
      </div>

      {/* Pipeline */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Generation Pipeline</h3>
        <div className="flex items-center justify-between text-sm">
          <div className={`flex-1 p-3 rounded-lg border text-center ${markets.length > 0 ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-gray-900/50 border-gray-700 text-gray-500'}`}>
            <p className="font-medium">Data Ingestion</p>
            <p className="text-xs mt-1">{markets.length} observations</p>
          </div>
          <span className="mx-2 text-gray-600">→</span>
          <div className={`flex-1 p-3 rounded-lg border text-center ${portfolios.length > 0 ? 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400' : 'bg-gray-900/50 border-gray-700 text-gray-500'}`}>
            <p className="font-medium">Portfolios</p>
            <p className="text-xs mt-1">{portfolios.length} generated</p>
          </div>
          <span className="mx-2 text-gray-600">→</span>
          <div className={`flex-1 p-3 rounded-lg border text-center ${portfolios.some(p => p.metrics) ? 'bg-violet-500/10 border-violet-500/20 text-violet-400' : 'bg-gray-900/50 border-gray-700 text-gray-500'}`}>
            <p className="font-medium">Evaluated</p>
            <p className="text-xs mt-1">{portfolios.filter(p => p.metrics).length} with metrics</p>
          </div>
        </div>
        {portfolios.length > 0 && portfolios[0] && (
          <p className="text-amber-400 text-xs mt-3 text-center">Universe: {portfolios[0].universeLabel}</p>
        )}
      </div>

      {/* Generated Portfolios */}
      {portfolios.length > 0 && (
        <div className="space-y-3">
          {portfolios.map(p => (
            <div key={p.id} className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-white font-bold text-lg">{p.id}</span>
                  <span className="text-gray-400 ml-2">{p.name}</span>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${
                  p.status === 'paper_active' ? 'bg-emerald-500/20 text-emerald-400' :
                  p.status === 'disqualified' ? 'bg-red-500/20 text-red-400' :
                  'bg-gray-700 text-gray-300'
                }`}>{p.status.replace('_', ' ')}</span>
              </div>
              <div className="flex gap-2 mt-2 flex-wrap">
                {p.assets.map(a => (
                  <span key={a.canonicalSymbol} className="text-xs bg-gray-700/50 text-gray-300 px-2 py-1 rounded">
                    {a.canonicalSymbol} {(a.allocationPercent).toFixed(1)}%
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {markets.length === 0 && !marketsLoading && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-12 text-center">
          <WifiOff className="w-8 h-8 text-gray-500 mx-auto mb-4" />
          <p className="text-white font-medium">DATA UNAVAILABLE</p>
          <p className="text-gray-400 text-sm mt-2">Cannot generate portfolios without market data</p>
        </div>
      )}
    </div>
  );
}

// ============================================================
// PORTFOLIO EVALUATION
// ============================================================
function PortfolioEvaluation({ store }: { store: AppStore }) {
  const { portfolios, runRanking } = store;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Portfolio Evaluation</h2>
          <p className="text-gray-400 text-sm mt-1">Calculated metrics from real historical data</p>
        </div>
        <button onClick={runRanking} disabled={portfolios.length === 0}
          className="bg-violet-500 hover:bg-violet-600 disabled:bg-gray-700 disabled:text-gray-500 text-white px-4 py-2 rounded-lg text-sm font-medium">
          Run Ranking
        </button>
      </div>

      {portfolios.length === 0 && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-12 text-center">
          <p className="text-white font-medium">No portfolios to evaluate</p>
          <p className="text-gray-400 text-sm mt-2">Generate portfolios first from the Portfolio Builder</p>
        </div>
      )}

      {portfolios.map(p => (
        <div key={p.id} className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-xl font-bold text-white">{p.id} — {p.name}</h3>
              <p className="text-gray-500 text-xs mt-1">{p.description}</p>
            </div>
            {p.status === 'disqualified' && (
              <span className="text-xs px-2 py-1 rounded-full bg-red-500/20 text-red-400">
                DISQUALIFIED: {p.disqualificationReason}
              </span>
            )}
          </div>

          {!p.metrics && (
            <p className="text-amber-400 text-sm">DATA UNAVAILABLE — Metrics not yet calculated</p>
          )}

          {p.metrics && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
                <MetricBox label="Sharpe" value={p.metrics.sharpeRatio?.toFixed(2) ?? '—'} />
                <MetricBox label="Sortino" value={p.metrics.sortinoRatio?.toFixed(2) ?? '—'} />
                <MetricBox label="Max DD" value={p.metrics.maxDrawdown ? `${(p.metrics.maxDrawdown * 100).toFixed(1)}%` : '—'} color="red" />
                <MetricBox label="Volatility" value={p.metrics.realizedVolatility ? `${(p.metrics.realizedVolatility * 100).toFixed(1)}%` : '—'} />
                <MetricBox label="Liquidity" value={p.metrics.liquidityScore?.toFixed(1) ?? '—'} />
                <MetricBox label="Correlation" value={p.metrics.avgPairwiseCorrelation?.toFixed(2) ?? '—'} />
                <MetricBox label="Momentum" value={p.metrics.momentumScore?.toFixed(1) ?? '—'} />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-gray-700/50">
                <div><p className="text-gray-400 text-xs">Cumulative Return</p><p className={`font-semibold ${p.metrics.cumulativeReturn! >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{(p.metrics.cumulativeReturn! * 100).toFixed(2)}%</p></div>
                <div><p className="text-gray-400 text-xs">Annualized Return</p><p className="text-white font-semibold">{p.metrics.annualizedReturn ? `${(p.metrics.annualizedReturn * 100).toFixed(2)}%` : '—'}</p></div>
                <div><p className="text-gray-400 text-xs">Observations</p><p className="text-white font-semibold">{p.metrics.observationCount}</p></div>
                <div><p className="text-gray-400 text-xs">Data Freshness</p><p className={`font-semibold ${p.metrics.dataFreshness === 'LIVE' ? 'text-emerald-400' : 'text-amber-400'}`}>{p.metrics.dataFreshness}</p></div>
              </div>
              <p className="text-gray-500 text-xs mt-3">
                Sources: {p.metrics.dataSources.join(', ')} | Window: {p.metrics.evaluationWindow} | Evaluated: {new Date(p.metrics.evaluatedAt).toLocaleString()}
              </p>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function MetricBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-gray-900/50 rounded-lg p-3">
      <p className="text-gray-400 text-xs">{label}</p>
      <p className={`font-semibold ${color === 'red' ? 'text-red-400' : 'text-white'}`}>{value}</p>
    </div>
  );
}

// ============================================================
// RANKING RECOMMENDATION
// ============================================================
function RankingView({ store }: { store: AppStore }) {
  const { portfolios, latestRanking } = store;

  if (!latestRanking) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-white">Ranking & Recommendations</h2>
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-12 text-center">
          <p className="text-white font-medium">No ranking run yet</p>
          <p className="text-gray-400 text-sm mt-2">Generate portfolios and run evaluation first</p>
        </div>
      </div>
    );
  }

  const eligibleResults = latestRanking.results.filter(r => !r.disqualified);
  const disqualifiedResults = latestRanking.results.filter(r => r.disqualified);
  const topResult = eligibleResults[0];
  const topPortfolio = portfolios.find(p => p.id === topResult?.portfolioId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Ranking & Recommendations</h2>
        <p className="text-gray-400 text-sm mt-1">Deterministic ranking — run at {new Date(latestRanking.timestamp).toLocaleString()}</p>
      </div>

      {/* Top Recommendation */}
      {topPortfolio && topResult && (
        <div className="bg-gradient-to-br from-emerald-500/10 to-cyan-500/5 border border-emerald-500/20 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <Award className="w-6 h-6 text-emerald-400" />
            <div>
              <h3 className="text-xl font-bold text-white">Recommended for PAPER: {topPortfolio.id}</h3>
              <p className="text-gray-400 text-sm">{topPortfolio.name}</p>
            </div>
          </div>
          {topResult.scoreBreakdown && (
            <div className="grid grid-cols-3 md:grid-cols-5 gap-2 mb-4">
              {Object.entries(topResult.scoreBreakdown).filter(([k]) => k !== 'total' && k !== 'maxTotal').map(([key, val]) => {
                const v = val as { score: number; max: number };
                return (
                  <div key={key} className="bg-gray-900/30 rounded p-2">
                    <p className="text-gray-400 text-xs truncate">{key.replace(/([A-Z])/g, ' $1').trim()}</p>
                    <p className="text-white font-semibold text-sm">{v.score.toFixed(1)} / {v.max}</p>
                  </div>
                );
              })}
            </div>
          )}
          <div className="bg-gray-900/50 rounded-lg p-3">
            <p className="text-emerald-400 text-sm font-medium">Total Score: {topResult.score.toFixed(1)} / 100</p>
            <p className="text-gray-400 text-xs mt-1">Label: {topResult.label}</p>
          </div>
        </div>
      )}

      {/* Full Rankings */}
      <div className="space-y-3">
        {eligibleResults.map(r => {
          const p = portfolios.find(pp => pp.id === r.portfolioId);
          return (
            <div key={r.portfolioId} className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-bold text-white">#{r.rank}</span>
                  <div>
                    <span className="text-white font-semibold">{r.portfolioId}</span>
                    <span className="text-gray-400 ml-2">{p?.name}</span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-gray-400 text-xs">Score</p>
                    <p className="text-white font-bold">{r.score.toFixed(1)}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    r.label === 'RECOMMENDED FOR PAPER' ? 'bg-emerald-500/20 text-emerald-400' :
                    r.label === 'PAPER CANDIDATE' ? 'bg-cyan-500/20 text-cyan-400' :
                    r.label === 'WATCH' ? 'bg-violet-500/20 text-violet-400' :
                    r.label === 'HIGH RISK' ? 'bg-amber-500/20 text-amber-400' :
                    'bg-gray-700 text-gray-300'
                  }`}>{r.label}</span>
                </div>
              </div>
              {r.scoreBreakdown && (
                <div className="mt-3 pt-3 border-t border-gray-700/50">
                  <div className="flex gap-3 flex-wrap text-xs">
                    {Object.entries(r.scoreBreakdown).filter(([k]) => k !== 'total' && k !== 'maxTotal').map(([key, val]) => {
                      const v = val as { score: number; max: number };
                      return <span key={key} className="text-gray-400">{key.replace(/([A-Z])/g, ' $1').trim()}: <span className="text-white">{v.score.toFixed(1)}/{v.max}</span></span>;
                    })}
                    <span className="text-emerald-400 font-medium">Total: {r.scoreBreakdown.total.toFixed(1)}/100</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Disqualified */}
      {disqualifiedResults.length > 0 && (
        <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-5">
          <h4 className="text-red-400 font-medium mb-3">Disqualified Portfolios</h4>
          {disqualifiedResults.map(r => (
            <div key={r.portfolioId} className="flex items-center justify-between py-2">
              <span className="text-white">{r.portfolioId}</span>
              <span className="text-red-400 text-sm">{r.disqualificationReason}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// OMNIROUTE CONFIG
// ============================================================
function OmniRouteView({ store }: { store: AppStore }) {
  const [providers, setProviders] = useState<any[]>([]);
  const [primary, setPrimary] = useState('omniroute');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch('/api/ai/providers', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (active) {
          setProviders(data.providers || []);
          setPrimary(data.primary || 'omniroute');
          setError(null);
        }
      } catch (e: any) {
        if (active) setError(e.message || 'AI backend unavailable');
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    const timer = setInterval(load, 15000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">AI Routing</h2>
        <p className="text-gray-400 text-sm mt-1">Live server-side providers. Credentials remain on the VPS.</p>
      </div>
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-sm text-red-300">
          AI backend unavailable: {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {loading && providers.length === 0 ? (
          <div className="col-span-full bg-gray-800/50 border border-gray-700 rounded-xl p-8 text-center">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-400 mx-auto mb-2" />
            <p className="text-gray-400 text-sm">Checking AI services...</p>
          </div>
        ) : providers.map((p: any) => (
          <div key={p.id} className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Cpu className="w-5 h-5 text-cyan-400" />
                <span className="font-medium text-white">{p.label}</span>
              </div>
              <span className={`text-xs px-2 py-1 rounded ${p.healthy ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                {p.healthy ? 'CONNECTED' : 'UNAVAILABLE'}
              </span>
            </div>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between"><span className="text-gray-500">Model</span><span className="text-gray-300 text-right ml-3 break-all">{p.model || '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Models visible</span><span className="text-gray-300">{p.modelCount ?? 0}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Health latency</span><span className="text-gray-300">{p.latencyMs != null ? `${p.latencyMs} ms` : '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Role</span><span className={p.id === primary ? 'text-emerald-400' : 'text-gray-400'}>{p.id === primary ? 'Primary' : 'Fallback'}</span></div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
        <p className="text-amber-300 text-xs">
          Hermes is connected only through the private VPS backend. Its credential and terminal-capable API are not exposed to the browser.
        </p>
      </div>
    </div>
  );
}

// ============================================================
// MARKET DATA
// ============================================================
function MarketDataView({ store }: { store: AppStore }) {
  const { markets, marketsLoading, marketsError, lastMarketUpdate } = store;
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = markets.filter(m => 
    m.canonicalSymbol.toLowerCase().includes(searchQuery.toLowerCase())
  ).sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Market Data</h2>
          <p className="text-gray-400 text-sm mt-1">
            {markets.length > 0 ? `${markets.length} instruments from ${[...new Set(markets.map(m => m.provider))].join(', ')}` : 'No data'}
            {lastMarketUpdate && ` • Updated ${new Date(lastMarketUpdate).toLocaleTimeString()}`}
          </p>
        </div>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search symbols..."
          className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50" />
      </div>

      {marketsLoading && markets.length === 0 && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-12 text-center">
          <Loader2 className="w-8 h-8 text-emerald-400 animate-spin mx-auto mb-4" />
          <p className="text-white">Loading real market data...</p>
        </div>
      )}

      {!marketsLoading && markets.length === 0 && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-12 text-center">
          <WifiOff className="w-8 h-8 text-gray-500 mx-auto mb-4" />
          <p className="text-white font-medium">DATA UNAVAILABLE</p>
          <p className="text-gray-400 text-sm mt-2">No market data received from providers</p>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left text-gray-400 text-xs font-medium px-5 py-3">Symbol</th>
                <th className="text-left text-gray-400 text-xs font-medium px-5 py-3">Provider</th>
                <th className="text-right text-gray-400 text-xs font-medium px-5 py-3">Price</th>
                <th className="text-right text-gray-400 text-xs font-medium px-5 py-3">24h Change</th>
                <th className="text-right text-gray-400 text-xs font-medium px-5 py-3">Volume</th>
                <th className="text-center text-gray-400 text-xs font-medium px-5 py-3">Freshness</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 50).map(m => (
                <tr key={`${m.provider}-${m.canonicalSymbol}`} className="border-b border-gray-700/50 hover:bg-gray-700/20">
                  <td className="px-5 py-3"><span className="text-white font-medium text-sm">{m.canonicalSymbol}</span></td>
                  <td className="px-5 py-3"><span className="text-gray-400 text-sm">{m.provider}</span></td>
                  <td className="px-5 py-3 text-right"><span className="text-white text-sm font-mono">
                    {m.price !== null ? m.price < 1 ? m.price.toFixed(4) : m.price < 100 ? m.price.toFixed(2) : m.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
                  </span></td>
                  <td className="px-5 py-3 text-right">
                    {m.change24h !== null ? (
                      <span className={`text-sm flex items-center justify-end gap-1 ${m.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {m.change24h >= 0 ? '+' : ''}{m.change24h.toFixed(2)}%
                      </span>
                    ) : <span className="text-gray-500 text-sm">—</span>}
                  </td>
                  <td className="px-5 py-3 text-right"><span className="text-gray-300 text-sm">
                    {m.volume24h ? m.volume24h >= 1e9 ? `$${(m.volume24h/1e9).toFixed(1)}B` : `$${(m.volume24h/1e6).toFixed(1)}M` : '—'}
                  </span></td>
                  <td className="px-5 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      m.freshness === 'LIVE' ? 'bg-emerald-500/20 text-emerald-400' :
                      m.freshness === 'DELAYED' ? 'bg-amber-500/20 text-amber-400' :
                      'bg-red-500/20 text-red-400'
                    }`}>{m.freshness}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================
// TRADE HISTORY
// ============================================================
function TradeHistoryView({ store }: { store: AppStore }) {
  const { paperTransactions, portfolios } = store;
  const allTxns = portfolios.flatMap(p => p.paperAccount?.transactions || []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Trade History</h2>
        <p className="text-gray-400 text-sm mt-1">Paper trading transactions — no real orders</p>
      </div>

      {allTxns.length === 0 && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-12 text-center">
          <History className="w-8 h-8 text-gray-500 mx-auto mb-4" />
          <p className="text-white font-medium">No paper trades yet</p>
          <p className="text-gray-400 text-sm mt-2">Start a portfolio in PAPER mode to see transactions</p>
        </div>
      )}

      {allTxns.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left text-gray-400 text-xs px-5 py-3">Time</th>
                <th className="text-left text-gray-400 text-xs px-5 py-3">Portfolio</th>
                <th className="text-left text-gray-400 text-xs px-5 py-3">Symbol</th>
                <th className="text-left text-gray-400 text-xs px-5 py-3">Side</th>
                <th className="text-right text-gray-400 text-xs px-5 py-3">Price</th>
                <th className="text-right text-gray-400 text-xs px-5 py-3">Quantity</th>
                <th className="text-right text-gray-400 text-xs px-5 py-3">Fees</th>
                <th className="text-center text-gray-400 text-xs px-5 py-3">Type</th>
              </tr>
            </thead>
            <tbody>
              {allTxns.map((t: any) => (
                <tr key={t.id} className="border-b border-gray-700/50">
                  <td className="px-5 py-3 text-gray-300 text-sm">{new Date(t.timestamp).toLocaleString()}</td>
                  <td className="px-5 py-3 text-white text-sm">{t.portfolioId}</td>
                  <td className="px-5 py-3 text-white text-sm font-medium">{t.canonicalSymbol}</td>
                  <td className="px-5 py-3"><span className={`text-xs px-2 py-0.5 rounded ${t.side === 'buy' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>{t.side.toUpperCase()}</span></td>
                  <td className="px-5 py-3 text-right text-white text-sm">${t.price.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right text-gray-300 text-sm">{t.quantity}</td>
                  <td className="px-5 py-3 text-right text-gray-300 text-sm">${t.fees.toFixed(2)}</td>
                  <td className="px-5 py-3 text-center"><span className="text-xs bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded">PAPER</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================
// SETTINGS
// ============================================================
function SettingsView({ store }: { store: AppStore }) {
  const { settings, updateSettings } = store;
  const [local, setLocal] = useState(settings);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    updateSettings(local);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Settings</h2>
          <p className="text-gray-400 text-sm mt-1">Persistent configuration — stored in browser</p>
        </div>
        <button onClick={handleSave} className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${saved ? 'bg-emerald-500 text-white' : 'bg-emerald-500 hover:bg-emerald-600 text-white'}`}>
          {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {saved ? 'Saved!' : 'Save Changes'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Portfolio */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
          <h3 className="text-white font-semibold mb-4">Portfolio</h3>
          <div className="space-y-3">
            <SettingInput label="Default Capital ($)" value={local.portfolio.defaultCapital} onChange={v => setLocal({...local, portfolio: {...local.portfolio, defaultCapital: Number(v)}})} />
            <SettingInput label="Max Single Asset Weight (%)" value={local.portfolio.maxSingleAssetWeight * 100} onChange={v => setLocal({...local, portfolio: {...local.portfolio, maxSingleAssetWeight: Number(v)/100}})} />
            <SettingInput label="Max Assets" value={local.portfolio.maxAssets} onChange={v => setLocal({...local, portfolio: {...local.portfolio, maxAssets: Number(v)}})} />
            <SettingInput label="Min Allocation (%)" value={local.portfolio.minAllocation * 100} onChange={v => setLocal({...local, portfolio: {...local.portfolio, minAllocation: Number(v)/100}})} />
          </div>
        </div>

        {/* Risk */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
          <h3 className="text-white font-semibold mb-4">Risk Management</h3>
          <div className="space-y-3">
            <SettingInput label="Max Drawdown (%)" value={local.risk.maxDrawdown * 100} onChange={v => setLocal({...local, risk: {...local.risk, maxDrawdown: Number(v)/100}})} />
            <SettingInput label="Daily Loss Limit (%)" value={local.risk.dailyLossLimit * 100} onChange={v => setLocal({...local, risk: {...local.risk, dailyLossLimit: Number(v)/100}})} />
            <SettingInput label="Max Leverage" value={local.risk.maxLeverage} onChange={v => setLocal({...local, risk: {...local.risk, maxLeverage: Number(v)}})} />
            <SettingInput label="Max Positions" value={local.risk.maxPositions} onChange={v => setLocal({...local, risk: {...local.risk, maxPositions: Number(v)}})} />
          </div>
        </div>

        {/* AI */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
          <h3 className="text-white font-semibold mb-4">AI Configuration</h3>
          <div className="space-y-3">
            <div>
              <label className="text-gray-400 text-sm block mb-1">Model Preference</label>
              <select value={local.ai.modelPreference} onChange={e => setLocal({...local, ai: {...local.ai, modelPreference: e.target.value}})}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white text-sm">
                <option value="auto">Auto</option>
                <option value="cloudflare">Cloudflare Workers AI</option>
                <option value="ollama">Local Ollama</option>
              </select>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white text-sm">AI Council</span>
              <button onClick={() => setLocal({...local, ai: {...local.ai, councilEnabled: !local.ai.councilEnabled}})}
                className={`w-11 h-6 rounded-full relative ${local.ai.councilEnabled ? 'bg-emerald-500' : 'bg-gray-600'}`}>
                <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-transform ${local.ai.councilEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            <SettingInput label="Timeout (ms)" value={local.ai.timeoutMs} onChange={v => setLocal({...local, ai: {...local.ai, timeoutMs: Number(v)}})} />
          </div>
        </div>

        {/* Application */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
          <h3 className="text-white font-semibold mb-4">Application</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-white text-sm">PAPER Only Mode</span>
              <span className="text-emerald-400 text-sm font-medium">Always ON</span>
            </div>
            <p className="text-gray-500 text-xs">This application does not support live trading. All execution is simulated.</p>
            <SettingInput label="Evaluation Frequency (min)" value={local.application.evaluationFrequencyMs / 60000} onChange={v => setLocal({...local, application: {...local.application, evaluationFrequencyMs: Number(v) * 60000}})} />
            <SettingInput label="Ranking Frequency (min)" value={local.application.rankingFrequencyMs / 60000} onChange={v => setLocal({...local, application: {...local.application, rankingFrequencyMs: Number(v) * 60000}})} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingInput({ label, value, onChange }: { label: string; value: number; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-gray-400 text-sm block mb-1">{label}</label>
      <input type="number" value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-emerald-500/50" />
    </div>
  );
}

// ============================================================
// CROSS-VENUE COMPARISON
// ============================================================
function CrossVenueView({ store }: { store: AppStore }) {
  const { markets } = store;
  const majorSymbols = ['BTC', 'ETH', 'SOL', 'AVAX', 'LINK'];
  
  const comparisons = majorSymbols.map(sym => ({
    ...compareAcrossVenues(markets, sym),
    canonicalSymbol: sym,
  })).filter(c => c.venues.length > 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Cross-Venue Validation</h2>
        <p className="text-gray-400 text-sm mt-1">Price comparison across exchanges — flagging material discrepancies</p>
      </div>

      {comparisons.length === 0 && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-12 text-center">
          <p className="text-white font-medium">No cross-venue data available</p>
          <p className="text-gray-400 text-sm mt-2">Connect multiple providers to compare prices</p>
        </div>
      )}

      <div className="space-y-3">
        {comparisons.map(comp => (
          <div key={comp.canonicalSymbol} className={`bg-gray-800/50 border rounded-xl p-5 ${comp.flagged ? 'border-amber-500/30' : 'border-gray-700'}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <span className="text-white font-bold text-lg">{comp.canonicalSymbol}</span>
                {comp.flagged && (
                  <span className="text-xs px-2 py-1 rounded-full bg-amber-500/20 text-amber-400">
                    ⚠ SPREAD ALERT
                  </span>
                )}
              </div>
              <div className="text-right">
                <p className="text-gray-400 text-xs">Median Price</p>
                <p className="text-white font-mono font-semibold">
                  {comp.medianPrice ? comp.medianPrice < 1 ? comp.medianPrice.toFixed(4) : comp.medianPrice.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
                </p>
              </div>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {comp.venues.map(v => (
                <div key={v.provider} className="bg-gray-900/50 rounded-lg p-3">
                  <p className="text-gray-400 text-xs capitalize">{v.provider}</p>
                  <p className="text-white font-mono text-sm">
                    {v.price ? v.price < 1 ? v.price.toFixed(4) : v.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
                  </p>
                  <p className={`text-xs mt-1 ${v.freshness === 'LIVE' ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {v.freshness}
                  </p>
                </div>
              ))}
            </div>
            
            {comp.maxSpreadPercent !== null && (
              <div className="mt-3 pt-3 border-t border-gray-700/50 flex items-center justify-between">
                <span className="text-gray-400 text-xs">Max Spread</span>
                <span className={`text-sm font-medium ${comp.flagged ? 'text-amber-400' : 'text-gray-300'}`}>
                  ${comp.maxSpread?.toFixed(2)} ({comp.maxSpreadPercent.toFixed(3)}%)
                </span>
              </div>
            )}
            {comp.flagReason && (
              <p className="text-amber-400 text-xs mt-2">{comp.flagReason}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// CHAT / COPILOT
// ============================================================
function ChatView({ store }: { store: AppStore }) {
  const { markets, portfolios, latestRanking, agents, providerStatuses } = store;
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([
    { role: 'assistant', content: 'Live AI is connected. I can analyze current portfolios, rankings, provider status, and market state using the VPS AI router.' }
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    const userMsg = input.trim();
    const history = messages.slice(-10);
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setInput('');
    setSending(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          history,
          context: {
            mode: 'PAPER_ONLY',
            markets: markets.slice(0, 30),
            portfolios,
            latestRanking,
            agents,
            providerStatuses,
          },
        }),
      });
      let data: any = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'AI request failed');
      if (data.pending && data.jobId) {
        const deadline = Date.now() + 240000;
        let completed = false;
        while (Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          const poll = await fetch(`/api/chat/${encodeURIComponent(data.jobId)}`, { cache: 'no-store' });
          const job = await poll.json();
          if (!poll.ok || !job.ok) throw new Error(job.error || 'AI job polling failed');
          if (job.status === 'done') {
            data = job.result;
            completed = true;
            break;
          }
          if (job.status === 'error') throw new Error(job.result?.error || 'All AI providers failed');
        }
        if (!completed) throw new Error('AI response timed out');
      }
      const source = `${data.provider} / ${data.model}${data.fallbackUsed ? ' (fallback)' : ''}`;
      setMessages(prev => [...prev, { role: 'assistant', content: `${data.content}\n\nAI source: ${source} · ${data.latencyMs} ms` }]);
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `AI backend error: ${e.message || 'request failed'}` }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Research Copilot</h2>
        <p className="text-gray-400 text-sm mt-1">Live AI with OmniRoute primary, FreeLLM, Ollama and Hermes fallback</p>
      </div>

      <div className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden flex flex-col" style={{ height: '600px' }}>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-lg px-4 py-3 ${msg.role === 'user' ? 'bg-emerald-500/20 text-white' : 'bg-gray-700/50 text-gray-200'}`}>
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-gray-700/50 rounded-lg px-4 py-3 flex items-center gap-2 text-gray-300 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> AI is analyzing current state...
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-gray-700 p-4 flex gap-3">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder="Ask about portfolios, rankings, market data..."
            disabled={sending}
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-emerald-500/50 disabled:opacity-50"
          />
          <button onClick={handleSend} disabled={sending || !input.trim()} className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white px-4 py-2 rounded-lg">
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {['What are the five portfolios?', 'Which has the lowest drawdown?', 'Show BTC exposure', 'Why was a portfolio disqualified?'].map(q => (
          <button key={q} onClick={() => setInput(q)}
            className="text-xs bg-gray-800 border border-gray-700 text-gray-300 px-3 py-1.5 rounded-lg hover:border-emerald-500/50 hover:text-emerald-400">
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

function generateChatResponse(
  question: string,
  state: { markets: MarketObservation[]; portfolios: Portfolio[]; latestRanking: RankingRun | null; agents: TradingAgent[]; providerStatuses: any[] }
): string {
  const q = question.toLowerCase();
  
  // Portfolio questions
  if (q.includes('five portfolios') || q.includes('5 portfolios') || q.includes('what are the')) {
    if (state.portfolios.length === 0) return 'No portfolios have been generated yet. Go to Portfolio Builder and click "Generate Five Portfolios" after market data loads.';
    return state.portfolios.map(p => {
      const metrics = p.metrics;
      return `• ${p.id} — ${p.name}\n  Assets: ${p.assets.map(a => a.canonicalSymbol).join(', ')}\n  Sharpe: ${metrics?.sharpeRatio?.toFixed(2) ?? '—'} | Max DD: ${metrics?.maxDrawdown ? (metrics.maxDrawdown * 100).toFixed(1) + '%' : '—'}\n  Rank: ${p.rank ?? 'Not ranked'}`;
    }).join('\n\n');
  }
  
  // Ranking questions
  if (q.includes('rank') || q.includes('recommended') || q.includes('top')) {
    if (!state.latestRanking) return 'No ranking has been run yet. Generate portfolios and evaluate them first.';
    const top = state.latestRanking.results.find(r => !r.disqualified);
    if (!top) return 'All portfolios are currently disqualified.';
    const p = state.portfolios.find(pp => pp.id === top.portfolioId);
    return `Top ranked: ${top.portfolioId} — ${p?.name}\nScore: ${top.score.toFixed(1)}/100\nLabel: ${top.label}\n\nScore breakdown:\n${Object.entries(top.scoreBreakdown).filter(([k]) => k !== 'total' && k !== 'maxTotal').map(([k, v]) => {
      const val = v as { score: number; max: number };
      return `  ${k.replace(/([A-Z])/g, ' $1').trim()}: ${val.score.toFixed(1)}/${val.max}`;
    }).join('\n')}`;
  }
  
  // Drawdown questions
  if (q.includes('drawdown') || q.includes('lowest') || q.includes('risk')) {
    if (state.portfolios.length === 0) return 'No portfolios available to analyze.';
    const sorted = [...state.portfolios].filter(p => p.metrics?.maxDrawdown != null).sort((a, b) => (a.metrics!.maxDrawdown!) - (b.metrics!.maxDrawdown!));
    if (sorted.length === 0) return 'No portfolio metrics calculated yet.';
    return sorted.map(p => `${p.id}: Max DD ${(p.metrics!.maxDrawdown! * 100).toFixed(1)}%`).join('\n');
  }
  
  // BTC exposure
  if (q.includes('btc') || q.includes('exposure')) {
    const btcExposure = state.portfolios.map(p => {
      const btcAsset = p.assets.find(a => a.canonicalSymbol === 'BTC');
      return `${p.id}: ${btcAsset ? btcAsset.allocationPercent.toFixed(1) + '% BTC' : 'No BTC exposure'}`;
    });
    return btcExposure.length > 0 ? btcExposure.join('\n') : 'No portfolios to analyze.';
  }
  
  // Provider status
  if (q.includes('provider') || q.includes('stale') || q.includes('connect')) {
    return state.providerStatuses.map(p => `${p.name}: ${p.status} (${p.latencyMs}ms)`).join('\n');
  }
  
  // Disqualified
  if (q.includes('disqualif')) {
    const disqualified = state.portfolios.filter(p => p.status === 'disqualified');
    if (disqualified.length === 0) return 'No portfolios are currently disqualified.';
    return disqualified.map(p => `${p.id}: ${p.disqualificationReason || 'Unknown reason'}`).join('\n');
  }
  
  // Agent status
  if (q.includes('agent')) {
    if (state.agents.length === 0) return 'No agents created yet.';
    return state.agents.map(a => `${a.name}: ${a.status} | ${a.strategy} | P&L: $${a.pnl.toFixed(2)}`).join('\n');
  }
  
  // Market data
  if (q.includes('market') || q.includes('price') || q.includes('btc')) {
    const topMarkets = state.markets.filter(m => m.volume24h && m.volume24h > 1e9).slice(0, 5);
    if (topMarkets.length === 0) return 'No market data available.';
    return topMarkets.map(m => `${m.canonicalSymbol}: $${m.price?.toLocaleString()} (${m.change24h?.toFixed(2)}%) [${m.provider}]`).join('\n');
  }
  
  return `I can help with:\n• Portfolio questions ("What are the five portfolios?")\n• Rankings ("Which is recommended?")\n• Risk analysis ("Which has lowest drawdown?")\n• Exposure ("Show BTC exposure")\n• Provider status ("Which providers are stale?")\n• Disqualification reasons\n• Agent status\n• Market data\n\nAll answers are based on current application state.`;
}

// ============================================================
// MAIN APP
// ============================================================
export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const store = useAppStore();

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard': return <Dashboard store={store} />;
      case 'agents': return <AgentsPanel store={store} />;
      case 'portfolio-builder': return <PortfolioBuilder store={store} />;
      case 'evaluation': return <PortfolioEvaluation store={store} />;
      case 'ranking': return <RankingView store={store} />;
      case 'cross-venue': return <CrossVenueView store={store} />;
      case 'chat': return <ChatView store={store} />;
      case 'omniroute': return <OmniRouteView store={store} />;
      case 'market': return <MarketDataView store={store} />;
      case 'trades': return <TradeHistoryView store={store} />;
      case 'settings': return <SettingsView store={store} />;
      default: return <Dashboard store={store} />;
    }
  };

  return (
    <div className="flex min-h-screen bg-gray-950">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
      <main className="flex-1 p-6 lg:p-8 overflow-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex-1" />
          <div className="flex items-center gap-4 ml-auto">
            <div className="hidden md:flex items-center gap-2 bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2">
              <div className={`w-2 h-2 rounded-full ${store.markets.length > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'}`} />
              <span className="text-gray-300 text-xs">{store.markets.length} markets</span>
            </div>
            <div className="hidden md:flex items-center gap-2 bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2">
              <span className="text-amber-400 text-xs font-medium">PAPER ONLY</span>
            </div>
          </div>
        </div>
        {renderContent()}
      </main>
    </div>
  );
}