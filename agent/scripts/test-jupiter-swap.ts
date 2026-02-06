#!/usr/bin/env npx tsx
/**
 * Jupiter Swap Test Script
 *
 * Tests the complete Jupiter swap execution path on Solana devnet.
 * This script exercises the full flow: quote -> build tx -> sign -> send -> confirm.
 *
 * Usage:
 *   npx tsx agent/scripts/test-jupiter-swap.ts [options]
 *
 * Options:
 *   --dry-run, -d     Only fetch quote, don't execute swap
 *   --amount, -a      Amount to swap (default: 0.01 SOL)
 *   --from, -f        Input token (default: SOL)
 *   --to, -t          Output token (default: USDC)
 *   --help, -h        Show this help
 *
 * Requirements:
 *   - SOLANA_PRIVATE_KEY env var (base58 encoded 64-byte secret key)
 *   - Funded wallet on devnet (at least 0.05 SOL for swap + fees)
 *
 * Example:
 *   npx tsx agent/scripts/test-jupiter-swap.ts --dry-run
 *   npx tsx agent/scripts/test-jupiter-swap.ts --amount 0.05 --from SOL --to USDC
 */

import { parseArgs } from 'util';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment
config({ path: resolve(__dirname, '../.env.local') });
config({ path: resolve(__dirname, '../../.env.local') });

// Constants
const LAMPORTS_PER_SOL = 1_000_000_000;

interface TestResult {
  step: string;
  success: boolean;
  data?: any;
  error?: string;
  latencyMs?: number;
}

async function main() {
  console.log('\n=== Jupiter Swap Test Script ===\n');

  // Parse arguments
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', short: 'd', default: false },
      amount: { type: 'string', short: 'a', default: '0.01' },
      from: { type: 'string', short: 'f', default: 'SOL' },
      to: { type: 'string', short: 't', default: 'USDC' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`Jupiter Swap Test Script

Usage:
  npx tsx agent/scripts/test-jupiter-swap.ts [options]

Options:
  --dry-run, -d     Only fetch quote, don't execute swap
  --amount, -a      Amount to swap (default: 0.01 SOL)
  --from, -f        Input token (default: SOL)
  --to, -t          Output token (default: USDC)
  --help, -h        Show this help

Prerequisites:
  1. Generate a devnet wallet:
     npx tsx agent/scripts/solana-generate-dev-wallet.ts

  2. Fund it via faucet:
     https://faucet.solana.com

  3. Add to agent/.env.local:
     SOLANA_PRIVATE_KEY=<your-base58-private-key>

Examples:
  npx tsx agent/scripts/test-jupiter-swap.ts --dry-run
  npx tsx agent/scripts/test-jupiter-swap.ts --amount 0.05 --from SOL --to USDC
`);
    process.exit(0);
  }

  const dryRun = values['dry-run'];
  const amount = values.amount || '0.01';
  const fromToken = (values.from || 'SOL').toUpperCase();
  const toToken = (values.to || 'USDC').toUpperCase();

  console.log(`Mode:       ${dryRun ? 'DRY RUN (quote only)' : 'EXECUTE'}`);
  console.log(`Swap:       ${amount} ${fromToken} -> ${toToken}`);
  console.log('');

  const results: TestResult[] = [];
  const startTime = Date.now();

  // Step 1: Check environment
  console.log('[1/6] Checking environment...');
  const privateKey = process.env.SOLANA_PRIVATE_KEY;
  if (!privateKey) {
    console.error('ERROR: SOLANA_PRIVATE_KEY not set');
    console.error('');
    console.error('To set up:');
    console.error('  1. Generate wallet: npx tsx agent/scripts/solana-generate-dev-wallet.ts');
    console.error('  2. Fund via faucet: https://faucet.solana.com');
    console.error('  3. Add to agent/.env.local: SOLANA_PRIVATE_KEY=<key>');
    process.exit(1);
  }
  results.push({ step: 'Environment check', success: true });
  console.log('      SOLANA_PRIVATE_KEY is set');

  // Step 2: Initialize executor
  console.log('[2/6] Initializing Solana executor...');
  const stepStart2 = Date.now();
  try {
    const { createSolanaExecutor } = await import('../src/solana/solanaExecutor');
    const executor = createSolanaExecutor({ privateKey });

    if (!executor.isInitialized()) {
      throw new Error('Executor failed to initialize');
    }

    const pubkey = executor.getPublicKey();
    results.push({
      step: 'Executor init',
      success: true,
      data: { pubkey },
      latencyMs: Date.now() - stepStart2,
    });
    console.log(`      Wallet: ${pubkey}`);

    // Step 3: Check balances
    console.log('[3/6] Checking balances...');
    const stepStart3 = Date.now();
    const balances = await executor.getBalances();
    results.push({
      step: 'Balance check',
      success: true,
      data: balances,
      latencyMs: Date.now() - stepStart3,
    });
    console.log(`      SOL:  ${balances.sol.uiAmount.toFixed(6)} SOL`);
    if (balances.usdc) {
      console.log(`      USDC: ${balances.usdc.uiAmount.toFixed(6)} USDC`);
    } else {
      console.log(`      USDC: 0 (no token account)`);
    }

    // Check if we have enough balance
    const amountFloat = parseFloat(amount);
    if (fromToken === 'SOL' && balances.sol.uiAmount < amountFloat + 0.01) {
      console.warn(`      WARNING: Insufficient SOL balance for swap + fees`);
      console.warn(`               Need ${amountFloat + 0.01} SOL, have ${balances.sol.uiAmount}`);
      if (!dryRun) {
        console.error('      Aborting execution. Use --dry-run to test quote only.');
        process.exit(1);
      }
    }

    // Step 4: Fetch Jupiter quote
    console.log('[4/6] Fetching Jupiter quote...');
    const stepStart4 = Date.now();
    const { getJupiterQuote, resolveTokenMint, SOLANA_TOKEN_MINTS } = await import('../src/solana/jupiter');

    const inputMint = resolveTokenMint(fromToken, true);
    const outputMint = resolveTokenMint(toToken, true);

    // Convert amount to atomic units
    const decimals = fromToken === 'SOL' ? 9 : 6;
    const amountUnits = Math.floor(amountFloat * Math.pow(10, decimals)).toString();

    console.log(`      Input mint:  ${inputMint}`);
    console.log(`      Output mint: ${outputMint}`);
    console.log(`      Amount:      ${amountUnits} (${decimals} decimals)`);

    const quote = await getJupiterQuote({
      inputMint,
      outputMint,
      amount: amountUnits,
      slippageBps: 100, // 1% slippage for devnet
    });

    if (!quote) {
      results.push({
        step: 'Jupiter quote',
        success: false,
        error: 'Failed to get quote from Jupiter API',
        latencyMs: Date.now() - stepStart4,
      });
      console.error('      ERROR: Failed to get quote from Jupiter');
      console.error('      This may happen on devnet due to limited liquidity.');
      console.error('');
      console.error('      Possible causes:');
      console.error('      - No liquidity pool for this pair on devnet');
      console.error('      - Jupiter API rate limit');
      console.error('      - Network issues');
    } else {
      const outDecimals = toToken === 'SOL' ? 9 : 6;
      const outAmount = Number(quote.outAmount) / Math.pow(10, outDecimals);
      const routes = quote.routePlan.map(r => r.swapInfo.label).join(' -> ');

      results.push({
        step: 'Jupiter quote',
        success: true,
        data: {
          inAmount: quote.inAmount,
          outAmount: quote.outAmount,
          outAmountFormatted: outAmount.toFixed(6),
          priceImpact: quote.priceImpactPct,
          routes,
        },
        latencyMs: Date.now() - stepStart4,
      });

      console.log(`      Quote received!`);
      console.log(`      Output:       ${outAmount.toFixed(6)} ${toToken}`);
      console.log(`      Price Impact: ${quote.priceImpactPct}%`);
      console.log(`      Route:        ${routes || 'Direct'}`);

      if (dryRun) {
        console.log('\n[5/6] SKIPPED (dry run mode)');
        console.log('[6/6] SKIPPED (dry run mode)');
        results.push({ step: 'Build transaction', success: true, data: 'Skipped (dry run)' });
        results.push({ step: 'Execute swap', success: true, data: 'Skipped (dry run)' });
      } else {
        // Step 5: Build transaction
        console.log('[5/6] Building swap transaction...');
        const stepStart5 = Date.now();
        const { buildJupiterSwapTransaction } = await import('../src/solana/jupiter');

        const swapTx = await buildJupiterSwapTransaction({
          quote,
          userPublicKey: pubkey!,
        });

        if (!swapTx) {
          results.push({
            step: 'Build transaction',
            success: false,
            error: 'Failed to build swap transaction',
            latencyMs: Date.now() - stepStart5,
          });
          console.error('      ERROR: Failed to build swap transaction');
        } else {
          results.push({
            step: 'Build transaction',
            success: true,
            data: {
              lastValidBlockHeight: swapTx.lastValidBlockHeight,
              txSize: swapTx.swapTransaction.length,
            },
            latencyMs: Date.now() - stepStart5,
          });
          console.log(`      Transaction built (${swapTx.swapTransaction.length} bytes)`);
          console.log(`      Valid until block: ${swapTx.lastValidBlockHeight}`);

          // Step 6: Execute swap
          console.log('[6/6] Executing swap...');
          const stepStart6 = Date.now();

          const swapResult = await executor.executeSwap({
            inputToken: fromToken,
            outputToken: toToken,
            amount: amountUnits,
            slippageBps: 100,
          });

          if (swapResult.ok) {
            results.push({
              step: 'Execute swap',
              success: true,
              data: {
                signature: swapResult.signature,
                explorerUrl: swapResult.explorerUrl,
                slot: swapResult.slot,
                metadata: swapResult.metadata,
              },
              latencyMs: Date.now() - stepStart6,
            });
            console.log(`      SUCCESS!`);
            console.log(`      Signature: ${swapResult.signature}`);
            console.log(`      Explorer:  ${swapResult.explorerUrl}`);
            console.log(`      Slot:      ${swapResult.slot}`);
          } else {
            results.push({
              step: 'Execute swap',
              success: false,
              error: swapResult.error?.message || 'Unknown error',
              latencyMs: Date.now() - stepStart6,
            });
            console.error(`      ERROR: ${swapResult.error?.code}`);
            console.error(`      ${swapResult.error?.message}`);
          }
        }
      }
    }
  } catch (error: any) {
    results.push({
      step: 'Executor init',
      success: false,
      error: error.message,
    });
    console.error(`      ERROR: ${error.message}`);
  }

  // Summary
  const totalLatency = Date.now() - startTime;
  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;

  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total time: ${totalLatency}ms`);
  console.log(`Steps:      ${successCount} passed, ${failCount} failed`);
  console.log('');

  for (const result of results) {
    const icon = result.success ? 'PASS' : 'FAIL';
    const latency = result.latencyMs ? ` (${result.latencyMs}ms)` : '';
    console.log(`  [${icon}] ${result.step}${latency}`);
    if (!result.success && result.error) {
      console.log(`         Error: ${result.error}`);
    }
  }

  console.log('\n' + '='.repeat(60));

  if (failCount > 0) {
    console.log('\nSome tests FAILED. Check the errors above.\n');
    process.exit(1);
  } else {
    console.log('\nAll tests PASSED!\n');
    if (dryRun) {
      console.log('Run without --dry-run to execute actual swap.\n');
    }
    process.exit(0);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
