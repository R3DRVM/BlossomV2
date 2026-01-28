/**
 * Event markets utilities - fetch top markets from Polymarket (public, no keys)
 * Used for "list top markets" feature
 */

export interface EventMarket {
  id: string;
  title: string;
  yesPrice: number;
  noPrice: number;
  volume24hUsd?: number;
  openInterestUsd?: number;
  source: 'polymarket' | 'kalshi' | 'static';
  isLive: boolean;
}

/**
 * Market list item type for ChatMessage (matches EventMarket shape)
 */
export type MarketListItem = {
  id: string;
  title: string;
  yesPrice: number;
  noPrice: number;
  volume24hUsd?: number;
  source: 'polymarket' | 'kalshi' | 'static';
  isLive: boolean;
};

// Module-level cache (30s TTL)
interface MarketsCache {
  data: EventMarket[];
  fetchedAt: number;
}

let marketsCache: MarketsCache | null = null;
const CACHE_TTL_MS = 30 * 1000;

// In-flight request deduplication
let inFlightRequest: Promise<EventMarket[]> | null = null;

// Backoff state
let failureCount = 0;
let nextAllowedFetchMs = 0;
const BACKOFF_DELAYS = [15000, 30000, 60000]; // 15s, 30s, 60s
let hasLoggedWarning = false;

/**
 * Fetch top markets from Polymarket public API (no keys required)
 * Falls back gracefully if unavailable
 */
async function fetchPolymarketPublicMarkets(): Promise<EventMarket[]> {
  try {
    // Try Polymarket public markets endpoint
    const publicUrl = 'https://clob.polymarket.com/markets';
    
    const response = await fetch(publicUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const markets: EventMarket[] = [];
    
    // Handle various possible response structures
    const marketsArray = Array.isArray(data) ? data : (data.markets || data.items || []);
    
    for (const market of marketsArray.slice(0, 20)) {
      if (!market.question && !market.title && !market.name) continue;
      
      // Extract prices
      let yesPrice = 0.5;
      let noPrice = 0.5;
      
      if (market.outcomes && Array.isArray(market.outcomes) && market.outcomes.length >= 2) {
        yesPrice = parseFloat(market.outcomes[0]?.price || market.outcomes[0]?.lastPrice || '0.5');
        noPrice = parseFloat(market.outcomes[1]?.price || market.outcomes[1]?.lastPrice || '0.5');
      } else if (market.yesPrice !== undefined) {
        yesPrice = parseFloat(market.yesPrice);
        noPrice = 1 - yesPrice;
      }
      
      // Validate prices
      if (yesPrice < 0 || yesPrice > 1 || noPrice < 0 || noPrice > 1) {
        yesPrice = 0.5;
        noPrice = 0.5;
      }
      
      const volume = parseFloat(market.volume24h || market.volume || market.volumeUsd || '0');
      const liquidity = parseFloat(market.liquidity || market.totalLiquidity || market.openInterest || '0');
      
      markets.push({
        id: market.id || market.slug || market.questionId || `polymarket-${Date.now()}-${Math.random()}`,
        title: market.question || market.title || market.name || 'Unknown Market',
        yesPrice,
        noPrice,
        volume24hUsd: volume,
        openInterestUsd: liquidity,
        source: 'polymarket',
        isLive: true,
      });
    }

    // Sort by volume desc, take top 5
    const sorted = markets.sort((a, b) => {
      const aValue = a.volume24hUsd || a.openInterestUsd || 0;
      const bValue = b.volume24hUsd || b.openInterestUsd || 0;
      return bValue - aValue;
    });

    return sorted.slice(0, 5);
  } catch (error) {
    return [];
  }
}

/**
 * Get top event markets (prefers live Polymarket Gamma API if enabled, falls back to existing flow, then static)
 * Never throws - always returns best-effort payload
 */
export async function getTopEventMarkets(requestedCount?: number): Promise<EventMarket[]> {
  const now = Date.now();
  const count = requestedCount || 5;

  // Check if Polymarket Gamma API is enabled via env var
  const usePolymarketGamma = import.meta.env.VITE_EVENT_MARKETS_SOURCE === 'polymarket';

  // Check cache first
  if (marketsCache && now - marketsCache.fetchedAt < CACHE_TTL_MS) {
    return marketsCache.data.slice(0, count);
  }

  // If in backoff period, return cached data or static
  if (now < nextAllowedFetchMs) {
    if (marketsCache) {
      return marketsCache.data.slice(0, count);
    }
    return getStaticMarkets().slice(0, count);
  }

  // Deduplicate in-flight requests
  if (inFlightRequest) {
    return inFlightRequest.then(list => list.slice(0, count));
  }

  // Create new request
  inFlightRequest = (async () => {
    try {
      let markets: EventMarket[] = [];
      
      // Try Polymarket Gamma API first if enabled
      if (usePolymarketGamma) {
        try {
          const { getTopPolymarketMarkets } = await import('./polymarket');
          const polymarketMarkets = await getTopPolymarketMarkets(count);
          
          if (polymarketMarkets.length > 0) {
            // Map Polymarket markets to EventMarket shape
            markets = polymarketMarkets.map(pm => ({
              id: pm.id,
              title: pm.title,
              yesPrice: pm.yesPrice,
              noPrice: pm.noPrice,
              volume24hUsd: pm.volume24hUsd,
              source: 'polymarket',
              isLive: pm.isLive,
            }));
            
            if (import.meta.env.DEV) {
              console.log(`[eventMarkets] Using Polymarket Gamma API, got ${markets.length} markets`);
            }
          }
        } catch (gammaError) {
          if (import.meta.env.DEV) {
            console.warn('[eventMarkets] Polymarket Gamma API failed, trying fallback:', gammaError);
          }
          // Continue to fallback
        }
      }
      
      // Fallback to existing Polymarket public API if Gamma didn't work or not enabled
      if (markets.length === 0) {
        markets = await fetchPolymarketPublicMarkets();
      }
      
      if (markets.length > 0) {
        // Success: update cache and reset backoff
        marketsCache = {
          data: markets,
          fetchedAt: now,
        };
        failureCount = 0;
        nextAllowedFetchMs = 0;
        hasLoggedWarning = false;
        inFlightRequest = null;
        return markets;
      } else {
        // No markets returned, use static fallback
        throw new Error('No markets returned');
      }
    } catch (error) {
      // Failure: increment backoff
      failureCount++;
      const delay = BACKOFF_DELAYS[Math.min(failureCount - 1, BACKOFF_DELAYS.length - 1)];
      nextAllowedFetchMs = now + delay;
      
      if (import.meta.env.DEV && !hasLoggedWarning) {
        console.warn('[eventMarkets] All fetch attempts failed, using static fallback', { failureCount, nextAllowedFetchMs });
        hasLoggedWarning = true;
      }
      
      // Return cached data if available, otherwise static
      if (marketsCache) {
        inFlightRequest = null;
        return marketsCache.data.slice(0, count);
      }
      
      const staticMarkets = getStaticMarkets();
      inFlightRequest = null;
      
      if (import.meta.env.DEV) {
        console.log('[eventMarkets] fallback to static');
      }
      
      return staticMarkets.slice(0, count);
    }
  })();

  return inFlightRequest;
}

/**
 * Get static fallback markets (demo data)
 * These are shown when live Polymarket API is unavailable
 * Labeled as "demo" so users know they're not live
 */
function getStaticMarkets(): EventMarket[] {
  return [
    {
      id: 'fed-cuts-q1-2025',
      title: 'Will the Fed cut rates in Q1 2025?',
      yesPrice: 0.65,
      noPrice: 0.35,
      volume24hUsd: 1250000,
      openInterestUsd: 5000000,
      source: 'static',
      isLive: false,
    },
    {
      id: 'btc-100k-2025',
      title: 'Will BTC reach $100,000 in 2025?',
      yesPrice: 0.72,
      noPrice: 0.28,
      volume24hUsd: 980000,
      openInterestUsd: 4200000,
      source: 'static',
      isLive: false,
    },
    {
      id: 'eth-price-5k-2025',
      title: 'Will ETH exceed $5,000 by end of 2025?',
      yesPrice: 0.58,
      noPrice: 0.42,
      volume24hUsd: 750000,
      openInterestUsd: 3200000,
      source: 'static',
      isLive: false,
    },
    {
      id: 'solana-adoption-2025',
      title: 'Will Solana daily active users exceed 1M by Q2 2025?',
      yesPrice: 0.62,
      noPrice: 0.38,
      volume24hUsd: 540000,
      openInterestUsd: 2100000,
      source: 'static',
      isLive: false,
    },
    {
      id: 'sec-crypto-clarity-2025',
      title: 'Will the SEC provide crypto regulatory clarity in 2025?',
      yesPrice: 0.45,
      noPrice: 0.55,
      volume24hUsd: 420000,
      openInterestUsd: 1800000,
      source: 'static',
      isLive: false,
    },
  ];
}

