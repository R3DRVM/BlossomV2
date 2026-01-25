/**
 * LiFi Bridge Quote Integration
 *
 * Minimal integration to attempt LiFi quotes for cross-chain bridging.
 * This is a "quote + failure" first approach - we attempt quotes but
 * may not execute if bridging is not fully implemented.
 *
 * Uses LiFi public API (no API key required for quotes)
 * https://docs.li.fi/li.fi-api/li.fi-api
 */
// LiFi API base URL
const LIFI_API_BASE = 'https://li.quest/v1';
// Supported chains for quoting
const CHAIN_IDS = {
    ethereum: 1,
    sepolia: 11155111,
    solana: 1151111081099710, // LiFi's Solana chain ID
    arbitrum: 42161,
    optimism: 10,
    polygon: 137,
    base: 8453,
};
// Common token addresses
const TOKEN_ADDRESSES = {
    // Ethereum mainnet
    'REDACTED:ethereum': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    'USDT:ethereum': '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    'WETH:ethereum': '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    // Sepolia testnet
    'REDACTED:sepolia': '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8',
    'WETH:sepolia': '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
};
// Error codes for categorization
export const LiFiErrorCodes = {
    LIFI_UNREACHABLE: 'LIFI_UNREACHABLE',
    LIFI_NO_ROUTE: 'LIFI_NO_ROUTE',
    LIFI_QUOTE_FAILED: 'LIFI_QUOTE_FAILED',
    LIFI_INVALID_PARAMS: 'LIFI_INVALID_PARAMS',
    LIFI_RATE_LIMITED: 'LIFI_RATE_LIMITED',
    LIFI_UNSUPPORTED_CHAIN: 'LIFI_UNSUPPORTED_CHAIN',
};
/**
 * Resolve chain name to LiFi chain ID
 */
function resolveChainId(chain) {
    const normalized = chain.toLowerCase();
    return CHAIN_IDS[normalized] ?? null;
}
/**
 * Resolve token to address for a given chain
 * Returns the native token placeholder (0x0...0) for native tokens
 */
function resolveTokenAddress(token, chain) {
    // Native token
    if (['ETH', 'SOL'].includes(token.toUpperCase())) {
        return '0x0000000000000000000000000000000000000000';
    }
    // Check known addresses
    const key = `${token.toUpperCase()}:${chain.toLowerCase()}`;
    if (TOKEN_ADDRESSES[key]) {
        return TOKEN_ADDRESSES[key];
    }
    // If it looks like an address, use it directly
    if (token.startsWith('0x') && token.length === 42) {
        return token;
    }
    // Default: assume it's a symbol and use placeholder
    // LiFi API can sometimes resolve symbols
    return token;
}
/**
 * Get a quote from LiFi for a cross-chain swap/bridge
 *
 * @param params Quote parameters
 * @returns Quote result with success/failure status
 */
export async function getLiFiQuote(params) {
    try {
        // Resolve chain IDs
        const fromChainId = resolveChainId(params.fromChain);
        const toChainId = resolveChainId(params.toChain);
        if (!fromChainId) {
            return {
                ok: false,
                error: {
                    code: LiFiErrorCodes.LIFI_UNSUPPORTED_CHAIN,
                    message: `Unsupported source chain: ${params.fromChain}`,
                },
            };
        }
        if (!toChainId) {
            return {
                ok: false,
                error: {
                    code: LiFiErrorCodes.LIFI_UNSUPPORTED_CHAIN,
                    message: `Unsupported destination chain: ${params.toChain}`,
                },
            };
        }
        // Resolve token addresses
        const fromTokenAddress = resolveTokenAddress(params.fromToken, params.fromChain);
        const toTokenAddress = resolveTokenAddress(params.toToken, params.toChain);
        // Build query params
        const queryParams = new URLSearchParams({
            fromChain: fromChainId.toString(),
            toChain: toChainId.toString(),
            fromToken: fromTokenAddress,
            toToken: toTokenAddress,
            fromAmount: params.fromAmount,
            slippage: (params.slippage ?? 0.005).toString(),
        });
        if (params.fromAddress) {
            queryParams.set('fromAddress', params.fromAddress);
        }
        // Make request with timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout
        try {
            const response = await fetch(`${LIFI_API_BASE}/quote?${queryParams}`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                },
                signal: controller.signal,
            });
            clearTimeout(timeout);
            if (response.status === 429) {
                return {
                    ok: false,
                    error: {
                        code: LiFiErrorCodes.LIFI_RATE_LIMITED,
                        message: 'LiFi API rate limit exceeded',
                    },
                };
            }
            const data = await response.json();
            if (!response.ok) {
                // LiFi returns structured errors
                const errorMessage = data.message || data.error || 'Quote request failed';
                // Categorize the error
                let errorCode = LiFiErrorCodes.LIFI_QUOTE_FAILED;
                if (errorMessage.toLowerCase().includes('no route')) {
                    errorCode = LiFiErrorCodes.LIFI_NO_ROUTE;
                }
                else if (errorMessage.toLowerCase().includes('invalid')) {
                    errorCode = LiFiErrorCodes.LIFI_INVALID_PARAMS;
                }
                return {
                    ok: false,
                    error: {
                        code: errorCode,
                        message: errorMessage.slice(0, 200),
                    },
                };
            }
            // Parse successful quote
            const quote = data;
            return {
                ok: true,
                quote: {
                    id: quote.id || 'unknown',
                    type: quote.type || 'BRIDGE',
                    tool: quote.tool || quote.toolDetails?.name || 'unknown',
                    toolDetails: quote.toolDetails || { name: 'unknown', logoURI: '' },
                    fromChain: fromChainId,
                    toChain: toChainId,
                    fromToken: {
                        address: quote.action?.fromToken?.address || fromTokenAddress,
                        symbol: quote.action?.fromToken?.symbol || params.fromToken,
                        decimals: quote.action?.fromToken?.decimals || 18,
                    },
                    toToken: {
                        address: quote.action?.toToken?.address || toTokenAddress,
                        symbol: quote.action?.toToken?.symbol || params.toToken,
                        decimals: quote.action?.toToken?.decimals || 18,
                    },
                    fromAmount: quote.action?.fromAmount || params.fromAmount,
                    toAmount: quote.estimate?.toAmount || '0',
                    toAmountMin: quote.estimate?.toAmountMin || '0',
                    estimatedDuration: quote.estimate?.executionDuration || 300,
                    feeCosts: quote.estimate?.feeCosts || [],
                    gasCosts: quote.estimate?.gasCosts || [],
                },
            };
        }
        catch (fetchError) {
            clearTimeout(timeout);
            if (fetchError.name === 'AbortError') {
                return {
                    ok: false,
                    error: {
                        code: LiFiErrorCodes.LIFI_UNREACHABLE,
                        message: 'LiFi API request timed out',
                    },
                };
            }
            throw fetchError;
        }
    }
    catch (error) {
        return {
            ok: false,
            error: {
                code: LiFiErrorCodes.LIFI_UNREACHABLE,
                message: `LiFi API error: ${error.message?.slice(0, 150) || 'Unknown error'}`,
            },
        };
    }
}
/**
 * Check if LiFi API is reachable
 */
export async function checkLiFiHealth() {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(`${LIFI_API_BASE}/chains`, {
            method: 'GET',
            signal: controller.signal,
        });
        clearTimeout(timeout);
        return response.ok;
    }
    catch {
        return false;
    }
}
/**
 * Get supported chains from LiFi
 */
export async function getLiFiChains() {
    try {
        const response = await fetch(`${LIFI_API_BASE}/chains`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
        });
        if (!response.ok) {
            return [];
        }
        const data = await response.json();
        return (data.chains || []).map((c) => ({
            id: c.id,
            name: c.name,
            key: c.key,
        }));
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=lifi.js.map