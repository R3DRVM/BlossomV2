import { useState, useEffect } from 'react';
import { useBlossomContext } from '../context/BlossomContext';
import type { Strategy, DefiPosition } from '../context/BlossomContext';
import { USE_AGENT_BACKEND } from '../lib/config';
import { closeStrategy as closeStrategyApi } from '../lib/blossomApi';
import { useToast } from './toast/useToast';

interface PositionsTrayProps {
  defaultOpen?: boolean;
}

type TrayTab = 'perps' | 'defi' | 'events';

// Feature flag: Set to true to enable Positions Tray (currently disabled in favor of Strategy Drawer)
const ENABLE_POSITIONS_TRAY = false;

export default function PositionsTray({ defaultOpen = false }: PositionsTrayProps) {
  // If disabled, don't render anything
  if (!ENABLE_POSITIONS_TRAY) {
    return null;
  }
  const { strategies, defiPositions, closeStrategy, closeEventStrategy, updateFromBackendPortfolio, updateDeFiPlanDeposit, updateEventStake, updateStrategy, account } = useBlossomContext();
  const { showToast } = useToast();
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [activeTab, setActiveTab] = useState<TrayTab>('perps');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingMode, setEditingMode] = useState<{ id: string; mode: 'tpSl' | 'leverage' | 'size' | 'eventStake' | 'defiDeposit' } | null>(null);
  const [editValues, setEditValues] = useState<{ takeProfit?: number; stopLoss?: number; leverage?: number; size?: number; stake?: number }>({});

  // Get active positions (same logic as ContextualPanel)
  const activePerps = strategies.filter(s => 
    s.instrumentType === 'perp' && 
    (s.status === 'executed' || s.status === 'executing') && 
    !s.isClosed
  );
  
  const activeEvents = strategies.filter(s => 
    s.instrumentType === 'event' && 
    (s.status === 'executed' || s.status === 'executing') && 
    !s.isClosed
  );
  
  const activeDefi = defiPositions.filter(p => p.status === 'active');
  const proposedDefi = defiPositions.filter(p => p.status === 'proposed');

  const perpsCount = activePerps.length;
  const defiCount = activeDefi.length + proposedDefi.length;
  const eventsCount = activeEvents.length;
  const totalCount = perpsCount + defiCount + eventsCount;

  // Auto-open when positions are created (first time going from 0 to >0)
  const [wasAnyOpen, setWasAnyOpen] = useState(false);
  const anyOpen = totalCount > 0;

  useEffect(() => {
    if (!wasAnyOpen && anyOpen) {
      setIsOpen(true);
      // Auto-select the tab with positions
      if (perpsCount > 0) setActiveTab('perps');
      else if (defiCount > 0) setActiveTab('defi');
      else if (eventsCount > 0) setActiveTab('events');
    }
    setWasAnyOpen(anyOpen);
  }, [anyOpen, wasAnyOpen, perpsCount, defiCount, eventsCount]);

  // Handle defaultOpen prop
  useEffect(() => {
    if (defaultOpen) {
      setIsOpen(true);
      // Auto-select the tab with positions
      if (perpsCount > 0) setActiveTab('perps');
      else if (defiCount > 0) setActiveTab('defi');
      else if (eventsCount > 0) setActiveTab('events');
    }
  }, [defaultOpen, perpsCount, defiCount, eventsCount]);

  const hasAny = totalCount > 0;
  const pillLabel = hasAny
    ? `Perps ${perpsCount} • DeFi ${defiCount} • Events ${eventsCount}`
    : 'No notifications yet';

  // Collapsed pill
  if (!isOpen) {
    return (
      <div className="hidden lg:block absolute bottom-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-1rem)]">
        <button
          onClick={() => setIsOpen(true)}
          className="w-full flex items-center justify-between gap-2 rounded-full bg-white/90 backdrop-blur-sm border border-slate-200 shadow-sm px-3 py-1.5 text-[11px] text-slate-700 hover:bg-pink-50/80 hover:border-pink-200 transition-all"
        >
          <span className="font-semibold tracking-[0.12em] uppercase text-[10px] text-slate-500">
            Notifications
          </span>
          <span className="text-[11px] text-slate-700">
            {pillLabel}
          </span>
        </button>
      </div>
    );
  }

  // Expanded panel
  const tabs: { key: TrayTab; label: string; count: number }[] = [
    { key: 'perps', label: 'Perps', count: perpsCount },
    { key: 'defi', label: 'DeFi', count: defiCount },
    { key: 'events', label: 'Events', count: eventsCount },
  ];

  const handleClosePerp = async (strategy: Strategy) => {
    if (USE_AGENT_BACKEND) {
      try {
        const response = await closeStrategyApi({
          strategyId: strategy.id,
          type: 'perp',
        });
        updateFromBackendPortfolio(response.portfolio);
      } catch (error: any) {
        console.error('Failed to close position:', error);
        // Error is logged to console, user can see it in dev tools
      }
    } else {
      closeStrategy(strategy.id);
    }
  };

  const handleEditTpSl = (strategy: Strategy) => {
    setEditingMode({ id: strategy.id, mode: 'tpSl' });
    setEditValues({ takeProfit: strategy.takeProfit, stopLoss: strategy.stopLoss });
  };

  const handleChangeLeverage = (strategy: Strategy) => {
    // Calculate leverage from TP/SL spread
    const spread = Math.abs(strategy.takeProfit - strategy.stopLoss);
    const leverage = spread > 0 ? Math.round((spread / strategy.entry) * 10) : 1;
    setEditingMode({ id: strategy.id, mode: 'leverage' });
    setEditValues({ leverage });
  };

  const handleAdjustSize = (strategy: Strategy) => {
    setEditingMode({ id: strategy.id, mode: 'size' });
    setEditValues({ size: strategy.riskPercent });
  };

  const handleSaveEdit = (strategy: Strategy) => {
    if (!editingMode) return;
    
    if (editingMode.mode === 'tpSl') {
      if (editValues.takeProfit !== undefined && editValues.stopLoss !== undefined) {
        updateStrategy(strategy.id, {
          takeProfit: editValues.takeProfit,
          stopLoss: editValues.stopLoss,
        });
      }
    } else if (editingMode.mode === 'leverage') {
      if (editValues.leverage !== undefined) {
        // Adjust TP/SL based on new leverage
        const spread = (strategy.entry * editValues.leverage) / 10;
        const newTakeProfit = strategy.side === 'Long' 
          ? strategy.entry + spread / 2
          : strategy.entry - spread / 2;
        const newStopLoss = strategy.side === 'Long'
          ? strategy.entry - spread / 2
          : strategy.entry + spread / 2;
        updateStrategy(strategy.id, {
          takeProfit: Math.round(newTakeProfit),
          stopLoss: Math.round(newStopLoss),
        });
      }
    } else if (editingMode.mode === 'size') {
      if (editValues.size !== undefined) {
        const newNotional = (account.accountValue * editValues.size) / 100;
        updateStrategy(strategy.id, {
          riskPercent: editValues.size,
          notionalUsd: newNotional,
        });
      }
    } else if (editingMode.mode === 'eventStake') {
      if (editValues.stake !== undefined && strategy.instrumentType === 'event') {
        const maxEventRiskPct = 0.03;
        const maxStakeUsd = Math.round(account.accountValue * maxEventRiskPct);
        const newStakeUsd = Math.min(editValues.stake, maxStakeUsd);
        const maxPayoutUsd = newStakeUsd * ((strategy.maxPayoutUsd || 0) / (strategy.stakeUsd || 1));
        const riskPct = (newStakeUsd / account.accountValue) * 100;
        updateEventStake(strategy.id, {
          stakeUsd: newStakeUsd,
          maxPayoutUsd,
          maxLossUsd: newStakeUsd,
          riskPercent: riskPct,
        });
      }
    }
    
    setEditingMode(null);
    setEditValues({});
  };

  const handleCancelEdit = () => {
    setEditingMode(null);
    setEditValues({});
  };

  const handleCloseEvent = async (strategy: Strategy) => {
    if (USE_AGENT_BACKEND) {
      try {
        const response = await closeStrategyApi({
          strategyId: strategy.id,
          type: 'event',
        });
        updateFromBackendPortfolio(response.portfolio);
        showToast({
          title: 'Event settled',
          description: 'Your event position has been closed and balances updated.',
          variant: 'success',
        });
      } catch (error: any) {
        console.error('Failed to close position:', error);
        // Error is logged to console, user can see it in dev tools
      }
    } else {
      // Use closeEventStrategy for proper event settlement (handles PnL, wallet updates, etc.)
      closeEventStrategy(strategy.id);
      showToast({
        title: 'Event settled',
        description: 'Your event position has been closed and balances updated.',
        variant: 'success',
      });
    }
  };

  const handleEditDefiDeposit = (defi: DefiPosition) => {
    setEditingMode({ id: defi.id, mode: 'defiDeposit' as any });
    setEditValues({ size: defi.depositUsd });
  };

  const handleWithdrawDefi = (defi: DefiPosition) => {
    if (window.confirm(`Withdraw all ${defi.depositUsd.toLocaleString()} from ${defi.protocol}?`)) {
      updateDeFiPlanDeposit(defi.id, 0);
    }
  };

  const renderPositionRow = (position: Strategy | DefiPosition, type: 'perp' | 'event' | 'defi') => {
    if (type === 'defi') {
      const defi = position as DefiPosition;
      const isExpanded = expandedId === defi.id;
      const isProposed = defi.status === 'proposed';
      
      return (
        <div
          key={defi.id}
          className="mx-2 mb-2 rounded-xl border border-slate-100 bg-white/90 px-3 py-2.5 cursor-pointer hover:border-pink-200 hover:bg-pink-50/40 transition"
          onClick={() => setExpandedId(isExpanded ? null : defi.id)}
        >
          <div className="flex items-center justify-between text-xs text-slate-800">
            <span className="font-semibold truncate">
              {defi.protocol} {defi.asset}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-500">
                ${defi.depositUsd.toLocaleString()} • {defi.apyPct.toFixed(1)}% APY
              </span>
              {isProposed && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium text-slate-500 bg-slate-100 rounded">
                  Pending
                </span>
              )}
            </div>
          </div>

          {isExpanded && (
            <div className="mt-2 border-t border-slate-100 pt-2">
              <div className="space-y-1.5 text-[11px] text-slate-600">
                <div className="flex justify-between">
                  <span className="text-slate-500">Protocol:</span>
                  <span className="font-medium text-slate-900">{defi.protocol}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Asset:</span>
                  <span className="font-medium text-slate-900">{defi.asset}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">APY:</span>
                  <span className="font-medium text-emerald-600">{defi.apyPct.toFixed(1)}%</span>
                </div>
                {!isProposed && (
                  <div className="flex flex-wrap gap-1.5 pt-2">
                    <button
                      className="rounded-full border border-slate-200 px-3 py-1 text-[11px] hover:bg-slate-50 transition-colors"
                      onClick={(e) => { e.stopPropagation(); handleEditDefiDeposit(defi); }}
                    >
                      Edit deposit
                    </button>
                    <button
                      className="rounded-full border border-slate-200 px-3 py-1 text-[11px] hover:bg-slate-50 transition-colors"
                      onClick={(e) => { e.stopPropagation(); handleWithdrawDefi(defi); }}
                    >
                      Withdraw
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      );
    }

    const strategy = position as Strategy;
    const isPerp = type === 'perp';
    const isExpanded = expandedId === strategy.id;
    const pnl = strategy.realizedPnlUsd ?? 0;
    const pnlPct = strategy.realizedPnlPct ?? 0;
    const pnlSign = pnl >= 0 ? '+' : '';
    const leverage = Math.round((strategy.takeProfit - strategy.stopLoss) / strategy.entry * 10);

    return (
      <div
        key={strategy.id}
        className="mx-2 mb-2 rounded-xl border border-slate-100 bg-white/90 px-3 py-2.5 cursor-pointer hover:border-pink-200 hover:bg-pink-50/40 transition"
        onClick={() => setExpandedId(isExpanded ? null : strategy.id)}
      >
        <div className="flex items-center justify-between text-xs text-slate-800">
          <span className="font-semibold truncate">
            {strategy.market} {isPerp ? `· ${strategy.side}` : ''}
          </span>
          <span className="text-[11px] text-slate-500">
            {isPerp ? (
              <>Entry: ${strategy.entry.toLocaleString()} · Size: ${(strategy.notionalUsd || 0).toLocaleString()}</>
            ) : (
              <>Stake: ${(strategy.stakeUsd || 0).toLocaleString()} · Side: {strategy.eventSide || strategy.side}</>
            )}
          </span>
        </div>
        {pnl !== 0 && (
          <div className={`text-[11px] font-medium mt-1 ${pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
            {pnlSign}${Math.abs(pnl).toLocaleString()} ({pnlSign}{Math.abs(pnlPct).toFixed(1)}%)
          </div>
        )}

        {isExpanded && (
          <div className="mt-2 border-t border-slate-100 pt-2">
            <div className="space-y-1.5 text-[11px] text-slate-600">
              {isPerp ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Risk:</span>
                    <span className="font-medium text-slate-900">{strategy.riskPercent}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Leverage:</span>
                    <span className="font-medium text-slate-900">{leverage}x</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Take Profit:</span>
                    <span className="font-medium text-emerald-600">${strategy.takeProfit.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Stop Loss:</span>
                    <span className="font-medium text-rose-600">${strategy.stopLoss.toLocaleString()}</span>
                  </div>
                  {strategy.status === 'executed' && (
                    <div className="flex justify-between pt-1 border-t border-slate-100">
                      <span className="text-slate-500">Current PnL (Sim):</span>
                      <span className={`font-medium ${pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {pnlSign}${Math.abs(pnl).toLocaleString()} ({pnlSign}{Math.abs(pnlPct).toFixed(1)}%)
                      </span>
                    </div>
                  )}
                  {strategy.status === 'executed' && !strategy.isClosed && (
                    <>
                      {editingMode?.id === strategy.id && editingMode.mode === 'tpSl' ? (
                        <div className="mt-2 pt-2 border-t border-slate-200 bg-pink-50/40 rounded-lg px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <div className="space-y-2">
                            <div>
                              <label className="text-[10px] text-slate-600 mb-1 block">Take Profit</label>
                              <input
                                type="number"
                                value={editValues.takeProfit || strategy.takeProfit}
                                onChange={(e) => setEditValues({ ...editValues, takeProfit: parseFloat(e.target.value) || 0 })}
                                className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs bg-white"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-600 mb-1 block">Stop Loss</label>
                              <input
                                type="number"
                                value={editValues.stopLoss || strategy.stopLoss}
                                onChange={(e) => setEditValues({ ...editValues, stopLoss: parseFloat(e.target.value) || 0 })}
                                className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs bg-white"
                              />
                            </div>
                            <div className="flex gap-2 pt-1">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleSaveEdit(strategy); }}
                                className="flex-1 rounded-full bg-pink-500 text-white px-3 py-1.5 text-[11px] hover:bg-pink-600 transition-colors"
                              >
                                Save
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleCancelEdit(); }}
                                className="flex-1 rounded-full border border-slate-200 px-3 py-1.5 text-[11px] hover:bg-slate-50 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : editingMode?.id === strategy.id && editingMode.mode === 'leverage' ? (
                        <div className="mt-2 pt-2 border-t border-slate-200 bg-pink-50/40 rounded-lg px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <div className="space-y-2">
                            <div>
                              <label className="text-[10px] text-slate-600 mb-1 block">Leverage (1x-5x)</label>
                              <input
                                type="number"
                                min="1"
                                max="5"
                                step="0.1"
                                value={editValues.leverage || leverage}
                                onChange={(e) => setEditValues({ ...editValues, leverage: parseFloat(e.target.value) || 1 })}
                                className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs bg-white"
                              />
                            </div>
                            <div className="flex gap-2 pt-1">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleSaveEdit(strategy); }}
                                className="flex-1 rounded-full bg-pink-500 text-white px-3 py-1.5 text-[11px] hover:bg-pink-600 transition-colors"
                              >
                                Save
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleCancelEdit(); }}
                                className="flex-1 rounded-full border border-slate-200 px-3 py-1.5 text-[11px] hover:bg-slate-50 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : editingMode?.id === strategy.id && editingMode.mode === 'size' ? (
                        <div className="mt-2 pt-2 border-t border-slate-200 bg-pink-50/40 rounded-lg px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <div className="space-y-2">
                            <div>
                              <label className="text-[10px] text-slate-600 mb-1 block">Size (% of account)</label>
                              <input
                                type="number"
                                min="0.1"
                                max="10"
                                step="0.1"
                                value={editValues.size || strategy.riskPercent}
                                onChange={(e) => setEditValues({ ...editValues, size: parseFloat(e.target.value) || 0 })}
                                className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs bg-white"
                              />
                            </div>
                            <div className="flex gap-2 pt-1">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleSaveEdit(strategy); }}
                                className="flex-1 rounded-full bg-pink-500 text-white px-3 py-1.5 text-[11px] hover:bg-pink-600 transition-colors"
                              >
                                Save
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleCancelEdit(); }}
                                className="flex-1 rounded-full border border-slate-200 px-3 py-1.5 text-[11px] hover:bg-slate-50 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 pt-2">
                          <button
                            className="rounded-full border border-slate-200 px-3 py-1 text-[11px] hover:bg-slate-50 transition-colors"
                            onClick={(e) => { e.stopPropagation(); handleEditTpSl(strategy); }}
                          >
                            Edit TP/SL
                          </button>
                          <button
                            className="rounded-full border border-slate-200 px-3 py-1 text-[11px] hover:bg-slate-50 transition-colors"
                            onClick={(e) => { e.stopPropagation(); handleChangeLeverage(strategy); }}
                          >
                            Change leverage
                          </button>
                          <button
                            className="rounded-full border border-slate-200 px-3 py-1 text-[11px] hover:bg-slate-50 transition-colors"
                            onClick={(e) => { e.stopPropagation(); handleAdjustSize(strategy); }}
                          >
                            Adjust size
                          </button>
                          <button
                            className="rounded-full bg-pink-500 text-white px-3 py-1 text-[11px] hover:bg-pink-600 transition-colors"
                            onClick={(e) => { e.stopPropagation(); handleClosePerp(strategy); }}
                          >
                            Close & take profit
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Stake:</span>
                    <span className="font-medium text-slate-900">${(strategy.stakeUsd || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Max Payout:</span>
                    <span className="font-medium text-emerald-600">${(strategy.maxPayoutUsd || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Max Loss:</span>
                    <span className="font-medium text-rose-600">${(strategy.maxLossUsd || strategy.stakeUsd || 0).toLocaleString()}</span>
                  </div>
                  {strategy.status === 'executed' && !strategy.isClosed && (
                    <>
                      {editingMode?.id === strategy.id && editingMode.mode === 'eventStake' ? (
                        <div className="mt-2 pt-2 border-t border-slate-200 bg-pink-50/40 rounded-lg px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <div className="space-y-2">
                            <div>
                              <label className="text-[10px] text-slate-600 mb-1 block">Stake (USD)</label>
                              <input
                                type="number"
                                min="0"
                                value={editValues.stake || strategy.stakeUsd || 0}
                                onChange={(e) => setEditValues({ ...editValues, stake: parseFloat(e.target.value) || 0 })}
                                className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs bg-white"
                              />
                              <div className="text-[10px] text-slate-500 mt-1">Max: ${Math.round(account.accountValue * 0.03).toLocaleString()} (3% cap)</div>
                            </div>
                            <div className="flex gap-2 pt-1">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleSaveEdit(strategy); }}
                                className="flex-1 rounded-full bg-pink-500 text-white px-3 py-1.5 text-[11px] hover:bg-pink-600 transition-colors"
                              >
                                Save
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleCancelEdit(); }}
                                className="flex-1 rounded-full border border-slate-200 px-3 py-1.5 text-[11px] hover:bg-slate-50 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 pt-2">
                          <button
                            className="rounded-full border border-slate-200 px-3 py-1 text-[11px] hover:bg-slate-50 transition-colors"
                            onClick={(e) => { e.stopPropagation(); setEditingMode({ id: strategy.id, mode: 'eventStake' }); setEditValues({ stake: strategy.stakeUsd || 0 }); }}
                          >
                            Edit stake
                          </button>
                          <button
                            className="rounded-full bg-pink-500 text-white px-3 py-1 text-[11px] hover:bg-pink-600 transition-colors"
                            onClick={(e) => { e.stopPropagation(); handleCloseEvent(strategy); }}
                          >
                            Close & settle
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const getCurrentPositions = () => {
    if (activeTab === 'perps') return activePerps;
    if (activeTab === 'defi') return [...proposedDefi, ...activeDefi];
    if (activeTab === 'events') return activeEvents;
    return [];
  };

  const currentPositions = getCurrentPositions();

  return (
    <div className="hidden lg:block absolute bottom-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-1rem)]">
      <div className="w-full max-h-[55vh] rounded-2xl border border-slate-100 bg-white shadow-lg flex flex-col overflow-y-auto transition-all duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-white/95 backdrop-blur-sm flex-shrink-0">
          <div className="flex flex-col">
            <span className="text-[11px] font-semibold tracking-[0.16em] text-slate-500 uppercase">
              Notifications
            </span>
            <span className="text-xs text-slate-400 mt-0.5">
              Perps {perpsCount} • DeFi {defiCount} • Events {eventsCount}
            </span>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="rounded-full px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100/70 transition-colors"
          >
            Hide
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-3 pt-2 pb-1 text-[11px] bg-white/95 backdrop-blur-sm flex-shrink-0">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1 rounded-full border text-[11px] transition-colors ${
                activeTab === tab.key
                  ? 'border-pink-200 bg-pink-50 text-slate-900 font-medium'
                  : 'border-transparent text-slate-500 hover:bg-slate-50'
              }`}
            >
              {tab.label} {tab.count > 0 && <span className="ml-1 text-[10px] text-slate-400">({tab.count})</span>}
            </button>
          ))}
        </div>

        {/* Positions List */}
        <div className="flex-1 overflow-y-auto min-h-0 bg-slate-50/50">
          {currentPositions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center px-4">
              {activeTab === 'perps' ? (
                <div className="text-[11px] text-slate-500 leading-relaxed">
                  No open perp positions yet. Ask Blossom to open a trade to see it here.
                </div>
              ) : activeTab === 'defi' ? (
                <div className="text-[11px] text-slate-500 leading-relaxed">
                  No active DeFi plans yet. Ask Blossom to build a yield plan.
                </div>
              ) : (
                <div className="text-[11px] text-slate-500 leading-relaxed">
                  No event market stakes yet. Ask Blossom to place a view on an event.
                </div>
              )}
            </div>
          ) : (
            <div className="py-1">
              {currentPositions.map((pos) => {
                if (activeTab === 'defi') {
                  return renderPositionRow(pos as DefiPosition, 'defi');
                } else if (activeTab === 'perps') {
                  return renderPositionRow(pos as Strategy, 'perp');
                } else {
                  return renderPositionRow(pos as Strategy, 'event');
                }
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

