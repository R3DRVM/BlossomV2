"use strict";
/**
 * Price Service
 * Fetches real market prices with safe fallbacks
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPrice = getPrice;
exports.clearPriceCache = clearPriceCache;
// In-memory cache
const priceCache = new Map();
// Static fallback prices
const STATIC_PRICES = {
    ETH: 3000,
    BTC: 60000,
    SOL: 150,
    USDC: 1,
    AVAX: 35,
    LINK: 14,
};
// Cache TTL: 12 seconds
const CACHE_TTL_MS = 12 * 1000;
/**
 * Get price for a symbol, with caching and fallback
 */
async function getPrice(symbol) {
    // Check cache first
    const cached = priceCache.get(symbol);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return cached;
    }
    // Try to fetch from CoinGecko
    try {
        const price = await fetchFromCoinGecko(symbol);
        const snapshot = {
            symbol,
            priceUsd: price,
            source: 'coingecko',
            fetchedAt: Date.now(),
        };
        priceCache.set(symbol, snapshot);
        return snapshot;
    }
    catch (error) {
        console.warn(`Failed to fetch ${symbol} price from CoinGecko, using static fallback:`, error);
    }
    // Fallback to static price
    const snapshot = {
        symbol,
        priceUsd: STATIC_PRICES[symbol],
        source: 'static',
        fetchedAt: Date.now(),
    };
    priceCache.set(symbol, snapshot);
    return snapshot;
}
/**
 * Fetch price from CoinGecko public API
 */
async function fetchFromCoinGecko(symbol) {
    // CoinGecko API mapping
    const coinGeckoIds = {
        ETH: 'ethereum',
        BTC: 'bitcoin',
        SOL: 'solana',
        USDC: 'usd-coin',
        AVAX: 'avalanche-2',
        LINK: 'chainlink',
    };
    const coinId = coinGeckoIds[symbol];
    if (!coinId) {
        throw new Error(`Unsupported symbol: ${symbol}`);
    }
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`;
    const response = await fetch(url, {
        headers: {
            'Accept': 'application/json',
        },
    });
    if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
    }
    const data = await response.json();
    const price = data[coinId]?.usd;
    if (typeof price !== 'number' || price <= 0) {
        throw new Error(`Invalid price data from CoinGecko: ${price}`);
    }
    return price;
}
/**
 * Clear price cache (useful for testing)
 */
function clearPriceCache() {
    priceCache.clear();
}
//# sourceMappingURL=prices.js.map