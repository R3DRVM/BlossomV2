import {
  ETH_TESTNET_RPC_URL,
  RELAYER_PRIVATE_KEY,
  RELAYER_TOPUP_ENABLED,
  FUNDING_WALLET_PRIVATE_KEY_SEPOLIA,
  MIN_RELAYER_ETH_SEPOLIA,
  TARGET_RELAYER_ETH_SEPOLIA,
  MAX_TOPUPS_PER_HOUR,
  MAX_TOPUP_ETH_PER_DAY,
} from '../config';
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

export type RelayerChain = 'sepolia';

type TopupEvent = {
  at: number;
  ethAmount: number;
};

type TopupResult = {
  attempted: boolean;
  toppedUp: boolean;
  txHash?: string;
  reason?: string;
  error?: string;
};

type RelayerStatus = {
  ok: boolean;
  chain: 'sepolia';
  relayer: {
    address: string;
    balanceEth: string;
    balanceWei: string;
    minEth: number;
    targetEth: number;
    okToExecute: boolean;
    lastError?: string;
    lastTopUpAt?: number;
  };
  funding: {
    enabled: boolean;
    fundingAddress?: string;
    fundingBalanceEth?: string;
    caps: {
      maxTopupsPerHour: number;
      maxTopupEthPerDay: number;
    };
    stats: {
      topupsLastHour: number;
      topupEthToday: number;
    };
  };
};

const HOUR_MS = 60 * 60 * 1000;
let topupEvents: TopupEvent[] = [];
let dailyKey = getUtcDayKey();
let topupEthToday = 0;
let lastTopUpAt: number | undefined;
let lastError: string | undefined;
let topupInFlight: Promise<TopupResult> | null = null;
let serviceStarted = false;

function getUtcDayKey() {
  return new Date().toISOString().slice(0, 10);
}

function resetDailyIfNeeded() {
  const nowKey = getUtcDayKey();
  if (nowKey !== dailyKey) {
    dailyKey = nowKey;
    topupEthToday = 0;
  }
}

function trimOldEvents(now = Date.now()) {
  topupEvents = topupEvents.filter((evt) => now - evt.at <= HOUR_MS);
}

function getStats(now = Date.now()) {
  resetDailyIfNeeded();
  trimOldEvents(now);
  return {
    topupsLastHour: topupEvents.length,
    topupEthToday,
  };
}

function getPublicClient() {
  if (!ETH_TESTNET_RPC_URL) {
    throw new Error('ETH_TESTNET_RPC_URL not configured');
  }
  return createPublicClient({
    chain: sepolia,
    transport: http(ETH_TESTNET_RPC_URL),
  });
}

function parsePrivateKey(key: string | undefined): `0x${string}` {
  if (!key) {
    throw new Error('Missing private key');
  }
  return (key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`;
}

function classifyTopupError(error: any): string {
  const message = String(error?.message || error || '').toLowerCase();
  if (message.includes('insufficient')) return 'relayer_topup_failed:insufficient_funding';
  if (message.includes('rate') || message.includes('429')) return 'relayer_topup_failed:rpc_rate_limit';
  if (message.includes('nonce') || message.includes('already known')) return 'relayer_topup_failed:nonce_collision';
  return 'relayer_topup_failed:unknown';
}

function clampTopupAmountWei(balanceWei: bigint): bigint {
  const minWei = parseEther(String(MIN_RELAYER_ETH_SEPOLIA));
  const targetWei = parseEther(String(TARGET_RELAYER_ETH_SEPOLIA));

  if (balanceWei >= minWei || targetWei <= balanceWei) {
    return 0n;
  }

  const requested = targetWei - balanceWei;
  const remainingEthCap = Math.max(0, MAX_TOPUP_ETH_PER_DAY - topupEthToday);
  const remainingWeiCap = parseEther(remainingEthCap.toFixed(18));
  if (remainingWeiCap <= 0n) {
    return 0n;
  }

  return requested > remainingWeiCap ? remainingWeiCap : requested;
}

async function runTopupAttempt(chain: RelayerChain, reason = 'manual'): Promise<TopupResult> {
  if (chain !== 'sepolia') {
    return {
      attempted: false,
      toppedUp: false,
      reason: `unsupported_chain:${chain}`,
    };
  }

  if (!RELAYER_TOPUP_ENABLED) {
    return {
      attempted: false,
      toppedUp: false,
      reason: 'topup_disabled',
    };
  }

  try {
    const publicClient = getPublicClient();
    const relayerAccount = privateKeyToAccount(parsePrivateKey(RELAYER_PRIVATE_KEY));

    const relayerBalanceWei = await publicClient.getBalance({
      address: relayerAccount.address,
    });

    const stats = getStats();
    if (stats.topupsLastHour >= MAX_TOPUPS_PER_HOUR) {
      lastError = `Top-up capped: max ${MAX_TOPUPS_PER_HOUR}/hour reached`;
      return {
        attempted: false,
        toppedUp: false,
        reason: 'hourly_cap_reached',
      };
    }

    const topupAmountWei = clampTopupAmountWei(relayerBalanceWei);
    if (topupAmountWei <= 0n) {
      return {
        attempted: false,
        toppedUp: false,
        reason: relayerBalanceWei >= parseEther(String(MIN_RELAYER_ETH_SEPOLIA))
          ? 'balance_above_min'
          : 'daily_cap_reached',
      };
    }

    if (!FUNDING_WALLET_PRIVATE_KEY_SEPOLIA) {
      lastError = 'Funding wallet key missing';
      return {
        attempted: true,
        toppedUp: false,
        reason: 'funding_wallet_missing',
        error: 'FUNDING_WALLET_PRIVATE_KEY_SEPOLIA is required',
      };
    }

    const fundingAccount = privateKeyToAccount(parsePrivateKey(FUNDING_WALLET_PRIVATE_KEY_SEPOLIA));
    const fundingBalanceWei = await publicClient.getBalance({
      address: fundingAccount.address,
    });

    const gasBufferWei = parseEther('0.0003');
    if (fundingBalanceWei < topupAmountWei + gasBufferWei) {
      const error = 'Funding wallet has insufficient ETH for top-up + gas';
      lastError = error;
      return {
        attempted: true,
        toppedUp: false,
        reason: 'funding_wallet_insufficient',
        error,
      };
    }

    const walletClient = createWalletClient({
      account: fundingAccount,
      chain: sepolia,
      transport: http(ETH_TESTNET_RPC_URL!),
    });

    const txHash = await walletClient.sendTransaction({
      to: relayerAccount.address,
      value: topupAmountWei,
    });

    const amountEth = Number(formatEther(topupAmountWei));
    const now = Date.now();
    topupEvents.push({ at: now, ethAmount: amountEth });
    topupEthToday += amountEth;
    lastTopUpAt = now;
    lastError = undefined;

    console.log('[relayerTopUp] Sent top-up', {
      chain,
      reason,
      txHash,
      amountEth,
      relayer: relayerAccount.address,
      funding: fundingAccount.address,
    });

    return {
      attempted: true,
      toppedUp: true,
      txHash,
      reason: 'topup_sent',
    };
  } catch (error: any) {
    const classified = classifyTopupError(error);
    lastError = `${classified}: ${error?.message || 'unknown error'}`;
    console.error('[relayerTopUp] Top-up attempt failed', {
      chain,
      reason,
      error: lastError,
    });
    return {
      attempted: true,
      toppedUp: false,
      reason: classified,
      error: error?.message || 'Top-up failed',
    };
  }
}

export async function maybeTopUpRelayer(
  chain: RelayerChain = 'sepolia',
  opts?: { reason?: string; fireAndForget?: boolean }
): Promise<TopupResult> {
  const reason = opts?.reason || 'manual';

  if (!topupInFlight) {
    topupInFlight = runTopupAttempt(chain, reason).finally(() => {
      topupInFlight = null;
    });
  }

  if (opts?.fireAndForget) {
    void topupInFlight.catch(() => undefined);
    return {
      attempted: true,
      toppedUp: false,
      reason: 'topup_queued',
    };
  }

  return topupInFlight;
}

export async function getRelayerStatus(chain: RelayerChain = 'sepolia'): Promise<RelayerStatus> {
  const stats = getStats();
  const minEth = MIN_RELAYER_ETH_SEPOLIA;
  const targetEth = TARGET_RELAYER_ETH_SEPOLIA;

  let relayerAddress = '';
  let relayerBalanceWei = 0n;
  let fundingAddress: string | undefined;
  let fundingBalanceEth: string | undefined;

  try {
    const publicClient = getPublicClient();
    const relayerAccount = privateKeyToAccount(parsePrivateKey(RELAYER_PRIVATE_KEY));
    relayerAddress = relayerAccount.address;
    relayerBalanceWei = await publicClient.getBalance({
      address: relayerAccount.address,
    });

    if (FUNDING_WALLET_PRIVATE_KEY_SEPOLIA) {
      const fundingAccount = privateKeyToAccount(parsePrivateKey(FUNDING_WALLET_PRIVATE_KEY_SEPOLIA));
      fundingAddress = fundingAccount.address;
      const fundingBalanceWei = await publicClient.getBalance({
        address: fundingAccount.address,
      });
      fundingBalanceEth = formatEther(fundingBalanceWei);
    }
  } catch (error: any) {
    lastError = error?.message || 'Failed to read relayer status';
  }

  const minWei = parseEther(String(minEth));
  const okToExecute = relayerBalanceWei >= minWei;
  const balanceEth = formatEther(relayerBalanceWei);

  const result: RelayerStatus = {
    ok: okToExecute,
    chain: 'sepolia',
    relayer: {
      address: relayerAddress,
      balanceEth,
      balanceWei: relayerBalanceWei.toString(),
      minEth,
      targetEth,
      okToExecute,
      ...(lastError ? { lastError } : {}),
      ...(lastTopUpAt ? { lastTopUpAt } : {}),
    },
    funding: {
      enabled: RELAYER_TOPUP_ENABLED,
      ...(fundingAddress ? { fundingAddress } : {}),
      ...(fundingBalanceEth ? { fundingBalanceEth } : {}),
      caps: {
        maxTopupsPerHour: MAX_TOPUPS_PER_HOUR,
        maxTopupEthPerDay: MAX_TOPUP_ETH_PER_DAY,
      },
      stats: {
        topupsLastHour: stats.topupsLastHour,
        topupEthToday: Number(topupEthToday.toFixed(8)),
      },
    },
  };

  return result;
}

export function startRelayerTopUpService(): void {
  if (serviceStarted) {
    return;
  }
  serviceStarted = true;

  if (!RELAYER_TOPUP_ENABLED) {
    console.log('[relayerTopUp] Auto top-up service disabled');
    return;
  }

  const tick = () => {
    void maybeTopUpRelayer('sepolia', {
      reason: 'interval_check',
      fireAndForget: true,
    });
  };

  tick();
  const timer = setInterval(tick, 60_000);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  console.log('[relayerTopUp] Auto top-up service started (interval=60s)');
}
