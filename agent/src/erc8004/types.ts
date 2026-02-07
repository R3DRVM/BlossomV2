/**
 * ERC-8004 Trustless AI Agents Type Definitions
 *
 * Implements interfaces for:
 * - Agent Identity (ERC-721 NFT registration)
 * - Reputation Scoring (derived from execution stats)
 * - Capability Validation (trustless action verification)
 *
 * Reference: ERC-8004 Standard
 */

import type { Address } from 'viem';

// ============================================
// Agent Identity Types (ERC-721 Based)
// ============================================

/**
 * Agent identity registered on-chain as ERC-721 NFT
 */
export interface AgentIdentity {
  /** On-chain agent ID (NFT token ID) */
  agentId: bigint;
  /** Owner address of the agent NFT */
  owner: Address;
  /** URI pointing to agent metadata (e.g., ERC-8004 registration JSON) */
  agentURI: string;
  /** Optional wallet address for agent operations */
  agentWallet?: Address;
  /** Chain ID where agent is registered */
  chainId: number;
  /** Registry contract address */
  registryAddress: Address;
  /** Fully qualified agent ID: "eip155:{chainId}:{registryAddress}" */
  fullyQualifiedId: string;
  /** Registration timestamp */
  registeredAt?: number;
  /** Last update timestamp */
  updatedAt?: number;
}

/**
 * ERC-8004 Agent Registration File (/.well-known/agent-registration.json)
 */
export interface AgentRegistrationFile {
  /** Schema version */
  version: '1.0.0';
  /** Agent name */
  name: string;
  /** Agent description */
  description: string;
  /** Fully qualified agent ID */
  agentId: string;
  /** Operator address */
  operator: Address;
  /** Chain IDs where agent operates */
  chains: number[];
  /** Declared capabilities */
  capabilities: BlossomCapability[];
  /** Reputation registry address (optional) */
  reputationRegistry?: Address;
  /** Validation registry address (optional) */
  validationRegistry?: Address;
  /** Agent public endpoints */
  endpoints: {
    api: string;
    health?: string;
    capabilities?: string;
    reputation?: string;
  };
  /** Metadata */
  metadata: {
    createdAt: string;
    updatedAt: string;
    website?: string;
    docs?: string;
  };
}

// ============================================
// Capability Types
// ============================================

/**
 * Blossom-specific capability declaration
 */
export interface BlossomCapability {
  /** Capability kind */
  kind: CapabilityKind;
  /** Supported chains */
  chains: string[];
  /** Supported venues/protocols */
  venues: string[];
  /** Maximum leverage supported (for perp/margin capabilities) */
  maxLeverageSupported?: number;
  /** Asset allowlist (empty = all assets) */
  assetAllowlist?: string[];
  /** Capability-specific limits */
  limits?: {
    maxAmountUsd?: number;
    minAmountUsd?: number;
    dailyVolumeUsd?: number;
  };
}

export type CapabilityKind =
  | 'swap'
  | 'perp'
  | 'perp_create'
  | 'lend'
  | 'event'
  | 'bridge'
  | 'proof';

/**
 * Action to validate against declared capabilities
 */
export interface ActionToValidate {
  kind: CapabilityKind;
  chain: string;
  venue?: string;
  asset?: string;
  leverage?: number;
  amountUsd?: number;
}

/**
 * Result of capability validation
 */
export interface CapabilityValidationResult {
  valid: boolean;
  capability?: BlossomCapability;
  errors?: string[];
  warnings?: string[];
}

// ============================================
// Reputation Types
// ============================================

/**
 * Reputation summary derived from Blossom stats
 */
export interface ReputationSummary {
  /** On-chain agent ID */
  agentId: bigint;
  /** Total feedback/attestation count */
  totalFeedbackCount: number;
  /** Average reputation score (-100 to +100) */
  averageScore: number;
  /** Breakdown by category */
  byCategory: Record<string, CategoryReputation>;
  /** Win rate from ledger (percentage) */
  winRate: number;
  /** Total execution count */
  executionCount: number;
  /** Maximum drawdown percentage (if tracking enabled) */
  maxDrawdownPct?: number;
  /** Volume routed in USD */
  totalVolumeUsd: number;
  /** Average latency in ms */
  avgLatencyMs: number;
  /** Last updated timestamp */
  updatedAt: number;
}

export interface CategoryReputation {
  count: number;
  avgScore: number;
}

/**
 * Reputation score calculation weights
 */
export interface ReputationWeights {
  /** Weight for success rate (0-1) */
  successRateWeight: number;
  /** Weight for volume (0-1) */
  volumeWeight: number;
  /** Weight for execution count (0-1) */
  executionCountWeight: number;
  /** Weight for latency (0-1) */
  latencyWeight: number;
}

/**
 * Feedback submission for on-chain attestation
 */
export interface FeedbackSubmission {
  /** Agent ID receiving feedback */
  agentId: bigint;
  /** Category of feedback */
  category: FeedbackCategory;
  /** Score (-100 to +100) */
  score: number;
  /** Related execution ID (optional) */
  executionId?: string;
  /** Related intent ID (optional) */
  intentId?: string;
  /** USD amount of related transaction (for weighting) */
  amountUsd?: number;
  /** Additional metadata */
  metadata?: Record<string, any>;
}

export type FeedbackCategory =
  | 'swap_execution'
  | 'perp_execution'
  | 'lend_execution'
  | 'bridge_execution'
  | 'event_execution'
  | 'general';

// ============================================
// Registry Interaction Types
// ============================================

/**
 * Parameters for registering a new agent
 */
export interface RegisterAgentParams {
  /** Agent name */
  name: string;
  /** Agent description */
  description: string;
  /** Agent URI */
  agentURI: string;
  /** Optional agent wallet */
  agentWallet?: Address;
  /** Capabilities to declare */
  capabilities: BlossomCapability[];
}

/**
 * Parameters for submitting feedback on-chain
 */
export interface SubmitFeedbackParams {
  /** Agent ID */
  agentId: bigint;
  /** Category */
  category: FeedbackCategory;
  /** Score (-100 to +100) */
  score: number;
  /** Comment (will be hashed) */
  comment?: string;
}

// ============================================
// Configuration Types
// ============================================

/**
 * ERC-8004 module configuration
 */
export interface ERC8004Config {
  /** Feature flag */
  enabled: boolean;
  /** Identity registry address (Sepolia) */
  identityRegistrySepolia?: Address;
  /** Reputation registry address (Sepolia) */
  reputationRegistrySepolia?: Address;
  /** Validation registry address (Sepolia) */
  validationRegistrySepolia?: Address;
  /** Agent ID (set after registration) */
  agentId?: bigint;
  /** Agent URI */
  agentURI: string;
  /** Auto-submit feedback for significant trades */
  autoFeedback: boolean;
  /** Minimum USD amount to trigger auto-feedback */
  feedbackMinUsd: number;
  /** Require capability validation before execution */
  requireValidation: boolean;
}

// ============================================
// Error Types
// ============================================

export class ERC8004Error extends Error {
  constructor(
    message: string,
    public code: ERC8004ErrorCode,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'ERC8004Error';
  }
}

export type ERC8004ErrorCode =
  | 'NOT_REGISTERED'
  | 'REGISTRATION_FAILED'
  | 'INVALID_CAPABILITY'
  | 'CAPABILITY_NOT_DECLARED'
  | 'FEEDBACK_FAILED'
  | 'VALIDATION_FAILED'
  | 'CONFIG_MISSING'
  | 'REGISTRY_UNAVAILABLE'
  | 'SUBAGENT_NOT_FOUND'
  | 'DELEGATION_FAILED'
  | 'DELEGATION_REVOKED'
  | 'SPEND_LIMIT_EXCEEDED';

// ============================================
// Phase 5: Sub-Agent Orchestration Types
// ============================================

/**
 * Sub-agent registration with delegated capabilities
 */
export interface SubAgentRegistration {
  /** Unique sub-agent ID */
  id: string;
  /** Parent agent ID (ERC-8004 bigint) */
  parentAgentId: bigint;
  /** Sub-agent ID (may be same as parent for internal sub-agents) */
  subAgentId: bigint;
  /** Capabilities delegated to this sub-agent */
  delegatedCapabilities: CapabilityKind[];
  /** Maximum spend per delegation (in USD) */
  spendLimitUsd: number;
  /** Expiration timestamp (Unix) */
  expiresAt: number;
  /** Whether delegation has been revoked */
  revoked: boolean;
  /** Creation timestamp */
  createdAt: number;
  /** Optional specialization (venue, chain, asset) */
  specialization?: {
    venue?: string;
    chain?: string;
    assetAllowlist?: string[];
  };
}

/**
 * Request to delegate a task to a sub-agent
 */
export interface DelegationRequest {
  /** Task description */
  task: string;
  /** Required capabilities for this task */
  requiredCapabilities: CapabilityKind[];
  /** Estimated USD value of the task */
  estimatedUsd: number;
  /** Maximum time to complete (ms) */
  timeout: number;
  /** Priority level */
  priority?: 'low' | 'medium' | 'high';
  /** Target chain for execution */
  chain?: string;
  /** Target venue for execution */
  venue?: string;
  /** Parsed intent (if available) */
  parsedIntent?: any; // ParsedIntent type
}

/**
 * Result of a delegation
 */
export interface DelegationResult {
  /** Sub-agent ID that received the delegation */
  delegatedTo: bigint;
  /** Unique task ID */
  taskId: string;
  /** Current status */
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  /** Result data (if completed) */
  result?: {
    success: boolean;
    txHash?: string;
    explorerUrl?: string;
    error?: string;
  };
  /** Actual USD spent */
  spentUsd?: number;
  /** Duration in ms */
  durationMs?: number;
}

/**
 * Sub-agent status summary
 */
export interface SubAgentStatus {
  /** Sub-agent ID */
  subAgentId: bigint;
  /** Current availability */
  available: boolean;
  /** Active task count */
  activeTaskCount: number;
  /** Remaining spend budget */
  remainingSpendUsd: number;
  /** Reputation score (-100 to +100) */
  reputationScore: number;
  /** Success rate (percentage) */
  successRate: number;
  /** Last activity timestamp */
  lastActivityAt: number;
}

/**
 * Sub-agent selection criteria
 */
export interface SubAgentSelectionCriteria {
  /** Required capabilities */
  capabilities: CapabilityKind[];
  /** Preferred chain */
  preferredChain?: string;
  /** Preferred venue */
  preferredVenue?: string;
  /** Minimum reputation score */
  minReputationScore?: number;
  /** Minimum success rate */
  minSuccessRate?: number;
  /** Maximum concurrent tasks */
  maxConcurrentTasks?: number;
}
