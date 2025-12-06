/**
 * Ticker Strip Component
 * Displays live price ticker for on-chain assets or event markets
 */

import { useState, useEffect } from 'react';
import { USE_AGENT_BACKEND } from '../lib/config';

const VITE_BLOSSOM_AGENT_URL = import.meta.env.VITE_BLOSSOM_AGENT_URL || 'http://localhost:3001';

interface OnchainTickerItem {
  symbol: string;
  priceUsd: number;
  change24hPct: number;
}

interface EventTickerItem {
  id: string;
  label: string;
  impliedProb: number;
  source: 'Kalshi' | 'Polymarket' | 'Demo';
}

interface TickerResponse {
  venue: string;
  onchain?: OnchainTickerItem[];
  events?: EventTickerItem[];
}

interface TickerStripProps {
  venue: 'hyperliquid' | 'event_demo';
}

// Static fallback for mock mode
const STATIC_ONCHAIN: OnchainTickerItem[] = [
  { symbol: 'BTC', priceUsd: 60000, change24hPct: 2.5 },
  { symbol: 'ETH', priceUsd: 3000, change24hPct: 1.8 },
  { symbol: 'SOL', priceUsd: 150, change24hPct: -0.5 },
  { symbol: 'AVAX', priceUsd: 35, change24hPct: 3.2 },
  { symbol: 'LINK', priceUsd: 14, change24hPct: 0.8 },
];

const STATIC_EVENTS: EventTickerItem[] = [
  { id: 'FED_CUTS_MAR_2025', label: 'Fed cuts in March 2025', impliedProb: 0.62, source: 'Kalshi' },
  { id: 'BTC_ETF_APPROVAL_2025', label: 'BTC ETF approved by Dec 31', impliedProb: 0.68, source: 'Kalshi' },
  { id: 'ETH_ETF_APPROVAL_2025', label: 'ETH ETF approved by June 2025', impliedProb: 0.58, source: 'Kalshi' },
  { id: 'US_ELECTION_2024', label: 'US Election Winner 2024', impliedProb: 0.50, source: 'Polymarket' },
  { id: 'CRYPTO_MCAP_THRESHOLD', label: 'Crypto market cap above $3T by year-end', impliedProb: 0.52, source: 'Polymarket' },
];

export function TickerStrip({ venue }: TickerStripProps) {
  const [loading, setLoading] = useState(true);
  const [onchainData, setOnchainData] = useState<OnchainTickerItem[]>([]);
  const [eventsData, setEventsData] = useState<EventTickerItem[]>([]);

  const fetchTicker = async () => {
    if (!USE_AGENT_BACKEND) {
      // Mock mode: use static data
      if (venue === 'event_demo') {
        setEventsData(STATIC_EVENTS);
      } else {
        setOnchainData(STATIC_ONCHAIN);
      }
      setLoading(false);
      return;
    }

    try {
      const agentUrl = VITE_BLOSSOM_AGENT_URL || 'http://localhost:3001';
      const response = await fetch(`${agentUrl}/api/ticker?venue=${venue}`);
      
      if (!response.ok) {
        throw new Error(`Ticker API error: ${response.status}`);
      }

      const data: TickerResponse = await response.json();
      
      if (venue === 'event_demo' && data.events) {
        setEventsData(data.events);
      } else if (data.onchain) {
        setOnchainData(data.onchain);
      }
      
      setLoading(false);
    } catch (err: any) {
      console.warn('Failed to fetch ticker:', err);
      // Use fallback data
      if (venue === 'event_demo') {
        setEventsData(STATIC_EVENTS);
      } else {
        setOnchainData(STATIC_ONCHAIN);
      }
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTicker();
    
    // Poll every 30 seconds
    const interval = setInterval(fetchTicker, 30000);
    
    return () => clearInterval(interval);
  }, [venue]);

  if (loading) {
    return (
      <div className="text-xs text-blossom-slate">
        Fetching markets...
      </div>
    );
  }

  if (venue === 'event_demo') {
    return (
      <div className="flex items-center gap-3 overflow-x-auto text-xs text-blossom-slate">
        {eventsData.map((item, idx) => (
          <span key={item.id} className="flex-shrink-0 whitespace-nowrap">
            {idx > 0 && <span className="mx-2">·</span>}
            <span>{item.label}</span>
            <span className="ml-1 font-medium">{Math.round(item.impliedProb * 100)}%</span>
            <span className="ml-1 text-[10px] opacity-70">· {item.source}</span>
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 overflow-x-auto text-xs text-blossom-slate">
      {onchainData.map((item, idx) => {
        const isPositive = item.change24hPct >= 0;
        const changeColor = isPositive ? 'text-green-600' : 'text-red-600';
        
        return (
          <span key={item.symbol} className="flex-shrink-0 whitespace-nowrap">
            {idx > 0 && <span className="mx-2">·</span>}
            <span className="font-medium">{item.symbol}</span>
            <span className="ml-1">${item.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            <span className={`ml-1 ${changeColor}`}>
              {isPositive ? '+' : ''}{item.change24hPct.toFixed(1)}%
            </span>
          </span>
        );
      })}
    </div>
  );
}

