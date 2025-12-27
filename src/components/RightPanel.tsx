import { useState, useEffect } from 'react';
import { useBlossomContext, getOpenPositionsCount, isOpenEvent, isActiveDefi, Strategy, DefiPosition } from '../context/BlossomContext';
import { useActivityFeed } from '../context/ActivityFeedContext';
import PerpPositionEditor from './positions/PerpPositionEditor';
import EventPositionEditor from './positions/EventPositionEditor';
import PositionEditorCard from './PositionEditorCard';
import SectionHeader from './ui/SectionHeader';
import { ChevronDown, Clock } from 'lucide-react';

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
  
  // Auto-expand positions section if there are open positions
  const openPositionsCount = getOpenPositionsCount(strategies, defiPositions);
  
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
    // TODO: Implement fund functionality
    console.log('Fund clicked');
  };

  const handleSend = () => {
    // TODO: Implement send functionality
    console.log('Send clicked');
  };

  const handleSwap = () => {
    // TODO: Implement swap functionality
    console.log('Swap clicked');
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
          <div className="text-[11px] font-semibold tracking-[0.12em] text-slate-500 uppercase">WALLET</div>
          
          {/* Total Balance */}
          <div>
            <div className="text-xl font-semibold text-slate-900">
              ${account.accountValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div 
              className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-50 border border-slate-100"
              title="Prices are live. Order execution and venue/chain routing are simulated in this demo."
            >
              <span className="text-[10px] font-medium text-slate-600">Demo: execution simulated</span>
              <span className="text-[9px] text-slate-400">•</span>
              <span className="text-[9px] text-slate-400">Prices live • Routing simulated</span>
            </div>
          </div>

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
              className="flex-1 rounded-full border border-slate-200 bg-slate-50 text-xs font-medium text-slate-700 hover:bg-pink-50 hover:border-pink-200 transition py-2"
            >
              Fund
            </button>
            <button
              onClick={handleSend}
              className="flex-1 rounded-full border border-slate-200 bg-slate-50 text-xs font-medium text-slate-700 hover:bg-pink-50 hover:border-pink-200 transition py-2"
            >
              Send
            </button>
            <button
              onClick={handleSwap}
              className="flex-1 rounded-full border border-slate-200 bg-slate-50 text-xs font-medium text-slate-700 hover:bg-pink-50 hover:border-pink-200 transition py-2"
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

