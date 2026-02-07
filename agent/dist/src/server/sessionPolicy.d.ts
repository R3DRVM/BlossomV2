/**
 * Session Authority Policy
 * Server-side enforcement for relayed execution
 */
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
export declare function estimatePlanSpend(plan: {
    actions: Array<{
        actionType: number;
        adapter: string;
        data: string;
    }>;
    value?: string;
}): Promise<PlanSpendEstimate>;
/**
 * Evaluate SessionPolicy for a relayed execution
 */
export declare function evaluateSessionPolicy(sessionId: string, userAddress: string, plan: {
    actions: Array<{
        actionType: number;
        adapter: string;
        data: string;
    }>;
    value?: string;
}, allowedAdapters: Set<string>, getSessionStatus: (sessionId: string) => Promise<SessionStatus | null>, policyOverride?: {
    maxSpendUnits?: string;
    skipSessionCheck?: boolean;
}): Promise<SessionPolicyResult>;
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
        major: number;
        altcoin: number;
        meme: number;
    };
}
/**
 * Default Hyperliquid session limits
 */
export declare const DEFAULT_HYPERLIQUID_LIMITS: HyperliquidSessionLimits;
/**
 * Classify asset for leverage bounds
 */
export declare function classifyAssetForLeverage(assetSymbol: string): 'major' | 'altcoin' | 'meme';
/**
 * Get effective max leverage for an asset based on session limits
 */
export declare function getEffectiveMaxLeverage(assetSymbol: string, marketMaxLeverage: number, limits?: HyperliquidSessionLimits): number;
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
export declare function evaluateHyperliquidPolicy(state: HyperliquidSessionState, operation: {
    type: 'open_position' | 'close_position' | 'create_market';
    market?: string;
    side?: 'long' | 'short';
    size?: number;
    leverage?: number;
    bondAmount?: bigint;
}, limits?: HyperliquidSessionLimits): Promise<SessionPolicyResult>;
/**
 * Estimate spend for Hyperliquid plan actions
 */
export declare function estimateHyperliquidSpend(plan: {
    actions: Array<{
        actionType: number;
        data: string;
    }>;
    value?: string;
}): Promise<{
    bondSpend: bigint;
    marginSpend: bigint;
    determinable: boolean;
    operationType?: 'market_creation' | 'position_open' | 'position_close';
}>;
//# sourceMappingURL=sessionPolicy.d.ts.map