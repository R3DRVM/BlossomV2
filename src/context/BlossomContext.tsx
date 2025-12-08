import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { mapBackendPortfolioToFrontendState } from '../lib/portfolioMapping';
import { USE_AGENT_BACKEND } from '../lib/config';

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
  isClosed: boolean;
  closedAt?: string;
  realizedPnlUsd?: number;
  realizedPnlPct?: number;
  instrumentType?: 'perp' | 'event';
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
  venue: Venue;
  setVenue: (v: Venue) => void;
  defiPositions: DefiPosition[];
  latestDefiProposal: DefiPosition | null;
  createDefiPlanFromCommand: (command: string) => DefiPosition;
  confirmDefiPlan: (id: string) => void;
  updateDeFiPlanDeposit: (id: string, newDepositUsd: number) => void;
  updateFromBackendPortfolio: (portfolio: any) => void; // For agent mode
  getBaseAsset: (market: string) => string;
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
  }, [updateFromBackendPortfolio]);

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
        venue,
        setVenue,
        defiPositions,
        latestDefiProposal,
        createDefiPlanFromCommand,
        confirmDefiPlan,
        updateDeFiPlanDeposit,
        updateFromBackendPortfolio,
        getBaseAsset,
      }}
    >
      {children}
    </BlossomContext.Provider>
  );
}

