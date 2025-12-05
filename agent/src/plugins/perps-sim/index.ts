/**
 * Perps Simulation Plugin
 * Simulates perpetual futures trading
 */

import { v4 as uuidv4 } from 'uuid';
import { PerpPosition, PerpsAccountState } from './types';
import { getPrice, PriceSymbol } from '../../services/prices';

// Helper to extract base symbol from market
function getBaseSymbolFromMarket(market: string): PriceSymbol {
  const base = market.split('-')[0];
  if (base === 'ETH') return 'ETH';
  if (base === 'BTC') return 'BTC';
  if (base === 'SOL') return 'SOL';
  return 'ETH'; // Default fallback
}

// Initial account state
const INITIAL_BALANCES = [
  { symbol: 'USDC', balanceUsd: 4000 },
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
export async function openPerp(spec: {
  market: string;
  side: 'long' | 'short';
  riskPct: number;
  entry?: number;
  takeProfit?: number;
  stopLoss?: number;
}): Promise<PerpPosition> {
  const { market, side, riskPct, entry, takeProfit, stopLoss } = spec;

  // Calculate size based on risk
  const sizeUsd = accountState.accountValueUsd * (riskPct / 100);
  
  // Check USDC balance
  const usdcBalance = accountState.balances.find(b => b.symbol === 'USDC');
  if (!usdcBalance || usdcBalance.balanceUsd < sizeUsd) {
    throw new Error(`Insufficient USDC balance. Need $${sizeUsd.toFixed(2)}, have $${usdcBalance?.balanceUsd.toFixed(2) || 0}`);
  }

  // Use provided entry or fetch real price
  let entryPrice: number;
  if (entry) {
    entryPrice = entry;
  } else {
    const baseSymbol = getBaseSymbolFromMarket(market);
    const priceSnapshot = await getPrice(baseSymbol);
    entryPrice = priceSnapshot.priceUsd;
  }
  
  // Calculate TP/SL if not provided (small deterministic move around entry)
  const calculatedTP = takeProfit || (side === 'long' ? entryPrice * 1.04 : entryPrice * 0.96);
  const calculatedSL = stopLoss || (side === 'long' ? entryPrice * 0.97 : entryPrice * 1.03);

  // Deduct margin from USDC
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
export async function closePerp(id: string): Promise<{ position: PerpPosition; pnl: number }> {
  const position = accountState.positions.find(p => p.id === id && !p.isClosed);
  if (!position) {
    throw new Error(`Position ${id} not found or already closed`);
  }

  // Calculate PnL based on current price vs entry
  const baseSymbol = getBaseSymbolFromMarket(position.market);
  const currentPriceSnapshot = await getPrice(baseSymbol);
  const currentPrice = currentPriceSnapshot.priceUsd;
  
  // Calculate PnL based on price movement
  let pnlPct: number;
  if (position.side === 'long') {
    pnlPct = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
  } else {
    pnlPct = ((position.entryPrice - currentPrice) / position.entryPrice) * 100;
  }
  
  // Clamp to reasonable range for demo (between -2% and +2%)
  pnlPct = Math.max(-2, Math.min(2, pnlPct));
  
  const realizedPnlUsd = (position.sizeUsd * pnlPct) / 100;

  // Update position
  position.isClosed = true;
  position.closedAt = Date.now();
  position.realizedPnlUsd = realizedPnlUsd;
  position.unrealizedPnlUsd = 0;

  // Credit USDC with size + PnL
  const usdcBalance = accountState.balances.find(b => b.symbol === 'USDC');
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
 * Update USDC balance (for DeFi/Event sims to sync)
 */
export function updateUsdcBalance(delta: number): void {
  const usdc = accountState.balances.find(b => b.symbol === 'USDC');
  if (usdc) {
    usdc.balanceUsd += delta;
    accountState.accountValueUsd = accountState.balances.reduce((sum, b) => sum + b.balanceUsd, 0);
  }
}

/**
 * Get current USDC balance
 */
export function getUsdcBalance(): number {
  const usdc = accountState.balances.find(b => b.symbol === 'USDC');
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

