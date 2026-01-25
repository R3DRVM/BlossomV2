#!/usr/bin/env npx tsx
/**
 * Solana Dev Wallet Generator
 *
 * Generates a new Solana keypair for devnet testing.
 * Outputs the public key (safe to share) and private key (keep secret).
 *
 * Usage:
 *   npx tsx agent/scripts/solana-generate-dev-wallet.ts [--label <name>] [--register]
 *
 * Options:
 *   --label, -l    Label for this wallet (default: "dev-wallet")
 *   --register, -r Register wallet in execution ledger
 *   --primary, -p  Set as primary wallet for Solana devnet
 *   --help, -h     Show this help
 *
 * Security:
 *   - Private key is printed ONCE to stdout
 *   - Store in .env.local as SOLANA_PRIVATE_KEY
 *   - NEVER commit private keys to git
 */

import { parseArgs } from 'util';
import * as crypto from 'crypto';

// Lazy import for ledger (optional)
let ledgerDb: typeof import('../execution-ledger/db') | null = null;

async function loadLedger() {
  if (!ledgerDb) {
    try {
      ledgerDb = await import('../execution-ledger/db');
    } catch {
      console.warn('Warning: Execution ledger not available');
    }
  }
  return ledgerDb;
}

/**
 * Generate a Solana keypair using Node.js crypto
 * Ed25519 keypair compatible with Solana
 */
function generateKeypair(): { publicKey: string; secretKey: string } {
  // Generate Ed25519 keypair
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });

  // Extract raw 32-byte keys from DER encoding
  // SPKI format for Ed25519: 12 byte header + 32 byte key
  const rawPublicKey = publicKey.slice(-32);

  // PKCS8 format for Ed25519: 16 byte header + 32 byte key
  const rawPrivateKey = privateKey.slice(-32);

  // Solana expects 64-byte secret key (private + public concatenated)
  const secretKey = Buffer.concat([rawPrivateKey, rawPublicKey]);

  // Convert public key to base58 (Solana address format)
  const publicKeyBase58 = base58Encode(rawPublicKey);

  // Secret key as base58 (for storage)
  const secretKeyBase58 = base58Encode(secretKey);

  return {
    publicKey: publicKeyBase58,
    secretKey: secretKeyBase58,
  };
}

/**
 * Base58 encoding (Bitcoin/Solana alphabet)
 */
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(buffer: Buffer): string {
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

async function main() {
  console.log('\n🔐 Solana Dev Wallet Generator\n');

  // Parse arguments
  const { values } = parseArgs({
    options: {
      label: { type: 'string', short: 'l', default: 'dev-wallet' },
      register: { type: 'boolean', short: 'r', default: false },
      primary: { type: 'boolean', short: 'p', default: false },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`Usage:
  npx tsx agent/scripts/solana-generate-dev-wallet.ts [options]

Options:
  --label, -l    Label for this wallet (default: "dev-wallet")
  --register, -r Register wallet in execution ledger
  --primary, -p  Set as primary wallet for Solana devnet
  --help, -h     Show this help

Examples:
  # Generate a new wallet
  npx tsx agent/scripts/solana-generate-dev-wallet.ts

  # Generate and register as primary
  npx tsx agent/scripts/solana-generate-dev-wallet.ts --register --primary --label "main-dev"

Security:
  - Store private key in agent/.env.local as SOLANA_PRIVATE_KEY
  - NEVER commit private keys to git
  - Use devnet faucet for test SOL: https://faucet.solana.com
`);
    process.exit(0);
  }

  const label = values.label || 'dev-wallet';

  // Generate keypair
  console.log('Generating Ed25519 keypair...\n');
  const keypair = generateKeypair();

  console.log('═══════════════════════════════════════════════════════════');
  console.log('                    NEW SOLANA WALLET');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Label:      ${label}`);
  console.log(`Network:    devnet`);
  console.log(`Public Key: ${keypair.publicKey}`);
  console.log('');
  console.log('─────────────────────────────────────────────────────────────');
  console.log('SECRET KEY (save this, shown only once):');
  console.log('─────────────────────────────────────────────────────────────');
  console.log(keypair.secretKey);
  console.log('─────────────────────────────────────────────────────────────\n');

  // Register in ledger if requested
  if (values.register) {
    const ledger = await loadLedger();
    if (ledger) {
      ledger.registerWallet({
        chain: 'solana',
        network: 'devnet',
        address: keypair.publicKey,
        label,
        isPrimary: values.primary,
      });
      console.log('✅ Registered in execution ledger');
      if (values.primary) {
        console.log('   Set as PRIMARY wallet for Solana devnet');
      }
    }
  }

  console.log('\n📋 Next steps:');
  console.log('   1. Add to agent/.env.local:');
  console.log(`      SOLANA_DEVNET_PUBKEY=${keypair.publicKey}`);
  console.log(`      SOLANA_PRIVATE_KEY=${keypair.secretKey}`);
  console.log('');
  console.log('   2. Fund with devnet SOL:');
  console.log(`      https://faucet.solana.com/?address=${keypair.publicKey}`);
  console.log('');
  console.log('   3. Verify balance:');
  console.log(`      npx tsx agent/scripts/solana-intent.ts --intent "Balance of ${keypair.publicKey}"`);
  console.log('');
}

main().catch(console.error);
