/**
 * DeFi Simulation Plugin
 * Simulates DeFi yield farming positions
 */
import { DefiPosition, DefiState } from './types';
export declare function setBalanceCallbacks(getBalance: () => number, updateBalance: (delta: number) => void): void;
/**
 * Open a DeFi position
 */
export declare function openDefiPosition(protocol: 'Kamino' | 'RootsFi' | 'Jet', asset: string, amountUsd: number): DefiPosition;
/**
 * Close a DeFi position
 */
export declare function closeDefiPosition(id: string): {
    position: DefiPosition;
    yieldEarned: number;
};
/**
 * Get DeFi snapshot
 */
export declare function getDefiSnapshot(): DefiState;
/**
 * Reset DeFi state (for testing)
 */
export declare function resetDefiState(): void;
//# sourceMappingURL=index.d.ts.map