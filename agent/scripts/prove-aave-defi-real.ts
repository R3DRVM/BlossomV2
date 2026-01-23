/**
 * Sprint 4.6: Combined Real Aave DeFi Execution Proof
 * Runs prereqs -> E2E smoke -> post-tx verifier in sequence
 */

const API_BASE = process.env.AGENT_API_BASE_URL || 'http://localhost:3001';
const TEST_USER_ADDRESS = process.env.TEST_USER_ADDRESS;
const TEST_TOKEN = process.env.TEST_TOKEN;
const TEST_AMOUNT_UNITS = process.env.TEST_AMOUNT_UNITS;

async function runCommand(command: string, env: Record<string, string> = {}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  const envVars = Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');

  const fullCommand = envVars ? `${envVars} ${command}` : command;

  try {
    const { stdout, stderr } = await execAsync(fullCommand, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
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

async function extractTxHash(stdout: string): Promise<string | null> {
  // Look for txHash in output
  const txHashMatch = stdout.match(/txHash[:\s]+(0x[a-fA-F0-9]{64})/i) || 
                      stdout.match(/(0x[a-fA-F0-9]{64})/);
  return txHashMatch ? txHashMatch[1] : null;
}

async function main() {
  console.log('\n🚀 Sprint 4.6: Real Aave DeFi Execution Proof');
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
    if (!TEST_USER_ADDRESS) console.error('     - TEST_USER_ADDRESS');
    if (!TEST_TOKEN) console.error('     - TEST_TOKEN (USDC or WETH)');
    if (!TEST_AMOUNT_UNITS) console.error('     - TEST_AMOUNT_UNITS (base units)');
    console.error('   Example: TEST_USER_ADDRESS=0x... TEST_TOKEN=USDC TEST_AMOUNT_UNITS=1000000 npm run prove:aave-defi:real');
    process.exit(1);
  }

  const env = {
    TEST_USER_ADDRESS,
    TEST_TOKEN,
    TEST_AMOUNT_UNITS,
    AGENT_API_BASE_URL: API_BASE,
  };

  // Step 1: Run prereqs checker
  console.log('============================================================');
  console.log('STEP 1: Prerequisites Check');
  console.log('============================================================\n');
  
  const prereqsResult = await runCommand('npm run prove:aave-defi:prereqs', env);
  
  if (prereqsResult.exitCode !== 0) {
    console.error('❌ Prerequisites check FAILED');
    console.error('   Fix the failures above before proceeding.');
    console.error('\n   Prereqs output:');
    console.error(prereqsResult.stdout);
    console.error(prereqsResult.stderr);
    process.exit(1);
  }

  console.log('✅ Prerequisites check PASSED\n');

  // Step 2: Run E2E smoke test
  console.log('============================================================');
  console.log('STEP 2: E2E Smoke Test (Real Transaction)');
  console.log('============================================================\n');

  const e2eResult = await runCommand('npm run prove:aave-defi:e2e-smoke', env);

  if (e2eResult.exitCode !== 0) {
    console.error('❌ E2E smoke test FAILED');
    console.error('\n   E2E output:');
    console.error(e2eResult.stdout);
    console.error(e2eResult.stderr);
    process.exit(1);
  }

  // Extract txHash from E2E output
  const txHash = extractTxHash(e2eResult.stdout);
  
  if (!txHash) {
    console.error('❌ FAIL: Could not extract txHash from E2E output');
    console.error('   E2E output:');
    console.error(e2eResult.stdout);
    process.exit(1);
  }

  console.log(`✅ E2E smoke test PASSED`);
  console.log(`   Transaction Hash: ${txHash}`);
  console.log(`   Explorer: https://sepolia.etherscan.io/tx/${txHash}\n`);

  // Step 3: Run post-tx verifier
  console.log('============================================================');
  console.log('STEP 3: Post-Tx Verifier');
  console.log('============================================================\n');

  const postTxResult = await runCommand('npm run prove:aave-defi:post-tx', {
    ...env,
    TX_HASH: txHash,
  });

  if (postTxResult.exitCode !== 0) {
    console.error('❌ Post-tx verifier FAILED');
    console.error('\n   Post-tx output:');
    console.error(postTxResult.stdout);
    console.error(postTxResult.stderr);
    process.exit(1);
  }

  console.log('✅ Post-tx verifier PASSED\n');

  // Final summary
  console.log('============================================================');
  console.log('🎉 ALL STEPS PASSED');
  console.log('============================================================');
  console.log('✅ Prerequisites: PASSED');
  console.log('✅ E2E Execution: PASSED');
  console.log(`✅ Transaction: ${txHash}`);
  console.log('✅ Post-Tx Verification: PASSED');
  console.log('\nReal Aave supply execution proven end-to-end!');
  console.log(`\nExplorer: https://sepolia.etherscan.io/tx/${txHash}`);
  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
