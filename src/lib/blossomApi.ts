/**
 * Blossom Agent API Client
 * Front-end integration layer for calling the backend agent service
 */

const BASE_URL = import.meta.env.VITE_BLOSSOM_AGENT_URL || 'http://localhost:3001';

export interface ChatRequest {
  userMessage: string;
  venue: 'hyperliquid' | 'event_demo';
  clientPortfolio?: any; // keep flexible for now
}

export interface ChatResponse {
  assistantMessage: string;
  actions: any[]; // later we can tighten this to a shared type
  portfolio: any; // matches BlossomPortfolioSnapshot from backend
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
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  const res = await fetch(`${BASE_URL}/api/strategy/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    throw new Error(`Blossom agent error: ${res.status}`);
  }

  return res.json();
}

