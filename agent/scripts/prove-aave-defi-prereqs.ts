/**
 * Sprint 4.6: Aave DeFi Prerequisites Checker
 * Validates all requirements before attempting real Aave supply execution
 */

const API_BASE = process.env.AGENT_API_BASE_URL || 'http://localhost:3001';
const TEST_USER_ADDRESS = process.env.TEST_USER_ADDRESS;
const TEST_TOKEN = process.env.TEST_TOKEN; // USDC|WETH
const TEST_AMOUNT_UNITS = process.env.TEST_AMOUNT_UNITS; // base units

interface PrereqResult {
  check: string;
  passed: boolean;
  message: string;
  action?: string;
}

const results: PrereqResult[] = [];

function record(check: string, passed: boolean, message: string, action?: string): void {
  results.push({ check, passed, message, action });
  if (passed) {
    console.log(`✅ PASS: ${check} - ${message}`);
  } else {
    console.error(`❌ FAIL: ${check} - ${message}`);
    if (action) {
      console.error(`   Action: ${action}`);
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
  console.log('\n🔍 Sprint 4.6: Aave DeFi Prerequisites Checker');
  console.log('============================================================');
  console.log(`API Base: ${API_BASE}`);
  console.log(`Test User: ${TEST_USER_ADDRESS || 'NOT SET'}`);
  console.log(`Test Token: ${TEST_TOKEN || 'NOT SET'}`);
  console.log(`Test Amount: ${TEST_AMOUNT_UNITS || 'NOT SET'}`);
  console.log('============================================================\n');

  // Check required env vars
  if (!TEST_USER_ADDRESS || !TEST_TOKEN || !TEST_AMOUNT_UNITS) {
    console.error('❌ FAIL: Required environment variables not set');
    console.error('   Missing:');
    if (!TEST_USER_ADDRESS) {
      console.error('     - TEST_USER_ADDRESS');
      record('ENV-1', false, 'TEST_USER_ADDRESS not set', 'Set TEST_USER_ADDRESS=0x...');
    }
    if (!TEST_TOKEN) {
      console.error('     - TEST_TOKEN (USDC or WETH)');
      record('ENV-2', false, 'TEST_TOKEN not set', 'Set TEST_TOKEN=USDC or TEST_TOKEN=WETH');
    }
    if (!TEST_AMOUNT_UNITS) {
      console.error('     - TEST_AMOUNT_UNITS (base units)');
      record('ENV-3', false, 'TEST_AMOUNT_UNITS not set', 'Set TEST_AMOUNT_UNITS=1000000 (for 1 USDC)');
    }
    console.error('\n   Example: TEST_USER_ADDRESS=0x... TEST_TOKEN=USDC TEST_AMOUNT_UNITS=1000000 npm run prove:aave-defi:prereqs');
    process.exit(1);
  }

  // PREREQ-1: Backend health
  console.log('Checking PREREQ-1: Backend health...');
  const healthy = await healthCheck();
  if (!healthy) {
    record('PREREQ-1', false, 'Backend not available', 'Start backend: cd agent && npm run dev');
    process.exit(1);
  }
  record('PREREQ-1', true, 'Backend is healthy');

  // PREREQ-2: Preflight checks (lending mode=real, adapter allowlisted)
  console.log('\nChecking PREREQ-2: Preflight (lending mode + adapter)...');
  try {
    const preflight = await fetchJSON(`${API_BASE}/api/execute/preflight`);
    
    if (preflight._error) {
      record('PREREQ-2', false, 'Preflight endpoint failed', `Check backend logs. Status: ${preflight.status}`);
      process.exit(1);
    }

    const lendingMode = preflight.lending?.mode || preflight.lending?.executionMode || 'demo';
    const isReal = lendingMode === 'real';
    
    record(
      'PREREQ-2a',
      isReal,
      `Lending execution mode is 'real'`,
      isReal ? undefined : 'Set LENDING_EXECUTION_MODE=real in backend .env.local and restart backend'
    );

    if (!isReal) {
      console.error(`   Current mode: ${lendingMode}`);
      console.error(`   Expected: real`);
      console.error(`   Action: Set LENDING_EXECUTION_MODE=real in agent/.env.local and restart backend`);
    }

    const allowedAdapters = preflight.allowedAdapters || [];
    const { AAVE_ADAPTER_ADDRESS, AAVE_SEPOLIA_POOL_ADDRESS, EXECUTION_ROUTER_ADDRESS } = await import('../src/config');
    
    // Print addresses for debugging
    console.log(`   ExecutionRouter: ${EXECUTION_ROUTER_ADDRESS || 'NOT SET'}`);
    console.log(`   Aave Pool: ${AAVE_SEPOLIA_POOL_ADDRESS || 'NOT SET'}`);
    console.log(`   Aave Adapter: ${AAVE_ADAPTER_ADDRESS || 'NOT SET'}`);
    
    if (!AAVE_ADAPTER_ADDRESS) {
      record('PREREQ-2b', false, 'AAVE_ADAPTER_ADDRESS not configured', 'Set AAVE_ADAPTER_ADDRESS in backend .env.local');
      console.error('   Action: Deploy adapter (see RUNBOOK_REAL_DEFI_SEPOLIA.md Phase 1)');
    } else {
      const adapterLower = AAVE_ADAPTER_ADDRESS.toLowerCase();
      const isAllowed = allowedAdapters.some((a: string) => a.toLowerCase() === adapterLower);
      
      record(
        'PREREQ-2b',
        isAllowed,
        'Aave adapter is in allowedAdapters',
        isAllowed ? undefined : `Add ${AAVE_ADAPTER_ADDRESS} to allowedAdapters or check backend configuration`
      );
      
      if (!isAllowed) {
        console.error(`   Adapter address: ${AAVE_ADAPTER_ADDRESS}`);
        console.error(`   Allowed adapters: ${allowedAdapters.join(', ')}`);
        console.error('   Action: Allowlist adapter (see RUNBOOK_REAL_DEFI_SEPOLIA.md Phase 1, Step 1.2)');
      }
    }
  } catch (error: any) {
    record('PREREQ-2', false, `Error: ${error.message}`, 'Check backend is running and accessible');
    process.exit(1);
  }

  // PREREQ-3: Session active
  console.log('\nChecking PREREQ-3: Session active...');
  try {
    const sessionAuth = await fetchJSON(`${API_BASE}/api/debug/session-authority?address=${TEST_USER_ADDRESS}`);
    
    if (sessionAuth._error) {
      record(
        'PREREQ-3',
        false,
        'Session authority check failed',
        `Check backend logs. Status: ${sessionAuth.status}. Error: ${JSON.stringify(sessionAuth.data)}`
      );
      process.exit(1);
    }

    const sessionStatus = sessionAuth.sessionStatus;
    const isActive = sessionStatus?.status === 'active';
    const sessionId = sessionStatus?.sessionId || sessionAuth.sessionId;

    record(
      'PREREQ-3',
      isActive,
      `Session is active for ${TEST_USER_ADDRESS}`,
      isActive ? undefined : 'Open UI -> enable one-click execution -> confirm session creation once'
    );

    if (!isActive) {
      console.error(`   Current status: ${sessionStatus?.status || 'unknown'}`);
      console.error(`   Session ID: ${sessionId || 'not found'}`);
      process.exit(1);
    }

    // Store sessionId for use in E2E test
    if (sessionId) {
      console.log(`   ✅ Active session ID: ${sessionId}`);
      console.log(`   SessionId format: ${sessionId.length === 66 ? 'valid (0x + 64 hex)' : 'invalid'}`);
    } else {
      console.error(`   ⚠️  Warning: Session is active but sessionId not found in response`);
      console.error(`   Response keys: ${Object.keys(sessionAuth).join(', ')}`);
    }
  } catch (error: any) {
    record('PREREQ-3', false, `Error: ${error.message}`, 'Check backend is running and session endpoint is accessible');
    process.exit(1);
  }

  // PREREQ-4: Token balance sufficient
  console.log('\nChecking PREREQ-4: Token balance...');
  try {
    const { ETH_TESTNET_RPC_URL, USDC_ADDRESS_SEPOLIA, WETH_ADDRESS_SEPOLIA } = await import('../src/config');
    const { erc20_balanceOf } = await import('../src/executors/erc20Rpc');

    if (!ETH_TESTNET_RPC_URL) {
      record('PREREQ-4', false, 'ETH_TESTNET_RPC_URL not configured', 'Set ETH_TESTNET_RPC_URL in backend .env.local');
      process.exit(1);
    }

    let tokenAddress: string;
    let decimals: number;
    if (TEST_TOKEN === 'USDC') {
      tokenAddress = USDC_ADDRESS_SEPOLIA!;
      decimals = 6;
    } else if (TEST_TOKEN === 'WETH') {
      tokenAddress = WETH_ADDRESS_SEPOLIA!;
      decimals = 18;
    } else {
      record('PREREQ-4', false, `Unsupported TEST_TOKEN: ${TEST_TOKEN}`, 'Use TEST_TOKEN=USDC or TEST_TOKEN=WETH');
      process.exit(1);
    }

    console.log(`   Token address: ${tokenAddress}`);
    console.log(`   User address: ${TEST_USER_ADDRESS}`);

    const amount = BigInt(TEST_AMOUNT_UNITS);
    const balance = await erc20_balanceOf(tokenAddress, TEST_USER_ADDRESS);

    const balanceFormatted = (Number(balance) / Math.pow(10, decimals)).toFixed(decimals);
    const amountFormatted = (Number(amount) / Math.pow(10, decimals)).toFixed(decimals);

    record(
      'PREREQ-4',
      balance >= amount,
      `Token balance sufficient (${balanceFormatted} ${TEST_TOKEN} >= ${amountFormatted} ${TEST_TOKEN})`,
      balance >= amount ? undefined : `Fund ${TEST_USER_ADDRESS} with ${amountFormatted} ${TEST_TOKEN} on Sepolia`
    );

    if (balance < amount) {
      const delta = amount - balance;
      const deltaFormatted = (Number(delta) / Math.pow(10, decimals)).toFixed(decimals);
      console.error(`   Current balance: ${balance.toString()} (${balanceFormatted} ${TEST_TOKEN})`);
      console.error(`   Required: ${amount.toString()} (${amountFormatted} ${TEST_TOKEN})`);
      console.error(`   Missing: ${delta.toString()} (${deltaFormatted} ${TEST_TOKEN})`);
      console.error(`   Token address: ${tokenAddress}`);
      console.error(`   Action: Fund ${TEST_USER_ADDRESS} with ${deltaFormatted} ${TEST_TOKEN} on Sepolia`);
      console.error(`   See RUNBOOK_REAL_DEFI_SEPOLIA.md Phase 4, Step 4.1`);
      process.exit(1);
    }
  } catch (error: any) {
    record('PREREQ-4', false, `Error: ${error.message}`, 'Check RPC URL and token addresses are configured correctly');
    process.exit(1);
  }

  // PREREQ-5: Token allowance sufficient
  console.log('\nChecking PREREQ-5: Token allowance...');
  try {
    const { ETH_TESTNET_RPC_URL, EXECUTION_ROUTER_ADDRESS, USDC_ADDRESS_SEPOLIA, WETH_ADDRESS_SEPOLIA } = await import('../src/config');
    const { erc20_allowance } = await import('../src/executors/erc20Rpc');

    if (!EXECUTION_ROUTER_ADDRESS) {
      record('PREREQ-5', false, 'EXECUTION_ROUTER_ADDRESS not configured', 'Set EXECUTION_ROUTER_ADDRESS in backend .env.local');
      process.exit(1);
    }

    let tokenAddress: string;
    let decimals: number;
    if (TEST_TOKEN === 'USDC') {
      tokenAddress = USDC_ADDRESS_SEPOLIA!;
      decimals = 6;
    } else if (TEST_TOKEN === 'WETH') {
      tokenAddress = WETH_ADDRESS_SEPOLIA!;
      decimals = 18;
    } else {
      record('PREREQ-5', false, `Unsupported TEST_TOKEN: ${TEST_TOKEN}`, 'Use TEST_TOKEN=USDC or TEST_TOKEN=WETH');
      process.exit(1);
    }

    console.log(`   Token address: ${tokenAddress}`);
    console.log(`   User address: ${TEST_USER_ADDRESS}`);
    console.log(`   Spender (ExecutionRouter): ${EXECUTION_ROUTER_ADDRESS}`);

    const amount = BigInt(TEST_AMOUNT_UNITS);
    const allowance = await erc20_allowance(tokenAddress, TEST_USER_ADDRESS, EXECUTION_ROUTER_ADDRESS);

    const allowanceFormatted = (Number(allowance) / Math.pow(10, decimals)).toFixed(decimals);
    const amountFormatted = (Number(amount) / Math.pow(10, decimals)).toFixed(decimals);

    record(
      'PREREQ-5',
      allowance >= amount,
      `Token allowance sufficient (${allowanceFormatted} ${TEST_TOKEN} >= ${amountFormatted} ${TEST_TOKEN})`,
      allowance >= amount ? undefined : `Approve ${EXECUTION_ROUTER_ADDRESS} to spend ${amountFormatted} ${TEST_TOKEN}`
    );

    if (allowance < amount) {
      const delta = amount - allowance;
      const deltaFormatted = (Number(delta) / Math.pow(10, decimals)).toFixed(decimals);
      console.error(`   Current allowance: ${allowance.toString()} (${allowanceFormatted} ${TEST_TOKEN})`);
      console.error(`   Required: ${amount.toString()} (${amountFormatted} ${TEST_TOKEN})`);
      console.error(`   Missing: ${delta.toString()} (${deltaFormatted} ${TEST_TOKEN})`);
      console.error(`   Token address: ${tokenAddress}`);
      console.error(`   Spender (ExecutionRouter): ${EXECUTION_ROUTER_ADDRESS}`);
      console.error(`   Action: Approve ${EXECUTION_ROUTER_ADDRESS} to spend ${deltaFormatted} ${TEST_TOKEN}`);
      console.error(`   Method: Call approve(${EXECUTION_ROUTER_ADDRESS}, ${amount.toString()}) on token ${tokenAddress}`);
      console.error(`   See RUNBOOK_REAL_DEFI_SEPOLIA.md Phase 4, Step 4.2`);
      process.exit(1);
    }
  } catch (error: any) {
    record('PREREQ-5', false, `Error: ${error.message}`, 'Check RPC URL, token addresses, and ExecutionRouter address are configured correctly');
    process.exit(1);
  }

  // Summary
  console.log('\n============================================================');
  console.log('PREREQUISITES CHECK SUMMARY');
  console.log('============================================================');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`Total Checks: ${results.length}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);

  if (failed > 0) {
    console.log('\n❌ PREREQUISITES NOT MET');
    console.log('Fix the failures above before running E2E execution.');
    process.exit(1);
  }

  console.log('\n✅ ALL PREREQUISITES MET');
  console.log('Ready to execute real Aave supply transaction.');
  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
