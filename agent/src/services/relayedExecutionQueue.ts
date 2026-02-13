import { DEFAULT_SETTLEMENT_CHAIN, WALLET_FALLBACK_ENABLED } from '../config';
import { getRelayerStatus, maybeTopUpRelayer } from './relayerTopUp';
import { normalizeSettlementChain, type SettlementChain } from '../config/settlementChains';

export type QueueState = 'queued' | 'executing' | 'completed' | 'expired' | 'failed';

export type WalletFallbackTx = {
  to: string;
  data: string;
  value?: string;
  gas?: string | number;
};

type QueueResponse = {
  statusCode: number;
  body: Record<string, any>;
};

type QueueItem = {
  key: string;
  correlationId: string;
  requestId: string;
  createdAt: number;
  expiresAt: number;
  state: QueueState;
  attempts: number;
  lastError?: string;
  result?: Record<string, any>;
  walletFallbackTx?: WalletFallbackTx;
  chain: SettlementChain;
  run: () => Promise<Record<string, any>>;
};

const DEFAULT_MAX_QUEUE_MS = 120_000;
const PROCESS_INTERVAL_MS = 3_000;
const PROCESS_TIMEOUT_MS = 75_000;
const GC_RETENTION_MS = 10 * 60 * 1000;

const queueByKey = new Map<string, QueueItem>();
let loopStarted = false;
let loopInProgress = false;

function nowMs() {
  return Date.now();
}

function isRetryableRelayerError(message: string): boolean {
  const lower = String(message || '').toLowerCase();
  return (
    lower.includes('relayer_low_balance') ||
    lower.includes('insufficient eth') ||
    lower.includes('insufficient funds') ||
    lower.includes('gas') ||
    lower.includes('rate limit') ||
    lower.includes('429') ||
    lower.includes('nonce') ||
    lower.includes('replacement underpriced') ||
    lower.includes('already known')
  );
}

function buildQueuedBody(item: QueueItem): Record<string, any> {
  return {
    ok: true,
    status: 'queued',
    queued: true,
    reason: 'relayer_low_balance',
    machine: { queued: true, reason: 'relayer_low_balance' },
    message: 'Execution queued... preparing relayer capacity.',
    queue: {
      requestId: item.requestId,
      state: item.state,
      attempts: item.attempts,
      expiresAt: item.expiresAt,
    },
  };
}

function buildExpiredBody(item: QueueItem): Record<string, any> {
  if (WALLET_FALLBACK_ENABLED && item.walletFallbackTx) {
    return {
      ok: false,
      status: 'failed',
      queued: false,
      reason: 'relayer_low_balance_timeout',
      machine: { queued: false, reason: 'relayer_low_balance_timeout' },
      mode: 'wallet_fallback',
      message: 'Relayer capacity unavailable. Sign once in wallet to execute now.',
      execution: {
        mode: 'wallet_fallback',
        chain: item.chain,
        tx: item.walletFallbackTx,
      },
      errorCode: 'NEEDS_WALLET_SIGNATURE',
      needs_wallet_signature: true,
      queue: {
        requestId: item.requestId,
        state: item.state,
        attempts: item.attempts,
      },
    };
  }

  return {
    ok: false,
    status: 'failed',
    queued: false,
    reason: 'relayer_low_balance_timeout',
    machine: { queued: false, reason: 'relayer_low_balance_timeout' },
    errorCode: 'RELAYER_QUEUE_TIMEOUT',
    error: 'Execution queue timed out while waiting for relayer funding.',
    queue: {
      requestId: item.requestId,
      state: item.state,
      attempts: item.attempts,
    },
  };
}

function buildFailedBody(item: QueueItem): Record<string, any> {
  return {
    ok: false,
    status: 'failed',
    queued: false,
    reason: 'queue_execution_failed',
    machine: { queued: false, reason: 'queue_execution_failed' },
    errorCode: 'RELAYER_QUEUE_FAILED',
    error: item.lastError || 'Queued execution failed',
    queue: {
      requestId: item.requestId,
      state: item.state,
      attempts: item.attempts,
    },
  };
}

async function processQueueOnce(): Promise<void> {
  if (loopInProgress) {
    return;
  }
  loopInProgress = true;

  try {
    const now = nowMs();
    for (const [key, item] of queueByKey.entries()) {
      if (item.state === 'completed' || item.state === 'failed' || item.state === 'expired') {
        if (now - item.createdAt > GC_RETENTION_MS) {
          queueByKey.delete(key);
        }
        continue;
      }

      if (now > item.expiresAt) {
        item.state = 'expired';
        item.lastError = 'Queue timeout exceeded';
        continue;
      }

      if (item.state !== 'queued') {
        continue;
      }

      const relayerStatus = await getRelayerStatus(item.chain);
      if (!relayerStatus.relayer.okToExecute) {
        void maybeTopUpRelayer(item.chain, {
          reason: 'queued_execution_waiting_for_relayer',
          fireAndForget: true,
        });
        continue;
      }

      item.state = 'executing';
      item.attempts += 1;

      try {
        const result = await Promise.race([
          item.run(),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Queued execution timed out')), PROCESS_TIMEOUT_MS);
          }),
        ]);

        item.result = result;
        item.state = 'completed';
        item.lastError = undefined;
      } catch (error: any) {
        const message = error?.message || 'Queued execution failed';
        item.lastError = message;

        if (isRetryableRelayerError(message)) {
          item.state = 'queued';
          if (message.toLowerCase().includes('relayer') || message.toLowerCase().includes('insufficient')) {
            void maybeTopUpRelayer(item.chain, {
              reason: 'queued_retry_after_failure',
              fireAndForget: true,
            });
          }
        } else {
          item.state = 'failed';
        }
      }
    }
  } finally {
    loopInProgress = false;
  }
}

function ensureLoopStarted() {
  if (loopStarted) {
    return;
  }
  loopStarted = true;

  const timer = setInterval(() => {
    void processQueueOnce();
  }, PROCESS_INTERVAL_MS);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}

export function buildRelayedQueueKey(input: {
  draftId?: string;
  userAddress?: string;
  sessionId?: string;
  nonce?: string | number;
}): string {
  const safeDraft = String(input.draftId || '').trim();
  if (safeDraft) {
    return `draft:${safeDraft}`;
  }

  const user = String(input.userAddress || '').toLowerCase();
  const session = String(input.sessionId || '').toLowerCase();
  const nonce = String(input.nonce || 'na');
  return `session:${session}:user:${user}:nonce:${nonce}`;
}

export function getRelayedExecutionQueueResponse(key: string): QueueResponse | null {
  const item = queueByKey.get(key);
  if (!item) {
    return null;
  }

  if (item.state === 'completed') {
    return {
      statusCode: 200,
      body: {
        ok: true,
        queued: false,
        status: item.result?.status || 'success',
        ...item.result,
      },
    };
  }

  if (item.state === 'expired') {
    return {
      statusCode: WALLET_FALLBACK_ENABLED && item.walletFallbackTx ? 409 : 503,
      body: buildExpiredBody(item),
    };
  }

  if (item.state === 'failed') {
    return {
      statusCode: 500,
      body: buildFailedBody(item),
    };
  }

  return {
    statusCode: 202,
    body: buildQueuedBody(item),
  };
}

export function enqueueRelayedExecution(params: {
  key: string;
  correlationId: string;
  requestId: string;
  run: () => Promise<Record<string, any>>;
  walletFallbackTx?: WalletFallbackTx;
  maxQueueMs?: number;
  chain?: string;
}): QueueItem {
  const existing = queueByKey.get(params.key);
  if (existing && (existing.state === 'queued' || existing.state === 'executing')) {
    return existing;
  }

  const createdAt = nowMs();
  const item: QueueItem = {
    key: params.key,
    correlationId: params.correlationId,
    requestId: params.requestId,
    createdAt,
    expiresAt: createdAt + (params.maxQueueMs || DEFAULT_MAX_QUEUE_MS),
    state: 'queued',
    attempts: 0,
    chain: normalizeSettlementChain(params.chain || DEFAULT_SETTLEMENT_CHAIN),
    run: params.run,
    walletFallbackTx: params.walletFallbackTx,
  };

  queueByKey.set(params.key, item);
  ensureLoopStarted();
  void processQueueOnce();

  return item;
}
