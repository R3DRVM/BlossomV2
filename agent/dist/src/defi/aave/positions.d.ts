/**
 * Aave Position Reader
 * Reads aToken balances and position data from chain
 */
import { Address } from 'viem';
export interface AavePosition {
    asset: string;
    assetAddress: Address;
    aTokenAddress: Address;
    balance: bigint;
    balanceFormatted: string;
    underlyingValueUsd?: number;
    supplyAPY?: number;
}
/**
 * Read all Aave positions for a user
 */
export declare function readAavePositions(userAddress: Address): Promise<AavePosition[]>;
/**
 * Read a single Aave position for a specific asset
 */
export declare function readAavePosition(userAddress: Address, assetSymbol: string): Promise<AavePosition | null>;
//# sourceMappingURL=positions.d.ts.map