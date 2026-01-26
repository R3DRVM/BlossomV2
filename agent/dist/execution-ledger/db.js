/**
 * Bloom Execution Ledger Database
 * Supports both SQLite (local dev) and Postgres (production)
 *
 * Mode selection:
 * - Local: Uses SQLite (default) when DATABASE_URL is not set
 * - Production: Uses Postgres when DATABASE_URL is set
 *
 * Note: The synchronous functions below work with SQLite.
 * For Postgres support in production, use the async helpers or
 * run setup-neon-db.ts to initialize the Postgres schema.
 */
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { detectDatabaseType, logDatabaseInfo } from './db-factory.js';
import { SCHEMA_SQL } from './schema-const.js';
// ESM-safe __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Database file path (in agent/execution-ledger directory)
// In serverless environments (Vercel), use /tmp which is writable
const isVercel = process.env.VERCEL === '1';
const defaultPath = isVercel ? '/tmp/ledger.db' : path.join(__dirname, 'ledger.db');
const DB_PATH = process.env.EXECUTION_LEDGER_DB_PATH || defaultPath;
let db = null;
const dbType = detectDatabaseType();
// Log database info on module load
logDatabaseInfo();
/**
 * Initialize the database connection and run migrations
 */
export function initDatabase() {
    if (db)
        return db;
    // Postgres mode check
    if (dbType === 'postgres') {
        console.warn('⚠️  Postgres mode detected (DATABASE_URL is set)');
        console.warn('   Local SQLite will be used for backward compatibility.');
        console.warn('   Production deployments should use Postgres via API endpoints.');
        console.warn('   Run: npx tsx agent/scripts/setup-neon-db.ts --apply-schema');
    }
    // Ensure directory exists
    const dbDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    // Run schema
    runMigrations(db);
    return db;
}
/**
 * Get the database instance (initializes if needed)
 */
export function getDatabase() {
    if (!db) {
        return initDatabase();
    }
    return db;
}
/**
 * Close the database connection
 */
export function closeDatabase() {
    if (db) {
        db.close();
        db = null;
    }
}
/**
 * Run schema migrations
 */
function runMigrations(database) {
    // Use inlined schema constant (works in bundled serverless environments)
    database.exec(SCHEMA_SQL);
    // Run column migrations for existing databases
    runColumnMigrations(database);
}
/**
 * Add new columns to existing tables (idempotent)
 * SQLite doesn't support IF NOT EXISTS for columns, so we catch errors
 */
function runColumnMigrations(database) {
    const migrations = [
        // executions table new columns
        'ALTER TABLE executions ADD COLUMN kind TEXT',
        'ALTER TABLE executions ADD COLUMN venue TEXT',
        'ALTER TABLE executions ADD COLUMN usd_estimate REAL',
        'ALTER TABLE executions ADD COLUMN usd_estimate_is_estimate INTEGER DEFAULT 1',
        'ALTER TABLE executions ADD COLUMN relayer_address TEXT',
        'ALTER TABLE executions ADD COLUMN session_id TEXT',
        'ALTER TABLE executions ADD COLUMN intent_id TEXT',
        // execution_steps table new columns for intent tracking
        'ALTER TABLE execution_steps ADD COLUMN stage TEXT',
        'ALTER TABLE execution_steps ADD COLUMN error_code TEXT',
    ];
    for (const migration of migrations) {
        try {
            database.exec(migration);
        }
        catch (e) {
            // Column already exists - this is expected on fresh installs
            if (!e.message.includes('duplicate column name')) {
                console.warn(`[ledger] Migration warning: ${e.message}`);
            }
        }
    }
}
// ============================================
// Execution Operations
// ============================================
export function createExecution(params) {
    const db = getDatabase();
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
    INSERT INTO executions (
      id, chain, network, kind, venue, intent, action, from_address, to_address,
      token, amount_units, amount_display, usd_estimate, usd_estimate_is_estimate,
      relayer_address, session_id, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(id, params.chain, params.network, params.kind ?? null, params.venue ?? null, params.intent, params.action, params.fromAddress.toLowerCase(), params.toAddress?.toLowerCase() ?? null, params.token ?? null, params.amountUnits ?? null, params.amountDisplay ?? null, params.usdEstimate ?? null, params.usdEstimateIsEstimate === false ? 0 : 1, // Default to estimate=true
    params.relayerAddress?.toLowerCase() ?? null, params.sessionId ?? null, now, now);
    return {
        id,
        chain: params.chain,
        network: params.network,
        kind: params.kind,
        venue: params.venue,
        intent: params.intent,
        action: params.action,
        from_address: params.fromAddress.toLowerCase(),
        to_address: params.toAddress?.toLowerCase(),
        token: params.token,
        amount_units: params.amountUnits,
        amount_display: params.amountDisplay,
        usd_estimate: params.usdEstimate,
        usd_estimate_is_estimate: params.usdEstimateIsEstimate === false ? 0 : 1,
        relayer_address: params.relayerAddress?.toLowerCase(),
        session_id: params.sessionId,
        status: 'pending',
        created_at: now,
        updated_at: now,
    };
}
export function updateExecution(id, updates) {
    const db = getDatabase();
    const now = Math.floor(Date.now() / 1000);
    const sets = ['updated_at = ?'];
    const values = [now];
    if (updates.status !== undefined) {
        sets.push('status = ?');
        values.push(updates.status);
    }
    if (updates.kind !== undefined) {
        sets.push('kind = ?');
        values.push(updates.kind);
    }
    if (updates.venue !== undefined) {
        sets.push('venue = ?');
        values.push(updates.venue);
    }
    if (updates.txHash !== undefined) {
        sets.push('tx_hash = ?');
        values.push(updates.txHash);
    }
    if (updates.explorerUrl !== undefined) {
        sets.push('explorer_url = ?');
        values.push(updates.explorerUrl);
    }
    if (updates.errorCode !== undefined) {
        sets.push('error_code = ?');
        values.push(updates.errorCode);
    }
    if (updates.errorMessage !== undefined) {
        sets.push('error_message = ?');
        values.push(updates.errorMessage);
    }
    if (updates.gasUsed !== undefined) {
        sets.push('gas_used = ?');
        values.push(updates.gasUsed);
    }
    if (updates.blockNumber !== undefined) {
        sets.push('block_number = ?');
        values.push(updates.blockNumber);
    }
    if (updates.latencyMs !== undefined) {
        sets.push('latency_ms = ?');
        values.push(updates.latencyMs);
    }
    if (updates.usdEstimate !== undefined) {
        sets.push('usd_estimate = ?');
        values.push(updates.usdEstimate);
    }
    if (updates.usdEstimateIsEstimate !== undefined) {
        sets.push('usd_estimate_is_estimate = ?');
        values.push(updates.usdEstimateIsEstimate ? 1 : 0);
    }
    if (updates.relayerAddress !== undefined) {
        sets.push('relayer_address = ?');
        values.push(updates.relayerAddress.toLowerCase());
    }
    if (updates.sessionId !== undefined) {
        sets.push('session_id = ?');
        values.push(updates.sessionId);
    }
    values.push(id);
    db.prepare(`UPDATE executions SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}
export function getExecution(id) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM executions WHERE id = ?').get(id);
}
export function getExecutionByTxHash(txHash) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM executions WHERE tx_hash = ?').get(txHash);
}
export function countExecutions(params) {
    const db = getDatabase();
    let query = 'SELECT COUNT(*) as count FROM executions WHERE 1=1';
    const values = [];
    if (params?.chain) {
        query += ' AND chain = ?';
        values.push(params.chain);
    }
    if (params?.network) {
        query += ' AND network = ?';
        values.push(params.network);
    }
    if (params?.status) {
        query += ' AND status = ?';
        values.push(params.status);
    }
    return db.prepare(query).get(...values).count;
}
export function listExecutions(params) {
    const db = getDatabase();
    const limit = params?.limit ?? 50;
    const offset = params?.offset ?? 0;
    let query = 'SELECT * FROM executions WHERE 1=1';
    const values = [];
    if (params?.chain) {
        query += ' AND chain = ?';
        values.push(params.chain);
    }
    if (params?.network) {
        query += ' AND network = ?';
        values.push(params.network);
    }
    if (params?.status) {
        query += ' AND status = ?';
        values.push(params.status);
    }
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    values.push(limit, offset);
    return db.prepare(query).all(...values);
}
export function listExecutionsWithMeta(params) {
    const limit = params?.limit ?? 50;
    const offset = params?.offset ?? 0;
    const totalInDb = countExecutions(params);
    const data = listExecutions(params);
    return {
        data,
        meta: { totalInDb, limit, offset },
    };
}
// ============================================
// Route Operations
// ============================================
export function createRoute(params) {
    const db = getDatabase();
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
    INSERT INTO routes (
      id, execution_id, step_index, action_type, adapter_address,
      target_address, encoded_data, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(id, params.executionId, params.stepIndex, params.actionType, params.adapterAddress ?? null, params.targetAddress ?? null, params.encodedData ?? null, now);
    return {
        id,
        execution_id: params.executionId,
        step_index: params.stepIndex,
        action_type: params.actionType,
        adapter_address: params.adapterAddress,
        target_address: params.targetAddress,
        encoded_data: params.encodedData,
        status: 'pending',
        created_at: now,
    };
}
export function getRoutesForExecution(executionId) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM routes WHERE execution_id = ? ORDER BY step_index').all(executionId);
}
export function updateRoute(id, updates) {
    const db = getDatabase();
    const sets = [];
    const values = [];
    if (updates.status !== undefined) {
        sets.push('status = ?');
        values.push(updates.status);
    }
    if (updates.txHash !== undefined) {
        sets.push('tx_hash = ?');
        values.push(updates.txHash);
    }
    if (sets.length === 0)
        return;
    values.push(id);
    db.prepare(`UPDATE routes SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}
// ============================================
// Session Operations
// ============================================
export function upsertSession(params) {
    const db = getDatabase();
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const existing = db.prepare('SELECT * FROM sessions WHERE chain = ? AND network = ? AND user_address = ? AND session_id = ?').get(params.chain, params.network, params.userAddress.toLowerCase(), params.sessionId);
    if (existing) {
        db.prepare(`
      UPDATE sessions SET status = ?, relayer_address = ?, expires_at = ?, updated_at = ?
      WHERE id = ?
    `).run(params.status, params.relayerAddress ?? existing.relayer_address ?? null, params.expiresAt ?? existing.expires_at ?? null, now, existing.id);
        return { ...existing, status: params.status, updated_at: now };
    }
    db.prepare(`
    INSERT INTO sessions (
      id, chain, network, user_address, session_id, relayer_address,
      status, expires_at, created_tx, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, params.chain, params.network, params.userAddress.toLowerCase(), params.sessionId, params.relayerAddress ?? null, params.status, params.expiresAt ?? null, params.createdTx ?? null, now, now);
    return {
        id,
        chain: params.chain,
        network: params.network,
        user_address: params.userAddress.toLowerCase(),
        session_id: params.sessionId,
        relayer_address: params.relayerAddress,
        status: params.status,
        expires_at: params.expiresAt,
        created_tx: params.createdTx,
        created_at: now,
        updated_at: now,
    };
}
export function countSessions(params) {
    const db = getDatabase();
    let query = 'SELECT COUNT(*) as count FROM sessions WHERE 1=1';
    const values = [];
    if (params?.chain) {
        query += ' AND chain = ?';
        values.push(params.chain);
    }
    if (params?.network) {
        query += ' AND network = ?';
        values.push(params.network);
    }
    if (params?.status) {
        query += ' AND status = ?';
        values.push(params.status);
    }
    return db.prepare(query).get(...values).count;
}
export function listSessions(params) {
    const db = getDatabase();
    const limit = params?.limit ?? 50;
    let query = 'SELECT * FROM sessions WHERE 1=1';
    const values = [];
    if (params?.chain) {
        query += ' AND chain = ?';
        values.push(params.chain);
    }
    if (params?.network) {
        query += ' AND network = ?';
        values.push(params.network);
    }
    if (params?.status) {
        query += ' AND status = ?';
        values.push(params.status);
    }
    query += ' ORDER BY created_at DESC LIMIT ?';
    values.push(limit);
    return db.prepare(query).all(...values);
}
export function listSessionsWithMeta(params) {
    const limit = params?.limit ?? 50;
    const totalInDb = countSessions(params);
    const data = listSessions(params);
    return {
        data,
        meta: { totalInDb, limit, offset: 0 },
    };
}
// ============================================
// Asset Operations
// ============================================
export function upsertAsset(params) {
    const db = getDatabase();
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const existing = db.prepare('SELECT * FROM assets WHERE chain = ? AND network = ? AND wallet_address = ? AND (token_address = ? OR (token_address IS NULL AND ? IS NULL))').get(params.chain, params.network, params.walletAddress.toLowerCase(), params.tokenAddress ?? null, params.tokenAddress ?? null);
    if (existing) {
        db.prepare(`
      UPDATE assets SET
        balance_units = ?, balance_display = ?, last_tx_hash = ?, updated_at = ?
      WHERE id = ?
    `).run(params.balanceUnits ?? existing.balance_units ?? null, params.balanceDisplay ?? existing.balance_display ?? null, params.lastTxHash ?? existing.last_tx_hash ?? null, now, existing.id);
        return {
            ...existing,
            balance_units: params.balanceUnits ?? existing.balance_units,
            balance_display: params.balanceDisplay ?? existing.balance_display,
            last_tx_hash: params.lastTxHash ?? existing.last_tx_hash,
            updated_at: now,
        };
    }
    db.prepare(`
    INSERT INTO assets (
      id, chain, network, wallet_address, token_address, token_symbol,
      balance_units, balance_display, last_tx_hash, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, params.chain, params.network, params.walletAddress.toLowerCase(), params.tokenAddress ?? null, params.tokenSymbol, params.balanceUnits ?? null, params.balanceDisplay ?? null, params.lastTxHash ?? null, now);
    return {
        id,
        chain: params.chain,
        network: params.network,
        wallet_address: params.walletAddress.toLowerCase(),
        token_address: params.tokenAddress,
        token_symbol: params.tokenSymbol,
        balance_units: params.balanceUnits,
        balance_display: params.balanceDisplay,
        last_tx_hash: params.lastTxHash,
        updated_at: now,
    };
}
export function countAssets(params) {
    const db = getDatabase();
    let query = 'SELECT COUNT(*) as count FROM assets WHERE 1=1';
    const values = [];
    if (params?.chain) {
        query += ' AND chain = ?';
        values.push(params.chain);
    }
    if (params?.network) {
        query += ' AND network = ?';
        values.push(params.network);
    }
    if (params?.walletAddress) {
        query += ' AND wallet_address = ?';
        values.push(params.walletAddress.toLowerCase());
    }
    return db.prepare(query).get(...values).count;
}
export function listAssets(params) {
    const db = getDatabase();
    const limit = params?.limit ?? 100;
    let query = 'SELECT * FROM assets WHERE 1=1';
    const values = [];
    if (params?.chain) {
        query += ' AND chain = ?';
        values.push(params.chain);
    }
    if (params?.network) {
        query += ' AND network = ?';
        values.push(params.network);
    }
    if (params?.walletAddress) {
        query += ' AND wallet_address = ?';
        values.push(params.walletAddress.toLowerCase());
    }
    query += ' ORDER BY updated_at DESC LIMIT ?';
    values.push(limit);
    return db.prepare(query).all(...values);
}
export function listAssetsWithMeta(params) {
    const limit = params?.limit ?? 100;
    const totalInDb = countAssets(params);
    const data = listAssets(params);
    return {
        data,
        meta: { totalInDb, limit, offset: 0 },
    };
}
// ============================================
// Wallet Operations
// ============================================
export function registerWallet(params) {
    const db = getDatabase();
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    // If setting as primary, unset other primaries for this chain/network
    if (params.isPrimary) {
        db.prepare('UPDATE wallets SET is_primary = 0 WHERE chain = ? AND network = ?').run(params.chain, params.network);
    }
    db.prepare(`
    INSERT OR REPLACE INTO wallets (
      id, chain, network, address, label, is_primary, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, params.chain, params.network, params.address.toLowerCase(), params.label ?? null, params.isPrimary ? 1 : 0, now);
    return {
        id,
        chain: params.chain,
        network: params.network,
        address: params.address.toLowerCase(),
        label: params.label,
        is_primary: params.isPrimary ? 1 : 0,
        created_at: now,
    };
}
export function getPrimaryWallet(chain, network) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM wallets WHERE chain = ? AND network = ? AND is_primary = 1').get(chain, network);
}
export function listWallets(params) {
    const db = getDatabase();
    let query = 'SELECT * FROM wallets WHERE 1=1';
    const values = [];
    if (params?.chain) {
        query += ' AND chain = ?';
        values.push(params.chain);
    }
    if (params?.network) {
        query += ' AND network = ?';
        values.push(params.network);
    }
    query += ' ORDER BY is_primary DESC, created_at DESC';
    return db.prepare(query).all(...values);
}
export function getLedgerSummary() {
    const db = getDatabase();
    const totalExec = db.prepare('SELECT COUNT(*) as count FROM executions').get().count;
    const confirmedExec = db.prepare("SELECT COUNT(*) as count FROM executions WHERE status IN ('confirmed', 'finalized')").get().count;
    const failedExec = db.prepare("SELECT COUNT(*) as count FROM executions WHERE status = 'failed'").get().count;
    const byChain = db.prepare(`
    SELECT
      chain,
      COUNT(*) as count,
      SUM(CASE WHEN status IN ('confirmed', 'finalized') THEN 1 ELSE 0 END) as confirmed
    FROM executions
    GROUP BY chain
  `).all();
    const activeSessions = db.prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'active'").get().count;
    const trackedAssets = db.prepare('SELECT COUNT(*) as count FROM assets').get().count;
    const registeredWallets = db.prepare('SELECT COUNT(*) as count FROM wallets').get().count;
    const recentExecutions = listExecutions({ limit: 10 });
    return {
        totalExecutions: totalExec,
        confirmedExecutions: confirmedExec,
        failedExecutions: failedExec,
        successRate: totalExec > 0 ? (confirmedExec / totalExec) * 100 : 0,
        byChain,
        activeSessions,
        trackedAssets,
        registeredWallets,
        recentExecutions,
    };
}
/**
 * Get all confirmed transaction hashes for proof bundle
 */
export function getProofBundle() {
    const db = getDatabase();
    const ethTxs = db.prepare(`
    SELECT tx_hash, explorer_url, action, created_at
    FROM executions
    WHERE chain = 'ethereum' AND tx_hash IS NOT NULL AND status IN ('confirmed', 'finalized')
    ORDER BY created_at DESC
  `).all();
    const solTxs = db.prepare(`
    SELECT tx_hash, explorer_url, action, created_at
    FROM executions
    WHERE chain = 'solana' AND tx_hash IS NOT NULL AND status IN ('confirmed', 'finalized')
    ORDER BY created_at DESC
  `).all();
    return {
        ethereum: ethTxs.map(tx => ({
            txHash: tx.tx_hash,
            explorerUrl: tx.explorer_url,
            action: tx.action,
            createdAt: tx.created_at,
        })),
        solana: solTxs.map(tx => ({
            txHash: tx.tx_hash,
            explorerUrl: tx.explorer_url,
            action: tx.action,
            createdAt: tx.created_at,
        })),
    };
}
export function createExecutionStep(params) {
    const db = getDatabase();
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
    INSERT INTO execution_steps (
      id, execution_id, step_index, action, stage, status, created_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(id, params.executionId, params.stepIndex, params.action, params.stage ?? null, now);
    return {
        id,
        execution_id: params.executionId,
        step_index: params.stepIndex,
        action: params.action,
        stage: params.stage,
        status: 'pending',
        created_at: now,
    };
}
export function updateExecutionStep(id, updates) {
    const db = getDatabase();
    const sets = [];
    const values = [];
    if (updates.status !== undefined) {
        sets.push('status = ?');
        values.push(updates.status);
    }
    if (updates.stage !== undefined) {
        sets.push('stage = ?');
        values.push(updates.stage);
    }
    if (updates.txHash !== undefined) {
        sets.push('tx_hash = ?');
        values.push(updates.txHash);
    }
    if (updates.explorerUrl !== undefined) {
        sets.push('explorer_url = ?');
        values.push(updates.explorerUrl);
    }
    if (updates.errorCode !== undefined) {
        sets.push('error_code = ?');
        values.push(updates.errorCode);
    }
    if (updates.errorMessage !== undefined) {
        sets.push('error_message = ?');
        values.push(updates.errorMessage);
    }
    if (sets.length === 0)
        return;
    values.push(id);
    db.prepare(`UPDATE execution_steps SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}
export function getExecutionSteps(executionId) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM execution_steps WHERE execution_id = ? ORDER BY step_index').all(executionId);
}
export function getSummaryStats() {
    const db = getDatabase();
    // Basic counts
    const totalExec = db.prepare('SELECT COUNT(*) as count FROM executions').get().count;
    const successExec = db.prepare("SELECT COUNT(*) as count FROM executions WHERE status IN ('confirmed', 'finalized')").get().count;
    const failedExec = db.prepare("SELECT COUNT(*) as count FROM executions WHERE status = 'failed'").get().count;
    // Total USD routed (sum of usd_estimate for successful executions)
    const usdResult = db.prepare(`
    SELECT COALESCE(SUM(usd_estimate), 0) as total
    FROM executions
    WHERE status IN ('confirmed', 'finalized') AND usd_estimate IS NOT NULL
  `).get();
    const totalUsdRouted = usdResult.total;
    // Relayed transactions (have relayer_address set)
    const relayedCount = db.prepare(`
    SELECT COUNT(*) as count FROM executions WHERE relayer_address IS NOT NULL
  `).get().count;
    // Unique chains active
    const chainsResult = db.prepare(`
    SELECT DISTINCT chain FROM executions
  `).all();
    const chainsActive = chainsResult.map(r => r.chain);
    // Breakdown by kind
    const byKind = db.prepare(`
    SELECT
      COALESCE(kind, 'unknown') as kind,
      COUNT(*) as count,
      COALESCE(SUM(CASE WHEN status IN ('confirmed', 'finalized') THEN usd_estimate ELSE 0 END), 0) as usdTotal
    FROM executions
    GROUP BY kind
    ORDER BY count DESC
  `).all();
    // Breakdown by venue
    const byVenue = db.prepare(`
    SELECT
      COALESCE(venue, 'unknown') as venue,
      COUNT(*) as count,
      COALESCE(SUM(CASE WHEN status IN ('confirmed', 'finalized') THEN usd_estimate ELSE 0 END), 0) as usdTotal
    FROM executions
    GROUP BY venue
    ORDER BY count DESC
  `).all();
    // Breakdown by chain/network
    const byChain = db.prepare(`
    SELECT
      chain,
      network,
      COUNT(*) as count,
      SUM(CASE WHEN status IN ('confirmed', 'finalized') THEN 1 ELSE 0 END) as successCount,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failedCount
    FROM executions
    GROUP BY chain, network
    ORDER BY count DESC
  `).all();
    // Average latency
    const latencyResult = db.prepare(`
    SELECT AVG(latency_ms) as avgLatency
    FROM executions
    WHERE latency_ms IS NOT NULL
  `).get();
    const avgLatencyMs = latencyResult.avgLatency ?? 0;
    // Last execution timestamp
    const lastExecResult = db.prepare(`
    SELECT MAX(created_at) as lastAt FROM executions
  `).get();
    // Unique wallets
    const uniqueWalletsResult = db.prepare(`
    SELECT COUNT(DISTINCT from_address) as count FROM executions WHERE from_address IS NOT NULL
  `).get();
    const uniqueWallets = uniqueWalletsResult.count;
    // Calculate raw success rate (includes all failures)
    const successRateRaw = totalExec > 0 ? (successExec / totalExec) * 100 : 0;
    // Calculate adjusted success rate (excludes RPC/infra failures)
    // Count failures that are NOT due to RPC/infra issues
    const nonInfraFailedExec = db.prepare(`
    SELECT COUNT(*) as count FROM executions
    WHERE status = 'failed'
    AND error_code NOT IN ('RPC_RATE_LIMITED', 'RPC_UNAVAILABLE', 'RPC_ERROR')
    AND error_code IS NOT NULL
  `).get().count;
    // Total executions minus RPC/infra failures
    const rpcInfraFailed = failedExec - nonInfraFailedExec;
    const adjustedTotal = totalExec - rpcInfraFailed;
    const successRateAdjusted = adjustedTotal > 0 ? (successExec / adjustedTotal) * 100 : successRateRaw;
    return {
        totalExecutions: totalExec,
        successfulExecutions: successExec,
        failedExecutions: failedExec,
        successRate: successRateRaw, // Legacy field (same as successRateRaw)
        successRateRaw,
        successRateAdjusted,
        uniqueWallets,
        totalUsdRouted,
        relayedTxCount: relayedCount,
        chainsActive,
        byKind,
        byVenue,
        byChain,
        avgLatencyMs: Math.round(avgLatencyMs),
        lastExecutionAt: lastExecResult.lastAt,
    };
}
export function getRecentExecutions(limit = 20) {
    const db = getDatabase();
    return db.prepare(`
    SELECT * FROM executions
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}
export function createIntent(params) {
    const db = getDatabase();
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
    INSERT INTO intents (
      id, created_at, intent_text, intent_kind, requested_chain, requested_venue,
      usd_estimate, status, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)
  `).run(id, now, params.intentText, params.intentKind ?? null, params.requestedChain ?? null, params.requestedVenue ?? null, params.usdEstimate ?? null, params.metadataJson ?? null);
    return {
        id,
        created_at: now,
        intent_text: params.intentText,
        intent_kind: params.intentKind,
        requested_chain: params.requestedChain,
        requested_venue: params.requestedVenue,
        usd_estimate: params.usdEstimate,
        status: 'queued',
        metadata_json: params.metadataJson,
    };
}
export function updateIntentStatus(id, updates) {
    const db = getDatabase();
    const sets = [];
    const values = [];
    if (updates.status !== undefined) {
        sets.push('status = ?');
        values.push(updates.status);
    }
    if (updates.intentKind !== undefined) {
        sets.push('intent_kind = ?');
        values.push(updates.intentKind);
    }
    if (updates.requestedChain !== undefined) {
        sets.push('requested_chain = ?');
        values.push(updates.requestedChain);
    }
    if (updates.requestedVenue !== undefined) {
        sets.push('requested_venue = ?');
        values.push(updates.requestedVenue);
    }
    if (updates.usdEstimate !== undefined) {
        sets.push('usd_estimate = ?');
        values.push(updates.usdEstimate);
    }
    if (updates.plannedAt !== undefined) {
        sets.push('planned_at = ?');
        values.push(updates.plannedAt);
    }
    if (updates.executedAt !== undefined) {
        sets.push('executed_at = ?');
        values.push(updates.executedAt);
    }
    if (updates.confirmedAt !== undefined) {
        sets.push('confirmed_at = ?');
        values.push(updates.confirmedAt);
    }
    if (updates.failureStage !== undefined) {
        sets.push('failure_stage = ?');
        values.push(updates.failureStage);
    }
    if (updates.errorCode !== undefined) {
        sets.push('error_code = ?');
        values.push(updates.errorCode);
    }
    if (updates.errorMessage !== undefined) {
        sets.push('error_message = ?');
        values.push(updates.errorMessage?.slice(0, 500)); // Truncate
    }
    if (updates.metadataJson !== undefined) {
        sets.push('metadata_json = ?');
        values.push(updates.metadataJson);
    }
    if (sets.length === 0)
        return;
    values.push(id);
    db.prepare(`UPDATE intents SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}
export function getIntent(id) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM intents WHERE id = ?').get(id);
}
export function getRecentIntents(limit = 50) {
    const db = getDatabase();
    return db.prepare(`
    SELECT * FROM intents
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}
export function getIntentStatsSummary() {
    const db = getDatabase();
    // Basic counts
    const totalIntents = db.prepare('SELECT COUNT(*) as count FROM intents').get().count;
    const confirmedIntents = db.prepare("SELECT COUNT(*) as count FROM intents WHERE status = 'confirmed'").get().count;
    const failedIntents = db.prepare("SELECT COUNT(*) as count FROM intents WHERE status = 'failed'").get().count;
    // By kind
    const byKind = db.prepare(`
    SELECT
      COALESCE(intent_kind, 'unknown') as kind,
      COUNT(*) as count,
      SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM intents
    GROUP BY intent_kind
    ORDER BY count DESC
  `).all();
    // By status
    const byStatus = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM intents
    GROUP BY status
    ORDER BY count DESC
  `).all();
    // Failures by stage
    const failuresByStage = db.prepare(`
    SELECT failure_stage as stage, COUNT(*) as count
    FROM intents
    WHERE failure_stage IS NOT NULL
    GROUP BY failure_stage
    ORDER BY count DESC
  `).all();
    // Failures by code
    const failuresByCode = db.prepare(`
    SELECT COALESCE(error_code, 'UNKNOWN') as code, COUNT(*) as count
    FROM intents
    WHERE status = 'failed'
    GROUP BY error_code
    ORDER BY count DESC
    LIMIT 10
  `).all();
    const recentIntents = getRecentIntents(10);
    // Calculate success rate (exclude queued/in-progress)
    const attemptedIntents = confirmedIntents + failedIntents;
    const intentSuccessRate = attemptedIntents > 0 ? (confirmedIntents / attemptedIntents) * 100 : 0;
    return {
        totalIntents,
        confirmedIntents,
        failedIntents,
        intentSuccessRate,
        byKind,
        byStatus,
        failuresByStage,
        failuresByCode,
        recentIntents,
    };
}
export function linkExecutionToIntent(executionId, intentId) {
    const db = getDatabase();
    // Add intent_id column if it doesn't exist (migration)
    try {
        db.exec('ALTER TABLE executions ADD COLUMN intent_id TEXT');
    }
    catch (e) {
        // Column already exists
    }
    db.prepare('UPDATE executions SET intent_id = ? WHERE id = ?').run(intentId, executionId);
}
export function getExecutionsForIntent(intentId) {
    const db = getDatabase();
    // Check if intent_id column exists
    try {
        return db.prepare(`
      SELECT * FROM executions
      WHERE intent_id = ?
      ORDER BY created_at DESC
    `).all(intentId);
    }
    catch (e) {
        return [];
    }
}
// Updated getSummaryStats to include intent metrics
export function getSummaryStatsWithIntents() {
    const baseStats = getSummaryStats();
    const intentStats = getIntentStatsSummary();
    return {
        ...baseStats,
        totalIntents: intentStats.totalIntents,
        intentSuccessRate: intentStats.intentSuccessRate,
        failedIntentsByStage: intentStats.failuresByStage,
    };
}
export function createPosition(input) {
    const db = getDatabase();
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
    INSERT INTO positions (
      id, chain, network, venue, market, side, leverage,
      margin_units, margin_display, size_units, entry_price,
      status, opened_at, open_tx_hash, open_explorer_url,
      user_address, on_chain_position_id, intent_id, execution_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.chain, input.network, input.venue, input.market, input.side, input.leverage ?? null, input.margin_units ?? null, input.margin_display ?? null, input.size_units ?? null, input.entry_price ?? null, now, input.open_tx_hash ?? null, input.open_explorer_url ?? null, input.user_address, input.on_chain_position_id ?? null, input.intent_id ?? null, input.execution_id ?? null, now, now);
    return getPosition(id);
}
export function getPosition(id) {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM positions WHERE id = ?').get(id);
    return row ?? null;
}
export function getPositionByOnChainId(chain, network, venue, onChainPositionId) {
    const db = getDatabase();
    const row = db.prepare(`
    SELECT * FROM positions
    WHERE chain = ? AND network = ? AND venue = ? AND on_chain_position_id = ?
  `).get(chain, network, venue, onChainPositionId);
    return row ?? null;
}
export function updatePosition(id, updates) {
    const db = getDatabase();
    const setClauses = [];
    const values = [];
    for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) {
            setClauses.push(`${key} = ?`);
            values.push(value);
        }
    }
    if (setClauses.length === 0)
        return;
    setClauses.push('updated_at = ?');
    values.push(Math.floor(Date.now() / 1000));
    values.push(id);
    db.prepare(`UPDATE positions SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
}
export function closePosition(id, closeTxHash, closeExplorerUrl, pnl, status = 'closed') {
    const db = getDatabase();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
    UPDATE positions SET
      status = ?,
      closed_at = ?,
      close_tx_hash = ?,
      close_explorer_url = ?,
      pnl = ?,
      updated_at = ?
    WHERE id = ?
  `).run(status, now, closeTxHash, closeExplorerUrl, pnl ?? null, now, id);
}
export function getOpenPositions(filters) {
    const db = getDatabase();
    let sql = 'SELECT * FROM positions WHERE status = ?';
    const params = ['open'];
    if (filters?.chain) {
        sql += ' AND chain = ?';
        params.push(filters.chain);
    }
    if (filters?.network) {
        sql += ' AND network = ?';
        params.push(filters.network);
    }
    if (filters?.venue) {
        sql += ' AND venue = ?';
        params.push(filters.venue);
    }
    if (filters?.user_address) {
        sql += ' AND user_address = ?';
        params.push(filters.user_address);
    }
    sql += ' ORDER BY opened_at DESC';
    return db.prepare(sql).all(...params);
}
export function getRecentPositions(limit = 20) {
    const db = getDatabase();
    return db.prepare(`
    SELECT * FROM positions
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}
export function getPositionsByStatus(status, limit = 50) {
    const db = getDatabase();
    return db.prepare(`
    SELECT * FROM positions
    WHERE status = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(status, limit);
}
export function getPositionStats() {
    const db = getDatabase();
    const total = db.prepare('SELECT COUNT(*) as count FROM positions').get().count;
    const open = db.prepare('SELECT COUNT(*) as count FROM positions WHERE status = ?').get('open').count;
    const closed = db.prepare('SELECT COUNT(*) as count FROM positions WHERE status = ?').get('closed').count;
    const liquidated = db.prepare('SELECT COUNT(*) as count FROM positions WHERE status = ?').get('liquidated').count;
    const byMarket = db.prepare(`
    SELECT market, COUNT(*) as count FROM positions
    GROUP BY market ORDER BY count DESC
  `).all();
    return { total, open, closed, liquidated, byMarket };
}
export function getIndexerState(chain, network, contractAddress) {
    const db = getDatabase();
    const row = db.prepare(`
    SELECT * FROM indexer_state
    WHERE chain = ? AND network = ? AND contract_address = ?
  `).get(chain, network, contractAddress);
    return row ?? null;
}
export function upsertIndexerState(chain, network, contractAddress, lastIndexedBlock) {
    const db = getDatabase();
    const id = `${chain}:${network}:${contractAddress}`;
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
    INSERT INTO indexer_state (id, chain, network, contract_address, last_indexed_block, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(chain, network, contract_address)
    DO UPDATE SET last_indexed_block = ?, updated_at = ?
  `).run(id, chain, network, contractAddress, lastIndexedBlock, now, lastIndexedBlock, now);
}
export function addToWaitlist(params) {
    const db = getDatabase();
    const id = `wl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Math.floor(Date.now() / 1000);
    // Create waitlist table if it doesn't exist (migration safety)
    db.exec(`
    CREATE TABLE IF NOT EXISTS waitlist (
      id TEXT PRIMARY KEY,
      email TEXT,
      wallet_address TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      source TEXT DEFAULT 'landing',
      metadata_json TEXT,
      CONSTRAINT email_or_wallet CHECK (email IS NOT NULL OR wallet_address IS NOT NULL)
    )
  `);
    db.prepare(`
    INSERT INTO waitlist (id, email, wallet_address, created_at, source, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, params.email || null, params.walletAddress || null, now, params.source || 'landing', params.metadata ? JSON.stringify(params.metadata) : null);
    return id;
}
export function getWaitlistEntries(limit = 100) {
    const db = getDatabase();
    return db.prepare(`
    SELECT * FROM waitlist ORDER BY created_at DESC LIMIT ?
  `).all(limit);
}
export function getWaitlistCount() {
    const db = getDatabase();
    const row = db.prepare('SELECT COUNT(*) as count FROM waitlist').get();
    return row?.count || 0;
}
// ============================================
// Aliases for API compatibility
// ============================================
// Alias for getSummaryStats
export const getStatsSummary = getSummaryStats;
// Alias for getIntentStatsSummary
export const getIntentStats = getIntentStatsSummary;
/**
 * ============================================================
 * ASYNC/POSTGRES SUPPORT
 * Async-capable exports that route to Postgres in production
 * ============================================================
 */
/**
 * Async-capable intent creation (uses Postgres if DATABASE_URL is set)
 */
export async function createIntentAsync(params) {
    if (dbType === 'postgres') {
        const pgDb = await import('./db-pg.js');
        return pgDb.createIntent(params);
    }
    // SQLite: use synchronous version, wrap in Promise
    return Promise.resolve(createIntent(params));
}
/**
 * Async-capable intent status update (uses Postgres if DATABASE_URL is set)
 */
export async function updateIntentStatusAsync(id, updates) {
    if (dbType === 'postgres') {
        const pgDb = await import('./db-pg.js');
        return pgDb.updateIntentStatus(id, updates);
    }
    // SQLite: use synchronous version
    updateIntentStatus(id, updates);
    return Promise.resolve();
}
/**
 * Async-capable execution creation (uses Postgres if DATABASE_URL is set)
 */
export async function createExecutionAsync(params) {
    if (dbType === 'postgres') {
        const pgDb = await import('./db-pg.js');
        return pgDb.createExecution(params);
    }
    // SQLite: use synchronous version
    return Promise.resolve(createExecution(params));
}
/**
 * Async-capable execution update (uses Postgres if DATABASE_URL is set)
 */
export async function updateExecutionAsync(id, updates) {
    if (dbType === 'postgres') {
        const pgDb = await import('./db-pg.js');
        return pgDb.updateExecution(id, updates);
    }
    // SQLite: use synchronous version
    updateExecution(id, updates);
    return Promise.resolve();
}
/**
 * Finalize execution in atomic transaction
 * Creates execution row + updates intent status in single transaction
 * Ensures both writes persist before serverless function exits
 */
export async function finalizeExecutionTransactionAsync(params) {
    if (dbType === 'postgres') {
        const pgDb = await import('./db-pg.js');
        return pgDb.finalizeExecutionTransaction(params);
    }
    // SQLite fallback: use separate calls (less reliable but functional)
    const execution = await createExecutionAsync(params.execution);
    await updateIntentStatusAsync(params.intentId, params.intentStatus);
    return { executionId: execution.id };
}
/**
 * Async-capable get intent (uses Postgres if DATABASE_URL is set)
 */
export async function getIntentAsync(id) {
    if (dbType === 'postgres') {
        const pgDb = await import('./db-pg.js');
        return pgDb.getIntent(id);
    }
    // SQLite: use synchronous version
    return Promise.resolve(getIntent(id));
}
/**
 * Async-capable get recent intents (uses Postgres if DATABASE_URL is set)
 */
export async function getRecentIntentsAsync(limit = 50) {
    if (dbType === 'postgres') {
        const pgDb = await import('./db-pg.js');
        return pgDb.getRecentIntents(limit);
    }
    // SQLite: use synchronous version
    return Promise.resolve(getRecentIntents(limit));
}
/**
 * Async-capable get summary stats (uses Postgres if DATABASE_URL is set)
 */
export async function getSummaryStatsAsync() {
    if (dbType === 'postgres') {
        const pgDb = await import('./db-pg.js');
        return pgDb.getSummaryStats();
    }
    // SQLite: use synchronous version
    return Promise.resolve(getSummaryStats());
}
/**
 * Async-capable get intent stats summary (uses Postgres if DATABASE_URL is set)
 */
export async function getIntentStatsSummaryAsync() {
    if (dbType === 'postgres') {
        const pgDb = await import('./db-pg.js');
        return pgDb.getIntentStatsSummary();
    }
    // SQLite: use synchronous version
    return Promise.resolve(getIntentStatsSummary());
}
/**
 * Async-capable get recent executions (uses Postgres if DATABASE_URL is set)
 */
export async function getRecentExecutionsAsync(limit = 20) {
    if (dbType === 'postgres') {
        const pgDb = await import('./db-pg.js');
        return pgDb.getRecentExecutions(limit);
    }
    // SQLite: use synchronous version
    return Promise.resolve(getRecentExecutions(limit));
}
/**
 * Async-capable get executions for intent (uses Postgres if DATABASE_URL is set)
 */
export async function getExecutionsForIntentAsync(intentId) {
    if (dbType === 'postgres') {
        const pgDb = await import('./db-pg.js');
        return pgDb.getExecutionsForIntent(intentId);
    }
    // SQLite: use synchronous version
    return Promise.resolve(getExecutionsForIntent(intentId));
}
/**
 * Async-capable link execution to intent (uses Postgres if DATABASE_URL is set)
 */
export async function linkExecutionToIntentAsync(executionId, intentId) {
    if (dbType === 'postgres') {
        const pgDb = await import('./db-pg.js');
        return pgDb.linkExecutionToIntent(executionId, intentId);
    }
    // SQLite: use synchronous version
    linkExecutionToIntent(executionId, intentId);
    return Promise.resolve();
}
/**
 * Async-capable create execution step (uses Postgres if DATABASE_URL is set)
 */
export async function createExecutionStepAsync(params) {
    if (dbType === 'postgres') {
        const pgDb = await import('./db-pg.js');
        return pgDb.createExecutionStep(params);
    }
    // SQLite: use synchronous version
    return Promise.resolve(createExecutionStep(params));
}
/**
 * Async-capable update execution step (uses Postgres if DATABASE_URL is set)
 */
export async function updateExecutionStepAsync(id, updates) {
    if (dbType === 'postgres') {
        const pgDb = await import('./db-pg.js');
        return pgDb.updateExecutionStep(id, updates);
    }
    // SQLite: use synchronous version
    updateExecutionStep(id, updates);
    return Promise.resolve();
}
/**
 * Async-capable get summary stats with intents (uses Postgres if DATABASE_URL is set)
 */
export async function getSummaryStatsWithIntentsAsync() {
    if (dbType === 'postgres') {
        const pgDb = await import('./db-pg.js');
        return pgDb.getSummaryStatsWithIntents();
    }
    // SQLite: use synchronous version
    return Promise.resolve(getSummaryStatsWithIntents());
}
//# sourceMappingURL=db.js.map