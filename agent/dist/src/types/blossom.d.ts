/**
 * Blossom Agent Types
 * Shared types for Blossom AI Trading Copilot backend
 */
export type BlossomAction = {
    type: 'perp';
    action: 'open' | 'close';
    market: string;
    side: 'long' | 'short';
    riskPct: number;
    entry?: number;
    takeProfit?: number;
    stopLoss?: number;
    reasoning: string[];
} | {
    type: 'defi';
    action: 'deposit' | 'withdraw';
    protocol: string;
    asset: string;
    amountUsd: number;
    apr: number;
    reasoning: string[];
} | {
    type: 'event';
    action: 'open' | 'close' | 'update';
    eventKey: string;
    label: string;
    side: 'YES' | 'NO';
    stakeUsd: number;
    maxPayoutUsd: number;
    maxLossUsd: number;
    reasoning: string[];
    positionId?: string;
    overrideRiskCap?: boolean;
    requestedStakeUsd?: number;
};
export type BlossomExecutionRequest = {
    kind: "swap";
    chain: "sepolia";
    tokenIn: "ETH" | "WETH" | "USDC";
    tokenOut: "WETH" | "USDC";
    amountIn: string;
    amountOut?: string;
    slippageBps: number;
    fundingPolicy: "auto" | "require_tokenIn";
} | {
    kind: "perp";
    chain: "sepolia";
    market: string;
    side: "long" | "short";
    leverage: number;
    riskPct?: number;
    marginUsd?: number;
} | {
    kind: "lend" | "lend_supply";
    chain: "sepolia";
    asset: "USDC";
    amount: string;
    protocol?: "demo" | "aave";
    vault?: string;
} | {
    kind: "event";
    chain: "sepolia";
    marketId: string;
    outcome: "YES" | "NO";
    stakeUsd: number;
    price?: number;
};
export interface BlossomPortfolioSnapshot {
    accountValueUsd: number;
    balances: {
        symbol: string;
        balanceUsd: number;
    }[];
    openPerpExposureUsd: number;
    eventExposureUsd: number;
    defiPositions: {
        id: string;
        protocol: string;
        asset: string;
        depositUsd: number;
        apr: number;
        openedAt: number;
        isClosed: boolean;
    }[];
    strategies: any[];
}
/**
 * Unified ExecutionResult type for all execution types
 * Used by swap, perp, defi, and event executors
 */
export interface ExecutionResult {
    success: boolean;
    status: 'success' | 'failed';
    txHash?: string;
    simulatedTxId?: string;
    positionDelta?: {
        type: 'perp' | 'defi' | 'event' | 'swap';
        positionId?: string;
        sizeUsd?: number;
        entryPrice?: number;
        side?: 'long' | 'short' | 'YES' | 'NO';
    };
    portfolioDelta?: {
        accountValueDeltaUsd: number;
        balanceDeltas: {
            symbol: string;
            deltaUsd: number;
        }[];
        exposureDeltaUsd?: number;
    };
    error?: string;
    errorCode?: 'INSUFFICIENT_BALANCE' | 'SESSION_EXPIRED' | 'RELAYER_FAILED' | 'SLIPPAGE_FAILURE' | 'LLM_REFUSAL' | 'UNKNOWN_ERROR';
    portfolio: BlossomPortfolioSnapshot;
}
//# sourceMappingURL=blossom.d.ts.map