/**
 * ERC-8004 Trustless AI Agents Configuration
 *
 * Environment variable parsing and configuration for ERC-8004 integration.
 * Follows the pattern established in agent/src/config.ts
 */

import type { Address } from 'viem';
import type { ERC8004Config } from './types.js';

// ============================================
// Environment Variable Parsing
// ============================================

/**
 * Feature flag to enable ERC-8004 integration
 * Default: false (opt-in)
 */
export const ERC8004_ENABLED = process.env.ERC8004_ENABLED === 'true';

/**
 * Registry addresses (Sepolia testnet)
 * These will be set after ERC-8004 registries are deployed
 */
export const ERC8004_IDENTITY_REGISTRY_SEPOLIA = process.env
  .ERC8004_IDENTITY_REGISTRY_SEPOLIA as Address | undefined;

export const ERC8004_REPUTATION_REGISTRY_SEPOLIA = process.env
  .ERC8004_REPUTATION_REGISTRY_SEPOLIA as Address | undefined;

export const ERC8004_VALIDATION_REGISTRY_SEPOLIA = process.env
  .ERC8004_VALIDATION_REGISTRY_SEPOLIA as Address | undefined;

/**
 * Agent identity (set after registration)
 */
export const ERC8004_AGENT_ID = process.env.ERC8004_AGENT_ID
  ? BigInt(process.env.ERC8004_AGENT_ID)
  : undefined;

/**
 * Agent URI - points to the ERC-8004 registration JSON
 * Default: production endpoint
 */
export const ERC8004_AGENT_URI =
  process.env.ERC8004_AGENT_URI ||
  'https://api.blossom.onl/.well-known/agent-registration.json';

/**
 * Automatic feedback submission for significant trades
 * Default: false (opt-in to reduce on-chain costs)
 */
export const ERC8004_AUTO_FEEDBACK = process.env.ERC8004_AUTO_FEEDBACK === 'true';

/**
 * Minimum USD amount to trigger automatic feedback submission
 * Default: $100 (prevents spam attestations for small trades)
 */
const rawFeedbackMinUsd = parseInt(process.env.ERC8004_FEEDBACK_MIN_USD || '100', 10);
export const ERC8004_FEEDBACK_MIN_USD = isNaN(rawFeedbackMinUsd) ? 100 : rawFeedbackMinUsd;

/**
 * Require capability validation before execution
 * Default: false (start permissive, tighten later)
 */
export const ERC8004_REQUIRE_VALIDATION = process.env.ERC8004_REQUIRE_VALIDATION === 'true';

// ============================================
// Configuration Object
// ============================================

/**
 * Get the full ERC-8004 configuration object
 */
export function getERC8004Config(): ERC8004Config {
  return {
    enabled: ERC8004_ENABLED,
    identityRegistrySepolia: ERC8004_IDENTITY_REGISTRY_SEPOLIA,
    reputationRegistrySepolia: ERC8004_REPUTATION_REGISTRY_SEPOLIA,
    validationRegistrySepolia: ERC8004_VALIDATION_REGISTRY_SEPOLIA,
    agentId: ERC8004_AGENT_ID,
    agentURI: ERC8004_AGENT_URI,
    autoFeedback: ERC8004_AUTO_FEEDBACK,
    feedbackMinUsd: ERC8004_FEEDBACK_MIN_USD,
    requireValidation: ERC8004_REQUIRE_VALIDATION,
  };
}

// ============================================
// Validation Functions
// ============================================

/**
 * Require ERC-8004 to be enabled
 * Throws if disabled
 */
export function requireERC8004Enabled(): void {
  if (!ERC8004_ENABLED) {
    throw new Error(
      'ERC-8004 integration is not enabled. Set ERC8004_ENABLED=true to enable.'
    );
  }
}

/**
 * Require identity registry address
 * Throws if not configured
 */
export function requireIdentityRegistry(): Address {
  if (!ERC8004_IDENTITY_REGISTRY_SEPOLIA) {
    throw new Error(
      'ERC-8004 Identity Registry address not configured. ' +
        'Set ERC8004_IDENTITY_REGISTRY_SEPOLIA in your .env file.'
    );
  }
  return ERC8004_IDENTITY_REGISTRY_SEPOLIA;
}

/**
 * Require reputation registry address
 * Throws if not configured
 */
export function requireReputationRegistry(): Address {
  if (!ERC8004_REPUTATION_REGISTRY_SEPOLIA) {
    throw new Error(
      'ERC-8004 Reputation Registry address not configured. ' +
        'Set ERC8004_REPUTATION_REGISTRY_SEPOLIA in your .env file.'
    );
  }
  return ERC8004_REPUTATION_REGISTRY_SEPOLIA;
}

/**
 * Require agent ID
 * Throws if not registered
 */
export function requireAgentId(): bigint {
  if (ERC8004_AGENT_ID === undefined) {
    throw new Error(
      'ERC-8004 Agent ID not configured. ' +
        'Run the registration script and set ERC8004_AGENT_ID in your .env file.'
    );
  }
  return ERC8004_AGENT_ID;
}

/**
 * Validate ERC-8004 configuration
 * Returns validation errors if any
 */
export function validateERC8004Config(): string[] {
  const errors: string[] = [];

  if (!ERC8004_ENABLED) {
    // Not an error, just not enabled
    return errors;
  }

  // Validate registry addresses format if provided
  const addressRegex = /^0x[a-fA-F0-9]{40}$/;

  if (
    ERC8004_IDENTITY_REGISTRY_SEPOLIA &&
    !addressRegex.test(ERC8004_IDENTITY_REGISTRY_SEPOLIA)
  ) {
    errors.push(
      `ERC8004_IDENTITY_REGISTRY_SEPOLIA has invalid format: ${ERC8004_IDENTITY_REGISTRY_SEPOLIA}`
    );
  }

  if (
    ERC8004_REPUTATION_REGISTRY_SEPOLIA &&
    !addressRegex.test(ERC8004_REPUTATION_REGISTRY_SEPOLIA)
  ) {
    errors.push(
      `ERC8004_REPUTATION_REGISTRY_SEPOLIA has invalid format: ${ERC8004_REPUTATION_REGISTRY_SEPOLIA}`
    );
  }

  if (
    ERC8004_VALIDATION_REGISTRY_SEPOLIA &&
    !addressRegex.test(ERC8004_VALIDATION_REGISTRY_SEPOLIA)
  ) {
    errors.push(
      `ERC8004_VALIDATION_REGISTRY_SEPOLIA has invalid format: ${ERC8004_VALIDATION_REGISTRY_SEPOLIA}`
    );
  }

  // Validate agent URI format if provided
  if (ERC8004_AGENT_URI && !ERC8004_AGENT_URI.startsWith('http')) {
    errors.push(`ERC8004_AGENT_URI must be a valid HTTP/HTTPS URL: ${ERC8004_AGENT_URI}`);
  }

  // Validate feedback min USD is reasonable
  if (ERC8004_FEEDBACK_MIN_USD < 0 || ERC8004_FEEDBACK_MIN_USD > 1000000) {
    errors.push(
      `ERC8004_FEEDBACK_MIN_USD must be between 0 and 1000000: ${ERC8004_FEEDBACK_MIN_USD}`
    );
  }

  return errors;
}

/**
 * Log ERC-8004 configuration status
 */
export function logERC8004Config(): void {
  if (!ERC8004_ENABLED) {
    console.log('[erc8004] Integration disabled (ERC8004_ENABLED=false)');
    return;
  }

  console.log('[erc8004] Integration enabled');
  console.log(`[erc8004] Agent URI: ${ERC8004_AGENT_URI}`);
  console.log(`[erc8004] Auto feedback: ${ERC8004_AUTO_FEEDBACK} (min: $${ERC8004_FEEDBACK_MIN_USD})`);
  console.log(`[erc8004] Require validation: ${ERC8004_REQUIRE_VALIDATION}`);

  if (ERC8004_AGENT_ID) {
    console.log(`[erc8004] Agent ID: ${ERC8004_AGENT_ID}`);
  } else {
    console.log('[erc8004] Agent ID: Not registered');
  }

  if (ERC8004_IDENTITY_REGISTRY_SEPOLIA) {
    console.log(`[erc8004] Identity Registry: ${ERC8004_IDENTITY_REGISTRY_SEPOLIA}`);
  }

  if (ERC8004_REPUTATION_REGISTRY_SEPOLIA) {
    console.log(`[erc8004] Reputation Registry: ${ERC8004_REPUTATION_REGISTRY_SEPOLIA}`);
  }

  // Validate and log any errors
  const errors = validateERC8004Config();
  if (errors.length > 0) {
    console.warn('[erc8004] Configuration warnings:');
    errors.forEach((e) => console.warn(`  - ${e}`));
  }
}
