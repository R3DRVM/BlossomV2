#!/usr/bin/env tsx
/**
 * Devnet Stats Proof Gates
 *
 * Validates:
 * 1. prove:devnet:stats - Schema validation, non-negative metrics, fee bps range
 * 2. prove:devnet:load:smoke - Quick load test (50 users, 20 concurrent, 10s)
 * 3. prove:devnet:ui:stats - Endpoint reachable with expected keys
 *
 * Usage:
 *   npm run prove:devnet:stats
 *   npm run prove:devnet:load:smoke
 *   npm run prove:devnet:ui:stats
 */

const API_BASE = process.env.AGENT_API_BASE_URL || 'http://localhost:3001';

// Determine which proof to run based on npm script name or CLI arg
const proofType = process.argv[2] || process.env.PROOF_TYPE || 'stats';

interface ProofResult {
  name: string;
  passed: boolean;
  message: string;
}

const results: ProofResult[] = [];

function assert(name: string, condition: boolean, message: string): void {
  results.push({
    name,
    passed: condition,
    message: condition ? 'OK' : message,
  });
  if (!condition) {
    console.log(`   FAIL: ${name} - ${message}`);
  } else {
    console.log(`   PASS: ${name}`);
  }
}

/**
 * P1: prove:devnet:stats - Database and schema validation
 */
async function proveDevnetStats(): Promise<boolean> {
  console.log('\n[PROOF] prove:devnet:stats');
  console.log('   Validating devnet stats schema and values...\n');

  try {
    const { initDatabase, getDevnetStats, migrateAddFeeColumns } = await import('../telemetry/db');
    const { BLOSSOM_FEE_BPS } = await import('../src/config');

    // P1.1: Database initializes
    initDatabase();
    migrateAddFeeColumns();
    assert('P1.1: DB init', true, '');

    // P1.2: Fee BPS in valid range
    assert('P1.2: Fee BPS range', BLOSSOM_FEE_BPS >= 10 && BLOSSOM_FEE_BPS <= 50,
      `BLOSSOM_FEE_BPS=${BLOSSOM_FEE_BPS} outside valid range 10-50`);

    // P1.3: Get stats returns valid object
    const stats = getDevnetStats(BLOSSOM_FEE_BPS);
    assert('P1.3: Stats object exists', !!stats, 'getDevnetStats returned null');

    // P1.4: Users schema
    assert('P1.4: users.allTime >= 0', stats.users.allTime >= 0,
      `users.allTime is negative: ${stats.users.allTime}`);
    assert('P1.5: users.last24h >= 0', stats.users.last24h >= 0,
      `users.last24h is negative: ${stats.users.last24h}`);

    // P1.5: Transactions schema
    assert('P1.6: transactions.allTime >= 0', stats.transactions.allTime >= 0,
      `transactions.allTime is negative: ${stats.transactions.allTime}`);
    assert('P1.7: transactions.successCount >= 0', stats.transactions.successCount >= 0,
      `transactions.successCount is negative: ${stats.transactions.successCount}`);
    assert('P1.8: transactions.failCount >= 0', stats.transactions.failCount >= 0,
      `transactions.failCount is negative: ${stats.transactions.failCount}`);

    // P1.6: Amount executed schema
    assert('P1.9: amountExecuted.byToken is array', Array.isArray(stats.amountExecuted.byToken),
      'amountExecuted.byToken is not an array');
    assert('P1.10: amountExecuted.unpricedCount >= 0', stats.amountExecuted.unpricedCount >= 0,
      `amountExecuted.unpricedCount is negative: ${stats.amountExecuted.unpricedCount}`);

    // P1.7: Fees schema
    assert('P1.11: feesCollected.byToken is array', Array.isArray(stats.feesCollected.byToken),
      'feesCollected.byToken is not an array');
    assert('P1.12: feesCollected.feeBps matches config', stats.feesCollected.feeBps === BLOSSOM_FEE_BPS,
      `feesCollected.feeBps (${stats.feesCollected.feeBps}) != BLOSSOM_FEE_BPS (${BLOSSOM_FEE_BPS})`);

    // P1.8: Generated timestamp
    assert('P1.13: generatedAt is ISO string', typeof stats.generatedAt === 'string' && stats.generatedAt.includes('T'),
      `generatedAt is not a valid ISO string: ${stats.generatedAt}`);

    return results.filter(r => !r.passed).length === 0;

  } catch (error) {
    assert('P1.0: Import/init', false, (error as Error).message);
    return false;
  }
}

/**
 * P2: prove:devnet:load:smoke - Quick load test
 */
async function proveDevnetLoadSmoke(): Promise<boolean> {
  console.log('\n[PROOF] prove:devnet:load:smoke');
  console.log('   Running 50-user, 20-concurrency, 10s smoke test...\n');

  const { randomBytes } = await import('crypto');
  const { privateKeyToAccount } = await import('viem/accounts');

  const SMOKE_USERS = 50;
  const SMOKE_CONCURRENCY = 20;
  const SMOKE_DURATION_SECS = 10;

  // Generate wallets
  const wallets: string[] = [];
  for (let i = 0; i < SMOKE_USERS; i++) {
    const privateKey = `0x${randomBytes(32).toString('hex')}`;
    wallets.push(privateKeyToAccount(privateKey as `0x${string}`).address);
  }

  const endpoints = ['/health', '/api/execute/preflight', '/api/session/status'];
  const smokeResults: { status: 'ok' | 'error'; endpoint: string }[] = [];

  const startTime = Date.now();
  const endTime = startTime + (SMOKE_DURATION_SECS * 1000);
  const activePromises: Promise<void>[] = [];
  let requestIndex = 0;

  const addRequest = () => {
    if (Date.now() >= endTime) return;

    const wallet = wallets[requestIndex % wallets.length];
    const endpoint = endpoints[requestIndex % endpoints.length];
    requestIndex++;

    const url = `${API_BASE}${endpoint}${endpoint.includes('?') ? '&' : '?'}userAddress=${wallet}`;

    const promise = fetch(url, { signal: AbortSignal.timeout(10000) })
      .then(res => {
        smokeResults.push({ status: res.status === 200 || res.status === 400 ? 'ok' : 'error', endpoint });
      })
      .catch(() => {
        smokeResults.push({ status: 'error', endpoint });
      })
      .finally(() => {
        const idx = activePromises.indexOf(promise);
        if (idx !== -1) activePromises.splice(idx, 1);
        if (Date.now() < endTime && activePromises.length < SMOKE_CONCURRENCY) {
          addRequest();
        }
      });

    activePromises.push(promise);
  };

  // Start initial batch
  for (let i = 0; i < SMOKE_CONCURRENCY; i++) {
    addRequest();
  }

  // Wait
  while (Date.now() < endTime || activePromises.length > 0) {
    if (activePromises.length > 0) {
      await Promise.race(activePromises);
    }
    while (activePromises.length < SMOKE_CONCURRENCY && Date.now() < endTime) {
      addRequest();
    }
    await new Promise(r => setTimeout(r, 100));
  }

  await Promise.all(activePromises);

  // Analyze results
  const totalOk = smokeResults.filter(r => r.status === 'ok').length;
  const total = smokeResults.length;
  const successRate = total > 0 ? (totalOk / total) * 100 : 0;

  console.log(`   Total requests: ${total}`);
  console.log(`   Success: ${totalOk}`);
  console.log(`   Success rate: ${successRate.toFixed(1)}%`);

  assert('P2.1: Sent requests', total > 0, `No requests sent`);
  assert('P2.2: Success rate >= 99%', successRate >= 99, `Success rate ${successRate.toFixed(1)}% < 99%`);

  // Per-endpoint check
  for (const endpoint of endpoints) {
    const endpointResults = smokeResults.filter(r => r.endpoint === endpoint);
    const endpointOk = endpointResults.filter(r => r.status === 'ok').length;
    const endpointRate = endpointResults.length > 0 ? (endpointOk / endpointResults.length) * 100 : 0;
    assert(`P2.3: ${endpoint} >= 95%`, endpointRate >= 95,
      `${endpoint} success rate ${endpointRate.toFixed(1)}% < 95%`);
  }

  return results.filter(r => !r.passed).length === 0;
}

/**
 * P3: prove:devnet:ui:stats - Endpoint reachable with traffic/execution split
 */
async function proveDevnetUiStats(): Promise<boolean> {
  console.log('\n[PROOF] prove:devnet:ui:stats');
  console.log('   Validating /api/telemetry/devnet-stats endpoint...\n');

  try {
    const response = await fetch(`${API_BASE}/api/telemetry/devnet-stats`, {
      signal: AbortSignal.timeout(10000),
    });

    assert('P3.1: HTTP 200', response.status === 200, `HTTP ${response.status}`);

    const data = await response.json();

    assert('P3.2: ok field exists', 'ok' in data, 'Missing "ok" field');
    assert('P3.3: data field exists', 'data' in data, 'Missing "data" field');

    if (data.data) {
      // Traffic stats (HTTP requests)
      assert('P3.4: traffic key exists', 'traffic' in data.data, 'Missing "traffic" key');
      if (data.data.traffic) {
        assert('P3.4.1: traffic.requestsAllTime exists', 'requestsAllTime' in data.data.traffic, 'Missing traffic.requestsAllTime');
        assert('P3.4.2: traffic.successRate24h exists', 'successRate24h' in data.data.traffic, 'Missing traffic.successRate24h');
      }

      // Execution stats (on-chain transactions)
      assert('P3.5: executions key exists', 'executions' in data.data, 'Missing "executions" key');
      if (data.data.executions) {
        assert('P3.5.1: executions.allTime exists', 'allTime' in data.data.executions, 'Missing executions.allTime');
        assert('P3.5.2: executions.successCount exists', 'successCount' in data.data.executions, 'Missing executions.successCount');
      }

      // Other required keys
      assert('P3.6: users key exists', 'users' in data.data, 'Missing "users" key');
      assert('P3.7: amountExecuted key exists', 'amountExecuted' in data.data, 'Missing "amountExecuted" key');
      assert('P3.8: feesCollected key exists', 'feesCollected' in data.data, 'Missing "feesCollected" key');
      assert('P3.9: generatedAt key exists', 'generatedAt' in data.data, 'Missing "generatedAt" key');
    }

    return results.filter(r => !r.passed).length === 0;

  } catch (error) {
    assert('P3.0: Endpoint reachable', false, (error as Error).message);
    return false;
  }
}

/**
 * P4: prove:devnet:rpc:health - RPC provider health endpoint
 */
async function proveDevnetRpcHealth(): Promise<boolean> {
  console.log('\n[PROOF] prove:devnet:rpc:health');
  console.log('   Validating /api/rpc/health endpoint...\n');

  try {
    const response = await fetch(`${API_BASE}/api/rpc/health`, {
      signal: AbortSignal.timeout(10000),
    });

    assert('P4.1: HTTP 200', response.status === 200, `HTTP ${response.status}`);

    const data = await response.json();

    assert('P4.2: ok field exists', 'ok' in data, 'Missing "ok" field');
    assert('P4.3: primary field exists', 'primary' in data, 'Missing "primary" field');
    assert('P4.4: fallbacks field exists', 'fallbacks' in data, 'Missing "fallbacks" field');

    // If primary is configured, check its structure
    if (data.primary) {
      assert('P4.5: primary.url exists', 'url' in data.primary, 'Missing primary.url');
      assert('P4.6: primary.healthy exists', 'healthy' in data.primary, 'Missing primary.healthy');
      assert('P4.7: primary.circuitOpen exists', 'circuitOpen' in data.primary, 'Missing primary.circuitOpen');
    }

    return results.filter(r => !r.passed).length === 0;

  } catch (error) {
    assert('P4.0: Endpoint reachable', false, (error as Error).message);
    return false;
  }
}

/**
 * Main
 */
async function main(): Promise<void> {
  console.log('============================================================');
  console.log('DEVNET STATS PROOF GATES');
  console.log('============================================================');

  let allPassed = true;

  switch (proofType) {
    case 'stats':
      allPassed = await proveDevnetStats();
      break;
    case 'load-smoke':
    case 'smoke':
      allPassed = await proveDevnetLoadSmoke();
      break;
    case 'ui-stats':
    case 'ui':
      allPassed = await proveDevnetUiStats();
      break;
    case 'rpc-health':
    case 'rpc':
      allPassed = await proveDevnetRpcHealth();
      break;
    case 'all':
      allPassed = await proveDevnetStats() && await proveDevnetUiStats() && await proveDevnetRpcHealth();
      // Note: smoke test requires backend running
      break;
    default:
      console.log(`Unknown proof type: ${proofType}`);
      console.log('Available: stats, load-smoke, ui-stats, rpc-health, all');
      process.exit(1);
  }

  console.log('\n============================================================');
  console.log('PROOF SUMMARY');
  console.log('============================================================');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log('');

  if (failed > 0) {
    console.log('FAILED PROOFS:');
    for (const r of results.filter(r => !r.passed)) {
      console.log(`   ${r.name}: ${r.message}`);
    }
    console.log('');
  }

  if (allPassed) {
    console.log('RESULT: ALL PROOFS PASSED');
    process.exit(0);
  } else {
    console.log('RESULT: PROOFS FAILED');
    process.exit(1);
  }
}

// Run
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
