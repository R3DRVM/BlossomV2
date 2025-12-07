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

