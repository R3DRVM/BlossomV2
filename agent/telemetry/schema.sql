-- Bloom Telemetry Schema
-- SQLite database for tracking users, sessions, and executions

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    address TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    notes TEXT  -- JSON metadata
);

CREATE INDEX IF NOT EXISTS idx_users_address ON users(address);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_address TEXT NOT NULL,
    session_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'not_created',  -- not_created/preparing/active/revoked/expired
    expires_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (user_address) REFERENCES users(address),
    UNIQUE(user_address, session_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_address);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

-- Executions table
CREATE TABLE IF NOT EXISTS executions (
    id TEXT PRIMARY KEY,
    user_address TEXT NOT NULL,
    draft_id TEXT,
    correlation_id TEXT,
    action TEXT NOT NULL,  -- lend_supply, swap, etc
    token TEXT,
    amount_units TEXT,
    mode TEXT NOT NULL DEFAULT 'real',  -- validateOnly/real
    status TEXT NOT NULL DEFAULT 'prepared',  -- prepared/submitted/confirmed/failed
    tx_hash TEXT,
    error_code TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    latency_ms INTEGER,
    fee_units TEXT,  -- Computed fee (amountUnits * feeBps / 10000) for successful executions
    fee_bps INTEGER  -- Fee bps at time of execution
);

-- Migration: Add fee columns if they don't exist (for existing databases)
-- SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so this is handled in code

CREATE INDEX IF NOT EXISTS idx_executions_user ON executions(user_address);
CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
CREATE INDEX IF NOT EXISTS idx_executions_correlation ON executions(correlation_id);
CREATE INDEX IF NOT EXISTS idx_executions_tx ON executions(tx_hash);
CREATE INDEX IF NOT EXISTS idx_executions_created ON executions(created_at);

-- Metrics rollup table (for dashboard)
CREATE TABLE IF NOT EXISTS metrics_rollup (
    ts_bucket INTEGER PRIMARY KEY,  -- Unix timestamp truncated to minute
    total_requests INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    fail_count INTEGER DEFAULT 0,
    avg_latency_ms REAL,
    p95_latency_ms REAL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_metrics_ts ON metrics_rollup(ts_bucket);

-- Request log table (for detailed tracking)
CREATE TABLE IF NOT EXISTS request_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT 'GET',
    user_address TEXT,
    correlation_id TEXT,
    status_code INTEGER,
    latency_ms INTEGER,
    error_code TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_request_log_endpoint ON request_log(endpoint);
CREATE INDEX IF NOT EXISTS idx_request_log_created ON request_log(created_at);
