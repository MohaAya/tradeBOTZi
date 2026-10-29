# Hosting (Cloudflare only, no server)

The API now runs entirely on Cloudflare's free tier. The VPS this project used to depend on
(OmniRoute, Hermes, FreeLLM, Ollama, systemd bots) no longer exists.

- `cloudflare/worker.ts` serves the UI and routes `/api/*` to one Durable Object.
- `cloudflare/engine-do.ts` hosts the engine and mirrors its state files into Durable Object storage.
- `cloudflare/engine.mjs` is the old `server/index.mjs` as a fetch handler; it reuses `server/*.mjs` unchanged.
- `cloudflare/shims/` replace `node:fs` (in-memory, persisted by the Durable Object) and `node:child_process`.
- AI: eight council roles map to Workers AI models (Nemotron 3 Super, GPT-OSS 120B/20B, Gemma 4, Llama 3.3 70B, GLM 4.7 Flash, Mistral Small 3.1, Qwen3 30B). Set a `NVIDIA_API_KEY` secret to prefer NVIDIA's hosted API.
- A cron trigger wakes the engine every minute so the PAPER loops keep running.
- Not available on Cloudflare: the CABBAGE and Stonkfly external bots and the Agent Desk's browser automation (both need a real machine). They report as not installed.
- Binance blocks Cloudflare IPs (HTTP 403), so market data comes from Coinbase and Hyperliquid, history falls back to Yahoo.

Deploy: `npm install && npm run deploy:cloudflare`

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
