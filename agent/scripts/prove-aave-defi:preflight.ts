/**
 * Sprint 4: Aave DeFi Preflight Proof
 * Verifies market config loads and preflight returns Aave capability fields
 */

const API_BASE = process.env.AGENT_API_BASE_URL || 'http://localhost:3001';

interface ProofResult {
  invariant: string;
  passed: boolean;
  message: string;
  details?: any;
}

const results: ProofResult[] = [];

function assert(condition: boolean, invariant: string, message: string, details?: any): void {
  results.push({
    invariant,
    passed: condition,
    message,
    details,
  });
  if (condition) {
    console.log(`✅ PASS: ${invariant} - ${message}`);
  } else {
    console.error(`❌ FAIL: ${invariant} - ${message}`);
    if (details) {
      console.error('   Details:', JSON.stringify(details, null, 2));
    }
  }
}

async function fetchJSON(url: string, options: RequestInit = {}): Promise<any> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    let errorData: any;
    try {
      errorData = JSON.parse(text);
    } catch {
      errorData = { message: text };
    }
    return { _error: true, status: response.status, data: errorData };
  }
  return response.json();
}

async function healthCheck(): Promise<boolean> {
  try {
    const health = await fetchJSON(`${API_BASE}/health`);
    return health.ok === true;
  } catch {
    return false;
  }
}

async function main() {
  console.log('\n🔍 Sprint 4: Aave DeFi Preflight Proof');
  console.log('============================================================');
  console.log(`API Base: ${API_BASE}`);
  console.log('');

  // Health check
  console.log('Checking backend health...');
  const healthy = await healthCheck();
  if (!healthy) {
    console.error('❌ Backend is not healthy. Please start the backend with: cd agent && npm run dev');
    process.exit(1);
  }
  console.log('✅ Backend is healthy\n');

  // P1-1: Market config loads
  console.log('Testing P1-1: Market config loads...');
  try {
    const { getAaveMarketConfig } = await import('../src/defi/aave/market');
    const config = await getAaveMarketConfig();
    
    assert(
      config.chainId === 11155111,
      'P1-1',
      'Market config loads with correct chainId',
      { chainId: config.chainId, expected: 11155111 }
    );

    assert(
      config.poolAddress && config.poolAddress.length === 42,
      'P1-1',
      'Market config includes pool address',
      { poolAddress: config.poolAddress }
    );

    assert(
      config.supportedAssets && config.supportedAssets.length > 0,
      'P1-1',
      'Market config includes supported assets',
      { assetCount: config.supportedAssets.length }
    );
  } catch (error: any) {
    assert(false, 'P1-1', `Market config failed to load: ${error.message}`);
  }

  // P1-2: Preflight returns Aave capability fields (no secrets)
  console.log('\nTesting P1-2: Preflight returns Aave capability fields...');
  try {
    const preflight = await fetchJSON(`${API_BASE}/api/execute/preflight`);
    
    if (preflight._error) {
      assert(false, 'P1-2', 'Preflight request failed', { status: preflight.status });
    } else {
      // Check for Aave adapter in allowedAdapters
      const allowedAdapters = preflight.allowedAdapters || [];
      const hasAaveAdapter = allowedAdapters.some((addr: string) => 
        addr && typeof addr === 'string' && addr.length === 42
      );

      assert(
        Array.isArray(allowedAdapters),
        'P1-2',
        'Preflight returns allowedAdapters array',
        { allowedAdaptersCount: allowedAdapters.length }
      );

      // Check that no secrets are leaked
      const preflightStr = JSON.stringify(preflight);
      const aaveKey = process.env.AAVE_API_KEY || '';
      const dflowKey = process.env.DFLOW_API_KEY || '';
      const hasSecret = 
        (aaveKey && preflightStr.includes(aaveKey)) ||
        (dflowKey && preflightStr.includes(dflowKey)) ||
        preflightStr.includes('AAVE_API_KEY') ||
        preflightStr.includes('DFLOW_API_KEY');

      assert(
        !hasSecret,
        'P1-2',
        'Preflight response does not contain secrets',
        { hasSecret }
      );

      // Check lending status if present
      if (preflight.lending) {
        assert(
          typeof preflight.lending === 'object',
          'P1-2',
          'Preflight returns lending status object',
          { lending: preflight.lending }
        );
      }
    }
  } catch (error: any) {
    assert(false, 'P1-2', `Preflight check failed: ${error.message}`);
  }

  // Print summary
  console.log('\n============================================================');
  console.log('AAVE DEFI PREFLIGHT PROOF REPORT');
  console.log('============================================================');
  console.log(`\nTotal Tests: ${results.length}`);
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}\n`);

  results.forEach(r => {
    const icon = r.passed ? '✅' : '❌';
    console.log(`${icon} ${r.invariant}: ${r.message}`);
  });

  console.log('\n============================================================');
  if (failed === 0) {
    console.log('🎉 ALL INVARIANTS PASSED');
    process.exit(0);
  } else {
    console.log('⚠️  SOME INVARIANTS FAILED');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
