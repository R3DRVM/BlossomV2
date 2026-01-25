"use strict";
/**
 * 1inch Quote Provider (Read-Only)
 * Fetches routing intelligence from 1inch API for swap routing decisions.
 * This is read-only - execution still uses our deterministic DemoSwapRouter.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOneInchQuote = getOneInchQuote;
exports.isOneInchAvailable = isOneInchAvailable;
exports.getOneInchChainId = getOneInchChainId;
const config_1 = require("../config");
/**
 * Fetch a quote from 1inch API (read-only, no execution data)
 * @param request Quote request parameters
 * @returns Quote result or undefined if quote fails
 */
async function getOneInchQuote(request) {
    const { chainId, tokenIn, tokenOut, amountIn } = request;
    // 1inch API v5.2 quote endpoint
    // Note: For Sepolia testnet, 1inch may not have liquidity data.
    // In production, this would use mainnet chainId (1).
    // For demo purposes, we'll construct a simulated response when API is unavailable.
    const apiUrl = `${config_1.ONEINCH_BASE_URL}/swap/v5.2/${chainId}/quote`;
    const params = new URLSearchParams({
        src: tokenIn,
        dst: tokenOut,
        amount: amountIn,
    });
    const headers = {
        'Accept': 'application/json',
    };
    // Add API key if configured
    if (config_1.ONEINCH_API_KEY) {
        headers['Authorization'] = `Bearer ${config_1.ONEINCH_API_KEY}`;
    }
    try {
        console.log('[1inch] Fetching quote:', { chainId, tokenIn, tokenOut, amountIn });
        const response = await fetch(`${apiUrl}?${params.toString()}`, {
            method: 'GET',
            headers,
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.warn('[1inch] Quote API error:', response.status, errorText);
            // Return undefined to trigger fallback
            return undefined;
        }
        const data = await response.json();
        // Parse 1inch response
        const protocols = extractProtocols(data.protocols);
        const routeSummary = buildRouteSummary(data);
        const result = {
            toTokenAmount: data.toAmount || data.toTokenAmount,
            estimatedGas: data.gas?.toString() || data.estimatedGas?.toString() || '0',
            protocols,
            routeSummary,
            aggregator: '1inch',
            fromToken: {
                symbol: data.fromToken?.symbol || 'UNKNOWN',
                decimals: data.fromToken?.decimals || 18,
            },
            toToken: {
                symbol: data.toToken?.symbol || 'UNKNOWN',
                decimals: data.toToken?.decimals || 18,
            },
        };
        console.log('[1inch] Quote received:', {
            toTokenAmount: result.toTokenAmount,
            protocols: result.protocols,
            routeSummary: result.routeSummary,
        });
        return result;
    }
    catch (error) {
        console.warn('[1inch] Quote fetch failed:', error.message);
        return undefined;
    }
}
/**
 * Extract protocol names from 1inch protocols response
 */
function extractProtocols(protocols) {
    if (!protocols || !Array.isArray(protocols)) {
        return ['Unknown'];
    }
    // 1inch returns nested array structure for multi-hop routes
    const protocolNames = new Set();
    const extractFromArray = (arr) => {
        for (const item of arr) {
            if (Array.isArray(item)) {
                extractFromArray(item);
            }
            else if (typeof item === 'object' && item.name) {
                protocolNames.add(item.name);
            }
            else if (typeof item === 'string') {
                protocolNames.add(item);
            }
        }
    };
    extractFromArray(protocols);
    return Array.from(protocolNames);
}
/**
 * Build a human-readable route summary
 */
function buildRouteSummary(data) {
    const fromSymbol = data.fromToken?.symbol || 'Token';
    const toSymbol = data.toToken?.symbol || 'Token';
    const protocols = extractProtocols(data.protocols);
    if (protocols.length === 0 || protocols[0] === 'Unknown') {
        return `${fromSymbol} → ${toSymbol}`;
    }
    if (protocols.length === 1) {
        return `${fromSymbol} → ${toSymbol} via ${protocols[0]}`;
    }
    return `${fromSymbol} → ${toSymbol} via ${protocols.slice(0, 3).join(' + ')}${protocols.length > 3 ? ' +more' : ''}`;
}
/**
 * Check if 1inch routing is available
 */
function isOneInchAvailable() {
    // 1inch is available if we have an API key or can use unauthenticated access
    // For Sepolia, 1inch may not have data, but we try anyway
    return true; // Always attempt, gracefully fail
}
/**
 * Get supported chain ID for 1inch
 * Note: 1inch doesn't support Sepolia directly, but we can still call it
 * and fall back gracefully.
 */
function getOneInchChainId() {
    // For demo, we use Sepolia chain ID even though 1inch may not support it
    // This allows the code path to work, and we fall back to deterministic quotes
    return config_1.ETH_TESTNET_CHAIN_ID;
}
//# sourceMappingURL=oneInchQuote.js.map