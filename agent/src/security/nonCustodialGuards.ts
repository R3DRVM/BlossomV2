// @ts-nocheck
/**
 * Non-Custodial Signing Guards
 *
 * Explicit guards to ensure Blossom NEVER signs transactions
 * on behalf of users without explicit session delegation.
 *
 * Security Amendment: Explicit non-custodial bridge signing guards
 */

import type { Address } from 'viem';

// ============================================
// Guard Types
// ============================================

export interface SigningContext {
  operation: SigningOperation;
  chain: string;
  walletAddress: Address;
  sessionId?: string;
  hasSessionDelegation?: boolean;
  delegatedCapabilities?: string[];
  spendLimit?: number;
  estimatedUsd?: number;
}

export type SigningOperation =
  | 'swap'
  | 'bridge'
  | 'perp_open'
  | 'perp_close'
  | 'lend_deposit'
  | 'lend_withdraw'
  | 'bridge_source'
  | 'bridge_redeem'
  | 'session_create'
  | 'session_execute';

export interface GuardResult {
  allowed: boolean;
  reason: string;
  requiresUserSignature: boolean;
  warningLevel?: 'info' | 'warning' | 'critical';
  mitigation?: string;
}

// ============================================
// Core Guards
// ============================================

/**
 * CRITICAL: Check if backend is allowed to sign this operation
 *
 * The ONLY case where backend can sign is when:
 * 1. User has created a session with explicit delegation
 * 2. The operation is within delegated capabilities
 * 3. The spend limit is not exceeded
 *
 * Otherwise, user MUST sign with their own wallet.
 */
export function canBackendSign(context: SigningContext): GuardResult {
  // Bridge operations are ALWAYS user-signed (except session-delegated)
  if (context.operation === 'bridge_source' || context.operation === 'bridge_redeem') {
    if (!context.hasSessionDelegation) {
      return {
        allowed: false,
        reason: 'Bridge transactions require user wallet signature',
        requiresUserSignature: true,
        warningLevel: 'critical',
        mitigation: 'Return unsigned transaction data for frontend signing',
      };
    }

    // Check if bridge capability is delegated
    if (!context.delegatedCapabilities?.includes('bridge')) {
      return {
        allowed: false,
        reason: 'Session does not have bridge delegation',
        requiresUserSignature: true,
        warningLevel: 'warning',
      };
    }
  }

  // Session execution requires active session
  if (context.operation === 'session_execute') {
    if (!context.sessionId) {
      return {
        allowed: false,
        reason: 'No active session for relayed execution',
        requiresUserSignature: true,
        warningLevel: 'critical',
      };
    }

    if (!context.hasSessionDelegation) {
      return {
        allowed: false,
        reason: 'Session has not been delegated signing authority',
        requiresUserSignature: true,
        warningLevel: 'critical',
      };
    }
  }

  // No session = always user-signed
  if (!context.hasSessionDelegation) {
    return {
      allowed: false,
      reason: 'No session delegation - user must sign directly',
      requiresUserSignature: true,
      warningLevel: 'info',
    };
  }

  // Check capability delegation
  const requiredCapability = operationToCapability(context.operation);
  if (requiredCapability && !context.delegatedCapabilities?.includes(requiredCapability)) {
    return {
      allowed: false,
      reason: `Operation ${context.operation} requires ${requiredCapability} capability`,
      requiresUserSignature: true,
      warningLevel: 'warning',
    };
  }

  // Check spend limit
  if (context.estimatedUsd && context.spendLimit) {
    if (context.estimatedUsd > context.spendLimit) {
      return {
        allowed: false,
        reason: `Estimated cost ($${context.estimatedUsd}) exceeds session limit ($${context.spendLimit})`,
        requiresUserSignature: true,
        warningLevel: 'warning',
        mitigation: 'User must sign directly or increase session limit',
      };
    }
  }

  // Session with proper delegation - backend can sign
  return {
    allowed: true,
    reason: 'Session has valid delegation for this operation',
    requiresUserSignature: false,
  };
}

/**
 * Map operation to required capability
 */
function operationToCapability(operation: SigningOperation): string | null {
  const mapping: Record<SigningOperation, string | null> = {
    swap: 'swap',
    bridge: 'bridge',
    bridge_source: 'bridge',
    bridge_redeem: 'bridge',
    perp_open: 'perp',
    perp_close: 'perp',
    lend_deposit: 'lend',
    lend_withdraw: 'lend',
    session_create: null, // User always signs session creation
    session_execute: null, // Checked separately
  };
  return mapping[operation];
}

// ============================================
// Bridge-Specific Guards
// ============================================

/**
 * Validate bridge operation is non-custodial
 */
export function validateBridgeNonCustodial(params: {
  sourceChain: string;
  destChain: string;
  amount: string;
  userAddress: Address;
  hasSession: boolean;
  sessionCapabilities?: string[];
}): GuardResult {
  // Check if trying to use session for bridge without delegation
  if (params.hasSession && !params.sessionCapabilities?.includes('bridge')) {
    return {
      allowed: false,
      reason: 'Session does not authorize bridge operations',
      requiresUserSignature: true,
      warningLevel: 'warning',
      mitigation: 'Create new session with bridge capability or sign directly',
    };
  }

  // Cross-chain bridges always need explicit acknowledgment
  return {
    allowed: true,
    reason: 'Bridge requires two user signatures: source chain and destination chain',
    requiresUserSignature: true,
    warningLevel: 'info',
    mitigation: 'Frontend will request wallet signature for each chain',
  };
}

/**
 * Generate signing instructions for bridge
 */
export function getBridgeSigningFlow(params: {
  sourceChain: string;
  destChain: string;
  provider: 'lifi' | 'wormhole' | 'layerzero';
}): {
  steps: SigningStep[];
  totalSignatures: number;
  estimatedWaitMinutes: number;
} {
  const steps: SigningStep[] = [];

  // Step 1: Approve token (if not native)
  steps.push({
    step: 1,
    chain: params.sourceChain,
    action: 'approve_token',
    description: 'Approve token for bridge contract',
    requiresSignature: true,
  });

  // Step 2: Initiate bridge on source
  steps.push({
    step: 2,
    chain: params.sourceChain,
    action: 'bridge_initiate',
    description: 'Lock tokens in bridge contract',
    requiresSignature: true,
  });

  // Step 3: Wait for attestation (no signature)
  const waitTime = params.provider === 'wormhole' ? 15 : 10;
  steps.push({
    step: 3,
    chain: 'bridge_protocol',
    action: 'wait_attestation',
    description: `Wait for ${params.provider} attestation`,
    requiresSignature: false,
    estimatedMinutes: waitTime,
  });

  // Step 4: Redeem on destination
  steps.push({
    step: 4,
    chain: params.destChain,
    action: 'bridge_redeem',
    description: 'Claim tokens on destination chain',
    requiresSignature: true,
  });

  return {
    steps,
    totalSignatures: steps.filter(s => s.requiresSignature).length,
    estimatedWaitMinutes: waitTime,
  };
}

export interface SigningStep {
  step: number;
  chain: string;
  action: string;
  description: string;
  requiresSignature: boolean;
  estimatedMinutes?: number;
}

// ============================================
// Session Delegation Guards
// ============================================

/**
 * Validate session creation request
 */
export function validateSessionCreation(params: {
  capabilities: string[];
  spendLimitUsd: number;
  expiresInHours: number;
  walletAddress: Address;
}): GuardResult {
  // Warn about high-risk capabilities
  const highRiskCaps = ['bridge', 'perp'];
  const requestedHighRisk = params.capabilities.filter(c => highRiskCaps.includes(c));

  if (requestedHighRisk.length > 0) {
    return {
      allowed: true,
      reason: `Session includes high-risk capabilities: ${requestedHighRisk.join(', ')}`,
      requiresUserSignature: true,
      warningLevel: 'warning',
      mitigation: 'User must explicitly acknowledge risk before signing session',
    };
  }

  // Warn about high spend limits
  if (params.spendLimitUsd > 10000) {
    return {
      allowed: true,
      reason: `High spend limit: $${params.spendLimitUsd}`,
      requiresUserSignature: true,
      warningLevel: 'warning',
      mitigation: 'Consider using a lower limit for initial session',
    };
  }

  // Warn about long expiration
  if (params.expiresInHours > 168) { // > 1 week
    return {
      allowed: true,
      reason: `Long session duration: ${params.expiresInHours} hours`,
      requiresUserSignature: true,
      warningLevel: 'warning',
      mitigation: 'Consider shorter session duration for security',
    };
  }

  return {
    allowed: true,
    reason: 'Session parameters within safe limits',
    requiresUserSignature: true,
  };
}

// ============================================
// Audit Trail
// ============================================

export interface SigningAuditEntry {
  timestamp: number;
  sessionId?: string;
  operation: SigningOperation;
  chain: string;
  walletAddress: Address;
  backendSigned: boolean;
  guardResult: GuardResult;
  txHash?: string;
}

const signingAuditLog: SigningAuditEntry[] = [];
const MAX_AUDIT_ENTRIES = 10000;

/**
 * Log a signing decision for audit
 */
export function logSigningDecision(entry: Omit<SigningAuditEntry, 'timestamp'>): void {
  const record: SigningAuditEntry = {
    ...entry,
    timestamp: Date.now(),
  };

  signingAuditLog.push(record);

  if (signingAuditLog.length > MAX_AUDIT_ENTRIES) {
    signingAuditLog.shift();
  }

  // Log for monitoring
  console.log('[security] Signing decision:', {
    op: entry.operation,
    chain: entry.chain,
    backendSigned: entry.backendSigned,
    allowed: entry.guardResult.allowed,
  });
}

/**
 * Get signing audit entries
 */
export function getSigningAudit(params?: {
  sessionId?: string;
  operation?: SigningOperation;
  since?: number;
  limit?: number;
}): SigningAuditEntry[] {
  let entries = [...signingAuditLog];

  if (params?.sessionId) {
    entries = entries.filter(e => e.sessionId === params.sessionId);
  }

  if (params?.operation) {
    entries = entries.filter(e => e.operation === params.operation);
  }

  if (params?.since) {
    entries = entries.filter(e => e.timestamp >= params.since);
  }

  entries.sort((a, b) => b.timestamp - a.timestamp);

  if (params?.limit) {
    entries = entries.slice(0, params.limit);
  }

  return entries;
}

/**
 * Get signing audit summary
 */
export function getSigningAuditSummary(): {
  totalDecisions: number;
  backendSignedCount: number;
  userSignedCount: number;
  blockedCount: number;
  byOperation: Record<string, { backend: number; user: number }>;
} {
  const byOperation: Record<string, { backend: number; user: number }> = {};

  for (const entry of signingAuditLog) {
    if (!byOperation[entry.operation]) {
      byOperation[entry.operation] = { backend: 0, user: 0 };
    }
    if (entry.backendSigned) {
      byOperation[entry.operation].backend++;
    } else {
      byOperation[entry.operation].user++;
    }
  }

  return {
    totalDecisions: signingAuditLog.length,
    backendSignedCount: signingAuditLog.filter(e => e.backendSigned).length,
    userSignedCount: signingAuditLog.filter(e => !e.backendSigned).length,
    blockedCount: signingAuditLog.filter(e => !e.guardResult.allowed).length,
    byOperation,
  };
}

// ============================================
// Invariant Checks
// ============================================

/**
 * CRITICAL INVARIANT: Verify no private keys in request
 */
export function assertNoPrivateKeysInRequest(requestBody: unknown): void {
  const bodyStr = JSON.stringify(requestBody);

  // Check for potential private key patterns
  const privateKeyPatterns = [
    /0x[a-fA-F0-9]{64}/g,  // 32-byte hex (EVM private key)
    /[1-9A-HJ-NP-Za-km-z]{87,88}/g,  // Base58 (Solana private key)
    /"privateKey":/i,
    /"private_key":/i,
    /"secretKey":/i,
    /"secret_key":/i,
    /"seed":\s*"[^"]{20,}"/i,
  ];

  for (const pattern of privateKeyPatterns) {
    if (pattern.test(bodyStr)) {
      throw new Error('SECURITY VIOLATION: Private key detected in request body');
    }
  }
}

/**
 * CRITICAL INVARIANT: Verify wallet address matches session
 */
export function assertWalletMatchesSession(
  requestWallet: Address,
  sessionWallet: Address
): void {
  if (requestWallet.toLowerCase() !== sessionWallet.toLowerCase()) {
    throw new Error(
      `SECURITY VIOLATION: Wallet mismatch - request: ${requestWallet}, session: ${sessionWallet}`
    );
  }
}
