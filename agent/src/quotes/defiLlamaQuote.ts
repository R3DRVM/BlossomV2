/**
 * DefiLlama Yield Quote Provider
 * Fetches yield data from https://yields.llama.fi/pools
 * Caches results in-memory for 5 minutes
 */

interface DefiLlamaPool {
  apy: number;
  apyBase: number;
  apyReward?: number;
  symbol: string;
  tvlUsd?: number;
  pool: string;
  project: string;
  chain: string;
  poolMeta?: string;
}

interface VaultRecommendation {
  name: string;
  apy: number;
  tvl: number;
  poolId: string;
  protocol: string;
}

// In-memory cache (5 minutes)
let cachedVaults: VaultRecommendation[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Hardcoded fallback vaults
const FALLBACK_VAULTS: VaultRecommendation[] = [
  { name: 'Aave REDACTED', apy: 5.0, tvl: 1000000, poolId: 'demo-aave-usdc', protocol: 'Aave' },
  { name: 'Compound REDACTED', apy: 4.5, tvl: 800000, poolId: 'demo-compound-usdc', protocol: 'Compound' },
  { name: 'Aave USDT', apy: 4.8, tvl: 600000, poolId: 'demo-aave-usdt', protocol: 'Aave' },
];

/**
 * Fetch top yield vaults from DefiLlama
 * Returns top 3-5 stablecoin-like pools on Ethereum
 */
export async function getTopYieldVaults(): Promise<VaultRecommendation[]> {
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
    const pools: DefiLlamaPool[] = data.data || [];

    // Filter: Ethereum chain, stablecoin-like pools
    const stablecoinSymbols = ['REDACTED', 'USDT', 'DAI', 'REDACTED.e', 'USDT.e'];
    const ethereumPools = pools.filter((pool) => {
      const isEthereum = pool.chain === 'Ethereum' || pool.chain === 'ethereum';
      const isStablecoin = stablecoinSymbols.some((sym) => 
        pool.symbol?.toUpperCase().includes(sym)
      );
      return isEthereum && isStablecoin && pool.apy > 0;
    });

    // Sort by APY descending, take top 5
    ethereumPools.sort((a, b) => (b.apy || 0) - (a.apy || 0));
    const topPools = ethereumPools.slice(0, 5);

    // Transform to VaultRecommendation format
    const vaults: VaultRecommendation[] = topPools.map((pool) => ({
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
  } catch (error: any) {
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
export async function getVaultRecommendation(amountUsd?: number): Promise<VaultRecommendation | null> {
  const vaults = await getTopYieldVaults();
  if (vaults.length === 0) {
    return null;
  }
  // Return highest APY vault
  return vaults[0];
}

// DeFi Protocol TVL Data
export interface DefiProtocolTVL {
  name: string;
  tvl: number; // in USD
  tvlFormatted: string; // e.g., "$34.2B"
  category: string; // e.g., "Lending", "Liquid Staking"
  chains: string[]; // e.g., ["Ethereum", "Polygon"]
  slug: string;
}

// Cache for protocol TVL data (5 minutes)
let cachedProtocolsTVL: DefiProtocolTVL[] | null = null;
let protocolsCacheTimestamp: number = 0;

// Fallback protocols if API fails
const FALLBACK_PROTOCOLS: DefiProtocolTVL[] = [
  { name: 'Aave V3', tvl: 34200000000, tvlFormatted: '$34.2B', category: 'Lending', chains: ['Ethereum', 'Polygon'], slug: 'aave' },
  { name: 'Lido', tvl: 28000000000, tvlFormatted: '$28.0B', category: 'Liquid Staking', chains: ['Ethereum'], slug: 'lido' },
  { name: 'MakerDAO', tvl: 13900000000, tvlFormatted: '$13.9B', category: 'CDP', chains: ['Ethereum'], slug: 'makerdao' },
  { name: 'Curve', tvl: 11300000000, tvlFormatted: '$11.3B', category: 'Dexes', chains: ['Ethereum', 'Arbitrum'], slug: 'curve' },
  { name: 'AAVE', tvl: 8800000000, tvlFormatted: '$8.8B', category: 'Lending', chains: ['Ethereum', 'Avalanche'], slug: 'aave-v2' },
];

/**
 * Format USD amount to human-readable string
 */
function formatTVL(tvl: number): string {
  if (tvl >= 1_000_000_000) {
    return `$${(tvl / 1_000_000_000).toFixed(1)}B`;
  } else if (tvl >= 1_000_000) {
    return `$${(tvl / 1_000_000).toFixed(1)}M`;
  } else {
    return `$${Math.round(tvl).toLocaleString()}`;
  }
}

/**
 * Fetch top DeFi protocols by TVL from DefiLlama
 * Returns top 5-10 protocols sorted by TVL descending
 */
export async function getTopProtocolsByTVL(limit: number = 5): Promise<DefiProtocolTVL[]> {
  // Check cache
  const now = Date.now();
  if (cachedProtocolsTVL && (now - protocolsCacheTimestamp) < CACHE_TTL_MS) {
    return cachedProtocolsTVL.slice(0, limit);
  }

  try {
    const response = await fetch('https://api.llama.fi/protocols', {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`DefiLlama protocols API returned ${response.status}`);
    }

    const protocols: any[] = await response.json();

    // CEX exclusion patterns (matching defiProtocols.ts)
    const cexCategories = ['cex', 'centralized exchange', 'cefi'];
    const cexNamePatterns = ['binance', 'okx', 'okex', 'bitfinex', 'coinbase', 'kraken', 'huobi', 'bybit', 'gate.io', 'kucoin'];

    // Filter out protocols with no TVL, no category, and exclude CEXs
    const protocolsWithTVL = protocols
      .filter((p) => {
        // Basic validation
        if (!p.tvl || p.tvl <= 0 || !p.name || !p.category) return false;

        // Exclude CEX by category (case-insensitive)
        const categoryLower = String(p.category).toLowerCase();
        if (cexCategories.some(cexCat => categoryLower.includes(cexCat))) return false;

        // Exclude CEX by name pattern (case-insensitive safety net)
        const nameLower = String(p.name).toLowerCase();
        if (cexNamePatterns.some(cexName => nameLower.includes(cexName))) return false;

        return true;
      })
      .map((p) => ({
        name: p.name,
        tvl: p.tvl || 0,
        tvlFormatted: formatTVL(p.tvl || 0),
        category: p.category || 'DeFi',
        chains: p.chains || ['Ethereum'],
        slug: p.slug || p.name.toLowerCase().replace(/\s+/g, '-'),
      }));

    // Sort by TVL descending
    protocolsWithTVL.sort((a, b) => b.tvl - a.tvl);

    // Update cache
    cachedProtocolsTVL = protocolsWithTVL;
    protocolsCacheTimestamp = now;

    return protocolsWithTVL.slice(0, limit);
  } catch (error: any) {
    console.warn('[getTopProtocolsByTVL] Failed to fetch from DefiLlama:', error.message);
    // Return fallback
    cachedProtocolsTVL = FALLBACK_PROTOCOLS;
    protocolsCacheTimestamp = now;
    return FALLBACK_PROTOCOLS.slice(0, limit);
  }
}


