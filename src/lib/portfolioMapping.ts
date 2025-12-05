/**
 * Portfolio Mapping Helper
 * Maps backend BlossomPortfolioSnapshot to frontend state
 */

import { AccountState, Strategy, StrategyStatus, DefiPosition } from '../context/BlossomContext';
import { BlossomPortfolioSnapshot } from './blossomApi';

export function mapBackendPortfolioToFrontendState(
  snapshot: BlossomPortfolioSnapshot
): {
  account: AccountState;
  strategies: Strategy[];
  defiPositions: DefiPosition[];
} {
  // Map balances
  const balances = snapshot.balances.map(b => ({
    symbol: b.symbol,
    balanceUsd: b.balanceUsd,
  }));

  // Calculate account value
  const accountValue = snapshot.accountValueUsd;

  // Map strategies from backend
  const strategies: Strategy[] = snapshot.strategies.map((s: any) => {
    const baseStrategy: Strategy = {
      id: s.id,
      createdAt: s.createdAt || new Date().toISOString(),
      side: s.side === 'long' ? 'Long' : 'Short',
      market: s.market || s.eventKey || 'UNKNOWN',
      riskPercent: s.riskPct || 0,
      entry: s.entryPrice || s.entry || s.stakeUsd || 0,
      takeProfit: s.takeProfit || s.maxPayoutUsd || 0,
      stopLoss: s.stopLoss || s.maxLossUsd || 0,
      status: mapBackendStatusToFrontend(s.status),
      sourceText: s.sourceText || `Backend strategy ${s.id}`,
      isClosed: s.isClosed || s.status === 'closed',
      notionalUsd: s.sizeUsd || s.stakeUsd,
      closedAt: s.closedAt ? new Date(s.closedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : undefined,
      realizedPnlUsd: s.realizedPnlUsd,
      realizedPnlPct: s.realizedPnlPct,
    };

    // Add event-specific fields
    if (s.type === 'event' || s.eventKey) {
      baseStrategy.instrumentType = 'event';
      baseStrategy.eventKey = s.eventKey;
      baseStrategy.eventLabel = s.label || s.eventKey;
      baseStrategy.stakeUsd = s.stakeUsd;
      baseStrategy.maxPayoutUsd = s.maxPayoutUsd;
      baseStrategy.maxLossUsd = s.maxLossUsd;
      baseStrategy.eventSide = s.side === 'YES' ? 'YES' : 'NO';
      baseStrategy.eventOutcome = s.outcome || 'pending';
    } else if (s.type === 'perp' || !s.type) {
      baseStrategy.instrumentType = 'perp';
    }

    return baseStrategy;
  });

  // Map DeFi positions
  const defiPositions: DefiPosition[] = snapshot.defiPositions.map((p: any) => ({
    id: p.id,
    command: `Deposit ${p.asset} into ${p.protocol}`,
    protocol: p.protocol,
    asset: p.asset,
    depositUsd: p.depositUsd,
    apyPct: p.apr,
    status: p.isClosed ? 'proposed' : 'active',
    createdAt: p.openedAt ? new Date(p.openedAt).toISOString() : new Date().toISOString(),
  }));

  // Build account state
  const account: AccountState = {
    accountValue,
    openPerpExposure: snapshot.openPerpExposureUsd || 0,
    eventExposureUsd: snapshot.eventExposureUsd || 0,
    totalPnlPct: 0, // Backend doesn't track this, will be computed if needed
    simulatedPnlPct30d: 0, // Backend doesn't track this
    balances,
  };

  return {
    account,
    strategies,
    defiPositions,
  };
}

function mapBackendStatusToFrontend(status: string): StrategyStatus {
  switch (status) {
    case 'draft':
      return 'draft';
    case 'queued':
      return 'queued';
    case 'executing':
      return 'executing';
    case 'executed':
      return 'executed';
    case 'closed':
      return 'closed';
    default:
      return 'executed'; // Default to executed for unknown statuses
  }
}

