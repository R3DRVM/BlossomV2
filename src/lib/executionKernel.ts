/**
 * Execution Kernel
 *
 * Production execution kernel that routes to the backend API.
 * Provides graceful error handling when venues aren't configured.
 */

import { callAgent } from './apiClient';

export interface ExecutionRequest {
  action: string;
  amount: string;
  protocol?: string;
  vault?: string;
  kind?: string;
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
  executionIntent?: string;
  executionKind?: string;
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
  errorCode?: string;
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
  notes?: string[];
}

// Cache preflight result to avoid repeated checks
let preflightCache: { ok: boolean; venues: Record<string, boolean>; notes: string[] } | null = null;
let preflightCacheTime = 0;
const PREFLIGHT_CACHE_TTL = 30000; // 30 seconds

/**
 * Get venue availability from preflight
 */
async function getVenueAvailability(): Promise<{ ok: boolean; venues: Record<string, boolean>; notes: string[] }> {
  const now = Date.now();

  // Return cached result if still valid
  if (preflightCache && (now - preflightCacheTime) < PREFLIGHT_CACHE_TTL) {
    return preflightCache;
  }

  try {
    const response = await callAgent('/api/execute/preflight');
    if (response.ok) {
      const data = await response.json();
      preflightCache = {
        ok: data.ok ?? false,
        venues: {
          swap: data.swapEnabled ?? data.adapterOk ?? false,
          perps: data.perpsEnabled ?? false,
          lending: data.lendingEnabled ?? false,
          events: data.eventsEnabled ?? true, // Events are proof-only, always available
        },
        notes: data.notes || [],
      };
      preflightCacheTime = now;
      return preflightCache;
    }
  } catch (error) {
    // Preflight failed - assume limited functionality
    console.warn('[executionKernel] Preflight check failed:', error);
  }

  // Default to proof-only mode when preflight fails
  return {
    ok: false,
    venues: { swap: false, perps: false, lending: false, events: true },
    notes: ['Could not verify execution configuration'],
  };
}

/**
 * Get user-friendly message for unavailable venue
 */
function getVenueUnavailableMessage(planType: string): string {
  switch (planType) {
    case 'perp':
      return 'Perpetuals execution is not configured for this environment. Your intent has been recorded. Try swaps or lending instead.';
    case 'swap':
      return 'Swap execution is not fully configured. Please check the demo faucet for test tokens.';
    case 'defi':
    case 'lend':
      return 'Lending/DeFi execution is not configured for this environment. Your intent has been recorded.';
    case 'event':
      return 'Event market execution uses proof-only mode. Your prediction has been recorded on-chain.';
    default:
      return 'This execution venue is not configured for the current environment.';
  }
}

/**
 * Execute a plan via the backend API
 */
export async function executePlan(
  params: ExecutionParams,
  options?: ExecutionOptions
): Promise<ExecutionResult> {
  const logPrefix = '[executionKernel]';

  console.log(`${logPrefix} executePlan called:`, {
    draftId: params.draftId,
    userAddress: params.userAddress?.slice(0, 10) + '...',
    planType: params.planType,
    authMode: options?.executionAuthMode || 'direct',
  });

  // Check venue availability
  const venueStatus = await getVenueAvailability();

  // Determine if this venue type is available
  const venueTypeMap: Record<string, keyof typeof venueStatus.venues> = {
    perp: 'perps',
    swap: 'swap',
    defi: 'lending',
    lend: 'lending',
    event: 'events',
  };

  const venueKey = venueTypeMap[params.planType] || 'swap';
  const venueAvailable = venueStatus.venues[venueKey];

  // For event markets, always use proof-only (they work without full execution setup)
  if (params.planType === 'event') {
    console.log(`${logPrefix} Event market intent - using proof-only mode`);
    return {
      ok: true,
      mode: 'simulated',
      receiptStatus: 'confirmed',
      notes: ['Event market intent recorded (proof-only mode)'],
    };
  }

  // If venue not available, return graceful error
  if (!venueAvailable && !venueStatus.ok) {
    console.log(`${logPrefix} Venue not available for ${params.planType}:`, venueStatus.notes);
    return {
      ok: false,
      mode: 'unsupported',
      error: getVenueUnavailableMessage(params.planType),
      errorCode: 'VENUE_NOT_CONFIGURED',
      notes: venueStatus.notes,
    };
  }

  // Build execution request for backend
  try {
    // For session mode, try relayed execution
    if (options?.executionAuthMode === 'session') {
      // Check session using the same keys the UI uses
      const userAddr = params.userAddress?.toLowerCase();
      const enabledKey = `blossom_oneclick_${userAddr}`;
      const authorizedKey = `blossom_oneclick_auth_${userAddr}`;

      const sessionEnabled = typeof window !== 'undefined' &&
        localStorage.getItem(enabledKey) === 'true' &&
        localStorage.getItem(authorizedKey) === 'true';

      // For relayed execution, we use the address as the session identifier
      const sessionId = sessionEnabled ? userAddr : null;

      if (!sessionId) {
        console.log(`${logPrefix} No session found, falling back to direct mode`);
        return {
          ok: false,
          mode: 'wallet',
          error: 'Session not found. Please enable One-Click Session in the wallet panel, or use the Confirm button to sign manually.',
          errorCode: 'NO_SESSION',
          notes: ['Go to the right sidebar and click "One-Click" to enable session mode.'],
        };
      }

      // Build plan for relayed execution
      const plan = buildExecutionPlan(params);

      const response = await callAgent('/api/execute/relayed', {
        method: 'POST',
        body: JSON.stringify({
          draftId: params.draftId,
          userAddress: params.userAddress,
          sessionId,
          plan,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        // Parse error message - handle both string and object error formats
        let errorMessage = 'Execution failed';
        let errorCode = data.errorCode;

        if (typeof data.error === 'string') {
          errorMessage = data.error;
        } else if (data.error && typeof data.error === 'object') {
          errorMessage = data.error.message || data.error.code || 'Execution failed';
          errorCode = errorCode || data.error.code;
        } else if (data.message) {
          errorMessage = data.message;
        }

        // Check for specific error codes
        const checkCode = errorCode || (data.error?.code);
        if (checkCode === 'VENUE_NOT_CONFIGURED' || checkCode === 'ADAPTER_NOT_ALLOWED' || checkCode === 'ADAPTER_MISSING') {
          return {
            ok: false,
            mode: 'unsupported',
            error: getVenueUnavailableMessage(params.planType),
            errorCode: checkCode,
            notes: data.notes || [],
          };
        }

        return {
          ok: false,
          error: errorMessage,
          errorCode: checkCode,
        };
      }

      // Success from relayed execution
      return {
        ok: true,
        txHash: data.txHash,
        receiptStatus: data.status === 'success' ? 'confirmed' : 'pending',
        mode: 'relayed',
        explorerUrl: data.explorerUrl,
        portfolio: data.portfolio,
        blockNumber: data.blockNumber,
        notes: data.notes,
      };
    }

    // Direct mode - user signs with their wallet
    // This should be handled by the calling code (Chat.tsx) using wagmi
    return {
      ok: false,
      mode: 'wallet',
      error: 'This trade requires your wallet signature. Click "Confirm" in the plan card to sign with your wallet, or enable One-Click Session mode in the sidebar.',
      errorCode: 'DIRECT_MODE',
      notes: ['Enable One-Click Session to skip manual confirmations for future trades.'],
    };

  } catch (error: any) {
    console.error(`${logPrefix} Execution error:`, error);

    // Network/backend errors
    if (error.isNetworkError) {
      return {
        ok: false,
        error: 'Could not connect to execution backend. Please try again.',
        errorCode: 'NETWORK_ERROR',
      };
    }

    return {
      ok: false,
      error: error.message || 'Execution failed unexpectedly',
      errorCode: 'UNKNOWN_ERROR',
    };
  }
}

/**
 * Build execution plan from params
 */
function buildExecutionPlan(params: ExecutionParams): { actions: any[]; metadata: any; deadline: number } {
  const actions: any[] = [];

  // This is a simplified plan builder - the actual complex plan building
  // should be done by the backend based on the executionRequest
  if (params.executionRequest) {
    actions.push({
      type: params.executionRequest.kind || params.planType,
      adapter: '0x0000000000000000000000000000000000000000', // Will be filled by backend
      data: params.executionRequest,
    });
  } else if (params.strategy) {
    actions.push({
      type: params.strategy.instrumentType || params.planType,
      adapter: '0x0000000000000000000000000000000000000000',
      data: {
        strategyId: params.strategy.id,
        ...params.strategy,
      },
    });
  }

  // Set deadline to 5 minutes from now (must be in future but within 10 min limit)
  const deadline = Math.floor(Date.now() / 1000) + 5 * 60;

  return {
    actions,
    deadline,
    metadata: {
      draftId: params.draftId,
      planType: params.planType,
      executionKind: params.executionKind,
      executionIntent: params.executionIntent,
    },
  };
}

/**
 * Get execution status
 */
export async function getExecutionStatus(txHash: string): Promise<ExecutionResult> {
  try {
    const response = await callAgent(`/api/execute/status?txHash=${encodeURIComponent(txHash)}`);

    if (!response.ok) {
      return {
        ok: false,
        error: 'Could not fetch execution status',
      };
    }

    const data = await response.json();
    return {
      ok: data.ok ?? true,
      txHash: data.txHash,
      receiptStatus: data.status,
      explorerUrl: data.explorerUrl,
      blockNumber: data.blockNumber,
    };
  } catch (error: any) {
    return {
      ok: false,
      error: error.message || 'Status check failed',
    };
  }
}

/**
 * Clear preflight cache (useful after configuration changes)
 */
export function clearPreflightCache(): void {
  preflightCache = null;
  preflightCacheTime = 0;
}
