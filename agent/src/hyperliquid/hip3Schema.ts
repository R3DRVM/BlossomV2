/**
 * HIP-3 Schema Validation
 * Zod schemas for validating HIP-3 market creation parameters
 *
 * HIP-3 requires strict parameter validation to prevent:
 * - Bond slashing due to invalid oracle configuration
 * - Market manipulation through extreme fee settings
 * - System instability from improper margin settings
 */

import { z } from 'zod';

/**
 * Valid oracle types
 */
export const OracleTypeSchema = z.enum(['pyth', 'chainlink', 'custom']);

/**
 * Asset symbol validation
 * Must be uppercase, alphanumeric with dash, max 20 chars
 * Examples: "DOGE-USD", "PEPE-USD", "WIF-USD"
 */
export const AssetSymbolSchema = z
  .string()
  .min(3, 'Asset symbol must be at least 3 characters')
  .max(20, 'Asset symbol must not exceed 20 characters')
  .regex(
    /^[A-Z0-9]+-USD$/,
    'Asset symbol must be uppercase alphanumeric ending with -USD (e.g., DOGE-USD)'
  );

/**
 * Size decimals validation
 * 0-4 range determines tick size precision
 */
export const SzDecimalsSchema = z
  .number()
  .int('Size decimals must be an integer')
  .min(0, 'Size decimals minimum is 0')
  .max(4, 'Size decimals maximum is 4');

/**
 * Leverage validation
 * 1-50x max leverage (Hyperliquid testnet limit)
 */
export const MaxLeverageSchema = z
  .number()
  .int('Max leverage must be an integer')
  .min(1, 'Max leverage minimum is 1x')
  .max(50, 'Max leverage maximum is 50x');

/**
 * Fee validation (in basis points)
 * 0-5000 bps (0% - 50%)
 */
export const FeeBpsSchema = z
  .number()
  .int('Fee must be an integer')
  .min(0, 'Fee minimum is 0 bps')
  .max(5000, 'Fee maximum is 5000 bps (50%)');

/**
 * Margin validation (in basis points)
 * Reasonable ranges to prevent manipulation
 */
export const MarginBpsSchema = z
  .number()
  .int('Margin must be an integer')
  .min(100, 'Margin minimum is 100 bps (1%)')
  .max(10000, 'Margin maximum is 10000 bps (100%)');

/**
 * Liquidation penalty validation
 * 0-1000 bps (0% - 10%)
 */
export const LiquidationPenaltyBpsSchema = z
  .number()
  .int('Liquidation penalty must be an integer')
  .min(0, 'Liquidation penalty minimum is 0 bps')
  .max(1000, 'Liquidation penalty maximum is 1000 bps (10%)');

/**
 * Bond amount validation
 * Minimum 1M HYPE (1_000_000 * 10^18)
 */
export const BondAmountSchema = z
  .bigint()
  .refine(
    (val) => val >= BigInt('1000000000000000000000000'), // 1M HYPE with 18 decimals
    'Bond amount must be at least 1,000,000 HYPE'
  );

/**
 * Pyth price ID validation
 * 32-byte hex string
 */
export const PythPriceIdSchema = z
  .string()
  .regex(
    /^0x[a-fA-F0-9]{64}$/,
    'Pyth price ID must be a 32-byte hex string (0x followed by 64 hex chars)'
  );

/**
 * Chainlink aggregator address validation
 */
export const ChainlinkAggregatorSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Chainlink aggregator must be a valid Ethereum address');

/**
 * Oracle price ID validation based on oracle type
 */
export const OraclePriceIdSchema = z.string().refine(
  (val) => {
    // Pyth format: 0x + 64 hex chars
    const isPyth = /^0x[a-fA-F0-9]{64}$/.test(val);
    // Chainlink format: 0x + 40 hex chars (address)
    const isChainlink = /^0x[a-fA-F0-9]{40}$/.test(val);
    return isPyth || isChainlink;
  },
  'Oracle price ID must be a valid Pyth price ID (64 hex chars) or Chainlink address (40 hex chars)'
);

/**
 * Funding configuration schema
 */
export const FundingConfigSchema = z
  .object({
    intervalSeconds: z
      .number()
      .int()
      .min(60, 'Funding interval minimum is 60 seconds')
      .max(28800, 'Funding interval maximum is 8 hours (28800 seconds)')
      .default(3600),
    maxRateBps: z
      .number()
      .int()
      .min(1, 'Max funding rate minimum is 1 bps')
      .max(500, 'Max funding rate maximum is 500 bps (5%)')
      .default(100),
  })
  .optional();

/**
 * Complete HIP-3 Market Parameters Schema
 */
export const HIP3MarketParamsSchema = z
  .object({
    assetSymbol: AssetSymbolSchema,
    indexToken: z.string().min(1, 'Index token is required'),
    szDecimals: SzDecimalsSchema,
    maxLeverage: MaxLeverageSchema,
    makerFeeBps: FeeBpsSchema,
    takerFeeBps: FeeBpsSchema,
    oracleType: OracleTypeSchema,
    oraclePriceId: OraclePriceIdSchema,
    bondAmount: BondAmountSchema,
    maintenanceMarginBps: MarginBpsSchema,
    initialMarginBps: MarginBpsSchema,
    liquidationPenaltyBps: LiquidationPenaltyBpsSchema,
    fundingConfig: FundingConfigSchema,
  })
  .refine(
    (data) => data.maintenanceMarginBps < data.initialMarginBps,
    {
      message: 'Maintenance margin must be less than initial margin',
      path: ['maintenanceMarginBps'],
    }
  )
  .refine(
    (data) => data.makerFeeBps <= data.takerFeeBps,
    {
      message: 'Maker fee should not exceed taker fee',
      path: ['makerFeeBps'],
    }
  )
  .refine(
    (data) => {
      // Validate oracle price ID format matches oracle type
      if (data.oracleType === 'pyth') {
        return /^0x[a-fA-F0-9]{64}$/.test(data.oraclePriceId);
      }
      if (data.oracleType === 'chainlink') {
        return /^0x[a-fA-F0-9]{40}$/.test(data.oraclePriceId);
      }
      return true; // Custom oracle allows any format
    },
    {
      message: 'Oracle price ID format must match oracle type',
      path: ['oraclePriceId'],
    }
  );

/**
 * Market creation request schema
 */
export const HIP3MarketCreationRequestSchema = z.object({
  builderAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Builder address must be a valid Ethereum address'),
  params: HIP3MarketParamsSchema,
  builderSignature: z
    .string()
    .regex(/^0x[a-fA-F0-9]+$/, 'Builder signature must be a hex string')
    .optional(),
  nonce: z.bigint().min(0n, 'Nonce must be non-negative'),
  deadline: z.bigint().refine(
    (val) => val > BigInt(Math.floor(Date.now() / 1000)),
    'Deadline must be in the future'
  ),
});

/**
 * Validate HIP-3 market parameters
 * Returns parsed params or throws ZodError
 */
export function validateHIP3Params(params: unknown): z.infer<typeof HIP3MarketParamsSchema> {
  return HIP3MarketParamsSchema.parse(params);
}

/**
 * Safe validation that returns result object instead of throwing
 */
export function safeValidateHIP3Params(params: unknown): {
  success: boolean;
  data?: z.infer<typeof HIP3MarketParamsSchema>;
  errors?: z.ZodError['errors'];
} {
  const result = HIP3MarketParamsSchema.safeParse(params);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error.errors };
}

/**
 * Validate market creation request
 */
export function validateMarketCreationRequest(
  request: unknown
): z.infer<typeof HIP3MarketCreationRequestSchema> {
  return HIP3MarketCreationRequestSchema.parse(request);
}

/**
 * Get default HIP-3 parameters for a new market
 * Pre-fills sensible defaults for common cases
 */
export function getDefaultHIP3Params(assetSymbol: string): Partial<z.infer<typeof HIP3MarketParamsSchema>> {
  return {
    assetSymbol: assetSymbol.toUpperCase().endsWith('-USD')
      ? assetSymbol.toUpperCase()
      : `${assetSymbol.toUpperCase()}-USD`,
    indexToken: assetSymbol.toUpperCase().replace('-USD', ''),
    szDecimals: 2, // Standard precision
    maxLeverage: 20, // Conservative default
    makerFeeBps: 2, // 0.02% maker fee
    takerFeeBps: 5, // 0.05% taker fee
    oracleType: 'pyth' as const,
    maintenanceMarginBps: 250, // 2.5% maintenance
    initialMarginBps: 500, // 5% initial (5x leverage min)
    liquidationPenaltyBps: 100, // 1% liquidation penalty
    fundingConfig: {
      intervalSeconds: 3600, // 1 hour
      maxRateBps: 100, // 1% max per interval
    },
  };
}

/**
 * Risk assessment for HIP-3 market parameters
 */
export interface HIP3RiskAssessment {
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  warnings: string[];
  recommendations: string[];
  bondSlashRisk: number; // 0-100 percentage
}

/**
 * Assess risk level of HIP-3 market parameters
 */
export function assessHIP3Risk(
  params: z.infer<typeof HIP3MarketParamsSchema>
): HIP3RiskAssessment {
  const warnings: string[] = [];
  const recommendations: string[] = [];
  let bondSlashRisk = 0;

  // High leverage risk
  if (params.maxLeverage > 30) {
    warnings.push(`High max leverage (${params.maxLeverage}x) increases liquidation cascade risk`);
    bondSlashRisk += 15;
  }

  // Low maintenance margin risk
  if (params.maintenanceMarginBps < 200) {
    warnings.push('Low maintenance margin may cause rapid liquidations');
    recommendations.push('Consider increasing maintenance margin to at least 2%');
    bondSlashRisk += 10;
  }

  // Custom oracle risk
  if (params.oracleType === 'custom') {
    warnings.push('Custom oracles have higher manipulation risk than Pyth/Chainlink');
    recommendations.push('Use Pyth or Chainlink for better security');
    bondSlashRisk += 25;
  }

  // High fee risk (may discourage liquidity)
  if (params.takerFeeBps > 100) {
    warnings.push('High taker fees may reduce trading volume');
    recommendations.push('Consider fees below 0.1% for competitive markets');
  }

  // Low fee risk (may attract manipulation)
  if (params.takerFeeBps < 5) {
    warnings.push('Very low fees may encourage wash trading');
    bondSlashRisk += 5;
  }

  // Margin spread risk
  const marginSpread = params.initialMarginBps - params.maintenanceMarginBps;
  if (marginSpread < 100) {
    warnings.push('Narrow margin spread between initial and maintenance margin');
    recommendations.push('Increase margin spread to at least 1% for safety');
    bondSlashRisk += 10;
  }

  // Determine overall risk level
  let riskLevel: HIP3RiskAssessment['riskLevel'];
  if (bondSlashRisk >= 40) {
    riskLevel = 'critical';
  } else if (bondSlashRisk >= 25) {
    riskLevel = 'high';
  } else if (bondSlashRisk >= 10) {
    riskLevel = 'medium';
  } else {
    riskLevel = 'low';
  }

  return {
    riskLevel,
    warnings,
    recommendations,
    bondSlashRisk: Math.min(100, bondSlashRisk),
  };
}

export type HIP3MarketParams = z.infer<typeof HIP3MarketParamsSchema>;
export type HIP3MarketCreationRequest = z.infer<typeof HIP3MarketCreationRequestSchema>;
