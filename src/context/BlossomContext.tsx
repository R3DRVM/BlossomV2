import { createContext, useContext, useState, useCallback, ReactNode, useEffect, useRef } from 'react';
import { mapBackendPortfolioToFrontendState } from '../lib/portfolioMapping';
import { USE_AGENT_BACKEND, executionMode, executionAuthMode, forceDemoPortfolio } from '../lib/config';
import { derivePerpPositionsFromStrategies } from '../lib/derivePerpPositions';
import { callAgent } from '../lib/apiClient';
import { getAddress, getAddressIfExplicit } from '../lib/walletAdapter';
import { startBackendHealthCheckLoop, isBackendHealthy, onBackendHealthChange } from '../lib/apiClient';

export type StrategyStatus = 'draft' | 'queued' | 'executing' | 'executed' | 'closed';

export interface Strategy {
  id: string;
  createdAt: string;
  side: 'Long' | 'Short';
  market: string;
  riskPercent: number;
  entry: number;
  takeProfit: number;
  stopLoss: number;
  status: StrategyStatus;
  sourceText: string;
  notionalUsd?: number;
  marginUsd?: number; // Explicit margin amount (for margin-anchored sizing)
  isClosed: boolean;
  closedAt?: string;
  realizedPnlUsd?: number;
  realizedPnlPct?: number;
  instrumentType?: 'perp' | 'event' | 'defi';
  leverage?: number; // Perp leverage (1-100x, typically 1-20x in UI)
  eventKey?: string;
  eventLabel?: string;
  stakeUsd?: number;
  maxPayoutUsd?: number;
  maxLossUsd?: number;
  eventSide?: 'YES' | 'NO';
  eventOutcome?: 'won' | 'lost' | 'pending';
  liveMarkToMarketUsd?: number; // Optional: live mark-to-market value for event positions
  overrideRiskCap?: boolean; // default false - allows stake above 3% cap
  requestedStakeUsd?: number; // original user request before capping
  eventMarketSource?: 'polymarket' | 'kalshi' | 'static'; // Source of event market data (for venue/chain display)
  originMessageKey?: string; // Message key that originated this strategy (for idempotency/debugging)
  // V1: Execution tracking
  txHash?: string; // Transaction hash (on-chain execution)
  blockNumber?: number; // Block number where transaction was mined
  explorerUrl?: string; // Explorer link (e.g., https://sepolia.etherscan.io/tx/0x...)
  strategyExecutionNonce?: number; // Nonce for idempotency (increments per execution)
}

export interface AssetBalance {
  symbol: string;
  balanceUsd: number;
}

export interface AccountState {
  accountValue: number;
  openPerpExposure: number;
  eventExposureUsd: number;
  totalPnlPct: number;
  simulatedPnlPct30d: number;
  balances: AssetBalance[];
}

export type ActiveTab = 'copilot' | 'risk' | 'portfolio';

export type Venue = 'hyperliquid' | 'event_demo';

export type DefiStatus = 'proposed' | 'active';

export interface DefiPosition {
  id: string;
  command: string;
  protocol: string;
  asset: string;
  depositUsd: number;
  apyPct: number;
  status: DefiStatus;
  createdAt: string;
  // Blocker #3: TX metadata for on-chain execution tracking
  txHash?: string;
  blockNumber?: number;
  explorerUrl?: string;
}

export interface OnboardingState {
  openedTrade: boolean;
  queuedStrategy: boolean;
  openedRiskCenter: boolean;
  dismissed: boolean;
}

export interface RiskSnapshot {
  accountValue: number;
  openPerpExposure: number;
  totalPnlPct: number;
}

export interface RiskProfile {
  maxPerTradeRiskPct: number;          // e.g. 3
  minLiqBufferPct: number;             // e.g. 15
  fundingAlertThresholdPctPer8h: number; // e.g. 0.15
  correlationHedgeThreshold: number;   // e.g. 0.75
}

export interface ManualWatchAsset {
  id: string;
  symbol: string;      // e.g. "ETH-PERP"
  side: 'Long' | 'Short';
  liqBufferPct?: number; // optional, user estimate
  note?: string;
}

// Chat message type (reused from Chat.tsx)
export interface ChatMessage {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: string;
  strategy?: any | null; // ParsedStrategy from mockParser
  strategyId?: string | null;
  defiProposalId?: string | null;
  executionRequest?: {
    kind: string;
    chain: string;
    tokenIn: string;
    tokenOut: string;
    amountIn?: string;
    amountOut?: string;
    slippageBps: number;
    fundingPolicy: string;
  } | null;
  marketsList?: Array<{
    id: string;
    title: string;
    yesPrice: number;
    noPrice: number;
    volume24hUsd?: number;
    source: 'polymarket' | 'kalshi' | 'static';
    isLive: boolean;
  }> | null;
  defiProtocolsList?: Array<{
    id: string;
    name: string;
    tvlUsd: number;
    chains: string[];
    category?: string;
    source: 'defillama' | 'static';
    isLive: boolean;
  }> | null;
}

// Chat session type
export interface ChatSession {
  id: string;
  title: string;
  createdAt: number; // timestamp
  messages: ChatMessage[];
}

interface BlossomContextType {
  strategies: Strategy[];
  addDraftStrategy: (strategyInput: Partial<Strategy> & { sourceText: string }) => Strategy;
  updateStrategyStatus: (id: string, status: StrategyStatus) => void;
  selectedStrategyId: string | null;
  setSelectedStrategyId: (id: string | null) => void;
  account: AccountState;
  recomputeAccountFromStrategies: () => void;
  resetSim: () => Promise<void>;
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  onboarding: OnboardingState;
  setOnboarding: React.Dispatch<React.SetStateAction<OnboardingState>>;
  lastRiskSnapshot: RiskSnapshot | null;
  setLastRiskSnapshot: (snapshot: RiskSnapshot | null) => void;
  closeStrategy: (id: string) => void;
  autoCloseProfitableStrategies: () => number;
  closeEventStrategy: (id: string) => void;
  updateEventStake: (id: string, updates: Partial<Strategy>) => void;
  updateStrategy: (id: string, updates: Partial<Strategy>) => void;
  // Quick update helpers for drawer inline controls
  updatePerpSizeById: (id: string, newSizeUsd: number) => void;
  updatePerpTpSlById: (id: string, newTakeProfit: number, newStopLoss: number) => void;
  updatePerpLeverageById: (id: string, newLeverage: number) => void;
  updateEventStakeById: (id: string, newStakeUsd: number) => void;
  updateEventSideById: (id: string, newSide: 'YES' | 'NO') => void;
  updateDeFiDepositById: (id: string, newDepositUsd: number) => void;
  venue: Venue;
  setVenue: (v: Venue) => void;
  defiPositions: DefiPosition[];
  latestDefiProposal: DefiPosition | null;
  createDefiPlanFromCommand: (command: string, protocolOverride?: string) => DefiPosition;
  confirmDefiPlan: (id: string) => void;
  updateDeFiPlanDeposit: (id: string, newDepositUsd: number) => void;
  updateFromBackendPortfolio: (portfolio: any) => void; // For agent mode
  getBaseAsset: (market: string) => string;
  // Chat sessions
  chatSessions: ChatSession[];
  activeChatId: string | null;
  createNewChatSession: () => string;
  setActiveChat: (id: string) => void;
  appendMessageToActiveChat: (message: ChatMessage) => void;
  appendMessageToChat: (chatId: string, message: ChatMessage) => void;
  updateMessageInChat: (chatId: string, messageId: string, updates: Partial<ChatMessage>) => void;
  updateChatSessionTitle: (id: string, title: string) => void;
  deleteChatSession: (id: string) => void;
  // Risk profile
  riskProfile: RiskProfile;
  updateRiskProfile: (patch: Partial<RiskProfile>) => void;
  resetRiskProfileToDefault: () => void;
  // Manual watchlist
  manualWatchlist: ManualWatchAsset[];
  addWatchAsset: (asset: Omit<ManualWatchAsset, 'id'>) => void;
  removeWatchAsset: (id: string) => void;
  updateWatchAsset: (id: string, patch: Partial<ManualWatchAsset>) => void;
  // Perp position derivation
  derivePerpPositionsFromStrategies: (strategies: Strategy[]) => ReturnType<typeof derivePerpPositionsFromStrategies>;
}

const BlossomContext = createContext<BlossomContextType | undefined>(undefined);

export function useBlossomContext() {
  const context = useContext(BlossomContext);
  if (!context) {
    throw new Error('useBlossomContext must be used within BlossomProvider');
  }
  return context;
}

// Seed with 1-2 executed strategies
const seedStrategies: Strategy[] = [
  {
    id: 'seed-1',
    createdAt: '10:20 AM',
    side: 'Long',
    market: 'ETH-PERP',
    riskPercent: 3,
    entry: 3500,
    takeProfit: 3640,
    stopLoss: 3390,
    status: 'executed',
    sourceText: 'Long ETH with 3% risk, manage liquidation for me and set TP/SL automatically.',
    notionalUsd: 300,
    isClosed: false,
  },
  {
    id: 'seed-2',
    createdAt: '09:45 AM',
    side: 'Short',
    market: 'BTC-PERP',
    riskPercent: 2,
    entry: 45000,
    takeProfit: 44100,
    stopLoss: 45900,
    status: 'executed',
    sourceText: 'Short BTC with 2% risk',
    notionalUsd: 200,
    isClosed: false,
  },
];

const INITIAL_BALANCES: AssetBalance[] = [
  { symbol: 'REDACTED', balanceUsd: 4000 },
  { symbol: 'ETH', balanceUsd: 3000 },
  { symbol: 'SOL', balanceUsd: 3000 },
];

// Empty account for eth_testnet mode (unless forceDemoPortfolio is enabled)
const EMPTY_ACCOUNT: AccountState = {
  accountValue: 0,
  openPerpExposure: 0,
  eventExposureUsd: 0,
  totalPnlPct: 0,
  simulatedPnlPct30d: 0,
  balances: [],
};

// Use empty account in eth_testnet mode unless forceDemoPortfolio is true
const INITIAL_ACCOUNT: AccountState = 
  (executionMode === 'eth_testnet' && !forceDemoPortfolio) 
    ? EMPTY_ACCOUNT 
    : {
        accountValue: 10000,
        openPerpExposure: 0,
        eventExposureUsd: 0,
        totalPnlPct: 0,
        simulatedPnlPct30d: 0,
        balances: INITIAL_BALANCES,
      };

// Helper to extract base asset from market (e.g., "ETH-PERP" -> "ETH")
export function getBaseAsset(market: string): string {
  return market.replace('-PERP', '').replace('-PERP', '');
}

// Helper to check if a perp strategy is open
export function isOpenPerp(strategy: Strategy): boolean {
  return (
    strategy.instrumentType === 'perp' &&
    (strategy.status === 'executed' || strategy.status === 'executing') &&
    !strategy.isClosed
  );
}

// Helper to check if an event strategy is open
export function isOpenEvent(strategy: Strategy): boolean {
  return (
    strategy.instrumentType === 'event' &&
    (strategy.status === 'executed' || strategy.status === 'executing') &&
    !strategy.isClosed
  );
}

// Helper to check if a DeFi position is active
export function isActiveDefi(position: DefiPosition): boolean {
  return position.status === 'active';
}

// Helper to get total count of open positions
export function getOpenPositionsCount(
  strategies: Strategy[],
  defiPositions: DefiPosition[]
): number {
  const openPerps = strategies.filter(isOpenPerp).length;
  const openEvents = strategies.filter(isOpenEvent).length;
  const openDefi = defiPositions.filter(isActiveDefi).length;
  return openPerps + openEvents + openDefi;
}

// Example usage:
// - 1 executed perp, 1 active DeFi, 1 draft event → openPositionsCount = 2
// - 1 closed perp, 0 others → openPositionsCount = 0

// Helper to load chat sessions from localStorage
function loadChatSessionsFromStorage(): { sessions: ChatSession[]; activeId: string | null } {
  if (typeof window === 'undefined') {
    return { sessions: [], activeId: null };
  }
  try {
    const stored = localStorage.getItem('blossom_chat_sessions');
    const activeId = localStorage.getItem('blossom_active_chat_id');
    if (stored) {
      const sessions = JSON.parse(stored) as ChatSession[];
      return { sessions, activeId };
    }
  } catch (error) {
    console.error('Failed to load chat sessions from localStorage:', error);
  }
  return { sessions: [], activeId: null };
}

// Helper to save chat sessions to localStorage
function saveChatSessionsToStorage(sessions: ChatSession[], activeId: string | null) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    localStorage.setItem('blossom_chat_sessions', JSON.stringify(sessions));
    if (activeId) {
      localStorage.setItem('blossom_active_chat_id', activeId);
    } else {
      localStorage.removeItem('blossom_active_chat_id');
    }
  } catch (error) {
    console.error('Failed to save chat sessions to localStorage:', error);
  }
}

// Risk Profile helpers
const DEFAULT_RISK_PROFILE: RiskProfile = {
  maxPerTradeRiskPct: 3,
  minLiqBufferPct: 15,
  fundingAlertThresholdPctPer8h: 0.15,
  correlationHedgeThreshold: 0.75,
};

const RISK_PROFILE_KEY = 'blossom_risk_profile';

function loadRiskProfileFromStorage(): RiskProfile {
  if (typeof window === 'undefined') return DEFAULT_RISK_PROFILE;
  try {
    const raw = window.localStorage.getItem(RISK_PROFILE_KEY);
    if (!raw) return DEFAULT_RISK_PROFILE;
    const parsed = JSON.parse(raw) as Partial<RiskProfile>;
    return { ...DEFAULT_RISK_PROFILE, ...parsed };
  } catch {
    return DEFAULT_RISK_PROFILE;
  }
}

function saveRiskProfileToStorage(profile: RiskProfile) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RISK_PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // swallow
  }
}

// Manual Watchlist helpers
const WATCHLIST_KEY = 'blossom_manual_watchlist';

function loadManualWatchlistFromStorage(): ManualWatchAsset[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(WATCHLIST_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ManualWatchAsset[];
  } catch {
    return [];
  }
}

function saveManualWatchlistToStorage(watchlist: ManualWatchAsset[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
  } catch {
    // swallow
  }
}

// Compute margin from risk percent and leverage
// Formula: marginUsd = (accountValue * riskPercent / 100) / leverage
// Exported as const to ensure stable reference for Vite HMR
export const computePerpFromRisk = (params: {
  accountValue: number;
  riskPercent: number;
  leverage: number;
}): { marginUsd: number; notionalUsd: number } => {
  const { accountValue, riskPercent, leverage } = params;
  // Risk amount in USD = accountValue * riskPercent / 100
  // With leverage, margin = risk amount / leverage
  const marginUsd = (accountValue * riskPercent / 100) / leverage;
  const notionalUsd = marginUsd * leverage;
  return { marginUsd: Math.round(marginUsd), notionalUsd: Math.round(notionalUsd) };
};

// Helper to apply executed strategy to balances
function applyExecutedStrategyToBalances(
  currentAccount: AccountState,
  strategy: Strategy
): AccountState {
  const notional = (currentAccount.accountValue * strategy.riskPercent) / 100;
  const baseAsset = getBaseAsset(strategy.market);
  
  // Find REDACTED balance
  const usdcBalance = currentAccount.balances.find(b => b.symbol === 'REDACTED');
  const availableUsdc = usdcBalance?.balanceUsd || 0;
  
  // Clamp notional to available REDACTED
  const actualNotional = Math.min(notional, availableUsdc);
  
  if (actualNotional <= 0) {
    // Insufficient REDACTED - return unchanged
    return currentAccount;
  }
  
  // Update balances
  const newBalances = currentAccount.balances.map(balance => {
    if (balance.symbol === 'REDACTED') {
      return { ...balance, balanceUsd: balance.balanceUsd - actualNotional };
    }
    if (balance.symbol === baseAsset) {
      return { ...balance, balanceUsd: balance.balanceUsd + actualNotional };
    }
    return balance;
  });
  
  // If base asset doesn't exist, add it
  if (!newBalances.find(b => b.symbol === baseAsset)) {
    newBalances.push({ symbol: baseAsset, balanceUsd: actualNotional });
  }
  
  // Recompute account value (sum of balances)
  const newAccountValue = newBalances.reduce((sum, b) => sum + b.balanceUsd, 0);
  
  // Update PnL slightly
  const pnlDelta = strategy.side === 'Long' ? 0.2 : 0.15;
  
  return {
    ...currentAccount,
    balances: newBalances,
    accountValue: newAccountValue,
    openPerpExposure: currentAccount.openPerpExposure + actualNotional,
    totalPnlPct: currentAccount.totalPnlPct + pnlDelta,
    simulatedPnlPct30d: currentAccount.simulatedPnlPct30d + (pnlDelta * 0.3),
  };
}

export function BlossomProvider({ children }: { children: ReactNode }) {
  // Load chat sessions from localStorage on mount
  const { sessions: initialSessions, activeId: initialActiveId } = loadChatSessionsFromStorage();
  const [chatSessions, setChatSessions] = useState<ChatSession[]>(initialSessions);
  const [activeChatId, setActiveChatId] = useState<string | null>(initialActiveId);

  const [strategies, setStrategies] = useState<Strategy[]>(seedStrategies);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountState>(INITIAL_ACCOUNT);

  // Ensure account is empty when entering eth_testnet mode (unless forceDemoPortfolio)
  useEffect(() => {
    if (executionMode === 'eth_testnet' && !forceDemoPortfolio) {
      if (import.meta.env.DEV) {
        console.log('[BlossomContext] eth_testnet mode detected, initializing with empty account (no demo balances)');
      }
      setAccount(EMPTY_ACCOUNT);
    } else if (executionMode !== 'eth_testnet' || forceDemoPortfolio) {
      // In sim mode or forceDemoPortfolio mode, use demo account
      if (import.meta.env.DEV) {
        console.log('[BlossomContext] Sim mode or forceDemoPortfolio enabled, using demo account:', {
          executionMode,
          forceDemoPortfolio,
          source: 'demo init',
        });
      }
      setAccount(INITIAL_ACCOUNT);
    }
  }, [executionMode, forceDemoPortfolio]);
  const [activeTab, setActiveTab] = useState<ActiveTab>('copilot');
  const [venue, setVenue] = useState<Venue>('hyperliquid');
  const [onboarding, setOnboarding] = useState<OnboardingState>({
    openedTrade: false,
    queuedStrategy: false,
    openedRiskCenter: false,
    dismissed: false,
  });
  const [lastRiskSnapshot, setLastRiskSnapshot] = useState<RiskSnapshot | null>(null);
  const [defiPositions, setDefiPositions] = useState<DefiPosition[]>([]);
  const [latestDefiProposal, setLatestDefiProposal] = useState<DefiPosition | null>(null);
  const [riskProfile, setRiskProfile] = useState<RiskProfile>(loadRiskProfileFromStorage());
  const [manualWatchlist, setManualWatchlist] = useState<ManualWatchAsset[]>(loadManualWatchlistFromStorage());

  const addDraftStrategy = useCallback((strategyInput: Partial<Strategy> & { sourceText: string }): Strategy => {
    const newStrategy: Strategy = {
      id: Date.now().toString(),
      createdAt: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      side: strategyInput.side || 'Long',
      market: strategyInput.market || 'ETH-PERP',
      riskPercent: strategyInput.riskPercent || 3,
      entry: strategyInput.entry || 0,
      takeProfit: strategyInput.takeProfit || 0,
      stopLoss: strategyInput.stopLoss || 0,
      status: 'draft',
      sourceText: strategyInput.sourceText,
      isClosed: false,
      instrumentType: strategyInput.instrumentType,
      eventKey: strategyInput.eventKey,
      eventLabel: strategyInput.eventLabel,
      stakeUsd: strategyInput.stakeUsd,
      maxPayoutUsd: strategyInput.maxPayoutUsd,
      maxLossUsd: strategyInput.maxLossUsd,
      eventSide: strategyInput.eventSide,
      overrideRiskCap: strategyInput.overrideRiskCap,
      requestedStakeUsd: strategyInput.requestedStakeUsd,
    };

    setStrategies(prev => [newStrategy, ...prev]);
    setSelectedStrategyId(newStrategy.id);
    return newStrategy;
  }, []);

  // TODO: When backend is ready, replace updateStrategyStatus with API call
  // See src/lib/blossomApi.ts for closeStrategy() function
  // Example: await closeStrategy({ strategyId: id, type: 'perp' })
  
  const updateStrategyStatus = useCallback((id: string, status: StrategyStatus) => {
    setStrategies(prev => {
      const strategyToUpdate = prev.find(s => s.id === id);
      if (!strategyToUpdate) return prev;
      
      let computedNotional: number | undefined = undefined;
      let computedStake: number | undefined = undefined;
      
      // If status is "executed", compute notional/stake first
      if (status === 'executed') {
        if (strategyToUpdate.instrumentType === 'event') {
          // For events, compute stake
          if (!strategyToUpdate.stakeUsd) {
            const stake = (account.accountValue * strategyToUpdate.riskPercent) / 100;
            const usdcBalance = account.balances.find(b => b.symbol === 'REDACTED');
            const availableUsdc = usdcBalance?.balanceUsd || 0;
            computedStake = Math.min(stake, availableUsdc);
          } else {
            computedStake = strategyToUpdate.stakeUsd;
          }
        } else {
          // For perps, compute notional
          if (!strategyToUpdate.notionalUsd) {
            const notional = (account.accountValue * strategyToUpdate.riskPercent) / 100;
            const usdcBalance = account.balances.find(b => b.symbol === 'REDACTED');
            const availableUsdc = usdcBalance?.balanceUsd || 0;
            computedNotional = Math.min(notional, availableUsdc);
          }
        }
      }
      
      const updated = prev.map(s => {
        if (s.id === id) {
          return {
            ...s,
            status,
            notionalUsd: computedNotional !== undefined ? computedNotional : s.notionalUsd,
            stakeUsd: computedStake !== undefined ? computedStake : s.stakeUsd,
          };
        }
        return s;
      });
      
      // After updating strategies, if status is executed, apply balance changes
      if (status === 'executed') {
        const executedStrategy = updated.find(s => s.id === id);
        if (executedStrategy && !executedStrategy.isClosed) {
          if (executedStrategy.instrumentType === 'event' && executedStrategy.stakeUsd) {
            // Handle event strategy execution
            setAccount(current => {
              const usdcBalance = current.balances.find(b => b.symbol === 'REDACTED');
              if (!usdcBalance || usdcBalance.balanceUsd < executedStrategy.stakeUsd!) {
                return current;
              }
              
              const newBalances = current.balances.map(b =>
                b.symbol === 'REDACTED' 
                  ? { ...b, balanceUsd: b.balanceUsd - executedStrategy.stakeUsd! }
                  : b
              );
              
              const newAccountValue = newBalances.reduce((sum, b) => sum + b.balanceUsd, 0);
              
              return {
                ...current,
                balances: newBalances,
                accountValue: newAccountValue,
                eventExposureUsd: current.eventExposureUsd + executedStrategy.stakeUsd!,
              };
            });
          } else if (executedStrategy.notionalUsd) {
            // Handle perp strategy execution
            setAccount(current => applyExecutedStrategyToBalances(current, executedStrategy));
          }
        }
      }
      
      return updated;
    });
  }, [account]);

  const recomputeAccountFromStrategies = useCallback(() => {
    // Account is now updated directly in updateStrategyStatus when status becomes "executed"
    // This function can be used for other recomputations if needed
    const activeStrategies = strategies.filter(s => 
      (s.status === 'executed' || s.status === 'executing') && !s.isClosed
    );
    const totalRisk = activeStrategies.reduce((sum, s) => sum + s.riskPercent, 0);
    
    setAccount(prev => {
      const newExposure = Math.min(prev.accountValue * (totalRisk / 100), prev.accountValue * 0.5);
      return {
        ...prev,
        openPerpExposure: newExposure,
      };
    });
  }, [strategies]);

  const closeStrategy = useCallback((id: string) => {
    setStrategies(prev => {
      const strategy = prev.find(s => s.id === id);
      if (!strategy || strategy.status !== 'executed' || strategy.isClosed || !strategy.notionalUsd) {
        return prev;
      }

      // Compute realized PnL (simple deterministic model)
      const pnlPct = strategy.side === 'Long' ? 0.8 : 0.6;
      const realizedPnlUsd = (strategy.notionalUsd * pnlPct) / 100;
      const realizedPnlPct = pnlPct;

      // Update account balances
      setAccount(current => {
        const baseAsset = getBaseAsset(strategy.market);
        const newBalances = current.balances.map(balance => {
          if (balance.symbol === baseAsset) {
            return { ...balance, balanceUsd: balance.balanceUsd - strategy.notionalUsd! };
          }
          if (balance.symbol === 'REDACTED') {
            return { ...balance, balanceUsd: balance.balanceUsd + strategy.notionalUsd! + realizedPnlUsd };
          }
          return balance;
        });

        const newAccountValue = newBalances.reduce((sum, b) => sum + b.balanceUsd, 0);
        const newOpenPerpExposure = Math.max(0, current.openPerpExposure - strategy.notionalUsd!);

        return {
          ...current,
          balances: newBalances,
          accountValue: newAccountValue,
          openPerpExposure: newOpenPerpExposure,
          totalPnlPct: current.totalPnlPct + (realizedPnlPct * 0.1), // Small bump to total PnL
          simulatedPnlPct30d: current.simulatedPnlPct30d + (realizedPnlPct * 0.05),
        };
      });

      // Update strategy
      return prev.map(s => 
        s.id === id 
          ? {
              ...s,
              status: 'closed' as StrategyStatus,
              isClosed: true,
              closedAt: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
              realizedPnlUsd,
              realizedPnlPct,
            }
          : s
      );
    });
  }, []);

  const autoCloseProfitableStrategies = useCallback(() => {
    const profitableStrategies = strategies.filter(s => 
      s.status === 'executed' && !s.isClosed && s.notionalUsd
    );

    let closedCount = 0;
    profitableStrategies.forEach(strategy => {
      closeStrategy(strategy.id);
      closedCount++;
    });

    return closedCount;
  }, [strategies, closeStrategy]);

  const updateEventStake = useCallback((id: string, updates: Partial<Strategy>) => {
    setStrategies(prev => prev.map(s => {
      if (s.id === id && s.instrumentType === 'event') {
        return { ...s, ...updates };
      }
      return s;
    }));
    
    // Recompute account if stake changed
    if (updates.stakeUsd !== undefined) {
      recomputeAccountFromStrategies();
    }
  }, [recomputeAccountFromStrategies]);

  const updateStrategy = useCallback((id: string, updates: Partial<Strategy>) => {
    setStrategies(prev => prev.map(s => {
      if (s.id === id) {
        return { ...s, ...updates };
      }
      return s;
    }));
    
    // Recompute account if risk or size changed
    if (updates.riskPercent !== undefined || updates.notionalUsd !== undefined) {
      recomputeAccountFromStrategies();
    }
  }, [recomputeAccountFromStrategies]);

  // Chat session management
  const createNewChatSession = useCallback((): string => {
    const newId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `chat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newSession: ChatSession = {
      id: newId,
      title: 'New chat',
      createdAt: Date.now(),
      messages: [],
    };
    setChatSessions(prev => {
      const updated = [newSession, ...prev];
      saveChatSessionsToStorage(updated, newId);
      return updated;
    });
    setActiveChatId(newId);
    return newId;
  }, []);

  const setActiveChat = useCallback((id: string) => {
    setActiveChatId(id);
    setChatSessions(prev => {
      // Use functional update to get latest sessions
      saveChatSessionsToStorage(prev, id);
      return prev;
    });
  }, []);

  // Helper that appends to a specific chat by ID (doesn't depend on activeChatId for append logic)
  const appendMessageToChat = useCallback(
    (chatId: string, message: ChatMessage) => {
      setChatSessions(prev => {
        // Defensive: ensure session exists (handles race condition where session creation hasn't flushed)
        const sessionExists = prev.some(s => s.id === chatId);
        let next: ChatSession[];
        if (!sessionExists) {
          // Session doesn't exist yet - create it inline
          const newSession: ChatSession = {
            id: chatId,
            title: 'New chat',
            createdAt: Date.now(),
            messages: [message],
          };
          next = [newSession, ...prev];
        } else {
          next = prev.map(session => {
            if (session.id === chatId) {
              const updatedSession = { ...session, messages: [...session.messages, message] };
              // B4: Update title if this is the first user message (inside same state update to avoid stale reads)
              if (message.isUser && session.title === 'New chat') {
                const userMessages = updatedSession.messages.filter(m => m.isUser);
                if (userMessages.length === 1) {
                  // First user message - generate title from message text (first 8 words)
                  const words = message.text.trim().split(/\s+/);
                  const title = words.slice(0, 8).join(' ') + (words.length > 8 ? '…' : '');
                  updatedSession.title = title;
                }
              }
              return updatedSession;
            }
            return session;
          });
        }
        // Use chatId directly (not activeChatId from closure)
        saveChatSessionsToStorage(next, chatId);
        
        // DEV tripwire: assert session and message exist after mutation
        if (import.meta.env.DEV) {
          const targetSession = next.find(s => s.id === chatId);
          if (!targetSession) {
            console.error('[appendMessageToChat] Session missing after append', { chatId, sessionIds: next.map(s => s.id) });
          } else if (!targetSession.messages.some(m => m.id === message.id)) {
            console.error('[appendMessageToChat] Message missing after append', { chatId, messageId: message.id, messageCount: targetSession.messages.length });
          }
        }
        
        return next;
      });
    },
    [] // Remove activeChatId dependency
  );

  // Thin wrapper that uses activeChatId (for backward compatibility)
  const appendMessageToActiveChat = useCallback(
    (message: ChatMessage) => {
      if (!activeChatId) return;
      appendMessageToChat(activeChatId, message);
    },
    [activeChatId, appendMessageToChat]
  );

  const updateMessageInChat = useCallback(
    (chatId: string, messageId: string, updates: Partial<ChatMessage>) => {
      setChatSessions(prev => {
        const session = prev.find(s => s.id === chatId);
        if (!session) {
          if (import.meta.env.DEV) {
            console.error('[updateMessageInChat] Session not found', { chatId, messageId });
          }
          return prev;
        }
        
        const messageExists = session.messages.some(m => m.id === messageId);
        if (!messageExists) {
          if (import.meta.env.DEV) {
            console.error('[updateMessageInChat] Message not found', { chatId, messageId });
          }
          return prev;
        }
        
        const next = prev.map(s => {
          if (s.id === chatId) {
            return {
              ...s,
              messages: s.messages.map(msg =>
                msg.id === messageId ? { ...msg, ...updates } : msg
              ),
            };
          }
          return s;
        });
        
        // Use chatId parameter directly (not activeChatId from closure)
        saveChatSessionsToStorage(next, chatId);
        return next;
      });
    },
    []
  );

  const updateChatSessionTitle = useCallback((id: string, title: string) => {
    setChatSessions(prev => {
      const updated = prev.map(session => {
        if (session.id === id) {
          return { ...session, title };
        }
        return session;
      });
      // Use id parameter directly (not activeChatId from closure)
      saveChatSessionsToStorage(updated, id);
      return updated;
    });
  }, []);

  const deleteChatSession = useCallback((id: string) => {
    setChatSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      let nextActive = activeChatId;
      
      if (activeChatId === id) {
        // If deleting the active chat, switch to most recent remaining (first in array since we prepend)
        nextActive = next.length > 0 ? next[0].id : null;
        setActiveChatId(nextActive);
      }
      
      saveChatSessionsToStorage(next, nextActive);
      return next;
    });
  }, [activeChatId]);

  const updateRiskProfile = useCallback(
    (patch: Partial<RiskProfile>) => {
      setRiskProfile(prev => {
        const next = { ...prev, ...patch };
        saveRiskProfileToStorage(next);
        return next;
      });
    },
    [],
  );

  const resetRiskProfileToDefault = useCallback(() => {
    setRiskProfile(DEFAULT_RISK_PROFILE);
    saveRiskProfileToStorage(DEFAULT_RISK_PROFILE);
  }, []);

  const addWatchAsset = useCallback((asset: Omit<ManualWatchAsset, 'id'>) => {
    setManualWatchlist(prev => {
      const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : String(Date.now());
      const next = [{ ...asset, id }, ...prev];
      saveManualWatchlistToStorage(next);
      return next;
    });
  }, []);

  const removeWatchAsset = useCallback((id: string) => {
    setManualWatchlist(prev => {
      const next = prev.filter(a => a.id !== id);
      saveManualWatchlistToStorage(next);
      return next;
    });
  }, []);

  const updateWatchAsset = useCallback((id: string, patch: Partial<ManualWatchAsset>) => {
    setManualWatchlist(prev => {
      const next = prev.map(a => (a.id === id ? { ...a, ...patch } : a));
      saveManualWatchlistToStorage(next);
      return next;
    });
  }, []);

  const closeEventStrategy = useCallback((id: string) => {
    setStrategies(prev => {
      const strategy = prev.find(s => s.id === id);
      if (!strategy || strategy.instrumentType !== 'event' || strategy.status !== 'executed' || strategy.isClosed || !strategy.stakeUsd) {
        return prev;
      }

      // Simple mock outcome: 55% win rate
      const isWin = Math.random() < 0.55;
      const maxPayout = strategy.maxPayoutUsd || (strategy.stakeUsd * 1.7);
      const pnlUsd = isWin 
        ? maxPayout - strategy.stakeUsd
        : -strategy.stakeUsd;

      // Update account balances
      setAccount(current => {
        const newBalances = current.balances.map(balance => {
          if (balance.symbol === 'REDACTED') {
            // If win: add maxPayout (stake + profit)
            // If loss: stake was already deducted at execution, so no refund
            const usdcChange = isWin ? maxPayout : 0;
            return { ...balance, balanceUsd: balance.balanceUsd + usdcChange };
          }
          return balance;
        });

        const newAccountValue = newBalances.reduce((sum, b) => sum + b.balanceUsd, 0);
        const pnlPct = current.accountValue > 0 ? (pnlUsd / current.accountValue) * 100 : 0;

        return {
          ...current,
          balances: newBalances,
          accountValue: newAccountValue,
          eventExposureUsd: Math.max(0, current.eventExposureUsd - strategy.stakeUsd!),
          totalPnlPct: current.totalPnlPct + pnlPct,
          simulatedPnlPct30d: current.simulatedPnlPct30d + (pnlPct * 0.3),
        };
      });

      // Update strategy
      return prev.map(s => 
        s.id === id 
          ? {
              ...s,
              status: 'closed' as StrategyStatus,
              isClosed: true,
              closedAt: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
              realizedPnlUsd: pnlUsd,
              realizedPnlPct: strategy.stakeUsd! > 0 ? (pnlUsd / strategy.stakeUsd!) * 100 : 0,
              eventOutcome: isWin ? 'won' : 'lost',
            }
          : s
      );
    });
  }, []);

  const createDefiPlanFromCommand = useCallback((command: string, protocolOverride?: string): DefiPosition => {
    if (import.meta.env.DEV) {
      console.log('[BlossomContext] createDefiPlanFromCommand called', { command, protocolOverride });
    }

    const idleUsdc = account.balances.find(b => b.symbol === 'REDACTED')?.balanceUsd || 3000;
    let depositUsd = Math.min(idleUsdc * 0.5, 2000); // Fallback default

    let protocol = 'RootsFi';
    let apyPct = 6.4;
    const lowerCommand = command.toLowerCase();

    // Extract amount with priority: amountUsd token > $<number> > amountPct token > percent text > fallback
    // 1. Try amountUsd:"..." token first (highest priority)
    const amountUsdTokenMatch = command.match(/amountUsd:"([^"]+)"/i);
    if (amountUsdTokenMatch) {
      const amountStr = amountUsdTokenMatch[1].replace(/,/g, ''); // Remove commas
      const parsedAmount = parseFloat(amountStr);
      if (!isNaN(parsedAmount) && parsedAmount > 0) {
        depositUsd = Math.round(parsedAmount);
      }
    } else {
      // 2. Try $<number> pattern (accept commas/decimals)
      const dollarAmountMatch = command.match(/\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
      if (dollarAmountMatch) {
        const amountStr = dollarAmountMatch[1].replace(/,/g, '');
        const parsedAmount = parseFloat(amountStr);
        if (!isNaN(parsedAmount) && parsedAmount > 0) {
          depositUsd = Math.round(parsedAmount);
        }
      } else {
        // 3. Try amountPct:"..." token (requires account value, handled in Chat.tsx before calling this)
        // This is a fallback - Chat.tsx should rewrite to amountUsd before calling
        const amountPctTokenMatch = command.match(/amountPct:"([^"]+)"/i);
        if (amountPctTokenMatch) {
          // If we see this token, it means Chat.tsx didn't rewrite it - use fallback
          // (This shouldn't happen in normal flow, but handle gracefully)
        } else {
          // 4. Try percent allocations (10%, 5%, etc.) - only if no explicit amount found
          const percentMatch = command.match(/(\d+(?:\.\d+)?)\s*%/);
          if (percentMatch) {
            const percent = parseFloat(percentMatch[1]);
            if (!isNaN(percent) && percent > 0 && percent <= 100) {
              // Use account value if available, otherwise fallback
              const accountValue = account.accountValue || 10000;
              depositUsd = Math.round((accountValue * percent) / 100);
            }
          }
        }
      }
    }

    // Extract protocol from protocol:"..." token if present
    const protocolTokenMatch = command.match(/protocol:"([^"]+)"/i);
    const extractedProtocol = protocolTokenMatch ? protocolTokenMatch[1] : null;
    
    // Use override > extracted > fallback logic
    if (protocolOverride) {
      protocol = protocolOverride;
    } else if (extractedProtocol) {
      protocol = extractedProtocol;
    } else if (lowerCommand.includes('kamino')) {
      protocol = 'Kamino';
      apyPct = 8.5;
    } else if (lowerCommand.includes('jet')) {
      protocol = 'Jet';
      apyPct = 7.2;
    } else if (lowerCommand.includes('lido')) {
      protocol = 'Lido';
      apyPct = 3.5;
    } else if (lowerCommand.includes('aave')) {
      protocol = 'Aave';
      apyPct = 4.2;
    } else if (lowerCommand.includes('morpho')) {
      protocol = 'Morpho';
      apyPct = 5.8;
    } else if (lowerCommand.includes('pendle')) {
      protocol = 'Pendle';
      apyPct = 7.5;
    } else if (lowerCommand.includes('compound')) {
      protocol = 'Compound';
      apyPct = 3.8;
    } else if (lowerCommand.includes('uniswap')) {
      protocol = 'Uniswap';
      apyPct = 2.1;
    } else if (lowerCommand.includes('ethena')) {
      protocol = 'Ethena';
      apyPct = 15.2;
    } else if (lowerCommand.includes('maker')) {
      protocol = 'Maker';
      apyPct = 1.5;
    }

    const newPosition: DefiPosition = {
      id: Date.now().toString(),
      command,
      protocol,
      asset: 'REDACTED yield vault',
      depositUsd,
      apyPct,
      status: 'proposed',
      createdAt: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    };

    setLatestDefiProposal(newPosition);
    setDefiPositions(prev => {
      const updated = [newPosition, ...prev];
      if (import.meta.env.DEV) {
        console.log('[BlossomContext] ✓ DeFi position added to state:', {
          newPositionId: newPosition.id,
          protocol: newPosition.protocol,
          totalPositions: updated.length,
          allPositions: updated
        });
      }
      return updated;
    });
    return newPosition;
  }, [account.balances]);

  const confirmDefiPlan = useCallback(async (id: string) => {
    // Blocker #5: Wire frontend to capture TX hash from backend
    if (executionMode === 'eth_testnet') {
      // In testnet mode, execute on-chain via backend
      const position = defiPositions.find(p => p.id === id);
      if (!position || position.status === 'active') {
        return;
      }

      try {
        const userAddress = await window.ethereum?.request({ method: 'eth_requestAccounts' }).then((accounts: string[]) => accounts[0]);
        if (!userAddress) {
          console.error('[confirmDefiPlan] No wallet address available');
          return;
        }

        // Create executionRequest from DeFi position
        const executionRequest = {
          kind: 'lend_supply' as const,
          chain: 'sepolia',
          asset: position.asset,
          amount: position.depositUsd.toString(),
          protocol: position.protocol,
          vault: position.protocol, // Use protocol as vault for now
        };

        // Use execution kernel
        const { executePlan } = await import('../lib/executionKernel');
        const result = await executePlan({
          draftId: id,
          userAddress,
          planType: 'defi',
          executionRequest,
          strategy: {
            id,
            instrumentType: 'defi',
            protocol: position.protocol,
            depositUsd: position.depositUsd,
            apyPct: position.apyPct,
          },
        }, { executionAuthMode });

        // TRUTHFUL UI: Only mark as active if we have txHash and receipt is confirmed
        if (result.ok && result.txHash && result.receiptStatus === 'confirmed') {
          // Update position with tx metadata
          setDefiPositions(prev => prev.map(p =>
            p.id === id
              ? {
                  ...p,
                  status: 'active' as DefiStatus,
                  txHash: result.txHash,
                  blockNumber: result.blockNumber,
                  explorerUrl: result.explorerUrl,
                }
              : p
          ));

          if (latestDefiProposal?.id === id) {
            setLatestDefiProposal(null);
          }

          // Update account from backend portfolio snapshot
          if (result.portfolio) {
            const mapped = mapBackendPortfolioToFrontendState(result.portfolio);
            setAccount(mapped.account);
          }

          if (import.meta.env.DEV) {
            console.log('[confirmDefiPlan] ✓ Execution confirmed on-chain:', {
              positionId: id,
              txHash: result.txHash,
              blockNumber: result.blockNumber,
            });
          }
        } else if (result.mode === 'simulated' || result.mode === 'unsupported') {
          // TRUTHFUL UI: Show simulated/unsupported status, don't mark as active
          if (import.meta.env.DEV) {
            console.warn('[confirmDefiPlan] ⚠️ DeFi execution:', result.mode, result.reason);
          }
          // Don't mark as active - position remains proposed
          // UI should show "Simulated" or "Not supported" status
        } else if (!result.ok) {
          // Execution failed
          console.error('[confirmDefiPlan] Execution failed:', result.reason);
          // Position remains proposed
        } else {
          // Receipt pending or timeout
          if (import.meta.env.DEV) {
            console.log('[confirmDefiPlan] Execution pending:', result.receiptStatus);
          }
          // Position remains proposed until confirmed
        }
      } catch (err) {
        console.error('[confirmDefiPlan] Failed to execute DeFi plan:', err);
      }
      return;
    }

    // SIM mode - existing logic
    setDefiPositions(prev => {
      const position = prev.find(p => p.id === id);
      if (!position || position.status === 'active') {
        return prev;
      }

      // Update account balances - DeFi deposit is a zero-sum reallocation: REDACTED → DEFI
      setAccount(current => {
        const usdcBalance = current.balances.find(b => b.symbol === 'REDACTED');
        if (!usdcBalance || usdcBalance.balanceUsd < position.depositUsd) {
          // Insufficient REDACTED - don't proceed
          return current;
        }

        // Subtract from REDACTED
        const newBalances = current.balances.map(balance => {
          if (balance.symbol === 'REDACTED') {
            return { ...balance, balanceUsd: Math.max(0, balance.balanceUsd - position.depositUsd) };
          }
          return balance;
        });

        // Add or update DEFI balance
        const defiBalance = newBalances.find(b => b.symbol === 'DEFI');
        if (defiBalance) {
          // Update existing DEFI balance
          const updatedBalances = newBalances.map(b =>
            b.symbol === 'DEFI' ? { ...b, balanceUsd: b.balanceUsd + position.depositUsd } : b
          );
          // Recompute account value as sum of all balances (zero-sum reallocation)
          const newAccountValue = updatedBalances.reduce((sum, b) => sum + b.balanceUsd, 0);
          return {
            ...current,
            balances: updatedBalances,
            accountValue: newAccountValue, // Should equal previous accountValue (zero-sum)
          };
        } else {
          // Create DEFI balance if it doesn't exist
          newBalances.push({ symbol: 'DEFI', balanceUsd: position.depositUsd });
          // Recompute account value as sum of all balances (zero-sum reallocation)
          const newAccountValue = newBalances.reduce((sum, b) => sum + b.balanceUsd, 0);
          return {
            ...current,
            balances: newBalances,
            accountValue: newAccountValue, // Should equal previous accountValue (zero-sum)
          };
        }
      });

      // Update position status
      const updated = prev.map(p =>
        p.id === id ? { ...p, status: 'active' as DefiStatus } : p
      );

      if (latestDefiProposal?.id === id) {
        setLatestDefiProposal(null);
      }

      return updated;
    });
  }, [latestDefiProposal, defiPositions]);

  const updateDeFiPlanDeposit = useCallback((id: string, newDepositUsd: number) => {
    setDefiPositions(prev => {
      const position = prev.find(p => p.id === id);
      if (!position) {
        return prev;
      }

      // Only allow updates for active positions
      if (position.status !== 'active') {
        return prev;
      }

      const oldDeposit = position.depositUsd;
      const depositDelta = newDepositUsd - oldDeposit;

      if (depositDelta === 0) {
        // No change needed
        return prev;
      }

      // Update account balances - DeFi deposit change is a zero-sum reallocation
      setAccount(current => {
        const usdcBalance = current.balances.find(b => b.symbol === 'REDACTED');
        const defiBalance = current.balances.find(b => b.symbol === 'DEFI');

        if (!usdcBalance) {
          return current; // Can't update without REDACTED balance
        }

        // Ensure DEFI balance exists
        if (!defiBalance) {
          // This shouldn't happen for active positions, but handle it gracefully
          return current;
        }

        // Validate sufficient balance for increase
        if (depositDelta > 0 && usdcBalance.balanceUsd < depositDelta) {
          return current; // Insufficient REDACTED
        }

        // Validate sufficient DEFI for decrease
        if (depositDelta < 0 && defiBalance.balanceUsd < Math.abs(depositDelta)) {
          return current; // Insufficient DEFI to refund
        }

        // Apply delta: move funds between REDACTED and DEFI
        const newBalances = current.balances.map(balance => {
          if (balance.symbol === 'REDACTED') {
            // If increasing deposit: subtract from REDACTED
            // If decreasing deposit: add to REDACTED (refund)
            return { ...balance, balanceUsd: Math.max(0, balance.balanceUsd - depositDelta) };
          }
          if (balance.symbol === 'DEFI') {
            // If increasing deposit: add to DEFI
            // If decreasing deposit: subtract from DEFI (refund)
            return { ...balance, balanceUsd: Math.max(0, balance.balanceUsd + depositDelta) };
          }
          return balance;
        });

        // Recompute account value as sum of all balances (zero-sum reallocation)
        const newAccountValue = newBalances.reduce((sum, b) => sum + b.balanceUsd, 0);

        return {
          ...current,
          balances: newBalances,
          accountValue: newAccountValue, // Should equal previous accountValue (zero-sum)
        };
      });

      // Update position deposit
      return prev.map(p =>
        p.id === id ? { ...p, depositUsd: newDepositUsd } : p
      );
    });
  }, []);

  // Quick update helpers for drawer inline controls
  // These calculate derived values (risk %, max payout) and call the base update functions
  const updatePerpSizeById = useCallback((id: string, newSizeUsd: number) => {
    const strategy = strategies.find(s => s.id === id);
    if (!strategy || strategy.instrumentType !== 'perp') return;
    
    const accountValue = account.accountValue;
    const newRiskPercent = accountValue > 0 ? (newSizeUsd / accountValue) * 100 : 0;
    
    updateStrategy(id, {
      notionalUsd: newSizeUsd,
      riskPercent: newRiskPercent,
    });
  }, [strategies, account.accountValue, updateStrategy]);

  const updatePerpTpSlById = useCallback((id: string, newTakeProfit: number, newStopLoss: number) => {
    const strategy = strategies.find(s => s.id === id);
    if (!strategy || strategy.instrumentType !== 'perp') return;
    
    // Validate TP/SL make sense for the side
    if (strategy.side === 'Long') {
      // For Long: TP should be > entry, SL should be < entry
      if (newTakeProfit <= strategy.entry || newStopLoss >= strategy.entry) {
        console.warn('Invalid TP/SL for Long position');
        return;
      }
    } else {
      // For Short: TP should be < entry, SL should be > entry
      if (newTakeProfit >= strategy.entry || newStopLoss <= strategy.entry) {
        console.warn('Invalid TP/SL for Short position');
        return;
      }
    }
    
    // Validate positive values
    if (newTakeProfit <= 0 || newStopLoss <= 0) {
      console.warn('TP/SL must be positive');
      return;
    }
    
    // Recalculate leverage from new TP/SL spread (for display consistency)
    // This ensures leverage stays in sync when TP/SL are edited directly
    // Note: The computed leverage may be non-tick (e.g., 7.8x); the drawer slider will snap to the closest tick
    const spread = Math.abs(newTakeProfit - newStopLoss);
    const recalculatedLeverage = spread > 0 ? Math.round((spread / strategy.entry) * 10) : (strategy.leverage || 1);
    const clampedLeverage = Math.min(Math.max(recalculatedLeverage, 1), 20);
    
    updateStrategy(id, {
      takeProfit: newTakeProfit,
      stopLoss: newStopLoss,
      leverage: clampedLeverage, // Keep leverage in sync when TP/SL change (drawer will snap to nearest tick)
    });
  }, [strategies, updateStrategy]);

  const updatePerpLeverageById = useCallback((id: string, newLeverage: number) => {
    const strategy = strategies.find(s => s.id === id);
    if (!strategy || strategy.instrumentType !== 'perp') return;
    
    // Clamp leverage to 1-20 for UI consistency (helper accepts up to 100x for flexibility)
    const clampedLeverage = Math.min(Math.max(newLeverage, 1), 20);
    
    // Calculate new TP/SL based on leverage
    // Leverage formula: (spread / entry) * 10 = leverage
    // So: spread = (entry * clampedLeverage) / 10
    const spread = (strategy.entry * clampedLeverage) / 10;
    
    let newTakeProfit: number;
    let newStopLoss: number;
    
    if (strategy.side === 'Long') {
      // For Long: TP above entry, SL below entry
      newTakeProfit = Math.round(strategy.entry + spread / 2);
      newStopLoss = Math.round(strategy.entry - spread / 2);
    } else {
      // For Short: TP below entry, SL above entry
      newTakeProfit = Math.round(strategy.entry - spread / 2);
      newStopLoss = Math.round(strategy.entry + spread / 2);
    }
    
    // Ensure positive values
    if (newTakeProfit <= 0 || newStopLoss <= 0) {
      console.warn('Calculated TP/SL would be invalid');
      return;
    }
    
    // Store leverage as the authoritative value, then update TP/SL
    updateStrategy(id, {
      leverage: clampedLeverage,
      takeProfit: newTakeProfit,
      stopLoss: newStopLoss,
    });
  }, [strategies, updateStrategy]);

  const updateEventStakeById = useCallback((id: string, newStakeUsd: number) => {
    const strategy = strategies.find(s => s.id === id);
    if (!strategy || strategy.instrumentType !== 'event') return;
    
    const accountValue = account.accountValue;
    const riskPct = accountValue > 0 ? (newStakeUsd / accountValue) * 100 : 0;
    
    // Calculate max payout (preserve the ratio from original stake)
    const originalStake = strategy.stakeUsd || newStakeUsd;
    const originalMaxPayout = strategy.maxPayoutUsd || (newStakeUsd * 1.7); // Default 1.7x for demo
    const maxPayoutUsd = originalStake > 0 
      ? (newStakeUsd * originalMaxPayout) / originalStake
      : newStakeUsd * 1.7;
    
    updateEventStake(id, {
      stakeUsd: newStakeUsd,
      maxPayoutUsd,
      maxLossUsd: newStakeUsd,
      riskPercent: riskPct,
      overrideRiskCap: true, // Modifications are explicit overrides
    });
  }, [strategies, account.accountValue, updateEventStake]);

  const updateEventSideById = useCallback((id: string, newSide: 'YES' | 'NO') => {
    const strategy = strategies.find(s => s.id === id);
    if (!strategy || strategy.instrumentType !== 'event') return;
    
    // Validate newSide
    if (newSide !== 'YES' && newSide !== 'NO') {
      console.warn('Event side must be YES or NO');
      return;
    }
    
    // Update eventSide while keeping stake, eventKey, eventLabel, etc.
    // Risk % and max payout remain the same (they're based on stake, not side)
    updateEventStake(id, {
      eventSide: newSide,
    });
  }, [strategies, updateEventStake]);

  const updateDeFiDepositById = useCallback((id: string, newDepositUsd: number) => {
    updateDeFiPlanDeposit(id, newDepositUsd);
  }, [updateDeFiPlanDeposit]);

  const updateFromBackendPortfolio = useCallback((portfolio: any) => {
    if (import.meta.env.DEV) {
      console.log('[BlossomContext] updateFromBackendPortfolio called', {
        portfolio,
        stackTrace: new Error().stack
      });
    }

    const mapped = mapBackendPortfolioToFrontendState(portfolio);
    setAccount(mapped.account);
    setStrategies(mapped.strategies);

    // Merge: Preserve local 'proposed' DeFi positions that aren't in backend response
    // This fixes the issue where clicking "Allocate $500" creates a local proposal
    // but then backend response wipes it out because backend doesn't know about it yet
    setDefiPositions(prev => {
      const backendPositions = mapped.defiPositions || [];
      const backendIds = new Set(backendPositions.map((p: DefiPosition) => p.id));

      // Keep local 'proposed' positions that aren't in backend response
      const localProposedPositions = prev.filter(
        p => p.status === 'proposed' && !backendIds.has(p.id)
      );

      // Merge: backend positions (authoritative) + local proposed positions
      const merged = [...backendPositions, ...localProposedPositions];

      if (import.meta.env.DEV) {
        console.log('[BlossomContext] DeFi positions merge:', {
          previousPositions: prev,
          backendPositions,
          localProposedPositions,
          mergedResult: merged
        });
      }

      return merged;
    });
  }, []);

  const resetSim = useCallback(async () => {
    // In eth_testnet mode (without forceDemoPortfolio), reset to empty and refetch real balances
    if (executionMode === 'eth_testnet' && !forceDemoPortfolio) {
      if (import.meta.env.DEV) {
        console.log('[BlossomContext] Reset SIM in eth_testnet mode - resetting to empty and refetching real balances');
      }
      // Reset to empty account
      setAccount(EMPTY_ACCOUNT);
      setStrategies([]);
      setSelectedStrategyId(null);
      
      // Trigger portfolio refetch by checking wallet connection
      const userAddress = await getAddress();
      if (userAddress) {
        // Portfolio sync useEffect will automatically refetch
        if (import.meta.env.DEV) {
          console.log('[BlossomContext] Wallet connected, portfolio will refetch automatically');
        }
      } else {
        if (import.meta.env.DEV) {
          console.log('[BlossomContext] No wallet connected, account remains empty');
        }
      }
    } else if (USE_AGENT_BACKEND) {
      try {
        const { resetSim: resetSimApi } = await import('../lib/blossomApi');
        const response = await resetSimApi();
        updateFromBackendPortfolio(response.portfolio);
      } catch (error: any) {
        console.error('Failed to reset backend sim:', error);
        throw error;
      }
    } else {
      // Mock mode: local reset
      setStrategies(seedStrategies);
      setAccount(INITIAL_ACCOUNT);
      setSelectedStrategyId(null);
    }
    
    // Clear chat sessions and localStorage (applies to both mock and agent mode)
    setChatSessions([]);
    setActiveChatId(null);

    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem('blossom_chat_sessions');
        window.localStorage.removeItem('blossom_active_chat_id');
      } catch (e) {
        // Ignore storage errors
        console.error('Failed to clear chat sessions from localStorage:', e);
      }
    }

    // Clear session data from localStorage
    const userAddress = await getAddress();
    if (userAddress) {
      const sessionKey = `blossom_session_${userAddress.toLowerCase()}`;
      const sessionTxHashKey = `blossom_session_${userAddress.toLowerCase()}_txHash`;

      if (typeof window !== 'undefined') {
        try {
          window.localStorage.removeItem(sessionKey);
          window.localStorage.removeItem(sessionTxHashKey);

          if (import.meta.env.DEV) {
            console.log('[resetSim] ✓ Cleared session data:', {
              sessionKey,
              sessionTxHashKey
            });
          }
        } catch (e) {
          console.error('Failed to clear session data from localStorage:', e);
        }
      }
    }

    // Clear wallet connection cache
    const { clearWalletCache } = await import('../lib/walletAdapter');
    await clearWalletCache();

    // Dispatch reset event for UI components to update
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('resetSim'));
    }

    if (import.meta.env.DEV) {
      console.log('[resetSim] ✓ Portfolio reset complete');
    }
  }, [executionMode, forceDemoPortfolio, updateFromBackendPortfolio, setChatSessions, setActiveChatId]);

  // ETH testnet portfolio sync: fetch real balances and update account state
  useEffect(() => {
    if (executionMode !== 'eth_testnet') {
      return; // Only sync in eth_testnet mode
    }

    if (import.meta.env.DEV) {
      console.log('[BlossomContext] Portfolio sync initialized:', {
        executionMode,
        forceDemoPortfolio,
        source: 'backend snapshot',
      });
    }

    let intervalId: ReturnType<typeof setInterval> | null = null;
    let isMounted = true;
    let healthCheckCleanup: (() => void) | null = null;

    const syncPortfolio = async () => {
      // Block sync if backend is not healthy
      if (!isBackendHealthy()) {
        if (import.meta.env.DEV) {
          console.log('[BlossomContext] Skipping portfolio sync - backend offline');
        }
        return;
      }
      
      try {
        // Use explicit connect gating - only sync if user clicked "Connect Wallet"
        const userAddress = await getAddressIfExplicit();
        if (!userAddress) {
          // No wallet connected or not explicitly connected - reset to empty account
          if (import.meta.env.DEV) {
            console.log('[BlossomContext] No wallet connected (or not explicit), resetting to empty account');
          }
          setAccount(prev => ({
            ...prev,
            balances: [],
            accountValue: 0,
          }));
          return;
        }

        // Use the bulletproof /api/wallet/balances endpoint
        if (import.meta.env.DEV) {
          console.log('[BlossomContext] Fetching wallet balances for:', userAddress);
        }
        
        // Track fetch start time for instrumentation
        (window as any).__balanceFetchStart = performance.now();
        
        const response = await callAgent(`/api/wallet/balances?address=${encodeURIComponent(userAddress)}`, {
          method: 'GET',
        });

        if (!response.ok) {
          const errorText = await response.text();
          if (import.meta.env.DEV) {
            console.warn('[BlossomContext] Wallet balance fetch failed:', response.status, errorText);
          }
          
          // Handle structured error responses (503 with code)
          if (response.status === 503) {
            try {
              const errorData = JSON.parse(errorText);
              if (errorData.code) {
                // Dispatch custom event with error details for RightPanel
                const fetchDuration = Math.round(performance.now() - (window as any).__balanceFetchStart || 0);
                window.dispatchEvent(new CustomEvent('blossom-wallet-balance-error', {
                  detail: {
                    code: errorData.code,
                    message: errorData.message,
                    fix: errorData.fix,
                    duration: fetchDuration,
                    status: response.status,
                  },
                }));
              }
            } catch {
              // Not JSON, ignore
            }
          }
          return;
        }

        const data = await response.json();
        if (!isMounted) return;
        
        if (import.meta.env.DEV) {
          console.log('[BlossomContext] Wallet balance response:', {
            native: data.native?.formatted,
            tokens: data.tokens?.length || 0,
            notes: data.notes,
          });
        }
        
        // Dispatch success event so RightPanel can transition to CONNECTED_READY (with timing info)
        const fetchDuration = Math.round(performance.now() - (window as any).__balanceFetchStart || 0);
        window.dispatchEvent(new CustomEvent('blossom-wallet-balance-success', {
          detail: { duration: fetchDuration, status: response.status },
        }));

        // Fetch real ETH price from backend
        let ethPriceUsd = 3000; // Fallback
        try {
          const priceResponse = await callAgent('/api/prices/eth', { method: 'GET' });
          if (priceResponse.ok) {
            const priceData = await priceResponse.json();
            ethPriceUsd = priceData.priceUsd || 3000;
          }
        } catch {
          // Use fallback
        }

        // Calculate balances from new endpoint format
        const ethUsd = parseFloat(data.native?.formatted || '0') * ethPriceUsd;
        
        const newBalances: AssetBalance[] = [];
        
        // Add native ETH if > 0
        if (ethUsd > 0) {
          newBalances.push({ symbol: 'ETH', balanceUsd: ethUsd });
        }
        
        // Add demo tokens if present
        if (data.tokens && Array.isArray(data.tokens)) {
          for (const token of data.tokens) {
            if (token.symbol === 'REDACTED') {
              const usdcUsd = parseFloat(token.formatted || '0');
              if (usdcUsd > 0) {
                newBalances.push({ symbol: 'REDACTED', balanceUsd: usdcUsd });
              }
            } else if (token.symbol === 'WETH') {
              const wethUsd = parseFloat(token.formatted || '0') * ethPriceUsd;
              if (wethUsd > 0) {
                newBalances.push({ symbol: 'WETH', balanceUsd: wethUsd });
              }
            }
          }
        }

        // In eth_testnet mode (without forceDemoPortfolio), ONLY show real balances
        const accountValue = newBalances.reduce((sum, b) => sum + b.balanceUsd, 0);

        if (import.meta.env.DEV) {
          console.log('[BlossomContext] Wallet balances synced:', {
            userAddress,
            accountValue,
            balances: newBalances,
            nativeETH: data.native?.formatted,
            tokens: data.tokens?.length || 0,
            notes: data.notes,
          });
        }

        // Completely replace balances (no merging with demo balances)
        setAccount(prev => ({
          ...prev,
          balances: newBalances, // Only real balances, no demo
          accountValue,
        }));
      } catch (error: any) {
        if (import.meta.env.DEV) {
          console.warn('[BlossomContext] Portfolio sync error:', error.message);
        }
        // Silently fail - don't break the app if sync fails
      }
    };

    // Start backend health check loop
    healthCheckCleanup = startBackendHealthCheckLoop((healthy) => {
      if (healthy && isMounted) {
        // Backend came online - trigger immediate sync
        if (import.meta.env.DEV) {
          console.log('[BlossomContext] Backend came online, syncing portfolio');
        }
        syncPortfolio();
      }
    });

    // Initial sync on mount/wallet connect (only if backend is healthy)
    if (isBackendHealthy()) {
      syncPortfolio();
    }

    // Set up polling every 15 seconds (only when backend is healthy)
    const startPolling = () => {
      if (intervalId) clearInterval(intervalId);
      if (isBackendHealthy()) {
        intervalId = setInterval(() => {
          if (isBackendHealthy()) {
            syncPortfolio();
          } else {
            // Stop polling if backend goes offline
            if (intervalId) {
              clearInterval(intervalId);
              intervalId = null;
            }
          }
        }, 15000);
      }
    };
    
    startPolling();
    
    // Restart polling when backend health changes
    const healthChangeUnsubscribe = onBackendHealthChange((healthy) => {
      if (healthy) {
        startPolling();
        syncPortfolio(); // Immediate sync when backend comes online
      } else {
        // Stop polling when backend goes offline
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      }
    });
    
    // Listen for storage events (wallet connect/disconnect from other tabs)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'blossom_wallet_explicit_connected') {
        if (import.meta.env.DEV) {
          console.log('[BlossomContext] Wallet connection state changed (cross-tab), syncing portfolio');
        }
        if (isBackendHealthy()) {
          syncPortfolio();
        }
      }
    };
    
    // Listen for custom event (wallet connect/disconnect from same tab)
    const handleConnectionChange = () => {
      if (import.meta.env.DEV) {
        console.log('[BlossomContext] Wallet connection state changed (same-tab), syncing portfolio');
      }
      if (isBackendHealthy()) {
        syncPortfolio();
      }
    };
    
    // Listen for explicit disconnect event
    const handleDisconnect = () => {
      if (import.meta.env.DEV) {
        console.log('[BlossomContext] Wallet disconnected, clearing account state');
      }
      setAccount(EMPTY_ACCOUNT);
    };
    
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('blossom-wallet-connection-change', handleConnectionChange);
    window.addEventListener('blossom-wallet-disconnect', handleDisconnect);

    return () => {
      isMounted = false;
      if (intervalId) {
        clearInterval(intervalId);
      }
      if (healthCheckCleanup) {
        healthCheckCleanup();
      }
      healthChangeUnsubscribe();
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('blossom-wallet-connection-change', handleConnectionChange);
      window.removeEventListener('blossom-wallet-disconnect', handleDisconnect);
    };
  }, [executionMode, forceDemoPortfolio]); // Re-run if execution mode or forceDemoPortfolio changes

  return (
    <BlossomContext.Provider
      value={{
        strategies,
        addDraftStrategy,
        updateStrategyStatus,
        selectedStrategyId,
        setSelectedStrategyId,
        account,
        recomputeAccountFromStrategies,
        resetSim,
        activeTab,
        setActiveTab,
        onboarding,
        setOnboarding,
        lastRiskSnapshot,
        setLastRiskSnapshot,
    closeStrategy,
    autoCloseProfitableStrategies,
    closeEventStrategy,
    updateEventStake,
    updateStrategy,
    updatePerpSizeById,
    updatePerpTpSlById,
    updatePerpLeverageById,
    updateEventStakeById,
    updateEventSideById,
    updateDeFiDepositById,
        venue,
        setVenue,
        defiPositions,
        latestDefiProposal,
        createDefiPlanFromCommand,
        confirmDefiPlan,
        updateDeFiPlanDeposit,
        updateFromBackendPortfolio,
        getBaseAsset,
        chatSessions,
        activeChatId,
        createNewChatSession,
        setActiveChat,
        appendMessageToActiveChat,
        appendMessageToChat,
        updateMessageInChat,
        updateChatSessionTitle,
        deleteChatSession,
        riskProfile,
        updateRiskProfile,
        resetRiskProfileToDefault,
        manualWatchlist,
        addWatchAsset,
        removeWatchAsset,
        updateWatchAsset,
        derivePerpPositionsFromStrategies,
      }}
    >
      {children}
    </BlossomContext.Provider>
  );
}

