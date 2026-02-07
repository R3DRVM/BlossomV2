/**
 * ERC-8004 Trustless AI Agents Module
 *
 * Provides integration with ERC-8004 standard for:
 * - On-chain agent identity via ERC-721 NFT
 * - Reputation scoring from execution stats
 * - Capability validation for trustless verification
 *
 * Usage:
 *   import { getAgentIdentity, getReputationSummary, validateActionAgainstCapabilities } from './erc8004';
 */

// ============================================
// Type Exports
// ============================================
export type {
  AgentIdentity,
  AgentRegistrationFile,
  BlossomCapability,
  CapabilityKind,
  ActionToValidate,
  CapabilityValidationResult,
  ReputationSummary,
  ReputationWeights,
  FeedbackSubmission,
  FeedbackCategory,
  CategoryReputation,
  RegisterAgentParams,
  SubmitFeedbackParams,
  ERC8004Config,
  ERC8004ErrorCode,
} from './types.js';

export { ERC8004Error } from './types.js';

// ============================================
// Configuration Exports
// ============================================
export {
  ERC8004_ENABLED,
  ERC8004_IDENTITY_REGISTRY_SEPOLIA,
  ERC8004_REPUTATION_REGISTRY_SEPOLIA,
  ERC8004_VALIDATION_REGISTRY_SEPOLIA,
  ERC8004_AGENT_ID,
  ERC8004_AGENT_URI,
  ERC8004_AUTO_FEEDBACK,
  ERC8004_FEEDBACK_MIN_USD,
  ERC8004_REQUIRE_VALIDATION,
  getERC8004Config,
  requireERC8004Enabled,
  requireIdentityRegistry,
  requireReputationRegistry,
  requireAgentId,
  validateERC8004Config,
  logERC8004Config,
} from './config.js';

// ============================================
// Identity Registry Exports
// ============================================
export {
  getAgentIdentity,
  isAgentRegistered,
  getFullyQualifiedAgentId,
  buildBlossomRegistrationFile,
  registerBlossomAgent,
  updateAgentURI,
  formatAgentId,
  parseAgentId,
  checkOnchainRegistration,
} from './identityRegistry.js';

// ============================================
// On-Chain Client Exports
// ============================================
export {
  getPublicClient,
  getWalletClient,
  getRelayerAddress,
  getRelayerAccount,
  estimateGasPrices,
  estimateContractGas,
  validateRelayerBalance,
  waitForTransaction,
  getRelayerBalance,
  getRelayerNonce,
  checkOnchainHealth,
  parseTransactionError,
  resetClients,
  getERC8004Chain,
  GAS_LIMITS,
  type ERC8004TransactionError,
} from './onchainClient.js';

// ============================================
// Reputation Registry Exports
// ============================================
export {
  calculateReputationScore,
  deriveReputationFromStats,
  getReputationSummary,
  shouldSubmitFeedback,
  deriveCategory,
  calculateFeedbackScore,
  submitExecutionFeedback,
  batchSubmitFeedback,
  formatReputationScore,
  getReputationTier,
} from './reputationRegistry.js';

// ============================================
// Validation Registry Exports
// ============================================
export {
  getBlossomCapabilities,
  hasCapability,
  getCapability,
  validateActionAgainstCapabilities,
  requireValidAction,
  compareCapabilities,
  getCapabilitySummary,
} from './validationRegistry.js';

// ============================================
// Sub-Agent Orchestration Exports (Phase 5)
// ============================================
export {
  registerSubAgent,
  revokeDelegation,
  getSubAgentRegistration,
  listSubAgents,
  delegateTask,
  findQualifiedSubAgents,
  validateDelegation,
  getSubAgentStatus,
  updateDelegationResult,
  getDelegationResult,
  shouldDelegate,
  delegateToSubAgent,
  cleanupSubAgents,
  getOrchestratorStatus,
} from './subAgentOrchestrator.js';

// ============================================
// Sub-Agent Type Exports
// ============================================
export type {
  SubAgentRegistration,
  DelegationRequest,
  DelegationResult,
  SubAgentStatus,
  SubAgentSelectionCriteria,
} from './types.js';
