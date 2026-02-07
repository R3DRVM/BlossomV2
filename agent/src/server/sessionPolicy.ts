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
  // NOTE: spendWei is actually "session spend units" (bUSDC-style 6 decimals).
  // We keep the field name to avoid breaking API responses.
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
          // For swaps, spend is amountIn in token units. Use as-is for session spend units.
          totalSpendWei += BigInt(amountIn);
        } catch {
          // Session mode: wrapped as (maxSpendUnits, innerData)
          try {
            const decoded = decodeAbiParameters(
              [{ type: 'uint256' }, { type: 'bytes' }],
              action.data as `0x${string}`
            );
            const maxSpendUnits = decoded[0];
            // maxSpendUnits is already in session spend units (bUSDC 6 decimals).
            totalSpendWei += maxSpendUnits;
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
          // PULL transfers tokens; count in token units
          totalSpendWei += amount;
        } catch {
          // Session mode: wrapped as (maxSpendUnits, innerData)
          try {
            const decodedWrapped = decodeAbiParameters(
              [{ type: 'uint256' }, { type: 'bytes' }],
              action.data as `0x${string}`
            );
            const maxSpendUnits = decodedWrapped[0];
            totalSpendWei += maxSpendUnits;
          } catch {
            determinable = false;
          }
        }
      } else if (action.actionType === 1) {
        // WRAP action (ETH -> WETH)
        // Spend is already represented in plan.value; no additional spend required.
        instrumentType = instrumentType || 'swap';
        // Keep determinable true.
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
          // For Aave supply, spend is the amount supplied (token units)
          totalSpendWei += amount;
        } catch {
          // Session mode: wrapped as (maxSpendUnits, innerData)
          try {
            const decoded = decodeAbiParameters(
              [{ type: 'uint256' }, { type: 'bytes' }],
              action.data as `0x${string}`
            );
            const maxSpendUnits = decoded[0];
            totalSpendWei += maxSpendUnits;
          } catch {
            determinable = false;
          }
        }
      } else if (action.actionType === 6) {
        // PROOF action (perps/events)
        // In session mode, proof/event actions may be wrapped as (maxSpendUnits, innerData)
        instrumentType = 'event';
        try {
          const decodedWrapped = decodeAbiParameters(
            [{ type: 'uint256' }, { type: 'bytes' }],
            action.data as `0x${string}`
          );
          const maxSpendUnits = decodedWrapped[0];
          totalSpendWei += maxSpendUnits;
        } catch {
          // Raw event format: (bytes32 marketId, uint8 outcome, uint256 amount)
          try {
            const decoded = decodeAbiParameters(
              [{ type: 'bytes32' }, { type: 'uint8' }, { type: 'uint256' }],
              action.data as `0x${string}`
            );
            const amount = decoded[2];
            totalSpendWei += amount;
          } catch {
            // If it isn't event-shaped, fall back conservatively but remain determinable.
            totalSpendWei += BigInt(parseUnits('0.1', 18));
          }
        }
      } else if (action.actionType === 8) {
        // EVENT action (session-wrapped or direct)
        instrumentType = 'event';
        try {
          const decodedWrapped = decodeAbiParameters(
            [{ type: 'uint256' }, { type: 'bytes' }],
            action.data as `0x${string}`
          );
          const maxSpendUnits = decodedWrapped[0];
          totalSpendWei += maxSpendUnits;
        } catch {
          try {
            // Direct router data: (address stakeToken, uint256 amount, bytes adapterData)
            const decoded = decodeAbiParameters(
              [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes' }],
              action.data as `0x${string}`
            );
            const amount = decoded[1];
            totalSpendWei += amount;
          } catch {
            totalSpendWei += BigInt(parseUnits('0.1', 18));
          }
        }
      } else if (action.actionType === 7) {
        // PERP action: (bytes32 market, bool isLong, uint256 size, uint256 leverage)
        instrumentType = 'perp';
        try {
          // Session-wrapped format: (maxSpendUnits, innerData)
          const decodedWrapped = decodeAbiParameters(
            [{ type: 'uint256' }, { type: 'bytes' }],
            action.data as `0x${string}`
          );
          const maxSpendUnits = decodedWrapped[0];
          totalSpendWei += maxSpendUnits;
        } catch {
          try {
            // Raw perp format (fallback for non-session execution)
            const decoded = decodeAbiParameters(
              [{ type: 'bytes32' }, { type: 'bool' }, { type: 'uint256' }, { type: 'uint256' }],
              action.data as `0x${string}`
            );
            const size = decoded[2];
            totalSpendWei += size;
          } catch {
            // Conservative fallback
            totalSpendWei += BigInt(parseUnits('0.1', 18));
          }
        }
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

// ============================================
// Hyperliquid Session Limits (HIP-3)
// ============================================

/**
 * Hyperliquid-specific session limits for HIP-3 market creation and perp trading
 */
export interface HyperliquidSessionLimits {
  /** Maximum open interest per session (in USD) */
  maxOpenInterestUsd: number;

  /** Maximum leverage allowed per position */
  maxLeveragePerPosition: number;

  /** Maximum positions per session */
  maxPositions: number;

  /** Maximum bond spend per session (in HYPE) */
  maxBondSpendHype: bigint;

  /** Maximum market creations per session */
  maxMarketCreations: number;

  /** Leverage bounds by market type */
  leverageBounds: {
    major: number;     // BTC, ETH (higher leverage allowed)
    altcoin: number;   // SOL, AVAX, etc.
    meme: number;      // DOGE, PEPE, WIF (lower leverage for safety)
  };
}

/**
 * Default Hyperliquid session limits
 */
export const DEFAULT_HYPERLIQUID_LIMITS: HyperliquidSessionLimits = {
  maxOpenInterestUsd: 100000,     // $100k max OI per session
  maxLeveragePerPosition: 25,     // 25x max even if market allows more
  maxPositions: 10,               // 10 concurrent positions
  maxBondSpendHype: BigInt('5000000000000000000000000'), // 5M HYPE max bond
  maxMarketCreations: 3,          // 3 market creations per session
  leverageBounds: {
    major: 50,    // Full leverage for majors
    altcoin: 25,  // Reduced for altcoins
    meme: 10,     // Very limited for memes
  },
};

/**
 * Classify asset for leverage bounds
 */
export function classifyAssetForLeverage(
  assetSymbol: string
): 'major' | 'altcoin' | 'meme' {
  const symbol = assetSymbol.toUpperCase().replace('-USD', '').replace('-PERP', '');

  const majors = ['BTC', 'ETH'];
  const memes = ['DOGE', 'SHIB', 'PEPE', 'WIF', 'BONK', 'FLOKI', 'MEME'];

  if (majors.includes(symbol)) return 'major';
  if (memes.includes(symbol)) return 'meme';
  return 'altcoin';
}

/**
 * Get effective max leverage for an asset based on session limits
 */
export function getEffectiveMaxLeverage(
  assetSymbol: string,
  marketMaxLeverage: number,
  limits: HyperliquidSessionLimits = DEFAULT_HYPERLIQUID_LIMITS
): number {
  const assetClass = classifyAssetForLeverage(assetSymbol);
  const classLimit = limits.leverageBounds[assetClass];

  return Math.min(
    marketMaxLeverage,
    limits.maxLeveragePerPosition,
    classLimit
  );
}

/**
 * Hyperliquid session state tracking
 */
export interface HyperliquidSessionState {
  /** Session ID */
  sessionId: string;

  /** User address */
  userAddress: string;

  /** Current open interest in USD */
  currentOpenInterestUsd: number;

  /** Number of open positions */
  openPositions: number;

  /** Bond spent in HYPE this session */
  bondSpentHype: bigint;

  /** Markets created this session */
  marketsCreated: number;

  /** Positions by market ID */
  positionsByMarket: Map<string, {
    side: 'long' | 'short';
    size: number;
    leverage: number;
    entryPrice: number;
  }>;
}

/**
 * Evaluate Hyperliquid session policy for a perp operation
 */
export async function evaluateHyperliquidPolicy(
  state: HyperliquidSessionState,
  operation: {
    type: 'open_position' | 'close_position' | 'create_market';
    market?: string;
    side?: 'long' | 'short';
    size?: number;
    leverage?: number;
    bondAmount?: bigint;
  },
  limits: HyperliquidSessionLimits = DEFAULT_HYPERLIQUID_LIMITS
): Promise<SessionPolicyResult> {
  // Check 1: Market creation limits
  if (operation.type === 'create_market') {
    if (state.marketsCreated >= limits.maxMarketCreations) {
      return {
        allowed: false,
        code: 'HL_MAX_MARKET_CREATIONS',
        message: `Maximum market creations reached (${limits.maxMarketCreations})`,
        details: {
          current: state.marketsCreated,
          max: limits.maxMarketCreations,
        },
      };
    }

    // Check bond spend limit
    const bondAmount = operation.bondAmount || 0n;
    const newTotalBond = state.bondSpentHype + bondAmount;
    if (newTotalBond > limits.maxBondSpendHype) {
      return {
        allowed: false,
        code: 'HL_MAX_BOND_SPEND',
        message: `Bond spend would exceed session limit`,
        details: {
          attemptedBond: bondAmount.toString(),
          currentSpent: state.bondSpentHype.toString(),
          maxAllowed: limits.maxBondSpendHype.toString(),
        },
      };
    }

    return { allowed: true };
  }

  // Check 2: Position limits for open_position
  if (operation.type === 'open_position') {
    // Check max positions
    if (state.openPositions >= limits.maxPositions) {
      return {
        allowed: false,
        code: 'HL_MAX_POSITIONS',
        message: `Maximum positions reached (${limits.maxPositions})`,
        details: {
          current: state.openPositions,
          max: limits.maxPositions,
        },
      };
    }

    // Check leverage bounds
    if (operation.market && operation.leverage) {
      const effectiveLeverage = getEffectiveMaxLeverage(
        operation.market,
        operation.leverage,
        limits
      );

      if (operation.leverage > effectiveLeverage) {
        return {
          allowed: false,
          code: 'HL_LEVERAGE_EXCEEDED',
          message: `Requested leverage (${operation.leverage}x) exceeds allowed (${effectiveLeverage}x) for ${operation.market}`,
          details: {
            requested: operation.leverage,
            allowed: effectiveLeverage,
            assetClass: classifyAssetForLeverage(operation.market),
          },
        };
      }
    }

    // Check OI limits
    const positionOI = (operation.size || 0) * (operation.leverage || 1);
    const newTotalOI = state.currentOpenInterestUsd + positionOI;

    if (newTotalOI > limits.maxOpenInterestUsd) {
      return {
        allowed: false,
        code: 'HL_MAX_OI_EXCEEDED',
        message: `Position would exceed open interest limit`,
        details: {
          currentOI: state.currentOpenInterestUsd,
          positionOI,
          newTotalOI,
          maxOI: limits.maxOpenInterestUsd,
        },
      };
    }

    return { allowed: true };
  }

  // Check 3: Close position always allowed
  if (operation.type === 'close_position') {
    return { allowed: true };
  }

  return {
    allowed: false,
    code: 'HL_UNKNOWN_OPERATION',
    message: `Unknown Hyperliquid operation type: ${operation.type}`,
  };
}

/**
 * Estimate spend for Hyperliquid plan actions
 */
export async function estimateHyperliquidSpend(plan: {
  actions: Array<{ actionType: number; data: string }>;
  value?: string;
}): Promise<{
  bondSpend: bigint;
  marginSpend: bigint;
  determinable: boolean;
  operationType?: 'market_creation' | 'position_open' | 'position_close';
}> {
  let bondSpend = 0n;
  let marginSpend = 0n;
  let determinable = true;
  let operationType: 'market_creation' | 'position_open' | 'position_close' | undefined;

  const { decodeAbiParameters } = await import('viem');

  for (const action of plan.actions) {
    try {
      // Hyperliquid action types (from hyperliquidExecutor.ts)
      const HL_ACTION_REGISTER_ASSET = 1;
      const HL_ACTION_OPEN_POSITION = 2;
      const HL_ACTION_CLOSE_POSITION = 3;

      if (action.actionType === HL_ACTION_REGISTER_ASSET) {
        operationType = 'market_creation';
        // Bond is in plan.value for HIP-3 creation
        bondSpend += BigInt(plan.value || '0x0');
      } else if (action.actionType === HL_ACTION_OPEN_POSITION) {
        operationType = 'position_open';
        try {
          // Session-wrapped: (maxSpendUnits, innerData)
          const decoded = decodeAbiParameters(
            [{ type: 'uint256' }, { type: 'bytes' }],
            action.data as `0x${string}`
          );
          marginSpend += decoded[0];
        } catch {
          determinable = false;
        }
      } else if (action.actionType === HL_ACTION_CLOSE_POSITION) {
        operationType = 'position_close';
        // Close positions don't add spend
      }
    } catch {
      determinable = false;
    }
  }

  return {
    bondSpend,
    marginSpend,
    determinable,
    operationType,
  };
}
