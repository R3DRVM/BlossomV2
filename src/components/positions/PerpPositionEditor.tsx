import { useState, useEffect } from 'react';
import { Strategy } from '../../context/BlossomContext';
import { useActivityFeed } from '../../context/ActivityFeedContext';
import RiskBadge from '../RiskBadge';

interface PerpPositionEditorProps {
  strategy: Strategy;
  compact?: boolean;
  onUpdateSize: (newSize: number) => void;
  onUpdateTpSl: (newTp: number, newSl: number) => void;
  onUpdateLeverage: (newLeverage: number) => void;
  onClose: () => void;
}

export default function PerpPositionEditor({
  strategy,
  compact = false,
  onUpdateSize,
  onUpdateTpSl,
  onUpdateLeverage,
  onClose,
}: PerpPositionEditorProps) {
  const { pushEvent } = useActivityFeed();
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
    
    const oldSize = strategy.notionalUsd || 0;
    setIsUpdatingSize(true);
    onUpdateSize(newSize);
    setSizeInput('');
    setUpdateSizeSuccess(true);
    
    // Emit activity event
    pushEvent({
      type: 'updated',
      positionId: strategy.id,
      positionType: 'perp',
      message: `Updated ${strategy.market} ${strategy.side} size`,
      metadata: {
        field: 'size',
        oldValue: oldSize,
        newValue: newSize,
      },
    });
    
    // Dispatch planDrafted event for plan card bridge
    window.dispatchEvent(
      new CustomEvent('planDrafted', {
        detail: { type: 'perp', id: strategy.id },
      })
    );
    
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
    const oldLeverage = strategy.leverage || 1;
    onUpdateLeverage(leverage);
    
    // Emit activity event
    pushEvent({
      type: 'updated',
      positionId: strategy.id,
      positionType: 'perp',
      message: `Updated ${strategy.market} ${strategy.side} leverage`,
      metadata: {
        field: 'leverage',
        oldValue: oldLeverage,
        newValue: leverage,
      },
    });
    
    // Dispatch planDrafted event
    window.dispatchEvent(
      new CustomEvent('planDrafted', {
        detail: { type: 'perp', id: strategy.id },
      })
    );
  };

  // TP update - only updates TP, keeps current SL
  const handleUpdateTp = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    const newTp = parseFloat(tpInput);
    if (isNaN(newTp) || newTp <= 0) return;
    
    // Validate TP makes sense for the side
    if (strategy.side === 'Long' && newTp <= strategy.entry) return;
    if (strategy.side === 'Short' && newTp >= strategy.entry) return;
    
    const oldTp = strategy.takeProfit;
    setIsUpdatingTp(true);
    onUpdateTpSl(newTp, strategy.stopLoss); // Keep current SL
    setTpInput('');
    setUpdateTpSuccess(true);
    
    // Emit activity event
    pushEvent({
      type: 'updated',
      positionId: strategy.id,
      positionType: 'perp',
      message: `Updated ${strategy.market} ${strategy.side} take profit`,
      metadata: {
        field: 'takeProfit',
        oldValue: oldTp,
        newValue: newTp,
      },
    });
    
    // Dispatch planDrafted event
    window.dispatchEvent(
      new CustomEvent('planDrafted', {
        detail: { type: 'perp', id: strategy.id },
      })
    );
    
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
    
    const oldSl = strategy.stopLoss;
    setIsUpdatingSl(true);
    onUpdateTpSl(strategy.takeProfit, newSl); // Keep current TP
    setSlInput('');
    setUpdateSlSuccess(true);
    
    // Emit activity event
    pushEvent({
      type: 'updated',
      positionId: strategy.id,
      positionType: 'perp',
      message: `Updated ${strategy.market} ${strategy.side} stop loss`,
      metadata: {
        field: 'stopLoss',
        oldValue: oldSl,
        newValue: newSl,
      },
    });
    
    // Dispatch planDrafted event
    window.dispatchEvent(
      new CustomEvent('planDrafted', {
        detail: { type: 'perp', id: strategy.id },
      })
    );
    
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

  // Compact mode styling adjustments
  const labelClass = compact ? 'text-[9px]' : 'text-[10px]';
  const inputClass = compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs';
  const buttonClass = compact ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-1 text-[10px]';
  const spacingClass = compact ? 'mt-1.5 pt-1.5' : 'mt-2 pt-2';
  const headerSpacing = compact ? 'mb-1.5' : 'mb-2';
  const titleSize = compact ? 'text-xs' : 'text-sm';
  const detailSize = compact ? 'text-[10px]' : 'text-xs';

  return (
    <div>
      <div className={`flex items-start justify-between ${headerSpacing}`}>
        <div className="flex-1">
          <div className={`flex items-center gap-2 ${compact ? 'mb-0.5' : 'mb-1'}`}>
            <span className={`${titleSize} font-semibold text-slate-900`}>{strategy.market}</span>
            <span
              className={`${compact ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5'} rounded ${
                strategy.side === 'Long' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
              }`}
            >
              {strategy.side}
            </span>
          </div>
          <div className={`${detailSize} text-slate-500 space-y-0.5`}>
            <div>Size: ${currentSize.toLocaleString()}</div>
            <div className="flex items-center gap-2">
              <span>Risk: {strategy.riskPercent.toFixed(1)}%</span>
              <RiskBadge riskPercent={strategy.riskPercent} />
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className={`${compact ? 'text-xs' : 'text-sm'} font-semibold ${pnlPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            {pnlSign}${Math.abs(pnlUsd).toLocaleString()}
          </div>
          <div className={`${compact ? 'text-[10px]' : 'text-xs'} ${pnlPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            {pnlSign}{pnlPct.toFixed(1)}%
          </div>
        </div>
      </div>
      
      {/* Inline Quick Controls */}
      <div className={`${spacingClass} space-y-0`} onClick={(e) => e.stopPropagation()}>
        {/* Size Control */}
        <div className={`${spacingClass} border-t border-slate-100/60`}>
          <div className="flex items-center gap-2">
            <label className={`${labelClass} font-medium text-slate-500 ${compact ? 'w-10' : 'w-12'} flex-shrink-0`}>Size:</label>
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
              className={`flex-1 ${inputClass} border border-slate-200 ${compact ? 'rounded' : 'rounded-lg'} focus:outline-none focus:ring-1 focus:ring-pink-300 focus:border-pink-300`}
              min="0"
              step="0.01"
            />
            <button
              onClick={handleUpdateSize}
              disabled={isUpdatingSize || !sizeInput || parseFloat(sizeInput) <= 0}
              className={`${buttonClass} font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 ${compact ? 'rounded' : 'rounded-lg'} transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {updateSizeSuccess ? '✓' : isUpdatingSize ? '...' : 'Update'}
            </button>
          </div>
        </div>

        {/* Leverage Control - Slider (Discrete Ticks) */}
        <div className={`${spacingClass} border-t border-slate-100/60`}>
          <div className="flex items-center gap-3">
            <label className={`${labelClass} font-medium text-slate-500 ${compact ? 'w-10' : 'w-12'} flex-shrink-0`}>Leverage:</label>
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
            <span className={`${compact ? 'text-[10px]' : 'text-xs'} font-medium text-slate-700 ${compact ? 'w-6' : 'w-8'} flex-shrink-0 text-right`}>
              {currentLeverage}x
            </span>
          </div>
        </div>

        {/* Take Profit Control */}
        <div className={`${spacingClass} border-t border-slate-100/60`}>
          <div className="flex items-center gap-2">
            <label className={`${labelClass} font-medium text-slate-500 ${compact ? 'w-10' : 'w-12'} flex-shrink-0`}>Take Profit:</label>
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
              className={`flex-1 ${inputClass} border border-slate-200 ${compact ? 'rounded' : 'rounded-lg'} focus:outline-none focus:ring-1 focus:ring-pink-300 focus:border-pink-300`}
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
              className={`${buttonClass} font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 ${compact ? 'rounded' : 'rounded-lg'} transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {updateTpSuccess ? '✓' : isUpdatingTp ? '...' : 'Update'}
            </button>
          </div>
          <div className={`${compact ? 'text-[9px]' : 'text-[10px]'} text-slate-400 mt-0.5 ${compact ? 'ml-12' : 'ml-14'}`}>
            {strategy.side === 'Long' ? 'Above entry' : 'Below entry'}
          </div>
        </div>

        {/* Stop Loss Control */}
        <div className={`${spacingClass} border-t border-slate-100/60`}>
          <div className="flex items-center gap-2">
            <label className={`${labelClass} font-medium text-slate-500 ${compact ? 'w-10' : 'w-12'} flex-shrink-0`}>Stop Loss:</label>
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
              className={`flex-1 ${inputClass} border border-slate-200 ${compact ? 'rounded' : 'rounded-lg'} focus:outline-none focus:ring-1 focus:ring-pink-300 focus:border-pink-300`}
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
              className={`${buttonClass} font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 ${compact ? 'rounded' : 'rounded-lg'} transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {updateSlSuccess ? '✓' : isUpdatingSl ? '...' : 'Update'}
            </button>
          </div>
          <div className={`${compact ? 'text-[9px]' : 'text-[10px]'} text-slate-400 mt-0.5 ${compact ? 'ml-12' : 'ml-14'}`}>
            {strategy.side === 'Long' ? 'Below entry' : 'Above entry'}
          </div>
        </div>
      </div>

      <div className={`flex items-center justify-end ${compact ? 'mt-2 pt-2' : 'mt-3 pt-3'} border-t border-slate-100`}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            // Emit activity event before closing
            pushEvent({
              type: 'closed',
              positionId: strategy.id,
              positionType: 'perp',
              message: `Closed ${strategy.market} ${strategy.side} position`,
            });
            onClose();
          }}
          className={`${compact ? 'px-2 py-1 text-[10px]' : 'px-3 py-1.5 text-xs'} font-medium bg-rose-100 hover:bg-rose-200 text-rose-700 ${compact ? 'rounded' : 'rounded-lg'} transition-colors`}
        >
          Close
        </button>
      </div>
    </div>
  );
}

