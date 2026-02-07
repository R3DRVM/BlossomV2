// @ts-nocheck
/**
 * Conversation Store
 *
 * Manages multi-turn conversation context for agentic interactions.
 * Persists conversation history per session with metadata for:
 * - Intent tracking
 * - Execution references
 * - Path state management
 *
 * Phase 3: Multi-Turn Conversation Context
 */

import type { ParsedIntent } from '../intent/intentRunner';
import { IntentPath } from '../intent/intentStateMachine';

// ============================================
// Types
// ============================================

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  metadata?: {
    intentId?: string;
    executionId?: string;
    parsedIntent?: ParsedIntent;
    path?: IntentPath;
    txHash?: string;
    explorerUrl?: string;
    confirmed?: boolean;
    error?: string;
  };
}

export interface ConversationContext {
  sessionId: string;
  walletAddress?: string;
  messages: ConversationMessage[];
  activeIntent?: ParsedIntent;
  confirmedIntents: Set<string>;
  currentPath: IntentPath;
  contextWindow: number; // Default 10
  createdAt: number;
  updatedAt: number;
}

export interface ConversationSummary {
  sessionId: string;
  messageCount: number;
  lastActivity: number;
  currentPath: IntentPath;
  hasActiveIntent: boolean;
  recentIntents: string[];
}

// ============================================
// Configuration
// ============================================

/** Default context window size (number of messages to retain in full) */
const DEFAULT_CONTEXT_WINDOW = parseInt(process.env.CONVERSATION_CONTEXT_WINDOW || '10', 10);

/** TTL for conversation cleanup (24 hours default) */
const CONVERSATION_TTL_MS = parseInt(process.env.CONVERSATION_TTL_HOURS || '24', 10) * 60 * 60 * 1000;

/** Maximum messages to store per conversation */
const MAX_MESSAGES_PER_CONVERSATION = 100;

// ============================================
// In-Memory Store
// (Upgrade to Redis/Postgres for production)
// ============================================

const conversations = new Map<string, ConversationContext>();

/**
 * Create a new conversation context
 */
function createConversation(sessionId: string, walletAddress?: string): ConversationContext {
  const now = Date.now();
  return {
    sessionId,
    walletAddress,
    messages: [],
    confirmedIntents: new Set(),
    currentPath: IntentPath.RESEARCH,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    createdAt: now,
    updatedAt: now,
  };
}

// ============================================
// Public API
// ============================================

/**
 * Get or create conversation for a session
 */
export function getConversation(sessionId: string): ConversationContext {
  let context = conversations.get(sessionId);

  if (!context) {
    context = createConversation(sessionId);
    conversations.set(sessionId, context);
  }

  return context;
}

/**
 * Update conversation context
 */
export function updateConversation(
  sessionId: string,
  updates: Partial<Omit<ConversationContext, 'sessionId' | 'createdAt'>>
): ConversationContext {
  const context = getConversation(sessionId);

  // Apply updates
  if (updates.walletAddress !== undefined) context.walletAddress = updates.walletAddress;
  if (updates.messages !== undefined) context.messages = updates.messages;
  if (updates.activeIntent !== undefined) context.activeIntent = updates.activeIntent;
  if (updates.confirmedIntents !== undefined) context.confirmedIntents = updates.confirmedIntents;
  if (updates.currentPath !== undefined) context.currentPath = updates.currentPath;
  if (updates.contextWindow !== undefined) context.contextWindow = updates.contextWindow;

  context.updatedAt = Date.now();
  conversations.set(sessionId, context);

  return context;
}

/**
 * Append a message to conversation history
 */
export function appendMessage(
  sessionId: string,
  message: Omit<ConversationMessage, 'timestamp'>
): ConversationContext {
  const context = getConversation(sessionId);

  const fullMessage: ConversationMessage = {
    ...message,
    timestamp: Date.now(),
  };

  context.messages.push(fullMessage);
  context.updatedAt = Date.now();

  // Trim if exceeds max messages
  if (context.messages.length > MAX_MESSAGES_PER_CONVERSATION) {
    // Keep first message (session start) and last N-1 messages
    context.messages = [
      context.messages[0],
      ...context.messages.slice(-(MAX_MESSAGES_PER_CONVERSATION - 1)),
    ];
  }

  conversations.set(sessionId, context);
  return context;
}

/**
 * Get context window for LLM prompt
 * Returns the most recent N messages, prioritizing those with intent metadata
 */
export function getContextWindow(sessionId: string, limit?: number): ConversationMessage[] {
  const context = getConversation(sessionId);
  const effectiveLimit = limit ?? context.contextWindow;

  if (context.messages.length <= effectiveLimit) {
    return [...context.messages];
  }

  // Priority retention: keep messages with intent metadata
  const messagesWithMetadata = context.messages.filter(
    m => m.metadata?.intentId || m.metadata?.executionId || m.metadata?.parsedIntent
  );

  const messagesWithoutMetadata = context.messages.filter(
    m => !m.metadata?.intentId && !m.metadata?.executionId && !m.metadata?.parsedIntent
  );

  // Build context window: recent messages + messages with metadata
  const result: ConversationMessage[] = [];

  // Always include messages with metadata (up to half the limit)
  const metadataLimit = Math.floor(effectiveLimit / 2);
  const recentMetadata = messagesWithMetadata.slice(-metadataLimit);
  result.push(...recentMetadata);

  // Fill remaining with most recent messages
  const remainingLimit = effectiveLimit - result.length;
  const recentWithout = messagesWithoutMetadata.slice(-remainingLimit);

  // Merge and sort by timestamp
  result.push(...recentWithout);
  result.sort((a, b) => a.timestamp - b.timestamp);

  return result;
}

/**
 * Clear conversation history but keep session
 */
export function clearConversation(sessionId: string): void {
  const context = conversations.get(sessionId);
  if (context) {
    context.messages = [];
    context.activeIntent = undefined;
    context.currentPath = IntentPath.RESEARCH;
    context.updatedAt = Date.now();
    conversations.set(sessionId, context);
  }
}

/**
 * Delete conversation completely
 */
export function deleteConversation(sessionId: string): void {
  conversations.delete(sessionId);
}

/**
 * Get conversation summary (for debugging/monitoring)
 */
export function getConversationSummary(sessionId: string): ConversationSummary | null {
  const context = conversations.get(sessionId);
  if (!context) return null;

  const recentIntents: string[] = [];
  for (let i = context.messages.length - 1; i >= 0 && recentIntents.length < 5; i--) {
    const intentId = context.messages[i].metadata?.intentId;
    if (intentId && !recentIntents.includes(intentId)) {
      recentIntents.push(intentId);
    }
  }

  return {
    sessionId,
    messageCount: context.messages.length,
    lastActivity: context.updatedAt,
    currentPath: context.currentPath,
    hasActiveIntent: !!context.activeIntent,
    recentIntents,
  };
}

/**
 * List all active sessions (for debugging)
 */
export function listSessions(): string[] {
  return Array.from(conversations.keys());
}

/**
 * Get total session count
 */
export function getSessionCount(): number {
  return conversations.size;
}

// ============================================
// Intent Continuity Helpers
// ============================================

/**
 * Find the most recent parsed intent from conversation
 */
export function getLastParsedIntent(sessionId: string): ParsedIntent | undefined {
  const context = conversations.get(sessionId);
  if (!context) return undefined;

  // Search backwards for most recent intent
  for (let i = context.messages.length - 1; i >= 0; i--) {
    if (context.messages[i].metadata?.parsedIntent) {
      return context.messages[i].metadata!.parsedIntent;
    }
  }

  return context.activeIntent;
}

/**
 * Find intent by ID from conversation history
 */
export function findIntentById(sessionId: string, intentId: string): ParsedIntent | undefined {
  const context = conversations.get(sessionId);
  if (!context) return undefined;

  for (const msg of context.messages) {
    if (msg.metadata?.intentId === intentId && msg.metadata?.parsedIntent) {
      return msg.metadata.parsedIntent;
    }
  }

  return undefined;
}

/**
 * Get the last N intents from conversation
 */
export function getRecentIntents(sessionId: string, limit: number = 3): ParsedIntent[] {
  const context = conversations.get(sessionId);
  if (!context) return [];

  const intents: ParsedIntent[] = [];
  const seen = new Set<string>();

  for (let i = context.messages.length - 1; i >= 0 && intents.length < limit; i--) {
    const parsed = context.messages[i].metadata?.parsedIntent;
    const intentId = context.messages[i].metadata?.intentId;

    if (parsed && intentId && !seen.has(intentId)) {
      intents.push(parsed);
      seen.add(intentId);
    }
  }

  return intents.reverse(); // Chronological order
}

// ============================================
// Conversation References (Intent Continuity)
// ============================================

/**
 * Reference patterns for conversational continuity
 */
const REFERENCE_PATTERNS = {
  lastTrade: /\b(my\s+)?last\s+(trade|swap|order|execution|transaction)\b/i,
  previousIntent: /\b(previous|last|that|this)\s+(one|intent|action)\b/i,
  cancelThat: /\b(cancel|undo|revert|stop)\s+(that|this|it)\b/i,
  modifyLast: /\b(modify|change|update|adjust)\s+(my\s+)?(last|previous|that)\b/i,
  doubleSize: /\b(double|2x|twice)\s+(the\s+)?(size|amount)\b/i,
  halfSize: /\b(half|halve|50%|reduce)\s+(the\s+)?(size|amount)\b/i,
  sameOnChain: /\bsame\s+(but\s+)?(on|for)\s+(\w+)\b/i,
};

export interface ConversationReference {
  type: 'lastTrade' | 'previousIntent' | 'cancelThat' | 'modifyLast' | 'doubleSize' | 'halfSize' | 'sameOnChain';
  chainOverride?: string;
  amountMultiplier?: number;
  referencedIntent?: ParsedIntent;
}

/**
 * Detect conversational references in user input
 */
export function detectReference(
  sessionId: string,
  text: string
): ConversationReference | null {
  const normalizedText = text.toLowerCase().trim();

  // Check for size modifiers
  if (REFERENCE_PATTERNS.doubleSize.test(normalizedText)) {
    const lastIntent = getLastParsedIntent(sessionId);
    return {
      type: 'doubleSize',
      amountMultiplier: 2,
      referencedIntent: lastIntent,
    };
  }

  if (REFERENCE_PATTERNS.halfSize.test(normalizedText)) {
    const lastIntent = getLastParsedIntent(sessionId);
    return {
      type: 'halfSize',
      amountMultiplier: 0.5,
      referencedIntent: lastIntent,
    };
  }

  // Check for chain override
  const chainMatch = normalizedText.match(REFERENCE_PATTERNS.sameOnChain);
  if (chainMatch) {
    const lastIntent = getLastParsedIntent(sessionId);
    return {
      type: 'sameOnChain',
      chainOverride: chainMatch[3],
      referencedIntent: lastIntent,
    };
  }

  // Check for cancel
  if (REFERENCE_PATTERNS.cancelThat.test(normalizedText)) {
    const lastIntent = getLastParsedIntent(sessionId);
    return {
      type: 'cancelThat',
      referencedIntent: lastIntent,
    };
  }

  // Check for modification
  if (REFERENCE_PATTERNS.modifyLast.test(normalizedText)) {
    const lastIntent = getLastParsedIntent(sessionId);
    return {
      type: 'modifyLast',
      referencedIntent: lastIntent,
    };
  }

  // Check for last trade reference
  if (REFERENCE_PATTERNS.lastTrade.test(normalizedText) ||
      REFERENCE_PATTERNS.previousIntent.test(normalizedText)) {
    const lastIntent = getLastParsedIntent(sessionId);
    return {
      type: 'lastTrade',
      referencedIntent: lastIntent,
    };
  }

  return null;
}

/**
 * Apply a reference to create a modified intent
 */
export function applyReference(
  reference: ConversationReference,
  originalIntent: ParsedIntent
): ParsedIntent | null {
  if (!originalIntent) return null;

  const modified: ParsedIntent = { ...originalIntent };

  switch (reference.type) {
    case 'doubleSize':
    case 'halfSize':
      if (modified.amount && reference.amountMultiplier) {
        const currentAmount = parseFloat(modified.amount);
        modified.amount = (currentAmount * reference.amountMultiplier).toString();
      }
      modified.rawParams = {
        ...modified.rawParams,
        modifiedFrom: 'reference',
        amountMultiplier: reference.amountMultiplier,
      };
      return modified;

    case 'sameOnChain':
      if (reference.chainOverride) {
        modified.sourceChain = reference.chainOverride;
        modified.rawParams = {
          ...modified.rawParams,
          modifiedFrom: 'reference',
          chainOverride: reference.chainOverride,
        };
      }
      return modified;

    case 'modifyLast':
      // Return original for modification flow - caller handles specifics
      modified.rawParams = {
        ...modified.rawParams,
        modifiedFrom: 'reference',
        isModification: true,
      };
      return modified;

    case 'cancelThat':
    case 'lastTrade':
    case 'previousIntent':
      // Just return the referenced intent
      return modified;

    default:
      return null;
  }
}

// ============================================
// Cleanup
// ============================================

/**
 * Cleanup stale conversations (run periodically)
 */
export function cleanupStaleConversations(): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [sessionId, context] of conversations) {
    if (now - context.updatedAt > CONVERSATION_TTL_MS) {
      conversations.delete(sessionId);
      cleaned++;
    }
  }

  return cleaned;
}

// Run cleanup every hour
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const cleaned = cleanupStaleConversations();
    if (cleaned > 0) {
      console.log(`[conversation] Cleaned up ${cleaned} stale conversations`);
    }
  }, 60 * 60 * 1000);
}
