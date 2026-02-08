// @ts-nocheck
/**
 * ETH Testnet Executor
 * Prepares execution plans and EIP-712 typed data for signing
 */

import {
  EXECUTION_ROUTER_ADDRESS,
  MOCK_SWAP_ADAPTER_ADDRESS,
  UNISWAP_V3_ADAPTER_ADDRESS,
  UNISWAP_ADAPTER_ADDRESS,
  WETH_WRAP_ADAPTER_ADDRESS,
  ERC20_PULL_ADAPTER_ADDRESS,
  REDACTED_ADDRESS_SEPOLIA,
  WETH_ADDRESS_SEPOLIA,
  DEMO_REDACTED_ADDRESS,
  DEMO_WETH_ADDRESS,
  DEMO_LEND_VAULT_ADDRESS,
  DEMO_LEND_ADAPTER_ADDRESS,
  PROOF_ADAPTER_ADDRESS,
  DEMO_PERP_ADAPTER_ADDRESS,
  DEMO_PERP_ENGINE_ADDRESS,
  DEMO_EVENT_ADAPTER_ADDRESS,
  DEMO_EVENT_ENGINE_ADDRESS,
  ETH_TESTNET_RPC_URL,
  ETH_TESTNET_CHAIN_ID,
  requireEthTestnetConfig,
  AAVE_WETH_ADDRESS,
} from '../config';
import { getSwapQuote, getSwapRoutingDecision, RoutingDecision } from '../quotes/evmQuote';
import { getLendingRoutingDecision, LendingRoutingDecision } from '../quotes/lendingQuote';
import { BlossomExecutionRequest } from '../types/blossom';
import { erc20_balanceOf, erc20_allowance } from './erc20Rpc';
import { eth_call, padAddress, encodeCall, decodeUint256 } from './evmRpc';
import { parseUnits } from 'viem';
import { makeCorrelationId } from '../utils/correlationId';

export interface PrepareEthTestnetExecutionArgs {
  draftId: string;
  userAddress: string;
  strategy?: any;
  authMode?: 'direct' | 'session';
  executionIntent?: 'mock' | 'swap_usdc_weth' | 'swap_weth_usdc';
  executionRequest?: BlossomExecutionRequest; // NEW: from chat
  executionKind?: 'demo_swap' | 'lend_supply' | 'perp' | 'event' | 'default'; // demo_swap triggers PULL+SWAP, lend_supply triggers PULL+LEND, perp/event triggers PROOF
}

export interface ApprovalRequirement {
  token: string;
  spender: string;
  amount: string;
}

export interface PrepareEthTestnetExecutionResult {
  chainId: number;
  to: string;
  value: string;
  plan: {
    user: string;
    nonce: string;
    deadline: string;
    actions: Array<{
      actionType: number;
      adapter: string;
      data: string;
    }>;
  };
  requirements?: {
    approvals?: ApprovalRequirement[];
  };
  typedData?: {
    domain: {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: string;
    };
    types: {
      EIP712Domain: Array<{ name: string; type: string }>;
      Action: Array<{ name: string; type: string }>;
      Plan: Array<{ name: string; type: string }>;
    };
    primaryType: string;
    message: {
      user: string;
      nonce: string;
      deadline: string;
      actions: Array<{
        actionType: number;
        adapter: string;
        data: string;
      }>;
    };
  };
  call: {
    method: 'executeBySender';
    args: {
      plan: {
        user: string;
        nonce: string;
        deadline: string;
        actions: Array<{
          actionType: number;
          adapter: string;
          data: string;
        }>;
      };
    };
  };
  summary: string;
  warnings?: string[];
  routing?: {
    // Quote data (for swaps)
    venue: string;
    chain: string;
    feeTier?: number;
    expectedOut?: string;     // Human-readable (e.g., "0.95")
    expectedOutRaw?: string; // BigInt string (wei) for contract calls
    minOut?: string;          // Human-readable
    minOutRaw?: string;      // BigInt string (wei) for contract calls
    slippageBps?: number;
    settlementEstimate: string;
    // Hybrid routing fields
    routingSource?: '1inch' | 'deterministic' | 'defillama' | 'dflow' | 'uniswap';
    routeSummary?: string;
    protocols?: string[];
    // Sprint 3: Truthful routing metadata
    routing?: {
      source: 'dflow' | 'fallback';
      kind: 'swap_quote' | 'event_markets';
      ok: boolean;
      reason?: string;
      latencyMs: number;
    };
    estimatedGas?: string;
    executionVenue?: string;
    executionNote?: string;
    warnings?: string[];
    // Lending-specific fields
    apr?: string; // e.g., "5.00"
    aprBps?: number;
    vault?: string; // Vault address
    actionType?: 'swap' | 'lend_supply';
    venueType?: number;
  };
  netExposure?: string; // Static net exposure string (e.g., "Net: Perp delta +0.5%, Yield +5%")
}

/**
 * Convert executionRequest to executionIntent and params
 */
export function executionRequestToIntent(
  executionRequest: BlossomExecutionRequest
): {
  executionIntent: 'swap_usdc_weth' | 'swap_weth_usdc';
  amountIn: bigint;
  tokenIn: string;
  tokenOut: string;
  fundingPolicy: 'auto' | 'require_tokenIn';
} {
  if (executionRequest.kind !== 'swap') {
    throw new Error('Only swap execution requests supported');
  }

  // Use real addresses if configured, otherwise fallback to demo addresses
  // This allows swap preparation to work when only demo tokens are configured
  const usdcAddress = REDACTED_ADDRESS_SEPOLIA || DEMO_REDACTED_ADDRESS;
  const wethAddress = WETH_ADDRESS_SEPOLIA || DEMO_WETH_ADDRESS;

  if (!usdcAddress || !wethAddress) {
    throw new Error('Token addresses not configured (set REDACTED_ADDRESS_SEPOLIA/WETH_ADDRESS_SEPOLIA or DEMO_REDACTED_ADDRESS/DEMO_WETH_ADDRESS)');
  }

  // Normalize token names - accept USDC/bUSDC/REDACTED as the same token
  const isStablecoin = (token: string) => ['USDC', 'bUSDC', 'REDACTED'].includes(token.toUpperCase());
  const tokenIn = executionRequest.tokenIn.toUpperCase();
  const tokenOut = executionRequest.tokenOut.toUpperCase();

  // Determine token addresses
  const tokenInAddr = tokenIn === 'ETH'
    ? 'ETH' // Special case for native ETH
    : tokenIn === 'WETH'
    ? wethAddress.toLowerCase()
    : usdcAddress.toLowerCase();

  const tokenOutAddr = tokenOut === 'WETH'
    ? wethAddress.toLowerCase()
    : usdcAddress.toLowerCase();

  // Determine executionIntent
  let executionIntent: 'swap_usdc_weth' | 'swap_weth_usdc';
  if (isStablecoin(tokenIn) && tokenOut === 'WETH') {
    executionIntent = 'swap_usdc_weth';
  } else if (tokenIn === 'WETH' && isStablecoin(tokenOut)) {
    executionIntent = 'swap_weth_usdc';
  } else if (tokenIn === 'ETH') {
    // ETH input: will need funding route, use WETH→REDACTED or REDACTED→WETH based on tokenOut
    executionIntent = isStablecoin(tokenOut) ? 'swap_weth_usdc' : 'swap_usdc_weth';
  } else {
    throw new Error(`Unsupported swap: ${executionRequest.tokenIn} → ${executionRequest.tokenOut}`);
  }

  // Convert amountIn to bigint using viem parseUnits (no float math)
  let amountIn: bigint;
  if (tokenIn === 'ETH' || tokenIn === 'WETH') {
    // 18 decimals
    amountIn = parseUnits(executionRequest.amountIn, 18);
  } else {
    // USDC/bUSDC/REDACTED: 6 decimals
    amountIn = parseUnits(executionRequest.amountIn, 6);
  }

  return {
    executionIntent,
    amountIn,
    tokenIn: tokenInAddr,
    tokenOut: tokenOutAddr,
    fundingPolicy: executionRequest.fundingPolicy,
  };
}

/**
 * Fetch nonce from ExecutionRouter contract via RPC
 */
async function fetchNonceFromChain(userAddress: string): Promise<string> {
  if (!ETH_TESTNET_RPC_URL) {
    throw new Error('ETH_TESTNET_RPC_URL is required to fetch nonce');
  }

  if (!EXECUTION_ROUTER_ADDRESS) {
    throw new Error('EXECUTION_ROUTER_ADDRESS is required to fetch nonce');
  }

  // Encode function call: nonces(address)
  // Function selector: nonces(address) = 0x7ecebe00
  const functionSelector = '0x7ecebe00';
  const paddedAddr = padAddress(userAddress);
  const callData = encodeCall(functionSelector, paddedAddr.slice(2));

  try {
    const result = await eth_call(ETH_TESTNET_RPC_URL, EXECUTION_ROUTER_ADDRESS, callData);
    return decodeUint256(result);
  } catch (error: any) {
    console.error('[ethTestnetExecutor] Failed to fetch nonce:', error);
    throw new Error(`Failed to fetch nonce from chain: ${error.message}`);
  }
}

/**
 * Prepare ETH testnet execution plan and EIP-712 typed data
 */
export async function prepareEthTestnetExecution(
  args: PrepareEthTestnetExecutionArgs
): Promise<PrepareEthTestnetExecutionResult> {
  const { draftId, userAddress, strategy, authMode = 'direct', executionIntent: providedIntent, executionRequest, executionKind = 'default' } = args;
  
  // If executionRequest provided, convert to intent
  let executionIntent: 'mock' | 'swap_usdc_weth' | 'swap_weth_usdc' = providedIntent || 'mock';
  let fundingPolicy: 'auto' | 'require_tokenIn' = 'require_tokenIn';
  let requestAmountIn: bigint | undefined;
  
  // Demo swap mode: force swap intent
  const isDemoSwap = executionKind === 'demo_swap' && DEMO_REDACTED_ADDRESS && DEMO_WETH_ADDRESS;
  if (isDemoSwap && !executionRequest) {
    // Default to REDACTED → WETH demo swap
    executionIntent = 'swap_usdc_weth';
    fundingPolicy = 'require_tokenIn';
    requestAmountIn = parseUnits('100', 6); // 100 REDACTED default
  }
  
  // Lending supply mode: detect from executionKind or executionRequest
  const isLendSupply = executionKind === 'lend_supply' && DEMO_REDACTED_ADDRESS && DEMO_LEND_VAULT_ADDRESS && DEMO_LEND_ADAPTER_ADDRESS;
  let lendAmount: bigint | undefined;
  if (isLendSupply && !executionRequest) {
    // Default to 100 REDACTED lending
    lendAmount = parseUnits('100', 6);
    fundingPolicy = 'require_tokenIn';
  }
  
  if (executionRequest && executionRequest.kind === 'swap') {
    const intentData = executionRequestToIntent(executionRequest);
    executionIntent = intentData.executionIntent;
    fundingPolicy = intentData.fundingPolicy;
    requestAmountIn = intentData.amountIn;
  }
  
  // Also check executionRequest for lending intent
  // Support both REDACTED (6 decimals) and WETH (18 decimals)
  let lendAsset: string | undefined;
  if (executionRequest && executionRequest.kind === 'lend') {
    const amountStr = executionRequest.amount || '100';
    lendAsset = (executionRequest as any).asset?.toUpperCase() || 'REDACTED';
    const lendDecimals = lendAsset === 'WETH' ? 18 : 6;
    lendAmount = parseUnits(amountStr, lendDecimals);
    fundingPolicy = 'require_tokenIn';
  }

  // Validate user address
  if (!userAddress) {
    throw new Error('userAddress is required');
  }

  // Validate address format (basic check)
  if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
    throw new Error(`Invalid userAddress format: ${userAddress}`);
  }

  // Require ETH testnet config
  requireEthTestnetConfig();

  if (!EXECUTION_ROUTER_ADDRESS || !MOCK_SWAP_ADAPTER_ADDRESS) {
    throw new Error('EXECUTION_ROUTER_ADDRESS and MOCK_SWAP_ADAPTER_ADDRESS must be set');
  }

  // Determine nonce
  let nonce: string;
  const warnings: string[] = [];

  if (ETH_TESTNET_RPC_URL) {
    try {
      nonce = await fetchNonceFromChain(userAddress);
      console.log(`[ethTestnetExecutor] Fetched nonce for ${userAddress}: ${nonce}`);
    } catch (error: any) {
      console.warn(`[ethTestnetExecutor] Failed to fetch nonce, using 0: ${error.message}`);
      nonce = '0';
      warnings.push(
        `ETH_TESTNET_RPC_URL present but nonce fetch failed: ${error.message}. Using nonce 0 (first tx only).`
      );
    }
  } else {
    nonce = '0';
    warnings.push(
      'ETH_TESTNET_RPC_URL missing; nonce fetch disabled (first tx only). Set ETH_TESTNET_RPC_URL to enable nonce fetching.'
    );
  }

  // Set deadline: now + 10 minutes (unix seconds)
  const deadlineSeconds = Math.floor(Date.now() / 1000) + 10 * 60;
  const deadline = deadlineSeconds.toString();

  // Debug logging
  console.log('[ethTestnetExecutor] Building actions with:', {
    executionKind,
    executionIntent,
    hasStrategy: !!strategy,
    strategyType: strategy?.type,
    strategyInstrumentType: strategy?.instrumentType,
    hasPROOF_ADAPTER: !!PROOF_ADAPTER_ADDRESS,
  });

  // Build actions array based on executionIntent
  let actions: Array<{
    actionType: number;
    adapter: string;
    data: string;
  }>;
  
  // Track approval requirements (will be added to result later)
  let approvalRequirements: ApprovalRequirement[] | undefined;
  
  // Track if we need to set value > 0 for WRAP action
  let planValue: string = '0x0';

  // Track routing metadata (for demo swaps) - declared at function scope
  let routingMetadata: PrepareEthTestnetExecutionResult['routing'] | undefined;

  // Track summary - declared at function scope
  let summary: string = '';

  // Route 2: Check if funding route is needed (ETH → WETH → swap)
  const needsFundingRoute = executionRequest && 
    executionRequest.kind === 'swap' &&
    executionRequest.tokenIn === 'ETH' &&
    fundingPolicy === 'auto' &&
    WETH_WRAP_ADAPTER_ADDRESS;

  if (needsFundingRoute) {
    // Compose atomic funding route: WRAP(ETH→WETH) + SWAP(WETH→tokenOut)
    if (!UNISWAP_V3_ADAPTER_ADDRESS) {
      throw new Error('UNISWAP_V3_ADAPTER_ADDRESS not configured for funding route');
    }
    // Use real or demo token addresses (fallback to demo if real not configured)
    const wethAddress = WETH_ADDRESS_SEPOLIA || DEMO_WETH_ADDRESS;
    const usdcAddress = REDACTED_ADDRESS_SEPOLIA || DEMO_REDACTED_ADDRESS;
    if (!wethAddress) {
      throw new Error('WETH address not configured (set WETH_ADDRESS_SEPOLIA or DEMO_WETH_ADDRESS)');
    }
    if (!usdcAddress) {
      throw new Error('REDACTED address not configured (set REDACTED_ADDRESS_SEPOLIA or DEMO_REDACTED_ADDRESS)');
    }

    const wrapAmount = requestAmountIn!; // Already validated above

    // Step 1: WRAP action (ETH → WETH)
    // If tokenOut is WETH, wrap directly to user (no swap needed)
    // If tokenOut is REDACTED, wrap to router so router can swap
    const { encodeAbiParameters } = await import('viem');
    const wrapRecipient = executionRequest.tokenOut === 'WETH'
      ? userAddress.toLowerCase() // Direct to user if final output is WETH
      : EXECUTION_ROUTER_ADDRESS!.toLowerCase(); // To router if we need to swap

    const wrapData = encodeAbiParameters(
      [{ type: 'address' }],
      [wrapRecipient as `0x${string}`]
    );

    const wrapAction = {
      actionType: 1, // WRAP (from PlanTypes.ActionType enum)
      adapter: WETH_WRAP_ADAPTER_ADDRESS!.toLowerCase(), // Checked above
      data: wrapData,
    };

    // Step 2: SWAP action (only if tokenOut is not WETH)
    if (executionRequest.tokenOut === 'REDACTED') {
      const tokenOut = usdcAddress.toLowerCase();
      const fee = 3000; // 0.3% fee tier
      const amountOutMin = 0n; // No slippage protection for MVP
      const recipient = userAddress.toLowerCase();
      const swapDeadline = deadlineSeconds;

      const swapInnerData = encodeAbiParameters(
        [
          { type: 'address' },
          { type: 'address' },
          { type: 'uint24' },
          { type: 'uint256' },
          { type: 'uint256' },
          { type: 'address' },
          { type: 'uint256' },
        ],
        [
          wethAddress.toLowerCase() as `0x${string}`,
          tokenOut as `0x${string}`,
          fee,
          wrapAmount, // Use wrapped amount as swap input
          amountOutMin,
          recipient as `0x${string}`,
          BigInt(swapDeadline)
        ]
      );

      const swapAction = {
        actionType: 0, // SWAP
        adapter: UNISWAP_V3_ADAPTER_ADDRESS.toLowerCase(),
        data: swapInnerData,
      };

      // Compose plan: [WRAP, SWAP]
      actions = [wrapAction, swapAction];
    } else {
      // tokenOut is WETH: only wrap needed
      actions = [wrapAction];
    }
    
    // Set value to wrap amount (user sends ETH with transaction)
    planValue = '0x' + wrapAmount.toString(16);

    // Check allowance for WETH (router needs to approve adapter for swap)
    if (ETH_TESTNET_RPC_URL && EXECUTION_ROUTER_ADDRESS) {
      try {
        // Note: Router will hold WETH after wrap, so we check router's allowance
        // But router doesn't exist yet, so we check if user would need to approve
        // Actually: router will pull WETH from itself (it received from wrap)
        // So no approval needed from user - router approves adapter internally
        
        // For funding route, we still need to check if router can approve adapter
        // This is handled in ExecutionRouter._executeSwapAction
        // But we should add approval requirement for router → adapter
        // Actually, router handles this internally in _executeSwapAction
        
        // Add warning about funding route
        warnings.push(
          `FUNDING_ROUTE: Composing atomic route: Wrap ${executionRequest.amountIn} ETH → WETH, then swap WETH → ${executionRequest.tokenOut}.`
        );
      } catch (error: any) {
        warnings.push(
          `Could not verify funding route: ${error.message}. Proceeding anyway.`
        );
      }
    }
  } else if (executionIntent === 'swap_usdc_weth' || executionIntent === 'swap_weth_usdc') {
    // Check execution mode: real vs demo
    const { EXECUTION_SWAP_MODE } = await import('../config');
    const useRealExecution = EXECUTION_SWAP_MODE === 'real';

    // Check token configuration
    const realTokensConfigured = !!(REDACTED_ADDRESS_SEPOLIA && WETH_ADDRESS_SEPOLIA);
    const demoTokensConfigured = !!(DEMO_REDACTED_ADDRESS && DEMO_WETH_ADDRESS);

    // Use demo tokens if:
    // 1. Not real mode and demo tokens configured and (isDemoSwap or swap request matches), OR
    // 2. Real mode requested but real tokens not configured, fallback to demo if available
    const useDemoTokens = demoTokensConfigured && (
      // Case 1: Explicitly not real mode
      (!useRealExecution && (
        isDemoSwap ||
        (executionRequest && executionRequest.kind === 'swap' &&
          ((executionRequest.tokenIn === 'REDACTED' && executionRequest.tokenOut === 'WETH') ||
           (executionRequest.tokenIn === 'WETH' && executionRequest.tokenOut === 'REDACTED')))
      )) ||
      // Case 2: Real mode but real tokens missing - fallback to demo
      (useRealExecution && !realTokensConfigured)
    );

    // Determine token addresses (demo or real)
    let tokenIn: string;
    let tokenOut: string;
    let swapAdapter: string;
    let pullAdapter: string | undefined;

    if (useDemoTokens && DEMO_REDACTED_ADDRESS && DEMO_WETH_ADDRESS) {
      // Use demo tokens and adapters
      tokenIn = executionIntent === 'swap_usdc_weth'
        ? DEMO_REDACTED_ADDRESS.toLowerCase()
        : DEMO_WETH_ADDRESS.toLowerCase();
      tokenOut = executionIntent === 'swap_usdc_weth'
        ? DEMO_WETH_ADDRESS.toLowerCase()
        : DEMO_REDACTED_ADDRESS.toLowerCase();
      // Use MockSwapAdapter for demo token swaps (UniswapV3 has no pool for demo tokens)
      swapAdapter = MOCK_SWAP_ADAPTER_ADDRESS?.toLowerCase() || '';
      pullAdapter = ERC20_PULL_ADAPTER_ADDRESS?.toLowerCase();

      if (!swapAdapter) {
        throw new Error('MOCK_SWAP_ADAPTER_ADDRESS not configured for demo swap');
      }
      if (!pullAdapter) {
        throw new Error('ERC20_PULL_ADAPTER_ADDRESS not configured for demo swap');
      }
    } else {
      // Use real tokens (existing behavior)
      if (!UNISWAP_V3_ADAPTER_ADDRESS) {
        throw new Error('UNISWAP_V3_ADAPTER_ADDRESS not configured');
      }
      if (!REDACTED_ADDRESS_SEPOLIA) {
        throw new Error('REDACTED_ADDRESS_SEPOLIA not configured');
      }
      if (!WETH_ADDRESS_SEPOLIA) {
        throw new Error('WETH_ADDRESS_SEPOLIA not configured');
      }

      tokenIn = executionIntent === 'swap_usdc_weth' 
        ? REDACTED_ADDRESS_SEPOLIA.toLowerCase()
        : WETH_ADDRESS_SEPOLIA.toLowerCase();
      tokenOut = executionIntent === 'swap_usdc_weth'
        ? WETH_ADDRESS_SEPOLIA.toLowerCase()
        : REDACTED_ADDRESS_SEPOLIA.toLowerCase();
      swapAdapter = UNISWAP_V3_ADAPTER_ADDRESS.toLowerCase();
      pullAdapter = undefined; // Real swaps don't use PULL adapter yet
    }

    // Derive amountIn from executionRequest, strategy, or use default
    let amountIn: bigint;
    const decimalsIn = useDemoTokens 
      ? (executionIntent === 'swap_usdc_weth' ? 6 : 18)
      : (executionIntent === 'swap_usdc_weth' ? 6 : 18);
    
    if (requestAmountIn) {
      // Use amount from executionRequest (already in correct units via parseUnits)
      amountIn = requestAmountIn;
    } else if (strategy) {
      if (strategy.notionalUsd) {
        // Convert USD to token units using viem parseUnits
        const usdAmountStr = Math.max(1, Math.round(strategy.notionalUsd)).toString();
        amountIn = parseUnits(usdAmountStr, decimalsIn);
      } else if (strategy.depositUsd) {
        const usdAmountStr = Math.max(1, Math.round(strategy.depositUsd)).toString();
        amountIn = parseUnits(usdAmountStr, decimalsIn);
      } else {
        // Default fallback
        amountIn = executionIntent === 'swap_usdc_weth' 
          ? parseUnits('100', 6) 
          : parseUnits('0.1', 18);
      }
    } else {
      // Default fallback
      amountIn = executionIntent === 'swap_usdc_weth' 
        ? parseUnits('100', 6) 
        : parseUnits('0.1', 18);
    }

    // Get routing decision for metadata (hybrid: 1inch intelligence + demo execution)
    if (useDemoTokens) {
      try {
        // Determine token symbols and decimals
        const tokenInSymbol = executionIntent === 'swap_usdc_weth' ? 'REDACTED' : 'WETH';
        const tokenOutSymbol = executionIntent === 'swap_usdc_weth' ? 'WETH' : 'REDACTED';
        const tokenInDecimals = executionIntent === 'swap_usdc_weth' ? 6 : 18;
        const tokenOutDecimals = executionIntent === 'swap_usdc_weth' ? 18 : 6;

        const routingDecision = await getSwapRoutingDecision({
          tokenIn,
          tokenOut,
          tokenInSymbol,
          tokenOutSymbol,
          tokenInDecimals,
          tokenOutDecimals,
          amountIn: amountIn.toString(),
        });

        routingMetadata = {
          venue: routingDecision.routeSummary || routingDecision.executionVenue || 'Uniswap V3',
          chain: 'Sepolia', // Task 4: Always use Sepolia for eth_testnet (not Base/Hyperliquid)
          expectedOut: routingDecision.expectedOut,
          expectedOutRaw: routingDecision.expectedOutRaw,
          minOut: routingDecision.minOut,
          minOutRaw: routingDecision.minOutRaw,
          slippageBps: routingDecision.slippageBps,
          settlementEstimate: routingDecision.settlementEstimate,
          // Hybrid routing fields
          routingSource: routingDecision.routingSource,
          routeSummary: routingDecision.routeSummary,
          protocols: routingDecision.protocols,
          estimatedGas: routingDecision.estimatedGas,
          executionVenue: routingDecision.executionVenue || 'Uniswap V3',
          executionNote: routingDecision.executionNote,
          warnings: routingDecision.warnings,
          // Sprint 3: Truthful routing metadata
          routing: routingDecision.routing,
        };
      } catch (error: any) {
        console.warn('[ethTestnetExecutor] Failed to get routing decision:', error);
        // Fall back to basic quote for minOut calculation
        try {
          const quote = await getSwapQuote({
            tokenIn,
            tokenOut,
            amountIn: amountIn.toString(),
            fee: 3000,
          });
          if (quote) {
            routingMetadata = {
              venue: quote.venueLabel || 'Blossom Demo Router',
              chain: 'Sepolia', // Task 4: Always use Sepolia for eth_testnet (not Base/Hyperliquid)
              feeTier: quote.feeTier,
              expectedOut: quote.expectedOut,
              minOut: quote.minOut,
              slippageBps: quote.estSlippageBps,
              settlementEstimate: quote.settlementEstimate,
              routingSource: 'deterministic',
              executionVenue: 'Blossom Demo Router',
              executionNote: 'Deterministic routing fallback.',
            };
          }
        } catch (quoteError: any) {
          console.warn('[ethTestnetExecutor] Quote fallback also failed:', quoteError);
        }
      }
    }

    // Build swap parameters
    const fee = 3000; // 0.3% fee tier
    const amountOutMin = useDemoTokens && routingMetadata?.minOutRaw
      ? BigInt(routingMetadata.minOutRaw)
      : 0n; // Use quote minOut for demo, 0 for real swaps (no slippage protection for MVP)
    const recipient = userAddress.toLowerCase();
    const swapDeadline = deadlineSeconds;

    const { encodeAbiParameters } = await import('viem');

    // For demo swaps: build PULL + SWAP actions
    if (useDemoTokens && pullAdapter) {
      // Action 0: PULL - transfer tokenIn from user to router
      const pullInnerData = encodeAbiParameters(
        [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }],
        [
          tokenIn as `0x${string}`,
          userAddress.toLowerCase() as `0x${string}`,
          amountIn,
        ]
      );

      // Action 1: SWAP - swap tokenIn to tokenOut
      const swapInnerData = encodeAbiParameters(
        [
          { type: 'address' },
          { type: 'address' },
          { type: 'uint24' },
          { type: 'uint256' },
          { type: 'uint256' },
          { type: 'address' },
          { type: 'uint256' },
        ],
        [
          tokenIn as `0x${string}`,
          tokenOut as `0x${string}`,
          fee,
          amountIn,
          amountOutMin,
          recipient as `0x${string}`,
          BigInt(swapDeadline)
        ]
      );

      // Wrap actions for session mode if needed
      let pullActionData: string;
      let swapActionData: string;

      if (authMode === 'session') {
        // Spend cap should apply to the SWAP action only (avoid double-counting PULL)
        pullActionData = encodeAbiParameters(
          [{ type: 'uint256' }, { type: 'bytes' }],
          [0n, pullInnerData]
        );
        swapActionData = encodeAbiParameters(
          [{ type: 'uint256' }, { type: 'bytes' }],
          [amountIn, swapInnerData]
        );
      } else {
        // Direct mode: use raw innerData
        pullActionData = pullInnerData;
        swapActionData = swapInnerData;
      }

      actions = [
        {
          actionType: 2, // PULL (from PlanTypes.ActionType enum)
          adapter: pullAdapter,
          data: pullActionData,
        },
        {
          actionType: 0, // SWAP
          adapter: swapAdapter,
          data: swapActionData,
        },
      ];
    } else if (useRealExecution) {
      // Real swaps: PULL + SWAP actions (router pulls tokens, then swaps via Uniswap V3)
      if (!ERC20_PULL_ADAPTER_ADDRESS) {
        throw new Error('ERC20_PULL_ADAPTER_ADDRESS not configured for real swap execution');
      }

      // Action 0: PULL - transfer tokenIn from user to router
      const pullInnerData = encodeAbiParameters(
        [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }],
        [
          tokenIn as `0x${string}`,
          userAddress.toLowerCase() as `0x${string}`,
          amountIn,
        ]
      );

      // Action 1: SWAP - swap tokenIn to tokenOut via Uniswap V3
      const swapInnerData = encodeAbiParameters(
        [
          { type: 'address' },
          { type: 'address' },
          { type: 'uint24' },
          { type: 'uint256' },
          { type: 'uint256' },
          { type: 'address' },
          { type: 'uint256' },
        ],
        [
          tokenIn as `0x${string}`,
          tokenOut as `0x${string}`,
          fee,
          amountIn,
          routingMetadata?.minOutRaw ? BigInt(routingMetadata.minOutRaw) : 0n,
          recipient as `0x${string}`,
          BigInt(swapDeadline)
        ]
      );

      // Wrap actions for session mode if needed
      let pullActionData: string;
      let swapActionData: string;

      if (authMode === 'session') {
        // Spend cap should apply to the SWAP action only (avoid double-counting PULL)
        pullActionData = encodeAbiParameters(
          [{ type: 'uint256' }, { type: 'bytes' }],
          [0n, pullInnerData]
        );
        swapActionData = encodeAbiParameters(
          [{ type: 'uint256' }, { type: 'bytes' }],
          [amountIn, swapInnerData]
        );
      } else {
        pullActionData = pullInnerData;
        swapActionData = swapInnerData;
      }

      actions = [
        {
          actionType: 2, // PULL
          adapter: ERC20_PULL_ADAPTER_ADDRESS.toLowerCase(),
          data: pullActionData,
        },
        {
          actionType: 0, // SWAP
          adapter: swapAdapter,
          data: swapActionData,
        },
      ];
    } else {
      // Fallback: single SWAP action (legacy behavior, should not be reached)
      const innerData = encodeAbiParameters(
        [
          { type: 'address' },
          { type: 'address' },
          { type: 'uint24' },
          { type: 'uint256' },
          { type: 'uint256' },
          { type: 'address' },
          { type: 'uint256' },
        ],
        [
          tokenIn as `0x${string}`,
          tokenOut as `0x${string}`,
          fee,
          amountIn,
          amountOutMin,
          recipient as `0x${string}`,
          BigInt(swapDeadline)
        ]
      );

      // For session mode, wrap with maxSpendUnits
      let actionData: string;

      if (authMode === 'session') {
        actionData = encodeAbiParameters(
          [{ type: 'uint256' }, { type: 'bytes' }],
          [amountIn, innerData]
        );
      } else {
        actionData = innerData;
      }

      actions = [
        {
          actionType: 0, // SWAP
          adapter: swapAdapter,
          data: actionData,
        },
      ];
    }

    // Check balance and allowance for swap intents
    if (ETH_TESTNET_RPC_URL && EXECUTION_ROUTER_ADDRESS) {
      try {
        const balance = await erc20_balanceOf(tokenIn, userAddress);
        const allowance = await erc20_allowance(
          tokenIn,
          userAddress,
          EXECUTION_ROUTER_ADDRESS
        );

        // Check balance
        if (balance < amountIn) {
          const tokenName = executionIntent === 'swap_usdc_weth' ? 'REDACTED' : 'WETH';
          warnings.push(
            `INSUFFICIENT_BALANCE: You need at least ${amountIn.toString()} ${tokenName} to execute this swap. Current balance: ${balance.toString()}`
          );
        }

        // Check allowance
        if (allowance < amountIn) {
          // Prepare requirement for approval
          if (!approvalRequirements) {
            approvalRequirements = [];
          }
          approvalRequirements.push({
            token: tokenIn,
            spender: EXECUTION_ROUTER_ADDRESS.toLowerCase(),
            amount: '0x' + amountIn.toString(16), // Convert to hex string
          });
        }
      } catch (error: any) {
        // If RPC fails, log warning but don't block execution
        warnings.push(
          `Could not verify token balance/allowance: ${error.message}. Proceeding anyway.`
        );
      }
    }
  } else if (isLendSupply || (executionRequest && (executionRequest.kind === 'lend' || executionRequest.kind === 'lend_supply'))) {
    // Lending supply action: PULL + LEND_SUPPLY
    // Determine asset to lend (REDACTED or WETH)
    const requestedAsset = lendAsset || (executionRequest as any)?.asset?.toUpperCase() || 'REDACTED';
    const isWethLend = requestedAsset === 'WETH';
    const lendDecimals = isWethLend ? 18 : 6;
    const amount = lendAmount || parseUnits(isWethLend ? '0.01' : '100', lendDecimals);

    const {
      AAVE_SEPOLIA_POOL_ADDRESS,
      AAVE_ADAPTER_ADDRESS,
      AAVE_REDACTED_ADDRESS,
      AAVE_WETH_ADDRESS,
      LENDING_EXECUTION_MODE,
    } = await import('../config');
    const { getAaveMarketConfig, getSupportedAsset } = await import('../defi/aave/market');

    // Determine if we should try Aave Sepolia (requires all Aave config variables)
    const hasAaveConfig = AAVE_SEPOLIA_POOL_ADDRESS && AAVE_ADAPTER_ADDRESS;
    const useRealAave = LENDING_EXECUTION_MODE === 'real' && hasAaveConfig;
    let useAaveSepolia = false;
    let lendingProtocol = 'VaultSim';

    // Start with Aave Sepolia if configured, will fallback to VaultSim on error
    let asset: string;
    let vault: string;
    let lendAdapter: string;

    if (useRealAave) {
      // Try Aave Sepolia first
      try {
        console.log('[ethTestnetExecutor] Attempting Aave Sepolia integration for', requestedAsset);
        const marketConfig = await getAaveMarketConfig();

        // Select asset based on request
        if (isWethLend && AAVE_WETH_ADDRESS) {
          // Use WETH for lending
          asset = AAVE_WETH_ADDRESS.toLowerCase();
          vault = marketConfig.poolAddress.toLowerCase();
          lendAdapter = AAVE_ADAPTER_ADDRESS!.toLowerCase();
          useAaveSepolia = true;
          lendingProtocol = 'Aave V3';
          console.log('[ethTestnetExecutor] Using Aave Sepolia WETH:', { vault, lendAdapter, asset });
        } else {
          // Use REDACTED for lending
          let usdcAsset = await getSupportedAsset('REDACTED');

          // Override with AAVE_REDACTED_ADDRESS if configured
          if (AAVE_REDACTED_ADDRESS && AAVE_REDACTED_ADDRESS !== DEMO_REDACTED_ADDRESS) {
            usdcAsset = {
              symbol: 'REDACTED',
              address: AAVE_REDACTED_ADDRESS.toLowerCase() as Address,
              aTokenAddress: '0x0000000000000000000000000000000000000000' as Address,
              decimals: 6,
            };
          }

          if (usdcAsset) {
            asset = usdcAsset.address.toLowerCase();
            vault = marketConfig.poolAddress.toLowerCase();
            lendAdapter = AAVE_ADAPTER_ADDRESS!.toLowerCase();
            useAaveSepolia = true;
            lendingProtocol = 'Aave V3';
            console.log('[ethTestnetExecutor] Using Aave Sepolia REDACTED:', { vault, lendAdapter, asset });
          } else {
            throw new Error('REDACTED not found in Aave market config');
          }
        }
      } catch (error: any) {
        console.warn('[ethTestnetExecutor] Aave Sepolia config invalid, falling back to VaultSim:', error.message);
        warnings.push('Aave Sepolia unavailable, using VaultSim fallback');
      }
    }

    // Fallback to VaultSim if Aave not configured or failed
    if (!useAaveSepolia) {
      console.log('[ethTestnetExecutor] Using VaultSim fallback for lending');
      asset = DEMO_REDACTED_ADDRESS!.toLowerCase();
      vault = DEMO_LEND_VAULT_ADDRESS!.toLowerCase();
      lendAdapter = DEMO_LEND_ADAPTER_ADDRESS!.toLowerCase();
      lendingProtocol = 'VaultSim';
    }

    const pullAdapter = ERC20_PULL_ADAPTER_ADDRESS!.toLowerCase();

    // Get lending routing decision
    let lendingRouting: LendingRoutingDecision | undefined;
    try {
      lendingRouting = await getLendingRoutingDecision({
        asset,
        amount: amount.toString(),
        vaultAddress: vault,
      });
      routingMetadata = {
        venue: `Supply ${requestedAsset} to ${lendingRouting.protocol}`,
        chain: lendingRouting.chain,
        settlementEstimate: lendingRouting.settlementEstimate,
        routingSource: lendingRouting.routingSource,
        executionVenue: lendingRouting.executionVenue,
        executionNote: lendingRouting.executionNote,
        warnings: lendingRouting.warnings,
        apr: lendingRouting.apr,
        aprBps: lendingRouting.aprBps,
        vault: lendingRouting.vault,
        actionType: 'lend_supply',
      };
    } catch (error: any) {
      console.warn('[ethTestnetExecutor] Failed to get lending routing:', error);
      warnings.push(`Lending routing failed: ${error.message}`);
    }

    const { encodeAbiParameters } = await import('viem');

    if (authMode === 'session') {
      // Session mode: wrap data with maxSpendUnits
      const pullInnerData = encodeAbiParameters(
        [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }],
        [asset as `0x${string}`, userAddress.toLowerCase() as `0x${string}`, amount]
      );
      const pullData = encodeAbiParameters(
        [{ type: 'uint256' }, { type: 'bytes' }],
        [0n, pullInnerData]
      );

      const lendInnerData = encodeAbiParameters(
        [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'address' }],
        [asset as `0x${string}`, vault as `0x${string}`, amount, userAddress.toLowerCase() as `0x${string}`]
      );
      const lendData = encodeAbiParameters(
        [{ type: 'uint256' }, { type: 'bytes' }],
        [amount, lendInnerData]
      );

      actions = [
        {
          actionType: 2, // PULL
          adapter: pullAdapter,
          data: pullData,
        },
        {
          actionType: 3, // LEND_SUPPLY
          adapter: lendAdapter,
          data: lendData,
        },
      ];
    } else {
      // Direct mode: use raw data
      const pullData = encodeAbiParameters(
        [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }],
        [asset as `0x${string}`, userAddress.toLowerCase() as `0x${string}`, amount]
      );

      const lendData = encodeAbiParameters(
        [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'address' }],
        [asset as `0x${string}`, vault as `0x${string}`, amount, userAddress.toLowerCase() as `0x${string}`]
      );

      actions = [
        {
          actionType: 2, // PULL
          adapter: pullAdapter,
          data: pullData,
        },
        {
          actionType: 3, // LEND_SUPPLY
          adapter: lendAdapter,
          data: lendData,
        },
      ];
    }

    const amountDisplay = (Number(amount) / 1e6).toFixed(2);
    summary = `Supply ${amountDisplay} REDACTED to ${lendingRouting?.protocol || lendingProtocol} (Est APR: ${lendingRouting?.apr || '5.00'}%)`;

    // Check approval requirements
    if (ETH_TESTNET_RPC_URL) {
      try {
        const allowance = await erc20_allowance(asset, userAddress, EXECUTION_ROUTER_ADDRESS);
        if (allowance < amount) {
          if (!approvalRequirements) {
            approvalRequirements = [];
          }
          approvalRequirements.push({
            token: asset,
            spender: EXECUTION_ROUTER_ADDRESS.toLowerCase(),
            amount: '0x' + amount.toString(16),
          });
        }
      } catch (error: any) {
        warnings.push(`Could not verify lending approval: ${error.message}. Proceeding anyway.`);
      }
    }
  } else {
    // Check if strategy is perp or event
    const isPerpStrategy = strategy?.instrumentType === 'perp' || executionKind === 'perp' ||
                          (executionRequest && executionRequest.kind === 'perp');
    const isEventStrategy = strategy?.instrumentType === 'event' || executionKind === 'event' ||
                          (executionRequest && executionRequest.kind === 'event');

    // Use demo adapters for real on-chain execution if configured
    const useDemoPerpAdapter = isPerpStrategy && DEMO_PERP_ADAPTER_ADDRESS && DEMO_REDACTED_ADDRESS;
    const useDemoEventAdapter = isEventStrategy && DEMO_EVENT_ADAPTER_ADDRESS && DEMO_REDACTED_ADDRESS;

    if (useDemoPerpAdapter) {
      // Build PULL + PERP actions using DemoPerpAdapter (real on-chain execution)
      const { encodeAbiParameters } = await import('viem');

      // Verify PULL adapter is available
      if (!ERC20_PULL_ADAPTER_ADDRESS) {
        throw new Error('ERC20_PULL_ADAPTER_ADDRESS not configured for perp execution');
      }

      // Parse perp parameters
      const market = strategy?.market || (executionRequest as any)?.market || 'ETH-USD';
      const side = strategy?.direction || (executionRequest as any)?.direction || 'long';
      const leverage = strategy?.leverage || (executionRequest as any)?.leverage || 5;
      const marginUsd = strategy?.marginUsd || strategy?.notionalUsd || (executionRequest as any)?.marginUsd || 100;

      // Convert market to enum: BTC=0, ETH=1, SOL=2
      const marketMap: Record<string, number> = { 'BTC-USD': 0, 'ETH-USD': 1, 'SOL-USD': 2, 'BTC': 0, 'ETH': 1, 'SOL': 2 };
      const marketEnum = marketMap[market.toUpperCase()] ?? 1; // Default to ETH

      // Convert side to enum: Long=0, Short=1
      const sideEnum = side.toLowerCase() === 'short' ? 1 : 0;

      // Convert margin to REDACTED units (6 decimals)
      const marginAmount = parseUnits(marginUsd.toString(), 6);

      // ============ ACTION 1: PULL - transfer margin from user to router ============
      const pullInnerData = encodeAbiParameters(
        [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }],
        [
          DEMO_REDACTED_ADDRESS!.toLowerCase() as `0x${string}`,
          userAddress.toLowerCase() as `0x${string}`,
          marginAmount,
        ]
      );

      // Wrap PULL for session mode if needed
      let pullActionData: string;
      if (authMode === 'session') {
        pullActionData = encodeAbiParameters(
          [{ type: 'uint256' }, { type: 'bytes' }],
          [marginAmount, pullInnerData]
        );
      } else {
        pullActionData = pullInnerData;
      }

      // ============ ACTION 2: PERP - open position via adapter ============
      // Build adapter data: (uint8 action, address user, uint8 market, uint8 side, uint256 margin, uint256 leverage)
      const adapterData = encodeAbiParameters(
        [{ type: 'uint8' }, { type: 'address' }, { type: 'uint8' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'uint256' }],
        [1, userAddress.toLowerCase() as `0x${string}`, marketEnum, sideEnum, marginAmount, BigInt(leverage)]
      );

      // Build router data: (address margin, uint256 amount, bytes adapterData)
      const routerData = encodeAbiParameters(
        [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes' }],
        [DEMO_REDACTED_ADDRESS!.toLowerCase() as `0x${string}`, marginAmount, adapterData]
      );

      // Wrap PERP for session mode if needed
      let perpActionData: string;
      if (authMode === 'session') {
        perpActionData = encodeAbiParameters(
          [{ type: 'uint256' }, { type: 'bytes' }],
          [marginAmount, routerData]
        );
      } else {
        perpActionData = routerData;
      }

      // Build actions array: PULL first, then PERP
      actions = [
        {
          actionType: 2, // PULL (from PlanTypes.ActionType enum)
          adapter: ERC20_PULL_ADAPTER_ADDRESS.toLowerCase(),
          data: pullActionData,
        },
        {
          actionType: 7, // PERP (from PlanTypes.ActionType enum)
          adapter: DEMO_PERP_ADAPTER_ADDRESS!.toLowerCase(),
          data: perpActionData,
        },
      ];

      summary = `${side.toUpperCase()} ${market} @ ${leverage}x leverage ($${marginUsd} margin)`;
      routingMetadata = {
        venue: `DemoPerps: ${market}`,
        chain: 'Sepolia',
        settlementEstimate: '~1 block',
        routingSource: 'demo',
        executionVenue: 'DemoPerpEngine (on-chain)',
        executionNote: 'Real on-chain perp execution via DemoPerpEngine.',
        actionType: 'perp',
      } as any;

      // Check approval requirements
      if (ETH_TESTNET_RPC_URL && EXECUTION_ROUTER_ADDRESS) {
        try {
          const allowance = await erc20_allowance(DEMO_REDACTED_ADDRESS!, userAddress, EXECUTION_ROUTER_ADDRESS);
          if (allowance < marginAmount) {
            if (!approvalRequirements) approvalRequirements = [];
            approvalRequirements.push({
              token: DEMO_REDACTED_ADDRESS!,
              spender: EXECUTION_ROUTER_ADDRESS.toLowerCase(),
              amount: '0x' + marginAmount.toString(16),
            });
          }
        } catch (error: any) {
          warnings.push(`Could not verify perp approval: ${error.message}. Proceeding anyway.`);
        }
      }
    } else if (useDemoEventAdapter) {
      // Build PULL + EVENT actions using DemoEventAdapter (real on-chain execution)
      const { encodeAbiParameters, keccak256, stringToBytes } = await import('viem');

      // Verify PULL adapter is available
      if (!ERC20_PULL_ADAPTER_ADDRESS) {
        throw new Error('ERC20_PULL_ADAPTER_ADDRESS not configured for event execution');
      }

      // Parse event parameters
      const marketId = (executionRequest && executionRequest.kind === 'event')
        ? executionRequest.marketId
        : (strategy?.market || 'demo-market');
      const outcome = (executionRequest && executionRequest.kind === 'event')
        ? executionRequest.outcome
        : (strategy?.outcome || strategy?.direction || 'YES');
      const stakeUsd = (executionRequest && executionRequest.kind === 'event')
        ? executionRequest.stakeUsd
        : (strategy?.stakeUsd || 5);

      // Convert marketId to bytes32 (hash if string)
      const marketIdBytes32 = marketId.startsWith('0x') && marketId.length === 66
        ? marketId as `0x${string}`
        : keccak256(stringToBytes(marketId));

      // Convert stake to REDACTED units (6 decimals)
      const stakeAmount = parseUnits(stakeUsd.toString(), 6);

      // Determine action: 1=BUY_YES, 2=BUY_NO
      const eventActionType = outcome.toUpperCase() === 'NO' ? 2 : 1;

      // ============ ACTION 1: PULL - transfer stake from user to router ============
      const pullInnerData = encodeAbiParameters(
        [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }],
        [
          DEMO_REDACTED_ADDRESS!.toLowerCase() as `0x${string}`,
          userAddress.toLowerCase() as `0x${string}`,
          stakeAmount,
        ]
      );

      // Wrap PULL for session mode if needed
      let pullActionData: string;
      if (authMode === 'session') {
        pullActionData = encodeAbiParameters(
          [{ type: 'uint256' }, { type: 'bytes' }],
          [stakeAmount, pullInnerData]
        );
      } else {
        pullActionData = pullInnerData;
      }

      // ============ ACTION 2: EVENT - buy shares via adapter ============
      // Build adapter data: (uint8 action, address user, bytes32 marketId, uint256 amount)
      const adapterData = encodeAbiParameters(
        [{ type: 'uint8' }, { type: 'address' }, { type: 'bytes32' }, { type: 'uint256' }],
        [eventActionType, userAddress.toLowerCase() as `0x${string}`, marketIdBytes32, stakeAmount]
      );

      // Build router data: (address stake, uint256 amount, bytes adapterData)
      const routerData = encodeAbiParameters(
        [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes' }],
        [DEMO_REDACTED_ADDRESS!.toLowerCase() as `0x${string}`, stakeAmount, adapterData]
      );

      // Wrap EVENT for session mode if needed
      let eventActionData: string;
      if (authMode === 'session') {
        eventActionData = encodeAbiParameters(
          [{ type: 'uint256' }, { type: 'bytes' }],
          [stakeAmount, routerData]
        );
      } else {
        eventActionData = routerData;
      }

      // Build actions array: PULL first, then EVENT
      actions = [
        {
          actionType: 2, // PULL (from PlanTypes.ActionType enum)
          adapter: ERC20_PULL_ADAPTER_ADDRESS.toLowerCase(),
          data: pullActionData,
        },
        {
          actionType: 8, // EVENT (from PlanTypes.ActionType enum)
          adapter: DEMO_EVENT_ADAPTER_ADDRESS!.toLowerCase(),
          data: eventActionData,
        },
      ];

      summary = `${outcome.toUpperCase()} on ${marketId} ($${stakeUsd} stake)`;
      routingMetadata = {
        venue: `DemoEvents: ${marketId}`,
        chain: 'Sepolia',
        settlementEstimate: '~1 block',
        routingSource: 'demo',
        executionVenue: 'DemoEventMarket (on-chain)',
        executionNote: 'Real on-chain event market execution via DemoEventMarket.',
        actionType: 'event',
      } as any;

      // Check approval requirements
      if (ETH_TESTNET_RPC_URL && EXECUTION_ROUTER_ADDRESS) {
        try {
          const allowance = await erc20_allowance(DEMO_REDACTED_ADDRESS!, userAddress, EXECUTION_ROUTER_ADDRESS);
          if (allowance < stakeAmount) {
            if (!approvalRequirements) approvalRequirements = [];
            approvalRequirements.push({
              token: DEMO_REDACTED_ADDRESS!,
              spender: EXECUTION_ROUTER_ADDRESS.toLowerCase(),
              amount: '0x' + stakeAmount.toString(16),
            });
          }
        } catch (error: any) {
          warnings.push(`Could not verify event approval: ${error.message}. Proceeding anyway.`);
        }
      }
    } else if ((isPerpStrategy || isEventStrategy) && PROOF_ADAPTER_ADDRESS) {
      // Fallback: Build proof-of-execution action when demo adapters not configured
      const { encodeAbiParameters, keccak256, stringToBytes } = await import('viem');

      // Determine venue type: 1 = perps, 2 = event
      const venueType = isPerpStrategy ? 1 : 2;

      // Build canonical intent payload for hashing
      let intentPayload: string;
      let summaryText: string;

      if (isPerpStrategy) {
        const market = strategy?.market || 'ETH-USD';
        const side = strategy?.direction || 'long';
        const leverage = strategy?.leverage || 1;
        const riskPct = strategy?.riskPercent || 3;
        const marginUsd = strategy?.marginUsd || strategy?.notionalUsd || 100;

        intentPayload = JSON.stringify({
          type: 'perp',
          market,
          side,
          leverage,
          riskPct,
          marginUsd,
          timestamp: Math.floor(Date.now() / 1000),
        });
        summaryText = `PERP:${market}-${side.toUpperCase()}-${leverage}x-${riskPct}%`;
        summary = `${side.toUpperCase()} ${market} @ ${leverage}x leverage (${riskPct}% risk) [PROOF]`;

        routingMetadata = {
          venue: `Perps: ${market}`,
          chain: 'Sepolia',
          settlementEstimate: '~1 block',
          routingSource: 'proof',
          executionVenue: 'On-chain proof (demo adapters not configured)',
          executionNote: 'Proof-of-execution recorded. Configure DEMO_PERP_ADAPTER_ADDRESS for real execution.',
          actionType: 'perp',
          venueType,
        } as any;
      } else {
        const marketId = (executionRequest && executionRequest.kind === 'event')
          ? executionRequest.marketId
          : (strategy?.market || 'fed-rate-cut');
        const outcome = (executionRequest && executionRequest.kind === 'event')
          ? executionRequest.outcome
          : (strategy?.outcome || strategy?.direction || 'YES');
        const stakeUsd = (executionRequest && executionRequest.kind === 'event')
          ? executionRequest.stakeUsd
          : (strategy?.stakeUsd || 5);

        intentPayload = JSON.stringify({
          type: 'event',
          marketId,
          outcome,
          stakeUsd,
          timestamp: Math.floor(Date.now() / 1000),
        });
        summaryText = `EVENT:${marketId}-${outcome}-${stakeUsd}USD`;
        summary = `${outcome} on ${marketId} ($${stakeUsd} stake) [PROOF]`;

        routingMetadata = {
          venue: `Event: ${marketId}`,
          chain: 'Sepolia',
          settlementEstimate: '~1 block',
          routingSource: 'proof',
          executionVenue: 'On-chain proof (demo adapters not configured)',
          executionNote: 'Proof-of-execution recorded. Configure DEMO_EVENT_ADAPTER_ADDRESS for real execution.',
          actionType: 'event',
          venueType,
        } as any;
      }

      const intentHash = keccak256(stringToBytes(intentPayload));
      const finalSummary = summaryText.slice(0, 160);

      const proofInnerData = encodeAbiParameters(
        [{ type: 'address' }, { type: 'uint8' }, { type: 'bytes32' }, { type: 'string' }],
        [userAddress.toLowerCase() as `0x${string}`, venueType, intentHash, finalSummary]
      );

      let proofData: string;
      if (authMode === 'session') {
        proofData = encodeAbiParameters(
          [{ type: 'uint256' }, { type: 'bytes' }],
          [0n, proofInnerData]
        );
      } else {
        proofData = proofInnerData;
      }

      actions = [
        {
          actionType: 6, // PROOF (from PlanTypes.ActionType enum)
          adapter: PROOF_ADAPTER_ADDRESS.toLowerCase(),
          data: proofData,
        },
      ];
    } else {
      // Mock action (existing behavior - fallback)
      let actionData: string;
      let maxSpendUnits: bigint = 1n; // Default

      if (strategy) {
        // Derive maxSpendUnits from strategy if available
        if (strategy.notionalUsd) {
          maxSpendUnits = BigInt(Math.max(1, Math.round(strategy.notionalUsd)));
        } else if (strategy.depositUsd) {
          maxSpendUnits = BigInt(Math.max(1, Math.round(strategy.depositUsd)));
        } else if (strategy.stakeUsd) {
          maxSpendUnits = BigInt(Math.max(1, Math.round(strategy.stakeUsd)));
        }
      }

      if (authMode === 'session') {
        // Wrap as (maxSpendUnits, innerData) for session mode
        const { encodeAbiParameters } = await import('viem');
        const innerData = '0x'; // Empty for mock adapter
        actionData = encodeAbiParameters(
          [{ type: 'uint256' }, { type: 'bytes' }],
          [maxSpendUnits, innerData]
        );
      } else {
        // Direct mode: use raw data
        actionData = '0x';
      }

      actions = [
        {
          actionType: 0, // SWAP (from PlanTypes.ActionType enum)
          adapter: MOCK_SWAP_ADAPTER_ADDRESS!.toLowerCase(),
          data: actionData,
        },
      ];
    }
  }

  // Build plan
  // Debug: log actions before building plan
  console.log('[ethTestnetExecutor] Actions built:', JSON.stringify(actions.map(a => ({
    actionType: a.actionType,
    adapter: a.adapter?.substring(0, 10) + '...',
    dataLength: a.data?.length || 0
  })), null, 2));

  const plan = {
    user: userAddress.toLowerCase(),
    nonce,
    deadline,
    actions,
  };

  // Build EIP-712 typed data (optional/informational for future use)
  const typedData = {
    domain: {
      name: 'BlossomExecutionRouter',
      version: '1',
      chainId: ETH_TESTNET_CHAIN_ID,
      verifyingContract: EXECUTION_ROUTER_ADDRESS.toLowerCase(),
    },
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      Action: [
        { name: 'actionType', type: 'uint8' },
        { name: 'adapter', type: 'address' },
        { name: 'data', type: 'bytes' },
      ],
      Plan: [
        { name: 'user', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'actions', type: 'Action[]' },
      ],
    },
    primaryType: 'Plan',
    message: plan,
  };

  // Build summary (only if not already set by a specific action handler)
  if (!summary) {
    if (needsFundingRoute && actions.length > 1) {
      summary = `Execute atomic funding route on Sepolia: ${actions.length} actions (WRAP + SWAP). Nonce: ${nonce}, Deadline: ${new Date(deadlineSeconds * 1000).toISOString()}`;
    } else {
      const adapterName = executionIntent === 'swap_usdc_weth' || executionIntent === 'swap_weth_usdc'
        ? 'UniswapV3SwapAdapter'
        : 'MockSwapAdapter';
      summary = `Execute plan on Sepolia: ${actions.length} action(s) via ${adapterName} (${executionIntent}). Nonce: ${nonce}, Deadline: ${new Date(deadlineSeconds * 1000).toISOString()}`;
    }
  }

  // Generate static net exposure string (no math, no refactors)
  // This is a placeholder - actual portfolio state would come from execution result
  // For now, generate a simple string based on action types
  const netExposureParts: string[] = [];
  if (actions.some(a => a.actionType === 0)) { // SWAP
    netExposureParts.push('Swap executed');
  }
  if (actions.some(a => a.actionType === 3)) { // LEND_SUPPLY
    netExposureParts.push('Yield position added');
  }
  if (executionKind === 'perp' || executionRequest?.kind === 'perp') {
    netExposureParts.push('Perp delta +2%');
  }
  if (executionKind === 'event' || executionRequest?.kind === 'event') {
    netExposureParts.push('Event position added');
  }
  const netExposure = netExposureParts.length > 0 ? `Net: ${netExposureParts.join(', ')}` : 'Net: Neutral';

  // V1: Compute planHash server-side (keccak256(abi.encode(plan)))
  const { keccak256, encodeAbiParameters } = await import('viem');
  const planHash = keccak256(
    encodeAbiParameters(
      [
        { type: 'address' }, // user
        { type: 'uint256' }, // nonce
        { type: 'uint256' }, // deadline
        {
          type: 'tuple[]', // actions
          components: [
            { type: 'uint8' }, // actionType
            { type: 'address' }, // adapter
            { type: 'bytes' }, // data
          ],
        },
      ],
      [
        plan.user as `0x${string}`,
        BigInt(plan.nonce),
        BigInt(plan.deadline),
        plan.actions.map((a: any) => [
          a.actionType,
          a.adapter as `0x${string}`,
          a.data as `0x${string}`,
        ]),
      ]
    )
  );

  // Initialize result object
  const result: PrepareEthTestnetExecutionResult & { planHash?: string } = {
    chainId: ETH_TESTNET_CHAIN_ID,
    to: EXECUTION_ROUTER_ADDRESS.toLowerCase(),
    value: planValue, // May be > 0 if WRAP action included
    plan,
    planHash, // V1: Include server-computed planHash
    typedData, // Optional/informational for future use
    call: {
      method: 'executeBySender' as const,
      args: {
        plan,
      },
    },
    // Add requirements if approval is needed
    ...(approvalRequirements && approvalRequirements.length > 0
      ? { requirements: { approvals: approvalRequirements } }
      : {}
    ),
    summary,
    warnings: warnings.length > 0 ? warnings : undefined,
    // Add routing metadata if available (for demo swaps)
    // Sprint 3.1: Normalized routing metadata at top level
    ...(routingMetadata ? { 
      routing: {
        ...routingMetadata,
        // Ensure normalized routing metadata is accessible at top level
        routing: routingMetadata.routing || {
          source: 'fallback',
          kind: 'swap_quote',
          ok: false,
          reason: 'Routing metadata missing from routingDecision',
          latencyMs: 0,
          mode: process.env.ROUTING_MODE || 'hybrid',
          correlationId: makeCorrelationId('executor'),
        },
      }
    } : {
      // Always include routing metadata, even if routingMetadata is undefined
        routing: {
          venue: 'Unknown',
          chain: 'Sepolia',
          routingSource: 'fallback',
          routing: {
            source: 'fallback',
            kind: 'swap_quote',
            ok: false,
            reason: 'No routing metadata available',
            latencyMs: 0,
            mode: process.env.ROUTING_MODE || 'hybrid',
            correlationId: makeCorrelationId('executor'),
          },
        },
    }),
    netExposure, // Static string, no new state
  };

  // Log preparation
  console.log('[ethTestnetExecutor] Prepared execution plan:', {
    draftId,
    userAddress,
    nonce,
    deadline: new Date(deadlineSeconds * 1000).toISOString(),
    routerAddress: EXECUTION_ROUTER_ADDRESS,
    actionCount: actions.length,
    method: 'executeBySender',
    requirements: result.requirements,
  });

  // Task 1: DEBUG_EXECUTION logging
  if (process.env.DEBUG_EXECUTION === 'true' || process.env.DEBUG_DEMO === 'true') {
    const { encodeFunctionData } = await import('viem');
    const executeBySenderAbi = [
      {
        name: 'executeBySender',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
          {
            name: 'plan',
            type: 'tuple',
            components: [
              { name: 'user', type: 'address' },
              { name: 'nonce', type: 'uint256' },
              { name: 'deadline', type: 'uint256' },
              {
                name: 'actions',
                type: 'tuple[]',
                components: [
                  { name: 'actionType', type: 'uint8' },
                  { name: 'adapter', type: 'address' },
                  { name: 'data', type: 'bytes' },
                ],
              },
            ],
          },
        ],
        outputs: [],
      },
    ] as const;
    
    const encodedData = encodeFunctionData({
      abi: executeBySenderAbi,
      functionName: 'executeBySender',
      args: [plan],
    });
    
    console.log('[ethTestnetExecutor] DEBUG_EXECUTION:', {
      chainId: ETH_TESTNET_CHAIN_ID,
      to: EXECUTION_ROUTER_ADDRESS,
      value: planValue,
      dataLength: encodedData.length,
      dataBytes: encodedData.length / 2 - 1, // Subtract '0x' prefix
      routerAddress: EXECUTION_ROUTER_ADDRESS,
      adapterAddresses: actions.map(a => a.adapter),
      actionTypes: actions.map(a => a.actionType),
      routingMetadata: routingMetadata ? {
        venue: routingMetadata.venue,
        chain: routingMetadata.chain,
        executionVenue: routingMetadata.executionVenue,
      } : null,
    });
  }

  // Task 3: Static call check before returning tx (if DEBUG_EXECUTION enabled)
  if ((process.env.DEBUG_EXECUTION === 'true' || process.env.DEBUG_DEMO === 'true') && ETH_TESTNET_RPC_URL) {
    try {
      const { createPublicClient, http } = await import('viem');
      const { sepolia } = await import('viem/chains');
      const publicClient = createPublicClient({
        chain: sepolia,
        transport: http(ETH_TESTNET_RPC_URL),
      });
      
      const { encodeFunctionData } = await import('viem');
      const executeBySenderAbi = [
        {
          name: 'executeBySender',
          type: 'function',
          stateMutability: 'nonpayable',
          inputs: [
            {
              name: 'plan',
              type: 'tuple',
              components: [
                { name: 'user', type: 'address' },
                { name: 'nonce', type: 'uint256' },
                { name: 'deadline', type: 'uint256' },
                {
                  name: 'actions',
                  type: 'tuple[]',
                  components: [
                    { name: 'actionType', type: 'uint8' },
                    { name: 'adapter', type: 'address' },
                    { name: 'data', type: 'bytes' },
                  ],
                },
              ],
            },
          ],
          outputs: [],
        },
      ] as const;
      
      const encodedData = encodeFunctionData({
        abi: executeBySenderAbi,
        functionName: 'executeBySender',
        args: [plan],
      });
      
      // Try static call to check for reverts
      await publicClient.call({
        to: EXECUTION_ROUTER_ADDRESS as `0x${string}`,
        data: encodedData as `0x${string}`,
        value: BigInt(planValue),
      });
      
      console.log('[ethTestnetExecutor] Static call check: SUCCESS (tx should not revert)');
    } catch (error: any) {
      console.error('[ethTestnetExecutor] Static call check: FAILED (tx will likely revert):', error.message);
      // Don't throw - let the frontend handle it, but log the revert reason
    }
  }

  return result;
}
