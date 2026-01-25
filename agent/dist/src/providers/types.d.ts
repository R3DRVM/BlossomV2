/**
 * Provider Types
 * Common interfaces for pluggable data providers
 */
export interface NormalizedEventMarket {
    id: string;
    title: string;
    yesPrice: number;
    noPrice: number;
    volume24hUsd?: number;
    openInterestUsd?: number;
    liquidity?: number;
    spread?: number;
    source: string;
    isLive: boolean;
}
export interface NormalizedEventQuote {
    marketId: string;
    marketTitle: string;
    outcome: 'YES' | 'NO';
    price: number;
    impliedProbability: number;
    liquidity: number;
    spread?: number;
    estimatedFees?: number;
    source: string;
}
export interface NormalizedSwapQuote {
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
    source: 'dflow' | '1inch' | 'deterministic';
}
export interface MarketDataProvider {
    name: string;
    getEventMarkets(): Promise<NormalizedEventMarket[]>;
    isAvailable(): boolean;
}
export interface QuoteProvider {
    name: string;
    getSwapQuote?(params: {
        tokenIn: string;
        tokenOut: string;
        amountIn: string;
        slippageBps?: number;
        chainId?: number;
    }): Promise<NormalizedSwapQuote | null>;
    getEventQuote?(params: {
        marketId: string;
        outcome: 'YES' | 'NO';
        amount: number;
    }): Promise<NormalizedEventQuote | null>;
    isAvailable(): boolean;
}
export interface ProviderStatus {
    marketData: {
        provider: string;
        available: boolean;
        fallback?: string;
    };
    quotes: {
        provider: string;
        available: boolean;
        fallback?: string;
        capabilities: {
            swaps: boolean;
            events: boolean;
        };
    };
}
//# sourceMappingURL=types.d.ts.map