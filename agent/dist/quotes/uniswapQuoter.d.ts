/**
 * Uniswap V3 Quoter
 * Fetches quotes from Uniswap V3 QuoterV2 contract on Sepolia
 */
interface UniswapQuoteResult {
    amountOut: string;
    sqrtPriceX96After: string;
    initializedTicksCrossed: string;
    gasEstimate: string;
}
/**
 * Get quote from Uniswap V3 QuoterV2
 * @param tokenIn Token in address
 * @param tokenOut Token out address
 * @param amountIn Amount in (wei, as BigInt string)
 * @param fee Fee tier (500, 3000, 10000)
 * @returns Quote result or null if failed
 */
export declare function getUniswapV3Quote(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    fee?: number;
}): Promise<UniswapQuoteResult | null>;
/**
 * Check if Uniswap quoter is available
 */
export declare function isUniswapQuoterAvailable(): boolean;
export {};
//# sourceMappingURL=uniswapQuoter.d.ts.map