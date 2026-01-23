/**
 * dFlow API Client
 * Provides access to dFlow's routing and market data APIs
 * Uses fetch for minimal dependencies
 *
 * IMPORTANT: dFlow uses x-api-key header for authentication (NOT Bearer token)
 * dFlow has TWO separate API endpoints:
 * - Quote API (swaps): https://a.quote-api.dflow.net
 * - Prediction Markets API: https://prediction-markets-api.dflow.net
 */

import {
  DFLOW_ENABLED,
  DFLOW_API_KEY,
  DFLOW_BASE_URL,
  DFLOW_QUOTE_API_URL,
  DFLOW_PREDICTION_API_URL,
  DFLOW_EVENTS_MARKETS_PATH,
  DFLOW_EVENTS_QUOTE_PATH,
  DFLOW_SWAPS_QUOTE_PATH,
} from '../../config';

export interface DflowRequestOptions {
  method?: 'GET' | 'POST';
  body?: Record<string, unknown>;
  timeout?: number;
}

export interface DflowResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
}

// Event market types
export interface DflowEventMarket {
  id: string;
  title: string;
  yesPrice: number;
  noPrice: number;
  volume24hUsd?: number;
  openInterestUsd?: number;
  liquidity?: number;
  spread?: number;
  source?: string;
}

export interface DflowEventQuote {
  marketId: string;
  outcome: 'YES' | 'NO';
  price: number;
  size: number;
  impliedProbability: number;
  liquidity: number;
  spread: number;
  estimatedFees?: number;
}

// Swap quote types
export interface DflowSwapQuote {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  slippageBps: number;
  route?: string;
  routeSummary?: string;
  gas?: string;
  priceImpact?: number;
}

/**
 * Check if dFlow is properly configured
 * Now checks for DFLOW_ENABLED and DFLOW_API_KEY (URLs have defaults)
 */
export function isDflowConfigured(): boolean {
  // Check core requirements: enabled flag and API key
  // URLs have defaults, so they don't need to be explicitly set
  return !!(DFLOW_ENABLED && DFLOW_API_KEY);
}

/**
 * Get the appropriate base URL for a capability
 */
function getBaseUrlForCapability(capability: 'eventsMarkets' | 'eventsQuotes' | 'swapsQuotes'): string {
  switch (capability) {
    case 'eventsMarkets':
    case 'eventsQuotes':
      return DFLOW_PREDICTION_API_URL;
    case 'swapsQuotes':
      return DFLOW_QUOTE_API_URL;
    default:
      return DFLOW_BASE_URL || DFLOW_QUOTE_API_URL;
  }
}

/**
 * Check if a specific dFlow capability is available
 */
export function isDflowCapabilityAvailable(capability: 'eventsMarkets' | 'eventsQuotes' | 'swapsQuotes'): boolean {
  if (!isDflowConfigured()) return false;
  
  switch (capability) {
    case 'eventsMarkets':
      return !!DFLOW_EVENTS_MARKETS_PATH;
    case 'eventsQuotes':
      return !!DFLOW_EVENTS_QUOTE_PATH;
    case 'swapsQuotes':
      return !!DFLOW_SWAPS_QUOTE_PATH;
    default:
      return false;
  }
}

/**
 * Get dFlow capabilities summary
 */
export function getDflowCapabilities(): {
  enabled: boolean;
  eventsMarkets: boolean;
  eventsQuotes: boolean;
  swapsQuotes: boolean;
} {
  return {
    enabled: isDflowConfigured(),
    eventsMarkets: isDflowCapabilityAvailable('eventsMarkets'),
    eventsQuotes: isDflowCapabilityAvailable('eventsQuotes'),
    swapsQuotes: isDflowCapabilityAvailable('swapsQuotes'),
  };
}

/**
 * Make a request to dFlow API
 * @param path - API path (will be appended to base URL)
 * @param options - Request options
 * @param capability - Optional capability hint to select the correct base URL
 */
export async function dflowRequest<T>(
  path: string,
  options: DflowRequestOptions = {},
  capability?: 'eventsMarkets' | 'eventsQuotes' | 'swapsQuotes'
): Promise<DflowResponse<T>> {
  if (!isDflowConfigured()) {
    return { ok: false, error: 'dFlow not configured' };
  }

  const { method = 'GET', body, timeout = 10000 } = options;

  // Select the appropriate base URL based on capability
  const baseUrl = capability
    ? getBaseUrlForCapability(capability)
    : (DFLOW_BASE_URL || DFLOW_QUOTE_API_URL);

  const url = `${baseUrl}${path}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // IMPORTANT: dFlow uses x-api-key header, NOT Bearer token
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': DFLOW_API_KEY!,
        'Accept': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        ok: false,
        error: `dFlow API error: ${response.status} ${response.statusText}`,
        statusCode: response.status,
      };
    }

    const data = await response.json();
    return { ok: true, data: data as T, statusCode: response.status };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return { ok: false, error: 'dFlow request timeout' };
    }
    return { ok: false, error: `dFlow request failed: ${error.message}` };
  }
}

/**
 * Health check for dFlow API
 * Tries both the Quote API and Prediction API endpoints
 */
export async function dflowHealthCheck(): Promise<{ ok: boolean; latencyMs: number; error?: string; quoteApiOk?: boolean; predictionApiOk?: boolean }> {
  if (!isDflowConfigured()) {
    return { ok: false, latencyMs: 0, error: 'dFlow not configured' };
  }

  const startTime = Date.now();
  let quoteApiOk = false;
  let predictionApiOk = false;

  try {
    // Check Quote API
    const quoteResponse = await fetch(`${DFLOW_QUOTE_API_URL}/health`, {
      method: 'GET',
      headers: {
        'x-api-key': DFLOW_API_KEY!,
      },
    });
    quoteApiOk = quoteResponse.ok || quoteResponse.status === 404;

    // Check Prediction Markets API
    const predictionResponse = await fetch(`${DFLOW_PREDICTION_API_URL}/health`, {
      method: 'GET',
      headers: {
        'x-api-key': DFLOW_API_KEY!,
      },
    });
    predictionApiOk = predictionResponse.ok || predictionResponse.status === 404;

    const latencyMs = Date.now() - startTime;

    // Consider healthy if at least one API is reachable
    const ok = quoteApiOk || predictionApiOk;
    return { ok, latencyMs, quoteApiOk, predictionApiOk };
  } catch (error: any) {
    return { ok: false, latencyMs: Date.now() - startTime, error: error.message, quoteApiOk, predictionApiOk };
  }
}

/**
 * Get event markets from dFlow Prediction Markets API
 */
export async function getEventMarkets(): Promise<DflowResponse<DflowEventMarket[]>> {
  // If specific path is not configured, try the default markets endpoint
  const path = DFLOW_EVENTS_MARKETS_PATH || '/v1/markets';

  return dflowRequest<DflowEventMarket[]>(path, {}, 'eventsMarkets');
}

/**
 * Get event quote from dFlow Prediction Markets API
 */
export async function getEventQuote(params: {
  marketId: string;
  outcome: 'YES' | 'NO';
  amount: number;
}): Promise<DflowResponse<DflowEventQuote>> {
  // If specific path is not configured, try the default quote endpoint
  const path = DFLOW_EVENTS_QUOTE_PATH || '/v1/quote';

  return dflowRequest<DflowEventQuote>(path, {
    method: 'POST',
    body: params,
  }, 'eventsQuotes');
}

/**
 * Get swap quote from dFlow Quote API
 */
export async function getSwapQuote(params: {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageBps?: number;
  chainId?: number;
}): Promise<DflowResponse<DflowSwapQuote>> {
  // If specific path is not configured, try the default quote endpoint
  const path = DFLOW_SWAPS_QUOTE_PATH || '/v1/swap/quote';

  return dflowRequest<DflowSwapQuote>(path, {
    method: 'POST',
    body: params,
  }, 'swapsQuotes');
}

/**
 * Probe dFlow API endpoints for discovery
 * Tests common paths and returns status codes (never logs API key)
 * Use for dev/debug only
 */
export async function probeDflowEndpoints(): Promise<{
  quoteApi: Array<{ path: string; status: number; ok: boolean; body?: string }>;
  predictionApi: Array<{ path: string; status: number; ok: boolean; body?: string }>;
  configured: boolean;
  apiKeySet: boolean;
}> {
  const apiKeySet = !!DFLOW_API_KEY;
  const configured = isDflowConfigured();
  
  const probePaths = [
    '/',
    '/openapi.json',
    '/docs',
    '/healthz',
    '/v1',
    '/v1/markets',
    '/v1/events/markets',
    '/v1/quote',
    '/v1/swap/quote',
  ];

  const probeUrl = async (baseUrl: string, path: string): Promise<{ path: string; status: number; ok: boolean; body?: string }> => {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'GET',
        headers: apiKeySet ? {
          'x-api-key': DFLOW_API_KEY!,
          'Accept': 'application/json',
        } : {
          'Accept': 'application/json',
        },
      });
      
      let body: string | undefined;
      try {
        const text = await response.text();
        body = text.substring(0, 200); // First 200 chars only
      } catch {
        // Ignore body read errors
      }
      
      return { path, status: response.status, ok: response.ok, body };
    } catch (error: any) {
      return { path, status: 0, ok: false, body: `Error: ${error.message}` };
    }
  };

  const quoteApiResults = await Promise.all(
    probePaths.map(p => probeUrl(DFLOW_QUOTE_API_URL, p))
  );
  
  const predictionApiResults = await Promise.all(
    probePaths.map(p => probeUrl(DFLOW_PREDICTION_API_URL, p))
  );

  return {
    quoteApi: quoteApiResults,
    predictionApi: predictionApiResults,
    configured,
    apiKeySet,
  };
}

