/**
 * DefiLlama Yield Quote Provider
 * Fetches yield data from https://yields.llama.fi/pools
 * Caches results in-memory for 5 minutes
 */
interface VaultRecommendation {
    name: string;
    apy: number;
    tvl: number;
    poolId: string;
    protocol: string;
}
/**
 * Fetch top yield vaults from DefiLlama
 * Returns top 3-5 stablecoin-like pools on Ethereum
 */
export declare function getTopYieldVaults(): Promise<VaultRecommendation[]>;
/**
 * Get vault recommendation for a given amount
 * Returns highest APY vault
 */
export declare function getVaultRecommendation(amountUsd?: number): Promise<VaultRecommendation | null>;
export {};
//# sourceMappingURL=defiLlamaQuote.d.ts.map