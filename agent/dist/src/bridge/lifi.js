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
/**
 * Get route from LiFi with transaction data
 * Returns full transaction data for execution
 *
 * SECURITY NOTE: This returns unsigned transaction data.
 * The frontend must sign this with the user's wallet (non-custodial).
 * DO NOT sign or submit transactions on behalf of users without explicit delegation.
 */
export async function getLiFiRoute(params) {
    try {
        const fromChainId = resolveChainId(params.fromChain);
        const toChainId = resolveChainId(params.toChain);
        if (!fromChainId || !toChainId) {
            return {
                ok: false,
                error: {
                    code: LiFiErrorCodes.LIFI_UNSUPPORTED_CHAIN,
                    message: `Unsupported chain: ${params.fromChain} or ${params.toChain}`,
                },
            };
        }
        const fromTokenAddress = resolveTokenAddress(params.fromToken, params.fromChain);
        const toTokenAddress = resolveTokenAddress(params.toToken, params.toChain);
        const queryParams = new URLSearchParams({
            fromChain: fromChainId.toString(),
            toChain: toChainId.toString(),
            fromToken: fromTokenAddress,
            toToken: toTokenAddress,
            fromAmount: params.fromAmount,
            fromAddress: params.fromAddress,
            toAddress: params.toAddress || params.fromAddress,
            slippage: (params.slippage ?? 0.005).toString(),
        });
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch(`${LIFI_API_BASE}/quote?${queryParams}`, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                signal: controller.signal,
            });
            clearTimeout(timeout);
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                return {
                    ok: false,
                    error: {
                        code: LiFiErrorCodes.LIFI_QUOTE_FAILED,
                        message: data.message || 'Route request failed',
                    },
                };
            }
            const data = await response.json();
            // Extract transaction request
            const transactionRequest = {
                to: data.transactionRequest?.to || '',
                data: data.transactionRequest?.data || '',
                value: data.transactionRequest?.value || '0',
                gasLimit: data.transactionRequest?.gasLimit,
                gasPrice: data.transactionRequest?.gasPrice,
                chainId: fromChainId,
            };
            if (!transactionRequest.to || !transactionRequest.data) {
                return {
                    ok: false,
                    error: {
                        code: LiFiErrorCodes.LIFI_QUOTE_FAILED,
                        message: 'No transaction data in route response',
                    },
                };
            }
            return {
                ok: true,
                transactionRequest,
                quote: {
                    id: data.id,
                    type: data.type || 'BRIDGE',
                    tool: data.tool,
                    toolDetails: data.toolDetails,
                    fromChain: fromChainId,
                    toChain: toChainId,
                    fromToken: data.action?.fromToken,
                    toToken: data.action?.toToken,
                    fromAmount: data.action?.fromAmount,
                    toAmount: data.estimate?.toAmount,
                    toAmountMin: data.estimate?.toAmountMin,
                    estimatedDuration: data.estimate?.executionDuration || 300,
                    feeCosts: data.estimate?.feeCosts || [],
                    gasCosts: data.estimate?.gasCosts || [],
                },
            };
        }
        catch (fetchError) {
            clearTimeout(timeout);
            throw fetchError;
        }
    }
    catch (error) {
        return {
            ok: false,
            error: {
                code: LiFiErrorCodes.LIFI_UNREACHABLE,
                message: error.message || 'LiFi route request failed',
            },
        };
    }
}
/**
 * Track LiFi bridge status
 * Polls the LiFi API for transaction status
 */
export async function trackLiFiStatus(txHash, fromChainId) {
    try {
        const response = await fetch(`${LIFI_API_BASE}/status?txHash=${txHash}&fromChain=${fromChainId}`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
        });
        if (!response.ok) {
            return { status: 'NOT_FOUND' };
        }
        const data = await response.json();
        return {
            status: data.status || 'NOT_FOUND',
            substatus: data.substatus,
            sending: data.sending
                ? {
                    txHash: data.sending.txHash,
                    amount: data.sending.amount,
                    token: data.sending.token?.symbol || '',
                }
                : undefined,
            receiving: data.receiving
                ? {
                    txHash: data.receiving.txHash,
                    amount: data.receiving.amount,
                    token: data.receiving.token?.symbol || '',
                }
                : undefined,
            tool: data.tool,
            lifiExplorerLink: data.lifiExplorerLink,
        };
    }
    catch {
        return { status: 'NOT_FOUND' };
    }
}
/**
 * Poll for bridge completion
 * Returns when bridge is complete or timeout reached
 *
 * @param txHash Source chain transaction hash
 * @param fromChainId Source chain ID
 * @param maxWaitMs Maximum wait time (default 5 minutes)
 * @param pollIntervalMs Poll interval (default 10 seconds)
 */
export async function waitForBridgeCompletion(txHash, fromChainId, maxWaitMs = 5 * 60 * 1000, pollIntervalMs = 10 * 1000) {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
        const status = await trackLiFiStatus(txHash, fromChainId);
        if (status.status === 'DONE' || status.status === 'FAILED') {
            return status;
        }
        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
    // Timeout - return last known status
    return await trackLiFiStatus(txHash, fromChainId);
}
//# sourceMappingURL=lifi.js.map