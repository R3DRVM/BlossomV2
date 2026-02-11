#!/usr/bin/env npx tsx
// @ts-nocheck
/**
 * Live Stress Tester (Curated)
 *
 * Modes:
 * - full: existing multi-step execution stress test
 * - tier1: deterministic suite (Ethereum-heavy, execution enabled)
 * - tier2: realistic suite (cross-chain, venue flakes classified separately)
 * - chat_only: no execution, route=chat assertions only
 * - mixed: research + planning (+ optional explicit execute)
 *
 * Usage examples:
 *   npx tsx agent/scripts/live-stress-tester.ts --baseUrl=https://api.blossom.onl --mode=full --count=100 --concurrency=2
 *   npx tsx agent/scripts/live-stress-tester.ts --mode=chat_only --count=20 --concurrency=4
 *   npx tsx agent/scripts/live-stress-tester.ts --mode=mixed --count=20 --concurrency=4
 *   npx tsx agent/scripts/live-stress-tester.ts --mode=tier1 --allow_execute --count=40 --concurrency=2
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

type AgentType = 'human' | 'erc8004';
type Chain = 'ethereum' | 'solana' | 'hyperliquid' | 'both';
type Mode = 'full' | 'tier1' | 'tier2' | 'chat_only' | 'mixed';
type ExpectedRoute = 'chat' | 'planner';
type FailureClass =
  | 'blossom_logic'
  | 'rpc_rate_limit'
  | 'nonce_collision'
  | 'venue_flake'
  | 'erc8004_validation'
  | 'faucet_mint_fail'
  | 'guardrail_failure'
  | 'unknown';

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
  | 'reset'
  | 'research'
  | 'capability'
  | 'follow_up';

type Action = {
  id: string;
  category: Category;
  chain: Chain;
  intentText?: string;
  expectedRoute?: ExpectedRoute;
  research?: boolean;
  allowProposalActions?: boolean;
  metadata?: Record<string, any>;
};

type ActionResult = {
  actionId: string;
  category: Category;
  chain: Chain;
  endpoint: string;
  status: 'ok' | 'fail' | 'skipped';
  latencyMs: number;
  error?: string;
  txHash?: string;
  signature?: string;
  intentId?: string;
  expectedRoute?: ExpectedRoute;
  actualRoute?: ExpectedRoute;
  failureClass?: FailureClass;
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

type PromptCorpusItem = {
  id: string;
  text: string;
  expected_route: ExpectedRoute;
  allow_proposal_actions: boolean;
  research?: boolean;
};

const args = process.argv.slice(2);
const arg = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const hasFlag = (name: string) => args.includes(`--${name}`);

const BASE_URL = arg('baseUrl') || process.env.BASE_URL || 'https://api.blossom.onl';
const MODE = ((arg('mode') || process.env.STRESS_MODE || 'full').trim().toLowerCase()) as Mode;
const COUNT = parseInt(arg('count') || process.env.STRESS_COUNT || '100', 10);
const CONCURRENCY = parseInt(arg('concurrency') || process.env.STRESS_CONCURRENCY || '2', 10);
const OUTPUT_FILE = arg('output') || process.env.STRESS_OUTPUT || '';
const ACCESS_CODE = arg('accessCode') || process.env.ACCESS_CODE || process.env.BLOSSOM_ACCESS_CODE || '';
const LEDGER_SECRET = arg('ledgerSecret') || process.env.DEV_LEDGER_SECRET || process.env.LEDGER_SECRET || '';
const DRY_RUN = hasFlag('dry-run');
const VERBOSE = hasFlag('verbose');
const ALLOW_NON_PROD = hasFlag('allow-non-prod') || process.env.ALLOW_NON_PROD === '1';
const ALLOW_EXECUTE = hasFlag('allow_execute') || process.env.STRESS_ALLOW_EXECUTE === '1';
const CORPUS_PATH = arg('corpus') || process.env.STRESS_PROMPT_CORPUS || path.resolve(process.cwd(), 'agent/scripts/human-beta-prompt-corpus.json');
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

const RUN_ID = `live_stress_${MODE}_${Date.now()}_${randomUUID().slice(0, 8)}`;

const agents: AgentState[] = [
  { id: 'human-1', type: 'human' },
  { id: 'human-2', type: 'human' },
  { id: 'erc8004-1', type: 'erc8004' },
  { id: 'erc8004-2', type: 'erc8004' },
];

const walletLocks = new Map<string, Promise<any>>();

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

if (!ALLOW_NON_PROD && !BASE_URL.includes('blossom.onl') && !BASE_URL.includes('vercel.app') && !BASE_URL.includes('localhost')) {
  console.error(`❌ Refusing to run against non-prod baseUrl: ${BASE_URL}`);
  console.error('   Use --allow-non-prod to override.');
  process.exit(1);
}

const modeRequiresLedger = MODE === 'full' || MODE === 'tier1' || MODE === 'tier2' || (MODE === 'mixed' && ALLOW_EXECUTE);
if (!LEDGER_SECRET && !DRY_RUN && modeRequiresLedger) {
  console.error('❌ DEV_LEDGER_SECRET (or --ledgerSecret) is required for execution-capable modes.');
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

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

function buildHeaders(agent: AgentState): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (agent.cookie) headers['cookie'] = agent.cookie;
  if (agent.walletAddress) headers['x-wallet-address'] = agent.walletAddress;
  return headers;
}

function isEvmActionChain(chain: Chain): boolean {
  return chain === 'ethereum' || chain === 'hyperliquid' || chain === 'both';
}

function getLockKey(agent: AgentState, chain: Chain): string {
  if (chain === 'hyperliquid') {
    return (STRESS_HYPERLIQUID_ADDRESS || agent.walletAddress || 'wallet:shared').toLowerCase();
  }
  return (agent.walletAddress || STRESS_EVM_ADDRESS || 'wallet:shared').toLowerCase();
}

async function withWalletLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
  const previous = walletLocks.get(lockKey) || Promise.resolve();
  let release: () => void = () => {};
  const next = new Promise<void>(resolve => {
    release = resolve;
  });
  walletLocks.set(lockKey, previous.then(() => next).catch(() => next));

  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    const current = walletLocks.get(lockKey);
    if (current === next) {
      walletLocks.delete(lockKey);
    }
  }
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
  } catch {
    return null;
  }
}

function buildSwapAction(sessionIndex: number, forcedChain?: Chain): Action {
  const chain: Chain = forcedChain || pick(SWAP_CHAINS.length ? SWAP_CHAINS : ['ethereum']);
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

function buildDepositAction(sessionIndex: number, forcedChain?: Chain): Action {
  const chainCycle = sessionIndex % 3;
  const chain: Chain = forcedChain || (chainCycle === 0 ? 'ethereum' : chainCycle === 1 ? 'solana' : 'hyperliquid');
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

function buildSessionActions(sessionIndex: number, mode: Mode): Action[] {
  if (mode === 'tier1') {
    return [
      buildSwapAction(sessionIndex, 'ethereum'),
      buildDepositAction(sessionIndex, 'ethereum'),
      buildEventOpenAction(sessionIndex),
      buildPerpOpenAction(sessionIndex),
      buildPerpCloseAction(sessionIndex),
      buildEventCloseAction(sessionIndex),
    ];
  }

  if (mode === 'tier2') {
    const actions: Action[] = [];
    actions.push(buildSwapAction(sessionIndex, sessionIndex % 2 === 0 ? 'solana' : 'ethereum'));
    actions.push(buildDepositAction(sessionIndex, sessionIndex % 2 === 0 ? 'solana' : 'hyperliquid'));
    actions.push(buildEventOpenAction(sessionIndex));
    actions.push(buildPerpOpenAction(sessionIndex));
    if (sessionIndex % 2 === 0) actions.push(buildBridgeAction(sessionIndex));
    actions.push(buildEventCloseAction(sessionIndex));
    return actions;
  }

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

function normalizeStableSymbols(text: string): string {
  return String(text || '').replace(/\b(REDACTED|USDC|BUSDC|BLSMUSDC)\b/gi, 'bUSDC');
}

function classifyFailure(errorText: string | undefined, action: Pick<ActionResult, 'category' | 'chain'>): FailureClass {
  const lower = String(errorText || '').toLowerCase();

  if (!lower) return 'unknown';
  if (action.category === 'validate') return 'erc8004_validation';
  if (action.category === 'mint') return 'faucet_mint_fail';
  if (lower.includes('guardrail') || lower.includes('route mismatch') || lower.includes('hallucination')) return 'guardrail_failure';
  if (lower.includes('nonce') || lower.includes('replacement transaction underpriced') || lower.includes('already known')) return 'nonce_collision';
  if (lower.includes('rate limit') || lower.includes('too many requests') || lower.includes('429') || lower.includes('rpc') || lower.includes('gateway timeout') || lower.includes('timed out')) return 'rpc_rate_limit';
  if (lower.includes('jupiter') || lower.includes('liquidity') || lower.includes('venue') || lower.includes('quote') || lower.includes('hyperliquid') || lower.includes('devnet')) return 'venue_flake';
  if (lower.includes('path_violation') || lower.includes('missing_execution_request') || lower.includes('invalid') || lower.includes('revert') || lower.includes('failed')) return 'blossom_logic';
  return 'unknown';
}

function inferRouteFromResponse(payload: any): ExpectedRoute {
  if (!payload) return 'chat';
  if (payload.metadata?.route === 'chat' || payload.metadata?.route === 'planner') {
    return payload.metadata.route;
  }
  if (payload.executionRequest || payload.draftId) return 'planner';
  return 'chat';
}

function responseHasExecuteSignals(payload: any): boolean {
  const source = JSON.stringify(payload || {}).toLowerCase();
  return (
    source.includes('"txhash"') ||
    source.includes('"orderid"') ||
    source.includes('"status":"executing"') ||
    source.includes('"status":"executed"') ||
    source.includes('"autoconfirm"') ||
    source.includes('"autoexecute"')
  );
}

function referencesPortfolioFields(assistantMessage: string, portfolio: any): boolean {
  const text = String(assistantMessage || '').toLowerCase();
  if (!portfolio || typeof portfolio !== 'object') return false;

  const balances = Array.isArray(portfolio.balances) ? portfolio.balances : [];
  const strategies = Array.isArray(portfolio.strategies) ? portfolio.strategies : [];
  const hasBalances = balances.length > 0;
  const hasPositions = strategies.length > 0;

  const symbolMention = balances
    .map((b: any) => String(b.symbol || '').toLowerCase())
    .filter(Boolean)
    .some((symbol: string) => {
      if (symbol === 'redacted' || symbol === 'usdc' || symbol === 'busdc' || symbol === 'blsmusdc') {
        return /\bbusdc\b/.test(text);
      }
      return new RegExp(`\\b${symbol.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i').test(text);
    });

  const numericMention = /\$\d|\d+\.\d+/.test(text);
  const holdingsLanguage = /\bbalance|balances|position|positions|portfolio|exposure|holdings|total\b/.test(text);

  if (hasBalances || hasPositions) {
    return symbolMention || (holdingsLanguage && numericMention);
  }
  return false;
}

function admitsMissingPortfolioVisibility(assistantMessage: string): boolean {
  const text = String(assistantMessage || '').toLowerCase();
  return (
    text.includes("don't see") ||
    text.includes('do not see') ||
    text.includes("can't see") ||
    text.includes('cannot see') ||
    text.includes('unable to see') ||
    text.includes('connect your wallet') ||
    text.includes('no balances') ||
    text.includes('i do not have access')
  );
}

async function fetchJson(endpoint: string, options: any = {}, timeoutMs = 45000) {
  const url = `${BASE_URL.replace(/\/$/, '')}${endpoint}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, text, headers: res.headers, endpoint };
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
  if (DRY_RUN) {
    agent.accessOk = true;
    return;
  }

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

function buildMintPayload(chain: Chain, agent?: AgentState) {
  const amount = randInt(100, 500);
  if (chain === 'solana') {
    if (!STRESS_SOLANA_ADDRESS) return null;
    return { userAddress: STRESS_SOLANA_ADDRESS, solanaAddress: STRESS_SOLANA_ADDRESS, chain: 'solana', amount };
  }
  if (chain === 'hyperliquid') {
    if (!STRESS_HYPERLIQUID_ADDRESS) return null;
    return { userAddress: STRESS_HYPERLIQUID_ADDRESS, chain: 'hyperliquid', amount };
  }
  const target = agent?.walletAddress || STRESS_EVM_ADDRESS;
  if (!target) return null;
  return { userAddress: target, chain: 'ethereum', amount };
}

async function runMint(agent: AgentState, chain: Chain): Promise<ActionResult> {
  const actionId = buildActionId('mint', 0);
  const started = Date.now();
  const endpoint = '/api/mint-busdc';

  const payload = buildMintPayload(chain, agent);
  if (!payload) {
    return {
      actionId,
      category: 'mint',
      chain,
      endpoint,
      status: 'skipped',
      latencyMs: Date.now() - started,
      error: `Missing mint address for ${chain}`,
      failureClass: 'faucet_mint_fail',
    };
  }

  const execute = async () => {
    if (DRY_RUN) {
      return {
        actionId,
        category: 'mint' as Category,
        chain,
        endpoint,
        status: 'skipped' as const,
        latencyMs: Date.now() - started,
        error: 'dry-run',
      };
    }

    const headers = buildHeaders(agent);

    const res = await fetchJson(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const latency = Date.now() - started;
    if (res.ok && res.json?.ok) {
      return {
        actionId,
        category: 'mint' as Category,
        chain,
        endpoint,
        status: 'ok' as const,
        latencyMs: latency,
        txHash: res.json?.txHash,
        signature: res.json?.signature,
      };
    }

    const errorMessage = normalizeStableSymbols(res.json?.details || res.json?.error || res.text || 'mint failed');
    const normalizedError = `${errorMessage}`.toLowerCase();
    if (normalizedError.includes('not configured') || normalizedError.includes('not available')) {
      return {
        actionId,
        category: 'mint' as Category,
        chain,
        endpoint,
        status: 'skipped' as const,
        latencyMs: latency,
        error: errorMessage,
        failureClass: 'faucet_mint_fail' as FailureClass,
      };
    }

    return {
      actionId,
      category: 'mint' as Category,
      chain,
      endpoint,
      status: 'fail' as const,
      latencyMs: latency,
      error: errorMessage,
      failureClass: classifyFailure(errorMessage, { category: 'mint', chain }),
    };
  };

  if (!isEvmActionChain(chain)) {
    return execute();
  }

  return withWalletLock(getLockKey(agent, chain), execute);
}

function loadPromptCorpus(): PromptCorpusItem[] {
  try {
    if (!fs.existsSync(CORPUS_PATH)) {
      log(`⚠️ Prompt corpus not found at ${CORPUS_PATH}, using built-in prompts.`);
      return [];
    }
    const raw = fs.readFileSync(CORPUS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as PromptCorpusItem[];
    }
    if (Array.isArray(parsed?.prompts)) {
      return parsed.prompts as PromptCorpusItem[];
    }
    if (parsed && typeof parsed === 'object') {
      const groups = ['research_basic', 'research_market', 'research_portfolio', 'mixed_intent', 'support_debug'];
      const all: PromptCorpusItem[] = [];
      for (const group of groups) {
        const items = Array.isArray(parsed[group]) ? parsed[group] : [];
        all.push(...items);
      }
      return all;
    }
    return [];
  } catch (err: any) {
    log(`⚠️ Failed to parse prompt corpus (${CORPUS_PATH}): ${err.message}`);
    return [];
  }
}

const builtInCorpus: PromptCorpusItem[] = [
  { id: 'research-balance', text: 'What is my current balance and open positions?', expected_route: 'chat', allow_proposal_actions: false, research: true },
  { id: 'research-btc', text: 'What is BTC and why is it volatile?', expected_route: 'chat', allow_proposal_actions: false, research: true },
  { id: 'mixed-aave', text: 'What is Aave and deposit 100 bUSDC there', expected_route: 'planner', allow_proposal_actions: true, research: false },
  { id: 'plan-btc', text: 'Long BTC with 5x leverage, use 50 bUSDC collateral', expected_route: 'planner', allow_proposal_actions: true, research: false },
  { id: 'support-queued', text: 'Why did my trade stay queued?', expected_route: 'chat', allow_proposal_actions: false, research: true },
];

const promptCorpus = (() => {
  const loaded = loadPromptCorpus();
  return loaded.length ? loaded : builtInCorpus;
})();

function pickPromptByRoute(route: ExpectedRoute, researchPreferred = false): PromptCorpusItem {
  const filtered = promptCorpus.filter(item => item.expected_route === route && (!researchPreferred || item.research));
  if (filtered.length > 0) return pick(filtered);
  const fallback = promptCorpus.filter(item => item.expected_route === route);
  if (fallback.length > 0) return pick(fallback);
  return pick(promptCorpus.length ? promptCorpus : builtInCorpus);
}

async function runChat(
  agent: AgentState,
  message: string,
  options?: {
    route?: ExpectedRoute;
    research?: boolean;
    allowProposalActions?: boolean;
    category?: Category;
  }
): Promise<ActionResult> {
  const category = options?.category || (options?.research ? 'research' : 'chat');
  const actionId = buildActionId(category, 0);
  const started = Date.now();
  const endpoint = '/api/chat';
  const expectedRoute = options?.route || 'chat';

  if (DRY_RUN) {
    return {
      actionId,
      category,
      chain: 'ethereum',
      endpoint,
      status: 'skipped',
      latencyMs: Date.now() - started,
      error: 'dry-run',
      expectedRoute,
      actualRoute: expectedRoute,
    };
  }

  const headers = buildHeaders(agent);

  const res = await fetchJson(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ userMessage: message, route: expectedRoute }),
  }, 60000);

  const latency = Date.now() - started;
  const assistantMessage = normalizeStableSymbols(res.json?.assistantMessage || '');
  const actualRoute = inferRouteFromResponse(res.json);

  if (!res.ok) {
    const error = normalizeStableSymbols(res.json?.error || res.text || 'chat failed');
    return {
      actionId,
      category,
      chain: 'ethereum',
      endpoint,
      status: 'fail',
      latencyMs: latency,
      error,
      expectedRoute,
      actualRoute,
      failureClass: classifyFailure(error, { category, chain: 'ethereum' }),
    };
  }

  if (!assistantMessage.trim()) {
    const error = 'guardrail: empty assistantMessage';
    return {
      actionId,
      category,
      chain: 'ethereum',
      endpoint,
      status: 'fail',
      latencyMs: latency,
      error,
      expectedRoute,
      actualRoute,
      failureClass: 'guardrail_failure',
    };
  }

  if (actualRoute !== expectedRoute) {
    const error = `guardrail: route mismatch expected=${expectedRoute} actual=${actualRoute}`;
    return {
      actionId,
      category,
      chain: 'ethereum',
      endpoint,
      status: 'fail',
      latencyMs: latency,
      error,
      expectedRoute,
      actualRoute,
      failureClass: 'guardrail_failure',
    };
  }

  const hasExecuteSignals = responseHasExecuteSignals(res.json);
  const hasExecutionPayload = !!res.json?.executionRequest;
  if (expectedRoute === 'chat') {
    if (hasExecuteSignals || hasExecutionPayload) {
      const error = 'guardrail: chat route returned execute payload/signals';
      return {
        actionId,
        category,
        chain: 'ethereum',
        endpoint,
        status: 'fail',
        latencyMs: latency,
        error,
        expectedRoute,
        actualRoute,
        failureClass: 'guardrail_failure',
      };
    }

    if (!options?.allowProposalActions && Array.isArray(res.json?.actions) && res.json.actions.length > 0) {
      const error = 'guardrail: chat route returned non-empty actions';
      return {
        actionId,
        category,
        chain: 'ethereum',
        endpoint,
        status: 'fail',
        latencyMs: latency,
        error,
        expectedRoute,
        actualRoute,
        failureClass: 'guardrail_failure',
      };
    }
  }

  const asksPortfolio = /\b(balance|balances|position|positions|holdings|portfolio|exposure)\b/i.test(message);
  if (asksPortfolio) {
    const portfolio = res.json?.portfolio;
    const grounded = referencesPortfolioFields(assistantMessage, portfolio);
    const admitsUnknown = admitsMissingPortfolioVisibility(assistantMessage);

    if (!grounded && !admitsUnknown) {
      const error = 'hallucination risk: portfolio query lacked grounded fields and no uncertainty admission';
      return {
        actionId,
        category,
        chain: 'ethereum',
        endpoint,
        status: 'fail',
        latencyMs: latency,
        error,
        expectedRoute,
        actualRoute,
        failureClass: 'guardrail_failure',
      };
    }
  }

  return {
    actionId,
    category,
    chain: 'ethereum',
    endpoint,
    status: 'ok',
    latencyMs: latency,
    expectedRoute,
    actualRoute,
  };
}

async function executeIntent(agent: AgentState, sessionId: string, action: Action, options?: { planOnly?: boolean; intentId?: string }): Promise<ActionResult> {
  const started = Date.now();
  const endpoint = '/api/ledger/intents/execute';

  const execute = async () => {
    if (DRY_RUN) {
      return {
        actionId: action.id,
        category: action.category,
        chain: action.chain,
        endpoint,
        status: 'skipped' as const,
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
      mode: MODE,
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

    const res = await fetchJson(endpoint, {
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
        endpoint,
        status: 'ok' as const,
        latencyMs: latency,
        txHash: res.json?.txHash || res.json?.execution?.txHash,
        intentId: res.json?.intentId,
      };
    }

    const error = normalizeStableSymbols(res.json?.error?.message || res.json?.error || res.text || 'execution failed');
    return {
      actionId: action.id,
      category: action.category,
      chain: action.chain,
      endpoint,
      status: 'fail' as const,
      latencyMs: latency,
      error,
      failureClass: classifyFailure(error, { category: action.category, chain: action.chain }),
    };
  };

  if (!isEvmActionChain(action.chain)) {
    return execute();
  }

  return withWalletLock(getLockKey(agent, action.chain), execute);
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
  const endpoint = '/api/session/prepare';

  if (!agent.walletAddress) {
    return {
      actionId,
      category: 'session',
      chain: 'ethereum',
      endpoint,
      status: 'skipped',
      latencyMs: Date.now() - started,
      error: 'Missing wallet address',
    };
  }

  const execute = async () => {
    if (DRY_RUN) {
      return {
        actionId,
        category: 'session' as Category,
        chain: 'ethereum',
        endpoint,
        status: 'skipped' as const,
        latencyMs: Date.now() - started,
        error: 'dry-run',
      };
    }

    const res = await fetchJson(endpoint, {
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
          category: 'session' as Category,
          chain: 'ethereum',
          endpoint,
          status: 'fail' as const,
          latencyMs: Date.now() - started,
          error: 'Session mode disabled',
          failureClass: 'blossom_logic' as FailureClass,
        };
      }

      if (sessionId && to && data) {
        const client = await getWalletClient(agent);
        if (!client) {
          return {
            actionId,
            category: 'session' as Category,
            chain: 'ethereum',
            endpoint,
            status: 'fail' as const,
            latencyMs: Date.now() - started,
            error: 'Missing wallet private key or ETH_RPC_URL for session signing',
            failureClass: 'blossom_logic' as FailureClass,
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
        } catch {
          // Pending receipts are validated in next step.
        }

        const validateOnce = async () =>
          fetchJson('/api/session/validate', {
            method: 'POST',
            headers: buildHeaders(agent),
            body: JSON.stringify({ userAddress: agent.walletAddress, sessionId }),
          });

        let validateRes = await validateOnce();
        if (!validateRes.ok || validateRes.json?.valid !== true) {
          const initialReason =
            validateRes.json?.reason || validateRes.json?.error || validateRes.text || 'Session not active after signing';
          const reasonText = `${initialReason}`.toLowerCase();
          if (reasonText.includes('session_not_active') || reasonText.includes('not active')) {
            for (let attempt = 0; attempt < 5; attempt += 1) {
              await sleep(3000);
              validateRes = await validateOnce();
              if (validateRes.ok && validateRes.json?.valid === true) break;
            }
          }
        }

        if (!validateRes.ok || validateRes.json?.valid !== true) {
          const error = normalizeStableSymbols(validateRes.json?.reason || validateRes.json?.error || validateRes.text || 'Session not active after signing');
          return {
            actionId,
            category: 'session' as Category,
            chain: 'ethereum',
            endpoint,
            status: 'fail' as const,
            latencyMs: Date.now() - started,
            error,
            failureClass: classifyFailure(error, { category: 'session', chain: 'ethereum' }),
          };
        }
      }

      return {
        actionId,
        category: 'session' as Category,
        chain: 'ethereum',
        endpoint,
        status: 'ok' as const,
        latencyMs: latency,
      };
    }

    const error = normalizeStableSymbols(res.json?.error || res.text || 'session prepare failed');
    return {
      actionId,
      category: 'session' as Category,
      chain: 'ethereum',
      endpoint,
      status: 'fail' as const,
      latencyMs: latency,
      error,
      failureClass: classifyFailure(error, { category: 'session', chain: 'ethereum' }),
    };
  };

  return withWalletLock(getLockKey(agent, 'ethereum'), execute);
}

async function runReset(agent: AgentState): Promise<ActionResult> {
  const actionId = buildActionId('reset', 0);
  const started = Date.now();
  const endpoint = '/api/reset';

  if (DRY_RUN) {
    return {
      actionId,
      category: 'reset',
      chain: 'ethereum',
      endpoint,
      status: 'skipped',
      latencyMs: Date.now() - started,
      error: 'dry-run',
    };
  }

  const res = await fetchJson(endpoint, {
    method: 'POST',
    headers: buildHeaders(agent),
  });

  const latency = Date.now() - started;
  if (res.ok) {
    return {
      actionId,
      category: 'reset',
      chain: 'ethereum',
      endpoint,
      status: 'ok',
      latencyMs: latency,
    };
  }

  const error = normalizeStableSymbols(res.json?.error || res.text || 'reset failed');
  return {
    actionId,
    category: 'reset',
    chain: 'ethereum',
    endpoint,
    status: 'fail',
    latencyMs: latency,
    error,
    failureClass: classifyFailure(error, { category: 'reset', chain: 'ethereum' }),
  };
}

function getCapabilityForAction(action: Action): { kind: string; venue: string } {
  const kindMap: Record<Category, string> = {
    swap: 'swap',
    deposit: 'lend',
    perp: 'perp',
    perp_market: 'perp_create',
    perp_close: 'perp',
    event: 'event',
    event_close: 'event',
    bridge: 'proof',
    leverage: 'perp',
    chat: 'proof',
    mint: 'proof',
    session: 'proof',
    plan: 'proof',
    confirm: 'proof',
    validate: 'proof',
    reset: 'proof',
    research: 'proof',
    capability: 'proof',
    follow_up: 'proof',
  };

  const venueMap: Record<Category, string> = {
    swap: action.chain === 'solana' ? 'jupiter' : 'uniswap_v3',
    deposit: action.chain === 'ethereum' ? 'aave_v3' : 'native',
    perp: 'hyperliquid',
    perp_market: 'hip3',
    perp_close: 'hyperliquid',
    event: 'demo_event',
    event_close: 'demo_event',
    bridge: 'native',
    leverage: 'hyperliquid',
    chat: 'offchain',
    mint: 'faucet',
    session: 'session',
    plan: 'planner',
    confirm: 'planner',
    validate: 'erc8004',
    reset: 'chat',
    research: 'chat',
    capability: 'chat',
    follow_up: 'chat',
  };

  return { kind: kindMap[action.category], venue: venueMap[action.category] };
}

function shouldSkipErc8004Validation(action: Action): string | null {
  const declaredCapabilities = new Set([
    'swap:ethereum:uniswap_v3',
    'lend:ethereum:aave_v3',
    'perp:hyperliquid:hyperliquid',
    'event:ethereum:demo_event',
  ]);

  const cap = getCapabilityForAction(action);
  const key = `${cap.kind}:${action.chain}:${cap.venue}`;
  if (cap.kind === 'proof') return 'proof-only action';
  if (!declaredCapabilities.has(key)) return `capability not declared (${key})`;
  return null;
}

async function validateErc8004(agent: AgentState, action: Action): Promise<ActionResult> {
  const actionId = buildActionId('validate', 0);
  const started = Date.now();
  const endpoint = '/api/erc8004/validate';

  const skipReason = shouldSkipErc8004Validation(action);
  if (skipReason) {
    return {
      actionId,
      category: 'validate',
      chain: action.chain,
      endpoint,
      status: 'skipped',
      latencyMs: Date.now() - started,
      error: skipReason,
    };
  }

  if (DRY_RUN) {
    return {
      actionId,
      category: 'validate',
      chain: action.chain,
      endpoint,
      status: 'skipped',
      latencyMs: Date.now() - started,
      error: 'dry-run',
    };
  }

  const cap = getCapabilityForAction(action);
  const payload = {
    kind: cap.kind,
    chain: action.chain,
    venue: cap.venue,
  };

  const res = await fetchJson(endpoint, {
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
      endpoint,
      status: 'ok',
      latencyMs: latency,
    };
  }

  const error = normalizeStableSymbols(res.json?.validation?.errors?.join('; ') || res.json?.error || res.text || 'validation failed');
  return {
    actionId,
    category: 'validate',
    chain: action.chain,
    endpoint,
    status: 'fail',
    latencyMs: latency,
    error,
    failureClass: 'erc8004_validation',
  };
}

async function runExecutionSession(sessionIndex: number, mode: Mode): Promise<SessionResult> {
  const agent = agents[sessionIndex % agents.length];
  const sessionId = `sess_${sessionIndex}_${randomUUID().slice(0, 6)}`;
  const startedAt = Date.now();

  await ensureAccess(agent);

  const results: ActionResult[] = [];

  if (agent.type === 'human') {
    results.push(await runSessionPrepare(agent));
  }

  const mintChain = pick(MINT_CHAINS.length ? MINT_CHAINS : ['ethereum']);
  results.push(await runMint(agent, mintChain));

  results.push(await runChat(agent, 'Analyze BTC trends in 2 sentences.', { route: 'chat', research: true, category: 'research' }));
  results.push(await runChat(agent, 'Hedge BTC/ETH with a short BTC perp for $150. Provide a quick plan only.', { route: 'planner', allowProposalActions: true, category: 'capability' }));

  const actions = buildSessionActions(sessionIndex, mode);
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

    await sleep(mode === 'tier1' ? 250 : 400);
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

async function runChatOnlySession(sessionIndex: number): Promise<SessionResult> {
  const agent = agents[sessionIndex % agents.length];
  const sessionId = `chat_${sessionIndex}_${randomUUID().slice(0, 6)}`;
  const startedAt = Date.now();
  const results: ActionResult[] = [];

  await ensureAccess(agent);

  const researchPrompt = pickPromptByRoute('chat', true);
  results.push(await runChat(agent, researchPrompt.text, {
    route: 'chat',
    research: true,
    allowProposalActions: researchPrompt.allow_proposal_actions,
    category: 'research',
  }));

  const chatPrompts = promptCorpus.filter(p => p.expected_route === 'chat');
  const supportPrompt = chatPrompts.length ? pick(chatPrompts) : researchPrompt;
  results.push(await runChat(agent, supportPrompt.text, {
    route: 'chat',
    research: !!supportPrompt.research,
    allowProposalActions: supportPrompt.allow_proposal_actions,
    category: 'capability',
  }));

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

async function runMixedSession(sessionIndex: number): Promise<SessionResult> {
  const agent = agents[sessionIndex % agents.length];
  const sessionId = `mixed_${sessionIndex}_${randomUUID().slice(0, 6)}`;
  const startedAt = Date.now();
  const results: ActionResult[] = [];

  await ensureAccess(agent);

  const researchPrompt = pickPromptByRoute('chat', true);
  const capabilityPrompt = pickPromptByRoute('chat', false);
  const planPrompt = pickPromptByRoute('planner', false);

  results.push(await runChat(agent, researchPrompt.text, {
    route: 'chat',
    research: true,
    allowProposalActions: researchPrompt.allow_proposal_actions,
    category: 'research',
  }));

  results.push(await runChat(agent, capabilityPrompt.text, {
    route: 'chat',
    research: !!capabilityPrompt.research,
    allowProposalActions: capabilityPrompt.allow_proposal_actions,
    category: 'capability',
  }));

  results.push(await runChat(agent, planPrompt.text, {
    route: 'planner',
    allowProposalActions: true,
    category: 'plan',
  }));

  if (ALLOW_EXECUTE) {
    const action: Action = {
      id: buildActionId('confirm', sessionIndex),
      category: 'confirm',
      chain: 'ethereum',
      intentText: 'Long BTC with 5x leverage and 50 bUSDC collateral',
    };
    results.push(await executeIntent(agent, sessionId, action));
  } else {
    results.push({
      actionId: buildActionId('confirm', sessionIndex),
      category: 'confirm',
      chain: 'ethereum',
      endpoint: '/api/ledger/intents/execute',
      status: 'skipped',
      latencyMs: 0,
      error: 'Execution disabled (pass --allow_execute to enable)',
    });
  }

  results.push(await runChat(agent, 'What is my current exposure and what did you just do?', {
    route: 'chat',
    research: true,
    allowProposalActions: false,
    category: 'follow_up',
  }));

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
  const byClass: Record<FailureClass, number> = {
    blossom_logic: 0,
    rpc_rate_limit: 0,
    nonce_collision: 0,
    venue_flake: 0,
    erc8004_validation: 0,
    faucet_mint_fail: 0,
    guardrail_failure: 0,
    unknown: 0,
  };
  const errorCounts: Map<string, number> = new Map();
  const endpointCounts: Map<string, number> = new Map();
  const routeChecks: { total: number; matched: number } = { total: 0, matched: 0 };
  const accidentalExecInChat = { total: 0 };
  const latencySamples: number[] = [];

  for (const session of results) {
    for (const action of session.actions) {
      latencySamples.push(action.latencyMs);
      endpointCounts.set(action.endpoint, (endpointCounts.get(action.endpoint) || 0) + 1);

      if (action.expectedRoute) {
        routeChecks.total += 1;
        if (action.expectedRoute === action.actualRoute) {
          routeChecks.matched += 1;
        }
      }

      if (action.status === 'ok') actionOk += 1;
      if (action.status === 'fail') {
        actionFail += 1;
        const cls = action.failureClass || classifyFailure(action.error, { category: action.category, chain: action.chain });
        byClass[cls] += 1;

        const key = `${action.endpoint} :: ${action.error || 'unknown error'}`;
        errorCounts.set(key, (errorCounts.get(key) || 0) + 1);

        if (cls === 'guardrail_failure' && action.error?.includes('chat route returned execute')) {
          accidentalExecInChat.total += 1;
        }
      }
      if (action.status === 'skipped') actionSkipped += 1;
    }
  }

  const topErrors = [...errorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([error, count]) => ({ error, count }));

  const topEndpoints = [...endpointCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([endpoint, count]) => ({ endpoint, count }));

  const successPct = actionOk + actionFail > 0 ? Number(((actionOk / (actionOk + actionFail)) * 100).toFixed(2)) : 0;
  const routingAccuracyPct = routeChecks.total > 0 ? Number(((routeChecks.matched / routeChecks.total) * 100).toFixed(2)) : 100;

  return {
    mode: MODE,
    sessions: results.length,
    sessionsOk: results.filter(r => r.ok).length,
    sessionsFail: results.filter(r => !r.ok).length,
    actionsOk: actionOk,
    actionsFail: actionFail,
    actionsSkipped: actionSkipped,
    successPct,
    latencyMs: {
      p50: percentile(latencySamples, 50),
      p95: percentile(latencySamples, 95),
    },
    routing: {
      checked: routeChecks.total,
      matched: routeChecks.matched,
      accuracyPct: routingAccuracyPct,
    },
    safety: {
      accidentalExecutePayloadsInChatOnly: accidentalExecInChat.total,
    },
    failureBreakdown: byClass,
    topErrors,
    topEndpoints,
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
  } catch {
    // ignore
  }
}

async function runSessionByMode(sessionIndex: number): Promise<SessionResult> {
  if (MODE === 'chat_only') return runChatOnlySession(sessionIndex);
  if (MODE === 'mixed') return runMixedSession(sessionIndex);
  if (MODE === 'tier1') return runExecutionSession(sessionIndex, 'tier1');
  if (MODE === 'tier2') return runExecutionSession(sessionIndex, 'tier2');
  return runExecutionSession(sessionIndex, 'full');
}

async function main() {
  await hydrateAgentsFromKeys();
  log('🌸 Blossom Live Stress Tester');
  log(`   Base URL: ${BASE_URL}`);
  log(`   Mode: ${MODE}`);
  log(`   Run ID: ${RUN_ID}`);
  log(`   Sessions: ${COUNT}`);
  log(`   Concurrency: ${CONCURRENCY}`);
  log(`   Dry run: ${DRY_RUN ? 'yes' : 'no'}`);
  log(`   Allow execute: ${ALLOW_EXECUTE ? 'yes' : 'no'}`);
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
        const sessionResult = await runSessionByMode(idx);
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
  log(`Mode: ${summary.mode}`);
  log(`Sessions: ${summary.sessions}`);
  log(`Sessions OK: ${summary.sessionsOk}`);
  log(`Sessions Fail: ${summary.sessionsFail}`);
  log(`Actions OK: ${summary.actionsOk}`);
  log(`Actions Fail: ${summary.actionsFail}`);
  log(`Actions Skipped: ${summary.actionsSkipped}`);
  log(`Success %: ${summary.successPct}%`);
  log(`Latency p50/p95: ${summary.latencyMs.p50}ms / ${summary.latencyMs.p95}ms`);
  log(`Routing accuracy: ${summary.routing.accuracyPct}% (${summary.routing.matched}/${summary.routing.checked})`);
  log(`Safety accidental execute payloads in chat-only: ${summary.safety.accidentalExecutePayloadsInChatOnly}`);

  if (OUTPUT_FILE) {
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ runId: RUN_ID, summary, results, mode: MODE }, null, 2));
    log(`\nResults saved to ${OUTPUT_FILE}`);
  }
}

main().catch(err => {
  console.error('❌ Live stress tester failed:', err);
  process.exit(1);
});
