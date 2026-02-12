/**
 * ERC20 RPC Helpers
 * Read ERC20 token balance and allowance via JSON-RPC eth_call
 */

import { ETH_RPC_FALLBACK_URLS, ETH_TESTNET_RPC_URL } from '../config';

/**
 * JSON-RPC Response type
 */
type JsonRpcResponse<T = unknown> = {
  result?: T;
  error?: { message?: string; code?: number; data?: unknown };
};

type Erc20ReadOptions = {
  rpcUrls?: string[];
  timeoutMs?: number;
  retries?: number;
  retryBackoffMs?: number;
};

type Erc20ReadMeta = {
  rpcUsed: string;
  attempts: number;
  lastError?: string;
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
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeRpcUrls(options?: Erc20ReadOptions): string[] {
  const urls = [
    ...(options?.rpcUrls || []),
    ETH_TESTNET_RPC_URL || '',
    ...ETH_RPC_FALLBACK_URLS,
  ]
    .map((url) => url.trim())
    .filter((url) => /^https?:\/\//i.test(url));

  return [...new Set(urls)];
}

async function ethCallWithFallback(
  to: `0x${string}`,
  data: `0x${string}`,
  options?: Erc20ReadOptions
): Promise<{ result: string } & Erc20ReadMeta> {
  const rpcUrls = normalizeRpcUrls(options);
  if (!rpcUrls.length) {
    throw new Error('ETH_TESTNET_RPC_URL not configured');
  }

  const timeoutMs = options?.timeoutMs ?? parseInt(process.env.ERC20_RPC_TIMEOUT_MS || '10000', 10);
  const retries = Math.max(1, options?.retries ?? parseInt(process.env.ERC20_RPC_RETRIES || '3', 10));
  const baseBackoffMs = Math.max(100, options?.retryBackoffMs ?? 300);

  let attempts = 0;
  let lastError = '';
  let lastRpc = rpcUrls[0];

  for (let retry = 0; retry < retries; retry += 1) {
    for (const rpcUrl of rpcUrls) {
      attempts += 1;
      lastRpc = rpcUrl;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: attempts,
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
          throw new Error(`RPC call failed: ${response.status} ${response.statusText}`);
        }

        const jsonResult: unknown = await response.json();
        const result = jsonResult as JsonRpcResponse<string>;
        if (result.error) {
          throw new Error(`RPC error: ${result.error.message || JSON.stringify(result.error)}`);
        }

        if (!result.result) {
          return { result: '0x', rpcUsed: rpcUrl, attempts, ...(lastError ? { lastError } : {}) };
        }

        return { result: result.result, rpcUsed: rpcUrl, attempts, ...(lastError ? { lastError } : {}) };
      } catch (error: any) {
        lastError = error?.message || String(error);
      } finally {
        clearTimeout(timer);
      }
    }

    if (retry < retries - 1) {
      const jitter = Math.floor(Math.random() * 200);
      const backoffMs = Math.min(4000, baseBackoffMs * (2 ** retry)) + jitter;
      await sleep(backoffMs);
    }
  }

  const finalError: any = new Error(`Failed to fetch ERC20 data: ${lastError || 'unknown error'}`);
  finalError.rpcUsed = lastRpc;
  finalError.attempts = attempts;
  finalError.lastError = lastError;
  throw finalError;
}

export async function erc20_balanceOfWithMeta(
  token: string,
  owner: string,
  options?: Erc20ReadOptions
): Promise<{ balance: bigint; meta: Erc20ReadMeta }> {
  const { encodeFunctionData } = await import('viem');
  const to = token.toLowerCase() as `0x${string}`;
  const ownerAddr = owner.toLowerCase() as `0x${string}`;

  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [ownerAddr],
  }) as `0x${string}`;

  const call = await ethCallWithFallback(to, data, options);
  return {
    balance: decodeUint256(call.result),
    meta: {
      rpcUsed: call.rpcUsed,
      attempts: call.attempts,
      ...(call.lastError ? { lastError: call.lastError } : {}),
    },
  };
}

export async function erc20_decimalsWithMeta(
  token: string,
  options?: Erc20ReadOptions
): Promise<{ decimals: number; meta: Erc20ReadMeta }> {
  const { encodeFunctionData } = await import('viem');
  const to = token.toLowerCase() as `0x${string}`;

  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'decimals',
    args: [],
  }) as `0x${string}`;

  const call = await ethCallWithFallback(to, data, options);
  const dec = Number(decodeUint256(call.result));
  if (!Number.isFinite(dec) || dec < 0 || dec > 255) {
    throw new Error(`Invalid decimals: ${dec}`);
  }

  return {
    decimals: dec,
    meta: {
      rpcUsed: call.rpcUsed,
      attempts: call.attempts,
      ...(call.lastError ? { lastError: call.lastError } : {}),
    },
  };
}

export async function erc20_allowanceWithMeta(
  token: string,
  owner: string,
  spender: string,
  options?: Erc20ReadOptions
): Promise<{ allowance: bigint; meta: Erc20ReadMeta }> {
  const { encodeFunctionData } = await import('viem');
  const to = token.toLowerCase() as `0x${string}`;
  const ownerAddr = owner.toLowerCase() as `0x${string}`;
  const spenderAddr = spender.toLowerCase() as `0x${string}`;

  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [ownerAddr, spenderAddr],
  }) as `0x${string}`;

  const call = await ethCallWithFallback(to, data, options);
  return {
    allowance: decodeUint256(call.result),
    meta: {
      rpcUsed: call.rpcUsed,
      attempts: call.attempts,
      ...(call.lastError ? { lastError: call.lastError } : {}),
    },
  };
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
  const { balance } = await erc20_balanceOfWithMeta(token, owner);
  return balance;
}

/**
 * Get ERC20 token decimals
 * @param token Token contract address
 * @returns Token decimals as number
 */
export async function erc20_decimals(token: string): Promise<number> {
  const { decimals } = await erc20_decimalsWithMeta(token);
  return decimals;
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
  const { allowance } = await erc20_allowanceWithMeta(token, owner, spender);
  return allowance;
}
