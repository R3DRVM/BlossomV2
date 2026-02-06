/**
 * Uniswap V3 Router Service
 *
 * Provides real Uniswap V3 integration for swap operations.
 * Supports:
 * - Quote fetching via QuoterV2
 * - Swap execution via SwapRouter02
 * - Multi-hop routing
 * - Slippage protection
 *
 * This replaces demo venue swaps with real Uniswap V3 execution on Sepolia.
 */

import {
  ETH_TESTNET_RPC_URL,
  ETH_TESTNET_CHAIN_ID,
  UNISWAP_V3_ROUTER_ADDRESS,
  UNISWAP_V3_ADAPTER_ADDRESS,
  DEFAULT_SWAP_SLIPPAGE_BPS,
} from '../config';
import { formatUnits, parseUnits, encodeFunctionData, decodeFunctionResult } from 'viem';

// Uniswap V3 contract addresses on Sepolia
const UNISWAP_V3_QUOTER_V2 = '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a';
const UNISWAP_V3_SWAP_ROUTER_02 = UNISWAP_V3_ROUTER_ADDRESS || '0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008';
const UNISWAP_V3_FACTORY = '0x0227628f3F023bb0B980b67D528571c95c6DaC1c';

// Common fee tiers for Uniswap V3 (in hundredths of a bip)
export const UNISWAP_FEE_TIERS = {
  LOWEST: 100,   // 0.01%
  LOW: 500,      // 0.05%
  MEDIUM: 3000,  // 0.30%
  HIGH: 10000,   // 1.00%
} as const;

export interface UniswapQuoteParams {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  fee?: number;
  sqrtPriceLimitX96?: bigint;
}

export interface UniswapQuoteResult {
  amountOut: string;
  sqrtPriceX96After: string;
  initializedTicksCrossed: number;
  gasEstimate: string;
  priceImpact?: number;
  route?: string;
}

export interface UniswapSwapParams {
  tokenIn: string;
  tokenOut: string;
  fee: number;
  amountIn: string;
  amountOutMinimum: string;
  recipient: string;
  deadline: number;
  sqrtPriceLimitX96?: bigint;
}

export interface UniswapSwapResult {
  success: boolean;
  amountOut?: string;
  txHash?: string;
  error?: string;
}

export interface MultiHopRoute {
  path: string[];       // Token addresses in order
  fees: number[];       // Fee tiers between tokens
  expectedOut: string;
  gasEstimate: string;
}

// QuoterV2 ABI for quoteExactInputSingle
const QUOTER_V2_ABI = [
  {
    name: 'quoteExactInputSingle',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'fee', type: 'uint24' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
  {
    name: 'quoteExactInput',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'path', type: 'bytes' },
      { name: 'amountIn', type: 'uint256' },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96AfterList', type: 'uint160[]' },
      { name: 'initializedTicksCrossedList', type: 'uint32[]' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const;

// SwapRouter02 ABI for exactInputSingle
const SWAP_ROUTER_ABI = [
  {
    name: 'exactInputSingle',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    name: 'exactInput',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'path', type: 'bytes' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const;

/**
 * Check if Uniswap router is available
 */
export function isUniswapRouterAvailable(): boolean {
  return !!(ETH_TESTNET_RPC_URL && UNISWAP_V3_ADAPTER_ADDRESS);
}

/**
 * Get quote from Uniswap V3 QuoterV2 for a single-hop swap
 */
export async function getUniswapQuote(params: UniswapQuoteParams): Promise<UniswapQuoteResult | null> {
  const { tokenIn, tokenOut, amountIn, fee = UNISWAP_FEE_TIERS.MEDIUM, sqrtPriceLimitX96 = 0n } = params;

  if (!ETH_TESTNET_RPC_URL) {
    console.warn('[uniswapRouter] ETH_TESTNET_RPC_URL not configured');
    return null;
  }

  try {
    const callData = encodeFunctionData({
      abi: QUOTER_V2_ABI,
      functionName: 'quoteExactInputSingle',
      args: [
        {
          tokenIn: tokenIn as `0x${string}`,
          tokenOut: tokenOut as `0x${string}`,
          amountIn: BigInt(amountIn),
          fee,
          sqrtPriceLimitX96,
        },
      ],
    });

    const response = await fetch(ETH_TESTNET_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [
          {
            to: UNISWAP_V3_QUOTER_V2,
            data: callData,
          },
          'latest',
        ],
      }),
    });

    const data = await response.json();

    if (data.error) {
      console.warn('[uniswapRouter] RPC error:', data.error);
      return null;
    }

    if (!data.result || data.result === '0x') {
      console.warn('[uniswapRouter] No result from quoter');
      return null;
    }

    const decoded = decodeFunctionResult({
      abi: QUOTER_V2_ABI,
      functionName: 'quoteExactInputSingle',
      data: data.result as `0x${string}`,
    });

    return {
      amountOut: decoded[0].toString(),
      sqrtPriceX96After: decoded[1].toString(),
      initializedTicksCrossed: Number(decoded[2]),
      gasEstimate: decoded[3].toString(),
      route: `${tokenIn} -> ${tokenOut} (fee: ${fee / 10000}%)`,
    };
  } catch (error: any) {
    console.warn('[uniswapRouter] Quote error:', error.message);
    return null;
  }
}

/**
 * Encode swap path for multi-hop swaps
 * Path format: token0 + fee0 + token1 + fee1 + token2 ...
 */
export function encodeSwapPath(tokens: string[], fees: number[]): `0x${string}` {
  if (tokens.length !== fees.length + 1) {
    throw new Error('Path length mismatch: tokens.length should be fees.length + 1');
  }

  let path = '';
  for (let i = 0; i < tokens.length; i++) {
    // Remove 0x prefix if present
    const token = tokens[i].toLowerCase().replace('0x', '');
    path += token;

    if (i < fees.length) {
      // Encode fee as 3 bytes (uint24)
      const feeHex = fees[i].toString(16).padStart(6, '0');
      path += feeHex;
    }
  }

  return `0x${path}`;
}

/**
 * Get quote for multi-hop swap
 */
export async function getMultiHopQuote(
  tokens: string[],
  fees: number[],
  amountIn: string
): Promise<UniswapQuoteResult | null> {
  if (!ETH_TESTNET_RPC_URL) {
    console.warn('[uniswapRouter] ETH_TESTNET_RPC_URL not configured');
    return null;
  }

  try {
    const path = encodeSwapPath(tokens, fees);

    const callData = encodeFunctionData({
      abi: QUOTER_V2_ABI,
      functionName: 'quoteExactInput',
      args: [path, BigInt(amountIn)],
    });

    const response = await fetch(ETH_TESTNET_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [
          {
            to: UNISWAP_V3_QUOTER_V2,
            data: callData,
          },
          'latest',
        ],
      }),
    });

    const data = await response.json();

    if (data.error || !data.result || data.result === '0x') {
      return null;
    }

    const decoded = decodeFunctionResult({
      abi: QUOTER_V2_ABI,
      functionName: 'quoteExactInput',
      data: data.result as `0x${string}`,
    });

    return {
      amountOut: decoded[0].toString(),
      sqrtPriceX96After: decoded[1][decoded[1].length - 1]?.toString() || '0',
      initializedTicksCrossed: decoded[2].reduce((sum, n) => sum + Number(n), 0),
      gasEstimate: decoded[3].toString(),
      route: tokens.join(' -> '),
    };
  } catch (error: any) {
    console.warn('[uniswapRouter] Multi-hop quote error:', error.message);
    return null;
  }
}

/**
 * Find the best route for a swap across multiple fee tiers
 */
export async function findBestRoute(
  tokenIn: string,
  tokenOut: string,
  amountIn: string
): Promise<{ quote: UniswapQuoteResult; fee: number } | null> {
  const feeTiers = [
    UNISWAP_FEE_TIERS.LOW,
    UNISWAP_FEE_TIERS.MEDIUM,
    UNISWAP_FEE_TIERS.HIGH,
  ];

  let bestQuote: UniswapQuoteResult | null = null;
  let bestFee: number = UNISWAP_FEE_TIERS.MEDIUM;

  // Try each fee tier and find the best output
  const quotes = await Promise.all(
    feeTiers.map(async (fee) => {
      const quote = await getUniswapQuote({
        tokenIn,
        tokenOut,
        amountIn,
        fee,
      });
      return { quote, fee };
    })
  );

  for (const { quote, fee } of quotes) {
    if (quote && (!bestQuote || BigInt(quote.amountOut) > BigInt(bestQuote.amountOut))) {
      bestQuote = quote;
      bestFee = fee;
    }
  }

  if (!bestQuote) {
    return null;
  }

  return { quote: bestQuote, fee: bestFee };
}

/**
 * Build swap calldata for UniswapV3SwapAdapter
 * This is used when executing swaps through the ExecutionRouter
 */
export function buildSwapAdapterData(params: UniswapSwapParams): `0x${string}` {
  const { encodeAbiParameters } = require('viem');

  return encodeAbiParameters(
    [
      { type: 'address' },
      { type: 'address' },
      { type: 'uint24' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'address' },
      { type: 'uint256' },
    ],
    [
      params.tokenIn as `0x${string}`,
      params.tokenOut as `0x${string}`,
      params.fee,
      BigInt(params.amountIn),
      BigInt(params.amountOutMinimum),
      params.recipient as `0x${string}`,
      BigInt(params.deadline),
    ]
  );
}

/**
 * Calculate minimum output amount with slippage tolerance
 */
export function calculateMinOutput(
  expectedOutput: string,
  slippageBps: number = DEFAULT_SWAP_SLIPPAGE_BPS
): string {
  const expected = BigInt(expectedOutput);
  const slippageMultiplier = BigInt(10000 - slippageBps);
  return ((expected * slippageMultiplier) / 10000n).toString();
}

/**
 * Estimate price impact based on quote vs spot price
 */
export function estimatePriceImpact(
  amountIn: string,
  amountOut: string,
  spotPrice: number, // tokenOut per tokenIn
  decimalsIn: number,
  decimalsOut: number
): number {
  const inAmount = Number(formatUnits(BigInt(amountIn), decimalsIn));
  const outAmount = Number(formatUnits(BigInt(amountOut), decimalsOut));

  const expectedOut = inAmount * spotPrice;
  const priceImpact = ((expectedOut - outAmount) / expectedOut) * 100;

  return Math.max(0, priceImpact); // Price impact is always positive
}

/**
 * Get swap parameters with routing decision
 * Integrates quote fetching and slippage calculation
 */
export async function getSwapWithRouting(params: {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageBps?: number;
  recipient: string;
  deadline?: number;
}): Promise<{
  params: UniswapSwapParams;
  quote: UniswapQuoteResult;
  routingSource: 'uniswap';
} | null> {
  const {
    tokenIn,
    tokenOut,
    amountIn,
    slippageBps = DEFAULT_SWAP_SLIPPAGE_BPS,
    recipient,
    deadline = Math.floor(Date.now() / 1000) + 600, // 10 minutes
  } = params;

  // Find best route
  const result = await findBestRoute(tokenIn, tokenOut, amountIn);
  if (!result) {
    return null;
  }

  const { quote, fee } = result;
  const amountOutMinimum = calculateMinOutput(quote.amountOut, slippageBps);

  return {
    params: {
      tokenIn,
      tokenOut,
      fee,
      amountIn,
      amountOutMinimum,
      recipient,
      deadline,
    },
    quote,
    routingSource: 'uniswap',
  };
}

/**
 * Export router addresses for reference
 */
export const UNISWAP_ADDRESSES = {
  quoterV2: UNISWAP_V3_QUOTER_V2,
  swapRouter02: UNISWAP_V3_SWAP_ROUTER_02,
  factory: UNISWAP_V3_FACTORY,
} as const;
