/**
 * Perps Simulation Plugin
 * Simulates perpetual futures trading
 */

import { v4 as uuidv4 } from 'uuid';
import { PerpPosition, PerpsAccountState } from './types';

// Default prices for markets
const DEFAULT_PRICES: Record<string, number> = {
  'ETH-PERP': 3500,
  'BTC-PERP': 45000,
  'SOL-PERP': 100,
  'BNB-PERP': 300,
  'AVAX-PERP': 40,
};

// Initial account state
const INITIAL_BALANCES = [
  { symbol: 'REDACTED', balanceUsd: 4000 },
  { symbol: 'ETH', balanceUsd: 3000 },
  { symbol: 'SOL', balanceUsd: 3000 },
];

let accountState: PerpsAccountState = {
  accountValueUsd: 10000,
  balances: [...INITIAL_BALANCES],
  positions: [],
};

/**
 * Open a perp position
 */
export function openPerp(spec: {
  market: string;
  side: 'long' | 'short';
  riskPct: number;
  entry?: number;
  takeProfit?: number;
  stopLoss?: number;
}): PerpPosition {
  const { market, side, riskPct, entry, takeProfit, stopLoss } = spec;

  // Calculate size based on risk
  const sizeUsd = accountState.accountValueUsd * (riskPct / 100);
  
  // Check REDACTED balance
  const usdcBalance = accountState.balances.find(b => b.symbol === 'REDACTED');
  if (!usdcBalance || usdcBalance.balanceUsd < sizeUsd) {
    throw new Error(`Insufficient REDACTED balance. Need $${sizeUsd.toFixed(2)}, have $${usdcBalance?.balanceUsd.toFixed(2) || 0}`);
  }

  // Use provided entry or default price
  const entryPrice = entry || DEFAULT_PRICES[market] || 3500;
  
  // Calculate TP/SL if not provided
  const calculatedTP = takeProfit || (side === 'long' ? entryPrice * 1.04 : entryPrice * 0.96);
  const calculatedSL = stopLoss || (side === 'long' ? entryPrice * 0.97 : entryPrice * 1.03);

  // Deduct margin from REDACTED
  usdcBalance.balanceUsd -= sizeUsd;

  // Create position
  const position: PerpPosition = {
    id: uuidv4(),
    market,
    side,
    sizeUsd,
    entryPrice,
    takeProfit: calculatedTP,
    stopLoss: calculatedSL,
    unrealizedPnlUsd: 0,
    isClosed: false,
  };

  accountState.positions.push(position);
  accountState.accountValueUsd = accountState.balances.reduce((sum, b) => sum + b.balanceUsd, 0);

  return position;
}

/**
 * Close a perp position
 */
export function closePerp(id: string): { position: PerpPosition; pnl: number } {
  const position = accountState.positions.find(p => p.id === id && !p.isClosed);
  if (!position) {
    throw new Error(`Position ${id} not found or already closed`);
  }

  // Simple deterministic PnL for MVP
  // In production, this would use real price data
  const pnlPct = position.side === 'long' ? 0.8 : 0.6; // 0.8% profit for long, 0.6% for short
  const realizedPnlUsd = (position.sizeUsd * pnlPct) / 100;

  // Update position
  position.isClosed = true;
  position.closedAt = Date.now();
  position.realizedPnlUsd = realizedPnlUsd;
  position.unrealizedPnlUsd = 0;

  // Credit REDACTED with size + PnL
  const usdcBalance = accountState.balances.find(b => b.symbol === 'REDACTED');
  if (usdcBalance) {
    usdcBalance.balanceUsd += position.sizeUsd + realizedPnlUsd;
  }

  // Recalculate account value
  accountState.accountValueUsd = accountState.balances.reduce((sum, b) => sum + b.balanceUsd, 0);

  return { position, pnl: realizedPnlUsd };
}

/**
 * Get perps account snapshot
 */
export function getPerpsSnapshot(): PerpsAccountState {
  // Calculate open exposure
  const openPositions = accountState.positions.filter(p => !p.isClosed);
  const openPerpExposureUsd = openPositions.reduce((sum, p) => sum + p.sizeUsd, 0);

  return {
    ...accountState,
    positions: [...accountState.positions],
  };
}

/**
 * Update REDACTED balance (for DeFi/Event sims to sync)
 */
export function updateUsdcBalance(delta: number): void {
  const usdc = accountState.balances.find(b => b.symbol === 'REDACTED');
  if (usdc) {
    usdc.balanceUsd += delta;
    accountState.accountValueUsd = accountState.balances.reduce((sum, b) => sum + b.balanceUsd, 0);
  }
}

/**
 * Get current REDACTED balance
 */
export function getUsdcBalance(): number {
  const usdc = accountState.balances.find(b => b.symbol === 'REDACTED');
  return usdc?.balanceUsd || 0;
}

/**
 * Reset account to initial state (for testing)
 */
export function resetPerpsAccount(): void {
  accountState = {
    accountValueUsd: 10000,
    balances: [...INITIAL_BALANCES],
    positions: [],
  };
}

