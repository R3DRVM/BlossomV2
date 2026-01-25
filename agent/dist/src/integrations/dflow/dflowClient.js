"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDflowConfigured = isDflowConfigured;
exports.isDflowCapabilityAvailable = isDflowCapabilityAvailable;
exports.getDflowCapabilities = getDflowCapabilities;
exports.dflowRequest = dflowRequest;
exports.dflowHealthCheck = dflowHealthCheck;
exports.getEventMarkets = getEventMarkets;
exports.getEventQuote = getEventQuote;
exports.getSwapQuote = getSwapQuote;
exports.probeDflowEndpoints = probeDflowEndpoints;
const config_1 = require("../../config");
/**
 * Check if dFlow is properly configured
 * Now checks for DFLOW_ENABLED and DFLOW_API_KEY (URLs have defaults)
 */
function isDflowConfigured() {
    // Check core requirements: enabled flag and API key
    // URLs have defaults, so they don't need to be explicitly set
    return !!(config_1.DFLOW_ENABLED && config_1.DFLOW_API_KEY);
}
/**
 * Get the appropriate base URL for a capability
 */
function getBaseUrlForCapability(capability) {
    switch (capability) {
        case 'eventsMarkets':
        case 'eventsQuotes':
            return config_1.DFLOW_PREDICTION_API_URL;
        case 'swapsQuotes':
            return config_1.DFLOW_QUOTE_API_URL;
        default:
            return config_1.DFLOW_BASE_URL || config_1.DFLOW_QUOTE_API_URL;
    }
}
/**
 * Check if a specific dFlow capability is available
 */
function isDflowCapabilityAvailable(capability) {
    if (!isDflowConfigured())
        return false;
    switch (capability) {
        case 'eventsMarkets':
            return !!config_1.DFLOW_EVENTS_MARKETS_PATH;
        case 'eventsQuotes':
            return !!config_1.DFLOW_EVENTS_QUOTE_PATH;
        case 'swapsQuotes':
            return !!config_1.DFLOW_SWAPS_QUOTE_PATH;
        default:
            return false;
    }
}
/**
 * Get dFlow capabilities summary
 */
function getDflowCapabilities() {
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
async function dflowRequest(path, options = {}, capability) {
    if (!isDflowConfigured()) {
        return { ok: false, error: 'dFlow not configured' };
    }
    const { method = 'GET', body, timeout = 10000 } = options;
    // Select the appropriate base URL based on capability
    const baseUrl = capability
        ? getBaseUrlForCapability(capability)
        : (config_1.DFLOW_BASE_URL || config_1.DFLOW_QUOTE_API_URL);
    const url = `${baseUrl}${path}`;
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        // IMPORTANT: dFlow uses x-api-key header, NOT Bearer token
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': config_1.DFLOW_API_KEY,
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
 * Tries both the Quote API and Prediction API endpoints
 */
async function dflowHealthCheck() {
    if (!isDflowConfigured()) {
        return { ok: false, latencyMs: 0, error: 'dFlow not configured' };
    }
    const startTime = Date.now();
    let quoteApiOk = false;
    let predictionApiOk = false;
    try {
        // Check Quote API
        const quoteResponse = await fetch(`${config_1.DFLOW_QUOTE_API_URL}/health`, {
            method: 'GET',
            headers: {
                'x-api-key': config_1.DFLOW_API_KEY,
            },
        });
        quoteApiOk = quoteResponse.ok || quoteResponse.status === 404;
        // Check Prediction Markets API
        const predictionResponse = await fetch(`${config_1.DFLOW_PREDICTION_API_URL}/health`, {
            method: 'GET',
            headers: {
                'x-api-key': config_1.DFLOW_API_KEY,
            },
        });
        predictionApiOk = predictionResponse.ok || predictionResponse.status === 404;
        const latencyMs = Date.now() - startTime;
        // Consider healthy if at least one API is reachable
        const ok = quoteApiOk || predictionApiOk;
        return { ok, latencyMs, quoteApiOk, predictionApiOk };
    }
    catch (error) {
        return { ok: false, latencyMs: Date.now() - startTime, error: error.message, quoteApiOk, predictionApiOk };
    }
}
/**
 * Get event markets from dFlow Prediction Markets API
 */
async function getEventMarkets() {
    // If specific path is not configured, try the default markets endpoint
    const path = config_1.DFLOW_EVENTS_MARKETS_PATH || '/v1/markets';
    return dflowRequest(path, {}, 'eventsMarkets');
}
/**
 * Get event quote from dFlow Prediction Markets API
 */
async function getEventQuote(params) {
    // If specific path is not configured, try the default quote endpoint
    const path = config_1.DFLOW_EVENTS_QUOTE_PATH || '/v1/quote';
    return dflowRequest(path, {
        method: 'POST',
        body: params,
    }, 'eventsQuotes');
}
/**
 * Get swap quote from dFlow Quote API
 */
async function getSwapQuote(params) {
    // If specific path is not configured, try the default quote endpoint
    const path = config_1.DFLOW_SWAPS_QUOTE_PATH || '/v1/swap/quote';
    return dflowRequest(path, {
        method: 'POST',
        body: params,
    }, 'swapsQuotes');
}
/**
 * Probe dFlow API endpoints for discovery
 * Tests common paths and returns status codes (never logs API key)
 * Use for dev/debug only
 */
async function probeDflowEndpoints() {
    const apiKeySet = !!config_1.DFLOW_API_KEY;
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
    const probeUrl = async (baseUrl, path) => {
        try {
            const response = await fetch(`${baseUrl}${path}`, {
                method: 'GET',
                headers: apiKeySet ? {
                    'x-api-key': config_1.DFLOW_API_KEY,
                    'Accept': 'application/json',
                } : {
                    'Accept': 'application/json',
                },
            });
            let body;
            try {
                const text = await response.text();
                body = text.substring(0, 200); // First 200 chars only
            }
            catch {
                // Ignore body read errors
            }
            return { path, status: response.status, ok: response.ok, body };
        }
        catch (error) {
            return { path, status: 0, ok: false, body: `Error: ${error.message}` };
        }
    };
    const quoteApiResults = await Promise.all(probePaths.map(p => probeUrl(config_1.DFLOW_QUOTE_API_URL, p)));
    const predictionApiResults = await Promise.all(probePaths.map(p => probeUrl(config_1.DFLOW_PREDICTION_API_URL, p)));
    return {
        quoteApi: quoteApiResults,
        predictionApi: predictionApiResults,
        configured,
        apiKeySet,
    };
}
//# sourceMappingURL=dflowClient.js.map