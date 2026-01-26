/**
 * Ticker Strip Component
 * Bloomberg-style continuous marquee that scrolls from right to left
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { USE_AGENT_BACKEND } from '../lib/config';
import { callAgent, AGENT_API_BASE_URL } from '../lib/apiClient';
import { getDemoSpotPrices, type DemoSymbol } from '../lib/demoPriceFeed';

interface TickerItem {
  label: string;
  value: string;
  change?: string;
  meta?: string;
  impliedProb?: number; // 0–1, for event markets
  lean?: 'YES' | 'NO';
}

interface TickerSection {
  id: 'majors' | 'gainers' | 'defi' | 'kalshi' | 'polymarket';
  label: string;
  items: TickerItem[];
}

interface TickerPayload {
  venue: 'hyperliquid' | 'event_demo';
  sections: TickerSection[];
  lastUpdatedMs?: number;
  isLive?: boolean;
  source?: 'coingecko' | 'static' | 'snapshot' | 'kalshi' | 'polymarket';
}

interface TickerStripProps {
  venue: 'hyperliquid' | 'event_demo';
}

// Static fallback for mock mode
const STATIC_ONCHAIN_PAYLOAD: TickerPayload = {
  venue: 'hyperliquid',
  sections: [
    {
      id: 'majors',
      label: 'Majors',
      items: [
        { label: 'BTC', value: '$60,000', change: '+2.5%', meta: '24h' },
        { label: 'ETH', value: '$3,000', change: '+1.8%', meta: '24h' },
        { label: 'SOL', value: '$150', change: '-0.5%', meta: '24h' },
        { label: 'AVAX', value: '$35', change: '+3.2%', meta: '24h' },
        { label: 'LINK', value: '$14', change: '+0.8%', meta: '24h' },
      ],
    },
    {
      id: 'gainers',
      label: 'Top gainers (24h)',
      items: [
        { label: 'AVAX', value: '$35', change: '+3.2%', meta: 'Top gainer' },
        { label: 'BTC', value: '$60,000', change: '+2.5%', meta: 'Top gainer' },
        { label: 'ETH', value: '$3,000', change: '+1.8%', meta: 'Top gainer' },
        { label: 'LINK', value: '$14', change: '+0.8%', meta: 'Top gainer' },
      ],
    },
    {
      id: 'defi',
      label: 'DeFi TVL',
      items: [
        { label: 'Lido', value: '$28B TVL', meta: 'DeFi' },
        { label: 'Aave', value: '$12B TVL', meta: 'DeFi' },
        { label: 'Uniswap', value: '$8.5B TVL', meta: 'DeFi' },
        { label: 'Maker', value: '$6.2B TVL', meta: 'DeFi' },
      ],
    },
  ],
};

const STATIC_EVENT_PAYLOAD: TickerPayload = {
  venue: 'event_demo',
  sections: [
    {
      id: 'kalshi',
      label: 'Kalshi',
      items: [
        { label: 'Fed cuts in March 2025', value: '62%', meta: 'Kalshi', lean: 'YES' },
        { label: 'BTC ETF approved by Dec 31', value: '68%', meta: 'Kalshi', lean: 'YES' },
        { label: 'ETH ETF approved by June 2025', value: '58%', meta: 'Kalshi', lean: 'YES' },
      ],
    },
    {
      id: 'polymarket',
      label: 'Polymarket',
      items: [
        { label: 'US Election Winner 2024', value: '50%', meta: 'Polymarket', lean: 'YES' },
        { label: 'Crypto market cap above $3T by year-end', value: '52%', meta: 'Polymarket', lean: 'YES' },
      ],
    },
  ],
};

// Fallback items if payload is empty
const FALLBACK_ITEMS: TickerItem[] = [
  { label: 'BTC', value: '$60,000', change: '+2.5%', meta: '24h' },
  { label: 'ETH', value: '$3,000', change: '+1.8%', meta: '24h' },
];

function TickerItemPill({ item }: { item: TickerItem }) {
  const isNeg = item.change?.trim().startsWith('-');
  const changeColor = item.change
    ? (isNeg ? 'text-red-600' : 'text-green-600')
    : '';
  const isEvent = !!item.lean; // event markets have lean; on-chain do not

  return (
    <div className="flex items-center gap-1 whitespace-nowrap rounded-full bg-white/5 px-3 py-1 mr-6 min-w-0 flex-shrink-0">
      {/* Label */}
      <span className="truncate max-w-[220px] font-medium text-[11px] text-slate-700">
        {item.label}
      </span>

      <span className="mx-1 text-slate-400">·</span>

      {/* Value (percentage or price) */}
      <span className="text-xs tabular-nums text-slate-900 font-medium">
        {item.value}
      </span>

      {/* YES / NO lean (event markets only) */}
      {isEvent && item.lean && (
        <span
          className="ml-1 text-[10px] font-semibold uppercase tracking-wide"
          style={{ color: item.lean === 'YES' ? '#16A34A' : '#EF4444' }}
        >
          {item.lean}
        </span>
      )}

      {/* Change (for on-chain items) */}
      {item.change && (
        <span className={`ml-1 font-medium text-[11px] ${changeColor}`}>
          {item.change}
        </span>
      )}

      {/* Meta (KALSHI / POLYMARKET / 24h) */}
      {item.meta && (
        <>
          <span className="mx-1 text-slate-400">·</span>
          <span className="text-[10px] uppercase tracking-wide text-slate-400">
            {item.meta}
          </span>
        </>
      )}
    </div>
  );
}

export function TickerStrip({ venue }: TickerStripProps) {
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<TickerPayload | null>(null);
  const [connectionFailures, setConnectionFailures] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const hasLoggedWarningRef = useRef(false);
  const POLLING_INTERVAL_MS = 12 * 1000; // 12 seconds
  const MAX_FAILURES_BEFORE_STATIC = 3;

  // Guard against unmounted component updates
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Debug logging and warnings (dev-only)
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('[TickerStrip] Config:', {
        USE_AGENT_BACKEND,
        VITE_AGENT_API_URL: import.meta.env.VITE_AGENT_API_URL,
        AGENT_API_BASE_URL,
        venue,
      });
      
      // One-time warning if in mock mode
      if (!USE_AGENT_BACKEND) {
        console.warn(
          '[TickerStrip] Mock mode active: create .env.local with VITE_USE_AGENT_BACKEND=true to enable live prices.'
        );
      }
    }
  }, [venue]);

  const fetchTicker = async () => {
    // Event markets: use agent path (already structured for dFlow/Kalshi/Poly)
    if (venue === 'event_demo') {
      if (!USE_AGENT_BACKEND) {
        // Static event payload if agent disabled
        setPayload({
          ...STATIC_EVENT_PAYLOAD,
          lastUpdatedMs: Date.now(),
          isLive: false,
          source: 'static',
        });
        setLoading(false);
        return;
      }

      try {
        const response = await callAgent(`/api/ticker?venue=${venue}`);
        if (!response.ok) {
          throw new Error(`Ticker API error: ${response.status}`);
        }
        const data: TickerPayload = await response.json();
        if (data && data.sections && data.sections.length > 0) {
          setPayload(data);
          setConnectionFailures(0);
          setLastError(null);
        }
        setLoading(false);
      } catch (err: any) {
        console.warn('Failed to fetch event markets ticker:', err);
        if (!payload || !payload.lastUpdatedMs) {
          setPayload({
            ...STATIC_EVENT_PAYLOAD,
            lastUpdatedMs: Date.now(),
            isLive: false,
            source: 'static',
          });
        }
        setLoading(false);
      }
      return;
    }

    // On-chain venue: prefer CoinGecko demo feed, then agent, then static
    try {
      // Try CoinGecko price feed first (CORS-safe, no keys required)
      const demoPrices = await getDemoSpotPrices(['BTC', 'ETH', 'SOL', 'AVAX', 'LINK']);
      
      // Check if we got any live prices (isLive flag from CoinGecko)
      const hasLivePrices = Object.values(demoPrices).some(snapshot => snapshot.isLive);
      
      if (hasLivePrices && isMountedRef.current) {
        // Build ticker payload from demo prices
        const majorsItems = Object.entries(demoPrices).map(([symbol, snapshot]) => ({
          label: symbol,
          value: `$${snapshot.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
          change: snapshot.change24hPct !== undefined 
            ? `${snapshot.change24hPct >= 0 ? '+' : ''}${snapshot.change24hPct.toFixed(1)}%`
            : undefined,
          meta: '24h',
        }));

        // Top gainers (sort by 24h change desc, take top 4)
        const gainers = Object.entries(demoPrices)
          .filter(([_, snapshot]) => snapshot.change24hPct !== undefined)
          .sort((a, b) => (b[1].change24hPct ?? 0) - (a[1].change24hPct ?? 0))
          .slice(0, 4)
          .map(([symbol, snapshot]) => ({
            label: symbol,
            value: `$${snapshot.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
            change: `+${(snapshot.change24hPct ?? 0).toFixed(1)}%`,
            meta: 'Top gainer',
          }));

        // DeFi protocols (stub data - unchanged)
        const defiItems: TickerItem[] = [
          { label: 'Lido', value: '$28B TVL', meta: 'DeFi' },
          { label: 'Aave', value: '$12B TVL', meta: 'DeFi' },
          { label: 'Uniswap', value: '$8.5B TVL', meta: 'DeFi' },
          { label: 'Maker', value: '$6.2B TVL', meta: 'DeFi' },
        ];

        const demoPayload: TickerPayload = {
          venue: 'hyperliquid',
          sections: [
            { id: 'majors', label: 'Majors', items: majorsItems },
            { id: 'gainers', label: 'Top gainers (24h)', items: gainers },
            { id: 'defi', label: 'DeFi TVL', items: defiItems },
          ],
          lastUpdatedMs: Date.now(),
          isLive: true,
          source: 'coingecko',
        };

        setPayload(demoPayload);
        setConnectionFailures(0);
        setLastError(null);
        setLoading(false);
        hasLoggedWarningRef.current = false; // Reset warning flag on success
        return;
      } else if (!hasLivePrices && isMountedRef.current) {
        // CoinGecko returned static fallback - log warning once (DEV only)
        if (import.meta.env.DEV && !hasLoggedWarningRef.current) {
          console.warn('[TickerStrip] CoinGecko price feed unavailable, using last known prices');
          hasLoggedWarningRef.current = true;
        }
      }
    } catch (err: any) {
      // Demo feed failed silently (backoff handled in demoPriceFeed)
      // Only log in DEV and only once
      if (import.meta.env.DEV && !hasLoggedWarningRef.current) {
        console.warn('[TickerStrip] CoinGecko price feed failed, trying agent fallback');
        hasLoggedWarningRef.current = true;
      }
    }

    // Fallback to agent backend if demo feed failed and agent is enabled
    if (USE_AGENT_BACKEND) {
      try {
        const response = await callAgent(`/api/ticker?venue=${venue}`);
        
        if (!response.ok) {
          throw new Error(`Ticker API error: ${response.status}`);
        }

        const data: TickerPayload = await response.json();
        // Only update payload if we got valid data and component is mounted (stale-while-revalidate)
        if (isMountedRef.current && data && data.sections && data.sections.length > 0) {
          setPayload(data);
          setConnectionFailures(0); // Reset failure count on success
          setLastError(null);
          hasLoggedWarningRef.current = false; // Reset warning flag on success
        }
        if (isMountedRef.current) {
          setLoading(false);
        }
        return;
      } catch (err: any) {
        // Agent fallback failed - keep last payload (stale-while-revalidate)
        const newFailureCount = connectionFailures + 1;
        setConnectionFailures(newFailureCount);
        
        // Only log in DEV and only once per session
        if (import.meta.env.DEV && !hasLoggedWarningRef.current) {
          console.warn('[TickerStrip] Agent backend unavailable, using last known prices');
          hasLoggedWarningRef.current = true;
        }
      }
    }

    // Final fallback: static payload (only if no prior successful fetch and component is mounted)
    if (isMountedRef.current && (!payload || !payload.lastUpdatedMs)) {
      const staticPayload = STATIC_ONCHAIN_PAYLOAD;
      setPayload({
        ...staticPayload,
        lastUpdatedMs: Date.now(),
        isLive: false,
        source: 'static',
      });
    }
    if (isMountedRef.current) {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTicker();
    
    // Poll every 12 seconds
    const interval = setInterval(fetchTicker, POLLING_INTERVAL_MS);
    
    return () => clearInterval(interval);
  }, [venue]);

  // Flatten all sections into a single array of items
  const allItems: TickerItem[] = useMemo(() => {
    if (!payload) return FALLBACK_ITEMS;
    
    const flattened = payload.sections.flatMap(section =>
      section.items.map(item => ({
        ...item,
        // Use section label as meta if meta is not present
        meta: item.meta ?? section.label,
      }))
    );
    
    return flattened.length > 0 ? flattened : FALLBACK_ITEMS;
  }, [payload]);

  // Determine freshness and status
  const lastUpdatedMs = payload?.lastUpdatedMs ?? Date.now();
  const isLive = payload?.isLive ?? false;
  const ageMs = Date.now() - lastUpdatedMs;
  const isStale = ageMs > 2 * POLLING_INTERVAL_MS || !isLive;
  const isStaticFallback = payload?.source === 'static' && !USE_AGENT_BACKEND;
  const isAgentUnreachable = USE_AGENT_BACKEND && connectionFailures > 0 && (!payload || !payload.isLive);
  
  // Format timestamp
  const formatTime = (ms: number) => {
    const date = new Date(ms);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  };

  // Get tooltip text
  const getTooltipText = () => {
    if (isStaticFallback) {
      return 'Mock mode: Using static demo data. Set VITE_USE_AGENT_BACKEND=true for live prices.';
    }
    if (isAgentUnreachable) {
      return `Agent unreachable: ${lastError || 'Connection failed'}. Showing last known data.`;
    }
    if (isStale && !isLive) {
      return 'Data source returned static fallback prices.';
    }
    if (isStale) {
      return 'Data is older than expected. May be rate-limited or delayed.';
    }
    return 'Prices are live from CoinGecko API.';
  };

  if (loading && !payload && connectionFailures < MAX_FAILURES_BEFORE_STATIC) {
    return (
      <div className="text-[11px] text-blossom-slate whitespace-nowrap">
        Connecting...
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden h-7 flex items-center gap-2">
      {/* Freshness indicator */}
      <div 
        className="flex-shrink-0 text-[9px] text-slate-400 whitespace-nowrap"
        title={getTooltipText()}
      >
        {isStaticFallback ? (
          <span>Static (demo) • {formatTime(lastUpdatedMs)}</span>
        ) : isAgentUnreachable ? (
          <span>Stale (agent unreachable) • {formatTime(lastUpdatedMs)}</span>
        ) : isStale ? (
          <span>Stale • last update {formatTime(lastUpdatedMs)}</span>
        ) : (
          <span>Live • as of {formatTime(lastUpdatedMs)}</span>
        )}
      </div>
      
      {/* Ticker strip */}
      <div className="flex-1 overflow-hidden h-7 flex items-center">
        <div className="relative w-full overflow-hidden">
          <div className="ticker-track flex items-center whitespace-nowrap">
            {/* Render items twice for seamless looping */}
            {allItems.map((item, idx) => (
              <TickerItemPill key={`a-${idx}`} item={item} />
            ))}
            {allItems.map((item, idx) => (
              <TickerItemPill key={`b-${idx}`} item={item} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
