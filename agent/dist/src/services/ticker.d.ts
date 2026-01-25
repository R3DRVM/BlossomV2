/**
 * Ticker Service
 * Provides live price ticker for on-chain assets and event markets
 */
export interface TickerItem {
    label: string;
    value: string;
    change?: string;
    meta?: string;
    impliedProb?: number;
    lean?: 'YES' | 'NO';
}
export interface TickerSection {
    id: 'majors' | 'gainers' | 'defi' | 'kalshi' | 'polymarket';
    label: string;
    items: TickerItem[];
}
export interface TickerPayload {
    venue: 'hyperliquid' | 'event_demo';
    sections: TickerSection[];
    lastUpdatedMs?: number;
    isLive?: boolean;
    source?: 'coingecko' | 'static' | 'snapshot' | 'kalshi' | 'polymarket';
}
export interface OnchainTickerItem {
    symbol: string;
    priceUsd: number;
    change24hPct: number;
}
export interface EventTickerItem {
    id: string;
    label: string;
    impliedProb: number;
    source: 'Kalshi' | 'Polymarket' | 'Demo';
}
/**
 * Get on-chain ticker (crypto prices) - new unified format
 */
export declare function getOnchainTicker(): Promise<TickerPayload>;
/**
 * Get event markets ticker - new unified format with live data support
 * Uses dFlow provider if enabled, falls back to Polymarket/Kalshi
 */
export declare function getEventMarketsTicker(): Promise<TickerPayload>;
//# sourceMappingURL=ticker.d.ts.map