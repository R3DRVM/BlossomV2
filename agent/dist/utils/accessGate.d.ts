/**
 * Access Gate for Whitelist Testing
 * Lightweight whitelist system with access codes
 */
export interface AccessCode {
    code: string;
    used: boolean;
    walletAddress?: string;
    createdAt: number;
    usedAt?: number;
}
/**
 * Generate a new access code
 */
export declare function generateAccessCode(): string;
/**
 * Create a new access code
 */
export declare function createAccessCode(): AccessCode;
/**
 * Validate and use an access code
 * Returns true if code is valid and can be used
 */
export declare function validateAccessCode(code: string, walletAddress?: string): {
    valid: boolean;
    error?: string;
};
/**
 * Check if a wallet has access
 */
export declare function hasAccess(walletAddress: string): boolean;
/**
 * Get all access codes (admin utility)
 */
export declare function getAllAccessCodes(): AccessCode[];
/**
 * Revoke an access code
 */
export declare function revokeAccessCode(code: string): boolean;
/**
 * Initialize with pre-generated codes (for MVP)
 */
export declare function initializeAccessCodes(codes?: string[]): void;
/**
 * Load access codes from environment variable
 */
export declare function loadAccessCodesFromEnv(): void;
/**
 * Express middleware to check access
 * If access gate is disabled, always passes
 */
export declare function checkAccess(req: any, res: any, next: any): void;
//# sourceMappingURL=accessGate.d.ts.map