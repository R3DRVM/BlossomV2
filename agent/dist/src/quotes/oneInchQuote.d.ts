/**
 * 1inch Quote Provider (Read-Only)
 * Fetches routing intelligence from 1inch API for swap routing decisions.
 * This is read-only - execution still uses our deterministic DemoSwapRouter.
 */
export interface OneInchQuoteRequest {
    chainId: number;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    slippageBps?: number;
}
export interface OneInchQuoteResult {
    toTokenAmount: string;
    estimatedGas: string;
    protocols: string[];
    routeSummary: string;
    aggregator: '1inch';
    fromToken: {
        symbol: string;
        decimals: number;
    };
    toToken: {
        symbol: string;
        decimals: number;
    };
    warnings?: string[];
}
/**
 * Fetch a quote from 1inch API (read-only, no execution data)
 * @param request Quote request parameters
 * @returns Quote result or undefined if quote fails
 */
export declare function getOneInchQuote(request: OneInchQuoteRequest): Promise<OneInchQuoteResult | undefined>;
/**
 * Check if 1inch routing is available
 */
export declare function isOneInchAvailable(): boolean;
/**
 * Get supported chain ID for 1inch
 * Note: 1inch doesn't support Sepolia directly, but we can still call it
 * and fall back gracefully.
 */
export declare function getOneInchChainId(): number;
//# sourceMappingURL=oneInchQuote.d.ts.map