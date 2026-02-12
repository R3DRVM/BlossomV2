import { formatUnits } from 'viem';
import {
  CROSS_CHAIN_CREDIT_MAX_USD_PER_TX,
  CROSS_CHAIN_CREDIT_ROUTING_ENABLED,
  DEMO_BUSDC_ADDRESS,
  DEMO_REDACTED_ADDRESS,
} from '../config';
import { erc20_balanceOfWithMeta } from '../executors/erc20Rpc';
import { createFailoverPublicClient } from '../providers/rpcProvider';
import { mintBusdc } from '../utils/demoTokenMinter';
import { createCrossChainCreditAsync, getCrossChainCreditsByStatusAsync, updateCrossChainCreditAsync } from '../../execution-ledger/db';

type CrossChainRouteCode =
  | 'CROSS_CHAIN_ROUTE_DISABLED'
  | 'CROSS_CHAIN_ROUTE_MISSING_ADDRESS'
  | 'CROSS_CHAIN_ROUTE_UNSUPPORTED'
  | 'CROSS_CHAIN_ROUTE_INSUFFICIENT_FUNDS'
  | 'CROSS_CHAIN_ROUTE_MINT_FAILED'
  | 'CROSS_CHAIN_ROUTE_PENDING'
  | 'CROSS_CHAIN_ROUTE_READ_FAILED'
  | 'CROSS_CHAIN_ROUTE_FAILED';

type StableSymbol = 'bUSDC';

type RouteStableCreditParams = {
  userId?: string;
  sessionId?: string;
  fromChain: string;
  toChain: string;
  userSolanaAddress?: string;
  userEvmAddress?: string;
  amountUsd: number;
  stableSymbol: StableSymbol;
};

type RouteStableCreditOk = {
  ok: true;
  routeType: 'testnet_credit';
  creditedAmountUsd: number;
  fromReceiptId: string;
  toTxHash?: string;
  creditStatus?: 'credit_submitted' | 'credited';
  toChain: 'sepolia';
};

type RouteStableCreditFail = {
  ok: false;
  code: CrossChainRouteCode;
  message: string;
};

export type RouteStableCreditResult = RouteStableCreditOk | RouteStableCreditFail;

export type ExecutionRouteMeta = {
  didRoute: boolean;
  routeType?: 'testnet_credit';
  fromChain?: string;
  toChain?: string;
  reason: string;
  receiptId?: string;
  txHash?: string;
  creditedAmountUsd?: number;
  debug?: {
    rpcUsed?: string;
    attempts?: number;
    lastError?: string;
  };
};

export type EnsureExecutionFundingParams = {
  userId?: string;
  sessionId?: string;
  userEvmAddress: string;
  userSolanaAddress?: string;
  fromChain?: string;
  toChain?: string;
  amountUsdRequired?: number;
  spendEstimateUnits?: bigint;
  instrumentType?: 'swap' | 'perp' | 'defi' | 'event';
  forceRoute?: boolean;
};

export type EnsureExecutionFundingResult =
  | { ok: true; route: ExecutionRouteMeta }
  | { ok: false; code: CrossChainRouteCode; userMessage: string; route?: ExecutionRouteMeta };

const STABLE_DECIMALS = 6;
const CREDIT_FINALIZER_MAX_BATCH = 10;
const CREDIT_FINALIZER_INTERVAL_MS = 20_000;

function normalizeChainLabel(chain: string | undefined): string {
  const value = String(chain || '').trim().toLowerCase();
  if (!value) return '';
  if (value.includes('sol')) return 'solana_devnet';
  if (value.includes('sep') || value.includes('eth')) return 'sepolia';
  return value;
}

function safeJsonParse(input: string | null | undefined): any {
  if (!input) return null;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function getStableAddress(): `0x${string}` | null {
  const stable = DEMO_BUSDC_ADDRESS || DEMO_REDACTED_ADDRESS;
  if (!stable || !/^0x[a-fA-F0-9]{40}$/.test(stable)) {
    return null;
  }
  return stable as `0x${string}`;
}

function clampUsd(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }
  return Math.min(amount, CROSS_CHAIN_CREDIT_MAX_USD_PER_TX);
}

function deriveRequiredUsd(params: EnsureExecutionFundingParams): number {
  if (Number.isFinite(params.amountUsdRequired) && (params.amountUsdRequired as number) > 0) {
    return clampUsd(params.amountUsdRequired as number);
  }

  const instrumentType = params.instrumentType;
  if (
    params.spendEstimateUnits !== undefined &&
    (instrumentType === 'perp' || instrumentType === 'defi' || instrumentType === 'event')
  ) {
    const asUsd = Number(formatUnits(params.spendEstimateUnits, STABLE_DECIMALS));
    if (Number.isFinite(asUsd) && asUsd > 0) {
      return clampUsd(asUsd);
    }
  }

  return 0;
}

async function getSolanaBalanceForRouting(
  solanaAddress: string,
  requiredUsd: number
): Promise<{ balanceUsd: number; source: 'onchain' | 'fallback'; error?: string }> {
  // Deterministic beta mode: avoid heavy Solana client imports in production serverless.
  // Cross-chain credit routing is a testnet abstraction; we only need to prove Sepolia funding + execution.
  const allowOnchainRead =
    process.env.CROSS_CHAIN_SOLANA_ONCHAIN_READ === 'true' && process.env.VERCEL !== '1';

  if (!allowOnchainRead) {
    const fallbackFloor = parseFloat(process.env.CROSS_CHAIN_SOLANA_FALLBACK_USD || '250');
    const fallbackUsd = Math.max(requiredUsd, Number.isFinite(fallbackFloor) ? fallbackFloor : 250);
    return { balanceUsd: fallbackUsd, source: 'fallback' };
  }

  try {
    const { getSolanaBalance } = await import('../utils/solanaBusdcMinter');
    const balanceUsd = await getSolanaBalance(solanaAddress);
    return {
      balanceUsd: Number.isFinite(balanceUsd) ? balanceUsd : 0,
      source: 'onchain',
    };
  } catch (error: any) {
    const fallbackFloor = parseFloat(process.env.CROSS_CHAIN_SOLANA_FALLBACK_USD || '250');
    const fallbackUsd = Math.max(requiredUsd, Number.isFinite(fallbackFloor) ? fallbackFloor : 250);
    return {
      balanceUsd: fallbackUsd,
      source: 'fallback',
      error: error?.message || 'failed_to_read_solana_balance',
    };
  }
}

async function getSepoliaStableBalanceUsdWithMeta(
  address: string
): Promise<{ balanceUsd: number; debug: { rpcUsed?: string; attempts?: number; lastError?: string } }> {
  const stableAddress = getStableAddress();
  if (!stableAddress) {
    throw new Error('Missing stable token address (DEMO_BUSDC_ADDRESS/DEMO_REDACTED_ADDRESS)');
  }

  const { balance: raw, meta } = await erc20_balanceOfWithMeta(stableAddress, address, {
    retries: 5,
    timeoutMs: parseInt(process.env.CROSS_CHAIN_READ_TIMEOUT_MS || '12000', 10),
    retryBackoffMs: 350,
  });

  const formatted = Number(formatUnits(raw, STABLE_DECIMALS));
  return {
    balanceUsd: Number.isFinite(formatted) ? formatted : 0,
    debug: {
      rpcUsed: meta.rpcUsed,
      attempts: meta.attempts,
      ...(meta.lastError ? { lastError: meta.lastError } : {}),
    },
  };
}

async function confirmSepoliaTxReceipt(
  txHash: string,
  options?: { timeoutMs?: number }
): Promise<{ confirmed: boolean; success?: boolean; blockNumber?: number; error?: string }> {
  if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return { confirmed: false, error: 'invalid_tx_hash' };
  }
  try {
    const client = createFailoverPublicClient();
    const timeoutMs = options?.timeoutMs ?? parseInt(process.env.CROSS_CHAIN_MINT_RECEIPT_TIMEOUT_MS || '18000', 10);
    const receipt = await client.waitForTransactionReceipt({
      hash: txHash as `0x${string}`,
      timeout: timeoutMs,
    });
    return {
      confirmed: true,
      success: receipt?.status === 'success',
      blockNumber: receipt?.blockNumber ? Number(receipt.blockNumber) : undefined,
    };
  } catch (error: any) {
    const msg = error?.message || String(error);
    // Treat timeouts / not found as "pending".
    if (msg.toLowerCase().includes('timed out') || msg.toLowerCase().includes('not found')) {
      return { confirmed: false, error: msg };
    }
    return { confirmed: false, error: msg };
  }
}

async function finalizeCreditRecordIfConfirmed(
  creditId: string,
  metaJson: string | null | undefined,
  txHash: string
): Promise<{ status: 'credit_submitted' | 'credited' | 'failed'; error?: string }> {
  const receipt = await confirmSepoliaTxReceipt(txHash, {
    timeoutMs: parseInt(process.env.CROSS_CHAIN_MINT_RECEIPT_TIMEOUT_MS || '18000', 10),
  });

  if (!receipt.confirmed) {
    return { status: 'credit_submitted', ...(receipt.error ? { error: receipt.error } : {}) };
  }

  const mergedMeta = {
    ...(safeJsonParse(metaJson) || {}),
    routeType: 'testnet_credit',
    toTxHash: txHash,
    receipt: {
      status: receipt.success ? 'success' : 'reverted',
      ...(receipt.blockNumber !== undefined ? { blockNumber: receipt.blockNumber } : {}),
      confirmedAt: Date.now(),
    },
  };

  if (receipt.success) {
    await updateCrossChainCreditAsync(creditId, {
      status: 'credited',
      metaJson: JSON.stringify(mergedMeta),
    });
    return { status: 'credited' };
  }

  await updateCrossChainCreditAsync(creditId, {
    status: 'failed',
    errorCode: 'CROSS_CHAIN_ROUTE_MINT_FAILED',
    metaJson: JSON.stringify(mergedMeta),
  });
  return { status: 'failed', error: 'credit_mint_reverted' };
}

export async function routeStableCreditForExecution(
  params: RouteStableCreditParams
): Promise<RouteStableCreditResult> {
  if (!CROSS_CHAIN_CREDIT_ROUTING_ENABLED) {
    return {
      ok: false,
      code: 'CROSS_CHAIN_ROUTE_DISABLED',
      message: 'Cross-chain credit routing is disabled.',
    };
  }

  const fromChain = normalizeChainLabel(params.fromChain);
  const toChain = normalizeChainLabel(params.toChain);
  const amountUsd = clampUsd(params.amountUsd);
  const userSolanaAddress = params.userSolanaAddress?.trim();
  const userEvmAddress = params.userEvmAddress?.trim().toLowerCase();

  if (!userEvmAddress) {
    return {
      ok: false,
      code: 'CROSS_CHAIN_ROUTE_MISSING_ADDRESS',
      message: 'Missing EVM address for Sepolia credit routing.',
    };
  }

  if (fromChain !== 'solana_devnet' || toChain !== 'sepolia') {
    return {
      ok: false,
      code: 'CROSS_CHAIN_ROUTE_UNSUPPORTED',
      message: `Unsupported cross-chain route ${fromChain || 'unknown'} -> ${toChain || 'unknown'}`,
    };
  }

  if (!userSolanaAddress) {
    return {
      ok: false,
      code: 'CROSS_CHAIN_ROUTE_MISSING_ADDRESS',
      message: 'Missing Solana address for Solana -> Sepolia credit routing.',
    };
  }

  if (amountUsd <= 0) {
    return {
      ok: false,
      code: 'CROSS_CHAIN_ROUTE_FAILED',
      message: 'Requested routing amount must be greater than zero.',
    };
  }

  // Idempotency for retries: if we've already submitted a credit mint for this session/address/amount,
  // return the existing receipt instead of submitting another mint.
  if (params.sessionId) {
    try {
      const recent = await getCrossChainCreditsByStatusAsync(['credit_submitted'], 50);
      const match = recent.find((row: any) => {
        const rowSession = String(row.session_id || '').trim();
        const rowTo = String(row.to_address || '').trim().toLowerCase();
        const rowFromChain = normalizeChainLabel(String(row.from_chain || ''));
        const rowToChain = normalizeChainLabel(String(row.to_chain || ''));
        const rowStable = String(row.stable_symbol || '').trim().toLowerCase();
        const rowAmount = Number(row.amount_usd || 0);
        return (
          rowSession === String(params.sessionId) &&
          rowTo === userEvmAddress &&
          rowFromChain === fromChain &&
          rowToChain === toChain &&
          rowStable === params.stableSymbol.toLowerCase() &&
          Math.abs(rowAmount - amountUsd) < 0.01
        );
      });
      if (match) {
        const meta = safeJsonParse(String(match.meta_json || '')) || {};
        const existingTx = String(meta.toTxHash || '');
        if (existingTx) {
          return {
            ok: true,
            routeType: 'testnet_credit',
            creditedAmountUsd: amountUsd,
            fromReceiptId: String(match.id),
            toTxHash: existingTx,
            creditStatus: 'credit_submitted',
            toChain: 'sepolia',
          };
        }
      }
    } catch {
      // ignore idempotency failures; best-effort only
    }
  }

  // Demo stable abstraction:
  // We do not rely on Solana DEX liquidity for devnet. We record the Solana-side
  // consumption and mint deterministic bUSDC on Sepolia for execution continuity.
  const record = await createCrossChainCreditAsync({
    userId: params.userId,
    sessionId: params.sessionId,
    fromChain,
    toChain,
    amountUsd,
    stableSymbol: params.stableSymbol,
    fromAddress: userSolanaAddress,
    toAddress: userEvmAddress,
    status: 'created',
    metaJson: JSON.stringify({
      routeType: 'testnet_credit',
      note: 'demo_stable_abstraction',
    }),
  });

  try {
    // Submit mint tx as a deterministic routing receipt.
    // IMPORTANT: do not mark record as credited until receipt status=success.
    const mint = await mintBusdc(userEvmAddress, amountUsd, {
      waitForReceipt: false,
    });
    await updateCrossChainCreditAsync(record.id, {
      status: 'credit_submitted',
      metaJson: JSON.stringify({
        routeType: 'testnet_credit',
        toTxHash: mint.txHash,
        creditedAmountUsd: amountUsd,
        submittedAt: Date.now(),
      }),
    });

    return {
      ok: true,
      routeType: 'testnet_credit',
      creditedAmountUsd: amountUsd,
      fromReceiptId: record.id,
      toTxHash: mint.txHash,
      creditStatus: 'credit_submitted',
      toChain: 'sepolia',
    };
  } catch (error: any) {
    await updateCrossChainCreditAsync(record.id, {
      status: 'failed',
      errorCode: 'CROSS_CHAIN_ROUTE_MINT_FAILED',
      metaJson: JSON.stringify({
        routeType: 'testnet_credit',
        message: error?.message || 'Unknown mint error',
      }),
    });
    return {
      ok: false,
      code: 'CROSS_CHAIN_ROUTE_MINT_FAILED',
      message: error?.message || 'Failed to credit Sepolia bUSDC',
    };
  }
}

export async function ensureExecutionFunding(
  params: EnsureExecutionFundingParams
): Promise<EnsureExecutionFundingResult> {
  const toChain = normalizeChainLabel(params.toChain || 'sepolia');
  const fromChain = normalizeChainLabel(params.fromChain) || (params.userSolanaAddress ? 'solana_devnet' : 'sepolia');
  const requiredUsd = deriveRequiredUsd(params);

  if (toChain !== 'sepolia') {
    return {
      ok: false,
      code: 'CROSS_CHAIN_ROUTE_UNSUPPORTED',
      userMessage: "Couldn't route bUSDC to the selected venue yet. Try Ethereum Sepolia for this beta flow.",
    };
  }

  if (requiredUsd <= 0) {
    return {
      ok: true,
      route: {
        didRoute: false,
        fromChain,
        toChain,
        reason: 'No additional bUSDC routing required for this execution.',
      },
    };
  }

  let targetBalanceUsd = 0;
  let initialReadDebug: { rpcUsed?: string; attempts?: number; lastError?: string } | undefined;
  try {
    const read = await getSepoliaStableBalanceUsdWithMeta(params.userEvmAddress);
    targetBalanceUsd = read.balanceUsd;
    initialReadDebug = read.debug;
  } catch (error: any) {
    return {
      ok: false,
      code: 'CROSS_CHAIN_ROUTE_READ_FAILED',
      userMessage: "Couldn't verify Sepolia bUSDC balance right now. Please retry in a moment.",
      route: {
        didRoute: false,
        fromChain,
        toChain,
        reason: 'Failed to read Sepolia stable balance before routing.',
        debug: {
          rpcUsed: error?.rpcUsed,
          attempts: Number.isFinite(error?.attempts) ? Number(error.attempts) : undefined,
          lastError: error?.lastError || error?.message || 'unknown error',
        },
      },
    };
  }

  if (!params.forceRoute && targetBalanceUsd >= requiredUsd) {
    return {
      ok: true,
      route: {
        didRoute: false,
        fromChain,
        toChain,
        reason: 'Execution already funded with bUSDC on Ethereum Sepolia.',
      },
    };
  }

  if (fromChain !== 'solana_devnet') {
    return {
      ok: false,
      code: 'CROSS_CHAIN_ROUTE_UNSUPPORTED',
      userMessage: "Couldn't route bUSDC from this source chain yet. Try minting bUSDC on Sepolia or reconnect your wallet.",
      route: {
        didRoute: false,
        fromChain,
        toChain,
        reason: 'Unsupported source chain for deterministic testnet credit routing.',
      },
    };
  }

  if (!params.userSolanaAddress) {
    return {
      ok: false,
      code: 'CROSS_CHAIN_ROUTE_MISSING_ADDRESS',
      userMessage: "Couldn't route bUSDC from Solana to Sepolia right now. Reconnect your Solana wallet and retry.",
      route: {
        didRoute: false,
        fromChain,
        toChain,
        reason: 'Missing Solana wallet address for credit routing.',
      },
    };
  }

  const solanaBalanceRead = await getSolanaBalanceForRouting(params.userSolanaAddress, requiredUsd);
  const solanaBalanceUsd = solanaBalanceRead.balanceUsd;

  if (solanaBalanceUsd <= 0) {
    return {
      ok: false,
      code: 'CROSS_CHAIN_ROUTE_INSUFFICIENT_FUNDS',
      userMessage: "Couldn't route bUSDC from Solana -> Sepolia right now. Mint bUSDC on Solana or Sepolia and retry.",
      route: {
        didRoute: false,
        fromChain,
        toChain,
        reason: 'No Solana bUSDC balance available to route.',
        ...(solanaBalanceRead.error
          ? {
              debug: {
                lastError: solanaBalanceRead.error,
              },
            }
          : {}),
      },
    };
  }

  const deficitUsd = Math.max(requiredUsd - targetBalanceUsd, 0);
  const desiredRouteUsd = params.forceRoute ? requiredUsd : deficitUsd;
  const routeAmountUsd = clampUsd(Math.min(desiredRouteUsd, solanaBalanceUsd));
  const routeResult = await routeStableCreditForExecution({
    userId: params.userId,
    sessionId: params.sessionId,
    fromChain,
    toChain,
    userSolanaAddress: params.userSolanaAddress,
    userEvmAddress: params.userEvmAddress,
    amountUsd: routeAmountUsd,
    stableSymbol: 'bUSDC',
  });

  if (!routeResult.ok) {
    return {
      ok: false,
      code: routeResult.code,
      userMessage: "Couldn't route bUSDC from Solana -> Sepolia right now. Try minting bUSDC on Sepolia or reconnect your wallet.",
      route: {
        didRoute: false,
        fromChain,
        toChain,
        reason: routeResult.message,
        ...(solanaBalanceRead.error
          ? {
              debug: {
                lastError: solanaBalanceRead.error,
              },
            }
          : {}),
      },
    };
  }

  // Gate execution on confirmed credit mint receipt, otherwise fail closed (no proof-only).
  if (routeResult.toTxHash) {
    const finalized = await finalizeCreditRecordIfConfirmed(
      routeResult.fromReceiptId,
      JSON.stringify({
        routeType: routeResult.routeType,
        toTxHash: routeResult.toTxHash,
        creditedAmountUsd: routeResult.creditedAmountUsd,
        submittedAt: Date.now(),
      }),
      routeResult.toTxHash
    );
    if (finalized.status === 'credit_submitted') {
      return {
        ok: false,
        code: 'CROSS_CHAIN_ROUTE_PENDING',
        userMessage: 'Routing bUSDC is still confirming on Sepolia. Please retry in a few seconds.',
        route: {
          didRoute: true,
          routeType: routeResult.routeType,
          fromChain,
          toChain,
          reason: 'Cross-chain credit mint submitted; awaiting confirmation.',
          receiptId: routeResult.fromReceiptId,
          txHash: routeResult.toTxHash,
          creditedAmountUsd: routeResult.creditedAmountUsd,
          debug: {
            ...(initialReadDebug || {}),
          },
        },
      };
    }
    if (finalized.status === 'failed') {
      return {
        ok: false,
        code: 'CROSS_CHAIN_ROUTE_MINT_FAILED',
        userMessage: "Couldn't route bUSDC from Solana -> Sepolia right now. The credit mint reverted.",
        route: {
          didRoute: true,
          routeType: routeResult.routeType,
          fromChain,
          toChain,
          reason: 'Cross-chain credit mint failed.',
          receiptId: routeResult.fromReceiptId,
          txHash: routeResult.toTxHash,
          creditedAmountUsd: routeResult.creditedAmountUsd,
        },
      };
    }
  }

  // Re-check balance after confirmed credit to avoid racing downstream execution.
  try {
    const postRead = await getSepoliaStableBalanceUsdWithMeta(params.userEvmAddress);
    if (postRead.balanceUsd < requiredUsd) {
      return {
        ok: false,
        code: 'CROSS_CHAIN_ROUTE_INSUFFICIENT_FUNDS',
        userMessage: "Couldn't verify routed bUSDC on Sepolia yet. Please retry in a moment.",
        route: {
          didRoute: true,
          routeType: routeResult.routeType,
          fromChain,
          toChain,
          reason: 'Sepolia stable balance still below required amount after routing confirmation.',
          receiptId: routeResult.fromReceiptId,
          txHash: routeResult.toTxHash,
          creditedAmountUsd: routeResult.creditedAmountUsd,
          debug: postRead.debug,
        },
      };
    }
  } catch (error: any) {
    return {
      ok: false,
      code: 'CROSS_CHAIN_ROUTE_READ_FAILED',
      userMessage: "Couldn't verify routed bUSDC on Sepolia yet. Please retry in a moment.",
      route: {
        didRoute: true,
        routeType: routeResult.routeType,
        fromChain,
        toChain,
        reason: 'Failed to re-read Sepolia stable balance after routing.',
        receiptId: routeResult.fromReceiptId,
        txHash: routeResult.toTxHash,
        creditedAmountUsd: routeResult.creditedAmountUsd,
        debug: {
          lastError: error?.lastError || error?.message || 'unknown error',
        },
      },
    };
  }

  return {
    ok: true,
    route: {
      didRoute: true,
      routeType: routeResult.routeType,
      fromChain,
      toChain,
      reason:
        'Routed bUSDC from Solana devnet to Ethereum Sepolia for reliable perp execution and deeper testnet liquidity.',
      receiptId: routeResult.fromReceiptId,
      txHash: routeResult.toTxHash,
      creditedAmountUsd: routeResult.creditedAmountUsd,
      debug: {
        ...(initialReadDebug || {}),
        ...(solanaBalanceRead.source === 'fallback' ? { lastError: solanaBalanceRead.error || 'solana_balance_fallback' } : {}),
      },
    },
  };
}

let creditFinalizerStarted = false;

async function finalizeSubmittedCreditsOnce(): Promise<void> {
  const credits = await getCrossChainCreditsByStatusAsync(['credit_submitted'], CREDIT_FINALIZER_MAX_BATCH);
  if (!credits.length) return;

  for (const credit of credits) {
    const meta = safeJsonParse((credit as any).meta_json || (credit as any).metaJson);
    const txHash = String(meta?.toTxHash || meta?.txHash || '');
    if (!txHash) continue;
    try {
      const client = createFailoverPublicClient();
      const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
      const mergedMeta = {
        ...(meta || {}),
        routeType: 'testnet_credit',
        toTxHash: txHash,
        receipt: {
          status: receipt?.status === 'success' ? 'success' : 'reverted',
          blockNumber: receipt?.blockNumber ? Number(receipt.blockNumber) : undefined,
          confirmedAt: Date.now(),
        },
      };
      if (receipt?.status === 'success') {
        await updateCrossChainCreditAsync(String((credit as any).id), {
          status: 'credited',
          metaJson: JSON.stringify(mergedMeta),
        });
      } else {
        await updateCrossChainCreditAsync(String((credit as any).id), {
          status: 'failed',
          errorCode: 'CROSS_CHAIN_ROUTE_MINT_FAILED',
          metaJson: JSON.stringify(mergedMeta),
        });
      }
    } catch {
      // Receipt not available yet or RPC issue; best-effort finalizer.
    }
  }
}

export function startCrossChainCreditFinalizer(): void {
  if (creditFinalizerStarted) return;
  creditFinalizerStarted = true;

  // Best-effort background polling. On serverless, this only runs on warm instances.
  try {
    const timer = setInterval(() => {
      void finalizeSubmittedCreditsOnce();
    }, CREDIT_FINALIZER_INTERVAL_MS);
    (timer as any).unref?.();
  } catch {
    // ignore
  }
}
