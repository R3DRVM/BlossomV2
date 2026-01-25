#!/usr/bin/env npx tsx
/**
 * Burn-In Test Suite
 *
 * Runs 30-50 intents across multiple venues to stress-test execution reliability.
 * Uses HTTP API ONLY (no direct DB imports) for single source of truth.
 * Produces a summary report with pass/fail rates and failure breakdown.
 *
 * Usage:
 *   npx tsx agent/scripts/run-burnin.ts
 *   npx tsx agent/scripts/run-burnin.ts --count=30
 *   npx tsx agent/scripts/run-burnin.ts --quick   # 10 intents only
 *   npx tsx agent/scripts/run-burnin.ts --api=http://127.0.0.1:3001
 *
 * Environment:
 *   VITE_DEV_LEDGER_SECRET - Ledger API secret
 */

// Parse CLI args
const args = process.argv.slice(2);
const isQuick = args.includes('--quick');
const countArg = args.find(a => a.startsWith('--count='));
const apiArg = args.find(a => a.startsWith('--api='));

const API_BASE = apiArg?.split('=')[1] || process.env.BASE_URL || 'http://127.0.0.1:3001';
const LEDGER_SECRET = process.env.VITE_DEV_LEDGER_SECRET || process.env.LEDGER_SECRET || '';
const targetCount = countArg ? parseInt(countArg.split('=')[1], 10) : (isQuick ? 10 : 40);

// Generate unique run ID
const RUN_ID = `burnin_${Date.now()}`;

// Colors
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const NC = '\x1b[0m';

interface BurnInResult {
  intentId?: string;
  intentText: string;
  venue: string;
  kind: string;
  status: 'pass' | 'fail';
  errorCode?: string;
  errorMessage?: string;
  failureStage?: string;
  latencyMs?: number;
  txHash?: string;
}

const results: BurnInResult[] = [];

// Intent templates with sane amounts (100-500 REDACTED range)
const INTENT_TEMPLATES = [
  // Swaps - demo_dex (most reliable)
  { kind: 'swap', venue: 'demo_dex', text: 'swap 100 REDACTED for WETH' },
  { kind: 'swap', venue: 'demo_dex', text: 'swap 200 REDACTED to WETH' },
  { kind: 'swap', venue: 'demo_dex', text: 'buy 0.05 WETH with REDACTED' },
  { kind: 'swap', venue: 'demo_dex', text: 'swap 150 REDACTED for ETH' },

  // Deposits - demo_vault (reliable)
  { kind: 'deposit', venue: 'demo_vault', text: 'deposit 100 REDACTED to lending' },
  { kind: 'deposit', venue: 'demo_vault', text: 'deposit 200 REDACTED into vault' },
  { kind: 'deposit', venue: 'demo_vault', text: 'lend 150 REDACTED' },

  // Perps - demo_perp (confirm mode path)
  { kind: 'perp', venue: 'demo_perp', text: 'long BTC with $100' },
  { kind: 'perp', venue: 'demo_perp', text: 'long ETH 10x with $150' },
  { kind: 'perp', venue: 'demo_perp', text: 'short BTC 5x $100' },

  // Bridge - dual chain proof (if stable)
  { kind: 'bridge', venue: 'bridge', text: 'bridge 100 REDACTED from ethereum to solana' },
];

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

async function executeIntent(template: typeof INTENT_TEMPLATES[0]): Promise<BurnInResult> {
  const startTime = Date.now();
  const result: BurnInResult = {
    intentText: template.text,
    venue: template.venue,
    kind: template.kind,
    status: 'fail',
  };

  try {
    const response = await fetchJson(`${API_BASE}/api/ledger/intents/execute`, {
      method: 'POST',
      body: JSON.stringify({
        intentText: template.text,
        chain: template.kind === 'bridge' ? 'both' : 'ethereum',
        // Include metadata for source tracking
        metadata: {
          source: 'cli',
          domain: 'cli',
          runId: RUN_ID,
          category: 'burnin',
          kind: template.kind,
          venue: template.venue,
        },
      }),
    });

    result.latencyMs = Date.now() - startTime;
    result.intentId = response.intentId;

    if (response.ok === false) {
      result.status = 'fail';
      result.errorCode = response.error?.code || 'UNKNOWN_ERROR';
      result.errorMessage = response.error?.message || 'Unknown error';
      result.failureStage = response.error?.stage || 'execute';
    } else {
      result.status = 'pass';
      result.txHash = response.txHash;
    }
  } catch (error: any) {
    result.latencyMs = Date.now() - startTime;
    result.status = 'fail';
    result.errorCode = 'NETWORK_ERROR';
    result.errorMessage = error.message;
    result.failureStage = 'execute';
  }

  return result;
}

async function checkBackendHealth(): Promise<boolean> {
  try {
    const health = await fetchJson(`${API_BASE}/health`);
    return health.ok === true || health.status === 'ok';
  } catch {
    return false;
  }
}

async function getRecentIntents(limit: number = 10): Promise<any[]> {
  try {
    const response = await fetchJson(`${API_BASE}/api/ledger/intents/recent?limit=${limit}`);
    return response.ok ? response.data : [];
  } catch {
    return [];
  }
}

async function runBurnIn() {
  console.log(`\n${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}`);
  console.log(`${BLUE}║                    BURN-IN TEST SUITE                          ║${NC}`);
  console.log(`${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}\n`);

  console.log(`${CYAN}[burnin]${NC} API base: ${API_BASE}`);
  console.log(`${CYAN}[burnin]${NC} Run ID: ${RUN_ID}`);
  console.log(`${CYAN}[burnin]${NC} Target count: ${targetCount} intents`);
  console.log(`${CYAN}[burnin]${NC} Ledger secret: ${LEDGER_SECRET ? '***configured***' : 'NOT SET'}`);
  console.log('');

  // Check backend health
  const healthy = await checkBackendHealth();
  if (!healthy) {
    console.log(`${RED}ERROR: Backend not healthy at ${API_BASE}${NC}`);
    console.log(`${DIM}Make sure to run: npm run dev:demo${NC}\n`);
    process.exit(1);
  }
  console.log(`${GREEN}Backend healthy${NC}\n`);

  if (!LEDGER_SECRET) {
    console.log(`${YELLOW}WARNING: No LEDGER_SECRET set - some operations may fail${NC}\n`);
  }

  // Build test queue by cycling through templates
  const testQueue: typeof INTENT_TEMPLATES[0][] = [];
  let templateIdx = 0;
  for (let i = 0; i < targetCount; i++) {
    testQueue.push(INTENT_TEMPLATES[templateIdx]);
    templateIdx = (templateIdx + 1) % INTENT_TEMPLATES.length;
  }

  // Run tests
  console.log(`${CYAN}Running ${targetCount} intents...${NC}\n`);

  for (let i = 0; i < testQueue.length; i++) {
    const template = testQueue[i];
    const progress = `[${String(i + 1).padStart(2)}/${targetCount}]`;

    process.stdout.write(`${DIM}${progress}${NC} ${template.kind.padEnd(7)} ${template.venue.padEnd(12)} `);

    const result = await executeIntent(template);
    results.push(result);

    if (result.status === 'pass') {
      console.log(`${GREEN}PASS${NC} ${DIM}${result.latencyMs}ms${NC} ${DIM}${result.intentId?.slice(0, 8) || ''}${NC}`);
    } else {
      console.log(`${RED}FAIL${NC} ${result.errorCode || 'ERROR'} ${DIM}${result.intentId?.slice(0, 8) || ''}${NC}`);
    }

    // Small delay between intents to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  // Print summary
  printSummary();

  // Verify intents appear in ledger
  await verifyLedgerEntries();
}

function printSummary() {
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const total = results.length;
  const successRate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0.0';

  console.log(`\n${BLUE}═══════════════════════════════════════════════════════════════${NC}`);
  console.log(`${BLUE}                          SUMMARY${NC}`);
  console.log(`${BLUE}═══════════════════════════════════════════════════════════════${NC}\n`);

  console.log(`Total:   ${total}`);
  console.log(`${GREEN}Passed:  ${passed}${NC}`);
  console.log(`${RED}Failed:  ${failed}${NC}`);
  console.log(`Rate:    ${successRate}%`);

  // Group failures by error code
  if (failed > 0) {
    console.log(`\n${YELLOW}Failures by Error Code:${NC}`);
    console.log('─────────────────────────────────────────');

    const byCode: Record<string, BurnInResult[]> = {};
    for (const r of results.filter(r => r.status === 'fail')) {
      const code = r.errorCode || 'UNKNOWN';
      if (!byCode[code]) byCode[code] = [];
      byCode[code].push(r);
    }

    const sortedCodes = Object.entries(byCode).sort((a, b) => b[1].length - a[1].length);
    for (const [code, failures] of sortedCodes) {
      console.log(`  ${code.padEnd(25)} ${failures.length}`);
      const sample = failures[0];
      console.log(`    ${DIM}└─ "${sample.intentText.slice(0, 40)}"${NC}`);
    }
  }

  // Latency stats
  const latencies = results.filter(r => r.latencyMs).map(r => r.latencyMs!);
  if (latencies.length > 0) {
    const avgLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
    const maxLatency = Math.max(...latencies);
    const minLatency = Math.min(...latencies);

    console.log(`\n${CYAN}Latency:${NC}`);
    console.log('─────────────────────────────────────────');
    console.log(`  Avg: ${avgLatency}ms  Min: ${minLatency}ms  Max: ${maxLatency}ms`);
  }
}

async function verifyLedgerEntries() {
  console.log(`\n${BLUE}═══════════════════════════════════════════════════════════════${NC}`);
  console.log(`${BLUE}                    LEDGER VERIFICATION${NC}`);
  console.log(`${BLUE}═══════════════════════════════════════════════════════════════${NC}\n`);

  // Fetch recent intents to verify our run appears
  const recentIntents = await getRecentIntents(15);

  if (recentIntents.length === 0) {
    console.log(`${RED}ERROR: No intents found in ledger!${NC}`);
    console.log(`${RED}Intents are not being persisted correctly.${NC}`);
    process.exit(1);
  }

  // Check how many of our run's intents appear
  let ourIntentsCount = 0;
  console.log(`${CYAN}Recent intents from /api/ledger/intents/recent:${NC}\n`);
  console.log(`${'ID'.padEnd(36)} ${'Status'.padEnd(10)} ${'Source'.padEnd(8)} ${'RunID'}`);
  console.log('─'.repeat(80));

  for (const intent of recentIntents) {
    let metadata: any = {};
    try {
      metadata = JSON.parse(intent.metadata_json || '{}');
    } catch {}

    const source = metadata.source || '-';
    const runId = metadata.runId || '-';
    const isOurs = runId === RUN_ID;
    if (isOurs) ourIntentsCount++;

    const sourceColor = isOurs ? GREEN : DIM;
    console.log(
      `${intent.id} ${intent.status.padEnd(10)} ${sourceColor}${source.padEnd(8)}${NC} ${runId.slice(0, 20)}`
    );
  }

  console.log('');
  console.log(`${CYAN}Our run's intents in recent 15:${NC} ${ourIntentsCount}`);
  console.log(`${CYAN}Total intents executed:${NC} ${results.length}`);

  // Verify at least some appeared
  if (ourIntentsCount === 0) {
    console.log(`\n${RED}ERROR: None of our intents appeared in ledger!${NC}`);
    console.log(`${RED}Check that the backend is writing to the same DB as /dev/stats.${NC}`);
    process.exit(1);
  }

  // Final verdict
  const successRate = parseFloat(((results.filter(r => r.status === 'pass').length / results.length) * 100).toFixed(1));
  console.log('');
  if (successRate >= 92) {
    console.log(`${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}`);
    console.log(`${GREEN}║  SUCCESS: ${successRate}% pass rate meets target (>=92%)            ║${NC}`);
    console.log(`${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}`);
  } else {
    console.log(`${YELLOW}╔════════════════════════════════════════════════════════════════╗${NC}`);
    console.log(`${YELLOW}║  BELOW TARGET: ${successRate}% pass rate < 92% target              ║${NC}`);
    console.log(`${YELLOW}╚════════════════════════════════════════════════════════════════╝${NC}`);
  }

  console.log('');
  console.log(`${DIM}View results at: http://localhost:5173/dev/stats${NC}`);
  console.log('');

  process.exit(successRate >= 92 ? 0 : 1);
}

runBurnIn().catch((error) => {
  console.error(`\n${RED}FATAL ERROR: ${error.message}${NC}\n`);
  process.exit(1);
});
