/**
 * Failure Analytics Module
 * Tracks, categorizes, and analyzes failure patterns for debugging insights.
 *
 * Failure Categories:
 * - parse: LLM/input parsing failures
 * - validation: Request validation failures
 * - execution: On-chain execution failures
 * - network: RPC/network connectivity failures
 * - timeout: Request/transaction timeouts
 * - auth: Authentication/authorization failures
 * - rate_limit: Rate limiting rejections
 * - unknown: Uncategorized failures
 */

// Failure categories
export type FailureCategory =
  | 'parse'
  | 'validation'
  | 'execution'
  | 'network'
  | 'timeout'
  | 'auth'
  | 'rate_limit'
  | 'unknown';

// Intent types for categorization
export type IntentType = 'swap' | 'perp' | 'defi' | 'event' | 'transfer' | 'session' | 'bridge' | 'other';

// Chain types
export type Chain = 'ethereum' | 'solana' | 'hyperliquid' | 'unknown';

export interface FailureRecord {
  id: string;
  timestamp: number;
  category: FailureCategory;
  intentType: IntentType;
  chain: Chain;
  errorCode?: string;
  errorMessage: string;
  endpoint?: string;
  walletHash?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

export interface FailureMetrics {
  // Overall failure counts
  totalFailures: number;
  failuresLast24h: number;
  failuresLast1h: number;

  // Failure rate calculations
  overallFailureRate: number;  // failures / total requests
  failureRate24h: number;
  failureRate1h: number;

  // By category
  byCategory: Record<FailureCategory, {
    count: number;
    last24h: number;
    percentage: number;
    topErrors: Array<{ code: string; count: number }>;
  }>;

  // By intent type
  byIntentType: Record<IntentType, {
    count: number;
    failureRate: number;
    topCategories: FailureCategory[];
  }>;

  // By chain
  byChain: Record<Chain, {
    count: number;
    failureRate: number;
    topErrors: Array<{ code: string; count: number }>;
  }>;

  // Temporal patterns
  hourlyTrend: Array<{ hour: number; failures: number; rate: number }>;

  // Top errors overall
  topErrors: Array<{
    code: string;
    message: string;
    count: number;
    category: FailureCategory;
    lastOccurred: number;
  }>;

  // Debugging insights
  insights: string[];

  generatedAt: string;
}

// In-memory storage for failures
const failureStore: FailureRecord[] = [];
let totalRequestCount = 0;

// Common error patterns for categorization
const ERROR_PATTERNS: Array<{ pattern: RegExp; category: FailureCategory; code: string }> = [
  // Parse errors
  { pattern: /JSON\.parse|SyntaxError|Unexpected token/i, category: 'parse', code: 'JSON_PARSE_ERROR' },
  { pattern: /Invalid.*format|malformed/i, category: 'parse', code: 'INVALID_FORMAT' },
  { pattern: /Failed to parse|parse.*fail/i, category: 'parse', code: 'PARSE_FAILURE' },

  // Validation errors
  { pattern: /Invalid.*address|address.*invalid/i, category: 'validation', code: 'INVALID_ADDRESS' },
  { pattern: /Invalid.*amount|amount.*invalid/i, category: 'validation', code: 'INVALID_AMOUNT' },
  { pattern: /Invalid.*token|token.*not.*found/i, category: 'validation', code: 'INVALID_TOKEN' },
  { pattern: /Missing.*required|required.*missing/i, category: 'validation', code: 'MISSING_FIELD' },
  { pattern: /Insufficient.*balance/i, category: 'validation', code: 'INSUFFICIENT_BALANCE' },
  { pattern: /exceeds.*limit|limit.*exceeded/i, category: 'validation', code: 'LIMIT_EXCEEDED' },

  // Execution errors
  { pattern: /revert|execution reverted/i, category: 'execution', code: 'TX_REVERTED' },
  { pattern: /out of gas|gas.*exceeded/i, category: 'execution', code: 'OUT_OF_GAS' },
  { pattern: /nonce.*too.*low|invalid.*nonce/i, category: 'execution', code: 'NONCE_ERROR' },
  { pattern: /replacement.*fee.*low/i, category: 'execution', code: 'UNDERPRICED' },
  { pattern: /simulation.*fail/i, category: 'execution', code: 'SIMULATION_FAILED' },
  { pattern: /slippage/i, category: 'execution', code: 'SLIPPAGE_ERROR' },

  // Network errors
  { pattern: /ECONNREFUSED|connection.*refused/i, category: 'network', code: 'CONNECTION_REFUSED' },
  { pattern: /ETIMEDOUT|timed.*out/i, category: 'network', code: 'CONNECTION_TIMEOUT' },
  { pattern: /ENOTFOUND|DNS/i, category: 'network', code: 'DNS_ERROR' },
  { pattern: /network.*error|RPC.*error/i, category: 'network', code: 'RPC_ERROR' },
  { pattern: /503|502|504|service.*unavailable/i, category: 'network', code: 'SERVICE_UNAVAILABLE' },
  { pattern: /rate.*limit.*RPC/i, category: 'network', code: 'RPC_RATE_LIMITED' },

  // Timeout errors
  { pattern: /timeout|timed out/i, category: 'timeout', code: 'TIMEOUT' },
  { pattern: /deadline.*exceeded/i, category: 'timeout', code: 'DEADLINE_EXCEEDED' },

  // Auth errors
  { pattern: /unauthorized|401/i, category: 'auth', code: 'UNAUTHORIZED' },
  { pattern: /forbidden|403/i, category: 'auth', code: 'FORBIDDEN' },
  { pattern: /invalid.*signature/i, category: 'auth', code: 'INVALID_SIGNATURE' },
  { pattern: /session.*expired|expired.*session/i, category: 'auth', code: 'SESSION_EXPIRED' },

  // Rate limit errors
  { pattern: /rate.*limit|too.*many.*requests|429/i, category: 'rate_limit', code: 'RATE_LIMITED' },
];

/**
 * Generate unique failure ID
 */
function generateFailureId(): string {
  return `fail_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Categorize an error based on its message
 */
export function categorizeError(errorMessage: string): { category: FailureCategory; code: string } {
  const normalizedMessage = errorMessage.toLowerCase();

  for (const { pattern, category, code } of ERROR_PATTERNS) {
    if (pattern.test(normalizedMessage)) {
      return { category, code };
    }
  }

  return { category: 'unknown', code: 'UNKNOWN_ERROR' };
}

/**
 * Detect intent type from endpoint or context
 */
export function detectIntentType(endpoint?: string, metadata?: Record<string, unknown>): IntentType {
  if (!endpoint) return 'other';

  const path = endpoint.toLowerCase();

  if (path.includes('swap')) return 'swap';
  if (path.includes('perp')) return 'perp';
  if (path.includes('defi') || path.includes('lend') || path.includes('supply')) return 'defi';
  if (path.includes('event') || path.includes('bet') || path.includes('predict')) return 'event';
  if (path.includes('transfer') || path.includes('send')) return 'transfer';
  if (path.includes('session')) return 'session';

  // Check metadata for intent kind
  if (metadata?.intentKind) {
    const kind = String(metadata.intentKind).toLowerCase();
    if (['swap', 'perp', 'defi', 'event', 'transfer', 'session'].includes(kind)) {
      return kind as IntentType;
    }
  }

  return 'other';
}

/**
 * Detect chain from error context
 */
export function detectChain(metadata?: Record<string, unknown>): Chain {
  if (!metadata) return 'unknown';

  const chain = metadata.chain || metadata.network;
  if (typeof chain === 'string') {
    if (chain.toLowerCase().includes('sol') || chain.toLowerCase().includes('devnet')) {
      return 'solana';
    }
    if (chain.toLowerCase().includes('eth') || chain.toLowerCase().includes('sepolia')) {
      return 'ethereum';
    }
  }

  return 'unknown';
}

/**
 * Record a failure with enhanced root cause logging
 */
export function recordFailure(params: {
  errorMessage: string;
  errorCode?: string;
  endpoint?: string;
  walletHash?: string;
  correlationId?: string;
  chain?: Chain;
  intentType?: IntentType;
  metadata?: Record<string, unknown>;
  stack?: string; // Optional stack trace for debugging
}): FailureRecord {
  const { category, code } = categorizeError(params.errorMessage);

  // Enhanced root cause detection for unknown errors
  let enhancedMetadata = params.metadata || {};
  if (category === 'unknown' && params.stack) {
    // Extract potential root cause from stack trace
    const stackLines = params.stack.split('\n').slice(0, 5);
    enhancedMetadata = {
      ...enhancedMetadata,
      stackSummary: stackLines.join(' | '),
      rootCauseHint: extractRootCauseHint(params.errorMessage, params.stack),
    };
  }

  // Add timestamp context for debugging timing issues
  enhancedMetadata = {
    ...enhancedMetadata,
    recordedAt: new Date().toISOString(),
  };

  const record: FailureRecord = {
    id: generateFailureId(),
    timestamp: Math.floor(Date.now() / 1000),
    category,
    intentType: params.intentType || detectIntentType(params.endpoint, params.metadata),
    chain: params.chain || detectChain(params.metadata),
    errorCode: params.errorCode || code,
    errorMessage: params.errorMessage.substring(0, 500), // Truncate long messages
    endpoint: params.endpoint,
    walletHash: params.walletHash,
    correlationId: params.correlationId,
    metadata: enhancedMetadata,
  };

  failureStore.push(record);

  // Keep only last 10,000 failures to bound memory
  if (failureStore.length > 10000) {
    failureStore.shift();
  }

  // Log critical failures immediately for faster debugging
  if (category === 'execution' || category === 'auth') {
    console.error(`[FailureAnalytics] CRITICAL ${category} failure:`, {
      id: record.id,
      code: record.errorCode,
      message: record.errorMessage.substring(0, 100),
      chain: record.chain,
      intentType: record.intentType,
    });
  }

  return record;
}

/**
 * Extract a hint about the root cause from error message and stack
 */
function extractRootCauseHint(message: string, stack: string): string {
  // Check for common root causes in stack
  if (stack.includes('ECONNREFUSED')) return 'RPC connection refused';
  if (stack.includes('ETIMEDOUT')) return 'Network timeout';
  if (stack.includes('insufficient funds')) return 'Insufficient gas or balance';
  if (stack.includes('nonce')) return 'Nonce conflict';
  if (stack.includes('revert')) return 'Contract revert';
  if (stack.includes('signature')) return 'Signature validation failed';
  if (stack.includes('session')) return 'Session-related issue';
  if (stack.includes('allowance')) return 'Token allowance issue';

  // Default: use first meaningful word from message
  const words = message.split(/\s+/).filter(w => w.length > 4);
  return words[0] || 'Unknown';
}

/**
 * Increment total request count (for failure rate calculation)
 */
export function incrementRequestCount(): void {
  totalRequestCount++;
}

/**
 * Get failure metrics
 */
export function getFailureMetrics(): FailureMetrics {
  const now = Math.floor(Date.now() / 1000);
  const hour = 3600;
  const day = 86400;

  const last24h = failureStore.filter(f => now - f.timestamp < day);
  const last1h = failureStore.filter(f => now - f.timestamp < hour);

  // Calculate failure rates
  const overallFailureRate = totalRequestCount > 0
    ? (failureStore.length / totalRequestCount) * 100
    : 0;

  // Approximate request counts for time windows (using failure ratio)
  const failureRate24h = last24h.length > 0 ? Math.min(overallFailureRate * 1.1, 100) : 0;
  const failureRate1h = last1h.length > 0 ? Math.min(overallFailureRate * 1.2, 100) : 0;

  // By category
  const categories: FailureCategory[] = ['parse', 'validation', 'execution', 'network', 'timeout', 'auth', 'rate_limit', 'unknown'];
  const byCategory: FailureMetrics['byCategory'] = {} as any;

  for (const cat of categories) {
    const catFailures = failureStore.filter(f => f.category === cat);
    const cat24h = last24h.filter(f => f.category === cat);

    // Top errors for this category
    const errorCounts: Record<string, number> = {};
    for (const f of catFailures) {
      const code = f.errorCode || 'UNKNOWN';
      errorCounts[code] = (errorCounts[code] || 0) + 1;
    }
    const topErrors = Object.entries(errorCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([code, count]) => ({ code, count }));

    byCategory[cat] = {
      count: catFailures.length,
      last24h: cat24h.length,
      percentage: failureStore.length > 0 ? (catFailures.length / failureStore.length) * 100 : 0,
      topErrors,
    };
  }

  // By intent type
  const intentTypes: IntentType[] = ['swap', 'perp', 'defi', 'event', 'transfer', 'session', 'other'];
  const byIntentType: FailureMetrics['byIntentType'] = {} as any;

  for (const intent of intentTypes) {
    const intentFailures = failureStore.filter(f => f.intentType === intent);

    // Top categories for this intent
    const catCounts: Record<FailureCategory, number> = {} as any;
    for (const f of intentFailures) {
      catCounts[f.category] = (catCounts[f.category] || 0) + 1;
    }
    const topCategories = Object.entries(catCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([cat]) => cat as FailureCategory);

    byIntentType[intent] = {
      count: intentFailures.length,
      failureRate: totalRequestCount > 0 ? (intentFailures.length / totalRequestCount) * 100 : 0,
      topCategories,
    };
  }

  // By chain
  const chains: Chain[] = ['ethereum', 'solana', 'unknown'];
  const byChain: FailureMetrics['byChain'] = {} as any;

  for (const chain of chains) {
    const chainFailures = failureStore.filter(f => f.chain === chain);

    const errorCounts: Record<string, number> = {};
    for (const f of chainFailures) {
      const code = f.errorCode || 'UNKNOWN';
      errorCounts[code] = (errorCounts[code] || 0) + 1;
    }
    const topErrors = Object.entries(errorCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([code, count]) => ({ code, count }));

    byChain[chain] = {
      count: chainFailures.length,
      failureRate: totalRequestCount > 0 ? (chainFailures.length / totalRequestCount) * 100 : 0,
      topErrors,
    };
  }

  // Hourly trend (last 24 hours)
  const hourlyTrend: FailureMetrics['hourlyTrend'] = [];
  for (let i = 23; i >= 0; i--) {
    const hourStart = now - ((i + 1) * hour);
    const hourEnd = now - (i * hour);
    const hourFailures = failureStore.filter(f => f.timestamp >= hourStart && f.timestamp < hourEnd);
    hourlyTrend.push({
      hour: new Date(hourEnd * 1000).getHours(),
      failures: hourFailures.length,
      rate: totalRequestCount > 0 ? (hourFailures.length / totalRequestCount) * 100 * 24 : 0,
    });
  }

  // Top errors overall
  const allErrorCounts: Record<string, { count: number; message: string; category: FailureCategory; lastOccurred: number }> = {};
  for (const f of failureStore) {
    const code = f.errorCode || 'UNKNOWN';
    if (!allErrorCounts[code]) {
      allErrorCounts[code] = {
        count: 0,
        message: f.errorMessage,
        category: f.category,
        lastOccurred: f.timestamp,
      };
    }
    allErrorCounts[code].count++;
    if (f.timestamp > allErrorCounts[code].lastOccurred) {
      allErrorCounts[code].lastOccurred = f.timestamp;
      allErrorCounts[code].message = f.errorMessage;
    }
  }
  const topErrors = Object.entries(allErrorCounts)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 10)
    .map(([code, data]) => ({ code, ...data }));

  // Generate insights
  const insights = generateInsights(byCategory, byIntentType, byChain, hourlyTrend);

  return {
    totalFailures: failureStore.length,
    failuresLast24h: last24h.length,
    failuresLast1h: last1h.length,

    overallFailureRate,
    failureRate24h,
    failureRate1h,

    byCategory,
    byIntentType,
    byChain,
    hourlyTrend,
    topErrors,
    insights,

    generatedAt: new Date().toISOString(),
  };
}

/**
 * Generate debugging insights from failure patterns
 */
function generateInsights(
  byCategory: FailureMetrics['byCategory'],
  byIntentType: FailureMetrics['byIntentType'],
  byChain: FailureMetrics['byChain'],
  hourlyTrend: FailureMetrics['hourlyTrend']
): string[] {
  const insights: string[] = [];

  // Check for dominant failure category
  const categories = Object.entries(byCategory).sort(([, a], [, b]) => b.count - a.count);
  if (categories.length > 0 && categories[0][1].percentage > 50) {
    insights.push(`${categories[0][0]} errors dominate (${categories[0][1].percentage.toFixed(1)}% of failures) - investigate root cause`);
  }

  // Check for network issues
  if (byCategory.network?.percentage > 20) {
    insights.push('High network failure rate - check RPC provider health and rate limits');
  }

  // Check for validation issues
  if (byCategory.validation?.percentage > 30) {
    insights.push('Many validation failures - consider improving input validation UX');
  }

  // Check for chain-specific issues
  const chainEntries = Object.entries(byChain);
  for (const [chain, data] of chainEntries) {
    if (chain !== 'unknown' && data.failureRate > 5) {
      insights.push(`${chain} has elevated failure rate (${data.failureRate.toFixed(1)}%) - check ${chain} RPC status`);
    }
  }

  // Check for intent-specific issues
  const intentEntries = Object.entries(byIntentType);
  for (const [intent, data] of intentEntries) {
    if (data.count > 10 && data.failureRate > 10) {
      insights.push(`${intent} operations have high failure rate - review ${intent} implementation`);
    }
  }

  // Check for recent spike
  const recentHours = hourlyTrend.slice(-3);
  const avgRecentFailures = recentHours.reduce((sum, h) => sum + h.failures, 0) / 3;
  const avgOlderFailures = hourlyTrend.slice(0, -3).reduce((sum, h) => sum + h.failures, 0) / Math.max(1, hourlyTrend.length - 3);

  if (avgRecentFailures > avgOlderFailures * 2 && avgRecentFailures > 5) {
    insights.push('Recent failure spike detected - investigate recent changes or external issues');
  }

  if (insights.length === 0) {
    insights.push('No significant failure patterns detected');
  }

  return insights;
}

/**
 * Get recent failures for debugging
 */
export function getRecentFailures(limit: number = 50): FailureRecord[] {
  return failureStore.slice(-limit).reverse();
}

/**
 * Clear failure store (for testing)
 */
export function clearFailureStore(): void {
  failureStore.length = 0;
  totalRequestCount = 0;
}

/**
 * Export failures for persistence
 */
export function exportFailures(): { failures: FailureRecord[]; totalRequests: number } {
  return {
    failures: [...failureStore],
    totalRequests: totalRequestCount,
  };
}

/**
 * Import failures on startup
 */
export function importFailures(data: { failures: FailureRecord[]; totalRequests: number }): void {
  failureStore.length = 0;
  failureStore.push(...data.failures);
  totalRequestCount = data.totalRequests;
}
