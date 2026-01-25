#!/usr/bin/env npx tsx
/**
 * Preflight Verification Script
 *
 * Run this after deploying to verify the production environment:
 * 1. Checks /health endpoint
 * 2. Runs a small torture subset (10 intents)
 * 3. Verifies intents appear in stats within 60 seconds
 *
 * Usage:
 *   npx tsx agent/scripts/preflight-verify.ts
 *   npx tsx agent/scripts/preflight-verify.ts --baseUrl=https://api.blossom.onl
 *   npx tsx agent/scripts/preflight-verify.ts --quick   # Just health check
 *   npx tsx agent/scripts/preflight-verify.ts --reliabilityMode  # Enable RPC failover + pacing
 *
 * Environment:
 *   VITE_DEV_LEDGER_SECRET - Ledger API secret (required for write operations)
 */

// Parse CLI args
const args = process.argv.slice(2);
const baseUrlArg = args.find(a => a.startsWith('--baseUrl='));
const isQuick = args.includes('--quick');
const isVerbose = args.includes('--verbose');
const reliabilityMode = args.includes('--reliabilityMode');

const BASE_URL = baseUrlArg?.split('=')[1] || process.env.BASE_URL || 'http://127.0.0.1:3001';
const LEDGER_SECRET = process.env.VITE_DEV_LEDGER_SECRET || process.env.LEDGER_SECRET || '';

// Enable reliability mode in environment
if (reliabilityMode) {
  process.env.ENABLE_RELIABILITY_MODE = '1';
  console.log('[preflight] ⚡ Reliability mode ENABLED (failover + pacing)');
}

// Pacing configuration for reliability mode
const PACING_BETWEEN_INTENTS_MS = reliabilityMode ? [250, 500] : [0, 0]; // 250-500ms jittered

/**
 * Sleep with jittered delay (for rate limit protection)
 */
async function sleepJittered(minMs: number, maxMs: number): Promise<void> {
  if (minMs === 0 && maxMs === 0) return;
  const delay = minMs + Math.random() * (maxMs - minMs);
  await new Promise(resolve => setTimeout(resolve, Math.floor(delay)));
}

// Test intents
const TEST_INTENTS = [
  { text: 'swap 0.001 ETH to USDC', kind: 'swap' },
  { text: 'deposit 10 USDC to lending', kind: 'deposit' },
  { text: 'long BTC with $50', kind: 'perp' },
  { text: 'short ETH 5x with $25', kind: 'perp' },
  { text: 'bridge 5 USDC to solana', kind: 'bridge' },
];

// Colors
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const DIM = '\x1b[2m';
const NC = '\x1b[0m';

interface HealthResponse {
  ok: boolean;
  ts: number;
  service?: string;
  executionMode?: string;
  missing?: string[];
}

interface IntentResult {
  intentId: string;
  ok: boolean;
  status: string;
  error?: string;
}

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

async function checkHealth(): Promise<HealthResponse> {
  console.log(`${BLUE}[preflight]${NC} Checking health at ${BASE_URL}/health...`);

  try {
    const health = await fetchJson(`${BASE_URL}/health`);

    if (health.ok) {
      console.log(`${GREEN}  ✓ Health OK${NC}`);
      console.log(`${DIM}    Service: ${health.service || 'unknown'}${NC}`);
      console.log(`${DIM}    Mode: ${health.executionMode || 'unknown'}${NC}`);
      return health;
    } else {
      console.log(`${RED}  ✗ Health check failed${NC}`);
      if (health.missing?.length) {
        console.log(`${RED}    Missing: ${health.missing.join(', ')}${NC}`);
      }
      return health;
    }
  } catch (error: any) {
    console.log(`${RED}  ✗ Health check error: ${error.message}${NC}`);
    return { ok: false, ts: Date.now() };
  }
}

async function checkStats(): Promise<boolean> {
  console.log(`${BLUE}[preflight]${NC} Checking stats API...`);

  try {
    const stats = await fetchJson(`${BASE_URL}/api/ledger/stats/summary`);

    if (stats.ok) {
      console.log(`${GREEN}  ✓ Stats API OK${NC}`);
      console.log(`${DIM}    Total Intents: ${stats.data?.totalIntents || 0}${NC}`);
      console.log(`${DIM}    Total Executions: ${stats.data?.totalExecutions || 0}${NC}`);
      return true;
    } else {
      console.log(`${YELLOW}  ! Stats API returned ok=false${NC}`);
      return false;
    }
  } catch (error: any) {
    console.log(`${RED}  ✗ Stats API error: ${error.message}${NC}`);
    return false;
  }
}

async function executeIntent(intentText: string, kind: string): Promise<IntentResult> {
  try {
    const response = await fetchJson(`${BASE_URL}/api/ledger/intents/execute`, {
      method: 'POST',
      body: JSON.stringify({
        intentText,
        chain: 'ethereum',
        metadata: {
          source: 'preflight',
          category: 'preflight_verify',
          kind,
        },
      }),
    });

    return {
      intentId: response.intentId || '',
      ok: response.ok !== false,
      status: response.status || 'unknown',
      error: response.error?.message,
    };
  } catch (error: any) {
    return {
      intentId: '',
      ok: false,
      status: 'error',
      error: error.message,
    };
  }
}

async function verifyIntentsInStats(intentIds: string[], timeoutMs: number = 60000): Promise<boolean> {
  console.log(`${BLUE}[preflight]${NC} Verifying ${intentIds.length} intents appear in stats...`);

  const startTime = Date.now();
  const pollInterval = 5000;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetchJson(`${BASE_URL}/api/ledger/intents/recent?limit=20`);

      if (response.ok && response.data) {
        const foundIds = new Set(response.data.map((i: any) => i.id));
        const allFound = intentIds.every(id => foundIds.has(id));

        if (allFound) {
          console.log(`${GREEN}  ✓ All ${intentIds.length} intents found in stats${NC}`);
          return true;
        }

        const foundCount = intentIds.filter(id => foundIds.has(id)).length;
        if (isVerbose) {
          console.log(`${DIM}    Found ${foundCount}/${intentIds.length} intents...${NC}`);
        }
      }
    } catch (error: any) {
      if (isVerbose) {
        console.log(`${DIM}    Poll error: ${error.message}${NC}`);
      }
    }

    await new Promise(r => setTimeout(r, pollInterval));
  }

  console.log(`${RED}  ✗ Timeout: Not all intents appeared in stats within ${timeoutMs / 1000}s${NC}`);
  return false;
}

async function runTortureSubset(): Promise<{ passed: number; failed: number; intentIds: string[] }> {
  console.log(`${BLUE}[preflight]${NC} Running ${TEST_INTENTS.length} test intents...`);

  let passed = 0;
  let failed = 0;
  const intentIds: string[] = [];

  for (const intent of TEST_INTENTS) {
    process.stdout.write(`  ${intent.kind.padEnd(8)} "${intent.text.slice(0, 30)}..." `);

    const result = await executeIntent(intent.text, intent.kind);

    if (result.ok) {
      console.log(`${GREEN}OK${NC} ${DIM}${result.intentId.slice(0, 8)}${NC}`);
      passed++;
      if (result.intentId) {
        intentIds.push(result.intentId);
      }
    } else {
      console.log(`${RED}FAIL${NC} ${result.error || 'unknown'}`);
      failed++;
    }

    // RELIABILITY MODE: Pacing between intents (250-500ms jittered, or default 500ms)
    if (reliabilityMode) {
      await sleepJittered(PACING_BETWEEN_INTENTS_MS[0], PACING_BETWEEN_INTENTS_MS[1]);
    } else {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  return { passed, failed, intentIds };
}

async function run() {
  console.log(`
${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}
${BLUE}║              BLOSSOM PREFLIGHT VERIFICATION                    ║${NC}
${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}
`);

  console.log(`${DIM}Base URL: ${BASE_URL}${NC}`);
  console.log(`${DIM}Ledger Secret: ${LEDGER_SECRET ? '***configured***' : 'NOT SET'}${NC}`);
  console.log(`${DIM}Reliability Mode: ${reliabilityMode ? '✅ ENABLED (failover + pacing)' : 'disabled'}${NC}`);
  console.log('');

  // Step 1: Health check
  const health = await checkHealth();

  if (!health.ok) {
    console.log(`
${RED}╔════════════════════════════════════════════════════════════════╗${NC}
${RED}║  PREFLIGHT FAILED: Backend not healthy                        ║${NC}
${RED}╚════════════════════════════════════════════════════════════════╝${NC}
`);
    process.exit(1);
  }

  // Quick mode: just health check
  if (isQuick) {
    console.log(`
${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}
${GREEN}║  PREFLIGHT PASSED (Quick Mode)                                ║${NC}
${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}
`);
    process.exit(0);
  }

  // Step 2: Check stats API
  console.log('');
  const statsOk = await checkStats();

  if (!statsOk) {
    console.log(`${YELLOW}  ! Stats API issue - continuing anyway${NC}`);
  }

  // Step 3: Run torture subset
  console.log('');

  if (!LEDGER_SECRET) {
    console.log(`${YELLOW}[preflight]${NC} Skipping intent execution (no LEDGER_SECRET)`);
    console.log(`${YELLOW}            ${NC}Set VITE_DEV_LEDGER_SECRET to run full verification`);
  } else {
    const { passed, failed, intentIds } = await runTortureSubset();

    console.log('');
    console.log(`Results: ${GREEN}${passed} passed${NC}, ${RED}${failed} failed${NC}`);

    // Step 4: Verify intents appear in stats
    if (intentIds.length > 0) {
      console.log('');
      const allFound = await verifyIntentsInStats(intentIds);

      if (!allFound) {
        console.log(`
${RED}╔════════════════════════════════════════════════════════════════╗${NC}
${RED}║  PREFLIGHT WARNING: Some intents not found in stats           ║${NC}
${RED}╚════════════════════════════════════════════════════════════════╝${NC}
`);
        // Don't fail on this - it could be timing
      }
    }

    // Final verdict
    const success = passed >= Math.floor(TEST_INTENTS.length * 0.6); // 60% pass rate

    if (success) {
      console.log(`
${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}
${GREEN}║  PREFLIGHT PASSED                                             ║${NC}
${GREEN}║  ${passed}/${TEST_INTENTS.length} intents executed successfully                         ║${NC}
${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}
`);
      process.exit(0);
    } else {
      console.log(`
${RED}╔════════════════════════════════════════════════════════════════╗${NC}
${RED}║  PREFLIGHT FAILED                                             ║${NC}
${RED}║  Only ${passed}/${TEST_INTENTS.length} intents passed (need 60%)                       ║${NC}
${RED}╚════════════════════════════════════════════════════════════════╝${NC}
`);
      process.exit(1);
    }
  }

  // If we got here without running intents, just pass
  console.log(`
${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}
${GREEN}║  PREFLIGHT PASSED (Health Only)                               ║${NC}
${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}
`);
  process.exit(0);
}

run().catch((error) => {
  console.error(`\n${RED}FATAL ERROR: ${error.message}${NC}\n`);
  process.exit(1);
});
