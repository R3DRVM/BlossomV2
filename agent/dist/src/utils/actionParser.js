"use strict";
/**
 * Action Parser and Validator
 * Parses and validates BlossomAction[] from LLM JSON output
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateActions = validateActions;
exports.buildBlossomPrompts = buildBlossomPrompts;
exports.validateExecutionRequest = validateExecutionRequest;
exports.buildPredictionMarketResponse = buildPredictionMarketResponse;
const predictionData_1 = require("../services/predictionData");
/**
 * Validate and sanitize actions from LLM output
 */
function validateActions(raw) {
    if (!Array.isArray(raw)) {
        console.warn('Actions is not an array:', typeof raw);
        return [];
    }
    const validActions = [];
    for (const item of raw) {
        try {
            if (!item || typeof item !== 'object') {
                console.warn('Invalid action item (not an object):', item);
                continue;
            }
            if (item.type === 'perp' && item.action === 'open') {
                // Validate perp action
                if (typeof item.market === 'string' &&
                    (item.side === 'long' || item.side === 'short') &&
                    typeof item.riskPct === 'number' &&
                    item.riskPct > 0 &&
                    item.riskPct <= 5 && // Enforce 5% max
                    Array.isArray(item.reasoning)) {
                    validActions.push({
                        type: 'perp',
                        action: 'open',
                        market: item.market,
                        side: item.side,
                        riskPct: Math.min(item.riskPct, 5), // Cap at 5%
                        entry: typeof item.entry === 'number' ? item.entry : undefined,
                        takeProfit: typeof item.takeProfit === 'number' ? item.takeProfit : undefined,
                        stopLoss: typeof item.stopLoss === 'number' ? item.stopLoss : undefined,
                        reasoning: item.reasoning.filter((r) => typeof r === 'string'),
                    });
                }
                else {
                    console.warn('Invalid perp action:', item);
                }
            }
            else if (item.type === 'defi' && item.action === 'deposit') {
                // Validate defi action
                if (typeof item.protocol === 'string' &&
                    typeof item.asset === 'string' &&
                    typeof item.amountUsd === 'number' &&
                    item.amountUsd > 0 &&
                    typeof item.apr === 'number' &&
                    Array.isArray(item.reasoning)) {
                    validActions.push({
                        type: 'defi',
                        action: 'deposit',
                        protocol: item.protocol,
                        asset: item.asset,
                        amountUsd: item.amountUsd,
                        apr: item.apr,
                        reasoning: item.reasoning.filter((r) => typeof r === 'string'),
                    });
                }
                else {
                    console.warn('Invalid defi action:', item);
                }
            }
            else if (item.type === 'event' && item.action === 'open') {
                // Validate event action
                if (typeof item.eventKey === 'string' &&
                    typeof item.label === 'string' &&
                    (item.side === 'YES' || item.side === 'NO') &&
                    typeof item.stakeUsd === 'number' &&
                    item.stakeUsd > 0 &&
                    typeof item.maxPayoutUsd === 'number' &&
                    typeof item.maxLossUsd === 'number' &&
                    Array.isArray(item.reasoning)) {
                    validActions.push({
                        type: 'event',
                        action: 'open',
                        eventKey: item.eventKey,
                        label: item.label,
                        side: item.side,
                        stakeUsd: item.stakeUsd,
                        maxPayoutUsd: item.maxPayoutUsd,
                        maxLossUsd: item.maxLossUsd,
                        reasoning: item.reasoning.filter((r) => typeof r === 'string'),
                        overrideRiskCap: typeof item.overrideRiskCap === 'boolean' ? item.overrideRiskCap : undefined,
                        requestedStakeUsd: typeof item.requestedStakeUsd === 'number' ? item.requestedStakeUsd : undefined,
                    });
                }
                else {
                    console.warn('Invalid event action:', item);
                }
            }
            else if (item.type === 'event' && item.action === 'update') {
                // Validate event update action
                if (typeof item.positionId === 'string' &&
                    typeof item.eventKey === 'string' &&
                    typeof item.label === 'string' &&
                    (item.side === 'YES' || item.side === 'NO') &&
                    typeof item.stakeUsd === 'number' &&
                    item.stakeUsd > 0 &&
                    typeof item.maxPayoutUsd === 'number' &&
                    typeof item.maxLossUsd === 'number' &&
                    Array.isArray(item.reasoning)) {
                    validActions.push({
                        type: 'event',
                        action: 'update',
                        eventKey: item.eventKey,
                        label: item.label,
                        side: item.side,
                        stakeUsd: item.stakeUsd,
                        maxPayoutUsd: item.maxPayoutUsd,
                        maxLossUsd: item.maxLossUsd,
                        reasoning: item.reasoning.filter((r) => typeof r === 'string'),
                        positionId: item.positionId,
                        overrideRiskCap: typeof item.overrideRiskCap === 'boolean' ? item.overrideRiskCap : false,
                        requestedStakeUsd: typeof item.requestedStakeUsd === 'number' ? item.requestedStakeUsd : undefined,
                    });
                }
                else {
                    console.warn('Invalid event update action:', item);
                }
            }
            else {
                console.warn('Unknown action type or action:', item);
            }
        }
        catch (error) {
            console.warn('Error validating action:', error.message, item);
        }
    }
    return validActions;
}
/**
 * Build prompts for Blossom LLM
 */
async function buildBlossomPrompts(args) {
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

CRITICAL - Never Say "I Can't Process":
- If the user's intent is unclear, ASK a clarifying question instead of saying "I can't process" or "I cannot".
- Example clarifying questions:
  * "I'd be happy to help! Are you looking to swap, trade perps, or explore yield opportunities?"
  * "Got it, you want to trade. What asset and how much would you like to use?"
  * "I see you're interested in prediction markets. Would you like me to show top markets by volume?"
- ONLY respond with an error if the request is truly impossible (e.g., unsupported chain, invalid token).
- When in doubt, offer 2-3 options for the user to choose from.
- If user says something vague like "I want to make money" or "help me invest", suggest concrete options.

CRITICAL - Token Inference:
- "I have ETH" or "I only have ETH" + swap request → tokenIn is ETH
- "Convert my USDC" → tokenIn is USDC
- "Get me some WETH" → tokenOut is WETH
- "Swap to USDC" → tokenOut is USDC
- Always infer the most logical interpretation. Ask only if truly ambiguous.
- If user has a balance and wants to swap, infer they want to swap FROM their largest balance.

CRITICAL - Output Format:
- You MUST respond with a single JSON object with top-level keys: "assistantMessage" (string), "actions" (array), and optionally "executionRequest" (object).
- No commentary or text outside the JSON object.
- The "assistantMessage" must be short, clear, and never mention JSON or technical details.
- The "assistantMessage" should follow the 4-step structure above (restate intent, summarize strategy, highlight risk, suggest next step).
- The "actions" array MUST contain valid BlossomAction objects for simulation. For on-chain swaps, "actions" may be empty.
- For on-chain swap requests, you MUST include an "executionRequest" field.

CRITICAL - Execution Request Format (for on-chain swaps):
- When user requests a swap (e.g., "Swap X USDC to WETH" or "I only have ETH, swap to USDC"), you MUST include "executionRequest":
{
  "executionRequest": {
    "kind": "swap",
    "chain": "sepolia",
    "tokenIn": "ETH" | "WETH" | "USDC",
    "tokenOut": "WETH" | "USDC",
    "amountIn": "0.01",  // REQUIRED: decimal string (e.g., "0.01" for ETH, "10" for USDC)
    "slippageBps": 50,   // basis points (50 = 0.5%)
    "fundingPolicy": "auto"  // "auto" allows funding routes, "require_tokenIn" requires user to hold tokenIn
  }
}

Examples:
1. "Swap 10 USDC to WETH" → 
{
  "executionRequest": {
    "kind": "swap",
    "chain": "sepolia",
    "tokenIn": "USDC",
    "tokenOut": "WETH",
    "amountIn": "10",
    "slippageBps": 50,
    "fundingPolicy": "require_tokenIn"
  }
}

2. "I only have ETH. Swap 0.01 ETH to WETH" →
{
  "executionRequest": {
    "kind": "swap",
    "chain": "sepolia",
    "tokenIn": "ETH",
    "tokenOut": "WETH",
    "amountIn": "0.01",
    "slippageBps": 50,
    "fundingPolicy": "auto"
  }
}

3. "Swap enough ETH to get 10 USDC" →
{
  "executionRequest": {
    "kind": "swap",
    "chain": "sepolia",
    "tokenIn": "ETH",
    "tokenOut": "USDC",
    "amountIn": "0.01",  // YOU must explicitly choose amountIn (cannot be "enough")
    "amountOut": "10",   // optional target
    "slippageBps": 50,
    "fundingPolicy": "auto"
  }
}

CRITICAL - amountIn requirement:
- You MUST always provide a specific amountIn value (decimal string).
- If user says "enough" or "sufficient", you must calculate and provide an explicit amount.
- For ETH: use decimal format like "0.01", "0.1", "1.0"
- For USDC: use decimal format like "10", "100", "1000"

CRITICAL - Execution Request Format (for perp positions):
- When user requests a perp position AND mentions leverage (e.g., "long BTC with 20x leverage", "5x leverage on ETH"), you MUST include "executionRequest" with the leverage field:
{
  "executionRequest": {
    "kind": "perp",
    "market": "BTC-PERP" | "ETH-PERP" | "SOL-PERP",
    "side": "long" | "short",
    "leverage": 20,  // REQUIRED if user mentions leverage (extract from "20x", "5x leverage", etc.)
    "riskPct": 2.0,  // percentage of account to risk
    "entryPrice": 95000,  // optional target entry
    "takeProfitPrice": 105000,  // optional TP target
    "stopLossPrice": 92000  // optional SL target
  }
}

IMPORTANT: Extract leverage from user requests:
- "20x leverage" → leverage: 20
- "5.5x" → leverage: 5.5
- "use 3x" → leverage: 3
- If user doesn't mention leverage, do NOT include it (will default to 2x)

Product Pillars:
- Perps execution & risk: Open and manage perpetual futures positions with automatic risk management.
- DeFi yield deployment: Park idle USDC into yield-generating protocols (Kamino, RootsFi, Jet).
- Event market bets: Take positions on prediction markets (Fed cuts, ETF approvals, elections). For "bet/bet YES/bet NO on [event]" requests, include executionRequest with kind: "event", marketId: "[market id]", outcome: "YES"/"NO", stakeUsd: [amount].

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

Example JSON output (perp with leverage):
{
  "assistantMessage": "I'll open a long ETH perp position with 5x leverage and 3% account risk. This strategy targets $3,640 take profit and $3,395 stop loss, keeping your liquidation buffer comfortable. Risk is capped at 3% of account value. Would you like me to adjust the risk level or entry price?",
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
  ],
  "executionRequest": {
    "kind": "perp",
    "market": "ETH-PERP",
    "side": "long",
    "leverage": 5,
    "riskPct": 3.0,
    "entryPrice": 3500,
    "takeProfitPrice": 3640,
    "stopLossPrice": 3395
  }
}

CRITICAL - Execution Request Format (for DeFi lending/yield):
- When user requests to allocate/deposit funds to a protocol (e.g., "Allocate amountUsd:500 to protocol:Aave V3", "Allocate 10% to Lido"), you MUST include "executionRequest":
{
  "executionRequest": {
    "kind": "lend",
    "chain": "sepolia",
    "asset": "USDC",
    "amount": "500",  // REQUIRED: decimal string (USD amount)
    "protocol": "demo",  // Use "demo" for testnet
    "vault": "Aave V3"  // Protocol name from user request
  }
}

IMPORTANT - Parsing DeFi allocation requests:
- "Allocate amountUsd:"500" to protocol:"Aave V3" USDC yield" → amount: "500", vault: "Aave V3"
- "Allocate amountPct:"10" to protocol:"Lido" USDC yield" → calculate amount from account value (10% of portfolio), vault: "Lido"
- Extract protocol name from protocol:"[name]" (with or without quotes)
- Extract amount from amountUsd:"[value]" or amountPct:"[value]" (with or without quotes)
- "Deposit $1000 into Compound" → amount: "1000", vault: "Compound"
- "Park 500 USDC in highest APY vault" → amount: "500", vault: use highest APY from TOP YIELD VAULTS

Example JSON output (DeFi yield allocation):
{
  "assistantMessage": "I'll allocate $500 to Aave V3's USDC lending pool, earning 6.4% APY. This uses idle USDC capital efficiently while keeping funds accessible. The allocation is within the 25% single-protocol cap. Confirm to execute?",
  "actions": [
    {
      "type": "defi",
      "action": "deposit",
      "protocol": "Aave V3",
      "asset": "USDC",
      "amountUsd": 500,
      "apr": 6.4,
      "reasoning": ["Highest APY vault available", "Within 25% protocol cap", "USDC remains accessible"]
    }
  ],
  "executionRequest": {
    "kind": "lend",
    "chain": "sepolia",
    "asset": "USDC",
    "amount": "500",
    "protocol": "demo",
    "vault": "Aave V3"
  }
}

CRITICAL - Execution Request Format (for event markets):
- When user requests to bet on an event (e.g., "Bet YES on Fed rate cut", "Risk $50 on election"), you MUST include "executionRequest":
{
  "executionRequest": {
    "kind": "event",
    "chain": "sepolia",
    "marketId": "fed-rate-cut-march-2025",  // Extract from EVENT MARKETS data
    "outcome": "YES" | "NO",
    "stakeUsd": 50,  // USD amount to stake
    "price": 0.65  // Optional: YES/NO price from EVENT MARKETS data
  }
}

Example JSON output (event market bet):
{
  "assistantMessage": "I'll place a YES bet on 'Fed cuts rates in March 2025' with $50 stake at 65% implied probability. Max payout: $76.92. Max loss: $50. This is 2% of your account value. Confirm to execute?",
  "actions": [
    {
      "type": "event",
      "action": "open",
      "eventKey": "fed-rate-cut-march-2025",
      "label": "Fed cuts rates in March 2025",
      "side": "YES",
      "stakeUsd": 50,
      "maxPayoutUsd": 76.92,
      "maxLossUsd": 50,
      "reasoning": ["Strong economic indicators", "Within 2% risk cap", "65% implied probability"]
    }
  ],
  "executionRequest": {
    "kind": "event",
    "chain": "sepolia",
    "marketId": "fed-rate-cut-march-2025",
    "outcome": "YES",
    "stakeUsd": 50,
    "price": 0.65
  }
}`;
    // Detect DeFi/yield intent
    const lowerMessage = userMessage.toLowerCase();
    const isDefiIntent = (/park|deposit|earn yield|lend|supply|yield|allocate/i.test(userMessage) &&
        (lowerMessage.includes('usdc') || lowerMessage.includes('stablecoin') || lowerMessage.includes('yield') || lowerMessage.includes('protocol')));
    // Fetch DefiLlama vaults if DeFi intent detected
    let topVaults = [];
    if (isDefiIntent) {
        try {
            const { getTopYieldVaults } = await Promise.resolve().then(() => __importStar(require('../quotes/defiLlamaQuote')));
            topVaults = await getTopYieldVaults();
        }
        catch (error) {
            console.warn('[buildBlossomPrompts] Failed to fetch DefiLlama vaults:', error.message);
            // Use fallback vaults (already in defiLlamaQuote.ts)
        }
    }
    let userPrompt = `**User Request:**\n${userMessage}\n\n`;
    // Inject DefiLlama vault data if DeFi intent
    if (isDefiIntent && topVaults.length > 0) {
        userPrompt += `**TOP YIELD VAULTS (from DefiLlama):**\n`;
        topVaults.forEach((vault, idx) => {
            userPrompt += `${idx + 1}. ${vault.name} - ${vault.apy.toFixed(2)}% APY, TVL: $${(vault.tvl / 1000).toFixed(0)}k\n`;
        });
        userPrompt += `\n**Recommendation:** For "park/deposit/earn yield" requests, recommend the highest APY vault (${topVaults[0]?.name || 'Aave USDC'}) and build a PULL → LEND_SUPPLY execution plan.\n\n`;
    }
    // Detect event intent
    const isEventIntent = /bet|wager|risk.*on|event|prediction/i.test(userMessage) &&
        (lowerMessage.includes('yes') || lowerMessage.includes('no') || lowerMessage.includes('fed') || lowerMessage.includes('rate cut'));
    // Fetch event markets if event intent detected
    let eventMarkets = [];
    if (isEventIntent) {
        try {
            const { getEventMarkets } = await Promise.resolve().then(() => __importStar(require('../quotes/eventMarkets')));
            const markets = await getEventMarkets(5);
            eventMarkets = markets.map(m => ({ id: m.id, title: m.title, yesPrice: m.yesPrice, noPrice: m.noPrice }));
        }
        catch (error) {
            console.warn('[buildBlossomPrompts] Failed to fetch event markets:', error.message);
        }
    }
    // Inject event market data if event intent
    if (isEventIntent && eventMarkets.length > 0) {
        userPrompt += `**EVENT MARKETS (from dFlow/Polymarket):**\n`;
        eventMarkets.forEach((market, idx) => {
            userPrompt += `${idx + 1}. "${market.title}" - YES: ${(market.yesPrice * 100).toFixed(0)}%, NO: ${(market.noPrice * 100).toFixed(0)}%\n`;
        });
        userPrompt += `\n**Recommendation:** For "bet/bet YES/bet NO on [event]" requests, match keyword to market and build a PROOF execution plan with venueType=2.\n\n`;
    }
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
        isPredictionMarketQuery = !!(isAskingTopKalshi || isAskingTopPolymarket || isAskingHighestVolume ||
            (hasKalshi && hasPredictionMarket) || (hasPolymarket && hasPredictionMarket) ||
            isAskingAboutKalshi || isAskingAboutPolymarket || isRiskingOnPredictionMarket);
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
    }
    else if (venue === 'event_demo') {
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
        let kalshiMarkets = [];
        let polymarketMarkets = [];
        let highestVolumeMarket = null;
        try {
            if (isAskingTopKalshi || isAskingHighestVolume || (isPredictionMarketQuery && hasKalshi)) {
                console.log('[prediction] Fetching Kalshi markets for prompt');
                kalshiMarkets = await (0, predictionData_1.getTopKalshiMarketsByVolume)(5);
                console.log(`[prediction] Fetched ${kalshiMarkets.length} Kalshi markets:`, kalshiMarkets.map(m => m.title).join(', '));
            }
            if (isAskingTopPolymarket || isAskingHighestVolume || (isPredictionMarketQuery && hasPolymarket)) {
                console.log('[prediction] Fetching Polymarket markets for prompt');
                polymarketMarkets = await (0, predictionData_1.getTopPolymarketMarketsByVolume)(5);
                console.log(`[prediction] Fetched ${polymarketMarkets.length} Polymarket markets:`, polymarketMarkets.map(m => m.title).join(', '));
            }
            if (isAskingHighestVolume) {
                console.log('[prediction] Fetching highest volume market');
                highestVolumeMarket = await (0, predictionData_1.getHighestVolumeMarket)();
                console.log(`[prediction] Highest volume market:`, highestVolumeMarket ? highestVolumeMarket.title : 'none');
            }
        }
        catch (error) {
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
            }
            else if (isAskingTopKalshi || (isPredictionMarketQuery && hasKalshi)) {
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
            }
            else if (isAskingTopPolymarket || (isPredictionMarketQuery && hasPolymarket)) {
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
        }
        else {
            // Not a prediction market query - generic instruction
            userPrompt += `**Discovery Prompts:** When the user asks for "top markets on Kalshi" or "top markets on Polymarket", return a natural-language explanation listing 4-6 markets. Only include event actions in the JSON if the user explicitly asks to "risk X% on the highest-volume market". Otherwise, only describe markets in text.\n\n`;
        }
    }
    userPrompt += `**Remember:** This is a SIMULATED environment. No real orders are placed.`;
    return { systemPrompt, userPrompt, isPredictionMarketQuery };
}
/**
 * Validate execution request from LLM
 */
function validateExecutionRequest(raw) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    if (raw.kind === 'lend' || raw.kind === 'lend_supply') {
        // Validate chain
        if (raw.chain !== 'sepolia') {
            console.warn('Invalid chain for lending:', raw.chain);
            return null;
        }
        // Validate asset (must be USDC for now)
        if (raw.asset !== 'USDC') {
            console.warn('Invalid asset for lending:', raw.asset);
            return null;
        }
        // Validate amount (required, must be decimal string)
        if (!raw.amount || typeof raw.amount !== 'string') {
            console.warn('Missing or invalid amount for lending');
            return null;
        }
        // Validate amount is a valid decimal number
        const amountNum = parseFloat(raw.amount);
        if (isNaN(amountNum) || amountNum <= 0) {
            console.warn('Invalid amount value for lending:', raw.amount);
            return null;
        }
        return {
            kind: raw.kind === 'lend_supply' ? 'lend_supply' : 'lend',
            chain: 'sepolia',
            asset: 'USDC',
            amount: raw.amount,
            protocol: raw.protocol || 'demo',
            vault: raw.vault,
        };
    }
    if (raw.kind === 'swap') {
        // Validate chain
        if (raw.chain !== 'sepolia') {
            console.warn('Invalid chain:', raw.chain);
            return null;
        }
        // Validate token enums
        const validTokenIn = ['ETH', 'WETH', 'USDC'];
        const validTokenOut = ['WETH', 'USDC'];
        if (!validTokenIn.includes(raw.tokenIn) || !validTokenOut.includes(raw.tokenOut)) {
            console.warn('Invalid tokenIn or tokenOut:', raw.tokenIn, raw.tokenOut);
            return null;
        }
        // Validate amountIn (required, must be decimal string)
        if (!raw.amountIn || typeof raw.amountIn !== 'string') {
            console.warn('Missing or invalid amountIn');
            return null;
        }
        // Validate amountIn is a valid decimal number
        const amountInNum = parseFloat(raw.amountIn);
        if (isNaN(amountInNum) || amountInNum <= 0) {
            console.warn('Invalid amountIn value:', raw.amountIn);
            return null;
        }
        // Validate slippageBps
        const slippageBps = typeof raw.slippageBps === 'number' ? raw.slippageBps : 50;
        if (slippageBps < 0 || slippageBps > 1000) {
            console.warn('Invalid slippageBps:', slippageBps);
            return null;
        }
        // Validate fundingPolicy
        const fundingPolicy = raw.fundingPolicy === 'require_tokenIn' ? 'require_tokenIn' : 'auto';
        return {
            kind: 'swap',
            chain: 'sepolia',
            tokenIn: raw.tokenIn,
            tokenOut: raw.tokenOut,
            amountIn: raw.amountIn,
            amountOut: raw.amountOut || undefined,
            slippageBps,
            fundingPolicy,
        };
    }
    // Future: validate other kinds (perp, etc.)
    return null;
}
/**
 * Build deterministic response for prediction market queries in stub mode
 */
async function buildPredictionMarketResponse(userMessage, venue, accountValueUsd) {
    const lowerMessage = userMessage.toLowerCase();
    const hasKalshi = lowerMessage.includes('kalshi');
    const hasPolymarket = lowerMessage.includes('polymarket');
    const hasHighestVolume = lowerMessage.includes('highest') && (lowerMessage.includes('volume') || lowerMessage.includes('vol'));
    let markets = [];
    let platformName = '';
    if (hasKalshi || (hasHighestVolume && !hasPolymarket)) {
        console.log('[prediction-stub] Fetching Kalshi markets for stub response');
        markets = await (0, predictionData_1.getTopKalshiMarketsByVolume)(5);
        platformName = 'Kalshi';
    }
    else if (hasPolymarket || hasHighestVolume) {
        console.log('[prediction-stub] Fetching Polymarket markets for stub response');
        markets = await (0, predictionData_1.getTopPolymarketMarketsByVolume)(5);
        platformName = 'Polymarket';
    }
    else {
        // Default to Kalshi if unclear
        markets = await (0, predictionData_1.getTopKalshiMarketsByVolume)(5);
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
    let actions = [];
    if (wantsToRisk && (markets.length > 0 || wantsHighestVolume)) {
        // Extract risk percentage
        const riskMatch = userMessage.match(/(\d+(?:\.\d+)?)%/);
        const riskPct = riskMatch ? parseFloat(riskMatch[1]) : 2;
        // Use highest volume market if requested, otherwise use first market
        let targetMarket;
        if (wantsHighestVolume) {
            try {
                const highestVolumeMarket = await (0, predictionData_1.getHighestVolumeMarket)();
                if (highestVolumeMarket) {
                    targetMarket = highestVolumeMarket;
                }
                else {
                    targetMarket = markets[0];
                }
            }
            catch (error) {
                console.warn('[prediction-stub] Failed to get highest volume market, using first market:', error);
                targetMarket = markets[0];
            }
        }
        else {
            targetMarket = markets[0];
        }
        if (!targetMarket) {
            console.warn('[prediction-stub] No market available for risk sizing');
        }
        else {
            const side = targetMarket.yesPrice >= 0.5 ? 'YES' : 'NO';
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
            }
            else {
                responseText = `I'll stake ${riskPct}% of your account ($${finalStakeUsd.toLocaleString()}) on "${targetMarket.title}", side ${side}. Your max loss is capped at the amount staked.`;
            }
        }
    }
    return {
        assistantMessage: responseText,
        actions
    };
}
//# sourceMappingURL=actionParser.js.map