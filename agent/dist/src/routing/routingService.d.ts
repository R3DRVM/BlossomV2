/**
 * Unified Routing Service
 * Sprint 3: dFlow routing with truthful metadata and deterministic fallback
 *
 * Rules:
 * - ROUTING_MODE='dflow' => hard fail if dFlow unavailable (return DFLOW_REQUIRED error)
 * - ROUTING_MODE='hybrid' => dFlow first, then fallback
 * - ROUTING_MODE='deterministic' => never call dFlow (always fallback)
 * - All responses include routing metadata (source, ok, reason, latencyMs)
 * - NEVER log API keys or include them in responses
 */
export declare function getRoutingStats(): {
    dflowCallCount: number;
    lastDflowCallAt: number | null;
};
export declare function resetRoutingStats(): void;
/**
 * Canonical Routing Metadata Structure (Sprint 3.1)
 * Normalized across all endpoints: swap quotes, event markets, etc.
 */
/**
 * Canonical Routing Metadata Structure (Sprint 3.1)
 * Normalized across all endpoints: swap quotes, event markets, etc.
 */
export interface RoutingMetadata {
    source: 'dflow' | 'fallback';
    kind: 'swap_quote' | 'event_markets';
    ok: boolean;
    reason?: string;
    latencyMs: number;
    mode: 'deterministic' | 'hybrid' | 'dflow';
    correlationId: string;
}
export interface RoutedSwapQuoteResult {
    ok: boolean;
    data?: {
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
    };
    routing: RoutingMetadata;
    error?: {
        code: string;
        message: string;
    };
}
export interface RoutedEventMarketsResult {
    ok: boolean;
    data?: Array<{
        id: string;
        title: string;
        yesPrice: number;
        noPrice: number;
        volume24hUsd?: number;
        openInterestUsd?: number;
        liquidity?: number;
        spread?: number;
    }>;
    routing: RoutingMetadata;
    error?: {
        code: string;
        message: string;
    };
}
/**
 * Get swap quote with routing metadata
 */
export declare function getSwapQuoteRouted(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    slippageBps?: number;
    chainId?: number;
    fallbackQuote?: () => Promise<{
        amountOut: string;
        minAmountOut: string;
        routeSummary?: string;
        gas?: string;
    } | null>;
    correlationId?: string;
}): Promise<RoutedSwapQuoteResult>;
/**
 * Get event markets with routing metadata
 */
export declare function getEventMarketsRouted(params: {
    limit?: number;
    fallbackMarkets?: () => Promise<Array<{
        id: string;
        title: string;
        yesPrice: number;
        noPrice: number;
        volume24hUsd?: number;
    }>>;
    correlationId?: string;
}): Promise<RoutedEventMarketsResult>;
//# sourceMappingURL=routingService.d.ts.map