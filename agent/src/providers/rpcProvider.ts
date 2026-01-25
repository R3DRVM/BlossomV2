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

import { createPublicClient, createWalletClient, http, PublicClient, WalletClient, Chain, custom, EIP1193RequestFn } from 'viem';
import { sepolia } from 'viem/chains';

// Circuit breaker state per endpoint
interface CircuitState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
  rateLimitedUntil: number; // Timestamp when rate limit expires
}

// Provider health tracking
interface ProviderHealth {
  url: string;
  isHealthy: boolean;
  lastCheck: number;
  circuit: CircuitState;
}

// Configuration
const CIRCUIT_BREAKER_THRESHOLD = 2; // Failures before circuit opens (reduced for faster failover)
const CIRCUIT_BREAKER_RESET_MS = 30_000; // 30 seconds backoff
const REQUEST_TIMEOUT_MS = 15_000; // 15 seconds per request
const MAX_RETRIES_PER_ENDPOINT = 1; // Retries before moving to next endpoint
const BASE_BACKOFF_MS = 500; // Base backoff for exponential retry
const MAX_BACKOFF_MS = 5_000; // Max backoff cap
const RATE_LIMIT_BACKOFF_MS = 60_000; // 60 seconds backoff for rate-limited endpoints

// Singleton state
const providerHealth: Map<string, ProviderHealth> = new Map();
let primaryUrl: string | undefined;
let fallbackUrls: string[] = [];
let currentActiveUrl: string | undefined;

/**
 * Initialize RPC provider with primary and fallback URLs
 */
export function initRpcProvider(primary: string, fallbacks: string[] = []): void {
  primaryUrl = primary;
  fallbackUrls = fallbacks;
  currentActiveUrl = primary;

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
          rateLimitedUntil: 0,
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
 * Check if error is a rate limit (429) error
 */
function isRateLimitError(error: any): boolean {
  const message = error?.message?.toLowerCase() || '';
  const details = error?.details?.toLowerCase() || '';
  const shortMessage = error?.shortMessage?.toLowerCase() || '';

  return (
    message.includes('429') ||
    message.includes('too many requests') ||
    message.includes('rate limit') ||
    message.includes('rate-limit') ||
    details.includes('429') ||
    details.includes('too many requests') ||
    details.includes('rate limit') ||
    shortMessage.includes('429') ||
    shortMessage.includes('rate limit') ||
    error?.status === 429
  );
}

/**
 * Check if error is retriable (network issues, timeouts, etc.)
 */
function isRetriableError(error: any): boolean {
  if (isRateLimitError(error)) return true;

  const message = error?.message?.toLowerCase() || '';
  return (
    message.includes('timeout') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('network') ||
    message.includes('fetch failed') ||
    message.includes('socket') ||
    message.includes('503') ||
    message.includes('502') ||
    message.includes('500')
  );
}

/**
 * Calculate exponential backoff with jitter
 */
function calculateBackoff(attempt: number): number {
  const exponential = Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
  const jitter = Math.random() * 0.3 * exponential; // 0-30% jitter
  return Math.floor(exponential + jitter);
}

/**
 * Sleep for given milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if circuit breaker should allow requests
 */
function isCircuitClosed(health: ProviderHealth): boolean {
  const circuit = health.circuit;
  const now = Date.now();

  // Check rate limit first
  if (circuit.rateLimitedUntil > now) {
    return false;
  }

  // If circuit is open, check if enough time has passed
  if (circuit.isOpen) {
    const elapsed = now - circuit.lastFailure;
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
function recordFailure(url: string, error: Error, isRateLimit: boolean = false): void {
  const health = providerHealth.get(url);
  if (!health) return;

  health.circuit.failures++;
  health.circuit.lastFailure = Date.now();
  health.isHealthy = false;

  // If rate limited, set longer backoff
  if (isRateLimit) {
    health.circuit.rateLimitedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
    health.circuit.isOpen = true;
    console.log(`[rpc-provider] Rate limited! Circuit OPEN for ${maskUrl(url)} for ${RATE_LIMIT_BACKOFF_MS / 1000}s`);
  } else if (health.circuit.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    health.circuit.isOpen = true;
    console.log(`[rpc-provider] Circuit OPEN for ${maskUrl(url)} after ${health.circuit.failures} failures: ${error.message?.slice(0, 100)}`);
  } else {
    console.log(`[rpc-provider] Failure ${health.circuit.failures}/${CIRCUIT_BREAKER_THRESHOLD} for ${maskUrl(url)}: ${error.message?.slice(0, 100)}`);
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
 * Get all available RPC URLs in order of preference
 */
export function getAllRpcUrls(): string[] {
  ensureInitialized();
  return [primaryUrl, ...fallbackUrls].filter(Boolean) as string[];
}

/**
 * Get next available RPC URL (skipping rate-limited ones)
 */
export function getAvailableRpcUrl(): string | undefined {
  const allUrls = getAllRpcUrls();

  // Try to find a healthy endpoint
  for (const url of allUrls) {
    const health = providerHealth.get(url);
    if (health && isCircuitClosed(health)) {
      currentActiveUrl = url;
      return url;
    }
  }

  // If all circuits are open, try primary anyway (last resort)
  if (primaryUrl) {
    console.log(`[rpc-provider] All circuits open, trying primary as last resort`);
    currentActiveUrl = primaryUrl;
    return primaryUrl;
  }

  return undefined;
}

/**
 * Get current active URL (for logging)
 */
export function getCurrentActiveUrl(): string | undefined {
  return currentActiveUrl;
}

/**
 * Make a single JSON-RPC request to a specific URL
 */
async function makeRpcRequest(url: string, body: any): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 429) {
      const error = new Error(`HTTP 429: Too Many Requests from ${maskUrl(url)}`);
      (error as any).status = 429;
      throw error;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => 'Unknown error');
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    const json = await response.json();

    // Check for JSON-RPC error
    if (json.error) {
      const rpcError = new Error(json.error.message || 'RPC Error');
      (rpcError as any).code = json.error.code;
      throw rpcError;
    }

    return json.result;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${REQUEST_TIMEOUT_MS}ms to ${maskUrl(url)}`);
    }
    throw error;
  }
}

/**
 * Execute a JSON-RPC request with automatic failover across all endpoints
 */
export async function executeRpcWithFailover(
  method: string,
  params: any[]
): Promise<any> {
  const allUrls = getAllRpcUrls();
  let lastError: Error | undefined;
  let attemptCount = 0;

  for (const url of allUrls) {
    const health = providerHealth.get(url);

    // Skip if circuit is open (unless it's the only option)
    if (health && !isCircuitClosed(health)) {
      continue;
    }

    // Try this endpoint with retries
    for (let retry = 0; retry <= MAX_RETRIES_PER_ENDPOINT; retry++) {
      attemptCount++;

      try {
        const body = {
          jsonrpc: '2.0',
          id: Date.now(),
          method,
          params,
        };

        const result = await makeRpcRequest(url, body);
        recordSuccess(url);
        currentActiveUrl = url;

        if (attemptCount > 1) {
          console.log(`[rpc-provider] Success on attempt ${attemptCount} via ${maskUrl(url)}`);
        }

        return result;
      } catch (error: any) {
        lastError = error;
        const isRateLimit = isRateLimitError(error);

        if (isRateLimit) {
          // Rate limit - record failure and immediately try next endpoint
          recordFailure(url, error, true);
          console.log(`[rpc-provider] Rate limited on ${maskUrl(url)}, switching to next endpoint...`);
          break; // Exit retry loop, move to next endpoint
        }

        if (isRetriableError(error) && retry < MAX_RETRIES_PER_ENDPOINT) {
          // Retriable error - backoff and retry same endpoint
          const backoff = calculateBackoff(retry);
          console.log(`[rpc-provider] Retry ${retry + 1}/${MAX_RETRIES_PER_ENDPOINT} for ${maskUrl(url)} after ${backoff}ms...`);
          await sleep(backoff);
          continue;
        }

        // Non-retriable or max retries reached
        recordFailure(url, error, false);
        break; // Move to next endpoint
      }
    }
  }

  // All endpoints failed
  throw lastError || new Error('No RPC endpoints available');
}

/**
 * Create a custom transport that routes all requests through failover logic
 */
function createFailoverTransport() {
  const request: EIP1193RequestFn = async ({ method, params }) => {
    return executeRpcWithFailover(method, params as any[]);
  };

  return custom({ request });
}

/**
 * Execute an RPC call with failover (legacy function, now uses executeRpcWithFailover internally)
 */
export async function executeWithFailover<T>(
  fn: (rpcUrl: string) => Promise<T>
): Promise<T> {
  const allUrls = getAllRpcUrls();
  let lastError: Error | undefined;

  for (const url of allUrls) {
    const health = providerHealth.get(url);

    // Skip if circuit is open
    if (health && !isCircuitClosed(health)) {
      continue;
    }

    for (let retry = 0; retry <= MAX_RETRIES_PER_ENDPOINT; retry++) {
      try {
        const result = await fn(url);
        recordSuccess(url);
        return result;
      } catch (error: any) {
        lastError = error;
        const isRateLimit = isRateLimitError(error);

        if (isRateLimit) {
          recordFailure(url, error, true);
          break; // Move to next endpoint
        }

        if (isRetriableError(error) && retry < MAX_RETRIES_PER_ENDPOINT) {
          const backoff = calculateBackoff(retry);
          await sleep(backoff);
          continue;
        }

        recordFailure(url, error, false);
        break;
      }
    }
  }

  throw lastError || new Error('No RPC endpoints available');
}

/**
 * Auto-initialize from environment if not already initialized
 */
function ensureInitialized(): void {
  if (primaryUrl) return;

  // Try to initialize from environment
  const primary = process.env.ETH_TESTNET_RPC_URL;
  if (!primary) {
    throw new Error('RPC provider not initialized and ETH_TESTNET_RPC_URL not set');
  }

  // Collect fallbacks
  const fallbacks: string[] = [];

  // Check explicit fallback list
  if (process.env.ETH_RPC_FALLBACK_URLS) {
    fallbacks.push(...process.env.ETH_RPC_FALLBACK_URLS.split(',').map(u => u.trim()).filter(Boolean));
  }

  // Add individual provider URLs if not primary
  if (process.env.ALCHEMY_RPC_URL && !primary.includes('alchemy')) {
    fallbacks.push(process.env.ALCHEMY_RPC_URL);
  }
  if (process.env.INFURA_RPC_URL && !primary.includes('infura')) {
    fallbacks.push(process.env.INFURA_RPC_URL);
  }

  // Add public RPCs as last resort (multiple for redundancy)
  const publicRpcs = [
    'https://ethereum-sepolia-rpc.publicnode.com',
    'https://1rpc.io/sepolia',
    'https://rpc.sepolia.org',
  ];

  for (const rpc of publicRpcs) {
    if (!fallbacks.some(u => u.includes(new URL(rpc).hostname))) {
      fallbacks.push(rpc);
    }
  }

  // Dedupe and filter out primary
  const uniqueFallbacks = [...new Set(fallbacks)].filter(u => u !== primary && u.length > 0);

  console.log('[rpc-provider] Auto-initializing from environment...');
  initRpcProvider(primary, uniqueFallbacks);
}

/**
 * Create a public client with automatic failover transport
 * ALL RPC calls through this client will use failover logic
 */
export function createFailoverPublicClient(chain: Chain = sepolia): PublicClient {
  ensureInitialized();

  return createPublicClient({
    chain,
    transport: createFailoverTransport(),
  }) as PublicClient;
}

/**
 * Create a wallet client with automatic failover transport
 * Accepts either an account address string or the full account object from privateKeyToAccount()
 */
export function createFailoverWalletClient(
  account: `0x${string}` | { address: `0x${string}` } | undefined,
  chain: Chain = sepolia
): WalletClient {
  ensureInitialized();

  return createWalletClient({
    account: account as any,
    chain,
    transport: createFailoverTransport(),
  }) as WalletClient;
}

/**
 * Get current provider health status
 */
export function getProviderHealthStatus(): {
  active: string | null;
  primary: { url: string; healthy: boolean; circuitOpen: boolean; rateLimitedUntil: number } | null;
  fallbacks: Array<{ url: string; healthy: boolean; circuitOpen: boolean; rateLimitedUntil: number }>;
} {
  const status = {
    active: currentActiveUrl ? maskUrl(currentActiveUrl) : null,
    primary: null as { url: string; healthy: boolean; circuitOpen: boolean; rateLimitedUntil: number } | null,
    fallbacks: [] as Array<{ url: string; healthy: boolean; circuitOpen: boolean; rateLimitedUntil: number }>,
  };

  if (primaryUrl) {
    const health = providerHealth.get(primaryUrl);
    status.primary = {
      url: maskUrl(primaryUrl),
      healthy: health?.isHealthy ?? false,
      circuitOpen: health?.circuit.isOpen ?? false,
      rateLimitedUntil: health?.circuit.rateLimitedUntil ?? 0,
    };
  }

  for (const url of fallbackUrls) {
    const health = providerHealth.get(url);
    status.fallbacks.push({
      url: maskUrl(url),
      healthy: health?.isHealthy ?? false,
      circuitOpen: health?.circuit.isOpen ?? false,
      rateLimitedUntil: health?.circuit.rateLimitedUntil ?? 0,
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
    health.circuit.rateLimitedUntil = 0;
    health.isHealthy = true;
  }
  console.log('[rpc-provider] All circuits reset');
}

/**
 * Force switch to next available endpoint (for manual failover)
 */
export function forceFailover(): string | undefined {
  if (currentActiveUrl) {
    const health = providerHealth.get(currentActiveUrl);
    if (health) {
      health.circuit.isOpen = true;
      health.circuit.lastFailure = Date.now();
    }
  }
  return getAvailableRpcUrl();
}
