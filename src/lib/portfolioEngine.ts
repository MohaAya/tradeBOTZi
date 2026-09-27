/**
 * PORTFOLIO ENGINE
 * 
 * Real portfolio generation, metrics calculation, and deterministic ranking.
 * All calculations are from actual market data - no fabricated values.
 * 
 * Formulas documented inline.
 */

import type { 
  Portfolio, PortfolioMetrics, PortfolioAsset, ScoreBreakdown, 
  RankingRun, RankingResult, RankingConfig, OHLCVBar, MarketObservation,
  DataFreshness, RankingLabel, PortfolioRiskPolicy
} from '../types';

export function calculateReturns(prices: number[]): number[] {
  if (prices.length < 2) return [];
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  return returns;
}

export function calculateVolatility(returns: number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(365);
}

export function calculateDownsideVolatility(returns: number[]): number {
  if (returns.length < 2) return 0;
  const downsideReturns = returns.map(r => Math.min(r, 0));
  const mean = downsideReturns.reduce((s, r) => s + r, 0) / downsideReturns.length;
  const variance = downsideReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (downsideReturns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(365);
}

export function calculateMaxDrawdown(prices: number[]): number {
  if (prices.length < 2) return 0;
  let peak = prices[0];
  let maxDD = 0;
  for (const price of prices) {
    if (price > peak) peak = price;
    const dd = (price - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }
  return maxDD;
}

export function calculateCurrentDrawdown(prices: number[]): number {
  if (prices.length === 0) return 0;
  const peak = Math.max(...prices);
  const current = prices[prices.length - 1];
  return (current - peak) / peak;
}

export function calculateSharpeRatio(returns: number[]): number {
  if (returns.length < 2) return 0;
  const meanReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
  const annualizedReturn = meanReturn * 365;
  const vol = calculateVolatility(returns);
  if (vol === 0) return 0;
  return annualizedReturn / vol;
}

export function calculateSortinoRatio(returns: number[]): number {
  if (returns.length < 2) return 0;
  const meanReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
  const annualizedReturn = meanReturn * 365;
  const downVol = calculateDownsideVolatility(returns);
  if (downVol === 0) return 0;
  return annualizedReturn / downVol;
}

export function calculateCalmarRatio(returns: number[], prices: number[]): number {
  if (returns.length < 2) return 0;
  const meanReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
  const annualizedReturn = meanReturn * 365;
  const maxDD = Math.abs(calculateMaxDrawdown(prices));
  if (maxDD === 0) return 0;
  return annualizedReturn / maxDD;
}

export function calculateCumulativeReturn(prices: number[]): number {
  if (prices.length < 2) return 0;
  return (prices[prices.length - 1] - prices[0]) / prices[0];
}

export function calculateAvgCorrelation(returnsMatrix: number[][]): number {
  if (returnsMatrix.length < 2) return 0;
  let totalCorr = 0;
  let count = 0;
  for (let i = 0; i < returnsMatrix.length; i++) {
    for (let j = i + 1; j < returnsMatrix.length; j++) {
      totalCorr += pearsonCorrelation(returnsMatrix[i], returnsMatrix[j]);
      count++;
    }
  }
  return count > 0 ? totalCorr / count : 0;
}

export function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const meanX = x.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const meanY = y.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

export function calculateConcentration(weights: number[]): number {
  return weights.reduce((s, w) => s + w * w, 0);
}

export function calculateEffectivePositions(weights: number[]): number {
  const h = calculateConcentration(weights);
  return h === 0 ? 0 : 1 / h;
}

export function calculateMomentumScore(returns: number[]): number {
  if (returns.length < 10) return 5;
  const recentReturns = returns.slice(-20);
  const avgReturn = recentReturns.reduce((s, r) => s + r, 0) / recentReturns.length;
  const vol = calculateVolatility(recentReturns);
  if (vol === 0) return 5;
  const signal = avgReturn / vol;
  return Math.max(0, Math.min(10, 5 + signal * 10));
}


function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * Math.max(0, Math.min(1, q));
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}

export function calculateHistoricalVaR(returns: number[], confidence: number = 0.95): number {
  if (returns.length < 10) return 0;
  return quantile(returns, 1 - confidence);
}

export function calculateHistoricalCVaR(returns: number[], confidence: number = 0.95): number {
  if (returns.length < 10) return 0;
  const valueAtRisk = calculateHistoricalVaR(returns, confidence);
  const tail = returns.filter(r => r <= valueAtRisk);
  return tail.length ? tail.reduce((sum, r) => sum + r, 0) / tail.length : valueAtRisk;
}

export function calculateOmegaRatio(returns: number[], threshold: number = 0): number {
  if (returns.length === 0) return 0;
  const gains = returns.reduce((sum, r) => sum + Math.max(r - threshold, 0), 0);
  const losses = returns.reduce((sum, r) => sum + Math.max(threshold - r, 0), 0);
  if (losses === 0) return gains > 0 ? 99 : 0;
  return gains / losses;
}

export function calculateUlcerIndex(prices: number[]): number {
  if (prices.length < 2) return 0;
  let peak = prices[0];
  const squaredDrawdowns: number[] = [];
  for (const price of prices) {
    peak = Math.max(peak, price);
    const drawdown = peak > 0 ? (price - peak) / peak : 0;
    squaredDrawdowns.push(drawdown * drawdown);
  }
  return Math.sqrt(squaredDrawdowns.reduce((sum, x) => sum + x, 0) / squaredDrawdowns.length);
}

export function calculateRecoveryFactor(prices: number[]): number {
  if (prices.length < 2) return 0;
  const totalReturn = calculateCumulativeReturn(prices);
  const maxDrawdown = Math.abs(calculateMaxDrawdown(prices));
  if (maxDrawdown === 0) return totalReturn > 0 ? 99 : 0;
  return totalReturn / maxDrawdown;
}

export function calculateCAGR(prices: number[], periods: number): number {
  if (prices.length < 2 || periods <= 0 || prices[0] <= 0 || prices[prices.length - 1] <= 0) return 0;
  return Math.pow(prices[prices.length - 1] / prices[0], 365 / periods) - 1;
}

function calculatePortfolioRiskScore(metrics: PortfolioMetrics): number {
  const vol = Math.min(1, Math.max(0, (metrics.realizedVolatility || 0) / 1.0));
  const drawdown = Math.min(1, Math.abs(metrics.maxDrawdown || 0) / 0.60);
  const tail = Math.min(1, Math.abs(metrics.cvar95 || 0) / 0.12);
  const concentration = Math.min(1, Math.max(0, ((metrics.concentration || 0) - 0.18) / 0.25));
  const correlation = Math.min(1, Math.max(0, ((metrics.avgPairwiseCorrelation || 0) + 0.2) / 1.2));
  const raw = 1 + (vol * 2.6) + (drawdown * 2.4) + (tail * 1.8) + (concentration * 1.1) + (correlation * 1.1);
  return Math.max(1, Math.min(10, Number(raw.toFixed(1))));
}

function riskBand(score: number): PortfolioRiskPolicy['riskBand'] {
  if (score <= 3) return 'LOW';
  if (score <= 5) return 'MODERATE';
  if (score <= 7) return 'HIGH';
  return 'VERY HIGH';
}

function buildRiskPolicy(letter: string, metrics: PortfolioMetrics): PortfolioRiskPolicy {
  const presets: Record<string, Omit<PortfolioRiskPolicy, 'riskScore' | 'riskBand'>> = {
    A: { maxSingleAssetWeight: 0.35, maxPortfolioExposure: 0.95, cashReserve: 0.05, stopLossPercent: 12, takeProfitPercent: 25, trailingStopPercent: 10, rebalanceDays: 3, cooldownHours: 12, maxDrawdownLimit: 0.35 },
    B: { maxSingleAssetWeight: 0.35, maxPortfolioExposure: 0.90, cashReserve: 0.10, stopLossPercent: 10, takeProfitPercent: 20, trailingStopPercent: 8, rebalanceDays: 7, cooldownHours: 24, maxDrawdownLimit: 0.30 },
    C: { maxSingleAssetWeight: 0.35, maxPortfolioExposure: 0.85, cashReserve: 0.15, stopLossPercent: 9, takeProfitPercent: 18, trailingStopPercent: 7, rebalanceDays: 7, cooldownHours: 24, maxDrawdownLimit: 0.25 },
    D: { maxSingleAssetWeight: 0.35, maxPortfolioExposure: 0.90, cashReserve: 0.10, stopLossPercent: 8, takeProfitPercent: 15, trailingStopPercent: 6, rebalanceDays: 3, cooldownHours: 12, maxDrawdownLimit: 0.25 },
    E: { maxSingleAssetWeight: 0.35, maxPortfolioExposure: 0.75, cashReserve: 0.25, stopLossPercent: 7, takeProfitPercent: 12, trailingStopPercent: 5, rebalanceDays: 14, cooldownHours: 48, maxDrawdownLimit: 0.20 },
  };
  const mandateFloor: Record<string, number> = { A: 7.0, B: 4.5, C: 4.0, D: 4.5, E: 2.5 };
  const riskScore = Number(Math.max(calculatePortfolioRiskScore(metrics), mandateFloor[letter] || 4).toFixed(1));
  return {
    riskScore,
    riskBand: riskBand(riskScore),
    ...(presets[letter] || presets.B),
  };
}

function alignedSymbolReturns(symbol: string, historicalData: Map<string, OHLCVBar[]>): number[] {
  const prices = (historicalData.get(symbol) || []).map(b => b.close);
  return calculateReturns(prices);
}

function selectLowCorrelationAssets(symbols: string[], historicalData: Map<string, OHLCVBar[]>, count: number): string[] {
  if (symbols.length <= count) return [...symbols];
  const returns = new Map(symbols.map(symbol => [symbol, alignedSymbolReturns(symbol, historicalData)]));
  const avgAbsCorr = (symbol: string, peers: string[]) => {
    if (peers.length === 0) return 0;
    const base = returns.get(symbol) || [];
    return peers.reduce((sum, peer) => sum + Math.abs(pearsonCorrelation(base, returns.get(peer) || [])), 0) / peers.length;
  };

  const first = [...symbols]
    .map(symbol => ({ symbol, corr: avgAbsCorr(symbol, symbols.filter(s => s !== symbol)) }))
    .sort((a, b) => a.corr - b.corr)[0]?.symbol;
  if (!first) return symbols.slice(0, count);

  const selected = [first];
  while (selected.length < count) {
    const remaining = symbols.filter(symbol => !selected.includes(symbol));
    if (!remaining.length) break;
    const next = remaining
      .map(symbol => ({ symbol, corr: avgAbsCorr(symbol, selected) }))
      .sort((a, b) => a.corr - b.corr)[0]?.symbol;
    if (!next) break;
    selected.push(next);
  }
  return selected;
}

export function calculatePortfolioMetrics(
  historicalData: Map<string, OHLCVBar[]>,
  weights: Map<string, number>,
  observations: MarketObservation[]
): PortfolioMetrics {
  const symbols = Array.from(weights.keys()).filter(symbol => historicalData.has(symbol));
  const returnsMatrix: number[][] = [];
  const portfolioReturns: number[] = [];

  for (const sym of symbols) {
    const bars = historicalData.get(sym) || [];
    const prices = bars.map(b => b.close);
    const returns = calculateReturns(prices);
    returnsMatrix.push(returns);
  }

  const minLen = returnsMatrix.length ? Math.min(...returnsMatrix.map(r => r.length)) : 0;
  if (minLen > 0) {
    for (let t = 0; t < minLen; t++) {
      let portReturn = 0;
      for (let i = 0; i < symbols.length; i++) {
        const w = weights.get(symbols[i]) || 0;
        portReturn += w * returnsMatrix[i][returnsMatrix[i].length - minLen + t];
      }
      portfolioReturns.push(portReturn);
    }
  }

  const portfolioPrices = [100];
  for (const r of portfolioReturns) portfolioPrices.push(portfolioPrices[portfolioPrices.length - 1] * (1 + r));

  const now = Date.now();
  let freshness: DataFreshness = 'LIVE';
  const dataSources: string[] = [];
  for (const obs of observations) {
    if (symbols.includes(obs.canonicalSymbol)) {
      dataSources.push(obs.provider);
      if (obs.freshness === 'STALE' || obs.freshness === 'DISCONNECTED') freshness = obs.freshness;
    }
  }

  const vol = calculateVolatility(portfolioReturns);
  let volRegime: PortfolioMetrics['volatilityRegime'] = 'normal';
  if (vol < 0.1) volRegime = 'low';
  else if (vol > 0.6) volRegime = 'extreme';
  else if (vol > 0.4) volRegime = 'high';

  const cumRet = calculateCumulativeReturn(portfolioPrices);
  let trendRegime: PortfolioMetrics['trendRegime'] = 'sideways';
  if (cumRet > 0.1) trendRegime = 'bull';
  else if (cumRet < -0.1) trendRegime = 'bear';

  let weightedSpreadCost = 0;
  let weightedLiquidity = 0;
  for (const symbol of symbols) {
    const weight = weights.get(symbol) || 0;
    const candidates = observations
      .filter(obs => obs.canonicalSymbol === symbol && obs.price && obs.price > 0)
      .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
    const obs = candidates[0];
    if (!obs) continue;
    const spreadPct = obs.spread !== null && obs.price ? Math.max(0, obs.spread / obs.price) : 0;
    weightedSpreadCost += weight * spreadPct;
    const volume = Math.max(1, obs.volume24h || 0);
    const liquidityComponent = Math.max(0, Math.min(10, (Math.log10(volume) - 5) * 2));
    weightedLiquidity += weight * liquidityComponent;
  }

  const maxDrawdown = calculateMaxDrawdown(portfolioPrices);
  const cumulativeReturn = calculateCumulativeReturn(portfolioPrices);

  return {
    cumulativeReturn,
    annualizedReturn: portfolioReturns.length > 0 ? (portfolioReturns.reduce((s, r) => s + r, 0) / portfolioReturns.length) * 365 : null,
    cagr: portfolioReturns.length > 0 ? calculateCAGR(portfolioPrices, portfolioReturns.length) : null,
    dailyReturn: portfolioReturns.length > 0 ? portfolioReturns[portfolioReturns.length - 1] : null,
    realizedVolatility: vol,
    downsideVolatility: calculateDownsideVolatility(portfolioReturns),
    maxDrawdown,
    currentDrawdown: calculateCurrentDrawdown(portfolioPrices),
    var95: portfolioReturns.length >= 10 ? calculateHistoricalVaR(portfolioReturns, 0.95) : null,
    cvar95: portfolioReturns.length >= 10 ? calculateHistoricalCVaR(portfolioReturns, 0.95) : null,
    sharpeRatio: calculateSharpeRatio(portfolioReturns),
    sortinoRatio: calculateSortinoRatio(portfolioReturns),
    calmarRatio: calculateCalmarRatio(portfolioReturns, portfolioPrices),
    omegaRatio: portfolioReturns.length ? calculateOmegaRatio(portfolioReturns) : null,
    ulcerIndex: portfolioPrices.length > 1 ? calculateUlcerIndex(portfolioPrices) : null,
    recoveryFactor: portfolioPrices.length > 1 ? calculateRecoveryFactor(portfolioPrices) : null,
    positiveDayRate: portfolioReturns.length ? portfolioReturns.filter(r => r > 0).length / portfolioReturns.length : null,
    bestDay: portfolioReturns.length ? Math.max(...portfolioReturns) : null,
    worstDay: portfolioReturns.length ? Math.min(...portfolioReturns) : null,
    avgPairwiseCorrelation: calculateAvgCorrelation(returnsMatrix),
    concentration: calculateConcentration(Array.from(weights.values())),
    diversificationScore: Math.max(0, 1 - calculateConcentration(Array.from(weights.values()))),
    effectivePositions: calculateEffectivePositions(Array.from(weights.values())),
    estimatedSpreadCost: weightedSpreadCost,
    estimatedFees: 0.002,
    liquidityScore: weightedLiquidity,
    momentumScore: calculateMomentumScore(portfolioReturns),
    volatilityRegime: volRegime,
    trendRegime: trendRegime,
    avgFundingRate: null,
    evaluationWindow: `${minLen} days`,
    observationCount: minLen,
    evaluatedAt: now,
    dataSources: [...new Set(dataSources)],
    dataFreshness: freshness,
  };
}

const STABLECOINS = new Set([
  'USDT', 'USDC', 'FDUSD', 'TUSD', 'USDP', 'DAI', 'BUSD', 'PYUSD', 'USD1', 'RLUSD'
]);

function splitHistoricalData(
  historicalData: Map<string, OHLCVBar[]>,
  evaluationDays: number = 30
): { constructionData: Map<string, OHLCVBar[]>; evaluationData: Map<string, OHLCVBar[]> } {
  const constructionData = new Map<string, OHLCVBar[]>();
  const evaluationData = new Map<string, OHLCVBar[]>();

  for (const [symbol, bars] of historicalData.entries()) {
    const ordered = [...bars].sort((a, b) => a.timestamp - b.timestamp);
    if (ordered.length < evaluationDays + 60) continue;
    const splitIndex = ordered.length - evaluationDays;
    const construction = ordered.slice(0, splitIndex);
    const evaluation = ordered.slice(Math.max(0, splitIndex - 1));
    if (construction.length >= 60 && evaluation.length >= evaluationDays) {
      constructionData.set(symbol, construction);
      evaluationData.set(symbol, evaluation);
    }
  }
  return { constructionData, evaluationData };
}

export function generatePortfolios(observations: MarketObservation[], historicalData: Map<string, OHLCVBar[]>): Portfolio[] {
  const now = Date.now();
  const portfolios: Portfolio[] = [];
  const sorted = [...observations]
    .filter(o =>
      o.volume24h !== null &&
      o.volume24h! > 0 &&
      !STABLECOINS.has(o.canonicalSymbol.toUpperCase())
    )
    .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));

  const topAssets = sorted.slice(0, 20);
  if (topAssets.length < 3) return [];

  const { constructionData, evaluationData } = splitHistoricalData(historicalData, 30);
  const symbolsWithData = topAssets
    .map(a => a.canonicalSymbol)
    .filter(s => constructionData.has(s) && evaluationData.has(s));
  if (symbolsWithData.length < 3) return [];

  const hasOnlyCrypto = topAssets.every(a => a.assetClass === 'crypto');
  const universeLabel = hasOnlyCrypto ? 'CRYPTO-ONLY UNIVERSE' : 'MULTI-ASSET UNIVERSE';

  const momentumAssets = [...symbolsWithData]
    .map(symbol => ({ symbol, score: calculateMomentumScore(alignedSymbolReturns(symbol, constructionData)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(5, symbolsWithData.length))
    .map(item => item.symbol);
  portfolios.push(createPortfolio(
    'A', 'Aggressive Growth & Momentum',
    'High-risk growth sleeve selected by measured momentum, then weighted by inverse volatility.',
    'Seek upside from liquid risk assets with strong recent risk-adjusted momentum while accepting materially higher drawdown risk.',
    '2–8 weeks', 'crypto_derivatives', momentumAssets, constructionData, evaluationData, observations, universeLabel, now
  ));

  const largeCaps = symbolsWithData.slice(0, Math.min(6, symbolsWithData.length));
  portfolios.push(createPortfolio(
    'B', 'Core Diversified',
    'Large, liquid crypto assets with volatility-aware weights and a broader diversification mandate.',
    'Provide a core crypto allocation with less concentration than the growth sleeve.',
    '1–3 months', 'crypto_spot', largeCaps, constructionData, evaluationData, observations, universeLabel, now
  ));

  const lowCorrAssets = selectLowCorrelationAssets(symbolsWithData.slice(0, 15), constructionData, Math.min(5, symbolsWithData.length));
  if (lowCorrAssets.length >= 3) portfolios.push(createPortfolio(
    'C', 'Low-Correlation Diversifier',
    'Greedy low-correlation selection designed to reduce overlap between asset return streams.',
    'Reduce portfolio co-movement and concentration risk.',
    '1–3 months', 'crypto_spot', lowCorrAssets, constructionData, evaluationData, observations, universeLabel, now
  ));

  const liquidAssets = topAssets
    .filter(a => symbolsWithData.includes(a.canonicalSymbol))
    .slice(0, Math.min(4, symbolsWithData.length))
    .map(a => a.canonicalSymbol);
  portfolios.push(createPortfolio(
    'D', 'Liquidity First',
    'Concentrates on the most liquid eligible assets to reduce execution friction and slippage.',
    'Prioritize tradability and execution quality while keeping diversified weights.',
    '2–6 weeks', 'crypto_spot', liquidAssets, constructionData, evaluationData, observations, universeLabel, now
  ));

  const volMap = new Map<string, number>();
  for (const sym of symbolsWithData) {
    const bars = constructionData.get(sym) || [];
    const prices = bars.map(b => b.close);
    volMap.set(sym, calculateVolatility(calculateReturns(prices)));
  }
  const lowVolAssets = [...volMap.entries()].sort((a, b) => a[1] - b[1]).slice(0, Math.min(5, symbolsWithData.length)).map(([sym]) => sym);
  portfolios.push(createPortfolio(
    'E', 'Capital Defense',
    'Selects the lowest-volatility eligible assets and uses the largest cash reserve policy.',
    'Reduce volatility and drawdown pressure while retaining market participation.',
    '1–3 months', 'crypto_spot', lowVolAssets, constructionData, evaluationData, observations, universeLabel, now
  ));

  return portfolios;
}


function capAndRedistributeWeights(rawWeights: number[], maxWeight: number = 0.35): number[] {
  const n = rawWeights.length;
  if (n === 0) return [];
  if (n * maxWeight < 1 - 1e-9) {
    throw new Error(`Cannot allocate 100% across ${n} assets with max weight ${maxWeight}`);
  }

  const raw = rawWeights.map(weight => Math.max(0, weight));
  const result = new Array(n).fill(0);
  const active = new Set(raw.map((_, index) => index));
  let remaining = 1;

  while (active.size > 0 && remaining > 1e-12) {
    const totalRaw = Array.from(active).reduce((sum, index) => sum + raw[index], 0);
    const denominator = totalRaw > 0 ? totalRaw : active.size;
    let cappedAny = false;

    for (const index of Array.from(active)) {
      const share = totalRaw > 0 ? raw[index] / denominator : 1 / active.size;
      const proposed = remaining * share;
      if (proposed > maxWeight + 1e-12) {
        result[index] = maxWeight;
        remaining -= maxWeight;
        active.delete(index);
        cappedAny = true;
      }
    }

    if (!cappedAny) {
      const total = Array.from(active).reduce((sum, index) => sum + raw[index], 0);
      for (const index of active) {
        const share = total > 0 ? raw[index] / total : 1 / active.size;
        result[index] = remaining * share;
      }
      remaining = 0;
    }
  }

  const sum = result.reduce((total, weight) => total + weight, 0);
  if (sum <= 0) return new Array(n).fill(1 / n);
  return result.map(weight => weight / sum);
}

function createPortfolio(
  letter: string,
  name: string,
  description: string,
  mandate: string,
  holdingPeriod: string,
  sleeve: Portfolio['sleeve'],
  symbols: string[],
  constructionData: Map<string, OHLCVBar[]>,
  evaluationData: Map<string, OHLCVBar[]>,
  observations: MarketObservation[],
  universeLabel: string,
  now: number
): Portfolio {
  const volMap = new Map<string, number>();
  for (const sym of symbols) {
    const bars = constructionData.get(sym) || [];
    const prices = bars.map(b => b.close);
    const vol = calculateVolatility(calculateReturns(prices));
    volMap.set(sym, Math.max(vol, 0.01));
  }

  const invVols = symbols.map(s => 1 / volMap.get(s)!);
  const normalizedWeights = capAndRedistributeWeights(invVols, 0.35);

  const assets: PortfolioAsset[] = symbols.map((sym, i) => {
    const obs = observations.find(o => o.canonicalSymbol === sym);
    return {
      canonicalSymbol: sym,
      provider: obs?.provider || 'binance',
      weight: normalizedWeights[i],
      allocationPercent: normalizedWeights[i] * 100,
      marketType: obs?.marketType || 'SPOT',
      assetClass: obs?.assetClass || 'crypto',
    };
  });

  const weightMap = new Map(symbols.map((s, i) => [s, normalizedWeights[i]]));
  const metrics = calculatePortfolioMetrics(evaluationData, weightMap, observations);
  const riskPolicy = buildRiskPolicy(letter, metrics);
  const maxWeight = Math.max(...normalizedWeights);
  const executionReady =
    metrics.dataFreshness !== 'STALE' &&
    metrics.dataFreshness !== 'DISCONNECTED' &&
    metrics.observationCount >= 30 &&
    maxWeight <= riskPolicy.maxSingleAssetWeight + 1e-9;

  return {
    id: `P${letter}`,
    version: 1,
    name,
    description,
    mandate,
    holdingPeriod,
    sleeve,
    status: 'evaluated',
    assets,
    generatedAt: now,
    generatorParams: {
      method: 'inverse-volatility',
      cap: 0.35,
      constructionMode: 'prior-window',
      constructionBars: Math.min(...symbols.map(s => constructionData.get(s)?.length || 0)),
      evaluationMode: 'holdout',
      evaluationBars: Math.min(...symbols.map(s => evaluationData.get(s)?.length || 0)),
    },
    dataSnapshotId: `snap-${now}`,
    metrics,
    rank: null,
    rankingScore: null,
    scoreBreakdown: null,
    rankingLabel: null,
    priorRank: null,
    universeLabel,
    riskPolicy,
    executionReady,
  };
}

const DEFAULT_RANKING_CONFIG: RankingConfig = {
  weights: {
    riskAdjustedPerformance: 25,
    drawdownResilience: 15,
    volatilityControl: 10,
    liquidity: 10,
    diversification: 10,
    momentumRegime: 10,
    historicalRobustness: 10,
    fundingCarry: 5,
    dataQuality: 5,
  },
};

function normalize(value: number | null, min: number, max: number, higherIsBetter: boolean = true): number {
  if (value === null) return 0;
  const range = max - min;
  if (range === 0) return 0.5;
  const normalized = (value - min) / range;
  return higherIsBetter ? normalized : 1 - normalized;
}

export function rankPortfolios(portfolios: Portfolio[], config: RankingConfig = DEFAULT_RANKING_CONFIG): RankingRun {
  const now = Date.now();
  const disqualified = new Map<string, string>();
  const eligible: Portfolio[] = [];

  for (const p of portfolios) {
    if (!p.metrics) {
      disqualified.set(p.id, 'NOT EVALUATED');
      continue;
    }
    if (p.metrics.dataFreshness === 'DISCONNECTED' || p.metrics.dataFreshness === 'STALE') {
      disqualified.set(p.id, `DATA ${p.metrics.dataFreshness}`);
      continue;
    }
    if (p.metrics.observationCount < 10) {
      disqualified.set(p.id, 'INSUFFICIENT OBSERVATIONS');
      continue;
    }
    if (p.metrics.maxDrawdown !== null && p.metrics.maxDrawdown < -0.5) {
      disqualified.set(p.id, 'DRAWDOWN EXCEEDS 50% THRESHOLD');
      continue;
    }
    eligible.push(p);
  }

  if (eligible.length === 0) {
    return {
      id: `rank-${now}`,
      timestamp: now,
      portfolioIds: portfolios.map(p => p.id),
      results: portfolios.map(p => ({
        portfolioId: p.id,
        rank: 0,
        score: 0,
        scoreBreakdown: emptyBreakdown(),
        label: 'DISQUALIFIED' as RankingLabel,
        disqualified: true,
        disqualificationReason: disqualified.get(p.id) || 'UNKNOWN',
        priorRank: p.rank,
        rankChange: 0,
      })),
      config,
      dataSnapshotId: `snap-${now}`,
    };
  }

  const sharpes = eligible.map(p => p.metrics!.sharpeRatio || 0);
  const drawdowns = eligible.map(p => p.metrics!.maxDrawdown || 0);
  const vols = eligible.map(p => p.metrics!.realizedVolatility || 0);
  const liquidities = eligible.map(p => p.metrics!.liquidityScore || 0);
  const diversifications = eligible.map(p => p.metrics!.diversificationScore || 0);
  const momentums = eligible.map(p => p.metrics!.momentumScore || 0);

  const minSharpe = Math.min(...sharpes), maxSharpe = Math.max(...sharpes);
  const minDD = Math.min(...drawdowns), maxDD = Math.max(...drawdowns);
  const minVol = Math.min(...vols), maxVol = Math.max(...vols);
  const minLiq = Math.min(...liquidities), maxLiq = Math.max(...liquidities);
  const minDiv = Math.min(...diversifications), maxDiv = Math.max(...diversifications);
  const minMom = Math.min(...momentums), maxMom = Math.max(...momentums);

  const results: RankingResult[] = eligible.map((p) => {
    const m = p.metrics!;
    const riskAdjScore = normalize(m.sharpeRatio, minSharpe, maxSharpe, true) * config.weights.riskAdjustedPerformance;
    const ddScore = normalize(m.maxDrawdown, minDD, maxDD, true) * config.weights.drawdownResilience;
    const volScore = normalize(m.realizedVolatility, minVol, maxVol, false) * config.weights.volatilityControl;
    const liqScore = normalize(m.liquidityScore, minLiq, maxLiq, true) * config.weights.liquidity;
    const divScore = normalize(m.diversificationScore, minDiv, maxDiv, true) * config.weights.diversification;
    const momScore = normalize(m.momentumScore, minMom, maxMom, true) * config.weights.momentumRegime;
    const histScore = Math.min(1, m.observationCount / 90) * config.weights.historicalRobustness;
    const fundingScore = m.avgFundingRate === null ? 0 : normalize(m.avgFundingRate, -0.001, 0.001, true) * config.weights.fundingCarry;
    const dataScore = (m.dataFreshness === 'LIVE' ? 1 : m.dataFreshness === 'DELAYED' ? 0.5 : 0) * config.weights.dataQuality;
    const total = riskAdjScore + ddScore + volScore + liqScore + divScore + momScore + histScore + fundingScore + dataScore;

    const breakdown: ScoreBreakdown = {
      riskAdjustedPerformance: { score: riskAdjScore, max: config.weights.riskAdjustedPerformance },
      drawdownResilience: { score: ddScore, max: config.weights.drawdownResilience },
      volatilityControl: { score: volScore, max: config.weights.volatilityControl },
      liquidity: { score: liqScore, max: config.weights.liquidity },
      diversification: { score: divScore, max: config.weights.diversification },
      momentumRegime: { score: momScore, max: config.weights.momentumRegime },
      historicalRobustness: { score: histScore, max: config.weights.historicalRobustness },
      fundingCarry: { score: fundingScore, max: config.weights.fundingCarry },
      dataQuality: { score: dataScore, max: config.weights.dataQuality },
      total,
      maxTotal: 100,
    };

    return {
      portfolioId: p.id,
      rank: 0,
      score: total,
      scoreBreakdown: breakdown,
      label: determineLabel(total),
      disqualified: false,
      priorRank: p.rank,
      rankChange: 0,
    };
  });

  results.sort((a, b) => b.score - a.score);
  results.forEach((r, i) => {
    r.rank = i + 1;
    r.rankChange = r.priorRank !== null ? r.priorRank - r.rank : 0;
  });

  for (const p of portfolios) {
    if (disqualified.has(p.id)) {
      results.push({
        portfolioId: p.id,
        rank: 0,
        score: 0,
        scoreBreakdown: emptyBreakdown(),
        label: 'DISQUALIFIED',
        disqualified: true,
        disqualificationReason: disqualified.get(p.id),
        priorRank: p.rank,
        rankChange: 0,
      });
    }
  }

  return {
    id: `rank-${now}`,
    timestamp: now,
    portfolioIds: portfolios.map(p => p.id),
    results,
    config,
    dataSnapshotId: `snap-${now}`,
  };
}

function determineLabel(score: number): RankingLabel {
  if (score >= 70) return 'RECOMMENDED FOR PAPER';
  if (score >= 50) return 'PAPER CANDIDATE';
  if (score >= 30) return 'WATCH';
  if (score >= 15) return 'HIGH RISK';
  return 'DATA INSUFFICIENT';
}

function emptyBreakdown(): ScoreBreakdown {
  return {
    riskAdjustedPerformance: { score: 0, max: 25 },
    drawdownResilience: { score: 0, max: 15 },
    volatilityControl: { score: 0, max: 10 },
    liquidity: { score: 0, max: 10 },
    diversification: { score: 0, max: 10 },
    momentumRegime: { score: 0, max: 10 },
    historicalRobustness: { score: 0, max: 10 },
    fundingCarry: { score: 0, max: 5 },
    dataQuality: { score: 0, max: 5 },
    total: 0,
    maxTotal: 100,
  };
}
