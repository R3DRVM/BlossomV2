"use strict";
/**
 * Fallback Provider Implementations
 * Wraps existing Polymarket/Kalshi and 1inch/deterministic functionality
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FallbackQuoteProvider = exports.FallbackMarketDataProvider = void 0;
const predictionData_1 = require("../services/predictionData");
const evmQuote_1 = require("../quotes/evmQuote");
const config_1 = require("../config");
/**
 * Convert RawPredictionMarket to NormalizedEventMarket
 */
function normalizeMarket(market) {
    return {
        id: market.id,
        title: market.title,
        yesPrice: market.yesPrice,
        noPrice: market.noPrice,
        volume24hUsd: market.volume24hUsd,
        openInterestUsd: market.openInterestUsd,
        source: market.source.toLowerCase(),
        isLive: market.isLive || false,
    };
}
/**
 * Fallback Market Data Provider (Polymarket + Kalshi)
 */
class FallbackMarketDataProvider {
    name = 'fallback';
    isAvailable() {
        return true; // Always available (has static fallback)
    }
    async getEventMarkets() {
        try {
            const [kalshiMarkets, polymarketMarkets] = await Promise.all([
                (0, predictionData_1.fetchKalshiMarkets)(),
                (0, predictionData_1.fetchPolymarketMarkets)(),
            ]);
            const normalized = [
                ...kalshiMarkets.map(normalizeMarket),
                ...polymarketMarkets.map(normalizeMarket),
            ];
            // Sort by volume/liquidity
            return normalized.sort((a, b) => {
                const aValue = a.volume24hUsd || a.openInterestUsd || 0;
                const bValue = b.volume24hUsd || b.openInterestUsd || 0;
                return bValue - aValue;
            });
        }
        catch (error) {
            console.warn('[FallbackMarketDataProvider] Error fetching markets:', error.message);
            return [];
        }
    }
}
exports.FallbackMarketDataProvider = FallbackMarketDataProvider;
/**
 * Fallback Quote Provider (1inch + deterministic)
 */
class FallbackQuoteProvider {
    name = 'fallback';
    isAvailable() {
        return true; // Always available (has deterministic fallback)
    }
    async getSwapQuote(params) {
        try {
            // Determine token symbols and decimals based on known addresses
            // For demo tokens, we know the symbols
            const tokenInSymbol = params.tokenIn.toLowerCase().includes('usdc') ? 'USDC' : 'WETH';
            const tokenOutSymbol = params.tokenOut.toLowerCase().includes('usdc') ? 'USDC' : 'WETH';
            const tokenInDecimals = tokenInSymbol === 'USDC' ? 6 : 18;
            const tokenOutDecimals = tokenOutSymbol === 'USDC' ? 6 : 18;
            // Use the existing routing decision function which handles 1inch and fallback
            const decision = await (0, evmQuote_1.getSwapRoutingDecision)({
                tokenIn: params.tokenIn,
                tokenOut: params.tokenOut,
                tokenInSymbol,
                tokenOutSymbol,
                tokenInDecimals,
                tokenOutDecimals,
                amountIn: params.amountIn,
                slippageBps: params.slippageBps || config_1.DEFAULT_SWAP_SLIPPAGE_BPS,
            });
            return {
                tokenIn: params.tokenIn,
                tokenOut: params.tokenOut,
                amountIn: params.amountIn,
                amountOut: decision.expectedOut,
                minAmountOut: decision.minOut,
                slippageBps: decision.slippageBps,
                route: decision.route,
                routeSummary: decision.routeSummary,
                gas: decision.gas,
                source: decision.routingSource,
            };
        }
        catch (error) {
            console.warn('[FallbackQuoteProvider] Error getting quote:', error.message);
            return null;
        }
    }
    async getEventQuote() {
        // Fallback doesn't support event quotes
        return null;
    }
}
exports.FallbackQuoteProvider = FallbackQuoteProvider;
//# sourceMappingURL=fallbackProvider.js.map