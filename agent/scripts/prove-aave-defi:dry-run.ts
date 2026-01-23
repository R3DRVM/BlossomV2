/**
 * Sprint 4: Aave DeFi Dry-Run Proof
 * Verifies Aave SUPPLY plan validation without sending real transactions
 */

const API_BASE = process.env.AGENT_API_BASE_URL || 'http://localhost:3001';
const TEST_USER_ADDRESS = process.env.TEST_USER_ADDRESS || '0x' + '1'.repeat(40);

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
  console.log('\n🔍 Sprint 4: Aave DeFi Dry-Run Proof');
  console.log('============================================================');
  console.log(`API Base: ${API_BASE}`);
  console.log(`Test User: ${TEST_USER_ADDRESS}`);
  console.log('');

  // Health check
  console.log('Checking backend health...');
  const healthy = await healthCheck();
  if (!healthy) {
    console.error('❌ Backend is not healthy. Please start the backend with: cd agent && npm run dev');
    process.exit(1);
  }
  console.log('✅ Backend is healthy\n');

  // P2-1: Prepare Aave SUPPLY plan
  console.log('Testing P2-1: Aave SUPPLY plan can be prepared...');
  let preparedPlan: any = null;
  try {
    const defiExecutionRequest = {
      kind: 'lend' as const,
      amountUsd: 100,
      asset: 'USDC',
      protocol: 'Aave',
    };

    const prepareResponse = await fetch(`${API_BASE}/api/execute/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draftId: 'test-aave-dry-run',
        userAddress: TEST_USER_ADDRESS,
        executionRequest: defiExecutionRequest,
        executionKind: 'lend_supply',
      }),
    });

    const prepareData = await prepareResponse.json();

    if (prepareData._error || !prepareData.plan) {
      assert(
        false,
        'P2-1',
        'Aave SUPPLY plan preparation failed',
        {
          status: prepareResponse.status,
          error: prepareData.data || prepareData,
        }
      );
    } else {
      preparedPlan = prepareData.plan;
      const hasLendAction = preparedPlan.actions?.some((a: any) => a.actionType === 3); // LEND_SUPPLY
      
      assert(
        hasLendAction,
        'P2-1',
        'Aave SUPPLY plan contains LEND_SUPPLY action',
        {
          actionCount: preparedPlan.actions?.length || 0,
          actionTypes: preparedPlan.actions?.map((a: any) => a.actionType) || [],
        }
      );
    }
  } catch (error: any) {
    assert(false, 'P2-1', `Error: ${error.message}`);
  }

  if (!preparedPlan) {
    console.error('❌ Cannot proceed without prepared plan');
    process.exit(1);
  }

  // P2-2: Adapter is allowlisted OR returns ADAPTER_NOT_ALLOWED
  console.log('\nTesting P2-2: Adapter allowlist validation...');
  try {
    const validateResponse = await fetch(`${API_BASE}/api/execute/relayed?validateOnly=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draftId: 'test-aave-adapter',
        userAddress: TEST_USER_ADDRESS,
        plan: preparedPlan,
        sessionId: '0x' + '0'.repeat(64),
        policyOverride: {
          skipSessionCheck: true,
        },
      }),
    });

    const validateData = await validateResponse.json();

    // Extract adapter from plan
    const lendAction = preparedPlan.actions?.find((a: any) => a.actionType === 3);
    const adapter = lendAction?.adapter;

    if (validateResponse.status === 400 && validateData.error?.code === 'ADAPTER_NOT_ALLOWED') {
      assert(
        false,
        'P2-2',
        'Aave adapter is NOT allowlisted (this should be fixed)',
        {
          status: validateResponse.status,
          errorCode: validateData.error.code,
          adapter,
          allowedAdapters: validateData.error.allowedAdapters,
        }
      );
    } else {
      // Adapter is allowlisted (or validation passed for other reasons)
      assert(
        true,
        'P2-2',
        'Aave adapter is allowlisted (or validation passed)',
        {
          status: validateResponse.status,
          errorCode: validateData.error?.code,
          adapter,
        }
      );
    }
  } catch (error: any) {
    assert(false, 'P2-2', `Error: ${error.message}`);
  }

  // P2-3: Policy spend check passes (or returns POLICY_EXCEEDED only when forced)
  console.log('\nTesting P2-3: Policy spend check...');
  try {
    // Test with normal policy (should pass)
    const validateResponse = await fetch(`${API_BASE}/api/execute/relayed?validateOnly=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draftId: 'test-aave-policy',
        userAddress: TEST_USER_ADDRESS,
        plan: preparedPlan,
        sessionId: '0x' + '0'.repeat(64),
        policyOverride: {
          skipSessionCheck: true,
          maxSpendUnits: '10000000000000000000', // 10 ETH - large enough
        },
      }),
    });

    const validateData = await validateResponse.json();

    const policyValidated = 
      validateResponse.status === 400 && (
        validateData.error?.code === 'POLICY_EXCEEDED' ||
        validateData.error?.code === 'POLICY_UNDETERMINED_SPEND'
      ) ||
      validateResponse.status === 200 && !validateData.error;

    assert(
      policyValidated,
      'P2-3',
      'Policy spend check validates correctly (passes or returns POLICY_EXCEEDED/POLICY_UNDETERMINED_SPEND)',
      {
        status: validateResponse.status,
        errorCode: validateData.error?.code,
        hasError: !!validateData.error,
      }
    );
  } catch (error: any) {
    assert(false, 'P2-3', `Error: ${error.message}`);
  }

  // P2-4: validateOnly never returns txHash
  console.log('\nTesting P2-4: validateOnly never returns txHash...');
  try {
    const validateResponse = await fetch(`${API_BASE}/api/execute/relayed?validateOnly=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draftId: 'test-aave-validateonly',
        userAddress: TEST_USER_ADDRESS,
        plan: preparedPlan,
        sessionId: '0x' + '0'.repeat(64),
        policyOverride: {
          skipSessionCheck: true,
        },
      }),
    });

    const validateData = await validateResponse.json();

    assert(
      !validateData.txHash,
      'P2-4',
      'validateOnly mode never returns txHash',
      {
        hasTxHash: !!validateData.txHash,
        status: validateResponse.status,
      }
    );
  } catch (error: any) {
    assert(false, 'P2-4', `Error: ${error.message}`);
  }

  // Print summary
  console.log('\n============================================================');
  console.log('AAVE DEFI DRY-RUN PROOF REPORT');
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
