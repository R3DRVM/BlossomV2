/**
 * Hyperliquid Testnet Executor
 * Prepares execution plans for HIP-3 market creation and position management
 *
 * This follows the ethTestnetExecutor.ts pattern:
 * - Prepare execution plans with typed data
 * - Support session-based authorization
 * - Non-custodial signing flow
 */

import type { Address } from 'viem';
import type {
  HIP3MarketParams,
  HIP3MarketCreationResult,
  HyperliquidQuoteRequest,
  HyperliquidQuoteResult,
} from './types';
import { validateHIP3Params, assessHIP3Risk } from './hip3Schema';
import { getHyperliquidQuote, createHIP3Market, isHyperliquidAvailable } from './hyperliquidRouter';

/**
 * Arguments for preparing Hyperliquid execution
 */
export interface PrepareHyperliquidExecutionArgs {
  /** Draft ID for tracking */
  draftId: string;

  /** User wallet address */
  userAddress: string;

  /** Execution kind */
  executionKind: 'perp_create' | 'perp_open' | 'perp_close';

  /** Authorization mode */
  authMode?: 'direct' | 'session';

  /** Market creation parameters (for perp_create) */
  marketParams?: Partial<HIP3MarketParams>;

  /** Position parameters (for perp_open/close) */
  positionParams?: {
    market: string;
    side: 'long' | 'short';
    size: string;
    leverage?: number;
    reduceOnly?: boolean;
  };

  /** Builder address for HIP-3 (optional, uses config default) */
  builderAddress?: Address;
}

/**
 * Result from preparing Hyperliquid execution
 */
export interface PrepareHyperliquidExecutionResult {
  /** Hyperliquid testnet chain ID */
  chainId: number;

  /** Target contract address */
  to: string;

  /** Value to send (HYPE bond for market creation) */
  value: string;

  /** Execution plan */
  plan: {
    user: string;
    nonce: string;
    deadline: string;
    actions: Array<{
      actionType: number;
      data: string;
    }>;
  };

  /** EIP-712 typed data for signing (if applicable) */
  typedData?: {
    domain: {
      name: string;
      version: string;
      chainId: number;
    };
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  };

  /** Execution summary */
  summary: string;

  /** Warnings */
  warnings?: string[];

  /** Routing/quote metadata */
  routing?: {
    venue: string;
    chain: string;
    expectedPrice?: string;
    slippageBps?: number;
    requiredMargin?: string;
    bondAmount?: string;
    riskLevel?: string;
  };

  /** Requirements before execution */
  requirements?: {
    /** Token approvals needed */
    approvals?: Array<{
      token: string;
      spender: string;
      amount: string;
    }>;
    /** HYPE bond requirement */
    bondRequired?: {
      amount: string;
      lockPeriod: string;
    };
  };

  /** Risk assessment for HIP-3 */
  riskAssessment?: {
    level: 'low' | 'medium' | 'high' | 'critical';
    warnings: string[];
    recommendations: string[];
    bondSlashRisk: number;
  };
}

// Action type constants for Hyperliquid
const HL_ACTION_TYPES = {
  REGISTER_ASSET: 1,    // HIP-3 market creation
  OPEN_POSITION: 2,     // Open/increase position
  CLOSE_POSITION: 3,    // Close/decrease position
  MODIFY_LEVERAGE: 4,   // Change leverage
  UPDATE_MARGIN: 5,     // Add/remove margin
} as const;

/**
 * Prepare Hyperliquid execution plan
 */
export async function prepareHyperliquidExecution(
  args: PrepareHyperliquidExecutionArgs
): Promise<PrepareHyperliquidExecutionResult> {
  const {
    draftId,
    userAddress,
    executionKind,
    authMode = 'direct',
    marketParams,
    positionParams,
    builderAddress: providedBuilderAddress,
  } = args;

  // Validate user address
  if (!userAddress || !/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
    throw new Error(`Invalid userAddress format: ${userAddress}`);
  }

  // Check availability
  const available = await isHyperliquidAvailable();
  if (!available) {
    throw new Error('Hyperliquid testnet is not available. Check HYPERLIQUID_ENABLED config.');
  }

  // Import config
  const {
    HYPERLIQUID_TESTNET_CHAIN_ID,
    HYPERLIQUID_BUILDER_ADDRESS,
    HYPERLIQUID_MOCK_HYPE_ADDRESS,
  } = await import('../config');

  const chainId = HYPERLIQUID_TESTNET_CHAIN_ID || 998;
  const builderAddress = providedBuilderAddress || HYPERLIQUID_BUILDER_ADDRESS;
  const warnings: string[] = [];

  // Set deadline: now + 10 minutes
  const deadlineSeconds = Math.floor(Date.now() / 1000) + 10 * 60;
  const deadline = deadlineSeconds.toString();

  // Placeholder nonce (would fetch from chain in production)
  const nonce = '0';

  let result: PrepareHyperliquidExecutionResult;

  switch (executionKind) {
    case 'perp_create':
      result = await prepareMarketCreation({
        draftId,
        userAddress,
        marketParams,
        builderAddress: builderAddress as Address,
        chainId,
        nonce,
        deadline,
        authMode,
        warnings,
      });
      break;

    case 'perp_open':
      result = await preparePositionOpen({
        draftId,
        userAddress,
        positionParams: positionParams!,
        chainId,
        nonce,
        deadline,
        authMode,
        warnings,
      });
      break;

    case 'perp_close':
      result = await preparePositionClose({
        draftId,
        userAddress,
        positionParams: positionParams!,
        chainId,
        nonce,
        deadline,
        authMode,
        warnings,
      });
      break;

    default:
      throw new Error(`Unsupported execution kind: ${executionKind}`);
  }

  console.log('[hyperliquidExecutor] Prepared execution:', {
    draftId,
    userAddress,
    executionKind,
    chainId,
    actionCount: result.plan.actions.length,
    hasWarnings: warnings.length > 0,
  });

  return result;
}

/**
 * Prepare HIP-3 market creation
 */
async function prepareMarketCreation(args: {
  draftId: string;
  userAddress: string;
  marketParams?: Partial<HIP3MarketParams>;
  builderAddress: Address;
  chainId: number;
  nonce: string;
  deadline: string;
  authMode: 'direct' | 'session';
  warnings: string[];
}): Promise<PrepareHyperliquidExecutionResult> {
  const { userAddress, marketParams, builderAddress, chainId, nonce, deadline, authMode, warnings } = args;

  if (!builderAddress) {
    throw new Error('Builder address required for HIP-3 market creation. Set HYPERLIQUID_BUILDER_ADDRESS.');
  }

  // Build complete params with defaults
  const { getDefaultHIP3Params } = await import('./hip3Schema');
  const assetSymbol = marketParams?.assetSymbol || 'CUSTOM-USD';
  const defaults = getDefaultHIP3Params(assetSymbol);

  const fullParams: HIP3MarketParams = {
    assetSymbol: marketParams?.assetSymbol || defaults.assetSymbol!,
    indexToken: marketParams?.indexToken || defaults.indexToken!,
    szDecimals: marketParams?.szDecimals ?? defaults.szDecimals!,
    maxLeverage: marketParams?.maxLeverage ?? defaults.maxLeverage!,
    makerFeeBps: marketParams?.makerFeeBps ?? defaults.makerFeeBps!,
    takerFeeBps: marketParams?.takerFeeBps ?? defaults.takerFeeBps!,
    oracleType: marketParams?.oracleType ?? defaults.oracleType!,
    oraclePriceId: marketParams?.oraclePriceId || '0x0000000000000000000000000000000000000000000000000000000000000000',
    bondAmount: marketParams?.bondAmount ?? BigInt('1000000000000000000000000'), // 1M HYPE
    maintenanceMarginBps: marketParams?.maintenanceMarginBps ?? defaults.maintenanceMarginBps!,
    initialMarginBps: marketParams?.initialMarginBps ?? defaults.initialMarginBps!,
    liquidationPenaltyBps: marketParams?.liquidationPenaltyBps ?? defaults.liquidationPenaltyBps!,
    fundingConfig: marketParams?.fundingConfig ?? defaults.fundingConfig,
  };

  // Validate parameters
  const validatedParams = validateHIP3Params(fullParams);

  // Assess risk
  const riskAssessment = assessHIP3Risk(validatedParams);

  if (riskAssessment.warnings.length > 0) {
    warnings.push(...riskAssessment.warnings);
  }

  // Build RegisterAsset2 action data
  const { encodeAbiParameters } = await import('viem');

  const registerAssetData = encodeAbiParameters(
    [
      { type: 'string' },    // symbol
      { type: 'uint8' },     // szDecimals
      { type: 'uint256' },   // maxLeverage
      { type: 'uint256' },   // makerFee
      { type: 'uint256' },   // takerFee
      { type: 'uint256' },   // maintenanceMargin
      { type: 'uint256' },   // initialMargin
      { type: 'uint256' },   // liquidationPenalty
      { type: 'bytes32' },   // oraclePriceId
    ],
    [
      validatedParams.assetSymbol,
      validatedParams.szDecimals,
      BigInt(validatedParams.maxLeverage),
      BigInt(validatedParams.makerFeeBps),
      BigInt(validatedParams.takerFeeBps),
      BigInt(validatedParams.maintenanceMarginBps),
      BigInt(validatedParams.initialMarginBps),
      BigInt(validatedParams.liquidationPenaltyBps),
      validatedParams.oraclePriceId.length === 66
        ? validatedParams.oraclePriceId as `0x${string}`
        : ('0x' + '0'.repeat(64)) as `0x${string}`,
    ]
  );

  // Wrap for session mode if needed
  let actionData: string;
  if (authMode === 'session') {
    actionData = encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'bytes' }],
      [validatedParams.bondAmount, registerAssetData]
    );
  } else {
    actionData = registerAssetData;
  }

  const actions = [
    {
      actionType: HL_ACTION_TYPES.REGISTER_ASSET,
      data: actionData,
    },
  ];

  const bondAmountHex = '0x' + validatedParams.bondAmount.toString(16);

  return {
    chainId,
    to: '0x0000000000000000000000000000000000000000', // Hyperliquid L1
    value: bondAmountHex,
    plan: {
      user: userAddress.toLowerCase(),
      nonce,
      deadline,
      actions,
    },
    typedData: buildHIP3TypedData(chainId, validatedParams, deadline, nonce),
    summary: `Create HIP-3 market: ${validatedParams.assetSymbol} (${validatedParams.maxLeverage}x max leverage, ${validatedParams.bondAmount.toString()} HYPE bond)`,
    warnings: warnings.length > 0 ? warnings : undefined,
    routing: {
      venue: 'Hyperliquid HIP-3',
      chain: 'Hyperliquid Testnet',
      bondAmount: validatedParams.bondAmount.toString(),
      riskLevel: riskAssessment.riskLevel,
    },
    requirements: {
      bondRequired: {
        amount: validatedParams.bondAmount.toString(),
        lockPeriod: '30 days',
      },
    },
    riskAssessment: {
      level: riskAssessment.riskLevel,
      warnings: riskAssessment.warnings,
      recommendations: riskAssessment.recommendations,
      bondSlashRisk: riskAssessment.bondSlashRisk,
    },
  };
}

/**
 * Prepare position open
 */
async function preparePositionOpen(args: {
  draftId: string;
  userAddress: string;
  positionParams: {
    market: string;
    side: 'long' | 'short';
    size: string;
    leverage?: number;
  };
  chainId: number;
  nonce: string;
  deadline: string;
  authMode: 'direct' | 'session';
  warnings: string[];
}): Promise<PrepareHyperliquidExecutionResult> {
  const { userAddress, positionParams, chainId, nonce, deadline, authMode, warnings } = args;

  // Get quote for the position
  const quote = await getHyperliquidQuote({
    market: positionParams.market,
    side: positionParams.side === 'long' ? 'buy' : 'sell',
    size: positionParams.size,
    leverage: positionParams.leverage || 10,
  });

  if (!quote) {
    throw new Error(`Failed to get quote for ${positionParams.market}`);
  }

  const { encodeAbiParameters, keccak256, stringToBytes } = await import('viem');

  // Encode position open data
  const openPositionData = encodeAbiParameters(
    [
      { type: 'bytes32' },   // marketId
      { type: 'bool' },      // isLong
      { type: 'uint256' },   // size
      { type: 'uint256' },   // leverage
      { type: 'uint256' },   // maxSlippageBps
    ],
    [
      keccak256(stringToBytes(positionParams.market)),
      positionParams.side === 'long',
      BigInt(Math.floor(parseFloat(positionParams.size) * 1e18)),
      BigInt(positionParams.leverage || 10),
      BigInt(quote.slippageBps * 2), // 2x slippage buffer
    ]
  );

  // Wrap for session mode
  let actionData: string;
  if (authMode === 'session') {
    const marginWei = BigInt(Math.floor(parseFloat(quote.requiredMargin) * 1e18));
    actionData = encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'bytes' }],
      [marginWei, openPositionData]
    );
  } else {
    actionData = openPositionData;
  }

  const actions = [
    {
      actionType: HL_ACTION_TYPES.OPEN_POSITION,
      data: actionData,
    },
  ];

  return {
    chainId,
    to: '0x0000000000000000000000000000000000000000', // Hyperliquid L1
    value: '0x0',
    plan: {
      user: userAddress.toLowerCase(),
      nonce,
      deadline,
      actions,
    },
    summary: `${positionParams.side.toUpperCase()} ${positionParams.market} @ ${positionParams.leverage || 10}x (${positionParams.size} contracts)`,
    warnings: warnings.length > 0 ? warnings : undefined,
    routing: {
      venue: `Hyperliquid: ${positionParams.market}`,
      chain: 'Hyperliquid Testnet',
      expectedPrice: quote.entryPrice,
      slippageBps: quote.slippageBps,
      requiredMargin: quote.requiredMargin,
    },
  };
}

/**
 * Prepare position close
 */
async function preparePositionClose(args: {
  draftId: string;
  userAddress: string;
  positionParams: {
    market: string;
    side: 'long' | 'short';
    size: string;
    reduceOnly?: boolean;
  };
  chainId: number;
  nonce: string;
  deadline: string;
  authMode: 'direct' | 'session';
  warnings: string[];
}): Promise<PrepareHyperliquidExecutionResult> {
  const { userAddress, positionParams, chainId, nonce, deadline, authMode, warnings } = args;

  const { encodeAbiParameters, keccak256, stringToBytes } = await import('viem');

  // Encode position close data
  const closePositionData = encodeAbiParameters(
    [
      { type: 'bytes32' },   // marketId
      { type: 'bool' },      // isLong
      { type: 'uint256' },   // size
      { type: 'bool' },      // reduceOnly
    ],
    [
      keccak256(stringToBytes(positionParams.market)),
      positionParams.side === 'long',
      BigInt(Math.floor(parseFloat(positionParams.size) * 1e18)),
      positionParams.reduceOnly ?? true,
    ]
  );

  // Session mode wrapping (0 spend for close)
  let actionData: string;
  if (authMode === 'session') {
    actionData = encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'bytes' }],
      [0n, closePositionData]
    );
  } else {
    actionData = closePositionData;
  }

  const actions = [
    {
      actionType: HL_ACTION_TYPES.CLOSE_POSITION,
      data: actionData,
    },
  ];

  return {
    chainId,
    to: '0x0000000000000000000000000000000000000000', // Hyperliquid L1
    value: '0x0',
    plan: {
      user: userAddress.toLowerCase(),
      nonce,
      deadline,
      actions,
    },
    summary: `Close ${positionParams.side.toUpperCase()} ${positionParams.market} (${positionParams.size} contracts)`,
    warnings: warnings.length > 0 ? warnings : undefined,
    routing: {
      venue: `Hyperliquid: ${positionParams.market}`,
      chain: 'Hyperliquid Testnet',
    },
  };
}

/**
 * Build EIP-712 typed data for HIP-3 market creation
 */
function buildHIP3TypedData(
  chainId: number,
  params: HIP3MarketParams,
  deadline: string,
  nonce: string
) {
  return {
    domain: {
      name: 'HyperliquidHIP3',
      version: '1',
      chainId,
    },
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
      ],
      RegisterAsset: [
        { name: 'symbol', type: 'string' },
        { name: 'szDecimals', type: 'uint8' },
        { name: 'maxLeverage', type: 'uint256' },
        { name: 'bondAmount', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'RegisterAsset',
    message: {
      symbol: params.assetSymbol,
      szDecimals: params.szDecimals,
      maxLeverage: params.maxLeverage,
      bondAmount: params.bondAmount.toString(),
      nonce,
      deadline,
    },
  };
}
