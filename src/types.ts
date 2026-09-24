// ============================================================
// CORE DOMAIN TYPES
// ============================================================

export type AssetClass = 'crypto' | 'equity' | 'etf' | 'fx' | 'commodity' | 'proxy';
export type MarketType = 'SPOT' | 'PERPETUAL' | 'EQUITY' | 'ETF' | 'FX' | 'COMMODITY' | 'PROXY';
export type DataFreshness = 'LIVE' | 'DELAYED' | 'STALE' | 'DISCONNECTED' | 'NOT_CONFIGURED' | 'RATE_LIMITED';
export type ProviderStatus = 'connected' | 'disconnected' | 'stale' | 'not_configured' | 'rate_limited' | 'error';
export type AgentStatus = 'running' | 'paused' | 'stopped' | 'error';
export type TradeSide = 'buy' | 'sell';
export type PortfolioStatus = 'draft' | 'evaluated' | 'ranked' | 'paper_active' | 'paper_paused' | 'archived' | 'disqualified';
export type RankingLabel = 'RECOMMENDED FOR PAPER' | 'PAPER CANDIDATE' | 'WATCH' | 'HIGH RISK' | 'DATA INSUFFICIENT' | 'DISQUALIFIED';
export type RoutingMode = 'auto' | 'priority' | 'load_balance';

export interface ProviderConfig {
  id: string;
  name: string;
  type: 'binance' | 'coinbase' | 'hyperliquid' | 'alpaca' | 'twelvedata';
  status: ProviderStatus;
  assetClasses: AssetClass[];
  lastHeartbeat: number | null;
  lastMessageAt: number | null;
  messageCount: number;
  errorCount: number;
  configured: boolean;
  configRequired: string[];
  latencyMs: number | null;
}

export interface Instrument {
  canonicalSymbol: string;
  providerSymbol: string;
  provider: string;
  assetClass: AssetClass;
  marketType: MarketType;
  name: string;
  baseCurrency?: string;
  quoteCurrency?: string;
}

export interface MarketObservation {
  provider: string;
  canonicalSymbol: string;
  providerSymbol: string;
  assetClass: AssetClass;
  marketType: MarketType;
  timestamp: number;
  receivedAt: number;
  price: number | null;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  change24h: number | null;
  volume24h: number | null;
  high24h: number | null;
  low24h: number | null;
  freshness: DataFreshness;
  dataQuality: 'good' | 'degraded' | 'poor' | 'unknown';
  fundingRate?: number;
  openInterest?: number;
  markPrice?: number;
  oraclePrice?: number;
  basis?: number;
}

export interface OHLCVBar {
  provider: string;
  canonicalSymbol: string;
  timestamp: number;
  interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sourceTimestamp: number;
  ingestionTimestamp: number;
}

export interface CrossVenueComparison {
  canonicalSymbol: string;
  venues: {
    provider: string;
    price: number | null;
    freshness: DataFreshness;
    timestamp: number;
  }[];
  medianPrice: number | null;
  maxSpread: number | null;
  maxSpreadPercent: number | null;
  flagged: boolean;
  flagReason?: string;
}

export interface PortfolioAsset {
  canonicalSymbol: string;
  provider: string;
  weight: number;
  allocationPercent: number;
  marketType: MarketType;
  assetClass: AssetClass;
}

export interface Portfolio {
  id: string;
  version: number;
  name: string;
  description: string;
  sleeve: 'crypto_derivatives' | 'crypto_spot' | 'us_equities' | 'fx' | 'cross_asset';
  status: PortfolioStatus;
  assets: PortfolioAsset[];
  generatedAt: number;
  generatorParams: Record<string, unknown>;
  dataSnapshotId: string;
  metrics: PortfolioMetrics | null;
  rank: number | null;
  rankingScore: number | null;
  scoreBreakdown: ScoreBreakdown | null;
  rankingLabel: RankingLabel | null;
  priorRank: number | null;
  disqualificationReason?: string;
  paperAccount?: PaperAccount;
  aiCommentary?: AICommentary;
  universeLabel: string;
}

export interface PortfolioMetrics {
  cumulativeReturn: number | null;
  annualizedReturn: number | null;
  dailyReturn: number | null;
  realizedVolatility: number | null;
  downsideVolatility: number | null;
  maxDrawdown: number | null;
  currentDrawdown: number | null;
  var95: number | null;
  cvar95: number | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  calmarRatio: number | null;
  avgPairwiseCorrelation: number | null;
  concentration: number | null;
  diversificationScore: number | null;
  effectivePositions: number | null;
  estimatedSpreadCost: number | null;
  estimatedFees: number | null;
  liquidityScore: number | null;
  momentumScore: number | null;
  volatilityRegime: 'low' | 'normal' | 'high' | 'extreme' | null;
  trendRegime: 'bull' | 'bear' | 'sideways' | null;
  avgFundingRate: number | null;
  evaluationWindow: string;
  observationCount: number;
  evaluatedAt: number;
  dataSources: string[];
  dataFreshness: DataFreshness;
}

export interface ScoreBreakdown {
  riskAdjustedPerformance: { score: number; max: number };
  drawdownResilience: { score: number; max: number };
  volatilityControl: { score: number; max: number };
  liquidity: { score: number; max: number };
  diversification: { score: number; max: number };
  momentumRegime: { score: number; max: number };
  historicalRobustness: { score: number; max: number };
  fundingCarry: { score: number; max: number };
  dataQuality: { score: number; max: number };
  total: number;
  maxTotal: number;
}

export interface RankingRun {
  id: string;
  timestamp: number;
  portfolioIds: string[];
  results: RankingResult[];
  config: RankingConfig;
  dataSnapshotId: string;
}

export interface RankingResult {
  portfolioId: string;
  rank: number;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  label: RankingLabel;
  disqualified: boolean;
  disqualificationReason?: string;
  priorRank: number | null;
  rankChange: number;
}

export interface RankingConfig {
  weights: {
    riskAdjustedPerformance: number;
    drawdownResilience: number;
    volatilityControl: number;
    liquidity: number;
    diversification: number;
    momentumRegime: number;
    historicalRobustness: number;
    fundingCarry: number;
    dataQuality: number;
  };
}

export interface AICommentary {
  summary: string;
  whyRankedHere: string;
  strengths: string[];
  weaknesses: string[];
  mainRisks: string[];
  marketRegime: string;
  invalidationConditions: string;
  comparisonWithRank2: string;
  recommendationStatus: RankingLabel;
  confidence: number;
  model: string;
  provider: string;
  timestamp: number;
  latencyMs: number;
}

export interface AIProviderConfig {
  id: string;
  name: string;
  type: 'cloudflare' | 'openai_compatible' | 'ollama';
  endpoint: string;
  model: string;
  status: ProviderStatus;
  latencyMs: number | null;
  lastChecked: number | null;
  priority: number;
  configured: boolean;
  configRequired: string[];
}

export interface TradingAgent {
  id: string;
  name: string;
  strategy: string;
  status: AgentStatus;
  market: string;
  universe: string[];
  timeframe: string;
  riskProfile: 'conservative' | 'moderate' | 'aggressive';
  capitalAllocation: number;
  enabled: boolean;
  modelProvider?: string;
  createdAt: number;
  updatedAt: number;
  lastTradeAt: number | null;
  totalTrades: number;
  pnl: number;
  error?: string;
}

export interface PaperAccount {
  portfolioId: string;
  initialCapital: number;
  cash: number;
  positions: PaperPosition[];
  realizedPnl: number;
  unrealizedPnl: number;
  totalFees: number;
  totalFunding: number;
  equity: number;
  peakEquity: number;
  drawdown: number;
  transactions: PaperTransaction[];
  startedAt: number;
  status: 'active' | 'paused' | 'stopped';
  assumptions: PaperAssumptions;
}

export interface PaperPosition {
  canonicalSymbol: string;
  provider: string;
  quantity: number;
  averageCost: number;
  currentPrice: number | null;
  marketValue: number;
  unrealizedPnl: number;
}

export interface PaperTransaction {
  id: string;
  portfolioId: string;
  timestamp: number;
  canonicalSymbol: string;
  provider: string;
  side: TradeSide;
  quantity: number;
  price: number;
  fees: number;
  total: number;
  simulated: true;
  assumptions: PaperAssumptions;
}

export interface PaperAssumptions {
  feesPercent: number;
  spreadPercent: number;
  slippagePercent: number;
  fillDelayMs: number;
}

export interface AppSettings {
  portfolio: {
    defaultCapital: number;
    minimumCashReserve: number;
    maxSingleAssetWeight: number;
    maxAssets: number;
    minAllocation: number;
  };
  risk: {
    maxDrawdown: number;
    dailyLossLimit: number;
    riskPerTrade: number;
    maxLeverage: number;
    maxPositions: number;
  };
  data: {
    enabledProviders: string[];
    freshnessThresholds: Record<string, number>;
    historicalIntervals: string[];
    providerPriorities: string[];
  };
  ai: {
    enabledProviders: string[];
    modelPreference: string;
    councilEnabled: boolean;
    timeoutMs: number;
    maxRetries: number;
  };
  application: {
    paperOnly: boolean;
    evaluationFrequencyMs: number;
    rankingFrequencyMs: number;
  };
}

export interface AppState {
  providers: ProviderConfig[];
  instruments: Instrument[];
  markets: Map<string, MarketObservation>;
  portfolios: Portfolio[];
  rankingRuns: RankingRun[];
  agents: TradingAgent[];
  settings: AppSettings;
  aiProviders: AIProviderConfig[];
  lastMarketUpdate: number | null;
  lastRankingAt: number | null;
  universeLabel: string;
}
