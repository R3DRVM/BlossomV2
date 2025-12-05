/**
 * Parse model output into BlossomAction[]
 * This is a post-processing layer that extracts structured actions from natural language
 */

import { BlossomAction } from '../types/blossom';

/**
 * Parse model response into BlossomAction[]
 * For MVP, we'll use a simple pattern-based parser
 * In production, this would use structured output from the LLM
 */
export function parseActionsFromResponse(
  response: string,
  context?: { venue?: 'hyperliquid' | 'event_demo' }
): BlossomAction[] {
  const actions: BlossomAction[] = [];
  const lower = response.toLowerCase();

  // Simple keyword-based parsing for MVP
  // In production, use structured output or JSON mode from LLM

  // Perp detection
  if (context?.venue === 'hyperliquid' || !context?.venue) {
    const perpMatch = response.match(/perp|perpetual|long|short|eth|btc|sol/i);
    if (perpMatch) {
      // Extract perp action details
      const side = lower.includes('short') ? 'short' : 'long';
      const marketMatch = response.match(/(ETH|BTC|SOL|BNB|AVAX)-PERP/i);
      const market = marketMatch ? marketMatch[1] + '-PERP' : 'ETH-PERP';
      
      const riskMatch = response.match(/(\d+(?:\.\d+)?)\s*%/);
      const riskPct = riskMatch ? parseFloat(riskMatch[1]) : 3;

      actions.push({
        type: 'perp',
        action: 'open',
        market,
        side,
        riskPct,
        reasoning: ['Market analysis suggests this position', 'Risk is within acceptable limits'],
      });
    }
  }

  // DeFi detection
  if (lower.includes('yield') || lower.includes('deposit') || lower.includes('kamino') || lower.includes('rootsfi') || lower.includes('jet')) {
    const protocolMatch = lower.includes('kamino') ? 'Kamino' : lower.includes('jet') ? 'Jet' : 'RootsFi';
    const amountMatch = response.match(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)/);
    const amountUsd = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 1000;

    actions.push({
      type: 'defi',
      action: 'deposit',
      protocol: protocolMatch,
      asset: 'USDC',
      amountUsd,
      apr: protocolMatch === 'Kamino' ? 8.5 : protocolMatch === 'Jet' ? 7.2 : 6.4,
      reasoning: ['Idle capital optimization', 'Conservative yield strategy'],
    });
  }

  // Event detection
  if (context?.venue === 'event_demo' || lower.includes('bet') || lower.includes('event') || lower.includes('fed') || lower.includes('etf')) {
    let eventKey = 'GENERIC_EVENT_DEMO';
    let label = 'Generic Event';
    
    if (lower.includes('fed') || lower.includes('rate cut')) {
      eventKey = 'FED_CUTS_MAR_2025';
      label = 'Fed cuts in March 2025';
    } else if (lower.includes('etf')) {
      eventKey = 'BTC_ETF_APPROVAL_2025';
      label = 'BTC ETF Approval 2025';
    }

    const side: 'YES' | 'NO' = lower.includes('yes') || lower.includes('long') ? 'YES' : 'NO';
    const stakeMatch = response.match(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)/);
    const stakeUsd = stakeMatch ? parseFloat(stakeMatch[1].replace(/,/g, '')) : 200;
    const riskMatch = response.match(/(\d+(?:\.\d+)?)\s*%/);
    const riskPct = riskMatch ? parseFloat(riskMatch[1]) : 2;

    actions.push({
      type: 'event',
      action: 'open',
      eventKey,
      label,
      side,
      stakeUsd,
      maxPayoutUsd: stakeUsd * 1.7,
      maxLossUsd: stakeUsd,
      reasoning: ['Event market opportunity identified', `Risk capped at ${riskPct}% of account`],
    });
  }

  return actions;
}

