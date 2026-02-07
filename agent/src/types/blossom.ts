/**
 * Blossom Agent Types
 * Shared types for Blossom AI Trading Copilot backend
 */

export type BlossomAction =
  | {
      type: 'perp';
      action: 'open' | 'close';
      market: string; // 'ETH-PERP'
      side: 'long' | 'short';
      riskPct: number; // of account
      entry?: number;
      takeProfit?: number;
      stopLoss?: number;
      reasoning: string[];
    }
  | {
      type: 'defi';
      action: 'deposit' | 'withdraw';
      protocol: string; // 'Kamino', 'RootsFi', 'Jet'
      asset: string; // 'REDACTED'
      amountUsd: number;
      apr: number;
      reasoning: string[];
    }
  | {
      type: 'event';
      action: 'open' | 'close' | 'update';
      eventKey: string; // 'FED_CUTS_MAR_2025'
      label: string; // human-readable
      side: 'YES' | 'NO';
      stakeUsd: number;
      maxPayoutUsd: number;
      maxLossUsd: number;
      reasoning: string[];
      positionId?: string; // Required for 'update' action
      overrideRiskCap?: boolean; // For 'update' action
      requestedStakeUsd?: number; // For 'update' action
    };

export type BlossomExecutionRequest =
  | {
      kind: "swap";
      chain: "sepolia";
      tokenIn: "ETH" | "WETH" | "REDACTED";
      tokenOut: "WETH" | "REDACTED";
      amountIn: string;      // REQUIRED: decimal string, e.g. "0.01" ETH or "10" REDACTED
      amountOut?: string;     // optional target amount
      slippageBps: number;    // basis points, default 50 (0.5%)
      fundingPolicy: "auto" | "require_tokenIn"; // auto = funding route allowed
    }
  | {
      kind: "perp";
      chain: "sepolia";
      market: string; // e.g., "BTC-USD", "ETH-USD"
      side: "long" | "short";
      leverage: number; // e.g., 2, 3
      riskPct?: number; // percentage of account (e.g., 2 for 2%)
      marginUsd?: number; // USD amount for margin
    }
  | {
      kind: "lend" | "lend_supply";
      chain: "sepolia";
      asset: "REDACTED"; // For now, only REDACTED lending
      amount: string; // decimal string, e.g. "100" for 100 REDACTED
      protocol?: "demo" | "aave"; // default: demo
      vault?: string; // Vault name from DefiLlama (e.g., "Aave REDACTED")
    }
  | {
      kind: "event";
      chain: "sepolia";
      marketId: string; // Event market ID
      outcome: "YES" | "NO";
      stakeUsd: number; // USD amount to stake
      price?: number; // Optional: YES/NO price at time of quote
    }
  | {
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
    }
  | {
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
  balances: { symbol: string; balanceUsd: number }[];
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
  strategies: any[]; // Can mirror or map to the Strategy type used in the front-end
}

/**
 * Unified ExecutionResult type for all execution types
 * Used by swap, perp, defi, and event executors
 */
export interface ExecutionResult {
  success: boolean;
  status: 'success' | 'failed';
  txHash?: string; // On-chain transaction hash (for real executions)
  simulatedTxId?: string; // Mock transaction ID (for simulated executions)
  positionDelta?: {
    type: 'perp' | 'defi' | 'event' | 'swap';
    positionId?: string;
    sizeUsd?: number;
    entryPrice?: number;
    side?: 'long' | 'short' | 'YES' | 'NO';
  };
  portfolioDelta?: {
    accountValueDeltaUsd: number;
    balanceDeltas: { symbol: string; deltaUsd: number }[];
    exposureDeltaUsd?: number;
  };
  error?: string;
  errorCode?: 'INSUFFICIENT_BALANCE' | 'SESSION_EXPIRED' | 'RELAYER_FAILED' | 'SLIPPAGE_FAILURE' | 'LLM_REFUSAL' | 'UNKNOWN_ERROR';
  portfolio: BlossomPortfolioSnapshot; // Updated portfolio after execution
}