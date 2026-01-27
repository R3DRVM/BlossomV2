#!/usr/bin/env npx tsx
/**
 * Torture Suite - Comprehensive Intent Testing with Persistence Verification
 *
 * Runs 60-100 intents covering edge cases, error paths, and stress scenarios.
 * Verifies each intent is persisted to the same ledger DB that /dev/stats reads.
 *
 * Features:
 * - Explicit baseUrl targeting
 * - Persistence read-back verification after each API call
 * - Metadata tagging (source: "torture_suite", category, runId)
 * - Final ledger proof printout
 *
 * Usage:
 *   npx tsx agent/scripts/run-torture-suite.ts
 *   npx tsx agent/scripts/run-torture-suite.ts --baseUrl=http://127.0.0.1:3001
 *   npx tsx agent/scripts/run-torture-suite.ts --count=100
 *   npx tsx agent/scripts/run-torture-suite.ts --quick   # 30 intents only
 *   npx tsx agent/scripts/run-torture-suite.ts --category=normal
 *   npx tsx agent/scripts/run-torture-suite.ts --reliabilityMode  # Enable RPC failover + pacing
 *   npx tsx agent/scripts/run-torture-suite.ts --reliabilityMode --burst  # Allow rapid_fire in reliability mode
 *
 * Flags:
 *   --reliabilityMode: Enable RPC failover, circuit breakers, and pacing (250-500ms between intents, 1-2s between phases)
 *   --burst: Allow rapid_fire category (disabled in reliability mode by default)
 *   --category=<name>: Filter to specific category (normal, natural_language, plan_edit, cross_chain, extreme, rapid_fire)
 *   --count=<N>: Number of intents to run
 *   --quick: Run 30 intents only
 *
 * Environment:
 *   VITE_DEV_LEDGER_SECRET - Ledger API secret
 */

// Parse CLI args
const args = process.argv.slice(2);
const isQuick = args.includes('--quick');
const countArg = args.find(a => a.startsWith('--count='));
const categoryArg = args.find(a => a.startsWith('--category='));
const baseUrlArg = args.find(a => a.startsWith('--baseUrl='));
const reliabilityMode = args.includes('--reliabilityMode');
const burstMode = args.includes('--burst');

const BASE_URL = baseUrlArg?.split('=')[1] || process.env.BASE_URL || 'http://127.0.0.1:3001';
const LEDGER_SECRET = process.env.VITE_DEV_LEDGER_SECRET || process.env.LEDGER_SECRET || '';
const targetCount = countArg ? parseInt(countArg.split('=')[1], 10) : (isQuick ? 30 : 80);
const filterCategory = categoryArg ? categoryArg.split('=')[1] : null;

// Enable reliability mode in environment (picked up by rpcProvider)
if (reliabilityMode) {
  process.env.ENABLE_RELIABILITY_MODE = '1';
  console.log('[torture] ⚡ Reliability mode ENABLED (failover + pacing + circuit breaker)');
}

// Pacing configuration for reliability mode
const PACING_BETWEEN_INTENTS_MS = reliabilityMode ? [250, 500] : [0, 0]; // 250-500ms jittered
const PACING_BETWEEN_PHASES_MS = reliabilityMode ? [1000, 2000] : [0, 0]; // 1-2s jittered

/**
 * Sleep with jittered delay (for rate limit protection)
 */
async function sleepJittered(minMs: number, maxMs: number): Promise<void> {
  if (minMs === 0 && maxMs === 0) return;
  const delay = minMs + Math.random() * (maxMs - minMs);
  await new Promise(resolve => setTimeout(resolve, Math.floor(delay)));
}

// Generate unique run ID for this torture suite run
const RUN_ID = `torture_${Date.now()}`;

// Colors
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const DIM = '\x1b[2m';
const NC = '\x1b[0m';

type TestCategory =
  | 'normal'
  | 'natural_language'
  | 'plan_edit'
  | 'extreme'
  | 'unsupported'
  | 'cross_chain'
  | 'rapid_fire'
  | 'failure_inject';

interface TortureIntent {
  category: TestCategory;
  text: string;
  chain?: 'ethereum' | 'solana' | 'both';
  expectFail?: boolean;
  expectErrorCode?: string;
  description?: string;
}

interface TortureResult {
  intentId?: string;
  intentText: string;
  category: TestCategory;
  description?: string;
  planStatus: 'pass' | 'fail' | 'skipped';
  confirmStatus: 'pass' | 'fail' | 'skipped';
  persistenceVerified: boolean;
  errorCode?: string;
  errorMessage?: string;
  failureStage?: string;
  planLatencyMs?: number;
  confirmLatencyMs?: number;
  expectedFail?: boolean;
  correctOutcome?: boolean;
}

const results: TortureResult[] = [];

// ═══════════════════════════════════════════════════════════════════════════════
// INTENT TEMPLATES BY CATEGORY
// ═══════════════════════════════════════════════════════════════════════════════

const TORTURE_INTENTS: TortureIntent[] = [
  // ─────────────────────────────────────────────────────────────────────────────
  // CATEGORY A: Normal Flows (planOnly + confirm)
  // ─────────────────────────────────────────────────────────────────────────────
  { category: 'normal', text: 'swap 100 REDACTED for WETH', description: 'Basic swap' },
  { category: 'normal', text: 'swap 200 REDACTED to ETH', description: 'Swap with native ETH' },
  { category: 'normal', text: 'deposit 150 REDACTED to lending', description: 'Basic deposit' },
  { category: 'normal', text: 'deposit 100 REDACTED into vault', description: 'Vault deposit' },
  { category: 'normal', text: 'long BTC with $100', description: 'Basic perp long' },
  { category: 'normal', text: 'short ETH 5x $150', description: 'Perp short with leverage' },
  { category: 'normal', text: 'buy 0.05 WETH with REDACTED', description: 'Buy specific amount' },
  { category: 'normal', text: 'lend 200 REDACTED', description: 'Simple lend' },

  // ─────────────────────────────────────────────────────────────────────────────
  // CATEGORY B: Natural Language Variations + Slang
  // ─────────────────────────────────────────────────────────────────────────────
  { category: 'natural_language', text: 'yolo 100 bucks into eth', description: 'Slang: yolo' },
  { category: 'natural_language', text: 'ape into weth with 200 usdc', description: 'Slang: ape' },
  { category: 'natural_language', text: 'throw 150 usdc at bitcoin', description: 'Casual: throw' },
  { category: 'natural_language', text: 'gimme some eth for 100 usdc', description: 'Casual: gimme' },
  { category: 'natural_language', text: 'put my usdc to work, like 200', description: 'Vague amount' },
  { category: 'natural_language', text: 'can u swap 100 usdc -> weth?', description: 'Arrow notation' },
  { category: 'natural_language', text: 'convert my 150 usdc into ethereum', description: 'Convert phrasing' },
  { category: 'natural_language', text: 'trade usdc for eth pls, about 100', description: 'Trailing amount' },
  { category: 'natural_language', text: 'i wanna long btc hard', description: 'No amount specified' },
  { category: 'natural_language', text: 'SWAP 100 REDACTED FOR ETH!!!', description: 'All caps + punctuation' },
  { category: 'natural_language', text: '   swap    100   usdc   for   weth   ', description: 'Extra whitespace' },
  { category: 'natural_language', text: 'swap100usdcforweth', description: 'No spaces' },

  // ─────────────────────────────────────────────────────────────────────────────
  // CATEGORY C: Plan Edits (modify amount/venue after planning)
  // ─────────────────────────────────────────────────────────────────────────────
  { category: 'plan_edit', text: 'swap 100 REDACTED for WETH', description: 'Base for edit: will modify amount' },
  { category: 'plan_edit', text: 'deposit 200 REDACTED to lending', description: 'Base for edit: will modify venue' },
  { category: 'plan_edit', text: 'long BTC with $150', description: 'Base for edit: will modify leverage' },
  { category: 'plan_edit', text: 'swap 50 REDACTED for ETH', description: 'Base for edit: small amount' },

  // ─────────────────────────────────────────────────────────────────────────────
  // CATEGORY D: Extreme Leverage / Sizing
  // ─────────────────────────────────────────────────────────────────────────────
  { category: 'extreme', text: 'long BTC 100x with $100', description: 'Extreme leverage: 100x' },
  { category: 'extreme', text: 'short ETH 50x $200', description: 'High leverage: 50x' },
  { category: 'extreme', text: 'swap 0.01 REDACTED for WETH', description: 'Dust amount' },
  { category: 'extreme', text: 'swap 999999999 REDACTED for ETH', description: 'Impossibly large amount' },
  { category: 'extreme', text: 'deposit 0.001 REDACTED to vault', description: 'Below minimum' },
  { category: 'extreme', text: 'long BTC 1000x $50', description: 'Unrealistic leverage' },
  { category: 'extreme', text: 'swap 1000000 ETH for REDACTED', description: 'More than total supply' },
  { category: 'extreme', text: 'deposit 0 REDACTED', description: 'Zero amount' },
  { category: 'extreme', text: 'swap -100 REDACTED for ETH', description: 'Negative amount', expectFail: true },

  // ─────────────────────────────────────────────────────────────────────────────
  // CATEGORY E: Unsupported Venues / Assets
  // ─────────────────────────────────────────────────────────────────────────────
  { category: 'unsupported', text: 'swap 100 REDACTED for DOGE on binance', description: 'CEX venue', expectFail: true },
  { category: 'unsupported', text: 'buy SHIB with 200 REDACTED', description: 'Unsupported token' },
  { category: 'unsupported', text: 'swap 100 REDACTED for PEPE', description: 'Meme token' },
  { category: 'unsupported', text: 'deposit to kraken', description: 'CEX deposit', expectFail: true },
  { category: 'unsupported', text: 'long DOGE 10x', description: 'Unsupported perp market' },
  { category: 'unsupported', text: 'swap 100 USD for ETH', description: 'Fiat currency' },
  { category: 'unsupported', text: 'buy NFT with 1 ETH', description: 'NFT operation' },
  { category: 'unsupported', text: 'stake 100 REDACTED on lido', description: 'Wrong asset for Lido' },
  { category: 'unsupported', text: 'swap 100 REDACTED for BTC on uniswap', description: 'BTC on Uniswap' },

  // ─────────────────────────────────────────────────────────────────────────────
  // CATEGORY F: Cross-Chain Phrasing
  // ─────────────────────────────────────────────────────────────────────────────
  { category: 'cross_chain', text: 'bridge 100 REDACTED from ethereum to solana', chain: 'both', description: 'ETH->SOL bridge' },
  { category: 'cross_chain', text: 'send 200 REDACTED to solana', chain: 'both', description: 'Implicit bridge' },
  { category: 'cross_chain', text: 'move 150 REDACTED from eth to sol', chain: 'both', description: 'Short chain names' },
  { category: 'cross_chain', text: 'bridge 100 REDACTED solana to ethereum', chain: 'both', description: 'SOL->ETH bridge' },
  { category: 'cross_chain', text: 'swap 100 REDACTED on solana for ETH on ethereum', chain: 'both', description: 'Cross-chain swap' },
  { category: 'cross_chain', text: 'transfer 200 REDACTED cross-chain to solana', chain: 'both', description: 'Explicit cross-chain' },
  { category: 'cross_chain', text: 'bridge all my REDACTED to solana', chain: 'both', description: 'Bridge "all"' },

  // ─────────────────────────────────────────────────────────────────────────────
  // CATEGORY G: Rapid-Fire Sequences (will be batched)
  // ─────────────────────────────────────────────────────────────────────────────
  { category: 'rapid_fire', text: 'swap 10 REDACTED for WETH', description: 'Rapid #1' },
  { category: 'rapid_fire', text: 'swap 20 REDACTED for WETH', description: 'Rapid #2' },
  { category: 'rapid_fire', text: 'swap 30 REDACTED for WETH', description: 'Rapid #3' },
  { category: 'rapid_fire', text: 'swap 40 REDACTED for WETH', description: 'Rapid #4' },
  { category: 'rapid_fire', text: 'swap 50 REDACTED for WETH', description: 'Rapid #5' },
  { category: 'rapid_fire', text: 'deposit 10 REDACTED', description: 'Rapid deposit #1' },
  { category: 'rapid_fire', text: 'deposit 20 REDACTED', description: 'Rapid deposit #2' },
  { category: 'rapid_fire', text: 'deposit 30 REDACTED', description: 'Rapid deposit #3' },

  // ─────────────────────────────────────────────────────────────────────────────
  // CATEGORY H: Failure Injection (expected to fail gracefully)
  // ─────────────────────────────────────────────────────────────────────────────
  { category: 'failure_inject', text: '', description: 'Empty intent', expectFail: true },
  { category: 'failure_inject', text: '   ', description: 'Whitespace only', expectFail: true },
  { category: 'failure_inject', text: 'hello world', description: 'Non-financial intent', expectFail: true },
  { category: 'failure_inject', text: 'what is the weather', description: 'Question', expectFail: true },
  { category: 'failure_inject', text: '{}', description: 'JSON injection', expectFail: true },
  { category: 'failure_inject', text: '<script>alert(1)</script>', description: 'XSS attempt', expectFail: true },
  { category: 'failure_inject', text: "'; DROP TABLE intents; --", description: 'SQL injection', expectFail: true },
  { category: 'failure_inject', text: 'swap REDACTED for', description: 'Incomplete intent', expectFail: true },
  { category: 'failure_inject', text: 'swap for WETH', description: 'Missing source', expectFail: true },
  { category: 'failure_inject', text: 'do something risky', description: 'Vague request', expectFail: true },
];

// ═══════════════════════════════════════════════════════════════════════════════
// API HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchJson(url: string, options?: RequestInit): Promise<any> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Ledger-Secret': LEDGER_SECRET,
      ...options?.headers,
    },
  });

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
}

async function checkBackendHealth(): Promise<boolean> {
  try {
    const health = await fetchJson(`${BASE_URL}/health`);
    return health.ok === true || health.status === 'ok';
  } catch {
    return false;
  }
}

/**
 * Verify intent persistence by reading it back from the API
 */
async function verifyIntentPersistence(intentId: string): Promise<{
  verified: boolean;
  intent?: any;
  error?: string;
}> {
  try {
    const response = await fetchJson(`${BASE_URL}/api/ledger/intents/${intentId}`);

    if (!response.ok || !response.data) {
      return { verified: false, error: 'Intent not found in ledger' };
    }

    const intent = response.data;
    const now = Math.floor(Date.now() / 1000);
    const createdAt = intent.created_at || 0;

    // Verify created_at is recent (within last 5 minutes)
    if (now - createdAt > 300) {
      return { verified: false, intent, error: `created_at ${createdAt} is stale (now=${now})` };
    }

    // Verify status is valid
    const validStatuses = ['queued', 'planned', 'routed', 'executing', 'confirmed', 'failed'];
    if (!validStatuses.includes(intent.status)) {
      return { verified: false, intent, error: `Invalid status: ${intent.status}` };
    }

    // Check metadata contains our source tag
    let metadata: any = {};
    try {
      metadata = JSON.parse(intent.metadata_json || '{}');
    } catch {}

    if (metadata.source !== 'torture_suite') {
      return { verified: false, intent, error: 'metadata.source !== torture_suite' };
    }

    return { verified: true, intent };
  } catch (error: any) {
    return { verified: false, error: error.message };
  }
}

/**
 * Get recent intents from the ledger for final proof
 */
async function getRecentIntents(limit: number = 10): Promise<any[]> {
  try {
    const response = await fetchJson(`${BASE_URL}/api/ledger/intents/recent?limit=${limit}`);
    return response.ok ? response.data : [];
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

async function planIntent(intent: TortureIntent): Promise<{
  ok: boolean;
  intentId?: string;
  error?: { code: string; message: string; stage: string };
  latencyMs: number;
}> {
  const startTime = Date.now();

  try {
    const response = await fetchJson(`${BASE_URL}/api/ledger/intents/execute`, {
      method: 'POST',
      body: JSON.stringify({
        intentText: intent.text,
        chain: intent.chain || 'ethereum',
        planOnly: true,
        // Include metadata for torture suite tagging
        metadata: {
          source: 'torture_suite',
          category: intent.category,
          runId: RUN_ID,
          description: intent.description,
          expectedFail: intent.expectFail || false,
        },
      }),
    });

    const latencyMs = Date.now() - startTime;

    if (response.ok === false) {
      return {
        ok: false,
        intentId: response.intentId,
        error: {
          code: response.error?.code || 'UNKNOWN_ERROR',
          message: response.error?.message || 'Unknown error',
          stage: response.error?.stage || 'plan',
        },
        latencyMs,
      };
    }

    return {
      ok: true,
      intentId: response.intentId,
      latencyMs,
    };
  } catch (error: any) {
    return {
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        message: error.message,
        stage: 'plan',
      },
      latencyMs: Date.now() - startTime,
    };
  }
}

async function confirmIntent(intentId: string): Promise<{
  ok: boolean;
  txHash?: string;
  error?: { code: string; message: string; stage: string };
  latencyMs: number;
}> {
  const startTime = Date.now();

  try {
    const response = await fetchJson(`${BASE_URL}/api/ledger/intents/execute`, {
      method: 'POST',
      body: JSON.stringify({
        intentId,
      }),
    });

    const latencyMs = Date.now() - startTime;

    if (response.ok === false) {
      return {
        ok: false,
        error: {
          code: response.error?.code || 'UNKNOWN_ERROR',
          message: response.error?.message || 'Unknown error',
          stage: response.error?.stage || 'confirm',
        },
        latencyMs,
      };
    }

    return {
      ok: true,
      txHash: response.txHash,
      latencyMs,
    };
  } catch (error: any) {
    return {
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        message: error.message,
        stage: 'confirm',
      },
      latencyMs: Date.now() - startTime,
    };
  }
}

async function executeTortureIntent(intent: TortureIntent): Promise<TortureResult> {
  const result: TortureResult = {
    intentText: intent.text,
    category: intent.category,
    description: intent.description,
    planStatus: 'skipped',
    confirmStatus: 'skipped',
    persistenceVerified: false,
    expectedFail: intent.expectFail,
  };

  // Step 1: Plan
  const planResult = await planIntent(intent);
  result.planLatencyMs = planResult.latencyMs;
  result.intentId = planResult.intentId;

  if (!planResult.ok) {
    result.planStatus = 'fail';
    result.errorCode = planResult.error?.code;
    result.errorMessage = planResult.error?.message;
    result.failureStage = planResult.error?.stage;
    result.correctOutcome = intent.expectFail === true;

    // Still verify persistence for failed intents (they should be recorded)
    if (planResult.intentId) {
      const verification = await verifyIntentPersistence(planResult.intentId);
      result.persistenceVerified = verification.verified;
      if (!verification.verified) {
        console.log(`${RED}    [PERSISTENCE FAIL]${NC} ${verification.error}`);
      }
    }
    return result;
  }

  result.planStatus = 'pass';

  // Step 1.5: Verify persistence after plan
  if (planResult.intentId) {
    const verification = await verifyIntentPersistence(planResult.intentId);
    result.persistenceVerified = verification.verified;
    if (!verification.verified) {
      console.log(`${RED}    [PERSISTENCE FAIL after plan]${NC} ${verification.error}`);
      // Fatal: exit if persistence fails
      process.exit(1);
    }
  }

  // RELIABILITY MODE: Pacing between plan and confirm phases (1-2s jittered)
  if (reliabilityMode && intent.category !== 'plan_edit') {
    await sleepJittered(PACING_BETWEEN_PHASES_MS[0], PACING_BETWEEN_PHASES_MS[1]);
  }

  // Step 2: Confirm (skip for plan_edit category - those test planning only)
  if (intent.category === 'plan_edit') {
    result.confirmStatus = 'skipped';
    result.correctOutcome = true;
    return result;
  }

  if (!planResult.intentId) {
    result.confirmStatus = 'fail';
    result.errorCode = 'NO_INTENT_ID';
    result.errorMessage = 'Plan succeeded but no intentId returned';
    result.failureStage = 'confirm';
    result.correctOutcome = false;
    return result;
  }

  const confirmResult = await confirmIntent(planResult.intentId);
  result.confirmLatencyMs = confirmResult.latencyMs;

  if (!confirmResult.ok) {
    result.confirmStatus = 'fail';
    result.errorCode = confirmResult.error?.code;
    result.errorMessage = confirmResult.error?.message;
    result.failureStage = confirmResult.error?.stage;
    result.correctOutcome = intent.expectFail === true;

    // Verify persistence after confirm (even if failed)
    const verification = await verifyIntentPersistence(planResult.intentId);
    result.persistenceVerified = verification.verified;
    if (!verification.verified) {
      console.log(`${RED}    [PERSISTENCE FAIL after confirm]${NC} ${verification.error}`);
    }
    return result;
  }

  result.confirmStatus = 'pass';

  // Step 2.5: Final persistence verification
  const finalVerification = await verifyIntentPersistence(planResult.intentId);
  result.persistenceVerified = finalVerification.verified;
  if (!finalVerification.verified) {
    console.log(`${RED}    [PERSISTENCE FAIL final]${NC} ${finalVerification.error}`);
    process.exit(1);
  }

  // If we expected failure but it passed, that's unexpected
  result.correctOutcome = intent.expectFail !== true;
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RAPID-FIRE HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

async function executeRapidFire(intents: TortureIntent[]): Promise<TortureResult[]> {
  console.log(`\n${MAGENTA}  ⚡ Rapid-fire burst: ${intents.length} concurrent requests${NC}`);

  const startTime = Date.now();
  const promises = intents.map(intent => executeTortureIntent(intent));
  const results = await Promise.all(promises);
  const totalTime = Date.now() - startTime;

  console.log(`${DIM}     Completed in ${totalTime}ms (${Math.round(totalTime / intents.length)}ms/req avg)${NC}`);

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════════════════════

async function runTortureSuite() {
  console.log(`\n${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}`);
  console.log(`${BLUE}║                    TORTURE SUITE                               ║${NC}`);
  console.log(`${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}\n`);

  console.log(`${CYAN}[torture]${NC} baseUrl=${BASE_URL}`);
  console.log(`${CYAN}[torture]${NC} runId=${RUN_ID}`);
  console.log(`${CYAN}[torture]${NC} targetCount=${targetCount}`);
  console.log(`${CYAN}[torture]${NC} ledgerSecret=${LEDGER_SECRET ? '***configured***' : 'NOT SET'}`);
  console.log(`${CYAN}[torture]${NC} reliabilityMode=${reliabilityMode ? '✅ ENABLED (failover + pacing)' : 'disabled'}`);
  if (burstMode) {
    console.log(`${CYAN}[torture]${NC} burstMode=✅ ENABLED (rapid_fire allowed)`);
  }
  if (filterCategory) {
    console.log(`${CYAN}[torture]${NC} filterCategory=${filterCategory}`);
  }
  console.log('');

  // Check backend health
  const healthy = await checkBackendHealth();
  if (!healthy) {
    console.log(`${RED}ERROR: Backend not healthy at ${BASE_URL}${NC}`);
    console.log(`${DIM}Make sure to run: npm run dev:demo${NC}\n`);
    process.exit(1);
  }
  console.log(`${GREEN}Backend healthy at ${BASE_URL}${NC}\n`);

  if (!LEDGER_SECRET) {
    console.log(`${YELLOW}WARNING: No LEDGER_SECRET set - some operations may fail${NC}\n`);
  }

  // Filter intents by category if specified
  let availableIntents = filterCategory
    ? TORTURE_INTENTS.filter(i => i.category === filterCategory)
    : TORTURE_INTENTS;

  // RELIABILITY MODE: Filter out rapid_fire unless --burst is explicitly enabled
  if (reliabilityMode && !burstMode) {
    const beforeCount = availableIntents.length;
    availableIntents = availableIntents.filter(i => i.category !== 'rapid_fire');
    if (availableIntents.length < beforeCount) {
      console.log(`${YELLOW}[torture] Reliability mode: Filtered out rapid_fire intents (use --burst to enable)${NC}`);
    }
  }

  if (availableIntents.length === 0) {
    console.log(`${RED}ERROR: No intents found for category '${filterCategory}'${NC}`);
    process.exit(1);
  }

  // Build test queue by cycling through templates
  const testQueue: TortureIntent[] = [];
  let idx = 0;
  for (let i = 0; i < targetCount; i++) {
    testQueue.push(availableIntents[idx]);
    idx = (idx + 1) % availableIntents.length;
  }

  // Group by category for summary
  const categoryCount: Record<string, number> = {};
  for (const intent of testQueue) {
    categoryCount[intent.category] = (categoryCount[intent.category] || 0) + 1;
  }

  console.log(`${CYAN}Test Distribution:${NC}`);
  for (const [cat, count] of Object.entries(categoryCount)) {
    console.log(`  ${cat.padEnd(20)} ${count}`);
  }
  console.log('');

  // Run tests
  console.log(`${CYAN}Running ${targetCount} intents...${NC}\n`);

  // Separate rapid-fire from sequential tests
  const rapidFireIntents = testQueue.filter(i => i.category === 'rapid_fire');
  const sequentialIntents = testQueue.filter(i => i.category !== 'rapid_fire');

  // Run sequential tests
  for (let i = 0; i < sequentialIntents.length; i++) {
    const intent = sequentialIntents[i];
    const progress = `[${String(i + 1).padStart(2)}/${sequentialIntents.length}]`;

    const categoryColor = {
      normal: GREEN,
      natural_language: CYAN,
      plan_edit: YELLOW,
      extreme: MAGENTA,
      unsupported: RED,
      cross_chain: BLUE,
      rapid_fire: MAGENTA,
      failure_inject: RED,
    }[intent.category] || NC;

    process.stdout.write(
      `${DIM}${progress}${NC} ${categoryColor}${intent.category.padEnd(16)}${NC} `
    );

    const result = await executeTortureIntent(intent);
    results.push(result);

    // Show outcome
    const planIcon = result.planStatus === 'pass' ? `${GREEN}P${NC}` : `${RED}F${NC}`;
    const confirmIcon =
      result.confirmStatus === 'skipped'
        ? `${DIM}-${NC}`
        : result.confirmStatus === 'pass'
        ? `${GREEN}C${NC}`
        : `${RED}F${NC}`;

    const persistIcon = result.persistenceVerified ? `${GREEN}✓${NC}` : `${RED}✗${NC}`;
    const outcomeIcon = result.correctOutcome
      ? `${GREEN}OK${NC}`
      : `${RED}!!${NC}`;

    const latency = (result.planLatencyMs || 0) + (result.confirmLatencyMs || 0);
    const intentIdShort = result.intentId ? result.intentId.slice(0, 8) : '--------';

    console.log(
      `[${planIcon}|${confirmIcon}|${persistIcon}] ${outcomeIcon} ${DIM}${latency}ms${NC} ${DIM}${intentIdShort}${NC} ${DIM}${(intent.description || '').slice(0, 20)}${NC}`
    );

    // RELIABILITY MODE: Pacing between intents (250-500ms jittered, or default 300ms)
    if (reliabilityMode) {
      await sleepJittered(PACING_BETWEEN_INTENTS_MS[0], PACING_BETWEEN_INTENTS_MS[1]);
    } else {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // Run rapid-fire tests
  if (rapidFireIntents.length > 0) {
    const rapidResults = await executeRapidFire(rapidFireIntents);
    results.push(...rapidResults);

    for (const r of rapidResults) {
      const planIcon = r.planStatus === 'pass' ? `${GREEN}P${NC}` : `${RED}F${NC}`;
      const confirmIcon =
        r.confirmStatus === 'skipped'
          ? `${DIM}-${NC}`
          : r.confirmStatus === 'pass'
          ? `${GREEN}C${NC}`
          : `${RED}F${NC}`;
      const persistIcon = r.persistenceVerified ? `${GREEN}✓${NC}` : `${RED}✗${NC}`;
      const intentIdShort = r.intentId ? r.intentId.slice(0, 8) : '--------';
      console.log(
        `  ${MAGENTA}rapid_fire${NC.padEnd(10)} [${planIcon}|${confirmIcon}|${persistIcon}] ${DIM}${intentIdShort}${NC} ${DIM}${r.description || ''}${NC}`
      );
    }
  }

  // Print ledger proof
  await printLedgerProof();

  // Print summary
  printSummary();
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEDGER PROOF
// ═══════════════════════════════════════════════════════════════════════════════

async function printLedgerProof() {
  console.log(`\n${BLUE}═══════════════════════════════════════════════════════════════${NC}`);
  console.log(`${BLUE}                       LEDGER PROOF${NC}`);
  console.log(`${BLUE}═══════════════════════════════════════════════════════════════${NC}\n`);

  const recentIntents = await getRecentIntents(15);

  if (recentIntents.length === 0) {
    console.log(`${RED}No recent intents found in ledger!${NC}`);
    return;
  }

  console.log(`${CYAN}Recent 15 intents from /api/ledger/intents/recent:${NC}\n`);
  console.log(`${'ID'.padEnd(36)} ${'Status'.padEnd(10)} ${'Source'.padEnd(15)} ${'Category'}`);
  console.log('─'.repeat(80));

  let tortureCount = 0;
  for (const intent of recentIntents) {
    let metadata: any = {};
    try {
      metadata = JSON.parse(intent.metadata_json || '{}');
    } catch {}

    const source = metadata.source || '-';
    const category = metadata.category || '-';
    const isTorture = source === 'torture_suite';
    if (isTorture) tortureCount++;

    const sourceColor = isTorture ? GREEN : DIM;
    console.log(
      `${intent.id} ${intent.status.padEnd(10)} ${sourceColor}${source.padEnd(15)}${NC} ${category}`
    );
  }

  console.log('');
  console.log(`${CYAN}Torture suite intents in recent 15:${NC} ${tortureCount}`);
  console.log(`${CYAN}Run ID:${NC} ${RUN_ID}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════

function printSummary() {
  const total = results.length;
  const planPass = results.filter(r => r.planStatus === 'pass').length;
  const planFail = results.filter(r => r.planStatus === 'fail').length;
  const confirmPass = results.filter(r => r.confirmStatus === 'pass').length;
  const confirmFail = results.filter(r => r.confirmStatus === 'fail').length;
  const persistenceVerified = results.filter(r => r.persistenceVerified).length;
  const correctOutcomes = results.filter(r => r.correctOutcome).length;

  const overallSuccessRate = total > 0 ? ((correctOutcomes / total) * 100).toFixed(1) : '0.0';

  console.log(`\n${BLUE}═══════════════════════════════════════════════════════════════${NC}`);
  console.log(`${BLUE}                       TORTURE SUITE SUMMARY${NC}`);
  console.log(`${BLUE}═══════════════════════════════════════════════════════════════${NC}\n`);

  console.log(`Total Intents:        ${total}`);
  console.log(`Plan:                 ${GREEN}${planPass} pass${NC} / ${RED}${planFail} fail${NC}`);
  console.log(`Confirm:              ${GREEN}${confirmPass} pass${NC} / ${RED}${confirmFail} fail${NC}`);
  console.log(`Persistence Verified: ${GREEN}${persistenceVerified}${NC} / ${total}`);
  console.log(`Correct Outcomes:     ${GREEN}${correctOutcomes}${NC} / ${total} (${overallSuccessRate}%)`);

  // ───────────────────────────────────────────────────────────────────────────
  // BY CATEGORY
  // ───────────────────────────────────────────────────────────────────────────
  console.log(`\n${YELLOW}═══ By Category ═══${NC}`);
  console.log('');
  console.log(`${'Category'.padEnd(20)} ${'Plan'.padEnd(8)} ${'Confirm'.padEnd(10)} ${'Persist'.padEnd(10)} ${'Correct'}`);
  console.log('─'.repeat(65));

  const byCategory: Record<string, TortureResult[]> = {};
  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = [];
    byCategory[r.category].push(r);
  }

  for (const [category, catResults] of Object.entries(byCategory)) {
    const catPlanPass = catResults.filter(r => r.planStatus === 'pass').length;
    const catConfirmPass = catResults.filter(r => r.confirmStatus === 'pass').length;
    const catPersist = catResults.filter(r => r.persistenceVerified).length;
    const catCorrect = catResults.filter(r => r.correctOutcome).length;
    const catTotal = catResults.length;

    console.log(
      `${category.padEnd(20)} ${catPlanPass}/${catTotal}`.padEnd(28) +
        ` ${catConfirmPass}/${catTotal}`.padEnd(10) +
        ` ${catPersist}/${catTotal}`.padEnd(10) +
        ` ${catCorrect}/${catTotal}`
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // FAILURES BY ERROR CODE
  // ───────────────────────────────────────────────────────────────────────────
  const failures = results.filter(
    r => (r.planStatus === 'fail' || r.confirmStatus === 'fail') && !r.expectedFail
  );

  if (failures.length > 0) {
    console.log(`\n${RED}═══ Unexpected Failures by Error Code ═══${NC}`);
    console.log('');
    console.log(`${'Error Code'.padEnd(30)} ${'Count'.padEnd(6)} ${'Stage'}`);
    console.log('─'.repeat(50));

    const byCode: Record<string, TortureResult[]> = {};
    for (const r of failures) {
      const code = r.errorCode || 'UNKNOWN';
      if (!byCode[code]) byCode[code] = [];
      byCode[code].push(r);
    }

    const sortedCodes = Object.entries(byCode).sort((a, b) => b[1].length - a[1].length);
    for (const [code, codeResults] of sortedCodes) {
      const stage = codeResults[0].failureStage || 'unknown';
      console.log(`${code.padEnd(30)} ${String(codeResults.length).padEnd(6)} ${stage}`);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // PERSISTENCE FAILURES
  // ───────────────────────────────────────────────────────────────────────────
  const persistFails = results.filter(r => !r.persistenceVerified);
  if (persistFails.length > 0) {
    console.log(`\n${RED}═══ Persistence Failures ═══${NC}`);
    console.log(`${persistFails.length} intents failed persistence verification`);
    for (const r of persistFails.slice(0, 5)) {
      console.log(`  - ${r.intentId || 'no-id'}: ${r.description || r.intentText.slice(0, 30)}`);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // EXPECTED FAILURES CHECK
  // ───────────────────────────────────────────────────────────────────────────
  const expectedFailures = results.filter(r => r.expectedFail);
  const correctlyFailed = expectedFailures.filter(r => r.planStatus === 'fail' || r.confirmStatus === 'fail');
  const incorrectlyPassed = expectedFailures.filter(r => r.planStatus === 'pass' && r.confirmStatus !== 'fail');

  if (expectedFailures.length > 0) {
    console.log(`\n${YELLOW}═══ Expected Failure Tests ═══${NC}`);
    console.log(`Correctly Failed: ${GREEN}${correctlyFailed.length}${NC} / ${expectedFailures.length}`);
    if (incorrectlyPassed.length > 0) {
      console.log(`${RED}WARNING: ${incorrectlyPassed.length} tests passed when they should have failed:${NC}`);
      for (const r of incorrectlyPassed) {
        console.log(`  - ${r.description || r.intentText.slice(0, 40)}`);
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // LATENCY STATS
  // ───────────────────────────────────────────────────────────────────────────
  const planLatencies = results.filter(r => r.planLatencyMs).map(r => r.planLatencyMs!);
  const confirmLatencies = results.filter(r => r.confirmLatencyMs).map(r => r.confirmLatencyMs!);

  if (planLatencies.length > 0) {
    const avgPlan = Math.round(planLatencies.reduce((a, b) => a + b, 0) / planLatencies.length);
    const maxPlan = Math.max(...planLatencies);

    console.log(`\n${CYAN}═══ Latency Stats ═══${NC}`);
    console.log(`Plan:    avg ${avgPlan}ms  max ${maxPlan}ms`);

    if (confirmLatencies.length > 0) {
      const avgConfirm = Math.round(confirmLatencies.reduce((a, b) => a + b, 0) / confirmLatencies.length);
      const maxConfirm = Math.max(...confirmLatencies);
      console.log(`Confirm: avg ${avgConfirm}ms  max ${maxConfirm}ms`);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // FINAL VERDICT
  // ───────────────────────────────────────────────────────────────────────────
  console.log('');

  const unexpectedFailures = failures.length;
  const unexpectedPasses = incorrectlyPassed.length;
  const persistenceFailures = persistFails.length;

  if (unexpectedFailures === 0 && unexpectedPasses === 0 && persistenceFailures === 0) {
    console.log(`${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}`);
    console.log(`${GREEN}║  TORTURE SUITE PASSED - All outcomes as expected              ║${NC}`);
    console.log(`${GREEN}║  All intents persisted to ledger successfully                 ║${NC}`);
    console.log(`${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}`);
  } else {
    console.log(`${RED}╔════════════════════════════════════════════════════════════════╗${NC}`);
    console.log(`${RED}║  TORTURE SUITE: ${unexpectedFailures} failures, ${unexpectedPasses} unexpected pass, ${persistenceFailures} persist fail ║${NC}`);
    console.log(`${RED}╚════════════════════════════════════════════════════════════════╝${NC}`);
  }

  console.log('');

  // Exit with error code if there were unexpected outcomes
  const hasIssues = unexpectedFailures > 0 || unexpectedPasses > 0 || persistenceFailures > 0;
  process.exit(hasIssues ? 1 : 0);
}

runTortureSuite().catch((error) => {
  console.error(`\n${RED}FATAL ERROR: ${error.message}${NC}\n`);
  process.exit(1);
});
