/**
 * Event Markets Simulation Types
 */

export interface EventMarket {
  key: string;
  label: string;
  winProbability: number;
  payoutMultiple: number; // e.g. 1.7x
}

export interface EventPosition {
  id: string;
  eventKey: string;
  label: string;
  side: 'YES' | 'NO';
  stakeUsd: number;
  maxPayoutUsd: number;
  maxLossUsd: number;
  outcome?: 'won' | 'lost';
  isClosed: boolean;
  closedAt?: number;
  realizedPnlUsd?: number;
}

export interface EventState {
  markets: EventMarket[];
  positions: EventPosition[];
}

