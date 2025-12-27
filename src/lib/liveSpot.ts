/**
 * Live spot price utilities for demo display (presentation-only)
 * Fetches live ticker data and computes indicative TP/SL for plan cards
 */

import { callAgent } from './apiClient';
import { USE_AGENT_BACKEND } from './config';
import { getDemoSpotPrices, type DemoSymbol } from './demoPriceFeed';

interface TickerPayload {
  venue: 'hyperliquid' | 'event_demo';
  sections: Array<{
    id: string;
    label: string;
    items: Array<{
      label: string;
      value: string;
      change?: string;
      meta?: string;
    }>;
  }>;
}

// No local cache - use canonical cache from demoPriceFeed.ts

/**
 * Map market string to spot symbol
 */
export function marketToSpotSymbol(market: string): DemoSymbol | null {
  const upper = market.toUpperCase();
  if (upper.includes('BTC') || upper === 'BTC') return 'BTC';
  if (upper.includes('ETH') || upper === 'ETH') return 'ETH';
  if (upper.includes('SOL') || upper === 'SOL') return 'SOL';
  if (upper.includes('AVAX') || upper === 'AVAX') return 'AVAX';
  if (upper.includes('LINK') || upper === 'LINK') return 'LINK';
  return null;
}

/**
 * Extract price from ticker value string (e.g., "$60,000" -> 60000)
 */
function parseTickerValue(value: string): number | null {
  // Remove $ and commas, parse as float
  const cleaned = value.replace(/[$,]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) || parsed <= 0 ? null : parsed;
}

/**
 * Get cached live ticker prices (thin wrapper around canonical demoPriceFeed cache)
 * Never throws - always returns a predictable shape
 */
export async function getCachedLiveTicker(): Promise<{ BTC?: number; ETH?: number; SOL?: number; AVAX?: number; LINK?: number }> {
  try {
    // Use canonical cache from demoPriceFeed (no duplicate cache)
    const demoPrices = await getDemoSpotPrices(['BTC', 'ETH', 'SOL', 'AVAX', 'LINK']);
    const prices: { BTC?: number; ETH?: number; SOL?: number; AVAX?: number; LINK?: number } = {};
    
    for (const symbol of ['BTC', 'ETH', 'SOL', 'AVAX', 'LINK'] as DemoSymbol[]) {
      const snapshot = demoPrices[symbol];
      // Only use live prices (isLive flag from CoinGecko)
      if (snapshot && snapshot.isLive) {
        prices[symbol] = snapshot.priceUsd;
      }
    }

    // If we got any live prices, return them
    if (Object.keys(prices).length > 0) {
      return prices;
    }

    // Fallback to agent backend if demo feed returned static and agent is enabled
    if (USE_AGENT_BACKEND) {
      try {
        const response = await callAgent('/api/ticker?venue=hyperliquid');
        
        if (response && response.ok) {
          const data: TickerPayload = await response.json();
          if (data && Array.isArray(data.sections)) {
            const agentPrices: { BTC?: number; ETH?: number; SOL?: number; AVAX?: number; LINK?: number } = {};

            // Extract prices from majors section
            const majorsSection = data.sections.find(s => s && s.id === 'majors');
            if (majorsSection && Array.isArray(majorsSection.items)) {
              for (const item of majorsSection.items) {
                if (!item || !item.label || !item.value) continue;
                const symbol = marketToSpotSymbol(item.label);
                if (symbol) {
                  const price = parseTickerValue(item.value);
                  if (price !== null && price > 0) {
                    agentPrices[symbol] = price;
                  }
                }
              }
            }

            // Return agent prices if we got any
            if (Object.keys(agentPrices).length > 0) {
              return agentPrices;
            }
          }
        }
      } catch (error) {
        // Agent fallback failed, return empty
      }
    }

    // All sources failed, return empty (UI will use parser values)
    return {};
  } catch (error) {
    // Fail gracefully - return empty object, never throw
    return {};
  }
}

/**
 * Get live spot price for a specific market (prefers demo feed)
 * @param market - Market string (e.g., "BTC-PERP", "ETH")
 * @returns Live entry price with source, or null if unavailable
 */
export async function getLiveSpotForMarket(
  market: string
): Promise<{ entryUsd: number; source: 'coingecko' | 'agent' } | null> {
  const symbol = marketToSpotSymbol(market);
  if (!symbol) {
    return null;
  }

  try {
    // Prefer demo feed (CoinGecko)
    const demoPrices = await getDemoSpotPrices([symbol]);
    const snapshot = demoPrices[symbol];
    
    // Only return if it's live (not static fallback)
    if (snapshot && snapshot.isLive) {
      return {
        entryUsd: snapshot.priceUsd,
        source: 'coingecko',
      };
    }

    // Fallback to agent if demo feed returned static and agent is enabled
    if (USE_AGENT_BACKEND) {
      const prices = await getCachedLiveTicker();
      if (prices[symbol] && prices[symbol]! > 0) {
        return {
          entryUsd: prices[symbol]!,
          source: 'agent',
        };
      }
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Compute indicative TP/SL from entry price using simple RR bands
 * @param params - Entry price and side
 * @returns TP and SL prices
 */
export function computeIndicativeTpSl(params: {
  side: 'Long' | 'Short';
  entry: number;
}): { tp: number; sl: number } {
  const { side, entry } = params;
  
  if (side === 'Long') {
    return {
      tp: entry * 1.04, // +4% for long
      sl: entry * 0.98, // -2% for long
    };
  } else {
    // Short
    return {
      tp: entry * 0.96, // -4% for short
      sl: entry * 1.02, // +2% for short
    };
  }
}

