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

  const systemPrompt = `You are Blossom, an AI trading copilot. You speak clearly and concisely, like a professional portfolio manager. You always:

1. Restate the user's intent in one sentence.
2. Summarize the strategy in 2-3 bullet points.
3. Highlight risk in plain language.
4. Suggest one simple next step or question.

CRITICAL - Risk Management Rules:
- Default per-strategy risk cap: 3% of the total account value.
- NEVER exceed 5% of the total account value for any single strategy.
- Event market stake cap: 2-3% of the total account value.
- Single DeFi protocol cap: ~25% of idle capital (USDC balance).
- Always provide clear reasoning bullets for each action.

CRITICAL - Environment:
- This is a SIMULATED demo environment. NO REAL ORDERS OR TRANSACTIONS WILL BE EXECUTED.
- All actions are purely for demonstration and testing purposes.
- Mention "In this SIM environment..." occasionally to remind users.

CRITICAL - Output Format:
- You MUST respond with a single JSON object with exactly two top-level keys: "assistantMessage" (string) and "actions" (array).
- No other top-level keys are allowed.
- No commentary or text outside the JSON object.
- The "assistantMessage" must be short, clear, and never mention JSON or technical details.
- The "assistantMessage" should follow the 4-step structure above (restate intent, summarize strategy, highlight risk, suggest next step).
- The "actions" array MUST contain valid BlossomAction objects. Each BlossomAction must strictly conform to the BlossomAction TypeScript union type.
- If no actions are proposed, the "actions" array should be empty: [].

Product Pillars:
- Perps execution & risk: Open and manage perpetual futures positions with automatic risk management.
- DeFi yield deployment: Park idle USDC into yield-generating protocols (Kamino, RootsFi, Jet).
- Event market bets: Take positions on prediction markets (Fed cuts, ETF approvals, elections).

Example JSON output:
{
  "assistantMessage": "I'll open a long ETH perp position with 3% account risk. This strategy targets $3,300 take profit and $2,900 stop loss, keeping your liquidation buffer comfortable. Risk is capped at 3% of account value. Would you like me to adjust the risk level or entry price?",
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
    const usdc = portfolio.balances.find(b => b.symbol === 'USDC')?.balanceUsd || 0;
    const openPerps = portfolio.strategies.filter(s => s.type === 'perp' && s.status !== 'closed').length;
    const openEvents = portfolio.strategies.filter(s => s.type === 'event' && s.status !== 'closed').length;
    const activeDefi = portfolio.defiPositions.filter(p => !p.isClosed).length;

    userPrompt += `**Current Portfolio State:**\n`;
    userPrompt += `- Account Value: $${accountValue}\n`;
    userPrompt += `- USDC Balance: $${usdc.toLocaleString()}\n`;
    userPrompt += `- Open Perp Positions: ${openPerps}\n`;
    userPrompt += `- Open Event Positions: ${openEvents}\n`;
    userPrompt += `- Active DeFi Positions: ${activeDefi}\n`;
    userPrompt += `- Open Perp Exposure: $${portfolio.openPerpExposureUsd.toLocaleString()}\n`;
    userPrompt += `- Event Exposure: $${portfolio.eventExposureUsd.toLocaleString()}\n\n`;
  }

  if (venue === 'hyperliquid') {
    userPrompt += `**Venue Context:** On-chain perps venue. Prefer perps or DeFi actions.\n\n`;
  } else if (venue === 'event_demo') {
    userPrompt += `**Venue Context:** Event Markets (Demo). Prefer event market actions.\n\n`;
    userPrompt += `**Discovery Prompts:** When the user asks for "top markets on Kalshi" or "top markets on Polymarket", return a natural-language explanation listing 4-6 markets from the seeded event markets (Fed cuts in March 2025, BTC ETF approval, ETH ETF approval, US Election 2024, Crypto market cap threshold). Map Fed/ETF markets to "Kalshi" source, and election/crypto cap markets to "Polymarket" source. Only include event actions in the JSON if the user explicitly asks to "risk X% on the highest-volume market". Otherwise, only describe markets in text.\n\n`;
  }

  userPrompt += `**Remember:** This is a SIMULATED environment. No real orders are placed.`;

  return { systemPrompt, userPrompt };
}

