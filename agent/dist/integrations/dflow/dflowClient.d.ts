/**
 * dFlow API Client
 * Provides access to dFlow's routing and market data APIs
 * Uses fetch for minimal dependencies
 */
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
 */
export declare function isDflowConfigured(): boolean;
/**
 * Check if a specific dFlow capability is available
 */
export declare function isDflowCapabilityAvailable(capability: 'eventsMarkets' | 'eventsQuotes' | 'swapsQuotes'): boolean;
/**
 * Get dFlow capabilities summary
 */
export declare function getDflowCapabilities(): {
    enabled: boolean;
    eventsMarkets: boolean;
    eventsQuotes: boolean;
    swapsQuotes: boolean;
};
/**
 * Make a request to dFlow API
 */
export declare function dflowRequest<T>(path: string, options?: DflowRequestOptions): Promise<DflowResponse<T>>;
/**
 * Health check for dFlow API
 */
export declare function dflowHealthCheck(): Promise<{
    ok: boolean;
    latencyMs: number;
    error?: string;
}>;
/**
 * Get event markets from dFlow
 */
export declare function getEventMarkets(): Promise<DflowResponse<DflowEventMarket[]>>;
/**
 * Get event quote from dFlow
 */
export declare function getEventQuote(params: {
    marketId: string;
    outcome: 'YES' | 'NO';
    amount: number;
}): Promise<DflowResponse<DflowEventQuote>>;
/**
 * Get swap quote from dFlow
 */
export declare function getSwapQuote(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    slippageBps?: number;
    chainId?: number;
}): Promise<DflowResponse<DflowSwapQuote>>;
//# sourceMappingURL=dflowClient.d.ts.map