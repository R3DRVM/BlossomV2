/**
 * Event Markets Simulation Types
 */
export interface EventMarket {
    key: string;
    label: string;
    winProbability: number;
    payoutMultiple: number;
}
export interface EventPosition {
    id: string;
    eventKey: string;
    label: string;
    side: 'YES' | 'NO';
    stakeUsd: number;
    maxPayoutUsd: number;
    maxLossUsd: number;
    outcome?: 'won' | 'lost';
    isClosed: boolean;
    closedAt?: number;
    realizedPnlUsd?: number;
    marketSource?: 'KALSHI' | 'POLYMARKET' | 'DEMO';
    externalMarketId?: string;
    overrideRiskCap?: boolean;
    requestedStakeUsd?: number;
}
export interface EventState {
    markets: EventMarket[];
    positions: EventPosition[];
}
//# sourceMappingURL=types.d.ts.map