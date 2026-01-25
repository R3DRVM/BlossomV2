/**
 * Prediction Market Data Service
 * Fetches live data from Kalshi and Polymarket APIs with fallback to static demo data
 */
export interface RawPredictionMarket {
    id: string;
    title: string;
    source: 'KALSHI' | 'POLYMARKET';
    yesPrice: number;
    noPrice: number;
    volume24hUsd?: number;
    openInterestUsd?: number;
    isLive?: boolean;
}
/**
 * Fetch markets from Kalshi API
 */
export declare function fetchKalshiMarkets(): Promise<RawPredictionMarket[]>;
/**
 * Fetch markets from Polymarket API (with fallback chain)
 */
export declare function fetchPolymarketMarkets(): Promise<RawPredictionMarket[]>;
/**
 * Get top N markets by volume from Kalshi
 */
export declare function getTopKalshiMarketsByVolume(limit?: number): Promise<RawPredictionMarket[]>;
/**
 * Get top N markets by volume from Polymarket
 */
export declare function getTopPolymarketMarketsByVolume(limit?: number): Promise<RawPredictionMarket[]>;
/**
 * Get highest volume market across both platforms
 */
export declare function getHighestVolumeMarket(): Promise<RawPredictionMarket | null>;
//# sourceMappingURL=predictionData.d.ts.map