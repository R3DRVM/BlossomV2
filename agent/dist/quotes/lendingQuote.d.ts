/**
 * Lending Quote Provider
 * Provides routing metadata for lending operations
 * Supports hybrid model: real APR data from DefiLlama + deterministic execution
 */
export interface LendingQuoteRequest {
    asset: string;
    amount: string;
    vaultAddress?: string;
}
export interface LendingRoutingDecision {
    routingSource: 'defillama' | 'deterministic';
    apr: string;
    aprBps: number;
    protocol: string;
    executionVenue: string;
    executionNote: string;
    vault: string;
    chain: string;
    chainId: number;
    settlementEstimate: string;
    warnings?: string[];
}
/**
 * Get lending routing decision with APR data
 * Uses DefiLlama for real rates (when available), falls back to deterministic
 */
export declare function getLendingRoutingDecision(request: LendingQuoteRequest): Promise<LendingRoutingDecision>;
/**
 * Get informational APR for display (demo vault)
 */
export declare function getDemoVaultApr(): {
    apr: string;
    aprBps: number;
};
//# sourceMappingURL=lendingQuote.d.ts.map