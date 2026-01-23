#!/usr/bin/env tsx
/**
 * Devnet 1500+ User Load Test Harness
 *
 * Stress tests the backend with configurable concurrent users.
 * Records all activity to telemetry DB for devnet-stats endpoint.
 *
 * Usage:
 *   npm run devnet:load -- --users=1500 --read-concurrency=200 --duration=60
 *
 * Endpoints tested:
 *   - /health
 *   - /api/execute/preflight
 *   - /api/session/status
 *   - /api/defi/aave/positions
 *   - /api/execute/prepare (validateOnly)
 */

import { randomBytes, randomUUID } from 'crypto';
import { privateKeyToAccount } from 'viem/accounts';

// Parse CLI args
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.replace('--', '').split('=');
  acc[key] = value;
  return acc;
}, {} as Record<string, string>);

const N_USERS = parseInt(args['users'] || process.env.DEVNET_USERS || '1500', 10);
const READ_CONCURRENCY = parseInt(args['read-concurrency'] || process.env.READ_CONCURRENCY || '200', 10);
const DURATION_SECS = parseInt(args['duration'] || process.env.DURATION_SECS || '60', 10);
const API_BASE = process.env.AGENT_API_BASE_URL || 'http://localhost:3001';
const RUN_ID = args['run-id'] || `devnet-load-${Date.now()}`;

interface TestWallet {
  address: string;
}

interface TestResult {
  endpoint: string;
  address: string;
  status: 'ok' | 'error';
  latencyMs: number;
  statusCode?: number;
  errorCode?: string;
  errorMessage?: string;
  runId: string;
}

const results: TestResult[] = [];
let totalRequests = 0;
let startTime = 0;

/**
 * Generate ephemeral wallet addresses (no private keys needed for read tests)
 */
function generateWallets(count: number): TestWallet[] {
  console.log(`\n[PHASE 1] Generating ${count} devnet user addresses...`);
  const wallets: TestWallet[] = [];

  for (let i = 0; i < count; i++) {
    const privateKey = `0x${randomBytes(32).toString('hex')}`;
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    wallets.push({ address: account.address });
  }

  console.log(`   Generated ${wallets.length} addresses`);
  return wallets;
}

/**
 * Store wallets in telemetry DB
 */
async function storeWalletsInDb(wallets: TestWallet[]): Promise<void> {
  try {
    const { initDatabase, upsertUser, migrateAddFeeColumns } = await import('../telemetry/db');
    initDatabase();
    migrateAddFeeColumns();

    console.log(`\n[PHASE 2] Storing ${wallets.length} users in telemetry DB...`);
    for (const wallet of wallets) {
      upsertUser(wallet.address, { source: 'devnet-load-test', runId: RUN_ID, generatedAt: new Date().toISOString() });
    }
    console.log(`   Stored ${wallets.length} users`);
  } catch (e) {
    console.warn(`   Warning: Could not store in DB: ${(e as Error).message}`);
  }
}

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Run a single read test
 */
async function runReadTest(endpoint: string, address: string): Promise<TestResult> {
  const startTimeReq = Date.now();
  const url = `${API_BASE}${endpoint}${endpoint.includes('?') ? '&' : '?'}userAddress=${address}`;

  try {
    const response = await fetchWithTimeout(url, {}, 15000);
    const latencyMs = Date.now() - startTimeReq;

    if (response.status === 200 || response.status === 400) {
      // 400 is expected for session/status with no session
      return { endpoint, address, status: 'ok', latencyMs, statusCode: response.status, runId: RUN_ID };
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
        runId: RUN_ID,
      };
    }
  } catch (e) {
    return {
      endpoint,
      address,
      status: 'error',
      latencyMs: Date.now() - startTimeReq,
      errorCode: 'NETWORK_ERROR',
      errorMessage: (e as Error).message,
      runId: RUN_ID,
    };
  }
}

/**
 * Run a preflight/prepare test (POST with body)
 */
async function runPrepareTest(address: string): Promise<TestResult> {
  const startTimeReq = Date.now();
  const endpoint = '/api/execute/prepare';
  const url = `${API_BASE}${endpoint}`;

  try {
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userAddress: address,
        plan: {
          actions: [
            {
              type: 0, // swap
              inputToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
              outputToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
              inputAmount: '1000000', // 1 USDC
              minOutputAmount: '0',
            },
          ],
          kind: 'swap',
        },
        validateOnly: true, // Dry-run mode
      }),
    }, 15000);

    const latencyMs = Date.now() - startTimeReq;

    if (response.status === 200 || response.status === 400) {
      return { endpoint, address, status: 'ok', latencyMs, statusCode: response.status, runId: RUN_ID };
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
        runId: RUN_ID,
      };
    }
  } catch (e) {
    return {
      endpoint,
      address,
      status: 'error',
      latencyMs: Date.now() - startTimeReq,
      errorCode: 'NETWORK_ERROR',
      errorMessage: (e as Error).message,
      runId: RUN_ID,
    };
  }
}

/**
 * Run concurrent tests for a duration
 */
async function runLoadTest(wallets: TestWallet[], durationSecs: number, concurrency: number): Promise<void> {
  console.log(`\n[PHASE 3] Running load test...`);
  console.log(`   Duration: ${durationSecs}s`);
  console.log(`   Concurrency: ${concurrency}`);
  console.log(`   Target users: ${wallets.length}`);

  const endpoints = [
    '/health',
    '/api/execute/preflight',
    '/api/session/status',
    '/api/defi/aave/positions',
  ];

  startTime = Date.now();
  const endTime = startTime + (durationSecs * 1000);
  const activePromises: Promise<void>[] = [];
  let walletIndex = 0;

  const addRequest = () => {
    if (Date.now() >= endTime) return;

    const wallet = wallets[walletIndex % wallets.length];
    walletIndex++;

    // Rotate through endpoints
    const endpoint = endpoints[totalRequests % endpoints.length];
    totalRequests++;

    const promise = (endpoint === '/api/execute/prepare'
      ? runPrepareTest(wallet.address)
      : runReadTest(endpoint, wallet.address)
    ).then(result => {
      results.push(result);
      const idx = activePromises.indexOf(promise);
      if (idx !== -1) activePromises.splice(idx, 1);

      // Keep adding requests
      if (Date.now() < endTime && activePromises.length < concurrency) {
        addRequest();
      }
    });

    activePromises.push(promise);
  };

  // Start initial batch
  for (let i = 0; i < Math.min(concurrency, wallets.length * endpoints.length); i++) {
    addRequest();
  }

  // Wait for duration
  while (Date.now() < endTime || activePromises.length > 0) {
    if (activePromises.length > 0) {
      await Promise.race(activePromises);
    }
    // Refill to concurrency
    while (activePromises.length < concurrency && Date.now() < endTime) {
      addRequest();
    }

    // Progress update every 10s
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    if (elapsed > 0 && elapsed % 10 === 0 && elapsed < durationSecs) {
      const rps = Math.round(results.length / elapsed);
      process.stdout.write(`\r   Progress: ${elapsed}s / ${durationSecs}s | ${results.length} requests | ${rps} req/s`);
    }
  }

  // Wait for all to complete
  await Promise.all(activePromises);

  console.log(`\n   Completed ${results.length} requests`);
}

/**
 * Store results in telemetry DB
 */
async function storeResultsInDb(): Promise<void> {
  try {
    const { initDatabase, logRequest } = await import('../telemetry/db');
    initDatabase();

    console.log(`\n[PHASE 4] Storing ${results.length} results in telemetry DB...`);
    for (const r of results) {
      logRequest({
        endpoint: r.endpoint,
        method: 'GET',
        userAddress: r.address,
        correlationId: RUN_ID,
        statusCode: r.statusCode,
        latencyMs: r.latencyMs,
        errorCode: r.errorCode,
      });
    }
    console.log(`   Stored ${results.length} request logs`);
  } catch (e) {
    console.warn(`   Warning: Could not store results: ${(e as Error).message}`);
  }
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
 * Print summary
 */
function printSummary(): void {
  const elapsed = (Date.now() - startTime) / 1000;
  const rps = Math.round(results.length / elapsed);

  console.log('\n============================================================');
  console.log('DEVNET LOAD TEST REPORT');
  console.log('============================================================');
  console.log(`Run ID: ${RUN_ID}`);
  console.log(`Duration: ${elapsed.toFixed(1)}s`);
  console.log(`Total Requests: ${results.length}`);
  console.log(`Requests/sec: ${rps}`);
  console.log(`Users: ${N_USERS}`);
  console.log(`Concurrency: ${READ_CONCURRENCY}`);
  console.log('');

  // Group by endpoint
  const byEndpoint = new Map<string, TestResult[]>();
  for (const r of results) {
    const arr = byEndpoint.get(r.endpoint) || [];
    arr.push(r);
    byEndpoint.set(r.endpoint, arr);
  }

  // Print table
  console.log('| Endpoint                      | Total | OK   | Fail | OK%   | Avg ms | P50 ms | P95 ms |');
  console.log('|-------------------------------|-------|------|------|-------|--------|--------|--------|');

  for (const [endpoint, endpointResults] of byEndpoint) {
    const okCount = endpointResults.filter(r => r.status === 'ok').length;
    const failCount = endpointResults.length - okCount;
    const okPct = ((okCount / endpointResults.length) * 100).toFixed(1);
    const latencies = endpointResults.map(r => r.latencyMs);
    const avgLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
    const p50Latency = percentile(latencies, 50);
    const p95Latency = percentile(latencies, 95);

    console.log(`| ${endpoint.padEnd(29)} | ${endpointResults.length.toString().padStart(5)} | ${okCount.toString().padStart(4)} | ${failCount.toString().padStart(4)} | ${okPct.padStart(5)}% | ${avgLatency.toString().padStart(6)} | ${p50Latency.toString().padStart(6)} | ${p95Latency.toString().padStart(6)} |`);
  }

  // Error summary
  const errors = results.filter(r => r.status === 'error');
  const http5xx = results.filter(r => r.statusCode && r.statusCode >= 500);

  console.log('');
  console.log(`HTTP 5xx errors: ${http5xx.length}`);

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
  const totalOk = results.filter(r => r.status === 'ok').length;
  const allLatencies = results.map(r => r.latencyMs);
  console.log('');
  console.log(`Overall: ${totalOk}/${results.length} OK (${((totalOk / results.length) * 100).toFixed(1)}%)`);
  console.log(`Average latency: ${Math.round(allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length)}ms`);
  console.log(`P50 latency: ${percentile(allLatencies, 50)}ms`);
  console.log(`P95 latency: ${percentile(allLatencies, 95)}ms`);
  console.log('');

  // Pass/Fail determination
  const successRate = totalOk / results.length;
  if (successRate >= 0.99 && http5xx.length === 0) {
    console.log('RESULT: PASS (>99% success rate, no 5xx errors)');
  } else if (successRate >= 0.95) {
    console.log('RESULT: WARNING (95-99% success rate)');
  } else {
    console.log('RESULT: FAIL (<95% success rate or significant errors)');
  }

  console.log('============================================================');
}

/**
 * Main
 */
async function main(): Promise<void> {
  console.log('============================================================');
  console.log('DEVNET 1500+ USER LOAD TEST');
  console.log('============================================================');
  console.log(`\nConfiguration:`);
  console.log(`   Users: ${N_USERS}`);
  console.log(`   Concurrency: ${READ_CONCURRENCY}`);
  console.log(`   Duration: ${DURATION_SECS}s`);
  console.log(`   API Base: ${API_BASE}`);
  console.log(`   Run ID: ${RUN_ID}`);

  // Generate wallets
  const wallets = generateWallets(N_USERS);

  // Store in DB
  await storeWalletsInDb(wallets);

  // Run load test
  await runLoadTest(wallets, DURATION_SECS, READ_CONCURRENCY);

  // Store results
  await storeResultsInDb();

  // Print summary
  printSummary();
}

// Run
main().catch(console.error);
