/**
 * Solana Devnet Client
 * Minimal RPC client for Solana devnet execution
 *
 * No external dependencies - uses native fetch for RPC calls
 */

const DEFAULT_DEVNET_RPC = 'https://api.devnet.solana.com';

export interface SolanaClientConfig {
  rpcUrl?: string;
}

export interface TransactionResult {
  signature: string;
  slot?: number;
  confirmationStatus?: 'processed' | 'confirmed' | 'finalized';
}

export interface BalanceResult {
  lamports: number;
  sol: number;
}

/**
 * Solana RPC client for devnet operations
 */
export class SolanaClient {
  private rpcUrl: string;

  constructor(config: SolanaClientConfig = {}) {
    this.rpcUrl = config.rpcUrl || process.env.SOLANA_RPC_URL || DEFAULT_DEVNET_RPC;
  }

  /**
   * Make an RPC call to Solana
   */
  private async rpcCall<T>(method: string, params: any[] = []): Promise<T> {
    const response = await fetch(this.rpcUrl, {
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
   * Get SOL balance for a public key
   */
  async getBalance(pubkey: string): Promise<BalanceResult> {
    const result = await this.rpcCall<{ value: number }>('getBalance', [pubkey]);
    const lamports = result.value;
    return {
      lamports,
      sol: lamports / 1_000_000_000, // Convert lamports to SOL
    };
  }

  /**
   * Get recent blockhash for transaction signing
   */
  async getRecentBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    const result = await this.rpcCall<{
      value: { blockhash: string; lastValidBlockHeight: number };
    }>('getLatestBlockhash', [{ commitment: 'finalized' }]);
    return result.value;
  }

  /**
   * Send a signed transaction (base64 encoded)
   */
  async sendTransaction(
    signedTx: string,
    options: { encoding?: 'base64' | 'base58'; skipPreflight?: boolean } = {}
  ): Promise<string> {
    const { encoding = 'base64', skipPreflight = false } = options;

    const signature = await this.rpcCall<string>('sendTransaction', [
      signedTx,
      {
        encoding,
        skipPreflight,
        preflightCommitment: 'confirmed',
      },
    ]);

    return signature;
  }

  /**
   * Get transaction status
   */
  async getSignatureStatuses(
    signatures: string[]
  ): Promise<Array<{
    slot: number;
    confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null;
    err: any;
  } | null>> {
    const result = await this.rpcCall<{
      value: Array<{
        slot: number;
        confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null;
        err: any;
      } | null>;
    }>('getSignatureStatuses', [signatures, { searchTransactionHistory: true }]);

    return result.value;
  }

  /**
   * Confirm a transaction with timeout
   */
  async confirmTransaction(
    signature: string,
    commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed',
    timeoutMs: number = 30000
  ): Promise<TransactionResult> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const statuses = await this.getSignatureStatuses([signature]);
      const status = statuses[0];

      if (status) {
        if (status.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
        }

        const commitmentLevels = ['processed', 'confirmed', 'finalized'];
        const targetLevel = commitmentLevels.indexOf(commitment);
        const currentLevel = status.confirmationStatus
          ? commitmentLevels.indexOf(status.confirmationStatus)
          : -1;

        if (currentLevel >= targetLevel) {
          return {
            signature,
            slot: status.slot,
            confirmationStatus: status.confirmationStatus || undefined,
          };
        }
      }

      // Wait 1 second before checking again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error(`Transaction confirmation timeout after ${timeoutMs}ms`);
  }

  /**
   * Request airdrop (devnet only)
   */
  async requestAirdrop(pubkey: string, lamports: number = 1_000_000_000): Promise<string> {
    const signature = await this.rpcCall<string>('requestAirdrop', [pubkey, lamports]);
    return signature;
  }

  /**
   * Get account info
   */
  async getAccountInfo(pubkey: string): Promise<{
    lamports: number;
    owner: string;
    data: string;
    executable: boolean;
  } | null> {
    const result = await this.rpcCall<{
      value: {
        lamports: number;
        owner: string;
        data: [string, string];
        executable: boolean;
      } | null;
    }>('getAccountInfo', [pubkey, { encoding: 'base64' }]);

    if (!result.value) return null;

    return {
      lamports: result.value.lamports,
      owner: result.value.owner,
      data: result.value.data[0],
      executable: result.value.executable,
    };
  }

  /**
   * Get cluster info
   */
  async getClusterNodes(): Promise<Array<{
    pubkey: string;
    gossip: string;
    rpc: string | null;
    version: string;
  }>> {
    return this.rpcCall('getClusterNodes', []);
  }

  /**
   * Get slot
   */
  async getSlot(): Promise<number> {
    return this.rpcCall('getSlot', []);
  }

  /**
   * Health check
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.getSlot();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Create a Solana devnet client
 */
export function createSolanaClient(rpcUrl?: string): SolanaClient {
  return new SolanaClient({ rpcUrl });
}

export default SolanaClient;
