/**
 * Action Parser and Validator
 * Parses and validates BlossomAction[] from LLM JSON output
 */

import { BlossomAction, BlossomPortfolioSnapshot } from '../types/blossom';
import { blossomCharacter } from '../characters/blossom';
import { getTopKalshiMarketsByVolume, getTopPolymarketMarketsByVolume, getHighestVolumeMarket, RawPredictionMarket } from '../services/predictionData';

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
            overrideRiskCap: typeof item.overrideRiskCap === 'boolean' ? item.overrideRiskCap : undefined,
            requestedStakeUsd: typeof item.requestedStakeUsd === 'number' ? item.requestedStakeUsd : undefined,
          });
        } else {
          console.warn('Invalid event action:', item);
        }
      } else if (item.type === 'event' && item.action === 'update') {
        // Validate event update action
        if (
          typeof item.positionId === 'string' &&
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
            action: 'update',
            eventKey: item.eventKey,
            label: item.label,
            side: item.side,
            stakeUsd: item.stakeUsd,
            maxPayoutUsd: item.maxPayoutUsd,
            maxLossUsd: item.maxLossUsd,
            reasoning: item.reasoning.filter((r: any) => typeof r === 'string'),
            positionId: item.positionId,
            overrideRiskCap: typeof item.overrideRiskCap === 'boolean' ? item.overrideRiskCap : false,
            requestedStakeUsd: typeof item.requestedStakeUsd === 'number' ? item.requestedStakeUsd : undefined,
          });
        } else {
          console.warn('Invalid event update action:', item);
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
export async function buildBlossomPrompts(args: {
  userMessage: string;
  portfolio: BlossomPortfolioSnapshot | null;
  venue: 'hyperliquid' | 'event_demo';
}): Promise<{ systemPrompt: string; userPrompt: string; isPredictionMarketQuery: boolean }> {
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

CRITICAL - Prediction Market Queries:
- When the user asks about "Kalshi", "Polymarket", "prediction markets", "top markets", "trending markets", or "highest volume market", you MUST focus ONLY on prediction markets.
- Do NOT suggest perps, DeFi, or other trading strategies when answering prediction market questions.
- Do NOT say "I can help with perps trading strategies..." when asked about prediction markets.
- If prediction market data is provided in the user prompt (either live or fallback), you MUST:
  * Reference the specific markets by their exact names
  * Provide a numbered list (1, 2, 3, etc.) with market names, YES probabilities, and volumes
  * NOT mention perps, futures, liquidation, stop losses, or any perp-specific terms
- For discovery queries (listing markets), provide ONLY the numbered list in your assistantMessage. Do NOT include actions in JSON.
- For execution queries (risking on a market), include an event action in the JSON with the exact market details provided.

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

  // Calculate isPredictionMarketQuery flag early (for stub mode short-circuit)
  // More robust detection: if venue is event_demo and message mentions prediction markets, Kalshi, or Polymarket
  let isPredictionMarketQuery = false;
  if (venue === 'event_demo') {
    const lowerMessage = userMessage.toLowerCase();
    const hasKalshi = lowerMessage.includes('kalshi');
    const hasPolymarket = lowerMessage.includes('polymarket');
    const hasPredictionMarket = lowerMessage.includes('prediction market') || lowerMessage.includes('prediction markets');
    const hasTop = lowerMessage.includes('top');
    const hasTrending = lowerMessage.includes('trending');
    const hasHighestVolume = lowerMessage.includes('highest') && (lowerMessage.includes('volume') || lowerMessage.includes('vol'));
    const hasRightNow = lowerMessage.includes('right now');
    const hasRisk = lowerMessage.includes('risk') && (lowerMessage.includes('%') || lowerMessage.match(/\d+%/));
    
    // More permissive: if it mentions Kalshi/Polymarket + any of: top, trending, prediction market, right now, highest volume
    const isAskingTopKalshi = hasKalshi && (hasTop || hasPredictionMarket || hasRightNow || hasTrending);
    const isAskingTopPolymarket = hasPolymarket && (hasTop || hasPredictionMarket || hasRightNow || hasTrending);
    const isAskingHighestVolume = hasHighestVolume && (hasKalshi || hasPolymarket || hasPredictionMarket);
    // Risk sizing on prediction markets (e.g. "Risk 2% on highest-volume prediction market")
    const isRiskingOnPredictionMarket = hasRisk && (hasHighestVolume || hasPredictionMarket || hasKalshi || hasPolymarket);
    
    // Also match if just mentions Kalshi/Polymarket with "top" or "trending" (even without "prediction market")
    const isAskingAboutKalshi = hasKalshi && (hasTop || hasTrending || hasRightNow);
    const isAskingAboutPolymarket = hasPolymarket && (hasTop || hasTrending || hasRightNow);
    
    isPredictionMarketQuery = isAskingTopKalshi || isAskingTopPolymarket || isAskingHighestVolume || 
      (hasKalshi && hasPredictionMarket) || (hasPolymarket && hasPredictionMarket) ||
      isAskingAboutKalshi || isAskingAboutPolymarket || isRiskingOnPredictionMarket;
    
    // Log detection for debugging
    console.log('[prediction-detection]', {
      venue,
      lowerMessage: lowerMessage.substring(0, 100),
      hasKalshi,
      hasPolymarket,
      hasPredictionMarket,
      hasTop,
      hasTrending,
      hasHighestVolume,
      hasRightNow,
      isAskingTopKalshi,
      isAskingTopPolymarket,
      isAskingHighestVolume,
      isAskingAboutKalshi,
      isAskingAboutPolymarket,
      isPredictionMarketQuery
    });
  }

  if (venue === 'hyperliquid') {
    userPrompt += `**Venue Context:** On-chain perps venue. Prefer perps or DeFi actions.\n\n`;
  } else if (venue === 'event_demo') {
    userPrompt += `**Venue Context:** Event Markets (Demo). Prefer event market actions.\n\n`;
    
    // Reuse detection variables (already calculated above)
    const lowerMessage = userMessage.toLowerCase();
    const hasKalshi = lowerMessage.includes('kalshi');
    const hasPolymarket = lowerMessage.includes('polymarket');
    const hasPredictionMarket = lowerMessage.includes('prediction market') || lowerMessage.includes('prediction markets');
    const hasTop = lowerMessage.includes('top') || lowerMessage.includes('trending');
    const hasHighestVolume = lowerMessage.includes('highest') && (lowerMessage.includes('volume') || lowerMessage.includes('vol'));
    
    const isAskingTopKalshi = hasKalshi && (hasTop || hasPredictionMarket || lowerMessage.includes('right now'));
    const isAskingTopPolymarket = hasPolymarket && (hasTop || hasPredictionMarket || lowerMessage.includes('right now'));
    const isAskingHighestVolume = hasHighestVolume && (hasKalshi || hasPolymarket || hasPredictionMarket);
    
    console.log('[prediction] Detection:', { 
      lowerMessage: lowerMessage.substring(0, 150),
      hasKalshi,
      hasPolymarket,
      hasPredictionMarket,
      hasTop,
      isAskingTopKalshi, 
      isAskingTopPolymarket, 
      isAskingHighestVolume,
      isPredictionMarketQuery,
      venue 
    });
    
    // Fetch live market data if relevant
    let kalshiMarkets: RawPredictionMarket[] = [];
    let polymarketMarkets: RawPredictionMarket[] = [];
    let highestVolumeMarket: RawPredictionMarket | null = null;
    
    try {
      if (isAskingTopKalshi || isAskingHighestVolume || (isPredictionMarketQuery && hasKalshi)) {
        console.log('[prediction] Fetching Kalshi markets for prompt');
        kalshiMarkets = await getTopKalshiMarketsByVolume(5);
        console.log(`[prediction] Fetched ${kalshiMarkets.length} Kalshi markets:`, kalshiMarkets.map(m => m.title).join(', '));
      }
      if (isAskingTopPolymarket || isAskingHighestVolume || (isPredictionMarketQuery && hasPolymarket)) {
        console.log('[prediction] Fetching Polymarket markets for prompt');
        polymarketMarkets = await getTopPolymarketMarketsByVolume(5);
        console.log(`[prediction] Fetched ${polymarketMarkets.length} Polymarket markets:`, polymarketMarkets.map(m => m.title).join(', '));
      }
      if (isAskingHighestVolume) {
        console.log('[prediction] Fetching highest volume market');
        highestVolumeMarket = await getHighestVolumeMarket();
        console.log(`[prediction] Highest volume market:`, highestVolumeMarket ? highestVolumeMarket.title : 'none');
      }
    } catch (error: any) {
      console.warn('[prediction] Failed to fetch market data for prompt:', error.message);
      // Continue with empty arrays - will use fallback behavior
    }
    
    // Build market context for LLM - always include if this is a prediction market query
    // Always trigger for prediction market queries, even if data arrays are empty (will use fallback)
    if (isPredictionMarketQuery) {
      // Always include market data section, even if arrays are empty (will show fallback)
      userPrompt += `**PREDICTION MARKET DATA:**\n\n`;
      
      if (kalshiMarkets.length > 0) {
        userPrompt += `**Top Kalshi Markets (by volume):**\n`;
        kalshiMarkets.forEach((market, idx) => {
          const prob = Math.round(market.yesPrice * 100);
          const volume = market.volume24hUsd ? `$${(market.volume24hUsd / 1000).toFixed(0)}k` : 'N/A';
          userPrompt += `${idx + 1}. "${market.title}" - ${prob}% YES probability, ${volume} 24h volume\n`;
        });
        userPrompt += `\n`;
      } else if (isAskingTopKalshi || (isPredictionMarketQuery && hasKalshi)) {
        // Fallback static data for Kalshi
        userPrompt += `**Top Kalshi Markets (by volume):**\n`;
        userPrompt += `1. "Fed cuts in March 2025" - 62% YES probability, $125k 24h volume\n`;
        userPrompt += `2. "BTC ETF approved by Dec 31" - 68% YES probability, $280k 24h volume\n`;
        userPrompt += `3. "ETH ETF approved by June 2025" - 58% YES probability, $95k 24h volume\n\n`;
      }
      
      if (polymarketMarkets.length > 0) {
        userPrompt += `**Top Polymarket Markets (by volume):**\n`;
        polymarketMarkets.forEach((market, idx) => {
          const prob = Math.round(market.yesPrice * 100);
          const volume = market.volume24hUsd ? `$${(market.volume24hUsd / 1000).toFixed(0)}k` : 'N/A';
          userPrompt += `${idx + 1}. "${market.title}" - ${prob}% YES probability, ${volume} 24h volume\n`;
        });
        userPrompt += `\n`;
      } else if (isAskingTopPolymarket || (isPredictionMarketQuery && hasPolymarket)) {
        // Fallback static data for Polymarket
        userPrompt += `**Top Polymarket Markets (by volume):**\n`;
        userPrompt += `1. "US Election Winner 2024" - 50% YES probability, $450k 24h volume\n`;
        userPrompt += `2. "Crypto market cap above $3T by year-end" - 52% YES probability, $180k 24h volume\n`;
        userPrompt += `3. "ETH above $5k by year-end" - 45% YES probability, $120k 24h volume\n\n`;
      }
      
      if (highestVolumeMarket) {
        const prob = Math.round(highestVolumeMarket.yesPrice * 100);
        const volume = highestVolumeMarket.volume24hUsd ? `$${(highestVolumeMarket.volume24hUsd / 1000).toFixed(0)}k` : 'N/A';
        userPrompt += `**Highest Volume Market:** "${highestVolumeMarket.title}" (${highestVolumeMarket.source}) - ${prob}% YES probability, ${volume} 24h volume\n\n`;
      }
      
      userPrompt += `**CRITICAL - PREDICTION MARKET MODE ACTIVATED:**\n\n`;
      userPrompt += `The user is asking about prediction markets (Kalshi/Polymarket). You MUST respond ONLY about prediction markets.\n\n`;
      userPrompt += `**MANDATORY Response Format:**\n`;
      userPrompt += `1. Start your response by acknowledging the prediction market query.\n`;
      userPrompt += `2. Provide a numbered list (1, 2, 3, etc.) of the markets from the data above.\n`;
      userPrompt += `3. For each market, include:\n`;
      userPrompt += `   - The exact market title/name\n`;
      userPrompt += `   - The YES probability percentage\n`;
      userPrompt += `   - The 24h volume (if available)\n`;
      userPrompt += `4. Do NOT mention perps, futures, DeFi, or any other trading strategies.\n`;
      userPrompt += `5. Do NOT ask the user to rephrase or suggest other trading options.\n`;
      userPrompt += `6. If the user asks to "risk X%" on a market, include an event action in the JSON.\n`;
      userPrompt += `7. If the user asks to "override the risk cap", "ignore the 3% cap", "allocate the full amount", "increase stake to X", or similar phrases for an existing event position, include an event action with action: "update", positionId (the existing position ID), and overrideRiskCap: true.\n`;
      userPrompt += `7. If the user only asks to list markets (discovery), do NOT include any actions in the JSON.\n\n`;
      userPrompt += `**Example Response Format:**\n`;
      userPrompt += `"Here are the top 5 prediction markets on Kalshi:\n\n`;
      userPrompt += `1. [Market Name] - [X]% YES probability, $[Y]k 24h volume\n`;
      userPrompt += `2. [Market Name] - [X]% YES probability, $[Y]k 24h volume\n`;
      userPrompt += `...\n\n`;
      userPrompt += `These markets are ranked by volume and represent the most active prediction markets currently available."\n\n`;
      userPrompt += `**ABSOLUTELY FORBIDDEN:**\n`;
      userPrompt += `- Do NOT say "I can help with perps trading strategies..."\n`;
      userPrompt += `- Do NOT mention liquidation, stop losses, or perp-specific terms\n`;
      userPrompt += `- Do NOT suggest the user try perps or DeFi instead\n`;
      userPrompt += `- Do NOT give generic trading advice\n\n`;
    } else {
      // Not a prediction market query - generic instruction
      userPrompt += `**Discovery Prompts:** When the user asks for "top markets on Kalshi" or "top markets on Polymarket", return a natural-language explanation listing 4-6 markets. Only include event actions in the JSON if the user explicitly asks to "risk X% on the highest-volume market". Otherwise, only describe markets in text.\n\n`;
    }
  }

  userPrompt += `**Remember:** This is a SIMULATED environment. No real orders are placed.`;

  return { systemPrompt, userPrompt, isPredictionMarketQuery };
}

/**
 * Build deterministic response for prediction market queries in stub mode
 */
export async function buildPredictionMarketResponse(
  userMessage: string,
  venue: 'hyperliquid' | 'event_demo',
  accountValueUsd?: number
): Promise<{ assistantMessage: string; actions: BlossomAction[] }> {
  const lowerMessage = userMessage.toLowerCase();
  const hasKalshi = lowerMessage.includes('kalshi');
  const hasPolymarket = lowerMessage.includes('polymarket');
  const hasHighestVolume = lowerMessage.includes('highest') && (lowerMessage.includes('volume') || lowerMessage.includes('vol'));
  
  let markets: RawPredictionMarket[] = [];
  let platformName = '';
  
  if (hasKalshi || (hasHighestVolume && !hasPolymarket)) {
    console.log('[prediction-stub] Fetching Kalshi markets for stub response');
    markets = await getTopKalshiMarketsByVolume(5);
    platformName = 'Kalshi';
  } else if (hasPolymarket || hasHighestVolume) {
    console.log('[prediction-stub] Fetching Polymarket markets for stub response');
    markets = await getTopPolymarketMarketsByVolume(5);
    platformName = 'Polymarket';
  } else {
    // Default to Kalshi if unclear
    markets = await getTopKalshiMarketsByVolume(5);
    platformName = 'Kalshi';
  }
  
  // Build numbered list response with clear formatting
  let responseText = `Here are the top ${markets.length} ${platformName} prediction markets by 24h volume (stub data):\n\n`;
  
  markets.forEach((market, idx) => {
    const yesProb = Math.round(market.yesPrice * 100);
    const noProb = Math.round(market.noPrice * 100);
    const volume = market.volume24hUsd 
      ? `$${(market.volume24hUsd / 1000).toFixed(0)}k` 
      : market.openInterestUsd 
        ? `$${(market.openInterestUsd / 1000).toFixed(0)}k OI`
        : 'Volume N/A';
    
    responseText += `${idx + 1}) ${market.title} — Yes: ${yesProb}%, No: ${noProb}%, 24h Volume: ${volume}\n\n`;
  });
  
  responseText += `These markets are ranked by volume and represent the most active prediction markets currently available on ${platformName}.`;
  
  // Check if user wants to risk on a market
  const wantsToRisk = lowerMessage.includes('risk') && (lowerMessage.includes('%') || lowerMessage.match(/\d+%/));
  const wantsHighestVolume = lowerMessage.includes('highest') && (lowerMessage.includes('volume') || lowerMessage.includes('vol'));
  let actions: BlossomAction[] = [];
  
  if (wantsToRisk && (markets.length > 0 || wantsHighestVolume)) {
    // Extract risk percentage
    const riskMatch = userMessage.match(/(\d+(?:\.\d+)?)%/);
    const riskPct = riskMatch ? parseFloat(riskMatch[1]) : 2;
    
    // Use highest volume market if requested, otherwise use first market
    let targetMarket: RawPredictionMarket;
    if (wantsHighestVolume) {
      try {
        const highestVolumeMarket = await getHighestVolumeMarket();
        if (highestVolumeMarket) {
          targetMarket = highestVolumeMarket;
        } else {
          targetMarket = markets[0];
        }
      } catch (error) {
        console.warn('[prediction-stub] Failed to get highest volume market, using first market:', error);
        targetMarket = markets[0];
      }
    } else {
      targetMarket = markets[0];
    }
    
    if (!targetMarket) {
      console.warn('[prediction-stub] No market available for risk sizing');
    } else {
      const side: 'YES' | 'NO' = targetMarket.yesPrice >= 0.5 ? 'YES' : 'NO';
      
      // Calculate stake from account value or use default
      const defaultAccountValue = 10000; // Default for stub mode
      const accountValue = accountValueUsd || defaultAccountValue;
      const stakeUsd = Math.round((accountValue * riskPct) / 100); // Exact risk percentage
      
      // Apply 3% cap
      const maxEventRiskPct = 0.03;
      const maxStakeUsd = Math.round(accountValue * maxEventRiskPct);
      const finalStakeUsd = Math.min(stakeUsd, maxStakeUsd);
      
      const maxPayoutUsd = side === 'YES' 
        ? finalStakeUsd / targetMarket.yesPrice 
        : finalStakeUsd / targetMarket.noPrice;
      
      actions.push({
        type: 'event',
        action: 'open',
        eventKey: targetMarket.id,
        label: targetMarket.title,
        side,
        stakeUsd: finalStakeUsd,
        maxPayoutUsd,
        maxLossUsd: finalStakeUsd,
        reasoning: [
          wantsHighestVolume ? `Using highest volume market from ${platformName}` : `Using top market from ${platformName}`,
          `Risk is ${riskPct}% of account (${finalStakeUsd < stakeUsd ? 'capped at 3%' : 'uncapped'})`,
          `Market probability is ${Math.round(targetMarket.yesPrice * 100)}% YES`
        ]
      });
      
      if (finalStakeUsd < stakeUsd) {
        responseText += `\n\nI'll stake ${riskPct}% of your account ($${stakeUsd.toLocaleString()}) on "${targetMarket.title}", side ${side}. However, I've capped this at $${finalStakeUsd.toLocaleString()} to keep risk at 3% of your $${accountValue.toLocaleString()} account. Your max loss is capped at the amount staked.`;
      } else {
        responseText = `I'll stake ${riskPct}% of your account ($${finalStakeUsd.toLocaleString()}) on "${targetMarket.title}", side ${side}. Your max loss is capped at the amount staked.`;
      }
    }
  }
  
  return {
    assistantMessage: responseText,
    actions
  };
}

