/**
 * Relayer
 * Sends transactions on behalf of users using session permissions.
 */

import { DEFAULT_SETTLEMENT_CHAIN } from '../config';
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getSettlementChainRuntimeConfig, normalizeSettlementChain, type SettlementChain } from '../config/settlementChains';

type RelayerErrorBucket =
  | 'relayer_low_balance'
  | 'relayer_topup_failed'
  | 'nonce_collision'
  | 'rpc_rate_limit'
  | 'execution_revert'
  | 'unknown';

let relayerSendLock: Promise<void> = Promise.resolve();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withPgAdvisoryLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (!process.env.DATABASE_URL) {
    return fn();
  }

  try {
    const { getPgPool } = await import('../../execution-ledger/db-pg-client');
    const pool = getPgPool();
    const client = await pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock(hashtext($1)::bigint)', [key]);
      return await fn();
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtext($1)::bigint)', [key]);
      } catch {
        // best-effort unlock
      }
      client.release();
    }
  } catch {
    // Fail open if Postgres isn't available, rely on in-process lock.
    return fn();
  }
}

function getMaxRelayerGasLimit(): bigint {
  const raw = String(process.env.RELAYER_MAX_GAS_LIMIT || '').trim();
  const parsed = raw ? Number(raw) : NaN;
  // Default below block gas limit so the node doesn't require an outsized balance pre-check.
  const fallback = 6_000_000;
  if (Number.isFinite(parsed) && parsed > 50_000) {
    return BigInt(Math.floor(parsed));
  }
  return BigInt(fallback);
}

function withRelayerSendLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = relayerSendLock;
  let release: () => void = () => {};
  relayerSendLock = new Promise<void>((resolve) => {
    release = resolve;
  });

  return previous
    .catch(() => undefined)
    .then(fn)
    .finally(() => {
      release();
    });
}

export async function withRelayerNonceLock<T>(
  fn: (accountAddress: `0x${string}`) => Promise<T>,
  chainInput?: string
): Promise<T> {
  const chain = normalizeSettlementChain(chainInput || DEFAULT_SETTLEMENT_CHAIN);
  const chainConfig = getSettlementChainRuntimeConfig(chain);
  if (!chainConfig.relayerPrivateKey) {
    throw new Error(`RELAYER_PRIVATE_KEY is required for relayer nonce lock (${chainConfig.label})`);
  }
  const account = privateKeyToAccount(chainConfig.relayerPrivateKey as `0x${string}`);
  const lockKey = `relayer:${chain}:${account.address.toLowerCase()}`;

  return withRelayerSendLock(() => withPgAdvisoryLock(lockKey, () => fn(account.address)));
}

export function classifyRelayerErrorBucket(error: any): RelayerErrorBucket {
  const message = String(error?.message || error || '').toLowerCase();

  if (
    message.includes('insufficient eth') ||
    message.includes('insufficient funds') ||
    message.includes('relayer_low_balance')
  ) {
    return 'relayer_low_balance';
  }

  if (message.includes('topup') || message.includes('funding wallet')) {
    return 'relayer_topup_failed';
  }

  if (
    message.includes('nonce too low') ||
    message.includes('replacement transaction underpriced') ||
    message.includes('already known') ||
    message.includes('nonce')
  ) {
    return 'nonce_collision';
  }

  if (
    message.includes('rate limit') ||
    message.includes('429') ||
    message.includes('too many requests') ||
    message.includes('request exceeds')
  ) {
    return 'rpc_rate_limit';
  }

  if (
    message.includes('execution reverted') ||
    message.includes('gas estimation failed') ||
    message.includes('revert')
  ) {
    return 'execution_revert';
  }

  return 'unknown';
}

function toRelayerError(error: any, bucket: RelayerErrorBucket): Error {
  const message = error?.message || 'Unknown relayer error';
  const wrapped = new Error(`Relayed transaction failed [${bucket}]: ${message}`) as Error & {
    code?: string;
    bucket?: RelayerErrorBucket;
  };
  wrapped.code = bucket.toUpperCase();
  wrapped.bucket = bucket;
  return wrapped;
}

/**
 * Send a relayed transaction using the relayer's private key.
 * Adds mutex + retry safeguards to avoid nonce collisions under concurrency.
 */
export async function sendRelayedTx({
  to,
  data,
  value = '0x0',
  chain: chainInput,
}: {
  to: string;
  data: string;
  value?: string;
  chain?: string;
}): Promise<string> {
  const chain = normalizeSettlementChain(chainInput || DEFAULT_SETTLEMENT_CHAIN);
  const chainConfig = getSettlementChainRuntimeConfig(chain);
  return withRelayerNonceLock(async () => {
    if (!chainConfig.relayerPrivateKey) {
      throw new Error(`RELAYER_PRIVATE_KEY is required for relayed execution (${chainConfig.label})`);
    }

    if (!chainConfig.rpcUrl) {
      throw new Error(`${chainConfig.label} RPC URL is required for relayed execution`);
    }

    const { maybeTopUpRelayer } = await import('../services/relayerTopUp');
    void maybeTopUpRelayer(chain, {
      reason: 'before_relayed_send',
      fireAndForget: true,
    });

    const account = privateKeyToAccount(chainConfig.relayerPrivateKey as `0x${string}`);

    const walletClient = createWalletClient({
      account,
      chain: chainConfig.chain,
      transport: http(chainConfig.rpcUrl),
    });

    const publicClient = createPublicClient({
      chain: chainConfig.chain,
      transport: http(chainConfig.rpcUrl),
    });

    const maxGasLimit = getMaxRelayerGasLimit();
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        let gasLimit: bigint;
        try {
          const estimatedGas = await publicClient.estimateGas({
            to: to as `0x${string}`,
            data: data as `0x${string}`,
            value: BigInt(value),
            account,
          });
          gasLimit = (estimatedGas * 120n) / 100n;
          if (gasLimit > maxGasLimit) gasLimit = maxGasLimit;
        } catch (estimateError: any) {
          throw new Error(`Gas estimation failed: ${estimateError.message}`);
        }

        const relayerBalance = await publicClient.getBalance({
          address: account.address,
        });
        const gasPrice = await publicClient.getGasPrice();
        const estimatedCost = gasLimit * gasPrice;
        const minBuffer = parseEther('0.002');
        const required = estimatedCost + minBuffer;

        if (relayerBalance < required) {
          const topup = await maybeTopUpRelayer(chain, {
            reason: 'relayer_low_balance_send_retry',
          });

          const updatedBalance = await publicClient.getBalance({
            address: account.address,
          });

          if (updatedBalance < required) {
            const topupReason = topup.error || topup.reason || 'topup_unavailable';
            const missing = formatEther(required - updatedBalance);
            throw new Error(
              `RELAYER_LOW_BALANCE: relayer has insufficient ETH for gas. Missing ~${missing} ETH (${topupReason})`
            );
          }
        }

        const hash = await walletClient.sendTransaction({
          to: to as `0x${string}`,
          data: data as `0x${string}`,
          value: BigInt(value),
          gas: gasLimit,
        });

        console.log('[relayer] Sent relayed transaction:', {
          to,
          hash,
          from: account.address,
          chain,
          attempt: attempt + 1,
        });

        return hash;
      } catch (rawError: any) {
        const bucket = classifyRelayerErrorBucket(rawError);
        const message = String(rawError?.message || rawError || '');

        const retryable =
          bucket === 'nonce_collision' ||
          bucket === 'rpc_rate_limit' ||
          bucket === 'relayer_low_balance' ||
          (bucket === 'relayer_topup_failed' && attempt < maxAttempts - 1);

        if (retryable && attempt < maxAttempts - 1) {
          const backoff = Math.min(6000, 400 * 2 ** attempt) + Math.floor(Math.random() * 300);
          console.warn('[relayer] Retryable relayer error, backing off', {
            bucket,
            attempt: attempt + 1,
            backoffMs: backoff,
            message,
          });

          if (bucket === 'relayer_low_balance') {
            void maybeTopUpRelayer(chain, {
              reason: 'retry_after_low_balance',
              fireAndForget: true,
            });
          }

          await sleep(backoff);
          continue;
        }

        console.error('[relayer] Failed to send relayed transaction:', {
          bucket,
          message,
          attempt: attempt + 1,
        });

        throw toRelayerError(rawError, bucket);
      }
    }

    throw new Error('Relayed transaction failed: exhausted retries');
  }, chain);
}
