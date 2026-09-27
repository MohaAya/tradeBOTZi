import fs from "node:fs";
import { spawn } from "node:child_process";

export function createAgentDesk(deps) {
  const serverMarketSnapshot = deps.serverMarketSnapshot;
  const callProvider = deps.callProvider;
  const providerModel = deps.providerModel;
  const extractProviderContent = deps.extractProviderContent;

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

  let paperState = { accounts: {}, transactions: [], orders: [], snapshots: [] };
  try {
    const loaded = JSON.parse(fs.readFileSync(paperFile, "utf8"));
    paperState = {
      accounts: loaded.accounts || {},
      transactions: Array.isArray(loaded.transactions) ? loaded.transactions : [],
      orders: Array.isArray(loaded.orders) ? loaded.orders : [],
      snapshots: Array.isArray(loaded.snapshots) ? loaded.snapshots : []
    };
  } catch {}

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
    const event = Object.assign({
      id: "evt-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      timestamp: Date.now(),
      type: type,
      message: message
    }, extra || {});
    events.push(event);
    if (events.length > 1000) events.splice(0, events.length - 1000);
    saveAgentState();
    return event;
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
        cooldownHours: Number(riskPolicy.cooldownHours) || 0
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
      portfolios: context.portfolios || [],
      latestRanking: context.latestRanking || null,
      providerStatuses: context.providerStatuses || [],
      markets: (context.markets || []).slice(0, 40),
      proChart: proChart
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
            "Execution truth: the current PAPER engine enforces maximum asset weight, maximum portfolio exposure, cash reserve, and simulated costs when the initial allocation is created. Stop-loss, take-profit, trailing-stop, cooldown, rebalance interval, and maximum-drawdown rules are currently stored policy parameters and position thresholds only; there is not yet a continuous supervisor that automatically fires them. Never claim those rules are already running automatically.\n" +
            "Performance truth: portfolio selection and sizing use an earlier construction window, while reported performance/risk metrics use a later holdout window. These are historical holdout diagnostics, not a guarantee, forecast, or full walk-forward execution backtest.\n" +
            "Recovery Factor is total return divided by absolute maximum drawdown; higher values indicate stronger recovery efficiency. Do not reverse that interpretation.\n" +
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

    if (req.method === "GET" && url.pathname === "/api/paper/accounts") {
      sendJson(res, 200, {
        paperOnly: true,
        accounts: Object.values(paperState.accounts),
        transactions: paperState.transactions.slice(-200),
        orders: paperState.orders.slice(-200),
        snapshots: paperState.snapshots.slice(-200)
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