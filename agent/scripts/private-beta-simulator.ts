#!/usr/bin/env npx tsx
// @ts-nocheck
/**
 * Private Beta Simulator
 *
 * Simulates private beta traffic with 8-12 sub-agents executing intents
 * across all categories (swap, perp, lend, event) to drive stats growth.
 *
 * Target metrics:
 * - 100-200 additional executions
 * - 8-12 unique wallets
 * - >95% success rate
 * - All intent categories visible in stats
 *
 * Usage:
 *   npx tsx agent/scripts/private-beta-simulator.ts
 *   npx tsx agent/scripts/private-beta-simulator.ts --duration=1h --target=100
 *   npx tsx agent/scripts/private-beta-simulator.ts --dry-run
 */

import { randomUUID } from 'crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

// ============================================
// Configuration
// ============================================

const args = process.argv.slice(2);
const durationArg = args.find(a => a.startsWith('--duration='));
const targetArg = args.find(a => a.startsWith('--target='));
const baseUrlArg = args.find(a => a.startsWith('--baseUrl='));
const dryRunMode = args.includes('--dry-run');
const verboseMode = args.includes('--verbose') || args.includes('-v');

// Use Vercel production (blossom.onl) as the sole production backend
// Fly.io deprecated - all traffic goes through Vercel
const BASE_URL = baseUrlArg?.split('=')[1] || process.env.BASE_URL || 'https://blossom.onl';
const TARGET_EXECUTIONS = targetArg ? parseInt(targetArg.split('=')[1], 10) : 150;
const RUN_ID = `beta_${Date.now()}_${randomUUID().slice(0, 8)}`;

// Parse duration (e.g., "1h", "30m", "24h")
function parseDuration(str: string | undefined): number {
  if (!str) return 60 * 60 * 1000; // Default 1 hour
  const match = str.match(/^(\d+)(h|m|s)?$/i);
  if (!match) return 60 * 60 * 1000;
  const value = parseInt(match[1], 10);
  const unit = (match[2] || 'h').toLowerCase();
  switch (unit) {
    case 'h': return value * 60 * 60 * 1000;
    case 'm': return value * 60 * 1000;
    case 's': return value * 1000;
    default: return value * 60 * 60 * 1000;
  }
}

const DURATION_MS = parseDuration(durationArg?.split('=')[1]);

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

// ============================================
// Sub-Agent Definitions
// ============================================

interface SubAgent {
  id: string;
  name: string;
  address: string;
  privateKey: string;
  focus: 'swap' | 'perp' | 'lend' | 'event' | 'solana_swap' | 'mixed';
  spendLimitUsd: number;
  executionCount: number;
  successCount: number;
}

const BETA_AGENT_TEMPLATES = [
  { name: 'swap-tester-1', focus: 'swap' as const, spendLimit: 500 },
  { name: 'swap-tester-2', focus: 'swap' as const, spendLimit: 500 },
  { name: 'perp-tester-1', focus: 'perp' as const, spendLimit: 1000 },
  { name: 'perp-tester-2', focus: 'perp' as const, spendLimit: 1000 },
  { name: 'perp-tester-3', focus: 'perp' as const, spendLimit: 1000 },
  { name: 'lend-tester-1', focus: 'lend' as const, spendLimit: 500 },
  { name: 'lend-tester-2', focus: 'lend' as const, spendLimit: 500 },
  { name: 'event-tester-1', focus: 'event' as const, spendLimit: 200 },
  { name: 'event-tester-2', focus: 'event' as const, spendLimit: 200 },
  // Note: Solana testers disabled - Jupiter API doesn't support devnet
  // { name: 'solana-tester-1', focus: 'solana_swap' as const, spendLimit: 300 },
  // { name: 'solana-tester-2', focus: 'solana_swap' as const, spendLimit: 300 },
  { name: 'multi-intent-1', focus: 'mixed' as const, spendLimit: 1000 },
];

// ============================================
// Intent Templates by Category
// ============================================

const INTENT_TEMPLATES = {
  swap: [
    'swap 10 USDC for WETH',
    'swap 15 USDC to WETH',
    'swap 20 USDC for WETH',
    'swap 25 bUSDC to WETH',
    'swap 30 USDC for WETH',
    'convert 12 USDC to WETH',
    'trade 18 USDC for WETH',
    'exchange 22 USDC to WETH',
  ],
  solana_swap: [
    'swap 0.1 SOL for USDC on Solana',
    'swap 0.05 SOL to USDC on Jupiter',
    'trade 0.2 SOL for USDC on Solana devnet',
    'convert 0.15 SOL to USDC via Jupiter',
    'swap SOL for USDC on Solana',
    'exchange 0.1 SOL to USDC Jupiter',
  ],
  perp: [
    'long BTC 5x with 50 USDC',
    'short ETH 3x leverage 30 USDC',
    'open BTC long 10x 100 USDC',
    'long ETH 2x with 40 USDC collateral',
    'short BTC 5x 75 USDC margin',
    'open perp ETH long 3x 50 USDC',
  ],
  event: [
    'bet 20 USDC BTC above 100k',
    'predict ETH reaches 5000 with 15 USDC',
    '25 USDC on BTC hitting 90k',
    'bet 30 USDC ETH over 4000',
    'predict BTC 120k 10 USDC',
    'wager 20 USDC on ETH above 3500',
  ],
  lend: [
    'deposit 50 USDC to Aave',
    'supply 30 USDC as collateral',
    'lend 40 USDC on Aave',
    'deposit 25 USDC lending',
    'supply 35 USDC to earn yield',
    'stake 45 USDC in Aave',
  ],
};

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

async function getStats(): Promise<any> {
  try {
    return await fetchJson(`${BASE_URL}/api/stats/public`);
  } catch {
    return { ok: false, error: 'Failed to fetch stats' };
  }
}

async function getRelayerAddress(): Promise<string> {
  try {
    const result = await fetchJson(`${BASE_URL}/api/demo/relayer`);
    if (result.ok && result.relayerAddress) {
      return result.relayerAddress;
    }
    return '0x75b0406ffbcfca51f8606fbba340fb52a402f3e0';
  } catch {
    return '0x75b0406ffbcfca51f8606fbba340fb52a402f3e0';
  }
}

// ============================================
// Execution Logic
// ============================================

interface ExecutionResult {
  agentId: string;
  intent: string;
  category: string;
  success: boolean;
  txHash?: string;
  error?: string;
  latencyMs: number;
}

async function parseIntent(intent: string): Promise<any> {
  const sessionId = `beta_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const result = await fetchJson(`${BASE_URL}/api/chat`, {
    method: 'POST',
    body: JSON.stringify({
      userMessage: intent,
      sessionId,
    }),
  });

  return result;
}

async function prepareExecution(executionRequest: any, userAddress: string): Promise<any> {
  const result = await fetchJson(`${BASE_URL}/api/execute/prepare`, {
    method: 'POST',
    body: JSON.stringify({
      executionRequest,
      userAddress,
      draftId: `beta_${Date.now()}`,
    }),
  });

  return result;
}

async function executeViaRelayer(plan: any, metadata: { kind: string; venue: string; usdEstimate: number; amountDisplay: string; recordAsAddress?: string }): Promise<any> {
  const result = await fetchJson(`${BASE_URL}/api/demo/execute-direct`, {
    method: 'POST',
    body: JSON.stringify({
      plan,
      useRelayerAsUser: true,
      ...metadata,
      // Pass agent wallet for unique wallet tracking (relayer still executes)
      recordAsAddress: metadata.recordAsAddress,
    }),
  });

  return result;
}

// Execute Solana intent via ledger/intents/execute endpoint (full pipeline)
async function executeSolanaIntent(intent: string, agentAddress: string): Promise<any> {
  const ledgerSecret = process.env.DEV_LEDGER_SECRET;

  if (!ledgerSecret) {
    return { ok: false, error: 'DEV_LEDGER_SECRET not set - cannot execute Solana intents' };
  }

  const result = await fetch(`${BASE_URL}/api/ledger/intents/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Ledger-Secret': ledgerSecret,
    },
    body: JSON.stringify({
      intentText: intent,
      chain: 'solana',
      metadata: {
        source: 'private_beta_simulator',
        agentAddress,
      },
    }),
  });

  const text = await result.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: 'Invalid JSON response', raw: text.slice(0, 200) };
  }
}

function buildExecutionRequest(category: string, intent: string): any {
  switch (category) {
    case 'swap':
      const swapAmount = intent.match(/(\d+)/)?.[1] || '10';
      return {
        kind: 'swap',
        tokenIn: 'REDACTED', // Demo USDC
        tokenOut: 'WETH',
        amountIn: swapAmount,
      };
    case 'perp':
      const perpAmount = intent.match(/(\d+)\s*USDC/)?.[1] || '50';
      const isLong = intent.toLowerCase().includes('long');
      const leverage = intent.match(/(\d+)x/)?.[1] || '5';
      const asset = intent.toLowerCase().includes('eth') ? 'ETH' : 'BTC';
      return {
        kind: 'perp',
        market: `${asset}-USD`,
        direction: isLong ? 'long' : 'short',
        leverage: parseInt(leverage, 10),
        marginUsd: parseFloat(perpAmount),
      };
    case 'event':
      const eventAmount = intent.match(/(\d+)\s*USDC/)?.[1] || '20';
      // Use real market IDs from DemoEventMarket
      const EVENT_MARKETS = [
        '0x1226b7463e5736847636fa62571d53037f286df793b8f984fc2a38c0f2d7a3ca', // BTC > 100k
        '0x8f36efda1d5e1875d74c08fa09d075576dade7722c12e69350e017b96fe23a53', // ETH > 5k
      ];
      return {
        kind: 'event',
        marketId: EVENT_MARKETS[Math.floor(Math.random() * EVENT_MARKETS.length)],
        outcome: Math.random() > 0.5 ? 'YES' : 'NO',
        stakeUsd: parseFloat(eventAmount),
      };
    case 'lend':
      const lendAmount = intent.match(/(\d+)/)?.[1] || '50';
      return {
        kind: 'lend_supply',
        chain: 'sepolia',
        asset: 'USDC',
        amount: lendAmount,
        protocol: 'demo',
      };
    case 'solana_swap':
      // Parse SOL amount from intent (e.g., "swap 0.1 SOL for USDC")
      const solAmount = intent.match(/(\d+\.?\d*)\s*SOL/i)?.[1] || '0.1';
      return {
        kind: 'swap',
        chain: 'solana',
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountIn: solAmount,
      };
    default:
      return { kind: 'swap', tokenIn: 'REDACTED', tokenOut: 'WETH', amountIn: '10' };
  }
}

async function simulateUserSession(agent: SubAgent, relayerAddress: string): Promise<ExecutionResult> {
  const startTime = Date.now();

  // Select intent based on agent focus
  // Note: solana_swap disabled - Jupiter doesn't support devnet
  const category = agent.focus === 'mixed'
    ? ['swap', 'perp', 'lend', 'event'][Math.floor(Math.random() * 4)]
    : agent.focus;

  const intents = INTENT_TEMPLATES[category as keyof typeof INTENT_TEMPLATES];
  const intent = intents[Math.floor(Math.random() * intents.length)];

  try {
    // Step 1: Parse intent
    const chatResult = await parseIntent(intent);

    if (verboseMode) {
      console.log(`  [DEBUG] ${agent.name} chat response:`, JSON.stringify(chatResult).slice(0, 300));
    }

    // Build executionRequest from parsed intent or fallback
    let executionRequest = chatResult.executionRequest;
    if (!executionRequest) {
      executionRequest = buildExecutionRequest(category, intent);
    }

    // Fix event marketIds - override with real bytes32 market IDs
    if (executionRequest?.kind === 'event') {
      const EVENT_MARKETS = [
        '0x1226b7463e5736847636fa62571d53037f286df793b8f984fc2a38c0f2d7a3ca', // BTC > 100k
        '0x8f36efda1d5e1875d74c08fa09d075576dade7722c12e69350e017b96fe23a53', // ETH > 5k
      ];
      executionRequest.marketId = EVENT_MARKETS[Math.floor(Math.random() * EVENT_MARKETS.length)];
    }

    // Special handling for Solana swaps - use ledger/intents/execute endpoint
    if (category === 'solana_swap') {
      if (dryRunMode) {
        return {
          agentId: agent.id,
          intent,
          category,
          success: false,
          error: 'Dry run - skipped Solana execution',
          latencyMs: Date.now() - startTime,
        };
      }

      const solanaResult = await executeSolanaIntent(intent, agent.address);

      if (solanaResult.ok && solanaResult.execution?.txHash) {
        return {
          agentId: agent.id,
          intent,
          category,
          success: true,
          txHash: solanaResult.execution.txHash,
          latencyMs: Date.now() - startTime,
        };
      } else {
        return {
          agentId: agent.id,
          intent,
          category,
          success: false,
          error: solanaResult.error || solanaResult.execution?.error || 'Solana execution failed',
          latencyMs: Date.now() - startTime,
        };
      }
    }

    // Step 2: Prepare execution (for Ethereum-based intents)
    const prepareResult = await prepareExecution(executionRequest, relayerAddress);

    if (!prepareResult.plan) {
      return {
        agentId: agent.id,
        intent,
        category,
        success: false,
        error: prepareResult.error || prepareResult.details || 'No plan returned',
        latencyMs: Date.now() - startTime,
      };
    }

    if (dryRunMode) {
      return {
        agentId: agent.id,
        intent,
        category,
        success: false,
        error: 'Dry run - skipped execution',
        latencyMs: Date.now() - startTime,
      };
    }

    // Step 3: Execute via relayer
    const venueMap: Record<string, string> = {
      swap: 'demo_dex',
      perp: 'demo_perp',
      lend: 'aave',
      event: 'demo_event',
      solana_swap: 'jupiter',
    };

    // For Solana swaps, the kind is still 'swap' but venue is 'jupiter'
    const recordKind = category === 'solana_swap' ? 'swap' : category;

    const executeResult = await executeViaRelayer(prepareResult.plan, {
      kind: recordKind,
      venue: venueMap[category] || 'demo_dex',
      usdEstimate: executionRequest.amountIn ? parseFloat(executionRequest.amountIn) : 10,
      amountDisplay: `${intent} (${agent.name})`,
      // Pass agent's unique wallet address for stats tracking
      recordAsAddress: agent.address,
    });

    if (executeResult.ok && executeResult.txHash) {
      return {
        agentId: agent.id,
        intent,
        category,
        success: true,
        txHash: executeResult.txHash,
        latencyMs: Date.now() - startTime,
      };
    } else {
      return {
        agentId: agent.id,
        intent,
        category,
        success: false,
        error: executeResult.error || executeResult.details || 'Execution failed',
        latencyMs: Date.now() - startTime,
      };
    }
  } catch (error: any) {
    return {
      agentId: agent.id,
      intent,
      category,
      success: false,
      error: error.message || 'Unknown error',
      latencyMs: Date.now() - startTime,
    };
  }
}

// ============================================
// Agent Generation
// ============================================

function generateSubAgents(): SubAgent[] {
  console.log(`\n${colors.cyan}Generating ${BETA_AGENT_TEMPLATES.length} sub-agents...${colors.reset}`);

  return BETA_AGENT_TEMPLATES.map((template, idx) => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    const agent: SubAgent = {
      id: `agent_${idx + 1}_${randomUUID().slice(0, 8)}`,
      name: template.name,
      address: account.address,
      privateKey,
      focus: template.focus,
      spendLimitUsd: template.spendLimit,
      executionCount: 0,
      successCount: 0,
    };

    console.log(`  ${colors.green}✓${colors.reset} ${agent.name} (${agent.focus}) - ${agent.address.slice(0, 10)}...`);
    return agent;
  });
}

// ============================================
// Main Simulation
// ============================================

async function runSimulation() {
  console.log('');
  console.log(`${colors.blue}╔══════════════════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.blue}║                    PRIVATE BETA SIMULATOR                               ║${colors.reset}`);
  console.log(`${colors.blue}╚══════════════════════════════════════════════════════════════════════════╝${colors.reset}`);
  console.log('');

  console.log(`${colors.cyan}Configuration:${colors.reset}`);
  console.log(`  Run ID:            ${RUN_ID}`);
  console.log(`  Base URL:          ${BASE_URL}`);
  console.log(`  Target Executions: ${TARGET_EXECUTIONS}`);
  console.log(`  Duration:          ${Math.round(DURATION_MS / 60000)} minutes`);
  console.log(`  Dry Run:           ${dryRunMode ? 'yes' : 'no'}`);
  console.log('');

  // Check health
  console.log(`${colors.cyan}[sim]${colors.reset} Checking backend health...`);
  const healthy = await checkHealth();

  if (!healthy) {
    console.log(`${colors.red}ERROR: Backend not healthy at ${BASE_URL}${colors.reset}`);
    process.exit(1);
  }
  console.log(`${colors.green}Backend healthy${colors.reset}`);

  // Get initial stats
  const initialStats = await getStats();
  console.log(`\n${colors.cyan}Initial Stats:${colors.reset}`);
  if (initialStats.ok && initialStats.data) {
    console.log(`  Executions:     ${initialStats.data.totalExecutions}`);
    console.log(`  Unique Wallets: ${initialStats.data.uniqueWallets}`);
    console.log(`  Success Rate:   ${(initialStats.data.successRate * 100).toFixed(1)}%`);
  }

  // Get relayer address
  const relayerAddress = await getRelayerAddress();
  console.log(`\n${colors.cyan}Relayer:${colors.reset} ${relayerAddress}`);

  // Generate sub-agents
  const agents = generateSubAgents();

  // Calculate cycles
  const execPerCycle = agents.length;
  const totalCycles = Math.ceil(TARGET_EXECUTIONS / execPerCycle);
  const delayBetweenCycles = Math.max(1000, Math.floor(DURATION_MS / totalCycles));

  console.log(`\n${colors.cyan}Simulation Plan:${colors.reset}`);
  console.log(`  Agents:            ${agents.length}`);
  console.log(`  Cycles:            ${totalCycles}`);
  console.log(`  Exec/Cycle:        ${execPerCycle}`);
  console.log(`  Delay/Cycle:       ${Math.round(delayBetweenCycles / 1000)}s`);
  console.log('');

  console.log(`${colors.blue}═══════════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.blue}                         STARTING SIMULATION                               ${colors.reset}`);
  console.log(`${colors.blue}═══════════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log('');

  const allResults: ExecutionResult[] = [];
  const startTime = Date.now();
  let totalExecutions = 0;

  for (let cycle = 0; cycle < totalCycles && totalExecutions < TARGET_EXECUTIONS; cycle++) {
    const cycleStart = Date.now();

    // Shuffle agents for variety
    const shuffled = [...agents].sort(() => Math.random() - 0.5);
    const activeAgents = shuffled.slice(0, Math.min(8, agents.length));

    console.log(`\n${colors.cyan}[Cycle ${cycle + 1}/${totalCycles}]${colors.reset} Running ${activeAgents.length} agents...`);

    // Run executions sequentially to avoid nonce race conditions
    // (All transactions use the same relayer wallet)
    for (let i = 0; i < activeAgents.length && totalExecutions < TARGET_EXECUTIONS; i++) {
      const agent = activeAgents[i];

      const result = await simulateUserSession(agent, relayerAddress);

      allResults.push(result);
      totalExecutions++;

      agent.executionCount++;
      if (result.success) agent.successCount++;

      const status = result.success
        ? `${colors.green}✓${colors.reset}`
        : `${colors.red}✗${colors.reset}`;

      const txInfo = result.txHash ? ` tx:${result.txHash.slice(0, 10)}...` : '';
      const errorStr = typeof result.error === 'string' ? result.error : JSON.stringify(result.error);
      const errorInfo = result.error && !result.success ? ` (${errorStr.slice(0, 25)}...)` : '';

      console.log(`    ${status} [${result.category}] ${result.intent.slice(0, 30)}...${txInfo}${errorInfo}`);

      // Wait for nonce to update before next execution
      await new Promise(r => setTimeout(r, 1500));
    }

    // Progress summary
    const elapsed = Date.now() - startTime;
    const successCount = allResults.filter(r => r.success).length;
    const rate = (successCount / allResults.length * 100).toFixed(1);

    console.log(`  ${colors.cyan}Progress:${colors.reset} ${totalExecutions}/${TARGET_EXECUTIONS} (${rate}% success)`);

    // Delay before next cycle
    if (cycle < totalCycles - 1 && totalExecutions < TARGET_EXECUTIONS) {
      const remaining = delayBetweenCycles - (Date.now() - cycleStart);
      if (remaining > 0) {
        console.log(`  Waiting ${Math.round(remaining / 1000)}s before next cycle...`);
        await new Promise(r => setTimeout(r, remaining));
      }
    }
  }

  // Final summary
  console.log('');
  console.log(`${colors.blue}═══════════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.blue}                           SIMULATION RESULTS                              ${colors.reset}`);
  console.log(`${colors.blue}═══════════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log('');

  const successCount = allResults.filter(r => r.success).length;
  const successRate = (successCount / allResults.length * 100).toFixed(1);

  console.log(`${colors.cyan}Execution Summary:${colors.reset}`);
  console.log(`  Total:     ${allResults.length}`);
  console.log(`  Success:   ${colors.green}${successCount}${colors.reset}`);
  console.log(`  Failed:    ${colors.red}${allResults.length - successCount}${colors.reset}`);
  console.log(`  Rate:      ${successRate}%`);
  console.log('');

  // Category breakdown
  const byCategory: Record<string, { success: number; total: number }> = {};
  for (const r of allResults) {
    if (!byCategory[r.category]) byCategory[r.category] = { success: 0, total: 0 };
    byCategory[r.category].total++;
    if (r.success) byCategory[r.category].success++;
  }

  console.log(`${colors.cyan}By Category:${colors.reset}`);
  for (const [cat, stats] of Object.entries(byCategory)) {
    const rate = (stats.success / stats.total * 100).toFixed(0);
    const color = stats.success > 0 ? colors.green : colors.yellow;
    console.log(`  ${cat.padEnd(10)} ${color}${stats.success}/${stats.total}${colors.reset} (${rate}%)`);
  }
  console.log('');

  // Agent summary
  console.log(`${colors.cyan}Agent Performance:${colors.reset}`);
  for (const agent of agents.sort((a, b) => b.successCount - a.successCount)) {
    const rate = agent.executionCount > 0 ? (agent.successCount / agent.executionCount * 100).toFixed(0) : 0;
    console.log(`  ${agent.name.padEnd(16)} ${agent.successCount}/${agent.executionCount} (${rate}%)`);
  }
  console.log('');

  // Final stats
  console.log(`${colors.cyan}[sim]${colors.reset} Fetching final stats...`);
  const finalStats = await getStats();
  if (finalStats.ok && finalStats.data) {
    console.log(`\n${colors.cyan}Final Stats:${colors.reset}`);
    console.log(`  Executions:     ${finalStats.data.totalExecutions}`);
    console.log(`  Unique Wallets: ${finalStats.data.uniqueWallets}`);
    console.log(`  Success Rate:   ${(finalStats.data.successRate * 100).toFixed(1)}%`);
    console.log(`  USD Routed:     $${finalStats.data.totalUsdRouted}`);

    if (initialStats.ok && initialStats.data) {
      console.log(`\n${colors.cyan}Delta:${colors.reset}`);
      console.log(`  +${finalStats.data.totalExecutions - initialStats.data.totalExecutions} executions`);
      console.log(`  +${finalStats.data.uniqueWallets - initialStats.data.uniqueWallets} unique wallets`);
    }
  }

  // Final status
  if (parseFloat(successRate) >= 95) {
    console.log(`\n${colors.green}╔══════════════════════════════════════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.green}║                    SIMULATION PASSED - TARGET MET                        ║${colors.reset}`);
    console.log(`${colors.green}╚══════════════════════════════════════════════════════════════════════════╝${colors.reset}`);
  } else if (parseFloat(successRate) >= 80) {
    console.log(`\n${colors.yellow}╔══════════════════════════════════════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.yellow}║                  SIMULATION PASSED - REVIEW RECOMMENDED                  ║${colors.reset}`);
    console.log(`${colors.yellow}╚══════════════════════════════════════════════════════════════════════════╝${colors.reset}`);
  } else {
    console.log(`\n${colors.red}╔══════════════════════════════════════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.red}║                    SIMULATION FAILED - BELOW TARGET                      ║${colors.reset}`);
    console.log(`${colors.red}╚══════════════════════════════════════════════════════════════════════════╝${colors.reset}`);
  }
  console.log('');

  // Exit code based on success
  process.exit(parseFloat(successRate) >= 80 ? 0 : 1);
}

runSimulation().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
