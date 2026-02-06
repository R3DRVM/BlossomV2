/**
 * Advanced Intent Parser
 *
 * Handles complex DeFi operations:
 * - DCA (Dollar Cost Averaging): "DCA $1000 into ETH over 5 days"
 * - Leverage positions: "Open 10x long on BTC with $500"
 * - Yield optimization: "Find best yield for $10k USDC"
 * - Multi-step strategies: "Swap half to ETH, deposit rest to Aave"
 */

import type { ParsedIntent, ChainTarget } from './intentRunner';

// Extended intent types for advanced operations
export type AdvancedIntentKind =
  | 'dca'
  | 'leverage'
  | 'yield_optimize'
  | 'multi_step'
  | 'limit_order'
  | 'stop_loss'
  | 'take_profit';

// DCA-specific parameters
export interface DCAIntent {
  kind: 'dca';
  totalAmount: number;
  amountUnit: string;
  targetAsset: string;
  numIntervals: number;
  intervalMs: number;
  startDelay?: number;
  endDate?: Date;
}

// Leverage position parameters
export interface LeverageIntent {
  kind: 'leverage';
  asset: string;
  side: 'long' | 'short';
  leverage: number;
  marginAmount: number;
  marginUnit: string;
  entryPrice?: number;
  takeProfit?: number;
  stopLoss?: number;
}

// Yield optimization parameters
export interface YieldOptimizeIntent {
  kind: 'yield_optimize';
  amount: number;
  amountUnit: string;
  minApy?: number;
  maxRisk?: 'low' | 'medium' | 'high';
  protocols?: string[];
  excludeProtocols?: string[];
}

// Multi-step strategy parameters
export interface MultiStepIntent {
  kind: 'multi_step';
  steps: ParsedStepIntent[];
}

export interface ParsedStepIntent {
  stepNumber: number;
  action: string;
  params: Record<string, any>;
  dependsOn?: number; // Step number this depends on
  percentageOfPrevious?: number; // "half", "all", "quarter" -> 50, 100, 25
}

export type AdvancedParsedIntent =
  | (DCAIntent & { rawText: string })
  | (LeverageIntent & { rawText: string })
  | (YieldOptimizeIntent & { rawText: string })
  | (MultiStepIntent & { rawText: string });

// Parsing patterns
const PATTERNS = {
  // DCA patterns
  dca: {
    // "DCA $1000 into ETH over 5 days"
    basic: /dca\s+\$?(\d+(?:,?\d+)*(?:\.\d+)?)\s*(?:of\s+)?(\w+)?\s*(?:into|to|for)?\s*(\w+)\s+over\s+(\d+)\s*(day|days|week|weeks|month|months|hour|hours)/i,
    // "Dollar cost average $500 ETH weekly for 4 weeks"
    alternate: /dollar\s*cost\s*average?\s+\$?(\d+(?:,?\d+)*(?:\.\d+)?)\s*(\w+)?\s*(?:into|to)?\s*(\w+)\s+(daily|weekly|monthly)\s+(?:for\s+)?(\d+)\s*(time|times|week|weeks|month|months|day|days)?/i,
    // "Buy $100 of ETH every day for 10 days"
    buyEvery: /buy\s+\$?(\d+(?:,?\d+)*(?:\.\d+)?)\s*(?:of\s+)?(\w+)\s+every\s+(day|week|month|hour)\s+(?:for\s+)?(\d+)\s*(day|days|week|weeks|month|months)?/i,
  },

  // Leverage patterns
  leverage: {
    // "Open 10x long on BTC with $500"
    openWith: /open\s+(\d+(?:\.\d+)?)\s*x\s*(long|short)\s+(?:on\s+)?(\w+)\s+with\s+\$?(\d+(?:,?\d+)*(?:\.\d+)?)/i,
    // "Long BTC 20x with $1000 margin"
    sideFirst: /(long|short)\s+(\w+)\s+(\d+(?:\.\d+)?)\s*x\s+with\s+\$?(\d+(?:,?\d+)*(?:\.\d+)?)/i,
    // "10x leverage long ETH, $500 margin"
    leverageFirst: /(\d+(?:\.\d+)?)\s*x\s+(?:leverage\s+)?(long|short)\s+(\w+)(?:.*?\$(\d+(?:,?\d+)*(?:\.\d+)?))?/i,
    // "$500 10x long BTC"
    amountFirst: /\$(\d+(?:,?\d+)*(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*x\s+(long|short)\s+(\w+)/i,
    // Entry/TP/SL extraction
    entry: /(?:entry|at|@)\s*\$?(\d+(?:,?\d+)*(?:\.\d+)?)/i,
    takeProfit: /(?:tp|take\s*profit|target)\s*(?:at|@)?\s*\$?(\d+(?:,?\d+)*(?:\.\d+)?)/i,
    stopLoss: /(?:sl|stop\s*loss|stop)\s*(?:at|@)?\s*\$?(\d+(?:,?\d+)*(?:\.\d+)?)/i,
  },

  // Yield optimization patterns
  yieldOptimize: {
    // "Find best yield for $10k USDC"
    findBest: /find\s+(?:the\s+)?(?:best|highest|top)\s+(?:yield|apy|apr)\s+(?:for|with)\s+\$?(\d+(?:,?\d+)*(?:\.\d+)?)\s*k?\s*(\w+)?/i,
    // "Where can I earn yield on $5000 USDC"
    whereEarn: /where\s+(?:can\s+i\s+)?(?:earn|get)\s+(?:yield|apy|interest)\s+(?:on|with|for)\s+\$?(\d+(?:,?\d+)*(?:\.\d+)?)\s*k?\s*(\w+)?/i,
    // "Best stablecoin yield for 10000 USDC"
    bestStablecoin: /best\s+(?:stablecoin\s+)?yield\s+(?:for|with)\s+\$?(\d+(?:,?\d+)*(?:\.\d+)?)\s*k?\s*(\w+)?/i,
    // "Park $20k USDC in highest yield vault"
    park: /park\s+\$?(\d+(?:,?\d+)*(?:\.\d+)?)\s*k?\s*(\w+)\s+in\s+(?:highest|best)\s+(?:yield|apy)/i,
    // Risk level extraction
    riskLevel: /(?:low|medium|high)\s*risk/i,
    minApy: /(?:at\s+least|minimum|min)\s+(\d+(?:\.\d+)?)\s*%/i,
  },

  // Multi-step patterns
  multiStep: {
    // "Swap half to ETH, deposit rest to Aave"
    halfRest: /(swap|convert)\s+half\s+(?:to|for)\s+(\w+)(?:,?\s*(?:and\s+)?(?:then\s+)?(deposit|lend|supply)\s+(?:the\s+)?rest\s+(?:to|into)\s+(\w+))?/i,
    // "Convert 50% to ETH and 50% to SOL"
    percentages: /(?:convert|swap)\s+(\d+)\s*%\s+(?:to|for)\s+(\w+)\s+and\s+(\d+)\s*%\s+(?:to|for)\s+(\w+)/i,
    // "then" separator for sequential steps
    then: /then\s+(.+)/i,
    // "and" separator for parallel steps
    and: /\s+and\s+(.+)/i,
    // Fractional amounts
    fraction: /(half|quarter|third|all|rest)\s+(?:of\s+)?(?:my\s+)?(?:the\s+)?(\w+)?/i,
  },

  // Limit order patterns
  limitOrder: {
    // "Buy ETH at $3000"
    buyAt: /buy\s+\$?(\d+(?:,?\d+)*(?:\.\d+)?)\s*(\w+)\s+(?:at|when|if)\s+\$?(\d+(?:,?\d+)*(?:\.\d+)?)/i,
    // "Sell ETH when it hits $4000"
    sellWhen: /sell\s+\$?(\d+(?:,?\d+)*(?:\.\d+)?)\s*(\w+)\s+(?:when|if|at)\s+(?:it\s+)?(?:hits|reaches|at)\s+\$?(\d+(?:,?\d+)*(?:\.\d+)?)/i,
  },
};

// Time interval conversion
const INTERVAL_MS: Record<string, number> = {
  'hour': 60 * 60 * 1000,
  'hours': 60 * 60 * 1000,
  'day': 24 * 60 * 60 * 1000,
  'days': 24 * 60 * 60 * 1000,
  'week': 7 * 24 * 60 * 60 * 1000,
  'weeks': 7 * 24 * 60 * 60 * 1000,
  'month': 30 * 24 * 60 * 60 * 1000,
  'months': 30 * 24 * 60 * 60 * 1000,
  'daily': 24 * 60 * 60 * 1000,
  'weekly': 7 * 24 * 60 * 60 * 1000,
  'monthly': 30 * 24 * 60 * 60 * 1000,
};

// Fraction to percentage conversion
const FRACTION_TO_PERCENT: Record<string, number> = {
  'half': 50,
  'quarter': 25,
  'third': 33,
  'all': 100,
  'rest': -1, // Special: means remainder
};

/**
 * Parse a number from string, handling commas and k/m suffixes
 */
function parseAmount(str: string): number {
  if (!str) return 0;

  // Remove commas
  let cleaned = str.replace(/,/g, '');

  // Handle k/m suffixes
  const lowerCleaned = cleaned.toLowerCase();
  if (lowerCleaned.endsWith('k')) {
    return parseFloat(cleaned.slice(0, -1)) * 1000;
  }
  if (lowerCleaned.endsWith('m')) {
    return parseFloat(cleaned.slice(0, -1)) * 1000000;
  }

  return parseFloat(cleaned);
}

/**
 * Normalize asset symbol
 */
function normalizeAsset(asset: string): string {
  const upper = asset.toUpperCase();

  // Handle common aliases
  const aliases: Record<string, string> = {
    'BUSDC': 'USDC',
    'BLSMUSDC': 'USDC',
    'BLOOMUSDC': 'USDC',
    'BITCOIN': 'BTC',
    'ETHEREUM': 'ETH',
    'SOLANA': 'SOL',
  };

  return aliases[upper] || upper;
}

/**
 * Parse DCA intent
 */
export function parseDCAIntent(text: string): DCAIntent | null {
  // Note: Using original text for regex matching to preserve case in asset names

  // Try basic pattern first
  let match = text.match(PATTERNS.dca.basic);
  if (match) {
    const totalAmount = parseAmount(match[1]);
    const fromAsset = match[2] ? normalizeAsset(match[2]) : 'USDC';
    const targetAsset = normalizeAsset(match[3]);
    const numIntervals = parseInt(match[4]);
    const intervalUnit = match[5].toLowerCase();

    return {
      kind: 'dca',
      totalAmount,
      amountUnit: fromAsset,
      targetAsset,
      numIntervals,
      intervalMs: INTERVAL_MS[intervalUnit] || INTERVAL_MS['day'],
    };
  }

  // Try alternate pattern
  match = text.match(PATTERNS.dca.alternate);
  if (match) {
    const perTradeAmount = parseAmount(match[1]);
    const fromAsset = match[2] ? normalizeAsset(match[2]) : 'USDC';
    const targetAsset = normalizeAsset(match[3]);
    const frequency = match[4].toLowerCase();
    const numIntervals = parseInt(match[5]);

    return {
      kind: 'dca',
      totalAmount: perTradeAmount * numIntervals,
      amountUnit: fromAsset,
      targetAsset,
      numIntervals,
      intervalMs: INTERVAL_MS[frequency] || INTERVAL_MS['day'],
    };
  }

  // Try buyEvery pattern
  match = text.match(PATTERNS.dca.buyEvery);
  if (match) {
    const perTradeAmount = parseAmount(match[1]);
    const targetAsset = normalizeAsset(match[2]);
    const frequency = match[3].toLowerCase();
    const numIntervals = parseInt(match[4]);

    return {
      kind: 'dca',
      totalAmount: perTradeAmount * numIntervals,
      amountUnit: 'USDC',
      targetAsset,
      numIntervals,
      intervalMs: INTERVAL_MS[frequency] || INTERVAL_MS['day'],
    };
  }

  return null;
}

/**
 * Parse leverage intent
 */
export function parseLeverageIntent(text: string): LeverageIntent | null {
  let leverage: number = 0;
  let side: 'long' | 'short' = 'long';
  let asset: string = '';
  let marginAmount: number = 0;

  // Try openWith pattern: "Open 10x long on BTC with $500"
  let match = text.match(PATTERNS.leverage.openWith);
  if (match) {
    leverage = parseFloat(match[1]);
    side = match[2].toLowerCase() as 'long' | 'short';
    asset = normalizeAsset(match[3]);
    marginAmount = parseAmount(match[4]);
  }

  // Try sideFirst pattern: "Long BTC 20x with $1000 margin"
  if (!leverage) {
    match = text.match(PATTERNS.leverage.sideFirst);
    if (match) {
      side = match[1].toLowerCase() as 'long' | 'short';
      asset = normalizeAsset(match[2]);
      leverage = parseFloat(match[3]);
      marginAmount = parseAmount(match[4]);
    }
  }

  // Try leverageFirst pattern: "10x leverage long ETH, $500 margin"
  if (!leverage) {
    match = text.match(PATTERNS.leverage.leverageFirst);
    if (match) {
      leverage = parseFloat(match[1]);
      side = match[2].toLowerCase() as 'long' | 'short';
      asset = normalizeAsset(match[3]);
      marginAmount = match[4] ? parseAmount(match[4]) : 100; // Default $100 if not specified
    }
  }

  // Try amountFirst pattern: "$500 10x long BTC"
  if (!leverage) {
    match = text.match(PATTERNS.leverage.amountFirst);
    if (match) {
      marginAmount = parseAmount(match[1]);
      leverage = parseFloat(match[2]);
      side = match[3].toLowerCase() as 'long' | 'short';
      asset = normalizeAsset(match[4]);
    }
  }

  if (!leverage || !asset) {
    return null;
  }

  // Validate leverage is within safe bounds (1x to 100x max)
  if (leverage < 1) {
    leverage = 1;
  } else if (leverage > 100) {
    leverage = 100; // Cap at 100x for safety
  }

  // Validate margin amount is positive
  if (marginAmount <= 0) {
    marginAmount = 100; // Default $100 margin
  }

  // Extract optional entry/TP/SL
  let entryPrice: number | undefined;
  let takeProfit: number | undefined;
  let stopLoss: number | undefined;

  const entryMatch = text.match(PATTERNS.leverage.entry);
  if (entryMatch) {
    entryPrice = parseAmount(entryMatch[1]);
  }

  const tpMatch = text.match(PATTERNS.leverage.takeProfit);
  if (tpMatch) {
    takeProfit = parseAmount(tpMatch[1]);
  }

  const slMatch = text.match(PATTERNS.leverage.stopLoss);
  if (slMatch) {
    stopLoss = parseAmount(slMatch[1]);
  }

  return {
    kind: 'leverage',
    asset,
    side,
    leverage,
    marginAmount: marginAmount || 100, // Default $100
    marginUnit: 'USDC',
    entryPrice,
    takeProfit,
    stopLoss,
  };
}

/**
 * Parse yield optimization intent
 */
export function parseYieldOptimizeIntent(text: string): YieldOptimizeIntent | null {
  let amount: number = 0;
  let amountUnit: string = 'USDC';

  // Try findBest pattern
  let match = text.match(PATTERNS.yieldOptimize.findBest);
  if (match) {
    amount = parseAmount(match[1]);
    amountUnit = match[2] ? normalizeAsset(match[2]) : 'USDC';
  }

  // Try whereEarn pattern
  if (!amount) {
    match = text.match(PATTERNS.yieldOptimize.whereEarn);
    if (match) {
      amount = parseAmount(match[1]);
      amountUnit = match[2] ? normalizeAsset(match[2]) : 'USDC';
    }
  }

  // Try bestStablecoin pattern
  if (!amount) {
    match = text.match(PATTERNS.yieldOptimize.bestStablecoin);
    if (match) {
      amount = parseAmount(match[1]);
      amountUnit = match[2] ? normalizeAsset(match[2]) : 'USDC';
    }
  }

  // Try park pattern
  if (!amount) {
    match = text.match(PATTERNS.yieldOptimize.park);
    if (match) {
      amount = parseAmount(match[1]);
      amountUnit = match[2] ? normalizeAsset(match[2]) : 'USDC';
    }
  }

  if (!amount) {
    return null;
  }

  // Extract optional parameters
  let maxRisk: 'low' | 'medium' | 'high' | undefined;
  const riskMatch = text.match(PATTERNS.yieldOptimize.riskLevel);
  if (riskMatch) {
    maxRisk = riskMatch[0].toLowerCase().replace(/\s*risk/i, '') as 'low' | 'medium' | 'high';
  }

  let minApy: number | undefined;
  const apyMatch = text.match(PATTERNS.yieldOptimize.minApy);
  if (apyMatch) {
    minApy = parseFloat(apyMatch[1]);
  }

  return {
    kind: 'yield_optimize',
    amount,
    amountUnit,
    minApy,
    maxRisk,
  };
}

/**
 * Parse multi-step strategy intent
 */
export function parseMultiStepIntent(text: string): MultiStepIntent | null {
  const steps: ParsedStepIntent[] = [];
  let stepNumber = 1;

  // Try halfRest pattern: "Swap half to ETH, deposit rest to Aave"
  const halfRestMatch = text.match(PATTERNS.multiStep.halfRest);
  if (halfRestMatch) {
    // First step: swap half
    steps.push({
      stepNumber: 1,
      action: halfRestMatch[1].toLowerCase(), // swap or convert
      params: {
        percentage: 50,
        targetAsset: normalizeAsset(halfRestMatch[2]),
      },
    });

    // Second step: deposit rest (if present)
    if (halfRestMatch[3] && halfRestMatch[4]) {
      steps.push({
        stepNumber: 2,
        action: halfRestMatch[3].toLowerCase(), // deposit, lend, supply
        params: {
          percentage: 50, // the "rest"
          venue: halfRestMatch[4],
        },
        dependsOn: 1,
        percentageOfPrevious: -1, // "rest" means remainder
      });
    }

    if (steps.length > 0) {
      return { kind: 'multi_step', steps };
    }
  }

  // Try percentages pattern: "Convert 50% to ETH and 50% to SOL"
  const percMatch = text.match(PATTERNS.multiStep.percentages);
  if (percMatch) {
    steps.push({
      stepNumber: 1,
      action: 'swap',
      params: {
        percentage: parseInt(percMatch[1]),
        targetAsset: normalizeAsset(percMatch[2]),
      },
    });

    steps.push({
      stepNumber: 2,
      action: 'swap',
      params: {
        percentage: parseInt(percMatch[3]),
        targetAsset: normalizeAsset(percMatch[4]),
      },
    });

    return { kind: 'multi_step', steps };
  }

  // Try splitting by "then" and "and"
  const parts = text.split(/\s+then\s+|\s+and\s+then\s+/i);
  if (parts.length > 1) {
    for (const part of parts) {
      const parsed = parseSimpleStep(part.trim(), stepNumber);
      if (parsed) {
        steps.push(parsed);
        stepNumber++;
      }
    }
  }

  if (steps.length > 1) {
    return { kind: 'multi_step', steps };
  }

  return null;
}

/**
 * Parse a simple step (helper for multi-step parsing)
 */
function parseSimpleStep(text: string, stepNumber: number): ParsedStepIntent | null {
  const lowerText = text.toLowerCase();

  // Swap/convert step
  if (lowerText.includes('swap') || lowerText.includes('convert')) {
    const swapMatch = text.match(/(?:swap|convert)\s+(?:(\d+)%?\s+)?(?:of\s+)?(?:my\s+)?(\w+)?\s*(?:to|for)\s+(\w+)/i);
    if (swapMatch) {
      return {
        stepNumber,
        action: 'swap',
        params: {
          percentage: swapMatch[1] ? parseInt(swapMatch[1]) : 100,
          fromAsset: swapMatch[2] ? normalizeAsset(swapMatch[2]) : undefined,
          targetAsset: normalizeAsset(swapMatch[3]),
        },
      };
    }
  }

  // Deposit/lend step
  if (lowerText.includes('deposit') || lowerText.includes('lend') || lowerText.includes('supply')) {
    const depositMatch = text.match(/(?:deposit|lend|supply)\s+(?:the\s+)?(?:rest|remainder|remaining|(\d+)%?)?\s*(?:to|into|in)\s+(\w+)/i);
    if (depositMatch) {
      return {
        stepNumber,
        action: 'deposit',
        params: {
          percentage: depositMatch[1] ? parseInt(depositMatch[1]) : -1, // -1 means "rest"
          venue: depositMatch[2],
        },
        dependsOn: stepNumber > 1 ? stepNumber - 1 : undefined,
      };
    }
  }

  return null;
}

/**
 * Main advanced intent parser
 * Returns parsed advanced intent or null if not an advanced intent
 */
export function parseAdvancedIntent(text: string): AdvancedParsedIntent | null {
  const normalizedText = text.toLowerCase();

  // Check for DCA keywords
  if (
    normalizedText.includes('dca') ||
    normalizedText.includes('dollar cost average') ||
    (normalizedText.includes('buy') && normalizedText.includes('every'))
  ) {
    const dcaIntent = parseDCAIntent(text);
    if (dcaIntent) {
      return { ...dcaIntent, rawText: text };
    }
  }

  // Check for leverage keywords
  if (
    normalizedText.includes('leverage') ||
    normalizedText.match(/\d+\s*x\s*(long|short)/i) ||
    normalizedText.match(/(long|short)\s+\w+\s+\d+\s*x/i)
  ) {
    const leverageIntent = parseLeverageIntent(text);
    if (leverageIntent) {
      return { ...leverageIntent, rawText: text };
    }
  }

  // Check for yield optimization keywords
  if (
    normalizedText.includes('best yield') ||
    normalizedText.includes('highest yield') ||
    normalizedText.includes('find yield') ||
    normalizedText.includes('earn yield') ||
    normalizedText.includes('where can i earn')
  ) {
    const yieldIntent = parseYieldOptimizeIntent(text);
    if (yieldIntent) {
      return { ...yieldIntent, rawText: text };
    }
  }

  // Check for multi-step patterns
  if (
    normalizedText.includes('half') ||
    normalizedText.includes('then') ||
    normalizedText.match(/\d+%.*and.*\d+%/) ||
    normalizedText.includes('rest')
  ) {
    const multiStepIntent = parseMultiStepIntent(text);
    if (multiStepIntent) {
      return { ...multiStepIntent, rawText: text };
    }
  }

  return null;
}

/**
 * Convert advanced intent to standard ParsedIntent format
 * Used for compatibility with existing execution flow
 */
export function advancedIntentToStandard(
  advanced: AdvancedParsedIntent
): ParsedIntent {
  switch (advanced.kind) {
    case 'dca':
      return {
        kind: 'swap', // DCA is a series of swaps
        action: 'dca',
        amount: advanced.totalAmount.toString(),
        amountUnit: advanced.amountUnit,
        targetAsset: advanced.targetAsset,
        rawParams: {
          original: advanced.rawText,
          advancedKind: 'dca',
          numIntervals: advanced.numIntervals,
          intervalMs: advanced.intervalMs,
          perTradeAmount: advanced.totalAmount / advanced.numIntervals,
        },
      };

    case 'leverage':
      return {
        kind: 'perp',
        action: advanced.side,
        amount: advanced.marginAmount.toString(),
        amountUnit: advanced.marginUnit,
        targetAsset: advanced.asset,
        leverage: advanced.leverage,
        rawParams: {
          original: advanced.rawText,
          advancedKind: 'leverage',
          entryPrice: advanced.entryPrice,
          takeProfit: advanced.takeProfit,
          stopLoss: advanced.stopLoss,
        },
      };

    case 'yield_optimize':
      return {
        kind: 'deposit',
        action: 'yield_optimize',
        amount: advanced.amount.toString(),
        amountUnit: advanced.amountUnit,
        rawParams: {
          original: advanced.rawText,
          advancedKind: 'yield_optimize',
          minApy: advanced.minApy,
          maxRisk: advanced.maxRisk,
          protocols: advanced.protocols,
        },
      };

    case 'multi_step':
      // Multi-step returns the first step, with full strategy in rawParams
      const firstStep = advanced.steps[0];
      return {
        kind: firstStep.action === 'swap' ? 'swap' : 'deposit',
        action: firstStep.action,
        amount: firstStep.params.percentage?.toString(),
        targetAsset: firstStep.params.targetAsset,
        venue: firstStep.params.venue,
        rawParams: {
          original: advanced.rawText,
          advancedKind: 'multi_step',
          steps: advanced.steps,
          currentStep: 0,
        },
      };

    default:
      // Exhaustive check - TypeScript will error if a case is missing
      const _exhaustiveCheck: never = advanced;
      return {
        kind: 'unknown',
        action: 'proof',
        rawParams: {
          original: (advanced as AdvancedParsedIntent).rawText || '',
          advancedKind: 'unknown',
          parseError: `Unhandled advanced intent kind`,
        },
      };
  }
}

/**
 * Get safe defaults when parsing fails
 */
export function getSafeDefaults(text: string): ParsedIntent {
  return {
    kind: 'unknown',
    action: 'proof',
    rawParams: {
      original: text,
      parseError: true,
      safeDefault: true,
    },
  };
}
