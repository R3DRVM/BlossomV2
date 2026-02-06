#!/usr/bin/env npx tsx
/**
 * Blossom Stress Testing Script
 *
 * Simulates wallet interactions and populates real metrics by:
 * 1. Generating test wallet addresses
 * 2. Sending multiple intent parsing requests to the backend API
 * 3. Testing various intent types: swap, perp long/short, deposit, event bets
 * 4. Tracking success/failure rates
 * 5. Logging results to console with summary stats
 *
 * Usage:
 *   npx tsx scripts/stress-test.ts
 *
 * Environment variables:
 *   API_BASE_URL - Backend API URL (default: http://localhost:3001)
 *   TEST_WALLET_ADDRESS - Optional: use a specific wallet address for testing
 *   STRESS_CONCURRENCY - Number of concurrent requests (default: 5)
 *   STRESS_TOTAL_REQUESTS - Total number of requests to send (default: 25)
 */

import { randomBytes } from 'crypto';

// Configuration
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';
const TEST_WALLET = process.env.TEST_WALLET_ADDRESS || null;
const CONCURRENCY = parseInt(process.env.STRESS_CONCURRENCY || '5', 10);
const TOTAL_REQUESTS = parseInt(process.env.STRESS_TOTAL_REQUESTS || '25', 10);

// Generate a random Ethereum address
function generateWalletAddress(): string {
  const bytes = randomBytes(20);
  return '0x' + bytes.toString('hex');
}

// Test prompt categories
interface TestPrompt {
  category: 'swap' | 'perp' | 'defi' | 'event' | 'edge_case' | 'greeting' | 'help';
  prompt: string;
  description: string;
}

const TEST_PROMPTS: TestPrompt[] = [
  // Swap intents
  { category: 'swap', prompt: 'Swap 100 USDC for ETH', description: 'Basic swap with amount' },
  { category: 'swap', prompt: 'swap 50 busdc to weth', description: 'Lowercase swap' },
  { category: 'swap', prompt: 'Convert 200 USDC to WBTC', description: 'Convert variation' },
  { category: 'swap', prompt: 'Trade 1000 usdc for eth', description: 'Trade variation' },
  { category: 'swap', prompt: 'exchange 500 BUSDC for weth', description: 'Exchange variation' },

  // Perp long intents
  { category: 'perp', prompt: 'Long BTC with 5x leverage', description: 'Basic long with leverage' },
  { category: 'perp', prompt: 'go long ETH 10x', description: 'Go long variation' },
  { category: 'perp', prompt: 'Long BTC with $500', description: 'Long with dollar amount' },
  { category: 'perp', prompt: 'long eth 3x with 100 usdc', description: 'Long with leverage and amount' },

  // Perp short intents
  { category: 'perp', prompt: 'Short ETH with $500', description: 'Basic short with amount' },
  { category: 'perp', prompt: 'go short BTC 5x', description: 'Go short variation' },
  { category: 'perp', prompt: 'short eth with 10x leverage', description: 'Short with explicit leverage' },

  // DeFi/Deposit intents
  { category: 'defi', prompt: 'Deposit $200 into Aave', description: 'Basic deposit' },
  { category: 'defi', prompt: 'deposit 500 usdc to aave', description: 'Lowercase deposit' },
  { category: 'defi', prompt: 'Supply 1000 USDC to lending', description: 'Supply variation' },
  { category: 'defi', prompt: 'lend 300 busdc', description: 'Lend variation' },

  // Event/Prediction market intents
  { category: 'event', prompt: 'Bet $50 on BTC above 100k', description: 'Basic event bet' },
  { category: 'event', prompt: 'bet 25 usdc yes on fed rate cut', description: 'Lowercase event bet' },
  { category: 'event', prompt: 'wager $100 on ETH reaching 5000', description: 'Wager variation' },
  { category: 'event', prompt: 'predict btc above 120k by march', description: 'Predict variation' },

  // Edge cases - typos, missing amounts, unusual formatting
  { category: 'edge_case', prompt: 'swpa 100 usdc to eth', description: 'Typo: swpa instead of swap' },
  { category: 'edge_case', prompt: 'LONG BTC LEVERAGE 20X!!!', description: 'All caps with punctuation' },
  { category: 'edge_case', prompt: 'swap usdc eth', description: 'Missing amount' },
  { category: 'edge_case', prompt: 'depositt 100 to aave', description: 'Typo: depositt' },
  { category: 'edge_case', prompt: '   swap   100   usdc   to   eth   ', description: 'Extra whitespace' },

  // Greeting and help (should return quick responses)
  { category: 'greeting', prompt: 'hi', description: 'Simple greeting' },
  { category: 'greeting', prompt: 'hello there', description: 'Friendly greeting' },
  { category: 'help', prompt: 'what can you do?', description: 'Help query' },
  { category: 'help', prompt: 'help', description: 'Simple help' },
];

// Results tracking
interface RequestResult {
  id: number;
  endpoint: string;
  prompt?: string;
  category?: string;
  walletAddress: string;
  success: boolean;
  statusCode: number;
  latencyMs: number;
  error?: string;
  responseOk?: boolean;
  hasExecutionRequest?: boolean;
}

const results: RequestResult[] = [];

// HTTP request helper
async function makeRequest(
  endpoint: string,
  method: 'GET' | 'POST',
  body?: object,
  walletAddress?: string
): Promise<{ ok: boolean; status: number; data: any; latencyMs: number }> {
  const startTime = Date.now();
  const url = `${API_BASE_URL}${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (walletAddress) {
    headers['X-Wallet-Address'] = walletAddress;
  }

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const latencyMs = Date.now() - startTime;
    let data: any;

    try {
      data = await response.json();
    } catch {
      data = { parseError: 'Failed to parse JSON response' };
    }

    return {
      ok: response.ok,
      status: response.status,
      data,
      latencyMs,
    };
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    return {
      ok: false,
      status: 0,
      data: { error: error.message },
      latencyMs,
    };
  }
}

// Test the /api/chat endpoint with an intent
async function testChatIntent(id: number, testPrompt: TestPrompt, walletAddress: string): Promise<RequestResult> {
  const response = await makeRequest(
    '/api/chat',
    'POST',
    { userMessage: testPrompt.prompt },
    walletAddress
  );

  return {
    id,
    endpoint: '/api/chat',
    prompt: testPrompt.prompt,
    category: testPrompt.category,
    walletAddress,
    success: response.ok,
    statusCode: response.status,
    latencyMs: response.latencyMs,
    error: response.ok ? undefined : response.data?.error || 'Unknown error',
    responseOk: response.data?.ok,
    hasExecutionRequest: !!response.data?.executionRequest,
  };
}

// Test the /api/execute/preflight endpoint
async function testPreflight(id: number, walletAddress: string): Promise<RequestResult> {
  const response = await makeRequest(
    '/api/execute/preflight',
    'GET',
    undefined,
    walletAddress
  );

  return {
    id,
    endpoint: '/api/execute/preflight',
    walletAddress,
    success: response.ok,
    statusCode: response.status,
    latencyMs: response.latencyMs,
    error: response.ok ? undefined : response.data?.error || 'Unknown error',
    responseOk: response.data?.ok,
  };
}

// Test the /api/stats/public endpoint
async function testStatsPublic(id: number): Promise<RequestResult> {
  const response = await makeRequest(
    '/api/stats/public',
    'GET'
  );

  return {
    id,
    endpoint: '/api/stats/public',
    walletAddress: 'N/A',
    success: response.ok,
    statusCode: response.status,
    latencyMs: response.latencyMs,
    error: response.ok ? undefined : response.data?.error || 'Unknown error',
    responseOk: response.data?.ok,
  };
}

// Test the /api/telemetry/devnet-stats endpoint
async function testDevnetStats(id: number): Promise<RequestResult> {
  const response = await makeRequest(
    '/api/telemetry/devnet-stats',
    'GET'
  );

  return {
    id,
    endpoint: '/api/telemetry/devnet-stats',
    walletAddress: 'N/A',
    success: response.ok,
    statusCode: response.status,
    latencyMs: response.latencyMs,
    error: response.ok ? undefined : response.data?.error || 'Unknown error',
    responseOk: response.data?.ok,
  };
}

// Test the /api/health endpoint
async function testHealth(id: number): Promise<RequestResult> {
  const response = await makeRequest(
    '/api/health',
    'GET'
  );

  return {
    id,
    endpoint: '/api/health',
    walletAddress: 'N/A',
    success: response.ok,
    statusCode: response.status,
    latencyMs: response.latencyMs,
    error: response.ok ? undefined : response.data?.error || 'Unknown error',
    responseOk: response.data?.ok !== false,
  };
}

// Run a batch of requests concurrently
async function runBatch<T>(
  items: T[],
  concurrency: number,
  processor: (item: T, index: number) => Promise<RequestResult>
): Promise<RequestResult[]> {
  const results: RequestResult[] = [];

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((item, batchIndex) => processor(item, i + batchIndex))
    );
    results.push(...batchResults);

    // Small delay between batches to avoid overwhelming the server
    if (i + concurrency < items.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return results;
}

// Print summary statistics
function printSummary(results: RequestResult[]): void {
  console.log('\n' + '='.repeat(80));
  console.log('STRESS TEST SUMMARY');
  console.log('='.repeat(80));

  const totalRequests = results.length;
  const successfulRequests = results.filter(r => r.success).length;
  const failedRequests = totalRequests - successfulRequests;
  const successRate = ((successfulRequests / totalRequests) * 100).toFixed(1);

  const latencies = results.map(r => r.latencyMs);
  const avgLatency = (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(0);
  const minLatency = Math.min(...latencies);
  const maxLatency = Math.max(...latencies);
  const p50Latency = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.5)];
  const p95Latency = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)];

  console.log(`\nTotal Requests:      ${totalRequests}`);
  console.log(`Successful:          ${successfulRequests} (${successRate}%)`);
  console.log(`Failed:              ${failedRequests}`);

  console.log(`\nLatency Statistics:`);
  console.log(`  Average:           ${avgLatency}ms`);
  console.log(`  Min:               ${minLatency}ms`);
  console.log(`  Max:               ${maxLatency}ms`);
  console.log(`  P50:               ${p50Latency}ms`);
  console.log(`  P95:               ${p95Latency}ms`);

  // Breakdown by endpoint
  console.log('\nBy Endpoint:');
  const byEndpoint = new Map<string, RequestResult[]>();
  results.forEach(r => {
    const list = byEndpoint.get(r.endpoint) || [];
    list.push(r);
    byEndpoint.set(r.endpoint, list);
  });

  byEndpoint.forEach((endpointResults, endpoint) => {
    const total = endpointResults.length;
    const success = endpointResults.filter(r => r.success).length;
    const rate = ((success / total) * 100).toFixed(0);
    const avgMs = (endpointResults.reduce((a, r) => a + r.latencyMs, 0) / total).toFixed(0);
    console.log(`  ${endpoint}: ${success}/${total} (${rate}%) - avg ${avgMs}ms`);
  });

  // Breakdown by category (for chat intents)
  const chatResults = results.filter(r => r.category);
  if (chatResults.length > 0) {
    console.log('\nBy Intent Category:');
    const byCategory = new Map<string, RequestResult[]>();
    chatResults.forEach(r => {
      const list = byCategory.get(r.category!) || [];
      list.push(r);
      byCategory.set(r.category!, list);
    });

    byCategory.forEach((categoryResults, category) => {
      const total = categoryResults.length;
      const success = categoryResults.filter(r => r.success).length;
      const withExecReq = categoryResults.filter(r => r.hasExecutionRequest).length;
      const rate = ((success / total) * 100).toFixed(0);
      console.log(`  ${category}: ${success}/${total} (${rate}%) - ${withExecReq} with executionRequest`);
    });
  }

  // Show errors if any
  const errors = results.filter(r => !r.success);
  if (errors.length > 0) {
    console.log('\nErrors:');
    const errorCounts = new Map<string, number>();
    errors.forEach(r => {
      const key = `${r.endpoint}: ${r.error || 'Unknown'}`;
      errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
    });

    errorCounts.forEach((count, error) => {
      console.log(`  [${count}x] ${error}`);
    });
  }

  console.log('\n' + '='.repeat(80));
}

// Main execution
async function main(): Promise<void> {
  console.log('Blossom Stress Testing Script');
  console.log('='.repeat(80));
  console.log(`API Base URL:        ${API_BASE_URL}`);
  console.log(`Concurrency:         ${CONCURRENCY}`);
  console.log(`Total Requests:      ${TOTAL_REQUESTS}`);
  console.log(`Test Wallet:         ${TEST_WALLET || 'Random per request'}`);
  console.log('='.repeat(80));

  // Check if server is up
  console.log('\nChecking server health...');
  const healthResult = await testHealth(0);
  if (!healthResult.success) {
    console.error(`Server health check failed: ${healthResult.error}`);
    console.error('Make sure the backend is running: cd agent && npm run dev');
    process.exit(1);
  }
  console.log(`Server is healthy (responded in ${healthResult.latencyMs}ms)`);

  // Generate test tasks
  console.log('\nGenerating test tasks...');

  interface TestTask {
    type: 'chat' | 'preflight' | 'stats' | 'devnet-stats';
    prompt?: TestPrompt;
    walletAddress: string;
  }

  const tasks: TestTask[] = [];

  // Add chat intent tests (majority of requests)
  const chatRequestCount = Math.floor(TOTAL_REQUESTS * 0.7);
  for (let i = 0; i < chatRequestCount; i++) {
    const prompt = TEST_PROMPTS[i % TEST_PROMPTS.length];
    const walletAddress = TEST_WALLET || generateWalletAddress();
    tasks.push({ type: 'chat', prompt, walletAddress });
  }

  // Add preflight tests
  const preflightCount = Math.floor(TOTAL_REQUESTS * 0.1);
  for (let i = 0; i < preflightCount; i++) {
    const walletAddress = TEST_WALLET || generateWalletAddress();
    tasks.push({ type: 'preflight', walletAddress });
  }

  // Add stats endpoint tests
  const statsCount = Math.floor(TOTAL_REQUESTS * 0.1);
  for (let i = 0; i < statsCount; i++) {
    tasks.push({ type: 'stats', walletAddress: 'N/A' });
  }

  // Add devnet-stats endpoint tests
  const devnetStatsCount = TOTAL_REQUESTS - chatRequestCount - preflightCount - statsCount;
  for (let i = 0; i < devnetStatsCount; i++) {
    tasks.push({ type: 'devnet-stats', walletAddress: 'N/A' });
  }

  // Shuffle tasks for realistic load pattern
  for (let i = tasks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tasks[i], tasks[j]] = [tasks[j], tasks[i]];
  }

  console.log(`Generated ${tasks.length} test tasks`);
  console.log(`  - Chat intents: ${chatRequestCount}`);
  console.log(`  - Preflight: ${preflightCount}`);
  console.log(`  - Public stats: ${statsCount}`);
  console.log(`  - Devnet stats: ${devnetStatsCount}`);

  // Run tests
  console.log('\nRunning stress test...');
  const startTime = Date.now();

  const testResults = await runBatch(tasks, CONCURRENCY, async (task, index) => {
    switch (task.type) {
      case 'chat':
        return testChatIntent(index, task.prompt!, task.walletAddress);
      case 'preflight':
        return testPreflight(index, task.walletAddress);
      case 'stats':
        return testStatsPublic(index);
      case 'devnet-stats':
        return testDevnetStats(index);
      default:
        throw new Error(`Unknown task type: ${task.type}`);
    }
  });

  const totalTime = Date.now() - startTime;
  console.log(`\nCompleted ${testResults.length} requests in ${(totalTime / 1000).toFixed(1)}s`);
  console.log(`Throughput: ${(testResults.length / (totalTime / 1000)).toFixed(1)} req/s`);

  // Print summary
  printSummary(testResults);

  // Fetch final stats to show metrics were populated
  console.log('\nFetching final stats to verify metrics...');
  const finalStats = await makeRequest('/api/stats/public', 'GET');
  if (finalStats.ok && finalStats.data?.ok) {
    const data = finalStats.data.data;
    console.log('\nPublic Stats After Test:');
    console.log(`  Total Intents:          ${data.totalIntents || 0}`);
    console.log(`  Confirmed Intents:      ${data.confirmedIntents || 0}`);
    console.log(`  Total Executions:       ${data.totalExecutions || 0}`);
    console.log(`  Successful Executions:  ${data.successfulExecutions || 0}`);
    console.log(`  Success Rate:           ${data.successRate?.toFixed(1) || 0}%`);
    console.log(`  Unique Wallets:         ${data.uniqueWallets || 0}`);
    console.log(`  Total USD Routed:       $${(data.totalUsdRouted || 0).toLocaleString()}`);
  } else {
    console.log('Could not fetch final stats:', finalStats.data?.error || 'Unknown error');
  }

  const devnetStats = await makeRequest('/api/telemetry/devnet-stats', 'GET');
  if (devnetStats.ok && devnetStats.data?.ok) {
    const data = devnetStats.data.data;
    console.log('\nDevnet Traffic Stats After Test:');
    console.log(`  Requests (All Time):    ${data.traffic?.requestsAllTime || 0}`);
    console.log(`  Requests (24h):         ${data.traffic?.requestsLast24h || 0}`);
    console.log(`  Success Rate (24h):     ${data.traffic?.successRate24h?.toFixed(1) || 0}%`);
    console.log(`  Visitors (All Time):    ${data.traffic?.visitorsAllTime || 0}`);
    console.log(`  Visitors (24h):         ${data.traffic?.visitorsLast24h || 0}`);
  }

  // Exit with appropriate code
  const failureRate = testResults.filter(r => !r.success).length / testResults.length;
  if (failureRate > 0.1) {
    console.log('\nWARNING: High failure rate detected (>10%)');
    process.exit(1);
  }

  console.log('\nStress test completed successfully!');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
