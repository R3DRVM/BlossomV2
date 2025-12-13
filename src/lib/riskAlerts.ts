import { AccountState, Strategy, DefiPosition } from '../context/BlossomContext';
import { computeBasicConcentration, computeOpenPositionsList } from './portfolioComputed';

export type AlertSeverity = 'low' | 'med' | 'high';

export type AlertActionType = 'focusPosition' | 'prefillChat';

export interface RiskAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  actionType: AlertActionType;
  actionPayload: {
    positionId?: string;
    chatPrompt?: string;
  };
  actionLabel: string;
}

/**
 * Compute risk alerts from current portfolio state
 */
export function computeRiskAlerts(
  account: AccountState,
  strategies: Strategy[],
  defiPositions: DefiPosition[]
): RiskAlert[] {
  const alerts: RiskAlert[] = [];
  const openPositions = computeOpenPositionsList(strategies, defiPositions);
  const concentration = computeBasicConcentration(account, strategies, defiPositions);

  // High concentration alert
  if (concentration.topAssetPercent > 50) {
    alerts.push({
      id: 'alert-concentration',
      severity: 'high',
      title: 'High concentration risk',
      detail: `${concentration.topAssetName} represents ${concentration.topAssetPercent}% of your portfolio`,
      actionType: 'prefillChat',
      actionPayload: {
        chatPrompt: 'Rebalance to reduce concentration',
      },
      actionLabel: 'Rebalance',
    });
  } else if (concentration.topAssetPercent > 35) {
    alerts.push({
      id: 'alert-concentration',
      severity: 'med',
      title: 'Moderate concentration',
      detail: `${concentration.topAssetName} represents ${concentration.topAssetPercent}% of your portfolio`,
      actionType: 'prefillChat',
      actionPayload: {
        chatPrompt: 'Rebalance to reduce concentration',
      },
      actionLabel: 'Rebalance',
    });
  }

  // Too many open positions
  if (openPositions.length > 10) {
    alerts.push({
      id: 'alert-too-many-positions',
      severity: 'high',
      title: 'Too many open positions',
      detail: `You have ${openPositions.length} open positions. Consider consolidating.`,
      actionType: 'prefillChat',
      actionPayload: {
        chatPrompt: 'Close 25% of my open positions',
      },
      actionLabel: 'Reduce positions',
    });
  } else if (openPositions.length > 7) {
    alerts.push({
      id: 'alert-too-many-positions',
      severity: 'med',
      title: 'Many open positions',
      detail: `You have ${openPositions.length} open positions`,
      actionType: 'prefillChat',
      actionPayload: {
        chatPrompt: 'Show me my riskiest positions',
      },
      actionLabel: 'Review',
    });
  }

  // High perp exposure
  const perpExposurePct = account.accountValue > 0
    ? (account.openPerpExposure / account.accountValue) * 100
    : 0;
  if (perpExposurePct > 80) {
    alerts.push({
      id: 'alert-high-perp-exposure',
      severity: 'high',
      title: 'Very high perp exposure',
      detail: `${perpExposurePct.toFixed(1)}% of account in perpetual positions`,
      actionType: 'prefillChat',
      actionPayload: {
        chatPrompt: 'Reduce my perp exposure to 50%',
      },
      actionLabel: 'Reduce exposure',
    });
  } else if (perpExposurePct > 60) {
    alerts.push({
      id: 'alert-high-perp-exposure',
      severity: 'med',
      title: 'High perp exposure',
      detail: `${perpExposurePct.toFixed(1)}% of account in perpetual positions`,
      actionType: 'prefillChat',
      actionPayload: {
        chatPrompt: 'Show me my perp exposure breakdown',
      },
      actionLabel: 'Review',
    });
  }

  // Missing stop loss on perps
  const perpsWithoutSl = strategies.filter(s => 
    s.instrumentType === 'perp' &&
    (s.status === 'executed' || s.status === 'executing') &&
    !s.isClosed &&
    (!s.stopLoss || s.stopLoss <= 0)
  );

  if (perpsWithoutSl.length > 0) {
    const firstPerp = perpsWithoutSl[0];
    alerts.push({
      id: 'alert-missing-stop-loss',
      severity: 'high',
      title: 'Missing stop loss',
      detail: `${perpsWithoutSl.length} perp position${perpsWithoutSl.length > 1 ? 's' : ''} without stop loss`,
      actionType: perpsWithoutSl.length === 1 ? 'focusPosition' : 'prefillChat',
      actionPayload: perpsWithoutSl.length === 1
        ? { positionId: firstPerp.id }
        : { chatPrompt: 'Add stop loss to my positions without one' },
      actionLabel: perpsWithoutSl.length === 1 ? 'View position' : 'Add stop loss',
    });
  }

  // High leverage positions
  const highLeveragePerps = strategies.filter(s =>
    s.instrumentType === 'perp' &&
    (s.status === 'executed' || s.status === 'executing') &&
    !s.isClosed &&
    s.leverage &&
    s.leverage > 10
  );

  if (highLeveragePerps.length > 0) {
    const firstHighLeverage = highLeveragePerps[0];
    alerts.push({
      id: 'alert-high-leverage',
      severity: highLeveragePerps.some(s => (s.leverage || 0) > 15) ? 'high' : 'med',
      title: 'High leverage positions',
      detail: `${highLeveragePerps.length} position${highLeveragePerps.length > 1 ? 's' : ''} with leverage > 10x`,
      actionType: highLeveragePerps.length === 1 ? 'focusPosition' : 'prefillChat',
      actionPayload: highLeveragePerps.length === 1
        ? { positionId: firstHighLeverage.id }
        : { chatPrompt: 'Reduce leverage on my open positions' },
      actionLabel: highLeveragePerps.length === 1 ? 'View position' : 'Reduce leverage',
    });
  }

  return alerts;
}

