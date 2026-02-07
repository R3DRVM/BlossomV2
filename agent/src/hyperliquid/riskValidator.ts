/**
 * Risk Validator for Hyperliquid HIP-3
 *
 * Pre-creation validation for HIP-3 market parameters including:
 * - Bond slashing risk assessment
 * - Leverage bounds validation
 * - Oracle reliability checks
 * - Market manipulation detection
 *
 * Security: Prevents creation of markets with high slash risk
 */

import type { HIP3MarketParams } from './types';
import { validateOracleConfig, buildOracleConfig, getOraclePrice } from './oracleConfig';
import { assessHIP3Risk } from './hip3Schema';

/**
 * Risk validation result
 */
export interface RiskValidationResult {
  /** Whether validation passed */
  valid: boolean;

  /** Risk score (0-100, higher = riskier) */
  riskScore: number;

  /** Risk level classification */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';

  /** Validation errors (must be fixed) */
  errors: string[];

  /** Warnings (should be reviewed) */
  warnings: string[];

  /** Recommendations for improvement */
  recommendations: string[];

  /** Specific risk assessments */
  risks: {
    bondSlashRisk: number;
    oracleRisk: number;
    leverageRisk: number;
    liquidityRisk: number;
    manipulationRisk: number;
  };

  /** Whether execution should be blocked */
  blocked: boolean;

  /** Reason for blocking (if blocked) */
  blockReason?: string;
}

/**
 * Slash risk assessment result
 */
export interface SlashRiskAssessment {
  /** Overall slash risk percentage (0-100) */
  riskPercentage: number;

  /** Risk factors contributing to slash risk */
  factors: Array<{
    name: string;
    severity: 'low' | 'medium' | 'high';
    contribution: number;
    description: string;
  }>;

  /** Mitigation recommendations */
  mitigations: string[];
}

/**
 * Validate market creation parameters
 */
export async function validateMarketCreation(
  params: HIP3MarketParams
): Promise<RiskValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];

  // Initialize risk scores
  const risks = {
    bondSlashRisk: 0,
    oracleRisk: 0,
    leverageRisk: 0,
    liquidityRisk: 0,
    manipulationRisk: 0,
  };

  // 1. Validate basic parameters
  if (params.maxLeverage > 50) {
    errors.push(`Max leverage ${params.maxLeverage}x exceeds Hyperliquid limit of 50x`);
  }

  if (params.maxLeverage > 25) {
    risks.leverageRisk += 20;
    warnings.push(`High max leverage (${params.maxLeverage}x) increases liquidation cascade risk`);
  }

  // 2. Validate margins
  if (params.maintenanceMarginBps >= params.initialMarginBps) {
    errors.push('Maintenance margin must be less than initial margin');
  }

  const marginSpread = params.initialMarginBps - params.maintenanceMarginBps;
  if (marginSpread < 100) {
    risks.liquidityRisk += 15;
    warnings.push('Narrow margin spread may cause rapid liquidations');
    recommendations.push('Increase margin spread to at least 1%');
  }

  // 3. Validate fees
  if (params.takerFeeBps > 500) {
    warnings.push('High taker fees may discourage trading');
    recommendations.push('Consider fees below 0.5% for competitive markets');
  }

  if (params.takerFeeBps < 5) {
    risks.manipulationRisk += 10;
    warnings.push('Very low fees may encourage wash trading');
  }

  if (params.makerFeeBps > params.takerFeeBps) {
    warnings.push('Maker fee higher than taker fee is unusual and may discourage liquidity provision');
  }

  // 4. Validate oracle
  const oracleConfig = buildOracleConfig(params.indexToken, {
    preferredType: params.oracleType === 'pyth' ? 'pyth' : params.oracleType === 'chainlink' ? 'chainlink' : undefined,
    customPriceId: params.oracleType === 'custom' ? params.oraclePriceId : undefined,
  });

  const oracleValidation = await validateOracleConfig(oracleConfig);

  if (!oracleValidation.valid) {
    errors.push(...oracleValidation.errors);
  }
  warnings.push(...oracleValidation.warnings);

  if (params.oracleType === 'custom') {
    risks.oracleRisk += 30;
    risks.bondSlashRisk += 20;
    recommendations.push('Use Pyth or Chainlink for better oracle security');
  } else if (params.oracleType === 'chainlink') {
    risks.oracleRisk += 5;
  }
  // Pyth has lowest oracle risk

  // 5. Check oracle price availability
  try {
    const price = await getOraclePrice(params.indexToken);
    if (!price) {
      errors.push(`No price feed available for ${params.indexToken}`);
      risks.oracleRisk += 50;
    } else if (price.isStale) {
      warnings.push(`Price feed for ${params.indexToken} appears stale`);
      risks.oracleRisk += 20;
    }
  } catch (error) {
    warnings.push(`Could not verify price feed availability: ${error}`);
    risks.oracleRisk += 10;
  }

  // 6. Validate bond amount
  const minBond = BigInt('1000000000000000000000000'); // 1M HYPE
  if (params.bondAmount < minBond) {
    errors.push('Bond amount must be at least 1,000,000 HYPE');
  }

  // Higher bond = lower slash risk (more to lose)
  const bondInHype = Number(params.bondAmount / BigInt(1e18));
  if (bondInHype > 5000000) {
    risks.bondSlashRisk -= 10; // Bonus for large bond
  } else if (bondInHype < 2000000) {
    risks.bondSlashRisk += 5;
    warnings.push('Consider higher bond amount for better market stability');
  }

  // 7. Assess HIP-3 specific risks
  const hip3Risk = assessHIP3Risk(params);
  risks.bondSlashRisk += hip3Risk.bondSlashRisk;
  warnings.push(...hip3Risk.warnings.filter(w => !warnings.includes(w)));
  recommendations.push(...hip3Risk.recommendations.filter(r => !recommendations.includes(r)));

  // 8. Calculate overall risk score
  const riskScore = Math.min(100, Math.max(0,
    risks.bondSlashRisk * 0.3 +
    risks.oracleRisk * 0.25 +
    risks.leverageRisk * 0.2 +
    risks.liquidityRisk * 0.15 +
    risks.manipulationRisk * 0.1
  ));

  // Determine risk level
  let riskLevel: RiskValidationResult['riskLevel'];
  if (riskScore >= 70) {
    riskLevel = 'critical';
  } else if (riskScore >= 50) {
    riskLevel = 'high';
  } else if (riskScore >= 25) {
    riskLevel = 'medium';
  } else {
    riskLevel = 'low';
  }

  // Determine if execution should be blocked
  const blocked = errors.length > 0 || riskLevel === 'critical';
  const blockReason = blocked
    ? errors.length > 0
      ? `Validation errors: ${errors.join('; ')}`
      : 'Risk level too high for safe market creation'
    : undefined;

  return {
    valid: errors.length === 0,
    riskScore,
    riskLevel,
    errors,
    warnings,
    recommendations,
    risks,
    blocked,
    blockReason,
  };
}

/**
 * Check bond slash risk for a market
 */
export async function checkBondSlashRisk(
  params: HIP3MarketParams
): Promise<SlashRiskAssessment> {
  const factors: SlashRiskAssessment['factors'] = [];
  const mitigations: string[] = [];
  let totalRisk = 0;

  // Factor 1: Oracle type
  if (params.oracleType === 'custom') {
    factors.push({
      name: 'Custom Oracle',
      severity: 'high',
      contribution: 25,
      description: 'Custom oracles have higher manipulation risk',
    });
    totalRisk += 25;
    mitigations.push('Switch to Pyth or Chainlink for better security');
  } else if (params.oracleType === 'chainlink') {
    factors.push({
      name: 'Chainlink Oracle',
      severity: 'low',
      contribution: 5,
      description: 'Chainlink has good security but slower updates',
    });
    totalRisk += 5;
  }

  // Factor 2: High leverage
  if (params.maxLeverage > 30) {
    factors.push({
      name: 'High Leverage',
      severity: 'medium',
      contribution: 15,
      description: `${params.maxLeverage}x leverage increases cascade liquidation risk`,
    });
    totalRisk += 15;
    mitigations.push('Consider reducing max leverage to 25x or below');
  }

  // Factor 3: Low maintenance margin
  if (params.maintenanceMarginBps < 200) {
    factors.push({
      name: 'Low Maintenance Margin',
      severity: 'medium',
      contribution: 10,
      description: 'Low maintenance margin may cause rapid liquidations',
    });
    totalRisk += 10;
    mitigations.push('Increase maintenance margin to at least 2%');
  }

  // Factor 4: Narrow margin spread
  const marginSpread = params.initialMarginBps - params.maintenanceMarginBps;
  if (marginSpread < 150) {
    factors.push({
      name: 'Narrow Margin Spread',
      severity: 'medium',
      contribution: 10,
      description: 'Narrow spread between initial and maintenance margin',
    });
    totalRisk += 10;
    mitigations.push('Increase spread between initial and maintenance margin');
  }

  // Factor 5: Very low fees
  if (params.takerFeeBps < 5) {
    factors.push({
      name: 'Very Low Fees',
      severity: 'low',
      contribution: 5,
      description: 'Very low fees may encourage wash trading',
    });
    totalRisk += 5;
    mitigations.push('Consider minimum 0.05% taker fee');
  }

  // Factor 6: Asset volatility (would need price history)
  // For now, add warning for meme coins based on symbol
  const memePatterns = /PEPE|SHIB|DOGE|WIF|BONK|FLOKI/i;
  if (memePatterns.test(params.assetSymbol)) {
    factors.push({
      name: 'High Volatility Asset',
      severity: 'medium',
      contribution: 15,
      description: 'Meme coins have higher volatility and manipulation risk',
    });
    totalRisk += 15;
    mitigations.push('Consider wider margin requirements for volatile assets');
  }

  return {
    riskPercentage: Math.min(100, totalRisk),
    factors,
    mitigations,
  };
}

/**
 * Validate leverage bounds for a position
 */
export function validateLeverageBounds(
  requestedLeverage: number,
  maxLeverage: number,
  positionSizeUsd: number,
  options?: {
    minLeverage?: number;
    sizeThresholds?: Array<{ maxSizeUsd: number; maxLeverage: number }>;
  }
): {
  valid: boolean;
  adjustedLeverage?: number;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const minLeverage = options?.minLeverage ?? 1;

  // Basic range check
  if (requestedLeverage < minLeverage) {
    errors.push(`Leverage ${requestedLeverage}x below minimum ${minLeverage}x`);
    return { valid: false, errors, warnings };
  }

  if (requestedLeverage > maxLeverage) {
    errors.push(`Leverage ${requestedLeverage}x exceeds maximum ${maxLeverage}x`);
    return { valid: false, errors, warnings };
  }

  // Size-based leverage limits
  if (options?.sizeThresholds) {
    for (const threshold of options.sizeThresholds.sort((a, b) => a.maxSizeUsd - b.maxSizeUsd)) {
      if (positionSizeUsd <= threshold.maxSizeUsd) {
        if (requestedLeverage > threshold.maxLeverage) {
          warnings.push(
            `Position size $${positionSizeUsd} limits leverage to ${threshold.maxLeverage}x`
          );
          return {
            valid: true,
            adjustedLeverage: threshold.maxLeverage,
            errors,
            warnings,
          };
        }
        break;
      }
    }
  }

  // Warn for high leverage
  if (requestedLeverage > 20) {
    warnings.push(`High leverage (${requestedLeverage}x) increases liquidation risk`);
  }

  return { valid: true, errors, warnings };
}

/**
 * Estimate volatility-based margin requirement
 */
export function estimateVolatilityMargin(
  asset: string,
  baseLeverage: number,
  historicalVolatility?: number
): {
  recommendedInitialMarginBps: number;
  recommendedMaintenanceMarginBps: number;
  adjustedMaxLeverage: number;
} {
  // Default volatility estimates by asset type
  const volatilityEstimates: Record<string, number> = {
    BTC: 0.03,   // ~3% daily
    ETH: 0.04,   // ~4% daily
    SOL: 0.06,   // ~6% daily
    DOGE: 0.10,  // ~10% daily
    PEPE: 0.20,  // ~20% daily (meme)
    WIF: 0.25,   // ~25% daily (meme)
    DEFAULT: 0.05,
  };

  const vol = historicalVolatility ?? volatilityEstimates[asset.toUpperCase()] ?? volatilityEstimates.DEFAULT;

  // Higher volatility = higher margin requirement
  // Base: 5% initial margin (20x leverage)
  // Adjust by volatility factor
  const volFactor = vol / 0.05; // Normalize to 5% base vol
  const adjustedInitialBps = Math.ceil(500 * volFactor); // 5% base
  const adjustedMaintenanceBps = Math.ceil(250 * volFactor); // 2.5% base

  // Cap leverage based on volatility
  const maxSafeLeverage = Math.floor(10000 / adjustedMaintenanceBps);
  const adjustedMaxLeverage = Math.min(baseLeverage, maxSafeLeverage, 50);

  return {
    recommendedInitialMarginBps: Math.min(adjustedInitialBps, 5000), // Max 50%
    recommendedMaintenanceMarginBps: Math.min(adjustedMaintenanceBps, 2500), // Max 25%
    adjustedMaxLeverage,
  };
}

/**
 * Pre-flight check for market creation
 * Run before submitting HIP-3 transaction
 */
export async function preflightMarketCreation(
  params: HIP3MarketParams,
  builderBalance: bigint
): Promise<{
  canProceed: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    message: string;
  }>;
}> {
  const checks: Array<{ name: string; passed: boolean; message: string }> = [];

  // Check 1: Bond balance
  const hasSufficientBond = builderBalance >= params.bondAmount;
  checks.push({
    name: 'Bond Balance',
    passed: hasSufficientBond,
    message: hasSufficientBond
      ? `Sufficient HYPE balance (${builderBalance.toString()})`
      : `Insufficient HYPE: need ${params.bondAmount.toString()}, have ${builderBalance.toString()}`,
  });

  // Check 2: Oracle availability
  try {
    const price = await getOraclePrice(params.indexToken);
    const hasOracle = !!price && !price.isStale;
    checks.push({
      name: 'Oracle Availability',
      passed: hasOracle,
      message: hasOracle
        ? `Price feed available: ${price?.price}`
        : 'Price feed unavailable or stale',
    });
  } catch {
    checks.push({
      name: 'Oracle Availability',
      passed: false,
      message: 'Could not verify oracle availability',
    });
  }

  // Check 3: Parameter validation
  const validation = await validateMarketCreation(params);
  checks.push({
    name: 'Parameter Validation',
    passed: validation.valid,
    message: validation.valid
      ? 'All parameters valid'
      : `Validation errors: ${validation.errors.join(', ')}`,
  });

  // Check 4: Risk assessment
  const riskOk = validation.riskLevel !== 'critical';
  checks.push({
    name: 'Risk Assessment',
    passed: riskOk,
    message: riskOk
      ? `Risk level: ${validation.riskLevel} (score: ${validation.riskScore})`
      : `Risk level too high: ${validation.riskLevel} (score: ${validation.riskScore})`,
  });

  const canProceed = checks.every(c => c.passed);

  return { canProceed, checks };
}
