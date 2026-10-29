// tradeBOTZi API, running inside a Cloudflare Durable Object.
// This is server/index.mjs from the VPS version with the pieces that needed a server removed:
//  - no http.listen: requests arrive as fetch Requests and are adapted to the (req, res) style
//    the agent desk expects
//  - AI providers that lived on the VPS (OmniRoute, Hermes, FreeLLM, Ollama) are replaced by
//    Cloudflare Workers AI models (free tier). NVIDIA's hosted API is used first when
//    NVIDIA_API_KEY is configured, otherwise the matching Workers AI model answers.
//  - market data uses the public Binance market-data host, which is not geo-blocked
import { createAgentDesk } from "../server/agentDesk.mjs";
import { createBotIntegrations } from "../server/botIntegrations.mjs";
import { createBeginnerPaper } from "../server/beginnerPaper.mjs";
import { createInvestmentRoom } from "../server/investmentRoom.mjs";

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1";

// Provider ids are the ones the UI and the agents already use. Each maps to a free model.
const WORKERS_AI = {
  "nvidia":        { model: "@cf/nvidia/nemotron-3-120b-a12b", nvidia: "nvidia/nemotron-3.5-lightning-30b-a3b", label: "Nemotron 3 Super 120B" },
  "nvidia-ultra":  { model: "@cf/openai/gpt-oss-120b", nvidia: "nvidia/nemotron-3-ultra-550b-a55b", label: "GPT-OSS 120B" },
  "nvidia-critic": { model: "@cf/openai/gpt-oss-20b", nvidia: "openai/gpt-oss-20b", label: "GPT-OSS 20B" },
  "nvidia-gemma":  { model: "@cf/google/gemma-4-26b-a4b-it", nvidia: "google/gemma-4-31b-it", label: "Gemma 4 26B" },
  "omniroute":     { model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", label: "Llama 3.3 70B" },
  "hermes":        { model: "@cf/zai-org/glm-4.7-flash", label: "GLM 4.7 Flash" },
  "freellm":       { model: "@cf/mistralai/mistral-small-3.1-24b-instruct", label: "Mistral Small 3.1 24B" },
  "ollama":        { model: "@cf/qwen/qwen3-30b-a3b-fp8", label: "Qwen3 30B" },
};

export function createEngine(env, hooks = {}) {
  const NVIDIA_KEY = env.NVIDIA_API_KEY || "";

  function sendJson(res, code, body) {
    res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  }
  async function readBody(req) {
    return req.__body || {};
  }

  async function fetchJson(url, opts = {}, timeout = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { ...opts, signal: controller.signal });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
      return { ok: response.ok, status: response.status, data };
    } finally {
      clearTimeout(timer);
    }
  }


  const BINANCE_BASE = "https://data-api.binance.vision/api/v3";
  const COINBASE_BASE = "https://api.coinbase.com/v2";
  const HYPERLIQUID_INFO = "https://api.hyperliquid.xyz/info";

  async function freshSnapshot() {
    const fetchedAt = Date.now();
    const observations = [];
    const providerStatuses = [];

    const binanceStarted = Date.now();
    try {
      const result = await fetchJson(`${BINANCE_BASE}/ticker/24hr`, {}, 15000);
      if (!result.ok || !Array.isArray(result.data)) throw new Error(`Binance HTTP ${result.status}`);
      const rows = result.data
        .filter(x => String(x.symbol || "").endsWith("USDT"))
        .sort((a, b) => Number(b.quoteVolume || 0) - Number(a.quoteVolume || 0))
        .slice(0, 100);
      for (const t of rows) {
        observations.push({
          provider: "binance",
          canonicalSymbol: String(t.symbol).replace(/USDT$/, ""),
          providerSymbol: t.symbol,
          assetClass: "crypto",
          marketType: "SPOT",
          timestamp: fetchedAt,
          receivedAt: fetchedAt,
          price: Number(t.lastPrice),
          bid: Number(t.bidPrice) || null,
          ask: Number(t.askPrice) || null,
          spread: Number(t.askPrice) > 0 && Number(t.bidPrice) > 0 ? Number(t.askPrice) - Number(t.bidPrice) : null,
          change24h: Number(t.priceChangePercent),
          volume24h: Number(t.quoteVolume),
          high24h: Number(t.highPrice),
          low24h: Number(t.lowPrice),
          freshness: "LIVE",
          dataQuality: "good"
        });
      }
      providerStatuses.push({ provider: "binance", status: "connected", latencyMs: Date.now() - binanceStarted });
    } catch (error) {
      providerStatuses.push({ provider: "binance", status: "error", latencyMs: Date.now() - binanceStarted, error: String(error) });
    }

    const coinbaseStarted = Date.now();
    try {
      const symbols = ["BTC","ETH","SOL","AVAX","LINK","MATIC","DOT","ATOM"];
      const rows = await Promise.all(symbols.map(async symbol => {
        const result = await fetchJson(`${COINBASE_BASE}/prices/${symbol}-USD/spot`, {}, 10000);
        if (!result.ok || !result.data?.data?.amount) return null;
        return {
          provider: "coinbase",
          canonicalSymbol: symbol,
          providerSymbol: `${symbol}-USD`,
          assetClass: "crypto",
          marketType: "SPOT",
          timestamp: fetchedAt,
          receivedAt: fetchedAt,
          price: Number(result.data.data.amount),
          bid: null, ask: null, spread: null, change24h: null, volume24h: null,
          high24h: null, low24h: null, freshness: "LIVE", dataQuality: "good"
        };
      }));
      observations.push(...rows.filter(Boolean));
      providerStatuses.push({ provider: "coinbase", status: "connected", latencyMs: Date.now() - coinbaseStarted });
    } catch (error) {
      providerStatuses.push({ provider: "coinbase", status: "error", latencyMs: Date.now() - coinbaseStarted, error: String(error) });
    }

    const hlStarted = Date.now();
    try {
      const result = await fetchJson(HYPERLIQUID_INFO, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "allMids" })
      }, 10000);
      if (!result.ok || !result.data || typeof result.data !== "object") throw new Error(`Hyperliquid HTTP ${result.status}`);
      for (const [symbol, mid] of Object.entries(result.data)) {
        if (String(symbol).startsWith("#")) continue;
        const price = Number(mid);
        if (!Number.isFinite(price)) continue;
        observations.push({
          provider: "hyperliquid",
          canonicalSymbol: String(symbol).toUpperCase(),
          providerSymbol: String(symbol),
          assetClass: "crypto",
          marketType: "PERPETUAL",
          timestamp: fetchedAt,
          receivedAt: fetchedAt,
          price,
          bid: null, ask: null, spread: null, change24h: null, volume24h: null,
          high24h: null, low24h: null, freshness: "LIVE", dataQuality: "good"
        });
      }
      providerStatuses.push({ provider: "hyperliquid", status: "connected", latencyMs: Date.now() - hlStarted });
    } catch (error) {
      providerStatuses.push({ provider: "hyperliquid", status: "error", latencyMs: Date.now() - hlStarted, error: String(error) });
    }

    return { observations, providerStatuses, fetchedAt };
  }

  async function serverHistoricalData(symbols, interval = "1d", limit = 90) {
    const clean = [...new Set(symbols)]
      .map(s => String(s).toUpperCase().trim())
      .filter(s => /^[A-Z0-9]{1,20}$/.test(s))
      .slice(0, 30);
    const safeLimit = Math.max(10, Math.min(Number(limit) || 90, 365));
    const allowedIntervals = new Set(["1m","5m","15m","1h","4h","1d"]);
    const safeInterval = allowedIntervals.has(interval) ? interval : "1d";
    const result = {};

    await Promise.all(clean.map(async symbol => {
      try {
        const response = await fetchJson(
          `${BINANCE_BASE}/klines?symbol=${encodeURIComponent(symbol)}USDT&interval=${safeInterval}&limit=${safeLimit}`,
          {},
          15000
        );
        if (response.ok && Array.isArray(response.data) && response.data.length) {
          result[symbol] = response.data.map(k => ({
            provider: "binance",
            canonicalSymbol: symbol,
            timestamp: k[0],
            interval: safeInterval,
            open: Number(k[1]),
            high: Number(k[2]),
            low: Number(k[3]),
            close: Number(k[4]),
            volume: Number(k[5]),
            sourceTimestamp: k[0],
            ingestionTimestamp: Date.now()
          }));
          return;
        }
      } catch {}

      try {
        const yahooInterval = safeInterval === "4h" ? "1h" : safeInterval;
        const range = safeInterval === "1m" ? "7d"
          : ["5m","15m"].includes(safeInterval) ? "60d"
          : safeInterval === "1h" || safeInterval === "4h" ? "2y"
          : "5y";
        const response = await fetchJson(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${yahooInterval}`,
          { headers: { "user-agent": "Mozilla/5.0" } },
          15000
        );
        const chart = response.data?.chart?.result?.[0];
        const timestamps = chart?.timestamp || [];
        const quote = chart?.indicators?.quote?.[0] || {};
        const bars = timestamps.map((ts, i) => ({
          provider: "yahoo",
          canonicalSymbol: symbol,
          timestamp: Number(ts) * 1000,
          interval: safeInterval,
          open: Number(quote.open?.[i]),
          high: Number(quote.high?.[i]),
          low: Number(quote.low?.[i]),
          close: Number(quote.close?.[i]),
          volume: Number(quote.volume?.[i] || 0),
          sourceTimestamp: Number(ts) * 1000,
          ingestionTimestamp: Date.now()
        })).filter(bar => [bar.open,bar.high,bar.low,bar.close].every(Number.isFinite));
        if (bars.length) result[symbol] = bars.slice(-safeLimit);
      } catch {}
    }));

    return result;
  }

  // ---- market snapshot, cached briefly so the three trading loops share one fetch ------
  let snapshotCache = null;
  let snapshotInflight = null;
  async function serverMarketSnapshot() {
    if (snapshotCache && Date.now() - snapshotCache.at < 14000) return snapshotCache.value;
    if (snapshotInflight) return snapshotInflight;
    snapshotInflight = freshSnapshot().then(value => {
      snapshotCache = { at: Date.now(), value };
      return value;
    }).finally(() => { snapshotInflight = null; });
    return snapshotInflight;
  }

  // ---- AI providers --------------------------------------------------------------------
  function bearerHeaders(key) {
    const headerName = ["Author", "ization"].join("");
    return { [headerName]: `Bearer ${key}`, "content-type": "application/json" };
  }

  function mergeSystem(messages) {
    const system = messages.find(m => m.role === "system")?.content || "";
    const rest = messages.filter(m => m.role !== "system");
    return rest.map((m, i) => i === 0 && m.role === "user"
      ? { ...m, content: system ? `${system}\n\n${m.content}` : m.content }
      : m);
  }

  function shape(content) {
    return { ok: Boolean(content), status: content ? 200 : 502, data: { choices: [{ message: { content } }], message: { content } } };
  }

  async function workersAiChat(provider, messages) {
    if (!env.AI) return { ok: false, status: 0, data: { error: "Workers AI binding missing" } };
    const spec = WORKERS_AI[provider];
    if (!spec) throw new Error(`Unknown AI provider: ${provider}`);
    const payload = { messages: provider === "nvidia-gemma" ? mergeSystem(messages) : messages, max_tokens: 1024, temperature: 0.2 };
    const out = await env.AI.run(spec.model, payload);
    const content = out?.response
      ?? out?.choices?.[0]?.message?.content
      ?? out?.result?.response
      ?? out?.choices?.[0]?.text
      ?? "";
    return shape(typeof content === "string" ? content.replace(/<think>[\s\S]*?<\/think>/g, "").trim() : "");
  }

  async function nvidiaChat(provider, messages) {
    const spec = WORKERS_AI[provider];
    const model = spec.nvidia;
    const body = {
      model,
      messages: provider === "nvidia-gemma" ? mergeSystem(messages) : messages,
      stream: false, temperature: 0.2, top_p: 0.9, max_tokens: 1024,
    };
    if (model.startsWith("nvidia/nemotron-")) body.chat_template_kwargs = { enable_thinking: false };
    return fetchJson(`${NVIDIA_URL}/chat/completions`, {
      method: "POST", headers: bearerHeaders(NVIDIA_KEY), body: JSON.stringify(body)
    }, provider === "nvidia-ultra" ? 45000 : 30000);
  }

  async function callProvider(provider, messages) {
    const spec = WORKERS_AI[provider];
    if (!spec) throw new Error(`Unknown AI provider: ${provider}`);
    if (NVIDIA_KEY && spec.nvidia) {
      try {
        const result = await nvidiaChat(provider, messages);
        if (result.ok && result.data?.choices?.[0]?.message?.content) return result;
      } catch {}
    }
    return workersAiChat(provider, messages);
  }

  function providerModel(provider) {
    const spec = WORKERS_AI[provider];
    if (!spec) return "unknown";
    return NVIDIA_KEY && spec.nvidia ? spec.nvidia : spec.model;
  }

  function extractContent(provider, result) {
    return result.data?.choices?.[0]?.message?.content || "";
  }

  function providerStatus() {
    const ready = Boolean(env.AI);
    return Object.entries(WORKERS_AI).map(([id, spec]) => ({
      id,
      label: spec.label + (NVIDIA_KEY && spec.nvidia ? " (NVIDIA API)" : " (Workers AI)"),
      healthy: ready,
      status: ready ? "connected" : "error",
      model: providerModel(id),
      modelCount: 1,
      latencyMs: 0,
    }));
  }

  const chatJobs = new Map();
  function createJobId() {
    return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
  async function runChatJob(messages) {
    const attempts = [];
    for (const provider of ["nvidia", "omniroute", "nvidia-critic", "freellm", "ollama", "hermes"]) {
      try {
        const started = Date.now();
        const result = await callProvider(provider, messages);
        const latencyMs = Date.now() - started;
        attempts.push({ provider, status: result.status, latencyMs });
        const content = extractContent(provider, result);
        if (result.ok && content) {
          return { ok: true, provider, model: providerModel(provider), content, fallbackUsed: provider !== "nvidia", latencyMs, attempts };
        }
      } catch (error) {
        attempts.push({ provider, status: 0, error: String(error) });
      }
    }
    return { ok: false, error: "All AI providers failed", attempts };
  }

  // ---- bots and trading loops ----------------------------------------------------------
  const botIntegrations = createBotIntegrations();
  const beginnerPaper = createBeginnerPaper({ serverMarketSnapshot, getBotState: (id) => botIntegrations.get(id) });
  const investmentRoom = createInvestmentRoom({ serverMarketSnapshot, botIntegrations, callProvider });
  const agentDesk = createAgentDesk({
    serverMarketSnapshot,
    externalBotCommand: (command) => botIntegrations.naturalCommand(command),
    beginnerPaperCommand: (command) => beginnerPaper.naturalCommand(command),
    callProvider,
    providerModel,
    extractProviderContent: extractContent,
  });

  async function route(req, res, url) {
    try {
      if (await agentDesk.handle(req, res, url, readBody, sendJson)) return;

      if (req.method === "GET" && url.pathname === "/api/health") {
        return sendJson(res, 200, { ok: true, service: "tradebotzi-api", paperOnly: true });
      }

      if (req.method === "GET" && url.pathname === "/api/bot-integrations") {
        return sendJson(res, 200, { ok: true, paperOnly: true, bots: botIntegrations.list() });
      }

      if (req.method === "GET" && url.pathname.startsWith("/api/bots/jobs/")) {
        const jobId = url.pathname.slice("/api/bots/jobs/".length);
        const job = botIntegrations.getJob(jobId);
        return job
          ? sendJson(res, 200, { ok: true, paperOnly: true, job })
          : sendJson(res, 404, { ok: false, paperOnly: true, error: "bot_job_not_found" });
      }

      if (req.method === "GET" && url.pathname === "/api/bots/jobs") {
        return sendJson(res, 200, {
          ok: true,
          paperOnly: true,
          jobs: botIntegrations.listJobs(Number(url.searchParams.get("limit") || 20))
        });
      }

      if (req.method === "GET" && url.pathname.startsWith("/api/bots/")) {
        const botId = url.pathname.slice("/api/bots/".length);
        const bot = botIntegrations.get(botId);
        return bot
          ? sendJson(res, 200, { ok: true, paperOnly: true, bot })
          : sendJson(res, 404, { ok: false, paperOnly: true, error: "bot_not_found" });
      }

      if (req.method === "POST" && /^\/api\/bots\/[^/]+\/actions$/.test(url.pathname)) {
        const botId = url.pathname.split("/")[3];
        const body = await readBody(req);
        const action = String(body.action || "");
        if (!["run_once", "backtest"].includes(action)) {
          return sendJson(res, 400, { ok: false, paperOnly: true, error: "unsupported_bot_action" });
        }
        try {
          const job = botIntegrations.startAction(botId, action);
          return sendJson(res, 202, { ok: true, paperOnly: true, job });
        } catch (error) {
          return sendJson(res, 400, { ok: false, paperOnly: true, error: String(error) });
        }
      }

      if (req.method === "GET" && url.pathname === "/api/demo/state") {
        return sendJson(res, 200, { ok: true, paperOnly: true, demo: beginnerPaper.state() });
      }

      if (req.method === "GET" && url.pathname === "/api/demo/proposals") {
        const proposals = await beginnerPaper.proposals();
        return sendJson(res, 200, { ok: true, paperOnly: true, proposals });
      }

      if (req.method === "POST" && url.pathname === "/api/demo/start") {
        const body = await readBody(req);
        const demo = beginnerPaper.startAutopilot({
          capital: body.capital,
          riskLevel: body.riskLevel,
          leverage: body.leverage,
          resetAccount: body.resetAccount === true
        });
        return sendJson(res, 200, { ok: true, paperOnly: true, demo });
      }

      if (req.method === "POST" && url.pathname === "/api/demo/stop") {
        return sendJson(res, 200, { ok: true, paperOnly: true, demo: beginnerPaper.stopAutopilot() });
      }

      if (req.method === "POST" && url.pathname === "/api/demo/run") {
        const result = await beginnerPaper.tick(true);
        return sendJson(res, 200, { ok: true, paperOnly: true, result });
      }

      if (req.method === "POST" && url.pathname === "/api/demo/open") {
        const body = await readBody(req);
        const position = await beginnerPaper.openTrade(body);
        return sendJson(res, 200, { ok: true, paperOnly: true, position, demo: beginnerPaper.state() });
      }

      if (req.method === "POST" && /^\/api\/demo\/positions\/[^/]+\/close$/.test(url.pathname)) {
        const positionId = url.pathname.split("/")[4];
        const body = await readBody(req);
        const trade = await beginnerPaper.closeTrade(positionId, body.reason || "manual_close");
        return sendJson(res, 200, { ok: true, paperOnly: true, trade, demo: beginnerPaper.state() });
      }

      if (req.method === "POST" && url.pathname === "/api/demo/reset") {
        const body = await readBody(req);
        const demo = beginnerPaper.reset(body.capital, body.riskLevel, body.leverage);
        return sendJson(res, 200, { ok: true, paperOnly: true, demo });
      }

      if (req.method === "POST" && url.pathname === "/api/demo/live-permission") {
        const body = await readBody(req);
        const live = beginnerPaper.recordLivePermission(body.phrase);
        return sendJson(res, 200, { ok: true, live });
      }

      if (req.method === "GET" && url.pathname === "/api/investment-room/state") {
        return sendJson(res, 200, { ok: true, room: investmentRoom.state() });
      }

      if (req.method === "POST" && url.pathname === "/api/investment-room/start") {
        const body = await readBody(req);
        const room = investmentRoom.start({
          capital: body.capital,
          leverage: body.leverage,
          reset: body.reset === true
        });
        return sendJson(res, 200, { ok: true, paperOnly: true, room });
      }

      if (req.method === "POST" && url.pathname === "/api/investment-room/stop") {
        return sendJson(res, 200, { ok: true, paperOnly: true, room: investmentRoom.stop() });
      }

      if (req.method === "POST" && url.pathname === "/api/investment-room/select-strategy") {
        const body = await readBody(req);
        try {
          const room = investmentRoom.selectStrategy(String(body.strategy || ""));
          return sendJson(res, 200, { ok: true, paperOnly: true, room });
        } catch (error) {
          return sendJson(res, 400, { ok: false, paperOnly: true, error: String(error) });
        }
      }

      if (req.method === "POST" && url.pathname === "/api/investment-room/universe") {
        const body = await readBody(req);
        try {
          const room = investmentRoom.configureUniverse({
            mode: body.mode,
            markets: body.markets,
            symbols: body.symbols,
            maxCandidates: body.maxCandidates
          });
          return sendJson(res, 200, { ok: true, paperOnly: true, room });
        } catch (error) {
          return sendJson(res, 400, { ok: false, paperOnly: true, error: String(error) });
        }
      }

      if (req.method === "POST" && url.pathname === "/api/investment-room/universe/scan") {
        const universe = await investmentRoom.scanUniverse();
        return sendJson(res, 200, { ok: true, paperOnly: true, universe });
      }

      if (req.method === "POST" && url.pathname === "/api/investment-room/run") {
        const result = await investmentRoom.cycle(true);
        return sendJson(res, 200, { ok: true, paperOnly: true, result });
      }

      if (req.method === "POST" && url.pathname === "/api/investment-room/evidence") {
        const evidence = await investmentRoom.gatherEvidence();
        return sendJson(res, 200, { ok: true, evidence });
      }

      if (req.method === "POST" && url.pathname === "/api/investment-room/strategies") {
        const strategies = await investmentRoom.refreshStrategies();
        return sendJson(res, 200, { ok: true, strategies });
      }

      if (req.method === "GET" && url.pathname === "/api/markets") {
        const snapshot = await serverMarketSnapshot();
        return sendJson(res, 200, snapshot);
      }

      if (req.method === "GET" && url.pathname === "/api/history") {
        const symbols = (url.searchParams.get("symbols") || "").split(",").filter(Boolean);
        if (symbols.length === 0) return sendJson(res, 400, { error: "symbols_required" });
        const interval = url.searchParams.get("interval") || "1d";
        const limit = Number(url.searchParams.get("limit") || 90);
        const history = await serverHistoricalData(symbols, interval, limit);
        return sendJson(res, 200, { history });
      }

      if (req.method === "GET" && url.pathname === "/api/ai/providers") {
        return sendJson(res, 200, { primary: "nvidia", providers: providerStatus() });
      }
      if (req.method === "POST" && url.pathname === "/api/chat") {
        const body = await readBody(req);
        const history = Array.isArray(body.history) ? body.history : [];
        const supplied = Array.isArray(body.messages) ? body.messages : [
          ...history,
          ...(body.message ? [{ role: "user", content: body.message }] : [])
        ];
        const context = body.context ? `\n\nCurrent application state (JSON):\n${JSON.stringify(body.context)}` : "";
        const messages = [
          {
            role: "system",
            content: "You are the tradeBOTZi research copilot. Use only supplied application state for portfolio and market facts. Clearly separate calculated facts from interpretation. PAPER/research only." + context
          },
          ...supplied
        ];
        const jobId = createJobId();
        chatJobs.set(jobId, { status: "pending", createdAt: Date.now() });
        runChatJob(messages).then(result => {
          chatJobs.set(jobId, { status: result.ok ? "done" : "error", result, finishedAt: Date.now() });
        }).catch(error => {
          chatJobs.set(jobId, { status: "error", result: { ok: false, error: String(error) }, finishedAt: Date.now() });
        });
        return sendJson(res, 202, { ok: true, pending: true, jobId });
      }

      if (req.method === "GET" && url.pathname.startsWith("/api/chat/")) {
        const jobId = url.pathname.slice("/api/chat/".length);
        const job = chatJobs.get(jobId);
        if (!job) return sendJson(res, 404, { ok: false, error: "chat_job_not_found" });
        return sendJson(res, 200, { ok: true, jobId, ...job });
      }

      return sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      return sendJson(res, 500, { error: String(error) });
    }
  }

  async function handle(request) {
    const url = new URL(request.url);
    let body = {};
    if (request.method === "POST") {
      const text = await request.text();
      try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
    }
    const req = { method: request.method, url: url.pathname + url.search, headers: Object.fromEntries(request.headers), __body: body };
    return new Promise(resolve => {
      const res = {
        writeHead(code, headers) { res.code = code; res.headers = headers || {}; },
        end(payload) { resolve(new Response(payload ?? null, { status: res.code || 200, headers: res.headers })); },
      };
      route(req, res, url).catch(error => sendJson(res, 500, { error: String(error) }));
    });
  }

  return { handle };
}
