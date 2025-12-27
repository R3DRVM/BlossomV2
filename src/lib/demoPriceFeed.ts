/**
 * Demo Price Feed - CoinGecko Public API (no keys required, CORS-safe)
 * Uses CoinGecko simple/price endpoint with backoff on failures
 */

export type DemoSymbol = 'BTC' | 'ETH' | 'SOL' | 'AVAX' | 'LINK';

export interface DemoPriceSnapshot {
  priceUsd: number;
  change24hPct?: number;
  lastUpdatedMs: number;
  source: 'coingecko' | 'static';
  isLive: boolean;
}

interface CoinGeckoResponse {
  [coinId: string]: {
    usd: number;
    usd_24h_change?: number;
  };
}

// Module-level cache (12s TTL)
interface PriceCache {
  data: Record<DemoSymbol, DemoPriceSnapshot>;
  fetchedAt: number;
}

let priceCache: PriceCache | null = null;
const CACHE_TTL_MS = 12 * 1000;

// In-flight request deduplication
let inFlightRequest: Promise<Record<DemoSymbol, DemoPriceSnapshot>> | null = null;

// Backoff state
let failureCount = 0;
let nextAllowedFetchMs = 0;
const BACKOFF_DELAYS = [15000, 30000, 60000]; // 15s, 30s, 60s
const MAX_BACKOFF_MS = 60000;

// Static fallback prices
const STATIC_PRICES: Record<DemoSymbol, { priceUsd: number; change24hPct: number }> = {
  BTC: { priceUsd: 60000, change24hPct: 2.5 },
  ETH: { priceUsd: 3000, change24hPct: 1.8 },
  SOL: { priceUsd: 150, change24hPct: -0.5 },
  AVAX: { priceUsd: 35, change24hPct: 3.2 },
  LINK: { priceUsd: 14, change24hPct: 0.8 },
};

// CoinGecko ID mapping
const COINGECKO_IDS: Record<DemoSymbol, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  AVAX: 'avalanche-2',
  LINK: 'chainlink',
};

/**
 * Fetch prices from CoinGecko Public API (CORS-safe, no key required)
 */
async function fetchFromCoinGecko(symbols: DemoSymbol[]): Promise<Record<DemoSymbol, DemoPriceSnapshot> | null> {
  try {
    const coinIds = symbols.map(s => COINGECKO_IDS[s]).join(',');
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds}&vs_currencies=usd&include_24hr_change=true`;
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      return null;
    }

    const data: CoinGeckoResponse = await response.json();
    const results: Partial<Record<DemoSymbol, DemoPriceSnapshot>> = {};

    for (const symbol of symbols) {
      const coinId = COINGECKO_IDS[symbol];
      const coinData = data[coinId];
      
      if (coinData && coinData.usd && coinData.usd > 0) {
        results[symbol] = {
          priceUsd: coinData.usd,
          change24hPct: coinData.usd_24h_change !== undefined ? coinData.usd_24h_change : undefined,
          lastUpdatedMs: Date.now(),
          source: 'coingecko',
          isLive: true,
        };
      }
    }

    // If we got at least one valid price, return results
    if (Object.keys(results).length > 0) {
      // Reset failure count on success
      failureCount = 0;
      nextAllowedFetchMs = 0;
      
      // Fill missing symbols with static fallback
      const finalResults: Record<DemoSymbol, DemoPriceSnapshot> = {} as Record<DemoSymbol, DemoPriceSnapshot>;
      for (const symbol of symbols) {
        if (results[symbol]) {
          finalResults[symbol] = results[symbol]!;
        } else {
          const staticData = STATIC_PRICES[symbol];
          finalResults[symbol] = {
            priceUsd: staticData.priceUsd,
            change24hPct: staticData.change24hPct,
            lastUpdatedMs: Date.now(),
            source: 'static',
            isLive: false,
          };
        }
      }
      
      return finalResults;
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Get demo spot prices for symbols (with caching, deduplication, and backoff)
 * Never throws - always returns best-effort payload
 */
export async function getDemoSpotPrices(
  symbols: DemoSymbol[]
): Promise<Record<DemoSymbol, DemoPriceSnapshot>> {
  // Check cache first
  if (priceCache && Date.now() - priceCache.fetchedAt < CACHE_TTL_MS) {
    return priceCache.data;
  }

  // Check backoff: if we're in a backoff period, return cached data or static
  const now = Date.now();
  if (now < nextAllowedFetchMs) {
    // Return cached data if available, otherwise static
    if (priceCache) {
      return priceCache.data;
    }
    // Return static fallback during backoff
    const staticResults: Record<DemoSymbol, DemoPriceSnapshot> = {} as Record<DemoSymbol, DemoPriceSnapshot>;
    for (const symbol of symbols) {
      const staticData = STATIC_PRICES[symbol];
      staticResults[symbol] = {
        priceUsd: staticData.priceUsd,
        change24hPct: staticData.change24hPct,
        lastUpdatedMs: now,
        source: 'static',
        isLive: false,
      };
    }
    return staticResults;
  }

  // Deduplicate in-flight requests
  if (inFlightRequest) {
    return inFlightRequest;
  }

  // Create new request
  inFlightRequest = (async () => {
    try {
      const results = await fetchFromCoinGecko(symbols);
      
      if (results) {
        // Success: update cache and return
        priceCache = {
          data: results,
          fetchedAt: Date.now(),
        };
        inFlightRequest = null;
        return results;
      } else {
        // Failure: increment backoff
        failureCount++;
        const backoffIndex = Math.min(failureCount - 1, BACKOFF_DELAYS.length - 1);
        const backoffMs = BACKOFF_DELAYS[backoffIndex];
        nextAllowedFetchMs = now + backoffMs;
        
        // Return cached data if available, otherwise static
        if (priceCache) {
          inFlightRequest = null;
          return priceCache.data;
        }
        
        // Return static fallback
        const staticResults: Record<DemoSymbol, DemoPriceSnapshot> = {} as Record<DemoSymbol, DemoPriceSnapshot>;
        for (const symbol of symbols) {
          const staticData = STATIC_PRICES[symbol];
          staticResults[symbol] = {
            priceUsd: staticData.priceUsd,
            change24hPct: staticData.change24hPct,
            lastUpdatedMs: now,
            source: 'static',
            isLive: false,
          };
        }
        inFlightRequest = null;
        return staticResults;
      }
    } catch (error) {
      // On error, same backoff logic
      failureCount++;
      const backoffIndex = Math.min(failureCount - 1, BACKOFF_DELAYS.length - 1);
      const backoffMs = BACKOFF_DELAYS[backoffIndex];
      nextAllowedFetchMs = now + backoffMs;
      
      if (priceCache) {
        inFlightRequest = null;
        return priceCache.data;
      }
      
      const staticResults: Record<DemoSymbol, DemoPriceSnapshot> = {} as Record<DemoSymbol, DemoPriceSnapshot>;
      for (const symbol of symbols) {
        const staticData = STATIC_PRICES[symbol];
        staticResults[symbol] = {
          priceUsd: staticData.priceUsd,
          change24hPct: staticData.change24hPct,
          lastUpdatedMs: now,
          source: 'static',
          isLive: false,
        };
      }
      inFlightRequest = null;
      return staticResults;
    }
  })();

  return inFlightRequest;
}
