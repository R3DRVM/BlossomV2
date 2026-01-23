/**
 * Bloom Telemetry Database
 * SQLite-based telemetry for tracking users, sessions, and executions
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// ESM-safe __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database file path (in agent/telemetry directory)
const DB_PATH = process.env.TELEMETRY_DB_PATH || path.join(__dirname, 'telemetry.db');

let db: Database.Database | null = null;

/**
 * Initialize the database connection and run migrations
 */
export function initDatabase(): Database.Database {
  if (db) return db;

  // Ensure directory exists
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL'); // Better concurrent access
  db.pragma('foreign_keys = ON');

  // Run migrations
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
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  database.exec(schema);
}

// ============================================
// User Operations
// ============================================

export interface User {
  id: string;
  address: string;
  created_at: number;
  notes?: string;
}

export function upsertUser(address: string, notes?: Record<string, any>): User {
  const db = getDatabase();
  const id = randomUUID();
  const notesJson = notes ? JSON.stringify(notes) : null;

  const stmt = db.prepare(`
    INSERT INTO users (id, address, notes)
    VALUES (?, ?, ?)
    ON CONFLICT(address) DO UPDATE SET
      notes = COALESCE(excluded.notes, users.notes)
    RETURNING *
  `);

  return stmt.get(id, address.toLowerCase(), notesJson) as User;
}

export function getUser(address: string): User | undefined {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM users WHERE address = ?');
  return stmt.get(address.toLowerCase()) as User | undefined;
}

export function listUsers(limit = 100, offset = 0): User[] {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?');
  return stmt.all(limit, offset) as User[];
}

// ============================================
// Session Operations
// ============================================

export interface Session {
  id: string;
  user_address: string;
  session_id: string;
  status: string;
  expires_at?: number;
  created_at: number;
  updated_at: number;
}

export function upsertSession(
  userAddress: string,
  sessionId: string,
  status: string,
  expiresAt?: number
): Session {
  const db = getDatabase();
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);

  // Ensure user exists
  upsertUser(userAddress);

  // Use INSERT OR REPLACE with proper UNIQUE constraint (user_address, session_id)
  const existing = db.prepare(
    'SELECT * FROM sessions WHERE user_address = ? AND session_id = ?'
  ).get(userAddress.toLowerCase(), sessionId) as Session | undefined;

  if (existing) {
    db.prepare(`
      UPDATE sessions SET status = ?, expires_at = ?, updated_at = ?
      WHERE user_address = ? AND session_id = ?
    `).run(status, expiresAt ?? null, now, userAddress.toLowerCase(), sessionId);
    return { ...existing, status, expires_at: expiresAt, updated_at: now };
  }

  db.prepare(`
    INSERT INTO sessions (id, user_address, session_id, status, expires_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, userAddress.toLowerCase(), sessionId, status, expiresAt ?? null, now);

  return {
    id,
    user_address: userAddress.toLowerCase(),
    session_id: sessionId,
    status,
    expires_at: expiresAt,
    created_at: now,
    updated_at: now,
  };
}

export function getLatestSession(userAddress: string): Session | undefined {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM sessions
    WHERE user_address = ?
    ORDER BY created_at DESC
    LIMIT 1
  `);
  return stmt.get(userAddress.toLowerCase()) as Session | undefined;
}

// ============================================
// Execution Operations
// ============================================

export interface Execution {
  id: string;
  user_address: string;
  draft_id?: string;
  correlation_id?: string;
  action: string;
  token?: string;
  amount_units?: string;
  mode: string;
  status: string;
  tx_hash?: string;
  error_code?: string;
  error_message?: string;
  created_at: number;
  updated_at: number;
  latency_ms?: number;
}

export function createExecution(params: {
  userAddress: string;
  draftId?: string;
  correlationId?: string;
  action: string;
  token?: string;
  amountUnits?: string;
  mode?: string;
}): Execution {
  const db = getDatabase();
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);

  // Ensure user exists
  upsertUser(params.userAddress);

  db.prepare(`
    INSERT INTO executions (id, user_address, draft_id, correlation_id, action, token, amount_units, mode, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?)
  `).run(
    id,
    params.userAddress.toLowerCase(),
    params.draftId ?? null,
    params.correlationId ?? null,
    params.action,
    params.token ?? null,
    params.amountUnits ?? null,
    params.mode ?? 'real',
    now,
    now
  );

  return {
    id,
    user_address: params.userAddress.toLowerCase(),
    draft_id: params.draftId,
    correlation_id: params.correlationId,
    action: params.action,
    token: params.token,
    amount_units: params.amountUnits,
    mode: params.mode ?? 'real',
    status: 'prepared',
    created_at: now,
    updated_at: now,
  };
}

export function updateExecution(
  id: string,
  updates: {
    status?: string;
    txHash?: string;
    errorCode?: string;
    errorMessage?: string;
    latencyMs?: number;
  }
): void {
  const db = getDatabase();
  const now = Math.floor(Date.now() / 1000);

  const sets: string[] = ['updated_at = ?'];
  const values: any[] = [now];

  if (updates.status !== undefined) {
    sets.push('status = ?');
    values.push(updates.status);
  }
  if (updates.txHash !== undefined) {
    sets.push('tx_hash = ?');
    values.push(updates.txHash);
  }
  if (updates.errorCode !== undefined) {
    sets.push('error_code = ?');
    values.push(updates.errorCode);
  }
  if (updates.errorMessage !== undefined) {
    sets.push('error_message = ?');
    values.push(updates.errorMessage);
  }
  if (updates.latencyMs !== undefined) {
    sets.push('latency_ms = ?');
    values.push(updates.latencyMs);
  }

  values.push(id);

  db.prepare(`UPDATE executions SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function updateExecutionByCorrelationId(
  correlationId: string,
  updates: {
    status?: string;
    txHash?: string;
    errorCode?: string;
    errorMessage?: string;
    latencyMs?: number;
  }
): void {
  const db = getDatabase();
  const now = Math.floor(Date.now() / 1000);

  const sets: string[] = ['updated_at = ?'];
  const values: any[] = [now];

  if (updates.status !== undefined) {
    sets.push('status = ?');
    values.push(updates.status);
  }
  if (updates.txHash !== undefined) {
    sets.push('tx_hash = ?');
    values.push(updates.txHash);
  }
  if (updates.errorCode !== undefined) {
    sets.push('error_code = ?');
    values.push(updates.errorCode);
  }
  if (updates.errorMessage !== undefined) {
    sets.push('error_message = ?');
    values.push(updates.errorMessage);
  }
  if (updates.latencyMs !== undefined) {
    sets.push('latency_ms = ?');
    values.push(updates.latencyMs);
  }

  values.push(correlationId);

  db.prepare(`UPDATE executions SET ${sets.join(', ')} WHERE correlation_id = ?`).run(...values);
}

export function getExecution(id: string): Execution | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM executions WHERE id = ?').get(id) as Execution | undefined;
}

export function listExecutions(limit = 50, offset = 0): Execution[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM executions
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as Execution[];
}

// ============================================
// Request Log Operations
// ============================================

export function logRequest(params: {
  endpoint: string;
  method?: string;
  userAddress?: string;
  correlationId?: string;
  statusCode?: number;
  latencyMs?: number;
  errorCode?: string;
}): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO request_log (endpoint, method, user_address, correlation_id, status_code, latency_ms, error_code)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.endpoint,
    params.method ?? 'GET',
    params.userAddress?.toLowerCase() ?? null,
    params.correlationId ?? null,
    params.statusCode ?? null,
    params.latencyMs ?? null,
    params.errorCode ?? null
  );
}

// ============================================
// Metrics / Summary Operations
// ============================================

export interface TelemetrySummary {
  totalUsers: number;
  totalSessions: number;
  activeSessions: number;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  successRate: number;
  avgLatencyMs: number | null;
  topErrors: { error_code: string; count: number }[];
  recentExecutions: Execution[];
}

export function getTelemetrySummary(): TelemetrySummary {
  const db = getDatabase();

  const totalUsers = (db.prepare('SELECT COUNT(*) as count FROM users').get() as any).count;
  const totalSessions = (db.prepare('SELECT COUNT(*) as count FROM sessions').get() as any).count;
  const activeSessions = (db.prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'active'").get() as any).count;
  const totalExecutions = (db.prepare('SELECT COUNT(*) as count FROM executions').get() as any).count;
  const successfulExecutions = (db.prepare("SELECT COUNT(*) as count FROM executions WHERE status = 'confirmed'").get() as any).count;
  const failedExecutions = (db.prepare("SELECT COUNT(*) as count FROM executions WHERE status = 'failed'").get() as any).count;

  const avgLatency = db.prepare('SELECT AVG(latency_ms) as avg FROM executions WHERE latency_ms IS NOT NULL').get() as any;

  const topErrors = db.prepare(`
    SELECT error_code, COUNT(*) as count
    FROM executions
    WHERE error_code IS NOT NULL
    GROUP BY error_code
    ORDER BY count DESC
    LIMIT 10
  `).all() as { error_code: string; count: number }[];

  const recentExecutions = listExecutions(20);

  return {
    totalUsers,
    totalSessions,
    activeSessions,
    totalExecutions,
    successfulExecutions,
    failedExecutions,
    successRate: totalExecutions > 0 ? (successfulExecutions / totalExecutions) * 100 : 0,
    avgLatencyMs: avgLatency?.avg ?? null,
    topErrors,
    recentExecutions,
  };
}

export function getUsersWithSessionStatus(): Array<User & { session_status?: string; session_id?: string }> {
  const db = getDatabase();
  return db.prepare(`
    SELECT u.*, s.status as session_status, s.session_id
    FROM users u
    LEFT JOIN sessions s ON u.address = s.user_address
    ORDER BY u.created_at DESC
    LIMIT 100
  `).all() as Array<User & { session_status?: string; session_id?: string }>;
}

// ============================================
// Devnet Statistics Operations
// ============================================

export interface DevnetStats {
  // A) Unique devnet users
  users: {
    allTime: number;
    last24h: number;
  };
  // B) Processed transactions
  transactions: {
    allTime: number;
    last24h: number;
    successCount: number;
    failCount: number;
  };
  // C) Total devnet amount executed
  amountExecuted: {
    byToken: Array<{ token: string; totalUnits: string }>;
    unpricedCount: number;
  };
  // D) Devnet fees collected
  feesCollected: {
    byToken: Array<{ token: string; totalFeeUnits: string; last24hFeeUnits: string }>;
    feeBps: number;
    unpricedCount: number;
  };
  // Metadata
  generatedAt: string;
}

/**
 * Get comprehensive devnet statistics for landing page
 */
export function getDevnetStats(feeBps: number): DevnetStats {
  const db = getDatabase();
  const now = Math.floor(Date.now() / 1000);
  const dayAgo = now - 86400;

  // A) Unique users
  const totalUsersResult = db.prepare('SELECT COUNT(DISTINCT address) as count FROM users').get() as any;
  const users24hResult = db.prepare(
    'SELECT COUNT(DISTINCT user_address) as count FROM executions WHERE created_at >= ?'
  ).get(dayAgo) as any;

  // B) Transaction counts
  const totalExecResult = db.prepare('SELECT COUNT(*) as count FROM executions').get() as any;
  const exec24hResult = db.prepare(
    'SELECT COUNT(*) as count FROM executions WHERE created_at >= ?'
  ).get(dayAgo) as any;
  const successResult = db.prepare(
    "SELECT COUNT(*) as count FROM executions WHERE status = 'confirmed' OR tx_hash IS NOT NULL"
  ).get() as any;
  const failResult = db.prepare(
    "SELECT COUNT(*) as count FROM executions WHERE status = 'failed'"
  ).get() as any;

  // C) Amount executed by token
  const amountByToken = db.prepare(`
    SELECT token, SUM(CAST(amount_units AS REAL)) as total_units
    FROM executions
    WHERE token IS NOT NULL AND amount_units IS NOT NULL AND amount_units != ''
    GROUP BY token
  `).all() as Array<{ token: string; total_units: number }>;

  const unpricedAmountResult = db.prepare(`
    SELECT COUNT(*) as count FROM executions
    WHERE token IS NULL OR amount_units IS NULL OR amount_units = ''
  `).get() as any;

  // D) Fees collected by token (only successful executions)
  // First try to use stored fee_units, otherwise calculate from amount_units
  const feesByToken = db.prepare(`
    SELECT
      token,
      SUM(CAST(COALESCE(fee_units, CAST(amount_units AS REAL) * ? / 10000) AS REAL)) as total_fee,
      SUM(CASE WHEN created_at >= ? THEN CAST(COALESCE(fee_units, CAST(amount_units AS REAL) * ? / 10000) AS REAL) ELSE 0 END) as fee_24h
    FROM executions
    WHERE (status = 'confirmed' OR tx_hash IS NOT NULL)
      AND token IS NOT NULL
      AND amount_units IS NOT NULL
      AND amount_units != ''
    GROUP BY token
  `).all(feeBps, dayAgo, feeBps) as Array<{ token: string; total_fee: number; fee_24h: number }>;

  const unpricedFeeResult = db.prepare(`
    SELECT COUNT(*) as count FROM executions
    WHERE (status = 'confirmed' OR tx_hash IS NOT NULL)
      AND (token IS NULL OR amount_units IS NULL OR amount_units = '')
  `).get() as any;

  return {
    users: {
      allTime: totalUsersResult?.count ?? 0,
      last24h: users24hResult?.count ?? 0,
    },
    transactions: {
      allTime: totalExecResult?.count ?? 0,
      last24h: exec24hResult?.count ?? 0,
      successCount: successResult?.count ?? 0,
      failCount: failResult?.count ?? 0,
    },
    amountExecuted: {
      byToken: amountByToken.map(row => ({
        token: row.token,
        totalUnits: row.total_units?.toFixed(6) ?? '0',
      })),
      unpricedCount: unpricedAmountResult?.count ?? 0,
    },
    feesCollected: {
      byToken: feesByToken.map(row => ({
        token: row.token,
        totalFeeUnits: row.total_fee?.toFixed(6) ?? '0',
        last24hFeeUnits: row.fee_24h?.toFixed(6) ?? '0',
      })),
      feeBps,
      unpricedCount: unpricedFeeResult?.count ?? 0,
    },
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Update execution with fee information (call after successful execution)
 */
export function updateExecutionWithFee(
  id: string,
  amountUnits: string | undefined,
  feeBps: number
): void {
  if (!amountUnits) return;

  const db = getDatabase();
  const amount = parseFloat(amountUnits);
  if (isNaN(amount)) return;

  const feeUnits = (amount * feeBps / 10000).toFixed(6);

  db.prepare(`
    UPDATE executions SET fee_units = ?, fee_bps = ?, updated_at = ?
    WHERE id = ?
  `).run(feeUnits, feeBps, Math.floor(Date.now() / 1000), id);
}

// ============================================
// Traffic Statistics (Request-level metrics)
// ============================================

export interface TrafficStats {
  // Traffic = HTTP requests processed (not on-chain transactions)
  requests: {
    allTime: number;
    last24h: number;
    successRate24h: number; // percentage of requests with status_code < 400
    http5xx24h: number;
  };
  // Unique visitors based on user_address in request_log
  visitors: {
    allTime: number;
    last24h: number;
  };
  generatedAt: string;
}

/**
 * Get traffic statistics (HTTP request-level metrics)
 * This is separate from execution stats which track on-chain transactions
 */
export function getTrafficStats(windowHours = 24): TrafficStats {
  const db = getDatabase();
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (windowHours * 3600);

  // Total requests all time
  const totalRequestsResult = db.prepare(
    'SELECT COUNT(*) as count FROM request_log'
  ).get() as any;

  // Requests in window
  const requestsWindowResult = db.prepare(
    'SELECT COUNT(*) as count FROM request_log WHERE created_at >= ?'
  ).get(windowStart) as any;

  // Success rate in window (status_code < 400 or null = success)
  const successWindowResult = db.prepare(`
    SELECT COUNT(*) as count FROM request_log
    WHERE created_at >= ? AND (status_code IS NULL OR status_code < 400)
  `).get(windowStart) as any;

  // 5xx errors in window
  const http5xxWindowResult = db.prepare(
    'SELECT COUNT(*) as count FROM request_log WHERE created_at >= ? AND status_code >= 500'
  ).get(windowStart) as any;

  // Unique visitors all time (by user_address)
  const visitorsAllTimeResult = db.prepare(
    'SELECT COUNT(DISTINCT user_address) as count FROM request_log WHERE user_address IS NOT NULL'
  ).get() as any;

  // Unique visitors in window
  const visitorsWindowResult = db.prepare(
    'SELECT COUNT(DISTINCT user_address) as count FROM request_log WHERE user_address IS NOT NULL AND created_at >= ?'
  ).get(windowStart) as any;

  const requestsInWindow = requestsWindowResult?.count ?? 0;
  const successInWindow = successWindowResult?.count ?? 0;
  const successRate = requestsInWindow > 0 ? (successInWindow / requestsInWindow) * 100 : 100;

  return {
    requests: {
      allTime: totalRequestsResult?.count ?? 0,
      last24h: requestsInWindow,
      successRate24h: Math.round(successRate * 100) / 100,
      http5xx24h: http5xxWindowResult?.count ?? 0,
    },
    visitors: {
      allTime: visitorsAllTimeResult?.count ?? 0,
      last24h: visitorsWindowResult?.count ?? 0,
    },
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Get request log stats for load test reports
 */
export function getRequestLogStats(runId?: string): {
  totalRequests: number;
  byEndpoint: Array<{ endpoint: string; count: number; successCount: number; avgLatencyMs: number; p95LatencyMs: number }>;
  errorCodes: Array<{ code: string; count: number }>;
  http5xxCount: number;
} {
  const db = getDatabase();

  const totalResult = db.prepare('SELECT COUNT(*) as count FROM request_log').get() as any;

  const byEndpoint = db.prepare(`
    SELECT
      endpoint,
      COUNT(*) as count,
      SUM(CASE WHEN status_code = 200 THEN 1 ELSE 0 END) as success_count,
      AVG(latency_ms) as avg_latency
    FROM request_log
    GROUP BY endpoint
    ORDER BY count DESC
  `).all() as Array<{ endpoint: string; count: number; success_count: number; avg_latency: number }>;

  // Calculate p95 per endpoint
  const byEndpointWithP95 = byEndpoint.map(row => {
    const latencies = db.prepare(
      'SELECT latency_ms FROM request_log WHERE endpoint = ? AND latency_ms IS NOT NULL ORDER BY latency_ms'
    ).all(row.endpoint) as Array<{ latency_ms: number }>;

    const p95Index = Math.ceil(latencies.length * 0.95) - 1;
    const p95 = latencies[Math.max(0, p95Index)]?.latency_ms ?? 0;

    return {
      endpoint: row.endpoint,
      count: row.count,
      successCount: row.success_count,
      avgLatencyMs: Math.round(row.avg_latency ?? 0),
      p95LatencyMs: p95,
    };
  });

  const errorCodes = db.prepare(`
    SELECT error_code as code, COUNT(*) as count
    FROM request_log
    WHERE error_code IS NOT NULL
    GROUP BY error_code
    ORDER BY count DESC
    LIMIT 10
  `).all() as Array<{ code: string; count: number }>;

  const http5xxResult = db.prepare(
    'SELECT COUNT(*) as count FROM request_log WHERE status_code >= 500'
  ).get() as any;

  return {
    totalRequests: totalResult?.count ?? 0,
    byEndpoint: byEndpointWithP95,
    errorCodes,
    http5xxCount: http5xxResult?.count ?? 0,
  };
}

/**
 * Get recent transaction hashes for reporting
 */
export function getRecentTxHashes(limit = 20): string[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT tx_hash FROM executions
    WHERE tx_hash IS NOT NULL
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as Array<{ tx_hash: string }>;

  return rows.map(r => r.tx_hash);
}

/**
 * Migrate database to add fee columns if they don't exist
 */
export function migrateAddFeeColumns(): void {
  const db = getDatabase();

  // Check if fee_units column exists
  const columns = db.prepare("PRAGMA table_info(executions)").all() as Array<{ name: string }>;
  const hasFeeCols = columns.some(c => c.name === 'fee_units');

  if (!hasFeeCols) {
    try {
      db.exec('ALTER TABLE executions ADD COLUMN fee_units TEXT');
      db.exec('ALTER TABLE executions ADD COLUMN fee_bps INTEGER');
      console.log('[telemetry] Migrated: added fee_units and fee_bps columns');
    } catch (e) {
      // Columns might already exist from schema.sql
      console.log('[telemetry] Fee columns already exist or migration skipped');
    }
  }
}

// ============================================
// Devnet Traffic Runs Operations
// ============================================

export interface DevnetRun {
  run_id: string;
  stage: number | null;
  users: number;
  concurrency: number;
  duration: number;
  total_requests: number;
  success_rate: number;
  p50_ms: number;
  p95_ms: number;
  http_5xx: number;
  top_error_code: string | null;
  started_at: string;
  ended_at: string;
  report_path: string | null;
  created_at: number;
}

/**
 * Ensure runs table exists
 */
export function ensureRunsTable(): void {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT UNIQUE NOT NULL,
      stage INTEGER,
      users INTEGER,
      concurrency INTEGER,
      duration INTEGER,
      total_requests INTEGER,
      success_rate REAL,
      p50_ms INTEGER,
      p95_ms INTEGER,
      http_5xx INTEGER,
      top_error_code TEXT,
      started_at TEXT,
      ended_at TEXT,
      report_path TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_runs_run_id ON runs(run_id);
    CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at);
  `);
}

/**
 * Insert or update a run record
 */
export function upsertRun(run: Omit<DevnetRun, 'created_at'>): void {
  const db = getDatabase();
  ensureRunsTable();

  db.prepare(`
    INSERT OR REPLACE INTO runs (
      run_id, stage, users, concurrency, duration,
      total_requests, success_rate, p50_ms, p95_ms, http_5xx,
      top_error_code, started_at, ended_at, report_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    run.run_id,
    run.stage,
    run.users,
    run.concurrency,
    run.duration,
    run.total_requests,
    run.success_rate,
    run.p50_ms,
    run.p95_ms,
    run.http_5xx,
    run.top_error_code,
    run.started_at,
    run.ended_at,
    run.report_path
  );
}

/**
 * List recent devnet traffic runs
 */
export function listRuns(limit = 5): DevnetRun[] {
  const db = getDatabase();
  ensureRunsTable();

  return db.prepare(`
    SELECT * FROM runs
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as DevnetRun[];
}

/**
 * Get a specific run by run_id
 */
export function getRun(runId: string): DevnetRun | undefined {
  const db = getDatabase();
  ensureRunsTable();

  return db.prepare('SELECT * FROM runs WHERE run_id = ?').get(runId) as DevnetRun | undefined;
}
