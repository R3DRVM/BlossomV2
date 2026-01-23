/**
 * Sprint 4 Finalization: Real Aave DeFi Execution Proof (NEVER SKIPS)
 * Runs strict E2E proof: adapter deployed + allowlisted + prereqs + real execution
 * This command MUST NEVER SKIP. It either PASSes or FAILs with actionable steps.
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

async function main() {
  console.log('\n🚀 Sprint 4 Finalization: Real Aave DeFi Execution Proof');
  console.log('============================================================');
  console.log('This proof NEVER SKIPS. It either PASSes or FAILs with actionable steps.');
  console.log('============================================================');
  console.log(`API Base: ${API_BASE}`);
  console.log(`Test User: ${TEST_USER_ADDRESS || 'NOT SET'}`);
  console.log(`Test Token: ${TEST_TOKEN || 'NOT SET'}`);
  console.log(`Test Amount: ${TEST_AMOUNT_UNITS || 'NOT SET'}`);
  console.log('============================================================\n');

  // Check required env vars - FAIL if missing (no SKIP)
  if (!TEST_USER_ADDRESS || !TEST_TOKEN || !TEST_AMOUNT_UNITS) {
    console.error('❌ FAIL: Required environment variables not set');
    console.error('   Missing:');
    if (!TEST_USER_ADDRESS) console.error('     - TEST_USER_ADDRESS');
    if (!TEST_TOKEN) console.error('     - TEST_TOKEN (USDC or WETH)');
    if (!TEST_AMOUNT_UNITS) console.error('     - TEST_AMOUNT_UNITS (base units, e.g. "1000000" for 1 USDC)');
    console.error('\n   Example:');
    console.error('   TEST_USER_ADDRESS=0x... TEST_TOKEN=USDC TEST_AMOUNT_UNITS=1000000 npm run prove:real');
    console.error('\n   See RUNBOOK_REAL_DEFI_SEPOLIA.md for complete setup instructions.');
    process.exit(1);
  }

  const env = {
    TEST_USER_ADDRESS,
    TEST_TOKEN,
    TEST_AMOUNT_UNITS,
    AGENT_API_BASE_URL: API_BASE,
  };

  // Step 1: Adapter deployment check (must pass, no SKIP)
  console.log('============================================================');
  console.log('STEP 1: Adapter Deployment Check');
  console.log('============================================================\n');
  
  const adapterResult = await runCommand('npm run prove:aave-adapter:deployed', env);
  
  if (adapterResult.exitCode !== 0) {
    console.error('❌ FAIL: Adapter deployment check failed');
    console.error('   The Aave adapter must be deployed and allowlisted before real execution.');
    console.error('\n   Adapter check output:');
    console.error(adapterResult.stdout);
    console.error(adapterResult.stderr);
    console.error('\n   Action: Deploy adapter (see RUNBOOK_REAL_DEFI_SEPOLIA.md Phase 1)');
    process.exit(1);
  }

  console.log('✅ Adapter deployment check PASSED\n');

  // Step 2: Prerequisites check (must pass, no SKIP)
  console.log('============================================================');
  console.log('STEP 2: Prerequisites Check');
  console.log('============================================================\n');
  
  const prereqsResult = await runCommand('npm run prove:aave-defi:prereqs', env);
  
  if (prereqsResult.exitCode !== 0) {
    console.error('❌ FAIL: Prerequisites check failed');
    console.error('   All prerequisites must be met before real execution.');
    console.error('\n   Prereqs output:');
    console.error(prereqsResult.stdout);
    console.error(prereqsResult.stderr);
    console.error('\n   Action: Fix prerequisites (see RUNBOOK_REAL_DEFI_SEPOLIA.md Phase 4-5)');
    process.exit(1);
  }

  console.log('✅ Prerequisites check PASSED\n');

  // Step 3: Real E2E execution (must pass, no SKIP)
  console.log('============================================================');
  console.log('STEP 3: Real E2E Execution');
  console.log('============================================================\n');
  
  const e2eResult = await runCommand('npm run prove:aave-defi:real', env);

  if (e2eResult.exitCode !== 0) {
    console.error('❌ FAIL: Real E2E execution failed');
    console.error('\n   E2E output:');
    console.error(e2eResult.stdout);
    console.error(e2eResult.stderr);
    console.error('\n   Action: Check transaction on Sepolia explorer and backend logs');
    process.exit(1);
  }

  // Extract txHash from output
  const txHashMatch = e2eResult.stdout.match(/txHash[:\s]+(0x[a-fA-F0-9]{64})/i) || 
                      e2eResult.stdout.match(/Transaction Hash[:\s]+(0x[a-fA-F0-9]{64})/i);
  const txHash = txHashMatch ? txHashMatch[1] : null;

  if (txHash) {
    console.log(`✅ Real E2E execution PASSED`);
    console.log(`   Transaction Hash: ${txHash}`);
    console.log(`   Explorer: https://sepolia.etherscan.io/tx/${txHash}\n`);
  } else {
    console.log('✅ Real E2E execution PASSED (txHash not extracted from output)\n');
  }

  // Final summary
  console.log('============================================================');
  console.log('🎉 ALL STEPS PASSED - REAL AAVE EXECUTION PROVEN');
  console.log('============================================================');
  console.log('✅ Adapter Deployment: PASSED');
  console.log('✅ Prerequisites: PASSED');
  console.log('✅ Real E2E Execution: PASSED');
  if (txHash) {
    console.log(`✅ Transaction: ${txHash}`);
    console.log(`   Explorer: https://sepolia.etherscan.io/tx/${txHash}`);
  }
  console.log('\nReal Aave v3 Sepolia supply execution is proven end-to-end!');
  console.log('\nFor next steps, see RUNBOOK_REAL_DEFI_SEPOLIA.md');
  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
