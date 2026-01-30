/**
 * Execution Guard - UX Hardening for Wallet + Chain Realities
 *
 * Provides deterministic UX so testers can't get stuck:
 * - Wallet connection state detection
 * - Chain ID validation (Sepolia = 11155111)
 * - Gas/balance checks
 * - Friendly error messages
 */

import { sepolia } from 'wagmi/chains';

// Error codes for friendly mapping
export type ExecutionError =
  | 'WALLET_NOT_CONNECTED'
  | 'WRONG_CHAIN'
  | 'INSUFFICIENT_GAS'
  | 'INSUFFICIENT_BALANCE'
  | 'EXECUTION_PREPARE_FAILED'
  | 'EXECUTION_FAILED'
  | 'UNKNOWN_ERROR';

// Friendly error messages
export const ERROR_MESSAGES: Record<ExecutionError, { title: string; message: string; action?: string }> = {
  WALLET_NOT_CONNECTED: {
    title: 'Wallet Not Connected',
    message: 'Please connect your wallet to execute trades.',
    action: 'Connect Wallet',
  },
  WRONG_CHAIN: {
    title: 'Wrong Network',
    message: 'Please switch to Sepolia testnet to execute.',
    action: 'Switch to Sepolia',
  },
  INSUFFICIENT_GAS: {
    title: 'Insufficient Gas',
    message: 'You need Sepolia ETH for gas fees.',
    action: 'Get Sepolia ETH',
  },
  INSUFFICIENT_BALANCE: {
    title: 'Insufficient Balance',
    message: 'You don\'t have enough tokens for this trade.',
    action: 'Mint Demo Tokens',
  },
  EXECUTION_PREPARE_FAILED: {
    title: 'Preparation Failed',
    message: 'Failed to prepare the execution plan. Please try again.',
  },
  EXECUTION_FAILED: {
    title: 'Execution Failed',
    message: 'The transaction failed. Please try again.',
  },
  UNKNOWN_ERROR: {
    title: 'Something Went Wrong',
    message: 'An unexpected error occurred. Please try again.',
  },
};

// Faucet URLs
export const FAUCET_URLS = {
  sepoliaEth: 'https://sepoliafaucet.com/',
  sepoliaAlt: 'https://www.alchemy.com/faucets/ethereum-sepolia',
};

// Demo token mint info
export const DEMO_TOKEN_INFO = {
  usdc: {
    address: '0x6751001fD8207c494703C062139784abCa099bB9',
    symbol: 'REDACTED',
  },
  weth: {
    address: '0x1dDc15c5655f5e8633C170105929d9562e12D9e3',
    symbol: 'WETH',
  },
};

export interface ExecutionGuardResult {
  canExecute: boolean;
  error?: ExecutionError;
  errorMessage?: string;
}

export interface WalletState {
  isConnected: boolean;
  chainId?: number;
  address?: string;
  ethBalance?: number; // in ETH
}

/**
 * Check if execution can proceed
 */
export function checkExecutionGuard(walletState: WalletState): ExecutionGuardResult {
  // Check wallet connection
  if (!walletState.isConnected || !walletState.address) {
    return {
      canExecute: false,
      error: 'WALLET_NOT_CONNECTED',
      errorMessage: ERROR_MESSAGES.WALLET_NOT_CONNECTED.message,
    };
  }

  // Check chain (must be Sepolia)
  if (walletState.chainId !== sepolia.id) {
    return {
      canExecute: false,
      error: 'WRONG_CHAIN',
      errorMessage: ERROR_MESSAGES.WRONG_CHAIN.message,
    };
  }

  // Check gas (minimum 0.001 ETH for basic tx)
  if (walletState.ethBalance !== undefined && walletState.ethBalance < 0.001) {
    return {
      canExecute: false,
      error: 'INSUFFICIENT_GAS',
      errorMessage: ERROR_MESSAGES.INSUFFICIENT_GAS.message,
    };
  }

  return { canExecute: true };
}

/**
 * Map server error to friendly error code
 */
export function mapServerError(error: string | Error | unknown): ExecutionError {
  const errorStr = typeof error === 'string' ? error : (error as Error)?.message || '';
  const lower = errorStr.toLowerCase();

  if (lower.includes('wallet') && lower.includes('connect')) {
    return 'WALLET_NOT_CONNECTED';
  }
  if (lower.includes('chain') || lower.includes('network') || lower.includes('wrong')) {
    return 'WRONG_CHAIN';
  }
  if (lower.includes('gas') || lower.includes('insufficient funds for gas')) {
    return 'INSUFFICIENT_GAS';
  }
  if (lower.includes('balance') || lower.includes('insufficient')) {
    return 'INSUFFICIENT_BALANCE';
  }
  if (lower.includes('prepare') || lower.includes('plan')) {
    return 'EXECUTION_PREPARE_FAILED';
  }
  if (lower.includes('execution') || lower.includes('failed') || lower.includes('revert')) {
    return 'EXECUTION_FAILED';
  }

  return 'UNKNOWN_ERROR';
}

/**
 * Get Sepolia chain switch params for wallet_switchEthereumChain
 */
export function getSepoliaSwitchParams() {
  return {
    chainId: '0xaa36a7', // 11155111 in hex
  };
}

/**
 * Request chain switch to Sepolia
 */
export async function switchToSepolia(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.ethereum) {
    return false;
  }

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [getSepoliaSwitchParams()],
    });
    return true;
  } catch (error: any) {
    // Chain not added, try to add it
    if (error.code === 4902) {
      try {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: '0xaa36a7',
            chainName: 'Sepolia',
            nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
            rpcUrls: ['https://sepolia.infura.io/v3/'],
            blockExplorerUrls: ['https://sepolia.etherscan.io'],
          }],
        });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

/**
 * Generate a short fingerprint from access code (non-reversible)
 */
export function generateAccessFingerprint(accessCode: string): string {
  // Simple hash-like fingerprint using string operations
  // Not cryptographically secure, but sufficient for our use case
  let hash = 0;
  const str = accessCode.toUpperCase().trim();
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `fp_${Math.abs(hash).toString(36)}`;
}

/**
 * Generate a new anonymous identity key
 */
export function generateAnonIdentityKey(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `anon-${timestamp}-${random}`;
}

/**
 * Get current anon identity key from localStorage
 */
export function getAnonIdentityKey(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('blossom_anon_id');
}

/**
 * Set anon identity key in localStorage
 */
export function setAnonIdentityKey(key: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('blossom_anon_id', key);
}

/**
 * Get stored access fingerprint
 */
export function getStoredAccessFingerprint(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('blossom_last_access_fingerprint');
}

/**
 * Set access fingerprint
 */
export function setAccessFingerprint(fingerprint: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('blossom_last_access_fingerprint', fingerprint);
}

/**
 * Clear chat sessions for current anon identity
 */
export function clearChatSessions(): void {
  if (typeof window === 'undefined') return;

  const anonId = getAnonIdentityKey();
  if (anonId) {
    // Clear chat sessions for this identity
    localStorage.removeItem(`blossom_chat_sessions_${anonId}`);
    localStorage.removeItem(`blossom_active_chat_id_${anonId}`);
  }

  // Also clear generic keys if they exist
  localStorage.removeItem('blossom_chat_sessions');
  localStorage.removeItem('blossom_active_chat_id');
}

/**
 * Handle access code change - implements clean slate logic
 * Returns true if session was reset
 */
export function handleAccessCodeChange(
  newAccessCode: string,
  isWalletConnected: boolean
): boolean {
  const newFingerprint = generateAccessFingerprint(newAccessCode);
  const oldFingerprint = getStoredAccessFingerprint();

  // If fingerprint changed AND wallet is NOT connected
  if (oldFingerprint && oldFingerprint !== newFingerprint && !isWalletConnected) {
    // Clear previous chat sessions
    clearChatSessions();

    // Generate new anon identity
    const newAnonId = generateAnonIdentityKey();
    setAnonIdentityKey(newAnonId);

    // Store new fingerprint
    setAccessFingerprint(newFingerprint);

    console.log('[ExecutionGuard] Access code changed, session reset', {
      oldFingerprint,
      newFingerprint,
      newAnonId,
    });

    return true;
  }

  // Store fingerprint (first time or same code)
  setAccessFingerprint(newFingerprint);

  // Ensure anon identity exists
  if (!getAnonIdentityKey()) {
    const newAnonId = generateAnonIdentityKey();
    setAnonIdentityKey(newAnonId);
  }

  return false;
}

/**
 * Full session reset (for "Clear chat + reset session" button)
 */
export function resetSession(): void {
  clearChatSessions();
  const newAnonId = generateAnonIdentityKey();
  setAnonIdentityKey(newAnonId);
  console.log('[ExecutionGuard] Manual session reset', { newAnonId });
}
