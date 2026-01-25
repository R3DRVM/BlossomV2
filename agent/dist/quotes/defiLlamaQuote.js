/**
 * DefiLlama Yield Quote Provider
 * Fetches yield data from https://yields.llama.fi/pools
 * Caches results in-memory for 5 minutes
 */
// In-memory cache (5 minutes)
let cachedVaults = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
// Hardcoded fallback vaults
const FALLBACK_VAULTS = [
    { name: 'Aave REDACTED', apy: 5.0, tvl: 1000000, poolId: 'demo-aave-usdc', protocol: 'Aave' },
    { name: 'Compound REDACTED', apy: 4.5, tvl: 800000, poolId: 'demo-compound-usdc', protocol: 'Compound' },
    { name: 'Aave USDT', apy: 4.8, tvl: 600000, poolId: 'demo-aave-usdt', protocol: 'Aave' },
];
/**
 * Fetch top yield vaults from DefiLlama
 * Returns top 3-5 stablecoin-like pools on Ethereum
 */
export async function getTopYieldVaults() {
    // Check cache
    const now = Date.now();
    if (cachedVaults && (now - cacheTimestamp) < CACHE_TTL_MS) {
        return cachedVaults;
    }
    try {
        const response = await fetch('https://yields.llama.fi/pools', {
            headers: {
                'Accept': 'application/json',
            },
        });
        if (!response.ok) {
            throw new Error(`DefiLlama API returned ${response.status}`);
        }
        const data = await response.json();
        const pools = data.data || [];
        // Filter: Ethereum chain, stablecoin-like pools
        const stablecoinSymbols = ['REDACTED', 'USDT', 'DAI', 'REDACTED.e', 'USDT.e'];
        const ethereumPools = pools.filter((pool) => {
            const isEthereum = pool.chain === 'Ethereum' || pool.chain === 'ethereum';
            const isStablecoin = stablecoinSymbols.some((sym) => pool.symbol?.toUpperCase().includes(sym));
            return isEthereum && isStablecoin && pool.apy > 0;
        });
        // Sort by APY descending, take top 5
        ethereumPools.sort((a, b) => (b.apy || 0) - (a.apy || 0));
        const topPools = ethereumPools.slice(0, 5);
        // Transform to VaultRecommendation format
        const vaults = topPools.map((pool) => ({
            name: `${pool.project} ${pool.symbol}`,
            apy: pool.apy || 0,
            tvl: pool.tvlUsd || 0,
            poolId: pool.pool || pool.project,
            protocol: pool.project || 'Unknown',
        }));
        // Update cache
        cachedVaults = vaults.length > 0 ? vaults : FALLBACK_VAULTS;
        cacheTimestamp = now;
        return cachedVaults;
    }
    catch (error) {
        console.warn('[getTopYieldVaults] Failed to fetch from DefiLlama:', error.message);
        // Return fallback
        cachedVaults = FALLBACK_VAULTS;
        cacheTimestamp = now;
        return FALLBACK_VAULTS;
    }
}
/**
 * Get vault recommendation for a given amount
 * Returns highest APY vault
 */
export async function getVaultRecommendation(amountUsd) {
    const vaults = await getTopYieldVaults();
    if (vaults.length === 0) {
        return null;
    }
    // Return highest APY vault
    return vaults[0];
}
//# sourceMappingURL=defiLlamaQuote.js.map