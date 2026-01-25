/**
 * DeFi Simulation Types
 */
export interface DefiPosition {
    id: string;
    protocol: 'Kamino' | 'RootsFi' | 'Jet';
    asset: string;
    depositUsd: number;
    apr: number;
    openedAt: number;
    isClosed: boolean;
    closedAt?: number;
    yieldEarnedUsd?: number;
}
export interface DefiState {
    positions: DefiPosition[];
}
//# sourceMappingURL=types.d.ts.map