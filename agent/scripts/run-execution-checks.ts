#!/usr/bin/env tsx
/**
 * Regular Execution Test Suite (Production Proof Version)
 * Runs curated happy-path intents to verify production deployment
 *
 * PRODUCTION PROOF MODE:
 * - Requires --baseUrl=https://api.blossom.onl (or explicit production URL)
 * - Verifies dbIdentityHash matches across endpoints
 * - Tracks before/after stats deltas
 * - Tags all executions with runId for traceability
 */

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse CLI args
const args = process.argv.slice(2);
const baseUrlArg = args.find(a => a.startsWith('--baseUrl='));
const BASE_URL = baseUrlArg ? baseUrlArg.split('=')[1] : (process.env.BASE_URL || 'https://api.blossom.onl');

const LEDGER_SECRET = process.env.LEDGER_SECRET || process.env.DEV_LEDGER_SECRET;

// Generate run ID for this test batch
const RUN_ID = `run_${Date.now()}`;
const SOURCE = 'prod_proof_basic';

if (!LEDGER_SECRET) {
  console.error('❌ LEDGER_SECRET or DEV_LEDGER_SECRET environment variable required');
  process.exit(1);
}

// Production proof: Verify this is actually production
if (!BASE_URL.includes('api.blossom.onl') && !BASE_URL.includes('blossom-v2') && !process.env.ALLOW_NON_PROD) {
  console.error('❌ BASE_URL must be https://api.blossom.onl for production proof');
  console.error(`   Got: ${BASE_URL}`);
  console.error('   Use --baseUrl=https://api.blossom.onl or set ALLOW_NON_PROD=1 for testing');
  process.exit(1);
}

interface TestCase {
  name: string;
  intent: string;
  planOnly?: boolean;
}

const TEST_CASES: TestCase[] = [
  // Use smaller amounts and mix of plan-only and real executions
  { name: 'Plan: Swap REDACTED→WETH', intent: 'swap 1 REDACTED for WETH', planOnly: true },
  { name: 'Plan: Deposit to vault', intent: 'deposit 5 REDACTED to aave', planOnly: true },
  { name: 'Execute: Proof swap', intent: 'swap 0.5 REDACTED for WETH', planOnly: false },
  { name: 'Execute: Proof deposit', intent: 'deposit 2 REDACTED to aave', planOnly: false },
];

/**
 * Verify database identity hash matches across endpoints (production proof)
 */
async function verifyDbIdentity(): Promise<boolean> {
  try {
    const [health1, health2, stats] = await Promise.all([
      fetch(`${BASE_URL}/health`).then(r => r.json()),
      fetch(`${BASE_URL}/api/health`).then(r => r.json()),
      fetch(`${BASE_URL}/api/stats/public`).then(r => r.json()),
    ]);

    const hash1 = health1.dbIdentityHash;
    const hash2 = health2.dbIdentityHash;
    const hash3 = stats.data.dbIdentityHash;

    console.log('🔍 Database Identity Verification:');
    console.log(`   /health:           ${hash1}`);
    console.log(`   /api/health:       ${hash2}`);
    console.log(`   /api/stats/public: ${hash3}`);

    if (hash1 === hash2 && hash2 === hash3) {
      console.log('   ✅ All hashes match - Same database confirmed\n');
      return true;
    } else {
      console.error('   ❌ Hashes do NOT match - Database mismatch!\n');
      return false;
    }
  } catch (error: any) {
    console.error('❌ Failed to verify database identity:', error.message);
    return false;
  }
}

interface StatsSnapshot {
  totalIntents: number;
  confirmedIntents: number;
  totalExecutions: number;
  successfulExecutions: number;
  totalUsdRouted: number;
  chainsActive: string[];
}

/**
 * Get current stats snapshot
 */
async function getStatsSnapshot(): Promise<StatsSnapshot | null> {
  try {
    const response = await fetch(`${BASE_URL}/api/stats/public`);
    const result = await response.json();

    if (result.ok) {
      return {
        totalIntents: result.data.totalIntents || 0,
        confirmedIntents: result.data.confirmedIntents || 0,
        totalExecutions: result.data.totalExecutions || 0,
        successfulExecutions: result.data.successfulExecutions || 0,
        totalUsdRouted: result.data.totalUsdRouted || 0,
        chainsActive: result.data.chainsActive || [],
      };
    }
  } catch (error: any) {
    console.error('Failed to fetch stats:', error.message);
  }
  return null;
}

/**
 * Compare before/after stats and verify deltas
 */
function verifyDeltas(before: StatsSnapshot, after: StatsSnapshot, expectedRealExecutions: number): boolean {
  const intentDelta = after.totalIntents - before.totalIntents;
  const executionDelta = after.totalExecutions - before.totalExecutions;
  const confirmedDelta = after.confirmedIntents - before.confirmedIntents;

  console.log('\n📊 Stats Delta Verification:');
  console.log(`   Total Intents: ${before.totalIntents} → ${after.totalIntents} (+${intentDelta})`);
  console.log(`   Confirmed Intents: ${before.confirmedIntents} → ${after.confirmedIntents} (+${confirmedDelta})`);
  console.log(`   Total Executions: ${before.totalExecutions} → ${after.totalExecutions} (+${executionDelta})`);
  console.log(`   USD Routed: $${before.totalUsdRouted.toFixed(2)} → $${after.totalUsdRouted.toFixed(2)} (+$${(after.totalUsdRouted - before.totalUsdRouted).toFixed(2)})`);
  console.log(`   Chains Active: ${after.chainsActive.join(', ')}`);

  const passed = intentDelta >= TEST_CASES.length && executionDelta >= expectedRealExecutions;

  if (passed) {
    console.log('   ✅ Deltas confirmed - Stats updated correctly\n');
  } else {
    console.error(`   ❌ Delta mismatch - Expected at least ${expectedRealExecutions} executions, got ${executionDelta}\n`);
  }

  return passed;
}

async function runTest(test: TestCase): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/api/ledger/intents/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ledger-Secret': LEDGER_SECRET,
      },
      body: JSON.stringify({
        intentText: test.intent,
        chain: 'ethereum',
        planOnly: test.planOnly ?? false,
        metadata: {
          source: SOURCE,
          runId: RUN_ID,
          testName: test.name,
        },
      }),
    });

    const result = await response.json();

    if (result.ok) {
      const expectedStatus = test.planOnly ? 'planned' : 'confirmed';
      const passed = result.status === expectedStatus;

      console.log(
        `${passed ? '✓' : '✗'} ${test.name}: ${result.status} (${result.intentId.slice(0, 8)})`
      );

      return passed;
    } else {
      console.log(`✗ ${test.name}: FAILED - ${result.error?.message || 'Unknown error'}`);
      return false;
    }
  } catch (error: any) {
    console.log(`✗ ${test.name}: ERROR - ${error.message}`);
    return false;
  }
}


async function main() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('🧪 PRODUCTION PROOF - Basic Execution Test Suite');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   Run ID: ${RUN_ID}`);
  console.log(`   Source: ${SOURCE}`);
  console.log(`   Secret: ***${LEDGER_SECRET.slice(-4)}`);
  console.log('');

  // PRODUCTION PROOF STEP 1: Verify database identity
  console.log('STEP 1: Verify Database Identity');
  console.log('─────────────────────────────────────────────────────────');
  const dbVerified = await verifyDbIdentity();
  if (!dbVerified) {
    console.error('❌ Database verification failed - aborting');
    process.exit(1);
  }

  // PRODUCTION PROOF STEP 2: Get baseline stats
  console.log('STEP 2: Capture Baseline Stats');
  console.log('─────────────────────────────────────────────────────────');
  const beforeStats = await getStatsSnapshot();
  if (!beforeStats) {
    console.error('❌ Failed to get baseline stats - aborting');
    process.exit(1);
  }
  console.log(`   Baseline: ${beforeStats.totalIntents} intents, ${beforeStats.totalExecutions} executions\n`);

  // PRODUCTION PROOF STEP 3: Run test batch
  console.log('STEP 3: Execute Test Batch');
  console.log('─────────────────────────────────────────────────────────');

  let passed = 0;
  let failed = 0;
  const expectedRealExecutions = TEST_CASES.filter(t => !t.planOnly).length;

  for (const test of TEST_CASES) {
    const success = await runTest(test);
    if (success) {
      passed++;
    } else {
      failed++;
    }

    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('');
  console.log('─────────────────────────────────────────────────────────');
  console.log(`   Results: ${passed}/${TEST_CASES.length} passed`);
  console.log('─────────────────────────────────────────────────────────');

  // PRODUCTION PROOF STEP 4: Verify deltas
  console.log('\nSTEP 4: Verify Stats Deltas (waiting 3s for persistence...)');
  console.log('─────────────────────────────────────────────────────────');
  await new Promise(resolve => setTimeout(resolve, 3000));

  const afterStats = await getStatsSnapshot();
  if (!afterStats) {
    console.error('❌ Failed to get updated stats');
    process.exit(1);
  }

  const deltasVerified = verifyDeltas(beforeStats, afterStats, expectedRealExecutions);

  // PRODUCTION PROOF STEP 5: Final summary
  console.log('═══════════════════════════════════════════════════════════');
  console.log('PRODUCTION PROOF SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`   ✅ Database Identity: ${dbVerified ? 'VERIFIED' : 'FAILED'}`);
  console.log(`   ✅ Test Execution: ${passed}/${TEST_CASES.length} passed`);
  console.log(`   ✅ Stats Deltas: ${deltasVerified ? 'VERIFIED' : 'FAILED'}`);
  console.log(`   📍 Run ID: ${RUN_ID}`);
  console.log('');

  if (passed === TEST_CASES.length && deltasVerified) {
    console.log('✅ PRODUCTION PROOF COMPLETE - All checks passed!\n');
    process.exit(0);
  } else {
    console.log('❌ PRODUCTION PROOF FAILED - See errors above\n');
    process.exit(1);
  }
}

main();
