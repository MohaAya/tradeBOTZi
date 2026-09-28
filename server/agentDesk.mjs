import fs from "node:fs";
import { spawn } from "node:child_process";

export function createAgentDesk(deps) {
  const serverMarketSnapshot = deps.serverMarketSnapshot;
  const callProvider = deps.callProvider;
  const providerModel = deps.providerModel;
  const extractProviderContent = deps.extractProviderContent;
  const externalBotCommand = deps.externalBotCommand;

  const agentStateFile = process.env.AGENT_STATE_FILE || "/opt/tradebotzi/data/agent-state.json";
  let events = [];
  const jobs = new Map();
  let latestScreenshot = null;
  let browserProcess = null;

  const paperFile = process.env.PAPER_STATE_FILE || "/opt/tradebotzi/data/paper-state.json";
  fs.mkdirSync("/opt/tradebotzi/data", { recursive: true });

  try {
    const loadedAgentState = JSON.parse(fs.readFileSync(agentStateFile, "utf8"));
    events = Array.isArray(loadedAgentState.events) ? loadedAgentState.events.slice(-1000) : [];
    for (const entry of Array.isArray(loadedAgentState.jobs) ? loadedAgentState.jobs : []) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const job = entry[1] || {};
      if (job.status === "running" || job.status === "pending") {
        job.status = "error";
        job.finishedAt = Date.now();
        job.error = "Server restarted before this job completed";
      }
      jobs.set(entry[0], job);
    }
  } catch {}

  function saveAgentState() {
    const payload = {
      events: events.slice(-1000),
      jobs: Array.from(jobs.entries())
        .sort(function (a, b) { return Number(b[1].createdAt || 0) - Number(a[1].createdAt || 0); })
        .slice(0, 200)
    };
    const temp = agentStateFile + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(payload, null, 2));
    fs.renameSync(temp, agentStateFile);
  }

  function setJob(jobId, value) {
    jobs.set(jobId, value);
    saveAgentState();
    return value;
  }

  let paperState = { accounts: {}, transactions: [], orders: [], snapshots: [], supervisor: null, supervisorRuns: [] };
  try {
    const loaded = JSON.parse(fs.readFileSync(paperFile, "utf8"));
    paperState = {
      accounts: loaded.accounts || {},
      transactions: Array.isArray(loaded.transactions) ? loaded.transactions : [],
      orders: Array.isArray(loaded.orders) ? loaded.orders : [],
      snapshots: Array.isArray(loaded.snapshots) ? loaded.snapshots : [],
      supervisor: loaded.supervisor || null,
      supervisorRuns: Array.isArray(loaded.supervisorRuns) ? loaded.supervisorRuns : []
    };
  } catch {}

  const supervisorIntervalMs = Math.max(5000, Number(process.env.PAPER_SUPERVISOR_INTERVAL_MS) || 15000);
  let supervisorBusy = false;
  let activeSupervisorCycleId = null;
  let supervisorState = Object.assign({
    enabled: true,
    paperOnly: true,
    intervalMs: supervisorIntervalMs,
    startedAt: Date.now(),
    lastCycleAt: null,
    lastSuccessAt: null,
    lastError: null,
    cycleCount: 0,
    accountsChecked: 0,
    actionsLastCycle: [],
    totalActions: 0
  }, paperState.supervisor || {});
  supervisorState.enabled = true;
  supervisorState.paperOnly = true;
  supervisorState.intervalMs = supervisorIntervalMs;
  supervisorState.running = false;

  function publicSupervisorState() {
    const persistedSupervisorOrders = (paperState.orders || []).filter(function (order) {
      return order && order.supervisor === true && !String(order.portfolioId || "").startsWith("TEST-SUP");
    }).length;
    const now = Date.now();
    const staleAfterMs = Math.max(45000, supervisorIntervalMs * 3);
    const lastSuccessAt = Number(supervisorState.lastSuccessAt) || 0;
    const heartbeatAgeMs = lastSuccessAt > 0 ? Math.max(0, now - lastSuccessAt) : null;
    const healthy = supervisorState.enabled === true &&
      lastSuccessAt > 0 &&
      heartbeatAgeMs !== null &&
      heartbeatAgeMs <= staleAfterMs &&
      !supervisorState.lastError;
    const status = supervisorState.enabled !== true
      ? "OFFLINE"
      : lastSuccessAt <= 0
        ? "STARTING"
        : healthy
          ? "ACTIVE"
          : "STALE";
    return Object.assign({}, supervisorState, {
      running: supervisorBusy,
      healthy: healthy,
      status: status,
      staleAfterMs: staleAfterMs,
      heartbeatAgeMs: heartbeatAgeMs,
      totalActions: persistedSupervisorOrders,
      accountCount: Object.values(paperState.accounts || {}).filter(function (account) {
        return account && account.status === "active";
      }).length
    });
  }

  function saveSupervisorState() {
    paperState.supervisor = publicSupervisorState();
    savePaperState();
  }

  function savePaperState() {
    const temp = paperFile + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(paperState, null, 2));
    fs.renameSync(temp, paperFile);
  }

  function appendPortfolioSnapshot(account, reason) {
    const positions = Array.isArray(account.positions) ? account.positions : [];
    const grossExposure = positions.reduce(function (sum, position) {
      return sum + Math.abs(Number(position.marketValue) || 0);
    }, 0);
    const snapshot = {
      id: "psnap-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      portfolioId: account.portfolioId,
      createdAt: Date.now(),
      reason: reason || "update",
      totalValue: Number(account.equity) || 0,
      unallocated: Number(account.cash) || 0,
      pendingValue: 0,
      totalNetGain: (Number(account.equity) || 0) - (Number(account.initialCapital) || 0),
      totalCost: Number(account.totalFees) || 0,
      grossExposure: grossExposure,
      netExposure: grossExposure,
      positions: positions.map(function (position) {
        return {
          canonicalSymbol: position.canonicalSymbol,
          marketValue: position.marketValue,
          quantity: position.quantity,
          averageCost: position.averageCost,
          currentPrice: position.currentPrice,
          unrealizedPnl: position.unrealizedPnl,
          targetWeight: position.targetWeight,
          portfolioWeight: position.portfolioWeight
        };
      })
    };
    paperState.snapshots = paperState.snapshots.concat([snapshot]).slice(-3000);
    return snapshot;
  }

  function pushEvent(type, message, extra) {
    const details = Object.assign({}, extra || {});
    if (details.supervisor && !details.cycleId && activeSupervisorCycleId) {
      details.cycleId = activeSupervisorCycleId;
    }
    const event = Object.assign({
      id: "evt-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      timestamp: Date.now(),
      type: type,
      message: message
    }, details);
    events.push(event);
    if (events.length > 1000) events.splice(0, events.length - 1000);
    saveAgentState();
    return event;
  }

  function finiteNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function fmtNumber(value, digits) {
    const n = finiteNumber(value);
    return n === null ? null : Number(n.toFixed(digits == null ? 2 : digits));
  }

  function fmtPercent(value, digits) {
    const n = finiteNumber(value);
    return n === null ? null : (n * 100).toFixed(digits == null ? 2 : digits) + "%";
  }

  function portfolioFacts(portfolio) {
    const metrics = portfolio && portfolio.metrics ? portfolio.metrics : {};
    const policy = portfolio && portfolio.riskPolicy ? portfolio.riskPolicy : {};
    return {
      id: portfolio && portfolio.id,
      name: portfolio && portfolio.name,
      description: portfolio && portfolio.description,
      mandate: portfolio && portfolio.mandate,
      holdingPeriod: portfolio && portfolio.holdingPeriod,
      universeLabel: portfolio && portfolio.universeLabel,
      executionReady: portfolio && portfolio.executionReady,
      generator: portfolio && portfolio.generatorParams,
      holdings: Array.isArray(portfolio && portfolio.assets) ? portfolio.assets.map(function (asset) {
        return {
          symbol: asset.canonicalSymbol,
          provider: asset.provider,
          marketType: asset.marketType,
          weight: fmtPercent(asset.weight, 2)
        };
      }) : [],
      metrics: {
        evaluationWindow: metrics.evaluationWindow || null,
        cumulativeReturn: fmtPercent(metrics.cumulativeReturn, 2),
        annualizedReturn: fmtPercent(metrics.annualizedReturn, 2),
        cagr: fmtPercent(metrics.cagr, 2),
        realizedVolatility: fmtPercent(metrics.realizedVolatility, 2),
        downsideVolatility: fmtPercent(metrics.downsideVolatility, 2),
        maxDrawdown: fmtPercent(metrics.maxDrawdown, 2),
        currentDrawdown: fmtPercent(metrics.currentDrawdown, 2),
        var95: fmtPercent(metrics.var95, 2),
        cvar95: fmtPercent(metrics.cvar95, 2),
        sharpeRatio: fmtNumber(metrics.sharpeRatio, 2),
        sortinoRatio: fmtNumber(metrics.sortinoRatio, 2),
        calmarRatio: fmtNumber(metrics.calmarRatio, 2),
        omegaRatio: fmtNumber(metrics.omegaRatio, 2),
        ulcerIndex: fmtPercent(metrics.ulcerIndex, 2),
        recoveryFactor: fmtNumber(metrics.recoveryFactor, 2),
        positiveDayRate: fmtPercent(metrics.positiveDayRate, 1),
        bestDay: fmtPercent(metrics.bestDay, 2),
        worstDay: fmtPercent(metrics.worstDay, 2),
        avgPairwiseCorrelation: fmtNumber(metrics.avgPairwiseCorrelation, 3),
        effectivePositions: fmtNumber(metrics.effectivePositions, 2),
        estimatedSpreadCost: fmtPercent(metrics.estimatedSpreadCost, 3),
        estimatedFees: fmtPercent(metrics.estimatedFees, 2),
        liquidityScore: fmtNumber(metrics.liquidityScore, 2),
        momentumScore: fmtNumber(metrics.momentumScore, 2),
        volatilityRegime: metrics.volatilityRegime || null,
        trendRegime: metrics.trendRegime || null,
        observationCount: finiteNumber(metrics.observationCount),
        dataFreshness: metrics.dataFreshness || null
      },
      riskPolicy: {
        riskScore: fmtNumber(policy.riskScore, 1),
        riskBand: policy.riskBand || null,
        maxSingleAssetWeight: fmtPercent(policy.maxSingleAssetWeight, 0),
        maxPortfolioExposure: fmtPercent(policy.maxPortfolioExposure, 0),
        cashReserve: fmtPercent(policy.cashReserve, 0),
        stopLoss: finiteNumber(policy.stopLossPercent) === null ? null : Number(policy.stopLossPercent).toFixed(1) + "%",
        takeProfit: finiteNumber(policy.takeProfitPercent) === null ? null : Number(policy.takeProfitPercent).toFixed(1) + "%",
        trailingStop: finiteNumber(policy.trailingStopPercent) === null ? null : Number(policy.trailingStopPercent).toFixed(1) + "%",
        rebalanceDays: finiteNumber(policy.rebalanceDays),
        cooldownHours: finiteNumber(policy.cooldownHours),
        maxDrawdownLimit: fmtPercent(policy.maxDrawdownLimit, 0)
      },
      executionStatus: {
        mode: "PAPER_ONLY",
        enforcedAtInitialAllocation: [
          "maximum single-asset weight",
          "maximum portfolio exposure",
          "cash reserve",
          "simulated fees/spread/slippage"
        ],
        storedButNotContinuouslyAutomated: supervisorState.enabled ? [] : [
          "stop-loss",
          "take-profit",
          "trailing stop",
          "cooldown",
          "scheduled rebalance",
          "maximum-drawdown trigger"
        ],
        continuousSupervisorActive: Boolean(supervisorState.enabled),
        supervisorIntervalMs: supervisorState.intervalMs,
        supervisorLastSuccessAt: supervisorState.lastSuccessAt
      },
      performanceStatus: {
        type: "historical_holdout_diagnostic",
        forecast: false,
        liveTrackRecord: false,
        fullExecutionBacktest: false,
        note: "Selection and sizing use an earlier construction window; metrics use a later holdout window."
      }
    };
  }

  function defaultAssignments() {
    return [
      { provider: "omniroute", role: "Portfolio Manager" },
      { provider: "freellm", role: "Quant Researcher" },
      { provider: "hermes", role: "Risk & Operations Agent" },
      { provider: "ollama", role: "Execution Monitor" }
    ];
  }

  function chromiumExecutable() {
    const candidates = [
      process.env.CHROMIUM_PATH,
      "/snap/bin/chromium",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser"
    ].filter(Boolean);
    return candidates.find(function (p) { return fs.existsSync(p); }) || null;
  }

  async function waitForJson(url, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 15000);
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
        if (response.ok) return await response.json();
      } catch (error) {
        lastError = error;
      }
      await new Promise(function (resolve) { setTimeout(resolve, 350); });
    }
    throw lastError || new Error("Timed out waiting for " + url);
  }

  async function ensureBrowser() {
    try {
      await waitForJson("http://127.0.0.1:9333/json/version", 1200);
    } catch {
      const binary = chromiumExecutable();
      if (!binary) throw new Error("Chromium is not installed on the VPS");
      browserProcess = spawn(binary, [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=9333",
        "--user-data-dir=/tmp/tradebotzi-prochart-browser",
        "https://prochart-1le.pages.dev/"
      ], { detached: true, stdio: "ignore" });
      browserProcess.unref();
      await waitForJson("http://127.0.0.1:9333/json/version", 20000);
    }

    let pages = await fetch("http://127.0.0.1:9333/json/list").then(function (r) { return r.json(); });
    let page = pages.find(function (p) {
      return p.type === "page" && String(p.url).includes("prochart-1le.pages.dev");
    });
    if (!page) {
      const created = await fetch(
        "http://127.0.0.1:9333/json/new?" + encodeURIComponent("https://prochart-1le.pages.dev/"),
        { method: "PUT" }
      );
      if (!created.ok) throw new Error("Could not open ProChart page: HTTP " + created.status);
      page = await created.json();
    }
    return page;
  }

  async function withCdp(webSocketDebuggerUrl, callback) {
    const ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise(function (resolve, reject) {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    let sequence = 0;
    const pending = new Map();
    ws.addEventListener("message", function (event) {
      const msg = JSON.parse(event.data);
      if (!msg.id || !pending.has(msg.id)) return;
      const entry = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(JSON.stringify(msg.error)));
      else entry.resolve(msg.result);
    });

    function send(method, params) {
      const id = ++sequence;
      ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
      return new Promise(function (resolve, reject) {
        pending.set(id, { resolve: resolve, reject: reject });
      });
    }

    async function evaluate(expression) {
      const result = await send("Runtime.evaluate", {
        expression: expression,
        returnByValue: true,
        awaitPromise: true
      });
      return result.result && result.result.value;
    }

    try {
      await send("Runtime.enable");
      await send("Page.enable");
      return await callback({ send: send, evaluate: evaluate });
    } finally {
      ws.close();
    }
  }

  function requestedSymbol(command) {
    const text = String(command || "").toUpperCase();
    const direct = text.match(/\b([A-Z]{2,10})USDT\b/);
    if (direct) return direct[1] + "USDT";
    const known = ["BTC","ETH","SOL","BNB","XRP","ADA","DOGE","AVAX","LINK","DOT","ATOM","NEAR","SUI","LTC"];
    const found = known.find(function (symbol) {
      return new RegExp("\\b" + symbol + "\\b").test(text);
    });
    return found ? found + "USDT" : "BTCUSDT";
  }

  async function runProChart(command) {
    const page = await ensureBrowser();
    const symbol = requestedSymbol(command);
    const wantsBacktest = /backtest|strategy tester|test strategy/i.test(command);
    const wantsIndicators = /indicator|rsi|macd|ema|bollinger|supertrend/i.test(command);
    const actions = [];

    return withCdp(page.webSocketDebuggerUrl, async function (cdp) {
      await cdp.send("Page.navigate", { url: "https://prochart-1le.pages.dev/" });
      await new Promise(function (resolve) { setTimeout(resolve, 1800); });
      const title = await cdp.evaluate("document.title");
      actions.push({ action: "open", ok: Boolean(title), detail: title || "ProChart" });
      pushEvent("prochart", "Agent browser opened ProChart: " + (title || "ProChart"), { action: "open" });

      const symbolLiteral = JSON.stringify(symbol);
      const currentSymbol = await cdp.evaluate(
        "(()=>{const buttons=Array.from(document.querySelectorAll('button'));const b=buttons.find(x=>x.querySelector('svg.lucide-search')&&x.querySelector('span.font-semibold'));const s=b&&b.querySelector('span.font-semibold');return s?(s.textContent||'').trim():'';})()"
      );

      let pickerOpened = false;
      let selected = String(currentSymbol || "").toUpperCase() === symbol.toUpperCase();

      if (!selected) {
        pickerOpened = await cdp.evaluate(
          "(()=>{const buttons=Array.from(document.querySelectorAll('button'));const b=buttons.find(x=>x.querySelector('svg.lucide-search')&&x.querySelector('span.font-semibold'));if(!b)return false;b.click();return true;})()"
        );
        if (pickerOpened) await new Promise(function (resolve) { setTimeout(resolve, 450); });

        const typed = await cdp.evaluate(
          "(()=>{const s=" + symbolLiteral + ";const i=document.querySelector('input[placeholder*=\"Search symbol\" i],input[placeholder*=\"symbol\" i],input[role=\"combobox\"]');if(!i)return false;const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,s);i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));return true;})()"
        );
        if (typed) await new Promise(function (resolve) { setTimeout(resolve, 650); });

        selected = await cdp.evaluate(
          "(()=>{const s=" + symbolLiteral + ";const nodes=Array.from(document.querySelectorAll('button,[role=\"option\"],[data-slot=\"command-item\"],[cmdk-item]'));let target=nodes.find(x=>{const t=(x.innerText||x.textContent||'').trim();const first=t.split('\\n')[0].trim();return first===s||t===s||t.startsWith(s+'\\n');});if(!target){const all=Array.from(document.querySelectorAll('*')).filter(x=>{const t=(x.textContent||'').trim();return t===s;});target=all.map(x=>x.closest('button,[role=\"option\"],[data-slot=\"command-item\"],[cmdk-item]')||x).find(Boolean);}if(!target)return false;target.click();return true;})()"
        );
      }

      actions.push({ action: "symbol_picker", ok: selected ? true : Boolean(pickerOpened), detail: symbol });
      actions.push({ action: "symbol", ok: Boolean(selected), detail: symbol });
      pushEvent(
        "prochart",
        (selected ? "Selected " : "Could not select ") + symbol + " in ProChart",
        { action: "symbol", symbol: symbol }
      );
      if (selected) await new Promise(function (resolve) { setTimeout(resolve, 1200); });

      if (wantsIndicators) {
        const clicked = await cdp.evaluate(
          "(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>x.innerText.trim().startsWith('Indicators'));if(!b)return false;b.click();return true;})()"
        );
        actions.push({ action: "indicators", ok: Boolean(clicked), detail: "Indicators" });
        pushEvent("prochart", clicked ? "Opened the Indicators panel" : "Indicators control was not found", { action: "indicators" });
        await new Promise(function (resolve) { setTimeout(resolve, 500); });
      }

      if (wantsBacktest) {
        const tester = await cdp.evaluate(
          "(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>x.innerText.trim()==='Strategy Tester');if(!b)return false;b.click();return true;})()"
        );
        actions.push({ action: "strategy_tester", ok: Boolean(tester), detail: "Strategy Tester" });
        pushEvent("prochart", tester ? "Opened Strategy Tester" : "Strategy Tester control was not found", { action: "strategy_tester" });
        await new Promise(function (resolve) { setTimeout(resolve, 450); });

        const run = await cdp.evaluate(
          "(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>x.innerText.trim()==='Run Backtest');if(!b)return false;b.click();return true;})()"
        );
        actions.push({ action: "run_backtest", ok: Boolean(run), detail: symbol });
        pushEvent("prochart", run ? "Clicked Run Backtest for " + symbol : "Run Backtest control was not found", { action: "run_backtest", symbol: symbol });
        if (run) {
          const deadline = Date.now() + 30000;
          while (Date.now() < deadline) {
            await new Promise(function (resolve) { setTimeout(resolve, 1000); });
            const bodyText = String(await cdp.evaluate("document.body.innerText") || "");
            const stillRunning = /Running…|Running\.\.\.|Fetching TradingView candles and calculating strategy/i.test(bodyText);
            if (!stillRunning) break;
          }
        }
      }

      const text = await cdp.evaluate("document.body.innerText");
      const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
      if (screenshot && screenshot.data) latestScreenshot = screenshot.data;
      return {
        ok: true,
        symbol: symbol,
        actions: actions,
        pageTitle: title,
        observedText: String(text || "").slice(0, 2500),
        screenshotAvailable: Boolean(latestScreenshot)
      };
    });
  }

  function explicitProChartCommand(command) {
    const text = String(command || "").toLowerCase();
    if (/\b(do not|don't|dont|no)\s+(open|use|run|inspect|check)\b[^.]*\b(prochart|chart|backtest|indicator|strategy tester)\b/i.test(text)) {
      return false;
    }
    return /prochart|chart|backtest|indicator|strategy tester/i.test(text);
  }

  function explicitInvestmentCommand(command) {
    const text = String(command || "").toLowerCase();
    if (/\b(do not|don't|dont|no)\s+(invest|execute|buy|rebalance|deploy|allocate|simulate)/i.test(text)) return false;
    const paperAction = /\bpaper\b/i.test(text) &&
      /\b(invest|execute|buy|deploy|rebalance|allocate|allocation|simulate|simulation)\b/i.test(text);
    return paperAction || /\b(invest|execute|buy|start paper|paper invest|deploy capital|rebalance)\b/i.test(text);
  }

  function choosePortfolio(command, context) {
    const portfolios = Array.isArray(context && context.portfolios) ? context.portfolios : [];
    if (!portfolios.length) return null;
    const text = String(command || "").toLowerCase();

    for (const portfolio of portfolios) {
      const id = String(portfolio.id || "").toLowerCase();
      const name = String(portfolio.name || "").toLowerCase();
      if ((id && text.includes(id)) || (name && text.includes(name))) return portfolio;
    }

    const ranking = context && context.latestRanking;
    if (ranking && Array.isArray(ranking.results)) {
      const ranked = ranking.results.find(function (result) { return !result.disqualified; });
      const match = portfolios.find(function (portfolio) { return portfolio.id === (ranked && ranked.portfolioId); });
      if (match) return match;
    }

    return portfolios.find(function (portfolio) { return portfolio.status !== "disqualified"; }) || portfolios[0];
  }

  async function executePaperPortfolio(portfolio, capital) {
    if (!portfolio || !portfolio.id || !Array.isArray(portfolio.assets) || portfolio.assets.length < 2) {
      throw new Error("A valid portfolio with at least two assets is required for PAPER execution");
    }
    if (portfolio.executionReady === false) {
      throw new Error("Risk engine rejected portfolio: portfolio is marked REVIEW REQUIRED");
    }

    const riskPolicy = portfolio.riskPolicy || {
      maxSingleAssetWeight: 0.35,
      maxPortfolioExposure: 0.95,
      cashReserve: 0.05,
      stopLossPercent: 10,
      takeProfitPercent: 20,
      trailingStopPercent: 8,
      rebalanceDays: 7,
      cooldownHours: 24,
      maxDrawdownLimit: 0.35,
      riskScore: 5,
      riskBand: "MODERATE"
    };

    const weights = portfolio.assets.map(function (asset) {
      const direct = Number(asset.weight);
      return Number.isFinite(direct) ? direct : Number(asset.allocationPercent) / 100;
    });
    if (weights.some(function (weight) { return !Number.isFinite(weight) || weight <= 0; })) {
      throw new Error("Portfolio contains invalid asset weights");
    }

    const maxSingleAssetWeight = Math.min(0.35, Math.max(0.05, Number(riskPolicy.maxSingleAssetWeight) || 0.35));
    if (weights.some(function (weight) { return weight > maxSingleAssetWeight + 0.000001; })) {
      throw new Error("Risk engine rejected portfolio: an asset weight exceeds the policy single-asset limit");
    }

    pushEvent("pipeline_phase", "Position sizing validated for " + portfolio.id, {
      portfolioId: portfolio.id,
      phase: "position_sizing"
    });

    const snapshot = await serverMarketSnapshot();
    const prices = new Map();
    for (const observation of snapshot.observations || []) {
      const price = Number(observation && observation.price);
      if (!observation || !observation.canonicalSymbol || !Number.isFinite(price) || price <= 0) continue;
      const existing = prices.get(observation.canonicalSymbol);
      if (!existing || observation.provider === "binance") prices.set(observation.canonicalSymbol, observation);
    }

    const assumptions = {
      feesPercent: 0.10,
      spreadPercent: 0.05,
      slippagePercent: 0.02,
      fillDelayMs: 100
    };
    const initialCapital = Math.max(100, Number(capital) || 100000);
    const maxExposure = Math.max(0.25, Math.min(0.98, Number(riskPolicy.maxPortfolioExposure) || 0.95));
    const minimumReserve = Math.max(0, Math.min(0.75, Number(riskPolicy.cashReserve) || 0.05));
    const investableFraction = Math.min(maxExposure, 1 - minimumReserve);
    const reserve = initialCapital * (1 - investableFraction);
    const investable = initialCapital * investableFraction;
    const totalWeight = weights.reduce(function (sum, weight) { return sum + weight; }, 0);

    pushEvent("pipeline_phase", "Portfolio exposure budget applied: " + (investableFraction * 100).toFixed(0) + "% invested, " + ((1 - investableFraction) * 100).toFixed(0) + "% reserve", {
      portfolioId: portfolio.id,
      phase: "risk_budget",
      maxExposure: maxExposure,
      cashReserve: 1 - investableFraction
    });
    pushEvent("pipeline_phase", "Execution cost model applied before PAPER orders", {
      portfolioId: portfolio.id,
      phase: "execution_costs",
      assumptions: assumptions
    });
    const positions = [];
    const transactions = [];
    let spent = 0;
    let totalFees = 0;

    for (let index = 0; index < portfolio.assets.length; index++) {
      const asset = portfolio.assets[index];
      const market = prices.get(asset.canonicalSymbol);
      const marketPrice = Number(market && market.price);
      if (!Number.isFinite(marketPrice) || marketPrice <= 0) {
        pushEvent("paper_skip", "Skipped " + asset.canonicalSymbol + ": live price unavailable", {
          portfolioId: portfolio.id,
          symbol: asset.canonicalSymbol
        });
        continue;
      }

      const normalizedWeight = weights[index] / totalWeight;
      const targetSpend = investable * normalizedWeight;
      const feeRate = assumptions.feesPercent / 100;
      const observedSpreadPercent = market && market.spread && market.price
        ? Math.max(0, (Number(market.spread) / Number(market.price)) * 100)
        : 0;
      const effectiveSpreadPercent = observedSpreadPercent > 0
        ? observedSpreadPercent
        : assumptions.spreadPercent;
      const spreadRate = effectiveSpreadPercent / 100;
      const slippageRate = assumptions.slippagePercent / 100;
      const fillPrice = marketPrice * (1 + spreadRate / 2 + slippageRate);
      const notional = targetSpend / (1 + feeRate);
      const fees = notional * feeRate;
      const quantity = notional / fillPrice;
      const total = notional + fees;
      const marketValue = quantity * marketPrice;
      spent += total;
      totalFees += fees;

      const stopLossPrice = fillPrice * (1 - Math.max(0, Number(riskPolicy.stopLossPercent) || 0) / 100);
      const takeProfitPrice = fillPrice * (1 + Math.max(0, Number(riskPolicy.takeProfitPercent) || 0) / 100);

      positions.push({
        canonicalSymbol: asset.canonicalSymbol,
        provider: market.provider,
        quantity: quantity,
        averageCost: fillPrice,
        currentPrice: marketPrice,
        marketValue: marketValue,
        unrealizedPnl: marketValue - notional,
        targetWeight: normalizedWeight,
        portfolioWeight: (targetSpend / initialCapital),
        stopLossPrice: stopLossPrice,
        takeProfitPrice: takeProfitPrice,
        trailingStopPercent: Number(riskPolicy.trailingStopPercent) || 0,
        cooldownHours: Number(riskPolicy.cooldownHours) || 0,
        highWaterMark: Math.max(fillPrice, marketPrice),
        trailingStopPrice: null,
        lastMarkedAt: Date.now()
      });

      const order = {
        id: "pord-" + Date.now() + "-" + index + "-" + Math.random().toString(36).slice(2, 7),
        portfolioId: portfolio.id,
        canonicalSymbol: asset.canonicalSymbol,
        provider: market.provider,
        type: "MARKET",
        side: "buy",
        status: "FILLED",
        requestedNotional: targetSpend,
        filledNotional: notional,
        quantity: quantity,
        submittedAt: Date.now(),
        filledAt: Date.now(),
        fillPrice: fillPrice,
        simulated: true
      };
      paperState.orders = paperState.orders.concat([order]).slice(-3000);
      pushEvent("paper_order", "PAPER MARKET BUY submitted for " + asset.canonicalSymbol, {
        portfolioId: portfolio.id,
        symbol: asset.canonicalSymbol,
        orderId: order.id,
        simulated: true
      });

      const transaction = {
        id: "ptx-" + Date.now() + "-" + index + "-" + Math.random().toString(36).slice(2, 7),
        portfolioId: portfolio.id,
        timestamp: Date.now(),
        canonicalSymbol: asset.canonicalSymbol,
        provider: market.provider,
        side: "buy",
        quantity: quantity,
        price: fillPrice,
        fees: fees,
        total: total,
        simulated: true,
        assumptions: assumptions
      };
      transactions.push(transaction);
      pushEvent("paper_fill", "PAPER BUY " + asset.canonicalSymbol + ": " + quantity.toFixed(6) + " @ " + fillPrice.toFixed(4), {
        portfolioId: portfolio.id,
        symbol: asset.canonicalSymbol,
        quantity: quantity,
        price: fillPrice,
        simulated: true
      });
    }

    if (positions.length < 2) {
      throw new Error("Risk engine rejected PAPER execution: insufficient priced assets");
    }

    const cash = Math.max(0, initialCapital - spent);
    const marketValue = positions.reduce(function (sum, position) { return sum + position.marketValue; }, 0);
    const equity = cash + marketValue;
    const account = {
      portfolioId: portfolio.id,
      portfolioName: portfolio.name,
      initialCapital: initialCapital,
      cash: cash,
      positions: positions,
      realizedPnl: 0,
      unrealizedPnl: positions.reduce(function (sum, position) { return sum + position.unrealizedPnl; }, 0),
      totalFees: totalFees,
      totalFunding: 0,
      equity: equity,
      peakEquity: initialCapital,
      drawdown: (equity - initialCapital) / initialCapital,
      transactions: transactions,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      status: "active",
      mode: "PAPER",
      assumptions: assumptions,
      targetAssets: portfolio.assets.map(function (asset, index) {
        return {
          canonicalSymbol: asset.canonicalSymbol,
          provider: asset.provider,
          targetWeight: weights[index] / totalWeight
        };
      }),
      cooldowns: {},
      lastRebalancedAt: Date.now(),
      nextRebalanceAt: Date.now() + Math.max(1, Number(riskPolicy.rebalanceDays) || 7) * 86400000,
      lastSupervisorAt: null,
      lastSnapshotAt: Date.now(),
      supervisorActionCount: 0,
      riskPolicy: riskPolicy,
      riskChecks: {
        paperOnly: true,
        maxSingleAssetWeight: maxSingleAssetWeight,
        maxPortfolioExposure: maxExposure,
        cashReservePercent: (1 - investableFraction) * 100,
        stopLossPercent: Number(riskPolicy.stopLossPercent) || 0,
        takeProfitPercent: Number(riskPolicy.takeProfitPercent) || 0,
        trailingStopPercent: Number(riskPolicy.trailingStopPercent) || 0,
        cooldownHours: Number(riskPolicy.cooldownHours) || 0,
        passed: true
      }
    };

    paperState.accounts[portfolio.id] = account;
    paperState.transactions = paperState.transactions.concat(transactions).slice(-2000);
    const portfolioSnapshot = appendPortfolioSnapshot(account, "initial_allocation");
    savePaperState();
    pushEvent("portfolio_snapshot", "Saved PAPER portfolio snapshot for " + portfolio.id, {
      portfolioId: portfolio.id,
      snapshotId: portfolioSnapshot.id,
      totalValue: portfolioSnapshot.totalValue,
      grossExposure: portfolioSnapshot.grossExposure
    });
    pushEvent("paper_account", "PAPER portfolio " + portfolio.id + " is now invested with " + positions.length + " positions", {
      portfolioId: portfolio.id,
      equity: equity,
      simulated: true
    });
    return account;
  }

  function paperPriceMap(snapshot) {
    const prices = new Map();
    for (const observation of (snapshot && snapshot.observations) || []) {
      const price = Number(observation && observation.price);
      if (!observation || !observation.canonicalSymbol || !Number.isFinite(price) || price <= 0) continue;
      const existing = prices.get(observation.canonicalSymbol);
      if (!existing || observation.provider === "binance") {
        prices.set(observation.canonicalSymbol, observation);
      }
    }
    return prices;
  }

  function executionRates(account, market) {
    const assumptions = account.assumptions || {
      feesPercent: 0.10,
      spreadPercent: 0.05,
      slippagePercent: 0.02
    };
    const observedSpreadPercent = market && market.spread && market.price
      ? Math.max(0, (Number(market.spread) / Number(market.price)) * 100)
      : 0;
    const spreadPercent = observedSpreadPercent > 0
      ? observedSpreadPercent
      : Number(assumptions.spreadPercent) || 0.05;
    return {
      feeRate: (Number(assumptions.feesPercent) || 0.10) / 100,
      spreadRate: spreadPercent / 100,
      slippageRate: (Number(assumptions.slippagePercent) || 0.02) / 100
    };
  }

  function targetWeightFor(account, symbol) {
    const target = (account.targetAssets || []).find(function (asset) {
      return asset.canonicalSymbol === symbol;
    });
    return Number(target && target.targetWeight) || 0;
  }

  function ensurePositionThresholds(account, position) {
    const policy = account.riskPolicy || {};
    const stopLossPercent = Math.max(0, Number(policy.stopLossPercent) || 0);
    const takeProfitPercent = Math.max(0, Number(policy.takeProfitPercent) || 0);
    position.stopLossPrice = Number(position.stopLossPrice) > 0
      ? Number(position.stopLossPrice)
      : Number(position.averageCost) * (1 - stopLossPercent / 100);
    position.takeProfitPrice = Number(position.takeProfitPrice) > 0
      ? Number(position.takeProfitPrice)
      : Number(position.averageCost) * (1 + takeProfitPercent / 100);
    position.trailingStopPercent = Number(position.trailingStopPercent) >= 0
      ? Number(position.trailingStopPercent)
      : Math.max(0, Number(policy.trailingStopPercent) || 0);
    position.cooldownHours = Number(position.cooldownHours) >= 0
      ? Number(position.cooldownHours)
      : Math.max(0, Number(policy.cooldownHours) || 0);
    position.highWaterMark = Math.max(
      Number(position.highWaterMark) || 0,
      Number(position.averageCost) || 0,
      Number(position.currentPrice) || 0
    );
    if (position.trailingStopPercent > 0 && position.highWaterMark > Number(position.averageCost || 0)) {
      position.trailingStopPrice = position.highWaterMark * (1 - position.trailingStopPercent / 100);
    } else {
      position.trailingStopPrice = null;
    }
  }

  function recomputeAccount(account) {
    const positions = Array.isArray(account.positions) ? account.positions : [];
    const marketValue = positions.reduce(function (sum, position) {
      return sum + Math.max(0, Number(position.marketValue) || 0);
    }, 0);
    account.unrealizedPnl = positions.reduce(function (sum, position) {
      return sum + (Number(position.unrealizedPnl) || 0);
    }, 0);
    account.equity = Math.max(0, Number(account.cash) || 0) + marketValue;
    account.peakEquity = Math.max(Number(account.peakEquity) || 0, account.equity);
    account.drawdown = account.peakEquity > 0
      ? (account.equity - account.peakEquity) / account.peakEquity
      : 0;
    account.updatedAt = Date.now();
    return account;
  }

  function recordSupervisorSell(account, position, market, quantity, reason, now) {
    const marketPrice = Number(market && market.price);
    const qty = Math.min(Math.max(0, Number(quantity) || 0), Math.max(0, Number(position.quantity) || 0));
    if (!Number.isFinite(marketPrice) || marketPrice <= 0 || qty <= 0) return null;

    const rates = executionRates(account, market);
    const fillPrice = Math.max(0.00000001, marketPrice * (1 - rates.spreadRate / 2 - rates.slippageRate));
    const gross = qty * fillPrice;
    const fees = gross * rates.feeRate;
    const proceeds = Math.max(0, gross - fees);
    const costBasis = qty * (Number(position.averageCost) || 0);
    const realized = proceeds - costBasis;

    const order = {
      id: "supord-" + now + "-" + Math.random().toString(36).slice(2, 8),
      portfolioId: account.portfolioId,
      canonicalSymbol: position.canonicalSymbol,
      provider: market.provider || position.provider,
      type: "MARKET",
      side: "sell",
      status: "FILLED",
      requestedQuantity: qty,
      filledNotional: gross,
      quantity: qty,
      submittedAt: now,
      filledAt: now,
      fillPrice: fillPrice,
      simulated: true,
      supervisor: true,
      reason: reason
    };
    paperState.orders = paperState.orders.concat([order]).slice(-3000);

    const transaction = {
      id: "suptx-" + now + "-" + Math.random().toString(36).slice(2, 8),
      portfolioId: account.portfolioId,
      timestamp: now,
      canonicalSymbol: position.canonicalSymbol,
      provider: market.provider || position.provider,
      side: "sell",
      quantity: qty,
      price: fillPrice,
      fees: fees,
      total: proceeds,
      realizedPnl: realized,
      simulated: true,
      supervisor: true,
      reason: reason
    };
    paperState.transactions = paperState.transactions.concat([transaction]).slice(-3000);
    account.transactions = (account.transactions || []).concat([transaction]).slice(-1000);
    account.cash = (Number(account.cash) || 0) + proceeds;
    account.realizedPnl = (Number(account.realizedPnl) || 0) + realized;
    account.totalFees = (Number(account.totalFees) || 0) + fees;

    const remaining = Math.max(0, Number(position.quantity) - qty);
    position.quantity = remaining;
    position.currentPrice = marketPrice;
    position.marketValue = remaining * marketPrice;
    position.unrealizedPnl = remaining * (marketPrice - Number(position.averageCost || 0));
    position.lastMarkedAt = now;

    if (remaining <= 1e-12) {
      const cooldownHours = Math.max(0, Number(position.cooldownHours) || Number(account.riskPolicy && account.riskPolicy.cooldownHours) || 0);
      account.cooldowns = account.cooldowns || {};
      account.cooldowns[position.canonicalSymbol] = now + cooldownHours * 3600000;
    }

    pushEvent("paper_order", "Supervisor PAPER SELL submitted for " + position.canonicalSymbol + " (" + reason + ")", {
      portfolioId: account.portfolioId,
      symbol: position.canonicalSymbol,
      orderId: order.id,
      reason: reason,
      simulated: true,
      supervisor: true
    });
    pushEvent("paper_fill", "Supervisor PAPER SELL " + position.canonicalSymbol + ": " + qty.toFixed(6) + " @ " + fillPrice.toFixed(4) + " (" + reason + ")", {
      portfolioId: account.portfolioId,
      symbol: position.canonicalSymbol,
      quantity: qty,
      price: fillPrice,
      realizedPnl: realized,
      reason: reason,
      simulated: true,
      supervisor: true
    });

    return { order: order, transaction: transaction, realizedPnl: realized };
  }

  function recordSupervisorBuy(account, symbol, market, budget, reason, now) {
    const marketPrice = Number(market && market.price);
    const spendBudget = Math.max(0, Number(budget) || 0);
    if (!Number.isFinite(marketPrice) || marketPrice <= 0 || spendBudget <= 0) return null;

    const rates = executionRates(account, market);
    const fillPrice = marketPrice * (1 + rates.spreadRate / 2 + rates.slippageRate);
    const notional = spendBudget / (1 + rates.feeRate);
    const fees = notional * rates.feeRate;
    const total = notional + fees;
    if (total > (Number(account.cash) || 0) + 1e-8) return null;

    const quantity = notional / fillPrice;
    const existing = (account.positions || []).find(function (position) {
      return position.canonicalSymbol === symbol;
    });
    const targetWeight = targetWeightFor(account, symbol);
    let position = existing;

    if (position) {
      const oldQty = Number(position.quantity) || 0;
      const newQty = oldQty + quantity;
      const weightedCost = oldQty * (Number(position.averageCost) || 0) + quantity * fillPrice;
      position.quantity = newQty;
      position.averageCost = newQty > 0 ? weightedCost / newQty : fillPrice;
    } else {
      position = {
        canonicalSymbol: symbol,
        provider: market.provider,
        quantity: quantity,
        averageCost: fillPrice,
        currentPrice: marketPrice,
        marketValue: quantity * marketPrice,
        unrealizedPnl: quantity * (marketPrice - fillPrice),
        targetWeight: targetWeight,
        portfolioWeight: 0,
        trailingStopPercent: Number(account.riskPolicy && account.riskPolicy.trailingStopPercent) || 0,
        cooldownHours: Number(account.riskPolicy && account.riskPolicy.cooldownHours) || 0,
        highWaterMark: Math.max(fillPrice, marketPrice),
        trailingStopPrice: null,
        lastMarkedAt: now
      };
      account.positions = (account.positions || []).concat([position]);
    }

    position.provider = market.provider || position.provider;
    position.currentPrice = marketPrice;
    position.marketValue = Number(position.quantity) * marketPrice;
    position.unrealizedPnl = Number(position.quantity) * (marketPrice - Number(position.averageCost));
    position.targetWeight = targetWeight;
    position.highWaterMark = Math.max(Number(position.highWaterMark) || 0, marketPrice, Number(position.averageCost) || 0);
    position.lastMarkedAt = now;
    position.stopLossPrice = Number(position.averageCost) * (1 - Math.max(0, Number(account.riskPolicy && account.riskPolicy.stopLossPercent) || 0) / 100);
    position.takeProfitPrice = Number(position.averageCost) * (1 + Math.max(0, Number(account.riskPolicy && account.riskPolicy.takeProfitPercent) || 0) / 100);
    ensurePositionThresholds(account, position);

    account.cash = Math.max(0, (Number(account.cash) || 0) - total);
    account.totalFees = (Number(account.totalFees) || 0) + fees;

    const order = {
      id: "supord-" + now + "-" + Math.random().toString(36).slice(2, 8),
      portfolioId: account.portfolioId,
      canonicalSymbol: symbol,
      provider: market.provider,
      type: "MARKET",
      side: "buy",
      status: "FILLED",
      requestedNotional: spendBudget,
      filledNotional: notional,
      quantity: quantity,
      submittedAt: now,
      filledAt: now,
      fillPrice: fillPrice,
      simulated: true,
      supervisor: true,
      reason: reason
    };
    paperState.orders = paperState.orders.concat([order]).slice(-3000);

    const transaction = {
      id: "suptx-" + now + "-" + Math.random().toString(36).slice(2, 8),
      portfolioId: account.portfolioId,
      timestamp: now,
      canonicalSymbol: symbol,
      provider: market.provider,
      side: "buy",
      quantity: quantity,
      price: fillPrice,
      fees: fees,
      total: total,
      simulated: true,
      supervisor: true,
      reason: reason
    };
    paperState.transactions = paperState.transactions.concat([transaction]).slice(-3000);
    account.transactions = (account.transactions || []).concat([transaction]).slice(-1000);

    pushEvent("paper_order", "Supervisor PAPER BUY submitted for " + symbol + " (" + reason + ")", {
      portfolioId: account.portfolioId,
      symbol: symbol,
      orderId: order.id,
      reason: reason,
      simulated: true,
      supervisor: true
    });
    pushEvent("paper_fill", "Supervisor PAPER BUY " + symbol + ": " + quantity.toFixed(6) + " @ " + fillPrice.toFixed(4) + " (" + reason + ")", {
      portfolioId: account.portfolioId,
      symbol: symbol,
      quantity: quantity,
      price: fillPrice,
      reason: reason,
      simulated: true,
      supervisor: true
    });

    return { order: order, transaction: transaction };
  }

  function markAccountToMarket(account, prices, now) {
    for (const position of account.positions || []) {
      const market = prices.get(position.canonicalSymbol);
      const marketPrice = Number(market && market.price);
      if (!Number.isFinite(marketPrice) || marketPrice <= 0) continue;
      position.currentPrice = marketPrice;
      position.marketValue = (Number(position.quantity) || 0) * marketPrice;
      position.unrealizedPnl = (Number(position.quantity) || 0) * (marketPrice - Number(position.averageCost || 0));
      position.highWaterMark = Math.max(Number(position.highWaterMark) || 0, marketPrice, Number(position.averageCost) || 0);
      position.lastMarkedAt = now;
      ensurePositionThresholds(account, position);
      if (position.trailingStopPercent > 0 && position.highWaterMark > Number(position.averageCost || 0)) {
        position.trailingStopPrice = position.highWaterMark * (1 - position.trailingStopPercent / 100);
      }
    }
    recomputeAccount(account);
  }

  function triggeredExitReason(account, position) {
    const price = Number(position.currentPrice);
    if (!Number.isFinite(price) || price <= 0) return null;
    const stopLoss = Number(position.stopLossPrice);
    const takeProfit = Number(position.takeProfitPrice);
    const trailingStop = Number(position.trailingStopPrice);

    if (Number.isFinite(stopLoss) && stopLoss > 0 && price <= stopLoss) return "stop_loss";
    if (Number.isFinite(takeProfit) && takeProfit > 0 && price >= takeProfit) return "take_profit";
    if (
      Number.isFinite(trailingStop) &&
      trailingStop > 0 &&
      Number(position.highWaterMark) > Number(position.averageCost || 0) &&
      price <= trailingStop
    ) return "trailing_stop";
    return null;
  }

  function rebalanceDue(account, now) {
    const next = Number(account.nextRebalanceAt);
    if (Number.isFinite(next) && next > 0) return now >= next;
    const days = Math.max(1, Number(account.riskPolicy && account.riskPolicy.rebalanceDays) || 7);
    const last = Number(account.lastRebalancedAt) || Number(account.startedAt) || now;
    account.nextRebalanceAt = last + days * 86400000;
    return now >= account.nextRebalanceAt;
  }

  function scheduledRebalance(account, prices, now, actions) {
    const policy = account.riskPolicy || {};
    const exposure = Math.max(0.25, Math.min(0.98, Number(policy.maxPortfolioExposure) || 0.95));
    const reserveFraction = Math.max(0, Math.min(0.75, Number(policy.cashReserve) || 0.05));
    const investableFraction = Math.min(exposure, 1 - reserveFraction);
    recomputeAccount(account);
    const targetInvested = account.equity * investableFraction;
    const threshold = Math.max(25, account.equity * 0.005);
    const targetAssets = Array.isArray(account.targetAssets) ? account.targetAssets : [];

    // Sell overweight positions first.
    for (const position of [...(account.positions || [])]) {
      const market = prices.get(position.canonicalSymbol);
      if (!market) continue;
      const target = targetAssets.find(function (asset) {
        return asset.canonicalSymbol === position.canonicalSymbol;
      });
      const targetValue = target ? targetInvested * (Number(target.targetWeight) || 0) : 0;
      const excess = (Number(position.marketValue) || 0) - targetValue;
      if (excess <= threshold) continue;
      const qty = Math.min(Number(position.quantity) || 0, excess / Number(market.price));
      const result = recordSupervisorSell(account, position, market, qty, "scheduled_rebalance", now);
      if (result) {
        actions.push({
          portfolioId: account.portfolioId,
          type: "rebalance_sell",
          symbol: position.canonicalSymbol,
          quantity: qty
        });
      }
    }
    account.positions = (account.positions || []).filter(function (position) {
      return Number(position.quantity) > 1e-12;
    });
    markAccountToMarket(account, prices, now);

    const minimumCash = account.equity * (1 - investableFraction);
    for (const target of targetAssets) {
      const cooldownUntil = Number(account.cooldowns && account.cooldowns[target.canonicalSymbol]) || 0;
      if (cooldownUntil > now) {
        pushEvent("supervisor_cooldown", "Rebalance skipped " + target.canonicalSymbol + " until cooldown expires", {
          portfolioId: account.portfolioId,
          symbol: target.canonicalSymbol,
          cooldownUntil: cooldownUntil,
          supervisor: true
        });
        continue;
      }

      const market = prices.get(target.canonicalSymbol);
      if (!market) continue;
      const position = (account.positions || []).find(function (candidate) {
        return candidate.canonicalSymbol === target.canonicalSymbol;
      });
      const currentValue = Number(position && position.marketValue) || 0;
      const targetValue = targetInvested * (Number(target.targetWeight) || 0);
      const shortage = targetValue - currentValue;
      if (shortage <= threshold) continue;

      const available = Math.max(0, (Number(account.cash) || 0) - minimumCash);
      const budget = Math.min(shortage, available);
      if (budget <= threshold) continue;
      const result = recordSupervisorBuy(account, target.canonicalSymbol, market, budget, "scheduled_rebalance", now);
      if (result) {
        actions.push({
          portfolioId: account.portfolioId,
          type: "rebalance_buy",
          symbol: target.canonicalSymbol,
          notional: budget
        });
      }
    }

    markAccountToMarket(account, prices, now);
    account.lastRebalancedAt = now;
    account.nextRebalanceAt = now + Math.max(1, Number(policy.rebalanceDays) || 7) * 86400000;
    pushEvent("supervisor_rebalance", "Scheduled PAPER rebalance completed for " + account.portfolioId, {
      portfolioId: account.portfolioId,
      equity: account.equity,
      nextRebalanceAt: account.nextRebalanceAt,
      supervisor: true
    });
  }

  async function runSupervisorCycle(reason) {
    if (supervisorBusy) {
      return Object.assign({ skipped: true, reason: "cycle_already_running" }, publicSupervisorState());
    }

    supervisorBusy = true;
    supervisorState.running = true;
    const now = Date.now();
    const cycleId = "supcycle-" + now + "-" + Math.random().toString(36).slice(2, 8);
    activeSupervisorCycleId = cycleId;
    supervisorState.currentCycleId = cycleId;
    const actions = [];
    let accountsChecked = 0;
    const runRecord = {
      cycleId: cycleId,
      reason: reason || "interval",
      startedAt: now,
      finishedAt: null,
      status: "running",
      accountsChecked: 0,
      actions: [],
      error: null
    };

    pushEvent("supervisor_start", "PAPER Portfolio Supervisor cycle started", {
      cycleId: cycleId,
      reason: reason || "interval",
      supervisor: true
    });

    try {
      const activeAccounts = Object.values(paperState.accounts || {}).filter(function (account) {
        return account && account.status === "active";
      });

      supervisorState.lastCycleAt = now;
      if (activeAccounts.length === 0) {
        supervisorState.lastSuccessAt = now;
        supervisorState.lastError = null;
        supervisorState.cycleCount = (Number(supervisorState.cycleCount) || 0) + 1;
        supervisorState.accountsChecked = 0;
        supervisorState.actionsLastCycle = [];
        runRecord.finishedAt = Date.now();
        runRecord.status = "done";
        runRecord.accountsChecked = 0;
        runRecord.actions = [];
        paperState.supervisorRuns = paperState.supervisorRuns.concat([runRecord]).slice(-200);
        saveSupervisorState();
        return Object.assign({}, publicSupervisorState(), { cycleId: cycleId, running: false, currentCycleId: null });
      }

      const snapshot = await serverMarketSnapshot();
      const prices = paperPriceMap(snapshot);

      for (const account of activeAccounts) {
        accountsChecked += 1;
        account.cooldowns = account.cooldowns || {};
        account.targetAssets = Array.isArray(account.targetAssets) ? account.targetAssets : [];
        if (account.targetAssets.length === 0 && Array.isArray(account.positions)) {
          account.targetAssets = account.positions
            .filter(function (position) { return Number(position.targetWeight) > 0; })
            .map(function (position) {
              return {
                canonicalSymbol: position.canonicalSymbol,
                provider: position.provider,
                targetWeight: Number(position.targetWeight)
              };
            });
        }
        markAccountToMarket(account, prices, now);

        // Per-position deterministic exits.
        for (const position of [...(account.positions || [])]) {
          const market = prices.get(position.canonicalSymbol);
          if (!market) continue;
          const exitReason = triggeredExitReason(account, position);
          if (!exitReason) continue;

          const quantity = Number(position.quantity) || 0;
          const result = recordSupervisorSell(account, position, market, quantity, exitReason, now);
          if (result) {
            actions.push({
              portfolioId: account.portfolioId,
              type: exitReason,
              symbol: position.canonicalSymbol,
              quantity: quantity,
              realizedPnl: result.realizedPnl
            });
          }
        }
        account.positions = (account.positions || []).filter(function (position) {
          return Number(position.quantity) > 1e-12;
        });
        markAccountToMarket(account, prices, now);

        // Portfolio max-drawdown risk-off liquidation.
        const limit = Math.max(0, Number(account.riskPolicy && account.riskPolicy.maxDrawdownLimit) || 0);
        if (limit > 0 && account.drawdown <= -limit && (account.positions || []).length > 0) {
          pushEvent("supervisor_drawdown", "Portfolio " + account.portfolioId + " breached max drawdown " + (limit * 100).toFixed(1) + "%; entering PAPER risk-off", {
            portfolioId: account.portfolioId,
            drawdown: account.drawdown,
            limit: limit,
            supervisor: true
          });

          for (const position of [...account.positions]) {
            const market = prices.get(position.canonicalSymbol);
            if (!market) continue;
            const quantity = Number(position.quantity) || 0;
            const result = recordSupervisorSell(account, position, market, quantity, "portfolio_drawdown_limit", now);
            if (result) {
              actions.push({
                portfolioId: account.portfolioId,
                type: "portfolio_drawdown_limit",
                symbol: position.canonicalSymbol,
                quantity: quantity,
                realizedPnl: result.realizedPnl
              });
            }
          }
          account.positions = (account.positions || []).filter(function (position) {
            return Number(position.quantity) > 1e-12;
          });
          markAccountToMarket(account, prices, now);
          account.status = "risk_off";
          account.riskOffAt = now;
          account.riskOffReason = "max_drawdown_limit";
          account.nextRebalanceAt = null;
          actions.push({
            portfolioId: account.portfolioId,
            type: "risk_off",
            drawdown: account.drawdown
          });
        } else if (account.status === "active" && rebalanceDue(account, now)) {
          scheduledRebalance(account, prices, now, actions);
        }

        account.lastSupervisorAt = now;
        account.supervisorActionCount = (Number(account.supervisorActionCount) || 0) +
          actions.filter(function (action) { return action.portfolioId === account.portfolioId; }).length;

        const actionForAccount = actions.some(function (action) {
          return action.portfolioId === account.portfolioId;
        });
        const dueSnapshot = !Number(account.lastSnapshotAt) || now - Number(account.lastSnapshotAt) >= 300000;
        if (actionForAccount || dueSnapshot) {
          const snapshotRecord = appendPortfolioSnapshot(account, actionForAccount ? "supervisor_action" : "mark_to_market");
          account.lastSnapshotAt = now;
          pushEvent("portfolio_snapshot", "Supervisor saved PAPER snapshot for " + account.portfolioId, {
            portfolioId: account.portfolioId,
            snapshotId: snapshotRecord.id,
            totalValue: snapshotRecord.totalValue,
            grossExposure: snapshotRecord.grossExposure,
            supervisor: true
          });
        }
      }

      supervisorState.lastSuccessAt = Date.now();
      supervisorState.lastError = null;
      supervisorState.cycleCount = (Number(supervisorState.cycleCount) || 0) + 1;
      supervisorState.accountsChecked = accountsChecked;
      supervisorState.actionsLastCycle = actions.slice(-50);
      supervisorState.totalActions = (Number(supervisorState.totalActions) || 0) + actions.length;
      supervisorState.lastReason = reason || "interval";
      supervisorState.lastCycleId = cycleId;
      supervisorState.currentCycleId = null;
      runRecord.finishedAt = Date.now();
      runRecord.status = "done";
      runRecord.accountsChecked = accountsChecked;
      runRecord.actions = actions.slice(-100);
      paperState.supervisorRuns = paperState.supervisorRuns.concat([runRecord]).slice(-200);
      paperState.supervisor = publicSupervisorState();
      savePaperState();

      pushEvent("supervisor_cycle", "PAPER Portfolio Supervisor cycle completed: " + accountsChecked + " account(s), " + actions.length + " action(s)", {
        accountsChecked: accountsChecked,
        actionCount: actions.length,
        reason: reason || "interval",
        supervisor: true
      });

      return Object.assign({}, publicSupervisorState(), { cycleId: cycleId, actions: actions, running: false, currentCycleId: null });
    } catch (error) {
      supervisorState.lastError = String(error);
      supervisorState.lastCycleAt = now;
      supervisorState.lastCycleId = cycleId;
      supervisorState.currentCycleId = null;
      runRecord.finishedAt = Date.now();
      runRecord.status = "error";
      runRecord.accountsChecked = accountsChecked;
      runRecord.actions = actions.slice(-100);
      runRecord.error = String(error);
      paperState.supervisorRuns = paperState.supervisorRuns.concat([runRecord]).slice(-200);
      paperState.supervisor = publicSupervisorState();
      savePaperState();
      pushEvent("supervisor_error", "PAPER Portfolio Supervisor cycle failed: " + String(error), {
        supervisor: true
      });
      throw error;
    } finally {
      supervisorBusy = false;
      activeSupervisorCycleId = null;
      supervisorState.running = false;
      supervisorState.currentCycleId = null;
      paperState.supervisor = publicSupervisorState();
      savePaperState();
    }
  }

  const supervisorTimer = setInterval(function () {
    runSupervisorCycle("interval").catch(function () {});
  }, supervisorIntervalMs);
  if (supervisorTimer.unref) supervisorTimer.unref();

  const supervisorStartupTimer = setTimeout(function () {
    runSupervisorCycle("startup").catch(function () {});
  }, 2500);
  if (supervisorStartupTimer.unref) supervisorStartupTimer.unref();

  async function runCommand(jobId, request) {
    const command = String(request.command || "").trim();
    const context = request.context || {};
    const assignments = Array.isArray(request.agents) && request.agents.length
      ? request.agents
      : defaultAssignments();

    setJob(jobId, {
      status: "running",
      command: command,
      createdAt: Date.now(),
      results: []
    });
    pushEvent("command", "Command received: " + command, { jobId: jobId });

    let externalBots = null;
    if (typeof externalBotCommand === "function") {
      try {
        externalBots = await externalBotCommand(command);
        if (externalBots) {
          pushEvent("external_bot", "External bot adapter supplied verified runtime context", {
            jobId: jobId,
            bot: externalBots.requestedBot || null,
            action: externalBots.actionExecuted || null
          });
        }
      } catch (error) {
        externalBots = {
          error: String(error),
          truthNote: "External bot action/context retrieval failed; do not invent bot state."
        };
        pushEvent("error", "External bot adapter failed: " + String(error), { jobId: jobId });
      }
    }

    let proChart = null;
    if (explicitProChartCommand(command)) {
      try {
        pushEvent("prochart", "Starting a real VPS browser session for ProChart", { jobId: jobId });
        proChart = await runProChart(command);
      } catch (error) {
        proChart = { ok: false, error: String(error) };
        pushEvent("error", "ProChart browser action failed: " + String(error), { jobId: jobId });
      }
    }

    const contextText = JSON.stringify({
      mode: "PAPER_ONLY",
      portfolios: (context.portfolios || []).map(portfolioFacts),
      latestRanking: context.latestRanking || null,
      providerStatuses: context.providerStatuses || [],
      markets: (context.markets || []).slice(0, 40),
      proChart: proChart,
      externalBots: externalBots
    }).slice(0, 70000);

    const agentResults = await Promise.all(assignments.map(async function (assignment) {
      const provider = String(assignment.provider || "");
      const role = String(assignment.role || "Research Agent");
      const messages = [
        {
          role: "system",
          content:
            "You are the " + role + " in tradeBOTZi's multi-agent investment research desk.\n" +
            "This system is PAPER ONLY. You may analyze, challenge, and propose portfolio changes, but you may not bypass the deterministic risk engine or claim that a real-money order was placed.\n" +
            "Use only the supplied application state for concrete portfolio and market facts. State uncertainties clearly. Be concise and specific.\n" +
            "Never invent ProChart/backtest metrics. Only report a metric if it appears explicitly in the supplied proChart.observedText. If a backtest is still running or no completed metrics are present, say DATA UNAVAILABLE or PENDING.\n" +
            "Portfolio riskPolicy fields and calculated metrics are deterministic. Interpret them, but never override or invent them.\n" +
            "Execution truth: the PAPER Portfolio Supervisor runs continuously on the VPS. It marks active PAPER positions to market, updates trailing peaks, executes simulated stop-loss/take-profit/trailing-stop exits, honors cooldowns, performs scheduled deterministic rebalancing, enforces portfolio maximum-drawdown risk-off liquidation, and persists orders/fills/snapshots. It remains PAPER ONLY and cannot place real-money orders. Only claim a supervisor action occurred if the supplied state or audit events show it.\n" +
            "Performance truth: portfolio selection and sizing use an earlier construction window, while reported performance/risk metrics use a later holdout window. These are historical holdout diagnostics, not a guarantee, forecast, live track record, or full walk-forward execution backtest.\n" +
            "The portfolio facts supplied below already format percentages with explicit percent signs. Use those strings exactly. Do not reconvert, reannualize, or reinterpret their units.\n" +
            "Recovery Factor is total return divided by absolute maximum drawdown; higher values indicate stronger recovery efficiency. Do not reverse that interpretation.\n" +
            "Do not describe holdout diagnostics as profits the bot 'delivered' or 'earned'. Say the portfolio 'showed' or 'would have shown' those historical diagnostic values.\n" +
            "External bot truth: when externalBots is present, it comes from a concrete bot adapter. Treat its state, decisions, actions, trades, and outputs as authoritative for that external bot. Never invent a signal or claim an external bot action happened unless externalBots shows it.\n" +
            "AI analysis is advisory only. PAPER execution decisions are made by the deterministic risk engine after all agent responses.\n" +
            "Current application state:\n" + contextText
        },
        { role: "user", content: command }
      ];

      const candidates = provider === "freellm"
        ? ["freellm", "ollama"]
        : [provider, "freellm"];
      const uniqueCandidates = candidates.filter(function (candidate, index, array) {
        return candidate && array.indexOf(candidate) === index;
      });
      const attempts = [];

      for (const candidate of uniqueCandidates) {
        try {
          const started = Date.now();
          pushEvent("provider_request", role + " sent a request to " + candidate + " / " + providerModel(candidate), {
            jobId: jobId,
            provider: candidate,
            preferredProvider: provider,
            role: role,
            model: providerModel(candidate),
            requestStartedAt: started
          });
          const response = await callProvider(candidate, messages);
          const latencyMs = Date.now() - started;
          const content = extractProviderContent(candidate, response);
          if (!response.ok || !content) {
            const detail = response && response.data && response.data.error;
            throw new Error(
              (detail && (detail.message || String(detail))) ||
              ("HTTP " + (response && response.status))
            );
          }
          const fallbackUsed = candidate !== provider;
          const result = {
            provider: candidate,
            preferredProvider: provider,
            fallbackUsed: fallbackUsed,
            role: role,
            model: providerModel(candidate),
            content: content,
            latencyMs: latencyMs,
            attempts: attempts.concat([{ provider: candidate, ok: true, latencyMs: latencyMs }]),
            ok: true
          };
          pushEvent(
            "provider_response",
            role + " received a valid response from " + candidate + " / " + providerModel(candidate) + " in " + latencyMs + " ms" + (fallbackUsed ? " (fallback from " + provider + ")" : ""),
            {
              jobId: jobId,
              provider: candidate,
              preferredProvider: provider,
              fallbackUsed: fallbackUsed,
              role: role,
              latencyMs: latencyMs
            }
          );
          return result;
        } catch (error) {
          attempts.push({ provider: candidate, ok: false, error: String(error) });
          pushEvent("provider_failure", role + " request to " + candidate + " failed: " + String(error), {
            jobId: jobId,
            provider: candidate,
            preferredProvider: provider,
            role: role
          });
        }
      }

      const result = {
        provider: provider,
        preferredProvider: provider,
        role: role,
        ok: false,
        attempts: attempts,
        error: attempts.map(function (attempt) {
          return attempt.provider + ": " + attempt.error;
        }).join(" | ")
      };
      pushEvent("provider_exhausted", role + " exhausted its configured AI providers", {
        jobId: jobId,
        provider: provider,
        role: role
      });
      return result;
    }));

    let paperExecution = null;
    if (explicitInvestmentCommand(command)) {
      const portfolio = choosePortfolio(command, context);
      if (!portfolio) {
        paperExecution = {
          ok: false,
          error: "No eligible portfolio was supplied to the execution engine"
        };
        pushEvent("risk_reject", "PAPER investment command rejected: no eligible portfolio supplied", {
          jobId: jobId
        });
      } else {
        try {
          pushEvent("risk_check", "Risk engine validating " + portfolio.id + " before PAPER investment", {
            jobId: jobId,
            portfolioId: portfolio.id
          });
          const account = await executePaperPortfolio(portfolio, request.capital);
          paperExecution = { ok: true, account: account };
        } catch (error) {
          paperExecution = { ok: false, error: String(error) };
          pushEvent("risk_reject", "PAPER investment rejected: " + String(error), {
            jobId: jobId,
            portfolioId: portfolio && portfolio.id
          });
        }
      }
    }

    const completed = {
      status: "done",
      command: command,
      createdAt: (jobs.get(jobId) && jobs.get(jobId).createdAt) || Date.now(),
      finishedAt: Date.now(),
      results: agentResults,
      proChart: proChart,
      externalBots: externalBots,
      paperExecution: paperExecution
    };
    setJob(jobId, completed);
    pushEvent("job_complete", "Agent command completed", { jobId: jobId });
    return completed;
  }

  async function handle(req, res, url, readBody, sendJson) {
    if (req.method === "GET" && url.pathname === "/api/agents/activity") {
      const since = Number(url.searchParams.get("since") || 0);
      const recent = events.filter(function (event) { return event.timestamp > since; }).slice(-200);
      sendJson(res, 200, { events: recent, now: Date.now() });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/agents/status") {
      sendJson(res, 200, {
        assignments: defaultAssignments(),
        activeJobs: Array.from(jobs.entries())
          .filter(function (entry) {
            return entry[1].status === "running" || entry[1].status === "pending";
          })
          .map(function (entry) {
            return {
              id: entry[0],
              status: entry[1].status,
              command: entry[1].command
            };
          }),
        browser: {
          installed: Boolean(chromiumExecutable()),
          screenshotAvailable: Boolean(latestScreenshot)
        },
        supervisor: publicSupervisorState(),
        paperOnly: true
      });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/agents/command") {
      const body = await readBody(req);
      const command = String(body.command || "").trim();
      if (!command) {
        sendJson(res, 400, { ok: false, error: "command_required" });
        return true;
      }
      const jobId = "agent-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9);
      setJob(jobId, {
        status: "pending",
        command: command,
        createdAt: Date.now()
      });
      runCommand(jobId, body).catch(function (error) {
        setJob(jobId, {
          status: "error",
          command: command,
          createdAt: (jobs.get(jobId) && jobs.get(jobId).createdAt) || Date.now(),
          finishedAt: Date.now(),
          error: String(error)
        });
        pushEvent("error", "Agent job failed: " + String(error), { jobId: jobId });
      });
      sendJson(res, 202, {
        ok: true,
        pending: true,
        jobId: jobId,
        paperOnly: true
      });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/agents/jobs") {
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 20)));
      const list = Array.from(jobs.entries())
        .map(function (entry) { return Object.assign({ jobId: entry[0] }, entry[1]); })
        .sort(function (a, b) { return Number(b.createdAt || 0) - Number(a.createdAt || 0); })
        .slice(0, limit);
      sendJson(res, 200, { ok: true, jobs: list, now: Date.now() });
      return true;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/agents/jobs/")) {
      const jobId = url.pathname.slice("/api/agents/jobs/".length);
      const job = jobs.get(jobId);
      if (!job) {
        sendJson(res, 404, { ok: false, error: "agent_job_not_found" });
        return true;
      }
      sendJson(res, 200, Object.assign({ ok: true, jobId: jobId }, job));
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/agents/prochart/screenshot") {
      if (!latestScreenshot) {
        sendJson(res, 404, { ok: false, error: "no_prochart_screenshot" });
        return true;
      }
      const bytes = Buffer.from(latestScreenshot, "base64");
      res.writeHead(200, {
        "content-type": "image/png",
        "content-length": String(bytes.length),
        "cache-control": "no-store"
      });
      res.end(bytes);
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/paper/supervisor/runs") {
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 20)));
      sendJson(res, 200, {
        ok: true,
        paperOnly: true,
        runs: (paperState.supervisorRuns || []).slice(-limit).reverse()
      });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/paper/supervisor") {
      sendJson(res, 200, {
        ok: true,
        paperOnly: true,
        supervisor: publicSupervisorState(),
        supervisorRuns: (paperState.supervisorRuns || []).slice(-20)
      });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/paper/supervisor/run") {
      try {
        const result = await runSupervisorCycle("manual");
        sendJson(res, 200, {
          ok: true,
          paperOnly: true,
          supervisor: result
        });
      } catch (error) {
        sendJson(res, 500, {
          ok: false,
          paperOnly: true,
          error: String(error),
          supervisor: publicSupervisorState()
        });
      }
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/paper/accounts") {
      sendJson(res, 200, {
        paperOnly: true,
        accounts: Object.values(paperState.accounts),
        transactions: paperState.transactions.slice(-200),
        orders: paperState.orders.slice(-200),
        snapshots: paperState.snapshots.slice(-200),
        supervisor: publicSupervisorState()
      });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/paper/snapshots") {
      const portfolioId = String(url.searchParams.get("portfolioId") || "");
      const snapshots = portfolioId
        ? paperState.snapshots.filter(function (snapshot) { return snapshot.portfolioId === portfolioId; })
        : paperState.snapshots;
      sendJson(res, 200, {
        paperOnly: true,
        snapshots: snapshots.slice(-500)
      });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/paper/start") {
      const body = await readBody(req);
      try {
        const account = await executePaperPortfolio(body.portfolio, body.capital);
        sendJson(res, 200, {
          ok: true,
          paperOnly: true,
          account: account
        });
      } catch (error) {
        sendJson(res, 400, {
          ok: false,
          error: String(error),
          paperOnly: true
        });
      }
      return true;
    }

    return false;
  }

  return {
    handle: handle,
    defaultAssignments: defaultAssignments
  };
}