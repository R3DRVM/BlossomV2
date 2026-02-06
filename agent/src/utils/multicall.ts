/**
 * Multicall Utility
 *
 * Provides batched transaction support and simulation capabilities.
 * Features:
 * - Multicall3 contract integration for batched reads
 * - Transaction simulation before signing
 * - Revert protection with pre-execution checks
 * - Gas estimation for batched operations
 *
 * This enables atomic transaction batching and safety checks.
 */

import {
  ETH_TESTNET_RPC_URL,
  ETH_TESTNET_CHAIN_ID,
  EXECUTION_ROUTER_ADDRESS,
} from '../config';
import { encodeFunctionData, decodeFunctionResult, keccak256, toHex } from 'viem';

// Multicall3 address (same on all chains)
const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';

// EVM chains where Multicall3 is deployed
const MULTICALL3_CHAINS = [
  1, // Ethereum
  11155111, // Sepolia
  42161, // Arbitrum
  10, // Optimism
  137, // Polygon
  8453, // Base
  43114, // Avalanche
];

export interface Call {
  target: string;
  callData: string;
  allowFailure?: boolean;
}

export interface CallResult {
  success: boolean;
  returnData: string;
}

export interface SimulationResult {
  success: boolean;
  gasUsed?: string;
  returnData?: string;
  error?: string;
  revertReason?: string;
}

export interface BatchResult {
  success: boolean;
  results: CallResult[];
  blockNumber?: number;
  gasUsed?: string;
}

export interface TransactionSimulation {
  willSucceed: boolean;
  estimatedGas: string;
  warnings: string[];
  stateChanges?: StateChange[];
}

export interface StateChange {
  address: string;
  slot: string;
  before: string;
  after: string;
}

// Multicall3 ABI
const MULTICALL3_ABI = [
  {
    name: 'aggregate3',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'target', type: 'address' },
          { name: 'allowFailure', type: 'bool' },
          { name: 'callData', type: 'bytes' },
        ],
      },
    ],
    outputs: [
      {
        name: 'returnData',
        type: 'tuple[]',
        components: [
          { name: 'success', type: 'bool' },
          { name: 'returnData', type: 'bytes' },
        ],
      },
    ],
  },
  {
    name: 'aggregate3Value',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'target', type: 'address' },
          { name: 'allowFailure', type: 'bool' },
          { name: 'value', type: 'uint256' },
          { name: 'callData', type: 'bytes' },
        ],
      },
    ],
    outputs: [
      {
        name: 'returnData',
        type: 'tuple[]',
        components: [
          { name: 'success', type: 'bool' },
          { name: 'returnData', type: 'bytes' },
        ],
      },
    ],
  },
  {
    name: 'getBlockNumber',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'blockNumber', type: 'uint256' }],
  },
  {
    name: 'getCurrentBlockTimestamp',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'timestamp', type: 'uint256' }],
  },
] as const;

/**
 * Check if multicall is available on the current chain
 */
export function isMulticallAvailable(): boolean {
  return MULTICALL3_CHAINS.includes(ETH_TESTNET_CHAIN_ID) && !!ETH_TESTNET_RPC_URL;
}

/**
 * Make an RPC call
 */
async function rpcCall(
  method: string,
  params: any[],
  rpcUrl: string = ETH_TESTNET_RPC_URL || ''
): Promise<any> {
  if (!rpcUrl) {
    throw new Error('RPC URL not configured');
  }

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  });

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message || 'RPC error');
  }

  return data.result;
}

/**
 * Execute multiple read calls in a single RPC request
 */
export async function multicallRead(calls: Call[]): Promise<BatchResult> {
  if (!isMulticallAvailable()) {
    // Fallback: execute calls sequentially
    return executeSequentially(calls);
  }

  try {
    const callData = encodeFunctionData({
      abi: MULTICALL3_ABI,
      functionName: 'aggregate3',
      args: [
        calls.map((call) => ({
          target: call.target as `0x${string}`,
          allowFailure: call.allowFailure ?? true,
          callData: call.callData as `0x${string}`,
        })),
      ],
    });

    const result = await rpcCall('eth_call', [
      {
        to: MULTICALL3_ADDRESS,
        data: callData,
      },
      'latest',
    ]);

    if (!result || result === '0x') {
      return { success: false, results: [] };
    }

    const decoded = decodeFunctionResult({
      abi: MULTICALL3_ABI,
      functionName: 'aggregate3',
      data: result as `0x${string}`,
    });

    return {
      success: true,
      results: decoded.map((r: any) => ({
        success: r.success,
        returnData: r.returnData,
      })),
    };
  } catch (error: any) {
    console.warn('[multicall] Batch call failed:', error.message);
    return { success: false, results: [] };
  }
}

/**
 * Execute calls sequentially (fallback when multicall unavailable)
 */
async function executeSequentially(calls: Call[]): Promise<BatchResult> {
  const results: CallResult[] = [];

  for (const call of calls) {
    try {
      const result = await rpcCall('eth_call', [
        {
          to: call.target,
          data: call.callData,
        },
        'latest',
      ]);

      results.push({
        success: true,
        returnData: result || '0x',
      });
    } catch (error: any) {
      if (call.allowFailure) {
        results.push({
          success: false,
          returnData: '0x',
        });
      } else {
        return { success: false, results };
      }
    }
  }

  return { success: true, results };
}

/**
 * Simulate a transaction and check if it will succeed
 */
export async function simulateTransaction(params: {
  to: string;
  data: string;
  value?: string;
  from?: string;
}): Promise<SimulationResult> {
  const { to, data, value = '0x0', from } = params;

  if (!ETH_TESTNET_RPC_URL) {
    return {
      success: false,
      error: 'RPC URL not configured',
    };
  }

  try {
    // First, try eth_call to check for reverts
    const callParams: any = {
      to,
      data,
      value,
    };
    if (from) {
      callParams.from = from;
    }

    const result = await rpcCall('eth_call', [callParams, 'latest']);

    // If we get here, the call succeeded
    // Now estimate gas
    let gasUsed = '0';
    try {
      const gasEstimate = await rpcCall('eth_estimateGas', [callParams]);
      gasUsed = parseInt(gasEstimate, 16).toString();
    } catch {
      // Gas estimation failed but call succeeded
    }

    return {
      success: true,
      gasUsed,
      returnData: result,
    };
  } catch (error: any) {
    // Parse revert reason if available
    const revertReason = parseRevertReason(error);

    return {
      success: false,
      error: error.message,
      revertReason,
    };
  }
}

/**
 * Parse revert reason from error message
 */
function parseRevertReason(error: any): string | undefined {
  const message = error.message || '';

  // Common patterns for revert reasons
  // "execution reverted: reason"
  const revertMatch = message.match(/execution reverted: (.+)/i);
  if (revertMatch) {
    return revertMatch[1];
  }

  // Panic codes
  const panicMatch = message.match(/Panic\(uint256 (\d+)\)/);
  if (panicMatch) {
    const panicCode = parseInt(panicMatch[1]);
    const panicReasons: Record<number, string> = {
      0x01: 'Assertion failed',
      0x11: 'Arithmetic overflow/underflow',
      0x12: 'Division by zero',
      0x21: 'Invalid enum value',
      0x22: 'Storage encoding error',
      0x31: 'Pop from empty array',
      0x32: 'Array index out of bounds',
      0x41: 'Memory allocation error',
      0x51: 'Called invalid function',
    };
    return panicReasons[panicCode] || `Panic code: ${panicCode}`;
  }

  // Custom error data
  const errorDataMatch = message.match(/data: (0x[a-f0-9]+)/i);
  if (errorDataMatch && errorDataMatch[1].length > 10) {
    // Could decode custom errors here
    return `Custom error: ${errorDataMatch[1].slice(0, 10)}...`;
  }

  return undefined;
}

/**
 * Check multiple conditions before execution (pre-flight checks)
 */
export async function preflightChecks(params: {
  userAddress: string;
  tokenAddress: string;
  spenderAddress: string;
  requiredAmount: string;
  requiredAllowance: string;
}): Promise<{
  passed: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    message: string;
  }>;
}> {
  const { userAddress, tokenAddress, spenderAddress, requiredAmount, requiredAllowance } = params;

  const checks: Array<{ name: string; passed: boolean; message: string }> = [];

  // Build multicall for balance and allowance checks
  const balanceOfSelector = keccak256(toHex('balanceOf(address)')).slice(0, 10);
  const allowanceSelector = keccak256(toHex('allowance(address,address)')).slice(0, 10);

  const calls: Call[] = [
    {
      target: tokenAddress,
      callData: balanceOfSelector + userAddress.slice(2).padStart(64, '0'),
      allowFailure: true,
    },
    {
      target: tokenAddress,
      callData:
        allowanceSelector +
        userAddress.slice(2).padStart(64, '0') +
        spenderAddress.slice(2).padStart(64, '0'),
      allowFailure: true,
    },
  ];

  const result = await multicallRead(calls);

  if (!result.success || result.results.length < 2) {
    return {
      passed: false,
      checks: [{ name: 'RPC', passed: false, message: 'Failed to fetch token data' }],
    };
  }

  // Parse balance
  const balanceResult = result.results[0];
  if (balanceResult.success && balanceResult.returnData !== '0x') {
    const balance = BigInt(balanceResult.returnData);
    const required = BigInt(requiredAmount);
    const hasSufficientBalance = balance >= required;

    checks.push({
      name: 'Balance',
      passed: hasSufficientBalance,
      message: hasSufficientBalance
        ? `Sufficient balance: ${balance.toString()}`
        : `Insufficient balance: have ${balance.toString()}, need ${required.toString()}`,
    });
  } else {
    checks.push({
      name: 'Balance',
      passed: false,
      message: 'Failed to fetch balance',
    });
  }

  // Parse allowance
  const allowanceResult = result.results[1];
  if (allowanceResult.success && allowanceResult.returnData !== '0x') {
    const allowance = BigInt(allowanceResult.returnData);
    const required = BigInt(requiredAllowance);
    const hasSufficientAllowance = allowance >= required;

    checks.push({
      name: 'Allowance',
      passed: hasSufficientAllowance,
      message: hasSufficientAllowance
        ? `Sufficient allowance: ${allowance.toString()}`
        : `Insufficient allowance: have ${allowance.toString()}, need ${required.toString()}`,
    });
  } else {
    checks.push({
      name: 'Allowance',
      passed: false,
      message: 'Failed to fetch allowance',
    });
  }

  return {
    passed: checks.every((c) => c.passed),
    checks,
  };
}

/**
 * Simulate a full execution plan
 */
export async function simulateExecutionPlan(params: {
  routerAddress: string;
  plan: {
    user: string;
    nonce: string;
    deadline: string;
    actions: Array<{
      actionType: number;
      adapter: string;
      data: string;
    }>;
  };
  value?: string;
}): Promise<TransactionSimulation> {
  const { routerAddress, plan, value = '0x0' } = params;
  const warnings: string[] = [];

  // Check deadline
  const deadlineTimestamp = parseInt(plan.deadline);
  const now = Math.floor(Date.now() / 1000);
  if (deadlineTimestamp <= now) {
    warnings.push('Plan deadline has already passed');
  } else if (deadlineTimestamp - now < 60) {
    warnings.push('Plan deadline is less than 1 minute away');
  }

  // Build executeBySender calldata
  const executeBySenderAbi = [
    {
      name: 'executeBySender',
      type: 'function',
      stateMutability: 'nonpayable',
      inputs: [
        {
          name: 'plan',
          type: 'tuple',
          components: [
            { name: 'user', type: 'address' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
            {
              name: 'actions',
              type: 'tuple[]',
              components: [
                { name: 'actionType', type: 'uint8' },
                { name: 'adapter', type: 'address' },
                { name: 'data', type: 'bytes' },
              ],
            },
          ],
        },
      ],
      outputs: [],
    },
  ] as const;

  const callData = encodeFunctionData({
    abi: executeBySenderAbi,
    functionName: 'executeBySender',
    args: [
      {
        user: plan.user as `0x${string}`,
        nonce: BigInt(plan.nonce),
        deadline: BigInt(plan.deadline),
        actions: plan.actions.map((a) => ({
          actionType: a.actionType,
          adapter: a.adapter as `0x${string}`,
          data: a.data as `0x${string}`,
        })),
      },
    ],
  });

  // Simulate the transaction
  const simulation = await simulateTransaction({
    to: routerAddress,
    data: callData,
    value,
    from: plan.user,
  });

  if (!simulation.success) {
    warnings.push(simulation.revertReason || simulation.error || 'Transaction will revert');
  }

  return {
    willSucceed: simulation.success,
    estimatedGas: simulation.gasUsed || '0',
    warnings,
  };
}

/**
 * Batch multiple token balance checks
 */
export async function batchBalanceCheck(
  tokens: Array<{ address: string; decimals: number; symbol: string }>,
  userAddress: string
): Promise<Array<{ symbol: string; balance: string; balanceFormatted: string }>> {
  const balanceOfSelector = keccak256(toHex('balanceOf(address)')).slice(0, 10);

  const calls: Call[] = tokens.map((token) => ({
    target: token.address,
    callData: balanceOfSelector + userAddress.slice(2).padStart(64, '0'),
    allowFailure: true,
  }));

  const result = await multicallRead(calls);

  return tokens.map((token, i) => {
    const callResult = result.results[i];
    if (!callResult?.success || callResult.returnData === '0x') {
      return {
        symbol: token.symbol,
        balance: '0',
        balanceFormatted: '0',
      };
    }

    const balance = BigInt(callResult.returnData);
    const { formatUnits } = require('viem');

    return {
      symbol: token.symbol,
      balance: balance.toString(),
      balanceFormatted: formatUnits(balance, token.decimals),
    };
  });
}

/**
 * Get current block number and timestamp
 */
export async function getBlockInfo(): Promise<{
  blockNumber: number;
  timestamp: number;
}> {
  const calls: Call[] = [
    {
      target: MULTICALL3_ADDRESS,
      callData: encodeFunctionData({
        abi: MULTICALL3_ABI,
        functionName: 'getBlockNumber',
        args: [],
      }),
      allowFailure: false,
    },
    {
      target: MULTICALL3_ADDRESS,
      callData: encodeFunctionData({
        abi: MULTICALL3_ABI,
        functionName: 'getCurrentBlockTimestamp',
        args: [],
      }),
      allowFailure: false,
    },
  ];

  const result = await multicallRead(calls);

  if (!result.success || result.results.length < 2) {
    throw new Error('Failed to fetch block info');
  }

  return {
    blockNumber: Number(BigInt(result.results[0].returnData)),
    timestamp: Number(BigInt(result.results[1].returnData)),
  };
}

/**
 * Export multicall address for reference
 */
export const MULTICALL_ADDRESS = MULTICALL3_ADDRESS;
