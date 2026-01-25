/**
 * dFlow API Client
 * Provides access to dFlow's routing and market data APIs
 * Uses fetch for minimal dependencies
 */
import { DFLOW_ENABLED, DFLOW_API_KEY, DFLOW_BASE_URL, DFLOW_EVENTS_MARKETS_PATH, DFLOW_EVENTS_QUOTE_PATH, DFLOW_SWAPS_QUOTE_PATH, } from '../../config';
/**
 * Check if dFlow is properly configured
 */
export function isDflowConfigured() {
    return !!(DFLOW_ENABLED && DFLOW_API_KEY && DFLOW_BASE_URL);
}
/**
 * Check if a specific dFlow capability is available
 */
export function isDflowCapabilityAvailable(capability) {
    if (!isDflowConfigured())
        return false;
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
export function getDflowCapabilities() {
    return {
        enabled: isDflowConfigured(),
        eventsMarkets: isDflowCapabilityAvailable('eventsMarkets'),
        eventsQuotes: isDflowCapabilityAvailable('eventsQuotes'),
        swapsQuotes: isDflowCapabilityAvailable('swapsQuotes'),
    };
}
/**
 * Make a request to dFlow API
 */
export async function dflowRequest(path, options = {}) {
    if (!isDflowConfigured()) {
        return { ok: false, error: 'dFlow not configured' };
    }
    const { method = 'GET', body, timeout = 10000 } = options;
    const url = `${DFLOW_BASE_URL}${path}`;
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DFLOW_API_KEY}`,
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
        return { ok: true, data: data, statusCode: response.status };
    }
    catch (error) {
        if (error.name === 'AbortError') {
            return { ok: false, error: 'dFlow request timeout' };
        }
        return { ok: false, error: `dFlow request failed: ${error.message}` };
    }
}
/**
 * Health check for dFlow API
 */
export async function dflowHealthCheck() {
    if (!isDflowConfigured()) {
        return { ok: false, latencyMs: 0, error: 'dFlow not configured' };
    }
    const startTime = Date.now();
    try {
        // Try to hit the base URL or a health endpoint
        const response = await fetch(`${DFLOW_BASE_URL}/health`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${DFLOW_API_KEY}`,
            },
        });
        const latencyMs = Date.now() - startTime;
        if (response.ok || response.status === 404) {
            // 404 is acceptable - means API is reachable but no health endpoint
            return { ok: true, latencyMs };
        }
        return { ok: false, latencyMs, error: `Status ${response.status}` };
    }
    catch (error) {
        return { ok: false, latencyMs: Date.now() - startTime, error: error.message };
    }
}
/**
 * Get event markets from dFlow
 */
export async function getEventMarkets() {
    if (!isDflowCapabilityAvailable('eventsMarkets')) {
        return { ok: false, error: 'Events markets capability not configured' };
    }
    return dflowRequest(DFLOW_EVENTS_MARKETS_PATH);
}
/**
 * Get event quote from dFlow
 */
export async function getEventQuote(params) {
    if (!isDflowCapabilityAvailable('eventsQuotes')) {
        return { ok: false, error: 'Events quotes capability not configured' };
    }
    return dflowRequest(DFLOW_EVENTS_QUOTE_PATH, {
        method: 'POST',
        body: params,
    });
}
/**
 * Get swap quote from dFlow
 */
export async function getSwapQuote(params) {
    if (!isDflowCapabilityAvailable('swapsQuotes')) {
        return { ok: false, error: 'Swaps quotes capability not configured' };
    }
    return dflowRequest(DFLOW_SWAPS_QUOTE_PATH, {
        method: 'POST',
        body: params,
    });
}
//# sourceMappingURL=dflowClient.js.map