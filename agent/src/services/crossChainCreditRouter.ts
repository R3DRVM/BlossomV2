import { formatUnits } from 'viem';
import {
  CROSS_CHAIN_CREDIT_MAX_USD_PER_TX,
  CROSS_CHAIN_CREDIT_ROUTING_ENABLED,
  DEMO_BUSDC_ADDRESS,
  DEMO_REDACTED_ADDRESS,
} from '../config';
import { erc20_balanceOfWithMeta } from '../executors/erc20Rpc';
import { mintBusdc } from '../utils/demoTokenMinter';
import { createCrossChainCreditAsync, updateCrossChainCreditAsync } from '../../execution-ledger/db';

type CrossChainRouteCode =
  | 'CROSS_CHAIN_ROUTE_DISABLED'
  | 'CROSS_CHAIN_ROUTE_MISSING_ADDRESS'
  | 'CROSS_CHAIN_ROUTE_UNSUPPORTED'
  | 'CROSS_CHAIN_ROUTE_INSUFFICIENT_FUNDS'
  | 'CROSS_CHAIN_ROUTE_MINT_FAILED'
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

function normalizeChainLabel(chain: string | undefined): string {
  const value = String(chain || '').trim().toLowerCase();
  if (!value) return '';
  if (value.includes('sol')) return 'solana_devnet';
  if (value.includes('sep') || value.includes('eth')) return 'sepolia';
  return value;
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
    // Do not block on confirmation in serverless (maxDuration 30s). The stress runner / UI can
    // confirm the downstream execution tx receipt separately.
    const mint = await mintBusdc(userEvmAddress, amountUsd, {
      waitForReceipt: false,
    });
    await updateCrossChainCreditAsync(record.id, {
      status: 'credited',
      metaJson: JSON.stringify({
        routeType: 'testnet_credit',
        toTxHash: mint.txHash,
        creditedAmountUsd: amountUsd,
      }),
    });

    return {
      ok: true,
      routeType: 'testnet_credit',
      creditedAmountUsd: amountUsd,
      fromReceiptId: record.id,
      toTxHash: mint.txHash,
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
