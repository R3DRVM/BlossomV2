#!/usr/bin/env tsx
/**
 * Regular Execution Test Suite
 * Runs curated happy-path intents to verify production deployment
 */

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE_URL = process.env.BASE_URL || 'https://api.blossom.onl';
const LEDGER_SECRET = process.env.LEDGER_SECRET || process.env.DEV_LEDGER_SECRET;

if (!LEDGER_SECRET) {
  console.error('❌ LEDGER_SECRET or DEV_LEDGER_SECRET environment variable required');
  process.exit(1);
}

interface TestCase {
  name: string;
  intent: string;
  planOnly?: boolean;
}

const TEST_CASES: TestCase[] = [
  // Use smaller amounts and mix of plan-only and real executions
  { name: 'Plan: Swap USDC→WETH', intent: 'swap 1 USDC for WETH', planOnly: true },
  { name: 'Plan: Deposit to vault', intent: 'deposit 5 USDC to aave', planOnly: true },
  { name: 'Execute: Proof swap', intent: 'swap 0.5 USDC for WETH', planOnly: false },
  { name: 'Execute: Proof deposit', intent: 'deposit 2 USDC to aave', planOnly: false },
  { name: 'Execute: Proof perp', intent: 'long btc 2x with 3 USDC', planOnly: false },
];

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

async function checkStats() {
  try {
    const response = await fetch(`${BASE_URL}/api/stats/public`);
    const result = await response.json();

    if (result.ok) {
      const data = result.data;
      console.log('\n📊 Stats Summary:');
      console.log(`   Total Intents: ${data.totalIntents}`);
      console.log(`   Confirmed: ${data.confirmedIntents}`);
      console.log(`   Total Executions: ${data.totalExecutions}`);
      console.log(`   Successful: ${data.successfulExecutions}`);
      console.log(`   Chains Active: ${data.chainsActive.join(', ') || 'none'}`);

      return data.totalIntents > 0;
    }
  } catch (error) {
    console.error('Failed to fetch stats:', error);
  }

  return false;
}

async function main() {
  console.log('\n🧪 Regular Execution Test Suite');
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   Secret: ***${LEDGER_SECRET.slice(-4)}`);
  console.log('');

  let passed = 0;
  let failed = 0;

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

  console.log('\n' + '='.repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60));

  // Check stats
  await new Promise(resolve => setTimeout(resolve, 2000));
  const statsOk = await checkStats();

  if (passed === TEST_CASES.length && statsOk) {
    console.log('\n✅ All tests passed and stats are populated!');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed or stats not populated');
    process.exit(1);
  }
}

main();
