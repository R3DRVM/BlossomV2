-- Bloom Execution Ledger Schema - PostgreSQL
-- Production database schema for hosting on Neon/Supabase

CREATE TABLE IF NOT EXISTS executions (
    id TEXT PRIMARY KEY,
    chain TEXT NOT NULL,
    network TEXT NOT NULL,
    kind TEXT,
    venue TEXT,
    intent TEXT NOT NULL,
    action TEXT NOT NULL,
    from_address TEXT NOT NULL,
    to_address TEXT,
    token TEXT,
    amount_units TEXT,
    amount_display TEXT,
    usd_estimate REAL,
    usd_estimate_is_estimate INTEGER DEFAULT 1,
    tx_hash TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error_code TEXT,
    error_message TEXT,
    explorer_url TEXT,
    gas_used TEXT,
    block_number INTEGER,
    latency_ms INTEGER,
    relayer_address TEXT,
    session_id TEXT,
    intent_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exec_chain ON executions(chain);
CREATE INDEX IF NOT EXISTS idx_exec_network ON executions(network);
CREATE INDEX IF NOT EXISTS idx_exec_from ON executions(from_address);
CREATE INDEX IF NOT EXISTS idx_exec_tx ON executions(tx_hash);
CREATE INDEX IF NOT EXISTS idx_exec_status ON executions(status);
CREATE INDEX IF NOT EXISTS idx_exec_created ON executions(created_at);
CREATE INDEX IF NOT EXISTS idx_exec_kind ON executions(kind);
CREATE INDEX IF NOT EXISTS idx_exec_venue ON executions(venue);

CREATE TABLE IF NOT EXISTS execution_steps (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL,
    step_index INTEGER NOT NULL,
    action TEXT NOT NULL,
    stage TEXT,
    tx_hash TEXT,
    explorer_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error_code TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exec_steps_exec ON execution_steps(execution_id);

CREATE TABLE IF NOT EXISTS routes (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL,
    step_index INTEGER NOT NULL,
    action_type INTEGER NOT NULL,
    adapter_address TEXT,
    target_address TEXT,
    encoded_data TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    tx_hash TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_routes_exec ON routes(execution_id);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    chain TEXT NOT NULL,
    network TEXT NOT NULL,
    user_address TEXT NOT NULL,
    session_id TEXT NOT NULL,
    relayer_address TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    expires_at INTEGER,
    created_tx TEXT,
    revoked_tx TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(chain, network, user_address, session_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_address);

CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    chain TEXT NOT NULL,
    network TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    token_address TEXT,
    token_symbol TEXT NOT NULL,
    balance_units TEXT,
    balance_display TEXT,
    last_tx_hash TEXT,
    updated_at INTEGER NOT NULL,
    UNIQUE(chain, network, wallet_address, token_address)
);

CREATE INDEX IF NOT EXISTS idx_assets_wallet ON assets(wallet_address);

CREATE TABLE IF NOT EXISTS wallets (
    id TEXT PRIMARY KEY,
    chain TEXT NOT NULL,
    network TEXT NOT NULL,
    address TEXT NOT NULL,
    label TEXT,
    is_primary INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    UNIQUE(chain, network, address)
);

CREATE TABLE IF NOT EXISTS intents (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    intent_text TEXT NOT NULL,
    intent_kind TEXT,
    requested_chain TEXT,
    requested_venue TEXT,
    usd_estimate REAL,
    status TEXT NOT NULL DEFAULT 'queued',
    planned_at INTEGER,
    executed_at INTEGER,
    confirmed_at INTEGER,
    failure_stage TEXT,
    error_code TEXT,
    error_message TEXT,
    metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_intents_status ON intents(status);
CREATE INDEX IF NOT EXISTS idx_intents_created ON intents(created_at);

CREATE TABLE IF NOT EXISTS positions (
    id TEXT PRIMARY KEY,
    chain TEXT NOT NULL,
    network TEXT NOT NULL,
    venue TEXT NOT NULL,
    market TEXT NOT NULL,
    side TEXT NOT NULL,
    leverage INTEGER,
    margin_units TEXT,
    margin_display TEXT,
    size_units TEXT,
    entry_price TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    opened_at INTEGER NOT NULL,
    closed_at INTEGER,
    open_tx_hash TEXT,
    open_explorer_url TEXT,
    close_tx_hash TEXT,
    close_explorer_url TEXT,
    pnl TEXT,
    user_address TEXT NOT NULL,
    on_chain_position_id TEXT,
    intent_id TEXT,
    execution_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
CREATE INDEX IF NOT EXISTS idx_positions_user ON positions(user_address);

CREATE TABLE IF NOT EXISTS indexer_state (
    id TEXT PRIMARY KEY,
    chain TEXT NOT NULL,
    network TEXT NOT NULL,
    contract_address TEXT NOT NULL,
    last_indexed_block INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    UNIQUE(chain, network, contract_address)
);

CREATE TABLE IF NOT EXISTS access_codes (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    max_uses INTEGER DEFAULT 1,
    times_used INTEGER DEFAULT 0,
    last_used_at INTEGER,
    created_by TEXT,
    metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_access_code ON access_codes(code);

CREATE TABLE IF NOT EXISTS waitlist (
    id TEXT PRIMARY KEY,
    email TEXT,
    wallet_address TEXT,
    created_at INTEGER NOT NULL,
    source TEXT DEFAULT 'landing',
    metadata_json TEXT,
    CHECK (email IS NOT NULL OR wallet_address IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email);
CREATE INDEX IF NOT EXISTS idx_waitlist_wallet ON waitlist(wallet_address);

CREATE TABLE IF NOT EXISTS access_code_redemptions (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    redeemed_at INTEGER NOT NULL,
    wallet_address TEXT,
    device_fingerprint TEXT,
    ip_address TEXT,
    user_agent TEXT,
    metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_redemptions_code ON access_code_redemptions(code);
CREATE INDEX IF NOT EXISTS idx_redemptions_wallet ON access_code_redemptions(wallet_address);
CREATE INDEX IF NOT EXISTS idx_redemptions_device ON access_code_redemptions(device_fingerprint);
