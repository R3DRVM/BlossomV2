/**
 * Pure formatting utilities for plan card display (UI-only, no context imports)
 */

/**
 * Format leverage for display (UI fallback only)
 * @param leverage - Leverage value (can be undefined/null)
 * @returns Formatted string like "10×" or "1×" or "—"
 */
export function formatLeverage(leverage?: number | null): string {
  if (leverage === undefined || leverage === null || isNaN(leverage)) {
    return '1×';
  }
  return `${leverage}×`;
}

/**
 * Format margin/notional for display
 * @param amount - Amount in USD
 * @returns Formatted string like "$1,234"
 */
export function formatMarginNotional(amount?: number | null): string {
  if (amount === undefined || amount === null || isNaN(amount) || amount === 0) {
    return '—';
  }
  return `$${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/**
 * Format USD amount or show dash for missing/zero values (presentation-only)
 * @param value - USD amount (can be undefined/null/0)
 * @returns Formatted string like "$1,234" or "—"
 */
export function formatUsdOrDash(value?: number | null): string {
  if (value === undefined || value === null) return "—";
  if (Number.isNaN(value)) return "—";
  if (value === 0) return "—"; // treat 0 as "missing" for demo UI
  return `$${Math.round(value).toLocaleString()}`;
}

/**
 * Format venue display text
 * @param venue - Venue type
 * @param executionMode - Execution mode ('auto' | 'confirm' | 'manual')
 * @returns Formatted string like "Auto-selected → Hyperliquid (simulated)"
 */
export function formatVenueDisplay(venue: 'hyperliquid' | 'event_demo', executionMode?: 'auto' | 'confirm' | 'manual'): string {
  const venueName = venue === 'hyperliquid' ? 'Hyperliquid' : 'Event Markets';
  
  if (executionMode === 'auto' || executionMode === undefined) {
    return `Auto-selected → ${venueName} (simulated)`;
  } else if (executionMode === 'manual') {
    return `${venueName} (manual)`;
  } else {
    return `${venueName} (confirm mode)`;
  }
}

/**
 * Simple hash function for deterministic selection
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Get simulated route display (deterministic, presentation-only)
 * @param input - Strategy identifiers and execution mode
 * @returns Simulated route information for display
 */
export function getSimulatedRouteDisplay(input: {
  strategyId?: string | null;
  market?: string | null;
  instrumentType?: string | null;
  executionMode?: 'auto' | 'confirm' | 'manual';
}): {
  venueLabel: string;
  chainLabel: string;
  slippageLabel: string;
  settlementLabel: string;
  routeNote?: string;
} {
  const { strategyId, market, instrumentType, executionMode } = input;
  
  // For manual mode or non-perp, use default venue display
  if (executionMode === 'manual' || instrumentType !== 'perp') {
    return {
      venueLabel: 'Hyperliquid',
      chainLabel: 'HyperEVM',
      slippageLabel: '< 0.10% (simulated)',
      settlementLabel: 'T+0 (simulated)',
      routeNote: executionMode === 'manual' ? undefined : 'Abstracted (auto-selected)',
    };
  }
  
  // Deterministic selection based on strategyId or market
  const seed = strategyId || market || 'default';
  const hash = simpleHash(seed);
  
  const venues = ['Hyperliquid', 'dYdX', 'Drift', 'GMX', 'Vertex'];
  const chains = ['Arbitrum', 'Solana', 'Base', 'HyperEVM'];
  const slippages = ['< 0.08%', '< 0.10%', '< 0.12%', '< 0.15%'];
  const settlements = ['T+0', '~1 block', 'T+0', '~1 block'];
  
  const venueIndex = hash % venues.length;
  const chainIndex = (hash >> 8) % chains.length;
  const slippageIndex = (hash >> 16) % slippages.length;
  const settlementIndex = (hash >> 24) % settlements.length;
  
  return {
    venueLabel: venues[venueIndex],
    chainLabel: chains[chainIndex],
    slippageLabel: `${slippages[slippageIndex]} (simulated)`,
    settlementLabel: `${settlements[settlementIndex]} (simulated)`,
    routeNote: 'Abstracted (auto-selected)',
  };
}

/**
 * Format event venue and chain labels based on market source
 * @param source - Event market source ('polymarket' | 'kalshi' | 'static' | undefined)
 * @returns Venue and chain labels
 */
export function formatEventVenueDisplay(source?: 'polymarket' | 'kalshi' | 'static'): {
  venue: string;
  chain: string;
} {
  if (source === 'polymarket') {
    return {
      venue: 'Polymarket',
      chain: 'Polygon',
    };
  }
  if (source === 'kalshi') {
    return {
      venue: 'Kalshi',
      chain: '—', // Kalshi has no chain
    };
  }
  // Default: static or undefined
  return {
    venue: 'Prediction Markets (demo)',
    chain: 'Simulated',
  };
}

