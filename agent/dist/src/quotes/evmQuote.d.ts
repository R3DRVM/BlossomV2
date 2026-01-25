/**
 * EVM Quote Provider
 * Provides quotes for demo swap router and other EVM-based venues
 * Supports hybrid routing: 1inch for route intelligence, demo router for execution
 */
export interface SwapQuote {
    expectedOut: string;
    minOut: string;
    estSlippageBps: number;
    feeTier: number;
    venueLabel: string;
    chainLabel: string;
    settlementEstimate: string;
}
/**
 * Get quote from demo swap router
 * Demo router uses fixed 95% rate (5% fee)
 */
export declare function getDemoSwapQuote(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    fee?: number;
    slippageBps?: number;
}): Promise<SwapQuote>;
/**
 * Get quote for a swap (supports demo router)
 */
export declare function getSwapQuote(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    fee?: number;
    slippageBps?: number;
}): Promise<SwapQuote | null>;
/**
 * Routing decision metadata (includes source of routing intelligence)
 */
export interface RoutingDecision {
    expectedOut: string;
    expectedOutRaw: string;
    minOut: string;
    minOutRaw: string;
    slippageBps: number;
    routingSource: '1inch' | 'deterministic' | 'dflow' | 'uniswap';
    routeSummary: string;
    route?: string;
    protocols?: string[];
    estimatedGas?: string;
    gas?: string;
    executionVenue: string;
    executionNote: string;
    chain: string;
    chainId: number;
    settlementEstimate: string;
    warnings?: string[];
}
/**
 * Get routing decision: tries 1inch first, falls back to deterministic
 * This is the hybrid model: real routing intelligence + deterministic execution
 */
export declare function getSwapRoutingDecision(params: {
    tokenIn: string;
    tokenOut: string;
    tokenInSymbol: string;
    tokenOutSymbol: string;
    tokenInDecimals: number;
    tokenOutDecimals: number;
    amountIn: string;
    slippageBps?: number;
}): Promise<RoutingDecision>;
//# sourceMappingURL=evmQuote.d.ts.map