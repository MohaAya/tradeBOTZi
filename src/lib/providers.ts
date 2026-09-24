/**
 * MARKET DATA PROVIDERS
 * 
 * Real public API clients for crypto market data.
 * These use free, key-less public endpoints.
 * 
 * Binance: https://binance-docs.github.io/apidocs/
 * Coinbase: https://docs.cloud.coinbase.com/sign-in-with-coinbase/docs/api
 */

import type { MarketObservation, OHLCVBar, Instrument, DataFreshness, ProviderStatus } from '../types';

const BINANCE_BASE = 'https://api.binance.com/api/v3';

export async function fetchBinanceTickers(): Promise<MarketObservation[]> {
  const res = await fetch(`${BINANCE_BASE}/ticker/24hr`);
  if (!res.ok) throw new Error(`Binance ticker failed: ${res.status}`);
  const data: any[] = await res.json();
  const now = Date.now();
  
  return data
    .filter((t: any) => t.symbol.endsWith('USDT'))
    .slice(0, 50)
    .map((t: any) => ({
      provider: 'binance',
      canonicalSymbol: t.symbol.replace('USDT', ''),
      providerSymbol: t.symbol,
      assetClass: 'crypto' as const,
      marketType: 'SPOT' as const,
      timestamp: now,
      receivedAt: now,
      price: parseFloat(t.lastPrice),
      bid: null,
      ask: null,
      spread: null,
      change24h: parseFloat(t.priceChangePercent),
      volume24h: parseFloat(t.quoteVolume),
      high24h: parseFloat(t.highPrice),
      low24h: parseFloat(t.lowPrice),
      freshness: 'LIVE' as DataFreshness,
      dataQuality: 'good' as const,
    }));
}

export async function fetchBinanceKlines(symbol: string, interval: string = '1h', limit: number = 168): Promise<OHLCVBar[]> {
  const res = await fetch(`${BINANCE_BASE}/klines?symbol=${symbol}USDT&interval=${interval}&limit=${limit}`);
  if (!res.ok) throw new Error(`Binance klines failed: ${res.status}`);
  const data: any[][] = await res.json();
  const now = Date.now();
  return data.map((k: any[]) => ({
    provider: 'binance',
    canonicalSymbol: symbol,
    timestamp: k[0],
    interval: interval as OHLCVBar['interval'],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    sourceTimestamp: k[0],
    ingestionTimestamp: now,
  }));
}

const HYPERLIQUID_BASE = 'https://api.hyperliquid.xyz/info';

export async function fetchHyperliquidMeta(): Promise<{
  observations: MarketObservation[];
  fundingRates: Map<string, number>;
  openInterest: Map<string, number>;
}> {
  const now = Date.now();
  const allMidsRes = await fetch(HYPERLIQUID_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'allMids' }),
  });
  if (!allMidsRes.ok) throw new Error(`Hyperliquid allMids failed: ${allMidsRes.status}`);
  const allMids: Record<string, string> = await allMidsRes.json();

  const metaRes = await fetch(HYPERLIQUID_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'meta' }),
  });
  const meta: any = await metaRes.json();

  const observations: MarketObservation[] = [];
  const fundingRates = new Map<string, number>();
  const openInterest = new Map<string, number>();
  const assetNames: string[] = meta.universe.map((u: any) => u.name);

  for (const [key, midStr] of Object.entries(allMids)) {
    const mid = parseFloat(midStr);
    if (isNaN(mid)) continue;
    const assetIdx = parseInt(key);
    const name = assetNames[assetIdx] || key;
    const canonicalSymbol = name.toUpperCase();
    observations.push({
      provider: 'hyperliquid',
      canonicalSymbol,
      providerSymbol: name,
      assetClass: 'crypto',
      marketType: 'PERPETUAL',
      timestamp: now,
      receivedAt: now,
      price: mid,
      bid: null,
      ask: null,
      spread: null,
      change24h: null,
      volume24h: null,
      high24h: null,
      low24h: null,
      freshness: 'LIVE' as DataFreshness,
      dataQuality: 'good',
    });
  }

  for (const name of assetNames.slice(0, 20)) {
    try {
      const fundingRes = await fetch(HYPERLIQUID_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'fundingHistory', coin: name, startTime: Date.now() - 3600000 }),
      });
      if (fundingRes.ok) {
        const fundingData: any[] = await fundingRes.json();
        if (fundingData.length > 0) {
          fundingRates.set(name.toUpperCase(), parseFloat(fundingData[fundingData.length - 1].fundingRate));
        }
      }
    } catch {}
  }

  return { observations, fundingRates, openInterest };
}

export async function fetchHyperliquidCandles(symbol: string, interval: string = '1h', limit: number = 168): Promise<OHLCVBar[]> {
  const intervalMap: Record<string, string> = {
    '1m': '1', '5m': '5', '15m': '15', '1h': '60', '4h': '240', '1d': '1D',
  };
  const hlInterval = intervalMap[interval] || '60';
  const now = Date.now();
  const startTime = now - (limit * parseInt(hlInterval) * 60000);
  const res = await fetch(HYPERLIQUID_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'candleSnapshot',
      coin: symbol,
      interval: hlInterval,
      startTime,
      endTime: now,
    }),
  });
  if (!res.ok) throw new Error(`Hyperliquid candles failed: ${res.status}`);
  const data: any[] = await res.json();
  return data.map((c: any) => ({
    provider: 'hyperliquid',
    canonicalSymbol: symbol.toUpperCase(),
    timestamp: c.t,
    interval: interval as OHLCVBar['interval'],
    open: parseFloat(c.o),
    high: parseFloat(c.h),
    low: parseFloat(c.l),
    close: parseFloat(c.c),
    volume: parseFloat(c.v),
    sourceTimestamp: c.t,
    ingestionTimestamp: now,
  }));
}

const COINBASE_BASE = 'https://api.coinbase.com/v2';

export async function fetchCoinbasePrices(): Promise<MarketObservation[]> {
  const symbols = ['BTC', 'ETH', 'SOL', 'AVAX', 'LINK', 'MATIC', 'DOT', 'ATOM'];
  const now = Date.now();
  const results: MarketObservation[] = [];
  const promises = symbols.map(async (sym) => {
    try {
      const res = await fetch(`${COINBASE_BASE}/prices/${sym}-USD/spot`);
      if (!res.ok) return null;
      const data = await res.json();
      return {
        provider: 'coinbase',
        canonicalSymbol: sym,
        providerSymbol: `${sym}-USD`,
        assetClass: 'crypto' as const,
        marketType: 'SPOT' as const,
        timestamp: now,
        receivedAt: now,
        price: parseFloat(data.data.amount),
        bid: null,
        ask: null,
        spread: null,
        change24h: null,
        volume24h: null,
        high24h: null,
        low24h: null,
        freshness: 'LIVE' as DataFreshness,
        dataQuality: 'good' as const,
      };
    } catch {
      return null;
    }
  });
  const settled = await Promise.allSettled(promises);
  for (const s of settled) if (s.status === 'fulfilled' && s.value) results.push(s.value);
  return results;
}

export function compareAcrossVenues(observations: MarketObservation[], symbol: string) {
  const venueObs = observations.filter(o => o.canonicalSymbol === symbol && o.price !== null);
  const venues = venueObs.map(o => ({
    provider: o.provider,
    price: o.price,
    freshness: o.freshness,
    timestamp: o.timestamp,
  }));
  if (venues.length < 2) {
    return { venues, medianPrice: venues[0]?.price ?? null, maxSpread: null, maxSpreadPercent: null, flagged: false };
  }
  const prices = venues.map(v => v.price!).sort((a, b) => a - b);
  const median = prices[Math.floor(prices.length / 2)];
  const min = prices[0];
  const max = prices[prices.length - 1];
  const spread = max - min;
  const spreadPct = (spread / median) * 100;
  const flagged = spreadPct > 1.0;
  return {
    venues,
    medianPrice: median,
    maxSpread: spread,
    maxSpreadPercent: spreadPct,
    flagged,
    flagReason: flagged ? `Cross-venue spread ${spreadPct.toFixed(2)}% exceeds 1% threshold` : undefined,
  };
}

export function assessFreshness(lastMessageAt: number | null, thresholdSeconds: number = 60): DataFreshness {
  if (lastMessageAt === null) return 'DISCONNECTED';
  const age = (Date.now() - lastMessageAt) / 1000;
  if (age > thresholdSeconds * 5) return 'STALE';
  if (age > thresholdSeconds) return 'DELAYED';
  return 'LIVE';
}

export interface FetchResult {
  observations: MarketObservation[];
  providerStatuses: { provider: string; status: ProviderStatus; latencyMs: number; error?: string }[];
  fetchedAt: number;
}

export async function fetchAllMarkets(): Promise<FetchResult> {
  const statuses: FetchResult['providerStatuses'] = [];
  const allObs: MarketObservation[] = [];
  const fetchedAt = Date.now();

  try {
    const start = Date.now();
    const binanceObs = await fetchBinanceTickers();
    allObs.push(...binanceObs);
    statuses.push({ provider: 'binance', status: 'connected', latencyMs: Date.now() - start });
  } catch (e: any) {
    statuses.push({ provider: 'binance', status: 'error', latencyMs: 0, error: e.message });
  }

  try {
    const start = Date.now();
    const hlResult = await fetchHyperliquidMeta();
    allObs.push(...hlResult.observations);
    statuses.push({ provider: 'hyperliquid', status: 'connected', latencyMs: Date.now() - start });
  } catch (e: any) {
    statuses.push({ provider: 'hyperliquid', status: 'error', latencyMs: 0, error: e.message });
  }

  try {
    const start = Date.now();
    const coinbaseObs = await fetchCoinbasePrices();
    allObs.push(...coinbaseObs);
    statuses.push({ provider: 'coinbase', status: 'connected', latencyMs: Date.now() - start });
  } catch (e: any) {
    statuses.push({ provider: 'coinbase', status: 'error', latencyMs: 0, error: e.message });
  }

  return { observations: allObs, providerStatuses: statuses, fetchedAt };
}

export async function fetchHistoricalData(symbols: string[], interval: string = '1d', limit: number = 90): Promise<Map<string, OHLCVBar[]>> {
  const result = new Map<string, OHLCVBar[]>();
  await Promise.allSettled(symbols.map(async (sym) => {
    try {
      const klines = await fetchBinanceKlines(sym, interval, limit);
      if (klines.length > 0) {
        result.set(sym, klines);
        return;
      }
    } catch {}
    try {
      const hlKlines = await fetchHyperliquidCandles(sym, interval, limit);
      if (hlKlines.length > 0) result.set(sym, hlKlines);
    } catch {}
  }));
  return result;
}
