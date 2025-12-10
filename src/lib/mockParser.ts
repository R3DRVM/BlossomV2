// TODO: Replace mockParser with real Blossom agent API calls
// See src/lib/blossomApi.ts for the integration layer
// When ready, update Chat.tsx to use callBlossomChat() instead of parseUserMessage()

export type ParsedIntent = 'trade' | 'risk_question' | 'general' | 'defi' | 'event' | 'update_event_stake' | 'hedge' | 'modify_perp_strategy';

export interface ParsedStrategy {
  market: string;
  side: 'Long' | 'Short';
  riskPercent: number;
  entryPrice: number;
  takeProfit: number;
  stopLoss: number;
  liqBuffer: number;
  fundingImpact: 'Low' | 'Medium' | 'High';
}

export interface ParsedEventStrategy {
  eventKey: string;
  eventLabel: string;
  eventSide: 'YES' | 'NO';
  stakeUsd?: number;
  riskPercent?: number;
  isPredictionMarketRisk?: boolean; // Flag for "Risk X% on highest-volume prediction market"
}

export interface StrategyModification {
  sizeUsd?: number;        // e.g. "2k", "2000", "$1,500"
  riskPercent?: number;    // e.g. "2% risk", "risk 1.5"
  leverage?: number;       // e.g. "2x leverage", "make it 3x"
  side?: 'Long' | 'Short'; // e.g. "flip short", "make it a short", "hedge instead"
}

export interface ParsedMessage {
  intent: ParsedIntent;
  strategy?: ParsedStrategy;
  eventStrategy?: ParsedEventStrategy;
  updateEventStake?: {
    strategyId?: string; // ID of existing event strategy to update
    newStakeUsd: number;
    overrideRiskCap: boolean;
    requestedStakeUsd?: number;
  };
  modifyPerpStrategy?: {
    strategyId?: string; // ID of strategy to modify (will be resolved if not provided)
    modification: StrategyModification;
  };
}

// Helper to find active perp strategy for editing
// This should be called from Chat.tsx with access to strategies and selectedStrategyId
export function findActivePerpStrategyForEdit(
  strategies: Array<{ id: string; instrumentType?: 'perp' | 'event'; status: string; isClosed?: boolean }>,
  selectedStrategyId: string | null
): { id: string } | null {
  // First, check if selectedStrategyId refers to a perp strategy
  if (selectedStrategyId) {
    const selected = strategies.find(s => s.id === selectedStrategyId);
    if (selected && selected.instrumentType === 'perp' && 
        (selected.status === 'draft' || selected.status === 'queued' || selected.status === 'executed' || selected.status === 'executing') &&
        !selected.isClosed) {
      return { id: selectedStrategyId };
    }
  }
  
  // Fall back to most recent perp strategy (draft/queued/open)
  const perpStrategies = strategies
    .filter(s => s.instrumentType === 'perp' && 
                 (s.status === 'draft' || s.status === 'queued' || s.status === 'executed' || s.status === 'executing') &&
                 !s.isClosed)
    .sort((_a, _b) => {
      // Sort by creation time (assuming IDs are timestamp-based or we have createdAt)
      // For now, just return the first one (most recent in array)
      return 0;
    });
  
  if (perpStrategies.length > 0) {
    return { id: perpStrategies[0].id };
  }
  
  return null;
}

// Parse modification intent from user text
export function parseModificationFromText(text: string): StrategyModification | null {
  const lowerText = text.toLowerCase();
  const modification: StrategyModification = {};
  let hasModification = false;
  
  // Parse size/amount (USD)
  // Patterns: "2k", "2000", "$1,500", "do 2k instead", "let's do 1500"
  const sizePatterns = [
    /\$(\d+(?:,\d{3})*(?:\.\d{2})?)/,  // $1,500 or $2000
    /(\d+(?:\.\d+)?)\s*[Kk]\b/,         // 2k, 1.5k
    /\b(\d{3,}(?:,\d{3})*)\b/,          // 2000, 1,500 (large numbers)
  ];
  
  // Check if there's a % nearby - if so, it's likely risk%, not size
  const hasPercentNearby = /\d+\s*%/.test(text);
  
  for (const pattern of sizePatterns) {
    const match = text.match(pattern);
    if (match && !hasPercentNearby) {
      let value = parseFloat(match[1].replace(/,/g, ''));
      if (pattern === sizePatterns[1]) { // K format
        value = value * 1000;
      }
      if (value >= 100) { // Reasonable minimum for size
        modification.sizeUsd = Math.round(value);
        hasModification = true;
        break;
      }
    }
  }
  
  // Parse risk percentage
  // Patterns: "2% risk", "risk 1.5%", "set risk to 2%", "make per-trade risk 1.5%"
  const riskPatterns = [
    /(?:risk|per-trade|per strategy|per-strategy)\s*(?:to|at|of)?\s*(\d+(?:\.\d+)?)\s*%/i,
    /(\d+(?:\.\d+)?)\s*%\s*(?:risk|per-trade|per strategy|per-strategy)/i,
  ];
  
  for (const pattern of riskPatterns) {
    const match = text.match(pattern);
    if (match) {
      const value = parseFloat(match[1]);
      if (value > 0 && value <= 100) {
        modification.riskPercent = value;
        hasModification = true;
        break;
      }
    }
  }
  
  // Parse leverage
  // Patterns: "2x leverage", "make it 3x", "set lev to 5x", "leverage 2x"
  const leveragePatterns = [
    /(\d+(?:\.\d+)?)\s*x\s*(?:leverage|lev)/i,
    /(?:leverage|lev)\s*(?:to|at|of)?\s*(\d+(?:\.\d+)?)\s*x/i,
    /make\s+it\s+(\d+(?:\.\d+)?)\s*x/i,
  ];
  
  for (const pattern of leveragePatterns) {
    const match = text.match(pattern);
    if (match) {
      const value = parseFloat(match[1]);
      if (value >= 1 && value <= 20) { // Reasonable leverage range
        modification.leverage = value;
        hasModification = true;
        break;
      }
    }
  }
  
  // Parse side (long/short)
  // Patterns: "flip short", "go short instead", "make this a short", "hedge this instead"
  if (lowerText.includes('short') || lowerText.includes('hedge')) {
    if (lowerText.includes('flip') || lowerText.includes('go') || lowerText.includes('make') || lowerText.includes('instead')) {
      modification.side = 'Short';
      hasModification = true;
    }
  } else if (lowerText.includes('long') && (lowerText.includes('flip') || lowerText.includes('go') || lowerText.includes('make') || lowerText.includes('instead'))) {
    modification.side = 'Long';
    hasModification = true;
  }
  
  return hasModification ? modification : null;
}

const MARKETS = ['ETH', 'BTC', 'SOL', 'BNB', 'AVAX'];
const DEFAULT_PRICES: Record<string, number> = {
  ETH: 3500,
  BTC: 45000,
  SOL: 100,
  BNB: 300,
  AVAX: 40,
};

const RISK_KEYWORDS = ['risk', 'liquidation', 'liq', 'funding', 'margin', 'volatility', 'correlation', 'var', 'drawdown'];
const TRADE_KEYWORDS = ['long', 'short', 'buy', 'sell', 'trade', 'entry', 'tp', 'sl', 'take profit', 'stop loss'];
const DEFI_KEYWORDS = ['yield', 'lending', 'save', 'savings', 'deposit', 'kamino', 'jet', 'rootsfi', 'stable', 'stables', 'defi', 'apy', 'apr'];
const EVENT_KEYWORDS = [
  'bet',
  'wager',
  'yes on',
  'no on',
  'etf',
  'approval',
  'election',
  'fed',
  'rate cut',
  'rate cuts',
  'inflation',
  'cpi',
  'hack',
  'exploit',
  'launch',
  'ath',
];

export function parseUserMessage(
  text: string,
  opts?: { venue?: 'hyperliquid' | 'event_demo'; strategies?: Array<{ id: string; instrumentType?: 'perp' | 'event'; status: string; isClosed?: boolean }>; selectedStrategyId?: string | null }
): ParsedMessage {
  const upperText = text.toUpperCase();
  const lowerText = text.toLowerCase();
  
  // First, check if this is a modification request for an existing perp strategy
  const modification = parseModificationFromText(text);
  if (modification && opts?.strategies && opts?.selectedStrategyId !== undefined) {
    const activeStrategy = findActivePerpStrategyForEdit(opts.strategies, opts.selectedStrategyId);
    if (activeStrategy) {
      return {
        intent: 'modify_perp_strategy',
        modifyPerpStrategy: {
          strategyId: activeStrategy.id,
          modification,
        },
      };
    }
  }
  
  // Classify intent
  let intent: ParsedIntent = 'general';
  
  // If venue is event_demo, prioritize event detection
  if (opts?.venue === 'event_demo') {
    // Check for prediction market risk sizing (e.g. "Risk 2% on highest-volume prediction market")
    const hasRisk = lowerText.includes('risk') && (lowerText.includes('%') || lowerText.match(/\d+%/));
    const hasHighestVolume = lowerText.includes('highest') && (lowerText.includes('volume') || lowerText.includes('vol'));
    const hasPredictionMarket = lowerText.includes('prediction market') || lowerText.includes('prediction markets');
    const isRiskingOnPredictionMarket = hasRisk && (hasHighestVolume || hasPredictionMarket);
    
    if (isRiskingOnPredictionMarket) {
      // Extract risk percentage
      const riskMatch = text.match(/(\d+(?:\.\d+)?)%/);
      const riskPercent = riskMatch ? parseFloat(riskMatch[1]) : 2;
      
      // Use a default market for highest volume (will be replaced by backend or we'll use static fallback)
      // For mock mode, use the first seeded market as fallback
      return {
        intent: 'event',
        eventStrategy: {
          eventKey: 'FED_CUTS_MAR_2025', // Default to highest volume market (Fed cuts)
          eventLabel: 'Fed cuts in March 2025',
          eventSide: 'YES', // Default side
          riskPercent,
          // Mark this as a prediction market risk query
          isPredictionMarketRisk: true,
        },
      };
    }
    
    const hasEventKeywords = EVENT_KEYWORDS.some(keyword => lowerText.includes(keyword));
    if (hasEventKeywords) {
      intent = 'event';
      
      // Extract event details
      let eventKey = 'GENERIC_EVENT_DEMO';
      let eventLabel = 'Generic Event';
      
      if (lowerText.includes('fed') || lowerText.includes('rate cut')) {
        eventKey = 'FED_CUTS_MAR_2025';
        eventLabel = 'Fed cuts in March 2025';
      } else if (lowerText.includes('etf')) {
        eventKey = 'BTC_ETF_APPROVAL_2025';
        eventLabel = 'BTC ETF Approval 2025';
      } else if (lowerText.includes('election')) {
        eventKey = 'US_ELECTION_2024';
        eventLabel = 'US Election 2024';
      }
      
      // Extract side
      const eventSide: 'YES' | 'NO' = (lowerText.includes('yes') || lowerText.includes('long')) ? 'YES' : 'NO';
      
      // Extract risk/stake
      const riskMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
      const riskPercent = riskMatch ? parseFloat(riskMatch[1]) : undefined;
      
      // Extract stake amount - support multiple formats: $3,000, 3K, 3k, 3 K, 3000, etc.
      let stakeUsd: number | undefined = undefined;
      
      // Try dollar format first: $3,000 or $3000
      const dollarMatch = text.match(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)/);
      if (dollarMatch) {
        stakeUsd = parseFloat(dollarMatch[1].replace(/,/g, ''));
      } else {
        // Try K/k format: 3K, 3k, 3 K, 3 k
        const kMatch = text.match(/(\d+(?:\.\d+)?)\s*[Kk]\b/);
        if (kMatch) {
          stakeUsd = parseFloat(kMatch[1]) * 1000;
        } else {
          // Try plain number (if it's a large number, likely a stake amount)
          const numberMatch = text.match(/\b(\d{3,}(?:,\d{3})*)\b/);
          if (numberMatch) {
            stakeUsd = parseFloat(numberMatch[1].replace(/,/g, ''));
          }
        }
      }
      
      return {
        intent: 'event',
        eventStrategy: {
          eventKey,
          eventLabel,
          eventSide,
          stakeUsd,
          riskPercent,
        },
      };
    }
  }
  
  // Check for event stake override (must check before other intents)
  const overrideKeywords = ['override', 'ignore', 'full', 'allocate the full', 'increase', 'raise', 'even if risky'];
  const hasOverridePhrase = overrideKeywords.some(keyword => lowerText.includes(keyword));
  const hasRiskCap = lowerText.includes('risk cap') || lowerText.includes('3% cap') || lowerText.includes('cap');
  const hasStakeAmount = lowerText.match(/\d+[Kk]|\$\d+|\d{3,}/);
  
  if (opts?.venue === 'event_demo' && hasOverridePhrase && (hasRiskCap || hasStakeAmount)) {
    // Extract stake amount if provided
    let newStakeUsd: number | undefined = undefined;
    const dollarMatch = text.match(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)/);
    if (dollarMatch) {
      newStakeUsd = parseFloat(dollarMatch[1].replace(/,/g, ''));
    } else {
      const kMatch = text.match(/(\d+(?:\.\d+)?)\s*[Kk]\b/);
      if (kMatch) {
        newStakeUsd = parseFloat(kMatch[1]) * 1000;
      } else {
        const numberMatch = text.match(/\b(\d{3,}(?:,\d{3})*)\b/);
        if (numberMatch) {
          newStakeUsd = parseFloat(numberMatch[1].replace(/,/g, ''));
        }
      }
    }
    
    return {
      intent: 'update_event_stake',
      updateEventStake: {
        newStakeUsd: newStakeUsd || 0, // Will use requestedStakeUsd from existing position if not provided
        overrideRiskCap: true,
      },
    };
  }
  
  // Check for hedge keywords FIRST (before trade keywords)
  const hasHedgeKeywords = lowerText.includes('hedge') || lowerText.includes('hedging');
  
  // Check for DeFi keywords
  const hasDefiKeywords = DEFI_KEYWORDS.some(keyword => lowerText.includes(keyword));
  // Check for trade keywords
  const hasTradeKeywords = TRADE_KEYWORDS.some(keyword => lowerText.includes(keyword));
  const hasRiskKeywords = RISK_KEYWORDS.some(keyword => lowerText.includes(keyword));
  
  if (hasDefiKeywords) {
    intent = 'defi';
  } else if (hasHedgeKeywords) {
    intent = 'hedge';
  } else if (hasTradeKeywords) {
    intent = 'trade';
  } else if (hasRiskKeywords) {
    intent = 'risk_question';
  }
  
  // If intent is hedge, parse hedging strategy
  if (intent === 'hedge') {
    // Detect market to hedge (from context or message)
    let market = 'ETH';
    for (const m of MARKETS) {
      if (upperText.includes(m)) {
        market = m;
        break;
      }
    }
    
    // For hedging, we need to calculate net exposure and create opposite side
    // This will be handled in Chat.tsx with access to strategies state
    // For now, return a hedge intent with market info
    const basePrice = DEFAULT_PRICES[market] || 3500;
    
    // Extract risk percentage (default 3% for hedge)
    const riskMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
    const riskPercent = riskMatch ? parseFloat(riskMatch[1]) : 3;
    
    // Calculate entry, TP, SL for SHORT (opposite of long)
    const entryPrice = basePrice;
    const takeProfit = entryPrice * 0.96; // 4% down for short (hedge)
    const stopLoss = entryPrice * 1.03; // 3% up for short
    
    const liqBuffer = 15 + Math.random() * 5;
    const fundingRand = Math.random();
    const fundingImpact: 'Low' | 'Medium' | 'High' = 
      fundingRand < 0.5 ? 'Low' : fundingRand < 0.8 ? 'Medium' : 'High';
    
    return {
      intent: 'hedge',
      strategy: {
        market: `${market}-PERP`,
        side: 'Short', // Hedging always creates opposite side
        riskPercent,
        entryPrice: Math.round(entryPrice),
        takeProfit: Math.round(takeProfit),
        stopLoss: Math.round(stopLoss),
        liqBuffer: Math.round(liqBuffer * 10) / 10,
        fundingImpact,
      },
    };
  }
  
  // If intent is trade, parse strategy
  if (intent === 'trade') {
    // Detect market
    let market = 'ETH';
    for (const m of MARKETS) {
      if (upperText.includes(m)) {
        market = m;
        break;
      }
    }
    
    // Detect side
    const side: 'Long' | 'Short' = upperText.includes('SHORT') ? 'Short' : 'Long';
    
    // Detect risk percentage
    const riskMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
    const riskPercent = riskMatch ? parseFloat(riskMatch[1]) : 3;
    
    // Base price
    const basePrice = DEFAULT_PRICES[market] || 3500;
    
    // Calculate entry, TP, SL
    const entryPrice = basePrice;
    const takeProfit = side === 'Long' 
      ? entryPrice * 1.04  // 4% up for long
      : entryPrice * 0.96; // 4% down for short
    const stopLoss = side === 'Long'
      ? entryPrice * 0.97  // 3% down for long
      : entryPrice * 1.03; // 3% up for short
    
    // Mock liquidation buffer (15-20%)
    const liqBuffer = 15 + Math.random() * 5;
    
    // Mock funding impact
    const fundingRand = Math.random();
    const fundingImpact: 'Low' | 'Medium' | 'High' = 
      fundingRand < 0.5 ? 'Low' : fundingRand < 0.8 ? 'Medium' : 'High';
    
    return {
      intent: 'trade',
      strategy: {
        market: `${market}-PERP`,
        side,
        riskPercent,
        entryPrice: Math.round(entryPrice),
        takeProfit: Math.round(takeProfit),
        stopLoss: Math.round(stopLoss),
        liqBuffer: Math.round(liqBuffer * 10) / 10,
        fundingImpact,
      },
    };
  }
  
  return { intent };
}

export function generateBlossomResponse(parsed: ParsedMessage, originalText?: string): string {
  // Store original text for prediction market detection
  (parsed as any).originalText = originalText;
  if (parsed.intent === 'hedge' && parsed.strategy) {
    const { market, side, riskPercent, entryPrice, takeProfit, stopLoss, liqBuffer, fundingImpact } = parsed.strategy;
    const baseAsset = market.replace('-PERP', '');
    
    return `I'll create a ${side.toUpperCase()} hedge on ${market} with ${riskPercent}% account risk to offset your existing ${baseAsset} long exposure.

This hedge will enter near $${entryPrice.toLocaleString()}, with a take-profit at $${takeProfit.toLocaleString()} and a stop-loss at $${stopLoss.toLocaleString()}.

This reduces your net ${baseAsset} exposure and maintains a liquidation buffer of ~${liqBuffer}% with ${fundingImpact.toLowerCase()} funding impact.`;
  }
  
  if (parsed.intent === 'trade' && parsed.strategy) {
    const { market, side, riskPercent, entryPrice, takeProfit, stopLoss, liqBuffer, fundingImpact } = parsed.strategy;
    
    return `Got it. I'll go ${side.toUpperCase()} on ${market} with ${riskPercent}% account risk.

I'll set an entry near $${entryPrice.toLocaleString()}, a take-profit around $${takeProfit.toLocaleString()}, and a stop-loss around $${stopLoss.toLocaleString()}.

This keeps an estimated liquidation buffer of ~${liqBuffer}% with ${fundingImpact.toLowerCase()} funding impact in current conditions.`;
  }
  
  if (parsed.intent === 'defi') {
    return `I've analyzed your request and prepared a DeFi yield plan. Review the details below and confirm when ready to deploy.`;
  }
  
  if (parsed.intent === 'update_event_stake') {
    const update = parsed.updateEventStake;
    if (!update) {
      return 'I need more information to update the event stake. Please specify the amount and confirm you want to override the risk cap.';
    }
    
    const accountValue = (parsed as any)?.accountValue || 10000;
    const newStake = update.newStakeUsd || update.requestedStakeUsd || 0;
    const riskPct = (newStake / accountValue) * 100;
    
    return `You asked to override your usual 3% risk cap and stake $${newStake.toLocaleString()} on this event position.\n\nI've updated your stake. Your max loss is now $${newStake.toLocaleString()} (${riskPct.toFixed(1)}% of your $${accountValue.toLocaleString()} account).`;
  }
  
  if (parsed.intent === 'event') {
    const eventStrat = parsed.eventStrategy;
    if (!eventStrat) {
      return 'I\'ll allocate a stake into the event market you specified and cap your loss at the amount staked. You can see the stake and max payout in the strategy card.';
    }
    const requestedStake = (eventStrat as any)?.requestedStakeUsd;
    const wasCapped = (eventStrat as any)?.wasCapped;
    const finalStake = (eventStrat as any)?.finalStakeUsd;
    const isPredictionMarketRisk = eventStrat?.isPredictionMarketRisk;
    const accountValue = (parsed as any)?.accountValue || 10000;
    const riskPct = eventStrat.riskPercent || (finalStake ? (finalStake / accountValue) * 100 : 2);
    
    // Special message for prediction market risk sizing
    if (isPredictionMarketRisk) {
      if (wasCapped && requestedStake && finalStake) {
        return `I'll stake ${riskPct}% of your account ($${requestedStake.toLocaleString()}) on "${eventStrat.eventLabel}", side ${eventStrat.eventSide}. However, I've capped this at $${finalStake.toLocaleString()} to keep risk at 3% of your $${accountValue.toLocaleString()} account. Your max loss is capped at the amount staked.`;
      } else {
        return `I'll stake ${riskPct}% of your account ($${finalStake?.toLocaleString() || 'calculated'}) on "${eventStrat.eventLabel}", side ${eventStrat.eventSide}. Your max loss is capped at the amount staked.`;
      }
    }
    
    // Regular event message
    if (wasCapped && requestedStake && finalStake) {
      return `You asked to stake $${requestedStake.toLocaleString()}. I've capped this at $${finalStake.toLocaleString()} to keep risk at 3% of your $${accountValue.toLocaleString()} account.\n\nI'll allocate this stake into the event market you specified. Your max loss is capped at the amount staked. You can see the stake and max payout in the strategy card.`;
    }
    
    return `I'll allocate a stake into the event market you specified and cap your loss at the amount staked. You can see the stake and max payout in the strategy card.`;
  }
  
  if (parsed.intent === 'risk_question') {
    return `I monitor liquidation buffers, VaR, and cross-position correlation for you. You can see a summary in the Risk Center tab.`;
  }
  
  // Check if this is a prediction market query (mock mode fallback)
  // Note: In agent mode, this would be handled by the backend stub short-circuit
  const lowerText = (parsed as any).originalText?.toLowerCase() || '';
  const hasKalshi = lowerText.includes('kalshi');
  const hasPolymarket = lowerText.includes('polymarket');
  const hasPredictionMarket = lowerText.includes('prediction market') || lowerText.includes('prediction markets');
  const hasTop = lowerText.includes('top') || lowerText.includes('trending');
  const hasRightNow = lowerText.includes('right now');
  
  if ((hasKalshi || hasPolymarket) && (hasTop || hasPredictionMarket || hasRightNow)) {
    const platform = hasKalshi ? 'Kalshi' : 'Polymarket';
    return `Here are the top 5 ${platform} prediction markets by 24h volume (mock data):

1) Fed cuts in March 2025 — Yes: 62%, No: 38%, 24h Volume: $125k

2) BTC ETF approved by Dec 31 — Yes: 68%, No: 32%, 24h Volume: $280k

3) ETH ETF approved by June 2025 — Yes: 58%, No: 42%, 24h Volume: $95k

4) US Election Winner 2024 — Yes: 50%, No: 50%, 24h Volume: $450k

5) Crypto market cap above $3T by year-end — Yes: 52%, No: 48%, 24h Volume: $180k

These markets are ranked by volume and represent the most active prediction markets currently available on ${platform}.

Note: This is mock data. Enable backend mode (VITE_USE_AGENT_BACKEND=true) for live market data.`;
  }
  
  return `I can help with perps trading strategies, risk limits, and portfolio summaries. Try something like "Long ETH with 2% risk and manage liquidation".`;
}

