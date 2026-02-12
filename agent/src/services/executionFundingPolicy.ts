import {
  MIN_USER_GAS_ETH,
  USER_PAYS_GAS_FALLBACK_ENABLED,
  GAS_DRIP_ENABLED,
  GAS_DRIP_AMOUNT_ETH,
} from '../config';
import {
  canSponsorGasDrip,
  getRelayerStatus,
  getUserEthBalance,
  maybeTopUpRelayer,
  noteFundingRecoveryMode,
  type RelayerChain,
} from './relayerTopUp';

export type ExecutionFundingMode =
  | 'relayed'
  | 'relayed_after_topup'
  | 'user_paid_required'
  | 'blocked_needs_gas';

export type ExecutionFundingPolicyResult = {
  mode: ExecutionFundingMode;
  chain: RelayerChain;
  reasonCode:
    | 'RELAYER_OK'
    | 'RELAYER_OPERATIONAL'
    | 'RELAYER_TOPUP_OK'
    | 'RELAYER_TOPUP_UNAVAILABLE'
    | 'RELAYER_TOPUP_TIMEOUT'
    | 'USER_HAS_GAS'
    | 'USER_WALLET_UNDERFUNDED'
    | 'MISSING_USER_ADDRESS'
    | 'USER_PAYS_DISABLED'
    | 'USER_BALANCE_CHECK_FAILED'
    | 'SPONSOR_DRIP_AVAILABLE'
    | 'INSUFFICIENT_GAS_CAPACITY';
  userMessage: string;
  recommendedAction:
    | 'proceed_relayed'
    | 'continue_with_wallet'
    | 'top_up_gas'
    | 'connect_wallet'
    | 'retry_later';
  relayerBalanceEth: number;
  relayerMinEth: number;
  minUserGasEth: number;
  userBalanceEth?: number;
  didTopup: boolean;
  topupTxHash?: string;
  sponsorEligible?: boolean;
  sponsorReason?: string;
  executionMetaFunding: {
    mode: ExecutionFundingMode;
    reasonCode: string;
    relayerBalanceEth: number;
    minEth: number;
    didTopup: boolean;
    topupTxHash?: string;
    userBalanceEth?: number;
    minUserGasEth: number;
    sponsorEligible?: boolean;
    sponsorReason?: string;
  };
};

function normalizeEth(value: string | undefined): number {
  const parsed = Number(value || '0');
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildResult(
  base: Omit<ExecutionFundingPolicyResult, 'executionMetaFunding'>
): ExecutionFundingPolicyResult {
  return {
    ...base,
    executionMetaFunding: {
      mode: base.mode,
      reasonCode: base.reasonCode,
      relayerBalanceEth: base.relayerBalanceEth,
      minEth: base.relayerMinEth,
      didTopup: base.didTopup,
      ...(base.topupTxHash ? { topupTxHash: base.topupTxHash } : {}),
      ...(base.userBalanceEth !== undefined ? { userBalanceEth: base.userBalanceEth } : {}),
      minUserGasEth: base.minUserGasEth,
      ...(base.sponsorEligible !== undefined ? { sponsorEligible: base.sponsorEligible } : {}),
      ...(base.sponsorReason ? { sponsorReason: base.sponsorReason } : {}),
    },
  };
}

function getOperationalRelayerMinEth(): number {
  const parsed = Number(process.env.MIN_RELAYER_OPERATIONAL_ETH || '0.001');
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0.001;
  }
  return Math.max(0.0002, parsed);
}

export async function executionFundingPolicy(params: {
  chain?: RelayerChain;
  userAddress?: string;
  attemptTopupSync?: boolean;
  topupTimeoutMs?: number;
  topupReason?: string;
}): Promise<ExecutionFundingPolicyResult> {
  const chain = (params.chain || 'sepolia') as RelayerChain;
  const userAddress = String(params.userAddress || '').trim();
  const statusBefore = await getRelayerStatus(chain);
  let relayerBalanceEth = normalizeEth(statusBefore.relayer.balanceEth);
  let relayerMinEth = Number(statusBefore.relayer.minEth || 0);
  let didTopup = false;
  let topupTxHash: string | undefined;
  let topupReasonCode: ExecutionFundingPolicyResult['reasonCode'] | undefined;

  if (!statusBefore.relayer.okToExecute && params.attemptTopupSync) {
    const timeoutMs = Math.max(1000, Number(params.topupTimeoutMs || 12000));
    let timedOut = false;
    try {
      const topupResult = await Promise.race([
        maybeTopUpRelayer(chain, {
          reason: params.topupReason || 'execution_funding_policy_sync',
          fireAndForget: false,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => {
            timedOut = true;
            reject(new Error('RELAYER_TOPUP_TIMEOUT'));
          }, timeoutMs)
        ),
      ]);
      didTopup = !!topupResult?.toppedUp;
      topupTxHash = topupResult?.txHash;
      topupReasonCode = topupResult?.toppedUp ? 'RELAYER_TOPUP_OK' : 'RELAYER_TOPUP_UNAVAILABLE';
    } catch {
      topupReasonCode = timedOut ? 'RELAYER_TOPUP_TIMEOUT' : 'RELAYER_TOPUP_UNAVAILABLE';
    }
  }

  const statusAfter = await getRelayerStatus(chain);
  relayerBalanceEth = normalizeEth(statusAfter.relayer.balanceEth);
  relayerMinEth = Number(statusAfter.relayer.minEth || relayerMinEth || 0);
  if (statusAfter.relayer.okToExecute) {
    noteFundingRecoveryMode('relayed');
    return buildResult({
      mode: didTopup ? 'relayed_after_topup' : 'relayed',
      chain,
      reasonCode: didTopup ? 'RELAYER_TOPUP_OK' : 'RELAYER_OK',
      userMessage: didTopup
        ? 'Execution capacity restored and ready to proceed.'
        : 'Execution capacity is ready.',
      recommendedAction: 'proceed_relayed',
      relayerBalanceEth,
      relayerMinEth,
      minUserGasEth: MIN_USER_GAS_ETH,
      didTopup,
      ...(topupTxHash ? { topupTxHash } : {}),
    });
  }

  const operationalRelayerMinEth = getOperationalRelayerMinEth();
  if (relayerBalanceEth >= operationalRelayerMinEth) {
    noteFundingRecoveryMode('relayed');
    return buildResult({
      mode: didTopup ? 'relayed_after_topup' : 'relayed',
      chain,
      reasonCode: didTopup ? 'RELAYER_TOPUP_OK' : 'RELAYER_OPERATIONAL',
      userMessage: didTopup
        ? 'Execution capacity restored in degraded relayer mode.'
        : 'Execution running in degraded relayer mode.',
      recommendedAction: 'proceed_relayed',
      relayerBalanceEth,
      relayerMinEth,
      minUserGasEth: MIN_USER_GAS_ETH,
      didTopup,
      ...(topupTxHash ? { topupTxHash } : {}),
    });
  }

  if (!USER_PAYS_GAS_FALLBACK_ENABLED) {
    return buildResult({
      mode: 'blocked_needs_gas',
      chain,
      reasonCode: 'USER_PAYS_DISABLED',
      userMessage: 'Execution needs gas capacity and wallet fallback is disabled. Retry later.',
      recommendedAction: 'retry_later',
      relayerBalanceEth,
      relayerMinEth,
      minUserGasEth: MIN_USER_GAS_ETH,
      didTopup,
      ...(topupTxHash ? { topupTxHash } : {}),
    });
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
    return buildResult({
      mode: 'blocked_needs_gas',
      chain,
      reasonCode: 'MISSING_USER_ADDRESS',
      userMessage: 'Connect an EVM wallet to continue with wallet-paid gas.',
      recommendedAction: 'connect_wallet',
      relayerBalanceEth,
      relayerMinEth,
      minUserGasEth: MIN_USER_GAS_ETH,
      didTopup,
      ...(topupTxHash ? { topupTxHash } : {}),
    });
  }

  try {
    const userBalance = await getUserEthBalance(chain, userAddress);
    if (userBalance.balanceEth >= MIN_USER_GAS_ETH) {
      noteFundingRecoveryMode('user_pays_gas');
      return buildResult({
        mode: 'user_paid_required',
        chain,
        reasonCode: 'USER_HAS_GAS',
        userMessage: 'Execution requires wallet gas. Continue with wallet to submit the transaction.',
        recommendedAction: 'continue_with_wallet',
        relayerBalanceEth,
        relayerMinEth,
        userBalanceEth: userBalance.balanceEth,
        minUserGasEth: MIN_USER_GAS_ETH,
        didTopup,
        ...(topupTxHash ? { topupTxHash } : {}),
      });
    }

    if (GAS_DRIP_ENABLED) {
      const sponsor = await canSponsorGasDrip(chain, userAddress, GAS_DRIP_AMOUNT_ETH);
      if (sponsor.ok) {
        return buildResult({
          mode: 'blocked_needs_gas',
          chain,
          reasonCode: 'SPONSOR_DRIP_AVAILABLE',
          userMessage: 'Execution needs gas. Request a gas top-up, then continue with wallet.',
          recommendedAction: 'top_up_gas',
          relayerBalanceEth,
          relayerMinEth,
          userBalanceEth: userBalance.balanceEth,
          minUserGasEth: MIN_USER_GAS_ETH,
          didTopup,
          ...(topupTxHash ? { topupTxHash } : {}),
          sponsorEligible: true,
          sponsorReason: sponsor.reason,
        });
      }

      return buildResult({
        mode: 'blocked_needs_gas',
        chain,
        reasonCode: 'INSUFFICIENT_GAS_CAPACITY',
        userMessage: 'Insufficient gas to execute. Top up testnet ETH and retry.',
        recommendedAction: 'top_up_gas',
        relayerBalanceEth,
        relayerMinEth,
        userBalanceEth: userBalance.balanceEth,
        minUserGasEth: MIN_USER_GAS_ETH,
        didTopup,
        ...(topupTxHash ? { topupTxHash } : {}),
        sponsorEligible: false,
        sponsorReason: sponsor.reason,
      });
    }

    return buildResult({
      mode: 'blocked_needs_gas',
      chain,
      reasonCode: 'USER_WALLET_UNDERFUNDED',
      userMessage: 'Execution requires testnet ETH in your wallet. Add gas and retry.',
      recommendedAction: 'top_up_gas',
      relayerBalanceEth,
      relayerMinEth,
      userBalanceEth: userBalance.balanceEth,
      minUserGasEth: MIN_USER_GAS_ETH,
      didTopup,
      ...(topupTxHash ? { topupTxHash } : {}),
    });
  } catch (error: any) {
    return buildResult({
      mode: 'blocked_needs_gas',
      chain,
      reasonCode: 'USER_BALANCE_CHECK_FAILED',
      userMessage: 'Unable to verify wallet gas balance. Retry shortly.',
      recommendedAction: 'retry_later',
      relayerBalanceEth,
      relayerMinEth,
      minUserGasEth: MIN_USER_GAS_ETH,
      didTopup,
      ...(topupTxHash ? { topupTxHash } : {}),
      sponsorEligible: false,
      sponsorReason: error?.message || 'user_balance_check_failed',
    });
  }
}

// Backward compatibility shim for existing imports.
export async function decideExecutionFundingMode(params: {
  chain?: RelayerChain;
  userAddress?: string;
}): Promise<ExecutionFundingPolicyResult> {
  return executionFundingPolicy(params);
}
