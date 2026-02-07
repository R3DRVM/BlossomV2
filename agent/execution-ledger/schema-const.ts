/**
 * SQLite Schema - exported as constant for serverless compatibility
 * This avoids filesystem reads which don't work in bundled serverless environments
 */

export const SCHEMA_SQL = `
-- Bloom Execution Ledger Schema
-- Private dev-only SQLite database for tracking REAL, verifiable executions
-- across Ethereum Sepolia + Solana Devnet

-- ============================================
-- executions table
-- Core table tracking every execution attempt
-- ============================================
CREATE TABLE IF NOT EXISTS executions (
    id TEXT PRIMARY KEY,
    chain TEXT NOT NULL,                    -- 'ethereum' | 'solana'
    network TEXT NOT NULL,                  -- 'sepolia' | 'devnet'
    kind TEXT,                              -- 'perp' | 'deposit' | 'bridge' | 'swap' | 'proof' | 'relay' | 'transfer'
    venue TEXT,                             -- 'drift' | 'hl' | 'aave' | 'kamino' | 'lifi' | 'wormhole' | 'uniswap' | 'jupiter' | etc.
    intent TEXT NOT NULL,                   -- Original natural language intent
    action TEXT NOT NULL,                   -- Parsed action: wrap, supply, swap, transfer, airdrop, etc.
    from_address TEXT NOT NULL,             -- Wallet address that initiated
    to_address TEXT,                        -- Destination address (if applicable)
    token TEXT,                             -- Token symbol: SOL, ETH, WETH, REDACTED, etc.
    amount_units TEXT,                      -- Amount in base units (lamports, wei)
    amount_display TEXT,                    -- Human-readable amount (e.g., "0.01 SOL")
    usd_estimate REAL,                      -- Estimated USD value
    usd_estimate_is_estimate INTEGER DEFAULT 1, -- 1 if USD value is estimated, 0 if from oracle
    tx_hash TEXT,                           -- On-chain transaction signature/hash
    status TEXT NOT NULL DEFAULT 'pending', -- pending | submitted | confirmed | finalized | failed
    error_code TEXT,                        -- Error code if failed
    error_message TEXT,                     -- Error message if failed
    explorer_url TEXT,                      -- Link to block explorer
    gas_used TEXT,                          -- Gas/compute units consumed
    block_number INTEGER,                   -- Block/slot number
    latency_ms INTEGER,                     -- End-to-end latency
    relayer_address TEXT,                   -- Relayer that submitted tx (for session mode)
    session_id TEXT,                        -- Session ID (for session mode)
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_exec_chain ON executions(chain);
CREATE INDEX IF NOT EXISTS idx_exec_network ON executions(network);
CREATE INDEX IF NOT EXISTS idx_exec_from ON executions(from_address);
CREATE INDEX IF NOT EXISTS idx_exec_tx ON executions(tx_hash);
CREATE INDEX IF NOT EXISTS idx_exec_status ON executions(status);
CREATE INDEX IF NOT EXISTS idx_exec_created ON executions(created_at);

-- ============================================
-- routes table
-- Tracks multi-step execution routes (plans)
-- ============================================
CREATE TABLE IF NOT EXISTS routes (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL,             -- References executions.id
    step_index INTEGER NOT NULL,            -- Step order (0, 1, 2, ...)
    action_type INTEGER NOT NULL,           -- Adapter action type (0=WRAP, 1=PULL, 2=SWAP, 3=LEND_SUPPLY, etc.)
    adapter_address TEXT,                   -- Contract adapter address
    target_address TEXT,                    -- Target contract (Aave, Uniswap, etc.)
    encoded_data TEXT,                      -- ABI-encoded action data
    status TEXT NOT NULL DEFAULT 'pending', -- pending | executed | failed
    tx_hash TEXT,                           -- Individual step tx hash (if separate)
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (execution_id) REFERENCES executions(id)
);

CREATE INDEX IF NOT EXISTS idx_routes_exec ON routes(execution_id);
CREATE INDEX IF NOT EXISTS idx_routes_step ON routes(execution_id, step_index);

-- ============================================
-- sessions table
-- Tracks session authority grants (EIP-712)
-- ============================================
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    chain TEXT NOT NULL,                    -- 'ethereum' | 'solana'
    network TEXT NOT NULL,                  -- 'sepolia' | 'devnet'
    user_address TEXT NOT NULL,             -- User's wallet address
    session_id TEXT NOT NULL,               -- On-chain session ID
    relayer_address TEXT,                   -- Authorized relayer address
    status TEXT NOT NULL DEFAULT 'active',  -- preparing | active | revoked | expired
    expires_at INTEGER,                     -- Unix timestamp expiration
    created_tx TEXT,                        -- TX that created the session
    revoked_tx TEXT,                        -- TX that revoked (if any)
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE(chain, network, user_address, session_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_address);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

-- ============================================
-- assets table
-- Tracks token balances and movements
-- ============================================
CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    chain TEXT NOT NULL,                    -- 'ethereum' | 'solana'
    network TEXT NOT NULL,                  -- 'sepolia' | 'devnet'
    wallet_address TEXT NOT NULL,           -- Wallet address
    token_address TEXT,                     -- Token contract/mint address (null for native)
    token_symbol TEXT NOT NULL,             -- Token symbol: SOL, ETH, WETH, etc.
    balance_units TEXT,                     -- Current balance in base units
    balance_display TEXT,                   -- Human-readable balance
    last_tx_hash TEXT,                      -- Last transaction that affected balance
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE(chain, network, wallet_address, token_address)
);

CREATE INDEX IF NOT EXISTS idx_assets_wallet ON assets(wallet_address);
CREATE INDEX IF NOT EXISTS idx_assets_token ON assets(token_symbol);

-- ============================================
-- wallets table
-- Dev wallet registry (pubkeys only, no secrets)
-- ============================================
CREATE TABLE IF NOT EXISTS wallets (
    id TEXT PRIMARY KEY,
    chain TEXT NOT NULL,                    -- 'ethereum' | 'solana'
    network TEXT NOT NULL,                  -- 'sepolia' | 'devnet'
    address TEXT NOT NULL,                  -- Public key / address
    label TEXT,                             -- Human-readable label (e.g., "dev-wallet-1")
    is_primary INTEGER DEFAULT 0,           -- 1 if primary dev wallet for this chain
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE(chain, network, address)
);

CREATE INDEX IF NOT EXISTS idx_wallets_chain ON wallets(chain, network);

-- ============================================
-- execution_steps table (optional)
-- Tracks individual steps within a multi-step execution
-- e.g., approve -> supply, wrap -> swap
-- ============================================
CREATE TABLE IF NOT EXISTS execution_steps (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL,             -- References executions.id
    step_index INTEGER NOT NULL,            -- Step order (0, 1, 2, ...)
    action TEXT NOT NULL,                   -- Step action: approve, wrap, supply, swap, etc.
    tx_hash TEXT,                           -- Step's transaction hash
    explorer_url TEXT,                      -- Link to block explorer for this step
    status TEXT NOT NULL DEFAULT 'pending', -- pending | submitted | confirmed | failed
    error_message TEXT,                     -- Error message if this step failed
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (execution_id) REFERENCES executions(id)
);

CREATE INDEX IF NOT EXISTS idx_exec_steps_exec ON execution_steps(execution_id);
CREATE INDEX IF NOT EXISTS idx_exec_steps_status ON execution_steps(status);

-- ============================================
-- Additional indexes for new columns
-- ============================================
CREATE INDEX IF NOT EXISTS idx_exec_kind ON executions(kind);
CREATE INDEX IF NOT EXISTS idx_exec_venue ON executions(venue);

-- ============================================
-- intents table
-- Tracks user-style execution intents through their full lifecycle
-- ============================================
CREATE TABLE IF NOT EXISTS intents (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    intent_text TEXT NOT NULL,                    -- Original user prompt: "long btc 20x"
    intent_kind TEXT,                             -- perp | deposit | swap | bridge | unknown
    requested_chain TEXT,                         -- ethereum | solana | both | null
    requested_venue TEXT,                         -- aave | kamino | hl | drift | lifi | wormhole | demo_* | null
    usd_estimate REAL,                            -- Estimated USD value
    status TEXT NOT NULL DEFAULT 'queued',        -- queued | planned | routed | executing | confirmed | failed
    planned_at INTEGER,                           -- When plan was generated
    executed_at INTEGER,                          -- When execution started
    confirmed_at INTEGER,                         -- When confirmed on-chain
    failure_stage TEXT,                           -- plan | route | execute | confirm | quote
    error_code TEXT,                              -- VENUE_NOT_IMPLEMENTED, NO_LIQUIDITY, RPC_ERROR, etc.
    error_message TEXT,                           -- Truncated error message
    metadata_json TEXT                            -- JSON: parsed intent, route decision, quote data, etc.
);

CREATE INDEX IF NOT EXISTS idx_intents_status ON intents(status);
CREATE INDEX IF NOT EXISTS idx_intents_kind ON intents(intent_kind);
CREATE INDEX IF NOT EXISTS idx_intents_created ON intents(created_at);

-- ============================================
-- positions table
-- Tracks on-chain perp positions indexed from contract events
-- ============================================
CREATE TABLE IF NOT EXISTS positions (
    id TEXT PRIMARY KEY,
    chain TEXT NOT NULL,                        -- 'ethereum' | 'solana'
    network TEXT NOT NULL,                      -- 'sepolia' | 'devnet'
    venue TEXT NOT NULL,                        -- 'demo_perp' | 'drift' | 'hl' | etc.
    market TEXT NOT NULL,                       -- 'BTC' | 'ETH' | 'SOL'
    side TEXT NOT NULL,                         -- 'long' | 'short'
    leverage INTEGER,                           -- Leverage multiplier (1-50)
    margin_units TEXT,                          -- Margin in base units (6 decimals for REDACTED)
    margin_display TEXT,                        -- Human-readable margin (e.g., "100 REDACTED")
    size_units TEXT,                            -- Position size in USD base units
    entry_price TEXT,                           -- Entry price (8 decimals)
    status TEXT NOT NULL DEFAULT 'open',        -- open | closed | liquidated
    opened_at INTEGER NOT NULL,                 -- Unix timestamp when opened
    closed_at INTEGER,                          -- Unix timestamp when closed (if applicable)
    open_tx_hash TEXT,                          -- Transaction that opened the position
    open_explorer_url TEXT,                     -- Explorer link for open tx
    close_tx_hash TEXT,                         -- Transaction that closed the position
    close_explorer_url TEXT,                    -- Explorer link for close tx
    pnl TEXT,                                   -- Realized PnL (if closed)
    user_address TEXT NOT NULL,                 -- User/relayer address
    on_chain_position_id TEXT,                  -- Position ID from contract
    intent_id TEXT,                             -- References intents.id (if from intent)
    execution_id TEXT,                          -- References executions.id
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
CREATE INDEX IF NOT EXISTS idx_positions_user ON positions(user_address);
CREATE INDEX IF NOT EXISTS idx_positions_chain ON positions(chain, network);
CREATE INDEX IF NOT EXISTS idx_positions_market ON positions(market);
CREATE INDEX IF NOT EXISTS idx_positions_venue ON positions(venue);

-- ============================================
-- indexer_state table
-- Tracks indexer progress (last indexed block per chain/contract)
-- ============================================
CREATE TABLE IF NOT EXISTS indexer_state (
    id TEXT PRIMARY KEY,                        -- Unique key: chain:network:contract_address
    chain TEXT NOT NULL,
    network TEXT NOT NULL,
    contract_address TEXT NOT NULL,
    last_indexed_block INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE(chain, network, contract_address)
);

-- ============================================
-- erc8004_feedback table
-- Tracks ERC-8004 reputation feedback attestations
-- ============================================
CREATE TABLE IF NOT EXISTS erc8004_feedback (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,                     -- ERC-8004 agent ID (string for bigint compat)
    category TEXT NOT NULL,                     -- swap_execution | perp_execution | lend_execution | bridge_execution | event_execution | general
    score INTEGER NOT NULL,                     -- Score from -100 to +100
    execution_id TEXT,                          -- References executions.id (optional)
    intent_id TEXT,                             -- References intents.id (optional)
    amount_usd REAL,                            -- USD amount of related transaction
    submitted_onchain INTEGER DEFAULT 0,        -- 1 if submitted to reputation registry
    onchain_tx_hash TEXT,                       -- Transaction hash of on-chain submission
    metadata_json TEXT,                         -- Additional metadata as JSON
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_erc8004_agent ON erc8004_feedback(agent_id);
CREATE INDEX IF NOT EXISTS idx_erc8004_category ON erc8004_feedback(category);
CREATE INDEX IF NOT EXISTS idx_erc8004_created ON erc8004_feedback(created_at);
CREATE INDEX IF NOT EXISTS idx_erc8004_exec ON erc8004_feedback(execution_id);

-- ============================================
-- conversations table (Phase 3)
-- Tracks multi-turn conversation context for agentic interactions
-- ============================================
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    wallet_address TEXT,
    messages TEXT NOT NULL,                   -- JSON array of ConversationMessage[]
    current_path TEXT DEFAULT 'research',     -- IntentPath: research | planning | execution | creation | event
    active_intent TEXT,                       -- JSON: Current pending ParsedIntent
    confirmed_intents TEXT,                   -- JSON array of confirmed intent IDs
    context_window INTEGER DEFAULT 10,        -- Number of messages to retain
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_conv_session ON conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_conv_wallet ON conversations(wallet_address);
CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at);

-- ============================================
-- bridge_transactions table (Phase 4)
-- Tracks multi-step bridge execution progress
-- ============================================
CREATE TABLE IF NOT EXISTS bridge_transactions (
    id TEXT PRIMARY KEY,
    intent_id TEXT,                           -- References intents.id
    execution_id TEXT,                        -- References executions.id
    bridge_provider TEXT NOT NULL,            -- 'lifi' | 'wormhole' | 'layerzero'
    source_chain TEXT NOT NULL,
    dest_chain TEXT NOT NULL,
    asset TEXT NOT NULL,
    amount_units TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',   -- pending | source_submitted | source_confirmed | bridging | dest_confirmed | completed | failed
    source_tx_hash TEXT,
    dest_tx_hash TEXT,
    bridge_stage TEXT,                        -- Current stage in bridge process
    vaa TEXT,                                 -- Wormhole VAA (if applicable)
    error_code TEXT,
    error_message TEXT,
    estimated_completion INTEGER,             -- Unix timestamp
    actual_completion INTEGER,                -- Unix timestamp
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_bridge_intent ON bridge_transactions(intent_id);
CREATE INDEX IF NOT EXISTS idx_bridge_status ON bridge_transactions(status);
CREATE INDEX IF NOT EXISTS idx_bridge_provider ON bridge_transactions(bridge_provider);
CREATE INDEX IF NOT EXISTS idx_bridge_created ON bridge_transactions(created_at);

-- ============================================
-- sub_agents table (Phase 5)
-- Tracks ERC-8004 sub-agent delegations
-- ============================================
CREATE TABLE IF NOT EXISTS sub_agents (
    id TEXT PRIMARY KEY,
    parent_agent_id TEXT NOT NULL,            -- Parent ERC-8004 agent ID
    sub_agent_id TEXT NOT NULL,               -- Sub-agent ERC-8004 ID
    delegated_capabilities TEXT NOT NULL,     -- JSON array of CapabilityKind
    spend_limit_usd REAL,                     -- Max spend per delegation
    tasks_delegated INTEGER DEFAULT 0,
    tasks_completed INTEGER DEFAULT 0,
    tasks_failed INTEGER DEFAULT 0,
    total_spend_usd REAL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',    -- active | revoked | expired
    expires_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_subagent_parent ON sub_agents(parent_agent_id);
CREATE INDEX IF NOT EXISTS idx_subagent_status ON sub_agents(status);

-- ============================================
-- Migrations for existing databases
-- SQLite ALTER TABLE ADD COLUMN (safe for existing tables)
-- These are idempotent - they'll fail silently if column exists
-- ============================================
-- Note: SQLite doesn't support IF NOT EXISTS for columns,
-- so these may error on fresh installs. The db.ts handles this.
`;
