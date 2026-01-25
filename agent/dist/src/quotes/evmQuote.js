"use strict";
// @ts-nocheck
/**
 * EVM Quote Provider
 * Provides quotes for demo swap router and other EVM-based venues
 * Supports hybrid routing: 1inch for route intelligence, demo router for execution
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDemoSwapQuote = getDemoSwapQuote;
exports.getSwapQuote = getSwapQuote;
exports.getSwapRoutingDecision = getSwapRoutingDecision;
const config_1 = require("../config");
const oneInchQuote_1 = require("./oneInchQuote");
const uniswapQuoter_1 = require("./uniswapQuoter");
const viem_1 = require("viem");
const routingService_1 = require("../routing/routingService");
/**
 * Get quote from demo swap router
 * Demo router uses fixed 95% rate (5% fee)
 */
async function getDemoSwapQuote(params) {
    const { tokenIn, tokenOut, amountIn, slippageBps = config_1.DEFAULT_SWAP_SLIPPAGE_BPS } = params;
    // Demo router uses fixed rate: 95% output (5% fee)
    const RATE_NUMERATOR = 95n;
    const RATE_DENOMINATOR = 100n;
    // Parse amountIn
    const amountInBigInt = BigInt(amountIn);
    // Calculate expected output (95% of input)
    // Handle decimal differences: DEMO_REDACTED has 6 decimals, DEMO_WETH has 18 decimals
    let expectedOut;
    if (tokenIn.toLowerCase() === config_1.DEMO_REDACTED_ADDRESS?.toLowerCase() &&
        tokenOut.toLowerCase() === config_1.DEMO_WETH_ADDRESS?.toLowerCase()) {
        // REDACTED (6 decimals) -> WETH (18 decimals)
        // Apply rate first, then scale up by 10^12
        expectedOut = (amountInBigInt * RATE_NUMERATOR / RATE_DENOMINATOR) * 10n ** 12n;
    }
    else if (tokenIn.toLowerCase() === config_1.DEMO_WETH_ADDRESS?.toLowerCase() &&
        tokenOut.toLowerCase() === config_1.DEMO_REDACTED_ADDRESS?.toLowerCase()) {
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
async function getSwapQuote(params) {
    // Check if this is a demo swap
    const isDemoSwap = (params.tokenIn.toLowerCase() === config_1.DEMO_REDACTED_ADDRESS?.toLowerCase() ||
        params.tokenIn.toLowerCase() === config_1.DEMO_WETH_ADDRESS?.toLowerCase()) &&
        (params.tokenOut.toLowerCase() === config_1.DEMO_REDACTED_ADDRESS?.toLowerCase() ||
            params.tokenOut.toLowerCase() === config_1.DEMO_WETH_ADDRESS?.toLowerCase());
    if (isDemoSwap && config_1.DEMO_SWAP_ROUTER_ADDRESS) {
        return getDemoSwapQuote(params);
    }
    // Future: Add real Uniswap quote logic here
    return null;
}
/**
 * Get routing decision: tries 1inch first, falls back to deterministic
 * This is the hybrid model: real routing intelligence + deterministic execution
 */
async function getSwapRoutingDecision(params) {
    const { tokenIn, tokenOut, tokenInSymbol, tokenOutSymbol, tokenInDecimals, tokenOutDecimals, amountIn, slippageBps = config_1.DEFAULT_SWAP_SLIPPAGE_BPS, } = params;
    const warnings = [];
    let oneInchResult;
    let dflowResult;
    let uniswapResult;
    let routingMetadata;
    // Sprint 3: Use unified routing service for dFlow routing
    // Generate correlation ID for routing request
    const { makeCorrelationId } = await Promise.resolve().then(() => __importStar(require('../utils/correlationId')));
    const routingCorrelationId = makeCorrelationId('swap');
    const routedQuote = await (0, routingService_1.getSwapQuoteRouted)({
        tokenIn,
        tokenOut,
        amountIn,
        slippageBps,
        chainId: config_1.ETH_TESTNET_CHAIN_ID,
        correlationId: routingCorrelationId,
        fallbackQuote: async () => {
            // Fallback: Try Uniswap V3 quoter
            if ((0, uniswapQuoter_1.isUniswapQuoterAvailable)()) {
                try {
                    const uniswapQuote = await (0, uniswapQuoter_1.getUniswapV3Quote)({
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
                        // Calculate minOut with slippage
                        const slippageMultiplier = BigInt(10000 - (slippageBps || config_1.DEFAULT_SWAP_SLIPPAGE_BPS));
                        const minOutRaw = (BigInt(uniswapQuote.amountOut) * slippageMultiplier / 10000n).toString();
                        return {
                            amountOut: uniswapQuote.amountOut,
                            minAmountOut: minOutRaw,
                            routeSummary: `${tokenInSymbol} → ${tokenOutSymbol} via Uniswap V3`,
                            gas: uniswapQuote.gasEstimate,
                        };
                    }
                }
                catch (error) {
                    console.warn('[getSwapRoutingDecision] Uniswap quote failed:', error.message);
                }
            }
            // Try 1inch if hybrid mode
            if (config_1.ROUTING_MODE === 'hybrid' && (0, oneInchQuote_1.isOneInchAvailable)()) {
                try {
                    oneInchResult = await (0, oneInchQuote_1.getOneInchQuote)({
                        chainId: config_1.ETH_TESTNET_CHAIN_ID,
                        tokenIn,
                        tokenOut,
                        amountIn,
                        slippageBps,
                    });
                    if (oneInchResult) {
                        const slippageMultiplier = BigInt(10000 - slippageBps);
                        const minOutRaw = (BigInt(oneInchResult.toTokenAmount) * slippageMultiplier / 10000n).toString();
                        return {
                            amountOut: oneInchResult.toTokenAmount,
                            minAmountOut: minOutRaw,
                            routeSummary: oneInchResult.routeSummary || `${tokenInSymbol} → ${tokenOutSymbol} via 1inch`,
                            gas: oneInchResult.estimatedGas,
                        };
                    }
                }
                catch (error) {
                    console.warn('[getSwapRoutingDecision] 1inch quote failed:', error.message);
                    warnings.push(`1inch quote unavailable: ${error.message}`);
                }
            }
            return null;
        },
    });
    // Ensure routing metadata always exists (guard against undefined)
    routingMetadata = routedQuote.routing || {
        source: 'fallback',
        kind: 'swap_quote',
        ok: false,
        reason: 'Routing service returned no metadata',
        latencyMs: 0,
        mode: 'hybrid',
        correlationId: routingCorrelationId,
    };
    // If routing service returned dFlow data, use it
    if (routedQuote.ok && routedQuote.data && routedQuote.routing.source === 'dflow') {
        dflowResult = {
            amountOut: routedQuote.data.amountOut,
            minAmountOut: routedQuote.data.minAmountOut,
            routeSummary: routedQuote.data.routeSummary,
            gas: routedQuote.data.gas,
        };
    }
    // Uniswap and 1inch are now tried in fallbackQuote callback above
    // Only fetch them here if routing service didn't provide fallback data
    if (!routedQuote.ok || routedQuote.routing.source !== 'fallback') {
        // Routing service handled it, skip duplicate calls
    }
    else if (routedQuote.ok && routedQuote.data) {
        // Routing service provided fallback data, use it
        const expectedOutRaw = routedQuote.data.amountOut;
        const expectedOut = (0, viem_1.formatUnits)(BigInt(expectedOutRaw), tokenOutDecimals);
        const minOutRaw = routedQuote.data.minAmountOut;
        const minOut = (0, viem_1.formatUnits)(BigInt(minOutRaw), tokenOutDecimals);
        return {
            expectedOut,
            expectedOutRaw,
            minOut,
            minOutRaw,
            slippageBps: routedQuote.data.slippageBps,
            routingSource: 'deterministic',
            routeSummary: routedQuote.data.routeSummary || `${tokenInSymbol} → ${tokenOutSymbol}`,
            protocols: [],
            estimatedGas: routedQuote.data.gas,
            executionVenue: 'Blossom Demo Router',
            executionNote: 'Routing via fallback provider',
            chain: 'Sepolia',
            chainId: config_1.ETH_TESTNET_CHAIN_ID,
            settlementEstimate: '~1 block',
            warnings: routedQuote.routing.reason ? [routedQuote.routing.reason] : undefined,
            routing: routingMetadata,
        };
    }
    // If dFlow succeeded, use its data for routing intelligence
    if (dflowResult) {
        const expectedOutRaw = dflowResult.amountOut;
        const expectedOut = (0, viem_1.formatUnits)(BigInt(expectedOutRaw), tokenOutDecimals);
        const minOutRaw = dflowResult.minAmountOut;
        const minOut = (0, viem_1.formatUnits)(BigInt(minOutRaw), tokenOutDecimals);
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
            chainId: config_1.ETH_TESTNET_CHAIN_ID,
            settlementEstimate: '~1 block',
            warnings: warnings.length > 0 ? warnings : undefined,
            routing: routingMetadata, // Sprint 3: Include routing metadata
        };
    }
    // Compare 1inch vs Uniswap and choose best route
    if (oneInchResult && uniswapResult) {
        const oneInchOut = BigInt(oneInchResult.toTokenAmount);
        const uniswapOut = BigInt(uniswapResult.amountOut);
        // Choose route with higher output
        if (uniswapOut > oneInchOut) {
            // Uniswap is better
            const expectedOut = (0, viem_1.formatUnits)(uniswapOut, tokenOutDecimals);
            const slippageMultiplier = BigInt(10000 - slippageBps);
            const minOutRaw = (uniswapOut * slippageMultiplier / 10000n).toString();
            const minOut = (0, viem_1.formatUnits)(BigInt(minOutRaw), tokenOutDecimals);
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
                executionNote: `Best route: Uniswap V3 (${expectedOut} ${tokenOutSymbol} vs 1inch ${(0, viem_1.formatUnits)(oneInchOut, tokenOutDecimals)} ${tokenOutSymbol})`,
                chain: 'Sepolia',
                chainId: config_1.ETH_TESTNET_CHAIN_ID,
                settlementEstimate: '~1 block',
                warnings: warnings.length > 0 ? warnings : undefined,
                routing: routingMetadata, // Sprint 3: Include routing metadata
            };
        }
        else {
            // 1inch is better
            const expectedOutRaw = oneInchResult.toTokenAmount;
            const expectedOut = (0, viem_1.formatUnits)(BigInt(expectedOutRaw), tokenOutDecimals);
            const slippageMultiplier = BigInt(10000 - slippageBps);
            const minOutRaw = (BigInt(expectedOutRaw) * slippageMultiplier / 10000n).toString();
            const minOut = (0, viem_1.formatUnits)(BigInt(minOutRaw), tokenOutDecimals);
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
                executionNote: `Best route: 1inch (${expectedOut} ${tokenOutSymbol} vs Uniswap ${(0, viem_1.formatUnits)(uniswapOut, tokenOutDecimals)} ${tokenOutSymbol})`,
                chain: 'Sepolia',
                chainId: config_1.ETH_TESTNET_CHAIN_ID,
                settlementEstimate: '~1 block',
                warnings: warnings.length > 0 ? warnings : undefined,
                routing: routingMetadata, // Sprint 3: Include routing metadata
            };
        }
    }
    // If only 1inch succeeded, use its data for routing intelligence
    if (oneInchResult) {
        const expectedOutRaw = oneInchResult.toTokenAmount;
        const expectedOut = (0, viem_1.formatUnits)(BigInt(expectedOutRaw), tokenOutDecimals);
        // Apply slippage to get minOut
        const slippageMultiplier = BigInt(10000 - slippageBps);
        const minOutRaw = (BigInt(expectedOutRaw) * slippageMultiplier / 10000n).toString();
        const minOut = (0, viem_1.formatUnits)(BigInt(minOutRaw), tokenOutDecimals);
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
            chainId: config_1.ETH_TESTNET_CHAIN_ID,
            settlementEstimate: '~1 block',
            warnings: warnings.length > 0 ? warnings : undefined,
            routing: routingMetadata, // Sprint 3: Include routing metadata
        };
    }
    // If only Uniswap succeeded, use its data
    if (uniswapResult) {
        const expectedOut = (0, viem_1.formatUnits)(BigInt(uniswapResult.amountOut), tokenOutDecimals);
        const slippageMultiplier = BigInt(10000 - slippageBps);
        const minOutRaw = (BigInt(uniswapResult.amountOut) * slippageMultiplier / 10000n).toString();
        const minOut = (0, viem_1.formatUnits)(BigInt(minOutRaw), tokenOutDecimals);
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
            chainId: config_1.ETH_TESTNET_CHAIN_ID,
            settlementEstimate: '~1 block',
            warnings: warnings.length > 0 ? warnings : undefined,
            routing: routingMetadata, // Sprint 3: Include routing metadata
        };
    }
    // 1inch not available or failed - use deterministic fallback
    if (config_1.ROUTING_REQUIRE_LIVE_QUOTE) {
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
    const expectedOut = (0, viem_1.formatUnits)(BigInt(demoQuote.expectedOut), tokenOutDecimals);
    const minOut = (0, viem_1.formatUnits)(BigInt(demoQuote.minOut), tokenOutDecimals);
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
        chainId: config_1.ETH_TESTNET_CHAIN_ID,
        settlementEstimate: demoQuote.settlementEstimate,
        warnings: warnings.length > 0 ? warnings : undefined,
        routing: routingMetadata, // Sprint 3: Include routing metadata
    };
}
//# sourceMappingURL=evmQuote.js.map