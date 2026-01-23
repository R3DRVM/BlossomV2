/**
 * Sprint 4.7: Aave Adapter Deployment Proof
 * Verifies Aave adapter is deployed and allowlisted
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

async function getContractCode(address: string, rpcUrl: string): Promise<string | null> {
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getCode',
        params: [address, 'latest'],
      }),
    });

    const result = await response.json();
    return result.result || null;
  } catch (error: any) {
    return null;
  }
}

async function checkRouterAllowlist(routerAddress: string, adapterAddress: string, rpcUrl: string): Promise<boolean> {
  try {
    // ExecutionRouter.isAdapterAllowed(address) -> bool
    const abi = [
      {
        name: 'isAdapterAllowed',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'adapter', type: 'address' }],
        outputs: [{ name: '', type: 'bool' }],
      },
    ];

    const { createPublicClient, http } = await import('viem');
    const { sepolia } = await import('viem/chains');
    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http(rpcUrl),
    });

    const result = await publicClient.readContract({
      address: routerAddress as `0x${string}`,
      abi,
      functionName: 'isAdapterAllowed',
      args: [adapterAddress as `0x${string}`],
    });

    return result as boolean;
  } catch (error: any) {
    console.warn(`   Warning: Could not check router allowlist: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('\n🔍 Sprint 4.7: Aave Adapter Deployment Proof');
  console.log('============================================================');
  console.log(`API Base: ${API_BASE}`);
  console.log('============================================================\n');

  // Health check
  console.log('Checking backend health...');
  const healthy = await healthCheck();
  if (!healthy) {
    console.error('❌ Backend not available. Please start with: cd agent && npm run dev');
    process.exit(1);
  }
  console.log('✅ Backend is healthy\n');

  // ADAPTER-1: AAVE_ADAPTER_ADDRESS is configured
  console.log('Testing ADAPTER-1: AAVE_ADAPTER_ADDRESS is configured...');
  try {
    const { AAVE_ADAPTER_ADDRESS, EXECUTION_ROUTER_ADDRESS, ETH_TESTNET_RPC_URL } = await import('../src/config');
    
    assert(
      !!AAVE_ADAPTER_ADDRESS,
      'ADAPTER-1',
      'AAVE_ADAPTER_ADDRESS is configured',
      { hasAdapter: !!AAVE_ADAPTER_ADDRESS }
    );

    if (!AAVE_ADAPTER_ADDRESS) {
      console.error('   Action: Set AAVE_ADAPTER_ADDRESS in agent/.env.local');
      console.error('   Deploy adapter first: cd contracts && ./scripts/deploy-sepolia.sh');
      process.exit(1);
    }

    // ADAPTER-2: Contract code exists at address
    console.log('\nTesting ADAPTER-2: Contract code exists at address...');
    if (!ETH_TESTNET_RPC_URL) {
      assert(false, 'ADAPTER-2', 'ETH_TESTNET_RPC_URL not configured', {
        action: 'Set ETH_TESTNET_RPC_URL in agent/.env.local',
      });
      process.exit(1);
    }

    const code = await getContractCode(AAVE_ADAPTER_ADDRESS, ETH_TESTNET_RPC_URL);
    const hasCode = code && code !== '0x' && code.length > 2;

    assert(
      hasCode,
      'ADAPTER-2',
      'Contract code exists at AAVE_ADAPTER_ADDRESS',
      {
        address: AAVE_ADAPTER_ADDRESS,
        codeLength: code?.length || 0,
        hasCode,
      }
    );

    if (!hasCode) {
      console.error('   Action: Deploy adapter to Sepolia: cd contracts && ./scripts/deploy-sepolia.sh');
      console.error(`   Address ${AAVE_ADAPTER_ADDRESS} has no code`);
      process.exit(1);
    }

    // ADAPTER-3: Router allowlist includes adapter
    console.log('\nTesting ADAPTER-3: Router allowlist includes adapter...');
    if (!EXECUTION_ROUTER_ADDRESS) {
      assert(false, 'ADAPTER-3', 'EXECUTION_ROUTER_ADDRESS not configured', {
        action: 'Set EXECUTION_ROUTER_ADDRESS in agent/.env.local',
      });
      process.exit(1);
    }

    const isAllowed = await checkRouterAllowlist(EXECUTION_ROUTER_ADDRESS, AAVE_ADAPTER_ADDRESS, ETH_TESTNET_RPC_URL);

    assert(
      isAllowed,
      'ADAPTER-3',
      'ExecutionRouter allowlist includes AAVE_ADAPTER_ADDRESS',
      {
        routerAddress: EXECUTION_ROUTER_ADDRESS,
        adapterAddress: AAVE_ADAPTER_ADDRESS,
        isAllowed,
      }
    );

    if (!isAllowed) {
      console.error('   Action: Add adapter to router allowlist');
      console.error(`   Router: ${EXECUTION_ROUTER_ADDRESS}`);
      console.error(`   Adapter: ${AAVE_ADAPTER_ADDRESS}`);
      console.error('   Use: cast send <ROUTER> "setAdapterAllowed(address,bool)" <ADAPTER> true --rpc-url $SEPOLIA_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY');
      process.exit(1);
    }

    // ADAPTER-4: Preflight includes adapter in allowedAdapters
    console.log('\nTesting ADAPTER-4: Preflight includes adapter in allowedAdapters...');
    try {
      const preflight = await fetchJSON(`${API_BASE}/api/execute/preflight`);
      
      if (preflight._error) {
        assert(false, 'ADAPTER-4', 'Preflight endpoint failed', { status: preflight.status });
        process.exit(1);
      }

      const allowedAdapters = preflight.allowedAdapters || [];
      const adapterLower = AAVE_ADAPTER_ADDRESS.toLowerCase();
      const isInPreflight = allowedAdapters.some((a: string) => a.toLowerCase() === adapterLower);

      assert(
        isInPreflight,
        'ADAPTER-4',
        'Preflight allowedAdapters includes AAVE_ADAPTER_ADDRESS',
        {
          adapter: AAVE_ADAPTER_ADDRESS,
          allowedAdapters,
          isInPreflight,
        }
      );

      if (!isInPreflight) {
        console.error('   Action: Restart backend to pick up AAVE_ADAPTER_ADDRESS from .env.local');
        process.exit(1);
      }
    } catch (error: any) {
      assert(false, 'ADAPTER-4', `Error: ${error.message}`);
      process.exit(1);
    }

    // Summary
    console.log('\n============================================================');
    console.log('AAVE ADAPTER DEPLOYMENT PROOF REPORT');
    console.log('============================================================');
    console.log(`Total Tests: ${results.length}`);
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
      console.log('Aave adapter is deployed and allowlisted!');
      process.exit(0);
    } else {
      console.log('⚠️  SOME INVARIANTS FAILED');
      process.exit(1);
    }
  } catch (error: any) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
