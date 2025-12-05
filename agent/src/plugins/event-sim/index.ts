/**
 * Event Markets Simulation Plugin
 * Simulates event/prediction market positions
 */

import { v4 as uuidv4 } from 'uuid';
import { EventMarket, EventPosition, EventState } from './types';

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
export function openEventPosition(
  eventKey: string,
  side: 'YES' | 'NO',
  stakeUsd: number
): EventPosition {
  const market = eventState.markets.find(m => m.key === eventKey);
  if (!market) {
    throw new Error(`Event market ${eventKey} not found`);
  }

  // Check USDC balance
  const currentBalance = getUsdcBalance ? getUsdcBalance() : 0;
  if (currentBalance < stakeUsd) {
    throw new Error(`Insufficient USDC balance. Need $${stakeUsd.toFixed(2)}, have $${currentBalance.toFixed(2)}`);
  }

  // Deduct stake from USDC
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
  };

  eventState.positions.push(position);
  return position;
}

/**
 * Close an event position
 */
export function closeEventPosition(id: string): { position: EventPosition; pnl: number } {
  const position = eventState.positions.find(p => p.id === id && !p.isClosed);
  if (!position) {
    throw new Error(`Position ${id} not found or already closed`);
  }

  const market = eventState.markets.find(m => m.key === position.eventKey);
  if (!market) {
    throw new Error(`Market ${position.eventKey} not found`);
  }

  // Sample outcome using win probability
  const isWin = Math.random() < market.winProbability;
  const outcome: 'won' | 'lost' = isWin ? 'won' : 'lost';

  // Calculate PnL
  let realizedPnlUsd: number;
  if (isWin) {
    realizedPnlUsd = position.maxPayoutUsd - position.stakeUsd; // Profit
    // Credit max payout to USDC
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

  return { position, pnl: realizedPnlUsd };
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

