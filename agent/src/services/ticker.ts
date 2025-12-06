/**
 * Ticker Service
 * Provides live price ticker for on-chain assets and event markets
 */

import { getPrice, PriceSymbol } from './prices';
import { getEventSnapshot } from '../plugins/event-sim';

export interface OnchainTickerItem {
  symbol: string;
  priceUsd: number;
  change24hPct: number;
}

export interface EventTickerItem {
  id: string;
  label: string;
  impliedProb: number;
  source: 'Kalshi' | 'Polymarket' | 'Demo';
}

// Static fallback for on-chain ticker
const STATIC_ONCHAIN_TICKER: OnchainTickerItem[] = [
  { symbol: 'BTC', priceUsd: 60000, change24hPct: 2.5 },
  { symbol: 'ETH', priceUsd: 3000, change24hPct: 1.8 },
  { symbol: 'SOL', priceUsd: 150, change24hPct: -0.5 },
  { symbol: 'AVAX', priceUsd: 35, change24hPct: 3.2 },
  { symbol: 'LINK', priceUsd: 14, change24hPct: 0.8 },
];

// Static fallback for event markets
const STATIC_EVENT_TICKER: EventTickerItem[] = [
  { id: 'FED_CUTS_MAR_2025', label: 'Fed cuts in March 2025', impliedProb: 0.62, source: 'Kalshi' },
  { id: 'BTC_ETF_APPROVAL_2025', label: 'BTC ETF approved by Dec 31', impliedProb: 0.68, source: 'Kalshi' },
  { id: 'ETH_ETF_APPROVAL_2025', label: 'ETH ETF approved by June 2025', impliedProb: 0.58, source: 'Kalshi' },
  { id: 'US_ELECTION_2024', label: 'US Election Winner 2024', impliedProb: 0.50, source: 'Polymarket' },
  { id: 'CRYPTO_MCAP_THRESHOLD', label: 'Crypto market cap above $3T by year-end', impliedProb: 0.52, source: 'Polymarket' },
];

/**
 * Get on-chain ticker (crypto prices)
 */
export async function getOnchainTicker(): Promise<OnchainTickerItem[]> {
  const symbols: PriceSymbol[] = ['BTC', 'ETH', 'SOL'];
  const tickerItems: OnchainTickerItem[] = [];

  try {
    for (const symbol of symbols) {
      try {
        const snapshot = await getPrice(symbol);
        // For demo, use a simple mock 24h change based on symbol
        // In production, you'd fetch this from the price API
        const change24hPct = getMock24hChange(symbol);
        
        tickerItems.push({
          symbol,
          priceUsd: snapshot.priceUsd,
          change24hPct,
        });
      } catch (error) {
        console.warn(`Failed to fetch ${symbol} price:`, error);
        // Use static fallback for this symbol
        const staticItem = STATIC_ONCHAIN_TICKER.find(item => item.symbol === symbol);
        if (staticItem) {
          tickerItems.push(staticItem);
        }
      }
    }

    // Add AVAX and LINK from static data (not in price service yet)
    tickerItems.push(
      STATIC_ONCHAIN_TICKER.find(item => item.symbol === 'AVAX')!,
      STATIC_ONCHAIN_TICKER.find(item => item.symbol === 'LINK')!
    );

    return tickerItems.length > 0 ? tickerItems : STATIC_ONCHAIN_TICKER;
  } catch (error) {
    console.error('Failed to build on-chain ticker, using static fallback:', error);
    return STATIC_ONCHAIN_TICKER;
  }
}

/**
 * Get event markets ticker
 */
export async function getEventMarketsTicker(): Promise<EventTickerItem[]> {
  try {
    const eventSnapshot = getEventSnapshot();
    const markets = eventSnapshot.markets.slice(0, 6); // Take first 6 markets

    const tickerItems: EventTickerItem[] = markets.map(market => {
      // Map market keys to sources
      let source: 'Kalshi' | 'Polymarket' | 'Demo' = 'Demo';
      if (market.key.includes('FED') || market.key.includes('ETF')) {
        source = 'Kalshi';
      } else if (market.key.includes('ELECTION') || market.key.includes('MCAP')) {
        source = 'Polymarket';
      }

      // Use winProbability as implied probability
      const impliedProb = market.winProbability;

      return {
        id: market.key,
        label: market.label,
        impliedProb,
        source,
      };
    });

    return tickerItems.length > 0 ? tickerItems : STATIC_EVENT_TICKER;
  } catch (error) {
    console.error('Failed to build event markets ticker, using static fallback:', error);
    return STATIC_EVENT_TICKER;
  }
}

/**
 * Mock 24h change for demo purposes
 */
function getMock24hChange(symbol: PriceSymbol): number {
  const changes: Record<PriceSymbol, number> = {
    BTC: 2.5,
    ETH: 1.8,
    SOL: -0.5,
    REDACTED: 0,
  };
  return changes[symbol] || 0;
}

