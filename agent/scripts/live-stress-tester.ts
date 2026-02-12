#!/usr/bin/env npx tsx
// @ts-nocheck
/**
 * Live Stress Tester (Curated)
 *
 * Modes:
 * - full: existing multi-step execution stress test
 * - tier1: deterministic suite (Ethereum-heavy, execution enabled)
 * - tier1_relayed_required: deterministic suite requiring relayed execution (no proof-only fallback)
 * - tier1_crosschain_required: deterministic suite requiring Solana->Sepolia credit routing + execution
 * - tier2: realistic suite (cross-chain, venue flakes classified separately)
 * - chat_only: no execution, route=chat assertions only
 * - mixed: research + planning (+ optional explicit execute)
 *
 * Usage examples:
 *   npx tsx agent/scripts/live-stress-tester.ts --baseUrl=https://api.blossom.onl --mode=full --count=100 --concurrency=2
 *   npx tsx agent/scripts/live-stress-tester.ts --mode=chat_only --count=20 --concurrency=4
 *   npx tsx agent/scripts/live-stress-tester.ts --mode=mixed --count=20 --concurrency=4
 *   npx tsx agent/scripts/live-stress-tester.ts --mode=tier1 --allow_execute --count=40 --concurrency=2
 *   npx tsx agent/scripts/live-stress-tester.ts --mode=tier1_crosschain_required --allow_execute --count=10 --concurrency=2
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { isTier1RelayedExecutionSupported, TIER1_SUPPORTED_CHAINS, TIER1_SUPPORTED_VENUES } from '../src/intent/tier1SupportedVenues';

type AgentType = 'human' | 'erc8004';
type Chain = 'ethereum' | 'solana' | 'hyperliquid' | 'both';
type Mode = 'full' | 'tier1' | 'tier1_relayed_required' | 'tier1_crosschain_required' | 'tier2' | 'chat_only' | 'mixed';
type ExpectedRoute = 'chat' | 'planner';
type FailureClass =
  | 'blossom_logic'
  | 'rpc_rate_limit'
  | 'nonce_collision'
  | 'venue_flake'
  | 'erc8004_validation'
  | 'faucet_mint_fail'
  | 'cross_chain_route_failed'
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
  | 'cross_chain_route'
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
  routeType?: string;
  routeDidRoute?: boolean;
  routeFromChain?: string;
  routeToChain?: string;
  routeTxHash?: string;
  creditReceiptConfirmed?: boolean;
  executionReceiptConfirmed?: boolean;
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
const ALLOW_RELAYED_WALLET_FALLBACK = hasFlag('allow_wallet_fallback') || process.env.STRESS_ALLOW_WALLET_FALLBACK === '1';
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
const HL_MAX_RETRIES = parseInt(process.env.STRESS_HL_MAX_RETRIES || '5', 10);
const HL_MIN_SPACING_MIN_MS = parseInt(process.env.STRESS_HL_MIN_SPACING_MIN_MS || '800', 10);
const HL_MIN_SPACING_MAX_MS = parseInt(process.env.STRESS_HL_MIN_SPACING_MAX_MS || '1200', 10);
const HL_RATE_LIMIT_THRESHOLD = parseInt(process.env.STRESS_HL_RATE_LIMIT_THRESHOLD || '3', 10);
const SESSION_PREPARE_RETRY_LIMIT = parseInt(process.env.STRESS_SESSION_PREPARE_RETRIES || '2', 10);
const DESIRED_HL_WALLETS = parseInt(process.env.STRESS_DESIRED_HL_WALLETS || '4', 10);
const EVM_RPC_RETRY_LIMIT = parseInt(process.env.STRESS_EVM_RPC_RETRIES || '3', 10);
const SESSION_ACTIVE_MAX_POLLS = parseInt(process.env.STRESS_SESSION_ACTIVE_POLLS || '6', 10);

const RUN_ID = `live_stress_${MODE}_${Date.now()}_${randomUUID().slice(0, 8)}`;

const agents: AgentState[] = [
  { id: 'human-1', type: 'human' },
  { id: 'human-2', type: 'human' },
  { id: 'erc8004-1', type: 'erc8004' },
  { id: 'erc8004-2', type: 'erc8004' },
];

const walletLocks = new Map<string, Promise<any>>();
const hlLastSubmitAtByWallet = new Map<string, number>();
const hlGlobalSubmitLockKey = '__hyperliquid_global_submit_lock__';
const rotatedWalletPool: Array<{ walletAddress?: string; privateKey?: string }> = [];
const sessionCacheByWallet = new Map<string, { sessionId: string; updatedAt: number }>();
let globalExecuteDisabledReason: string | null = null;

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

const maxWalletRows = Math.max(WALLET_KEYS.length, WALLET_LIST.length);
for (let i = 0; i < maxWalletRows; i += 1) {
  rotatedWalletPool.push({
    privateKey: WALLET_KEYS[i],
    walletAddress: WALLET_LIST[i],
  });
}
if (rotatedWalletPool.length === 0 && STRESS_EVM_ADDRESS) {
  rotatedWalletPool.push({ walletAddress: STRESS_EVM_ADDRESS });
}

if (!ALLOW_NON_PROD && !BASE_URL.includes('blossom.onl') && !BASE_URL.includes('vercel.app') && !BASE_URL.includes('localhost')) {
  console.error(`❌ Refusing to run against non-prod baseUrl: ${BASE_URL}`);
  console.error('   Use --allow-non-prod to override.');
  process.exit(1);
}

const modeRequiresLedger =
  MODE === 'full' ||
  MODE === 'tier1' ||
  MODE === 'tier1_relayed_required' ||
  MODE === 'tier1_crosschain_required' ||
  MODE === 'tier2' ||
  (MODE === 'mixed' && ALLOW_EXECUTE);
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

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function lowerErrorText(input: string | undefined): string {
  return String(input || '').toLowerCase();
}

function isHyperliquidRateLimitError(input: string | undefined): boolean {
  const lower = lowerErrorText(input);
  return (
    lower.includes('request exceeds defined limit') ||
    lower.includes('too many evm txs submitted') ||
    lower.includes('rate limited') ||
    lower.includes('rate limit') ||
    lower.includes('429')
  );
}

function isNonceError(input: string | undefined): boolean {
  const lower = lowerErrorText(input);
  return (
    lower.includes('nonce') ||
    lower.includes('replacement transaction underpriced') ||
    lower.includes('already known')
  );
}

function isFunctionInvocationFailed(input: string | undefined): boolean {
  const lower = lowerErrorText(input);
  return lower.includes('function_invocation_failed') || lower.includes('function_invocation_timeout');
}

function isRetryableReceiptOrRpcError(input: string | undefined): boolean {
  const lower = lowerErrorText(input);
  return (
    lower.includes('timed out while waiting for transaction') ||
    lower.includes('waitfortransactionreceipt') ||
    lower.includes('request timed out') ||
    lower.includes('gateway timeout') ||
    lower.includes('etimedout') ||
    isHyperliquidRateLimitError(lower)
  );
}

function isBalanceOrMintPreconditionError(input: string | undefined): boolean {
  const lower = lowerErrorText(input);
  return (
    lower.includes('insufficient') ||
    lower.includes('collateral') ||
    lower.includes('balance') ||
    lower.includes('faucet') ||
    lower.includes('mint') ||
    lower.includes('fund') ||
    lower.includes('not enough')
  );
}

function isHyperliquidGasOrProofCapacityError(input: string | undefined): boolean {
  const lower = lowerErrorText(input);
  return (
    lower.includes('insufficient funds for gas') ||
    lower.includes('gas required exceeds allowance') ||
    lower.includes('out of gas') ||
    lower.includes('proof_tx_failed')
  );
}

function retryBackoffMs(attempt: number, baseMs = 600, capMs = 12000): number {
  const exponential = Math.min(capMs, baseMs * Math.pow(2, attempt));
  const jitter = randomBetween(150, 700);
  return exponential + jitter;
}

function printFailureDiagnostics(endpoint: string, status: number, bodyJson: any, bodyText: string) {
  const payload = bodyJson ?? bodyText ?? null;
  console.error(`[diag][${endpoint}] status=${status} payload=${typeof payload === 'string' ? payload : JSON.stringify(payload)}`);
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
    return (agent.walletAddress || STRESS_HYPERLIQUID_ADDRESS || STRESS_EVM_ADDRESS || 'wallet:shared').toLowerCase();
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

async function withHyperliquidSubmissionGate<T>(agent: AgentState, fn: () => Promise<T>): Promise<T> {
  const walletKey = getLockKey(agent, 'hyperliquid');
  return withWalletLock(hlGlobalSubmitLockKey, async () => {
    const now = Date.now();
    const lastSentAt = hlLastSubmitAtByWallet.get(walletKey) || 0;
    const minSpacing = randomBetween(HL_MIN_SPACING_MIN_MS, HL_MIN_SPACING_MAX_MS);
    const waitMs = Math.max(0, minSpacing - (now - lastSentAt));
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    hlLastSubmitAtByWallet.set(walletKey, Date.now());
    return fn();
  });
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

function isWalletGasFundingError(text: string | undefined): boolean {
  const lower = lowerErrorText(text);
  return (
    lower.includes('insufficient funds for gas') ||
    lower.includes('gas required exceeds allowance') ||
    lower.includes('insufficient funds') ||
    lower.includes('max fee per gas') && lower.includes('exceeds')
  );
}

async function maybeFundEvmWalletFromRelayer(
  toAddress: string,
  options?: { minEth?: number; targetEth?: number }
): Promise<{ ok: boolean; funded: boolean; txHash?: string; error?: string }> {
  const relayerPkRaw = String(process.env.RELAYER_PRIVATE_KEY || '').trim();
  if (!ETH_RPC_URL) return { ok: false, funded: false, error: 'missing_eth_rpc_url' };
  if (!relayerPkRaw) return { ok: false, funded: false, error: 'missing_relayer_private_key' };
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(toAddress || '').trim())) {
    return { ok: false, funded: false, error: 'invalid_to_address' };
  }

  const minEth = Number.isFinite(options?.minEth) ? Number(options?.minEth) : 0.006;
  const targetEth = Number.isFinite(options?.targetEth) ? Number(options?.targetEth) : 0.02;
  try {
    const { createWalletClient, createPublicClient, http, parseEther, formatEther } = await import('viem');
    const { sepolia } = await import('viem/chains');
    const { privateKeyToAccount } = await import('viem/accounts');

    const relayerPk = relayerPkRaw.startsWith('0x') ? relayerPkRaw : `0x${relayerPkRaw}`;
    const account = privateKeyToAccount(relayerPk as `0x${string}`);
    const publicClient = createPublicClient({ chain: sepolia, transport: http(ETH_RPC_URL) });
    const walletClient = createWalletClient({ account, chain: sepolia, transport: http(ETH_RPC_URL) });

    const currentWei = await publicClient.getBalance({ address: toAddress as `0x${string}` });
    const currentEth = Number(formatEther(currentWei));
    if (Number.isFinite(currentEth) && currentEth >= minEth) {
      return { ok: true, funded: false };
    }

    const deltaEth = Math.max(targetEth - (Number.isFinite(currentEth) ? currentEth : 0), 0.0);
    const valueWei = parseEther(deltaEth.toFixed(6));
    if (valueWei <= 0n) return { ok: true, funded: false };

    const txHash = await walletClient.sendTransaction({
      to: toAddress as `0x${string}`,
      value: valueWei,
    });
    try {
      await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 45_000 });
    } catch {
      // Best-effort; caller can retry.
    }
    return { ok: true, funded: true, txHash };
  } catch (error: any) {
    return { ok: false, funded: false, error: error?.message || String(error) };
  }
}

async function confirmSepoliaReceipt(txHash: string): Promise<boolean> {
  if (!txHash || !ETH_RPC_URL) return false;
  try {
    const { createPublicClient, http } = await import('viem');
    const { sepolia } = await import('viem/chains');
    const publicClient = createPublicClient({ chain: sepolia, transport: http(ETH_RPC_URL) });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: txHash as `0x${string}`,
          timeout: 35_000,
        });
        return receipt?.status === 'success';
      } catch (error: any) {
        const lower = lowerErrorText(error?.message || String(error));
        if (!isRetryableReceiptOrRpcError(lower) && !isHyperliquidRateLimitError(lower)) {
          break;
        }
        await sleep(retryBackoffMs(attempt, 800, 8000));
      }
    }
  } catch {
    return false;
  }
  return false;
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

function buildPerpOpenAction(sessionIndex: number, forcedChain?: Chain): Action {
  const amount = randInt(50, 200);
  const chain: Chain = forcedChain || 'hyperliquid';
  const leverage = chain === 'hyperliquid' ? randInt(3, 10) : randInt(2, 6);
  const direction = sessionIndex % 2 === 0 ? 'long' : 'short';
  const asset = sessionIndex % 2 === 0 ? 'BTC' : 'ETH';
  const venue = chain === 'hyperliquid' ? 'Hyperliquid' : 'Ethereum Sepolia';
  return {
    id: buildActionId('perp', sessionIndex),
    category: 'perp',
    chain,
    intentText: `Open ${direction} ${asset} perp ${leverage}x for $${amount} on ${venue}`,
  };
}

function buildPerpCloseAction(sessionIndex: number, forcedChain?: Chain): Action {
  const asset = sessionIndex % 2 === 0 ? 'BTC' : 'ETH';
  const chain: Chain = forcedChain || 'hyperliquid';
  const venue = chain === 'hyperliquid' ? 'Hyperliquid' : 'Ethereum Sepolia';
  return {
    id: buildActionId('perp_close', sessionIndex),
    category: 'perp_close',
    chain,
    intentText: `Close my ${asset} perp position on ${venue}`,
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

function buildSolanaOriginToSepoliaPerpAction(sessionIndex: number): Action {
  // Keep margin above DemoPerpEngine minimums so cross-chain proof runs are deterministic.
  const collateral = pick([300, 350, 400]);
  return {
    id: buildActionId('cross_chain_route', sessionIndex),
    category: 'cross_chain_route',
    chain: 'ethereum',
    intentText: `Open a BTC long perp on Sepolia with ${collateral} bUSDC collateral and 3x leverage. Source funds from Solana devnet.`,
    metadata: {
      scenario: 'solana_origin_to_sepolia_perp',
      fromChain: 'solana_devnet',
      toChain: 'sepolia',
      amountUsd: collateral,
      amountUsdRequired: collateral,
      expectedRouteType: 'testnet_credit',
      userSolanaAddress: STRESS_SOLANA_ADDRESS || undefined,
      forceCrossChainRoute: true,
    },
  };
}

function buildSessionActions(sessionIndex: number, mode: Mode): Action[] {
  if (mode === 'tier1' || mode === 'tier1_relayed_required' || mode === 'tier1_crosschain_required') {
    const tier1Actions: Action[] = [
      buildSwapAction(sessionIndex, 'ethereum'),
      buildDepositAction(sessionIndex, 'ethereum'),
      buildEventOpenAction(sessionIndex),
      buildPerpOpenAction(sessionIndex, 'ethereum'),
      buildPerpCloseAction(sessionIndex, 'ethereum'),
      buildEventCloseAction(sessionIndex),
    ];

    if (mode === 'tier1_crosschain_required') {
      const crossChainTier1Actions = tier1Actions.filter(action =>
        ['swap', 'deposit', 'perp', 'perp_close'].includes(action.category)
      );
      return [
        buildSolanaOriginToSepoliaPerpAction(sessionIndex),
        ...crossChainTier1Actions.filter(action =>
          isTier1RelayedExecutionSupported({ chain: action.chain, category: action.category })
        ),
      ];
    }

    if (mode === 'tier1_relayed_required') {
      return tier1Actions.filter(action =>
        isTier1RelayedExecutionSupported({ chain: action.chain, category: action.category })
      );
    }

    return tier1Actions;
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
  if (action.category === 'cross_chain_route' || lower.includes('cross_chain_route')) return 'cross_chain_route_failed';
  if (lower.includes('unsupported_venue') || lower.includes('proof_only_blocked')) return 'venue_flake';
  if (lower.includes('guardrail') || lower.includes('route mismatch') || lower.includes('hallucination')) return 'guardrail_failure';
  if (isHyperliquidRateLimitError(lower) || lower.includes('too many requests') || lower.includes('gateway timeout') || lower.includes('timed out')) return 'rpc_rate_limit';
  if (isHyperliquidGasOrProofCapacityError(lower)) return 'venue_flake';
  if (isNonceError(lower)) return 'nonce_collision';
  if (lower.includes('jupiter') || lower.includes('liquidity') || lower.includes('venue') || lower.includes('quote') || lower.includes('devnet')) return 'venue_flake';
  if (
    lower.includes('path_violation') ||
    lower.includes('missing_execution_request') ||
    lower.includes('route mismatch') ||
    lower.includes('wrong venue') ||
    lower.includes('malformed executionrequest') ||
    lower.includes('malformed actions')
  ) {
    return 'blossom_logic';
  }
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

function isVercelInvocationFailure(text: string | undefined): boolean {
  const lower = String(text || '').toLowerCase();
  return lower.includes('function_invocation_failed');
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
    const target = agent?.walletAddress || STRESS_HYPERLIQUID_ADDRESS || STRESS_EVM_ADDRESS;
    if (!target) return null;
    return { userAddress: target, chain: 'hyperliquid', amount };
  }
  const target = agent?.walletAddress || STRESS_EVM_ADDRESS;
  if (!target) return null;
  return { userAddress: target, chain: 'ethereum', amount };
}

async function runMint(agent: AgentState, chain: Chain, opts?: { skipLock?: boolean }): Promise<ActionResult> {
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
      status: 'skipped' as const,
      latencyMs: latency,
      error: errorMessage,
      failureClass: classifyFailure(errorMessage, { category: 'mint', chain }),
    };
  };

  if (!isEvmActionChain(chain) || opts?.skipLock) {
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
    if (globalExecuteDisabledReason) {
      return {
        actionId: action.id,
        category: action.category,
        chain: action.chain,
        endpoint,
        status: 'skipped' as const,
        latencyMs: Date.now() - started,
        error: `global_execute_disabled: ${globalExecuteDisabledReason}`,
        failureClass: 'venue_flake' as FailureClass,
      };
    }

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

    const backendCategory = action.category === 'cross_chain_route' ? 'perp' : action.category;
    const actionSolanaAddress = (action.metadata?.userSolanaAddress as string | undefined) || undefined;
    const actionFromChain = (action.metadata?.fromChain as string | undefined) || undefined;
    const actionToChain = (action.metadata?.toChain as string | undefined) || undefined;

    const metadata = {
      runId: RUN_ID,
      sessionId,
      agentId: agent.id,
      agentType: agent.type,
      category: backendCategory,
      chain: action.chain,
      source: 'live_stress_tester',
      mode: MODE,
      userAddress: agent.walletAddress || STRESS_EVM_ADDRESS || undefined,
      userSolanaAddress: actionSolanaAddress,
      fromChain: actionFromChain || (action.chain === 'solana' ? 'solana_devnet' : undefined),
      toChain: actionToChain || (action.chain === 'ethereum' ? 'sepolia' : undefined),
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

    const maxRateRetries = action.chain === 'hyperliquid' ? HL_MAX_RETRIES : EVM_RPC_RETRY_LIMIT;
    let attempt = 0;
    let preconditionRetried = false;
    let functionFailureRetries = 0;
    let sessionNotActiveRetries = 0;

    while (true) {
      const sendRequest = async () =>
        fetchJson(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        }, 90000);

      const res = action.chain === 'hyperliquid'
        ? await withHyperliquidSubmissionGate(agent, sendRequest)
        : await sendRequest();

      // Vercel can return transient invocation failures under load.
      // Retry once for deterministic suites.
      let effectiveRes = res;
      if (
        !effectiveRes.ok &&
        endpoint === '/api/ledger/intents/execute' &&
        isVercelInvocationFailure(effectiveRes.text) &&
        (MODE === 'tier1' || MODE === 'tier1_relayed_required' || MODE === 'tier1_crosschain_required') &&
        functionFailureRetries < 1
      ) {
        functionFailureRetries += 1;
        await sleep(650 + Math.floor(Math.random() * 500));
        effectiveRes = action.chain === 'hyperliquid'
          ? await withHyperliquidSubmissionGate(agent, sendRequest)
          : await sendRequest();
      }

      const latency = Date.now() - started;
      if (effectiveRes.ok && effectiveRes.json?.ok) {
        const executedKind = String(effectiveRes.json?.metadata?.executedKind || '').toLowerCase();
        const isProofOnly = executedKind === 'proof_only';
        const isQueuedResponse = effectiveRes.json?.queued === true || String(effectiveRes.json?.status || '').toLowerCase() === 'queued';
        const isWalletFallback =
          String(effectiveRes.json?.mode || '').toLowerCase() === 'wallet_fallback' ||
          effectiveRes.json?.needs_wallet_signature === true;
        const routeMeta = effectiveRes.json?.executionMeta?.route;
        const routeType = String(routeMeta?.routeType || '');
        const routeDidRoute = routeMeta?.didRoute === true;
        const routeFromChain = String(routeMeta?.fromChain || '');
        const routeToChain = String(routeMeta?.toChain || '');
        const executionTxHash = effectiveRes.json?.txHash || effectiveRes.json?.execution?.txHash;
        const creditTxHash = routeMeta?.txHash;
        const txHash = executionTxHash || creditTxHash;

        if (MODE === 'tier1_relayed_required' || MODE === 'tier1_crosschain_required') {
          if (isProofOnly) {
            return {
              actionId: action.id,
              category: action.category,
              chain: action.chain,
              endpoint,
              status: 'fail' as const,
              latencyMs: latency,
              error: 'relayed_required_violation: proof-only execution returned',
              failureClass: 'blossom_logic' as FailureClass,
              intentId: effectiveRes.json?.intentId,
            };
          }
          if (isQueuedResponse) {
            return {
              actionId: action.id,
              category: action.category,
              chain: action.chain,
              endpoint,
              status: 'fail' as const,
              latencyMs: latency,
              error: 'relayed_required_violation: execution remained queued',
              failureClass: 'rpc_rate_limit' as FailureClass,
              intentId: effectiveRes.json?.intentId,
              routeType,
              routeDidRoute,
              routeFromChain,
              routeToChain,
              routeTxHash: txHash,
            };
          }
          if (isWalletFallback && !ALLOW_RELAYED_WALLET_FALLBACK) {
            return {
              actionId: action.id,
              category: action.category,
              chain: action.chain,
              endpoint,
              status: 'fail' as const,
              latencyMs: latency,
              error: 'relayed_required_violation: wallet fallback requested',
              failureClass: 'blossom_logic' as FailureClass,
              intentId: effectiveRes.json?.intentId,
              routeType,
              routeDidRoute,
              routeFromChain,
              routeToChain,
              routeTxHash: txHash,
            };
          }
          if (MODE === 'tier1_crosschain_required' && action.category === 'cross_chain_route') {
            const normalizedRouteType = routeType.toLowerCase();
            const didRoute = routeDidRoute;
            const hasCreditTx = !!creditTxHash;
            const hasExecutionTx = !!executionTxHash;
            const creditReceiptConfirmed = hasCreditTx ? await confirmSepoliaReceipt(creditTxHash) : false;
            const executionReceiptConfirmed = hasExecutionTx ? await confirmSepoliaReceipt(executionTxHash) : false;
            if (
              !didRoute ||
              normalizedRouteType !== 'testnet_credit' ||
              routeToChain.toLowerCase() !== 'sepolia' ||
              !hasCreditTx ||
              !hasExecutionTx ||
              !creditReceiptConfirmed ||
              !executionReceiptConfirmed
            ) {
              return {
                actionId: action.id,
                category: action.category,
                chain: action.chain,
                endpoint,
                status: 'fail' as const,
                latencyMs: latency,
                error: `cross_chain_route_assertion_failed: didRoute=${didRoute} routeType=${normalizedRouteType || 'missing'} toChain=${routeToChain || 'missing'} creditTx=${hasCreditTx ? 'present' : 'missing'} creditReceipt=${creditReceiptConfirmed ? 'confirmed' : 'missing'} execTx=${hasExecutionTx ? 'present' : 'missing'} execReceipt=${executionReceiptConfirmed ? 'confirmed' : 'missing'}`,
                failureClass: 'cross_chain_route_failed' as FailureClass,
                intentId: effectiveRes.json?.intentId,
                routeType,
                routeDidRoute,
                routeFromChain,
                routeToChain,
                routeTxHash: creditTxHash,
                txHash: executionTxHash,
                creditReceiptConfirmed,
                executionReceiptConfirmed,
              };
            }

            return {
              actionId: action.id,
              category: action.category,
              chain: action.chain,
              endpoint,
              status: 'ok' as const,
              latencyMs: latency,
              txHash: executionTxHash,
              intentId: effectiveRes.json?.intentId,
              routeType,
              routeDidRoute,
              routeFromChain,
              routeToChain,
              routeTxHash: creditTxHash,
              creditReceiptConfirmed,
              executionReceiptConfirmed,
            };
          }
        }

        return {
          actionId: action.id,
          category: action.category,
          chain: action.chain,
          endpoint,
          status: 'ok' as const,
          latencyMs: latency,
          txHash,
          intentId: effectiveRes.json?.intentId,
          routeType,
          routeDidRoute,
          routeFromChain,
          routeToChain,
          routeTxHash: txHash,
        };
      }

      printFailureDiagnostics(endpoint, effectiveRes.status, effectiveRes.json, effectiveRes.text);
      const error = normalizeStableSymbols(effectiveRes.json?.error?.message || effectiveRes.json?.error || effectiveRes.text || 'execution failed');
      const failureClass = classifyFailure(error, { category: action.category, chain: action.chain });
      const lowerError = lowerErrorText(error);
      const errorCode = String(
        effectiveRes.json?.error?.detailCode ||
          effectiveRes.json?.errorCode ||
          effectiveRes.json?.error?.code ||
          effectiveRes.json?.code ||
          ''
      ).toUpperCase();

      // Cross-chain credit can legitimately take >1 block. In crosschain_required, wait for the credit receipt then retry.
      if (
        MODE === 'tier1_crosschain_required' &&
        action.category === 'cross_chain_route' &&
        errorCode === 'CROSS_CHAIN_ROUTE_PENDING' &&
        attempt < 6
      ) {
        const pendingCreditTx = String(effectiveRes.json?.executionMeta?.route?.txHash || '');
        if (pendingCreditTx) {
          await confirmSepoliaReceipt(pendingCreditTx);
        }
        attempt += 1;
        await sleep(retryBackoffMs(attempt, 1200, 9000));
        continue;
      }

      if ((MODE === 'tier1_relayed_required' || MODE === 'tier1_crosschain_required') && errorCode === 'UNSUPPORTED_VENUE') {
        const skipAsFailForCrossChainRequired = MODE === 'tier1_crosschain_required' && action.category === 'cross_chain_route';
        return {
          actionId: action.id,
          category: action.category,
          chain: action.chain,
          endpoint,
          status: skipAsFailForCrossChainRequired ? 'fail' as const : 'skipped' as const,
          latencyMs: latency,
          error,
          failureClass: skipAsFailForCrossChainRequired ? 'cross_chain_route_failed' as FailureClass : 'venue_flake' as FailureClass,
        };
      }

      // Confirm requests are idempotent: if plan already moved to executing, treat as success.
      if (options?.intentId && lowerError.includes('invalid_status') && lowerError.includes("expected 'planned'") && lowerError.includes('executing')) {
        return {
          actionId: action.id,
          category: action.category,
          chain: action.chain,
          endpoint,
          status: 'ok' as const,
          latencyMs: latency,
          intentId: options.intentId,
        };
      }

      // If confirm follows a failed execute, don't fail the whole session twice.
      if (options?.intentId && lowerError.includes('invalid_status') && lowerError.includes("expected 'planned'") && lowerError.includes('failed')) {
        return {
          actionId: action.id,
          category: action.category,
          chain: action.chain,
          endpoint,
          status: 'skipped' as const,
          latencyMs: latency,
          error,
          failureClass: failureClass || 'unknown',
          intentId: options.intentId,
        };
      }

      if (
        !preconditionRetried &&
        isBalanceOrMintPreconditionError(error) &&
        !(action.chain === 'hyperliquid' && isHyperliquidGasOrProofCapacityError(error)) &&
        (action.chain === 'ethereum' || action.chain === 'hyperliquid')
      ) {
        preconditionRetried = true;
        const mintChain: Chain =
          action.category === 'cross_chain_route'
            ? 'solana'
            : action.chain === 'hyperliquid'
              ? 'hyperliquid'
              : 'ethereum';
        const mintResult = await runMint(agent, mintChain, { skipLock: true });
        if (mintResult.status === 'ok' || mintResult.status === 'skipped') {
          await sleep(300);
          continue;
        }
      }

      if (isFunctionInvocationFailed(error) && functionFailureRetries < 2) {
        await sleep(retryBackoffMs(functionFailureRetries, 500, 5000));
        functionFailureRetries += 1;
        continue;
      }

      if (isFunctionInvocationFailed(error)) {
        const skipAsFailForCrossChainRequired = MODE === 'tier1_crosschain_required' && action.category === 'cross_chain_route';
        return {
          actionId: action.id,
          category: action.category,
          chain: action.chain,
          endpoint,
          status: skipAsFailForCrossChainRequired ? 'fail' as const : 'skipped' as const,
          latencyMs: latency,
          error,
          failureClass: skipAsFailForCrossChainRequired ? 'cross_chain_route_failed' as FailureClass : 'rpc_rate_limit' as FailureClass,
        };
      }

      if (failureClass === 'venue_flake') {
        if (lowerError.includes('insufficient funds for gas') || lowerError.includes('gas required exceeds allowance')) {
          globalExecuteDisabledReason = 'relayer gas depleted';
        }
        const skipAsFailForCrossChainRequired = MODE === 'tier1_crosschain_required' && action.category === 'cross_chain_route';
        return {
          actionId: action.id,
          category: action.category,
          chain: action.chain,
          endpoint,
          status: skipAsFailForCrossChainRequired ? 'fail' as const : 'skipped' as const,
          latencyMs: latency,
          error,
          failureClass: skipAsFailForCrossChainRequired ? 'cross_chain_route_failed' as FailureClass : failureClass,
        };
      }

      if (lowerError.includes('session_not_active') && sessionNotActiveRetries < 2) {
        sessionNotActiveRetries += 1;
        await waitForSessionActive(agent, { maxPolls: 4, pollMs: 1500 });
        continue;
      }

      if ((failureClass === 'rpc_rate_limit' || isRetryableReceiptOrRpcError(lowerError)) && attempt < maxRateRetries) {
        const backoffMs = retryBackoffMs(attempt);
        logVerbose(`[rpc-backoff] ${agent.id} ${action.category} attempt=${attempt + 1}/${maxRateRetries} wait=${backoffMs}ms`);
        attempt += 1;
        await sleep(backoffMs);
        continue;
      }

      return {
        actionId: action.id,
        category: action.category,
        chain: action.chain,
        endpoint,
        status: 'fail' as const,
        latencyMs: latency,
        error,
        failureClass,
      };
    }
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

    let attempt = 0;
    let preconditionRetried = false;

    while (true) {
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
            status: 'skipped' as const,
            latencyMs: Date.now() - started,
            error: 'Missing wallet private key or ETH_RPC_URL for session signing',
            failureClass: 'unknown' as FailureClass,
          };
        }

        try {
          const { walletClient, publicClient } = client;
          const value = valueRaw ? BigInt(valueRaw) : BigInt(0);

          let txHash: string | null = null;
          let fundedRetry = false;
          const sendSessionTx = async () =>
            walletClient.sendTransaction({
              to,
              data,
              value,
            });

          while (true) {
            try {
              txHash = await sendSessionTx();
              break;
            } catch (err: any) {
              const msg = normalizeStableSymbols(err?.shortMessage || err?.message || String(err));
              if (!fundedRetry && isWalletGasFundingError(msg)) {
                fundedRetry = true;
                const fund = await maybeFundEvmWalletFromRelayer(String(agent.walletAddress), {
                  minEth: 0.006,
                  targetEth: 0.02,
                });
                if (fund.ok) {
                  await sleep(1200);
                  continue;
                }
              }
              throw err;
            }
          }

          try {
            await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}`, timeout: 15000 });
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
              status: 'skipped' as const,
              latencyMs: Date.now() - started,
              error,
              failureClass: classifyFailure(error, { category: 'session', chain: 'ethereum' }),
            };
          }
        } catch (err: any) {
          const error = normalizeStableSymbols(err?.shortMessage || err?.message || String(err) || 'Session signing failed');
          return {
            actionId,
            category: 'session' as Category,
            chain: 'ethereum',
            endpoint,
            status: 'skipped' as const,
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

      printFailureDiagnostics(endpoint, res.status, res.json, res.text);
      const error = normalizeStableSymbols(res.json?.error || res.text || 'session prepare failed');

      if (
        !preconditionRetried &&
        isBalanceOrMintPreconditionError(error)
      ) {
        preconditionRetried = true;
        const mintResult = await runMint(agent, 'ethereum', { skipLock: true });
        if (mintResult.status === 'ok' || mintResult.status === 'skipped') {
          await sleep(300);
          continue;
        }
      }

      if (isFunctionInvocationFailed(error) && attempt < SESSION_PREPARE_RETRY_LIMIT) {
        const waitMs = retryBackoffMs(attempt, 400, 3000);
        attempt += 1;
        await sleep(waitMs);
        continue;
      }

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
    }
  };

  return withWalletLock(getLockKey(agent, 'ethereum'), execute);
}

async function waitForSessionActive(
  agent: AgentState,
  options?: { maxPolls?: number; pollMs?: number }
): Promise<boolean> {
  if (!agent.sessionId || !agent.walletAddress) {
    return false;
  }

  const maxPolls = options?.maxPolls ?? SESSION_ACTIVE_MAX_POLLS;
  const pollMs = options?.pollMs ?? 1500;
  const endpoint = `/api/session/status?sessionId=${encodeURIComponent(agent.sessionId)}&userAddress=${encodeURIComponent(agent.walletAddress)}`;

  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const res = await fetchJson(endpoint, {
      method: 'GET',
      headers: buildHeaders(agent),
    }, 20_000);

    if (res.ok && res.json) {
      const enabled = res.json?.session?.enabled === true;
      const status = String(res.json?.status || '').toLowerCase();
      if (enabled && (status === 'active' || status === 'enabled' || status === 'valid')) {
        return true;
      }
    }

    await sleep(pollMs);
  }

  return false;
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
    cross_chain_route: 'perp',
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
    cross_chain_route: 'demo_perp',
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

function getRotatedWalletForSession(sessionIndex: number): { walletAddress?: string; privateKey?: string } | null {
  if (!rotatedWalletPool.length) return null;
  const idx = sessionIndex % rotatedWalletPool.length;
  return rotatedWalletPool[idx] || null;
}

function applyWalletRotation(agent: AgentState, sessionIndex: number): AgentState {
  const rotated = getRotatedWalletForSession(sessionIndex);
  if (!rotated) return { ...agent };
  return {
    ...agent,
    walletAddress: rotated.walletAddress || agent.walletAddress,
    privateKey: rotated.privateKey || agent.privateKey,
  };
}

function buildEthereumFallbackAction(action: Action, sessionIndex: number): Action {
  const rewrittenIntent = normalizeStableSymbols(
    String(action.intentText || '')
      .replace(/\bon\s+hyperliquid\b/gi, 'on Ethereum Sepolia')
      .replace(/\bhyperliquid\b/gi, 'Ethereum Sepolia')
  );
  return {
    ...action,
    id: buildActionId(action.category, sessionIndex),
    chain: 'ethereum',
    intentText: rewrittenIntent || `Execute ${action.category} intent on Ethereum Sepolia`,
    metadata: {
      ...(action.metadata || {}),
      fallbackFromChain: action.chain,
      fallbackReason: 'hl_rate_limit_circuit_breaker',
    },
  };
}

async function runExecutionSession(sessionIndex: number, mode: Mode): Promise<SessionResult> {
  const agentTemplate = agents[sessionIndex % agents.length];
  const agent = applyWalletRotation(agentTemplate, sessionIndex);
  const sessionId = `sess_${sessionIndex}_${randomUUID().slice(0, 6)}`;
  const startedAt = Date.now();
  let hlRateLimitFailures = 0;
  let hlDisabledForSession = false;

  await ensureAccess(agent);
  if (agent.cookie) {
    agentTemplate.cookie = agent.cookie;
    agentTemplate.accessOk = true;
  }

  const results: ActionResult[] = [];

  if (agent.type === 'human') {
    const cacheKey = String(agent.walletAddress || '').toLowerCase();
    const cached = cacheKey ? sessionCacheByWallet.get(cacheKey) : undefined;
    if (mode === 'tier1_crosschain_required' && cached && !agent.sessionId) {
      agent.sessionId = cached.sessionId;
    }

    if (mode === 'tier1_crosschain_required' && cached) {
      const active = await waitForSessionActive(agent, { maxPolls: 2, pollMs: 800 });
      if (active) {
        results.push({
          actionId: buildActionId('session', sessionIndex),
          category: 'session',
          chain: 'ethereum',
          endpoint: '/api/session/prepare',
          status: 'ok',
          latencyMs: 0,
        });
      } else {
        const sessionPrepare = await runSessionPrepare(agent);
        results.push(sessionPrepare);
      }
    } else {
      const sessionPrepare = await runSessionPrepare(agent);
      results.push(sessionPrepare);
    }

    const sessionPrepare = results[results.length - 1];
    if (sessionPrepare.status !== 'ok') {
      if (mode === 'tier1_crosschain_required' && sessionPrepare.status === 'skipped') {
        results[results.length - 1] = {
          ...sessionPrepare,
          status: 'fail',
          error: `cross_chain_route_required_violation: session_prepare_skipped (${sessionPrepare.error || 'unknown'})`,
          failureClass: 'cross_chain_route_failed',
        };
      }
      const finishedAt = Date.now();
      const modeStrict = mode === 'tier1_crosschain_required';
      return {
        sessionId,
        agentId: agent.id,
        agentType: agent.type,
        ok: modeStrict ? results.every(r => r.status === 'ok') : results.every(r => r.status === 'ok' || r.status === 'skipped'),
        actions: results,
        startedAt,
        finishedAt,
      };
    }

    if (cacheKey && agent.sessionId) {
      sessionCacheByWallet.set(cacheKey, { sessionId: agent.sessionId, updatedAt: Date.now() });
      agentTemplate.sessionId = agent.sessionId;
    }

    const sessionActive = await waitForSessionActive(agent, {
      maxPolls: SESSION_ACTIVE_MAX_POLLS,
      pollMs: 1500,
    });
    if (!sessionActive) {
      results.push({
        actionId: buildActionId('session', sessionIndex),
        category: 'session',
        chain: 'ethereum',
        endpoint: '/api/session/status',
        status: 'skipped',
        latencyMs: Date.now() - startedAt,
        error: 'SESSION_NOT_ACTIVE after prepare gating; skipped execute actions for this session',
        failureClass: 'rpc_rate_limit',
      });
      if (mode === 'tier1_crosschain_required') {
        results[results.length - 1] = {
          ...results[results.length - 1],
          status: 'fail',
          error: 'cross_chain_route_required_violation: session_not_active_after_prepare',
          failureClass: 'cross_chain_route_failed',
        };
      }
      const finishedAt = Date.now();
      const modeStrict = mode === 'tier1_crosschain_required';
      return {
        sessionId,
        agentId: agent.id,
        agentType: agent.type,
        ok: modeStrict ? results.every(r => r.status === 'ok') : results.every(r => r.status === 'ok' || r.status === 'skipped'),
        actions: results,
        startedAt,
        finishedAt,
      };
    }
  }

  const mintOptions: Chain[] =
    mode === 'tier1_relayed_required'
      ? ['ethereum']
      : mode === 'tier1_crosschain_required'
        ? ['solana']
      : (MINT_CHAINS.length ? MINT_CHAINS : ['ethereum']);
  const mintChain = pick(mintOptions);
  results.push(await runMint(agent, mintChain));

  results.push(await runChat(agent, 'Analyze BTC trends in 2 sentences.', { route: 'chat', research: true, category: 'research' }));
  results.push(await runChat(agent, 'Hedge BTC/ETH with a short BTC perp for $150. Provide a quick plan only.', { route: 'planner', allowProposalActions: true, category: 'capability' }));

  const actions = buildSessionActions(sessionIndex, mode);
  for (const action of actions) {
    const isHyperliquidAction = action.chain === 'hyperliquid';
    if (hlDisabledForSession && isHyperliquidAction) {
      const fallbackAction = buildEthereumFallbackAction(action, sessionIndex);
      const fallbackResult = await executeIntent(agent, sessionId, fallbackAction);
      results.push({
        actionId: action.id,
        category: action.category,
        chain: action.chain,
        endpoint: '/api/ledger/intents/execute',
        status: 'skipped',
        latencyMs: fallbackResult.latencyMs,
        error: `HL circuit-breaker active: fallback executed on Ethereum (${fallbackResult.status})`,
        failureClass: 'rpc_rate_limit',
      });
      results.push(fallbackResult);
      await sleep(mode === 'tier1' ? 250 : 400);
      continue;
    }

    if (agent.type === 'erc8004') {
      results.push(await validateErc8004(agent, action));
    }

    let actionResults: ActionResult[] = [];
    if (agent.type === 'human' && action.category === 'swap') {
      const planned = await executePlanAndConfirm(agent, sessionId, action);
      actionResults = planned;
    } else {
      actionResults = [await executeIntent(agent, sessionId, action)];
    }

    if (mode === 'tier1_crosschain_required' && action.category === 'cross_chain_route') {
      actionResults = actionResults.map(result => {
        const userCancelled = /user\s+cancel/i.test(String(result.error || ''));
        if (result.status === 'skipped' && !userCancelled) {
          return {
            ...result,
            status: 'fail' as const,
            error: `cross_chain_route_required_violation: skipped (${result.error || 'unknown'})`,
            failureClass: 'cross_chain_route_failed' as FailureClass,
          };
        }
        return result;
      });
    }

    const latestFailure = [...actionResults]
      .reverse()
      .find(
        r =>
          r.status === 'fail' &&
          r.chain === 'hyperliquid' &&
          (r.failureClass === 'rpc_rate_limit' || r.failureClass === 'venue_flake')
      );
    if (latestFailure) {
      hlRateLimitFailures += 1;
    }

    if (isHyperliquidAction && latestFailure && hlRateLimitFailures >= HL_RATE_LIMIT_THRESHOLD) {
      hlDisabledForSession = true;
      const fallbackAction = buildEthereumFallbackAction(action, sessionIndex);
      const fallbackResult = await executeIntent(agent, sessionId, fallbackAction);
      actionResults = actionResults.map(result => {
        if (
          result.status === 'fail' &&
          result.chain === 'hyperliquid' &&
          (result.failureClass === 'rpc_rate_limit' || result.failureClass === 'venue_flake')
        ) {
          return {
            ...result,
            status: 'skipped' as const,
            error: `${result.error || 'hyperliquid rate limit'} | fallback: ${fallbackResult.status} on ethereum`,
          };
        }
        return result;
      });
      actionResults.push(fallbackResult);
    }

    results.push(...actionResults);
    await sleep(mode === 'tier1' ? 250 : 400);
  }

  if (agent.type === 'human') {
    results.push(await runReset(agent));
  }

  const finishedAt = Date.now();
  const ok =
    mode === 'tier1_crosschain_required'
      ? results.every(r => r.status === 'ok')
      : results.every(r => r.status === 'ok' || r.status === 'skipped');

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
    cross_chain_route_failed: 0,
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
      const hasClassifiedFailure = action.status !== 'ok' && !!action.failureClass;
      if (action.status === 'fail' || hasClassifiedFailure) {
        const cls = action.failureClass || classifyFailure(action.error, { category: action.category, chain: action.chain });
        byClass[cls] += 1;

        const key = `${action.endpoint} :: ${action.error || 'unknown error'}`;
        errorCounts.set(key, (errorCounts.get(key) || 0) + 1);

        if (action.status === 'fail') {
          actionFail += 1;
        }
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

function collectCrossChainProofs(results: SessionResult[]) {
  return results.flatMap(session =>
    session.actions
      .filter(action =>
        action.category === 'cross_chain_route' &&
        action.status === 'ok' &&
        action.routeDidRoute === true &&
        String(action.routeType || '').toLowerCase() === 'testnet_credit' &&
        String(action.routeToChain || '').toLowerCase() === 'sepolia' &&
        !!action.routeTxHash &&
        !!action.txHash &&
        action.creditReceiptConfirmed === true &&
        action.executionReceiptConfirmed === true
      )
      .map(action => ({
        sessionId: session.sessionId,
        agentId: session.agentId,
        originWallet: 'solana',
        routeType: action.routeType,
        toChain: action.routeToChain,
        creditTxHash: action.routeTxHash,
        executionTxHash: action.txHash,
      }))
  );
}

async function hydrateAgentsFromKeys() {
  if (!WALLET_KEYS.length && !rotatedWalletPool.length) return;
  try {
    const { privateKeyToAccount } = await import('viem/accounts');
    rotatedWalletPool.forEach((wallet) => {
      if (wallet.privateKey && !wallet.walletAddress) {
        const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);
        wallet.walletAddress = account.address;
      }
    });
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

async function runRelayedRequiredPreflight(): Promise<void> {
  if ((MODE !== 'tier1_relayed_required' && MODE !== 'tier1_crosschain_required') || DRY_RUN) {
    return;
  }

  const headers: Record<string, string> = {};
  if (LEDGER_SECRET) {
    headers['X-Ledger-Secret'] = LEDGER_SECRET;
  }

  const res = await fetchJson('/api/relayer/status?chain=sepolia', {
    method: 'GET',
    headers,
  }, 30_000);

  if (!res.ok || !res.json) {
    throw new Error(`Relayed preflight failed: unable to fetch /api/relayer/status (${res.status})`);
  }

  if (MODE === 'tier1_crosschain_required') {
    if (!ETH_RPC_URL) {
      throw new Error(
        'tier1_crosschain_required preflight failed: missing ETH RPC URL for receipt confirmation and session signing (set STRESS_TEST_ETH_RPC_URL or ETH_TESTNET_RPC_URL)'
      );
    }
    const hasWalletSigner = agents.some(agent => !!agent.privateKey) || WALLET_KEYS.length > 0;
    if (!hasWalletSigner) {
      throw new Error(
        'tier1_crosschain_required preflight failed: missing wallet private key for /api/session/prepare signing (set STRESS_TEST_WALLET_PRIVATE_KEYS or TEST_WALLET_PRIVATE_KEY)'
      );
    }
  }

  const relayerBalance = Number(res.json?.relayer?.balanceEth || '0');
  const minEth = Number(res.json?.relayer?.minEth || 0.02);
  const targetEth = Number(res.json?.relayer?.targetEth || minEth);
  const topupEnabled = !!res.json?.funding?.enabled;
  const fundingAddress = res.json?.funding?.fundingAddress;
  const fundingBalanceRaw = res.json?.funding?.fundingBalanceEth;
  const fundingBalanceEth = Number(fundingBalanceRaw || '0');

  if (!topupEnabled && relayerBalance < minEth) {
    throw new Error(
      `Relayed preflight failed: RELAYER_TOPUP_ENABLED=false and relayer balance ${relayerBalance} < min ${minEth}`
    );
  }

  if (topupEnabled) {
    if (!fundingAddress || fundingBalanceRaw === undefined) {
      log('[preflight] funding details redacted (unauthenticated status call); skipping funding wallet balance assertion');
    } else if (fundingBalanceEth < targetEth) {
      // Only block if the relayer itself is already underfunded. If the relayer has >= minEth,
      // the run can proceed deterministically without relying on an auto top-up.
      if (MODE === 'tier1_crosschain_required' && relayerBalance < minEth) {
        throw new Error(
          `tier1_crosschain_required preflight failed: relayer balance ${relayerBalance} ETH < min ${minEth} and funding wallet balance ${fundingBalanceEth} ETH < target ${targetEth} ETH`
        );
      }
      log(
        `[preflight] warning: funding wallet balance ${fundingBalanceEth} ETH < target ${targetEth} ETH; proceeding with relayed-required run`
      );
    }
  }

  if (MODE === 'tier1_crosschain_required' && relayerBalance < minEth) {
    throw new Error(
      `tier1_crosschain_required preflight failed: relayer balance ${relayerBalance} ETH < min ${minEth} ETH`
    );
  }

  log(
    `[preflight] relayer balance=${relayerBalance} min=${minEth} target=${targetEth} topupEnabled=${topupEnabled ? 'yes' : 'no'}`
  );
}

async function runSessionByMode(sessionIndex: number): Promise<SessionResult> {
  if (MODE === 'chat_only') return runChatOnlySession(sessionIndex);
  if (MODE === 'mixed') return runMixedSession(sessionIndex);
  if (MODE === 'tier1') return runExecutionSession(sessionIndex, 'tier1');
  if (MODE === 'tier1_relayed_required') return runExecutionSession(sessionIndex, 'tier1_relayed_required');
  if (MODE === 'tier1_crosschain_required') return runExecutionSession(sessionIndex, 'tier1_crosschain_required');
  if (MODE === 'tier2') return runExecutionSession(sessionIndex, 'tier2');
  return runExecutionSession(sessionIndex, 'full');
}

async function main() {
  await hydrateAgentsFromKeys();
  if (!WALLET_KEYS.length && process.env.TEST_WALLET_PRIVATE_KEY) {
    const rawFallbackKey = process.env.TEST_WALLET_PRIVATE_KEY.trim();
    const fallbackKey = rawFallbackKey.startsWith('0x') ? rawFallbackKey : `0x${rawFallbackKey}`;
    if (fallbackKey) {
      agents.forEach((agent) => {
        if (!agent.privateKey) agent.privateKey = fallbackKey;
      });
      await hydrateAgentsFromKeys();
    }
  }
  const rotatedWalletCount = rotatedWalletPool.filter(w => !!w.walletAddress || !!w.privateKey).length;
  const executeModes =
    MODE === 'full' ||
    MODE === 'tier1' ||
    MODE === 'tier1_relayed_required' ||
    MODE === 'tier1_crosschain_required' ||
    MODE === 'tier2' ||
    (MODE === 'mixed' && ALLOW_EXECUTE);
  const effectiveWorkerConcurrency = executeModes
    ? Math.max(1, Math.min(CONCURRENCY, rotatedWalletCount || 1))
    : CONCURRENCY;
  log('🌸 Blossom Live Stress Tester');
  log(`   Base URL: ${BASE_URL}`);
  log(`   Mode: ${MODE}`);
  log(`   Run ID: ${RUN_ID}`);
  log(`   Sessions: ${COUNT}`);
  log(`   Concurrency: ${CONCURRENCY}`);
  if (effectiveWorkerConcurrency !== CONCURRENCY) {
    log(`   Adjusted execute concurrency: ${effectiveWorkerConcurrency} (wallets=${rotatedWalletCount || 1}, desired=${DESIRED_HL_WALLETS})`);
  }
  log(`   Dry run: ${DRY_RUN ? 'yes' : 'no'}`);
  log(`   Allow execute: ${ALLOW_EXECUTE ? 'yes' : 'no'}`);
  if (MODE === 'tier1_relayed_required' || MODE === 'tier1_crosschain_required') {
    log(`   Allow wallet fallback: ${ALLOW_RELAYED_WALLET_FALLBACK ? 'yes' : 'no'}`);
  }
  log(`   Mint chains: ${MINT_CHAINS.join(', ')}`);
  log(`   Swap chains: ${SWAP_CHAINS.join(', ')}`);
  if (MODE === 'tier1_relayed_required' || MODE === 'tier1_crosschain_required') {
    log(`   Tier1 supported chains: ${TIER1_SUPPORTED_CHAINS.join(', ')}`);
    log(`   Tier1 supported venues: ${TIER1_SUPPORTED_VENUES.join(', ')}`);
  }
  if (!ETH_RPC_URL) log('   ⚠️  Missing ETH RPC URL (session signing will fail)');
  if (!STRESS_EVM_ADDRESS) log('   ⚠️  Missing STRESS_TEST_EVM_ADDRESS (mint to Ethereum may be skipped)');
  if (!STRESS_SOLANA_ADDRESS) log('   ⚠️  Missing STRESS_TEST_SOLANA_ADDRESS (mint to Solana may be skipped)');
  if (!STRESS_HYPERLIQUID_ADDRESS) log('   ⚠️  Missing STRESS_TEST_HYPERLIQUID_ADDRESS (mint to Hyperliquid may be skipped)');
    if (MODE === 'tier1_crosschain_required' && !STRESS_SOLANA_ADDRESS) {
      throw new Error('tier1_crosschain_required requires STRESS_TEST_SOLANA_ADDRESS');
    }

  await runRelayedRequiredPreflight();

  const results: SessionResult[] = [];
  let currentIndex = 0;

  const workers = Array.from({ length: effectiveWorkerConcurrency }).map(async (_, workerId) => {
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
  const crossChainProofs = MODE === 'tier1_crosschain_required' ? collectCrossChainProofs(results) : [];
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
  if (MODE === 'tier1_crosschain_required') {
    log(`Cross-chain confirmed proofs: ${crossChainProofs.length}`);
    crossChainProofs.slice(0, 5).forEach((proof, idx) => {
      log(
        `  [proof ${idx + 1}] session=${proof.sessionId} wallet=${proof.originWallet} route=${proof.routeType} to=${proof.toChain} creditTx=${proof.creditTxHash} execTx=${proof.executionTxHash}`
      );
    });
  }

  if (OUTPUT_FILE) {
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ runId: RUN_ID, summary, results, mode: MODE, crossChainProofs }, null, 2));
    log(`\nResults saved to ${OUTPUT_FILE}`);
  }

  if (MODE === 'tier1_crosschain_required' && crossChainProofs.length < 3) {
    throw new Error(`tier1_crosschain_required failed: expected at least 3 confirmed cross-chain proofs, got ${crossChainProofs.length}`);
  }
}

main().catch(err => {
  console.error('❌ Live stress tester failed:', err);
  process.exit(1);
});
