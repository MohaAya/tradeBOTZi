import http from "node:http";
import { URL } from "node:url";
import fs from "node:fs";

const PORT = Number(process.env.PORT || 3001);
const OMNI_URL = process.env.OMNIROUTE_BASE_URL || "http://host.docker.internal:20128/v1";
const HERMES_URL = process.env.HERMES_BASE_URL || "http://host.docker.internal:8642/v1";
const OLLAMA_URL = process.env.OLLAMA_BASE_URL || "http://host.docker.internal:11434";
const FREELLM_URL = process.env.FREELLM_BASE_URL || "http://127.0.0.1:3002/v1";
const FREELLM_DASHBOARD_URL = process.env.FREELLM_DASHBOARD_URL || "http://127.0.0.1:3001";
const zbotEnvPath = process.env.OMNIROUTE_CONFIG_FILE || "/run/secrets/zbot_env";
const hermesKeyPath = process.env.HERMES_KEY_FILE || "/run/secrets/hermes_key";
const zbotEnv = fs.existsSync(zbotEnvPath) ? fs.readFileSync(zbotEnvPath, "utf8") : "";
const pick = (name) => (zbotEnv.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1] || "").trim().replace(/^['\"]|['\"]$/g, "");
const OMNI_KEY = process.env.OMNIROUTE_API_KEY || pick("AI_GATEWAY_API_KEY");
const HERMES_KEY = process.env.HERMES_API_KEY || (fs.existsSync(hermesKeyPath) ? fs.readFileSync(hermesKeyPath, "utf8").trim() : "");
const OMNI_MODEL = process.env.OMNIROUTE_MODEL || pick("AI_GATEWAY_MODEL") || "auto/best-chat";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";

function sendJson(res, code, body) {
  res.writeHead(code, {
    "content-type": "application/json",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let s = "";
  for await (const c of req) s += c;
  return s ? JSON.parse(s) : {};
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


const BINANCE_BASE = "https://api.binance.com/api/v3";
const COINBASE_BASE = "https://api.coinbase.com/v2";
const HYPERLIQUID_INFO = "https://api.hyperliquid.xyz/info";

async function serverMarketSnapshot() {
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
      if (!response.ok || !Array.isArray(response.data)) return;
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
    } catch {}
  }));

  return result;
}

async function omniModels() {
  return fetchJson(`${OMNI_URL}/models`, {
    headers: { Authorization: `Bearer ${OMNI_KEY}` }
  }, 10000);
}

async function hermesModels() {
  return fetchJson(`${HERMES_URL}/models`, {
    headers: { Authorization: `Bearer ${HERMES_KEY}` }
  }, 10000);
}
async function ollamaModels() {
  return fetchJson(`${OLLAMA_URL}/api/tags`, {}, 10000);
}

async function freeLlmKey() {
  const result = await fetchJson(`${FREELLM_DASHBOARD_URL}/api/settings/api-key`, {}, 10000);
  if (!result.ok || !result.data?.apiKey) throw new Error("FreeLLM API key unavailable");
  return result.data.apiKey;
}

async function freeLlmModels() {
  const key = await freeLlmKey();
  return fetchJson(`${FREELLM_URL}/models`, { headers: bearerHeaders(key) }, 10000);
}

function bearerHeaders(key) {
  const headerName = ["Author", "ization"].join("");
  return { [headerName]: `Bearer ${key}`, "content-type": "application/json" };
}

async function omniChat(messages) {
  return fetchJson(`${OMNI_URL}/chat/completions`, {
    method: "POST",
    headers: bearerHeaders(OMNI_KEY),
    body: JSON.stringify({ model: OMNI_MODEL, messages, stream: false })
  }, 8000);
}
async function freeLlmChat(messages) {
  const key = await freeLlmKey();
  return fetchJson(`${FREELLM_URL}/chat/completions`, {
    method: "POST",
    headers: bearerHeaders(key),
    body: JSON.stringify({ model: "auto", messages, stream: false })
  }, 60000);
}

async function hermesChat(messages) {
  return fetchJson(`${HERMES_URL}/chat/completions`, {
    method: "POST",
    headers: { ...bearerHeaders(HERMES_KEY), "X-Hermes-Session-Key": "tradebotzi" },
    body: JSON.stringify({ model: "hermes-agent", messages, stream: false })
  }, 45000);
}

async function ollamaChat(messages) {
  return fetchJson(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: OLLAMA_MODEL, messages, stream: false })
  }, 60000);
}

function extractContent(provider, result) {
  if (provider === "ollama") return result.data?.message?.content || "";
  return result.data?.choices?.[0]?.message?.content || "";
}

const chatJobs = new Map();
function createJobId() {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
async function runChatJob(messages, preferredProvider = "omniroute") {
  const attempts = [];
  const providers = [
    ["omniroute", omniChat], ["freellm", freeLlmChat], ["ollama", ollamaChat], ["hermes", hermesChat]
  ];
  const orderedProviders = [
    ...providers.filter(([provider]) => provider === preferredProvider),
    ...providers.filter(([provider]) => provider !== preferredProvider),
  ];
  for (const [provider, fn] of orderedProviders) {
    try {
      const started = Date.now();
      const result = await fn(messages);
      const latencyMs = Date.now() - started;
      attempts.push({ provider, status: result.status, latencyMs });
      const content = extractContent(provider, result);
      const model = provider === "omniroute" ? OMNI_MODEL : provider === "freellm" ? "auto" : provider === "hermes" ? "hermes-agent" : OLLAMA_MODEL;
      if (result.ok && content) return { ok: true, provider, model, content, fallbackUsed: provider !== "omniroute", latencyMs, attempts };
    } catch (error) {
      attempts.push({ provider, status: 0, error: String(error) });
    }
  }
  return { ok: false, error: "All AI providers failed", attempts };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, { ok: true, service: "tradebotzi-api", paperOnly: true });
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
      const timed = async (fn) => {
        const started = Date.now();
        try { return { ...(await fn()), latencyMs: Date.now() - started }; }
        catch (error) { return { ok: false, status: 0, data: { error: String(error) }, latencyMs: Date.now() - started }; }
      };
      const [omni, freeLlm, hermes, ollama] = await Promise.all([
        timed(omniModels), timed(freeLlmModels), timed(hermesModels), timed(ollamaModels)
      ]);

      return sendJson(res, 200, { primary: "omniroute", providers: [
        { id: "omniroute", label: "OmniRoute", healthy: omni.ok, status: omni.ok ? "connected" : "error", model: OMNI_MODEL, modelCount: omni.data?.data?.length || 0, latencyMs: omni.latencyMs },
        { id: "freellm", label: "FreeLLM API", healthy: freeLlm.ok, status: freeLlm.ok ? "connected" : "error", model: "auto", modelCount: freeLlm.data?.data?.length || 0, latencyMs: freeLlm.latencyMs },
        { id: "hermes", label: "Hermes Agent", healthy: hermes.ok, status: hermes.ok ? "connected" : "error", model: "hermes-agent", modelCount: hermes.data?.data?.length || 0, latencyMs: hermes.latencyMs },
        { id: "ollama", label: "Local Ollama", healthy: ollama.ok, status: ollama.ok ? "connected" : "error", model: OLLAMA_MODEL, modelCount: ollama.data?.models?.length || 0, latencyMs: ollama.latencyMs }
      ]});
    }
    if (req.method === "POST" && url.pathname === "/api/chat") {
      const body = await readBody(req);
      const history = Array.isArray(body.history) ? body.history : [];
      const supplied = Array.isArray(body.messages) ? body.messages : [
        ...history,
        ...(body.message ? [{ role: "user", content: body.message }] : [])
      ];
      const context = body.context ? `\n\nCurrent application state (JSON):\n${JSON.stringify(body.context)}` : "";
      const role = String(body.agentRole || "Portfolio Manager");
      const preferredProvider = ["omniroute", "freellm", "ollama", "hermes"].includes(body.preferredProvider)
        ? body.preferredProvider
        : "omniroute";
      const roleInstructions = {
        "Portfolio Manager": "Design and compare diversified portfolios. Explain allocations and tradeoffs. Do not invent market data.",
        "Risk Manager": "Stress-test portfolio risk, drawdown, concentration, liquidity and data quality. Veto unsafe PAPER actions.",
        "Technical Analyst": "Analyze trends, momentum, volatility and technical setup using supplied market state. Do not claim to have clicked or read ProChart unless explicit chart data is supplied.",
        "Liquidity Analyst": "Evaluate liquidity, spreads, execution quality and turnover risk.",
        "Derivatives Analyst": "Evaluate perpetual/funding/basis conditions when those fields are available. State when data is unavailable.",
        "Bull Case": "Construct the strongest evidence-based case for the selected portfolio while stating assumptions.",
        "Bear Case": "Challenge the selected portfolio and identify failure modes and invalidation conditions.",
        "Investment Synthesizer": "Synthesize the other evidence into a clear PAPER-investment recommendation, but never override deterministic risk limits."
      };
      const messages = [
        {
          role: "system",
          content: `You are a tradeBOTZi agent operating as ${role}. ${roleInstructions[role] || roleInstructions["Portfolio Manager"]} Use only supplied application state for portfolio and market facts. Clearly separate calculated facts from interpretation. PAPER/research only. You cannot bypass the deterministic risk engine or place real-money orders.` + context
        },
        ...supplied
      ];
      const jobId = createJobId();
      chatJobs.set(jobId, { status: "pending", createdAt: Date.now(), role, preferredProvider });
      runChatJob(messages, preferredProvider).then(result => {
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
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`tradebotzi api listening on ${PORT}`);
});