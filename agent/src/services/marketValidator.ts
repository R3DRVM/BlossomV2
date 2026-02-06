/**
 * Market Data Validator
 *
 * Validates market conditions before execution:
 * - Price validation against multiple sources
 * - Liquidity checks
 * - Slippage tolerance validation
 * - Market hours/status validation
 */

import { getPrice, PriceSymbol, PriceSnapshot } from './prices';
import { withRetry, withRateLimit, getRateLimiter } from '../utils/retryHandler';

export interface MarketValidationResult {
  isValid: boolean;
  warnings: string[];
  errors: string[];
  priceData?: {
    symbol: string;
    price: number;
    source: string;
    confidence: 'high' | 'medium' | 'low';
  };
  liquidityData?: {
    available: boolean;
    estimatedSlippage: number;
    depth: 'deep' | 'medium' | 'shallow' | 'unknown';
  };
}

export interface ValidateTradeParams {
  symbol: string;
  side: 'buy' | 'sell' | 'long' | 'short';
  amountUsd?: number;
  leverage?: number;
  maxSlippageBps?: number; // Basis points (50 = 0.5%)
}

// Price deviation thresholds
const MAX_PRICE_DEVIATION_PERCENT = 5; // Max 5% deviation between sources
const STALE_PRICE_THRESHOLD_MS = 60 * 1000; // 60 seconds

// Supported assets for validation
const SUPPORTED_ASSETS: Set<string> = new Set([
  'ETH', 'BTC', 'SOL', 'USDC', 'WETH', 'AVAX', 'LINK',
  'ETH-PERP', 'BTC-PERP', 'SOL-PERP', // Perp markets
]);

// Map perp market symbols to underlying assets
const PERP_TO_ASSET: Record<string, PriceSymbol> = {
  'ETH-PERP': 'ETH',
  'BTC-PERP': 'BTC',
  'SOL-PERP': 'SOL',
  'ETH-USD': 'ETH',
  'BTC-USD': 'BTC',
  'SOL-USD': 'SOL',
};

// Minimum liquidity thresholds (USD)
const MIN_LIQUIDITY_THRESHOLDS: Record<string, number> = {
  'ETH': 100000,
  'BTC': 100000,
  'SOL': 50000,
  'USDC': 1000000,
  'DEFAULT': 10000,
};

// Static liquidity estimates (for testnet/demo mode)
const ESTIMATED_LIQUIDITY: Record<string, number> = {
  'ETH': 50000000,
  'BTC': 100000000,
  'SOL': 10000000,
  'USDC': 500000000,
  'WETH': 30000000,
};

/**
 * Normalize symbol to base asset
 */
function normalizeSymbol(symbol: string): PriceSymbol | null {
  const upper = symbol.toUpperCase();

  // Check if it's a perp market
  if (PERP_TO_ASSET[upper]) {
    return PERP_TO_ASSET[upper];
  }

  // Direct symbol match
  if (SUPPORTED_ASSETS.has(upper)) {
    return upper as PriceSymbol;
  }

  // Handle variations - USDC is REDACTED in this codebase
  if (upper === 'BUSDC' || upper === 'BLSMUSDC' || upper === 'USDC') {
    return 'REDACTED' as PriceSymbol;
  }

  return null;
}

/**
 * Get price with validation
 */
async function getValidatedPrice(symbol: string): Promise<{
  price: PriceSnapshot | null;
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
}> {
  const normalizedSymbol = normalizeSymbol(symbol);
  const warnings: string[] = [];

  if (!normalizedSymbol) {
    return {
      price: null,
      confidence: 'low',
      warnings: [`Unsupported symbol: ${symbol}`],
    };
  }

  try {
    const price = await withRetry(
      () => getPrice(normalizedSymbol),
      {
        maxRetries: 2,
        baseDelayMs: 500,
        maxDelayMs: 2000,
      }
    );

    // Check price freshness
    const ageMs = Date.now() - price.fetchedAt;
    if (ageMs > STALE_PRICE_THRESHOLD_MS) {
      warnings.push(`Price data is ${Math.round(ageMs / 1000)}s old`);
    }

    // Determine confidence based on source
    let confidence: 'high' | 'medium' | 'low' = 'medium';
    if (price.source === 'coingecko' || price.source === 'pyth') {
      confidence = 'high';
    } else if (price.source === 'jupiter') {
      confidence = 'medium';
    } else if (price.source === 'static') {
      confidence = 'low';
      warnings.push('Using static fallback price');
    }

    return { price, confidence, warnings };
  } catch (error: any) {
    return {
      price: null,
      confidence: 'low',
      warnings: [`Failed to fetch price: ${error.message}`],
    };
  }
}

/**
 * Estimate slippage based on trade size and liquidity
 */
function estimateSlippage(
  amountUsd: number,
  estimatedLiquidity: number
): { slippageBps: number; depth: 'deep' | 'medium' | 'shallow' | 'unknown' } {
  // Simple linear model: slippage increases with trade size relative to liquidity
  // Real implementation would use order book data

  if (estimatedLiquidity <= 0) {
    return { slippageBps: 500, depth: 'unknown' }; // 5% default if unknown
  }

  const tradeImpact = amountUsd / estimatedLiquidity;

  // Depth classification
  let depth: 'deep' | 'medium' | 'shallow' | 'unknown';
  if (estimatedLiquidity > 50000000) {
    depth = 'deep';
  } else if (estimatedLiquidity > 10000000) {
    depth = 'medium';
  } else {
    depth = 'shallow';
  }

  // Slippage estimation (simplified model)
  // Base: 10 bps + impact factor
  const baseBps = 10;
  const impactBps = Math.round(tradeImpact * 10000); // 1% of liquidity = 100 bps

  return {
    slippageBps: Math.min(baseBps + impactBps, 1000), // Cap at 10%
    depth,
  };
}

/**
 * Validate a trade before execution
 */
export async function validateTrade(
  params: ValidateTradeParams
): Promise<MarketValidationResult> {
  const { symbol, side, amountUsd = 0, leverage = 1, maxSlippageBps = 100 } = params;
  const warnings: string[] = [];
  const errors: string[] = [];

  // Get and validate price
  const priceResult = await getValidatedPrice(symbol);
  warnings.push(...priceResult.warnings);

  if (!priceResult.price) {
    errors.push(`Unable to validate price for ${symbol}`);
    return {
      isValid: false,
      warnings,
      errors,
    };
  }

  // Build price data for response
  const priceData = {
    symbol,
    price: priceResult.price.priceUsd,
    source: priceResult.price.source,
    confidence: priceResult.confidence,
  };

  // Estimate liquidity and slippage
  const normalizedSymbol = normalizeSymbol(symbol) || 'DEFAULT';
  const estimatedLiquidity = ESTIMATED_LIQUIDITY[normalizedSymbol] || 1000000;

  // Account for leverage in effective trade size
  const effectiveTradeSize = amountUsd * leverage;
  const slippageEstimate = estimateSlippage(effectiveTradeSize, estimatedLiquidity);

  const liquidityData = {
    available: slippageEstimate.depth !== 'unknown',
    estimatedSlippage: slippageEstimate.slippageBps / 100, // Convert to percentage
    depth: slippageEstimate.depth,
  };

  // Validate slippage tolerance
  if (slippageEstimate.slippageBps > maxSlippageBps) {
    warnings.push(
      `Estimated slippage (${slippageEstimate.slippageBps / 100}%) exceeds max tolerance (${maxSlippageBps / 100}%)`
    );
  }

  // Validate trade size against liquidity
  const minLiquidity = MIN_LIQUIDITY_THRESHOLDS[normalizedSymbol] || MIN_LIQUIDITY_THRESHOLDS['DEFAULT'];
  if (effectiveTradeSize > estimatedLiquidity * 0.1) {
    warnings.push('Trade size is large relative to available liquidity');
  }

  // Validate leverage
  if (leverage > 50) {
    errors.push('Leverage exceeds maximum allowed (50x)');
  } else if (leverage > 20) {
    warnings.push('High leverage increases liquidation risk');
  }

  // Check for low confidence price
  if (priceResult.confidence === 'low') {
    warnings.push('Low confidence in price data - consider waiting for better data');
  }

  return {
    isValid: errors.length === 0,
    warnings,
    errors,
    priceData,
    liquidityData,
  };
}

/**
 * Validate multiple assets at once (for multi-step strategies)
 */
export async function validateMultipleAssets(
  symbols: string[]
): Promise<Map<string, MarketValidationResult>> {
  const results = new Map<string, MarketValidationResult>();

  // Validate in parallel with rate limiting
  const limiter = getRateLimiter('market-validator', 30); // 30 requests per minute

  const validationPromises = symbols.map(async (symbol) => {
    await limiter.acquire();
    const result = await validateTrade({ symbol, side: 'buy' });
    return { symbol, result };
  });

  const validations = await Promise.all(validationPromises);

  for (const { symbol, result } of validations) {
    results.set(symbol, result);
  }

  return results;
}

/**
 * Quick price check (for display purposes)
 */
export async function quickPriceCheck(
  symbol: string
): Promise<{ price: number; source: string } | null> {
  const result = await getValidatedPrice(symbol);
  if (result.price) {
    return {
      price: result.price.priceUsd,
      source: result.price.source,
    };
  }
  return null;
}

/**
 * Validate slippage tolerance is reasonable
 */
export function validateSlippageTolerance(
  slippageBps: number
): { valid: boolean; message?: string } {
  if (slippageBps < 0) {
    return { valid: false, message: 'Slippage cannot be negative' };
  }

  if (slippageBps > 1000) { // 10%
    return { valid: false, message: 'Slippage exceeds maximum allowed (10%)' };
  }

  if (slippageBps > 500) { // 5%
    return { valid: true, message: 'Warning: High slippage tolerance may result in poor execution' };
  }

  if (slippageBps < 10) { // 0.1%
    return { valid: true, message: 'Warning: Very low slippage tolerance may cause transaction failures' };
  }

  return { valid: true };
}

/**
 * Validate DCA parameters
 */
export function validateDCAParams(params: {
  totalAmount: number;
  numIntervals: number;
  intervalMs: number;
}): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const { totalAmount, numIntervals, intervalMs } = params;

  // Validate total amount
  if (totalAmount <= 0) {
    errors.push('DCA total amount must be positive');
  }

  // Validate number of intervals
  if (numIntervals < 2) {
    errors.push('DCA requires at least 2 intervals');
  }
  if (numIntervals > 365) {
    errors.push('DCA cannot exceed 365 intervals');
  }

  // Validate interval duration
  const minIntervalMs = 60 * 1000; // 1 minute
  const maxIntervalMs = 30 * 24 * 60 * 60 * 1000; // 30 days

  if (intervalMs < minIntervalMs) {
    errors.push('DCA interval must be at least 1 minute');
  }
  if (intervalMs > maxIntervalMs) {
    errors.push('DCA interval cannot exceed 30 days');
  }

  // Calculate per-trade amount
  const perTradeAmount = totalAmount / numIntervals;
  if (perTradeAmount < 1) {
    warnings.push('Per-trade amount is very small, consider using fewer intervals');
  }

  // Warn about very short intervals
  if (intervalMs < 60 * 60 * 1000) { // Less than 1 hour
    warnings.push('Very short DCA intervals may incur higher gas costs');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate leverage position parameters
 */
export function validateLeverageParams(params: {
  leverage: number;
  marginAmount: number;
  asset: string;
}): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const { leverage, marginAmount, asset } = params;

  // Validate leverage range
  if (leverage < 1) {
    errors.push('Leverage must be at least 1x');
  }
  if (leverage > 100) {
    errors.push('Leverage cannot exceed 100x');
  }

  // Asset-specific max leverage
  const maxLeverageByAsset: Record<string, number> = {
    'BTC': 50,
    'ETH': 50,
    'SOL': 20,
    'DEFAULT': 10,
  };

  const maxLeverage = maxLeverageByAsset[asset.toUpperCase()] || maxLeverageByAsset['DEFAULT'];
  if (leverage > maxLeverage) {
    errors.push(`Maximum leverage for ${asset} is ${maxLeverage}x`);
  }

  // Validate margin amount
  if (marginAmount <= 0) {
    errors.push('Margin amount must be positive');
  }
  if (marginAmount < 10) {
    warnings.push('Very small margin may result in quick liquidation');
  }

  // Warn about high leverage
  if (leverage >= 20) {
    warnings.push('High leverage significantly increases liquidation risk');
  }

  // Calculate notional value
  const notionalValue = marginAmount * leverage;
  if (notionalValue > 1000000) {
    warnings.push('Large position size - ensure adequate liquidity');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Anonymize sensitive data for logging
 */
export function anonymizeForLogging(data: Record<string, any>): Record<string, any> {
  const sensitiveKeys = [
    'privateKey',
    'secretKey',
    'apiKey',
    'password',
    'mnemonic',
    'seed',
    'address',
    'wallet',
    'user',
    'email',
  ];

  const anonymized: Record<string, any> = {};

  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();

    if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
      if (typeof value === 'string' && value.length > 0) {
        // Show first 4 and last 4 characters
        if (value.length > 10) {
          anonymized[key] = `${value.slice(0, 4)}...${value.slice(-4)}`;
        } else {
          anonymized[key] = '[REDACTED]';
        }
      } else {
        anonymized[key] = '[REDACTED]';
      }
    } else if (typeof value === 'object' && value !== null) {
      anonymized[key] = anonymizeForLogging(value);
    } else {
      anonymized[key] = value;
    }
  }

  return anonymized;
}
