/**
 * API Client Configuration
 * Centralized base URL for agent API calls
 *
 * PRODUCTION: Uses same-origin relative paths (empty string) to avoid CORS
 * LOCAL DEV: Uses VITE_AGENT_BASE_URL or falls back to http://localhost:3001
 */
export function getAgentApiBaseUrl(): string {
  // PRODUCTION: Use same-origin relative paths for all deployed domains
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    const isProduction = hostname.includes('blossom.onl') || hostname.includes('vercel.app');

    if (isProduction) {
      // HARD FAIL GUARD: Verify we're not accidentally using localhost in production
      const envUrl = import.meta.env.VITE_AGENT_BASE_URL ?? import.meta.env.VITE_AGENT_API_URL ?? '';
      if (envUrl && (envUrl.includes('localhost') || envUrl.includes('127.0.0.1') || envUrl.includes(':3001'))) {
        console.error('[CRITICAL] Production environment detected localhost in VITE_AGENT_BASE_URL:', envUrl);
        console.error('[CRITICAL] Forcing same-origin API base to prevent localhost calls');
      }
      return ''; // Empty string = same-origin relative paths (/api/...)
    }
  }

  // LOCAL DEV: Check env vars or default to localhost
  const devUrl = import.meta.env.VITE_AGENT_BASE_URL ?? import.meta.env.VITE_AGENT_API_URL ?? 'http://localhost:3001';

  // HARD FAIL GUARD: If running in production but window isn't available yet, don't use localhost
  if (typeof window !== 'undefined' && window.location && import.meta.env.PROD) {
    const hostname = window.location.hostname;
    if ((hostname.includes('blossom.onl') || hostname.includes('vercel.app')) &&
        (devUrl.includes('localhost') || devUrl.includes('127.0.0.1'))) {
      console.error('[CRITICAL] Detected production domain but API base contains localhost. Forcing same-origin.');
      return '';
    }
  }

  return devUrl;
}

export const AGENT_API_BASE_URL = getAgentApiBaseUrl();

// Log backend URL (in all modes for debugging)
if (typeof window !== 'undefined') {
  const isProduction = window.location.hostname.includes('blossom.onl') || window.location.hostname.includes('vercel.app');
  console.log(`🔗 [apiClient] Backend API base URL: "${AGENT_API_BASE_URL}" (${AGENT_API_BASE_URL === '' ? 'same-origin' : 'absolute'})`);
  console.log(`   Environment: ${isProduction ? 'PRODUCTION' : 'DEV'}`);
  console.log(`   Hostname: ${window.location.hostname}`);

  if (import.meta.env.VITE_AGENT_BASE_URL || import.meta.env.VITE_AGENT_API_URL) {
    console.log(`   Env var: ${import.meta.env.VITE_AGENT_BASE_URL || import.meta.env.VITE_AGENT_API_URL}`);
  }

  // FINAL VERIFICATION: Ensure no localhost in production
  if (isProduction && AGENT_API_BASE_URL && (AGENT_API_BASE_URL.includes('localhost') || AGENT_API_BASE_URL.includes('127.0.0.1'))) {
    console.error('[CRITICAL ERROR] Production detected but API base contains localhost!');
    console.error('[CRITICAL ERROR] This should never happen. API calls will fail.');
  }
}

/**
 * Global backend health state
 * Managed by health check loop - all API calls should check this first
 */
let backendHealthy = false;
let backendHealthCheckInProgress = false;
let backendHealthListeners: Set<(healthy: boolean) => void> = new Set();

/**
 * Subscribe to backend health changes
 */
export function onBackendHealthChange(callback: (healthy: boolean) => void): () => void {
  backendHealthListeners.add(callback);
  return () => backendHealthListeners.delete(callback);
}

/**
 * Get current backend health status
 */
export function isBackendHealthy(): boolean {
  return backendHealthy;
}

/**
 * Set backend health status (internal - called by health check loop)
 */
export function setBackendHealthy(healthy: boolean): void {
  if (backendHealthy !== healthy) {
    backendHealthy = healthy;
    backendHealthListeners.forEach(cb => cb(healthy));
  }
}

/**
 * Wrapper for making requests to the agent API
 * Blocks requests if backend is not healthy (except health checks)
 * @param path - API path (e.g., '/api/chat')
 * @param options - Fetch options (method, headers, body, etc.) with optional correlationId
 */
export async function callAgent(
  path: string, 
  options: RequestInit & { correlationId?: string } = {}
): Promise<Response> {
  // Allow health checks to proceed even if backend is marked unhealthy
  const isHealthCheck = path === '/health' || path === '/api/health';
  
  // Block all other requests if backend is not healthy
  if (!isHealthCheck && !backendHealthy) {
    throw new Error('Backend is offline. Please start the backend server.');
  }
  // Ensure no double slashes in URL
  const baseUrl = AGENT_API_BASE_URL.replace(/\/$/, ''); // Remove trailing slash
  const cleanPath = path.startsWith('/') ? path : `/${path}`; // Ensure leading slash
  const url = `${baseUrl}${cleanPath}`;
  
  // Add access code to headers if available
  const accessCode = typeof window !== 'undefined' ? localStorage.getItem('blossom_access_code') : null;
  const walletAddress = typeof window !== 'undefined' ? localStorage.getItem('blossom_access_wallet') : null;
  
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (accessCode) {
    headers.set('X-Access-Code', accessCode);
  }
  if (walletAddress) {
    headers.set('X-Wallet-Address', walletAddress);
  }
  // Add correlation ID if provided in options
  if (options.correlationId) {
    headers.set('x-correlation-id', options.correlationId);
  }
  
  // Use shorter timeout for wallet-init calls (health, session status, balances)
  const isWalletInitCall = path.includes('/health') || path.includes('/session/status') || path.includes('/wallet/balances');
  const timeoutMs = isWalletInitCall ? 3000 : 30000; // 3s for wallet init, 30s for others
  
  try {
    const response = await fetch(url, {
      ...options,
      headers,
      // Add timeout to prevent hanging
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response;
  } catch (error: any) {
    // Handle timeout/network errors
    if (error.name === 'TimeoutError' || error.name === 'TypeError' || error.message?.includes('fetch')) {
      const networkError = new Error(
        `Backend unreachable: ${error.message || 'Connection refused'} | URL: ${url}`
      ) as Error & { url?: string; isNetworkError?: boolean };
      networkError.url = url;
      networkError.isNetworkError = true;
      throw networkError;
    }
    
    // Enhance other errors with URL and status info for debugging
    const enhancedError = new Error(
      `Agent API call failed: ${error.message || 'Network error'} | URL: ${url} | Status: ${error.status || 'N/A'}`
    ) as Error & { url?: string; status?: number };
    enhancedError.url = url;
    enhancedError.status = error.status;
    throw enhancedError;
  }
}

/**
 * Check if backend is reachable
 * Returns { ok: true, ts } if reachable, throws if not
 * Updates global backend health state
 */
export async function checkBackendHealth(): Promise<{ ok: boolean; ts: number }> {
  // Prevent concurrent health checks
  if (backendHealthCheckInProgress) {
    return { ok: backendHealthy, ts: Date.now() };
  }
  
  backendHealthCheckInProgress = true;
  
  try {
    const response = await fetch(`${AGENT_API_BASE_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000), // 5 second timeout for health check
    });
    
    if (!response.ok) {
      setBackendHealthy(false);
      throw new Error(`Health check failed: ${response.status}`);
    }
    
    const data = await response.json();
    const healthy = data.ok === true;
    setBackendHealthy(healthy);
    
    return { ok: healthy, ts: data.ts || Date.now() };
  } catch (error: any) {
    setBackendHealthy(false);
    if (error.name === 'TimeoutError' || error.name === 'TypeError' || error.message?.includes('fetch')) {
      throw new Error('Backend unreachable');
    }
    throw error;
  } finally {
    backendHealthCheckInProgress = false;
  }
}

/**
 * Start backend health check loop with exponential backoff
 * Returns cleanup function
 */
// ============================================================================
// Intent Execution API
// ============================================================================

/**
 * Intent execution result from the backend
 */
export interface IntentExecutionResult {
  ok: boolean;
  intentId: string;
  status: 'queued' | 'planned' | 'routed' | 'executing' | 'confirmed' | 'failed';
  executionId?: string;
  txHash?: string;
  explorerUrl?: string;
  error?: {
    stage: 'plan' | 'route' | 'execute' | 'confirm' | 'quote';
    code: string;
    message: string;
  };
  metadata?: {
    executedKind?: 'real' | 'proof_only';
    parsed?: {
      kind: string;
      action: string;
      amount?: string;
      amountUnit?: string;
      targetAsset?: string;
      leverage?: number;
    };
    route?: {
      chain: string;
      network: string;
      venue: string;
      executionType: string;
      warnings?: string[];
    };
    quoteMetadata?: any;
    destChainProof?: {
      txHash: string;
      explorerUrl: string;
    };
    [key: string]: any;
  };
}

/**
 * Execute an intent through the ledger system
 * This calls the backend intent runner and returns execution result with explorer links
 *
 * Options:
 * - chain: Target chain (ethereum, solana, both)
 * - planOnly: If true, returns plan without executing (for confirm mode)
 */
export async function executeIntent(
  intentText: string,
  options: {
    chain?: 'ethereum' | 'solana' | 'both';
    planOnly?: boolean;
  } = {}
): Promise<IntentExecutionResult> {
  const ledgerSecret = import.meta.env.VITE_DEV_LEDGER_SECRET;

  if (!ledgerSecret) {
    return {
      ok: false,
      intentId: '',
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'LEDGER_SECRET_MISSING',
        message: 'Dev ledger secret not configured. Set VITE_DEV_LEDGER_SECRET.',
      },
    };
  }

  // Build metadata for source tracking
  const metadata = {
    source: 'ui',
    domain: typeof window !== 'undefined' ? window.location.host : 'unknown',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 100) : 'unknown',
    timestamp: Date.now(),
  };

  try {
    const response = await callAgent('/api/ledger/intents/execute', {
      method: 'POST',
      headers: {
        'X-Ledger-Secret': ledgerSecret,
      },
      body: JSON.stringify({
        intentText,
        chain: options.chain || 'ethereum',
        planOnly: options.planOnly || false,
        metadata,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      return {
        ok: false,
        intentId: '',
        status: 'failed',
        error: {
          stage: 'execute',
          code: 'API_ERROR',
          message: errorData.error || `HTTP ${response.status}`,
        },
      };
    }

    const data = await response.json();
    return data;
  } catch (error: any) {
    return {
      ok: false,
      intentId: '',
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'NETWORK_ERROR',
        message: error.message || 'Failed to connect to backend',
      },
    };
  }
}

/**
 * Confirm and execute a previously planned intent
 * Used in confirm mode after user reviews the plan
 */
export async function confirmIntent(intentId: string): Promise<IntentExecutionResult> {
  const ledgerSecret = import.meta.env.VITE_DEV_LEDGER_SECRET;

  if (!ledgerSecret) {
    return {
      ok: false,
      intentId,
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'LEDGER_SECRET_MISSING',
        message: 'Dev ledger secret not configured. Set VITE_DEV_LEDGER_SECRET.',
      },
    };
  }

  // Include source metadata for confirm as well
  const metadata = {
    source: 'ui',
    domain: typeof window !== 'undefined' ? window.location.host : 'unknown',
    confirmedAt: Date.now(),
  };

  try {
    const response = await callAgent('/api/ledger/intents/execute', {
      method: 'POST',
      headers: {
        'X-Ledger-Secret': ledgerSecret,
      },
      body: JSON.stringify({ intentId, metadata }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      return {
        ok: false,
        intentId,
        status: 'failed',
        error: {
          stage: 'execute',
          code: 'API_ERROR',
          message: errorData.error || `HTTP ${response.status}`,
        },
      };
    }

    const data = await response.json();
    return data;
  } catch (error: any) {
    return {
      ok: false,
      intentId,
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'NETWORK_ERROR',
        message: error.message || 'Failed to connect to backend',
      },
    };
  }
}

/**
 * Get intent details by ID
 */
export async function getIntent(intentId: string): Promise<any> {
  const ledgerSecret = import.meta.env.VITE_DEV_LEDGER_SECRET;

  if (!ledgerSecret) {
    throw new Error('Ledger secret not configured');
  }

  const response = await callAgent(`/api/ledger/intents/${intentId}`, {
    method: 'GET',
    headers: {
      'X-Ledger-Secret': ledgerSecret,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get intent: ${response.status}`);
  }

  return response.json();
}

/**
 * Get recent intents
 */
export async function getRecentIntents(limit: number = 10): Promise<any> {
  const ledgerSecret = import.meta.env.VITE_DEV_LEDGER_SECRET;

  if (!ledgerSecret) {
    throw new Error('Ledger secret not configured');
  }

  const response = await callAgent(`/api/ledger/intents/recent?limit=${limit}`, {
    method: 'GET',
    headers: {
      'X-Ledger-Secret': ledgerSecret,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get intents: ${response.status}`);
  }

  return response.json();
}

// ============================================================================
// Positions API
// ============================================================================

/**
 * Position data from the ledger
 */
export interface LedgerPosition {
  id: string;
  chain: 'ethereum' | 'solana';
  network: string;
  venue: string;
  market: string;
  side: 'long' | 'short';
  leverage?: number;
  margin_units?: string;
  margin_display?: string;
  size_units?: string;
  entry_price?: string;
  status: 'open' | 'closed' | 'liquidated';
  opened_at: number;
  closed_at?: number;
  open_tx_hash?: string;
  open_explorer_url?: string;
  close_tx_hash?: string;
  close_explorer_url?: string;
  pnl?: string;
  user_address: string;
  on_chain_position_id?: string;
  intent_id?: string;
  execution_id?: string;
}

/**
 * Get open positions from the ledger
 */
export async function getOpenPositions(): Promise<LedgerPosition[]> {
  const ledgerSecret = import.meta.env.VITE_DEV_LEDGER_SECRET;

  if (!ledgerSecret) {
    console.warn('[apiClient] Ledger secret not configured, cannot fetch positions');
    return [];
  }

  try {
    const response = await callAgent('/api/ledger/positions?status=open', {
      method: 'GET',
      headers: {
        'X-Ledger-Secret': ledgerSecret,
      },
    });

    if (!response.ok) {
      console.warn('[apiClient] Failed to fetch positions:', response.status);
      return [];
    }

    const data = await response.json();
    return data.positions || [];
  } catch (error: any) {
    console.warn('[apiClient] Error fetching positions:', error.message);
    return [];
  }
}

/**
 * Get recent positions (all statuses)
 */
export async function getRecentPositions(limit: number = 20): Promise<LedgerPosition[]> {
  const ledgerSecret = import.meta.env.VITE_DEV_LEDGER_SECRET;

  if (!ledgerSecret) {
    return [];
  }

  try {
    const response = await callAgent(`/api/ledger/positions/recent?limit=${limit}`, {
      method: 'GET',
      headers: {
        'X-Ledger-Secret': ledgerSecret,
      },
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return data.positions || [];
  } catch (error: any) {
    return [];
  }
}

export function startBackendHealthCheckLoop(
  onHealthChange?: (healthy: boolean) => void
): () => void {
  let isRunning = true;
  let attempts = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  
  const performCheck = async () => {
    if (!isRunning) return;
    
    try {
      await checkBackendHealth();
      attempts = 0; // Reset on success
      // When healthy, check every 30 seconds
      timeoutId = setTimeout(performCheck, 30000);
    } catch {
      attempts++;
      // Exponential backoff: 5s, 10s, 20s, then cap at 30s
      const backoffMs = Math.min(5000 * Math.pow(2, Math.min(attempts - 1, 2)), 30000);
      timeoutId = setTimeout(performCheck, backoffMs);
    }
  };
  
  // Subscribe to health changes
  if (onHealthChange) {
    onBackendHealthChange(onHealthChange);
  }
  
  // Initial check
  performCheck();
  
  // Return cleanup
  return () => {
    isRunning = false;
    if (timeoutId) clearTimeout(timeoutId);
    if (onHealthChange) {
      backendHealthListeners.delete(onHealthChange);
    }
  };
}