// @ts-nocheck
/**
 * Conversation Module
 *
 * Exports for multi-turn conversation support
 * Phase 3: Multi-Turn Conversation Context
 */

// Conversation store exports
export {
  getConversation,
  updateConversation,
  appendMessage,
  getContextWindow,
  clearConversation,
  deleteConversation,
  getConversationSummary,
  listSessions,
  getSessionCount,
  getLastParsedIntent,
  findIntentById,
  getRecentIntents,
  detectReference,
  applyReference,
  cleanupStaleConversations,
  type ConversationMessage,
  type ConversationContext,
  type ConversationSummary,
  type ConversationReference,
} from './conversationStore';

// Context window exports
export {
  estimateTokens,
  estimateMessageTokens,
  calculateTotalTokens,
  buildContextWindow,
  summarizeHistory,
  shouldSummarize,
  buildLLMPrompt,
  hasContextReference,
  extractReferences,
  type ContextWindowOptions,
  type ContextWindowResult,
  type LLMPromptOptions,
  type LLMPrompt,
} from './contextWindow';
