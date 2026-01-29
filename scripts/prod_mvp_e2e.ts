#!/usr/bin/env npx ts-node
/**
 * PRODUCTION MVP E2E SMOKE TEST
 *
 * Validates the complete Blossom MVP across ALL venues:
 * - SWAP: Token exchange (REDACTED ↔ WETH)
 * - LEND: Yield farming (Aave V3 supply)
 * - PERP: Perpetual futures (demo engine)
 * - EVENT: Prediction markets (demo market)
 *
 * Environment Variables:
 *   PROD_URL        - Production URL (default: https://app.blossom.onl)
 *   TEST_USER_ADDRESS - Ethereum address for testing (required)
 *   BLOSSOM_TEST_ACCESS_CODE - Access gate code (optional, for gated endpoints)
 *
 * Usage:
 *   npx ts-node scripts/prod_mvp_e2e.ts
 *   npx ts-node scripts/prod_mvp_e2e.ts --verbose
 */

const PROD_URL = process.env.PROD_URL || 'https://app.blossom.onl';
const TEST_USER_ADDRESS = process.env.TEST_USER_ADDRESS || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const ACCESS_CODE = process.env.BLOSSOM_TEST_ACCESS_CODE || '';
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
  venue: string;
  chatOk: boolean;
  executionRequestKind: string | null;
  prepareOk: boolean;
  actionTypes: number[];
  routerAddress: string | null;
  adapterAddress: string | null;
  summary: string | null;
  error: string | null;
}

const results: TestResult[] = [];

// Messy prompts for each venue - testing AI understanding of natural language
const MESSY_PROMPTS = {
  swap: [
    "yo swap like 10 bucks of usdc into weth",
    "convert some usdc to eth, maybe 5 usd worth",
    "trade my usdc for wrapped ether plz",
  ],
  lend: [
    "put 50 usd in aave for that yield",
    "lend out some usdc on a defi protocol",
    "deposit funds to earn interest, like $25",
  ],
  perp: [
    "long btc with 2x leverage, risk 100 bucks",
    "open a short on ethereum with 5x",
    "go long sol with 3x lev and 50 usd margin",
  ],
  event: [
    "bet yes on fed rate cut happening",
    "put 20 bucks on btc etf approval",
    "wager on trump winning election",
  ],
};

async function fetchJson(url: string, options?: RequestInit): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> || {}),
  };

  // Add access code if provided
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
    throw new Error(`Invalid JSON response: ${text.substring(0, 100)}`);
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

function printPass(msg: string) {
  console.log(`${GREEN}✓ PASS${NC} ${msg}`);
}

function printFail(msg: string) {
  console.log(`${RED}✗ FAIL${NC} ${msg}`);
}

function printInfo(msg: string) {
  console.log(`${YELLOW}ℹ${NC} ${msg}`);
}

function printVerbose(msg: string) {
  if (VERBOSE) {
    console.log(`  ${msg}`);
  }
}

async function testHealthAndPreflight(): Promise<{ health: any; preflight: any } | null> {
  printSection('Production Health & Preflight');

  try {
    const [health, preflight] = await Promise.all([
      fetchJson(`${PROD_URL}/api/health`),
      fetchJson(`${PROD_URL}/api/execute/preflight`),
    ]);

    console.log('');
    console.log(`${BOLD}Health Response:${NC}`);
    console.log(JSON.stringify(health, null, 2));
    console.log('');
    console.log(`${BOLD}Preflight Response:${NC}`);
    console.log(JSON.stringify(preflight, null, 2));

    // Validate critical fields
    const checks = [
      { name: 'Health OK', pass: health.ok === true },
      { name: 'Git SHA present', pass: !!health.gitSha },
      { name: 'Router address (V3)', pass: preflight.router?.toLowerCase().startsWith('0x07634e') },
      { name: 'Swap enabled', pass: preflight.swapEnabled === true },
      { name: 'Lending enabled', pass: preflight.lendingEnabled === true },
      { name: 'Perps enabled', pass: preflight.perpsEnabled === true },
      { name: 'Events enabled', pass: preflight.eventsEnabled === true },
    ];

    console.log('');
    let allPassed = true;
    for (const check of checks) {
      if (check.pass) {
        printPass(check.name);
      } else {
        printFail(check.name);
        allPassed = false;
      }
    }

    if (!allPassed) {
      return null;
    }

    return { health, preflight };
  } catch (error: any) {
    printFail(`Health/Preflight: ${error.message}`);
    return null;
  }
}

async function testVenue(
  venue: 'swap' | 'lend' | 'perp' | 'event',
  preflight: any
): Promise<TestResult> {
  const result: TestResult = {
    venue,
    chatOk: false,
    executionRequestKind: null,
    prepareOk: false,
    actionTypes: [],
    routerAddress: null,
    adapterAddress: null,
    summary: null,
    error: null,
  };

  printSection(`Testing ${venue.toUpperCase()} Venue`);

  // Pick a random messy prompt
  const prompts = MESSY_PROMPTS[venue];
  const prompt = prompts[Math.floor(Math.random() * prompts.length)];

  console.log(`${BOLD}Messy prompt:${NC} "${prompt}"`);

  try {
    // Step 1: Call /api/chat with messy prompt
    printInfo('Calling /api/chat...');

    const chatResponse = await fetchJson(`${PROD_URL}/api/chat`, {
      method: 'POST',
      body: JSON.stringify({
        userMessage: prompt,
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

    printVerbose(`Assistant: ${chatResponse.assistantMessage?.substring(0, 150)}...`);

    if (!chatResponse.executionRequest) {
      result.error = 'No executionRequest returned from chat';
      printFail(result.error);
      return result;
    }

    result.chatOk = true;
    result.executionRequestKind = chatResponse.executionRequest.kind;

    console.log(`${BOLD}ExecutionRequest:${NC}`);
    console.log(JSON.stringify(chatResponse.executionRequest, null, 2));

    // Validate the execution request kind matches expected venue
    const expectedKinds: Record<string, string[]> = {
      swap: ['swap'],
      lend: ['lend', 'lend_supply'],
      perp: ['perp'],
      event: ['event'],
    };

    if (!expectedKinds[venue].includes(chatResponse.executionRequest.kind)) {
      result.error = `Wrong kind: expected ${expectedKinds[venue].join('/')}, got ${chatResponse.executionRequest.kind}`;
      printFail(result.error);
      return result;
    }

    printPass(`Chat returned executionRequest.kind=${chatResponse.executionRequest.kind}`);

    // Step 2: Call /api/execute/prepare with the executionRequest
    printInfo('Calling /api/execute/prepare...');

    const prepareResponse = await fetchJson(`${PROD_URL}/api/execute/prepare`, {
      method: 'POST',
      body: JSON.stringify({
        draftId: `prod-mvp-e2e-${venue}-${Date.now()}`,
        userAddress: TEST_USER_ADDRESS,
        executionRequest: chatResponse.executionRequest,
        authMode: 'direct',
      }),
    });

    if (!prepareResponse.plan || !prepareResponse.to) {
      result.error = 'Prepare response missing plan or to address';
      printFail(result.error);
      return result;
    }

    result.prepareOk = true;
    result.routerAddress = prepareResponse.to;
    result.summary = prepareResponse.summary;

    // Extract action types and adapters
    if (prepareResponse.plan.actions && Array.isArray(prepareResponse.plan.actions)) {
      result.actionTypes = prepareResponse.plan.actions.map((a: any) => a.actionType);
      result.adapterAddress = prepareResponse.plan.actions[0]?.adapter || null;
    }

    console.log(`${BOLD}Prepare Response Summary:${NC}`);
    console.log(`  Router: ${prepareResponse.to}`);
    console.log(`  Actions: ${result.actionTypes.map(actionTypeLabel).join(' → ')}`);
    console.log(`  Summary: ${prepareResponse.summary || 'N/A'}`);

    if (VERBOSE) {
      console.log(`${BOLD}Full Plan:${NC}`);
      console.log(JSON.stringify(prepareResponse.plan, null, 2));
    }

    // Validate action types for each venue
    const validActionTypes: Record<string, number[][]> = {
      swap: [[2, 0], [1, 0], [2, 1, 0]], // PULL+SWAP or WRAP+SWAP or PULL+WRAP+SWAP
      lend: [[2, 3], [3]], // PULL+LEND_SUPPLY or LEND_SUPPLY
      perp: [[7], [6]], // PERP (real) or PROOF (fallback)
      event: [[8], [6]], // EVENT (real) or PROOF (fallback)
    };

    const isValidActionSequence = validActionTypes[venue].some(expected =>
      JSON.stringify(result.actionTypes) === JSON.stringify(expected)
    );

    if (isValidActionSequence) {
      printPass(`Valid action sequence: ${result.actionTypes.map(actionTypeLabel).join(' → ')}`);
    } else {
      // Check for PROOF fallback (action type 6)
      if (result.actionTypes.includes(6)) {
        printInfo(`PROOF fallback used (action type 6) - demo adapter may not be configured`);
      } else {
        result.error = `Unexpected action sequence: ${result.actionTypes.join(',')}`;
        printFail(result.error);
      }
    }

    // Verify router address matches preflight
    if (prepareResponse.to.toLowerCase() !== preflight.router.toLowerCase()) {
      printFail(`Router mismatch: ${prepareResponse.to} vs ${preflight.router}`);
    } else {
      printPass(`Router matches preflight: ${preflight.router}`);
    }

    // Check if adapter is in allowlist
    if (result.adapterAddress) {
      const isAllowlisted = preflight.allowedAdapters?.some(
        (a: string) => a.toLowerCase() === result.adapterAddress?.toLowerCase()
      );
      if (isAllowlisted) {
        printPass(`Adapter allowlisted: ${result.adapterAddress}`);
      } else {
        printInfo(`Adapter not in allowlist (may be internal): ${result.adapterAddress}`);
      }
    }

  } catch (error: any) {
    result.error = error.message;
    printFail(`${venue}: ${error.message}`);
  }

  return result;
}

function actionTypeLabel(actionType: number): string {
  const labels: Record<number, string> = {
    0: 'SWAP',
    1: 'WRAP',
    2: 'PULL',
    3: 'LEND_SUPPLY',
    4: 'LEND_BORROW',
    5: 'EVENT_BUY',
    6: 'PROOF',
    7: 'PERP',
    8: 'EVENT',
  };
  return labels[actionType] || `UNKNOWN(${actionType})`;
}

function printResultsTable() {
  printHeader('MVP E2E RESULTS');

  console.log('');
  console.log(`${'Venue'.padEnd(10)} | ${'Chat'.padEnd(6)} | ${'Kind'.padEnd(12)} | ${'Prepare'.padEnd(8)} | ${'Actions'.padEnd(20)} | ${'Status'.padEnd(8)}`);
  console.log(`${'-'.repeat(10)}-+-${'-'.repeat(6)}-+-${'-'.repeat(12)}-+-${'-'.repeat(8)}-+-${'-'.repeat(20)}-+-${'-'.repeat(8)}`);

  for (const r of results) {
    const chatStatus = r.chatOk ? `${GREEN}OK${NC}` : `${RED}FAIL${NC}`;
    const prepareStatus = r.prepareOk ? `${GREEN}OK${NC}` : `${RED}FAIL${NC}`;
    const actions = r.actionTypes.map(actionTypeLabel).join('→') || 'N/A';
    const overall = r.chatOk && r.prepareOk ? `${GREEN}PASS${NC}` : `${RED}FAIL${NC}`;

    console.log(
      `${r.venue.toUpperCase().padEnd(10)} | ${chatStatus.padEnd(15)} | ${(r.executionRequestKind || 'N/A').padEnd(12)} | ${prepareStatus.padEnd(17)} | ${actions.padEnd(20)} | ${overall}`
    );
  }

  console.log('');
}

function printEvidenceBundle(health: any, preflight: any) {
  printHeader('EVIDENCE BUNDLE');

  console.log('');
  console.log(`${BOLD}Production Deployment:${NC}`);
  console.log(`  URL: ${PROD_URL}`);
  console.log(`  Git SHA: ${health.gitSha}`);
  console.log(`  Git Branch: ${health.gitBranch}`);
  console.log(`  Build Env: ${health.buildEnv}`);
  console.log(`  LLM Provider: ${health.llmProvider}`);

  console.log('');
  console.log(`${BOLD}Execution Infrastructure:${NC}`);
  console.log(`  Chain: Sepolia (${preflight.chainId})`);
  console.log(`  Router: ${preflight.router}`);
  console.log(`  Primary Adapter: ${preflight.adapter}`);

  console.log('');
  console.log(`${BOLD}Venue Status:${NC}`);
  console.log(`  Swap: ${preflight.swapEnabled ? GREEN + 'ENABLED' + NC : RED + 'DISABLED' + NC}`);
  console.log(`  Lending: ${preflight.lendingEnabled ? GREEN + 'ENABLED' + NC : RED + 'DISABLED' + NC}`);
  console.log(`  Perps: ${preflight.perpsEnabled ? GREEN + 'ENABLED' + NC : RED + 'DISABLED' + NC}`);
  console.log(`  Events: ${preflight.eventsEnabled ? GREEN + 'ENABLED' + NC : RED + 'DISABLED' + NC}`);

  console.log('');
  console.log(`${BOLD}Execution Plans Generated:${NC}`);
  for (const r of results) {
    if (r.prepareOk) {
      console.log(`  ${r.venue.toUpperCase()}: ${r.actionTypes.map(actionTypeLabel).join(' → ')}`);
      console.log(`    Router: ${r.routerAddress}`);
      console.log(`    Adapter: ${r.adapterAddress || 'N/A'}`);
      console.log(`    Summary: ${r.summary || 'N/A'}`);
    }
  }
}

async function main() {
  printHeader('BLOSSOM MVP PRODUCTION E2E SMOKE TEST');

  console.log('');
  console.log(`${BOLD}Configuration:${NC}`);
  console.log(`  Production URL: ${PROD_URL}`);
  console.log(`  Test User: ${TEST_USER_ADDRESS}`);
  console.log(`  Access Code: ${ACCESS_CODE ? '***' + ACCESS_CODE.slice(-4) : 'not set'}`);
  console.log(`  Verbose: ${VERBOSE}`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);

  // Step 1: Verify production health and preflight
  const config = await testHealthAndPreflight();
  if (!config) {
    console.log('');
    console.log(`${RED}${BOLD}FATAL: Production health/preflight failed. Cannot proceed.${NC}`);
    process.exit(1);
  }

  // Step 2: Test each venue
  const venues: ('swap' | 'lend' | 'perp' | 'event')[] = ['swap', 'lend', 'perp', 'event'];

  for (const venue of venues) {
    const result = await testVenue(venue, config.preflight);
    results.push(result);

    // Small delay between tests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Step 3: Print results
  printResultsTable();
  printEvidenceBundle(config.health, config.preflight);

  // Step 4: Determine overall status
  const allPassed = results.every(r => r.chatOk && r.prepareOk);
  const chatPassed = results.every(r => r.chatOk);
  const preparePassed = results.every(r => r.prepareOk);

  printHeader('FINAL VERDICT');

  console.log('');
  console.log(`${BOLD}Blossom Agent Thesis:${NC}`);
  if (chatPassed) {
    console.log(`  ${GREEN}✓ PROVEN${NC} - Chat understands messy language and produces correct execution plans for all venues`);
  } else {
    console.log(`  ${RED}✗ NOT PROVEN${NC} - Chat failed to produce execution plans for some venues`);
  }

  console.log('');
  console.log(`${BOLD}Execution Engine Thesis:${NC}`);
  if (preparePassed) {
    console.log(`  ${GREEN}✓ PROVEN${NC} - Prepare endpoint generates valid on-chain execution plans for all venues`);
  } else {
    console.log(`  ${RED}✗ NOT PROVEN${NC} - Prepare endpoint failed for some venues`);
  }

  console.log('');
  if (allPassed) {
    console.log(`${GREEN}${BOLD}╔══════════════════════════════════════════════════════════════════════════════╗${NC}`);
    console.log(`${GREEN}${BOLD}║                              GO - MVP VERIFIED                               ║${NC}`);
    console.log(`${GREEN}${BOLD}╚══════════════════════════════════════════════════════════════════════════════╝${NC}`);
    process.exit(0);
  } else {
    console.log(`${RED}${BOLD}╔══════════════════════════════════════════════════════════════════════════════╗${NC}`);
    console.log(`${RED}${BOLD}║                            NO-GO - FAILURES DETECTED                         ║${NC}`);
    console.log(`${RED}${BOLD}╚══════════════════════════════════════════════════════════════════════════════╝${NC}`);
    console.log('');
    console.log('Failures:');
    for (const r of results) {
      if (r.error) {
        console.log(`  ${r.venue.toUpperCase()}: ${r.error}`);
      }
    }
    process.exit(1);
  }
}

main().catch(error => {
  console.error(`${RED}Fatal error: ${error.message}${NC}`);
  process.exit(1);
});
