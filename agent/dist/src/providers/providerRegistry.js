"use strict";
/**
 * Provider Registry
 * Central selection logic for market data and quote providers
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMarketDataProvider = getMarketDataProvider;
exports.getQuoteProvider = getQuoteProvider;
exports.getProviderStatus = getProviderStatus;
exports.resetProviders = resetProviders;
exports.isDflowActiveFor = isDflowActiveFor;
const dflowProvider_1 = require("./dflowProvider");
const fallbackProvider_1 = require("./fallbackProvider");
const config_1 = require("../config");
const dflowClient_1 = require("../integrations/dflow/dflowClient");
// Singleton instances
let marketDataProvider = null;
let quoteProvider = null;
/**
 * Get the market data provider based on configuration
 * @throws Error if DFLOW_REQUIRE=true and dFlow is unavailable
 */
function getMarketDataProvider() {
    if (marketDataProvider) {
        return marketDataProvider;
    }
    // Try dFlow first if enabled
    if (config_1.DFLOW_ENABLED) {
        const dflowProvider = new dflowProvider_1.DflowMarketDataProvider();
        if (dflowProvider.isAvailable()) {
            marketDataProvider = dflowProvider;
            console.log('[ProviderRegistry] Using dFlow for market data');
            return marketDataProvider;
        }
        // dFlow enabled but not available
        if (config_1.DFLOW_REQUIRE) {
            throw new Error('dFlow is required but events markets capability is not configured. ' +
                'Set DFLOW_EVENTS_MARKETS_PATH or disable DFLOW_REQUIRE.');
        }
        console.warn('[ProviderRegistry] dFlow enabled but events markets unavailable, using fallback');
    }
    // Use fallback
    marketDataProvider = new fallbackProvider_1.FallbackMarketDataProvider();
    console.log('[ProviderRegistry] Using fallback for market data (Polymarket + Kalshi)');
    return marketDataProvider;
}
/**
 * Get the quote provider based on configuration
 * @throws Error if DFLOW_REQUIRE=true and dFlow is unavailable
 */
function getQuoteProvider() {
    if (quoteProvider) {
        return quoteProvider;
    }
    // Check ROUTING_MODE first
    if (config_1.ROUTING_MODE === 'dflow' || config_1.DFLOW_ENABLED) {
        const dflowProvider = new dflowProvider_1.DflowQuoteProvider();
        if (dflowProvider.isAvailable()) {
            quoteProvider = dflowProvider;
            console.log('[ProviderRegistry] Using dFlow for quotes');
            return quoteProvider;
        }
        // dFlow requested but not available
        if (config_1.ROUTING_MODE === 'dflow' && config_1.DFLOW_REQUIRE) {
            throw new Error('dFlow routing is required but not configured. ' +
                'Set DFLOW_API_KEY and DFLOW_BASE_URL or change ROUTING_MODE.');
        }
        console.warn('[ProviderRegistry] dFlow quotes unavailable, using fallback');
    }
    // Use fallback
    quoteProvider = new fallbackProvider_1.FallbackQuoteProvider();
    console.log('[ProviderRegistry] Using fallback for quotes (1inch + deterministic)');
    return quoteProvider;
}
/**
 * Get provider status for preflight
 */
function getProviderStatus() {
    const dflowCaps = (0, dflowClient_1.getDflowCapabilities)();
    // Determine market data provider
    let marketDataProviderName = 'fallback';
    let marketDataAvailable = true;
    let marketDataFallback;
    if (config_1.DFLOW_ENABLED && dflowCaps.eventsMarkets) {
        marketDataProviderName = 'dflow';
    }
    else if (config_1.DFLOW_ENABLED) {
        marketDataFallback = 'Polymarket + Kalshi';
    }
    // Determine quote provider
    let quoteProviderName = 'fallback';
    let quoteAvailable = true;
    let quoteFallback;
    let swapsAvailable = true;
    let eventsAvailable = false;
    if (config_1.ROUTING_MODE === 'dflow' && dflowCaps.enabled) {
        quoteProviderName = 'dflow';
        swapsAvailable = dflowCaps.swapsQuotes;
        eventsAvailable = dflowCaps.eventsQuotes;
        if (!swapsAvailable) {
            quoteFallback = '1inch + deterministic';
        }
    }
    else if (config_1.ROUTING_MODE === 'hybrid') {
        quoteProviderName = '1inch';
        quoteFallback = 'deterministic';
    }
    else {
        quoteProviderName = 'deterministic';
    }
    return {
        marketData: {
            provider: marketDataProviderName,
            available: marketDataAvailable,
            fallback: marketDataFallback,
        },
        quotes: {
            provider: quoteProviderName,
            available: quoteAvailable,
            fallback: quoteFallback,
            capabilities: {
                swaps: swapsAvailable,
                events: eventsAvailable,
            },
        },
    };
}
/**
 * Reset provider cache (for testing)
 */
function resetProviders() {
    marketDataProvider = null;
    quoteProvider = null;
}
/**
 * Check if dFlow is the active provider for a capability
 */
function isDflowActiveFor(capability) {
    const status = getProviderStatus();
    switch (capability) {
        case 'marketData':
            return status.marketData.provider === 'dflow';
        case 'swapQuotes':
            return status.quotes.provider === 'dflow' && status.quotes.capabilities.swaps;
        case 'eventQuotes':
            return status.quotes.provider === 'dflow' && status.quotes.capabilities.events;
        default:
            return false;
    }
}
//# sourceMappingURL=providerRegistry.js.map