/**
 * Telemetry Logger
 * Writes JSON lines to logs/telemetry.jsonl for MVP observability.
 * Also writes to SQLite database for structured queries.
 * Privacy-preserving: user addresses are hashed with TELEMETRY_SALT.
 */

import { createHash } from 'crypto';
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Import DB telemetry (lazy loaded to avoid circular deps)
let dbTelemetry: typeof import('../../telemetry/db') | null = null;
let dbLoadAttempted = false;

async function getDbTelemetry() {
  if (dbLoadAttempted) return dbTelemetry;
  dbLoadAttempted = true;
  try {
    dbTelemetry = await import('../../telemetry/db');
    dbTelemetry.initDatabase();
  } catch (e) {
    console.warn('[telemetry] SQLite DB not available:', (e as Error).message);
    dbTelemetry = null;
  }
  return dbTelemetry;
}

// ESM-safe __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Log file path (repo-relative: agent/src/telemetry -> agent/logs)
const LOG_DIR = join(__dirname, '../../logs');
const LOG_FILE = join(LOG_DIR, 'telemetry.jsonl');

// Ensure log directory exists (fail open - never crash server)
let logDirReady = false;
try {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
  logDirReady = true;
} catch (e) {
  console.warn('[telemetry] Could not create log directory (telemetry disabled):', e);
  logDirReady = false;
}

// Salt for hashing user addresses (from env or default)
const TELEMETRY_SALT = process.env.TELEMETRY_SALT || 'blossom-mvp-default-salt';

/**
 * Hash a user address for privacy
 */
export function hashAddress(address: string): string {
  if (!address) return 'unknown';
  return createHash('sha256')
    .update(TELEMETRY_SALT + address.toLowerCase())
    .digest('hex')
    .substring(0, 16); // First 16 chars for brevity
}

/**
 * Telemetry event types
 */
export type TelemetryEventType =
  | 'chat_request'
  | 'chat_response'
  | 'prepare_success'
  | 'prepare_fail'
  | 'approve_prepare'
  | 'submit_tx'
  | 'relayed_tx'
  | 'session_prepare'
  | 'tx_confirmed'
  | 'tx_failed'
  | 'tx_timeout'
  | 'preflight_check'
  | 'execution_complete'
  | 'error';

/**
 * Telemetry event payload
 */
export interface TelemetryPayload {
  // Execution context
  mode?: 'sim' | 'eth_testnet';
  authMode?: 'direct' | 'session';
  draftId?: string;
  userHash?: string; // Hashed address
  
  // Transaction info
  txHash?: string;
  actionTypes?: number[];
  blockNumber?: number;
  
  // Outcome
  success?: boolean;
  error?: string;
  
  // Additional metadata
  latencyMs?: number;
  notes?: string[];
  
  // Action-specific
  executionKind?: string;
  venue?: string;
}

/**
 * Log a telemetry event
 * Fail open: never crashes the server, silently fails if logging is unavailable
 */
export function logEvent(type: TelemetryEventType, payload: TelemetryPayload): void {
  // Fail open: if log directory wasn't ready, skip logging
  if (!logDirReady) {
    return;
  }
  
  try {
    const event = {
      ts: new Date().toISOString(),
      type,
      ...payload,
    };

    const line = JSON.stringify(event) + '\n';
    
    // Append to log file (may fail if disk is full, permissions issue, etc.)
    try {
      appendFileSync(LOG_FILE, line, { encoding: 'utf8' });
    } catch (writeError) {
      // Fail open: disable logging for this session if write fails
      if (logDirReady) {
        console.warn('[telemetry] Write failed, disabling telemetry for this session:', writeError);
        logDirReady = false;
      }
      return;
    }
    
    // Also log to console in dev
    if (process.env.NODE_ENV === 'development' || process.env.TELEMETRY_CONSOLE === 'true') {
      console.log(`[telemetry] ${type}:`, JSON.stringify(payload));
    }
  } catch (e) {
    // Fail open: don't let telemetry failures break the app
    // Only log warning in dev to avoid spam
    if (process.env.NODE_ENV === 'development') {
      console.warn('[telemetry] Failed to log event:', e);
    }
  }
}

// ============================================
// SQLite Database Telemetry Functions
// ============================================

/**
 * Track an execution in the SQLite database
 */
export async function trackExecution(params: {
  userAddress: string;
  draftId?: string;
  correlationId?: string;
  action: string;
  token?: string;
  amountUnits?: string;
  mode?: string;
}): Promise<string | null> {
  try {
    const db = await getDbTelemetry();
    if (!db) return null;
    const execution = db.createExecution({
      userAddress: params.userAddress,
      draftId: params.draftId,
      correlationId: params.correlationId,
      action: params.action,
      token: params.token,
      amountUnits: params.amountUnits,
      mode: params.mode,
    });
    return execution.id;
  } catch (e) {
    // Fail open
    return null;
  }
}

/**
 * Update an execution with results
 */
export async function updateExecutionResult(
  correlationId: string,
  result: {
    status: 'submitted' | 'confirmed' | 'failed';
    txHash?: string;
    errorCode?: string;
    errorMessage?: string;
    latencyMs?: number;
  }
): Promise<void> {
  try {
    const db = await getDbTelemetry();
    if (!db) return;
    db.updateExecutionByCorrelationId(correlationId, {
      status: result.status,
      txHash: result.txHash,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      latencyMs: result.latencyMs,
    });
  } catch (e) {
    // Fail open
  }
}

/**
 * Track session status
 */
export async function trackSessionStatus(
  userAddress: string,
  sessionId: string,
  status: string,
  expiresAt?: number
): Promise<void> {
  try {
    const db = await getDbTelemetry();
    if (!db) return;
    db.upsertSession(userAddress, sessionId, status, expiresAt);
  } catch (e) {
    // Fail open
  }
}

/**
 * Log a request to the database
 */
export async function logRequestToDb(params: {
  endpoint: string;
  method?: string;
  userAddress?: string;
  correlationId?: string;
  statusCode?: number;
  latencyMs?: number;
  errorCode?: string;
}): Promise<void> {
  try {
    const db = await getDbTelemetry();
    if (!db) return;
    db.logRequest(params);
  } catch (e) {
    // Fail open
  }
}

/**
 * Create a scoped logger for a specific request
 */
export function createRequestLogger(userAddress?: string, mode?: string, authMode?: string) {
  const userHash = userAddress ? hashAddress(userAddress) : undefined;
  const startTime = Date.now();

  return {
    log: (type: TelemetryEventType, payload: Partial<TelemetryPayload> = {}) => {
      logEvent(type, {
        mode: mode as TelemetryPayload['mode'],
        authMode: authMode as TelemetryPayload['authMode'],
        userHash,
        latencyMs: Date.now() - startTime,
        ...payload,
      });
    },
  };
}

