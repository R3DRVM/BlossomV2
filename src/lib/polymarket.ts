/**
 * Polymarket market fetching utilities - uses Polymarket's public Gamma API
 * Used for live event markets data
 */

export interface PolymarketMarket {
  id: string;
  title: string;
  yesPrice: number;
  noPrice: number;
  volume24hUsd?: number;
  source: 'Polymarket';
  isLive: boolean;
}

// Module-level cache (60s TTL)
interface PolymarketCache {
  data: PolymarketMarket[];
  fetchedAt: number;
}

let polymarketCache: PolymarketCache | null = null;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

// In-flight request deduplication
let inFlightRequest: Promise<PolymarketMarket[]> | null = null;

/**
 * Fetch markets from Polymarket's public Gamma API
 * Uses a robust approach: fetch a page, filter client-side, sort by volume
 */
async function fetchPolymarketGammaMarkets(): Promise<PolymarketMarket[]> {
  const TIMEOUT_MS = 6000; // 6 second timeout
  
  try {
    // Use Polymarket's public Gamma API endpoint
    // Fetch a reasonable page size to filter client-side
    const url = 'https://gamma-api.polymarket.com/markets?active=true&limit=200';
    
    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (import.meta.env.DEV) {
          console.warn('[Polymarket] API returned status', response.status);
        }
        return [];
      }

      const data = await response.json();
      
      // Handle various possible response structures
      const marketsArray = Array.isArray(data) 
        ? data 
        : (data.markets || data.items || data.data || []);
      
      if (!Array.isArray(marketsArray) || marketsArray.length === 0) {
        return [];
      }

      const markets: PolymarketMarket[] = [];
      
      // Filter and normalize markets
      for (const market of marketsArray) {
        // Filter for active/open/not resolved markets
        if (market.resolved === true || market.closed === true) continue;
        if (market.active === false && market.state !== 'open') continue;
        
        // Extract title
        const title = market.question || market.title || market.name || market.description;
        if (!title || title.trim() === '') continue;
        
        // Extract prices (normalize to 0-1 probabilities)
        let yesPrice = 0.5;
        let noPrice = 0.5;
        
        // Try various price field formats
        if (market.outcomes && Array.isArray(market.outcomes) && market.outcomes.length >= 2) {
          // Outcomes array format
          const yesOutcome = market.outcomes.find((o: any) => o.outcome === 'Yes' || o.outcome === 'YES' || o.side === 'yes');
          const noOutcome = market.outcomes.find((o: any) => o.outcome === 'No' || o.outcome === 'NO' || o.side === 'no');
          
          if (yesOutcome && typeof yesOutcome.price === 'number') {
            yesPrice = Math.max(0, Math.min(1, yesOutcome.price));
          } else if (yesOutcome && typeof yesOutcome.lastPrice === 'number') {
            yesPrice = Math.max(0, Math.min(1, yesOutcome.lastPrice));
          }
          
          if (noOutcome && typeof noOutcome.price === 'number') {
            noPrice = Math.max(0, Math.min(1, noOutcome.price));
          } else if (noOutcome && typeof noOutcome.lastPrice === 'number') {
            noPrice = Math.max(0, Math.min(1, noOutcome.lastPrice));
          } else {
            // Derive noPrice from yesPrice
            noPrice = Math.max(0, Math.min(1, 1 - yesPrice));
          }
        } else if (market.yesPrice !== undefined) {
          // Direct yesPrice field
          yesPrice = Math.max(0, Math.min(1, parseFloat(String(market.yesPrice))));
          noPrice = Math.max(0, Math.min(1, 1 - yesPrice));
        } else if (market.price !== undefined) {
          // Single price field (assume yes price)
          yesPrice = Math.max(0, Math.min(1, parseFloat(String(market.price))));
          noPrice = Math.max(0, Math.min(1, 1 - yesPrice));
        }
        
        // Validate prices sum to ~1.0 (allow small rounding errors)
        const sum = yesPrice + noPrice;
        if (sum > 0.1 && sum < 1.9) {
          // Normalize if needed
          const total = yesPrice + noPrice;
          yesPrice = yesPrice / total;
          noPrice = noPrice / total;
        } else {
          // Invalid prices, skip
          continue;
        }
        
        // Extract volume
        const volume24hUsd = market.volume24h 
          ? parseFloat(String(market.volume24h))
          : market.volume 
          ? parseFloat(String(market.volume))
          : market.volumeUsd
          ? parseFloat(String(market.volumeUsd))
          : undefined;
        
        // Extract ID
        const id = market.id || market.slug || market.questionId || market.conditionId || `polymarket-${Date.now()}-${Math.random()}`;
        
        markets.push({
          id: String(id),
          title: String(title).trim(),
          yesPrice,
          noPrice,
          volume24hUsd: volume24hUsd && !isNaN(volume24hUsd) && volume24hUsd > 0 ? volume24hUsd : undefined,
          source: 'Polymarket',
          isLive: true,
        });
      }

      // Sort by volume (24h if available, else by title for stability)
      const sorted = markets.sort((a, b) => {
        const aVolume = a.volume24hUsd || 0;
        const bVolume = b.volume24hUsd || 0;
        if (aVolume !== bVolume) {
          return bVolume - aVolume; // Descending by volume
        }
        // Fallback: sort by title for stability
        return a.title.localeCompare(b.title);
      });

      return sorted;
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        if (import.meta.env.DEV) {
          console.warn('[Polymarket] Fetch timeout after 6s');
        }
      }
      throw fetchError;
    }
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[Polymarket] Fetch failed:', error);
    }
    return [];
  }
}

/**
 * Get top Polymarket markets by volume
 * @param requestedCount - Number of markets to return
 * @returns Array of Polymarket markets (non-empty if possible)
 */
export async function getTopPolymarketMarkets(requestedCount: number): Promise<PolymarketMarket[]> {
  const now = Date.now();

  // Check cache first
  if (polymarketCache && now - polymarketCache.fetchedAt < CACHE_TTL_MS) {
    if (import.meta.env.DEV) {
      console.log('[Polymarket] using cache');
    }
    const cached = polymarketCache.data;
    return cached.slice(0, requestedCount);
  }

  // Deduplicate in-flight requests
  if (inFlightRequest) {
    return inFlightRequest.then(list => list.slice(0, requestedCount));
  }

  // Create new request
  inFlightRequest = (async () => {
    try {
      const markets = await fetchPolymarketGammaMarkets();
      
      if (markets.length > 0) {
        // Success: update cache
        polymarketCache = {
          data: markets,
          fetchedAt: now,
        };
        inFlightRequest = null;
        
        if (import.meta.env.DEV) {
          console.log(`[Polymarket] fetched ${markets.length} markets`);
        }
        
        return markets;
      } else {
        // Empty result
        inFlightRequest = null;
        if (import.meta.env.DEV) {
          console.warn('[Polymarket] returned empty array');
        }
        return [];
      }
    } catch (error) {
      inFlightRequest = null;
      if (import.meta.env.DEV) {
        console.warn('[Polymarket] fetch error:', error);
      }
      return [];
    }
  })();

  return inFlightRequest.then(list => list.slice(0, requestedCount));
}


