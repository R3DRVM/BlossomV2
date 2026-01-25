/**
 * Unified Wallet Providers
 *
 * Wraps app with both EVM (RainbowKit + wagmi) and Solana wallet providers.
 * Configured for:
 * - EVM: Sepolia testnet only
 * - Solana: Devnet only
 *
 * Light theme to match Blossom UI.
 */

import { ReactNode, useMemo } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import {
  RainbowKitProvider,
  getDefaultConfig,
  lightTheme,
  connectorsForWallets,
} from '@rainbow-me/rainbowkit';
import {
  injectedWallet,
  metaMaskWallet,
  coinbaseWallet,
  rainbowWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import '@rainbow-me/rainbowkit/styles.css';

// Solana imports
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import '@solana/wallet-adapter-react-ui/styles.css';

// Check if WalletConnect project ID is configured
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '';
const hasWalletConnectId = Boolean(projectId && projectId.length > 10);

// Log in dev mode
if (import.meta.env.DEV) {
  if (!hasWalletConnectId) {
    console.info(
      '[WalletProviders] No VITE_WALLETCONNECT_PROJECT_ID set. ' +
      'Using injected wallets only (MetaMask, Coinbase). ' +
      'Get a free project ID at https://cloud.walletconnect.com for WalletConnect support.'
    );
  }
}

// Build connectors based on whether WalletConnect is available
const connectors = connectorsForWallets(
  [
    {
      groupName: 'Popular',
      wallets: hasWalletConnectId
        ? [
            metaMaskWallet,
            coinbaseWallet,
            rainbowWallet,
            walletConnectWallet,
            injectedWallet,
          ]
        : [
            // No WalletConnect - only injected wallets
            metaMaskWallet,
            coinbaseWallet,
            injectedWallet,
          ],
    },
  ],
  {
    appName: 'Blossom',
    projectId: hasWalletConnectId ? projectId : 'unused', // Only used if WC wallets are included
  }
);

// Configure wagmi with Sepolia only - no WC calls if no project ID
const wagmiConfig = createConfig({
  connectors,
  chains: [sepolia],
  transports: {
    [sepolia.id]: http(),
  },
  ssr: false,
});

// Create query client for react-query
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      refetchOnWindowFocus: false,
    },
  },
});

// Solana connection endpoint (devnet only)
const SOLANA_RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.devnet.solana.com';

interface WalletProvidersProps {
  children: ReactNode;
}

export default function WalletProviders({ children }: WalletProvidersProps) {
  // Use explicit wallet adapters for reliable detection (Phantom, Solflare)
  // This is more reliable than relying on Wallet Standard auto-detection
  const solanaWallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiConfig}>
        <RainbowKitProvider
          theme={lightTheme({
            accentColor: '#ec4899', // Blossom pink
            accentColorForeground: 'white',
            borderRadius: 'medium',
            fontStack: 'system',
          })}
          modalSize="compact"
        >
          <ConnectionProvider endpoint={SOLANA_RPC_URL}>
            <WalletProvider wallets={solanaWallets} autoConnect={false}>
              <WalletModalProvider>
                {children}
              </WalletModalProvider>
            </WalletProvider>
          </ConnectionProvider>
        </RainbowKitProvider>
      </WagmiProvider>
    </QueryClientProvider>
  );
}

// Export config for use in other components
export { wagmiConfig };
