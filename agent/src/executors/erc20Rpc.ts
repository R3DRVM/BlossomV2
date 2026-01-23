/**
 * ERC20 RPC Helpers
 * Read ERC20 token balance and allowance via JSON-RPC eth_call
 */

import { ETH_TESTNET_RPC_URL } from '../config';

/**
 * JSON-RPC Response type
 */
type JsonRpcResponse<T = unknown> = {
  result?: T;
  error?: { message?: string; code?: number; data?: unknown };
};

/**
 * ERC20 ABI for balanceOf and allowance
 */
const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

/**
 * Decode uint256 from hex response
 */
function decodeUint256(hex: string): bigint {
  if (!hex || hex === '0x') {
    return 0n;
  }
  return BigInt(hex);
}

/**
 * Get ERC20 token balance for an address
 * @param token Token contract address
 * @param owner Owner address
 * @returns Token balance as bigint
 */
export async function erc20_balanceOf(
  token: string,
  owner: string
): Promise<bigint> {
  if (!ETH_TESTNET_RPC_URL) {
    throw new Error('ETH_TESTNET_RPC_URL not configured');
  }

  const { encodeFunctionData } = await import('viem');
  const to = token.toLowerCase() as `0x${string}`;
  const ownerAddr = owner.toLowerCase() as `0x${string}`;

  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [ownerAddr],
  });

  // Debug log (no secrets)
  console.log(`[erc20Rpc] balanceOf: token=${to.substring(0, 10)}..., owner=${ownerAddr.substring(0, 10)}..., data=${data.substring(0, 10)}...`);

  try {
    const response = await fetch(ETH_TESTNET_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [
          {
            to,
            data,
          },
          'latest',
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`RPC call failed: ${response.statusText}`);
    }

    const result = await response.json();

    if (result.error) {
      throw new Error(`RPC error: ${result.error.message || JSON.stringify(result.error)}`);
    }

    return decodeUint256(result.result);
  } catch (error: any) {
    throw new Error(`Failed to fetch ERC20 balance: ${error.message}`);
  }
}

/**
 * Get ERC20 token allowance for a spender
 * @param token Token contract address
 * @param owner Owner address
 * @param spender Spender address
 * @returns Token allowance as bigint
 */
export async function erc20_allowance(
  token: string,
  owner: string,
  spender: string
): Promise<bigint> {
  if (!ETH_TESTNET_RPC_URL) {
    throw new Error('ETH_TESTNET_RPC_URL not configured');
  }

  const { encodeFunctionData } = await import('viem');
  const to = token.toLowerCase() as `0x${string}`;
  const ownerAddr = owner.toLowerCase() as `0x${string}`;
  const spenderAddr = spender.toLowerCase() as `0x${string}`;

  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [ownerAddr, spenderAddr],
  });

  // Debug log (no secrets)
  console.log(`[erc20Rpc] allowance: token=${to.substring(0, 10)}..., owner=${ownerAddr.substring(0, 10)}..., spender=${spenderAddr.substring(0, 10)}..., data=${data.substring(0, 10)}...`);

  try {
    const response = await fetch(ETH_TESTNET_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [
          {
            to,
            data,
          },
          'latest',
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`RPC call failed: ${response.statusText}`);
    }

    const jsonResult: unknown = await response.json();
    const result = jsonResult as JsonRpcResponse<string>;

    if (result.error) {
      throw new Error(`RPC error: ${result.error.message || JSON.stringify(result.error)}`);
    }

    if (!result.result) {
      throw new Error('RPC response missing result field');
    }

    return decodeUint256(result.result);
  } catch (error: any) {
    throw new Error(`Failed to fetch ERC20 allowance: ${error.message}`);
  }
}


