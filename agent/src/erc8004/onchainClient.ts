/**
 * ERC-8004 On-Chain Client
 *
 * Provides viem wallet and public clients for on-chain interactions
 * with the ERC-8004 Identity and Reputation registries.
 *
 * Uses RELAYER_PRIVATE_KEY for transaction signing.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
  type Address,
  type Hash,
  type TransactionReceipt,
  type Chain,
  parseGwei,
  formatGwei,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

import {
  ETH_TESTNET_RPC_URL,
  ETH_RPC_FALLBACK_URLS,
  RELAYER_PRIVATE_KEY,
} from '../config.js';

// ============================================
// Constants
// ============================================

const SEPOLIA_CHAIN_ID = 11155111;

// Gas limits for ERC-8004 operations
export const GAS_LIMITS = {
  REGISTER_AGENT: 300_000n,
  UPDATE_AGENT_URI: 100_000n,
  SUBMIT_FEEDBACK: 150_000n,
  TRANSFER_AGENT: 100_000n,
} as const;

// Default gas price multiplier for priority (1.1 = 10% tip)
const GAS_PRICE_MULTIPLIER = 1.1;

// ============================================
// Client Instances (Lazy Initialized)
// ============================================

let _publicClient: PublicClient | null = null;
let _walletClient: WalletClient | null = null;
let _account: PrivateKeyAccount | null = null;

// ============================================
// Chain Configuration
// ============================================

/**
 * Get the chain configuration for ERC-8004 operations
 * Currently only Sepolia testnet is supported
 */
export function getERC8004Chain(): Chain {
  return sepolia;
}

/**
 * Get the RPC URL for ERC-8004 operations
 */
function getRpcUrl(): string {
  if (!ETH_TESTNET_RPC_URL) {
    throw new Error(
      'ETH_TESTNET_RPC_URL is required for on-chain ERC-8004 operations. ' +
        'Please set it in your .env file.'
    );
  }
  return ETH_TESTNET_RPC_URL;
}

// ============================================
// Public Client
// ============================================

/**
 * Get the public client for read operations
 * Uses primary RPC with fallback support
 */
export function getPublicClient(): PublicClient {
  if (!_publicClient) {
    const rpcUrl = getRpcUrl();

    _publicClient = createPublicClient({
      chain: sepolia,
      transport: http(rpcUrl, {
        timeout: 30_000,
        retryCount: 3,
        retryDelay: 1000,
      }),
    });
  }
  return _publicClient;
}

// ============================================
// Wallet Client
// ============================================

/**
 * Get the relayer account for signing transactions
 */
export function getRelayerAccount(): PrivateKeyAccount {
  if (!_account) {
    if (!RELAYER_PRIVATE_KEY) {
      throw new Error(
        'RELAYER_PRIVATE_KEY is required for on-chain ERC-8004 transactions. ' +
          'Please set it in your .env file.'
      );
    }

    // Ensure private key has 0x prefix
    const key = RELAYER_PRIVATE_KEY.startsWith('0x')
      ? (RELAYER_PRIVATE_KEY as `0x${string}`)
      : (`0x${RELAYER_PRIVATE_KEY}` as `0x${string}`);

    _account = privateKeyToAccount(key);
  }
  return _account;
}

/**
 * Get the relayer address
 */
export function getRelayerAddress(): Address {
  return getRelayerAccount().address;
}

/**
 * Get the wallet client for write operations
 * Uses the relayer private key for transaction signing
 */
export function getWalletClient(): WalletClient {
  if (!_walletClient) {
    const account = getRelayerAccount();
    const rpcUrl = getRpcUrl();

    _walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(rpcUrl, {
        timeout: 30_000,
        retryCount: 2,
      }),
    });
  }
  return _walletClient;
}

// ============================================
// Gas Estimation
// ============================================

/**
 * Estimate gas price with priority fee
 * Returns both maxFeePerGas and maxPriorityFeePerGas for EIP-1559
 */
export async function estimateGasPrices(): Promise<{
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}> {
  const client = getPublicClient();

  // Get current gas price
  const gasPrice = await client.getGasPrice();

  // Get fee history for priority estimation
  const feeHistory = await client.getFeeHistory({
    blockCount: 5,
    rewardPercentiles: [25, 50, 75],
  });

  // Calculate average priority fee from recent blocks
  let avgPriorityFee = 0n;
  let count = 0;

  for (const reward of feeHistory.reward ?? []) {
    if (reward && reward[1] !== undefined) {
      avgPriorityFee += reward[1]; // median (50th percentile)
      count++;
    }
  }

  // Default to 1.5 gwei if no history
  const basePriorityFee = count > 0 ? avgPriorityFee / BigInt(count) : parseGwei('1.5');

  // Apply multiplier for faster inclusion
  const maxPriorityFeePerGas = (basePriorityFee * BigInt(Math.floor(GAS_PRICE_MULTIPLIER * 100))) / 100n;

  // Max fee = base fee * 2 + priority (buffer for base fee fluctuation)
  const baseFee = feeHistory.baseFeePerGas?.[feeHistory.baseFeePerGas.length - 1] ?? gasPrice;
  const maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;

  return {
    maxFeePerGas,
    maxPriorityFeePerGas,
  };
}

/**
 * Estimate gas for a contract call
 */
export async function estimateContractGas(params: {
  to: Address;
  data: `0x${string}`;
  value?: bigint;
}): Promise<bigint> {
  const client = getPublicClient();
  const account = getRelayerAccount();

  const gasEstimate = await client.estimateGas({
    account: account.address,
    to: params.to,
    data: params.data,
    value: params.value ?? 0n,
  });

  // Add 20% buffer for safety
  return (gasEstimate * 120n) / 100n;
}

// ============================================
// Transaction Helpers
// ============================================

/**
 * Wait for a transaction to be confirmed
 */
export async function waitForTransaction(hash: Hash): Promise<TransactionReceipt> {
  const client = getPublicClient();

  const receipt = await client.waitForTransactionReceipt({
    hash,
    confirmations: 2, // Wait for 2 confirmations
    timeout: 120_000, // 2 minute timeout
  });

  if (receipt.status === 'reverted') {
    throw new Error(`Transaction ${hash} reverted`);
  }

  return receipt;
}

/**
 * Get the current nonce for the relayer account
 */
export async function getRelayerNonce(): Promise<number> {
  const client = getPublicClient();
  const account = getRelayerAccount();

  return client.getTransactionCount({
    address: account.address,
    blockTag: 'pending',
  });
}

/**
 * Check relayer balance
 */
export async function getRelayerBalance(): Promise<bigint> {
  const client = getPublicClient();
  const account = getRelayerAccount();

  return client.getBalance({
    address: account.address,
  });
}

/**
 * Validate relayer has sufficient balance for a transaction
 */
export async function validateRelayerBalance(
  estimatedGas: bigint,
  maxFeePerGas: bigint,
  value: bigint = 0n
): Promise<void> {
  const balance = await getRelayerBalance();
  const requiredBalance = estimatedGas * maxFeePerGas + value;

  if (balance < requiredBalance) {
    const ethBalance = Number(balance) / 1e18;
    const ethRequired = Number(requiredBalance) / 1e18;
    throw new Error(
      `Insufficient relayer balance: ${ethBalance.toFixed(4)} ETH available, ` +
        `${ethRequired.toFixed(4)} ETH required. Please fund the relayer address.`
    );
  }
}

// ============================================
// Error Handling
// ============================================

/**
 * Transaction error types for ERC-8004 operations
 */
export type ERC8004TransactionError =
  | 'INSUFFICIENT_BALANCE'
  | 'GAS_ESTIMATION_FAILED'
  | 'TRANSACTION_REVERTED'
  | 'TIMEOUT'
  | 'NONCE_TOO_LOW'
  | 'REPLACEMENT_UNDERPRICED'
  | 'RPC_ERROR'
  | 'UNKNOWN';

/**
 * Parse a viem error into a transaction error type
 */
export function parseTransactionError(error: unknown): {
  type: ERC8004TransactionError;
  message: string;
} {
  const errorMessage = error instanceof Error ? error.message : String(error);

  if (errorMessage.includes('insufficient funds')) {
    return { type: 'INSUFFICIENT_BALANCE', message: 'Relayer has insufficient balance' };
  }
  if (errorMessage.includes('gas required exceeds')) {
    return { type: 'GAS_ESTIMATION_FAILED', message: 'Gas estimation failed - transaction may revert' };
  }
  if (errorMessage.includes('reverted') || errorMessage.includes('execution reverted')) {
    return { type: 'TRANSACTION_REVERTED', message: 'Transaction reverted on-chain' };
  }
  if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
    return { type: 'TIMEOUT', message: 'Transaction confirmation timed out' };
  }
  if (errorMessage.includes('nonce too low')) {
    return { type: 'NONCE_TOO_LOW', message: 'Nonce conflict - retry with correct nonce' };
  }
  if (errorMessage.includes('replacement transaction underpriced')) {
    return { type: 'REPLACEMENT_UNDERPRICED', message: 'Replacement transaction underpriced' };
  }
  if (
    errorMessage.includes('request failed') ||
    errorMessage.includes('network') ||
    errorMessage.includes('connection')
  ) {
    return { type: 'RPC_ERROR', message: 'RPC connection error' };
  }

  return { type: 'UNKNOWN', message: errorMessage };
}

// ============================================
// Client Reset (for testing)
// ============================================

/**
 * Reset all cached clients (useful for testing)
 */
export function resetClients(): void {
  _publicClient = null;
  _walletClient = null;
  _account = null;
}

// ============================================
// Health Check
// ============================================

/**
 * Check if on-chain client is properly configured and connected
 */
export async function checkOnchainHealth(): Promise<{
  healthy: boolean;
  chainId?: number;
  relayerAddress?: Address;
  relayerBalanceEth?: number;
  latencyMs?: number;
  error?: string;
}> {
  const startTime = Date.now();

  try {
    const client = getPublicClient();
    const account = getRelayerAccount();

    // Check chain ID
    const chainId = await client.getChainId();

    // Check balance
    const balance = await client.getBalance({ address: account.address });
    const balanceEth = Number(balance) / 1e18;

    const latencyMs = Date.now() - startTime;

    return {
      healthy: true,
      chainId,
      relayerAddress: account.address,
      relayerBalanceEth: balanceEth,
      latencyMs,
    };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - startTime,
    };
  }
}
