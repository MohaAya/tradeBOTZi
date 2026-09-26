import fs from "node:fs";
import { spawn } from "node:child_process";

export function createAgentDesk(deps) {
  const serverMarketSnapshot = deps.serverMarketSnapshot;
  const callProvider = deps.callProvider;
  const providerModel = deps.providerModel;
  const extractProviderContent = deps.extractProviderContent;

  const events = [];
  const jobs = new Map();
  let latestScreenshot = null;
  let browserProcess = null;

  const paperFile = process.env.PAPER_STATE_FILE || "/opt/tradebotzi/data/paper-state.json";
  fs.mkdirSync("/opt/tradebotzi/data", { recursive: true });
  let paperState = { accounts: {}, transactions: [] };
  try {
    paperState = JSON.parse(fs.readFileSync(paperFile, "utf8"));
  } catch {}

  function savePaperState() {
    const temp = paperFile + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(paperState, null, 2));
    fs.renameSync(temp, paperFile);
  }

  function pushEvent(type, message, extra) {
    const event = Object.assign({
      id: "evt-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      timestamp: Date.now(),
      type: type,
      message: message
    }, extra || {});
    events.push(event);
    if (events.length > 400) events.splice(0, events.length - 400);
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
      const opened = await cdp.evaluate(
        "(()=>{const s=" + symbolLiteral + ";const b=Array.from(document.querySelectorAll('button')).find(x=>x.innerText.trim()==='BTCUSDT'||x.innerText.trim()===s);if(!b)return false;b.click();return true;})()"
      );
      if (opened) {
        await new Promise(function (resolve) { setTimeout(resolve, 450); });
        const typed = await cdp.evaluate(
          "(()=>{const s=" + symbolLiteral + ";const i=document.querySelector('input[placeholder*=\"Search symbol\"]');if(!i)return false;const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,s);i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));return true;})()"
        );
        if (typed) await new Promise(function (resolve) { setTimeout(resolve, 500); });
        const selected = await cdp.evaluate(
          "(()=>{const s=" + symbolLiteral + ";const bs=Array.from(document.querySelectorAll('button')).filter(b=>b.innerText.trim().split('\\n')[0]===s);const t=bs[bs.length-1];if(!t)return false;t.click();return true;})()"
        );
        actions.push({ action: "symbol", ok: Boolean(selected), detail: symbol });
        pushEvent(
          "prochart",
          (selected ? "Selected " : "Could not select ") + symbol + " in ProChart",
          { action: "symbol", symbol: symbol }
        );
        await new Promise(function (resolve) { setTimeout(resolve, 600); });
      }

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

  function explicitInvestmentCommand(command) {
    const text = String(command || "").toLowerCase();
    if (/\b(do not|don't|dont|no)\s+(invest|execute|buy|rebalance|deploy)/i.test(text)) return false;
    return /\b(invest|execute|buy|start paper|paper invest|deploy capital|rebalance)\b/i.test(text);
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

    const weights = portfolio.assets.map(function (asset) {
      const direct = Number(asset.weight);
      return Number.isFinite(direct) ? direct : Number(asset.allocationPercent) / 100;
    });
    if (weights.some(function (weight) { return !Number.isFinite(weight) || weight <= 0; })) {
      throw new Error("Portfolio contains invalid asset weights");
    }
    if (weights.some(function (weight) { return weight > 0.350001; })) {
      throw new Error("Risk engine rejected portfolio: an asset weight exceeds the 35% hard limit");
    }

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
    const reserve = initialCapital * 0.05;
    const investable = initialCapital - reserve;
    const totalWeight = weights.reduce(function (sum, weight) { return sum + weight; }, 0);
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
      const spreadRate = assumptions.spreadPercent / 100;
      const slippageRate = assumptions.slippagePercent / 100;
      const fillPrice = marketPrice * (1 + spreadRate / 2 + slippageRate);
      const notional = targetSpend / (1 + feeRate);
      const fees = notional * feeRate;
      const quantity = notional / fillPrice;
      const total = notional + fees;
      const marketValue = quantity * marketPrice;
      spent += total;
      totalFees += fees;

      positions.push({
        canonicalSymbol: asset.canonicalSymbol,
        provider: market.provider,
        quantity: quantity,
        averageCost: fillPrice,
        currentPrice: marketPrice,
        marketValue: marketValue,
        unrealizedPnl: marketValue - notional
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
      riskChecks: {
        paperOnly: true,
        maxSingleAssetWeight: 0.35,
        cashReservePercent: 5,
        passed: true
      }
    };

    paperState.accounts[portfolio.id] = account;
    paperState.transactions = paperState.transactions.concat(transactions).slice(-2000);
    savePaperState();
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

    jobs.set(jobId, {
      status: "running",
      command: command,
      createdAt: Date.now(),
      results: []
    });
    pushEvent("command", "Command received: " + command, { jobId: jobId });

    let proChart = null;
    if (/prochart|chart|backtest|indicator|strategy tester/i.test(command)) {
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
      pushEvent("agent_start", role + " started using " + provider, {
        jobId: jobId,
        provider: provider,
        role: role
      });

      const messages = [
        {
          role: "system",
          content:
            "You are the " + role + " in tradeBOTZi's multi-agent investment research desk.\n" +
            "This system is PAPER ONLY. You may analyze, challenge, and propose portfolio changes, but you may not bypass the deterministic risk engine or claim that a real-money order was placed.\n" +
            "Use only the supplied application state for concrete portfolio and market facts. State uncertainties clearly. Be concise and specific.\n" +
            "Never invent ProChart/backtest metrics. Only report a metric if it appears explicitly in the supplied proChart.observedText. If a backtest is still running or no completed metrics are present, say DATA UNAVAILABLE or PENDING.\n" +
            "AI analysis is advisory only. PAPER execution decisions are made by the deterministic risk engine after all agent responses.\n" +
            "Current application state:\n" + contextText
        },
        { role: "user", content: command }
      ];

      try {
        const started = Date.now();
        const response = await callProvider(provider, messages);
        const latencyMs = Date.now() - started;
        const content = extractProviderContent(provider, response);
        if (!response.ok || !content) {
          const detail = response && response.data && response.data.error;
          throw new Error(
            (detail && (detail.message || String(detail))) ||
            ("HTTP " + (response && response.status))
          );
        }
        const result = {
          provider: provider,
          role: role,
          model: providerModel(provider),
          content: content,
          latencyMs: latencyMs,
          ok: true
        };
        pushEvent("agent_complete", role + " completed analysis with " + provider, {
          jobId: jobId,
          provider: provider,
          role: role,
          latencyMs: latencyMs
        });
        return result;
      } catch (error) {
        const result = {
          provider: provider,
          role: role,
          ok: false,
          error: String(error)
        };
        pushEvent("agent_error", role + " failed on " + provider + ": " + String(error), {
          jobId: jobId,
          provider: provider,
          role: role
        });
        return result;
      }
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
    jobs.set(jobId, completed);
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
      jobs.set(jobId, {
        status: "pending",
        command: command,
        createdAt: Date.now()
      });
      runCommand(jobId, body).catch(function (error) {
        jobs.set(jobId, {
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
        transactions: paperState.transactions.slice(-200)
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