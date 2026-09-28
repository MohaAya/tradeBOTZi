import fs from "node:fs";
import path from "node:path";

const STATE_FILE = process.env.BEGINNER_PAPER_STATE_FILE || "/opt/tradebotzi/data/beginner-paper.json";
const TICK_MS = 15000;
const AUTO_SCAN_MS = 60000;
const FEE_RATE = 0.001;
const UNIVERSE = ["BTC","ETH","SOL","BNB","XRP","ADA","DOGE","AVAX","LINK","DOT"];

const DEMO_LEVERAGE_OPTIONS = [1, 2, 3, 5, 10];
const MAX_DEMO_LEVERAGE = 10;

const PRESETS = {
  conservative: { label: "Conservative", marginFraction: 0.10, stopPct: 2, takePct: 4, maxPositions: 2, minSignalPct: 2.0 },
  balanced: { label: "Balanced", marginFraction: 0.10, stopPct: 2.5, takePct: 5, maxPositions: 3, minSignalPct: 1.5 },
  aggressive: { label: "Aggressive", marginFraction: 0.08, stopPct: 3, takePct: 6, maxPositions: 4, minSignalPct: 1.0 }
};

function now() { return Date.now(); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function id(prefix) { return prefix + "-" + now() + "-" + Math.random().toString(36).slice(2, 8); }

function freshState() {
  return {
    account: null,
    positions: [],
    closedTrades: [],
    orders: [],
    decisions: [],
    autopilot: {
      enabled: false,
      riskLevel: "balanced",
      leverage: 2,
      lastScanAt: null,
      lastActionAt: null,
      nextScanAt: null,
      scans: 0
    },
    live: {
      executionEnabled: false,
      userPermissionRecorded: false,
      permissionRecordedAt: null,
      brokerConnected: false,
      broker: null
    },
    updatedAt: now()
  };
}

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return Object.assign(freshState(), parsed || {});
  } catch {
    return freshState();
  }
}

export function createBeginnerPaper({ serverMarketSnapshot, getBotState }) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  let state = loadState();
  let busy = false;

  function save() {
    state.updatedAt = now();
    const tmp = STATE_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, STATE_FILE);
  }

  function preset() {
    return PRESETS[state.autopilot.riskLevel] || PRESETS.balanced;
  }

  function marketMap(snapshot) {
    const map = new Map();
    for (const row of (snapshot && snapshot.observations) || []) {
      if (!row || !row.canonicalSymbol) continue;
      const price = finite(row.price, NaN);
      if (!Number.isFinite(price) || price <= 0) continue;
      const existing = map.get(row.canonicalSymbol);
      if (!existing || row.provider === "binance") map.set(row.canonicalSymbol, row);
    }
    return map;
  }

  function markAccount() {
    if (!state.account) return;
    const openValue = state.positions.reduce((sum, p) => sum + finite(p.margin) + finite(p.unrealizedPnl), 0);
    state.account.unrealizedPnl = state.positions.reduce((sum, p) => sum + finite(p.unrealizedPnl), 0);
    state.account.equity = Math.max(0, finite(state.account.cash) + openValue);
    state.account.peakEquity = Math.max(finite(state.account.peakEquity), state.account.equity);
    state.account.drawdown = state.account.peakEquity > 0
      ? (state.account.equity - state.account.peakEquity) / state.account.peakEquity
      : 0;
    state.account.updatedAt = now();
  }
  function training() {
    const trades = state.closedTrades || [];
    const wins = trades.filter(t => finite(t.netPnl) > 0).length;
    const losses = trades.filter(t => finite(t.netPnl) < 0).length;
    const net = trades.reduce((sum, t) => sum + finite(t.netPnl), 0);
    const avg = trades.length ? net / trades.length : 0;
    const winRate = trades.length ? wins / trades.length : 0;
    const sampleScore = clamp(trades.length / 30, 0, 1) * 40;
    const winScore = clamp((winRate - 0.35) / 0.25, 0, 1) * 20;
    const expectancyScore = avg > 0 ? 20 : trades.length ? 0 : 5;
    const drawdown = Math.abs(Math.min(0, finite(state.account && state.account.drawdown)));
    const drawdownScore = clamp((0.25 - drawdown) / 0.25, 0, 1) * 20;
    return {
      sampleSize: trades.length,
      targetSampleSize: 30,
      wins,
      losses,
      winRate,
      netPnl: net,
      expectancyPerTrade: avg,
      currentDrawdown: finite(state.account && state.account.drawdown),
      readinessScore: Math.round(sampleScore + winScore + expectancyScore + drawdownScore),
      note: "This is a PAPER track-record score, not proof that a strategy will work in live markets."
    };
  }

  function publicState() {
    return {
      paperOnly: true,
      account: state.account,
      positions: state.positions,
      closedTrades: (state.closedTrades || []).slice(-100).reverse(),
      orders: (state.orders || []).slice(-100).reverse(),
      decisions: (state.decisions || []).slice(-100).reverse(),
      autopilot: Object.assign({}, state.autopilot, { preset: preset() }),
      training: training(),
      live: Object.assign({}, state.live, {
        executionEnabled: false,
        blockers: [
          "No live broker/exchange trading adapter is connected.",
          "PAPER performance never auto-enables real-money execution.",
          "Live activation requires an explicit separate authorization after credentials and account permissions are configured."
        ]
      }),
      riskPresets: PRESETS,
      leverageOptions: DEMO_LEVERAGE_OPTIONS,
      maxDemoLeverage: MAX_DEMO_LEVERAGE,
      universe: UNIVERSE,
      updatedAt: state.updatedAt
    };
  }

  function reset(capital = 1000, riskLevel = "balanced", leverage = 2) {
    const cleanCapital = clamp(finite(capital, 1000), 10, 1000000);
    const level = PRESETS[riskLevel] ? riskLevel : "balanced";
    state = freshState();
    state.account = {
      id: id("demo"),
      mode: "PAPER",
      initialCapital: cleanCapital,
      cash: cleanCapital,
      equity: cleanCapital,
      peakEquity: cleanCapital,
      realizedPnl: 0,
      unrealizedPnl: 0,
      totalFees: 0,
      drawdown: 0,
      status: "active",
      startedAt: now(),
      updatedAt: now()
    };
    state.autopilot.riskLevel = level;
    state.autopilot.leverage = clamp(Math.round(finite(leverage, 2)), 1, MAX_DEMO_LEVERAGE);
    save();
    return publicState();
  }

  function proposalsFromSnapshot(snapshot) {
    const p = preset();
    const markets = marketMap(snapshot);
    return UNIVERSE.map(symbol => {
      const market = markets.get(symbol);
      if (!market) return null;
      const change = finite(market.change24h, 0);
      let direction = "HOLD";
      if (change >= p.minSignalPct) direction = "LONG";
      else if (change <= -p.minSignalPct) direction = "SHORT";
      const strength = Math.min(100, Math.round(Math.abs(change) / Math.max(p.minSignalPct, 0.1) * 50));
      return {
        symbol,
        direction,
        leverage: direction === "HOLD" ? 1 : clamp(Math.round(finite(state.autopilot.leverage, 2)), 1, MAX_DEMO_LEVERAGE),
        price: finite(market.price),
        change24h: change,
        signalStrength: strength,
        reason: direction === "LONG"
          ? "24h momentum is above the demo long threshold."
          : direction === "SHORT"
            ? "24h momentum is below the demo short threshold."
            : "Momentum is inside the no-trade zone."
      };
    }).filter(Boolean).sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h));
  }
  async function proposals() {
    const snapshot = await serverMarketSnapshot();
    return proposalsFromSnapshot(snapshot);
  }

  async function openTrade(input = {}) {
    if (!state.account) reset(input.capital || 1000, input.riskLevel || "balanced");
    const p = preset();
    const symbol = String(input.symbol || "").toUpperCase();
    const direction = String(input.direction || "").toUpperCase();
    if (!UNIVERSE.includes(symbol)) throw new Error("unsupported_demo_symbol");
    if (!["LONG","SHORT"].includes(direction)) throw new Error("direction_must_be_LONG_or_SHORT");
    if (state.positions.some(pos => pos.symbol === symbol)) throw new Error("demo_position_already_open_for_symbol");
    if (state.positions.length >= p.maxPositions) throw new Error("demo_max_positions_reached");

    const snapshot = await serverMarketSnapshot();
    const market = marketMap(snapshot).get(symbol);
    if (!market) throw new Error("demo_market_price_unavailable");
    const marketPrice = finite(market.price);
    const leverage = clamp(Math.round(finite(input.leverage, state.autopilot.leverage || 2)), 1, MAX_DEMO_LEVERAGE);
    const defaultMargin = finite(state.account.equity) * p.marginFraction;
    const maxMargin = Math.max(1, finite(state.account.cash) * 0.5);
    const margin = clamp(finite(input.margin, defaultMargin), 1, maxMargin);
    const notional = margin * leverage;
    const observedSpreadRate = market.spread && marketPrice ? Math.max(0, finite(market.spread) / marketPrice) : 0.0005;
    const friction = observedSpreadRate / 2 + 0.0002;
    const entryPrice = direction === "LONG" ? marketPrice * (1 + friction) : marketPrice * (1 - friction);
    const quantity = notional / entryPrice;
    const openFee = notional * FEE_RATE;
    if (margin + openFee > finite(state.account.cash)) throw new Error("insufficient_demo_cash");

    const stopPct = finite(input.stopPct, p.stopPct);
    const takePct = finite(input.takePct, p.takePct);
    const stopLossPrice = direction === "LONG" ? entryPrice * (1 - stopPct / 100) : entryPrice * (1 + stopPct / 100);
    const takeProfitPrice = direction === "LONG" ? entryPrice * (1 + takePct / 100) : entryPrice * (1 - takePct / 100);
    const liquidationMove = 0.90 / leverage;
    const liquidationPriceEstimate = direction === "LONG"
      ? Math.max(0, entryPrice * (1 - liquidationMove))
      : entryPrice * (1 + liquidationMove);

    const position = {
      id: id("dpos"),
      symbol,
      provider: market.provider,
      direction,
      leverage,
      margin,
      notional,
      quantity,
      entryPrice,
      currentPrice: marketPrice,
      unrealizedPnl: direction === "LONG" ? quantity * (marketPrice - entryPrice) : quantity * (entryPrice - marketPrice),
      stopLossPrice,
      takeProfitPrice,
      liquidationPriceEstimate,
      openFee,
      source: input.source || "manual_demo",
      reason: input.reason || null,
      openedAt: now(),
      lastMarkedAt: now(),
      status: "OPEN"
    };

    state.account.cash -= margin + openFee;
    state.account.totalFees += openFee;
    state.positions.push(position);
    state.orders.push({
      id: id("dord"), type: "OPEN", symbol, direction, leverage, margin, notional,
      fillPrice: entryPrice, quantity, fees: openFee, simulated: true, timestamp: now(), source: position.source
    });
    state.decisions.push({
      id: id("ddec"), timestamp: now(), action: "OPEN", symbol, direction, leverage,
      reason: position.reason || "User/demo autopilot opened a PAPER trade.", simulated: true
    });
    markAccount();
    save();
    return position;
  }
  async function closeTrade(positionId, reason = "manual_close", marketOverride = null) {
    const index = state.positions.findIndex(pos => pos.id === positionId);
    if (index < 0) throw new Error("demo_position_not_found");
    const position = state.positions[index];
    let market = marketOverride;
    if (!market) {
      const snapshot = await serverMarketSnapshot();
      market = marketMap(snapshot).get(position.symbol);
    }
    if (!market) throw new Error("demo_market_price_unavailable");
    const marketPrice = finite(market.price);
    const friction = 0.00045;
    const exitPrice = position.direction === "LONG" ? marketPrice * (1 - friction) : marketPrice * (1 + friction);
    const grossPnl = position.direction === "LONG"
      ? position.quantity * (exitPrice - position.entryPrice)
      : position.quantity * (position.entryPrice - exitPrice);
    const exitNotional = position.quantity * exitPrice;
    const exitFee = exitNotional * FEE_RATE;
    const netPnl = grossPnl - finite(position.openFee) - exitFee;

    state.account.cash = Math.max(0, finite(state.account.cash) + finite(position.margin) + grossPnl - exitFee);
    state.account.realizedPnl += netPnl;
    state.account.totalFees += exitFee;

    const closed = Object.assign({}, position, {
      status: "CLOSED",
      closedAt: now(),
      exitPrice,
      exitFee,
      grossPnl,
      netPnl,
      closeReason: reason
    });
    state.closedTrades.push(closed);
    state.positions.splice(index, 1);
    state.orders.push({
      id: id("dord"), type: "CLOSE", symbol: position.symbol, direction: position.direction,
      leverage: position.leverage, fillPrice: exitPrice, quantity: position.quantity,
      fees: exitFee, realizedPnl: netPnl, simulated: true, timestamp: now(), reason
    });
    state.decisions.push({
      id: id("ddec"), timestamp: now(), action: "CLOSE", symbol: position.symbol,
      direction: position.direction, leverage: position.leverage, reason, netPnl, simulated: true
    });
    markAccount();
    save();
    return closed;
  }

  async function markAndManage(snapshot) {
    if (!state.account || state.account.status !== "active") return [];
    const markets = marketMap(snapshot);
    const exits = [];
    for (const position of [...state.positions]) {
      const market = markets.get(position.symbol);
      if (!market) continue;
      const price = finite(market.price);
      position.currentPrice = price;
      position.unrealizedPnl = position.direction === "LONG"
        ? position.quantity * (price - position.entryPrice)
        : position.quantity * (position.entryPrice - price);
      position.lastMarkedAt = now();

      let reason = null;
      if (position.direction === "LONG") {
        if (price <= position.liquidationPriceEstimate) reason = "estimated_liquidation";
        else if (price <= position.stopLossPrice) reason = "stop_loss";
        else if (price >= position.takeProfitPrice) reason = "take_profit";
      } else {
        if (price >= position.liquidationPriceEstimate) reason = "estimated_liquidation";
        else if (price >= position.stopLossPrice) reason = "stop_loss";
        else if (price <= position.takeProfitPrice) reason = "take_profit";
      }
      if (reason) exits.push(await closeTrade(position.id, reason, market));
    }
    markAccount();
    save();
    return exits;
  }
  async function scanAutopilot(snapshot) {
    if (!state.autopilot.enabled || !state.account) return [];
    const p = preset();
    const candidates = proposalsFromSnapshot(snapshot)
      .filter(item => item.direction !== "HOLD")
      .filter(item => !state.positions.some(pos => pos.symbol === item.symbol));
    const actions = [];
    for (const candidate of candidates) {
      if (state.positions.length >= p.maxPositions) break;
      try {
        const position = await openTrade({
          symbol: candidate.symbol,
          direction: candidate.direction,
          leverage: candidate.leverage,
          source: "demo_autopilot",
          reason: candidate.reason
        });
        actions.push(position);
      } catch {}
    }
    state.autopilot.scans += 1;
    state.autopilot.lastScanAt = now();
    state.autopilot.lastActionAt = actions.length ? now() : state.autopilot.lastActionAt;
    state.autopilot.nextScanAt = now() + AUTO_SCAN_MS;
    save();
    return actions;
  }

  async function tick(forceScan = false) {
    if (busy) return { skipped: true };
    busy = true;
    try {
      const snapshot = await serverMarketSnapshot();
      const exits = await markAndManage(snapshot);
      const due = forceScan || (state.autopilot.enabled && (!state.autopilot.lastScanAt || now() - state.autopilot.lastScanAt >= AUTO_SCAN_MS));
      const opens = due ? await scanAutopilot(snapshot) : [];
      return { exits, opens, state: publicState() };
    } finally {
      busy = false;
    }
  }

  function startAutopilot({ capital = 1000, riskLevel = "balanced", leverage = 2, resetAccount = false } = {}) {
    if (!state.account || resetAccount) reset(capital, riskLevel, leverage);
    state.autopilot.enabled = true;
    state.autopilot.riskLevel = PRESETS[riskLevel] ? riskLevel : state.autopilot.riskLevel;
    state.autopilot.leverage = clamp(Math.round(finite(leverage, state.autopilot.leverage || 2)), 1, MAX_DEMO_LEVERAGE);
    state.autopilot.nextScanAt = now();
    save();
    tick(true).catch(() => {});
    return publicState();
  }

  function stopAutopilot() {
    state.autopilot.enabled = false;
    state.autopilot.nextScanAt = null;
    save();
    return publicState();
  }

  function recordLivePermission(phrase) {
    if (String(phrase || "").trim() !== "I UNDERSTAND LIVE TRADING USES REAL MONEY") {
      throw new Error("live_permission_phrase_mismatch");
    }
    state.live.userPermissionRecorded = true;
    state.live.permissionRecordedAt = now();
    state.live.executionEnabled = false;
    save();
    return publicState().live;
  }

  async function naturalCommand(command) {
    const text = String(command || "").trim();
    const lower = text.toLowerCase();
    const demoIntent = /\b(demo|paper|autopilot|beginner)\b/.test(lower);
    if (!demoIntent) return null;

    const capitalMatch = text.match(/\$?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:usd|dollars?)?/i);
    const capital = capitalMatch ? Number(capitalMatch[1].replace(/,/g, "")) : (state.account && state.account.initialCapital) || 1000;
    const riskLevel = /conservative/i.test(text) ? "conservative"
      : /aggressive/i.test(text) ? "aggressive"
      : /balanced|moderate/i.test(text) ? "balanced"
      : state.autopilot.riskLevel || "balanced";

    if (/\b(pause|stop)\b[\s\S]{0,30}\b(autopilot|demo)\b/i.test(text)) {
      return { action: "stop_autopilot", state: stopAutopilot() };
    }
    if (/\b(scan|run)\b[\s\S]{0,30}\b(demo|autopilot)\b/i.test(text)) {
      return { action: "scan_now", result: await tick(true), state: publicState() };
    }

    const tradeMatch = text.match(/\b(long|short)\b[\s\S]{0,20}\b(BTC|ETH|SOL|BNB|XRP|ADA|DOGE|AVAX|LINK|DOT)\b/i);
    if (tradeMatch) {
      const leverageMatch = text.match(/\b([1-9][0-9]?)\s*[x×]\b/i);
      const position = await openTrade({
        symbol: tradeMatch[2],
        direction: tradeMatch[1].toUpperCase(),
        leverage: leverageMatch ? Number(leverageMatch[1]) : undefined,
        source: "agent_desk_demo",
        reason: "Requested from Agent Desk in PAPER/demo mode."
      });
      return { action: "open_trade", position, state: publicState() };
    }

    if (/\b(invest|start|trade)\b/i.test(text)) {
      const next = startAutopilot({ capital, riskLevel, resetAccount: !state.account });
      return { action: "start_autopilot", state: next };
    }

    return { action: "inspect_demo", state: publicState(), proposals: await proposals() };
  }

  const timer = setInterval(() => tick(false).catch(() => {}), TICK_MS);
  if (timer.unref) timer.unref();

  return {
    state: publicState,
    reset,
    proposals,
    openTrade,
    closeTrade,
    startAutopilot,
    stopAutopilot,
    tick,
    recordLivePermission,
    naturalCommand
  };
}
