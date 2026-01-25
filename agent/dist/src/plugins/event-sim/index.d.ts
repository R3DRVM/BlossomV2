/**
 * Event Markets Simulation Plugin
 * Simulates event/prediction market positions
 */
import { EventPosition, EventState } from './types';
export declare function setBalanceCallbacks(getBalance: () => number, updateBalance: (delta: number) => void): void;
/**
 * Open an event position
 */
export declare function openEventPosition(eventKey: string, side: 'YES' | 'NO', stakeUsd: number, label?: string): Promise<EventPosition>;
/**
 * Get live market price for an event position (if available)
 */
export declare function getLiveEventPrice(position: EventPosition): Promise<number | undefined>;
/**
 * Update an event position's stake
 */
export declare function updateEventStake(params: {
    positionId: string;
    newStakeUsd: number;
    overrideRiskCap: boolean;
    requestedStakeUsd?: number;
}): Promise<EventPosition>;
/**
 * Close an event position
 */
export declare function closeEventPosition(id: string): Promise<{
    position: EventPosition;
    pnl: number;
    liveMarkToMarketUsd?: number;
}>;
/**
 * Get event snapshot
 */
export declare function getEventSnapshot(): EventState;
/**
 * Get total event exposure
 */
export declare function getEventExposureUsd(): number;
/**
 * Reset event state (for testing)
 */
export declare function resetEventState(): void;
//# sourceMappingURL=index.d.ts.map