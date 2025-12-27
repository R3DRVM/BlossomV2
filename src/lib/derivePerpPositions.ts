import { Strategy } from '../context/BlossomContext';

/**
 * Derive perp positions from strategies
 * Returns an array of position objects with strategyId for active perp positions
 */
export interface DerivedPerpPosition {
  strategyId: string;
  market: string;
  instrument: string; // Alias for market (used in test code)
  side: 'Long' | 'Short';
  notionalUsd: number;
  marginUsd?: number;
  leverage?: number;
}

export function derivePerpPositionsFromStrategies(strategies: Strategy[]): DerivedPerpPosition[] {
  return strategies
    .filter(s => 
      s.instrumentType === 'perp' &&
      (s.status === 'executed' || s.status === 'executing') &&
      !s.isClosed &&
      (s.notionalUsd ?? 0) > 0
    )
    .map(s => ({
      strategyId: s.id,
      market: s.market,
      instrument: s.market, // Alias for market
      side: s.side,
      notionalUsd: s.notionalUsd ?? 0,
      marginUsd: s.marginUsd,
      leverage: s.leverage,
    }));
}

