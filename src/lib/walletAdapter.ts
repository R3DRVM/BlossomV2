/**
 * Wallet Adapter
 *
 * Minimal, safe wallet adapter that doesn't throw when wallet is unavailable.
 * Returns null/undefined gracefully - components must handle these cases.
 *
 * SSR-safe: Does not access window at module import time.
 */

// Type for prepared transactions
export interface PreparedTx {
  to: string;
  data?: string;
  value?: string;
  chainId?: number;
  gasLimit?: string;
}

// Type for EIP-1193 compliant transaction params (all fields are strings)
export interface Eip1193TxParams {
  from: string;
  to: string;
  value: string;
  data: string;
  gas?: string;
}

/**
 * Normalize a value to a hex string
 * - If already a valid hex string, returns as-is (lowercased)
 * - If a number, converts to hex
 * - If undefined/null/empty, returns the default value
 */
function toHexString(value: string | number | undefined | null, defaultValue: string): string {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  if (typeof value === 'number') {
    return '0x' + value.toString(16);
  }

  if (typeof value === 'string') {
    // Already a hex string
    if (value.startsWith('0x')) {
      return value.toLowerCase();
    }
    // Try to parse as number and convert
    const num = parseInt(value, 10);
    if (!isNaN(num)) {
      return '0x' + num.toString(16);
    }
    // Invalid format, return default
    console.warn('[walletAdapter] Invalid value format, using default:', value);
    return defaultValue;
  }

  return defaultValue;
}

/**
 * Validate and normalize an Ethereum address
 * Returns lowercase hex address or throws if invalid
 */
function normalizeAddress(address: string | undefined | null, fieldName: string): string {
  if (!address || typeof address !== 'string') {
    throw new Error(`[walletAdapter] ${fieldName} is required and must be a string`);
  }

  const trimmed = address.trim().toLowerCase();

  if (!trimmed.startsWith('0x') || trimmed.length !== 42) {
    throw new Error(`[walletAdapter] ${fieldName} must be a valid 42-character hex address: ${address}`);
  }

  // Validate it's actually hex
  if (!/^0x[a-f0-9]{40}$/.test(trimmed)) {
    throw new Error(`[walletAdapter] ${fieldName} contains invalid characters: ${address}`);
  }

  return trimmed;
}

/**
 * Normalize transaction params for EIP-1193 eth_sendTransaction
 *
 * Ensures:
 * - from/to are lowercase hex addresses
 * - value is a hex string (default "0x0")
 * - data is a hex string (default "0x")
 * - gas is a hex string (if provided)
 * - NO chainId (MetaMask handles this internally)
 * - NO undefined values
 *
 * This prevents MetaMask errors like "e.toLowerCase is not a function"
 */
export function normalizeEip1193Tx(
  from: string | undefined | null,
  tx: PreparedTx
): Eip1193TxParams {
  // Validate and normalize addresses
  const normalizedFrom = normalizeAddress(from, 'from');
  const normalizedTo = normalizeAddress(tx.to, 'to');

  // Normalize value (default to 0x0 if not specified)
  const normalizedValue = toHexString(tx.value, '0x0');

  // Normalize data (default to 0x if not specified)
  let normalizedData = '0x';
  if (tx.data && typeof tx.data === 'string' && tx.data.trim()) {
    normalizedData = tx.data.toLowerCase();
    if (!normalizedData.startsWith('0x')) {
      normalizedData = '0x' + normalizedData;
    }
  }

  // Build params object - explicitly typed, no undefined values
  const params: Eip1193TxParams = {
    from: normalizedFrom,
    to: normalizedTo,
    value: normalizedValue,
    data: normalizedData,
  };

  // Add gas only if provided (as hex string)
  if (tx.gasLimit) {
    params.gas = toHexString(tx.gasLimit, undefined as any);
    if (!params.gas) {
      delete params.gas; // Remove if conversion failed
    }
  }

  // DO NOT include chainId - MetaMask handles this internally
  // Including chainId can cause issues with some wallets

  // Log the normalized params for debugging
  if (import.meta.env.DEV) {
    console.log('[walletAdapter] normalizeEip1193Tx:', {
      original: { from, to: tx.to, value: tx.value, data: tx.data?.slice(0, 20) + '...', gasLimit: tx.gasLimit },
      normalized: { ...params, data: params.data.slice(0, 20) + '...' },
    });
  }

  return params;
}

// Cache for explicit connection state
let explicitlyConnected = false;
let cachedAddress: string | null = null;

/**
 * Check if explicitly connected via localStorage (set by WalletStateBridge)
 * This bridges the wagmi/solana wallet state into the legacy system.
 */
function checkExplicitFromStorage(): { connected: boolean; address: string | null } {
  if (typeof window === 'undefined') return { connected: false, address: null };
  const connected = localStorage.getItem('blossom_wallet_explicit_connected') === 'true';
  const address = localStorage.getItem('blossom_wallet_address');
  return { connected, address };
}

/**
 * Check if window.ethereum is available
 */
function getEthereum(): any | null {
  if (typeof window === 'undefined') return null;
  return (window as any).ethereum ?? null;
}

/**
 * Get connected wallet address (if any)
 * Returns null if not connected or no wallet available
 */
export async function getAddress(): Promise<string | null> {
  try {
    const ethereum = getEthereum();
    if (!ethereum) return null;

    const accounts = await ethereum.request({ method: 'eth_accounts' });
    if (accounts && accounts.length > 0) {
      cachedAddress = accounts[0];
      return accounts[0];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get address only if user explicitly connected this session
 * Returns null if no explicit connection was made.
 * Checks both in-memory state and localStorage (for wagmi/solana bridge).
 */
export async function getAddressIfExplicit(): Promise<string | null> {
  // First check localStorage (set by WalletStateBridge for wagmi/solana)
  const storageState = checkExplicitFromStorage();
  if (storageState.connected && storageState.address) {
    // Update in-memory cache to match
    explicitlyConnected = true;
    cachedAddress = storageState.address;
    return storageState.address;
  }

  // Fall back to in-memory state (legacy behavior)
  if (!explicitlyConnected) return null;
  return getAddress();
}

/**
 * Check if user has explicitly connected
 * Checks both in-memory state and localStorage.
 */
export function isExplicitlyConnected(): boolean {
  const storageState = checkExplicitFromStorage();
  return explicitlyConnected || storageState.connected;
}

/**
 * Get the current chain ID
 */
export async function getChainId(): Promise<number | null> {
  try {
    const ethereum = getEthereum();
    if (!ethereum) return null;

    const chainIdHex = await ethereum.request({ method: 'eth_chainId' });
    return parseInt(chainIdHex, 16);
  } catch {
    return null;
  }
}

/**
 * Get the ethereum provider
 */
export function getProvider(): any | null {
  return getEthereum();
}

/**
 * Connect wallet (request accounts)
 */
export async function connectWallet(): Promise<string | null> {
  try {
    const ethereum = getEthereum();
    if (!ethereum) {
      console.warn('[walletAdapter] No ethereum provider found');
      return null;
    }

    const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
    if (accounts && accounts.length > 0) {
      explicitlyConnected = true;
      cachedAddress = accounts[0];
      return accounts[0];
    }
    return null;
  } catch (error: any) {
    console.warn('[walletAdapter] Connect failed:', error?.message || error);
    return null;
  }
}

/**
 * Disconnect wallet (clears local state only)
 */
export function disconnectWallet(): void {
  explicitlyConnected = false;
  cachedAddress = null;
  // Also clear localStorage (in case set by WalletStateBridge)
  if (typeof window !== 'undefined') {
    localStorage.removeItem('blossom_wallet_explicit_connected');
    localStorage.removeItem('blossom_wallet_address');
  }
}

/**
 * Clear wallet cache
 */
export function clearWalletCache(): void {
  cachedAddress = null;
}

/**
 * Switch to Sepolia network
 */
export async function switchToSepolia(): Promise<boolean> {
  try {
    const ethereum = getEthereum();
    if (!ethereum) return false;

    // Sepolia chainId is 11155111 (0xaa36a7)
    const sepoliaChainId = '0xaa36a7';

    try {
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: sepoliaChainId }],
      });
      return true;
    } catch (switchError: any) {
      // If chain not added, try to add it
      if (switchError.code === 4902) {
        await ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: sepoliaChainId,
            chainName: 'Sepolia',
            nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
            rpcUrls: ['https://rpc.sepolia.org'],
            blockExplorerUrls: ['https://sepolia.etherscan.io'],
          }],
        });
        return true;
      }
      throw switchError;
    }
  } catch (error: any) {
    console.warn('[walletAdapter] Switch to Sepolia failed:', error?.message || error);
    return false;
  }
}

/**
 * Send a transaction
 *
 * Uses normalizeEip1193Tx to ensure params are EIP-1193 compliant:
 * - All fields are strings (hex format)
 * - No undefined values
 * - No chainId (MetaMask handles this)
 */
export async function sendTransaction(tx: PreparedTx): Promise<string | null> {
  const logPrefix = '[walletAdapter]';

  try {
    const ethereum = getEthereum();
    if (!ethereum) {
      console.warn(`${logPrefix} No ethereum provider for transaction`);
      return null;
    }

    const from = await getAddress();
    if (!from) {
      console.warn(`${logPrefix} No connected address for transaction`);
      return null;
    }

    // Normalize transaction params to ensure EIP-1193 compliance
    // This prevents "e.toLowerCase is not a function" and similar errors
    let txParams: Eip1193TxParams;
    try {
      txParams = normalizeEip1193Tx(from, tx);
    } catch (normalizeError: any) {
      console.error(`${logPrefix} Failed to normalize tx params:`, normalizeError.message);
      console.error(`${logPrefix} Original tx:`, { from, to: tx.to, value: tx.value, data: tx.data?.slice(0, 50) });
      return null;
    }

    // Log the exact params being sent (for debugging)
    console.log(`${logPrefix} Sending eth_sendTransaction:`, {
      from: txParams.from,
      to: txParams.to,
      value: txParams.value,
      dataLength: txParams.data?.length,
      gas: txParams.gas,
    });

    // Estimate gas and clamp to keep wallet/provider from defaulting to an invalidly high cap.
    // This prevents failures like "transaction gas limit too high".
    try {
      const estimatedGas = await ethereum.request({
        method: 'eth_estimateGas',
        params: [txParams],
      }) as string;

      if (estimatedGas && typeof estimatedGas === 'string' && estimatedGas.startsWith('0x')) {
        const estimate = BigInt(estimatedGas);
        const buffered = (estimate * 120n) / 100n; // +20% buffer
        const minGas = 300000n;
        const maxGas = 10000000n; // below common Sepolia block caps
        const clamped = buffered < minGas ? minGas : buffered > maxGas ? maxGas : buffered;
        txParams.gas = `0x${clamped.toString(16)}`;
      }
    } catch (estimateError: any) {
      // Fallback gas that is generally sufficient for router-based calls while staying safe.
      txParams.gas = '0x2dc6c0'; // 3,000,000
      if (import.meta.env.DEV) {
        console.warn(`${logPrefix} Gas estimation failed, using fallback gas:`, estimateError?.message);
      }
    }

    // Send the transaction
    const txHash = await ethereum.request({
      method: 'eth_sendTransaction',
      params: [txParams],
    });

    console.log(`${logPrefix} Transaction sent successfully:`, txHash);
    return txHash;
  } catch (error: any) {
    // Log detailed error info
    console.error(`${logPrefix} Transaction failed:`, {
      message: error?.message,
      code: error?.code,
      data: error?.data,
    });

    // Check for specific error patterns
    if (error?.message?.includes('toLowerCase')) {
      console.error(`${logPrefix} CRITICAL: toLowerCase error indicates malformed tx params. This should not happen after normalization.`);
    }

    return null;
  }
}
