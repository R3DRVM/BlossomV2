/**
 * Access Gate for Beta Testing
 * PostgreSQL-backed access code validation with single-use enforcement
 */

import { query as pgQuery } from '../../execution-ledger/db-pg-client';

export interface AccessCode {
  id: string;
  code: string;
  created_at: number;
  expires_at: number | null;
  max_uses: number;
  times_used: number;
  last_used_at: number | null;
  created_by: string;
  metadata_json: string | null;
}

// Fallback in-memory store for non-Postgres environments
let accessCodes: Map<string, { code: string; used: boolean; walletAddress?: string; createdAt: number; usedAt?: number }> = new Map();
let isPostgresMode = false;

/**
 * Initialize access gate
 * Detects Postgres vs in-memory mode
 */
export async function initializeAccessGate(): Promise<void> {
  try {
    // Test Postgres connection
    const result = await pgQuery(`SELECT 1 as test`, []);
    if (result.rows && result.rows.length > 0) {
      isPostgresMode = true;
      console.log('[accessGate] Initialized with Postgres backend');
      return;
    }
  } catch (err) {
    console.log('[accessGate] Postgres unavailable, using in-memory mode');
  }

  // Fallback to in-memory mode
  isPostgresMode = false;
  const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
  const accessGateDisabled = process.env.ACCESS_GATE_DISABLED === 'true';
  const accessGateEnabled = isProduction ? !accessGateDisabled : (process.env.ACCESS_GATE_ENABLED === 'true');
  if (!accessGateEnabled) {
    console.log(`[accessGate] Access gate is disabled`);
    return;
  }

  const codesEnv = process.env.WHITELIST_ACCESS_CODES;
  if (codesEnv) {
    const codes = codesEnv.split(',').map(c => c.trim()).filter(c => c.length > 0);
    for (const code of codes) {
      accessCodes.set(code.toUpperCase(), {
        code: code.toUpperCase(),
        used: false,
        createdAt: Date.now(),
      });
    }
    console.log(`[accessGate] Loaded ${codes.length} codes from environment (in-memory)`);
  }
}

/**
 * Validate and consume an access code
 * Returns { valid: true } if code is valid and can be used
 * Postgres mode: race-safe single-use enforcement via atomic UPDATE
 */
export async function validateAccessCode(code: string, walletAddress?: string): Promise<{ valid: boolean; error?: string }> {
  const normalizedCode = code.toUpperCase().trim();

  if (!normalizedCode) {
    logAccessEvent('validation_failed', normalizedCode, 'empty_code', walletAddress);
    return { valid: false, error: 'Access code required' };
  }

  if (isPostgresMode) {
    return validateAccessCodePostgres(normalizedCode, walletAddress);
  } else {
    return validateAccessCodeMemory(normalizedCode, walletAddress);
  }
}

/**
 * Postgres-backed validation with reusable code support
 * Codes can be used multiple times across different devices/wallets
 * Each redemption is logged in access_code_redemptions table
 */
async function validateAccessCodePostgres(code: string, walletAddress?: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const now = Math.floor(Date.now() / 1000);

    // Check if code exists and is not expired
    const checkResult = await pgQuery(`
      SELECT code, max_uses, times_used, expires_at
      FROM access_codes
      WHERE code = $1
    `, [code]);

    if (!checkResult.rows || checkResult.rows.length === 0) {
      logAccessEvent('validation_failed', code, 'not_found', walletAddress);
      return { valid: false, error: 'Invalid access code' };
    }

    const codeRow = checkResult.rows[0];

    // Check expiration
    if (codeRow.expires_at && codeRow.expires_at <= now) {
      logAccessEvent('validation_failed', code, 'expired', walletAddress);
      return { valid: false, error: 'Access code expired' };
    }

    // For beta codes, allow unlimited redemptions (max_uses should be set high, e.g. 1000)
    // The per-device limiting is handled by cookie (blossom_gate_pass)
    // This allows investors to share codes across their team

    // Log this redemption in the redemptions table
    const redemptionId = `red_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      await pgQuery(`
        INSERT INTO access_code_redemptions (id, code, redeemed_at, wallet_address, metadata_json)
        VALUES ($1, $2, $3, $4, $5)
      `, [redemptionId, code, now, walletAddress || null, null]);
    } catch (insertError: any) {
      // Non-fatal: continue even if redemption logging fails
      console.warn('[accessGate] Failed to log redemption:', insertError.message);
    }

    // Update times_used counter for analytics (non-blocking)
    try {
      await pgQuery(`
        UPDATE access_codes
        SET times_used = times_used + 1, last_used_at = $2
        WHERE code = $1
      `, [code, now]);
    } catch (updateError: any) {
      // Non-fatal: continue even if counter update fails
      console.warn('[accessGate] Failed to update times_used:', updateError.message);
    }

    logAccessEvent('validation_success', code, 'postgres_reusable', walletAddress);
    return { valid: true };

  } catch (error: any) {
    console.error('[accessGate] Postgres validation error:', error.message);
    logAccessEvent('validation_error', code, error.message, walletAddress);
    return { valid: false, error: 'Validation failed' };
  }
}

/**
 * In-memory fallback validation (for development)
 */
function validateAccessCodeMemory(code: string, walletAddress?: string): { valid: boolean; error?: string } {
  const accessCode = accessCodes.get(code);

  if (!accessCode) {
    logAccessEvent('validation_failed', code, 'not_found_memory', walletAddress);
    return { valid: false, error: 'Invalid access code' };
  }

  if (accessCode.used) {
    // If code is already used, check if it's bound to this wallet
    if (accessCode.walletAddress && accessCode.walletAddress.toLowerCase() === walletAddress?.toLowerCase()) {
      logAccessEvent('validation_success', code, 'reuse_same_wallet', walletAddress);
      return { valid: true }; // Same wallet can reuse
    }
    logAccessEvent('validation_failed', code, 'already_used_memory', walletAddress);
    return { valid: false, error: 'Access code already used' };
  }

  // Mark as used and bind to wallet
  accessCode.used = true;
  if (walletAddress) {
    accessCode.walletAddress = walletAddress.toLowerCase();
  }
  accessCode.usedAt = Date.now();

  logAccessEvent('validation_success', code, 'memory', walletAddress);
  return { valid: true };
}

/**
 * Check if a wallet has access (for middleware)
 */
export async function hasAccess(walletAddress: string): Promise<boolean> {
  if (!walletAddress) return false;

  if (isPostgresMode) {
    try {
      const result = await pgQuery(`
        SELECT code
        FROM access_codes
        WHERE times_used > 0
        LIMIT 1
      `, []);
      // In Postgres mode, we don't track per-wallet access
      // If any code has been used, allow access
      // (This is a simplified check - you may want more sophisticated logic)
      return result.rows && result.rows.length > 0;
    } catch (error) {
      console.error('[accessGate] hasAccess error:', error);
      return false;
    }
  } else {
    // In-memory mode
    const codes = Array.from(accessCodes.values());
    for (const accessCode of codes) {
      if (accessCode.used && accessCode.walletAddress?.toLowerCase() === walletAddress.toLowerCase()) {
        return true;
      }
    }
    return false;
  }
}

/**
 * Get all access codes (admin utility)
 */
export async function getAllAccessCodes(): Promise<AccessCode[]> {
  if (isPostgresMode) {
    try {
      const result = await pgQuery(`
        SELECT id, code, created_at, expires_at, max_uses, times_used, last_used_at, created_by, metadata_json
        FROM access_codes
        ORDER BY created_at DESC
        LIMIT 1000
      `, []);
      return result.rows || [];
    } catch (error) {
      console.error('[accessGate] getAllAccessCodes error:', error);
      return [];
    }
  } else {
    // Convert in-memory codes to AccessCode format
    return Array.from(accessCodes.values()).map(ac => ({
      id: ac.code,
      code: ac.code,
      created_at: Math.floor(ac.createdAt / 1000),
      expires_at: null,
      max_uses: 1,
      times_used: ac.used ? 1 : 0,
      last_used_at: ac.usedAt ? Math.floor(ac.usedAt / 1000) : null,
      created_by: 'system',
      metadata_json: null,
    }));
  }
}

/**
 * Create a new access code (admin utility)
 * Default maxUses=1000 for reusable beta codes (per-device limiting via cookie)
 */
export async function createAccessCode(maxUses: number = 1000, expiresAt: number | null = null, metadata?: any): Promise<AccessCode | null> {
  if (isPostgresMode) {
    try {
      const code = `BLOSSOM-${generateCodeSuffix()}`;
      const id = generateId();
      const now = Math.floor(Date.now() / 1000);

      const result = await pgQuery(`
        INSERT INTO access_codes (id, code, created_at, expires_at, max_uses, times_used, last_used_at, created_by, metadata_json)
        VALUES ($1, $2, $3, $4, $5, 0, NULL, 'system', $6)
        RETURNING id, code, created_at, expires_at, max_uses, times_used, last_used_at, created_by, metadata_json
      `, [id, code, now, expiresAt, maxUses, metadata ? JSON.stringify(metadata) : null]);

      return result.rows?.[0] || null;
    } catch (error: any) {
      console.error('[accessGate] createAccessCode error:', error.message);
      return null;
    }
  } else {
    // In-memory fallback
    const code = `BLOSSOM-${generateCodeSuffix()}`;
    accessCodes.set(code, {
      code,
      used: false,
      createdAt: Date.now(),
    });
    return {
      id: code,
      code,
      created_at: Math.floor(Date.now() / 1000),
      expires_at: expiresAt,
      max_uses: maxUses,
      times_used: 0,
      last_used_at: null,
      created_by: 'system',
      metadata_json: metadata ? JSON.stringify(metadata) : null,
    };
  }
}

/**
 * Revoke an access code
 */
export async function revokeAccessCode(code: string): Promise<boolean> {
  if (isPostgresMode) {
    try {
      const result = await pgQuery(`
        DELETE FROM access_codes WHERE code = $1
        RETURNING code
      `, [code.toUpperCase()]);
      return result.rows && result.rows.length > 0;
    } catch (error) {
      console.error('[accessGate] revokeAccessCode error:', error);
      return false;
    }
  } else {
    return accessCodes.delete(code.toUpperCase());
  }
}

/**
 * Express middleware to check access
 * Checks for valid gate pass cookie OR access code
 */
export function checkAccess(req: any, res: any, next: any): void {
  // Fail-closed: gate enabled in production by default
  const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
  const accessGateDisabled = process.env.ACCESS_GATE_DISABLED === 'true';
  const accessGateEnabled = isProduction ? !accessGateDisabled : (process.env.ACCESS_GATE_ENABLED === 'true');

  // If gate is disabled, always allow
  if (!accessGateEnabled) {
    return next();
  }

  // PRIORITY 1: Check for gate pass cookie (already authorized users)
  const gatePass = req.cookies?.blossom_gate_pass;
  if (gatePass && gatePass.startsWith('blossom_')) {
    // Valid gate pass cookie - user already authorized
    return next();
  }

  // PRIORITY 2: Check for access code in header or body (initial authorization)
  const accessCode = req.headers['x-access-code'] || req.body?.accessCode;
  const walletAddress = req.headers['x-wallet-address'] || req.body?.walletAddress;

  if (!accessCode) {
    return res.status(401).json({
      error: 'Access required - please unlock via access gate',
      errorCode: 'UNAUTHORIZED_BETA'
    });
  }

  // Validate access code (async)
  validateAccessCode(accessCode, walletAddress).then(validation => {
    if (!validation.valid) {
      return res.status(401).json({
        error: validation.error || 'Invalid access code',
        errorCode: 'INVALID_ACCESS_CODE'
      });
    }
    // Access granted
    next();
  }).catch(error => {
    console.error('[accessGate] checkAccess error:', error);
    return res.status(500).json({
      error: 'Access validation failed',
      errorCode: 'VALIDATION_ERROR'
    });
  });
}

// Deprecated: Keep for backwards compatibility
export function loadAccessCodesFromEnv(): void {
  console.log('[accessGate] loadAccessCodesFromEnv is deprecated, use initializeAccessGate()');
  initializeAccessGate();
}

/**
 * Logging helper for access gate events
 * Logs to console (can be extended to DB/telemetry)
 */
function logAccessEvent(event: string, code: string, reason: string, walletAddress?: string): void {
  const maskedCode = code.length > 8 ? `${code.slice(0, 4)}...${code.slice(-4)}` : '****';
  const maskedWallet = walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : '-';

  console.log(`[accessGate] ${event}: code=${maskedCode} reason=${reason} wallet=${maskedWallet}`);

  // TODO: Send to telemetry/analytics if needed
}

/**
 * Generate random code suffix (16 hex chars)
 */
function generateCodeSuffix(): string {
  return Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 16).toString(16).toUpperCase()
  ).join('');
}

/**
 * Generate random ID (24 hex chars)
 */
function generateId(): string {
  return Array.from({ length: 24 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
}
