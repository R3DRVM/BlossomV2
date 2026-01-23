#!/usr/bin/env tsx
/**
 * Bloom 100-User Incremental Load Test Harness
 *
 * Phases:
 * 1. Generate N wallets (ephemeral) and store addresses in DB
 * 2. Run read tests (session/status, preflight, positions)
 * 3. Run limited concurrent execute tests (capped for safety)
 *
 * Usage:
 *   npm run load-test
 *   npm run load-test -- --users=100 --read-concurrency=50 --exec-concurrency=5
 */

import { randomBytes } from 'crypto';
import { privateKeyToAccount } from 'viem/accounts';

// Parse CLI args
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.replace('--', '').split('=');
  acc[key] = value;
  return acc;
}, {} as Record<string, string>);

const N_USERS = parseInt(args['users'] || process.env.N_USERS || '100', 10);
const READ_CONCURRENCY = parseInt(args['read-concurrency'] || process.env.READ_CONCURRENCY || '50', 10);
const EXEC_CONCURRENCY = parseInt(args['exec-concurrency'] || process.env.EXEC_CONCURRENCY || '5', 10);
const API_BASE = process.env.AGENT_API_BASE_URL || 'http://localhost:3001';
const MODE = args['mode'] || 'read-only'; // read-only | full

interface TestWallet {
  address: string;
  privateKey: string; // Only kept in memory, never persisted
}

interface TestResult {
  endpoint: string;
  address: string;
  status: 'ok' | 'error';
  latencyMs: number;
  statusCode?: number;
  errorCode?: string;
  errorMessage?: string;
}

const results: TestResult[] = [];

/**
 * Generate ephemeral wallets
 */
function generateWallets(count: number): TestWallet[] {
  console.log(`\n📝 Generating ${count} ephemeral wallets...`);
  const wallets: TestWallet[] = [];

  for (let i = 0; i < count; i++) {
    const privateKey = `0x${randomBytes(32).toString('hex')}`;
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    wallets.push({
      address: account.address,
      privateKey, // Memory only
    });
  }

  console.log(`   Generated ${wallets.length} wallets`);
  return wallets;
}

/**
 * Store wallets in telemetry DB (addresses only)
 */
async function storeWalletsInDb(wallets: TestWallet[]): Promise<void> {
  try {
    const { initDatabase, upsertUser } = await import('../telemetry/db');
    initDatabase();

    console.log(`\n💾 Storing ${wallets.length} user addresses in telemetry DB...`);
    for (const wallet of wallets) {
      upsertUser(wallet.address, { source: 'load-test', generatedAt: new Date().toISOString() });
    }
    console.log(`   Stored ${wallets.length} users`);
  } catch (e) {
    console.warn(`   ⚠️ Could not store in DB: ${(e as Error).message}`);
  }
}

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Run a single read test
 */
async function runReadTest(endpoint: string, address: string): Promise<TestResult> {
  const startTime = Date.now();
  const url = `${API_BASE}${endpoint}${endpoint.includes('?') ? '&' : '?'}userAddress=${address}`;

  try {
    const response = await fetchWithTimeout(url, {}, 10000);
    const latencyMs = Date.now() - startTime;

    if (response.status === 200) {
      return { endpoint, address, status: 'ok', latencyMs, statusCode: response.status };
    } else {
      const data = await response.json().catch(() => ({}));
      return {
        endpoint,
        address,
        status: 'error',
        latencyMs,
        statusCode: response.status,
        errorCode: data.errorCode || `HTTP_${response.status}`,
        errorMessage: data.error || data.message,
      };
    }
  } catch (e) {
    return {
      endpoint,
      address,
      status: 'error',
      latencyMs: Date.now() - startTime,
      errorCode: 'NETWORK_ERROR',
      errorMessage: (e as Error).message,
    };
  }
}

/**
 * Run concurrent read tests with concurrency limit
 */
async function runConcurrentReadTests(
  wallets: TestWallet[],
  endpoint: string,
  concurrency: number
): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const queue = [...wallets];
  const activePromises: Promise<void>[] = [];

  console.log(`   Testing ${endpoint} with ${wallets.length} users (concurrency: ${concurrency})...`);

  while (queue.length > 0 || activePromises.length > 0) {
    // Fill up to concurrency limit
    while (queue.length > 0 && activePromises.length < concurrency) {
      const wallet = queue.shift()!;
      const promise = runReadTest(endpoint, wallet.address).then(result => {
        results.push(result);
        const idx = activePromises.indexOf(promise);
        if (idx !== -1) activePromises.splice(idx, 1);
      });
      activePromises.push(promise);
    }

    // Wait for at least one to complete
    if (activePromises.length > 0) {
      await Promise.race(activePromises);
    }
  }

  return results;
}

/**
 * Calculate percentile
 */
function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Print summary table
 */
function printSummary(allResults: TestResult[]): void {
  console.log('\n============================================================');
  console.log('LOAD TEST SUMMARY');
  console.log('============================================================\n');

  // Group by endpoint
  const byEndpoint = new Map<string, TestResult[]>();
  for (const r of allResults) {
    const arr = byEndpoint.get(r.endpoint) || [];
    arr.push(r);
    byEndpoint.set(r.endpoint, arr);
  }

  // Print table header
  console.log('| Endpoint                      | Total | OK   | Fail | OK%   | Avg ms | P95 ms |');
  console.log('|-------------------------------|-------|------|------|-------|--------|--------|');

  for (const [endpoint, results] of byEndpoint) {
    const okCount = results.filter(r => r.status === 'ok').length;
    const failCount = results.length - okCount;
    const okPct = ((okCount / results.length) * 100).toFixed(1);
    const latencies = results.map(r => r.latencyMs);
    const avgLatency = (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(0);
    const p95Latency = percentile(latencies, 95).toFixed(0);

    console.log(`| ${endpoint.padEnd(29)} | ${results.length.toString().padStart(5)} | ${okCount.toString().padStart(4)} | ${failCount.toString().padStart(4)} | ${okPct.padStart(5)}% | ${avgLatency.padStart(6)} | ${p95Latency.padStart(6)} |`);
  }

  // Top errors
  const errors = allResults.filter(r => r.status === 'error');
  if (errors.length > 0) {
    console.log('\nTop Error Codes:');
    const errorCounts = new Map<string, number>();
    for (const e of errors) {
      const code = e.errorCode || 'UNKNOWN';
      errorCounts.set(code, (errorCounts.get(code) || 0) + 1);
    }
    const sortedErrors = [...errorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [code, count] of sortedErrors) {
      console.log(`   ${code}: ${count}`);
    }
  }

  // Overall
  const totalOk = allResults.filter(r => r.status === 'ok').length;
  const totalFail = allResults.length - totalOk;
  console.log(`\n📊 Overall: ${totalOk}/${allResults.length} OK (${((totalOk / allResults.length) * 100).toFixed(1)}%)`);
  console.log(`   Avg latency: ${(allResults.reduce((a, r) => a + r.latencyMs, 0) / allResults.length).toFixed(0)}ms`);
  console.log(`   P95 latency: ${percentile(allResults.map(r => r.latencyMs), 95).toFixed(0)}ms`);
}

/**
 * Store results in telemetry DB
 */
async function storeResultsInDb(allResults: TestResult[]): Promise<void> {
  try {
    const { initDatabase, logRequest } = await import('../telemetry/db');
    initDatabase();

    console.log(`\n💾 Storing ${allResults.length} test results in DB...`);
    for (const r of allResults) {
      logRequest({
        endpoint: r.endpoint,
        method: 'GET',
        userAddress: r.address,
        statusCode: r.statusCode,
        latencyMs: r.latencyMs,
        errorCode: r.errorCode,
      });
    }
    console.log(`   Stored ${allResults.length} results`);
  } catch (e) {
    console.warn(`   ⚠️ Could not store results in DB: ${(e as Error).message}`);
  }
}

/**
 * Main harness
 */
async function main(): Promise<void> {
  console.log('============================================================');
  console.log('BLOOM 100-USER LOAD TEST HARNESS');
  console.log('============================================================');
  console.log(`\nConfiguration:`);
  console.log(`   Users: ${N_USERS}`);
  console.log(`   Read Concurrency: ${READ_CONCURRENCY}`);
  console.log(`   Exec Concurrency: ${EXEC_CONCURRENCY} (capped for safety)`);
  console.log(`   Mode: ${MODE}`);
  console.log(`   API Base: ${API_BASE}`);

  // Phase 1: Generate wallets
  const wallets = generateWallets(N_USERS);

  // Store in DB (addresses only)
  await storeWalletsInDb(wallets);

  // Phase 2: Read tests
  console.log('\n🔍 PHASE 2: Read Tests');
  const allResults: TestResult[] = [];

  // Test session/status endpoint
  const sessionResults = await runConcurrentReadTests(wallets, '/api/session/status', READ_CONCURRENCY);
  allResults.push(...sessionResults);

  // Test preflight endpoint
  const preflightResults = await runConcurrentReadTests(wallets, '/api/execute/preflight', READ_CONCURRENCY);
  allResults.push(...preflightResults);

  // Test health endpoint (lightweight)
  const healthResults = await runConcurrentReadTests(wallets.slice(0, 10), '/health', 10);
  allResults.push(...healthResults);

  // Store results in DB
  await storeResultsInDb(allResults);

  // Print summary
  printSummary(allResults);

  // Phase 3: Execution tests (only in full mode)
  if (MODE === 'full') {
    console.log('\n⚠️ Execution tests not implemented in this version');
    console.log('   (Would require funded wallets and careful nonce management)');
  }

  console.log('\n✅ Load test complete');
}

// Run
main().catch(console.error);
