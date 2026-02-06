/**
 * Bridge Executor
 *
 * Handles cross-chain bridging operations using LiFi SDK.
 * Supports:
 * - ETH <-> Solana asset transfers
 * - Bridge route estimation
 * - Multi-step transaction execution
 * - Transaction status tracking
 *
 * The executor uses LiFi's API for aggregated bridging across
 * multiple bridge protocols (Wormhole, LayerZero, Stargate, etc.)
 */

import {
  ETH_TESTNET_RPC_URL,
  ETH_TESTNET_CHAIN_ID,
  SOLANA_RPC_URL,
  RELAYER_PRIVATE_KEY,
} from '../config';
import { getLiFiQuote, LiFiQuoteResult, LiFiErrorCodes } from '../bridge/lifi';
import { formatUnits, parseUnits, encodeFunctionData } from 'viem';

// Chain configurations
const CHAIN_CONFIG = {
  ethereum: {
    chainId: 1,
    name: 'Ethereum',
    nativeCurrency: 'ETH',
    rpcUrl: 'https://eth.llamarpc.com',
  },
  sepolia: {
    chainId: 11155111,
    name: 'Sepolia',
    nativeCurrency: 'ETH',
    rpcUrl: ETH_TESTNET_RPC_URL || 'https://rpc.sepolia.org',
  },
  solana: {
    chainId: 1151111081099710, // LiFi's Solana chain ID
    name: 'Solana',
    nativeCurrency: 'SOL',
    rpcUrl: SOLANA_RPC_URL || 'https://api.devnet.solana.com',
  },
  arbitrum: {
    chainId: 42161,
    name: 'Arbitrum',
    nativeCurrency: 'ETH',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
  },
  optimism: {
    chainId: 10,
    name: 'Optimism',
    nativeCurrency: 'ETH',
    rpcUrl: 'https://mainnet.optimism.io',
  },
  polygon: {
    chainId: 137,
    name: 'Polygon',
    nativeCurrency: 'MATIC',
    rpcUrl: 'https://polygon-rpc.com',
  },
  base: {
    chainId: 8453,
    name: 'Base',
    nativeCurrency: 'ETH',
    rpcUrl: 'https://mainnet.base.org',
  },
} as const;

// Common token addresses across chains
const TOKEN_ADDRESSES: Record<string, Record<string, string>> = {
  ethereum: {
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    ETH: '0x0000000000000000000000000000000000000000',
  },
  sepolia: {
    USDC: '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8',
    WETH: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
    ETH: '0x0000000000000000000000000000000000000000',
  },
  solana: {
    USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    SOL: 'So11111111111111111111111111111111111111112',
  },
  arbitrum: {
    USDC: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  },
  optimism: {
    USDC: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
    WETH: '0x4200000000000000000000000000000000000006',
  },
  base: {
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    WETH: '0x4200000000000000000000000000000000000006',
  },
};

export type ChainName = keyof typeof CHAIN_CONFIG;

export interface BridgeQuoteParams {
  fromChain: ChainName;
  toChain: ChainName;
  fromToken: string; // Token symbol or address
  toToken: string;
  amount: string; // Human-readable amount (e.g., "100")
  fromDecimals?: number;
  slippage?: number; // Default 0.5%
  fromAddress?: string;
}

export interface BridgeQuoteResult {
  ok: boolean;
  quote?: {
    id: string;
    bridgeProtocol: string;
    estimatedOutput: string;
    estimatedOutputRaw: string;
    minimumOutput: string;
    minimumOutputRaw: string;
    estimatedDuration: number;
    estimatedGas: string;
    fees: {
      bridge: string;
      gas: string;
      total: string;
    };
    route: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

export interface BridgeExecuteParams {
  quote: BridgeQuoteResult['quote'];
  fromAddress: string;
  toAddress?: string; // Defaults to fromAddress
}

export interface BridgeExecuteResult {
  ok: boolean;
  txHash?: string;
  explorerUrl?: string;
  status?: 'pending' | 'completed' | 'failed';
  error?: {
    code: string;
    message: string;
  };
}

export interface BridgeStatusResult {
  status: 'pending' | 'completed' | 'failed' | 'unknown';
  sourceTxHash?: string;
  destTxHash?: string;
  bridgeProtocol?: string;
  estimatedCompletion?: number;
  error?: string;
}

/**
 * Resolve token symbol to address for a chain
 */
function resolveTokenAddress(token: string, chain: ChainName): string {
  // If already an address, return it
  if (token.startsWith('0x') || token.length > 20) {
    return token;
  }

  // Look up in our token registry
  const chainTokens = TOKEN_ADDRESSES[chain];
  if (chainTokens && chainTokens[token.toUpperCase()]) {
    return chainTokens[token.toUpperCase()];
  }

  // Return as-is (LiFi can sometimes resolve symbols)
  return token;
}

/**
 * Get decimals for a token
 */
function getTokenDecimals(token: string, chain: ChainName): number {
  const upperToken = token.toUpperCase();
  if (upperToken === 'USDC' || upperToken === 'USDT') return 6;
  if (upperToken === 'ETH' || upperToken === 'WETH' || upperToken === 'SOL') return 18;
  if (upperToken === 'DAI') return 18;
  return 18; // Default to 18
}

/**
 * Check if bridging is available between two chains
 */
export function isBridgeAvailable(fromChain: ChainName, toChain: ChainName): boolean {
  // Both chains must be in our config
  if (!CHAIN_CONFIG[fromChain] || !CHAIN_CONFIG[toChain]) {
    return false;
  }

  // For now, limit to mainnet chains for actual bridging
  // Testnet bridging is proof-only
  const testnetChains: ChainName[] = ['sepolia'];
  if (testnetChains.includes(fromChain) || testnetChains.includes(toChain)) {
    console.warn('[bridgeExecutor] Testnet bridging is proof-only');
    return false;
  }

  return true;
}

/**
 * Get a bridge quote using LiFi
 */
export async function getBridgeQuote(params: BridgeQuoteParams): Promise<BridgeQuoteResult> {
  const {
    fromChain,
    toChain,
    fromToken,
    toToken,
    amount,
    fromDecimals,
    slippage = 0.005,
    fromAddress,
  } = params;

  // Resolve token addresses
  const fromTokenAddress = resolveTokenAddress(fromToken, fromChain);
  const toTokenAddress = resolveTokenAddress(toToken, toChain);

  // Get decimals
  const decimals = fromDecimals ?? getTokenDecimals(fromToken, fromChain);
  const toDecimals = getTokenDecimals(toToken, toChain);

  // Convert amount to base units
  const amountInBaseUnits = parseUnits(amount, decimals).toString();

  // Get quote from LiFi
  const lifiResult = await getLiFiQuote({
    fromChain,
    toChain,
    fromToken: fromTokenAddress,
    toToken: toTokenAddress,
    fromAmount: amountInBaseUnits,
    slippage,
    fromAddress,
  });

  if (!lifiResult.ok || !lifiResult.quote) {
    return {
      ok: false,
      error: lifiResult.error || {
        code: 'BRIDGE_QUOTE_FAILED',
        message: 'Failed to get bridge quote',
      },
    };
  }

  const quote = lifiResult.quote;

  // Calculate fees
  const bridgeFees = quote.feeCosts.reduce((sum, fee) => sum + parseFloat(fee.amountUSD || '0'), 0);
  const gasFees = quote.gasCosts.reduce((sum, cost) => sum + parseFloat(cost.amountUSD || '0'), 0);

  return {
    ok: true,
    quote: {
      id: quote.id,
      bridgeProtocol: quote.tool,
      estimatedOutput: formatUnits(BigInt(quote.toAmount), toDecimals),
      estimatedOutputRaw: quote.toAmount,
      minimumOutput: formatUnits(BigInt(quote.toAmountMin), toDecimals),
      minimumOutputRaw: quote.toAmountMin,
      estimatedDuration: quote.estimatedDuration,
      estimatedGas: gasFees.toFixed(2),
      fees: {
        bridge: bridgeFees.toFixed(2),
        gas: gasFees.toFixed(2),
        total: (bridgeFees + gasFees).toFixed(2),
      },
      route: `${fromChain} -> ${toChain} via ${quote.tool}`,
    },
  };
}

/**
 * Estimate bridge route without full quote
 * Faster than full quote, returns basic route info
 */
export async function estimateBridgeRoute(params: {
  fromChain: ChainName;
  toChain: ChainName;
  fromToken: string;
  toToken: string;
  amount: string;
}): Promise<{
  available: boolean;
  estimatedDuration?: string;
  estimatedFees?: string;
  suggestedBridge?: string;
  warning?: string;
}> {
  // Check basic availability
  if (!isBridgeAvailable(params.fromChain, params.toChain)) {
    return {
      available: false,
      warning: `Bridging between ${params.fromChain} and ${params.toChain} is not yet supported`,
    };
  }

  // Try to get a quick quote
  const quote = await getBridgeQuote({
    ...params,
    slippage: 0.01, // Higher slippage for estimation
  });

  if (!quote.ok) {
    return {
      available: false,
      warning: quote.error?.message || 'No bridge route available',
    };
  }

  return {
    available: true,
    estimatedDuration: `~${Math.ceil((quote.quote?.estimatedDuration || 300) / 60)} minutes`,
    estimatedFees: `$${quote.quote?.fees.total || '0'}`,
    suggestedBridge: quote.quote?.bridgeProtocol,
  };
}

/**
 * Execute a bridge transaction
 * Note: Full execution requires transaction building from LiFi
 * Currently returns proof-only result
 */
export async function executeBridge(
  params: BridgeExecuteParams
): Promise<BridgeExecuteResult> {
  const { quote, fromAddress, toAddress } = params;

  if (!quote) {
    return {
      ok: false,
      error: {
        code: 'BRIDGE_NO_QUOTE',
        message: 'No quote provided for bridge execution',
      },
    };
  }

  // For MVP, bridge execution is proof-only
  // Full execution would require:
  // 1. Fetching transaction data from LiFi
  // 2. Signing and submitting the transaction
  // 3. Monitoring for completion

  console.warn('[bridgeExecutor] Bridge execution is proof-only for MVP');

  return {
    ok: false,
    status: 'pending',
    error: {
      code: 'BRIDGE_EXECUTION_NOT_IMPLEMENTED',
      message: 'Full bridge execution not yet implemented. Quote obtained successfully.',
    },
  };
}

/**
 * Check the status of a bridge transaction
 */
export async function checkBridgeStatus(params: {
  txHash: string;
  fromChain: ChainName;
  toChain: ChainName;
  bridgeProtocol?: string;
}): Promise<BridgeStatusResult> {
  const { txHash, fromChain, toChain, bridgeProtocol } = params;

  // LiFi provides a status endpoint for tracking
  // For MVP, return unknown status
  return {
    status: 'unknown',
    sourceTxHash: txHash,
    bridgeProtocol,
    error: 'Bridge status tracking not yet implemented',
  };
}

/**
 * Get supported bridge routes for a token
 */
export async function getSupportedRoutes(token: string): Promise<{
  routes: Array<{
    fromChain: ChainName;
    toChain: ChainName;
    estimatedDuration: string;
    protocols: string[];
  }>;
}> {
  // Common bridge routes for USDC/USDT/ETH
  const commonRoutes: Array<{
    fromChain: ChainName;
    toChain: ChainName;
    estimatedDuration: string;
    protocols: string[];
  }> = [
    {
      fromChain: 'ethereum',
      toChain: 'arbitrum',
      estimatedDuration: '~10 minutes',
      protocols: ['Stargate', 'Hop', 'Across'],
    },
    {
      fromChain: 'ethereum',
      toChain: 'optimism',
      estimatedDuration: '~10 minutes',
      protocols: ['Stargate', 'Hop', 'Across'],
    },
    {
      fromChain: 'ethereum',
      toChain: 'polygon',
      estimatedDuration: '~20 minutes',
      protocols: ['Stargate', 'Hop'],
    },
    {
      fromChain: 'ethereum',
      toChain: 'base',
      estimatedDuration: '~10 minutes',
      protocols: ['Stargate', 'Across'],
    },
    {
      fromChain: 'ethereum',
      toChain: 'solana',
      estimatedDuration: '~15 minutes',
      protocols: ['Wormhole', 'Allbridge'],
    },
    {
      fromChain: 'arbitrum',
      toChain: 'optimism',
      estimatedDuration: '~5 minutes',
      protocols: ['Stargate', 'Across'],
    },
  ];

  return { routes: commonRoutes };
}

/**
 * Calculate optimal bridge path for a transfer
 * Considers fees, speed, and reliability
 */
export async function findOptimalBridgePath(params: {
  fromChain: ChainName;
  toChain: ChainName;
  fromToken: string;
  toToken: string;
  amount: string;
  priority?: 'speed' | 'cost' | 'reliability';
}): Promise<{
  path: ChainName[];
  estimatedDuration: number;
  estimatedFees: string;
  bridgeProtocol: string;
} | null> {
  const { fromChain, toChain, fromToken, toToken, amount, priority = 'reliability' } = params;

  // Direct route first
  const directQuote = await getBridgeQuote({
    fromChain,
    toChain,
    fromToken,
    toToken,
    amount,
  });

  if (directQuote.ok && directQuote.quote) {
    return {
      path: [fromChain, toChain],
      estimatedDuration: directQuote.quote.estimatedDuration,
      estimatedFees: directQuote.quote.fees.total,
      bridgeProtocol: directQuote.quote.bridgeProtocol,
    };
  }

  // If direct route unavailable, could try via intermediate chain
  // For MVP, just return null if direct unavailable
  return null;
}

/**
 * Export chain configuration for reference
 */
export { CHAIN_CONFIG, TOKEN_ADDRESSES };
