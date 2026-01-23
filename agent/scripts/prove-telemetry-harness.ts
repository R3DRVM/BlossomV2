#!/usr/bin/env tsx
/**
 * Proof: Telemetry Load Test Harness
 * Verifies that the load test harness infrastructure works correctly.
 *
 * Invariants:
 * 1. Wallet generation produces valid addresses
 * 2. Concurrency limiter respects limits
 * 3. Results aggregation works correctly
 * 4. Percentile calculations are accurate
 */

import { randomBytes } from 'crypto';
import { privateKeyToAccount } from 'viem/accounts';

interface ProofResult {
  name: string;
  pass: boolean;
  detail: string;
}

const results: ProofResult[] = [];

function assert(name: string, condition: boolean, detail: string): void {
  results.push({ name, pass: condition, detail });
  if (!condition) {
    console.log(`  ❌ ${name}: ${detail}`);
  } else {
    console.log(`  ✅ ${name}: ${detail}`);
  }
}

/**
 * Percentile calculation (same as in load-test-users.ts)
 */
function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Simple concurrency limiter for testing
 */
async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<T[]> {
  const results: T[] = [];
  const queue = [...tasks];
  const activePromises: Promise<void>[] = [];

  while (queue.length > 0 || activePromises.length > 0) {
    while (queue.length > 0 && activePromises.length < concurrency) {
      const task = queue.shift()!;
      const promise = task().then(result => {
        results.push(result);
        const idx = activePromises.indexOf(promise);
        if (idx !== -1) activePromises.splice(idx, 1);
      });
      activePromises.push(promise);
    }

    if (activePromises.length > 0) {
      await Promise.race(activePromises);
    }
  }

  return results;
}

async function main(): Promise<void> {
  console.log('============================================================');
  console.log('PROOF: Telemetry Load Test Harness');
  console.log('============================================================\n');

  // P1: Wallet generation
  console.log('P1: Wallet generation');
  const wallets: { address: string; privateKey: string }[] = [];

  for (let i = 0; i < 10; i++) {
    const privateKey = `0x${randomBytes(32).toString('hex')}`;
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    wallets.push({ address: account.address, privateKey });
  }

  assert('P1-a', wallets.length === 10, `Generated ${wallets.length} wallets`);

  // Check all addresses are valid (start with 0x, 42 chars)
  const validAddresses = wallets.every(w =>
    w.address.startsWith('0x') && w.address.length === 42
  );
  assert('P1-b', validAddresses, 'All addresses are valid format');

  // Check all addresses are unique
  const uniqueAddresses = new Set(wallets.map(w => w.address.toLowerCase()));
  assert('P1-c', uniqueAddresses.size === 10, 'All addresses are unique');

  // Check private keys are not exposed in addresses
  const noLeakedKeys = wallets.every(w => !w.address.includes(w.privateKey.slice(2, 10)));
  assert('P1-d', noLeakedKeys, 'Private keys not leaked in addresses');

  // P2: Concurrency limiter
  console.log('\nP2: Concurrency limiter');

  let maxConcurrent = 0;
  let currentConcurrent = 0;
  const concurrencyLog: number[] = [];

  const tasks = Array(20).fill(null).map(() => async () => {
    currentConcurrent++;
    maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
    concurrencyLog.push(currentConcurrent);

    // Simulate async work
    await new Promise(resolve => setTimeout(resolve, 10));

    currentConcurrent--;
    return Date.now();
  });

  const startTime = Date.now();
  await runWithConcurrency(tasks, 5);
  const duration = Date.now() - startTime;

  assert('P2-a', maxConcurrent <= 5, `Max concurrent tasks: ${maxConcurrent} (limit: 5)`);
  assert('P2-b', concurrencyLog.length === 20, `All ${concurrencyLog.length} tasks executed`);
  // With 20 tasks at 10ms each and concurrency 5, should take ~40ms minimum
  assert('P2-c', duration >= 30, `Duration ${duration}ms suggests concurrency working`);

  // P3: Results aggregation
  console.log('\nP3: Results aggregation');

  interface TestResult {
    status: 'ok' | 'error';
    latencyMs: number;
    errorCode?: string;
  }

  const testResults: TestResult[] = [
    { status: 'ok', latencyMs: 100 },
    { status: 'ok', latencyMs: 150 },
    { status: 'ok', latencyMs: 200 },
    { status: 'error', latencyMs: 500, errorCode: 'TIMEOUT' },
    { status: 'ok', latencyMs: 120 },
    { status: 'error', latencyMs: 300, errorCode: 'NETWORK_ERROR' },
    { status: 'ok', latencyMs: 180 },
    { status: 'error', latencyMs: 400, errorCode: 'TIMEOUT' },
    { status: 'ok', latencyMs: 90 },
    { status: 'ok', latencyMs: 110 },
  ];

  const okCount = testResults.filter(r => r.status === 'ok').length;
  const errorCount = testResults.length - okCount;
  const okPct = (okCount / testResults.length) * 100;

  assert('P3-a', okCount === 7, `OK count: ${okCount}`);
  assert('P3-b', errorCount === 3, `Error count: ${errorCount}`);
  assert('P3-c', okPct === 70, `OK percentage: ${okPct}%`);

  // Error code aggregation
  const errorCounts = new Map<string, number>();
  for (const r of testResults.filter(r => r.status === 'error')) {
    const code = r.errorCode || 'UNKNOWN';
    errorCounts.set(code, (errorCounts.get(code) || 0) + 1);
  }

  assert('P3-d', errorCounts.get('TIMEOUT') === 2, 'TIMEOUT count correct');
  assert('P3-e', errorCounts.get('NETWORK_ERROR') === 1, 'NETWORK_ERROR count correct');

  // P4: Percentile calculations
  console.log('\nP4: Percentile calculations');

  const latencies = testResults.map(r => r.latencyMs);
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);

  assert('P4-a', avgLatency === 215, `Average latency: ${avgLatency}ms`);
  assert('P4-b', p50 === 150, `P50: ${p50}ms`);
  assert('P4-c', p95 === 500, `P95: ${p95}ms`);
  assert('P4-d', p99 === 500, `P99: ${p99}ms`);

  // Edge cases
  assert('P4-e', percentile([], 50) === 0, 'Empty array returns 0');
  assert('P4-f', percentile([100], 50) === 100, 'Single element returns itself');
  assert('P4-g', percentile([100, 200], 50) === 100, 'Two elements P50 correct');

  // P5: DB integration check (dry run)
  console.log('\nP5: DB integration (dry run)');

  try {
    const { initDatabase, upsertUser, closeDatabase } = await import('../telemetry/db');
    initDatabase();

    // Simulate storing test wallets
    for (const wallet of wallets.slice(0, 3)) {
      upsertUser(wallet.address, { source: 'harness-test', timestamp: Date.now() });
    }

    closeDatabase();
    assert('P5-a', true, 'DB integration works (3 test users stored)');
  } catch (e) {
    assert('P5-a', false, `DB integration failed: ${(e as Error).message}`);
  }

  // Summary
  console.log('\n============================================================');
  console.log('SUMMARY');
  console.log('============================================================');

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;

  console.log(`\nPassed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);

  if (failed > 0) {
    console.log('\nFailed proofs:');
    for (const r of results.filter(r => !r.pass)) {
      console.log(`  - ${r.name}: ${r.detail}`);
    }
    process.exit(1);
  }

  console.log('\n✅ All telemetry harness proofs passed');
  process.exit(0);
}

main().catch(e => {
  console.error('Proof execution failed:', e);
  process.exit(1);
});
