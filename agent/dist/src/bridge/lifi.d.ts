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
export interface LiFiQuoteParams {
    fromChain: string;
    toChain: string;
    fromToken: string;
    toToken: string;
    fromAmount: string;
    fromAddress?: string;
    slippage?: number;
}
export interface LiFiQuoteResult {
    ok: boolean;
    quote?: {
        id: string;
        type: string;
        tool: string;
        toolDetails: {
            name: string;
            logoURI: string;
        };
        fromChain: number;
        toChain: number;
        fromToken: {
            address: string;
            symbol: string;
            decimals: number;
        };
        toToken: {
            address: string;
            symbol: string;
            decimals: number;
        };
        fromAmount: string;
        toAmount: string;
        toAmountMin: string;
        estimatedDuration: number;
        feeCosts: Array<{
            name: string;
            amount: string;
            amountUSD: string;
        }>;
        gasCosts: Array<{
            amount: string;
            amountUSD: string;
        }>;
    };
    error?: {
        code: string;
        message: string;
    };
}
export declare const LiFiErrorCodes: {
    readonly LIFI_UNREACHABLE: "LIFI_UNREACHABLE";
    readonly LIFI_NO_ROUTE: "LIFI_NO_ROUTE";
    readonly LIFI_QUOTE_FAILED: "LIFI_QUOTE_FAILED";
    readonly LIFI_INVALID_PARAMS: "LIFI_INVALID_PARAMS";
    readonly LIFI_RATE_LIMITED: "LIFI_RATE_LIMITED";
    readonly LIFI_UNSUPPORTED_CHAIN: "LIFI_UNSUPPORTED_CHAIN";
};
/**
 * Get a quote from LiFi for a cross-chain swap/bridge
 *
 * @param params Quote parameters
 * @returns Quote result with success/failure status
 */
export declare function getLiFiQuote(params: LiFiQuoteParams): Promise<LiFiQuoteResult>;
/**
 * Check if LiFi API is reachable
 */
export declare function checkLiFiHealth(): Promise<boolean>;
/**
 * Get supported chains from LiFi
 */
export declare function getLiFiChains(): Promise<{
    id: number;
    name: string;
    key: string;
}[]>;
/**
 * LiFi transaction request from quote
 */
export interface LiFiTransactionRequest {
    to: string;
    data: string;
    value: string;
    gasLimit?: string;
    gasPrice?: string;
    chainId: number;
}
/**
 * Execute result from LiFi bridge
 */
export interface LiFiExecuteResult {
    ok: boolean;
    txHash?: string;
    status?: 'pending' | 'success' | 'failed';
    error?: {
        code: string;
        message: string;
    };
}
/**
 * Bridge execution status
 */
export interface LiFiStatus {
    status: 'NOT_FOUND' | 'PENDING' | 'DONE' | 'FAILED';
    substatus?: string;
    sending?: {
        txHash: string;
        amount: string;
        token: string;
    };
    receiving?: {
        txHash: string;
        amount: string;
        token: string;
    };
    tool?: string;
    lifiExplorerLink?: string;
}
/**
 * Get route from LiFi with transaction data
 * Returns full transaction data for execution
 *
 * SECURITY NOTE: This returns unsigned transaction data.
 * The frontend must sign this with the user's wallet (non-custodial).
 * DO NOT sign or submit transactions on behalf of users without explicit delegation.
 */
export declare function getLiFiRoute(params: LiFiQuoteParams & {
    fromAddress: string;
    toAddress?: string;
}): Promise<{
    ok: boolean;
    transactionRequest?: LiFiTransactionRequest;
    quote?: LiFiQuoteResult['quote'];
    error?: {
        code: string;
        message: string;
    };
}>;
/**
 * Track LiFi bridge status
 * Polls the LiFi API for transaction status
 */
export declare function trackLiFiStatus(txHash: string, fromChainId: number): Promise<LiFiStatus>;
/**
 * Poll for bridge completion
 * Returns when bridge is complete or timeout reached
 *
 * @param txHash Source chain transaction hash
 * @param fromChainId Source chain ID
 * @param maxWaitMs Maximum wait time (default 5 minutes)
 * @param pollIntervalMs Poll interval (default 10 seconds)
 */
export declare function waitForBridgeCompletion(txHash: string, fromChainId: number, maxWaitMs?: number, pollIntervalMs?: number): Promise<LiFiStatus>;
//# sourceMappingURL=lifi.d.ts.map