/**
 * Aave Position Reader
 * Reads aToken balances and position data from chain
 */

import { Address } from 'viem';
import { ETH_TESTNET_RPC_URL } from '../../config';
import { getAaveMarketConfig, getSupportedAssets, type AaveAsset } from './market';
import { erc20_balanceOf } from '../../executors/erc20Rpc';

export interface AavePosition {
  asset: string;
  assetAddress: Address;
  aTokenAddress: Address;
  balance: bigint;
  balanceFormatted: string;
  underlyingValueUsd?: number; // Best-effort USD value
  supplyAPY?: number; // Best-effort APY from reserve data
}

/**
 * Read all Aave positions for a user
 */
export async function readAavePositions(userAddress: Address): Promise<AavePosition[]> {
  if (!ETH_TESTNET_RPC_URL) {
    console.warn('[aave/positions] ETH_TESTNET_RPC_URL not configured');
    return [];
  }

  try {
    const marketConfig = await getAaveMarketConfig();
    const supportedAssets = await getSupportedAssets();
    const positions: AavePosition[] = [];

    for (const asset of supportedAssets) {
      try {
        // Fetch aToken address if not already set
        let aTokenAddress = asset.aTokenAddress;
        if (aTokenAddress === '0x0000000000000000000000000000000000000000') {
          const fetched = await import('./market').then(m => m.getATokenAddress(asset.address));
          if (fetched) {
            aTokenAddress = fetched;
          } else {
            continue; // Skip if we can't get aToken address
          }
        }

        // Read aToken balance
        const balance = await erc20_balanceOf(aTokenAddress, userAddress);
        
        if (balance > 0n) {
          // Format balance based on decimals
          const decimals = asset.decimals;
          const divisor = BigInt(10 ** decimals);
          const whole = balance / divisor;
          const fraction = balance % divisor;
          const balanceFormatted = `${whole.toString()}.${fraction.toString().padStart(decimals, '0').replace(/\.?0+$/, '')}`;

          positions.push({
            asset: asset.symbol,
            assetAddress: asset.address,
            aTokenAddress,
            balance,
            balanceFormatted,
            // Best-effort USD value (assume 1:1 for REDACTED)
            underlyingValueUsd: asset.symbol === 'REDACTED' ? parseFloat(balanceFormatted) : undefined,
            // APY would require fetching from PoolDataProvider.getReserveData
            // For now, we'll leave it undefined and let the frontend handle it
          });
        }
      } catch (error: any) {
        console.warn(`[aave/positions] Failed to read position for ${asset.symbol}:`, error.message);
        // Continue with other assets
      }
    }

    return positions;
  } catch (error: any) {
    console.error('[aave/positions] Failed to read Aave positions:', error.message);
    return [];
  }
}

/**
 * Read a single Aave position for a specific asset
 */
export async function readAavePosition(
  userAddress: Address,
  assetSymbol: string
): Promise<AavePosition | null> {
  const positions = await readAavePositions(userAddress);
  return positions.find(p => p.asset === assetSymbol) || null;
}
