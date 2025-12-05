/**
 * Perps Simulation Types
 */

export interface PerpPosition {
  id: string;
  market: string;
  side: 'long' | 'short';
  sizeUsd: number;
  entryPrice: number;
  takeProfit?: number;
  stopLoss?: number;
  unrealizedPnlUsd: number;
  isClosed: boolean;
  closedAt?: number;
  realizedPnlUsd?: number;
}

export interface PerpsAccountState {
  accountValueUsd: number;
  balances: { symbol: string; balanceUsd: number }[];
  positions: PerpPosition[];
}

