/**
 * Price Service
 * Fetches real market prices with safe fallbacks
 */

export type PriceSymbol = 'ETH' | 'BTC' | 'SOL' | 'REDACTED' | 'AVAX' | 'LINK';

export interface PriceSnapshot {
  symbol: PriceSymbol;
  priceUsd: number;
  source: 'coingecko' | 'static';
  fetchedAt: number;
}

// In-memory cache
const priceCache = new Map<PriceSymbol, PriceSnapshot>();

// Static fallback prices
const STATIC_PRICES: Record<PriceSymbol, number> = {
  ETH: 3000,
  BTC: 60000,
  SOL: 150,
  REDACTED: 1,
  AVAX: 35,
  LINK: 14,
};

// Cache TTL: 12 seconds
const CACHE_TTL_MS = 12 * 1000;

/**
 * Get price for a symbol, with caching and fallback
 */
export async function getPrice(symbol: PriceSymbol): Promise<PriceSnapshot> {
  // Check cache first
  const cached = priceCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }

  // Try to fetch from CoinGecko
  try {
    const price = await fetchFromCoinGecko(symbol);
    const snapshot: PriceSnapshot = {
      symbol,
      priceUsd: price,
      source: 'coingecko',
      fetchedAt: Date.now(),
    };
    priceCache.set(symbol, snapshot);
    return snapshot;
  } catch (error) {
    console.warn(`Failed to fetch ${symbol} price from CoinGecko, using static fallback:`, error);
  }

  // Fallback to static price
  const snapshot: PriceSnapshot = {
    symbol,
    priceUsd: STATIC_PRICES[symbol],
    source: 'static',
    fetchedAt: Date.now(),
  };
  priceCache.set(symbol, snapshot);
  return snapshot;
}

/**
 * Fetch price from CoinGecko public API
 */
async function fetchFromCoinGecko(symbol: PriceSymbol): Promise<number> {
  // CoinGecko API mapping
  const coinGeckoIds: Record<PriceSymbol, string> = {
    ETH: 'ethereum',
    BTC: 'bitcoin',
    SOL: 'solana',
    REDACTED: 'usd-coin',
    AVAX: 'avalanche-2',
    LINK: 'chainlink',
  };

  const coinId = coinGeckoIds[symbol];
  if (!coinId) {
    throw new Error(`Unsupported symbol: ${symbol}`);
  }

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`;
  
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`CoinGecko API error: ${response.status}`);
  }

  const data = await response.json() as Record<string, { usd: number }>;
  const price = data[coinId]?.usd;
  
  if (typeof price !== 'number' || price <= 0) {
    throw new Error(`Invalid price data from CoinGecko: ${price}`);
  }

  return price;
}

/**
 * Clear price cache (useful for testing)
 */
export function clearPriceCache(): void {
  priceCache.clear();
}

