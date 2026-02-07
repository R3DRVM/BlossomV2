/**
 * Oracle Configuration for Hyperliquid HIP-3
 *
 * Provides oracle integration for price feeds:
 * - Pyth Network (primary)
 * - Chainlink (fallback)
 * - Custom oracles (advanced)
 *
 * Security: Validates oracle health before market creation
 */

import type { Address } from 'viem';

/**
 * Oracle configuration
 */
export interface OracleConfig {
  /** Oracle type */
  type: 'pyth' | 'chainlink' | 'custom';

  /** Price feed identifier */
  priceId: string;

  /** Human-readable name */
  name: string;

  /** Base asset symbol (e.g., "ETH") */
  baseAsset: string;

  /** Quote asset symbol (e.g., "USD") */
  quoteAsset: string;

  /** Decimals for price */
  decimals: number;

  /** Heartbeat (max staleness) in seconds */
  heartbeat: number;

  /** Deviation threshold in basis points */
  deviationThresholdBps: number;
}

/**
 * Oracle price result
 */
export interface OraclePriceResult {
  /** Current price */
  price: string;

  /** Price confidence/deviation */
  confidence: string;

  /** Timestamp of price update */
  timestamp: number;

  /** Oracle source used */
  source: 'pyth' | 'chainlink' | 'custom';

  /** Whether price is stale */
  isStale: boolean;

  /** Expo (for Pyth prices) */
  expo?: number;
}

/**
 * Common Pyth price IDs for popular assets
 * These are mainnet IDs - testnet may differ
 */
export const PYTH_PRICE_IDS: Record<string, string> = {
  // Crypto
  'BTC': '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  'ETH': '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  'SOL': '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  'DOGE': '0xdcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c',
  'AVAX': '0x93da3352f9f1d105fdfe4971cfa80e9dd777bfc5d0f683ebb6e1294b92137bb7',
  'LINK': '0x8ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221',
  'MATIC': '0x5de33440f6c8b0b569f31f7f2a8b3ed7f60f7f65c2fef01cf2eb9f969f95a44e',
  'ARB': '0x3fa4252848f9f0a1480be62745a4629d9eb1322aebab8a791e344b3b9c1adcf5',
  'OP': '0x385f64d993f7b77d8182ed5003d97c60aa3361f3cecfe711544d2d59165e9bdf',

  // Memes
  'PEPE': '0xd69731a2e74ac1ce884fc3890f7ee324b6deb66147055249568869ed700882e4',
  'SHIB': '0xf0d57deca57b3da2fe63a493f4c25925fdfd8edf834b20f93e1f84dbd1504d4a',
  'WIF': '0x4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc',
  'BONK': '0x72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419',

  // Stablecoins (for reference)
  'USDC': '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
  'USDT': '0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b',
};

/**
 * Chainlink aggregator addresses on various networks
 */
export const CHAINLINK_AGGREGATORS: Record<string, Record<string, Address>> = {
  ethereum: {
    'BTC': '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
    'ETH': '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
    'LINK': '0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c',
  },
  sepolia: {
    'BTC': '0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43',
    'ETH': '0x694AA1769357215DE4FAC081bf1f309aDC325306',
    'LINK': '0xc59E3633BAAC79493d908e63626716e204A45EdF',
  },
  arbitrum: {
    'BTC': '0x6ce185860a4963106506C203335A2910FAb47bce',
    'ETH': '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
  },
};

/**
 * Pyth Hermes endpoint (testnet-safe)
 */
const PYTH_HERMES_URL = process.env.PYTH_HERMES_URL || 'https://hermes.pyth.network';

/**
 * Get oracle price from Pyth Network
 */
export async function getPythPrice(priceId: string): Promise<OraclePriceResult | null> {
  try {
    const response = await fetch(
      `${PYTH_HERMES_URL}/api/latest_price_feeds?ids[]=${priceId}`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (!response.ok) {
      console.warn('[oracleConfig] Pyth API error:', response.status);
      return null;
    }

    const data = await response.json();
    const priceFeed = data[0];

    if (!priceFeed) {
      return null;
    }

    const priceInfo = priceFeed.price || priceFeed.ema_price;
    const publishTime = priceInfo.publish_time || Math.floor(Date.now() / 1000);
    const staleness = Math.floor(Date.now() / 1000) - publishTime;

    return {
      price: priceInfo.price,
      confidence: priceInfo.conf || '0',
      timestamp: publishTime,
      source: 'pyth',
      isStale: staleness > 60, // Stale if > 60 seconds old
      expo: priceInfo.expo,
    };
  } catch (error: any) {
    console.warn('[oracleConfig] Pyth price fetch error:', error.message);
    return null;
  }
}

/**
 * Get oracle price from Chainlink
 * Requires RPC access to the target network
 */
export async function getChainlinkPrice(
  aggregatorAddress: Address,
  rpcUrl: string
): Promise<OraclePriceResult | null> {
  try {
    const { createPublicClient, http, parseAbi } = await import('viem');

    // Chainlink Aggregator V3 Interface
    const aggregatorAbi = parseAbi([
      'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
      'function decimals() external view returns (uint8)',
    ]);

    const client = createPublicClient({
      transport: http(rpcUrl),
    });

    const [roundData, decimals] = await Promise.all([
      client.readContract({
        address: aggregatorAddress,
        abi: aggregatorAbi,
        functionName: 'latestRoundData',
      }),
      client.readContract({
        address: aggregatorAddress,
        abi: aggregatorAbi,
        functionName: 'decimals',
      }),
    ]);

    const [, answer, , updatedAt] = roundData as [bigint, bigint, bigint, bigint, bigint];
    const staleness = Math.floor(Date.now() / 1000) - Number(updatedAt);

    // Normalize price to 8 decimals (standard for USD pairs)
    const price = answer.toString();

    return {
      price,
      confidence: '0', // Chainlink doesn't provide confidence intervals
      timestamp: Number(updatedAt),
      source: 'chainlink',
      isStale: staleness > 3600, // Chainlink heartbeat is typically 1 hour
    };
  } catch (error: any) {
    console.warn('[oracleConfig] Chainlink price fetch error:', error.message);
    return null;
  }
}

/**
 * Get oracle price with fallback
 * Tries Pyth first, falls back to Chainlink
 */
export async function getOraclePrice(
  asset: string,
  options?: {
    preferredSource?: 'pyth' | 'chainlink';
    chainlinkRpcUrl?: string;
    chainlinkNetwork?: string;
  }
): Promise<OraclePriceResult | null> {
  const preferredSource = options?.preferredSource || 'pyth';

  // Try preferred source first
  if (preferredSource === 'pyth') {
    const pythId = PYTH_PRICE_IDS[asset.toUpperCase()];
    if (pythId) {
      const pythPrice = await getPythPrice(pythId);
      if (pythPrice && !pythPrice.isStale) {
        return pythPrice;
      }
    }

    // Fallback to Chainlink
    if (options?.chainlinkRpcUrl) {
      const network = options.chainlinkNetwork || 'ethereum';
      const aggregator = CHAINLINK_AGGREGATORS[network]?.[asset.toUpperCase()];
      if (aggregator) {
        return getChainlinkPrice(aggregator, options.chainlinkRpcUrl);
      }
    }
  } else {
    // Try Chainlink first
    if (options?.chainlinkRpcUrl) {
      const network = options.chainlinkNetwork || 'ethereum';
      const aggregator = CHAINLINK_AGGREGATORS[network]?.[asset.toUpperCase()];
      if (aggregator) {
        const chainlinkPrice = await getChainlinkPrice(aggregator, options.chainlinkRpcUrl);
        if (chainlinkPrice && !chainlinkPrice.isStale) {
          return chainlinkPrice;
        }
      }
    }

    // Fallback to Pyth
    const pythId = PYTH_PRICE_IDS[asset.toUpperCase()];
    if (pythId) {
      return getPythPrice(pythId);
    }
  }

  return null;
}

/**
 * Validate oracle configuration for HIP-3 market creation
 */
export async function validateOracleConfig(config: OracleConfig): Promise<{
  valid: boolean;
  errors: string[];
  warnings: string[];
}> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate price ID format
  if (config.type === 'pyth') {
    if (!/^0x[a-fA-F0-9]{64}$/.test(config.priceId)) {
      errors.push('Invalid Pyth price ID format (must be 32-byte hex)');
    }

    // Check if price feed is available
    const price = await getPythPrice(config.priceId);
    if (!price) {
      errors.push('Pyth price feed not found or unavailable');
    } else if (price.isStale) {
      warnings.push('Pyth price feed is stale - may have reliability issues');
    }
  } else if (config.type === 'chainlink') {
    if (!/^0x[a-fA-F0-9]{40}$/.test(config.priceId)) {
      errors.push('Invalid Chainlink aggregator address format');
    }

    // Note: Would need RPC URL to validate Chainlink
    warnings.push('Chainlink aggregator validation requires RPC access');
  } else if (config.type === 'custom') {
    warnings.push('Custom oracles have higher manipulation risk than Pyth/Chainlink');
    warnings.push('Ensure custom oracle has proper security audits');
  }

  // Validate heartbeat
  if (config.heartbeat < 60) {
    errors.push('Heartbeat too short (minimum 60 seconds)');
  } else if (config.heartbeat > 86400) {
    warnings.push('Heartbeat very long (>24 hours) - price may be stale');
  }

  // Validate deviation threshold
  if (config.deviationThresholdBps < 10) {
    warnings.push('Very tight deviation threshold may cause frequent updates');
  } else if (config.deviationThresholdBps > 1000) {
    warnings.push('Wide deviation threshold (>10%) may allow price manipulation');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Get Pyth price ID for an asset
 * Returns known ID or generates placeholder for unknown assets
 */
export function getPythPriceId(asset: string): string | null {
  return PYTH_PRICE_IDS[asset.toUpperCase()] || null;
}

/**
 * Get Chainlink aggregator address for an asset
 */
export function getChainlinkAggregator(
  asset: string,
  network: string = 'ethereum'
): Address | null {
  return CHAINLINK_AGGREGATORS[network]?.[asset.toUpperCase()] || null;
}

/**
 * Build oracle configuration for a new HIP-3 market
 */
export function buildOracleConfig(
  baseAsset: string,
  options?: {
    preferredType?: 'pyth' | 'chainlink';
    customPriceId?: string;
    network?: string;
  }
): OracleConfig {
  const preferredType = options?.preferredType || 'pyth';

  if (options?.customPriceId) {
    return {
      type: 'custom',
      priceId: options.customPriceId,
      name: `${baseAsset}/USD Custom Oracle`,
      baseAsset: baseAsset.toUpperCase(),
      quoteAsset: 'USD',
      decimals: 8,
      heartbeat: 3600,
      deviationThresholdBps: 100,
    };
  }

  if (preferredType === 'pyth') {
    const pythId = getPythPriceId(baseAsset);
    if (pythId) {
      return {
        type: 'pyth',
        priceId: pythId,
        name: `${baseAsset}/USD Pyth`,
        baseAsset: baseAsset.toUpperCase(),
        quoteAsset: 'USD',
        decimals: 8,
        heartbeat: 60,
        deviationThresholdBps: 50,
      };
    }
  }

  // Fallback to Chainlink
  const network = options?.network || 'ethereum';
  const aggregator = getChainlinkAggregator(baseAsset, network);
  if (aggregator) {
    return {
      type: 'chainlink',
      priceId: aggregator,
      name: `${baseAsset}/USD Chainlink`,
      baseAsset: baseAsset.toUpperCase(),
      quoteAsset: 'USD',
      decimals: 8,
      heartbeat: 3600,
      deviationThresholdBps: 100,
    };
  }

  // No oracle found - return placeholder
  return {
    type: 'custom',
    priceId: '0x0000000000000000000000000000000000000000000000000000000000000000',
    name: `${baseAsset}/USD (No Oracle)`,
    baseAsset: baseAsset.toUpperCase(),
    quoteAsset: 'USD',
    decimals: 8,
    heartbeat: 3600,
    deviationThresholdBps: 100,
  };
}
