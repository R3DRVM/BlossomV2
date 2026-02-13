import { useState, useEffect, useRef, useCallback } from 'react';
import { useBlossomContext, getOpenPositionsCount, isOpenPerp, isOpenEvent, isActiveDefi, Strategy, DefiPosition } from '../context/BlossomContext';
import { useActivityFeed } from '../context/ActivityFeedContext';
import PerpPositionEditor from './positions/PerpPositionEditor';
import EventPositionEditor from './positions/EventPositionEditor';
import PositionEditorCard from './PositionEditorCard';
import SectionHeader from './ui/SectionHeader';
import { ChevronDown, Clock, RefreshCw, ChevronUp } from 'lucide-react';
import { executionMode, executionAuthMode, ethTestnetChainId, forceDemoPortfolio } from '../lib/config';
import { getAddress, getAddressIfExplicit, getChainId, connectWallet as legacyConnectWallet, switchToSepolia, getProvider, disconnectWallet as legacyDisconnectWallet, isExplicitlyConnected } from '../lib/walletAdapter';
import { isBackendHealthy, onBackendHealthChange, AGENT_API_BASE_URL } from '../lib/apiClient';
import { DEMO_STABLE_ALT_SYMBOL, DEMO_STABLE_INTERNAL_SYMBOL, formatTokenSymbol } from '../lib/tokenBranding';
import OneClickExecution from './OneClickExecution';
import ConnectWalletButton, { useWalletStatus } from './wallet/ConnectWalletButton';
import { useAccount, useChainId as useWagmiChainId, useSwitchChain } from 'wagmi';
import { useWallet } from '@solana/wallet-adapter-react';
import { baseSepolia, sepolia } from 'wagmi/chains';
import MintBUSDC from './MintBUSDC';

interface RightPanelProps {
  selectedStrategyId?: string | null;
  onQuickAction?: (action: 'perp' | 'defi' | 'event') => void;
  onInsertPrompt?: (text: string) => void;
}

type PositionsTab = 'all' | 'perps' | 'defi' | 'events';
const STABLE_SYMBOLS = new Set([
  DEMO_STABLE_INTERNAL_SYMBOL.toUpperCase(),
  DEMO_STABLE_ALT_SYMBOL.toUpperCase(),
  'REDACTED',
  'USDC',
  'BUSDC',
]);
const DEFAULT_EVM_TESTNET = String(import.meta.env.VITE_DEFAULT_SETTLEMENT_CHAIN || 'base_sepolia')
  .toLowerCase()
  .includes('base')
  ? baseSepolia
  : sepolia;
const SUPPORTED_EVM_CHAIN_IDS = new Set<number>([sepolia.id, baseSepolia.id]);

export default function RightPanel(_props: RightPanelProps) {
  const {
    account,
    strategies,
    defiPositions,
    selectedStrategyId,
    setSelectedStrategyId,
    derivePerpPositionsFromStrategies,
    closeStrategy,
    closeEventStrategy,
    updateEventStakeById,
    updateEventSideById,
    updateDeFiDepositById,
    updatePerpSizeById,
    updatePerpTpSlById,
    updatePerpLeverageById,
    setActiveTab: setGlobalActiveTab,
    refreshLedgerPositions,
  } = useBlossomContext();
  const { events: activityEvents } = useActivityFeed();
  const [isPositionsOpen, setIsPositionsOpen] = useState(false);
  const [isTodayOpen, setIsTodayOpen] = useState(false);
  const [showAllToday, setShowAllToday] = useState(false);
  const [userManuallyExpandedToday, setUserManuallyExpandedToday] = useState(false);
  const [autoExpandTodayTimeout, setAutoExpandTodayTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [previousEventCount, setPreviousEventCount] = useState(activityEvents.length);
  const [activeTab, setActiveTab] = useState<PositionsTab>('all');
  const [expandedPositionId, setExpandedPositionId] = useState<string | null>(null);
  
  // New unified wallet hooks (RainbowKit + Solana)
  const { address: wagmiAddress, isConnected: wagmiConnected } = useAccount();
  const wagmiChainId = useWagmiChainId();
  const { switchChain } = useSwitchChain();
  const { publicKey: solanaPublicKey, connected: solanaConnected } = useWallet();
  const solanaAddress = solanaPublicKey?.toBase58() ?? null;
  const walletStatus = useWalletStatus();

  // Wallet connection state machine (eth_testnet mode only)
  type WalletState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED_LOADING' | 'CONNECTED_READY' | 'WRONG_NETWORK' | 'ERROR' | 'BACKEND_OFFLINE' | 'BACKEND_MISCONFIGURED' | 'RPC_UNREACHABLE';
  const [walletState, setWalletState] = useState<WalletState>('DISCONNECTED');
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<'not_created' | 'active' | 'expired' | 'revoked'>('not_created');
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [balanceErrorCode, setBalanceErrorCode] = useState<string | null>(null);
  const [balanceErrorFix, setBalanceErrorFix] = useState<string | null>(null);
  const [backendOffline, setBackendOffline] = useState(!isBackendHealthy());
  const [showDebugDetails, setShowDebugDetails] = useState(false);
  const [balanceFetchCompleted, setBalanceFetchCompleted] = useState(false);
  const [lastStateTransition, setLastStateTransition] = useState<string>('initial');
  const [backendExecutionMode, setBackendExecutionMode] = useState<string | null>(null);

  // Track last-known balances to display when loading/error (prevents indefinite "Loading...")
  const lastKnownBalancesRef = useRef<{ value: number; balances: any[] } | null>(null);

  // Demo token faucet state
  const [faucetConfigured, setFaucetConfigured] = useState<boolean>(true); // Assume configured until checked
  const [faucetConfigChecked, setFaucetConfigChecked] = useState<boolean>(false);

  // Debug instrumentation: track API call timings
  const [lastHealth, setLastHealth] = useState<{ status: number; duration: number; ok: boolean; timestamp: number } | null>(null);
  const [lastSessionStatus, setLastSessionStatus] = useState<{ status: number; duration: number; ok: boolean; timestamp: number } | null>(null);
  const [lastBalances, setLastBalances] = useState<{ status: number; duration: number; ok: boolean; timestamp: number } | null>(null);

  // Session status check debouncing - prevent rapid-fire API calls
  const lastSessionCheckRef = useRef<number>(0);
  const sessionCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const SESSION_CHECK_DEBOUNCE_MS = 10000; // Minimum 10 seconds between checks

  const isEthTestnetMode = executionMode === 'eth_testnet' && !forceDemoPortfolio;
  const isSessionMode = executionAuthMode === 'session';
  const isOnSepolia = chainId === ethTestnetChainId;

  // Check faucet configuration on mount
  useEffect(() => {
    if (!isEthTestnetMode) return;

    const checkFaucetConfig = async () => {
      try {
        const response = await fetch(`${AGENT_API_BASE_URL}/api/demo/config`);
        const data = await response.json();

        setFaucetConfigured(data.configured);
        setFaucetConfigChecked(true);

        if (!data.configured && import.meta.env.DEV) {
          console.log('[RightPanel] Demo faucet not configured:', data.missing);
        }
      } catch (error) {
        console.error('[RightPanel] Failed to check faucet config:', error);
        setFaucetConfigured(false);
        setFaucetConfigChecked(true);
      }
    };

    checkFaucetConfig();
  }, [isEthTestnetMode]);

  // Sync wagmi state with local wallet state machine
  useEffect(() => {
    if (wagmiConnected && wagmiAddress) {
      setWalletAddress(wagmiAddress);
      setChainId(wagmiChainId);

      if (!SUPPORTED_EVM_CHAIN_IDS.has(wagmiChainId)) {
        setWalletState('WRONG_NETWORK');
        setLastStateTransition('wagmi: Wrong network');
      } else if (!isBackendHealthy()) {
        setWalletState('BACKEND_OFFLINE');
        setLastStateTransition('wagmi: Backend offline');
      } else if (walletState === 'DISCONNECTED' || walletState === 'WRONG_NETWORK') {
        setWalletState('CONNECTED_LOADING');
        setBalanceFetchCompleted(false);
        setLastStateTransition('wagmi: Connected → CONNECTED_LOADING');
        // Trigger balance fetch
        window.dispatchEvent(new CustomEvent('blossom-wallet-connection-change'));
      }
    } else if (!wagmiConnected && walletState !== 'DISCONNECTED') {
      // Handle disconnect from wagmi
      setWalletState('DISCONNECTED');
      setWalletAddress(null);
      setChainId(null);
      setSessionId(null);
      setSessionStatus('not_created');
      setBalanceError(null);
      setLastStateTransition('wagmi: Disconnected');
    }
  }, [wagmiConnected, wagmiAddress, wagmiChainId]);

  // Fetch backend execution mode on mount (with instrumentation)
  useEffect(() => {
    const fetchExecutionMode = async () => {
      const startTime = performance.now();
      try {
        const { callAgent } = await import('../lib/apiClient');
        const response = await callAgent('/health', { method: 'GET' });
        const duration = Math.round(performance.now() - startTime);
        const data = response.ok ? await response.json() : null;
        
        setLastHealth({
          status: response.status,
          duration,
          ok: data?.ok === true,
          timestamp: Date.now(),
        });
        
        if (response.ok && data) {
          setBackendExecutionMode(data.executionMode || null);
          if (import.meta.env.DEV) {
            console.log(`[RightPanel] Health check: ${response.status} in ${duration}ms, ok=${data.ok}, mode=${data.executionMode}`);
          }
        }
      } catch (error: any) {
        const duration = Math.round(performance.now() - startTime);
        setLastHealth({
          status: 0,
          duration,
          ok: false,
          timestamp: Date.now(),
        });
        if (import.meta.env.DEV) {
          console.warn(`[RightPanel] Health check failed after ${duration}ms:`, error.message);
        }
      }
    };
    fetchExecutionMode();
  }, []);
  
  // Subscribe to centralized backend health changes (eth_testnet mode only)
  useEffect(() => {
    if (!isEthTestnetMode) return;
    
    const unsubscribe = onBackendHealthChange((healthy) => {
      setBackendOffline(!healthy);
      
      // If backend came online and wallet is connected, transition to loading
      if (healthy && walletState === 'BACKEND_OFFLINE' && walletAddress) {
        setWalletState('CONNECTED_LOADING');
        window.dispatchEvent(new CustomEvent('blossom-wallet-connection-change'));
      } else if (!healthy && walletAddress) {
        setWalletState('BACKEND_OFFLINE');
      }
    });
    
    // Initial state
    setBackendOffline(!isBackendHealthy());
    
    return unsubscribe;
  }, [isEthTestnetMode, walletState, walletAddress]);

  // Listen for resetSim events to clear session state
  useEffect(() => {
    const handleResetSim = () => {
      setSessionStatus('not_created');
      setSessionId(null);

      if (import.meta.env.DEV) {
        console.log('[RightPanel] Reset SIM detected, clearing session state');
      }
    };

    window.addEventListener('resetSim', handleResetSim);
    return () => window.removeEventListener('resetSim', handleResetSim);
  }, []);

  // Wallet state machine: manage connection state deterministically
  useEffect(() => {
    if (!isEthTestnetMode) {
      setWalletState('DISCONNECTED');
      return;
    }
    
    // If backend is offline, don't update wallet state (keep BACKEND_OFFLINE)
    if (backendOffline && walletAddress) {
      return;
    }
    
    const updateWalletState = async () => {
      try {
        const address = await getAddressIfExplicit();
        
        if (!address) {
          setWalletState('DISCONNECTED');
          setWalletAddress(null);
          setChainId(null);
          return;
        }
        
        const currentChainId = await getChainId();
        setWalletAddress(address);
        setChainId(currentChainId);
        
        // Check network
        if (currentChainId !== ethTestnetChainId) {
          setWalletState('WRONG_NETWORK');
          return;
        }
        
        // Address exists and network is correct - check if balances are loading
        if (walletState === 'CONNECTING' || walletState === 'DISCONNECTED') {
          setWalletState('CONNECTED_LOADING');
          setBalanceFetchCompleted(false);
          setLastStateTransition(`CONNECTING/DISCONNECTED → CONNECTED_LOADING`);
        } else if (balanceFetchCompleted) {
          // Balance fetch completed successfully (even if balance is 0)
          setWalletState('CONNECTED_READY');
          setBalanceError(null);
          setLastStateTransition(`Balance fetch completed → CONNECTED_READY`);
        } else if (balanceError) {
          setWalletState('ERROR');
          setLastStateTransition(`Error: ${balanceError} → ERROR`);
        }
        
        // Check for existing session (only in session mode, non-blocking with debouncing)
        if (isSessionMode) {
          const oneClickSessionKey = `blossom_oneclick_sessionid_${address.toLowerCase()}`;
          const legacySessionKey = `blossom_session_${address.toLowerCase()}`;
          const storedSessionId = localStorage.getItem(oneClickSessionKey) || localStorage.getItem(legacySessionKey);
          if (storedSessionId && !localStorage.getItem(oneClickSessionKey)) {
            localStorage.setItem(oneClickSessionKey, storedSessionId);
          }
          if (storedSessionId) {
            setSessionId(storedSessionId);

            // DEBOUNCE: Only check if enough time has passed since last check
            const now = Date.now();
            const timeSinceLastCheck = now - lastSessionCheckRef.current;

            if (timeSinceLastCheck < SESSION_CHECK_DEBOUNCE_MS) {
              // Skip check - too soon since last one
              if (import.meta.env.DEV) {
                console.log(`[RightPanel] Session status check skipped (debounced, ${Math.round(timeSinceLastCheck / 1000)}s since last)`);
              }
            } else {
              // Perform the check
              lastSessionCheckRef.current = now;

              // Use AbortController for 3s timeout
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 3000);
              const startTime = performance.now();

              try {
                const { callAgent } = await import('../lib/apiClient');
                const response = await callAgent('/api/session/status', {
                  method: 'POST',
                  body: JSON.stringify({ userAddress: address, sessionId: storedSessionId }),
                  signal: controller.signal,
                });
                const duration = Math.round(performance.now() - startTime);
                const data = response.ok ? await response.json() : null;

                setLastSessionStatus({
                  status: response.status,
                  duration,
                  ok: data?.ok === true,
                  timestamp: Date.now(),
                });

                if (response.ok && data) {
                  setSessionStatus(data.status || 'not_created');
                  if (import.meta.env.DEV) {
                    console.log(`[RightPanel] Session status: ${response.status} in ${duration}ms, status=${data.status}`);
                  }
                }
              } catch (error: any) {
                const duration = Math.round(performance.now() - startTime);
                setLastSessionStatus({
                  status: error.name === 'AbortError' ? 408 : 0,
                  duration,
                  ok: false,
                  timestamp: Date.now(),
                });
                // Ignore errors - non-fatal, don't block wallet readiness
                if (import.meta.env.DEV && error.name !== 'AbortError') {
                  console.warn(`[RightPanel] Session status check failed after ${duration}ms (non-blocking):`, error.message);
                }
              } finally {
                clearTimeout(timeoutId);
              }
            }
          }
        }
      } catch (error: any) {
        setWalletState('ERROR');
        setBalanceError(error.message || 'Wallet check failed');
      }
    };
    
    updateWalletState();
    
    // Listen for chain/account changes
    try {
      const provider = getProvider();
      if (provider && typeof provider.on === 'function') {
        const handleChainChanged = (chainIdHex: string) => {
          const newChainId = parseInt(chainIdHex, 16);
          setChainId(newChainId);
          if (newChainId !== ethTestnetChainId) {
            setWalletState('WRONG_NETWORK');
          } else if (walletAddress) {
            setWalletState('CONNECTED_LOADING');
            // Trigger balance refresh
            window.dispatchEvent(new CustomEvent('blossom-wallet-connection-change'));
          }
        };
        
        const handleAccountsChanged = () => {
          updateWalletState();
        };
        
        provider.on('chainChanged', handleChainChanged);
        provider.on('accountsChanged', handleAccountsChanged);
        
        return () => {
          if (typeof provider.removeListener === 'function') {
            provider.removeListener('chainChanged', handleChainChanged);
            provider.removeListener('accountsChanged', handleAccountsChanged);
          }
        };
      }
    } catch (error) {
      // Provider not available - ignore
    }
  }, [isEthTestnetMode, walletState, walletAddress, ethTestnetChainId]); // Removed account.balances and account.accountValue to prevent re-fetch loops
  
  // Trigger balance sync when connection state changes
  useEffect(() => {
    if (walletState === 'CONNECTED_LOADING' && walletAddress) {
      // Trigger immediate balance fetch
      window.dispatchEvent(new CustomEvent('blossom-wallet-connection-change'));
    }
  }, [walletState, walletAddress]);

  // Listen for balance fetch completion events (with instrumentation)
  useEffect(() => {
    if (!isEthTestnetMode) return;

    const handleBalanceSuccess = (event: Event) => {
      const customEvent = event as CustomEvent<{ duration?: number; status?: number } | undefined>;
      const detail = customEvent.detail;
      const duration = detail?.duration || 0;
      const status = detail?.status || 200;

      if (import.meta.env.DEV) {
        console.log(`[RightPanel] Balance fetch success in ${duration}ms`);
      }

      setLastBalances({
        status,
        duration,
        ok: true,
        timestamp: Date.now(),
      });

      setBalanceFetchCompleted(true);
      setBalanceError(null); // Clear any previous error
      setWalletState('CONNECTED_READY'); // Explicitly transition to READY
      setLastStateTransition(`Balance success (${duration}ms) → CONNECTED_READY`);
    };

    const handleBalanceError = (event: Event) => {
      const customEvent = event as CustomEvent<{ code: string; message: string; fix: string; duration?: number; status?: number }>;
      const detail = customEvent.detail;
      const duration = detail.duration || 0;
      const status = detail.status || 503;

      if (import.meta.env.DEV) {
        console.warn(`[RightPanel] Balance fetch error after ${duration}ms:`, detail);
      }

      setLastBalances({
        status,
        duration,
        ok: false,
        timestamp: Date.now(),
      });

      // Store error but still transition to READY (show last-known with note)
      setBalanceError(detail.message || 'Balance fetch failed');
      setBalanceErrorCode(detail.code || null);
      setBalanceErrorFix(detail.fix || null);
      setBalanceFetchCompleted(true);
      setWalletState('CONNECTED_READY'); // Show last-known balances with error note
      setLastStateTransition(`Balance error (${duration}ms) → CONNECTED_READY with error`);
    };

    window.addEventListener('blossom-wallet-balance-success', handleBalanceSuccess);
    window.addEventListener('blossom-wallet-balance-error', handleBalanceError);

    return () => {
      window.removeEventListener('blossom-wallet-balance-success', handleBalanceSuccess);
      window.removeEventListener('blossom-wallet-balance-error', handleBalanceError);
    };
  }, [isEthTestnetMode]);

  // Store last-known balances when we have valid data
  useEffect(() => {
    if (account.accountValue > 0 || account.balances.length > 0) {
      lastKnownBalancesRef.current = { value: account.accountValue, balances: account.balances };
    }
  }, [account.accountValue, account.balances]);

  // Timeout fallback: if stuck in CONNECTED_LOADING for > 5s, transition to READY with last-known or fallback
  useEffect(() => {
    if (!isEthTestnetMode || walletState !== 'CONNECTED_LOADING') return;

    const timeout = setTimeout(() => {
      if (!balanceFetchCompleted) {
        if (import.meta.env.DEV) {
          console.warn('[RightPanel] Balance fetch timeout after 5s → transitioning to CONNECTED_READY with last-known');
        }
        // Instead of showing error, transition to READY so UI isn't stuck
        // If we have last-known balances, those will be shown
        setBalanceFetchCompleted(true);
        setWalletState('CONNECTED_READY');
        setLastStateTransition('Timeout 5s → CONNECTED_READY (using last-known or zero)');
      }
    }, 5000);

    return () => clearTimeout(timeout);
  }, [walletState, balanceFetchCompleted, isEthTestnetMode]);
  
  const handleConnectWallet = async () => {
    setWalletState('CONNECTING');
    setBalanceError(null);
    setBalanceFetchCompleted(false);
    setLastStateTransition('User clicked Connect → CONNECTING');
    try {
      const address = await legacyConnectWallet();
      setWalletAddress(address);
      const currentChainId = await getChainId();
      setChainId(currentChainId);
      
      if (currentChainId !== ethTestnetChainId) {
        setWalletState('WRONG_NETWORK');
        setLastStateTransition('Wrong network → WRONG_NETWORK');
      } else if (!isBackendHealthy()) {
        setWalletState('BACKEND_OFFLINE');
        setLastStateTransition('Backend offline → BACKEND_OFFLINE');
      } else {
        setWalletState('CONNECTED_LOADING');
        setBalanceFetchCompleted(false);
        setLastStateTransition('Connected → CONNECTED_LOADING');
        // Trigger immediate balance fetch
        window.dispatchEvent(new CustomEvent('blossom-wallet-connection-change'));
      }
    } catch (error: any) {
      console.error('Failed to connect wallet:', error);
      setWalletState('ERROR');
      setBalanceError(error.message || 'Connection failed');
      setLastStateTransition(`Error: ${error.message} → ERROR`);
    }
  };
  
  const handleDisconnect = () => {
    legacyDisconnectWallet();
    setWalletState('DISCONNECTED');
    setWalletAddress(null);
    setChainId(null);
    setSessionId(null);
    setSessionStatus('not_created');
    setBalanceError(null);
    // Clear account state in context
    window.dispatchEvent(new CustomEvent('blossom-wallet-disconnect'));
  };
  
  const handleRefreshBalances = () => {
    if (walletAddress && isOnSepolia && isBackendHealthy()) {
      setWalletState('CONNECTED_LOADING');
      setBalanceError(null);
      setBalanceFetchCompleted(false);
      setLastStateTransition('User clicked Refresh → CONNECTED_LOADING');
      window.dispatchEvent(new CustomEvent('blossom-wallet-connection-change'));

      // Also refresh positions from ledger
      refreshLedgerPositions().catch(err => {
        console.warn('[RightPanel] Failed to refresh positions:', err);
      });
    } else if (!isBackendHealthy()) {
      setWalletState('BACKEND_OFFLINE');
      setLastStateTransition('Backend offline → BACKEND_OFFLINE');
    }
  };
  
  const handleSwitchNetwork = async () => {
    setIsSwitching(true);
    try {
      await switchToSepolia();
      const currentChainId = await getChainId();
      setChainId(currentChainId);
      if (currentChainId === ethTestnetChainId && walletAddress) {
        setWalletState('CONNECTED_LOADING');
        // Trigger balance refresh
        window.dispatchEvent(new CustomEvent('blossom-wallet-connection-change'));
      }
    } catch (error: any) {
      console.error('Failed to switch network:', error);
      setBalanceError(error.message || 'Failed to switch network');
      setWalletState('ERROR');
    } finally {
      setIsSwitching(false);
    }
  };
  
  const handleOneClickEnabled = () => {
    // Refresh session status
    const storedSessionId =
      localStorage.getItem(`blossom_oneclick_sessionid_${walletAddress?.toLowerCase()}`) ||
      localStorage.getItem(`blossom_session_${walletAddress?.toLowerCase()}`);
    if (storedSessionId) {
      setSessionId(storedSessionId);
      setSessionStatus('active');
    }
  };

  const handleOneClickDisabled = () => {
    setSessionId(null);
    setSessionStatus('not_created');
  };
  
  // Auto-expand positions section if there are open positions
  const openPositionsCount = getOpenPositionsCount(strategies, defiPositions);

  // DEBUG: Track position filtering (wrapped in try-catch to prevent crashes)
  useEffect(() => {
    if (import.meta.env.DEV && strategies.length > 0) {
      try {
        const openPerps = strategies.filter(isOpenPerp);
        const openEvents = strategies.filter(isOpenEvent);
        console.log('[RightPanel] Position filtering:', {
          totalStrategies: strategies.length,
          openPerps: openPerps.map(s => ({ id: s.id, market: s.market, status: s.status, isClosed: s.isClosed })),
          openEvents: openEvents.map(s => ({ id: s.id, market: s.eventLabel || s.market, status: s.status, isClosed: s.isClosed })),
          openDefi: defiPositions.filter(isActiveDefi).map(p => ({ id: p.id, protocol: p.protocol, status: p.status })),
          openPositionsCount
        });
      } catch (err) {
        console.error('[RightPanel] Debug logging error:', err);
      }
    }
  }, [strategies, defiPositions, openPositionsCount]);

  useEffect(() => {
    // Positions: expanded if there are open positions, otherwise collapsed
    setIsPositionsOpen(openPositionsCount > 0);
  }, [openPositionsCount]);
  
  // Today: auto-expand for 2 seconds when new activity event is added
  useEffect(() => {
    if (activityEvents.length > previousEventCount && !userManuallyExpandedToday) {
      // New event added - auto-expand
      setIsTodayOpen(true);
      
      // Clear any existing timeout
      if (autoExpandTodayTimeout) {
        clearTimeout(autoExpandTodayTimeout);
      }
      
      // Auto-collapse after 2 seconds
      const timeout = setTimeout(() => {
        setIsTodayOpen(false);
      }, 2000);
      
      setAutoExpandTodayTimeout(timeout);
      setPreviousEventCount(activityEvents.length);
      
      return () => {
        clearTimeout(timeout);
      };
    } else if (activityEvents.length !== previousEventCount) {
      setPreviousEventCount(activityEvents.length);
    }
  }, [activityEvents.length, previousEventCount, userManuallyExpandedToday, autoExpandTodayTimeout]);
  
  // Handle manual Today toggle
  const handleTodayToggle = () => {
    const newState = !isTodayOpen;
    setIsTodayOpen(newState);
    setUserManuallyExpandedToday(newState);
    // Clear auto-expand timeout if user manually expands
    if (newState && autoExpandTodayTimeout) {
      clearTimeout(autoExpandTodayTimeout);
      setAutoExpandTodayTimeout(null);
    }
  };

  // Listen for focusRightPanelPosition events (from CommandBar)
  useEffect(() => {
    const handleFocusPosition = (e: Event) => {
      const customEvent = e as CustomEvent<{ positionId: string; positionType: 'perp' | 'event' | 'defi' }>;
      const { positionId, positionType } = customEvent.detail || {};
      
      if (!positionId || !positionType) return;

      // Open positions section
      setIsPositionsOpen(true);

      // Set correct tab based on position type
      if (positionType === 'perp') {
        setActiveTab('perps');
      } else if (positionType === 'event') {
        setActiveTab('events');
      } else if (positionType === 'defi') {
        setActiveTab('defi');
      }

      // Expand the position accordion and scroll to it
      setTimeout(() => {
        setExpandedPositionId(positionId);
        
        // Scroll to the expanded position
        setTimeout(() => {
          const positionElement = document.getElementById(`position-${positionId}`);
          if (positionElement) {
            positionElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            
            // Add highlight ring
            positionElement.classList.add('ring-2', 'ring-pink-400');
            setTimeout(() => {
              positionElement.classList.remove('ring-2', 'ring-pink-400');
            }, 800);
          }
        }, 150);
      }, 100);
    };

    window.addEventListener('focusRightPanelPosition', handleFocusPosition);
    return () => window.removeEventListener('focusRightPanelPosition', handleFocusPosition);
  }, []);

  // Part 3: Use derived positions as single source of truth for perps
  // Defensive guard: ensure function exists before calling
  let derivedPerpPositions: Array<{ strategyId: string; market: string; side: 'Long' | 'Short'; notionalUsd: number; marginUsd?: number; leverage?: number }> = [];
  if (typeof derivePerpPositionsFromStrategies === 'function') {
    derivedPerpPositions = derivePerpPositionsFromStrategies(strategies);
  } else {
    if (import.meta.env.DEV) {
      console.error('[RightPanel] derivePerpPositionsFromStrategies is not a function', { 
        type: typeof derivePerpPositionsFromStrategies,
        value: derivePerpPositionsFromStrategies 
      });
    }
    // Fallback to empty array - panel will show "No open positions"
  }
  
  // Map derived positions back to strategies for editor (carry strategyId)
  // Part B1: RightPanel renders from derived positions, not raw strategies
  const activePerps = derivedPerpPositions.map(pos => {
    const strategy = strategies.find(s => s.id === pos.strategyId);
    if (!strategy) {
      if (import.meta.env.DEV) {
        console.warn('[RightPanel] Derived position has no matching strategy:', pos);
      }
      return null;
    }
    return strategy;
  }).filter((s): s is Strategy => s !== null);
  
  const activeEvents = strategies.filter(isOpenEvent);
  const activeDefi = defiPositions.filter(isActiveDefi);
  
  // Filter positions based on active tab
  const getDisplayedPositions = (): (Strategy | DefiPosition)[] => {
    switch (activeTab) {
      case 'perps':
        return activePerps;
      case 'defi':
        return activeDefi;
      case 'events':
        return activeEvents;
      default:
        return [...activePerps, ...activeEvents, ...activeDefi];
    }
  };
  
  const displayedPositions = getDisplayedPositions();

  const handleClosePosition = (position: Strategy | DefiPosition) => {
    if ('instrumentType' in position) {
      const strategy = position as Strategy;
      if (strategy.instrumentType === 'event') {
        closeEventStrategy(strategy.id);
      } else {
        closeStrategy(strategy.id);
      }
    } else {
      // DeFi - closing means withdrawing all
      updateDeFiDepositById(position.id, 0);
    }
  };

  const handleFund = () => {
    // In eth_testnet mode, open faucet for the default settlement chain
    if (isEthTestnetMode) {
      window.open(
        DEFAULT_EVM_TESTNET.id === baseSepolia.id
          ? 'https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet'
          : 'https://sepoliafaucet.com/',
        '_blank'
      );
      return;
    }
    console.log('Fund clicked');
  };

  const handleSend = () => {
    // Not implemented yet
    console.log('Send not implemented');
  };

  const handleSwap = () => {
    // Not implemented yet - use chat for swaps
    console.log('Swap via button not implemented - use chat');
  };

  // Poll for balance updates after mint
  const pollForBalanceUpdate = useCallback(async (maxAttempts = 10, delayMs = 2000) => {
    let attempt = 0;
    const poll = async () => {
      attempt++;
      console.log(`[RightPanel] Polling for balance update (attempt ${attempt}/${maxAttempts})`);

      // Trigger balance refresh
      window.dispatchEvent(new CustomEvent('blossom-wallet-connection-change'));

      if (attempt < maxAttempts) {
        // Exponential backoff: 2s, 3s, 4.5s, 6.75s, etc.
        const nextDelay = Math.min(delayMs * Math.pow(1.5, attempt - 1), 10000);
        setTimeout(poll, nextDelay);
      } else {
        console.log('[RightPanel] Balance polling complete');
      }
    };

    // Start polling after initial delay
    setTimeout(poll, delayMs);
  }, []);


  // Calculate perp PnL (simplified - using totalPnlPct for now)
  const perpPnlUsd = account.accountValue * (account.totalPnlPct / 100);
  const perpPnlSign = account.totalPnlPct >= 0 ? '+' : '';

  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden bg-slate-50">
      {/* Wallet Snapshot - Compact sticky header */}
      <div className="flex-shrink-0 sticky top-0 z-10 bg-slate-50/95 backdrop-blur pt-2 pb-2">
        {/* Wallet Card - Compact */}
        <div className="rounded-xl border border-slate-100 bg-white shadow-sm px-3 py-2.5 space-y-2 w-full">
          {/* Title - Compact */}
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-semibold tracking-[0.1em] text-slate-500 uppercase">WALLET</div>
            {(backendExecutionMode || executionMode) && (
              <div
                className="text-[8px] font-medium px-1 py-0.5 rounded bg-slate-100 text-slate-500"
                title={(backendExecutionMode || executionMode) === 'sim' ? 'SIM mode' : 'ETH_TESTNET mode'}
              >
                {(backendExecutionMode || executionMode) === 'eth_testnet' ? 'TESTNET' : 'SIM'}
              </div>
            )}
          </div>
          
          {/* Wallet State Machine UI */}
          {isEthTestnetMode && (
            <>
              {/* DISCONNECTED or CONNECTING - Compact */}
              {(walletState === 'DISCONNECTED' || walletState === 'CONNECTING') && (
                <div className="text-center py-2">
                  <div className="text-xs text-slate-500 mb-2">Connect wallet to start</div>
                  <ConnectWalletButton />
                </div>
              )}

              {/* WRONG_NETWORK - Compact */}
              {walletState === 'WRONG_NETWORK' && walletAddress && (
                <div className="flex items-center justify-between px-2 py-1.5 rounded bg-amber-50 border border-amber-200">
                  <span className="text-[10px] text-amber-800">Wrong network</span>
                  <button
                    onClick={() => switchChain?.({ chainId: DEFAULT_EVM_TESTNET.id })}
                    disabled={isSwitching}
                    className="px-2 py-0.5 bg-amber-500 text-white rounded text-[10px] font-medium hover:bg-amber-600 disabled:opacity-50"
                  >
                    {isSwitching ? '...' : `Switch to ${DEFAULT_EVM_TESTNET.id === baseSepolia.id ? 'Base Sepolia' : 'Sepolia'}`}
                  </button>
                </div>
              )}
              
              {/* ERROR - Compact */}
              {walletState === 'ERROR' && (
                <div className="flex items-center justify-between px-2 py-1.5 rounded bg-rose-50 border border-rose-200">
                  <span className="text-[10px] text-rose-700 truncate mr-2">{balanceError || 'Connection error'}</span>
                  <button onClick={handleConnectWallet} className="px-2 py-0.5 bg-rose-500 text-white rounded text-[10px] font-medium hover:bg-rose-600">
                    Retry
                  </button>
                </div>
              )}

              {/* BACKEND_OFFLINE - Compact */}
              {walletState === 'BACKEND_OFFLINE' && (
                <div className="px-2 py-1.5 rounded bg-slate-100 border border-slate-200">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-700">Backend offline</span>
                    <button onClick={handleRefreshBalances} className="px-2 py-0.5 bg-slate-500 text-white rounded text-[10px] font-medium hover:bg-slate-600">
                      Retry
                    </button>
                  </div>
                  <div className="text-[9px] text-slate-500 mt-1 font-mono">npm run dev:demo</div>
                </div>
              )}

              {/* BACKEND_MISCONFIGURED - Compact */}
              {walletState === 'BACKEND_MISCONFIGURED' && (
                <div className="px-2 py-1.5 rounded bg-amber-50 border border-amber-200">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-amber-700 truncate mr-2">{balanceError || 'Misconfigured'}</span>
                    <button
                      onClick={() => balanceErrorFix && navigator.clipboard.writeText(balanceErrorFix)}
                      className="px-2 py-0.5 bg-amber-500 text-white rounded text-[10px] font-medium hover:bg-amber-600"
                    >
                      Copy fix
                    </button>
                  </div>
                </div>
              )}

              {/* RPC_UNREACHABLE - Compact */}
              {walletState === 'RPC_UNREACHABLE' && (
                <div className="flex items-center justify-between px-2 py-1.5 rounded bg-orange-50 border border-orange-200">
                  <span className="text-[10px] text-orange-700 truncate mr-2">{balanceError || 'RPC unreachable'}</span>
                  <button onClick={handleRefreshBalances} className="px-2 py-0.5 bg-orange-500 text-white rounded text-[10px] font-medium hover:bg-orange-600">
                    Retry
                  </button>
                </div>
              )}
              
              {/* CONNECTED_LOADING or CONNECTED_READY */}
              {(walletState === 'CONNECTED_LOADING' || walletState === 'CONNECTED_READY') && walletAddress && isOnSepolia && (
                <>
                  {/* Wallet Connection Status - Shows both EVM and Solana */}
                  <ConnectWalletButton />

                  {/* Only show OneClickExecution in session mode */}
                  {isSessionMode && (
                    <OneClickExecution
                      userAddress={walletAddress}
                      onEnabled={handleOneClickEnabled}
                      onDisabled={handleOneClickDisabled}
                    />
                  )}

                  {/* Total Balance */}
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="text-lg font-semibold text-slate-900">
                        {walletState === 'CONNECTED_LOADING' ? (
                          // Show last-known or spinner (never stuck indefinitely due to timeout)
                          lastKnownBalancesRef.current ? (
                            <span className="text-slate-600">
                              ${lastKnownBalancesRef.current.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              <span className="ml-1.5 text-[10px] text-slate-400 font-normal">updating...</span>
                            </span>
                          ) : (
                            <span className="text-slate-400 text-sm">Loading...</span>
                          )
                        ) : (
                          `$${account.accountValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        )}
                      </div>
                      <button
                        onClick={handleRefreshBalances}
                        className="p-1 text-slate-400 hover:text-slate-600 transition-colors"
                        title="Refresh balances"
                        disabled={walletState === 'CONNECTED_LOADING'}
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${walletState === 'CONNECTED_LOADING' ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] text-slate-500">Sepolia</span>
                      {balanceError && (
                        <span className="text-[9px] text-amber-600" title={balanceErrorFix || balanceError}>
                          (sync issue)
                        </span>
                      )}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
          
          {/* SIM Mode Balance Display */}
          {!isEthTestnetMode && (
            <div>
              <div className="text-xl font-semibold text-slate-900">
                ${account.accountValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="mt-1.5">
                <div 
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-50 border border-slate-100"
                  title="Prices are live. Order execution and venue/chain routing are simulated in this demo."
                >
                  <span className="text-[10px] font-medium text-slate-600">Demo: execution simulated</span>
                  <span className="text-[9px] text-slate-400">•</span>
                  <span className="text-[9px] text-slate-400">Prices live • Routing simulated</span>
                </div>
              </div>
            </div>
          )}

          {/* Dev-only Debug Panel */}
          {import.meta.env.DEV && isEthTestnetMode && (
            <div className="mt-3 pt-3 border-t border-slate-200">
              <button
                onClick={() => setShowDebugDetails(!showDebugDetails)}
                className="w-full flex items-center justify-between text-xs text-slate-500 hover:text-slate-700"
              >
                <span className="font-medium">Debug Details</span>
                {showDebugDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
              {showDebugDetails && (
                <div className="mt-2 p-2 bg-slate-50 rounded text-[10px] font-mono space-y-1 text-slate-600">
                  <div><strong>State:</strong> {walletState}</div>
                  <div><strong>Last Transition:</strong> {lastStateTransition}</div>
                  <div><strong>Balance Fetch:</strong> {balanceFetchCompleted ? '✅' : '⏳'}</div>
                  <div><strong>Chain ID:</strong> {chainId || 'null'} {chainId === 11155111 ? '✅' : chainId ? '❌' : ''}</div>
                  <div><strong>Backend Mode:</strong> {backendExecutionMode || 'unknown'}</div>
                  <div><strong>Frontend Auth:</strong> {executionAuthMode}</div>
                  <div><strong>Backend Healthy:</strong> {isBackendHealthy() ? '✅' : '❌'}</div>
                  <div><strong>API Base URL:</strong> {AGENT_API_BASE_URL}</div>
                  
                  {/* API Call Timings */}
                  <div className="mt-2 pt-2 border-t border-slate-200">
                    <div className="font-semibold mb-1">API Call Timings:</div>
                    {lastHealth && (
                      <div>
                        <strong>Health:</strong> {lastHealth.status} in {lastHealth.duration}ms {lastHealth.ok ? '✅' : '❌'} 
                        ({new Date(lastHealth.timestamp).toLocaleTimeString()})
                      </div>
                    )}
                    {lastSessionStatus && (
                      <div>
                        <strong>Session:</strong> {lastSessionStatus.status} in {lastSessionStatus.duration}ms {lastSessionStatus.ok ? '✅' : '❌'}
                        ({new Date(lastSessionStatus.timestamp).toLocaleTimeString()})
                      </div>
                    )}
                    {lastBalances && (
                      <div>
                        <strong>Balances:</strong> {lastBalances.status} in {lastBalances.duration}ms {lastBalances.ok ? '✅' : '❌'}
                        ({new Date(lastBalances.timestamp).toLocaleTimeString()})
                      </div>
                    )}
                    {!lastHealth && !lastSessionStatus && !lastBalances && (
                      <div className="text-slate-400">No API calls yet</div>
                    )}
                  </div>
                  
                  {balanceError && (
                    <>
                      <div className="mt-2 pt-2 border-t border-slate-200">
                        <div><strong>Error:</strong> {balanceError}</div>
                        {balanceErrorCode && <div><strong>Error Code:</strong> {balanceErrorCode}</div>}
                        {balanceErrorFix && <div><strong>Fix:</strong> {balanceErrorFix}</div>}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Summary Row - Compact inline */}
          <div className="flex items-center gap-3 text-[10px] text-slate-500">
            <span>Exposure: <span className="font-medium text-slate-700">${account.openPerpExposure.toLocaleString()}</span></span>
            <span className="text-slate-300">|</span>
            <span>PnL: <span className={`font-medium ${account.totalPnlPct >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{perpPnlSign}{account.totalPnlPct.toFixed(1)}%</span></span>
          </div>

          {/* Token Holdings - Compact */}
          <div>
            <div className="text-[11px] font-semibold tracking-[0.12em] text-slate-500 uppercase mb-1.5">Holdings</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {account.balances.map((balance) => {
                const isStable = STABLE_SYMBOLS.has(String(balance.symbol || '').toUpperCase());
                const displayValue = isStable
                  ? balance.balanceUsd.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
                  : balance.balanceUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

                return (
                  <div key={balance.symbol} className="flex items-center gap-1">
                    <span className="text-[11px] font-medium text-slate-600">{formatTokenSymbol(balance.symbol)}</span>
                    <span className="text-[11px] text-slate-500">${displayValue}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Action Buttons + Demo Token Helper - Compact inline */}
          <div className="flex items-center gap-2 pt-1 flex-wrap">
            <button
              onClick={handleFund}
              title={isEthTestnetMode ? "Get testnet ETH from faucet" : "Fund account"}
              className="px-2.5 py-0.5 rounded-full border border-slate-200 bg-slate-50 text-[10px] font-medium text-slate-600 hover:bg-pink-50 hover:border-pink-200 transition"
            >
              {isEthTestnetMode ? 'ETH Faucet' : 'Fund'}
            </button>
            {/* Demo bUSDC helper - inline next to ETH Faucet */}
            {isEthTestnetMode && walletState === 'CONNECTED_READY' && (() => {
              const usdcBalance = account.balances.find(b => STABLE_SYMBOLS.has(String(b.symbol || '').toUpperCase()))?.balanceUsd || 0;
              const hasLowUsdc = usdcBalance < 50;
              const faucetClaimedKey = walletAddress ? `blossom_faucet_claimed_${walletAddress.toLowerCase()}` : null;
              const wasClaimed = faucetClaimedKey && localStorage.getItem(faucetClaimedKey) === 'true';
              if (!hasLowUsdc || wasClaimed) return null;

              return (
                <MintBUSDC
                  walletAddress={walletAddress}
                  solanaAddress={solanaAddress}
                  disabled={!faucetConfigured}
                  onMinted={() => {
                    if (walletAddress) {
                      localStorage.setItem(`blossom_faucet_claimed_${walletAddress.toLowerCase()}`, 'true');
                    }
                    pollForBalanceUpdate(8, 2000);
                  }}
                />
              );
            })()}
            {!isEthTestnetMode && (
              <>
                <button
                  onClick={handleSend}
                  className="px-2.5 py-0.5 rounded-full border border-slate-200 bg-slate-50 text-[10px] font-medium text-slate-600 hover:bg-pink-50 hover:border-pink-200 transition"
                >
                  Send
                </button>
                <button
                  onClick={handleSwap}
                  className="px-2.5 py-0.5 rounded-full border border-slate-200 bg-slate-50 text-[10px] font-medium text-slate-600 hover:bg-pink-50 hover:border-pink-200 transition"
                >
                  Swap
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable Body - Positions + Today */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 pb-4">
        <div className="px-2 space-y-4 pt-2">
          {/* Positions Section - Inline Collapsible */}
          <div>
            <button
              onClick={() => setIsPositionsOpen(!isPositionsOpen)}
              className="w-full rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-pink-50 hover:border-pink-200 transition py-2.5 flex items-center justify-between px-3"
              data-coachmark="positions-editor"
            >
              <div className="flex items-center gap-2">
                <span>Positions</span>
                {openPositionsCount > 0 && (
                  <span className="px-1.5 py-0.5 bg-pink-100 text-pink-700 rounded text-[10px] font-semibold">
                    {openPositionsCount}
                  </span>
                )}
              </div>
              <ChevronDown 
                className={`w-4 h-4 text-slate-400 transition-transform ${isPositionsOpen ? 'rotate-180' : ''}`}
              />
            </button>
            
            {/* Inline Positions List with Tabs */}
            {isPositionsOpen && (
              <div className="mt-2">
                {/* Tabs */}
                <div className="flex items-center gap-1 mb-2 border-b border-slate-100">
                  {(['all', 'perps', 'defi', 'events'] as PositionsTab[]).map(tab => {
                    const count =
                      tab === 'all'
                        ? activePerps.length + activeEvents.length + activeDefi.length
                        : tab === 'perps'
                        ? activePerps.length
                        : tab === 'defi'
                        ? activeDefi.length
                        : activeEvents.length;

                    return (
                      <button
                        key={tab}
                        onClick={() => {
                          setActiveTab(tab);
                          setExpandedPositionId(null); // Close any expanded position when switching tabs
                        }}
                        className={`px-2 py-1 text-[10px] font-medium transition-colors border-b-2 ${
                          activeTab === tab
                            ? 'border-pink-500 text-slate-900'
                            : 'border-transparent text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                        {count > 0 && (
                          <span className="ml-1 text-[9px] text-slate-400">({count})</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                
                {/* Positions List - Accordion Style - No nested scroll */}
                <div className="space-y-2">
                  {displayedPositions.length === 0 ? (
                    <div className="px-3 py-4 text-center rounded-lg border border-slate-100 bg-slate-50">
                      <div className="text-xs font-medium text-slate-700 mb-3">No open positions yet</div>
                      <div className="flex flex-col gap-2">
                        <button
                          onClick={() => {
                            window.dispatchEvent(
                              new CustomEvent('insertChatPrompt', {
                                detail: { prompt: 'Long ETH with 2% risk' },
                              })
                            );
                            setGlobalActiveTab('copilot');
                          }}
                          className="px-3 py-1.5 text-[10px] font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-pink-50 hover:border-pink-200 transition-colors"
                        >
                          Long ETH 2% risk
                        </button>
                        <button
                          onClick={() => {
                            window.dispatchEvent(
                              new CustomEvent('insertChatPrompt', {
                                detail: { prompt: 'Show my exposure' },
                              })
                            );
                            setGlobalActiveTab('copilot');
                          }}
                          className="px-3 py-1.5 text-[10px] font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-pink-50 hover:border-pink-200 transition-colors"
                        >
                          Show my exposure
                        </button>
                      </div>
                    </div>
                  ) : (
                    displayedPositions.map((position) => {
                      const isPerp = 'instrumentType' in position && position.instrumentType === 'perp';
                      const isEvent = 'instrumentType' in position && position.instrumentType === 'event';
                      const isDefi = 'protocol' in position;
                      const isExpanded = expandedPositionId === position.id;
                      
                      // Compact summary row (always visible)
                      const formatPositionLabel = (): string => {
                        if (isPerp) {
                          const strategy = position as Strategy;
                          return `${strategy.market} ${strategy.side}`;
                        } else if (isEvent) {
                          const strategy = position as Strategy;
                          return `${strategy.eventLabel || 'Event'} ${strategy.eventSide || ''}`;
                        } else {
                          const defi = position as DefiPosition;
                          return `${defi.protocol} ${defi.asset}`;
                        }
                      };
                      
                      const formatPositionDetails = (): string => {
                        if (isPerp) {
                          const strategy = position as Strategy;
                          // Task 3: Show Notional (Exposure) in summary
                          const notionalValue = strategy.notionalUsd || 0;
                          return `Notional: $${notionalValue.toLocaleString()}`;
                        } else if (isEvent) {
                          const strategy = position as Strategy;
                          return `$${(strategy.stakeUsd || 0).toLocaleString()}`;
                        } else {
                          const defi = position as DefiPosition;
                          return `$${defi.depositUsd.toLocaleString()}`;
                        }
                      };
                      
                      return (
                        <div
                          key={position.id}
                          id={`position-${position.id}`}
                          className="border border-slate-200 rounded-lg bg-white overflow-hidden transition-all"
                        >
                          {/* Summary Row - Clickable */}
                          <button
                            onClick={() => {
                              // Part 2a: Set selected strategy when user clicks position
                              if (!isExpanded) {
                                setSelectedStrategyId(position.id);
                              }
                              setExpandedPositionId(isExpanded ? null : position.id);
                            }}
                            className="w-full px-2 py-2 text-left hover:bg-slate-50 transition-colors flex items-center justify-between"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-medium text-slate-900 truncate">
                                {formatPositionLabel()}
                              </div>
                              <div className="text-[10px] text-slate-500 mt-0.5">
                                {formatPositionDetails()}
                              </div>
                            </div>
                            <ChevronDown 
                              className={`w-3 h-3 text-slate-400 transition-transform flex-shrink-0 ml-2 ${isExpanded ? 'rotate-180' : ''}`}
                            />
                          </button>
                          
                          {/* Expanded Editor */}
                          {isExpanded && (
                            <div className="px-2 pb-2 border-t border-slate-100" onClick={(e) => e.stopPropagation()}>
                              {isPerp && (
                                <PerpPositionEditor
                                  strategy={position as Strategy}
                                  compact={true}
                                  onUpdateSize={(newSize) => {
                                    // Part C: Only update if this is the selected strategy
                                    if (selectedStrategyId === position.id) {
                                      updatePerpSizeById(position.id, newSize);
                                    } else if (import.meta.env.DEV) {
                                      console.warn('[RightPanel] Update blocked: position not selected', { positionId: position.id, selectedStrategyId });
                                    }
                                  }}
                                  onUpdateTpSl={(newTp, newSl) => {
                                    if (selectedStrategyId === position.id) {
                                      updatePerpTpSlById(position.id, newTp, newSl);
                                    } else if (import.meta.env.DEV) {
                                      console.warn('[RightPanel] Update blocked: position not selected', { positionId: position.id, selectedStrategyId });
                                    }
                                  }}
                                  onUpdateLeverage={(newLeverage) => {
                                    if (selectedStrategyId === position.id) {
                                      updatePerpLeverageById(position.id, newLeverage);
                                    } else if (import.meta.env.DEV) {
                                      console.warn('[RightPanel] Update blocked: position not selected', { positionId: position.id, selectedStrategyId });
                                    }
                                  }}
                                  onClose={() => {
                                    handleClosePosition(position);
                                    setExpandedPositionId(null);
                                  }}
                                />
                              )}
                              {isEvent && (
                                <EventPositionEditor
                                  strategy={position as Strategy}
                                  compact={true}
                                  onUpdateStake={(stake) => updateEventStakeById(position.id, stake)}
                                  onUpdateSide={(side) => updateEventSideById(position.id, side)}
                                  onClose={() => {
                                    handleClosePosition(position);
                                    setExpandedPositionId(null);
                                  }}
                                />
                              )}
                              {isDefi && (
                                <PositionEditorCard
                                  position={position}
                                  account={account}
                                  onUpdateDeposit={(deposit) => updateDeFiDepositById(position.id, deposit)}
                                  onClose={() => {
                                    handleClosePosition(position);
                                    setExpandedPositionId(null);
                                  }}
                                  compact={true}
                                  showDetailsLink={false}
                                />
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Today Activity Feed - Collapsible */}
          <div className="pt-2 border-t border-slate-200">
            <button
              onClick={handleTodayToggle}
              className="w-full flex items-center justify-between mb-2"
            >
              <SectionHeader
                title="Today"
                subtitle={activityEvents.length > 0 ? `${activityEvents.length} event${activityEvents.length !== 1 ? 's' : ''}` : undefined}
              />
              <ChevronDown 
                className={`w-4 h-4 text-slate-400 transition-transform ${isTodayOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {isTodayOpen && activityEvents.length > 0 && (
              <div className="space-y-1.5">
                {(showAllToday ? activityEvents : activityEvents.slice(0, 3)).map((event: any) => {
                  const timeStr = new Date(event.timestamp).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                  });
                  
                  return (
                    <div
                      key={event.id}
                      className="flex items-start gap-2 p-2 rounded-lg hover:bg-slate-50 transition-colors group"
                    >
                      <Clock className="w-3 h-3 text-slate-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-medium text-slate-900">{event.message}</div>
                        <div className="text-[9px] text-slate-500 mt-0.5">{timeStr}</div>
                      </div>
                      {event.positionId && (
                        <button
                          onClick={() => {
                            // Focus the position
                            window.dispatchEvent(
                              new CustomEvent('focusRightPanelPosition', {
                                detail: {
                                  positionId: event.positionId,
                                  positionType: event.positionType,
                                },
                              })
                            );
                            // Ensure we're on Copilot tab
                            setGlobalActiveTab('copilot');
                            setIsPositionsOpen(true);
                          }}
                          className="opacity-0 group-hover:opacity-100 text-[9px] text-pink-600 hover:text-pink-700 hover:underline transition-opacity"
                        >
                          View
                        </button>
                      )}
                    </div>
                  );
                })}
                {activityEvents.length > 3 && !showAllToday && (
                  <button
                    onClick={() => setShowAllToday(true)}
                    className="w-full px-2 py-1.5 text-[10px] font-medium text-pink-600 hover:text-pink-700 hover:underline transition-colors"
                  >
                    Show more ({activityEvents.length - 3} more)
                  </button>
                )}
              </div>
            )}
            {isTodayOpen && activityEvents.length === 0 && (
              <div className="px-3 py-3 text-center text-[10px] text-slate-500 rounded-lg border border-slate-100 bg-slate-50">
                No activity yet — updates will appear here as you confirm/execute plans.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
