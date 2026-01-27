/**
 * Access Gate for Beta Testing
 * PostgreSQL-backed access code validation with single-use enforcement
 */
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
/**
 * Initialize access gate
 * Detects Postgres vs in-memory mode
 */
export declare function initializeAccessGate(): Promise<void>;
/**
 * Validate and consume an access code
 * Returns { valid: true } if code is valid and can be used
 * Postgres mode: race-safe single-use enforcement via atomic UPDATE
 */
export declare function validateAccessCode(code: string, walletAddress?: string): Promise<{
    valid: boolean;
    error?: string;
}>;
/**
 * Check if a wallet has access (for middleware)
 */
export declare function hasAccess(walletAddress: string): Promise<boolean>;
/**
 * Get all access codes (admin utility)
 */
export declare function getAllAccessCodes(): Promise<AccessCode[]>;
/**
 * Create a new access code (admin utility)
 * Default maxUses=1000 for reusable beta codes (per-device limiting via cookie)
 */
export declare function createAccessCode(maxUses?: number, expiresAt?: number | null, metadata?: any): Promise<AccessCode | null>;
/**
 * Revoke an access code
 */
export declare function revokeAccessCode(code: string): Promise<boolean>;
/**
 * Express middleware to check access
 * Checks for valid gate pass cookie OR access code
 */
export declare function checkAccess(req: any, res: any, next: any): void;
export declare function loadAccessCodesFromEnv(): void;
//# sourceMappingURL=accessGate.d.ts.map