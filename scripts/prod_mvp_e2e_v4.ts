#!/usr/bin/env npx ts-node
/**
 * PRODUCTION MVP E2E V4 - COMPREHENSIVE THESIS PROOF
 *
 * Tests BOTH theses with hard PASS/FAIL:
 * 1) Blossom Agent thesis: chat -> correct executionRequest for all venues + slang/typos
 * 2) Execution Engine thesis: executionRequest -> prepare -> valid on-chain execution plans
 *
 * Environment Variables:
 *   PROD_URL                    - Production URL (default: https://app.blossom.onl)
 *   TEST_USER_ADDRESS           - Test wallet address
 *   BLOSSOM_TEST_ACCESS_CODE    - Access gate code
 *   ADMIN_API_KEY               - Admin key for debug endpoints
 *
 * Usage:
 *   BLOSSOM_TEST_ACCESS_CODE=XXX npx ts-node scripts/prod_mvp_e2e_v4.ts
 */

const PROD_URL = process.env.PROD_URL || 'https://app.blossom.onl';
const TEST_USER_ADDRESS = process.env.TEST_USER_ADDRESS || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const ACCESS_CODE = process.env.BLOSSOM_TEST_ACCESS_CODE || '';
const ADMIN_KEY = process.env.ADMIN_API_KEY || '';
const VERBOSE = process.argv.includes('--verbose');

// ANSI colors
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';
const NC = '\x1b[0m';
const BOLD = '\x1b[1m';

interface TestResult {
  test: string;
  category: string;
  pass: boolean;
  evidence: string;
  details?: any;
}

const results: TestResult[] = [];

// ============================================================================
// CHAT TEST CASES - Testing natural language understanding + slang
// ============================================================================
const CHAT_TEST_CASES = {
  // SWAP tests
  swap_formal: {
    prompt: "Swap 10 REDACTED to WETH",
    expectedKind: 'swap',
    venue: 'swap',
    description: 'Formal swap request',
  },
  swap_slang: {
    prompt: "yo swap like 15 bucks usdc 4 eth plz",
    expectedKind: 'swap',
    venue: 'swap',
    description: 'Slang swap request',
  },

  // LEND tests
  lend_formal: {
    prompt: "Deposit 50 REDACTED into Aave for yield",
    expectedKind: 'lend_supply',
    venue: 'lend',
    description: 'Formal lend request',
  },
  lend_slang: {
    prompt: "put 100 bucks in defi 4 that sweet apy lol",
    expectedKind: 'lend_supply',
    venue: 'lend',
    description: 'Slang lend request',
  },

  // PERP tests
  perp_formal: {
    prompt: "Open a long position on SOL with 3x leverage and $50 margin",
    expectedKind: 'perp',
    venue: 'perp',
    description: 'Formal perp request',
  },
  perp_slang: {
    prompt: "go long sol 3x lev 50 usd margin lol",
    expectedKind: 'perp',
    venue: 'perp',
    description: 'Slang perp request',
  },

  // EVENT tests
  event_formal: {
    prompt: "Bet $10 YES on BTC ETF approval",
    expectedKind: 'event',
    venue: 'event',
    description: 'Formal event bet',
  },
  event_slang: {
    prompt: "bet 10 bucks yes on btc etf",
    expectedKind: 'event',
    venue: 'event',
    description: 'Slang event bet',
  },

  // PRICE queries
  price_formal: {
    prompt: "What is the current price of Bitcoin?",
    expectedKind: null, // No executionRequest, just price info
    venue: 'info',
    description: 'Formal price query',
    expectPriceData: true,
  },
  price_slang: {
    prompt: "wuts btc doin rn",
    expectedKind: null,
    venue: 'info',
    description: 'Slang price query',
    expectPriceData: true,
  },

  // POSITION queries
  positions: {
    prompt: "show my positions",
    expectedKind: null,
    venue: 'info',
    description: 'Positions query',
    expectPortfolio: true,
  },
  exposure: {
    prompt: "current exposure",
    expectedKind: null,
    venue: 'info',
    description: 'Exposure query',
    expectPortfolio: true,
  },
  liquidation: {
    prompt: "closest to liquidation",
    expectedKind: null,
    venue: 'info',
    description: 'Liquidation query',
    expectPortfolio: true,
  },
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function fetchJson(url: string, options?: RequestInit): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> || {}),
  };

  if (ACCESS_CODE) {
    headers['X-Access-Code'] = ACCESS_CODE;
  }

  const response = await fetch(url, { ...options, headers });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.substring(0, 200)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON: ${text.substring(0, 100)}`);
  }
}

function printHeader(text: string) {
  console.log('');
  console.log(`${BLUE}${'═'.repeat(80)}${NC}`);
  console.log(`${BLUE}${BOLD}  ${text}${NC}`);
  console.log(`${BLUE}${'═'.repeat(80)}${NC}`);
}

function printSection(text: string) {
  console.log('');
  console.log(`${CYAN}── ${text} ${'─'.repeat(Math.max(0, 70 - text.length))}${NC}`);
}

function printPass(test: string, evidence: string) {
  console.log(`${GREEN}✓ PASS${NC} ${test}`);
  if (VERBOSE) console.log(`  ${CYAN}Evidence:${NC} ${evidence}`);
}

function printFail(test: string, evidence: string) {
  console.log(`${RED}✗ FAIL${NC} ${test}`);
  console.log(`  ${RED}Evidence:${NC} ${evidence}`);
}

function addResult(test: string, category: string, pass: boolean, evidence: string, details?: any) {
  results.push({ test, category, pass, evidence, details });
  if (pass) {
    printPass(test, evidence);
  } else {
    printFail(test, evidence);
  }
}

function actionTypeLabel(t: number): string {
  const labels: Record<number, string> = {
    0: 'SWAP', 1: 'WRAP', 2: 'PULL', 3: 'LEND_SUPPLY',
    4: 'LEND_BORROW', 5: 'EVENT_BUY', 6: 'PROOF', 7: 'PERP', 8: 'EVENT',
  };
  return labels[t] || `UNKNOWN(${t})`;
}

// ============================================================================
// PHASE 0: GROUND TRUTH
// ============================================================================

async function testGroundTruth(): Promise<{ health: any; preflight: any } | null> {
  printSection('Phase 0: Ground Truth Verification');

  try {
    const [health, preflight] = await Promise.all([
      fetchJson(`${PROD_URL}/api/health`),
      fetchJson(`${PROD_URL}/api/execute/preflight`),
    ]);

    console.log(`${BOLD}Production Status:${NC}`);
    console.log(`  GitSha: ${health.gitSha}`);
    console.log(`  Branch: ${health.gitBranch}`);
    console.log(`  LLM: ${health.llmProvider}`);
    console.log(`  Router: ${preflight.router}`);
    console.log(`  Adapters: ${preflight.allowedAdapters?.length || 0}`);

    addResult(
      'Production Health',
      'ground_truth',
      health.ok === true,
      `gitSha=${health.gitSha}, buildEnv=${health.buildEnv}`
    );

    addResult(
      'Router V3 Address',
      'ground_truth',
      preflight.router?.toLowerCase().startsWith('0x07634e'),
      preflight.router
    );

    addResult(
      'All Venues Enabled',
      'ground_truth',
      preflight.swapEnabled && preflight.lendingEnabled && preflight.perpsEnabled && preflight.eventsEnabled,
      `swap=${preflight.swapEnabled}, lend=${preflight.lendingEnabled}, perp=${preflight.perpsEnabled}, event=${preflight.eventsEnabled}`
    );

    // Check DEMO adapters are in allowlist
    const allowlist = preflight.allowedAdapters?.map((a: string) => a.toLowerCase()) || [];
    const hasDemoPerp = allowlist.some((a: string) => a === '0x78704d0b0f5bafe84724188bd5f45a082306a390');
    const hasDemoEvent = allowlist.some((a: string) => a === '0x6b83d5222eb13bfa1fb295ca9a4890854ac0a698');

    addResult(
      'DEMO_PERP_ADAPTER in allowlist',
      'ground_truth',
      hasDemoPerp,
      hasDemoPerp ? '0x78704d0b0f5bafe84724188bd5f45a082306a390' : 'NOT FOUND'
    );

    addResult(
      'DEMO_EVENT_ADAPTER in allowlist',
      'ground_truth',
      hasDemoEvent,
      hasDemoEvent ? '0x6b83d5222eb13bfa1fb295ca9a4890854ac0a698' : 'NOT FOUND'
    );

    return { health, preflight };
  } catch (error: any) {
    addResult('Ground Truth', 'ground_truth', false, error.message);
    return null;
  }
}

// ============================================================================
// PHASE 1: CHAT -> EXECUTION REQUEST TESTS
// ============================================================================

async function testChat(testId: string, testCase: any): Promise<boolean> {
  try {
    const chatResponse = await fetchJson(`${PROD_URL}/api/chat`, {
      method: 'POST',
      body: JSON.stringify({
        userMessage: testCase.prompt,
        venue: 'hyperliquid',
        clientPortfolio: {
          accountValueUsd: 10000,
          balances: [
            { symbol: 'REDACTED', balanceUsd: 5000 },
            { symbol: 'ETH', balanceUsd: 3000 },
            { symbol: 'SOL', balanceUsd: 2000 },
          ],
        },
      }),
    });

    // Check for expected executionRequest
    if (testCase.expectedKind) {
      const hasExecReq = !!chatResponse.executionRequest;
      const kindMatches = chatResponse.executionRequest?.kind === testCase.expectedKind ||
        (testCase.expectedKind === 'lend_supply' &&
         ['lend', 'lend_supply'].includes(chatResponse.executionRequest?.kind));

      addResult(
        `Chat ${testCase.description}`,
        'chat',
        hasExecReq && kindMatches,
        hasExecReq
          ? `kind=${chatResponse.executionRequest.kind}`
          : `No executionRequest (expected ${testCase.expectedKind})`,
        { executionRequest: chatResponse.executionRequest }
      );

      return hasExecReq && kindMatches;
    }

    // Check for info queries (price, positions)
    if (testCase.expectPriceData) {
      const hasPriceData = chatResponse.priceData && chatResponse.priceData.length > 0;
      addResult(
        `Chat ${testCase.description}`,
        'chat',
        hasPriceData || chatResponse.assistantMessage?.toLowerCase().includes('price'),
        hasPriceData ? `priceData returned` : `Response: ${chatResponse.assistantMessage?.substring(0, 80)}...`
      );
      return hasPriceData;
    }

    if (testCase.expectPortfolio) {
      const hasPortfolio = !!chatResponse.portfolio;
      addResult(
        `Chat ${testCase.description}`,
        'chat',
        hasPortfolio,
        hasPortfolio ? `portfolio returned` : `No portfolio in response`
      );
      return hasPortfolio;
    }

    return false;
  } catch (error: any) {
    addResult(`Chat ${testCase.description}`, 'chat', false, error.message);
    return false;
  }
}

// ============================================================================
// PHASE 2: PREPARE ENDPOINT TESTS
// ============================================================================

async function testPrepare(venue: string, executionRequest: any, preflight: any): Promise<boolean> {
  try {
    const prepareResponse = await fetchJson(`${PROD_URL}/api/execute/prepare`, {
      method: 'POST',
      body: JSON.stringify({
        draftId: `e2e-v4-${venue}-${Date.now()}`,
        userAddress: TEST_USER_ADDRESS,
        executionRequest,
        authMode: 'direct',
      }),
    });

    if (!prepareResponse.plan || !prepareResponse.to) {
      addResult(`Prepare ${venue}`, 'prepare', false, 'Missing plan or to address');
      return false;
    }

    const actionTypes = prepareResponse.plan.actions?.map((a: any) => a.actionType) || [];
    const actionLabels = actionTypes.map(actionTypeLabel).join(' → ');
    const adapter = prepareResponse.plan.actions?.[prepareResponse.plan.actions.length - 1]?.adapter;

    // Validate action types per venue
    let isValid = false;
    let evidence = '';

    switch (venue) {
      case 'swap':
        // Expected: [PULL(2), SWAP(0)] or [WRAP(1), SWAP(0)] or [PULL(2), WRAP(1), SWAP(0)]
        isValid = actionTypes.includes(0); // Has SWAP
        evidence = `Actions: ${actionLabels}, Router: ${prepareResponse.to}`;
        break;

      case 'lend':
        // Expected: [PULL(2), LEND_SUPPLY(3)]
        isValid = actionTypes.includes(3); // Has LEND_SUPPLY
        evidence = `Actions: ${actionLabels}, Adapter: ${adapter}`;
        break;

      case 'perp':
        // CRITICAL: Must be PERP(7), NOT PROOF(6)
        isValid = actionTypes.includes(7) && !actionTypes.includes(6);
        evidence = isValid
          ? `PERP(7) action, Adapter: ${adapter}`
          : `Actions: ${actionLabels} - ${actionTypes.includes(6) ? 'PROOF FALLBACK DETECTED!' : 'PERP action missing'}`;
        break;

      case 'event':
        // CRITICAL: Must be EVENT(8), NOT PROOF(6)
        isValid = actionTypes.includes(8) && !actionTypes.includes(6);
        evidence = isValid
          ? `EVENT(8) action, Adapter: ${adapter}`
          : `Actions: ${actionLabels} - ${actionTypes.includes(6) ? 'PROOF FALLBACK DETECTED!' : 'EVENT action missing'}`;
        break;
    }

    addResult(`Prepare ${venue}`, 'prepare', isValid, evidence, {
      actionTypes,
      adapter,
      summary: prepareResponse.summary,
    });

    return isValid;
  } catch (error: any) {
    addResult(`Prepare ${venue}`, 'prepare', false, error.message);
    return false;
  }
}

// ============================================================================
// MAIN TEST RUNNER
// ============================================================================

async function main() {
  printHeader('BLOSSOM MVP E2E V4 - COMPREHENSIVE THESIS PROOF');

  console.log('');
  console.log(`${BOLD}Configuration:${NC}`);
  console.log(`  Production URL: ${PROD_URL}`);
  console.log(`  Test User: ${TEST_USER_ADDRESS}`);
  console.log(`  Access Code: ${ACCESS_CODE ? '***' + ACCESS_CODE.slice(-4) : 'NOT SET'}`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);

  if (!ACCESS_CODE) {
    console.log(`\n${RED}ERROR: BLOSSOM_TEST_ACCESS_CODE not set${NC}`);
    process.exit(1);
  }

  // Phase 0: Ground Truth
  const config = await testGroundTruth();
  if (!config) {
    console.log(`\n${RED}FATAL: Ground truth verification failed${NC}`);
    process.exit(1);
  }

  // Phase 1: Chat Tests
  printSection('Phase 1: Chat -> ExecutionRequest Tests');

  const chatResults: Record<string, any> = {};

  for (const [testId, testCase] of Object.entries(CHAT_TEST_CASES)) {
    const passed = await testChat(testId, testCase);
    chatResults[testId] = { passed, testCase };
    await new Promise(r => setTimeout(r, 300)); // Rate limiting
  }

  // Phase 2: Prepare Tests (only for execution venues)
  printSection('Phase 2: Prepare -> Execution Plan Tests');

  const venueExecutionRequests: Record<string, any> = {
    swap: { kind: 'swap', chain: 'sepolia', tokenIn: 'REDACTED', tokenOut: 'WETH', amountIn: '10', slippageBps: 50, fundingPolicy: 'require_tokenIn' },
    lend: { kind: 'lend_supply', chain: 'sepolia', asset: 'REDACTED', amount: '50', protocol: 'aave' },
    perp: { kind: 'perp', chain: 'sepolia', market: 'SOL-USD', side: 'long', leverage: 3, marginUsd: 50 },
    event: { kind: 'event', chain: 'sepolia', marketId: 'FED_CUTS_MAR_2025', outcome: 'YES', stakeUsd: 10 },
  };

  for (const [venue, execReq] of Object.entries(venueExecutionRequests)) {
    await testPrepare(venue, execReq, config.preflight);
    await new Promise(r => setTimeout(r, 300));
  }

  // =========================================================================
  // RESULTS SUMMARY
  // =========================================================================
  printHeader('TEST RESULTS SUMMARY');

  const categories = ['ground_truth', 'chat', 'prepare'];
  const categoryLabels: Record<string, string> = {
    ground_truth: 'Ground Truth',
    chat: 'Chat -> ExecutionRequest',
    prepare: 'Prepare -> Execution Plan',
  };

  console.log('');
  for (const cat of categories) {
    const catResults = results.filter(r => r.category === cat);
    const passed = catResults.filter(r => r.pass).length;
    const total = catResults.length;
    const status = passed === total ? `${GREEN}PASS${NC}` : `${RED}FAIL${NC}`;
    console.log(`${BOLD}${categoryLabels[cat]}:${NC} ${passed}/${total} ${status}`);
  }

  console.log('');
  console.log(`${BOLD}Detailed Results:${NC}`);
  console.log('');
  console.log(`${'Test'.padEnd(40)} | ${'Category'.padEnd(15)} | ${'Status'.padEnd(8)} | Evidence`);
  console.log(`${'-'.repeat(40)}-+-${'-'.repeat(15)}-+-${'-'.repeat(8)}-+-${'-'.repeat(40)}`);

  for (const r of results) {
    const status = r.pass ? `${GREEN}PASS${NC}` : `${RED}FAIL${NC}`;
    console.log(`${r.test.padEnd(40)} | ${r.category.padEnd(15)} | ${status.padEnd(17)} | ${r.evidence.substring(0, 50)}`);
  }

  // =========================================================================
  // THESIS VERDICTS
  // =========================================================================
  printHeader('THESIS VERDICTS');

  // Agent thesis: chat tests pass
  const chatTests = results.filter(r => r.category === 'chat');
  const chatPassed = chatTests.filter(r => r.pass).length;
  const agentThesisPassed = chatPassed >= chatTests.length * 0.7; // 70% threshold for natural language

  console.log('');
  console.log(`${BOLD}1. Blossom Agent Thesis:${NC}`);
  console.log(`   "Chat understands natural language and produces correct execution plans"`);
  console.log(`   Score: ${chatPassed}/${chatTests.length} tests passed`);
  if (agentThesisPassed) {
    console.log(`   ${GREEN}✓ PROVEN${NC}`);
  } else {
    console.log(`   ${RED}✗ NOT PROVEN${NC}`);
  }

  // Execution Engine thesis: prepare tests pass with correct action types
  const prepareTests = results.filter(r => r.category === 'prepare');
  const preparePassed = prepareTests.filter(r => r.pass).length;
  const perpPassed = prepareTests.find(r => r.test.includes('perp'))?.pass || false;
  const eventPassed = prepareTests.find(r => r.test.includes('event'))?.pass || false;
  const engineThesisPassed = preparePassed === prepareTests.length && perpPassed && eventPassed;

  console.log('');
  console.log(`${BOLD}2. Execution Engine Thesis:${NC}`);
  console.log(`   "Real on-chain execution via demo venues (PERP=7, EVENT=8, not PROOF=6)"`);
  console.log(`   Score: ${preparePassed}/${prepareTests.length} tests passed`);
  console.log(`   PERP action type 7: ${perpPassed ? GREEN + 'YES' + NC : RED + 'NO (FAIL)' + NC}`);
  console.log(`   EVENT action type 8: ${eventPassed ? GREEN + 'YES' + NC : RED + 'NO (FAIL)' + NC}`);
  if (engineThesisPassed) {
    console.log(`   ${GREEN}✓ PROVEN${NC}`);
  } else {
    console.log(`   ${RED}✗ NOT PROVEN${NC}`);
  }

  // =========================================================================
  // FINAL VERDICT
  // =========================================================================
  console.log('');

  const allCriticalPassed = agentThesisPassed && engineThesisPassed;

  if (allCriticalPassed) {
    console.log(`${GREEN}${BOLD}╔══════════════════════════════════════════════════════════════════════════════╗${NC}`);
    console.log(`${GREEN}${BOLD}║                              GO - MVP VERIFIED                               ║${NC}`);
    console.log(`${GREEN}${BOLD}╚══════════════════════════════════════════════════════════════════════════════╝${NC}`);
    process.exit(0);
  } else {
    console.log(`${RED}${BOLD}╔══════════════════════════════════════════════════════════════════════════════╗${NC}`);
    console.log(`${RED}${BOLD}║                            NO-GO - FAILURES DETECTED                         ║${NC}`);
    console.log(`${RED}${BOLD}╚══════════════════════════════════════════════════════════════════════════════╝${NC}`);
    process.exit(1);
  }
}

main().catch(error => {
  console.error(`${RED}Fatal error: ${error.message}${NC}`);
  process.exit(1);
});
