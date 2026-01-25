/**
 * dFlow Provider Implementation
 * Provides market data and quotes from dFlow API
 */
import { MarketDataProvider, QuoteProvider, NormalizedEventMarket, NormalizedEventQuote, NormalizedSwapQuote } from './types';
/**
 * dFlow Market Data Provider
 */
export declare class DflowMarketDataProvider implements MarketDataProvider {
    name: string;
    isAvailable(): boolean;
    getEventMarkets(): Promise<NormalizedEventMarket[]>;
}
/**
 * dFlow Quote Provider
 */
export declare class DflowQuoteProvider implements QuoteProvider {
    name: string;
    isAvailable(): boolean;
    getSwapQuote(params: {
        tokenIn: string;
        tokenOut: string;
        amountIn: string;
        slippageBps?: number;
        chainId?: number;
    }): Promise<NormalizedSwapQuote | null>;
    getEventQuote(params: {
        marketId: string;
        outcome: 'YES' | 'NO';
        amount: number;
    }): Promise<NormalizedEventQuote | null>;
}
//# sourceMappingURL=dflowProvider.d.ts.map