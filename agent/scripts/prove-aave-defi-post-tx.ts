/**
 * Sprint 4: Aave DeFi Post-Tx Verifier
 * Verifies aToken balance after a successful Aave supply transaction
 */

const API_BASE = process.env.AGENT_API_BASE_URL || 'http://localhost:3001';
const TX_HASH = process.env.TX_HASH;
const TEST_USER_ADDRESS = process.env.TEST_USER_ADDRESS;

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

async function getTransactionReceipt(txHash: string): Promise<any> {
  const { ETH_TESTNET_RPC_URL } = await import('../src/config');
  if (!ETH_TESTNET_RPC_URL) {
    throw new Error('ETH_TESTNET_RPC_URL not configured');
  }

  const response = await fetch(ETH_TESTNET_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getTransactionReceipt',
      params: [txHash],
    }),
  });

  const result = await response.json();
  if (result.error) {
    throw new Error(result.error.message || 'RPC error');
  }
  return result.result;
}

async function main() {
  console.log('\n🔍 Sprint 4.5: Aave DeFi Post-Tx Verifier');
  console.log('============================================================');
  console.log(`API Base: ${API_BASE}`);
  console.log(`TX Hash: ${TX_HASH || 'NOT SET'}`);
  console.log(`Test User: ${TEST_USER_ADDRESS || 'NOT SET'}`);
  console.log('');

  // Check required env vars
  if (!TX_HASH || !TEST_USER_ADDRESS) {
    console.log('⏭️  SKIP: Required environment variables not set');
    console.log('   Required: TX_HASH, TEST_USER_ADDRESS');
    console.log('   Example: TX_HASH=0x... TEST_USER_ADDRESS=0x... npm run prove:aave-defi:post-tx');
    process.exit(0);
  }

  // Health check
  console.log('Checking backend health...');
  const healthy = await healthCheck();
  if (!healthy) {
    console.error('❌ Backend is not healthy. Please start the backend with: cd agent && npm run dev');
    process.exit(1);
  }
  console.log('✅ Backend is healthy\n');

  // POST-1: Fetch transaction receipt
  console.log('Testing POST-1: Transaction receipt is successful...');
  let receipt: any = null;
  let correlationId: string = '';
  try {
    receipt = await getTransactionReceipt(TX_HASH);
    
    if (!receipt) {
      assert(
        false,
        'POST-1',
        'Transaction receipt not found',
        { txHash: TX_HASH }
      );
    } else {
      const status = receipt.status === '0x1' ? 'success' : 'failed';
      assert(
        status === 'success',
        'POST-1',
        'Transaction receipt shows success',
        {
          txHash: TX_HASH,
          status,
          blockNumber: receipt.blockNumber,
        }
      );
    }
  } catch (error: any) {
    assert(false, 'POST-1', `Error: ${error.message}`, { txHash: TX_HASH });
  }

  // POST-2: Fetch Aave positions
  console.log('\nTesting POST-2: Aave positions show aToken balance > 0...');
  try {
    const positionsResponse = await fetch(`${API_BASE}/api/defi/aave/positions?userAddress=${TEST_USER_ADDRESS}`);
    const positionsData = await positionsResponse.json();

    if (positionsResponse.status !== 200 || positionsData._error) {
      assert(
        false,
        'POST-2',
        'Failed to fetch Aave positions',
        {
          status: positionsResponse.status,
          error: positionsData.error || positionsData.data,
          txHash: TX_HASH,
        }
      );
    } else {
      assert(
        Array.isArray(positionsData.positions),
        'POST-2',
        'Positions endpoint returns positions array',
        {
          positionCount: positionsData.positions?.length || 0,
          txHash: TX_HASH,
        }
      );

      // Check if user has any aToken balance > 0
      const hasBalance = positionsData.positions?.some((p: any) => 
        p.balance && BigInt(p.balance) > 0n
      );

      assert(
        hasBalance,
        'POST-2',
        'User has aToken balance > 0',
        {
          positions: positionsData.positions,
          txHash: TX_HASH,
        }
      );

      // Print balance details
      if (positionsData.positions && positionsData.positions.length > 0) {
        console.log('   Position details:');
        positionsData.positions.forEach((p: any) => {
          if (BigInt(p.balance || '0') > 0n) {
            console.log(`     ${p.asset}: ${p.balanceFormatted} (balance: ${p.balance})`);
          }
        });
      }
    }
  } catch (error: any) {
    assert(false, 'POST-2', `Error: ${error.message}`, { txHash: TX_HASH });
  }

  // Print summary
  console.log('\n============================================================');
  console.log('AAVE DEFI POST-TX VERIFIER REPORT');
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

  if (TX_HASH) {
    console.log(`\n📝 Transaction Hash: ${TX_HASH}`);
    console.log(`🔗 Explorer: https://sepolia.etherscan.io/tx/${TX_HASH}`);
  }
  if (correlationId) {
    console.log(`🔍 Correlation ID: ${correlationId}`);
  }

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
