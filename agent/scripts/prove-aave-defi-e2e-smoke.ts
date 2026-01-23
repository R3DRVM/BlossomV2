/**
 * Sprint 4: Aave DeFi E2E Smoke Test (REAL TX)
 * Submits a small Aave supply through /api/execute/relayed and proves aToken delta
 */

const API_BASE = process.env.AGENT_API_BASE_URL || 'http://localhost:3001';
const TEST_USER_ADDRESS = process.env.TEST_USER_ADDRESS;
const TEST_TOKEN = process.env.TEST_TOKEN; // REDACTED|WETH
const TEST_AMOUNT_UNITS = process.env.TEST_AMOUNT_UNITS; // e.g. "1000000" for 1 REDACTED (6 decimals)
const TEST_SESSION_ID = process.env.TEST_SESSION_ID; // Optional
const TEST_SESSION_OWNER = process.env.TEST_SESSION_OWNER; // Optional

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

async function waitForReceipt(txHash: string, maxWaitMs: number = 60000): Promise<any> {
  const startTime = Date.now();
  const pollInterval = 2000; // 2 seconds

  while (Date.now() - startTime < maxWaitMs) {
    try {
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
      if (result.result) {
        return result.result;
      }
    } catch (error) {
      // Continue polling
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error('Receipt timeout');
}

async function main() {
  console.log('\n🔍 Sprint 4.6: Aave DeFi E2E Smoke Test (REAL TX)');
  console.log('============================================================');
  console.log(`API Base: ${API_BASE}`);
  console.log(`Test User: ${TEST_USER_ADDRESS || 'NOT SET'}`);
  console.log(`Test Token: ${TEST_TOKEN || 'NOT SET'}`);
  console.log(`Test Amount: ${TEST_AMOUNT_UNITS || 'NOT SET'}`);
  console.log('');

  // Check required env vars - FAIL if missing (no SKIP)
  if (!TEST_USER_ADDRESS || !TEST_TOKEN || !TEST_AMOUNT_UNITS) {
    console.error('❌ FAIL: Required environment variables not set');
    console.error('   Missing:');
    if (!TEST_USER_ADDRESS) console.error('     - TEST_USER_ADDRESS');
    if (!TEST_TOKEN) console.error('     - TEST_TOKEN (REDACTED or WETH)');
    if (!TEST_AMOUNT_UNITS) console.error('     - TEST_AMOUNT_UNITS (base units, e.g. "1000000" for 1 REDACTED)');
    console.error('   Optional: TEST_SESSION_ID, TEST_SESSION_OWNER');
    console.error('   Example: TEST_USER_ADDRESS=0x... TEST_TOKEN=REDACTED TEST_AMOUNT_UNITS=1000000 npm run prove:aave-defi:e2e-smoke');
    process.exit(1);
  }

  // Health check
  console.log('Checking backend health...');
  const healthy = await healthCheck();
  if (!healthy) {
    console.error('❌ Backend is not healthy. Please start the backend with: cd agent && npm run dev');
    process.exit(1);
  }
  console.log('✅ Backend is healthy\n');

  // E2E-1: Preflight checks
  console.log('Testing E2E-1: Preflight checks...');
  try {
    const preflight = await fetchJSON(`${API_BASE}/api/execute/preflight`);
    
    if (preflight._error) {
      assert(false, 'E2E-1', 'Preflight request failed', { status: preflight.status });
    } else {
      // Check lending execution mode
      const lendingMode = preflight.lending?.mode || preflight.lending?.executionMode || 'demo';
      assert(
        lendingMode === 'real',
        'E2E-1a',
        'Lending execution mode is real',
        { mode: lendingMode, expected: 'real' }
      );

      // Check AAVE_ADAPTER_ADDRESS exists
      const allowedAdapters = preflight.allowedAdapters || [];
      const { AAVE_ADAPTER_ADDRESS, AAVE_SEPOLIA_POOL_ADDRESS, EXECUTION_ROUTER_ADDRESS } = await import('../src/config');
      
      // Print addresses for debugging
      console.log(`   ExecutionRouter: ${EXECUTION_ROUTER_ADDRESS || 'NOT SET'}`);
      console.log(`   Aave Pool: ${AAVE_SEPOLIA_POOL_ADDRESS || 'NOT SET'}`);
      console.log(`   Aave Adapter: ${AAVE_ADAPTER_ADDRESS || 'NOT SET'}`);
      
      assert(
        !!AAVE_ADAPTER_ADDRESS,
        'E2E-1b',
        'AAVE_ADAPTER_ADDRESS is configured',
        { hasAdapter: !!AAVE_ADAPTER_ADDRESS }
      );

      // Check adapter in allowedAdapters
      const adapterLower = AAVE_ADAPTER_ADDRESS?.toLowerCase();
      const isAllowed = adapterLower && allowedAdapters.some((a: string) => a.toLowerCase() === adapterLower);
      
      assert(
        isAllowed,
        'E2E-1c',
        'Aave adapter is in allowedAdapters',
        {
          adapter: AAVE_ADAPTER_ADDRESS,
          allowedAdapters,
          isAllowed,
        }
      );
    }
  } catch (error: any) {
    assert(false, 'E2E-1', `Error: ${error.message}`);
  }

  // E2E-2: Session checks and sessionId resolution
  console.log('\nTesting E2E-2: Session checks and sessionId resolution...');
  let activeSessionId: string | null = null;
  try {
    // If TEST_SESSION_ID is provided, use it directly and verify via /api/session/status
    if (TEST_SESSION_ID) {
      console.log(`   Using TEST_SESSION_ID from environment: ${TEST_SESSION_ID.slice(0, 10)}...`);

      // Verify session is active via POST /api/session/status
      const sessionStatus = await fetchJSON(`${API_BASE}/api/session/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: TEST_USER_ADDRESS,
          sessionId: TEST_SESSION_ID,
        }),
      });

      if (sessionStatus._error) {
        console.error('❌ FAIL: Session status check failed');
        console.error(`   Status: ${sessionStatus.status}`);
        console.error(`   Error: ${JSON.stringify(sessionStatus.data)}`);
        process.exit(1);
      }

      const isActive = sessionStatus.status === 'active' || sessionStatus.session?.status === 'active';
      if (!isActive) {
        console.error('❌ FAIL: Session is not active');
        console.error(`   Status: ${sessionStatus.status || sessionStatus.session?.status || 'unknown'}`);
        console.error('   Action: Create session via UI or programmatically');
        process.exit(1);
      }

      activeSessionId = TEST_SESSION_ID;
      console.log(`   ✅ Session verified active via /api/session/status`);
    } else {
      // Fallback: try debug endpoint
      const sessionAuth = await fetchJSON(`${API_BASE}/api/debug/session-authority?address=${TEST_USER_ADDRESS}`);

      if (sessionAuth._error) {
        console.error('❌ FAIL: Session authority check failed');
        console.error(`   Status: ${sessionAuth.status}`);
        console.error(`   Error: ${JSON.stringify(sessionAuth.data)}`);
        console.error('   Action: Check backend is running and session endpoint is accessible');
        process.exit(1);
      }

      const sessionStatus = sessionAuth.sessionStatus;
      const isActive = sessionStatus?.status === 'active';

      if (!isActive) {
        console.error('❌ FAIL: Session is not active');
        console.error(`   Status: ${sessionStatus?.status || 'unknown'}`);
        console.error('   Action: Open UI -> enable one-click -> confirm session creation once');
        console.error('   Or set TEST_SESSION_ID=<sessionId> in environment');
        process.exit(1);
      }

      // Get sessionId from response (top-level or from sessionStatus)
      activeSessionId = sessionAuth.sessionId || sessionStatus?.sessionId || null;

      // Fallback: try to get from recentAttempts
      if (!activeSessionId && sessionAuth.recentAttempts && sessionAuth.recentAttempts.length > 0) {
        activeSessionId = sessionAuth.recentAttempts[0].sessionId || null;
      }

      if (!activeSessionId) {
        console.error('❌ FAIL: Cannot resolve active sessionId');
        console.error('   Session is active but sessionId not found in response');
        console.error('   Response keys:', Object.keys(sessionAuth));
        console.error('   Action: Ensure session was created via UI or set TEST_SESSION_ID env var');
        process.exit(1);
      }
    }

    console.log(`   ✅ Active session ID resolved: ${activeSessionId}`);

    assert(
      true,
      'E2E-2',
      'Session is active and sessionId resolved',
      {
        sessionId: activeSessionId,
      }
    );
  } catch (error: any) {
    console.error('❌ FAIL: Session check error');
    console.error(`   Error: ${error.message}`);
    console.error('   Action: Check backend is running and session endpoint is accessible');
    process.exit(1);
  }

  // E2E-3: Balance/allowance checks
  console.log('\nTesting E2E-3: Balance/allowance checks...');
  try {
    const { ETH_TESTNET_RPC_URL, EXECUTION_ROUTER_ADDRESS, AAVE_REDACTED_ADDRESS, AAVE_WETH_ADDRESS } = await import('../src/config');
    const { erc20_balanceOf, erc20_allowance } = await import('../src/executors/erc20Rpc');

    if (!ETH_TESTNET_RPC_URL || !EXECUTION_ROUTER_ADDRESS) {
      assert(false, 'E2E-3', 'ETH_TESTNET_RPC_URL and EXECUTION_ROUTER_ADDRESS must be configured');
    } else {
      // Determine token address (use Aave-specific tokens for Aave supply operations)
      let tokenAddress: string;
      let decimals: number;
      if (TEST_TOKEN === 'REDACTED') {
        tokenAddress = AAVE_REDACTED_ADDRESS!;
        decimals = 6;
      } else if (TEST_TOKEN === 'WETH') {
        tokenAddress = AAVE_WETH_ADDRESS!;
        decimals = 18;
      } else {
        assert(false, 'E2E-3', `Unsupported TEST_TOKEN: ${TEST_TOKEN} (must be REDACTED or WETH)`);
        return;
      }

      // Print addresses for debugging
      console.log(`   Token address: ${tokenAddress}`);
      console.log(`   User address: ${TEST_USER_ADDRESS}`);
      console.log(`   ExecutionRouter: ${EXECUTION_ROUTER_ADDRESS}`);

      const amount = BigInt(TEST_AMOUNT_UNITS);
      const balance = await erc20_balanceOf(tokenAddress, TEST_USER_ADDRESS);
      const allowance = await erc20_allowance(tokenAddress, TEST_USER_ADDRESS, EXECUTION_ROUTER_ADDRESS);

      if (balance < amount) {
        const delta = amount - balance;
        const decimals = TEST_TOKEN === 'REDACTED' ? 6 : 18;
        const deltaFormatted = (Number(delta) / Math.pow(10, decimals)).toFixed(decimals);
        const balanceFormatted = (Number(balance) / Math.pow(10, decimals)).toFixed(decimals);
        const amountFormatted = (Number(amount) / Math.pow(10, decimals)).toFixed(decimals);
        console.error('❌ FAIL: Insufficient token balance');
        console.error(`   Required: ${amount.toString()} (${amountFormatted} ${TEST_TOKEN})`);
        console.error(`   Current: ${balance.toString()} (${balanceFormatted} ${TEST_TOKEN})`);
        console.error(`   Missing: ${delta.toString()} (${deltaFormatted} ${TEST_TOKEN})`);
        console.error(`   Token address: ${tokenAddress}`);
        console.error(`   Action: Fund ${TEST_USER_ADDRESS} with ${deltaFormatted} ${TEST_TOKEN} on Sepolia`);
        console.error(`   See RUNBOOK_REAL_DEFI_SEPOLIA.md Phase 4, Step 4.1`);
        process.exit(1);
      }

      assert(
        true,
        'E2E-3',
        'User has sufficient token balance',
        {
          balance: balance.toString(),
          required: amount.toString(),
          token: TEST_TOKEN,
        }
      );

      if (allowance < amount) {
        const delta = amount - allowance;
        const decimals = TEST_TOKEN === 'REDACTED' ? 6 : 18;
        const deltaFormatted = (Number(delta) / Math.pow(10, decimals)).toFixed(decimals);
        const allowanceFormatted = (Number(allowance) / Math.pow(10, decimals)).toFixed(decimals);
        const amountFormatted = (Number(amount) / Math.pow(10, decimals)).toFixed(decimals);
        console.error('❌ FAIL: Insufficient token allowance');
        console.error(`   Required: ${amount.toString()} (${amountFormatted} ${TEST_TOKEN})`);
        console.error(`   Current: ${allowance.toString()} (${allowanceFormatted} ${TEST_TOKEN})`);
        console.error(`   Missing: ${delta.toString()} (${deltaFormatted} ${TEST_TOKEN})`);
        console.error(`   Token address: ${tokenAddress}`);
        console.error(`   Spender (ExecutionRouter): ${EXECUTION_ROUTER_ADDRESS}`);
        console.error(`   Action: Approve ${EXECUTION_ROUTER_ADDRESS} to spend ${deltaFormatted} ${TEST_TOKEN}`);
        console.error(`   Method: Call approve(${EXECUTION_ROUTER_ADDRESS}, ${amount.toString()}) on token ${tokenAddress}`);
        console.error(`   See RUNBOOK_REAL_DEFI_SEPOLIA.md Phase 4, Step 4.2`);
        process.exit(1);
      }

      assert(
        true,
        'E2E-3',
        'User has sufficient allowance',
        {
          allowance: allowance.toString(),
          required: amount.toString(),
          token: TEST_TOKEN,
        }
      );
    }
  } catch (error: any) {
    assert(false, 'E2E-3', `Error: ${error.message}`);
  }

  // E2E-4: Get initial aToken balance
  console.log('\nTesting E2E-4: Get initial aToken balance...');
  let initialBalance = 0n;
  try {
    const positionsBefore = await fetchJSON(`${API_BASE}/api/defi/aave/positions?userAddress=${TEST_USER_ADDRESS}`);
    
    if (!positionsBefore._error && Array.isArray(positionsBefore.positions)) {
      const position = positionsBefore.positions.find((p: any) => p.asset === TEST_TOKEN);
      if (position) {
        initialBalance = BigInt(position.balance || '0');
      }
    }
    console.log(`   Initial aToken balance: ${initialBalance.toString()}`);
  } catch (error: any) {
    console.warn(`   Could not fetch initial balance: ${error.message}`);
  }

  // E2E-5: Prepare execution plan
  console.log('\nTesting E2E-5: Prepare execution plan...');
  let preparedPlan: any = null;
  let correlationId: string = '';
  try {
    // Calculate amount in human units (e.g., "1" for 1 REDACTED)
    const decimals = TEST_TOKEN === 'REDACTED' ? 6 : 18;
    const amountHuman = (parseFloat(TEST_AMOUNT_UNITS) / Math.pow(10, decimals)).toString();

    const defiExecutionRequest = {
      kind: 'lend' as const,
      amount: amountHuman, // Human-readable amount (e.g., "1" for 1 REDACTED)
      amountUsd: parseFloat(TEST_AMOUNT_UNITS) / (TEST_TOKEN === 'REDACTED' ? 1e6 : 1e18),
      asset: TEST_TOKEN,
      protocol: 'Aave',
    };

    const prepareResponse = await fetch(`${API_BASE}/api/execute/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draftId: `test-aave-e2e-${Date.now()}`,
        userAddress: TEST_USER_ADDRESS,
        executionRequest: defiExecutionRequest,
        executionKind: 'lend_supply',
        authMode: 'session', // Required for session-based execution (wraps action data with maxSpendUnits)
      }),
    });

    const prepareData = await prepareResponse.json();
    correlationId = prepareData.correlationId || 'unknown';

    if (prepareData._error || !prepareData.plan) {
      assert(
        false,
        'E2E-5',
        'Execution plan preparation failed',
        {
          status: prepareResponse.status,
          error: prepareData.data || prepareData,
          correlationId,
        }
      );
    } else {
      preparedPlan = prepareData.plan;
      // Debug: log prepared plan structure
      console.log(`   Prepared plan:`, JSON.stringify({
        user: preparedPlan.user,
        nonce: preparedPlan.nonce,
        deadline: preparedPlan.deadline,
        actionCount: preparedPlan.actions?.length,
      }, null, 2));
      assert(
        true,
        'E2E-5',
        'Execution plan prepared successfully',
        {
          actionCount: preparedPlan.actions?.length || 0,
          correlationId,
        }
      );
    }
  } catch (error: any) {
    assert(false, 'E2E-5', `Error: ${error.message}`, { correlationId });
  }

  if (!preparedPlan) {
    console.error('❌ Cannot proceed without prepared plan');
    process.exit(1);
  }

  // E2E-6: Execute via relayed endpoint
  console.log('\nTesting E2E-6: Execute via relayed endpoint...');
  let txHash: string | undefined;
  try {
    const sessionIdToUse = activeSessionId || TEST_SESSION_ID;
    if (!sessionIdToUse) {
      console.error('❌ FAIL: No sessionId available for execution');
      console.error('   This should not happen if E2E-2 passed');
      process.exit(1);
    }

    // Debug: log what we're sending
    const requestBody = {
      draftId: `test-aave-e2e-exec-${Date.now()}`,
      userAddress: TEST_USER_ADDRESS,
      plan: preparedPlan,
      sessionId: sessionIdToUse,
    };
    console.log('   Request body plan:', JSON.stringify({
      user: requestBody.plan?.user,
      nonce: requestBody.plan?.nonce,
      deadline: requestBody.plan?.deadline,
      actionCount: requestBody.plan?.actions?.length,
      sessionId: requestBody.sessionId?.slice(0, 10) + '...',
    }));

    const executeResponse = await fetch(`${API_BASE}/api/execute/relayed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    const executeData = await executeResponse.json();

    if (executeResponse.status !== 200 || executeData._error) {
      assert(
        false,
        'E2E-6',
        'Relayed execution failed',
        {
          status: executeResponse.status,
          error: executeData.error || executeData.data,
          correlationId,
        }
      );
    } else {
      txHash = executeData.txHash;
      assert(
        !!txHash,
        'E2E-6',
        'Transaction hash returned',
        {
          txHash,
          correlationId,
        }
      );
    }
  } catch (error: any) {
    assert(false, 'E2E-6', `Error: ${error.message}`, { correlationId });
  }

  if (!txHash) {
    console.error('❌ Cannot proceed without txHash');
    process.exit(1);
  }

  // E2E-7: Wait for receipt
  console.log('\nTesting E2E-7: Wait for transaction receipt...');
  try {
    console.log(`   Waiting for receipt: ${txHash}`);
    console.log(`   Explorer: https://sepolia.etherscan.io/tx/${txHash}`);
    const receipt = await waitForReceipt(txHash, 120000); // 2 minute timeout
    const status = receipt.status === '0x1' ? 'success' : 'failed';
    
    assert(
      status === 'success',
      'E2E-7',
      'Transaction receipt confirmed with status=1',
      {
        txHash,
        status,
        receiptStatus: receipt.status,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
        correlationId,
        }
      );
  } catch (error: any) {
    assert(false, 'E2E-7', `Error: ${error.message}`, { txHash, correlationId });
  }

  // E2E-8: Verify aToken balance increased and positions schema
  console.log('\nTesting E2E-8: Verify aToken balance increased and positions schema...');
  try {
    // Wait for indexing (up to 30 seconds with retries)
    let positionsAfter: any = null;
    let retries = 6;
    while (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      positionsAfter = await fetchJSON(`${API_BASE}/api/defi/aave/positions?userAddress=${TEST_USER_ADDRESS}`);
      
      if (!positionsAfter._error && Array.isArray(positionsAfter.positions)) {
        const position = positionsAfter.positions.find((p: any) => p.asset === TEST_TOKEN);
        if (position && BigInt(position.balance || '0') > initialBalance) {
          break; // Found increase
        }
      }
      retries--;
      if (retries > 0) {
        console.log(`   Waiting for indexing... (${retries} retries left)`);
      }
    }
    
    if (positionsAfter._error) {
      assert(
        false,
        'E2E-8a',
        'Positions endpoint failed',
        {
          status: positionsAfter.status,
          error: positionsAfter.data,
          correlationId,
        }
      );
    } else {
      // Verify response schema
      const hasPositions = Array.isArray(positionsAfter.positions);
      const hasOk = positionsAfter.ok === true || positionsAfter.ok === undefined;
      const hasUserAddress = positionsAfter.userAddress === TEST_USER_ADDRESS || positionsAfter.userAddress === undefined;
      
      assert(
        hasPositions,
        'E2E-8a',
        'Positions endpoint returns positions array',
        {
          hasPositions,
          responseKeys: Object.keys(positionsAfter),
          correlationId,
        }
      );
      
      const position = positionsAfter.positions?.find((p: any) => p.asset === TEST_TOKEN);
      const finalBalance = position ? BigInt(position.balance || '0') : 0n;
      const delta = finalBalance - initialBalance;
      const decimals = TEST_TOKEN === 'REDACTED' ? 6 : 18;
      const deltaFormatted = (Number(delta) / Math.pow(10, decimals)).toFixed(decimals);

      assert(
        delta > 0n,
        'E2E-8b',
        'aToken balance increased after supply',
        {
          initialBalance: initialBalance.toString(),
          finalBalance: finalBalance.toString(),
          delta: delta.toString(),
          deltaFormatted,
          token: TEST_TOKEN,
          position: position ? {
            asset: position.asset,
            assetAddress: position.assetAddress,
            aTokenAddress: position.aTokenAddress,
            balance: position.balance,
            balanceFormatted: position.balanceFormatted,
          } : null,
          txHash,
          correlationId,
        }
      );
      
      // Verify schema consistency
      assert(
        hasOk && hasUserAddress,
        'E2E-8c',
        'Positions endpoint returns consistent schema',
        {
          schema: {
            ok: hasOk,
            userAddress: hasUserAddress,
            positions: hasPositions,
            positionsLength: positionsAfter.positions?.length || 0,
          },
          correlationId,
        }
      );
    }
  } catch (error: any) {
    assert(false, 'E2E-8', `Error: ${error.message}`, { txHash, correlationId, stack: error.stack });
  }

  // Print summary
  console.log('\n============================================================');
  console.log('AAVE DEFI E2E SMOKE TEST REPORT');
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

  // Output txHash in parseable format for combined script (before summary)
  if (txHash) {
    console.log('\n============================================================');
    console.log('TRANSACTION HASH (for post-tx verifier)');
    console.log('============================================================');
    console.log(`txHash: ${txHash}`);
    console.log(`TX_HASH=${txHash}`);
    console.log(`Transaction Hash: ${txHash}`);
    console.log(`Explorer: https://sepolia.etherscan.io/tx/${txHash}`);
    console.log('============================================================');
  }

  if (txHash) {
    console.log(`\n📝 Transaction Hash: ${txHash}`);
    console.log(`🔗 Explorer: https://sepolia.etherscan.io/tx/${txHash}`);
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
