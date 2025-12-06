/**
 * Prediction Market Data Service
 * Fetches live data from Kalshi and Polymarket APIs with fallback to static demo data
 */

export interface RawPredictionMarket {
  id: string;
  title: string;
  source: 'KALSHI' | 'POLYMARKET';
  yesPrice: number;   // 0–1
  noPrice: number;    // 0–1
  volume24hUsd?: number;
  openInterestUsd?: number;
}

// Static fallback for Kalshi markets
const STATIC_KALSHI_MARKETS: RawPredictionMarket[] = [
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
const STATIC_POLYMARKET_MARKETS: RawPredictionMarket[] = [
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
export async function fetchKalshiMarkets(): Promise<RawPredictionMarket[]> {
  const apiUrl = process.env.KALSHI_API_URL;
  const apiKey = process.env.KALSHI_API_KEY;

  // If no API credentials, return static fallback
  if (!apiUrl || !apiKey) {
    console.log('[PredictionData] Kalshi API not configured, using static fallback');
    return STATIC_KALSHI_MARKETS;
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
    const markets: RawPredictionMarket[] = [];
    
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
    } else if (data.markets && Array.isArray(data.markets)) {
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
      return topMarkets;
    } else {
      console.warn('[PredictionData] Kalshi API returned no valid markets, using static fallback');
      return STATIC_KALSHI_MARKETS;
    }
  } catch (error: any) {
    console.warn('[PredictionData] Failed to fetch Kalshi markets:', error.message);
    return STATIC_KALSHI_MARKETS;
  }
}

/**
 * Fetch markets from Polymarket API
 */
export async function fetchPolymarketMarkets(): Promise<RawPredictionMarket[]> {
  const apiUrl = process.env.POLYMARKET_API_URL;

  // If no API URL, return static fallback
  if (!apiUrl) {
    console.log('[PredictionData] Polymarket API not configured, using static fallback');
    return STATIC_POLYMARKET_MARKETS;
  }

  try {
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Polymarket API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    // Map Polymarket API response to RawPredictionMarket[]
    const markets: RawPredictionMarket[] = [];
    
    // Example mapping (adjust based on actual Polymarket API structure):
    if (Array.isArray(data)) {
      for (const market of data) {
        // Filter for binary YES/NO markets only
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
    } else if (data.markets && Array.isArray(data.markets)) {
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

    // Sort by openInterestUsd or volume24hUsd desc, take top 15
    const sorted = markets.sort((a, b) => {
      const aValue = a.openInterestUsd || a.volume24hUsd || 0;
      const bValue = b.openInterestUsd || b.volume24hUsd || 0;
      return bValue - aValue;
    });

    const topMarkets = sorted.slice(0, 15);

    if (topMarkets.length > 0) {
      console.log(`[PredictionData] Fetched ${topMarkets.length} markets from Polymarket`);
      return topMarkets;
    } else {
      console.warn('[PredictionData] Polymarket API returned no valid markets, using static fallback');
      return STATIC_POLYMARKET_MARKETS;
    }
  } catch (error: any) {
    console.warn('[PredictionData] Failed to fetch Polymarket markets:', error.message);
    return STATIC_POLYMARKET_MARKETS;
  }
}

