/**
 * APPLICATION STATE HOOK
 * 
 * Central state management for the entire application.
 * Fetches real data from providers, manages portfolios, agents, settings.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { 
  MarketObservation, OHLCVBar, Portfolio, RankingRun, TradingAgent, 
  AppSettings, ProviderConfig, DataFreshness 
} from '../types';
import { fetchAllMarkets, fetchHistoricalData } from './providers';
import { generatePortfolios, rankPortfolios } from './portfolioEngine';
import { 
  loadAgents, saveAgents, loadPortfolios, savePortfolios, 
  loadRankings, saveRankings, loadSettings, saveSettings, 
  defaultSettings, loadPaperTransactions, savePaperTransactions 
} from './storage';

export interface AppStore {
  markets: MarketObservation[];
  historicalData: Map<string, OHLCVBar[]>;
  providerStatuses: ProviderConfig[];
  lastMarketUpdate: number | null;
  marketsLoading: boolean;
  marketsError: string | null;
  portfolios: Portfolio[];
  portfoliosLoading: boolean;
  rankingRuns: RankingRun[];
  latestRanking: RankingRun | null;
  agents: TradingAgent[];
  settings: AppSettings;
  paperTransactions: any[];
  refreshMarkets: () => Promise<void>;
  generateNewPortfolios: () => Promise<void>;
  runRanking: () => void;
  updateAgent: (id: string, updates: Partial<TradingAgent>) => void;
  createAgent: (agent: TradingAgent) => void;
  updateSettings: (settings: AppSettings) => void;
  startPaper: (portfolioId: string) => void;
  pausePaper: (portfolioId: string) => void;
}

export function useAppStore(): AppStore {
  const [markets, setMarkets] = useState<MarketObservation[]>([]);
  const [historicalData, setHistoricalData] = useState<Map<string, OHLCVBar[]>>(new Map());
  const [providerStatuses, setProviderStatuses] = useState<ProviderConfig[]>([]);
  const [lastMarketUpdate, setLastMarketUpdate] = useState<number | null>(null);
  const [marketsLoading, setMarketsLoading] = useState(false);
  const [marketsError, setMarketsError] = useState<string | null>(null);
  const [portfolios, setPortfolios] = useState<Portfolio[]>(() => loadPortfolios());
  const [portfoliosLoading, setPortfoliosLoading] = useState(false);
  const [rankingRuns, setRankingRuns] = useState<RankingRun[]>(() => loadRankings());
  const [agents, setAgents] = useState<TradingAgent[]>(() => loadAgents());
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [paperTransactions, setPaperTransactions] = useState(() => loadPaperTransactions());
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval>>();

  const refreshMarkets = useCallback(async () => {
    setMarketsLoading(true);
    setMarketsError(null);
    try {
      const result = await fetchAllMarkets();
      setMarkets(result.observations);
      setLastMarketUpdate(result.fetchedAt);

      const providers: ProviderConfig[] = result.providerStatuses.map(ps => ({
        id: ps.provider,
        name: ps.provider.charAt(0).toUpperCase() + ps.provider.slice(1),
        type: ps.provider as any,
        status: ps.status === 'connected' ? 'connected' : 'error',
        assetClasses: ['crypto'],
        lastHeartbeat: result.fetchedAt,
        lastMessageAt: result.fetchedAt,
        messageCount: 0,
        errorCount: ps.error ? 1 : 0,
        configured: true,
        configRequired: [],
        latencyMs: ps.latencyMs,
      }));
      setProviderStatuses(providers);

      const topSymbols = result.observations
        .filter(o => o.volume24h !== null && o.volume24h! > 100000000)
        .slice(0, 10)
        .map(o => o.canonicalSymbol);

      if (topSymbols.length > 0) {
        const hist = await fetchHistoricalData(topSymbols, '1d', 90);
        setHistoricalData(hist);
      }
    } catch (e: any) {
      setMarketsError(e.message || 'Failed to fetch market data');
    } finally {
      setMarketsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshMarkets();
    refreshIntervalRef.current = setInterval(refreshMarkets, 30000);
    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    };
  }, [refreshMarkets]);

  const generateNewPortfolios = useCallback(async () => {
    if (markets.length === 0 || historicalData.size === 0) return;
    setPortfoliosLoading(true);
    try {
      const newPortfolios = generatePortfolios(markets, historicalData);
      setPortfolios(newPortfolios);
      savePortfolios(newPortfolios);
    } finally {
      setPortfoliosLoading(false);
    }
  }, [markets, historicalData]);

  const runRanking = useCallback(() => {
    if (portfolios.length === 0) return;
    const run = rankPortfolios(portfolios);

    const updatedPortfolios = portfolios.map(p => {
      const result = run.results.find(r => r.portfolioId === p.id);
      if (result) {
        return {
          ...p,
          rank: result.rank,
          rankingScore: result.score,
          scoreBreakdown: result.scoreBreakdown,
          rankingLabel: result.label,
          priorRank: p.rank,
          status: result.disqualified ? 'disqualified' as const : p.status,
          disqualificationReason: result.disqualificationReason,
        };
      }
      return p;
    });

    setPortfolios(updatedPortfolios);
    savePortfolios(updatedPortfolios);
    setRankingRuns(prev => {
      const updated = [run, ...prev].slice(0, 50);
      saveRankings(updated);
      return updated;
    });
  }, [portfolios]);

  const latestRanking = rankingRuns.length > 0 ? rankingRuns[0] : null;

  const updateAgent = useCallback((id: string, updates: Partial<TradingAgent>) => {
    setAgents(prev => {
      const updated = prev.map(a => a.id === id ? { ...a, ...updates, updatedAt: Date.now() } : a);
      saveAgents(updated);
      return updated;
    });
  }, []);

  const createAgent = useCallback((agent: TradingAgent) => {
    setAgents(prev => {
      const updated = [...prev, agent];
      saveAgents(updated);
      return updated;
    });
  }, []);

  const updateSettings = useCallback((newSettings: AppSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
  }, []);

  const startPaper = useCallback((portfolioId: string) => {
    setPortfolios(prev => {
      const updated = prev.map(p => {
        if (p.id === portfolioId) {
          return {
            ...p,
            status: 'paper_active' as const,
            paperAccount: {
              portfolioId,
              initialCapital: settings.portfolio.defaultCapital,
              cash: settings.portfolio.defaultCapital,
              positions: [],
              realizedPnl: 0,
              unrealizedPnl: 0,
              totalFees: 0,
              totalFunding: 0,
              equity: settings.portfolio.defaultCapital,
              peakEquity: settings.portfolio.defaultCapital,
              drawdown: 0,
              transactions: [],
              startedAt: Date.now(),
              status: 'active' as const,
              assumptions: { feesPercent: 0.1, spreadPercent: 0.05, slippagePercent: 0.02, fillDelayMs: 100 },
            },
          };
        }
        return p;
      });
      savePortfolios(updated);
      return updated;
    });
  }, [settings]);

  const pausePaper = useCallback((portfolioId: string) => {
    setPortfolios(prev => {
      const updated = prev.map(p => {
        if (p.id === portfolioId && p.paperAccount) {
          return {
            ...p,
            status: 'paper_paused' as const,
            paperAccount: { ...p.paperAccount, status: 'paused' as const },
          };
        }
        return p;
      });
      savePortfolios(updated);
      return updated;
    });
  }, []);

  return {
    markets,
    historicalData,
    providerStatuses,
    lastMarketUpdate,
    marketsLoading,
    marketsError,
    portfolios,
    portfoliosLoading,
    rankingRuns,
    latestRanking,
    agents,
    settings,
    paperTransactions,
    refreshMarkets,
    generateNewPortfolios,
    runRanking,
    updateAgent,
    createAgent,
    updateSettings,
    startPaper,
    pausePaper,
  };
}
