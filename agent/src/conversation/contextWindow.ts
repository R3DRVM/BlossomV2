// @ts-nocheck
/**
 * Context Window Manager
 *
 * Manages the sliding context window for LLM prompts:
 * - Token counting for context limits
 * - Priority retention for important messages
 * - Summarization for long histories
 *
 * Phase 3: Multi-Turn Conversation Context
 */

import type { ConversationMessage } from './conversationStore';

// ============================================
// Configuration
// ============================================

/** Approximate tokens per character (for estimation) */
const TOKENS_PER_CHAR = 0.25;

/** Maximum tokens for context window (leaving room for response) */
const MAX_CONTEXT_TOKENS = parseInt(process.env.MAX_CONTEXT_TOKENS || '4000', 10);

/** Token budget for summarization trigger */
const SUMMARIZATION_THRESHOLD = MAX_CONTEXT_TOKENS * 0.8;

// ============================================
// Token Estimation
// ============================================

/**
 * Estimate token count for a string
 * Uses a simple character-based approximation
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length * TOKENS_PER_CHAR);
}

/**
 * Estimate token count for a conversation message
 */
export function estimateMessageTokens(message: ConversationMessage): number {
  let tokens = estimateTokens(message.content);

  // Add overhead for role and metadata
  tokens += 4; // Role marker

  if (message.metadata) {
    // Estimate metadata tokens
    const metadataStr = JSON.stringify(message.metadata);
    tokens += estimateTokens(metadataStr);
  }

  return tokens;
}

/**
 * Calculate total tokens for an array of messages
 */
export function calculateTotalTokens(messages: ConversationMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

// ============================================
// Context Window Building
// ============================================

export interface ContextWindowOptions {
  /** Maximum tokens for the context */
  maxTokens?: number;

  /** Prioritize messages with intent metadata */
  prioritizeIntents?: boolean;

  /** Include system message at start */
  systemMessage?: string;

  /** Reserve tokens for the new user message */
  reserveForNewMessage?: number;
}

export interface ContextWindowResult {
  messages: ConversationMessage[];
  totalTokens: number;
  truncated: boolean;
  summarized: boolean;
  droppedCount: number;
}

/**
 * Build an optimized context window from conversation history
 */
export function buildContextWindow(
  messages: ConversationMessage[],
  options: ContextWindowOptions = {}
): ContextWindowResult {
  const {
    maxTokens = MAX_CONTEXT_TOKENS,
    prioritizeIntents = true,
    systemMessage,
    reserveForNewMessage = 500,
  } = options;

  const effectiveMaxTokens = maxTokens - reserveForNewMessage;
  let result: ConversationMessage[] = [];
  let totalTokens = 0;
  let droppedCount = 0;

  // Account for system message if present
  if (systemMessage) {
    totalTokens += estimateTokens(systemMessage) + 4;
  }

  // If messages fit within budget, return all
  const allTokens = calculateTotalTokens(messages);
  if (allTokens + totalTokens <= effectiveMaxTokens) {
    return {
      messages: [...messages],
      totalTokens: allTokens + totalTokens,
      truncated: false,
      summarized: false,
      droppedCount: 0,
    };
  }

  // Need to truncate - apply priority retention
  if (prioritizeIntents) {
    // Separate messages by priority
    const highPriority = messages.filter(
      m => m.metadata?.intentId || m.metadata?.executionId || m.metadata?.confirmed
    );
    const lowPriority = messages.filter(
      m => !m.metadata?.intentId && !m.metadata?.executionId && !m.metadata?.confirmed
    );

    // Always include first message (session context)
    const firstMessage = messages[0];
    if (firstMessage) {
      result.push(firstMessage);
      totalTokens += estimateMessageTokens(firstMessage);
    }

    // Add high priority messages (most recent first)
    for (let i = highPriority.length - 1; i >= 0; i--) {
      if (result.includes(highPriority[i])) continue;

      const msgTokens = estimateMessageTokens(highPriority[i]);
      if (totalTokens + msgTokens <= effectiveMaxTokens * 0.7) {
        result.push(highPriority[i]);
        totalTokens += msgTokens;
      } else {
        droppedCount++;
      }
    }

    // Fill remaining with low priority (most recent first)
    for (let i = lowPriority.length - 1; i >= 0; i--) {
      if (result.includes(lowPriority[i])) continue;

      const msgTokens = estimateMessageTokens(lowPriority[i]);
      if (totalTokens + msgTokens <= effectiveMaxTokens) {
        result.push(lowPriority[i]);
        totalTokens += msgTokens;
      } else {
        droppedCount++;
      }
    }
  } else {
    // Simple truncation: keep most recent
    for (let i = messages.length - 1; i >= 0; i--) {
      const msgTokens = estimateMessageTokens(messages[i]);
      if (totalTokens + msgTokens <= effectiveMaxTokens) {
        result.unshift(messages[i]);
        totalTokens += msgTokens;
      } else {
        droppedCount++;
      }
    }
  }

  // Sort by timestamp
  result.sort((a, b) => a.timestamp - b.timestamp);

  return {
    messages: result,
    totalTokens,
    truncated: true,
    summarized: false,
    droppedCount,
  };
}

// ============================================
// Summarization
// ============================================

/**
 * Generate a summary of conversation history
 * Uses a simple extractive approach (production would use LLM)
 */
export function summarizeHistory(messages: ConversationMessage[]): string {
  if (messages.length === 0) return '';

  const summaryParts: string[] = [];

  // Extract key actions
  const actions: string[] = [];
  for (const msg of messages) {
    if (msg.metadata?.parsedIntent) {
      const intent = msg.metadata.parsedIntent;
      actions.push(`${intent.action} ${intent.targetAsset || ''} ${intent.amount || ''}`.trim());
    }
    if (msg.metadata?.txHash) {
      actions.push(`Executed tx: ${msg.metadata.txHash.substring(0, 10)}...`);
    }
  }

  if (actions.length > 0) {
    summaryParts.push(`Previous actions: ${actions.slice(-5).join(', ')}`);
  }

  // Extract any errors or warnings
  const errors: string[] = [];
  for (const msg of messages) {
    if (msg.metadata?.error) {
      errors.push(msg.metadata.error);
    }
  }

  if (errors.length > 0) {
    summaryParts.push(`Previous errors: ${errors.slice(-2).join('; ')}`);
  }

  // Get last user intent
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      summaryParts.push(`Last user request: "${messages[i].content.substring(0, 100)}..."`);
      break;
    }
  }

  return summaryParts.join('\n');
}

/**
 * Check if summarization should be triggered
 */
export function shouldSummarize(messages: ConversationMessage[]): boolean {
  const totalTokens = calculateTotalTokens(messages);
  return totalTokens >= SUMMARIZATION_THRESHOLD;
}

// ============================================
// Prompt Building
// ============================================

export interface LLMPromptOptions {
  /** System prompt for the LLM */
  systemPrompt?: string;

  /** Current user message */
  userMessage: string;

  /** Conversation history */
  history: ConversationMessage[];

  /** Whether to include history summary */
  includeSummary?: boolean;

  /** Maximum tokens for context */
  maxContextTokens?: number;
}

export interface LLMPrompt {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  totalTokens: number;
  historyTruncated: boolean;
  summarized: boolean;
}

/**
 * Build a prompt for LLM with conversation context
 */
export function buildLLMPrompt(options: LLMPromptOptions): LLMPrompt {
  const {
    systemPrompt,
    userMessage,
    history,
    includeSummary = true,
    maxContextTokens = MAX_CONTEXT_TOKENS,
  } = options;

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
  let totalTokens = 0;

  // Add system prompt
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
    totalTokens += estimateTokens(systemPrompt) + 4;
  }

  // Reserve tokens for new message
  const userMessageTokens = estimateTokens(userMessage) + 4;
  const availableTokens = maxContextTokens - totalTokens - userMessageTokens;

  // Build context window from history
  let summarized = false;
  if (history.length > 0) {
    const windowResult = buildContextWindow(history, {
      maxTokens: availableTokens,
      prioritizeIntents: true,
      reserveForNewMessage: 0,
    });

    // Check if we should add a summary
    if (includeSummary && windowResult.droppedCount > 3) {
      const droppedMessages = history.slice(0, history.length - windowResult.messages.length);
      const summary = summarizeHistory(droppedMessages);

      if (summary) {
        messages.push({
          role: 'system',
          content: `[Conversation summary: ${summary}]`,
        });
        totalTokens += estimateTokens(summary) + 10;
        summarized = true;
      }
    }

    // Add history messages
    for (const msg of windowResult.messages) {
      messages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }

    totalTokens += windowResult.totalTokens;
  }

  // Add current user message
  messages.push({ role: 'user', content: userMessage });
  totalTokens += userMessageTokens;

  return {
    messages,
    totalTokens,
    historyTruncated: history.length > 0 && messages.length < history.length + 2,
    summarized,
  };
}

// ============================================
// Context-Aware Response Building
// ============================================

/**
 * Check if user is referencing previous context
 */
export function hasContextReference(text: string): boolean {
  const referencePatterns = [
    /\b(that|this|the|my|last|previous|same)\b/i,
    /\b(it|them|those)\b/i,
    /\b(again|too|also|more|less)\b/i,
    /\b(double|triple|half|increase|decrease)\b/i,
  ];

  return referencePatterns.some(pattern => pattern.test(text));
}

/**
 * Extract entity references from text
 */
export function extractReferences(text: string): {
  hasAmountRef: boolean;
  hasAssetRef: boolean;
  hasChainRef: boolean;
  hasVenueRef: boolean;
} {
  return {
    hasAmountRef: /\b(same\s+amount|that\s+amount|more|less|double|half)\b/i.test(text),
    hasAssetRef: /\b(same\s+(token|asset|coin)|that\s+(token|asset|coin))\b/i.test(text),
    hasChainRef: /\b(same\s+chain|that\s+chain|on\s+there)\b/i.test(text),
    hasVenueRef: /\b(same\s+(venue|protocol|exchange)|on\s+there|that\s+one)\b/i.test(text),
  };
}
