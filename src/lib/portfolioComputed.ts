import { AccountState, Strategy, DefiPosition, isOpenPerp, isOpenEvent, isActiveDefi } from '../context/BlossomContext';

export interface ExposureByAsset {
  asset: string;
  percentage: number;
  amountUsd?: number;
}

export interface ExposureByType {
  spot: number;
  perps: number;
  events: number;
  defi: number;
  total: number;
}

export interface OpenPosition {
  id: string;
  type: 'perp' | 'event' | 'defi';
  market: string;
  side?: 'Long' | 'Short';
  riskPercent?: number;
  notionalUsd?: number;
  stakeUsd?: number;
  depositUsd?: number;
  pnlPct?: number;
}

/**
 * Compute exposure breakdown by asset class (spot, perps, events, defi)
 */
export function computeExposureByAsset(
  account: AccountState,
  _strategies: Strategy[],
  defiPositions: DefiPosition[]
): ExposureByAsset[] {
  const { accountValue, eventExposureUsd, openPerpExposure } = account;

  // Compute DeFi exposure
  const activeDefiPositions = defiPositions.filter(isActiveDefi);
  const totalDefiDeposits = activeDefiPositions.reduce((sum, p) => sum + (p.depositUsd ?? 0), 0);

  // Event markets exposure
  const totalEventExposure = eventExposureUsd ?? 0;

  // Perps exposure
  const perpExposure = openPerpExposure ?? 0;

  // Cash / residual (spot balances minus exposures)
  const spotAndCash = Math.max(
    accountValue - (perpExposure + totalDefiDeposits + totalEventExposure),
    0
  );

  // Total for exposure calculation
  const totalForExposure = perpExposure + totalDefiDeposits + totalEventExposure + spotAndCash || 1;

  if (totalForExposure <= 0) {
    // Fallback mock data
    return [
      { asset: 'USDC', percentage: 40, amountUsd: accountValue * 0.4 },
      { asset: 'ETH', percentage: 30, amountUsd: accountValue * 0.3 },
      { asset: 'SOL', percentage: 30, amountUsd: accountValue * 0.3 },
    ];
  }

  const result: ExposureByAsset[] = [];

  if (spotAndCash > 0) {
    result.push({
      asset: 'USDC / Spot & Cash',
      percentage: Math.round((spotAndCash / totalForExposure) * 100),
      amountUsd: spotAndCash,
    });
  }

  if (perpExposure > 0) {
    result.push({
      asset: 'Perps',
      percentage: Math.round((perpExposure / totalForExposure) * 100),
      amountUsd: perpExposure,
    });
  }

  if (totalDefiDeposits > 0) {
    result.push({
      asset: 'DeFi (yield)',
      percentage: Math.round((totalDefiDeposits / totalForExposure) * 100),
      amountUsd: totalDefiDeposits,
    });
  }

  if (totalEventExposure > 0) {
    result.push({
      asset: 'Event Markets',
      percentage: Math.round((totalEventExposure / totalForExposure) * 100),
      amountUsd: totalEventExposure,
    });
  }

  return result;
}

/**
 * Compute exposure breakdown by type (spot, perps, events, defi)
 */
export function computeExposureByType(
  account: AccountState,
  _strategies: Strategy[],
  defiPositions: DefiPosition[]
): ExposureByType {
  const { accountValue, eventExposureUsd, openPerpExposure } = account;

  const activeDefiPositions = defiPositions.filter(isActiveDefi);
  const totalDefiDeposits = activeDefiPositions.reduce((sum, p) => sum + (p.depositUsd ?? 0), 0);

  const perpExposure = openPerpExposure ?? 0;
  const eventExposure = eventExposureUsd ?? 0;
  const spot = Math.max(accountValue - (perpExposure + totalDefiDeposits + eventExposure), 0);

  return {
    spot,
    perps: perpExposure,
    events: eventExposure,
    defi: totalDefiDeposits,
    total: accountValue,
  };
}

/**
 * Compute basic concentration metrics (top asset percentage)
 */
export function computeBasicConcentration(
  account: AccountState,
  strategies: Strategy[],
  defiPositions: DefiPosition[]
): {
  topAssetPercent: number;
  topAssetName: string;
} {
  const exposureByAsset = computeExposureByAsset(account, strategies, defiPositions);
  
  if (exposureByAsset.length === 0) {
    return { topAssetPercent: 0, topAssetName: 'N/A' };
  }

  const topAsset = exposureByAsset.reduce((max, item) => 
    item.percentage > max.percentage ? item : max
  );

  return {
    topAssetPercent: topAsset.percentage,
    topAssetName: topAsset.asset,
  };
}

/**
 * Simple drawdown estimate based on risk percentages
 * This is a heuristic - real drawdown would require historical price data
 */
export function computeSimpleDrawdownEstimate(strategies: Strategy[]): {
  estimatedMaxDrawdown: number;
  avgRiskPerPosition: number;
} {
  const openStrategies = strategies.filter(s => 
    (s.status === 'executed' || s.status === 'executing') && !s.isClosed
  );

  if (openStrategies.length === 0) {
    return { estimatedMaxDrawdown: 0, avgRiskPerPosition: 0 };
  }

  const totalRisk = openStrategies.reduce((sum, s) => sum + (s.riskPercent || 0), 0);
  const avgRiskPerPosition = totalRisk / openStrategies.length;

  // Heuristic: assume worst case is all positions hit stop loss simultaneously
  // This is conservative - real drawdown would be lower due to diversification
  const estimatedMaxDrawdown = Math.min(totalRisk, 100);

  return {
    estimatedMaxDrawdown,
    avgRiskPerPosition,
  };
}

/**
 * Get normalized list of open positions
 */
export function computeOpenPositionsList(
  strategies: Strategy[],
  defiPositions: DefiPosition[]
): OpenPosition[] {
  const openPerps = strategies.filter(isOpenPerp);
  const openEvents = strategies.filter(isOpenEvent);
  const activeDefi = defiPositions.filter(isActiveDefi);

  const result: OpenPosition[] = [];

  openPerps.forEach(s => {
    result.push({
      id: s.id,
      type: 'perp',
      market: s.market,
      side: s.side,
      riskPercent: s.riskPercent,
      notionalUsd: s.notionalUsd,
      pnlPct: s.realizedPnlPct,
    });
  });

  openEvents.forEach(s => {
    result.push({
      id: s.id,
      type: 'event',
      market: s.eventLabel || s.eventKey || s.market,
      // Event side is YES/NO, not Long/Short, so we don't include it in side field
      riskPercent: s.riskPercent,
      stakeUsd: s.stakeUsd,
      pnlPct: s.realizedPnlPct,
    });
  });

  activeDefi.forEach(p => {
    result.push({
      id: p.id,
      type: 'defi',
      market: `${p.protocol} ${p.asset}`,
      depositUsd: p.depositUsd,
      pnlPct: p.apyPct, // Use APY as proxy for return
    });
  });

  return result;
}

/**
 * Compute DeFi aggregates (total deposits, active positions, max protocol exposure)
 */
export function computeDefiAggregates(defiPositions: DefiPosition[]): {
  totalDeposits: number;
  activeCount: number;
  maxProtocolExposure: number;
} {
  const activeDefiPositions = defiPositions.filter(isActiveDefi);
  const totalDeposits = activeDefiPositions.reduce((sum, p) => sum + p.depositUsd, 0);
  const maxProtocolExposure = activeDefiPositions.length > 0
    ? Math.max(...activeDefiPositions.map(p => p.depositUsd))
    : 0;

  return {
    totalDeposits,
    activeCount: activeDefiPositions.length,
    maxProtocolExposure,
  };
}

/**
 * Compute event market aggregates (total stake, position count, concentration)
 */
export function computeEventAggregates(
  strategies: Strategy[],
  account: AccountState
): {
  totalStake: number;
  positionCount: number;
  largestStake: number;
  concentrationPercent: number;
} {
  const openEventStrategies = strategies.filter(s => 
    s.instrumentType === 'event' && 
    (s.status === 'executed' || s.status === 'executing') && 
    !s.isClosed
  );

  const totalStake = openEventStrategies.reduce((sum, s) => sum + (s.stakeUsd || 0), 0);
  const positionCount = openEventStrategies.length;
  const largestStake = openEventStrategies.length > 0
    ? Math.max(...openEventStrategies.map(s => s.stakeUsd || 0))
    : 0;
  const concentrationPercent = account.accountValue > 0 && largestStake > 0
    ? (largestStake / account.accountValue) * 100
    : 0;

  return {
    totalStake,
    positionCount,
    largestStake,
    concentrationPercent,
  };
}

/**
 * Compute margin metrics (used, available percentages)
 */
export function computeMarginMetrics(account: AccountState): {
  marginUsed: number;
  availableMargin: number;
} {
  const marginUsed = account.accountValue > 0
    ? Math.round((account.openPerpExposure / account.accountValue) * 100)
    : 0;
  const availableMargin = 100 - marginUsed;

  return {
    marginUsed,
    availableMargin,
  };
}

