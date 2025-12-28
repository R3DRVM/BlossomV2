/**
 * Collapsed card preview helpers - extract key fields for preview display
 * Used to avoid "-" placeholders in collapsed cards
 */

import { Strategy } from '../context/BlossomContext';
import { DefiPosition } from '../context/BlossomContext';
import { formatLeverage, formatMarginNotional, formatUsdOrDash } from './formatPlanCard';

export interface CollapsedPreviewFields {
  // Row 1 fields
  primaryLabel: string; // e.g., "Long BTC" or "YES Fed cuts" or "Aave"
  primaryValue: string; // e.g., "$20,000" or "$500" or "$1,000"
  secondaryValue?: string; // e.g., "10× • 3%" or "3%" or "8.5%"
  
  // Row 2 fields (routing/execution)
  routingLabel: string; // e.g., "Hyperliquid • Arbitrum" or "Polymarket • Polygon" or "Bridge → Swap → Deposit"
  routingValue?: string; // Optional right-side value like slippage or max payout
}

/**
 * Get collapsed preview fields for a perp strategy
 */
export function getPerpCollapsedPreview(strategy: Strategy, parsedStrategy?: any, accountTotalUsd?: number): CollapsedPreviewFields {
  const side = strategy.side || 'Long';
  const market = strategy.market || 'BTC-PERP';
  const leverage = formatLeverage(strategy.leverage);
  const riskPct = strategy.riskPercent || 0;
  
  // Derive meaningful notional/margin for drafts: prefer in order:
  // 1. marginUsd (explicit)
  // 2. notionalUsd (explicit)
  // 3. riskUsd (riskPercent * accountTotalUsd)
  // 4. computed notional (marginUsd * leverage)
  let notional = strategy.notionalUsd || 0;
  let margin = strategy.marginUsd || 0;
  
  if (notional <= 0 && margin <= 0) {
    // Derive from risk percent if available
    const accountValue = accountTotalUsd || 10000; // Fallback for demo
    if (riskPct > 0) {
      const riskUsd = (riskPct / 100) * accountValue;
      margin = riskUsd;
      notional = margin * (strategy.leverage || 1);
    } else {
      // Last resort: use default 3% risk
      const defaultRiskUsd = 0.03 * accountValue;
      margin = defaultRiskUsd;
      notional = margin * (strategy.leverage || 1);
    }
  } else if (notional <= 0 && margin > 0) {
    // Compute notional from margin
    notional = margin * (strategy.leverage || 1);
  } else if (notional > 0 && margin <= 0) {
    // Derive margin from notional
    margin = notional / (strategy.leverage || 1);
  }
  
  // Format notional for display (always show a value, never "—")
  const notionalDisplay = formatMarginNotional(notional);
  
  // Entry preview (if available from parsed strategy)
  const entryPreview = parsedStrategy?.entryPrice ? `Entry: ${formatUsdOrDash(parsedStrategy.entryPrice)}` : undefined;
  
  return {
    primaryLabel: `${side} ${market}`,
    primaryValue: notionalDisplay,
    secondaryValue: `${leverage} • ${riskPct.toFixed(1)}%`,
    routingLabel: 'Auto-selected venue', // Will be overridden by actual route display
    routingValue: entryPreview,
  };
}

/**
 * Get collapsed preview fields for an event strategy
 */
export function getEventCollapsedPreview(strategy: Strategy, parsedStrategy?: any, accountTotalUsd?: number): CollapsedPreviewFields {
  const side = strategy.eventSide || (strategy.side === 'Long' ? 'YES' : 'NO');
  const eventLabel = strategy.eventLabel || strategy.eventKey || strategy.market || 'Event';
  const riskPct = strategy.riskPercent || 0;
  
  // Derive meaningful stake for drafts: prefer in order:
  // 1. stakeUsd (explicit)
  // 2. parsedStrategy.entryPrice (from parser)
  // 3. riskPercent * accountTotalUsd
  // 4. default 3% risk
  let stakeUsd = strategy.stakeUsd ?? parsedStrategy?.entryPrice ?? 0;
  
  if (stakeUsd <= 0) {
    const accountValue = accountTotalUsd || 10000; // Fallback for demo
    if (riskPct > 0) {
      stakeUsd = (riskPct / 100) * accountValue;
    } else {
      // Default 3% risk
      stakeUsd = 0.03 * accountValue;
    }
  }
  
  // Derive max payout (typically 1.7x for demo, or from strategy)
  let maxPayoutUsd = strategy.maxPayoutUsd ?? parsedStrategy?.takeProfit ?? 0;
  if (maxPayoutUsd <= 0 && stakeUsd > 0) {
    // Default 1.7x payout for demo
    maxPayoutUsd = stakeUsd * 1.7;
  }
  
  const stake = formatUsdOrDash(stakeUsd);
  const maxPayout = formatUsdOrDash(maxPayoutUsd);
  
  return {
    primaryLabel: `${side} ${eventLabel}`,
    primaryValue: stake,
    secondaryValue: `${riskPct.toFixed(1)}%`,
    routingLabel: 'Prediction Markets',
    routingValue: `Max payout: ${maxPayout}`,
  };
}

/**
 * Get collapsed preview fields for a DeFi position
 */
export function getDefiCollapsedPreview(defiPosition: DefiPosition, accountTotalUsd?: number): CollapsedPreviewFields {
  const protocol = defiPosition.protocol || 'Protocol';
  
  // Derive meaningful deposit for drafts: prefer in order:
  // 1. depositUsd (explicit)
  // 2. Parse from command if available (e.g., "10%" or "$500")
  // 3. Default: 50% of idle USDC or 20% of account (whichever is smaller)
  let depositUsd = defiPosition.depositUsd || 0;
  
  if (depositUsd <= 0) {
    const accountValue = accountTotalUsd || 10000; // Fallback for demo
    // Default: 20% of account, capped at reasonable demo amount
    depositUsd = Math.min(accountValue * 0.2, 2000);
  }
  
  const deposit = formatUsdOrDash(depositUsd);
  const apy = `${(defiPosition.apyPct || 0).toFixed(1)}%`;
  
  return {
    primaryLabel: protocol,
    primaryValue: deposit,
    secondaryValue: apy,
    routingLabel: 'Bridge → Swap → Deposit',
    routingValue: undefined,
  };
}

/**
 * Get preview fields for any strategy/position type
 */
export function getCollapsedPreviewFields(
  strategy?: Strategy | null,
  defiPosition?: DefiPosition | null,
  parsedStrategy?: any,
  accountTotalUsd?: number
): CollapsedPreviewFields | null {
  if (defiPosition) {
    return getDefiCollapsedPreview(defiPosition, accountTotalUsd);
  }
  
  if (strategy) {
    if (strategy.instrumentType === 'event') {
      return getEventCollapsedPreview(strategy, parsedStrategy, accountTotalUsd);
    } else {
      return getPerpCollapsedPreview(strategy, parsedStrategy, accountTotalUsd);
    }
  }
  
  return null;
}

