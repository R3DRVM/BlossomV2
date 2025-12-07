/**
 * Event Markets Simulation Plugin
 * Simulates event/prediction market positions
 */

import { v4 as uuidv4 } from 'uuid';
import { EventMarket, EventPosition, EventState } from './types';
import { fetchKalshiMarkets, fetchPolymarketMarkets, RawPredictionMarket } from '../../services/predictionData';

// Seed markets matching front-end mock
const SEEDED_MARKETS: EventMarket[] = [
  {
    key: 'FED_CUTS_MAR_2025',
    label: 'Fed cuts in March 2025',
    winProbability: 0.55,
    payoutMultiple: 1.7,
  },
  {
    key: 'BTC_ETF_APPROVAL_2025',
    label: 'BTC ETF approved by Dec 31',
    winProbability: 0.60,
    payoutMultiple: 1.6,
  },
  {
    key: 'ETH_ETF_APPROVAL_2025',
    label: 'ETH ETF approved by June 2025',
    winProbability: 0.58,
    payoutMultiple: 1.65,
  },
  {
    key: 'US_ELECTION_2024',
    label: 'US Election Winner 2024',
    winProbability: 0.50,
    payoutMultiple: 1.8,
  },
  {
    key: 'CRYPTO_MCAP_THRESHOLD',
    label: 'Crypto market cap above $3T by year-end',
    winProbability: 0.52,
    payoutMultiple: 1.75,
  },
  {
    key: 'GENERIC_EVENT_DEMO',
    label: 'Generic Event Demo',
    winProbability: 0.50,
    payoutMultiple: 1.5,
  },
];

let eventState: EventState = {
  markets: [...SEEDED_MARKETS],
  positions: [],
};

// Reference to perps account for balance updates
let getUsdcBalance: () => number;
let updateUsdcBalance: (delta: number) => void;

export function setBalanceCallbacks(
  getBalance: () => number,
  updateBalance: (delta: number) => void
): void {
  getUsdcBalance = getBalance;
  updateUsdcBalance = updateBalance;
}

/**
 * Open an event position
 */
export async function openEventPosition(
  eventKey: string,
  side: 'YES' | 'NO',
  stakeUsd: number,
  label?: string // Optional label for live markets
): Promise<EventPosition> {
  let market = eventState.markets.find(m => m.key === eventKey);
  
  // If market not found in seeded markets, try to find it in live markets
  if (!market) {
    try {
      const kalshiMarkets = await fetchKalshiMarkets();
      const polymarketMarkets = await fetchPolymarketMarkets();
      const allLiveMarkets = [...kalshiMarkets, ...polymarketMarkets];
      
      const liveMarket = allLiveMarkets.find(m => m.id === eventKey);
      
      if (liveMarket) {
        // Create a temporary market entry for this live market
        const yesPrice = liveMarket.yesPrice;
        const winProbability = side === 'YES' ? yesPrice : 1 - yesPrice;
        const payoutMultiple = 1 / winProbability; // Inverse of probability
        
        market = {
          key: eventKey,
          label: label || liveMarket.title,
          winProbability,
          payoutMultiple,
        };
        
        // Add to state temporarily (won't persist across resets, but that's fine)
        eventState.markets.push(market);
        console.log(`[EventSim] Created temporary market entry for live market: ${market.label}`);
      }
    } catch (error) {
      console.warn('[EventSim] Could not lookup live market:', error);
    }
  }
  
  if (!market) {
    throw new Error(`Event market ${eventKey} not found in seeded or live markets`);
  }

  // Check REDACTED balance
  const currentBalance = getUsdcBalance ? getUsdcBalance() : 0;
  if (currentBalance < stakeUsd) {
    throw new Error(`Insufficient REDACTED balance. Need $${stakeUsd.toFixed(2)}, have $${currentBalance.toFixed(2)}`);
  }

  // Try to find matching live market for mark-to-market tracking
  let marketSource: 'KALSHI' | 'POLYMARKET' | 'DEMO' = 'DEMO';
  let externalMarketId: string | undefined = undefined;

  try {
    const kalshiMarkets = await fetchKalshiMarkets();
    const polymarketMarkets = await fetchPolymarketMarkets();
    const allLiveMarkets = [...kalshiMarkets, ...polymarketMarkets];
    
    // Try to match by title (fuzzy match)
    const matchedMarket = allLiveMarkets.find(m => 
      m.title.toLowerCase().includes(market.label.toLowerCase()) ||
      market.label.toLowerCase().includes(m.title.toLowerCase())
    );

    if (matchedMarket) {
      marketSource = matchedMarket.source;
      externalMarketId = matchedMarket.id;
    }
  } catch (error) {
    // Silently fall back to DEMO if live market lookup fails
    console.warn('[EventSim] Could not match to live market, using DEMO source');
  }

  // Deduct stake from REDACTED
  if (updateUsdcBalance) {
    updateUsdcBalance(-stakeUsd);
  }

  // Calculate max payout and loss
  const maxPayoutUsd = stakeUsd * market.payoutMultiple;
  const maxLossUsd = stakeUsd;

  // Create position
  const position: EventPosition = {
    id: uuidv4(),
    eventKey,
    label: market.label,
    side,
    stakeUsd,
    maxPayoutUsd,
    maxLossUsd,
    isClosed: false,
    marketSource,
    externalMarketId,
  };

  eventState.positions.push(position);
  return position;
}

/**
 * Get live market price for an event position (if available)
 */
export async function getLiveEventPrice(position: EventPosition): Promise<number | undefined> {
  if (!position.externalMarketId || !position.marketSource || position.marketSource === 'DEMO') {
    return undefined;
  }

  try {
    const markets = position.marketSource === 'KALSHI'
      ? await fetchKalshiMarkets()
      : await fetchPolymarketMarkets();
    
    const liveMarket = markets.find(m => m.id === position.externalMarketId);
    if (liveMarket) {
      return liveMarket.yesPrice; // Return current YES probability
    }
  } catch (error) {
    console.warn(`[EventSim] Failed to fetch live price for position ${position.id}:`, error);
  }

  return undefined;
}

/**
 * Update an event position's stake
 */
export async function updateEventStake(params: {
  positionId: string;
  newStakeUsd: number;
  overrideRiskCap: boolean;
  requestedStakeUsd?: number;
}): Promise<EventPosition> {
  const position = eventState.positions.find(p => p.id === params.positionId && !p.isClosed);
  if (!position) {
    throw new Error(`Event position ${params.positionId} not found or already closed`);
  }

  const currentBalance = getUsdcBalance ? getUsdcBalance() : 0;
  const stakeDelta = params.newStakeUsd - position.stakeUsd;

  // Check if we have enough balance for the increase
  if (stakeDelta > 0 && currentBalance < stakeDelta) {
    throw new Error(`Insufficient REDACTED balance. Need $${stakeDelta.toFixed(2)} more, have $${currentBalance.toFixed(2)}`);
  }

  // Find the market to recalculate payout
  const market = eventState.markets.find(m => m.key === position.eventKey);
  if (!market) {
    throw new Error(`Market ${position.eventKey} not found`);
  }

  // Update REDACTED balance
  if (updateUsdcBalance) {
    updateUsdcBalance(-stakeDelta);
  }

  // Recalculate max payout and loss
  const maxPayoutUsd = params.newStakeUsd * market.payoutMultiple;
  const maxLossUsd = params.newStakeUsd;

  // Update position
  position.stakeUsd = params.newStakeUsd;
  position.maxPayoutUsd = maxPayoutUsd;
  position.maxLossUsd = maxLossUsd;
  position.overrideRiskCap = params.overrideRiskCap;
  if (params.requestedStakeUsd !== undefined) {
    position.requestedStakeUsd = params.requestedStakeUsd;
  }

  return position;
}

/**
 * Close an event position
 */
export async function closeEventPosition(id: string): Promise<{ position: EventPosition; pnl: number; liveMarkToMarketUsd?: number }> {
  const position = eventState.positions.find(p => p.id === id && !p.isClosed);
  if (!position) {
    throw new Error(`Position ${id} not found or already closed`);
  }

  const market = eventState.markets.find(m => m.key === position.eventKey);
  if (!market) {
    throw new Error(`Market ${position.eventKey} not found`);
  }

  // Try to get live mark-to-market price
  let liveMarkToMarketUsd: number | undefined = undefined;
  try {
    const currentProb = await getLiveEventPrice(position);
    if (currentProb !== undefined) {
      // Calculate what PnL would be if settled at current market price
      if (position.side === 'YES') {
        // If YES wins at current prob, payout = stake * (1 / currentProb)
        // Mark-to-market value = current payout value - stake
        const currentPayoutValue = position.stakeUsd * (1 / currentProb);
        liveMarkToMarketUsd = currentPayoutValue - position.stakeUsd;
      } else {
        // If NO wins at (1 - currentProb), payout = stake * (1 / (1 - currentProb))
        const currentPayoutValue = position.stakeUsd * (1 / (1 - currentProb));
        liveMarkToMarketUsd = currentPayoutValue - position.stakeUsd;
      }
    }
  } catch (error) {
    // Silently ignore mark-to-market errors
    console.warn(`[EventSim] Could not compute live mark-to-market:`, error);
  }

  // Sample outcome using win probability (existing behavior)
  const isWin = Math.random() < market.winProbability;
  const outcome: 'won' | 'lost' = isWin ? 'won' : 'lost';

  // Calculate PnL
  let realizedPnlUsd: number;
  if (isWin) {
    realizedPnlUsd = position.maxPayoutUsd - position.stakeUsd; // Profit
    // Credit max payout to REDACTED
    if (updateUsdcBalance) {
      updateUsdcBalance(position.maxPayoutUsd);
    }
  } else {
    realizedPnlUsd = -position.stakeUsd; // Loss (stake already deducted)
    // No refund
  }

  // Update position
  position.isClosed = true;
  position.closedAt = Date.now();
  position.outcome = outcome;
  position.realizedPnlUsd = realizedPnlUsd;

  return { position, pnl: realizedPnlUsd, liveMarkToMarketUsd };
}

/**
 * Get event snapshot
 */
export function getEventSnapshot(): EventState {
  const openPositions = eventState.positions.filter(p => !p.isClosed);
  const eventExposureUsd = openPositions.reduce((sum, p) => sum + p.stakeUsd, 0);

  return {
    markets: [...eventState.markets],
    positions: [...eventState.positions],
  };
}

/**
 * Get total event exposure
 */
export function getEventExposureUsd(): number {
  const openPositions = eventState.positions.filter(p => !p.isClosed);
  return openPositions.reduce((sum, p) => sum + p.stakeUsd, 0);
}

/**
 * Reset event state (for testing)
 */
export function resetEventState(): void {
  eventState = {
    markets: [...SEEDED_MARKETS],
    positions: [],
  };
}

