/**
 * Centralized State Management
 * Helper functions for resetting and building portfolio snapshots
 */

import * as perpsSim from '../plugins/perps-sim';
import * as defiSim from '../plugins/defi-sim';
import * as eventSim from '../plugins/event-sim';
import { BlossomPortfolioSnapshot } from '../types/blossom';

/**
 * Reset all simulation states to initial
 */
export function resetAllSims(): void {
  perpsSim.resetPerpsAccount();
  defiSim.resetDefiState();
  eventSim.resetEventState();
}

/**
 * Build a fresh portfolio snapshot from all sims
 */
export function getPortfolioSnapshot(): BlossomPortfolioSnapshot {
  const perpsSnapshot = perpsSim.getPerpsSnapshot();
  const defiSnapshot = defiSim.getDefiSnapshot();
  const eventSnapshot = eventSim.getEventSnapshot();
  const eventExposureUsd = eventSim.getEventExposureUsd();

  // Calculate open perp exposure
  const openPerpExposureUsd = perpsSnapshot.positions
    .filter(p => !p.isClosed)
    .reduce((sum, p) => sum + p.sizeUsd, 0);

  // Build strategies array (combine all position types)
  const strategies = [
    ...perpsSnapshot.positions.map(p => ({
      type: 'perp' as const,
      status: p.isClosed ? 'closed' : 'executed',
      ...p,
    })),
    ...defiSnapshot.positions.map(p => ({
      type: 'defi' as const,
      status: p.isClosed ? 'closed' : 'active',
      ...p,
    })),
    ...eventSnapshot.positions.map(p => ({
      type: 'event' as const,
      status: p.isClosed ? 'closed' : 'executed',
      ...p,
    })),
  ];

  return {
    accountValueUsd: perpsSnapshot.accountValueUsd,
    balances: perpsSnapshot.balances,
    openPerpExposureUsd,
    eventExposureUsd,
    defiPositions: defiSnapshot.positions.map(p => ({
      id: p.id,
      protocol: p.protocol,
      asset: p.asset,
      depositUsd: p.depositUsd,
      apr: p.apr,
      openedAt: p.openedAt,
      isClosed: p.isClosed,
    })),
    strategies,
  };
}

