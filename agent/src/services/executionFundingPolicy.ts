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
  noteFundingRecoveryMode,
  type RelayerChain,
} from './relayerTopUp';

export type ExecutionFundingMode = 'relayed' | 'user_pays_gas' | 'sponsor_gas_drip' | 'blocked';

export type ExecutionFundingDecision = {
  ok: boolean;
  mode: ExecutionFundingMode;
  chain: RelayerChain;
  code?:
    | 'RELAYER_READY'
    | 'USER_PAYS_GAS_READY'
    | 'SPONSOR_GAS_DRIP_READY'
    | 'INSUFFICIENT_GAS_CAPACITY'
    | 'MISSING_USER_ADDRESS';
  reason?: string;
  userMessage?: string;
  relayerBalanceEth?: number;
  relayerMinEth?: number;
  userBalanceEth?: number;
  minUserGasEth: number;
  sponsorEligible?: boolean;
  sponsorReason?: string;
};

function normalizeEth(value: string | undefined): number {
  const parsed = Number(value || '0');
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function decideExecutionFundingMode(params: {
  chain?: RelayerChain;
  userAddress?: string;
}): Promise<ExecutionFundingDecision> {
  const chain = (params.chain || 'sepolia') as RelayerChain;
  const userAddress = String(params.userAddress || '').trim();
  const relayerStatus = await getRelayerStatus(chain);
  const relayerBalanceEth = normalizeEth(relayerStatus.relayer.balanceEth);
  const relayerMinEth = Number(relayerStatus.relayer.minEth || 0);

  if (relayerStatus.relayer.okToExecute) {
    noteFundingRecoveryMode('relayed');
    return {
      ok: true,
      mode: 'relayed',
      chain,
      code: 'RELAYER_READY',
      relayerBalanceEth,
      relayerMinEth,
      minUserGasEth: MIN_USER_GAS_ETH,
    };
  }

  if (USER_PAYS_GAS_FALLBACK_ENABLED && /^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
    try {
      const userBalance = await getUserEthBalance(chain, userAddress);
      if (userBalance.balanceEth >= MIN_USER_GAS_ETH) {
        noteFundingRecoveryMode('user_pays_gas');
        return {
          ok: true,
          mode: 'user_pays_gas',
          chain,
          code: 'USER_PAYS_GAS_READY',
          reason: 'relayer_underfunded_user_has_gas',
          relayerBalanceEth,
          relayerMinEth,
          userBalanceEth: userBalance.balanceEth,
          minUserGasEth: MIN_USER_GAS_ETH,
        };
      }

      if (GAS_DRIP_ENABLED) {
        const sponsorCheck = await canSponsorGasDrip(chain, userAddress, GAS_DRIP_AMOUNT_ETH);
        if (sponsorCheck.ok) {
          return {
            ok: true,
            mode: 'sponsor_gas_drip',
            chain,
            code: 'SPONSOR_GAS_DRIP_READY',
            reason: 'relayer_underfunded_user_low_gas_sponsor_available',
            relayerBalanceEth,
            relayerMinEth,
            userBalanceEth: userBalance.balanceEth,
            minUserGasEth: MIN_USER_GAS_ETH,
            sponsorEligible: true,
          };
        }

        return {
          ok: false,
          mode: 'blocked',
          chain,
          code: 'INSUFFICIENT_GAS_CAPACITY',
          reason: 'relayer_underfunded_and_sponsor_unavailable',
          sponsorEligible: false,
          sponsorReason: sponsorCheck.reason,
          relayerBalanceEth,
          relayerMinEth,
          userBalanceEth: userBalance.balanceEth,
          minUserGasEth: MIN_USER_GAS_ETH,
          userMessage:
            "Insufficient gas to execute. Click 'Top up gas' or retry later.",
        };
      }

      return {
        ok: false,
        mode: 'blocked',
        chain,
        code: 'INSUFFICIENT_GAS_CAPACITY',
        reason: 'relayer_underfunded_user_low_gas',
        relayerBalanceEth,
        relayerMinEth,
        userBalanceEth: userBalance.balanceEth,
        minUserGasEth: MIN_USER_GAS_ETH,
        userMessage:
          "Insufficient gas to execute. Click 'Top up gas' or retry later.",
      };
    } catch (error: any) {
      return {
        ok: false,
        mode: 'blocked',
        chain,
        code: 'INSUFFICIENT_GAS_CAPACITY',
        reason: `user_balance_check_failed:${error?.message || 'unknown'}`,
        relayerBalanceEth,
        relayerMinEth,
        minUserGasEth: MIN_USER_GAS_ETH,
        userMessage:
          "Insufficient gas to execute. Click 'Top up gas' or retry later.",
      };
    }
  }

  if (!userAddress) {
    return {
      ok: false,
      mode: 'blocked',
      chain,
      code: 'MISSING_USER_ADDRESS',
      reason: 'user_address_required_for_gas_fallback',
      relayerBalanceEth,
      relayerMinEth,
      minUserGasEth: MIN_USER_GAS_ETH,
      userMessage:
        "Insufficient gas to execute. Connect your EVM wallet, then click 'Top up gas' or retry later.",
    };
  }

  return {
    ok: false,
    mode: 'blocked',
    chain,
    code: 'INSUFFICIENT_GAS_CAPACITY',
    reason: 'relayer_underfunded_no_fallback_mode',
    relayerBalanceEth,
    relayerMinEth,
    minUserGasEth: MIN_USER_GAS_ETH,
    userMessage:
      "Insufficient gas to execute. Click 'Top up gas' or retry later.",
  };
}
