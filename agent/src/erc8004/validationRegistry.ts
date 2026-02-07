/**
 * ERC-8004 Validation Registry
 *
 * Manages capability declarations and action validation.
 * Provides functions to:
 * - Declare agent capabilities based on configuration
 * - Validate actions against declared capabilities
 * - Generate capability proofs for trustless verification
 */

import {
  ERC8004_ENABLED,
  ERC8004_REQUIRE_VALIDATION,
} from './config.js';
import {
  HYPERLIQUID_ENABLED,
  HYPERLIQUID_DEFAULT_MAX_LEVERAGE,
} from '../config.js';
import type {
  BlossomCapability,
  CapabilityKind,
  ActionToValidate,
  CapabilityValidationResult,
} from './types.js';
import { ERC8004Error } from './types.js';

// ============================================
// Capability Declarations
// ============================================

/**
 * Get Blossom's declared capabilities based on current configuration
 *
 * These are derived from the implemented venues and adapters in the config.
 * Capabilities are conservative - only declare what is fully implemented.
 */
export function getBlossomCapabilities(): BlossomCapability[] {
  const capabilities: BlossomCapability[] = [];

  // Check environment for enabled features
  const hasSwap = Boolean(
    process.env.DEMO_SWAP_ROUTER_ADDRESS ||
    process.env.UNISWAP_V3_ADAPTER_ADDRESS
  );
  const hasPerp = Boolean(
    process.env.DEMO_PERP_ADAPTER_ADDRESS ||
    process.env.DEMO_PERP_ENGINE_ADDRESS
  );
  const hasLend = Boolean(
    process.env.DEMO_LEND_ADAPTER_ADDRESS ||
    process.env.AAVE_ADAPTER_ADDRESS
  );
  const hasEvent = Boolean(
    process.env.DEMO_EVENT_ADAPTER_ADDRESS ||
    process.env.DEMO_EVENT_ENGINE_ADDRESS
  );
  const hasProof = Boolean(process.env.PROOF_ADAPTER_ADDRESS);
  const hasSolanaSwap = Boolean(process.env.SOLANA_PRIVATE_KEY);

  // Swap capability (Ethereum)
  if (hasSwap) {
    const venues: string[] = [];
    if (process.env.DEMO_SWAP_ROUTER_ADDRESS) venues.push('demo_dex');
    if (process.env.UNISWAP_V3_ADAPTER_ADDRESS) venues.push('uniswap_v3');

    capabilities.push({
      kind: 'swap',
      chains: ['ethereum'],
      venues,
      assetAllowlist: ['ETH', 'WETH', 'USDC', 'USDT', 'DAI'],
      limits: {
        maxAmountUsd: 100000, // Conservative limit for testnet
        minAmountUsd: 1,
      },
    });
  }

  // Swap capability (Solana)
  if (hasSolanaSwap) {
    capabilities.push({
      kind: 'swap',
      chains: ['solana'],
      venues: ['jupiter'],
      assetAllowlist: ['SOL', 'USDC'],
      limits: {
        maxAmountUsd: 100000,
        minAmountUsd: 1,
      },
    });
  }

  // Perpetual trading capability (Ethereum/Demo)
  if (hasPerp) {
    const venues: string[] = [];
    if (process.env.DEMO_PERP_ADAPTER_ADDRESS) venues.push('demo_perp');

    capabilities.push({
      kind: 'perp',
      chains: ['ethereum'],
      venues,
      maxLeverageSupported: 20,
      assetAllowlist: ['BTC', 'ETH', 'SOL'],
      limits: {
        maxAmountUsd: 50000,
        minAmountUsd: 10,
      },
    });
  }

  // Hyperliquid perpetual trading capability
  if (HYPERLIQUID_ENABLED) {
    capabilities.push({
      kind: 'perp',
      chains: ['hyperliquid'],
      venues: ['hyperliquid'],
      maxLeverageSupported: HYPERLIQUID_DEFAULT_MAX_LEVERAGE || 20,
      assetAllowlist: ['BTC', 'ETH', 'SOL', 'ARB', 'DOGE', 'MATIC', 'AVAX', 'LINK', 'OP'],
      limits: {
        maxAmountUsd: 100000,
        minAmountUsd: 10,
      },
    });

    // HIP-3 perp market creation capability
    capabilities.push({
      kind: 'perp_create',
      chains: ['hyperliquid'],
      venues: ['hip3'],
      maxLeverageSupported: HYPERLIQUID_DEFAULT_MAX_LEVERAGE || 20,
      limits: {
        maxAmountUsd: 1000000, // Bond amount limit
        minAmountUsd: 1000,
      },
    });
  }

  // Lending capability
  if (hasLend) {
    const venues: string[] = [];
    if (process.env.DEMO_LEND_ADAPTER_ADDRESS) venues.push('demo_vault');
    if (process.env.AAVE_ADAPTER_ADDRESS) venues.push('aave_v3');

    capabilities.push({
      kind: 'lend',
      chains: ['ethereum'],
      venues,
      assetAllowlist: ['USDC', 'USDT', 'DAI', 'ETH', 'WETH'],
      limits: {
        maxAmountUsd: 100000,
        minAmountUsd: 1,
      },
    });
  }

  // Event/prediction market capability
  if (hasEvent) {
    const venues: string[] = [];
    if (process.env.DEMO_EVENT_ADAPTER_ADDRESS) venues.push('demo_event');

    capabilities.push({
      kind: 'event',
      chains: ['ethereum'],
      venues,
      assetAllowlist: ['USDC'],
      limits: {
        maxAmountUsd: 10000,
        minAmountUsd: 1,
      },
    });
  }

  // Proof capability (always available if adapter exists)
  if (hasProof) {
    capabilities.push({
      kind: 'proof',
      chains: ['ethereum', 'solana'],
      venues: ['native'],
    });
  }

  return capabilities;
}

/**
 * Check if a specific capability is declared
 */
export function hasCapability(kind: CapabilityKind, chain?: string): boolean {
  const capabilities = getBlossomCapabilities();

  return capabilities.some((cap) => {
    if (cap.kind !== kind) return false;
    if (chain && !cap.chains.includes(chain)) return false;
    return true;
  });
}

/**
 * Get capability by kind and optionally chain
 */
export function getCapability(
  kind: CapabilityKind,
  chain?: string
): BlossomCapability | undefined {
  const capabilities = getBlossomCapabilities();

  return capabilities.find((cap) => {
    if (cap.kind !== kind) return false;
    if (chain && !cap.chains.includes(chain)) return false;
    return true;
  });
}

// ============================================
// Action Validation
// ============================================

/**
 * Validate an action against declared capabilities
 *
 * Returns validation result with any errors or warnings.
 * If ERC8004_REQUIRE_VALIDATION is true, execution should be blocked
 * when validation fails.
 */
export function validateActionAgainstCapabilities(
  action: ActionToValidate
): CapabilityValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Find matching capability
  const capability = getCapability(action.kind, action.chain);

  if (!capability) {
    errors.push(
      `No capability declared for ${action.kind} on ${action.chain || 'any chain'}`
    );
    return { valid: false, errors, warnings };
  }

  // Validate venue if specified
  if (action.venue && !capability.venues.includes(action.venue)) {
    errors.push(
      `Venue '${action.venue}' not in declared venues: ${capability.venues.join(', ')}`
    );
  }

  // Validate asset if specified and allowlist exists
  if (
    action.asset &&
    capability.assetAllowlist &&
    capability.assetAllowlist.length > 0
  ) {
    const normalizedAsset = action.asset.toUpperCase();
    if (!capability.assetAllowlist.includes(normalizedAsset)) {
      errors.push(
        `Asset '${action.asset}' not in allowlist: ${capability.assetAllowlist.join(', ')}`
      );
    }
  }

  // Validate leverage if applicable
  if (action.leverage !== undefined && capability.maxLeverageSupported !== undefined) {
    if (action.leverage > capability.maxLeverageSupported) {
      errors.push(
        `Requested leverage ${action.leverage}x exceeds maximum ${capability.maxLeverageSupported}x`
      );
    }
  }

  // Validate amount limits
  if (action.amountUsd !== undefined && capability.limits) {
    if (
      capability.limits.maxAmountUsd !== undefined &&
      action.amountUsd > capability.limits.maxAmountUsd
    ) {
      errors.push(
        `Amount $${action.amountUsd} exceeds maximum $${capability.limits.maxAmountUsd}`
      );
    }
    if (
      capability.limits.minAmountUsd !== undefined &&
      action.amountUsd < capability.limits.minAmountUsd
    ) {
      warnings.push(
        `Amount $${action.amountUsd} is below recommended minimum $${capability.limits.minAmountUsd}`
      );
    }
  }

  return {
    valid: errors.length === 0,
    capability,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Validate action and throw if validation is required and fails
 */
export function requireValidAction(action: ActionToValidate): void {
  if (!ERC8004_ENABLED || !ERC8004_REQUIRE_VALIDATION) {
    return; // Validation not required
  }

  const result = validateActionAgainstCapabilities(action);

  if (!result.valid) {
    throw new ERC8004Error(
      `Action validation failed: ${result.errors?.join('; ')}`,
      'CAPABILITY_NOT_DECLARED',
      { action, errors: result.errors }
    );
  }

  // Log warnings but don't block
  if (result.warnings && result.warnings.length > 0) {
    console.warn(
      `[erc8004] Validation warnings: ${result.warnings.join('; ')}`
    );
  }
}

// ============================================
// Capability Comparison
// ============================================

/**
 * Compare two capability sets and find differences
 * Useful for detecting capability changes over time
 */
export function compareCapabilities(
  oldCaps: BlossomCapability[],
  newCaps: BlossomCapability[]
): {
  added: BlossomCapability[];
  removed: BlossomCapability[];
  modified: Array<{ old: BlossomCapability; new: BlossomCapability }>;
} {
  const added: BlossomCapability[] = [];
  const removed: BlossomCapability[] = [];
  const modified: Array<{ old: BlossomCapability; new: BlossomCapability }> = [];

  // Check for added/modified capabilities
  for (const newCap of newCaps) {
    const oldCap = oldCaps.find(
      (c) =>
        c.kind === newCap.kind &&
        JSON.stringify(c.chains.sort()) === JSON.stringify(newCap.chains.sort())
    );

    if (!oldCap) {
      added.push(newCap);
    } else if (JSON.stringify(oldCap) !== JSON.stringify(newCap)) {
      modified.push({ old: oldCap, new: newCap });
    }
  }

  // Check for removed capabilities
  for (const oldCap of oldCaps) {
    const newCap = newCaps.find(
      (c) =>
        c.kind === oldCap.kind &&
        JSON.stringify(c.chains.sort()) === JSON.stringify(oldCap.chains.sort())
    );

    if (!newCap) {
      removed.push(oldCap);
    }
  }

  return { added, removed, modified };
}

// ============================================
// Capability Summary
// ============================================

/**
 * Get a human-readable summary of capabilities
 */
export function getCapabilitySummary(): string {
  const capabilities = getBlossomCapabilities();

  if (capabilities.length === 0) {
    return 'No capabilities declared';
  }

  const lines: string[] = ['Declared capabilities:'];

  for (const cap of capabilities) {
    const chains = cap.chains.join(', ');
    const venues = cap.venues.join(', ');
    const leverage = cap.maxLeverageSupported
      ? ` (max ${cap.maxLeverageSupported}x)`
      : '';
    const assets = cap.assetAllowlist
      ? ` [${cap.assetAllowlist.join(', ')}]`
      : '';

    lines.push(`  - ${cap.kind}: ${chains} via ${venues}${leverage}${assets}`);
  }

  return lines.join('\n');
}
