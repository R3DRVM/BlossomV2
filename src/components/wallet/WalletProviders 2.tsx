/**
 * Unified Wallet Providers
 *
 * Wraps app with both EVM (RainbowKit + wagmi) and Solana wallet providers.
 * Configured for:
 * - EVM: Sepolia testnet only
 * - Solana: Devnet only
 *
 * Light theme to match Blossom UI.
 *
 * IMPORTANT: Wallet Standard auto-detection is DISABLED to prevent duplicate key errors.
 * We explicitly list only Phantom and Solflare for Solana.
 */

import { ReactNode, useMemo } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import {
  RainbowKitProvider,
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

// Solana imports - use explicit adapters only (no Wallet Standard auto-detection)
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import type { Adapter } from '@solana/wallet-adapter-base';
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

// Blocklist: wallet names we do NOT want in the Solana modal
// MetaMask appears via Wallet Standard auto-detection but we only want native Solana wallets
const SOLANA_WALLET_BLOCKLIST = ['MetaMask', 'Coinbase Wallet', 'Rainbow'];

export default function WalletProviders({ children }: WalletProvidersProps) {
  // Build Solana wallets as a SINGLE source of truth
  // - Only Phantom and Solflare (native Solana wallets)
  // - No Wallet Standard auto-detection (would pull in MetaMask etc.)
  // - Robust dedupe by adapter.name
  const solanaWallets = useMemo(() => {
    // Create ONLY explicit Solana-native adapters
    const explicitAdapters: Adapter[] = [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ];

    // Dedupe by adapter.name AND remove blocklisted wallets (MetaMask etc.)
    const seen = new Set<string>();
    const finalList = explicitAdapters.filter((adapter) => {
      const name = adapter.name;

      // Remove blocklisted wallets (EVM wallets that appear via Wallet Standard)
      if (SOLANA_WALLET_BLOCKLIST.includes(name)) {
        if (import.meta.env.DEV) {
          console.log(`[solana-wallets] Removed blocklisted wallet: ${name}`);
        }
        return false;
      }

      // Dedupe by name (keep first occurrence)
      if (seen.has(name)) {
        if (import.meta.env.DEV) {
          console.log(`[solana-wallets] Removed duplicate: ${name}`);
        }
        return false;
      }

      seen.add(name);
      return true;
    });

    // DEV: Log final list ONCE on mount
    if (import.meta.env.DEV) {
      console.log(`[solana-wallets] final list: ${finalList.map((a) => a.name).join(', ')}`);
    }

    return finalList;
  }, []);

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
