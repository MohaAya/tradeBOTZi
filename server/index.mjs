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
async function runChatJob(messages) {
  const attempts = [];
  for (const [provider, fn] of [
    ["omniroute", omniChat], ["freellm", freeLlmChat], ["ollama", ollamaChat], ["hermes", hermesChat]
  ]) {
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
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`tradebotzi api listening on ${PORT}`);
});