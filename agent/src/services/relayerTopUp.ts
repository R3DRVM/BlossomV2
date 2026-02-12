import {
  ETH_TESTNET_RPC_URL,
  RELAYER_PRIVATE_KEY,
  RELAYER_TOPUP_ENABLED,
  FUNDING_WALLET_PRIVATE_KEY_SEPOLIA,
  MIN_RELAYER_ETH_SEPOLIA,
  TARGET_RELAYER_ETH_SEPOLIA,
  MAX_TOPUPS_PER_HOUR,
  MAX_TOPUP_ETH_PER_DAY,
  GAS_CREDITS_ENABLED,
  GAS_CREDITS_FEE_BUSDC_PER_EXECUTE,
  GAS_SWAP_TOPUP_ENABLED,
  GAS_SWAP_DEX_ROUTER,
  GAS_SWAP_MAX_ETH_PER_DAY,
  GAS_SWAP_MIN_QUOTE_ETH,
  GAS_DRIP_ENABLED,
  GAS_DRIP_AMOUNT_ETH,
  GAS_DRIP_MAX_GLOBAL_PER_DAY_ETH,
  GAS_DRIP_MAX_PER_ADDRESS_PER_DAY,
  GAS_DRIP_MAX_PER_HOUR,
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

export type GasDripResult = {
  ok: boolean;
  attempted: boolean;
  txHash?: string;
  amountEth?: number;
  reason?: string;
  error?: string;
};

type GasDripEvent = {
  at: number;
  address: string;
  ethAmount: number;
  txHash: string;
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
  gasCredits?: {
    feePerExecuteBusdc: number;
    accruedTodayBusdc: number;
    lastAccrualAt?: number;
    lastFundingRecoveryMode?: 'relayed' | 'user_pays_gas' | 'sponsor_gas_drip';
    lastTopUpAt?: number;
    lastDripAt?: number;
    swapCaps: {
      maxEthPerDay: number;
      minQuoteEth: number;
    };
    lastSwap?: {
      at?: number;
      mode?: 'topup' | 'swap';
    };
    lastSwapError?: string;
  };
  swap?: {
    enabled: boolean;
    router?: string;
    quoteOk: boolean;
    lastQuoteEth?: string;
  };
};

const HOUR_MS = 60 * 60 * 1000;
let topupEvents: TopupEvent[] = [];
let dailyKey = getUtcDayKey();
let topupEthToday = 0;
let gasDripEthToday = 0;
let gasCreditsAccruedToday = 0;
let lastTopUpAt: number | undefined;
let lastDripAt: number | undefined;
let lastGasCreditAt: number | undefined;
let lastFundingRecoveryMode: 'relayed' | 'user_pays_gas' | 'sponsor_gas_drip' | undefined;
let lastSwapQuoteEth: string | undefined;
let lastSwapError: string | undefined;
let lastError: string | undefined;
let topupInFlight: Promise<TopupResult> | null = null;
let gasDripInFlightByAddress = new Map<string, Promise<GasDripResult>>();
let gasDripEvents: GasDripEvent[] = [];
let gasDripsByAddressToday = new Map<string, number>();
let serviceStarted = false;

function getUtcDayKey() {
  return new Date().toISOString().slice(0, 10);
}

function resetDailyIfNeeded() {
  const nowKey = getUtcDayKey();
  if (nowKey !== dailyKey) {
    dailyKey = nowKey;
    topupEthToday = 0;
    gasDripEthToday = 0;
    gasCreditsAccruedToday = 0;
    gasDripsByAddressToday = new Map();
  }
}

function trimOldEvents(now = Date.now()) {
  topupEvents = topupEvents.filter((evt) => now - evt.at <= HOUR_MS);
  gasDripEvents = gasDripEvents.filter((evt) => now - evt.at <= HOUR_MS);
}

function getStats(now = Date.now()) {
  resetDailyIfNeeded();
  trimOldEvents(now);
  return {
    topupsLastHour: topupEvents.length,
    topupEthToday,
    gasDripsLastHour: gasDripEvents.length,
    gasDripEthToday,
  };
}

function getFundingAccount() {
  if (!FUNDING_WALLET_PRIVATE_KEY_SEPOLIA) {
    throw new Error('FUNDING_WALLET_PRIVATE_KEY_SEPOLIA is required');
  }
  return privateKeyToAccount(parsePrivateKey(FUNDING_WALLET_PRIVATE_KEY_SEPOLIA));
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

  // Keep the relayer topped up to target when possible.
  // minWei is for "okToExecute" gating, not for deciding whether to top up.
  if (targetWei <= balanceWei) {
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

function getAddressDripCountToday(address: string): number {
  resetDailyIfNeeded();
  return gasDripsByAddressToday.get(address.toLowerCase()) || 0;
}

export async function getUserEthBalance(chain: RelayerChain, address: string): Promise<{ balanceWei: bigint; balanceEth: number }> {
  if (chain !== 'sepolia') {
    throw new Error(`Unsupported chain for user balance: ${chain}`);
  }
  const publicClient = getPublicClient();
  const normalizedAddress = address.toLowerCase() as `0x${string}`;
  const balanceWei = await publicClient.getBalance({ address: normalizedAddress });
  return {
    balanceWei,
    balanceEth: Number(formatEther(balanceWei)),
  };
}

export async function canSponsorGasDrip(
  chain: RelayerChain,
  userAddress: string,
  amountEth: number = GAS_DRIP_AMOUNT_ETH
): Promise<{
  ok: boolean;
  reason?: string;
  amountEth: number;
  fundingBalanceEth?: number;
  remainingGlobalEthToday?: number;
  addressDripsToday?: number;
}> {
  if (chain !== 'sepolia') {
    return { ok: false, reason: `unsupported_chain:${chain}`, amountEth };
  }
  if (!GAS_DRIP_ENABLED) {
    return { ok: false, reason: 'gas_drip_disabled', amountEth };
  }
  if (!FUNDING_WALLET_PRIVATE_KEY_SEPOLIA) {
    return { ok: false, reason: 'funding_wallet_missing', amountEth };
  }

  const normalizedAddress = String(userAddress || '').toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(normalizedAddress)) {
    return { ok: false, reason: 'invalid_address', amountEth };
  }

  const stats = getStats();
  if (stats.gasDripsLastHour >= GAS_DRIP_MAX_PER_HOUR) {
    return { ok: false, reason: 'gas_drip_hourly_cap_reached', amountEth };
  }

  const addressDripsToday = getAddressDripCountToday(normalizedAddress);
  if (addressDripsToday >= GAS_DRIP_MAX_PER_ADDRESS_PER_DAY) {
    return { ok: false, reason: 'gas_drip_address_daily_cap_reached', amountEth, addressDripsToday };
  }

  const remainingGlobalEthToday = Math.max(0, GAS_DRIP_MAX_GLOBAL_PER_DAY_ETH - gasDripEthToday);
  if (remainingGlobalEthToday < amountEth) {
    return { ok: false, reason: 'gas_drip_global_daily_cap_reached', amountEth, remainingGlobalEthToday };
  }

  try {
    const publicClient = getPublicClient();
    const fundingAccount = getFundingAccount();
    const fundingBalanceWei = await publicClient.getBalance({ address: fundingAccount.address });
    const fundingBalanceEth = Number(formatEther(fundingBalanceWei));
    const valueWei = parseEther(amountEth.toFixed(6));
    const gasBufferWei = parseEther('0.0003');
    if (fundingBalanceWei < valueWei + gasBufferWei) {
      return { ok: false, reason: 'funding_wallet_insufficient', amountEth, fundingBalanceEth };
    }
    return {
      ok: true,
      amountEth,
      fundingBalanceEth,
      remainingGlobalEthToday,
      addressDripsToday,
    };
  } catch (error: any) {
    return { ok: false, reason: `gas_drip_precheck_failed:${error?.message || 'unknown'}`, amountEth };
  }
}

async function runGasDripAttempt(
  chain: RelayerChain,
  userAddress: string,
  amountEth: number,
  reason: string
): Promise<GasDripResult> {
  const eligibility = await canSponsorGasDrip(chain, userAddress, amountEth);
  if (!eligibility.ok) {
    return {
      ok: false,
      attempted: false,
      reason: eligibility.reason,
      error: eligibility.reason,
    };
  }

  try {
    const publicClient = getPublicClient();
    const fundingAccount = getFundingAccount();
    const walletClient = createWalletClient({
      account: fundingAccount,
      chain: sepolia,
      transport: http(ETH_TESTNET_RPC_URL!),
    });
    const normalizedAddress = userAddress.toLowerCase() as `0x${string}`;
    const valueWei = parseEther(amountEth.toFixed(6));
    const txHash = await walletClient.sendTransaction({
      to: normalizedAddress,
      value: valueWei,
    });

    try {
      await publicClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: 45_000,
      });
    } catch {
      // Receipt wait is best-effort for drip.
    }

    const now = Date.now();
    gasDripEvents.push({
      at: now,
      address: normalizedAddress,
      ethAmount: amountEth,
      txHash,
    });
    gasDripEthToday += amountEth;
    gasDripsByAddressToday.set(normalizedAddress, getAddressDripCountToday(normalizedAddress) + 1);
    lastDripAt = now;
    lastFundingRecoveryMode = 'sponsor_gas_drip';

    console.log('[relayerTopUp] Sent user gas drip', {
      chain,
      reason,
      txHash,
      amountEth,
      to: normalizedAddress,
      funding: fundingAccount.address,
    });

    return {
      ok: true,
      attempted: true,
      txHash,
      amountEth,
      reason: 'gas_drip_sent',
    };
  } catch (error: any) {
    const message = error?.message || 'Gas drip failed';
    return {
      ok: false,
      attempted: true,
      reason: 'gas_drip_failed',
      error: message,
    };
  }
}

export async function maybeDripUserGas(
  chain: RelayerChain = 'sepolia',
  userAddress: string,
  opts?: {
    reason?: string;
    amountEth?: number;
    fireAndForget?: boolean;
  }
): Promise<GasDripResult> {
  const normalizedAddress = String(userAddress || '').toLowerCase();
  const reason = opts?.reason || 'manual_drip';
  const amountEth = Number.isFinite(opts?.amountEth as number) ? Number(opts?.amountEth) : GAS_DRIP_AMOUNT_ETH;
  const lockKey = `${chain}:${normalizedAddress}`;
  let inFlight = gasDripInFlightByAddress.get(lockKey);
  if (!inFlight) {
    inFlight = runGasDripAttempt(chain, normalizedAddress, amountEth, reason).finally(() => {
      gasDripInFlightByAddress.delete(lockKey);
    });
    gasDripInFlightByAddress.set(lockKey, inFlight);
  }

  if (opts?.fireAndForget) {
    void inFlight.catch(() => undefined);
    return {
      ok: true,
      attempted: true,
      reason: 'gas_drip_queued',
    };
  }
  return inFlight;
}

export function recordGasCreditAccrual(opts?: { amountBusdc?: number; fundingMode?: 'relayed' | 'user_pays_gas' | 'sponsor_gas_drip' }): void {
  if (!GAS_CREDITS_ENABLED) return;
  resetDailyIfNeeded();
  const amount = Number.isFinite(opts?.amountBusdc as number)
    ? Number(opts?.amountBusdc)
    : GAS_CREDITS_FEE_BUSDC_PER_EXECUTE;
  gasCreditsAccruedToday = Number((gasCreditsAccruedToday + Math.max(0, amount)).toFixed(6));
  lastGasCreditAt = Date.now();
  if (opts?.fundingMode) {
    lastFundingRecoveryMode = opts.fundingMode;
  }
}

export function noteFundingRecoveryMode(mode: 'relayed' | 'user_pays_gas' | 'sponsor_gas_drip'): void {
  lastFundingRecoveryMode = mode;
}

export function getGasCreditsSnapshot() {
  resetDailyIfNeeded();
  return {
    feePerExecuteBusdc: GAS_CREDITS_FEE_BUSDC_PER_EXECUTE,
    accruedTodayBusdc: Number(gasCreditsAccruedToday.toFixed(6)),
    ...(lastGasCreditAt ? { lastAccrualAt: lastGasCreditAt } : {}),
    ...(lastFundingRecoveryMode ? { lastFundingRecoveryMode } : {}),
    ...(lastTopUpAt ? { lastTopUpAt } : {}),
    ...(lastDripAt ? { lastDripAt } : {}),
    swapCaps: {
      maxEthPerDay: GAS_SWAP_MAX_ETH_PER_DAY,
      minQuoteEth: GAS_SWAP_MIN_QUOTE_ETH,
    },
    lastSwap: {
      ...(lastTopUpAt || lastDripAt ? { at: Math.max(lastTopUpAt || 0, lastDripAt || 0) } : {}),
      ...(lastFundingRecoveryMode === 'relayed' || lastFundingRecoveryMode === 'sponsor_gas_drip'
        ? { mode: 'topup' as const }
        : {}),
    },
    ...(lastSwapError ? { lastSwapError } : {}),
  };
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
    gasCredits: {
      feePerExecuteBusdc: GAS_CREDITS_FEE_BUSDC_PER_EXECUTE,
      accruedTodayBusdc: Number(gasCreditsAccruedToday.toFixed(6)),
      ...(lastGasCreditAt ? { lastAccrualAt: lastGasCreditAt } : {}),
      ...(lastFundingRecoveryMode ? { lastFundingRecoveryMode } : {}),
      ...(lastTopUpAt ? { lastTopUpAt } : {}),
      ...(lastDripAt ? { lastDripAt } : {}),
      swapCaps: {
        maxEthPerDay: GAS_SWAP_MAX_ETH_PER_DAY,
        minQuoteEth: GAS_SWAP_MIN_QUOTE_ETH,
      },
      ...(lastSwapError ? { lastSwapError } : {}),
      lastSwap: {
        ...(lastTopUpAt || lastDripAt ? { at: Math.max(lastTopUpAt || 0, lastDripAt || 0) } : {}),
        ...(lastFundingRecoveryMode === 'relayed' || lastFundingRecoveryMode === 'sponsor_gas_drip'
          ? { mode: 'topup' as const }
          : {}),
      },
    },
    swap: {
      enabled: GAS_SWAP_TOPUP_ENABLED,
      ...(GAS_SWAP_DEX_ROUTER ? { router: GAS_SWAP_DEX_ROUTER } : {}),
      quoteOk: false,
      ...(lastSwapQuoteEth ? { lastQuoteEth: lastSwapQuoteEth } : {}),
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
