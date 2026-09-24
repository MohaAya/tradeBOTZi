import React, { useState } from 'react';
import { TrendingUp, TrendingDown, DollarSign, Activity, Target, Shield, BarChart3, Clock, AlertTriangle, Loader2, WifiOff } from 'lucide-react';
import type { AppStore } from '../lib/useAppStore';

interface Props {
  store: AppStore;
}

export default function Dashboard({ store }: Props) {
  const { markets, providerStatuses, portfolios, latestRanking, agents, lastMarketUpdate, marketsLoading, marketsError } = store;
  
  const connectedProviders = providerStatuses.filter(p => p.status === 'connected').length;
  const staleProviders = providerStatuses.filter(p => p.status === 'error' || p.status === 'stale').length;
  const activePortfolios = portfolios.filter(p => p.status === 'paper_active').length;
  const paperPortfolios = portfolios.filter(p => p.status === 'paper_active' || p.status === 'paper_paused');
  const totalPaperPnl = paperPortfolios.reduce((sum, p) => sum + (p.paperAccount?.unrealizedPnl || 0) + (p.paperAccount?.realizedPnl || 0), 0);
  
  const timeSinceUpdate = lastMarketUpdate ? Math.round((Date.now() - lastMarketUpdate) / 1000) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Operator Dashboard</h2>
          <p className="text-gray-400 text-sm mt-1">Real-time system status from live market data</p>
        </div>
        <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-4 py-2">
          {marketsLoading ? (
            <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
          ) : marketsError ? (
            <WifiOff className="w-4 h-4 text-red-400" />
          ) : (
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
          )}
          <span className={`text-sm font-medium ${marketsError ? 'text-red-400' : 'text-emerald-400'}`}>
            {marketsLoading ? 'Fetching...' : marketsError ? 'Error' : 'Live'}
          </span>
          {timeSinceUpdate !== null && !marketsError && (
            <>
              <Clock className="w-4 h-4 text-gray-400 ml-2" />
              <span className="text-gray-400 text-sm">{timeSinceUpdate}s ago</span>
            </>
          )}
        </div>
      </div>

      {marketsError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-400 text-sm font-medium">Market Data Error</p>
            <p className="text-red-300/70 text-xs mt-1">{marketsError}</p>
            <button onClick={store.refreshMarkets} className="mt-2 text-xs bg-red-500/20 text-red-400 px-3 py-1 rounded-md hover:bg-red-500/30">
              Retry
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatusCard label="Connected Providers" value={`${connectedProviders}/${providerStatuses.length}`} sublabel={staleProviders > 0 ? `${staleProviders} error/stale` : 'All healthy'} icon={Activity} color={staleProviders > 0 ? 'amber' : 'emerald'} />
        <StatusCard label="Eligible Markets" value={markets.length > 0 ? markets.length.toString() : '—'} sublabel={markets.length > 0 ? `${markets.filter(m => m.freshness === 'LIVE').length} live` : 'No data'} icon={BarChart3} color="cyan" />
        <StatusCard label="Portfolios Generated" value={portfolios.length > 0 ? portfolios.length.toString() : '—'} sublabel={portfolios.length > 0 ? portfolios[0]?.universeLabel || 'Ready' : 'Click Generate'} icon={Target} color="violet" />
        <StatusCard label="Active PAPER Portfolios" value={activePortfolios.toString()} sublabel={`${paperPortfolios.length} total paper`} icon={DollarSign} color="amber" />
        <StatusCard label="Total Paper P&L" value={paperPortfolios.length > 0 ? `${totalPaperPnl >= 0 ? '+' : ''}$${totalPaperPnl.toFixed(2)}` : '—'} sublabel={paperPortfolios.length > 0 ? 'Virtual accounting' : 'No active paper'} icon={TrendingUp} color={totalPaperPnl >= 0 ? 'emerald' : 'rose'} />
        <StatusCard label="Last Ranking" value={latestRanking ? new Date(latestRanking.timestamp).toLocaleTimeString() : '—'} sublabel={latestRanking ? `${latestRanking.results.filter(r => !r.disqualified).length} ranked` : 'Not yet run'} icon={Shield} color="blue" />
      </div>

      {marketsLoading && markets.length === 0 && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-12 text-center">
          <Loader2 className="w-8 h-8 text-emerald-400 animate-spin mx-auto mb-4" />
          <p className="text-white font-medium">Fetching real market data...</p>
          <p className="text-gray-400 text-sm mt-2">Connecting to Binance and Coinbase public APIs</p>
        </div>
      )}

      {!marketsLoading && markets.length === 0 && !marketsError && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-12 text-center">
          <WifiOff className="w-8 h-8 text-gray-500 mx-auto mb-4" />
          <p className="text-white font-medium">DATA UNAVAILABLE</p>
          <p className="text-gray-400 text-sm mt-2">No market data received. Check network connectivity or provider status.</p>
        </div>
      )}

      {markets.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Top Markets (Live)</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {markets
              .filter(m => m.volume24h !== null && m.volume24h! > 100000000)
              .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
              .slice(0, 12)
              .map(m => (
                <div key={`${m.provider}-${m.canonicalSymbol}`} className="bg-gray-900/50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-white font-medium text-sm">{m.canonicalSymbol}</span>
                    <span className={`text-xs ${m.freshness === 'LIVE' ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {m.provider.slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <p className="text-white text-sm font-mono">
                    ${m.price !== null ? m.price < 1 ? m.price.toFixed(4) : m.price < 100 ? m.price.toFixed(2) : m.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
                  </p>
                  {m.change24h !== null && (
                    <p className={`text-xs flex items-center gap-1 ${m.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {m.change24h >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {m.change24h >= 0 ? '+' : ''}{m.change24h.toFixed(2)}%
                    </p>
                  )}
                </div>
              ))}
          </div>
          <p className="text-gray-500 text-xs mt-3">
            Data source: {markets.length > 0 ? [...new Set(markets.map(m => m.provider))].join(', ') : '—'} | 
            Updated: {lastMarketUpdate ? new Date(lastMarketUpdate).toLocaleTimeString() : '—'}
          </p>
        </div>
      )}
    </div>
  );
}

function StatusCard({ label, value, sublabel, icon: Icon, color }: {
  label: string; value: string; sublabel: string; icon: any; color: string;
}) {
  const colorMap: Record<string, string> = {
    emerald: 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/20',
    cyan: 'from-cyan-500/20 to-cyan-500/5 border-cyan-500/20',
    violet: 'from-violet-500/20 to-violet-500/5 border-violet-500/20',
    amber: 'from-amber-500/20 to-amber-500/5 border-amber-500/20',
    rose: 'from-rose-500/20 to-rose-500/5 border-rose-500/20',
    blue: 'from-blue-500/20 to-blue-500/5 border-blue-500/20',
  };
  const iconColor: Record<string, string> = {
    emerald: 'text-emerald-400', cyan: 'text-cyan-400', violet: 'text-violet-400',
    amber: 'text-amber-400', rose: 'text-rose-400', blue: 'text-blue-400',
  };
  
  return (
    <div className={`bg-gradient-to-br ${colorMap[color]} border rounded-xl p-5`}>
      <div className="flex items-center justify-between mb-3">
        <Icon className={`w-5 h-5 ${iconColor[color]}`} />
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-gray-400 text-sm mt-1">{label}</p>
      <p className={`text-xs mt-1 ${iconColor[color]}`}>{sublabel}</p>
    </div>
  );
}
