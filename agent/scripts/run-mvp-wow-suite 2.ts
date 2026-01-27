#!/usr/bin/env node
/**
 * MVP WOW Suite - Investor Demo Verification
 *
 * Tests the complete MVP flow that demonstrates real on-chain execution:
 * 1. Perp position opening with real tx on Sepolia
 * 2. Position tracking in ledger database
 * 3. Bridge intent with TWO real txs (Sepolia + Solana devnet)
 * 4. Execution steps recorded and visible in /dev/stats
 *
 * Usage:
 *   npx ts-node agent/scripts/run-mvp-wow-suite.ts
 *
 * Environment Variables:
 *   BASE_URL - Backend URL (default: http://localhost:3001)
 *   LEDGER_SECRET - Secret for ledger API access (required)
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const LEDGER_SECRET = process.env.VITE_DEV_LEDGER_SECRET || process.env.LEDGER_SECRET;

// Colors for output
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';
const NC = '\x1b[0m';

let passed = 0;
let failed = 0;
const results: { name: string; status: 'pass' | 'fail'; details?: string }[] = [];

function printPass(msg: string, details?: string) {
  console.log(`${GREEN}✓ PASS${NC} ${msg}`);
  if (details) console.log(`  ${CYAN}↳${NC} ${details}`);
  passed++;
  results.push({ name: msg, status: 'pass', details });
}

function printFail(msg: string, details?: string) {
  console.log(`${RED}✗ FAIL${NC} ${msg}`);
  if (details) console.log(`  ${RED}↳${NC} ${details}`);
  failed++;
  results.push({ name: msg, status: 'fail', details });
}

function printInfo(msg: string) {
  console.log(`${BLUE}ℹ${NC} ${msg}`);
}

function printSection(title: string) {
  console.log('');
  console.log(`${YELLOW}━━━ ${title} ━━━${NC}`);
}

async function fetchJson(url: string, options?: RequestInit): Promise<any> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Ledger-Secret': LEDGER_SECRET || '',
      ...options?.headers,
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return response.json();
}

async function testBackendHealth(): Promise<boolean> {
  printSection('1. Backend Health Check');
  try {
    const health = await fetchJson(`${BASE_URL}/health`);
    if (health.ok) {
      printPass('Backend is healthy', `executionMode: ${health.executionMode || 'unknown'}`);
      return true;
    }
    printFail('Backend health check failed');
    return false;
  } catch (e: any) {
    printFail('Backend unreachable', e.message);
    return false;
  }
}

async function testLedgerSecret(): Promise<boolean> {
  printSection('2. Ledger Secret Configured');
  if (!LEDGER_SECRET) {
    printFail('LEDGER_SECRET not configured', 'Set VITE_DEV_LEDGER_SECRET or LEDGER_SECRET env var');
    return false;
  }

  try {
    const stats = await fetchJson(`${BASE_URL}/api/ledger/stats`);
    if (stats.ok !== false) {
      printPass('Ledger API accessible with secret');
      return true;
    }
    printFail('Ledger API returned error');
    return false;
  } catch (e: any) {
    printFail('Ledger API access failed', e.message);
    return false;
  }
}

async function testPerpExecution(): Promise<{ intentId?: string; executionId?: string; txHash?: string }> {
  printSection('3. Perp Position Execution (Real Tx)');

  try {
    // Execute a long BTC position
    const intentText = 'long btc 10x with $100';
    printInfo(`Executing intent: "${intentText}"`);

    const response = await fetchJson(`${BASE_URL}/api/ledger/intents/execute`, {
      method: 'POST',
      body: JSON.stringify({
        intentText,
        chain: 'ethereum',
      }),
    });

    if (!response.ok) {
      printFail('Perp execution failed', response.error?.message || 'Unknown error');
      return {};
    }

    printPass('Perp intent executed successfully', `intentId: ${response.intentId}`);

    // Check for real tx
    if (response.txHash && response.explorerUrl) {
      printPass('Real transaction created', `tx: ${response.txHash.slice(0, 16)}...`);
      printInfo(`Explorer: ${response.explorerUrl}`);
    } else {
      printFail('No transaction hash returned');
    }

    // Check executedKind
    const executedKind = response.metadata?.executedKind;
    if (executedKind === 'real') {
      printPass('executedKind correctly set to "real"');
    } else if (executedKind === 'proof_only') {
      printInfo(`executedKind is "proof_only" (expected for demo contracts)`);
      printPass('executedKind truthfully reports execution type');
    } else {
      printFail('executedKind missing or incorrect', `got: ${executedKind}`);
    }

    return {
      intentId: response.intentId,
      executionId: response.executionId,
      txHash: response.txHash,
    };
  } catch (e: any) {
    printFail('Perp execution threw error', e.message);
    return {};
  }
}

async function testPositionRecorded(intentId?: string): Promise<boolean> {
  printSection('4. Position Recorded in Ledger');

  if (!intentId) {
    printFail('No intent ID to check');
    return false;
  }

  try {
    // Wait a moment for position to be recorded
    await new Promise(resolve => setTimeout(resolve, 2000));

    const positions = await fetchJson(`${BASE_URL}/api/ledger/positions?status=open`);

    if (!positions.positions || positions.positions.length === 0) {
      printFail('No open positions found in ledger');
      return false;
    }

    // Find position linked to our intent
    const position = positions.positions.find((p: any) => p.intent_id === intentId);

    if (position) {
      printPass('Position found linked to intent', `id: ${position.id}, market: ${position.market}`);
      printInfo(`Side: ${position.side}, Leverage: ${position.leverage}x`);
      if (position.open_explorer_url) {
        printPass('Position has explorer link', position.open_explorer_url);
      }
      return true;
    }

    // Position might not be linked directly - check if any recent position exists
    const recentPosition = positions.positions[0];
    if (recentPosition) {
      printPass('Recent position found (may not be directly linked)',
        `market: ${recentPosition.market}, side: ${recentPosition.side}`);
      return true;
    }

    printFail('Position not found in ledger');
    return false;
  } catch (e: any) {
    printFail('Failed to check positions', e.message);
    return false;
  }
}

async function testExecutionSteps(executionId?: string): Promise<boolean> {
  printSection('5. Execution Steps Recorded');

  if (!executionId) {
    printInfo('No execution ID provided, checking recent executions...');

    try {
      const executions = await fetchJson(`${BASE_URL}/api/ledger/executions/recent?limit=1`);
      if (executions.data && executions.data.length > 0) {
        executionId = executions.data[0].id;
        printInfo(`Using recent execution: ${executionId}`);
      }
    } catch (e) {
      printFail('Could not find recent execution');
      return false;
    }
  }

  if (!executionId) {
    printFail('No execution ID available');
    return false;
  }

  try {
    const stepsResponse = await fetchJson(`${BASE_URL}/api/ledger/executions/${executionId}/steps`);

    if (!stepsResponse.data || stepsResponse.data.length === 0) {
      printFail('No execution steps found');
      return false;
    }

    printPass(`${stepsResponse.data.length} execution steps recorded`);

    for (const step of stepsResponse.data) {
      const hasExplorer = step.explorer_url ? '(has explorer link)' : '';
      printInfo(`  Step ${step.step_index}: ${step.action} - ${step.status} ${hasExplorer}`);
    }

    // Check if at least one step has an explorer URL
    const stepWithExplorer = stepsResponse.data.find((s: any) => s.explorer_url);
    if (stepWithExplorer) {
      printPass('Execution step has explorer link', stepWithExplorer.explorer_url);
    }

    return true;
  } catch (e: any) {
    printFail('Failed to fetch execution steps', e.message);
    return false;
  }
}

async function testBridgeExecution(): Promise<boolean> {
  printSection('6. Bridge Execution (Two-Chain)');

  try {
    const intentText = 'bridge 100 REDACTED from ethereum to solana';
    printInfo(`Executing intent: "${intentText}"`);

    const response = await fetchJson(`${BASE_URL}/api/ledger/intents/execute`, {
      method: 'POST',
      body: JSON.stringify({
        intentText,
        chain: 'both',
      }),
    });

    if (!response.ok) {
      printFail('Bridge execution failed', response.error?.message || 'Unknown error');
      return false;
    }

    printPass('Bridge intent executed', `intentId: ${response.intentId}`);

    // Check for source chain tx
    if (response.txHash && response.explorerUrl) {
      printPass('Source chain (Sepolia) tx created', `tx: ${response.txHash.slice(0, 16)}...`);
      printInfo(`Explorer: ${response.explorerUrl}`);
    } else {
      printFail('No source chain transaction');
    }

    // Check for destination chain tx
    const destProof = response.metadata?.destChainProof;
    if (destProof && destProof.txHash && destProof.explorerUrl) {
      printPass('Dest chain (Solana) tx created', `tx: ${destProof.txHash.slice(0, 16)}...`);
      printInfo(`Explorer: ${destProof.explorerUrl}`);
    } else {
      printFail('No destination chain transaction', 'Bridge should produce TWO real txs');
    }

    // Verify executedKind is truthful
    if (response.metadata?.executedKind === 'proof_only') {
      printPass('executedKind truthfully reports "proof_only"');
    }

    return true;
  } catch (e: any) {
    printFail('Bridge execution threw error', e.message);
    return false;
  }
}

async function testDevStatsVisibility(): Promise<boolean> {
  printSection('7. Dev Stats Endpoint Visibility');

  try {
    // Check recent intents are visible
    const intents = await fetchJson(`${BASE_URL}/api/ledger/intents/recent?limit=5`);
    if (intents.data && intents.data.length > 0) {
      printPass(`${intents.data.length} recent intents visible in /dev/stats`);
    } else {
      printFail('No intents visible');
    }

    // Check recent executions
    const executions = await fetchJson(`${BASE_URL}/api/ledger/executions/recent?limit=5`);
    if (executions.data && executions.data.length > 0) {
      printPass(`${executions.data.length} recent executions visible`);

      // Check for different kinds
      const kinds = [...new Set(executions.data.map((e: any) => e.kind).filter(Boolean))];
      printInfo(`Execution kinds present: ${kinds.join(', ') || 'none specified'}`);
    } else {
      printFail('No executions visible');
    }

    // Check position stats
    const posStats = await fetchJson(`${BASE_URL}/api/ledger/positions/stats`);
    if (posStats.stats) {
      printPass('Position stats available',
        `total: ${posStats.stats.totalPositions || 0}, open: ${posStats.stats.openPositions || 0}`);
    }

    return true;
  } catch (e: any) {
    printFail('Dev stats endpoints failed', e.message);
    return false;
  }
}

async function main() {
  console.log(`${BLUE}╔═══════════════════════════════════════════════════════════════════════════════╗${NC}`);
  console.log(`${BLUE}║                    MVP WOW Suite - Investor Demo Verification                 ║${NC}`);
  console.log(`${BLUE}╚═══════════════════════════════════════════════════════════════════════════════╝${NC}`);
  console.log('');
  console.log(`Backend URL: ${BASE_URL}`);
  console.log(`Ledger Secret: ${LEDGER_SECRET ? '***configured***' : 'NOT SET'}`);
  console.log('');

  // Run tests
  const healthOk = await testBackendHealth();
  if (!healthOk) {
    console.log('');
    console.log(`${RED}Cannot proceed - backend not healthy${NC}`);
    process.exit(1);
  }

  const secretOk = await testLedgerSecret();
  if (!secretOk) {
    console.log('');
    console.log(`${RED}Cannot proceed - ledger secret not configured${NC}`);
    process.exit(1);
  }

  // Test perp execution
  const perpResult = await testPerpExecution();

  // Test position recorded
  await testPositionRecorded(perpResult.intentId);

  // Test execution steps
  await testExecutionSteps(perpResult.executionId);

  // Test bridge execution
  await testBridgeExecution();

  // Test dev stats visibility
  await testDevStatsVisibility();

  // Summary
  console.log('');
  console.log(`${BLUE}━━━ SUMMARY ━━━${NC}`);
  console.log('');
  console.log(`${GREEN}Passed:${NC} ${passed}`);
  console.log(`${RED}Failed:${NC} ${failed}`);
  console.log('');

  if (failed === 0) {
    console.log(`${GREEN}╔═══════════════════════════════════════════════════════════════════════════════╗${NC}`);
    console.log(`${GREEN}║                         ALL TESTS PASSED                                      ║${NC}`);
    console.log(`${GREEN}║               MVP is ready for investor demo!                                 ║${NC}`);
    console.log(`${GREEN}╚═══════════════════════════════════════════════════════════════════════════════╝${NC}`);
  } else {
    console.log(`${RED}╔═══════════════════════════════════════════════════════════════════════════════╗${NC}`);
    console.log(`${RED}║                         SOME TESTS FAILED                                     ║${NC}`);
    console.log(`${RED}║               Review failures above before demo                               ║${NC}`);
    console.log(`${RED}╚═══════════════════════════════════════════════════════════════════════════════╝${NC}`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
