"use strict";
/**
 * dFlow Provider Implementation
 * Provides market data and quotes from dFlow API
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DflowQuoteProvider = exports.DflowMarketDataProvider = void 0;
const dflowClient_1 = require("../integrations/dflow/dflowClient");
/**
 * dFlow Market Data Provider
 */
class DflowMarketDataProvider {
    name = 'dflow';
    isAvailable() {
        return (0, dflowClient_1.isDflowCapabilityAvailable)('eventsMarkets');
    }
    async getEventMarkets() {
        if (!this.isAvailable()) {
            return [];
        }
        const response = await (0, dflowClient_1.getEventMarkets)();
        if (!response.ok || !response.data) {
            console.warn('[DflowMarketDataProvider] Failed to fetch markets:', response.error);
            return [];
        }
        return response.data.map((market) => ({
            id: market.id,
            title: market.title,
            yesPrice: market.yesPrice,
            noPrice: market.noPrice,
            volume24hUsd: market.volume24hUsd,
            openInterestUsd: market.openInterestUsd,
            liquidity: market.liquidity,
            spread: market.spread,
            source: 'dflow',
            isLive: true,
        }));
    }
}
exports.DflowMarketDataProvider = DflowMarketDataProvider;
/**
 * dFlow Quote Provider
 */
class DflowQuoteProvider {
    name = 'dflow';
    isAvailable() {
        return (0, dflowClient_1.isDflowConfigured)();
    }
    async getSwapQuote(params) {
        if (!(0, dflowClient_1.isDflowCapabilityAvailable)('swapsQuotes')) {
            return null;
        }
        const response = await (0, dflowClient_1.getSwapQuote)({
            tokenIn: params.tokenIn,
            tokenOut: params.tokenOut,
            amountIn: params.amountIn,
            slippageBps: params.slippageBps,
            chainId: params.chainId,
        });
        if (!response.ok || !response.data) {
            console.warn('[DflowQuoteProvider] Failed to get swap quote:', response.error);
            return null;
        }
        const quote = response.data;
        return {
            tokenIn: quote.tokenIn,
            tokenOut: quote.tokenOut,
            amountIn: quote.amountIn,
            amountOut: quote.amountOut,
            minAmountOut: quote.minAmountOut,
            slippageBps: quote.slippageBps,
            route: quote.route,
            routeSummary: quote.routeSummary,
            gas: quote.gas,
            priceImpact: quote.priceImpact,
            source: 'dflow',
        };
    }
    async getEventQuote(params) {
        if (!(0, dflowClient_1.isDflowCapabilityAvailable)('eventsQuotes')) {
            return null;
        }
        const response = await (0, dflowClient_1.getEventQuote)(params);
        if (!response.ok || !response.data) {
            console.warn('[DflowQuoteProvider] Failed to get event quote:', response.error);
            return null;
        }
        const quote = response.data;
        return {
            marketId: quote.marketId,
            marketTitle: '', // Would need to be fetched or passed in
            outcome: quote.outcome,
            price: quote.price,
            impliedProbability: quote.impliedProbability,
            liquidity: quote.liquidity,
            spread: quote.spread,
            estimatedFees: quote.estimatedFees,
            source: 'dflow',
        };
    }
}
exports.DflowQuoteProvider = DflowQuoteProvider;
//# sourceMappingURL=dflowProvider.js.map