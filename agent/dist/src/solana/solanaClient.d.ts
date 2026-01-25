/**
 * Solana Devnet Client
 * Minimal RPC client for Solana devnet execution
 *
 * No external dependencies - uses native fetch for RPC calls
 */
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
export declare class SolanaClient {
    private rpcUrl;
    constructor(config?: SolanaClientConfig);
    /**
     * Make an RPC call to Solana
     */
    private rpcCall;
    /**
     * Get SOL balance for a public key
     */
    getBalance(pubkey: string): Promise<BalanceResult>;
    /**
     * Get recent blockhash for transaction signing
     */
    getRecentBlockhash(): Promise<{
        blockhash: string;
        lastValidBlockHeight: number;
    }>;
    /**
     * Send a signed transaction (base64 encoded)
     */
    sendTransaction(signedTx: string, options?: {
        encoding?: 'base64' | 'base58';
        skipPreflight?: boolean;
    }): Promise<string>;
    /**
     * Get transaction status
     */
    getSignatureStatuses(signatures: string[]): Promise<Array<{
        slot: number;
        confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null;
        err: any;
    } | null>>;
    /**
     * Confirm a transaction with timeout
     */
    confirmTransaction(signature: string, commitment?: 'processed' | 'confirmed' | 'finalized', timeoutMs?: number): Promise<TransactionResult>;
    /**
     * Request airdrop (devnet only)
     */
    requestAirdrop(pubkey: string, lamports?: number): Promise<string>;
    /**
     * Get account info
     */
    getAccountInfo(pubkey: string): Promise<{
        lamports: number;
        owner: string;
        data: string;
        executable: boolean;
    } | null>;
    /**
     * Get cluster info
     */
    getClusterNodes(): Promise<Array<{
        pubkey: string;
        gossip: string;
        rpc: string | null;
        version: string;
    }>>;
    /**
     * Get slot
     */
    getSlot(): Promise<number>;
    /**
     * Health check
     */
    isHealthy(): Promise<boolean>;
}
/**
 * Create a Solana devnet client
 */
export declare function createSolanaClient(rpcUrl?: string): SolanaClient;
export default SolanaClient;
//# sourceMappingURL=solanaClient.d.ts.map