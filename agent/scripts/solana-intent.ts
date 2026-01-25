#!/usr/bin/env npx tsx
/**
 * Solana Intent-to-Execution CLI Script
 *
 * Transforms natural language intent into a Solana devnet transaction.
 * MVP: SOL transfer as baseline proof of Solana chain execution capability.
 *
 * Usage:
 *   npx tsx agent/scripts/solana-intent.ts \
 *     --intent "Send 0.01 SOL to <pubkey>" \
 *     --from <pubkey>
 *
 * Note: This script generates unsigned transactions for signing by external wallet.
 *       For testing, use --execute with SOLANA_PRIVATE_KEY env var.
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { config } from 'dotenv';
import { parseArgs } from 'util';
import * as crypto from 'crypto';

// Setup paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const agentDir = resolve(__dirname, '..');
const rootDir = resolve(agentDir, '..');

// Load environment
config({ path: resolve(agentDir, '.env.local') });
config({ path: resolve(rootDir, '.env.local') });

// Import Solana client
import { createSolanaClient, SolanaClient } from '../src/solana/solanaClient';

const LAMPORTS_PER_SOL = 1_000_000_000;

interface ParsedIntent {
  action: 'transfer' | 'airdrop' | 'balance' | 'unknown';
  amount?: number;
  recipient?: string;
  fromPubkey?: string;
}

interface ExecutionPlan {
  chain: 'solana';
  network: 'devnet';
  intent: string;
  parsedIntent: ParsedIntent;
  transaction?: {
    type: string;
    from?: string;
    to?: string;
    lamports?: number;
    blockhash?: string;
  };
  signature?: string;
  status?: 'pending' | 'confirmed' | 'finalized' | 'failed';
  explorerUrl?: string;
}

/**
 * Parse natural language intent for Solana
 */
function parseIntent(intent: string, fromPubkey?: string): ParsedIntent {
  const lower = intent.toLowerCase();

  // Pattern: "Send X SOL to <pubkey>"
  const sendMatch = intent.match(/send\s+(\d+\.?\d*)\s*SOL\s+to\s+([A-Za-z0-9]{32,44})/i);
  if (sendMatch) {
    return {
      action: 'transfer',
      amount: parseFloat(sendMatch[1]),
      recipient: sendMatch[2],
      fromPubkey,
    };
  }

  // Pattern: "Airdrop X SOL to <pubkey>"
  const airdropMatch = intent.match(/airdrop\s+(\d+\.?\d*)\s*SOL\s+to\s+([A-Za-z0-9]{32,44})/i);
  if (airdropMatch) {
    return {
      action: 'airdrop',
      amount: parseFloat(airdropMatch[1]),
      recipient: airdropMatch[2],
    };
  }

  // Pattern: "Balance of <pubkey>"
  const balanceMatch = intent.match(/balance\s+(?:of\s+)?([A-Za-z0-9]{32,44})/i);
  if (balanceMatch) {
    return {
      action: 'balance',
      recipient: balanceMatch[1],
    };
  }

  // Pattern: "Check balance" (use from pubkey)
  if (lower.includes('balance') && fromPubkey) {
    return {
      action: 'balance',
      recipient: fromPubkey,
    };
  }

  return { action: 'unknown' };
}

/**
 * Execute a balance check
 */
async function executeBalance(
  client: SolanaClient,
  pubkey: string
): Promise<{ lamports: number; sol: number }> {
  return client.getBalance(pubkey);
}

/**
 * Execute an airdrop (devnet only)
 */
async function executeAirdrop(
  client: SolanaClient,
  pubkey: string,
  lamports: number
): Promise<string> {
  console.log(`Requesting airdrop of ${lamports / LAMPORTS_PER_SOL} SOL to ${pubkey}...`);
  const signature = await client.requestAirdrop(pubkey, lamports);
  console.log(`Airdrop requested. Signature: ${signature}`);

  // Wait for confirmation
  console.log('Waiting for confirmation...');
  const result = await client.confirmTransaction(signature, 'confirmed');
  console.log(`Airdrop confirmed at slot ${result.slot}`);

  return signature;
}

/**
 * Build a transfer transaction (returns transaction data for signing)
 */
async function buildTransferTransaction(
  client: SolanaClient,
  fromPubkey: string,
  toPubkey: string,
  lamports: number
): Promise<{
  blockhash: string;
  lastValidBlockHeight: number;
  from: string;
  to: string;
  lamports: number;
}> {
  const { blockhash, lastValidBlockHeight } = await client.getRecentBlockhash();

  return {
    blockhash,
    lastValidBlockHeight,
    from: fromPubkey,
    to: toPubkey,
    lamports,
  };
}

async function main() {
  console.log('\n🌸 Blossom Solana Intent-to-Execution CLI\n');

  // Parse arguments
  const { values } = parseArgs({
    options: {
      intent: { type: 'string', short: 'i' },
      from: { type: 'string', short: 'f' },
      execute: { type: 'boolean', short: 'e', default: false },
      rpc: { type: 'string', short: 'r' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });

  if (values.help || !values.intent) {
    console.log(`Usage:
  npx tsx agent/scripts/solana-intent.ts \\
    --intent "Send 0.01 SOL to <pubkey>" \\
    --from <pubkey> \\
    [--execute] \\
    [--rpc <url>]

Options:
  --intent, -i   Natural language execution intent (required)
  --from, -f     From pubkey (required for transfers)
  --execute, -e  Execute the transaction (requires SOLANA_PRIVATE_KEY env var)
  --rpc, -r      Custom RPC URL (default: https://api.devnet.solana.com)
  --help, -h     Show this help

Examples:
  # Check balance
  npx tsx agent/scripts/solana-intent.ts --intent "Balance of <pubkey>"

  # Request devnet airdrop
  npx tsx agent/scripts/solana-intent.ts --intent "Airdrop 1 SOL to <pubkey>"

  # Build transfer transaction
  npx tsx agent/scripts/solana-intent.ts --intent "Send 0.01 SOL to <recipient>" --from <sender>
`);
    process.exit(values.help ? 0 : 1);
  }

  const intent = values.intent;
  const fromPubkey = values.from;
  const executeMode = values.execute;
  const rpcUrl = values.rpc || process.env.SOLANA_RPC_URL;

  console.log(`Intent: "${intent}"`);
  console.log(`From:   ${fromPubkey || '(not specified)'}`);
  console.log(`RPC:    ${rpcUrl || 'https://api.devnet.solana.com'}`);
  console.log(`Mode:   ${executeMode ? 'EXECUTE' : 'DRY_RUN'}`);
  console.log();

  // Create Solana client
  const client = createSolanaClient(rpcUrl);

  // Check connectivity
  console.log('🔗 Checking Solana devnet connectivity...');
  const healthy = await client.isHealthy();
  if (!healthy) {
    console.error('❌ Cannot connect to Solana devnet');
    process.exit(1);
  }
  const slot = await client.getSlot();
  console.log(`✅ Connected to Solana devnet (slot: ${slot})\n`);

  // Parse intent
  console.log('📝 Parsing intent...');
  const parsedIntent = parseIntent(intent, fromPubkey);
  console.log(`   Action: ${parsedIntent.action}`);
  if (parsedIntent.amount) console.log(`   Amount: ${parsedIntent.amount} SOL`);
  if (parsedIntent.recipient) console.log(`   Target: ${parsedIntent.recipient}`);
  console.log();

  // Build execution plan
  const plan: ExecutionPlan = {
    chain: 'solana',
    network: 'devnet',
    intent,
    parsedIntent,
  };

  // Execute based on action type
  switch (parsedIntent.action) {
    case 'balance': {
      if (!parsedIntent.recipient) {
        console.error('❌ No pubkey specified for balance check');
        process.exit(1);
      }
      const balance = await executeBalance(client, parsedIntent.recipient);
      console.log('💰 Balance Result:');
      console.log(`   Pubkey:   ${parsedIntent.recipient}`);
      console.log(`   Lamports: ${balance.lamports}`);
      console.log(`   SOL:      ${balance.sol}`);
      plan.status = 'confirmed';
      break;
    }

    case 'airdrop': {
      if (!parsedIntent.recipient || !parsedIntent.amount) {
        console.error('❌ Missing recipient or amount for airdrop');
        process.exit(1);
      }
      const lamports = Math.floor(parsedIntent.amount * LAMPORTS_PER_SOL);

      if (executeMode) {
        console.log('🚀 Executing airdrop...');
        const signature = await executeAirdrop(client, parsedIntent.recipient, lamports);
        plan.signature = signature;
        plan.status = 'confirmed';
        plan.explorerUrl = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
        console.log(`\n✅ Airdrop complete!`);
        console.log(`   Signature: ${signature}`);
        console.log(`   Explorer:  ${plan.explorerUrl}`);
      } else {
        console.log('📋 DRY_RUN: Would request airdrop');
        console.log(`   To:       ${parsedIntent.recipient}`);
        console.log(`   Lamports: ${lamports}`);
        plan.status = 'pending';
      }
      break;
    }

    case 'transfer': {
      if (!parsedIntent.fromPubkey || !parsedIntent.recipient || !parsedIntent.amount) {
        console.error('❌ Missing from, to, or amount for transfer');
        process.exit(1);
      }
      const lamports = Math.floor(parsedIntent.amount * LAMPORTS_PER_SOL);

      // Build transaction data
      const txData = await buildTransferTransaction(
        client,
        parsedIntent.fromPubkey,
        parsedIntent.recipient,
        lamports
      );

      plan.transaction = {
        type: 'transfer',
        from: txData.from,
        to: txData.to,
        lamports: txData.lamports,
        blockhash: txData.blockhash,
      };

      console.log('📋 Transfer Transaction Built:');
      console.log(`   From:      ${txData.from}`);
      console.log(`   To:        ${txData.to}`);
      console.log(`   Lamports:  ${txData.lamports}`);
      console.log(`   Blockhash: ${txData.blockhash}`);
      console.log(`   Valid until block: ${txData.lastValidBlockHeight}`);

      if (executeMode) {
        console.log('\n⚠️  Execute mode for transfers requires signing.');
        console.log('   Set SOLANA_PRIVATE_KEY env var and implement signing.');
        plan.status = 'pending';
      } else {
        console.log('\n📋 DRY_RUN: Transaction data ready for signing');
        plan.status = 'pending';
      }
      break;
    }

    default:
      console.error(`❌ Unknown intent: "${intent}"`);
      console.log('   Supported intents:');
      console.log('   - "Balance of <pubkey>"');
      console.log('   - "Airdrop X SOL to <pubkey>"');
      console.log('   - "Send X SOL to <pubkey>"');
      process.exit(1);
  }

  // Output final plan
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('EXECUTION PLAN JSON:');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(JSON.stringify(plan, null, 2));

  return plan;
}

main().catch(console.error);
