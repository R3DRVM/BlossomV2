"use strict";
/**
 * Prediction Market Data Service
 * Fetches live data from Kalshi and Polymarket APIs with fallback to static demo data
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchKalshiMarkets = fetchKalshiMarkets;
exports.fetchPolymarketMarkets = fetchPolymarketMarkets;
exports.getTopKalshiMarketsByVolume = getTopKalshiMarketsByVolume;
exports.getTopPolymarketMarketsByVolume = getTopPolymarketMarketsByVolume;
exports.getHighestVolumeMarket = getHighestVolumeMarket;
// Static fallback for Kalshi markets
const STATIC_KALSHI_MARKETS = [
    {
        id: 'FED_CUTS_MAR_2025',
        title: 'Fed cuts in March 2025',
        source: 'KALSHI',
        yesPrice: 0.62,
        noPrice: 0.38,
        volume24hUsd: 125000,
        openInterestUsd: 450000,
    },
    {
        id: 'BTC_ETF_APPROVAL_2025',
        title: 'BTC ETF approved by Dec 31',
        source: 'KALSHI',
        yesPrice: 0.68,
        noPrice: 0.32,
        volume24hUsd: 280000,
        openInterestUsd: 1200000,
    },
    {
        id: 'ETH_ETF_APPROVAL_2025',
        title: 'ETH ETF approved by June 2025',
        source: 'KALSHI',
        yesPrice: 0.58,
        noPrice: 0.42,
        volume24hUsd: 95000,
        openInterestUsd: 380000,
    },
];
// Static fallback for Polymarket markets
const STATIC_POLYMARKET_MARKETS = [
    {
        id: 'US_ELECTION_2024',
        title: 'US Election Winner 2024',
        source: 'POLYMARKET',
        yesPrice: 0.50,
        noPrice: 0.50,
        volume24hUsd: 450000,
        openInterestUsd: 2100000,
    },
    {
        id: 'CRYPTO_MCAP_THRESHOLD',
        title: 'Crypto market cap above $3T by year-end',
        source: 'POLYMARKET',
        yesPrice: 0.52,
        noPrice: 0.48,
        volume24hUsd: 180000,
        openInterestUsd: 750000,
    },
    {
        id: 'ETH_ABOVE_5K',
        title: 'ETH above $5k by year-end',
        source: 'POLYMARKET',
        yesPrice: 0.45,
        noPrice: 0.55,
        volume24hUsd: 120000,
        openInterestUsd: 520000,
    },
];
/**
 * Fetch markets from Kalshi API
 */
async function fetchKalshiMarkets() {
    const apiUrl = process.env.KALSHI_API_URL;
    const apiKey = process.env.KALSHI_API_KEY;
    // If no API credentials, return static fallback
    if (!apiUrl || !apiKey) {
        console.log('[PredictionData] Kalshi API not configured, using static fallback');
        return STATIC_KALSHI_MARKETS.map(m => ({ ...m, isLive: false }));
    }
    try {
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'application/json',
            },
        });
        if (!response.ok) {
            throw new Error(`Kalshi API error: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        // Map Kalshi API response to RawPredictionMarket[]
        // Adjust this mapping based on actual Kalshi API response structure
        const markets = [];
        // Example mapping (adjust based on actual API structure):
        // If data is an array of markets:
        if (Array.isArray(data)) {
            for (const market of data) {
                // Filter for binary YES/NO markets only
                if (market.type === 'binary' || market.outcomes?.length === 2) {
                    const yesPrice = parseFloat(market.yesPrice || market.outcomes?.[0]?.price || '0.5');
                    const noPrice = parseFloat(market.noPrice || market.outcomes?.[1]?.price || '0.5');
                    if (yesPrice >= 0 && yesPrice <= 1 && noPrice >= 0 && noPrice <= 1) {
                        markets.push({
                            id: market.id || market.ticker || `kalshi-${Date.now()}-${Math.random()}`,
                            title: market.title || market.question || market.name || 'Unknown Market',
                            source: 'KALSHI',
                            yesPrice,
                            noPrice,
                            volume24hUsd: parseFloat(market.volume24h || market.volume_24h || '0'),
                            openInterestUsd: parseFloat(market.openInterest || market.open_interest || '0'),
                        });
                    }
                }
            }
        }
        else if (data.markets && Array.isArray(data.markets)) {
            // If data.markets is the array
            for (const market of data.markets) {
                if (market.type === 'binary' || market.outcomes?.length === 2) {
                    const yesPrice = parseFloat(market.yesPrice || market.outcomes?.[0]?.price || '0.5');
                    const noPrice = parseFloat(market.noPrice || market.outcomes?.[1]?.price || '0.5');
                    if (yesPrice >= 0 && yesPrice <= 1 && noPrice >= 0 && noPrice <= 1) {
                        markets.push({
                            id: market.id || market.ticker || `kalshi-${Date.now()}-${Math.random()}`,
                            title: market.title || market.question || market.name || 'Unknown Market',
                            source: 'KALSHI',
                            yesPrice,
                            noPrice,
                            volume24hUsd: parseFloat(market.volume24h || market.volume_24h || '0'),
                            openInterestUsd: parseFloat(market.openInterest || market.open_interest || '0'),
                        });
                    }
                }
            }
        }
        // Sort by openInterestUsd or volume24hUsd desc, take top 15
        const sorted = markets.sort((a, b) => {
            const aValue = a.openInterestUsd || a.volume24hUsd || 0;
            const bValue = b.openInterestUsd || b.volume24hUsd || 0;
            return bValue - aValue;
        });
        const topMarkets = sorted.slice(0, 15);
        if (topMarkets.length > 0) {
            console.log(`[PredictionData] Fetched ${topMarkets.length} markets from Kalshi`);
            return topMarkets.map(m => ({ ...m, isLive: true }));
        }
        else {
            console.warn('[PredictionData] Kalshi API returned no valid markets, using static fallback');
            return STATIC_KALSHI_MARKETS.map(m => ({ ...m, isLive: false }));
        }
    }
    catch (error) {
        console.warn('[PredictionData] Failed to fetch Kalshi markets:', error.message);
        return STATIC_KALSHI_MARKETS.map(m => ({ ...m, isLive: false }));
    }
}
let polymarketCache = null;
const POLYMARKET_CACHE_TTL_MS = 30 * 1000;
// Backoff state for Polymarket
let polymarketFailureCount = 0;
let polymarketNextAllowedFetchMs = 0;
const POLYMARKET_BACKOFF_DELAYS = [15000, 30000, 60000]; // 15s, 30s, 60s
let hasLoggedPolymarketWarning = false;
/**
 * Fetch markets from Polymarket public API (no keys required)
 * Uses a simple public endpoint pattern - falls back gracefully if unavailable
 */
async function fetchPolymarketPublicMarkets() {
    try {
        // Try a simple public markets endpoint (if available)
        // Note: Polymarket's exact public API structure may vary
        // This is a best-effort attempt that will fall back to static if it fails
        const publicUrl = 'https://clob.polymarket.com/markets';
        const response = await fetch(publicUrl, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
            },
        });
        if (!response.ok) {
            // Not available or requires auth - return empty, will use static fallback
            return [];
        }
        const data = await response.json();
        const markets = [];
        // Handle various possible response structures
        const marketsArray = Array.isArray(data) ? data : (data.markets || data.items || []);
        for (const market of marketsArray.slice(0, 20)) {
            // Look for binary markets with YES/NO outcomes
            if (!market.question && !market.title && !market.name)
                continue;
            // Try to extract prices from various possible structures
            let yesPrice = 0.5;
            let noPrice = 0.5;
            if (market.outcomes && Array.isArray(market.outcomes) && market.outcomes.length >= 2) {
                yesPrice = parseFloat(market.outcomes[0]?.price || market.outcomes[0]?.lastPrice || '0.5');
                noPrice = parseFloat(market.outcomes[1]?.price || market.outcomes[1]?.lastPrice || '0.5');
            }
            else if (market.yesPrice !== undefined) {
                yesPrice = parseFloat(market.yesPrice);
                noPrice = 1 - yesPrice;
            }
            // Validate prices
            if (yesPrice < 0 || yesPrice > 1 || noPrice < 0 || noPrice > 1) {
                yesPrice = 0.5;
                noPrice = 0.5;
            }
            const volume = parseFloat(market.volume24h || market.volume || market.volumeUsd || '0');
            const liquidity = parseFloat(market.liquidity || market.totalLiquidity || market.openInterest || '0');
            markets.push({
                id: market.id || market.slug || market.questionId || `polymarket-${Date.now()}-${Math.random()}`,
                title: market.question || market.title || market.name || 'Unknown Market',
                source: 'POLYMARKET',
                yesPrice,
                noPrice,
                volume24hUsd: volume,
                openInterestUsd: liquidity,
            });
        }
        // Sort by volume desc, take top 15
        const sorted = markets.sort((a, b) => {
            const aValue = a.volume24hUsd || a.openInterestUsd || 0;
            const bValue = b.volume24hUsd || b.openInterestUsd || 0;
            return bValue - aValue;
        });
        const topMarkets = sorted.slice(0, 15);
        if (topMarkets.length > 0) {
            // Reset failure count on success
            polymarketFailureCount = 0;
            polymarketNextAllowedFetchMs = 0;
            hasLoggedPolymarketWarning = false;
            return topMarkets.map(m => ({ ...m, isLive: true }));
        }
        return [];
    }
    catch (error) {
        // Fail silently - will fall back to static
        return [];
    }
}
/**
 * Fetch markets from Polymarket API (with fallback chain)
 */
async function fetchPolymarketMarkets() {
    const now = Date.now();
    // Check cache first
    if (polymarketCache && now - polymarketCache.fetchedAt < POLYMARKET_CACHE_TTL_MS) {
        return polymarketCache.data;
    }
    // Check backoff
    if (now < polymarketNextAllowedFetchMs) {
        // Return cached data if available, otherwise static
        if (polymarketCache) {
            return polymarketCache.data;
        }
        return STATIC_POLYMARKET_MARKETS.map(m => ({ ...m, isLive: false }));
    }
    // Try public API first (no keys required)
    const publicMarkets = await fetchPolymarketPublicMarkets();
    if (publicMarkets.length > 0) {
        polymarketCache = {
            data: publicMarkets,
            fetchedAt: now,
        };
        return publicMarkets;
    }
    // Fallback to configured API URL if provided
    const apiUrl = process.env.POLYMARKET_API_URL;
    if (apiUrl) {
        try {
            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                },
            });
            if (response.ok) {
                const data = await response.json();
                const markets = [];
                if (Array.isArray(data)) {
                    for (const market of data) {
                        if (market.outcomes?.length === 2 || market.type === 'binary') {
                            const yesPrice = parseFloat(market.yesPrice || market.outcomes?.[0]?.price || '0.5');
                            const noPrice = parseFloat(market.noPrice || market.outcomes?.[1]?.price || '0.5');
                            if (yesPrice >= 0 && yesPrice <= 1 && noPrice >= 0 && noPrice <= 1) {
                                markets.push({
                                    id: market.id || market.slug || `polymarket-${Date.now()}-${Math.random()}`,
                                    title: market.question || market.title || market.name || 'Unknown Market',
                                    source: 'POLYMARKET',
                                    yesPrice,
                                    noPrice,
                                    volume24hUsd: parseFloat(market.volume24h || market.volume_24h || '0'),
                                    openInterestUsd: parseFloat(market.openInterest || market.open_interest || '0'),
                                });
                            }
                        }
                    }
                }
                else if (data.markets && Array.isArray(data.markets)) {
                    for (const market of data.markets) {
                        if (market.outcomes?.length === 2 || market.type === 'binary') {
                            const yesPrice = parseFloat(market.yesPrice || market.outcomes?.[0]?.price || '0.5');
                            const noPrice = parseFloat(market.noPrice || market.outcomes?.[1]?.price || '0.5');
                            if (yesPrice >= 0 && yesPrice <= 1 && noPrice >= 0 && noPrice <= 1) {
                                markets.push({
                                    id: market.id || market.slug || `polymarket-${Date.now()}-${Math.random()}`,
                                    title: market.question || market.title || market.name || 'Unknown Market',
                                    source: 'POLYMARKET',
                                    yesPrice,
                                    noPrice,
                                    volume24hUsd: parseFloat(market.volume24h || market.volume_24h || '0'),
                                    openInterestUsd: parseFloat(market.openInterest || market.open_interest || '0'),
                                });
                            }
                        }
                    }
                }
                const sorted = markets.sort((a, b) => {
                    const aValue = a.openInterestUsd || a.volume24hUsd || 0;
                    const bValue = b.openInterestUsd || b.volume24hUsd || 0;
                    return bValue - aValue;
                });
                const topMarkets = sorted.slice(0, 15);
                if (topMarkets.length > 0) {
                    polymarketCache = {
                        data: topMarkets.map(m => ({ ...m, isLive: true })),
                        fetchedAt: now,
                    };
                    polymarketFailureCount = 0;
                    polymarketNextAllowedFetchMs = 0;
                    hasLoggedPolymarketWarning = false;
                    return polymarketCache.data;
                }
            }
        }
        catch (error) {
            // Fall through to static
        }
    }
    // All fetches failed - apply backoff
    polymarketFailureCount++;
    const backoffIndex = Math.min(polymarketFailureCount - 1, POLYMARKET_BACKOFF_DELAYS.length - 1);
    const backoffMs = POLYMARKET_BACKOFF_DELAYS[backoffIndex];
    polymarketNextAllowedFetchMs = now + backoffMs;
    // Log warning once per session (DEV only)
    if (!hasLoggedPolymarketWarning && process.env.NODE_ENV !== 'production') {
        console.warn('[PredictionData] Polymarket feed unavailable, using fallback');
        hasLoggedPolymarketWarning = true;
    }
    // Return cached data if available, otherwise static
    if (polymarketCache) {
        return polymarketCache.data;
    }
    return STATIC_POLYMARKET_MARKETS.map(m => ({ ...m, isLive: false }));
}
/**
 * Get top N markets by volume from Kalshi
 */
async function getTopKalshiMarketsByVolume(limit = 5) {
    const markets = await fetchKalshiMarkets();
    const sorted = markets.sort((a, b) => {
        const aValue = a.volume24hUsd || a.openInterestUsd || 0;
        const bValue = b.volume24hUsd || b.openInterestUsd || 0;
        return bValue - aValue;
    });
    return sorted.slice(0, limit);
}
/**
 * Get top N markets by volume from Polymarket
 */
async function getTopPolymarketMarketsByVolume(limit = 5) {
    const markets = await fetchPolymarketMarkets();
    const sorted = markets.sort((a, b) => {
        const aValue = a.volume24hUsd || a.openInterestUsd || 0;
        const bValue = b.volume24hUsd || b.openInterestUsd || 0;
        return bValue - aValue;
    });
    return sorted.slice(0, limit);
}
/**
 * Get highest volume market across both platforms
 */
async function getHighestVolumeMarket() {
    const [kalshiMarkets, polymarketMarkets] = await Promise.all([
        fetchKalshiMarkets(),
        fetchPolymarketMarkets(),
    ]);
    const allMarkets = [...kalshiMarkets, ...polymarketMarkets];
    if (allMarkets.length === 0)
        return null;
    const sorted = allMarkets.sort((a, b) => {
        const aValue = a.volume24hUsd || a.openInterestUsd || 0;
        const bValue = b.volume24hUsd || b.openInterestUsd || 0;
        return bValue - aValue;
    });
    return sorted[0] || null;
}
//# sourceMappingURL=predictionData.js.map