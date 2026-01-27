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
 */
export async function sendTransaction(tx: PreparedTx): Promise<string | null> {
  try {
    const ethereum = getEthereum();
    if (!ethereum) {
      console.warn('[walletAdapter] No ethereum provider for transaction');
      return null;
    }

    const from = await getAddress();
    if (!from) {
      console.warn('[walletAdapter] No connected address for transaction');
      return null;
    }

    const txParams: any = {
      from,
      to: tx.to,
      data: tx.data || '0x',
    };

    if (tx.value) {
      txParams.value = tx.value;
    }

    if (tx.gasLimit) {
      txParams.gas = tx.gasLimit;
    }

    const txHash = await ethereum.request({
      method: 'eth_sendTransaction',
      params: [txParams],
    });

    return txHash;
  } catch (error: any) {
    console.warn('[walletAdapter] Transaction failed:', error?.message || error);
    return null;
  }
}
