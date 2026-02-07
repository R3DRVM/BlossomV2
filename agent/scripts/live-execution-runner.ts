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
  // Swaps - USDC to WETH only (these work with relayer)
  { name: 'swap_usdc_weth_1', intent: 'swap 10 USDC to WETH', category: 'swap', expectedSuccess: true },
  { name: 'swap_usdc_weth_2', intent: 'swap 15 USDC for WETH', category: 'swap', expectedSuccess: true },
  { name: 'swap_usdc_weth_3', intent: 'swap 20 USDC to WETH', category: 'swap', expectedSuccess: true },
  { name: 'swap_usdc_weth_4', intent: 'swap 25 USDC for WETH', category: 'swap', expectedSuccess: true },
  { name: 'swap_usdc_weth_5', intent: 'swap 30 USDC to WETH', category: 'swap', expectedSuccess: true },
  { name: 'swap_usdc_weth_6', intent: 'swap 35 USDC for WETH', category: 'swap', expectedSuccess: true },
  { name: 'swap_usdc_weth_7', intent: 'swap 40 USDC to WETH', category: 'swap', expectedSuccess: true },
  { name: 'swap_usdc_weth_8', intent: 'swap 45 USDC for WETH', category: 'swap', expectedSuccess: true },
  { name: 'swap_usdc_weth_9', intent: 'swap 50 USDC to WETH', category: 'swap', expectedSuccess: true },
  { name: 'swap_usdc_weth_10', intent: 'swap 55 USDC for WETH', category: 'swap', expectedSuccess: true },
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

/**
 * Get the relayer address from the backend (with fallback)
 */
async function getRelayerAddress(): Promise<string | null> {
  try {
    const result = await fetchJson(`${BASE_URL}/api/demo/relayer`);
    if (result.ok && result.relayerAddress) {
      return result.relayerAddress;
    }
    // Fallback to known relayer address if endpoint not available
    console.log(`  (Using fallback relayer address)`);
    return '0x75b0406ffbcfca51f8606fbba340fb52a402f3e0';
  } catch {
    // Fallback to known relayer address
    console.log(`  (Using fallback relayer address)`);
    return '0x75b0406ffbcfca51f8606fbba340fb52a402f3e0';
  }
}

/**
 * Step 1: Parse intent via /api/chat to get structured executionRequest
 */
async function parseIntent(intent: string): Promise<any> {
  const sessionId = `relayer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const result = await fetchJson(`${BASE_URL}/api/chat`, {
    method: 'POST',
    body: JSON.stringify({
      userMessage: intent,
      sessionId,
    }),
  });

  return result;
}

/**
 * Step 2: Prepare execution plan with structured executionRequest
 */
async function prepareExecution(executionRequest: any, userAddress: string): Promise<any> {
  const result = await fetchJson(`${BASE_URL}/api/execute/prepare`, {
    method: 'POST',
    body: JSON.stringify({
      executionRequest,
      userAddress,
      draftId: `relayer_${Date.now()}`,
    }),
  });

  return result;
}

async function executeViaRelayer(plan: any, metadata?: { kind?: string; venue?: string; usdEstimate?: number; amountDisplay?: string }): Promise<any> {
  const result = await fetchJson(`${BASE_URL}/api/demo/execute-direct`, {
    method: 'POST',
    body: JSON.stringify({
      plan,
      useRelayerAsUser: true,
      kind: metadata?.kind || 'swap',
      venue: metadata?.venue || 'demo_dex',
      usdEstimate: metadata?.usdEstimate || 10,
      amountDisplay: metadata?.amountDisplay || 'Relayer execution',
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

async function runExecution(template: ExecutionTemplate, relayerAddress: string): Promise<ExecutionResult> {
  const startTime = Date.now();
  const verboseMode = process.argv.includes('--verbose') || process.argv.includes('-v');

  try {
    // Step 1: Parse intent via /api/chat to get structured executionRequest
    const chatResult = await parseIntent(template.intent);

    if (verboseMode) {
      console.log(`  [VERBOSE] ${template.name} chatResult:`, JSON.stringify(chatResult, null, 2).slice(0, 500));
    }

    if (!chatResult.ok && !chatResult.executionRequest && !chatResult.strategy) {
      return {
        template,
        prepareSuccess: false,
        executeSuccess: false,
        error: chatResult.error || 'Intent parsing failed',
        latencyMs: Date.now() - startTime,
      };
    }

    // Extract executionRequest from chat response
    // The chat response may have it directly or in strategy.executionRequest
    let executionRequest = chatResult.executionRequest;
    if (!executionRequest && chatResult.strategy) {
      // Build executionRequest from strategy
      const strategy = chatResult.strategy;
      if (strategy.type === 'swap' || template.category === 'swap') {
        executionRequest = {
          kind: 'swap',
          tokenIn: strategy.tokenIn || (template.intent.toLowerCase().includes('usdc') ? 'USDC' : 'WETH'),
          tokenOut: strategy.tokenOut || (template.intent.toLowerCase().includes('weth') || template.intent.toLowerCase().includes('eth') ? 'WETH' : 'USDC'),
          amountIn: strategy.amountIn || '100',
        };
      } else if (strategy.type === 'perp' || strategy.instrumentType === 'perp' || template.category === 'perp') {
        executionRequest = {
          kind: 'perp',
          market: strategy.market || 'ETH-USD',
          direction: strategy.direction || 'long',
          leverage: strategy.leverage || 5,
          marginUsd: strategy.marginUsd || strategy.notionalUsd || 50,
        };
      } else if (strategy.type === 'lend' || strategy.instrumentType === 'lend' || template.category === 'lend') {
        executionRequest = {
          kind: 'lend',
          asset: 'USDC',
          amount: strategy.depositUsd?.toString() || '50',
        };
      } else if (strategy.type === 'event' || strategy.instrumentType === 'event' || template.category === 'event') {
        executionRequest = {
          kind: 'event',
          marketId: strategy.market || 'btc-price-target',
          outcome: strategy.direction || 'YES',
          stakeUsd: strategy.stakeUsd || 20,
        };
      }
    }

    if (!executionRequest) {
      return {
        template,
        prepareSuccess: false,
        executeSuccess: false,
        error: 'Could not extract executionRequest from parsed intent',
        latencyMs: Date.now() - startTime,
      };
    }

    // Normalize token names: USDC -> REDACTED (demo token), ETH stays as-is or becomes WETH
    if (executionRequest.kind === 'swap') {
      if (executionRequest.tokenIn === 'USDC') {
        executionRequest.tokenIn = 'REDACTED';
      }
      if (executionRequest.tokenOut === 'USDC') {
        executionRequest.tokenOut = 'REDACTED';
      }
      // For demo swaps, we can only do REDACTED <-> WETH
      if (executionRequest.tokenIn === 'ETH') {
        // ETH needs wrap - change to use WETH directly for simplicity
        executionRequest.tokenIn = 'WETH';
        executionRequest.fundingPolicy = 'require_tokenIn';
      }
      if (executionRequest.tokenOut === 'ETH') {
        executionRequest.tokenOut = 'WETH';
      }
    }

    // Step 2: Prepare execution plan with structured executionRequest
    // Use the actual relayer address so action data is encoded correctly
    const prepareResult = await prepareExecution(executionRequest, relayerAddress);

    if (verboseMode) {
      console.log(`  [VERBOSE] ${template.name} prepareResult:`, JSON.stringify(prepareResult, null, 2).slice(0, 800));
    }

    if (!prepareResult.plan) {
      return {
        template,
        prepareSuccess: false,
        executeSuccess: false,
        error: prepareResult.error || prepareResult.details || 'No plan returned from prepare',
        latencyMs: Date.now() - startTime,
      };
    }

    // Debug: Log what adapter is being used
    const adapters = prepareResult.plan.actions?.map((a: any) => a.adapter?.slice(0, 10)) || [];
    console.log(`  [DEBUG] ${template.name}: Using adapters: ${adapters.join(', ')}`);

    if (dryRunMode) {
      return {
        template,
        prepareSuccess: true,
        executeSuccess: false,
        error: 'Dry run - skipped execution',
        latencyMs: Date.now() - startTime,
      };
    }

    // Step 3: Execute via relayer with metadata for stats recording
    const venueMap: Record<string, string> = {
      swap: 'demo_dex',
      perp: 'demo_perp',
      lend: 'aave',
      event: 'demo_event',
    };
    const executeResult = await executeViaRelayer(prepareResult.plan, {
      kind: template.category,
      venue: venueMap[template.category] || 'demo_dex',
      usdEstimate: executionRequest.amountIn ? parseFloat(executionRequest.amountIn) : 10,
      amountDisplay: `${template.intent} (relayer)`,
    });

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
        error: executeResult.error || executeResult.details || 'Execution failed',
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

  // Get relayer address
  console.log(`${colors.cyan}[live]${colors.reset} Fetching relayer address...`);
  const relayerAddress = await getRelayerAddress();

  if (!relayerAddress) {
    console.log(`${colors.red}ERROR: Could not get relayer address${colors.reset}`);
    process.exit(1);
  }
  console.log(`${colors.green}Relayer: ${relayerAddress}${colors.reset}`);
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
    const result = await runExecution(template, relayerAddress);
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
