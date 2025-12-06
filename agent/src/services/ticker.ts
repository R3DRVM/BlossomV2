/**
 * Ticker Service
 * Provides live price ticker for on-chain assets and event markets
 */

import { getPrice, PriceSymbol } from './prices';
import { getEventSnapshot } from '../plugins/event-sim';

// Unified ticker item structure
export interface TickerItem {
  label: string;      // e.g. "BTC" or "Fed cuts in March 2025"
  value: string;     // e.g. "$60,000" or "62%"
  change?: string;   // e.g. "+2.5%" or "+8% prob"
  meta?: string;     // e.g. "24h", "Kalshi", "Polymarket", "DeFi"
  lean?: 'YES' | 'NO'; // For event markets: indicates YES or NO leaning
}

export interface TickerSection {
  id: 'majors' | 'gainers' | 'defi' | 'kalshi' | 'polymarket';
  label: string;      // "Majors", "Top gainers (24h)", etc.
  items: TickerItem[];
}

export interface TickerPayload {
  venue: 'hyperliquid' | 'event_demo';
  sections: TickerSection[];
}

// Legacy interfaces for backward compatibility
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
 * Get on-chain ticker (crypto prices) - new unified format
 */
export async function getOnchainTicker(): Promise<TickerPayload> {
  const symbols: PriceSymbol[] = ['BTC', 'ETH', 'SOL'];
  const priceData: Array<{ symbol: string; priceUsd: number; change24hPct: number }> = [];

  try {
    for (const symbol of symbols) {
      try {
        const snapshot = await getPrice(symbol);
        const change24hPct = getMock24hChange(symbol);
        
        priceData.push({
          symbol,
          priceUsd: snapshot.priceUsd,
          change24hPct,
        });
      } catch (error) {
        console.warn(`Failed to fetch ${symbol} price:`, error);
        const staticItem = STATIC_ONCHAIN_TICKER.find(item => item.symbol === symbol);
        if (staticItem) {
          priceData.push(staticItem);
        }
      }
    }

    // Add AVAX and LINK from static data
    priceData.push(
      STATIC_ONCHAIN_TICKER.find(item => item.symbol === 'AVAX')!,
      STATIC_ONCHAIN_TICKER.find(item => item.symbol === 'LINK')!
    );

    // If we have no data, use static fallback
    const allPrices = priceData.length > 0 ? priceData : STATIC_ONCHAIN_TICKER;

    // Section 1: Majors
    const majorsItems: TickerItem[] = allPrices.map(item => ({
      label: item.symbol,
      value: `$${item.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      change: `${item.change24hPct >= 0 ? '+' : ''}${item.change24hPct.toFixed(1)}%`,
      meta: '24h',
    }));

    // Section 2: Top gainers (sort by 24h change desc, take top 4)
    const gainers = [...allPrices]
      .sort((a, b) => b.change24hPct - a.change24hPct)
      .slice(0, 4)
      .map(item => ({
        label: item.symbol,
        value: `$${item.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
        change: `+${item.change24hPct.toFixed(1)}%`,
        meta: 'Top gainer',
      }));

    // Section 3: DeFi protocols (stub data)
    const defiItems: TickerItem[] = [
      { label: 'Lido', value: '$28B TVL', meta: 'DeFi' },
      { label: 'Aave', value: '$12B TVL', meta: 'DeFi' },
      { label: 'Uniswap', value: '$8.5B TVL', meta: 'DeFi' },
      { label: 'Maker', value: '$6.2B TVL', meta: 'DeFi' },
    ];

    return {
      venue: 'hyperliquid',
      sections: [
        { id: 'majors', label: 'Majors', items: majorsItems },
        { id: 'gainers', label: 'Top gainers (24h)', items: gainers },
        { id: 'defi', label: 'DeFi TVL', items: defiItems },
      ],
    };
  } catch (error) {
    console.error('Failed to build on-chain ticker, using static fallback:', error);
    // Return fallback payload
    return {
      venue: 'hyperliquid',
      sections: [
        {
          id: 'majors',
          label: 'Majors',
          items: STATIC_ONCHAIN_TICKER.map(item => ({
            label: item.symbol,
            value: `$${item.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
            change: `${item.change24hPct >= 0 ? '+' : ''}${item.change24hPct.toFixed(1)}%`,
            meta: '24h',
          })),
        },
      ],
    };
  }
}

/**
 * Get event markets ticker - new unified format
 */
export async function getEventMarketsTicker(): Promise<TickerPayload> {
  try {
    const eventSnapshot = getEventSnapshot();
    const allMarkets = eventSnapshot.markets;

    // Separate markets by source
    const kalshiMarkets: Array<{ label: string; impliedProb: number }> = [];
    const polymarketMarkets: Array<{ label: string; impliedProb: number }> = [];

    for (const market of allMarkets) {
      let source: 'Kalshi' | 'Polymarket' | 'Demo' = 'Demo';
      if (market.key.includes('FED') || market.key.includes('ETF')) {
        source = 'Kalshi';
      } else if (market.key.includes('ELECTION') || market.key.includes('MCAP')) {
        source = 'Polymarket';
      }

      const item = {
        label: market.label,
        impliedProb: market.winProbability,
      };

      if (source === 'Kalshi') {
        kalshiMarkets.push(item);
      } else if (source === 'Polymarket') {
        polymarketMarkets.push(item);
      }
    }

    // Convert to TickerItems
    const kalshiItems: TickerItem[] = kalshiMarkets.slice(0, 4).map(m => ({
      label: m.label,
      value: `${Math.round(m.impliedProb * 100)}%`,
      meta: 'Kalshi',
      lean: m.impliedProb > 0.5 ? 'YES' : 'NO',
    }));

    const polymarketItems: TickerItem[] = polymarketMarkets.slice(0, 4).map(m => ({
      label: m.label,
      value: `${Math.round(m.impliedProb * 100)}%`,
      meta: 'Polymarket',
      lean: m.impliedProb > 0.5 ? 'YES' : 'NO',
    }));

    // If no markets found, use static fallback
    if (kalshiItems.length === 0 && polymarketItems.length === 0) {
      return {
        venue: 'event_demo',
        sections: [
          {
            id: 'kalshi',
            label: 'Kalshi',
            items: STATIC_EVENT_TICKER.filter(item => item.source === 'Kalshi').slice(0, 4).map(item => ({
              label: item.label,
              value: `${Math.round(item.impliedProb * 100)}%`,
              meta: 'Kalshi',
              lean: item.impliedProb > 0.5 ? 'YES' : 'NO',
            })),
          },
          {
            id: 'polymarket',
            label: 'Polymarket',
            items: STATIC_EVENT_TICKER.filter(item => item.source === 'Polymarket').slice(0, 4).map(item => ({
              label: item.label,
              value: `${Math.round(item.impliedProb * 100)}%`,
              meta: 'Polymarket',
              lean: item.impliedProb > 0.5 ? 'YES' : 'NO',
            })),
          },
        ],
      };
    }

    const sections: TickerSection[] = [];
    if (kalshiItems.length > 0) {
      sections.push({ id: 'kalshi', label: 'Kalshi', items: kalshiItems });
    }
    if (polymarketItems.length > 0) {
      sections.push({ id: 'polymarket', label: 'Polymarket', items: polymarketItems });
    }

    return {
      venue: 'event_demo',
      sections,
    };
  } catch (error) {
    console.error('Failed to build event markets ticker, using static fallback:', error);
    return {
      venue: 'event_demo',
      sections: [
        {
          id: 'kalshi',
          label: 'Kalshi',
          items: STATIC_EVENT_TICKER.filter(item => item.source === 'Kalshi').slice(0, 4).map(item => ({
            label: item.label,
            value: `${Math.round(item.impliedProb * 100)}%`,
            meta: 'Kalshi',
          })),
        },
        {
          id: 'polymarket',
          label: 'Polymarket',
          items: STATIC_EVENT_TICKER.filter(item => item.source === 'Polymarket').slice(0, 4).map(item => ({
            label: item.label,
            value: `${Math.round(item.impliedProb * 100)}%`,
            meta: 'Polymarket',
          })),
        },
      ],
    };
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

