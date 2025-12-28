/**
 * DeFi protocols utilities - fetch top protocols by TVL from DefiLlama (public, no keys)
 * Used for "list top protocols" feature
 */

export interface DefiProtocolListItem {
  id: string;
  name: string;
  tvlUsd: number;
  chains: string[];
  category?: string;
  source: 'defillama' | 'static';
  isLive: boolean;
}

// Module-level cache (60s TTL)
interface ProtocolsCache {
  data: DefiProtocolListItem[];
  fetchedAt: number;
}

let protocolsCache: ProtocolsCache | null = null;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

// In-flight request deduplication
let inFlightRequest: Promise<DefiProtocolListItem[]> | null = null;

// Backoff state
let failureCount = 0;
let nextAllowedFetchMs = 0;
const BACKOFF_DELAYS = [15000, 30000, 60000]; // 15s, 30s, 60s
let hasLoggedWarning = false;

/**
 * Fetch top protocols from DefiLlama public API (no keys required)
 * Falls back gracefully if unavailable
 * Includes timeout to prevent hanging
 */
async function fetchDefiLlamaProtocols(): Promise<DefiProtocolListItem[]> {
  const TIMEOUT_MS = 6000; // 6 second timeout
  
  try {
    const url = 'https://api.llama.fi/protocols';
    
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
        return [];
      }

      const data = await response.json();
      
      if (!Array.isArray(data)) {
        return [];
      }

      const protocols: DefiProtocolListItem[] = [];
      
      // CEX exclusion patterns (case-insensitive)
      const cexCategories = ['cex', 'centralized exchange', 'cefi'];
      const cexNamePatterns = ['binance', 'okx', 'okex', 'bitfinex', 'coinbase', 'kraken', 'huobi', 'bybit', 'gate.io', 'kucoin'];
      
      // Filter and map protocols (exclude CEX)
      for (const protocol of data) {
        if (!protocol.name || !protocol.tvl || protocol.tvl <= 0) continue;
        
        // Exclude if category is missing
        if (!protocol.category) continue;
        
        // Exclude CEX by category (case-insensitive)
        const categoryLower = String(protocol.category).toLowerCase();
        if (cexCategories.some(cexCat => categoryLower.includes(cexCat))) continue;
        
        // Exclude CEX by name pattern (case-insensitive safety net)
        const nameLower = String(protocol.name).toLowerCase();
        if (cexNamePatterns.some(cexName => nameLower.includes(cexName))) continue;
        
        // Extract chains (can be string or array)
        let chains: string[] = [];
        if (Array.isArray(protocol.chains)) {
          chains = protocol.chains;
        } else if (typeof protocol.chains === 'string') {
          chains = [protocol.chains];
        } else if (protocol.chain) {
          chains = [protocol.chain];
        }
        
        protocols.push({
          id: protocol.slug || protocol.name.toLowerCase().replace(/\s+/g, '-'),
          name: protocol.name,
          tvlUsd: protocol.tvl || 0,
          chains: chains,
          category: protocol.category || undefined,
          source: 'defillama',
          isLive: true,
        });
      }

      // Sort by TVL descending, take top 20 (will be sliced by caller)
      const sorted = protocols.sort((a, b) => b.tvlUsd - a.tvlUsd);
      return sorted.slice(0, 20);
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        if (import.meta.env.DEV) {
          console.warn('[defiProtocols] Fetch timeout after 6s');
        }
      }
      throw fetchError;
    }
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[defiProtocols] DefiLlama fetch failed:', error);
    }
    return [];
  }
}

/**
 * Get top DeFi protocols by TVL (prefers live DefiLlama, falls back to static)
 * Never throws - always returns best-effort payload (non-empty array)
 * @param requestedCount - Optional count to limit results (default: all available)
 */
export async function getTopDefiProtocolsByTvl(requestedCount?: number): Promise<DefiProtocolListItem[]> {
  const now = Date.now();

  // Check cache first
  if (protocolsCache && now - protocolsCache.fetchedAt < CACHE_TTL_MS) {
    const cached = protocolsCache.data;
    return requestedCount ? cached.slice(0, requestedCount) : cached;
  }

  // If in backoff period, return cached data or static
  if (now < nextAllowedFetchMs) {
    if (protocolsCache) {
      const cached = protocolsCache.data;
      return requestedCount ? cached.slice(0, requestedCount) : cached;
    }
    const staticList = getStaticProtocols();
    return requestedCount ? staticList.slice(0, requestedCount) : staticList;
  }

  // Deduplicate in-flight requests (only if same count requested)
  // For simplicity, we allow concurrent requests with different counts
  // The cache will dedupe at the data level
  if (inFlightRequest && !requestedCount) {
    return inFlightRequest.then(list => requestedCount ? list.slice(0, requestedCount) : list);
  }

  // Create new request
  inFlightRequest = (async () => {
    try {
      const protocols = await fetchDefiLlamaProtocols();
      
      if (protocols.length > 0) {
        // Success: update cache and reset backoff
        protocolsCache = {
          data: protocols,
          fetchedAt: now,
        };
        failureCount = 0;
        nextAllowedFetchMs = 0;
        hasLoggedWarning = false;
        inFlightRequest = null;
        return requestedCount ? protocols.slice(0, requestedCount) : protocols;
      } else {
        // No protocols returned, use static fallback
        throw new Error('No protocols returned');
      }
    } catch (error) {
      // Failure: increment backoff
      failureCount++;
      const delay = BACKOFF_DELAYS[Math.min(failureCount - 1, BACKOFF_DELAYS.length - 1)];
      nextAllowedFetchMs = now + delay;
      
      if (import.meta.env.DEV && !hasLoggedWarning) {
        console.warn('[defiProtocols] DefiLlama fetch failed, using static fallback', { failureCount, nextAllowedFetchMs });
        hasLoggedWarning = true;
      }
      
      // Return cached data if available, otherwise static (always non-empty)
      if (protocolsCache) {
        const cached = protocolsCache.data;
        inFlightRequest = null;
        return requestedCount ? cached.slice(0, requestedCount) : cached;
      }
      
      const staticProtocols = getStaticProtocols();
      inFlightRequest = null;
      return requestedCount ? staticProtocols.slice(0, requestedCount) : staticProtocols;
    }
  })();

  return inFlightRequest;
}

/**
 * Get static fallback protocols (demo data)
 */
function getStaticProtocols(): DefiProtocolListItem[] {
  return [
    {
      id: 'aave',
      name: 'Aave',
      tvlUsd: 12000000000, // $12B
      chains: ['Ethereum', 'Arbitrum', 'Base'],
      category: 'Lending',
      source: 'static',
      isLive: false,
    },
    {
      id: 'lido',
      name: 'Lido',
      tvlUsd: 28000000000, // $28B
      chains: ['Ethereum'],
      category: 'Liquid Staking',
      source: 'static',
      isLive: false,
    },
    {
      id: 'maker',
      name: 'Maker',
      tvlUsd: 6200000000, // $6.2B
      chains: ['Ethereum'],
      category: 'CDP',
      source: 'static',
      isLive: false,
    },
    {
      id: 'uniswap',
      name: 'Uniswap',
      tvlUsd: 8500000000, // $8.5B
      chains: ['Ethereum', 'Arbitrum', 'Base', 'Polygon'],
      category: 'Dexes',
      source: 'static',
      isLive: false,
    },
    {
      id: 'ethena',
      name: 'Ethena',
      tvlUsd: 3200000000, // $3.2B
      chains: ['Ethereum'],
      category: 'Yield',
      source: 'static',
      isLive: false,
    },
    {
      id: 'morpho',
      name: 'Morpho',
      tvlUsd: 2800000000, // $2.8B
      chains: ['Ethereum', 'Base'],
      category: 'Lending',
      source: 'static',
      isLive: false,
    },
    {
      id: 'pendle',
      name: 'Pendle',
      tvlUsd: 1800000000, // $1.8B
      chains: ['Ethereum', 'Arbitrum'],
      category: 'Yield',
      source: 'static',
      isLive: false,
    },
    {
      id: 'compound',
      name: 'Compound',
      tvlUsd: 2400000000, // $2.4B
      chains: ['Ethereum'],
      category: 'Lending',
      source: 'static',
      isLive: false,
    },
  ];
}

