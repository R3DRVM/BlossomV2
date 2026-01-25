"use strict";
/**
 * Bloom Telemetry Database
 * SQLite-based telemetry for tracking users, sessions, and executions
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDatabase = initDatabase;
exports.getDatabase = getDatabase;
exports.closeDatabase = closeDatabase;
exports.upsertUser = upsertUser;
exports.getUser = getUser;
exports.listUsers = listUsers;
exports.upsertSession = upsertSession;
exports.getLatestSession = getLatestSession;
exports.createExecution = createExecution;
exports.updateExecution = updateExecution;
exports.updateExecutionByCorrelationId = updateExecutionByCorrelationId;
exports.getExecution = getExecution;
exports.listExecutions = listExecutions;
exports.logRequest = logRequest;
exports.getTelemetrySummary = getTelemetrySummary;
exports.getUsersWithSessionStatus = getUsersWithSessionStatus;
exports.getDevnetStats = getDevnetStats;
exports.updateExecutionWithFee = updateExecutionWithFee;
exports.getTrafficStats = getTrafficStats;
exports.getRequestLogStats = getRequestLogStats;
exports.getRecentTxHashes = getRecentTxHashes;
exports.migrateAddFeeColumns = migrateAddFeeColumns;
exports.ensureRunsTable = ensureRunsTable;
exports.upsertRun = upsertRun;
exports.listRuns = listRuns;
exports.getRun = getRun;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const crypto_1 = require("crypto");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const url_1 = require("url");
const path_1 = require("path");
// ESM-safe __dirname equivalent
const __filename = (0, url_1.fileURLToPath)(import.meta.url);
const __dirname = (0, path_1.dirname)(__filename);
// Database file path (in agent/telemetry directory)
const DB_PATH = process.env.TELEMETRY_DB_PATH || path.join(__dirname, 'telemetry.db');
let db = null;
/**
 * Initialize the database connection and run migrations
 */
function initDatabase() {
    if (db)
        return db;
    // Ensure directory exists
    const dbDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }
    db = new better_sqlite3_1.default(DB_PATH);
    db.pragma('journal_mode = WAL'); // Better concurrent access
    db.pragma('foreign_keys = ON');
    // Run migrations
    runMigrations(db);
    return db;
}
/**
 * Get the database instance (initializes if needed)
 */
function getDatabase() {
    if (!db) {
        return initDatabase();
    }
    return db;
}
/**
 * Close the database connection
 */
function closeDatabase() {
    if (db) {
        db.close();
        db = null;
    }
}
/**
 * Run schema migrations
 */
function runMigrations(database) {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    database.exec(schema);
}
function upsertUser(address, notes) {
    const db = getDatabase();
    const id = (0, crypto_1.randomUUID)();
    const notesJson = notes ? JSON.stringify(notes) : null;
    const stmt = db.prepare(`
    INSERT INTO users (id, address, notes)
    VALUES (?, ?, ?)
    ON CONFLICT(address) DO UPDATE SET
      notes = COALESCE(excluded.notes, users.notes)
    RETURNING *
  `);
    return stmt.get(id, address.toLowerCase(), notesJson);
}
function getUser(address) {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM users WHERE address = ?');
    return stmt.get(address.toLowerCase());
}
function listUsers(limit = 100, offset = 0) {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?');
    return stmt.all(limit, offset);
}
function upsertSession(userAddress, sessionId, status, expiresAt) {
    const db = getDatabase();
    const id = (0, crypto_1.randomUUID)();
    const now = Math.floor(Date.now() / 1000);
    // Ensure user exists
    upsertUser(userAddress);
    // Use INSERT OR REPLACE with proper UNIQUE constraint (user_address, session_id)
    const existing = db.prepare('SELECT * FROM sessions WHERE user_address = ? AND session_id = ?').get(userAddress.toLowerCase(), sessionId);
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
function getLatestSession(userAddress) {
    const db = getDatabase();
    const stmt = db.prepare(`
    SELECT * FROM sessions
    WHERE user_address = ?
    ORDER BY created_at DESC
    LIMIT 1
  `);
    return stmt.get(userAddress.toLowerCase());
}
function createExecution(params) {
    const db = getDatabase();
    const id = (0, crypto_1.randomUUID)();
    const now = Math.floor(Date.now() / 1000);
    // Ensure user exists
    upsertUser(params.userAddress);
    db.prepare(`
    INSERT INTO executions (id, user_address, draft_id, correlation_id, action, token, amount_units, mode, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?)
  `).run(id, params.userAddress.toLowerCase(), params.draftId ?? null, params.correlationId ?? null, params.action, params.token ?? null, params.amountUnits ?? null, params.mode ?? 'real', now, now);
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
function updateExecution(id, updates) {
    const db = getDatabase();
    const now = Math.floor(Date.now() / 1000);
    const sets = ['updated_at = ?'];
    const values = [now];
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
function updateExecutionByCorrelationId(correlationId, updates) {
    const db = getDatabase();
    const now = Math.floor(Date.now() / 1000);
    const sets = ['updated_at = ?'];
    const values = [now];
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
function getExecution(id) {
    const db = getDatabase();
    return db.prepare('SELECT * FROM executions WHERE id = ?').get(id);
}
function listExecutions(limit = 50, offset = 0) {
    const db = getDatabase();
    return db.prepare(`
    SELECT * FROM executions
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}
// ============================================
// Request Log Operations
// ============================================
function logRequest(params) {
    const db = getDatabase();
    db.prepare(`
    INSERT INTO request_log (endpoint, method, user_address, correlation_id, status_code, latency_ms, error_code)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(params.endpoint, params.method ?? 'GET', params.userAddress?.toLowerCase() ?? null, params.correlationId ?? null, params.statusCode ?? null, params.latencyMs ?? null, params.errorCode ?? null);
}
function getTelemetrySummary() {
    const db = getDatabase();
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalSessions = db.prepare('SELECT COUNT(*) as count FROM sessions').get().count;
    const activeSessions = db.prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'active'").get().count;
    const totalExecutions = db.prepare('SELECT COUNT(*) as count FROM executions').get().count;
    const successfulExecutions = db.prepare("SELECT COUNT(*) as count FROM executions WHERE status = 'confirmed'").get().count;
    const failedExecutions = db.prepare("SELECT COUNT(*) as count FROM executions WHERE status = 'failed'").get().count;
    const avgLatency = db.prepare('SELECT AVG(latency_ms) as avg FROM executions WHERE latency_ms IS NOT NULL').get();
    const topErrors = db.prepare(`
    SELECT error_code, COUNT(*) as count
    FROM executions
    WHERE error_code IS NOT NULL
    GROUP BY error_code
    ORDER BY count DESC
    LIMIT 10
  `).all();
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
function getUsersWithSessionStatus() {
    const db = getDatabase();
    return db.prepare(`
    SELECT u.*, s.status as session_status, s.session_id
    FROM users u
    LEFT JOIN sessions s ON u.address = s.user_address
    ORDER BY u.created_at DESC
    LIMIT 100
  `).all();
}
/**
 * Get comprehensive devnet statistics for landing page
 */
function getDevnetStats(feeBps) {
    const db = getDatabase();
    const now = Math.floor(Date.now() / 1000);
    const dayAgo = now - 86400;
    // A) Unique users
    const totalUsersResult = db.prepare('SELECT COUNT(DISTINCT address) as count FROM users').get();
    const users24hResult = db.prepare('SELECT COUNT(DISTINCT user_address) as count FROM executions WHERE created_at >= ?').get(dayAgo);
    // B) Transaction counts
    const totalExecResult = db.prepare('SELECT COUNT(*) as count FROM executions').get();
    const exec24hResult = db.prepare('SELECT COUNT(*) as count FROM executions WHERE created_at >= ?').get(dayAgo);
    const successResult = db.prepare("SELECT COUNT(*) as count FROM executions WHERE status = 'confirmed' OR tx_hash IS NOT NULL").get();
    const failResult = db.prepare("SELECT COUNT(*) as count FROM executions WHERE status = 'failed'").get();
    // C) Amount executed by token
    const amountByToken = db.prepare(`
    SELECT token, SUM(CAST(amount_units AS REAL)) as total_units
    FROM executions
    WHERE token IS NOT NULL AND amount_units IS NOT NULL AND amount_units != ''
    GROUP BY token
  `).all();
    const unpricedAmountResult = db.prepare(`
    SELECT COUNT(*) as count FROM executions
    WHERE token IS NULL OR amount_units IS NULL OR amount_units = ''
  `).get();
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
  `).all(feeBps, dayAgo, feeBps);
    const unpricedFeeResult = db.prepare(`
    SELECT COUNT(*) as count FROM executions
    WHERE (status = 'confirmed' OR tx_hash IS NOT NULL)
      AND (token IS NULL OR amount_units IS NULL OR amount_units = '')
  `).get();
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
function updateExecutionWithFee(id, amountUnits, feeBps) {
    if (!amountUnits)
        return;
    const db = getDatabase();
    const amount = parseFloat(amountUnits);
    if (isNaN(amount))
        return;
    const feeUnits = (amount * feeBps / 10000).toFixed(6);
    db.prepare(`
    UPDATE executions SET fee_units = ?, fee_bps = ?, updated_at = ?
    WHERE id = ?
  `).run(feeUnits, feeBps, Math.floor(Date.now() / 1000), id);
}
/**
 * Get traffic statistics (HTTP request-level metrics)
 * This is separate from execution stats which track on-chain transactions
 */
function getTrafficStats(windowHours = 24) {
    const db = getDatabase();
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - (windowHours * 3600);
    // Total requests all time
    const totalRequestsResult = db.prepare('SELECT COUNT(*) as count FROM request_log').get();
    // Requests in window
    const requestsWindowResult = db.prepare('SELECT COUNT(*) as count FROM request_log WHERE created_at >= ?').get(windowStart);
    // Success rate in window (status_code < 400 or null = success)
    const successWindowResult = db.prepare(`
    SELECT COUNT(*) as count FROM request_log
    WHERE created_at >= ? AND (status_code IS NULL OR status_code < 400)
  `).get(windowStart);
    // 5xx errors in window
    const http5xxWindowResult = db.prepare('SELECT COUNT(*) as count FROM request_log WHERE created_at >= ? AND status_code >= 500').get(windowStart);
    // Unique visitors all time (by user_address)
    const visitorsAllTimeResult = db.prepare('SELECT COUNT(DISTINCT user_address) as count FROM request_log WHERE user_address IS NOT NULL').get();
    // Unique visitors in window
    const visitorsWindowResult = db.prepare('SELECT COUNT(DISTINCT user_address) as count FROM request_log WHERE user_address IS NOT NULL AND created_at >= ?').get(windowStart);
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
function getRequestLogStats(runId) {
    const db = getDatabase();
    const totalResult = db.prepare('SELECT COUNT(*) as count FROM request_log').get();
    const byEndpoint = db.prepare(`
    SELECT
      endpoint,
      COUNT(*) as count,
      SUM(CASE WHEN status_code = 200 THEN 1 ELSE 0 END) as success_count,
      AVG(latency_ms) as avg_latency
    FROM request_log
    GROUP BY endpoint
    ORDER BY count DESC
  `).all();
    // Calculate p95 per endpoint
    const byEndpointWithP95 = byEndpoint.map(row => {
        const latencies = db.prepare('SELECT latency_ms FROM request_log WHERE endpoint = ? AND latency_ms IS NOT NULL ORDER BY latency_ms').all(row.endpoint);
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
  `).all();
    const http5xxResult = db.prepare('SELECT COUNT(*) as count FROM request_log WHERE status_code >= 500').get();
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
function getRecentTxHashes(limit = 20) {
    const db = getDatabase();
    const rows = db.prepare(`
    SELECT tx_hash FROM executions
    WHERE tx_hash IS NOT NULL
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
    return rows.map(r => r.tx_hash);
}
/**
 * Migrate database to add fee columns if they don't exist
 */
function migrateAddFeeColumns() {
    const db = getDatabase();
    // Check if fee_units column exists
    const columns = db.prepare("PRAGMA table_info(executions)").all();
    const hasFeeCols = columns.some(c => c.name === 'fee_units');
    if (!hasFeeCols) {
        try {
            db.exec('ALTER TABLE executions ADD COLUMN fee_units TEXT');
            db.exec('ALTER TABLE executions ADD COLUMN fee_bps INTEGER');
            console.log('[telemetry] Migrated: added fee_units and fee_bps columns');
        }
        catch (e) {
            // Columns might already exist from schema.sql
            console.log('[telemetry] Fee columns already exist or migration skipped');
        }
    }
}
/**
 * Ensure runs table exists
 */
function ensureRunsTable() {
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
function upsertRun(run) {
    const db = getDatabase();
    ensureRunsTable();
    db.prepare(`
    INSERT OR REPLACE INTO runs (
      run_id, stage, users, concurrency, duration,
      total_requests, success_rate, p50_ms, p95_ms, http_5xx,
      top_error_code, started_at, ended_at, report_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(run.run_id, run.stage, run.users, run.concurrency, run.duration, run.total_requests, run.success_rate, run.p50_ms, run.p95_ms, run.http_5xx, run.top_error_code, run.started_at, run.ended_at, run.report_path);
}
/**
 * List recent devnet traffic runs
 */
function listRuns(limit = 5) {
    const db = getDatabase();
    ensureRunsTable();
    return db.prepare(`
    SELECT * FROM runs
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}
/**
 * Get a specific run by run_id
 */
function getRun(runId) {
    const db = getDatabase();
    ensureRunsTable();
    return db.prepare('SELECT * FROM runs WHERE run_id = ?').get(runId);
}
//# sourceMappingURL=db.js.map