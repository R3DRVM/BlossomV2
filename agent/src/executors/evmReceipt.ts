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
export async function waitForReceipt(
  rpcUrl: string,
  txHash: string,
  options: {
    timeoutMs?: number;
    pollMs?: number;
  } = {}
): Promise<ReceiptResult> {
  const { timeoutMs = 60000, pollMs = 2000 } = options;
  
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const receipt = await getTransactionReceipt(rpcUrl, txHash);
      
      if (receipt) {
        // Receipt exists - check status
        // status: 0x1 = success, 0x0 = failed
        const statusHex = receipt.status;
        const blockNumber = receipt.blockNumber 
          ? parseInt(receipt.blockNumber, 16) 
          : undefined;
        const gasUsed = receipt.gasUsed;

        if (statusHex === '0x1') {
          return {
            status: 'confirmed',
            blockNumber,
            gasUsed,
          };
        } else {
          return {
            status: 'failed',
            blockNumber,
            gasUsed,
            error: 'Transaction reverted on-chain',
          };
        }
      }

      // No receipt yet - wait and poll again
      await sleep(pollMs);
    } catch (error: any) {
      console.warn('[waitForReceipt] Poll error:', error.message);
      // Continue polling on transient errors
      await sleep(pollMs);
    }
  }

  // Timeout reached
  return {
    status: 'timeout',
    error: `Transaction not confirmed within ${timeoutMs / 1000}s`,
  };
}

/**
 * Get transaction receipt via JSON-RPC
 */
async function getTransactionReceipt(
  rpcUrl: string,
  txHash: string
): Promise<any | null> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getTransactionReceipt',
      params: [txHash],
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC request failed: ${response.status}`);
  }

  const data = await response.json();
  
  if (data.error) {
    throw new Error(data.error.message || 'RPC error');
  }

  // result is null if receipt not yet available
  return data.result;
}

/**
 * Simple sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if a transaction is pending (no receipt yet)
 */
export async function isTransactionPending(
  rpcUrl: string,
  txHash: string
): Promise<boolean> {
  try {
    const receipt = await getTransactionReceipt(rpcUrl, txHash);
    return receipt === null;
  } catch {
    return true; // Assume pending on error
  }
}


