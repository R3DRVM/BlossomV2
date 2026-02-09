/**
 * Wallet State Bridge
 *
 * Syncs wagmi (EVM) and Solana wallet adapter state into the existing
 * BlossomContext and wallet adapter system. This allows the legacy
 * wallet detection to work with the new RainbowKit/Solana adapters.
 */

import { useEffect, useRef } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { useWallet } from '@solana/wallet-adapter-react';
import { sepolia } from 'wagmi/chains';

// Update the legacy walletAdapter's explicit connection state
// This is a minimal bridge that keeps existing code working
function normalizeStoredAddress(address: string): string {
  const trimmed = address.trim();
  if (trimmed.startsWith('0x') && trimmed.length === 42) {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

function setExplicitlyConnected(connected: boolean, address: string | null) {
  // Store in localStorage for cross-tab sync (existing pattern)
  if (connected && address) {
    localStorage.setItem('blossom_wallet_explicit_connected', 'true');
    localStorage.setItem('blossom_wallet_address', normalizeStoredAddress(address));
  } else {
    localStorage.removeItem('blossom_wallet_explicit_connected');
    localStorage.removeItem('blossom_wallet_address');
  }
}

// Get the explicit address if set
function getExplicitAddress(): string | null {
  const connected = localStorage.getItem('blossom_wallet_explicit_connected');
  if (connected === 'true') {
    return localStorage.getItem('blossom_wallet_address');
  }
  return null;
}

export default function WalletStateBridge() {
  // EVM wallet state
  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  const evmChainId = useChainId();

  // Solana wallet state
  const { publicKey: solPublicKey, connected: solConnected } = useWallet();

  // Track previous state to detect changes
  const prevEvmRef = useRef<{ connected: boolean; address: string | null }>({
    connected: false,
    address: null,
  });
  const prevSolRef = useRef<{ connected: boolean; address: string | null }>({
    connected: false,
    address: null,
  });

  // Sync EVM wallet state
  useEffect(() => {
    const currentAddress = evmAddress?.toLowerCase() ?? null;
    const wasConnected = prevEvmRef.current.connected;
    const prevAddress = prevEvmRef.current.address;

    // Update refs
    prevEvmRef.current = { connected: evmConnected, address: currentAddress };

    // Detect connection change
    if (evmConnected && currentAddress && !wasConnected) {
      // Just connected
      if (import.meta.env.DEV) {
        console.log('[WalletStateBridge] EVM wallet connected:', currentAddress.slice(0, 10));
      }
      setExplicitlyConnected(true, currentAddress);

      // Trigger portfolio sync
      window.dispatchEvent(new CustomEvent('blossom-wallet-connection-change'));

      // Also trigger balance fetch if on correct network
      if (evmChainId === sepolia.id) {
        window.dispatchEvent(new CustomEvent('blossom-wallet-connected', {
          detail: { address: currentAddress, chain: 'ethereum', network: 'sepolia' },
        }));
      }
    } else if (!evmConnected && wasConnected) {
      // Just disconnected
      if (import.meta.env.DEV) {
        console.log('[WalletStateBridge] EVM wallet disconnected');
      }

      // Only clear if no Solana wallet connected
      if (!solConnected) {
        setExplicitlyConnected(false, null);
      }

      window.dispatchEvent(new CustomEvent('blossom-wallet-disconnect'));
    } else if (evmConnected && currentAddress !== prevAddress && currentAddress) {
      // Address changed (account switch)
      if (import.meta.env.DEV) {
        console.log('[WalletStateBridge] EVM address changed:', currentAddress.slice(0, 10));
      }
      setExplicitlyConnected(true, currentAddress);
      window.dispatchEvent(new CustomEvent('blossom-wallet-connection-change'));
    }
  }, [evmConnected, evmAddress, evmChainId, solConnected]);

  // Sync Solana wallet state
  useEffect(() => {
    const currentAddress = solPublicKey?.toBase58() ?? null;
    const wasConnected = prevSolRef.current.connected;

    // Update refs
    prevSolRef.current = { connected: solConnected, address: currentAddress };

    // Detect connection change
    if (solConnected && currentAddress && !wasConnected) {
      // Just connected
      if (import.meta.env.DEV) {
        console.log('[WalletStateBridge] Solana wallet connected:', currentAddress.slice(0, 10));
      }

      // If no EVM wallet, set Solana as primary
      if (!evmConnected) {
        setExplicitlyConnected(true, currentAddress);
      }

      window.dispatchEvent(new CustomEvent('blossom-wallet-connected', {
        detail: { address: currentAddress, chain: 'solana', network: 'devnet' },
      }));
    } else if (!solConnected && wasConnected) {
      // Just disconnected
      if (import.meta.env.DEV) {
        console.log('[WalletStateBridge] Solana wallet disconnected');
      }

      // Only clear if no EVM wallet connected
      if (!evmConnected) {
        setExplicitlyConnected(false, null);
        window.dispatchEvent(new CustomEvent('blossom-wallet-disconnect'));
      }
    }
  }, [solConnected, solPublicKey, evmConnected]);

  // This component doesn't render anything
  return null;
}

// Export utility functions for other components
export { getExplicitAddress };
