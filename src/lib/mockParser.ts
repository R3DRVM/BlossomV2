export type ParsedIntent = 'trade' | 'risk_question' | 'general' | 'defi' | 'event';

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
}

export interface ParsedMessage {
  intent: ParsedIntent;
  strategy?: ParsedStrategy;
  eventStrategy?: ParsedEventStrategy;
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
  opts?: { venue?: 'hyperliquid' | 'event_demo' }
): ParsedMessage {
  const upperText = text.toUpperCase();
  const lowerText = text.toLowerCase();
  
  // Classify intent
  let intent: ParsedIntent = 'general';
  
  // If venue is event_demo, prioritize event detection
  if (opts?.venue === 'event_demo') {
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
      
      const dollarMatch = text.match(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)/);
      const stakeUsd = dollarMatch ? parseFloat(dollarMatch[1].replace(/,/g, '')) : undefined;
      
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
  
  // Check for DeFi keywords
  const hasDefiKeywords = DEFI_KEYWORDS.some(keyword => lowerText.includes(keyword));
  // Check for trade keywords
  const hasTradeKeywords = TRADE_KEYWORDS.some(keyword => lowerText.includes(keyword));
  const hasRiskKeywords = RISK_KEYWORDS.some(keyword => lowerText.includes(keyword));
  
  if (hasDefiKeywords) {
    intent = 'defi';
  } else if (hasTradeKeywords) {
    intent = 'trade';
  } else if (hasRiskKeywords) {
    intent = 'risk_question';
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

export function generateBlossomResponse(parsed: ParsedMessage, userText?: string): string {
  if (parsed.intent === 'trade' && parsed.strategy) {
    const { market, side, riskPercent, entryPrice, takeProfit, stopLoss, liqBuffer, fundingImpact } = parsed.strategy;
    
    return `Got it. I'll go ${side.toUpperCase()} on ${market} with ${riskPercent}% account risk.

I'll set an entry near $${entryPrice.toLocaleString()}, a take-profit around $${takeProfit.toLocaleString()}, and a stop-loss around $${stopLoss.toLocaleString()}.

This keeps an estimated liquidation buffer of ~${liqBuffer}% with ${fundingImpact.toLowerCase()} funding impact in current conditions.`;
  }
  
  if (parsed.intent === 'defi') {
    return `I've analyzed your request and prepared a DeFi yield plan. Review the details below and confirm when ready to deploy.`;
  }
  
  if (parsed.intent === 'event') {
    return `I'll allocate a stake into the event market you specified and cap your loss at the amount staked. You can see the stake and max payout in the strategy card.`;
  }
  
  if (parsed.intent === 'risk_question') {
    return `I monitor liquidation buffers, VaR, and cross-position correlation for you. You can see a summary in the Risk Center tab.`;
  }
  
  return `I can help with perps trading strategies, risk limits, and portfolio summaries. Try something like "Long ETH with 2% risk and manage liquidation".`;
}

