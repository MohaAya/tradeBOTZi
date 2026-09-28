import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.env.BOT_INTEGRATIONS_ROOT || "/opt/tradebotzi-integrations";
const DATA_DIR = process.env.TRADEBOTZI_DATA_DIR || "/opt/tradebotzi/data";
const CABBAGE_ROOT = path.join(ROOT, "cabbage");
const CABBAGE_PYTHON = path.join(CABBAGE_ROOT, ".venv", "bin", "python");
const CABBAGE_SERVICE = "tradebotzi-cabbage-paper";
const CABBAGE_STATE_ROOT = path.join(CABBAGE_ROOT, "runtime");
const CABBAGE_REPORT = path.join(CABBAGE_STATE_ROOT, "paper", "bitvavo", "BTC-EUR", "latest-run.json");
const BOT_JOB_FILE = path.join(DATA_DIR, "bot-jobs.json");

function safeJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function processRunning(needle) {
  try {
    for (const entry of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const cmd = fs.readFileSync("/proc/" + entry + "/cmdline", "utf8").replace(/\0/g, " ");
        if (cmd.includes(needle)) return true;
      } catch {}
    }
  } catch {}
  return false;
}
function totalMemoryGiB() {
  try {
    const text = fs.readFileSync("/proc/meminfo", "utf8");
    const match = text.match(/^MemTotal:\s+(\d+)\s+kB/m);
    const kb = Number(match && match[1] || 0);
    return Math.round((kb / 1024 / 1024) * 10) / 10;
  } catch { return null; }
}

function runProcess(command, args, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 120000);
  const maxOutput = Number(options.maxOutput || 120000);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: Object.assign({}, process.env, options.env || {}),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "", stderr = "";
    const append = (current, chunk) => (current + String(chunk)).slice(-maxOutput);
    child.stdout.on("data", chunk => { stdout = append(stdout, chunk); });
    child.stderr.on("data", chunk => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      const killTimer = setTimeout(() => child.kill("SIGKILL"), 2000);
      if (killTimer.unref) killTimer.unref();
    }, timeoutMs);
    child.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", code => {
      clearTimeout(timer);
      const result = { code, stdout: stdout.trim(), stderr: stderr.trim() };
      if (code === 0) resolve(result);
      else {
        const error = new Error(command + " exited with code " + code + ": " + (stderr || stdout));
        error.result = result;
        reject(error);
      }
    });
  });
}

function traceValue(trace, name, group) {
  const decision = trace && (trace.decision_trace || trace) || {};
  const entries = Array.isArray(decision.entries) ? decision.entries : [];
  const found = entries.find(entry => entry && entry.name === name && (!group || entry.group === group));
  return found ? found.value : null;
}

function summarizeTrace(trace) {
  const decision = trace && (trace.decision_trace || trace) || {};
  const entries = Array.isArray(decision.entries) ? decision.entries : [];
  const indicators = {};
  for (const entry of entries) {
    if (entry && entry.group === "indicators" && entry.name) indicators[entry.name] = entry.value;
  }
  return {
    symbol: trace && trace.symbol || null,
    side: traceValue(trace, "signal_side", "decision"),
    decision: traceValue(trace, "decision", "decision"),
    score: traceValue(trace, "score", "decision"),
    minimumScore: traceValue(trace, "minimum_score", "decision"),
    summary: decision.summary || null,
    indicators
  };
}

function cabbageState() {
  const sourceConnected = fs.existsSync(path.join(CABBAGE_ROOT, "cabbage", "__main__.py"));
  const runtimeReady = fs.existsSync(path.join(CABBAGE_ROOT, ".tradebotzi-ready"));
  const running = processRunning("cabbage paper");
  const report = safeJson(CABBAGE_REPORT, {});
  const blocks = Array.isArray(report.signals) ? report.signals : [];
  const traces = blocks
    .flatMap(block => Array.isArray(block && block.decision_traces) ? block.decision_traces : [])
    .map(summarizeTrace);
  const emittedSignals = blocks.flatMap(block => Array.isArray(block && block.signals) ? block.signals : []);
  const portfolio = Array.isArray(report.portfolios) ? report.portfolios[0] || null : null;
  const positions = Array.isArray(report.positions) ? report.positions : [];
  const trades = Array.isArray(report.trades) ? report.trades : [];
  const orders = Array.isArray(report.orders) ? report.orders : [];
  let action = "HOLD";
  const signalText = JSON.stringify(emittedSignals).toLowerCase();
  if (/open_long|\bbuy\b/.test(signalText)) action = "BUY";
  if (/close_long|\bsell\b/.test(signalText)) action = "SELL";
  const preferred = traces.find(trace => trace.side === "open_long") || traces[0] || null;
  let reportUpdatedAt = null, reportAgeMs = null;
  try {
    const stat = fs.statSync(CABBAGE_REPORT);
    reportUpdatedAt = stat.mtimeMs;
    reportAgeMs = Math.max(0, Date.now() - stat.mtimeMs);
  } catch {}

  return {
    id: "cabbage",
    name: "CABBAGE RSI + EMA",
    repository: "sopersone/cabbage-trading-machine",
    url: "https://github.com/sopersone/cabbage-trading-machine",
    sourceConnected,
    runtimeReady,
    runtimeStatus: running ? "RUNNING" : runtimeReady ? "READY" : sourceConnected ? "INSTALLING" : "MISSING",
    executionMode: "PAPER ONLY",
    market: "BITVAVO",
    pair: "BTC/EUR",
    timeframe: "2h",
    strategy: "cabbage-rsi-ema",
    configuredRisk: {
      initialBalance: 1000,
      ticket: 50,
      stopLossPercent: 5,
      feePercent: 0.25,
      intervalSeconds: 7200
    },
    latest: {
      action,
      runStatus: report.status || null,
      startedAt: report.started_at || null,
      completedAt: report.completed_at || null,
      reportUpdatedAt,
      reportAgeMs,
      closedCandlePrice: preferred && preferred.indicators ? preferred.indicators.Close : null,
      rsi: preferred && preferred.indicators ? preferred.indicators.rsi : null,
      emaShort: preferred && preferred.indicators ? preferred.indicators.ema_short : null,
      emaLong: preferred && preferred.indicators ? preferred.indicators.ema_long : null,
      emittedSignals,
      decisionTraces: traces
    },
    portfolio: portfolio ? {
      initialBalance: Number(portfolio.initial_balance || 0),
      netSize: Number(portfolio.net_size || 0),
      unallocated: Number(portfolio.unallocated || 0),
      totalNetGain: Number(portfolio.total_net_gain || 0),
      realized: Number(portfolio.realized || 0),
      totalTradeVolume: Number(portfolio.total_trade_volume || 0)
    } : null,
    positions,
    trades,
    orders,
    counts: {
      trades: trades.length,
      orders: orders.length,
      positions: positions.filter(pos => String(pos && pos.symbol || "").toUpperCase() !== "EUR").length
    },
    description: "Original Investing Algorithm Framework runtime using the repository's RSI/EMA spot strategy.",
    reason: running
      ? "Continuous CABBAGE PAPER service is running. Latest decisions come from CABBAGE's persisted run report."
      : runtimeReady
        ? "Runtime passed validation but the continuous PAPER service is not running."
        : sourceConnected
          ? "Source is present but runtime validation has not completed."
          : "Repository is not present on this runtime."
  };
}

function stonkflyState() {
  const root = path.join(ROOT, "stonkfly");
  const sourceConnected = fs.existsSync(path.join(root, "stonkfly", "cli.py"));
  const memoryGiB = totalMemoryGiB();
  const running = processRunning("stonkfly run");
  const prepared = fs.existsSync(path.join(root, "data", "graph.npz"))
    && fs.existsSync(path.join(root, "data", "annotations.feather"))
    && fs.existsSync(path.join(root, "data", "normalized", "neurons.feather"));
  const latestCandidates = [
    path.join(root, "runs", "paper", "latest.json"),
    path.join(root, "runs", "tradebotzi-paper", "latest.json"),
    path.join(root, "runs", "tradebotzi-smoke", "latest.json")
  ];
  let latest = null;
  let latestPath = null;
  for (const candidate of latestCandidates) {
    if (!fs.existsSync(candidate)) continue;
    latest = safeJson(candidate, null);
    latestPath = candidate;
    if (latest) break;
  }
  return {
    id: "stonkfly",
    name: "Stonkfly Connectome Bot",
    repository: "nftechie/stonkfly",
    url: "https://github.com/nftechie/stonkfly",
    sourceConnected,
    runtimeReady: prepared,
    runtimeStatus: running ? "RUNNING" : prepared ? "READY" : memoryGiB !== null && memoryGiB < 16 ? "RESOURCE_BLOCKED" : "SOURCE_ONLY",
    executionMode: "PAPER DEFAULT",
    latest,
    latestAvailable: Boolean(latest),
    latestPath,
    description: "Experimental fly-connectome controller with guarded PAPER trading actions.",
    reason: running
      ? "The verified Stonkfly PAPER runtime is running."
      : prepared
        ? (latest
          ? "The checksum-verified connectome is prepared and a persisted PAPER readout is available."
          : "The checksum-verified connectome is prepared. No current PAPER readout exists yet, so the investment council excludes the fly vote instead of inventing one.")
        : memoryGiB !== null && memoryGiB < 16
          ? "Source is connected but the upstream project recommends 16 GB RAM before preparation."
          : "Source is connected; full connectome preparation has not been run.",
    requirements: { recommendedRamGiB: 16, detectedRamGiB: memoryGiB }
  };
}
fs.mkdirSync(DATA_DIR, { recursive: true });
const jobs = new Map();
const savedJobs = safeJson(BOT_JOB_FILE, []);
for (const entry of Array.isArray(savedJobs) ? savedJobs : []) {
  if (!Array.isArray(entry) || entry.length !== 2) continue;
  const id = entry[0], job = entry[1] || {};
  if (job.status === "running" || job.status === "pending") {
    job.status = "error";
    job.error = "API restarted before this bot action completed";
    job.finishedAt = Date.now();
  }
  jobs.set(id, job);
}

function saveJobs() {
  const payload = Array.from(jobs.entries())
    .sort((a, b) => Number(b[1] && b[1].createdAt || 0) - Number(a[1] && a[1].createdAt || 0))
    .slice(0, 100);
  const tmp = BOT_JOB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, BOT_JOB_FILE);
}

function setJob(id, patch) {
  const next = Object.assign({}, jobs.get(id) || {}, patch);
  jobs.set(id, next);
  saveJobs();
  return next;
}
let cabbageExclusive = Promise.resolve();
function withCabbageLock(task) {
  const next = cabbageExclusive.then(task, task);
  cabbageExclusive = next.catch(() => {});
  return next;
}

async function systemctl(action) {
  return runProcess("systemctl", [action, CABBAGE_SERVICE], { timeoutMs: 30000 });
}

async function runCabbageOnce() {
  return withCabbageLock(async () => {
    let stopped = false;
    try {
      if (processRunning("cabbage paper")) {
        await systemctl("stop");
        stopped = true;
      }
      const result = await runProcess(CABBAGE_PYTHON, ["-m", "cabbage", "paper", "--iterations", "1"], {
        cwd: CABBAGE_ROOT,
        timeoutMs: 180000,
        env: { CABBAGE_STATE_DIR: CABBAGE_STATE_ROOT }
      });
      return { ok: true, action: "run_once", output: result.stdout, state: cabbageState() };
    } finally {
      if (stopped || !processRunning("cabbage paper")) {
        try { await systemctl("start"); } catch {}
      }
    }
  });
}
async function runCabbageBacktest() {
  return withCabbageLock(async () => {
    const result = await runProcess(CABBAGE_PYTHON, ["-m", "cabbage", "backtest"], {
      cwd: CABBAGE_ROOT,
      timeoutMs: 300000
    });
    const reportFile = path.join(CABBAGE_STATE_ROOT, "backtest", "bitvavo", "BTC-EUR", "report.html");
    return {
      ok: true,
      action: "backtest",
      output: result.stdout,
      reportAvailable: fs.existsSync(reportFile),
      reportPath: fs.existsSync(reportFile) ? reportFile : null
    };
  });
}

async function executeAction(botId, action) {
  if (botId !== "cabbage") throw new Error("bot_action_not_supported");
  if (action === "run_once") return runCabbageOnce();
  if (action === "backtest") return runCabbageBacktest();
  if (action === "start") {
    await systemctl("start");
    return { ok: true, action, state: cabbageState() };
  }
  if (action === "stop") {
    await systemctl("stop");
    return { ok: true, action, state: cabbageState() };
  }
  throw new Error("unknown_bot_action");
}

function startAction(botId, action) {
  const existing = Array.from(jobs.entries()).find(entry => {
    const job = entry[1] || {};
    return job.botId === botId && (job.status === "pending" || job.status === "running");
  });
  if (existing) throw new Error("bot_action_already_running");
  const id = "bot-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9);
  setJob(id, { botId, action, status: "pending", createdAt: Date.now() });
  Promise.resolve().then(async () => {
    setJob(id, { status: "running", startedAt: Date.now() });
    try {
      const result = await executeAction(botId, action);
      setJob(id, { status: "done", finishedAt: Date.now(), result });
    } catch (error) {
      setJob(id, { status: "error", finishedAt: Date.now(), error: String(error) });
    }
  });
  return Object.assign({ jobId: id }, jobs.get(id));
}

function botState(id) {
  if (id === "cabbage") return cabbageState();
  if (id === "stonkfly") return stonkflyState();
  return null;
}

async function naturalCommand(command) {
  const text = String(command || "");
  if (!/\bcabbage\b/i.test(text)) return null;

  let actionResult = null;
  const asksBacktest =
    /\b(run|start|execute)\b[\s\S]{0,80}\bbacktest\b/i.test(text) ||
    /\bbacktest\b[\s\S]{0,80}\b(run|start|execute)\b/i.test(text);
  const asksRunOnce =
    /\b(run|execute|refresh)\b[\s\S]{0,60}\bcabbage\b[\s\S]{0,40}\b(once|now|signal)\b/i.test(text) ||
    /\bcabbage\b[\s\S]{0,50}\b(run once|run now|refresh signal)\b/i.test(text);

  if (asksBacktest) actionResult = await runCabbageBacktest();
  else if (asksRunOnce) actionResult = await runCabbageOnce();

  return {
    requestedBot: "cabbage",
    actionExecuted: actionResult && actionResult.action || null,
    actionResult,
    state: cabbageState(),
    truthNote: "CABBAGE data comes from the actual external PAPER runtime and persisted decision report. AI agents may interpret it but must not invent signals, trades, or performance."
  };
}
export function createBotIntegrations() {
  return {
    list: () => [cabbageState(), stonkflyState()],
    get: botState,
    startAction,
    getJob: id => jobs.get(id) ? Object.assign({ jobId: id }, jobs.get(id)) : null,
    listJobs: (limit = 20) => Array.from(jobs.entries())
      .map(entry => Object.assign({ jobId: entry[0] }, entry[1]))
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .slice(0, Math.max(1, Math.min(100, Number(limit) || 20))),
    naturalCommand
  };
}
