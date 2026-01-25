/**
 * Telemetry Logger
 * Writes JSON lines to logs/telemetry.jsonl for MVP observability.
 * Privacy-preserving: user addresses are hashed with TELEMETRY_SALT.
 */
import { createHash } from 'crypto';
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
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
export function hashAddress(address) {
    if (!address)
        return 'unknown';
    return createHash('sha256')
        .update(TELEMETRY_SALT + address.toLowerCase())
        .digest('hex')
        .substring(0, 16); // First 16 chars for brevity
}
/**
 * Log a telemetry event
 * Fail open: never crashes the server, silently fails if logging is unavailable
 */
export function logEvent(type, payload) {
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
/**
 * Create a scoped logger for a specific request
 */
export function createRequestLogger(userAddress, mode, authMode) {
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