/**
 * API Client Configuration
 * Centralized base URL for agent API calls
 * 
 * Uses VITE_AGENT_BASE_URL if set, else defaults to 127.0.0.1:3001
 * (127.0.0.1 instead of localhost to avoid hostname resolution issues)
 */
export const AGENT_API_BASE_URL = import.meta.env.VITE_AGENT_BASE_URL ?? import.meta.env.VITE_AGENT_API_URL ?? 'http://127.0.0.1:3001';

// Log backend URL in dev mode (for debugging)
if (import.meta.env.DEV) {
  console.log(`🔗 [apiClient] Backend API base URL: ${AGENT_API_BASE_URL}`);
  if (import.meta.env.VITE_AGENT_BASE_URL || import.meta.env.VITE_AGENT_API_URL) {
    console.log(`   (from env: ${import.meta.env.VITE_AGENT_BASE_URL || import.meta.env.VITE_AGENT_API_URL})`);
  } else {
    console.log(`   (default: http://127.0.0.1:3001)`);
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