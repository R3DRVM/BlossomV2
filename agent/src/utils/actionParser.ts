/**
 * Action Parser and Validator
 * Parses and validates BlossomAction[] from LLM JSON output
 */

import { BlossomAction, BlossomPortfolioSnapshot } from '../types/blossom';
import { blossomCharacter } from '../characters/blossom';

/**
 * Validate and sanitize actions from LLM output
 */
export function validateActions(raw: any): BlossomAction[] {
  if (!Array.isArray(raw)) {
    console.warn('Actions is not an array:', typeof raw);
    return [];
  }

  const validActions: BlossomAction[] = [];

  for (const item of raw) {
    try {
      if (!item || typeof item !== 'object') {
        console.warn('Invalid action item (not an object):', item);
        continue;
      }

      if (item.type === 'perp' && item.action === 'open') {
        // Validate perp action
        if (
          typeof item.market === 'string' &&
          (item.side === 'long' || item.side === 'short') &&
          typeof item.riskPct === 'number' &&
          item.riskPct > 0 &&
          item.riskPct <= 5 && // Enforce 5% max
          Array.isArray(item.reasoning)
        ) {
          validActions.push({
            type: 'perp',
            action: 'open',
            market: item.market,
            side: item.side,
            riskPct: Math.min(item.riskPct, 5), // Cap at 5%
            entry: typeof item.entry === 'number' ? item.entry : undefined,
            takeProfit: typeof item.takeProfit === 'number' ? item.takeProfit : undefined,
            stopLoss: typeof item.stopLoss === 'number' ? item.stopLoss : undefined,
            reasoning: item.reasoning.filter((r: any) => typeof r === 'string'),
          });
        } else {
          console.warn('Invalid perp action:', item);
        }
      } else if (item.type === 'defi' && item.action === 'deposit') {
        // Validate defi action
        if (
          typeof item.protocol === 'string' &&
          typeof item.asset === 'string' &&
          typeof item.amountUsd === 'number' &&
          item.amountUsd > 0 &&
          typeof item.apr === 'number' &&
          Array.isArray(item.reasoning)
        ) {
          validActions.push({
            type: 'defi',
            action: 'deposit',
            protocol: item.protocol,
            asset: item.asset,
            amountUsd: item.amountUsd,
            apr: item.apr,
            reasoning: item.reasoning.filter((r: any) => typeof r === 'string'),
          });
        } else {
          console.warn('Invalid defi action:', item);
        }
      } else if (item.type === 'event' && item.action === 'open') {
        // Validate event action
        if (
          typeof item.eventKey === 'string' &&
          typeof item.label === 'string' &&
          (item.side === 'YES' || item.side === 'NO') &&
          typeof item.stakeUsd === 'number' &&
          item.stakeUsd > 0 &&
          typeof item.maxPayoutUsd === 'number' &&
          typeof item.maxLossUsd === 'number' &&
          Array.isArray(item.reasoning)
        ) {
          validActions.push({
            type: 'event',
            action: 'open',
            eventKey: item.eventKey,
            label: item.label,
            side: item.side,
            stakeUsd: item.stakeUsd,
            maxPayoutUsd: item.maxPayoutUsd,
            maxLossUsd: item.maxLossUsd,
            reasoning: item.reasoning.filter((r: any) => typeof r === 'string'),
          });
        } else {
          console.warn('Invalid event action:', item);
        }
      } else {
        console.warn('Unknown action type or action:', item);
      }
    } catch (error: any) {
      console.warn('Error validating action:', error.message, item);
    }
  }

  return validActions;
}

/**
 * Build prompts for Blossom LLM
 */
export function buildBlossomPrompts(args: {
  userMessage: string;
  portfolio: BlossomPortfolioSnapshot | null;
  venue: 'hyperliquid' | 'event_demo';
}): { systemPrompt: string; userPrompt: string } {
  const { userMessage, portfolio, venue } = args;

  const systemPrompt = `${blossomCharacter.system}

**CRITICAL OUTPUT FORMAT:**
You MUST respond with a single JSON object with exactly these two keys:
1. "assistantMessage" (string): A natural language explanation of what you're doing
2. "actions" (array): An array of BlossomAction objects (can be empty if no action is needed)

The JSON must be valid and parseable. No commentary outside the JSON object.

**Action Rules:**
- For perps: riskPct must be between 0.1 and 5.0 (default 3.0)
- For events: stakeUsd should be 2-3% of account value
- For DeFi: amountUsd should not exceed 25% of idle REDACTED
- Each action must include a "reasoning" array with 2-4 explanation bullets

**Example valid JSON response:**
{
  "assistantMessage": "I'll open a long ETH position with 3% risk...",
  "actions": [
    {
      "type": "perp",
      "action": "open",
      "market": "ETH-PERP",
      "side": "long",
      "riskPct": 3.0,
      "entry": 3500,
      "takeProfit": 3640,
      "stopLoss": 3395,
      "reasoning": ["ETH is trending up", "Risk is within 3% cap", "Stop loss protects downside"]
    }
  ]
}`;

  let userPrompt = `**User Request:**\n${userMessage}\n\n`;

  if (portfolio) {
    const accountValue = portfolio.accountValueUsd.toLocaleString();
    const usdc = portfolio.balances.find(b => b.symbol === 'REDACTED')?.balanceUsd || 0;
    const openPerps = portfolio.strategies.filter(s => s.type === 'perp' && s.status !== 'closed').length;
    const openEvents = portfolio.strategies.filter(s => s.type === 'event' && s.status !== 'closed').length;
    const activeDefi = portfolio.defiPositions.filter(p => !p.isClosed).length;

    userPrompt += `**Current Portfolio State:**\n`;
    userPrompt += `- Account Value: $${accountValue}\n`;
    userPrompt += `- REDACTED Balance: $${usdc.toLocaleString()}\n`;
    userPrompt += `- Open Perp Positions: ${openPerps}\n`;
    userPrompt += `- Open Event Positions: ${openEvents}\n`;
    userPrompt += `- Active DeFi Positions: ${activeDefi}\n`;
    userPrompt += `- Open Perp Exposure: $${portfolio.openPerpExposureUsd.toLocaleString()}\n`;
    userPrompt += `- Event Exposure: $${portfolio.eventExposureUsd.toLocaleString()}\n\n`;
  }

  if (venue === 'hyperliquid') {
    userPrompt += `**Venue Context:** Hyperliquid (Perpetuals). Prefer perps or DeFi actions.\n\n`;
  } else if (venue === 'event_demo') {
    userPrompt += `**Venue Context:** Event Markets (Demo). Prefer event market actions.\n\n`;
  }

  userPrompt += `**Remember:** This is a SIMULATED environment. No real orders are placed.`;

  return { systemPrompt, userPrompt };
}

