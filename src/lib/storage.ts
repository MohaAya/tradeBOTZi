/**
 * PERSISTENCE LAYER
 * 
 * Currently uses localStorage for browser persistence.
 * Interface is designed to be swapped for a backend API.
 * 
 * In production with a backend, these functions would call REST endpoints.
 */

import type { TradingAgent, Portfolio, RankingRun, AppSettings, PaperTransaction } from '../types';

const KEYS = {
  AGENTS: 'zbot_agents',
  PORTFOLIOS: 'zbot_portfolios',
  RANKINGS: 'zbot_rankings',
  SETTINGS: 'zbot_settings',
  PAPER_TRANSACTIONS: 'zbot_paper_txns',
};

export const defaultSettings: AppSettings = {
  portfolio: {
    defaultCapital: 100000,
    minimumCashReserve: 0.05,
    maxSingleAssetWeight: 0.35,
    maxAssets: 8,
    minAllocation: 0.05,
  },
  risk: {
    maxDrawdown: 0.25,
    dailyLossLimit: 0.05,
    riskPerTrade: 0.02,
    maxLeverage: 3,
    maxPositions: 10,
  },
  data: {
    enabledProviders: ['binance', 'coinbase'],
    freshnessThresholds: { crypto: 60, equity: 300, fx: 120 },
    historicalIntervals: ['1h', '4h', '1d'],
    providerPriorities: ['binance', 'coinbase'],
  },
  ai: {
    enabledProviders: [],
    modelPreference: 'auto',
    councilEnabled: false,
    timeoutMs: 30000,
    maxRetries: 3,
  },
  application: {
    paperOnly: true,
    evaluationFrequencyMs: 3600000,
    rankingFrequencyMs: 14400000,
  },
};

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function save<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.error(`Failed to save ${key}:`, e);
  }
}

export function loadAgents(): TradingAgent[] {
  return load<TradingAgent[]>(KEYS.AGENTS, []);
}
export function saveAgents(agents: TradingAgent[]): void {
  save(KEYS.AGENTS, agents);
}
export function loadPortfolios(): Portfolio[] {
  return load<Portfolio[]>(KEYS.PORTFOLIOS, []);
}
export function savePortfolios(portfolios: Portfolio[]): void {
  save(KEYS.PORTFOLIOS, portfolios);
}
export function loadRankings(): RankingRun[] {
  return load<RankingRun[]>(KEYS.RANKINGS, []);
}
export function saveRankings(runs: RankingRun[]): void {
  save(KEYS.RANKINGS, runs);
}
export function loadSettings(): AppSettings {
  return load<AppSettings>(KEYS.SETTINGS, defaultSettings);
}
export function saveSettings(settings: AppSettings): void {
  save(KEYS.SETTINGS, settings);
}
export function loadPaperTransactions(): PaperTransaction[] {
  return load<PaperTransaction[]>(KEYS.PAPER_TRANSACTIONS, []);
}
export function savePaperTransactions(txns: PaperTransaction[]): void {
  save(KEYS.PAPER_TRANSACTIONS, txns);
}
