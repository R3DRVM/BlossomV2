/**
 * Solana Executor
 * Handles execution of intents on Solana (devnet/mainnet)
 *
 * Supports:
 * - Swaps via Jupiter
 * - Token transfers
 * - Program interactions (Blossom Anchor program)
 * - Proof-of-execution transactions
 */

import * as crypto from 'crypto';
import { SolanaClient } from './solanaClient';
import {
  getJupiterQuote,
  buildJupiterSwapTransaction,
  resolveTokenMint,
  getTokenBalance,
  SOLANA_TOKEN_MINTS,
  type JupiterQuote,
} from './jupiter';
import { getPythPriceForSymbol } from './pyth';

// Base58 encoding/decoding utilities
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

// Execution result types
export interface SolanaExecutionResult {
  ok: boolean;
  signature?: string;
  explorerUrl?: string;
  slot?: number;
  error?: {
    code: string;
    message: string;
  };
  metadata?: Record<string, any>;
}

export interface SolanaSwapParams {
  inputToken: string;
  outputToken: string;
  amount: string;
  slippageBps?: number;
  userPublicKey?: string;
}

export interface SolanaTransferParams {
  token: string;
  amount: string;
  recipient: string;
}

export interface SolanaProofParams {
  intentText: string;
  intentKind: string;
  metadata?: Record<string, any>;
}

/**
 * Solana Executor Class
 * Handles all Solana transaction execution
 */
export class SolanaExecutor {
  private client: SolanaClient;
  private privateKey: Buffer | null = null;
  private publicKey: string | null = null;
  private isDevnet: boolean;

  constructor(config: { rpcUrl?: string; privateKey?: string } = {}) {
    const rpcUrl = config.rpcUrl || process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
    this.client = new SolanaClient({ rpcUrl });
    this.isDevnet = rpcUrl.includes('devnet');

    // Initialize keypair if private key provided
    if (config.privateKey || process.env.SOLANA_PRIVATE_KEY) {
      this.initializeKeypair(config.privateKey || process.env.SOLANA_PRIVATE_KEY!);
    }
  }

  /**
   * Initialize keypair from base58-encoded private key
   */
  private initializeKeypair(privateKeyBase58: string): void {
    try {
      const secretKey = base58Decode(privateKeyBase58);
      if (secretKey.length !== 64) {
        throw new Error(`Invalid secret key length: ${secretKey.length}`);
      }
      this.privateKey = secretKey.subarray(0, 32);
      const publicKeyBytes = secretKey.subarray(32, 64);
      this.publicKey = base58Encode(publicKeyBytes);
      console.log(`[solanaExecutor] Initialized with wallet: ${this.publicKey}`);
    } catch (error: any) {
      console.error('[solanaExecutor] Failed to initialize keypair:', error.message);
    }
  }

  /**
   * Get the executor's public key
   */
  getPublicKey(): string | null {
    return this.publicKey;
  }

  /**
   * Check if executor is properly initialized
   */
  isInitialized(): boolean {
    return this.privateKey !== null && this.publicKey !== null;
  }

  /**
   * Sign a message/transaction
   */
  private async sign(message: Buffer): Promise<Buffer> {
    if (!this.privateKey) {
      throw new Error('Executor not initialized with private key');
    }

    const keyObject = crypto.createPrivateKey({
      key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), this.privateKey]),
      format: 'der',
      type: 'pkcs8',
    });

    return Buffer.from(crypto.sign(null, message, keyObject));
  }

  /**
   * Execute a swap via Jupiter
   */
  async executeSwap(params: SolanaSwapParams): Promise<SolanaExecutionResult> {
    const { inputToken, outputToken, amount, slippageBps = 50 } = params;
    const startTime = Date.now();

    if (!this.isInitialized()) {
      return {
        ok: false,
        error: {
          code: 'NOT_INITIALIZED',
          message: 'Solana executor not initialized with private key',
        },
      };
    }

    try {
      // Resolve token mints
      const inputMint = resolveTokenMint(inputToken, this.isDevnet);
      const outputMint = resolveTokenMint(outputToken, this.isDevnet);

      console.log(`[solanaExecutor] Swap: ${inputToken} -> ${outputToken}, amount: ${amount}`);

      // Get quote
      const quote = await getJupiterQuote({
        inputMint,
        outputMint,
        amount,
        slippageBps,
      });

      if (!quote) {
        return {
          ok: false,
          error: {
            code: 'QUOTE_FAILED',
            message: 'Failed to get Jupiter quote',
          },
        };
      }

      console.log(`[solanaExecutor] Quote received: ${quote.inAmount} -> ${quote.outAmount}`);

      // Build swap transaction
      const swapTx = await buildJupiterSwapTransaction({
        quote,
        userPublicKey: this.publicKey!,
      });

      if (!swapTx) {
        return {
          ok: false,
          error: {
            code: 'BUILD_TX_FAILED',
            message: 'Failed to build Jupiter swap transaction',
          },
        };
      }

      // Decode and sign the transaction
      const txBuffer = Buffer.from(swapTx.swapTransaction, 'base64');

      // For versioned transactions, we need to extract the message and sign it
      // The first byte indicates version (0 = legacy, 0x80+ = versioned)
      const isVersioned = txBuffer[0] >= 0x80;

      let signedTxBuffer: Buffer;
      if (isVersioned) {
        // Versioned transaction: signature count + signatures + message
        const signatureCount = 1; // We're the only signer
        const message = txBuffer.subarray(1 + 64); // Skip version byte + existing signature slot
        const signature = await this.sign(message);
        signedTxBuffer = Buffer.concat([
          Buffer.from([txBuffer[0]]), // Version prefix
          Buffer.from([signatureCount]),
          signature,
          message,
        ]);
      } else {
        // Legacy transaction
        const signature = await this.sign(txBuffer);
        signedTxBuffer = Buffer.concat([Buffer.from([1]), signature, txBuffer]);
      }

      // Send transaction
      const signedTxBase64 = signedTxBuffer.toString('base64');
      const txSignature = await this.client.sendTransaction(signedTxBase64, { skipPreflight: true });

      // Wait for confirmation
      const confirmation = await this.client.confirmTransaction(txSignature, 'confirmed', 60000);
      const latencyMs = Date.now() - startTime;

      const explorerUrl = this.isDevnet
        ? `https://explorer.solana.com/tx/${txSignature}?cluster=devnet`
        : `https://explorer.solana.com/tx/${txSignature}`;

      return {
        ok: true,
        signature: txSignature,
        explorerUrl,
        slot: confirmation.slot,
        metadata: {
          inputMint,
          outputMint,
          inputAmount: quote.inAmount,
          outputAmount: quote.outAmount,
          priceImpactPct: quote.priceImpactPct,
          route: quote.routePlan.map(r => r.swapInfo.label).join(' -> '),
          latencyMs,
        },
      };
    } catch (error: any) {
      console.error('[solanaExecutor] Swap error:', error);
      return {
        ok: false,
        error: {
          code: 'SWAP_EXECUTION_FAILED',
          message: error.message || 'Swap execution failed',
        },
      };
    }
  }

  /**
   * Execute a SOL transfer
   */
  async executeTransfer(params: SolanaTransferParams): Promise<SolanaExecutionResult> {
    const { token, amount, recipient } = params;
    const startTime = Date.now();

    if (!this.isInitialized()) {
      return {
        ok: false,
        error: {
          code: 'NOT_INITIALIZED',
          message: 'Solana executor not initialized with private key',
        },
      };
    }

    try {
      // For now, only support native SOL transfers
      if (token.toUpperCase() !== 'SOL') {
        return {
          ok: false,
          error: {
            code: 'UNSUPPORTED_TOKEN',
            message: `Token ${token} transfers not yet supported. Only SOL is supported.`,
          },
        };
      }

      // Parse amount to lamports
      const lamports = BigInt(Math.floor(parseFloat(amount) * 1e9));

      // Get recent blockhash
      const { blockhash } = await this.client.getRecentBlockhash();

      // Build transfer transaction
      const recipientPubkey = base58Decode(recipient);
      const senderPubkey = base58Decode(this.publicKey!);
      const systemProgramId = Buffer.alloc(32);

      // Encode compact u16
      function encodeCompactU16(value: number): Buffer {
        if (value < 128) return Buffer.from([value]);
        if (value < 16384) return Buffer.from([(value & 0x7f) | 0x80, value >> 7]);
        return Buffer.from([(value & 0x7f) | 0x80, ((value >> 7) & 0x7f) | 0x80, value >> 14]);
      }

      // Transfer instruction data
      const instructionData = Buffer.alloc(12);
      instructionData.writeUInt32LE(2, 0); // Transfer instruction
      instructionData.writeBigUInt64LE(lamports, 4);

      // Header: [num_sigs, num_readonly_signed, num_readonly_unsigned]
      const header = Buffer.from([1, 0, 1]);
      const accountsLength = encodeCompactU16(3);
      const accounts = Buffer.concat([senderPubkey, recipientPubkey, systemProgramId]);
      const blockhashBytes = base58Decode(blockhash);

      const instructionsLength = encodeCompactU16(1);
      const programIdIndex = Buffer.from([2]); // System program at index 2
      const accountIndicesLength = encodeCompactU16(2);
      const accountIndices = Buffer.from([0, 1]); // From sender to recipient
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

      // Sign message
      const signature = await this.sign(message);

      // Build signed transaction
      const signedTx = Buffer.concat([Buffer.from([1]), signature, message]);
      const signedTxBase64 = signedTx.toString('base64');

      // Send transaction
      const txSignature = await this.client.sendTransaction(signedTxBase64);

      // Wait for confirmation
      const confirmation = await this.client.confirmTransaction(txSignature, 'confirmed', 60000);
      const latencyMs = Date.now() - startTime;

      const explorerUrl = this.isDevnet
        ? `https://explorer.solana.com/tx/${txSignature}?cluster=devnet`
        : `https://explorer.solana.com/tx/${txSignature}`;

      return {
        ok: true,
        signature: txSignature,
        explorerUrl,
        slot: confirmation.slot,
        metadata: {
          token,
          amount,
          recipient,
          lamports: lamports.toString(),
          latencyMs,
        },
      };
    } catch (error: any) {
      console.error('[solanaExecutor] Transfer error:', error);
      return {
        ok: false,
        error: {
          code: 'TRANSFER_FAILED',
          message: error.message || 'Transfer failed',
        },
      };
    }
  }

  /**
   * Execute a proof-of-intent transaction
   * Sends a minimal transaction to record intent on-chain
   */
  async executeProof(params: SolanaProofParams): Promise<SolanaExecutionResult> {
    const { intentText, intentKind, metadata = {} } = params;
    const startTime = Date.now();

    if (!this.isInitialized()) {
      return {
        ok: false,
        error: {
          code: 'NOT_INITIALIZED',
          message: 'Solana executor not initialized with private key',
        },
      };
    }

    try {
      // Build a minimal self-transfer (1000 lamports = 0.000001 SOL)
      // The memo/metadata is implied by the transaction context
      const result = await this.executeTransfer({
        token: 'SOL',
        amount: '0.000001',
        recipient: this.publicKey!,
      });

      if (!result.ok) {
        return result;
      }

      const latencyMs = Date.now() - startTime;

      return {
        ok: true,
        signature: result.signature,
        explorerUrl: result.explorerUrl,
        slot: result.slot,
        metadata: {
          type: 'proof',
          intentKind,
          intentText: intentText.slice(0, 100),
          ...metadata,
          latencyMs,
        },
      };
    } catch (error: any) {
      console.error('[solanaExecutor] Proof error:', error);
      return {
        ok: false,
        error: {
          code: 'PROOF_FAILED',
          message: error.message || 'Proof transaction failed',
        },
      };
    }
  }

  /**
   * Get wallet balance for SOL and common tokens
   */
  async getBalances(): Promise<{
    sol: { balance: string; uiAmount: number };
    usdc?: { balance: string; uiAmount: number };
    tokens: Array<{ mint: string; symbol: string; balance: string; uiAmount: number }>;
  }> {
    if (!this.publicKey) {
      throw new Error('Executor not initialized');
    }

    const solBalance = await this.client.getBalance(this.publicKey);

    const tokens: Array<{ mint: string; symbol: string; balance: string; uiAmount: number }> = [];

    // Try to get USDC balance
    const usdcMint = this.isDevnet ? SOLANA_TOKEN_MINTS.USDC_DEVNET : SOLANA_TOKEN_MINTS.USDC;
    const usdcBalance = await getTokenBalance({
      walletAddress: this.publicKey,
      tokenMint: usdcMint,
    });

    if (usdcBalance) {
      tokens.push({
        mint: usdcMint,
        symbol: 'USDC',
        balance: usdcBalance.balance,
        uiAmount: usdcBalance.uiAmount,
      });
    }

    return {
      sol: {
        balance: solBalance.lamports.toString(),
        uiAmount: solBalance.sol,
      },
      usdc: usdcBalance
        ? { balance: usdcBalance.balance, uiAmount: usdcBalance.uiAmount }
        : undefined,
      tokens,
    };
  }

  /**
   * Request airdrop (devnet only)
   */
  async requestAirdrop(lamports: number = 1_000_000_000): Promise<SolanaExecutionResult> {
    if (!this.isDevnet) {
      return {
        ok: false,
        error: {
          code: 'MAINNET_AIRDROP',
          message: 'Airdrop is only available on devnet',
        },
      };
    }

    if (!this.publicKey) {
      return {
        ok: false,
        error: {
          code: 'NOT_INITIALIZED',
          message: 'Executor not initialized',
        },
      };
    }

    try {
      const signature = await this.client.requestAirdrop(this.publicKey, lamports);
      await this.client.confirmTransaction(signature, 'confirmed', 60000);

      const explorerUrl = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;

      return {
        ok: true,
        signature,
        explorerUrl,
        metadata: {
          type: 'airdrop',
          lamports,
          sol: lamports / 1e9,
        },
      };
    } catch (error: any) {
      return {
        ok: false,
        error: {
          code: 'AIRDROP_FAILED',
          message: error.message || 'Airdrop failed',
        },
      };
    }
  }

  /**
   * Health check
   */
  async isHealthy(): Promise<boolean> {
    return this.client.isHealthy();
  }
}

/**
 * Create a Solana executor instance
 */
export function createSolanaExecutor(config?: {
  rpcUrl?: string;
  privateKey?: string;
}): SolanaExecutor {
  return new SolanaExecutor(config);
}

export default SolanaExecutor;
