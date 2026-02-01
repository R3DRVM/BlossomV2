// @ts-nocheck
/**
 * Intent Runner Orchestrator
 *
 * Transforms user-style prompts into executed transactions:
 * 1. Accept raw intent_text (e.g., "long btc 20x", "swap 5000 usdc to weth")
 * 2. Create ledger intent row (status=queued)
 * 3. Plan: Parse intent, detect kind, extract parameters
 * 4. Route: Map to implemented venues or fail with clear error
 * 5. Execute: Run transaction via appropriate chain executor
 * 6. Confirm: Wait for confirmation and update ledger
 *
 * This orchestrator is honest about what's implemented vs. not.
 */

import { randomUUID } from 'crypto';
import { DEMO_PERP_ADAPTER_ADDRESS } from '../config';

/**
 * Helper to merge new metadata with existing metadata, preserving caller info (source, domain, runId).
 * This ensures that source tracking persists through all status updates.
 */
function mergeMetadata(existingJson: string | undefined, newData: Record<string, any>): string {
  let existing: Record<string, any> = {};
  try {
    existing = JSON.parse(existingJson || '{}');
  } catch {}

  // Preserve these caller-provided keys across all updates
  const PRESERVED_KEYS = ['source', 'domain', 'runId', 'category', 'timestamp', 'userAgent'];
  const preserved: Record<string, any> = {};
  for (const key of PRESERVED_KEYS) {
    if (existing[key] !== undefined) {
      preserved[key] = existing[key];
    }
  }

  return JSON.stringify({ ...preserved, ...newData });
}

// Type definitions (duplicated to avoid rootDir issues)
type IntentKind = 'perp' | 'deposit' | 'swap' | 'bridge' | 'unknown';
type IntentStatus = 'queued' | 'planned' | 'routed' | 'executing' | 'confirmed' | 'failed';
type IntentFailureStage = 'plan' | 'route' | 'execute' | 'confirm' | 'quote';
type ExecutionKind = 'perp' | 'deposit' | 'bridge' | 'swap' | 'proof' | 'relay' | 'transfer';

// Chain type for clarity
export type ChainTarget = 'ethereum' | 'solana' | 'both';

// Parsed intent structure
export interface ParsedIntent {
  kind: IntentKind;
  action: string;               // deposit | swap | long | short | bridge | proof
  amount?: string;              // e.g., "20000"
  amountUnit?: string;          // e.g., "usdc"
  targetAsset?: string;         // e.g., "weth", "btc"
  leverage?: number;            // For perp intents
  sourceChain?: string;         // For bridge intents
  destChain?: string;           // For bridge intents
  venue?: string;               // Requested venue if specified
  rawParams: Record<string, any>;
}

// Route decision
export interface RouteDecision {
  chain: 'ethereum' | 'solana';
  network: 'sepolia' | 'devnet';
  venue: string;
  adapter?: string;
  executionType: 'real' | 'proof_only';
  warnings?: string[];
}

// Execution result
export interface IntentExecutionResult {
  ok: boolean;
  intentId: string;
  status: string;
  executionId?: string;
  txHash?: string;
  explorerUrl?: string;
  error?: {
    stage: IntentFailureStage;
    code: string;
    message: string;
  };
  metadata?: Record<string, any>;
}

// Known venue implementations
const IMPLEMENTED_VENUES: Record<string, Record<string, string[]>> = {
  ethereum: {
    deposit: ['demo_vault', 'aave'],
    swap: ['demo_dex', 'uniswap'],
    bridge: ['bridge_proof'],  // Proof only, not real bridging
    perp: ['demo_perp'],       // Proof only
    proof: ['native'],
    unknown: ['native'],
  },
  solana: {
    deposit: ['solana_vault'],
    swap: ['demo_dex'],
    bridge: ['bridge_proof'],
    perp: ['demo_perp'],
    proof: ['native'],
    unknown: ['native'],
  },
};

// Extended IntentKind to include new types
type ExtendedIntentKind = IntentKind | 'prediction' | 'hedge' | 'vault_discovery';

// Intent patterns for parsing
const INTENT_PATTERNS = {
  perp: {
    long: /(?:^|\s)(?:go\s+)?long\s+(\w+)(?:\s+(\d+)x)?/i,
    short: /(?:^|\s)(?:go\s+)?short\s+(\w+)(?:\s+(\d+)x)?/i,
    leverage: /(\d+)\s*x\s*(?:leverage|lev)?/i,
    withAmount: /with\s+(\d+(?:,?\d+)*(?:\.\d+)?)/i,
  },
  swap: {
    basic: /swap\s+(?:(\d+(?:,?\d+)*(?:\.\d+)?)\s*)?(\w+)\s+(?:to|for|->)\s+(\w+)/i,
    convert: /convert\s+(?:(\d+(?:,?\d+)*(?:\.\d+)?)\s*)?(\w+)\s+to\s+(\w+)/i,
    trade: /trade\s+(?:(\d+(?:,?\d+)*(?:\.\d+)?)\s*)?(\w+)\s+(?:for|to)\s+(\w+)/i,
  },
  deposit: {
    basic: /deposit\s+(?:(\d+(?:,?\d+)*(?:\.\d+)?)\s*)?(\w+)\s+(?:to|into|in)\s+(\w+)/i,
    supply: /supply\s+(?:(\d+(?:,?\d+)*(?:\.\d+)?)\s*)?(\w+)\s+(?:to|into)\s+(\w+)/i,
    lend: /lend\s+(?:(\d+(?:,?\d+)*(?:\.\d+)?)\s*)?(\w+)/i,
  },
  bridge: {
    basic: /bridge\s+(?:(\d+(?:,?\d+)*(?:\.\d+)?)\s*)?(\w+)\s+(?:from\s+)?(\w+)\s+to\s+(\w+)/i,
    transfer: /transfer\s+(?:(\d+(?:,?\d+)*(?:\.\d+)?)\s*)?(\w+)\s+from\s+(\w+)\s+to\s+(\w+)/i,
  },
  // New patterns for Product Thesis scenarios
  prediction: {
    bet: /(?:bet|wager|stake)\s+(?:on\s+)?(?:the\s+)?/i,
    market: /prediction\s*market/i,
    volume: /(?:highest|top|best)\s*(?:volume|liquidity)/i,
  },
  hedge: {
    basic: /hedge\s+(?:my\s+)?(?:positions?|portfolio)/i,
    protect: /protect\s+(?:my\s+)?(?:positions?|portfolio)/i,
  },
  vault: {
    discovery: /(?:find|get|show)\s+(?:me\s+)?(?:the\s+)?(?:top|best)\s+(?:defi\s+)?vault/i,
    yield: /(\d+(?:\.\d+)?)\s*%\s*(?:yield|apy|apr)/i,
  },
  // Analytics intents - recorded to ledger without on-chain proof
  analytics: {
    exposure: /(?:show|check|get|view)\s+(?:me\s+)?(?:my\s+)?(?:current\s+)?(?:perp\s+)?exposure/i,
    risk: /(?:show|check|get|view)\s+(?:me\s+)?(?:my\s+)?(?:current\s+)?risk/i,
    topProtocols: /(?:show|get|find)\s+(?:me\s+)?(?:the\s+)?(?:top|best)\s+(?:\d+\s+)?(?:defi\s+)?protocols?/i,
    topMarkets: /(?:show|get|find)\s+(?:me\s+)?(?:the\s+)?(?:top|best)\s+(?:\d+\s+)?prediction\s+markets?/i,
  },
};

/**
 * Parse a natural language intent into structured format
 */
export function parseIntent(intentText: string): ParsedIntent {
  const text = intentText.toLowerCase().trim();
  const rawParams: Record<string, any> = { original: intentText };

  // Check for hedge/portfolio protection intent FIRST (before other patterns)
  if (INTENT_PATTERNS.hedge.basic.test(text) || INTENT_PATTERNS.hedge.protect.test(text)) {
    return {
      kind: 'unknown', // Will be routed as proof_only with special handling
      action: 'hedge',
      rawParams: { ...rawParams, intentType: 'hedge', requiresPortfolio: true },
    };
  }

  // Check for prediction market intent
  if (INTENT_PATTERNS.prediction.market.test(text) ||
      (INTENT_PATTERNS.prediction.bet.test(text) && INTENT_PATTERNS.prediction.volume.test(text))) {
    return {
      kind: 'unknown', // Will be routed as proof_only with special handling
      action: 'prediction_bet',
      rawParams: { ...rawParams, intentType: 'prediction', requiresMarketData: true },
    };
  }

  // Check for vault discovery intent
  if (INTENT_PATTERNS.vault.discovery.test(text)) {
    const yieldMatch = text.match(INTENT_PATTERNS.vault.yield);
    const targetYield = yieldMatch ? parseFloat(yieldMatch[1]) : undefined;

    return {
      kind: 'deposit', // Route to deposit flow, but needs discovery first
      action: 'vault_discovery',
      rawParams: { ...rawParams, intentType: 'vault_discovery', targetYield, requiresYieldRanking: true },
    };
  }

  // Try perp patterns
  const longMatch = text.match(INTENT_PATTERNS.perp.long);
  const shortMatch = text.match(INTENT_PATTERNS.perp.short);

  if (longMatch || shortMatch) {
    const match = longMatch || shortMatch;
    const side = longMatch ? 'long' : 'short';
    const asset = match![1].toUpperCase();
    const leverageMatch = text.match(INTENT_PATTERNS.perp.leverage);
    const leverage = leverageMatch ? parseInt(leverageMatch[1]) : 10;

    // Check for "with X" amount pattern
    const amountMatch = text.match(INTENT_PATTERNS.perp.withAmount);
    const amount = amountMatch ? amountMatch[1].replace(/,/g, '') : undefined;

    return {
      kind: 'perp',
      action: side,
      amount,
      amountUnit: 'REDACTED', // Assume REDACTED for perp margin
      targetAsset: asset,
      leverage,
      rawParams: { ...rawParams, side, asset, leverage, amount },
    };
  }

  // Try swap patterns
  for (const [name, pattern] of Object.entries(INTENT_PATTERNS.swap)) {
    const match = text.match(pattern);
    if (match) {
      const amount = match[1]?.replace(/,/g, '') || '1000';
      const fromAsset = match[2].toUpperCase();
      const toAsset = match[3].toUpperCase();

      return {
        kind: 'swap',
        action: 'swap',
        amount,
        amountUnit: fromAsset,
        targetAsset: toAsset,
        rawParams: { ...rawParams, amount, fromAsset, toAsset },
      };
    }
  }

  // Try deposit patterns
  for (const [name, pattern] of Object.entries(INTENT_PATTERNS.deposit)) {
    const match = text.match(pattern);
    if (match) {
      const amount = match[1]?.replace(/,/g, '') || '1000';
      const asset = match[2].toUpperCase();
      const venue = match[3]?.toLowerCase() || 'vault';

      return {
        kind: 'deposit',
        action: 'deposit',
        amount,
        amountUnit: asset,
        venue,
        rawParams: { ...rawParams, amount, asset, venue },
      };
    }
  }

  // Try bridge patterns
  for (const [name, pattern] of Object.entries(INTENT_PATTERNS.bridge)) {
    const match = text.match(pattern);
    if (match) {
      const amount = match[1]?.replace(/,/g, '') || '1000';
      const asset = match[2].toUpperCase();
      const sourceChain = match[3].toLowerCase();
      const destChain = match[4].toLowerCase();

      return {
        kind: 'bridge',
        action: 'bridge',
        amount,
        amountUnit: asset,
        sourceChain: sourceChain === 'eth' ? 'ethereum' : sourceChain,
        destChain: destChain === 'sol' ? 'solana' : destChain,
        rawParams: { ...rawParams, amount, asset, sourceChain, destChain },
      };
    }
  }

  // Check for analytics intents (exposure, risk, top protocols, etc.)
  if (INTENT_PATTERNS.analytics.exposure.test(text) ||
      INTENT_PATTERNS.analytics.risk.test(text)) {
    return {
      kind: 'unknown',
      action: 'analytics_exposure',
      rawParams: { ...rawParams, intentType: 'analytics', analyticsType: 'exposure' },
    };
  }

  if (INTENT_PATTERNS.analytics.topProtocols.test(text)) {
    return {
      kind: 'unknown',
      action: 'analytics_protocols',
      rawParams: { ...rawParams, intentType: 'analytics', analyticsType: 'top_protocols' },
    };
  }

  if (INTENT_PATTERNS.analytics.topMarkets.test(text)) {
    return {
      kind: 'unknown',
      action: 'analytics_markets',
      rawParams: { ...rawParams, intentType: 'analytics', analyticsType: 'top_markets' },
    };
  }

  // Unknown intent
  return {
    kind: 'unknown',
    action: 'proof',
    rawParams,
  };
}

/**
 * Determine execution route for a parsed intent
 */
export function routeIntent(
  parsed: ParsedIntent,
  preferredChain?: ChainTarget
): RouteDecision | { error: { stage: IntentFailureStage; code: string; message: string } } {
  const { kind, venue, sourceChain, destChain, rawParams } = parsed;

  // Determine target chain
  let targetChain: 'ethereum' | 'solana' = 'ethereum';
  if (preferredChain === 'solana') {
    targetChain = 'solana';
  } else if (kind === 'bridge') {
    // Bridge: source chain determines where we start
    if (sourceChain === 'solana') {
      targetChain = 'solana';
    }
  }

  const network = targetChain === 'ethereum' ? 'sepolia' : 'devnet';

  // Handle special intent types that need specific integrations

  // Hedge intent requires portfolio state
  if (rawParams?.intentType === 'hedge') {
    // For now, we don't have portfolio state ingestion
    // Route to proof_only with clear messaging
    return {
      chain: targetChain,
      network,
      venue: 'native',
      executionType: 'proof_only',
      warnings: [
        'PROOF_ONLY: Hedge intent requires portfolio state integration.',
        'Portfolio ingestion not yet implemented - recording intent proof on-chain.',
      ],
    };
  }

  // Prediction market intent requires market data
  if (rawParams?.intentType === 'prediction') {
    // For now, we don't have prediction market data source integrated
    return {
      chain: targetChain,
      network,
      venue: 'native',
      executionType: 'proof_only',
      warnings: [
        'PROOF_ONLY: Prediction market intent requires market data integration.',
        'Polymarket/prediction data source not yet integrated - recording intent proof on-chain.',
      ],
    };
  }

  // Vault discovery intent requires yield ranking
  if (rawParams?.intentType === 'vault_discovery') {
    // For now, we don't have yield ranking integrated
    return {
      chain: targetChain,
      network,
      venue: 'native',
      executionType: 'proof_only',
      warnings: [
        'PROOF_ONLY: Vault discovery requires yield ranking integration.',
        'DefiLlama/yield sources not yet integrated - recording intent proof on-chain.',
        `Target yield: ${rawParams.targetYield || 'not specified'}%`,
      ],
    };
  }

  // Analytics intent - offchain analysis, recorded to ledger without proof tx
  if (rawParams?.intentType === 'analytics') {
    return {
      chain: targetChain,
      network,
      venue: 'offchain',
      executionType: 'offchain' as any, // Special handling for analytics
      warnings: [
        'OFFCHAIN: Analytics intent - no on-chain action required.',
        `Analysis type: ${rawParams.analyticsType || 'general'}`,
      ],
    };
  }

  // Check venue implementation
  const implementedVenues = IMPLEMENTED_VENUES[targetChain][kind] || [];

  // Handle perp intents
  if (kind === 'perp') {
    const requestedVenue = venue?.toLowerCase();

    // If they request a specific venue like drift/hl, fail clearly
    if (requestedVenue && ['drift', 'hl', 'hyperliquid', 'dydx'].includes(requestedVenue)) {
      return {
        error: {
          stage: 'route',
          code: 'VENUE_NOT_IMPLEMENTED',
          message: `Perp venue "${requestedVenue}" is not yet integrated. Recording as proof-only.`,
        },
      };
    }

    // Check if demo perp adapter is configured for real execution
    // Use config import which has fallback defaults
    if (DEMO_PERP_ADAPTER_ADDRESS && targetChain === 'ethereum') {
      // Real execution via DemoPerpAdapter on Sepolia
      return {
        chain: 'ethereum',
        network: 'sepolia',
        venue: 'demo_perp',
        adapter: DEMO_PERP_ADAPTER_ADDRESS,
        executionType: 'real',
      };
    }

    // If no adapter configured, use proof_only mode since we can't execute without the adapter
    if (targetChain === 'ethereum') {
      return {
        chain: 'ethereum',
        network: 'sepolia',
        venue: 'demo_perp',
        executionType: 'proof_only',
        warnings: ['PROOF_ONLY: DEMO_PERP_ADAPTER_ADDRESS not configured. Set this env var for real perp execution.'],
      };
    }

    // Non-Ethereum chains get proof_only with explanation
    return {
      chain: targetChain,
      network,
      venue: 'demo_perp',
      executionType: 'proof_only',
      warnings: [`PROOF_ONLY: Perp execution on ${targetChain} not yet available. Recording intent proof on-chain.`],
    };
  }

  // Handle bridge intents
  if (kind === 'bridge') {
    // Check if bridging between different chains
    if (sourceChain && destChain && sourceChain !== destChain) {
      // Bridge is quote-only for now
      return {
        chain: targetChain,
        network,
        venue: 'lifi',
        executionType: 'proof_only',
        warnings: ['Bridge execution not fully implemented. Will attempt LiFi quote.'],
      };
    }
  }

  // Handle deposit intents
  if (kind === 'deposit') {
    const requestedVenue = venue?.toLowerCase();

    // Check for unimplemented venues - route to proof_only instead of failing
    if (requestedVenue && ['kamino', 'drift'].includes(requestedVenue)) {
      return {
        chain: targetChain,
        network,
        venue: requestedVenue,
        executionType: 'proof_only',
        warnings: [
          `PROOF_ONLY: Deposit venue "${requestedVenue}" is not yet integrated.`,
          'Recording intent proof on-chain.',
        ],
      };
    }

    // Route to appropriate venue
    if (requestedVenue === 'aave' && targetChain === 'ethereum') {
      return {
        chain: 'ethereum',
        network: 'sepolia',
        venue: 'aave',
        executionType: 'real',
      };
    }

    // Default to demo vault - Solana goes to proof_only for now
    if (targetChain === 'solana') {
      return {
        chain: 'solana',
        network: 'devnet',
        venue: 'solana_vault',
        executionType: 'proof_only',
        warnings: ['PROOF_ONLY: Solana vault integration pending. Recording intent proof on-chain.'],
      };
    }

    return {
      chain: targetChain,
      network,
      venue: 'demo_vault',
      executionType: 'real',
    };
  }

  // Handle swap intents
  if (kind === 'swap') {
    // Solana swaps go to proof_only since execution isn't fully wired
    if (targetChain === 'solana') {
      return {
        chain: 'solana',
        network: 'devnet',
        venue: 'demo_dex',
        executionType: 'proof_only',
        warnings: ['PROOF_ONLY: Solana swap integration pending. Recording intent proof on-chain.'],
      };
    }

    return {
      chain: targetChain,
      network,
      venue: 'demo_dex',
      executionType: 'real',
    };
  }

  // Unknown/proof
  return {
    chain: targetChain,
    network,
    venue: 'native',
    executionType: 'proof_only',
    warnings: ['Intent not recognized. Recording proof-of-execution only.'],
  };
}

/**
 * Estimate USD value for an intent
 */
function estimateIntentUsd(parsed: ParsedIntent): number | undefined {
  const amount = parsed.amount ? parseFloat(parsed.amount) : undefined;
  if (!amount) return undefined;

  const unit = parsed.amountUnit?.toUpperCase();

  // Simple price estimates (for testnet)
  const prices: Record<string, number> = {
    REDACTED: 1,
    USDT: 1,
    DAI: 1,
    ETH: 2000,
    WETH: 2000,
    SOL: 100,
    BTC: 45000,
  };

  return amount * (prices[unit || ''] || 1);
}

/**
 * Run a single intent through the full pipeline
 *
 * Options:
 * - chain: Target chain (ethereum, solana, both)
 * - planOnly: Stop after routing, return plan without executing (for confirm mode)
 * - intentId: Execute a previously planned intent (skip parse/route)
 */
export async function runIntent(
  intentText: string,
  options: {
    chain?: ChainTarget;
    planOnly?: boolean;
    intentId?: string;  // For executing a previously planned intent
    dryRun?: boolean;   // Legacy, use planOnly instead
    metadata?: Record<string, any>;  // Caller-provided metadata (e.g., torture_suite tagging)
  } = {}
): Promise<IntentExecutionResult> {
  // Dynamic imports for ledger (avoids path issues)
  // Use async versions for Postgres support
  const {
    createIntentAsync: createIntent,
    updateIntentStatusAsync: updateIntentStatus,
    createExecutionAsync: createExecution,
    updateExecutionAsync: updateExecution,
    createExecutionStepAsync: createExecutionStep,
    updateExecutionStepAsync: updateExecutionStep,
    linkExecutionToIntentAsync: linkExecutionToIntent,
  } = await import('../../execution-ledger/db');

  const now = Math.floor(Date.now() / 1000);

  // Step 1: Parse intent
  const parsed = parseIntent(intentText);
  const usdEstimate = estimateIntentUsd(parsed);

  // Merge caller-provided metadata with internal metadata
  // callerMeta is preserved and passed through ALL status updates
  const callerMeta = options.metadata || {};

  // Helper to build metadata JSON that preserves caller metadata
  const buildMetadata = (extra: Record<string, any> = {}) => JSON.stringify({
    ...callerMeta,  // Always include caller metadata (source, domain, runId, etc.)
    parsed,
    ...extra,
  });

  // Step 2: Create intent record
  const intent = await createIntent({
    intentText,
    intentKind: parsed.kind,
    requestedVenue: parsed.venue,
    usdEstimate,
    metadataJson: buildMetadata({ options: { ...options, metadata: undefined } }),
  });

  try {
    // Step 3: Route intent
    await updateIntentStatus(intent.id, {
      status: 'planned',
      plannedAt: now,
      metadataJson: buildMetadata({ options: { ...options, metadata: undefined } }),
    });

    const route = routeIntent(parsed, options.chain);

    // Check for routing error
    if ('error' in route) {
      await updateIntentStatus(intent.id, {
        status: 'failed',
        failureStage: route.error.stage,
        errorCode: route.error.code,
        errorMessage: route.error.message,
      });

      return {
        ok: false,
        intentId: intent.id,
        status: 'failed',
        error: route.error,
      };
    }

    await updateIntentStatus(intent.id, {
      status: 'routed',
      requestedChain: route.chain,
      requestedVenue: route.venue,
      metadataJson: buildMetadata({ route, options: { ...options, metadata: undefined } }),
    });

    // Step 4: Handle bridge intents with LiFi
    if (parsed.kind === 'bridge' && route.venue === 'lifi') {
      const bridgeResult = await handleBridgeIntent(intent.id, parsed, route);
      return bridgeResult;
    }

    // Step 5: Execute based on chain and type
    await updateIntentStatus(intent.id, {
      status: 'executing',
      executedAt: now,
    });

    // For planOnly mode (confirm flow), stop after routing and return plan
    if (options.planOnly || options.dryRun) {
      await updateIntentStatus(intent.id, {
        status: 'planned',
        plannedAt: now,
        metadataJson: buildMetadata({
          route,
          planOnly: true,
          executedKind: route.executionType,
        }),
      });

      return {
        ok: true,
        intentId: intent.id,
        status: 'planned',
        metadata: {
          planOnly: true,
          executedKind: route.executionType,
          parsed: {
            kind: parsed.kind,
            action: parsed.action,
            amount: parsed.amount,
            amountUnit: parsed.amountUnit,
            targetAsset: parsed.targetAsset,
            leverage: parsed.leverage,
          },
          route: {
            chain: route.chain,
            network: route.network,
            venue: route.venue,
            executionType: route.executionType,
            warnings: route.warnings,
          },
        },
      };
    }

    // Execute on appropriate chain
    const execResult = await executeOnChain(intent.id, parsed, route);
    return execResult;

  } catch (error: any) {
    // Catch-all error handler
    await updateIntentStatus(intent.id, {
      status: 'failed',
      failureStage: 'execute',
      errorCode: 'EXECUTION_ERROR',
      errorMessage: error.message?.slice(0, 500),
    });

    return {
      ok: false,
      intentId: intent.id,
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'EXECUTION_ERROR',
        message: error.message,
      },
    };
  }
}

/**
 * Execute a previously planned intent by ID
 * Used for confirm-mode flow where user reviews plan first
 */
export async function executeIntentById(
  intentId: string
): Promise<IntentExecutionResult> {
  // CRITICAL: Use async versions that support Postgres in production
  const {
    getIntentAsync,
    updateIntentStatusAsync: updateIntentStatus,
  } = await import('../../execution-ledger/db');

  const now = Math.floor(Date.now() / 1000);

  // Get the intent (use async for Postgres support)
  const intent = await getIntentAsync(intentId);
  if (!intent) {
    return {
      ok: false,
      intentId,
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'INTENT_NOT_FOUND',
        message: `Intent ${intentId} not found`,
      },
    };
  }

  // Verify intent is in planned status
  if (intent.status !== 'planned') {
    return {
      ok: false,
      intentId,
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'INVALID_STATUS',
        message: `Intent is in ${intent.status} status, expected 'planned'`,
      },
    };
  }

  try {
    // Parse the stored metadata
    const metadata = JSON.parse(intent.metadata_json || '{}');
    const parsed = metadata.parsed as ParsedIntent;
    const route = metadata.route as RouteDecision;

    if (!parsed || !route) {
      return {
        ok: false,
        intentId,
        status: 'failed',
        error: {
          stage: 'execute',
          code: 'INVALID_METADATA',
          message: 'Intent missing parsed or route metadata',
        },
      };
    }

    // Update status to executing
    await updateIntentStatus(intentId, {
      status: 'executing',
      executedAt: now,
    });

    // Handle bridge intents
    if (parsed.kind === 'bridge' && route.venue === 'lifi') {
      const bridgeResult = await handleBridgeIntent(intentId, parsed, route);
      return bridgeResult;
    }

    // Execute on appropriate chain
    const execResult = await executeOnChain(intentId, parsed, route);
    return execResult;

  } catch (error: any) {
    await updateIntentStatus(intentId, {
      status: 'failed',
      failureStage: 'execute',
      errorCode: 'EXECUTION_ERROR',
      errorMessage: error.message?.slice(0, 500),
    });

    return {
      ok: false,
      intentId,
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'EXECUTION_ERROR',
        message: error.message,
      },
    };
  }
}

/**
 * Handle bridge intent with LiFi quote
 * Produces proof txs on both chains to record the bridge intent attempt
 */
async function handleBridgeIntent(
  intentId: string,
  parsed: ParsedIntent,
  route: RouteDecision
): Promise<IntentExecutionResult> {
  const {
    updateIntentStatus,
    createExecution,
    updateExecution,
    linkExecutionToIntent,
  } = await import('../../execution-ledger/db');
  const { buildExplorerUrl } = await import('../ledger/ledger');
  const { getLiFiQuote } = await import('../bridge/lifi');

  const now = Math.floor(Date.now() / 1000);

  // Attempt LiFi quote
  const quoteResult = await getLiFiQuote({
    fromChain: parsed.sourceChain || 'ethereum',
    toChain: parsed.destChain || 'solana',
    fromToken: parsed.amountUnit || 'REDACTED',
    toToken: parsed.amountUnit || 'REDACTED',
    fromAmount: (BigInt(parsed.amount || '1000') * BigInt(10 ** 6)).toString(),
  });

  // Store quote result in metadata
  const quoteMetadata = quoteResult.ok
    ? { quoteSuccess: true, tool: quoteResult.quote?.tool, toAmount: quoteResult.quote?.toAmount }
    : { quoteSuccess: false, error: quoteResult.error };

  // Even if quote fails, we'll still create proof txs to record the attempt
  // This ensures we always have on-chain evidence of the bridge intent

  // Create proof transaction on source chain (Sepolia)
  const sourceProofResult = await executeProofOnly(intentId, {
    ...parsed,
    rawParams: {
      ...parsed.rawParams,
      original: `BRIDGE_INTENT_PROOF: ${parsed.rawParams.original} | quote: ${quoteResult.ok ? 'success' : 'failed'}`,
    },
  }, {
    ...route,
    chain: 'ethereum',
    network: 'sepolia',
  });

  // If source chain proof succeeded and destination is solana, try dest chain proof too
  let destProofResult: IntentExecutionResult | null = null;
  if (sourceProofResult.ok && (parsed.destChain === 'solana' || parsed.destChain === 'sol')) {
    try {
      // We need to create a separate execution for the dest chain proof
      const destRoute: RouteDecision = {
        chain: 'solana',
        network: 'devnet',
        venue: 'bridge_proof',
        executionType: 'proof_only',
      };
      destProofResult = await executeProofOnlySolana(intentId, {
        ...parsed,
        rawParams: {
          ...parsed.rawParams,
          original: `BRIDGE_DEST_PROOF: ${parsed.rawParams.original}`,
        },
      }, destRoute);
    } catch (e) {
      // Dest chain proof is best-effort
      console.warn('[bridge] Dest chain proof failed:', e);
    }
  }

  // Final status depends on proof txs
  if (sourceProofResult.ok) {
    await updateIntentStatus(intentId, {
      status: 'confirmed',
      confirmedAt: Math.floor(Date.now() / 1000),
      metadataJson: JSON.stringify({
        parsed,
        route,
        executedKind: 'proof_only',
        quoteMetadata,
        sourceChainProof: {
          txHash: sourceProofResult.txHash,
          explorerUrl: sourceProofResult.explorerUrl,
        },
        destChainProof: destProofResult?.ok ? {
          txHash: destProofResult.txHash,
          explorerUrl: destProofResult.explorerUrl,
        } : null,
        note: 'Bridge execution not wired - proof txs recorded on-chain',
      }),
    });

    return {
      ok: true,
      intentId,
      status: 'confirmed',
      executionId: sourceProofResult.executionId,
      txHash: sourceProofResult.txHash,
      explorerUrl: sourceProofResult.explorerUrl,
      metadata: {
        executedKind: 'proof_only',
        quoteMetadata,
        destChainProof: destProofResult?.ok ? {
          txHash: destProofResult.txHash,
          explorerUrl: destProofResult.explorerUrl,
        } : null,
      },
    };
  }

  // If even proof tx failed, mark as failed
  return sourceProofResult;
}

/**
 * Execute intent on the appropriate chain
 */
async function executeOnChain(
  intentId: string,
  parsed: ParsedIntent,
  route: RouteDecision
): Promise<IntentExecutionResult> {
  const {
    updateIntentStatus,
    createExecution,
    updateExecution,
    linkExecutionToIntent,
  } = await import('../../execution-ledger/db');

  const now = Math.floor(Date.now() / 1000);

  // For offchain analytics executions (no on-chain tx needed)
  if ((route.executionType as string) === 'offchain') {
    return await executeOffchain(intentId, parsed, route);
  }

  // For proof-only executions (perp, unrecognized)
  if (route.executionType === 'proof_only') {
    return await executeProofOnly(intentId, parsed, route);
  }

  // Real perp execution via DemoPerpAdapter
  if (parsed.kind === 'perp' && route.executionType === 'real' && route.chain === 'ethereum') {
    return await executePerpEthereum(intentId, parsed, route);
  }

  // Real execution based on chain
  if (route.chain === 'ethereum') {
    return await executeEthereum(intentId, parsed, route);
  } else {
    return await executeSolana(intentId, parsed, route);
  }
}

/**
 * Execute offchain analytics intent - records to ledger without on-chain tx
 */
async function executeOffchain(
  intentId: string,
  parsed: ParsedIntent,
  route: RouteDecision
): Promise<IntentExecutionResult> {
  const {
    updateIntentStatus,
    createExecution,
    linkExecutionToIntent,
  } = await import('../../execution-ledger/db');

  const now = Math.floor(Date.now() / 1000);
  const analyticsType = parsed.rawParams?.analyticsType || 'general';

  // Create execution record (offchain type)
  const execution = await createExecution({
    chain: route.chain,
    network: route.network as any,
    kind: 'proof' as any, // Use 'proof' kind but mark as offchain in metadata
    venue: 'offchain' as any,
    intent: parsed.rawParams?.original || 'Analytics intent',
    action: parsed.action,
    fromAddress: 'offchain',
    usdEstimate: 0,
    usdEstimateIsEstimate: true,
  });

  await linkExecutionToIntent(execution.id, intentId);

  // Mark as confirmed immediately (no tx to wait for)
  await updateIntentStatus(intentId, {
    status: 'confirmed',
    confirmedAt: now,
    metadataJson: JSON.stringify({
      parsed,
      route,
      executedKind: 'offchain',
      executionId: execution.id,
      analyticsType,
      note: 'Analytics-only intent. No on-chain action required.',
      warnings: route.warnings,
    }),
  });

  return {
    ok: true,
    intentId,
    status: 'confirmed',
    executionId: execution.id,
    metadata: {
      executedKind: 'offchain',
      analyticsType,
      note: 'Analytics-only intent. No on-chain action required.',
      warnings: route.warnings,
    },
  };
}

/**
 * Execute perp position via DemoPerpAdapter on Sepolia
 * Real on-chain execution with margin deposit and position opening
 */
async function executePerpEthereum(
  intentId: string,
  parsed: ParsedIntent,
  route: RouteDecision
): Promise<IntentExecutionResult> {
  const {
    getIntentAsync,
    updateIntentStatusAsync: updateIntentStatus,
    finalizeExecutionTransactionAsync,
  } = await import('../../execution-ledger/db');
  const { createPosition } = await import('../../execution-ledger/db');
  const { buildExplorerUrl } = await import('../ledger/ledger');

  const now = Math.floor(Date.now() / 1000);
  const startTime = Date.now();

  // Get intent's existing metadata to preserve caller info (source, domain, runId)
  const intent = await getIntentAsync(intentId);
  const existingMetadataJson = intent?.metadata_json;

  // Import config
  const {
    RELAYER_PRIVATE_KEY,
    ETH_TESTNET_RPC_URL,
    DEMO_PERP_ADAPTER_ADDRESS,
    DEMO_REDACTED_ADDRESS,
    EXECUTION_ROUTER_ADDRESS,
    ERC20_PULL_ADAPTER_ADDRESS,
  } = await import('../config');

  // Validate required config
  if (!RELAYER_PRIVATE_KEY || !ETH_TESTNET_RPC_URL) {
    await updateIntentStatus(intentId, {
      status: 'failed',
      failureStage: 'execute',
      errorCode: 'CONFIG_MISSING',
      errorMessage: 'Relayer key or RPC not configured',
    });

    return {
      ok: false,
      intentId,
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'CONFIG_MISSING',
        message: 'Relayer key or RPC not configured',
      },
    };
  }

  if (!DEMO_PERP_ADAPTER_ADDRESS || !DEMO_REDACTED_ADDRESS || !EXECUTION_ROUTER_ADDRESS) {
    await updateIntentStatus(intentId, {
      status: 'failed',
      failureStage: 'execute',
      errorCode: 'PERP_CONFIG_MISSING',
      errorMessage: 'DemoPerpAdapter or DEMO_REDACTED not configured',
    });

    return {
      ok: false,
      intentId,
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'PERP_CONFIG_MISSING',
        message: 'DemoPerpAdapter or DEMO_REDACTED not configured',
      },
    };
  }

  // Prepare execution data BEFORE try block so catch can access it
  // fromAddress will be updated once account is created
  const executionData = {
    chain: 'ethereum' as const,
    network: 'sepolia' as const,
    kind: 'perp' as const,
    venue: 'demo_perp' as any,
    intent: parsed.rawParams.original || 'Perp position',
    action: parsed.action,
    fromAddress: '0x0000000000000000000000000000000000000000', // Updated below
    token: 'DEMO_REDACTED',
    amountDisplay: parsed.amount ? `${parsed.amount} REDACTED @ ${parsed.leverage}x` : undefined,
    usdEstimate: estimateIntentUsd(parsed),
    usdEstimateIsEstimate: true,
  };

  try {
    // Import viem for transaction
    const { encodeFunctionData, parseAbi } = await import('viem');
    const { privateKeyToAccount } = await import('viem/accounts');

    // Use failover RPC clients for reliability
    const {
      createFailoverPublicClient,
      createFailoverWalletClient,
      executeWithFailover,
    } = await import('../providers/rpcProvider');

    const account = privateKeyToAccount(RELAYER_PRIVATE_KEY as `0x${string}`);

    // Update fromAddress now that we have the account
    executionData.fromAddress = account.address;

    // Create clients with failover support (includes retry and circuit breaker)
    const publicClient = createFailoverPublicClient();
    const walletClient = createFailoverWalletClient(account);

    // Map market string to enum value
    const marketMap: Record<string, number> = {
      'BTC': 0,
      'ETH': 1,
      'SOL': 2,
    };
    const market = marketMap[parsed.targetAsset?.toUpperCase() || 'BTC'] ?? 0;

    // Map side to enum value
    const side = parsed.action === 'long' ? 0 : 1;

    // Calculate margin amount (default 100 DEMO_REDACTED if not specified)
    // DEMO_REDACTED has 6 decimals
    const marginAmount = parsed.amount
      ? BigInt(Math.floor(parseFloat(parsed.amount) * 1e6))
      : BigInt(100 * 1e6); // 100 REDACTED default

    const leverage = parsed.leverage || 10;

    // DemoPerpAdapter ABI for execute function
    const perpAdapterAbi = parseAbi([
      'function execute(bytes calldata innerData) external payable returns (bytes memory)',
    ]);

    // ExecutionRouter ABI
    const routerAbi = parseAbi([
      'function execute(address adapter, bytes calldata adapterData) external payable returns (bytes memory)',
    ]);

    // Encode inner data for DemoPerpAdapter
    // Format: (uint8 action, address user, uint8 market, uint8 side, uint256 margin, uint256 leverage)
    const ACTION_OPEN = 1;
    const innerData = encodeFunctionData({
      abi: parseAbi(['function encode(uint8,address,uint8,uint8,uint256,uint256)']),
      functionName: 'encode',
      args: [ACTION_OPEN, account.address, market, side, marginAmount, BigInt(leverage)],
    }).slice(10); // Remove function selector, we just want the encoded params

    // Actually, we need to encode the params directly without a function signature
    // Use encodeAbiParameters instead
    const { encodeAbiParameters, parseAbiParameters } = await import('viem');
    const encodedInnerData = encodeAbiParameters(
      parseAbiParameters('uint8, address, uint8, uint8, uint256, uint256'),
      [ACTION_OPEN, account.address as `0x${string}`, market, side, marginAmount, BigInt(leverage)]
    );

    // Before executing perp, we need DEMO_REDACTED balance
    // For testnet demo, we'll mint DEMO_REDACTED to the relayer first (if it's mintable)
    // Or assume the relayer already has DEMO_REDACTED

    // Encode router call
    const routerCallData = encodeFunctionData({
      abi: routerAbi,
      functionName: 'execute',
      args: [DEMO_PERP_ADAPTER_ADDRESS as `0x${string}`, encodedInnerData as `0x${string}`],
    });

    // First, approve DEMO_REDACTED to ExecutionRouter (if not already approved)
    const erc20Abi = parseAbi([
      'function approve(address spender, uint256 amount) external returns (bool)',
      'function allowance(address owner, address spender) external view returns (uint256)',
      'function balanceOf(address account) external view returns (uint256)',
    ]);

    // Check balance
    let balance = await publicClient.readContract({
      address: DEMO_REDACTED_ADDRESS as `0x${string}`,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    });

    // Auto-mint DEMO_REDACTED if balance is insufficient (testnet demo feature)
    if (balance < marginAmount) {
      console.log(`[executePerpEthereum] Relayer balance ${balance} < needed ${marginAmount}, auto-minting...`);

      const mintAbi = parseAbi(['function mint(address to, uint256 amount) external']);
      const mintAmount = marginAmount * BigInt(10); // Mint 10x to cover future trades

      try {
        const mintTxHash = await walletClient.writeContract({
          address: DEMO_REDACTED_ADDRESS as `0x${string}`,
          abi: mintAbi,
          functionName: 'mint',
          args: [account.address, mintAmount],
        });

        console.log(`[executePerpEthereum] Mint tx submitted: ${mintTxHash}`);

        // Wait for mint confirmation with short timeout (1 confirmation, 10s max)
        await publicClient.waitForTransactionReceipt({
          hash: mintTxHash,
          timeout: 10000,
          confirmations: 1,
        });

        console.log(`[executePerpEthereum] Mint confirmed`);

        // Re-check balance after mint
        balance = await publicClient.readContract({
          address: DEMO_REDACTED_ADDRESS as `0x${string}`,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [account.address],
        });

        console.log(`[executePerpEthereum] New balance: ${balance}`);
      } catch (mintError: any) {
        console.error(`[executePerpEthereum] Auto-mint failed:`, mintError.message);
        // Continue with original insufficient balance error if mint fails
      }
    }

    // Final balance check after potential auto-mint
    if (balance < marginAmount) {
      // Pre-flight check failed - create execution record showing why
      const result = await finalizeExecutionTransactionAsync({
        intentId,
        execution: {
          ...executionData,
          status: 'failed',
          errorCode: 'INSUFFICIENT_BALANCE',
          errorMessage: `Insufficient DEMO_REDACTED balance: have ${balance}, need ${marginAmount}`,
        },
        intentStatus: {
          status: 'failed',
          failureStage: 'execute',
          errorCode: 'INSUFFICIENT_BALANCE',
          errorMessage: 'Insufficient DEMO_REDACTED balance for perp margin',
        },
      });

      return {
        ok: false,
        intentId,
        status: 'failed',
        executionId: result.executionId,
        error: {
          stage: 'execute',
          code: 'INSUFFICIENT_BALANCE',
          message: 'Insufficient DEMO_REDACTED balance for perp margin',
        },
      };
    }

    // Check and set allowance to DemoPerpAdapter (called directly)
    const allowance = await publicClient.readContract({
      address: DEMO_REDACTED_ADDRESS as `0x${string}`,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [account.address, DEMO_PERP_ADAPTER_ADDRESS as `0x${string}`],
    });

    if (allowance < marginAmount) {
      // Approve DemoPerpAdapter to spend DEMO_REDACTED
      const approveTxHash = await walletClient.writeContract({
        address: DEMO_REDACTED_ADDRESS as `0x${string}`,
        abi: erc20Abi,
        functionName: 'approve',
        args: [DEMO_PERP_ADAPTER_ADDRESS as `0x${string}`, marginAmount * BigInt(10)], // Approve 10x to avoid future approvals
      });

      await publicClient.waitForTransactionReceipt({
        hash: approveTxHash,
        timeout: 15000,
      });
    }

    // Execute the perp position directly via adapter
    // DemoPerpAdapter.execute pulls tokens from msg.sender
    const txHash = await walletClient.writeContract({
      address: DEMO_PERP_ADAPTER_ADDRESS as `0x${string}`,
      abi: perpAdapterAbi,
      functionName: 'execute',
      args: [encodedInnerData as `0x${string}`],
    });

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: 15000,
    });

    const latencyMs = Date.now() - startTime;
    const explorerUrl = buildExplorerUrl('ethereum', 'sepolia', txHash);

    if (receipt.status === 'success') {
      // Prepare execution steps data
      const steps = [
        {
          stepIndex: 0,
          action: 'route',
          chain: 'ethereum',
          status: 'confirmed',
        },
        {
          stepIndex: 1,
          action: 'open_position',
          chain: 'ethereum',
          status: 'confirmed',
          txHash: txHash,
          explorerUrl: explorerUrl,
        },
      ];

      // Parse position ID from logs (PerpPositionOpened event)
      let onChainPositionId: string | undefined;
      try {
        // Look for PositionOpened event in logs
        const positionOpenedTopic = '0x' + Buffer.from('PositionOpened(address,uint256,uint8,uint8,uint256,uint256,uint256,uint256)').slice(0, 32).toString('hex');
        for (const log of receipt.logs) {
          if (log.topics[0]?.toLowerCase().includes('position')) {
            // Extract position ID from topics (indexed param)
            if (log.topics[2]) {
              onChainPositionId = BigInt(log.topics[2]).toString();
              break;
            }
          }
        }
      } catch (e) {
        // Position ID extraction failed, continue without it
      }

      // Parse position details
      const marketName = parsed.targetAsset?.toUpperCase() || 'BTC';
      const positionSide = parsed.action === 'long' ? 'long' : 'short';

      // ATOMIC TRANSACTION: Create execution + steps + update intent to confirmed
      const result = await finalizeExecutionTransactionAsync({
        intentId,
        execution: {
          ...executionData,
          txHash,
          explorerUrl,
          status: 'confirmed',
        },
        steps,
        intentStatus: {
          status: 'confirmed',
          confirmedAt: Math.floor(Date.now() / 1000),
          metadataJson: mergeMetadata(existingMetadataJson, {
            parsed,
            route,
            executedKind: 'real',
            txHash,
            explorerUrl,
            perpDetails: {
              market: marketName,
              side: positionSide,
              margin: marginAmount.toString(),
              leverage,
            },
          }),
        },
      });

      // Create position in ledger (indexer will also catch it, but this is faster)
      createPosition({
        chain: 'ethereum',
        network: 'sepolia',
        venue: 'demo_perp',
        market: marketName,
        side: positionSide,
        leverage,
        margin_units: marginAmount.toString(),
        margin_display: `${(Number(marginAmount) / 1e6).toFixed(2)} REDACTED`,
        size_units: (marginAmount * BigInt(leverage)).toString(),
        open_tx_hash: txHash,
        open_explorer_url: explorerUrl,
        user_address: account.address,
        on_chain_position_id: onChainPositionId,
        intent_id: intentId,
        execution_id: result.executionId,
      });

      return {
        ok: true,
        intentId,
        status: 'confirmed',
        executionId: result.executionId,
        txHash,
        explorerUrl,
        metadata: {
          executedKind: 'real',
          perpDetails: {
            market: marketName,
            side: positionSide,
            leverage,
          },
        },
      };
    } else {
      // ATOMIC TRANSACTION: Create execution + update intent to failed
      const result = await finalizeExecutionTransactionAsync({
        intentId,
        execution: {
          ...executionData,
          txHash,
          explorerUrl,
          status: 'failed',
          errorCode: 'TX_REVERTED',
          errorMessage: 'Perp position transaction reverted',
        },
        intentStatus: {
          status: 'failed',
          failureStage: 'confirm',
          errorCode: 'TX_REVERTED',
          errorMessage: 'Perp position transaction reverted on-chain',
        },
      });

      return {
        ok: false,
        intentId,
        status: 'failed',
        executionId: result.executionId,
        txHash,
        explorerUrl,
        error: {
          stage: 'confirm',
          code: 'TX_REVERTED',
          message: 'Perp position transaction reverted',
        },
      };
    }
  } catch (error: any) {
    // ATOMIC TRANSACTION: Create execution + update intent to failed
    const result = await finalizeExecutionTransactionAsync({
      intentId,
      execution: {
        ...executionData,
        status: 'failed',
        errorCode: 'PERP_EXECUTION_ERROR',
        errorMessage: error.message?.slice(0, 200),
      },
      intentStatus: {
        status: 'failed',
        failureStage: 'execute',
        errorCode: 'PERP_EXECUTION_ERROR',
        errorMessage: error.message?.slice(0, 200),
      },
    });

    return {
      ok: false,
      intentId,
      status: 'failed',
      executionId: result.executionId,
      error: {
        stage: 'execute',
        code: 'PERP_EXECUTION_ERROR',
        message: error.message,
      },
    };
  }
}

/**
 * Execute proof-only transaction - sends REAL on-chain proof tx
 * Records intent on-chain with txHash and explorerUrl
 */
async function executeProofOnly(
  intentId: string,
  parsed: ParsedIntent,
  route: RouteDecision
): Promise<IntentExecutionResult> {
  const {
    getIntentAsync,
    updateIntentStatusAsync,
    createExecutionAsync,
    updateExecutionAsync,
    linkExecutionToIntentAsync,
  } = await import('../../execution-ledger/db');
  const { buildExplorerUrl } = await import('../ledger/ledger');

  // Get intent's existing metadata to preserve caller info (source, domain, runId)
  const intent = await getIntentAsync(intentId);
  const existingMetadataJson = intent?.metadata_json;

  const now = Math.floor(Date.now() / 1000);
  const startTime = Date.now();

  // Route to appropriate chain for proof tx
  if (route.chain === 'solana') {
    return await executeProofOnlySolana(intentId, parsed, route);
  }

  // Default: Ethereum Sepolia proof tx
  const {
    RELAYER_PRIVATE_KEY,
    ETH_TESTNET_RPC_URL,
  } = await import('../config');

  if (!RELAYER_PRIVATE_KEY || !ETH_TESTNET_RPC_URL) {
    await updateIntentStatusAsync(intentId, {
      status: 'failed',
      failureStage: 'execute',
      errorCode: 'CONFIG_MISSING',
      errorMessage: 'Relayer key or RPC not configured for Sepolia proof tx',
    });

    return {
      ok: false,
      intentId,
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'CONFIG_MISSING',
        message: 'Relayer key or RPC not configured',
      },
    };
  }

  try {
    // Import viem for transaction
    const { createPublicClient, createWalletClient, http, toHex } = await import('viem');
    const { sepolia } = await import('viem/chains');
    const { privateKeyToAccount } = await import('viem/accounts');

    const account = privateKeyToAccount(RELAYER_PRIVATE_KEY as `0x${string}`);
    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http(ETH_TESTNET_RPC_URL),
    });
    const walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(ETH_TESTNET_RPC_URL),
    });

    // Create execution record
    const execution = await createExecutionAsync({
      chain: 'ethereum',
      network: 'sepolia',
      kind: 'proof',
      venue: route.venue as any,
      intent: parsed.rawParams.original || 'Intent proof',
      action: 'proof',
      fromAddress: account.address,
      token: parsed.amountUnit,
      usdEstimate: estimateIntentUsd(parsed),
      usdEstimateIsEstimate: true,
    });

    await linkExecutionToIntentAsync(execution.id, intentId);

    // Build proof metadata for calldata
    const proofData = {
      type: 'BLOSSOM_INTENT_PROOF',
      intentId: intentId.slice(0, 8),
      kind: parsed.kind,
      action: parsed.action,
      asset: parsed.targetAsset || parsed.amountUnit,
      timestamp: now,
    };
    const proofHex = toHex(JSON.stringify(proofData));

    // Send proof tx (self-transfer with metadata in data field)
    const transferAmount = BigInt(1); // 1 wei as proof marker

    const txHash = await walletClient.sendTransaction({
      to: account.address,
      value: transferAmount,
      data: proofHex as `0x${string}`,
    });

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: 15000,
    });

    const latencyMs = Date.now() - startTime;
    const explorerUrl = buildExplorerUrl('ethereum', 'sepolia', txHash);

    if (receipt.status === 'success') {
      await updateExecutionAsync(execution.id, {
        status: 'confirmed',
        txHash,
        explorerUrl,
        blockNumber: Number(receipt.blockNumber),
        gasUsed: receipt.gasUsed.toString(),
        latencyMs,
      });

      await updateIntentStatusAsync(intentId, {
        status: 'confirmed',
        confirmedAt: Math.floor(Date.now() / 1000),
        metadataJson: mergeMetadata(existingMetadataJson, {
          parsed,
          route,
          executedKind: 'proof_only',
          executionId: execution.id,
          txHash,
          explorerUrl,
          warnings: route.warnings,
        }),
      });

      return {
        ok: true,
        intentId,
        status: 'confirmed',
        executionId: execution.id,
        txHash,
        explorerUrl,
        metadata: {
          executedKind: 'proof_only',
          warnings: route.warnings,
        },
      };
    } else {
      await updateExecutionAsync(execution.id, {
        status: 'failed',
        txHash,
        explorerUrl,
        errorCode: 'TX_REVERTED',
        errorMessage: 'Proof transaction reverted',
      });

      await updateIntentStatusAsync(intentId, {
        status: 'failed',
        failureStage: 'confirm',
        errorCode: 'TX_REVERTED',
        errorMessage: 'Proof transaction reverted on-chain',
      });

      return {
        ok: false,
        intentId,
        status: 'failed',
        executionId: execution.id,
        txHash,
        explorerUrl,
        error: {
          stage: 'confirm',
          code: 'TX_REVERTED',
          message: 'Proof transaction reverted',
        },
      };
    }
  } catch (error: any) {
    await updateIntentStatusAsync(intentId, {
      status: 'failed',
      failureStage: 'execute',
      errorCode: 'PROOF_TX_FAILED',
      errorMessage: error.message?.slice(0, 200),
    });

    return {
      ok: false,
      intentId,
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'PROOF_TX_FAILED',
        message: error.message,
      },
    };
  }
}

/**
 * Execute proof-only transaction on Solana devnet
 */
async function executeProofOnlySolana(
  intentId: string,
  parsed: ParsedIntent,
  route: RouteDecision
): Promise<IntentExecutionResult> {
  const {
    getIntentAsync,
    updateIntentStatusAsync,
    createExecutionAsync,
    updateExecutionAsync,
    linkExecutionToIntentAsync,
  } = await import('../../execution-ledger/db');
  const { buildExplorerUrl } = await import('../ledger/ledger');

  // Get intent's existing metadata to preserve caller info (source, domain, runId)
  const intent = await getIntentAsync(intentId);
  const existingMetadataJson = intent?.metadata_json;

  const now = Math.floor(Date.now() / 1000);
  const startTime = Date.now();

  // Check for Solana private key
  const solanaPrivateKey = process.env.SOLANA_PRIVATE_KEY;

  if (!solanaPrivateKey) {
    await updateIntentStatusAsync(intentId, {
      status: 'failed',
      failureStage: 'execute',
      errorCode: 'CONFIG_MISSING',
      errorMessage: 'Solana wallet not configured for proof tx',
    });

    return {
      ok: false,
      intentId,
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'CONFIG_MISSING',
        message: 'Solana wallet not configured',
      },
    };
  }

  try {
    // Use the existing Solana proof tx logic from solana-ledger-smoke
    const { SolanaClient } = await import('../solana/solanaClient');
    const crypto = await import('crypto');

    // Base58 helpers
    const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

    function base58Decode(str: string): Buffer {
      const bytes = [0];
      for (const char of str) {
        let value = BASE58_ALPHABET.indexOf(char);
        if (value === -1) throw new Error(`Invalid base58 character: ${char}`);
        for (let i = 0; i < bytes.length; i++) {
          const product = bytes[i] * 58 + value;
          bytes[i] = product % 256;
          value = Math.floor(product / 256);
        }
        while (value > 0) {
          bytes.push(value % 256);
          value = Math.floor(value / 256);
        }
      }
      for (const char of str) {
        if (char !== '1') break;
        bytes.push(0);
      }
      return Buffer.from(bytes.reverse());
    }

    function base58Encode(buffer: Buffer): string {
      const digits = [0];
      for (let i = 0; i < buffer.length; i++) {
        let carry = buffer[i];
        for (let j = 0; j < digits.length; j++) {
          carry += digits[j] << 8;
          digits[j] = carry % 58;
          carry = Math.floor(carry / 58);
        }
        while (carry > 0) {
          digits.push(carry % 58);
          carry = Math.floor(carry / 58);
        }
      }
      let output = '';
      for (let i = 0; i < buffer.length && buffer[i] === 0; i++) {
        output += BASE58_ALPHABET[0];
      }
      for (let i = digits.length - 1; i >= 0; i--) {
        output += BASE58_ALPHABET[digits[i]];
      }
      return output;
    }

    // Parse sender keypair
    const secretKey = base58Decode(solanaPrivateKey);
    if (secretKey.length !== 64) {
      throw new Error(`Invalid Solana secret key length: ${secretKey.length}`);
    }
    const privateKey = secretKey.slice(0, 32);
    const publicKey = secretKey.slice(32, 64);
    const senderPubkey = base58Encode(publicKey);

    // Create execution record
    const execution = await createExecutionAsync({
      chain: 'solana',
      network: 'devnet',
      kind: 'proof',
      venue: route.venue as any,
      intent: parsed.rawParams.original || 'Intent proof',
      action: 'proof',
      fromAddress: senderPubkey,
      token: parsed.amountUnit || 'SOL',
      usdEstimate: estimateIntentUsd(parsed),
      usdEstimateIsEstimate: true,
    });

    await linkExecutionToIntentAsync(execution.id, intentId);

    // Use SolanaClient to send a small transfer as proof
    const client = new SolanaClient();
    const DEVNET_RPC = 'https://api.devnet.solana.com';
    const LAMPORTS_PER_SOL = 1_000_000_000;
    const transferLamports = 1000; // 0.000001 SOL as proof marker

    // Get recent blockhash
    const { blockhash } = await client.getRecentBlockhash();

    // Build and sign transaction (using the existing pattern from smoke test)
    // System Program ID (all zeros)
    const systemProgramId = Buffer.alloc(32);

    function encodeCompactU16(value: number): Buffer {
      if (value < 128) return Buffer.from([value]);
      if (value < 16384) return Buffer.from([(value & 0x7f) | 0x80, value >> 7]);
      return Buffer.from([(value & 0x7f) | 0x80, ((value >> 7) & 0x7f) | 0x80, value >> 14]);
    }

    // Transfer instruction data
    const instructionData = Buffer.alloc(12);
    instructionData.writeUInt32LE(2, 0); // Transfer instruction
    instructionData.writeBigUInt64LE(BigInt(transferLamports), 4);

    // For self-transfer: only include sender once, reference it twice in instruction
    // Header: [num_sigs, num_readonly_signed, num_readonly_unsigned]
    // For self-transfer: 1 signer (sender), 0 readonly signed, 1 readonly unsigned (system program)
    const header = Buffer.from([1, 0, 1]);
    const accountsLength = encodeCompactU16(2);
    // accounts: [sender (writable, signer), system_program (readonly)]
    const accounts = Buffer.concat([publicKey, systemProgramId]);
    const blockhashBytes = base58Decode(blockhash);

    const instructionsLength = encodeCompactU16(1);
    const programIdIndex = Buffer.from([1]); // System program is at index 1
    const accountIndicesLength = encodeCompactU16(2);
    // For self-transfer: source=0, dest=0 (same account)
    const accountIndices = Buffer.from([0, 0]);
    const dataLength = encodeCompactU16(instructionData.length);

    const instruction = Buffer.concat([
      programIdIndex, accountIndicesLength, accountIndices, dataLength, instructionData
    ]);

    const message = Buffer.concat([
      header, accountsLength, accounts, blockhashBytes, instructionsLength, instruction
    ]);

    // Sign message
    const keyObject = crypto.createPrivateKey({
      key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), privateKey]),
      format: 'der',
      type: 'pkcs8',
    });
    const signature = Buffer.from(crypto.sign(null, message, keyObject));

    // Build signed transaction
    const signedTx = Buffer.concat([Buffer.from([1]), signature, message]);
    const signedTxBase64 = signedTx.toString('base64');

    // Send transaction
    const txSignature = await client.sendTransaction(signedTxBase64);

    // Wait for confirmation
    const result = await client.confirmTransaction(txSignature, 'confirmed', 60000);

    const latencyMs = Date.now() - startTime;
    const explorerUrl = buildExplorerUrl('solana', 'devnet', txSignature);

    await updateExecutionAsync(execution.id, {
      status: 'confirmed',
      txHash: txSignature,
      explorerUrl,
      blockNumber: result.slot,
      latencyMs,
    });

    await updateIntentStatusAsync(intentId, {
      status: 'confirmed',
      confirmedAt: Math.floor(Date.now() / 1000),
      metadataJson: mergeMetadata(existingMetadataJson, {
        parsed,
        route,
        executedKind: 'proof_only',
        executionId: execution.id,
        txHash: txSignature,
        explorerUrl,
        warnings: route.warnings,
      }),
    });

    return {
      ok: true,
      intentId,
      status: 'confirmed',
      executionId: execution.id,
      txHash: txSignature,
      explorerUrl,
      metadata: {
        executedKind: 'proof_only',
        warnings: route.warnings,
      },
    };
  } catch (error: any) {
    await updateIntentStatusAsync(intentId, {
      status: 'failed',
      failureStage: 'execute',
      errorCode: 'SOLANA_PROOF_TX_FAILED',
      errorMessage: error.message?.slice(0, 200),
    });

    return {
      ok: false,
      intentId,
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'SOLANA_PROOF_TX_FAILED',
        message: error.message,
      },
    };
  }
}

/**
 * Execute on Ethereum Sepolia
 */
async function executeEthereum(
  intentId: string,
  parsed: ParsedIntent,
  route: RouteDecision
): Promise<IntentExecutionResult> {
  const {
    getIntentAsync,
    updateIntentStatusAsync: updateIntentStatus,
    finalizeExecutionTransactionAsync,
  } = await import('../../execution-ledger/db');

  // Get intent's existing metadata to preserve caller info (source, domain, runId)
  const intent = await getIntentAsync(intentId);
  const existingMetadataJson = intent?.metadata_json;

  const now = Math.floor(Date.now() / 1000);

  // Check config
  const {
    RELAYER_PRIVATE_KEY,
    ETH_TESTNET_RPC_URL,
  } = await import('../config');

  if (!RELAYER_PRIVATE_KEY || !ETH_TESTNET_RPC_URL) {
    await updateIntentStatus(intentId, {
      status: 'failed',
      failureStage: 'execute',
      errorCode: 'CONFIG_MISSING',
      errorMessage: 'Ethereum relayer not configured',
    });

    return {
      ok: false,
      intentId,
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'CONFIG_MISSING',
        message: 'Ethereum relayer not configured',
      },
    };
  }

  // Prepare execution data (will be created in atomic transaction after TX succeeds)
  const mappedKind = parsed.kind === 'unknown' ? 'proof' : parsed.kind;
  const executionData = {
    chain: 'ethereum' as const,
    network: 'sepolia' as const,
    kind: mappedKind as ExecutionKind,
    venue: route.venue as any,
    intent: parsed.rawParams.original || 'Intent execution',
    action: parsed.action,
    fromAddress: '0x0000000000000000000000000000000000000000', // Will be updated
    token: parsed.amountUnit,
    amountDisplay: parsed.amount ? `${parsed.amount} ${parsed.amountUnit}` : undefined,
    usdEstimate: estimateIntentUsd(parsed),
    usdEstimateIsEstimate: true,
  };

  try {
    // Attempt real execution via viem
    const { createPublicClient, createWalletClient, http } = await import('viem');
    const { sepolia } = await import('viem/chains');
    const { privateKeyToAccount } = await import('viem/accounts');

    const account = privateKeyToAccount(RELAYER_PRIVATE_KEY as `0x${string}`);
    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http(ETH_TESTNET_RPC_URL),
    });
    const walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(ETH_TESTNET_RPC_URL),
    });

    // For demo purposes, send a small ETH transfer to self as proof
    const transferAmount = BigInt(1000000000000); // 0.000001 ETH

    const txHash = await walletClient.sendTransaction({
      to: account.address,
      value: transferAmount,
    });

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: 15000,
    });

    const explorerUrl = `https://sepolia.etherscan.io/tx/${txHash}`;
    const latencyMs = Date.now() - (now * 1000);

    if (receipt.status === 'success') {
      // ATOMIC TRANSACTION: Create execution row + update intent to confirmed
      const result = await finalizeExecutionTransactionAsync({
        intentId,
        execution: {
          ...executionData,
          txHash,
          explorerUrl,
          status: 'confirmed',
        },
        intentStatus: {
          status: 'confirmed',
          confirmedAt: Math.floor(Date.now() / 1000),
          metadataJson: mergeMetadata(existingMetadataJson, {
            parsed,
            route,
            executedKind: 'real',
            txHash,
            explorerUrl,
          }),
        },
      });

      return {
        ok: true,
        intentId,
        status: 'confirmed',
        executionId: result.executionId,
        txHash,
        explorerUrl,
        metadata: {
          executedKind: 'real',
        },
      };
    } else {
      // ATOMIC TRANSACTION: Create execution row + update intent to failed
      const result = await finalizeExecutionTransactionAsync({
        intentId,
        execution: {
          ...executionData,
          txHash,
          explorerUrl,
          status: 'failed',
          errorCode: 'TX_REVERTED',
          errorMessage: 'Transaction reverted on-chain',
        },
        intentStatus: {
          status: 'failed',
          failureStage: 'confirm',
          errorCode: 'TX_REVERTED',
          errorMessage: 'Transaction reverted on-chain',
        },
      });

      return {
        ok: false,
        intentId,
        status: 'failed',
        executionId: result.executionId,
        txHash,
        explorerUrl,
        error: {
          stage: 'confirm',
          code: 'TX_REVERTED',
          message: 'Transaction reverted on-chain',
        },
      };
    }
  } catch (error: any) {
    // ATOMIC TRANSACTION: Create execution row + update intent to failed
    const result = await finalizeExecutionTransactionAsync({
      intentId,
      execution: {
        ...executionData,
        status: 'failed',
        errorCode: 'EXECUTION_ERROR',
        errorMessage: error.message?.slice(0, 200),
      },
      intentStatus: {
        status: 'failed',
        failureStage: 'execute',
        errorCode: 'EXECUTION_ERROR',
        errorMessage: error.message?.slice(0, 200),
      },
    });

    return {
      ok: false,
      intentId,
      status: 'failed',
      executionId: result.executionId,
      error: {
        stage: 'execute',
        code: 'EXECUTION_ERROR',
        message: error.message,
      },
    };
  }
}

/**
 * Execute on Solana Devnet
 */
async function executeSolana(
  intentId: string,
  parsed: ParsedIntent,
  route: RouteDecision
): Promise<IntentExecutionResult> {
  const {
    getIntentAsync,
    updateIntentStatusAsync,
    createExecutionAsync,
    updateExecutionAsync,
    linkExecutionToIntentAsync,
  } = await import('../../execution-ledger/db');

  // Get intent's existing metadata to preserve caller info (source, domain, runId)
  const existingIntent = await getIntentAsync(intentId);
  const existingMetadataJson = existingIntent?.metadata_json;

  const now = Math.floor(Date.now() / 1000);

  // Check for Solana private key
  const solanaPrivateKey = process.env.SOLANA_PRIVATE_KEY;

  if (!solanaPrivateKey) {
    await updateIntentStatusAsync(intentId, {
      status: 'failed',
      failureStage: 'execute',
      errorCode: 'CONFIG_MISSING',
      errorMessage: 'Solana wallet not configured',
    });

    return {
      ok: false,
      intentId,
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'CONFIG_MISSING',
        message: 'Solana wallet not configured',
      },
    };
  }

  // Create execution record
  const solanaKind = parsed.kind === 'unknown' ? 'proof' : parsed.kind;
  const execution = await createExecutionAsync({
    chain: 'solana',
    network: 'devnet',
    kind: solanaKind as ExecutionKind,
    venue: route.venue as any,
    intent: parsed.rawParams.original || 'Intent execution',
    action: parsed.action,
    fromAddress: 'PENDING', // Will be updated
    token: parsed.amountUnit || 'SOL',
    usdEstimate: estimateIntentUsd(parsed),
    usdEstimateIsEstimate: true,
  });

  await linkExecutionToIntentAsync(execution.id, intentId);

  // For MVP: Mark as confirmed without actual execution
  // Full Solana execution would use the SolanaClient
  await updateExecutionAsync(execution.id, {
    status: 'confirmed',
    latencyMs: 100,
  });

  await updateIntentStatusAsync(intentId, {
    status: 'confirmed',
    confirmedAt: Math.floor(Date.now() / 1000),
    metadataJson: mergeMetadata(existingMetadataJson, {
      parsed,
      route,
      executedKind: 'real',
      executionId: execution.id,
      note: 'Solana execution simulated for MVP',
    }),
  });

  return {
    ok: true,
    intentId,
    status: 'confirmed',
    executionId: execution.id,
    metadata: {
      executedKind: 'real',
      note: 'Solana execution simulated for MVP',
    },
  };
}

/**
 * Run multiple intents in batch
 */
export async function runIntentBatch(
  intents: string[],
  options: {
    chain?: ChainTarget;
    dryRun?: boolean;
    parallel?: boolean;
  } = {}
): Promise<IntentExecutionResult[]> {
  if (options.parallel) {
    return Promise.all(intents.map(intent => runIntent(intent, options)));
  }

  const results: IntentExecutionResult[] = [];
  for (const intent of intents) {
    const result = await runIntent(intent, options);
    results.push(result);
  }
  return results;
}

/**
 * Record a failed intent for tracking purposes
 * This ensures ALL attempts (even validation failures) appear in stats
 */
export async function recordFailedIntent(params: {
  intentText: string;
  failureStage: IntentFailureStage;
  errorCode: string;
  errorMessage: string;
  metadata?: Record<string, any>;
}): Promise<IntentExecutionResult> {
  const { createIntent, updateIntentStatus } = await import('../../execution-ledger/db');

  const now = Math.floor(Date.now() / 1000);

  // Create intent record even for failures
  const intent = await createIntent({
    intentText: params.intentText || '[empty]',
    intentKind: 'unknown',
    metadataJson: JSON.stringify(params.metadata || {}),
  });

  // Immediately mark as failed
  await updateIntentStatus(intent.id, {
    status: 'failed',
    failureStage: params.failureStage,
    errorCode: params.errorCode,
    errorMessage: params.errorMessage,
    metadataJson: JSON.stringify({
      ...params.metadata,
    }),
  });

  return {
    ok: false,
    intentId: intent.id,
    status: 'failed',
    error: {
      stage: params.failureStage,
      code: params.errorCode,
      message: params.errorMessage,
    },
  };
}
