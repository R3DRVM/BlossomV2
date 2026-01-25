#!/usr/bin/env npx tsx
/**
 * Solana Ledger Smoke Test
 *
 * Sends a real SOL transfer on devnet and logs it to the execution ledger.
 * This proves end-to-end: intent → execute → ledger record → dashboard visibility.
 *
 * Usage:
 *   npx tsx agent/scripts/solana-ledger-smoke.ts
 *
 * Requirements:
 *   - SOLANA_PRIVATE_KEY env var (base58 encoded 64-byte secret key)
 *   - Funded wallet on devnet (at least 0.01 SOL + fees)
 */

import * as crypto from 'crypto';

// Load environment
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '../.env.local') });

// Constants
const DEVNET_RPC = 'https://api.devnet.solana.com';
const LAMPORTS_PER_SOL = 1_000_000_000;
const TRANSFER_AMOUNT_SOL = 0.001; // 0.001 SOL = 1,000,000 lamports
const SOL_USD_ESTIMATE = 100; // Hardcoded estimate

// Base58 alphabet
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(str: string): Buffer {
  const bytes = [0];
  for (const char of str) {
    let value = BASE58_ALPHABET.indexOf(char);
    if (value === -1) throw new Error(`Invalid base58 character: ${char}`);

    for (let i = 0; i < bytes.length; i++) {
      const product = bytes[i] * 58 + value;
      bytes[i] = product % 256;
      value = Math.floor(product / 256);
    }
    while (value > 0) {
      bytes.push(value % 256);
      value = Math.floor(value / 256);
    }
  }

  // Add leading zeros
  for (const char of str) {
    if (char !== '1') break;
    bytes.push(0);
  }

  return Buffer.from(bytes.reverse());
}

function base58Encode(buffer: Buffer): string {
  const digits = [0];

  for (let i = 0; i < buffer.length; i++) {
    let carry = buffer[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let output = '';
  for (let i = 0; i < buffer.length && buffer[i] === 0; i++) {
    output += BASE58_ALPHABET[0];
  }

  for (let i = digits.length - 1; i >= 0; i--) {
    output += BASE58_ALPHABET[digits[i]];
  }

  return output;
}

/**
 * Generate a new ephemeral keypair for the recipient
 */
function generateEphemeralKeypair(): { publicKey: string; secretKey: Buffer } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });

  const rawPublicKey = publicKey.slice(-32);
  const rawPrivateKey = privateKey.slice(-32);
  const secretKey = Buffer.concat([rawPrivateKey, rawPublicKey]);

  return {
    publicKey: base58Encode(rawPublicKey),
    secretKey,
  };
}

/**
 * Parse a base58-encoded secret key
 */
function parseSecretKey(base58Key: string): { publicKey: Buffer; privateKey: Buffer; secretKey: Buffer } {
  const secretKey = base58Decode(base58Key);
  if (secretKey.length !== 64) {
    throw new Error(`Invalid secret key length: ${secretKey.length}, expected 64`);
  }

  const privateKey = secretKey.slice(0, 32);
  const publicKey = secretKey.slice(32, 64);

  return { publicKey, privateKey, secretKey };
}

/**
 * RPC call helper
 */
async function rpcCall<T>(method: string, params: any[] = []): Promise<T> {
  const response = await fetch(DEVNET_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(`Solana RPC error: ${data.error.message}`);
  }

  return data.result;
}

/**
 * Get balance
 */
async function getBalance(pubkey: string): Promise<number> {
  const result = await rpcCall<{ value: number }>('getBalance', [pubkey]);
  return result.value;
}

/**
 * Get latest blockhash
 */
async function getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  const result = await rpcCall<{
    value: { blockhash: string; lastValidBlockHeight: number };
  }>('getLatestBlockhash', [{ commitment: 'finalized' }]);
  return result.value;
}

/**
 * Build a SOL transfer transaction (manual serialization)
 * System Program Transfer instruction
 */
function buildTransferTransaction(
  fromPubkey: Buffer,
  toPubkey: Buffer,
  lamports: number,
  recentBlockhash: string
): Buffer {
  // System Program ID (all zeros)
  const systemProgramId = Buffer.alloc(32);

  // Compact-u16 encoding helper
  function encodeCompactU16(value: number): Buffer {
    if (value < 128) {
      return Buffer.from([value]);
    } else if (value < 16384) {
      return Buffer.from([
        (value & 0x7f) | 0x80,
        value >> 7,
      ]);
    } else {
      return Buffer.from([
        (value & 0x7f) | 0x80,
        ((value >> 7) & 0x7f) | 0x80,
        value >> 14,
      ]);
    }
  }

  // Instruction data: Transfer instruction (index 2) + lamports (u64 LE)
  const instructionData = Buffer.alloc(12);
  instructionData.writeUInt32LE(2, 0); // System instruction index: Transfer = 2
  // Write lamports as u64 LE (JavaScript can't handle full u64, but our amounts are small)
  instructionData.writeBigUInt64LE(BigInt(lamports), 4);

  // Message format:
  // - header (3 bytes): num_required_signatures, num_readonly_signed, num_readonly_unsigned
  // - account addresses (compact-u16 length + 32 bytes each)
  // - recent blockhash (32 bytes)
  // - instructions (compact-u16 length + encoded instructions)

  // Accounts: [from (signer, writable), to (writable), system_program (readonly)]
  const numAccounts = 3;
  const header = Buffer.from([
    1, // num_required_signatures
    0, // num_readonly_signed_accounts
    1, // num_readonly_unsigned_accounts (system program)
  ]);

  const accountsLength = encodeCompactU16(numAccounts);
  const accounts = Buffer.concat([fromPubkey, toPubkey, systemProgramId]);

  const blockhashBytes = base58Decode(recentBlockhash);

  // Instruction: program_id_index (1 byte) + account_indices (compact array) + data (compact array)
  const instructionsLength = encodeCompactU16(1); // 1 instruction
  const programIdIndex = Buffer.from([2]); // system_program is at index 2
  const accountIndicesLength = encodeCompactU16(2);
  const accountIndices = Buffer.from([0, 1]); // from=0, to=1
  const dataLength = encodeCompactU16(instructionData.length);

  const instruction = Buffer.concat([
    programIdIndex,
    accountIndicesLength,
    accountIndices,
    dataLength,
    instructionData,
  ]);

  const message = Buffer.concat([
    header,
    accountsLength,
    accounts,
    blockhashBytes,
    instructionsLength,
    instruction,
  ]);

  return message;
}

/**
 * Sign a message with Ed25519
 */
function signMessage(message: Buffer, privateKey: Buffer): Buffer {
  const keyObject = crypto.createPrivateKey({
    key: Buffer.concat([
      // PKCS8 header for Ed25519
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      privateKey,
    ]),
    format: 'der',
    type: 'pkcs8',
  });

  return Buffer.from(crypto.sign(null, message, keyObject));
}

/**
 * Send and confirm transaction
 */
async function sendAndConfirmTransaction(
  signedTx: string,
  timeoutMs: number = 60000
): Promise<{ signature: string; slot: number }> {
  // Send transaction
  const signature = await rpcCall<string>('sendTransaction', [
    signedTx,
    {
      encoding: 'base64',
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    },
  ]);

  console.log(`📤 Transaction sent: ${signature}`);

  // Wait for confirmation
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const statuses = await rpcCall<{
      value: Array<{
        slot: number;
        confirmationStatus: string | null;
        err: any;
      } | null>;
    }>('getSignatureStatuses', [[signature], { searchTransactionHistory: true }]);

    const status = statuses.value[0];
    if (status) {
      if (status.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
      }

      if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
        return { signature, slot: status.slot };
      }
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  throw new Error('Transaction confirmation timeout');
}

/**
 * Record execution to ledger
 */
async function recordToLedger(params: {
  signature: string;
  fromAddress: string;
  toAddress: string;
  lamports: number;
  slot: number;
  latencyMs: number;
}): Promise<void> {
  // Dynamic import of ledger module
  const { createExecution, updateExecution } = await import('../execution-ledger/db');

  const amountSol = params.lamports / LAMPORTS_PER_SOL;
  const usdEstimate = amountSol * SOL_USD_ESTIMATE;

  const exec = createExecution({
    chain: 'solana',
    network: 'devnet',
    kind: 'proof',
    venue: 'native',
    intent: `Transfer ${amountSol} SOL to prove ledger integration`,
    action: 'transfer',
    fromAddress: params.fromAddress,
    toAddress: params.toAddress,
    token: 'SOL',
    amountUnits: params.lamports.toString(),
    amountDisplay: `${amountSol} SOL`,
    usdEstimate,
    usdEstimateIsEstimate: true,
  });

  updateExecution(exec.id, {
    status: 'confirmed',
    txHash: params.signature,
    explorerUrl: `https://explorer.solana.com/tx/${params.signature}?cluster=devnet`,
    blockNumber: params.slot,
    latencyMs: params.latencyMs,
  });

  console.log(`✅ Recorded to ledger: execution ID ${exec.id}`);
}

async function main() {
  console.log('\n🔬 Solana Ledger Smoke Test\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  // 1. Load private key from env
  const privateKeyBase58 = process.env.SOLANA_PRIVATE_KEY;
  if (!privateKeyBase58) {
    console.error('❌ SOLANA_PRIVATE_KEY not set in environment');
    console.error('   Set it in agent/.env.local');
    process.exit(1);
  }

  // 2. Parse sender keypair
  const sender = parseSecretKey(privateKeyBase58);
  const senderPubkey = base58Encode(sender.publicKey);
  console.log(`Sender:    ${senderPubkey}`);

  // 3. Generate ephemeral recipient
  const recipient = generateEphemeralKeypair();
  console.log(`Recipient: ${recipient.publicKey} (ephemeral)`);

  // 4. Check balance
  const balance = await getBalance(senderPubkey);
  const balanceSol = balance / LAMPORTS_PER_SOL;
  console.log(`Balance:   ${balanceSol} SOL`);

  const transferLamports = Math.floor(TRANSFER_AMOUNT_SOL * LAMPORTS_PER_SOL);
  if (balance < transferLamports + 10000) { // Need some for fees
    console.error(`❌ Insufficient balance. Need at least ${TRANSFER_AMOUNT_SOL + 0.00001} SOL`);
    process.exit(1);
  }

  // 5. Get recent blockhash
  console.log('\nFetching recent blockhash...');
  const { blockhash } = await getLatestBlockhash();
  console.log(`Blockhash: ${blockhash.slice(0, 16)}...`);

  // 6. Build transaction
  console.log('\nBuilding transfer transaction...');
  const recipientPubkey = base58Decode(recipient.publicKey);
  const message = buildTransferTransaction(
    sender.publicKey,
    recipientPubkey,
    transferLamports,
    blockhash
  );

  // 7. Sign transaction
  console.log('Signing transaction...');
  const signature = signMessage(message, sender.privateKey);

  // Transaction format: num_signatures (compact-u16) + signatures (64 bytes each) + message
  const numSigsCompact = Buffer.from([1]); // 1 signature
  const signedTx = Buffer.concat([numSigsCompact, signature, message]);
  const signedTxBase64 = signedTx.toString('base64');

  // 8. Send and confirm
  console.log(`\nSending ${TRANSFER_AMOUNT_SOL} SOL transfer...`);
  const startTime = Date.now();

  try {
    const result = await sendAndConfirmTransaction(signedTxBase64);
    const latencyMs = Date.now() - startTime;

    console.log(`\n✅ Transaction confirmed!`);
    console.log(`   Signature: ${result.signature}`);
    console.log(`   Slot:      ${result.slot}`);
    console.log(`   Latency:   ${latencyMs}ms`);
    console.log(`   Explorer:  https://explorer.solana.com/tx/${result.signature}?cluster=devnet`);

    // 9. Record to ledger
    console.log('\nRecording to execution ledger...');
    await recordToLedger({
      signature: result.signature,
      fromAddress: senderPubkey,
      toAddress: recipient.publicKey,
      lamports: transferLamports,
      slot: result.slot,
      latencyMs,
    });

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('🎉 SOLANA LEDGER SMOKE TEST PASSED');
    console.log('═══════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('\n❌ Transaction failed:', error);
    process.exit(1);
  }
}

main().catch(console.error);
