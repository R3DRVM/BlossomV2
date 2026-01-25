/**
 * RPC Provider with Failover
 *
 * Features:
 * - Multiple RPC endpoints (primary + fallbacks)
 * - Circuit breaker pattern (3 failures, 30s backoff)
 * - Automatic failover on HTTP 429 / rate limit errors
 * - Exponential backoff with jitter on retries
 * - Custom transport that wraps ALL viem RPC calls
 */
import { PublicClient, WalletClient, Chain } from 'viem';
/**
 * Initialize RPC provider with primary and fallback URLs
 */
export declare function initRpcProvider(primary: string, fallbacks?: string[]): void;
/**
 * Get all available RPC URLs in order of preference
 */
export declare function getAllRpcUrls(): string[];
/**
 * Get next available RPC URL (skipping rate-limited ones)
 */
export declare function getAvailableRpcUrl(): string | undefined;
/**
 * Get current active URL (for logging)
 */
export declare function getCurrentActiveUrl(): string | undefined;
/**
 * Execute a JSON-RPC request with automatic failover across all endpoints
 */
export declare function executeRpcWithFailover(method: string, params: any[]): Promise<any>;
/**
 * Execute an RPC call with failover (legacy function, now uses executeRpcWithFailover internally)
 */
export declare function executeWithFailover<T>(fn: (rpcUrl: string) => Promise<T>): Promise<T>;
/**
 * Create a public client with automatic failover transport
 * ALL RPC calls through this client will use failover logic
 */
export declare function createFailoverPublicClient(chain?: Chain): PublicClient;
/**
 * Create a wallet client with automatic failover transport
 * Accepts either an account address string or the full account object from privateKeyToAccount()
 */
export declare function createFailoverWalletClient(account: `0x${string}` | {
    address: `0x${string}`;
} | undefined, chain?: Chain): WalletClient;
/**
 * Get current provider health status
 */
export declare function getProviderHealthStatus(): {
    active: string | null;
    primary: {
        url: string;
        healthy: boolean;
        circuitOpen: boolean;
        rateLimitedUntil: number;
    } | null;
    fallbacks: Array<{
        url: string;
        healthy: boolean;
        circuitOpen: boolean;
        rateLimitedUntil: number;
    }>;
};
/**
 * Reset all circuit breakers (for testing/manual recovery)
 */
export declare function resetAllCircuits(): void;
/**
 * Force switch to next available endpoint (for manual failover)
 */
export declare function forceFailover(): string | undefined;
//# sourceMappingURL=rpcProvider.d.ts.map