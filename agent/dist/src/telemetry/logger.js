"use strict";
/**
 * Telemetry Logger
 * Writes JSON lines to logs/telemetry.jsonl for MVP observability.
 * Also writes to SQLite database for structured queries.
 * Privacy-preserving: user addresses are hashed with TELEMETRY_SALT.
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashAddress = hashAddress;
exports.logEvent = logEvent;
exports.trackExecution = trackExecution;
exports.updateExecutionResult = updateExecutionResult;
exports.trackSessionStatus = trackSessionStatus;
exports.logRequestToDb = logRequestToDb;
exports.createRequestLogger = createRequestLogger;
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = require("path");
const url_1 = require("url");
// Import DB telemetry (lazy loaded to avoid circular deps)
let dbTelemetry = null;
let dbLoadAttempted = false;
async function getDbTelemetry() {
    if (dbLoadAttempted)
        return dbTelemetry;
    dbLoadAttempted = true;
    try {
        dbTelemetry = await Promise.resolve().then(() => __importStar(require('../../telemetry/db')));
        dbTelemetry.initDatabase();
    }
    catch (e) {
        console.warn('[telemetry] SQLite DB not available:', e.message);
        dbTelemetry = null;
    }
    return dbTelemetry;
}
// ESM-safe __dirname equivalent
const __filename = (0, url_1.fileURLToPath)(import.meta.url);
const __dirname = (0, path_1.dirname)(__filename);
// Log file path (repo-relative: agent/src/telemetry -> agent/logs)
const LOG_DIR = (0, path_1.join)(__dirname, '../../logs');
const LOG_FILE = (0, path_1.join)(LOG_DIR, 'telemetry.jsonl');
// Ensure log directory exists (fail open - never crash server)
let logDirReady = false;
try {
    if (!(0, fs_1.existsSync)(LOG_DIR)) {
        (0, fs_1.mkdirSync)(LOG_DIR, { recursive: true });
    }
    logDirReady = true;
}
catch (e) {
    console.warn('[telemetry] Could not create log directory (telemetry disabled):', e);
    logDirReady = false;
}
// Salt for hashing user addresses (from env or default)
const TELEMETRY_SALT = process.env.TELEMETRY_SALT || 'blossom-mvp-default-salt';
/**
 * Hash a user address for privacy
 */
function hashAddress(address) {
    if (!address)
        return 'unknown';
    return (0, crypto_1.createHash)('sha256')
        .update(TELEMETRY_SALT + address.toLowerCase())
        .digest('hex')
        .substring(0, 16); // First 16 chars for brevity
}
/**
 * Log a telemetry event
 * Fail open: never crashes the server, silently fails if logging is unavailable
 */
function logEvent(type, payload) {
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
            (0, fs_1.appendFileSync)(LOG_FILE, line, { encoding: 'utf8' });
        }
        catch (writeError) {
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
    }
    catch (e) {
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
async function trackExecution(params) {
    try {
        const db = await getDbTelemetry();
        if (!db)
            return null;
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
    }
    catch (e) {
        // Fail open
        return null;
    }
}
/**
 * Update an execution with results
 */
async function updateExecutionResult(correlationId, result) {
    try {
        const db = await getDbTelemetry();
        if (!db)
            return;
        db.updateExecutionByCorrelationId(correlationId, {
            status: result.status,
            txHash: result.txHash,
            errorCode: result.errorCode,
            errorMessage: result.errorMessage,
            latencyMs: result.latencyMs,
        });
    }
    catch (e) {
        // Fail open
    }
}
/**
 * Track session status
 */
async function trackSessionStatus(userAddress, sessionId, status, expiresAt) {
    try {
        const db = await getDbTelemetry();
        if (!db)
            return;
        db.upsertSession(userAddress, sessionId, status, expiresAt);
    }
    catch (e) {
        // Fail open
    }
}
/**
 * Log a request to the database
 */
async function logRequestToDb(params) {
    try {
        const db = await getDbTelemetry();
        if (!db)
            return;
        db.logRequest(params);
    }
    catch (e) {
        // Fail open
    }
}
/**
 * Create a scoped logger for a specific request
 */
function createRequestLogger(userAddress, mode, authMode) {
    const userHash = userAddress ? hashAddress(userAddress) : undefined;
    const startTime = Date.now();
    return {
        log: (type, payload = {}) => {
            logEvent(type, {
                mode: mode,
                authMode: authMode,
                userHash,
                latencyMs: Date.now() - startTime,
                ...payload,
            });
        },
    };
}
//# sourceMappingURL=logger.js.map