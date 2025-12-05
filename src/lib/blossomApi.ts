/**
 * Blossom Agent API Client
 * Front-end integration layer for calling the backend agent service
 */

const API_BASE_URL = process.env.VITE_AGENT_API_URL || 'http://localhost:3001';

export interface ChatRequest {
  userMessage: string;
  venue: 'hyperliquid' | 'event_demo';
  clientPortfolio?: Partial<BlossomPortfolioSnapshot>;
}

export interface ChatResponse {
  assistantMessage: string;
  actions: BlossomAction[];
  portfolio: BlossomPortfolioSnapshot;
}

export interface CloseRequest {
  strategyId: string;
  type: 'perp' | 'event' | 'defi';
}

export interface CloseResponse {
  summaryMessage: string;
  portfolio: BlossomPortfolioSnapshot;
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
  const response = await fetch(`${API_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(req),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Close a strategy
 */
export async function closeStrategy(req: CloseRequest): Promise<CloseResponse> {
  const response = await fetch(`${API_BASE_URL}/api/strategy/close`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(req),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

