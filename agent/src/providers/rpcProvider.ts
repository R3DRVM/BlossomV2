/**
 * RPC Provider with Failover
 *
 * Features:
 * - Multiple RPC endpoints (primary + fallbacks)
 * - Circuit breaker pattern (3 failures, 30s backoff)
 * - Automatic failover on error
 * - Health tracking per endpoint
 */

import { createPublicClient, createWalletClient, http, PublicClient, WalletClient, Chain, HttpTransportConfig } from 'viem';
import { sepolia } from 'viem/chains';

// Circuit breaker state per endpoint
interface CircuitState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
}

// Provider health tracking
interface ProviderHealth {
  url: string;
  isHealthy: boolean;
  lastCheck: number;
  circuit: CircuitState;
}

// Configuration
const CIRCUIT_BREAKER_THRESHOLD = 3; // Failures before circuit opens
const CIRCUIT_BREAKER_RESET_MS = 30_000; // 30 seconds backoff
const REQUEST_TIMEOUT_MS = 10_000; // 10 seconds per request

// Singleton state
const providerHealth: Map<string, ProviderHealth> = new Map();
let primaryUrl: string | undefined;
let fallbackUrls: string[] = [];

/**
 * Initialize RPC provider with primary and fallback URLs
 */
export function initRpcProvider(primary: string, fallbacks: string[] = []): void {
  primaryUrl = primary;
  fallbackUrls = fallbacks;

  // Initialize health tracking for all endpoints
  const allUrls = [primary, ...fallbacks];
  for (const url of allUrls) {
    if (!providerHealth.has(url)) {
      providerHealth.set(url, {
        url,
        isHealthy: true,
        lastCheck: Date.now(),
        circuit: {
          failures: 0,
          lastFailure: 0,
          isOpen: false,
        },
      });
    }
  }

  console.log(`[rpc-provider] Initialized with ${allUrls.length} endpoint(s)`);
  console.log(`[rpc-provider] Primary: ${maskUrl(primary)}`);
  if (fallbacks.length > 0) {
    console.log(`[rpc-provider] Fallbacks: ${fallbacks.map(maskUrl).join(', ')}`);
  }
}

/**
 * Mask URL for logging (hide API keys)
 */
function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Mask path if it looks like an API key
    if (parsed.pathname.length > 20) {
      parsed.pathname = parsed.pathname.substring(0, 10) + '...[masked]';
    }
    // Mask query params
    parsed.search = '';
    return parsed.toString();
  } catch {
    return url.substring(0, 30) + '...';
  }
}

/**
 * Check if circuit breaker should allow requests
 */
function isCircuitClosed(health: ProviderHealth): boolean {
  const circuit = health.circuit;

  // If circuit is open, check if enough time has passed
  if (circuit.isOpen) {
    const elapsed = Date.now() - circuit.lastFailure;
    if (elapsed >= CIRCUIT_BREAKER_RESET_MS) {
      // Allow retry (half-open state)
      circuit.isOpen = false;
      circuit.failures = 0;
      console.log(`[rpc-provider] Circuit reset for ${maskUrl(health.url)}`);
      return true;
    }
    return false;
  }

  return true;
}

/**
 * Record a failure for an endpoint
 */
function recordFailure(url: string, error: Error): void {
  const health = providerHealth.get(url);
  if (!health) return;

  health.circuit.failures++;
  health.circuit.lastFailure = Date.now();
  health.isHealthy = false;

  if (health.circuit.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    health.circuit.isOpen = true;
    console.log(`[rpc-provider] Circuit OPEN for ${maskUrl(url)} after ${health.circuit.failures} failures: ${error.message}`);
  } else {
    console.log(`[rpc-provider] Failure ${health.circuit.failures}/${CIRCUIT_BREAKER_THRESHOLD} for ${maskUrl(url)}: ${error.message}`);
  }
}

/**
 * Record a success for an endpoint
 */
function recordSuccess(url: string): void {
  const health = providerHealth.get(url);
  if (!health) return;

  health.circuit.failures = 0;
  health.circuit.isOpen = false;
  health.isHealthy = true;
  health.lastCheck = Date.now();
}

/**
 * Get next available RPC URL
 */
export function getAvailableRpcUrl(): string | undefined {
  const allUrls = [primaryUrl, ...fallbackUrls].filter(Boolean) as string[];

  // Try to find a healthy endpoint
  for (const url of allUrls) {
    const health = providerHealth.get(url);
    if (health && isCircuitClosed(health)) {
      return url;
    }
  }

  // If all circuits are open, try primary anyway (last resort)
  if (primaryUrl) {
    console.log(`[rpc-provider] All circuits open, trying primary as last resort`);
    return primaryUrl;
  }

  return undefined;
}

/**
 * Execute an RPC call with failover
 */
export async function executeWithFailover<T>(
  fn: (rpcUrl: string) => Promise<T>
): Promise<T> {
  const allUrls = [primaryUrl, ...fallbackUrls].filter(Boolean) as string[];
  let lastError: Error | undefined;

  for (const url of allUrls) {
    const health = providerHealth.get(url);

    // Skip if circuit is open
    if (health && !isCircuitClosed(health)) {
      continue;
    }

    try {
      const result = await fn(url);
      recordSuccess(url);
      return result;
    } catch (error) {
      lastError = error as Error;
      recordFailure(url, lastError);
      // Continue to next endpoint
    }
  }

  // All endpoints failed
  throw lastError || new Error('No RPC endpoints available');
}

/**
 * Create a public client with failover
 * Returns a client connected to the best available endpoint
 */
export function createFailoverPublicClient(chain: Chain = sepolia): PublicClient {
  const rpcUrl = getAvailableRpcUrl();

  if (!rpcUrl) {
    throw new Error('No RPC endpoints available');
  }

  const transportConfig: HttpTransportConfig = {
    timeout: REQUEST_TIMEOUT_MS,
    retryCount: 1,
    retryDelay: 1000,
  };

  return createPublicClient({
    chain,
    transport: http(rpcUrl, transportConfig),
  });
}

/**
 * Create a wallet client with failover
 */
export function createFailoverWalletClient(
  account: `0x${string}` | undefined,
  chain: Chain = sepolia
): WalletClient {
  const rpcUrl = getAvailableRpcUrl();

  if (!rpcUrl) {
    throw new Error('No RPC endpoints available');
  }

  const transportConfig: HttpTransportConfig = {
    timeout: REQUEST_TIMEOUT_MS,
    retryCount: 1,
    retryDelay: 1000,
  };

  return createWalletClient({
    account,
    chain,
    transport: http(rpcUrl, transportConfig),
  });
}

/**
 * Get current provider health status
 */
export function getProviderHealthStatus(): {
  primary: { url: string; healthy: boolean; circuitOpen: boolean } | null;
  fallbacks: Array<{ url: string; healthy: boolean; circuitOpen: boolean }>;
} {
  const status = {
    primary: null as { url: string; healthy: boolean; circuitOpen: boolean } | null,
    fallbacks: [] as Array<{ url: string; healthy: boolean; circuitOpen: boolean }>,
  };

  if (primaryUrl) {
    const health = providerHealth.get(primaryUrl);
    status.primary = {
      url: maskUrl(primaryUrl),
      healthy: health?.isHealthy ?? false,
      circuitOpen: health?.circuit.isOpen ?? false,
    };
  }

  for (const url of fallbackUrls) {
    const health = providerHealth.get(url);
    status.fallbacks.push({
      url: maskUrl(url),
      healthy: health?.isHealthy ?? false,
      circuitOpen: health?.circuit.isOpen ?? false,
    });
  }

  return status;
}

/**
 * Reset all circuit breakers (for testing/manual recovery)
 */
export function resetAllCircuits(): void {
  for (const health of providerHealth.values()) {
    health.circuit.failures = 0;
    health.circuit.isOpen = false;
    health.isHealthy = true;
  }
  console.log('[rpc-provider] All circuits reset');
}
