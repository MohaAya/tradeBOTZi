# CABBAGE evaluation and tradeBOTZi integration

Source reviewed: `sopersone/cabbage-trading-machine`.

## What CABBAGE actually is

CABBAGE is a Python wrapper around Investing Algorithm Framework 9.0.0a18. Its strongest engineering is not AI portfolio selection; it is the deterministic trading plumbing around strategy phases, risk rules, portfolio accounting, paper/live execution, snapshots, and backtesting.

Its own validation explicitly does **not** establish profitability or production readiness. The wrapper's default strategy is a long-only RSI/EMA crossover with fixed ticket sizing and stops. The repository also states that several promotional integrations are absent.

## Ideas adapted into tradeBOTZi

tradeBOTZi keeps its own TypeScript/Node/React architecture. No Python runtime or CABBAGE strategy code is embedded.

Concepts adapted independently:

- deterministic staged construction/execution pipeline
- portfolio-wide exposure budget and cash reserve
- per-symbol maximum weight
- explicit stop-loss, take-profit, trailing-stop, rebalance and cooldown policy metadata
- PAPER order lifecycle events and execution-cost assumptions
- persistent portfolio snapshots
- richer diagnostics inspired by the framework's metrics catalogue:
  - VaR 95
  - CVaR 95
  - Omega ratio
  - Ulcer Index
  - Recovery Factor
  - positive-day rate
  - best/worst day
  - concentration and effective positions
  - correlation, liquidity and trading-friction estimates
- consistent risk-policy context supplied to AI agents, while AI remains advisory

## Deliberately not imported

- CCXT live-order execution
- Python framework/runtime
- CABBAGE's RSI/EMA default strategy
- live exchange credential handling
- promotional or unverified integrations
- any profitability claims

tradeBOTZi remains PAPER-only. Deterministic portfolio construction and risk controls retain authority over AI output.

## License note

The reviewed CABBAGE/Investing Algorithm Framework source is distributed under Apache License 2.0. This integration uses architectural concepts and an independent TypeScript implementation rather than copying framework source files.
