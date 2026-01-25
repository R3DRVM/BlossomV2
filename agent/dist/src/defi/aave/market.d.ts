/**
 * Aave v3 Market Configuration
 * Single source of truth for Aave v3 testnet market data
 */
import { Address } from 'viem';
export interface AaveMarketConfig {
    chainId: number;
    poolAddress: Address;
    poolAddressesProvider: Address;
    poolDataProvider: Address;
    supportedAssets: AaveAsset[];
}
export interface AaveAsset {
    symbol: string;
    address: Address;
    aTokenAddress: Address;
    decimals: number;
}
/**
 * Get Aave market configuration for the current chain
 */
export declare function getAaveMarketConfig(): Promise<AaveMarketConfig>;
/**
 * Fetch aToken address for an asset using PoolDataProvider
 */
export declare function getATokenAddress(assetAddress: Address): Promise<Address | null>;
/**
 * Get supported asset by symbol
 */
export declare function getSupportedAsset(symbol: string): Promise<AaveAsset | null>;
/**
 * Get all supported assets with aToken addresses
 */
export declare function getSupportedAssets(): Promise<AaveAsset[]>;
//# sourceMappingURL=market.d.ts.map