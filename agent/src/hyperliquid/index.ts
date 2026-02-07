/**
 * Hyperliquid Module
 * Testnet integration for HIP-3 custom perpetual futures market creation
 *
 * This module provides:
 * - HIP-3 market creation via RegisterAsset2
 * - Quote/pricing for Hyperliquid perps
 * - Oracle integration (Pyth primary, Chainlink fallback)
 * - Risk validation for market parameters
 * - Session policy extension for HL limits
 *
 * Security: Testnet only - mainnet requires additional audit
 */

// Types
export * from './types';

// Schema validation
export {
  HIP3MarketParamsSchema,
  HIP3MarketCreationRequestSchema,
  validateHIP3Params,
  safeValidateHIP3Params,
  validateMarketCreationRequest,
  getDefaultHIP3Params,
  assessHIP3Risk,
  type HIP3RiskAssessment,
} from './hip3Schema';

// Re-export schema types with explicit names to avoid conflicts
export type { HIP3MarketParams as HIP3MarketParamsValidated } from './hip3Schema';
export type { HIP3MarketCreationRequest as HIP3MarketCreationRequestValidated } from './hip3Schema';

// Router
export {
  isHyperliquidAvailable,
  getHyperliquidMarketInfo,
  getHyperliquidQuote,
  createHIP3Market,
  getHyperliquidAccountState,
  getAllHyperliquidMarkets,
  getHyperliquidConfig,
  type HyperliquidRouterConfig,
} from './hyperliquidRouter';

// Executor
export {
  prepareHyperliquidExecution,
  type PrepareHyperliquidExecutionArgs,
  type PrepareHyperliquidExecutionResult,
} from './hyperliquidExecutor';

// Oracle configuration
export {
  getOraclePrice,
  validateOracleConfig,
  getPythPriceId,
  getChainlinkAggregator,
  getPythPrice,
  getChainlinkPrice,
  buildOracleConfig,
  PYTH_PRICE_IDS,
  CHAINLINK_AGGREGATORS,
  type OracleConfig,
  type OraclePriceResult,
} from './oracleConfig';

// Risk validation
export {
  validateMarketCreation,
  checkBondSlashRisk,
  validateLeverageBounds,
  estimateVolatilityMargin,
  preflightMarketCreation,
  type RiskValidationResult,
  type SlashRiskAssessment,
} from './riskValidator';

// Rate limits
export const HYPERLIQUID_RATE_LIMITS = {
  marketCreation: { windowMs: 86400000, max: 5 }, // 5 per day
  positionOpen: { windowMs: 60000, max: 20 }, // 20 per minute
  quoteRequest: { windowMs: 1000, max: 10 }, // 10 per second
} as const;
