/**
 * Hyperliquid Types
 * Type definitions for Hyperliquid testnet integration
 *
 * HIP-3 (Hyperliquid Improvement Proposal 3) enables permissionless
 * deployment of custom perpetual futures markets on Hyperliquid.
 */

import type { Address } from 'viem';

/**
 * Oracle types supported by Hyperliquid
 */
export type OracleType = 'pyth' | 'chainlink' | 'custom';

/**
 * Market status in the Hyperliquid registry
 */
export type MarketStatus = 'pending' | 'active' | 'paused' | 'delisted';

/**
 * HIP-3 Market Parameters
 * Required parameters for creating a new perpetual market via RegisterAsset2
 */
export interface HIP3MarketParams {
  /** Asset symbol (e.g., "DOGE-USD", "PEPE-USD") */
  assetSymbol: string;

  /** Oracle index token symbol for price feed */
  indexToken: string;

  /** Size decimals for the market (0-4, determines tick size) */
  szDecimals: number;

  /** Maximum leverage allowed (1-50) */
  maxLeverage: number;

  /** Maker fee in basis points (0-5000, max 50%) */
  makerFeeBps: number;

  /** Taker fee in basis points (0-5000, max 50%) */
  takerFeeBps: number;

  /** Oracle type for price feed */
  oracleType: OracleType;

  /** Oracle price feed ID (Pyth price ID or Chainlink aggregator) */
  oraclePriceId: string;

  /** HYPE bond amount required (1M HYPE minimum) */
  bondAmount: bigint;

  /** Maintenance margin in basis points */
  maintenanceMarginBps: number;

  /** Initial margin in basis points */
  initialMarginBps: number;

  /** Liquidation penalty in basis points */
  liquidationPenaltyBps: number;

  /** Optional: Funding rate configuration */
  fundingConfig?: {
    /** Funding interval in seconds (default: 3600 = 1 hour) */
    intervalSeconds: number;
    /** Maximum funding rate per interval in basis points */
    maxRateBps: number;
  };
}

/**
 * HIP-3 Market Creation Request
 * Submitted by builder to create a new market
 */
export interface HIP3MarketCreationRequest {
  /** Builder EOA address (must have signed the request) */
  builderAddress: Address;

  /** Market parameters */
  params: HIP3MarketParams;

  /** Builder signature over the request */
  builderSignature?: `0x${string}`;

  /** Nonce to prevent replay attacks */
  nonce: bigint;

  /** Request deadline (Unix timestamp) */
  deadline: bigint;
}

/**
 * HIP-3 Market Creation Result
 */
export interface HIP3MarketCreationResult {
  success: boolean;

  /** Market ID if creation succeeded */
  marketId?: string;

  /** Transaction hash */
  txHash?: string;

  /** Error details if failed */
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };

  /** Bond information */
  bond?: {
    amount: string;
    lockedUntil: number;
    slashRisk: string;
  };
}

/**
 * Hyperliquid Position
 */
export interface HyperliquidPosition {
  /** Market ID */
  marketId: string;

  /** Asset symbol */
  assetSymbol: string;

  /** Position side */
  side: 'long' | 'short';

  /** Position size in base asset */
  size: string;

  /** Entry price */
  entryPrice: string;

  /** Current mark price */
  markPrice: string;

  /** Unrealized PnL in USD */
  unrealizedPnl: string;

  /** Leverage */
  leverage: number;

  /** Liquidation price */
  liquidationPrice: string;

  /** Margin used */
  margin: string;
}

/**
 * Hyperliquid Order
 */
export interface HyperliquidOrder {
  /** Order ID */
  orderId: string;

  /** Market ID */
  marketId: string;

  /** Order type */
  type: 'limit' | 'market' | 'stop_limit' | 'stop_market';

  /** Order side */
  side: 'buy' | 'sell';

  /** Order size */
  size: string;

  /** Limit price (for limit orders) */
  price?: string;

  /** Trigger price (for stop orders) */
  triggerPrice?: string;

  /** Order status */
  status: 'open' | 'filled' | 'partially_filled' | 'cancelled';

  /** Filled size */
  filledSize: string;

  /** Created timestamp */
  createdAt: number;
}

/**
 * Hyperliquid Account State
 */
export interface HyperliquidAccountState {
  /** Account address */
  address: Address;

  /** Account equity in USD */
  equity: string;

  /** Available margin in USD */
  availableMargin: string;

  /** Total margin used */
  marginUsed: string;

  /** Open positions */
  positions: HyperliquidPosition[];

  /** Open orders */
  openOrders: HyperliquidOrder[];

  /** Realized PnL */
  realizedPnl: string;

  /** Total trading volume (24h) */
  volume24h: string;
}

/**
 * Hyperliquid Market Info
 */
export interface HyperliquidMarketInfo {
  /** Market ID */
  marketId: string;

  /** Asset symbol */
  assetSymbol: string;

  /** Current mark price */
  markPrice: string;

  /** 24h price change percentage */
  priceChange24h: string;

  /** 24h volume in USD */
  volume24h: string;

  /** Open interest in USD */
  openInterest: string;

  /** Current funding rate (per hour) */
  fundingRate: string;

  /** Next funding timestamp */
  nextFundingTime: number;

  /** Max leverage for this market */
  maxLeverage: number;

  /** Market status */
  status: MarketStatus;

  /** Builder address who created this market */
  builder?: Address;
}

/**
 * Hyperliquid Quote Request
 */
export interface HyperliquidQuoteRequest {
  /** Market ID or asset symbol */
  market: string;

  /** Quote side */
  side: 'buy' | 'sell';

  /** Size in base asset or USD */
  size: string;

  /** Whether size is in USD */
  sizeInUsd?: boolean;

  /** Desired leverage */
  leverage?: number;
}

/**
 * Hyperliquid Quote Result
 */
export interface HyperliquidQuoteResult {
  /** Market ID */
  marketId: string;

  /** Quote side */
  side: 'buy' | 'sell';

  /** Size in base asset */
  size: string;

  /** Expected entry price */
  entryPrice: string;

  /** Expected slippage in basis points */
  slippageBps: number;

  /** Required margin in USD */
  requiredMargin: string;

  /** Estimated fees in USD */
  estimatedFees: string;

  /** Liquidation price at entry */
  liquidationPrice: string;

  /** Quote validity timestamp */
  validUntil: number;
}

/**
 * Rate limit configuration for Hyperliquid API
 */
export interface HyperliquidRateLimits {
  /** Market creation: max 5 per day */
  marketCreation: {
    windowMs: number;
    max: number;
  };

  /** Position operations: max 20 per minute */
  positionOpen: {
    windowMs: number;
    max: number;
  };

  /** Quote requests: max 10 per second */
  quoteRequest: {
    windowMs: number;
    max: number;
  };
}

/**
 * Builder configuration for HIP-3 market creation
 */
export interface HyperliquidBuilderConfig {
  /** Builder EOA address */
  address: Address;

  /** Available HYPE balance for bonding */
  hypeBalance: string;

  /** Markets created by this builder */
  marketsCreated: number;

  /** Total bond amount locked */
  totalBondLocked: string;

  /** Builder reputation score (0-100) */
  reputationScore: number;
}

/**
 * Slashing event information
 */
export interface SlashingEvent {
  /** Market ID affected */
  marketId: string;

  /** Slash reason */
  reason: 'oracle_manipulation' | 'market_manipulation' | 'governance_action' | 'bond_undercollateralization';

  /** Slash amount in HYPE */
  amount: string;

  /** Timestamp of slash */
  timestamp: number;

  /** Transaction hash */
  txHash: string;
}
