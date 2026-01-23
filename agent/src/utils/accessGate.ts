/**
 * Access Gate for Whitelist Testing
 * Lightweight whitelist system with access codes
 */

export interface AccessCode {
  code: string;
  used: boolean;
  walletAddress?: string; // Bound to wallet on first use
  createdAt: number;
  usedAt?: number;
}

// In-memory store (for MVP - can be replaced with JSON file/DB later)
let accessCodes: Map<string, AccessCode> = new Map();

/**
 * Generate a new access code
 */
export function generateAccessCode(): string {
  // Generate 8-character alphanumeric code
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing chars
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * Create a new access code
 */
export function createAccessCode(): AccessCode {
  const code = generateAccessCode();
  const accessCode: AccessCode = {
    code,
    used: false,
    createdAt: Date.now(),
  };
  accessCodes.set(code, accessCode);
  return accessCode;
}

/**
 * Validate and use an access code
 * Returns true if code is valid and can be used
 */
export function validateAccessCode(code: string, walletAddress?: string): { valid: boolean; error?: string } {
  const accessCode = accessCodes.get(code.toUpperCase());
  
  if (!accessCode) {
    return { valid: false, error: 'Invalid access code' };
  }
  
  if (accessCode.used) {
    // If code is already used, check if it's bound to this wallet
    if (accessCode.walletAddress && accessCode.walletAddress.toLowerCase() === walletAddress?.toLowerCase()) {
      return { valid: true }; // Same wallet can reuse
    }
    return { valid: false, error: 'Access code already used' };
  }
  
  // Mark as used and bind to wallet
  accessCode.used = true;
  if (walletAddress) {
    accessCode.walletAddress = walletAddress.toLowerCase();
  }
  accessCode.usedAt = Date.now();
  
  return { valid: true };
}

/**
 * Check if a wallet has access
 */
export function hasAccess(walletAddress: string): boolean {
  const codes = Array.from(accessCodes.values());
  for (const accessCode of codes) {
    if (accessCode.used && accessCode.walletAddress?.toLowerCase() === walletAddress.toLowerCase()) {
      return true;
    }
  }
  return false;
}

/**
 * Get all access codes (admin utility)
 */
export function getAllAccessCodes(): AccessCode[] {
  return Array.from(accessCodes.values());
}

/**
 * Revoke an access code
 */
export function revokeAccessCode(code: string): boolean {
  const accessCode = accessCodes.get(code.toUpperCase());
  if (!accessCode) {
    return false;
  }
  accessCodes.delete(code.toUpperCase());
  return true;
}

/**
 * Initialize with pre-generated codes (for MVP)
 */
export function initializeAccessCodes(codes?: string[]): void {
  if (codes && codes.length > 0) {
    // Load pre-generated codes
    for (const code of codes) {
      accessCodes.set(code.toUpperCase(), {
        code: code.toUpperCase(),
        used: false,
        createdAt: Date.now(),
      });
    }
  } else {
    // Generate 30 codes for whitelist
    for (let i = 0; i < 30; i++) {
      createAccessCode();
    }
  }
}

/**
 * Load access codes from environment variable
 */
export function loadAccessCodesFromEnv(): void {
  const accessGateEnabled = process.env.ACCESS_GATE_ENABLED === "true";
  if (!accessGateEnabled) {
    console.log(`[accessGate] Access gate is disabled`);
    return;
  }

  const codesEnv = process.env.WHITELIST_ACCESS_CODES;
  if (codesEnv) {
    const codes = codesEnv.split(',').map(c => c.trim()).filter(c => c.length > 0);
    initializeAccessCodes(codes);
    console.log(`[accessGate] Loaded ${codes.length} access codes from environment`);
  } else {
    // Generate 30 codes if not provided
    initializeAccessCodes();
    console.log(`[accessGate] Generated 30 access codes`);
  }
}

/**
 * Express middleware to check access
 * If access gate is disabled, always passes
 */
export function checkAccess(req: any, res: any, next: any): void {
  const accessGateEnabled = process.env.ACCESS_GATE_ENABLED === "true";
  
  // If gate is disabled, always allow
  if (!accessGateEnabled) {
    return next();
  }

  // Get access code from header or body
  const accessCode = req.headers['x-access-code'] || req.body?.accessCode;
  const walletAddress = req.headers['x-wallet-address'] || req.body?.walletAddress;

  if (!accessCode) {
    return res.status(401).json({ 
      error: 'Access code required',
      errorCode: 'ACCESS_CODE_REQUIRED'
    });
  }

  // Validate access code
  const validation = validateAccessCode(accessCode, walletAddress);
  if (!validation.valid) {
    return res.status(401).json({ 
      error: validation.error || 'Invalid access code',
      errorCode: 'INVALID_ACCESS_CODE'
    });
  }

  // Access granted
  next();
}

