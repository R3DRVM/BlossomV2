/**
 * Ticker Service
 * Provides live price ticker for on-chain assets and event markets
 */

import { getPrice, PriceSymbol } from './prices';
import { getEventSnapshot } from '../plugins/event-sim';
import { fetchKalshiMarkets, fetchPolymarketMarkets, RawPredictionMarket } from './predictionData';
import { getMarketDataProvider } from '../providers/providerRegistry';
import { DFLOW_ENABLED } from '../config';

// Unified ticker item structure
export interface TickerItem {
  label: string;      // e.g. "BTC" or "Fed cuts in March 2025"
  value: string;     // e.g. "$60,000" or "62%"
  change?: string;   // e.g. "+2.5%" or "+8% prob"
  meta?: string;     // e.g. "24h", "Kalshi", "Polymarket", "DeFi"
  impliedProb?: number; // 0–1, for event markets
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
  lastUpdatedMs?: number;
  isLive?: boolean;
  source?: 'coingecko' | 'static' | 'snapshot' | 'kalshi' | 'polymarket';
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
  const symbols: PriceSymbol[] = ['BTC', 'ETH', 'SOL', 'AVAX', 'LINK'];
  const priceData: Array<{ symbol: string; priceUsd: number; change24hPct: number; source: 'coingecko' | 'static' }> = [];
  let hasLiveData = false;
  let hasStaticFallback = false;

  try {
    for (const symbol of symbols) {
      try {
        const snapshot = await getPrice(symbol);
        const change24hPct = getMock24hChange(symbol);
        
        priceData.push({
          symbol,
          priceUsd: snapshot.priceUsd,
          change24hPct,
          source: snapshot.source,
        });
        
        if (snapshot.source === 'coingecko') {
          hasLiveData = true;
        } else {
          hasStaticFallback = true;
        }
      } catch (error) {
        console.warn(`Failed to fetch ${symbol} price:`, error);
        const staticItem = STATIC_ONCHAIN_TICKER.find(item => item.symbol === symbol);
        if (staticItem) {
          priceData.push({
            ...staticItem,
            source: 'static',
          });
          hasStaticFallback = true;
        }
      }
    }

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
      lastUpdatedMs: Date.now(),
      // isLive is true only if we have at least one CoinGecko fetch (not cached static)
      isLive: hasLiveData,
      source: hasLiveData ? 'coingecko' : 'static',
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
      lastUpdatedMs: Date.now(),
      isLive: false,
      source: 'static',
    };
  }
}

/**
 * Get event markets ticker - new unified format with live data support
 * Uses dFlow provider if enabled, falls back to Polymarket/Kalshi
 */
export async function getEventMarketsTicker(): Promise<TickerPayload> {
  try {
    // Try dFlow provider first if enabled
    if (DFLOW_ENABLED) {
      try {
        const provider = getMarketDataProvider();
        if (provider.name === 'dflow' && provider.isAvailable()) {
          const dflowMarkets = await provider.getEventMarkets();
          if (dflowMarkets.length > 0) {
            const topMarkets = dflowMarkets.slice(0, 12);
            const tickerItems: TickerItem[] = topMarkets.map(market => {
              const impliedProb = market.yesPrice;
              const lean: 'YES' | 'NO' = impliedProb >= 0.5 ? 'YES' : 'NO';
              return {
                label: market.title,
                value: `${Math.round(impliedProb * 100)}%`,
                impliedProb,
                meta: 'dFlow',
                lean,
              };
            });
            
            return {
              venue: 'event_demo',
              sections: [{ id: 'kalshi' as const, label: 'Markets (dFlow)', items: tickerItems }],
              lastUpdatedMs: Date.now(),
              isLive: true,
              source: 'kalshi', // Use kalshi as source type for compatibility
            };
          }
        }
      } catch (error: any) {
        console.warn('[getEventMarketsTicker] dFlow provider failed, falling back:', error.message);
      }
    }
    
    // Fallback: Prefer Polymarket public feed first (no keys), then Kalshi if configured
    const polymarketMarkets = await fetchPolymarketMarkets();
    const kalshiMarkets = await fetchKalshiMarkets();
    
    // Check if we have any live data
    const hasLivePolymarket = polymarketMarkets.some(m => m.isLive);
    const hasLiveKalshi = kalshiMarkets.some(m => m.isLive);
    const hasLiveData = hasLivePolymarket || hasLiveKalshi;
    
    // Merge and sort by volume/open interest
    const allMarkets: RawPredictionMarket[] = [...kalshiMarkets, ...polymarketMarkets];
    const sorted = allMarkets.sort((a, b) => {
      const aValue = a.openInterestUsd || a.volume24hUsd || 0;
      const bValue = b.openInterestUsd || b.volume24hUsd || 0;
      return bValue - aValue;
    });

    // Take top 10-12 markets
    const topMarkets = sorted.slice(0, 12);

    if (topMarkets.length > 0) {
      // Convert to TickerItems
      const tickerItems: TickerItem[] = topMarkets.map(market => {
        const impliedProb = market.yesPrice;
        const lean: 'YES' | 'NO' = impliedProb >= 0.5 ? 'YES' : 'NO';

        return {
          label: market.title,
          value: `${Math.round(impliedProb * 100)}%`,
          impliedProb,
          meta: market.source,
          lean,
        };
      });

      // Group by source for sections
      const kalshiItems = tickerItems.filter(item => item.meta === 'KALSHI');
      const polymarketItems = tickerItems.filter(item => item.meta === 'POLYMARKET');

      const sections: TickerSection[] = [];
      if (kalshiItems.length > 0) {
        sections.push({ id: 'kalshi', label: 'Kalshi', items: kalshiItems });
      }
      if (polymarketItems.length > 0) {
        sections.push({ id: 'polymarket', label: 'Polymarket', items: polymarketItems });
      }

      return {
        venue: 'event_demo',
        sections: sections.length > 0 ? sections : [
          { id: 'kalshi', label: 'Kalshi', items: kalshiItems },
          { id: 'polymarket', label: 'Polymarket', items: polymarketItems },
        ],
        lastUpdatedMs: Date.now(),
        isLive: hasLiveData,
        source: hasLivePolymarket ? 'polymarket' : hasLiveKalshi ? 'kalshi' : 'static',
      };
    }

    // Fallback to seeded markets if no live data
    const eventSnapshot = getEventSnapshot();
    const allMarketsSeeded = eventSnapshot.markets;

    // Separate markets by source
    const kalshiMarketsSeeded: Array<{ label: string; impliedProb: number }> = [];
    const polymarketMarketsSeeded: Array<{ label: string; impliedProb: number }> = [];

    for (const market of allMarketsSeeded) {
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
        kalshiMarketsSeeded.push(item);
      } else if (source === 'Polymarket') {
        polymarketMarketsSeeded.push(item);
      }
    }

    // Convert to TickerItems
    const kalshiItems: TickerItem[] = kalshiMarketsSeeded.slice(0, 4).map(m => ({
      label: m.label,
      value: `${Math.round(m.impliedProb * 100)}%`,
      impliedProb: m.impliedProb,
      meta: 'Kalshi',
      lean: m.impliedProb > 0.5 ? 'YES' : 'NO',
    }));

    const polymarketItems: TickerItem[] = polymarketMarketsSeeded.slice(0, 4).map(m => ({
      label: m.label,
      value: `${Math.round(m.impliedProb * 100)}%`,
      impliedProb: m.impliedProb,
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
        lastUpdatedMs: Date.now(),
        isLive: false,
        source: 'static',
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
      lastUpdatedMs: Date.now(),
      isLive: hasLiveData,
      source: hasLiveKalshi ? 'kalshi' : hasLivePolymarket ? 'polymarket' : 'snapshot',
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
      lastUpdatedMs: Date.now(),
      isLive: false,
      source: 'static',
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
    AVAX: 3.2,
    LINK: 0.8,
  };
  return changes[symbol] ?? 0;
}

