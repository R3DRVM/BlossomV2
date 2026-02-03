#!/usr/bin/env npx ts-node
/**
 * BULLETPROOF E2E - Production Validation
 *
 * Validates all venues with hard PASS/FAIL and machine-readable output.
 */

const PROD_URL = process.env.PROD_URL || 'https://app.blossom.onl';
const TEST_USER = process.env.TEST_USER_ADDRESS || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const ACCESS_CODE = process.env.BLOSSOM_TEST_ACCESS_CODE || '';

interface TestResult {
  name: string;
  venue: string;
  phase: 'chat' | 'prepare';
  pass: boolean;
  evidence: string;
  actionTypes?: number[];
}

const results: TestResult[] = [];

async function fetchJson(url: string, options?: RequestInit): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> || {}),
  };
  if (ACCESS_CODE) headers['X-Access-Code'] = ACCESS_CODE;

  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.substring(0, 200)}`);
  return JSON.parse(text);
}

const VENUE_TESTS = [
  { venue: 'swap', prompt: 'Swap 10 USDC to WETH', expectedKind: 'swap', requiredActions: [2, 0], forbiddenActions: [] },
  { venue: 'lend', prompt: 'Deposit 50 USDC into Aave', expectedKind: 'lend_supply', requiredActions: [2, 3], forbiddenActions: [] },
  { venue: 'perp', prompt: 'Go long SOL 3x leverage $50 margin', expectedKind: 'perp', requiredActions: [7], forbiddenActions: [6] },
  { venue: 'event', prompt: 'Bet $10 YES on BTC ETF approval', expectedKind: 'event', requiredActions: [8], forbiddenActions: [6] },
];

async function testVenue(test: typeof VENUE_TESTS[0]): Promise<void> {
  const { venue, prompt, expectedKind, requiredActions, forbiddenActions } = test;

  // CHAT TEST
  try {
    const chatRes = await fetchJson(`${PROD_URL}/api/chat`, {
      method: 'POST',
      body: JSON.stringify({
        userMessage: prompt,
        venue: 'hyperliquid',
        clientPortfolio: { accountValueUsd: 10000, balances: [{ symbol: 'USDC', balanceUsd: 5000 }] },
      }),
    });

    const execReq = chatRes.executionRequest;
    const kindMatches = execReq?.kind === expectedKind ||
      (expectedKind === 'lend_supply' && ['lend', 'lend_supply'].includes(execReq?.kind));

    results.push({
      name: `${venue}_chat`,
      venue,
      phase: 'chat',
      pass: !!execReq && kindMatches,
      evidence: execReq ? `kind=${execReq.kind}` : 'NO_EXECUTION_REQUEST',
    });

    if (!execReq) return;

    // PREPARE TEST
    const prepareRes = await fetchJson(`${PROD_URL}/api/execute/prepare`, {
      method: 'POST',
      body: JSON.stringify({
        draftId: `bulletproof-${venue}-${Date.now()}`,
        userAddress: TEST_USER,
        executionRequest: execReq,
        authMode: 'direct',
      }),
    });

    const actionTypes = prepareRes.plan?.actions?.map((a: any) => a.actionType) || [];
    const hasRequired = requiredActions.every(r => actionTypes.includes(r));
    const hasForbidden = forbiddenActions.some(f => actionTypes.includes(f));
    const pass = hasRequired && !hasForbidden;

    let evidence = `actions=[${actionTypes.join(',')}]`;
    if (hasForbidden) evidence += ' FORBIDDEN_ACTION_DETECTED!';
    if (!hasRequired) evidence += ' MISSING_REQUIRED_ACTIONS!';

    results.push({
      name: `${venue}_prepare`,
      venue,
      phase: 'prepare',
      pass,
      evidence,
      actionTypes,
    });

  } catch (err: any) {
    results.push({
      name: `${venue}_error`,
      venue,
      phase: 'chat',
      pass: false,
      evidence: err.message,
    });
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('  BULLETPROOF E2E - PRODUCTION VALIDATION');
  console.log('='.repeat(80));
  console.log(`URL: ${PROD_URL}`);
  console.log(`Access Code: ${ACCESS_CODE ? '***' + ACCESS_CODE.slice(-4) : 'NOT SET'}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log('');

  if (!ACCESS_CODE) {
    console.log('ERROR: BLOSSOM_TEST_ACCESS_CODE required');
    process.exit(1);
  }

  // Verify ground truth first
  console.log('--- Ground Truth Check ---');
  const health = await fetchJson(`${PROD_URL}/api/health`);
  const preflight = await fetchJson(`${PROD_URL}/api/execute/preflight`);
  console.log(`gitSha: ${health.gitSha}`);
  console.log(`router: ${preflight.router}`);
  console.log(`venues: swap=${preflight.swapEnabled} lend=${preflight.lendingEnabled} perp=${preflight.perpsEnabled} event=${preflight.eventsEnabled}`);
  console.log('');

  // Run venue tests
  console.log('--- Venue Tests ---');
  for (const test of VENUE_TESTS) {
    await testVenue(test);
    await new Promise(r => setTimeout(r, 300));
  }

  // Print results
  console.log('');
  console.log('='.repeat(80));
  console.log('  RESULTS');
  console.log('='.repeat(80));

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  const total = results.length;

  console.log('');
  console.log('Name'.padEnd(25) + 'Venue'.padEnd(10) + 'Phase'.padEnd(10) + 'Status'.padEnd(10) + 'Evidence');
  console.log('-'.repeat(100));

  for (const r of results) {
    const status = r.pass ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    console.log(`${r.name.padEnd(25)}${r.venue.padEnd(10)}${r.phase.padEnd(10)}${status.padEnd(19)}${r.evidence.substring(0, 50)}`);
  }

  console.log('');
  console.log('='.repeat(80));
  console.log(`  SUMMARY: ${passed}/${total} passed, ${failed} failed`);
  console.log('='.repeat(80));

  // Critical checks
  const perpPrepare = results.find(r => r.name === 'perp_prepare');
  const eventPrepare = results.find(r => r.name === 'event_prepare');
  const perpUsesRealAction = perpPrepare?.pass && perpPrepare?.actionTypes?.includes(7) && !perpPrepare?.actionTypes?.includes(6);
  const eventUsesRealAction = eventPrepare?.pass && eventPrepare?.actionTypes?.includes(8) && !eventPrepare?.actionTypes?.includes(6);

  console.log('');
  console.log('--- CRITICAL VALIDATIONS ---');
  console.log(`PERP uses action type 7 (not PROOF=6): ${perpUsesRealAction ? '\x1b[32mYES\x1b[0m' : '\x1b[31mNO\x1b[0m'}`);
  console.log(`EVENT uses action type 8 (not PROOF=6): ${eventUsesRealAction ? '\x1b[32mYES\x1b[0m' : '\x1b[31mNO\x1b[0m'}`);

  // Machine-readable JSON output
  console.log('');
  console.log('--- MACHINE-READABLE OUTPUT ---');
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    total,
    passed,
    failed,
    perpUsesRealAction,
    eventUsesRealAction,
    allPass: failed === 0 && perpUsesRealAction && eventUsesRealAction,
    results: results.map(r => ({ name: r.name, pass: r.pass, evidence: r.evidence })),
  }, null, 2));

  // Exit code
  const allCriticalPass = failed === 0 && perpUsesRealAction && eventUsesRealAction;
  if (allCriticalPass) {
    console.log('\n\x1b[32m✅ PHASE 2: ALL TESTS PASS\x1b[0m');
    process.exit(0);
  } else {
    console.log('\n\x1b[31m❌ PHASE 2: SOME TESTS FAILED\x1b[0m');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
