/**
 * Event Markets Quote Provider
 * Fetches event market data from dFlow or Polymarket
 * Caches results in-memory for 60 seconds
 */
import { DFLOW_ENABLED, DFLOW_BASE_URL, DFLOW_EVENTS_MARKETS_PATH } from '../config';
// In-memory cache (60 seconds)
let cachedMarkets = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds
// Hardcoded fallback markets
const FALLBACK_MARKETS = [
    { id: 'demo-fed', title: 'Fed Rate Cut Jan 2026', yesPrice: 0.6, noPrice: 0.4, source: 'fallback' },
    { id: 'demo-btc-etf', title: 'BTC ETF Approved by Dec 31', yesPrice: 0.68, noPrice: 0.32, source: 'fallback' },
    { id: 'demo-eth-etf', title: 'ETH ETF Approved by June 2025', yesPrice: 0.58, noPrice: 0.42, source: 'fallback' },
];
/**
 * Fetch event markets from dFlow if enabled, else Polymarket, else fallback
 */
export async function getEventMarkets(limit = 10) {
    // Check cache
    const now = Date.now();
    if (cachedMarkets && (now - cacheTimestamp) < CACHE_TTL_MS) {
        return cachedMarkets.slice(0, limit);
    }
    // Try dFlow first if enabled
    if (DFLOW_ENABLED && DFLOW_BASE_URL && DFLOW_EVENTS_MARKETS_PATH) {
        try {
            const url = DFLOW_EVENTS_MARKETS_PATH.startsWith('http')
                ? DFLOW_EVENTS_MARKETS_PATH
                : `${DFLOW_BASE_URL}${DFLOW_EVENTS_MARKETS_PATH}`;
            const response = await fetch(url, {
                headers: {
                    'Accept': 'application/json',
                    ...(process.env.DFLOW_API_KEY ? { 'Authorization': `Bearer ${process.env.DFLOW_API_KEY}` } : {}),
                },
            });
            if (response.ok) {
                const data = await response.json();
                // Transform dFlow response to EventMarket format
                // Adjust based on actual dFlow API response structure
                const markets = Array.isArray(data) ? data.map((m) => ({
                    id: m.id || m.marketId || `dflow-${Date.now()}-${Math.random()}`,
                    title: m.title || m.name || 'Unknown Market',
                    yesPrice: m.yesPrice || m.yes || 0.5,
                    noPrice: m.noPrice || m.no || 0.5,
                    volume24hUsd: m.volume24hUsd || m.volume,
                    source: 'dflow',
                })).slice(0, limit) : [];
                if (markets.length > 0) {
                    cachedMarkets = markets;
                    cacheTimestamp = now;
                    return markets;
                }
            }
        }
        catch (error) {
            console.warn('[getEventMarkets] dFlow fetch failed:', error.message);
        }
    }
    // Try Polymarket
    try {
        const response = await fetch('https://clob.polymarket.com/markets', {
            headers: {
                'Accept': 'application/json',
            },
        });
        if (response.ok) {
            const data = await response.json();
            // Transform Polymarket response to EventMarket format
            const markets = Array.isArray(data) ? data
                .filter((m) => m.question && m.conditionId)
                .map((m) => ({
                id: m.conditionId || m.id || `poly-${Date.now()}-${Math.random()}`,
                title: m.question || m.title || 'Unknown Market',
                yesPrice: m.outcomes?.[0]?.price || 0.5,
                noPrice: m.outcomes?.[1]?.price || 0.5,
                volume24hUsd: m.volume24h || 0,
                source: 'polymarket',
            }))
                .slice(0, limit) : [];
            if (markets.length > 0) {
                cachedMarkets = markets;
                cacheTimestamp = now;
                return markets;
            }
        }
    }
    catch (error) {
        console.warn('[getEventMarkets] Polymarket fetch failed:', error.message);
    }
    // Return fallback
    cachedMarkets = FALLBACK_MARKETS;
    cacheTimestamp = now;
    return FALLBACK_MARKETS.slice(0, limit);
}
/**
 * Find event market by keyword match
 */
export async function findEventMarketByKeyword(keyword) {
    const markets = await getEventMarkets(10);
    const lowerKeyword = keyword.toLowerCase();
    // Simple string search
    const match = markets.find(m => m.title.toLowerCase().includes(lowerKeyword) ||
        lowerKeyword.includes(m.title.toLowerCase().split(' ')[0]));
    return match || markets[0] || null; // Return first market if no match
}
//# sourceMappingURL=eventMarkets.js.map