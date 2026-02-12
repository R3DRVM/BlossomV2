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
  userSolanaAddress?: string;
  fromChain?: string;
  planType: string;
  executionRequest?: ExecutionRequest;
  executionIntent?: string;
  executionKind?: string;
  strategy?: ExecutionStrategy;
  metadata?: Record<string, any>;
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
  fundingMode?:
    | 'relayed'
    | 'relayed_after_topup'
    | 'user_pays_gas'
    | 'user_paid_required'
    | 'sponsor_gas_drip'
    | 'blocked_needs_gas';
  walletFallbackTx?: {
    to: string;
    data: string;
    value?: string;
    gas?: string | number;
  };
  gasDripTxHash?: string;
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
  executionMeta?: {
    route?: {
      didRoute: boolean;
      routeType?: string;
      fromChain?: string;
      toChain?: string;
      reason?: string;
      receiptId?: string;
      txHash?: string;
      creditedAmountUsd?: number;
    };
  };
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
          events: data.eventsEnabled ?? false,
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

  // Default to unavailable when preflight fails
  return {
    ok: false,
    venues: { swap: false, perps: false, lending: false, events: false },
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
      return 'Event market execution is not configured for this environment. Your intent has been recorded.';
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
      // Check session using the same keys that OneClickExecution.tsx sets
      const userAddr = params.userAddress?.toLowerCase();
      const enabledKey = `blossom_oneclick_${userAddr}`;
      const authorizedKey = `blossom_oneclick_auth_${userAddr}`;
      const sessionIdKey = `blossom_oneclick_sessionid_${userAddr}`;

      const sessionEnabled = typeof window !== 'undefined' &&
        localStorage.getItem(enabledKey) === 'true' &&
        localStorage.getItem(authorizedKey) === 'true';

      // Retrieve the sessionId that was generated and stored during session creation
      let sessionId: string | null = null;
      if (sessionEnabled && userAddr) {
        const storedSessionId = typeof window !== 'undefined' ? localStorage.getItem(sessionIdKey) : null;

        if (storedSessionId) {
          sessionId = storedSessionId;
          console.log(`${logPrefix} Using stored sessionId:`, sessionId.substring(0, 16) + '...');
        }
      }

      if (!sessionId) {
        console.log(`${logPrefix} No session found for address ${userAddr?.slice(0, 10)}:`, {
          enabledKey,
          enabled: typeof window !== 'undefined' ? localStorage.getItem(enabledKey) : null,
          authorized: typeof window !== 'undefined' ? localStorage.getItem(authorizedKey) : null,
        });
        return {
          ok: false,
          mode: 'wallet',
          error: 'Session not found. Please enable One-Click Session in the wallet panel, or use the Confirm button to sign manually.',
          errorCode: 'NO_SESSION',
          notes: ['Go to the right sidebar and click "One-Click" to enable session mode.'],
        };
      }

      // Validate sessionId format (must be bytes32: 0x + 64 hex chars)
      if (sessionId.length !== 66 || !sessionId.startsWith('0x')) {
        console.error(`${logPrefix} Invalid sessionId format:`, {
          sessionId: sessionId.substring(0, 16) + '...',
          length: sessionId.length,
          expected: 66,
        });
        return {
          ok: false,
          mode: 'wallet',
          error: 'Invalid session ID format. Please disable and re-enable One-Click mode.',
          errorCode: 'INVALID_SESSION_ID',
          notes: ['Session ID must be 66 characters (0x + 64 hex). Try recreating your session.'],
        };
      }

      console.log(`${logPrefix} Session mode enabled for address:`, userAddr?.slice(0, 10));

      // Build plan for relayed execution via backend (ensures correct adapter data + session wrapping)
      let plan: any | null = null;
      let planValue: string | undefined;
      try {
        const prepareResponse = await callAgent('/api/execute/prepare', {
          method: 'POST',
          body: JSON.stringify({
            draftId: params.draftId,
            userAddress: params.userAddress,
            executionRequest: params.executionRequest,
            executionIntent: params.executionIntent,
            strategy: params.strategy,
            executionKind: params.executionKind,
            authMode: 'session',
          }),
        });

        if (!prepareResponse.ok) {
          const errorData = await prepareResponse.json().catch(() => ({ error: 'Failed to prepare session plan' }));
          return {
            ok: false,
            mode: 'wallet',
            error: errorData.error || errorData.message || 'Failed to prepare session plan',
            errorCode: errorData.errorCode,
            notes: errorData.notes || [],
          };
        }

        const prepareData = await prepareResponse.json();
        plan = prepareData?.plan || null;
        planValue = prepareData?.value;
      } catch (prepareError: any) {
        return {
          ok: false,
          mode: 'wallet',
          error: prepareError?.message || 'Failed to prepare session plan',
          errorCode: 'PREPARE_FAILED',
        };
      }

      if (!plan || !plan.actions?.length) {
        return {
          ok: false,
          mode: 'wallet',
          error: 'Prepared plan missing actions. Please retry.',
          errorCode: 'INVALID_PLAN',
        };
      }

      const response = await callAgent('/api/execute/relayed', {
        method: 'POST',
        body: JSON.stringify({
          draftId: params.draftId,
          userAddress: params.userAddress,
          userSolanaAddress: params.userSolanaAddress,
          fromChain: params.fromChain,
          metadata: params.metadata,
          sessionId,
          plan,
          value: planValue,
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
        const errorText = String(errorMessage || '').toLowerCase();
        const isWalletFallback =
          String(data.mode || '').toLowerCase() === 'wallet_fallback' ||
          data.needs_wallet_signature === true;
        const sessionErrorCodes = new Set([
          'SESSION_NOT_CREATED',
          'SESSION_NOT_FOUND',
          'SESSION_EXPIRED_OR_REVOKED',
          'SESSION_NOT_ACTIVE',
          'SESSION_SETUP_REQUIRED',
          'SESSION_SETUP_FAILED',
          'SESSION_SETUP_PENDING',
        ]);
        const isSessionNotCreated =
          (checkCode ? sessionErrorCodes.has(checkCode) : false) ||
          errorText.includes('not_created') ||
          errorText.includes('session not found') ||
          errorText.includes('session expired') ||
          errorText.includes('session revoked');

        if (isWalletFallback) {
          return {
            ok: false,
            mode: 'wallet',
            error: errorMessage || 'Execution requires wallet signature.',
            errorCode: checkCode || 'USER_PAID_REQUIRED',
            walletFallbackTx: data?.execution?.tx,
            fundingMode: data?.fundingMode || data?.executionMeta?.funding?.mode,
            gasDripTxHash: data?.gasDrip?.txHash,
            executionMeta: data?.executionMeta,
            notes: data?.notes || ['Relayer is underfunded. Use wallet-paid gas for this execution.'],
          };
        }

        // Auto-heal stale session IDs once: recreate session and retry relayed execution.
        if (isSessionNotCreated && userAddr) {
          try {
            const prepareSessionResponse = await callAgent('/api/session/prepare', {
              method: 'POST',
              body: JSON.stringify({ userAddress: params.userAddress }),
            });
            if (prepareSessionResponse.ok) {
              const prepareSessionData = await prepareSessionResponse.json();
              const recreatedSessionId = prepareSessionData?.session?.sessionId;
              const sessionTxTo = prepareSessionData?.session?.to;
              const sessionTxData = prepareSessionData?.session?.data;
              const sessionTxValue = prepareSessionData?.session?.value || '0x0';

              // Create session on-chain before retrying relayed execution.
              if (sessionTxTo && sessionTxData) {
                try {
                  const { sendTransaction } = await import('./walletAdapter');
                  const createSessionTxHash = await sendTransaction({
                    to: sessionTxTo,
                    data: sessionTxData,
                    value: sessionTxValue,
                  });
                  if (!createSessionTxHash) {
                    return {
                      ok: false,
                      mode: 'wallet',
                      error: 'Session setup requires a wallet signature. Please confirm the session transaction and retry.',
                      errorCode: 'SESSION_SETUP_REQUIRED',
                    };
                  }

                  // Wait for the session creation tx to confirm before retrying relayed execution.
                  let sessionCreatedConfirmed = false;
                  for (let i = 0; i < 24; i++) {
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                    try {
                      const statusResponse = await callAgent(`/api/execute/status?txHash=${encodeURIComponent(createSessionTxHash)}`, {
                        method: 'GET',
                      });
                      if (!statusResponse.ok) continue;
                      const statusData = await statusResponse.json();
                      const status = String(statusData?.status || '').toLowerCase();
                      if (status === 'confirmed') {
                        sessionCreatedConfirmed = true;
                        break;
                      }
                      if (status === 'reverted' || status === 'failed') {
                        return {
                          ok: false,
                          mode: 'wallet',
                          error: 'Session creation transaction reverted. Please re-enable One-Click and retry.',
                          errorCode: 'SESSION_SETUP_FAILED',
                        };
                      }
                    } catch {
                      // keep polling
                    }
                  }

                  if (!sessionCreatedConfirmed) {
                    return {
                      ok: false,
                      mode: 'wallet',
                      error: 'Session creation is still pending. Wait a few seconds and retry.',
                      errorCode: 'SESSION_SETUP_PENDING',
                    };
                  }
                } catch (createSessionError) {
                  console.warn(`${logPrefix} Session creation transaction failed:`, createSessionError);
                  return {
                    ok: false,
                    mode: 'wallet',
                    error: 'Could not create One-Click session on-chain. Please re-enable One-Click and retry.',
                    errorCode: 'SESSION_SETUP_FAILED',
                  };
                }
              }
              if (typeof window !== 'undefined' && recreatedSessionId) {
                localStorage.setItem(sessionIdKey, recreatedSessionId);
                localStorage.setItem(`blossom_session_${userAddr}`, recreatedSessionId);
                localStorage.setItem(enabledKey, 'true');
                localStorage.setItem(authorizedKey, 'true');
              }

              if (recreatedSessionId && recreatedSessionId.length === 66) {
                const retryResponse = await callAgent('/api/execute/relayed', {
                  method: 'POST',
                  body: JSON.stringify({
                    draftId: params.draftId,
                    userAddress: params.userAddress,
                    userSolanaAddress: params.userSolanaAddress,
                    fromChain: params.fromChain,
                    metadata: params.metadata,
                    sessionId: recreatedSessionId,
                    plan,
                  }),
                });
                const retryData = await retryResponse.json();
                if (retryResponse.ok) {
                  return {
                    ok: true,
                    txHash: retryData.txHash,
                    receiptStatus: retryData.status === 'success' ? 'confirmed' : 'pending',
                    mode: 'relayed',
                    explorerUrl: retryData.explorerUrl,
                    portfolio: retryData.portfolio,
                    blockNumber: retryData.blockNumber,
                    notes: retryData.notes,
                    executionMeta: retryData.executionMeta,
                  };
                }
              }
            }
          } catch (sessionRetryError) {
            console.warn(`${logPrefix} Session auto-retry failed:`, sessionRetryError);
          }
        }

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
        executionMeta: data.executionMeta,
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
