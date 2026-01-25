/**
 * Event Markets Quote Provider
 * Fetches event market data from dFlow or Polymarket
 * Caches results in-memory for 60 seconds
 */
interface EventMarket {
    id: string;
    title: string;
    yesPrice: number;
    noPrice: number;
    volume24hUsd?: number;
    source: 'dflow' | 'polymarket' | 'fallback';
}
/**
 * Fetch event markets from dFlow if enabled, else Polymarket, else fallback
 */
export declare function getEventMarkets(limit?: number): Promise<EventMarket[]>;
/**
 * Find event market by keyword match
 */
export declare function findEventMarketByKeyword(keyword: string): Promise<EventMarket | null>;
export {};
//# sourceMappingURL=eventMarkets.d.ts.map