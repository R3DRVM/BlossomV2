import { baseSepolia, sepolia } from 'viem/chains';
import type { Chain } from 'viem';
import {
  BASE_RPC_FALLBACK_URLS,
  BASE_SEPOLIA_RPC_URL,
  BUSDC_ADDRESS_BASE_SEPOLIA,
  DEFAULT_SETTLEMENT_CHAIN,
  DEMO_BUSDC_ADDRESS,
  DEMO_PERP_ADAPTER_ADDRESS,
  DEMO_PERP_ADAPTER_ADDRESS_BASE_SEPOLIA,
  DEMO_WETH_ADDRESS,
  DEMO_WETH_ADDRESS_BASE_SEPOLIA,
  ETH_RPC_FALLBACK_URLS,
  ETH_SEPOLIA_RPC_URL,
  EXECUTION_ROUTER_ADDRESS,
  EXECUTION_ROUTER_ADDRESS_BASE_SEPOLIA,
  FUNDING_WALLET_FLOOR_ETH_BASE_SEPOLIA,
  FUNDING_WALLET_FLOOR_ETH_SEPOLIA,
  FUNDING_WALLET_PRIVATE_KEY_BASE_SEPOLIA,
  FUNDING_WALLET_PRIVATE_KEY_SEPOLIA,
  MIN_RELAYER_ETH_BASE_SEPOLIA,
  MIN_RELAYER_ETH_SEPOLIA,
  RELAYER_PRIVATE_KEY,
  RELAYER_PRIVATE_KEY_BASE_SEPOLIA,
  TARGET_RELAYER_ETH_BASE_SEPOLIA,
  TARGET_RELAYER_ETH_SEPOLIA,
  type SettlementChain,
} from '../config';

export type { SettlementChain };

export type CanonicalSettlementChain = 'ethereum_sepolia' | 'base_sepolia';

export type SettlementChainRuntimeConfig = {
  key: SettlementChain;
  canonical: CanonicalSettlementChain;
  label: string;
  chain: Chain;
  rpcUrl?: string;
  rpcFallbackUrls: string[];
  explorerTxBaseUrl: string;
  stableTokenAddress?: `0x${string}`;
  wethTokenAddress?: `0x${string}`;
  perpAdapterAddress?: `0x${string}`;
  executionRouterAddress?: `0x${string}`;
  relayerPrivateKey?: string;
  fundingPrivateKey?: string;
  minRelayerEth: number;
  targetRelayerEth: number;
  fundingFloorEth: number;
};

function asAddress(value: string | undefined): `0x${string}` | undefined {
  const normalized = String(value || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) {
    return undefined;
  }
  return normalized as `0x${string}`;
}

export function normalizeSettlementChain(input?: string): SettlementChain {
  const value = String(input || '').trim().toLowerCase();
  if (!value) return DEFAULT_SETTLEMENT_CHAIN;
  if (value === 'base' || value === 'base-sepolia' || value === 'base_sepolia') return 'base_sepolia';
  if (
    value === 'sepolia' ||
    value === 'ethereum_sepolia' ||
    value === 'eth_sepolia' ||
    value === 'ethereum'
  ) {
    return 'sepolia';
  }
  return DEFAULT_SETTLEMENT_CHAIN;
}

export function toCanonicalSettlementChain(chain: SettlementChain): CanonicalSettlementChain {
  return chain === 'base_sepolia' ? 'base_sepolia' : 'ethereum_sepolia';
}

export function getSettlementChainRuntimeConfig(input?: string): SettlementChainRuntimeConfig {
  const chain = normalizeSettlementChain(input);

  if (chain === 'base_sepolia') {
    return {
      key: 'base_sepolia',
      canonical: 'base_sepolia',
      label: 'Base Sepolia',
      chain: baseSepolia,
      rpcUrl: BASE_SEPOLIA_RPC_URL,
      rpcFallbackUrls: BASE_RPC_FALLBACK_URLS,
      explorerTxBaseUrl: 'https://sepolia.basescan.org/tx/',
      stableTokenAddress: asAddress(BUSDC_ADDRESS_BASE_SEPOLIA),
      wethTokenAddress: asAddress(DEMO_WETH_ADDRESS_BASE_SEPOLIA),
      perpAdapterAddress: asAddress(DEMO_PERP_ADAPTER_ADDRESS_BASE_SEPOLIA),
      executionRouterAddress: asAddress(EXECUTION_ROUTER_ADDRESS_BASE_SEPOLIA),
      relayerPrivateKey: RELAYER_PRIVATE_KEY_BASE_SEPOLIA || RELAYER_PRIVATE_KEY,
      fundingPrivateKey: FUNDING_WALLET_PRIVATE_KEY_BASE_SEPOLIA || FUNDING_WALLET_PRIVATE_KEY_SEPOLIA,
      minRelayerEth: MIN_RELAYER_ETH_BASE_SEPOLIA,
      targetRelayerEth: TARGET_RELAYER_ETH_BASE_SEPOLIA,
      fundingFloorEth: FUNDING_WALLET_FLOOR_ETH_BASE_SEPOLIA,
    };
  }

  return {
    key: 'sepolia',
    canonical: 'ethereum_sepolia',
    label: 'Ethereum Sepolia',
    chain: sepolia,
    rpcUrl: ETH_SEPOLIA_RPC_URL,
    rpcFallbackUrls: ETH_RPC_FALLBACK_URLS,
    explorerTxBaseUrl: 'https://sepolia.etherscan.io/tx/',
    stableTokenAddress: asAddress(DEMO_BUSDC_ADDRESS),
    wethTokenAddress: asAddress(DEMO_WETH_ADDRESS),
    perpAdapterAddress: asAddress(DEMO_PERP_ADAPTER_ADDRESS),
    executionRouterAddress: asAddress(EXECUTION_ROUTER_ADDRESS),
    relayerPrivateKey: RELAYER_PRIVATE_KEY,
    fundingPrivateKey: FUNDING_WALLET_PRIVATE_KEY_SEPOLIA,
    minRelayerEth: MIN_RELAYER_ETH_SEPOLIA,
    targetRelayerEth: TARGET_RELAYER_ETH_SEPOLIA,
    fundingFloorEth: FUNDING_WALLET_FLOOR_ETH_SEPOLIA,
  };
}

export function isSettlementChainExecutionReady(input?: string): boolean {
  const cfg = getSettlementChainRuntimeConfig(input);
  return !!(cfg.rpcUrl && cfg.stableTokenAddress && cfg.perpAdapterAddress && cfg.executionRouterAddress);
}

export function resolveExecutionSettlementChain(
  preferred?: string,
  options?: { allowFallback?: boolean }
): SettlementChain {
  const preferredChain = normalizeSettlementChain(preferred);
  const allowFallback = options?.allowFallback !== false;
  if (isSettlementChainExecutionReady(preferredChain)) {
    return preferredChain;
  }
  if (!allowFallback) {
    return preferredChain;
  }
  if (preferredChain !== 'sepolia' && isSettlementChainExecutionReady('sepolia')) {
    return 'sepolia';
  }
  return preferredChain;
}

export function getExplorerTxUrl(chain: string | undefined, txHash: string): string {
  const runtime = getSettlementChainRuntimeConfig(chain);
  return `${runtime.explorerTxBaseUrl}${txHash}`;
}
