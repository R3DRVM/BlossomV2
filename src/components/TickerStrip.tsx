/**
 * Ticker Strip Component
 * Bloomberg-style continuous marquee that scrolls from right to left
 */

import { useState, useEffect, useMemo } from 'react';
import { USE_AGENT_BACKEND } from '../lib/config';

const VITE_BLOSSOM_AGENT_URL = import.meta.env.VITE_BLOSSOM_AGENT_URL || 'http://localhost:3001';

interface TickerItem {
  label: string;
  value: string;
  change?: string;
  meta?: string;
}

interface TickerSection {
  id: 'majors' | 'gainers' | 'defi' | 'kalshi' | 'polymarket';
  label: string;
  items: TickerItem[];
}

interface TickerPayload {
  venue: 'hyperliquid' | 'event_demo';
  sections: TickerSection[];
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
        { label: 'Fed cuts in March 2025', value: '62%', meta: 'Kalshi' },
        { label: 'BTC ETF approved by Dec 31', value: '68%', meta: 'Kalshi' },
        { label: 'ETH ETF approved by June 2025', value: '58%', meta: 'Kalshi' },
      ],
    },
    {
      id: 'polymarket',
      label: 'Polymarket',
      items: [
        { label: 'US Election Winner 2024', value: '50%', meta: 'Polymarket' },
        { label: 'Crypto market cap above $3T by year-end', value: '52%', meta: 'Polymarket' },
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

  return (
    <div className="flex items-center text-[11px] text-blossom-ink/80 gap-1 mr-6 min-w-0 flex-shrink-0">
      <span className="font-medium truncate">{item.label}</span>
      {item.value && (
        <>
          <span className="text-blossom-slate">·</span>
          <span className="truncate">{item.value}</span>
        </>
      )}
      {item.change && (
        <span className={`ml-1 font-medium ${changeColor}`}>
          {item.change}
        </span>
      )}
      {item.meta && (
        <span className="ml-1 text-[9px] uppercase tracking-wide text-blossom-slate">
          {item.meta}
        </span>
      )}
    </div>
  );
}

export function TickerStrip({ venue }: TickerStripProps) {
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<TickerPayload | null>(null);

  const fetchTicker = async () => {
    if (!USE_AGENT_BACKEND) {
      // Mock mode: use static data
      setPayload(venue === 'event_demo' ? STATIC_EVENT_PAYLOAD : STATIC_ONCHAIN_PAYLOAD);
      setLoading(false);
      return;
    }

    try {
      const agentUrl = VITE_BLOSSOM_AGENT_URL;
      const response = await fetch(`${agentUrl}/api/ticker?venue=${venue}`);
      
      if (!response.ok) {
        throw new Error(`Ticker API error: ${response.status}`);
      }

      const data: TickerPayload = await response.json();
      setPayload(data);
      setLoading(false);
    } catch (err: any) {
      console.warn('Failed to fetch ticker:', err);
      // Use fallback data
      setPayload(venue === 'event_demo' ? STATIC_EVENT_PAYLOAD : STATIC_ONCHAIN_PAYLOAD);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTicker();
    
    // Poll every 30 seconds
    const interval = setInterval(fetchTicker, 30000);
    
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

  if (loading) {
    return (
      <div className="text-[11px] text-blossom-slate whitespace-nowrap">
        Fetching markets...
      </div>
    );
  }

  return (
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
  );
}
