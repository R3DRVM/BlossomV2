/**
 * Connect Wallet Button
 *
 * Universal wallet connection button with chain selection modal.
 * Supports:
 * - Ethereum (Sepolia) via RainbowKit
 * - Solana (Devnet) via Solana Wallet Adapter
 *
 * Light theme to match Blossom UI.
 */

import { useState, useEffect, useCallback } from 'react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useAccount, useDisconnect, useChainId, useSwitchChain, useBalance } from 'wagmi';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Wallet, ChevronDown, LogOut, AlertTriangle, RefreshCw } from 'lucide-react';
import { sepolia } from 'wagmi/chains';

interface ConnectWalletButtonProps {
  className?: string;
  variant?: 'primary' | 'compact';
}

// Shorten address for display
function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

export default function ConnectWalletButton({ className = '', variant = 'primary' }: ConnectWalletButtonProps) {
  const [showChainModal, setShowChainModal] = useState(false);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [solBalanceLoading, setSolBalanceLoading] = useState(false);

  // EVM (RainbowKit + wagmi)
  const { openConnectModal } = useConnectModal();
  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  const { disconnect: evmDisconnect } = useDisconnect();
  const evmChainId = useChainId();
  const { switchChain } = useSwitchChain();

  // EVM Balance
  const { data: evmBalanceData, isLoading: evmBalanceLoading, refetch: refetchEvmBalance } = useBalance({
    address: evmAddress,
    chainId: sepolia.id,
  });

  // Solana
  const { publicKey: solPublicKey, connected: solConnected, disconnect: solDisconnect } = useWallet();
  const { setVisible: setSolanaModalVisible } = useWalletModal();
  const { connection } = useConnection();

  // Fetch Solana balance
  useEffect(() => {
    if (solConnected && solPublicKey && connection) {
      setSolBalanceLoading(true);
      connection.getBalance(solPublicKey)
        .then((balance) => {
          setSolBalance(balance / LAMPORTS_PER_SOL);
        })
        .catch((err) => {
          console.warn('[Wallet] Failed to fetch SOL balance:', err);
          setSolBalance(null);
        })
        .finally(() => {
          setSolBalanceLoading(false);
        });
    } else {
      setSolBalance(null);
    }
  }, [solConnected, solPublicKey, connection]);

  // Chain status
  const isOnSepolia = evmChainId === sepolia.id;
  const showWrongNetwork = evmConnected && !isOnSepolia;

  // Handle chain selection
  const handleSelectChain = useCallback((chain: 'ethereum' | 'solana') => {
    setShowChainModal(false);
    if (chain === 'ethereum') {
      openConnectModal?.();
    } else {
      // Log for debugging Solana connection issues
      if (import.meta.env.DEV) {
        console.log('[Wallet] openSolanaModal clicked');
      }
      setSolanaModalVisible(true);
      // Confirm modal state changed
      if (import.meta.env.DEV) {
        // Use setTimeout to check after React updates
        setTimeout(() => {
          console.log('[Wallet] solana modal visible set to true');
        }, 100);
      }
    }
  }, [openConnectModal, setSolanaModalVisible]);

  // Close modal on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowChainModal(false);
    };
    if (showChainModal) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [showChainModal]);

  // Determine display state
  const hasAnyConnection = evmConnected || solConnected;

  // Format balance
  const formatBalance = (value: number | undefined | null, decimals = 4): string => {
    if (value === null || value === undefined) return '—';
    return value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals });
  };

  // If both disconnected, show connect button
  if (!hasAnyConnection) {
    return (
      <>
        <button
          onClick={() => setShowChainModal(true)}
          className={`flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white font-medium rounded-lg transition-all shadow-sm ${className}`}
        >
          <Wallet className="w-4 h-4" />
          Connect wallet
          <ChevronDown className="w-3 h-3" />
        </button>

        {/* Chain Selection Modal - Light Theme */}
        {showChainModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
            onClick={() => setShowChainModal(false)}
          >
            <div
              className="bg-white border border-slate-200 rounded-xl p-5 w-80 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-slate-900 mb-2 text-center">Select Network</h3>
              <p className="text-sm text-slate-500 mb-4 text-center">
                Choose which blockchain to connect
              </p>

              <div className="space-y-2">
                {/* Ethereum Option */}
                <button
                  onClick={() => handleSelectChain('ethereum')}
                  className="w-full flex items-center gap-3 p-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 hover:border-blue-300 rounded-lg transition-all group"
                >
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                    <svg className="w-6 h-6" viewBox="0 0 784 1277" fill="none">
                      <path d="M392.07 0L383.5 29.11v873.93l8.57 8.57 392.06-231.72z" fill="#343434"/>
                      <path d="M392.07 0L0 679.89l392.07 231.72V0z" fill="#8C8C8C"/>
                      <path d="M392.07 988.81l-4.82 5.87v300.95l4.82 14.08 392.34-552.35z" fill="#3C3C3B"/>
                      <path d="M392.07 1309.71V988.81L0 757.36z" fill="#8C8C8C"/>
                      <path d="M392.07 911.61l392.06-231.72-392.06-178.21z" fill="#141414"/>
                      <path d="M0 679.89l392.07 231.72V501.68z" fill="#393939"/>
                    </svg>
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-slate-900 font-medium">Ethereum</div>
                    <div className="text-xs text-slate-500">Sepolia Testnet</div>
                  </div>
                  <ChevronDown className="w-4 h-4 text-slate-400 group-hover:text-blue-500 -rotate-90" />
                </button>

                {/* Solana Option */}
                <button
                  onClick={() => handleSelectChain('solana')}
                  className="w-full flex items-center gap-3 p-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 hover:border-purple-300 rounded-lg transition-all group"
                >
                  <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                    <svg className="w-6 h-6" viewBox="0 0 397 311" fill="none">
                      <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" fill="url(#solana-a)"/>
                      <path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" fill="url(#solana-b)"/>
                      <path d="M332.1 120.8c-2.4-2.4-5.7-3.8-9.2-3.8H5.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" fill="url(#solana-c)"/>
                      <defs>
                        <linearGradient id="solana-a" x1="360.9" y1="-37.5" x2="141.5" y2="350.9" gradientUnits="userSpaceOnUse">
                          <stop stopColor="#00FFA3"/><stop offset="1" stopColor="#DC1FFF"/>
                        </linearGradient>
                        <linearGradient id="solana-b" x1="264.3" y1="-87.3" x2="44.9" y2="301.1" gradientUnits="userSpaceOnUse">
                          <stop stopColor="#00FFA3"/><stop offset="1" stopColor="#DC1FFF"/>
                        </linearGradient>
                        <linearGradient id="solana-c" x1="312.6" y1="-62.4" x2="93.2" y2="326" gradientUnits="userSpaceOnUse">
                          <stop stopColor="#00FFA3"/><stop offset="1" stopColor="#DC1FFF"/>
                        </linearGradient>
                      </defs>
                    </svg>
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-slate-900 font-medium">Solana</div>
                    <div className="text-xs text-slate-500">Devnet</div>
                  </div>
                  <ChevronDown className="w-4 h-4 text-slate-400 group-hover:text-purple-500 -rotate-90" />
                </button>
              </div>

              <button
                onClick={() => setShowChainModal(false)}
                className="w-full mt-3 py-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  // Connected state - show wallet info with balances (light theme)
  return (
    <div className={`space-y-2 ${className}`}>
      {/* EVM Wallet Status */}
      {evmConnected && evmAddress && (
        <div className="flex items-center gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5" viewBox="0 0 784 1277" fill="none">
              <path d="M392.07 0L383.5 29.11v873.93l8.57 8.57 392.06-231.72z" fill="#343434"/>
              <path d="M392.07 0L0 679.89l392.07 231.72V0z" fill="#8C8C8C"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500">Ethereum</span>
              {showWrongNetwork ? (
                <button
                  onClick={() => switchChain?.({ chainId: sepolia.id })}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] bg-amber-100 text-amber-700 rounded hover:bg-amber-200 transition-colors"
                >
                  <AlertTriangle className="w-2.5 h-2.5" />
                  Switch
                </button>
              ) : (
                <span className="px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-700 rounded">
                  Sepolia
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-900 font-mono truncate">
                {shortenAddress(evmAddress)}
              </span>
              <span className="text-sm text-slate-600">
                {evmBalanceLoading ? '...' : `${formatBalance(evmBalanceData?.formatted ? parseFloat(evmBalanceData.formatted) : null)} ETH`}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => refetchEvmBalance()}
              className="p-1 text-slate-400 hover:text-slate-600 transition-colors"
              title="Refresh balance"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
            <button
              onClick={() => evmDisconnect()}
              className="p-1 text-slate-400 hover:text-red-500 transition-colors"
              title="Disconnect"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Solana Wallet Status */}
      {solConnected && solPublicKey && (
        <div className="flex items-center gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
          <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5" viewBox="0 0 397 311" fill="none">
              <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" fill="url(#sol-status-a)"/>
              <defs>
                <linearGradient id="sol-status-a" x1="360.9" y1="-37.5" x2="141.5" y2="350.9" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#00FFA3"/><stop offset="1" stopColor="#DC1FFF"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500">Solana</span>
              <span className="px-1.5 py-0.5 text-[10px] bg-purple-100 text-purple-700 rounded">
                Devnet
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-900 font-mono truncate">
                {shortenAddress(solPublicKey.toBase58())}
              </span>
              <span className="text-sm text-slate-600">
                {solBalanceLoading ? '...' : `${formatBalance(solBalance)} SOL`}
              </span>
            </div>
          </div>
          <button
            onClick={() => solDisconnect()}
            className="p-1 text-slate-400 hover:text-red-500 transition-colors flex-shrink-0"
            title="Disconnect"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Connect Another Wallet */}
      {(!evmConnected || !solConnected) && (
        <button
          onClick={() => setShowChainModal(true)}
          className="w-full flex items-center justify-center gap-2 py-2 text-sm text-slate-500 hover:text-slate-700 border border-dashed border-slate-300 hover:border-slate-400 rounded-lg transition-colors"
        >
          <Wallet className="w-3.5 h-3.5" />
          {evmConnected ? 'Connect Solana' : 'Connect Ethereum'}
        </button>
      )}

      {/* Chain Selection Modal (for adding second wallet) - Light Theme */}
      {showChainModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => setShowChainModal(false)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl p-5 w-80 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-slate-900 mb-3 text-center">Connect Another Wallet</h3>

            <div className="space-y-2">
              {!evmConnected && (
                <button
                  onClick={() => handleSelectChain('ethereum')}
                  className="w-full flex items-center gap-3 p-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 hover:border-blue-300 rounded-lg transition-all"
                >
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                    <svg className="w-6 h-6" viewBox="0 0 784 1277" fill="none">
                      <path d="M392.07 0L383.5 29.11v873.93l8.57 8.57 392.06-231.72z" fill="#343434"/>
                      <path d="M392.07 0L0 679.89l392.07 231.72V0z" fill="#8C8C8C"/>
                    </svg>
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-slate-900 font-medium">Ethereum</div>
                    <div className="text-xs text-slate-500">Sepolia Testnet</div>
                  </div>
                </button>
              )}

              {!solConnected && (
                <button
                  onClick={() => handleSelectChain('solana')}
                  className="w-full flex items-center gap-3 p-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 hover:border-purple-300 rounded-lg transition-all"
                >
                  <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                    <svg className="w-6 h-6" viewBox="0 0 397 311" fill="none">
                      <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" fill="url(#sol-modal-a)"/>
                      <defs>
                        <linearGradient id="sol-modal-a" x1="360.9" y1="-37.5" x2="141.5" y2="350.9" gradientUnits="userSpaceOnUse">
                          <stop stopColor="#00FFA3"/><stop offset="1" stopColor="#DC1FFF"/>
                        </linearGradient>
                      </defs>
                    </svg>
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-slate-900 font-medium">Solana</div>
                    <div className="text-xs text-slate-500">Devnet</div>
                  </div>
                </button>
              )}
            </div>

            <button
              onClick={() => setShowChainModal(false)}
              className="w-full mt-3 py-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Export a hook for checking wallet status
export function useWalletStatus() {
  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  const evmChainId = useChainId();
  const { publicKey: solPublicKey, connected: solConnected } = useWallet();

  const isOnSepolia = evmChainId === sepolia.id;

  return {
    // EVM
    evmAddress: evmAddress ?? null,
    evmConnected,
    evmChainId,
    isOnSepolia,
    // Solana
    solAddress: solPublicKey?.toBase58() ?? null,
    solConnected,
    solCluster: 'devnet' as const,
    // Combined
    hasAnyConnection: evmConnected || solConnected,
    hasBothConnections: evmConnected && solConnected,
  };
}
