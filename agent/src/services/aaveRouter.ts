/**
 * Aave V3 Router Service
 *
 * Provides real Aave V3 integration for lending operations.
 * Supports:
 * - Supply (deposit) operations
 * - Withdraw operations
 * - Reserve data fetching
 * - APY calculations
 * - Health factor monitoring
 *
 * This enables real Aave V3 lending on Sepolia testnet.
 */

import {
  ETH_TESTNET_RPC_URL,
  ETH_TESTNET_CHAIN_ID,
  AAVE_POOL_ADDRESS_SEPOLIA,
  AAVE_ADAPTER_ADDRESS,
  AAVE_REDACTED_ADDRESS,
  AAVE_WETH_ADDRESS,
  LENDING_EXECUTION_MODE,
} from '../config';
import { formatUnits, parseUnits, encodeFunctionData, decodeFunctionResult } from 'viem';
import { getAaveMarketConfig, getSupportedAsset, AaveAsset } from '../defi/aave/market';

// Aave V3 Pool address on Sepolia
const AAVE_V3_POOL = AAVE_POOL_ADDRESS_SEPOLIA || '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951';
const AAVE_DATA_PROVIDER = '0x3e9708d80f7B3e43118013075F7e95CE3AB31F31';
const AAVE_POOL_ADDRESSES_PROVIDER = '0x012bAC54348C0E635dCAc9D5FB99f06F24136C9A';

// Common Sepolia testnet token addresses
const SEPOLIA_TOKENS: Record<string, { address: string; decimals: number }> = {
  USDC: { address: '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8', decimals: 6 },
  WETH: { address: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', decimals: 18 },
  DAI: { address: '0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357', decimals: 18 },
  LINK: { address: '0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5', decimals: 18 },
};

export interface AaveSupplyParams {
  asset: string;
  amount: string;
  onBehalfOf: string;
  referralCode?: number;
}

export interface AaveWithdrawParams {
  asset: string;
  amount: string; // Use MAX_UINT256 for max withdrawal
  to: string;
}

export interface AaveReserveData {
  symbol: string;
  asset: string;
  aTokenAddress: string;
  supplyRate: string;
  supplyAPY: number;
  variableBorrowRate: string;
  variableBorrowAPY: number;
  totalSupply: string;
  totalBorrow: string;
  availableLiquidity: string;
  utilizationRate: number;
  liquidationThreshold: number;
  ltv: number;
}

export interface AaveUserData {
  totalCollateralBase: string;
  totalDebtBase: string;
  availableBorrowsBase: string;
  currentLiquidationThreshold: string;
  ltv: string;
  healthFactor: string;
}

export interface AaveUserReserveData {
  asset: string;
  currentATokenBalance: string;
  currentVariableDebt: string;
  scaledVariableDebt: string;
  principalStableDebt: string;
  usageAsCollateralEnabled: boolean;
}

// Pool ABI for supply/withdraw
const POOL_ABI = [
  {
    name: 'supply',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'onBehalfOf', type: 'address' },
      { name: 'referralCode', type: 'uint16' },
    ],
    outputs: [],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'to', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getUserAccountData',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [
      { name: 'totalCollateralBase', type: 'uint256' },
      { name: 'totalDebtBase', type: 'uint256' },
      { name: 'availableBorrowsBase', type: 'uint256' },
      { name: 'currentLiquidationThreshold', type: 'uint256' },
      { name: 'ltv', type: 'uint256' },
      { name: 'healthFactor', type: 'uint256' },
    ],
  },
] as const;

// PoolDataProvider ABI for reserve data
const DATA_PROVIDER_ABI = [
  {
    name: 'getReserveData',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'asset', type: 'address' }],
    outputs: [
      { name: 'unbacked', type: 'uint256' },
      { name: 'accruedToTreasuryScaled', type: 'uint256' },
      { name: 'totalAToken', type: 'uint256' },
      { name: 'totalStableDebt', type: 'uint256' },
      { name: 'totalVariableDebt', type: 'uint256' },
      { name: 'liquidityRate', type: 'uint256' },
      { name: 'variableBorrowRate', type: 'uint256' },
      { name: 'stableBorrowRate', type: 'uint256' },
      { name: 'averageStableBorrowRate', type: 'uint256' },
      { name: 'liquidityIndex', type: 'uint256' },
      { name: 'variableBorrowIndex', type: 'uint256' },
      { name: 'lastUpdateTimestamp', type: 'uint40' },
    ],
  },
  {
    name: 'getUserReserveData',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'user', type: 'address' },
    ],
    outputs: [
      { name: 'currentATokenBalance', type: 'uint256' },
      { name: 'currentStableDebt', type: 'uint256' },
      { name: 'currentVariableDebt', type: 'uint256' },
      { name: 'principalStableDebt', type: 'uint256' },
      { name: 'scaledVariableDebt', type: 'uint256' },
      { name: 'stableBorrowRate', type: 'uint256' },
      { name: 'liquidityRate', type: 'uint256' },
      { name: 'stableRateLastUpdated', type: 'uint40' },
      { name: 'usageAsCollateralEnabled', type: 'bool' },
    ],
  },
  {
    name: 'getReserveConfigurationData',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'asset', type: 'address' }],
    outputs: [
      { name: 'decimals', type: 'uint256' },
      { name: 'ltv', type: 'uint256' },
      { name: 'liquidationThreshold', type: 'uint256' },
      { name: 'liquidationBonus', type: 'uint256' },
      { name: 'reserveFactor', type: 'uint256' },
      { name: 'usageAsCollateralEnabled', type: 'bool' },
      { name: 'borrowingEnabled', type: 'bool' },
      { name: 'stableBorrowRateEnabled', type: 'bool' },
      { name: 'isActive', type: 'bool' },
      { name: 'isFrozen', type: 'bool' },
    ],
  },
] as const;

// RAY = 10^27 (Aave uses this for rate calculations)
const RAY = 10n ** 27n;

/**
 * Check if Aave router is available
 */
export function isAaveRouterAvailable(): boolean {
  return !!(ETH_TESTNET_RPC_URL && AAVE_V3_POOL);
}

/**
 * Convert Aave ray rate to APY percentage
 */
function rayToAPY(rayRate: bigint): number {
  // APY = (1 + rate/RAY)^secondsPerYear - 1
  const ratePerSecond = Number(rayRate) / Number(RAY);
  const secondsPerYear = 365 * 24 * 60 * 60;
  const apy = Math.pow(1 + ratePerSecond, secondsPerYear) - 1;
  return apy * 100; // Return as percentage
}

/**
 * Make an RPC call to the Aave contracts
 */
async function rpcCall(to: string, data: string): Promise<string | null> {
  if (!ETH_TESTNET_RPC_URL) {
    return null;
  }

  try {
    const response = await fetch(ETH_TESTNET_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to, data }, 'latest'],
      }),
    });

    const result = await response.json();
    if (result.error) {
      console.warn('[aaveRouter] RPC error:', result.error);
      return null;
    }

    return result.result;
  } catch (error: any) {
    console.warn('[aaveRouter] RPC call failed:', error.message);
    return null;
  }
}

/**
 * Get reserve data for an asset
 */
export async function getReserveData(assetAddress: string): Promise<AaveReserveData | null> {
  try {
    const callData = encodeFunctionData({
      abi: DATA_PROVIDER_ABI,
      functionName: 'getReserveData',
      args: [assetAddress as `0x${string}`],
    });

    const result = await rpcCall(AAVE_DATA_PROVIDER, callData);
    if (!result || result === '0x') {
      return null;
    }

    const decoded = decodeFunctionResult({
      abi: DATA_PROVIDER_ABI,
      functionName: 'getReserveData',
      data: result as `0x${string}`,
    });

    // Get configuration data for LTV and liquidation threshold
    const configData = encodeFunctionData({
      abi: DATA_PROVIDER_ABI,
      functionName: 'getReserveConfigurationData',
      args: [assetAddress as `0x${string}`],
    });

    const configResult = await rpcCall(AAVE_DATA_PROVIDER, configData);
    let ltv = 0;
    let liquidationThreshold = 0;

    if (configResult && configResult !== '0x') {
      const configDecoded = decodeFunctionResult({
        abi: DATA_PROVIDER_ABI,
        functionName: 'getReserveConfigurationData',
        data: configResult as `0x${string}`,
      });
      ltv = Number(configDecoded[1]) / 100; // Convert from bps
      liquidationThreshold = Number(configDecoded[2]) / 100;
    }

    const totalSupply = decoded[2].toString();
    const totalBorrow = (decoded[3] + decoded[4]).toString();
    const availableLiquidity = (decoded[2] - decoded[3] - decoded[4]).toString();

    // Calculate utilization rate
    const utilizationRate =
      decoded[2] > 0n
        ? Number((decoded[4] * 10000n) / decoded[2]) / 100
        : 0;

    return {
      symbol: 'UNKNOWN', // Would need separate lookup
      asset: assetAddress,
      aTokenAddress: '', // Would need separate lookup
      supplyRate: decoded[5].toString(),
      supplyAPY: rayToAPY(decoded[5]),
      variableBorrowRate: decoded[6].toString(),
      variableBorrowAPY: rayToAPY(decoded[6]),
      totalSupply,
      totalBorrow,
      availableLiquidity,
      utilizationRate,
      liquidationThreshold,
      ltv,
    };
  } catch (error: any) {
    console.warn('[aaveRouter] getReserveData error:', error.message);
    return null;
  }
}

/**
 * Get user account data from Aave
 */
export async function getUserAccountData(userAddress: string): Promise<AaveUserData | null> {
  try {
    const callData = encodeFunctionData({
      abi: POOL_ABI,
      functionName: 'getUserAccountData',
      args: [userAddress as `0x${string}`],
    });

    const result = await rpcCall(AAVE_V3_POOL, callData);
    if (!result || result === '0x') {
      return null;
    }

    const decoded = decodeFunctionResult({
      abi: POOL_ABI,
      functionName: 'getUserAccountData',
      data: result as `0x${string}`,
    });

    return {
      totalCollateralBase: decoded[0].toString(),
      totalDebtBase: decoded[1].toString(),
      availableBorrowsBase: decoded[2].toString(),
      currentLiquidationThreshold: decoded[3].toString(),
      ltv: decoded[4].toString(),
      healthFactor: decoded[5].toString(),
    };
  } catch (error: any) {
    console.warn('[aaveRouter] getUserAccountData error:', error.message);
    return null;
  }
}

/**
 * Get user's position in a specific reserve
 */
export async function getUserReserveData(
  assetAddress: string,
  userAddress: string
): Promise<AaveUserReserveData | null> {
  try {
    const callData = encodeFunctionData({
      abi: DATA_PROVIDER_ABI,
      functionName: 'getUserReserveData',
      args: [assetAddress as `0x${string}`, userAddress as `0x${string}`],
    });

    const result = await rpcCall(AAVE_DATA_PROVIDER, callData);
    if (!result || result === '0x') {
      return null;
    }

    const decoded = decodeFunctionResult({
      abi: DATA_PROVIDER_ABI,
      functionName: 'getUserReserveData',
      data: result as `0x${string}`,
    });

    return {
      asset: assetAddress,
      currentATokenBalance: decoded[0].toString(),
      currentVariableDebt: decoded[2].toString(),
      scaledVariableDebt: decoded[4].toString(),
      principalStableDebt: decoded[3].toString(),
      usageAsCollateralEnabled: decoded[8],
    };
  } catch (error: any) {
    console.warn('[aaveRouter] getUserReserveData error:', error.message);
    return null;
  }
}

/**
 * Build supply calldata for AaveV3SupplyAdapter
 * This is used when executing supplies through the ExecutionRouter
 */
export function buildSupplyAdapterData(params: AaveSupplyParams): `0x${string}` {
  const { encodeAbiParameters } = require('viem');

  return encodeAbiParameters(
    [
      { type: 'address' }, // asset
      { type: 'address' }, // vault (pool address, ignored by adapter)
      { type: 'uint256' }, // amount
      { type: 'address' }, // onBehalfOf
    ],
    [
      params.asset as `0x${string}`,
      AAVE_V3_POOL as `0x${string}`, // Ignored by adapter, uses constructor value
      BigInt(params.amount),
      params.onBehalfOf as `0x${string}`,
    ]
  );
}

/**
 * Build withdraw calldata for direct Pool interaction
 * Note: Withdraw adapter not yet implemented, would need to build
 */
export function buildWithdrawCalldata(params: AaveWithdrawParams): `0x${string}` {
  return encodeFunctionData({
    abi: POOL_ABI,
    functionName: 'withdraw',
    args: [
      params.asset as `0x${string}`,
      BigInt(params.amount),
      params.to as `0x${string}`,
    ],
  });
}

/**
 * Get current supply APY for an asset
 */
export async function getSupplyAPY(assetAddress: string): Promise<number | null> {
  const reserveData = await getReserveData(assetAddress);
  return reserveData?.supplyAPY ?? null;
}

/**
 * Get lending parameters with routing decision
 * Integrates reserve data fetching and APY calculation
 */
export async function getLendingWithRouting(params: {
  asset: string;
  amount: string;
  onBehalfOf: string;
}): Promise<{
  params: AaveSupplyParams;
  reserveData: AaveReserveData;
  estimatedAPY: number;
  routingSource: 'aave';
} | null> {
  const { asset, amount, onBehalfOf } = params;

  // Get reserve data
  const reserveData = await getReserveData(asset);
  if (!reserveData) {
    return null;
  }

  return {
    params: {
      asset,
      amount,
      onBehalfOf,
      referralCode: 0,
    },
    reserveData,
    estimatedAPY: reserveData.supplyAPY,
    routingSource: 'aave',
  };
}

/**
 * Check health factor and determine if action is safe
 */
export async function checkHealthFactor(userAddress: string): Promise<{
  healthFactor: number;
  isSafe: boolean;
  warning?: string;
}> {
  const userData = await getUserAccountData(userAddress);
  if (!userData) {
    return { healthFactor: 0, isSafe: false, warning: 'Could not fetch user data' };
  }

  // Health factor is in WAD (1e18)
  const healthFactor = Number(userData.healthFactor) / 1e18;
  const isSafe = healthFactor >= 1.0;

  let warning: string | undefined;
  if (healthFactor < 1.0) {
    warning = 'Position at risk of liquidation!';
  } else if (healthFactor < 1.5) {
    warning = 'Health factor is low, consider adding collateral';
  }

  return { healthFactor, isSafe, warning };
}

/**
 * Get supported assets for Aave on current network
 */
export async function getSupportedAssets(): Promise<{
  symbol: string;
  address: string;
  decimals: number;
}[]> {
  // Use market config for dynamic asset lookup
  const marketConfig = await getAaveMarketConfig();

  const assets = marketConfig.supportedAssets.map((asset) => ({
    symbol: asset.symbol,
    address: asset.address,
    decimals: asset.decimals,
  }));

  // Add WETH if configured
  if (AAVE_WETH_ADDRESS) {
    assets.push({
      symbol: 'WETH',
      address: AAVE_WETH_ADDRESS,
      decimals: 18,
    });
  }

  return assets;
}

/**
 * Export pool addresses for reference
 */
export const AAVE_ADDRESSES = {
  pool: AAVE_V3_POOL,
  dataProvider: AAVE_DATA_PROVIDER,
  poolAddressesProvider: AAVE_POOL_ADDRESSES_PROVIDER,
} as const;
