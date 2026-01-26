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

let db: Database.Database | null = null;
const dbType = detectDatabaseType();

// Log database info on module load
logDatabaseInfo();

/**
 * Initialize the database connection and run migrations
 */
export function initDatabase(): Database.Database {
  if (db) return db;

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
export function getDatabase(): Database.Database {
  if (!db) {
    return initDatabase();
  }
  return db;
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Run schema migrations
 */
function runMigrations(database: Database.Database): void {
  // Use inlined schema constant (works in bundled serverless environments)
  database.exec(SCHEMA_SQL);

  // Run column migrations for existing databases
  runColumnMigrations(database);
}

/**
 * Add new columns to existing tables (idempotent)
 * SQLite doesn't support IF NOT EXISTS for columns, so we catch errors
 */
function runColumnMigrations(database: Database.Database): void {
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
    } catch (e: any) {
      // Column already exists - this is expected on fresh installs
      if (!e.message.includes('duplicate column name')) {
        console.warn(`[ledger] Migration warning: ${e.message}`);
      }
    }
  }
}

// ============================================
// Type Definitions
// ============================================

export type Chain = 'ethereum' | 'solana';
export type Network = 'sepolia' | 'devnet' | 'mainnet';
export type ExecutionStatus = 'pending' | 'submitted' | 'confirmed' | 'finalized' | 'failed';
export type SessionStatus = 'preparing' | 'active' | 'revoked' | 'expired';

// Kind of execution - categorizes the operation type
export type ExecutionKind = 'perp' | 'deposit' | 'bridge' | 'swap' | 'proof' | 'relay' | 'transfer';

// Venue - the protocol/DEX used
export type ExecutionVenue =
  | 'drift' | 'hl' | 'hyperliquid' | 'perp_demo'  // perp venues
  | 'aave' | 'kamino' | 'deposit_demo'             // deposit/lending venues
  | 'lifi' | 'wormhole' | 'bridge_demo'            // bridge venues
  | 'uniswap' | 'jupiter' | 'swap_demo'            // swap venues
  | 'native';                                       // native transfers

export interface Execution {
  id: string;
  chain: Chain;
  network: Network;
  kind?: ExecutionKind;                  // NEW: execution category
  venue?: ExecutionVenue;                // NEW: protocol/venue used
  intent: string;
  action: string;
  from_address: string;
  to_address?: string;
  token?: string;
  amount_units?: string;
  amount_display?: string;
  usd_estimate?: number;                 // NEW: estimated USD value
  usd_estimate_is_estimate?: number;     // NEW: 1 if estimate, 0 if from oracle
  tx_hash?: string;
  status: ExecutionStatus;
  error_code?: string;
  error_message?: string;
  explorer_url?: string;
  gas_used?: string;
  block_number?: number;
  latency_ms?: number;
  relayer_address?: string;              // NEW: relayer that submitted tx
  session_id?: string;                   // NEW: session ID if session mode
  created_at: number;
  updated_at: number;
}

export interface Route {
  id: string;
  execution_id: string;
  step_index: number;
  action_type: number;
  adapter_address?: string;
  target_address?: string;
  encoded_data?: string;
  status: string;
  tx_hash?: string;
  created_at: number;
}

export interface Session {
  id: string;
  chain: Chain;
  network: Network;
  user_address: string;
  session_id: string;
  relayer_address?: string;
  status: SessionStatus;
  expires_at?: number;
  created_tx?: string;
  revoked_tx?: string;
  created_at: number;
  updated_at: number;
}

export interface Asset {
  id: string;
  chain: Chain;
  network: Network;
  wallet_address: string;
  token_address?: string;
  token_symbol: string;
  balance_units?: string;
  balance_display?: string;
  last_tx_hash?: string;
  updated_at: number;
}

export interface Wallet {
  id: string;
  chain: Chain;
  network: Network;
  address: string;
  label?: string;
  is_primary: number;
  created_at: number;
}

// ============================================
// Execution Operations
// ============================================

export function createExecution(params: {
  chain: Chain;
  network: Network;
  kind?: ExecutionKind;
  venue?: ExecutionVenue;
  intent: string;
  action: string;
  fromAddress: string;
  toAddress?: string;
  token?: string;
  amountUnits?: string;
  amountDisplay?: string;
  usdEstimate?: number;
  usdEstimateIsEstimate?: boolean;
  relayerAddress?: string;
  sessionId?: string;
}): Execution {
  const db = getDatabase();
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO executions (
      id, chain, network, kind, venue, intent, action, from_address, to_address,
      token, amount_units, amount_display, usd_estimate, usd_estimate_is_estimate,
      relayer_address, session_id, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    id,
    params.chain,
    params.network,
    params.kind ?? null,
    params.venue ?? null,
    params.intent,
    params.action,
    params.fromAddress.toLowerCase(),
    params.toAddress?.toLowerCase() ?? null,
    params.token ?? null,
    params.amountUnits ?? null,
    params.amountDisplay ?? null,
    params.usdEstimate ?? null,
    params.usdEstimateIsEstimate === false ? 0 : 1,  // Default to estimate=true
    params.relayerAddress?.toLowerCase() ?? null,
    params.sessionId ?? null,
    now,
    now
  );

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

export function updateExecution(
  id: string,
  updates: Partial<{
    status: ExecutionStatus;
    kind: ExecutionKind;
    venue: ExecutionVenue;
    txHash: string;
    explorerUrl: string;
    errorCode: string;
    errorMessage: string;
    gasUsed: string;
    blockNumber: number;
    latencyMs: number;
    usdEstimate: number;
    usdEstimateIsEstimate: boolean;
    relayerAddress: string;
    sessionId: string;
  }>
): void {
  const db = getDatabase();
  const now = Math.floor(Date.now() / 1000);

  const sets: string[] = ['updated_at = ?'];
  const values: any[] = [now];

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

export function getExecution(id: string): Execution | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM executions WHERE id = ?').get(id) as Execution | undefined;
}

export function getExecutionByTxHash(txHash: string): Execution | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM executions WHERE tx_hash = ?').get(txHash) as Execution | undefined;
}

export interface ListResult<T> {
  data: T[];
  meta: {
    totalInDb: number;
    limit: number;
    offset: number;
  };
}

export function countExecutions(params?: {
  chain?: Chain;
  network?: Network;
  status?: ExecutionStatus;
}): number {
  const db = getDatabase();

  let query = 'SELECT COUNT(*) as count FROM executions WHERE 1=1';
  const values: any[] = [];

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

  return (db.prepare(query).get(...values) as any).count;
}

export function listExecutions(params?: {
  chain?: Chain;
  network?: Network;
  status?: ExecutionStatus;
  limit?: number;
  offset?: number;
}): Execution[] {
  const db = getDatabase();
  const limit = params?.limit ?? 50;
  const offset = params?.offset ?? 0;

  let query = 'SELECT * FROM executions WHERE 1=1';
  const values: any[] = [];

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

  return db.prepare(query).all(...values) as Execution[];
}

export function listExecutionsWithMeta(params?: {
  chain?: Chain;
  network?: Network;
  status?: ExecutionStatus;
  limit?: number;
  offset?: number;
}): ListResult<Execution> {
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

export function createRoute(params: {
  executionId: string;
  stepIndex: number;
  actionType: number;
  adapterAddress?: string;
  targetAddress?: string;
  encodedData?: string;
}): Route {
  const db = getDatabase();
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO routes (
      id, execution_id, step_index, action_type, adapter_address,
      target_address, encoded_data, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(
    id,
    params.executionId,
    params.stepIndex,
    params.actionType,
    params.adapterAddress ?? null,
    params.targetAddress ?? null,
    params.encodedData ?? null,
    now
  );

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

export function getRoutesForExecution(executionId: string): Route[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM routes WHERE execution_id = ? ORDER BY step_index'
  ).all(executionId) as Route[];
}

export function updateRoute(id: string, updates: { status?: string; txHash?: string }): void {
  const db = getDatabase();
  const sets: string[] = [];
  const values: any[] = [];

  if (updates.status !== undefined) {
    sets.push('status = ?');
    values.push(updates.status);
  }
  if (updates.txHash !== undefined) {
    sets.push('tx_hash = ?');
    values.push(updates.txHash);
  }

  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE routes SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

// ============================================
// Session Operations
// ============================================

export function upsertSession(params: {
  chain: Chain;
  network: Network;
  userAddress: string;
  sessionId: string;
  relayerAddress?: string;
  status: SessionStatus;
  expiresAt?: number;
  createdTx?: string;
}): Session {
  const db = getDatabase();
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);

  const existing = db.prepare(
    'SELECT * FROM sessions WHERE chain = ? AND network = ? AND user_address = ? AND session_id = ?'
  ).get(params.chain, params.network, params.userAddress.toLowerCase(), params.sessionId) as Session | undefined;

  if (existing) {
    db.prepare(`
      UPDATE sessions SET status = ?, relayer_address = ?, expires_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      params.status,
      params.relayerAddress ?? existing.relayer_address ?? null,
      params.expiresAt ?? existing.expires_at ?? null,
      now,
      existing.id
    );
    return { ...existing, status: params.status, updated_at: now };
  }

  db.prepare(`
    INSERT INTO sessions (
      id, chain, network, user_address, session_id, relayer_address,
      status, expires_at, created_tx, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.chain,
    params.network,
    params.userAddress.toLowerCase(),
    params.sessionId,
    params.relayerAddress ?? null,
    params.status,
    params.expiresAt ?? null,
    params.createdTx ?? null,
    now,
    now
  );

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

export function countSessions(params?: {
  chain?: Chain;
  network?: Network;
  status?: SessionStatus;
}): number {
  const db = getDatabase();

  let query = 'SELECT COUNT(*) as count FROM sessions WHERE 1=1';
  const values: any[] = [];

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

  return (db.prepare(query).get(...values) as any).count;
}

export function listSessions(params?: {
  chain?: Chain;
  network?: Network;
  status?: SessionStatus;
  limit?: number;
}): Session[] {
  const db = getDatabase();
  const limit = params?.limit ?? 50;

  let query = 'SELECT * FROM sessions WHERE 1=1';
  const values: any[] = [];

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

  return db.prepare(query).all(...values) as Session[];
}

export function listSessionsWithMeta(params?: {
  chain?: Chain;
  network?: Network;
  status?: SessionStatus;
  limit?: number;
}): ListResult<Session> {
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

export function upsertAsset(params: {
  chain: Chain;
  network: Network;
  walletAddress: string;
  tokenAddress?: string;
  tokenSymbol: string;
  balanceUnits?: string;
  balanceDisplay?: string;
  lastTxHash?: string;
}): Asset {
  const db = getDatabase();
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);

  const existing = db.prepare(
    'SELECT * FROM assets WHERE chain = ? AND network = ? AND wallet_address = ? AND (token_address = ? OR (token_address IS NULL AND ? IS NULL))'
  ).get(
    params.chain,
    params.network,
    params.walletAddress.toLowerCase(),
    params.tokenAddress ?? null,
    params.tokenAddress ?? null
  ) as Asset | undefined;

  if (existing) {
    db.prepare(`
      UPDATE assets SET
        balance_units = ?, balance_display = ?, last_tx_hash = ?, updated_at = ?
      WHERE id = ?
    `).run(
      params.balanceUnits ?? existing.balance_units ?? null,
      params.balanceDisplay ?? existing.balance_display ?? null,
      params.lastTxHash ?? existing.last_tx_hash ?? null,
      now,
      existing.id
    );
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
  `).run(
    id,
    params.chain,
    params.network,
    params.walletAddress.toLowerCase(),
    params.tokenAddress ?? null,
    params.tokenSymbol,
    params.balanceUnits ?? null,
    params.balanceDisplay ?? null,
    params.lastTxHash ?? null,
    now
  );

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

export function countAssets(params?: {
  chain?: Chain;
  network?: Network;
  walletAddress?: string;
}): number {
  const db = getDatabase();

  let query = 'SELECT COUNT(*) as count FROM assets WHERE 1=1';
  const values: any[] = [];

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

  return (db.prepare(query).get(...values) as any).count;
}

export function listAssets(params?: {
  chain?: Chain;
  network?: Network;
  walletAddress?: string;
  limit?: number;
}): Asset[] {
  const db = getDatabase();
  const limit = params?.limit ?? 100;

  let query = 'SELECT * FROM assets WHERE 1=1';
  const values: any[] = [];

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

  return db.prepare(query).all(...values) as Asset[];
}

export function listAssetsWithMeta(params?: {
  chain?: Chain;
  network?: Network;
  walletAddress?: string;
  limit?: number;
}): ListResult<Asset> {
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

export function registerWallet(params: {
  chain: Chain;
  network: Network;
  address: string;
  label?: string;
  isPrimary?: boolean;
}): Wallet {
  const db = getDatabase();
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);

  // If setting as primary, unset other primaries for this chain/network
  if (params.isPrimary) {
    db.prepare(
      'UPDATE wallets SET is_primary = 0 WHERE chain = ? AND network = ?'
    ).run(params.chain, params.network);
  }

  db.prepare(`
    INSERT OR REPLACE INTO wallets (
      id, chain, network, address, label, is_primary, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.chain,
    params.network,
    params.address.toLowerCase(),
    params.label ?? null,
    params.isPrimary ? 1 : 0,
    now
  );

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

export function getPrimaryWallet(chain: Chain, network: Network): Wallet | undefined {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM wallets WHERE chain = ? AND network = ? AND is_primary = 1'
  ).get(chain, network) as Wallet | undefined;
}

export function listWallets(params?: { chain?: Chain; network?: Network }): Wallet[] {
  const db = getDatabase();

  let query = 'SELECT * FROM wallets WHERE 1=1';
  const values: any[] = [];

  if (params?.chain) {
    query += ' AND chain = ?';
    values.push(params.chain);
  }
  if (params?.network) {
    query += ' AND network = ?';
    values.push(params.network);
  }

  query += ' ORDER BY is_primary DESC, created_at DESC';

  return db.prepare(query).all(...values) as Wallet[];
}

// ============================================
// Summary / Stats Operations
// ============================================

export interface LedgerSummary {
  totalExecutions: number;
  confirmedExecutions: number;
  failedExecutions: number;
  successRate: number;
  byChain: { chain: string; count: number; confirmed: number }[];
  activeSessions: number;
  trackedAssets: number;
  registeredWallets: number;
  recentExecutions: Execution[];
}

export function getLedgerSummary(): LedgerSummary {
  const db = getDatabase();

  const totalExec = (db.prepare('SELECT COUNT(*) as count FROM executions').get() as any).count;
  const confirmedExec = (db.prepare("SELECT COUNT(*) as count FROM executions WHERE status IN ('confirmed', 'finalized')").get() as any).count;
  const failedExec = (db.prepare("SELECT COUNT(*) as count FROM executions WHERE status = 'failed'").get() as any).count;

  const byChain = db.prepare(`
    SELECT
      chain,
      COUNT(*) as count,
      SUM(CASE WHEN status IN ('confirmed', 'finalized') THEN 1 ELSE 0 END) as confirmed
    FROM executions
    GROUP BY chain
  `).all() as { chain: string; count: number; confirmed: number }[];

  const activeSessions = (db.prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'active'").get() as any).count;
  const trackedAssets = (db.prepare('SELECT COUNT(*) as count FROM assets').get() as any).count;
  const registeredWallets = (db.prepare('SELECT COUNT(*) as count FROM wallets').get() as any).count;

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
export function getProofBundle(): {
  ethereum: { txHash: string; explorerUrl: string; action: string; createdAt: number }[];
  solana: { txHash: string; explorerUrl: string; action: string; createdAt: number }[];
} {
  const db = getDatabase();

  const ethTxs = db.prepare(`
    SELECT tx_hash, explorer_url, action, created_at
    FROM executions
    WHERE chain = 'ethereum' AND tx_hash IS NOT NULL AND status IN ('confirmed', 'finalized')
    ORDER BY created_at DESC
  `).all() as { tx_hash: string; explorer_url: string; action: string; created_at: number }[];

  const solTxs = db.prepare(`
    SELECT tx_hash, explorer_url, action, created_at
    FROM executions
    WHERE chain = 'solana' AND tx_hash IS NOT NULL AND status IN ('confirmed', 'finalized')
    ORDER BY created_at DESC
  `).all() as { tx_hash: string; explorer_url: string; action: string; created_at: number }[];

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

// ============================================
// Execution Steps Operations
// ============================================

export interface ExecutionStep {
  id: string;
  execution_id: string;
  step_index: number;
  action: string;
  stage?: string;           // plan | route | execute | confirm
  tx_hash?: string;
  explorer_url?: string;
  status: string;           // pending | ok | failed | skipped
  error_code?: string;
  error_message?: string;
  created_at: number;
}

export function createExecutionStep(params: {
  executionId: string;
  stepIndex: number;
  action: string;
  stage?: string;
}): ExecutionStep {
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

export function updateExecutionStep(
  id: string,
  updates: Partial<{
    status: string;
    stage: string;
    txHash: string;
    explorerUrl: string;
    errorCode: string;
    errorMessage: string;
  }>
): void {
  const db = getDatabase();
  const sets: string[] = [];
  const values: any[] = [];

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

  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE execution_steps SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function getExecutionSteps(executionId: string): ExecutionStep[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM execution_steps WHERE execution_id = ? ORDER BY step_index'
  ).all(executionId) as ExecutionStep[];
}

// ============================================
// Stats Dashboard Operations
// ============================================

export interface StatsSummary {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  successRate: number; // Legacy field (same as successRateRaw)
  successRateRaw: number; // Raw success rate (includes infra failures)
  successRateAdjusted: number; // Success rate excluding RPC/infra failures
  uniqueWallets: number; // Unique wallet addresses
  totalUsdRouted: number;
  relayedTxCount: number;
  chainsActive: string[];
  byKind: { kind: string; count: number; usdTotal: number }[];
  byVenue: { venue: string; count: number; usdTotal: number }[];
  byChain: { chain: string; network: string; count: number; successCount: number; failedCount: number }[];
  avgLatencyMs: number;
  lastExecutionAt: number | null;
}

export function getSummaryStats(): StatsSummary {
  const db = getDatabase();

  // Basic counts
  const totalExec = (db.prepare('SELECT COUNT(*) as count FROM executions').get() as any).count;
  const successExec = (db.prepare("SELECT COUNT(*) as count FROM executions WHERE status IN ('confirmed', 'finalized')").get() as any).count;
  const failedExec = (db.prepare("SELECT COUNT(*) as count FROM executions WHERE status = 'failed'").get() as any).count;

  // Total USD routed (sum of usd_estimate for successful executions)
  const usdResult = db.prepare(`
    SELECT COALESCE(SUM(usd_estimate), 0) as total
    FROM executions
    WHERE status IN ('confirmed', 'finalized') AND usd_estimate IS NOT NULL
  `).get() as { total: number };
  const totalUsdRouted = usdResult.total;

  // Relayed transactions (have relayer_address set)
  const relayedCount = (db.prepare(`
    SELECT COUNT(*) as count FROM executions WHERE relayer_address IS NOT NULL
  `).get() as any).count;

  // Unique chains active
  const chainsResult = db.prepare(`
    SELECT DISTINCT chain FROM executions
  `).all() as { chain: string }[];
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
  `).all() as { kind: string; count: number; usdTotal: number }[];

  // Breakdown by venue
  const byVenue = db.prepare(`
    SELECT
      COALESCE(venue, 'unknown') as venue,
      COUNT(*) as count,
      COALESCE(SUM(CASE WHEN status IN ('confirmed', 'finalized') THEN usd_estimate ELSE 0 END), 0) as usdTotal
    FROM executions
    GROUP BY venue
    ORDER BY count DESC
  `).all() as { venue: string; count: number; usdTotal: number }[];

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
  `).all() as { chain: string; network: string; count: number; successCount: number; failedCount: number }[];

  // Average latency
  const latencyResult = db.prepare(`
    SELECT AVG(latency_ms) as avgLatency
    FROM executions
    WHERE latency_ms IS NOT NULL
  `).get() as { avgLatency: number | null };
  const avgLatencyMs = latencyResult.avgLatency ?? 0;

  // Last execution timestamp
  const lastExecResult = db.prepare(`
    SELECT MAX(created_at) as lastAt FROM executions
  `).get() as { lastAt: number | null };

  // Unique wallets
  const uniqueWalletsResult = db.prepare(`
    SELECT COUNT(DISTINCT from_address) as count FROM executions WHERE from_address IS NOT NULL
  `).get() as { count: number };
  const uniqueWallets = uniqueWalletsResult.count;

  // Calculate raw success rate (includes all failures)
  const successRateRaw = totalExec > 0 ? (successExec / totalExec) * 100 : 0;

  // Calculate adjusted success rate (excludes RPC/infra failures)
  // Count failures that are NOT due to RPC/infra issues
  const nonInfraFailedExec = (db.prepare(`
    SELECT COUNT(*) as count FROM executions
    WHERE status = 'failed'
    AND error_code NOT IN ('RPC_RATE_LIMITED', 'RPC_UNAVAILABLE', 'RPC_ERROR')
    AND error_code IS NOT NULL
  `).get() as any).count;

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

export function getRecentExecutions(limit: number = 20): Execution[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM executions
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as Execution[];
}

// ============================================
// Intent Operations
// ============================================

export type IntentKind = 'perp' | 'deposit' | 'swap' | 'bridge' | 'unknown';
export type IntentStatus = 'queued' | 'planned' | 'routed' | 'executing' | 'confirmed' | 'failed';
export type IntentFailureStage = 'plan' | 'route' | 'execute' | 'confirm' | 'quote';

export interface Intent {
  id: string;
  created_at: number;
  intent_text: string;
  intent_kind?: IntentKind;
  requested_chain?: string;
  requested_venue?: string;
  usd_estimate?: number;
  status: IntentStatus;
  planned_at?: number;
  executed_at?: number;
  confirmed_at?: number;
  failure_stage?: IntentFailureStage;
  error_code?: string;
  error_message?: string;
  metadata_json?: string;
}

export function createIntent(params: {
  intentText: string;
  intentKind?: IntentKind;
  requestedChain?: string;
  requestedVenue?: string;
  usdEstimate?: number;
  metadataJson?: string;
}): Intent {
  const db = getDatabase();
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO intents (
      id, created_at, intent_text, intent_kind, requested_chain, requested_venue,
      usd_estimate, status, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)
  `).run(
    id,
    now,
    params.intentText,
    params.intentKind ?? null,
    params.requestedChain ?? null,
    params.requestedVenue ?? null,
    params.usdEstimate ?? null,
    params.metadataJson ?? null
  );

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

export function updateIntentStatus(
  id: string,
  updates: Partial<{
    status: IntentStatus;
    intentKind: IntentKind;
    requestedChain: string;
    requestedVenue: string;
    usdEstimate: number;
    plannedAt: number;
    executedAt: number;
    confirmedAt: number;
    failureStage: IntentFailureStage;
    errorCode: string;
    errorMessage: string;
    metadataJson: string;
  }>
): void {
  const db = getDatabase();
  const sets: string[] = [];
  const values: any[] = [];

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

  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE intents SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function getIntent(id: string): Intent | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM intents WHERE id = ?').get(id) as Intent | undefined;
}

export function getRecentIntents(limit: number = 50): Intent[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM intents
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as Intent[];
}

export interface IntentStatsSummary {
  totalIntents: number;
  confirmedIntents: number;
  failedIntents: number;
  intentSuccessRate: number;
  byKind: { kind: string; count: number; confirmed: number; failed: number }[];
  byStatus: { status: string; count: number }[];
  failuresByStage: { stage: string; count: number }[];
  failuresByCode: { code: string; count: number }[];
  recentIntents: Intent[];
}

export function getIntentStatsSummary(): IntentStatsSummary {
  const db = getDatabase();

  // Basic counts
  const totalIntents = (db.prepare('SELECT COUNT(*) as count FROM intents').get() as any).count;
  const confirmedIntents = (db.prepare("SELECT COUNT(*) as count FROM intents WHERE status = 'confirmed'").get() as any).count;
  const failedIntents = (db.prepare("SELECT COUNT(*) as count FROM intents WHERE status = 'failed'").get() as any).count;

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
  `).all() as { kind: string; count: number; confirmed: number; failed: number }[];

  // By status
  const byStatus = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM intents
    GROUP BY status
    ORDER BY count DESC
  `).all() as { status: string; count: number }[];

  // Failures by stage
  const failuresByStage = db.prepare(`
    SELECT failure_stage as stage, COUNT(*) as count
    FROM intents
    WHERE failure_stage IS NOT NULL
    GROUP BY failure_stage
    ORDER BY count DESC
  `).all() as { stage: string; count: number }[];

  // Failures by code
  const failuresByCode = db.prepare(`
    SELECT COALESCE(error_code, 'UNKNOWN') as code, COUNT(*) as count
    FROM intents
    WHERE status = 'failed'
    GROUP BY error_code
    ORDER BY count DESC
    LIMIT 10
  `).all() as { code: string; count: number }[];

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

export function linkExecutionToIntent(executionId: string, intentId: string): void {
  const db = getDatabase();
  // Add intent_id column if it doesn't exist (migration)
  try {
    db.exec('ALTER TABLE executions ADD COLUMN intent_id TEXT');
  } catch (e: any) {
    // Column already exists
  }

  db.prepare('UPDATE executions SET intent_id = ? WHERE id = ?').run(intentId, executionId);
}

export function getExecutionsForIntent(intentId: string): Execution[] {
  const db = getDatabase();
  // Check if intent_id column exists
  try {
    return db.prepare(`
      SELECT * FROM executions
      WHERE intent_id = ?
      ORDER BY created_at DESC
    `).all(intentId) as Execution[];
  } catch (e) {
    return [];
  }
}

// Updated getSummaryStats to include intent metrics
export function getSummaryStatsWithIntents(): StatsSummary & {
  totalIntents: number;
  intentSuccessRate: number;
  failedIntentsByStage: { stage: string; count: number }[];
} {
  const baseStats = getSummaryStats();
  const intentStats = getIntentStatsSummary();

  return {
    ...baseStats,
    totalIntents: intentStats.totalIntents,
    intentSuccessRate: intentStats.intentSuccessRate,
    failedIntentsByStage: intentStats.failuresByStage,
  };
}

// ============================================
// Positions table operations
// ============================================

export interface Position {
  id: string;
  chain: 'ethereum' | 'solana';
  network: string;
  venue: string;
  market: string;
  side: 'long' | 'short';
  leverage?: number;
  margin_units?: string;
  margin_display?: string;
  size_units?: string;
  entry_price?: string;
  status: 'open' | 'closed' | 'liquidated';
  opened_at: number;
  closed_at?: number;
  open_tx_hash?: string;
  open_explorer_url?: string;
  close_tx_hash?: string;
  close_explorer_url?: string;
  pnl?: string;
  user_address: string;
  on_chain_position_id?: string;
  intent_id?: string;
  execution_id?: string;
  created_at: number;
  updated_at: number;
}

export interface CreatePositionInput {
  chain: 'ethereum' | 'solana';
  network: string;
  venue: string;
  market: string;
  side: 'long' | 'short';
  leverage?: number;
  margin_units?: string;
  margin_display?: string;
  size_units?: string;
  entry_price?: string;
  open_tx_hash?: string;
  open_explorer_url?: string;
  user_address: string;
  on_chain_position_id?: string;
  intent_id?: string;
  execution_id?: string;
}

export function createPosition(input: CreatePositionInput): Position {
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
  `).run(
    id,
    input.chain,
    input.network,
    input.venue,
    input.market,
    input.side,
    input.leverage ?? null,
    input.margin_units ?? null,
    input.margin_display ?? null,
    input.size_units ?? null,
    input.entry_price ?? null,
    now,
    input.open_tx_hash ?? null,
    input.open_explorer_url ?? null,
    input.user_address,
    input.on_chain_position_id ?? null,
    input.intent_id ?? null,
    input.execution_id ?? null,
    now,
    now
  );

  return getPosition(id)!;
}

export function getPosition(id: string): Position | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM positions WHERE id = ?').get(id) as Position | undefined;
  return row ?? null;
}

export function getPositionByOnChainId(
  chain: string,
  network: string,
  venue: string,
  onChainPositionId: string
): Position | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT * FROM positions
    WHERE chain = ? AND network = ? AND venue = ? AND on_chain_position_id = ?
  `).get(chain, network, venue, onChainPositionId) as Position | undefined;
  return row ?? null;
}

export function updatePosition(id: string, updates: Partial<Omit<Position, 'id' | 'created_at'>>): void {
  const db = getDatabase();
  const setClauses: string[] = [];
  const values: any[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      setClauses.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (setClauses.length === 0) return;

  setClauses.push('updated_at = ?');
  values.push(Math.floor(Date.now() / 1000));
  values.push(id);

  db.prepare(`UPDATE positions SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
}

export function closePosition(
  id: string,
  closeTxHash: string,
  closeExplorerUrl: string,
  pnl?: string,
  status: 'closed' | 'liquidated' = 'closed'
): void {
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

export function getOpenPositions(filters?: {
  chain?: string;
  network?: string;
  venue?: string;
  user_address?: string;
}): Position[] {
  const db = getDatabase();
  let sql = 'SELECT * FROM positions WHERE status = ?';
  const params: any[] = ['open'];

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

  return db.prepare(sql).all(...params) as Position[];
}

export function getRecentPositions(limit: number = 20): Position[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM positions
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as Position[];
}

export function getPositionsByStatus(status: 'open' | 'closed' | 'liquidated', limit: number = 50): Position[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM positions
    WHERE status = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(status, limit) as Position[];
}

export function getPositionStats(): {
  total: number;
  open: number;
  closed: number;
  liquidated: number;
  byMarket: { market: string; count: number }[];
} {
  const db = getDatabase();

  const total = (db.prepare('SELECT COUNT(*) as count FROM positions').get() as any).count;
  const open = (db.prepare('SELECT COUNT(*) as count FROM positions WHERE status = ?').get('open') as any).count;
  const closed = (db.prepare('SELECT COUNT(*) as count FROM positions WHERE status = ?').get('closed') as any).count;
  const liquidated = (db.prepare('SELECT COUNT(*) as count FROM positions WHERE status = ?').get('liquidated') as any).count;

  const byMarket = db.prepare(`
    SELECT market, COUNT(*) as count FROM positions
    GROUP BY market ORDER BY count DESC
  `).all() as { market: string; count: number }[];

  return { total, open, closed, liquidated, byMarket };
}

// ============================================
// Indexer state operations
// ============================================

export interface IndexerState {
  id: string;
  chain: string;
  network: string;
  contract_address: string;
  last_indexed_block: number;
  updated_at: number;
}

export function getIndexerState(chain: string, network: string, contractAddress: string): IndexerState | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT * FROM indexer_state
    WHERE chain = ? AND network = ? AND contract_address = ?
  `).get(chain, network, contractAddress) as IndexerState | undefined;
  return row ?? null;
}

export function upsertIndexerState(chain: string, network: string, contractAddress: string, lastIndexedBlock: number): void {
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

// ============================================
// Waitlist operations
// ============================================

export interface WaitlistEntry {
  id: string;
  email?: string;
  wallet_address?: string;
  created_at: number;
  source?: string;
  metadata_json?: string;
}

export function addToWaitlist(params: {
  email?: string;
  walletAddress?: string;
  source?: string;
  metadata?: Record<string, any>;
}): string {
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
  `).run(
    id,
    params.email || null,
    params.walletAddress || null,
    now,
    params.source || 'landing',
    params.metadata ? JSON.stringify(params.metadata) : null
  );

  return id;
}

export function getWaitlistEntries(limit: number = 100): WaitlistEntry[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM waitlist ORDER BY created_at DESC LIMIT ?
  `).all(limit) as WaitlistEntry[];
}

export function getWaitlistCount(): number {
  const db = getDatabase();
  const row = db.prepare('SELECT COUNT(*) as count FROM waitlist').get() as { count: number };
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
export async function createIntentAsync(params: {
  intentText: string;
  intentKind?: string;
  requestedChain?: string;
  requestedVenue?: string;
  usdEstimate?: number;
  metadataJson?: string;
}): Promise<Intent> {
  if (dbType === 'postgres') {
    const pgDb = await import('./db-pg.js');
    return pgDb.createIntent(params) as Promise<Intent>;
  }

  // SQLite: use synchronous version, wrap in Promise
  return Promise.resolve(createIntent(params as any));
}

/**
 * Async-capable intent status update (uses Postgres if DATABASE_URL is set)
 */
export async function updateIntentStatusAsync(
  id: string,
  updates: {
    status?: string;
    plannedAt?: number;
    executedAt?: number;
    confirmedAt?: number;
    failureStage?: string;
    errorCode?: string;
    errorMessage?: string;
    metadataJson?: string;
  }
): Promise<void> {
  if (dbType === 'postgres') {
    const pgDb = await import('./db-pg.js');
    return pgDb.updateIntentStatus(id, updates);
  }

  // SQLite: use synchronous version
  updateIntentStatus(id, updates as any);
  return Promise.resolve();
}

/**
 * Async-capable execution creation (uses Postgres if DATABASE_URL is set)
 */
export async function createExecutionAsync(params: {
  id?: string;
  chain: Chain;
  network: Network;
  kind?: string;
  venue?: string;
  intent: string;
  action: string;
  fromAddress: string;
  toAddress?: string;
  token?: string;
  amountUnits?: string;
  amountDisplay?: string;
  usdEstimate?: number;
  txHash?: string;
  status?: string;
  errorCode?: string;
  errorMessage?: string;
  explorerUrl?: string;
  relayerAddress?: string;
  sessionId?: string;
  intentId?: string;
}): Promise<Execution> {
  if (dbType === 'postgres') {
    const pgDb = await import('./db-pg.js');
    return pgDb.createExecution(params as any) as Promise<Execution>;
  }

  // SQLite: use synchronous version
  return Promise.resolve(createExecution(params as any));
}

/**
 * Async-capable execution update (uses Postgres if DATABASE_URL is set)
 */
export async function updateExecutionAsync(
  id: string,
  updates: {
    txHash?: string;
    status?: string;
    errorCode?: string;
    errorMessage?: string;
    explorerUrl?: string;
    gasUsed?: string;
    blockNumber?: number;
    latencyMs?: number;
  }
): Promise<void> {
  if (dbType === 'postgres') {
    const pgDb = await import('./db-pg.js');
    return pgDb.updateExecution(id, updates as any);
  }

  // SQLite: use synchronous version
  updateExecution(id, updates as any);
  return Promise.resolve();
}

/**
 * Finalize execution in atomic transaction
 * Creates execution row + updates intent status in single transaction
 * Ensures both writes persist before serverless function exits
 */
export async function finalizeExecutionTransactionAsync(params: {
  intentId: string;
  execution: {
    id?: string;
    chain: any;
    network: any;
    kind?: any;
    venue?: any;
    intent: string;
    action: string;
    fromAddress: string;
    toAddress?: string;
    token?: string;
    amountUnits?: string;
    amountDisplay?: string;
    usdEstimate?: number;
    usdEstimateIsEstimate?: boolean;
    txHash?: string;
    status?: any;
    errorCode?: string;
    errorMessage?: string;
    explorerUrl?: string;
    relayerAddress?: string;
    sessionId?: string;
  };
  steps?: Array<{
    stepIndex: number;
    action: string;
    chain: string;
    venue?: string;
    status?: string;
    txHash?: string;
    explorerUrl?: string;
    amount?: string;
    token?: string;
  }>;
  intentStatus: {
    status: any;
    confirmedAt?: number;
    failedAt?: number;
    failureStage?: string;
    errorCode?: string;
    errorMessage?: string;
    metadataJson?: string;
  };
}): Promise<{ executionId: string }> {
  if (dbType === 'postgres') {
    const pgDb = await import('./db-pg.js');
    return pgDb.finalizeExecutionTransaction(params as any);
  }

  // SQLite fallback: use separate calls (less reliable but functional)
  const execution = await createExecutionAsync(params.execution as any);
  await updateIntentStatusAsync(params.intentId, params.intentStatus);
  return { executionId: execution.id };
}

/**
 * Async-capable get intent (uses Postgres if DATABASE_URL is set)
 */
export async function getIntentAsync(id: string): Promise<Intent | undefined> {
  if (dbType === 'postgres') {
    const pgDb = await import('./db-pg.js');
    return pgDb.getIntent(id) as Promise<Intent | undefined>;
  }

  // SQLite: use synchronous version
  return Promise.resolve(getIntent(id));
}

/**
 * Async-capable get recent intents (uses Postgres if DATABASE_URL is set)
 */
export async function getRecentIntentsAsync(limit: number = 50): Promise<Intent[]> {
  if (dbType === 'postgres') {
    const pgDb = await import('./db-pg.js');
    return pgDb.getRecentIntents(limit) as Promise<Intent[]>;
  }

  // SQLite: use synchronous version
  return Promise.resolve(getRecentIntents(limit));
}

/**
 * Async-capable get summary stats (uses Postgres if DATABASE_URL is set)
 */
export async function getSummaryStatsAsync(): Promise<StatsSummary> {
  if (dbType === 'postgres') {
    const pgDb = await import('./db-pg.js');
    return pgDb.getSummaryStats() as Promise<StatsSummary>;
  }

  // SQLite: use synchronous version
  return Promise.resolve(getSummaryStats());
}

/**
 * Async-capable get intent stats summary (uses Postgres if DATABASE_URL is set)
 */
export async function getIntentStatsSummaryAsync(): Promise<IntentStatsSummary> {
  if (dbType === 'postgres') {
    const pgDb = await import('./db-pg.js');
    return pgDb.getIntentStatsSummary() as Promise<IntentStatsSummary>;
  }

  // SQLite: use synchronous version
  return Promise.resolve(getIntentStatsSummary());
}

/**
 * Async-capable get recent executions (uses Postgres if DATABASE_URL is set)
 */
export async function getRecentExecutionsAsync(limit: number = 20): Promise<Execution[]> {
  if (dbType === 'postgres') {
    const pgDb = await import('./db-pg.js');
    return pgDb.getRecentExecutions(limit) as Promise<Execution[]>;
  }

  // SQLite: use synchronous version
  return Promise.resolve(getRecentExecutions(limit));
}

/**
 * Async-capable get executions for intent (uses Postgres if DATABASE_URL is set)
 */
export async function getExecutionsForIntentAsync(intentId: string): Promise<Execution[]> {
  if (dbType === 'postgres') {
    const pgDb = await import('./db-pg.js');
    return pgDb.getExecutionsForIntent(intentId) as Promise<Execution[]>;
  }

  // SQLite: use synchronous version
  return Promise.resolve(getExecutionsForIntent(intentId));
}

/**
 * Async-capable link execution to intent (uses Postgres if DATABASE_URL is set)
 */
export async function linkExecutionToIntentAsync(executionId: string, intentId: string): Promise<void> {
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
export async function createExecutionStepAsync(params: {
  executionId: string;
  stepIndex: number;
  action: string;
  stage?: string;
  status?: string;
}): Promise<ExecutionStep> {
  if (dbType === 'postgres') {
    const pgDb = await import('./db-pg.js');
    return pgDb.createExecutionStep(params) as Promise<ExecutionStep>;
  }

  // SQLite: use synchronous version
  return Promise.resolve(createExecutionStep(params));
}

/**
 * Async-capable update execution step (uses Postgres if DATABASE_URL is set)
 */
export async function updateExecutionStepAsync(
  id: string,
  updates: {
    status?: string;
    txHash?: string;
    errorCode?: string;
    errorMessage?: string;
    explorerUrl?: string;
  }
): Promise<void> {
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
export async function getSummaryStatsWithIntentsAsync(): Promise<
  StatsSummary & {
    totalIntents: number;
    confirmedIntents: number;
    failedIntents: number;
    intentSuccessRate: number;
  }
> {
  if (dbType === 'postgres') {
    const pgDb = await import('./db-pg.js');
    return pgDb.getSummaryStatsWithIntents() as Promise<any>;
  }

  // SQLite: use synchronous version
  return Promise.resolve(getSummaryStatsWithIntents()) as any;
}
