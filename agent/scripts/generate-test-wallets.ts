#!/usr/bin/env npx tsx
// @ts-nocheck
/**
 * Test Wallet Generator for Blossom
 *
 * Generates test wallets for both EVM (Ethereum/Sepolia) and Solana (devnet).
 *
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 * !!! WARNING: FOR TESTNET/DEVNET USE ONLY !!!
 * !!! NEVER use these wallets for mainnet funds !!!
 * !!! Private keys are exported - treat as compromised for mainnet !!!
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 *
 * Usage:
 *   npx tsx agent/scripts/generate-test-wallets.ts [options]
 *
 * Options:
 *   --count, -c     Number of wallets to generate (default: 20)
 *   --chain, -t     Chain type: "evm", "solana", or "both" (default: "both")
 *   --output, -o    Output JSON file path (default: "./test-wallets.json")
 *   --airdrop, -a   Request Solana devnet airdrops (1 SOL each)
 *   --help, -h      Show this help
 *
 * Examples:
 *   # Generate 20 wallets for both chains
 *   npx tsx agent/scripts/generate-test-wallets.ts
 *
 *   # Generate 10 EVM-only wallets
 *   npx tsx agent/scripts/generate-test-wallets.ts --count 10 --chain evm
 *
 *   # Generate 5 Solana wallets with airdrops
 *   npx tsx agent/scripts/generate-test-wallets.ts --count 5 --chain solana --airdrop
 *
 *   # Custom output file
 *   npx tsx agent/scripts/generate-test-wallets.ts --output ./my-wallets.json
 */

import { parseArgs } from 'util';
import * as fs from 'fs';
import * as path from 'path';

// Viem imports for EVM wallet generation
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

// Solana imports
import { Keypair, Connection, LAMPORTS_PER_SOL, clusterApiUrl } from '@solana/web3.js';

// ============================================================================
// Types
// ============================================================================

interface EVMWallet {
  chain: 'evm';
  network: 'sepolia' | 'goerli' | 'holesky';
  address: string;
  privateKey: string;
  createdAt: string;
}

interface SolanaWallet {
  chain: 'solana';
  network: 'devnet';
  address: string;
  privateKey: string; // Base58 encoded
  secretKeyArray: number[]; // For Phantom/Solana CLI import
  createdAt: string;
  airdropStatus?: 'pending' | 'success' | 'failed';
  airdropSignature?: string;
}

interface WalletOutput {
  warning: string;
  generatedAt: string;
  totalCount: number;
  evmWallets: EVMWallet[];
  solanaWallets: SolanaWallet[];
  faucets: {
    sepolia: string[];
    solanaDevnet: string[];
  };
}

// ============================================================================
// Base58 Encoding (for Solana)
// ============================================================================

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(buffer: Uint8Array): string {
  const digits = [0];

  for (let i = 0; i < buffer.length; i++) {
    let carry = buffer[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  // Leading zeros
  let output = '';
  for (let i = 0; i < buffer.length && buffer[i] === 0; i++) {
    output += BASE58_ALPHABET[0];
  }

  // Convert digits to string (reverse order)
  for (let i = digits.length - 1; i >= 0; i--) {
    output += BASE58_ALPHABET[digits[i]];
  }

  return output;
}

// ============================================================================
// EVM Wallet Generation
// ============================================================================

function generateEVMWallets(count: number): EVMWallet[] {
  console.log(`\nGenerating ${count} EVM wallets...`);
  const wallets: EVMWallet[] = [];

  for (let i = 0; i < count; i++) {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    wallets.push({
      chain: 'evm',
      network: 'sepolia',
      address: account.address,
      privateKey: privateKey,
      createdAt: new Date().toISOString(),
    });

    // Progress indicator
    if ((i + 1) % 5 === 0 || i === count - 1) {
      process.stdout.write(`  Generated ${i + 1}/${count} EVM wallets\r`);
    }
  }

  console.log(`  Generated ${count}/${count} EVM wallets`);
  return wallets;
}

// ============================================================================
// Solana Wallet Generation
// ============================================================================

function generateSolanaWallets(count: number): SolanaWallet[] {
  console.log(`\nGenerating ${count} Solana wallets...`);
  const wallets: SolanaWallet[] = [];

  for (let i = 0; i < count; i++) {
    const keypair = Keypair.generate();

    wallets.push({
      chain: 'solana',
      network: 'devnet',
      address: keypair.publicKey.toBase58(),
      privateKey: base58Encode(keypair.secretKey),
      secretKeyArray: Array.from(keypair.secretKey),
      createdAt: new Date().toISOString(),
    });

    // Progress indicator
    if ((i + 1) % 5 === 0 || i === count - 1) {
      process.stdout.write(`  Generated ${i + 1}/${count} Solana wallets\r`);
    }
  }

  console.log(`  Generated ${count}/${count} Solana wallets`);
  return wallets;
}

// ============================================================================
// Solana Devnet Airdrop
// ============================================================================

async function requestSolanaAirdrops(wallets: SolanaWallet[]): Promise<SolanaWallet[]> {
  console.log(`\nRequesting Solana devnet airdrops for ${wallets.length} wallets...`);
  console.log('  (1 SOL per wallet, rate limited to avoid throttling)\n');

  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];

    try {
      console.log(`  [${i + 1}/${wallets.length}] Requesting airdrop for ${wallet.address.slice(0, 8)}...`);

      // Reconstruct keypair from secret key array
      const keypair = Keypair.fromSecretKey(new Uint8Array(wallet.secretKeyArray));

      const signature = await connection.requestAirdrop(
        keypair.publicKey,
        1 * LAMPORTS_PER_SOL
      );

      // Wait for confirmation
      await connection.confirmTransaction(signature, 'confirmed');

      wallet.airdropStatus = 'success';
      wallet.airdropSignature = signature;
      console.log(`      Success! Signature: ${signature.slice(0, 20)}...`);

      // Rate limiting: wait 1 second between requests to avoid throttling
      if (i < wallets.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (error: any) {
      wallet.airdropStatus = 'failed';
      console.log(`      Failed: ${error.message || 'Unknown error'}`);

      // If rate limited, wait longer
      if (error.message?.includes('429') || error.message?.includes('rate')) {
        console.log('      Rate limited, waiting 10 seconds...');
        await new Promise((resolve) => setTimeout(resolve, 10000));
      }
    }
  }

  const successCount = wallets.filter((w) => w.airdropStatus === 'success').length;
  console.log(`\nAirdrop complete: ${successCount}/${wallets.length} successful`);

  return wallets;
}

// ============================================================================
// Output Functions
// ============================================================================

function printSummary(evmWallets: EVMWallet[], solanaWallets: SolanaWallet[]) {
  console.log('\n' + '='.repeat(70));
  console.log('                         WALLET SUMMARY');
  console.log('='.repeat(70));

  if (evmWallets.length > 0) {
    console.log('\n--- EVM Wallets (Sepolia) ---\n');
    console.log('  #  | Address                                    | Private Key (first 10 chars)');
    console.log('  ---+--------------------------------------------+------------------------------');
    evmWallets.forEach((w, i) => {
      console.log(`  ${String(i + 1).padStart(2)} | ${w.address} | ${w.privateKey.slice(0, 12)}...`);
    });
  }

  if (solanaWallets.length > 0) {
    console.log('\n--- Solana Wallets (Devnet) ---\n');
    console.log('  #  | Address                                      | Airdrop Status');
    console.log('  ---+----------------------------------------------+----------------');
    solanaWallets.forEach((w, i) => {
      const status = w.airdropStatus || 'not requested';
      console.log(`  ${String(i + 1).padStart(2)} | ${w.address.slice(0, 44)} | ${status}`);
    });
  }

  console.log('\n' + '='.repeat(70));
}

function printFaucetInfo() {
  console.log('\n' + '='.repeat(70));
  console.log('                         FAUCET INFORMATION');
  console.log('='.repeat(70));

  console.log('\n--- Sepolia ETH Faucets ---\n');
  console.log('  1. Alchemy Sepolia Faucet (recommended):');
  console.log('     https://sepoliafaucet.com/');
  console.log('');
  console.log('  2. Infura Sepolia Faucet:');
  console.log('     https://www.infura.io/faucet/sepolia');
  console.log('');
  console.log('  3. Google Cloud Sepolia Faucet:');
  console.log('     https://cloud.google.com/application/web3/faucet/ethereum/sepolia');
  console.log('');
  console.log('  4. QuickNode Sepolia Faucet:');
  console.log('     https://faucet.quicknode.com/ethereum/sepolia');
  console.log('');
  console.log('  5. Chainlink Faucets:');
  console.log('     https://faucets.chain.link/sepolia');

  console.log('\n--- Solana Devnet Funding ---\n');
  console.log('  1. Web Faucet:');
  console.log('     https://faucet.solana.com/');
  console.log('');
  console.log('  2. CLI Airdrop Command:');
  console.log('     solana airdrop 1 <WALLET_ADDRESS> --url devnet');
  console.log('');
  console.log('  3. Programmatic (this script with --airdrop flag):');
  console.log('     npx tsx agent/scripts/generate-test-wallets.ts --chain solana --airdrop');
  console.log('');
  console.log('  4. SOL Faucet API:');
  console.log('     curl -X POST https://api.devnet.solana.com -H "Content-Type: application/json" \\');
  console.log('       -d \'{"jsonrpc":"2.0","id":1,"method":"requestAirdrop","params":["<ADDRESS>",1000000000]}\'');

  console.log('\n' + '='.repeat(70));
}

function saveToFile(
  outputPath: string,
  evmWallets: EVMWallet[],
  solanaWallets: SolanaWallet[]
) {
  const output: WalletOutput = {
    warning:
      'TESTNET/DEVNET ONLY! Never use these wallets for mainnet. Private keys are exposed.',
    generatedAt: new Date().toISOString(),
    totalCount: evmWallets.length + solanaWallets.length,
    evmWallets,
    solanaWallets,
    faucets: {
      sepolia: [
        'https://sepoliafaucet.com/',
        'https://www.infura.io/faucet/sepolia',
        'https://cloud.google.com/application/web3/faucet/ethereum/sepolia',
        'https://faucet.quicknode.com/ethereum/sepolia',
        'https://faucets.chain.link/sepolia',
      ],
      solanaDevnet: [
        'https://faucet.solana.com/',
        'solana airdrop 1 <ADDRESS> --url devnet',
      ],
    },
  };

  const absolutePath = path.resolve(outputPath);
  fs.writeFileSync(absolutePath, JSON.stringify(output, null, 2));
  console.log(`\nWallet data saved to: ${absolutePath}`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('\n' + '!'.repeat(70));
  console.log('!!!  WARNING: TEST WALLET GENERATOR - FOR TESTNET/DEVNET ONLY  !!!');
  console.log('!!!  NEVER use these wallets for mainnet funds!                !!!');
  console.log('!!!  Private keys are exported and should be treated as        !!!');
  console.log('!!!  compromised for any real-value transactions.              !!!');
  console.log('!'.repeat(70));

  // Parse arguments
  const { values } = parseArgs({
    options: {
      count: { type: 'string', short: 'c', default: '20' },
      chain: { type: 'string', short: 't', default: 'both' },
      output: { type: 'string', short: 'o', default: './test-wallets.json' },
      airdrop: { type: 'boolean', short: 'a', default: false },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`
Usage:
  npx tsx agent/scripts/generate-test-wallets.ts [options]

Options:
  --count, -c     Number of wallets to generate (default: 20)
  --chain, -t     Chain type: "evm", "solana", or "both" (default: "both")
  --output, -o    Output JSON file path (default: "./test-wallets.json")
  --airdrop, -a   Request Solana devnet airdrops (1 SOL each)
  --help, -h      Show this help

Examples:
  # Generate 20 wallets for both chains
  npx tsx agent/scripts/generate-test-wallets.ts

  # Generate 10 EVM-only wallets
  npx tsx agent/scripts/generate-test-wallets.ts --count 10 --chain evm

  # Generate 5 Solana wallets with airdrops
  npx tsx agent/scripts/generate-test-wallets.ts --count 5 --chain solana --airdrop

  # Custom output file
  npx tsx agent/scripts/generate-test-wallets.ts --output ./my-wallets.json

Security Notes:
  - Generated wallets are for TESTNET/DEVNET only
  - Private keys are exposed in output - never use for mainnet
  - Add test-wallets.json to .gitignore
`);
    process.exit(0);
  }

  const count = parseInt(values.count || '20', 10);
  const chainType = (values.chain || 'both').toLowerCase();
  const outputPath = values.output || './test-wallets.json';
  const requestAirdrops = values.airdrop || false;

  if (isNaN(count) || count < 1) {
    console.error('Error: --count must be a positive integer');
    process.exit(1);
  }

  if (!['evm', 'solana', 'both'].includes(chainType)) {
    console.error('Error: --chain must be "evm", "solana", or "both"');
    process.exit(1);
  }

  console.log(`\nConfiguration:`);
  console.log(`  Wallet count: ${count}`);
  console.log(`  Chain type:   ${chainType}`);
  console.log(`  Output file:  ${outputPath}`);
  console.log(`  Airdrop:      ${requestAirdrops ? 'Yes (Solana devnet)' : 'No'}`);

  let evmWallets: EVMWallet[] = [];
  let solanaWallets: SolanaWallet[] = [];

  // Generate wallets based on chain type
  if (chainType === 'evm' || chainType === 'both') {
    evmWallets = generateEVMWallets(count);
  }

  if (chainType === 'solana' || chainType === 'both') {
    solanaWallets = generateSolanaWallets(count);

    if (requestAirdrops && solanaWallets.length > 0) {
      solanaWallets = await requestSolanaAirdrops(solanaWallets);
    }
  }

  // Print summary
  printSummary(evmWallets, solanaWallets);

  // Print faucet info
  printFaucetInfo();

  // Save to file
  saveToFile(outputPath, evmWallets, solanaWallets);

  // Final security reminder
  console.log('\n' + '!'.repeat(70));
  console.log('!!!  REMINDER: These wallets are for TESTNET/DEVNET only!      !!!');
  console.log('!!!  Add the output file to .gitignore to prevent accidental   !!!');
  console.log('!!!  commits of private keys.                                  !!!');
  console.log('!'.repeat(70) + '\n');

  console.log('Quick Commands:\n');

  if (evmWallets.length > 0) {
    console.log('  Fund first EVM wallet on Sepolia:');
    console.log(`    Visit: https://sepoliafaucet.com/`);
    console.log(`    Address: ${evmWallets[0].address}\n`);
  }

  if (solanaWallets.length > 0) {
    console.log('  Fund first Solana wallet on Devnet:');
    console.log(`    solana airdrop 1 ${solanaWallets[0].address} --url devnet\n`);
  }

  console.log('  View saved wallets:');
  console.log(`    cat ${path.resolve(outputPath)}\n`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
