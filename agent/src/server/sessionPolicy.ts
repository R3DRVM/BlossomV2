// @ts-nocheck
/**
 * Session Authority Policy
 * Server-side enforcement for relayed execution
 */

import { parseUnits } from 'viem';

export interface SessionPolicyResult {
  allowed: boolean;
  code?: string;
  message?: string;
  details?: any;
}

export interface SessionStatus {
  active: boolean;
  owner: string;
  executor: string;
  expiresAt: bigint;
  maxSpend: bigint;
  spent: bigint;
  status: 'active' | 'expired' | 'revoked' | 'not_created';
}

export interface PlanSpendEstimate {
  spendWei: bigint;
  spendUsd?: number;
  determinable: boolean;
  instrumentType?: 'swap' | 'perp' | 'defi' | 'event';
}

/**
 * Estimate spend from plan actions (best effort)
 * Returns spend in wei and whether it could be determined
 */
export async function estimatePlanSpend(plan: {
  actions: Array<{ actionType: number; adapter: string; data: string }>;
  value?: string;
}): Promise<PlanSpendEstimate> {
  let totalSpendWei = BigInt(plan.value || '0x0');
  let determinable = true;
  let instrumentType: 'swap' | 'perp' | 'defi' | 'event' | undefined;

  // Decode actions to estimate spend
  const { decodeAbiParameters } = await import('viem');

  for (const action of plan.actions) {
    try {
      if (action.actionType === 0) {
        // SWAP action
        instrumentType = 'swap';
        try {
          // Try to decode as direct swap (tokenIn, tokenOut, fee, amountIn, ...)
          const decoded = decodeAbiParameters(
            [
              { type: 'address' },
              { type: 'address' },
              { type: 'uint24' },
              { type: 'uint256' },
              { type: 'uint256' },
              { type: 'address' },
              { type: 'uint256' },
            ],
            action.data as `0x${string}`
          );
          const amountIn = decoded[3];
          // For swaps, spend is the amountIn (in token units, not ETH)
          // We can't convert to USD without price oracle, so mark as determinable but don't add to totalSpendWei
          // For now, we'll use a conservative estimate: assume 1 ETH max per swap
          totalSpendWei += BigInt(parseUnits('1', 18)); // Conservative: 1 ETH per swap
        } catch {
          // Session mode: wrapped as (maxSpendUnits, innerData)
          try {
            const decoded = decodeAbiParameters(
              [{ type: 'uint256' }, { type: 'bytes' }],
              action.data as `0x${string}`
            );
            const maxSpendUnits = decoded[0];
            // maxSpendUnits is in token units (e.g., USDC has 6 decimals)
            // Convert to wei-equivalent for comparison (rough estimate: 1 unit = 1e-12 ETH)
            // Actually, for policy, we should compare against session's maxSpend which is in wei
            // So we'll use maxSpendUnits directly as a conservative estimate
            totalSpendWei += maxSpendUnits * BigInt(1e12); // Rough conversion (assumes 6-decimal token)
          } catch {
            determinable = false;
          }
        }
      } else if (action.actionType === 2) {
        // PULL action (token transfer)
        try {
          const decoded = decodeAbiParameters(
            [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }],
            action.data as `0x${string}`
          );
          const amount = decoded[2];
          // PULL doesn't spend ETH, but transfers tokens
          // For policy, we'll count it conservatively
          totalSpendWei += amount * BigInt(1e12); // Rough conversion
        } catch {
          determinable = false;
        }
      } else if (action.actionType === 3) {
        // LEND_SUPPLY action (Aave supply)
        instrumentType = 'defi';
        try {
          // Try to decode as direct supply (asset, vault, amount, onBehalfOf)
          const decoded = decodeAbiParameters(
            [
              { type: 'address' },
              { type: 'address' },
              { type: 'uint256' },
              { type: 'address' },
            ],
            action.data as `0x${string}`
          );
          const amount = decoded[2];
          // For Aave supply, spend is the amount supplied (in token units)
          // Convert to wei-equivalent for policy comparison
          // Assume 6 decimals for USDC (most common)
          totalSpendWei += amount * BigInt(1e12); // Convert 6-decimal token to wei-equivalent
        } catch {
          // Session mode: wrapped as (maxSpendUnits, innerData)
          try {
            const decoded = decodeAbiParameters(
              [{ type: 'uint256' }, { type: 'bytes' }],
              action.data as `0x${string}`
            );
            const maxSpendUnits = decoded[0];
            // maxSpendUnits is in token units (e.g., USDC has 6 decimals)
            totalSpendWei += maxSpendUnits * BigInt(1e12); // Rough conversion (assumes 6-decimal token)
          } catch {
            determinable = false;
          }
        }
      } else if (action.actionType === 6) {
        // PROOF action (perps/events)
        instrumentType = 'perp'; // Default to perp, could be event
        // PROOF actions don't spend tokens directly, they're proof-of-execution
        // For policy, we'll use a conservative estimate
        totalSpendWei += BigInt(parseUnits('0.1', 18)); // Conservative: 0.1 ETH equivalent
      } else {
        // Unknown action type
        determinable = false;
      }
    } catch (error) {
      determinable = false;
    }
  }

  return {
    spendWei: totalSpendWei,
    determinable,
    instrumentType,
  };
}

/**
 * Evaluate SessionPolicy for a relayed execution
 */
export async function evaluateSessionPolicy(
  sessionId: string,
  userAddress: string,
  plan: {
    actions: Array<{ actionType: number; adapter: string; data: string }>;
    value?: string;
  },
  allowedAdapters: Set<string>,
  getSessionStatus: (sessionId: string) => Promise<SessionStatus | null>,
  policyOverride?: { maxSpendUnits?: string; skipSessionCheck?: boolean } // DEV-ONLY override for testing
): Promise<SessionPolicyResult> {
  // Check 1: Session must exist and be active
  // DEV-ONLY: Allow skipping session check in validateOnly mode for testing
  let sessionStatus: SessionStatus | null;
  
  if (policyOverride?.skipSessionCheck && (process.env.NODE_ENV !== 'production' || process.env.DEV === 'true')) {
    // Create a mock active session for testing
    sessionStatus = {
      active: true,
      owner: userAddress,
      executor: userAddress,
      expiresAt: BigInt(Math.floor(Date.now() / 1000) + 86400), // 1 day from now
      maxSpend: policyOverride.maxSpendUnits ? BigInt(policyOverride.maxSpendUnits) : BigInt('10000000000000000000'), // 10 ETH default
      spent: 0n,
      status: 'active',
    };
  } else {
    sessionStatus = await getSessionStatus(sessionId);
    if (!sessionStatus) {
      return {
        allowed: false,
        code: 'SESSION_NOT_ACTIVE',
        message: 'Session not found or not active',
        details: { sessionId: sessionId.substring(0, 10) + '...' },
      };
    }

    if (sessionStatus.status !== 'active') {
      return {
        allowed: false,
        code: 'SESSION_EXPIRED_OR_REVOKED',
        message: `Session is ${sessionStatus.status}`,
        details: {
          status: sessionStatus.status,
          expiresAt: sessionStatus.expiresAt.toString(),
          now: BigInt(Math.floor(Date.now() / 1000)).toString(),
        },
      };
    }
  }

  // Check 2: Adapter must be allowlisted (already checked in relayed endpoint, but verify here too)
  for (const action of plan.actions) {
    const adapter = action.adapter?.toLowerCase();
    if (!adapter || !allowedAdapters.has(adapter)) {
      return {
        allowed: false,
        code: 'ADAPTER_NOT_ALLOWED',
        message: `Adapter ${adapter} not in allowlist`,
        details: {
          adapter,
          allowedAdapters: Array.from(allowedAdapters),
        },
      };
    }
  }

  // Check 3: Spend limits
  const spendEstimate = await estimatePlanSpend(plan);
  
  if (!spendEstimate.determinable) {
    return {
      allowed: false,
      code: 'POLICY_UNDETERMINED_SPEND',
      message: 'Cannot determine plan spend from actions. Policy cannot be evaluated.',
      details: {
        actionCount: plan.actions.length,
        actionTypes: plan.actions.map(a => a.actionType),
      },
    };
  }

  // Check if spend exceeds session's maxSpend
  // DEV-ONLY: Allow policyOverride for testing (only in validateOnly mode, checked by caller)
  let effectiveMaxSpend: bigint;
  let effectiveSpent: bigint;
  
  if (policyOverride?.maxSpendUnits && (process.env.NODE_ENV !== 'production' || import.meta.env?.DEV)) {
    // Use override: treat maxSpendUnits as the effective max spend limit
    effectiveMaxSpend = BigInt(policyOverride.maxSpendUnits);
    effectiveSpent = 0n; // Assume nothing spent yet for override
  } else {
    // Normal path: use on-chain session values
    effectiveMaxSpend = sessionStatus.maxSpend;
    effectiveSpent = sessionStatus.spent;
  }
  
  const remainingSpend = effectiveMaxSpend - effectiveSpent;
  if (spendEstimate.spendWei > remainingSpend) {
    return {
      allowed: false,
      code: 'POLICY_EXCEEDED',
      message: `Plan spend (${spendEstimate.spendWei.toString()}) exceeds remaining session spend limit (${remainingSpend.toString()})`,
      details: {
        spendAttempted: spendEstimate.spendWei.toString(),
        maxSpend: effectiveMaxSpend.toString(),
        spent: effectiveSpent.toString(),
        remaining: remainingSpend.toString(),
        ...(policyOverride?.maxSpendUnits ? { policyOverride: true } : {}),
      },
    };
  }

  // All checks passed
  return {
    allowed: true,
  };
}
