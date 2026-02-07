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
    tokenIn: "ETH" | "WETH" | "REDACTED";
    tokenOut: "WETH" | "REDACTED";
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
    asset: "REDACTED";
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
} | {
    /** HIP-3 Market Creation on Hyperliquid */
    kind: "perp_create";
    chain: "hyperliquid_testnet";
    /** Asset symbol for the new market (e.g., "DOGE-USD", "PEPE-USD") */
    assetSymbol: string;
    /** Index token symbol for oracle (e.g., "DOGE", "PEPE") */
    indexToken?: string;
    /** Maximum leverage allowed (1-50) */
    maxLeverage?: number;
    /** Maker fee in basis points (default: 2 = 0.02%) */
    makerFeeBps?: number;
    /** Taker fee in basis points (default: 5 = 0.05%) */
    takerFeeBps?: number;
    /** Oracle type: 'pyth' (default), 'chainlink', or 'custom' */
    oracleType?: "pyth" | "chainlink" | "custom";
    /** Oracle price feed ID (Pyth 32-byte ID or Chainlink aggregator address) */
    oraclePriceId?: string;
    /** HYPE bond amount (string for bigint, default: 1M HYPE) */
    bondAmount?: string;
    /** Maintenance margin in basis points (default: 250 = 2.5%) */
    maintenanceMarginBps?: number;
    /** Initial margin in basis points (default: 500 = 5%) */
    initialMarginBps?: number;
} | {
    /** Open/manage position on Hyperliquid */
    kind: "hyperliquid_perp";
    chain: "hyperliquid_testnet";
    /** Market to trade (e.g., "ETH-USD", "BTC-USD") */
    market: string;
    /** Position side */
    side: "long" | "short";
    /** Position size in contracts/base asset */
    size: string;
    /** Leverage (1-50x) */
    leverage: number;
    /** Action type */
    action: "open" | "close" | "modify";
    /** Reduce-only flag for closing */
    reduceOnly?: boolean;
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