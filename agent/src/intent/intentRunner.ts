// @ts-nocheck
/**
 * Intent Runner Orchestrator
 *
 * Transforms user-style prompts into executed transactions:
 * 1. Accept raw intent_text (e.g., "long btc 20x", "swap 5000 usdc to weth")
 * 2. Create ledger intent row (status=queued)
 * 3. Plan: Parse intent, detect kind, extract parameters
 * 4. Route: Map to implemented venues or fail with clear error
 * 5. Execute: Run transaction via appropriate chain executor
 * 6. Confirm: Wait for confirmation and update ledger
 *
 * This orchestrator is honest about what's implemented vs. not.
 *
 * Task 3 Enhancements:
 * - Advanced intent parsing (DCA, leverage, yield optimization, multi-step)
 * - Market data validation before execution
 * - Retry logic with exponential backoff
 * - Rate limiting for external API calls
 */

import { randomUUID } from 'crypto';
import { DEMO_PERP_ADAPTER_ADDRESS } from '../config';

// Advanced parser imports
import {
  parseAdvancedIntent,
  advancedIntentToStandard,
  getSafeDefaults,
  type AdvancedParsedIntent,
  type DCAIntent,
  type LeverageIntent,
  type YieldOptimizeIntent,
  type MultiStepIntent,
} from './advancedParser';

// Market validator imports
import {
  validateTrade,
  validateDCAParams,
  validateLeverageParams,
  validateSlippageTolerance,
  anonymizeForLogging,
  type MarketValidationResult,
} from '../services/marketValidator';

// Retry handler imports
import {
  withRetry,
  withRateLimit,
  withRetryAndRateLimit,
  getRateLimiter,
  isRateLimitError,
  isRetriableError,
  type RetryConfig,
} from '../utils/retryHandler';

// State machine imports for path isolation
import {
  IntentPath,
  IntentState,
  classifyParsedIntentPath,
  evaluatePathPolicy,
  getContext,
  updateContext,
  transitionPath,
  markExecutionComplete,
  logTransition,
  type IntentContext,
  type PathPolicyResult,
} from './intentStateMachine';

// Security imports for monitoring and guards
import {
  recordPathViolation,
  alertPathViolation,
  sanitizeIntentInput,
  alertInjectionAttempt,
} from '../security/index';

// ============================================
// ERC-8004 Feedback Integration
// ============================================

/**
 * Submit ERC-8004 feedback after successful execution
 * Only submits if ERC-8004 is enabled and trade meets threshold
 */
async function maybeSubmitERC8004Feedback(params: {
  intentId: string;
  executionId: string;
  kind: IntentKind;
  chain: string;
  success: boolean;
  amountUsd?: number;
  latencyMs?: number;
  errorCode?: string;
}): Promise<void> {
  try {
    // Dynamic import to avoid circular dependencies
    const { ERC8004_ENABLED, ERC8004_AGENT_ID } = await import('../erc8004/config.js');

    if (!ERC8004_ENABLED || ERC8004_AGENT_ID === undefined) {
      return;
    }

    const {
      shouldSubmitFeedback,
      deriveCategory,
      calculateFeedbackScore,
      submitExecutionFeedback,
    } = await import('../erc8004/reputationRegistry.js');

    // Check if this trade should trigger feedback
    const amountUsd = params.amountUsd || 0;
    if (!shouldSubmitFeedback(amountUsd)) {
      return;
    }

    // Calculate feedback score
    const score = calculateFeedbackScore(
      params.success,
      params.latencyMs,
      params.errorCode
    );

    // Derive category from intent kind
    const category = deriveCategory(params.kind);

    // Submit feedback (tracks locally, may submit on-chain)
    await submitExecutionFeedback({
      agentId: ERC8004_AGENT_ID,
      category,
      score,
      executionId: params.executionId,
      intentId: params.intentId,
      amountUsd,
      metadata: {
        chain: params.chain,
        latencyMs: params.latencyMs,
        success: params.success,
      },
    });

    console.log(
      `[erc8004] Submitted feedback: kind=${params.kind}, score=${score}, amount=$${amountUsd}`
    );
  } catch (error) {
    // Don't fail execution because of feedback error
    console.warn(`[erc8004] Failed to submit feedback: ${error}`);
  }
}

/**
 * Helper to merge new metadata with existing metadata, preserving caller info (source, domain, runId).
 * This ensures that source tracking persists through all status updates.
 */
function mergeMetadata(existingJson: string | undefined, newData: Record<string, any>): string {
  let existing: Record<string, any> = {};
  try {
    existing = JSON.parse(existingJson || '{}');
  } catch {}

  // Preserve these caller-provided keys across all updates
  const PRESERVED_KEYS = ['source', 'domain', 'runId', 'category', 'timestamp', 'userAgent'];
  const preserved: Record<string, any> = {};
  for (const key of PRESERVED_KEYS) {
    if (existing[key] !== undefined) {
      preserved[key] = existing[key];
    }
  }

  return JSON.stringify({ ...preserved, ...newData });
}

// Type definitions (duplicated to avoid rootDir issues)
type IntentKind = 'perp' | 'perp_create' | 'deposit' | 'swap' | 'bridge' | 'event' | 'unknown';
type IntentStatus = 'queued' | 'planned' | 'routed' | 'executing' | 'confirmed' | 'failed';
type IntentFailureStage = 'plan' | 'route' | 'execute' | 'confirm' | 'quote';
type ExecutionKind = 'perp' | 'perp_create' | 'deposit' | 'bridge' | 'swap' | 'proof' | 'relay' | 'transfer';

// Chain type for clarity
export type ChainTarget = 'ethereum' | 'solana' | 'hyperliquid' | 'both';

// Parsed intent structure
export interface ParsedIntent {
  kind: IntentKind;
  action: string;               // deposit | swap | long | short | bridge | proof
  amount?: string;              // e.g., "20000"
  amountUnit?: string;          // e.g., "usdc"
  targetAsset?: string;         // e.g., "weth", "btc"
  leverage?: number;            // For perp intents
  sourceChain?: string;         // For bridge intents
  destChain?: string;           // For bridge intents
  venue?: string;               // Requested venue if specified
  rawParams: Record<string, any>;
}

// Route decision
export interface RouteDecision {
  chain: 'ethereum' | 'solana' | 'hyperliquid';
  network: 'sepolia' | 'devnet' | 'hyperliquid_testnet';
  venue: string;
  adapter?: string;
  executionType: 'real' | 'proof_only';
  warnings?: string[];
}

// Execution result
export interface IntentExecutionResult {
  ok: boolean;
  intentId: string;
  status: string;
  executionId?: string;
  txHash?: string;
  explorerUrl?: string;
  error?: {
    stage: IntentFailureStage;
    code: string;
    message: string;
  };
  metadata?: Record<string, any>;
}

// Known venue implementations
const IMPLEMENTED_VENUES: Record<string, Record<string, string[]>> = {
  ethereum: {
    deposit: ['demo_vault', 'aave'],
    swap: ['demo_dex', 'uniswap'],
    bridge: ['bridge_proof'],  // Proof only, not real bridging
    perp: ['demo_perp'],       // Proof only
    perp_create: ['hyperliquid'],  // HIP-3 market creation on Hyperliquid
    event: ['native'],         // Event/prediction market - proof only
    proof: ['native'],
    unknown: ['native'],
  },
  solana: {
    deposit: ['solana_vault'],
    swap: ['jupiter', 'demo_dex'], // Jupiter for real swaps, demo_dex for proof_only
    bridge: ['bridge_proof'],
    perp: ['demo_perp'],
    perp_create: [],           // Not supported on Solana yet
    event: ['native'],         // Event/prediction market - proof only
    proof: ['native'],
    unknown: ['native'],
  },
  hyperliquid: {
    perp_create: ['hip3'],     // HIP-3 market creation
    perp: ['native'],          // Native perp trading
  },
};

// Extended IntentKind to include new types
type ExtendedIntentKind = IntentKind | 'prediction' | 'hedge' | 'vault_discovery';

// Intent patterns for parsing - enhanced with more variations
const INTENT_PATTERNS = {
  perp: {
    // Enhanced long pattern: "long btc", "go long BTC 10x", "long BTC at 10x"
    long: /(?:^|\s)(?:go\s+)?long\s+(\w+)(?:\s+(?:at\s+)?(\d+)\s*x)?/i,
    // Enhanced short pattern
    short: /(?:^|\s)(?:go\s+)?short\s+(\w+)(?:\s+(?:at\s+)?(\d+)\s*x)?/i,
    // Leverage pattern: "10x", "10 x", "10x leverage", "at 10x"
    leverage: /(?:at\s+)?(\d+)\s*x\s*(?:leverage|lev)?/i,
    // Amount pattern: "with $1000", "with 1k", "with 500 USDC"
    withAmount: /with\s+\$?([\d,]+(?:\.\d+)?)\s*([km])?/i,
  },
  swap: {
    // Enhanced to handle $ amounts and k/m suffixes
    basic: /swap\s+(?:\$?([\d,]+(?:\.\d+)?)\s*([km])?\s*)?(\w+)\s+(?:to|for|->)\s+(\w+)/i,
    convert: /convert\s+(?:\$?([\d,]+(?:\.\d+)?)\s*([km])?\s*)?(\w+)\s+(?:to|for)\s+(\w+)/i,
    trade: /trade\s+(?:\$?([\d,]+(?:\.\d+)?)\s*([km])?\s*)?(\w+)\s+(?:for|to)\s+(\w+)/i,
    // New: exchange pattern
    exchange: /exchange\s+(?:\$?([\d,]+(?:\.\d+)?)\s*([km])?\s*)?(\w+)\s+(?:for|to)\s+(\w+)/i,
  },
  deposit: {
    // Enhanced patterns
    basic: /deposit\s+(?:\$?([\d,]+(?:\.\d+)?)\s*([km])?\s*)?(\w+)\s+(?:to|into|in)\s+(\w+)/i,
    supply: /supply\s+(?:\$?([\d,]+(?:\.\d+)?)\s*([km])?\s*)?(\w+)\s+(?:to|into)\s+(\w+)/i,
    lend: /lend\s+(?:\$?([\d,]+(?:\.\d+)?)\s*([km])?\s*)?(\w+)/i,
    // New: stake pattern
    stake: /stake\s+(?:\$?([\d,]+(?:\.\d+)?)\s*([km])?\s*)?(\w+)\s+(?:on|to|into)\s+(\w+)/i,
  },
  bridge: {
    // Enhanced patterns with chain aliases
    basic: /bridge\s+(?:\$?([\d,]+(?:\.\d+)?)\s*([km])?\s*)?(\w+)\s+(?:from\s+)?(\w+)\s+to\s+(\w+)/i,
    transfer: /transfer\s+(?:\$?([\d,]+(?:\.\d+)?)\s*([km])?\s*)?(\w+)\s+from\s+(\w+)\s+to\s+(\w+)/i,
    // New: move/send patterns
    move: /move\s+(?:\$?([\d,]+(?:\.\d+)?)\s*([km])?\s*)?(\w+)\s+(?:from\s+)?(\w+)\s+to\s+(\w+)/i,
  },
  // New patterns for Product Thesis scenarios
  prediction: {
    bet: /(?:bet|wager|stake)\s+(?:on\s+)?(?:the\s+)?/i,
    market: /prediction\s*market/i,
    volume: /(?:highest|top|best)\s*(?:volume|liquidity)/i,
    // Simple price level betting: "bet X on Y above/below Z"
    priceLevel: /(?:above|below|over|under|at)\s*\$?\d+/i,
    // Outcome betting: "bet on X winning", "bet X will Y"
    outcome: /(?:bet|wager)\s+(?:on\s+)?(?:\w+\s+)?(?:will|to)\s+/i,
  },
  hedge: {
    basic: /hedge\s+(?:my\s+)?(?:positions?|portfolio)/i,
    protect: /protect\s+(?:my\s+)?(?:positions?|portfolio)/i,
  },
  vault: {
    discovery: /(?:find|get|show)\s+(?:me\s+)?(?:the\s+)?(?:top|best)\s+(?:defi\s+)?vault/i,
    yield: /(\d+(?:\.\d+)?)\s*%\s*(?:yield|apy|apr)/i,
  },
  // Analytics intents - recorded to ledger without on-chain proof
  analytics: {
    exposure: /(?:show|check|get|view)\s+(?:me\s+)?(?:my\s+)?(?:current\s+)?(?:perp\s+)?exposure/i,
    risk: /(?:show|check|get|view)\s+(?:me\s+)?(?:my\s+)?(?:current\s+)?risk/i,
    topProtocols: /(?:show|get|find)\s+(?:me\s+)?(?:the\s+)?(?:top|best)\s+(?:\d+\s+)?(?:defi\s+)?protocols?/i,
    topMarkets: /(?:show|get|find)\s+(?:me\s+)?(?:the\s+)?(?:top|best)\s+(?:\d+\s+)?prediction\s+markets?/i,
  },
  // HIP-3 Perp Market Creation patterns (Hyperliquid)
  perp_create: {
    // "launch perp market for DOGE", "launch DOGE perpetual"
    launch: /(?:launch|create|deploy)\s+(?:a\s+)?(?:perp|perpetual|futures?)\s+(?:market\s+)?(?:for\s+)?(\w+)/i,
    // "new perp for PEPE", "list perp market for WIF"
    newMarket: /(?:new|list)\s+(?:perp|perpetual)\s+(?:market\s+)?(?:for\s+)?(\w+)/i,
    // "hip-3 market for DOGE", "hip3 perp PEPE"
    hip3: /hip-?3\s+(?:market|perp)\s+(?:for\s+)?(\w+)/i,
    // "create futures market BONK", "deploy perp SHIB"
    createFutures: /(?:create|deploy)\s+(?:futures?|perp)\s+(?:market\s+)?(\w+)/i,
    // "register asset DOGE", "register new perp WIF"
    register: /register\s+(?:new\s+)?(?:asset|perp|market)\s+(\w+)/i,
  },
};

/**
 * Asset symbol aliases for common variations and typos
 */
const ASSET_ALIASES: Record<string, string> = {
  // USDC variations
  'BUSDC': 'USDC',
  'BLSMUSDC': 'USDC',
  'BLOOMUSDC': 'USDC',
  'USDC.E': 'USDC',
  'USDCE': 'USDC',

  // ETH variations
  'ETHER': 'ETH',
  'ETHEREUM': 'ETH',
  'WETH': 'ETH',
  'WRAPPED ETH': 'ETH',
  'WRAPPEDETH': 'ETH',

  // BTC variations
  'BITCOIN': 'BTC',
  'WBTC': 'BTC',
  'WRAPPED BTC': 'BTC',
  'WRAPPEDBTC': 'BTC',
  'XBT': 'BTC',

  // SOL variations
  'SOLANA': 'SOL',
  'WSOL': 'SOL',

  // Stablecoin variations
  'TETHER': 'USDT',
  'USDTETHER': 'USDT',
  'BUSD': 'USDC',
  'DAI': 'DAI',
  'FRAX': 'FRAX',

  // Common typos
  'ETTH': 'ETH',
  'ETHE': 'ETH',
  'ETHERIUM': 'ETH',
  'ETHEREM': 'ETH',
  'BTCC': 'BTC',
  'BITCOIIN': 'BTC',
  'USDCC': 'USDC',
  'USCD': 'USDC',
  'SOLANAA': 'SOL',
  'SOLLANA': 'SOL',
};

/**
 * Normalize asset symbol with typo correction
 */
function normalizeAssetSymbol(asset: string): string {
  if (!asset) return 'USDC'; // Default fallback

  // Clean up the input
  const cleaned = asset.toUpperCase().trim().replace(/[^A-Z0-9]/g, '');

  // Check for exact alias match
  if (ASSET_ALIASES[cleaned]) {
    return ASSET_ALIASES[cleaned];
  }

  // Legacy handling for BUSDC variants
  if (cleaned === 'BUSDC' || cleaned === 'BLSMUSDC' || cleaned === 'BLOOMUSDC') {
    return 'USDC';
  }

  // Check for fuzzy match using Levenshtein-like approach for common tokens
  const COMMON_TOKENS = ['ETH', 'BTC', 'SOL', 'USDC', 'USDT', 'DAI', 'WETH', 'WBTC'];
  for (const token of COMMON_TOKENS) {
    if (fuzzyMatch(cleaned, token, 1)) {
      return token;
    }
  }

  return cleaned;
}

/**
 * Simple fuzzy matching - returns true if strings differ by at most maxDist characters
 */
function fuzzyMatch(str1: string, str2: string, maxDist: number): boolean {
  if (Math.abs(str1.length - str2.length) > maxDist) return false;
  if (str1 === str2) return true;

  // Simple character difference count
  let diff = 0;
  const longer = str1.length >= str2.length ? str1 : str2;
  const shorter = str1.length < str2.length ? str1 : str2;

  for (let i = 0; i < longer.length; i++) {
    if (shorter[i] !== longer[i]) diff++;
    if (diff > maxDist) return false;
  }

  return diff <= maxDist;
}

/**
 * Parse amount from various formats:
 * - "1000", "1,000", "1000.50"
 * - "$1000", "$1,000.50"
 * - "1k", "1K", "10k"
 * - "1m", "1M"
 * - "1.5k", "2.5m"
 * - Written numbers: "one hundred", "five thousand"
 */
function parseAmount(amountStr: string | undefined): string {
  if (!amountStr) return '1000'; // Default amount

  let cleaned = amountStr.trim().toLowerCase();

  // Remove currency symbols
  cleaned = cleaned.replace(/[$£€¥]/g, '');

  // Remove commas
  cleaned = cleaned.replace(/,/g, '');

  // Handle written numbers
  const WRITTEN_NUMBERS: Record<string, number> = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'twenty': 20, 'thirty': 30, 'forty': 40, 'fifty': 50,
    'hundred': 100, 'thousand': 1000, 'million': 1000000,
    'k': 1000, 'm': 1000000, 'b': 1000000000,
  };

  // Check for k/m/b suffix
  const suffixMatch = cleaned.match(/^([\d.]+)\s*([kmb])$/);
  if (suffixMatch) {
    const base = parseFloat(suffixMatch[1]);
    const multiplier = WRITTEN_NUMBERS[suffixMatch[2]] || 1;
    return (base * multiplier).toString();
  }

  // Check for written multipliers like "five thousand"
  for (const [word, value] of Object.entries(WRITTEN_NUMBERS)) {
    if (cleaned.includes(word)) {
      // Simple case: "5 thousand" or "five thousand"
      const numMatch = cleaned.match(/([\d.]+)\s*thousand/);
      if (numMatch) {
        return (parseFloat(numMatch[1]) * 1000).toString();
      }
      const numMatch2 = cleaned.match(/([\d.]+)\s*million/);
      if (numMatch2) {
        return (parseFloat(numMatch2[1]) * 1000000).toString();
      }
    }
  }

  // Standard number parsing
  const parsed = parseFloat(cleaned);
  if (!isNaN(parsed) && parsed > 0) {
    return parsed.toString();
  }

  return '1000'; // Default fallback
}

/**
 * Normalize and clean intent text for better matching
 */
function normalizeIntentText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    // Normalize multiple spaces to single
    .replace(/\s+/g, ' ')
    // Remove punctuation except for necessary ones
    .replace(/[!?.,;:'"]+$/g, '')
    // Normalize arrow symbols
    .replace(/[→⟶⇒]/g, '->')
    .replace(/-->/g, '->')
    // Remove common filler words at start
    .replace(/^(i want to|please|can you|could you|help me|i need to|i'd like to)\s+/i, '')
    // Remove trailing filler
    .replace(/\s+(please|for me|now|asap)$/i, '');
}

/**
 * Parse a natural language intent into structured format
 *
 * Task 3 Enhancement: Now supports advanced intent parsing for:
 * - DCA (Dollar Cost Averaging): "DCA $1000 into ETH over 5 days"
 * - Leverage positions: "Open 10x long on BTC with $500"
 * - Yield optimization: "Find best yield for $10k USDC"
 * - Multi-step strategies: "Swap half to ETH, deposit rest to Aave"
 *
 * Enhanced with:
 * - Typo correction for asset names
 * - Multiple number formats ($1k, 1,000, etc.)
 * - Natural language variations
 * - Graceful fallback for ambiguous intents
 */
export function parseIntent(intentText: string): ParsedIntent {
  // Normalize the input text
  const text = normalizeIntentText(intentText);
  const rawParams: Record<string, any> = { original: intentText };

  // Task 3: Try advanced parsing first for complex operations
  try {
    const advancedIntent = parseAdvancedIntent(intentText);
    if (advancedIntent) {
      console.log('[parseIntent] Advanced intent detected:', advancedIntent.kind);
      const standardIntent = advancedIntentToStandard(advancedIntent);
      return standardIntent;
    }
  } catch (error: any) {
    // Log error but continue with standard parsing
    console.warn('[parseIntent] Advanced parsing failed, falling back to standard:', error.message);
  }

  // Check for hedge/portfolio protection intent FIRST (before other patterns)
  if (INTENT_PATTERNS.hedge.basic.test(text) || INTENT_PATTERNS.hedge.protect.test(text)) {
    return {
      kind: 'unknown', // Will be routed as proof_only with special handling
      action: 'hedge',
      rawParams: { ...rawParams, intentType: 'hedge', requiresPortfolio: true },
    };
  }

  // Check for prediction market / event betting intent
  // Match: "prediction market", "bet on highest volume", "bet X on Y above/below Z", etc.
  const hasBetPattern = INTENT_PATTERNS.prediction.bet.test(text);
  const isPredictionMarket = INTENT_PATTERNS.prediction.market.test(text);
  const hasVolumePattern = INTENT_PATTERNS.prediction.volume.test(text);
  const hasPriceLevelPattern = INTENT_PATTERNS.prediction.priceLevel.test(text);
  const hasOutcomePattern = INTENT_PATTERNS.prediction.outcome.test(text);

  if (isPredictionMarket ||
      (hasBetPattern && hasVolumePattern) ||
      (hasBetPattern && hasPriceLevelPattern) ||
      hasOutcomePattern) {
    return {
      kind: 'event', // Event/prediction market betting - routed as proof_only
      action: 'event',
      rawParams: { ...rawParams, intentType: 'event', requiresMarketData: true },
    };
  }

  // Check for vault discovery intent
  if (INTENT_PATTERNS.vault.discovery.test(text)) {
    const yieldMatch = text.match(INTENT_PATTERNS.vault.yield);
    const targetYield = yieldMatch ? parseFloat(yieldMatch[1]) : undefined;

    return {
      kind: 'deposit', // Route to deposit flow, but needs discovery first
      action: 'vault_discovery',
      rawParams: { ...rawParams, intentType: 'vault_discovery', targetYield, requiresYieldRanking: true },
    };
  }

  // Check for HIP-3 perp market creation intent (Hyperliquid)
  const perpCreateResult = tryParsePerpCreate(text, rawParams);
  if (perpCreateResult) return perpCreateResult;

  // Enhanced perp patterns with better matching
  const perpResult = tryParsePerp(text, rawParams);
  if (perpResult) return perpResult;

  // Enhanced swap patterns with better matching
  const swapResult = tryParseSwap(text, rawParams);
  if (swapResult) return swapResult;

  // Enhanced deposit patterns
  const depositResult = tryParseDeposit(text, rawParams);
  if (depositResult) return depositResult;

  // Enhanced bridge patterns
  const bridgeResult = tryParseBridge(text, rawParams);
  if (bridgeResult) return bridgeResult;

  // Check for analytics intents
  const analyticsResult = tryParseAnalytics(text, rawParams);
  if (analyticsResult) return analyticsResult;

  // Fallback: Try to infer intent from keywords
  const inferredResult = tryInferIntent(text, rawParams);
  if (inferredResult) return inferredResult;

  // Unknown intent
  return {
    kind: 'unknown',
    action: 'proof',
    rawParams,
  };
}

/**
 * Try to parse HIP-3 perp market creation intent (Hyperliquid)
 * Matches patterns like: "launch perp market for DOGE", "create futures PEPE", "hip-3 market WIF"
 */
function tryParsePerpCreate(text: string, rawParams: Record<string, any>): ParsedIntent | null {
  // Try each perp_create pattern
  for (const [name, pattern] of Object.entries(INTENT_PATTERNS.perp_create)) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const assetSymbol = normalizeAssetSymbol(match[1]);

      // Extract optional parameters from the text
      const leverageMatch = text.match(/(\d+)\s*x\s*(?:max\s+)?(?:leverage|lev)/i);
      const maxLeverage = leverageMatch ? parseInt(leverageMatch[1]) : 20;

      // Check for fee mentions
      const feeMatch = text.match(/(\d+(?:\.\d+)?)\s*%?\s*(?:maker|taker)?\s*fee/i);
      const takerFeeBps = feeMatch ? Math.round(parseFloat(feeMatch[1]) * 100) : 5;

      // Check for bond amount
      const bondMatch = text.match(/(\d+(?:\.\d+)?)\s*([km])?\s*hype\s*bond/i);
      let bondAmount: string | undefined;
      if (bondMatch) {
        let amount = parseFloat(bondMatch[1]);
        const suffix = bondMatch[2]?.toLowerCase();
        if (suffix === 'k') amount *= 1000;
        else if (suffix === 'm') amount *= 1000000;
        // Convert to wei (18 decimals)
        bondAmount = (BigInt(Math.floor(amount)) * BigInt(10 ** 18)).toString();
      }

      console.log(`[parseIntent] Detected perp_create intent via pattern '${name}':`, {
        asset: assetSymbol,
        maxLeverage,
        takerFeeBps,
        bondAmount: bondAmount ? 'custom' : 'default',
      });

      return {
        kind: 'perp_create',
        action: 'create_market',
        targetAsset: assetSymbol,
        leverage: maxLeverage,
        rawParams: {
          ...rawParams,
          intentType: 'perp_create',
          assetSymbol: assetSymbol.endsWith('-USD') ? assetSymbol : `${assetSymbol}-USD`,
          maxLeverage,
          takerFeeBps,
          bondAmount,
          venue: 'hyperliquid',
          chain: 'hyperliquid_testnet',
        },
      };
    }
  }

  return null;
}

/**
 * Try to parse perp intent with enhanced patterns
 */
function tryParsePerp(text: string, rawParams: Record<string, any>): ParsedIntent | null {
  // Check for "open long/short" pattern FIRST (before standard patterns)
  // This prevents "long on SOL" from matching as "long ON"
  const openMatch = text.match(/open\s+(long|short)\s+(?:on\s+)?(\w+)/i);
  if (openMatch) {
    const side = openMatch[1].toLowerCase() as 'long' | 'short';
    const asset = normalizeAssetSymbol(openMatch[2]);

    return {
      kind: 'perp',
      action: side,
      amountUnit: 'USDC',
      targetAsset: asset,
      leverage: 10,
      rawParams: { ...rawParams, side, asset, leverage: 10 },
    };
  }

  // Standard long/short patterns - but skip if "on" is matched as asset
  const longMatch = text.match(INTENT_PATTERNS.perp.long);
  const shortMatch = text.match(INTENT_PATTERNS.perp.short);

  if (longMatch || shortMatch) {
    const match = longMatch || shortMatch;
    const side = longMatch ? 'long' : 'short';
    const potentialAsset = match![1];

    // Skip if matched word is a preposition (on, at, for, etc.)
    if (/^(on|at|for|to|in|with)$/i.test(potentialAsset)) {
      // Look for the actual asset after the preposition
      const afterPrep = text.match(new RegExp(`${potentialAsset}\\s+(\\w+)`, 'i'));
      if (afterPrep) {
        const asset = normalizeAssetSymbol(afterPrep[1]);
        const leverageMatch = text.match(INTENT_PATTERNS.perp.leverage);
        const leverage = leverageMatch ? parseInt(leverageMatch[1]) : 10;

        return {
          kind: 'perp',
          action: side,
          amountUnit: 'USDC',
          targetAsset: asset,
          leverage,
          rawParams: { ...rawParams, side, asset, leverage },
        };
      }
    } else {
      const asset = normalizeAssetSymbol(potentialAsset);
      const leverageMatch = text.match(INTENT_PATTERNS.perp.leverage);
      const leverage = leverageMatch ? parseInt(leverageMatch[1]) : 10;

      // Check for "with X" amount pattern - enhanced to handle $1k, etc.
      const amountMatch = text.match(/with\s+\$?([\d,]+(?:\.\d+)?)\s*([km])?/i);
      let amount: string | undefined;
      if (amountMatch) {
        const baseAmount = amountMatch[1].replace(/,/g, '');
        const suffix = amountMatch[2]?.toLowerCase();
        if (suffix === 'k') {
          amount = (parseFloat(baseAmount) * 1000).toString();
        } else if (suffix === 'm') {
          amount = (parseFloat(baseAmount) * 1000000).toString();
        } else {
          amount = baseAmount;
        }
      }

      return {
        kind: 'perp',
        action: side,
        amount,
        amountUnit: 'USDC',
        targetAsset: asset,
        leverage,
        rawParams: { ...rawParams, side, asset, leverage, amount },
      };
    }
  }

  // Additional perp patterns: "10x BTC long", "BTC 10x"
  // Try patterns in specific order with named logic

  // Pattern: "10x BTC" or "10x BTC long"
  let altPerpMatch = text.match(/(\d+)\s*x\s+(\w+)(?:\s+(long|short))?/i);
  if (altPerpMatch) {
    const leverage = parseInt(altPerpMatch[1]);
    const asset = normalizeAssetSymbol(altPerpMatch[2]);
    const side = (altPerpMatch[3]?.toLowerCase() as 'long' | 'short') || 'long';

    return {
      kind: 'perp',
      action: side,
      amountUnit: 'USDC',
      targetAsset: asset,
      leverage,
      rawParams: { ...rawParams, side, asset, leverage },
    };
  }

  // Pattern 2: "10x BTC" or "10x BTC long"
  altPerpMatch = text.match(/(\d+)\s*x\s+(\w+)(?:\s+(long|short))?/i);
  if (altPerpMatch) {
    const leverage = parseInt(altPerpMatch[1]);
    const asset = normalizeAssetSymbol(altPerpMatch[2]);
    const side = (altPerpMatch[3]?.toLowerCase() as 'long' | 'short') || 'long';

    return {
      kind: 'perp',
      action: side,
      amountUnit: 'USDC',
      targetAsset: asset,
      leverage,
      rawParams: { ...rawParams, side, asset, leverage },
    };
  }

  // Pattern 3: "BTC 10x" or "BTC 10x long"
  altPerpMatch = text.match(/(\w+)\s+(\d+)\s*x(?:\s+(long|short))?/i);
  if (altPerpMatch) {
    const asset = normalizeAssetSymbol(altPerpMatch[1]);
    const leverage = parseInt(altPerpMatch[2]);
    const side = (altPerpMatch[3]?.toLowerCase() as 'long' | 'short') || 'long';

    return {
      kind: 'perp',
      action: side,
      amountUnit: 'USDC',
      targetAsset: asset,
      leverage,
      rawParams: { ...rawParams, side, asset, leverage },
    };
  }

  return null;
}

/**
 * Try to parse swap intent with enhanced patterns
 */
function tryParseSwap(text: string, rawParams: Record<string, any>): ParsedIntent | null {
  // Standard swap patterns
  for (const [name, pattern] of Object.entries(INTENT_PATTERNS.swap)) {
    const match = text.match(pattern);
    if (match) {
      const amount = parseAmount(match[1]);
      const fromAsset = normalizeAssetSymbol(match[2]);
      const toAsset = normalizeAssetSymbol(match[3]);

      return {
        kind: 'swap',
        action: 'swap',
        amount,
        amountUnit: fromAsset,
        targetAsset: toAsset,
        rawParams: { ...rawParams, amount, fromAsset, toAsset },
      };
    }
  }

  // Enhanced swap patterns with $ amounts: "swap $100 USDC for ETH"
  const dollarSwapMatch = text.match(/(?:swap|convert|trade|exchange)\s+\$?([\d,]+(?:\.\d+)?)\s*([km])?\s*(\w+)\s+(?:to|for|into|->)\s+(\w+)/i);
  if (dollarSwapMatch) {
    let amount = dollarSwapMatch[1].replace(/,/g, '');
    const suffix = dollarSwapMatch[2]?.toLowerCase();
    if (suffix === 'k') amount = (parseFloat(amount) * 1000).toString();
    else if (suffix === 'm') amount = (parseFloat(amount) * 1000000).toString();

    const fromAsset = normalizeAssetSymbol(dollarSwapMatch[3]);
    const toAsset = normalizeAssetSymbol(dollarSwapMatch[4]);

    return {
      kind: 'swap',
      action: 'swap',
      amount,
      amountUnit: fromAsset,
      targetAsset: toAsset,
      rawParams: { ...rawParams, amount, fromAsset, toAsset },
    };
  }

  // "Buy X ETH" or "Sell X BTC" patterns
  const buyMatch = text.match(/buy\s+\$?([\d,]+(?:\.\d+)?)\s*([km])?\s*(?:of\s+)?(\w+)(?:\s+(?:with|using)\s+(\w+))?/i);
  if (buyMatch) {
    let amount = buyMatch[1].replace(/,/g, '');
    const suffix = buyMatch[2]?.toLowerCase();
    if (suffix === 'k') amount = (parseFloat(amount) * 1000).toString();
    else if (suffix === 'm') amount = (parseFloat(amount) * 1000000).toString();

    const targetAsset = normalizeAssetSymbol(buyMatch[3]);
    const fromAsset = buyMatch[4] ? normalizeAssetSymbol(buyMatch[4]) : 'USDC';

    return {
      kind: 'swap',
      action: 'swap',
      amount,
      amountUnit: fromAsset,
      targetAsset,
      rawParams: { ...rawParams, amount, fromAsset, targetAsset },
    };
  }

  // "Sell X ETH" patterns
  const sellMatch = text.match(/sell\s+\$?([\d,]+(?:\.\d+)?)\s*([km])?\s*(?:of\s+)?(\w+)(?:\s+(?:for|to)\s+(\w+))?/i);
  if (sellMatch) {
    let amount = sellMatch[1].replace(/,/g, '');
    const suffix = sellMatch[2]?.toLowerCase();
    if (suffix === 'k') amount = (parseFloat(amount) * 1000).toString();
    else if (suffix === 'm') amount = (parseFloat(amount) * 1000000).toString();

    const fromAsset = normalizeAssetSymbol(sellMatch[3]);
    const toAsset = sellMatch[4] ? normalizeAssetSymbol(sellMatch[4]) : 'USDC';

    return {
      kind: 'swap',
      action: 'swap',
      amount,
      amountUnit: fromAsset,
      targetAsset: toAsset,
      rawParams: { ...rawParams, amount, fromAsset, toAsset },
    };
  }

  // "Get some ETH" or "Get ETH" patterns
  const getMatch = text.match(/(?:get|acquire|obtain)\s+(?:some\s+)?(?:\$?([\d,]+(?:\.\d+)?)\s*([km])?\s*(?:of\s+)?)?(\w+)/i);
  if (getMatch) {
    let amount = '1000'; // Default
    if (getMatch[1]) {
      amount = getMatch[1].replace(/,/g, '');
      const suffix = getMatch[2]?.toLowerCase();
      if (suffix === 'k') amount = (parseFloat(amount) * 1000).toString();
      else if (suffix === 'm') amount = (parseFloat(amount) * 1000000).toString();
    }

    const targetAsset = normalizeAssetSymbol(getMatch[3]);
    // Don't treat "get" as swap if target is a venue like "vault" or "aave"
    if (!['VAULT', 'AAVE', 'COMPOUND', 'UNISWAP'].includes(targetAsset)) {
      return {
        kind: 'swap',
        action: 'swap',
        amount,
        amountUnit: 'USDC',
        targetAsset,
        rawParams: { ...rawParams, amount, fromAsset: 'USDC', targetAsset },
      };
    }
  }

  return null;
}

/**
 * Try to parse deposit intent with enhanced patterns
 */
function tryParseDeposit(text: string, rawParams: Record<string, any>): ParsedIntent | null {
  // Standard deposit patterns
  for (const [name, pattern] of Object.entries(INTENT_PATTERNS.deposit)) {
    const match = text.match(pattern);
    if (match) {
      const amount = parseAmount(match[1]);
      const asset = normalizeAssetSymbol(match[2]);
      const venue = match[3]?.toLowerCase() || 'vault';

      return {
        kind: 'deposit',
        action: 'deposit',
        amount,
        amountUnit: asset,
        venue,
        rawParams: { ...rawParams, amount, asset, venue },
      };
    }
  }

  // Enhanced patterns: "put $1000 in aave", "stake 500 USDC"
  const putMatch = text.match(/(?:put|place|stake|add)\s+\$?([\d,]+(?:\.\d+)?)\s*([km])?\s*(\w+)?\s+(?:in|into|to|on)\s+(\w+)/i);
  if (putMatch) {
    let amount = putMatch[1].replace(/,/g, '');
    const suffix = putMatch[2]?.toLowerCase();
    if (suffix === 'k') amount = (parseFloat(amount) * 1000).toString();
    else if (suffix === 'm') amount = (parseFloat(amount) * 1000000).toString();

    const asset = putMatch[3] ? normalizeAssetSymbol(putMatch[3]) : 'USDC';
    const venue = putMatch[4].toLowerCase();

    return {
      kind: 'deposit',
      action: 'deposit',
      amount,
      amountUnit: asset,
      venue,
      rawParams: { ...rawParams, amount, asset, venue },
    };
  }

  return null;
}

/**
 * Try to parse bridge intent with enhanced patterns (Phase 2 Enhanced)
 * Now supports:
 * - Explicit chain specification: "bridge SOL from solana to ethereum"
 * - Asset-based chain inference: "send SOL to ethereum" (infers solana as source)
 * - Same-chain warning detection
 */
function tryParseBridge(text: string, rawParams: Record<string, any>): ParsedIntent | null {
  // Standard bridge patterns with explicit chains
  for (const [name, pattern] of Object.entries(INTENT_PATTERNS.bridge)) {
    const match = text.match(pattern);
    if (match) {
      const amount = parseAmount(match[1]);
      const asset = normalizeAssetSymbol(match[2]);
      let sourceChain = normalizeChainName(match[3]);
      let destChain = normalizeChainName(match[4]);

      // Phase 2: Infer source chain from asset if not specified
      if (!sourceChain || sourceChain === 'undefined') {
        const inferredSource = inferChainFromAsset(asset);
        sourceChain = inferredSource || 'ethereum';
      }

      // Validate: warn if source === dest
      const warnings: string[] = [];
      if (sourceChain === destChain) {
        warnings.push(`Source and destination chains are the same (${sourceChain}). This is not a cross-chain bridge.`);
      }

      return {
        kind: 'bridge',
        action: 'bridge',
        amount,
        amountUnit: asset,
        sourceChain,
        destChain,
        rawParams: { ...rawParams, amount, asset, sourceChain, destChain, warnings },
      };
    }
  }

  // Enhanced patterns: "move USDC to solana", "send ETH from ethereum to arbitrum"
  const moveMatch = text.match(/(?:move|send|port)\s+\$?([\d,]+(?:\.\d+)?)\s*([km])?\s*(\w+)\s+(?:from\s+)?(\w+)?\s*to\s+(\w+)/i);
  if (moveMatch && (moveMatch[4] || isChainName(moveMatch[5]))) {
    let amount = moveMatch[1] ? moveMatch[1].replace(/,/g, '') : '1000';
    const suffix = moveMatch[2]?.toLowerCase();
    if (suffix === 'k') amount = (parseFloat(amount) * 1000).toString();
    else if (suffix === 'm') amount = (parseFloat(amount) * 1000000).toString();

    const asset = normalizeAssetSymbol(moveMatch[3]);

    // Phase 2: Smart chain inference
    let sourceChain: string;
    if (moveMatch[4]) {
      sourceChain = normalizeChainName(moveMatch[4]);
    } else {
      // Infer source from asset
      const inferred = inferChainFromAsset(asset);
      sourceChain = inferred || 'ethereum';
    }

    const destChain = normalizeChainName(moveMatch[5]);

    // Validate: warn if source === dest
    const warnings: string[] = [];
    if (sourceChain === destChain) {
      warnings.push(`Source and destination chains are the same (${sourceChain}). This is not a cross-chain bridge.`);
    }

    if (isChainName(destChain)) {
      return {
        kind: 'bridge',
        action: 'bridge',
        amount,
        amountUnit: asset,
        sourceChain,
        destChain,
        rawParams: { ...rawParams, amount, asset, sourceChain, destChain, warnings },
      };
    }
  }

  // New pattern: "send SOL to ethereum" (no source chain, infer from asset)
  const simpleToChainMatch = text.match(/(?:send|bridge|move)\s+(?:\$?([\d,]+(?:\.\d+)?)\s*([km])?\s*)?(\w+)\s+to\s+(\w+)/i);
  if (simpleToChainMatch && isChainName(simpleToChainMatch[4])) {
    let amount = '1000';
    if (simpleToChainMatch[1]) {
      amount = simpleToChainMatch[1].replace(/,/g, '');
      const suffix = simpleToChainMatch[2]?.toLowerCase();
      if (suffix === 'k') amount = (parseFloat(amount) * 1000).toString();
      else if (suffix === 'm') amount = (parseFloat(amount) * 1000000).toString();
    }

    const asset = normalizeAssetSymbol(simpleToChainMatch[3]);
    const destChain = normalizeChainName(simpleToChainMatch[4]);

    // Infer source chain from asset
    const inferredSource = inferChainFromAsset(asset);
    const sourceChain = inferredSource || 'ethereum';

    // Validate: warn if source === dest
    const warnings: string[] = [];
    if (sourceChain === destChain) {
      warnings.push(`Source and destination chains are the same (${sourceChain}). This is not a cross-chain bridge.`);
    }

    return {
      kind: 'bridge',
      action: 'bridge',
      amount,
      amountUnit: asset,
      sourceChain,
      destChain,
      rawParams: { ...rawParams, amount, asset, sourceChain, destChain, inferredSourceChain: inferredSource, warnings },
    };
  }

  return null;
}

/**
 * Expanded chain aliases for cross-chain detection (Phase 2)
 */
const CHAIN_ALIASES: Record<string, string> = {
  // Ethereum variants
  'eth': 'ethereum',
  'ether': 'ethereum',
  'mainnet': 'ethereum',
  'sepolia': 'ethereum', // Testnet maps to ethereum
  'goerli': 'ethereum',

  // Solana variants
  'sol': 'solana',
  'devnet': 'solana', // Testnet maps to solana

  // L2s
  'arb': 'arbitrum',
  'arb-one': 'arbitrum',
  'arbitrum-one': 'arbitrum',
  'op': 'optimism',
  'op-mainnet': 'optimism',
  'optimism-mainnet': 'optimism',
  'base': 'base',
  'l2': 'arbitrum', // Default L2 for ambiguous references

  // Other chains
  'bnb': 'bsc',
  'binance': 'bsc',
  'bsc': 'bsc',
  'matic': 'polygon',
  'poly': 'polygon',
  'polygon': 'polygon',
  'avax': 'avalanche',
  'avalanche': 'avalanche',

  // Hyperliquid
  'hl': 'hyperliquid',
  'hyperliquid': 'hyperliquid',
  'hyperliquid_testnet': 'hyperliquid',
  'hyper': 'hyperliquid',
};

/**
 * Asset-to-chain defaults for native asset inference (Phase 2)
 * Used when chain is not explicitly specified to infer from asset
 */
const ASSET_CHAIN_DEFAULTS: Record<string, string> = {
  // Solana native assets
  'SOL': 'solana',
  'WSOL': 'solana',
  'BONK': 'solana',
  'JTO': 'solana',
  'WIF': 'solana',
  'PYTH': 'solana',
  'JUP': 'solana',
  'ORCA': 'solana',
  'RAY': 'solana',
  'MNGO': 'solana',
  'MSOL': 'solana',
  'JITOSOL': 'solana',

  // Ethereum native assets
  'ETH': 'ethereum',
  'WETH': 'ethereum',
  'STETH': 'ethereum',
  'RETH': 'ethereum',
  'CBETH': 'ethereum',
  'LDO': 'ethereum',
  'RPL': 'ethereum',
  'ENS': 'ethereum',

  // Chain-specific tokens
  'MATIC': 'polygon',
  'AVAX': 'avalanche',
  'OP': 'optimism',
  'ARB': 'arbitrum',
  'BNB': 'bsc',
  'CAKE': 'bsc',

  // Stablecoins are multi-chain, no default
  // 'USDC', 'USDT', 'DAI' - intentionally omitted
};

/**
 * Infer chain from asset symbol
 * Returns undefined if asset is multi-chain (e.g., USDC) or unknown
 */
export function inferChainFromAsset(asset: string): string | undefined {
  if (!asset) return undefined;
  const normalized = asset.toUpperCase().trim();
  return ASSET_CHAIN_DEFAULTS[normalized];
}

/**
 * Normalize chain name with common variations
 */
function normalizeChainName(chain: string): string {
  const normalized = chain.toLowerCase().trim();
  return CHAIN_ALIASES[normalized] || normalized;
}

/**
 * Check if a string is a known chain name
 */
function isChainName(str: string): boolean {
  const chains = [
    'ethereum', 'eth', 'solana', 'sol', 'arbitrum', 'arb', 'optimism', 'op',
    'base', 'polygon', 'matic', 'avalanche', 'avax', 'bsc', 'bnb',
    'sepolia', 'devnet', 'goerli', 'arb-one', 'op-mainnet', 'l2',
    'hyperliquid', 'hl', 'hyper',
  ];
  return chains.includes(str.toLowerCase());
}

/**
 * Try to parse analytics intents
 */
function tryParseAnalytics(text: string, rawParams: Record<string, any>): ParsedIntent | null {
  // Check for analytics intents (exposure, risk, top protocols, etc.)
  if (INTENT_PATTERNS.analytics.exposure.test(text) ||
      INTENT_PATTERNS.analytics.risk.test(text)) {
    return {
      kind: 'unknown',
      action: 'analytics_exposure',
      rawParams: { ...rawParams, intentType: 'analytics', analyticsType: 'exposure' },
    };
  }

  if (INTENT_PATTERNS.analytics.topProtocols.test(text)) {
    return {
      kind: 'unknown',
      action: 'analytics_protocols',
      rawParams: { ...rawParams, intentType: 'analytics', analyticsType: 'top_protocols' },
    };
  }

  if (INTENT_PATTERNS.analytics.topMarkets.test(text)) {
    return {
      kind: 'unknown',
      action: 'analytics_markets',
      rawParams: { ...rawParams, intentType: 'analytics', analyticsType: 'top_markets' },
    };
  }

  return null;
}

/**
 * Try to infer intent from keywords when standard patterns fail
 * This provides graceful fallbacks for ambiguous intents
 */
function tryInferIntent(text: string, rawParams: Record<string, any>): ParsedIntent | null {
  // Extract any amount mentioned
  const amountMatch = text.match(/\$?([\d,]+(?:\.\d+)?)\s*([km])?/i);
  let amount = '1000';
  if (amountMatch) {
    amount = amountMatch[1].replace(/,/g, '');
    const suffix = amountMatch[2]?.toLowerCase();
    if (suffix === 'k') amount = (parseFloat(amount) * 1000).toString();
    else if (suffix === 'm') amount = (parseFloat(amount) * 1000000).toString();
  }

  // Extract any asset mentioned
  const words = text.split(/\s+/);
  let detectedAsset: string | null = null;
  const COMMON_ASSETS = ['eth', 'btc', 'sol', 'usdc', 'usdt', 'weth', 'wbtc', 'dai', 'link', 'uni', 'aave'];

  for (const word of words) {
    const cleaned = word.toLowerCase().replace(/[^a-z]/g, '');
    if (COMMON_ASSETS.includes(cleaned) || ASSET_ALIASES[cleaned.toUpperCase()]) {
      detectedAsset = normalizeAssetSymbol(cleaned);
      break;
    }
  }

  // Infer intent based on keywords
  const hasLongShort = /\b(long|short)\b/i.test(text);
  const hasSwapWords = /\b(swap|convert|trade|exchange|buy|sell|get)\b/i.test(text);
  const hasDepositWords = /\b(deposit|supply|lend|stake|put|add)\b/i.test(text);
  const hasBridgeWords = /\b(bridge|move|port|cross-chain|crosschain)\b/i.test(text);
  const hasLeverageWords = /\b(\d+\s*x|leverage|leveraged|margin)\b/i.test(text);

  // Perp intent: has long/short or leverage keywords with an asset
  if ((hasLongShort || hasLeverageWords) && detectedAsset) {
    const side = /\bshort\b/i.test(text) ? 'short' : 'long';
    const leverageMatch = text.match(/(\d+)\s*x/i);
    const leverage = leverageMatch ? parseInt(leverageMatch[1]) : 10;

    return {
      kind: 'perp',
      action: side,
      amount,
      amountUnit: 'USDC',
      targetAsset: detectedAsset,
      leverage,
      rawParams: { ...rawParams, inferred: true, side, asset: detectedAsset, leverage },
    };
  }

  // Swap intent: has swap-like words with an asset
  if (hasSwapWords && detectedAsset) {
    // Determine if buying or selling
    const isSelling = /\bsell\b/i.test(text);
    const fromAsset = isSelling ? detectedAsset : 'USDC';
    const toAsset = isSelling ? 'USDC' : detectedAsset;

    return {
      kind: 'swap',
      action: 'swap',
      amount,
      amountUnit: fromAsset,
      targetAsset: toAsset,
      rawParams: { ...rawParams, inferred: true, fromAsset, toAsset },
    };
  }

  // Deposit intent: has deposit-like words
  if (hasDepositWords) {
    const asset = detectedAsset || 'USDC';

    // Try to find venue
    let venue = 'vault';
    const venueMatch = text.match(/(?:to|into|in|on)\s+(\w+)/i);
    if (venueMatch) {
      const potentialVenue = venueMatch[1].toLowerCase();
      if (['vault', 'aave', 'compound', 'kamino', 'drift'].includes(potentialVenue)) {
        venue = potentialVenue;
      }
    }

    return {
      kind: 'deposit',
      action: 'deposit',
      amount,
      amountUnit: asset,
      venue,
      rawParams: { ...rawParams, inferred: true, asset, venue },
    };
  }

  // Bridge intent: has bridge-like words
  if (hasBridgeWords && detectedAsset) {
    return {
      kind: 'bridge',
      action: 'bridge',
      amount,
      amountUnit: detectedAsset,
      sourceChain: 'ethereum',
      destChain: 'solana',
      rawParams: { ...rawParams, inferred: true, asset: detectedAsset },
    };
  }

  // No inference possible
  return null;
}

/**
 * Determine execution route for a parsed intent
 */
export function routeIntent(
  parsed: ParsedIntent,
  preferredChain?: ChainTarget
): RouteDecision | { error: { stage: IntentFailureStage; code: string; message: string } } {
  const { kind, venue, sourceChain, destChain, rawParams } = parsed;

  // Determine target chain
  const normalizedRawChain = rawParams?.chain ? normalizeChainName(rawParams.chain) : undefined;
  const normalizedVenue = typeof venue === 'string' ? venue.toLowerCase() : undefined;
  const wantsHyperliquid =
    normalizedRawChain === 'hyperliquid' ||
    normalizedVenue === 'hyperliquid' ||
    rawParams?.venue === 'hyperliquid' ||
    kind === 'perp_create';

  let targetChain: 'ethereum' | 'solana' | 'hyperliquid' = 'ethereum';
  if (preferredChain === 'hyperliquid' || wantsHyperliquid) {
    targetChain = 'hyperliquid';
  } else if (preferredChain === 'solana') {
    targetChain = 'solana';
  } else if (kind === 'bridge') {
    // Bridge: source chain determines where we start
    const normalizedSource = sourceChain ? normalizeChainName(sourceChain) : undefined;
    if (normalizedSource === 'hyperliquid') {
      targetChain = 'hyperliquid';
    } else if (normalizedSource === 'solana') {
      targetChain = 'solana';
    }
  }

  const network =
    targetChain === 'ethereum'
      ? 'sepolia'
      : targetChain === 'solana'
        ? 'devnet'
        : 'hyperliquid_testnet';

  // Handle special intent types that need specific integrations

  // Hedge intent requires portfolio state
  if (rawParams?.intentType === 'hedge') {
    // For now, we don't have portfolio state ingestion
    // Route to proof_only with clear messaging
    return {
      chain: targetChain,
      network,
      venue: 'native',
      executionType: 'proof_only',
      warnings: [
        'PROOF_ONLY: Hedge intent requires portfolio state integration.',
        'Portfolio ingestion not yet implemented - recording intent proof on-chain.',
      ],
    };
  }

  // Event/prediction market intent requires market data
  if (rawParams?.intentType === 'event' || rawParams?.intentType === 'prediction' || kind === 'event') {
    // For now, we don't have prediction market data source integrated
    return {
      chain: targetChain,
      network,
      venue: 'native',
      executionType: 'proof_only',
      warnings: [
        'PROOF_ONLY: Event/prediction market intent requires market data integration.',
        'Polymarket/prediction data source not yet integrated - recording intent proof on-chain.',
      ],
    };
  }

  // Vault discovery intent requires yield ranking
  if (rawParams?.intentType === 'vault_discovery') {
    // For now, we don't have yield ranking integrated
    return {
      chain: targetChain,
      network,
      venue: 'native',
      executionType: 'proof_only',
      warnings: [
        'PROOF_ONLY: Vault discovery requires yield ranking integration.',
        'DefiLlama/yield sources not yet integrated - recording intent proof on-chain.',
        `Target yield: ${rawParams.targetYield || 'not specified'}%`,
      ],
    };
  }

  // Analytics intent - offchain analysis, recorded to ledger without proof tx
  if (rawParams?.intentType === 'analytics') {
    return {
      chain: targetChain,
      network,
      venue: 'offchain',
      executionType: 'offchain' as any, // Special handling for analytics
      warnings: [
        'OFFCHAIN: Analytics intent - no on-chain action required.',
        `Analysis type: ${rawParams.analyticsType || 'general'}`,
      ],
    };
  }

  // Check venue implementation
  const implementedVenues = IMPLEMENTED_VENUES[targetChain][kind] || [];

  // Handle HIP-3 perp market creation (Hyperliquid)
  if (kind === 'perp_create') {
    const hyperliquidEnabled = process.env.HYPERLIQUID_ENABLED === 'true';

    if (!hyperliquidEnabled) {
      return {
        chain: 'hyperliquid',
        network: 'hyperliquid_testnet',
        venue: 'hip3',
        executionType: 'proof_only',
        warnings: [
          'PROOF_ONLY: Hyperliquid testnet is not enabled. Set HYPERLIQUID_ENABLED=true for real execution.',
          'HIP-3 market creation requires Hyperliquid testnet configuration.',
        ],
      };
    }

    return {
      chain: 'hyperliquid',
      network: 'hyperliquid_testnet',
      venue: 'hip3',
      executionType: 'proof_only',
      warnings: [
        'PROOF_ONLY: HIP-3 market creation execution is not wired to on-chain submission yet.',
        'Provide Hyperliquid RegisterAsset2 contract details to enable real execution.',
      ],
    };
  }

  // Handle perp intents
  if (kind === 'perp') {
    const requestedVenue = venue?.toLowerCase();

    // If they request a specific venue like drift/hl, fail clearly
    if (requestedVenue && ['drift', 'dydx'].includes(requestedVenue)) {
      return {
        error: {
          stage: 'route',
          code: 'VENUE_NOT_IMPLEMENTED',
          message: `Perp venue "${requestedVenue}" is not yet integrated. Recording as proof-only.`,
        },
      };
    }

    if (requestedVenue && ['hl', 'hyperliquid'].includes(requestedVenue)) {
      return {
        chain: 'hyperliquid',
        network: 'hyperliquid_testnet',
        venue: 'hyperliquid',
        executionType: 'proof_only',
        warnings: [
          'PROOF_ONLY: Hyperliquid perp execution not yet wired to on-chain submission.',
          'Provide Hyperliquid execution API/contract details to enable real execution.',
        ],
      };
    }

    if (targetChain === 'hyperliquid') {
      return {
        chain: 'hyperliquid',
        network: 'hyperliquid_testnet',
        venue: 'hyperliquid',
        executionType: 'proof_only',
        warnings: [
          'PROOF_ONLY: Hyperliquid perp execution not yet wired to on-chain submission.',
          'Provide Hyperliquid execution API/contract details to enable real execution.',
        ],
      };
    }

    // Check if demo perp adapter is configured for real execution
    // Use config import which has fallback defaults
    if (DEMO_PERP_ADAPTER_ADDRESS && targetChain === 'ethereum') {
      // Real execution via DemoPerpAdapter on Sepolia
      return {
        chain: 'ethereum',
        network: 'sepolia',
        venue: 'demo_perp',
        adapter: DEMO_PERP_ADAPTER_ADDRESS,
        executionType: 'real',
      };
    }

    // If no adapter configured, use proof_only mode since we can't execute without the adapter
    if (targetChain === 'ethereum') {
      return {
        chain: 'ethereum',
        network: 'sepolia',
        venue: 'demo_perp',
        executionType: 'proof_only',
        warnings: ['PROOF_ONLY: DEMO_PERP_ADAPTER_ADDRESS not configured. Set this env var for real perp execution.'],
      };
    }

    // Non-Ethereum chains get proof_only with explanation
    return {
      chain: targetChain,
      network,
      venue: 'demo_perp',
      executionType: 'proof_only',
      warnings: [`PROOF_ONLY: Perp execution on ${targetChain} not yet available. Recording intent proof on-chain.`],
    };
  }

  // Handle bridge intents
  if (kind === 'bridge') {
    if (targetChain === 'hyperliquid') {
      return {
        chain: 'hyperliquid',
        network: 'hyperliquid_testnet',
        venue: 'bridge_proof',
        executionType: 'proof_only',
        warnings: ['PROOF_ONLY: Hyperliquid bridging not implemented. Recording intent proof on-chain.'],
      };
    }

    // Check if bridging between different chains
    if (sourceChain && destChain && sourceChain !== destChain) {
      // Bridge is quote-only for now
      return {
        chain: targetChain,
        network,
        venue: 'lifi',
        executionType: 'proof_only',
        warnings: ['Bridge execution not fully implemented. Will attempt LiFi quote.'],
      };
    }
  }

  // Handle deposit intents
  if (kind === 'deposit') {
    const requestedVenue = venue?.toLowerCase();

    if (targetChain === 'hyperliquid') {
      return {
        chain: 'hyperliquid',
        network: 'hyperliquid_testnet',
        venue: 'hyperliquid',
        executionType: 'proof_only',
        warnings: [
          'PROOF_ONLY: Hyperliquid vault integration not yet implemented.',
          'Provide Hyperliquid vault adapter details to enable real deposits.',
        ],
      };
    }

    // Check for unimplemented venues - route to proof_only instead of failing
    if (requestedVenue && ['kamino', 'drift'].includes(requestedVenue)) {
      return {
        chain: targetChain,
        network,
        venue: requestedVenue,
        executionType: 'proof_only',
        warnings: [
          `PROOF_ONLY: Deposit venue "${requestedVenue}" is not yet integrated.`,
          'Recording intent proof on-chain.',
        ],
      };
    }

    // Route to appropriate venue
    if (requestedVenue === 'aave' && targetChain === 'ethereum') {
      return {
        chain: 'ethereum',
        network: 'sepolia',
        venue: 'aave',
        executionType: 'real',
      };
    }

    // Default to demo vault - Solana goes to proof_only for now
    if (targetChain === 'solana') {
      return {
        chain: 'solana',
        network: 'devnet',
        venue: 'solana_vault',
        executionType: 'proof_only',
        warnings: ['PROOF_ONLY: Solana vault integration pending. Recording intent proof on-chain.'],
      };
    }

    return {
      chain: targetChain,
      network,
      venue: 'demo_vault',
      executionType: 'real',
    };
  }

  // Handle swap intents
  if (kind === 'swap') {
    // Check if Solana executor is configured for real swaps
    const solanaPrivateKey = process.env.SOLANA_PRIVATE_KEY;

    if (targetChain === 'hyperliquid') {
      return {
        chain: 'hyperliquid',
        network: 'hyperliquid_testnet',
        venue: 'hyperliquid',
        executionType: 'proof_only',
        warnings: [
          'PROOF_ONLY: Hyperliquid swap routing not implemented.',
        ],
      };
    }

    if (targetChain === 'solana') {
      // Enable real Solana swaps if private key is configured
      if (solanaPrivateKey) {
        return {
          chain: 'solana',
          network: 'devnet',
          venue: 'jupiter', // Use Jupiter for real swaps
          executionType: 'real',
          warnings: ['Solana swap via Jupiter on devnet.'],
        };
      }

      // Fallback to proof_only if not configured
      return {
        chain: 'solana',
        network: 'devnet',
        venue: 'demo_dex',
        executionType: 'proof_only',
        warnings: ['PROOF_ONLY: SOLANA_PRIVATE_KEY not configured. Set this env var for real Solana swaps.'],
      };
    }

    return {
      chain: targetChain,
      network,
      venue: 'demo_dex',
      executionType: 'real',
    };
  }

  // Unknown/proof
  return {
    chain: targetChain,
    network,
    venue: 'native',
    executionType: 'proof_only',
    warnings: ['Intent not recognized. Recording proof-of-execution only.'],
  };
}

/**
 * Estimate USD value for an intent
 */
function estimateIntentUsd(parsed: ParsedIntent): number | undefined {
  const amount = parsed.amount ? parseFloat(parsed.amount) : undefined;
  if (!amount) return undefined;

  const unit = parsed.amountUnit?.toUpperCase();

  // Simple price estimates (for testnet)
  const prices: Record<string, number> = {
    REDACTED: 1,
    USDT: 1,
    DAI: 1,
    ETH: 2000,
    WETH: 2000,
    SOL: 100,
    BTC: 45000,
  };

  return amount * (prices[unit || ''] || 1);
}

/**
 * Run a single intent through the full pipeline
 *
 * Options:
 * - chain: Target chain (ethereum, solana, both)
 * - planOnly: Stop after routing, return plan without executing (for confirm mode)
 * - intentId: Execute a previously planned intent (skip parse/route)
 */
export async function runIntent(
  intentText: string,
  options: {
    chain?: ChainTarget;
    planOnly?: boolean;
    intentId?: string;  // For executing a previously planned intent
    dryRun?: boolean;   // Legacy, use planOnly instead
    metadata?: Record<string, any>;  // Caller-provided metadata (e.g., torture_suite tagging)
    sessionId?: string; // Session ID for state machine context
    skipPathValidation?: boolean; // Skip path validation (for internal use only)
    confirmedIntentId?: string; // Intent ID that has been confirmed by user
  } = {}
): Promise<IntentExecutionResult> {
  // Dynamic imports for ledger (avoids path issues)
  // Use async versions for Postgres support
  const {
    createIntentAsync: createIntent,
    updateIntentStatusAsync: updateIntentStatus,
    createExecutionAsync: createExecution,
    updateExecutionAsync: updateExecution,
    createExecutionStepAsync: createExecutionStep,
    updateExecutionStepAsync: updateExecutionStep,
    linkExecutionToIntentAsync: linkExecutionToIntent,
  } = await import('../../execution-ledger/db');

  const now = Math.floor(Date.now() / 1000);

  // Step 0.5: Sanitize input for security
  const { sanitized: sanitizedText, warnings: sanitizationWarnings } = sanitizeIntentInput(intentText);

  // If injection attempt detected, log alert
  if (sanitizationWarnings.some(w => w.includes('injection'))) {
    alertInjectionAttempt({
      sessionId: options.sessionId,
      input: intentText.substring(0, 100),
      injectionType: sanitizationWarnings.find(w => w.includes('injection')) || 'unknown',
      blocked: true,
    });
  }

  // Step 1: Parse intent (using sanitized input)
  const parsed = parseIntent(sanitizedText);
  const usdEstimate = estimateIntentUsd(parsed);

  // Step 1.5: State Machine - Classify intent path and validate transition
  const sessionId = options.sessionId || 'default';
  const intentPath = classifyParsedIntentPath(parsed);

  logTransition(sessionId, 'INTENT_PARSED', {
    kind: parsed.kind,
    action: parsed.action,
    classifiedPath: intentPath,
    usdEstimate,
  });

  // Check path policy unless explicitly skipped or intent is already confirmed
  if (!options.skipPathValidation && !options.confirmedIntentId) {
    const pathPolicy = evaluatePathPolicy(sessionId, intentPath, {
      parsed,
      usdEstimate,
    });

    if (!pathPolicy.allowed) {
      // If confirmation is required, return without executing
      if (pathPolicy.requiresConfirmation) {
        // Transition to CONFIRMING state
        const { context, transitionResult } = transitionPath(sessionId, intentPath, {
          parsed,
          usdEstimate,
        });

        logTransition(sessionId, 'CONFIRMATION_REQUIRED', {
          confirmationType: pathPolicy.confirmationType,
          currentPath: context.currentPath,
          targetPath: intentPath,
        });

        // Return a special response indicating confirmation is needed
        // The caller (http.ts) should handle this and prompt the user
        return {
          ok: false,
          intentId: '', // No intent created yet
          status: 'pending_confirmation',
          error: {
            stage: 'route' as IntentFailureStage,
            code: 'CONFIRMATION_REQUIRED',
            message: pathPolicy.message || 'This action requires explicit confirmation.',
          },
          metadata: {
            requiresConfirmation: true,
            confirmationType: pathPolicy.confirmationType,
            pendingIntent: {
              kind: parsed.kind,
              action: parsed.action,
              amount: parsed.amount,
              amountUnit: parsed.amountUnit,
              targetAsset: parsed.targetAsset,
              leverage: parsed.leverage,
            },
            intentPath,
            usdEstimate,
          },
        };
      }

      // Path not allowed and no confirmation option
      // Record violation for security monitoring
      const context = getContext(sessionId);
      recordPathViolation({
        sessionId,
        currentPath: context.currentPath,
        attemptedPath: intentPath,
        input: params.text.substring(0, 100),
        blocked: true,
        reason: pathPolicy.message || 'Path transition blocked',
      });

      // Create security alert
      alertPathViolation({
        sessionId,
        currentPath: context.currentPath,
        attemptedPath: intentPath,
        input: params.text.substring(0, 100),
        blocked: true,
      });

      return {
        ok: false,
        intentId: '',
        status: 'failed',
        error: {
          stage: 'route' as IntentFailureStage,
          code: pathPolicy.code || 'PATH_NOT_ALLOWED',
          message: pathPolicy.message || 'This action is not allowed from the current context.',
        },
      };
    }
  }

  // Update context with successful path transition
  if (options.sessionId) {
    transitionPath(sessionId, intentPath, {
      parsed,
      usdEstimate,
      force: !!options.confirmedIntentId, // Force transition if already confirmed
    });
  }

  // Merge caller-provided metadata with internal metadata
  // callerMeta is preserved and passed through ALL status updates
  const callerMeta = options.metadata || {};

  // Helper to build metadata JSON that preserves caller metadata
  const buildMetadata = (extra: Record<string, any> = {}) => JSON.stringify({
    ...callerMeta,  // Always include caller metadata (source, domain, runId, etc.)
    parsed,
    ...extra,
  });

  // Step 2: Create intent record
  const intent = await createIntent({
    intentText,
    intentKind: parsed.kind,
    requestedVenue: parsed.venue,
    usdEstimate,
    metadataJson: buildMetadata({ options: { ...options, metadata: undefined } }),
  });

  try {
    // Step 3: Route intent
    await updateIntentStatus(intent.id, {
      status: 'planned',
      plannedAt: now,
      metadataJson: buildMetadata({ options: { ...options, metadata: undefined } }),
    });

    const route = routeIntent(parsed, options.chain);

    // Check for routing error
    if ('error' in route) {
      await updateIntentStatus(intent.id, {
        status: 'failed',
        failureStage: route.error.stage,
        errorCode: route.error.code,
        errorMessage: route.error.message,
      });

      return {
        ok: false,
        intentId: intent.id,
        status: 'failed',
        error: route.error,
      };
    }

    await updateIntentStatus(intent.id, {
      status: 'routed',
      requestedChain: route.chain,
      requestedVenue: route.venue,
      metadataJson: buildMetadata({ route, options: { ...options, metadata: undefined } }),
    });

    // ERC-8004: Validate action against declared capabilities
    try {
      const { ERC8004_ENABLED, ERC8004_REQUIRE_VALIDATION } = await import('../erc8004/config.js');

      if (ERC8004_ENABLED && ERC8004_REQUIRE_VALIDATION) {
        const { validateActionAgainstCapabilities } = await import('../erc8004/validationRegistry.js');

        const validationResult = validateActionAgainstCapabilities({
          kind: parsed.kind as any,
          chain: route.chain,
          venue: route.venue,
          asset: parsed.targetAsset,
          amountUsd: usdEstimate,
        });

        if (!validationResult.valid) {
          const errorMsg = `ERC-8004 capability validation failed: ${validationResult.errors?.join('; ')}`;
          console.warn(`[erc8004] ${errorMsg}`);

          await updateIntentStatus(intent.id, {
            status: 'failed',
            failureStage: 'route',
            errorCode: 'ERC8004_VALIDATION_FAILED',
            errorMessage: errorMsg,
          });

          return {
            ok: false,
            intentId: intent.id,
            status: 'failed',
            error: {
              code: 'ERC8004_VALIDATION_FAILED',
              stage: 'route',
              message: errorMsg,
            },
          };
        }

        // Log warnings but continue
        if (validationResult.warnings && validationResult.warnings.length > 0) {
          console.warn(`[erc8004] Validation warnings: ${validationResult.warnings.join('; ')}`);
        }
      }
    } catch (validationError) {
      // Don't fail on validation errors if validation is optional
      console.warn(`[erc8004] Capability validation error (non-blocking): ${validationError}`);
    }

    // Step 4: Handle bridge intents with LiFi
    if (parsed.kind === 'bridge' && route.venue === 'lifi') {
      const bridgeResult = await handleBridgeIntent(intent.id, parsed, route);
      return bridgeResult;
    }

    // Step 5: Execute based on chain and type
    await updateIntentStatus(intent.id, {
      status: 'executing',
      executedAt: now,
    });

    // For planOnly mode (confirm flow), stop after routing and return plan
    if (options.planOnly || options.dryRun) {
      await updateIntentStatus(intent.id, {
        status: 'planned',
        plannedAt: now,
        metadataJson: buildMetadata({
          route,
          planOnly: true,
          executedKind: route.executionType,
        }),
      });

      return {
        ok: true,
        intentId: intent.id,
        status: 'planned',
        metadata: {
          planOnly: true,
          executedKind: route.executionType,
          parsed: {
            kind: parsed.kind,
            action: parsed.action,
            amount: parsed.amount,
            amountUnit: parsed.amountUnit,
            targetAsset: parsed.targetAsset,
            leverage: parsed.leverage,
          },
          route: {
            chain: route.chain,
            network: route.network,
            venue: route.venue,
            executionType: route.executionType,
            warnings: route.warnings,
          },
        },
      };
    }

    // Execute on appropriate chain
    const execResult = await executeOnChain(intent.id, parsed, route);

    // State Machine: Mark execution complete
    if (options.sessionId) {
      markExecutionComplete(options.sessionId, execResult.ok);
      logTransition(options.sessionId, execResult.ok ? 'EXECUTION_SUCCESS' : 'EXECUTION_FAILED', {
        intentId: intent.id,
        txHash: execResult.txHash,
      });
    }

    return execResult;

  } catch (error: any) {
    // State Machine: Mark execution failed
    if (options.sessionId) {
      markExecutionComplete(options.sessionId, false);
      logTransition(options.sessionId, 'EXECUTION_ERROR', {
        intentId: intent.id,
        error: error.message,
      });
    }

    // Catch-all error handler
    await updateIntentStatus(intent.id, {
      status: 'failed',
      failureStage: 'execute',
      errorCode: 'EXECUTION_ERROR',
      errorMessage: error.message?.slice(0, 500),
    });

    return {
      ok: false,
      intentId: intent.id,
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'EXECUTION_ERROR',
        message: error.message,
      },
    };
  }
}

/**
 * Execute a previously planned intent by ID
 * Used for confirm-mode flow where user reviews plan first
 */
export async function executeIntentById(
  intentId: string
): Promise<IntentExecutionResult> {
  // CRITICAL: Use async versions that support Postgres in production
  const {
    getIntentAsync,
    updateIntentStatusAsync: updateIntentStatus,
  } = await import('../../execution-ledger/db');

  const now = Math.floor(Date.now() / 1000);

  // Get the intent (use async for Postgres support)
  const intent = await getIntentAsync(intentId);
  if (!intent) {
    return {
      ok: false,
      intentId,
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'INTENT_NOT_FOUND',
        message: `Intent ${intentId} not found`,
      },
    };
  }

  // Verify intent is in planned status
  if (intent.status !== 'planned') {
    return {
      ok: false,
      intentId,
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'INVALID_STATUS',
        message: `Intent is in ${intent.status} status, expected 'planned'`,
      },
    };
  }

  try {
    // Parse the stored metadata
    const metadata = JSON.parse(intent.metadata_json || '{}');
    const parsed = metadata.parsed as ParsedIntent;
    const route = metadata.route as RouteDecision;

    if (!parsed || !route) {
      return {
        ok: false,
        intentId,
        status: 'failed',
        error: {
          stage: 'execute',
          code: 'INVALID_METADATA',
          message: 'Intent missing parsed or route metadata',
        },
      };
    }

    // Update status to executing
    await updateIntentStatus(intentId, {
      status: 'executing',
      executedAt: now,
    });

    // Handle bridge intents
    if (parsed.kind === 'bridge' && route.venue === 'lifi') {
      const bridgeResult = await handleBridgeIntent(intentId, parsed, route);
      return bridgeResult;
    }

    // Execute on appropriate chain
    const execResult = await executeOnChain(intentId, parsed, route);
    return execResult;

  } catch (error: any) {
    await updateIntentStatus(intentId, {
      status: 'failed',
      failureStage: 'execute',
      errorCode: 'EXECUTION_ERROR',
      errorMessage: error.message?.slice(0, 500),
    });

    return {
      ok: false,
      intentId,
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'EXECUTION_ERROR',
        message: error.message,
      },
    };
  }
}

/**
 * Handle bridge intent with LiFi quote
 * Produces proof txs on both chains to record the bridge intent attempt
 */
async function handleBridgeIntent(
  intentId: string,
  parsed: ParsedIntent,
  route: RouteDecision
): Promise<IntentExecutionResult> {
  const {
    updateIntentStatus,
    createExecution,
    updateExecution,
    linkExecutionToIntent,
  } = await import('../../execution-ledger/db');
  const { buildExplorerUrl } = await import('../ledger/ledger');
  const { getLiFiQuote } = await import('../bridge/lifi');

  const now = Math.floor(Date.now() / 1000);

  // Attempt LiFi quote
  const quoteResult = await getLiFiQuote({
    fromChain: parsed.sourceChain || 'ethereum',
    toChain: parsed.destChain || 'solana',
    fromToken: parsed.amountUnit || 'REDACTED',
    toToken: parsed.amountUnit || 'REDACTED',
    fromAmount: (BigInt(parsed.amount || '1000') * BigInt(10 ** 6)).toString(),
  });

  // Store quote result in metadata
  const quoteMetadata = quoteResult.ok
    ? { quoteSuccess: true, tool: quoteResult.quote?.tool, toAmount: quoteResult.quote?.toAmount }
    : { quoteSuccess: false, error: quoteResult.error };

  // Even if quote fails, we'll still create proof txs to record the attempt
  // This ensures we always have on-chain evidence of the bridge intent

  // Create proof transaction on source chain (Sepolia)
  const sourceProofResult = await executeProofOnly(intentId, {
    ...parsed,
    rawParams: {
      ...parsed.rawParams,
      original: `BRIDGE_INTENT_PROOF: ${parsed.rawParams.original} | quote: ${quoteResult.ok ? 'success' : 'failed'}`,
    },
  }, {
    ...route,
    chain: 'ethereum',
    network: 'sepolia',
  });

  // If source chain proof succeeded and destination is solana, try dest chain proof too
  let destProofResult: IntentExecutionResult | null = null;
  if (sourceProofResult.ok && (parsed.destChain === 'solana' || parsed.destChain === 'sol')) {
    try {
      // We need to create a separate execution for the dest chain proof
      const destRoute: RouteDecision = {
        chain: 'solana',
        network: 'devnet',
        venue: 'bridge_proof',
        executionType: 'proof_only',
      };
      destProofResult = await executeProofOnlySolana(intentId, {
        ...parsed,
        rawParams: {
          ...parsed.rawParams,
          original: `BRIDGE_DEST_PROOF: ${parsed.rawParams.original}`,
        },
      }, destRoute);
    } catch (e) {
      // Dest chain proof is best-effort
      console.warn('[bridge] Dest chain proof failed:', e);
    }
  }

  // Final status depends on proof txs
  if (sourceProofResult.ok) {
    await updateIntentStatus(intentId, {
      status: 'confirmed',
      confirmedAt: Math.floor(Date.now() / 1000),
      metadataJson: JSON.stringify({
        parsed,
        route,
        executedKind: 'proof_only',
        quoteMetadata,
        sourceChainProof: {
          txHash: sourceProofResult.txHash,
          explorerUrl: sourceProofResult.explorerUrl,
        },
        destChainProof: destProofResult?.ok ? {
          txHash: destProofResult.txHash,
          explorerUrl: destProofResult.explorerUrl,
        } : null,
        note: 'Bridge execution not wired - proof txs recorded on-chain',
      }),
    });

    return {
      ok: true,
      intentId,
      status: 'confirmed',
      executionId: sourceProofResult.executionId,
      txHash: sourceProofResult.txHash,
      explorerUrl: sourceProofResult.explorerUrl,
      metadata: {
        executedKind: 'proof_only',
        quoteMetadata,
        destChainProof: destProofResult?.ok ? {
          txHash: destProofResult.txHash,
          explorerUrl: destProofResult.explorerUrl,
        } : null,
      },
    };
  }

  // If even proof tx failed, mark as failed
  return sourceProofResult;
}

/**
 * Execute intent on the appropriate chain
 */
async function executeOnChain(
  intentId: string,
  parsed: ParsedIntent,
  route: RouteDecision
): Promise<IntentExecutionResult> {
  const {
    updateIntentStatus,
    createExecution,
    updateExecution,
    linkExecutionToIntent,
  } = await import('../../execution-ledger/db');

  const now = Math.floor(Date.now() / 1000);
  const startTime = Date.now();

  // Execute and capture result for ERC-8004 feedback
  const executeAndTrackFeedback = async (
    executor: () => Promise<IntentExecutionResult>
  ): Promise<IntentExecutionResult> => {
    const result = await executor();
    const latencyMs = Date.now() - startTime;

    // Submit ERC-8004 feedback if enabled
    const usdEstimate = parsed.amount
      ? parseFloat(parsed.amount) * (parsed.amountUnit?.toUpperCase() === 'USDC' ? 1 : 1000)
      : undefined;

    maybeSubmitERC8004Feedback({
      intentId,
      executionId: result.executionId || intentId,
      kind: parsed.kind,
      chain: route.chain,
      success: result.ok,
      amountUsd: usdEstimate,
      latencyMs,
      errorCode: result.error?.code,
    }).catch(() => {}); // Fire and forget, don't block

    return result;
  };

  // For offchain analytics executions (no on-chain tx needed)
  if ((route.executionType as string) === 'offchain') {
    return await executeAndTrackFeedback(() => executeOffchain(intentId, parsed, route));
  }

  // For proof-only executions (perp, unrecognized)
  if (route.executionType === 'proof_only') {
    return await executeAndTrackFeedback(() => executeProofOnly(intentId, parsed, route));
  }

  // Real perp execution via DemoPerpAdapter
  if (parsed.kind === 'perp' && route.executionType === 'real' && route.chain === 'ethereum') {
    return await executeAndTrackFeedback(() => executePerpEthereum(intentId, parsed, route));
  }

  // Real execution based on chain
  if (route.chain === 'ethereum') {
    return await executeAndTrackFeedback(() => executeEthereum(intentId, parsed, route));
  } else {
    return await executeAndTrackFeedback(() => executeSolana(intentId, parsed, route));
  }
}

/**
 * Execute offchain analytics intent - records to ledger without on-chain tx
 */
async function executeOffchain(
  intentId: string,
  parsed: ParsedIntent,
  route: RouteDecision
): Promise<IntentExecutionResult> {
  const {
    updateIntentStatus,
    createExecution,
    linkExecutionToIntent,
  } = await import('../../execution-ledger/db');

  const now = Math.floor(Date.now() / 1000);
  const analyticsType = parsed.rawParams?.analyticsType || 'general';

  // Create execution record (offchain type)
  const execution = await createExecution({
    chain: route.chain,
    network: route.network as any,
    kind: 'proof' as any, // Use 'proof' kind but mark as offchain in metadata
    venue: 'offchain' as any,
    intent: parsed.rawParams?.original || 'Analytics intent',
    action: parsed.action,
    fromAddress: 'offchain',
    usdEstimate: 0,
    usdEstimateIsEstimate: true,
  });

  await linkExecutionToIntent(execution.id, intentId);

  // Mark as confirmed immediately (no tx to wait for)
  await updateIntentStatus(intentId, {
    status: 'confirmed',
    confirmedAt: now,
    metadataJson: JSON.stringify({
      parsed,
      route,
      executedKind: 'offchain',
      executionId: execution.id,
      analyticsType,
      note: 'Analytics-only intent. No on-chain action required.',
      warnings: route.warnings,
    }),
  });

  return {
    ok: true,
    intentId,
    status: 'confirmed',
    executionId: execution.id,
    metadata: {
      executedKind: 'offchain',
      analyticsType,
      note: 'Analytics-only intent. No on-chain action required.',
      warnings: route.warnings,
    },
  };
}

/**
 * Execute perp position via DemoPerpAdapter on Sepolia
 * Real on-chain execution with margin deposit and position opening
 */
async function executePerpEthereum(
  intentId: string,
  parsed: ParsedIntent,
  route: RouteDecision
): Promise<IntentExecutionResult> {
  const {
    getIntentAsync,
    updateIntentStatusAsync: updateIntentStatus,
    finalizeExecutionTransactionAsync,
    createPositionAsync,
  } = await import('../../execution-ledger/db');
  const { buildExplorerUrl } = await import('../ledger/ledger');

  const now = Math.floor(Date.now() / 1000);
  const startTime = Date.now();

  // Get intent's existing metadata to preserve caller info (source, domain, runId)
  const intent = await getIntentAsync(intentId);
  const existingMetadataJson = intent?.metadata_json;

  // Import config
  const {
    RELAYER_PRIVATE_KEY,
    ETH_TESTNET_RPC_URL,
    DEMO_PERP_ADAPTER_ADDRESS,
    DEMO_REDACTED_ADDRESS,
    EXECUTION_ROUTER_ADDRESS,
    ERC20_PULL_ADAPTER_ADDRESS,
  } = await import('../config');

  // Validate required config
  if (!RELAYER_PRIVATE_KEY || !ETH_TESTNET_RPC_URL) {
    await updateIntentStatus(intentId, {
      status: 'failed',
      failureStage: 'execute',
      errorCode: 'CONFIG_MISSING',
      errorMessage: 'Relayer key or RPC not configured',
    });

    return {
      ok: false,
      intentId,
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'CONFIG_MISSING',
        message: 'Relayer key or RPC not configured',
      },
    };
  }

  if (!DEMO_PERP_ADAPTER_ADDRESS || !DEMO_REDACTED_ADDRESS || !EXECUTION_ROUTER_ADDRESS) {
    await updateIntentStatus(intentId, {
      status: 'failed',
      failureStage: 'execute',
      errorCode: 'PERP_CONFIG_MISSING',
      errorMessage: 'DemoPerpAdapter or DEMO_REDACTED not configured',
    });

    return {
      ok: false,
      intentId,
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'PERP_CONFIG_MISSING',
        message: 'DemoPerpAdapter or DEMO_REDACTED not configured',
      },
    };
  }

  // Prepare execution data BEFORE try block so catch can access it
  // fromAddress will be updated once account is created
  const executionData = {
    chain: 'ethereum' as const,
    network: 'sepolia' as const,
    kind: 'perp' as const,
    venue: 'demo_perp' as any,
    intent: parsed.rawParams.original || 'Perp position',
    action: parsed.action,
    fromAddress: '0x0000000000000000000000000000000000000000', // Updated below
    token: 'DEMO_REDACTED',
    amountDisplay: parsed.amount ? `${parsed.amount} REDACTED @ ${parsed.leverage}x` : undefined,
    usdEstimate: estimateIntentUsd(parsed),
    usdEstimateIsEstimate: true,
  };

  try {
    // Import viem for transaction
    const { encodeFunctionData, parseAbi } = await import('viem');
    const { privateKeyToAccount } = await import('viem/accounts');

    // Use failover RPC clients for reliability
    const {
      createFailoverPublicClient,
      createFailoverWalletClient,
      executeWithFailover,
    } = await import('../providers/rpcProvider');

    const account = privateKeyToAccount(RELAYER_PRIVATE_KEY as `0x${string}`);

    // Update fromAddress now that we have the account
    executionData.fromAddress = account.address;

    // Create clients with failover support (includes retry and circuit breaker)
    const publicClient = createFailoverPublicClient();
    const walletClient = createFailoverWalletClient(account);

    // Map market string to enum value
    const marketMap: Record<string, number> = {
      'BTC': 0,
      'ETH': 1,
      'SOL': 2,
    };
    const market = marketMap[parsed.targetAsset?.toUpperCase() || 'BTC'] ?? 0;

    // Map side to enum value
    const side = parsed.action === 'long' ? 0 : 1;

    // Calculate margin amount (default 100 DEMO_REDACTED if not specified)
    // DEMO_REDACTED has 6 decimals
    const marginAmount = parsed.amount
      ? BigInt(Math.floor(parseFloat(parsed.amount) * 1e6))
      : BigInt(100 * 1e6); // 100 REDACTED default

    const leverage = parsed.leverage || 10;

    // DemoPerpAdapter ABI for execute function
    const perpAdapterAbi = parseAbi([
      'function execute(bytes calldata innerData) external payable returns (bytes memory)',
    ]);

    // ExecutionRouter ABI
    const routerAbi = parseAbi([
      'function execute(address adapter, bytes calldata adapterData) external payable returns (bytes memory)',
    ]);

    // Encode inner data for DemoPerpAdapter
    // Format: (uint8 action, address user, uint8 market, uint8 side, uint256 margin, uint256 leverage)
    const ACTION_OPEN = 1;
    const innerData = encodeFunctionData({
      abi: parseAbi(['function encode(uint8,address,uint8,uint8,uint256,uint256)']),
      functionName: 'encode',
      args: [ACTION_OPEN, account.address, market, side, marginAmount, BigInt(leverage)],
    }).slice(10); // Remove function selector, we just want the encoded params

    // Actually, we need to encode the params directly without a function signature
    // Use encodeAbiParameters instead
    const { encodeAbiParameters, parseAbiParameters } = await import('viem');
    const encodedInnerData = encodeAbiParameters(
      parseAbiParameters('uint8, address, uint8, uint8, uint256, uint256'),
      [ACTION_OPEN, account.address as `0x${string}`, market, side, marginAmount, BigInt(leverage)]
    );

    // Before executing perp, we need DEMO_REDACTED balance
    // For testnet demo, we'll mint DEMO_REDACTED to the relayer first (if it's mintable)
    // Or assume the relayer already has DEMO_REDACTED

    // Encode router call
    const routerCallData = encodeFunctionData({
      abi: routerAbi,
      functionName: 'execute',
      args: [DEMO_PERP_ADAPTER_ADDRESS as `0x${string}`, encodedInnerData as `0x${string}`],
    });

    // First, approve DEMO_REDACTED to ExecutionRouter (if not already approved)
    const erc20Abi = parseAbi([
      'function approve(address spender, uint256 amount) external returns (bool)',
      'function allowance(address owner, address spender) external view returns (uint256)',
      'function balanceOf(address account) external view returns (uint256)',
    ]);

    // Check balance
    let balance = await publicClient.readContract({
      address: DEMO_REDACTED_ADDRESS as `0x${string}`,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    });

    // Auto-mint DEMO_REDACTED if balance is insufficient (testnet demo feature)
    if (balance < marginAmount) {
      console.log(`[executePerpEthereum] Relayer balance ${balance} < needed ${marginAmount}, auto-minting...`);

      const mintAbi = parseAbi(['function mint(address to, uint256 amount) external']);
      const mintAmount = marginAmount * BigInt(10); // Mint 10x to cover future trades

      try {
        const mintTxHash = await walletClient.writeContract({
          address: DEMO_REDACTED_ADDRESS as `0x${string}`,
          abi: mintAbi,
          functionName: 'mint',
          args: [account.address, mintAmount],
        });

        console.log(`[executePerpEthereum] Mint tx submitted: ${mintTxHash}`);

        // Wait for mint confirmation with short timeout (1 confirmation, 10s max)
        await publicClient.waitForTransactionReceipt({
          hash: mintTxHash,
          timeout: 10000,
          confirmations: 1,
        });

        console.log(`[executePerpEthereum] Mint confirmed`);

        // Re-check balance after mint
        balance = await publicClient.readContract({
          address: DEMO_REDACTED_ADDRESS as `0x${string}`,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [account.address],
        });

        console.log(`[executePerpEthereum] New balance: ${balance}`);
      } catch (mintError: any) {
        console.error(`[executePerpEthereum] Auto-mint failed:`, mintError.message);
        // Continue with original insufficient balance error if mint fails
      }
    }

    // Final balance check after potential auto-mint
    if (balance < marginAmount) {
      // Pre-flight check failed - create execution record showing why
      const result = await finalizeExecutionTransactionAsync({
        intentId,
        execution: {
          ...executionData,
          status: 'failed',
          errorCode: 'INSUFFICIENT_BALANCE',
          errorMessage: `Insufficient DEMO_REDACTED balance: have ${balance}, need ${marginAmount}`,
        },
        intentStatus: {
          status: 'failed',
          failureStage: 'execute',
          errorCode: 'INSUFFICIENT_BALANCE',
          errorMessage: 'Insufficient DEMO_REDACTED balance for perp margin',
        },
      });

      return {
        ok: false,
        intentId,
        status: 'failed',
        executionId: result.executionId,
        error: {
          stage: 'execute',
          code: 'INSUFFICIENT_BALANCE',
          message: 'Insufficient DEMO_REDACTED balance for perp margin',
        },
      };
    }

    // Check and set allowance to DemoPerpAdapter (called directly)
    const allowance = await publicClient.readContract({
      address: DEMO_REDACTED_ADDRESS as `0x${string}`,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [account.address, DEMO_PERP_ADAPTER_ADDRESS as `0x${string}`],
    });

    if (allowance < marginAmount) {
      // Approve DemoPerpAdapter to spend DEMO_REDACTED
      const approveTxHash = await walletClient.writeContract({
        address: DEMO_REDACTED_ADDRESS as `0x${string}`,
        abi: erc20Abi,
        functionName: 'approve',
        args: [DEMO_PERP_ADAPTER_ADDRESS as `0x${string}`, marginAmount * BigInt(10)], // Approve 10x to avoid future approvals
      });

      await publicClient.waitForTransactionReceipt({
        hash: approveTxHash,
        timeout: 15000,
      });
    }

    // Execute the perp position directly via adapter
    // DemoPerpAdapter.execute pulls tokens from msg.sender
    const txHash = await walletClient.writeContract({
      address: DEMO_PERP_ADAPTER_ADDRESS as `0x${string}`,
      abi: perpAdapterAbi,
      functionName: 'execute',
      args: [encodedInnerData as `0x${string}`],
    });

    const explorerUrl = buildExplorerUrl('ethereum', 'sepolia', txHash);
    const latencyMs = Date.now() - startTime;

    // Try to wait for confirmation, but don't fail if timeout occurs
    // The tx was submitted successfully, so we can return pending status
    let receipt: any = null;
    let receiptStatus: 'confirmed' | 'pending' | 'failed' = 'pending';

    try {
      receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: 15000,
      });
      receiptStatus = receipt.status === 'success' ? 'confirmed' : 'failed';
    } catch (receiptError: any) {
      // Timeout waiting for receipt - tx is pending, not failed
      console.log(`[executePerpEthereum] Receipt wait timed out for ${txHash}, marking as pending`);
      receiptStatus = 'pending';
    }

    if (receiptStatus === 'confirmed') {
      // Prepare execution steps data
      const steps = [
        {
          stepIndex: 0,
          action: 'route',
          chain: 'ethereum',
          status: 'confirmed',
        },
        {
          stepIndex: 1,
          action: 'open_position',
          chain: 'ethereum',
          status: 'confirmed',
          txHash: txHash,
          explorerUrl: explorerUrl,
        },
      ];

      // Parse position ID from logs (PerpPositionOpened event)
      let onChainPositionId: string | undefined;
      try {
        // Look for PositionOpened event in logs
        const positionOpenedTopic = '0x' + Buffer.from('PositionOpened(address,uint256,uint8,uint8,uint256,uint256,uint256,uint256)').slice(0, 32).toString('hex');
        for (const log of receipt.logs) {
          if (log.topics[0]?.toLowerCase().includes('position')) {
            // Extract position ID from topics (indexed param)
            if (log.topics[2]) {
              onChainPositionId = BigInt(log.topics[2]).toString();
              break;
            }
          }
        }
      } catch (e) {
        // Position ID extraction failed, continue without it
      }

      // Parse position details
      const marketName = parsed.targetAsset?.toUpperCase() || 'BTC';
      const positionSide = parsed.action === 'long' ? 'long' : 'short';

      // ATOMIC TRANSACTION: Create execution + steps + update intent to confirmed
      const result = await finalizeExecutionTransactionAsync({
        intentId,
        execution: {
          ...executionData,
          txHash,
          explorerUrl,
          status: 'confirmed',
        },
        steps,
        intentStatus: {
          status: 'confirmed',
          confirmedAt: Math.floor(Date.now() / 1000),
          metadataJson: mergeMetadata(existingMetadataJson, {
            parsed,
            route,
            executedKind: 'real',
            txHash,
            explorerUrl,
            perpDetails: {
              market: marketName,
              side: positionSide,
              margin: marginAmount.toString(),
              leverage,
            },
          }),
        },
      });

      // Create position in ledger (indexer will also catch it, but this is faster)
      await createPositionAsync({
        chain: 'ethereum',
        network: 'sepolia',
        venue: 'demo_perp',
        market: marketName,
        side: positionSide,
        leverage,
        margin_units: marginAmount.toString(),
        margin_display: `${(Number(marginAmount) / 1e6).toFixed(2)} REDACTED`,
        size_units: (marginAmount * BigInt(leverage)).toString(),
        open_tx_hash: txHash,
        open_explorer_url: explorerUrl,
        user_address: account.address,
        on_chain_position_id: onChainPositionId,
        intent_id: intentId,
        execution_id: result.executionId,
      });

      return {
        ok: true,
        intentId,
        status: 'confirmed',
        executionId: result.executionId,
        txHash,
        explorerUrl,
        metadata: {
          executedKind: 'real',
          perpDetails: {
            market: marketName,
            side: positionSide,
            leverage,
          },
        },
      };
    } else if (receiptStatus === 'failed') {
      // ATOMIC TRANSACTION: Create execution + update intent to failed
      const result = await finalizeExecutionTransactionAsync({
        intentId,
        execution: {
          ...executionData,
          txHash,
          explorerUrl,
          status: 'failed',
          errorCode: 'TX_REVERTED',
          errorMessage: 'Perp position transaction reverted',
        },
        intentStatus: {
          status: 'failed',
          failureStage: 'confirm',
          errorCode: 'TX_REVERTED',
          errorMessage: 'Perp position transaction reverted on-chain',
        },
      });

      return {
        ok: false,
        intentId,
        status: 'failed',
        executionId: result.executionId,
        txHash,
        explorerUrl,
        error: {
          stage: 'confirm',
          code: 'TX_REVERTED',
          message: 'Perp position transaction reverted',
        },
      };
    } else {
      // receiptStatus === 'pending' - tx submitted but confirmation timed out
      // This is NOT an error - the tx may still confirm, so return success with pending status
      const steps = [
        {
          stepIndex: 0,
          action: 'route',
          chain: 'ethereum',
          status: 'confirmed',
        },
        {
          stepIndex: 1,
          action: 'open_position',
          chain: 'ethereum',
          status: 'pending',
          txHash: txHash,
          explorerUrl: explorerUrl,
        },
      ];

      const marketName = parsed.targetAsset?.toUpperCase() || 'BTC';
      const positionSide = parsed.action === 'long' ? 'long' : 'short';

      // Create execution with pending status
      const result = await finalizeExecutionTransactionAsync({
        intentId,
        execution: {
          ...executionData,
          txHash,
          explorerUrl,
          status: 'pending',
        },
        steps,
        intentStatus: {
          status: 'pending', // Keep intent pending until confirmed
          metadataJson: mergeMetadata(existingMetadataJson, {
            parsed,
            route,
            executedKind: 'real',
            txHash,
            explorerUrl,
            latencyMs,
            perpDetails: {
              market: marketName,
              side: positionSide,
              leverage,
            },
          }),
        },
      });

      // Still create position record (will show as pending)
      await createPositionAsync({
        chain: 'ethereum',
        network: 'sepolia',
        venue: 'demo_perp',
        market: marketName,
        side: positionSide,
        leverage,
        margin_units: marginAmount.toString(),
        margin_display: `${(Number(marginAmount) / 1e6).toFixed(2)} REDACTED`,
        size_units: (marginAmount * BigInt(leverage)).toString(),
        open_tx_hash: txHash,
        open_explorer_url: explorerUrl,
        user_address: account.address,
        intent_id: intentId,
        execution_id: result.executionId,
      });

      return {
        ok: true, // TX was submitted successfully
        intentId,
        status: 'pending',
        executionId: result.executionId,
        txHash,
        explorerUrl,
        metadata: {
          executedKind: 'real',
          receiptPending: true,
          perpDetails: {
            market: marketName,
            side: positionSide,
            leverage,
          },
        },
      };
    }
  } catch (error: any) {
    // ATOMIC TRANSACTION: Create execution + update intent to failed
    const result = await finalizeExecutionTransactionAsync({
      intentId,
      execution: {
        ...executionData,
        status: 'failed',
        errorCode: 'PERP_EXECUTION_ERROR',
        errorMessage: error.message?.slice(0, 200),
      },
      intentStatus: {
        status: 'failed',
        failureStage: 'execute',
        errorCode: 'PERP_EXECUTION_ERROR',
        errorMessage: error.message?.slice(0, 200),
      },
    });

    return {
      ok: false,
      intentId,
      status: 'failed',
      executionId: result.executionId,
      error: {
        stage: 'execute',
        code: 'PERP_EXECUTION_ERROR',
        message: error.message,
      },
    };
  }
}

/**
 * Execute proof-only transaction - sends REAL on-chain proof tx
 * Records intent on-chain with txHash and explorerUrl
 */
async function executeProofOnly(
  intentId: string,
  parsed: ParsedIntent,
  route: RouteDecision
): Promise<IntentExecutionResult> {
  const {
    getIntentAsync,
    updateIntentStatusAsync,
    createExecutionAsync,
    updateExecutionAsync,
    linkExecutionToIntentAsync,
  } = await import('../../execution-ledger/db');
  const { buildExplorerUrl } = await import('../ledger/ledger');

  // Get intent's existing metadata to preserve caller info (source, domain, runId)
  const intent = await getIntentAsync(intentId);
  const existingMetadataJson = intent?.metadata_json;

  const now = Math.floor(Date.now() / 1000);
  const startTime = Date.now();

  // Route to appropriate chain for proof tx
  if (route.chain === 'solana') {
    return await executeProofOnlySolana(intentId, parsed, route);
  }
  if (route.chain === 'hyperliquid') {
    return await executeProofOnlyHyperliquid(intentId, parsed, route);
  }

  // Default: Ethereum Sepolia proof tx
  const {
    RELAYER_PRIVATE_KEY,
    ETH_TESTNET_RPC_URL,
  } = await import('../config');

  if (!RELAYER_PRIVATE_KEY || !ETH_TESTNET_RPC_URL) {
    await updateIntentStatusAsync(intentId, {
      status: 'failed',
      failureStage: 'execute',
      errorCode: 'CONFIG_MISSING',
      errorMessage: 'Relayer key or RPC not configured for Sepolia proof tx',
    });

    return {
      ok: false,
      intentId,
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'CONFIG_MISSING',
        message: 'Relayer key or RPC not configured',
      },
    };
  }

  try {
    // Import viem for transaction
    const { createPublicClient, createWalletClient, http, toHex } = await import('viem');
    const { sepolia } = await import('viem/chains');
    const { privateKeyToAccount } = await import('viem/accounts');

    const account = privateKeyToAccount(RELAYER_PRIVATE_KEY as `0x${string}`);
    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http(ETH_TESTNET_RPC_URL),
    });
    const walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(ETH_TESTNET_RPC_URL),
    });

    // Create execution record
    const execution = await createExecutionAsync({
      chain: 'ethereum',
      network: 'sepolia',
      kind: 'proof',
      venue: route.venue as any,
      intent: parsed.rawParams.original || 'Intent proof',
      action: 'proof',
      fromAddress: account.address,
      token: parsed.amountUnit,
      usdEstimate: estimateIntentUsd(parsed),
      usdEstimateIsEstimate: true,
    });

    await linkExecutionToIntentAsync(execution.id, intentId);

    // Build proof metadata for calldata
    const proofData = {
      type: 'BLOSSOM_INTENT_PROOF',
      intentId: intentId.slice(0, 8),
      kind: parsed.kind,
      action: parsed.action,
      asset: parsed.targetAsset || parsed.amountUnit,
      timestamp: now,
    };
    const proofHex = toHex(JSON.stringify(proofData));

    // Send proof tx (self-transfer with metadata in data field)
    const transferAmount = BigInt(1); // 1 wei as proof marker

    const isNonceError = (err: any) => {
      const message = `${err?.message || err}`.toLowerCase();
      return message.includes('nonce') || message.includes('already known');
    };

    const sendWithNonceRetry = async () => {
      try {
        return await walletClient.sendTransaction({
          to: account.address,
          value: transferAmount,
          data: proofHex as `0x${string}`,
        });
      } catch (err: any) {
        if (!isNonceError(err)) throw err;
        const pendingNonce = await publicClient.getTransactionCount({
          address: account.address,
          blockTag: 'pending',
        });
        return await walletClient.sendTransaction({
          to: account.address,
          value: transferAmount,
          data: proofHex as `0x${string}`,
          nonce: pendingNonce,
        });
      }
    };

    const txHash = await sendWithNonceRetry();

    // Wait for confirmation (tolerate timeouts as pending, similar to perp flow)
    let receipt: any = null;
    let receiptStatus: 'confirmed' | 'pending' | 'failed' = 'pending';

    try {
      receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: 15000,
      });
      receiptStatus = receipt.status === 'success' ? 'confirmed' : 'failed';
    } catch (receiptError: any) {
      // Timeout waiting for receipt - tx is pending, not failed
      console.log(`[executeProofOnly] Receipt wait timed out for ${txHash}, marking as pending`);
      receiptStatus = 'pending';
    }

    const latencyMs = Date.now() - startTime;
    const explorerUrl = buildExplorerUrl('ethereum', 'sepolia', txHash);

    if (receiptStatus === 'confirmed') {
      await updateExecutionAsync(execution.id, {
        status: 'confirmed',
        txHash,
        explorerUrl,
        blockNumber: Number(receipt.blockNumber),
        gasUsed: receipt.gasUsed.toString(),
        latencyMs,
      });

      await updateIntentStatusAsync(intentId, {
        status: 'confirmed',
        confirmedAt: Math.floor(Date.now() / 1000),
        metadataJson: mergeMetadata(existingMetadataJson, {
          parsed,
          route,
          executedKind: 'proof_only',
          executionId: execution.id,
          txHash,
          explorerUrl,
          warnings: route.warnings,
        }),
      });

      return {
        ok: true,
        intentId,
        status: 'confirmed',
        executionId: execution.id,
        txHash,
        explorerUrl,
        metadata: {
          executedKind: 'proof_only',
          warnings: route.warnings,
        },
      };
    } else if (receiptStatus === 'failed') {
      await updateExecutionAsync(execution.id, {
        status: 'failed',
        txHash,
        explorerUrl,
        errorCode: 'TX_REVERTED',
        errorMessage: 'Proof transaction reverted',
      });

      await updateIntentStatusAsync(intentId, {
        status: 'failed',
        failureStage: 'confirm',
        errorCode: 'TX_REVERTED',
        errorMessage: 'Proof transaction reverted on-chain',
      });

      return {
        ok: false,
        intentId,
        status: 'failed',
        executionId: execution.id,
        txHash,
        explorerUrl,
        error: {
          stage: 'confirm',
          code: 'TX_REVERTED',
          message: 'Proof transaction reverted',
        },
      };
    } else {
      // receiptStatus === 'pending' - tx submitted but confirmation timed out
      await updateExecutionAsync(execution.id, {
        status: 'pending',
        txHash,
        explorerUrl,
        latencyMs,
      });

      await updateIntentStatusAsync(intentId, {
        status: 'pending',
        metadataJson: mergeMetadata(existingMetadataJson, {
          parsed,
          route,
          executedKind: 'proof_only',
          executionId: execution.id,
          txHash,
          explorerUrl,
          latencyMs,
          warnings: route.warnings,
        }),
      });

      return {
        ok: true,
        intentId,
        status: 'pending',
        executionId: execution.id,
        txHash,
        explorerUrl,
        metadata: {
          executedKind: 'proof_only',
          warnings: route.warnings,
        },
      };
    }
  } catch (error: any) {
    await updateIntentStatusAsync(intentId, {
      status: 'failed',
      failureStage: 'execute',
      errorCode: 'PROOF_TX_FAILED',
      errorMessage: error.message?.slice(0, 200),
    });

    return {
      ok: false,
      intentId,
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'PROOF_TX_FAILED',
        message: error.message,
      },
    };
  }
}

/**
 * Execute proof-only transaction on Solana devnet
 */
async function executeProofOnlySolana(
  intentId: string,
  parsed: ParsedIntent,
  route: RouteDecision
): Promise<IntentExecutionResult> {
  const {
    getIntentAsync,
    updateIntentStatusAsync,
    createExecutionAsync,
    updateExecutionAsync,
    linkExecutionToIntentAsync,
  } = await import('../../execution-ledger/db');
  const { buildExplorerUrl } = await import('../ledger/ledger');

  // Get intent's existing metadata to preserve caller info (source, domain, runId)
  const intent = await getIntentAsync(intentId);
  const existingMetadataJson = intent?.metadata_json;

  const now = Math.floor(Date.now() / 1000);
  const startTime = Date.now();

  // Check for Solana private key
  const solanaPrivateKey = process.env.SOLANA_PRIVATE_KEY;

  if (!solanaPrivateKey) {
    await updateIntentStatusAsync(intentId, {
      status: 'failed',
      failureStage: 'execute',
      errorCode: 'CONFIG_MISSING',
      errorMessage: 'Solana wallet not configured for proof tx',
    });

    return {
      ok: false,
      intentId,
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'CONFIG_MISSING',
        message: 'Solana wallet not configured',
      },
    };
  }

  try {
    // Use the existing Solana proof tx logic from solana-ledger-smoke
    const { SolanaClient } = await import('../solana/solanaClient');
    const crypto = await import('crypto');

    // Base58 helpers
    const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

    function base58Decode(str: string): Buffer {
      const bytes = [0];
      for (const char of str) {
        let value = BASE58_ALPHABET.indexOf(char);
        if (value === -1) throw new Error(`Invalid base58 character: ${char}`);
        for (let i = 0; i < bytes.length; i++) {
          const product = bytes[i] * 58 + value;
          bytes[i] = product % 256;
          value = Math.floor(product / 256);
        }
        while (value > 0) {
          bytes.push(value % 256);
          value = Math.floor(value / 256);
        }
      }
      for (const char of str) {
        if (char !== '1') break;
        bytes.push(0);
      }
      return Buffer.from(bytes.reverse());
    }

    function base58Encode(buffer: Buffer): string {
      const digits = [0];
      for (let i = 0; i < buffer.length; i++) {
        let carry = buffer[i];
        for (let j = 0; j < digits.length; j++) {
          carry += digits[j] << 8;
          digits[j] = carry % 58;
          carry = Math.floor(carry / 58);
        }
        while (carry > 0) {
          digits.push(carry % 58);
          carry = Math.floor(carry / 58);
        }
      }
      let output = '';
      for (let i = 0; i < buffer.length && buffer[i] === 0; i++) {
        output += BASE58_ALPHABET[0];
      }
      for (let i = digits.length - 1; i >= 0; i--) {
        output += BASE58_ALPHABET[digits[i]];
      }
      return output;
    }

    // Parse sender keypair
    const secretKey = base58Decode(solanaPrivateKey);
    if (secretKey.length !== 64) {
      throw new Error(`Invalid Solana secret key length: ${secretKey.length}`);
    }
    const privateKey = secretKey.slice(0, 32);
    const publicKey = secretKey.slice(32, 64);
    const senderPubkey = base58Encode(publicKey);

    // Create execution record
    const execution = await createExecutionAsync({
      chain: 'solana',
      network: 'devnet',
      kind: 'proof',
      venue: route.venue as any,
      intent: parsed.rawParams.original || 'Intent proof',
      action: 'proof',
      fromAddress: senderPubkey,
      token: parsed.amountUnit || 'SOL',
      usdEstimate: estimateIntentUsd(parsed),
      usdEstimateIsEstimate: true,
    });

    await linkExecutionToIntentAsync(execution.id, intentId);

    // Use SolanaClient to send a small transfer as proof
    const client = new SolanaClient();
    const DEVNET_RPC = 'https://api.devnet.solana.com';
    const LAMPORTS_PER_SOL = 1_000_000_000;
    const transferLamports = 1000; // 0.000001 SOL as proof marker

    // Get recent blockhash
    const { blockhash } = await client.getRecentBlockhash();

    // Build and sign transaction (using the existing pattern from smoke test)
    // System Program ID (all zeros)
    const systemProgramId = Buffer.alloc(32);

    function encodeCompactU16(value: number): Buffer {
      if (value < 128) return Buffer.from([value]);
      if (value < 16384) return Buffer.from([(value & 0x7f) | 0x80, value >> 7]);
      return Buffer.from([(value & 0x7f) | 0x80, ((value >> 7) & 0x7f) | 0x80, value >> 14]);
    }

    // Transfer instruction data
    const instructionData = Buffer.alloc(12);
    instructionData.writeUInt32LE(2, 0); // Transfer instruction
    instructionData.writeBigUInt64LE(BigInt(transferLamports), 4);

    // For self-transfer: only include sender once, reference it twice in instruction
    // Header: [num_sigs, num_readonly_signed, num_readonly_unsigned]
    // For self-transfer: 1 signer (sender), 0 readonly signed, 1 readonly unsigned (system program)
    const header = Buffer.from([1, 0, 1]);
    const accountsLength = encodeCompactU16(2);
    // accounts: [sender (writable, signer), system_program (readonly)]
    const accounts = Buffer.concat([publicKey, systemProgramId]);
    const blockhashBytes = base58Decode(blockhash);

    const instructionsLength = encodeCompactU16(1);
    const programIdIndex = Buffer.from([1]); // System program is at index 1
    const accountIndicesLength = encodeCompactU16(2);
    // For self-transfer: source=0, dest=0 (same account)
    const accountIndices = Buffer.from([0, 0]);
    const dataLength = encodeCompactU16(instructionData.length);

    const instruction = Buffer.concat([
      programIdIndex, accountIndicesLength, accountIndices, dataLength, instructionData
    ]);

    const message = Buffer.concat([
      header, accountsLength, accounts, blockhashBytes, instructionsLength, instruction
    ]);

    // Sign message
    const keyObject = crypto.createPrivateKey({
      key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), privateKey]),
      format: 'der',
      type: 'pkcs8',
    });
    const signature = Buffer.from(crypto.sign(null, message, keyObject));

    // Build signed transaction
    const signedTx = Buffer.concat([Buffer.from([1]), signature, message]);
    const signedTxBase64 = signedTx.toString('base64');

    // Send transaction
    const txSignature = await client.sendTransaction(signedTxBase64);

    // Wait for confirmation
    const result = await client.confirmTransaction(txSignature, 'confirmed', 60000);

    const latencyMs = Date.now() - startTime;
    const explorerUrl = buildExplorerUrl('solana', 'devnet', txSignature);

    await updateExecutionAsync(execution.id, {
      status: 'confirmed',
      txHash: txSignature,
      explorerUrl,
      blockNumber: result.slot,
      latencyMs,
    });

    await updateIntentStatusAsync(intentId, {
      status: 'confirmed',
      confirmedAt: Math.floor(Date.now() / 1000),
      metadataJson: mergeMetadata(existingMetadataJson, {
        parsed,
        route,
        executedKind: 'proof_only',
        executionId: execution.id,
        txHash: txSignature,
        explorerUrl,
        warnings: route.warnings,
      }),
    });

    return {
      ok: true,
      intentId,
      status: 'confirmed',
      executionId: execution.id,
      txHash: txSignature,
      explorerUrl,
      metadata: {
        executedKind: 'proof_only',
        warnings: route.warnings,
      },
    };
  } catch (error: any) {
    await updateIntentStatusAsync(intentId, {
      status: 'failed',
      failureStage: 'execute',
      errorCode: 'SOLANA_PROOF_TX_FAILED',
      errorMessage: error.message?.slice(0, 200),
    });

    return {
      ok: false,
      intentId,
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'SOLANA_PROOF_TX_FAILED',
        message: error.message,
      },
    };
  }
}

/**
 * Execute proof-only transaction on Hyperliquid testnet (EVM)
 */
async function executeProofOnlyHyperliquid(
  intentId: string,
  parsed: ParsedIntent,
  route: RouteDecision
): Promise<IntentExecutionResult> {
  const {
    getIntentAsync,
    updateIntentStatusAsync,
    createExecutionAsync,
    updateExecutionAsync,
    linkExecutionToIntentAsync,
  } = await import('../../execution-ledger/db');
  const { buildExplorerUrl } = await import('../ledger/ledger');

  const intent = await getIntentAsync(intentId);
  const existingMetadataJson = intent?.metadata_json;

  const now = Math.floor(Date.now() / 1000);
  const startTime = Date.now();

  const {
    HYPERLIQUID_TESTNET_RPC_URL,
    HYPERLIQUID_TESTNET_CHAIN_ID,
    HYPERLIQUID_MINT_AUTHORITY_PRIVATE_KEY,
    HYPERLIQUID_BUILDER_PRIVATE_KEY,
    RELAYER_PRIVATE_KEY,
  } = await import('../config');

  const signerKey =
    HYPERLIQUID_MINT_AUTHORITY_PRIVATE_KEY ||
    HYPERLIQUID_BUILDER_PRIVATE_KEY ||
    RELAYER_PRIVATE_KEY;

  if (!signerKey || !HYPERLIQUID_TESTNET_RPC_URL) {
    await updateIntentStatusAsync(intentId, {
      status: 'failed',
      failureStage: 'execute',
      errorCode: 'CONFIG_MISSING',
      errorMessage: 'Hyperliquid relayer key or RPC not configured',
    });

    return {
      ok: false,
      intentId,
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'CONFIG_MISSING',
        message: 'Hyperliquid relayer key or RPC not configured',
      },
    };
  }

  try {
    const { createPublicClient, createWalletClient, http, toHex } = await import('viem');
    const { privateKeyToAccount } = await import('viem/accounts');

    const chainId = HYPERLIQUID_TESTNET_CHAIN_ID || 998;
    const hyperliquidChain = {
      id: chainId,
      name: 'Hyperliquid Testnet',
      network: 'hyperliquid-testnet',
      nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
      rpcUrls: {
        default: { http: [HYPERLIQUID_TESTNET_RPC_URL] },
        public: { http: [HYPERLIQUID_TESTNET_RPC_URL] },
      },
    } as const;

    const account = privateKeyToAccount(signerKey as `0x${string}`);
    const publicClient = createPublicClient({
      chain: hyperliquidChain,
      transport: http(HYPERLIQUID_TESTNET_RPC_URL),
    });
    const walletClient = createWalletClient({
      account,
      chain: hyperliquidChain,
      transport: http(HYPERLIQUID_TESTNET_RPC_URL),
    });

    const execution = await createExecutionAsync({
      chain: 'hyperliquid',
      network: 'hyperliquid_testnet',
      kind: 'proof',
      venue: route.venue as any,
      intent: parsed.rawParams.original || 'Intent proof',
      action: 'proof',
      fromAddress: account.address,
      token: parsed.amountUnit,
      usdEstimate: estimateIntentUsd(parsed),
      usdEstimateIsEstimate: true,
    });

    await linkExecutionToIntentAsync(execution.id, intentId);

    const proofData = {
      type: 'BLOSSOM_INTENT_PROOF',
      intentId: intentId.slice(0, 8),
      kind: parsed.kind,
      action: parsed.action,
      asset: parsed.targetAsset || parsed.amountUnit,
      timestamp: now,
    };
    const proofHex = toHex(JSON.stringify(proofData));

    const txHash = await walletClient.sendTransaction({
      to: account.address,
      value: BigInt(1),
      data: proofHex as `0x${string}`,
    });

    let receipt: any = null;
    let receiptStatus: 'confirmed' | 'pending' | 'failed' = 'pending';

    try {
      receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: 15000,
      });
      receiptStatus = receipt.status === 'success' ? 'confirmed' : 'failed';
    } catch (receiptError: any) {
      console.log(`[executeProofOnlyHyperliquid] Receipt wait timed out for ${txHash}, marking as pending`);
      receiptStatus = 'pending';
    }

    const latencyMs = Date.now() - startTime;
    const explorerUrl = buildExplorerUrl('hyperliquid', 'hyperliquid_testnet', txHash);

    if (receiptStatus === 'confirmed') {
      await updateExecutionAsync(execution.id, {
        status: 'confirmed',
        txHash,
        explorerUrl,
        blockNumber: Number(receipt.blockNumber),
        gasUsed: receipt.gasUsed.toString(),
        latencyMs,
      });

      await updateIntentStatusAsync(intentId, {
        status: 'confirmed',
        confirmedAt: Math.floor(Date.now() / 1000),
        metadataJson: mergeMetadata(existingMetadataJson, {
          parsed,
          route,
          executedKind: 'proof_only',
          executionId: execution.id,
          txHash,
          explorerUrl,
          warnings: route.warnings,
        }),
      });

      return {
        ok: true,
        intentId,
        status: 'confirmed',
        executionId: execution.id,
        txHash,
        explorerUrl,
        metadata: {
          executedKind: 'proof_only',
          warnings: route.warnings,
        },
      };
    }

    if (receiptStatus === 'failed') {
      await updateExecutionAsync(execution.id, {
        status: 'failed',
        txHash,
        explorerUrl,
        errorCode: 'TX_REVERTED',
        errorMessage: 'Proof transaction reverted',
      });

      await updateIntentStatusAsync(intentId, {
        status: 'failed',
        failureStage: 'confirm',
        errorCode: 'TX_REVERTED',
        errorMessage: 'Proof transaction reverted on-chain',
      });

      return {
        ok: false,
        intentId,
        status: 'failed',
        executionId: execution.id,
        txHash,
        explorerUrl,
        error: {
          stage: 'confirm',
          code: 'TX_REVERTED',
          message: 'Proof transaction reverted',
        },
      };
    }

    // receiptStatus === 'pending' - tx submitted but confirmation timed out
    await updateExecutionAsync(execution.id, {
      status: 'pending',
      txHash,
      explorerUrl,
      latencyMs,
    });

    await updateIntentStatusAsync(intentId, {
      status: 'pending',
      metadataJson: mergeMetadata(existingMetadataJson, {
        parsed,
        route,
        executedKind: 'proof_only',
        executionId: execution.id,
        txHash,
        explorerUrl,
        warnings: route.warnings,
      }),
    });

    return {
      ok: true,
      intentId,
      status: 'pending',
      executionId: execution.id,
      txHash,
      explorerUrl,
      metadata: {
        executedKind: 'proof_only',
        pending: true,
        warnings: route.warnings,
      },
    };
  } catch (error: any) {
    await updateIntentStatusAsync(intentId, {
      status: 'failed',
      failureStage: 'execute',
      errorCode: 'HYPERLIQUID_PROOF_TX_FAILED',
      errorMessage: error.message?.slice(0, 200),
    });

    return {
      ok: false,
      intentId,
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'HYPERLIQUID_PROOF_TX_FAILED',
        message: error.message,
      },
    };
  }
}

/**
 * Execute on Ethereum Sepolia
 */
async function executeEthereum(
  intentId: string,
  parsed: ParsedIntent,
  route: RouteDecision
): Promise<IntentExecutionResult> {
  const {
    getIntentAsync,
    updateIntentStatusAsync: updateIntentStatus,
    finalizeExecutionTransactionAsync,
  } = await import('../../execution-ledger/db');

  // Get intent's existing metadata to preserve caller info (source, domain, runId)
  const intent = await getIntentAsync(intentId);
  const existingMetadataJson = intent?.metadata_json;

  const now = Math.floor(Date.now() / 1000);

  // Check config
  const {
    RELAYER_PRIVATE_KEY,
    ETH_TESTNET_RPC_URL,
  } = await import('../config');

  if (!RELAYER_PRIVATE_KEY || !ETH_TESTNET_RPC_URL) {
    await updateIntentStatus(intentId, {
      status: 'failed',
      failureStage: 'execute',
      errorCode: 'CONFIG_MISSING',
      errorMessage: 'Ethereum relayer not configured',
    });

    return {
      ok: false,
      intentId,
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'CONFIG_MISSING',
        message: 'Ethereum relayer not configured',
      },
    };
  }

  // Prepare execution data (will be created in atomic transaction after TX succeeds)
  const mappedKind = parsed.kind === 'unknown' ? 'proof' : parsed.kind;
  const executionData = {
    chain: 'ethereum' as const,
    network: 'sepolia' as const,
    kind: mappedKind as ExecutionKind,
    venue: route.venue as any,
    intent: parsed.rawParams.original || 'Intent execution',
    action: parsed.action,
    fromAddress: '0x0000000000000000000000000000000000000000', // Will be updated
    token: parsed.amountUnit,
    amountDisplay: parsed.amount ? `${parsed.amount} ${parsed.amountUnit}` : undefined,
    usdEstimate: estimateIntentUsd(parsed),
    usdEstimateIsEstimate: true,
  };

  try {
    // Attempt real execution via viem
    const { createPublicClient, createWalletClient, http } = await import('viem');
    const { sepolia } = await import('viem/chains');
    const { privateKeyToAccount } = await import('viem/accounts');

    const account = privateKeyToAccount(RELAYER_PRIVATE_KEY as `0x${string}`);
    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http(ETH_TESTNET_RPC_URL),
    });
    const walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(ETH_TESTNET_RPC_URL),
    });

    // For demo purposes, send a small ETH transfer to self as proof
    const transferAmount = BigInt(1000000000000); // 0.000001 ETH

    const isNonceError = (err: any) => {
      const message = `${err?.message || err}`.toLowerCase();
      return message.includes('nonce') || message.includes('already known');
    };

    const sendWithNonceRetry = async () => {
      try {
        return await walletClient.sendTransaction({
          to: account.address,
          value: transferAmount,
        });
      } catch (err: any) {
        if (!isNonceError(err)) throw err;
        const pendingNonce = await publicClient.getTransactionCount({
          address: account.address,
          blockTag: 'pending',
        });
        return await walletClient.sendTransaction({
          to: account.address,
          value: transferAmount,
          nonce: pendingNonce,
        });
      }
    };

    const txHash = await sendWithNonceRetry();

    // Wait for confirmation (treat timeouts as pending)
    let receipt: any = null;
    let receiptStatus: 'confirmed' | 'pending' | 'failed' = 'pending';

    try {
      receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: 15000,
      });
      receiptStatus = receipt.status === 'success' ? 'confirmed' : 'failed';
    } catch (receiptError: any) {
      console.log(`[executeEthereum] Receipt wait timed out for ${txHash}, marking as pending`);
      receiptStatus = 'pending';
    }

    const explorerUrl = `https://sepolia.etherscan.io/tx/${txHash}`;
    const latencyMs = Date.now() - (now * 1000);

    if (receiptStatus === 'confirmed') {
      // ATOMIC TRANSACTION: Create execution row + update intent to confirmed
      const result = await finalizeExecutionTransactionAsync({
        intentId,
        execution: {
          ...executionData,
          txHash,
          explorerUrl,
          status: 'confirmed',
        },
        intentStatus: {
          status: 'confirmed',
          confirmedAt: Math.floor(Date.now() / 1000),
          metadataJson: mergeMetadata(existingMetadataJson, {
            parsed,
            route,
            executedKind: 'real',
            txHash,
            explorerUrl,
          }),
        },
      });

      return {
        ok: true,
        intentId,
        status: 'confirmed',
        executionId: result.executionId,
        txHash,
        explorerUrl,
        metadata: {
          executedKind: 'real',
        },
      };
    } else if (receiptStatus === 'failed') {
      // ATOMIC TRANSACTION: Create execution row + update intent to failed
      const result = await finalizeExecutionTransactionAsync({
        intentId,
        execution: {
          ...executionData,
          txHash,
          explorerUrl,
          status: 'failed',
          errorCode: 'TX_REVERTED',
          errorMessage: 'Transaction reverted on-chain',
        },
        intentStatus: {
          status: 'failed',
          failureStage: 'confirm',
          errorCode: 'TX_REVERTED',
          errorMessage: 'Transaction reverted on-chain',
        },
      });

      return {
        ok: false,
        intentId,
        status: 'failed',
        executionId: result.executionId,
        txHash,
        explorerUrl,
        error: {
          stage: 'confirm',
          code: 'TX_REVERTED',
          message: 'Transaction reverted on-chain',
        },
      };
    } else {
      // receiptStatus === 'pending' - tx submitted but confirmation timed out
      const result = await finalizeExecutionTransactionAsync({
        intentId,
        execution: {
          ...executionData,
          txHash,
          explorerUrl,
          status: 'pending',
        },
        intentStatus: {
          status: 'pending',
          metadataJson: mergeMetadata(existingMetadataJson, {
            parsed,
            route,
            executedKind: 'real',
            txHash,
            explorerUrl,
            latencyMs,
          }),
        },
      });

      return {
        ok: true,
        intentId,
        status: 'pending',
        executionId: result.executionId,
        txHash,
        explorerUrl,
        metadata: {
          executedKind: 'real',
          pending: true,
        },
      };
    }
  } catch (error: any) {
    // ATOMIC TRANSACTION: Create execution row + update intent to failed
    const result = await finalizeExecutionTransactionAsync({
      intentId,
      execution: {
        ...executionData,
        status: 'failed',
        errorCode: 'EXECUTION_ERROR',
        errorMessage: error.message?.slice(0, 200),
      },
      intentStatus: {
        status: 'failed',
        failureStage: 'execute',
        errorCode: 'EXECUTION_ERROR',
        errorMessage: error.message?.slice(0, 200),
      },
    });

    return {
      ok: false,
      intentId,
      status: 'failed',
      executionId: result.executionId,
      error: {
        stage: 'execute',
        code: 'EXECUTION_ERROR',
        message: error.message,
      },
    };
  }
}

/**
 * Execute on Solana Devnet
 */
async function executeSolana(
  intentId: string,
  parsed: ParsedIntent,
  route: RouteDecision
): Promise<IntentExecutionResult> {
  const {
    getIntentAsync,
    updateIntentStatusAsync,
    createExecutionAsync,
    updateExecutionAsync,
    linkExecutionToIntentAsync,
  } = await import('../../execution-ledger/db');
  const { buildExplorerUrl } = await import('../ledger/ledger');

  // Get intent's existing metadata to preserve caller info (source, domain, runId)
  const existingIntent = await getIntentAsync(intentId);
  const existingMetadataJson = existingIntent?.metadata_json;

  const now = Math.floor(Date.now() / 1000);
  const startTime = Date.now();

  // Check for Solana private key
  const solanaPrivateKey = process.env.SOLANA_PRIVATE_KEY;

  if (!solanaPrivateKey) {
    await updateIntentStatusAsync(intentId, {
      status: 'failed',
      failureStage: 'execute',
      errorCode: 'CONFIG_MISSING',
      errorMessage: 'Solana wallet not configured',
    });

    return {
      ok: false,
      intentId,
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'CONFIG_MISSING',
        message: 'Solana wallet not configured',
      },
    };
  }

  // For real swap execution via Jupiter
  if (parsed.kind === 'swap' && route.venue === 'jupiter') {
    try {
      const { createSolanaExecutor } = await import('../solana/solanaExecutor');

      const executor = createSolanaExecutor({ privateKey: solanaPrivateKey });

      if (!executor.isInitialized()) {
        throw new Error('Failed to initialize Solana executor');
      }

      const executorPubkey = executor.getPublicKey();

      // Create execution record
      const execution = await createExecutionAsync({
        chain: 'solana',
        network: 'devnet',
        kind: 'swap',
        venue: 'jupiter' as any,
        intent: parsed.rawParams.original || 'Solana swap',
        action: 'swap',
        fromAddress: executorPubkey || 'unknown',
        token: parsed.amountUnit || 'SOL',
        usdEstimate: estimateIntentUsd(parsed),
        usdEstimateIsEstimate: true,
      });

      await linkExecutionToIntentAsync(execution.id, intentId);

      // Execute the swap via Jupiter
      const inputToken = parsed.amountUnit || 'USDC';
      const outputToken = parsed.targetAsset || 'SOL';
      const amount = parsed.amount || '100';

      const swapResult = await executor.executeSwap({
        inputToken,
        outputToken,
        amount,
        slippageBps: 50,
      });

      const latencyMs = Date.now() - startTime;

      if (swapResult.ok) {
        await updateExecutionAsync(execution.id, {
          status: 'confirmed',
          txHash: swapResult.signature,
          explorerUrl: swapResult.explorerUrl,
          latencyMs,
        });

        await updateIntentStatusAsync(intentId, {
          status: 'confirmed',
          confirmedAt: Math.floor(Date.now() / 1000),
          metadataJson: mergeMetadata(existingMetadataJson, {
            parsed,
            route,
            executedKind: 'real',
            executionId: execution.id,
            txHash: swapResult.signature,
            explorerUrl: swapResult.explorerUrl,
            solana: swapResult.metadata,
          }),
        });

        return {
          ok: true,
          intentId,
          status: 'confirmed',
          executionId: execution.id,
          txHash: swapResult.signature,
          explorerUrl: swapResult.explorerUrl,
          metadata: {
            executedKind: 'real',
            ...swapResult.metadata,
          },
        };
      } else {
        await updateExecutionAsync(execution.id, {
          status: 'failed',
          errorCode: swapResult.error?.code,
          errorMessage: swapResult.error?.message,
          latencyMs,
        });

        await updateIntentStatusAsync(intentId, {
          status: 'failed',
          failureStage: 'execute',
          errorCode: swapResult.error?.code || 'SWAP_FAILED',
          errorMessage: swapResult.error?.message || 'Jupiter swap failed',
        });

        return {
          ok: false,
          intentId,
          status: 'failed',
          executionId: execution.id,
          error: {
            stage: 'execute',
            code: swapResult.error?.code || 'SWAP_FAILED',
            message: swapResult.error?.message || 'Jupiter swap failed',
          },
        };
      }
    } catch (error: any) {
      await updateIntentStatusAsync(intentId, {
        status: 'failed',
        failureStage: 'execute',
        errorCode: 'SOLANA_SWAP_ERROR',
        errorMessage: error.message?.slice(0, 200),
      });

      return {
        ok: false,
        intentId,
        status: 'failed',
        error: {
          stage: 'execute',
          code: 'SOLANA_SWAP_ERROR',
          message: error.message,
        },
      };
    }
  }

  // Optional: Pull Solana market context (Pyth/Jupiter) for devnet-safe metadata
  let solanaContext: Record<string, any> | null = null;
  try {
    const { getPythPriceForSymbol } = await import('../solana/pyth');
    const { getJupiterPriceUsd, getJupiterQuote } = await import('../solana/jupiter');

    const solPrice = await getPythPriceForSymbol('SOL') ?? await getJupiterPriceUsd('SOL');
    const usdcPrice = await getPythPriceForSymbol('USDC') ?? await getJupiterPriceUsd('USDC');

    solanaContext = {
      solPriceUsd: solPrice ?? null,
      usdcPriceUsd: usdcPrice ?? null,
    };

    // Best-effort Jupiter quote for swap intents (optional)
    if (parsed.action?.includes('swap') || parsed.kind === 'swap') {
      const SOL_MINT = process.env.SOLANA_SOL_MINT || 'So11111111111111111111111111111111111111112';
      const USDC_MINT = process.env.SOLANA_USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      const rawAmount = Number(String(parsed.amount || '').replace(/,/g, '')) || 0;
      const unit = (parsed.amountUnit || '').toLowerCase();
      const decimals = unit === 'sol' ? 9 : 6;
      const amountUnits = BigInt(Math.floor(rawAmount * Math.pow(10, decimals)));
      const inputMint = unit === 'sol' ? SOL_MINT : USDC_MINT;
      const outputMint = unit === 'sol' ? USDC_MINT : SOL_MINT;

      if (amountUnits > 0n) {
        const quote = await getJupiterQuote({
          inputMint,
          outputMint,
          amount: amountUnits.toString(),
          slippageBps: 50,
        });
        if (quote) {
          solanaContext.jupiterQuote = quote;
        }
      }
    }
  } catch (error: any) {
    console.warn('[solana] Price/routing enrichment failed:', error.message);
  }

  // Create execution record for non-swap intents
  const solanaKind = parsed.kind === 'unknown' ? 'proof' : parsed.kind;
  const execution = await createExecutionAsync({
    chain: 'solana',
    network: 'devnet',
    kind: solanaKind as ExecutionKind,
    venue: route.venue as any,
    intent: parsed.rawParams.original || 'Intent execution',
    action: parsed.action,
    fromAddress: 'PENDING', // Will be updated
    token: parsed.amountUnit || 'SOL',
    usdEstimate: estimateIntentUsd(parsed),
    usdEstimateIsEstimate: true,
  });

  await linkExecutionToIntentAsync(execution.id, intentId);

  // For non-swap intents: Mark as confirmed with metadata
  await updateExecutionAsync(execution.id, {
    status: 'confirmed',
    latencyMs: Date.now() - startTime,
  });

  await updateIntentStatusAsync(intentId, {
    status: 'confirmed',
    confirmedAt: Math.floor(Date.now() / 1000),
    metadataJson: mergeMetadata(existingMetadataJson, {
      parsed,
      route,
      executedKind: route.executionType === 'real' ? 'real' : 'proof_only',
      executionId: execution.id,
      solana: solanaContext,
    }),
  });

  return {
    ok: true,
    intentId,
    status: 'confirmed',
    executionId: execution.id,
    metadata: {
      executedKind: route.executionType === 'real' ? 'real' : 'proof_only',
      solana: solanaContext,
    },
  };
}

/**
 * Run multiple intents in batch
 */
export async function runIntentBatch(
  intents: string[],
  options: {
    chain?: ChainTarget;
    dryRun?: boolean;
    parallel?: boolean;
  } = {}
): Promise<IntentExecutionResult[]> {
  if (options.parallel) {
    return Promise.all(intents.map(intent => runIntent(intent, options)));
  }

  const results: IntentExecutionResult[] = [];
  for (const intent of intents) {
    const result = await runIntent(intent, options);
    results.push(result);
  }
  return results;
}

/**
 * Record a failed intent for tracking purposes
 * This ensures ALL attempts (even validation failures) appear in stats
 */
export async function recordFailedIntent(params: {
  intentText: string;
  failureStage: IntentFailureStage;
  errorCode: string;
  errorMessage: string;
  metadata?: Record<string, any>;
}): Promise<IntentExecutionResult> {
  const { createIntent, updateIntentStatus } = await import('../../execution-ledger/db');

  const now = Math.floor(Date.now() / 1000);

  // Create intent record even for failures
  const intent = await createIntent({
    intentText: params.intentText || '[empty]',
    intentKind: 'unknown',
    metadataJson: JSON.stringify(params.metadata || {}),
  });

  // Immediately mark as failed
  await updateIntentStatus(intent.id, {
    status: 'failed',
    failureStage: params.failureStage,
    errorCode: params.errorCode,
    errorMessage: params.errorMessage,
    metadataJson: JSON.stringify({
      ...params.metadata,
    }),
  });

  return {
    ok: false,
    intentId: intent.id,
    status: 'failed',
    error: {
      stage: params.failureStage,
      code: params.errorCode,
      message: params.errorMessage,
    },
  };
}
