// TODO: Replace mockParser with real Blossom agent API calls
// See src/lib/blossomApi.ts for the integration layer
// When ready, update Chat.tsx to use callBlossomChat() instead of parseUserMessage()

export type ParsedIntent = 'trade' | 'risk_question' | 'general' | 'defi' | 'event' | 'update_event_stake' | 'hedge' | 'modify_perp_strategy' | 'modify_event_strategy' | 'show_riskiest_positions' | 'list_top_event_markets';

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
  modifyEventStrategy?: {
    strategyId?: string; // ID of event strategy to modify (will be resolved if not provided)
    newStakeUsd?: number;
    overrideRiskCap: boolean;
  };
  clarification?: string; // Step 2: For market clarification requests
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

// Helper to find active event strategy for editing (mirrors perp version)
export function findActiveEventStrategyForEdit(
  strategies: Array<{ id: string; instrumentType?: 'perp' | 'event'; status: string; isClosed?: boolean }>,
  selectedStrategyId: string | null
): { id: string } | null {
  // First, check if selectedStrategyId refers to an event strategy
  if (selectedStrategyId) {
    const selected = strategies.find(s => s.id === selectedStrategyId);
    if (selected && selected.instrumentType === 'event' && 
        (selected.status === 'draft' || selected.status === 'queued' || selected.status === 'executed' || selected.status === 'executing') &&
        !selected.isClosed) {
      return { id: selectedStrategyId };
    }
  }
  
  // Fall back to most recent event strategy (draft/queued/open)
  const eventStrategies = strategies
    .filter(s => s.instrumentType === 'event' && 
                 (s.status === 'draft' || s.status === 'queued' || s.status === 'executed' || s.status === 'executing') &&
                 !s.isClosed)
    .sort((_a, _b) => {
      // Sort by creation time (assuming IDs are timestamp-based or we have createdAt)
      // For now, just return the first one (most recent in array)
      return 0;
    });
  
  if (eventStrategies.length > 0) {
    return { id: eventStrategies[0].id };
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

// Parse event modification intent from user text (stake amount + override detection)
export function parseEventModificationFromText(
  text: string,
  accountValue: number
): { newStakeUsd: number; overrideRiskCap: boolean } | null {
  // Detect modification phrases that indicate user wants to change/resize an existing event
  const EVENT_MODIFY_RE = /\b(change|make|bump|set|increase|decrease|adjust|update|modify|resize)\b/i;
  const isModificationPhrase = EVENT_MODIFY_RE.test(text);
  
  // Detect "insisting" phrases that indicate user wants to override the cap
  const overridePhrases = [
    /\bstick\s+to\b/i,
    /\bfull\b/i,
    /\binstead\b/i,
    /\bi'?m\s+ok\s+taking\s+more\s+risk\b/i,
    /\boverride\b/i,
    /\bignore\s+the\s+cap\b/i,
    /\bno\s+cap\b/i,
    /\bdo\s+the\s+full\b/i,
    /\buse\s+the\s+full\b/i,
  ];
  const userIsInsisting = overridePhrases.some(phrase => phrase.test(text));
  
  // Parse stake amount - similar to perp size parsing
  let newStakeUsd: number | undefined = undefined;
  
  // Try dollar format first: $500, $1,500
  const dollarMatch = text.match(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)/);
  if (dollarMatch) {
    newStakeUsd = parseFloat(dollarMatch[1].replace(/,/g, ''));
  } else {
    // Try K/k format: 500k, 1.5k
    const kMatch = text.match(/(\d+(?:\.\d+)?)\s*[Kk]\b/);
    if (kMatch) {
      newStakeUsd = parseFloat(kMatch[1]) * 1000;
    } else {
      // Try plain number (if it's a reasonable stake amount, 100-100000)
      const numberMatch = text.match(/\b(\d{3,5})\b/);
      if (numberMatch) {
        const value = parseFloat(numberMatch[1]);
        if (value >= 100 && value <= 100000) {
          newStakeUsd = value;
        }
      }
    }
  }
  
  if (!newStakeUsd) {
    return null;
  }
  
  // For modification phrases (change, make it, bump, etc.), always treat as override
  // Modifications are explicit user requests to change the stake, so we should respect them
  const maxRecommendedStake = accountValue * 0.03; // 3% cap
  const overrideRiskCap = isModificationPhrase || (newStakeUsd > maxRecommendedStake && userIsInsisting);
  
  return {
    newStakeUsd,
    overrideRiskCap,
  };
}

// Helper to check if message introduces a new event topic (vs modifying existing)
function introducesNewEventTopic(text: string, existingEventKey?: string): boolean {
  const lowerText = text.toLowerCase();
  
  // If no existing event, don't treat as "new topic" - let normal event detection handle it
  if (!existingEventKey) {
    return false;
  }
  
  // Check for different event topics
  const eventTopics: Record<string, string[]> = {
    'FED_CUTS_MAR_2025': ['fed', 'fomc', 'rate cut', 'march'],
    'BTC_ETF_APPROVAL_2025': ['etf', 'btc etf', 'approval'],
    'US_ELECTION_2024': ['election', 'president', 'winner'],
  };
  
  const existingTopics = eventTopics[existingEventKey] || [];
  
  // If message mentions event topics that don't match existing event, it's a new event
  if (lowerText.includes('election') && !existingEventKey.includes('ELECTION')) {
    return true;
  }
  if (lowerText.includes('etf') && !existingEventKey.includes('ETF')) {
    return true;
  }
  if ((lowerText.includes('fed') || lowerText.includes('fomc')) && !existingEventKey.includes('FED')) {
    return true;
  }
  
  // If message doesn't mention any event topics, assume it's modifying existing (not introducing new)
  const hasAnyEventTopic = lowerText.includes('fed') || lowerText.includes('election') || lowerText.includes('etf');
  if (!hasAnyEventTopic) {
    return false; // No event topic mentioned = modifying existing
  }
  
  // If it mentions event topics but they don't match existing, it's a new event
  return !existingTopics.some(topic => lowerText.includes(topic));
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

// Helper to detect whether a message is about perps or events based on content
type StrategyDomain = 'perp' | 'event' | null;

function detectStrategyDomain(
  text: string,
  venue?: 'hyperliquid' | 'event_demo'
): StrategyDomain {
  // Event intent patterns - comprehensive coverage
  const EVENT_INTENT_RE = /\b(take\s+(yes|no)|bet\s+\d+|bet\s+(yes|no)|bet\s+\d+\s+on\s+(yes|no)|stake\s+\d+|take\s+\d+\s+on\s+(yes|no)|wager|place\s+a\s+bet)\b/i;

  // Event topic patterns - ensure Fed cuts is caught even when phrased loosely
  const EVENT_TOPIC_RE = /\b(fed\s+cuts?|fomc|rate\s+cut|election|prediction\s+market|kalshi|polymarket)\b/i;

  const hasEventIntent = EVENT_INTENT_RE.test(text);
  const hasEventTopic = EVENT_TOPIC_RE.test(text);

  // Strong event classification: both intent and topic present
  if (hasEventIntent && hasEventTopic) {
    return 'event';
  }

  // Handle "take 200 on no for fed cuts" specifically (number before "on yes/no")
  if (/take\s+\d+.*\bon\s+(yes|no)\b/i.test(text) && hasEventTopic) {
    return 'event';
  }

  // Strong perp signals
  const PERP_SIGNAL_RE = /\b(long|short|perp|leverage|lev|\bliq(buffer)?\b|stop\s+loss|take\s+profit)\b/i;
  const hasPerpSignals = PERP_SIGNAL_RE.test(text);

  // If we have perp signals but no event topic, it's a perp
  if (hasPerpSignals && !hasEventTopic) {
    return 'perp';
  }

  // Ambiguous cases: use weak tiebreakers
  // If we have event topic but no clear perp signals, lean event
  if (!hasEventIntent && !hasPerpSignals && hasEventTopic) {
    return 'event';
  }
  // If we have perp signals but no event topic, lean perp
  if (!hasEventIntent && !hasEventTopic && hasPerpSignals) {
    return 'perp';
  }

  // Final tiebreaker: venue (only when truly ambiguous)
  if (venue === 'event_demo') {
    return 'event';
  }
  if (venue === 'hyperliquid') {
    return 'perp';
  }

  return null;
}

export function parseUserMessage(
  text: string,
  opts?: { venue?: 'hyperliquid' | 'event_demo'; strategies?: Array<{ id: string; instrumentType?: 'perp' | 'event'; status: string; isClosed?: boolean; eventKey?: string }>; selectedStrategyId?: string | null; accountValue?: number }
): ParsedMessage {
  const upperText = text.toUpperCase();
  const lowerText = text.toLowerCase();
  
  // CRITICAL: Check for "list top markets" intent FIRST (before domain detection)
  // This prevents "show me top 5 markets" from creating a Generic Event draft
  const LIST_MARKETS_RE = /\b(show\s+me\s+)?(top\s+(\d+)\s+)?(prediction\s+)?markets?\s+(by\s+)?(volume|trending|open\s+interest)\b/i;
  const hasListMarketsIntent = LIST_MARKETS_RE.test(text) || 
    /\b(list|show|display|fetch|get)\s+(top|trending|highest)\s+(\d+)?\s*(prediction\s+)?markets?\b/i.test(text);
  
  if (hasListMarketsIntent && (opts?.venue === 'event_demo' || detectStrategyDomain(text, opts?.venue) === 'event')) {
    return {
      intent: 'list_top_event_markets',
      strategy: undefined,
      eventStrategy: undefined,
    };
  }
  
  // CRITICAL: Detect domain FIRST, before any perp modification checks
  // This ensures event messages never get misclassified as perp modifications
  const domain = detectStrategyDomain(text, opts?.venue);
  
  // BEFORE domain-specific logic: Check if this is a modification of an existing event strategy
  // This handles cases like "let's change this to 2k" where there are no event keywords but we have an existing event
  const accountValue = opts?.accountValue || 10000;
  const eventModification = parseEventModificationFromText(text, accountValue);
  
  // Check if we have existing event strategies
  const hasExistingEvent = opts?.strategies && opts.strategies.some(s => 
    s.instrumentType === 'event' && 
    (s.status === 'draft' || s.status === 'queued' || s.status === 'executed' || s.status === 'executing') &&
    !s.isClosed
  );
  
  if (eventModification && hasExistingEvent && opts?.strategies && opts?.selectedStrategyId !== undefined) {
    const activeEventStrategy = findActiveEventStrategyForEdit(opts.strategies, opts.selectedStrategyId);
    
    if (activeEventStrategy) {
      // Get the existing event to check if we're modifying the same event
      const existingEvent = opts.strategies.find(s => s.id === activeEventStrategy.id);
      const existingEventKey = existingEvent?.eventKey;
      
      // For modification phrases (change, make it, bump, etc.), always treat as modification
      // even without event keywords. Only skip if clearly introducing a new event topic.
      const EVENT_MODIFY_RE = /\b(change|make|bump|set|increase|decrease|adjust|update|modify|resize)\b/i;
      const isModificationPhrase = EVENT_MODIFY_RE.test(text);
      
      // Only treat as modification if:
      // 1. It's a modification phrase (change, make it, etc.), OR
      // 2. Domain is 'event' (explicit event keywords), OR
      // 3. Domain is null/ambiguous AND we're not introducing a new event topic
      const isEventDomain = domain === 'event';
      const isAmbiguousButNotNewEvent = (domain === null || domain === 'perp') && !introducesNewEventTopic(text, existingEventKey);
      
      if (isModificationPhrase || isEventDomain || isAmbiguousButNotNewEvent) {
        const result = {
          intent: 'modify_event_strategy' as const,
          modifyEventStrategy: {
            strategyId: activeEventStrategy.id,
            newStakeUsd: eventModification.newStakeUsd,
            overrideRiskCap: eventModification.overrideRiskCap,
          },
        };
        
        // Debug logging
        if (typeof window !== 'undefined' && import.meta.env?.DEV) {
          console.log('[debug-event-intent]', {
            raw: text,
            domain,
            action: result.intent,
            eventKey: existingEventKey,
            stakeUsd: result.modifyEventStrategy.newStakeUsd,
            overrideRiskCap: result.modifyEventStrategy.overrideRiskCap,
            isModificationPhrase,
            isEventDomain,
            isAmbiguousButNotNewEvent,
          });
        }
        
        return result;
      }
    }
  }
  
  // Handle event domain strategies (regardless of venue if event keywords are present)
  if (domain === 'event') {
    
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
    
    // Extract side - support "take yes/no", "bet X on yes/no", "bet yes/no" patterns
    let eventSide: 'YES' | 'NO' = 'YES';
    if (/take\s+yes\b/i.test(text) || /bet\s+(on\s+)?yes\b/i.test(text)) {
      eventSide = 'YES';
    } else if (/take\s+no\b/i.test(text) || /bet\s+(on\s+)?no\b/i.test(text)) {
      eventSide = 'NO';
    } else if (lowerText.includes('yes') && !lowerText.includes('long') && !/\bperp/.test(lowerText)) {
      eventSide = 'YES';
    } else if (lowerText.includes('no') && !/\bperp/.test(lowerText)) {
      eventSide = 'NO';
    }
    
    // Extract risk/stake
    const riskMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
    const riskPercent = riskMatch ? parseFloat(riskMatch[1]) : undefined;
    
    // Extract stake amount - prioritize "bet X" / "stake X" / "take X ... on" patterns
    let stakeUsd: number | undefined = undefined;
    
    // Helper to parse number-like strings (handles $, commas, etc.)
    const parseNumberLike = (str: string): number => {
      return parseFloat(str.replace(/[$,]/g, ''));
    };
    
    // First, try "bet X" / "stake X" / "take X ... on" patterns (most specific for events)
    const betStakeMatch = /\b(bet|stake|take)\s+(\$?\d+(?:\.\d+)?[\d,]*)/i.exec(text);
    if (betStakeMatch) {
      stakeUsd = parseNumberLike(betStakeMatch[2]);
    } else {
      // Fallback to dollar format: $3,000 or $3000
      const dollarMatch = text.match(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)/);
      if (dollarMatch) {
        stakeUsd = parseFloat(dollarMatch[1].replace(/,/g, ''));
      } else {
        // Try K/k format: 3K, 3k, 3 K, 3 k
        const kMatch = text.match(/(\d+(?:\.\d+)?)\s*[Kk]\b/);
        if (kMatch) {
          stakeUsd = parseFloat(kMatch[1]) * 1000;
        } else {
          // Try plain number (if it's a reasonable stake amount, 100-100000)
          const numberMatch = text.match(/\b(\d{3,5})\b/);
          if (numberMatch) {
            const value = parseFloat(numberMatch[1]);
            if (value >= 100 && value <= 100000) {
              stakeUsd = value;
            }
          }
        }
      }
    }
    
    const result = {
      intent: 'event' as const,
      eventStrategy: {
        eventKey,
        eventLabel,
        eventSide,
        stakeUsd,
        riskPercent,
      },
    };
    
    // Debug logging
    if (typeof window !== 'undefined' && import.meta.env?.DEV) {
      console.log('[debug-event-intent]', {
        raw: text,
        domain,
        action: result.intent,
        eventKey: result.eventStrategy.eventKey,
        stakeUsd: result.eventStrategy.stakeUsd,
        overrideRiskCap: false, // New events don't have override yet
      });
    }
    
    return result;
  }
  
  // From this point on, we are in perp land only (domain === 'perp' or domain === null)
  // No event strategies should be created past this line
  
  // Check if this is a modification request for an existing perp strategy
  // (We already handled events above, so domain can only be 'perp' or null here)
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
  
  // Classify intent (for perp domain only)
  let intent: ParsedIntent = 'general';
  
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
  
  // Only process perp-related intents (domain is 'perp' or null at this point)
  // Check for hedge keywords FIRST (before trade keywords)
  const hasHedgeKeywords = lowerText.includes('hedge') || lowerText.includes('hedging');
  
  // Check for DeFi keywords
  const hasDefiKeywords = DEFI_KEYWORDS.some(keyword => lowerText.includes(keyword));
  // Check for trade keywords
  const hasTradeKeywords = TRADE_KEYWORDS.some(keyword => lowerText.includes(keyword));
  const hasRiskKeywords = RISK_KEYWORDS.some(keyword => lowerText.includes(keyword));
  
  // Check for riskiest positions queries
  const hasRiskiestKeywords = /\b(riskiest|highest\s+risk|show\s+.*risk|reduce\s+risk|positions?\s+.*risk|more\s+than\s+\d+%|above\s+\d+%)\b/i.test(text);
  
  if (hasDefiKeywords) {
    intent = 'defi';
  } else if (hasHedgeKeywords) {
    intent = 'hedge';
  } else if (hasTradeKeywords) {
    intent = 'trade';
  } else if (hasRiskiestKeywords) {
    intent = 'show_riskiest_positions';
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
    // Step 2: Detect market with aliases and hard-stop on unknown
    let market: string | null = null;
    
    // Market aliases (case-insensitive)
    const marketAliases: Record<string, string> = {
      'BITCOIN': 'BTC',
      'BITCOIN-PERP': 'BTC',
      'BTC': 'BTC',
      'ETH': 'ETH',
      'ETHEREUM': 'ETH',
      'ETHEREUM-PERP': 'ETH',
      'SOL': 'SOL',
      'SOLANA': 'SOL',
      'SOLANA-PERP': 'SOL',
      'BNB': 'BNB',
      'BINANCE': 'BNB',
      'AVAX': 'AVAX',
      'AVALANCHE': 'AVAX',
    };
    
    // Check for explicit market mentions
    for (const [alias, mappedMarket] of Object.entries(marketAliases)) {
      if (upperText.includes(alias)) {
        market = mappedMarket;
        break;
      }
    }
    
    // Also check MARKETS array for direct matches
    if (!market) {
      for (const m of MARKETS) {
        if (upperText.includes(m)) {
          market = m;
          break;
        }
      }
    }
    
    // Step 1: Invariant 0.1 - If market is still unknown and intent is clearly trade, return clarification
    // NEVER default to ETH or any fallback market
    if (!market) {
      // Check if this is clearly a trade intent (has leverage, side, risk, etc.)
      const hasTradeKeywords = /(?:long|short|buy|sell|trade|position|leverage|risk|%)/i.test(text);
      if (hasTradeKeywords) {
        return {
          intent: 'general' as ParsedIntent, // Use general to trigger clarification
          clarification: `Which market do you want: BTC-PERP, ETH-PERP, SOL-PERP, AVAX-PERP, or BNB-PERP?`,
        };
      }
      // If not clearly a trade, still return clarification (no fallback)
      return {
        intent: 'general' as ParsedIntent,
        clarification: `Which market do you want: BTC-PERP, ETH-PERP, SOL-PERP, AVAX-PERP, or BNB-PERP?`,
      };
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

// Helper to format USD amounts
function formatUsd(amount: number): string {
  return `$${amount.toLocaleString()}`;
}

// Helper to format risk percentage
function formatRiskPct(stakeUsd: number, accountValue: number): string {
  if (!accountValue || accountValue <= 0) return '0.0';
  return ((stakeUsd / accountValue) * 100).toFixed(1);
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
    
    const stopLossText = stopLoss === 0 
      ? 'Stop loss: none (not recommended).'
      : `a stop-loss around $${stopLoss.toLocaleString()}`;
    
    return `Got it. I'll go ${side.toUpperCase()} on ${market} with ${riskPercent}% account risk.

I'll set an entry near $${entryPrice.toLocaleString()}, a take-profit around $${takeProfit.toLocaleString()}, and ${stopLossText}.

This keeps an estimated liquidation buffer of ~${liqBuffer}% with ${fundingImpact.toLowerCase()} funding impact in current conditions.`;
  }
  
  if (parsed.intent === 'defi') {
    return `I've analyzed your request and prepared a DeFi yield plan. Review the details below and confirm when ready to deploy.`;
  }
  
  if (parsed.intent === 'modify_perp_strategy' && parsed.modifyPerpStrategy) {
    const mod = parsed.modifyPerpStrategy;
    const changes: string[] = [];
    
    // Build change summary from modification object
    if (mod.modification.sizeUsd !== undefined) {
      changes.push(`size → $${mod.modification.sizeUsd.toLocaleString()}`);
    }
    if (mod.modification.riskPercent !== undefined) {
      changes.push(`per-trade risk → ${mod.modification.riskPercent}%`);
    }
    if (mod.modification.leverage !== undefined) {
      changes.push(`leverage → ${mod.modification.leverage}x`);
    }
    if (mod.modification.side !== undefined) {
      changes.push(`side → ${mod.modification.side}`);
    }
    
    let responseText = 'Got it — I\'ve updated this strategy.';
    
    if (changes.length > 0) {
      responseText += `\n\nChange summary: ${changes.join('; ')}.`;
    }
    
    responseText += '\n\nHere\'s the updated plan:';
    
    return responseText;
  }
  
  if (parsed.intent === 'modify_event_strategy' && parsed.modifyEventStrategy) {
    // Event modification responses are handled in Chat.tsx with custom messages
    // This is just a fallback
    const mod = parsed.modifyEventStrategy;
    const accountValue = (parsed as any)?.accountValue || 10000;
    const riskPct = mod.newStakeUsd ? (mod.newStakeUsd / accountValue) * 100 : 0;
    
    let responseText = `I've updated the stake to $${mod.newStakeUsd?.toLocaleString() || 'requested'} (${riskPct.toFixed(1)}% of your $${accountValue.toLocaleString()} account).`;
    
    if (mod.overrideRiskCap) {
      responseText += `\n\n⚠️ Note: This exceeds the recommended 3% per-strategy risk cap.`;
    }
    
    return responseText;
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
    const cappedStakeUsd = finalStake || eventStrat.stakeUsd || 0;
    const riskPct = formatRiskPct(cappedStakeUsd, accountValue);
    
    // Special message for prediction market risk sizing
    if (isPredictionMarketRisk) {
      if (wasCapped && requestedStake && finalStake && requestedStake !== finalStake) {
        return `You asked to stake ${formatUsd(requestedStake)}. To stay within your risk settings, I've capped this at ${formatUsd(cappedStakeUsd)}.\n\nI've set your stake to ${formatUsd(cappedStakeUsd)}, which is about ${riskPct}% of your ${formatUsd(accountValue)} account.\n\nThis follows your usual 3% per-event risk guideline so a single outcome doesn't dominate your portfolio. Your max loss on this trade is ${formatUsd(cappedStakeUsd)}.`;
      } else {
        return `I've set your stake to ${formatUsd(cappedStakeUsd)}, which is about ${riskPct}% of your ${formatUsd(accountValue)} account.\n\nThis follows your usual 3% per-event risk guideline so a single outcome doesn't dominate your portfolio. Your max loss on this trade is ${formatUsd(cappedStakeUsd)}.`;
      }
    }
    
    // Regular event message - new event creation (capped at ~3%)
    if (wasCapped && requestedStake && finalStake && requestedStake !== finalStake) {
      // User asked for more than 3%, so we capped it - mention what they asked for
      return `You asked to stake ${formatUsd(requestedStake)}. To stay within your risk settings, I've capped this at ${formatUsd(cappedStakeUsd)}.\n\nI've set your stake to ${formatUsd(cappedStakeUsd)}, which is about ${riskPct}% of your ${formatUsd(accountValue)} account.\n\nThis follows your usual 3% per-event risk guideline so a single outcome doesn't dominate your portfolio. Your max loss on this trade is ${formatUsd(cappedStakeUsd)}.`;
    }
    
    // User didn't ask for a specific amount, or it was already within 3%
    return `I've set your stake to ${formatUsd(cappedStakeUsd)}, which is about ${riskPct}% of your ${formatUsd(accountValue)} account.\n\nThis follows your usual 3% per-event risk guideline so a single outcome doesn't dominate your portfolio. Your max loss on this trade is ${formatUsd(cappedStakeUsd)}.`;
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

// Sanity check examples for detectStrategyDomain:
// detectStrategyDomain("let bet 500 on no for fed cuts in march", 'hyperliquid') === 'event'
// detectStrategyDomain("let bet 500 on no for fed cuts in march", 'event_demo') === 'event'
// detectStrategyDomain("long eth perp with 2% risk", 'hyperliquid') === 'perp'
// detectStrategyDomain("Take YES on Fed cuts in March with 2% risk", 'hyperliquid') === 'event'
// detectStrategyDomain("Risk 2% on the highest volume event market", 'event_demo') === 'event'
// detectStrategyDomain("Hedge my BTC with a short perp at 2x leverage", 'hyperliquid') === 'perp'

// TEMP DEBUG – wrap in a function or comment out after fixing
// Uncomment and check console to verify classification and event modification
/*
if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  const mockEventStrategy = {
    id: 'event-1',
    instrumentType: 'event' as const,
    status: 'draft',
    isClosed: false,
    eventKey: 'FED_CUTS_MAR_2025',
    eventLabel: 'Fed cuts in March 2025',
    eventSide: 'NO' as const,
    stakeUsd: 300,
    riskPercent: 3,
  };
  
  const samples = [
    {
      label: '1. New event (capped)',
      text: 'take 500 on no for fed cuts in march',
      strategies: [],
    },
    {
      label: '2. Resize same event (should NOT cap; stake = 2000)',
      text: 'let\'s change this to 2k',
      strategies: [mockEventStrategy],
    },
    {
      label: '3. Resize same event (make it 2000)',
      text: 'make it 2000 instead',
      strategies: [mockEventStrategy],
    },
    {
      label: '4. Resize same event (bump to 1500)',
      text: 'bump this to 1500',
      strategies: [mockEventStrategy],
    },
    {
      label: '5. New unrelated event',
      text: 'ok now take 200 on yes for us election winner 2024',
      strategies: [mockEventStrategy],
    },
  ];

  // Run once on module load (dev only)
  setTimeout(() => {
    console.log('[event-debug] Starting test sequence...');
    for (const s of samples) {
      const parsed = parseUserMessage(s.text, {
        venue: 'hyperliquid',
        strategies: s.strategies as any,
        selectedStrategyId: s.strategies.length > 0 ? s.strategies[0].id : null,
        accountValue: 10000,
      });
      
      const result = {
        label: s.label,
        domain: (parsed as any).domain || 'N/A',
        action: parsed.intent,
        eventKey: parsed.eventStrategy?.eventKey || parsed.modifyEventStrategy?.strategyId || 'N/A',
        stakeUsd: parsed.eventStrategy?.stakeUsd || parsed.modifyEventStrategy?.newStakeUsd || 'N/A',
        overrideRiskCap: parsed.modifyEventStrategy?.overrideRiskCap || false,
      };
      
      console.log('[event-debug]', result);
    }
    console.log('[event-debug] Test sequence complete.');
  }, 1000);
}
*/

