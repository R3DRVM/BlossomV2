#!/usr/bin/env npx tsx
/**
 * Stats Pipeline Verification Script
 *
 * Verifies that the execution stats pipeline is working correctly:
 * 1. GET baseline stats
 * 2. Execute 3 intents (swap, deposit, perp) with planOnly=true
 * 3. Confirm them (execute by intentId)
 * 4. GET stats again and verify deltas
 * 5. Print verification instructions for UI
 *
 * Usage:
 *   npx tsx agent/scripts/verify-stats-pipeline.ts
 *   npx tsx agent/scripts/verify-stats-pipeline.ts --api=http://127.0.0.1:3001
 *
 * Environment:
 *   VITE_DEV_LEDGER_SECRET - Ledger API secret
 */

// Parse CLI args
const args = process.argv.slice(2);
const apiArg = args.find(a => a.startsWith('--api='));

const API_BASE = apiArg?.split('=')[1] || process.env.BASE_URL || 'http://127.0.0.1:3001';
const LEDGER_SECRET = process.env.VITE_DEV_LEDGER_SECRET || process.env.LEDGER_SECRET || '';

// Generate unique run ID
const RUN_ID = `verify_${Date.now()}`;

// Colors
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const NC = '\x1b[0m';

// Test intents
const TEST_INTENTS = [
  { text: 'swap 100 USDC for WETH', kind: 'swap' },
  { text: 'deposit 200 USDC to lending', kind: 'deposit' },
  { text: 'long BTC with $150', kind: 'perp' },
];

interface StatsSnapshot {
  totalIntents: number;
  confirmedIntents: number;
  failedIntents: number;
  totalExecutions: number;
}

interface IntentResult {
  intentId: string;
  planOk: boolean;
  confirmOk: boolean;
  status: string;
  txHash?: string;
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

async function checkHealth(): Promise<boolean> {
  try {
    const health = await fetchJson(`${API_BASE}/health`);
    return health.ok === true || health.status === 'ok';
  } catch {
    return false;
  }
}

async function getStats(): Promise<StatsSnapshot> {
  const response = await fetchJson(`${API_BASE}/api/ledger/stats/summary`);
  if (!response.ok) {
    throw new Error(`Failed to get stats: ${JSON.stringify(response)}`);
  }
  return {
    totalIntents: response.data?.totalIntents || 0,
    confirmedIntents: response.data?.confirmedIntents || 0,
    failedIntents: response.data?.failedIntents || 0,
    totalExecutions: response.data?.totalExecutions || 0,
  };
}

async function planIntent(text: string, kind: string): Promise<{ ok: boolean; intentId?: string; error?: any }> {
  try {
    const response = await fetchJson(`${API_BASE}/api/ledger/intents/execute`, {
      method: 'POST',
      body: JSON.stringify({
        intentText: text,
        chain: 'ethereum',
        planOnly: true,
        metadata: {
          source: 'cli',
          domain: 'cli',
          runId: RUN_ID,
          category: 'verify_pipeline',
          kind,
        },
      }),
    });

    return {
      ok: response.ok !== false,
      intentId: response.intentId,
      error: response.error,
    };
  } catch (error: any) {
    return { ok: false, error: { message: error.message } };
  }
}

async function confirmIntent(intentId: string): Promise<{ ok: boolean; status?: string; txHash?: string; error?: any }> {
  try {
    const response = await fetchJson(`${API_BASE}/api/ledger/intents/execute`, {
      method: 'POST',
      body: JSON.stringify({
        intentId,
        metadata: {
          source: 'cli',
          domain: 'cli',
          runId: RUN_ID,
          confirmedAt: Date.now(),
        },
      }),
    });

    return {
      ok: response.ok !== false,
      status: response.status,
      txHash: response.txHash,
      error: response.error,
    };
  } catch (error: any) {
    return { ok: false, error: { message: error.message } };
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

async function run() {
  console.log(`\n${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}`);
  console.log(`${BLUE}║              STATS PIPELINE VERIFICATION                       ║${NC}`);
  console.log(`${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}\n`);

  console.log(`${CYAN}[verify]${NC} API base: ${API_BASE}`);
  console.log(`${CYAN}[verify]${NC} Run ID: ${RUN_ID}`);
  console.log(`${CYAN}[verify]${NC} Ledger secret: ${LEDGER_SECRET ? '***configured***' : 'NOT SET'}`);
  console.log('');

  // Step 0: Check health
  console.log(`${CYAN}Step 0: Checking backend health...${NC}`);
  const healthy = await checkHealth();
  if (!healthy) {
    console.log(`${RED}ERROR: Backend not healthy at ${API_BASE}${NC}`);
    console.log(`${DIM}Make sure to run: npm run dev:demo${NC}\n`);
    process.exit(1);
  }
  console.log(`${GREEN}  ✓ Backend healthy${NC}\n`);

  // Step 1: Get baseline stats
  console.log(`${CYAN}Step 1: Getting baseline stats...${NC}`);
  const baselineStats = await getStats();
  console.log(`  Total intents:     ${baselineStats.totalIntents}`);
  console.log(`  Confirmed intents: ${baselineStats.confirmedIntents}`);
  console.log(`  Failed intents:    ${baselineStats.failedIntents}`);
  console.log(`  Total executions:  ${baselineStats.totalExecutions}`);
  console.log('');

  // Step 2: Plan 3 intents with planOnly=true
  console.log(`${CYAN}Step 2: Planning 3 intents (planOnly=true)...${NC}`);
  const results: IntentResult[] = [];

  for (const intent of TEST_INTENTS) {
    process.stdout.write(`  Planning: "${intent.text.slice(0, 35)}..." `);
    const planResult = await planIntent(intent.text, intent.kind);

    if (planResult.ok && planResult.intentId) {
      console.log(`${GREEN}OK${NC} ${DIM}${planResult.intentId.slice(0, 8)}${NC}`);
      results.push({
        intentId: planResult.intentId,
        planOk: true,
        confirmOk: false,
        status: 'planned',
      });
    } else {
      console.log(`${RED}FAIL${NC} ${planResult.error?.code || 'ERROR'}`);
      results.push({
        intentId: planResult.intentId || 'none',
        planOk: false,
        confirmOk: false,
        status: 'plan_failed',
      });
    }
  }
  console.log('');

  // Step 3: Confirm all planned intents
  console.log(`${CYAN}Step 3: Confirming planned intents...${NC}`);
  for (const result of results) {
    if (!result.planOk) {
      console.log(`  Skipping ${result.intentId} (plan failed)`);
      continue;
    }

    process.stdout.write(`  Confirming: ${result.intentId.slice(0, 8)}... `);
    const confirmResult = await confirmIntent(result.intentId);

    if (confirmResult.ok) {
      console.log(`${GREEN}OK${NC} ${confirmResult.status} ${DIM}${confirmResult.txHash?.slice(0, 16) || ''}${NC}`);
      result.confirmOk = true;
      result.status = confirmResult.status || 'confirmed';
      result.txHash = confirmResult.txHash;
    } else {
      console.log(`${RED}FAIL${NC} ${confirmResult.error?.code || 'ERROR'}`);
      result.status = 'confirm_failed';
    }
  }
  console.log('');

  // Step 4: Get final stats and compare
  console.log(`${CYAN}Step 4: Getting final stats and comparing...${NC}`);
  const finalStats = await getStats();

  const executionDelta = finalStats.totalExecutions - baselineStats.totalExecutions;

  console.log(`  Execution delta:   ${executionDelta} (expected >= 3)`);
  console.log('');

  // Step 5: Verify intents appear in recent list
  console.log(`${CYAN}Step 5: Verifying intents in recent list...${NC}`);
  const recentIntents = await getRecentIntents(10);

  let foundCount = 0;
  for (const result of results) {
    const found = recentIntents.find(i => i.id === result.intentId);
    if (found) {
      foundCount++;
      console.log(`  ${GREEN}✓${NC} ${result.intentId.slice(0, 8)} found in recent intents (status: ${found.status})`);
    } else {
      console.log(`  ${RED}✗${NC} ${result.intentId.slice(0, 8)} NOT found in recent intents`);
    }
  }
  console.log('');

  // Step 6: Print recent intents for visual verification
  console.log(`${CYAN}Step 6: Recent intents for verification...${NC}`);
  console.log('');
  console.log(`${'ID'.padEnd(36)} ${'Status'.padEnd(10)} ${'Source'.padEnd(8)} ${'Kind'}`);
  console.log('─'.repeat(70));

  for (const intent of recentIntents.slice(0, 10)) {
    let metadata: any = {};
    try {
      metadata = JSON.parse(intent.metadata_json || '{}');
    } catch {}

    const source = metadata.source || '-';
    const isOurs = metadata.runId === RUN_ID;
    const sourceColor = isOurs ? GREEN : DIM;

    console.log(
      `${intent.id} ${intent.status.padEnd(10)} ${sourceColor}${source.padEnd(8)}${NC} ${intent.intent_kind || '-'}`
    );
  }
  console.log('');

  // Final verdict
  const allPlanned = results.filter(r => r.planOk).length;
  const allConfirmed = results.filter(r => r.confirmOk).length;
  const statsMatch = executionDelta >= 3;
  const allFound = foundCount === results.length;

  console.log(`${BLUE}═══════════════════════════════════════════════════════════════${NC}`);
  console.log(`${BLUE}                         RESULTS${NC}`);
  console.log(`${BLUE}═══════════════════════════════════════════════════════════════${NC}\n`);

  console.log(`Planned:   ${allPlanned}/3`);
  console.log(`Confirmed: ${allConfirmed}/3`);
  console.log(`Found:     ${foundCount}/3`);
  console.log(`Stats OK:  ${statsMatch ? 'YES' : 'NO'}`);
  console.log('');

  // Success: at least 3 planned, at least 2 confirmed, all found, stats delta ok
  if (allPlanned >= 3 && allConfirmed >= 2 && allFound && statsMatch) {
    console.log(`${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}`);
    console.log(`${GREEN}║  PIPELINE VERIFICATION PASSED                                  ║${NC}`);
    console.log(`${GREEN}║  Intents planned, confirmed, and visible in stats             ║${NC}`);
    console.log(`${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}`);
  } else {
    console.log(`${RED}╔════════════════════════════════════════════════════════════════╗${NC}`);
    console.log(`${RED}║  PIPELINE VERIFICATION FAILED                                  ║${NC}`);
    console.log(`${RED}║  Check backend logs for errors                                 ║${NC}`);
    console.log(`${RED}╚════════════════════════════════════════════════════════════════╝${NC}`);
  }

  // Instructions for UI verification
  console.log('');
  console.log(`${CYAN}═══ UI VERIFICATION INSTRUCTIONS ═══${NC}`);
  console.log('');
  console.log(`1. Open: ${YELLOW}http://localhost:5173/dev/stats${NC}`);
  console.log(`2. Click "Refresh" button`);
  console.log(`3. Verify the following intent IDs appear in "Recent Intents":`);
  for (const result of results) {
    const statusIcon = result.confirmOk ? `${GREEN}✓${NC}` : `${RED}✗${NC}`;
    console.log(`   ${statusIcon} ${result.intentId}`);
  }
  console.log(`4. Check that metadata.source = "cli" in the intent details`);
  console.log(`5. Enable "Show torture runs" toggle to see all CLI-sourced intents`);
  console.log('');

  process.exit(allPlanned >= 3 && allConfirmed >= 2 && allFound && statsMatch ? 0 : 1);
}

run().catch((error) => {
  console.error(`\n${RED}FATAL ERROR: ${error.message}${NC}\n`);
  process.exit(1);
});
