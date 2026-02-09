#!/usr/bin/env npx tsx
// @ts-nocheck
/**
 * Live Stress Tester (Curated)
 *
 * Runs a curated multi-step stress test against Vercel production.
 * - 4 agents (2 human-like, 2 ERC-8004-like)
 * - 100 sessions by default, concurrency=2
 * - Executes swaps, deposits, perps, events, bridges, leverage changes
 * - Includes access gate check, mint step, and multi-turn chat
 *
 * Usage:
 *   npx tsx agent/scripts/live-stress-tester.ts --baseUrl=https://api.blossom.onl --count=100 --concurrency=2
 *   npx tsx agent/scripts/live-stress-tester.ts --accessCode=XYZ --ledgerSecret=... --output=./live-stress-results.json
 *   npx tsx agent/scripts/live-stress-tester.ts --dry-run
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs';

type AgentType = 'human' | 'erc8004';
type Chain = 'ethereum' | 'solana' | 'hyperliquid' | 'both';
type Category =
  | 'swap'
  | 'deposit'
  | 'perp'
  | 'perp_market'
  | 'perp_close'
  | 'event'
  | 'event_close'
  | 'bridge'
  | 'leverage'
  | 'chat'
  | 'mint'
  | 'session'
  | 'plan'
  | 'confirm'
  | 'validate'
  | 'reset';

type Action = {
  id: string;
  category: Category;
  chain: Chain;
  intentText?: string;
  metadata?: Record<string, any>;
};

type ActionResult = {
  actionId: string;
  category: Category;
  chain: Chain;
  status: 'ok' | 'fail' | 'skipped';
  latencyMs: number;
  error?: string;
  txHash?: string;
  signature?: string;
  intentId?: string;
};

type SessionResult = {
  sessionId: string;
  agentId: string;
  agentType: AgentType;
  ok: boolean;
  actions: ActionResult[];
  startedAt: number;
  finishedAt: number;
};

type AgentState = {
  id: string;
  type: AgentType;
  cookie?: string;
  accessOk?: boolean;
  walletAddress?: string;
  sessionId?: string;
  privateKey?: string;
};

const args = process.argv.slice(2);
const arg = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const hasFlag = (name: string) => args.includes(`--${name}`);

const BASE_URL = arg('baseUrl') || process.env.BASE_URL || 'https://api.blossom.onl';
const COUNT = parseInt(arg('count') || process.env.STRESS_COUNT || '100', 10);
const CONCURRENCY = parseInt(arg('concurrency') || process.env.STRESS_CONCURRENCY || '2', 10);
const OUTPUT_FILE = arg('output') || process.env.STRESS_OUTPUT || '';
const ACCESS_CODE = arg('accessCode') || process.env.ACCESS_CODE || process.env.BLOSSOM_ACCESS_CODE || '';
const LEDGER_SECRET = arg('ledgerSecret') || process.env.DEV_LEDGER_SECRET || process.env.LEDGER_SECRET || '';
const DRY_RUN = hasFlag('dry-run');
const VERBOSE = hasFlag('verbose');
const ALLOW_NON_PROD = hasFlag('allow-non-prod') || process.env.ALLOW_NON_PROD === '1';
const MINT_CHAINS_RAW = arg('mint-chains') || process.env.STRESS_MINT_CHAINS || 'ethereum,solana,hyperliquid';
const MINT_CHAINS = MINT_CHAINS_RAW.split(',').map(s => s.trim()).filter(Boolean) as Chain[];
const SWAP_CHAINS_RAW = arg('swap-chains') || process.env.STRESS_SWAP_CHAINS || 'ethereum,solana';
const SWAP_CHAINS = SWAP_CHAINS_RAW.split(',').map(s => s.trim()).filter(Boolean) as Chain[];
const WALLET_LIST_RAW = arg('wallets') || process.env.STRESS_TEST_WALLET_ADDRESSES || '';
const WALLET_LIST = WALLET_LIST_RAW.split(',').map(s => s.trim()).filter(Boolean);
const WALLET_KEYS_RAW = arg('wallet-keys') || process.env.STRESS_TEST_WALLET_PRIVATE_KEYS || '';
const WALLET_KEYS = WALLET_KEYS_RAW.split(',').map(s => s.trim()).filter(Boolean);
const ETH_RPC_URL = arg('eth-rpc') || process.env.STRESS_TEST_ETH_RPC_URL || process.env.ETH_TESTNET_RPC_URL || '';

const STRESS_EVM_ADDRESS = process.env.STRESS_TEST_EVM_ADDRESS || process.env.TEST_WALLET_ADDRESS || process.env.RELAYER_PUBLIC_ADDRESS || '';
const STRESS_SOLANA_ADDRESS = process.env.STRESS_TEST_SOLANA_ADDRESS || '';
const STRESS_HYPERLIQUID_ADDRESS = process.env.STRESS_TEST_HYPERLIQUID_ADDRESS || STRESS_EVM_ADDRESS;

const RUN_ID = `live_stress_${Date.now()}_${randomUUID().slice(0, 8)}`;

const agents: AgentState[] = [
  { id: 'human-1', type: 'human' },
  { id: 'human-2', type: 'human' },
  { id: 'erc8004-1', type: 'erc8004' },
  { id: 'erc8004-2', type: 'erc8004' },
];

agents.forEach((agent, index) => {
  if (WALLET_KEYS[index]) {
    agent.privateKey = WALLET_KEYS[index];
  }
  if (WALLET_LIST[index]) {
    agent.walletAddress = WALLET_LIST[index];
  } else if (STRESS_EVM_ADDRESS) {
    agent.walletAddress = STRESS_EVM_ADDRESS;
  }
});

if (!ALLOW_NON_PROD && !BASE_URL.includes('blossom.onl') && !BASE_URL.includes('vercel.app')) {
  console.error(`❌ Refusing to run against non-prod baseUrl: ${BASE_URL}`);
  console.error('   Use --allow-non-prod to override.');
  process.exit(1);
}

if (!LEDGER_SECRET && !DRY_RUN) {
  console.error('❌ DEV_LEDGER_SECRET (or --ledgerSecret) is required to run live executions.');
  process.exit(1);
}

function log(msg: string) {
  console.log(msg);
}

function logVerbose(msg: string) {
  if (VERBOSE) console.log(msg);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(items: T[]): T {
  return items[randInt(0, items.length - 1)];
}

function buildActionId(category: Category, sessionIndex: number) {
  return `${category}_${sessionIndex}_${randomUUID().slice(0, 6)}`;
}

function buildHeaders(agent: AgentState): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (agent.cookie) headers['cookie'] = agent.cookie;
  if (agent.walletAddress) headers['x-wallet-address'] = agent.walletAddress;
  return headers;
}

async function getWalletClient(agent: AgentState) {
  if (!agent.privateKey) return null;
  if (!ETH_RPC_URL) return null;
  try {
    const { createWalletClient, createPublicClient, http } = await import('viem');
    const { sepolia } = await import('viem/chains');
    const { privateKeyToAccount } = await import('viem/accounts');
    const account = privateKeyToAccount(agent.privateKey as `0x${string}`);
    const publicClient = createPublicClient({ chain: sepolia, transport: http(ETH_RPC_URL) });
    const walletClient = createWalletClient({ account, chain: sepolia, transport: http(ETH_RPC_URL) });
    return { publicClient, walletClient, account };
  } catch (err) {
    return null;
  }
}

function buildSwapAction(sessionIndex: number): Action {
  const chain: Chain = pick(SWAP_CHAINS.length ? SWAP_CHAINS : ['ethereum']);
  const amount = randInt(10, 50);
  const asset = chain === 'solana' ? 'SOL' : 'WETH';
  const chainHint = chain === 'solana' ? ' on Solana' : '';
  return {
    id: buildActionId('swap', sessionIndex),
    category: 'swap',
    chain,
    intentText: `Swap ${amount} bUSDC to ${asset}${chainHint}`,
  };
}

function buildDepositAction(sessionIndex: number): Action {
  const chainCycle = sessionIndex % 3;
  const chain: Chain = chainCycle === 0 ? 'ethereum' : chainCycle === 1 ? 'solana' : 'hyperliquid';
  const amount = randInt(50, 100);
  const venue = chain === 'ethereum' ? 'Aave' : chain === 'solana' ? 'Solana vault' : 'Hyperliquid vault';
  const chainHint = chain === 'ethereum' ? '' : ` on ${chain === 'solana' ? 'Solana' : 'Hyperliquid'}`;
  return {
    id: buildActionId('deposit', sessionIndex),
    category: 'deposit',
    chain,
    intentText: `Deposit ${amount} bUSDC to ${venue}${chainHint}`,
  };
}

function buildPerpOpenAction(sessionIndex: number): Action {
  const amount = randInt(50, 200);
  const leverage = randInt(3, 10);
  const direction = sessionIndex % 2 === 0 ? 'long' : 'short';
  const asset = sessionIndex % 2 === 0 ? 'BTC' : 'ETH';
  return {
    id: buildActionId('perp', sessionIndex),
    category: 'perp',
    chain: 'hyperliquid',
    intentText: `Open ${direction} ${asset} perp ${leverage}x for $${amount} on Hyperliquid`,
  };
}

function buildPerpCloseAction(sessionIndex: number): Action {
  const asset = sessionIndex % 2 === 0 ? 'BTC' : 'ETH';
  return {
    id: buildActionId('perp_close', sessionIndex),
    category: 'perp_close',
    chain: 'hyperliquid',
    intentText: `Close my ${asset} perp position on Hyperliquid`,
  };
}

function buildPerpMarketCreateAction(sessionIndex: number): Action {
  const market = sessionIndex % 2 === 0 ? 'TESTMEME' : 'BLOSSOM';
  return {
    id: buildActionId('perp_market', sessionIndex),
    category: 'perp_market',
    chain: 'hyperliquid',
    intentText: `Create perp market ${market}/bUSDC on Hyperliquid (HIP-3)`,
  };
}

function buildEventOpenAction(sessionIndex: number): Action {
  const amount = randInt(20, 100);
  const side = sessionIndex % 2 === 0 ? 'YES' : 'NO';
  return {
    id: buildActionId('event', sessionIndex),
    category: 'event',
    chain: 'ethereum',
    intentText: `Take ${side} on Fed rate cut with $${amount}`,
  };
}

function buildEventCloseAction(sessionIndex: number): Action {
  return {
    id: buildActionId('event_close', sessionIndex),
    category: 'event_close',
    chain: 'ethereum',
    intentText: 'Close my Fed rate cut event position',
  };
}

function buildBridgeAction(sessionIndex: number): Action {
  const amount = randInt(1, 5);
  const fromSol = sessionIndex % 2 === 0;
  const from = fromSol ? 'Solana' : 'Sepolia';
  const to = fromSol ? 'Sepolia' : 'Solana';
  return {
    id: buildActionId('bridge', sessionIndex),
    category: 'bridge',
    chain: 'both',
    intentText: `Bridge ${amount} bUSDC from ${from} to ${to}`,
  };
}

function buildLeverageChangeAction(sessionIndex: number): Action {
  const leverage = pick([3, 5, 7, 10]);
  return {
    id: buildActionId('leverage', sessionIndex),
    category: 'leverage',
    chain: 'hyperliquid',
    intentText: `Change position leverage to ${leverage}x on Hyperliquid`,
  };
}

function buildSessionActions(sessionIndex: number): Action[] {
  const actions: Action[] = [];
  actions.push(buildSwapAction(sessionIndex));
  actions.push(buildDepositAction(sessionIndex));
  actions.push(buildEventOpenAction(sessionIndex));

  if (sessionIndex % 2 === 0) {
    actions.push(buildPerpOpenAction(sessionIndex));
    actions.push(buildPerpCloseAction(sessionIndex));
  } else {
    actions.push(buildPerpMarketCreateAction(sessionIndex));
  }

  if (sessionIndex % 4 === 0) {
    actions.push(buildBridgeAction(sessionIndex));
  }

  if (sessionIndex % 5 === 0) {
    actions.push(buildLeverageChangeAction(sessionIndex));
  }

  actions.push(buildEventCloseAction(sessionIndex));
  return actions;
}

async function fetchJson(path: string, options: any = {}, timeoutMs = 45000) {
  const url = `${BASE_URL.replace(/\/$/, '')}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch (err) {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, text, headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

function extractCookie(headers: Headers): string | undefined {
  const raw = headers.get('set-cookie');
  if (!raw) return undefined;
  return raw.split(',')[0]?.split(';')[0];
}

async function ensureAccess(agent: AgentState): Promise<void> {
  if (agent.accessOk) return;

  const status = await fetchJson('/api/access/status', { method: 'GET' });
  if (status.ok && status.json?.authorized) {
    agent.accessOk = true;
    return;
  }

  if (!ACCESS_CODE) {
    log(`⚠️  Access gate enabled but no ACCESS_CODE provided for ${agent.id}.`);
    return;
  }

  const res = await fetchJson('/api/access/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: ACCESS_CODE }),
  });

  if (res.ok && (res.json?.authorized || res.json?.valid)) {
    agent.accessOk = true;
    const cookie = extractCookie(res.headers);
    if (cookie) {
      agent.cookie = cookie;
      logVerbose(`[access] ${agent.id} gate pass issued.`);
    }
    return;
  }

  log(`⚠️  Access code failed for ${agent.id}: ${res.json?.error || res.text}`);
}

function buildMintPayload(chain: Chain) {
  const amount = randInt(100, 500);
  if (chain === 'solana') {
    if (!STRESS_SOLANA_ADDRESS) return null;
    return { userAddress: STRESS_SOLANA_ADDRESS, solanaAddress: STRESS_SOLANA_ADDRESS, chain: 'solana', amount };
  }
  if (chain === 'hyperliquid') {
    if (!STRESS_HYPERLIQUID_ADDRESS) return null;
    return { userAddress: STRESS_HYPERLIQUID_ADDRESS, chain: 'hyperliquid', amount };
  }
  if (!STRESS_EVM_ADDRESS) return null;
  return { userAddress: STRESS_EVM_ADDRESS, chain: 'ethereum', amount };
}

async function runMint(agent: AgentState, sessionId: string, chain: Chain): Promise<ActionResult> {
  const actionId = buildActionId('mint', 0);
  const started = Date.now();

  const payload = buildMintPayload(chain);
  if (!payload) {
    return {
      actionId,
      category: 'mint',
      chain,
      status: 'skipped',
      latencyMs: Date.now() - started,
      error: `Missing mint address for ${chain}`,
    };
  }

  if (DRY_RUN) {
    return {
      actionId,
      category: 'mint',
      chain,
      status: 'skipped',
      latencyMs: Date.now() - started,
      error: 'dry-run',
    };
  }

  const headers = buildHeaders(agent);

  const res = await fetchJson('/api/mint-busdc', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const latency = Date.now() - started;
  if (res.ok && res.json?.ok) {
    return {
      actionId,
      category: 'mint',
      chain,
      status: 'ok',
      latencyMs: latency,
      txHash: res.json?.txHash,
      signature: res.json?.signature,
    };
  }

  const errorMessage = res.json?.details || res.json?.error || res.text || 'mint failed';
  const normalizedError = `${errorMessage}`.toLowerCase();
  if (normalizedError.includes('not configured') || normalizedError.includes('not available')) {
    return {
      actionId,
      category: 'mint',
      chain,
      status: 'skipped',
      latencyMs: latency,
      error: errorMessage,
    };
  }

  return {
    actionId,
    category: 'mint',
    chain,
    status: 'fail',
    latencyMs: latency,
    error: errorMessage,
  };
}

async function runChat(agent: AgentState, sessionId: string, message: string): Promise<ActionResult> {
  const actionId = buildActionId('chat', 0);
  const started = Date.now();

  if (DRY_RUN) {
    return {
      actionId,
      category: 'chat',
      chain: 'ethereum',
      status: 'skipped',
      latencyMs: Date.now() - started,
      error: 'dry-run',
    };
  }

  const headers = buildHeaders(agent);

  const res = await fetchJson('/api/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify({ userMessage: message }),
  }, 60000);

  const latency = Date.now() - started;
  if (res.ok) {
    return {
      actionId,
      category: 'chat',
      chain: 'ethereum',
      status: 'ok',
      latencyMs: latency,
    };
  }

  return {
    actionId,
    category: 'chat',
    chain: 'ethereum',
    status: 'fail',
    latencyMs: latency,
    error: res.json?.error || res.text || 'chat failed',
  };
}

async function executeIntent(agent: AgentState, sessionId: string, action: Action, options?: { planOnly?: boolean; intentId?: string }): Promise<ActionResult> {
  const started = Date.now();

  if (DRY_RUN) {
    return {
      actionId: action.id,
      category: action.category,
      chain: action.chain,
      status: 'skipped',
      latencyMs: Date.now() - started,
      error: 'dry-run',
    };
  }

  const headers: Record<string, string> = {
    ...buildHeaders(agent),
    'X-Ledger-Secret': LEDGER_SECRET,
  };

  const metadata = {
    runId: RUN_ID,
    sessionId,
    agentId: agent.id,
    agentType: agent.type,
    category: action.category,
    chain: action.chain,
    source: 'live_stress_tester',
  };

  const body: Record<string, any> = {
    intentText: action.intentText,
    chain: action.chain,
    metadata: { ...metadata, ...(action.metadata || {}) },
  };

  if (options?.planOnly) body.planOnly = true;
  if (options?.intentId) {
    body.intentId = options.intentId;
    delete body.intentText;
  }

  const res = await fetchJson('/api/ledger/intents/execute', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }, 90000);

  const latency = Date.now() - started;
  if (res.ok && res.json?.ok) {
    return {
      actionId: action.id,
      category: action.category,
      chain: action.chain,
      status: 'ok',
      latencyMs: latency,
      txHash: res.json?.txHash || res.json?.execution?.txHash,
      intentId: res.json?.intentId,
    };
  }

  return {
    actionId: action.id,
    category: action.category,
    chain: action.chain,
    status: 'fail',
    latencyMs: latency,
    error: res.json?.error?.message || res.json?.error || res.text || 'execution failed',
  };
}

async function executePlanAndConfirm(agent: AgentState, sessionId: string, action: Action): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  const planAction: Action = { ...action, id: buildActionId('plan', 0), category: 'plan' as Category };
  const planResult = await executeIntent(agent, sessionId, planAction, { planOnly: true });
  results.push(planResult);

  if (planResult.status !== 'ok') return results;
  const responseIntentId = planResult.intentId;
  if (!responseIntentId) return results;

  const confirmAction: Action = { ...action, id: buildActionId('confirm', 0), category: 'confirm' as Category };
  const confirmResult = await executeIntent(agent, sessionId, confirmAction, { intentId: responseIntentId });
  results.push(confirmResult);
  return results;
}

async function runSessionPrepare(agent: AgentState): Promise<ActionResult> {
  const actionId = buildActionId('session', 0);
  const started = Date.now();

  if (!agent.walletAddress) {
    return {
      actionId,
      category: 'session',
      chain: 'ethereum',
      status: 'skipped',
      latencyMs: Date.now() - started,
      error: 'Missing wallet address',
    };
  }

  if (DRY_RUN) {
    return {
      actionId,
      category: 'session',
      chain: 'ethereum',
      status: 'skipped',
      latencyMs: Date.now() - started,
      error: 'dry-run',
    };
  }

  const res = await fetchJson('/api/session/prepare', {
    method: 'POST',
    headers: buildHeaders(agent),
    body: JSON.stringify({ userAddress: agent.walletAddress }),
  });

  const latency = Date.now() - started;
  if (res.ok && res.json?.ok) {
    const sessionId = res.json?.session?.sessionId;
    const sessionEnabled = res.json?.session?.enabled;
    const to = res.json?.session?.to;
    const data = res.json?.session?.data;
    const valueRaw = res.json?.session?.value;
    if (sessionId) agent.sessionId = sessionId;

    if (sessionEnabled === false) {
      return {
        actionId,
        category: 'session',
        chain: 'ethereum',
        status: 'fail',
        latencyMs: Date.now() - started,
        error: 'Session mode disabled',
      };
    }

    if (sessionId && to && data) {
      const client = await getWalletClient(agent);
      if (!client) {
        return {
          actionId,
          category: 'session',
          chain: 'ethereum',
          status: 'fail',
          latencyMs: Date.now() - started,
          error: 'Missing wallet private key or ETH_RPC_URL for session signing',
        };
      }

      const { walletClient, publicClient } = client;
      const value = valueRaw ? BigInt(valueRaw) : BigInt(0);

      const txHash = await walletClient.sendTransaction({
        to,
        data,
        value,
      });

      try {
        await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 15000 });
      } catch (err) {
        // If pending, continue to validation
      }

      const validateRes = await fetchJson('/api/session/validate', {
        method: 'POST',
        headers: buildHeaders(agent),
        body: JSON.stringify({ userAddress: agent.walletAddress, sessionId }),
      });

      if (!validateRes.ok || validateRes.json?.valid !== true) {
        return {
          actionId,
          category: 'session',
          chain: 'ethereum',
          status: 'fail',
          latencyMs: Date.now() - started,
          error: validateRes.json?.reason || validateRes.json?.error || validateRes.text || 'Session not active after signing',
        };
      }
    }

    return {
      actionId,
      category: 'session',
      chain: 'ethereum',
      status: 'ok',
      latencyMs: latency,
    };
  }

  return {
    actionId,
    category: 'session',
    chain: 'ethereum',
    status: 'fail',
    latencyMs: latency,
    error: res.json?.error || res.text || 'session prepare failed',
  };
}

async function runReset(agent: AgentState): Promise<ActionResult> {
  const actionId = buildActionId('reset', 0);
  const started = Date.now();

  if (DRY_RUN) {
    return {
      actionId,
      category: 'reset',
      chain: 'ethereum',
      status: 'skipped',
      latencyMs: Date.now() - started,
      error: 'dry-run',
    };
  }

  const res = await fetchJson('/api/reset', {
    method: 'POST',
    headers: buildHeaders(agent),
  });

  const latency = Date.now() - started;
  if (res.ok) {
    return {
      actionId,
      category: 'reset',
      chain: 'ethereum',
      status: 'ok',
      latencyMs: latency,
    };
  }

  return {
    actionId,
    category: 'reset',
    chain: 'ethereum',
    status: 'fail',
    latencyMs: latency,
    error: res.json?.error || res.text || 'reset failed',
  };
}

async function validateErc8004(agent: AgentState, action: Action): Promise<ActionResult> {
  const actionId = buildActionId('validate', 0);
  const started = Date.now();

  if (DRY_RUN) {
    return {
      actionId,
      category: 'validate',
      chain: action.chain,
      status: 'skipped',
      latencyMs: Date.now() - started,
      error: 'dry-run',
    };
  }

  const kindMap: Record<Category, string> = {
    swap: 'swap',
    deposit: 'lend',
    perp: 'perp',
    perp_market: 'perp_create',
    perp_close: 'perp',
    event: 'event',
    event_close: 'event',
    bridge: 'bridge',
    leverage: 'perp',
    chat: 'proof',
    mint: 'proof',
    session: 'proof',
    plan: 'proof',
    confirm: 'proof',
    validate: 'proof',
    reset: 'proof',
  };

  const venueMap: Record<Category, string> = {
    swap: action.chain === 'solana' ? 'jupiter' : 'uniswap',
    deposit: action.chain === 'solana' ? 'solana_vault' : action.chain === 'hyperliquid' ? 'hyperliquid_vault' : 'aave',
    perp: 'hyperliquid',
    perp_market: 'hyperliquid',
    perp_close: 'hyperliquid',
    event: 'prediction_market',
    event_close: 'prediction_market',
    bridge: 'lifi',
    leverage: 'hyperliquid',
    chat: 'offchain',
    mint: 'faucet',
    session: 'session',
    plan: 'planner',
    confirm: 'planner',
    validate: 'erc8004',
    reset: 'chat',
  };

  const payload = {
    kind: kindMap[action.category],
    chain: action.chain,
    venue: venueMap[action.category],
  };

  const res = await fetchJson('/api/erc8004/validate', {
    method: 'POST',
    headers: buildHeaders(agent),
    body: JSON.stringify(payload),
  });

  const latency = Date.now() - started;
  if (res.ok && res.json?.ok && res.json?.validation?.valid !== false) {
    return {
      actionId,
      category: 'validate',
      chain: action.chain,
      status: 'ok',
      latencyMs: latency,
    };
  }

  return {
    actionId,
    category: 'validate',
    chain: action.chain,
    status: 'fail',
    latencyMs: latency,
    error: res.json?.validation?.errors?.join('; ') || res.json?.error || res.text || 'validation failed',
  };
}

async function runSession(sessionIndex: number): Promise<SessionResult> {
  const agent = agents[sessionIndex % agents.length];
  const sessionId = `sess_${sessionIndex}_${randomUUID().slice(0, 6)}`;
  const startedAt = Date.now();

  await ensureAccess(agent);

  const results: ActionResult[] = [];

  if (agent.type === 'human') {
    results.push(await runSessionPrepare(agent));
  }

  const mintChain = pick(MINT_CHAINS.length ? MINT_CHAINS : ['ethereum']);
  results.push(await runMint(agent, sessionId, mintChain));

  results.push(await runChat(agent, sessionId, 'Analyze BTC trends in 2 sentences.'));
  results.push(await runChat(agent, sessionId, 'Hedge BTC/ETH with a short BTC perp for $150. Provide a quick plan only.'));

  const actions = buildSessionActions(sessionIndex);
  for (const action of actions) {
    if (agent.type === 'erc8004') {
      results.push(await validateErc8004(agent, action));
    }

    if (agent.type === 'human' && action.category === 'swap') {
      const planned = await executePlanAndConfirm(agent, sessionId, action);
      results.push(...planned);
    } else {
      results.push(await executeIntent(agent, sessionId, action));
    }

    await sleep(400); // small pacing to avoid rate limiting
  }

  if (agent.type === 'human') {
    results.push(await runReset(agent));
  }

  const finishedAt = Date.now();
  const ok = results.every(r => r.status === 'ok' || r.status === 'skipped');

  return {
    sessionId,
    agentId: agent.id,
    agentType: agent.type,
    ok,
    actions: results,
    startedAt,
    finishedAt,
  };
}

function summarize(results: SessionResult[]) {
  let actionOk = 0;
  let actionFail = 0;
  let actionSkipped = 0;

  for (const session of results) {
    for (const action of session.actions) {
      if (action.status === 'ok') actionOk += 1;
      if (action.status === 'fail') actionFail += 1;
      if (action.status === 'skipped') actionSkipped += 1;
    }
  }

  return {
    sessions: results.length,
    sessionsOk: results.filter(r => r.ok).length,
    sessionsFail: results.filter(r => !r.ok).length,
    actionsOk: actionOk,
    actionsFail: actionFail,
    actionsSkipped: actionSkipped,
  };
}

async function hydrateAgentsFromKeys() {
  if (!WALLET_KEYS.length) return;
  try {
    const { privateKeyToAccount } = await import('viem/accounts');
    agents.forEach((agent) => {
      if (agent.privateKey && !agent.walletAddress) {
        const account = privateKeyToAccount(agent.privateKey as `0x${string}`);
        agent.walletAddress = account.address;
      }
    });
  } catch (err) {
    // ignore
  }
}

async function main() {
  await hydrateAgentsFromKeys();
  log('🌸 Blossom Live Stress Tester');
  log(`   Base URL: ${BASE_URL}`);
  log(`   Run ID: ${RUN_ID}`);
  log(`   Sessions: ${COUNT}`);
  log(`   Concurrency: ${CONCURRENCY}`);
  log(`   Dry run: ${DRY_RUN ? 'yes' : 'no'}`);
  log(`   Mint chains: ${MINT_CHAINS.join(', ')}`);
  log(`   Swap chains: ${SWAP_CHAINS.join(', ')}`);
  if (!ETH_RPC_URL) log('   ⚠️  Missing ETH RPC URL (session signing will fail)');
  if (!STRESS_EVM_ADDRESS) log('   ⚠️  Missing STRESS_TEST_EVM_ADDRESS (mint to Ethereum may be skipped)');
  if (!STRESS_SOLANA_ADDRESS) log('   ⚠️  Missing STRESS_TEST_SOLANA_ADDRESS (mint to Solana may be skipped)');
  if (!STRESS_HYPERLIQUID_ADDRESS) log('   ⚠️  Missing STRESS_TEST_HYPERLIQUID_ADDRESS (mint to Hyperliquid may be skipped)');

  const results: SessionResult[] = [];
  let currentIndex = 0;

  const workers = Array.from({ length: CONCURRENCY }).map(async (_, workerId) => {
    while (true) {
      const idx = currentIndex++;
      if (idx >= COUNT) break;

      log(`\n[worker ${workerId}] Starting session ${idx + 1}/${COUNT}`);
      try {
        const sessionResult = await runSession(idx);
        results.push(sessionResult);
        log(`[worker ${workerId}] Session ${idx + 1} complete: ${sessionResult.ok ? 'OK' : 'FAIL'}`);
      } catch (err: any) {
        log(`[worker ${workerId}] Session ${idx + 1} crashed: ${err.message || err}`);
      }
    }
  });

  await Promise.all(workers);

  const summary = summarize(results);
  log('\n=== Summary ===');
  log(`Sessions: ${summary.sessions}`);
  log(`Sessions OK: ${summary.sessionsOk}`);
  log(`Sessions Fail: ${summary.sessionsFail}`);
  log(`Actions OK: ${summary.actionsOk}`);
  log(`Actions Fail: ${summary.actionsFail}`);
  log(`Actions Skipped: ${summary.actionsSkipped}`);

  if (OUTPUT_FILE) {
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ runId: RUN_ID, summary, results }, null, 2));
    log(`\nResults saved to ${OUTPUT_FILE}`);
  }
}

main().catch(err => {
  console.error('❌ Live stress tester failed:', err);
  process.exit(1);
});
