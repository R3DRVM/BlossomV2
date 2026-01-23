import { useState, useEffect, useRef } from 'react';
import { useBlossomContext, getOpenPositionsCount, isOpenPerp, isOpenEvent, isActiveDefi, Strategy, DefiPosition } from '../context/BlossomContext';
import { useActivityFeed } from '../context/ActivityFeedContext';
import PerpPositionEditor from './positions/PerpPositionEditor';
import EventPositionEditor from './positions/EventPositionEditor';
import PositionEditorCard from './PositionEditorCard';
import SectionHeader from './ui/SectionHeader';
import { ChevronDown, Clock, LogOut, RefreshCw, ChevronUp } from 'lucide-react';
import { executionMode, executionAuthMode, ethTestnetChainId, forceDemoPortfolio } from '../lib/config';
import { getAddress, getAddressIfExplicit, getChainId, connectWallet, switchToSepolia, getProvider, disconnectWallet, isExplicitlyConnected } from '../lib/walletAdapter';
import { isBackendHealthy, onBackendHealthChange, AGENT_API_BASE_URL } from '../lib/apiClient';
import OneClickExecution from './OneClickExecution';

interface RightPanelProps {
  selectedStrategyId?: string | null;
  onQuickAction?: (action: 'perp' | 'defi' | 'event') => void;
  onInsertPrompt?: (text: string) => void;
}

type PositionsTab = 'all' | 'perps' | 'defi' | 'events';

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

  // Demo token faucet state
  const [faucetStatus, setFaucetStatus] = useState<'idle' | 'minting' | 'success' | 'error'>('idle');
  const [faucetError, setFaucetError] = useState<string>('');

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
          const storedSessionId = localStorage.getItem(`blossom_session_${address.toLowerCase()}`);
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
  }, [isEthTestnetMode, walletState, account.balances, account.accountValue, walletAddress, ethTestnetChainId]);
  
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
        console.log(`[RightPanel] Balance fetch completed in ${duration}ms → setting balanceFetchCompleted=true`);
      }
      
      setLastBalances({
        status,
        duration,
        ok: true,
        timestamp: Date.now(),
      });
      
      setBalanceFetchCompleted(true);
      setLastStateTransition(`Balance fetch success (${duration}ms) → balanceFetchCompleted=true`);
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
      
      setBalanceError(detail.message || 'Balance fetch failed');
      setBalanceErrorCode(detail.code || null);
      setBalanceErrorFix(detail.fix || null);
      setBalanceFetchCompleted(true); // Mark as completed even on error (so we can show error state)
      setLastStateTransition(`Balance fetch error (${duration}ms): ${detail.code} → ERROR`);
    };

    window.addEventListener('blossom-wallet-balance-success', handleBalanceSuccess);
    window.addEventListener('blossom-wallet-balance-error', handleBalanceError);

    return () => {
      window.removeEventListener('blossom-wallet-balance-success', handleBalanceSuccess);
      window.removeEventListener('blossom-wallet-balance-error', handleBalanceError);
    };
  }, [isEthTestnetMode]);

  // Timeout fallback: if stuck in CONNECTED_LOADING for > 3s, show error
  useEffect(() => {
    if (!isEthTestnetMode || walletState !== 'CONNECTED_LOADING') return;

    const timeout = setTimeout(() => {
      if (!balanceFetchCompleted && !balanceError) {
        if (import.meta.env.DEV) {
          console.warn('[RightPanel] Balance fetch timeout after 3s → showing error');
        }
        setBalanceError('Balance fetch timed out after 3 seconds');
        setBalanceErrorCode('TIMEOUT');
        setBalanceErrorFix('Check backend is running and reachable at http://127.0.0.1:3001');
        setBalanceFetchCompleted(true); // Mark as completed so we can show error state
        setLastStateTransition('Timeout after 3s → ERROR');
      }
    }, 3000);

    return () => clearTimeout(timeout);
  }, [walletState, balanceFetchCompleted, balanceError, isEthTestnetMode]);
  
  const handleConnectWallet = async () => {
    setWalletState('CONNECTING');
    setBalanceError(null);
    setBalanceFetchCompleted(false);
    setLastStateTransition('User clicked Connect → CONNECTING');
    try {
      const address = await connectWallet();
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
    disconnectWallet();
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
    const storedSessionId = localStorage.getItem(`blossom_session_${walletAddress?.toLowerCase()}`);
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
    // In eth_testnet mode, open Sepolia faucet
    if (isEthTestnetMode) {
      window.open('https://sepoliafaucet.com/', '_blank');
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

  const handleGetDemoTokens = async () => {
    if (!walletAddress) return;

    setFaucetStatus('minting');
    setFaucetError('');

    try {
      const response = await fetch(`${AGENT_API_BASE_URL}/api/demo/faucet`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userAddress: walletAddress
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Faucet request failed');
      }

      const result = await response.json();
      console.log('[RightPanel] Demo tokens minted successfully:', result);

      setFaucetStatus('success');

      // Refresh balances after 5 seconds
      setTimeout(() => {
        // Trigger balance refresh
        window.dispatchEvent(new CustomEvent('blossom-wallet-balance-trigger'));
        setFaucetStatus('idle');
      }, 5000);
    } catch (error: any) {
      console.error('[RightPanel] Faucet error:', error);
      setFaucetStatus('error');
      setFaucetError(error.message || 'Failed to mint tokens');
    }
  };

  // Calculate perp PnL (simplified - using totalPnlPct for now)
  const perpPnlUsd = account.accountValue * (account.totalPnlPct / 100);
  const perpPnlSign = account.totalPnlPct >= 0 ? '+' : '';

  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden bg-slate-50">
      {/* Wallet Snapshot - Sticky at top */}
      <div className="flex-shrink-0 sticky top-0 z-10 bg-slate-50/90 backdrop-blur pt-4 pb-3">
        {/* Wallet Card */}
        <div className="rounded-2xl border border-slate-100 bg-white shadow-sm px-4 py-4 space-y-3 w-full">
          {/* Title */}
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-semibold tracking-[0.12em] text-slate-500 uppercase">WALLET</div>
            {(backendExecutionMode || executionMode) && (
              <div 
                className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600"
                title={(backendExecutionMode || executionMode) === 'sim' ? 'SIM mode returns deterministic balances. Switch to eth_testnet to read real wallet balances.' : 'ETH_TESTNET mode reads real wallet balances from Sepolia.'}
              >
                {(backendExecutionMode || executionMode) === 'eth_testnet' ? 'ETH_TESTNET' : 'SIM'}
              </div>
            )}
          </div>
          
          {/* Wallet State Machine UI */}
          {isEthTestnetMode && (
            <>
              {/* DISCONNECTED or CONNECTING */}
              {(walletState === 'DISCONNECTED' || walletState === 'CONNECTING') && (
                <div className="space-y-3">
                  <div className="text-center py-6">
                    <div className="text-sm text-slate-600 mb-2">Connect your wallet to view balances</div>
                    <button
                      onClick={handleConnectWallet}
                      disabled={walletState === 'CONNECTING'}
                      className="px-4 py-2 bg-blossom-pink text-white rounded-xl font-medium hover:bg-blossom-pink/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {walletState === 'CONNECTING' ? 'Connecting...' : 'Connect Wallet (Sepolia)'}
                    </button>
                  </div>
                </div>
              )}
              
              {/* WRONG_NETWORK */}
              {walletState === 'WRONG_NETWORK' && walletAddress && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-2">
                  <div className="text-xs font-medium text-amber-800">Wrong Network</div>
                  <div className="text-xs text-amber-700">Please switch to Sepolia testnet to continue.</div>
                  <button
                    onClick={handleSwitchNetwork}
                    disabled={isSwitching}
                    className="w-full px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-medium hover:bg-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSwitching ? 'Switching...' : 'Switch to Sepolia'}
                  </button>
                </div>
              )}
              
              {/* ERROR */}
              {walletState === 'ERROR' && (
                <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 space-y-2">
                  <div className="text-xs font-medium text-rose-800">Connection Error</div>
                  <div className="text-xs text-rose-700">{balanceError || 'Failed to connect wallet'}</div>
                  <button
                    onClick={handleConnectWallet}
                    className="w-full px-3 py-1.5 bg-rose-500 text-white rounded-lg text-xs font-medium hover:bg-rose-600 transition-colors"
                  >
                    Retry
                  </button>
                </div>
              )}
              
              {/* BACKEND_OFFLINE */}
              {walletState === 'BACKEND_OFFLINE' && (
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-2">
                  <div className="text-xs font-medium text-slate-800">Backend Offline</div>
                  <div className="text-xs text-slate-700">
                    Cannot reach backend server. Please ensure the backend is running.
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1 font-mono bg-slate-100 px-2 py-1 rounded">
                    npm run dev:demo
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Or: <code className="bg-slate-100 px-1 rounded">cd agent && npm run dev</code>
                  </div>
                  <button
                    onClick={handleRefreshBalances}
                    className="w-full px-3 py-1.5 bg-slate-500 text-white rounded-lg text-xs font-medium hover:bg-slate-600 transition-colors"
                  >
                    Retry Connection
                  </button>
                </div>
              )}
              
              {/* BACKEND_MISCONFIGURED */}
              {walletState === 'BACKEND_MISCONFIGURED' && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-2">
                  <div className="text-xs font-medium text-amber-800">Backend Misconfigured</div>
                  <div className="text-xs text-amber-700">
                    {balanceError || 'RPC endpoint not configured'}
                  </div>
                  {balanceErrorFix && (
                    <div className="text-[10px] text-amber-600 mt-1 font-mono bg-amber-100 px-2 py-1 rounded">
                      {balanceErrorFix}
                    </div>
                  )}
                  <button
                    onClick={() => {
                      if (balanceErrorFix) {
                        navigator.clipboard.writeText(balanceErrorFix);
                      }
                    }}
                    className="w-full px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-medium hover:bg-amber-600 transition-colors"
                  >
                    {balanceErrorFix ? 'Copy Fix Command' : 'Retry'}
                  </button>
                </div>
              )}
              
              {/* RPC_UNREACHABLE */}
              {walletState === 'RPC_UNREACHABLE' && (
                <div className="rounded-lg bg-orange-50 border border-orange-200 p-3 space-y-2">
                  <div className="text-xs font-medium text-orange-800">RPC Unreachable</div>
                  <div className="text-xs text-orange-700">
                    {balanceError || 'Cannot connect to RPC endpoint'}
                  </div>
                  {balanceErrorFix && (
                    <div className="text-[10px] text-orange-600 mt-1">
                      {balanceErrorFix}
                    </div>
                  )}
                  <button
                    onClick={handleRefreshBalances}
                    className="w-full px-3 py-1.5 bg-orange-500 text-white rounded-lg text-xs font-medium hover:bg-orange-600 transition-colors"
                  >
                    Retry
                  </button>
                </div>
              )}
              
              {/* CONNECTED_LOADING or CONNECTED_READY */}
              {(walletState === 'CONNECTED_LOADING' || walletState === 'CONNECTED_READY') && walletAddress && isOnSepolia && (
                <>
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
                      <div className="text-xl font-semibold text-slate-900">
                        {walletState === 'CONNECTED_LOADING' ? (
                          <span className="text-slate-400">Loading...</span>
                        ) : (
                          `$${account.accountValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {walletState === 'CONNECTED_READY' && (
                          <button
                            onClick={handleRefreshBalances}
                            className="p-1 text-slate-400 hover:text-slate-600 transition-colors"
                            title="Refresh balances"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={handleDisconnect}
                          className="p-1 text-slate-400 hover:text-slate-600 transition-colors"
                          title="Disconnect wallet"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-50 border border-slate-100"
                        title="Real balances from Sepolia testnet"
                      >
                        <span className="text-[10px] font-medium text-slate-600">Sepolia Testnet</span>
                      </div>

                      {/* Session Status Indicator */}
                      {isSessionMode && (
                        <div
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${
                            sessionStatus === 'active'
                              ? 'bg-emerald-50 border-emerald-200'
                              : 'bg-gray-50 border-gray-200'
                          }`}
                          title={sessionStatus === 'active' ? 'One-click execution enabled' : 'One-click execution not enabled'}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              sessionStatus === 'active' ? 'bg-emerald-500' : 'bg-gray-400'
                            }`}
                          ></span>
                          <span
                            className={`text-[10px] font-medium ${
                              sessionStatus === 'active' ? 'text-emerald-700' : 'text-gray-600'
                            }`}
                          >
                            Session: {sessionStatus === 'active' ? 'On' : 'Off'}
                          </span>
                        </div>
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

          {/* Summary Row */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <span className="text-[11px] text-slate-500">Perp exposure:</span>
              <span className="text-xs font-medium text-slate-900">${account.openPerpExposure.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[11px] text-slate-500">Total PnL:</span>
              <span className={`text-xs font-medium ${account.totalPnlPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                {perpPnlSign}{account.totalPnlPct.toFixed(1)}%
              </span>
            </div>
          </div>

          {/* Token Holdings */}
          <div>
            <div className="text-[11px] font-semibold tracking-[0.12em] text-slate-500 uppercase mb-2">Holdings</div>
            <div className="space-y-1.5">
              {account.balances.map((balance) => {
                // For USDC, quantity equals USD value (1:1), so show as quantity
                // For other tokens, show USD value (quantity would require current price data)
                const displayValue = balance.symbol === 'USDC'
                  ? balance.balanceUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  : `$${balance.balanceUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                
                return (
                  <div key={balance.symbol} className="flex justify-between items-center">
                    <span className="text-xs font-medium text-slate-700">{balance.symbol}</span>
                    <div className="text-right">
                      <div className="text-xs text-slate-500">{displayValue}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Demo Token Faucet - Only show in eth_testnet when balances are low/zero */}
          {isEthTestnetMode && walletState === 'CONNECTED_READY' && (() => {
            const usdcBalance = account.balances.find(b => b.symbol === 'USDC')?.balanceUsd || 0;
            const wethBalance = account.balances.find(b => b.symbol === 'WETH')?.balanceUsd || 0;
            const hasLowBalances = usdcBalance < 100 || wethBalance < 0.1;

            if (!hasLowBalances) return null;

            return (
              <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-xs text-amber-900 mb-2 font-medium">
                  Need demo tokens to test trades?
                </p>
                <button
                  onClick={handleGetDemoTokens}
                  disabled={faucetStatus === 'minting'}
                  className="w-full px-3 py-2 bg-amber-600 text-white text-xs font-medium rounded hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {faucetStatus === 'minting' ? 'Minting tokens...' : 'Get Demo Tokens (10k USDC + 5 WETH)'}
                </button>
                {faucetStatus === 'success' && (
                  <p className="text-xs text-green-700 mt-2 font-medium">✅ Tokens minted! Refreshing balances...</p>
                )}
                {faucetStatus === 'error' && (
                  <p className="text-xs text-red-700 mt-2">❌ {faucetError}</p>
                )}
              </div>
            );
          })()}

          {/* Mini PnL / Exposure Preview */}
          <div className="pt-3 border-t border-slate-100 space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-[11px] text-slate-500">Perps PnL (sim):</span>
              <span className={`text-xs font-medium ${perpPnlUsd >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                {perpPnlSign}${Math.abs(perpPnlUsd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / {perpPnlSign}{account.totalPnlPct.toFixed(1)}%
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[11px] text-slate-500">Open Perp Exposure:</span>
              <span className="text-xs font-medium text-slate-900">${account.openPerpExposure.toLocaleString()}</span>
            </div>
          </div>
          
          {/* Action Buttons */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            <button
              onClick={handleFund}
              title={isEthTestnetMode ? "Get testnet ETH from faucet" : "Fund account"}
              className="flex-1 rounded-full border border-slate-200 bg-slate-50 text-xs font-medium text-slate-700 hover:bg-pink-50 hover:border-pink-200 transition py-2"
            >
              {isEthTestnetMode ? 'Faucet' : 'Fund'}
            </button>
            <button
              onClick={handleSend}
              disabled={isEthTestnetMode}
              title={isEthTestnetMode ? "Coming soon" : "Send tokens"}
              className={`flex-1 rounded-full border text-xs font-medium transition py-2 ${
                isEthTestnetMode 
                  ? 'border-slate-100 bg-slate-50/50 text-slate-400 cursor-not-allowed' 
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-pink-50 hover:border-pink-200'
              }`}
            >
              Send
            </button>
            <button
              onClick={handleSwap}
              disabled={isEthTestnetMode}
              title={isEthTestnetMode ? "Use chat to swap" : "Swap tokens"}
              className={`flex-1 rounded-full border text-xs font-medium transition py-2 ${
                isEthTestnetMode 
                  ? 'border-slate-100 bg-slate-50/50 text-slate-400 cursor-not-allowed' 
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-pink-50 hover:border-pink-200'
              }`}
            >
              Swap
            </button>
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

