/**
 * Fallback Provider Implementations
 * Wraps existing Polymarket/Kalshi and 1inch/deterministic functionality
 */
import { MarketDataProvider, QuoteProvider, NormalizedEventMarket, NormalizedSwapQuote } from './types';
/**
 * Fallback Market Data Provider (Polymarket + Kalshi)
 */
export declare class FallbackMarketDataProvider implements MarketDataProvider {
    name: string;
    isAvailable(): boolean;
    getEventMarkets(): Promise<NormalizedEventMarket[]>;
}
/**
 * Fallback Quote Provider (1inch + deterministic)
 */
export declare class FallbackQuoteProvider implements QuoteProvider {
    name: string;
    isAvailable(): boolean;
    getSwapQuote(params: {
        tokenIn: string;
        tokenOut: string;
        amountIn: string;
        slippageBps?: number;
        chainId?: number;
    }): Promise<NormalizedSwapQuote | null>;
    getEventQuote(): Promise<null>;
}
//# sourceMappingURL=fallbackProvider.d.ts.map