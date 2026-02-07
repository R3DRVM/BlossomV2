#!/usr/bin/env npx tsx
// @ts-nocheck
/**
 * Live Execution Runner
 *
 * Executes real on-chain transactions via the relayer to drive stats growth.
 * Uses /api/execute/prepare + /api/demo/execute-direct for relayer-based execution.
 *
 * Usage:
 *   npx tsx agent/scripts/live-execution-runner.ts
 *   npx tsx agent/scripts/live-execution-runner.ts --count=50
 *   npx tsx agent/scripts/live-execution-runner.ts --baseUrl=https://blossom.onl
 */

import { randomUUID } from 'crypto';

// ============================================
// Configuration
// ============================================

const args = process.argv.slice(2);
const countArg = args.find(a => a.startsWith('--count='));
const baseUrlArg = args.find(a => a.startsWith('--baseUrl='));
const dryRunMode = args.includes('--dry-run');

const BASE_URL = baseUrlArg?.split('=')[1] || process.env.BASE_URL || 'https://blossom.onl';
const EXECUTION_COUNT = countArg ? parseInt(countArg.split('=')[1], 10) : 20;
const RUN_ID = `live_${Date.now()}_${randomUUID().slice(0, 8)}`;

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

// ============================================
// Execution Templates
// ============================================

interface ExecutionTemplate {
  name: string;
  intent: string;
  category: 'swap' | 'perp' | 'lend' | 'event' | 'bridge';
  expectedSuccess: boolean;
}

const EXECUTION_TEMPLATES: ExecutionTemplate[] = [
  // Swaps
  { name: 'swap_usdc_eth', intent: 'swap 10 USDC for ETH', category: 'swap', expectedSuccess: true },
  { name: 'swap_eth_usdc', intent: 'swap 0.01 ETH for USDC', category: 'swap', expectedSuccess: true },
  { name: 'swap_weth_buy', intent: 'buy $25 worth of WETH', category: 'swap', expectedSuccess: true },

  // Perps
  { name: 'perp_long_btc', intent: 'long BTC with $50', category: 'perp', expectedSuccess: true },
  { name: 'perp_short_eth', intent: 'short ETH 3x with $30', category: 'perp', expectedSuccess: true },
  { name: 'perp_long_sol', intent: 'open 5x long on SOL $20', category: 'perp', expectedSuccess: true },

  // Lending
  { name: 'lend_usdc', intent: 'deposit 50 USDC to lending', category: 'lend', expectedSuccess: true },
  { name: 'lend_aave', intent: 'supply 25 USDC to aave', category: 'lend', expectedSuccess: true },

  // Events
  { name: 'event_btc_above', intent: 'bet $20 on BTC above 70000', category: 'event', expectedSuccess: true },
  { name: 'event_eth_target', intent: 'wager $15 ETH hits 4000 by Friday', category: 'event', expectedSuccess: true },
];

// ============================================
// API Helpers
// ============================================

async function fetchJson(url: string, options: RequestInit = {}): Promise<any> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: 'Invalid JSON response', raw: text.slice(0, 200) };
  }
}

async function checkHealth(): Promise<boolean> {
  try {
    const result = await fetchJson(`${BASE_URL}/health`);
    return result.ok === true;
  } catch {
    return false;
  }
}

async function prepareExecution(intent: string): Promise<any> {
  // Use a dummy address - the relayer will override with useRelayerAsUser
  const dummyAddress = '0x1234567890123456789012345678901234567890';

  const result = await fetchJson(`${BASE_URL}/api/execute/prepare`, {
    method: 'POST',
    body: JSON.stringify({
      intent,
      userAddress: dummyAddress,
    }),
  });

  return result;
}

async function executeViaRelayer(plan: any): Promise<any> {
  const result = await fetchJson(`${BASE_URL}/api/demo/execute-direct`, {
    method: 'POST',
    body: JSON.stringify({
      plan,
      useRelayerAsUser: true,
    }),
  });

  return result;
}

// ============================================
// Execution Logic
// ============================================

interface ExecutionResult {
  template: ExecutionTemplate;
  prepareSuccess: boolean;
  executeSuccess: boolean;
  txHash?: string;
  error?: string;
  latencyMs: number;
}

async function runExecution(template: ExecutionTemplate): Promise<ExecutionResult> {
  const startTime = Date.now();

  try {
    // Step 1: Prepare execution plan
    const prepareResult = await prepareExecution(template.intent);

    if (!prepareResult.plan) {
      return {
        template,
        prepareSuccess: false,
        executeSuccess: false,
        error: prepareResult.error || 'No plan returned',
        latencyMs: Date.now() - startTime,
      };
    }

    if (dryRunMode) {
      return {
        template,
        prepareSuccess: true,
        executeSuccess: false,
        error: 'Dry run - skipped execution',
        latencyMs: Date.now() - startTime,
      };
    }

    // Step 2: Execute via relayer
    const executeResult = await executeViaRelayer(prepareResult.plan);

    if (executeResult.ok && executeResult.txHash) {
      return {
        template,
        prepareSuccess: true,
        executeSuccess: true,
        txHash: executeResult.txHash,
        latencyMs: Date.now() - startTime,
      };
    } else {
      return {
        template,
        prepareSuccess: true,
        executeSuccess: false,
        error: executeResult.error || 'Execution failed',
        latencyMs: Date.now() - startTime,
      };
    }
  } catch (error: any) {
    return {
      template,
      prepareSuccess: false,
      executeSuccess: false,
      error: error.message || 'Unknown error',
      latencyMs: Date.now() - startTime,
    };
  }
}

// ============================================
// Main Script
// ============================================

async function main() {
  console.log('');
  console.log(`${colors.blue}╔══════════════════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.blue}║                    LIVE EXECUTION RUNNER                                ║${colors.reset}`);
  console.log(`${colors.blue}╚══════════════════════════════════════════════════════════════════════════╝${colors.reset}`);
  console.log('');

  console.log(`${colors.cyan}Configuration:${colors.reset}`);
  console.log(`  Run ID:        ${RUN_ID}`);
  console.log(`  Base URL:      ${BASE_URL}`);
  console.log(`  Target Count:  ${EXECUTION_COUNT}`);
  console.log(`  Dry Run:       ${dryRunMode ? 'yes' : 'no'}`);
  console.log('');

  // Check health
  console.log(`${colors.cyan}[live]${colors.reset} Checking backend health...`);
  const healthy = await checkHealth();

  if (!healthy) {
    console.log(`${colors.red}ERROR: Backend not healthy at ${BASE_URL}${colors.reset}`);
    process.exit(1);
  }
  console.log(`${colors.green}Backend healthy at ${BASE_URL}${colors.reset}`);
  console.log('');

  // Generate execution list
  const executions: ExecutionTemplate[] = [];
  let templateIndex = 0;

  while (executions.length < EXECUTION_COUNT) {
    executions.push(EXECUTION_TEMPLATES[templateIndex % EXECUTION_TEMPLATES.length]);
    templateIndex++;
  }

  console.log(`${colors.cyan}[live]${colors.reset} Starting ${EXECUTION_COUNT} executions...`);
  console.log('');

  // Run executions
  const results: ExecutionResult[] = [];

  for (let i = 0; i < executions.length; i++) {
    const template = executions[i];
    const result = await runExecution(template);
    results.push(result);

    // Log progress
    const status = result.executeSuccess
      ? `${colors.green}SUCCESS${colors.reset}`
      : result.prepareSuccess
        ? `${colors.yellow}PARTIAL${colors.reset}`
        : `${colors.red}FAILED${colors.reset}`;

    const txInfo = result.txHash ? ` tx:${result.txHash.slice(0, 10)}...` : '';
    const errorInfo = result.error ? ` (${result.error.slice(0, 30)}...)` : '';

    console.log(`  [${i + 1}/${EXECUTION_COUNT}] ${template.name}: ${status}${txInfo}${errorInfo} (${result.latencyMs}ms)`);

    // Small delay between executions
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('');

  // Summary
  const successCount = results.filter(r => r.executeSuccess).length;
  const partialCount = results.filter(r => r.prepareSuccess && !r.executeSuccess).length;
  const failedCount = results.filter(r => !r.prepareSuccess).length;
  const successRate = (successCount / results.length * 100).toFixed(1);

  console.log(`${colors.blue}═══════════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.blue}                              EXECUTION RESULTS                             ${colors.reset}`);
  console.log(`${colors.blue}═══════════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log('');
  console.log(`  Total:     ${results.length}`);
  console.log(`  Success:   ${colors.green}${successCount}${colors.reset}`);
  console.log(`  Partial:   ${colors.yellow}${partialCount}${colors.reset}`);
  console.log(`  Failed:    ${colors.red}${failedCount}${colors.reset}`);
  console.log(`  Rate:      ${successRate}%`);
  console.log('');

  // Category breakdown
  const byCategory: Record<string, { success: number; total: number }> = {};
  for (const r of results) {
    const cat = r.template.category;
    if (!byCategory[cat]) byCategory[cat] = { success: 0, total: 0 };
    byCategory[cat].total++;
    if (r.executeSuccess) byCategory[cat].success++;
  }

  console.log('By Category:');
  for (const [cat, stats] of Object.entries(byCategory)) {
    const rate = (stats.success / stats.total * 100).toFixed(0);
    console.log(`  ${cat.padEnd(10)} ${stats.success}/${stats.total} (${rate}%)`);
  }
  console.log('');

  // List successful tx hashes
  const successfulTxs = results.filter(r => r.txHash);
  if (successfulTxs.length > 0) {
    console.log('Successful Transactions:');
    for (const r of successfulTxs.slice(0, 10)) {
      console.log(`  ${r.txHash}`);
    }
    if (successfulTxs.length > 10) {
      console.log(`  ... and ${successfulTxs.length - 10} more`);
    }
    console.log('');
  }

  // Final status
  if (successRate >= '80') {
    console.log(`${colors.green}╔══════════════════════════════════════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.green}║                     LIVE EXECUTION RUN PASSED                           ║${colors.reset}`);
    console.log(`${colors.green}╚══════════════════════════════════════════════════════════════════════════╝${colors.reset}`);
  } else {
    console.log(`${colors.yellow}╔══════════════════════════════════════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.yellow}║                  LIVE EXECUTION RUN - REVIEW NEEDED                     ║${colors.reset}`);
    console.log(`${colors.yellow}╚══════════════════════════════════════════════════════════════════════════╝${colors.reset}`);
  }
  console.log('');
}

main().catch(console.error);
