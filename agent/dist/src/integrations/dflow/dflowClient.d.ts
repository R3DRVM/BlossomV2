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
 * Now checks for DFLOW_ENABLED and DFLOW_API_KEY (URLs have defaults)
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
 * @param path - API path (will be appended to base URL)
 * @param options - Request options
 * @param capability - Optional capability hint to select the correct base URL
 */
export declare function dflowRequest<T>(path: string, options?: DflowRequestOptions, capability?: 'eventsMarkets' | 'eventsQuotes' | 'swapsQuotes'): Promise<DflowResponse<T>>;
/**
 * Health check for dFlow API
 * Tries both the Quote API and Prediction API endpoints
 */
export declare function dflowHealthCheck(): Promise<{
    ok: boolean;
    latencyMs: number;
    error?: string;
    quoteApiOk?: boolean;
    predictionApiOk?: boolean;
}>;
/**
 * Get event markets from dFlow Prediction Markets API
 */
export declare function getEventMarkets(): Promise<DflowResponse<DflowEventMarket[]>>;
/**
 * Get event quote from dFlow Prediction Markets API
 */
export declare function getEventQuote(params: {
    marketId: string;
    outcome: 'YES' | 'NO';
    amount: number;
}): Promise<DflowResponse<DflowEventQuote>>;
/**
 * Get swap quote from dFlow Quote API
 */
export declare function getSwapQuote(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    slippageBps?: number;
    chainId?: number;
}): Promise<DflowResponse<DflowSwapQuote>>;
/**
 * Probe dFlow API endpoints for discovery
 * Tests common paths and returns status codes (never logs API key)
 * Use for dev/debug only
 */
export declare function probeDflowEndpoints(): Promise<{
    quoteApi: Array<{
        path: string;
        status: number;
        ok: boolean;
        body?: string;
    }>;
    predictionApi: Array<{
        path: string;
        status: number;
        ok: boolean;
        body?: string;
    }>;
    configured: boolean;
    apiKeySet: boolean;
}>;
//# sourceMappingURL=dflowClient.d.ts.map