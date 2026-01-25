/**
 * dFlow Provider Implementation
 * Provides market data and quotes from dFlow API
 */
import { isDflowConfigured, isDflowCapabilityAvailable, getEventMarkets as dflowGetEventMarkets, getEventQuote as dflowGetEventQuote, getSwapQuote as dflowGetSwapQuote, } from '../integrations/dflow/dflowClient';
/**
 * dFlow Market Data Provider
 */
export class DflowMarketDataProvider {
    name = 'dflow';
    isAvailable() {
        return isDflowCapabilityAvailable('eventsMarkets');
    }
    async getEventMarkets() {
        if (!this.isAvailable()) {
            return [];
        }
        const response = await dflowGetEventMarkets();
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
/**
 * dFlow Quote Provider
 */
export class DflowQuoteProvider {
    name = 'dflow';
    isAvailable() {
        return isDflowConfigured();
    }
    async getSwapQuote(params) {
        if (!isDflowCapabilityAvailable('swapsQuotes')) {
            return null;
        }
        const response = await dflowGetSwapQuote({
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
        if (!isDflowCapabilityAvailable('eventsQuotes')) {
            return null;
        }
        const response = await dflowGetEventQuote(params);
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
//# sourceMappingURL=dflowProvider.js.map