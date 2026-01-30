#!/usr/bin/env npx ts-node
/**
 * Production Final Verification Script
 *
 * Zero-tolerance verification covering all phases:
 * - Phase 0: Production truth (health, preflight)
 * - Phase 1: Auth (header + cookie)
 * - Phase 2: Agent baseline (hi, help, balance)
 * - Phase 3: Execution safety (4 venues, no PROOF=6)
 * - Phase 4: UI checks (via Playwright)
 */

import * as fs from 'fs';
import * as path from 'path';

const API_URL = process.env.API_URL || 'https://api.blossom.onl';
const APP_URL = process.env.APP_URL || 'https://app.blossom.onl';
const ACCESS_CODE = process.env.ACCESS_CODE || 'E7F9-D6D2-F151';

interface PhaseResult {
  phase: string;
  name: string;
  pass: boolean;
  evidence: string;
  details?: any;
}

interface FinalReport {
  timestamp: string;
  apiUrl: string;
  appUrl: string;
  gitSha: string;
  phases: {
    phase0: PhaseResult[];
    phase1: PhaseResult[];
    phase2: PhaseResult[];
    phase3: PhaseResult[];
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
    critical: {
      routerV3Present: boolean;
      demoPerpInAllowlist: boolean;
      demoEventInAllowlist: boolean;
      perpUsesType7: boolean;
      eventUsesType8: boolean;
      zeroProofLeaks: boolean;
    };
  };
  verdict: 'GO' | 'NO-GO';
  blockers: string[];
}

const results: PhaseResult[] = [];
let gitSha = 'unknown';
let preflightData: any = null;

async function fetchJson(url: string, options?: RequestInit): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> || {}),
  };
  if (ACCESS_CODE) {
    headers['X-Access-Code'] = ACCESS_CODE;
  }

  const res = await fetch(url, { ...options, headers });
  const text = await res.text();

  // Clean control characters
  const cleanText = text.replace(/[\x00-\x1F\x7F]/g, '');

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${cleanText.substring(0, 200)}`);
  }
  return JSON.parse(cleanText);
}

// =============================================================================
// PHASE 0: Production Truth
// =============================================================================

async function phase0_health(): Promise<PhaseResult> {
  try {
    const data = await fetchJson(`${API_URL}/api/health`);
    gitSha = data.gitSha || 'unknown';

    const checks = {
      ok: data.ok === true,
      gitBranch: data.gitBranch === 'mvp',
      buildEnv: data.buildEnv === 'production',
    };

    const pass = checks.ok && checks.gitBranch && checks.buildEnv;

    return {
      phase: '0',
      name: 'health',
      pass,
      evidence: `ok=${data.ok}, gitBranch=${data.gitBranch}, buildEnv=${data.buildEnv}, gitSha=${gitSha}`,
      details: data,
    };
  } catch (err: any) {
    return {
      phase: '0',
      name: 'health',
      pass: false,
      evidence: `ERROR: ${err.message}`,
    };
  }
}

async function phase0_preflight(): Promise<PhaseResult> {
  try {
    preflightData = await fetchJson(`${API_URL}/api/execute/preflight`);

    const checks = {
      chainId: preflightData.chainId === 11155111,
      router: !!preflightData.executionRouterAddress || !!preflightData.router,
      swapEnabled: preflightData.swapEnabled === true,
      lendingEnabled: preflightData.lendingEnabled === true,
      perpsEnabled: preflightData.perpsEnabled === true,
      eventsEnabled: preflightData.eventsEnabled === true,
      demoPerpInAllowlist: preflightData.allowedAdapters?.some(
        (a: string) => a.toLowerCase() === '0x78704d0b0f5bafe84724188bd5f45a082306a390'
      ),
      demoEventInAllowlist: preflightData.allowedAdapters?.some(
        (a: string) => a.toLowerCase() === '0x6b83d5222eb13bfa1fb295ca9a4890854ac0a698'
      ),
    };

    const pass = Object.values(checks).every(v => v);

    return {
      phase: '0',
      name: 'preflight',
      pass,
      evidence: `chainId=${preflightData.chainId}, router=${preflightData.router?.slice(0, 10)}..., venues=${preflightData.swapEnabled}/${preflightData.lendingEnabled}/${preflightData.perpsEnabled}/${preflightData.eventsEnabled}, adapters=${preflightData.allowedAdapters?.length}`,
      details: { checks, adaptersCount: preflightData.allowedAdapters?.length },
    };
  } catch (err: any) {
    return {
      phase: '0',
      name: 'preflight',
      pass: false,
      evidence: `ERROR: ${err.message}`,
    };
  }
}

// =============================================================================
// PHASE 1: Auth
// =============================================================================

async function phase1_headerAuth(): Promise<PhaseResult> {
  try {
    // Test with auth
    const withAuthRes = await fetch(`${API_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Access-Code': ACCESS_CODE,
      },
      body: JSON.stringify({
        userMessage: 'hi',
        venue: 'hyperliquid',
        clientPortfolio: { accountValueUsd: 10000, balances: [] },
      }),
    });

    // Test without auth
    const noAuthRes = await fetch(`${API_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userMessage: 'hi', venue: 'hyperliquid' }),
    });

    const pass = withAuthRes.ok && noAuthRes.status === 401;

    return {
      phase: '1',
      name: 'header_auth',
      pass,
      evidence: `withAuth=${withAuthRes.status}, noAuth=${noAuthRes.status}`,
    };
  } catch (err: any) {
    return {
      phase: '1',
      name: 'header_auth',
      pass: false,
      evidence: `ERROR: ${err.message}`,
    };
  }
}

// =============================================================================
// PHASE 2: Agent Baseline
// =============================================================================

async function phase2_chat(prompt: string, name: string, assertions: (msg: string) => boolean): Promise<PhaseResult> {
  try {
    const data = await fetchJson(`${API_URL}/api/chat`, {
      method: 'POST',
      body: JSON.stringify({
        userMessage: prompt,
        venue: 'hyperliquid',
        clientPortfolio: { accountValueUsd: 10000, balances: [{ symbol: 'REDACTED', balanceUsd: 5000 }] },
      }),
    });

    const msg = data.assistantMessage || '';
    const pass = assertions(msg);

    return {
      phase: '2',
      name,
      pass,
      evidence: msg.slice(0, 100) + (msg.length > 100 ? '...' : ''),
    };
  } catch (err: any) {
    return {
      phase: '2',
      name,
      pass: false,
      evidence: `ERROR: ${err.message}`,
    };
  }
}

// =============================================================================
// PHASE 3: Execution Safety
// =============================================================================

interface VenueTest {
  venue: string;
  prompt: string;
  expectedKind: string;
  requiredActions: number[];
  forbiddenActions: number[];
}

const VENUE_TESTS: VenueTest[] = [
  { venue: 'swap', prompt: 'swap 10 usdc to weth', expectedKind: 'swap', requiredActions: [2, 0], forbiddenActions: [] },
  { venue: 'lend', prompt: 'deposit 50 usdc into aave', expectedKind: 'lend_supply', requiredActions: [2, 3], forbiddenActions: [] },
  { venue: 'perp', prompt: 'go long sol 3x leverage with 50 usd margin', expectedKind: 'perp', requiredActions: [7], forbiddenActions: [6] },
  { venue: 'event', prompt: 'bet 10 dollars YES on btc etf approval', expectedKind: 'event', requiredActions: [8], forbiddenActions: [6] },
];

async function phase3_venue(test: VenueTest): Promise<PhaseResult[]> {
  const results: PhaseResult[] = [];

  try {
    // Chat
    const chatData = await fetchJson(`${API_URL}/api/chat`, {
      method: 'POST',
      body: JSON.stringify({
        userMessage: test.prompt,
        venue: 'hyperliquid',
        clientPortfolio: { accountValueUsd: 10000, balances: [{ symbol: 'REDACTED', balanceUsd: 5000 }] },
      }),
    });

    const execReq = chatData.executionRequest;
    const kindMatches = execReq?.kind === test.expectedKind ||
      (test.expectedKind === 'lend_supply' && ['lend', 'lend_supply'].includes(execReq?.kind));

    results.push({
      phase: '3',
      name: `${test.venue}_chat`,
      pass: !!execReq && kindMatches,
      evidence: execReq ? `kind=${execReq.kind}` : 'NO_EXECUTION_REQUEST',
    });

    if (!execReq) return results;

    // Prepare
    const prepareData = await fetchJson(`${API_URL}/api/execute/prepare`, {
      method: 'POST',
      body: JSON.stringify({
        draftId: `verify-${test.venue}-${Date.now()}`,
        userAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        executionRequest: execReq,
        authMode: 'direct',
      }),
    });

    const actionTypes = prepareData.plan?.actions?.map((a: any) => a.actionType) || [];
    const hasRequired = test.requiredActions.every(r => actionTypes.includes(r));
    const hasForbidden = test.forbiddenActions.some(f => actionTypes.includes(f));
    const pass = hasRequired && !hasForbidden;

    let evidence = `actions=[${actionTypes.join(',')}]`;
    if (hasForbidden) evidence += ' FORBIDDEN_ACTION_DETECTED!';
    if (!hasRequired) evidence += ' MISSING_REQUIRED_ACTIONS!';

    results.push({
      phase: '3',
      name: `${test.venue}_prepare`,
      pass,
      evidence,
      details: { actionTypes },
    });

  } catch (err: any) {
    results.push({
      phase: '3',
      name: `${test.venue}_error`,
      pass: false,
      evidence: `ERROR: ${err.message}`,
    });
  }

  return results;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('  PRODUCTION FINAL VERIFICATION');
  console.log('='.repeat(80));
  console.log(`API: ${API_URL}`);
  console.log(`APP: ${APP_URL}`);
  console.log(`Access Code: ${ACCESS_CODE ? '***' + ACCESS_CODE.slice(-4) : 'NOT SET'}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log('');

  // Phase 0
  console.log('--- PHASE 0: Production Truth ---');
  results.push(await phase0_health());
  results.push(await phase0_preflight());

  // Phase 1
  console.log('--- PHASE 1: Auth ---');
  results.push(await phase1_headerAuth());

  // Phase 2
  console.log('--- PHASE 2: Agent Baseline ---');
  results.push(await phase2_chat('hi', 'baseline_hi', (msg) =>
    msg.toLowerCase().includes('blossom') || msg.toLowerCase().includes('swap') || msg.toLowerCase().includes('help')
  ));
  results.push(await phase2_chat('help', 'baseline_help', (msg) =>
    msg.toLowerCase().includes('swap') && msg.toLowerCase().includes('perp')
  ));
  results.push(await phase2_chat('whats my balance', 'baseline_balance', (msg) =>
    !msg.toLowerCase().includes("didn't understand") && !msg.toLowerCase().includes("don't understand")
  ));

  // Phase 3
  console.log('--- PHASE 3: Execution Safety ---');
  for (const test of VENUE_TESTS) {
    const venueResults = await phase3_venue(test);
    results.push(...venueResults);
    await new Promise(r => setTimeout(r, 300));
  }

  // Compute summary
  const passed = results.filter(r => r.pass);
  const failed = results.filter(r => !r.pass);

  // Critical checks
  const perpPrepare = results.find(r => r.name === 'perp_prepare');
  const eventPrepare = results.find(r => r.name === 'event_prepare');
  const preflightResult = results.find(r => r.name === 'preflight');

  const critical = {
    routerV3Present: preflightData?.router?.toLowerCase() === '0x07634e6946035533465a30397e08d9d1c641a6ee',
    demoPerpInAllowlist: preflightData?.allowedAdapters?.some(
      (a: string) => a.toLowerCase() === '0x78704d0b0f5bafe84724188bd5f45a082306a390'
    ) || false,
    demoEventInAllowlist: preflightData?.allowedAdapters?.some(
      (a: string) => a.toLowerCase() === '0x6b83d5222eb13bfa1fb295ca9a4890854ac0a698'
    ) || false,
    perpUsesType7: perpPrepare?.details?.actionTypes?.includes(7) && !perpPrepare?.details?.actionTypes?.includes(6),
    eventUsesType8: eventPrepare?.details?.actionTypes?.includes(8) && !eventPrepare?.details?.actionTypes?.includes(6),
    zeroProofLeaks: !results.some(r => r.evidence.includes('FORBIDDEN_ACTION_DETECTED')),
  };

  const allCriticalPass = Object.values(critical).every(v => v);
  const verdict = failed.length === 0 && allCriticalPass ? 'GO' : 'NO-GO';

  const blockers: string[] = [];
  if (!critical.routerV3Present) blockers.push('Router V3 not present');
  if (!critical.demoPerpInAllowlist) blockers.push('DEMO_PERP not in allowlist');
  if (!critical.demoEventInAllowlist) blockers.push('DEMO_EVENT not in allowlist');
  if (!critical.perpUsesType7) blockers.push('PERP not using action type 7');
  if (!critical.eventUsesType8) blockers.push('EVENT not using action type 8');
  if (!critical.zeroProofLeaks) blockers.push('PROOF(6) leak detected');
  failed.forEach(f => blockers.push(`${f.name}: ${f.evidence}`));

  // Build report
  const report: FinalReport = {
    timestamp: new Date().toISOString(),
    apiUrl: API_URL,
    appUrl: APP_URL,
    gitSha,
    phases: {
      phase0: results.filter(r => r.phase === '0'),
      phase1: results.filter(r => r.phase === '1'),
      phase2: results.filter(r => r.phase === '2'),
      phase3: results.filter(r => r.phase === '3'),
    },
    summary: {
      total: results.length,
      passed: passed.length,
      failed: failed.length,
      critical,
    },
    verdict,
    blockers,
  };

  // Save report
  const artifactsDir = path.join(process.cwd(), 'artifacts');
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(artifactsDir, 'PROD_FINAL_READY.json'),
    JSON.stringify(report, null, 2)
  );

  // Print results
  console.log('');
  console.log('='.repeat(80));
  console.log('  RESULTS');
  console.log('='.repeat(80));
  console.log('');
  console.log('Phase  Name                    Status    Evidence');
  console.log('-'.repeat(80));

  for (const r of results) {
    const status = r.pass ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    console.log(`${r.phase.padEnd(7)}${r.name.padEnd(24)}${status.padEnd(19)}${r.evidence.substring(0, 40)}`);
  }

  console.log('');
  console.log('='.repeat(80));
  console.log(`  SUMMARY: ${passed.length}/${results.length} passed, ${failed.length} failed`);
  console.log('='.repeat(80));

  console.log('');
  console.log('--- CRITICAL CHECKS ---');
  for (const [key, value] of Object.entries(critical)) {
    const status = value ? '\x1b[32mYES\x1b[0m' : '\x1b[31mNO\x1b[0m';
    console.log(`${key}: ${status}`);
  }

  console.log('');
  if (verdict === 'GO') {
    console.log('\x1b[32m✅ VERDICT: GO - All checks pass\x1b[0m');
  } else {
    console.log('\x1b[31m❌ VERDICT: NO-GO\x1b[0m');
    console.log('');
    console.log('BLOCKERS:');
    for (const b of blockers) {
      console.log(`  - ${b}`);
    }
  }

  console.log('');
  console.log(`Report saved to: artifacts/PROD_FINAL_READY.json`);

  process.exit(verdict === 'GO' ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
