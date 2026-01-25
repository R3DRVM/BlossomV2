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
//# sourceMappingURL=lifi.d.ts.map