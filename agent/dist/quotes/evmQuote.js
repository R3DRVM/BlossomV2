/**
 * EVM Quote Provider
 * Provides quotes for demo swap router and other EVM-based venues
 * Supports hybrid routing: 1inch for route intelligence, demo router for execution
 */
import { DEMO_SWAP_ROUTER_ADDRESS, DEFAULT_SWAP_SLIPPAGE_BPS, DEMO_REDACTED_ADDRESS, DEMO_WETH_ADDRESS, ROUTING_MODE, ROUTING_REQUIRE_LIVE_QUOTE, ETH_TESTNET_CHAIN_ID, DFLOW_ENABLED, } from '../config';
import { getOneInchQuote, isOneInchAvailable } from './oneInchQuote';
import { getSwapQuote as getDflowSwapQuote, isDflowCapabilityAvailable } from '../integrations/dflow/dflowClient';
import { getUniswapV3Quote, isUniswapQuoterAvailable } from './uniswapQuoter';
import { formatUnits } from 'viem';
/**
 * Get quote from demo swap router
 * Demo router uses fixed 95% rate (5% fee)
 */
export async function getDemoSwapQuote(params) {
    const { tokenIn, tokenOut, amountIn, slippageBps = DEFAULT_SWAP_SLIPPAGE_BPS } = params;
    // Demo router uses fixed rate: 95% output (5% fee)
    const RATE_NUMERATOR = 95n;
    const RATE_DENOMINATOR = 100n;
    // Parse amountIn
    const amountInBigInt = BigInt(amountIn);
    // Calculate expected output (95% of input)
    // Handle decimal differences: DEMO_REDACTED has 6 decimals, DEMO_WETH has 18 decimals
    let expectedOut;
    if (tokenIn.toLowerCase() === DEMO_REDACTED_ADDRESS?.toLowerCase() &&
        tokenOut.toLowerCase() === DEMO_WETH_ADDRESS?.toLowerCase()) {
        // REDACTED (6 decimals) -> WETH (18 decimals)
        // Apply rate first, then scale up by 10^12
        expectedOut = (amountInBigInt * RATE_NUMERATOR / RATE_DENOMINATOR) * 10n ** 12n;
    }
    else if (tokenIn.toLowerCase() === DEMO_WETH_ADDRESS?.toLowerCase() &&
        tokenOut.toLowerCase() === DEMO_REDACTED_ADDRESS?.toLowerCase()) {
        // WETH (18 decimals) -> REDACTED (6 decimals)
        // Apply rate first, then scale down by 10^12
        expectedOut = (amountInBigInt * RATE_NUMERATOR / RATE_DENOMINATOR) / 10n ** 12n;
    }
    else {
        // Same decimals or unknown - just apply rate
        expectedOut = amountInBigInt * RATE_NUMERATOR / RATE_DENOMINATOR;
    }
    // Calculate minimum output with slippage
    const slippageMultiplier = BigInt(10000 - slippageBps);
    const minOut = (expectedOut * slippageMultiplier) / 10000n;
    return {
        expectedOut: expectedOut.toString(),
        minOut: minOut.toString(),
        estSlippageBps: slippageBps,
        feeTier: 3000, // 0.3% (standard Uniswap V3 fee tier, kept for compatibility)
        venueLabel: 'Blossom Demo Router (Uniswap V3 compatible)',
        chainLabel: 'Sepolia',
        settlementEstimate: '~1 block',
    };
}
/**
 * Get quote for a swap (supports demo router)
 */
export async function getSwapQuote(params) {
    // Check if this is a demo swap
    const isDemoSwap = (params.tokenIn.toLowerCase() === DEMO_REDACTED_ADDRESS?.toLowerCase() ||
        params.tokenIn.toLowerCase() === DEMO_WETH_ADDRESS?.toLowerCase()) &&
        (params.tokenOut.toLowerCase() === DEMO_REDACTED_ADDRESS?.toLowerCase() ||
            params.tokenOut.toLowerCase() === DEMO_WETH_ADDRESS?.toLowerCase());
    if (isDemoSwap && DEMO_SWAP_ROUTER_ADDRESS) {
        return getDemoSwapQuote(params);
    }
    // Future: Add real Uniswap quote logic here
    return null;
}
/**
 * Get routing decision: tries 1inch first, falls back to deterministic
 * This is the hybrid model: real routing intelligence + deterministic execution
 */
export async function getSwapRoutingDecision(params) {
    const { tokenIn, tokenOut, tokenInSymbol, tokenOutSymbol, tokenInDecimals, tokenOutDecimals, amountIn, slippageBps = DEFAULT_SWAP_SLIPPAGE_BPS, } = params;
    const warnings = [];
    let oneInchResult;
    let dflowResult;
    let uniswapResult;
    // Try dFlow first if dflow mode is enabled
    if ((ROUTING_MODE === 'dflow' || DFLOW_ENABLED) && isDflowCapabilityAvailable('swapsQuotes')) {
        try {
            const result = await getDflowSwapQuote({
                tokenIn,
                tokenOut,
                amountIn,
                slippageBps,
                chainId: ETH_TESTNET_CHAIN_ID,
            });
            if (result.ok && result.data) {
                dflowResult = {
                    amountOut: result.data.amountOut,
                    minAmountOut: result.data.minAmountOut,
                    routeSummary: result.data.routeSummary,
                    gas: result.data.gas,
                };
            }
        }
        catch (error) {
            console.warn('[getSwapRoutingDecision] dFlow quote failed:', error.message);
            warnings.push(`dFlow quote unavailable: ${error.message}`);
        }
    }
    // Try Uniswap V3 quoter (for comparison with 1inch)
    if (isUniswapQuoterAvailable()) {
        try {
            const uniswapQuote = await getUniswapV3Quote({
                tokenIn,
                tokenOut,
                amountIn,
                fee: 3000, // 0.3% fee tier
            });
            if (uniswapQuote) {
                uniswapResult = {
                    amountOut: uniswapQuote.amountOut,
                    gasEstimate: uniswapQuote.gasEstimate,
                };
            }
        }
        catch (error) {
            console.warn('[getSwapRoutingDecision] Uniswap quote failed:', error.message);
            // Don't add warning - Uniswap quote is optional for comparison
        }
    }
    // Try 1inch if hybrid mode is enabled and no dFlow result
    if (!dflowResult && ROUTING_MODE === 'hybrid' && isOneInchAvailable()) {
        try {
            oneInchResult = await getOneInchQuote({
                chainId: ETH_TESTNET_CHAIN_ID,
                tokenIn,
                tokenOut,
                amountIn,
                slippageBps,
            });
        }
        catch (error) {
            console.warn('[getSwapRoutingDecision] 1inch quote failed:', error.message);
            warnings.push(`1inch quote unavailable: ${error.message}`);
        }
    }
    // If dFlow succeeded, use its data for routing intelligence
    if (dflowResult) {
        const expectedOutRaw = dflowResult.amountOut;
        const expectedOut = formatUnits(BigInt(expectedOutRaw), tokenOutDecimals);
        const minOutRaw = dflowResult.minAmountOut;
        const minOut = formatUnits(BigInt(minOutRaw), tokenOutDecimals);
        return {
            expectedOut,
            expectedOutRaw,
            minOut,
            minOutRaw,
            slippageBps,
            routingSource: 'dflow',
            routeSummary: dflowResult.routeSummary || `${tokenInSymbol} → ${tokenOutSymbol} via dFlow`,
            protocols: ['dFlow'],
            estimatedGas: dflowResult.gas,
            executionVenue: 'Blossom Demo Router',
            executionNote: 'Routing powered by dFlow; executed via deterministic demo venue.',
            chain: 'Sepolia',
            chainId: ETH_TESTNET_CHAIN_ID,
            settlementEstimate: '~1 block',
            warnings: warnings.length > 0 ? warnings : undefined,
        };
    }
    // Compare 1inch vs Uniswap and choose best route
    if (oneInchResult && uniswapResult) {
        const oneInchOut = BigInt(oneInchResult.toTokenAmount);
        const uniswapOut = BigInt(uniswapResult.amountOut);
        // Choose route with higher output
        if (uniswapOut > oneInchOut) {
            // Uniswap is better
            const expectedOut = formatUnits(uniswapOut, tokenOutDecimals);
            const slippageMultiplier = BigInt(10000 - slippageBps);
            const minOutRaw = (uniswapOut * slippageMultiplier / 10000n).toString();
            const minOut = formatUnits(BigInt(minOutRaw), tokenOutDecimals);
            return {
                expectedOut,
                expectedOutRaw: uniswapResult.amountOut,
                minOut,
                minOutRaw,
                slippageBps,
                routingSource: 'uniswap',
                routeSummary: `${tokenInSymbol} → ${tokenOutSymbol} via Uniswap V3 (best route)`,
                protocols: ['Uniswap V3'],
                estimatedGas: uniswapResult.gasEstimate,
                executionVenue: 'Uniswap V3',
                executionNote: `Best route: Uniswap V3 (${expectedOut} ${tokenOutSymbol} vs 1inch ${formatUnits(oneInchOut, tokenOutDecimals)} ${tokenOutSymbol})`,
                chain: 'Sepolia',
                chainId: ETH_TESTNET_CHAIN_ID,
                settlementEstimate: '~1 block',
                warnings: warnings.length > 0 ? warnings : undefined,
            };
        }
        else {
            // 1inch is better
            const expectedOutRaw = oneInchResult.toTokenAmount;
            const expectedOut = formatUnits(BigInt(expectedOutRaw), tokenOutDecimals);
            const slippageMultiplier = BigInt(10000 - slippageBps);
            const minOutRaw = (BigInt(expectedOutRaw) * slippageMultiplier / 10000n).toString();
            const minOut = formatUnits(BigInt(minOutRaw), tokenOutDecimals);
            return {
                expectedOut,
                expectedOutRaw,
                minOut,
                minOutRaw,
                slippageBps,
                routingSource: '1inch',
                routeSummary: oneInchResult.routeSummary,
                protocols: oneInchResult.protocols,
                estimatedGas: oneInchResult.estimatedGas,
                executionVenue: 'Uniswap V3', // Still execute via Uniswap V3 adapter
                executionNote: `Best route: 1inch (${expectedOut} ${tokenOutSymbol} vs Uniswap ${formatUnits(uniswapOut, tokenOutDecimals)} ${tokenOutSymbol})`,
                chain: 'Sepolia',
                chainId: ETH_TESTNET_CHAIN_ID,
                settlementEstimate: '~1 block',
                warnings: warnings.length > 0 ? warnings : undefined,
            };
        }
    }
    // If only 1inch succeeded, use its data for routing intelligence
    if (oneInchResult) {
        const expectedOutRaw = oneInchResult.toTokenAmount;
        const expectedOut = formatUnits(BigInt(expectedOutRaw), tokenOutDecimals);
        // Apply slippage to get minOut
        const slippageMultiplier = BigInt(10000 - slippageBps);
        const minOutRaw = (BigInt(expectedOutRaw) * slippageMultiplier / 10000n).toString();
        const minOut = formatUnits(BigInt(minOutRaw), tokenOutDecimals);
        return {
            expectedOut,
            expectedOutRaw,
            minOut,
            minOutRaw,
            slippageBps,
            routingSource: '1inch',
            routeSummary: oneInchResult.routeSummary,
            protocols: oneInchResult.protocols,
            estimatedGas: oneInchResult.estimatedGas,
            executionVenue: 'Uniswap V3', // Execute via Uniswap V3 adapter
            executionNote: 'Routing computed from 1inch aggregator; executed via Uniswap V3.',
            chain: 'Sepolia',
            chainId: ETH_TESTNET_CHAIN_ID,
            settlementEstimate: '~1 block',
            warnings: warnings.length > 0 ? warnings : undefined,
        };
    }
    // If only Uniswap succeeded, use its data
    if (uniswapResult) {
        const expectedOut = formatUnits(BigInt(uniswapResult.amountOut), tokenOutDecimals);
        const slippageMultiplier = BigInt(10000 - slippageBps);
        const minOutRaw = (BigInt(uniswapResult.amountOut) * slippageMultiplier / 10000n).toString();
        const minOut = formatUnits(BigInt(minOutRaw), tokenOutDecimals);
        return {
            expectedOut,
            expectedOutRaw: uniswapResult.amountOut,
            minOut,
            minOutRaw,
            slippageBps,
            routingSource: 'uniswap',
            routeSummary: `${tokenInSymbol} → ${tokenOutSymbol} via Uniswap V3`,
            protocols: ['Uniswap V3'],
            estimatedGas: uniswapResult.gasEstimate,
            executionVenue: 'Uniswap V3',
            executionNote: 'Routing and execution via Uniswap V3.',
            chain: 'Sepolia',
            chainId: ETH_TESTNET_CHAIN_ID,
            settlementEstimate: '~1 block',
            warnings: warnings.length > 0 ? warnings : undefined,
        };
    }
    // 1inch not available or failed - use deterministic fallback
    if (ROUTING_REQUIRE_LIVE_QUOTE) {
        throw new Error('Live routing quote required but unavailable. Set ROUTING_REQUIRE_LIVE_QUOTE=false to allow fallback.');
    }
    // Fallback to demo swap quote (deterministic)
    warnings.push('Using deterministic quote (1inch unavailable for Sepolia testnet)');
    const demoQuote = await getDemoSwapQuote({
        tokenIn,
        tokenOut,
        amountIn,
        slippageBps,
    });
    const expectedOut = formatUnits(BigInt(demoQuote.expectedOut), tokenOutDecimals);
    const minOut = formatUnits(BigInt(demoQuote.minOut), tokenOutDecimals);
    return {
        expectedOut,
        expectedOutRaw: demoQuote.expectedOut,
        minOut,
        minOutRaw: demoQuote.minOut,
        slippageBps,
        routingSource: 'deterministic',
        routeSummary: `${tokenInSymbol} → ${tokenOutSymbol} via Demo Router`,
        protocols: ['Blossom Demo Router'],
        executionVenue: 'Blossom Demo Router',
        executionNote: 'Deterministic routing and execution via demo venue.',
        chain: 'Sepolia',
        chainId: ETH_TESTNET_CHAIN_ID,
        settlementEstimate: demoQuote.settlementEstimate,
        warnings: warnings.length > 0 ? warnings : undefined,
    };
}
//# sourceMappingURL=evmQuote.js.map