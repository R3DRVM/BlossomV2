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
//# sourceMappingURL=sessionPolicy.d.ts.map