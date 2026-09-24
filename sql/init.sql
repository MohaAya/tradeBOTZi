-- Zbot Database Schema
-- PostgreSQL 16+

CREATE TABLE IF NOT EXISTS providers (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'not_configured',
    configured BOOLEAN NOT NULL DEFAULT FALSE,
    last_heartbeat BIGINT,
    last_message_at BIGINT,
    message_count BIGINT DEFAULT 0,
    error_count BIGINT DEFAULT 0,
    latency_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS instruments (
    id SERIAL PRIMARY KEY,
    canonical_symbol VARCHAR(50) NOT NULL,
    provider_symbol VARCHAR(100) NOT NULL,
    provider VARCHAR(50) NOT NULL REFERENCES providers(id),
    asset_class VARCHAR(20) NOT NULL,
    market_type VARCHAR(20) NOT NULL,
    name VARCHAR(200),
    base_currency VARCHAR(20),
    quote_currency VARCHAR(20),
    UNIQUE(provider, provider_symbol)
);
CREATE INDEX idx_instruments_symbol ON instruments(canonical_symbol);
CREATE INDEX idx_instruments_provider ON instruments(provider);

CREATE TABLE IF NOT EXISTS market_snapshots (
    id BIGSERIAL PRIMARY KEY,
    provider VARCHAR(50) NOT NULL REFERENCES providers(id),
    canonical_symbol VARCHAR(50) NOT NULL,
    provider_symbol VARCHAR(100) NOT NULL,
    asset_class VARCHAR(20) NOT NULL,
    market_type VARCHAR(20) NOT NULL,
    price DOUBLE PRECISION,
    bid DOUBLE PRECISION,
    ask DOUBLE PRECISION,
    spread DOUBLE PRECISION,
    change_24h DOUBLE PRECISION,
    volume_24h DOUBLE PRECISION,
    high_24h DOUBLE PRECISION,
    low_24h DOUBLE PRECISION,
    freshness VARCHAR(20) NOT NULL DEFAULT 'LIVE',
    data_quality VARCHAR(20) DEFAULT 'unknown',
    funding_rate DOUBLE PRECISION,
    open_interest DOUBLE PRECISION,
    mark_price DOUBLE PRECISION,
    oracle_price DOUBLE PRECISION,
    source_timestamp BIGINT NOT NULL,
    received_at BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_snapshots_symbol ON market_snapshots(canonical_symbol);
CREATE INDEX idx_snapshots_timestamp ON market_snapshots(source_timestamp DESC);
CREATE INDEX idx_snapshots_provider_symbol ON market_snapshots(provider, canonical_symbol, source_timestamp DESC);

CREATE TABLE IF NOT EXISTS ohlcv (
    id BIGSERIAL PRIMARY KEY,
    provider VARCHAR(50) NOT NULL REFERENCES providers(id),
    canonical_symbol VARCHAR(50) NOT NULL,
    timestamp BIGINT NOT NULL,
    interval VARCHAR(10) NOT NULL,
    open DOUBLE PRECISION NOT NULL,
    high DOUBLE PRECISION NOT NULL,
    low DOUBLE PRECISION NOT NULL,
    close DOUBLE PRECISION NOT NULL,
    volume DOUBLE PRECISION NOT NULL,
    source_timestamp BIGINT NOT NULL,
    ingestion_timestamp BIGINT NOT NULL,
    UNIQUE(provider, canonical_symbol, timestamp, interval)
);
CREATE INDEX idx_ohlcv_symbol_interval ON ohlcv(canonical_symbol, interval, timestamp DESC);
CREATE INDEX idx_ohlcv_lookup ON ohlcv(provider, canonical_symbol, interval, timestamp);

CREATE TABLE IF NOT EXISTS agents (
    id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    strategy VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'stopped',
    market VARCHAR(50) NOT NULL,
    universe TEXT[] DEFAULT '{}',
    timeframe VARCHAR(20) DEFAULT '1h',
    risk_profile VARCHAR(20) DEFAULT 'moderate',
    capital_allocation DOUBLE PRECISION DEFAULT 10000,
    enabled BOOLEAN DEFAULT FALSE,
    model_provider VARCHAR(50),
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    last_trade_at BIGINT,
    total_trades INTEGER DEFAULT 0,
    pnl DOUBLE PRECISION DEFAULT 0,
    error TEXT
);

CREATE TABLE IF NOT EXISTS portfolios (
    id VARCHAR(50) PRIMARY KEY,
    version INTEGER NOT NULL DEFAULT 1,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    sleeve VARCHAR(50) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    generated_at BIGINT NOT NULL,
    generator_params JSONB DEFAULT '{}',
    data_snapshot_id VARCHAR(100),
    universe_label VARCHAR(100) DEFAULT 'CRYPTO-ONLY UNIVERSE',
    disqualification_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portfolio_assets (
    id SERIAL PRIMARY KEY,
    portfolio_id VARCHAR(50) NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    canonical_symbol VARCHAR(50) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    weight DOUBLE PRECISION NOT NULL,
    allocation_percent DOUBLE PRECISION NOT NULL,
    market_type VARCHAR(20) NOT NULL,
    asset_class VARCHAR(20) NOT NULL,
    UNIQUE(portfolio_id, canonical_symbol)
);

CREATE TABLE IF NOT EXISTS portfolio_metrics (
    portfolio_id VARCHAR(50) PRIMARY KEY REFERENCES portfolios(id) ON DELETE CASCADE,
    cumulative_return DOUBLE PRECISION,
    annualized_return DOUBLE PRECISION,
    daily_return DOUBLE PRECISION,
    realized_volatility DOUBLE PRECISION,
    downside_volatility DOUBLE PRECISION,
    max_drawdown DOUBLE PRECISION,
    current_drawdown DOUBLE PRECISION,
    var95 DOUBLE PRECISION,
    cvar95 DOUBLE PRECISION,
    sharpe_ratio DOUBLE PRECISION,
    sortino_ratio DOUBLE PRECISION,
    calmar_ratio DOUBLE PRECISION,
    avg_pairwise_correlation DOUBLE PRECISION,
    concentration DOUBLE PRECISION,
    diversification_score DOUBLE PRECISION,
    effective_positions DOUBLE PRECISION,
    estimated_spread_cost DOUBLE PRECISION,
    estimated_fees DOUBLE PRECISION,
    liquidity_score DOUBLE PRECISION,
    momentum_score DOUBLE PRECISION,
    volatility_regime VARCHAR(20),
    trend_regime VARCHAR(20),
    avg_funding_rate DOUBLE PRECISION,
    evaluation_window VARCHAR(50),
    observation_count INTEGER,
    evaluated_at BIGINT,
    data_sources TEXT[] DEFAULT '{}',
    data_freshness VARCHAR(20) DEFAULT 'LIVE'
);

CREATE TABLE IF NOT EXISTS ranking_runs (
    id VARCHAR(100) PRIMARY KEY,
    timestamp BIGINT NOT NULL,
    portfolio_ids TEXT[] NOT NULL,
    config JSONB NOT NULL,
    data_snapshot_id VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ranking_results (
    id SERIAL PRIMARY KEY,
    run_id VARCHAR(100) NOT NULL REFERENCES ranking_runs(id) ON DELETE CASCADE,
    portfolio_id VARCHAR(50) NOT NULL REFERENCES portfolios(id),
    rank INTEGER NOT NULL,
    score DOUBLE PRECISION NOT NULL,
    score_breakdown JSONB NOT NULL,
    label VARCHAR(50) NOT NULL,
    disqualified BOOLEAN DEFAULT FALSE,
    disqualification_reason TEXT,
    prior_rank INTEGER,
    rank_change INTEGER
);
CREATE INDEX idx_ranking_results_run ON ranking_results(run_id);

CREATE TABLE IF NOT EXISTS ai_assessments (
    id SERIAL PRIMARY KEY,
    portfolio_id VARCHAR(50) REFERENCES portfolios(id),
    agent_role VARCHAR(50),
    model VARCHAR(200),
    provider VARCHAR(50),
    prompt_version VARCHAR(50),
    response JSONB,
    latency_ms INTEGER,
    success BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS paper_accounts (
    portfolio_id VARCHAR(50) PRIMARY KEY REFERENCES portfolios(id) ON DELETE CASCADE,
    initial_capital DOUBLE PRECISION NOT NULL,
    cash DOUBLE PRECISION NOT NULL,
    realized_pnl DOUBLE PRECISION DEFAULT 0,
    unrealized_pnl DOUBLE PRECISION DEFAULT 0,
    total_fees DOUBLE PRECISION DEFAULT 0,
    total_funding DOUBLE PRECISION DEFAULT 0,
    equity DOUBLE PRECISION NOT NULL,
    peak_equity DOUBLE PRECISION NOT NULL,
    drawdown DOUBLE PRECISION DEFAULT 0,
    started_at BIGINT NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    assumptions JSONB DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS paper_positions (
    id SERIAL PRIMARY KEY,
    portfolio_id VARCHAR(50) NOT NULL REFERENCES paper_accounts(portfolio_id) ON DELETE CASCADE,
    canonical_symbol VARCHAR(50) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    quantity DOUBLE PRECISION NOT NULL,
    average_cost DOUBLE PRECISION NOT NULL,
    current_price DOUBLE PRECISION,
    market_value DOUBLE PRECISION DEFAULT 0,
    unrealized_pnl DOUBLE PRECISION DEFAULT 0,
    UNIQUE(portfolio_id, canonical_symbol)
);

CREATE TABLE IF NOT EXISTS paper_transactions (
    id VARCHAR(100) PRIMARY KEY,
    portfolio_id VARCHAR(50) NOT NULL REFERENCES paper_accounts(portfolio_id) ON DELETE CASCADE,
    timestamp BIGINT NOT NULL,
    canonical_symbol VARCHAR(50) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    side VARCHAR(10) NOT NULL,
    quantity DOUBLE PRECISION NOT NULL,
    price DOUBLE PRECISION NOT NULL,
    fees DOUBLE PRECISION NOT NULL DEFAULT 0,
    total DOUBLE PRECISION NOT NULL,
    simulated BOOLEAN DEFAULT TRUE,
    assumptions JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_paper_txns_portfolio ON paper_transactions(portfolio_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50),
    entity_id VARCHAR(100),
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_audit_log_type ON audit_log(event_type, created_at DESC);

INSERT INTO providers (id, name, type, status, configured) VALUES
    ('binance', 'Binance', 'binance', 'not_configured', TRUE),
    ('coinbase', 'Coinbase', 'coinbase', 'not_configured', TRUE),
    ('hyperliquid', 'Hyperliquid', 'hyperliquid', 'not_configured', TRUE)
ON CONFLICT (id) DO NOTHING;
