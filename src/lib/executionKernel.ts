/**
 * Execution Kernel
 *
 * Minimal shim for the execution kernel. Real implementation would
 * handle transaction building, signing, and submission.
 *
 * This shim returns safe defaults so the UI renders without errors.
 */

export interface ExecutionRequest {
  action: string;
  amount: string;
  protocol?: string;
  vault?: string;
  [key: string]: any;
}

export interface ExecutionStrategy {
  id: string;
  instrumentType: string;
  protocol?: string;
  depositUsd?: number;
  apyPct?: number;
  [key: string]: any;
}

export interface ExecutionParams {
  draftId: string;
  userAddress: string;
  planType: string;
  executionRequest?: ExecutionRequest;
  strategy?: ExecutionStrategy;
}

export interface ExecutionOptions {
  executionAuthMode?: 'session' | 'direct' | 'relay';
}

export interface ExecutionResult {
  ok: boolean;
  txHash?: string;
  receiptStatus?: 'pending' | 'confirmed' | 'failed' | 'timeout';
  error?: string;
  // Extended fields used by Chat.tsx
  mode?: 'simulated' | 'unsupported' | 'relayed' | 'wallet';
  explorerUrl?: string;
  portfolio?: {
    balances: { symbol: string; amount: number }[];
  };
  routing?: {
    venue: string;
    chain: string;
    executionVenue?: string;
    routingSource?: string;
    routeSummary?: string;
    expectedOut?: string;
    minOut?: string;
    slippageBps?: number;
  };
  blockNumber?: number;
}

/**
 * Execute a plan
 *
 * This is a minimal shim. In production, this would:
 * 1. Build the transaction(s) based on the execution request
 * 2. Sign via wallet or session key
 * 3. Submit to the network
 * 4. Wait for confirmation
 */
export async function executePlan(
  params: ExecutionParams,
  options?: ExecutionOptions
): Promise<ExecutionResult> {
  console.log('[executionKernel] executePlan called with:', {
    draftId: params.draftId,
    userAddress: params.userAddress?.slice(0, 10) + '...',
    planType: params.planType,
    authMode: options?.executionAuthMode || 'direct',
  });

  // In dev mode, return a pending result
  // The UI should handle this gracefully
  return {
    ok: false,
    error: 'Execution kernel not configured. This is a development shim.',
  };
}

/**
 * Get execution status
 */
export async function getExecutionStatus(draftId: string): Promise<ExecutionResult> {
  return {
    ok: false,
    error: 'Not implemented',
  };
}
