/**
 * Hyperliquid Router Service
 *
 * Provides Hyperliquid testnet integration for:
 * - HIP-3 market creation (RegisterAsset2)
 * - Quote fetching for perp positions
 * - Market info retrieval
 * - Health checks for connectivity
 *
 * This follows the uniswapRouter.ts pattern for consistency.
 */

import type { Address } from 'viem';
import type {
  HIP3MarketParams,
  HIP3MarketCreationResult,
  HyperliquidMarketInfo,
  HyperliquidQuoteRequest,
  HyperliquidQuoteResult,
  HyperliquidAccountState,
} from './types';
import { validateHIP3Params, assessHIP3Risk } from './hip3Schema';

/**
 * Router configuration
 */
export interface HyperliquidRouterConfig {
  /** Testnet RPC URL */
  rpcUrl: string;
  /** Testnet chain ID (998) */
  chainId: number;
  /** Exchange API URL */
  exchangeUrl: string;
  /** Info API URL */
  infoUrl: string;
  /** Builder address for market creation */
  builderAddress?: Address;
  /** Mock HYPE token address (testnet) */
  mockHypeAddress?: Address;
}

// Lazy-loaded config to avoid import order issues
let _config: HyperliquidRouterConfig | null = null;

async function getConfig(): Promise<HyperliquidRouterConfig> {
  if (_config) return _config;

  const {
    HYPERLIQUID_TESTNET_RPC_URL,
    HYPERLIQUID_TESTNET_CHAIN_ID,
    HYPERLIQUID_EXCHANGE_URL,
    HYPERLIQUID_INFO_URL,
    HYPERLIQUID_BUILDER_ADDRESS,
    HYPERLIQUID_MOCK_HYPE_ADDRESS,
  } = await import('../config');

  _config = {
    rpcUrl: HYPERLIQUID_TESTNET_RPC_URL || 'https://rpc.hyperliquid-testnet.xyz/evm',
    chainId: HYPERLIQUID_TESTNET_CHAIN_ID || 998,
    exchangeUrl: HYPERLIQUID_EXCHANGE_URL || 'https://api.hyperliquid-testnet.xyz/exchange',
    infoUrl: HYPERLIQUID_INFO_URL || 'https://api.hyperliquid-testnet.xyz/info',
    builderAddress: HYPERLIQUID_BUILDER_ADDRESS as Address | undefined,
    mockHypeAddress: HYPERLIQUID_MOCK_HYPE_ADDRESS as Address | undefined,
  };

  return _config;
}

/**
 * Check if Hyperliquid router is available
 */
export async function isHyperliquidAvailable(): Promise<boolean> {
  try {
    const { HYPERLIQUID_ENABLED } = await import('../config');
    if (!HYPERLIQUID_ENABLED) return false;

    const config = await getConfig();
    if (!config.rpcUrl || !config.exchangeUrl) return false;

    // Quick health check
    const response = await fetch(config.infoUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'meta' }),
      signal: AbortSignal.timeout(5000),
    });

    return response.ok;
  } catch (error) {
    console.warn('[hyperliquidRouter] Availability check failed:', error);
    return false;
  }
}

/**
 * Get market information from Hyperliquid
 */
export async function getHyperliquidMarketInfo(
  marketId: string
): Promise<HyperliquidMarketInfo | null> {
  try {
    const config = await getConfig();

    const response = await fetch(config.infoUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'metaAndAssetCtxs',
      }),
    });

    if (!response.ok) {
      console.warn('[hyperliquidRouter] Failed to fetch market info:', response.status);
      return null;
    }

    const data = await response.json();

    // Find the specific market
    const market = data[0]?.universe?.find(
      (m: { name: string }) => m.name.toLowerCase() === marketId.toLowerCase()
    );

    if (!market) {
      return null;
    }

    // Get asset context for current prices
    const assetCtx = data[1]?.find(
      (ctx: { coin: string }) => ctx.coin.toLowerCase() === marketId.toLowerCase()
    );

    return {
      marketId: market.name,
      assetSymbol: market.name,
      markPrice: assetCtx?.markPx || '0',
      priceChange24h: assetCtx?.dayNtlVlm ? calculatePriceChange(assetCtx) : '0',
      volume24h: assetCtx?.dayNtlVlm || '0',
      openInterest: assetCtx?.openInterest || '0',
      fundingRate: assetCtx?.funding || '0',
      nextFundingTime: Date.now() + 3600000, // Approximate
      maxLeverage: market.maxLeverage || 50,
      status: 'active',
    };
  } catch (error: any) {
    console.warn('[hyperliquidRouter] Market info error:', error.message);
    return null;
  }
}

/**
 * Get quote for a Hyperliquid position
 */
export async function getHyperliquidQuote(
  request: HyperliquidQuoteRequest
): Promise<HyperliquidQuoteResult | null> {
  try {
    const config = await getConfig();
    const marketInfo = await getHyperliquidMarketInfo(request.market);

    if (!marketInfo) {
      return null;
    }

    const markPrice = parseFloat(marketInfo.markPrice);
    const leverage = request.leverage || 10;
    const sizeValue = parseFloat(request.size);

    // Calculate size in base asset if provided in USD
    const sizeInBase = request.sizeInUsd
      ? (sizeValue / markPrice).toFixed(6)
      : request.size;

    const sizeInUsd = request.sizeInUsd
      ? sizeValue
      : sizeValue * markPrice;

    // Estimate slippage based on size vs open interest
    const openInterest = parseFloat(marketInfo.openInterest) || 1000000;
    const slippageBps = Math.min(100, Math.ceil((sizeInUsd / openInterest) * 10000));

    // Calculate required margin
    const requiredMargin = (sizeInUsd / leverage).toFixed(2);

    // Estimate fees (taker fee approximation)
    const takerFeeBps = 5; // 0.05% default
    const estimatedFees = ((sizeInUsd * takerFeeBps) / 10000).toFixed(2);

    // Calculate liquidation price
    const maintenanceMarginPct = 0.025; // 2.5% approximation
    const liquidationPrice =
      request.side === 'buy'
        ? (markPrice * (1 - 1 / leverage + maintenanceMarginPct)).toFixed(4)
        : (markPrice * (1 + 1 / leverage - maintenanceMarginPct)).toFixed(4);

    return {
      marketId: request.market,
      side: request.side,
      size: sizeInBase,
      entryPrice: markPrice.toFixed(4),
      slippageBps,
      requiredMargin,
      estimatedFees,
      liquidationPrice,
      validUntil: Date.now() + 30000, // 30 second validity
    };
  } catch (error: any) {
    console.warn('[hyperliquidRouter] Quote error:', error.message);
    return null;
  }
}

/**
 * Get account state from Hyperliquid
 */
export async function getHyperliquidAccountState(
  address: Address
): Promise<HyperliquidAccountState | null> {
  try {
    const config = await getConfig();

    const response = await fetch(config.infoUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'clearinghouseState',
        user: address,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    return {
      address,
      equity: data.marginSummary?.accountValue || '0',
      availableMargin: data.marginSummary?.withdrawable || '0',
      marginUsed: data.marginSummary?.totalNtlPos || '0',
      positions: (data.assetPositions || []).map((pos: any) => ({
        marketId: pos.position?.coin,
        assetSymbol: pos.position?.coin,
        side: parseFloat(pos.position?.szi) > 0 ? 'long' : 'short',
        size: Math.abs(parseFloat(pos.position?.szi)).toString(),
        entryPrice: pos.position?.entryPx || '0',
        markPrice: pos.position?.markPx || '0',
        unrealizedPnl: pos.position?.unrealizedPnl || '0',
        leverage: pos.position?.leverage || 1,
        liquidationPrice: pos.position?.liquidationPx || '0',
        margin: pos.position?.marginUsed || '0',
      })),
      openOrders: [], // Would need separate API call
      realizedPnl: '0', // Would need separate API call
      volume24h: '0', // Would need separate API call
    };
  } catch (error: any) {
    console.warn('[hyperliquidRouter] Account state error:', error.message);
    return null;
  }
}

/**
 * Create a new HIP-3 market
 * This is the main entry point for permissionless market creation
 */
export async function createHIP3Market(
  params: HIP3MarketParams,
  builderSignature?: `0x${string}`
): Promise<HIP3MarketCreationResult> {
  try {
    // Validate parameters
    const validatedParams = validateHIP3Params(params);

    // Assess risk
    const riskAssessment = assessHIP3Risk(validatedParams);
    if (riskAssessment.riskLevel === 'critical') {
      return {
        success: false,
        error: {
          code: 'RISK_TOO_HIGH',
          message: 'Market parameters have critical risk level',
          details: {
            warnings: riskAssessment.warnings,
            recommendations: riskAssessment.recommendations,
            bondSlashRisk: riskAssessment.bondSlashRisk,
          },
        },
      };
    }

    const config = await getConfig();

    if (!config.builderAddress) {
      return {
        success: false,
        error: {
          code: 'NO_BUILDER_ADDRESS',
          message: 'Builder address not configured. Set HYPERLIQUID_BUILDER_ADDRESS.',
        },
      };
    }

    // Build RegisterAsset2 transaction
    const registerAssetTx = buildRegisterAsset2Tx(validatedParams, config.builderAddress);

    // For testnet, we can simulate or submit
    // Real implementation would submit to Hyperliquid L1

    console.log('[hyperliquidRouter] HIP-3 market creation prepared:', {
      assetSymbol: validatedParams.assetSymbol,
      maxLeverage: validatedParams.maxLeverage,
      bondAmount: validatedParams.bondAmount.toString(),
      riskLevel: riskAssessment.riskLevel,
    });

    // Return success with simulation result
    // In production, this would return actual tx hash
    return {
      success: true,
      marketId: `${validatedParams.assetSymbol}-PERP`,
      txHash: undefined, // Would be set after actual submission
      bond: {
        amount: validatedParams.bondAmount.toString(),
        lockedUntil: Math.floor(Date.now() / 1000) + 30 * 24 * 3600, // 30 days
        slashRisk: `${riskAssessment.bondSlashRisk}%`,
      },
    };
  } catch (error: any) {
    console.error('[hyperliquidRouter] HIP-3 creation error:', error);

    if (error.name === 'ZodError') {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid market parameters',
          details: error.errors,
        },
      };
    }

    return {
      success: false,
      error: {
        code: 'CREATION_FAILED',
        message: error.message || 'Unknown error during market creation',
      },
    };
  }
}

/**
 * Build RegisterAsset2 transaction data
 * This encodes the HIP-3 market creation call
 */
function buildRegisterAsset2Tx(
  params: HIP3MarketParams,
  builderAddress: Address
): {
  to: Address;
  data: `0x${string}`;
  value: bigint;
} {
  // RegisterAsset2 function signature and encoding
  // This is a simplified version - actual implementation would use viem's encodeFunctionData
  const { encodeAbiParameters, keccak256, stringToBytes } = require('viem');

  // HIP-3 RegisterAsset2 ABI encoding
  // struct RegisterAsset2Params {
  //   string symbol;
  //   uint8 szDecimals;
  //   uint256 maxLeverage;
  //   uint256 makerFee;
  //   uint256 takerFee;
  //   uint256 maintenanceMargin;
  //   uint256 initialMargin;
  //   uint256 liquidationPenalty;
  //   address oracleSource;
  //   bytes32 oraclePriceId;
  // }

  const oracleSource =
    params.oracleType === 'pyth'
      ? '0x4305FB66699C3B2702D4d05CF36551390A4c69C6' // Pyth on Hyperliquid
      : params.oracleType === 'chainlink'
        ? '0x0000000000000000000000000000000000000001' // Chainlink placeholder
        : '0x0000000000000000000000000000000000000000';

  const encodedParams = encodeAbiParameters(
    [
      { type: 'string' },    // symbol
      { type: 'uint8' },     // szDecimals
      { type: 'uint256' },   // maxLeverage
      { type: 'uint256' },   // makerFee (bps)
      { type: 'uint256' },   // takerFee (bps)
      { type: 'uint256' },   // maintenanceMargin (bps)
      { type: 'uint256' },   // initialMargin (bps)
      { type: 'uint256' },   // liquidationPenalty (bps)
      { type: 'address' },   // oracleSource
      { type: 'bytes32' },   // oraclePriceId
    ],
    [
      params.assetSymbol,
      params.szDecimals,
      BigInt(params.maxLeverage),
      BigInt(params.makerFeeBps),
      BigInt(params.takerFeeBps),
      BigInt(params.maintenanceMarginBps),
      BigInt(params.initialMarginBps),
      BigInt(params.liquidationPenaltyBps),
      oracleSource as Address,
      params.oraclePriceId.length === 66
        ? params.oraclePriceId as `0x${string}`
        : keccak256(stringToBytes(params.oraclePriceId)) as `0x${string}`,
    ]
  );

  // RegisterAsset2 function selector: 0x... (to be determined from actual ABI)
  const functionSelector = '0x12345678'; // Placeholder

  return {
    to: '0x0000000000000000000000000000000000000000' as Address, // Hyperliquid L1 address
    data: `${functionSelector}${encodedParams.slice(2)}` as `0x${string}`,
    value: params.bondAmount,
  };
}

/**
 * Get all available markets on Hyperliquid
 */
export async function getAllHyperliquidMarkets(): Promise<HyperliquidMarketInfo[]> {
  try {
    const config = await getConfig();

    const response = await fetch(config.infoUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const universe = data[0]?.universe || [];
    const assetCtxs = data[1] || [];

    return universe.map((market: any, index: number) => {
      const ctx = assetCtxs[index] || {};
      return {
        marketId: market.name,
        assetSymbol: market.name,
        markPrice: ctx.markPx || '0',
        priceChange24h: '0',
        volume24h: ctx.dayNtlVlm || '0',
        openInterest: ctx.openInterest || '0',
        fundingRate: ctx.funding || '0',
        nextFundingTime: Date.now() + 3600000,
        maxLeverage: market.maxLeverage || 50,
        status: 'active' as const,
      };
    });
  } catch (error: any) {
    console.warn('[hyperliquidRouter] Get all markets error:', error.message);
    return [];
  }
}

/**
 * Helper to calculate 24h price change
 */
function calculatePriceChange(ctx: any): string {
  // Simplified calculation - would need historical data for accuracy
  return '0';
}

/**
 * Export router configuration for reference
 */
export { getConfig as getHyperliquidConfig };
