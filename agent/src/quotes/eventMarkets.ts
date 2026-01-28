/**
 * Event Markets Quote Provider
 * Fetches event market data from dFlow or Polymarket
 * Caches results in-memory for 60 seconds
 *
 * IMPORTANT: dFlow uses x-api-key header for authentication (NOT Bearer token)
 * 
 * Sprint 3: Now uses unified routing service with truthful metadata
 */

import { DFLOW_ENABLED, DFLOW_API_KEY, DFLOW_PREDICTION_API_URL, DFLOW_EVENTS_MARKETS_PATH } from '../config';
import { isDflowConfigured, getEventMarkets as dflowGetEventMarkets } from '../integrations/dflow/dflowClient';
import { getEventMarketsRouted, RoutingMetadata } from '../routing/routingService';

export interface EventMarket {
  id: string;
  title: string;
  yesPrice: number; // 0-1 probability
  noPrice: number; // 0-1 probability
  volume24hUsd?: number;
  source: 'dflow' | 'polymarket' | 'fallback';
}

export interface EventMarketsWithRouting {
  markets: EventMarket[];
  routing: RoutingMetadata;
}

// In-memory cache (60 seconds)
let cachedMarkets: EventMarket[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

// Hardcoded fallback markets (harmonized IDs to match predictionData.ts)
const FALLBACK_MARKETS: EventMarket[] = [
  { id: 'FED_CUTS_MAR_2025', title: 'Fed cuts in March 2025', yesPrice: 0.62, noPrice: 0.38, source: 'fallback' },
  { id: 'BTC_ETF_APPROVAL_2025', title: 'BTC ETF approved by Dec 31', yesPrice: 0.68, noPrice: 0.32, source: 'fallback' },
  { id: 'ETH_ETF_APPROVAL_2025', title: 'ETH ETF approved by June 2025', yesPrice: 0.58, noPrice: 0.42, source: 'fallback' },
  { id: 'TRUMP_2024_WIN', title: 'Trump wins 2024 election', yesPrice: 0.52, noPrice: 0.48, source: 'fallback' },
  { id: 'SOL_ADOPTION_2025', title: 'Solana adoption surges in 2025', yesPrice: 0.64, noPrice: 0.36, source: 'fallback' },
];

/**
 * Fetch event markets from dFlow if enabled, else Polymarket, else fallback
 * Sprint 3: Now uses unified routing service with truthful metadata
 */
export async function getEventMarkets(limit: number = 10): Promise<EventMarket[]> {
  // Check cache
  const now = Date.now();
  if (cachedMarkets && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedMarkets.slice(0, limit);
  }

  // Use routing service
  const { makeCorrelationId } = await import('../utils/correlationId');
  const routingCorrelationId = makeCorrelationId('markets');
  const routedResult = await getEventMarketsRouted({
    limit,
    correlationId: routingCorrelationId,
    fallbackMarkets: async () => {
      // Try Polymarket
      try {
        const response = await fetch('https://clob.polymarket.com/markets', {
          headers: {
            'Accept': 'application/json',
          },
        });

        if (response.ok) {
          const data = await response.json();
          // Transform Polymarket response to EventMarket format
          const markets: EventMarket[] = Array.isArray(data) ? data
            .filter((m: any) => m.question && m.conditionId)
            .map((m: any) => ({
              id: m.conditionId || m.id || `poly-${Date.now()}-${Math.random()}`,
              title: m.question || m.title || 'Unknown Market',
              yesPrice: m.outcomes?.[0]?.price || 0.5,
              noPrice: m.outcomes?.[1]?.price || 0.5,
              volume24hUsd: m.volume24h || 0,
              source: 'polymarket' as const,
            })) : [];
          
          return markets;
        }
      } catch (error: any) {
        console.warn('[getEventMarkets] Polymarket fetch failed:', error.message);
      }
      
      // Return fallback
      return FALLBACK_MARKETS;
    },
  });

  if (routedResult.ok && routedResult.data) {
    // Transform routed data to EventMarket format
    const markets: EventMarket[] = routedResult.data.map(m => ({
      id: m.id,
      title: m.title,
      yesPrice: m.yesPrice,
      noPrice: m.noPrice,
      volume24hUsd: m.volume24hUsd,
      source: routedResult.routing.source === 'dflow' ? 'dflow' : 'polymarket',
    }));

    cachedMarkets = markets;
    cacheTimestamp = now;
    return markets;
  }

  // Fallback if routing service fails - GUARANTEE non-empty
  console.log('[getEventMarkets] Using hardcoded fallback markets (routing service failed or returned empty)');
  cachedMarkets = FALLBACK_MARKETS;
  cacheTimestamp = now;
  return FALLBACK_MARKETS.slice(0, Math.max(limit, 5)); // Always return at least 5
}

/**
 * Get event markets with routing metadata (Sprint 3)
 */
export async function getEventMarketsWithRouting(limit: number = 10): Promise<EventMarketsWithRouting> {
  const { makeCorrelationId } = await import('../utils/correlationId');
  const routingCorrelationId = makeCorrelationId('markets');
  const routedResult = await getEventMarketsRouted({
    limit,
    correlationId: routingCorrelationId,
    fallbackMarkets: async () => {
      // Try Polymarket
      try {
        const response = await fetch('https://clob.polymarket.com/markets', {
          headers: {
            'Accept': 'application/json',
          },
        });

        if (response.ok) {
          const data = await response.json();
          const markets: EventMarket[] = Array.isArray(data) ? data
            .filter((m: any) => m.question && m.conditionId)
            .map((m: any) => ({
              id: m.conditionId || m.id || `poly-${Date.now()}-${Math.random()}`,
              title: m.question || m.title || 'Unknown Market',
              yesPrice: m.outcomes?.[0]?.price || 0.5,
              noPrice: m.outcomes?.[1]?.price || 0.5,
              volume24hUsd: m.volume24h || 0,
              source: 'polymarket' as const,
            })) : [];
          
          return markets;
        }
      } catch (error: any) {
        // Ignore
      }
      
      return FALLBACK_MARKETS;
    },
  });

  // Ensure routing metadata always exists (guard against undefined)
  const routing = routedResult.routing || {
    source: 'fallback' as const,
    kind: 'event_markets' as const,
    ok: false,
    reason: 'Routing service returned no metadata',
    latencyMs: 0,
    mode: 'hybrid' as const,
    correlationId: routingCorrelationId,
  };

  if (routedResult.ok && routedResult.data && routedResult.data.length > 0) {
    const markets: EventMarket[] = routedResult.data.map(m => ({
      id: m.id,
      title: m.title,
      yesPrice: m.yesPrice,
      noPrice: m.noPrice,
      volume24hUsd: m.volume24hUsd,
      source: routing.source === 'dflow' ? 'dflow' : 'polymarket',
    }));

    return {
      markets,
      routing,
    };
  }

  // Fallback - GUARANTEE non-empty (MVP requirement)
  console.log('[getEventMarketsWithRouting] Using hardcoded fallback markets (routing returned empty or failed)');
  return {
    markets: FALLBACK_MARKETS.slice(0, Math.max(limit, 5)), // Always at least 5 markets
    routing: {
      ...routing,
      source: 'fallback' as const,
      reason: routing.reason || 'Routing returned empty or failed, using static fallback',
    },
  };
}

/**
 * Find event market by keyword match
 */
export async function findEventMarketByKeyword(keyword: string): Promise<EventMarket | null> {
  const markets = await getEventMarkets(10);
  const lowerKeyword = keyword.toLowerCase();
  
  // Simple string search
  const match = markets.find(m => 
    m.title.toLowerCase().includes(lowerKeyword) ||
    lowerKeyword.includes(m.title.toLowerCase().split(' ')[0])
  );
  
  return match || markets[0] || null; // Return first market if no match
}

