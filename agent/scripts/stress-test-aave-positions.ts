/**
 * Sprint 4.5: Aave Positions Read Stress Test
 * Stress tests the /api/defi/aave/positions endpoint under high concurrency
 */

const API_BASE = process.env.AGENT_API_BASE_URL || 'http://localhost:3001';
const TEST_USER_ADDRESS = process.env.TEST_USER_ADDRESS;

interface StressTestResult {
  totalRequests: number;
  successCount: number;
  failureCount: number;
  http200Count: number;
  http500Count: number;
  otherErrorCount: number;
  latencyStats: {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  };
  schemaValidCount: number;
  schemaInvalidCount: number;
  errors: Array<{ requestId: number; error: string; status?: number }>;
}

async function fetchJSON(url: string, options: RequestInit = {}): Promise<any> {
  const startTime = Date.now();
  try {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(30000), // 30s timeout
    });
    const latency = Date.now() - startTime;
    
    if (!response.ok) {
      const text = await response.text();
      let errorData: any;
      try {
        errorData = JSON.parse(text);
      } catch {
        errorData = { message: text };
      }
      return { 
        _error: true, 
        status: response.status, 
        data: errorData,
        latency,
      };
    }
    const json = await response.json();
    return { ...json, _latency: latency };
  } catch (error: any) {
    return { 
      _error: true, 
      error: error.message,
      latency: Date.now() - startTime,
    };
  }
}

async function healthCheck(): Promise<boolean> {
  try {
    const health = await fetchJSON(`${API_BASE}/health`);
    return health.ok === true;
  } catch {
    return false;
  }
}

function validatePositionsSchema(data: any): boolean {
  // Must have: ok, chainId, userAddress, positions (array)
  if (typeof data.ok !== 'boolean') return false;
  if (typeof data.chainId !== 'number') return false;
  if (typeof data.userAddress !== 'string') return false;
  if (!Array.isArray(data.positions)) return false;
  return true;
}

async function testAavePositions(concurrency: number, userAddress: string): Promise<StressTestResult> {
  const results: Array<{ 
    success: boolean; 
    httpStatus?: number; 
    latency?: number; 
    schemaValid?: boolean;
    error?: string;
  }> = [];
  const latencies: number[] = [];
  const errors: Array<{ requestId: number; error: string; status?: number }> = [];

  console.log(`  Firing ${concurrency} concurrent requests to /api/defi/aave/positions...`);

  const promises = Array.from({ length: concurrency }, async (_, i) => {
    try {
      const response = await fetchJSON(`${API_BASE}/api/defi/aave/positions?userAddress=${userAddress}`);
      const latency = response._latency || 0;

      if (response._error) {
        const status = response.status || 0;
        errors.push({ 
          requestId: i, 
          error: response.error || response.data?.error || 'Unknown error',
          status,
        });
        return { 
          success: false, 
          httpStatus: status,
          latency,
          error: response.error || 'Unknown error',
        };
      }

      const schemaValid = validatePositionsSchema(response);
      latencies.push(latency);

      return {
        success: true,
        httpStatus: 200,
        latency,
        schemaValid,
      };
    } catch (error: any) {
      errors.push({ 
        requestId: i, 
        error: error.message || 'Unknown error',
      });
      return {
        success: false,
        error: error.message,
      };
    }
  });

  const responses = await Promise.all(promises);
  results.push(...responses);

  // Calculate stats
  const successCount = results.filter(r => r.success && r.httpStatus === 200).length;
  const failureCount = results.filter(r => !r.success || r.httpStatus !== 200).length;
  const http200Count = results.filter(r => r.httpStatus === 200).length;
  const http500Count = results.filter(r => r.httpStatus === 500).length;
  const otherErrorCount = results.filter(r => r.httpStatus && r.httpStatus !== 200 && r.httpStatus !== 500).length;
  const schemaValidCount = results.filter(r => r.schemaValid === true).length;
  const schemaInvalidCount = results.filter(r => r.schemaValid === false).length;

  latencies.sort((a, b) => a - b);
  const latencyStats = {
    min: latencies[0] || 0,
    max: latencies[latencies.length - 1] || 0,
    avg: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
    p50: latencies[Math.floor(latencies.length * 0.5)] || 0,
    p95: latencies[Math.floor(latencies.length * 0.95)] || 0,
    p99: latencies[Math.floor(latencies.length * 0.99)] || 0,
  };

  return {
    totalRequests: concurrency,
    successCount,
    failureCount,
    http200Count,
    http500Count,
    otherErrorCount,
    latencyStats,
    schemaValidCount,
    schemaInvalidCount,
    errors: errors.slice(0, 10), // First 10 errors
  };
}

function printResult(result: StressTestResult): void {
  console.log('\nAave Positions Read Results:');
  console.log(`  Total Requests: ${result.totalRequests}`);
  console.log(`  ✅ Success: ${result.successCount}`);
  console.log(`  ❌ Failure: ${result.failureCount}`);
  console.log(`  📊 HTTP 200: ${result.http200Count}/${result.totalRequests} (${((result.http200Count / result.totalRequests) * 100).toFixed(1)}%)`);
  console.log(`  ⚠️  HTTP 500: ${result.http500Count}`);
  console.log(`  ⚠️  Other Errors: ${result.otherErrorCount}`);
  console.log(`  📋 Schema Valid: ${result.schemaValidCount}/${result.totalRequests} (${((result.schemaValidCount / result.totalRequests) * 100).toFixed(1)}%)`);
  console.log(`  ⚠️  Schema Invalid: ${result.schemaInvalidCount}`);
  console.log(`  ⏱️  Latency Stats (ms):`);
  console.log(`     Min: ${result.latencyStats.min}`);
  console.log(`     Max: ${result.latencyStats.max}`);
  console.log(`     Avg: ${result.latencyStats.avg.toFixed(1)}`);
  console.log(`     P50: ${result.latencyStats.p50}`);
  console.log(`     P95: ${result.latencyStats.p95}`);
  console.log(`     P99: ${result.latencyStats.p99}`);

  if (result.errors.length > 0) {
    console.log(`  ⚠️  Sample Errors (first ${result.errors.length}):`);
    result.errors.forEach(err => {
      console.log(`     Request ${err.requestId}: ${err.error}${err.status ? ` (HTTP ${err.status})` : ''}`);
    });
  }
}

async function main() {
  const concurrency = parseInt(process.env.STRESS_CONCURRENCY || '100', 10);

  console.log('🚀 Sprint 4.5: Aave Positions Read Stress Test');
  console.log('============================================================');
  console.log(`API Base: ${API_BASE}`);
  console.log(`Concurrency: ${concurrency} requests`);
  console.log(`Test User: ${TEST_USER_ADDRESS || 'NOT SET'}`);
  console.log('============================================================');

  // Check required env
  if (!TEST_USER_ADDRESS) {
    console.log('\n⏭️  SKIP: TEST_USER_ADDRESS not set');
    console.log('   Required: TEST_USER_ADDRESS');
    console.log('   Example: TEST_USER_ADDRESS=0x... npm run stress:aave-positions');
    process.exit(0);
  }

  // Health check
  console.log('\nChecking backend health...');
  const healthy = await healthCheck();
  if (!healthy) {
    console.error('❌ Backend not available. Please start with: cd agent && npm run dev');
    process.exit(1);
  }
  console.log('✅ Backend is healthy\n');

  // Run stress test
  console.log('============================================================');
  console.log('Testing Aave Positions Read Endpoint');
  console.log('============================================================\n');

  const result = await testAavePositions(concurrency, TEST_USER_ADDRESS);
  printResult(result);

  // Assertions
  console.log('\n============================================================');
  console.log('STRESS TEST ASSERTIONS');
  console.log('============================================================');

  const successRate = (result.successCount / result.totalRequests) * 100;
  const http200Rate = (result.http200Count / result.totalRequests) * 100;
  const schemaValidRate = (result.schemaValidCount / result.totalRequests) * 100;

  let allPassed = true;

  // Assertion 1: >= 99% success rate
  if (successRate >= 99) {
    console.log(`✅ Success Rate: ${successRate.toFixed(2)}% >= 99%`);
  } else {
    console.error(`❌ Success Rate: ${successRate.toFixed(2)}% < 99%`);
    allPassed = false;
  }

  // Assertion 2: >= 99% HTTP 200
  if (http200Rate >= 99) {
    console.log(`✅ HTTP 200 Rate: ${http200Rate.toFixed(2)}% >= 99%`);
  } else {
    console.error(`❌ HTTP 200 Rate: ${http200Rate.toFixed(2)}% < 99%`);
    allPassed = false;
  }

  // Assertion 3: No HTTP 500s
  if (result.http500Count === 0) {
    console.log(`✅ HTTP 500 Count: ${result.http500Count} (no 500s)`);
  } else {
    console.error(`❌ HTTP 500 Count: ${result.http500Count} (should be 0)`);
    allPassed = false;
  }

  // Assertion 4: Schema consistency
  if (schemaValidRate >= 99) {
    console.log(`✅ Schema Valid Rate: ${schemaValidRate.toFixed(2)}% >= 99%`);
  } else {
    console.error(`❌ Schema Valid Rate: ${schemaValidRate.toFixed(2)}% < 99%`);
    allPassed = false;
  }

  // Assertion 5: Latency >= 0
  if (result.latencyStats.min >= 0) {
    console.log(`✅ Latency Min: ${result.latencyStats.min}ms >= 0`);
  } else {
    console.error(`❌ Latency Min: ${result.latencyStats.min}ms < 0`);
    allPassed = false;
  }

  console.log('\n============================================================');
  if (allPassed) {
    console.log('🎉 ALL STRESS TEST ASSERTIONS PASSED');
    process.exit(0);
  } else {
    console.log('⚠️  SOME STRESS TEST ASSERTIONS FAILED');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
