/**
 * Pyth price helpers (Hermes API)
 * Devnet-safe (read-only) price fetch for SOL/USDC/ETH when feed IDs are provided.
 */

const PYTH_HERMES_URL = process.env.PYTH_HERMES_URL || 'https://hermes.pyth.network';

export async function getPythPriceUsd(feedId: string): Promise<number> {
  const url = `${PYTH_HERMES_URL}/api/latest_price_feeds?ids[]=${encodeURIComponent(feedId)}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Pyth Hermes error: ${res.status}`);
  }
  const data = await res.json();
  const entry = Array.isArray(data) ? data[0] : data?.price_feed ?? null;
  const price = entry?.price?.price;
  const expo = entry?.price?.expo;
  if (typeof price !== 'number' || typeof expo !== 'number') {
    throw new Error('Invalid Pyth price payload');
  }
  return price * Math.pow(10, expo);
}

export async function getPythPriceForSymbol(symbol: 'SOL' | 'ETH' | 'USDC'): Promise<number | null> {
  const feedId =
    symbol === 'SOL' ? process.env.PYTH_SOL_USD_FEED_ID :
    symbol === 'ETH' ? process.env.PYTH_ETH_USD_FEED_ID :
    process.env.PYTH_USDC_USD_FEED_ID;

  if (!feedId) return null;

  try {
    return await getPythPriceUsd(feedId);
  } catch (error) {
    console.warn(`[pyth] failed to fetch ${symbol} price`, (error as Error).message);
    return null;
  }
}
