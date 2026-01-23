/**
 * Blossom Agent API Client
 * Front-end integration layer for calling the backend agent service
 */

import { callAgent } from './apiClient';

export interface ChatRequest {
  userMessage: string;
  venue: 'hyperliquid' | 'event_demo';
  clientPortfolio?: any; // keep flexible for now
}

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
    balanceDeltas: { symbol: string; deltaUsd: number }[];
    exposureDeltaUsd?: number;
  };
  error?: string;
  errorCode?: 'INSUFFICIENT_BALANCE' | 'SESSION_EXPIRED' | 'RELAYER_FAILED' | 'SLIPPAGE_FAILURE' | 'LLM_REFUSAL' | 'UNKNOWN_ERROR';
  portfolio: BlossomPortfolioSnapshot;
}

export interface ChatResponse {
  assistantMessage: string;
  actions: any[]; // later we can tighten this to a shared type
  executionRequest?: {
    kind: string;
    chain: string;
    tokenIn: string;
    tokenOut: string;
    amountIn?: string;
    amountOut?: string;
    slippageBps: number;
    fundingPolicy: string;
  } | null;
  modelOk?: boolean;
  portfolio: any; // matches BlossomPortfolioSnapshot from backend
  executionResults?: ExecutionResult[]; // Unified execution results
  errorCode?: 'INSUFFICIENT_BALANCE' | 'SESSION_EXPIRED' | 'RELAYER_FAILED' | 'SLIPPAGE_FAILURE' | 'LLM_REFUSAL' | 'UNKNOWN_ERROR';
}

export interface CloseRequest {
  strategyId: string;
  type: 'perp' | 'event' | 'defi';
}

export interface CloseResponse {
  summaryMessage: string;
  portfolio: any;
}

// Re-export types from agent (these should match backend types)
export type BlossomAction =
  | {
      type: 'perp';
      action: 'open' | 'close';
      market: string;
      side: 'long' | 'short';
      riskPct: number;
      entry?: number;
      takeProfit?: number;
      stopLoss?: number;
      reasoning: string[];
    }
  | {
      type: 'defi';
      action: 'deposit' | 'withdraw';
      protocol: string;
      asset: string;
      amountUsd: number;
      apr: number;
      reasoning: string[];
    }
  | {
      type: 'event';
      action: 'open' | 'close';
      eventKey: string;
      label: string;
      side: 'YES' | 'NO';
      stakeUsd: number;
      maxPayoutUsd: number;
      maxLossUsd: number;
      reasoning: string[];
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
  strategies: any[];
}

/**
 * Call Blossom chat endpoint
 */
export async function callBlossomChat(req: ChatRequest): Promise<ChatResponse> {
  const res = await callAgent('/api/chat', {
    method: 'POST',
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    throw new Error(`Blossom agent error: ${res.status}`);
  }

  return res.json();
}

/**
 * Close a strategy
 */
export async function closeStrategy(req: CloseRequest): Promise<CloseResponse> {
  const res = await callAgent('/api/strategy/close', {
    method: 'POST',
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    throw new Error(`Blossom agent error: ${res.status}`);
  }

  return res.json();
}

/**
 * Reset simulation state
 */
export async function resetSim(): Promise<{ portfolio: any; message: string }> {
  const res = await callAgent('/api/reset', {
    method: 'POST',
  });

  if (!res.ok) {
    throw new Error(`Blossom agent error: ${res.status}`);
  }

  return res.json();
}

