# Zbot — Real Market Data Portfolio Research System

A production-grade portfolio research application that fetches **real market data** from multiple exchanges, generates diversified portfolios, calculates quantitative metrics, ranks them deterministically, and provides AI-powered analysis — all without any fake or hard-coded production values.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      FRONTEND (React/Vite/TS)                    │
│  Dashboard │ Agents │ Portfolio Builder │ Evaluation │ Ranking   │
│  Cross-Venue │ Copilot Chat │ OmniRoute │ Market Data │ Settings │
└───────────────────────────┬─────────────────────────────────────┘
                            │ REST API / WebSocket
┌───────────────────────────┴─────────────────────────────────────┐
│                       BACKEND (Node.js/TS)                       │
│  Provider Adapters │ Portfolio Engine │ Ranking │ Risk │ Paper   │
└──────────┬──────────┬──────────┬────────────────────────────────┘
           │          │          │
     ┌─────┴───┐ ┌────┴────┐ ┌──┴──────┐
     │Binance  │ │Hyper-   │ │Coinbase │
     │Public   │ │liquid   │ │Public   │
     │REST API │ │REST API │ │REST API │
     └─────────┘ └─────────┘ └─────────┘
                            │
                    ┌───────┴───────┐
                    │  PostgreSQL   │
                    │  (persistent) │
                    └───────────────┘
```

## Current Implementation Status

### ✅ Fully Implemented

| Feature | Status | Details |
|---------|--------|---------|
| Real market data (Binance) | ✅ Working | Public REST API, no key required |
| Real market data (Coinbase) | ✅ Working | Public REST API, no key required |
| Real market data (Hyperliquid) | ✅ Working | Public REST API, no key required |
| Cross-venue price validation | ✅ Working | Compares BTC/ETH/SOL across exchanges |
| Portfolio generation (5 portfolios) | ✅ Working | Inverse-volatility weighting, 35% cap |
| Quantitative metrics | ✅ Working | Sharpe, Sortino, Calmar, MaxDD, Vol, etc. |
| Deterministic ranking | ✅ Working | 9-factor scoring with normalization |
| Score breakdown display | ✅ Working | Each factor shown with score/max |
| Data freshness detection | ✅ Working | LIVE/DELAYED/STALE/DISCONNECTED |
| Hard disqualifiers | ✅ Working | Stale data, insufficient observations, etc. |
| Paper trading accounting | ✅ Working | Isolated virtual accounts per portfolio |
| Agent management | ✅ Working | Create/start/pause/stop with persistence |
| Settings persistence | ✅ Working | localStorage (backend-ready interface) |
| Copilot chat | ✅ Working | Answers from current app state |
| Cross-venue comparison UI | ✅ Working | Spread alerts for price discrepancies |
| OmniRoute config | ✅ Working | Shows NOT CONFIGURED when no AI set up |
| "DATA UNAVAILABLE" states | ✅ Working | No fake values when data missing |
| Zero mock production data | ✅ Verified | mockData.ts and portfolioData.ts removed |
| TypeScript type safety | ✅ Working | Comprehensive domain types (405 lines) |
| Docker deployment | ✅ Ready | docker-compose.yml with web + api + postgres |

### 🔄 Partially Implemented / Next Steps

| Feature | Status | Notes |
|---------|--------|-------|
| WebSocket streaming | 🔄 | Currently REST polling every 30s |
| Backend API server | 🔄 | Schema ready, needs Express implementation |
| AI provider integration | 🔄 | Interface ready, needs actual API calls |
| Equity/FX adapters | 🔄 | Requires Alpaca/TwelveData free keys |
| Historical OHLCV storage | 🔄 | In-memory, needs PostgreSQL persistence |
| Full backtest engine | 🔄 | Basic metrics done, needs multi-window |

## Quick Start

```bash
npm install
npm run dev
npm run build
```

## Docker Deployment

```bash
cp .env.example .env
docker-compose up -d
docker-compose ps
docker-compose logs -f web
```

## Disclaimer

This is a research/educational tool. It does NOT execute real trades. All portfolio analysis is simulated. Never make investment decisions based solely on automated analysis. Past performance does not guarantee future results.
