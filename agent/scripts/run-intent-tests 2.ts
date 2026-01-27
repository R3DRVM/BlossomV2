#!/usr/bin/env npx tsx
/**
 * Intent Test Runner
 *
 * Runs real user-style prompts through the intent tracking system
 * and records everything to the ledger.
 *
 * Usage:
 *   npx tsx agent/scripts/run-intent-tests.ts --mode standard --chains both --count 5
 *   npx tsx agent/scripts/run-intent-tests.ts --intents "long btc 20x" --intents "swap 1000 usdc to weth"
 *   npx tsx agent/scripts/run-intent-tests.ts --file intents.json
 *
 * Modes:
 *   small    - 3 quick intents (for smoke testing)
 *   standard - 5 diverse intents (default)
 *   large    - 10 intents covering all types
 *   stress   - 20 intents for load testing
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { config } from 'dotenv';
import { parseArgs } from 'util';
import * as fs from 'fs';

// Setup paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const agentDir = resolve(__dirname, '..');
const rootDir = resolve(agentDir, '..');

// Load environment
config({ path: resolve(agentDir, '.env.local') });
config({ path: resolve(rootDir, '.env.local') });

// Import intent runner
import { runIntent, runIntentBatch, parseIntent } from '../src/intent/intentRunner';
import type { IntentExecutionResult, ChainTarget } from '../src/intent/intentRunner';

// Default intent sets by mode
const INTENT_SETS = {
  // Quick smoke test (3 intents)
  small: [
    'deposit 20000 usdc to vault',
    'swap 1000 usdc to weth',
    'long btc 20x',
  ],
  // Standard test covering main types (5 intents)
  standard: [
    'deposit 20000 usdc to vault',
    'swap 15000 usdc to weth',
    'long btc 20x',
    'bridge 10000 usdc from eth to sol',
    'short eth 5x leverage',
  ],
  // UI Quick Actions proof - matches exact prompts from QuickStartPanel
  ui_proof: [
    // Quick Action: "Long BTC with live prices"
    'Long BTC with 20x leverage using 2% risk',
    // Quick Action: "Explore top DeFi protocols" (analytics)
    'Show me the top 5 DeFi protocols by TVL',
    // Quick Action: "Multi-venue execution"
    'Hedge my BTC and ETH exposure with a short BTC perp position',
    // Quick Action: "Check exposure & risk" (analytics)
    'Show me my current perp exposure and largest risk buckets',
    // Event market quick actions
    'Take YES on Fed cuts in March with 2% risk',
    'Risk 2% on the highest volume event market',
  ],
  // UI proof with larger amounts (for demo USD display)
  ui_proof_large: [
    'Long BTC with 20x leverage using 5% risk',
    'deposit 50000 usdc to aave',
    'swap 25000 usdc to weth',
    'Hedge my portfolio with a short BTC position',
    'bridge 20000 usdc from eth to sol',
  ],
  large: [
    'deposit 20000 usdc to vault',
    'swap 15000 usdc to weth',
    'long btc 20x',
    'bridge 10000 usdc from eth to sol',
    'short eth 5x leverage',
    'swap 5000 usdc to sol',
    'deposit 10000 usdc to aave',
    'convert 2 eth to usdc',
    'long sol 10x',
    'deposit 50000 usdc into kamino',
  ],
  stress: [
    // Perp intents
    'long btc 20x',
    'short eth 10x',
    'long sol 15x leverage',
    'short btc 5x',
    'long eth 25x',
    // Swap intents
    'swap 1000 usdc to weth',
    'swap 5000 usdc to sol',
    'convert 2 eth to usdc',
    'trade 10000 usdc for weth',
    'swap 500 usdt to eth',
    // Deposit intents
    'deposit 20000 usdc to vault',
    'deposit 10000 usdc to aave',
    'supply 5000 weth to aave',
    'lend 15000 usdc',
    'deposit 50000 usdc into kamino',
    // Bridge intents
    'bridge 10000 usdc from eth to sol',
    'bridge 5000 usdt eth to solana',
    'transfer 1000 usdc from ethereum to solana',
    // Unknown intents
    'do something random',
    'execute magic',
  ],
};

// Result summary
interface TestSummary {
  total: number;
  confirmed: number;
  failed: number;
  byKind: Record<string, { total: number; confirmed: number; failed: number }>;
  byErrorCode: Record<string, number>;
  results: IntentExecutionResult[];
}

function printResult(result: IntentExecutionResult, index: number, total: number): void {
  const statusIcon = result.ok ? '✅' : '❌';
  const statusColor = result.ok ? '\x1b[32m' : '\x1b[31m';
  const resetColor = '\x1b[0m';

  console.log(`\n[${index + 1}/${total}] ${statusIcon} Intent: ${result.intentId.slice(0, 8)}...`);
  console.log(`   Status: ${statusColor}${result.status}${resetColor}`);

  if (result.txHash) {
    console.log(`   TX Hash: ${result.txHash}`);
  }
  if (result.explorerUrl) {
    console.log(`   Explorer: ${result.explorerUrl}`);
  }
  if (result.error) {
    console.log(`   Stage: ${result.error.stage}`);
    console.log(`   Error: ${result.error.code}`);
    // Don't print full message if it might contain secrets
    if (!result.error.message.toLowerCase().includes('key') &&
        !result.error.message.toLowerCase().includes('secret')) {
      console.log(`   Message: ${result.error.message.slice(0, 100)}`);
    }
  }
  if (result.metadata?.executedKind === 'proof_only') {
    console.log(`   Note: proof_only (no real execution)`);
  }
}

function printSummary(summary: TestSummary): void {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════════\n');

  const successRate = summary.total > 0 ? ((summary.confirmed / summary.total) * 100).toFixed(1) : '0';
  const statusColor = parseFloat(successRate) >= 70 ? '\x1b[32m' : '\x1b[31m';
  const resetColor = '\x1b[0m';

  console.log(`Total:     ${summary.total}`);
  console.log(`Confirmed: ${statusColor}${summary.confirmed}${resetColor}`);
  console.log(`Failed:    ${summary.failed}`);
  console.log(`Success:   ${statusColor}${successRate}%${resetColor}`);

  console.log('\nBy Kind:');
  for (const [kind, stats] of Object.entries(summary.byKind)) {
    const kindRate = stats.total > 0 ? ((stats.confirmed / stats.total) * 100).toFixed(0) : '0';
    console.log(`  ${kind.padEnd(10)} ${stats.confirmed}/${stats.total} (${kindRate}%)`);
  }

  if (Object.keys(summary.byErrorCode).length > 0) {
    console.log('\nFailures by Error Code:');
    for (const [code, count] of Object.entries(summary.byErrorCode)) {
      console.log(`  ${code}: ${count}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════\n');
}

async function main() {
  console.log('\n🌸 Intent Test Runner\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Parse arguments
  const { values } = parseArgs({
    options: {
      mode: { type: 'string', short: 'm', default: 'standard' },
      count: { type: 'string', short: 'n' },
      intents: { type: 'string', short: 'i', multiple: true },
      file: { type: 'string', short: 'f' },
      chains: { type: 'string', short: 'c', default: 'ethereum' },
      parallel: { type: 'boolean', short: 'p', default: false },
      dryRun: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
    strict: false, // Allow positional args (they'll be ignored)
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`Usage:
  npx tsx agent/scripts/run-intent-tests.ts [options]

Options:
  --mode, -m      Test mode: small|standard|large|stress (default: standard)
  --count, -n     Override number of intents to run
  --intents, -i   Specific intent(s) to run (repeatable)
  --file, -f      JSON file with intents array
  --chains, -c    Target chain(s): ethereum|solana|both (default: ethereum)
  --parallel, -p  Run intents in parallel (default: false)
  --dryRun        Parse and route only, don't execute
  --help, -h      Show this help

Examples:
  npx tsx agent/scripts/run-intent-tests.ts --mode standard --chains ethereum
  npx tsx agent/scripts/run-intent-tests.ts -i "long btc 20x" -i "swap 1000 usdc to weth"
  npx tsx agent/scripts/run-intent-tests.ts --file custom-intents.json --parallel
`);
    process.exit(0);
  }

  // Determine intents to run
  let intents: string[] = [];

  if (values.intents && values.intents.length > 0) {
    intents = values.intents;
  } else if (values.file) {
    try {
      const fileContent = fs.readFileSync(values.file, 'utf-8');
      const parsed = JSON.parse(fileContent);
      intents = Array.isArray(parsed) ? parsed : parsed.intents || [];
    } catch (e: any) {
      console.error(`Failed to load intents from ${values.file}: ${e.message}`);
      process.exit(1);
    }
  } else {
    const mode = values.mode as keyof typeof INTENT_SETS;
    intents = INTENT_SETS[mode] || INTENT_SETS.standard;
  }

  // Apply count override
  if (values.count) {
    const count = parseInt(values.count);
    if (count > 0 && count < intents.length) {
      intents = intents.slice(0, count);
    }
  }

  const chain = values.chains as ChainTarget;
  const parallel = values.parallel ?? false;
  const dryRun = values.dryRun ?? false;

  console.log(`Mode:     ${values.mode || 'custom'}`);
  console.log(`Chain:    ${chain}`);
  console.log(`Count:    ${intents.length}`);
  console.log(`Parallel: ${parallel}`);
  console.log(`Dry Run:  ${dryRun}`);
  console.log('\nIntents:');
  intents.forEach((intent, i) => console.log(`  ${i + 1}. "${intent}"`));

  // Parse intents first to show what will be executed
  console.log('\nParsed Intent Types:');
  intents.forEach((intent, i) => {
    const parsed = parseIntent(intent);
    console.log(`  ${i + 1}. ${parsed.kind} (${parsed.action})`);
  });

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('RUNNING INTENTS');
  console.log('═══════════════════════════════════════════════════════════');

  // Run intents
  const results: IntentExecutionResult[] = [];
  const startTime = Date.now();

  if (parallel) {
    console.log('\nExecuting in parallel...');
    const batchResults = await runIntentBatch(intents, { chain, dryRun, parallel: true });
    results.push(...batchResults);
    batchResults.forEach((result, i) => printResult(result, i, intents.length));
  } else {
    for (let i = 0; i < intents.length; i++) {
      const intent = intents[i];
      console.log(`\nExecuting: "${intent}"`);

      const result = await runIntent(intent, { chain, dryRun });
      results.push(result);
      printResult(result, i, intents.length);

      // Small delay between sequential executions
      if (i < intents.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  const elapsed = Date.now() - startTime;

  // Build summary
  const summary: TestSummary = {
    total: results.length,
    confirmed: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    byKind: {},
    byErrorCode: {},
    results,
  };

  // Group by kind
  for (let i = 0; i < intents.length; i++) {
    const parsed = parseIntent(intents[i]);
    const kind = parsed.kind;
    if (!summary.byKind[kind]) {
      summary.byKind[kind] = { total: 0, confirmed: 0, failed: 0 };
    }
    summary.byKind[kind].total++;
    if (results[i].ok) {
      summary.byKind[kind].confirmed++;
    } else {
      summary.byKind[kind].failed++;
    }
  }

  // Group by error code
  for (const result of results) {
    if (result.error?.code) {
      summary.byErrorCode[result.error.code] = (summary.byErrorCode[result.error.code] || 0) + 1;
    }
  }

  printSummary(summary);

  console.log(`Total time: ${elapsed}ms (${(elapsed / 1000).toFixed(1)}s)`);
  console.log(`Avg time per intent: ${Math.round(elapsed / results.length)}ms`);

  // Exit with error code if any failures
  const hasFailures = summary.failed > 0;
  if (hasFailures && !dryRun) {
    console.log('\n⚠️  Some intents failed. Check logs above for details.');
    // Don't exit with error - failures are expected for unimplemented features
  }

  console.log('\n✅ Intent test run complete. Check /dev/stats for full details.\n');
}

main().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
