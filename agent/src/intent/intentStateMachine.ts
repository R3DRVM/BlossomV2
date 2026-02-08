// @ts-nocheck
/**
 * Intent Path Isolation State Machine
 *
 * Prevents research intents from accidentally triggering execution.
 * Enforces explicit confirmation flow for high-risk operations.
 *
 * Paths are mutually exclusive execution contexts:
 * - RESEARCH: Read-only queries (prices, analytics, exposure)
 * - PLANNING: Preview mode that requires explicit confirmation
 * - EXECUTION: Real on-chain transactions (swaps, deposits, perps)
 * - CREATION: HIP-3 market creation (special flow with bond acknowledgment)
 * - EVENT_BETTING: Prediction market actions (requires risk acknowledgment)
 */

import type { ParsedIntent } from './intentRunner';

// ============================================
// Intent Paths - Mutually Exclusive Contexts
// ============================================

export enum IntentPath {
  RESEARCH = 'research',      // Read-only: prices, analytics, exposure queries
  PLANNING = 'planning',      // Preview mode: requires explicit confirmation
  EXECUTION = 'execution',    // Real on-chain: swaps, deposits, perps
  CREATION = 'creation',      // HIP-3 market creation (special flow)
  EVENT_BETTING = 'event',    // Prediction market actions
}

// ============================================
// Intent States - Lifecycle Tracking
// ============================================

export enum IntentState {
  IDLE = 'idle',              // No active intent
  PARSING = 'parsing',        // Parsing user input
  CLASSIFIED = 'classified',  // Intent path determined
  CONFIRMING = 'confirming',  // Awaiting user confirmation
  EXECUTING = 'executing',    // Executing on-chain
  COMPLETED = 'completed',    // Successfully completed
  FAILED = 'failed',          // Failed at some stage
  CANCELLED = 'cancelled',    // User cancelled
}

// ============================================
// Confirmation Requirements
// ============================================

export enum ConfirmationType {
  NONE = 'none',                    // No confirmation needed
  SIMPLE = 'simple',                // Simple "yes"/"execute" confirmation
  BOND_ACK = 'bond_ack',            // Acknowledge bond requirement (HIP-3)
  RISK_ACK = 'risk_ack',            // Acknowledge prediction market risk
  HIGH_VALUE_ACK = 'high_value_ack', // Acknowledge high-value transaction
}

// ============================================
// Transition Guards
// ============================================

/**
 * Blocked transitions that require special handling
 * Format: 'fromPath:toPath' -> block type
 */
export const BLOCKED_TRANSITIONS: Record<string, ConfirmationType | true> = {
  'research:execution': true,           // MUST go through planning first
  'planning:execution': ConfirmationType.SIMPLE,  // Requires confirmation
  'creation:execution': ConfirmationType.BOND_ACK, // Requires bond acknowledgment
  'event:execution': ConfirmationType.RISK_ACK,    // Requires risk acknowledgment
};

/**
 * High-value threshold for additional confirmation (in USD)
 */
export const HIGH_VALUE_THRESHOLD_USD = 10000;

/**
 * Keywords that trigger confirmation bypass (user explicitly confirming)
 */
export const CONFIRMATION_KEYWORDS = [
  'yes',
  'execute',
  'confirm',
  'proceed',
  'do it',
  'go ahead',
  'submit',
  'run it',
  'send it',
  'lets go',
  "let's go",
  'approve',
  'ok',
  'okay',
];

/**
 * Keywords that trigger cancellation
 */
export const CANCELLATION_KEYWORDS = [
  'no',
  'cancel',
  'stop',
  'abort',
  'nevermind',
  'never mind',
  "don't",
  'dont',
  'wait',
  'hold on',
  'back',
  'undo',
];

// ============================================
// State Machine Context
// ============================================

export interface IntentContext {
  sessionId: string;
  walletAddress?: string;
  currentPath: IntentPath;
  currentState: IntentState;
  pendingIntent?: ParsedIntent;
  pendingIntentId?: string;
  pendingUsdEstimate?: number;
  confirmationType?: ConfirmationType;
  lastConfirmationRequest?: number; // Timestamp
  confirmedIntentIds: Set<string>;
  metadata?: Record<string, any>;
}

/**
 * Create a new intent context for a session
 */
export function createIntentContext(sessionId: string, walletAddress?: string): IntentContext {
  return {
    sessionId,
    walletAddress,
    currentPath: IntentPath.RESEARCH,
    currentState: IntentState.IDLE,
    confirmedIntentIds: new Set(),
  };
}

// ============================================
// Path Classification
// ============================================

/**
 * Research intent patterns - read-only queries
 */
const RESEARCH_PATTERNS = [
  /^(what|show|get|display|list|check|view|tell me)\b/i,
  /\b(price|prices|value|worth|balance|balances|exposure|positions?|holdings?)\b/i,
  /\b(how much|how many|what is|whats|what's)\b/i,
  /\b(top|best|highest|tvl|volume|apy|apr|yield)\b.*\b(protocol|market|vault|pool)s?\b/i,
  /\b(analytics|stats|statistics|metrics|report)\b/i,
];

/**
 * Execution intent patterns - on-chain actions
 */
const EXECUTION_PATTERNS = [
  /\b(swap|exchange|trade|convert|buy|sell)\b/i,
  /\b(deposit|withdraw|supply|stake|unstake)\b/i,
  /\b(long|short)\b.*\b(eth|btc|sol|perp)\b/i,
  /\b(bridge|transfer|send|move)\b.*\b(from|to)\b/i,
  /\b(\d+)\s*x\b.*\b(eth|btc|sol|btc)\b/i,
];

/**
 * Creation intent patterns - HIP-3 market creation
 */
const CREATION_PATTERNS = [
  /\b(launch|create|deploy|register)\b.*\b(perp|perpetual|market|futures?)\b/i,
  /\bhip-?3\b/i,
  /\b(new|list)\b.*\b(perp|perpetual|market)\b/i,
];

/**
 * Event betting patterns - prediction markets
 */
const EVENT_BETTING_PATTERNS = [
  /\b(bet|wager|stake)\b.*\b(on|that)\b/i,
  /\b(prediction|pred)\s*market/i,
  /\b(yes|no)\b.*\b(on|that|if)\b/i,
  /\b(above|below|over|under)\s*\$?\d+/i,
  /\bpolymarket\b/i,
];

// ============================================
// Category Blacklists - Prevent Cross-Path Mismatch
// ============================================

/**
 * Keywords that MUST NOT appear in EVENT_BETTING intents
 * (prevents "bet on BTC long" from being routed to events)
 */
const EVENT_BETTING_BLACKLIST_PATTERNS = [
  /\bperp\b/i,
  /\bperpetual\b/i,
  /\bfutures?\b/i,
  /\bleverage\b/i,
  /\bmargin\b/i,
  /\blong\s+(position|eth|btc|sol)\b/i,
  /\b(eth|btc|sol)\s+long\b/i,             // "BTC long"
  /\bshort\s+(position|eth|btc|sol)\b/i,
  /\b(eth|btc|sol)\s+short\b/i,            // "ETH short"
  /\bopen\s+(long|short)\b/i,
  /\b\d+x\s*(long|short|leverage)?\b/i,
  /\bgo\s+(long|short)\b/i,                // "go long on"
];

/**
 * Keywords that MUST NOT appear in PERP/EXECUTION intents
 * (prevents "long ETH prediction" from being routed to perps)
 */
const EXECUTION_BLACKLIST_PATTERNS = [
  /\bbet\s+on\b/i,
  /\bwager\b/i,
  /\boutcome\b/i,
  /\bprediction\s*market\b/i,
  /\bprediction\b/i,
  /\bpolymarket\b/i,
  /\bplace\s+bet\b/i,
  /\bbetting\s+on\b/i,
];

/**
 * Keywords that MUST NOT appear in CREATION intents
 * (prevents "create bet market" from being routed to HIP-3)
 */
const CREATION_BLACKLIST_PATTERNS = [
  /\bbet\b/i,
  /\bwager\b/i,
  /\boutcome\b/i,
  /\bprediction\b/i,
  /\bevent\s+market\b/i,
  /\bbetting\s+market\b/i,
  /\bpolymarket\b/i,
];

/**
 * Validate path integrity - check for conflicting keywords
 * Returns null if valid, or error info if mismatch detected
 */
export function validatePathIntegrity(
  intentText: string,
  detectedPath: IntentPath
): { valid: false; conflictingKeywords: string[]; suggestedPath?: IntentPath } | { valid: true } {
  const text = intentText;
  const conflicts: string[] = [];

  if (detectedPath === IntentPath.EVENT_BETTING) {
    // Check for perp/execution keywords in event intent
    for (const pattern of EVENT_BETTING_BLACKLIST_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        conflicts.push(match[0]);
      }
    }
    if (conflicts.length > 0) {
      return {
        valid: false,
        conflictingKeywords: conflicts,
        suggestedPath: IntentPath.PLANNING, // Suggest perp path
      };
    }
  }

  if (detectedPath === IntentPath.PLANNING || detectedPath === IntentPath.EXECUTION) {
    // Check for event/betting keywords in perp intent
    for (const pattern of EXECUTION_BLACKLIST_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        conflicts.push(match[0]);
      }
    }
    if (conflicts.length > 0) {
      return {
        valid: false,
        conflictingKeywords: conflicts,
        suggestedPath: IntentPath.EVENT_BETTING, // Suggest event path
      };
    }
  }

  if (detectedPath === IntentPath.CREATION) {
    // Check for event keywords in creation intent
    for (const pattern of CREATION_BLACKLIST_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        conflicts.push(match[0]);
      }
    }
    if (conflicts.length > 0) {
      return {
        valid: false,
        conflictingKeywords: conflicts,
        suggestedPath: IntentPath.EVENT_BETTING,
      };
    }
  }

  return { valid: true };
}

/**
 * Classify intent with path integrity validation
 * Returns path and optional mismatch error
 */
export interface ClassifyResult {
  path: IntentPath;
  mismatch?: {
    detectedPath: IntentPath;
    conflictingKeywords: string[];
    suggestedPath?: IntentPath;
    message: string;
  };
}

export function classifyIntentPathWithValidation(intentText: string): ClassifyResult {
  const path = classifyIntentPath(intentText);
  const validation = validatePathIntegrity(intentText, path);

  if (!validation.valid) {
    return {
      path: IntentPath.RESEARCH, // Fall back to safe research path
      mismatch: {
        detectedPath: path,
        conflictingKeywords: validation.conflictingKeywords,
        suggestedPath: validation.suggestedPath,
        message: `Intent contains conflicting keywords: "${validation.conflictingKeywords.join('", "')}". ` +
          `Did you mean to ${path === IntentPath.EVENT_BETTING ? 'open a position' : 'place a bet'}?`,
      },
    };
  }

  return { path };
}

/**
 * Classify intent text into a path
 */
export function classifyIntentPath(intentText: string): IntentPath {
  const text = intentText.toLowerCase().trim();

  // Check for creation first (most specific)
  for (const pattern of CREATION_PATTERNS) {
    if (pattern.test(text)) {
      return IntentPath.CREATION;
    }
  }

  // Check for event betting
  for (const pattern of EVENT_BETTING_PATTERNS) {
    if (pattern.test(text)) {
      return IntentPath.EVENT_BETTING;
    }
  }

  // Check for execution intents
  for (const pattern of EXECUTION_PATTERNS) {
    if (pattern.test(text)) {
      return IntentPath.PLANNING; // Go to planning first, not direct execution
    }
  }

  // Check for research intents
  for (const pattern of RESEARCH_PATTERNS) {
    if (pattern.test(text)) {
      return IntentPath.RESEARCH;
    }
  }

  // Default to research for unknown intents (safer)
  return IntentPath.RESEARCH;
}

/**
 * Classify parsed intent into a path based on kind
 */
export function classifyParsedIntentPath(parsed: ParsedIntent): IntentPath {
  switch (parsed.kind) {
    case 'perp_create':
      return IntentPath.CREATION;
    case 'event':
      return IntentPath.EVENT_BETTING;
    case 'swap':
    case 'deposit':
    case 'perp':
    case 'bridge':
      return IntentPath.PLANNING;
    case 'unknown':
    default:
      // Check raw params for intent type
      if (parsed.rawParams?.intentType === 'analytics') {
        return IntentPath.RESEARCH;
      }
      if (parsed.rawParams?.intentType === 'event' || parsed.rawParams?.intentType === 'prediction') {
        return IntentPath.EVENT_BETTING;
      }
      if (parsed.rawParams?.intentType === 'hedge' || parsed.rawParams?.intentType === 'vault_discovery') {
        return IntentPath.RESEARCH;
      }
      return IntentPath.RESEARCH;
  }
}

// ============================================
// Transition Validation
// ============================================

export interface TransitionResult {
  allowed: boolean;
  requiresConfirmation: boolean;
  confirmationType?: ConfirmationType;
  blockedReason?: string;
}

/**
 * Check if a path transition is allowed
 */
export function validateTransition(
  fromPath: IntentPath,
  toPath: IntentPath,
  usdEstimate?: number
): TransitionResult {
  // Same path transition is always allowed
  if (fromPath === toPath) {
    return { allowed: true, requiresConfirmation: false };
  }

  // Research can transition to any path except direct execution
  if (fromPath === IntentPath.RESEARCH && toPath === IntentPath.EXECUTION) {
    return {
      allowed: false,
      requiresConfirmation: true,
      confirmationType: ConfirmationType.SIMPLE,
      blockedReason: 'Cannot transition directly from research to execution. Review the plan first.',
    };
  }

  // Check blocked transitions
  const transitionKey = `${fromPath}:${toPath}`;
  const blockType = BLOCKED_TRANSITIONS[transitionKey];

  if (blockType === true) {
    return {
      allowed: false,
      requiresConfirmation: true,
      confirmationType: ConfirmationType.SIMPLE,
      blockedReason: 'This action requires explicit confirmation.',
    };
  }

  if (typeof blockType === 'string') {
    return {
      allowed: false,
      requiresConfirmation: true,
      confirmationType: blockType as ConfirmationType,
      blockedReason: getConfirmationMessage(blockType as ConfirmationType),
    };
  }

  // Check for high-value transactions
  if (toPath === IntentPath.EXECUTION && usdEstimate && usdEstimate >= HIGH_VALUE_THRESHOLD_USD) {
    return {
      allowed: false,
      requiresConfirmation: true,
      confirmationType: ConfirmationType.HIGH_VALUE_ACK,
      blockedReason: `High-value transaction ($${usdEstimate.toLocaleString()}) requires confirmation.`,
    };
  }

  return { allowed: true, requiresConfirmation: false };
}

/**
 * Get confirmation message for a confirmation type
 */
function getConfirmationMessage(type: ConfirmationType): string {
  switch (type) {
    case ConfirmationType.SIMPLE:
      return "This action requires explicit confirmation. Reply 'execute' to proceed.";
    case ConfirmationType.BOND_ACK:
      return 'Market creation requires a HYPE bond. Reply "I understand the bond requirements" to proceed.';
    case ConfirmationType.RISK_ACK:
      return 'Prediction market betting carries risk of total loss. Reply "I accept the risk" to proceed.';
    case ConfirmationType.HIGH_VALUE_ACK:
      return 'This is a high-value transaction. Please review the details carefully and reply "confirm" to proceed.';
    default:
      return "Reply 'yes' to proceed.";
  }
}

// ============================================
// Confirmation Detection
// ============================================

/**
 * Check if user input is a confirmation
 */
export function isConfirmation(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  return CONFIRMATION_KEYWORDS.some(keyword => normalized.includes(keyword));
}

/**
 * Check if user input is a cancellation
 */
export function isCancellation(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  return CANCELLATION_KEYWORDS.some(keyword => normalized.includes(keyword));
}

/**
 * Check if confirmation text matches required type
 */
export function matchesConfirmationType(text: string, type: ConfirmationType): boolean {
  const normalized = text.toLowerCase().trim();

  switch (type) {
    case ConfirmationType.NONE:
      return true;
    case ConfirmationType.SIMPLE:
      return CONFIRMATION_KEYWORDS.some(keyword => normalized.includes(keyword));
    case ConfirmationType.BOND_ACK:
      return normalized.includes('understand') && normalized.includes('bond');
    case ConfirmationType.RISK_ACK:
      return normalized.includes('accept') && normalized.includes('risk');
    case ConfirmationType.HIGH_VALUE_ACK:
      return normalized.includes('confirm') || normalized.includes('proceed');
    default:
      return CONFIRMATION_KEYWORDS.some(keyword => normalized.includes(keyword));
  }
}

// ============================================
// Context Management
// ============================================

/**
 * In-memory context store (upgrade to Redis/Postgres for production)
 */
const contexts = new Map<string, IntentContext>();

/**
 * Get or create context for a session
 */
export function getContext(sessionId: string): IntentContext {
  let context = contexts.get(sessionId);
  if (!context) {
    context = createIntentContext(sessionId);
    contexts.set(sessionId, context);
  }
  return context;
}

/**
 * Update context for a session
 */
export function updateContext(sessionId: string, updates: Partial<IntentContext>): IntentContext {
  const context = getContext(sessionId);
  Object.assign(context, updates);
  contexts.set(sessionId, context);
  return context;
}

/**
 * Clear context for a session
 */
export function clearContext(sessionId: string): void {
  contexts.delete(sessionId);
}

/**
 * Reset context to idle state (keeps session, clears pending intent)
 */
export function resetContextState(sessionId: string): IntentContext {
  const context = getContext(sessionId);
  context.currentState = IntentState.IDLE;
  context.pendingIntent = undefined;
  context.pendingIntentId = undefined;
  context.pendingUsdEstimate = undefined;
  context.confirmationType = undefined;
  context.lastConfirmationRequest = undefined;
  // Keep currentPath - don't reset to research unless explicitly requested
  return context;
}

/**
 * Transition context to a new path with validation
 */
export function transitionPath(
  sessionId: string,
  newPath: IntentPath,
  options?: {
    force?: boolean;
    parsed?: ParsedIntent;
    intentId?: string;
    usdEstimate?: number;
  }
): { context: IntentContext; transitionResult: TransitionResult } {
  const context = getContext(sessionId);
  const transitionResult = options?.force
    ? { allowed: true, requiresConfirmation: false }
    : validateTransition(context.currentPath, newPath, options?.usdEstimate);

  if (transitionResult.allowed) {
    context.currentPath = newPath;
    context.currentState = IntentState.CLASSIFIED;
    if (options?.parsed) {
      context.pendingIntent = options.parsed;
    }
    if (options?.intentId) {
      context.pendingIntentId = options.intentId;
    }
    if (options?.usdEstimate !== undefined) {
      context.pendingUsdEstimate = options.usdEstimate;
    }
  } else if (transitionResult.requiresConfirmation) {
    context.currentState = IntentState.CONFIRMING;
    context.confirmationType = transitionResult.confirmationType;
    context.lastConfirmationRequest = Date.now();
    if (options?.parsed) {
      context.pendingIntent = options.parsed;
    }
    if (options?.intentId) {
      context.pendingIntentId = options.intentId;
    }
    if (options?.usdEstimate !== undefined) {
      context.pendingUsdEstimate = options.usdEstimate;
    }
  }

  contexts.set(sessionId, context);
  return { context, transitionResult };
}

/**
 * Process confirmation and potentially transition to execution
 */
export function processConfirmation(
  sessionId: string,
  confirmationText: string
): { confirmed: boolean; context: IntentContext; message?: string } {
  const context = getContext(sessionId);

  if (context.currentState !== IntentState.CONFIRMING) {
    return {
      confirmed: false,
      context,
      message: 'No pending confirmation to process.',
    };
  }

  if (isCancellation(confirmationText)) {
    context.currentState = IntentState.CANCELLED;
    context.pendingIntent = undefined;
    context.pendingIntentId = undefined;
    contexts.set(sessionId, context);
    return {
      confirmed: false,
      context,
      message: 'Action cancelled. What else can I help you with?',
    };
  }

  const matches = matchesConfirmationType(confirmationText, context.confirmationType || ConfirmationType.SIMPLE);

  if (matches) {
    // Confirm the pending intent
    if (context.pendingIntentId) {
      context.confirmedIntentIds.add(context.pendingIntentId);
    }
    context.currentPath = IntentPath.EXECUTION;
    context.currentState = IntentState.EXECUTING;
    contexts.set(sessionId, context);
    return {
      confirmed: true,
      context,
    };
  }

  return {
    confirmed: false,
    context,
    message: getConfirmationMessage(context.confirmationType || ConfirmationType.SIMPLE),
  };
}

/**
 * Mark execution as completed
 */
export function markExecutionComplete(sessionId: string, success: boolean): IntentContext {
  const context = getContext(sessionId);
  context.currentState = success ? IntentState.COMPLETED : IntentState.FAILED;
  // Reset path to research after execution
  context.currentPath = IntentPath.RESEARCH;
  context.pendingIntent = undefined;
  context.pendingIntentId = undefined;
  contexts.set(sessionId, context);
  return context;
}

// ============================================
// Session Policy Integration
// ============================================

export interface PathPolicyResult {
  allowed: boolean;
  code?: string;
  message?: string;
  requiresConfirmation?: boolean;
  confirmationType?: ConfirmationType;
}

/**
 * Evaluate path-based policy for an intent
 * Called before execution to enforce path isolation
 */
export function evaluatePathPolicy(
  sessionId: string,
  intentPath: IntentPath,
  options?: {
    parsed?: ParsedIntent;
    intentId?: string;
    usdEstimate?: number;
  }
): PathPolicyResult {
  const context = getContext(sessionId);

  // If context is in CONFIRMING state and this is the confirmed intent, allow
  if (
    context.currentState === IntentState.CONFIRMING &&
    options?.intentId &&
    context.pendingIntentId === options.intentId
  ) {
    return { allowed: false, requiresConfirmation: true, confirmationType: context.confirmationType };
  }

  // If intent has already been confirmed, allow execution
  if (options?.intentId && context.confirmedIntentIds.has(options.intentId)) {
    return { allowed: true };
  }

  // Validate the path transition
  const transitionResult = validateTransition(context.currentPath, intentPath, options?.usdEstimate);

  if (!transitionResult.allowed) {
    return {
      allowed: false,
      code: 'PATH_TRANSITION_BLOCKED',
      message: transitionResult.blockedReason || 'Path transition not allowed',
      requiresConfirmation: transitionResult.requiresConfirmation,
      confirmationType: transitionResult.confirmationType,
    };
  }

  return { allowed: true };
}

// ============================================
// Logging
// ============================================

/**
 * Log state machine transition for debugging
 */
export function logTransition(
  sessionId: string,
  event: string,
  details?: Record<string, any>
): void {
  const context = contexts.get(sessionId);
  console.log(`[StateMachine] ${sessionId.substring(0, 8)}... | ${event}`, {
    path: context?.currentPath,
    state: context?.currentState,
    ...details,
  });
}
