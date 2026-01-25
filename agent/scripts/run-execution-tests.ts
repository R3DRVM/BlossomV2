#!/usr/bin/env npx tsx
/**
 * Execution Test Runner
 *
 * Safe, repeatable script for generating real testnet executions.
 * Records all executions + steps to the ledger DB with explorer links.
 *
 * Usage:
 *   npx tsx agent/scripts/run-execution-tests.ts --mode small --chains both --count 1
 *   npx tsx agent/scripts/run-execution-tests.ts --mode standard --chains ethereum --count 3
 *   npx tsx agent/scripts/run-execution-tests.ts --mode stress --chains solana --count 10
 *   npx tsx agent/scripts/run-execution-tests.ts --mode large --chains both --count 5
 *
 * Modes:
 *   small    - Minimal amounts (0.001 SOL, 1 USDC) for quick tests
 *   standard - Normal amounts (0.005 SOL, 5 USDC)
 *   stress   - Higher amounts (0.01 SOL, 10 USDC)
 *   large    - Big amounts (0.1 SOL, 10,000 USDC) for visible USD stats
 *
 * SAFETY:
 *   - Never prints secrets or private keys
 *   - Only outputs: executionId, kind, venue, chain, tx hash (short), explorer link
 *   - Errors stored in DB, not spammed to console
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { config } from 'dotenv';
import * as crypto from 'crypto';
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// Setup paths and load environment
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const agentDir = resolve(__dirname, '..');
config({ path: resolve(agentDir, '.env.local') });

// Import config after env loaded
import {
  ETH_TESTNET_RPC_URL,
  RELAYER_PRIVATE_KEY,
  DEMO_USDC_ADDRESS,
  DEMO_WETH_ADDRESS,
  DEMO_LEND_VAULT_ADDRESS,
  DEMO_SWAP_ROUTER_ADDRESS,
} from '../src/config';

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name: string, defaultValue: string): string {
  // Support both --name=value and --name value formats
  const eqArg = args.find(a => a.startsWith(`--${name}=`));
  if (eqArg) return eqArg.split('=')[1];

  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith('--')) {
    return args[idx + 1];
  }
  return defaultValue;
}

const mode = getArg('mode', 'small') as 'small' | 'standard' | 'stress' | 'large';
const chains = getArg('chains', 'both') as 'ethereum' | 'solana' | 'both';
const count = parseInt(getArg('count', '1'), 10);
const dryRun = args.includes('--dry-run');

// Constants
const ETH_USD_PRICE = 2000;
const SOL_USD_PRICE = 100;
const USDC_USD_PRICE = 1;
const LAMPORTS_PER_SOL = 1_000_000_000;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// Mode-specific amounts
// DemoUSDC has 6 decimals, so 1_000_000n = 1 USDC
const AMOUNTS: Record<string, { sol: number; usdc: bigint }> = {
  small: { sol: 0.001, usdc: 1_000_000n },         // 0.001 SOL (~$0.10), 1 USDC
  standard: { sol: 0.005, usdc: 5_000_000n },      // 0.005 SOL (~$0.50), 5 USDC
  stress: { sol: 0.01, usdc: 10_000_000n },        // 0.01 SOL (~$1), 10 USDC
  large: { sol: 0.1, usdc: 10_000_000_000n },      // 0.1 SOL (~$10), 10,000 USDC
};

// Result tracking
interface ExecutionResult {
  executionId: string;
  kind: string;
  venue: string;
  chain: string;
  status: 'PASS' | 'FAIL';
  txHash?: string;
  explorerUrl?: string;
  error?: string;
}

const results: ExecutionResult[] = [];

// ===== Ethereum Utilities =====
let publicClient: ReturnType<typeof createPublicClient>;
let walletClient: ReturnType<typeof createWalletClient>;
let relayerAddress: `0x${string}`;

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);

const DEMO_VAULT_ABI = parseAbi([
  'function deposit(uint256 amount, address onBehalfOf) returns (uint256)',
]);

const SWAP_ROUTER_ABI = parseAbi([
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum)) returns (uint256)',
]);

async function initEthereumClients(): Promise<boolean> {
  if (!ETH_TESTNET_RPC_URL) {
    console.log('⚠️  Missing env var: ETH_TESTNET_RPC_URL');
    return false;
  }
  if (!RELAYER_PRIVATE_KEY) {
    console.log('⚠️  Missing env var: RELAYER_PRIVATE_KEY');
    return false;
  }

  publicClient = createPublicClient({
    chain: sepolia,
    transport: http(ETH_TESTNET_RPC_URL),
  });

  const relayerAccount = privateKeyToAccount(RELAYER_PRIVATE_KEY as `0x${string}`);
  relayerAddress = relayerAccount.address;

  walletClient = createWalletClient({
    account: relayerAccount,
    chain: sepolia,
    transport: http(ETH_TESTNET_RPC_URL),
  });

  return true;
}

async function waitForTx(hash: `0x${string}`, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash });
      if (receipt) {
        return { blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed, status: receipt.status };
      }
    } catch {}
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('Transaction confirmation timeout');
}

// ===== Solana Utilities =====
const SOLANA_DEVNET_RPC = 'https://api.devnet.solana.com';

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

function encodeCompactU16(value: number): Buffer {
  if (value < 128) return Buffer.from([value]);
  if (value < 16384) return Buffer.from([(value & 0x7f) | 0x80, value >> 7]);
  return Buffer.from([(value & 0x7f) | 0x80, ((value >> 7) & 0x7f) | 0x80, value >> 14]);
}

async function solanaRpcCall<T>(method: string, params: any[] = []): Promise<T> {
  const response = await fetch(SOLANA_DEVNET_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data = await response.json();
  if (data.error) throw new Error(`Solana RPC error: ${data.error.message}`);
  return data.result;
}

function signSolanaMessage(message: Buffer, privateKey: Buffer): Buffer {
  const keyObject = crypto.createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), privateKey]),
    format: 'der',
    type: 'pkcs8',
  });
  return Buffer.from(crypto.sign(null, message, keyObject));
}

function generateEphemeralKeypair(): { publicKey: Buffer; publicKeyBase58: string } {
  const { publicKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  const rawPublicKey = Buffer.from(publicKey.slice(-32));
  return { publicKey: rawPublicKey, publicKeyBase58: base58Encode(rawPublicKey) };
}

// ===== Execution Functions =====

async function runEthereumDeposit(iteration: number): Promise<ExecutionResult> {
  const result: ExecutionResult = {
    executionId: '',
    kind: 'deposit',
    venue: 'demo_vault',
    chain: 'ethereum',
    status: 'FAIL',
  };

  const { createExecution, updateExecution, createExecutionStep, updateExecutionStep } = await import('../execution-ledger/db');
  const depositAmount = AMOUNTS[mode].usdc;
  const startTime = Date.now();

  try {
    // Check balance
    const balance = await publicClient.readContract({
      address: DEMO_USDC_ADDRESS as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [relayerAddress],
    }) as bigint;

    if (balance < depositAmount) {
      throw new Error(`Insufficient DemoUSDC: have ${Number(balance) / 1e6}, need ${Number(depositAmount) / 1e6}`);
    }

    // Create execution record
    const exec = createExecution({
      chain: 'ethereum',
      network: 'sepolia',
      kind: 'deposit',
      venue: 'demo_vault',
      intent: `Deposit ${Number(depositAmount) / 1e6} DemoUSDC to vault (test run ${iteration})`,
      action: 'deposit',
      fromAddress: relayerAddress,
      toAddress: DEMO_LEND_VAULT_ADDRESS,
      token: 'DemoUSDC',
      amountUnits: depositAmount.toString(),
      amountDisplay: `${Number(depositAmount) / 1e6} USDC`,
      usdEstimate: Number(depositAmount) / 1e6 * USDC_USD_PRICE,
      usdEstimateIsEstimate: true,
      relayerAddress: relayerAddress,
    });
    result.executionId = exec.id;

    // Step 1: Approve
    const step1 = createExecutionStep({ executionId: exec.id, stepIndex: 0, action: 'approve' });
    const approveTx = await walletClient.writeContract({
      address: DEMO_USDC_ADDRESS as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [DEMO_LEND_VAULT_ADDRESS as `0x${string}`, depositAmount],
    });
    const approveReceipt = await waitForTx(approveTx);
    updateExecutionStep(step1.id, {
      status: approveReceipt.status === 'success' ? 'confirmed' : 'failed',
      txHash: approveTx,
      explorerUrl: `https://sepolia.etherscan.io/tx/${approveTx}`,
    });

    // Step 2: Deposit
    const step2 = createExecutionStep({ executionId: exec.id, stepIndex: 1, action: 'deposit' });
    const depositTx = await walletClient.writeContract({
      address: DEMO_LEND_VAULT_ADDRESS as `0x${string}`,
      abi: DEMO_VAULT_ABI,
      functionName: 'deposit',
      args: [depositAmount, relayerAddress],
    });
    const depositReceipt = await waitForTx(depositTx);
    updateExecutionStep(step2.id, {
      status: depositReceipt.status === 'success' ? 'confirmed' : 'failed',
      txHash: depositTx,
      explorerUrl: `https://sepolia.etherscan.io/tx/${depositTx}`,
    });

    const latencyMs = Date.now() - startTime;
    updateExecution(exec.id, {
      status: 'confirmed',
      txHash: depositTx,
      explorerUrl: `https://sepolia.etherscan.io/tx/${depositTx}`,
      blockNumber: Number(depositReceipt.blockNumber),
      gasUsed: depositReceipt.gasUsed.toString(),
      latencyMs,
    });

    result.status = 'PASS';
    result.txHash = depositTx.slice(0, 18) + '...';
    result.explorerUrl = `https://sepolia.etherscan.io/tx/${depositTx}`;

  } catch (error: any) {
    if (result.executionId) {
      updateExecution(result.executionId, { status: 'failed', errorMessage: error.message });
    }
    result.error = error.message;
  }

  return result;
}

async function runEthereumSwap(iteration: number): Promise<ExecutionResult> {
  const result: ExecutionResult = {
    executionId: '',
    kind: 'swap',
    venue: 'demo_dex',
    chain: 'ethereum',
    status: 'FAIL',
  };

  const { createExecution, updateExecution, createExecutionStep, updateExecutionStep } = await import('../execution-ledger/db');
  const swapAmount = AMOUNTS[mode].usdc;
  const startTime = Date.now();

  try {
    // Check balance
    const balance = await publicClient.readContract({
      address: DEMO_USDC_ADDRESS as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [relayerAddress],
    }) as bigint;

    if (balance < swapAmount) {
      throw new Error(`Insufficient DemoUSDC: have ${Number(balance) / 1e6}, need ${Number(swapAmount) / 1e6}`);
    }

    // Create execution
    const exec = createExecution({
      chain: 'ethereum',
      network: 'sepolia',
      kind: 'swap',
      venue: 'demo_dex',
      intent: `Swap ${Number(swapAmount) / 1e6} DemoUSDC for DemoWETH (test run ${iteration})`,
      action: 'swap',
      fromAddress: relayerAddress,
      toAddress: DEMO_SWAP_ROUTER_ADDRESS,
      token: 'DemoUSDC->DemoWETH',
      amountUnits: swapAmount.toString(),
      amountDisplay: `${Number(swapAmount) / 1e6} USDC`,
      usdEstimate: Number(swapAmount) / 1e6 * USDC_USD_PRICE,
      usdEstimateIsEstimate: true,
      relayerAddress: relayerAddress,
    });
    result.executionId = exec.id;

    // Step 1: Approve
    const step1 = createExecutionStep({ executionId: exec.id, stepIndex: 0, action: 'approve' });
    const approveTx = await walletClient.writeContract({
      address: DEMO_USDC_ADDRESS as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [DEMO_SWAP_ROUTER_ADDRESS as `0x${string}`, swapAmount],
    });
    const approveReceipt = await waitForTx(approveTx);
    updateExecutionStep(step1.id, {
      status: approveReceipt.status === 'success' ? 'confirmed' : 'failed',
      txHash: approveTx,
      explorerUrl: `https://sepolia.etherscan.io/tx/${approveTx}`,
    });

    // Step 2: Swap
    const step2 = createExecutionStep({ executionId: exec.id, stepIndex: 1, action: 'swap' });
    const minOut = (swapAmount * 90n * 10n**12n) / 100n;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const swapTx = await walletClient.writeContract({
      address: DEMO_SWAP_ROUTER_ADDRESS as `0x${string}`,
      abi: SWAP_ROUTER_ABI,
      functionName: 'exactInputSingle',
      args: [{
        tokenIn: DEMO_USDC_ADDRESS as `0x${string}`,
        tokenOut: DEMO_WETH_ADDRESS as `0x${string}`,
        fee: 3000,
        recipient: relayerAddress,
        deadline,
        amountIn: swapAmount,
        amountOutMinimum: minOut,
      }],
    });
    const swapReceipt = await waitForTx(swapTx);
    updateExecutionStep(step2.id, {
      status: swapReceipt.status === 'success' ? 'confirmed' : 'failed',
      txHash: swapTx,
      explorerUrl: `https://sepolia.etherscan.io/tx/${swapTx}`,
    });

    const latencyMs = Date.now() - startTime;
    updateExecution(exec.id, {
      status: 'confirmed',
      txHash: swapTx,
      explorerUrl: `https://sepolia.etherscan.io/tx/${swapTx}`,
      blockNumber: Number(swapReceipt.blockNumber),
      gasUsed: swapReceipt.gasUsed.toString(),
      latencyMs,
    });

    result.status = 'PASS';
    result.txHash = swapTx.slice(0, 18) + '...';
    result.explorerUrl = `https://sepolia.etherscan.io/tx/${swapTx}`;

  } catch (error: any) {
    if (result.executionId) {
      updateExecution(result.executionId, { status: 'failed', errorMessage: error.message });
    }
    result.error = error.message;
  }

  return result;
}

async function runSolanaTransfer(iteration: number): Promise<ExecutionResult> {
  const result: ExecutionResult = {
    executionId: '',
    kind: 'deposit',
    venue: 'solana_vault',
    chain: 'solana',
    status: 'FAIL',
  };

  const SOLANA_PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY;
  if (!SOLANA_PRIVATE_KEY) {
    result.error = 'Missing env var: SOLANA_PRIVATE_KEY';
    return result;
  }

  const { createExecution, updateExecution, createExecutionStep, updateExecutionStep } = await import('../execution-ledger/db');
  const transferAmount = Math.floor(AMOUNTS[mode].sol * LAMPORTS_PER_SOL);
  const startTime = Date.now();

  try {
    // Parse keypair
    const secretKey = base58Decode(SOLANA_PRIVATE_KEY);
    if (secretKey.length !== 64) throw new Error(`Invalid secret key length: ${secretKey.length}`);
    const privateKey = secretKey.slice(0, 32);
    const publicKey = secretKey.slice(32, 64);
    const senderPubkey = base58Encode(Buffer.from(publicKey));

    // Generate ephemeral recipient
    const recipient = generateEphemeralKeypair();

    // Check balance
    const balanceResult = await solanaRpcCall<{ value: number }>('getBalance', [senderPubkey]);
    if (balanceResult.value < transferAmount + 10000) {
      throw new Error(`Insufficient SOL: have ${balanceResult.value / LAMPORTS_PER_SOL}, need ${transferAmount / LAMPORTS_PER_SOL}`);
    }

    // Create execution
    const exec = createExecution({
      chain: 'solana',
      network: 'devnet',
      kind: 'deposit',
      venue: 'solana_vault',
      intent: `Transfer ${transferAmount / LAMPORTS_PER_SOL} SOL (test run ${iteration})`,
      action: 'deposit',
      fromAddress: senderPubkey,
      toAddress: recipient.publicKeyBase58,
      token: 'SOL',
      amountUnits: transferAmount.toString(),
      amountDisplay: `${transferAmount / LAMPORTS_PER_SOL} SOL`,
      usdEstimate: (transferAmount / LAMPORTS_PER_SOL) * SOL_USD_PRICE,
      usdEstimateIsEstimate: true,
    });
    result.executionId = exec.id;

    // Get blockhash
    const blockhashResult = await solanaRpcCall<{ value: { blockhash: string } }>('getLatestBlockhash', [{ commitment: 'finalized' }]);
    const blockhash = blockhashResult.value.blockhash;
    const blockhashBytes = base58Decode(blockhash);

    // Build transaction
    const systemProgramId = Buffer.alloc(32);
    const header = Buffer.from([1, 0, 1]);
    const accountsLengthBuf = encodeCompactU16(3);
    const accounts = Buffer.concat([Buffer.from(publicKey), recipient.publicKey, systemProgramId]);

    const instructionData = Buffer.alloc(12);
    instructionData.writeUInt32LE(2, 0);
    instructionData.writeBigUInt64LE(BigInt(transferAmount), 4);

    const instructionsLengthBuf = encodeCompactU16(1);
    const programIdIndex = Buffer.from([2]);
    const accountIndicesLengthBuf = encodeCompactU16(2);
    const accountIndices = Buffer.from([0, 1]);
    const dataLengthBuf = encodeCompactU16(12);

    const instruction = Buffer.concat([programIdIndex, accountIndicesLengthBuf, accountIndices, dataLengthBuf, instructionData]);
    const message = Buffer.concat([header, accountsLengthBuf, accounts, blockhashBytes, instructionsLengthBuf, instruction]);

    // Sign and send
    const step1 = createExecutionStep({ executionId: exec.id, stepIndex: 0, action: 'transfer' });
    const signature = signSolanaMessage(message, privateKey);
    const signedTx = Buffer.concat([Buffer.from([1]), signature, message]);
    const signedTxBase64 = signedTx.toString('base64');

    const txSignature = await solanaRpcCall<string>('sendTransaction', [
      signedTxBase64,
      { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed' },
    ]);

    // Wait for confirmation
    let confirmed = false;
    for (let i = 0; i < 30; i++) {
      const statuses = await solanaRpcCall<{ value: Array<{ confirmationStatus: string | null; err: any } | null> }>(
        'getSignatureStatuses', [[txSignature], { searchTransactionHistory: true }]
      );
      const status = statuses.value[0];
      if (status) {
        if (status.err) throw new Error(`TX failed: ${JSON.stringify(status.err)}`);
        if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
          confirmed = true;
          break;
        }
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    if (!confirmed) throw new Error('Transaction confirmation timeout');

    const explorerUrl = `https://explorer.solana.com/tx/${txSignature}?cluster=devnet`;
    updateExecutionStep(step1.id, { status: 'confirmed', txHash: txSignature, explorerUrl });

    const latencyMs = Date.now() - startTime;
    updateExecution(exec.id, { status: 'confirmed', txHash: txSignature, explorerUrl, latencyMs });

    result.status = 'PASS';
    result.txHash = txSignature.slice(0, 18) + '...';
    result.explorerUrl = explorerUrl;

  } catch (error: any) {
    if (result.executionId) {
      updateExecution(result.executionId, { status: 'failed', errorMessage: error.message });
    }
    result.error = error.message;
  }

  return result;
}

async function runSolanaMemo(iteration: number): Promise<ExecutionResult> {
  const result: ExecutionResult = {
    executionId: '',
    kind: 'swap',
    venue: 'demo_dex',
    chain: 'solana',
    status: 'FAIL',
  };

  const SOLANA_PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY;
  if (!SOLANA_PRIVATE_KEY) {
    result.error = 'Missing env var: SOLANA_PRIVATE_KEY';
    return result;
  }

  const { createExecution, updateExecution, createExecutionStep, updateExecutionStep } = await import('../execution-ledger/db');
  const swapAmount = AMOUNTS[mode].sol;
  const startTime = Date.now();

  try {
    // Parse keypair
    const secretKey = base58Decode(SOLANA_PRIVATE_KEY);
    const privateKey = secretKey.slice(0, 32);
    const publicKey = secretKey.slice(32, 64);
    const senderPubkey = base58Encode(Buffer.from(publicKey));

    // Create execution
    const exec = createExecution({
      chain: 'solana',
      network: 'devnet',
      kind: 'swap',
      venue: 'demo_dex',
      intent: `Swap ${swapAmount} SOL for USDC (proof memo, test run ${iteration})`,
      action: 'swap',
      fromAddress: senderPubkey,
      token: 'SOL->USDC',
      amountUnits: Math.floor(swapAmount * LAMPORTS_PER_SOL).toString(),
      amountDisplay: `${swapAmount} SOL`,
      usdEstimate: swapAmount * SOL_USD_PRICE,
      usdEstimateIsEstimate: true,
    });
    result.executionId = exec.id;

    // Build memo transaction
    const memoProgramId = base58Decode('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
    const memoText = `SWAP:${swapAmount}SOL->USDC:demo_dex:${Date.now()}:run${iteration}`;
    const memoData = Buffer.from(memoText);

    const blockhashResult = await solanaRpcCall<{ value: { blockhash: string } }>('getLatestBlockhash', [{ commitment: 'finalized' }]);
    const blockhash = blockhashResult.value.blockhash;
    const blockhashBytes = base58Decode(blockhash);

    const header = Buffer.from([1, 0, 1]);
    const accountsLength = encodeCompactU16(2);
    const accountsBuf = Buffer.concat([Buffer.from(publicKey), memoProgramId]);

    const instructionsLength = encodeCompactU16(1);
    const programIdIndex = Buffer.from([1]);
    const accountIndicesLength = encodeCompactU16(1);
    const accountIndices = Buffer.from([0]);
    const dataLength = encodeCompactU16(memoData.length);

    const instruction = Buffer.concat([programIdIndex, accountIndicesLength, accountIndices, dataLength, memoData]);
    const message = Buffer.concat([header, accountsLength, accountsBuf, blockhashBytes, instructionsLength, instruction]);

    const step1 = createExecutionStep({ executionId: exec.id, stepIndex: 0, action: 'swap_memo' });
    const signature = signSolanaMessage(message, privateKey);
    const signedTx = Buffer.concat([Buffer.from([1]), signature, message]);
    const signedTxBase64 = signedTx.toString('base64');

    const txSignature = await solanaRpcCall<string>('sendTransaction', [
      signedTxBase64,
      { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed' },
    ]);

    // Wait for confirmation
    let confirmed = false;
    for (let i = 0; i < 30; i++) {
      const statuses = await solanaRpcCall<{ value: Array<{ confirmationStatus: string | null; err: any } | null> }>(
        'getSignatureStatuses', [[txSignature], { searchTransactionHistory: true }]
      );
      const status = statuses.value[0];
      if (status) {
        if (status.err) throw new Error(`TX failed: ${JSON.stringify(status.err)}`);
        if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
          confirmed = true;
          break;
        }
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    if (!confirmed) throw new Error('Transaction confirmation timeout');

    const explorerUrl = `https://explorer.solana.com/tx/${txSignature}?cluster=devnet`;
    updateExecutionStep(step1.id, { status: 'confirmed', txHash: txSignature, explorerUrl });

    const latencyMs = Date.now() - startTime;
    updateExecution(exec.id, { status: 'confirmed', txHash: txSignature, explorerUrl, latencyMs });

    result.status = 'PASS';
    result.txHash = txSignature.slice(0, 18) + '...';
    result.explorerUrl = explorerUrl;

  } catch (error: any) {
    if (result.executionId) {
      updateExecution(result.executionId, { status: 'failed', errorMessage: error.message });
    }
    result.error = error.message;
  }

  return result;
}

/**
 * Run a bridge intent execution (proof on both chains with high USD estimate)
 * This is for demonstrating high USD routing numbers.
 */
async function runBridgeIntent(iteration: number): Promise<ExecutionResult> {
  const result: ExecutionResult = {
    executionId: '',
    kind: 'bridge',
    venue: 'bridge_intent',
    chain: 'ethereum',  // Primary chain
    status: 'FAIL',
  };

  const { createExecution, updateExecution, createExecutionStep, updateExecutionStep } = await import('../execution-ledger/db');
  const startTime = Date.now();

  // Bridge USD amounts vary by mode
  const bridgeUsdAmounts: Record<string, number> = {
    small: 100,
    standard: 1000,
    stress: 5000,
    large: 50000, // $50k bridge intent for visible stats
  };
  const bridgeUsd = bridgeUsdAmounts[mode] || 1000;
  const bridgeIntentId = `bridge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    // Create execution with high USD estimate
    const exec = createExecution({
      chain: 'ethereum',
      network: 'sepolia',
      kind: 'bridge',
      venue: 'bridge_intent',
      intent: `Bridge intent: ${bridgeUsd.toLocaleString()} USDC Sepolia -> Solana (test run ${iteration})`,
      action: 'bridge',
      fromAddress: relayerAddress,
      token: 'USDC',
      amountUnits: (bridgeUsd * 1_000_000).toString(),
      amountDisplay: `${bridgeUsd.toLocaleString()} USDC`,
      usdEstimate: bridgeUsd,
      usdEstimateIsEstimate: true,
      relayerAddress: relayerAddress,
    });
    result.executionId = exec.id;

    // Step 1: Sepolia proof (self-transfer with metadata)
    const step1 = createExecutionStep({ executionId: exec.id, stepIndex: 0, action: 'sepolia_proof' });
    const bridgeMetadata = `bridge_intent:${bridgeIntentId}:USDC:${bridgeUsd}:sepolia->devnet`;
    const dataHex = `0x${Buffer.from(bridgeMetadata).toString('hex')}` as `0x${string}`;

    const sepoliaTx = await walletClient.sendTransaction({
      to: relayerAddress,
      value: 1n,
      data: dataHex,
    });
    const sepoliaReceipt = await waitForTx(sepoliaTx);
    updateExecutionStep(step1.id, {
      status: sepoliaReceipt.status === 'success' ? 'confirmed' : 'failed',
      txHash: sepoliaTx,
      explorerUrl: `https://sepolia.etherscan.io/tx/${sepoliaTx}`,
    });

    // Step 2: Solana acknowledgment memo (if available)
    const SOLANA_PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY;
    if (SOLANA_PRIVATE_KEY) {
      const step2 = createExecutionStep({ executionId: exec.id, stepIndex: 1, action: 'solana_ack' });

      const secretKey = base58Decode(SOLANA_PRIVATE_KEY);
      const privateKey = secretKey.slice(0, 32);
      const publicKey = secretKey.slice(32, 64);

      const memoProgramId = base58Decode('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
      const memoText = `BRIDGE_ACK:${bridgeIntentId}:${bridgeUsd}USDC:received`;
      const memoData = Buffer.from(memoText);

      const blockhashResult = await solanaRpcCall<{ value: { blockhash: string } }>('getLatestBlockhash', [{ commitment: 'finalized' }]);
      const blockhash = blockhashResult.value.blockhash;
      const blockhashBytes = base58Decode(blockhash);

      const header = Buffer.from([1, 0, 1]);
      const accountsLength = encodeCompactU16(2);
      const accountsBuf = Buffer.concat([Buffer.from(publicKey), memoProgramId]);
      const instructionsLength = encodeCompactU16(1);
      const programIdIndex = Buffer.from([1]);
      const accountIndicesLength = encodeCompactU16(1);
      const accountIndices = Buffer.from([0]);
      const dataLength = encodeCompactU16(memoData.length);

      const instruction = Buffer.concat([programIdIndex, accountIndicesLength, accountIndices, dataLength, memoData]);
      const message = Buffer.concat([header, accountsLength, accountsBuf, blockhashBytes, instructionsLength, instruction]);

      const signature = signSolanaMessage(message, privateKey);
      const signedTx = Buffer.concat([Buffer.from([1]), signature, message]);
      const signedTxBase64 = signedTx.toString('base64');

      const txSignature = await solanaRpcCall<string>('sendTransaction', [
        signedTxBase64,
        { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed' },
      ]);

      // Wait for confirmation
      let confirmed = false;
      for (let i = 0; i < 30; i++) {
        const statuses = await solanaRpcCall<{ value: Array<{ confirmationStatus: string | null; err: any } | null> }>(
          'getSignatureStatuses', [[txSignature], { searchTransactionHistory: true }]
        );
        const status = statuses.value[0];
        if (status) {
          if (status.err) throw new Error(`Solana TX failed: ${JSON.stringify(status.err)}`);
          if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
            confirmed = true;
            break;
          }
        }
        await new Promise(r => setTimeout(r, 2000));
      }

      updateExecutionStep(step2.id, {
        status: confirmed ? 'confirmed' : 'failed',
        txHash: txSignature,
        explorerUrl: `https://explorer.solana.com/tx/${txSignature}?cluster=devnet`,
      });
    }

    const latencyMs = Date.now() - startTime;
    updateExecution(exec.id, {
      status: 'confirmed',
      txHash: sepoliaTx,
      explorerUrl: `https://sepolia.etherscan.io/tx/${sepoliaTx}`,
      latencyMs,
    });

    result.status = 'PASS';
    result.txHash = sepoliaTx.slice(0, 18) + '...';
    result.explorerUrl = `https://sepolia.etherscan.io/tx/${sepoliaTx}`;

  } catch (error: any) {
    if (result.executionId) {
      updateExecution(result.executionId, { status: 'failed', errorMessage: error.message });
    }
    result.error = error.message;
  }

  return result;
}

// ===== Main Runner =====

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║           EXECUTION TEST RUNNER                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log(`Mode:   ${mode}`);
  console.log(`Chains: ${chains}`);
  console.log(`Count:  ${count}`);
  if (dryRun) console.log('DRY RUN - No transactions will be sent\n');
  console.log('');

  // Check env vars exist (don't print values)
  const envChecks = [
    { key: 'ETH_TESTNET_RPC_URL', required: chains !== 'solana' },
    { key: 'RELAYER_PRIVATE_KEY', required: chains !== 'solana' },
    { key: 'SOLANA_PRIVATE_KEY', required: chains !== 'ethereum' },
  ];

  let missingEnv = false;
  for (const check of envChecks) {
    if (check.required && !process.env[check.key]) {
      console.log(`⚠️  Missing env var: ${check.key}`);
      missingEnv = true;
    }
  }

  if (missingEnv && !dryRun) {
    console.log('\nFix missing env vars before running.\n');
    process.exit(1);
  }

  // Initialize Ethereum clients if needed
  if (chains !== 'solana') {
    const ethReady = await initEthereumClients();
    if (!ethReady && !dryRun) {
      process.exit(1);
    }
    console.log(`Relayer: ${relayerAddress}`);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  // Run executions
  for (let i = 1; i <= count; i++) {
    console.log(`\n── Run ${i}/${count} ──\n`);

    if (chains === 'ethereum' || chains === 'both') {
      if (dryRun) {
        console.log(`[DRY RUN] Would run: ethereum/deposit`);
        console.log(`[DRY RUN] Would run: ethereum/swap`);
      } else {
        // Deposit
        console.log('Running: ethereum/deposit...');
        const depositResult = await runEthereumDeposit(i);
        results.push(depositResult);
        printResult(depositResult);

        // Swap
        console.log('Running: ethereum/swap...');
        const swapResult = await runEthereumSwap(i);
        results.push(swapResult);
        printResult(swapResult);
      }
    }

    if (chains === 'solana' || chains === 'both') {
      if (dryRun) {
        console.log(`[DRY RUN] Would run: solana/deposit`);
        console.log(`[DRY RUN] Would run: solana/swap`);
      } else {
        // Transfer (deposit)
        console.log('Running: solana/deposit...');
        const transferResult = await runSolanaTransfer(i);
        results.push(transferResult);
        printResult(transferResult);

        // Memo (swap proof)
        console.log('Running: solana/swap...');
        const memoResult = await runSolanaMemo(i);
        results.push(memoResult);
        printResult(memoResult);
      }
    }

    // Bridge intent in stress/large modes (high USD for visible stats)
    if ((mode === 'stress' || mode === 'large') && chains === 'both') {
      if (dryRun) {
        console.log(`[DRY RUN] Would run: bridge_intent (high USD)`);
      } else {
        console.log('Running: bridge_intent...');
        const bridgeResult = await runBridgeIntent(i);
        results.push(bridgeResult);
        printResult(bridgeResult);
      }
    }
  }

  // Print summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('\n                      SUMMARY\n');

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;

  console.log(`Total: ${results.length} executions`);
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);

  if (results.length > 0) {
    console.log('\nResults:');
    console.log('─────────────────────────────────────────────────────────────');
    for (const r of results) {
      const statusIcon = r.status === 'PASS' ? '✅' : '❌';
      console.log(`${statusIcon} ${r.executionId.slice(0, 8)} | ${r.chain}/${r.kind} | ${r.venue}`);
      if (r.explorerUrl) {
        console.log(`   └─ ${r.explorerUrl}`);
      }
      if (r.error) {
        console.log(`   └─ Error: ${r.error.slice(0, 80)}${r.error.length > 80 ? '...' : ''}`);
      }
    }
  }

  console.log('\n');
  process.exit(failed > 0 ? 1 : 0);
}

function printResult(r: ExecutionResult) {
  const statusIcon = r.status === 'PASS' ? '✅' : '❌';
  console.log(`  ${statusIcon} ${r.kind}/${r.venue} -> ${r.status}`);
  if (r.txHash) {
    console.log(`     TX: ${r.txHash}`);
  }
  if (r.explorerUrl) {
    console.log(`     ${r.explorerUrl}`);
  }
  if (r.error) {
    console.log(`     Error: ${r.error.slice(0, 60)}${r.error.length > 60 ? '...' : ''}`);
  }
}

main().catch((error) => {
  console.error('\n❌ FATAL ERROR:', error.message);
  process.exit(1);
});
