import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { mapBackendPortfolioToFrontendState } from '../lib/portfolioMapping';
import { USE_AGENT_BACKEND } from '../lib/config';
import { derivePerpPositionsFromStrategies } from '../lib/derivePerpPositions';

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
  instrumentType?: 'perp' | 'event';
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
  marketsList?: Array<{
    id: string;
    title: string;
    yesPrice: number;
    noPrice: number;
    volume24hUsd?: number;
    source: 'polymarket' | 'kalshi' | 'static';
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
  createDefiPlanFromCommand: (command: string) => DefiPosition;
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
  { symbol: 'USDC', balanceUsd: 4000 },
  { symbol: 'ETH', balanceUsd: 3000 },
  { symbol: 'SOL', balanceUsd: 3000 },
];

const INITIAL_ACCOUNT: AccountState = {
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
export function computePerpFromRisk(params: {
  accountValue: number;
  riskPercent: number;
  leverage: number;
}): { marginUsd: number; notionalUsd: number } {
  const { accountValue, riskPercent, leverage } = params;
  // Risk amount in USD = accountValue * riskPercent / 100
  // With leverage, margin = risk amount / leverage
  const marginUsd = (accountValue * riskPercent / 100) / leverage;
  const notionalUsd = marginUsd * leverage;
  return { marginUsd: Math.round(marginUsd), notionalUsd: Math.round(notionalUsd) };
}

// Helper to apply executed strategy to balances
function applyExecutedStrategyToBalances(
  currentAccount: AccountState,
  strategy: Strategy
): AccountState {
  const notional = (currentAccount.accountValue * strategy.riskPercent) / 100;
  const baseAsset = getBaseAsset(strategy.market);
  
  // Find USDC balance
  const usdcBalance = currentAccount.balances.find(b => b.symbol === 'USDC');
  const availableUsdc = usdcBalance?.balanceUsd || 0;
  
  // Clamp notional to available USDC
  const actualNotional = Math.min(notional, availableUsdc);
  
  if (actualNotional <= 0) {
    // Insufficient USDC - return unchanged
    return currentAccount;
  }
  
  // Update balances
  const newBalances = currentAccount.balances.map(balance => {
    if (balance.symbol === 'USDC') {
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
            const usdcBalance = account.balances.find(b => b.symbol === 'USDC');
            const availableUsdc = usdcBalance?.balanceUsd || 0;
            computedStake = Math.min(stake, availableUsdc);
          } else {
            computedStake = strategyToUpdate.stakeUsd;
          }
        } else {
          // For perps, compute notional
          if (!strategyToUpdate.notionalUsd) {
            const notional = (account.accountValue * strategyToUpdate.riskPercent) / 100;
            const usdcBalance = account.balances.find(b => b.symbol === 'USDC');
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
              const usdcBalance = current.balances.find(b => b.symbol === 'USDC');
              if (!usdcBalance || usdcBalance.balanceUsd < executedStrategy.stakeUsd!) {
                return current;
              }
              
              const newBalances = current.balances.map(b =>
                b.symbol === 'USDC' 
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
          if (balance.symbol === 'USDC') {
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
          if (balance.symbol === 'USDC') {
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

  const createDefiPlanFromCommand = useCallback((command: string): DefiPosition => {
    const idleUsdc = account.balances.find(b => b.symbol === 'USDC')?.balanceUsd || 3000;
    const depositUsd = Math.min(idleUsdc * 0.5, 2000);

    let protocol = 'RootsFi';
    let apyPct = 6.4;
    const lowerCommand = command.toLowerCase();

    if (lowerCommand.includes('kamino')) {
      protocol = 'Kamino';
      apyPct = 8.5;
    } else if (lowerCommand.includes('jet')) {
      protocol = 'Jet';
      apyPct = 7.2;
    }

    const newPosition: DefiPosition = {
      id: Date.now().toString(),
      command,
      protocol,
      asset: 'USDC yield vault',
      depositUsd,
      apyPct,
      status: 'proposed',
      createdAt: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    };

    setLatestDefiProposal(newPosition);
    setDefiPositions(prev => [newPosition, ...prev]);
    return newPosition;
  }, [account.balances]);

  const confirmDefiPlan = useCallback((id: string) => {
    setDefiPositions(prev => {
      const position = prev.find(p => p.id === id);
      if (!position || position.status === 'active') {
        return prev;
      }

      // Update account balances - DeFi deposit is a zero-sum reallocation: USDC → DEFI
      setAccount(current => {
        const usdcBalance = current.balances.find(b => b.symbol === 'USDC');
        if (!usdcBalance || usdcBalance.balanceUsd < position.depositUsd) {
          // Insufficient USDC - don't proceed
          return current;
        }

        // Subtract from USDC
        const newBalances = current.balances.map(balance => {
          if (balance.symbol === 'USDC') {
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
  }, [latestDefiProposal]);

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
        const usdcBalance = current.balances.find(b => b.symbol === 'USDC');
        const defiBalance = current.balances.find(b => b.symbol === 'DEFI');

        if (!usdcBalance) {
          return current; // Can't update without USDC balance
        }

        // Ensure DEFI balance exists
        if (!defiBalance) {
          // This shouldn't happen for active positions, but handle it gracefully
          return current;
        }

        // Validate sufficient balance for increase
        if (depositDelta > 0 && usdcBalance.balanceUsd < depositDelta) {
          return current; // Insufficient USDC
        }

        // Validate sufficient DEFI for decrease
        if (depositDelta < 0 && defiBalance.balanceUsd < Math.abs(depositDelta)) {
          return current; // Insufficient DEFI to refund
        }

        // Apply delta: move funds between USDC and DEFI
        const newBalances = current.balances.map(balance => {
          if (balance.symbol === 'USDC') {
            // If increasing deposit: subtract from USDC
            // If decreasing deposit: add to USDC (refund)
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
    const mapped = mapBackendPortfolioToFrontendState(portfolio);
    setAccount(mapped.account);
    setStrategies(mapped.strategies);
    setDefiPositions(mapped.defiPositions);
  }, []);

  const resetSim = useCallback(async () => {
    if (USE_AGENT_BACKEND) {
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
  }, [updateFromBackendPortfolio, setChatSessions, setActiveChatId]);

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

