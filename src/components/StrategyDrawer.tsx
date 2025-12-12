import { useState, useEffect, useRef } from 'react';
import { useBlossomContext, Strategy, DefiPosition, AccountState, isOpenPerp, isOpenEvent, isActiveDefi, getOpenPositionsCount } from '../context/BlossomContext';
import { X } from 'lucide-react';
import RiskBadge from './RiskBadge';

type DrawerTab = 'all' | 'perps' | 'defi' | 'events';

interface StrategyDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  highlightedStrategyId?: string | null;
}

export default function StrategyDrawer({ isOpen, onClose, highlightedStrategyId }: StrategyDrawerProps) {
  const {
    strategies,
    defiPositions,
    closeStrategy,
    closeEventStrategy,
    updatePerpSizeById,
    updatePerpTpSlById,
    updatePerpLeverageById,
    updateEventStakeById,
    updateEventSideById,
    updateDeFiDepositById,
    account,
  } = useBlossomContext();

  const [activeTab, setActiveTab] = useState<DrawerTab>('all');
  const highlightedRef = useRef<HTMLDivElement>(null);

  // Filter active strategies using shared helpers
  const activePerps = strategies.filter(isOpenPerp);
  const activeEvents = strategies.filter(isOpenEvent);
  const activeDefi = defiPositions.filter(isActiveDefi);
  
  // Get total open positions count
  const openPositionsCount = getOpenPositionsCount(strategies, defiPositions);

  // Get displayed strategies based on tab
  const getDisplayedStrategies = () => {
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

  // Scroll to highlighted strategy when drawer opens
  useEffect(() => {
    if (isOpen && highlightedStrategyId && highlightedRef.current) {
      setTimeout(() => {
        highlightedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
  }, [isOpen, highlightedStrategyId]);

  const handleCloseStrategy = (strategy: Strategy) => {
    if (strategy.instrumentType === 'event') {
      closeEventStrategy(strategy.id);
    } else {
      closeStrategy(strategy.id);
    }
  };


  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 transition-opacity"
        onClick={onClose}
      />
      
      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Open positions ({openPositionsCount})
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex-shrink-0 border-b border-slate-200 px-6">
          <div className="flex gap-1 -mb-px">
            {(['all', 'perps', 'defi', 'events'] as DrawerTab[]).map(tab => {
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
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-2 text-xs font-medium transition-colors border-b-2 ${
                    activeTab === tab
                      ? 'border-pink-500 text-slate-900'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  {count > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.5 bg-slate-100 rounded text-[10px]">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {getDisplayedStrategies().length === 0 ? (
            <div className="text-center py-12 px-4">
              <h3 className="text-base font-semibold text-slate-900 mb-2">No open positions yet</h3>
              <p className="text-sm text-slate-500 mb-4">
                Start by asking me to open a trade, for example:
              </p>
              <div className="space-y-2 mb-4 text-left max-w-sm mx-auto">
                <div className="text-xs text-slate-600">– "Long ETH with 2% risk"</div>
                <div className="text-xs text-slate-600">– "Park my idle USDC in yield"</div>
                <div className="text-xs text-slate-600">– "Bet 500 on the US election"</div>
              </div>
              <button
                onClick={() => {
                  // Dispatch event to insert prompt into chat
                  window.dispatchEvent(new CustomEvent('insertChatPrompt', { detail: { prompt: 'Long ETH with 2% risk' } }));
                  onClose();
                }}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Insert a starter prompt
              </button>
            </div>
          ) : (
            getDisplayedStrategies().map((item) => {
              const isHighlighted = highlightedStrategyId === (item as Strategy).id;
              const isPerp = 'instrumentType' in item && item.instrumentType === 'perp';
              const isEvent = 'instrumentType' in item && item.instrumentType === 'event';
              const isDefi = 'protocol' in item;

              const itemId = isDefi ? (item as DefiPosition).id : (item as Strategy).id;

              return (
                <div
                  key={itemId}
                  ref={isHighlighted ? highlightedRef : null}
                  className={`rounded-lg border p-4 transition-all group ${
                    isHighlighted
                      ? 'border-pink-500 bg-pink-50/50 shadow-md'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                  }`}
                >
                  {isPerp && (
                    <PerpStrategyCard
                      strategy={item as Strategy}
                      onClose={(e) => {
                        e.stopPropagation();
                        handleCloseStrategy(item as Strategy);
                      }}
                      onUpdateSize={(newSize) => {
                        updatePerpSizeById((item as Strategy).id, newSize);
                      }}
                      onUpdateTpSl={(newTp, newSl) => {
                        updatePerpTpSlById((item as Strategy).id, newTp, newSl);
                      }}
                      onUpdateLeverage={(newLeverage) => {
                        updatePerpLeverageById((item as Strategy).id, newLeverage);
                      }}
                    />
                  )}
                  {isEvent && (
                    <EventStrategyCard
                      strategy={item as Strategy}
                      onClose={(e) => {
                        e.stopPropagation();
                        handleCloseStrategy(item as Strategy);
                      }}
                      onUpdateStake={(newStake) => {
                        updateEventStakeById((item as Strategy).id, newStake);
                      }}
                      onUpdateSide={(newSide) => {
                        updateEventSideById((item as Strategy).id, newSide);
                      }}
                    />
                  )}
                  {isDefi && (
                    <DefiStrategyCard
                      position={item as DefiPosition}
                      account={account}
                      onUpdateDeposit={(newDeposit) => {
                        updateDeFiDepositById((item as DefiPosition).id, newDeposit);
                      }}
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}

function PerpStrategyCard({
  strategy,
  onClose,
  onUpdateSize,
  onUpdateTpSl,
  onUpdateLeverage,
}: {
  strategy: Strategy;
  onClose: (e: React.MouseEvent) => void;
  onUpdateSize: (newSize: number) => void;
  onUpdateTpSl: (newTp: number, newSl: number) => void;
  onUpdateLeverage: (newLeverage: number) => void;
}) {
  const [sizeInput, setSizeInput] = useState('');
  const [isUpdatingSize, setIsUpdatingSize] = useState(false);
  const [updateSizeSuccess, setUpdateSizeSuccess] = useState(false);
  
  // Discrete leverage ticks - slider only allows these values
  const LEVERAGE_TICKS = [1, 3, 5, 10, 15, 20] as const;
  
  // Helper to derive leverage from TP/SL (for legacy positions or when TP/SL are edited directly)
  const deriveLeverageFromTpSl = (s: Strategy): number => {
    const spread = Math.abs(s.takeProfit - s.stopLoss);
    return spread > 0 ? Math.round((spread / s.entry) * 10) : 1;
  };
  
  // Find closest tick index for a given leverage value
  const findClosestTickIndex = (leverage: number): number => {
    let closestIndex = 0;
    let closestDiff = Infinity;
    LEVERAGE_TICKS.forEach((tick, idx) => {
      const diff = Math.abs(tick - leverage);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestIndex = idx;
      }
    });
    return closestIndex;
  };
  
  // Leverage slider state - works on tick indices (0-5), not raw leverage
  const [leverageIndex, setLeverageIndex] = useState(() => {
    const lev = strategy.leverage ?? deriveLeverageFromTpSl(strategy);
    return findClosestTickIndex(lev);
  });
  const currentLeverage = LEVERAGE_TICKS[leverageIndex];
  
  // Sync tick index when strategy changes (e.g., when TP/SL updated elsewhere or leverage changed)
  useEffect(() => {
    const lev = strategy.leverage ?? deriveLeverageFromTpSl(strategy);
    const newIndex = findClosestTickIndex(lev);
    setLeverageIndex(newIndex);
  }, [strategy.id, strategy.leverage, strategy.takeProfit, strategy.stopLoss, strategy.entry]);
  
  // TP/SL separate state - initialized from current values
  const [tpInput, setTpInput] = useState('');
  const [slInput, setSlInput] = useState('');
  const [isUpdatingTp, setIsUpdatingTp] = useState(false);
  const [isUpdatingSl, setIsUpdatingSl] = useState(false);
  const [updateTpSuccess, setUpdateTpSuccess] = useState(false);
  const [updateSlSuccess, setUpdateSlSuccess] = useState(false);
  
  const pnlUsd = strategy.realizedPnlUsd || 0;
  const pnlPct = strategy.realizedPnlPct || 0;
  const pnlSign = pnlPct >= 0 ? '+' : '';
  const currentSize = strategy.notionalUsd || 0;

  const handleUpdateSize = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    const newSize = parseFloat(sizeInput);
    if (isNaN(newSize) || newSize <= 0) return;
    
    setIsUpdatingSize(true);
    onUpdateSize(newSize);
    setSizeInput('');
    setUpdateSizeSuccess(true);
    setTimeout(() => {
      setIsUpdatingSize(false);
      setUpdateSizeSuccess(false);
    }, 1500);
  };

  // Leverage slider - works on tick indices, auto-updates on release
  const handleLeverageSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const idx = Number(e.target.value);
    setLeverageIndex(idx);
  };

  const handleLeverageSliderRelease = (e: React.MouseEvent<HTMLInputElement> | React.TouchEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const leverage = LEVERAGE_TICKS[leverageIndex];
    onUpdateLeverage(leverage);
  };

  // TP update - only updates TP, keeps current SL
  const handleUpdateTp = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    const newTp = parseFloat(tpInput);
    if (isNaN(newTp) || newTp <= 0) return;
    
    // Validate TP makes sense for the side
    if (strategy.side === 'Long' && newTp <= strategy.entry) return;
    if (strategy.side === 'Short' && newTp >= strategy.entry) return;
    
    setIsUpdatingTp(true);
    onUpdateTpSl(newTp, strategy.stopLoss); // Keep current SL
    setTpInput('');
    setUpdateTpSuccess(true);
    setTimeout(() => {
      setIsUpdatingTp(false);
      setUpdateTpSuccess(false);
    }, 1500);
  };

  // SL update - only updates SL, keeps current TP
  const handleUpdateSl = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    const newSl = parseFloat(slInput);
    if (isNaN(newSl) || newSl <= 0) return;
    
    // Validate SL makes sense for the side
    if (strategy.side === 'Long' && newSl >= strategy.entry) return;
    if (strategy.side === 'Short' && newSl <= strategy.entry) return;
    
    setIsUpdatingSl(true);
    onUpdateTpSl(strategy.takeProfit, newSl); // Keep current TP
    setSlInput('');
    setUpdateSlSuccess(true);
    setTimeout(() => {
      setIsUpdatingSl(false);
      setUpdateSlSuccess(false);
    }, 1500);
  };

  const handleSizeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleUpdateSize(e);
    }
    e.stopPropagation();
  };

  const handleTpKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleUpdateTp(e);
    }
    e.stopPropagation();
  };

  const handleSlKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleUpdateSl(e);
    }
    e.stopPropagation();
  };

  return (
    <div>
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-slate-900">{strategy.market}</span>
            <span
              className={`text-xs px-2 py-0.5 rounded ${
                strategy.side === 'Long' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
              }`}
            >
              {strategy.side}
            </span>
          </div>
          <div className="text-xs text-slate-500 space-y-0.5">
            <div>Size: ${currentSize.toLocaleString()}</div>
            <div className="flex items-center gap-2">
              <span>Risk: {strategy.riskPercent.toFixed(1)}%</span>
              <RiskBadge riskPercent={strategy.riskPercent} />
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-sm font-semibold ${pnlPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            {pnlSign}${Math.abs(pnlUsd).toLocaleString()}
          </div>
          <div className={`text-xs ${pnlPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            {pnlSign}{pnlPct.toFixed(1)}%
          </div>
        </div>
      </div>
      
      {/* Inline Quick Controls */}
      <div className="mt-2 space-y-0" onClick={(e) => e.stopPropagation()}>
        {/* Size Control */}
        <div className="pt-2 border-t border-slate-100/60">
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-medium text-slate-500 w-12 flex-shrink-0">Size:</label>
            <input
              type="number"
              value={sizeInput}
              onChange={(e) => {
                setSizeInput(e.target.value);
                e.stopPropagation();
              }}
              onKeyDown={handleSizeKeyDown}
              onClick={(e) => e.stopPropagation()}
              placeholder={`${currentSize.toLocaleString()}`}
              className="flex-1 px-2 py-1 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-pink-300 focus:border-pink-300"
              min="0"
              step="0.01"
            />
            <button
              onClick={handleUpdateSize}
              disabled={isUpdatingSize || !sizeInput || parseFloat(sizeInput) <= 0}
              className="px-2 py-1 text-[10px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {updateSizeSuccess ? '✓' : isUpdatingSize ? '...' : 'Update'}
            </button>
          </div>
        </div>

        {/* Leverage Control - Slider (Discrete Ticks) */}
        <div className="mt-2 pt-2 border-t border-slate-100/60">
          <div className="flex items-center gap-3">
            <label className="text-[10px] font-medium text-slate-500 w-12 flex-shrink-0">Leverage:</label>
            <div className="flex-1 relative pb-5">
              <input
                type="range"
                min="0"
                max={LEVERAGE_TICKS.length - 1}
                step="1"
                value={leverageIndex}
                onChange={handleLeverageSliderChange}
                onMouseUp={handleLeverageSliderRelease}
                onTouchEnd={handleLeverageSliderRelease}
                onClick={(e) => e.stopPropagation()}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer relative z-20
                  [&::-webkit-slider-thumb]:appearance-none 
                  [&::-webkit-slider-thumb]:w-4 
                  [&::-webkit-slider-thumb]:h-4 
                  [&::-webkit-slider-thumb]:rounded-full 
                  [&::-webkit-slider-thumb]:bg-[#FF6BA0] 
                  [&::-webkit-slider-thumb]:cursor-pointer 
                  [&::-webkit-slider-thumb]:shadow-sm
                  [&::-webkit-slider-thumb]:relative
                  [&::-webkit-slider-thumb]:z-30
                  [&::-moz-range-thumb]:w-4 
                  [&::-moz-range-thumb]:h-4 
                  [&::-moz-range-thumb]:rounded-full 
                  [&::-moz-range-thumb]:bg-[#FF6BA0] 
                  [&::-moz-range-thumb]:border-0 
                  [&::-moz-range-thumb]:cursor-pointer
                  [&::-moz-range-thumb]:shadow-sm"
              />
              {/* Visual tick lines aligned to each discrete leverage level */}
              <div className="pointer-events-none absolute inset-x-1 top-1/2 -translate-y-1/2 flex justify-between z-10">
                {LEVERAGE_TICKS.map((tick) => (
                  <span key={tick} className="h-2 w-[1px] bg-slate-300/70" />
                ))}
              </div>
              {/* Tick labels aligned with tick lines - perfectly centered */}
              <div className="absolute inset-x-1 bottom-0 flex justify-between text-[10px] text-slate-400 pointer-events-none select-none z-0">
                {LEVERAGE_TICKS.map((tick) => (
                  <span key={tick} className="text-center w-[1px] -translate-x-[0.5px]">
                    {tick}x
                  </span>
                ))}
              </div>
            </div>
            <span className="text-xs font-medium text-slate-700 w-8 flex-shrink-0 text-right">
              {currentLeverage}x
            </span>
          </div>
        </div>

        {/* Take Profit Control */}
        <div className="mt-2 pt-2 border-t border-slate-100/60">
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-medium text-slate-500 w-12 flex-shrink-0">Take Profit:</label>
            <input
              type="number"
              value={tpInput}
              onChange={(e) => {
                setTpInput(e.target.value);
                e.stopPropagation();
              }}
              onKeyDown={handleTpKeyDown}
              onClick={(e) => e.stopPropagation()}
              placeholder={`${strategy.takeProfit.toLocaleString()}`}
              className="flex-1 px-2 py-1 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-pink-300 focus:border-pink-300"
              min="0"
              step="0.01"
            />
            <button
              onClick={handleUpdateTp}
              disabled={isUpdatingTp || !tpInput || (() => {
                const tp = parseFloat(tpInput);
                if (isNaN(tp) || tp <= 0) return true;
                if (strategy.side === 'Long') {
                  return tp <= strategy.entry;
                } else {
                  return tp >= strategy.entry;
                }
              })()}
              className="px-2 py-1 text-[10px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {updateTpSuccess ? '✓' : isUpdatingTp ? '...' : 'Update'}
            </button>
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5 ml-14">
            {strategy.side === 'Long' ? 'Above entry' : 'Below entry'}
          </div>
        </div>

        {/* Stop Loss Control */}
        <div className="mt-2 pt-2 border-t border-slate-100/60">
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-medium text-slate-500 w-12 flex-shrink-0">Stop Loss:</label>
            <input
              type="number"
              value={slInput}
              onChange={(e) => {
                setSlInput(e.target.value);
                e.stopPropagation();
              }}
              onKeyDown={handleSlKeyDown}
              onClick={(e) => e.stopPropagation()}
              placeholder={`${strategy.stopLoss.toLocaleString()}`}
              className="flex-1 px-2 py-1 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-pink-300 focus:border-pink-300"
              min="0"
              step="0.01"
            />
            <button
              onClick={handleUpdateSl}
              disabled={isUpdatingSl || !slInput || (() => {
                const sl = parseFloat(slInput);
                if (isNaN(sl) || sl <= 0) return true;
                if (strategy.side === 'Long') {
                  return sl >= strategy.entry;
                } else {
                  return sl <= strategy.entry;
                }
              })()}
              className="px-2 py-1 text-[10px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {updateSlSuccess ? '✓' : isUpdatingSl ? '...' : 'Update'}
            </button>
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5 ml-14">
            {strategy.side === 'Long' ? 'Below entry' : 'Above entry'}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end mt-3 pt-3 border-t border-slate-100">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-xs font-medium bg-rose-100 hover:bg-rose-200 text-rose-700 rounded-lg transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function EventStrategyCard({
  strategy,
  onClose,
  onUpdateStake,
  onUpdateSide,
}: {
  strategy: Strategy;
  onClose: (e: React.MouseEvent) => void;
  onUpdateStake: (newStake: number) => void;
  onUpdateSide: (newSide: 'YES' | 'NO') => void;
}) {
  const [stakeInput, setStakeInput] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState(false);
  const maxPayout = strategy.maxPayoutUsd || 0;
  const stake = strategy.stakeUsd || 0;
  const impliedPayoff = maxPayout - stake;
  const currentSide = strategy.eventSide || 'YES';

  const handleUpdate = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    const newStake = parseFloat(stakeInput);
    if (isNaN(newStake) || newStake <= 0) return;
    
    setIsUpdating(true);
    onUpdateStake(newStake);
    setStakeInput('');
    setUpdateSuccess(true);
    setTimeout(() => {
      setIsUpdating(false);
      setUpdateSuccess(false);
    }, 1500);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleUpdate(e);
    }
    e.stopPropagation();
  };

  return (
    <div>
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-slate-900">{strategy.eventLabel || 'Event'}</span>
            <span
              className={`text-xs px-2 py-0.5 rounded ${
                currentSide === 'YES' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
              }`}
            >
              {currentSide}
            </span>
          </div>
          <div className="text-xs text-slate-500 space-y-0.5">
            <div>Stake: ${stake.toLocaleString()}</div>
            <div className="flex items-center gap-2">
              <span>Risk: {strategy.riskPercent?.toFixed(1) || '0.0'}%</span>
              <RiskBadge riskPercent={strategy.riskPercent} />
            </div>
            <div>Max payout: ${maxPayout.toLocaleString()}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold text-slate-900">
            +${impliedPayoff.toLocaleString()}
          </div>
          <div className="text-xs text-slate-500">if wins</div>
        </div>
      </div>
      
      {/* Side Toggle */}
      <div className="mt-2 pt-2 border-t border-slate-100/60" onClick={(e) => e.stopPropagation()}>
        <label className="text-[10px] font-medium text-slate-500 mb-1.5 block">Side:</label>
        <div className="flex gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (currentSide !== 'YES') {
                onUpdateSide('YES');
              }
            }}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              currentSide === 'YES'
                ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
                : 'bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            YES
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (currentSide !== 'NO') {
                onUpdateSide('NO');
              }
            }}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              currentSide === 'NO'
                ? 'bg-rose-100 text-rose-700 border border-rose-300'
                : 'bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            NO
          </button>
        </div>
      </div>
      
      {/* Inline Quick Controls */}
      <div className="mt-2 pt-2 border-t border-slate-100" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <label className="text-[10px] font-medium text-slate-500">Stake:</label>
          <input
            type="number"
            value={stakeInput}
            onChange={(e) => {
              setStakeInput(e.target.value);
              e.stopPropagation();
            }}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            placeholder={`${stake.toLocaleString()}`}
            className="flex-1 px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-pink-300 focus:border-pink-300"
            min="0"
            step="0.01"
          />
          <button
            onClick={handleUpdate}
            disabled={isUpdating || !stakeInput || parseFloat(stakeInput) <= 0}
            className="px-2 py-1 text-[10px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {updateSuccess ? '✓' : isUpdating ? '...' : 'Update'}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-end mt-3 pt-3 border-t border-slate-100">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-xs font-medium bg-rose-100 hover:bg-rose-200 text-rose-700 rounded-lg transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function DefiStrategyCard({
  position,
  account,
  onUpdateDeposit,
}: {
  position: DefiPosition;
  account: AccountState;
  onUpdateDeposit: (newDeposit: number) => void;
}) {
  const [depositInput, setDepositInput] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState(false);
  const usdcBalance = account.balances.find(b => b.symbol === 'USDC')?.balanceUsd || 0;

  const handleUpdate = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    const newDeposit = parseFloat(depositInput);
    if (isNaN(newDeposit) || newDeposit < 0) return;
    
    setIsUpdating(true);
    onUpdateDeposit(newDeposit);
    setDepositInput('');
    setUpdateSuccess(true);
    setTimeout(() => {
      setIsUpdating(false);
      setUpdateSuccess(false);
    }, 1500);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleUpdate(e);
    }
    e.stopPropagation();
  };

  const handleMax = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDepositInput(usdcBalance.toString());
  };

  return (
    <div>
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-slate-900">{position.protocol}</span>
            <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">{position.asset}</span>
          </div>
          <div className="text-xs text-slate-500 space-y-0.5">
            <div>Deposit: ${position.depositUsd.toLocaleString()}</div>
            <div className="flex items-center gap-2">
              <span>APY: {position.apyPct.toFixed(1)}%</span>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold text-emerald-600">
            ${((position.depositUsd * position.apyPct) / 100 / 365).toFixed(2)}
          </div>
          <div className="text-xs text-slate-500">daily yield</div>
        </div>
      </div>
      
      {/* Inline Quick Controls */}
      <div className="mt-2 pt-2 border-t border-slate-100" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <label className="text-[10px] font-medium text-slate-500">Deposit:</label>
          <input
            type="number"
            value={depositInput}
            onChange={(e) => {
              setDepositInput(e.target.value);
              e.stopPropagation();
            }}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            placeholder={`${position.depositUsd.toLocaleString()}`}
            className="flex-1 px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-pink-300 focus:border-pink-300"
            min="0"
            step="0.01"
          />
          <button
            onClick={handleMax}
            className="px-1.5 py-1 text-[10px] font-medium text-slate-500 hover:text-slate-700 transition-colors"
            title="Use all available USDC"
          >
            Max
          </button>
          <button
            onClick={handleUpdate}
            disabled={isUpdating || !depositInput || parseFloat(depositInput) < 0}
            className="px-2 py-1 text-[10px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {updateSuccess ? '✓' : isUpdating ? '...' : 'Update'}
          </button>
        </div>
      </div>

    </div>
  );
}

