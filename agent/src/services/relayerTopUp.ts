import {
  DEFAULT_SETTLEMENT_CHAIN,
  RELAYER_TOPUP_ENABLED,
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
import { getSettlementChainRuntimeConfig, type SettlementChain as RelayerChain } from '../config/settlementChains';

export type { RelayerChain };


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
  chain: RelayerChain;
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
let topupInFlightByChain = new Map<RelayerChain, Promise<TopupResult>>();
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

function getFundingAccount(chain: RelayerChain) {
  const chainConfig = getSettlementChainRuntimeConfig(chain);
  if (!chainConfig.fundingPrivateKey) {
    throw new Error(`Funding wallet private key is required for ${chainConfig.label}`);
  }
  return privateKeyToAccount(parsePrivateKey(chainConfig.fundingPrivateKey));
}

function getPublicClient(chain: RelayerChain) {
  const chainConfig = getSettlementChainRuntimeConfig(chain);
  if (!chainConfig.rpcUrl) {
    throw new Error(`${chainConfig.label} RPC not configured`);
  }
  return createPublicClient({
    chain: chainConfig.chain,
    transport: http(chainConfig.rpcUrl),
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

function clampTopupAmountWei(chain: RelayerChain, balanceWei: bigint): bigint {
  const chainConfig = getSettlementChainRuntimeConfig(chain);
  const minWei = parseEther(String(chainConfig.minRelayerEth));
  const targetWei = parseEther(String(chainConfig.targetRelayerEth));

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
  const publicClient = getPublicClient(chain);
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
  if (!GAS_DRIP_ENABLED) {
    return { ok: false, reason: 'gas_drip_disabled', amountEth };
  }
  const chainConfig = getSettlementChainRuntimeConfig(chain);
  if (!chainConfig.fundingPrivateKey) {
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
    const publicClient = getPublicClient(chain);
    const fundingAccount = getFundingAccount(chain);
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
    const chainConfig = getSettlementChainRuntimeConfig(chain);
    if (!chainConfig.rpcUrl) {
      throw new Error(`${chainConfig.label} RPC not configured`);
    }
    const publicClient = getPublicClient(chain);
    const fundingAccount = getFundingAccount(chain);
    const walletClient = createWalletClient({
      account: fundingAccount,
      chain: chainConfig.chain,
      transport: http(chainConfig.rpcUrl),
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
  chain: RelayerChain = DEFAULT_SETTLEMENT_CHAIN,
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
  if (!RELAYER_TOPUP_ENABLED) {
    return {
      attempted: false,
      toppedUp: false,
      reason: 'topup_disabled',
    };
  }

  try {
    const chainConfig = getSettlementChainRuntimeConfig(chain);
    if (!chainConfig.rpcUrl) {
      return {
        attempted: false,
        toppedUp: false,
        reason: `missing_rpc:${chain}`,
      };
    }
    if (!chainConfig.relayerPrivateKey) {
      return {
        attempted: false,
        toppedUp: false,
        reason: `missing_relayer_key:${chain}`,
      };
    }

    const publicClient = getPublicClient(chain);
    const relayerAccount = privateKeyToAccount(parsePrivateKey(chainConfig.relayerPrivateKey));

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

    const topupAmountWei = clampTopupAmountWei(chain, relayerBalanceWei);
    if (topupAmountWei <= 0n) {
      return {
        attempted: false,
        toppedUp: false,
        reason: relayerBalanceWei >= parseEther(String(chainConfig.minRelayerEth))
          ? 'balance_above_min'
          : 'daily_cap_reached',
      };
    }

    if (!chainConfig.fundingPrivateKey) {
      lastError = 'Funding wallet key missing';
      return {
        attempted: true,
        toppedUp: false,
        reason: 'funding_wallet_missing',
        error: `Funding wallet private key is required for ${chainConfig.label}`,
      };
    }

    const fundingAccount = privateKeyToAccount(parsePrivateKey(chainConfig.fundingPrivateKey));
    const fundingBalanceWei = await publicClient.getBalance({
      address: fundingAccount.address,
    });

    const gasBufferWei = parseEther('0.0003');
    let topupValueWei = topupAmountWei;
    if (fundingBalanceWei < topupValueWei + gasBufferWei) {
      const maxAffordableWei = fundingBalanceWei > gasBufferWei ? fundingBalanceWei - gasBufferWei : 0n;
      const remainingEthCap = Math.max(0, MAX_TOPUP_ETH_PER_DAY - topupEthToday);
      const remainingWeiCap = parseEther(remainingEthCap.toFixed(18));
      const minPartialTopupEth = Math.max(0.0005, Number(process.env.MIN_RELAYER_PARTIAL_TOPUP_ETH || '0.003'));
      const minPartialTopupWei = parseEther(minPartialTopupEth.toFixed(6));
      const candidateWei = maxAffordableWei > remainingWeiCap ? remainingWeiCap : maxAffordableWei;
      if (candidateWei <= 0n || candidateWei < minPartialTopupWei) {
        const error = 'Funding wallet has insufficient ETH for top-up + gas';
        lastError = error;
        return {
          attempted: true,
          toppedUp: false,
          reason: 'funding_wallet_insufficient',
          error,
        };
      }
      topupValueWei = candidateWei;
    }

    const walletClient = createWalletClient({
      account: fundingAccount,
      chain: chainConfig.chain,
      transport: http(chainConfig.rpcUrl),
    });

    const txHash = await walletClient.sendTransaction({
      to: relayerAccount.address,
      value: topupValueWei,
    });

    const amountEth = Number(formatEther(topupValueWei));
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
  chain: RelayerChain = DEFAULT_SETTLEMENT_CHAIN,
  opts?: { reason?: string; fireAndForget?: boolean }
): Promise<TopupResult> {
  const reason = opts?.reason || 'manual';

  let topupInFlight = topupInFlightByChain.get(chain);
  if (!topupInFlight) {
    topupInFlight = runTopupAttempt(chain, reason).finally(() => {
      topupInFlightByChain.delete(chain);
    });
    topupInFlightByChain.set(chain, topupInFlight);
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

export async function getRelayerStatus(chain: RelayerChain = DEFAULT_SETTLEMENT_CHAIN): Promise<RelayerStatus> {
  const stats = getStats();
  const chainConfig = getSettlementChainRuntimeConfig(chain);
  const minEth = chainConfig.minRelayerEth;
  const targetEth = chainConfig.targetRelayerEth;

  let relayerAddress = '';
  let relayerBalanceWei = 0n;
  let fundingAddress: string | undefined;
  let fundingBalanceEth: string | undefined;

  try {
    const publicClient = getPublicClient(chain);
    if (!chainConfig.relayerPrivateKey) {
      throw new Error(`Missing relayer key for ${chainConfig.label}`);
    }
    const relayerAccount = privateKeyToAccount(parsePrivateKey(chainConfig.relayerPrivateKey));
    relayerAddress = relayerAccount.address;
    relayerBalanceWei = await publicClient.getBalance({
      address: relayerAccount.address,
    });

    if (chainConfig.fundingPrivateKey) {
      const fundingAccount = privateKeyToAccount(parsePrivateKey(chainConfig.fundingPrivateKey));
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
    chain,
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
    void maybeTopUpRelayer(DEFAULT_SETTLEMENT_CHAIN, {
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
