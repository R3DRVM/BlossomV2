/**
 * Sprint 4 Activation: One-Command Operator Flow
 * Runs all phases in order and fails fast at the FIRST missing prerequisite.
 *
 * Phases:
 * 0. Backend health + preflight config
 * 1. Adapter deployment + allowlist
 * 2. Wallet prereqs (session, balance, allowance)
 * 3. Real execution proof
 * 4. Stress test for reliability
 */

const API_BASE = process.env.AGENT_API_BASE_URL || 'http://localhost:3001';
const TEST_USER_ADDRESS = process.env.TEST_USER_ADDRESS || '0x7abFA1E1c78DfAd99A0428D9437dF05157c08FcC';
const TEST_TOKEN = process.env.TEST_TOKEN || 'REDACTED';
const TEST_AMOUNT_UNITS = process.env.TEST_AMOUNT_UNITS || '1000000';
const STRESS_CONCURRENCY = process.env.STRESS_CONCURRENCY || '100';

async function fetchJSON(url: string, options: RequestInit = {}): Promise<any> {
  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      const text = await response.text();
      return { _error: true, status: response.status, message: text };
    }
    return response.json();
  } catch (error: any) {
    return { _error: true, status: 0, message: error.message };
  }
}

async function runCommand(command: string, env: Record<string, string> = {}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error: any) {
    return {
      exitCode: error.code || 1,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message || '',
    };
  }
}

async function main() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║          SPRINT 4 ACTIVATION - ONE COMMAND FLOW              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\nAPI Base: ${API_BASE}`);
  console.log(`Test User: ${TEST_USER_ADDRESS}`);
  console.log(`Test Token: ${TEST_TOKEN}`);
  console.log(`Test Amount: ${TEST_AMOUNT_UNITS}`);
  console.log(`Stress Concurrency: ${STRESS_CONCURRENCY}`);
  console.log('\n');

  const env = {
    TEST_USER_ADDRESS,
    TEST_TOKEN,
    TEST_AMOUNT_UNITS,
    STRESS_CONCURRENCY,
    AGENT_API_BASE_URL: API_BASE,
  };

  // =============================================
  // PHASE 0: Backend Health + Preflight
  // =============================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('PHASE 0: Backend Health + Preflight Config');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const health = await fetchJSON(`${API_BASE}/health`);
  if (health._error || health.ok !== true) {
    console.error('❌ FAIL: Backend not reachable');
    console.error(`   Status: ${health.status}`);
    console.error(`   Message: ${health.message || 'Unknown error'}`);
    console.error('\n   ACTION: Start backend with: cd agent && npm run dev');
    process.exit(1);
  }
  console.log('✅ Backend is healthy');

  const preflight = await fetchJSON(`${API_BASE}/api/execute/preflight`);
  if (preflight._error) {
    console.error('❌ FAIL: Preflight endpoint failed');
    console.error(`   Status: ${preflight.status}`);
    console.error(`   Message: ${preflight.message || 'Unknown error'}`);
    process.exit(1);
  }

  const lendingMode = preflight.lending?.mode || preflight.lending?.executionMode;
  if (lendingMode !== 'real') {
    console.error('❌ FAIL: Lending mode is not "real"');
    console.error(`   Current: ${lendingMode}`);
    console.error('\n   ACTION: Set LENDING_EXECUTION_MODE=real in agent/.env.local and restart backend');
    process.exit(1);
  }
  console.log(`✅ Lending mode is "real"`);
  console.log(`   Aave Pool: ${preflight.lending?.vault}`);
  console.log(`   Aave Adapter: ${preflight.lending?.adapter}`);
  console.log('\n✅ PHASE 0 PASSED\n');

  // =============================================
  // PHASE 1: Adapter Deployment
  // =============================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('PHASE 1: Adapter Deployment + Allowlist');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const adapterResult = await runCommand('npm run prove:aave-adapter:deployed', env);
  if (adapterResult.exitCode !== 0) {
    console.error('❌ FAIL: Adapter deployment check failed');
    console.error('\n   Output:');
    console.error(adapterResult.stdout);
    console.error(adapterResult.stderr);
    console.error('\n   ACTION: Deploy adapter (see RUNBOOK_REAL_DEFI_SEPOLIA.md Phase 1)');
    process.exit(1);
  }
  console.log('✅ Aave adapter deployed and allowlisted');
  console.log('\n✅ PHASE 1 PASSED\n');

  // =============================================
  // PHASE 2: Wallet Prerequisites (Session + Balance + Allowance)
  // =============================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('PHASE 2: Wallet Prerequisites');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const prereqsResult = await runCommand('npm run prove:aave-defi:prereqs', env);
  if (prereqsResult.exitCode !== 0) {
    console.error('❌ FAIL: Prerequisites check failed');
    console.error('\n   Output:');
    console.error(prereqsResult.stdout);
    console.error(prereqsResult.stderr);

    // Provide specific guidance based on failure
    if (prereqsResult.stdout.includes('PREREQ-3') && prereqsResult.stdout.includes('Session')) {
      console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error('SESSION NOT ACTIVE - MANUAL STEPS REQUIRED');
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error('\n1. Open the Blossom UI: http://localhost:5173');
      console.error('2. Connect wallet: ' + TEST_USER_ADDRESS);
      console.error('3. Click "Enable One-Click Execution" toggle');
      console.error('4. Sign the transaction in your wallet (this is an ON-CHAIN tx)');
      console.error('5. Wait for confirmation (12-20 seconds)');
      console.error('\n   Verify session created:');
      console.error(`   curl -s "${API_BASE}/api/debug/session-authority?address=${TEST_USER_ADDRESS}" | jq '.sessionStatus'`);
      console.error('\n   Expected: { "status": "active", ... }');
    }

    if (prereqsResult.stdout.includes('PREREQ-4') && prereqsResult.stdout.includes('balance')) {
      console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error('INSUFFICIENT TOKEN BALANCE - FAUCET REQUIRED');
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error('\n1. Go to Circle REDACTED Faucet: https://faucet.circle.com/');
      console.error('2. Select "Ethereum Sepolia"');
      console.error('3. Enter address: ' + TEST_USER_ADDRESS);
      console.error('4. Request REDACTED');
    }

    console.error('\n   After fixing, re-run: npm run sprint4:activate');
    process.exit(1);
  }
  console.log('✅ All prerequisites passed (session active, balance sufficient, allowance set)');
  console.log('\n✅ PHASE 2 PASSED\n');

  // =============================================
  // PHASE 3: Real Execution Proof
  // =============================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('PHASE 3: Real Execution Proof (THE REALNESS LINE)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const realResult = await runCommand('npm run prove:aave-defi:real', env);

  // Extract txHash from output
  const txHashMatch = realResult.stdout.match(/txHash[:\s]+(0x[a-fA-F0-9]{64})/i) ||
                      realResult.stdout.match(/Transaction Hash[:\s]+(0x[a-fA-F0-9]{64})/i) ||
                      realResult.stdout.match(/TX_HASH[=:\s]+(0x[a-fA-F0-9]{64})/i);
  const txHash = txHashMatch ? txHashMatch[1] : null;

  if (realResult.exitCode !== 0) {
    console.error('❌ FAIL: Real execution proof failed');
    console.error('\n   Output:');
    console.error(realResult.stdout);
    console.error(realResult.stderr);
    console.error('\n   ACTION: Check transaction on Sepolia explorer and backend logs');
    process.exit(1);
  }

  console.log('✅ Real execution proof PASSED');
  if (txHash) {
    console.log(`   TX_HASH=${txHash}`);
    console.log(`   Explorer: https://sepolia.etherscan.io/tx/${txHash}`);
  }
  console.log('\n✅ PHASE 3 PASSED\n');

  // =============================================
  // PHASE 4: Stress Test
  // =============================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('PHASE 4: Reliability Stress Test');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const stressResult = await runCommand('npm run stress:aave-positions', {
    ...env,
    STRESS_CONCURRENCY,
  });

  if (stressResult.exitCode !== 0) {
    console.error('❌ FAIL: Stress test failed');
    console.error('\n   Output:');
    console.error(stressResult.stdout);
    console.error(stressResult.stderr);
    process.exit(1);
  }

  // Check for HTTP 500s
  if (stressResult.stdout.includes('HTTP 500') && !stressResult.stdout.includes('HTTP 500: 0')) {
    console.error('❌ FAIL: Stress test had HTTP 500 errors');
    console.error(stressResult.stdout);
    process.exit(1);
  }

  console.log('✅ Stress test PASSED (no HTTP 500s)');
  console.log('\n✅ PHASE 4 PASSED\n');

  // =============================================
  // FINAL SUMMARY
  // =============================================
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║               🎉 SPRINT 4 ACTIVATION COMPLETE 🎉              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('\n✅ Phase 0: Backend Health + Preflight - PASSED');
  console.log('✅ Phase 1: Adapter Deployment - PASSED');
  console.log('✅ Phase 2: Wallet Prerequisites - PASSED');
  console.log('✅ Phase 3: Real Execution Proof - PASSED');
  console.log('✅ Phase 4: Stress Test - PASSED');
  if (txHash) {
    console.log(`\n📝 Transaction Hash: ${txHash}`);
    console.log(`🔗 Explorer: https://sepolia.etherscan.io/tx/${txHash}`);
  }
  console.log('\n✅ Real Aave v3 Sepolia supply execution is proven end-to-end!');
  console.log('✅ Positions endpoint is stable under load.');
  console.log('\nSprint 4 is BULLETPROOF. Ready for testnet users.\n');
  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
