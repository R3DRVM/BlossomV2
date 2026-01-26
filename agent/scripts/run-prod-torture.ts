#!/usr/bin/env npx tsx
/**
 * Production Torture Suite
 * Stress test with large notionals across both chains
 */

const BASE_URL = 'https://api.blossom.onl';
const LEDGER_SECRET = process.env.LEDGER_SECRET || process.env.DEV_LEDGER_SECRET;
const COUNT = 30;
const RUN_ID = `torture_v1_${Date.now()}`;

if (!LEDGER_SECRET) {
  console.error('❌ LEDGER_SECRET required');
  process.exit(1);
}

interface TestResult {
  intentId: string;
  status: string;
  chain: string;
  operation: string;
  notional: number;
  latency: number;
  error?: string;
}

async function runTest(
  idx: number,
  chain: 'ethereum' | 'solana',
  intent: string,
  operation: string,
  notional: number
): Promise<TestResult> {
  const start = Date.now();

  try {
    const response = await fetch(`${BASE_URL}/api/ledger/intents/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ledger-Secret': LEDGER_SECRET,
      },
      body: JSON.stringify({
        intentText: intent,
        chain,
        planOnly: false,
        metadata: {
          source: 'torture_v1',
          runId: RUN_ID,
          testName: `torture_${idx}`,
          notional,
        },
      }),
    });

    const result = await response.json();
    const latency = Date.now() - start;

    return {
      intentId: result.intentId || 'none',
      status: result.status || 'error',
      chain,
      operation,
      notional,
      latency,
      error: result.error?.message,
    };
  } catch (err: any) {
    return {
      intentId: 'none',
      status: 'error',
      chain,
      operation,
      notional,
      latency: Date.now() - start,
      error: err.message,
    };
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('PHASE 3: TORTURE SUITE');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Run ID: ${RUN_ID}`);
  console.log(`Count: ${COUNT}`);
  console.log(`Notional Range: 500-9500 REDACTED`);
  console.log(`Chains: ETH Sepolia + SOL Devnet (mixed)`);
  console.log('');

  const results: TestResult[] = [];
  const startTime = Date.now();

  for (let i = 1; i <= COUNT; i++) {
    // Random notional 500-9500
    const notional = 500 + Math.floor(Math.random() * 9000);

    // Cycle through operations
    let chain: 'ethereum' | 'solana';
    let intent: string;
    let operation: string;

    if (i % 3 === 0) {
      chain = 'solana';
      intent = `swap ${notional} REDACTED for SOL`;
      operation = 'SOL_swap';
    } else if (i % 3 === 1) {
      chain = 'ethereum';
      intent = `swap ${notional} REDACTED for WETH`;
      operation = 'ETH_swap';
    } else {
      chain = 'ethereum';
      intent = `deposit ${notional} REDACTED to aave`;
      operation = 'ETH_deposit';
    }

    process.stdout.write(`[${i}/${COUNT}] ${operation} ($${notional})...`);

    const result = await runTest(i, chain, intent, operation, notional);
    results.push(result);

    if (result.status === 'confirmed') {
      console.log(` ✓ confirmed (${result.latency}ms)`);
    } else {
      console.log(` ✗ failed: ${result.error || 'unknown'}`);
    }

    // Small delay
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const totalTime = Math.floor((Date.now() - startTime) / 1000);
  const passed = results.filter(r => r.status === 'confirmed').length;
  const failed = COUNT - passed;
  const successRate = ((passed / COUNT) * 100).toFixed(1);

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('TORTURE SUITE RESULTS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Total: ${COUNT} executions`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Success Rate: ${successRate}%`);
  console.log(`Total Time: ${totalTime}s`);
  console.log('');

  // Latency stats
  const latencies = results.map(r => r.latency).sort((a, b) => a - b);
  const median = latencies[Math.floor(latencies.length / 2)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];

  console.log('Latency Stats:');
  console.log(`  Median: ${median} ms`);
  console.log(`  P95: ${p95} ms`);
  console.log('');

  // Chain breakdown
  const ethCount = results.filter(r => r.chain === 'ethereum').length;
  const solCount = results.filter(r => r.chain === 'solana').length;

  console.log('Chain Distribution:');
  console.log(`  Ethereum: ${ethCount}`);
  console.log(`  Solana: ${solCount}`);
  console.log('');

  // Failure breakdown
  if (failed > 0) {
    console.log('Failed Intents:');
    results
      .filter(r => r.status !== 'confirmed')
      .forEach(r => {
        console.log(`  ${r.intentId}: ${r.error || 'unknown error'}`);
      });
    console.log('');
  }

  console.log(`Run ID: ${RUN_ID}`);
  console.log(`Source Tag: torture_v1`);
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
}

main();
