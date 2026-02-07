#!/usr/bin/env npx tsx
// @ts-nocheck
/**
 * Comprehensive Torture Test Runner
 *
 * Runs 500+ simulated test sessions across categories:
 * - Cross-chain bridges (100+): Solana devnet <-> Sepolia
 * - Varied intents (200+): research, swaps, perps, events, lends
 * - Multi-turn conversations (50+): escalation patterns
 * - Edge cases: fuzz tests, failures, high-load
 *
 * Features:
 * - Parallel execution via async batching (configurable concurrency)
 * - Integration with monitoringAlerts for logging
 * - Metrics: success rate, violations, alerts, timing
 * - Output to console and optionally to file
 *
 * Usage:
 *   npx tsx agent/scripts/torture-test-runner.ts
 *   npx tsx agent/scripts/torture-test-runner.ts --count=500
 *   npx tsx agent/scripts/torture-test-runner.ts --concurrency=20
 *   npx tsx agent/scripts/torture-test-runner.ts --output=./torture-results.json
 *   npx tsx agent/scripts/torture-test-runner.ts --category=bridge
 *   npx tsx agent/scripts/torture-test-runner.ts --quick  # 100 tests only
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// ============================================
// Imports from Security Module
// ============================================
import {
  createAlert,
  getAlerts,
  getAlertMetrics,
  getSecurityHealth,
  alertPathViolation,
  alertDelegationFailed,
  alertInjectionAttempt,
  type AlertMetrics,
  type SecurityAlert,
} from '../src/security/index.js';

import {
  FUZZ_TEST_CASES,
  sanitizeIntentInput,
  runFuzzTest,
  getViolationSummary,
  type FuzzTestCase,
  type FuzzResult,
} from '../src/security/intentFuzzTester.js';

// ============================================
// Imports from ERC-8004 Module
// ============================================
import {
  delegateTask,
  findQualifiedSubAgents,
  registerSubAgent,
  getOrchestratorStatus,
  type DelegationResult,
} from '../src/erc8004/subAgentOrchestrator.js';

// ============================================
// Imports from Conversation Module
// ============================================
import {
  getConversation,
  appendMessage,
  getContextWindow,
  clearConversation,
  getSessionCount,
  detectReference,
  type ConversationContext,
} from '../src/conversation/index.js';

// ============================================
// CLI Arguments
// ============================================
const args = process.argv.slice(2);
const isQuick = args.includes('--quick');
const countArg = args.find(a => a.startsWith('--count='));
const concurrencyArg = args.find(a => a.startsWith('--concurrency='));
const outputArg = args.find(a => a.startsWith('--output='));
const categoryArg = args.find(a => a.startsWith('--category='));
const baseUrlArg = args.find(a => a.startsWith('--baseUrl='));
const verboseMode = args.includes('--verbose');
const noApiMode = args.includes('--no-api');

const BASE_URL = baseUrlArg?.split('=')[1] || process.env.BASE_URL || 'http://localhost:3001';
const TARGET_COUNT = countArg ? parseInt(countArg.split('=')[1], 10) : (isQuick ? 100 : 500);
const CONCURRENCY = concurrencyArg ? parseInt(concurrencyArg.split('=')[1], 10) : 10;
const OUTPUT_FILE = outputArg?.split('=')[1] || null;
const FILTER_CATEGORY = categoryArg?.split('=')[1] || null;
const RUN_ID = `torture_${Date.now()}_${randomUUID().slice(0, 8)}`;

// ============================================
// Colors for Console Output
// ============================================
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const NC = '\x1b[0m';

// ============================================
// Test Categories
// ============================================
type TestCategory =
  | 'bridge'           // Cross-chain bridge tests
  | 'swap'             // Token swap intents
  | 'perp'             // Perpetual trading
  | 'event'            // Event-based betting
  | 'lend'             // Lending/yield intents
  | 'research'         // Research queries
  | 'multi_turn'       // Multi-turn conversations
  | 'fuzz'             // Fuzz/adversarial tests
  | 'edge_case'        // Edge cases
  | 'high_load'        // Stress tests
  | 'delegation';      // Sub-agent delegation tests

interface TortureTest {
  id: string;
  category: TestCategory;
  description: string;
  intents: string[];
  chain?: 'ethereum' | 'solana' | 'both';
  expectedOutcome: 'success' | 'fail' | 'partial';
  isMultiTurn?: boolean;
  metadata?: Record<string, unknown>;
}

interface TortureResult {
  testId: string;
  category: TestCategory;
  description: string;
  status: 'pass' | 'fail' | 'error' | 'timeout';
  latencyMs: number;
  intentResults: IntentResult[];
  errors: string[];
  alerts: SecurityAlert[];
  violations: number;
  delegationAttempts: number;
  delegationSuccesses: number;
}

interface IntentResult {
  intentText: string;
  intentId?: string;
  status: 'planned' | 'executed' | 'failed' | 'rejected';
  latencyMs: number;
  error?: string;
  txHash?: string;
}

interface AggregateMetrics {
  totalTests: number;
  passed: number;
  failed: number;
  errors: number;
  timeouts: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  totalAlerts: number;
  alertsBySeverity: Record<string, number>;
  totalViolations: number;
  delegationAttempts: number;
  delegationSuccessRate: number;
  byCategory: Record<TestCategory, { passed: number; failed: number; avgLatencyMs: number }>;
}

// ============================================
// Test Case Templates
// ============================================

/**
 * Generate cross-chain bridge test cases
 */
function generateBridgeTests(count: number): TortureTest[] {
  const tests: TortureTest[] = [];
  const amounts = ['10', '50', '100', '250', '500', '1000', '0.01', '0.1'];
  const tokens = ['USDC', 'ETH', 'SOL', 'WETH'];
  const directions = [
    { from: 'ethereum', to: 'solana' },
    { from: 'solana', to: 'ethereum' },
    { from: 'sepolia', to: 'solana-devnet' },
  ];

  for (let i = 0; i < count; i++) {
    const amount = amounts[i % amounts.length];
    const token = tokens[i % tokens.length];
    const dir = directions[i % directions.length];

    tests.push({
      id: `bridge_${i}`,
      category: 'bridge',
      description: `Bridge ${amount} ${token} from ${dir.from} to ${dir.to}`,
      intents: [
        `bridge ${amount} ${token} from ${dir.from} to ${dir.to}`,
      ],
      chain: 'both',
      expectedOutcome: 'success',
      metadata: { amount, token, from: dir.from, to: dir.to },
    });
  }

  // Add edge cases
  tests.push({
    id: 'bridge_zero',
    category: 'bridge',
    description: 'Bridge zero amount (should fail)',
    intents: ['bridge 0 USDC from ethereum to solana'],
    chain: 'both',
    expectedOutcome: 'fail',
  });

  tests.push({
    id: 'bridge_huge',
    category: 'bridge',
    description: 'Bridge impossibly large amount',
    intents: ['bridge 999999999999 ETH from ethereum to solana'],
    chain: 'both',
    expectedOutcome: 'fail',
  });

  tests.push({
    id: 'bridge_same_chain',
    category: 'bridge',
    description: 'Bridge to same chain (should fail)',
    intents: ['bridge 100 USDC from ethereum to ethereum'],
    chain: 'both',
    expectedOutcome: 'fail',
  });

  return tests;
}

/**
 * Generate varied intent test cases
 */
function generateIntentTests(count: number): TortureTest[] {
  const tests: TortureTest[] = [];
  const intentTemplates = [
    // Swaps
    { category: 'swap' as TestCategory, template: 'swap {amount} USDC for ETH', amounts: ['50', '100', '500'] },
    { category: 'swap' as TestCategory, template: 'swap {amount} ETH for USDC', amounts: ['0.1', '0.5', '1'] },
    { category: 'swap' as TestCategory, template: 'buy {amount} worth of WETH', amounts: ['$100', '$250', '$500'] },
    { category: 'swap' as TestCategory, template: 'convert {amount} USDC to ETH on uniswap', amounts: ['100', '200'] },

    // Perps
    { category: 'perp' as TestCategory, template: 'long BTC with ${amount}', amounts: ['100', '250', '500'] },
    { category: 'perp' as TestCategory, template: 'short ETH {leverage}x with ${amount}', amounts: ['100', '200'], leverage: ['2', '5', '10'] },
    { category: 'perp' as TestCategory, template: 'open {leverage}x long on SOL ${amount}', amounts: ['50', '100'], leverage: ['3', '5'] },

    // Events
    { category: 'event' as TestCategory, template: 'bet {amount} on BTC above {price}', amounts: ['$50', '$100'], prices: ['70000', '80000', '100000'] },
    { category: 'event' as TestCategory, template: 'wager {amount} ETH hits {price} by Friday', amounts: ['$25', '$50'], prices: ['4000', '5000'] },

    // Lending
    { category: 'lend' as TestCategory, template: 'deposit {amount} USDC to lending', amounts: ['100', '500', '1000'] },
    { category: 'lend' as TestCategory, template: 'lend {amount} ETH on aave', amounts: ['0.5', '1', '2'] },
    { category: 'lend' as TestCategory, template: 'supply {amount} USDC to earn yield', amounts: ['200', '500'] },

    // Research
    { category: 'research' as TestCategory, template: 'what is the price of {token}', tokens: ['ETH', 'BTC', 'SOL', 'USDC'] },
    { category: 'research' as TestCategory, template: 'show me {token} chart', tokens: ['ETH', 'BTC', 'SOL'] },
    { category: 'research' as TestCategory, template: 'analyze {token} market sentiment', tokens: ['ETH', 'BTC'] },
    { category: 'research' as TestCategory, template: 'check my {chain} portfolio', chains: ['ethereum', 'solana'] },
  ];

  let testIndex = 0;
  while (tests.length < count) {
    const tmpl = intentTemplates[testIndex % intentTemplates.length];
    let intent = tmpl.template;

    // Replace placeholders
    if (tmpl.amounts) {
      intent = intent.replace('{amount}', tmpl.amounts[testIndex % tmpl.amounts.length]);
    }
    if ((tmpl as any).leverage) {
      intent = intent.replace('{leverage}', (tmpl as any).leverage[testIndex % (tmpl as any).leverage.length]);
    }
    if ((tmpl as any).prices) {
      intent = intent.replace('{price}', (tmpl as any).prices[testIndex % (tmpl as any).prices.length]);
    }
    if ((tmpl as any).tokens) {
      intent = intent.replace('{token}', (tmpl as any).tokens[testIndex % (tmpl as any).tokens.length]);
    }
    if ((tmpl as any).chains) {
      intent = intent.replace('{chain}', (tmpl as any).chains[testIndex % (tmpl as any).chains.length]);
    }

    tests.push({
      id: `${tmpl.category}_${testIndex}`,
      category: tmpl.category,
      description: intent,
      intents: [intent],
      expectedOutcome: 'success',
    });

    testIndex++;
  }

  return tests.slice(0, count);
}

/**
 * Generate multi-turn conversation test cases
 */
function generateMultiTurnTests(count: number): TortureTest[] {
  const tests: TortureTest[] = [];
  const conversationPatterns = [
    // Escalation: research -> planning -> execution
    {
      description: 'Research to execution escalation',
      intents: [
        'what is the price of ETH?',
        'I want to buy some',
        'swap 100 USDC for ETH',
        'confirm',
      ],
    },
    // Modification flow
    {
      description: 'Intent modification flow',
      intents: [
        'swap 100 USDC for ETH',
        'make it 200 instead',
        'confirm',
      ],
    },
    // Cancellation flow
    {
      description: 'Intent cancellation',
      intents: [
        'long BTC with $100',
        'cancel that',
        'short ETH instead with $50',
      ],
    },
    // Context reference
    {
      description: 'Context reference: double the size',
      intents: [
        'swap 50 USDC for ETH',
        'double the amount',
        'confirm',
      ],
    },
    // Chain switching
    {
      description: 'Same intent different chain',
      intents: [
        'swap 100 USDC for WETH',
        'same but on solana',
      ],
    },
    // Complex multi-step
    {
      description: 'Complex multi-step flow',
      intents: [
        'check my ETH balance',
        'swap half of it to USDC',
        'deposit the USDC to lending',
        'show me my new positions',
      ],
    },
    // Error recovery
    {
      description: 'Error recovery flow',
      intents: [
        'swap 999999999 ETH for USDC', // Should fail
        'swap 1 ETH for USDC instead',
        'confirm',
      ],
    },
  ];

  for (let i = 0; i < count; i++) {
    const pattern = conversationPatterns[i % conversationPatterns.length];
    tests.push({
      id: `multi_turn_${i}`,
      category: 'multi_turn',
      description: pattern.description,
      intents: pattern.intents,
      expectedOutcome: 'partial',
      isMultiTurn: true,
    });
  }

  return tests;
}

/**
 * Generate fuzz/adversarial test cases
 */
function generateFuzzTests(): TortureTest[] {
  return FUZZ_TEST_CASES.map((tc, i) => ({
    id: `fuzz_${i}`,
    category: 'fuzz' as TestCategory,
    description: tc.description,
    intents: [tc.input],
    expectedOutcome: tc.shouldReject ? 'fail' : 'success',
    metadata: { category: tc.category },
  }));
}

/**
 * Generate edge case tests
 */
function generateEdgeCaseTests(): TortureTest[] {
  return [
    // Empty/whitespace
    { id: 'edge_empty', category: 'edge_case', description: 'Empty input', intents: [''], expectedOutcome: 'fail' },
    { id: 'edge_whitespace', category: 'edge_case', description: 'Whitespace only', intents: ['   '], expectedOutcome: 'fail' },
    { id: 'edge_newlines', category: 'edge_case', description: 'Newlines only', intents: ['\n\n\n'], expectedOutcome: 'fail' },

    // Unicode edge cases
    { id: 'edge_emoji', category: 'edge_case', description: 'Intent with emojis', intents: ['swap 100 USDC for ETH'], expectedOutcome: 'success' },
    { id: 'edge_rtl', category: 'edge_case', description: 'RTL text mixed', intents: ['swap 100 USDC'], expectedOutcome: 'success' },

    // Extreme amounts
    { id: 'edge_nano', category: 'edge_case', description: 'Nano amount', intents: ['swap 0.000000001 ETH for USDC'], expectedOutcome: 'success' },
    { id: 'edge_scientific', category: 'edge_case', description: 'Scientific notation', intents: ['swap 1e18 USDC for ETH'], expectedOutcome: 'fail' },

    // Long inputs
    { id: 'edge_long', category: 'edge_case', description: 'Very long intent', intents: ['swap ' + 'x'.repeat(1000) + ' USDC for ETH'], expectedOutcome: 'fail' },

    // Special characters
    { id: 'edge_sql', category: 'edge_case', description: 'SQL injection', intents: ["swap 100 USDC'; DROP TABLE intents;--"], expectedOutcome: 'fail' },
    { id: 'edge_xss', category: 'edge_case', description: 'XSS payload', intents: ['swap <script>alert(1)</script> USDC'], expectedOutcome: 'success' }, // Sanitized

    // Numeric edge cases
    { id: 'edge_negative', category: 'edge_case', description: 'Negative amount', intents: ['swap -100 USDC for ETH'], expectedOutcome: 'fail' },
    { id: 'edge_infinity', category: 'edge_case', description: 'Infinity', intents: ['swap Infinity USDC for ETH'], expectedOutcome: 'fail' },
    { id: 'edge_nan', category: 'edge_case', description: 'NaN', intents: ['swap NaN USDC for ETH'], expectedOutcome: 'fail' },
  ];
}

/**
 * Generate high-load stress tests
 */
function generateHighLoadTests(count: number): TortureTest[] {
  const tests: TortureTest[] = [];

  // Rapid succession tests (same intent repeated)
  for (let i = 0; i < Math.min(count, 20); i++) {
    tests.push({
      id: `highload_rapid_${i}`,
      category: 'high_load',
      description: `Rapid fire intent #${i}`,
      intents: ['swap 10 USDC for ETH'],
      expectedOutcome: 'success',
    });
  }

  // Concurrent complex intents
  for (let i = 0; i < Math.min(count - 20, 30); i++) {
    tests.push({
      id: `highload_complex_${i}`,
      category: 'high_load',
      description: `Complex concurrent intent #${i}`,
      intents: [
        'analyze ETH market and if bullish, long with $100 at 5x leverage',
      ],
      expectedOutcome: 'partial',
    });
  }

  return tests;
}

/**
 * Generate delegation tests
 */
function generateDelegationTests(count: number): TortureTest[] {
  const tests: TortureTest[] = [];

  for (let i = 0; i < count; i++) {
    tests.push({
      id: `delegation_${i}`,
      category: 'delegation',
      description: `Sub-agent delegation test #${i}`,
      intents: ['swap 100 USDC for ETH via sub-agent'],
      expectedOutcome: 'partial',
      metadata: { testDelegation: true },
    });
  }

  return tests;
}

// ============================================
// API Client
// ============================================

async function fetchJson(url: string, options?: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function checkHealth(): Promise<boolean> {
  try {
    const health = await fetchJson(`${BASE_URL}/health`);
    return health.ok === true || health.status === 'ok';
  } catch {
    return false;
  }
}

async function sendIntent(intent: string, sessionId: string): Promise<{
  ok: boolean;
  intentId?: string;
  response?: any;
  error?: string;
  latencyMs: number;
}> {
  const start = Date.now();

  try {
    const response = await fetchJson(`${BASE_URL}/api/chat`, {
      method: 'POST',
      body: JSON.stringify({
        userMessage: intent,
        sessionId,
        metadata: {
          source: 'torture_test',
          runId: RUN_ID,
        },
      }),
    });

    return {
      ok: response.ok !== false,
      intentId: response.intentId,
      response,
      latencyMs: Date.now() - start,
    };
  } catch (error: any) {
    return {
      ok: false,
      error: error.message,
      latencyMs: Date.now() - start,
    };
  }
}

// ============================================
// Test Execution
// ============================================

async function executeTest(test: TortureTest): Promise<TortureResult> {
  const startTime = Date.now();
  const sessionId = `torture_${test.id}_${Date.now()}`;
  const intentResults: IntentResult[] = [];
  const errors: string[] = [];
  let delegationAttempts = 0;
  let delegationSuccesses = 0;

  // Initialize conversation context for multi-turn tests
  if (test.isMultiTurn) {
    getConversation(sessionId);
  }

  // Execute each intent in sequence
  for (const intent of test.intents) {
    const intentStart = Date.now();

    // For multi-turn tests, update conversation context
    if (test.isMultiTurn) {
      appendMessage(sessionId, {
        role: 'user',
        content: intent,
      });

      // Check for references
      const reference = detectReference(sessionId, intent);
      if (reference && verboseMode) {
        console.log(`${DIM}  [ref] Detected: ${reference.type}${NC}`);
      }
    }

    // Test delegation if applicable
    if (test.metadata?.testDelegation) {
      delegationAttempts++;
      try {
        const qualified = findQualifiedSubAgents({
          capabilities: ['swap'],
        });
        if (qualified.length > 0) {
          delegationSuccesses++;
        }
      } catch (e) {
        // Delegation not enabled or no sub-agents
      }
    }

    // Sanitize and check for injections
    const { sanitized, warnings } = sanitizeIntentInput(intent);
    if (warnings.length > 0) {
      alertInjectionAttempt({
        sessionId,
        input: intent,
        injectionType: warnings[0],
        blocked: true,
      });
    }

    // Send intent via API (unless --no-api mode)
    if (noApiMode) {
      // Simulate response
      intentResults.push({
        intentText: intent,
        status: 'planned',
        latencyMs: Date.now() - intentStart,
      });
    } else {
      const result = await sendIntent(sanitized, sessionId);

      intentResults.push({
        intentText: intent,
        intentId: result.intentId,
        status: result.ok ? 'planned' : 'failed',
        latencyMs: result.latencyMs,
        error: result.error,
      });

      if (!result.ok && result.error) {
        errors.push(result.error);
      }
    }

    // Small delay between intents to avoid rate limiting
    if (test.intents.length > 1) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  // Clean up conversation
  if (test.isMultiTurn) {
    clearConversation(sessionId);
  }

  // Gather alerts from this test
  const testAlerts = getAlerts({
    since: startTime,
    limit: 100,
  });

  // Determine test status
  const failedIntents = intentResults.filter(r => r.status === 'failed');
  const allFailed = failedIntents.length === intentResults.length;
  const allPassed = failedIntents.length === 0;

  let status: TortureResult['status'];
  if (test.expectedOutcome === 'fail') {
    status = allFailed ? 'pass' : 'fail';
  } else if (test.expectedOutcome === 'success') {
    status = allPassed ? 'pass' : 'fail';
  } else {
    // Partial - at least some should work
    status = intentResults.some(r => r.status !== 'failed') ? 'pass' : 'fail';
  }

  return {
    testId: test.id,
    category: test.category,
    description: test.description,
    status,
    latencyMs: Date.now() - startTime,
    intentResults,
    errors,
    alerts: testAlerts,
    violations: getViolationSummary().lastHour,
    delegationAttempts,
    delegationSuccesses,
  };
}

/**
 * Run tests in parallel batches
 */
async function runTestBatch(tests: TortureTest[], batchSize: number): Promise<TortureResult[]> {
  const results: TortureResult[] = [];

  for (let i = 0; i < tests.length; i += batchSize) {
    const batch = tests.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(t => executeTest(t)));
    results.push(...batchResults);

    // Progress update
    const completed = Math.min(i + batchSize, tests.length);
    const percent = Math.round((completed / tests.length) * 100);
    process.stdout.write(`\r${CYAN}[torture]${NC} Progress: ${completed}/${tests.length} (${percent}%)`);
  }

  console.log(''); // New line after progress
  return results;
}

// ============================================
// Metrics Aggregation
// ============================================

function aggregateMetrics(results: TortureResult[]): AggregateMetrics {
  const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b);
  const totalLatency = latencies.reduce((a, b) => a + b, 0);

  const byCategory: Record<TestCategory, { passed: number; failed: number; latencies: number[] }> = {} as any;

  for (const r of results) {
    if (!byCategory[r.category]) {
      byCategory[r.category] = { passed: 0, failed: 0, latencies: [] };
    }
    if (r.status === 'pass') {
      byCategory[r.category].passed++;
    } else {
      byCategory[r.category].failed++;
    }
    byCategory[r.category].latencies.push(r.latencyMs);
  }

  const byCategoryFinal: Record<TestCategory, { passed: number; failed: number; avgLatencyMs: number }> = {} as any;
  for (const [cat, stats] of Object.entries(byCategory)) {
    const avgLat = stats.latencies.length > 0
      ? Math.round(stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length)
      : 0;
    byCategoryFinal[cat as TestCategory] = {
      passed: stats.passed,
      failed: stats.failed,
      avgLatencyMs: avgLat,
    };
  }

  const alertsBySeverity: Record<string, number> = {};
  for (const r of results) {
    for (const alert of r.alerts) {
      alertsBySeverity[alert.severity] = (alertsBySeverity[alert.severity] || 0) + 1;
    }
  }

  const totalDelegationAttempts = results.reduce((a, r) => a + r.delegationAttempts, 0);
  const totalDelegationSuccesses = results.reduce((a, r) => a + r.delegationSuccesses, 0);

  return {
    totalTests: results.length,
    passed: results.filter(r => r.status === 'pass').length,
    failed: results.filter(r => r.status === 'fail').length,
    errors: results.filter(r => r.status === 'error').length,
    timeouts: results.filter(r => r.status === 'timeout').length,
    totalLatencyMs: totalLatency,
    avgLatencyMs: Math.round(totalLatency / results.length),
    p95LatencyMs: latencies[Math.floor(latencies.length * 0.95)] || 0,
    p99LatencyMs: latencies[Math.floor(latencies.length * 0.99)] || 0,
    totalAlerts: results.reduce((a, r) => a + r.alerts.length, 0),
    alertsBySeverity,
    totalViolations: results.reduce((a, r) => a + r.violations, 0),
    delegationAttempts: totalDelegationAttempts,
    delegationSuccessRate: totalDelegationAttempts > 0
      ? (totalDelegationSuccesses / totalDelegationAttempts) * 100
      : 0,
    byCategory: byCategoryFinal,
  };
}

// ============================================
// Output Formatting
// ============================================

function printBanner() {
  console.log(`\n${BLUE}${BOLD}╔══════════════════════════════════════════════════════════════════════════╗${NC}`);
  console.log(`${BLUE}${BOLD}║                    COMPREHENSIVE TORTURE TEST RUNNER                    ║${NC}`);
  console.log(`${BLUE}${BOLD}╚══════════════════════════════════════════════════════════════════════════╝${NC}\n`);
}

function printConfig() {
  console.log(`${CYAN}Configuration:${NC}`);
  console.log(`  Run ID:        ${RUN_ID}`);
  console.log(`  Base URL:      ${BASE_URL}`);
  console.log(`  Target Count:  ${TARGET_COUNT}`);
  console.log(`  Concurrency:   ${CONCURRENCY}`);
  console.log(`  Output File:   ${OUTPUT_FILE || 'console only'}`);
  console.log(`  Filter:        ${FILTER_CATEGORY || 'all categories'}`);
  console.log(`  No-API Mode:   ${noApiMode ? 'yes (dry run)' : 'no'}`);
  console.log('');
}

function printResults(metrics: AggregateMetrics, results: TortureResult[]) {
  console.log(`\n${BLUE}${BOLD}═══════════════════════════════════════════════════════════════════════════${NC}`);
  console.log(`${BLUE}${BOLD}                              TEST RESULTS                                  ${NC}`);
  console.log(`${BLUE}${BOLD}═══════════════════════════════════════════════════════════════════════════${NC}\n`);

  // Overall summary
  const successRate = ((metrics.passed / metrics.totalTests) * 100).toFixed(1);
  const statusColor = parseFloat(successRate) >= 90 ? GREEN : parseFloat(successRate) >= 70 ? YELLOW : RED;

  console.log(`${BOLD}Overall Results:${NC}`);
  console.log(`  Total Tests:   ${metrics.totalTests}`);
  console.log(`  Passed:        ${GREEN}${metrics.passed}${NC}`);
  console.log(`  Failed:        ${RED}${metrics.failed}${NC}`);
  console.log(`  Errors:        ${metrics.errors}`);
  console.log(`  Timeouts:      ${metrics.timeouts}`);
  console.log(`  Success Rate:  ${statusColor}${successRate}%${NC}`);
  console.log('');

  // Latency stats
  console.log(`${BOLD}Latency Statistics:${NC}`);
  console.log(`  Average:       ${metrics.avgLatencyMs}ms`);
  console.log(`  P95:           ${metrics.p95LatencyMs}ms`);
  console.log(`  P99:           ${metrics.p99LatencyMs}ms`);
  console.log(`  Total:         ${(metrics.totalLatencyMs / 1000).toFixed(2)}s`);
  console.log('');

  // By category
  console.log(`${BOLD}Results by Category:${NC}`);
  console.log(`${'Category'.padEnd(15)} ${'Passed'.padEnd(10)} ${'Failed'.padEnd(10)} ${'Avg Latency'}`);
  console.log('─'.repeat(50));

  for (const [cat, stats] of Object.entries(metrics.byCategory)) {
    const catColor = stats.failed === 0 ? GREEN : stats.passed === 0 ? RED : YELLOW;
    console.log(
      `${cat.padEnd(15)} ${GREEN}${String(stats.passed).padEnd(10)}${NC} ${RED}${String(stats.failed).padEnd(10)}${NC} ${stats.avgLatencyMs}ms`
    );
  }
  console.log('');

  // Alerts summary
  if (metrics.totalAlerts > 0) {
    console.log(`${BOLD}Security Alerts:${NC}`);
    console.log(`  Total:         ${metrics.totalAlerts}`);
    for (const [severity, count] of Object.entries(metrics.alertsBySeverity)) {
      const color = severity === 'critical' || severity === 'emergency' ? RED :
                    severity === 'warning' ? YELLOW : NC;
      console.log(`  ${severity.padEnd(12)}:  ${color}${count}${NC}`);
    }
    console.log('');
  }

  // Violations
  if (metrics.totalViolations > 0) {
    console.log(`${BOLD}Path Violations:${NC}`);
    console.log(`  Total:         ${YELLOW}${metrics.totalViolations}${NC}`);
    console.log('');
  }

  // Delegation stats
  if (metrics.delegationAttempts > 0) {
    console.log(`${BOLD}Sub-Agent Delegation:${NC}`);
    console.log(`  Attempts:      ${metrics.delegationAttempts}`);
    console.log(`  Success Rate:  ${metrics.delegationSuccessRate.toFixed(1)}%`);
    console.log('');
  }

  // Failed tests details
  const failures = results.filter(r => r.status === 'fail' || r.status === 'error');
  if (failures.length > 0 && failures.length <= 20) {
    console.log(`${RED}${BOLD}Failed Tests:${NC}`);
    for (const f of failures.slice(0, 10)) {
      console.log(`  ${RED}[${f.category}]${NC} ${f.testId}: ${f.description}`);
      if (f.errors.length > 0) {
        console.log(`    ${DIM}Error: ${f.errors[0].slice(0, 80)}${NC}`);
      }
    }
    if (failures.length > 10) {
      console.log(`  ${DIM}... and ${failures.length - 10} more${NC}`);
    }
    console.log('');
  }

  // Final verdict
  console.log('');
  if (parseFloat(successRate) >= 95) {
    console.log(`${GREEN}${BOLD}╔══════════════════════════════════════════════════════════════════════════╗${NC}`);
    console.log(`${GREEN}${BOLD}║                     TORTURE TEST SUITE PASSED                           ║${NC}`);
    console.log(`${GREEN}${BOLD}║                     ${successRate}% success rate                                  ║${NC}`);
    console.log(`${GREEN}${BOLD}╚══════════════════════════════════════════════════════════════════════════╝${NC}`);
  } else if (parseFloat(successRate) >= 80) {
    console.log(`${YELLOW}${BOLD}╔══════════════════════════════════════════════════════════════════════════╗${NC}`);
    console.log(`${YELLOW}${BOLD}║                  TORTURE TEST SUITE: MOSTLY PASSED                      ║${NC}`);
    console.log(`${YELLOW}${BOLD}║                  ${successRate}% success rate - review failures                  ║${NC}`);
    console.log(`${YELLOW}${BOLD}╚══════════════════════════════════════════════════════════════════════════╝${NC}`);
  } else {
    console.log(`${RED}${BOLD}╔══════════════════════════════════════════════════════════════════════════╗${NC}`);
    console.log(`${RED}${BOLD}║                     TORTURE TEST SUITE FAILED                           ║${NC}`);
    console.log(`${RED}${BOLD}║                     ${successRate}% success rate                                   ║${NC}`);
    console.log(`${RED}${BOLD}╚══════════════════════════════════════════════════════════════════════════╝${NC}`);
  }
  console.log('');
}

function writeOutputFile(metrics: AggregateMetrics, results: TortureResult[]) {
  if (!OUTPUT_FILE) return;

  const output = {
    runId: RUN_ID,
    timestamp: new Date().toISOString(),
    config: {
      baseUrl: BASE_URL,
      targetCount: TARGET_COUNT,
      concurrency: CONCURRENCY,
      filterCategory: FILTER_CATEGORY,
    },
    metrics,
    results: results.map(r => ({
      ...r,
      alerts: r.alerts.map(a => ({
        id: a.id,
        category: a.category,
        severity: a.severity,
        message: a.message,
      })),
    })),
  };

  const outputPath = path.resolve(OUTPUT_FILE);
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`${CYAN}[torture]${NC} Results written to: ${outputPath}`);
}

// ============================================
// Main Entry Point
// ============================================

async function main() {
  printBanner();
  printConfig();

  // Health check
  if (!noApiMode) {
    console.log(`${CYAN}[torture]${NC} Checking backend health...`);
    const healthy = await checkHealth();
    if (!healthy) {
      console.log(`${RED}ERROR: Backend not healthy at ${BASE_URL}${NC}`);
      console.log(`${DIM}Make sure the server is running: npm run dev${NC}`);
      console.log(`${DIM}Or use --no-api for dry run mode${NC}\n`);
      process.exit(1);
    }
    console.log(`${GREEN}Backend healthy at ${BASE_URL}${NC}\n`);
  } else {
    console.log(`${YELLOW}[torture]${NC} Running in --no-api mode (dry run)\n`);
  }

  // Generate test cases
  console.log(`${CYAN}[torture]${NC} Generating test cases...`);

  let allTests: TortureTest[] = [];

  // Distribution: ~100 bridge, ~200 varied, ~50 multi-turn, rest edge cases + fuzz
  const bridgeCount = Math.floor(TARGET_COUNT * 0.2);
  const intentCount = Math.floor(TARGET_COUNT * 0.4);
  const multiTurnCount = Math.floor(TARGET_COUNT * 0.1);
  const highLoadCount = Math.floor(TARGET_COUNT * 0.1);
  const delegationCount = Math.floor(TARGET_COUNT * 0.05);

  allTests.push(...generateBridgeTests(bridgeCount));
  allTests.push(...generateIntentTests(intentCount));
  allTests.push(...generateMultiTurnTests(multiTurnCount));
  allTests.push(...generateFuzzTests());
  allTests.push(...generateEdgeCaseTests());
  allTests.push(...generateHighLoadTests(highLoadCount));
  allTests.push(...generateDelegationTests(delegationCount));

  // Filter by category if specified
  if (FILTER_CATEGORY) {
    allTests = allTests.filter(t => t.category === FILTER_CATEGORY);
    if (allTests.length === 0) {
      console.log(`${RED}ERROR: No tests found for category '${FILTER_CATEGORY}'${NC}`);
      process.exit(1);
    }
  }

  // Limit to target count
  if (allTests.length > TARGET_COUNT) {
    // Shuffle to get a mix
    allTests = allTests.sort(() => Math.random() - 0.5).slice(0, TARGET_COUNT);
  }

  // Print test distribution
  const distribution: Record<string, number> = {};
  for (const t of allTests) {
    distribution[t.category] = (distribution[t.category] || 0) + 1;
  }

  console.log(`${CYAN}[torture]${NC} Test distribution (${allTests.length} total):`);
  for (const [cat, count] of Object.entries(distribution).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(15)} ${count}`);
  }
  console.log('');

  // Register orchestrator status before tests
  const orchestratorStatus = getOrchestratorStatus();
  if (orchestratorStatus.enabled) {
    console.log(`${CYAN}[torture]${NC} Sub-agent orchestration enabled (${orchestratorStatus.subAgentCount} agents)`);
  }

  // Run tests
  console.log(`${CYAN}[torture]${NC} Starting test execution with concurrency=${CONCURRENCY}...`);
  const startTime = Date.now();

  const results = await runTestBatch(allTests, CONCURRENCY);

  const totalTime = Date.now() - startTime;
  console.log(`${CYAN}[torture]${NC} Completed in ${(totalTime / 1000).toFixed(2)}s`);

  // Aggregate metrics
  const metrics = aggregateMetrics(results);

  // Print results
  printResults(metrics, results);

  // Write output file if specified
  writeOutputFile(metrics, results);

  // Get final security health
  const securityHealth = getSecurityHealth();
  if (securityHealth.status !== 'healthy') {
    console.log(`${YELLOW}[security]${NC} Status: ${securityHealth.status}`);
    for (const issue of securityHealth.issues) {
      console.log(`  ${YELLOW}- ${issue}${NC}`);
    }
  }

  // Exit code
  const successRate = (metrics.passed / metrics.totalTests) * 100;
  process.exit(successRate >= 80 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\n${RED}FATAL ERROR: ${error.message}${NC}\n`);
  if (verboseMode) {
    console.error(error.stack);
  }
  process.exit(1);
});
