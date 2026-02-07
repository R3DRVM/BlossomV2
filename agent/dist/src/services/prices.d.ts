/**
 * Price Service
 * Fetches real market prices with safe fallbacks
 */
export type PriceSymbol = 'ETH' | 'BTC' | 'SOL' | 'REDACTED' | 'AVAX' | 'LINK';
export interface PriceSnapshot {
    symbol: PriceSymbol;
    priceUsd: number;
    source: 'coingecko' | 'static' | 'pyth' | 'jupiter';
    fetchedAt: number;
}
/**
 * Get price for a symbol, with caching and fallback
 */
export declare function getPrice(symbol: PriceSymbol): Promise<PriceSnapshot>;
/**
 * Clear price cache (useful for testing)
 */
export declare function clearPriceCache(): void;
//# sourceMappingURL=prices.d.ts.map