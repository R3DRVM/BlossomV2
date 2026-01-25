var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// agent/src/services/predictionData.ts
async function fetchKalshiMarkets() {
  const apiUrl = process.env.KALSHI_API_URL;
  const apiKey = process.env.KALSHI_API_KEY;
  if (!apiUrl || !apiKey) {
    console.log("[PredictionData] Kalshi API not configured, using static fallback");
    return STATIC_KALSHI_MARKETS.map((m) => ({ ...m, isLive: false }));
  }
  try {
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Accept": "application/json"
      }
    });
    if (!response.ok) {
      throw new Error(`Kalshi API error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    const markets = [];
    if (Array.isArray(data)) {
      for (const market of data) {
        if (market.type === "binary" || market.outcomes?.length === 2) {
          const yesPrice = parseFloat(market.yesPrice || market.outcomes?.[0]?.price || "0.5");
          const noPrice = parseFloat(market.noPrice || market.outcomes?.[1]?.price || "0.5");
          if (yesPrice >= 0 && yesPrice <= 1 && noPrice >= 0 && noPrice <= 1) {
            markets.push({
              id: market.id || market.ticker || `kalshi-${Date.now()}-${Math.random()}`,
              title: market.title || market.question || market.name || "Unknown Market",
              source: "KALSHI",
              yesPrice,
              noPrice,
              volume24hUsd: parseFloat(market.volume24h || market.volume_24h || "0"),
              openInterestUsd: parseFloat(market.openInterest || market.open_interest || "0")
            });
          }
        }
      }
    } else if (data.markets && Array.isArray(data.markets)) {
      for (const market of data.markets) {
        if (market.type === "binary" || market.outcomes?.length === 2) {
          const yesPrice = parseFloat(market.yesPrice || market.outcomes?.[0]?.price || "0.5");
          const noPrice = parseFloat(market.noPrice || market.outcomes?.[1]?.price || "0.5");
          if (yesPrice >= 0 && yesPrice <= 1 && noPrice >= 0 && noPrice <= 1) {
            markets.push({
              id: market.id || market.ticker || `kalshi-${Date.now()}-${Math.random()}`,
              title: market.title || market.question || market.name || "Unknown Market",
              source: "KALSHI",
              yesPrice,
              noPrice,
              volume24hUsd: parseFloat(market.volume24h || market.volume_24h || "0"),
              openInterestUsd: parseFloat(market.openInterest || market.open_interest || "0")
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
      console.log(`[PredictionData] Fetched ${topMarkets.length} markets from Kalshi`);
      return topMarkets.map((m) => ({ ...m, isLive: true }));
    } else {
      console.warn("[PredictionData] Kalshi API returned no valid markets, using static fallback");
      return STATIC_KALSHI_MARKETS.map((m) => ({ ...m, isLive: false }));
    }
  } catch (error) {
    console.warn("[PredictionData] Failed to fetch Kalshi markets:", error.message);
    return STATIC_KALSHI_MARKETS.map((m) => ({ ...m, isLive: false }));
  }
}
async function fetchPolymarketPublicMarkets() {
  try {
    const publicUrl = "https://clob.polymarket.com/markets";
    const response = await fetch(publicUrl, {
      method: "GET",
      headers: {
        "Accept": "application/json"
      }
    });
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    const markets = [];
    const marketsArray = Array.isArray(data) ? data : data.markets || data.items || [];
    for (const market of marketsArray.slice(0, 20)) {
      if (!market.question && !market.title && !market.name) continue;
      let yesPrice = 0.5;
      let noPrice = 0.5;
      if (market.outcomes && Array.isArray(market.outcomes) && market.outcomes.length >= 2) {
        yesPrice = parseFloat(market.outcomes[0]?.price || market.outcomes[0]?.lastPrice || "0.5");
        noPrice = parseFloat(market.outcomes[1]?.price || market.outcomes[1]?.lastPrice || "0.5");
      } else if (market.yesPrice !== void 0) {
        yesPrice = parseFloat(market.yesPrice);
        noPrice = 1 - yesPrice;
      }
      if (yesPrice < 0 || yesPrice > 1 || noPrice < 0 || noPrice > 1) {
        yesPrice = 0.5;
        noPrice = 0.5;
      }
      const volume = parseFloat(market.volume24h || market.volume || market.volumeUsd || "0");
      const liquidity = parseFloat(market.liquidity || market.totalLiquidity || market.openInterest || "0");
      markets.push({
        id: market.id || market.slug || market.questionId || `polymarket-${Date.now()}-${Math.random()}`,
        title: market.question || market.title || market.name || "Unknown Market",
        source: "POLYMARKET",
        yesPrice,
        noPrice,
        volume24hUsd: volume,
        openInterestUsd: liquidity
      });
    }
    const sorted = markets.sort((a, b) => {
      const aValue = a.volume24hUsd || a.openInterestUsd || 0;
      const bValue = b.volume24hUsd || b.openInterestUsd || 0;
      return bValue - aValue;
    });
    const topMarkets = sorted.slice(0, 15);
    if (topMarkets.length > 0) {
      polymarketFailureCount = 0;
      polymarketNextAllowedFetchMs = 0;
      hasLoggedPolymarketWarning = false;
      return topMarkets.map((m) => ({ ...m, isLive: true }));
    }
    return [];
  } catch (error) {
    return [];
  }
}
async function fetchPolymarketMarkets() {
  const now = Date.now();
  if (polymarketCache && now - polymarketCache.fetchedAt < POLYMARKET_CACHE_TTL_MS) {
    return polymarketCache.data;
  }
  if (now < polymarketNextAllowedFetchMs) {
    if (polymarketCache) {
      return polymarketCache.data;
    }
    return STATIC_POLYMARKET_MARKETS.map((m) => ({ ...m, isLive: false }));
  }
  const publicMarkets = await fetchPolymarketPublicMarkets();
  if (publicMarkets.length > 0) {
    polymarketCache = {
      data: publicMarkets,
      fetchedAt: now
    };
    return publicMarkets;
  }
  const apiUrl = process.env.POLYMARKET_API_URL;
  if (apiUrl) {
    try {
      const response = await fetch(apiUrl, {
        method: "GET",
        headers: {
          "Accept": "application/json"
        }
      });
      if (response.ok) {
        const data = await response.json();
        const markets = [];
        if (Array.isArray(data)) {
          for (const market of data) {
            if (market.outcomes?.length === 2 || market.type === "binary") {
              const yesPrice = parseFloat(market.yesPrice || market.outcomes?.[0]?.price || "0.5");
              const noPrice = parseFloat(market.noPrice || market.outcomes?.[1]?.price || "0.5");
              if (yesPrice >= 0 && yesPrice <= 1 && noPrice >= 0 && noPrice <= 1) {
                markets.push({
                  id: market.id || market.slug || `polymarket-${Date.now()}-${Math.random()}`,
                  title: market.question || market.title || market.name || "Unknown Market",
                  source: "POLYMARKET",
                  yesPrice,
                  noPrice,
                  volume24hUsd: parseFloat(market.volume24h || market.volume_24h || "0"),
                  openInterestUsd: parseFloat(market.openInterest || market.open_interest || "0")
                });
              }
            }
          }
        } else if (data.markets && Array.isArray(data.markets)) {
          for (const market of data.markets) {
            if (market.outcomes?.length === 2 || market.type === "binary") {
              const yesPrice = parseFloat(market.yesPrice || market.outcomes?.[0]?.price || "0.5");
              const noPrice = parseFloat(market.noPrice || market.outcomes?.[1]?.price || "0.5");
              if (yesPrice >= 0 && yesPrice <= 1 && noPrice >= 0 && noPrice <= 1) {
                markets.push({
                  id: market.id || market.slug || `polymarket-${Date.now()}-${Math.random()}`,
                  title: market.question || market.title || market.name || "Unknown Market",
                  source: "POLYMARKET",
                  yesPrice,
                  noPrice,
                  volume24hUsd: parseFloat(market.volume24h || market.volume_24h || "0"),
                  openInterestUsd: parseFloat(market.openInterest || market.open_interest || "0")
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
            data: topMarkets.map((m) => ({ ...m, isLive: true })),
            fetchedAt: now
          };
          polymarketFailureCount = 0;
          polymarketNextAllowedFetchMs = 0;
          hasLoggedPolymarketWarning = false;
          return polymarketCache.data;
        }
      }
    } catch (error) {
    }
  }
  polymarketFailureCount++;
  const backoffIndex = Math.min(polymarketFailureCount - 1, POLYMARKET_BACKOFF_DELAYS.length - 1);
  const backoffMs = POLYMARKET_BACKOFF_DELAYS[backoffIndex];
  polymarketNextAllowedFetchMs = now + backoffMs;
  if (!hasLoggedPolymarketWarning && process.env.NODE_ENV !== "production") {
    console.warn("[PredictionData] Polymarket feed unavailable, using fallback");
    hasLoggedPolymarketWarning = true;
  }
  if (polymarketCache) {
    return polymarketCache.data;
  }
  return STATIC_POLYMARKET_MARKETS.map((m) => ({ ...m, isLive: false }));
}
async function getTopKalshiMarketsByVolume(limit = 5) {
  const markets = await fetchKalshiMarkets();
  const sorted = markets.sort((a, b) => {
    const aValue = a.volume24hUsd || a.openInterestUsd || 0;
    const bValue = b.volume24hUsd || b.openInterestUsd || 0;
    return bValue - aValue;
  });
  return sorted.slice(0, limit);
}
async function getTopPolymarketMarketsByVolume(limit = 5) {
  const markets = await fetchPolymarketMarkets();
  const sorted = markets.sort((a, b) => {
    const aValue = a.volume24hUsd || a.openInterestUsd || 0;
    const bValue = b.volume24hUsd || b.openInterestUsd || 0;
    return bValue - aValue;
  });
  return sorted.slice(0, limit);
}
async function getHighestVolumeMarket() {
  const [kalshiMarkets, polymarketMarkets] = await Promise.all([
    fetchKalshiMarkets(),
    fetchPolymarketMarkets()
  ]);
  const allMarkets = [...kalshiMarkets, ...polymarketMarkets];
  if (allMarkets.length === 0) return null;
  const sorted = allMarkets.sort((a, b) => {
    const aValue = a.volume24hUsd || a.openInterestUsd || 0;
    const bValue = b.volume24hUsd || b.openInterestUsd || 0;
    return bValue - aValue;
  });
  return sorted[0] || null;
}
var STATIC_KALSHI_MARKETS, STATIC_POLYMARKET_MARKETS, polymarketCache, POLYMARKET_CACHE_TTL_MS, polymarketFailureCount, polymarketNextAllowedFetchMs, POLYMARKET_BACKOFF_DELAYS, hasLoggedPolymarketWarning;
var init_predictionData = __esm({
  "agent/src/services/predictionData.ts"() {
    "use strict";
    STATIC_KALSHI_MARKETS = [
      {
        id: "FED_CUTS_MAR_2025",
        title: "Fed cuts in March 2025",
        source: "KALSHI",
        yesPrice: 0.62,
        noPrice: 0.38,
        volume24hUsd: 125e3,
        openInterestUsd: 45e4
      },
      {
        id: "BTC_ETF_APPROVAL_2025",
        title: "BTC ETF approved by Dec 31",
        source: "KALSHI",
        yesPrice: 0.68,
        noPrice: 0.32,
        volume24hUsd: 28e4,
        openInterestUsd: 12e5
      },
      {
        id: "ETH_ETF_APPROVAL_2025",
        title: "ETH ETF approved by June 2025",
        source: "KALSHI",
        yesPrice: 0.58,
        noPrice: 0.42,
        volume24hUsd: 95e3,
        openInterestUsd: 38e4
      }
    ];
    STATIC_POLYMARKET_MARKETS = [
      {
        id: "US_ELECTION_2024",
        title: "US Election Winner 2024",
        source: "POLYMARKET",
        yesPrice: 0.5,
        noPrice: 0.5,
        volume24hUsd: 45e4,
        openInterestUsd: 21e5
      },
      {
        id: "CRYPTO_MCAP_THRESHOLD",
        title: "Crypto market cap above $3T by year-end",
        source: "POLYMARKET",
        yesPrice: 0.52,
        noPrice: 0.48,
        volume24hUsd: 18e4,
        openInterestUsd: 75e4
      },
      {
        id: "ETH_ABOVE_5K",
        title: "ETH above $5k by year-end",
        source: "POLYMARKET",
        yesPrice: 0.45,
        noPrice: 0.55,
        volume24hUsd: 12e4,
        openInterestUsd: 52e4
      }
    ];
    polymarketCache = null;
    POLYMARKET_CACHE_TTL_MS = 30 * 1e3;
    polymarketFailureCount = 0;
    polymarketNextAllowedFetchMs = 0;
    POLYMARKET_BACKOFF_DELAYS = [15e3, 3e4, 6e4];
    hasLoggedPolymarketWarning = false;
  }
});

// agent/src/quotes/defiLlamaQuote.ts
var defiLlamaQuote_exports = {};
__export(defiLlamaQuote_exports, {
  getTopProtocolsByTVL: () => getTopProtocolsByTVL,
  getTopYieldVaults: () => getTopYieldVaults,
  getVaultRecommendation: () => getVaultRecommendation
});
async function getTopYieldVaults() {
  const now = Date.now();
  if (cachedVaults && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedVaults;
  }
  try {
    const response = await fetch("https://yields.llama.fi/pools", {
      headers: {
        "Accept": "application/json"
      }
    });
    if (!response.ok) {
      throw new Error(`DefiLlama API returned ${response.status}`);
    }
    const data = await response.json();
    const pools = data.data || [];
    const stablecoinSymbols = ["REDACTED", "USDT", "DAI", "REDACTED.e", "USDT.e"];
    const ethereumPools = pools.filter((pool) => {
      const isEthereum = pool.chain === "Ethereum" || pool.chain === "ethereum";
      const isStablecoin = stablecoinSymbols.some(
        (sym) => pool.symbol?.toUpperCase().includes(sym)
      );
      return isEthereum && isStablecoin && pool.apy > 0;
    });
    ethereumPools.sort((a, b) => (b.apy || 0) - (a.apy || 0));
    const topPools = ethereumPools.slice(0, 5);
    const vaults = topPools.map((pool) => ({
      name: `${pool.project} ${pool.symbol}`,
      apy: pool.apy || 0,
      tvl: pool.tvlUsd || 0,
      poolId: pool.pool || pool.project,
      protocol: pool.project || "Unknown"
    }));
    cachedVaults = vaults.length > 0 ? vaults : FALLBACK_VAULTS;
    cacheTimestamp = now;
    return cachedVaults;
  } catch (error) {
    console.warn("[getTopYieldVaults] Failed to fetch from DefiLlama:", error.message);
    cachedVaults = FALLBACK_VAULTS;
    cacheTimestamp = now;
    return FALLBACK_VAULTS;
  }
}
async function getVaultRecommendation(amountUsd) {
  const vaults = await getTopYieldVaults();
  if (vaults.length === 0) {
    return null;
  }
  return vaults[0];
}
function formatTVL(tvl) {
  if (tvl >= 1e9) {
    return `$${(tvl / 1e9).toFixed(1)}B`;
  } else if (tvl >= 1e6) {
    return `$${(tvl / 1e6).toFixed(1)}M`;
  } else {
    return `$${Math.round(tvl).toLocaleString()}`;
  }
}
async function getTopProtocolsByTVL(limit = 5) {
  const now = Date.now();
  if (cachedProtocolsTVL && now - protocolsCacheTimestamp < CACHE_TTL_MS) {
    return cachedProtocolsTVL.slice(0, limit);
  }
  try {
    const response = await fetch("https://api.llama.fi/protocols", {
      headers: {
        "Accept": "application/json"
      }
    });
    if (!response.ok) {
      throw new Error(`DefiLlama protocols API returned ${response.status}`);
    }
    const protocols = await response.json();
    const cexCategories = ["cex", "centralized exchange", "cefi"];
    const cexNamePatterns = ["binance", "okx", "okex", "bitfinex", "coinbase", "kraken", "huobi", "bybit", "gate.io", "kucoin"];
    const protocolsWithTVL = protocols.filter((p) => {
      if (!p.tvl || p.tvl <= 0 || !p.name || !p.category) return false;
      const categoryLower = String(p.category).toLowerCase();
      if (cexCategories.some((cexCat) => categoryLower.includes(cexCat))) return false;
      const nameLower = String(p.name).toLowerCase();
      if (cexNamePatterns.some((cexName) => nameLower.includes(cexName))) return false;
      return true;
    }).map((p) => ({
      name: p.name,
      tvl: p.tvl || 0,
      tvlFormatted: formatTVL(p.tvl || 0),
      category: p.category || "DeFi",
      chains: p.chains || ["Ethereum"],
      slug: p.slug || p.name.toLowerCase().replace(/\s+/g, "-")
    }));
    protocolsWithTVL.sort((a, b) => b.tvl - a.tvl);
    cachedProtocolsTVL = protocolsWithTVL;
    protocolsCacheTimestamp = now;
    return protocolsWithTVL.slice(0, limit);
  } catch (error) {
    console.warn("[getTopProtocolsByTVL] Failed to fetch from DefiLlama:", error.message);
    cachedProtocolsTVL = FALLBACK_PROTOCOLS;
    protocolsCacheTimestamp = now;
    return FALLBACK_PROTOCOLS.slice(0, limit);
  }
}
var cachedVaults, cacheTimestamp, CACHE_TTL_MS, FALLBACK_VAULTS, cachedProtocolsTVL, protocolsCacheTimestamp, FALLBACK_PROTOCOLS;
var init_defiLlamaQuote = __esm({
  "agent/src/quotes/defiLlamaQuote.ts"() {
    "use strict";
    cachedVaults = null;
    cacheTimestamp = 0;
    CACHE_TTL_MS = 5 * 60 * 1e3;
    FALLBACK_VAULTS = [
      { name: "Aave REDACTED", apy: 5, tvl: 1e6, poolId: "demo-aave-usdc", protocol: "Aave" },
      { name: "Compound REDACTED", apy: 4.5, tvl: 8e5, poolId: "demo-compound-usdc", protocol: "Compound" },
      { name: "Aave USDT", apy: 4.8, tvl: 6e5, poolId: "demo-aave-usdt", protocol: "Aave" }
    ];
    cachedProtocolsTVL = null;
    protocolsCacheTimestamp = 0;
    FALLBACK_PROTOCOLS = [
      { name: "Aave V3", tvl: 342e8, tvlFormatted: "$34.2B", category: "Lending", chains: ["Ethereum", "Polygon"], slug: "aave" },
      { name: "Lido", tvl: 28e9, tvlFormatted: "$28.0B", category: "Liquid Staking", chains: ["Ethereum"], slug: "lido" },
      { name: "MakerDAO", tvl: 139e8, tvlFormatted: "$13.9B", category: "CDP", chains: ["Ethereum"], slug: "makerdao" },
      { name: "Curve", tvl: 113e8, tvlFormatted: "$11.3B", category: "Dexes", chains: ["Ethereum", "Arbitrum"], slug: "curve" },
      { name: "AAVE", tvl: 88e8, tvlFormatted: "$8.8B", category: "Lending", chains: ["Ethereum", "Avalanche"], slug: "aave-v2" }
    ];
  }
});

// agent/src/config.ts
var config_exports = {};
__export(config_exports, {
  AAVE_ADAPTER_ADDRESS: () => AAVE_ADAPTER_ADDRESS,
  AAVE_POOL_ADDRESS: () => AAVE_POOL_ADDRESS,
  AAVE_POOL_ADDRESS_SEPOLIA: () => AAVE_POOL_ADDRESS_SEPOLIA,
  AAVE_SEPOLIA_POOL_ADDRESS: () => AAVE_SEPOLIA_POOL_ADDRESS,
  AAVE_REDACTED_ADDRESS: () => AAVE_REDACTED_ADDRESS,
  AAVE_WETH_ADDRESS: () => AAVE_WETH_ADDRESS,
  BLOSSOM_FEE_BPS: () => BLOSSOM_FEE_BPS,
  DEFAULT_SWAP_SLIPPAGE_BPS: () => DEFAULT_SWAP_SLIPPAGE_BPS,
  DEMO_LEND_ADAPTER_ADDRESS: () => DEMO_LEND_ADAPTER_ADDRESS,
  DEMO_LEND_VAULT_ADDRESS: () => DEMO_LEND_VAULT_ADDRESS,
  DEMO_PERP_ADAPTER_ADDRESS: () => DEMO_PERP_ADAPTER_ADDRESS,
  DEMO_PERP_ENGINE_ADDRESS: () => DEMO_PERP_ENGINE_ADDRESS,
  DEMO_SWAP_ROUTER_ADDRESS: () => DEMO_SWAP_ROUTER_ADDRESS,
  DEMO_REDACTED_ADDRESS: () => DEMO_REDACTED_ADDRESS,
  DEMO_WETH_ADDRESS: () => DEMO_WETH_ADDRESS,
  DFLOW_API_KEY: () => DFLOW_API_KEY,
  DFLOW_BASE_URL: () => DFLOW_BASE_URL,
  DFLOW_ENABLED: () => DFLOW_ENABLED,
  DFLOW_EVENTS_MARKETS_PATH: () => DFLOW_EVENTS_MARKETS_PATH,
  DFLOW_EVENTS_QUOTE_PATH: () => DFLOW_EVENTS_QUOTE_PATH,
  DFLOW_PREDICTION_API_URL: () => DFLOW_PREDICTION_API_URL,
  DFLOW_QUOTE_API_URL: () => DFLOW_QUOTE_API_URL,
  DFLOW_REQUIRE: () => DFLOW_REQUIRE,
  DFLOW_SWAPS_QUOTE_PATH: () => DFLOW_SWAPS_QUOTE_PATH,
  ERC20_PULL_ADAPTER_ADDRESS: () => ERC20_PULL_ADAPTER_ADDRESS,
  ETH_RPC_FALLBACK_URLS: () => ETH_RPC_FALLBACK_URLS,
  ETH_TESTNET_CHAIN_ID: () => ETH_TESTNET_CHAIN_ID,
  ETH_TESTNET_RPC_URL: () => ETH_TESTNET_RPC_URL,
  EXECUTION_AUTH_MODE: () => EXECUTION_AUTH_MODE,
  EXECUTION_DISABLED: () => EXECUTION_DISABLED,
  EXECUTION_MODE: () => EXECUTION_MODE,
  EXECUTION_ROUTER_ADDRESS: () => EXECUTION_ROUTER_ADDRESS,
  EXECUTION_SWAP_MODE: () => EXECUTION_SWAP_MODE,
  LENDING_EXECUTION_MODE: () => LENDING_EXECUTION_MODE,
  LENDING_RATE_SOURCE: () => LENDING_RATE_SOURCE,
  MOCK_SWAP_ADAPTER_ADDRESS: () => MOCK_SWAP_ADAPTER_ADDRESS,
  ONEINCH_API_KEY: () => ONEINCH_API_KEY,
  ONEINCH_BASE_URL: () => ONEINCH_BASE_URL,
  PROOF_ADAPTER_ADDRESS: () => PROOF_ADAPTER_ADDRESS,
  RELAYER_PRIVATE_KEY: () => RELAYER_PRIVATE_KEY,
  ROUTING_MODE: () => ROUTING_MODE,
  ROUTING_REQUIRE_LIVE_QUOTE: () => ROUTING_REQUIRE_LIVE_QUOTE,
  UNISWAP_ADAPTER_ADDRESS: () => UNISWAP_ADAPTER_ADDRESS,
  UNISWAP_V3_ADAPTER_ADDRESS: () => UNISWAP_V3_ADAPTER_ADDRESS,
  UNISWAP_V3_ROUTER_ADDRESS: () => UNISWAP_V3_ROUTER_ADDRESS,
  REDACTED_ADDRESS_SEPOLIA: () => REDACTED_ADDRESS_SEPOLIA,
  V1_DEMO: () => V1_DEMO,
  WETH_ADDRESS_SEPOLIA: () => WETH_ADDRESS_SEPOLIA,
  WETH_WRAP_ADAPTER_ADDRESS: () => WETH_WRAP_ADAPTER_ADDRESS,
  requireEthTestnetConfig: () => requireEthTestnetConfig,
  requireRelayerConfig: () => requireRelayerConfig,
  validateEthTestnetConfig: () => validateEthTestnetConfig
});
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
function requireEthTestnetConfig() {
  if (EXECUTION_MODE !== "eth_testnet") {
    return;
  }
  const missing = [];
  if (!EXECUTION_ROUTER_ADDRESS) {
    missing.push("EXECUTION_ROUTER_ADDRESS");
  }
  if (!MOCK_SWAP_ADAPTER_ADDRESS) {
    missing.push("MOCK_SWAP_ADAPTER_ADDRESS");
  }
  if (missing.length > 0) {
    throw new Error(
      `ETH testnet mode requires the following environment variables: ${missing.join(", ")}. Please set them in your .env file or environment.`
    );
  }
}
function requireRelayerConfig() {
  if (EXECUTION_MODE !== "eth_testnet" || EXECUTION_AUTH_MODE !== "session") {
    return;
  }
  const missing = [];
  if (!RELAYER_PRIVATE_KEY) {
    missing.push("RELAYER_PRIVATE_KEY");
  }
  if (!ETH_TESTNET_RPC_URL) {
    missing.push("ETH_TESTNET_RPC_URL");
  }
  if (missing.length > 0) {
    throw new Error(
      `Session mode requires the following environment variables: ${missing.join(", ")}. Please set them in your .env file or environment.`
    );
  }
}
async function validateEthTestnetConfig() {
  if (EXECUTION_MODE !== "eth_testnet") {
    return;
  }
  const errors = [];
  if (ETH_TESTNET_CHAIN_ID !== 11155111) {
    errors.push(`ETH_TESTNET_CHAIN_ID must be 11155111 (Sepolia), got ${ETH_TESTNET_CHAIN_ID}`);
  }
  if (EXECUTION_ROUTER_ADDRESS) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(EXECUTION_ROUTER_ADDRESS)) {
      errors.push(`EXECUTION_ROUTER_ADDRESS has invalid format: ${EXECUTION_ROUTER_ADDRESS}`);
    }
  } else {
    errors.push("EXECUTION_ROUTER_ADDRESS is required for eth_testnet mode");
  }
  const adapterAddresses = [
    { name: "MOCK_SWAP_ADAPTER_ADDRESS", value: MOCK_SWAP_ADAPTER_ADDRESS },
    { name: "UNISWAP_V3_ADAPTER_ADDRESS", value: UNISWAP_V3_ADAPTER_ADDRESS },
    { name: "WETH_WRAP_ADAPTER_ADDRESS", value: WETH_WRAP_ADAPTER_ADDRESS },
    { name: "ERC20_PULL_ADAPTER_ADDRESS", value: ERC20_PULL_ADAPTER_ADDRESS },
    { name: "PROOF_ADAPTER_ADDRESS", value: PROOF_ADAPTER_ADDRESS }
  ];
  for (const { name, value } of adapterAddresses) {
    if (value && !/^0x[a-fA-F0-9]{40}$/.test(value)) {
      errors.push(`${name} has invalid format: ${value}`);
    }
  }
  if (!ETH_TESTNET_RPC_URL) {
    errors.push("ETH_TESTNET_RPC_URL is required for eth_testnet mode");
  } else if (ETH_TESTNET_RPC_URL && !ETH_TESTNET_RPC_URL.startsWith("http")) {
    errors.push(`ETH_TESTNET_RPC_URL must be a valid HTTP/HTTPS URL, got: ${ETH_TESTNET_RPC_URL.substring(0, 50)}...`);
  }
  if (AAVE_POOL_ADDRESS_SEPOLIA && !/^0x[a-fA-F0-9]{40}$/.test(AAVE_POOL_ADDRESS_SEPOLIA)) {
    errors.push(`AAVE_POOL_ADDRESS_SEPOLIA has invalid format: ${AAVE_POOL_ADDRESS_SEPOLIA}`);
  }
  if (errors.length > 0) {
    throw new Error(
      `ETH testnet configuration validation failed:
${errors.map((e) => `  - ${e}`).join("\n")}
Please check your .env file and ensure all addresses are correct Sepolia contract addresses.`
    );
  }
}
var __filename, __dirname, agentDir, rootDir, envFiles, loadedEnvFile, ALLOW_SIM_MODE, requestedMode, EXECUTION_MODE, ETH_TESTNET_CHAIN_ID, ETH_TESTNET_RPC_URL, collectFallbackUrls, ETH_RPC_FALLBACK_URLS, EXECUTION_ROUTER_ADDRESS, MOCK_SWAP_ADAPTER_ADDRESS, UNISWAP_V3_ADAPTER_ADDRESS, WETH_WRAP_ADAPTER_ADDRESS, REDACTED_ADDRESS_SEPOLIA, WETH_ADDRESS_SEPOLIA, DEMO_REDACTED_ADDRESS, DEMO_WETH_ADDRESS, DEMO_SWAP_ROUTER_ADDRESS, DEMO_LEND_VAULT_ADDRESS, DEMO_LEND_ADAPTER_ADDRESS, DEMO_PERP_ENGINE_ADDRESS, DEMO_PERP_ADAPTER_ADDRESS, PROOF_ADAPTER_ADDRESS, DFLOW_ENABLED, DFLOW_API_KEY, DFLOW_BASE_URL, DFLOW_QUOTE_API_URL, DFLOW_PREDICTION_API_URL, DFLOW_EVENTS_MARKETS_PATH, DFLOW_EVENTS_QUOTE_PATH, DFLOW_SWAPS_QUOTE_PATH, DFLOW_REQUIRE, LENDING_EXECUTION_MODE, AAVE_POOL_ADDRESS, LENDING_RATE_SOURCE, AAVE_SEPOLIA_POOL_ADDRESS, AAVE_ADAPTER_ADDRESS, AAVE_REDACTED_ADDRESS, AAVE_WETH_ADDRESS, ERC20_PULL_ADAPTER_ADDRESS, UNISWAP_ADAPTER_ADDRESS, DEFAULT_SWAP_SLIPPAGE_BPS, ONEINCH_API_KEY, ONEINCH_BASE_URL, ROUTING_MODE, EXECUTION_SWAP_MODE, UNISWAP_V3_ROUTER_ADDRESS, ROUTING_REQUIRE_LIVE_QUOTE, EXECUTION_AUTH_MODE, RELAYER_PRIVATE_KEY, V1_DEMO, EXECUTION_DISABLED, rawFeeBps, BLOSSOM_FEE_BPS, AAVE_POOL_ADDRESS_SEPOLIA;
var init_config = __esm({
  "agent/src/config.ts"() {
    "use strict";
    __filename = fileURLToPath(import.meta.url);
    __dirname = dirname(__filename);
    agentDir = resolve(__dirname, "..");
    rootDir = resolve(agentDir, "..");
    envFiles = [
      resolve(agentDir, ".env.local"),
      resolve(agentDir, ".env"),
      resolve(rootDir, ".env.local"),
      resolve(rootDir, ".env")
    ];
    loadedEnvFile = null;
    for (const envFile of envFiles) {
      const result = config({ path: envFile });
      if (!result.error) {
        loadedEnvFile = envFile;
        break;
      }
    }
    if (loadedEnvFile) {
      console.log(`\u{1F4C4} [config] Loaded environment from: ${loadedEnvFile}`);
    } else {
      console.log(`\u26A0\uFE0F  [config] No .env file found (using system environment variables)`);
    }
    ALLOW_SIM_MODE = process.env.ALLOW_SIM_MODE === "true";
    requestedMode = process.env.EXECUTION_MODE;
    if (requestedMode === "sim") {
      if (ALLOW_SIM_MODE) {
        EXECUTION_MODE = "sim";
      } else {
        EXECUTION_MODE = "eth_testnet";
        console.log("\u26A0\uFE0F  EXECUTION_MODE=sim ignored (ALLOW_SIM_MODE not set). Using eth_testnet.");
      }
    } else {
      EXECUTION_MODE = requestedMode || "eth_testnet";
    }
    ETH_TESTNET_CHAIN_ID = parseInt(
      process.env.ETH_TESTNET_CHAIN_ID || "11155111",
      10
    );
    ETH_TESTNET_RPC_URL = process.env.ETH_TESTNET_RPC_URL;
    collectFallbackUrls = () => {
      const urls = [];
      if (process.env.ETH_RPC_FALLBACK_URLS) {
        urls.push(...process.env.ETH_RPC_FALLBACK_URLS.split(",").map((u) => u.trim()).filter(Boolean));
      }
      const primary = process.env.ETH_TESTNET_RPC_URL || "";
      if (process.env.ALCHEMY_RPC_URL && !primary.includes("alchemy")) {
        urls.push(process.env.ALCHEMY_RPC_URL);
      }
      if (process.env.INFURA_RPC_URL && !primary.includes("infura")) {
        urls.push(process.env.INFURA_RPC_URL);
      }
      const publicRpcs = [
        "https://ethereum-sepolia-rpc.publicnode.com",
        "https://1rpc.io/sepolia",
        "https://rpc.sepolia.org"
      ];
      for (const rpc of publicRpcs) {
        try {
          if (!urls.some((u) => u.includes(new URL(rpc).hostname))) {
            urls.push(rpc);
          }
        } catch {
        }
      }
      return [...new Set(urls)].filter((u) => u !== primary && u.length > 0);
    };
    ETH_RPC_FALLBACK_URLS = collectFallbackUrls();
    EXECUTION_ROUTER_ADDRESS = process.env.EXECUTION_ROUTER_ADDRESS;
    MOCK_SWAP_ADAPTER_ADDRESS = process.env.MOCK_SWAP_ADAPTER_ADDRESS;
    UNISWAP_V3_ADAPTER_ADDRESS = process.env.UNISWAP_V3_ADAPTER_ADDRESS;
    WETH_WRAP_ADAPTER_ADDRESS = process.env.WETH_WRAP_ADAPTER_ADDRESS;
    REDACTED_ADDRESS_SEPOLIA = process.env.REDACTED_ADDRESS_SEPOLIA;
    WETH_ADDRESS_SEPOLIA = process.env.WETH_ADDRESS_SEPOLIA;
    DEMO_REDACTED_ADDRESS = process.env.DEMO_REDACTED_ADDRESS;
    DEMO_WETH_ADDRESS = process.env.DEMO_WETH_ADDRESS;
    DEMO_SWAP_ROUTER_ADDRESS = process.env.DEMO_SWAP_ROUTER_ADDRESS;
    DEMO_LEND_VAULT_ADDRESS = process.env.DEMO_LEND_VAULT_ADDRESS;
    DEMO_LEND_ADAPTER_ADDRESS = process.env.DEMO_LEND_ADAPTER_ADDRESS;
    DEMO_PERP_ENGINE_ADDRESS = process.env.DEMO_PERP_ENGINE_ADDRESS;
    DEMO_PERP_ADAPTER_ADDRESS = process.env.DEMO_PERP_ADAPTER_ADDRESS;
    PROOF_ADAPTER_ADDRESS = process.env.PROOF_ADAPTER_ADDRESS;
    DFLOW_ENABLED = process.env.DFLOW_ENABLED === "true";
    DFLOW_API_KEY = process.env.DFLOW_API_KEY;
    DFLOW_BASE_URL = process.env.DFLOW_BASE_URL;
    DFLOW_QUOTE_API_URL = process.env.DFLOW_QUOTE_API_URL || "https://a.quote-api.dflow.net";
    DFLOW_PREDICTION_API_URL = process.env.DFLOW_PREDICTION_API_URL || "https://prediction-markets-api.dflow.net";
    DFLOW_EVENTS_MARKETS_PATH = process.env.DFLOW_EVENTS_MARKETS_PATH;
    DFLOW_EVENTS_QUOTE_PATH = process.env.DFLOW_EVENTS_QUOTE_PATH;
    DFLOW_SWAPS_QUOTE_PATH = process.env.DFLOW_SWAPS_QUOTE_PATH;
    DFLOW_REQUIRE = process.env.DFLOW_REQUIRE === "true";
    LENDING_EXECUTION_MODE = process.env.LENDING_EXECUTION_MODE || "demo";
    AAVE_POOL_ADDRESS = process.env.AAVE_POOL_ADDRESS;
    LENDING_RATE_SOURCE = process.env.LENDING_RATE_SOURCE || "defillama";
    AAVE_SEPOLIA_POOL_ADDRESS = process.env.AAVE_SEPOLIA_POOL_ADDRESS;
    AAVE_ADAPTER_ADDRESS = process.env.AAVE_ADAPTER_ADDRESS;
    AAVE_REDACTED_ADDRESS = process.env.AAVE_REDACTED_ADDRESS || DEMO_REDACTED_ADDRESS;
    AAVE_WETH_ADDRESS = process.env.AAVE_WETH_ADDRESS;
    ERC20_PULL_ADAPTER_ADDRESS = process.env.ERC20_PULL_ADAPTER_ADDRESS;
    UNISWAP_ADAPTER_ADDRESS = process.env.UNISWAP_ADAPTER_ADDRESS || UNISWAP_V3_ADAPTER_ADDRESS;
    DEFAULT_SWAP_SLIPPAGE_BPS = parseInt(process.env.DEFAULT_SWAP_SLIPPAGE_BPS || "50", 10);
    ONEINCH_API_KEY = process.env.ONEINCH_API_KEY;
    ONEINCH_BASE_URL = process.env.ONEINCH_BASE_URL || "https://api.1inch.dev";
    ROUTING_MODE = process.env.ROUTING_MODE || "hybrid";
    EXECUTION_SWAP_MODE = process.env.EXECUTION_SWAP_MODE || "demo";
    UNISWAP_V3_ROUTER_ADDRESS = process.env.UNISWAP_V3_ROUTER_ADDRESS || process.env.SEPOLIA_UNISWAP_V3_ROUTER || "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008";
    ROUTING_REQUIRE_LIVE_QUOTE = process.env.ROUTING_REQUIRE_LIVE_QUOTE === "true";
    EXECUTION_AUTH_MODE = process.env.EXECUTION_AUTH_MODE || (EXECUTION_MODE === "eth_testnet" ? "session" : "direct");
    RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY;
    V1_DEMO = process.env.V1_DEMO === "true";
    EXECUTION_DISABLED = process.env.EXECUTION_DISABLED === "true";
    rawFeeBps = parseInt(process.env.BLOSSOM_FEE_BPS || "25", 10);
    BLOSSOM_FEE_BPS = Math.min(50, Math.max(10, isNaN(rawFeeBps) ? 25 : rawFeeBps));
    AAVE_POOL_ADDRESS_SEPOLIA = process.env.AAVE_POOL_ADDRESS_SEPOLIA || "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951";
  }
});

// agent/src/integrations/dflow/dflowClient.ts
var dflowClient_exports = {};
__export(dflowClient_exports, {
  dflowHealthCheck: () => dflowHealthCheck,
  dflowRequest: () => dflowRequest,
  getDflowCapabilities: () => getDflowCapabilities,
  getEventMarkets: () => getEventMarkets,
  getEventQuote: () => getEventQuote,
  getSwapQuote: () => getSwapQuote,
  isDflowCapabilityAvailable: () => isDflowCapabilityAvailable,
  isDflowConfigured: () => isDflowConfigured,
  probeDflowEndpoints: () => probeDflowEndpoints
});
function isDflowConfigured() {
  return !!(DFLOW_ENABLED && DFLOW_API_KEY);
}
function getBaseUrlForCapability(capability) {
  switch (capability) {
    case "eventsMarkets":
    case "eventsQuotes":
      return DFLOW_PREDICTION_API_URL;
    case "swapsQuotes":
      return DFLOW_QUOTE_API_URL;
    default:
      return DFLOW_BASE_URL || DFLOW_QUOTE_API_URL;
  }
}
function isDflowCapabilityAvailable(capability) {
  if (!isDflowConfigured()) return false;
  switch (capability) {
    case "eventsMarkets":
      return !!DFLOW_EVENTS_MARKETS_PATH;
    case "eventsQuotes":
      return !!DFLOW_EVENTS_QUOTE_PATH;
    case "swapsQuotes":
      return !!DFLOW_SWAPS_QUOTE_PATH;
    default:
      return false;
  }
}
function getDflowCapabilities() {
  return {
    enabled: isDflowConfigured(),
    eventsMarkets: isDflowCapabilityAvailable("eventsMarkets"),
    eventsQuotes: isDflowCapabilityAvailable("eventsQuotes"),
    swapsQuotes: isDflowCapabilityAvailable("swapsQuotes")
  };
}
async function dflowRequest(path3, options = {}, capability) {
  if (!isDflowConfigured()) {
    return { ok: false, error: "dFlow not configured" };
  }
  const { method = "GET", body, timeout = 1e4 } = options;
  const baseUrl = capability ? getBaseUrlForCapability(capability) : DFLOW_BASE_URL || DFLOW_QUOTE_API_URL;
  const url = `${baseUrl}${path3}`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": DFLOW_API_KEY,
        "Accept": "application/json"
      },
      body: body ? JSON.stringify(body) : void 0,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      return {
        ok: false,
        error: `dFlow API error: ${response.status} ${response.statusText}`,
        statusCode: response.status
      };
    }
    const data = await response.json();
    return { ok: true, data, statusCode: response.status };
  } catch (error) {
    if (error.name === "AbortError") {
      return { ok: false, error: "dFlow request timeout" };
    }
    return { ok: false, error: `dFlow request failed: ${error.message}` };
  }
}
async function dflowHealthCheck() {
  if (!isDflowConfigured()) {
    return { ok: false, latencyMs: 0, error: "dFlow not configured" };
  }
  const startTime = Date.now();
  let quoteApiOk = false;
  let predictionApiOk = false;
  try {
    const quoteResponse = await fetch(`${DFLOW_QUOTE_API_URL}/health`, {
      method: "GET",
      headers: {
        "x-api-key": DFLOW_API_KEY
      }
    });
    quoteApiOk = quoteResponse.ok || quoteResponse.status === 404;
    const predictionResponse = await fetch(`${DFLOW_PREDICTION_API_URL}/health`, {
      method: "GET",
      headers: {
        "x-api-key": DFLOW_API_KEY
      }
    });
    predictionApiOk = predictionResponse.ok || predictionResponse.status === 404;
    const latencyMs = Date.now() - startTime;
    const ok = quoteApiOk || predictionApiOk;
    return { ok, latencyMs, quoteApiOk, predictionApiOk };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - startTime, error: error.message, quoteApiOk, predictionApiOk };
  }
}
async function getEventMarkets() {
  const path3 = DFLOW_EVENTS_MARKETS_PATH || "/v1/markets";
  return dflowRequest(path3, {}, "eventsMarkets");
}
async function getEventQuote(params) {
  const path3 = DFLOW_EVENTS_QUOTE_PATH || "/v1/quote";
  return dflowRequest(path3, {
    method: "POST",
    body: params
  }, "eventsQuotes");
}
async function getSwapQuote(params) {
  const path3 = DFLOW_SWAPS_QUOTE_PATH || "/v1/swap/quote";
  return dflowRequest(path3, {
    method: "POST",
    body: params
  }, "swapsQuotes");
}
async function probeDflowEndpoints() {
  const apiKeySet = !!DFLOW_API_KEY;
  const configured = isDflowConfigured();
  const probePaths = [
    "/",
    "/openapi.json",
    "/docs",
    "/healthz",
    "/v1",
    "/v1/markets",
    "/v1/events/markets",
    "/v1/quote",
    "/v1/swap/quote"
  ];
  const probeUrl = async (baseUrl, path3) => {
    try {
      const response = await fetch(`${baseUrl}${path3}`, {
        method: "GET",
        headers: apiKeySet ? {
          "x-api-key": DFLOW_API_KEY,
          "Accept": "application/json"
        } : {
          "Accept": "application/json"
        }
      });
      let body;
      try {
        const text = await response.text();
        body = text.substring(0, 200);
      } catch {
      }
      return { path: path3, status: response.status, ok: response.ok, body };
    } catch (error) {
      return { path: path3, status: 0, ok: false, body: `Error: ${error.message}` };
    }
  };
  const quoteApiResults = await Promise.all(
    probePaths.map((p) => probeUrl(DFLOW_QUOTE_API_URL, p))
  );
  const predictionApiResults = await Promise.all(
    probePaths.map((p) => probeUrl(DFLOW_PREDICTION_API_URL, p))
  );
  return {
    quoteApi: quoteApiResults,
    predictionApi: predictionApiResults,
    configured,
    apiKeySet
  };
}
var init_dflowClient = __esm({
  "agent/src/integrations/dflow/dflowClient.ts"() {
    "use strict";
    init_config();
  }
});

// agent/src/utils/correlationId.ts
var correlationId_exports = {};
__export(correlationId_exports, {
  makeCorrelationId: () => makeCorrelationId
});
import { randomUUID } from "crypto";
function makeCorrelationId(prefix) {
  const uuid = randomUUID();
  return prefix ? `${prefix}-${uuid}` : uuid;
}
var init_correlationId = __esm({
  "agent/src/utils/correlationId.ts"() {
    "use strict";
  }
});

// agent/src/routing/routingService.ts
var routingService_exports = {};
__export(routingService_exports, {
  getEventMarketsRouted: () => getEventMarketsRouted,
  getRoutingStats: () => getRoutingStats,
  getSwapQuoteRouted: () => getSwapQuoteRouted,
  resetRoutingStats: () => resetRoutingStats
});
function getRoutingStats() {
  return { dflowCallCount, lastDflowCallAt };
}
function resetRoutingStats() {
  dflowCallCount = 0;
  lastDflowCallAt = null;
}
async function getSwapQuoteRouted(params) {
  const startTime = Date.now();
  const correlationId = params.correlationId || makeCorrelationId("swap");
  const { tokenIn, tokenOut, amountIn, slippageBps, chainId, fallbackQuote } = params;
  if (process.env.NODE_ENV !== "production") {
    console.log(`[ROUTING] kind=swap_quote mode=${ROUTING_MODE} corr=${correlationId}`);
  }
  if (ROUTING_MODE === "deterministic") {
    if (fallbackQuote) {
      const fallbackData = await fallbackQuote();
      const latencyMs3 = Date.now() - startTime;
      if (fallbackData) {
        if (process.env.NODE_ENV !== "production") {
          console.log(`[ROUTING] kind=swap_quote source=fallback latencyMs=${latencyMs3} corr=${correlationId}`);
        }
        return {
          ok: true,
          data: {
            tokenIn,
            tokenOut,
            amountIn,
            amountOut: fallbackData.amountOut,
            minAmountOut: fallbackData.minAmountOut,
            slippageBps: slippageBps || 50,
            routeSummary: fallbackData.routeSummary,
            gas: fallbackData.gas
          },
          routing: {
            source: "fallback",
            kind: "swap_quote",
            ok: true,
            reason: "ROUTING_MODE=deterministic (dFlow disabled)",
            latencyMs: latencyMs3,
            mode: "deterministic",
            correlationId
          }
        };
      }
    }
    const latencyMs2 = Date.now() - startTime;
    return {
      ok: false,
      routing: {
        source: "fallback",
        kind: "swap_quote",
        ok: false,
        reason: "ROUTING_MODE=deterministic and fallback unavailable",
        latencyMs: latencyMs2,
        mode: "deterministic",
        correlationId
      },
      error: {
        code: "FALLBACK_UNAVAILABLE",
        message: "Deterministic routing mode requires fallback quote provider"
      }
    };
  }
  if (ROUTING_MODE === "dflow") {
    if (!isDflowConfigured() || !isDflowCapabilityAvailable("swapsQuotes")) {
      const latencyMs3 = Date.now() - startTime;
      return {
        ok: false,
        routing: {
          source: "dflow",
          kind: "swap_quote",
          ok: false,
          reason: "dFlow not configured or swapsQuotes capability unavailable",
          latencyMs: latencyMs3,
          mode: ROUTING_MODE,
          correlationId
        },
        error: {
          code: "DFLOW_REQUIRED",
          message: "ROUTING_MODE=dflow requires dFlow to be configured and available"
        }
      };
    }
    if (DFLOW_FORCE_FAIL) {
      const latencyMs3 = Date.now() - startTime;
      return {
        ok: false,
        routing: {
          source: "dflow",
          kind: "swap_quote",
          ok: false,
          reason: "DEV: DFLOW_FORCE_FAIL=true (testing fallback)",
          latencyMs: latencyMs3,
          mode: "dflow",
          correlationId
        },
        error: {
          code: "DFLOW_REQUIRED",
          message: "dFlow routing required but forced to fail (DEV mode)"
        }
      };
    }
    if (DFLOW_FORCE_TIMEOUT) {
      await new Promise((resolve3) => setTimeout(resolve3, 11e3));
    }
    dflowCallCount++;
    lastDflowCallAt = Date.now();
    const dflowResult = await getSwapQuote({
      tokenIn,
      tokenOut,
      amountIn,
      slippageBps,
      chainId
    });
    const latencyMs2 = Date.now() - startTime;
    if (process.env.NODE_ENV !== "production") {
      console.log(`[ROUTING] kind=swap_quote source=${dflowResult.ok ? "dflow" : "fallback"} latencyMs=${latencyMs2} corr=${correlationId}`);
    }
    if (dflowResult.ok && dflowResult.data) {
      return {
        ok: true,
        data: {
          tokenIn: dflowResult.data.tokenIn,
          tokenOut: dflowResult.data.tokenOut,
          amountIn: dflowResult.data.amountIn,
          amountOut: dflowResult.data.amountOut,
          minAmountOut: dflowResult.data.minAmountOut,
          slippageBps: dflowResult.data.slippageBps,
          route: dflowResult.data.route,
          routeSummary: dflowResult.data.routeSummary,
          gas: dflowResult.data.gas,
          priceImpact: dflowResult.data.priceImpact
        },
        routing: {
          source: "dflow",
          kind: "swap_quote",
          ok: true,
          latencyMs: latencyMs2,
          mode: "dflow",
          correlationId
        }
      };
    }
    const errorReason = dflowResult.error || (DFLOW_FORCE_TIMEOUT ? "timeout" : `HTTP ${dflowResult.statusCode || "unknown"}`);
    return {
      ok: false,
      routing: {
        source: "dflow",
        kind: "swap_quote",
        ok: false,
        reason: errorReason,
        latencyMs: latencyMs2,
        mode: "dflow",
        correlationId
      },
      error: {
        code: "DFLOW_REQUIRED",
        message: `dFlow routing required but failed: ${errorReason}`
      }
    };
  }
  if (ROUTING_MODE === "hybrid" || DFLOW_ENABLED) {
    if (!DFLOW_FORCE_FAIL && !DFLOW_FORCE_TIMEOUT && isDflowConfigured() && isDflowCapabilityAvailable("swapsQuotes")) {
      dflowCallCount++;
      lastDflowCallAt = Date.now();
      const dflowResult = await getSwapQuote({
        tokenIn,
        tokenOut,
        amountIn,
        slippageBps,
        chainId
      });
      const latencyMs2 = Date.now() - startTime;
      if (process.env.NODE_ENV !== "production") {
        console.log(`[ROUTING] kind=swap_quote source=${dflowResult.ok ? "dflow" : "fallback"} latencyMs=${latencyMs2} corr=${correlationId}`);
      }
      if (dflowResult.ok && dflowResult.data) {
        return {
          ok: true,
          data: {
            tokenIn: dflowResult.data.tokenIn,
            tokenOut: dflowResult.data.tokenOut,
            amountIn: dflowResult.data.amountIn,
            amountOut: dflowResult.data.amountOut,
            minAmountOut: dflowResult.data.minAmountOut,
            slippageBps: dflowResult.data.slippageBps,
            route: dflowResult.data.route,
            routeSummary: dflowResult.data.routeSummary,
            gas: dflowResult.data.gas,
            priceImpact: dflowResult.data.priceImpact
          },
          routing: {
            source: "dflow",
            kind: "swap_quote",
            ok: true,
            latencyMs: latencyMs2,
            mode: ROUTING_MODE,
            correlationId
          }
        };
      }
      if (fallbackQuote) {
        const fallbackStartTime = Date.now();
        const fallbackData = await fallbackQuote();
        const totalLatencyMs = Date.now() - startTime;
        if (fallbackData) {
          const fallbackReason = DFLOW_FORCE_FAIL ? "DEV: DFLOW_FORCE_FAIL=true (forced_fail)" : DFLOW_FORCE_TIMEOUT ? "DEV: DFLOW_FORCE_TIMEOUT=true (timeout)" : `dFlow failed: ${dflowResult.error || `HTTP ${dflowResult.statusCode || "unknown"}`}`;
          return {
            ok: true,
            data: {
              tokenIn,
              tokenOut,
              amountIn,
              amountOut: fallbackData.amountOut,
              minAmountOut: fallbackData.minAmountOut,
              slippageBps: slippageBps || 50,
              routeSummary: fallbackData.routeSummary,
              gas: fallbackData.gas
            },
            routing: {
              source: "fallback",
              kind: "swap_quote",
              ok: true,
              reason: fallbackReason,
              latencyMs: totalLatencyMs,
              mode: ROUTING_MODE,
              correlationId
            }
          };
        }
      }
      const errorReason = DFLOW_FORCE_TIMEOUT ? "timeout" : dflowResult.error || `HTTP ${dflowResult.statusCode || "unknown"}`;
      return {
        ok: false,
        routing: {
          source: "dflow",
          kind: "swap_quote",
          ok: false,
          reason: errorReason,
          latencyMs: latencyMs2,
          mode: ROUTING_MODE,
          correlationId
        },
        error: {
          code: "ROUTING_FAILED",
          message: `dFlow failed and fallback unavailable: ${errorReason}`
        }
      };
    }
  }
  if (fallbackQuote) {
    const fallbackData = await fallbackQuote();
    const latencyMs2 = Date.now() - startTime;
    if (fallbackData) {
      return {
        ok: true,
        data: {
          tokenIn,
          tokenOut,
          amountIn,
          amountOut: fallbackData.amountOut,
          minAmountOut: fallbackData.minAmountOut,
          slippageBps: slippageBps || 50,
          routeSummary: fallbackData.routeSummary,
          gas: fallbackData.gas
        },
        routing: {
          source: "fallback",
          kind: "swap_quote",
          ok: true,
          reason: "dFlow not enabled or unavailable",
          latencyMs: latencyMs2,
          mode: ROUTING_MODE,
          correlationId
        }
      };
    }
  }
  const latencyMs = Date.now() - startTime;
  return {
    ok: false,
    routing: {
      source: "fallback",
      kind: "swap_quote",
      ok: false,
      reason: "No routing providers available",
      latencyMs,
      mode: ROUTING_MODE,
      correlationId
    },
    error: {
      code: "ROUTING_UNAVAILABLE",
      message: "No swap quote routing available"
    }
  };
}
async function getEventMarketsRouted(params) {
  const startTime = Date.now();
  const correlationId = params.correlationId || makeCorrelationId("markets");
  const { limit = 10, fallbackMarkets } = params;
  if (process.env.NODE_ENV !== "production") {
    console.log(`[ROUTING] kind=event_markets mode=${ROUTING_MODE} corr=${correlationId}`);
  }
  if (ROUTING_MODE === "deterministic") {
    if (fallbackMarkets) {
      const fallbackData = await fallbackMarkets();
      const latencyMs3 = Date.now() - startTime;
      if (process.env.NODE_ENV !== "production") {
        console.log(`[ROUTING] kind=event_markets source=fallback latencyMs=${latencyMs3} corr=${correlationId}`);
      }
      return {
        ok: true,
        data: fallbackData.slice(0, limit),
        routing: {
          source: "fallback",
          kind: "event_markets",
          ok: true,
          reason: "ROUTING_MODE=deterministic (dFlow disabled)",
          latencyMs: latencyMs3,
          mode: "deterministic",
          correlationId
        }
      };
    }
    const latencyMs2 = Date.now() - startTime;
    return {
      ok: false,
      routing: {
        source: "fallback",
        kind: "event_markets",
        ok: false,
        reason: "ROUTING_MODE=deterministic and fallback unavailable",
        latencyMs: latencyMs2,
        mode: "deterministic",
        correlationId
      },
      error: {
        code: "FALLBACK_UNAVAILABLE",
        message: "Deterministic routing mode requires fallback markets provider"
      }
    };
  }
  if (ROUTING_MODE === "dflow") {
    if (!isDflowConfigured() || !isDflowCapabilityAvailable("eventsMarkets")) {
      const latencyMs3 = Date.now() - startTime;
      return {
        ok: false,
        routing: {
          source: "dflow",
          kind: "event_markets",
          ok: false,
          reason: "dFlow not configured or eventsMarkets capability unavailable",
          latencyMs: latencyMs3,
          mode: ROUTING_MODE,
          correlationId
        },
        error: {
          code: "DFLOW_REQUIRED",
          message: "ROUTING_MODE=dflow requires dFlow to be configured and available"
        }
      };
    }
    if (DFLOW_FORCE_FAIL) {
      const latencyMs3 = Date.now() - startTime;
      return {
        ok: false,
        routing: {
          source: "dflow",
          kind: "event_markets",
          ok: false,
          reason: "DEV: DFLOW_FORCE_FAIL=true (testing fallback)",
          latencyMs: latencyMs3,
          mode: "dflow",
          correlationId
        },
        error: {
          code: "DFLOW_REQUIRED",
          message: "dFlow routing required but forced to fail (DEV mode)"
        }
      };
    }
    if (DFLOW_FORCE_TIMEOUT) {
      await new Promise((resolve3) => setTimeout(resolve3, 11e3));
    }
    dflowCallCount++;
    lastDflowCallAt = Date.now();
    const dflowResult = await getEventMarkets();
    const latencyMs2 = Date.now() - startTime;
    if (process.env.NODE_ENV !== "production") {
      console.log(`[ROUTING] kind=event_markets source=${dflowResult.ok ? "dflow" : "fallback"} latencyMs=${latencyMs2} corr=${correlationId}`);
    }
    if (dflowResult.ok && dflowResult.data && Array.isArray(dflowResult.data) && dflowResult.data.length > 0) {
      return {
        ok: true,
        data: dflowResult.data.slice(0, limit).map((m) => ({
          id: m.id,
          title: m.title,
          yesPrice: m.yesPrice,
          noPrice: m.noPrice,
          volume24hUsd: m.volume24hUsd,
          openInterestUsd: m.openInterestUsd,
          liquidity: m.liquidity,
          spread: m.spread
        })),
        routing: {
          source: "dflow",
          kind: "event_markets",
          ok: true,
          latencyMs: latencyMs2,
          mode: "dflow",
          correlationId
        }
      };
    }
    const errorReason = dflowResult.error || (DFLOW_FORCE_TIMEOUT ? "timeout" : `HTTP ${dflowResult.statusCode || "unknown"}`);
    return {
      ok: false,
      routing: {
        source: "dflow",
        kind: "event_markets",
        ok: false,
        reason: errorReason,
        latencyMs: latencyMs2,
        mode: "dflow",
        correlationId
      },
      error: {
        code: "DFLOW_REQUIRED",
        message: `dFlow routing required but failed: ${errorReason}`
      }
    };
  }
  if (ROUTING_MODE === "hybrid" || DFLOW_ENABLED) {
    if (!DFLOW_FORCE_FAIL && !DFLOW_FORCE_TIMEOUT && isDflowConfigured() && isDflowCapabilityAvailable("eventsMarkets")) {
      dflowCallCount++;
      lastDflowCallAt = Date.now();
      const dflowResult = await getEventMarkets();
      const latencyMs2 = Date.now() - startTime;
      if (process.env.NODE_ENV !== "production") {
        console.log(`[ROUTING] kind=event_markets source=${dflowResult.ok ? "dflow" : "fallback"} latencyMs=${latencyMs2} corr=${correlationId}`);
      }
      if (dflowResult.ok && dflowResult.data && Array.isArray(dflowResult.data) && dflowResult.data.length > 0) {
        return {
          ok: true,
          data: dflowResult.data.slice(0, limit).map((m) => ({
            id: m.id,
            title: m.title,
            yesPrice: m.yesPrice,
            noPrice: m.noPrice,
            volume24hUsd: m.volume24hUsd,
            openInterestUsd: m.openInterestUsd,
            liquidity: m.liquidity,
            spread: m.spread
          })),
          routing: {
            source: "dflow",
            kind: "event_markets",
            ok: true,
            latencyMs: latencyMs2,
            mode: ROUTING_MODE,
            correlationId
          }
        };
      }
      if (fallbackMarkets) {
        const fallbackData = await fallbackMarkets();
        const totalLatencyMs = Date.now() - startTime;
        const fallbackReason = DFLOW_FORCE_FAIL ? "DEV: DFLOW_FORCE_FAIL=true (forced_fail)" : DFLOW_FORCE_TIMEOUT ? "DEV: DFLOW_FORCE_TIMEOUT=true (timeout)" : `dFlow failed: ${dflowResult.error || `HTTP ${dflowResult.statusCode || "unknown"}`}`;
        return {
          ok: true,
          data: fallbackData.slice(0, limit),
          routing: {
            source: "fallback",
            kind: "event_markets",
            ok: true,
            reason: fallbackReason,
            latencyMs: totalLatencyMs,
            mode: ROUTING_MODE,
            correlationId
          }
        };
      }
      const errorReason = DFLOW_FORCE_TIMEOUT ? "timeout" : dflowResult.error || `HTTP ${dflowResult.statusCode || "unknown"}`;
      return {
        ok: false,
        routing: {
          source: "dflow",
          kind: "event_markets",
          ok: false,
          reason: errorReason,
          latencyMs: latencyMs2,
          mode: ROUTING_MODE,
          correlationId
        },
        error: {
          code: "ROUTING_FAILED",
          message: `dFlow failed and fallback unavailable: ${errorReason}`
        }
      };
    }
  }
  if (fallbackMarkets) {
    const fallbackData = await fallbackMarkets();
    const latencyMs2 = Date.now() - startTime;
    if (process.env.NODE_ENV !== "production") {
      console.log(`[ROUTING] kind=event_markets source=fallback latencyMs=${latencyMs2} corr=${correlationId}`);
    }
    return {
      ok: true,
      data: fallbackData.slice(0, limit),
      routing: {
        source: "fallback",
        kind: "event_markets",
        ok: true,
        reason: "dFlow not enabled or unavailable",
        latencyMs: latencyMs2,
        mode: ROUTING_MODE,
        correlationId
      }
    };
  }
  const latencyMs = Date.now() - startTime;
  return {
    ok: false,
    routing: {
      source: "fallback",
      kind: "event_markets",
      ok: false,
      reason: "No routing providers available",
      latencyMs,
      mode: ROUTING_MODE,
      correlationId
    },
    error: {
      code: "ROUTING_UNAVAILABLE",
      message: "No event markets routing available"
    }
  };
}
var DFLOW_FORCE_FAIL, DFLOW_FORCE_TIMEOUT, dflowCallCount, lastDflowCallAt;
var init_routingService = __esm({
  "agent/src/routing/routingService.ts"() {
    "use strict";
    init_config();
    init_dflowClient();
    init_correlationId();
    DFLOW_FORCE_FAIL = process.env.DFLOW_FORCE_FAIL === "true" && process.env.NODE_ENV !== "production";
    DFLOW_FORCE_TIMEOUT = process.env.DFLOW_FORCE_TIMEOUT === "true" && process.env.NODE_ENV !== "production";
    dflowCallCount = 0;
    lastDflowCallAt = null;
  }
});

// agent/src/quotes/eventMarkets.ts
var eventMarkets_exports = {};
__export(eventMarkets_exports, {
  findEventMarketByKeyword: () => findEventMarketByKeyword,
  getEventMarkets: () => getEventMarkets2,
  getEventMarketsWithRouting: () => getEventMarketsWithRouting
});
async function getEventMarkets2(limit = 10) {
  const now = Date.now();
  if (cachedMarkets && now - cacheTimestamp2 < CACHE_TTL_MS2) {
    return cachedMarkets.slice(0, limit);
  }
  const { makeCorrelationId: makeCorrelationId2 } = await Promise.resolve().then(() => (init_correlationId(), correlationId_exports));
  const routingCorrelationId = makeCorrelationId2("markets");
  const routedResult = await getEventMarketsRouted({
    limit,
    correlationId: routingCorrelationId,
    fallbackMarkets: async () => {
      try {
        const response = await fetch("https://clob.polymarket.com/markets", {
          headers: {
            "Accept": "application/json"
          }
        });
        if (response.ok) {
          const data = await response.json();
          const markets = Array.isArray(data) ? data.filter((m) => m.question && m.conditionId).map((m) => ({
            id: m.conditionId || m.id || `poly-${Date.now()}-${Math.random()}`,
            title: m.question || m.title || "Unknown Market",
            yesPrice: m.outcomes?.[0]?.price || 0.5,
            noPrice: m.outcomes?.[1]?.price || 0.5,
            volume24hUsd: m.volume24h || 0,
            source: "polymarket"
          })) : [];
          return markets;
        }
      } catch (error) {
        console.warn("[getEventMarkets] Polymarket fetch failed:", error.message);
      }
      return FALLBACK_MARKETS;
    }
  });
  if (routedResult.ok && routedResult.data) {
    const markets = routedResult.data.map((m) => ({
      id: m.id,
      title: m.title,
      yesPrice: m.yesPrice,
      noPrice: m.noPrice,
      volume24hUsd: m.volume24hUsd,
      source: routedResult.routing.source === "dflow" ? "dflow" : "polymarket"
    }));
    cachedMarkets = markets;
    cacheTimestamp2 = now;
    return markets;
  }
  cachedMarkets = FALLBACK_MARKETS;
  cacheTimestamp2 = now;
  return FALLBACK_MARKETS.slice(0, limit);
}
async function getEventMarketsWithRouting(limit = 10) {
  const { makeCorrelationId: makeCorrelationId2 } = await Promise.resolve().then(() => (init_correlationId(), correlationId_exports));
  const routingCorrelationId = makeCorrelationId2("markets");
  const routedResult = await getEventMarketsRouted({
    limit,
    correlationId: routingCorrelationId,
    fallbackMarkets: async () => {
      try {
        const response = await fetch("https://clob.polymarket.com/markets", {
          headers: {
            "Accept": "application/json"
          }
        });
        if (response.ok) {
          const data = await response.json();
          const markets = Array.isArray(data) ? data.filter((m) => m.question && m.conditionId).map((m) => ({
            id: m.conditionId || m.id || `poly-${Date.now()}-${Math.random()}`,
            title: m.question || m.title || "Unknown Market",
            yesPrice: m.outcomes?.[0]?.price || 0.5,
            noPrice: m.outcomes?.[1]?.price || 0.5,
            volume24hUsd: m.volume24h || 0,
            source: "polymarket"
          })) : [];
          return markets;
        }
      } catch (error) {
      }
      return FALLBACK_MARKETS;
    }
  });
  const routing = routedResult.routing || {
    source: "fallback",
    kind: "event_markets",
    ok: false,
    reason: "Routing service returned no metadata",
    latencyMs: 0,
    mode: "hybrid",
    correlationId: routingCorrelationId
  };
  if (routedResult.ok && routedResult.data) {
    const markets = routedResult.data.map((m) => ({
      id: m.id,
      title: m.title,
      yesPrice: m.yesPrice,
      noPrice: m.noPrice,
      volume24hUsd: m.volume24hUsd,
      source: routing.source === "dflow" ? "dflow" : "polymarket"
    }));
    return {
      markets,
      routing
    };
  }
  return {
    markets: FALLBACK_MARKETS.slice(0, limit),
    routing
  };
}
async function findEventMarketByKeyword(keyword) {
  const markets = await getEventMarkets2(10);
  const lowerKeyword = keyword.toLowerCase();
  const match = markets.find(
    (m) => m.title.toLowerCase().includes(lowerKeyword) || lowerKeyword.includes(m.title.toLowerCase().split(" ")[0])
  );
  return match || markets[0] || null;
}
var cachedMarkets, cacheTimestamp2, CACHE_TTL_MS2, FALLBACK_MARKETS;
var init_eventMarkets = __esm({
  "agent/src/quotes/eventMarkets.ts"() {
    "use strict";
    init_routingService();
    cachedMarkets = null;
    cacheTimestamp2 = 0;
    CACHE_TTL_MS2 = 60 * 1e3;
    FALLBACK_MARKETS = [
      { id: "FED_CUTS_MAR_2025", title: "Fed cuts in March 2025", yesPrice: 0.62, noPrice: 0.38, source: "fallback" },
      { id: "BTC_ETF_APPROVAL_2025", title: "BTC ETF approved by Dec 31", yesPrice: 0.68, noPrice: 0.32, source: "fallback" },
      { id: "ETH_ETF_APPROVAL_2025", title: "ETH ETF approved by June 2025", yesPrice: 0.58, noPrice: 0.42, source: "fallback" },
      { id: "TRUMP_2024_WIN", title: "Trump wins 2024 election", yesPrice: 0.52, noPrice: 0.48, source: "fallback" },
      { id: "SOL_ADOPTION_2025", title: "Solana adoption surges in 2025", yesPrice: 0.64, noPrice: 0.36, source: "fallback" }
    ];
  }
});

// agent/src/utils/actionParser.ts
var actionParser_exports = {};
__export(actionParser_exports, {
  buildBlossomPrompts: () => buildBlossomPrompts,
  buildPredictionMarketResponse: () => buildPredictionMarketResponse,
  validateActions: () => validateActions,
  validateExecutionRequest: () => validateExecutionRequest
});
function validateActions(raw) {
  if (!Array.isArray(raw)) {
    console.warn("Actions is not an array:", typeof raw);
    return [];
  }
  const validActions = [];
  for (const item of raw) {
    try {
      if (!item || typeof item !== "object") {
        console.warn("Invalid action item (not an object):", item);
        continue;
      }
      if (item.type === "perp" && item.action === "open") {
        if (typeof item.market === "string" && (item.side === "long" || item.side === "short") && typeof item.riskPct === "number" && item.riskPct > 0 && item.riskPct <= 5 && // Enforce 5% max
        Array.isArray(item.reasoning)) {
          validActions.push({
            type: "perp",
            action: "open",
            market: item.market,
            side: item.side,
            riskPct: Math.min(item.riskPct, 5),
            // Cap at 5%
            entry: typeof item.entry === "number" ? item.entry : void 0,
            takeProfit: typeof item.takeProfit === "number" ? item.takeProfit : void 0,
            stopLoss: typeof item.stopLoss === "number" ? item.stopLoss : void 0,
            reasoning: item.reasoning.filter((r) => typeof r === "string")
          });
        } else {
          console.warn("Invalid perp action:", item);
        }
      } else if (item.type === "defi" && item.action === "deposit") {
        if (typeof item.protocol === "string" && typeof item.asset === "string" && typeof item.amountUsd === "number" && item.amountUsd > 0 && typeof item.apr === "number" && Array.isArray(item.reasoning)) {
          validActions.push({
            type: "defi",
            action: "deposit",
            protocol: item.protocol,
            asset: item.asset,
            amountUsd: item.amountUsd,
            apr: item.apr,
            reasoning: item.reasoning.filter((r) => typeof r === "string")
          });
        } else {
          console.warn("Invalid defi action:", item);
        }
      } else if (item.type === "event" && item.action === "open") {
        if (typeof item.eventKey === "string" && typeof item.label === "string" && (item.side === "YES" || item.side === "NO") && typeof item.stakeUsd === "number" && item.stakeUsd > 0 && typeof item.maxPayoutUsd === "number" && typeof item.maxLossUsd === "number" && Array.isArray(item.reasoning)) {
          validActions.push({
            type: "event",
            action: "open",
            eventKey: item.eventKey,
            label: item.label,
            side: item.side,
            stakeUsd: item.stakeUsd,
            maxPayoutUsd: item.maxPayoutUsd,
            maxLossUsd: item.maxLossUsd,
            reasoning: item.reasoning.filter((r) => typeof r === "string"),
            overrideRiskCap: typeof item.overrideRiskCap === "boolean" ? item.overrideRiskCap : void 0,
            requestedStakeUsd: typeof item.requestedStakeUsd === "number" ? item.requestedStakeUsd : void 0
          });
        } else {
          console.warn("Invalid event action:", item);
        }
      } else if (item.type === "event" && item.action === "update") {
        if (typeof item.positionId === "string" && typeof item.eventKey === "string" && typeof item.label === "string" && (item.side === "YES" || item.side === "NO") && typeof item.stakeUsd === "number" && item.stakeUsd > 0 && typeof item.maxPayoutUsd === "number" && typeof item.maxLossUsd === "number" && Array.isArray(item.reasoning)) {
          validActions.push({
            type: "event",
            action: "update",
            eventKey: item.eventKey,
            label: item.label,
            side: item.side,
            stakeUsd: item.stakeUsd,
            maxPayoutUsd: item.maxPayoutUsd,
            maxLossUsd: item.maxLossUsd,
            reasoning: item.reasoning.filter((r) => typeof r === "string"),
            positionId: item.positionId,
            overrideRiskCap: typeof item.overrideRiskCap === "boolean" ? item.overrideRiskCap : false,
            requestedStakeUsd: typeof item.requestedStakeUsd === "number" ? item.requestedStakeUsd : void 0
          });
        } else {
          console.warn("Invalid event update action:", item);
        }
      } else {
        console.warn("Unknown action type or action:", item);
      }
    } catch (error) {
      console.warn("Error validating action:", error.message, item);
    }
  }
  return validActions;
}
async function buildBlossomPrompts(args) {
  const { userMessage, portfolio: portfolio2, venue } = args;
  const systemPrompt = `You are Blossom, an AI trading copilot. You speak clearly and concisely, like a professional portfolio manager. You always:

1. Restate the user's intent in one sentence.
2. Summarize the strategy in 2-3 bullet points.
3. Highlight risk in plain language.
4. Suggest one simple next step or question.

CRITICAL - Risk Management Rules:
- Default per-strategy risk cap: 3% of the total account value.
- NEVER exceed 5% of the total account value for any single strategy.
- Event market stake cap: 2-3% of the total account value.
- Single DeFi protocol cap: ~25% of idle capital (REDACTED balance).
- Always provide clear reasoning bullets for each action.

CRITICAL - Environment:
- This is a SIMULATED demo environment. NO REAL ORDERS OR TRANSACTIONS WILL BE EXECUTED.
- All actions are purely for demonstration and testing purposes.
- Mention "In this SIM environment..." occasionally to remind users.

CRITICAL - Never Say "I Can't Process":
- If the user's intent is unclear, ASK a clarifying question instead of saying "I can't process" or "I cannot".
- Example clarifying questions:
  * "I'd be happy to help! Are you looking to swap, trade perps, or explore yield opportunities?"
  * "Got it, you want to trade. What asset and how much would you like to use?"
  * "I see you're interested in prediction markets. Would you like me to show top markets by volume?"
- ONLY respond with an error if the request is truly impossible (e.g., unsupported chain, invalid token).
- When in doubt, offer 2-3 options for the user to choose from.
- If user says something vague like "I want to make money" or "help me invest", suggest concrete options.

CRITICAL - Token Inference:
- "I have ETH" or "I only have ETH" + swap request \u2192 tokenIn is ETH
- "Convert my REDACTED" \u2192 tokenIn is REDACTED
- "Get me some WETH" \u2192 tokenOut is WETH
- "Swap to REDACTED" \u2192 tokenOut is REDACTED
- Always infer the most logical interpretation. Ask only if truly ambiguous.
- If user has a balance and wants to swap, infer they want to swap FROM their largest balance.

CRITICAL - Output Format:
- You MUST respond with a single JSON object with top-level keys: "assistantMessage" (string), "actions" (array), and optionally "executionRequest" (object).
- No commentary or text outside the JSON object.
- The "assistantMessage" must be short, clear, and never mention JSON or technical details.
- The "assistantMessage" should follow the 4-step structure above (restate intent, summarize strategy, highlight risk, suggest next step).
- The "actions" array MUST contain valid BlossomAction objects for simulation. For on-chain swaps, "actions" may be empty.
- For on-chain swap requests, you MUST include an "executionRequest" field.

CRITICAL - Execution Request Format (for on-chain swaps):
- When user requests a swap (e.g., "Swap X REDACTED to WETH" or "I only have ETH, swap to REDACTED"), you MUST include "executionRequest":
{
  "executionRequest": {
    "kind": "swap",
    "chain": "sepolia",
    "tokenIn": "ETH" | "WETH" | "REDACTED",
    "tokenOut": "WETH" | "REDACTED",
    "amountIn": "0.01",  // REQUIRED: decimal string (e.g., "0.01" for ETH, "10" for REDACTED)
    "slippageBps": 50,   // basis points (50 = 0.5%)
    "fundingPolicy": "auto"  // "auto" allows funding routes, "require_tokenIn" requires user to hold tokenIn
  }
}

Examples:
1. "Swap 10 REDACTED to WETH" \u2192 
{
  "executionRequest": {
    "kind": "swap",
    "chain": "sepolia",
    "tokenIn": "REDACTED",
    "tokenOut": "WETH",
    "amountIn": "10",
    "slippageBps": 50,
    "fundingPolicy": "require_tokenIn"
  }
}

2. "I only have ETH. Swap 0.01 ETH to WETH" \u2192
{
  "executionRequest": {
    "kind": "swap",
    "chain": "sepolia",
    "tokenIn": "ETH",
    "tokenOut": "WETH",
    "amountIn": "0.01",
    "slippageBps": 50,
    "fundingPolicy": "auto"
  }
}

3. "Swap enough ETH to get 10 REDACTED" \u2192
{
  "executionRequest": {
    "kind": "swap",
    "chain": "sepolia",
    "tokenIn": "ETH",
    "tokenOut": "REDACTED",
    "amountIn": "0.01",  // YOU must explicitly choose amountIn (cannot be "enough")
    "amountOut": "10",   // optional target
    "slippageBps": 50,
    "fundingPolicy": "auto"
  }
}

CRITICAL - amountIn requirement:
- You MUST always provide a specific amountIn value (decimal string).
- If user says "enough" or "sufficient", you must calculate and provide an explicit amount.
- For ETH: use decimal format like "0.01", "0.1", "1.0"
- For REDACTED: use decimal format like "10", "100", "1000"

CRITICAL - Execution Request Format (for perp positions):
- When user requests a perp position AND mentions leverage (e.g., "long BTC with 20x leverage", "5x leverage on ETH"), you MUST include "executionRequest" with the leverage field:
{
  "executionRequest": {
    "kind": "perp",
    "market": "BTC-PERP" | "ETH-PERP" | "SOL-PERP",
    "side": "long" | "short",
    "leverage": 20,  // REQUIRED if user mentions leverage (extract from "20x", "5x leverage", etc.)
    "riskPct": 2.0,  // percentage of account to risk
    "entryPrice": 95000,  // optional target entry
    "takeProfitPrice": 105000,  // optional TP target
    "stopLossPrice": 92000  // optional SL target
  }
}

IMPORTANT: Extract leverage from user requests:
- "20x leverage" \u2192 leverage: 20
- "5.5x" \u2192 leverage: 5.5
- "use 3x" \u2192 leverage: 3
- If user doesn't mention leverage, do NOT include it (will default to 2x)

Product Pillars:
- Perps execution & risk: Open and manage perpetual futures positions with automatic risk management.
- DeFi yield deployment: Park idle REDACTED into yield-generating protocols (Kamino, RootsFi, Jet).
- Event market bets: Take positions on prediction markets (Fed cuts, ETF approvals, elections). For "bet/bet YES/bet NO on [event]" requests, include executionRequest with kind: "event", marketId: "[market id]", outcome: "YES"/"NO", stakeUsd: [amount].

CRITICAL - Prediction Market Queries:
- When the user asks about "Kalshi", "Polymarket", "prediction markets", "top markets", "trending markets", or "highest volume market", you MUST focus ONLY on prediction markets.
- Do NOT suggest perps, DeFi, or other trading strategies when answering prediction market questions.
- Do NOT say "I can help with perps trading strategies..." when asked about prediction markets.
- If prediction market data is provided in the user prompt (either live or fallback), you MUST:
  * Reference the specific markets by their exact names
  * Provide a numbered list (1, 2, 3, etc.) with market names, YES probabilities, and volumes
  * NOT mention perps, futures, liquidation, stop losses, or any perp-specific terms
- For discovery queries (listing markets), provide ONLY the numbered list in your assistantMessage. Do NOT include actions in JSON.
- For execution queries (risking on a market), include an event action in the JSON with the exact market details provided.

Example JSON output (perp with leverage):
{
  "assistantMessage": "I'll open a long ETH perp position with 5x leverage and 3% account risk. This strategy targets $3,640 take profit and $3,395 stop loss, keeping your liquidation buffer comfortable. Risk is capped at 3% of account value. Would you like me to adjust the risk level or entry price?",
  "actions": [
    {
      "type": "perp",
      "action": "open",
      "market": "ETH-PERP",
      "side": "long",
      "riskPct": 3.0,
      "entry": 3500,
      "takeProfit": 3640,
      "stopLoss": 3395,
      "reasoning": ["ETH is trending up", "Risk is within 3% cap", "Stop loss protects downside"]
    }
  ],
  "executionRequest": {
    "kind": "perp",
    "market": "ETH-PERP",
    "side": "long",
    "leverage": 5,
    "riskPct": 3.0,
    "entryPrice": 3500,
    "takeProfitPrice": 3640,
    "stopLossPrice": 3395
  }
}

CRITICAL - Execution Request Format (for DeFi lending/yield):
- When user requests to allocate/deposit funds to a protocol (e.g., "Allocate amountUsd:500 to protocol:Aave V3", "Allocate 10% to Lido"), you MUST include "executionRequest":
{
  "executionRequest": {
    "kind": "lend",
    "chain": "sepolia",
    "asset": "REDACTED",
    "amount": "500",  // REQUIRED: decimal string (USD amount)
    "protocol": "demo",  // Use "demo" for testnet
    "vault": "Aave V3"  // Protocol name from user request
  }
}

IMPORTANT - Parsing DeFi allocation requests:
- "Allocate amountUsd:"500" to protocol:"Aave V3" REDACTED yield" \u2192 amount: "500", vault: "Aave V3"
- "Allocate amountPct:"10" to protocol:"Lido" REDACTED yield" \u2192 calculate amount from account value (10% of portfolio), vault: "Lido"
- Extract protocol name from protocol:"[name]" (with or without quotes)
- Extract amount from amountUsd:"[value]" or amountPct:"[value]" (with or without quotes)
- "Deposit $1000 into Compound" \u2192 amount: "1000", vault: "Compound"
- "Park 500 REDACTED in highest APY vault" \u2192 amount: "500", vault: use highest APY from TOP YIELD VAULTS

Example JSON output (DeFi yield allocation):
{
  "assistantMessage": "I'll allocate $500 to Aave V3's REDACTED lending pool, earning 6.4% APY. This uses idle REDACTED capital efficiently while keeping funds accessible. The allocation is within the 25% single-protocol cap. Confirm to execute?",
  "actions": [
    {
      "type": "defi",
      "action": "deposit",
      "protocol": "Aave V3",
      "asset": "REDACTED",
      "amountUsd": 500,
      "apr": 6.4,
      "reasoning": ["Highest APY vault available", "Within 25% protocol cap", "REDACTED remains accessible"]
    }
  ],
  "executionRequest": {
    "kind": "lend",
    "chain": "sepolia",
    "asset": "REDACTED",
    "amount": "500",
    "protocol": "demo",
    "vault": "Aave V3"
  }
}

CRITICAL - Execution Request Format (for event markets):
- When user requests to bet on an event (e.g., "Bet YES on Fed rate cut", "Risk $50 on election"), you MUST include "executionRequest":
{
  "executionRequest": {
    "kind": "event",
    "chain": "sepolia",
    "marketId": "fed-rate-cut-march-2025",  // Extract from EVENT MARKETS data
    "outcome": "YES" | "NO",
    "stakeUsd": 50,  // USD amount to stake
    "price": 0.65  // Optional: YES/NO price from EVENT MARKETS data
  }
}

Example JSON output (event market bet):
{
  "assistantMessage": "I'll place a YES bet on 'Fed cuts rates in March 2025' with $50 stake at 65% implied probability. Max payout: $76.92. Max loss: $50. This is 2% of your account value. Confirm to execute?",
  "actions": [
    {
      "type": "event",
      "action": "open",
      "eventKey": "fed-rate-cut-march-2025",
      "label": "Fed cuts rates in March 2025",
      "side": "YES",
      "stakeUsd": 50,
      "maxPayoutUsd": 76.92,
      "maxLossUsd": 50,
      "reasoning": ["Strong economic indicators", "Within 2% risk cap", "65% implied probability"]
    }
  ],
  "executionRequest": {
    "kind": "event",
    "chain": "sepolia",
    "marketId": "fed-rate-cut-march-2025",
    "outcome": "YES",
    "stakeUsd": 50,
    "price": 0.65
  }
}`;
  const lowerMessage = userMessage.toLowerCase();
  const isDefiIntent = /park|deposit|earn yield|lend|supply|yield|allocate/i.test(userMessage) && (lowerMessage.includes("usdc") || lowerMessage.includes("stablecoin") || lowerMessage.includes("yield") || lowerMessage.includes("protocol"));
  let topVaults = [];
  if (isDefiIntent) {
    try {
      const { getTopYieldVaults: getTopYieldVaults2 } = await Promise.resolve().then(() => (init_defiLlamaQuote(), defiLlamaQuote_exports));
      topVaults = await getTopYieldVaults2();
    } catch (error) {
      console.warn("[buildBlossomPrompts] Failed to fetch DefiLlama vaults:", error.message);
    }
  }
  let userPrompt = `**User Request:**
${userMessage}

`;
  if (isDefiIntent && topVaults.length > 0) {
    userPrompt += `**TOP YIELD VAULTS (from DefiLlama):**
`;
    topVaults.forEach((vault, idx) => {
      userPrompt += `${idx + 1}. ${vault.name} - ${vault.apy.toFixed(2)}% APY, TVL: $${(vault.tvl / 1e3).toFixed(0)}k
`;
    });
    userPrompt += `
**Recommendation:** For "park/deposit/earn yield" requests, recommend the highest APY vault (${topVaults[0]?.name || "Aave REDACTED"}) and build a PULL \u2192 LEND_SUPPLY execution plan.

`;
  }
  const isEventIntent = /bet|wager|risk.*on|event|prediction/i.test(userMessage) && (lowerMessage.includes("yes") || lowerMessage.includes("no") || lowerMessage.includes("fed") || lowerMessage.includes("rate cut"));
  let eventMarkets = [];
  if (isEventIntent) {
    try {
      const { getEventMarkets: getEventMarkets3 } = await Promise.resolve().then(() => (init_eventMarkets(), eventMarkets_exports));
      const markets = await getEventMarkets3(5);
      eventMarkets = markets.map((m) => ({ id: m.id, title: m.title, yesPrice: m.yesPrice, noPrice: m.noPrice }));
    } catch (error) {
      console.warn("[buildBlossomPrompts] Failed to fetch event markets:", error.message);
    }
  }
  if (isEventIntent && eventMarkets.length > 0) {
    userPrompt += `**EVENT MARKETS (from dFlow/Polymarket):**
`;
    eventMarkets.forEach((market, idx) => {
      userPrompt += `${idx + 1}. "${market.title}" - YES: ${(market.yesPrice * 100).toFixed(0)}%, NO: ${(market.noPrice * 100).toFixed(0)}%
`;
    });
    userPrompt += `
**Recommendation:** For "bet/bet YES/bet NO on [event]" requests, match keyword to market and build a PROOF execution plan with venueType=2.

`;
  }
  if (portfolio2) {
    const accountValue = portfolio2.accountValueUsd.toLocaleString();
    const usdc = portfolio2.balances.find((b) => b.symbol === "REDACTED")?.balanceUsd || 0;
    const openPerps = portfolio2.strategies.filter((s) => s.type === "perp" && s.status !== "closed").length;
    const openEvents = portfolio2.strategies.filter((s) => s.type === "event" && s.status !== "closed").length;
    const activeDefi = portfolio2.defiPositions.filter((p) => !p.isClosed).length;
    userPrompt += `**Current Portfolio State:**
`;
    userPrompt += `- Account Value: $${accountValue}
`;
    userPrompt += `- REDACTED Balance: $${usdc.toLocaleString()}
`;
    userPrompt += `- Open Perp Positions: ${openPerps}
`;
    userPrompt += `- Open Event Positions: ${openEvents}
`;
    userPrompt += `- Active DeFi Positions: ${activeDefi}
`;
    userPrompt += `- Open Perp Exposure: $${portfolio2.openPerpExposureUsd.toLocaleString()}
`;
    userPrompt += `- Event Exposure: $${portfolio2.eventExposureUsd.toLocaleString()}

`;
  }
  let isPredictionMarketQuery = false;
  if (venue === "event_demo") {
    const lowerMessage2 = userMessage.toLowerCase();
    const hasKalshi = lowerMessage2.includes("kalshi");
    const hasPolymarket = lowerMessage2.includes("polymarket");
    const hasPredictionMarket = lowerMessage2.includes("prediction market") || lowerMessage2.includes("prediction markets");
    const hasTop = lowerMessage2.includes("top");
    const hasTrending = lowerMessage2.includes("trending");
    const hasHighestVolume = lowerMessage2.includes("highest") && (lowerMessage2.includes("volume") || lowerMessage2.includes("vol"));
    const hasRightNow = lowerMessage2.includes("right now");
    const hasRisk = lowerMessage2.includes("risk") && (lowerMessage2.includes("%") || lowerMessage2.match(/\d+%/));
    const isAskingTopKalshi = hasKalshi && (hasTop || hasPredictionMarket || hasRightNow || hasTrending);
    const isAskingTopPolymarket = hasPolymarket && (hasTop || hasPredictionMarket || hasRightNow || hasTrending);
    const isAskingHighestVolume = hasHighestVolume && (hasKalshi || hasPolymarket || hasPredictionMarket);
    const isRiskingOnPredictionMarket = hasRisk && (hasHighestVolume || hasPredictionMarket || hasKalshi || hasPolymarket);
    const isAskingAboutKalshi = hasKalshi && (hasTop || hasTrending || hasRightNow);
    const isAskingAboutPolymarket = hasPolymarket && (hasTop || hasTrending || hasRightNow);
    isPredictionMarketQuery = !!(isAskingTopKalshi || isAskingTopPolymarket || isAskingHighestVolume || hasKalshi && hasPredictionMarket || hasPolymarket && hasPredictionMarket || isAskingAboutKalshi || isAskingAboutPolymarket || isRiskingOnPredictionMarket);
    console.log("[prediction-detection]", {
      venue,
      lowerMessage: lowerMessage2.substring(0, 100),
      hasKalshi,
      hasPolymarket,
      hasPredictionMarket,
      hasTop,
      hasTrending,
      hasHighestVolume,
      hasRightNow,
      isAskingTopKalshi,
      isAskingTopPolymarket,
      isAskingHighestVolume,
      isAskingAboutKalshi,
      isAskingAboutPolymarket,
      isPredictionMarketQuery
    });
  }
  if (venue === "hyperliquid") {
    userPrompt += `**Venue Context:** On-chain perps venue. Prefer perps or DeFi actions.

`;
  } else if (venue === "event_demo") {
    userPrompt += `**Venue Context:** Event Markets (Demo). Prefer event market actions.

`;
    const lowerMessage2 = userMessage.toLowerCase();
    const hasKalshi = lowerMessage2.includes("kalshi");
    const hasPolymarket = lowerMessage2.includes("polymarket");
    const hasPredictionMarket = lowerMessage2.includes("prediction market") || lowerMessage2.includes("prediction markets");
    const hasTop = lowerMessage2.includes("top") || lowerMessage2.includes("trending");
    const hasHighestVolume = lowerMessage2.includes("highest") && (lowerMessage2.includes("volume") || lowerMessage2.includes("vol"));
    const isAskingTopKalshi = hasKalshi && (hasTop || hasPredictionMarket || lowerMessage2.includes("right now"));
    const isAskingTopPolymarket = hasPolymarket && (hasTop || hasPredictionMarket || lowerMessage2.includes("right now"));
    const isAskingHighestVolume = hasHighestVolume && (hasKalshi || hasPolymarket || hasPredictionMarket);
    console.log("[prediction] Detection:", {
      lowerMessage: lowerMessage2.substring(0, 150),
      hasKalshi,
      hasPolymarket,
      hasPredictionMarket,
      hasTop,
      isAskingTopKalshi,
      isAskingTopPolymarket,
      isAskingHighestVolume,
      isPredictionMarketQuery,
      venue
    });
    let kalshiMarkets = [];
    let polymarketMarkets = [];
    let highestVolumeMarket = null;
    try {
      if (isAskingTopKalshi || isAskingHighestVolume || isPredictionMarketQuery && hasKalshi) {
        console.log("[prediction] Fetching Kalshi markets for prompt");
        kalshiMarkets = await getTopKalshiMarketsByVolume(5);
        console.log(`[prediction] Fetched ${kalshiMarkets.length} Kalshi markets:`, kalshiMarkets.map((m) => m.title).join(", "));
      }
      if (isAskingTopPolymarket || isAskingHighestVolume || isPredictionMarketQuery && hasPolymarket) {
        console.log("[prediction] Fetching Polymarket markets for prompt");
        polymarketMarkets = await getTopPolymarketMarketsByVolume(5);
        console.log(`[prediction] Fetched ${polymarketMarkets.length} Polymarket markets:`, polymarketMarkets.map((m) => m.title).join(", "));
      }
      if (isAskingHighestVolume) {
        console.log("[prediction] Fetching highest volume market");
        highestVolumeMarket = await getHighestVolumeMarket();
        console.log(`[prediction] Highest volume market:`, highestVolumeMarket ? highestVolumeMarket.title : "none");
      }
    } catch (error) {
      console.warn("[prediction] Failed to fetch market data for prompt:", error.message);
    }
    if (isPredictionMarketQuery) {
      userPrompt += `**PREDICTION MARKET DATA:**

`;
      if (kalshiMarkets.length > 0) {
        userPrompt += `**Top Kalshi Markets (by volume):**
`;
        kalshiMarkets.forEach((market, idx) => {
          const prob = Math.round(market.yesPrice * 100);
          const volume = market.volume24hUsd ? `$${(market.volume24hUsd / 1e3).toFixed(0)}k` : "N/A";
          userPrompt += `${idx + 1}. "${market.title}" - ${prob}% YES probability, ${volume} 24h volume
`;
        });
        userPrompt += `
`;
      } else if (isAskingTopKalshi || isPredictionMarketQuery && hasKalshi) {
        userPrompt += `**Top Kalshi Markets (by volume):**
`;
        userPrompt += `1. "Fed cuts in March 2025" - 62% YES probability, $125k 24h volume
`;
        userPrompt += `2. "BTC ETF approved by Dec 31" - 68% YES probability, $280k 24h volume
`;
        userPrompt += `3. "ETH ETF approved by June 2025" - 58% YES probability, $95k 24h volume

`;
      }
      if (polymarketMarkets.length > 0) {
        userPrompt += `**Top Polymarket Markets (by volume):**
`;
        polymarketMarkets.forEach((market, idx) => {
          const prob = Math.round(market.yesPrice * 100);
          const volume = market.volume24hUsd ? `$${(market.volume24hUsd / 1e3).toFixed(0)}k` : "N/A";
          userPrompt += `${idx + 1}. "${market.title}" - ${prob}% YES probability, ${volume} 24h volume
`;
        });
        userPrompt += `
`;
      } else if (isAskingTopPolymarket || isPredictionMarketQuery && hasPolymarket) {
        userPrompt += `**Top Polymarket Markets (by volume):**
`;
        userPrompt += `1. "US Election Winner 2024" - 50% YES probability, $450k 24h volume
`;
        userPrompt += `2. "Crypto market cap above $3T by year-end" - 52% YES probability, $180k 24h volume
`;
        userPrompt += `3. "ETH above $5k by year-end" - 45% YES probability, $120k 24h volume

`;
      }
      if (highestVolumeMarket) {
        const prob = Math.round(highestVolumeMarket.yesPrice * 100);
        const volume = highestVolumeMarket.volume24hUsd ? `$${(highestVolumeMarket.volume24hUsd / 1e3).toFixed(0)}k` : "N/A";
        userPrompt += `**Highest Volume Market:** "${highestVolumeMarket.title}" (${highestVolumeMarket.source}) - ${prob}% YES probability, ${volume} 24h volume

`;
      }
      userPrompt += `**CRITICAL - PREDICTION MARKET MODE ACTIVATED:**

`;
      userPrompt += `The user is asking about prediction markets (Kalshi/Polymarket). You MUST respond ONLY about prediction markets.

`;
      userPrompt += `**MANDATORY Response Format:**
`;
      userPrompt += `1. Start your response by acknowledging the prediction market query.
`;
      userPrompt += `2. Provide a numbered list (1, 2, 3, etc.) of the markets from the data above.
`;
      userPrompt += `3. For each market, include:
`;
      userPrompt += `   - The exact market title/name
`;
      userPrompt += `   - The YES probability percentage
`;
      userPrompt += `   - The 24h volume (if available)
`;
      userPrompt += `4. Do NOT mention perps, futures, DeFi, or any other trading strategies.
`;
      userPrompt += `5. Do NOT ask the user to rephrase or suggest other trading options.
`;
      userPrompt += `6. If the user asks to "risk X%" on a market, include an event action in the JSON.
`;
      userPrompt += `7. If the user asks to "override the risk cap", "ignore the 3% cap", "allocate the full amount", "increase stake to X", or similar phrases for an existing event position, include an event action with action: "update", positionId (the existing position ID), and overrideRiskCap: true.
`;
      userPrompt += `7. If the user only asks to list markets (discovery), do NOT include any actions in the JSON.

`;
      userPrompt += `**Example Response Format:**
`;
      userPrompt += `"Here are the top 5 prediction markets on Kalshi:

`;
      userPrompt += `1. [Market Name] - [X]% YES probability, $[Y]k 24h volume
`;
      userPrompt += `2. [Market Name] - [X]% YES probability, $[Y]k 24h volume
`;
      userPrompt += `...

`;
      userPrompt += `These markets are ranked by volume and represent the most active prediction markets currently available."

`;
      userPrompt += `**ABSOLUTELY FORBIDDEN:**
`;
      userPrompt += `- Do NOT say "I can help with perps trading strategies..."
`;
      userPrompt += `- Do NOT mention liquidation, stop losses, or perp-specific terms
`;
      userPrompt += `- Do NOT suggest the user try perps or DeFi instead
`;
      userPrompt += `- Do NOT give generic trading advice

`;
    } else {
      userPrompt += `**Discovery Prompts:** When the user asks for "top markets on Kalshi" or "top markets on Polymarket", return a natural-language explanation listing 4-6 markets. Only include event actions in the JSON if the user explicitly asks to "risk X% on the highest-volume market". Otherwise, only describe markets in text.

`;
    }
  }
  userPrompt += `**Remember:** This is a SIMULATED environment. No real orders are placed.`;
  return { systemPrompt, userPrompt, isPredictionMarketQuery };
}
function validateExecutionRequest(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  if (raw.kind === "lend" || raw.kind === "lend_supply") {
    if (raw.chain !== "sepolia") {
      console.warn("Invalid chain for lending:", raw.chain);
      return null;
    }
    if (raw.asset !== "REDACTED") {
      console.warn("Invalid asset for lending:", raw.asset);
      return null;
    }
    if (!raw.amount || typeof raw.amount !== "string") {
      console.warn("Missing or invalid amount for lending");
      return null;
    }
    const amountNum = parseFloat(raw.amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      console.warn("Invalid amount value for lending:", raw.amount);
      return null;
    }
    return {
      kind: raw.kind === "lend_supply" ? "lend_supply" : "lend",
      chain: "sepolia",
      asset: "REDACTED",
      amount: raw.amount,
      protocol: raw.protocol || "demo",
      vault: raw.vault
    };
  }
  if (raw.kind === "swap") {
    if (raw.chain !== "sepolia") {
      console.warn("Invalid chain:", raw.chain);
      return null;
    }
    const validTokenIn = ["ETH", "WETH", "REDACTED"];
    const validTokenOut = ["WETH", "REDACTED"];
    if (!validTokenIn.includes(raw.tokenIn) || !validTokenOut.includes(raw.tokenOut)) {
      console.warn("Invalid tokenIn or tokenOut:", raw.tokenIn, raw.tokenOut);
      return null;
    }
    if (!raw.amountIn || typeof raw.amountIn !== "string") {
      console.warn("Missing or invalid amountIn");
      return null;
    }
    const amountInNum = parseFloat(raw.amountIn);
    if (isNaN(amountInNum) || amountInNum <= 0) {
      console.warn("Invalid amountIn value:", raw.amountIn);
      return null;
    }
    const slippageBps = typeof raw.slippageBps === "number" ? raw.slippageBps : 50;
    if (slippageBps < 0 || slippageBps > 1e3) {
      console.warn("Invalid slippageBps:", slippageBps);
      return null;
    }
    const fundingPolicy = raw.fundingPolicy === "require_tokenIn" ? "require_tokenIn" : "auto";
    return {
      kind: "swap",
      chain: "sepolia",
      tokenIn: raw.tokenIn,
      tokenOut: raw.tokenOut,
      amountIn: raw.amountIn,
      amountOut: raw.amountOut || void 0,
      slippageBps,
      fundingPolicy
    };
  }
  return null;
}
async function buildPredictionMarketResponse(userMessage, venue, accountValueUsd) {
  const lowerMessage = userMessage.toLowerCase();
  const hasKalshi = lowerMessage.includes("kalshi");
  const hasPolymarket = lowerMessage.includes("polymarket");
  const hasHighestVolume = lowerMessage.includes("highest") && (lowerMessage.includes("volume") || lowerMessage.includes("vol"));
  let markets = [];
  let platformName = "";
  if (hasKalshi || hasHighestVolume && !hasPolymarket) {
    console.log("[prediction-stub] Fetching Kalshi markets for stub response");
    markets = await getTopKalshiMarketsByVolume(5);
    platformName = "Kalshi";
  } else if (hasPolymarket || hasHighestVolume) {
    console.log("[prediction-stub] Fetching Polymarket markets for stub response");
    markets = await getTopPolymarketMarketsByVolume(5);
    platformName = "Polymarket";
  } else {
    markets = await getTopKalshiMarketsByVolume(5);
    platformName = "Kalshi";
  }
  let responseText = `Here are the top ${markets.length} ${platformName} prediction markets by 24h volume (stub data):

`;
  markets.forEach((market, idx) => {
    const yesProb = Math.round(market.yesPrice * 100);
    const noProb = Math.round(market.noPrice * 100);
    const volume = market.volume24hUsd ? `$${(market.volume24hUsd / 1e3).toFixed(0)}k` : market.openInterestUsd ? `$${(market.openInterestUsd / 1e3).toFixed(0)}k OI` : "Volume N/A";
    responseText += `${idx + 1}) ${market.title} \u2014 Yes: ${yesProb}%, No: ${noProb}%, 24h Volume: ${volume}

`;
  });
  responseText += `These markets are ranked by volume and represent the most active prediction markets currently available on ${platformName}.`;
  const wantsToRisk = lowerMessage.includes("risk") && (lowerMessage.includes("%") || lowerMessage.match(/\d+%/));
  const wantsHighestVolume = lowerMessage.includes("highest") && (lowerMessage.includes("volume") || lowerMessage.includes("vol"));
  let actions = [];
  if (wantsToRisk && (markets.length > 0 || wantsHighestVolume)) {
    const riskMatch = userMessage.match(/(\d+(?:\.\d+)?)%/);
    const riskPct = riskMatch ? parseFloat(riskMatch[1]) : 2;
    let targetMarket;
    if (wantsHighestVolume) {
      try {
        const highestVolumeMarket = await getHighestVolumeMarket();
        if (highestVolumeMarket) {
          targetMarket = highestVolumeMarket;
        } else {
          targetMarket = markets[0];
        }
      } catch (error) {
        console.warn("[prediction-stub] Failed to get highest volume market, using first market:", error);
        targetMarket = markets[0];
      }
    } else {
      targetMarket = markets[0];
    }
    if (!targetMarket) {
      console.warn("[prediction-stub] No market available for risk sizing");
    } else {
      const side = targetMarket.yesPrice >= 0.5 ? "YES" : "NO";
      const defaultAccountValue = 1e4;
      const accountValue = accountValueUsd || defaultAccountValue;
      const stakeUsd = Math.round(accountValue * riskPct / 100);
      const maxEventRiskPct = 0.03;
      const maxStakeUsd = Math.round(accountValue * maxEventRiskPct);
      const finalStakeUsd = Math.min(stakeUsd, maxStakeUsd);
      const maxPayoutUsd = side === "YES" ? finalStakeUsd / targetMarket.yesPrice : finalStakeUsd / targetMarket.noPrice;
      actions.push({
        type: "event",
        action: "open",
        eventKey: targetMarket.id,
        label: targetMarket.title,
        side,
        stakeUsd: finalStakeUsd,
        maxPayoutUsd,
        maxLossUsd: finalStakeUsd,
        reasoning: [
          wantsHighestVolume ? `Using highest volume market from ${platformName}` : `Using top market from ${platformName}`,
          `Risk is ${riskPct}% of account (${finalStakeUsd < stakeUsd ? "capped at 3%" : "uncapped"})`,
          `Market probability is ${Math.round(targetMarket.yesPrice * 100)}% YES`
        ]
      });
      if (finalStakeUsd < stakeUsd) {
        responseText += `

I'll stake ${riskPct}% of your account ($${stakeUsd.toLocaleString()}) on "${targetMarket.title}", side ${side}. However, I've capped this at $${finalStakeUsd.toLocaleString()} to keep risk at 3% of your $${accountValue.toLocaleString()} account. Your max loss is capped at the amount staked.`;
      } else {
        responseText = `I'll stake ${riskPct}% of your account ($${finalStakeUsd.toLocaleString()}) on "${targetMarket.title}", side ${side}. Your max loss is capped at the amount staked.`;
      }
    }
  }
  return {
    assistantMessage: responseText,
    actions
  };
}
var init_actionParser = __esm({
  "agent/src/utils/actionParser.ts"() {
    "use strict";
    init_predictionData();
  }
});

// agent/src/services/prices.ts
var prices_exports = {};
__export(prices_exports, {
  clearPriceCache: () => clearPriceCache,
  getPrice: () => getPrice
});
async function getPrice(symbol) {
  const cached = priceCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS3) {
    return cached;
  }
  try {
    const price = await fetchFromCoinGecko(symbol);
    const snapshot2 = {
      symbol,
      priceUsd: price,
      source: "coingecko",
      fetchedAt: Date.now()
    };
    priceCache.set(symbol, snapshot2);
    return snapshot2;
  } catch (error) {
    console.warn(`Failed to fetch ${symbol} price from CoinGecko, using static fallback:`, error);
  }
  const snapshot = {
    symbol,
    priceUsd: STATIC_PRICES[symbol],
    source: "static",
    fetchedAt: Date.now()
  };
  priceCache.set(symbol, snapshot);
  return snapshot;
}
async function fetchFromCoinGecko(symbol) {
  const coinGeckoIds = {
    ETH: "ethereum",
    BTC: "bitcoin",
    SOL: "solana",
    REDACTED: "usd-coin",
    AVAX: "avalanche-2",
    LINK: "chainlink"
  };
  const coinId = coinGeckoIds[symbol];
  if (!coinId) {
    throw new Error(`Unsupported symbol: ${symbol}`);
  }
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`;
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json"
    }
  });
  if (!response.ok) {
    throw new Error(`CoinGecko API error: ${response.status}`);
  }
  const data = await response.json();
  const price = data[coinId]?.usd;
  if (typeof price !== "number" || price <= 0) {
    throw new Error(`Invalid price data from CoinGecko: ${price}`);
  }
  return price;
}
function clearPriceCache() {
  priceCache.clear();
}
var priceCache, STATIC_PRICES, CACHE_TTL_MS3;
var init_prices = __esm({
  "agent/src/services/prices.ts"() {
    "use strict";
    priceCache = /* @__PURE__ */ new Map();
    STATIC_PRICES = {
      ETH: 3e3,
      BTC: 6e4,
      SOL: 150,
      REDACTED: 1,
      AVAX: 35,
      LINK: 14
    };
    CACHE_TTL_MS3 = 12 * 1e3;
  }
});

// agent/src/quotes/oneInchQuote.ts
async function getOneInchQuote(request) {
  const { chainId, tokenIn, tokenOut, amountIn } = request;
  const apiUrl = `${ONEINCH_BASE_URL}/swap/v5.2/${chainId}/quote`;
  const params = new URLSearchParams({
    src: tokenIn,
    dst: tokenOut,
    amount: amountIn
  });
  const headers = {
    "Accept": "application/json"
  };
  if (ONEINCH_API_KEY) {
    headers["Authorization"] = `Bearer ${ONEINCH_API_KEY}`;
  }
  try {
    console.log("[1inch] Fetching quote:", { chainId, tokenIn, tokenOut, amountIn });
    const response = await fetch(`${apiUrl}?${params.toString()}`, {
      method: "GET",
      headers
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.warn("[1inch] Quote API error:", response.status, errorText);
      return void 0;
    }
    const data = await response.json();
    const protocols = extractProtocols(data.protocols);
    const routeSummary = buildRouteSummary(data);
    const result = {
      toTokenAmount: data.toAmount || data.toTokenAmount,
      estimatedGas: data.gas?.toString() || data.estimatedGas?.toString() || "0",
      protocols,
      routeSummary,
      aggregator: "1inch",
      fromToken: {
        symbol: data.fromToken?.symbol || "UNKNOWN",
        decimals: data.fromToken?.decimals || 18
      },
      toToken: {
        symbol: data.toToken?.symbol || "UNKNOWN",
        decimals: data.toToken?.decimals || 18
      }
    };
    console.log("[1inch] Quote received:", {
      toTokenAmount: result.toTokenAmount,
      protocols: result.protocols,
      routeSummary: result.routeSummary
    });
    return result;
  } catch (error) {
    console.warn("[1inch] Quote fetch failed:", error.message);
    return void 0;
  }
}
function extractProtocols(protocols) {
  if (!protocols || !Array.isArray(protocols)) {
    return ["Unknown"];
  }
  const protocolNames = /* @__PURE__ */ new Set();
  const extractFromArray = (arr) => {
    for (const item of arr) {
      if (Array.isArray(item)) {
        extractFromArray(item);
      } else if (typeof item === "object" && item.name) {
        protocolNames.add(item.name);
      } else if (typeof item === "string") {
        protocolNames.add(item);
      }
    }
  };
  extractFromArray(protocols);
  return Array.from(protocolNames);
}
function buildRouteSummary(data) {
  const fromSymbol = data.fromToken?.symbol || "Token";
  const toSymbol = data.toToken?.symbol || "Token";
  const protocols = extractProtocols(data.protocols);
  if (protocols.length === 0 || protocols[0] === "Unknown") {
    return `${fromSymbol} \u2192 ${toSymbol}`;
  }
  if (protocols.length === 1) {
    return `${fromSymbol} \u2192 ${toSymbol} via ${protocols[0]}`;
  }
  return `${fromSymbol} \u2192 ${toSymbol} via ${protocols.slice(0, 3).join(" + ")}${protocols.length > 3 ? " +more" : ""}`;
}
function isOneInchAvailable() {
  return true;
}
var init_oneInchQuote = __esm({
  "agent/src/quotes/oneInchQuote.ts"() {
    "use strict";
    init_config();
  }
});

// agent/src/quotes/uniswapQuoter.ts
async function getUniswapV3Quote(params) {
  const { tokenIn, tokenOut, amountIn, fee = 3e3 } = params;
  if (!ETH_TESTNET_RPC_URL) {
    console.warn("[getUniswapV3Quote] ETH_TESTNET_RPC_URL not configured");
    return null;
  }
  try {
    const { encodeFunctionData, decodeFunctionResult } = await import("viem");
    const quoterAbi = [
      {
        name: "quoteExactInputSingle",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "amountIn", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" }
        ],
        outputs: [
          { name: "amountOut", type: "uint256" },
          { name: "sqrtPriceX96After", type: "uint160" },
          { name: "initializedTicksCrossed", type: "uint32" },
          { name: "gasEstimate", type: "uint256" }
        ]
      }
    ];
    const callData = encodeFunctionData({
      abi: quoterAbi,
      functionName: "quoteExactInputSingle",
      args: [
        tokenIn,
        tokenOut,
        fee,
        BigInt(amountIn),
        0n
        // sqrtPriceLimitX96 = 0 (no price limit)
      ]
    });
    const response = await fetch(ETH_TESTNET_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [
          {
            to: UNISWAP_V3_QUOTER_V2_ADDRESS,
            data: callData
          },
          "latest"
        ]
      })
    });
    const data = await response.json();
    if (data.error) {
      console.warn("[getUniswapV3Quote] RPC error:", data.error);
      return null;
    }
    if (!data.result || data.result === "0x") {
      console.warn("[getUniswapV3Quote] No result from quoter");
      return null;
    }
    const decoded = decodeFunctionResult({
      abi: quoterAbi,
      functionName: "quoteExactInputSingle",
      data: data.result
    });
    return {
      amountOut: decoded[0].toString(),
      sqrtPriceX96After: decoded[1].toString(),
      initializedTicksCrossed: decoded[2].toString(),
      gasEstimate: decoded[3].toString()
    };
  } catch (error) {
    console.warn("[getUniswapV3Quote] Error:", error.message);
    return null;
  }
}
function isUniswapQuoterAvailable() {
  return !!ETH_TESTNET_RPC_URL && !!UNISWAP_V3_ROUTER_ADDRESS;
}
var UNISWAP_V3_QUOTER_V2_ADDRESS;
var init_uniswapQuoter = __esm({
  "agent/src/quotes/uniswapQuoter.ts"() {
    "use strict";
    init_config();
    UNISWAP_V3_QUOTER_V2_ADDRESS = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a";
  }
});

// agent/src/quotes/evmQuote.ts
import { formatUnits } from "viem";
async function getDemoSwapQuote(params) {
  const { tokenIn, tokenOut, amountIn, slippageBps = DEFAULT_SWAP_SLIPPAGE_BPS } = params;
  const RATE_NUMERATOR = 95n;
  const RATE_DENOMINATOR = 100n;
  const amountInBigInt = BigInt(amountIn);
  let expectedOut;
  if (tokenIn.toLowerCase() === DEMO_REDACTED_ADDRESS?.toLowerCase() && tokenOut.toLowerCase() === DEMO_WETH_ADDRESS?.toLowerCase()) {
    expectedOut = amountInBigInt * RATE_NUMERATOR / RATE_DENOMINATOR * 10n ** 12n;
  } else if (tokenIn.toLowerCase() === DEMO_WETH_ADDRESS?.toLowerCase() && tokenOut.toLowerCase() === DEMO_REDACTED_ADDRESS?.toLowerCase()) {
    expectedOut = amountInBigInt * RATE_NUMERATOR / RATE_DENOMINATOR / 10n ** 12n;
  } else {
    expectedOut = amountInBigInt * RATE_NUMERATOR / RATE_DENOMINATOR;
  }
  const slippageMultiplier = BigInt(1e4 - slippageBps);
  const minOut = expectedOut * slippageMultiplier / 10000n;
  return {
    expectedOut: expectedOut.toString(),
    minOut: minOut.toString(),
    estSlippageBps: slippageBps,
    feeTier: 3e3,
    // 0.3% (standard Uniswap V3 fee tier, kept for compatibility)
    venueLabel: "Blossom Demo Router (Uniswap V3 compatible)",
    chainLabel: "Sepolia",
    settlementEstimate: "~1 block"
  };
}
async function getSwapQuote2(params) {
  const isDemoSwap = (params.tokenIn.toLowerCase() === DEMO_REDACTED_ADDRESS?.toLowerCase() || params.tokenIn.toLowerCase() === DEMO_WETH_ADDRESS?.toLowerCase()) && (params.tokenOut.toLowerCase() === DEMO_REDACTED_ADDRESS?.toLowerCase() || params.tokenOut.toLowerCase() === DEMO_WETH_ADDRESS?.toLowerCase());
  if (isDemoSwap && DEMO_SWAP_ROUTER_ADDRESS) {
    return getDemoSwapQuote(params);
  }
  return null;
}
async function getSwapRoutingDecision(params) {
  const {
    tokenIn,
    tokenOut,
    tokenInSymbol,
    tokenOutSymbol,
    tokenInDecimals,
    tokenOutDecimals,
    amountIn,
    slippageBps = DEFAULT_SWAP_SLIPPAGE_BPS
  } = params;
  const warnings = [];
  let oneInchResult;
  let dflowResult;
  let uniswapResult;
  let routingMetadata;
  const { makeCorrelationId: makeCorrelationId2 } = await Promise.resolve().then(() => (init_correlationId(), correlationId_exports));
  const routingCorrelationId = makeCorrelationId2("swap");
  const routedQuote = await getSwapQuoteRouted({
    tokenIn,
    tokenOut,
    amountIn,
    slippageBps,
    chainId: ETH_TESTNET_CHAIN_ID,
    correlationId: routingCorrelationId,
    fallbackQuote: async () => {
      if (isUniswapQuoterAvailable()) {
        try {
          const uniswapQuote = await getUniswapV3Quote({
            tokenIn,
            tokenOut,
            amountIn,
            fee: 3e3
            // 0.3% fee tier
          });
          if (uniswapQuote) {
            uniswapResult = {
              amountOut: uniswapQuote.amountOut,
              gasEstimate: uniswapQuote.gasEstimate
            };
            const slippageMultiplier = BigInt(1e4 - (slippageBps || DEFAULT_SWAP_SLIPPAGE_BPS));
            const minOutRaw = (BigInt(uniswapQuote.amountOut) * slippageMultiplier / 10000n).toString();
            return {
              amountOut: uniswapQuote.amountOut,
              minAmountOut: minOutRaw,
              routeSummary: `${tokenInSymbol} \u2192 ${tokenOutSymbol} via Uniswap V3`,
              gas: uniswapQuote.gasEstimate
            };
          }
        } catch (error) {
          console.warn("[getSwapRoutingDecision] Uniswap quote failed:", error.message);
        }
      }
      if (ROUTING_MODE === "hybrid" && isOneInchAvailable()) {
        try {
          oneInchResult = await getOneInchQuote({
            chainId: ETH_TESTNET_CHAIN_ID,
            tokenIn,
            tokenOut,
            amountIn,
            slippageBps
          });
          if (oneInchResult) {
            const slippageMultiplier = BigInt(1e4 - slippageBps);
            const minOutRaw = (BigInt(oneInchResult.toTokenAmount) * slippageMultiplier / 10000n).toString();
            return {
              amountOut: oneInchResult.toTokenAmount,
              minAmountOut: minOutRaw,
              routeSummary: oneInchResult.routeSummary || `${tokenInSymbol} \u2192 ${tokenOutSymbol} via 1inch`,
              gas: oneInchResult.estimatedGas
            };
          }
        } catch (error) {
          console.warn("[getSwapRoutingDecision] 1inch quote failed:", error.message);
          warnings.push(`1inch quote unavailable: ${error.message}`);
        }
      }
      return null;
    }
  });
  routingMetadata = routedQuote.routing || {
    source: "fallback",
    kind: "swap_quote",
    ok: false,
    reason: "Routing service returned no metadata",
    latencyMs: 0,
    mode: "hybrid",
    correlationId: routingCorrelationId
  };
  if (routedQuote.ok && routedQuote.data && routedQuote.routing.source === "dflow") {
    dflowResult = {
      amountOut: routedQuote.data.amountOut,
      minAmountOut: routedQuote.data.minAmountOut,
      routeSummary: routedQuote.data.routeSummary,
      gas: routedQuote.data.gas
    };
  }
  if (!routedQuote.ok || routedQuote.routing.source !== "fallback") {
  } else if (routedQuote.ok && routedQuote.data) {
    const expectedOutRaw = routedQuote.data.amountOut;
    const expectedOut2 = formatUnits(BigInt(expectedOutRaw), tokenOutDecimals);
    const minOutRaw = routedQuote.data.minAmountOut;
    const minOut2 = formatUnits(BigInt(minOutRaw), tokenOutDecimals);
    return {
      expectedOut: expectedOut2,
      expectedOutRaw,
      minOut: minOut2,
      minOutRaw,
      slippageBps: routedQuote.data.slippageBps,
      routingSource: "deterministic",
      routeSummary: routedQuote.data.routeSummary || `${tokenInSymbol} \u2192 ${tokenOutSymbol}`,
      protocols: [],
      estimatedGas: routedQuote.data.gas,
      executionVenue: "Blossom Demo Router",
      executionNote: "Routing via fallback provider",
      chain: "Sepolia",
      chainId: ETH_TESTNET_CHAIN_ID,
      settlementEstimate: "~1 block",
      warnings: routedQuote.routing.reason ? [routedQuote.routing.reason] : void 0,
      routing: routingMetadata
    };
  }
  if (dflowResult) {
    const expectedOutRaw = dflowResult.amountOut;
    const expectedOut2 = formatUnits(BigInt(expectedOutRaw), tokenOutDecimals);
    const minOutRaw = dflowResult.minAmountOut;
    const minOut2 = formatUnits(BigInt(minOutRaw), tokenOutDecimals);
    return {
      expectedOut: expectedOut2,
      expectedOutRaw,
      minOut: minOut2,
      minOutRaw,
      slippageBps,
      routingSource: "dflow",
      routeSummary: dflowResult.routeSummary || `${tokenInSymbol} \u2192 ${tokenOutSymbol} via dFlow`,
      protocols: ["dFlow"],
      estimatedGas: dflowResult.gas,
      executionVenue: "Blossom Demo Router",
      executionNote: "Routing powered by dFlow; executed via deterministic demo venue.",
      chain: "Sepolia",
      chainId: ETH_TESTNET_CHAIN_ID,
      settlementEstimate: "~1 block",
      warnings: warnings.length > 0 ? warnings : void 0,
      routing: routingMetadata
      // Sprint 3: Include routing metadata
    };
  }
  if (oneInchResult && uniswapResult) {
    const oneInchOut = BigInt(oneInchResult.toTokenAmount);
    const uniswapOut = BigInt(uniswapResult.amountOut);
    if (uniswapOut > oneInchOut) {
      const expectedOut2 = formatUnits(uniswapOut, tokenOutDecimals);
      const slippageMultiplier = BigInt(1e4 - slippageBps);
      const minOutRaw = (uniswapOut * slippageMultiplier / 10000n).toString();
      const minOut2 = formatUnits(BigInt(minOutRaw), tokenOutDecimals);
      return {
        expectedOut: expectedOut2,
        expectedOutRaw: uniswapResult.amountOut,
        minOut: minOut2,
        minOutRaw,
        slippageBps,
        routingSource: "uniswap",
        routeSummary: `${tokenInSymbol} \u2192 ${tokenOutSymbol} via Uniswap V3 (best route)`,
        protocols: ["Uniswap V3"],
        estimatedGas: uniswapResult.gasEstimate,
        executionVenue: "Uniswap V3",
        executionNote: `Best route: Uniswap V3 (${expectedOut2} ${tokenOutSymbol} vs 1inch ${formatUnits(oneInchOut, tokenOutDecimals)} ${tokenOutSymbol})`,
        chain: "Sepolia",
        chainId: ETH_TESTNET_CHAIN_ID,
        settlementEstimate: "~1 block",
        warnings: warnings.length > 0 ? warnings : void 0,
        routing: routingMetadata
        // Sprint 3: Include routing metadata
      };
    } else {
      const expectedOutRaw = oneInchResult.toTokenAmount;
      const expectedOut2 = formatUnits(BigInt(expectedOutRaw), tokenOutDecimals);
      const slippageMultiplier = BigInt(1e4 - slippageBps);
      const minOutRaw = (BigInt(expectedOutRaw) * slippageMultiplier / 10000n).toString();
      const minOut2 = formatUnits(BigInt(minOutRaw), tokenOutDecimals);
      return {
        expectedOut: expectedOut2,
        expectedOutRaw,
        minOut: minOut2,
        minOutRaw,
        slippageBps,
        routingSource: "1inch",
        routeSummary: oneInchResult.routeSummary,
        protocols: oneInchResult.protocols,
        estimatedGas: oneInchResult.estimatedGas,
        executionVenue: "Uniswap V3",
        // Still execute via Uniswap V3 adapter
        executionNote: `Best route: 1inch (${expectedOut2} ${tokenOutSymbol} vs Uniswap ${formatUnits(uniswapOut, tokenOutDecimals)} ${tokenOutSymbol})`,
        chain: "Sepolia",
        chainId: ETH_TESTNET_CHAIN_ID,
        settlementEstimate: "~1 block",
        warnings: warnings.length > 0 ? warnings : void 0,
        routing: routingMetadata
        // Sprint 3: Include routing metadata
      };
    }
  }
  if (oneInchResult) {
    const expectedOutRaw = oneInchResult.toTokenAmount;
    const expectedOut2 = formatUnits(BigInt(expectedOutRaw), tokenOutDecimals);
    const slippageMultiplier = BigInt(1e4 - slippageBps);
    const minOutRaw = (BigInt(expectedOutRaw) * slippageMultiplier / 10000n).toString();
    const minOut2 = formatUnits(BigInt(minOutRaw), tokenOutDecimals);
    return {
      expectedOut: expectedOut2,
      expectedOutRaw,
      minOut: minOut2,
      minOutRaw,
      slippageBps,
      routingSource: "1inch",
      routeSummary: oneInchResult.routeSummary,
      protocols: oneInchResult.protocols,
      estimatedGas: oneInchResult.estimatedGas,
      executionVenue: "Uniswap V3",
      // Execute via Uniswap V3 adapter
      executionNote: "Routing computed from 1inch aggregator; executed via Uniswap V3.",
      chain: "Sepolia",
      chainId: ETH_TESTNET_CHAIN_ID,
      settlementEstimate: "~1 block",
      warnings: warnings.length > 0 ? warnings : void 0,
      routing: routingMetadata
      // Sprint 3: Include routing metadata
    };
  }
  if (uniswapResult) {
    const expectedOut2 = formatUnits(BigInt(uniswapResult.amountOut), tokenOutDecimals);
    const slippageMultiplier = BigInt(1e4 - slippageBps);
    const minOutRaw = (BigInt(uniswapResult.amountOut) * slippageMultiplier / 10000n).toString();
    const minOut2 = formatUnits(BigInt(minOutRaw), tokenOutDecimals);
    return {
      expectedOut: expectedOut2,
      expectedOutRaw: uniswapResult.amountOut,
      minOut: minOut2,
      minOutRaw,
      slippageBps,
      routingSource: "uniswap",
      routeSummary: `${tokenInSymbol} \u2192 ${tokenOutSymbol} via Uniswap V3`,
      protocols: ["Uniswap V3"],
      estimatedGas: uniswapResult.gasEstimate,
      executionVenue: "Uniswap V3",
      executionNote: "Routing and execution via Uniswap V3.",
      chain: "Sepolia",
      chainId: ETH_TESTNET_CHAIN_ID,
      settlementEstimate: "~1 block",
      warnings: warnings.length > 0 ? warnings : void 0,
      routing: routingMetadata
      // Sprint 3: Include routing metadata
    };
  }
  if (ROUTING_REQUIRE_LIVE_QUOTE) {
    throw new Error("Live routing quote required but unavailable. Set ROUTING_REQUIRE_LIVE_QUOTE=false to allow fallback.");
  }
  warnings.push("Using deterministic quote (1inch unavailable for Sepolia testnet)");
  const demoQuote = await getDemoSwapQuote({
    tokenIn,
    tokenOut,
    amountIn,
    slippageBps
  });
  const expectedOut = formatUnits(BigInt(demoQuote.expectedOut), tokenOutDecimals);
  const minOut = formatUnits(BigInt(demoQuote.minOut), tokenOutDecimals);
  return {
    expectedOut,
    expectedOutRaw: demoQuote.expectedOut,
    minOut,
    minOutRaw: demoQuote.minOut,
    slippageBps,
    routingSource: "deterministic",
    routeSummary: `${tokenInSymbol} \u2192 ${tokenOutSymbol} via Demo Router`,
    protocols: ["Blossom Demo Router"],
    executionVenue: "Blossom Demo Router",
    executionNote: "Deterministic routing and execution via demo venue.",
    chain: "Sepolia",
    chainId: ETH_TESTNET_CHAIN_ID,
    settlementEstimate: demoQuote.settlementEstimate,
    warnings: warnings.length > 0 ? warnings : void 0,
    routing: routingMetadata
    // Sprint 3: Include routing metadata
  };
}
var init_evmQuote = __esm({
  "agent/src/quotes/evmQuote.ts"() {
    "use strict";
    init_config();
    init_oneInchQuote();
    init_uniswapQuoter();
    init_routingService();
  }
});

// agent/src/executors/evmReceipt.ts
var evmReceipt_exports = {};
__export(evmReceipt_exports, {
  isTransactionPending: () => isTransactionPending,
  waitForReceipt: () => waitForReceipt
});
async function waitForReceipt(rpcUrl, txHash, options = {}) {
  const { timeoutMs = 6e4, pollMs = 2e3 } = options;
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const receipt = await getTransactionReceipt(rpcUrl, txHash);
      if (receipt) {
        const statusHex = receipt.status;
        const blockNumber = receipt.blockNumber ? parseInt(receipt.blockNumber, 16) : void 0;
        const gasUsed = receipt.gasUsed;
        if (statusHex === "0x1") {
          return {
            status: "confirmed",
            blockNumber,
            gasUsed
          };
        } else {
          return {
            status: "failed",
            blockNumber,
            gasUsed,
            error: "Transaction reverted on-chain"
          };
        }
      }
      await sleep(pollMs);
    } catch (error) {
      console.warn("[waitForReceipt] Poll error:", error.message);
      await sleep(pollMs);
    }
  }
  return {
    status: "timeout",
    error: `Transaction not confirmed within ${timeoutMs / 1e3}s`
  };
}
async function getTransactionReceipt(rpcUrl, txHash) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getTransactionReceipt",
      params: [txHash]
    })
  });
  if (!response.ok) {
    throw new Error(`RPC request failed: ${response.status}`);
  }
  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message || "RPC error");
  }
  return data.result;
}
function sleep(ms) {
  return new Promise((resolve3) => setTimeout(resolve3, ms));
}
async function isTransactionPending(rpcUrl, txHash) {
  try {
    const receipt = await getTransactionReceipt(rpcUrl, txHash);
    return receipt === null;
  } catch {
    return true;
  }
}
var init_evmReceipt = __esm({
  "agent/src/executors/evmReceipt.ts"() {
    "use strict";
  }
});

// agent/telemetry/db.ts
var db_exports = {};
__export(db_exports, {
  closeDatabase: () => closeDatabase,
  createExecution: () => createExecution,
  ensureRunsTable: () => ensureRunsTable,
  getDatabase: () => getDatabase,
  getDevnetStats: () => getDevnetStats,
  getExecution: () => getExecution,
  getLatestSession: () => getLatestSession,
  getRecentTxHashes: () => getRecentTxHashes,
  getRequestLogStats: () => getRequestLogStats,
  getRun: () => getRun,
  getTelemetrySummary: () => getTelemetrySummary,
  getTrafficStats: () => getTrafficStats,
  getUser: () => getUser,
  getUsersWithSessionStatus: () => getUsersWithSessionStatus,
  initDatabase: () => initDatabase,
  listExecutions: () => listExecutions,
  listRuns: () => listRuns,
  listUsers: () => listUsers,
  logRequest: () => logRequest,
  migrateAddFeeColumns: () => migrateAddFeeColumns,
  updateExecution: () => updateExecution,
  updateExecutionByCorrelationId: () => updateExecutionByCorrelationId,
  updateExecutionWithFee: () => updateExecutionWithFee,
  upsertRun: () => upsertRun,
  upsertSession: () => upsertSession,
  upsertUser: () => upsertUser
});
import Database from "better-sqlite3";
import { randomUUID as randomUUID2 } from "crypto";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath as fileURLToPath3 } from "url";
import { dirname as dirname4 } from "path";
function initDatabase() {
  if (db) return db;
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}
function getDatabase() {
  if (!db) {
    return initDatabase();
  }
  return db;
}
function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}
function runMigrations(database) {
  const schemaPath = path.join(__dirname3, "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf-8");
  database.exec(schema);
}
function upsertUser(address, notes) {
  const db3 = getDatabase();
  const id = randomUUID2();
  const notesJson = notes ? JSON.stringify(notes) : null;
  const stmt = db3.prepare(`
    INSERT INTO users (id, address, notes)
    VALUES (?, ?, ?)
    ON CONFLICT(address) DO UPDATE SET
      notes = COALESCE(excluded.notes, users.notes)
    RETURNING *
  `);
  return stmt.get(id, address.toLowerCase(), notesJson);
}
function getUser(address) {
  const db3 = getDatabase();
  const stmt = db3.prepare("SELECT * FROM users WHERE address = ?");
  return stmt.get(address.toLowerCase());
}
function listUsers(limit = 100, offset = 0) {
  const db3 = getDatabase();
  const stmt = db3.prepare("SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?");
  return stmt.all(limit, offset);
}
function upsertSession(userAddress, sessionId, status, expiresAt) {
  const db3 = getDatabase();
  const id = randomUUID2();
  const now = Math.floor(Date.now() / 1e3);
  upsertUser(userAddress);
  const existing = db3.prepare(
    "SELECT * FROM sessions WHERE user_address = ? AND session_id = ?"
  ).get(userAddress.toLowerCase(), sessionId);
  if (existing) {
    db3.prepare(`
      UPDATE sessions SET status = ?, expires_at = ?, updated_at = ?
      WHERE user_address = ? AND session_id = ?
    `).run(status, expiresAt ?? null, now, userAddress.toLowerCase(), sessionId);
    return { ...existing, status, expires_at: expiresAt, updated_at: now };
  }
  db3.prepare(`
    INSERT INTO sessions (id, user_address, session_id, status, expires_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, userAddress.toLowerCase(), sessionId, status, expiresAt ?? null, now);
  return {
    id,
    user_address: userAddress.toLowerCase(),
    session_id: sessionId,
    status,
    expires_at: expiresAt,
    created_at: now,
    updated_at: now
  };
}
function getLatestSession(userAddress) {
  const db3 = getDatabase();
  const stmt = db3.prepare(`
    SELECT * FROM sessions
    WHERE user_address = ?
    ORDER BY created_at DESC
    LIMIT 1
  `);
  return stmt.get(userAddress.toLowerCase());
}
function createExecution(params) {
  const db3 = getDatabase();
  const id = randomUUID2();
  const now = Math.floor(Date.now() / 1e3);
  upsertUser(params.userAddress);
  db3.prepare(`
    INSERT INTO executions (id, user_address, draft_id, correlation_id, action, token, amount_units, mode, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?)
  `).run(
    id,
    params.userAddress.toLowerCase(),
    params.draftId ?? null,
    params.correlationId ?? null,
    params.action,
    params.token ?? null,
    params.amountUnits ?? null,
    params.mode ?? "real",
    now,
    now
  );
  return {
    id,
    user_address: params.userAddress.toLowerCase(),
    draft_id: params.draftId,
    correlation_id: params.correlationId,
    action: params.action,
    token: params.token,
    amount_units: params.amountUnits,
    mode: params.mode ?? "real",
    status: "prepared",
    created_at: now,
    updated_at: now
  };
}
function updateExecution(id, updates) {
  const db3 = getDatabase();
  const now = Math.floor(Date.now() / 1e3);
  const sets = ["updated_at = ?"];
  const values = [now];
  if (updates.status !== void 0) {
    sets.push("status = ?");
    values.push(updates.status);
  }
  if (updates.txHash !== void 0) {
    sets.push("tx_hash = ?");
    values.push(updates.txHash);
  }
  if (updates.errorCode !== void 0) {
    sets.push("error_code = ?");
    values.push(updates.errorCode);
  }
  if (updates.errorMessage !== void 0) {
    sets.push("error_message = ?");
    values.push(updates.errorMessage);
  }
  if (updates.latencyMs !== void 0) {
    sets.push("latency_ms = ?");
    values.push(updates.latencyMs);
  }
  values.push(id);
  db3.prepare(`UPDATE executions SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}
function updateExecutionByCorrelationId(correlationId, updates) {
  const db3 = getDatabase();
  const now = Math.floor(Date.now() / 1e3);
  const sets = ["updated_at = ?"];
  const values = [now];
  if (updates.status !== void 0) {
    sets.push("status = ?");
    values.push(updates.status);
  }
  if (updates.txHash !== void 0) {
    sets.push("tx_hash = ?");
    values.push(updates.txHash);
  }
  if (updates.errorCode !== void 0) {
    sets.push("error_code = ?");
    values.push(updates.errorCode);
  }
  if (updates.errorMessage !== void 0) {
    sets.push("error_message = ?");
    values.push(updates.errorMessage);
  }
  if (updates.latencyMs !== void 0) {
    sets.push("latency_ms = ?");
    values.push(updates.latencyMs);
  }
  values.push(correlationId);
  db3.prepare(`UPDATE executions SET ${sets.join(", ")} WHERE correlation_id = ?`).run(...values);
}
function getExecution(id) {
  const db3 = getDatabase();
  return db3.prepare("SELECT * FROM executions WHERE id = ?").get(id);
}
function listExecutions(limit = 50, offset = 0) {
  const db3 = getDatabase();
  return db3.prepare(`
    SELECT * FROM executions
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}
function logRequest(params) {
  const db3 = getDatabase();
  db3.prepare(`
    INSERT INTO request_log (endpoint, method, user_address, correlation_id, status_code, latency_ms, error_code)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.endpoint,
    params.method ?? "GET",
    params.userAddress?.toLowerCase() ?? null,
    params.correlationId ?? null,
    params.statusCode ?? null,
    params.latencyMs ?? null,
    params.errorCode ?? null
  );
}
function getTelemetrySummary() {
  const db3 = getDatabase();
  const totalUsers = db3.prepare("SELECT COUNT(*) as count FROM users").get().count;
  const totalSessions = db3.prepare("SELECT COUNT(*) as count FROM sessions").get().count;
  const activeSessions = db3.prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'active'").get().count;
  const totalExecutions = db3.prepare("SELECT COUNT(*) as count FROM executions").get().count;
  const successfulExecutions = db3.prepare("SELECT COUNT(*) as count FROM executions WHERE status = 'confirmed'").get().count;
  const failedExecutions = db3.prepare("SELECT COUNT(*) as count FROM executions WHERE status = 'failed'").get().count;
  const avgLatency = db3.prepare("SELECT AVG(latency_ms) as avg FROM executions WHERE latency_ms IS NOT NULL").get();
  const topErrors = db3.prepare(`
    SELECT error_code, COUNT(*) as count
    FROM executions
    WHERE error_code IS NOT NULL
    GROUP BY error_code
    ORDER BY count DESC
    LIMIT 10
  `).all();
  const recentExecutions = listExecutions(20);
  return {
    totalUsers,
    totalSessions,
    activeSessions,
    totalExecutions,
    successfulExecutions,
    failedExecutions,
    successRate: totalExecutions > 0 ? successfulExecutions / totalExecutions * 100 : 0,
    avgLatencyMs: avgLatency?.avg ?? null,
    topErrors,
    recentExecutions
  };
}
function getUsersWithSessionStatus() {
  const db3 = getDatabase();
  return db3.prepare(`
    SELECT u.*, s.status as session_status, s.session_id
    FROM users u
    LEFT JOIN sessions s ON u.address = s.user_address
    ORDER BY u.created_at DESC
    LIMIT 100
  `).all();
}
function getDevnetStats(feeBps) {
  const db3 = getDatabase();
  const now = Math.floor(Date.now() / 1e3);
  const dayAgo = now - 86400;
  const totalUsersResult = db3.prepare("SELECT COUNT(DISTINCT address) as count FROM users").get();
  const users24hResult = db3.prepare(
    "SELECT COUNT(DISTINCT user_address) as count FROM executions WHERE created_at >= ?"
  ).get(dayAgo);
  const totalExecResult = db3.prepare("SELECT COUNT(*) as count FROM executions").get();
  const exec24hResult = db3.prepare(
    "SELECT COUNT(*) as count FROM executions WHERE created_at >= ?"
  ).get(dayAgo);
  const successResult = db3.prepare(
    "SELECT COUNT(*) as count FROM executions WHERE status = 'confirmed' OR tx_hash IS NOT NULL"
  ).get();
  const failResult = db3.prepare(
    "SELECT COUNT(*) as count FROM executions WHERE status = 'failed'"
  ).get();
  const amountByToken = db3.prepare(`
    SELECT token, SUM(CAST(amount_units AS REAL)) as total_units
    FROM executions
    WHERE token IS NOT NULL AND amount_units IS NOT NULL AND amount_units != ''
    GROUP BY token
  `).all();
  const unpricedAmountResult = db3.prepare(`
    SELECT COUNT(*) as count FROM executions
    WHERE token IS NULL OR amount_units IS NULL OR amount_units = ''
  `).get();
  const feesByToken = db3.prepare(`
    SELECT
      token,
      SUM(CAST(COALESCE(fee_units, CAST(amount_units AS REAL) * ? / 10000) AS REAL)) as total_fee,
      SUM(CASE WHEN created_at >= ? THEN CAST(COALESCE(fee_units, CAST(amount_units AS REAL) * ? / 10000) AS REAL) ELSE 0 END) as fee_24h
    FROM executions
    WHERE (status = 'confirmed' OR tx_hash IS NOT NULL)
      AND token IS NOT NULL
      AND amount_units IS NOT NULL
      AND amount_units != ''
    GROUP BY token
  `).all(feeBps, dayAgo, feeBps);
  const unpricedFeeResult = db3.prepare(`
    SELECT COUNT(*) as count FROM executions
    WHERE (status = 'confirmed' OR tx_hash IS NOT NULL)
      AND (token IS NULL OR amount_units IS NULL OR amount_units = '')
  `).get();
  return {
    users: {
      allTime: totalUsersResult?.count ?? 0,
      last24h: users24hResult?.count ?? 0
    },
    transactions: {
      allTime: totalExecResult?.count ?? 0,
      last24h: exec24hResult?.count ?? 0,
      successCount: successResult?.count ?? 0,
      failCount: failResult?.count ?? 0
    },
    amountExecuted: {
      byToken: amountByToken.map((row) => ({
        token: row.token,
        totalUnits: row.total_units?.toFixed(6) ?? "0"
      })),
      unpricedCount: unpricedAmountResult?.count ?? 0
    },
    feesCollected: {
      byToken: feesByToken.map((row) => ({
        token: row.token,
        totalFeeUnits: row.total_fee?.toFixed(6) ?? "0",
        last24hFeeUnits: row.fee_24h?.toFixed(6) ?? "0"
      })),
      feeBps,
      unpricedCount: unpricedFeeResult?.count ?? 0
    },
    generatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function updateExecutionWithFee(id, amountUnits, feeBps) {
  if (!amountUnits) return;
  const db3 = getDatabase();
  const amount = parseFloat(amountUnits);
  if (isNaN(amount)) return;
  const feeUnits = (amount * feeBps / 1e4).toFixed(6);
  db3.prepare(`
    UPDATE executions SET fee_units = ?, fee_bps = ?, updated_at = ?
    WHERE id = ?
  `).run(feeUnits, feeBps, Math.floor(Date.now() / 1e3), id);
}
function getTrafficStats(windowHours = 24) {
  const db3 = getDatabase();
  const now = Math.floor(Date.now() / 1e3);
  const windowStart = now - windowHours * 3600;
  const totalRequestsResult = db3.prepare(
    "SELECT COUNT(*) as count FROM request_log"
  ).get();
  const requestsWindowResult = db3.prepare(
    "SELECT COUNT(*) as count FROM request_log WHERE created_at >= ?"
  ).get(windowStart);
  const successWindowResult = db3.prepare(`
    SELECT COUNT(*) as count FROM request_log
    WHERE created_at >= ? AND (status_code IS NULL OR status_code < 400)
  `).get(windowStart);
  const http5xxWindowResult = db3.prepare(
    "SELECT COUNT(*) as count FROM request_log WHERE created_at >= ? AND status_code >= 500"
  ).get(windowStart);
  const visitorsAllTimeResult = db3.prepare(
    "SELECT COUNT(DISTINCT user_address) as count FROM request_log WHERE user_address IS NOT NULL"
  ).get();
  const visitorsWindowResult = db3.prepare(
    "SELECT COUNT(DISTINCT user_address) as count FROM request_log WHERE user_address IS NOT NULL AND created_at >= ?"
  ).get(windowStart);
  const requestsInWindow = requestsWindowResult?.count ?? 0;
  const successInWindow = successWindowResult?.count ?? 0;
  const successRate = requestsInWindow > 0 ? successInWindow / requestsInWindow * 100 : 100;
  return {
    requests: {
      allTime: totalRequestsResult?.count ?? 0,
      last24h: requestsInWindow,
      successRate24h: Math.round(successRate * 100) / 100,
      http5xx24h: http5xxWindowResult?.count ?? 0
    },
    visitors: {
      allTime: visitorsAllTimeResult?.count ?? 0,
      last24h: visitorsWindowResult?.count ?? 0
    },
    generatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function getRequestLogStats(runId) {
  const db3 = getDatabase();
  const totalResult = db3.prepare("SELECT COUNT(*) as count FROM request_log").get();
  const byEndpoint = db3.prepare(`
    SELECT
      endpoint,
      COUNT(*) as count,
      SUM(CASE WHEN status_code = 200 THEN 1 ELSE 0 END) as success_count,
      AVG(latency_ms) as avg_latency
    FROM request_log
    GROUP BY endpoint
    ORDER BY count DESC
  `).all();
  const byEndpointWithP95 = byEndpoint.map((row) => {
    const latencies = db3.prepare(
      "SELECT latency_ms FROM request_log WHERE endpoint = ? AND latency_ms IS NOT NULL ORDER BY latency_ms"
    ).all(row.endpoint);
    const p95Index = Math.ceil(latencies.length * 0.95) - 1;
    const p95 = latencies[Math.max(0, p95Index)]?.latency_ms ?? 0;
    return {
      endpoint: row.endpoint,
      count: row.count,
      successCount: row.success_count,
      avgLatencyMs: Math.round(row.avg_latency ?? 0),
      p95LatencyMs: p95
    };
  });
  const errorCodes = db3.prepare(`
    SELECT error_code as code, COUNT(*) as count
    FROM request_log
    WHERE error_code IS NOT NULL
    GROUP BY error_code
    ORDER BY count DESC
    LIMIT 10
  `).all();
  const http5xxResult = db3.prepare(
    "SELECT COUNT(*) as count FROM request_log WHERE status_code >= 500"
  ).get();
  return {
    totalRequests: totalResult?.count ?? 0,
    byEndpoint: byEndpointWithP95,
    errorCodes,
    http5xxCount: http5xxResult?.count ?? 0
  };
}
function getRecentTxHashes(limit = 20) {
  const db3 = getDatabase();
  const rows = db3.prepare(`
    SELECT tx_hash FROM executions
    WHERE tx_hash IS NOT NULL
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
  return rows.map((r) => r.tx_hash);
}
function migrateAddFeeColumns() {
  const db3 = getDatabase();
  const columns = db3.prepare("PRAGMA table_info(executions)").all();
  const hasFeeCols = columns.some((c) => c.name === "fee_units");
  if (!hasFeeCols) {
    try {
      db3.exec("ALTER TABLE executions ADD COLUMN fee_units TEXT");
      db3.exec("ALTER TABLE executions ADD COLUMN fee_bps INTEGER");
      console.log("[telemetry] Migrated: added fee_units and fee_bps columns");
    } catch (e) {
      console.log("[telemetry] Fee columns already exist or migration skipped");
    }
  }
}
function ensureRunsTable() {
  const db3 = getDatabase();
  db3.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT UNIQUE NOT NULL,
      stage INTEGER,
      users INTEGER,
      concurrency INTEGER,
      duration INTEGER,
      total_requests INTEGER,
      success_rate REAL,
      p50_ms INTEGER,
      p95_ms INTEGER,
      http_5xx INTEGER,
      top_error_code TEXT,
      started_at TEXT,
      ended_at TEXT,
      report_path TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_runs_run_id ON runs(run_id);
    CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at);
  `);
}
function upsertRun(run) {
  const db3 = getDatabase();
  ensureRunsTable();
  db3.prepare(`
    INSERT OR REPLACE INTO runs (
      run_id, stage, users, concurrency, duration,
      total_requests, success_rate, p50_ms, p95_ms, http_5xx,
      top_error_code, started_at, ended_at, report_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    run.run_id,
    run.stage,
    run.users,
    run.concurrency,
    run.duration,
    run.total_requests,
    run.success_rate,
    run.p50_ms,
    run.p95_ms,
    run.http_5xx,
    run.top_error_code,
    run.started_at,
    run.ended_at,
    run.report_path
  );
}
function listRuns(limit = 5) {
  const db3 = getDatabase();
  ensureRunsTable();
  return db3.prepare(`
    SELECT * FROM runs
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}
function getRun(runId) {
  const db3 = getDatabase();
  ensureRunsTable();
  return db3.prepare("SELECT * FROM runs WHERE run_id = ?").get(runId);
}
var __filename3, __dirname3, DB_PATH, db;
var init_db = __esm({
  "agent/telemetry/db.ts"() {
    "use strict";
    __filename3 = fileURLToPath3(import.meta.url);
    __dirname3 = dirname4(__filename3);
    DB_PATH = process.env.TELEMETRY_DB_PATH || path.join(__dirname3, "telemetry.db");
    db = null;
  }
});

// agent/src/quotes/lendingQuote.ts
async function getLendingRoutingDecision(request) {
  const warnings = [];
  let apr = DEMO_VAULT_APR_BPS;
  let routingSource = "deterministic";
  if (LENDING_RATE_SOURCE === "defillama") {
    try {
      const { getTopYieldVaults: getTopYieldVaults2 } = await Promise.resolve().then(() => (init_defiLlamaQuote(), defiLlamaQuote_exports));
      const vaults = await getTopYieldVaults2();
      if (vaults.length > 0) {
        apr = Math.round(vaults[0].apy * 100);
        routingSource = "defillama";
      } else {
        warnings.push("DefiLlama vaults not available; using demo rate");
      }
    } catch (error) {
      console.warn("[lendingQuote] DefiLlama fetch failed:", error.message);
      warnings.push("DefiLlama fetch failed; using demo rate");
    }
  }
  const vaultAddress = request.vaultAddress || DEMO_LEND_VAULT_ADDRESS || "";
  const isDemo = LENDING_EXECUTION_MODE === "demo";
  return {
    routingSource,
    apr: (apr / 100).toFixed(2),
    // Convert bps to percentage
    aprBps: apr,
    protocol: isDemo ? "DemoLendVault" : "Aave V3",
    executionVenue: isDemo ? "Blossom Demo Lending Vault" : "Aave V3",
    executionNote: isDemo ? "Executed deterministically via demo vault; APR is informational only." : "Executed via real lending protocol.",
    vault: vaultAddress,
    chain: "Sepolia",
    chainId: ETH_TESTNET_CHAIN_ID,
    settlementEstimate: "~1 block",
    warnings: warnings.length > 0 ? warnings : void 0
  };
}
var DEMO_VAULT_APR_BPS;
var init_lendingQuote = __esm({
  "agent/src/quotes/lendingQuote.ts"() {
    "use strict";
    init_config();
    DEMO_VAULT_APR_BPS = 500;
  }
});

// agent/src/executors/erc20Rpc.ts
var erc20Rpc_exports = {};
__export(erc20Rpc_exports, {
  erc20_allowance: () => erc20_allowance,
  erc20_balanceOf: () => erc20_balanceOf
});
function decodeUint256(hex) {
  if (!hex || hex === "0x") {
    return 0n;
  }
  return BigInt(hex);
}
async function erc20_balanceOf(token, owner) {
  if (!ETH_TESTNET_RPC_URL) {
    throw new Error("ETH_TESTNET_RPC_URL not configured");
  }
  const { encodeFunctionData } = await import("viem");
  const to = token.toLowerCase();
  const ownerAddr = owner.toLowerCase();
  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [ownerAddr]
  });
  console.log(`[erc20Rpc] balanceOf: token=${to.substring(0, 10)}..., owner=${ownerAddr.substring(0, 10)}..., data=${data.substring(0, 10)}...`);
  try {
    const response = await fetch(ETH_TESTNET_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [
          {
            to,
            data
          },
          "latest"
        ]
      })
    });
    if (!response.ok) {
      throw new Error(`RPC call failed: ${response.statusText}`);
    }
    const result = await response.json();
    if (result.error) {
      throw new Error(`RPC error: ${result.error.message || JSON.stringify(result.error)}`);
    }
    return decodeUint256(result.result);
  } catch (error) {
    throw new Error(`Failed to fetch ERC20 balance: ${error.message}`);
  }
}
async function erc20_allowance(token, owner, spender) {
  if (!ETH_TESTNET_RPC_URL) {
    throw new Error("ETH_TESTNET_RPC_URL not configured");
  }
  const { encodeFunctionData } = await import("viem");
  const to = token.toLowerCase();
  const ownerAddr = owner.toLowerCase();
  const spenderAddr = spender.toLowerCase();
  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [ownerAddr, spenderAddr]
  });
  console.log(`[erc20Rpc] allowance: token=${to.substring(0, 10)}..., owner=${ownerAddr.substring(0, 10)}..., spender=${spenderAddr.substring(0, 10)}..., data=${data.substring(0, 10)}...`);
  try {
    const response = await fetch(ETH_TESTNET_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [
          {
            to,
            data
          },
          "latest"
        ]
      })
    });
    if (!response.ok) {
      throw new Error(`RPC call failed: ${response.statusText}`);
    }
    const jsonResult = await response.json();
    const result = jsonResult;
    if (result.error) {
      throw new Error(`RPC error: ${result.error.message || JSON.stringify(result.error)}`);
    }
    if (!result.result) {
      throw new Error("RPC response missing result field");
    }
    return decodeUint256(result.result);
  } catch (error) {
    throw new Error(`Failed to fetch ERC20 allowance: ${error.message}`);
  }
}
var ERC20_ABI;
var init_erc20Rpc = __esm({
  "agent/src/executors/erc20Rpc.ts"() {
    "use strict";
    init_config();
    ERC20_ABI = [
      {
        name: "balanceOf",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "owner", type: "address" }],
        outputs: [{ name: "", type: "uint256" }]
      },
      {
        name: "allowance",
        type: "function",
        stateMutability: "view",
        inputs: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" }
        ],
        outputs: [{ name: "", type: "uint256" }]
      }
    ];
  }
});

// agent/src/executors/evmRpc.ts
var evmRpc_exports = {};
__export(evmRpc_exports, {
  decodeBool: () => decodeBool,
  decodeUint256: () => decodeUint2562,
  encodeCall: () => encodeCall,
  eth_call: () => eth_call,
  eth_getCode: () => eth_getCode,
  padAddress: () => padAddress
});
function padAddress(address) {
  const addressWithoutPrefix = address.toLowerCase().replace(/^0x/, "");
  return "0x" + addressWithoutPrefix.padStart(64, "0");
}
function encodeCall(functionSelector, ...params) {
  return functionSelector + params.join("");
}
async function eth_getCode(rpcUrl, address) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getCode",
      params: [address.toLowerCase(), "latest"]
    })
  });
  const jsonResult = await response.json();
  const result = jsonResult;
  if (result.error) {
    throw new Error(`RPC error: ${result.error.message || "Unknown error"}`);
  }
  if (!result.result) {
    return "0x";
  }
  return result.result;
}
async function eth_call(rpcUrl, to, data) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [
        {
          to: to.toLowerCase(),
          data
        },
        "latest"
      ]
    })
  });
  const jsonResult = await response.json();
  const result = jsonResult;
  if (result.error) {
    throw new Error(`RPC error: ${result.error.message || "Unknown error"}`);
  }
  if (!result.result) {
    return "0x";
  }
  return result.result;
}
function decodeBool(hex) {
  const cleaned = hex.replace(/^0x0*/, "");
  if (cleaned === "") return false;
  return BigInt(hex) !== 0n;
}
function decodeUint2562(hex) {
  if (!hex || hex === "0x" || hex === "0x0") {
    return "0";
  }
  return BigInt(hex).toString();
}
var init_evmRpc = __esm({
  "agent/src/executors/evmRpc.ts"() {
    "use strict";
  }
});

// agent/src/defi/aave/market.ts
var market_exports = {};
__export(market_exports, {
  getATokenAddress: () => getATokenAddress,
  getAaveMarketConfig: () => getAaveMarketConfig,
  getSupportedAsset: () => getSupportedAsset,
  getSupportedAssets: () => getSupportedAssets
});
async function getAaveMarketConfig() {
  const chainId = ETH_TESTNET_CHAIN_ID || 11155111;
  if (chainId === 11155111) {
    return AAVE_V3_SEPOLIA_CONFIG;
  }
  throw new Error(`Aave v3 market not configured for chainId ${chainId}`);
}
async function getATokenAddress(assetAddress) {
  try {
    const { createPublicClient: createPublicClient3, http: http5 } = await import("viem");
    const { sepolia: sepolia5 } = await import("viem/chains");
    if (!ETH_TESTNET_RPC_URL) {
      console.warn("[aave/market] ETH_TESTNET_RPC_URL not configured, cannot fetch aToken address");
      return null;
    }
    const publicClient = createPublicClient3({
      chain: sepolia5,
      transport: http5(ETH_TESTNET_RPC_URL)
    });
    const config3 = await getAaveMarketConfig();
    const abi = [
      {
        name: "getReserveTokensAddresses",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "asset", type: "address" }],
        outputs: [
          { name: "aTokenAddress", type: "address" },
          { name: "stableDebtTokenAddress", type: "address" },
          { name: "variableDebtTokenAddress", type: "address" }
        ]
      }
    ];
    const result = await publicClient.readContract({
      address: config3.poolDataProvider,
      abi,
      functionName: "getReserveTokensAddresses",
      args: [assetAddress]
    });
    return result[0];
  } catch (error) {
    console.warn(`[aave/market] Failed to fetch aToken address for ${assetAddress}:`, error.message);
    return null;
  }
}
async function getSupportedAsset(symbol) {
  const config3 = await getAaveMarketConfig();
  const asset = config3.supportedAssets.find((a) => a.symbol === symbol);
  if (!asset) {
    return null;
  }
  if (asset.aTokenAddress === "0x0000000000000000000000000000000000000000") {
    const aTokenAddress = await getATokenAddress(asset.address);
    if (aTokenAddress) {
      asset.aTokenAddress = aTokenAddress;
    }
  }
  return asset;
}
async function getSupportedAssets() {
  const config3 = await getAaveMarketConfig();
  const assetsWithATokens = await Promise.all(
    config3.supportedAssets.map(async (asset) => {
      if (asset.aTokenAddress === "0x0000000000000000000000000000000000000000") {
        const aTokenAddress = await getATokenAddress(asset.address);
        if (aTokenAddress) {
          return { ...asset, aTokenAddress };
        }
      }
      return asset;
    })
  );
  return assetsWithATokens;
}
var AAVE_V3_SEPOLIA_CONFIG;
var init_market = __esm({
  "agent/src/defi/aave/market.ts"() {
    "use strict";
    init_config();
    AAVE_V3_SEPOLIA_CONFIG = {
      chainId: 11155111,
      // Sepolia
      poolAddress: "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951",
      poolAddressesProvider: "0x012bAC54348C0E635dCAc9D5FB99f06F24136C9A",
      poolDataProvider: "0x3e9708d80f7B3e43118013075F7e95CE3AB31F31",
      supportedAssets: [
        // REDACTED on Sepolia (testnet token)
        // Note: aToken addresses can be fetched dynamically via PoolDataProvider
        // For now, we'll use a known address or fetch it on-demand
        // The actual REDACTED address on Sepolia may vary - this will be overridden by AAVE_REDACTED_ADDRESS if set
        {
          symbol: "REDACTED",
          address: "0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8",
          // Sepolia REDACTED testnet token (fallback)
          aTokenAddress: "0x0000000000000000000000000000000000000000",
          // Will be fetched dynamically
          decimals: 6
        }
      ]
    };
  }
});

// agent/src/executors/ethTestnetExecutor.ts
var ethTestnetExecutor_exports = {};
__export(ethTestnetExecutor_exports, {
  executionRequestToIntent: () => executionRequestToIntent,
  prepareEthTestnetExecution: () => prepareEthTestnetExecution
});
import { parseUnits } from "viem";
function executionRequestToIntent(executionRequest) {
  if (executionRequest.kind !== "swap") {
    throw new Error("Only swap execution requests supported");
  }
  if (!REDACTED_ADDRESS_SEPOLIA || !WETH_ADDRESS_SEPOLIA) {
    throw new Error("Token addresses not configured");
  }
  const tokenInAddr = executionRequest.tokenIn === "ETH" ? "ETH" : executionRequest.tokenIn === "WETH" ? WETH_ADDRESS_SEPOLIA.toLowerCase() : REDACTED_ADDRESS_SEPOLIA.toLowerCase();
  const tokenOutAddr = executionRequest.tokenOut === "WETH" ? WETH_ADDRESS_SEPOLIA.toLowerCase() : REDACTED_ADDRESS_SEPOLIA.toLowerCase();
  let executionIntent;
  if (executionRequest.tokenIn === "REDACTED" && executionRequest.tokenOut === "WETH") {
    executionIntent = "swap_usdc_weth";
  } else if (executionRequest.tokenIn === "WETH" && executionRequest.tokenOut === "REDACTED") {
    executionIntent = "swap_weth_usdc";
  } else if (executionRequest.tokenIn === "ETH") {
    executionIntent = executionRequest.tokenOut === "REDACTED" ? "swap_weth_usdc" : "swap_usdc_weth";
  } else {
    throw new Error(`Unsupported swap: ${executionRequest.tokenIn} \u2192 ${executionRequest.tokenOut}`);
  }
  let amountIn;
  if (executionRequest.tokenIn === "ETH" || executionRequest.tokenIn === "WETH") {
    amountIn = parseUnits(executionRequest.amountIn, 18);
  } else {
    amountIn = parseUnits(executionRequest.amountIn, 6);
  }
  return {
    executionIntent,
    amountIn,
    tokenIn: tokenInAddr,
    tokenOut: tokenOutAddr,
    fundingPolicy: executionRequest.fundingPolicy
  };
}
async function fetchNonceFromChain(userAddress) {
  if (!ETH_TESTNET_RPC_URL) {
    throw new Error("ETH_TESTNET_RPC_URL is required to fetch nonce");
  }
  if (!EXECUTION_ROUTER_ADDRESS) {
    throw new Error("EXECUTION_ROUTER_ADDRESS is required to fetch nonce");
  }
  const functionSelector = "0x7ecebe00";
  const paddedAddr = padAddress(userAddress);
  const callData = encodeCall(functionSelector, paddedAddr.slice(2));
  try {
    const result = await eth_call(ETH_TESTNET_RPC_URL, EXECUTION_ROUTER_ADDRESS, callData);
    return decodeUint2562(result);
  } catch (error) {
    console.error("[ethTestnetExecutor] Failed to fetch nonce:", error);
    throw new Error(`Failed to fetch nonce from chain: ${error.message}`);
  }
}
async function prepareEthTestnetExecution(args) {
  const { draftId, userAddress, strategy, authMode = "direct", executionIntent: providedIntent, executionRequest, executionKind = "default" } = args;
  let executionIntent = providedIntent || "mock";
  let fundingPolicy = "require_tokenIn";
  let requestAmountIn;
  const isDemoSwap = executionKind === "demo_swap" && DEMO_REDACTED_ADDRESS && DEMO_WETH_ADDRESS;
  if (isDemoSwap && !executionRequest) {
    executionIntent = "swap_usdc_weth";
    fundingPolicy = "require_tokenIn";
    requestAmountIn = parseUnits("100", 6);
  }
  const isLendSupply = executionKind === "lend_supply" && DEMO_REDACTED_ADDRESS && DEMO_LEND_VAULT_ADDRESS && DEMO_LEND_ADAPTER_ADDRESS;
  let lendAmount;
  if (isLendSupply && !executionRequest) {
    lendAmount = parseUnits("100", 6);
    fundingPolicy = "require_tokenIn";
  }
  if (executionRequest && executionRequest.kind === "swap") {
    const intentData = executionRequestToIntent(executionRequest);
    executionIntent = intentData.executionIntent;
    fundingPolicy = intentData.fundingPolicy;
    requestAmountIn = intentData.amountIn;
  }
  let lendAsset;
  if (executionRequest && executionRequest.kind === "lend") {
    const amountStr = executionRequest.amount || "100";
    lendAsset = executionRequest.asset?.toUpperCase() || "REDACTED";
    const lendDecimals = lendAsset === "WETH" ? 18 : 6;
    lendAmount = parseUnits(amountStr, lendDecimals);
    fundingPolicy = "require_tokenIn";
  }
  if (!userAddress) {
    throw new Error("userAddress is required");
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
    throw new Error(`Invalid userAddress format: ${userAddress}`);
  }
  requireEthTestnetConfig();
  if (!EXECUTION_ROUTER_ADDRESS || !MOCK_SWAP_ADAPTER_ADDRESS) {
    throw new Error("EXECUTION_ROUTER_ADDRESS and MOCK_SWAP_ADAPTER_ADDRESS must be set");
  }
  let nonce;
  const warnings = [];
  if (ETH_TESTNET_RPC_URL) {
    try {
      nonce = await fetchNonceFromChain(userAddress);
      console.log(`[ethTestnetExecutor] Fetched nonce for ${userAddress}: ${nonce}`);
    } catch (error) {
      console.warn(`[ethTestnetExecutor] Failed to fetch nonce, using 0: ${error.message}`);
      nonce = "0";
      warnings.push(
        `ETH_TESTNET_RPC_URL present but nonce fetch failed: ${error.message}. Using nonce 0 (first tx only).`
      );
    }
  } else {
    nonce = "0";
    warnings.push(
      "ETH_TESTNET_RPC_URL missing; nonce fetch disabled (first tx only). Set ETH_TESTNET_RPC_URL to enable nonce fetching."
    );
  }
  const deadlineSeconds = Math.floor(Date.now() / 1e3) + 10 * 60;
  const deadline = deadlineSeconds.toString();
  console.log("[ethTestnetExecutor] Building actions with:", {
    executionKind,
    executionIntent,
    hasStrategy: !!strategy,
    strategyType: strategy?.type,
    strategyInstrumentType: strategy?.instrumentType,
    hasPROOF_ADAPTER: !!PROOF_ADAPTER_ADDRESS
  });
  let actions;
  let approvalRequirements;
  let planValue = "0x0";
  let routingMetadata;
  let summary = "";
  const needsFundingRoute = executionRequest && executionRequest.kind === "swap" && executionRequest.tokenIn === "ETH" && fundingPolicy === "auto" && WETH_WRAP_ADAPTER_ADDRESS;
  if (needsFundingRoute) {
    if (!UNISWAP_V3_ADAPTER_ADDRESS) {
      throw new Error("UNISWAP_V3_ADAPTER_ADDRESS not configured for funding route");
    }
    if (!WETH_ADDRESS_SEPOLIA) {
      throw new Error("WETH_ADDRESS_SEPOLIA not configured");
    }
    if (!REDACTED_ADDRESS_SEPOLIA) {
      throw new Error("REDACTED_ADDRESS_SEPOLIA not configured");
    }
    const wrapAmount = requestAmountIn;
    const { encodeAbiParameters: encodeAbiParameters2 } = await import("viem");
    const wrapRecipient = executionRequest.tokenOut === "WETH" ? userAddress.toLowerCase() : EXECUTION_ROUTER_ADDRESS.toLowerCase();
    const wrapData = encodeAbiParameters2(
      [{ type: "address" }],
      [wrapRecipient]
    );
    const wrapAction = {
      actionType: 1,
      // WRAP (from PlanTypes.ActionType enum)
      adapter: WETH_WRAP_ADAPTER_ADDRESS.toLowerCase(),
      // Checked above
      data: wrapData
    };
    if (executionRequest.tokenOut === "REDACTED") {
      const tokenOut = REDACTED_ADDRESS_SEPOLIA.toLowerCase();
      const fee = 3e3;
      const amountOutMin = 0n;
      const recipient = userAddress.toLowerCase();
      const swapDeadline = deadlineSeconds;
      const swapInnerData = encodeAbiParameters2(
        [
          { type: "address" },
          { type: "address" },
          { type: "uint24" },
          { type: "uint256" },
          { type: "uint256" },
          { type: "address" },
          { type: "uint256" }
        ],
        [
          WETH_ADDRESS_SEPOLIA.toLowerCase(),
          tokenOut,
          fee,
          wrapAmount,
          // Use wrapped amount as swap input
          amountOutMin,
          recipient,
          BigInt(swapDeadline)
        ]
      );
      const swapAction = {
        actionType: 0,
        // SWAP
        adapter: UNISWAP_V3_ADAPTER_ADDRESS.toLowerCase(),
        data: swapInnerData
      };
      actions = [wrapAction, swapAction];
    } else {
      actions = [wrapAction];
    }
    planValue = "0x" + wrapAmount.toString(16);
    if (ETH_TESTNET_RPC_URL && EXECUTION_ROUTER_ADDRESS) {
      try {
        warnings.push(
          `FUNDING_ROUTE: Composing atomic route: Wrap ${executionRequest.amountIn} ETH \u2192 WETH, then swap WETH \u2192 ${executionRequest.tokenOut}.`
        );
      } catch (error) {
        warnings.push(
          `Could not verify funding route: ${error.message}. Proceeding anyway.`
        );
      }
    }
  } else if (executionIntent === "swap_usdc_weth" || executionIntent === "swap_weth_usdc") {
    const { EXECUTION_SWAP_MODE: EXECUTION_SWAP_MODE2 } = await Promise.resolve().then(() => (init_config(), config_exports));
    const useRealExecution = EXECUTION_SWAP_MODE2 === "real";
    const useDemoTokens = !useRealExecution && DEMO_REDACTED_ADDRESS && DEMO_WETH_ADDRESS && (isDemoSwap || executionRequest && executionRequest.kind === "swap" && (executionRequest.tokenIn === "REDACTED" && executionRequest.tokenOut === "WETH" || executionRequest.tokenIn === "WETH" && executionRequest.tokenOut === "REDACTED"));
    let tokenIn;
    let tokenOut;
    let swapAdapter;
    let pullAdapter;
    if (useDemoTokens && DEMO_REDACTED_ADDRESS && DEMO_WETH_ADDRESS) {
      tokenIn = executionIntent === "swap_usdc_weth" ? DEMO_REDACTED_ADDRESS.toLowerCase() : DEMO_WETH_ADDRESS.toLowerCase();
      tokenOut = executionIntent === "swap_usdc_weth" ? DEMO_WETH_ADDRESS.toLowerCase() : DEMO_REDACTED_ADDRESS.toLowerCase();
      swapAdapter = UNISWAP_ADAPTER_ADDRESS?.toLowerCase() || UNISWAP_V3_ADAPTER_ADDRESS?.toLowerCase() || "";
      pullAdapter = ERC20_PULL_ADAPTER_ADDRESS?.toLowerCase();
      if (!swapAdapter) {
        throw new Error("UNISWAP_ADAPTER_ADDRESS not configured for demo swap");
      }
      if (!pullAdapter) {
        throw new Error("ERC20_PULL_ADAPTER_ADDRESS not configured for demo swap");
      }
    } else {
      if (!UNISWAP_V3_ADAPTER_ADDRESS) {
        throw new Error("UNISWAP_V3_ADAPTER_ADDRESS not configured");
      }
      if (!REDACTED_ADDRESS_SEPOLIA) {
        throw new Error("REDACTED_ADDRESS_SEPOLIA not configured");
      }
      if (!WETH_ADDRESS_SEPOLIA) {
        throw new Error("WETH_ADDRESS_SEPOLIA not configured");
      }
      tokenIn = executionIntent === "swap_usdc_weth" ? REDACTED_ADDRESS_SEPOLIA.toLowerCase() : WETH_ADDRESS_SEPOLIA.toLowerCase();
      tokenOut = executionIntent === "swap_usdc_weth" ? WETH_ADDRESS_SEPOLIA.toLowerCase() : REDACTED_ADDRESS_SEPOLIA.toLowerCase();
      swapAdapter = UNISWAP_V3_ADAPTER_ADDRESS.toLowerCase();
      pullAdapter = void 0;
    }
    let amountIn;
    const decimalsIn = useDemoTokens ? executionIntent === "swap_usdc_weth" ? 6 : 18 : executionIntent === "swap_usdc_weth" ? 6 : 18;
    if (requestAmountIn) {
      amountIn = requestAmountIn;
    } else if (strategy) {
      if (strategy.notionalUsd) {
        const usdAmountStr = Math.max(1, Math.round(strategy.notionalUsd)).toString();
        amountIn = parseUnits(usdAmountStr, decimalsIn);
      } else if (strategy.depositUsd) {
        const usdAmountStr = Math.max(1, Math.round(strategy.depositUsd)).toString();
        amountIn = parseUnits(usdAmountStr, decimalsIn);
      } else {
        amountIn = executionIntent === "swap_usdc_weth" ? parseUnits("100", 6) : parseUnits("0.1", 18);
      }
    } else {
      amountIn = executionIntent === "swap_usdc_weth" ? parseUnits("100", 6) : parseUnits("0.1", 18);
    }
    if (useDemoTokens) {
      try {
        const tokenInSymbol = executionIntent === "swap_usdc_weth" ? "REDACTED" : "WETH";
        const tokenOutSymbol = executionIntent === "swap_usdc_weth" ? "WETH" : "REDACTED";
        const tokenInDecimals = executionIntent === "swap_usdc_weth" ? 6 : 18;
        const tokenOutDecimals = executionIntent === "swap_usdc_weth" ? 18 : 6;
        const routingDecision = await getSwapRoutingDecision({
          tokenIn,
          tokenOut,
          tokenInSymbol,
          tokenOutSymbol,
          tokenInDecimals,
          tokenOutDecimals,
          amountIn: amountIn.toString()
        });
        routingMetadata = {
          venue: routingDecision.routeSummary || routingDecision.executionVenue || "Uniswap V3",
          chain: "Sepolia",
          // Task 4: Always use Sepolia for eth_testnet (not Base/Hyperliquid)
          expectedOut: routingDecision.expectedOut,
          expectedOutRaw: routingDecision.expectedOutRaw,
          minOut: routingDecision.minOut,
          minOutRaw: routingDecision.minOutRaw,
          slippageBps: routingDecision.slippageBps,
          settlementEstimate: routingDecision.settlementEstimate,
          // Hybrid routing fields
          routingSource: routingDecision.routingSource,
          routeSummary: routingDecision.routeSummary,
          protocols: routingDecision.protocols,
          estimatedGas: routingDecision.estimatedGas,
          executionVenue: routingDecision.executionVenue || "Uniswap V3",
          executionNote: routingDecision.executionNote,
          warnings: routingDecision.warnings,
          // Sprint 3: Truthful routing metadata
          routing: routingDecision.routing
        };
      } catch (error) {
        console.warn("[ethTestnetExecutor] Failed to get routing decision:", error);
        try {
          const quote = await getSwapQuote2({
            tokenIn,
            tokenOut,
            amountIn: amountIn.toString(),
            fee: 3e3
          });
          if (quote) {
            routingMetadata = {
              venue: quote.venueLabel || "Blossom Demo Router",
              chain: "Sepolia",
              // Task 4: Always use Sepolia for eth_testnet (not Base/Hyperliquid)
              feeTier: quote.feeTier,
              expectedOut: quote.expectedOut,
              minOut: quote.minOut,
              slippageBps: quote.estSlippageBps,
              settlementEstimate: quote.settlementEstimate,
              routingSource: "deterministic",
              executionVenue: "Blossom Demo Router",
              executionNote: "Deterministic routing fallback."
            };
          }
        } catch (quoteError) {
          console.warn("[ethTestnetExecutor] Quote fallback also failed:", quoteError);
        }
      }
    }
    const fee = 3e3;
    const amountOutMin = useDemoTokens && routingMetadata?.minOutRaw ? BigInt(routingMetadata.minOutRaw) : 0n;
    const recipient = userAddress.toLowerCase();
    const swapDeadline = deadlineSeconds;
    const { encodeAbiParameters: encodeAbiParameters2 } = await import("viem");
    if (useDemoTokens && pullAdapter) {
      const pullInnerData = encodeAbiParameters2(
        [{ type: "address" }, { type: "address" }, { type: "uint256" }],
        [
          tokenIn,
          userAddress.toLowerCase(),
          amountIn
        ]
      );
      const swapInnerData = encodeAbiParameters2(
        [
          { type: "address" },
          { type: "address" },
          { type: "uint24" },
          { type: "uint256" },
          { type: "uint256" },
          { type: "address" },
          { type: "uint256" }
        ],
        [
          tokenIn,
          tokenOut,
          fee,
          amountIn,
          amountOutMin,
          recipient,
          BigInt(swapDeadline)
        ]
      );
      let pullActionData;
      let swapActionData;
      let maxSpendUnits = 1n;
      if (authMode === "session") {
        maxSpendUnits = amountIn / (100n * 10n ** 6n) + 1n;
        pullActionData = encodeAbiParameters2(
          [{ type: "uint256" }, { type: "bytes" }],
          [maxSpendUnits, pullInnerData]
        );
        swapActionData = encodeAbiParameters2(
          [{ type: "uint256" }, { type: "bytes" }],
          [maxSpendUnits, swapInnerData]
        );
      } else {
        pullActionData = pullInnerData;
        swapActionData = swapInnerData;
      }
      actions = [
        {
          actionType: 2,
          // PULL (from PlanTypes.ActionType enum)
          adapter: pullAdapter,
          data: pullActionData
        },
        {
          actionType: 0,
          // SWAP
          adapter: swapAdapter,
          data: swapActionData
        }
      ];
    } else if (useRealExecution) {
      if (!ERC20_PULL_ADAPTER_ADDRESS) {
        throw new Error("ERC20_PULL_ADAPTER_ADDRESS not configured for real swap execution");
      }
      const pullInnerData = encodeAbiParameters2(
        [{ type: "address" }, { type: "address" }, { type: "uint256" }],
        [
          tokenIn,
          userAddress.toLowerCase(),
          amountIn
        ]
      );
      const swapInnerData = encodeAbiParameters2(
        [
          { type: "address" },
          { type: "address" },
          { type: "uint24" },
          { type: "uint256" },
          { type: "uint256" },
          { type: "address" },
          { type: "uint256" }
        ],
        [
          tokenIn,
          tokenOut,
          fee,
          amountIn,
          routingMetadata?.minOutRaw ? BigInt(routingMetadata.minOutRaw) : 0n,
          recipient,
          BigInt(swapDeadline)
        ]
      );
      let pullActionData;
      let swapActionData;
      let maxSpendUnits = 1n;
      if (authMode === "session") {
        maxSpendUnits = amountIn / (100n * 10n ** 6n) + 1n;
        pullActionData = encodeAbiParameters2(
          [{ type: "uint256" }, { type: "bytes" }],
          [maxSpendUnits, pullInnerData]
        );
        swapActionData = encodeAbiParameters2(
          [{ type: "uint256" }, { type: "bytes" }],
          [maxSpendUnits, swapInnerData]
        );
      } else {
        pullActionData = pullInnerData;
        swapActionData = swapInnerData;
      }
      actions = [
        {
          actionType: 2,
          // PULL
          adapter: ERC20_PULL_ADAPTER_ADDRESS.toLowerCase(),
          data: pullActionData
        },
        {
          actionType: 0,
          // SWAP
          adapter: swapAdapter,
          data: swapActionData
        }
      ];
    } else {
      const innerData = encodeAbiParameters2(
        [
          { type: "address" },
          { type: "address" },
          { type: "uint24" },
          { type: "uint256" },
          { type: "uint256" },
          { type: "address" },
          { type: "uint256" }
        ],
        [
          tokenIn,
          tokenOut,
          fee,
          amountIn,
          amountOutMin,
          recipient,
          BigInt(swapDeadline)
        ]
      );
      let actionData;
      let maxSpendUnits = 1n;
      if (authMode === "session") {
        maxSpendUnits = amountIn / (100n * 10n ** 6n) + 1n;
        actionData = encodeAbiParameters2(
          [{ type: "uint256" }, { type: "bytes" }],
          [maxSpendUnits, innerData]
        );
      } else {
        actionData = innerData;
      }
      actions = [
        {
          actionType: 0,
          // SWAP
          adapter: swapAdapter,
          data: actionData
        }
      ];
    }
    if (ETH_TESTNET_RPC_URL && EXECUTION_ROUTER_ADDRESS) {
      try {
        const balance = await erc20_balanceOf(tokenIn, userAddress);
        const allowance = await erc20_allowance(
          tokenIn,
          userAddress,
          EXECUTION_ROUTER_ADDRESS
        );
        if (balance < amountIn) {
          const tokenName = executionIntent === "swap_usdc_weth" ? "REDACTED" : "WETH";
          warnings.push(
            `INSUFFICIENT_BALANCE: You need at least ${amountIn.toString()} ${tokenName} to execute this swap. Current balance: ${balance.toString()}`
          );
        }
        if (allowance < amountIn) {
          if (!approvalRequirements) {
            approvalRequirements = [];
          }
          approvalRequirements.push({
            token: tokenIn,
            spender: EXECUTION_ROUTER_ADDRESS.toLowerCase(),
            amount: "0x" + amountIn.toString(16)
            // Convert to hex string
          });
        }
      } catch (error) {
        warnings.push(
          `Could not verify token balance/allowance: ${error.message}. Proceeding anyway.`
        );
      }
    }
  } else if (isLendSupply || executionRequest && (executionRequest.kind === "lend" || executionRequest.kind === "lend_supply")) {
    const requestedAsset = lendAsset || executionRequest?.asset?.toUpperCase() || "REDACTED";
    const isWethLend = requestedAsset === "WETH";
    const lendDecimals = isWethLend ? 18 : 6;
    const amount = lendAmount || parseUnits(isWethLend ? "0.01" : "100", lendDecimals);
    const {
      AAVE_SEPOLIA_POOL_ADDRESS: AAVE_SEPOLIA_POOL_ADDRESS2,
      AAVE_ADAPTER_ADDRESS: AAVE_ADAPTER_ADDRESS2,
      AAVE_REDACTED_ADDRESS: AAVE_REDACTED_ADDRESS2,
      AAVE_WETH_ADDRESS: AAVE_WETH_ADDRESS3,
      LENDING_EXECUTION_MODE: LENDING_EXECUTION_MODE2
    } = await Promise.resolve().then(() => (init_config(), config_exports));
    const { getAaveMarketConfig: getAaveMarketConfig2, getSupportedAsset: getSupportedAsset2 } = await Promise.resolve().then(() => (init_market(), market_exports));
    const hasAaveConfig = AAVE_SEPOLIA_POOL_ADDRESS2 && AAVE_ADAPTER_ADDRESS2;
    const useRealAave = LENDING_EXECUTION_MODE2 === "real" && hasAaveConfig;
    let useAaveSepolia = false;
    let lendingProtocol = "VaultSim";
    let asset;
    let vault;
    let lendAdapter;
    if (useRealAave) {
      try {
        console.log("[ethTestnetExecutor] Attempting Aave Sepolia integration for", requestedAsset);
        const marketConfig = await getAaveMarketConfig2();
        if (isWethLend && AAVE_WETH_ADDRESS3) {
          asset = AAVE_WETH_ADDRESS3.toLowerCase();
          vault = marketConfig.poolAddress.toLowerCase();
          lendAdapter = AAVE_ADAPTER_ADDRESS2.toLowerCase();
          useAaveSepolia = true;
          lendingProtocol = "Aave V3";
          console.log("[ethTestnetExecutor] Using Aave Sepolia WETH:", { vault, lendAdapter, asset });
        } else {
          let usdcAsset = await getSupportedAsset2("REDACTED");
          if (AAVE_REDACTED_ADDRESS2 && AAVE_REDACTED_ADDRESS2 !== DEMO_REDACTED_ADDRESS) {
            usdcAsset = {
              symbol: "REDACTED",
              address: AAVE_REDACTED_ADDRESS2.toLowerCase(),
              aTokenAddress: "0x0000000000000000000000000000000000000000",
              decimals: 6
            };
          }
          if (usdcAsset) {
            asset = usdcAsset.address.toLowerCase();
            vault = marketConfig.poolAddress.toLowerCase();
            lendAdapter = AAVE_ADAPTER_ADDRESS2.toLowerCase();
            useAaveSepolia = true;
            lendingProtocol = "Aave V3";
            console.log("[ethTestnetExecutor] Using Aave Sepolia REDACTED:", { vault, lendAdapter, asset });
          } else {
            throw new Error("REDACTED not found in Aave market config");
          }
        }
      } catch (error) {
        console.warn("[ethTestnetExecutor] Aave Sepolia config invalid, falling back to VaultSim:", error.message);
        warnings.push("Aave Sepolia unavailable, using VaultSim fallback");
      }
    }
    if (!useAaveSepolia) {
      console.log("[ethTestnetExecutor] Using VaultSim fallback for lending");
      asset = DEMO_REDACTED_ADDRESS.toLowerCase();
      vault = DEMO_LEND_VAULT_ADDRESS.toLowerCase();
      lendAdapter = DEMO_LEND_ADAPTER_ADDRESS.toLowerCase();
      lendingProtocol = "VaultSim";
    }
    const pullAdapter = ERC20_PULL_ADAPTER_ADDRESS.toLowerCase();
    let lendingRouting;
    try {
      lendingRouting = await getLendingRoutingDecision({
        asset,
        amount: amount.toString(),
        vaultAddress: vault
      });
      routingMetadata = {
        venue: `Supply ${requestedAsset} to ${lendingRouting.protocol}`,
        chain: lendingRouting.chain,
        settlementEstimate: lendingRouting.settlementEstimate,
        routingSource: lendingRouting.routingSource,
        executionVenue: lendingRouting.executionVenue,
        executionNote: lendingRouting.executionNote,
        warnings: lendingRouting.warnings,
        apr: lendingRouting.apr,
        aprBps: lendingRouting.aprBps,
        vault: lendingRouting.vault,
        actionType: "lend_supply"
      };
    } catch (error) {
      console.warn("[ethTestnetExecutor] Failed to get lending routing:", error);
      warnings.push(`Lending routing failed: ${error.message}`);
    }
    const { encodeAbiParameters: encodeAbiParameters2 } = await import("viem");
    if (authMode === "session") {
      const pullInnerData = encodeAbiParameters2(
        [{ type: "address" }, { type: "address" }, { type: "uint256" }],
        [asset, userAddress.toLowerCase(), amount]
      );
      const pullData = encodeAbiParameters2(
        [{ type: "uint256" }, { type: "bytes" }],
        [0n, pullInnerData]
      );
      const lendInnerData = encodeAbiParameters2(
        [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "address" }],
        [asset, vault, amount, userAddress.toLowerCase()]
      );
      const lendData = encodeAbiParameters2(
        [{ type: "uint256" }, { type: "bytes" }],
        [0n, lendInnerData]
      );
      actions = [
        {
          actionType: 2,
          // PULL
          adapter: pullAdapter,
          data: pullData
        },
        {
          actionType: 3,
          // LEND_SUPPLY
          adapter: lendAdapter,
          data: lendData
        }
      ];
    } else {
      const pullData = encodeAbiParameters2(
        [{ type: "address" }, { type: "address" }, { type: "uint256" }],
        [asset, userAddress.toLowerCase(), amount]
      );
      const lendData = encodeAbiParameters2(
        [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "address" }],
        [asset, vault, amount, userAddress.toLowerCase()]
      );
      actions = [
        {
          actionType: 2,
          // PULL
          adapter: pullAdapter,
          data: pullData
        },
        {
          actionType: 3,
          // LEND_SUPPLY
          adapter: lendAdapter,
          data: lendData
        }
      ];
    }
    const amountDisplay = (Number(amount) / 1e6).toFixed(2);
    summary = `Supply ${amountDisplay} REDACTED to ${lendingRouting?.protocol || lendingProtocol} (Est APR: ${lendingRouting?.apr || "5.00"}%)`;
    if (ETH_TESTNET_RPC_URL) {
      try {
        const allowance = await erc20_allowance(asset, userAddress, EXECUTION_ROUTER_ADDRESS);
        if (allowance < amount) {
          if (!approvalRequirements) {
            approvalRequirements = [];
          }
          approvalRequirements.push({
            token: asset,
            spender: EXECUTION_ROUTER_ADDRESS.toLowerCase(),
            amount: "0x" + amount.toString(16)
          });
        }
      } catch (error) {
        warnings.push(`Could not verify lending approval: ${error.message}. Proceeding anyway.`);
      }
    }
  } else {
    const isPerpStrategy = strategy?.instrumentType === "perp" || executionKind === "perp" || executionRequest && executionRequest.kind === "perp";
    const isEventStrategy = strategy?.instrumentType === "event" || executionKind === "event";
    if ((isPerpStrategy || isEventStrategy) && PROOF_ADAPTER_ADDRESS) {
      const { encodeAbiParameters: encodeAbiParameters2, keccak256: keccak2562, toBytes, stringToBytes } = await import("viem");
      const venueType = isPerpStrategy ? 1 : 2;
      let intentPayload;
      let summaryText;
      if (isPerpStrategy) {
        const market = strategy?.market || "ETH-USD";
        const side = strategy?.direction || "long";
        const leverage = strategy?.leverage || 1;
        const riskPct = strategy?.riskPercent || 3;
        const marginUsd = strategy?.marginUsd || strategy?.notionalUsd || 100;
        const tp = strategy?.takeProfitPrice || "";
        const sl = strategy?.stopLossPrice || "";
        intentPayload = JSON.stringify({
          type: "perp",
          market,
          side,
          leverage,
          riskPct,
          marginUsd,
          tp,
          sl,
          timestamp: Math.floor(Date.now() / 1e3)
        });
        summaryText = `PERP:${market}-${side.toUpperCase()}-${leverage}x-${riskPct}%`;
        summary = `${side.toUpperCase()} ${market} @ ${leverage}x leverage (${riskPct}% risk)`;
        routingMetadata = {
          venue: `Perps: ${market}`,
          chain: "Sepolia",
          settlementEstimate: "~1 block",
          routingSource: "proof",
          executionVenue: "On-chain proof (venue execution simulated)",
          executionNote: "Proof-of-execution recorded. Real perp execution coming soon.",
          actionType: "perp",
          venueType
        };
      } else {
        const marketId = executionRequest && executionRequest.kind === "event" ? executionRequest.marketId : strategy?.market || "fed-rate-cut";
        const outcome = executionRequest && executionRequest.kind === "event" ? executionRequest.outcome : strategy?.outcome || strategy?.direction || "YES";
        const stakeUsd = executionRequest && executionRequest.kind === "event" ? executionRequest.stakeUsd : strategy?.stakeUsd || 5;
        const price = executionRequest && executionRequest.kind === "event" ? executionRequest.price : void 0;
        intentPayload = JSON.stringify({
          type: "event",
          marketId,
          outcome,
          stakeUsd,
          price,
          timestamp: Math.floor(Date.now() / 1e3)
        });
        summaryText = `EVENT:${marketId}-${outcome}-${stakeUsd}USD`;
        summary = `${outcome} on ${marketId} ($${stakeUsd} stake)`;
        routingMetadata = {
          venue: `Event: ${marketId}`,
          chain: "Sepolia",
          settlementEstimate: "~1 block",
          routingSource: "proof",
          executionVenue: "On-chain proof (venue execution simulated)",
          executionNote: "Proof-of-execution recorded. Real event market execution coming soon.",
          actionType: "event",
          venueType
        };
      }
      const intentHash = keccak2562(stringToBytes(intentPayload));
      const finalSummary = summaryText.slice(0, 160);
      const proofInnerData = encodeAbiParameters2(
        [{ type: "address" }, { type: "uint8" }, { type: "bytes32" }, { type: "string" }],
        [userAddress.toLowerCase(), venueType, intentHash, finalSummary]
      );
      let proofData;
      if (authMode === "session") {
        proofData = encodeAbiParameters2(
          [{ type: "uint256" }, { type: "bytes" }],
          [0n, proofInnerData]
        );
      } else {
        proofData = proofInnerData;
      }
      actions = [
        {
          actionType: 6,
          // PROOF (from PlanTypes.ActionType enum)
          adapter: PROOF_ADAPTER_ADDRESS.toLowerCase(),
          data: proofData
        }
      ];
    } else {
      let actionData;
      let maxSpendUnits = 1n;
      if (strategy) {
        if (strategy.notionalUsd) {
          maxSpendUnits = BigInt(Math.max(1, Math.round(strategy.notionalUsd)));
        } else if (strategy.depositUsd) {
          maxSpendUnits = BigInt(Math.max(1, Math.round(strategy.depositUsd)));
        } else if (strategy.stakeUsd) {
          maxSpendUnits = BigInt(Math.max(1, Math.round(strategy.stakeUsd)));
        }
      }
      if (authMode === "session") {
        const { encodeAbiParameters: encodeAbiParameters2 } = await import("viem");
        const innerData = "0x";
        actionData = encodeAbiParameters2(
          [{ type: "uint256" }, { type: "bytes" }],
          [maxSpendUnits, innerData]
        );
      } else {
        actionData = "0x";
      }
      actions = [
        {
          actionType: 0,
          // SWAP (from PlanTypes.ActionType enum)
          adapter: MOCK_SWAP_ADAPTER_ADDRESS.toLowerCase(),
          data: actionData
        }
      ];
    }
  }
  console.log("[ethTestnetExecutor] Actions built:", JSON.stringify(actions.map((a) => ({
    actionType: a.actionType,
    adapter: a.adapter?.substring(0, 10) + "...",
    dataLength: a.data?.length || 0
  })), null, 2));
  const plan = {
    user: userAddress.toLowerCase(),
    nonce,
    deadline,
    actions
  };
  const typedData = {
    domain: {
      name: "BlossomExecutionRouter",
      version: "1",
      chainId: ETH_TESTNET_CHAIN_ID,
      verifyingContract: EXECUTION_ROUTER_ADDRESS.toLowerCase()
    },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" }
      ],
      Action: [
        { name: "actionType", type: "uint8" },
        { name: "adapter", type: "address" },
        { name: "data", type: "bytes" }
      ],
      Plan: [
        { name: "user", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "actions", type: "Action[]" }
      ]
    },
    primaryType: "Plan",
    message: plan
  };
  if (!summary) {
    if (needsFundingRoute && actions.length > 1) {
      summary = `Execute atomic funding route on Sepolia: ${actions.length} actions (WRAP + SWAP). Nonce: ${nonce}, Deadline: ${new Date(deadlineSeconds * 1e3).toISOString()}`;
    } else {
      const adapterName = executionIntent === "swap_usdc_weth" || executionIntent === "swap_weth_usdc" ? "UniswapV3SwapAdapter" : "MockSwapAdapter";
      summary = `Execute plan on Sepolia: ${actions.length} action(s) via ${adapterName} (${executionIntent}). Nonce: ${nonce}, Deadline: ${new Date(deadlineSeconds * 1e3).toISOString()}`;
    }
  }
  const netExposureParts = [];
  if (actions.some((a) => a.actionType === 0)) {
    netExposureParts.push("Swap executed");
  }
  if (actions.some((a) => a.actionType === 3)) {
    netExposureParts.push("Yield position added");
  }
  if (executionKind === "perp" || executionRequest?.kind === "perp") {
    netExposureParts.push("Perp delta +2%");
  }
  if (executionKind === "event" || executionRequest?.kind === "event") {
    netExposureParts.push("Event position added");
  }
  const netExposure = netExposureParts.length > 0 ? `Net: ${netExposureParts.join(", ")}` : "Net: Neutral";
  const { keccak256, encodeAbiParameters } = await import("viem");
  const planHash = keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        // user
        { type: "uint256" },
        // nonce
        { type: "uint256" },
        // deadline
        {
          type: "tuple[]",
          // actions
          components: [
            { type: "uint8" },
            // actionType
            { type: "address" },
            // adapter
            { type: "bytes" }
            // data
          ]
        }
      ],
      [
        plan.user,
        BigInt(plan.nonce),
        BigInt(plan.deadline),
        plan.actions.map((a) => [
          a.actionType,
          a.adapter,
          a.data
        ])
      ]
    )
  );
  const result = {
    chainId: ETH_TESTNET_CHAIN_ID,
    to: EXECUTION_ROUTER_ADDRESS.toLowerCase(),
    value: planValue,
    // May be > 0 if WRAP action included
    plan,
    planHash,
    // V1: Include server-computed planHash
    typedData,
    // Optional/informational for future use
    call: {
      method: "executeBySender",
      args: {
        plan
      }
    },
    // Add requirements if approval is needed
    ...approvalRequirements && approvalRequirements.length > 0 ? { requirements: { approvals: approvalRequirements } } : {},
    summary,
    warnings: warnings.length > 0 ? warnings : void 0,
    // Add routing metadata if available (for demo swaps)
    // Sprint 3.1: Normalized routing metadata at top level
    ...routingMetadata ? {
      routing: {
        ...routingMetadata,
        // Ensure normalized routing metadata is accessible at top level
        routing: routingMetadata.routing || {
          source: "fallback",
          kind: "swap_quote",
          ok: false,
          reason: "Routing metadata missing from routingDecision",
          latencyMs: 0,
          mode: process.env.ROUTING_MODE || "hybrid",
          correlationId: makeCorrelationId("executor")
        }
      }
    } : {
      // Always include routing metadata, even if routingMetadata is undefined
      routing: {
        venue: "Unknown",
        chain: "Sepolia",
        routingSource: "fallback",
        routing: {
          source: "fallback",
          kind: "swap_quote",
          ok: false,
          reason: "No routing metadata available",
          latencyMs: 0,
          mode: process.env.ROUTING_MODE || "hybrid",
          correlationId: makeCorrelationId("executor")
        }
      }
    },
    netExposure
    // Static string, no new state
  };
  console.log("[ethTestnetExecutor] Prepared execution plan:", {
    draftId,
    userAddress,
    nonce,
    deadline: new Date(deadlineSeconds * 1e3).toISOString(),
    routerAddress: EXECUTION_ROUTER_ADDRESS,
    actionCount: actions.length,
    method: "executeBySender",
    requirements: result.requirements
  });
  if (process.env.DEBUG_EXECUTION === "true" || process.env.DEBUG_DEMO === "true") {
    const { encodeFunctionData } = await import("viem");
    const executeBySenderAbi = [
      {
        name: "executeBySender",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
          {
            name: "plan",
            type: "tuple",
            components: [
              { name: "user", type: "address" },
              { name: "nonce", type: "uint256" },
              { name: "deadline", type: "uint256" },
              {
                name: "actions",
                type: "tuple[]",
                components: [
                  { name: "actionType", type: "uint8" },
                  { name: "adapter", type: "address" },
                  { name: "data", type: "bytes" }
                ]
              }
            ]
          }
        ],
        outputs: []
      }
    ];
    const encodedData = encodeFunctionData({
      abi: executeBySenderAbi,
      functionName: "executeBySender",
      args: [plan]
    });
    console.log("[ethTestnetExecutor] DEBUG_EXECUTION:", {
      chainId: ETH_TESTNET_CHAIN_ID,
      to: EXECUTION_ROUTER_ADDRESS,
      value: planValue,
      dataLength: encodedData.length,
      dataBytes: encodedData.length / 2 - 1,
      // Subtract '0x' prefix
      routerAddress: EXECUTION_ROUTER_ADDRESS,
      adapterAddresses: actions.map((a) => a.adapter),
      actionTypes: actions.map((a) => a.actionType),
      routingMetadata: routingMetadata ? {
        venue: routingMetadata.venue,
        chain: routingMetadata.chain,
        executionVenue: routingMetadata.executionVenue
      } : null
    });
  }
  if ((process.env.DEBUG_EXECUTION === "true" || process.env.DEBUG_DEMO === "true") && ETH_TESTNET_RPC_URL) {
    try {
      const { createPublicClient: createPublicClient3, http: http5 } = await import("viem");
      const { sepolia: sepolia5 } = await import("viem/chains");
      const publicClient = createPublicClient3({
        chain: sepolia5,
        transport: http5(ETH_TESTNET_RPC_URL)
      });
      const { encodeFunctionData } = await import("viem");
      const executeBySenderAbi = [
        {
          name: "executeBySender",
          type: "function",
          stateMutability: "nonpayable",
          inputs: [
            {
              name: "plan",
              type: "tuple",
              components: [
                { name: "user", type: "address" },
                { name: "nonce", type: "uint256" },
                { name: "deadline", type: "uint256" },
                {
                  name: "actions",
                  type: "tuple[]",
                  components: [
                    { name: "actionType", type: "uint8" },
                    { name: "adapter", type: "address" },
                    { name: "data", type: "bytes" }
                  ]
                }
              ]
            }
          ],
          outputs: []
        }
      ];
      const encodedData = encodeFunctionData({
        abi: executeBySenderAbi,
        functionName: "executeBySender",
        args: [plan]
      });
      await publicClient.call({
        to: EXECUTION_ROUTER_ADDRESS,
        data: encodedData,
        value: BigInt(planValue)
      });
      console.log("[ethTestnetExecutor] Static call check: SUCCESS (tx should not revert)");
    } catch (error) {
      console.error("[ethTestnetExecutor] Static call check: FAILED (tx will likely revert):", error.message);
    }
  }
  return result;
}
var init_ethTestnetExecutor = __esm({
  "agent/src/executors/ethTestnetExecutor.ts"() {
    "use strict";
    init_config();
    init_evmQuote();
    init_lendingQuote();
    init_erc20Rpc();
    init_evmRpc();
    init_correlationId();
  }
});

// agent/src/server/sessionPolicy.ts
var sessionPolicy_exports = {};
__export(sessionPolicy_exports, {
  estimatePlanSpend: () => estimatePlanSpend,
  evaluateSessionPolicy: () => evaluateSessionPolicy
});
import { parseUnits as parseUnits2 } from "viem";
async function estimatePlanSpend(plan) {
  let totalSpendWei = BigInt(plan.value || "0x0");
  let determinable = true;
  let instrumentType;
  const { decodeAbiParameters } = await import("viem");
  for (const action of plan.actions) {
    try {
      if (action.actionType === 0) {
        instrumentType = "swap";
        try {
          const decoded = decodeAbiParameters(
            [
              { type: "address" },
              { type: "address" },
              { type: "uint24" },
              { type: "uint256" },
              { type: "uint256" },
              { type: "address" },
              { type: "uint256" }
            ],
            action.data
          );
          const amountIn = decoded[3];
          totalSpendWei += BigInt(parseUnits2("1", 18));
        } catch {
          try {
            const decoded = decodeAbiParameters(
              [{ type: "uint256" }, { type: "bytes" }],
              action.data
            );
            const maxSpendUnits = decoded[0];
            totalSpendWei += maxSpendUnits * BigInt(1e12);
          } catch {
            determinable = false;
          }
        }
      } else if (action.actionType === 2) {
        try {
          const decoded = decodeAbiParameters(
            [{ type: "address" }, { type: "address" }, { type: "uint256" }],
            action.data
          );
          const amount = decoded[2];
          totalSpendWei += amount * BigInt(1e12);
        } catch {
          determinable = false;
        }
      } else if (action.actionType === 3) {
        instrumentType = "defi";
        try {
          const decoded = decodeAbiParameters(
            [
              { type: "address" },
              { type: "address" },
              { type: "uint256" },
              { type: "address" }
            ],
            action.data
          );
          const amount = decoded[2];
          totalSpendWei += amount * BigInt(1e12);
        } catch {
          try {
            const decoded = decodeAbiParameters(
              [{ type: "uint256" }, { type: "bytes" }],
              action.data
            );
            const maxSpendUnits = decoded[0];
            totalSpendWei += maxSpendUnits * BigInt(1e12);
          } catch {
            determinable = false;
          }
        }
      } else if (action.actionType === 6) {
        instrumentType = "perp";
        totalSpendWei += BigInt(parseUnits2("0.1", 18));
      } else {
        determinable = false;
      }
    } catch (error) {
      determinable = false;
    }
  }
  return {
    spendWei: totalSpendWei,
    determinable,
    instrumentType
  };
}
async function evaluateSessionPolicy(sessionId, userAddress, plan, allowedAdapters, getSessionStatus, policyOverride) {
  let sessionStatus;
  if (policyOverride?.skipSessionCheck && (process.env.NODE_ENV !== "production" || process.env.DEV === "true")) {
    sessionStatus = {
      active: true,
      owner: userAddress,
      executor: userAddress,
      expiresAt: BigInt(Math.floor(Date.now() / 1e3) + 86400),
      // 1 day from now
      maxSpend: policyOverride.maxSpendUnits ? BigInt(policyOverride.maxSpendUnits) : BigInt("10000000000000000000"),
      // 10 ETH default
      spent: 0n,
      status: "active"
    };
  } else {
    sessionStatus = await getSessionStatus(sessionId);
    if (!sessionStatus) {
      return {
        allowed: false,
        code: "SESSION_NOT_ACTIVE",
        message: "Session not found or not active",
        details: { sessionId: sessionId.substring(0, 10) + "..." }
      };
    }
    if (sessionStatus.status !== "active") {
      return {
        allowed: false,
        code: "SESSION_EXPIRED_OR_REVOKED",
        message: `Session is ${sessionStatus.status}`,
        details: {
          status: sessionStatus.status,
          expiresAt: sessionStatus.expiresAt.toString(),
          now: BigInt(Math.floor(Date.now() / 1e3)).toString()
        }
      };
    }
  }
  for (const action of plan.actions) {
    const adapter = action.adapter?.toLowerCase();
    if (!adapter || !allowedAdapters.has(adapter)) {
      return {
        allowed: false,
        code: "ADAPTER_NOT_ALLOWED",
        message: `Adapter ${adapter} not in allowlist`,
        details: {
          adapter,
          allowedAdapters: Array.from(allowedAdapters)
        }
      };
    }
  }
  const spendEstimate = await estimatePlanSpend(plan);
  if (!spendEstimate.determinable) {
    return {
      allowed: false,
      code: "POLICY_UNDETERMINED_SPEND",
      message: "Cannot determine plan spend from actions. Policy cannot be evaluated.",
      details: {
        actionCount: plan.actions.length,
        actionTypes: plan.actions.map((a) => a.actionType)
      }
    };
  }
  let effectiveMaxSpend;
  let effectiveSpent;
  if (policyOverride?.maxSpendUnits && (process.env.NODE_ENV !== "production" || import.meta.env?.DEV)) {
    effectiveMaxSpend = BigInt(policyOverride.maxSpendUnits);
    effectiveSpent = 0n;
  } else {
    effectiveMaxSpend = sessionStatus.maxSpend;
    effectiveSpent = sessionStatus.spent;
  }
  const remainingSpend = effectiveMaxSpend - effectiveSpent;
  if (spendEstimate.spendWei > remainingSpend) {
    return {
      allowed: false,
      code: "POLICY_EXCEEDED",
      message: `Plan spend (${spendEstimate.spendWei.toString()}) exceeds remaining session spend limit (${remainingSpend.toString()})`,
      details: {
        spendAttempted: spendEstimate.spendWei.toString(),
        maxSpend: effectiveMaxSpend.toString(),
        spent: effectiveSpent.toString(),
        remaining: remainingSpend.toString(),
        ...policyOverride?.maxSpendUnits ? { policyOverride: true } : {}
      }
    };
  }
  return {
    allowed: true
  };
}
var init_sessionPolicy = __esm({
  "agent/src/server/sessionPolicy.ts"() {
    "use strict";
  }
});

// agent/src/executors/relayer.ts
var relayer_exports = {};
__export(relayer_exports, {
  sendRelayedTx: () => sendRelayedTx
});
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
async function sendRelayedTx({
  to,
  data,
  value = "0x0"
}) {
  requireRelayerConfig();
  if (!RELAYER_PRIVATE_KEY) {
    throw new Error("RELAYER_PRIVATE_KEY is required for relayed execution");
  }
  if (!ETH_TESTNET_RPC_URL) {
    throw new Error("ETH_TESTNET_RPC_URL is required for relayed execution");
  }
  console.log("[relayer] sendRelayedTx params:", {
    to: to?.slice(0, 10) + "...",
    dataLen: data?.length,
    value,
    valueType: typeof value
  });
  try {
    const account = privateKeyToAccount(RELAYER_PRIVATE_KEY);
    const client = createWalletClient({
      account,
      chain: sepolia,
      transport: http(ETH_TESTNET_RPC_URL)
    });
    const { createPublicClient: createPublicClient3 } = await import("viem");
    const publicClient = createPublicClient3({
      chain: sepolia,
      transport: http(ETH_TESTNET_RPC_URL)
    });
    let gasLimit;
    try {
      const estimatedGas = await publicClient.estimateGas({
        to,
        data,
        value: BigInt(value),
        account
      });
      const maxGasLimit = BigInt(12e6);
      gasLimit = estimatedGas * BigInt(120) / BigInt(100);
      if (gasLimit > maxGasLimit) {
        gasLimit = maxGasLimit;
      }
      if (process.env.DEBUG_DEMO === "true") {
        console.log("[relayer] Gas estimation:", {
          estimated: estimatedGas.toString(),
          withMultiplier: gasLimit.toString(),
          clamped: gasLimit === maxGasLimit
        });
      }
    } catch (error) {
      console.error("[relayer] Gas estimation failed:", error.message);
      throw new Error(`Gas estimation failed: ${error.message}. This usually means the transaction will revert. Check contract addresses and adapter configuration.`);
    }
    const hash = await client.sendTransaction({
      to,
      data,
      value: BigInt(value),
      gas: gasLimit
    });
    console.log("[relayer] Sent relayed transaction:", {
      to,
      hash,
      from: account.address
    });
    return hash;
  } catch (error) {
    console.error("[relayer] Failed to send relayed transaction:", error);
    throw new Error(`Relayed transaction failed: ${error.message || "Unknown error"}`);
  }
}
var init_relayer = __esm({
  "agent/src/executors/relayer.ts"() {
    "use strict";
    init_config();
  }
});

// agent/src/defi/aave/positions.ts
var positions_exports = {};
__export(positions_exports, {
  readAavePosition: () => readAavePosition,
  readAavePositions: () => readAavePositions
});
async function readAavePositions(userAddress) {
  if (!ETH_TESTNET_RPC_URL) {
    console.warn("[aave/positions] ETH_TESTNET_RPC_URL not configured");
    return [];
  }
  try {
    const marketConfig = await getAaveMarketConfig();
    const supportedAssets = await getSupportedAssets();
    const positions = [];
    for (const asset of supportedAssets) {
      try {
        let aTokenAddress = asset.aTokenAddress;
        if (aTokenAddress === "0x0000000000000000000000000000000000000000") {
          const fetched = await Promise.resolve().then(() => (init_market(), market_exports)).then((m) => m.getATokenAddress(asset.address));
          if (fetched) {
            aTokenAddress = fetched;
          } else {
            continue;
          }
        }
        const balance = await erc20_balanceOf(aTokenAddress, userAddress);
        if (balance > 0n) {
          const decimals = asset.decimals;
          const divisor = BigInt(10 ** decimals);
          const whole = balance / divisor;
          const fraction = balance % divisor;
          const balanceFormatted = `${whole.toString()}.${fraction.toString().padStart(decimals, "0").replace(/\.?0+$/, "")}`;
          positions.push({
            asset: asset.symbol,
            assetAddress: asset.address,
            aTokenAddress,
            balance,
            balanceFormatted,
            // Best-effort USD value (assume 1:1 for REDACTED)
            underlyingValueUsd: asset.symbol === "REDACTED" ? parseFloat(balanceFormatted) : void 0
            // APY would require fetching from PoolDataProvider.getReserveData
            // For now, we'll leave it undefined and let the frontend handle it
          });
        }
      } catch (error) {
        console.warn(`[aave/positions] Failed to read position for ${asset.symbol}:`, error.message);
      }
    }
    return positions;
  } catch (error) {
    console.error("[aave/positions] Failed to read Aave positions:", error.message);
    return [];
  }
}
async function readAavePosition(userAddress, assetSymbol) {
  const positions = await readAavePositions(userAddress);
  return positions.find((p) => p.asset === assetSymbol) || null;
}
var init_positions = __esm({
  "agent/src/defi/aave/positions.ts"() {
    "use strict";
    init_config();
    init_market();
    init_erc20Rpc();
  }
});

// agent/src/utils/demoTokenMinter.ts
var demoTokenMinter_exports = {};
__export(demoTokenMinter_exports, {
  mintDemoTokens: () => mintDemoTokens
});
import { createWalletClient as createWalletClient2, http as http2, publicActions } from "viem";
import { sepolia as sepolia2 } from "viem/chains";
import { privateKeyToAccount as privateKeyToAccount2 } from "viem/accounts";
async function mintDemoTokens(recipientAddress) {
  const {
    ETH_TESTNET_RPC_URL: ETH_TESTNET_RPC_URL2,
    DEMO_REDACTED_ADDRESS: DEMO_REDACTED_ADDRESS2,
    DEMO_WETH_ADDRESS: DEMO_WETH_ADDRESS2,
    RELAYER_PRIVATE_KEY: RELAYER_PRIVATE_KEY2
  } = await Promise.resolve().then(() => (init_config(), config_exports));
  if (!RELAYER_PRIVATE_KEY2) {
    throw new Error("RELAYER_PRIVATE_KEY not configured");
  }
  if (!DEMO_REDACTED_ADDRESS2 || !DEMO_WETH_ADDRESS2) {
    throw new Error("Demo token addresses not configured");
  }
  if (!ETH_TESTNET_RPC_URL2) {
    throw new Error("ETH_TESTNET_RPC_URL not configured");
  }
  const account = privateKeyToAccount2(RELAYER_PRIVATE_KEY2);
  const client = createWalletClient2({
    account,
    chain: sepolia2,
    transport: http2(ETH_TESTNET_RPC_URL2)
  }).extend(publicActions);
  const mintAbi = [
    {
      name: "mint",
      type: "function",
      stateMutability: "nonpayable",
      inputs: [
        { name: "to", type: "address" },
        { name: "amount", type: "uint256" }
      ],
      outputs: []
    }
  ];
  const usdcAmount = BigInt(1e4 * 10 ** 6);
  const usdcTxHash = await client.writeContract({
    address: DEMO_REDACTED_ADDRESS2,
    abi: mintAbi,
    functionName: "mint",
    args: [recipientAddress, usdcAmount]
  });
  await client.waitForTransactionReceipt({ hash: usdcTxHash });
  const wethAmount = BigInt(5 * 10 ** 18);
  const wethTxHash = await client.writeContract({
    address: DEMO_WETH_ADDRESS2,
    abi: mintAbi,
    functionName: "mint",
    args: [recipientAddress, wethAmount]
  });
  await client.waitForTransactionReceipt({ hash: wethTxHash });
  return {
    txHashes: {
      usdc: usdcTxHash,
      weth: wethTxHash
    },
    amounts: {
      usdc: "10000",
      weth: "5"
    }
  };
}
var init_demoTokenMinter = __esm({
  "agent/src/utils/demoTokenMinter.ts"() {
    "use strict";
  }
});

// agent/src/providers/rpcProvider.ts
var rpcProvider_exports = {};
__export(rpcProvider_exports, {
  createFailoverPublicClient: () => createFailoverPublicClient,
  createFailoverWalletClient: () => createFailoverWalletClient,
  executeRpcWithFailover: () => executeRpcWithFailover,
  executeWithFailover: () => executeWithFailover,
  forceFailover: () => forceFailover,
  getAllRpcUrls: () => getAllRpcUrls,
  getAvailableRpcUrl: () => getAvailableRpcUrl,
  getCurrentActiveUrl: () => getCurrentActiveUrl,
  getProviderHealthStatus: () => getProviderHealthStatus,
  initRpcProvider: () => initRpcProvider,
  resetAllCircuits: () => resetAllCircuits
});
import { createPublicClient, createWalletClient as createWalletClient3, custom } from "viem";
import { sepolia as sepolia3 } from "viem/chains";
function initRpcProvider(primary, fallbacks = []) {
  primaryUrl = primary;
  fallbackUrls = fallbacks;
  currentActiveUrl = primary;
  const allUrls = [primary, ...fallbacks];
  for (const url of allUrls) {
    if (!providerHealth.has(url)) {
      providerHealth.set(url, {
        url,
        isHealthy: true,
        lastCheck: Date.now(),
        circuit: {
          failures: 0,
          lastFailure: 0,
          isOpen: false,
          rateLimitedUntil: 0
        }
      });
    }
  }
  console.log(`[rpc-provider] Initialized with ${allUrls.length} endpoint(s)`);
  console.log(`[rpc-provider] Primary: ${maskUrl(primary)}`);
  if (fallbacks.length > 0) {
    console.log(`[rpc-provider] Fallbacks: ${fallbacks.map(maskUrl).join(", ")}`);
  }
}
function maskUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.length > 20) {
      parsed.pathname = parsed.pathname.substring(0, 10) + "...[masked]";
    }
    parsed.search = "";
    return parsed.toString();
  } catch {
    return url.substring(0, 30) + "...";
  }
}
function isRateLimitError(error) {
  const message = error?.message?.toLowerCase() || "";
  const details = error?.details?.toLowerCase() || "";
  const shortMessage = error?.shortMessage?.toLowerCase() || "";
  return message.includes("429") || message.includes("too many requests") || message.includes("rate limit") || message.includes("rate-limit") || details.includes("429") || details.includes("too many requests") || details.includes("rate limit") || shortMessage.includes("429") || shortMessage.includes("rate limit") || error?.status === 429;
}
function isRetriableError(error) {
  if (isRateLimitError(error)) return true;
  const message = error?.message?.toLowerCase() || "";
  return message.includes("timeout") || message.includes("econnreset") || message.includes("econnrefused") || message.includes("network") || message.includes("fetch failed") || message.includes("socket") || message.includes("503") || message.includes("502") || message.includes("500");
}
function calculateBackoff(attempt) {
  const exponential = Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
  const jitter = Math.random() * 0.3 * exponential;
  return Math.floor(exponential + jitter);
}
function sleep2(ms) {
  return new Promise((resolve3) => setTimeout(resolve3, ms));
}
function isCircuitClosed(health) {
  const circuit = health.circuit;
  const now = Date.now();
  if (circuit.rateLimitedUntil > now) {
    return false;
  }
  if (circuit.isOpen) {
    const elapsed = now - circuit.lastFailure;
    if (elapsed >= CIRCUIT_BREAKER_RESET_MS) {
      circuit.isOpen = false;
      circuit.failures = 0;
      console.log(`[rpc-provider] Circuit reset for ${maskUrl(health.url)}`);
      return true;
    }
    return false;
  }
  return true;
}
function recordFailure(url, error, isRateLimit = false) {
  const health = providerHealth.get(url);
  if (!health) return;
  health.circuit.failures++;
  health.circuit.lastFailure = Date.now();
  health.isHealthy = false;
  if (isRateLimit) {
    health.circuit.rateLimitedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
    health.circuit.isOpen = true;
    console.log(`[rpc-provider] Rate limited! Circuit OPEN for ${maskUrl(url)} for ${RATE_LIMIT_BACKOFF_MS / 1e3}s`);
  } else if (health.circuit.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    health.circuit.isOpen = true;
    console.log(`[rpc-provider] Circuit OPEN for ${maskUrl(url)} after ${health.circuit.failures} failures: ${error.message?.slice(0, 100)}`);
  } else {
    console.log(`[rpc-provider] Failure ${health.circuit.failures}/${CIRCUIT_BREAKER_THRESHOLD} for ${maskUrl(url)}: ${error.message?.slice(0, 100)}`);
  }
}
function recordSuccess(url) {
  const health = providerHealth.get(url);
  if (!health) return;
  health.circuit.failures = 0;
  health.circuit.isOpen = false;
  health.isHealthy = true;
  health.lastCheck = Date.now();
}
function getAllRpcUrls() {
  ensureInitialized();
  return [primaryUrl, ...fallbackUrls].filter(Boolean);
}
function getAvailableRpcUrl() {
  const allUrls = getAllRpcUrls();
  for (const url of allUrls) {
    const health = providerHealth.get(url);
    if (health && isCircuitClosed(health)) {
      currentActiveUrl = url;
      return url;
    }
  }
  if (primaryUrl) {
    console.log(`[rpc-provider] All circuits open, trying primary as last resort`);
    currentActiveUrl = primaryUrl;
    return primaryUrl;
  }
  return void 0;
}
function getCurrentActiveUrl() {
  return currentActiveUrl;
}
async function makeRpcRequest(url, body) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (response.status === 429) {
      const error = new Error(`HTTP 429: Too Many Requests from ${maskUrl(url)}`);
      error.status = 429;
      throw error;
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "Unknown error");
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    const json = await response.json();
    if (json.error) {
      const rpcError = new Error(json.error.message || "RPC Error");
      rpcError.code = json.error.code;
      throw rpcError;
    }
    return json.result;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new Error(`Request timeout after ${REQUEST_TIMEOUT_MS}ms to ${maskUrl(url)}`);
    }
    throw error;
  }
}
async function executeRpcWithFailover(method, params) {
  const allUrls = getAllRpcUrls();
  let lastError;
  let attemptCount = 0;
  for (const url of allUrls) {
    const health = providerHealth.get(url);
    if (health && !isCircuitClosed(health)) {
      continue;
    }
    for (let retry = 0; retry <= MAX_RETRIES_PER_ENDPOINT; retry++) {
      attemptCount++;
      try {
        const body = {
          jsonrpc: "2.0",
          id: Date.now(),
          method,
          params
        };
        const result = await makeRpcRequest(url, body);
        recordSuccess(url);
        currentActiveUrl = url;
        if (attemptCount > 1) {
          console.log(`[rpc-provider] Success on attempt ${attemptCount} via ${maskUrl(url)}`);
        }
        return result;
      } catch (error) {
        lastError = error;
        const isRateLimit = isRateLimitError(error);
        if (isRateLimit) {
          recordFailure(url, error, true);
          console.log(`[rpc-provider] Rate limited on ${maskUrl(url)}, switching to next endpoint...`);
          break;
        }
        if (isRetriableError(error) && retry < MAX_RETRIES_PER_ENDPOINT) {
          const backoff = calculateBackoff(retry);
          console.log(`[rpc-provider] Retry ${retry + 1}/${MAX_RETRIES_PER_ENDPOINT} for ${maskUrl(url)} after ${backoff}ms...`);
          await sleep2(backoff);
          continue;
        }
        recordFailure(url, error, false);
        break;
      }
    }
  }
  throw lastError || new Error("No RPC endpoints available");
}
function createFailoverTransport() {
  const request = async ({ method, params }) => {
    return executeRpcWithFailover(method, params);
  };
  return custom({ request });
}
async function executeWithFailover(fn) {
  const allUrls = getAllRpcUrls();
  let lastError;
  for (const url of allUrls) {
    const health = providerHealth.get(url);
    if (health && !isCircuitClosed(health)) {
      continue;
    }
    for (let retry = 0; retry <= MAX_RETRIES_PER_ENDPOINT; retry++) {
      try {
        const result = await fn(url);
        recordSuccess(url);
        return result;
      } catch (error) {
        lastError = error;
        const isRateLimit = isRateLimitError(error);
        if (isRateLimit) {
          recordFailure(url, error, true);
          break;
        }
        if (isRetriableError(error) && retry < MAX_RETRIES_PER_ENDPOINT) {
          const backoff = calculateBackoff(retry);
          await sleep2(backoff);
          continue;
        }
        recordFailure(url, error, false);
        break;
      }
    }
  }
  throw lastError || new Error("No RPC endpoints available");
}
function ensureInitialized() {
  if (primaryUrl) return;
  const primary = process.env.ETH_TESTNET_RPC_URL;
  if (!primary) {
    throw new Error("RPC provider not initialized and ETH_TESTNET_RPC_URL not set");
  }
  const fallbacks = [];
  if (process.env.ETH_RPC_FALLBACK_URLS) {
    fallbacks.push(...process.env.ETH_RPC_FALLBACK_URLS.split(",").map((u) => u.trim()).filter(Boolean));
  }
  if (process.env.ALCHEMY_RPC_URL && !primary.includes("alchemy")) {
    fallbacks.push(process.env.ALCHEMY_RPC_URL);
  }
  if (process.env.INFURA_RPC_URL && !primary.includes("infura")) {
    fallbacks.push(process.env.INFURA_RPC_URL);
  }
  const publicRpcs = [
    "https://ethereum-sepolia-rpc.publicnode.com",
    "https://1rpc.io/sepolia",
    "https://rpc.sepolia.org"
  ];
  for (const rpc of publicRpcs) {
    if (!fallbacks.some((u) => u.includes(new URL(rpc).hostname))) {
      fallbacks.push(rpc);
    }
  }
  const uniqueFallbacks = [...new Set(fallbacks)].filter((u) => u !== primary && u.length > 0);
  console.log("[rpc-provider] Auto-initializing from environment...");
  initRpcProvider(primary, uniqueFallbacks);
}
function createFailoverPublicClient(chain = sepolia3) {
  ensureInitialized();
  return createPublicClient({
    chain,
    transport: createFailoverTransport()
  });
}
function createFailoverWalletClient(account, chain = sepolia3) {
  ensureInitialized();
  return createWalletClient3({
    account,
    chain,
    transport: createFailoverTransport()
  });
}
function getProviderHealthStatus() {
  const status = {
    active: currentActiveUrl ? maskUrl(currentActiveUrl) : null,
    primary: null,
    fallbacks: []
  };
  if (primaryUrl) {
    const health = providerHealth.get(primaryUrl);
    status.primary = {
      url: maskUrl(primaryUrl),
      healthy: health?.isHealthy ?? false,
      circuitOpen: health?.circuit.isOpen ?? false,
      rateLimitedUntil: health?.circuit.rateLimitedUntil ?? 0
    };
  }
  for (const url of fallbackUrls) {
    const health = providerHealth.get(url);
    status.fallbacks.push({
      url: maskUrl(url),
      healthy: health?.isHealthy ?? false,
      circuitOpen: health?.circuit.isOpen ?? false,
      rateLimitedUntil: health?.circuit.rateLimitedUntil ?? 0
    });
  }
  return status;
}
function resetAllCircuits() {
  for (const health of providerHealth.values()) {
    health.circuit.failures = 0;
    health.circuit.isOpen = false;
    health.circuit.rateLimitedUntil = 0;
    health.isHealthy = true;
  }
  console.log("[rpc-provider] All circuits reset");
}
function forceFailover() {
  if (currentActiveUrl) {
    const health = providerHealth.get(currentActiveUrl);
    if (health) {
      health.circuit.isOpen = true;
      health.circuit.lastFailure = Date.now();
    }
  }
  return getAvailableRpcUrl();
}
var CIRCUIT_BREAKER_THRESHOLD, CIRCUIT_BREAKER_RESET_MS, REQUEST_TIMEOUT_MS, MAX_RETRIES_PER_ENDPOINT, BASE_BACKOFF_MS, MAX_BACKOFF_MS, RATE_LIMIT_BACKOFF_MS, providerHealth, primaryUrl, fallbackUrls, currentActiveUrl;
var init_rpcProvider = __esm({
  "agent/src/providers/rpcProvider.ts"() {
    "use strict";
    CIRCUIT_BREAKER_THRESHOLD = 2;
    CIRCUIT_BREAKER_RESET_MS = 3e4;
    REQUEST_TIMEOUT_MS = 15e3;
    MAX_RETRIES_PER_ENDPOINT = 1;
    BASE_BACKOFF_MS = 500;
    MAX_BACKOFF_MS = 5e3;
    RATE_LIMIT_BACKOFF_MS = 6e4;
    providerHealth = /* @__PURE__ */ new Map();
    fallbackUrls = [];
  }
});

// agent/execution-ledger/db-factory.ts
function detectDatabaseType() {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl && (databaseUrl.startsWith("postgres") || databaseUrl.startsWith("postgresql"))) {
    return "postgres";
  }
  return "sqlite";
}
function getDatabaseInfo() {
  const type = detectDatabaseType();
  if (type === "postgres") {
    const url = process.env.DATABASE_URL || "";
    const redactedUrl = url.replace(/:([^:@]+)@/, ":***@");
    return { type, url: redactedUrl };
  }
  return { type };
}
function logDatabaseInfo() {
  const info = getDatabaseInfo();
  if (info.type === "postgres") {
    console.log(`\u{1F5C4}\uFE0F  Database: PostgreSQL`);
    console.log(`   URL: ${info.url}`);
  } else {
    console.log(`\u{1F5C4}\uFE0F  Database: SQLite (local development)`);
    console.log(`   Path: agent/execution-ledger/ledger.db`);
  }
}
var init_db_factory = __esm({
  "agent/execution-ledger/db-factory.ts"() {
    "use strict";
    init_db2();
  }
});

// agent/execution-ledger/schema-const.ts
var SCHEMA_SQL;
var init_schema_const = __esm({
  "agent/execution-ledger/schema-const.ts"() {
    "use strict";
    SCHEMA_SQL = `
-- Bloom Execution Ledger Schema
-- Private dev-only SQLite database for tracking REAL, verifiable executions
-- across Ethereum Sepolia + Solana Devnet

-- ============================================
-- executions table
-- Core table tracking every execution attempt
-- ============================================
CREATE TABLE IF NOT EXISTS executions (
    id TEXT PRIMARY KEY,
    chain TEXT NOT NULL,                    -- 'ethereum' | 'solana'
    network TEXT NOT NULL,                  -- 'sepolia' | 'devnet'
    kind TEXT,                              -- 'perp' | 'deposit' | 'bridge' | 'swap' | 'proof' | 'relay' | 'transfer'
    venue TEXT,                             -- 'drift' | 'hl' | 'aave' | 'kamino' | 'lifi' | 'wormhole' | 'uniswap' | 'jupiter' | etc.
    intent TEXT NOT NULL,                   -- Original natural language intent
    action TEXT NOT NULL,                   -- Parsed action: wrap, supply, swap, transfer, airdrop, etc.
    from_address TEXT NOT NULL,             -- Wallet address that initiated
    to_address TEXT,                        -- Destination address (if applicable)
    token TEXT,                             -- Token symbol: SOL, ETH, WETH, REDACTED, etc.
    amount_units TEXT,                      -- Amount in base units (lamports, wei)
    amount_display TEXT,                    -- Human-readable amount (e.g., "0.01 SOL")
    usd_estimate REAL,                      -- Estimated USD value
    usd_estimate_is_estimate INTEGER DEFAULT 1, -- 1 if USD value is estimated, 0 if from oracle
    tx_hash TEXT,                           -- On-chain transaction signature/hash
    status TEXT NOT NULL DEFAULT 'pending', -- pending | submitted | confirmed | finalized | failed
    error_code TEXT,                        -- Error code if failed
    error_message TEXT,                     -- Error message if failed
    explorer_url TEXT,                      -- Link to block explorer
    gas_used TEXT,                          -- Gas/compute units consumed
    block_number INTEGER,                   -- Block/slot number
    latency_ms INTEGER,                     -- End-to-end latency
    relayer_address TEXT,                   -- Relayer that submitted tx (for session mode)
    session_id TEXT,                        -- Session ID (for session mode)
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_exec_chain ON executions(chain);
CREATE INDEX IF NOT EXISTS idx_exec_network ON executions(network);
CREATE INDEX IF NOT EXISTS idx_exec_from ON executions(from_address);
CREATE INDEX IF NOT EXISTS idx_exec_tx ON executions(tx_hash);
CREATE INDEX IF NOT EXISTS idx_exec_status ON executions(status);
CREATE INDEX IF NOT EXISTS idx_exec_created ON executions(created_at);

-- ============================================
-- routes table
-- Tracks multi-step execution routes (plans)
-- ============================================
CREATE TABLE IF NOT EXISTS routes (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL,             -- References executions.id
    step_index INTEGER NOT NULL,            -- Step order (0, 1, 2, ...)
    action_type INTEGER NOT NULL,           -- Adapter action type (0=WRAP, 1=PULL, 2=SWAP, 3=LEND_SUPPLY, etc.)
    adapter_address TEXT,                   -- Contract adapter address
    target_address TEXT,                    -- Target contract (Aave, Uniswap, etc.)
    encoded_data TEXT,                      -- ABI-encoded action data
    status TEXT NOT NULL DEFAULT 'pending', -- pending | executed | failed
    tx_hash TEXT,                           -- Individual step tx hash (if separate)
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (execution_id) REFERENCES executions(id)
);

CREATE INDEX IF NOT EXISTS idx_routes_exec ON routes(execution_id);
CREATE INDEX IF NOT EXISTS idx_routes_step ON routes(execution_id, step_index);

-- ============================================
-- sessions table
-- Tracks session authority grants (EIP-712)
-- ============================================
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    chain TEXT NOT NULL,                    -- 'ethereum' | 'solana'
    network TEXT NOT NULL,                  -- 'sepolia' | 'devnet'
    user_address TEXT NOT NULL,             -- User's wallet address
    session_id TEXT NOT NULL,               -- On-chain session ID
    relayer_address TEXT,                   -- Authorized relayer address
    status TEXT NOT NULL DEFAULT 'active',  -- preparing | active | revoked | expired
    expires_at INTEGER,                     -- Unix timestamp expiration
    created_tx TEXT,                        -- TX that created the session
    revoked_tx TEXT,                        -- TX that revoked (if any)
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE(chain, network, user_address, session_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_address);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

-- ============================================
-- assets table
-- Tracks token balances and movements
-- ============================================
CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    chain TEXT NOT NULL,                    -- 'ethereum' | 'solana'
    network TEXT NOT NULL,                  -- 'sepolia' | 'devnet'
    wallet_address TEXT NOT NULL,           -- Wallet address
    token_address TEXT,                     -- Token contract/mint address (null for native)
    token_symbol TEXT NOT NULL,             -- Token symbol: SOL, ETH, WETH, etc.
    balance_units TEXT,                     -- Current balance in base units
    balance_display TEXT,                   -- Human-readable balance
    last_tx_hash TEXT,                      -- Last transaction that affected balance
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE(chain, network, wallet_address, token_address)
);

CREATE INDEX IF NOT EXISTS idx_assets_wallet ON assets(wallet_address);
CREATE INDEX IF NOT EXISTS idx_assets_token ON assets(token_symbol);

-- ============================================
-- wallets table
-- Dev wallet registry (pubkeys only, no secrets)
-- ============================================
CREATE TABLE IF NOT EXISTS wallets (
    id TEXT PRIMARY KEY,
    chain TEXT NOT NULL,                    -- 'ethereum' | 'solana'
    network TEXT NOT NULL,                  -- 'sepolia' | 'devnet'
    address TEXT NOT NULL,                  -- Public key / address
    label TEXT,                             -- Human-readable label (e.g., "dev-wallet-1")
    is_primary INTEGER DEFAULT 0,           -- 1 if primary dev wallet for this chain
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE(chain, network, address)
);

CREATE INDEX IF NOT EXISTS idx_wallets_chain ON wallets(chain, network);

-- ============================================
-- execution_steps table (optional)
-- Tracks individual steps within a multi-step execution
-- e.g., approve -> supply, wrap -> swap
-- ============================================
CREATE TABLE IF NOT EXISTS execution_steps (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL,             -- References executions.id
    step_index INTEGER NOT NULL,            -- Step order (0, 1, 2, ...)
    action TEXT NOT NULL,                   -- Step action: approve, wrap, supply, swap, etc.
    tx_hash TEXT,                           -- Step's transaction hash
    explorer_url TEXT,                      -- Link to block explorer for this step
    status TEXT NOT NULL DEFAULT 'pending', -- pending | submitted | confirmed | failed
    error_message TEXT,                     -- Error message if this step failed
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (execution_id) REFERENCES executions(id)
);

CREATE INDEX IF NOT EXISTS idx_exec_steps_exec ON execution_steps(execution_id);
CREATE INDEX IF NOT EXISTS idx_exec_steps_status ON execution_steps(status);

-- ============================================
-- Additional indexes for new columns
-- ============================================
CREATE INDEX IF NOT EXISTS idx_exec_kind ON executions(kind);
CREATE INDEX IF NOT EXISTS idx_exec_venue ON executions(venue);

-- ============================================
-- intents table
-- Tracks user-style execution intents through their full lifecycle
-- ============================================
CREATE TABLE IF NOT EXISTS intents (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    intent_text TEXT NOT NULL,                    -- Original user prompt: "long btc 20x"
    intent_kind TEXT,                             -- perp | deposit | swap | bridge | unknown
    requested_chain TEXT,                         -- ethereum | solana | both | null
    requested_venue TEXT,                         -- aave | kamino | hl | drift | lifi | wormhole | demo_* | null
    usd_estimate REAL,                            -- Estimated USD value
    status TEXT NOT NULL DEFAULT 'queued',        -- queued | planned | routed | executing | confirmed | failed
    planned_at INTEGER,                           -- When plan was generated
    executed_at INTEGER,                          -- When execution started
    confirmed_at INTEGER,                         -- When confirmed on-chain
    failure_stage TEXT,                           -- plan | route | execute | confirm | quote
    error_code TEXT,                              -- VENUE_NOT_IMPLEMENTED, NO_LIQUIDITY, RPC_ERROR, etc.
    error_message TEXT,                           -- Truncated error message
    metadata_json TEXT                            -- JSON: parsed intent, route decision, quote data, etc.
);

CREATE INDEX IF NOT EXISTS idx_intents_status ON intents(status);
CREATE INDEX IF NOT EXISTS idx_intents_kind ON intents(intent_kind);
CREATE INDEX IF NOT EXISTS idx_intents_created ON intents(created_at);

-- ============================================
-- positions table
-- Tracks on-chain perp positions indexed from contract events
-- ============================================
CREATE TABLE IF NOT EXISTS positions (
    id TEXT PRIMARY KEY,
    chain TEXT NOT NULL,                        -- 'ethereum' | 'solana'
    network TEXT NOT NULL,                      -- 'sepolia' | 'devnet'
    venue TEXT NOT NULL,                        -- 'demo_perp' | 'drift' | 'hl' | etc.
    market TEXT NOT NULL,                       -- 'BTC' | 'ETH' | 'SOL'
    side TEXT NOT NULL,                         -- 'long' | 'short'
    leverage INTEGER,                           -- Leverage multiplier (1-50)
    margin_units TEXT,                          -- Margin in base units (6 decimals for REDACTED)
    margin_display TEXT,                        -- Human-readable margin (e.g., "100 REDACTED")
    size_units TEXT,                            -- Position size in USD base units
    entry_price TEXT,                           -- Entry price (8 decimals)
    status TEXT NOT NULL DEFAULT 'open',        -- open | closed | liquidated
    opened_at INTEGER NOT NULL,                 -- Unix timestamp when opened
    closed_at INTEGER,                          -- Unix timestamp when closed (if applicable)
    open_tx_hash TEXT,                          -- Transaction that opened the position
    open_explorer_url TEXT,                     -- Explorer link for open tx
    close_tx_hash TEXT,                         -- Transaction that closed the position
    close_explorer_url TEXT,                    -- Explorer link for close tx
    pnl TEXT,                                   -- Realized PnL (if closed)
    user_address TEXT NOT NULL,                 -- User/relayer address
    on_chain_position_id TEXT,                  -- Position ID from contract
    intent_id TEXT,                             -- References intents.id (if from intent)
    execution_id TEXT,                          -- References executions.id
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
CREATE INDEX IF NOT EXISTS idx_positions_user ON positions(user_address);
CREATE INDEX IF NOT EXISTS idx_positions_chain ON positions(chain, network);
CREATE INDEX IF NOT EXISTS idx_positions_market ON positions(market);
CREATE INDEX IF NOT EXISTS idx_positions_venue ON positions(venue);

-- ============================================
-- indexer_state table
-- Tracks indexer progress (last indexed block per chain/contract)
-- ============================================
CREATE TABLE IF NOT EXISTS indexer_state (
    id TEXT PRIMARY KEY,                        -- Unique key: chain:network:contract_address
    chain TEXT NOT NULL,
    network TEXT NOT NULL,
    contract_address TEXT NOT NULL,
    last_indexed_block INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE(chain, network, contract_address)
);

-- ============================================
-- Migrations for existing databases
-- SQLite ALTER TABLE ADD COLUMN (safe for existing tables)
-- These are idempotent - they'll fail silently if column exists
-- ============================================
-- Note: SQLite doesn't support IF NOT EXISTS for columns,
-- so these may error on fresh installs. The db.ts handles this.
`;
  }
});

// agent/execution-ledger/db.ts
var db_exports2 = {};
__export(db_exports2, {
  addToWaitlist: () => addToWaitlist,
  closeDatabase: () => closeDatabase2,
  closePosition: () => closePosition,
  countAssets: () => countAssets,
  countExecutions: () => countExecutions,
  countSessions: () => countSessions,
  createExecution: () => createExecution2,
  createExecutionStep: () => createExecutionStep,
  createIntent: () => createIntent,
  createPosition: () => createPosition,
  createRoute: () => createRoute,
  getDatabase: () => getDatabase2,
  getExecution: () => getExecution2,
  getExecutionByTxHash: () => getExecutionByTxHash,
  getExecutionSteps: () => getExecutionSteps,
  getExecutionsForIntent: () => getExecutionsForIntent,
  getIndexerState: () => getIndexerState,
  getIntent: () => getIntent,
  getIntentStats: () => getIntentStats,
  getIntentStatsSummary: () => getIntentStatsSummary,
  getLedgerSummary: () => getLedgerSummary,
  getOpenPositions: () => getOpenPositions,
  getPosition: () => getPosition,
  getPositionByOnChainId: () => getPositionByOnChainId,
  getPositionStats: () => getPositionStats,
  getPositionsByStatus: () => getPositionsByStatus,
  getPrimaryWallet: () => getPrimaryWallet,
  getProofBundle: () => getProofBundle,
  getRecentExecutions: () => getRecentExecutions,
  getRecentIntents: () => getRecentIntents,
  getRecentPositions: () => getRecentPositions,
  getRoutesForExecution: () => getRoutesForExecution,
  getStatsSummary: () => getStatsSummary,
  getSummaryStats: () => getSummaryStats,
  getSummaryStatsWithIntents: () => getSummaryStatsWithIntents,
  getWaitlistCount: () => getWaitlistCount,
  getWaitlistEntries: () => getWaitlistEntries,
  initDatabase: () => initDatabase2,
  linkExecutionToIntent: () => linkExecutionToIntent,
  listAssets: () => listAssets,
  listAssetsWithMeta: () => listAssetsWithMeta,
  listExecutions: () => listExecutions2,
  listExecutionsWithMeta: () => listExecutionsWithMeta,
  listSessions: () => listSessions,
  listSessionsWithMeta: () => listSessionsWithMeta,
  listWallets: () => listWallets,
  registerWallet: () => registerWallet,
  updateExecution: () => updateExecution2,
  updateExecutionStep: () => updateExecutionStep,
  updateIntentStatus: () => updateIntentStatus,
  updatePosition: () => updatePosition,
  updateRoute: () => updateRoute,
  upsertAsset: () => upsertAsset,
  upsertIndexerState: () => upsertIndexerState,
  upsertSession: () => upsertSession2
});
import Database2 from "better-sqlite3";
import { randomUUID as randomUUID3 } from "crypto";
import * as path2 from "path";
import * as fs2 from "fs";
import { fileURLToPath as fileURLToPath4 } from "url";
import { dirname as dirname6 } from "path";
function initDatabase2() {
  if (db2) return db2;
  if (dbType === "postgres") {
    console.warn("\u26A0\uFE0F  Postgres mode detected (DATABASE_URL is set)");
    console.warn("   Local SQLite will be used for backward compatibility.");
    console.warn("   Production deployments should use Postgres via API endpoints.");
    console.warn("   Run: npx tsx agent/scripts/setup-neon-db.ts --apply-schema");
  }
  const dbDir = path2.dirname(DB_PATH2);
  if (!fs2.existsSync(dbDir)) {
    fs2.mkdirSync(dbDir, { recursive: true });
  }
  db2 = new Database2(DB_PATH2);
  db2.pragma("journal_mode = WAL");
  db2.pragma("foreign_keys = ON");
  runMigrations2(db2);
  return db2;
}
function getDatabase2() {
  if (!db2) {
    return initDatabase2();
  }
  return db2;
}
function closeDatabase2() {
  if (db2) {
    db2.close();
    db2 = null;
  }
}
function runMigrations2(database) {
  database.exec(SCHEMA_SQL);
  runColumnMigrations(database);
}
function runColumnMigrations(database) {
  const migrations = [
    // executions table new columns
    "ALTER TABLE executions ADD COLUMN kind TEXT",
    "ALTER TABLE executions ADD COLUMN venue TEXT",
    "ALTER TABLE executions ADD COLUMN usd_estimate REAL",
    "ALTER TABLE executions ADD COLUMN usd_estimate_is_estimate INTEGER DEFAULT 1",
    "ALTER TABLE executions ADD COLUMN relayer_address TEXT",
    "ALTER TABLE executions ADD COLUMN session_id TEXT",
    "ALTER TABLE executions ADD COLUMN intent_id TEXT",
    // execution_steps table new columns for intent tracking
    "ALTER TABLE execution_steps ADD COLUMN stage TEXT",
    "ALTER TABLE execution_steps ADD COLUMN error_code TEXT"
  ];
  for (const migration of migrations) {
    try {
      database.exec(migration);
    } catch (e) {
      if (!e.message.includes("duplicate column name")) {
        console.warn(`[ledger] Migration warning: ${e.message}`);
      }
    }
  }
}
function createExecution2(params) {
  const db3 = getDatabase2();
  const id = randomUUID3();
  const now = Math.floor(Date.now() / 1e3);
  db3.prepare(`
    INSERT INTO executions (
      id, chain, network, kind, venue, intent, action, from_address, to_address,
      token, amount_units, amount_display, usd_estimate, usd_estimate_is_estimate,
      relayer_address, session_id, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    id,
    params.chain,
    params.network,
    params.kind ?? null,
    params.venue ?? null,
    params.intent,
    params.action,
    params.fromAddress.toLowerCase(),
    params.toAddress?.toLowerCase() ?? null,
    params.token ?? null,
    params.amountUnits ?? null,
    params.amountDisplay ?? null,
    params.usdEstimate ?? null,
    params.usdEstimateIsEstimate === false ? 0 : 1,
    // Default to estimate=true
    params.relayerAddress?.toLowerCase() ?? null,
    params.sessionId ?? null,
    now,
    now
  );
  return {
    id,
    chain: params.chain,
    network: params.network,
    kind: params.kind,
    venue: params.venue,
    intent: params.intent,
    action: params.action,
    from_address: params.fromAddress.toLowerCase(),
    to_address: params.toAddress?.toLowerCase(),
    token: params.token,
    amount_units: params.amountUnits,
    amount_display: params.amountDisplay,
    usd_estimate: params.usdEstimate,
    usd_estimate_is_estimate: params.usdEstimateIsEstimate === false ? 0 : 1,
    relayer_address: params.relayerAddress?.toLowerCase(),
    session_id: params.sessionId,
    status: "pending",
    created_at: now,
    updated_at: now
  };
}
function updateExecution2(id, updates) {
  const db3 = getDatabase2();
  const now = Math.floor(Date.now() / 1e3);
  const sets = ["updated_at = ?"];
  const values = [now];
  if (updates.status !== void 0) {
    sets.push("status = ?");
    values.push(updates.status);
  }
  if (updates.kind !== void 0) {
    sets.push("kind = ?");
    values.push(updates.kind);
  }
  if (updates.venue !== void 0) {
    sets.push("venue = ?");
    values.push(updates.venue);
  }
  if (updates.txHash !== void 0) {
    sets.push("tx_hash = ?");
    values.push(updates.txHash);
  }
  if (updates.explorerUrl !== void 0) {
    sets.push("explorer_url = ?");
    values.push(updates.explorerUrl);
  }
  if (updates.errorCode !== void 0) {
    sets.push("error_code = ?");
    values.push(updates.errorCode);
  }
  if (updates.errorMessage !== void 0) {
    sets.push("error_message = ?");
    values.push(updates.errorMessage);
  }
  if (updates.gasUsed !== void 0) {
    sets.push("gas_used = ?");
    values.push(updates.gasUsed);
  }
  if (updates.blockNumber !== void 0) {
    sets.push("block_number = ?");
    values.push(updates.blockNumber);
  }
  if (updates.latencyMs !== void 0) {
    sets.push("latency_ms = ?");
    values.push(updates.latencyMs);
  }
  if (updates.usdEstimate !== void 0) {
    sets.push("usd_estimate = ?");
    values.push(updates.usdEstimate);
  }
  if (updates.usdEstimateIsEstimate !== void 0) {
    sets.push("usd_estimate_is_estimate = ?");
    values.push(updates.usdEstimateIsEstimate ? 1 : 0);
  }
  if (updates.relayerAddress !== void 0) {
    sets.push("relayer_address = ?");
    values.push(updates.relayerAddress.toLowerCase());
  }
  if (updates.sessionId !== void 0) {
    sets.push("session_id = ?");
    values.push(updates.sessionId);
  }
  values.push(id);
  db3.prepare(`UPDATE executions SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}
function getExecution2(id) {
  const db3 = getDatabase2();
  return db3.prepare("SELECT * FROM executions WHERE id = ?").get(id);
}
function getExecutionByTxHash(txHash) {
  const db3 = getDatabase2();
  return db3.prepare("SELECT * FROM executions WHERE tx_hash = ?").get(txHash);
}
function countExecutions(params) {
  const db3 = getDatabase2();
  let query = "SELECT COUNT(*) as count FROM executions WHERE 1=1";
  const values = [];
  if (params?.chain) {
    query += " AND chain = ?";
    values.push(params.chain);
  }
  if (params?.network) {
    query += " AND network = ?";
    values.push(params.network);
  }
  if (params?.status) {
    query += " AND status = ?";
    values.push(params.status);
  }
  return db3.prepare(query).get(...values).count;
}
function listExecutions2(params) {
  const db3 = getDatabase2();
  const limit = params?.limit ?? 50;
  const offset = params?.offset ?? 0;
  let query = "SELECT * FROM executions WHERE 1=1";
  const values = [];
  if (params?.chain) {
    query += " AND chain = ?";
    values.push(params.chain);
  }
  if (params?.network) {
    query += " AND network = ?";
    values.push(params.network);
  }
  if (params?.status) {
    query += " AND status = ?";
    values.push(params.status);
  }
  query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  values.push(limit, offset);
  return db3.prepare(query).all(...values);
}
function listExecutionsWithMeta(params) {
  const limit = params?.limit ?? 50;
  const offset = params?.offset ?? 0;
  const totalInDb = countExecutions(params);
  const data = listExecutions2(params);
  return {
    data,
    meta: { totalInDb, limit, offset }
  };
}
function createRoute(params) {
  const db3 = getDatabase2();
  const id = randomUUID3();
  const now = Math.floor(Date.now() / 1e3);
  db3.prepare(`
    INSERT INTO routes (
      id, execution_id, step_index, action_type, adapter_address,
      target_address, encoded_data, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(
    id,
    params.executionId,
    params.stepIndex,
    params.actionType,
    params.adapterAddress ?? null,
    params.targetAddress ?? null,
    params.encodedData ?? null,
    now
  );
  return {
    id,
    execution_id: params.executionId,
    step_index: params.stepIndex,
    action_type: params.actionType,
    adapter_address: params.adapterAddress,
    target_address: params.targetAddress,
    encoded_data: params.encodedData,
    status: "pending",
    created_at: now
  };
}
function getRoutesForExecution(executionId) {
  const db3 = getDatabase2();
  return db3.prepare(
    "SELECT * FROM routes WHERE execution_id = ? ORDER BY step_index"
  ).all(executionId);
}
function updateRoute(id, updates) {
  const db3 = getDatabase2();
  const sets = [];
  const values = [];
  if (updates.status !== void 0) {
    sets.push("status = ?");
    values.push(updates.status);
  }
  if (updates.txHash !== void 0) {
    sets.push("tx_hash = ?");
    values.push(updates.txHash);
  }
  if (sets.length === 0) return;
  values.push(id);
  db3.prepare(`UPDATE routes SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}
function upsertSession2(params) {
  const db3 = getDatabase2();
  const id = randomUUID3();
  const now = Math.floor(Date.now() / 1e3);
  const existing = db3.prepare(
    "SELECT * FROM sessions WHERE chain = ? AND network = ? AND user_address = ? AND session_id = ?"
  ).get(params.chain, params.network, params.userAddress.toLowerCase(), params.sessionId);
  if (existing) {
    db3.prepare(`
      UPDATE sessions SET status = ?, relayer_address = ?, expires_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      params.status,
      params.relayerAddress ?? existing.relayer_address ?? null,
      params.expiresAt ?? existing.expires_at ?? null,
      now,
      existing.id
    );
    return { ...existing, status: params.status, updated_at: now };
  }
  db3.prepare(`
    INSERT INTO sessions (
      id, chain, network, user_address, session_id, relayer_address,
      status, expires_at, created_tx, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.chain,
    params.network,
    params.userAddress.toLowerCase(),
    params.sessionId,
    params.relayerAddress ?? null,
    params.status,
    params.expiresAt ?? null,
    params.createdTx ?? null,
    now,
    now
  );
  return {
    id,
    chain: params.chain,
    network: params.network,
    user_address: params.userAddress.toLowerCase(),
    session_id: params.sessionId,
    relayer_address: params.relayerAddress,
    status: params.status,
    expires_at: params.expiresAt,
    created_tx: params.createdTx,
    created_at: now,
    updated_at: now
  };
}
function countSessions(params) {
  const db3 = getDatabase2();
  let query = "SELECT COUNT(*) as count FROM sessions WHERE 1=1";
  const values = [];
  if (params?.chain) {
    query += " AND chain = ?";
    values.push(params.chain);
  }
  if (params?.network) {
    query += " AND network = ?";
    values.push(params.network);
  }
  if (params?.status) {
    query += " AND status = ?";
    values.push(params.status);
  }
  return db3.prepare(query).get(...values).count;
}
function listSessions(params) {
  const db3 = getDatabase2();
  const limit = params?.limit ?? 50;
  let query = "SELECT * FROM sessions WHERE 1=1";
  const values = [];
  if (params?.chain) {
    query += " AND chain = ?";
    values.push(params.chain);
  }
  if (params?.network) {
    query += " AND network = ?";
    values.push(params.network);
  }
  if (params?.status) {
    query += " AND status = ?";
    values.push(params.status);
  }
  query += " ORDER BY created_at DESC LIMIT ?";
  values.push(limit);
  return db3.prepare(query).all(...values);
}
function listSessionsWithMeta(params) {
  const limit = params?.limit ?? 50;
  const totalInDb = countSessions(params);
  const data = listSessions(params);
  return {
    data,
    meta: { totalInDb, limit, offset: 0 }
  };
}
function upsertAsset(params) {
  const db3 = getDatabase2();
  const id = randomUUID3();
  const now = Math.floor(Date.now() / 1e3);
  const existing = db3.prepare(
    "SELECT * FROM assets WHERE chain = ? AND network = ? AND wallet_address = ? AND (token_address = ? OR (token_address IS NULL AND ? IS NULL))"
  ).get(
    params.chain,
    params.network,
    params.walletAddress.toLowerCase(),
    params.tokenAddress ?? null,
    params.tokenAddress ?? null
  );
  if (existing) {
    db3.prepare(`
      UPDATE assets SET
        balance_units = ?, balance_display = ?, last_tx_hash = ?, updated_at = ?
      WHERE id = ?
    `).run(
      params.balanceUnits ?? existing.balance_units ?? null,
      params.balanceDisplay ?? existing.balance_display ?? null,
      params.lastTxHash ?? existing.last_tx_hash ?? null,
      now,
      existing.id
    );
    return {
      ...existing,
      balance_units: params.balanceUnits ?? existing.balance_units,
      balance_display: params.balanceDisplay ?? existing.balance_display,
      last_tx_hash: params.lastTxHash ?? existing.last_tx_hash,
      updated_at: now
    };
  }
  db3.prepare(`
    INSERT INTO assets (
      id, chain, network, wallet_address, token_address, token_symbol,
      balance_units, balance_display, last_tx_hash, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.chain,
    params.network,
    params.walletAddress.toLowerCase(),
    params.tokenAddress ?? null,
    params.tokenSymbol,
    params.balanceUnits ?? null,
    params.balanceDisplay ?? null,
    params.lastTxHash ?? null,
    now
  );
  return {
    id,
    chain: params.chain,
    network: params.network,
    wallet_address: params.walletAddress.toLowerCase(),
    token_address: params.tokenAddress,
    token_symbol: params.tokenSymbol,
    balance_units: params.balanceUnits,
    balance_display: params.balanceDisplay,
    last_tx_hash: params.lastTxHash,
    updated_at: now
  };
}
function countAssets(params) {
  const db3 = getDatabase2();
  let query = "SELECT COUNT(*) as count FROM assets WHERE 1=1";
  const values = [];
  if (params?.chain) {
    query += " AND chain = ?";
    values.push(params.chain);
  }
  if (params?.network) {
    query += " AND network = ?";
    values.push(params.network);
  }
  if (params?.walletAddress) {
    query += " AND wallet_address = ?";
    values.push(params.walletAddress.toLowerCase());
  }
  return db3.prepare(query).get(...values).count;
}
function listAssets(params) {
  const db3 = getDatabase2();
  const limit = params?.limit ?? 100;
  let query = "SELECT * FROM assets WHERE 1=1";
  const values = [];
  if (params?.chain) {
    query += " AND chain = ?";
    values.push(params.chain);
  }
  if (params?.network) {
    query += " AND network = ?";
    values.push(params.network);
  }
  if (params?.walletAddress) {
    query += " AND wallet_address = ?";
    values.push(params.walletAddress.toLowerCase());
  }
  query += " ORDER BY updated_at DESC LIMIT ?";
  values.push(limit);
  return db3.prepare(query).all(...values);
}
function listAssetsWithMeta(params) {
  const limit = params?.limit ?? 100;
  const totalInDb = countAssets(params);
  const data = listAssets(params);
  return {
    data,
    meta: { totalInDb, limit, offset: 0 }
  };
}
function registerWallet(params) {
  const db3 = getDatabase2();
  const id = randomUUID3();
  const now = Math.floor(Date.now() / 1e3);
  if (params.isPrimary) {
    db3.prepare(
      "UPDATE wallets SET is_primary = 0 WHERE chain = ? AND network = ?"
    ).run(params.chain, params.network);
  }
  db3.prepare(`
    INSERT OR REPLACE INTO wallets (
      id, chain, network, address, label, is_primary, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.chain,
    params.network,
    params.address.toLowerCase(),
    params.label ?? null,
    params.isPrimary ? 1 : 0,
    now
  );
  return {
    id,
    chain: params.chain,
    network: params.network,
    address: params.address.toLowerCase(),
    label: params.label,
    is_primary: params.isPrimary ? 1 : 0,
    created_at: now
  };
}
function getPrimaryWallet(chain, network) {
  const db3 = getDatabase2();
  return db3.prepare(
    "SELECT * FROM wallets WHERE chain = ? AND network = ? AND is_primary = 1"
  ).get(chain, network);
}
function listWallets(params) {
  const db3 = getDatabase2();
  let query = "SELECT * FROM wallets WHERE 1=1";
  const values = [];
  if (params?.chain) {
    query += " AND chain = ?";
    values.push(params.chain);
  }
  if (params?.network) {
    query += " AND network = ?";
    values.push(params.network);
  }
  query += " ORDER BY is_primary DESC, created_at DESC";
  return db3.prepare(query).all(...values);
}
function getLedgerSummary() {
  const db3 = getDatabase2();
  const totalExec = db3.prepare("SELECT COUNT(*) as count FROM executions").get().count;
  const confirmedExec = db3.prepare("SELECT COUNT(*) as count FROM executions WHERE status IN ('confirmed', 'finalized')").get().count;
  const failedExec = db3.prepare("SELECT COUNT(*) as count FROM executions WHERE status = 'failed'").get().count;
  const byChain = db3.prepare(`
    SELECT
      chain,
      COUNT(*) as count,
      SUM(CASE WHEN status IN ('confirmed', 'finalized') THEN 1 ELSE 0 END) as confirmed
    FROM executions
    GROUP BY chain
  `).all();
  const activeSessions = db3.prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'active'").get().count;
  const trackedAssets = db3.prepare("SELECT COUNT(*) as count FROM assets").get().count;
  const registeredWallets = db3.prepare("SELECT COUNT(*) as count FROM wallets").get().count;
  const recentExecutions = listExecutions2({ limit: 10 });
  return {
    totalExecutions: totalExec,
    confirmedExecutions: confirmedExec,
    failedExecutions: failedExec,
    successRate: totalExec > 0 ? confirmedExec / totalExec * 100 : 0,
    byChain,
    activeSessions,
    trackedAssets,
    registeredWallets,
    recentExecutions
  };
}
function getProofBundle() {
  const db3 = getDatabase2();
  const ethTxs = db3.prepare(`
    SELECT tx_hash, explorer_url, action, created_at
    FROM executions
    WHERE chain = 'ethereum' AND tx_hash IS NOT NULL AND status IN ('confirmed', 'finalized')
    ORDER BY created_at DESC
  `).all();
  const solTxs = db3.prepare(`
    SELECT tx_hash, explorer_url, action, created_at
    FROM executions
    WHERE chain = 'solana' AND tx_hash IS NOT NULL AND status IN ('confirmed', 'finalized')
    ORDER BY created_at DESC
  `).all();
  return {
    ethereum: ethTxs.map((tx) => ({
      txHash: tx.tx_hash,
      explorerUrl: tx.explorer_url,
      action: tx.action,
      createdAt: tx.created_at
    })),
    solana: solTxs.map((tx) => ({
      txHash: tx.tx_hash,
      explorerUrl: tx.explorer_url,
      action: tx.action,
      createdAt: tx.created_at
    }))
  };
}
function createExecutionStep(params) {
  const db3 = getDatabase2();
  const id = randomUUID3();
  const now = Math.floor(Date.now() / 1e3);
  db3.prepare(`
    INSERT INTO execution_steps (
      id, execution_id, step_index, action, stage, status, created_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(id, params.executionId, params.stepIndex, params.action, params.stage ?? null, now);
  return {
    id,
    execution_id: params.executionId,
    step_index: params.stepIndex,
    action: params.action,
    stage: params.stage,
    status: "pending",
    created_at: now
  };
}
function updateExecutionStep(id, updates) {
  const db3 = getDatabase2();
  const sets = [];
  const values = [];
  if (updates.status !== void 0) {
    sets.push("status = ?");
    values.push(updates.status);
  }
  if (updates.stage !== void 0) {
    sets.push("stage = ?");
    values.push(updates.stage);
  }
  if (updates.txHash !== void 0) {
    sets.push("tx_hash = ?");
    values.push(updates.txHash);
  }
  if (updates.explorerUrl !== void 0) {
    sets.push("explorer_url = ?");
    values.push(updates.explorerUrl);
  }
  if (updates.errorCode !== void 0) {
    sets.push("error_code = ?");
    values.push(updates.errorCode);
  }
  if (updates.errorMessage !== void 0) {
    sets.push("error_message = ?");
    values.push(updates.errorMessage);
  }
  if (sets.length === 0) return;
  values.push(id);
  db3.prepare(`UPDATE execution_steps SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}
function getExecutionSteps(executionId) {
  const db3 = getDatabase2();
  return db3.prepare(
    "SELECT * FROM execution_steps WHERE execution_id = ? ORDER BY step_index"
  ).all(executionId);
}
function getSummaryStats() {
  const db3 = getDatabase2();
  const totalExec = db3.prepare("SELECT COUNT(*) as count FROM executions").get().count;
  const successExec = db3.prepare("SELECT COUNT(*) as count FROM executions WHERE status IN ('confirmed', 'finalized')").get().count;
  const failedExec = db3.prepare("SELECT COUNT(*) as count FROM executions WHERE status = 'failed'").get().count;
  const usdResult = db3.prepare(`
    SELECT COALESCE(SUM(usd_estimate), 0) as total
    FROM executions
    WHERE status IN ('confirmed', 'finalized') AND usd_estimate IS NOT NULL
  `).get();
  const totalUsdRouted = usdResult.total;
  const relayedCount = db3.prepare(`
    SELECT COUNT(*) as count FROM executions WHERE relayer_address IS NOT NULL
  `).get().count;
  const chainsResult = db3.prepare(`
    SELECT DISTINCT chain FROM executions
  `).all();
  const chainsActive = chainsResult.map((r) => r.chain);
  const byKind = db3.prepare(`
    SELECT
      COALESCE(kind, 'unknown') as kind,
      COUNT(*) as count,
      COALESCE(SUM(CASE WHEN status IN ('confirmed', 'finalized') THEN usd_estimate ELSE 0 END), 0) as usdTotal
    FROM executions
    GROUP BY kind
    ORDER BY count DESC
  `).all();
  const byVenue = db3.prepare(`
    SELECT
      COALESCE(venue, 'unknown') as venue,
      COUNT(*) as count,
      COALESCE(SUM(CASE WHEN status IN ('confirmed', 'finalized') THEN usd_estimate ELSE 0 END), 0) as usdTotal
    FROM executions
    GROUP BY venue
    ORDER BY count DESC
  `).all();
  const byChain = db3.prepare(`
    SELECT
      chain,
      network,
      COUNT(*) as count,
      SUM(CASE WHEN status IN ('confirmed', 'finalized') THEN 1 ELSE 0 END) as successCount,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failedCount
    FROM executions
    GROUP BY chain, network
    ORDER BY count DESC
  `).all();
  const latencyResult = db3.prepare(`
    SELECT AVG(latency_ms) as avgLatency
    FROM executions
    WHERE latency_ms IS NOT NULL
  `).get();
  const avgLatencyMs = latencyResult.avgLatency ?? 0;
  const lastExecResult = db3.prepare(`
    SELECT MAX(created_at) as lastAt FROM executions
  `).get();
  const uniqueWalletsResult = db3.prepare(`
    SELECT COUNT(DISTINCT from_address) as count FROM executions WHERE from_address IS NOT NULL
  `).get();
  const uniqueWallets = uniqueWalletsResult.count;
  const successRateRaw = totalExec > 0 ? successExec / totalExec * 100 : 0;
  const nonInfraFailedExec = db3.prepare(`
    SELECT COUNT(*) as count FROM executions
    WHERE status = 'failed'
    AND error_code NOT IN ('RPC_RATE_LIMITED', 'RPC_UNAVAILABLE', 'RPC_ERROR')
    AND error_code IS NOT NULL
  `).get().count;
  const rpcInfraFailed = failedExec - nonInfraFailedExec;
  const adjustedTotal = totalExec - rpcInfraFailed;
  const successRateAdjusted = adjustedTotal > 0 ? successExec / adjustedTotal * 100 : successRateRaw;
  return {
    totalExecutions: totalExec,
    successfulExecutions: successExec,
    failedExecutions: failedExec,
    successRate: successRateRaw,
    // Legacy field (same as successRateRaw)
    successRateRaw,
    successRateAdjusted,
    uniqueWallets,
    totalUsdRouted,
    relayedTxCount: relayedCount,
    chainsActive,
    byKind,
    byVenue,
    byChain,
    avgLatencyMs: Math.round(avgLatencyMs),
    lastExecutionAt: lastExecResult.lastAt
  };
}
function getRecentExecutions(limit = 20) {
  const db3 = getDatabase2();
  return db3.prepare(`
    SELECT * FROM executions
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}
function createIntent(params) {
  const db3 = getDatabase2();
  const id = randomUUID3();
  const now = Math.floor(Date.now() / 1e3);
  db3.prepare(`
    INSERT INTO intents (
      id, created_at, intent_text, intent_kind, requested_chain, requested_venue,
      usd_estimate, status, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)
  `).run(
    id,
    now,
    params.intentText,
    params.intentKind ?? null,
    params.requestedChain ?? null,
    params.requestedVenue ?? null,
    params.usdEstimate ?? null,
    params.metadataJson ?? null
  );
  return {
    id,
    created_at: now,
    intent_text: params.intentText,
    intent_kind: params.intentKind,
    requested_chain: params.requestedChain,
    requested_venue: params.requestedVenue,
    usd_estimate: params.usdEstimate,
    status: "queued",
    metadata_json: params.metadataJson
  };
}
function updateIntentStatus(id, updates) {
  const db3 = getDatabase2();
  const sets = [];
  const values = [];
  if (updates.status !== void 0) {
    sets.push("status = ?");
    values.push(updates.status);
  }
  if (updates.intentKind !== void 0) {
    sets.push("intent_kind = ?");
    values.push(updates.intentKind);
  }
  if (updates.requestedChain !== void 0) {
    sets.push("requested_chain = ?");
    values.push(updates.requestedChain);
  }
  if (updates.requestedVenue !== void 0) {
    sets.push("requested_venue = ?");
    values.push(updates.requestedVenue);
  }
  if (updates.usdEstimate !== void 0) {
    sets.push("usd_estimate = ?");
    values.push(updates.usdEstimate);
  }
  if (updates.plannedAt !== void 0) {
    sets.push("planned_at = ?");
    values.push(updates.plannedAt);
  }
  if (updates.executedAt !== void 0) {
    sets.push("executed_at = ?");
    values.push(updates.executedAt);
  }
  if (updates.confirmedAt !== void 0) {
    sets.push("confirmed_at = ?");
    values.push(updates.confirmedAt);
  }
  if (updates.failureStage !== void 0) {
    sets.push("failure_stage = ?");
    values.push(updates.failureStage);
  }
  if (updates.errorCode !== void 0) {
    sets.push("error_code = ?");
    values.push(updates.errorCode);
  }
  if (updates.errorMessage !== void 0) {
    sets.push("error_message = ?");
    values.push(updates.errorMessage?.slice(0, 500));
  }
  if (updates.metadataJson !== void 0) {
    sets.push("metadata_json = ?");
    values.push(updates.metadataJson);
  }
  if (sets.length === 0) return;
  values.push(id);
  db3.prepare(`UPDATE intents SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}
function getIntent(id) {
  const db3 = getDatabase2();
  return db3.prepare("SELECT * FROM intents WHERE id = ?").get(id);
}
function getRecentIntents(limit = 50) {
  const db3 = getDatabase2();
  return db3.prepare(`
    SELECT * FROM intents
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}
function getIntentStatsSummary() {
  const db3 = getDatabase2();
  const totalIntents = db3.prepare("SELECT COUNT(*) as count FROM intents").get().count;
  const confirmedIntents = db3.prepare("SELECT COUNT(*) as count FROM intents WHERE status = 'confirmed'").get().count;
  const failedIntents = db3.prepare("SELECT COUNT(*) as count FROM intents WHERE status = 'failed'").get().count;
  const byKind = db3.prepare(`
    SELECT
      COALESCE(intent_kind, 'unknown') as kind,
      COUNT(*) as count,
      SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM intents
    GROUP BY intent_kind
    ORDER BY count DESC
  `).all();
  const byStatus = db3.prepare(`
    SELECT status, COUNT(*) as count
    FROM intents
    GROUP BY status
    ORDER BY count DESC
  `).all();
  const failuresByStage = db3.prepare(`
    SELECT failure_stage as stage, COUNT(*) as count
    FROM intents
    WHERE failure_stage IS NOT NULL
    GROUP BY failure_stage
    ORDER BY count DESC
  `).all();
  const failuresByCode = db3.prepare(`
    SELECT COALESCE(error_code, 'UNKNOWN') as code, COUNT(*) as count
    FROM intents
    WHERE status = 'failed'
    GROUP BY error_code
    ORDER BY count DESC
    LIMIT 10
  `).all();
  const recentIntents = getRecentIntents(10);
  const attemptedIntents = confirmedIntents + failedIntents;
  const intentSuccessRate = attemptedIntents > 0 ? confirmedIntents / attemptedIntents * 100 : 0;
  return {
    totalIntents,
    confirmedIntents,
    failedIntents,
    intentSuccessRate,
    byKind,
    byStatus,
    failuresByStage,
    failuresByCode,
    recentIntents
  };
}
function linkExecutionToIntent(executionId, intentId) {
  const db3 = getDatabase2();
  try {
    db3.exec("ALTER TABLE executions ADD COLUMN intent_id TEXT");
  } catch (e) {
  }
  db3.prepare("UPDATE executions SET intent_id = ? WHERE id = ?").run(intentId, executionId);
}
function getExecutionsForIntent(intentId) {
  const db3 = getDatabase2();
  try {
    return db3.prepare(`
      SELECT * FROM executions
      WHERE intent_id = ?
      ORDER BY created_at DESC
    `).all(intentId);
  } catch (e) {
    return [];
  }
}
function getSummaryStatsWithIntents() {
  const baseStats = getSummaryStats();
  const intentStats = getIntentStatsSummary();
  return {
    ...baseStats,
    totalIntents: intentStats.totalIntents,
    intentSuccessRate: intentStats.intentSuccessRate,
    failedIntentsByStage: intentStats.failuresByStage
  };
}
function createPosition(input) {
  const db3 = getDatabase2();
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1e3);
  db3.prepare(`
    INSERT INTO positions (
      id, chain, network, venue, market, side, leverage,
      margin_units, margin_display, size_units, entry_price,
      status, opened_at, open_tx_hash, open_explorer_url,
      user_address, on_chain_position_id, intent_id, execution_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.chain,
    input.network,
    input.venue,
    input.market,
    input.side,
    input.leverage ?? null,
    input.margin_units ?? null,
    input.margin_display ?? null,
    input.size_units ?? null,
    input.entry_price ?? null,
    now,
    input.open_tx_hash ?? null,
    input.open_explorer_url ?? null,
    input.user_address,
    input.on_chain_position_id ?? null,
    input.intent_id ?? null,
    input.execution_id ?? null,
    now,
    now
  );
  return getPosition(id);
}
function getPosition(id) {
  const db3 = getDatabase2();
  const row = db3.prepare("SELECT * FROM positions WHERE id = ?").get(id);
  return row ?? null;
}
function getPositionByOnChainId(chain, network, venue, onChainPositionId) {
  const db3 = getDatabase2();
  const row = db3.prepare(`
    SELECT * FROM positions
    WHERE chain = ? AND network = ? AND venue = ? AND on_chain_position_id = ?
  `).get(chain, network, venue, onChainPositionId);
  return row ?? null;
}
function updatePosition(id, updates) {
  const db3 = getDatabase2();
  const setClauses = [];
  const values = [];
  for (const [key, value] of Object.entries(updates)) {
    if (value !== void 0) {
      setClauses.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (setClauses.length === 0) return;
  setClauses.push("updated_at = ?");
  values.push(Math.floor(Date.now() / 1e3));
  values.push(id);
  db3.prepare(`UPDATE positions SET ${setClauses.join(", ")} WHERE id = ?`).run(...values);
}
function closePosition(id, closeTxHash, closeExplorerUrl, pnl, status = "closed") {
  const db3 = getDatabase2();
  const now = Math.floor(Date.now() / 1e3);
  db3.prepare(`
    UPDATE positions SET
      status = ?,
      closed_at = ?,
      close_tx_hash = ?,
      close_explorer_url = ?,
      pnl = ?,
      updated_at = ?
    WHERE id = ?
  `).run(status, now, closeTxHash, closeExplorerUrl, pnl ?? null, now, id);
}
function getOpenPositions(filters) {
  const db3 = getDatabase2();
  let sql = "SELECT * FROM positions WHERE status = ?";
  const params = ["open"];
  if (filters?.chain) {
    sql += " AND chain = ?";
    params.push(filters.chain);
  }
  if (filters?.network) {
    sql += " AND network = ?";
    params.push(filters.network);
  }
  if (filters?.venue) {
    sql += " AND venue = ?";
    params.push(filters.venue);
  }
  if (filters?.user_address) {
    sql += " AND user_address = ?";
    params.push(filters.user_address);
  }
  sql += " ORDER BY opened_at DESC";
  return db3.prepare(sql).all(...params);
}
function getRecentPositions(limit = 20) {
  const db3 = getDatabase2();
  return db3.prepare(`
    SELECT * FROM positions
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}
function getPositionsByStatus(status, limit = 50) {
  const db3 = getDatabase2();
  return db3.prepare(`
    SELECT * FROM positions
    WHERE status = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(status, limit);
}
function getPositionStats() {
  const db3 = getDatabase2();
  const total = db3.prepare("SELECT COUNT(*) as count FROM positions").get().count;
  const open = db3.prepare("SELECT COUNT(*) as count FROM positions WHERE status = ?").get("open").count;
  const closed = db3.prepare("SELECT COUNT(*) as count FROM positions WHERE status = ?").get("closed").count;
  const liquidated = db3.prepare("SELECT COUNT(*) as count FROM positions WHERE status = ?").get("liquidated").count;
  const byMarket = db3.prepare(`
    SELECT market, COUNT(*) as count FROM positions
    GROUP BY market ORDER BY count DESC
  `).all();
  return { total, open, closed, liquidated, byMarket };
}
function getIndexerState(chain, network, contractAddress) {
  const db3 = getDatabase2();
  const row = db3.prepare(`
    SELECT * FROM indexer_state
    WHERE chain = ? AND network = ? AND contract_address = ?
  `).get(chain, network, contractAddress);
  return row ?? null;
}
function upsertIndexerState(chain, network, contractAddress, lastIndexedBlock) {
  const db3 = getDatabase2();
  const id = `${chain}:${network}:${contractAddress}`;
  const now = Math.floor(Date.now() / 1e3);
  db3.prepare(`
    INSERT INTO indexer_state (id, chain, network, contract_address, last_indexed_block, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(chain, network, contract_address)
    DO UPDATE SET last_indexed_block = ?, updated_at = ?
  `).run(id, chain, network, contractAddress, lastIndexedBlock, now, lastIndexedBlock, now);
}
function addToWaitlist(params) {
  const db3 = getDatabase2();
  const id = `wl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Math.floor(Date.now() / 1e3);
  db3.exec(`
    CREATE TABLE IF NOT EXISTS waitlist (
      id TEXT PRIMARY KEY,
      email TEXT,
      wallet_address TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      source TEXT DEFAULT 'landing',
      metadata_json TEXT,
      CONSTRAINT email_or_wallet CHECK (email IS NOT NULL OR wallet_address IS NOT NULL)
    )
  `);
  db3.prepare(`
    INSERT INTO waitlist (id, email, wallet_address, created_at, source, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.email || null,
    params.walletAddress || null,
    now,
    params.source || "landing",
    params.metadata ? JSON.stringify(params.metadata) : null
  );
  return id;
}
function getWaitlistEntries(limit = 100) {
  const db3 = getDatabase2();
  return db3.prepare(`
    SELECT * FROM waitlist ORDER BY created_at DESC LIMIT ?
  `).all(limit);
}
function getWaitlistCount() {
  const db3 = getDatabase2();
  const row = db3.prepare("SELECT COUNT(*) as count FROM waitlist").get();
  return row?.count || 0;
}
var __filename4, __dirname4, isVercel, defaultPath, DB_PATH2, db2, dbType, getStatsSummary, getIntentStats;
var init_db2 = __esm({
  "agent/execution-ledger/db.ts"() {
    "use strict";
    init_db_factory();
    init_schema_const();
    __filename4 = fileURLToPath4(import.meta.url);
    __dirname4 = dirname6(__filename4);
    isVercel = process.env.VERCEL === "1";
    defaultPath = isVercel ? "/tmp/ledger.db" : path2.join(__dirname4, "ledger.db");
    DB_PATH2 = process.env.EXECUTION_LEDGER_DB_PATH || defaultPath;
    db2 = null;
    dbType = detectDatabaseType();
    logDatabaseInfo();
    getStatsSummary = getSummaryStats;
    getIntentStats = getIntentStatsSummary;
  }
});

// agent/src/ledger/ledger.ts
var ledger_exports = {};
__export(ledger_exports, {
  buildExplorerUrl: () => buildExplorerUrl,
  closePosition: () => closePosition2,
  createExecutionStep: () => createExecutionStep2,
  createPosition: () => createPosition2,
  getExecutionSteps: () => getExecutionSteps2,
  getIndexerState: () => getIndexerState2,
  getLedgerSummary: () => getLedgerSummary2,
  getOpenPositions: () => getOpenPositions2,
  getPosition: () => getPosition2,
  getPositionByOnChainId: () => getPositionByOnChainId2,
  getPositionStats: () => getPositionStats2,
  getProofBundle: () => getProofBundle2,
  getRecentPositions: () => getRecentPositions2,
  recordExecution: () => recordExecution,
  recordExecutionWithResult: () => recordExecutionWithResult,
  registerWallet: () => registerWallet2,
  updateExecutionStep: () => updateExecutionStep2,
  updateLedgerExecution: () => updateLedgerExecution,
  updatePosition: () => updatePosition2,
  upsertIndexerState: () => upsertIndexerState2
});
async function getLedgerDb() {
  if (!ledgerDb) {
    try {
      ledgerDb = await Promise.resolve().then(() => (init_db2(), db_exports2));
    } catch (error) {
      console.warn("[ledger] Execution ledger DB not available:", error);
      throw error;
    }
  }
  return ledgerDb;
}
async function recordExecution(params) {
  const db3 = await getLedgerDb();
  const exec = db3.createExecution({
    chain: params.chain,
    network: params.network,
    kind: params.kind,
    venue: params.venue,
    intent: params.intent,
    action: params.action,
    fromAddress: params.fromAddress,
    toAddress: params.toAddress,
    token: params.token,
    amountUnits: params.amountUnits,
    amountDisplay: params.amountDisplay,
    usdEstimate: params.usdEstimate,
    usdEstimateIsEstimate: params.usdEstimateIsEstimate,
    relayerAddress: params.relayerAddress,
    sessionId: params.sessionId
  });
  return exec.id;
}
async function updateLedgerExecution(id, updates) {
  const db3 = await getLedgerDb();
  db3.updateExecution(id, updates);
}
async function getLedgerSummary2() {
  const db3 = await getLedgerDb();
  return db3.getLedgerSummary();
}
async function getProofBundle2() {
  const db3 = await getLedgerDb();
  return db3.getProofBundle();
}
async function registerWallet2(params) {
  const db3 = await getLedgerDb();
  return db3.registerWallet(params);
}
function buildExplorerUrl(chain, network, txHash) {
  if (chain === "ethereum") {
    if (network === "sepolia") {
      return `https://sepolia.etherscan.io/tx/${txHash}`;
    } else if (network === "mainnet") {
      return `https://etherscan.io/tx/${txHash}`;
    }
  } else if (chain === "solana") {
    if (network === "devnet") {
      return `https://explorer.solana.com/tx/${txHash}?cluster=devnet`;
    } else if (network === "mainnet") {
      return `https://explorer.solana.com/tx/${txHash}`;
    }
  }
  return "";
}
async function recordExecutionWithResult(params, result) {
  const execId = await recordExecution(params);
  const explorerUrl = result.txHash ? buildExplorerUrl(params.chain, params.network, result.txHash) : void 0;
  await updateLedgerExecution(execId, {
    status: result.success ? "confirmed" : "failed",
    txHash: result.txHash,
    explorerUrl,
    blockNumber: result.blockNumber,
    gasUsed: result.gasUsed,
    latencyMs: result.latencyMs,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage
  });
  return execId;
}
async function createPosition2(params) {
  const db3 = await getLedgerDb();
  return db3.createPosition(params);
}
async function getPosition2(id) {
  const db3 = await getLedgerDb();
  return db3.getPosition(id);
}
async function getPositionByOnChainId2(chain, network, venue, onChainId) {
  const db3 = await getLedgerDb();
  return db3.getPositionByOnChainId(chain, network, venue, onChainId);
}
async function updatePosition2(id, updates) {
  const db3 = await getLedgerDb();
  db3.updatePosition(id, updates);
}
async function closePosition2(id, txHash, explorerUrl, pnl, status = "closed") {
  const db3 = await getLedgerDb();
  db3.closePosition(id, txHash, explorerUrl, pnl, status);
}
async function getOpenPositions2(chain, network) {
  const db3 = await getLedgerDb();
  return db3.getOpenPositions(chain, network);
}
async function getRecentPositions2(limit) {
  const db3 = await getLedgerDb();
  return db3.getRecentPositions(limit);
}
async function getPositionStats2() {
  const db3 = await getLedgerDb();
  return db3.getPositionStats();
}
async function getIndexerState2(chain, network, contractAddress) {
  const db3 = await getLedgerDb();
  return db3.getIndexerState(chain, network, contractAddress);
}
async function upsertIndexerState2(chain, network, contractAddress, lastIndexedBlock) {
  const db3 = await getLedgerDb();
  db3.upsertIndexerState(chain, network, contractAddress, lastIndexedBlock);
}
async function createExecutionStep2(params) {
  const db3 = await getLedgerDb();
  return db3.createExecutionStep(params);
}
async function updateExecutionStep2(id, updates) {
  const db3 = await getLedgerDb();
  db3.updateExecutionStep(id, updates);
}
async function getExecutionSteps2(executionId) {
  const db3 = await getLedgerDb();
  return db3.getExecutionSteps(executionId);
}
var ledgerDb;
var init_ledger = __esm({
  "agent/src/ledger/ledger.ts"() {
    "use strict";
    ledgerDb = null;
  }
});

// agent/src/indexer/perpIndexer.ts
var perpIndexer_exports = {};
__export(perpIndexer_exports, {
  isIndexerRunning: () => isIndexerRunning,
  startPerpIndexer: () => startPerpIndexer,
  stopPerpIndexer: () => stopPerpIndexer,
  triggerIndexerPoll: () => triggerIndexerPoll
});
import { createPublicClient as createPublicClient2, http as http4, parseAbiItem } from "viem";
import { sepolia as sepolia4 } from "viem/chains";
function buildExplorerUrl2(txHash) {
  return `https://sepolia.etherscan.io/tx/${txHash}`;
}
async function processPositionOpened(log, perpEngineAddress, timestamp) {
  try {
    const args = log.args;
    if (!args) return;
    const user = args.user;
    const positionId = args.positionId?.toString() || "0";
    const market = MARKET_MAP[Number(args.market)] || "BTC";
    const side = SIDE_MAP[Number(args.side)] || "long";
    const margin = args.margin?.toString() || "0";
    const size = args.size?.toString() || "0";
    const leverage = Number(args.leverage) || 1;
    const entryPrice = args.entryPrice?.toString() || "0";
    const existing = await getPositionByOnChainId2(
      INDEXER_CONFIG.chain,
      INDEXER_CONFIG.network,
      INDEXER_CONFIG.venue,
      positionId
    );
    if (existing) {
      return;
    }
    const txHash = log.transactionHash || "";
    await createPosition2({
      chain: INDEXER_CONFIG.chain,
      network: INDEXER_CONFIG.network,
      venue: INDEXER_CONFIG.venue,
      market,
      side,
      leverage,
      margin_units: margin,
      margin_display: `${(Number(margin) / 1e6).toFixed(2)} REDACTED`,
      size_units: size,
      entry_price: entryPrice,
      open_tx_hash: txHash,
      open_explorer_url: txHash ? buildExplorerUrl2(txHash) : void 0,
      user_address: user,
      on_chain_position_id: positionId
    });
    console.log(`[indexer] Indexed new position: ${market} ${side} (id=${positionId})`);
  } catch (err) {
    console.error(`[indexer] Error processing PositionOpened:`, err.message);
  }
}
async function processPositionClosed(log) {
  try {
    const args = log.args;
    if (!args) return;
    const positionId = args.positionId?.toString() || "0";
    const pnl = args.pnl?.toString() || "0";
    const position = await getPositionByOnChainId2(
      INDEXER_CONFIG.chain,
      INDEXER_CONFIG.network,
      INDEXER_CONFIG.venue,
      positionId
    );
    if (!position) {
      console.log(`[indexer] Position not found for close event: ${positionId}`);
      return;
    }
    if (position.status !== "open") {
      return;
    }
    const txHash = log.transactionHash || "";
    await closePosition2(
      position.id,
      txHash,
      txHash ? buildExplorerUrl2(txHash) : "",
      pnl,
      "closed"
    );
    console.log(`[indexer] Closed position: ${position.market} ${position.side} (id=${positionId})`);
  } catch (err) {
    console.error(`[indexer] Error processing PositionClosed:`, err.message);
  }
}
async function processLiquidation(log) {
  try {
    const args = log.args;
    if (!args) return;
    const positionId = args.positionId?.toString() || "0";
    const loss = args.loss?.toString() || "0";
    const position = await getPositionByOnChainId2(
      INDEXER_CONFIG.chain,
      INDEXER_CONFIG.network,
      INDEXER_CONFIG.venue,
      positionId
    );
    if (!position) {
      console.log(`[indexer] Position not found for liquidation event: ${positionId}`);
      return;
    }
    if (position.status !== "open") {
      return;
    }
    const txHash = log.transactionHash || "";
    await closePosition2(
      position.id,
      txHash,
      txHash ? buildExplorerUrl2(txHash) : "",
      loss,
      "liquidated"
    );
    console.log(`[indexer] Liquidated position: ${position.market} ${position.side} (id=${positionId})`);
  } catch (err) {
    console.error(`[indexer] Error processing Liquidation:`, err.message);
  }
}
async function indexBlockRange(client, perpEngineAddress, fromBlock, toBlock) {
  const openedLogs = await client.getLogs({
    address: perpEngineAddress,
    event: POSITION_OPENED_ABI,
    fromBlock,
    toBlock
  });
  for (const log of openedLogs) {
    const block = await client.getBlock({ blockNumber: log.blockNumber });
    await processPositionOpened(log, perpEngineAddress, Number(block.timestamp));
  }
  const closedLogs = await client.getLogs({
    address: perpEngineAddress,
    event: POSITION_CLOSED_ABI,
    fromBlock,
    toBlock
  });
  for (const log of closedLogs) {
    await processPositionClosed(log);
  }
  const liquidationLogs = await client.getLogs({
    address: perpEngineAddress,
    event: LIQUIDATION_ABI,
    fromBlock,
    toBlock
  });
  for (const log of liquidationLogs) {
    await processLiquidation(log);
  }
}
async function pollOnce(client, perpEngineAddress) {
  try {
    const currentBlock = await client.getBlockNumber();
    const state = await getIndexerState2(
      INDEXER_CONFIG.chain,
      INDEXER_CONFIG.network,
      perpEngineAddress
    );
    const lastIndexedBlock = state?.last_indexed_block ? BigInt(state.last_indexed_block) : BigInt(INDEXER_CONFIG.startBlock);
    if (lastIndexedBlock >= currentBlock) {
      return;
    }
    const fromBlock = lastIndexedBlock + 1n;
    const maxToBlock = fromBlock + BigInt(INDEXER_CONFIG.maxBlocksPerPoll);
    const toBlock = maxToBlock > currentBlock ? currentBlock : maxToBlock;
    await indexBlockRange(client, perpEngineAddress, fromBlock, toBlock);
    await upsertIndexerState2(
      INDEXER_CONFIG.chain,
      INDEXER_CONFIG.network,
      perpEngineAddress,
      Number(toBlock)
    );
    if (toBlock - fromBlock > 0n) {
      console.log(`[indexer] Indexed blocks ${fromBlock}-${toBlock}`);
    }
  } catch (err) {
    console.error(`[indexer] Poll error:`, err.message?.slice(0, 100));
  }
}
function startPerpIndexer(rpcUrl, perpEngineAddress) {
  if (isRunning) {
    console.log("[indexer] Already running");
    return;
  }
  if (!perpEngineAddress) {
    console.log("[indexer] No perp engine address configured, skipping");
    return;
  }
  console.log("[indexer] Starting perp position indexer");
  console.log(`[indexer] Contract: ${perpEngineAddress}`);
  isRunning = true;
  const client = createPublicClient2({
    chain: sepolia4,
    transport: http4(rpcUrl)
  });
  const poll = async () => {
    if (!isRunning) return;
    await pollOnce(client, perpEngineAddress);
    pollTimeout = setTimeout(poll, INDEXER_CONFIG.pollIntervalMs);
  };
  poll();
}
function stopPerpIndexer() {
  console.log("[indexer] Stopping perp position indexer");
  isRunning = false;
  if (pollTimeout) {
    clearTimeout(pollTimeout);
    pollTimeout = null;
  }
}
function isIndexerRunning() {
  return isRunning;
}
async function triggerIndexerPoll(rpcUrl, perpEngineAddress) {
  const client = createPublicClient2({
    chain: sepolia4,
    transport: http4(rpcUrl)
  });
  await pollOnce(client, perpEngineAddress);
}
var POSITION_OPENED_ABI, POSITION_CLOSED_ABI, LIQUIDATION_ABI, MARKET_MAP, SIDE_MAP, INDEXER_CONFIG, isRunning, pollTimeout;
var init_perpIndexer = __esm({
  "agent/src/indexer/perpIndexer.ts"() {
    "use strict";
    init_ledger();
    POSITION_OPENED_ABI = parseAbiItem(
      "event PositionOpened(address indexed user, uint256 indexed positionId, uint8 market, uint8 side, uint256 margin, uint256 size, uint256 leverage, uint256 entryPrice)"
    );
    POSITION_CLOSED_ABI = parseAbiItem(
      "event PositionClosed(address indexed user, uint256 indexed positionId, uint256 exitPrice, int256 pnl, uint256 marginReturned)"
    );
    LIQUIDATION_ABI = parseAbiItem(
      "event LiquidationTriggered(address indexed user, uint256 indexed positionId, uint256 liquidationPrice, int256 loss)"
    );
    MARKET_MAP = {
      0: "BTC",
      1: "ETH",
      2: "SOL"
    };
    SIDE_MAP = {
      0: "long",
      1: "short"
    };
    INDEXER_CONFIG = {
      chain: "ethereum",
      network: "sepolia",
      venue: "demo_perp",
      pollIntervalMs: 15e3,
      // 15 seconds
      maxBlocksPerPoll: 1e3,
      // Don't index more than 1000 blocks at once
      startBlock: 101e5
      // Start from a recent block (adjust based on deployment)
    };
    isRunning = false;
    pollTimeout = null;
  }
});

// agent/src/bridge/lifi.ts
var lifi_exports = {};
__export(lifi_exports, {
  LiFiErrorCodes: () => LiFiErrorCodes,
  checkLiFiHealth: () => checkLiFiHealth,
  getLiFiChains: () => getLiFiChains,
  getLiFiQuote: () => getLiFiQuote
});
function resolveChainId(chain) {
  const normalized = chain.toLowerCase();
  return CHAIN_IDS[normalized] ?? null;
}
function resolveTokenAddress(token, chain) {
  if (["ETH", "SOL"].includes(token.toUpperCase())) {
    return "0x0000000000000000000000000000000000000000";
  }
  const key = `${token.toUpperCase()}:${chain.toLowerCase()}`;
  if (TOKEN_ADDRESSES[key]) {
    return TOKEN_ADDRESSES[key];
  }
  if (token.startsWith("0x") && token.length === 42) {
    return token;
  }
  return token;
}
async function getLiFiQuote(params) {
  try {
    const fromChainId = resolveChainId(params.fromChain);
    const toChainId = resolveChainId(params.toChain);
    if (!fromChainId) {
      return {
        ok: false,
        error: {
          code: LiFiErrorCodes.LIFI_UNSUPPORTED_CHAIN,
          message: `Unsupported source chain: ${params.fromChain}`
        }
      };
    }
    if (!toChainId) {
      return {
        ok: false,
        error: {
          code: LiFiErrorCodes.LIFI_UNSUPPORTED_CHAIN,
          message: `Unsupported destination chain: ${params.toChain}`
        }
      };
    }
    const fromTokenAddress = resolveTokenAddress(params.fromToken, params.fromChain);
    const toTokenAddress = resolveTokenAddress(params.toToken, params.toChain);
    const queryParams = new URLSearchParams({
      fromChain: fromChainId.toString(),
      toChain: toChainId.toString(),
      fromToken: fromTokenAddress,
      toToken: toTokenAddress,
      fromAmount: params.fromAmount,
      slippage: (params.slippage ?? 5e-3).toString()
    });
    if (params.fromAddress) {
      queryParams.set("fromAddress", params.fromAddress);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1e4);
    try {
      const response = await fetch(`${LIFI_API_BASE}/quote?${queryParams}`, {
        method: "GET",
        headers: {
          "Accept": "application/json"
        },
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (response.status === 429) {
        return {
          ok: false,
          error: {
            code: LiFiErrorCodes.LIFI_RATE_LIMITED,
            message: "LiFi API rate limit exceeded"
          }
        };
      }
      const data = await response.json();
      if (!response.ok) {
        const errorMessage = data.message || data.error || "Quote request failed";
        let errorCode = LiFiErrorCodes.LIFI_QUOTE_FAILED;
        if (errorMessage.toLowerCase().includes("no route")) {
          errorCode = LiFiErrorCodes.LIFI_NO_ROUTE;
        } else if (errorMessage.toLowerCase().includes("invalid")) {
          errorCode = LiFiErrorCodes.LIFI_INVALID_PARAMS;
        }
        return {
          ok: false,
          error: {
            code: errorCode,
            message: errorMessage.slice(0, 200)
          }
        };
      }
      const quote = data;
      return {
        ok: true,
        quote: {
          id: quote.id || "unknown",
          type: quote.type || "BRIDGE",
          tool: quote.tool || quote.toolDetails?.name || "unknown",
          toolDetails: quote.toolDetails || { name: "unknown", logoURI: "" },
          fromChain: fromChainId,
          toChain: toChainId,
          fromToken: {
            address: quote.action?.fromToken?.address || fromTokenAddress,
            symbol: quote.action?.fromToken?.symbol || params.fromToken,
            decimals: quote.action?.fromToken?.decimals || 18
          },
          toToken: {
            address: quote.action?.toToken?.address || toTokenAddress,
            symbol: quote.action?.toToken?.symbol || params.toToken,
            decimals: quote.action?.toToken?.decimals || 18
          },
          fromAmount: quote.action?.fromAmount || params.fromAmount,
          toAmount: quote.estimate?.toAmount || "0",
          toAmountMin: quote.estimate?.toAmountMin || "0",
          estimatedDuration: quote.estimate?.executionDuration || 300,
          feeCosts: quote.estimate?.feeCosts || [],
          gasCosts: quote.estimate?.gasCosts || []
        }
      };
    } catch (fetchError) {
      clearTimeout(timeout);
      if (fetchError.name === "AbortError") {
        return {
          ok: false,
          error: {
            code: LiFiErrorCodes.LIFI_UNREACHABLE,
            message: "LiFi API request timed out"
          }
        };
      }
      throw fetchError;
    }
  } catch (error) {
    return {
      ok: false,
      error: {
        code: LiFiErrorCodes.LIFI_UNREACHABLE,
        message: `LiFi API error: ${error.message?.slice(0, 150) || "Unknown error"}`
      }
    };
  }
}
async function checkLiFiHealth() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5e3);
    const response = await fetch(`${LIFI_API_BASE}/chains`, {
      method: "GET",
      signal: controller.signal
    });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}
async function getLiFiChains() {
  try {
    const response = await fetch(`${LIFI_API_BASE}/chains`, {
      method: "GET",
      headers: { "Accept": "application/json" }
    });
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    return (data.chains || []).map((c) => ({
      id: c.id,
      name: c.name,
      key: c.key
    }));
  } catch {
    return [];
  }
}
var LIFI_API_BASE, CHAIN_IDS, TOKEN_ADDRESSES, LiFiErrorCodes;
var init_lifi = __esm({
  "agent/src/bridge/lifi.ts"() {
    "use strict";
    LIFI_API_BASE = "https://li.quest/v1";
    CHAIN_IDS = {
      ethereum: 1,
      sepolia: 11155111,
      solana: 1151111081099710,
      // LiFi's Solana chain ID
      arbitrum: 42161,
      optimism: 10,
      polygon: 137,
      base: 8453
    };
    TOKEN_ADDRESSES = {
      // Ethereum mainnet
      "REDACTED:ethereum": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      "USDT:ethereum": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      "WETH:ethereum": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      // Sepolia testnet
      "REDACTED:sepolia": "0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8",
      "WETH:sepolia": "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"
    };
    LiFiErrorCodes = {
      LIFI_UNREACHABLE: "LIFI_UNREACHABLE",
      LIFI_NO_ROUTE: "LIFI_NO_ROUTE",
      LIFI_QUOTE_FAILED: "LIFI_QUOTE_FAILED",
      LIFI_INVALID_PARAMS: "LIFI_INVALID_PARAMS",
      LIFI_RATE_LIMITED: "LIFI_RATE_LIMITED",
      LIFI_UNSUPPORTED_CHAIN: "LIFI_UNSUPPORTED_CHAIN"
    };
  }
});

// agent/src/solana/solanaClient.ts
var solanaClient_exports = {};
__export(solanaClient_exports, {
  SolanaClient: () => SolanaClient,
  createSolanaClient: () => createSolanaClient,
  default: () => solanaClient_default
});
function createSolanaClient(rpcUrl) {
  return new SolanaClient({ rpcUrl });
}
var DEFAULT_DEVNET_RPC, SolanaClient, solanaClient_default;
var init_solanaClient = __esm({
  "agent/src/solana/solanaClient.ts"() {
    "use strict";
    DEFAULT_DEVNET_RPC = "https://api.devnet.solana.com";
    SolanaClient = class {
      rpcUrl;
      constructor(config3 = {}) {
        this.rpcUrl = config3.rpcUrl || process.env.SOLANA_RPC_URL || DEFAULT_DEVNET_RPC;
      }
      /**
       * Make an RPC call to Solana
       */
      async rpcCall(method, params = []) {
        const response = await fetch(this.rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method,
            params
          })
        });
        const data = await response.json();
        if (data.error) {
          throw new Error(`Solana RPC error: ${data.error.message}`);
        }
        return data.result;
      }
      /**
       * Get SOL balance for a public key
       */
      async getBalance(pubkey) {
        const result = await this.rpcCall("getBalance", [pubkey]);
        const lamports = result.value;
        return {
          lamports,
          sol: lamports / 1e9
          // Convert lamports to SOL
        };
      }
      /**
       * Get recent blockhash for transaction signing
       */
      async getRecentBlockhash() {
        const result = await this.rpcCall("getLatestBlockhash", [{ commitment: "finalized" }]);
        return result.value;
      }
      /**
       * Send a signed transaction (base64 encoded)
       */
      async sendTransaction(signedTx, options = {}) {
        const { encoding = "base64", skipPreflight = false } = options;
        const signature = await this.rpcCall("sendTransaction", [
          signedTx,
          {
            encoding,
            skipPreflight,
            preflightCommitment: "confirmed"
          }
        ]);
        return signature;
      }
      /**
       * Get transaction status
       */
      async getSignatureStatuses(signatures) {
        const result = await this.rpcCall("getSignatureStatuses", [signatures, { searchTransactionHistory: true }]);
        return result.value;
      }
      /**
       * Confirm a transaction with timeout
       */
      async confirmTransaction(signature, commitment = "confirmed", timeoutMs = 3e4) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const statuses = await this.getSignatureStatuses([signature]);
          const status = statuses[0];
          if (status) {
            if (status.err) {
              throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
            }
            const commitmentLevels = ["processed", "confirmed", "finalized"];
            const targetLevel = commitmentLevels.indexOf(commitment);
            const currentLevel = status.confirmationStatus ? commitmentLevels.indexOf(status.confirmationStatus) : -1;
            if (currentLevel >= targetLevel) {
              return {
                signature,
                slot: status.slot,
                confirmationStatus: status.confirmationStatus || void 0
              };
            }
          }
          await new Promise((resolve3) => setTimeout(resolve3, 1e3));
        }
        throw new Error(`Transaction confirmation timeout after ${timeoutMs}ms`);
      }
      /**
       * Request airdrop (devnet only)
       */
      async requestAirdrop(pubkey, lamports = 1e9) {
        const signature = await this.rpcCall("requestAirdrop", [pubkey, lamports]);
        return signature;
      }
      /**
       * Get account info
       */
      async getAccountInfo(pubkey) {
        const result = await this.rpcCall("getAccountInfo", [pubkey, { encoding: "base64" }]);
        if (!result.value) return null;
        return {
          lamports: result.value.lamports,
          owner: result.value.owner,
          data: result.value.data[0],
          executable: result.value.executable
        };
      }
      /**
       * Get cluster info
       */
      async getClusterNodes() {
        return this.rpcCall("getClusterNodes", []);
      }
      /**
       * Get slot
       */
      async getSlot() {
        return this.rpcCall("getSlot", []);
      }
      /**
       * Health check
       */
      async isHealthy() {
        try {
          await this.getSlot();
          return true;
        } catch {
          return false;
        }
      }
    };
    solanaClient_default = SolanaClient;
  }
});

// agent/src/intent/intentRunner.ts
var intentRunner_exports = {};
__export(intentRunner_exports, {
  executeIntentById: () => executeIntentById,
  parseIntent: () => parseIntent,
  recordFailedIntent: () => recordFailedIntent,
  routeIntent: () => routeIntent,
  runIntent: () => runIntent,
  runIntentBatch: () => runIntentBatch
});
function mergeMetadata(existingJson, newData) {
  let existing = {};
  try {
    existing = JSON.parse(existingJson || "{}");
  } catch {
  }
  const PRESERVED_KEYS = ["source", "domain", "runId", "category", "timestamp", "userAgent"];
  const preserved = {};
  for (const key of PRESERVED_KEYS) {
    if (existing[key] !== void 0) {
      preserved[key] = existing[key];
    }
  }
  return JSON.stringify({ ...preserved, ...newData });
}
function parseIntent(intentText) {
  const text = intentText.toLowerCase().trim();
  const rawParams = { original: intentText };
  if (INTENT_PATTERNS.hedge.basic.test(text) || INTENT_PATTERNS.hedge.protect.test(text)) {
    return {
      kind: "unknown",
      // Will be routed as proof_only with special handling
      action: "hedge",
      rawParams: { ...rawParams, intentType: "hedge", requiresPortfolio: true }
    };
  }
  if (INTENT_PATTERNS.prediction.market.test(text) || INTENT_PATTERNS.prediction.bet.test(text) && INTENT_PATTERNS.prediction.volume.test(text)) {
    return {
      kind: "unknown",
      // Will be routed as proof_only with special handling
      action: "prediction_bet",
      rawParams: { ...rawParams, intentType: "prediction", requiresMarketData: true }
    };
  }
  if (INTENT_PATTERNS.vault.discovery.test(text)) {
    const yieldMatch = text.match(INTENT_PATTERNS.vault.yield);
    const targetYield = yieldMatch ? parseFloat(yieldMatch[1]) : void 0;
    return {
      kind: "deposit",
      // Route to deposit flow, but needs discovery first
      action: "vault_discovery",
      rawParams: { ...rawParams, intentType: "vault_discovery", targetYield, requiresYieldRanking: true }
    };
  }
  const longMatch = text.match(INTENT_PATTERNS.perp.long);
  const shortMatch = text.match(INTENT_PATTERNS.perp.short);
  if (longMatch || shortMatch) {
    const match = longMatch || shortMatch;
    const side = longMatch ? "long" : "short";
    const asset = match[1].toUpperCase();
    const leverageMatch = text.match(INTENT_PATTERNS.perp.leverage);
    const leverage = leverageMatch ? parseInt(leverageMatch[1]) : 10;
    const amountMatch = text.match(INTENT_PATTERNS.perp.withAmount);
    const amount = amountMatch ? amountMatch[1].replace(/,/g, "") : void 0;
    return {
      kind: "perp",
      action: side,
      amount,
      amountUnit: "REDACTED",
      // Assume REDACTED for perp margin
      targetAsset: asset,
      leverage,
      rawParams: { ...rawParams, side, asset, leverage, amount }
    };
  }
  for (const [name, pattern] of Object.entries(INTENT_PATTERNS.swap)) {
    const match = text.match(pattern);
    if (match) {
      const amount = match[1]?.replace(/,/g, "") || "1000";
      const fromAsset = match[2].toUpperCase();
      const toAsset = match[3].toUpperCase();
      return {
        kind: "swap",
        action: "swap",
        amount,
        amountUnit: fromAsset,
        targetAsset: toAsset,
        rawParams: { ...rawParams, amount, fromAsset, toAsset }
      };
    }
  }
  for (const [name, pattern] of Object.entries(INTENT_PATTERNS.deposit)) {
    const match = text.match(pattern);
    if (match) {
      const amount = match[1]?.replace(/,/g, "") || "1000";
      const asset = match[2].toUpperCase();
      const venue = match[3]?.toLowerCase() || "vault";
      return {
        kind: "deposit",
        action: "deposit",
        amount,
        amountUnit: asset,
        venue,
        rawParams: { ...rawParams, amount, asset, venue }
      };
    }
  }
  for (const [name, pattern] of Object.entries(INTENT_PATTERNS.bridge)) {
    const match = text.match(pattern);
    if (match) {
      const amount = match[1]?.replace(/,/g, "") || "1000";
      const asset = match[2].toUpperCase();
      const sourceChain = match[3].toLowerCase();
      const destChain = match[4].toLowerCase();
      return {
        kind: "bridge",
        action: "bridge",
        amount,
        amountUnit: asset,
        sourceChain: sourceChain === "eth" ? "ethereum" : sourceChain,
        destChain: destChain === "sol" ? "solana" : destChain,
        rawParams: { ...rawParams, amount, asset, sourceChain, destChain }
      };
    }
  }
  if (INTENT_PATTERNS.analytics.exposure.test(text) || INTENT_PATTERNS.analytics.risk.test(text)) {
    return {
      kind: "unknown",
      action: "analytics_exposure",
      rawParams: { ...rawParams, intentType: "analytics", analyticsType: "exposure" }
    };
  }
  if (INTENT_PATTERNS.analytics.topProtocols.test(text)) {
    return {
      kind: "unknown",
      action: "analytics_protocols",
      rawParams: { ...rawParams, intentType: "analytics", analyticsType: "top_protocols" }
    };
  }
  if (INTENT_PATTERNS.analytics.topMarkets.test(text)) {
    return {
      kind: "unknown",
      action: "analytics_markets",
      rawParams: { ...rawParams, intentType: "analytics", analyticsType: "top_markets" }
    };
  }
  return {
    kind: "unknown",
    action: "proof",
    rawParams
  };
}
function routeIntent(parsed, preferredChain) {
  const { kind, venue, sourceChain, destChain, rawParams } = parsed;
  let targetChain = "ethereum";
  if (preferredChain === "solana") {
    targetChain = "solana";
  } else if (kind === "bridge") {
    if (sourceChain === "solana") {
      targetChain = "solana";
    }
  }
  const network = targetChain === "ethereum" ? "sepolia" : "devnet";
  if (rawParams?.intentType === "hedge") {
    return {
      chain: targetChain,
      network,
      venue: "native",
      executionType: "proof_only",
      warnings: [
        "PROOF_ONLY: Hedge intent requires portfolio state integration.",
        "Portfolio ingestion not yet implemented - recording intent proof on-chain."
      ]
    };
  }
  if (rawParams?.intentType === "prediction") {
    return {
      chain: targetChain,
      network,
      venue: "native",
      executionType: "proof_only",
      warnings: [
        "PROOF_ONLY: Prediction market intent requires market data integration.",
        "Polymarket/prediction data source not yet integrated - recording intent proof on-chain."
      ]
    };
  }
  if (rawParams?.intentType === "vault_discovery") {
    return {
      chain: targetChain,
      network,
      venue: "native",
      executionType: "proof_only",
      warnings: [
        "PROOF_ONLY: Vault discovery requires yield ranking integration.",
        "DefiLlama/yield sources not yet integrated - recording intent proof on-chain.",
        `Target yield: ${rawParams.targetYield || "not specified"}%`
      ]
    };
  }
  if (rawParams?.intentType === "analytics") {
    return {
      chain: targetChain,
      network,
      venue: "offchain",
      executionType: "offchain",
      // Special handling for analytics
      warnings: [
        "OFFCHAIN: Analytics intent - no on-chain action required.",
        `Analysis type: ${rawParams.analyticsType || "general"}`
      ]
    };
  }
  const implementedVenues = IMPLEMENTED_VENUES[targetChain][kind] || [];
  if (kind === "perp") {
    const requestedVenue = venue?.toLowerCase();
    if (requestedVenue && ["drift", "hl", "hyperliquid", "dydx"].includes(requestedVenue)) {
      return {
        error: {
          stage: "route",
          code: "VENUE_NOT_IMPLEMENTED",
          message: `Perp venue "${requestedVenue}" is not yet integrated. Recording as proof-only.`
        }
      };
    }
    const demoPerpAdapter = process.env.DEMO_PERP_ADAPTER_ADDRESS;
    if (demoPerpAdapter && targetChain === "ethereum") {
      return {
        chain: "ethereum",
        network: "sepolia",
        venue: "demo_perp",
        adapter: demoPerpAdapter,
        executionType: "real"
      };
    }
    return {
      chain: targetChain,
      network,
      venue: "demo_perp",
      executionType: "proof_only",
      warnings: ["PROOF_ONLY: DemoPerpAdapter not configured. Recording intent proof on-chain."]
    };
  }
  if (kind === "bridge") {
    if (sourceChain && destChain && sourceChain !== destChain) {
      return {
        chain: targetChain,
        network,
        venue: "lifi",
        executionType: "proof_only",
        warnings: ["Bridge execution not fully implemented. Will attempt LiFi quote."]
      };
    }
  }
  if (kind === "deposit") {
    const requestedVenue = venue?.toLowerCase();
    if (requestedVenue && ["kamino", "drift"].includes(requestedVenue)) {
      return {
        chain: targetChain,
        network,
        venue: requestedVenue,
        executionType: "proof_only",
        warnings: [
          `PROOF_ONLY: Deposit venue "${requestedVenue}" is not yet integrated.`,
          "Recording intent proof on-chain."
        ]
      };
    }
    if (requestedVenue === "aave" && targetChain === "ethereum") {
      return {
        chain: "ethereum",
        network: "sepolia",
        venue: "aave",
        executionType: "real"
      };
    }
    if (targetChain === "solana") {
      return {
        chain: "solana",
        network: "devnet",
        venue: "solana_vault",
        executionType: "proof_only",
        warnings: ["PROOF_ONLY: Solana vault integration pending. Recording intent proof on-chain."]
      };
    }
    return {
      chain: targetChain,
      network,
      venue: "demo_vault",
      executionType: "real"
    };
  }
  if (kind === "swap") {
    if (targetChain === "solana") {
      return {
        chain: "solana",
        network: "devnet",
        venue: "demo_dex",
        executionType: "proof_only",
        warnings: ["PROOF_ONLY: Solana swap integration pending. Recording intent proof on-chain."]
      };
    }
    return {
      chain: targetChain,
      network,
      venue: "demo_dex",
      executionType: "real"
    };
  }
  return {
    chain: targetChain,
    network,
    venue: "native",
    executionType: "proof_only",
    warnings: ["Intent not recognized. Recording proof-of-execution only."]
  };
}
function estimateIntentUsd(parsed) {
  const amount = parsed.amount ? parseFloat(parsed.amount) : void 0;
  if (!amount) return void 0;
  const unit = parsed.amountUnit?.toUpperCase();
  const prices = {
    REDACTED: 1,
    USDT: 1,
    DAI: 1,
    ETH: 2e3,
    WETH: 2e3,
    SOL: 100,
    BTC: 45e3
  };
  return amount * (prices[unit || ""] || 1);
}
async function runIntent(intentText, options = {}) {
  const {
    createIntent: createIntent2,
    updateIntentStatus: updateIntentStatus2,
    createExecution: createExecution3,
    updateExecution: updateExecution3,
    createExecutionStep: createExecutionStep3,
    updateExecutionStep: updateExecutionStep3,
    linkExecutionToIntent: linkExecutionToIntent2
  } = await Promise.resolve().then(() => (init_db2(), db_exports2));
  const now = Math.floor(Date.now() / 1e3);
  const parsed = parseIntent(intentText);
  const usdEstimate = estimateIntentUsd(parsed);
  const callerMeta = options.metadata || {};
  const buildMetadata = (extra = {}) => JSON.stringify({
    ...callerMeta,
    // Always include caller metadata (source, domain, runId, etc.)
    parsed,
    ...extra
  });
  const intent = createIntent2({
    intentText,
    intentKind: parsed.kind,
    requestedVenue: parsed.venue,
    usdEstimate,
    metadataJson: buildMetadata({ options: { ...options, metadata: void 0 } })
  });
  try {
    updateIntentStatus2(intent.id, {
      status: "planned",
      plannedAt: now,
      metadataJson: buildMetadata({ options: { ...options, metadata: void 0 } })
    });
    const route = routeIntent(parsed, options.chain);
    if ("error" in route) {
      updateIntentStatus2(intent.id, {
        status: "failed",
        failureStage: route.error.stage,
        errorCode: route.error.code,
        errorMessage: route.error.message
      });
      return {
        ok: false,
        intentId: intent.id,
        status: "failed",
        error: route.error
      };
    }
    updateIntentStatus2(intent.id, {
      status: "routed",
      requestedChain: route.chain,
      requestedVenue: route.venue,
      metadataJson: buildMetadata({ route, options: { ...options, metadata: void 0 } })
    });
    if (parsed.kind === "bridge" && route.venue === "lifi") {
      const bridgeResult = await handleBridgeIntent(intent.id, parsed, route);
      return bridgeResult;
    }
    updateIntentStatus2(intent.id, {
      status: "executing",
      executedAt: now
    });
    if (options.planOnly || options.dryRun) {
      updateIntentStatus2(intent.id, {
        status: "planned",
        plannedAt: now,
        metadataJson: buildMetadata({
          route,
          planOnly: true,
          executedKind: route.executionType
        })
      });
      return {
        ok: true,
        intentId: intent.id,
        status: "planned",
        metadata: {
          planOnly: true,
          executedKind: route.executionType,
          parsed: {
            kind: parsed.kind,
            action: parsed.action,
            amount: parsed.amount,
            amountUnit: parsed.amountUnit,
            targetAsset: parsed.targetAsset,
            leverage: parsed.leverage
          },
          route: {
            chain: route.chain,
            network: route.network,
            venue: route.venue,
            executionType: route.executionType,
            warnings: route.warnings
          }
        }
      };
    }
    const execResult = await executeOnChain(intent.id, parsed, route);
    return execResult;
  } catch (error) {
    updateIntentStatus2(intent.id, {
      status: "failed",
      failureStage: "execute",
      errorCode: "EXECUTION_ERROR",
      errorMessage: error.message?.slice(0, 500)
    });
    return {
      ok: false,
      intentId: intent.id,
      status: "failed",
      error: {
        stage: "execute",
        code: "EXECUTION_ERROR",
        message: error.message
      }
    };
  }
}
async function executeIntentById(intentId) {
  const {
    getIntent: getIntent2,
    updateIntentStatus: updateIntentStatus2
  } = await Promise.resolve().then(() => (init_db2(), db_exports2));
  const now = Math.floor(Date.now() / 1e3);
  const intent = getIntent2(intentId);
  if (!intent) {
    return {
      ok: false,
      intentId,
      status: "failed",
      error: {
        stage: "execute",
        code: "INTENT_NOT_FOUND",
        message: `Intent ${intentId} not found`
      }
    };
  }
  if (intent.status !== "planned") {
    return {
      ok: false,
      intentId,
      status: "failed",
      error: {
        stage: "execute",
        code: "INVALID_STATUS",
        message: `Intent is in ${intent.status} status, expected 'planned'`
      }
    };
  }
  try {
    const metadata = JSON.parse(intent.metadata_json || "{}");
    const parsed = metadata.parsed;
    const route = metadata.route;
    if (!parsed || !route) {
      return {
        ok: false,
        intentId,
        status: "failed",
        error: {
          stage: "execute",
          code: "INVALID_METADATA",
          message: "Intent missing parsed or route metadata"
        }
      };
    }
    updateIntentStatus2(intentId, {
      status: "executing",
      executedAt: now
    });
    if (parsed.kind === "bridge" && route.venue === "lifi") {
      const bridgeResult = await handleBridgeIntent(intentId, parsed, route);
      return bridgeResult;
    }
    const execResult = await executeOnChain(intentId, parsed, route);
    return execResult;
  } catch (error) {
    updateIntentStatus2(intentId, {
      status: "failed",
      failureStage: "execute",
      errorCode: "EXECUTION_ERROR",
      errorMessage: error.message?.slice(0, 500)
    });
    return {
      ok: false,
      intentId,
      status: "failed",
      error: {
        stage: "execute",
        code: "EXECUTION_ERROR",
        message: error.message
      }
    };
  }
}
async function handleBridgeIntent(intentId, parsed, route) {
  const {
    updateIntentStatus: updateIntentStatus2,
    createExecution: createExecution3,
    updateExecution: updateExecution3,
    linkExecutionToIntent: linkExecutionToIntent2
  } = await Promise.resolve().then(() => (init_db2(), db_exports2));
  const { buildExplorerUrl: buildExplorerUrl3 } = await Promise.resolve().then(() => (init_ledger(), ledger_exports));
  const { getLiFiQuote: getLiFiQuote2 } = await Promise.resolve().then(() => (init_lifi(), lifi_exports));
  const now = Math.floor(Date.now() / 1e3);
  const quoteResult = await getLiFiQuote2({
    fromChain: parsed.sourceChain || "ethereum",
    toChain: parsed.destChain || "solana",
    fromToken: parsed.amountUnit || "REDACTED",
    toToken: parsed.amountUnit || "REDACTED",
    fromAmount: (BigInt(parsed.amount || "1000") * BigInt(10 ** 6)).toString()
  });
  const quoteMetadata = quoteResult.ok ? { quoteSuccess: true, tool: quoteResult.quote?.tool, toAmount: quoteResult.quote?.toAmount } : { quoteSuccess: false, error: quoteResult.error };
  const sourceProofResult = await executeProofOnly(intentId, {
    ...parsed,
    rawParams: {
      ...parsed.rawParams,
      original: `BRIDGE_INTENT_PROOF: ${parsed.rawParams.original} | quote: ${quoteResult.ok ? "success" : "failed"}`
    }
  }, {
    ...route,
    chain: "ethereum",
    network: "sepolia"
  });
  let destProofResult = null;
  if (sourceProofResult.ok && (parsed.destChain === "solana" || parsed.destChain === "sol")) {
    try {
      const destRoute = {
        chain: "solana",
        network: "devnet",
        venue: "bridge_proof",
        executionType: "proof_only"
      };
      destProofResult = await executeProofOnlySolana(intentId, {
        ...parsed,
        rawParams: {
          ...parsed.rawParams,
          original: `BRIDGE_DEST_PROOF: ${parsed.rawParams.original}`
        }
      }, destRoute);
    } catch (e) {
      console.warn("[bridge] Dest chain proof failed:", e);
    }
  }
  if (sourceProofResult.ok) {
    updateIntentStatus2(intentId, {
      status: "confirmed",
      confirmedAt: Math.floor(Date.now() / 1e3),
      metadataJson: JSON.stringify({
        parsed,
        route,
        executedKind: "proof_only",
        quoteMetadata,
        sourceChainProof: {
          txHash: sourceProofResult.txHash,
          explorerUrl: sourceProofResult.explorerUrl
        },
        destChainProof: destProofResult?.ok ? {
          txHash: destProofResult.txHash,
          explorerUrl: destProofResult.explorerUrl
        } : null,
        note: "Bridge execution not wired - proof txs recorded on-chain"
      })
    });
    return {
      ok: true,
      intentId,
      status: "confirmed",
      executionId: sourceProofResult.executionId,
      txHash: sourceProofResult.txHash,
      explorerUrl: sourceProofResult.explorerUrl,
      metadata: {
        executedKind: "proof_only",
        quoteMetadata,
        destChainProof: destProofResult?.ok ? {
          txHash: destProofResult.txHash,
          explorerUrl: destProofResult.explorerUrl
        } : null
      }
    };
  }
  return sourceProofResult;
}
async function executeOnChain(intentId, parsed, route) {
  const {
    updateIntentStatus: updateIntentStatus2,
    createExecution: createExecution3,
    updateExecution: updateExecution3,
    linkExecutionToIntent: linkExecutionToIntent2
  } = await Promise.resolve().then(() => (init_db2(), db_exports2));
  const now = Math.floor(Date.now() / 1e3);
  if (route.executionType === "offchain") {
    return await executeOffchain(intentId, parsed, route);
  }
  if (route.executionType === "proof_only") {
    return await executeProofOnly(intentId, parsed, route);
  }
  if (parsed.kind === "perp" && route.executionType === "real" && route.chain === "ethereum") {
    return await executePerpEthereum(intentId, parsed, route);
  }
  if (route.chain === "ethereum") {
    return await executeEthereum(intentId, parsed, route);
  } else {
    return await executeSolana(intentId, parsed, route);
  }
}
async function executeOffchain(intentId, parsed, route) {
  const {
    updateIntentStatus: updateIntentStatus2,
    createExecution: createExecution3,
    linkExecutionToIntent: linkExecutionToIntent2
  } = await Promise.resolve().then(() => (init_db2(), db_exports2));
  const now = Math.floor(Date.now() / 1e3);
  const analyticsType = parsed.rawParams?.analyticsType || "general";
  const execution = createExecution3({
    chain: route.chain,
    network: route.network,
    kind: "proof",
    // Use 'proof' kind but mark as offchain in metadata
    venue: "offchain",
    intent: parsed.rawParams?.original || "Analytics intent",
    action: parsed.action,
    fromAddress: "offchain",
    usdEstimate: 0,
    usdEstimateIsEstimate: true
  });
  linkExecutionToIntent2(execution.id, intentId);
  updateIntentStatus2(intentId, {
    status: "confirmed",
    confirmedAt: now,
    metadataJson: JSON.stringify({
      parsed,
      route,
      executedKind: "offchain",
      executionId: execution.id,
      analyticsType,
      note: "Analytics-only intent. No on-chain action required.",
      warnings: route.warnings
    })
  });
  return {
    ok: true,
    intentId,
    status: "confirmed",
    executionId: execution.id,
    metadata: {
      executedKind: "offchain",
      analyticsType,
      note: "Analytics-only intent. No on-chain action required.",
      warnings: route.warnings
    }
  };
}
async function executePerpEthereum(intentId, parsed, route) {
  const {
    getIntent: getIntent2,
    updateIntentStatus: updateIntentStatus2,
    createExecution: createExecution3,
    updateExecution: updateExecution3,
    linkExecutionToIntent: linkExecutionToIntent2
  } = await Promise.resolve().then(() => (init_db2(), db_exports2));
  const { buildExplorerUrl: buildExplorerUrl3 } = await Promise.resolve().then(() => (init_ledger(), ledger_exports));
  const now = Math.floor(Date.now() / 1e3);
  const startTime = Date.now();
  const intent = getIntent2(intentId);
  const existingMetadataJson = intent?.metadata_json;
  const {
    RELAYER_PRIVATE_KEY: RELAYER_PRIVATE_KEY2,
    ETH_TESTNET_RPC_URL: ETH_TESTNET_RPC_URL2,
    DEMO_PERP_ADAPTER_ADDRESS: DEMO_PERP_ADAPTER_ADDRESS2,
    DEMO_REDACTED_ADDRESS: DEMO_REDACTED_ADDRESS2,
    EXECUTION_ROUTER_ADDRESS: EXECUTION_ROUTER_ADDRESS2,
    ERC20_PULL_ADAPTER_ADDRESS: ERC20_PULL_ADAPTER_ADDRESS2
  } = await Promise.resolve().then(() => (init_config(), config_exports));
  if (!RELAYER_PRIVATE_KEY2 || !ETH_TESTNET_RPC_URL2) {
    updateIntentStatus2(intentId, {
      status: "failed",
      failureStage: "execute",
      errorCode: "CONFIG_MISSING",
      errorMessage: "Relayer key or RPC not configured"
    });
    return {
      ok: false,
      intentId,
      status: "failed",
      error: {
        stage: "execute",
        code: "CONFIG_MISSING",
        message: "Relayer key or RPC not configured"
      }
    };
  }
  if (!DEMO_PERP_ADAPTER_ADDRESS2 || !DEMO_REDACTED_ADDRESS2 || !EXECUTION_ROUTER_ADDRESS2) {
    updateIntentStatus2(intentId, {
      status: "failed",
      failureStage: "execute",
      errorCode: "PERP_CONFIG_MISSING",
      errorMessage: "DemoPerpAdapter or DEMO_REDACTED not configured"
    });
    return {
      ok: false,
      intentId,
      status: "failed",
      error: {
        stage: "execute",
        code: "PERP_CONFIG_MISSING",
        message: "DemoPerpAdapter or DEMO_REDACTED not configured"
      }
    };
  }
  try {
    const { encodeFunctionData, parseAbi } = await import("viem");
    const { privateKeyToAccount: privateKeyToAccount3 } = await import("viem/accounts");
    const {
      createFailoverPublicClient: createFailoverPublicClient2,
      createFailoverWalletClient: createFailoverWalletClient2,
      executeWithFailover: executeWithFailover2
    } = await Promise.resolve().then(() => (init_rpcProvider(), rpcProvider_exports));
    const account = privateKeyToAccount3(RELAYER_PRIVATE_KEY2);
    const publicClient = createFailoverPublicClient2();
    const walletClient = createFailoverWalletClient2(account);
    const execution = createExecution3({
      chain: "ethereum",
      network: "sepolia",
      kind: "perp",
      venue: "demo_perp",
      intent: parsed.rawParams.original || "Perp position",
      action: parsed.action,
      fromAddress: account.address,
      token: "DEMO_REDACTED",
      amountDisplay: parsed.amount ? `${parsed.amount} REDACTED @ ${parsed.leverage}x` : void 0,
      usdEstimate: estimateIntentUsd(parsed),
      usdEstimateIsEstimate: true
    });
    linkExecutionToIntent2(execution.id, intentId);
    const marketMap = {
      "BTC": 0,
      "ETH": 1,
      "SOL": 2
    };
    const market = marketMap[parsed.targetAsset?.toUpperCase() || "BTC"] ?? 0;
    const side = parsed.action === "long" ? 0 : 1;
    const marginAmount = parsed.amount ? BigInt(Math.floor(parseFloat(parsed.amount) * 1e6)) : BigInt(100 * 1e6);
    const leverage = parsed.leverage || 10;
    const perpAdapterAbi = parseAbi([
      "function execute(bytes calldata innerData) external payable returns (bytes memory)"
    ]);
    const routerAbi = parseAbi([
      "function execute(address adapter, bytes calldata adapterData) external payable returns (bytes memory)"
    ]);
    const ACTION_OPEN = 1;
    const innerData = encodeFunctionData({
      abi: parseAbi(["function encode(uint8,address,uint8,uint8,uint256,uint256)"]),
      functionName: "encode",
      args: [ACTION_OPEN, account.address, market, side, marginAmount, BigInt(leverage)]
    }).slice(10);
    const { encodeAbiParameters, parseAbiParameters } = await import("viem");
    const encodedInnerData = encodeAbiParameters(
      parseAbiParameters("uint8, address, uint8, uint8, uint256, uint256"),
      [ACTION_OPEN, account.address, market, side, marginAmount, BigInt(leverage)]
    );
    const routerCallData = encodeFunctionData({
      abi: routerAbi,
      functionName: "execute",
      args: [DEMO_PERP_ADAPTER_ADDRESS2, encodedInnerData]
    });
    const erc20Abi = parseAbi([
      "function approve(address spender, uint256 amount) external returns (bool)",
      "function allowance(address owner, address spender) external view returns (uint256)",
      "function balanceOf(address account) external view returns (uint256)"
    ]);
    const balance = await publicClient.readContract({
      address: DEMO_REDACTED_ADDRESS2,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address]
    });
    if (balance < marginAmount) {
      updateExecution3(execution.id, {
        status: "failed",
        errorCode: "INSUFFICIENT_BALANCE",
        errorMessage: `Insufficient DEMO_REDACTED balance: have ${balance}, need ${marginAmount}`
      });
      updateIntentStatus2(intentId, {
        status: "failed",
        failureStage: "execute",
        errorCode: "INSUFFICIENT_BALANCE",
        errorMessage: "Insufficient DEMO_REDACTED balance for perp margin"
      });
      return {
        ok: false,
        intentId,
        status: "failed",
        executionId: execution.id,
        error: {
          stage: "execute",
          code: "INSUFFICIENT_BALANCE",
          message: "Insufficient DEMO_REDACTED balance for perp margin"
        }
      };
    }
    const allowance = await publicClient.readContract({
      address: DEMO_REDACTED_ADDRESS2,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account.address, DEMO_PERP_ADAPTER_ADDRESS2]
    });
    if (allowance < marginAmount) {
      const approveTxHash = await walletClient.writeContract({
        address: DEMO_REDACTED_ADDRESS2,
        abi: erc20Abi,
        functionName: "approve",
        args: [DEMO_PERP_ADAPTER_ADDRESS2, marginAmount * BigInt(10)]
        // Approve 10x to avoid future approvals
      });
      await publicClient.waitForTransactionReceipt({
        hash: approveTxHash,
        timeout: 6e4
      });
    }
    const txHash = await walletClient.writeContract({
      address: DEMO_PERP_ADAPTER_ADDRESS2,
      abi: perpAdapterAbi,
      functionName: "execute",
      args: [encodedInnerData]
    });
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: 6e4
    });
    const latencyMs = Date.now() - startTime;
    const explorerUrl = buildExplorerUrl3("ethereum", "sepolia", txHash);
    if (receipt.status === "success") {
      const { createPosition: createPosition3, createExecutionStep: createExecutionStep3, updateExecutionStep: updateExecutionStep3 } = await Promise.resolve().then(() => (init_db2(), db_exports2));
      const routeStep = createExecutionStep3({
        executionId: execution.id,
        stepIndex: 0,
        action: "route",
        stage: "route"
      });
      updateExecutionStep3(routeStep.id, { status: "confirmed" });
      const executeStep = createExecutionStep3({
        executionId: execution.id,
        stepIndex: 1,
        action: "open_position",
        stage: "execute"
      });
      updateExecutionStep3(executeStep.id, {
        status: "confirmed",
        txHash,
        explorerUrl
      });
      let onChainPositionId;
      try {
        const positionOpenedTopic = "0x" + Buffer.from("PositionOpened(address,uint256,uint8,uint8,uint256,uint256,uint256,uint256)").slice(0, 32).toString("hex");
        for (const log of receipt.logs) {
          if (log.topics[0]?.toLowerCase().includes("position")) {
            if (log.topics[2]) {
              onChainPositionId = BigInt(log.topics[2]).toString();
              break;
            }
          }
        }
      } catch (e) {
      }
      const marketName = parsed.targetAsset?.toUpperCase() || "BTC";
      const positionSide = parsed.action === "long" ? "long" : "short";
      createPosition3({
        chain: "ethereum",
        network: "sepolia",
        venue: "demo_perp",
        market: marketName,
        side: positionSide,
        leverage,
        margin_units: marginAmount.toString(),
        margin_display: `${(Number(marginAmount) / 1e6).toFixed(2)} REDACTED`,
        size_units: (marginAmount * BigInt(leverage)).toString(),
        open_tx_hash: txHash,
        open_explorer_url: explorerUrl,
        user_address: account.address,
        on_chain_position_id: onChainPositionId,
        intent_id: intentId,
        execution_id: execution.id
      });
      updateExecution3(execution.id, {
        status: "confirmed",
        txHash,
        explorerUrl,
        blockNumber: Number(receipt.blockNumber),
        gasUsed: receipt.gasUsed.toString(),
        latencyMs
      });
      updateIntentStatus2(intentId, {
        status: "confirmed",
        confirmedAt: Math.floor(Date.now() / 1e3),
        metadataJson: mergeMetadata(existingMetadataJson, {
          parsed,
          route,
          executedKind: "real",
          executionId: execution.id,
          txHash,
          explorerUrl,
          perpDetails: {
            market: marketName,
            side: positionSide,
            margin: marginAmount.toString(),
            leverage
          }
        })
      });
      return {
        ok: true,
        intentId,
        status: "confirmed",
        executionId: execution.id,
        txHash,
        explorerUrl,
        metadata: {
          executedKind: "real",
          perpDetails: {
            market: marketName,
            side: positionSide,
            leverage
          }
        }
      };
    } else {
      updateExecution3(execution.id, {
        status: "failed",
        txHash,
        explorerUrl,
        errorCode: "TX_REVERTED",
        errorMessage: "Perp position transaction reverted"
      });
      updateIntentStatus2(intentId, {
        status: "failed",
        failureStage: "confirm",
        errorCode: "TX_REVERTED",
        errorMessage: "Perp position transaction reverted on-chain"
      });
      return {
        ok: false,
        intentId,
        status: "failed",
        executionId: execution.id,
        txHash,
        explorerUrl,
        error: {
          stage: "confirm",
          code: "TX_REVERTED",
          message: "Perp position transaction reverted"
        }
      };
    }
  } catch (error) {
    updateIntentStatus2(intentId, {
      status: "failed",
      failureStage: "execute",
      errorCode: "PERP_EXECUTION_ERROR",
      errorMessage: error.message?.slice(0, 200)
    });
    return {
      ok: false,
      intentId,
      status: "failed",
      error: {
        stage: "execute",
        code: "PERP_EXECUTION_ERROR",
        message: error.message
      }
    };
  }
}
async function executeProofOnly(intentId, parsed, route) {
  const {
    getIntent: getIntent2,
    updateIntentStatus: updateIntentStatus2,
    createExecution: createExecution3,
    updateExecution: updateExecution3,
    linkExecutionToIntent: linkExecutionToIntent2
  } = await Promise.resolve().then(() => (init_db2(), db_exports2));
  const { buildExplorerUrl: buildExplorerUrl3 } = await Promise.resolve().then(() => (init_ledger(), ledger_exports));
  const intent = getIntent2(intentId);
  const existingMetadataJson = intent?.metadata_json;
  const now = Math.floor(Date.now() / 1e3);
  const startTime = Date.now();
  if (route.chain === "solana") {
    return await executeProofOnlySolana(intentId, parsed, route);
  }
  const {
    RELAYER_PRIVATE_KEY: RELAYER_PRIVATE_KEY2,
    ETH_TESTNET_RPC_URL: ETH_TESTNET_RPC_URL2
  } = await Promise.resolve().then(() => (init_config(), config_exports));
  if (!RELAYER_PRIVATE_KEY2 || !ETH_TESTNET_RPC_URL2) {
    updateIntentStatus2(intentId, {
      status: "failed",
      failureStage: "execute",
      errorCode: "CONFIG_MISSING",
      errorMessage: "Relayer key or RPC not configured for Sepolia proof tx"
    });
    return {
      ok: false,
      intentId,
      status: "failed",
      error: {
        stage: "execute",
        code: "CONFIG_MISSING",
        message: "Relayer key or RPC not configured"
      }
    };
  }
  try {
    const { createPublicClient: createPublicClient3, createWalletClient: createWalletClient4, http: http5, toHex } = await import("viem");
    const { sepolia: sepolia5 } = await import("viem/chains");
    const { privateKeyToAccount: privateKeyToAccount3 } = await import("viem/accounts");
    const account = privateKeyToAccount3(RELAYER_PRIVATE_KEY2);
    const publicClient = createPublicClient3({
      chain: sepolia5,
      transport: http5(ETH_TESTNET_RPC_URL2)
    });
    const walletClient = createWalletClient4({
      account,
      chain: sepolia5,
      transport: http5(ETH_TESTNET_RPC_URL2)
    });
    const execution = createExecution3({
      chain: "ethereum",
      network: "sepolia",
      kind: "proof",
      venue: route.venue,
      intent: parsed.rawParams.original || "Intent proof",
      action: "proof",
      fromAddress: account.address,
      token: parsed.amountUnit,
      usdEstimate: estimateIntentUsd(parsed),
      usdEstimateIsEstimate: true
    });
    linkExecutionToIntent2(execution.id, intentId);
    const proofData = {
      type: "BLOSSOM_INTENT_PROOF",
      intentId: intentId.slice(0, 8),
      kind: parsed.kind,
      action: parsed.action,
      asset: parsed.targetAsset || parsed.amountUnit,
      timestamp: now
    };
    const proofHex = toHex(JSON.stringify(proofData));
    const transferAmount = BigInt(1);
    const txHash = await walletClient.sendTransaction({
      to: account.address,
      value: transferAmount,
      data: proofHex
    });
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: 6e4
    });
    const latencyMs = Date.now() - startTime;
    const explorerUrl = buildExplorerUrl3("ethereum", "sepolia", txHash);
    if (receipt.status === "success") {
      updateExecution3(execution.id, {
        status: "confirmed",
        txHash,
        explorerUrl,
        blockNumber: Number(receipt.blockNumber),
        gasUsed: receipt.gasUsed.toString(),
        latencyMs
      });
      updateIntentStatus2(intentId, {
        status: "confirmed",
        confirmedAt: Math.floor(Date.now() / 1e3),
        metadataJson: mergeMetadata(existingMetadataJson, {
          parsed,
          route,
          executedKind: "proof_only",
          executionId: execution.id,
          txHash,
          explorerUrl,
          warnings: route.warnings
        })
      });
      return {
        ok: true,
        intentId,
        status: "confirmed",
        executionId: execution.id,
        txHash,
        explorerUrl,
        metadata: {
          executedKind: "proof_only",
          warnings: route.warnings
        }
      };
    } else {
      updateExecution3(execution.id, {
        status: "failed",
        txHash,
        explorerUrl,
        errorCode: "TX_REVERTED",
        errorMessage: "Proof transaction reverted"
      });
      updateIntentStatus2(intentId, {
        status: "failed",
        failureStage: "confirm",
        errorCode: "TX_REVERTED",
        errorMessage: "Proof transaction reverted on-chain"
      });
      return {
        ok: false,
        intentId,
        status: "failed",
        executionId: execution.id,
        txHash,
        explorerUrl,
        error: {
          stage: "confirm",
          code: "TX_REVERTED",
          message: "Proof transaction reverted"
        }
      };
    }
  } catch (error) {
    updateIntentStatus2(intentId, {
      status: "failed",
      failureStage: "execute",
      errorCode: "PROOF_TX_FAILED",
      errorMessage: error.message?.slice(0, 200)
    });
    return {
      ok: false,
      intentId,
      status: "failed",
      error: {
        stage: "execute",
        code: "PROOF_TX_FAILED",
        message: error.message
      }
    };
  }
}
async function executeProofOnlySolana(intentId, parsed, route) {
  const {
    getIntent: getIntent2,
    updateIntentStatus: updateIntentStatus2,
    createExecution: createExecution3,
    updateExecution: updateExecution3,
    linkExecutionToIntent: linkExecutionToIntent2
  } = await Promise.resolve().then(() => (init_db2(), db_exports2));
  const { buildExplorerUrl: buildExplorerUrl3 } = await Promise.resolve().then(() => (init_ledger(), ledger_exports));
  const intent = getIntent2(intentId);
  const existingMetadataJson = intent?.metadata_json;
  const now = Math.floor(Date.now() / 1e3);
  const startTime = Date.now();
  const solanaPrivateKey = process.env.SOLANA_PRIVATE_KEY;
  if (!solanaPrivateKey) {
    updateIntentStatus2(intentId, {
      status: "failed",
      failureStage: "execute",
      errorCode: "CONFIG_MISSING",
      errorMessage: "Solana wallet not configured for proof tx"
    });
    return {
      ok: false,
      intentId,
      status: "failed",
      error: {
        stage: "execute",
        code: "CONFIG_MISSING",
        message: "Solana wallet not configured"
      }
    };
  }
  try {
    let base58Decode2 = function(str) {
      const bytes = [0];
      for (const char of str) {
        let value = BASE58_ALPHABET.indexOf(char);
        if (value === -1) throw new Error(`Invalid base58 character: ${char}`);
        for (let i = 0; i < bytes.length; i++) {
          const product = bytes[i] * 58 + value;
          bytes[i] = product % 256;
          value = Math.floor(product / 256);
        }
        while (value > 0) {
          bytes.push(value % 256);
          value = Math.floor(value / 256);
        }
      }
      for (const char of str) {
        if (char !== "1") break;
        bytes.push(0);
      }
      return Buffer.from(bytes.reverse());
    }, base58Encode2 = function(buffer) {
      const digits = [0];
      for (let i = 0; i < buffer.length; i++) {
        let carry = buffer[i];
        for (let j = 0; j < digits.length; j++) {
          carry += digits[j] << 8;
          digits[j] = carry % 58;
          carry = Math.floor(carry / 58);
        }
        while (carry > 0) {
          digits.push(carry % 58);
          carry = Math.floor(carry / 58);
        }
      }
      let output = "";
      for (let i = 0; i < buffer.length && buffer[i] === 0; i++) {
        output += BASE58_ALPHABET[0];
      }
      for (let i = digits.length - 1; i >= 0; i--) {
        output += BASE58_ALPHABET[digits[i]];
      }
      return output;
    }, encodeCompactU162 = function(value) {
      if (value < 128) return Buffer.from([value]);
      if (value < 16384) return Buffer.from([value & 127 | 128, value >> 7]);
      return Buffer.from([value & 127 | 128, value >> 7 & 127 | 128, value >> 14]);
    };
    var base58Decode = base58Decode2, base58Encode = base58Encode2, encodeCompactU16 = encodeCompactU162;
    const { SolanaClient: SolanaClient2 } = await Promise.resolve().then(() => (init_solanaClient(), solanaClient_exports));
    const crypto2 = await import("crypto");
    const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    const secretKey = base58Decode2(solanaPrivateKey);
    if (secretKey.length !== 64) {
      throw new Error(`Invalid Solana secret key length: ${secretKey.length}`);
    }
    const privateKey = secretKey.slice(0, 32);
    const publicKey = secretKey.slice(32, 64);
    const senderPubkey = base58Encode2(publicKey);
    const execution = createExecution3({
      chain: "solana",
      network: "devnet",
      kind: "proof",
      venue: route.venue,
      intent: parsed.rawParams.original || "Intent proof",
      action: "proof",
      fromAddress: senderPubkey,
      token: parsed.amountUnit || "SOL",
      usdEstimate: estimateIntentUsd(parsed),
      usdEstimateIsEstimate: true
    });
    linkExecutionToIntent2(execution.id, intentId);
    const client = new SolanaClient2();
    const DEVNET_RPC = "https://api.devnet.solana.com";
    const LAMPORTS_PER_SOL = 1e9;
    const transferLamports = 1e3;
    const { blockhash } = await client.getRecentBlockhash();
    const systemProgramId = Buffer.alloc(32);
    const instructionData = Buffer.alloc(12);
    instructionData.writeUInt32LE(2, 0);
    instructionData.writeBigUInt64LE(BigInt(transferLamports), 4);
    const header = Buffer.from([1, 0, 1]);
    const accountsLength = encodeCompactU162(2);
    const accounts = Buffer.concat([publicKey, systemProgramId]);
    const blockhashBytes = base58Decode2(blockhash);
    const instructionsLength = encodeCompactU162(1);
    const programIdIndex = Buffer.from([1]);
    const accountIndicesLength = encodeCompactU162(2);
    const accountIndices = Buffer.from([0, 0]);
    const dataLength = encodeCompactU162(instructionData.length);
    const instruction = Buffer.concat([
      programIdIndex,
      accountIndicesLength,
      accountIndices,
      dataLength,
      instructionData
    ]);
    const message = Buffer.concat([
      header,
      accountsLength,
      accounts,
      blockhashBytes,
      instructionsLength,
      instruction
    ]);
    const keyObject = crypto2.createPrivateKey({
      key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), privateKey]),
      format: "der",
      type: "pkcs8"
    });
    const signature = Buffer.from(crypto2.sign(null, message, keyObject));
    const signedTx = Buffer.concat([Buffer.from([1]), signature, message]);
    const signedTxBase64 = signedTx.toString("base64");
    const txSignature = await client.sendTransaction(signedTxBase64);
    const result = await client.confirmTransaction(txSignature, "confirmed", 6e4);
    const latencyMs = Date.now() - startTime;
    const explorerUrl = buildExplorerUrl3("solana", "devnet", txSignature);
    updateExecution3(execution.id, {
      status: "confirmed",
      txHash: txSignature,
      explorerUrl,
      blockNumber: result.slot,
      latencyMs
    });
    updateIntentStatus2(intentId, {
      status: "confirmed",
      confirmedAt: Math.floor(Date.now() / 1e3),
      metadataJson: mergeMetadata(existingMetadataJson, {
        parsed,
        route,
        executedKind: "proof_only",
        executionId: execution.id,
        txHash: txSignature,
        explorerUrl,
        warnings: route.warnings
      })
    });
    return {
      ok: true,
      intentId,
      status: "confirmed",
      executionId: execution.id,
      txHash: txSignature,
      explorerUrl,
      metadata: {
        executedKind: "proof_only",
        warnings: route.warnings
      }
    };
  } catch (error) {
    updateIntentStatus2(intentId, {
      status: "failed",
      failureStage: "execute",
      errorCode: "SOLANA_PROOF_TX_FAILED",
      errorMessage: error.message?.slice(0, 200)
    });
    return {
      ok: false,
      intentId,
      status: "failed",
      error: {
        stage: "execute",
        code: "SOLANA_PROOF_TX_FAILED",
        message: error.message
      }
    };
  }
}
async function executeEthereum(intentId, parsed, route) {
  const {
    getIntent: getIntent2,
    updateIntentStatus: updateIntentStatus2,
    createExecution: createExecution3,
    updateExecution: updateExecution3,
    linkExecutionToIntent: linkExecutionToIntent2
  } = await Promise.resolve().then(() => (init_db2(), db_exports2));
  const intent = getIntent2(intentId);
  const existingMetadataJson = intent?.metadata_json;
  const now = Math.floor(Date.now() / 1e3);
  const {
    RELAYER_PRIVATE_KEY: RELAYER_PRIVATE_KEY2,
    ETH_TESTNET_RPC_URL: ETH_TESTNET_RPC_URL2
  } = await Promise.resolve().then(() => (init_config(), config_exports));
  if (!RELAYER_PRIVATE_KEY2 || !ETH_TESTNET_RPC_URL2) {
    updateIntentStatus2(intentId, {
      status: "failed",
      failureStage: "execute",
      errorCode: "CONFIG_MISSING",
      errorMessage: "Ethereum relayer not configured"
    });
    return {
      ok: false,
      intentId,
      status: "failed",
      error: {
        stage: "execute",
        code: "CONFIG_MISSING",
        message: "Ethereum relayer not configured"
      }
    };
  }
  const mappedKind = parsed.kind === "unknown" ? "proof" : parsed.kind;
  const execution = createExecution3({
    chain: "ethereum",
    network: "sepolia",
    kind: mappedKind,
    venue: route.venue,
    intent: parsed.rawParams.original || "Intent execution",
    action: parsed.action,
    fromAddress: "0x0000000000000000000000000000000000000000",
    // Will be updated
    token: parsed.amountUnit,
    amountDisplay: parsed.amount ? `${parsed.amount} ${parsed.amountUnit}` : void 0,
    usdEstimate: estimateIntentUsd(parsed),
    usdEstimateIsEstimate: true
  });
  linkExecutionToIntent2(execution.id, intentId);
  try {
    const { createPublicClient: createPublicClient3, createWalletClient: createWalletClient4, http: http5 } = await import("viem");
    const { sepolia: sepolia5 } = await import("viem/chains");
    const { privateKeyToAccount: privateKeyToAccount3 } = await import("viem/accounts");
    const account = privateKeyToAccount3(RELAYER_PRIVATE_KEY2);
    const publicClient = createPublicClient3({
      chain: sepolia5,
      transport: http5(ETH_TESTNET_RPC_URL2)
    });
    const walletClient = createWalletClient4({
      account,
      chain: sepolia5,
      transport: http5(ETH_TESTNET_RPC_URL2)
    });
    const transferAmount = BigInt(1e12);
    const txHash = await walletClient.sendTransaction({
      to: account.address,
      value: transferAmount
    });
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: 6e4
    });
    const explorerUrl = `https://sepolia.etherscan.io/tx/${txHash}`;
    const latencyMs = Date.now() - now * 1e3;
    updateExecution3(execution.id, {
      status: receipt.status === "success" ? "confirmed" : "failed",
      txHash,
      explorerUrl,
      blockNumber: Number(receipt.blockNumber),
      gasUsed: receipt.gasUsed.toString(),
      latencyMs
    });
    if (receipt.status === "success") {
      updateIntentStatus2(intentId, {
        status: "confirmed",
        confirmedAt: Math.floor(Date.now() / 1e3),
        metadataJson: mergeMetadata(existingMetadataJson, {
          parsed,
          route,
          executedKind: "real",
          executionId: execution.id,
          txHash,
          explorerUrl
        })
      });
      return {
        ok: true,
        intentId,
        status: "confirmed",
        executionId: execution.id,
        txHash,
        explorerUrl,
        metadata: {
          executedKind: "real"
        }
      };
    } else {
      updateIntentStatus2(intentId, {
        status: "failed",
        failureStage: "confirm",
        errorCode: "TX_REVERTED",
        errorMessage: "Transaction reverted on-chain"
      });
      return {
        ok: false,
        intentId,
        status: "failed",
        executionId: execution.id,
        txHash,
        explorerUrl,
        error: {
          stage: "confirm",
          code: "TX_REVERTED",
          message: "Transaction reverted on-chain"
        }
      };
    }
  } catch (error) {
    updateExecution3(execution.id, {
      status: "failed",
      errorCode: "EXECUTION_ERROR",
      errorMessage: error.message?.slice(0, 200)
    });
    updateIntentStatus2(intentId, {
      status: "failed",
      failureStage: "execute",
      errorCode: "EXECUTION_ERROR",
      errorMessage: error.message?.slice(0, 200)
    });
    return {
      ok: false,
      intentId,
      status: "failed",
      executionId: execution.id,
      error: {
        stage: "execute",
        code: "EXECUTION_ERROR",
        message: error.message
      }
    };
  }
}
async function executeSolana(intentId, parsed, route) {
  const {
    getIntent: getIntent2,
    updateIntentStatus: updateIntentStatus2,
    createExecution: createExecution3,
    updateExecution: updateExecution3,
    linkExecutionToIntent: linkExecutionToIntent2
  } = await Promise.resolve().then(() => (init_db2(), db_exports2));
  const existingIntent = getIntent2(intentId);
  const existingMetadataJson = existingIntent?.metadata_json;
  const now = Math.floor(Date.now() / 1e3);
  const solanaPrivateKey = process.env.SOLANA_PRIVATE_KEY;
  if (!solanaPrivateKey) {
    updateIntentStatus2(intentId, {
      status: "failed",
      failureStage: "execute",
      errorCode: "CONFIG_MISSING",
      errorMessage: "Solana wallet not configured"
    });
    return {
      ok: false,
      intentId,
      status: "failed",
      error: {
        stage: "execute",
        code: "CONFIG_MISSING",
        message: "Solana wallet not configured"
      }
    };
  }
  const solanaKind = parsed.kind === "unknown" ? "proof" : parsed.kind;
  const execution = createExecution3({
    chain: "solana",
    network: "devnet",
    kind: solanaKind,
    venue: route.venue,
    intent: parsed.rawParams.original || "Intent execution",
    action: parsed.action,
    fromAddress: "PENDING",
    // Will be updated
    token: parsed.amountUnit || "SOL",
    usdEstimate: estimateIntentUsd(parsed),
    usdEstimateIsEstimate: true
  });
  linkExecutionToIntent2(execution.id, intentId);
  updateExecution3(execution.id, {
    status: "confirmed",
    latencyMs: 100
  });
  updateIntentStatus2(intentId, {
    status: "confirmed",
    confirmedAt: Math.floor(Date.now() / 1e3),
    metadataJson: mergeMetadata(existingMetadataJson, {
      parsed,
      route,
      executedKind: "real",
      executionId: execution.id,
      note: "Solana execution simulated for MVP"
    })
  });
  return {
    ok: true,
    intentId,
    status: "confirmed",
    executionId: execution.id,
    metadata: {
      executedKind: "real",
      note: "Solana execution simulated for MVP"
    }
  };
}
async function runIntentBatch(intents, options = {}) {
  if (options.parallel) {
    return Promise.all(intents.map((intent) => runIntent(intent, options)));
  }
  const results = [];
  for (const intent of intents) {
    const result = await runIntent(intent, options);
    results.push(result);
  }
  return results;
}
async function recordFailedIntent(params) {
  const { createIntent: createIntent2, updateIntentStatus: updateIntentStatus2 } = await Promise.resolve().then(() => (init_db2(), db_exports2));
  const now = Math.floor(Date.now() / 1e3);
  const intent = createIntent2({
    intentText: params.intentText || "[empty]",
    intentKind: "unknown",
    metadataJson: JSON.stringify(params.metadata || {})
  });
  updateIntentStatus2(intent.id, {
    status: "failed",
    failureStage: params.failureStage,
    errorCode: params.errorCode,
    errorMessage: params.errorMessage,
    metadataJson: JSON.stringify({
      ...params.metadata,
      failedAt: now
    })
  });
  return {
    ok: false,
    intentId: intent.id,
    status: "failed",
    error: {
      stage: params.failureStage,
      code: params.errorCode,
      message: params.errorMessage
    }
  };
}
var IMPLEMENTED_VENUES, INTENT_PATTERNS;
var init_intentRunner = __esm({
  "agent/src/intent/intentRunner.ts"() {
    "use strict";
    IMPLEMENTED_VENUES = {
      ethereum: {
        deposit: ["demo_vault", "aave"],
        swap: ["demo_dex", "uniswap"],
        bridge: ["bridge_proof"],
        // Proof only, not real bridging
        perp: ["demo_perp"],
        // Proof only
        proof: ["native"],
        unknown: ["native"]
      },
      solana: {
        deposit: ["solana_vault"],
        swap: ["demo_dex"],
        bridge: ["bridge_proof"],
        perp: ["demo_perp"],
        proof: ["native"],
        unknown: ["native"]
      }
    };
    INTENT_PATTERNS = {
      perp: {
        long: /(?:^|\s)(?:go\s+)?long\s+(\w+)(?:\s+(\d+)x)?/i,
        short: /(?:^|\s)(?:go\s+)?short\s+(\w+)(?:\s+(\d+)x)?/i,
        leverage: /(\d+)\s*x\s*(?:leverage|lev)?/i,
        withAmount: /with\s+(\d+(?:,?\d+)*(?:\.\d+)?)/i
      },
      swap: {
        basic: /swap\s+(?:(\d+(?:,?\d+)*(?:\.\d+)?)\s*)?(\w+)\s+(?:to|for|->)\s+(\w+)/i,
        convert: /convert\s+(?:(\d+(?:,?\d+)*(?:\.\d+)?)\s*)?(\w+)\s+to\s+(\w+)/i,
        trade: /trade\s+(?:(\d+(?:,?\d+)*(?:\.\d+)?)\s*)?(\w+)\s+(?:for|to)\s+(\w+)/i
      },
      deposit: {
        basic: /deposit\s+(?:(\d+(?:,?\d+)*(?:\.\d+)?)\s*)?(\w+)\s+(?:to|into|in)\s+(\w+)/i,
        supply: /supply\s+(?:(\d+(?:,?\d+)*(?:\.\d+)?)\s*)?(\w+)\s+(?:to|into)\s+(\w+)/i,
        lend: /lend\s+(?:(\d+(?:,?\d+)*(?:\.\d+)?)\s*)?(\w+)/i
      },
      bridge: {
        basic: /bridge\s+(?:(\d+(?:,?\d+)*(?:\.\d+)?)\s*)?(\w+)\s+(?:from\s+)?(\w+)\s+to\s+(\w+)/i,
        transfer: /transfer\s+(?:(\d+(?:,?\d+)*(?:\.\d+)?)\s*)?(\w+)\s+from\s+(\w+)\s+to\s+(\w+)/i
      },
      // New patterns for Product Thesis scenarios
      prediction: {
        bet: /(?:bet|wager|stake)\s+(?:on\s+)?(?:the\s+)?/i,
        market: /prediction\s*market/i,
        volume: /(?:highest|top|best)\s*(?:volume|liquidity)/i
      },
      hedge: {
        basic: /hedge\s+(?:my\s+)?(?:positions?|portfolio)/i,
        protect: /protect\s+(?:my\s+)?(?:positions?|portfolio)/i
      },
      vault: {
        discovery: /(?:find|get|show)\s+(?:me\s+)?(?:the\s+)?(?:top|best)\s+(?:defi\s+)?vault/i,
        yield: /(\d+(?:\.\d+)?)\s*%\s*(?:yield|apy|apr)/i
      },
      // Analytics intents - recorded to ledger without on-chain proof
      analytics: {
        exposure: /(?:show|check|get|view)\s+(?:me\s+)?(?:my\s+)?(?:current\s+)?(?:perp\s+)?exposure/i,
        risk: /(?:show|check|get|view)\s+(?:me\s+)?(?:my\s+)?(?:current\s+)?risk/i,
        topProtocols: /(?:show|get|find)\s+(?:me\s+)?(?:the\s+)?(?:top|best)\s+(?:\d+\s+)?(?:defi\s+)?protocols?/i,
        topMarkets: /(?:show|get|find)\s+(?:me\s+)?(?:the\s+)?(?:top|best)\s+(?:\d+\s+)?prediction\s+markets?/i
      }
    };
  }
});

// agent/src/server/http.ts
init_actionParser();
import { config as config2 } from "dotenv";
import { resolve as resolve2, dirname as dirname7 } from "path";
import { fileURLToPath as fileURLToPath5 } from "url";
import { createHash as createHash2 } from "crypto";
import express from "express";
import cors from "cors";

// agent/src/services/llmClient.ts
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
function getProvider() {
  const provider = process.env.BLOSSOM_MODEL_PROVIDER;
  if (provider === "openai" || provider === "anthropic" || provider === "gemini") {
    return provider;
  }
  return "stub";
}
async function callLlm(input) {
  const provider = getProvider();
  console.log("[llmClient] Using provider:", provider);
  if (provider === "stub") {
    return {
      assistantMessage: "This is a stubbed Blossom response. No real AI model is configured. Set BLOSSOM_MODEL_PROVIDER and API keys to enable real AI.",
      rawJson: JSON.stringify({
        assistantMessage: "This is a stubbed Blossom response. No real AI model is configured.",
        actions: []
      })
    };
  }
  if (provider === "openai") {
    return callOpenAI(input);
  }
  if (provider === "anthropic") {
    return callAnthropic(input);
  }
  if (provider === "gemini") {
    return callGemini(input);
  }
  return {
    assistantMessage: "LLM provider not configured correctly.",
    rawJson: JSON.stringify({ assistantMessage: "Error", actions: [] })
  };
}
async function callOpenAI(input) {
  const apiKey = process.env.BLOSSOM_OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("BLOSSOM_OPENAI_API_KEY is not set");
  }
  const model = process.env.BLOSSOM_OPENAI_MODEL || "gpt-4o-mini";
  const client = new OpenAI({ apiKey });
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.userPrompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.7
    });
    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No content in OpenAI response");
    }
    return {
      assistantMessage: "",
      // Will be extracted from JSON
      rawJson: content
    };
  } catch (error) {
    console.error("OpenAI API error:", error.message);
    throw new Error(`OpenAI API error: ${error.message}`);
  }
}
async function callAnthropic(input) {
  const apiKey = process.env.BLOSSOM_ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("BLOSSOM_ANTHROPIC_API_KEY is not set");
  }
  const model = process.env.BLOSSOM_ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022";
  const client = new Anthropic({ apiKey });
  try {
    const enhancedSystemPrompt = `${input.systemPrompt}

You MUST respond with ONLY a valid JSON object, no other text before or after.`;
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: enhancedSystemPrompt,
      messages: [
        { role: "user", content: input.userPrompt }
      ]
    });
    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected content type from Anthropic");
    }
    const text = content.text.trim();
    let jsonText = text;
    if (text.startsWith("```json")) {
      jsonText = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    } else if (text.startsWith("```")) {
      jsonText = text.replace(/```\n?/g, "").trim();
    }
    return {
      assistantMessage: "",
      // Will be extracted from JSON
      rawJson: jsonText
    };
  } catch (error) {
    console.error("Anthropic API error:", error.message);
    throw new Error(`Anthropic API error: ${error.message}`);
  }
}
async function callGemini(input) {
  const apiKey = process.env.BLOSSOM_GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[llmClient] Gemini key missing, falling back to stub");
    return {
      assistantMessage: "This is a stubbed Blossom response. Gemini API key not configured. Set BLOSSOM_GEMINI_API_KEY to enable Gemini.",
      rawJson: JSON.stringify({
        assistantMessage: "This is a stubbed Blossom response. Gemini API key not configured.",
        actions: []
      })
    };
  }
  const model = process.env.BLOSSOM_GEMINI_MODEL || "gemini-1.5-pro";
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: `${input.systemPrompt}

${input.userPrompt}

You MUST respond with ONLY a valid JSON object, no other text before or after.` }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: "application/json"
        }
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} ${errorText}`);
    }
    const result = await response.json();
    const content = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      throw new Error("No content in Gemini response");
    }
    let jsonText = content.trim();
    if (jsonText.startsWith("```json")) {
      jsonText = jsonText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    } else if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/```\n?/g, "").trim();
    }
    return {
      assistantMessage: "",
      // Will be extracted from JSON
      rawJson: jsonText
    };
  } catch (error) {
    console.error("Gemini API error:", error.message);
    throw new Error(`Gemini API error: ${error.message}`);
  }
}

// agent/src/plugins/perps-sim/index.ts
init_prices();
import { v4 as uuidv4 } from "uuid";
function getBaseSymbolFromMarket(market) {
  const base = market.split("-")[0];
  if (base === "ETH") return "ETH";
  if (base === "BTC") return "BTC";
  if (base === "SOL") return "SOL";
  return "ETH";
}
var INITIAL_BALANCES = [
  { symbol: "REDACTED", balanceUsd: 4e3 },
  { symbol: "ETH", balanceUsd: 3e3 },
  { symbol: "SOL", balanceUsd: 3e3 }
];
var accountState = {
  accountValueUsd: 1e4,
  balances: [...INITIAL_BALANCES],
  positions: []
};
async function openPerp(spec) {
  const { market, side, riskPct, entry, takeProfit, stopLoss } = spec;
  const sizeUsd = accountState.accountValueUsd * (riskPct / 100);
  const usdcBalance = accountState.balances.find((b) => b.symbol === "REDACTED");
  if (!usdcBalance || usdcBalance.balanceUsd < sizeUsd) {
    throw new Error(`Insufficient REDACTED balance. Need $${sizeUsd.toFixed(2)}, have $${usdcBalance?.balanceUsd.toFixed(2) || 0}`);
  }
  let entryPrice;
  if (entry) {
    entryPrice = entry;
  } else {
    const baseSymbol = getBaseSymbolFromMarket(market);
    const priceSnapshot = await getPrice(baseSymbol);
    entryPrice = priceSnapshot.priceUsd;
  }
  const calculatedTP = takeProfit || (side === "long" ? entryPrice * 1.04 : entryPrice * 0.96);
  const calculatedSL = stopLoss || (side === "long" ? entryPrice * 0.97 : entryPrice * 1.03);
  usdcBalance.balanceUsd -= sizeUsd;
  const position = {
    id: uuidv4(),
    market,
    side,
    sizeUsd,
    entryPrice,
    takeProfit: calculatedTP,
    stopLoss: calculatedSL,
    unrealizedPnlUsd: 0,
    isClosed: false
  };
  accountState.positions.push(position);
  accountState.accountValueUsd = accountState.balances.reduce((sum, b) => sum + b.balanceUsd, 0);
  return position;
}
async function closePerp(id) {
  const position = accountState.positions.find((p) => p.id === id && !p.isClosed);
  if (!position) {
    throw new Error(`Position ${id} not found or already closed`);
  }
  const baseSymbol = getBaseSymbolFromMarket(position.market);
  const currentPriceSnapshot = await getPrice(baseSymbol);
  const currentPrice = currentPriceSnapshot.priceUsd;
  let pnlPct;
  if (position.side === "long") {
    pnlPct = (currentPrice - position.entryPrice) / position.entryPrice * 100;
  } else {
    pnlPct = (position.entryPrice - currentPrice) / position.entryPrice * 100;
  }
  pnlPct = Math.max(-2, Math.min(2, pnlPct));
  const realizedPnlUsd = position.sizeUsd * pnlPct / 100;
  position.isClosed = true;
  position.closedAt = Date.now();
  position.realizedPnlUsd = realizedPnlUsd;
  position.unrealizedPnlUsd = 0;
  const usdcBalance = accountState.balances.find((b) => b.symbol === "REDACTED");
  if (usdcBalance) {
    usdcBalance.balanceUsd += position.sizeUsd + realizedPnlUsd;
  }
  accountState.accountValueUsd = accountState.balances.reduce((sum, b) => sum + b.balanceUsd, 0);
  return { position, pnl: realizedPnlUsd };
}
function getPerpsSnapshot() {
  const openPositions = accountState.positions.filter((p) => !p.isClosed);
  const openPerpExposureUsd = openPositions.reduce((sum, p) => sum + p.sizeUsd, 0);
  return {
    ...accountState,
    positions: [...accountState.positions]
  };
}
function updateUsdcBalance(delta) {
  const usdc = accountState.balances.find((b) => b.symbol === "REDACTED");
  if (usdc) {
    usdc.balanceUsd += delta;
    accountState.accountValueUsd = accountState.balances.reduce((sum, b) => sum + b.balanceUsd, 0);
  }
}
function getUsdcBalance() {
  const usdc = accountState.balances.find((b) => b.symbol === "REDACTED");
  return usdc?.balanceUsd || 0;
}
function resetPerpsAccount() {
  accountState = {
    accountValueUsd: 1e4,
    balances: [...INITIAL_BALANCES],
    positions: []
  };
}

// agent/src/plugins/defi-sim/index.ts
import { v4 as uuidv42 } from "uuid";
var VAULTS = {
  Kamino: { apr: 8.5, asset: "REDACTED" },
  RootsFi: { apr: 6.4, asset: "REDACTED" },
  Jet: { apr: 7.2, asset: "REDACTED" }
};
var defiState = {
  positions: []
};
var getUsdcBalance2;
var updateUsdcBalance2;
function setBalanceCallbacks(getBalance, updateBalance) {
  getUsdcBalance2 = getBalance;
  updateUsdcBalance2 = updateBalance;
}
function openDefiPosition(protocol, asset, amountUsd) {
  const vault = VAULTS[protocol];
  if (!vault) {
    throw new Error(`Unknown protocol: ${protocol}`);
  }
  const currentBalance = getUsdcBalance2 ? getUsdcBalance2() : 0;
  if (currentBalance < amountUsd) {
    throw new Error(`Insufficient REDACTED balance. Need $${amountUsd.toFixed(2)}, have $${currentBalance.toFixed(2)}`);
  }
  if (updateUsdcBalance2) {
    updateUsdcBalance2(-amountUsd);
  }
  const position = {
    id: uuidv42(),
    protocol,
    asset: vault.asset,
    depositUsd: amountUsd,
    apr: vault.apr,
    openedAt: Date.now(),
    isClosed: false
  };
  defiState.positions.push(position);
  return position;
}
function closeDefiPosition(id) {
  const position = defiState.positions.find((p) => p.id === id && !p.isClosed);
  if (!position) {
    throw new Error(`Position ${id} not found or already closed`);
  }
  const elapsedMs = Date.now() - position.openedAt;
  const elapsedDays = elapsedMs / (1e3 * 60 * 60 * 24);
  const yieldEarnedUsd = position.depositUsd * position.apr * elapsedDays / (100 * 365);
  position.isClosed = true;
  position.closedAt = Date.now();
  position.yieldEarnedUsd = yieldEarnedUsd;
  const totalReturn = position.depositUsd + yieldEarnedUsd;
  if (updateUsdcBalance2) {
    updateUsdcBalance2(totalReturn);
  }
  return { position, yieldEarned: yieldEarnedUsd };
}
function getDefiSnapshot() {
  return {
    positions: [...defiState.positions]
  };
}
function resetDefiState() {
  defiState = {
    positions: []
  };
}

// agent/src/plugins/event-sim/index.ts
init_predictionData();
import { v4 as uuidv43 } from "uuid";
var SEEDED_MARKETS = [
  {
    key: "FED_CUTS_MAR_2025",
    label: "Fed cuts in March 2025",
    winProbability: 0.62,
    payoutMultiple: 1.6
  },
  {
    key: "BTC_ETF_APPROVAL_2025",
    label: "BTC ETF approved by Dec 31",
    winProbability: 0.68,
    payoutMultiple: 1.47
  },
  {
    key: "ETH_ETF_APPROVAL_2025",
    label: "ETH ETF approved by June 2025",
    winProbability: 0.58,
    payoutMultiple: 1.72
  },
  {
    key: "TRUMP_2024_WIN",
    label: "Trump wins 2024 election",
    winProbability: 0.52,
    payoutMultiple: 1.92
  },
  {
    key: "SOL_ADOPTION_2025",
    label: "Solana adoption surges in 2025",
    winProbability: 0.64,
    payoutMultiple: 1.56
  },
  {
    key: "GENERIC_EVENT_DEMO",
    label: "Generic Event Demo",
    winProbability: 0.5,
    payoutMultiple: 1.5
  }
];
var eventState = {
  markets: [...SEEDED_MARKETS],
  positions: []
};
var getUsdcBalance3;
var updateUsdcBalance3;
function setBalanceCallbacks2(getBalance, updateBalance) {
  getUsdcBalance3 = getBalance;
  updateUsdcBalance3 = updateBalance;
}
async function openEventPosition(eventKey, side, stakeUsd, label) {
  let market = eventState.markets.find((m) => m.key === eventKey);
  if (!market) {
    try {
      const kalshiMarkets = await fetchKalshiMarkets();
      const polymarketMarkets = await fetchPolymarketMarkets();
      const allLiveMarkets = [...kalshiMarkets, ...polymarketMarkets];
      const liveMarket = allLiveMarkets.find((m) => m.id === eventKey);
      if (liveMarket) {
        const yesPrice = liveMarket.yesPrice;
        const winProbability = side === "YES" ? yesPrice : 1 - yesPrice;
        const payoutMultiple = 1 / winProbability;
        market = {
          key: eventKey,
          label: label || liveMarket.title,
          winProbability,
          payoutMultiple
        };
        eventState.markets.push(market);
        console.log(`[EventSim] Created temporary market entry for live market: ${market.label}`);
      }
    } catch (error) {
      console.warn("[EventSim] Could not lookup live market:", error);
    }
  }
  if (!market) {
    throw new Error(`Event market ${eventKey} not found in seeded or live markets`);
  }
  const currentBalance = getUsdcBalance3 ? getUsdcBalance3() : 0;
  if (currentBalance < stakeUsd) {
    throw new Error(`Insufficient REDACTED balance. Need $${stakeUsd.toFixed(2)}, have $${currentBalance.toFixed(2)}`);
  }
  let marketSource = "DEMO";
  let externalMarketId = void 0;
  try {
    const kalshiMarkets = await fetchKalshiMarkets();
    const polymarketMarkets = await fetchPolymarketMarkets();
    const allLiveMarkets = [...kalshiMarkets, ...polymarketMarkets];
    const matchedMarket = allLiveMarkets.find(
      (m) => m.title.toLowerCase().includes(market.label.toLowerCase()) || market.label.toLowerCase().includes(m.title.toLowerCase())
    );
    if (matchedMarket) {
      marketSource = matchedMarket.source;
      externalMarketId = matchedMarket.id;
    }
  } catch (error) {
    console.warn("[EventSim] Could not match to live market, using DEMO source");
  }
  if (updateUsdcBalance3) {
    updateUsdcBalance3(-stakeUsd);
  }
  const maxPayoutUsd = stakeUsd * market.payoutMultiple;
  const maxLossUsd = stakeUsd;
  const position = {
    id: uuidv43(),
    eventKey,
    label: market.label,
    side,
    stakeUsd,
    maxPayoutUsd,
    maxLossUsd,
    isClosed: false,
    marketSource,
    externalMarketId
  };
  eventState.positions.push(position);
  return position;
}
async function getLiveEventPrice(position) {
  if (!position.externalMarketId || !position.marketSource || position.marketSource === "DEMO") {
    return void 0;
  }
  try {
    const markets = position.marketSource === "KALSHI" ? await fetchKalshiMarkets() : await fetchPolymarketMarkets();
    const liveMarket = markets.find((m) => m.id === position.externalMarketId);
    if (liveMarket) {
      return liveMarket.yesPrice;
    }
  } catch (error) {
    console.warn(`[EventSim] Failed to fetch live price for position ${position.id}:`, error);
  }
  return void 0;
}
async function updateEventStake(params) {
  const position = eventState.positions.find((p) => p.id === params.positionId && !p.isClosed);
  if (!position) {
    throw new Error(`Event position ${params.positionId} not found or already closed`);
  }
  const currentBalance = getUsdcBalance3 ? getUsdcBalance3() : 0;
  const stakeDelta = params.newStakeUsd - position.stakeUsd;
  if (stakeDelta > 0 && currentBalance < stakeDelta) {
    throw new Error(`Insufficient REDACTED balance. Need $${stakeDelta.toFixed(2)} more, have $${currentBalance.toFixed(2)}`);
  }
  const market = eventState.markets.find((m) => m.key === position.eventKey);
  if (!market) {
    throw new Error(`Market ${position.eventKey} not found`);
  }
  if (updateUsdcBalance3) {
    updateUsdcBalance3(-stakeDelta);
  }
  const maxPayoutUsd = params.newStakeUsd * market.payoutMultiple;
  const maxLossUsd = params.newStakeUsd;
  position.stakeUsd = params.newStakeUsd;
  position.maxPayoutUsd = maxPayoutUsd;
  position.maxLossUsd = maxLossUsd;
  position.overrideRiskCap = params.overrideRiskCap;
  if (params.requestedStakeUsd !== void 0) {
    position.requestedStakeUsd = params.requestedStakeUsd;
  }
  return position;
}
async function closeEventPosition(id) {
  const position = eventState.positions.find((p) => p.id === id && !p.isClosed);
  if (!position) {
    throw new Error(`Position ${id} not found or already closed`);
  }
  const market = eventState.markets.find((m) => m.key === position.eventKey);
  if (!market) {
    throw new Error(`Market ${position.eventKey} not found`);
  }
  let liveMarkToMarketUsd = void 0;
  try {
    const currentProb = await getLiveEventPrice(position);
    if (currentProb !== void 0) {
      if (position.side === "YES") {
        const currentPayoutValue = position.stakeUsd * (1 / currentProb);
        liveMarkToMarketUsd = currentPayoutValue - position.stakeUsd;
      } else {
        const currentPayoutValue = position.stakeUsd * (1 / (1 - currentProb));
        liveMarkToMarketUsd = currentPayoutValue - position.stakeUsd;
      }
    }
  } catch (error) {
    console.warn(`[EventSim] Could not compute live mark-to-market:`, error);
  }
  const isWin = Math.random() < market.winProbability;
  const outcome = isWin ? "won" : "lost";
  let realizedPnlUsd;
  if (isWin) {
    realizedPnlUsd = position.maxPayoutUsd - position.stakeUsd;
    if (updateUsdcBalance3) {
      updateUsdcBalance3(position.maxPayoutUsd);
    }
  } else {
    realizedPnlUsd = -position.stakeUsd;
  }
  position.isClosed = true;
  position.closedAt = Date.now();
  position.outcome = outcome;
  position.realizedPnlUsd = realizedPnlUsd;
  return { position, pnl: realizedPnlUsd, liveMarkToMarketUsd };
}
function getEventSnapshot() {
  const openPositions = eventState.positions.filter((p) => !p.isClosed);
  const eventExposureUsd = openPositions.reduce((sum, p) => sum + p.stakeUsd, 0);
  return {
    markets: [...eventState.markets],
    positions: [...eventState.positions]
  };
}
function getEventExposureUsd() {
  const openPositions = eventState.positions.filter((p) => !p.isClosed);
  return openPositions.reduce((sum, p) => sum + p.stakeUsd, 0);
}
function resetEventState() {
  eventState = {
    markets: [...SEEDED_MARKETS],
    positions: []
  };
}

// agent/src/services/state.ts
function resetAllSims() {
  resetPerpsAccount();
  resetDefiState();
  resetEventState();
}
function getPortfolioSnapshot() {
  const perpsSnapshot = getPerpsSnapshot();
  const defiSnapshot = getDefiSnapshot();
  const eventSnapshot = getEventSnapshot();
  const eventExposureUsd = getEventExposureUsd();
  const openPerpExposureUsd = perpsSnapshot.positions.filter((p) => !p.isClosed).reduce((sum, p) => sum + p.sizeUsd, 0);
  const strategies = [
    ...perpsSnapshot.positions.map((p) => ({
      type: "perp",
      status: p.isClosed ? "closed" : "executed",
      ...p
    })),
    ...defiSnapshot.positions.map((p) => ({
      type: "defi",
      status: p.isClosed ? "closed" : "active",
      ...p
    })),
    ...eventSnapshot.positions.map((p) => ({
      type: "event",
      status: p.isClosed ? "closed" : "executed",
      ...p
    }))
  ];
  return {
    accountValueUsd: perpsSnapshot.accountValueUsd,
    balances: perpsSnapshot.balances,
    openPerpExposureUsd,
    eventExposureUsd,
    defiPositions: defiSnapshot.positions.map((p) => ({
      id: p.id,
      protocol: p.protocol,
      asset: p.asset,
      depositUsd: p.depositUsd,
      apr: p.apr,
      openedAt: p.openedAt,
      isClosed: p.isClosed
    })),
    strategies
  };
}

// agent/src/services/ticker.ts
init_prices();
init_predictionData();

// agent/src/providers/dflowProvider.ts
init_dflowClient();
var DflowMarketDataProvider = class {
  name = "dflow";
  isAvailable() {
    return isDflowCapabilityAvailable("eventsMarkets");
  }
  async getEventMarkets() {
    if (!this.isAvailable()) {
      return [];
    }
    const response = await getEventMarkets();
    if (!response.ok || !response.data) {
      console.warn("[DflowMarketDataProvider] Failed to fetch markets:", response.error);
      return [];
    }
    return response.data.map((market) => ({
      id: market.id,
      title: market.title,
      yesPrice: market.yesPrice,
      noPrice: market.noPrice,
      volume24hUsd: market.volume24hUsd,
      openInterestUsd: market.openInterestUsd,
      liquidity: market.liquidity,
      spread: market.spread,
      source: "dflow",
      isLive: true
    }));
  }
};

// agent/src/providers/fallbackProvider.ts
init_predictionData();
init_evmQuote();
init_config();
function normalizeMarket(market) {
  return {
    id: market.id,
    title: market.title,
    yesPrice: market.yesPrice,
    noPrice: market.noPrice,
    volume24hUsd: market.volume24hUsd,
    openInterestUsd: market.openInterestUsd,
    source: market.source.toLowerCase(),
    isLive: market.isLive || false
  };
}
var FallbackMarketDataProvider = class {
  name = "fallback";
  isAvailable() {
    return true;
  }
  async getEventMarkets() {
    try {
      const [kalshiMarkets, polymarketMarkets] = await Promise.all([
        fetchKalshiMarkets(),
        fetchPolymarketMarkets()
      ]);
      const normalized = [
        ...kalshiMarkets.map(normalizeMarket),
        ...polymarketMarkets.map(normalizeMarket)
      ];
      return normalized.sort((a, b) => {
        const aValue = a.volume24hUsd || a.openInterestUsd || 0;
        const bValue = b.volume24hUsd || b.openInterestUsd || 0;
        return bValue - aValue;
      });
    } catch (error) {
      console.warn("[FallbackMarketDataProvider] Error fetching markets:", error.message);
      return [];
    }
  }
};

// agent/src/providers/providerRegistry.ts
init_config();
init_dflowClient();
var marketDataProvider = null;
function getMarketDataProvider() {
  if (marketDataProvider) {
    return marketDataProvider;
  }
  if (DFLOW_ENABLED) {
    const dflowProvider = new DflowMarketDataProvider();
    if (dflowProvider.isAvailable()) {
      marketDataProvider = dflowProvider;
      console.log("[ProviderRegistry] Using dFlow for market data");
      return marketDataProvider;
    }
    if (DFLOW_REQUIRE) {
      throw new Error(
        "dFlow is required but events markets capability is not configured. Set DFLOW_EVENTS_MARKETS_PATH or disable DFLOW_REQUIRE."
      );
    }
    console.warn("[ProviderRegistry] dFlow enabled but events markets unavailable, using fallback");
  }
  marketDataProvider = new FallbackMarketDataProvider();
  console.log("[ProviderRegistry] Using fallback for market data (Polymarket + Kalshi)");
  return marketDataProvider;
}

// agent/src/services/ticker.ts
init_config();
var STATIC_ONCHAIN_TICKER = [
  { symbol: "BTC", priceUsd: 6e4, change24hPct: 2.5 },
  { symbol: "ETH", priceUsd: 3e3, change24hPct: 1.8 },
  { symbol: "SOL", priceUsd: 150, change24hPct: -0.5 },
  { symbol: "AVAX", priceUsd: 35, change24hPct: 3.2 },
  { symbol: "LINK", priceUsd: 14, change24hPct: 0.8 }
];
var STATIC_EVENT_TICKER = [
  { id: "FED_CUTS_MAR_2025", label: "Fed cuts in March 2025", impliedProb: 0.62, source: "Kalshi" },
  { id: "BTC_ETF_APPROVAL_2025", label: "BTC ETF approved by Dec 31", impliedProb: 0.68, source: "Kalshi" },
  { id: "ETH_ETF_APPROVAL_2025", label: "ETH ETF approved by June 2025", impliedProb: 0.58, source: "Kalshi" },
  { id: "US_ELECTION_2024", label: "US Election Winner 2024", impliedProb: 0.5, source: "Polymarket" },
  { id: "CRYPTO_MCAP_THRESHOLD", label: "Crypto market cap above $3T by year-end", impliedProb: 0.52, source: "Polymarket" }
];
async function getOnchainTicker() {
  const symbols = ["BTC", "ETH", "SOL", "AVAX", "LINK"];
  const priceData = [];
  let hasLiveData = false;
  let hasStaticFallback = false;
  try {
    for (const symbol of symbols) {
      try {
        const snapshot = await getPrice(symbol);
        const change24hPct = getMock24hChange(symbol);
        priceData.push({
          symbol,
          priceUsd: snapshot.priceUsd,
          change24hPct,
          source: snapshot.source
        });
        if (snapshot.source === "coingecko") {
          hasLiveData = true;
        } else {
          hasStaticFallback = true;
        }
      } catch (error) {
        console.warn(`Failed to fetch ${symbol} price:`, error);
        const staticItem = STATIC_ONCHAIN_TICKER.find((item) => item.symbol === symbol);
        if (staticItem) {
          priceData.push({
            ...staticItem,
            source: "static"
          });
          hasStaticFallback = true;
        }
      }
    }
    const allPrices = priceData.length > 0 ? priceData : STATIC_ONCHAIN_TICKER;
    const majorsItems = allPrices.map((item) => ({
      label: item.symbol,
      value: `$${item.priceUsd.toLocaleString(void 0, { maximumFractionDigits: 0 })}`,
      change: `${item.change24hPct >= 0 ? "+" : ""}${item.change24hPct.toFixed(1)}%`,
      meta: "24h"
    }));
    const gainers = [...allPrices].sort((a, b) => b.change24hPct - a.change24hPct).slice(0, 4).map((item) => ({
      label: item.symbol,
      value: `$${item.priceUsd.toLocaleString(void 0, { maximumFractionDigits: 0 })}`,
      change: `+${item.change24hPct.toFixed(1)}%`,
      meta: "Top gainer"
    }));
    const defiItems = [
      { label: "Lido", value: "$28B TVL", meta: "DeFi" },
      { label: "Aave", value: "$12B TVL", meta: "DeFi" },
      { label: "Uniswap", value: "$8.5B TVL", meta: "DeFi" },
      { label: "Maker", value: "$6.2B TVL", meta: "DeFi" }
    ];
    return {
      venue: "hyperliquid",
      sections: [
        { id: "majors", label: "Majors", items: majorsItems },
        { id: "gainers", label: "Top gainers (24h)", items: gainers },
        { id: "defi", label: "DeFi TVL", items: defiItems }
      ],
      lastUpdatedMs: Date.now(),
      // isLive is true only if we have at least one CoinGecko fetch (not cached static)
      isLive: hasLiveData,
      source: hasLiveData ? "coingecko" : "static"
    };
  } catch (error) {
    console.error("Failed to build on-chain ticker, using static fallback:", error);
    return {
      venue: "hyperliquid",
      sections: [
        {
          id: "majors",
          label: "Majors",
          items: STATIC_ONCHAIN_TICKER.map((item) => ({
            label: item.symbol,
            value: `$${item.priceUsd.toLocaleString(void 0, { maximumFractionDigits: 0 })}`,
            change: `${item.change24hPct >= 0 ? "+" : ""}${item.change24hPct.toFixed(1)}%`,
            meta: "24h"
          }))
        }
      ],
      lastUpdatedMs: Date.now(),
      isLive: false,
      source: "static"
    };
  }
}
async function getEventMarketsTicker() {
  try {
    if (DFLOW_ENABLED) {
      try {
        const provider = getMarketDataProvider();
        if (provider.name === "dflow" && provider.isAvailable()) {
          const dflowMarkets = await provider.getEventMarkets();
          if (dflowMarkets.length > 0) {
            const topMarkets2 = dflowMarkets.slice(0, 12);
            const tickerItems = topMarkets2.map((market) => {
              const impliedProb = market.yesPrice;
              const lean = impliedProb >= 0.5 ? "YES" : "NO";
              return {
                label: market.title,
                value: `${Math.round(impliedProb * 100)}%`,
                impliedProb,
                meta: "dFlow",
                lean
              };
            });
            return {
              venue: "event_demo",
              sections: [{ id: "kalshi", label: "Markets (dFlow)", items: tickerItems }],
              lastUpdatedMs: Date.now(),
              isLive: true,
              source: "kalshi"
              // Use kalshi as source type for compatibility
            };
          }
        }
      } catch (error) {
        console.warn("[getEventMarketsTicker] dFlow provider failed, falling back:", error.message);
      }
    }
    const polymarketMarkets = await fetchPolymarketMarkets();
    const kalshiMarkets = await fetchKalshiMarkets();
    const hasLivePolymarket = polymarketMarkets.some((m) => m.isLive);
    const hasLiveKalshi = kalshiMarkets.some((m) => m.isLive);
    const hasLiveData = hasLivePolymarket || hasLiveKalshi;
    const allMarkets = [...kalshiMarkets, ...polymarketMarkets];
    const sorted = allMarkets.sort((a, b) => {
      const aValue = a.openInterestUsd || a.volume24hUsd || 0;
      const bValue = b.openInterestUsd || b.volume24hUsd || 0;
      return bValue - aValue;
    });
    const topMarkets = sorted.slice(0, 12);
    if (topMarkets.length > 0) {
      const tickerItems = topMarkets.map((market) => {
        const impliedProb = market.yesPrice;
        const lean = impliedProb >= 0.5 ? "YES" : "NO";
        return {
          label: market.title,
          value: `${Math.round(impliedProb * 100)}%`,
          impliedProb,
          meta: market.source,
          lean
        };
      });
      const kalshiItems2 = tickerItems.filter((item) => item.meta === "KALSHI");
      const polymarketItems2 = tickerItems.filter((item) => item.meta === "POLYMARKET");
      const sections2 = [];
      if (kalshiItems2.length > 0) {
        sections2.push({ id: "kalshi", label: "Kalshi", items: kalshiItems2 });
      }
      if (polymarketItems2.length > 0) {
        sections2.push({ id: "polymarket", label: "Polymarket", items: polymarketItems2 });
      }
      return {
        venue: "event_demo",
        sections: sections2.length > 0 ? sections2 : [
          { id: "kalshi", label: "Kalshi", items: kalshiItems2 },
          { id: "polymarket", label: "Polymarket", items: polymarketItems2 }
        ],
        lastUpdatedMs: Date.now(),
        isLive: hasLiveData,
        source: hasLivePolymarket ? "polymarket" : hasLiveKalshi ? "kalshi" : "static"
      };
    }
    const eventSnapshot = getEventSnapshot();
    const allMarketsSeeded = eventSnapshot.markets;
    const kalshiMarketsSeeded = [];
    const polymarketMarketsSeeded = [];
    for (const market of allMarketsSeeded) {
      let source = "Demo";
      if (market.key.includes("FED") || market.key.includes("ETF")) {
        source = "Kalshi";
      } else if (market.key.includes("ELECTION") || market.key.includes("MCAP")) {
        source = "Polymarket";
      }
      const item = {
        label: market.label,
        impliedProb: market.winProbability
      };
      if (source === "Kalshi") {
        kalshiMarketsSeeded.push(item);
      } else if (source === "Polymarket") {
        polymarketMarketsSeeded.push(item);
      }
    }
    const kalshiItems = kalshiMarketsSeeded.slice(0, 4).map((m) => ({
      label: m.label,
      value: `${Math.round(m.impliedProb * 100)}%`,
      impliedProb: m.impliedProb,
      meta: "Kalshi",
      lean: m.impliedProb > 0.5 ? "YES" : "NO"
    }));
    const polymarketItems = polymarketMarketsSeeded.slice(0, 4).map((m) => ({
      label: m.label,
      value: `${Math.round(m.impliedProb * 100)}%`,
      impliedProb: m.impliedProb,
      meta: "Polymarket",
      lean: m.impliedProb > 0.5 ? "YES" : "NO"
    }));
    if (kalshiItems.length === 0 && polymarketItems.length === 0) {
      return {
        venue: "event_demo",
        sections: [
          {
            id: "kalshi",
            label: "Kalshi",
            items: STATIC_EVENT_TICKER.filter((item) => item.source === "Kalshi").slice(0, 4).map((item) => ({
              label: item.label,
              value: `${Math.round(item.impliedProb * 100)}%`,
              meta: "Kalshi",
              lean: item.impliedProb > 0.5 ? "YES" : "NO"
            }))
          },
          {
            id: "polymarket",
            label: "Polymarket",
            items: STATIC_EVENT_TICKER.filter((item) => item.source === "Polymarket").slice(0, 4).map((item) => ({
              label: item.label,
              value: `${Math.round(item.impliedProb * 100)}%`,
              meta: "Polymarket",
              lean: item.impliedProb > 0.5 ? "YES" : "NO"
            }))
          }
        ],
        lastUpdatedMs: Date.now(),
        isLive: false,
        source: "static"
      };
    }
    const sections = [];
    if (kalshiItems.length > 0) {
      sections.push({ id: "kalshi", label: "Kalshi", items: kalshiItems });
    }
    if (polymarketItems.length > 0) {
      sections.push({ id: "polymarket", label: "Polymarket", items: polymarketItems });
    }
    return {
      venue: "event_demo",
      sections,
      lastUpdatedMs: Date.now(),
      isLive: hasLiveData,
      source: hasLiveKalshi ? "kalshi" : hasLivePolymarket ? "polymarket" : "snapshot"
    };
  } catch (error) {
    console.error("Failed to build event markets ticker, using static fallback:", error);
    return {
      venue: "event_demo",
      sections: [
        {
          id: "kalshi",
          label: "Kalshi",
          items: STATIC_EVENT_TICKER.filter((item) => item.source === "Kalshi").slice(0, 4).map((item) => ({
            label: item.label,
            value: `${Math.round(item.impliedProb * 100)}%`,
            meta: "Kalshi",
            lean: item.impliedProb > 0.5 ? "YES" : "NO"
          }))
        },
        {
          id: "polymarket",
          label: "Polymarket",
          items: STATIC_EVENT_TICKER.filter((item) => item.source === "Polymarket").slice(0, 4).map((item) => ({
            label: item.label,
            value: `${Math.round(item.impliedProb * 100)}%`,
            meta: "Polymarket",
            lean: item.impliedProb > 0.5 ? "YES" : "NO"
          }))
        }
      ],
      lastUpdatedMs: Date.now(),
      isLive: false,
      source: "static"
    };
  }
}
function getMock24hChange(symbol) {
  const changes = {
    BTC: 2.5,
    ETH: 1.8,
    SOL: -0.5,
    REDACTED: 0,
    AVAX: 3.2,
    LINK: 0.8
  };
  return changes[symbol] ?? 0;
}

// agent/src/utils/executionLogger.ts
var executionArtifacts = [];
var MAX_ARTIFACTS = 100;
function logExecutionArtifact(artifact) {
  const fullArtifact = {
    ...artifact,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    executionId: `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  };
  executionArtifacts.push(fullArtifact);
  if (executionArtifacts.length > MAX_ARTIFACTS) {
    executionArtifacts.shift();
  }
  if (process.env.NODE_ENV !== "production") {
    console.log("[executionLogger] Artifact logged:", {
      executionId: fullArtifact.executionId,
      timestamp: fullArtifact.timestamp,
      success: fullArtifact.executionResult.success,
      txHash: fullArtifact.executionResult.txHash,
      simulatedTxId: fullArtifact.executionResult.simulatedTxId
    });
  }
}
function getExecutionArtifacts() {
  return [...executionArtifacts];
}

// agent/src/utils/accessGate.ts
var accessCodes = /* @__PURE__ */ new Map();
function generateAccessCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
function createAccessCode() {
  const code = generateAccessCode();
  const accessCode = {
    code,
    used: false,
    createdAt: Date.now()
  };
  accessCodes.set(code, accessCode);
  return accessCode;
}
function validateAccessCode(code, walletAddress) {
  const accessCode = accessCodes.get(code.toUpperCase());
  if (!accessCode) {
    return { valid: false, error: "Invalid access code" };
  }
  if (accessCode.used) {
    if (accessCode.walletAddress && accessCode.walletAddress.toLowerCase() === walletAddress?.toLowerCase()) {
      return { valid: true };
    }
    return { valid: false, error: "Access code already used" };
  }
  accessCode.used = true;
  if (walletAddress) {
    accessCode.walletAddress = walletAddress.toLowerCase();
  }
  accessCode.usedAt = Date.now();
  return { valid: true };
}
function initializeAccessCodes(codes) {
  if (codes && codes.length > 0) {
    for (const code of codes) {
      accessCodes.set(code.toUpperCase(), {
        code: code.toUpperCase(),
        used: false,
        createdAt: Date.now()
      });
    }
  } else {
    for (let i = 0; i < 30; i++) {
      createAccessCode();
    }
  }
}
function loadAccessCodesFromEnv() {
  const accessGateEnabled = process.env.ACCESS_GATE_ENABLED === "true";
  if (!accessGateEnabled) {
    console.log(`[accessGate] Access gate is disabled`);
    return;
  }
  const codesEnv = process.env.WHITELIST_ACCESS_CODES;
  if (codesEnv) {
    const codes = codesEnv.split(",").map((c) => c.trim()).filter((c) => c.length > 0);
    initializeAccessCodes(codes);
    console.log(`[accessGate] Loaded ${codes.length} access codes from environment`);
  } else {
    initializeAccessCodes();
    console.log(`[accessGate] Generated 30 access codes`);
  }
}
function checkAccess(req, res, next) {
  const accessGateEnabled = process.env.ACCESS_GATE_ENABLED === "true";
  if (!accessGateEnabled) {
    return next();
  }
  const accessCode = req.headers["x-access-code"] || req.body?.accessCode;
  const walletAddress = req.headers["x-wallet-address"] || req.body?.walletAddress;
  if (!accessCode) {
    return res.status(401).json({
      error: "Access code required",
      errorCode: "ACCESS_CODE_REQUIRED"
    });
  }
  const validation = validateAccessCode(accessCode, walletAddress);
  if (!validation.valid) {
    return res.status(401).json({
      error: validation.error || "Invalid access code",
      errorCode: "INVALID_ACCESS_CODE"
    });
  }
  next();
}

// agent/src/telemetry/logger.ts
import { createHash } from "crypto";
import { appendFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname as dirname2 } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";
var __filename2 = fileURLToPath2(import.meta.url);
var __dirname2 = dirname2(__filename2);
var LOG_DIR = join(__dirname2, "../../logs");
var LOG_FILE = join(LOG_DIR, "telemetry.jsonl");
var logDirReady = false;
try {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
  logDirReady = true;
} catch (e) {
  console.warn("[telemetry] Could not create log directory (telemetry disabled):", e);
  logDirReady = false;
}
var TELEMETRY_SALT = process.env.TELEMETRY_SALT || "blossom-mvp-default-salt";
function hashAddress(address) {
  if (!address) return "unknown";
  return createHash("sha256").update(TELEMETRY_SALT + address.toLowerCase()).digest("hex").substring(0, 16);
}
function logEvent(type, payload) {
  if (!logDirReady) {
    return;
  }
  try {
    const event = {
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      type,
      ...payload
    };
    const line = JSON.stringify(event) + "\n";
    try {
      appendFileSync(LOG_FILE, line, { encoding: "utf8" });
    } catch (writeError) {
      if (logDirReady) {
        console.warn("[telemetry] Write failed, disabling telemetry for this session:", writeError);
        logDirReady = false;
      }
      return;
    }
    if (process.env.NODE_ENV === "development" || process.env.TELEMETRY_CONSOLE === "true") {
      console.log(`[telemetry] ${type}:`, JSON.stringify(payload));
    }
  } catch (e) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[telemetry] Failed to log event:", e);
    }
  }
}

// agent/src/server/http.ts
init_evmReceipt();
init_correlationId();
var __filename5 = fileURLToPath5(import.meta.url);
var __dirname5 = dirname7(__filename5);
var agentDir2 = resolve2(__dirname5, "../..");
var rootDir2 = resolve2(agentDir2, "..");
var envFiles2 = [
  resolve2(agentDir2, ".env.local"),
  resolve2(agentDir2, ".env"),
  resolve2(rootDir2, ".env.local"),
  resolve2(rootDir2, ".env")
];
var loadedEnvFile2 = null;
for (const envFile of envFiles2) {
  const result = config2({ path: envFile });
  if (!result.error) {
    loadedEnvFile2 = envFile;
    break;
  }
}
if (loadedEnvFile2) {
  console.log(`\u{1F4C4} Loaded environment from: ${loadedEnvFile2}`);
} else {
  console.log(`\u26A0\uFE0F  No .env file found (using system environment variables)`);
}
var ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://blossom.onl",
  "https://www.blossom.onl",
  // Preview/staging subdomains
  /^https:\/\/.*\.blossom\.onl$/
];
var app = express();
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true);
    }
    const isAllowed = ALLOWED_ORIGINS.some((allowed) => {
      if (typeof allowed === "string") {
        return origin === allowed;
      }
      return allowed.test(origin);
    });
    if (isAllowed) {
      return callback(null, true);
    }
    if (process.env.NODE_ENV !== "production" && origin.includes("localhost")) {
      return callback(null, true);
    }
    console.warn(`[CORS] Blocked origin: ${origin}`);
    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-Ledger-Secret", "X-Access-Code", "X-Wallet-Address", "x-correlation-id"]
}));
app.use(express.json());
var TELEMETRY_ONLY = process.env.TELEMETRY_ONLY === "true";
var TELEMETRY_ALLOWLIST = [
  "GET /health",
  "GET /api/health",
  "GET /api/rpc/health",
  "GET /api/telemetry/summary",
  "GET /api/telemetry/devnet-stats",
  "GET /api/telemetry/users",
  "GET /api/telemetry/executions",
  "GET /api/telemetry/runs",
  "GET /api/telemetry/debug",
  "POST /api/telemetry/runs"
  // Allow campaign script to post run data
];
if (TELEMETRY_ONLY) {
  console.log("");
  console.log("================================================================================");
  console.log("  TELEMETRY-ONLY MODE ENABLED");
  console.log("  Only read-only telemetry endpoints are accessible.");
  console.log("  All execution, session, and sensitive endpoints are BLOCKED.");
  console.log("================================================================================");
  console.log("");
  console.log("ALLOWED ROUTES:");
  TELEMETRY_ALLOWLIST.forEach((route) => console.log(`  \u2705 ${route}`));
  console.log("");
  console.log("BLOCKED ROUTES (returning 403):");
  console.log("  \u274C POST /api/chat");
  console.log("  \u274C POST /api/execute/*");
  console.log("  \u274C POST /api/session/*");
  console.log("  \u274C GET /api/session/*");
  console.log("  \u274C POST /api/setup/*");
  console.log("  \u274C POST /api/token/*");
  console.log("  \u274C GET /api/portfolio/*");
  console.log("  \u274C GET /api/defi/*");
  console.log("  \u274C GET /api/wallet/*");
  console.log("  \u274C POST /api/demo/*");
  console.log("  \u274C GET /api/debug/*");
  console.log("  \u274C ... and all other non-telemetry routes");
  console.log("================================================================================");
  console.log("");
  app.use((req, res, next) => {
    const routeKey = `${req.method} ${req.path}`;
    const isAllowed = TELEMETRY_ALLOWLIST.some((allowed) => {
      if (routeKey === allowed) return true;
      const [method, path3] = allowed.split(" ");
      if (req.method === method && req.path === path3) return true;
      return false;
    });
    if (!isAllowed) {
      console.log(`[TELEMETRY_ONLY] BLOCKED: ${routeKey}`);
      return res.status(403).json({
        ok: false,
        error: "Forbidden: This endpoint is disabled in telemetry-only mode",
        telemetryOnly: true
      });
    }
    next();
  });
}
function generateCorrelationId() {
  return makeCorrelationId();
}
app.use((req, res, next) => {
  const correlationId = req.headers["x-correlation-id"] || generateCorrelationId();
  req.correlationId = correlationId;
  res.setHeader("x-correlation-id", correlationId);
  const startTime = Date.now();
  const visitorAddress = req.headers["x-visitor-address"] || req.query.userAddress || req.query.visitor || req.query.address || null;
  res.on("finish", async () => {
    const duration = Date.now() - startTime;
    const isSessionOrExecute = req.path.includes("/session/") || req.path.includes("/execute/");
    if (isSessionOrExecute || process.env.NODE_ENV !== "production" || res.statusCode >= 400) {
      console.log(`[${correlationId}] ${req.method} ${req.path} -> ${res.statusCode} (${duration}ms)`);
    }
    if (!req.path.includes(".") && req.path.startsWith("/")) {
      try {
        const { logRequest: logRequest2 } = await Promise.resolve().then(() => (init_db(), db_exports));
        logRequest2({
          endpoint: req.path,
          method: req.method,
          userAddress: visitorAddress,
          statusCode: res.statusCode,
          latencyMs: duration,
          correlationId
        });
      } catch (e) {
      }
    }
  });
  next();
});
function logSessionTrace(correlationId, event, data = {}) {
  const safeData = { ...data };
  delete safeData.privateKey;
  delete safeData.signature;
  delete safeData.apiKey;
  delete safeData.secret;
  console.log(`[${correlationId}] [SESSION] ${event}`, JSON.stringify(safeData));
}
function logExecuteTrace(correlationId, event, data = {}) {
  const safeData = { ...data };
  delete safeData.privateKey;
  delete safeData.signature;
  delete safeData.apiKey;
  delete safeData.secret;
  console.log(`[${correlationId}] [EXECUTE] ${event}`, JSON.stringify(safeData));
}
function logPlanMissing(correlationId, suspectedIntent, userMessage) {
  const snippet = userMessage.substring(0, 100) + (userMessage.length > 100 ? "..." : "");
  console.log(`[${correlationId}] [PLAN_MISSING] suspectedIntent=${suspectedIntent} message="${snippet}"`);
}
function detectSuspectedIntent(userMessage) {
  const lower = userMessage.toLowerCase();
  if (/\b(swap|exchange|convert)\b/.test(lower)) return "swap";
  if (/\b(long|short|leverage|perp|margin|position)\b/.test(lower)) return "perp";
  if (/\b(deposit|lend|supply|borrow|stake|yield|apy|earn|lending)\b/.test(lower)) return "defi";
  if (/\b(bet|predict|prediction|wager)\b/.test(lower)) return "event";
  return null;
}
var ACCESS_GATE_ENABLED = process.env.ACCESS_GATE_ENABLED === "true";
var maybeCheckAccess = ACCESS_GATE_ENABLED ? checkAccess : (req, res, next) => next();
loadAccessCodesFromEnv();
var getUsdcBalance4 = () => {
  return getUsdcBalance();
};
var updateUsdcBalance4 = (delta) => {
  updateUsdcBalance(delta);
};
setBalanceCallbacks(getUsdcBalance4, updateUsdcBalance4);
setBalanceCallbacks2(getUsdcBalance4, updateUsdcBalance4);
function buildPortfolioSnapshot() {
  return getPortfolioSnapshot();
}
async function applyAction(action) {
  const portfolioBefore = buildPortfolioSnapshot();
  const { v4: uuidv44 } = await import("uuid");
  const simulatedTxId = `sim_${uuidv44()}`;
  try {
    if (action.type === "perp" && action.action === "open") {
      const position = await openPerp({
        market: action.market,
        side: action.side,
        riskPct: action.riskPct,
        entry: action.entry,
        takeProfit: action.takeProfit,
        stopLoss: action.stopLoss
      });
      const portfolioAfter2 = buildPortfolioSnapshot();
      const accountValueDelta = portfolioAfter2.accountValueUsd - portfolioBefore.accountValueUsd;
      const balanceDeltas = portfolioAfter2.balances.map((b) => {
        const before = portfolioBefore.balances.find((b2) => b2.symbol === b.symbol);
        return {
          symbol: b.symbol,
          deltaUsd: b.balanceUsd - (before?.balanceUsd || 0)
        };
      });
      return {
        success: true,
        status: "success",
        simulatedTxId,
        positionDelta: {
          type: "perp",
          positionId: position.id,
          sizeUsd: position.sizeUsd,
          entryPrice: position.entryPrice,
          side: position.side
        },
        portfolioDelta: {
          accountValueDeltaUsd: accountValueDelta,
          balanceDeltas,
          exposureDeltaUsd: portfolioAfter2.openPerpExposureUsd - portfolioBefore.openPerpExposureUsd
        },
        portfolio: portfolioAfter2
      };
    } else if (action.type === "defi" && action.action === "deposit") {
      const position = openDefiPosition(
        action.protocol,
        action.asset,
        action.amountUsd
      );
      const portfolioAfter2 = buildPortfolioSnapshot();
      const accountValueDelta = portfolioAfter2.accountValueUsd - portfolioBefore.accountValueUsd;
      const balanceDeltas = portfolioAfter2.balances.map((b) => {
        const before = portfolioBefore.balances.find((b2) => b2.symbol === b.symbol);
        return {
          symbol: b.symbol,
          deltaUsd: b.balanceUsd - (before?.balanceUsd || 0)
        };
      });
      return {
        success: true,
        status: "success",
        simulatedTxId,
        positionDelta: {
          type: "defi",
          positionId: position.id,
          sizeUsd: position.depositUsd
        },
        portfolioDelta: {
          accountValueDeltaUsd: accountValueDelta,
          balanceDeltas
        },
        portfolio: portfolioAfter2
      };
    } else if (action.type === "event" && action.action === "open") {
      const accountValue = portfolioBefore.accountValueUsd;
      const maxEventRiskPct = 0.03;
      const maxStakeUsd = Math.round(accountValue * maxEventRiskPct);
      if (!action.overrideRiskCap) {
        const cappedStakeUsd = Math.min(action.stakeUsd, maxStakeUsd);
        if (cappedStakeUsd < action.stakeUsd) {
          action.stakeUsd = cappedStakeUsd;
          action.maxLossUsd = cappedStakeUsd;
          const payoutMultiple = action.maxPayoutUsd / action.stakeUsd;
          action.maxPayoutUsd = cappedStakeUsd * payoutMultiple;
        }
      } else {
        const maxAllowedUsd = accountValue;
        if (action.stakeUsd > maxAllowedUsd) {
          action.stakeUsd = maxAllowedUsd;
          action.maxLossUsd = maxAllowedUsd;
          const payoutMultiple = action.maxPayoutUsd / action.stakeUsd;
          action.maxPayoutUsd = maxAllowedUsd * payoutMultiple;
        }
      }
      const position = await openEventPosition(
        action.eventKey,
        action.side,
        action.stakeUsd,
        action.label
        // Pass label for live markets
      );
      const portfolioAfter2 = buildPortfolioSnapshot();
      const accountValueDelta = portfolioAfter2.accountValueUsd - portfolioBefore.accountValueUsd;
      const balanceDeltas = portfolioAfter2.balances.map((b) => {
        const before = portfolioBefore.balances.find((b2) => b2.symbol === b.symbol);
        return {
          symbol: b.symbol,
          deltaUsd: b.balanceUsd - (before?.balanceUsd || 0)
        };
      });
      return {
        success: true,
        status: "success",
        simulatedTxId,
        positionDelta: {
          type: "event",
          positionId: position.id,
          sizeUsd: position.stakeUsd,
          side: position.side
        },
        portfolioDelta: {
          accountValueDeltaUsd: accountValueDelta,
          balanceDeltas,
          exposureDeltaUsd: portfolioAfter2.eventExposureUsd - portfolioBefore.eventExposureUsd
        },
        portfolio: portfolioAfter2
      };
    } else if (action.type === "event" && action.action === "update") {
      if (!action.positionId) {
        throw new Error("positionId is required for event update action");
      }
      await updateEventStake({
        positionId: action.positionId,
        newStakeUsd: action.stakeUsd,
        overrideRiskCap: action.overrideRiskCap || false,
        requestedStakeUsd: action.requestedStakeUsd
      });
      const portfolioAfter2 = buildPortfolioSnapshot();
      return {
        success: true,
        status: "success",
        simulatedTxId,
        portfolio: portfolioAfter2
      };
    }
    const portfolioAfter = buildPortfolioSnapshot();
    return {
      success: false,
      status: "failed",
      error: `Unknown action type: ${action.type}`,
      portfolio: portfolioAfter
    };
  } catch (error) {
    const portfolioAfter = buildPortfolioSnapshot();
    return {
      success: false,
      status: "failed",
      error: error.message || "Unknown error",
      portfolio: portfolioAfter
    };
  }
}
async function parseModelResponse(rawJson, isSwapPrompt = false, isDefiPrompt = false, userMessage, isPerpPrompt = false, isEventPrompt = false) {
  try {
    const parsed = JSON.parse(rawJson);
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("Response is not an object");
    }
    const assistantMessage = typeof parsed.assistantMessage === "string" ? parsed.assistantMessage : "I understand your request.";
    const actions = Array.isArray(parsed.actions) ? validateActions(parsed.actions) : [];
    let executionRequest = null;
    let modelOk = true;
    if (parsed.executionRequest) {
      const { validateExecutionRequest: validateExecutionRequest2 } = await Promise.resolve().then(() => (init_actionParser(), actionParser_exports));
      executionRequest = validateExecutionRequest2(parsed.executionRequest);
      if (!executionRequest && (isSwapPrompt || isDefiPrompt || isPerpPrompt || isEventPrompt)) {
        modelOk = false;
        console.error("[parseModelResponse] Invalid executionRequest, will try fallback");
      }
    } else if (isSwapPrompt || isDefiPrompt || isPerpPrompt || isEventPrompt) {
      modelOk = false;
      console.error("[parseModelResponse] Missing executionRequest, will try fallback");
    }
    if (!modelOk && userMessage && (isSwapPrompt || isDefiPrompt || isPerpPrompt || isEventPrompt)) {
      const fallback = await applyDeterministicFallback(userMessage, isSwapPrompt, isDefiPrompt, isPerpPrompt, isEventPrompt);
      if (fallback) {
        return {
          assistantMessage: `(Fallback planner) ${fallback.assistantMessage}`,
          actions: fallback.actions,
          executionRequest: fallback.executionRequest,
          modelOk: true
        };
      }
    }
    return { assistantMessage, actions, executionRequest, modelOk };
  } catch (error) {
    console.error("Failed to parse model response:", error.message);
    console.error("Raw JSON:", rawJson);
    if (userMessage && (isSwapPrompt || isDefiPrompt || isPerpPrompt || isEventPrompt)) {
      const fallback = await applyDeterministicFallback(userMessage, isSwapPrompt, isDefiPrompt, isPerpPrompt, isEventPrompt);
      if (fallback) {
        return {
          assistantMessage: `(Fallback planner) ${fallback.assistantMessage}`,
          actions: fallback.actions,
          executionRequest: fallback.executionRequest,
          modelOk: true
        };
      }
    }
    throw error;
  }
}
function generateHelpfulFallback(userMessage, portfolio2) {
  const lower = userMessage.toLowerCase();
  if (lower.includes("swap") || lower.includes("trade") || lower.includes("exchange") || lower.includes("convert")) {
    return "I'd be happy to help with a swap! What token would you like to swap, and how much? For example: 'Swap 10 REDACTED to WETH' or 'Swap 0.01 ETH to REDACTED'.";
  }
  if (lower.includes("yield") || lower.includes("earn") || lower.includes("apy") || lower.includes("interest") || lower.includes("stake")) {
    return "Looking for yield opportunities? I can help deploy your REDACTED into DeFi protocols. How much would you like to deposit? For example: 'Deposit 100 REDACTED into Aave'.";
  }
  if (lower.includes("bet") || lower.includes("predict") || lower.includes("market") || lower.includes("event") || lower.includes("kalshi") || lower.includes("polymarket")) {
    return "Want to explore prediction markets? I can show you the top markets by volume, or help you place a bet. Try: 'Show me top Polymarket markets' or 'Bet $20 YES on Fed rate cut'.";
  }
  if (lower.includes("perp") || lower.includes("leverage") || lower.includes("long") || lower.includes("short") || lower.includes("futures")) {
    return "Ready to trade perps? Tell me what you'd like to trade: 'Long BTC with 5x leverage' or 'Short ETH with 2% risk'.";
  }
  if (lower.includes("money") || lower.includes("invest") || lower.includes("profit") || lower.includes("make") || lower.includes("grow")) {
    const usdcBalance = portfolio2?.balances.find((b) => b.symbol === "REDACTED")?.balanceUsd || 0;
    if (usdcBalance > 0) {
      return `I can help you put your $${usdcBalance.toLocaleString()} REDACTED to work! Here are your options:

1. **Yield**: Deploy to DeFi protocols for ~4-8% APY
2. **Trade Perps**: Open leveraged positions on BTC/ETH/SOL
3. **Prediction Markets**: Bet on real-world events
4. **Swap**: Exchange for other tokens

What sounds interesting?`;
    }
    return "I can help you explore opportunities! Here's what I can do:\n\n1. **Yield**: Deploy REDACTED to earn APY\n2. **Trade Perps**: Open leveraged positions\n3. **Prediction Markets**: Bet on events\n4. **Swap**: Exchange tokens\n\nWhat would you like to explore?";
  }
  if (lower.includes("help") || lower.includes("what can") || lower.includes("what do you") || lower.includes("how do")) {
    return "I'm Blossom, your AI trading copilot! I can help with:\n\n1. **Swaps**: 'Swap 100 REDACTED to WETH'\n2. **Perps**: 'Long BTC with 5x leverage'\n3. **DeFi Yield**: 'Deposit 500 REDACTED into Aave'\n4. **Prediction Markets**: 'Show me top Kalshi markets'\n\nWhat would you like to do?";
  }
  return "I can help with swaps, perps trading, DeFi yield, and prediction markets. What would you like to explore? Try:\n\n- 'Swap 10 REDACTED to WETH'\n- 'Long BTC with 3x leverage'\n- 'Show me top prediction markets'\n- 'Deposit 100 REDACTED for yield'";
}
function normalizeUserInput(userMessage) {
  if (!userMessage) {
    return "";
  }
  const tokenPattern = /\b(\d+\.?\d*)(eth|weth|usdc|usdt|dai|btc|sol)\b/gi;
  let normalized = userMessage;
  normalized = normalized.replace(tokenPattern, (match, amount, token) => {
    return `${amount} ${token}`;
  });
  normalized = normalized.replace(/(\d+\.?\d*\s*\w+)\s*[-=]>\s*(\w+)/gi, "$1 to $2");
  normalized = normalized.replace(/,\s*to\s+/gi, " to ");
  return normalized;
}
async function applyDeterministicFallback(userMessage, isSwapPrompt, isDefiPrompt, isPerpPrompt = false, isEventPrompt = false) {
  const normalizedMessage = normalizeUserInput(userMessage);
  const lowerMessage = normalizedMessage.toLowerCase();
  if (isEventPrompt) {
    const stakeMatch = userMessage.match(/\$(\d+)/) || userMessage.match(/(\d+)\s*(usd|dollar)/i);
    const stakeUsd = stakeMatch ? parseFloat(stakeMatch[1]) : 5;
    const outcome = lowerMessage.includes("yes") ? "YES" : "NO";
    const { findEventMarketByKeyword: findEventMarketByKeyword2 } = await Promise.resolve().then(() => (init_eventMarkets(), eventMarkets_exports));
    const keyword = lowerMessage.includes("fed") ? "fed" : lowerMessage.includes("rate cut") ? "rate cut" : "fed";
    const market = await findEventMarketByKeyword2(keyword);
    return {
      assistantMessage: `I'll bet ${outcome} on "${market?.title || "Fed Rate Cut"}" with $${stakeUsd}.`,
      actions: [],
      executionRequest: {
        kind: "event",
        chain: "sepolia",
        marketId: market?.id || "FED_CUTS_MAR_2025",
        outcome,
        stakeUsd,
        price: outcome === "YES" ? market?.yesPrice : market?.noPrice
      }
    };
  }
  if (isPerpPrompt) {
    const assetMatch = lowerMessage.match(/(btc|eth|sol)/);
    const leverageMatch = userMessage.match(/(\d+(?:\.\d+)?)x/i);
    const riskMatch = userMessage.match(/(\d+)%\s*risk/i) || userMessage.match(/risk.*?(\d+)%/i);
    const sideMatch = lowerMessage.match(/(long|short)/);
    const asset = assetMatch ? assetMatch[1].toUpperCase() : "ETH";
    const leverage = leverageMatch ? parseFloat(leverageMatch[1]) : 2;
    const riskPct = riskMatch ? parseFloat(riskMatch[1]) : 2;
    const side = sideMatch ? sideMatch[1] : "long";
    return {
      assistantMessage: `I'll open a ${side} ${asset} perp position with ${leverage}x leverage and ${riskPct}% risk.`,
      actions: [],
      executionRequest: {
        kind: "perp",
        chain: "sepolia",
        market: `${asset}-USD`,
        side,
        leverage,
        riskPct,
        marginUsd: 100
      }
    };
  }
  if (isSwapPrompt) {
    const amountMatch = userMessage.match(/(\d+\.?\d*)\s*(usdc|weth|eth)/i);
    const tokenInMatch = lowerMessage.match(/(usdc|weth|eth)/);
    const tokenOutMatch = lowerMessage.match(/to\s+(usdc|weth|eth)/);
    if (amountMatch && tokenInMatch) {
      const amount = amountMatch[1];
      const tokenIn = tokenInMatch[1].toUpperCase() === "ETH" ? "ETH" : tokenInMatch[1].toUpperCase();
      const tokenOut = tokenOutMatch ? tokenOutMatch[1].toUpperCase() === "ETH" ? "WETH" : tokenOutMatch[1].toUpperCase() : tokenIn === "REDACTED" ? "WETH" : "REDACTED";
      return {
        assistantMessage: `I'll swap ${amount} ${tokenIn} to ${tokenOut} on Sepolia.`,
        actions: [],
        executionRequest: {
          kind: "swap",
          chain: "sepolia",
          tokenIn,
          tokenOut,
          amountIn: amount,
          slippageBps: 50,
          fundingPolicy: tokenIn === "ETH" ? "auto" : "require_tokenIn"
        }
      };
    }
  }
  if (isDefiPrompt) {
    const structuredAllocMatch = userMessage.match(/allocate\s+amount(Usd|Pct):"?(\d+\.?\d*)"?\s+to\s+protocol:"?([^"]+?)"?(?:\s+REDACTED|\s+yield|$)/i);
    let amount;
    let vaultName;
    if (structuredAllocMatch) {
      const [_, amountType, amountValue, protocolName] = structuredAllocMatch;
      if (amountType.toLowerCase() === "pct") {
        const accountValue = portfolio?.accountValueUsd || 1e4;
        const percentage = parseFloat(amountValue);
        amount = (accountValue * percentage / 100).toFixed(0);
      } else {
        amount = amountValue;
      }
      vaultName = protocolName.trim();
      console.log("[deterministic fallback] Parsed structured allocation:", { amount, vaultName, format: "structured" });
    } else {
      const amountMatch = userMessage.match(/(\d+\.?\d*)\s*(?:usdc|dollar|into|in|to|for)?.*?(?:yield|vault|defi|aave|compound)/i) || userMessage.match(/(?:park|deposit|lend|supply)\s+(\d+\.?\d*)/i);
      amount = amountMatch ? amountMatch[1] : "10";
      const { getVaultRecommendation: getVaultRecommendation2 } = await Promise.resolve().then(() => (init_defiLlamaQuote(), defiLlamaQuote_exports));
      const vault = await getVaultRecommendation2(parseFloat(amount));
      vaultName = vault?.name;
      console.log("[deterministic fallback] Parsed natural language allocation:", { amount, vaultName, format: "natural" });
    }
    return {
      assistantMessage: `I'll allocate $${amount} to ${vaultName || "yield vault"}. ${vaultName ? `Earning ~5-7% APY.` : "Recommended: Aave REDACTED at 5.00% APY."}`,
      actions: [],
      executionRequest: {
        kind: "lend_supply",
        chain: "sepolia",
        asset: "REDACTED",
        amount,
        protocol: "demo",
        vault: vaultName || "Aave REDACTED"
      }
    };
  }
  return null;
}
app.post("/api/chat", maybeCheckAccess, async (req, res) => {
  const chatStartTime = Date.now();
  try {
    const { userMessage, venue, clientPortfolio } = req.body;
    logEvent("chat_request", {
      venue,
      notes: [userMessage ? userMessage.substring(0, 50) + (userMessage.length > 50 ? "..." : "") : "undefined"]
    });
    if (!userMessage) {
      return res.status(400).json({ error: "userMessage is required" });
    }
    console.log("[api/chat] Received request:", {
      userMessage: userMessage ? userMessage.substring(0, 100) : "undefined",
      venue,
      messageLength: userMessage ? userMessage.length : 0
    });
    const portfolioBefore = buildPortfolioSnapshot();
    const portfolioForPrompt = clientPortfolio ? { ...portfolioBefore, ...clientPortfolio } : portfolioBefore;
    const normalizedUserMessage = normalizeUserInput(userMessage);
    const LIST_DEFI_PROTOCOLS_RE = /\b(show\s+me\s+)?(top\s+(\d+)\s+)?(defi\s+)?protocols?\s+(by\s+)?(tvl|total\s+value\s+locked)\b/i;
    const hasListDefiProtocolsIntent = LIST_DEFI_PROTOCOLS_RE.test(normalizedUserMessage) || /\b(list|show|display|fetch|get|explore)\s+(top|best|highest)\s+(\d+)?\s*(defi\s+)?protocols?\b/i.test(normalizedUserMessage) || /\b(best\s+defi|top\s+defi|explore\s+top\s+protocols)\b/i.test(normalizedUserMessage) || /\b(top\s+5\s+defi|top\s+defi\s+protocols|defi\s+protocols\s+by\s+tvl)\b/i.test(normalizedUserMessage);
    if (hasListDefiProtocolsIntent) {
      console.log("[api/chat] DeFi TVL query detected - fetching top protocols");
      let requestedCount = 5;
      const numericMatch = normalizedUserMessage.match(/\btop\s+(\d+)\s+(defi\s+)?protocols?\b/i);
      if (numericMatch && numericMatch[1]) {
        requestedCount = parseInt(numericMatch[1], 10);
      }
      try {
        const { getTopProtocolsByTVL: getTopProtocolsByTVL2 } = await Promise.resolve().then(() => (init_defiLlamaQuote(), defiLlamaQuote_exports));
        const protocols = await getTopProtocolsByTVL2(requestedCount);
        const portfolioAfter2 = buildPortfolioSnapshot();
        return res.json({
          ok: true,
          assistantMessage: `Here are the top ${protocols.length} DeFi protocol${protocols.length !== 1 ? "s" : ""} by TVL right now:`,
          actions: [],
          executionRequest: null,
          modelOk: true,
          portfolio: portfolioAfter2,
          executionResults: [],
          defiProtocolsList: protocols
          // Special field for protocol list
        });
      } catch (error) {
        console.error("[api/chat] Failed to fetch DeFi protocols:", error.message);
        const portfolioAfter2 = buildPortfolioSnapshot();
        return res.json({
          ok: false,
          assistantMessage: "I couldn't fetch the DeFi protocols right now. Please try again later.",
          actions: [],
          executionRequest: null,
          modelOk: false,
          portfolio: portfolioAfter2,
          executionResults: []
        });
      }
    }
    const LIST_EVENT_MARKETS_RE = /\b(show\s+me\s+)?(top\s+(\d+)\s+)?(prediction|event)\s+markets?\s*(by\s+)?(volume|tvl)?\b/i;
    const hasListEventMarketsIntent = LIST_EVENT_MARKETS_RE.test(normalizedUserMessage) || /\b(list|show|display|fetch|get|explore)\s+(top|best|highest)\s+(\d+)?\s*(prediction|event)\s+markets?\b/i.test(normalizedUserMessage) || /\b(best\s+prediction|top\s+prediction|top\s+event|explore\s+top\s+markets)\b/i.test(normalizedUserMessage) || /\b(top\s+5\s+prediction|top\s+prediction\s+markets|prediction\s+markets\s+by\s+volume)\b/i.test(normalizedUserMessage) || /\b(show\s+me\s+top\s+prediction\s+markets?)\b/i.test(normalizedUserMessage);
    if (hasListEventMarketsIntent) {
      console.log("[api/chat] Event Markets list query detected - fetching top markets");
      let requestedCount = 5;
      const numericMatch = normalizedUserMessage.match(/\btop\s+(\d+)\s+(prediction|event)\s+markets?\b/i);
      if (numericMatch && numericMatch[1]) {
        requestedCount = parseInt(numericMatch[1], 10);
      }
      try {
        const { getEventMarketsWithRouting: getEventMarketsWithRouting2 } = await Promise.resolve().then(() => (init_eventMarkets(), eventMarkets_exports));
        const result = await getEventMarketsWithRouting2(requestedCount);
        const portfolioAfter2 = buildPortfolioSnapshot();
        return res.json({
          ok: true,
          assistantMessage: `Here are the top ${result.markets.length} prediction market${result.markets.length !== 1 ? "s" : ""} by volume right now:`,
          actions: [],
          executionRequest: null,
          modelOk: true,
          portfolio: portfolioAfter2,
          executionResults: [],
          eventMarketsList: result.markets,
          // Special field for event market list
          routing: result.routing
          // Sprint 3: Truthful routing metadata
        });
      } catch (error) {
        console.error("[api/chat] Failed to fetch event markets:", error.message, error.stack);
        const portfolioAfter2 = buildPortfolioSnapshot();
        const correlationId2 = req.correlationId || makeCorrelationId("error");
        return res.json({
          ok: false,
          assistantMessage: "I couldn't fetch the prediction markets right now. Please try again later.",
          actions: [],
          executionRequest: null,
          modelOk: false,
          portfolio: portfolioAfter2,
          executionResults: [],
          routing: {
            source: "fallback",
            kind: "event_markets",
            ok: false,
            reason: `Error: ${error.message || "Unknown error"}`,
            latencyMs: 0,
            mode: process.env.ROUTING_MODE || "hybrid",
            correlationId: correlationId2
          }
        });
      }
    }
    const hasEventQuickActionStructured = /bet\s+(YES|NO)\s+on\s+market:"?([^"]+?)"?(?:\s+stake(Usd|Pct):"?(\d+\.?\d*)"?)?/i.test(normalizedUserMessage);
    const hasEventQuickActionNatural = /bet\s+(YES|NO)\s+on\s+"([^"]+)"\s+with\s+(\d+\.?\d*)%\s+risk/i.test(normalizedUserMessage);
    if (hasEventQuickActionStructured || hasEventQuickActionNatural) {
      let eventMatch;
      let isNaturalFormat = false;
      if (hasEventQuickActionNatural) {
        eventMatch = normalizedUserMessage.match(/bet\s+(YES|NO)\s+on\s+"([^"]+)"\s+with\s+(\d+\.?\d*)%\s+risk/i);
        isNaturalFormat = true;
      } else {
        eventMatch = normalizedUserMessage.match(/bet\s+(YES|NO)\s+on\s+market:"?([^"]+?)"?(?:\s+stake(Usd|Pct):"?(\d+\.?\d*)"?)?/i);
      }
      if (eventMatch) {
        let outcome;
        let marketTitle;
        let stakeUsd;
        if (isNaturalFormat) {
          const [fullMatch, outcomeRaw, marketTitleRaw, riskPct] = eventMatch;
          outcome = outcomeRaw;
          marketTitle = marketTitleRaw;
          const accountValue = portfolioBefore?.accountValueUsd || 1e4;
          stakeUsd = accountValue * parseFloat(riskPct) / 100;
          console.log("[event quick action] Natural format detected:", { outcome, marketTitle, riskPct, accountValue, stakeUsd });
        } else {
          const [_, outcomeRaw, marketTitleRaw, stakeType, stakeValue] = eventMatch;
          outcome = outcomeRaw;
          marketTitle = marketTitleRaw;
          if (stakeType?.toLowerCase() === "pct") {
            const accountValue = portfolioBefore?.accountValueUsd || 1e4;
            stakeUsd = accountValue * parseFloat(stakeValue || "2") / 100;
          } else {
            stakeUsd = parseFloat(stakeValue || "50");
          }
          console.log("[event quick action] Structured format detected:", { outcome, marketTitle, stakeType, stakeUsd });
        }
        try {
          const { getEventMarketsWithRouting: getEventMarketsWithRouting2 } = await Promise.resolve().then(() => (init_eventMarkets(), eventMarkets_exports));
          const result = await getEventMarketsWithRouting2(10);
          const markets = result.markets;
          const matchedMarket = markets.find(
            (m) => m.title.toLowerCase().includes(marketTitle.toLowerCase()) || marketTitle.toLowerCase().includes(m.title.toLowerCase())
          );
          if (matchedMarket) {
            const price = outcome === "YES" ? matchedMarket.yesPrice : matchedMarket.noPrice;
            const maxPayout = stakeUsd / price;
            const portfolioAfter2 = buildPortfolioSnapshot();
            return res.json({
              ok: true,
              assistantMessage: `I'll place a ${outcome} bet on "${matchedMarket.title}" with $${stakeUsd.toFixed(0)} stake. At ${(price * 100).toFixed(1)}\xA2 odds, your max payout is $${maxPayout.toFixed(0)}. Confirm to execute?`,
              actions: [],
              executionRequest: {
                kind: "event",
                chain: "sepolia",
                marketId: matchedMarket.id,
                outcome,
                stakeUsd,
                price
              },
              modelOk: true,
              portfolio: portfolioAfter2,
              executionResults: []
            });
          } else {
            console.warn("[deterministic fallback] No matching event market found for:", marketTitle);
          }
        } catch (error) {
          console.error("[deterministic fallback] Failed to fetch event markets:", error.message);
        }
      }
    }
    const { systemPrompt, userPrompt, isPredictionMarketQuery } = await buildBlossomPrompts({
      userMessage: normalizedUserMessage,
      portfolio: portfolioForPrompt,
      venue: venue || "hyperliquid"
    });
    let assistantMessage = "";
    let actions = [];
    let modelResponse = null;
    const isSwapPrompt = /swap|exchange|convert/i.test(normalizedUserMessage) && (normalizedUserMessage.toLowerCase().includes("usdc") || normalizedUserMessage.toLowerCase().includes("weth") || normalizedUserMessage.toLowerCase().includes("eth"));
    const isDefiPrompt = /park|deposit|earn yield|lend|supply|allocate/i.test(normalizedUserMessage) && (normalizedUserMessage.toLowerCase().includes("usdc") || normalizedUserMessage.toLowerCase().includes("yield") || normalizedUserMessage.toLowerCase().includes("stablecoin") || normalizedUserMessage.toLowerCase().includes("protocol"));
    const isPerpPrompt = /open|long|short|perp/i.test(normalizedUserMessage) && (normalizedUserMessage.toLowerCase().includes("btc") || normalizedUserMessage.toLowerCase().includes("eth") || normalizedUserMessage.toLowerCase().includes("sol") || normalizedUserMessage.toLowerCase().includes("2x") || normalizedUserMessage.toLowerCase().includes("3x") || normalizedUserMessage.toLowerCase().includes("leverage"));
    const isEventPrompt = /bet|wager|risk.*on|event/i.test(normalizedUserMessage) && (normalizedUserMessage.toLowerCase().includes("yes") || normalizedUserMessage.toLowerCase().includes("no") || normalizedUserMessage.toLowerCase().includes("fed") || normalizedUserMessage.toLowerCase().includes("rate cut"));
    const hasOpenAIKey = !!process.env.BLOSSOM_OPENAI_API_KEY;
    const hasAnthropicKey = !!process.env.BLOSSOM_ANTHROPIC_API_KEY;
    const provider = process.env.BLOSSOM_MODEL_PROVIDER || "stub";
    const isStubMode = provider === "stub" || !hasOpenAIKey && !hasAnthropicKey;
    console.log("[api/chat] Stub mode check:", {
      provider,
      hasOpenAIKey,
      hasAnthropicKey,
      isStubMode,
      isPredictionMarketQuery,
      isSwapPrompt,
      userMessage: userMessage.substring(0, 100)
    });
    if (isStubMode && isPredictionMarketQuery) {
      console.log("[api/chat] \u2705 STUB SHORT-CIRCUIT: Building deterministic prediction market response");
      try {
        const { buildPredictionMarketResponse: buildPredictionMarketResponse2 } = await Promise.resolve().then(() => (init_actionParser(), actionParser_exports));
        const accountValue = portfolioForPrompt?.accountValueUsd || 1e4;
        const stubResponse = await buildPredictionMarketResponse2(
          userMessage,
          venue || "hyperliquid",
          accountValue
        );
        assistantMessage = stubResponse.assistantMessage;
        actions = stubResponse.actions;
        modelResponse = {
          assistantMessage,
          actions,
          executionRequest: null,
          modelOk: true
        };
        console.log("[api/chat] \u2705 Stub response built:", {
          messageLength: assistantMessage?.length || 0,
          actionCount: actions.length,
          preview: assistantMessage ? assistantMessage.substring(0, 150) : "N/A"
        });
      } catch (error) {
        console.error("[api/chat] \u274C Failed to build stub prediction market response:", error.message);
        const llmOutput = await callLlm({ systemPrompt, userPrompt });
        modelResponse = await parseModelResponse(llmOutput.rawJson, isSwapPrompt);
        assistantMessage = modelResponse.assistantMessage;
        actions = modelResponse.actions;
      }
    } else {
      console.log("[api/chat] \u2192 Normal LLM flow (stub or real)");
      const normalizedUserMessage2 = normalizeUserInput(userMessage);
      const normalizedUserPrompt = userPrompt.replace(userMessage, normalizedUserMessage2);
      const normalizedIsSwapPrompt = /swap|exchange|convert/i.test(normalizedUserMessage2) && (normalizedUserMessage2.toLowerCase().includes("usdc") || normalizedUserMessage2.toLowerCase().includes("weth") || normalizedUserMessage2.toLowerCase().includes("eth"));
      const normalizedIsDefiPrompt = /park|deposit|earn yield|lend|supply|allocate/i.test(normalizedUserMessage2) && (normalizedUserMessage2.toLowerCase().includes("usdc") || normalizedUserMessage2.toLowerCase().includes("yield") || normalizedUserMessage2.toLowerCase().includes("stablecoin") || normalizedUserMessage2.toLowerCase().includes("protocol"));
      const normalizedIsPerpPrompt = /open|long|short|perp/i.test(normalizedUserMessage2) && (normalizedUserMessage2.toLowerCase().includes("btc") || normalizedUserMessage2.toLowerCase().includes("eth") || normalizedUserMessage2.toLowerCase().includes("sol") || normalizedUserMessage2.toLowerCase().includes("2x") || normalizedUserMessage2.toLowerCase().includes("3x") || normalizedUserMessage2.toLowerCase().includes("leverage"));
      const normalizedIsEventPrompt = /bet|wager|risk.*on|event/i.test(normalizedUserMessage2) && (normalizedUserMessage2.toLowerCase().includes("yes") || normalizedUserMessage2.toLowerCase().includes("no") || normalizedUserMessage2.toLowerCase().includes("fed") || normalizedUserMessage2.toLowerCase().includes("rate cut"));
      try {
        const llmOutput = await callLlm({ systemPrompt, userPrompt: normalizedUserPrompt });
        modelResponse = await parseModelResponse(llmOutput.rawJson, normalizedIsSwapPrompt, normalizedIsDefiPrompt, normalizedUserMessage2, normalizedIsPerpPrompt, normalizedIsEventPrompt);
        assistantMessage = modelResponse.assistantMessage;
        actions = modelResponse.actions;
        const needsFallback = !modelResponse.modelOk || !modelResponse.executionRequest && (normalizedIsSwapPrompt || normalizedIsDefiPrompt || normalizedIsPerpPrompt || normalizedIsEventPrompt);
        if (needsFallback && (normalizedIsSwapPrompt || normalizedIsDefiPrompt || normalizedIsPerpPrompt || normalizedIsEventPrompt)) {
          console.log("[api/chat] Triggering deterministic fallback for execution intent");
          const fallback = await applyDeterministicFallback(normalizedUserMessage2, normalizedIsSwapPrompt, normalizedIsDefiPrompt, normalizedIsPerpPrompt, normalizedIsEventPrompt);
          if (fallback) {
            modelResponse = {
              assistantMessage: fallback.assistantMessage,
              actions: fallback.actions,
              executionRequest: fallback.executionRequest,
              modelOk: true
            };
            assistantMessage = fallback.assistantMessage;
            actions = fallback.actions;
          }
        }
      } catch (error) {
        console.error("LLM call or parsing error:", error.message);
        if (normalizedIsSwapPrompt || normalizedIsDefiPrompt || normalizedIsPerpPrompt || normalizedIsEventPrompt) {
          const fallback = await applyDeterministicFallback(normalizedUserMessage2, normalizedIsSwapPrompt, normalizedIsDefiPrompt, normalizedIsPerpPrompt, normalizedIsEventPrompt);
          if (fallback) {
            modelResponse = {
              assistantMessage: fallback.assistantMessage,
              actions: fallback.actions,
              executionRequest: fallback.executionRequest,
              modelOk: true
            };
            assistantMessage = fallback.assistantMessage;
            actions = fallback.actions;
          } else {
            assistantMessage = generateHelpfulFallback(normalizedUserMessage2, portfolioForPrompt);
            actions = [];
            modelResponse = {
              assistantMessage,
              actions: [],
              executionRequest: null,
              modelOk: true
              // Mark as OK since we're providing helpful guidance
            };
          }
        } else {
          assistantMessage = generateHelpfulFallback(normalizedUserMessage2, portfolioForPrompt);
          actions = [];
          modelResponse = {
            assistantMessage,
            actions: [],
            executionRequest: null,
            modelOk: true
            // Mark as OK since we're providing helpful guidance
          };
        }
      }
    }
    const executionResults = [];
    for (const action of actions) {
      try {
        const result = await applyAction(action);
        executionResults.push(result);
        if (!result.success) {
          const index = actions.indexOf(action);
          if (index > -1) {
            actions.splice(index, 1);
          }
        }
      } catch (error) {
        console.error(`Error applying action:`, error.message);
        const index = actions.indexOf(action);
        if (index > -1) {
          actions.splice(index, 1);
        }
        const portfolioAfter2 = buildPortfolioSnapshot();
        executionResults.push({
          success: false,
          status: "failed",
          error: error.message || "Unknown error",
          portfolio: portfolioAfter2
        });
      }
    }
    const portfolioAfter = buildPortfolioSnapshot();
    const executionRequest = modelResponse?.executionRequest ?? null;
    const modelOk = modelResponse?.modelOk !== false;
    const hasActionableIntent = actions.length > 0 && actions.some(
      (a) => a.type === "perp" || a.type === "event" || a.type === "defi"
    );
    if (hasActionableIntent && !executionRequest) {
      if (process.env.DEBUG_RESPONSE === "true") {
        console.error("[api/chat] MISSING_EXECUTION_REQUEST for actionable intent:", {
          actions: actions.map((a) => ({ type: a.type })),
          modelOk,
          debugHints: {
            modelResponse: modelResponse ? "present" : "missing",
            fallbackApplied: modelResponse?.modelOk === false
          }
        });
      }
      return res.status(200).json({
        ok: false,
        assistantMessage: "I couldn't generate a valid execution plan. Please try rephrasing your request.",
        actions: [],
        executionRequest: null,
        modelOk: false,
        portfolio: portfolioAfter,
        executionResults: [],
        errorCode: "MISSING_EXECUTION_REQUEST"
      });
    }
    let serverDraftId = void 0;
    if (executionRequest) {
      const { v4: uuidv44 } = await import("uuid");
      const accountValue = portfolioAfter.accountValueUsd || 1e4;
      if (executionRequest.kind === "perp") {
        const perpReq = executionRequest;
        const marginUsd = perpReq.marginUsd || accountValue * (perpReq.riskPct || 2) / 100;
        const leverage = perpReq.leverage || 2;
        if (!perpReq.leverage && userMessage.match(/\d+(\.\d+)?x/i)) {
          const mentionedLeverage = userMessage.match(/(\d+(?:\.\d+)?)x/i);
          console.warn(
            `[api/chat] User mentioned ${mentionedLeverage?.[0]} leverage but LLM didn't extract it. Using default ${leverage}x. This is a parsing failure.`
          );
        }
        const notionalUsd = marginUsd * leverage;
        serverDraftId = `draft-${uuidv44()}`;
        const draftStrategy = {
          id: serverDraftId,
          type: "perp",
          status: "draft",
          side: perpReq.side,
          market: perpReq.market || "BTC-USD",
          riskPct: perpReq.riskPct || 2,
          entry: 0,
          // Will be set on execution
          takeProfit: 0,
          stopLoss: 0,
          sourceText: userMessage.substring(0, 200),
          // Truncate for storage
          marginUsd,
          leverage,
          notionalUsd,
          sizeUsd: notionalUsd,
          // For portfolio mapping
          isClosed: false,
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          // Task B: Add routing fields for rich card UI
          routingVenue: "Sepolia Testnet",
          // Will be updated from executionRequest if available
          routingChain: "Sepolia",
          routingSlippage: perpReq.slippageBps ? `${(perpReq.slippageBps / 100).toFixed(2)}%` : "0.5%"
        };
        portfolioAfter.strategies.push(draftStrategy);
        if (process.env.DEBUG_CARD_CONTRACT === "true") {
          console.log("[api/chat] Created perp draft server-side:", {
            draftId: serverDraftId,
            market: draftStrategy.market,
            side: draftStrategy.side,
            marginUsd,
            leverage,
            notionalUsd
          });
        }
      } else if (executionRequest.kind === "event") {
        const eventReq = executionRequest;
        const stakeUsd = eventReq.stakeUsd || 5;
        const riskPct = stakeUsd / accountValue * 100;
        serverDraftId = `draft-${uuidv44()}`;
        const draftStrategy = {
          id: serverDraftId,
          type: "event",
          status: "draft",
          side: eventReq.outcome === "YES" ? "YES" : "NO",
          market: eventReq.marketId || "FED_CUTS_MAR_2025",
          eventKey: eventReq.marketId || "FED_CUTS_MAR_2025",
          label: eventReq.marketId || "Fed Rate Cut",
          riskPct,
          entry: stakeUsd,
          takeProfit: stakeUsd * 2,
          // Estimate
          stopLoss: stakeUsd,
          sourceText: userMessage.substring(0, 200),
          stakeUsd,
          maxPayoutUsd: stakeUsd * 2,
          maxLossUsd: stakeUsd,
          sizeUsd: stakeUsd,
          // For portfolio mapping
          isClosed: false,
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        portfolioAfter.strategies.push(draftStrategy);
        if (process.env.DEBUG_CARD_CONTRACT === "true") {
          console.log("[api/chat] Created event draft server-side:", {
            draftId: serverDraftId,
            marketId: draftStrategy.eventKey,
            outcome: draftStrategy.side,
            stakeUsd
          });
        }
      } else if (executionRequest.kind === "lend" || executionRequest.kind === "lend_supply") {
        const lendReq = executionRequest;
        const amountUsd = parseFloat(lendReq.amount) || 10;
        const riskPct = amountUsd / accountValue * 100;
        const apyPct = 5;
        serverDraftId = `draft-${uuidv44()}`;
        const draftStrategy = {
          id: serverDraftId,
          type: "defi",
          status: "draft",
          protocol: lendReq.vault || lendReq.protocol || "Aave REDACTED",
          vault: lendReq.vault || "Aave REDACTED",
          depositUsd: amountUsd,
          apyPct,
          sourceText: userMessage.substring(0, 200),
          isClosed: false,
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          riskPct,
          sizeUsd: amountUsd,
          // For compatibility with ConfirmTradeCard (expects perp-like fields)
          market: lendReq.vault || lendReq.protocol || "Aave REDACTED",
          side: "long",
          // DeFi deposits are always "long"
          marginUsd: amountUsd,
          // Deposit amount = margin for card display
          leverage: 1,
          // DeFi has no leverage
          notionalUsd: amountUsd,
          // Exposure = deposit amount
          riskPercent: riskPct,
          // ConfirmTradeCard expects riskPercent (not riskPct)
          entry: amountUsd,
          takeProfit: amountUsd * (1 + apyPct / 100),
          // Show APY as take profit
          stopLoss: amountUsd
          // Max loss = deposit amount
        };
        portfolioAfter.strategies.push(draftStrategy);
        if (process.env.DEBUG_CARD_CONTRACT === "true") {
          console.log("[api/chat] Created DeFi/lend draft server-side:", {
            draftId: serverDraftId,
            market: defiMarketLabel,
            amountUsd,
            apyPct
          });
        }
      }
    }
    if (hasActionableIntent && executionRequest && !serverDraftId) {
      if (process.env.DEBUG_CARD_CONTRACT === "true") {
        console.error("[api/chat] WARNING: Actionable intent but no draft created:", {
          executionRequestKind: executionRequest?.kind,
          actions: actions.map((a) => ({ type: a.type }))
        });
      }
    }
    const response = {
      assistantMessage,
      actions,
      executionRequest,
      modelOk,
      portfolio: portfolioAfter,
      executionResults,
      // Include execution results
      errorCode: !modelOk && !executionRequest ? "LLM_REFUSAL" : void 0,
      // Only set LLM_REFUSAL if no executionRequest was generated (even after fallback)
      draftId: serverDraftId
      // Task A: Server-created draft ID for UI to set msg.type + msg.draftId
    };
    if (process.env.DEBUG_CARD_CONTRACT === "true") {
      console.log("[api/chat] Card Contract Debug:", {
        prompt: userMessage.substring(0, 100),
        executionRequestKind: executionRequest?.kind || "none",
        draftCreated: !!serverDraftId,
        draftId: serverDraftId || "none",
        draftLocation: serverDraftId ? "portfolio.strategies" : "none",
        portfolioStrategiesCount: portfolioAfter.strategies.length,
        portfolioStrategiesIds: portfolioAfter.strategies.map((s) => ({ id: s.id, status: s.status, type: s.type }))
      });
    }
    if (process.env.DEBUG_RESPONSE === "true") {
      const redactedResponse = JSON.parse(JSON.stringify(response));
      if (redactedResponse.executionRequest) {
        delete redactedResponse.executionRequest.privateKey;
        delete redactedResponse.executionRequest.signature;
      }
      console.log("[api/chat] Response JSON:", JSON.stringify(redactedResponse, null, 2));
    }
    if (process.env.DEBUG_EXECUTIONS === "1" && executionResults.length > 0) {
      executionResults.forEach((result) => {
        logExecutionArtifact({
          executionRequest,
          executionResult: result,
          userAddress: req.body.clientPortfolio?.userAddress
        });
      });
    }
    logEvent("chat_response", {
      success: modelOk,
      latencyMs: Date.now() - chatStartTime,
      notes: [`actions: ${actions.length}`, executionRequest ? `kind: ${executionRequest.kind}` : "no_exec"]
    });
    const correlationId = req.correlationId || "unknown";
    if (!executionRequest && actions.length === 0) {
      const suspectedIntent = detectSuspectedIntent(userMessage);
      if (suspectedIntent) {
        logPlanMissing(correlationId, suspectedIntent, userMessage);
        if (process.env.NODE_ENV !== "production") {
          response.debug = {
            planMissingReason: "no_executionRequest_from_model",
            suspectedIntent,
            correlationId
          };
        }
      }
    }
    res.json(response);
  } catch (error) {
    console.error("Chat error:", error);
    logEvent("chat_response", {
      success: false,
      error: error.message,
      latencyMs: Date.now() - chatStartTime
    });
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});
app.post("/api/strategy/close", async (req, res) => {
  try {
    const { strategyId, type } = req.body;
    if (!strategyId || !type) {
      return res.status(400).json({ error: "strategyId and type are required" });
    }
    let summaryMessage = "";
    let pnl = 0;
    let eventResult;
    if (type === "perp") {
      const result = await closePerp(strategyId);
      pnl = result.pnl;
      summaryMessage = `Closed ${result.position.market} ${result.position.side} position. Realized PnL: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`;
    } else if (type === "event") {
      const result = await closeEventPosition(strategyId);
      pnl = result.pnl;
      const outcome = result.position.outcome === "won" ? "Won" : "Lost";
      let pnlMessage = `Realized PnL: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`;
      if (result.liveMarkToMarketUsd !== void 0) {
        pnlMessage += ` (Live MTM: ${result.liveMarkToMarketUsd >= 0 ? "+" : ""}$${result.liveMarkToMarketUsd.toFixed(2)})`;
        eventResult = { liveMarkToMarketUsd: result.liveMarkToMarketUsd };
      }
      summaryMessage = `Settled event position "${result.position.label}" (${outcome}). ${pnlMessage}`;
    } else if (type === "defi") {
      const result = closeDefiPosition(strategyId);
      pnl = result.yieldEarned;
      summaryMessage = `Closed ${result.position.protocol} position. Yield earned: $${pnl.toFixed(2)}`;
    } else {
      return res.status(400).json({ error: `Unknown strategy type: ${type}` });
    }
    const portfolio2 = buildPortfolioSnapshot();
    if (type === "event" && eventResult?.liveMarkToMarketUsd !== void 0) {
      const strategyIndex = portfolio2.strategies.findIndex((s) => s.id === strategyId);
      if (strategyIndex >= 0) {
        portfolio2.strategies[strategyIndex] = {
          ...portfolio2.strategies[strategyIndex],
          liveMarkToMarketUsd: eventResult.liveMarkToMarketUsd
        };
      }
    }
    const response = {
      summaryMessage,
      portfolio: portfolio2
    };
    res.json(response);
  } catch (error) {
    console.error("Close strategy error:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});
app.post("/api/reset", async (req, res) => {
  try {
    const { EXECUTION_MODE: EXECUTION_MODE2 } = await Promise.resolve().then(() => (init_config(), config_exports));
    const ALLOW_SIM_MODE2 = process.env.ALLOW_SIM_MODE === "true";
    if (EXECUTION_MODE2 === "sim" && ALLOW_SIM_MODE2) {
      resetAllSims();
      const snapshot = getPortfolioSnapshot();
      res.json({
        portfolio: snapshot,
        message: "Simulation state reset."
      });
      return;
    }
    res.json({
      message: "Chat state reset."
    });
  } catch (err) {
    console.error("Failed to reset state", err);
    res.status(500).json({ error: "Failed to reset state" });
  }
});
app.get("/api/ticker", async (req, res) => {
  try {
    const venue = req.query.venue || "hyperliquid";
    if (venue === "event_demo") {
      const payload = await getEventMarketsTicker();
      res.json({
        venue: payload.venue,
        sections: payload.sections,
        lastUpdatedMs: payload.lastUpdatedMs ?? Date.now(),
        isLive: payload.isLive ?? false,
        source: payload.source ?? "static"
      });
    } else {
      const payload = await getOnchainTicker();
      res.json({
        venue: payload.venue,
        sections: payload.sections,
        lastUpdatedMs: payload.lastUpdatedMs ?? Date.now(),
        isLive: payload.isLive ?? false,
        source: payload.source ?? "static"
      });
    }
  } catch (error) {
    console.error("Ticker error:", error);
    if (req.query.venue === "event_demo") {
      res.json({
        venue: "event_demo",
        sections: [
          {
            id: "kalshi",
            label: "Kalshi",
            items: [
              { label: "Fed cuts in March 2025", value: "62%", meta: "Kalshi" },
              { label: "BTC ETF approved by Dec 31", value: "68%", meta: "Kalshi" }
            ]
          }
        ],
        lastUpdatedMs: Date.now(),
        isLive: false,
        source: "static"
      });
    } else {
      res.json({
        venue: "hyperliquid",
        sections: [
          {
            id: "majors",
            label: "Majors",
            items: [
              { label: "BTC", value: "$60,000", change: "+2.5%", meta: "24h" },
              { label: "ETH", value: "$3,000", change: "+1.8%", meta: "24h" }
            ]
          }
        ],
        lastUpdatedMs: Date.now(),
        isLive: false,
        source: "static"
      });
    }
  }
});
app.post("/api/execute/prepare", maybeCheckAccess, async (req, res) => {
  const correlationId = req.correlationId || generateCorrelationId();
  const prepareStartTime = Date.now();
  const { draftId, executionRequest, userAddress } = req.body || {};
  logExecuteTrace(correlationId, "prepare:start", {
    kind: executionRequest?.kind,
    draftId: draftId?.substring(0, 8),
    userAddress: userAddress?.substring(0, 10)
  });
  try {
    const { EXECUTION_MODE: EXECUTION_MODE2, EXECUTION_DISABLED: EXECUTION_DISABLED2, V1_DEMO: V1_DEMO2 } = await Promise.resolve().then(() => (init_config(), config_exports));
    if (EXECUTION_DISABLED2) {
      return res.status(503).json({
        error: "Execution temporarily disabled",
        errorCode: "EXECUTION_DISABLED",
        message: "Execution has been temporarily disabled. Please try again later."
      });
    }
    if (EXECUTION_MODE2 !== "eth_testnet") {
      return res.status(400).json({
        error: "Execute endpoint only available in eth_testnet mode"
      });
    }
    if (V1_DEMO2 && req.body.authMode !== "session") {
      return res.status(403).json({
        error: "V1_DEMO mode requires session-based execution",
        errorCode: "V1_DEMO_DIRECT_BLOCKED",
        message: "Direct execution is disabled in V1_DEMO mode. Please enable one-click execution first."
      });
    }
    const { prepareEthTestnetExecution: prepareEthTestnetExecution2 } = await Promise.resolve().then(() => (init_ethTestnetExecutor(), ethTestnetExecutor_exports));
    console.log("[api/execute/prepare] Request body:", JSON.stringify(req.body, null, 2));
    const result = await prepareEthTestnetExecution2(req.body);
    const { DEMO_REDACTED_ADDRESS: DEMO_REDACTED_ADDRESS2, DEMO_WETH_ADDRESS: DEMO_WETH_ADDRESS2, EXECUTION_ROUTER_ADDRESS: EXECUTION_ROUTER_ADDRESS2 } = await Promise.resolve().then(() => (init_config(), config_exports));
    const actionTypes = result.plan?.actions?.map((a) => a.actionType) || [];
    logEvent("prepare_success", {
      draftId: req.body.draftId,
      userHash: req.body.userAddress ? hashAddress(req.body.userAddress) : void 0,
      authMode: req.body.authMode,
      actionTypes,
      executionKind: req.body.executionKind,
      latencyMs: Date.now() - prepareStartTime,
      success: true
    });
    logExecuteTrace(correlationId, "prepare:ok", {
      planSteps: result.plan?.actions?.length || 0,
      actionTypes,
      latencyMs: Date.now() - prepareStartTime
    });
    res.json({
      chainId: result.chainId,
      to: result.to,
      value: result.value,
      plan: result.plan,
      planHash: result.planHash,
      // V1: Include server-computed planHash
      typedData: result.typedData,
      call: result.call,
      requirements: result.requirements,
      summary: result.summary,
      warnings: result.warnings,
      routing: result.routing,
      // Include routing metadata for demo swaps
      correlationId,
      // Include correlationId for client tracing
      demoTokens: DEMO_REDACTED_ADDRESS2 && DEMO_WETH_ADDRESS2 ? {
        DEMO_REDACTED: DEMO_REDACTED_ADDRESS2,
        DEMO_WETH: DEMO_WETH_ADDRESS2,
        routerAddress: EXECUTION_ROUTER_ADDRESS2
      } : void 0
    });
  } catch (error) {
    console.error("[api/execute/prepare] Error:", error);
    logExecuteTrace(correlationId, "prepare:error", {
      error: error.message,
      code: error.code || "UNKNOWN",
      latencyMs: Date.now() - prepareStartTime
    });
    logEvent("prepare_fail", {
      draftId: req.body.draftId,
      error: error.message,
      latencyMs: Date.now() - prepareStartTime,
      success: false
    });
    res.status(500).json({
      error: "Failed to prepare execution",
      message: error.message,
      correlationId
      // Include correlationId in error response
    });
  }
});
app.post("/api/setup/approve", maybeCheckAccess, async (req, res) => {
  try {
    const { userAddress, tokenAddress, spenderAddress, amount } = req.body;
    if (!userAddress || !tokenAddress || !spenderAddress || !amount) {
      return res.status(400).json({
        error: "userAddress, tokenAddress, spenderAddress, and amount are required"
      });
    }
    logEvent("approve_prepare", {
      userHash: userAddress ? hashAddress(userAddress) : void 0,
      notes: [tokenAddress.substring(0, 10) + "...", spenderAddress.substring(0, 10) + "..."]
    });
    const { encodeFunctionData } = await import("viem");
    const approveAbi = [
      {
        name: "approve",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
          { name: "spender", type: "address" },
          { name: "amount", type: "uint256" }
        ],
        outputs: [{ name: "", type: "bool" }]
      }
    ];
    const amountBigInt = amount === "MaxUint256" ? BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff") : BigInt(amount);
    const data = encodeFunctionData({
      abi: approveAbi,
      functionName: "approve",
      args: [spenderAddress, amountBigInt]
    });
    const { ETH_TESTNET_CHAIN_ID: ETH_TESTNET_CHAIN_ID3 } = await Promise.resolve().then(() => (init_config(), config_exports));
    res.json({
      chainId: ETH_TESTNET_CHAIN_ID3,
      to: tokenAddress,
      data,
      value: "0x0",
      summary: `Approve ${spenderAddress.substring(0, 10)}... to spend tokens`
    });
  } catch (error) {
    console.error("[api/setup/approve] Error:", error);
    res.status(500).json({
      error: "Failed to prepare approval",
      message: error.message
    });
  }
});
app.post("/api/execute/submit", maybeCheckAccess, async (req, res) => {
  const submitStartTime = Date.now();
  try {
    const { draftId, txHash, userAddress, strategy, executionRequest } = req.body;
    if (!draftId || !txHash) {
      return res.status(400).json({
        error: "draftId and txHash are required"
      });
    }
    logEvent("submit_tx", {
      draftId,
      txHash,
      userHash: userAddress ? hashAddress(userAddress) : void 0
    });
    const portfolioBefore = buildPortfolioSnapshot();
    const { EXECUTION_MODE: EXECUTION_MODE2, ETH_TESTNET_RPC_URL: ETH_TESTNET_RPC_URL2 } = await Promise.resolve().then(() => (init_config(), config_exports));
    let receiptStatus = "confirmed";
    let blockNumber;
    let receiptError;
    if (EXECUTION_MODE2 === "eth_testnet" && ETH_TESTNET_RPC_URL2) {
      const receiptResult = await waitForReceipt(ETH_TESTNET_RPC_URL2, txHash, {
        timeoutMs: 6e4,
        pollMs: 2e3
      });
      receiptStatus = receiptResult.status;
      blockNumber = receiptResult.blockNumber;
      receiptError = receiptResult.error;
      if (receiptStatus === "confirmed") {
        logEvent("tx_confirmed", {
          draftId,
          txHash,
          blockNumber,
          latencyMs: Date.now() - submitStartTime,
          success: true
        });
      } else if (receiptStatus === "failed") {
        logEvent("tx_failed", {
          draftId,
          txHash,
          blockNumber,
          error: receiptError,
          success: false
        });
      } else if (receiptStatus === "timeout") {
        logEvent("tx_timeout", {
          draftId,
          txHash,
          error: receiptError,
          success: false
        });
      }
    }
    if (receiptStatus === "confirmed" && (strategy || executionRequest)) {
      const isPerp = strategy?.instrumentType === "perp" || strategy?.type === "perp" || executionRequest?.kind === "perp";
      const isEvent = strategy?.instrumentType === "event" || strategy?.type === "event" || executionRequest?.kind === "event";
      const isDefi = strategy?.instrumentType === "defi" || strategy?.type === "defi" || executionRequest?.kind === "lend";
      if (isPerp) {
        await openPerp({
          market: strategy?.market || executionRequest?.market || "BTC-USD",
          side: strategy?.side || strategy?.direction || executionRequest?.side || "long",
          riskPct: strategy?.riskPercent || strategy?.riskPct || executionRequest?.riskPct || 2,
          entry: strategy?.entry || executionRequest?.entryPrice || 0,
          takeProfit: strategy?.takeProfit || executionRequest?.takeProfitPrice || 0,
          stopLoss: strategy?.stopLoss || executionRequest?.stopLossPrice || 0
        });
        console.log("[api/execute/submit] Updated perpsSim with new position");
      } else if (isEvent) {
        await openEventPosition(
          strategy?.market || executionRequest?.marketId || "unknown-event",
          strategy?.outcome || strategy?.side || executionRequest?.outcome || "YES",
          strategy?.stakeUsd || executionRequest?.stakeUsd || 10
        );
        console.log("[api/execute/submit] Updated eventSim with new position");
      } else if (isDefi) {
        await openDefiPosition(
          strategy?.protocol || "DemoLend",
          strategy?.depositUsd || executionRequest?.amountUsd || 100
        );
        console.log("[api/execute/submit] Updated defiSim with new position");
      }
    }
    const portfolioAfter = buildPortfolioSnapshot();
    const mappedStatus = receiptStatus === "confirmed" ? "success" : "failed";
    const result = {
      success: receiptStatus === "confirmed",
      status: mappedStatus,
      txHash,
      receiptStatus,
      blockNumber,
      error: receiptError,
      portfolioDelta: {
        accountValueDeltaUsd: portfolioAfter.accountValueUsd - portfolioBefore.accountValueUsd,
        balanceDeltas: portfolioAfter.balances.map((b) => {
          const before = portfolioBefore.balances.find((b2) => b2.symbol === b.symbol);
          return {
            symbol: b.symbol,
            deltaUsd: b.balanceUsd - (before?.balanceUsd || 0)
          };
        })
      },
      portfolio: portfolioAfter
    };
    res.json({
      ...result,
      notes: ["execution_path:direct"]
      // Task 4: Unambiguous evidence of execution path
    });
  } catch (error) {
    console.error("[api/execute/submit] Error:", error);
    logEvent("error", {
      error: error.message,
      notes: ["submit_tx_error"]
    });
    const portfolioAfter = buildPortfolioSnapshot();
    const result = {
      success: false,
      status: "failed",
      error: error.message || "Failed to submit transaction",
      portfolio: portfolioAfter
    };
    res.status(500).json(result);
  }
});
app.get("/api/execute/preflight", async (req, res) => {
  try {
    const { EXECUTION_MODE: EXECUTION_MODE2 } = await Promise.resolve().then(() => (init_config(), config_exports));
    const ALLOW_SIM_MODE2 = process.env.ALLOW_SIM_MODE === "true";
    if (EXECUTION_MODE2 === "sim" && ALLOW_SIM_MODE2) {
      return res.json({
        mode: "sim",
        ok: true,
        notes: ["sim mode"]
      });
    }
    if (EXECUTION_MODE2 === "sim" && !ALLOW_SIM_MODE2) {
    }
    if (EXECUTION_MODE2 !== "eth_testnet") {
      return res.status(400).json({
        error: "Preflight endpoint only available in sim or eth_testnet mode"
      });
    }
    const {
      ETH_TESTNET_RPC_URL: ETH_TESTNET_RPC_URL2,
      EXECUTION_ROUTER_ADDRESS: EXECUTION_ROUTER_ADDRESS2,
      MOCK_SWAP_ADAPTER_ADDRESS: MOCK_SWAP_ADAPTER_ADDRESS2,
      requireEthTestnetConfig: requireEthTestnetConfig2
    } = await Promise.resolve().then(() => (init_config(), config_exports));
    const notes = [];
    let ok = true;
    try {
      requireEthTestnetConfig2();
    } catch (error) {
      ok = false;
      notes.push(`Config error: ${error.message}`);
    }
    let rpcOk = false;
    if (ETH_TESTNET_RPC_URL2) {
      try {
        const response = await fetch(ETH_TESTNET_RPC_URL2, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_blockNumber",
            params: []
          })
        });
        rpcOk = response.ok;
        if (!rpcOk) {
          notes.push("RPC call failed");
        }
      } catch (error) {
        notes.push(`RPC error: ${error.message}`);
      }
    } else {
      notes.push("ETH_TESTNET_RPC_URL not configured");
    }
    let routerOk = false;
    if (EXECUTION_ROUTER_ADDRESS2 && ETH_TESTNET_RPC_URL2 && rpcOk) {
      try {
        const { eth_getCode: eth_getCode2 } = await Promise.resolve().then(() => (init_evmRpc(), evmRpc_exports));
        const code = await eth_getCode2(ETH_TESTNET_RPC_URL2, EXECUTION_ROUTER_ADDRESS2);
        routerOk = code !== "0x" && code.length > 2;
        if (!routerOk) {
          notes.push("Router contract not deployed at EXECUTION_ROUTER_ADDRESS");
        }
      } catch (error) {
        notes.push(`Router check error: ${error.message}`);
      }
    } else {
      notes.push("Cannot check router: missing EXECUTION_ROUTER_ADDRESS or RPC");
    }
    let adapterOk = false;
    if (routerOk && MOCK_SWAP_ADAPTER_ADDRESS2 && ETH_TESTNET_RPC_URL2) {
      try {
        const { eth_call: eth_call2 } = await Promise.resolve().then(() => (init_evmRpc(), evmRpc_exports));
        const { encodeFunctionData } = await import("viem");
        if (!EXECUTION_ROUTER_ADDRESS2) {
          throw new Error("EXECUTION_ROUTER_ADDRESS not configured");
        }
        const data = encodeFunctionData({
          abi: [
            {
              name: "isAdapterAllowed",
              type: "function",
              stateMutability: "view",
              inputs: [{ name: "", type: "address" }],
              outputs: [{ name: "", type: "bool" }]
            }
          ],
          functionName: "isAdapterAllowed",
          args: [MOCK_SWAP_ADAPTER_ADDRESS2]
        });
        console.log("[preflight] Adapter check:", {
          method: "eth_call",
          to: EXECUTION_ROUTER_ADDRESS2,
          data,
          dataLength: data.length
        });
        if (!data || !data.startsWith("0x") || data.length < 4) {
          throw new Error(`Invalid call data: ${data}`);
        }
        const result = await eth_call2(ETH_TESTNET_RPC_URL2, EXECUTION_ROUTER_ADDRESS2, data);
        const { decodeBool: decodeBool2 } = await Promise.resolve().then(() => (init_evmRpc(), evmRpc_exports));
        adapterOk = decodeBool2(result);
        if (!adapterOk) {
          notes.push("Adapter not allowlisted in router");
        }
      } catch (error) {
        notes.push(`Adapter check error: ${error.message}`);
        console.error("[preflight] Adapter check failed:", error);
      }
    }
    let nonceOk = false;
    if (routerOk && ETH_TESTNET_RPC_URL2) {
      try {
        if (!EXECUTION_ROUTER_ADDRESS2) {
          throw new Error("EXECUTION_ROUTER_ADDRESS not configured");
        }
        const testAddress = "0x" + "1".repeat(40);
        console.log("[preflight] Nonce check:", {
          method: "eth_getTransactionCount",
          address: testAddress
        });
        const response = await fetch(ETH_TESTNET_RPC_URL2, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_getTransactionCount",
            params: [testAddress.toLowerCase(), "latest"]
          })
        });
        const jsonResult = await response.json();
        const result = jsonResult;
        if (result.error) {
          throw new Error(`RPC error: ${result.error.message || "Unknown error"}`);
        }
        nonceOk = result.result !== void 0;
      } catch (error) {
        notes.push(`Nonce check error: ${error.message}`);
        console.error("[preflight] Nonce check failed:", error);
      }
    }
    if (!rpcOk || !routerOk || !adapterOk || !nonceOk) {
      ok = false;
    }
    const {
      ROUTING_MODE: ROUTING_MODE3,
      ONEINCH_API_KEY: ONEINCH_API_KEY2,
      EXECUTION_SWAP_MODE: EXECUTION_SWAP_MODE2
    } = await Promise.resolve().then(() => (init_config(), config_exports));
    let oneinchOk = false;
    if (ONEINCH_API_KEY2) {
      try {
        const testResponse = await fetch(
          `https://api.1inch.dev/swap/v6.0/11155111/quote?src=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48&dst=0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2&amount=1000000`,
          {
            headers: {
              "Authorization": `Bearer ${ONEINCH_API_KEY2}`,
              "Accept": "application/json"
            },
            signal: AbortSignal.timeout(3e3)
            // 3s timeout
          }
        );
        oneinchOk = testResponse.ok;
      } catch (error) {
        oneinchOk = false;
      }
    }
    const routingStatus = {
      mode: ROUTING_MODE3,
      liveRoutingEnabled: ROUTING_MODE3 === "hybrid",
      hasApiKey: !!ONEINCH_API_KEY2,
      connectivityOk: oneinchOk,
      executionMode: EXECUTION_SWAP_MODE2
    };
    if (ROUTING_MODE3 === "hybrid") {
      if (oneinchOk) {
        notes.push("Live routing: enabled (1inch - connected)");
      } else {
        notes.push("Live routing: enabled (1inch - API key present but connectivity check failed)");
      }
    } else {
      notes.push("Live routing: disabled (deterministic fallback)");
    }
    if (EXECUTION_SWAP_MODE2 === "demo") {
      notes.push("Swap execution: deterministic demo venue");
    }
    const {
      DEMO_LEND_VAULT_ADDRESS: DEMO_LEND_VAULT_ADDRESS2,
      DEMO_LEND_ADAPTER_ADDRESS: DEMO_LEND_ADAPTER_ADDRESS2,
      LENDING_EXECUTION_MODE: LENDING_EXECUTION_MODE2,
      LENDING_RATE_SOURCE: LENDING_RATE_SOURCE2,
      AAVE_SEPOLIA_POOL_ADDRESS: AAVE_SEPOLIA_POOL_ADDRESS2,
      AAVE_ADAPTER_ADDRESS: AAVE_ADAPTER_ADDRESS2
    } = await Promise.resolve().then(() => (init_config(), config_exports));
    let defillamaOk = false;
    if (LENDING_RATE_SOURCE2 === "defillama") {
      try {
        const testResponse = await fetch("https://yields.llama.fi/pools", {
          headers: { "Accept": "application/json" },
          signal: AbortSignal.timeout(3e3)
          // 3s timeout
        });
        defillamaOk = testResponse.ok;
      } catch (error) {
        defillamaOk = false;
      }
    }
    const hasAaveConfig = !!AAVE_SEPOLIA_POOL_ADDRESS2 && !!AAVE_ADAPTER_ADDRESS2;
    const isRealAave = LENDING_EXECUTION_MODE2 === "real" && hasAaveConfig;
    const lendingStatus = {
      enabled: isRealAave || !!DEMO_LEND_VAULT_ADDRESS2 && !!DEMO_LEND_ADAPTER_ADDRESS2,
      mode: LENDING_EXECUTION_MODE2 || "demo",
      vault: isRealAave ? AAVE_SEPOLIA_POOL_ADDRESS2 : DEMO_LEND_VAULT_ADDRESS2 || null,
      adapter: isRealAave ? AAVE_ADAPTER_ADDRESS2 : DEMO_LEND_ADAPTER_ADDRESS2 || null,
      rateSource: LENDING_RATE_SOURCE2 || "demo",
      defillamaOk
    };
    if (lendingStatus.enabled) {
      if (isRealAave) {
        notes.push(`Lending: enabled (${lendingStatus.mode}, Aave V3 Sepolia)`);
      } else if (LENDING_RATE_SOURCE2 === "defillama" && defillamaOk) {
        notes.push(`Lending: enabled (${lendingStatus.mode}, DefiLlama - connected)`);
      } else if (LENDING_RATE_SOURCE2 === "defillama") {
        notes.push(`Lending: enabled (${lendingStatus.mode}, DefiLlama - connectivity check failed)`);
      } else {
        notes.push(`Lending: enabled (${lendingStatus.mode})`);
      }
    } else {
      if (LENDING_EXECUTION_MODE2 === "real" && !hasAaveConfig) {
        notes.push("Lending: disabled (real mode requested but AAVE_SEPOLIA_POOL_ADDRESS or AAVE_ADAPTER_ADDRESS not configured)");
      } else {
        notes.push("Lending: disabled (vault or adapter not configured)");
      }
    }
    const {
      DFLOW_ENABLED: DFLOW_ENABLED3,
      DFLOW_API_KEY: DFLOW_API_KEY3,
      DFLOW_BASE_URL: DFLOW_BASE_URL2,
      DFLOW_EVENTS_MARKETS_PATH: DFLOW_EVENTS_MARKETS_PATH2,
      DFLOW_EVENTS_QUOTE_PATH: DFLOW_EVENTS_QUOTE_PATH2,
      DFLOW_SWAPS_QUOTE_PATH: DFLOW_SWAPS_QUOTE_PATH2,
      DFLOW_REQUIRE: DFLOW_REQUIRE2
    } = await Promise.resolve().then(() => (init_config(), config_exports));
    const dflowStatus = {
      enabled: DFLOW_ENABLED3,
      ok: DFLOW_ENABLED3 && !!DFLOW_API_KEY3 && !!DFLOW_BASE_URL2,
      required: DFLOW_REQUIRE2,
      capabilities: {
        eventsMarkets: DFLOW_ENABLED3 && !!DFLOW_EVENTS_MARKETS_PATH2,
        eventsQuotes: DFLOW_ENABLED3 && !!DFLOW_EVENTS_QUOTE_PATH2,
        swapsQuotes: DFLOW_ENABLED3 && !!DFLOW_SWAPS_QUOTE_PATH2
      }
    };
    if (DFLOW_ENABLED3) {
      if (dflowStatus.ok) {
        const caps = [];
        if (dflowStatus.capabilities.eventsMarkets) caps.push("events-markets");
        if (dflowStatus.capabilities.eventsQuotes) caps.push("events-quotes");
        if (dflowStatus.capabilities.swapsQuotes) caps.push("swaps-quotes");
        notes.push(`dFlow: enabled (${caps.join(", ") || "no capabilities"})`);
      } else {
        notes.push("dFlow: enabled but not configured (missing API_KEY or BASE_URL)");
        if (DFLOW_REQUIRE2) {
          ok = false;
          notes.push("dFlow is required but not properly configured");
        }
      }
    } else {
      notes.push("dFlow: disabled");
    }
    if (ROUTING_MODE3 === "dflow" && dflowStatus.capabilities.swapsQuotes) {
      notes.push("Live routing: enabled (dFlow)");
    }
    const {
      PROOF_ADAPTER_ADDRESS: PROOF_ADAPTER_ADDRESS2,
      ERC20_PULL_ADAPTER_ADDRESS: ERC20_PULL_ADAPTER_ADDRESS2,
      UNISWAP_V3_ADAPTER_ADDRESS: UNISWAP_V3_ADAPTER_ADDRESS2,
      WETH_WRAP_ADAPTER_ADDRESS: WETH_WRAP_ADAPTER_ADDRESS2
    } = await Promise.resolve().then(() => (init_config(), config_exports));
    const allowedAdapters = [];
    if (UNISWAP_V3_ADAPTER_ADDRESS2) {
      allowedAdapters.push(UNISWAP_V3_ADAPTER_ADDRESS2.toLowerCase());
    }
    if (WETH_WRAP_ADAPTER_ADDRESS2) {
      allowedAdapters.push(WETH_WRAP_ADAPTER_ADDRESS2.toLowerCase());
    }
    if (MOCK_SWAP_ADAPTER_ADDRESS2) {
      allowedAdapters.push(MOCK_SWAP_ADAPTER_ADDRESS2.toLowerCase());
    }
    if (PROOF_ADAPTER_ADDRESS2) {
      allowedAdapters.push(PROOF_ADAPTER_ADDRESS2.toLowerCase());
    }
    if (ERC20_PULL_ADAPTER_ADDRESS2) {
      allowedAdapters.push(ERC20_PULL_ADAPTER_ADDRESS2.toLowerCase());
    }
    if (DEMO_LEND_ADAPTER_ADDRESS2) {
      allowedAdapters.push(DEMO_LEND_ADAPTER_ADDRESS2.toLowerCase());
    }
    if (AAVE_ADAPTER_ADDRESS2) {
      allowedAdapters.push(AAVE_ADAPTER_ADDRESS2.toLowerCase());
    }
    res.json({
      mode: "eth_testnet",
      ok,
      chainId: 11155111,
      executionRouterAddress: EXECUTION_ROUTER_ADDRESS2 || null,
      allowedAdapters,
      router: EXECUTION_ROUTER_ADDRESS2 || null,
      // Legacy field
      adapter: MOCK_SWAP_ADAPTER_ADDRESS2 || null,
      // Legacy field
      rpc: rpcOk,
      routing: routingStatus,
      lending: lendingStatus,
      dflow: dflowStatus,
      notes
    });
  } catch (error) {
    console.error("[api/execute/preflight] Error:", error);
    res.status(500).json({
      error: "Failed to run preflight check",
      message: error.message
    });
  }
});
var sessionEndpointCooldowns = /* @__PURE__ */ new Map();
var SESSION_COOLDOWN_MS = 1500;
function checkSessionCooldown(endpoint) {
  const now = Date.now();
  const lastCall = sessionEndpointCooldowns.get(endpoint);
  if (lastCall && now - lastCall < SESSION_COOLDOWN_MS) {
    return false;
  }
  sessionEndpointCooldowns.set(endpoint, now);
  return true;
}
app.post("/api/session/prepare", async (req, res) => {
  const correlationId = req.correlationId || generateCorrelationId();
  const bodyKeys = req.body ? Object.keys(req.body) : [];
  logSessionTrace(correlationId, "prepare:start", {
    hasBody: !!req.body,
    bodyKeys
  });
  try {
    const { EXECUTION_MODE: EXECUTION_MODE2, EXECUTION_AUTH_MODE: EXECUTION_AUTH_MODE2 } = await Promise.resolve().then(() => (init_config(), config_exports));
    const userAddress = req.body?.userAddress || req.body?.address || req.query?.userAddress || req.query?.address;
    const cooldownKey = `prepare-${userAddress || "empty"}`;
    const inCooldown = !checkSessionCooldown(cooldownKey);
    if (inCooldown && process.env.DEBUG_SESSION !== "true") {
    } else if (process.env.DEBUG_SESSION === "true") {
      console.log("[api/session/prepare] Request:", { userAddress, EXECUTION_MODE: EXECUTION_MODE2, EXECUTION_AUTH_MODE: EXECUTION_AUTH_MODE2 });
    }
    if (EXECUTION_MODE2 !== "eth_testnet" || EXECUTION_AUTH_MODE2 !== "session") {
      return res.json({
        ok: true,
        status: "disabled",
        // Top-level status field for UI
        session: {
          enabled: false,
          reason: "NOT_CONFIGURED",
          required: ["EXECUTION_MODE=eth_testnet", "EXECUTION_AUTH_MODE=session"]
        },
        correlationId,
        cooldownMs: SESSION_COOLDOWN_MS
      });
    }
    if (!userAddress || typeof userAddress !== "string") {
      logSessionTrace(correlationId, "prepare:error", {
        error: "Missing userAddress",
        code: "MISSING_USER_ADDRESS"
      });
      return res.status(400).json({
        ok: false,
        correlationId,
        error: {
          code: "MISSING_USER_ADDRESS",
          message: "userAddress (or address) is required in request body"
        }
      });
    }
    logSessionTrace(correlationId, "prepare:validated", {
      userAddress: userAddress.substring(0, 10) + "..."
    });
    logEvent("session_prepare", {
      userHash: hashAddress(userAddress),
      authMode: "session"
    });
    const {
      EXECUTION_ROUTER_ADDRESS: EXECUTION_ROUTER_ADDRESS2,
      MOCK_SWAP_ADAPTER_ADDRESS: MOCK_SWAP_ADAPTER_ADDRESS2,
      UNISWAP_V3_ADAPTER_ADDRESS: UNISWAP_V3_ADAPTER_ADDRESS2,
      WETH_WRAP_ADAPTER_ADDRESS: WETH_WRAP_ADAPTER_ADDRESS2,
      ERC20_PULL_ADAPTER_ADDRESS: ERC20_PULL_ADAPTER_ADDRESS2,
      PROOF_ADAPTER_ADDRESS: PROOF_ADAPTER_ADDRESS2,
      DEMO_LEND_ADAPTER_ADDRESS: DEMO_LEND_ADAPTER_ADDRESS2,
      AAVE_ADAPTER_ADDRESS: AAVE_ADAPTER_ADDRESS2,
      RELAYER_PRIVATE_KEY: RELAYER_PRIVATE_KEY2,
      ETH_TESTNET_RPC_URL: ETH_TESTNET_RPC_URL2,
      requireRelayerConfig: requireRelayerConfig2
    } = await Promise.resolve().then(() => (init_config(), config_exports));
    requireRelayerConfig2();
    if (process.env.NODE_ENV !== "production") {
      try {
        const { createPublicClient: createPublicClient3, http: http5 } = await import("viem");
        const { sepolia: sepolia5 } = await import("viem/chains");
        const publicClient = createPublicClient3({
          chain: sepolia5,
          transport: http5(ETH_TESTNET_RPC_URL2)
        });
        const chainId = await publicClient.getChainId();
        const routerCode = await publicClient.getBytecode({ address: EXECUTION_ROUTER_ADDRESS2 });
        const routerIsContract = routerCode && routerCode !== "0x" && routerCode.length > 2;
        logSessionTrace(correlationId, "prepare:diagnostics", {
          chainId,
          routerAddress: EXECUTION_ROUTER_ADDRESS2,
          routerIsContract,
          routerCodeLength: routerCode?.length || 0
        });
      } catch (diagError) {
        logSessionTrace(correlationId, "prepare:diagnostics:error", {
          error: diagError.message
        });
      }
    }
    const { keccak256, toBytes, parseUnits: parseUnits3 } = await import("viem");
    const sessionId = keccak256(
      toBytes(userAddress + Date.now().toString())
    );
    console.log("[session/prepare] Generated sessionId:", sessionId);
    console.log("[session/prepare] For userAddress:", userAddress);
    const { privateKeyToAccount: privateKeyToAccount3 } = await import("viem/accounts");
    const relayerAccount = privateKeyToAccount3(RELAYER_PRIVATE_KEY2);
    const executor = relayerAccount.address;
    const expiresAt = BigInt(Math.floor(Date.now() / 1e3) + 7 * 24 * 60 * 60);
    const maxSpend = BigInt(parseUnits3("10", 18));
    const allowedAdapters = [];
    if (MOCK_SWAP_ADAPTER_ADDRESS2) {
      allowedAdapters.push(MOCK_SWAP_ADAPTER_ADDRESS2.toLowerCase());
    }
    if (UNISWAP_V3_ADAPTER_ADDRESS2) {
      allowedAdapters.push(UNISWAP_V3_ADAPTER_ADDRESS2.toLowerCase());
    }
    if (WETH_WRAP_ADAPTER_ADDRESS2) {
      allowedAdapters.push(WETH_WRAP_ADAPTER_ADDRESS2.toLowerCase());
    }
    if (ERC20_PULL_ADAPTER_ADDRESS2) {
      allowedAdapters.push(ERC20_PULL_ADAPTER_ADDRESS2.toLowerCase());
    }
    if (PROOF_ADAPTER_ADDRESS2) {
      allowedAdapters.push(PROOF_ADAPTER_ADDRESS2.toLowerCase());
    }
    if (DEMO_LEND_ADAPTER_ADDRESS2) {
      allowedAdapters.push(DEMO_LEND_ADAPTER_ADDRESS2.toLowerCase());
    }
    if (AAVE_ADAPTER_ADDRESS2) {
      allowedAdapters.push(AAVE_ADAPTER_ADDRESS2.toLowerCase());
    }
    if (allowedAdapters.length === 0) {
      return res.status(400).json({
        error: "No adapters configured. At least one adapter must be configured."
      });
    }
    const { encodeFunctionData } = await import("viem");
    const createSessionAbi = [
      {
        name: "createSession",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
          { name: "sessionId", type: "bytes32" },
          { name: "executor", type: "address" },
          { name: "expiresAt", type: "uint64" },
          { name: "maxSpend", type: "uint256" },
          { name: "allowedAdapters", type: "address[]" }
        ],
        outputs: []
      }
    ];
    const data = encodeFunctionData({
      abi: createSessionAbi,
      functionName: "createSession",
      args: [
        sessionId,
        executor,
        BigInt(expiresAt),
        maxSpend,
        allowedAdapters
      ]
    });
    const encodedSessionId = "0x" + data.slice(10, 74);
    console.log("[session/prepare] Encoded data sessionId:", encodedSessionId);
    console.log("[session/prepare] SessionIds match:", sessionId.toLowerCase() === encodedSessionId.toLowerCase());
    const capabilitySnapshot = {
      sessionId,
      caps: {
        maxSpend: maxSpend.toString(),
        maxSpendUsd: "10000",
        // Approximate USD value of 10 ETH
        expiresAt: expiresAt.toString(),
        expiresAtIso: new Date(Number(expiresAt) * 1e3).toISOString()
      },
      allowlistedAdapters: allowedAdapters,
      approvals: [],
      // V1: Router approval handled during session creation
      expiresAt: Number(expiresAt)
    };
    const txTo = EXECUTION_ROUTER_ADDRESS2;
    const txData = data;
    const txFieldsPresent = {
      to: !!txTo,
      data: !!txData,
      sessionId: !!sessionId
    };
    logSessionTrace(correlationId, "prepare:txBuilt", {
      txFieldsPresent,
      toLength: txTo?.length || 0,
      dataLength: txData?.length || 0
    });
    if (!txTo || !txData || !sessionId) {
      const missingFields = [];
      if (!txTo) missingFields.push("to (EXECUTION_ROUTER_ADDRESS)");
      if (!txData) missingFields.push("data (encoded function call)");
      if (!sessionId) missingFields.push("sessionId");
      logSessionTrace(correlationId, "prepare:error", {
        error: "Missing transaction fields",
        code: "MISSING_TX_FIELDS",
        missingFields
      });
      return res.status(500).json({
        ok: false,
        correlationId,
        error: {
          code: "MISSING_TX_FIELDS",
          message: `Failed to build transaction: missing ${missingFields.join(", ")}`,
          missingFields
        }
      });
    }
    const prepareResponse = {
      ok: true,
      status: "preparing",
      // Top-level status field for UI
      session: {
        enabled: true,
        sessionId,
        to: txTo,
        data: txData,
        value: "0x0",
        summary: `Create session for ${userAddress.substring(0, 10)}... with executor ${executor.substring(0, 10)}...`,
        capabilitySnapshot
        // V1: Include capability snapshot
      },
      correlationId,
      // Include correlationId for client tracing
      cooldownMs: SESSION_COOLDOWN_MS
    };
    if (process.env.DEBUG_RESPONSE === "true") {
      const redactedResponse = JSON.parse(JSON.stringify(prepareResponse));
      if (redactedResponse.session?.data) {
        redactedResponse.session.data = redactedResponse.session.data.substring(0, 20) + "...";
      }
      console.log("[api/session/prepare] Response JSON:", JSON.stringify(redactedResponse, null, 2));
    }
    logSessionTrace(correlationId, "prepare:ok", {
      sessionId: sessionId.substring(0, 10) + "...",
      userAddress: userAddress.substring(0, 10) + "...",
      expiresAt: expiresAt.toString(),
      // Convert BigInt to string for JSON
      txFieldsPresent
    });
    res.json(prepareResponse);
  } catch (error) {
    const errorInfo = {
      error: error.message,
      code: error.code || "UNKNOWN",
      name: error.name
    };
    if (process.env.NODE_ENV !== "production") {
      errorInfo.stack = error.stack;
      errorInfo.cause = error.cause;
    }
    logSessionTrace(correlationId, "prepare:error", errorInfo);
    if (process.env.DEBUG_SESSION === "true" || process.env.NODE_ENV !== "production") {
      console.error(`[${correlationId}] [api/session/prepare] Error:`, error);
    }
    res.status(500).json({
      ok: false,
      correlationId,
      error: {
        code: error.code || "INTERNAL_ERROR",
        message: error.message || "Failed to prepare session",
        ...process.env.NODE_ENV !== "production" ? { stack: error.stack } : {}
      }
    });
  }
});
app.post("/api/execute/relayed", maybeCheckAccess, async (req, res) => {
  console.log("[api/execute/relayed] Handler invoked - DEBUG MARKER V2");
  const correlationId = req.correlationId || generateCorrelationId();
  const relayedStartTime = Date.now();
  const { sessionId, plan, userAddress } = req.body || {};
  logExecuteTrace(correlationId, "relayed:start", {
    sessionId: sessionId?.substring(0, 10),
    userAddress: userAddress?.substring(0, 10),
    planActions: plan?.actions?.length
  });
  try {
    const { EXECUTION_MODE: EXECUTION_MODE2, EXECUTION_AUTH_MODE: EXECUTION_AUTH_MODE2, EXECUTION_DISABLED: EXECUTION_DISABLED2, V1_DEMO: V1_DEMO2 } = await Promise.resolve().then(() => (init_config(), config_exports));
    if (EXECUTION_DISABLED2) {
      return res.status(503).json({
        error: "Execution temporarily disabled",
        errorCode: "EXECUTION_DISABLED",
        message: "Execution has been temporarily disabled. Please try again later."
      });
    }
    if (V1_DEMO2 && req.body.plan && req.body.plan.actions && req.body.plan.actions.length !== 1) {
      return res.status(400).json({
        error: "V1_DEMO mode requires single-action plans",
        errorCode: "V1_DEMO_MULTI_ACTION_REJECTED",
        message: `Plan has ${req.body.plan.actions.length} actions. V1_DEMO mode only allows single-action plans.`
      });
    }
    let sessionEnabled = false;
    if (EXECUTION_MODE2 === "eth_testnet" && EXECUTION_AUTH_MODE2 === "session") {
      try {
        const { RELAYER_PRIVATE_KEY: RELAYER_PRIVATE_KEY2, EXECUTION_ROUTER_ADDRESS: EXECUTION_ROUTER_ADDRESS3, ETH_TESTNET_RPC_URL: ETH_TESTNET_RPC_URL3 } = await Promise.resolve().then(() => (init_config(), config_exports));
        if (RELAYER_PRIVATE_KEY2 && EXECUTION_ROUTER_ADDRESS3 && ETH_TESTNET_RPC_URL3) {
          try {
            const codeResponse = await Promise.race([
              fetch(ETH_TESTNET_RPC_URL3, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  jsonrpc: "2.0",
                  id: 1,
                  method: "eth_getCode",
                  params: [EXECUTION_ROUTER_ADDRESS3, "latest"]
                })
              }),
              new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1e3))
            ]);
            if (codeResponse.ok) {
              const codeData = await codeResponse.json();
              const code = codeData.result || "0x";
              sessionEnabled = code !== "0x" && code.length > 2;
            }
          } catch (error) {
            sessionEnabled = false;
          }
        }
      } catch (error) {
        sessionEnabled = false;
      }
    }
    if (!sessionEnabled) {
      const portfolioAfter2 = buildPortfolioSnapshot();
      return res.json({
        success: true,
        status: "success",
        notes: ["session_disabled_fell_back_to_direct"],
        portfolio: portfolioAfter2,
        chainId: 11155111
      });
    }
    const { draftId, userAddress: userAddress2, plan: plan2, sessionId: sessionId2 } = req.body;
    if (!draftId || !userAddress2 || !plan2 || !sessionId2) {
      const portfolioAfter2 = buildPortfolioSnapshot();
      return res.json({
        success: true,
        status: "success",
        notes: ["session_disabled_fell_back_to_direct", "missing_required_fields"],
        portfolio: portfolioAfter2,
        chainId: 11155111
      });
    }
    const guardConfig = await Promise.resolve().then(() => (init_config(), config_exports));
    const EXECUTION_ROUTER_ADDRESS2 = guardConfig.EXECUTION_ROUTER_ADDRESS;
    const UNISWAP_V3_ADAPTER_ADDRESS2 = guardConfig.UNISWAP_V3_ADAPTER_ADDRESS;
    const WETH_WRAP_ADAPTER_ADDRESS2 = guardConfig.WETH_WRAP_ADAPTER_ADDRESS;
    const MOCK_SWAP_ADAPTER_ADDRESS2 = guardConfig.MOCK_SWAP_ADAPTER_ADDRESS;
    const REDACTED_ADDRESS_SEPOLIA2 = guardConfig.REDACTED_ADDRESS_SEPOLIA;
    const WETH_ADDRESS_SEPOLIA2 = guardConfig.WETH_ADDRESS_SEPOLIA;
    if (!plan2.actions || !Array.isArray(plan2.actions)) {
      return res.status(400).json({
        error: "Plan must have actions array"
      });
    }
    if (plan2.actions.length > 4) {
      return res.status(400).json({
        error: `Plan exceeds maximum action count (4). Got ${plan2.actions.length} actions.`
      });
    }
    if (plan2.actions.length === 0) {
      return res.status(400).json({
        error: "Plan must have at least one action"
      });
    }
    const adapterConfig = await Promise.resolve().then(() => (init_config(), config_exports));
    const PROOF_ADAPTER_ADDRESS2 = adapterConfig.PROOF_ADAPTER_ADDRESS;
    const ERC20_PULL_ADAPTER_ADDRESS2 = adapterConfig.ERC20_PULL_ADAPTER_ADDRESS;
    const DEMO_LEND_ADAPTER_ADDRESS2 = adapterConfig.DEMO_LEND_ADAPTER_ADDRESS;
    const AAVE_ADAPTER_ADDRESS_RELAYED = adapterConfig.AAVE_ADAPTER_ADDRESS;
    const allowedAdapters = /* @__PURE__ */ new Set();
    if (UNISWAP_V3_ADAPTER_ADDRESS2) {
      allowedAdapters.add(UNISWAP_V3_ADAPTER_ADDRESS2.toLowerCase());
    }
    if (WETH_WRAP_ADAPTER_ADDRESS2) {
      allowedAdapters.add(WETH_WRAP_ADAPTER_ADDRESS2.toLowerCase());
    }
    if (MOCK_SWAP_ADAPTER_ADDRESS2) {
      allowedAdapters.add(MOCK_SWAP_ADAPTER_ADDRESS2.toLowerCase());
    }
    if (PROOF_ADAPTER_ADDRESS2) {
      allowedAdapters.add(PROOF_ADAPTER_ADDRESS2.toLowerCase());
    }
    if (ERC20_PULL_ADAPTER_ADDRESS2) {
      allowedAdapters.add(ERC20_PULL_ADAPTER_ADDRESS2.toLowerCase());
    }
    if (DEMO_LEND_ADAPTER_ADDRESS2) {
      allowedAdapters.add(DEMO_LEND_ADAPTER_ADDRESS2.toLowerCase());
    }
    if (AAVE_ADAPTER_ADDRESS_RELAYED) {
      allowedAdapters.add(AAVE_ADAPTER_ADDRESS_RELAYED.toLowerCase());
    }
    for (const action of plan2.actions) {
      const adapter = action.adapter?.toLowerCase();
      if (!adapter) {
        return res.status(400).json({
          ok: false,
          error: {
            code: "ADAPTER_MISSING",
            message: "Action missing adapter address"
          },
          correlationId
        });
      }
      if (!allowedAdapters.has(adapter)) {
        return res.status(400).json({
          ok: false,
          error: {
            code: "ADAPTER_NOT_ALLOWED",
            adapter,
            allowedAdapters: Array.from(allowedAdapters),
            message: `Adapter ${adapter} not allowed. Allowed adapters: ${Array.from(allowedAdapters).join(", ")}`
          },
          correlationId
        });
      }
    }
    const now = Math.floor(Date.now() / 1e3);
    const deadline = parseInt(plan2.deadline);
    const maxDeadline = now + 10 * 60;
    if (deadline > maxDeadline) {
      return res.status(400).json({
        error: `Plan deadline too far in future. Maximum: ${maxDeadline} (10 minutes), got: ${deadline}`
      });
    }
    if (deadline <= now) {
      return res.status(400).json({
        error: "Plan deadline must be in the future"
      });
    }
    const { AAVE_REDACTED_ADDRESS: AAVE_REDACTED_ADDRESS2, AAVE_WETH_ADDRESS: AAVE_WETH_ADDRESS3 } = await Promise.resolve().then(() => (init_config(), config_exports));
    const allowedTokens = /* @__PURE__ */ new Set();
    if (WETH_ADDRESS_SEPOLIA2) {
      allowedTokens.add(WETH_ADDRESS_SEPOLIA2.toLowerCase());
    }
    if (REDACTED_ADDRESS_SEPOLIA2) {
      allowedTokens.add(REDACTED_ADDRESS_SEPOLIA2.toLowerCase());
    }
    if (AAVE_REDACTED_ADDRESS2) {
      allowedTokens.add(AAVE_REDACTED_ADDRESS2.toLowerCase());
    }
    if (AAVE_WETH_ADDRESS3) {
      allowedTokens.add(AAVE_WETH_ADDRESS3.toLowerCase());
    }
    const { decodeAbiParameters, parseUnits: parseUnits3 } = await import("viem");
    for (const action of plan2.actions) {
      if (action.actionType === 0) {
        try {
          const decoded = decodeAbiParameters(
            [
              { type: "address" },
              // tokenIn
              { type: "address" },
              // tokenOut
              { type: "uint24" },
              // fee
              { type: "uint256" },
              // amountIn
              { type: "uint256" },
              // amountOutMin
              { type: "address" },
              // recipient
              { type: "uint256" }
              // deadline
            ],
            action.data
          );
          const tokenIn = decoded[0].toLowerCase();
          const tokenOut = decoded[1].toLowerCase();
          if (!allowedTokens.has(tokenIn)) {
            return res.status(400).json({
              error: `Token ${tokenIn} not allowed. Allowed tokens: ${Array.from(allowedTokens).join(", ")}`
            });
          }
          if (!allowedTokens.has(tokenOut)) {
            return res.status(400).json({
              error: `Token ${tokenOut} not allowed. Allowed tokens: ${Array.from(allowedTokens).join(", ")}`
            });
          }
          const amountIn = decoded[3];
          const maxAmountIn = BigInt(parseUnits3("1", 18));
          if (amountIn > maxAmountIn) {
            return res.status(400).json({
              error: `Swap amountIn exceeds maximum (1 ETH). Got ${amountIn.toString()}`
            });
          }
        } catch (error) {
          console.warn("[api/execute/relayed] Could not decode swap action, skipping token validation:", error.message);
        }
      }
    }
    const planValue = BigInt(req.body.value || "0x0");
    const maxValue = BigInt(parseUnits3("1", 18));
    if (planValue > maxValue) {
      return res.status(400).json({
        ok: false,
        error: {
          code: "POLICY_EXCEEDED",
          message: `Plan value exceeds maximum (1 ETH). Got ${planValue.toString()}`
        },
        correlationId
      });
    }
    const validateOnly = req.query?.validateOnly === "true" || req.body?.validateOnly === true;
    const getSessionStatusFromChain = async (sessionId3) => {
      try {
        const { ETH_TESTNET_RPC_URL: ETH_TESTNET_RPC_URL3, EXECUTION_ROUTER_ADDRESS: EXECUTION_ROUTER_ADDRESS3 } = await Promise.resolve().then(() => (init_config(), config_exports));
        if (!ETH_TESTNET_RPC_URL3 || !EXECUTION_ROUTER_ADDRESS3) {
          return null;
        }
        const { createPublicClient: createPublicClient3, http: http5 } = await import("viem");
        const { sepolia: sepolia5 } = await import("viem/chains");
        const publicClient = createPublicClient3({
          chain: sepolia5,
          transport: http5(ETH_TESTNET_RPC_URL3)
        });
        const normalizedSessionId = sessionId3.startsWith("0x") ? sessionId3 : `0x${sessionId3}`;
        const sessionAbi = [
          {
            name: "sessions",
            type: "function",
            stateMutability: "view",
            inputs: [{ name: "", type: "bytes32" }],
            outputs: [
              { name: "owner", type: "address" },
              { name: "executor", type: "address" },
              { name: "expiresAt", type: "uint64" },
              { name: "maxSpend", type: "uint256" },
              { name: "spent", type: "uint256" },
              { name: "active", type: "bool" }
            ]
          }
        ];
        const sessionResult = await Promise.race([
          publicClient.readContract({
            address: EXECUTION_ROUTER_ADDRESS3,
            abi: sessionAbi,
            functionName: "sessions",
            args: [normalizedSessionId]
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2e3))
        ]);
        const owner = sessionResult[0];
        const executor = sessionResult[1];
        const expiresAt = sessionResult[2];
        const maxSpend = sessionResult[3];
        const spent = sessionResult[4];
        const active = sessionResult[5];
        const now2 = BigInt(Math.floor(Date.now() / 1e3));
        let status = "not_created";
        if (active) {
          if (expiresAt > now2) {
            status = "active";
          } else {
            status = "expired";
          }
        } else if (owner !== "0x0000000000000000000000000000000000000000") {
          status = "revoked";
        }
        return {
          active: status === "active",
          owner,
          executor,
          expiresAt,
          maxSpend,
          spent,
          status
        };
      } catch (error) {
        return null;
      }
    };
    const { evaluateSessionPolicy: evaluateSessionPolicy2, estimatePlanSpend: estimatePlanSpend2 } = await Promise.resolve().then(() => (init_sessionPolicy(), sessionPolicy_exports));
    let policyOverride;
    if (validateOnly && (process.env.NODE_ENV !== "production" || process.env.DEV === "true")) {
      policyOverride = req.body.policyOverride;
      if (policyOverride?.maxSpendUnits) {
        policyOverride.skipSessionCheck = true;
      }
    }
    const policyResult = await evaluateSessionPolicy2(
      sessionId2,
      userAddress2,
      plan2,
      allowedAdapters,
      getSessionStatusFromChain,
      policyOverride
    );
    const spendEstimate = await estimatePlanSpend2(plan2);
    let instrumentType;
    if (plan2.actions.length > 0) {
      const firstAction = plan2.actions[0];
      if (firstAction.actionType === 0) instrumentType = "swap";
      else if (firstAction.actionType === 6) instrumentType = "perp";
      else if (firstAction.actionType === 2) instrumentType = "swap";
    }
    instrumentType = instrumentType || spendEstimate.instrumentType;
    if (process.env.NODE_ENV !== "production") {
      logExecuteTrace(correlationId, "policy:evaluated", {
        allowed: policyResult.allowed,
        code: policyResult.code,
        spendWei: spendEstimate.spendWei.toString(),
        determinable: spendEstimate.determinable,
        instrumentType
      });
    }
    if (!policyResult.allowed) {
      if (process.env.NODE_ENV !== "production") {
        addRelayedAttempt({
          correlationId,
          timestamp: Date.now(),
          userAddress: userAddress2,
          sessionId: sessionId2,
          adapter: plan2.actions[0]?.adapter || "unknown",
          instrumentType,
          spendAttempted: spendEstimate.spendWei.toString(),
          result: "failed",
          errorCode: policyResult.code
        });
      }
      const errorResponse = {
        ok: false,
        correlationId,
        error: {
          code: policyResult.code || "POLICY_FAILED",
          message: policyResult.message || "Session policy check failed",
          ...policyResult.details || {}
        }
      };
      res.setHeader("x-correlation-id", correlationId);
      return res.status(400).json(errorResponse);
    }
    if (validateOnly) {
      if (process.env.NODE_ENV !== "production") {
        addRelayedAttempt({
          correlationId,
          timestamp: Date.now(),
          userAddress: userAddress2,
          sessionId: sessionId2,
          adapter: plan2.actions[0]?.adapter || "unknown",
          instrumentType,
          spendAttempted: spendEstimate.spendWei.toString(),
          result: "ok"
        });
      }
      return res.json({
        ok: true,
        wouldAllow: true,
        correlationId,
        policy: {
          sessionStatus: "active",
          spendEstimate: {
            spendWei: spendEstimate.spendWei.toString(),
            determinable: spendEstimate.determinable,
            instrumentType
          }
        },
        note: "validateOnly mode: policy check passed, transaction not submitted"
      });
    }
    console.log("[api/execute/relayed] Policy passed, importing relayer...");
    const { sendRelayedTx: sendRelayedTx2 } = await Promise.resolve().then(() => (init_relayer(), relayer_exports));
    console.log("[api/execute/relayed] Relayer imported, importing viem...");
    const { encodeFunctionData } = await import("viem");
    console.log("[api/execute/relayed] Viem imported, encoding function data...");
    const executeWithSessionAbi = [
      {
        name: "executeWithSession",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
          { name: "sessionId", type: "bytes32" },
          {
            name: "plan",
            type: "tuple",
            components: [
              { name: "user", type: "address" },
              { name: "nonce", type: "uint256" },
              { name: "deadline", type: "uint256" },
              {
                name: "actions",
                type: "tuple[]",
                components: [
                  { name: "actionType", type: "uint8" },
                  { name: "adapter", type: "address" },
                  { name: "data", type: "bytes" }
                ]
              }
            ]
          }
        ],
        outputs: []
      }
    ];
    console.log("[api/execute/relayed] Plan values:", {
      user: plan2.user,
      nonce: plan2.nonce,
      nonceType: typeof plan2.nonce,
      deadline: plan2.deadline,
      deadlineType: typeof plan2.deadline,
      actionsCount: plan2.actions?.length
    });
    if (plan2.nonce === void 0 || plan2.nonce === null) {
      return res.status(400).json({
        error: "Plan nonce is required",
        errorCode: "INVALID_PLAN",
        details: { nonce: plan2.nonce, deadline: plan2.deadline }
      });
    }
    if (plan2.deadline === void 0 || plan2.deadline === null) {
      return res.status(400).json({
        error: "Plan deadline is required",
        errorCode: "INVALID_PLAN",
        details: { nonce: plan2.nonce, deadline: plan2.deadline }
      });
    }
    if (!plan2.user) {
      return res.status(400).json({
        error: "Plan user is required",
        errorCode: "INVALID_PLAN",
        details: { user: plan2.user }
      });
    }
    if (!Array.isArray(plan2.actions) || plan2.actions.length === 0) {
      return res.status(400).json({
        error: "Plan actions array is required and must not be empty",
        errorCode: "INVALID_PLAN",
        details: { actions: plan2.actions }
      });
    }
    for (let i = 0; i < plan2.actions.length; i++) {
      const action = plan2.actions[i];
      if (action.actionType === void 0 || action.actionType === null) {
        return res.status(400).json({
          error: `Action ${i} missing actionType`,
          errorCode: "INVALID_PLAN",
          details: { actionIndex: i, action }
        });
      }
      if (!action.adapter) {
        return res.status(400).json({
          error: `Action ${i} missing adapter address`,
          errorCode: "INVALID_PLAN",
          details: { actionIndex: i, action }
        });
      }
      if (!action.data) {
        return res.status(400).json({
          error: `Action ${i} missing data`,
          errorCode: "INVALID_PLAN",
          details: { actionIndex: i, action }
        });
      }
    }
    console.log("[api/execute/relayed] Actions before encoding:");
    for (let i = 0; i < plan2.actions.length; i++) {
      const a = plan2.actions[i];
      console.log(`  Action ${i}:`, {
        actionType: a.actionType,
        actionTypeType: typeof a.actionType,
        adapter: a.adapter?.slice(0, 15) + "...",
        adapterType: typeof a.adapter,
        dataLen: a.data?.length,
        dataType: typeof a.data
      });
    }
    let data;
    try {
      data = encodeFunctionData({
        abi: executeWithSessionAbi,
        functionName: "executeWithSession",
        args: [
          sessionId2,
          {
            user: plan2.user,
            nonce: BigInt(plan2.nonce),
            deadline: BigInt(plan2.deadline),
            actions: plan2.actions.map((a) => ({
              actionType: a.actionType,
              adapter: a.adapter,
              data: a.data
            }))
          }
        ]
      });
      console.log("[api/execute/relayed] encodeFunctionData SUCCESS, dataLen:", data.length);
    } catch (encodeErr) {
      console.error("[api/execute/relayed] encodeFunctionData FAILED:", encodeErr.message);
      console.error("[api/execute/relayed] Full plan.actions:", JSON.stringify(plan2.actions, null, 2));
      throw encodeErr;
    }
    const portfolioBefore = buildPortfolioSnapshot();
    const { keccak256, encodeAbiParameters } = await import("viem");
    let planHash;
    try {
      planHash = keccak256(
        encodeAbiParameters(
          [
            { name: "user", type: "address" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
            {
              name: "actions",
              type: "tuple[]",
              components: [
                { name: "actionType", type: "uint8" },
                { name: "adapter", type: "address" },
                { name: "data", type: "bytes" }
              ]
            }
          ],
          [
            plan2.user,
            BigInt(plan2.nonce),
            BigInt(plan2.deadline),
            plan2.actions.map((a) => ({
              actionType: a.actionType,
              adapter: a.adapter,
              data: a.data
            }))
          ]
        )
      );
      console.log("[api/execute/relayed] planHash computed:", planHash.slice(0, 20) + "...");
    } catch (hashErr) {
      console.error("[api/execute/relayed] planHash FAILED:", hashErr.message);
      throw hashErr;
    }
    const txHash = await sendRelayedTx2({
      to: EXECUTION_ROUTER_ADDRESS2,
      data,
      value: req.body.value || "0x0"
    });
    if (process.env.NODE_ENV !== "production") {
      addRelayedAttempt({
        correlationId,
        timestamp: Date.now(),
        userAddress: userAddress2,
        sessionId: sessionId2,
        adapter: plan2.actions[0]?.adapter || "unknown",
        instrumentType: spendEstimate.instrumentType,
        spendAttempted: spendEstimate.spendWei.toString(),
        result: "ok",
        txHash
      });
    }
    const { ETH_TESTNET_RPC_URL: ETH_TESTNET_RPC_URL2 } = await Promise.resolve().then(() => (init_config(), config_exports));
    let receiptStatus = "pending";
    let blockNumber;
    let receiptError;
    if (ETH_TESTNET_RPC_URL2) {
      const { waitForReceipt: waitForReceipt2 } = await Promise.resolve().then(() => (init_evmReceipt(), evmReceipt_exports));
      const receiptResult = await waitForReceipt2(ETH_TESTNET_RPC_URL2, txHash, {
        timeoutMs: 6e4,
        pollMs: 2e3
      });
      receiptStatus = receiptResult.status;
      blockNumber = receiptResult.blockNumber;
      receiptError = receiptResult.error;
    }
    const portfolioAfter = receiptStatus === "confirmed" ? buildPortfolioSnapshot() : portfolioBefore;
    const result = {
      success: receiptStatus === "confirmed",
      status: receiptStatus === "confirmed" ? "success" : "failed",
      txHash,
      receiptStatus,
      blockNumber,
      planHash,
      // V1: Include server-computed planHash
      error: receiptError,
      portfolioDelta: {
        accountValueDeltaUsd: portfolioAfter.accountValueUsd - portfolioBefore.accountValueUsd,
        balanceDeltas: portfolioAfter.balances.map((b) => {
          const before = portfolioBefore.balances.find((b2) => b2.symbol === b.symbol);
          return {
            symbol: b.symbol,
            deltaUsd: b.balanceUsd - (before?.balanceUsd || 0)
          };
        })
      },
      portfolio: portfolioAfter
    };
    if (process.env.DEBUG_EXECUTIONS === "1") {
      logExecutionArtifact({
        executionRequest: null,
        // Not available in relayed endpoint
        plan: req.body.plan,
        executionResult: result,
        userAddress: req.body.userAddress,
        draftId: req.body.draftId
      });
    }
    const actionTypes = req.body.plan?.actions?.map((a) => a.actionType) || [];
    logEvent("relayed_tx", {
      draftId: req.body.draftId,
      userHash: req.body.userAddress ? hashAddress(req.body.userAddress) : void 0,
      txHash,
      actionTypes,
      authMode: "session",
      latencyMs: Date.now() - relayedStartTime,
      success: true
    });
    logExecuteTrace(correlationId, "relayed:ok", {
      txHash,
      actionTypes,
      latencyMs: Date.now() - relayedStartTime
    });
    res.json({
      ...result,
      chainId: 11155111,
      // Sepolia
      explorerUrl: `https://sepolia.etherscan.io/tx/${txHash}`,
      correlationId,
      // Include correlationId for client tracing
      notes: ["execution_path:relayed"]
      // Task 4: Unambiguous evidence of execution path
    });
  } catch (error) {
    console.error("[api/execute/relayed] Error:", error);
    logExecuteTrace(correlationId, "relayed:error", {
      error: error.message,
      latencyMs: Date.now() - relayedStartTime
    });
    let errorCode = "RELAYER_FAILED";
    if (error.message?.includes("session") || error.message?.includes("Session")) {
      errorCode = "SESSION_EXPIRED";
    } else if (error.message?.includes("insufficient") || error.message?.includes("balance")) {
      errorCode = "INSUFFICIENT_BALANCE";
    } else if (error.message?.includes("slippage") || error.message?.includes("amountOutMin")) {
      errorCode = "SLIPPAGE_FAILURE";
    }
    if (process.env.NODE_ENV !== "production" && req.body.plan) {
      try {
        const { estimatePlanSpend: estimatePlanSpend2 } = await Promise.resolve().then(() => (init_sessionPolicy(), sessionPolicy_exports));
        const spendEstimate = await estimatePlanSpend2(req.body.plan);
        addRelayedAttempt({
          correlationId,
          timestamp: Date.now(),
          userAddress: req.body.userAddress || "unknown",
          sessionId: req.body.sessionId || "unknown",
          adapter: req.body.plan.actions?.[0]?.adapter || "unknown",
          instrumentType: spendEstimate.instrumentType,
          spendAttempted: spendEstimate.spendWei.toString(),
          result: "failed",
          errorCode
        });
      } catch (logError) {
      }
    }
    const portfolioAfter = buildPortfolioSnapshot();
    const result = {
      success: false,
      status: "failed",
      error: error.message || "Failed to execute relayed transaction",
      portfolio: portfolioAfter
    };
    if (process.env.DEBUG_EXECUTIONS === "1") {
      logExecutionArtifact({
        executionRequest: null,
        plan: req.body.plan,
        executionResult: result,
        userAddress: req.body.userAddress,
        draftId: req.body.draftId
      });
    }
    res.status(500).json({
      ...result,
      errorCode,
      correlationId
      // Include correlationId in error response
    });
  }
});
app.get("/api/session/status", async (req, res) => {
  const correlationId = req.correlationId || generateCorrelationId();
  try {
    const { EXECUTION_MODE: EXECUTION_MODE2, EXECUTION_AUTH_MODE: EXECUTION_AUTH_MODE2 } = await Promise.resolve().then(() => (init_config(), config_exports));
    const userAddress = req.query?.userAddress || req.body?.userAddress;
    const sessionId = req.query?.sessionId || req.body?.sessionId;
    const cooldownKey = `status-${userAddress || "empty"}-${sessionId || "empty"}`;
    const inCooldown = !checkSessionCooldown(cooldownKey);
    if (inCooldown && process.env.DEBUG_SESSION !== "true") {
    } else if (process.env.DEBUG_SESSION === "true") {
      console.log("[api/session/status] GET request:", { userAddress, sessionId, EXECUTION_MODE: EXECUTION_MODE2, EXECUTION_AUTH_MODE: EXECUTION_AUTH_MODE2 });
    }
    if (EXECUTION_MODE2 !== "eth_testnet" || EXECUTION_AUTH_MODE2 !== "session") {
      return res.json({
        ok: true,
        status: "disabled",
        // Top-level status field for UI
        session: {
          enabled: false,
          reason: "NOT_CONFIGURED",
          required: ["EXECUTION_MODE=eth_testnet", "EXECUTION_AUTH_MODE=session"]
        },
        mode: EXECUTION_AUTH_MODE2 || "direct",
        cooldownMs: SESSION_COOLDOWN_MS
      });
    }
    if (!sessionId || typeof sessionId !== "string") {
      return res.json({
        ok: true,
        status: "not_created",
        // Top-level status field for UI
        session: {
          enabled: false,
          reason: "MISSING_FIELDS",
          required: ["sessionId"]
        },
        mode: "session",
        cooldownMs: SESSION_COOLDOWN_MS
      });
    }
    const normalizedSessionId = sessionId.startsWith("0x") ? sessionId : `0x${sessionId}`;
    if (normalizedSessionId.length !== 66) {
      logSessionTrace(correlationId, "status:error", {
        error: "Invalid sessionId format",
        sessionIdLength: normalizedSessionId.length,
        expectedLength: 66,
        sessionId: normalizedSessionId.substring(0, 20) + "..."
      });
      return res.json({
        ok: true,
        status: "not_created",
        session: {
          enabled: false,
          reason: "INVALID_SESSION_ID_FORMAT",
          message: `sessionId must be bytes32 (0x + 64 hex chars, got ${normalizedSessionId.length} chars)`
        },
        mode: "session",
        correlationId,
        cooldownMs: SESSION_COOLDOWN_MS
      });
    }
    const { EXECUTION_ROUTER_ADDRESS: EXECUTION_ROUTER_ADDRESS2, ETH_TESTNET_RPC_URL: ETH_TESTNET_RPC_URL2 } = await Promise.resolve().then(() => (init_config(), config_exports));
    if (!ETH_TESTNET_RPC_URL2 || !EXECUTION_ROUTER_ADDRESS2) {
      return res.json({
        ok: true,
        status: "disabled",
        // Top-level status field for UI
        session: {
          enabled: false,
          reason: "NOT_CONFIGURED",
          required: ["ETH_TESTNET_RPC_URL", "EXECUTION_ROUTER_ADDRESS"]
        },
        mode: "session",
        cooldownMs: SESSION_COOLDOWN_MS
      });
    }
    try {
      const { createPublicClient: createPublicClient3, http: http5 } = await import("viem");
      const { sepolia: sepolia5 } = await import("viem/chains");
      const publicClient = createPublicClient3({
        chain: sepolia5,
        transport: http5(ETH_TESTNET_RPC_URL2)
      });
      if (process.env.NODE_ENV !== "production") {
        try {
          const chainId = await publicClient.getChainId();
          const routerCode = await publicClient.getBytecode({ address: EXECUTION_ROUTER_ADDRESS2 });
          const routerIsContract = routerCode && routerCode !== "0x" && routerCode.length > 2;
          logSessionTrace(correlationId, "status:diagnostics", {
            chainId,
            routerAddress: EXECUTION_ROUTER_ADDRESS2,
            routerIsContract,
            routerCodeLength: routerCode?.length || 0,
            sessionId: sessionId.substring(0, 10) + "..."
          });
        } catch (diagError) {
        }
      }
      const sessionAbi = [
        {
          name: "sessions",
          type: "function",
          stateMutability: "view",
          inputs: [{ name: "", type: "bytes32" }],
          outputs: [
            { name: "owner", type: "address" },
            { name: "executor", type: "address" },
            { name: "expiresAt", type: "uint64" },
            { name: "maxSpend", type: "uint256" },
            { name: "spent", type: "uint256" },
            { name: "active", type: "bool" }
          ]
        }
      ];
      if (process.env.NODE_ENV !== "production") {
        logSessionTrace(correlationId, "status:querying", {
          sessionId: sessionId.substring(0, 10) + "...",
          sessionIdLength: sessionId.length,
          routerAddress: EXECUTION_ROUTER_ADDRESS2
        });
      }
      const sessionResult = await Promise.race([
        publicClient.readContract({
          address: EXECUTION_ROUTER_ADDRESS2,
          abi: sessionAbi,
          functionName: "sessions",
          args: [normalizedSessionId]
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2e3))
      ]);
      const owner = sessionResult[0];
      const executor = sessionResult[1];
      const expiresAt = sessionResult[2];
      const maxSpend = sessionResult[3];
      const spent = sessionResult[4];
      const active = sessionResult[5];
      if (process.env.NODE_ENV !== "production") {
        logSessionTrace(correlationId, "status:queryResult", {
          active: active || false,
          owner: owner?.substring(0, 10) + "..." || "none",
          expiresAt: expiresAt?.toString() || "none"
        });
      }
      const now = BigInt(Math.floor(Date.now() / 1e3));
      let status = "not_created";
      if (active) {
        if (expiresAt > now) {
          status = "active";
        } else {
          status = "expired";
        }
      } else if (owner !== "0x0000000000000000000000000000000000000000") {
        status = "revoked";
      }
      const statusResponse = {
        ok: true,
        status,
        // Top-level status field for UI (matches session.status)
        session: {
          enabled: status === "active",
          status,
          sessionId,
          owner,
          executor,
          expiresAt: expiresAt.toString(),
          maxSpend: maxSpend.toString(),
          spent: spent.toString(),
          active
        },
        mode: "session",
        cooldownMs: SESSION_COOLDOWN_MS
      };
      if (process.env.DEBUG_RESPONSE === "true") {
        console.log("[api/session/status] GET Response JSON:", JSON.stringify(statusResponse, null, 2));
      }
      return res.json(statusResponse);
    } catch (error) {
      if (process.env.DEBUG_SESSION === "true") {
        console.warn("[api/session/status] RPC check failed:", error.message);
      }
      const errorResponse = {
        ok: true,
        status: "not_created",
        // Top-level status field for UI
        session: {
          enabled: false,
          reason: error.message?.includes("timeout") ? "RPC_ERROR" : "MISSING_FIELDS",
          required: error.message?.includes("timeout") ? ["RPC_OK"] : ["sessionId"]
        },
        mode: "session",
        errorCode: error.message?.includes("timeout") ? "RPC_ERROR" : void 0,
        cooldownMs: SESSION_COOLDOWN_MS
      };
      if (process.env.DEBUG_RESPONSE === "true") {
        console.log("[api/session/status] GET Error Response JSON:", JSON.stringify(errorResponse, null, 2));
      }
      return res.json(errorResponse);
    }
  } catch (error) {
    if (process.env.DEBUG_SESSION === "true") {
      console.error("[api/session/status] Error:", error);
    }
    res.json({
      ok: true,
      status: "disabled",
      // Top-level status field for UI
      session: {
        enabled: false,
        reason: "RPC_ERROR",
        required: ["RPC_OK"]
      },
      errorCode: "RPC_ERROR",
      cooldownMs: SESSION_COOLDOWN_MS
    });
  }
});
app.post("/api/session/status", async (req, res) => {
  try {
    const { EXECUTION_MODE: EXECUTION_MODE2, EXECUTION_AUTH_MODE: EXECUTION_AUTH_MODE2 } = await Promise.resolve().then(() => (init_config(), config_exports));
    const userAddress = req.body?.userAddress || req.query?.userAddress;
    const sessionId = req.body?.sessionId || req.query?.sessionId;
    const cooldownKey = `status-${userAddress || "empty"}-${sessionId || "empty"}`;
    const inCooldown = !checkSessionCooldown(cooldownKey);
    if (inCooldown && process.env.DEBUG_SESSION !== "true") {
    } else if (process.env.DEBUG_SESSION === "true") {
      console.log("[api/session/status] POST request:", { userAddress, sessionId, EXECUTION_MODE: EXECUTION_MODE2, EXECUTION_AUTH_MODE: EXECUTION_AUTH_MODE2 });
    }
    const { RELAYER_PRIVATE_KEY: RELAYER_PRIVATE_KEY_POST, EXECUTION_ROUTER_ADDRESS: EXECUTION_ROUTER_ADDRESS_POST, ETH_TESTNET_RPC_URL: ETH_TESTNET_RPC_URL_POST } = await Promise.resolve().then(() => (init_config(), config_exports));
    const isSessionModeConfiguredPost = EXECUTION_MODE2 === "eth_testnet" && EXECUTION_AUTH_MODE2 === "session";
    const hasRequiredConfigPost = !!(RELAYER_PRIVATE_KEY_POST && EXECUTION_ROUTER_ADDRESS_POST && ETH_TESTNET_RPC_URL_POST);
    if (!isSessionModeConfiguredPost || !hasRequiredConfigPost) {
      const missing = [];
      if (!RELAYER_PRIVATE_KEY_POST) missing.push("RELAYER_PRIVATE_KEY");
      if (!EXECUTION_ROUTER_ADDRESS_POST) missing.push("EXECUTION_ROUTER_ADDRESS");
      if (!ETH_TESTNET_RPC_URL_POST) missing.push("ETH_TESTNET_RPC_URL");
      return res.json({
        ok: true,
        status: "disabled",
        // Top-level status field for UI
        session: {
          enabled: false,
          reason: !isSessionModeConfiguredPost ? "NOT_CONFIGURED" : "MISSING_CONFIG",
          required: !isSessionModeConfiguredPost ? ["EXECUTION_MODE=eth_testnet", "EXECUTION_AUTH_MODE=session"] : missing
        },
        mode: EXECUTION_AUTH_MODE2 || "direct",
        cooldownMs: SESSION_COOLDOWN_MS
      });
    }
    if (!sessionId || typeof sessionId !== "string") {
      return res.json({
        ok: true,
        status: "not_created",
        // Top-level status field for UI
        session: {
          enabled: false,
          reason: "MISSING_FIELDS",
          required: ["sessionId"]
        },
        mode: "session",
        cooldownMs: SESSION_COOLDOWN_MS
      });
    }
    const normalizedSessionId = sessionId.startsWith("0x") ? sessionId : `0x${sessionId}`;
    if (normalizedSessionId.length !== 66) {
      const correlationId2 = req.correlationId || "unknown";
      logSessionTrace(correlationId2, "status:error", {
        error: "Invalid sessionId format",
        sessionIdLength: normalizedSessionId.length,
        expectedLength: 66,
        sessionId: normalizedSessionId.substring(0, 20) + "..."
      });
      return res.json({
        ok: true,
        status: "not_created",
        session: {
          enabled: false,
          reason: "INVALID_SESSION_ID_FORMAT",
          message: `sessionId must be bytes32 (0x + 64 hex chars, got ${normalizedSessionId.length} chars)`
        },
        mode: "session",
        correlationId: correlationId2,
        cooldownMs: SESSION_COOLDOWN_MS
      });
    }
    const { EXECUTION_ROUTER_ADDRESS: EXECUTION_ROUTER_ADDRESS2, ETH_TESTNET_RPC_URL: ETH_TESTNET_RPC_URL2 } = await Promise.resolve().then(() => (init_config(), config_exports));
    const correlationId = req.correlationId || "unknown";
    if (!ETH_TESTNET_RPC_URL2 || !EXECUTION_ROUTER_ADDRESS2) {
      return res.json({
        ok: true,
        status: "not_created",
        // Top-level status field for UI
        session: {
          enabled: false,
          reason: "NOT_CONFIGURED",
          required: ["ETH_TESTNET_RPC_URL", "EXECUTION_ROUTER_ADDRESS"]
        },
        mode: "session",
        cooldownMs: SESSION_COOLDOWN_MS
      });
    }
    try {
      const { createPublicClient: createPublicClient3, http: http5 } = await import("viem");
      const { sepolia: sepolia5 } = await import("viem/chains");
      const publicClient = createPublicClient3({
        chain: sepolia5,
        transport: http5(ETH_TESTNET_RPC_URL2)
      });
      const sessionAbi = [
        {
          name: "sessions",
          type: "function",
          stateMutability: "view",
          inputs: [{ name: "", type: "bytes32" }],
          outputs: [
            { name: "owner", type: "address" },
            { name: "executor", type: "address" },
            { name: "expiresAt", type: "uint64" },
            { name: "maxSpend", type: "uint256" },
            { name: "spent", type: "uint256" },
            { name: "active", type: "bool" }
          ]
        }
      ];
      console.log("[session/status] POST Querying sessionId:", normalizedSessionId);
      console.log("[session/status] Contract address:", EXECUTION_ROUTER_ADDRESS2);
      const sessionResult = await Promise.race([
        publicClient.readContract({
          address: EXECUTION_ROUTER_ADDRESS2,
          abi: sessionAbi,
          functionName: "sessions",
          args: [normalizedSessionId]
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2e3))
      ]);
      const owner = sessionResult[0];
      const executor = sessionResult[1];
      const expiresAt = sessionResult[2];
      const maxSpend = sessionResult[3];
      const spent = sessionResult[4];
      const active = sessionResult[5];
      const now = BigInt(Math.floor(Date.now() / 1e3));
      let status = "not_created";
      console.log("[session/status] Contract query result:", {
        owner,
        executor,
        expiresAt: expiresAt?.toString(),
        active,
        isOwnerZero: owner === "0x0000000000000000000000000000000000000000"
      });
      if (active) {
        if (expiresAt > now) {
          status = "active";
        } else {
          status = "expired";
        }
      } else if (owner !== "0x0000000000000000000000000000000000000000") {
        status = "revoked";
      }
      console.log("[session/status] Final status:", status);
      return res.json({
        ok: true,
        status,
        // Top-level status field for UI (matches session.status)
        session: {
          enabled: status === "active",
          status,
          sessionId,
          owner,
          executor,
          expiresAt: expiresAt.toString(),
          maxSpend: maxSpend.toString(),
          spent: spent.toString(),
          active
        },
        mode: "session",
        cooldownMs: SESSION_COOLDOWN_MS
      });
    } catch (error) {
      if (process.env.DEBUG_SESSION === "true") {
        console.warn("[api/session/status] RPC check failed or session not found:", error.message);
      }
      return res.json({
        ok: true,
        status: "not_created",
        // Top-level status field for UI
        session: {
          enabled: false,
          reason: error.message?.includes("timeout") ? "RPC_ERROR" : "MISSING_FIELDS",
          required: error.message?.includes("timeout") ? ["RPC_OK"] : ["sessionId"]
        },
        mode: "session",
        errorCode: error.message?.includes("timeout") ? "RPC_ERROR" : void 0,
        cooldownMs: SESSION_COOLDOWN_MS
      });
    }
  } catch (error) {
    if (process.env.DEBUG_SESSION === "true") {
      console.error("[api/session/status] Error:", error);
    }
    res.json({
      ok: true,
      session: {
        enabled: false,
        reason: "RPC_ERROR",
        required: ["RPC_OK"]
      },
      errorCode: "RPC_ERROR",
      cooldownMs: SESSION_COOLDOWN_MS
    });
  }
});
app.post("/api/session/revoke/prepare", async (req, res) => {
  try {
    const { EXECUTION_MODE: EXECUTION_MODE2, EXECUTION_AUTH_MODE: EXECUTION_AUTH_MODE2 } = await Promise.resolve().then(() => (init_config(), config_exports));
    if (EXECUTION_MODE2 !== "eth_testnet" || EXECUTION_AUTH_MODE2 !== "session") {
      return res.status(400).json({
        error: "Session endpoint only available in eth_testnet mode with session auth"
      });
    }
    const { sessionId } = req.body;
    if (!sessionId || typeof sessionId !== "string") {
      return res.status(400).json({
        error: "sessionId is required"
      });
    }
    const { EXECUTION_ROUTER_ADDRESS: EXECUTION_ROUTER_ADDRESS2 } = await Promise.resolve().then(() => (init_config(), config_exports));
    const { encodeFunctionData } = await import("viem");
    const revokeSessionAbi = [
      {
        name: "revokeSession",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [{ name: "sessionId", type: "bytes32" }],
        outputs: []
      }
    ];
    const data = encodeFunctionData({
      abi: revokeSessionAbi,
      functionName: "revokeSession",
      args: [sessionId]
    });
    res.json({
      to: EXECUTION_ROUTER_ADDRESS2,
      data,
      value: "0x0",
      summary: `Revoke session ${sessionId.substring(0, 10)}...`
    });
  } catch (error) {
    console.error("[api/session/revoke/prepare] Error:", error);
    res.status(500).json({
      error: "Failed to prepare session revocation",
      message: error.message
    });
  }
});
app.post("/api/token/weth/wrap/prepare", async (req, res) => {
  try {
    const { amount, userAddress } = req.body;
    if (!amount || !userAddress) {
      return res.status(400).json({
        error: "amount and userAddress are required"
      });
    }
    const addressRegex = /^0x[a-fA-F0-9]{40}$/;
    if (!addressRegex.test(userAddress)) {
      return res.status(400).json({
        error: "Invalid userAddress format"
      });
    }
    const { WETH_ADDRESS_SEPOLIA: WETH_ADDRESS_SEPOLIA2 } = await Promise.resolve().then(() => (init_config(), config_exports));
    if (!WETH_ADDRESS_SEPOLIA2) {
      return res.status(500).json({
        error: "WETH_ADDRESS_SEPOLIA not configured"
      });
    }
    const data = "0xd0e30db0";
    const { parseUnits: parseUnits3 } = await import("viem");
    const amountWei = parseUnits3(amount, 18);
    const value = "0x" + amountWei.toString(16);
    res.json({
      chainId: 11155111,
      // Sepolia
      to: WETH_ADDRESS_SEPOLIA2.toLowerCase(),
      data,
      value,
      summary: `Wrap ${amount} ETH to WETH`
    });
  } catch (error) {
    console.error("[api/token/weth/wrap/prepare] Error:", error);
    res.status(500).json({
      error: "Failed to prepare wrap transaction",
      message: error.message
    });
  }
});
app.post("/api/token/approve/prepare", async (req, res) => {
  try {
    const { token, spender, amount, userAddress } = req.body;
    if (!token || !spender || !amount || !userAddress) {
      return res.status(400).json({
        error: "token, spender, amount, and userAddress are required"
      });
    }
    const addressRegex = /^0x[a-fA-F0-9]{40}$/;
    if (!addressRegex.test(token) || !addressRegex.test(spender) || !addressRegex.test(userAddress)) {
      return res.status(400).json({
        error: "Invalid address format"
      });
    }
    const { encodeFunctionData } = await import("viem");
    const approveAbi = [
      {
        name: "approve",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
          { name: "spender", type: "address" },
          { name: "amount", type: "uint256" }
        ],
        outputs: [{ name: "", type: "bool" }]
      }
    ];
    const amountBigInt = typeof amount === "string" && amount.startsWith("0x") ? BigInt(amount) : BigInt(amount);
    const data = encodeFunctionData({
      abi: approveAbi,
      functionName: "approve",
      args: [spender, amountBigInt]
    });
    res.json({
      chainId: 11155111,
      // Sepolia
      to: token,
      data,
      value: "0x0",
      summary: `Approve ${spender.substring(0, 10)}... to spend tokens`
    });
  } catch (error) {
    console.error("[api/token/approve/prepare] Error:", error);
    res.status(500).json({
      error: "Failed to prepare approve transaction",
      message: error.message
    });
  }
});
app.get("/api/execute/status", async (req, res) => {
  try {
    const { txHash } = req.query;
    if (!txHash || typeof txHash !== "string") {
      return res.status(400).json({
        error: "txHash query parameter is required"
      });
    }
    if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      return res.status(400).json({
        error: "Invalid txHash format (must be 0x followed by 64 hex characters)"
      });
    }
    const executionMode = process.env.EXECUTION_MODE || "sim";
    if (executionMode !== "eth_testnet") {
      return res.json({
        status: "unsupported",
        message: "Transaction status tracking only available in eth_testnet mode"
      });
    }
    const { ETH_TESTNET_RPC_URL: ETH_TESTNET_RPC_URL2 } = await Promise.resolve().then(() => (init_config(), config_exports));
    if (!ETH_TESTNET_RPC_URL2) {
      return res.status(500).json({
        error: "ETH_TESTNET_RPC_URL not configured"
      });
    }
    const receiptResponse = await fetch(ETH_TESTNET_RPC_URL2, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getTransactionReceipt",
        params: [txHash]
      })
    });
    if (!receiptResponse.ok) {
      throw new Error(`RPC call failed: ${receiptResponse.statusText}`);
    }
    const jsonResult = await receiptResponse.json();
    const receiptResult = jsonResult;
    if (receiptResult.error) {
      throw new Error(`RPC error: ${receiptResult.error.message || JSON.stringify(receiptResult.error)}`);
    }
    const receipt = receiptResult.result;
    if (!receipt || receipt === null) {
      return res.json({
        status: "pending",
        txHash
      });
    }
    const statusHex = receipt.status;
    let status;
    if (statusHex === "0x1" || statusHex === "0x01") {
      status = "confirmed";
    } else if (statusHex === "0x0" || statusHex === "0x00") {
      status = "reverted";
    } else {
      return res.json({
        status: "pending",
        txHash
      });
    }
    const response = {
      status,
      txHash,
      blockNumber: receipt.blockNumber || null,
      gasUsed: receipt.gasUsed || null
    };
    if (receipt.to) {
      response.to = receipt.to;
    }
    if (receipt.from) {
      response.from = receipt.from;
    }
    res.json(response);
  } catch (error) {
    console.error("[api/execute/status] Error:", error);
    res.status(500).json({
      error: "Failed to fetch transaction status",
      message: error.message
    });
  }
});
app.get("/api/portfolio/eth_testnet", maybeCheckAccess, async (req, res) => {
  try {
    const { userAddress } = req.query;
    if (!userAddress || typeof userAddress !== "string") {
      return res.status(400).json({
        error: "userAddress query parameter is required"
      });
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
      return res.status(400).json({
        error: "Invalid userAddress format"
      });
    }
    const executionMode = process.env.EXECUTION_MODE || "sim";
    if (executionMode !== "eth_testnet") {
      return res.status(400).json({
        error: "Portfolio endpoint only available in eth_testnet mode"
      });
    }
    const { ETH_TESTNET_RPC_URL: ETH_TESTNET_RPC_URL2, REDACTED_ADDRESS_SEPOLIA: REDACTED_ADDRESS_SEPOLIA2, WETH_ADDRESS_SEPOLIA: WETH_ADDRESS_SEPOLIA2 } = await Promise.resolve().then(() => (init_config(), config_exports));
    if (!ETH_TESTNET_RPC_URL2) {
      return res.status(500).json({
        error: "ETH_TESTNET_RPC_URL not configured"
      });
    }
    if (!REDACTED_ADDRESS_SEPOLIA2 || !WETH_ADDRESS_SEPOLIA2) {
      return res.status(500).json({
        error: "REDACTED_ADDRESS_SEPOLIA and WETH_ADDRESS_SEPOLIA must be configured"
      });
    }
    const { erc20_balanceOf: erc20_balanceOf2 } = await Promise.resolve().then(() => (init_erc20Rpc(), erc20Rpc_exports));
    const ethBalanceResponse = await fetch(ETH_TESTNET_RPC_URL2, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getBalance",
        params: [userAddress.toLowerCase(), "latest"]
      })
    });
    if (!ethBalanceResponse.ok) {
      throw new Error(`RPC call failed: ${ethBalanceResponse.statusText}`);
    }
    const ethResultUnknown = await ethBalanceResponse.json();
    const ethResult = ethResultUnknown;
    if (ethResult.error) {
      throw new Error(`RPC error: ${ethResult.error.message || JSON.stringify(ethResult.error)}`);
    }
    const ethWei = BigInt(ethResult.result || "0x0");
    const ethFormatted = (Number(ethWei) / 1e18).toFixed(6);
    const usdcBalance = await erc20_balanceOf2(REDACTED_ADDRESS_SEPOLIA2, userAddress);
    const usdcFormatted = (Number(usdcBalance) / 1e6).toFixed(2);
    const wethBalance = await erc20_balanceOf2(WETH_ADDRESS_SEPOLIA2, userAddress);
    const wethFormatted = (Number(wethBalance) / 1e18).toFixed(6);
    res.json({
      chainId: 11155111,
      // Sepolia
      userAddress: userAddress.toLowerCase(),
      balances: {
        eth: {
          wei: "0x" + ethWei.toString(16),
          formatted: ethFormatted
        },
        usdc: {
          raw: "0x" + usdcBalance.toString(16),
          decimals: 6,
          formatted: usdcFormatted
        },
        weth: {
          raw: "0x" + wethBalance.toString(16),
          decimals: 18,
          formatted: wethFormatted
        }
      }
    });
  } catch (error) {
    console.error("[api/portfolio/eth_testnet] Error:", error);
    res.status(500).json({
      error: "Failed to fetch portfolio balances",
      message: error.message
    });
  }
});
app.get("/api/defi/aave/positions", maybeCheckAccess, async (req, res) => {
  const userAddress = typeof req.query.userAddress === "string" ? req.query.userAddress : null;
  try {
    if (!userAddress) {
      return res.status(400).json({
        error: "userAddress query parameter is required"
      });
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
      return res.status(400).json({
        error: "Invalid userAddress format"
      });
    }
    const { readAavePositions: readAavePositions2 } = await Promise.resolve().then(() => (init_positions(), positions_exports));
    const positions = await readAavePositions2(userAddress);
    res.json({
      ok: true,
      chainId: 11155111,
      // Sepolia
      userAddress,
      positions: Array.isArray(positions) ? positions : [],
      timestamp: Date.now()
    });
  } catch (error) {
    console.error("[api/defi/aave/positions] Error:", error);
    const isServerError = error.message?.includes("not configured") || error.message?.includes("RPC") || error.message?.includes("ETH_TESTNET_RPC_URL");
    if (isServerError) {
      res.status(500).json({
        ok: false,
        error: error.message || "Failed to read Aave positions"
      });
    } else {
      res.json({
        ok: true,
        chainId: 11155111,
        userAddress: userAddress || "unknown",
        positions: [],
        timestamp: Date.now()
      });
    }
  }
});
app.get("/api/wallet/balances", maybeCheckAccess, async (req, res) => {
  try {
    const { address } = req.query;
    if (!address || typeof address !== "string") {
      return res.status(400).json({
        error: "address query parameter is required"
      });
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({
        error: "Invalid address format"
      });
    }
    const {
      EXECUTION_MODE: EXECUTION_MODE2,
      ETH_TESTNET_RPC_URL: ETH_TESTNET_RPC_URL2,
      ETH_TESTNET_CHAIN_ID: ETH_TESTNET_CHAIN_ID3,
      DEMO_REDACTED_ADDRESS: DEMO_REDACTED_ADDRESS2,
      DEMO_WETH_ADDRESS: DEMO_WETH_ADDRESS2
    } = await Promise.resolve().then(() => (init_config(), config_exports));
    const ALLOW_SIM_MODE2 = process.env.ALLOW_SIM_MODE === "true";
    if (EXECUTION_MODE2 === "sim" && ALLOW_SIM_MODE2) {
      return res.json({
        chainId: 11155111,
        address: address.toLowerCase(),
        native: {
          symbol: "ETH",
          wei: "0x0",
          formatted: "0.0"
        },
        tokens: [],
        notes: ["SIM mode: returning zero balances"],
        timestamp: Date.now()
      });
    }
    if (EXECUTION_MODE2 === "sim" && !ALLOW_SIM_MODE2) {
    }
    if (!ETH_TESTNET_RPC_URL2) {
      return res.status(503).json({
        ok: false,
        code: "RPC_NOT_CONFIGURED",
        message: "ETH_TESTNET_RPC_URL is missing",
        fix: "Set ETH_TESTNET_RPC_URL in agent/.env.local then restart backend."
      });
    }
    const chainId = ETH_TESTNET_CHAIN_ID3 || 11155111;
    const tokens = [];
    const notes = [];
    let ethWei = BigInt(0);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3e3);
      const ethBalanceResponse = await fetch(ETH_TESTNET_RPC_URL2, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getBalance",
          params: [address.toLowerCase(), "latest"]
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (ethBalanceResponse.ok) {
        const ethResultUnknown = await ethBalanceResponse.json();
        const ethResult = ethResultUnknown;
        if (!ethResult.error && ethResult.result) {
          ethWei = BigInt(ethResult.result);
        } else if (ethResult.error) {
          throw new Error(`RPC error: ${ethResult.error.message || JSON.stringify(ethResult.error)}`);
        }
      } else {
        throw new Error(`RPC HTTP error: ${ethBalanceResponse.status} ${ethBalanceResponse.statusText}`);
      }
    } catch (e) {
      if (e.name === "AbortError" || e.message?.includes("fetch")) {
        return res.status(503).json({
          ok: false,
          code: "RPC_UNREACHABLE",
          message: "RPC endpoint is unreachable or timed out",
          fix: "Check ETH_TESTNET_RPC_URL in agent/.env.local and ensure RPC endpoint is accessible."
        });
      }
      notes.push(`ETH balance fetch failed: ${e.message}`);
    }
    if (DEMO_REDACTED_ADDRESS2) {
      try {
        const { erc20_balanceOf: erc20_balanceOf2 } = await Promise.resolve().then(() => (init_erc20Rpc(), erc20Rpc_exports));
        const balance = await erc20_balanceOf2(DEMO_REDACTED_ADDRESS2, address);
        tokens.push({
          address: DEMO_REDACTED_ADDRESS2,
          symbol: "REDACTED",
          decimals: 6,
          raw: "0x" + balance.toString(16),
          formatted: (Number(balance) / 1e6).toFixed(2)
        });
      } catch (e) {
        notes.push(`REDACTED balance fetch failed: ${e.message}`);
      }
    } else {
      notes.push("DEMO_REDACTED_ADDRESS not configured");
    }
    if (DEMO_WETH_ADDRESS2) {
      try {
        const { erc20_balanceOf: erc20_balanceOf2 } = await Promise.resolve().then(() => (init_erc20Rpc(), erc20Rpc_exports));
        const balance = await erc20_balanceOf2(DEMO_WETH_ADDRESS2, address);
        tokens.push({
          address: DEMO_WETH_ADDRESS2,
          symbol: "WETH",
          decimals: 18,
          raw: "0x" + balance.toString(16),
          formatted: (Number(balance) / 1e18).toFixed(6)
        });
      } catch (e) {
        notes.push(`WETH balance fetch failed: ${e.message}`);
      }
    } else {
      notes.push("DEMO_WETH_ADDRESS not configured");
    }
    const ethFormatted = (Number(ethWei) / 1e18).toFixed(6);
    res.json({
      chainId,
      address: address.toLowerCase(),
      native: {
        symbol: "ETH",
        wei: "0x" + ethWei.toString(16),
        formatted: ethFormatted
      },
      tokens,
      notes: notes.length > 0 ? notes : void 0,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error("[api/wallet/balances] Error:", error);
    res.status(500).json({
      error: "Failed to fetch wallet balances",
      message: error.message
    });
  }
});
app.post("/api/demo/faucet", maybeCheckAccess, async (req, res) => {
  try {
    const { EXECUTION_MODE: EXECUTION_MODE2, DEMO_REDACTED_ADDRESS: DEMO_REDACTED_ADDRESS2, DEMO_WETH_ADDRESS: DEMO_WETH_ADDRESS2 } = await Promise.resolve().then(() => (init_config(), config_exports));
    if (EXECUTION_MODE2 !== "eth_testnet") {
      return res.status(400).json({
        error: "Faucet only available in eth_testnet mode"
      });
    }
    if (!DEMO_REDACTED_ADDRESS2 || !DEMO_WETH_ADDRESS2) {
      return res.status(500).json({
        error: "Demo token addresses not configured",
        message: "DEMO_REDACTED_ADDRESS and DEMO_WETH_ADDRESS must be set in .env.local"
      });
    }
    const { userAddress } = req.body;
    if (!userAddress || typeof userAddress !== "string") {
      return res.status(400).json({
        error: "userAddress is required"
      });
    }
    if (!/^0x[a-fA-F0-9]{40}$/i.test(userAddress)) {
      return res.status(400).json({
        error: "Invalid userAddress format"
      });
    }
    console.log(`[api/demo/faucet] Minting tokens to ${userAddress}...`);
    const { mintDemoTokens: mintDemoTokens2 } = await Promise.resolve().then(() => (init_demoTokenMinter(), demoTokenMinter_exports));
    const result = await mintDemoTokens2(userAddress);
    console.log(`[api/demo/faucet] Successfully minted tokens:`, result);
    res.json({
      success: true,
      txHashes: result.txHashes,
      amounts: result.amounts
    });
  } catch (error) {
    console.error("[api/demo/faucet] Error:", error);
    res.status(500).json({
      error: "Failed to mint demo tokens",
      message: error.message
    });
  }
});
app.get("/health", async (req, res) => {
  try {
    const {
      EXECUTION_MODE: EXECUTION_MODE2,
      ETH_TESTNET_RPC_URL: ETH_TESTNET_RPC_URL2,
      EXECUTION_ROUTER_ADDRESS: EXECUTION_ROUTER_ADDRESS2
    } = await Promise.resolve().then(() => (init_config(), config_exports));
    const hasGeminiKey = !!process.env.BLOSSOM_GEMINI_API_KEY;
    const hasOpenAIKey = !!process.env.BLOSSOM_OPENAI_API_KEY;
    const hasAnthropicKey = !!process.env.BLOSSOM_ANTHROPIC_API_KEY;
    const hasAnyLLMKey = hasGeminiKey || hasOpenAIKey || hasAnthropicKey;
    const rpcUrlLen = ETH_TESTNET_RPC_URL2 ? ETH_TESTNET_RPC_URL2.length : 0;
    const routerAddrLen = EXECUTION_ROUTER_ADDRESS2 ? EXECUTION_ROUTER_ADDRESS2.length : 0;
    const missing = [];
    let ok = true;
    if (EXECUTION_MODE2 === "eth_testnet") {
      if (!ETH_TESTNET_RPC_URL2) {
        missing.push("ETH_TESTNET_RPC_URL");
        ok = false;
      }
      if (!EXECUTION_ROUTER_ADDRESS2) {
        missing.push("EXECUTION_ROUTER_ADDRESS");
        ok = false;
      }
      if (!hasAnyLLMKey) {
        missing.push("BLOSSOM_GEMINI_API_KEY (or BLOSSOM_OPENAI_API_KEY or BLOSSOM_ANTHROPIC_API_KEY)");
        ok = false;
      }
    }
    res.json({
      ok,
      ts: Date.now(),
      service: "blossom-agent",
      executionMode: EXECUTION_MODE2 || "eth_testnet",
      // Dev-safe debug info
      debug: {
        rpcUrlLen,
        routerAddrLen,
        hasRpcUrl: !!ETH_TESTNET_RPC_URL2,
        hasRouterAddr: !!EXECUTION_ROUTER_ADDRESS2,
        hasAnyLLMKey
      },
      ...missing.length > 0 && { missing }
    });
  } catch (error) {
    res.json({
      ok: false,
      ts: Date.now(),
      service: "blossom-agent",
      executionMode: "unknown",
      missing: ["config_load_failed"],
      error: error instanceof Error ? error.message : "unknown"
    });
  }
});
app.get("/api/health", (req, res) => {
  const provider = process.env.BLOSSOM_MODEL_PROVIDER || "stub";
  const hasGeminiKey = !!process.env.BLOSSOM_GEMINI_API_KEY;
  const hasOpenAIKey = !!process.env.BLOSSOM_OPENAI_API_KEY;
  const hasAnthropicKey = !!process.env.BLOSSOM_ANTHROPIC_API_KEY;
  let effectiveProvider = provider;
  if (provider === "gemini" && !hasGeminiKey) {
    effectiveProvider = "stub";
  } else if (provider === "openai" && !hasOpenAIKey) {
    effectiveProvider = "stub";
  } else if (provider === "anthropic" && !hasAnthropicKey) {
    effectiveProvider = "stub";
  }
  const response = {
    ok: true,
    ts: Date.now(),
    service: "blossom-agent",
    llmProvider: effectiveProvider
    // Non-sensitive: just the provider name
  };
  if (process.env.AUTH_DEBUG === "1") {
    const ledgerSecret = process.env.DEV_LEDGER_SECRET || "";
    response.authDebug = {
      hasLedgerSecret: !!ledgerSecret,
      ledgerSecretHash: ledgerSecret ? createHash2("sha256").update(ledgerSecret).digest("hex").slice(0, 6) : "empty"
    };
  }
  res.json(response);
});
app.get("/api/rpc/health", async (req, res) => {
  try {
    const { getProviderHealthStatus: getProviderHealthStatus2 } = await Promise.resolve().then(() => (init_rpcProvider(), rpcProvider_exports));
    const status = getProviderHealthStatus2();
    res.json({
      ok: true,
      ts: Date.now(),
      ...status
    });
  } catch (error) {
    res.json({
      ok: false,
      ts: Date.now(),
      error: "RPC provider not initialized",
      primary: null,
      fallbacks: []
    });
  }
});
app.post("/api/rpc/reset", async (req, res) => {
  try {
    const { resetAllCircuits: resetAllCircuits2 } = await Promise.resolve().then(() => (init_rpcProvider(), rpcProvider_exports));
    resetAllCircuits2();
    res.json({ ok: true, message: "All circuit breakers reset" });
  } catch (error) {
    res.json({ ok: false, error: "RPC provider not initialized" });
  }
});
app.get("/api/telemetry/summary", async (req, res) => {
  try {
    const { getTelemetrySummary: getTelemetrySummary2 } = await Promise.resolve().then(() => (init_db(), db_exports));
    const summary = getTelemetrySummary2();
    res.json({ ok: true, data: summary });
  } catch (error) {
    res.json({
      ok: false,
      error: "Telemetry DB not available",
      data: {
        totalUsers: 0,
        totalSessions: 0,
        activeSessions: 0,
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        successRate: 0,
        avgLatencyMs: null,
        topErrors: [],
        recentExecutions: []
      }
    });
  }
});
app.get("/api/telemetry/devnet-stats", async (req, res) => {
  try {
    const { getDevnetStats: getDevnetStats2, getTrafficStats: getTrafficStats2, migrateAddFeeColumns: migrateAddFeeColumns2 } = await Promise.resolve().then(() => (init_db(), db_exports));
    const { BLOSSOM_FEE_BPS: BLOSSOM_FEE_BPS2 } = await Promise.resolve().then(() => (init_config(), config_exports));
    migrateAddFeeColumns2();
    const executionStats = getDevnetStats2(BLOSSOM_FEE_BPS2);
    const trafficStats = getTrafficStats2(24);
    res.json({
      ok: true,
      data: {
        // Traffic stats (HTTP requests - what load tests generate)
        traffic: {
          requestsAllTime: trafficStats.requests.allTime,
          requestsLast24h: trafficStats.requests.last24h,
          successRate24h: trafficStats.requests.successRate24h,
          http5xx24h: trafficStats.requests.http5xx24h,
          visitorsAllTime: trafficStats.visitors.allTime,
          visitorsLast24h: trafficStats.visitors.last24h
        },
        // Execution stats (on-chain transactions - real DeFi actions)
        executions: {
          allTime: executionStats.transactions.allTime,
          last24h: executionStats.transactions.last24h,
          successCount: executionStats.transactions.successCount,
          failCount: executionStats.transactions.failCount
        },
        // User stats (from users table)
        users: executionStats.users,
        // Volume and fees
        amountExecuted: executionStats.amountExecuted,
        feesCollected: executionStats.feesCollected,
        generatedAt: (/* @__PURE__ */ new Date()).toISOString()
      }
    });
  } catch (error) {
    res.json({
      ok: false,
      error: "Devnet stats unavailable",
      data: {
        traffic: {
          requestsAllTime: 0,
          requestsLast24h: 0,
          successRate24h: 100,
          http5xx24h: 0,
          visitorsAllTime: 0,
          visitorsLast24h: 0
        },
        executions: { allTime: 0, last24h: 0, successCount: 0, failCount: 0 },
        users: { allTime: 0, last24h: 0 },
        amountExecuted: { byToken: [], unpricedCount: 0 },
        feesCollected: { byToken: [], feeBps: 25, unpricedCount: 0 },
        generatedAt: (/* @__PURE__ */ new Date()).toISOString()
      }
    });
  }
});
app.get("/api/telemetry/users", async (req, res) => {
  try {
    const { getUsersWithSessionStatus: getUsersWithSessionStatus2 } = await Promise.resolve().then(() => (init_db(), db_exports));
    const users = getUsersWithSessionStatus2();
    res.json({ ok: true, data: users });
  } catch (error) {
    res.json({ ok: false, error: "Telemetry DB not available", data: [] });
  }
});
app.get("/api/telemetry/executions", async (req, res) => {
  try {
    const { listExecutions: listExecutions3 } = await Promise.resolve().then(() => (init_db(), db_exports));
    const limit = parseInt(req.query.limit || "50", 10);
    const offset = parseInt(req.query.offset || "0", 10);
    const executions = listExecutions3(limit, offset);
    res.json({ ok: true, data: executions });
  } catch (error) {
    res.json({ ok: false, error: "Telemetry DB not available", data: [] });
  }
});
app.get("/api/telemetry/runs", async (req, res) => {
  try {
    const { listRuns: listRuns2, ensureRunsTable: ensureRunsTable2 } = await Promise.resolve().then(() => (init_db(), db_exports));
    ensureRunsTable2();
    const limit = parseInt(req.query.limit || "5", 10);
    const runs = listRuns2(limit);
    res.json({ ok: true, data: runs });
  } catch (error) {
    res.json({ ok: true, data: [] });
  }
});
app.post("/api/telemetry/runs", async (req, res) => {
  try {
    const { upsertRun: upsertRun2, ensureRunsTable: ensureRunsTable2 } = await Promise.resolve().then(() => (init_db(), db_exports));
    ensureRunsTable2();
    const {
      run_id,
      started_at,
      duration_secs,
      total_users,
      concurrency,
      total_requests,
      success_rate,
      p50_ms,
      p95_ms,
      http_5xx_count,
      top_error
    } = req.body;
    if (!run_id) {
      return res.status(400).json({ ok: false, error: "run_id is required" });
    }
    upsertRun2({
      run_id,
      stage: null,
      users: total_users || 0,
      concurrency: concurrency || 0,
      duration: duration_secs || 0,
      total_requests: total_requests || 0,
      success_rate: success_rate || 0,
      p50_ms: p50_ms || 0,
      p95_ms: p95_ms || 0,
      http_5xx: http_5xx_count || 0,
      top_error_code: top_error || null,
      started_at: started_at || (/* @__PURE__ */ new Date()).toISOString(),
      ended_at: (/* @__PURE__ */ new Date()).toISOString(),
      report_path: null
    });
    res.json({ ok: true, run_id });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "Failed to store run" });
  }
});
app.get("/api/telemetry/debug", async (req, res) => {
  try {
    const { getDatabase: getDatabase3, ensureRunsTable: ensureRunsTable2 } = await Promise.resolve().then(() => (init_db(), db_exports));
    const db3 = getDatabase3();
    ensureRunsTable2();
    const dbPath = process.env.TELEMETRY_DB_PATH || "./telemetry/telemetry.db";
    let isWritable = false;
    try {
      db3.exec("SELECT 1");
      isWritable = true;
    } catch (e) {
      isWritable = false;
    }
    const tables = db3.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const tableNames = tables.map((t) => t.name);
    const counts = {};
    for (const table of ["users", "request_log", "executions", "runs", "access_codes"]) {
      try {
        const row = db3.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
        counts[table] = row?.count ?? 0;
      } catch {
        counts[table] = -1;
      }
    }
    let latestRun = null;
    try {
      latestRun = db3.prepare("SELECT run_id, started_at, total_requests, success_rate FROM runs ORDER BY created_at DESC LIMIT 1").get();
    } catch {
    }
    const appVersion = process.env.FLY_IMAGE_REF || process.env.VERCEL_GIT_COMMIT_SHA || "unknown";
    res.json({
      ok: true,
      debug: {
        dbPath,
        isWritable,
        tables: tableNames,
        rowCounts: counts,
        latestRun,
        appVersion,
        nodeEnv: process.env.NODE_ENV || "development",
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message || "Failed to get debug info"
    });
  }
});
var PORT = parseInt(process.env.PORT || "3001", 10);
var HOST = process.env.HOST || "0.0.0.0";
(async () => {
  try {
    const {
      EXECUTION_MODE: EXECUTION_MODE2,
      EXECUTION_AUTH_MODE: EXECUTION_AUTH_MODE2,
      ETH_TESTNET_RPC_URL: ETH_TESTNET_RPC_URL2,
      EXECUTION_ROUTER_ADDRESS: EXECUTION_ROUTER_ADDRESS2,
      RELAYER_PRIVATE_KEY: RELAYER_PRIVATE_KEY2,
      ETH_TESTNET_CHAIN_ID: ETH_TESTNET_CHAIN_ID3
    } = await Promise.resolve().then(() => (init_config(), config_exports));
    const hasGeminiKey = !!process.env.BLOSSOM_GEMINI_API_KEY;
    const hasOpenAIKey = !!process.env.BLOSSOM_OPENAI_API_KEY;
    const hasAnthropicKey = !!process.env.BLOSSOM_ANTHROPIC_API_KEY;
    const redactedRpcUrl = ETH_TESTNET_RPC_URL2 ? `${ETH_TESTNET_RPC_URL2.substring(0, 20)}...${ETH_TESTNET_RPC_URL2.substring(ETH_TESTNET_RPC_URL2.length - 10)}` : "not configured";
    if (EXECUTION_MODE2 === "eth_testnet") {
      const {
        MOCK_SWAP_ADAPTER_ADDRESS: MOCK_SWAP_ADAPTER_ADDRESS2,
        UNISWAP_V3_ADAPTER_ADDRESS: UNISWAP_V3_ADAPTER_ADDRESS2,
        UNISWAP_ADAPTER_ADDRESS: UNISWAP_ADAPTER_ADDRESS2,
        WETH_WRAP_ADAPTER_ADDRESS: WETH_WRAP_ADAPTER_ADDRESS2,
        ERC20_PULL_ADAPTER_ADDRESS: ERC20_PULL_ADAPTER_ADDRESS2,
        PROOF_ADAPTER_ADDRESS: PROOF_ADAPTER_ADDRESS2
      } = await Promise.resolve().then(() => (init_config(), config_exports));
      console.log(`
\u{1F527} ETH Testnet Execution Configuration`);
      console.log(`   Chain ID: ${ETH_TESTNET_CHAIN_ID3 || "N/A"} (Sepolia: 11155111)`);
      console.log(`   Router Address: ${EXECUTION_ROUTER_ADDRESS2 ? `${EXECUTION_ROUTER_ADDRESS2.substring(0, 10)}...${EXECUTION_ROUTER_ADDRESS2.substring(EXECUTION_ROUTER_ADDRESS2.length - 8)}` : "NOT SET"}`);
      console.log(`   Adapter Addresses:`);
      if (MOCK_SWAP_ADAPTER_ADDRESS2) console.log(`     - MOCK_SWAP: ${MOCK_SWAP_ADAPTER_ADDRESS2.substring(0, 10)}...${MOCK_SWAP_ADAPTER_ADDRESS2.substring(MOCK_SWAP_ADAPTER_ADDRESS2.length - 8)}`);
      if (UNISWAP_V3_ADAPTER_ADDRESS2) console.log(`     - UNISWAP_V3: ${UNISWAP_V3_ADAPTER_ADDRESS2.substring(0, 10)}...${UNISWAP_V3_ADAPTER_ADDRESS2.substring(UNISWAP_V3_ADAPTER_ADDRESS2.length - 8)}`);
      if (UNISWAP_ADAPTER_ADDRESS2) console.log(`     - UNISWAP: ${UNISWAP_ADAPTER_ADDRESS2.substring(0, 10)}...${UNISWAP_ADAPTER_ADDRESS2.substring(UNISWAP_ADAPTER_ADDRESS2.length - 8)}`);
      if (WETH_WRAP_ADAPTER_ADDRESS2) console.log(`     - WETH_WRAP: ${WETH_WRAP_ADAPTER_ADDRESS2.substring(0, 10)}...${WETH_WRAP_ADAPTER_ADDRESS2.substring(WETH_WRAP_ADAPTER_ADDRESS2.length - 8)}`);
      if (ERC20_PULL_ADAPTER_ADDRESS2) console.log(`     - ERC20_PULL: ${ERC20_PULL_ADAPTER_ADDRESS2.substring(0, 10)}...${ERC20_PULL_ADAPTER_ADDRESS2.substring(ERC20_PULL_ADAPTER_ADDRESS2.length - 8)}`);
      if (PROOF_ADAPTER_ADDRESS2) console.log(`     - PROOF: ${PROOF_ADAPTER_ADDRESS2.substring(0, 10)}...${PROOF_ADAPTER_ADDRESS2.substring(PROOF_ADAPTER_ADDRESS2.length - 8)}`);
      console.log(`   RPC URL: ${redactedRpcUrl}`);
      console.log(``);
    }
    if (process.env.DEBUG_DEMO === "true") {
      console.log(`
\u{1F50D} DEBUG_DEMO: Execution Path Configuration`);
      console.log(`   EXECUTION_MODE: ${EXECUTION_MODE2}`);
      console.log(`   EXECUTION_AUTH_MODE: ${EXECUTION_AUTH_MODE2 || "direct"}`);
      console.log(`   Router Address: ${EXECUTION_ROUTER_ADDRESS2 ? `${EXECUTION_ROUTER_ADDRESS2.substring(0, 10)}...` : "NOT SET"}`);
      console.log(`   Relayer PK Present: ${!!RELAYER_PRIVATE_KEY2}`);
      console.log(`   RPC URL: ${redactedRpcUrl}`);
      console.log(`   Chain ID: ${ETH_TESTNET_CHAIN_ID3 || "N/A"}`);
      console.log(``);
    }
    console.log(`
\u{1F338} Blossom Agent Startup Configuration`);
    console.log(`   Port: ${PORT}`);
    console.log(`   Host: ${HOST}`);
    console.log(`   EXECUTION_MODE: ${EXECUTION_MODE2}`);
    console.log(`   EXECUTION_AUTH_MODE: ${EXECUTION_AUTH_MODE2 || "direct"}`);
    console.log(`
   Configuration Status:`);
    console.log(`   \u2713 hasEthRpcUrl: ${!!ETH_TESTNET_RPC_URL2} (${redactedRpcUrl})`);
    console.log(`   \u2713 hasExecutionRouterAddress: ${!!EXECUTION_ROUTER_ADDRESS2} ${EXECUTION_ROUTER_ADDRESS2 ? `(${EXECUTION_ROUTER_ADDRESS2.substring(0, 10)}...)` : ""}`);
    console.log(`   \u2713 hasGeminiKey: ${hasGeminiKey}`);
    console.log(`   \u2713 hasOpenAIKey: ${hasOpenAIKey}`);
    console.log(`   \u2713 hasAnthropicKey: ${hasAnthropicKey}`);
    if (EXECUTION_AUTH_MODE2 === "session") {
      console.log(`
   Session Mode Requirements:`);
      console.log(`   \u2713 hasRelayerPrivateKey: ${!!RELAYER_PRIVATE_KEY2}`);
      console.log(`   \u2713 hasExecutionRouterAddress: ${!!EXECUTION_ROUTER_ADDRESS2}`);
      console.log(`   \u2713 hasEthRpcUrl: ${!!ETH_TESTNET_RPC_URL2}`);
      if (!RELAYER_PRIVATE_KEY2 || !EXECUTION_ROUTER_ADDRESS2 || !ETH_TESTNET_RPC_URL2) {
        console.log(`
   \u26A0\uFE0F  WARNING: Session mode requires:`);
        if (!RELAYER_PRIVATE_KEY2) console.log(`      - RELAYER_PRIVATE_KEY`);
        if (!EXECUTION_ROUTER_ADDRESS2) console.log(`      - EXECUTION_ROUTER_ADDRESS`);
        if (!ETH_TESTNET_RPC_URL2) console.log(`      - ETH_TESTNET_RPC_URL`);
        console.log(`      Session mode will be disabled. Direct mode will be used instead.`);
      } else {
        console.log(`   \u2713 Session mode configured`);
      }
    }
    if (EXECUTION_MODE2 === "eth_testnet") {
      try {
        const { validateEthTestnetConfig: validateEthTestnetConfig2 } = await Promise.resolve().then(() => (init_config(), config_exports));
        await validateEthTestnetConfig2();
        console.log(`   \u2713 ETH testnet configuration validated`);
      } catch (error) {
        console.log(`
   \u274C ERROR: ETH testnet configuration validation failed:`);
        console.log(`      ${error.message}`);
        console.log(`      Please fix configuration errors before using eth_testnet mode.`);
      }
      if (!ETH_TESTNET_RPC_URL2) {
        console.log(`
   \u26A0\uFE0F  WARNING: ETH_TESTNET_RPC_URL not configured`);
        console.log(`      Set it in agent/.env.local to enable testnet features`);
      }
      if (!EXECUTION_ROUTER_ADDRESS2) {
        console.log(`
   \u26A0\uFE0F  WARNING: EXECUTION_ROUTER_ADDRESS not configured`);
        console.log(`      Deploy contracts and set address in agent/.env.local`);
      }
      if (ETH_TESTNET_RPC_URL2) {
        try {
          const { initRpcProvider: initRpcProvider2 } = await Promise.resolve().then(() => (init_rpcProvider(), rpcProvider_exports));
          const { ETH_RPC_FALLBACK_URLS: ETH_RPC_FALLBACK_URLS2 } = await Promise.resolve().then(() => (init_config(), config_exports));
          initRpcProvider2(ETH_TESTNET_RPC_URL2, ETH_RPC_FALLBACK_URLS2);
          if (ETH_RPC_FALLBACK_URLS2.length > 0) {
            console.log(`   \u2713 RPC failover configured with ${ETH_RPC_FALLBACK_URLS2.length} fallback(s)`);
          }
        } catch (error) {
          console.log(`   \u26A0\uFE0F  RPC provider init skipped: ${error.message}`);
        }
      }
    }
    console.log(``);
  } catch (error) {
    console.log(`\u{1F338} Blossom Agent (config load skipped)`);
  }
})();
if (!process.env.VERCEL) {
  app.listen(PORT, HOST, async () => {
    const listenUrl = HOST === "0.0.0.0" ? `http://127.0.0.1:${PORT}` : `http://${HOST}:${PORT}`;
    console.log(`\u{1F338} Blossom Agent server listening on ${listenUrl}`);
    console.log(`   Health check: http://127.0.0.1:${PORT}/health`);
    console.log(`   API endpoints:`);
    console.log(`   - POST /api/chat`);
    console.log(`   - POST /api/strategy/close`);
    console.log(`   - POST /api/reset`);
    console.log(`   - GET  /api/ticker`);
    console.log(`   - POST /api/execute/prepare`);
    console.log(`   - POST /api/execute/submit`);
    console.log(`   - GET  /api/execute/status`);
    console.log(`   - GET  /api/execute/preflight`);
    console.log(`   - POST /api/session/prepare`);
    console.log(`   - POST /api/execute/relayed`);
    console.log(`   - POST /api/token/approve/prepare`);
    console.log(`   - POST /api/token/weth/wrap/prepare`);
    console.log(`   - GET  /api/portfolio/eth_testnet`);
    console.log(`   - GET  /health`);
    console.log(`   - GET  /api/debug/executions`);
    console.log(`   - POST /api/access/validate`);
    console.log(`   - GET  /api/ledger/positions`);
    console.log(`   - GET  /api/ledger/positions/recent`);
    try {
      const { startPerpIndexer: startPerpIndexer2 } = await Promise.resolve().then(() => (init_perpIndexer(), perpIndexer_exports));
      const rpcUrl = process.env.ETH_TESTNET_RPC_URL;
      const perpEngineAddress = process.env.DEMO_PERP_ENGINE_ADDRESS;
      if (rpcUrl && perpEngineAddress) {
        startPerpIndexer2(rpcUrl, perpEngineAddress);
      } else {
        console.log("   [indexer] Perp indexer disabled (config missing)");
      }
    } catch (err) {
      console.log("   [indexer] Failed to start:", err.message);
    }
    console.log(`   - POST /api/access/check`);
    console.log(`   - GET  /api/access/codes (admin)`);
    console.log(`   - POST /api/access/codes/generate (admin)`);
    console.log(`   - GET  /api/prices/eth`);
  });
} else {
  console.log("\u{1F338} Blossom Agent (Vercel serverless mode - app exported, not listening)");
}
app.get("/api/prices/simple", async (req, res) => {
  try {
    const idsParam = req.query.ids;
    const vsCurrenciesParam = req.query.vs_currencies;
    if (!idsParam || typeof idsParam !== "string") {
      return res.status(400).json({
        ok: false,
        code: "MISSING_IDS",
        message: "ids query parameter is required (comma-separated coin IDs)",
        fix: "Add ?ids=ethereum,bitcoin&vs_currencies=usd to the URL"
      });
    }
    const ids = idsParam;
    const vs_currencies = typeof vsCurrenciesParam === "string" ? vsCurrenciesParam : "usd";
    const cache = global.__priceCache || {};
    const cacheKey = `${ids}-${vs_currencies}`;
    const now = Date.now();
    if (cache[cacheKey] && now - cache[cacheKey].timestamp < 6e4) {
      return res.json(cache[cacheKey].data);
    }
    const lastRequest = global.__lastPriceRequest || 0;
    if (now - lastRequest < 2e3) {
      if (cache[cacheKey]) {
        return res.json(cache[cacheKey].data);
      }
      return res.status(503).json({
        ok: false,
        code: "RATE_LIMITED",
        message: "Rate limited - please wait 2 seconds between requests",
        fix: "Wait 2 seconds and retry, or use cached data"
      });
    }
    global.__lastPriceRequest = now;
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=${encodeURIComponent(vs_currencies)}&include_24hr_change=true`;
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json"
      },
      signal: AbortSignal.timeout(5e3)
      // 5s timeout
    });
    if (!response.ok) {
      if (cache[cacheKey]) {
        return res.json(cache[cacheKey].data);
      }
      const staticPrices = {};
      const coinIds = ids.split(",");
      for (const coinId of coinIds) {
        if (coinId === "ethereum") {
          staticPrices.ethereum = { usd: 3e3 };
        } else if (coinId === "bitcoin") {
          staticPrices.bitcoin = { usd: 45e3 };
        } else if (coinId === "solana") {
          staticPrices.solana = { usd: 100 };
        } else if (coinId === "avalanche-2") {
          staticPrices["avalanche-2"] = { usd: 40 };
        } else if (coinId === "chainlink") {
          staticPrices.chainlink = { usd: 14 };
        }
      }
      return res.json(staticPrices);
    }
    const data = await response.json();
    if (!global.__priceCache) {
      global.__priceCache = {};
    }
    global.__priceCache[cacheKey] = {
      data,
      timestamp: now
    };
    res.json(data);
  } catch (error) {
    console.error("[api/prices/simple] Error:", error);
    const cache = global.__priceCache || {};
    const idsParam = req.query.ids;
    const vsCurrenciesParam = req.query.vs_currencies;
    const vs_currencies = typeof vsCurrenciesParam === "string" ? vsCurrenciesParam : "usd";
    const cacheKey = `${typeof idsParam === "string" ? idsParam : ""}-${vs_currencies}`;
    if (cache[cacheKey]) {
      return res.json(cache[cacheKey].data);
    }
    const staticPrices = {};
    const coinIds = typeof idsParam === "string" ? idsParam.split(",") : [];
    for (const coinId of coinIds) {
      if (coinId === "ethereum") {
        staticPrices.ethereum = { usd: 3e3 };
      } else if (coinId === "bitcoin") {
        staticPrices.bitcoin = { usd: 45e3 };
      }
    }
    res.json(staticPrices);
  }
});
app.get("/api/prices/eth", async (req, res) => {
  try {
    const { getPrice: getPrice2 } = await Promise.resolve().then(() => (init_prices(), prices_exports));
    const priceSnapshot = await getPrice2("ETH");
    res.json({
      symbol: "ETH",
      priceUsd: priceSnapshot.priceUsd,
      source: priceSnapshot.source || "coingecko"
    });
  } catch (error) {
    console.error("[api/prices/eth] Error:", error);
    res.json({
      symbol: "ETH",
      priceUsd: 3e3,
      source: "fallback"
    });
  }
});
app.get("/api/debug/executions", (req, res) => {
  try {
    if (process.env.DEBUG_EXECUTIONS !== "1") {
      return res.status(403).json({
        error: "Debug mode not enabled. Set DEBUG_EXECUTIONS=1"
      });
    }
    const artifacts = getExecutionArtifacts();
    res.json({
      count: artifacts.length,
      artifacts
    });
  } catch (error) {
    console.error("[api/debug/executions] Error:", error);
    res.status(500).json({
      error: "Failed to dump execution artifacts",
      message: error.message
    });
  }
});
var relayedAttempts = [];
var MAX_ATTEMPTS_HISTORY = 10;
function addRelayedAttempt(attempt) {
  relayedAttempts.unshift(attempt);
  if (relayedAttempts.length > MAX_ATTEMPTS_HISTORY) {
    relayedAttempts.pop();
  }
}
app.get("/api/debug/routing-stats", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({ error: "Debug endpoint not available in production" });
  }
  try {
    const { getRoutingStats: getRoutingStats2, resetRoutingStats: resetRoutingStats2 } = await Promise.resolve().then(() => (init_routingService(), routingService_exports));
    if (req.query.reset === "true") {
      resetRoutingStats2();
    }
    const stats = getRoutingStats2();
    res.json({
      dflowCallCount: stats.dflowCallCount,
      lastDflowCallAt: stats.lastDflowCallAt,
      lastDflowCallAtIso: stats.lastDflowCallAt ? new Date(stats.lastDflowCallAt).toISOString() : null
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to get routing stats"
    });
  }
});
app.get("/api/debug/session-authority", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({ error: "Debug endpoint not available in production" });
  }
  try {
    const userAddress = req.query.address;
    if (!userAddress) {
      return res.status(400).json({ error: "address query parameter required" });
    }
    const {
      EXECUTION_ROUTER_ADDRESS: EXECUTION_ROUTER_ADDRESS2,
      ETH_TESTNET_RPC_URL: ETH_TESTNET_RPC_URL2,
      UNISWAP_V3_ADAPTER_ADDRESS: UNISWAP_V3_ADAPTER_ADDRESS2,
      WETH_WRAP_ADAPTER_ADDRESS: WETH_WRAP_ADAPTER_ADDRESS2,
      MOCK_SWAP_ADAPTER_ADDRESS: MOCK_SWAP_ADAPTER_ADDRESS2,
      PROOF_ADAPTER_ADDRESS: PROOF_ADAPTER_ADDRESS2,
      ERC20_PULL_ADAPTER_ADDRESS: ERC20_PULL_ADAPTER_ADDRESS2,
      DEMO_LEND_ADAPTER_ADDRESS: DEMO_LEND_ADAPTER_ADDRESS2
    } = await Promise.resolve().then(() => (init_config(), config_exports));
    let chainId = 11155111;
    if (ETH_TESTNET_RPC_URL2) {
      try {
        const { createPublicClient: createPublicClient3, http: http5 } = await import("viem");
        const { sepolia: sepolia5 } = await import("viem/chains");
        const publicClient = createPublicClient3({
          chain: sepolia5,
          transport: http5(ETH_TESTNET_RPC_URL2)
        });
        chainId = await publicClient.getChainId();
      } catch (error) {
      }
    }
    let sessionStatus = null;
    try {
      const recentAttempt = relayedAttempts.find((a) => a.userAddress.toLowerCase() === userAddress.toLowerCase());
      if (recentAttempt && ETH_TESTNET_RPC_URL2 && EXECUTION_ROUTER_ADDRESS2) {
        const { createPublicClient: createPublicClient3, http: http5 } = await import("viem");
        const { sepolia: sepolia5 } = await import("viem/chains");
        const publicClient = createPublicClient3({
          chain: sepolia5,
          transport: http5(ETH_TESTNET_RPC_URL2)
        });
        const normalizedSessionId = recentAttempt.sessionId.startsWith("0x") ? recentAttempt.sessionId : `0x${recentAttempt.sessionId}`;
        const sessionAbi = [
          {
            name: "sessions",
            type: "function",
            stateMutability: "view",
            inputs: [{ name: "", type: "bytes32" }],
            outputs: [
              { name: "owner", type: "address" },
              { name: "executor", type: "address" },
              { name: "expiresAt", type: "uint64" },
              { name: "maxSpend", type: "uint256" },
              { name: "spent", type: "uint256" },
              { name: "active", type: "bool" }
            ]
          }
        ];
        try {
          const sessionResult = await Promise.race([
            publicClient.readContract({
              address: EXECUTION_ROUTER_ADDRESS2,
              abi: sessionAbi,
              functionName: "sessions",
              args: [normalizedSessionId]
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2e3))
          ]);
          const now = BigInt(Math.floor(Date.now() / 1e3));
          let status = "not_created";
          if (sessionResult[5]) {
            status = sessionResult[2] > now ? "active" : "expired";
          } else if (sessionResult[0] !== "0x0000000000000000000000000000000000000000") {
            status = "revoked";
          }
          sessionStatus = {
            status,
            owner: sessionResult[0],
            executor: sessionResult[1],
            expiresAt: sessionResult[2].toString(),
            maxSpend: sessionResult[3].toString(),
            spent: sessionResult[4].toString(),
            active: sessionResult[5]
          };
        } catch (error) {
        }
      }
    } catch (error) {
    }
    const allowedAdapters = [];
    if (UNISWAP_V3_ADAPTER_ADDRESS2) allowedAdapters.push(UNISWAP_V3_ADAPTER_ADDRESS2.toLowerCase());
    if (WETH_WRAP_ADAPTER_ADDRESS2) allowedAdapters.push(WETH_WRAP_ADAPTER_ADDRESS2.toLowerCase());
    if (MOCK_SWAP_ADAPTER_ADDRESS2) allowedAdapters.push(MOCK_SWAP_ADAPTER_ADDRESS2.toLowerCase());
    if (PROOF_ADAPTER_ADDRESS2) allowedAdapters.push(PROOF_ADAPTER_ADDRESS2.toLowerCase());
    if (ERC20_PULL_ADAPTER_ADDRESS2) allowedAdapters.push(ERC20_PULL_ADAPTER_ADDRESS2.toLowerCase());
    if (DEMO_LEND_ADAPTER_ADDRESS2) allowedAdapters.push(DEMO_LEND_ADAPTER_ADDRESS2.toLowerCase());
    const userAttempts = relayedAttempts.filter((a) => a.userAddress.toLowerCase() === userAddress.toLowerCase()).slice(0, 10);
    let activeSessionId = null;
    if (sessionStatus?.status === "active" && userAttempts.length > 0) {
      activeSessionId = userAttempts[0].sessionId || null;
    }
    res.json({
      chainId,
      executionRouterAddress: EXECUTION_ROUTER_ADDRESS2 || null,
      sessionStatus: sessionStatus ? {
        ...sessionStatus,
        sessionId: activeSessionId || sessionStatus.sessionId || null
      } : null,
      sessionId: activeSessionId,
      // Top-level for easy access
      effectivePolicy: {
        allowedAdapters,
        maxSpendPerTx: "10000000000000000000"
        // 10 ETH in wei (from session creation)
      },
      recentAttempts: userAttempts
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Failed to get session authority state"
    });
  }
});
app.get("/api/debug/dflow-probe", async (req, res) => {
  try {
    const { probeDflowEndpoints: probeDflowEndpoints2 } = await Promise.resolve().then(() => (init_dflowClient(), dflowClient_exports));
    const results = await probeDflowEndpoints2();
    const workingQuoteEndpoints = results.quoteApi.filter((r) => r.status >= 200 && r.status < 500);
    const workingPredictionEndpoints = results.predictionApi.filter((r) => r.status >= 200 && r.status < 500);
    res.json({
      summary: {
        configured: results.configured,
        apiKeySet: results.apiKeySet,
        quoteApiWorking: workingQuoteEndpoints.length,
        predictionApiWorking: workingPredictionEndpoints.length
      },
      quoteApi: results.quoteApi,
      predictionApi: results.predictionApi,
      recommendations: [
        results.apiKeySet ? null : "Set DFLOW_API_KEY in .env.local",
        workingQuoteEndpoints.find((e) => e.path === "/v1/swap/quote") ? "Set DFLOW_SWAPS_QUOTE_PATH=/v1/swap/quote" : null,
        workingPredictionEndpoints.find((e) => e.path === "/v1/events/markets") ? "Set DFLOW_EVENTS_MARKETS_PATH=/v1/events/markets" : null,
        workingPredictionEndpoints.find((e) => e.path === "/v1/markets") ? "Alt: Set DFLOW_EVENTS_MARKETS_PATH=/v1/markets" : null
      ].filter(Boolean)
    });
  } catch (error) {
    console.error("[api/debug/dflow-probe] Error:", error);
    res.status(500).json({
      error: "Failed to probe dFlow endpoints",
      message: error.message
    });
  }
});
app.get("/api/debug/session-recent", async (req, res) => {
  try {
    const { EXECUTION_ROUTER_ADDRESS: EXECUTION_ROUTER_ADDRESS2, ETH_TESTNET_RPC_URL: ETH_TESTNET_RPC_URL2 } = await Promise.resolve().then(() => (init_config(), config_exports));
    if (!ETH_TESTNET_RPC_URL2 || !EXECUTION_ROUTER_ADDRESS2) {
      return res.status(500).json({ error: "ETH_TESTNET_RPC_URL or EXECUTION_ROUTER_ADDRESS not configured" });
    }
    const { createPublicClient: createPublicClient3, http: http5 } = await import("viem");
    const { sepolia: sepolia5 } = await import("viem/chains");
    const publicClient = createPublicClient3({
      chain: sepolia5,
      transport: http5(ETH_TESTNET_RPC_URL2)
    });
    const currentBlock = await publicClient.getBlockNumber();
    const fromBlock = currentBlock - 1000n;
    const executionRouterAbi = [
      {
        type: "event",
        name: "SessionCreated",
        inputs: [
          { name: "sessionId", type: "bytes32", indexed: true },
          { name: "owner", type: "address", indexed: true },
          { name: "executor", type: "address", indexed: true },
          { name: "expiresAt", type: "uint64", indexed: false },
          { name: "maxSpend", type: "uint256", indexed: false }
        ]
      }
    ];
    const events = await publicClient.getLogs({
      address: EXECUTION_ROUTER_ADDRESS2,
      event: executionRouterAbi[0],
      fromBlock,
      toBlock: "latest"
    });
    res.json({
      routerAddress: EXECUTION_ROUTER_ADDRESS2,
      currentBlock: currentBlock.toString(),
      fromBlock: fromBlock.toString(),
      eventsFound: events.length,
      events: events.slice(-10).map((e) => ({
        blockNumber: e.blockNumber.toString(),
        transactionHash: e.transactionHash,
        sessionId: e.args.sessionId,
        owner: e.args.owner,
        executor: e.args.executor,
        expiresAt: e.args.expiresAt.toString(),
        maxSpend: e.args.maxSpend.toString()
      }))
    });
  } catch (error) {
    console.error("[api/debug/session-recent] Error:", error);
    res.status(500).json({ error: error.message });
  }
});
app.get("/api/debug/session-diagnose", async (req, res) => {
  try {
    const { txHash } = req.query;
    if (!txHash || typeof txHash !== "string") {
      return res.status(400).json({
        error: "txHash query parameter is required"
      });
    }
    const {
      EXECUTION_ROUTER_ADDRESS: EXECUTION_ROUTER_ADDRESS2,
      ETH_TESTNET_RPC_URL: ETH_TESTNET_RPC_URL2
    } = await Promise.resolve().then(() => (init_config(), config_exports));
    if (!ETH_TESTNET_RPC_URL2 || !EXECUTION_ROUTER_ADDRESS2) {
      return res.status(500).json({
        error: "ETH_TESTNET_RPC_URL or EXECUTION_ROUTER_ADDRESS not configured"
      });
    }
    const { createPublicClient: createPublicClient3, http: http5, decodeEventLog } = await import("viem");
    const { sepolia: sepolia5 } = await import("viem/chains");
    const publicClient = createPublicClient3({
      chain: sepolia5,
      transport: http5(ETH_TESTNET_RPC_URL2)
    });
    const chainId = await publicClient.getChainId();
    const routerCode = await publicClient.getBytecode({ address: EXECUTION_ROUTER_ADDRESS2 });
    const routerIsContract = routerCode && routerCode !== "0x" && routerCode.length > 2;
    const tx = await publicClient.getTransaction({ hash: txHash });
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
    const executionRouterAbi = [
      {
        type: "event",
        name: "SessionCreated",
        inputs: [
          { name: "sessionId", type: "bytes32", indexed: true },
          { name: "owner", type: "address", indexed: true },
          { name: "executor", type: "address", indexed: true },
          // Fixed: executor is indexed in contract
          { name: "expiresAt", type: "uint64", indexed: false },
          { name: "maxSpend", type: "uint256", indexed: false }
        ]
      }
    ];
    const emittedEvents = [];
    let sessionCreatedEvent = null;
    if (receipt.logs) {
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: executionRouterAbi,
            data: log.data,
            topics: log.topics
          });
          emittedEvents.push({ name: decoded.eventName });
          if (decoded.eventName === "SessionCreated") {
            sessionCreatedEvent = {
              sessionId: decoded.args.sessionId,
              owner: decoded.args.owner,
              executor: decoded.args.executor,
              expiresAt: decoded.args.expiresAt,
              maxSpend: decoded.args.maxSpend
            };
          }
        } catch {
        }
      }
    }
    res.json({
      chainId,
      routerAddress: EXECUTION_ROUTER_ADDRESS2,
      routerIsContract,
      routerCodeLength: routerCode?.length || 0,
      tx: {
        to: tx.to,
        input: tx.input.substring(0, 10),
        // First 10 bytes (function selector + first param)
        value: tx.value.toString()
      },
      receipt: {
        status: receipt.status,
        blockNumber: receipt.blockNumber.toString(),
        logsCount: receipt.logs.length
      },
      events: {
        emitted: emittedEvents.map((e) => e.name),
        sessionCreated: sessionCreatedEvent ? {
          sessionId: sessionCreatedEvent.sessionId,
          owner: sessionCreatedEvent.owner,
          executor: sessionCreatedEvent.executor,
          expiresAt: sessionCreatedEvent.expiresAt.toString(),
          maxSpend: sessionCreatedEvent.maxSpend.toString()
        } : null
      }
    });
  } catch (error) {
    console.error("[api/debug/session-diagnose] Error:", error);
    res.status(500).json({
      error: "Failed to diagnose session transaction",
      message: error.message
    });
  }
});
var DEV_LEDGER_SECRET = process.env.DEV_LEDGER_SECRET || "";
function safeHash(value) {
  if (!value) return "empty";
  return createHash2("sha256").update(value).digest("hex").slice(0, 6);
}
function checkLedgerSecret(req, res, next) {
  const authDebug = process.env.AUTH_DEBUG === "1";
  if (!DEV_LEDGER_SECRET) {
    if (authDebug) {
      console.warn("[ledger-auth] hasEnvSecret=false, envSecretHashPrefix=empty");
    }
    console.warn("[ledger] DEV_LEDGER_SECRET not configured - blocking all ledger API access");
    return res.status(403).json({
      ok: false,
      error: "Ledger not configured: DEV_LEDGER_SECRET env var required"
    });
  }
  const providedSecret = req.headers["x-ledger-secret"];
  if (authDebug) {
    console.log("[ledger-auth] hasEnvSecret=true, envSecretHashPrefix=" + safeHash(DEV_LEDGER_SECRET));
    console.log("[ledger-auth] hasHeaderSecret=" + !!providedSecret + ", headerSecretHashPrefix=" + safeHash(providedSecret || ""));
    console.log("[ledger-auth] comparisonResult=" + (providedSecret === DEV_LEDGER_SECRET ? "match" : "mismatch"));
  }
  if (req.query.secret) {
    console.warn("[ledger] Query param ?secret= is deprecated and ignored. Use X-Ledger-Secret header.");
  }
  if (!providedSecret || providedSecret !== DEV_LEDGER_SECRET) {
    return res.status(403).json({ ok: false, error: "Unauthorized: Invalid or missing X-Ledger-Secret header" });
  }
  next();
}
app.get("/api/ledger/summary", checkLedgerSecret, async (req, res) => {
  try {
    const { getLedgerSummary: getLedgerSummary3 } = await Promise.resolve().then(() => (init_db2(), db_exports2));
    const summary = getLedgerSummary3();
    res.json({ ok: true, data: summary });
  } catch (error) {
    res.json({
      ok: false,
      error: "Execution ledger not available",
      data: {
        totalExecutions: 0,
        confirmedExecutions: 0,
        failedExecutions: 0,
        successRate: 0,
        byChain: [],
        activeSessions: 0,
        trackedAssets: 0,
        registeredWallets: 0,
        recentExecutions: []
      }
    });
  }
});
app.get("/api/ledger/executions", checkLedgerSecret, async (req, res) => {
  try {
    const { listExecutionsWithMeta: listExecutionsWithMeta2 } = await Promise.resolve().then(() => (init_db2(), db_exports2));
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const chain = req.query.chain;
    const network = req.query.network;
    const status = req.query.status;
    const result = listExecutionsWithMeta2({ chain, network, status, limit, offset });
    res.json({ ok: true, data: result.data, meta: result.meta });
  } catch (error) {
    res.json({ ok: false, error: "Failed to fetch executions", data: [], meta: { totalInDb: 0, limit: 50, offset: 0 } });
  }
});
app.get("/api/ledger/sessions", checkLedgerSecret, async (req, res) => {
  try {
    const { listSessionsWithMeta: listSessionsWithMeta2 } = await Promise.resolve().then(() => (init_db2(), db_exports2));
    const limit = parseInt(req.query.limit) || 50;
    const chain = req.query.chain;
    const network = req.query.network;
    const status = req.query.status;
    const result = listSessionsWithMeta2({ chain, network, status, limit });
    res.json({ ok: true, data: result.data, meta: result.meta });
  } catch (error) {
    res.json({ ok: false, error: "Failed to fetch sessions", data: [], meta: { totalInDb: 0, limit: 50, offset: 0 } });
  }
});
app.get("/api/ledger/assets", checkLedgerSecret, async (req, res) => {
  try {
    const { listAssetsWithMeta: listAssetsWithMeta2 } = await Promise.resolve().then(() => (init_db2(), db_exports2));
    const limit = parseInt(req.query.limit) || 100;
    const chain = req.query.chain;
    const network = req.query.network;
    const walletAddress = req.query.wallet;
    const result = listAssetsWithMeta2({ chain, network, walletAddress, limit });
    res.json({ ok: true, data: result.data, meta: result.meta });
  } catch (error) {
    res.json({ ok: false, error: "Failed to fetch assets", data: [], meta: { totalInDb: 0, limit: 100, offset: 0 } });
  }
});
app.get("/api/ledger/proofs", checkLedgerSecret, async (req, res) => {
  try {
    const { getProofBundle: getProofBundle3 } = await Promise.resolve().then(() => (init_db2(), db_exports2));
    const proofs = getProofBundle3();
    res.json({ ok: true, data: proofs });
  } catch (error) {
    res.json({
      ok: false,
      error: "Failed to fetch proof bundle",
      data: { ethereum: [], solana: [] }
    });
  }
});
app.get("/api/ledger/wallets", checkLedgerSecret, async (req, res) => {
  try {
    const { listWallets: listWallets2 } = await Promise.resolve().then(() => (init_db2(), db_exports2));
    const chain = req.query.chain;
    const network = req.query.network;
    const wallets = listWallets2({ chain, network });
    res.json({ ok: true, data: wallets });
  } catch (error) {
    res.json({ ok: false, error: "Failed to fetch wallets", data: [] });
  }
});
app.get("/api/ledger/stats/summary", checkLedgerSecret, async (req, res) => {
  try {
    const { getSummaryStats: getSummaryStats2 } = await Promise.resolve().then(() => (init_db2(), db_exports2));
    const stats = getSummaryStats2();
    res.json({ ok: true, data: stats });
  } catch (error) {
    console.error("[ledger] Failed to fetch stats summary:", error);
    res.json({
      ok: false,
      error: "Failed to fetch stats summary",
      data: null
    });
  }
});
app.get("/api/ledger/stats/recent", checkLedgerSecret, async (req, res) => {
  try {
    const { getRecentExecutions: getRecentExecutions2 } = await Promise.resolve().then(() => (init_db2(), db_exports2));
    const limit = parseInt(req.query.limit) || 20;
    const executions = getRecentExecutions2(Math.min(limit, 100));
    res.json({ ok: true, data: executions });
  } catch (error) {
    console.error("[ledger] Failed to fetch recent executions:", error);
    res.json({ ok: false, error: "Failed to fetch recent executions", data: [] });
  }
});
app.get("/api/ledger/executions/:id", checkLedgerSecret, async (req, res) => {
  try {
    const { getExecution: getExecution3 } = await Promise.resolve().then(() => (init_db2(), db_exports2));
    const execution = getExecution3(req.params.id);
    if (!execution) {
      return res.status(404).json({ ok: false, error: "Execution not found", data: null });
    }
    res.json({ ok: true, data: execution });
  } catch (error) {
    console.error("[ledger] Failed to fetch execution:", error);
    res.json({ ok: false, error: "Failed to fetch execution", data: null });
  }
});
app.get("/api/ledger/executions/:id/steps", checkLedgerSecret, async (req, res) => {
  try {
    const { getExecutionSteps: getExecutionSteps3, getExecution: getExecution3 } = await Promise.resolve().then(() => (init_db2(), db_exports2));
    const execution = getExecution3(req.params.id);
    if (!execution) {
      return res.status(404).json({ ok: false, error: "Execution not found", data: [] });
    }
    const steps = getExecutionSteps3(req.params.id);
    res.json({ ok: true, data: steps });
  } catch (error) {
    console.error("[ledger] Failed to fetch execution steps:", error);
    res.json({ ok: false, error: "Failed to fetch execution steps", data: [] });
  }
});
app.get("/api/ledger/intents/recent", checkLedgerSecret, async (req, res) => {
  try {
    const { getRecentIntents: getRecentIntents2 } = await Promise.resolve().then(() => (init_db2(), db_exports2));
    const limit = parseInt(req.query.limit) || 50;
    const intents = getRecentIntents2(Math.min(limit, 100));
    res.json({ ok: true, data: intents });
  } catch (error) {
    console.error("[ledger] Failed to fetch recent intents:", error);
    res.json({ ok: false, error: "Failed to fetch intents", data: [] });
  }
});
app.get("/api/ledger/intents/:id", checkLedgerSecret, async (req, res) => {
  try {
    const { getIntent: getIntent2, getExecutionsForIntent: getExecutionsForIntent2 } = await Promise.resolve().then(() => (init_db2(), db_exports2));
    const intent = getIntent2(req.params.id);
    if (!intent) {
      return res.status(404).json({ ok: false, error: "Intent not found", data: null });
    }
    const executions = getExecutionsForIntent2(req.params.id);
    res.json({
      ok: true,
      data: {
        ...intent,
        executions
      }
    });
  } catch (error) {
    console.error("[ledger] Failed to fetch intent:", error);
    res.json({ ok: false, error: "Failed to fetch intent", data: null });
  }
});
app.get("/api/ledger/stats/intents", checkLedgerSecret, async (req, res) => {
  try {
    const { getIntentStatsSummary: getIntentStatsSummary2 } = await Promise.resolve().then(() => (init_db2(), db_exports2));
    const stats = getIntentStatsSummary2();
    res.json({ ok: true, data: stats });
  } catch (error) {
    console.error("[ledger] Failed to fetch intent stats:", error);
    res.json({
      ok: false,
      error: "Failed to fetch intent stats",
      data: {
        totalIntents: 0,
        confirmedIntents: 0,
        failedIntents: 0,
        intentSuccessRate: 0,
        byKind: [],
        byStatus: [],
        failuresByStage: [],
        failuresByCode: [],
        recentIntents: []
      }
    });
  }
});
app.get("/api/ledger/intents/:id/executions", checkLedgerSecret, async (req, res) => {
  try {
    const { getIntent: getIntent2, getExecutionsForIntent: getExecutionsForIntent2 } = await Promise.resolve().then(() => (init_db2(), db_exports2));
    const intent = getIntent2(req.params.id);
    if (!intent) {
      return res.status(404).json({ ok: false, error: "Intent not found", data: [] });
    }
    const executions = getExecutionsForIntent2(req.params.id);
    res.json({ ok: true, data: executions });
  } catch (error) {
    console.error("[ledger] Failed to fetch intent executions:", error);
    res.json({ ok: false, error: "Failed to fetch intent executions", data: [] });
  }
});
app.post("/api/ledger/intents/execute", checkLedgerSecret, async (req, res) => {
  try {
    const { intentText, chain = "ethereum", planOnly = false, intentId, metadata } = req.body;
    const { runIntent: runIntent2, executeIntentById: executeIntentById2, recordFailedIntent: recordFailedIntent2 } = await Promise.resolve().then(() => (init_intentRunner(), intentRunner_exports));
    if (intentId && typeof intentId === "string") {
      const result2 = await executeIntentById2(intentId);
      return res.json(result2);
    }
    const origin = req.headers.origin || req.headers.referer || "unknown";
    const callerMetadata = typeof metadata === "object" && metadata !== null ? metadata : {};
    const source = callerMetadata.source || (origin.includes("localhost") || origin.includes("blossom") ? "ui" : "unknown");
    const domain = callerMetadata.domain || (origin !== "unknown" ? new URL(origin).host : "unknown");
    const enrichedMetadata = {
      ...callerMetadata,
      source,
      domain,
      timestamp: Date.now()
    };
    if (!intentText || typeof intentText !== "string" || !intentText.trim()) {
      const failedResult = await recordFailedIntent2({
        intentText: intentText || "",
        failureStage: "plan",
        errorCode: "INVALID_REQUEST",
        errorMessage: "intentText is required (or intentId to execute planned intent)",
        metadata: enrichedMetadata
      });
      return res.status(400).json(failedResult);
    }
    const result = await runIntent2(intentText, {
      chain,
      planOnly: Boolean(planOnly),
      metadata: enrichedMetadata
    });
    res.json(result);
  } catch (error) {
    console.error("[ledger] Intent execution error:", error);
    res.status(500).json({
      ok: false,
      intentId: "",
      status: "failed",
      error: {
        stage: "execute",
        code: "INTERNAL_ERROR",
        message: error.message || "Internal server error"
      }
    });
  }
});
app.get("/api/ledger/positions/recent", checkLedgerSecret, async (req, res) => {
  try {
    const { getRecentPositions: getRecentPositions3 } = await Promise.resolve().then(() => (init_db2(), db_exports2));
    const limit = parseInt(req.query.limit) || 20;
    const positions = getRecentPositions3(Math.min(limit, 100));
    res.json({ ok: true, positions });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});
app.get("/api/ledger/positions", checkLedgerSecret, async (req, res) => {
  try {
    const { getOpenPositions: getOpenPositions3, getPositionsByStatus: getPositionsByStatus2 } = await Promise.resolve().then(() => (init_db2(), db_exports2));
    const status = req.query.status;
    const chain = req.query.chain;
    const network = req.query.network;
    const venue = req.query.venue;
    const limit = parseInt(req.query.limit) || 50;
    let positions;
    if (status === "open") {
      positions = getOpenPositions3({ chain, network, venue });
    } else if (status === "closed" || status === "liquidated") {
      positions = getPositionsByStatus2(status, limit);
    } else {
      positions = getOpenPositions3({ chain, network, venue });
    }
    res.json({ ok: true, positions });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});
app.get("/api/ledger/positions/:id", checkLedgerSecret, async (req, res) => {
  try {
    const { getPosition: getPosition3 } = await Promise.resolve().then(() => (init_db2(), db_exports2));
    const position = getPosition3(req.params.id);
    if (!position) {
      return res.status(404).json({ ok: false, error: "Position not found" });
    }
    res.json({ ok: true, position });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});
app.get("/api/ledger/positions/stats", checkLedgerSecret, async (req, res) => {
  try {
    const { getPositionStats: getPositionStats3 } = await Promise.resolve().then(() => (init_db2(), db_exports2));
    const stats = getPositionStats3();
    res.json({ ok: true, stats });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});
app.post("/api/access/validate", async (req, res) => {
  try {
    const { code, walletAddress } = req.body;
    if (!code) {
      return res.json({ ok: true, valid: false, error: "Access code required" });
    }
    const result = validateAccessCode(code, walletAddress);
    res.json({ ok: true, valid: result.valid, error: result.error });
  } catch (error) {
    console.error("[access] Validation error:", error.message);
    res.json({ ok: false, valid: false, error: "Validation failed" });
  }
});
app.post("/api/waitlist/join", async (req, res) => {
  try {
    const { email, walletAddress, source } = req.body;
    if (!email && !walletAddress) {
      return res.status(400).json({ ok: false, error: "Email or wallet address required" });
    }
    if (email && !email.includes("@")) {
      return res.status(400).json({ ok: false, error: "Invalid email format" });
    }
    if (walletAddress) {
      const isEth = walletAddress.startsWith("0x") && walletAddress.length === 42;
      const isSolana = walletAddress.length >= 32 && walletAddress.length <= 44;
      if (!isEth && !isSolana) {
        return res.status(400).json({ ok: false, error: "Invalid wallet address format" });
      }
    }
    try {
      const { addToWaitlist: addToWaitlist2 } = await Promise.resolve().then(() => (init_db2(), db_exports2));
      const id = addToWaitlist2({ email, walletAddress, source: source || "landing" });
      console.log(`[waitlist] New signup from ${source || "landing"}: ${id.slice(0, 8)}...`);
      res.json({ ok: true, message: "Successfully joined waitlist" });
    } catch (dbError) {
      console.log(`[waitlist] DB storage failed, using fallback:`, dbError.message);
      const waitlistEntries = global.__waitlist || [];
      waitlistEntries.push({
        id: `wl_${Date.now()}`,
        email,
        walletAddress,
        source: source || "landing",
        createdAt: Date.now()
      });
      global.__waitlist = waitlistEntries;
      res.json({ ok: true, message: "Successfully joined waitlist" });
    }
  } catch (error) {
    console.error("[waitlist] Join error:", error.message);
    res.status(500).json({ ok: false, error: "Failed to join waitlist" });
  }
});
app.get("/api/stats/public", async (req, res) => {
  try {
    const { getStatsSummary: getStatsSummary2, getIntentStats: getIntentStats2 } = await Promise.resolve().then(() => (init_db2(), db_exports2));
    const summary = getStatsSummary2();
    const intentStats = getIntentStats2();
    res.json({
      ok: true,
      data: {
        totalIntents: intentStats.totalIntents || 0,
        confirmedIntents: intentStats.confirmedIntents || 0,
        totalExecutions: summary.totalExecutions || 0,
        successfulExecutions: summary.successfulExecutions || 0,
        successRate: summary.successRate || 0,
        totalUsdRouted: summary.totalUsdRouted || 0,
        chainsActive: summary.chainsActive || [],
        lastUpdated: Date.now()
      }
    });
  } catch (error) {
    res.json({
      ok: true,
      data: {
        totalIntents: 0,
        confirmedIntents: 0,
        totalExecutions: 0,
        successfulExecutions: 0,
        successRate: 0,
        totalUsdRouted: 0,
        chainsActive: [],
        lastUpdated: Date.now()
      }
    });
  }
});
app.use((err, req, res, next) => {
  const correlationId = req.correlationId || "unknown";
  const errorLog = {
    correlationId,
    name: err.name || "Error",
    message: err.message || "Unknown error",
    code: err.code,
    path: req.path,
    method: req.method
  };
  if (process.env.NODE_ENV !== "production") {
    errorLog.stack = err.stack;
    errorLog.cause = err.cause;
  }
  console.error(`[${correlationId}] [ERROR] Unhandled error:`, JSON.stringify(errorLog, null, 2));
  const errorResponse = {
    ok: false,
    correlationId,
    error: {
      message: err.message || "Internal server error",
      code: err.code || "INTERNAL_ERROR"
    }
  };
  if (process.env.NODE_ENV !== "production") {
    errorResponse.error.stack = err.stack;
  }
  res.status(err.status || 500).json(errorResponse);
});
export {
  app
};
//# sourceMappingURL=server-bundle.js.map
