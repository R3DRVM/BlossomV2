/**
 * ERC-8004 Reputation Registry
 *
 * Derives agent reputation from Blossom execution ledger stats.
 * Provides functions to:
 * - Calculate reputation score from stats
 * - Submit feedback attestations for significant trades
 * - Track feedback in local database
 */

import type { Address, Hash } from 'viem';
import { encodeFunctionData, keccak256, toHex } from 'viem';
import {
  ERC8004_ENABLED,
  ERC8004_AGENT_ID,
  ERC8004_AUTO_FEEDBACK,
  ERC8004_FEEDBACK_MIN_USD,
  ERC8004_REPUTATION_REGISTRY_SEPOLIA,
  requireReputationRegistry,
} from './config.js';
import type {
  ReputationSummary,
  ReputationWeights,
  FeedbackSubmission,
  FeedbackCategory,
  CategoryReputation,
} from './types.js';
import { ERC8004Error } from './types.js';
import {
  getWalletClient,
  getPublicClient,
  getRelayerAccount,
  estimateGasPrices,
  estimateContractGas,
  validateRelayerBalance,
  waitForTransaction,
  parseTransactionError,
  GAS_LIMITS,
} from './onchainClient.js';
import ReputationRegistryABI from './abis/ReputationRegistry.json' assert { type: 'json' };

// ============================================
// Default Configuration
// ============================================

/**
 * Default weights for reputation calculation
 */
const DEFAULT_WEIGHTS: ReputationWeights = {
  successRateWeight: 0.5,   // 50% weight on success rate
  volumeWeight: 0.2,        // 20% weight on volume
  executionCountWeight: 0.15, // 15% weight on experience
  latencyWeight: 0.15,      // 15% weight on speed
};

/**
 * Thresholds for reputation bonuses
 */
const THRESHOLDS = {
  volumeMaxBonus: 1_000_000,    // $1M volume for max bonus
  executionMaxBonus: 1000,      // 1000 executions for max bonus
  latencyOptimal: 500,          // <500ms is optimal
  latencyMax: 5000,             // >5000ms gets no bonus
};

// ============================================
// Reputation Calculation
// ============================================

/**
 * Calculate reputation score from Blossom execution stats
 *
 * Score formula:
 * - Base score from adjusted success rate (0-50 points)
 * - Volume bonus (up to 20 points for $1M+ routed)
 * - Experience bonus (up to 15 points for 1000+ executions)
 * - Latency bonus (up to 15 points for <500ms avg)
 *
 * Final score: -100 to +100
 */
export function calculateReputationScore(
  stats: {
    successRateAdjusted: number;
    totalUsdRouted: number;
    totalExecutions: number;
    avgLatencyMs: number;
  },
  weights: ReputationWeights = DEFAULT_WEIGHTS
): number {
  // Normalize weights to sum to 1
  const totalWeight =
    weights.successRateWeight +
    weights.volumeWeight +
    weights.executionCountWeight +
    weights.latencyWeight;

  const normWeights = {
    successRate: weights.successRateWeight / totalWeight,
    volume: weights.volumeWeight / totalWeight,
    execution: weights.executionCountWeight / totalWeight,
    latency: weights.latencyWeight / totalWeight,
  };

  // 1. Success rate component (0-100 points, scaled by weight)
  // Adjusted success rate is already 0-100
  const successComponent = stats.successRateAdjusted * normWeights.successRate;

  // 2. Volume component (0-100 points based on $1M target, scaled by weight)
  const volumeRatio = Math.min(1, stats.totalUsdRouted / THRESHOLDS.volumeMaxBonus);
  const volumeComponent = volumeRatio * 100 * normWeights.volume;

  // 3. Execution count component (0-100 points based on 1000 target, scaled by weight)
  const execRatio = Math.min(1, stats.totalExecutions / THRESHOLDS.executionMaxBonus);
  const execComponent = execRatio * 100 * normWeights.execution;

  // 4. Latency component (0-100 points, faster is better, scaled by weight)
  let latencyScore: number;
  if (stats.avgLatencyMs <= THRESHOLDS.latencyOptimal) {
    latencyScore = 100;
  } else if (stats.avgLatencyMs >= THRESHOLDS.latencyMax) {
    latencyScore = 0;
  } else {
    // Linear interpolation between optimal and max
    const range = THRESHOLDS.latencyMax - THRESHOLDS.latencyOptimal;
    const excess = stats.avgLatencyMs - THRESHOLDS.latencyOptimal;
    latencyScore = 100 * (1 - excess / range);
  }
  const latencyComponent = latencyScore * normWeights.latency;

  // Sum components (0-100 range)
  const rawScore = successComponent + volumeComponent + execComponent + latencyComponent;

  // Convert to -100 to +100 range
  // 50 is neutral, above 50 is positive, below 50 is negative
  const finalScore = Math.round((rawScore - 50) * 2);

  return Math.max(-100, Math.min(100, finalScore));
}

/**
 * Derive reputation summary from Blossom ledger stats
 * Uses getSummaryStats() from the execution ledger
 */
export async function deriveReputationFromStats(): Promise<ReputationSummary> {
  // Dynamic import to avoid circular dependencies
  // Use async version which routes to Postgres in production
  const { getSummaryStatsAsync } = await import('../../execution-ledger/db.js');
  const stats = await getSummaryStatsAsync();

  const score = calculateReputationScore({
    successRateAdjusted: stats.successRateAdjusted,
    totalUsdRouted: stats.totalUsdRouted,
    totalExecutions: stats.totalExecutions,
    avgLatencyMs: stats.avgLatencyMs,
  });

  // Calculate win rate (success rate from stats)
  const winRate = stats.successRateAdjusted;

  // Build category breakdown from byKind
  const byCategory: Record<string, CategoryReputation> = {};
  for (const kind of stats.byKind) {
    // Calculate per-category success rate (simplified - would need more data in real impl)
    byCategory[kind.kind] = {
      count: kind.count,
      avgScore: score, // Same as overall for now
    };
  }

  return {
    agentId: ERC8004_AGENT_ID || 0n,
    totalFeedbackCount: stats.totalExecutions,
    averageScore: score,
    byCategory,
    winRate,
    executionCount: stats.totalExecutions,
    maxDrawdownPct: undefined, // Would need PnL tracking
    totalVolumeUsd: stats.totalUsdRouted,
    avgLatencyMs: stats.avgLatencyMs,
    updatedAt: Math.floor(Date.now() / 1000),
  };
}

/**
 * Get reputation summary for the current agent
 */
export async function getReputationSummary(): Promise<ReputationSummary | undefined> {
  if (!ERC8004_ENABLED) {
    return undefined;
  }

  return deriveReputationFromStats();
}

// ============================================
// Feedback Submission
// ============================================

/**
 * Determine if a trade should trigger automatic feedback submission
 */
export function shouldSubmitFeedback(amountUsd: number): boolean {
  if (!ERC8004_ENABLED) return false;
  if (!ERC8004_AUTO_FEEDBACK) return false;
  return amountUsd >= ERC8004_FEEDBACK_MIN_USD;
}

/**
 * Derive feedback category from execution kind
 */
export function deriveCategory(kind: string): FeedbackCategory {
  switch (kind.toLowerCase()) {
    case 'swap':
      return 'swap_execution';
    case 'perp':
    case 'perp_create':
      return 'perp_execution';
    case 'deposit':
    case 'lend':
      return 'lend_execution';
    case 'bridge':
      return 'bridge_execution';
    case 'event':
      return 'event_execution';
    default:
      return 'general';
  }
}

/**
 * Calculate feedback score from execution result
 *
 * Score logic:
 * - Successful execution: +50 to +100 based on speed
 * - Failed execution: -50 to 0 based on error type
 */
export function calculateFeedbackScore(
  success: boolean,
  latencyMs?: number,
  errorCode?: string
): number {
  if (success) {
    // Base successful score
    let score = 50;

    // Speed bonus (up to +50 for fast execution)
    if (latencyMs !== undefined) {
      if (latencyMs < 500) {
        score += 50;
      } else if (latencyMs < 1000) {
        score += 40;
      } else if (latencyMs < 2000) {
        score += 25;
      } else if (latencyMs < 5000) {
        score += 10;
      }
    } else {
      // Default bonus if latency unknown
      score += 25;
    }

    return score;
  }

  // Failed execution
  let score = -25; // Base failure score

  // Adjust based on error type
  if (errorCode) {
    // Infrastructure failures are less penalizing
    if (['RPC_RATE_LIMITED', 'RPC_UNAVAILABLE', 'RPC_ERROR'].includes(errorCode)) {
      score = -10;
    }
    // User-caused failures
    else if (['INSUFFICIENT_BALANCE', 'SLIPPAGE_EXCEEDED', 'USER_REJECTED'].includes(errorCode)) {
      score = -15;
    }
    // Agent failures
    else if (['EXECUTION_REVERTED', 'INVALID_ACTION', 'ROUTING_FAILED'].includes(errorCode)) {
      score = -40;
    }
  }

  return score;
}

/**
 * Map feedback category to on-chain enum value
 */
function categoryToEnum(category: FeedbackCategory): number {
  const categoryMap: Record<FeedbackCategory, number> = {
    general: 0,
    swap_execution: 1,
    perp_execution: 2,
    lend_execution: 3,
    bridge_execution: 4,
    event_execution: 5,
  };
  return categoryMap[category] ?? 0;
}

/**
 * Create execution hash for on-chain feedback
 * Uses keccak256 of execution ID + intent ID
 */
function createExecutionHash(executionId?: string, intentId?: string): `0x${string}` {
  const data = `${executionId || ''}:${intentId || ''}:${Date.now()}`;
  return keccak256(toHex(data));
}

/**
 * Submit execution feedback
 *
 * Tracks feedback locally and optionally submits on-chain attestation
 * for significant trades.
 */
export async function submitExecutionFeedback(
  feedback: FeedbackSubmission
): Promise<{ tracked: boolean; submitted: boolean; feedbackId?: string; txHash?: Hash }> {
  // Validate score range
  if (feedback.score < -100 || feedback.score > 100) {
    throw new ERC8004Error(
      `Feedback score must be between -100 and 100, got: ${feedback.score}`,
      'FEEDBACK_FAILED'
    );
  }

  // Track in local database
  const { trackERC8004Feedback, markERC8004FeedbackSubmitted } = await import('../../execution-ledger/db.js');
  const feedbackId = trackERC8004Feedback({
    agentId: feedback.agentId.toString(),
    category: feedback.category,
    score: feedback.score,
    executionId: feedback.executionId,
    intentId: feedback.intentId,
    amountUsd: feedback.amountUsd,
    metadata: feedback.metadata,
  });

  // Check if should submit on-chain
  const shouldSubmit =
    ERC8004_ENABLED &&
    ERC8004_AUTO_FEEDBACK &&
    feedback.amountUsd !== undefined &&
    feedback.amountUsd >= ERC8004_FEEDBACK_MIN_USD &&
    ERC8004_REPUTATION_REGISTRY_SEPOLIA !== undefined;

  if (!shouldSubmit) {
    return {
      tracked: true,
      submitted: false,
      feedbackId,
    };
  }

  // Submit on-chain
  try {
    const txHash = await submitFeedbackOnchain(feedback, feedbackId);

    // Update database with on-chain status
    if (feedbackId) {
      markERC8004FeedbackSubmitted(feedbackId, txHash);
    }

    return {
      tracked: true,
      submitted: true,
      feedbackId,
      txHash,
    };
  } catch (error) {
    console.error(`[erc8004] On-chain feedback submission failed: ${error}`);
    // Still return tracked even if on-chain failed
    return {
      tracked: true,
      submitted: false,
      feedbackId,
    };
  }
}

/**
 * Submit feedback to on-chain reputation registry
 */
async function submitFeedbackOnchain(
  feedback: FeedbackSubmission,
  localFeedbackId?: string
): Promise<Hash> {
  const registryAddress = requireReputationRegistry();

  console.log(`[erc8004] Submitting feedback on-chain...`);
  console.log(`[erc8004] Agent ID: ${feedback.agentId}`);
  console.log(`[erc8004] Category: ${feedback.category}`);
  console.log(`[erc8004] Score: ${feedback.score}`);
  console.log(`[erc8004] Amount: $${feedback.amountUsd}`);

  try {
    const walletClient = getWalletClient();

    // Create execution hash
    const executionHash = createExecutionHash(feedback.executionId, feedback.intentId);

    // Convert category to enum
    const categoryEnum = categoryToEnum(feedback.category);

    // Convert amount to Wei-like units (use integer cents)
    const amountUsdCents = BigInt(Math.floor((feedback.amountUsd || 0) * 100));

    // Encode the function call
    const data = encodeFunctionData({
      abi: ReputationRegistryABI.abi,
      functionName: 'submitFeedback',
      args: [
        feedback.agentId,
        categoryEnum,
        feedback.score,
        executionHash,
        amountUsdCents,
      ],
    });

    // Estimate gas
    const estimatedGas = await estimateContractGas({
      to: registryAddress,
      data,
    }).catch(() => GAS_LIMITS.SUBMIT_FEEDBACK);

    // Get gas prices
    const { maxFeePerGas, maxPriorityFeePerGas } = await estimateGasPrices();

    // Validate balance
    await validateRelayerBalance(estimatedGas, maxFeePerGas);

    // Send transaction
    const hash = await walletClient.sendTransaction({
      account: getRelayerAccount(),
      to: registryAddress,
      data,
      gas: estimatedGas,
      maxFeePerGas,
      maxPriorityFeePerGas,
      chain: null,
    });

    console.log(`[erc8004] Feedback transaction submitted: ${hash}`);

    // Wait for confirmation (in background, don't block)
    waitForTransaction(hash)
      .then(() => console.log(`[erc8004] Feedback transaction confirmed: ${hash}`))
      .catch((err) => console.error(`[erc8004] Feedback transaction failed: ${err}`));

    return hash;
  } catch (error) {
    const parsedError = parseTransactionError(error);
    throw new ERC8004Error(
      `On-chain feedback submission failed: ${parsedError.message}`,
      'FEEDBACK_FAILED',
      { errorType: parsedError.type, originalError: String(error) }
    );
  }
}

/**
 * Batch submit multiple feedback entries on-chain
 * Useful for catching up on missed on-chain submissions
 */
export async function batchSubmitFeedback(
  feedbackEntries: FeedbackSubmission[]
): Promise<{ submitted: number; failed: number; txHashes: Hash[] }> {
  let submitted = 0;
  let failed = 0;
  const txHashes: Hash[] = [];

  for (const feedback of feedbackEntries) {
    try {
      const hash = await submitFeedbackOnchain(feedback);
      txHashes.push(hash);
      submitted++;
    } catch (error) {
      console.error(`[erc8004] Batch feedback failed for agent ${feedback.agentId}: ${error}`);
      failed++;
    }
  }

  return { submitted, failed, txHashes };
}

// ============================================
// Utility Functions
// ============================================

/**
 * Format reputation score for display
 */
export function formatReputationScore(score: number): string {
  if (score >= 75) return `Excellent (${score})`;
  if (score >= 50) return `Good (${score})`;
  if (score >= 25) return `Fair (${score})`;
  if (score >= 0) return `Neutral (${score})`;
  if (score >= -25) return `Below Average (${score})`;
  if (score >= -50) return `Poor (${score})`;
  return `Very Poor (${score})`;
}

/**
 * Get reputation tier based on score
 */
export function getReputationTier(
  score: number
): 'excellent' | 'good' | 'fair' | 'neutral' | 'poor' | 'very_poor' {
  if (score >= 75) return 'excellent';
  if (score >= 50) return 'good';
  if (score >= 25) return 'fair';
  if (score >= 0) return 'neutral';
  if (score >= -50) return 'poor';
  return 'very_poor';
}
