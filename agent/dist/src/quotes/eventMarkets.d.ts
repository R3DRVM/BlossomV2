/**
 * Event Markets Quote Provider
 * Fetches event market data from dFlow or Polymarket
 * Caches results in-memory for 60 seconds
 *
 * IMPORTANT: dFlow uses x-api-key header for authentication (NOT Bearer token)
 *
 * Sprint 3: Now uses unified routing service with truthful metadata
 */
import { RoutingMetadata } from '../routing/routingService';
export interface EventMarket {
    id: string;
    title: string;
    yesPrice: number;
    noPrice: number;
    volume24hUsd?: number;
    source: 'dflow' | 'polymarket' | 'fallback';
}
export interface EventMarketsWithRouting {
    markets: EventMarket[];
    routing: RoutingMetadata;
}
/**
 * Fetch event markets from dFlow if enabled, else Polymarket, else fallback
 * Sprint 3: Now uses unified routing service with truthful metadata
 */
export declare function getEventMarkets(limit?: number): Promise<EventMarket[]>;
/**
 * Get event markets with routing metadata (Sprint 3)
 */
export declare function getEventMarketsWithRouting(limit?: number): Promise<EventMarketsWithRouting>;
/**
 * Find event market by keyword match
 */
export declare function findEventMarketByKeyword(keyword: string): Promise<EventMarket | null>;
//# sourceMappingURL=eventMarkets.d.ts.map