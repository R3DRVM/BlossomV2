/**
 * Perps Simulation Plugin
 * Simulates perpetual futures trading
 */
import { PerpPosition, PerpsAccountState } from './types';
/**
 * Open a perp position
 */
export declare function openPerp(spec: {
    market: string;
    side: 'long' | 'short';
    riskPct: number;
    entry?: number;
    takeProfit?: number;
    stopLoss?: number;
}): Promise<PerpPosition>;
/**
 * Close a perp position
 */
export declare function closePerp(id: string): Promise<{
    position: PerpPosition;
    pnl: number;
}>;
/**
 * Get perps account snapshot
 */
export declare function getPerpsSnapshot(): PerpsAccountState;
/**
 * Update USDC balance (for DeFi/Event sims to sync)
 */
export declare function updateUsdcBalance(delta: number): void;
/**
 * Get current USDC balance
 */
export declare function getUsdcBalance(): number;
/**
 * Reset account to initial state (for testing)
 */
export declare function resetPerpsAccount(): void;
//# sourceMappingURL=index.d.ts.map