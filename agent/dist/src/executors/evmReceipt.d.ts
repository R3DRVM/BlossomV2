/**
 * EVM Receipt Watcher
 * Polls for transaction receipts to confirm on-chain execution.
 */
export interface ReceiptResult {
    status: 'confirmed' | 'failed' | 'timeout' | 'pending';
    blockNumber?: number;
    gasUsed?: string;
    error?: string;
}
/**
 * Wait for a transaction receipt with polling
 * @param rpcUrl RPC endpoint URL
 * @param txHash Transaction hash to watch
 * @param options Timeout and poll interval options
 * @returns Receipt result with status
 */
export declare function waitForReceipt(rpcUrl: string, txHash: string, options?: {
    timeoutMs?: number;
    pollMs?: number;
}): Promise<ReceiptResult>;
/**
 * Check if a transaction is pending (no receipt yet)
 */
export declare function isTransactionPending(rpcUrl: string, txHash: string): Promise<boolean>;
//# sourceMappingURL=evmReceipt.d.ts.map