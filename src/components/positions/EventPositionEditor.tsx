import { useState } from 'react';
import { Strategy } from '../../context/BlossomContext';
import { useActivityFeed } from '../../context/ActivityFeedContext';
import RiskBadge from '../RiskBadge';

interface EventPositionEditorProps {
  strategy: Strategy;
  compact?: boolean;
  onUpdateStake: (stake: number) => void;
  onUpdateSide: (side: 'YES' | 'NO') => void;
  onClose: () => void;
}

export default function EventPositionEditor({
  strategy,
  compact = false,
  onUpdateStake,
  onUpdateSide,
  onClose,
}: EventPositionEditorProps) {
  const { pushEvent } = useActivityFeed();
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
    
    const oldStake = strategy.stakeUsd || 0;
    setIsUpdating(true);
    onUpdateStake(newStake);
    setStakeInput('');
    setUpdateSuccess(true);
    
    // Emit activity event
    pushEvent({
      type: 'updated',
      positionId: strategy.id,
      positionType: 'event',
      message: `Updated ${strategy.eventLabel || 'Event'} stake`,
      metadata: {
        field: 'stake',
        oldValue: oldStake,
        newValue: newStake,
      },
    });
    
    // Dispatch planDrafted event
    window.dispatchEvent(
      new CustomEvent('planDrafted', {
        detail: { type: 'event', id: strategy.id },
      })
    );
    
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
            <span className={`${titleSize} font-semibold text-slate-900`}>{strategy.eventLabel || 'Event'}</span>
            <span
              className={`${compact ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5'} rounded ${
                currentSide === 'YES' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
              }`}
            >
              {currentSide}
            </span>
          </div>
          <div className={`${detailSize} text-slate-500 space-y-0.5`}>
            <div>Stake: ${stake.toLocaleString()}</div>
            <div className="flex items-center gap-2">
              <span>Risk: {strategy.riskPercent?.toFixed(1) || '0.0'}%</span>
              <RiskBadge riskPercent={strategy.riskPercent} />
            </div>
            <div>Max payout: ${maxPayout.toLocaleString()}</div>
          </div>
        </div>
        <div className="text-right">
          <div className={`${compact ? 'text-xs' : 'text-sm'} font-semibold text-slate-900`}>
            +${impliedPayoff.toLocaleString()}
          </div>
          <div className={`${compact ? 'text-[10px]' : 'text-xs'} text-slate-500`}>if wins</div>
        </div>
      </div>
      
      {/* Side Toggle */}
      <div className={`${spacingClass} border-t border-slate-100/60`} onClick={(e) => e.stopPropagation()}>
        <label className={`${labelClass} font-medium text-slate-500 ${compact ? 'mb-1' : 'mb-1.5'} block`}>Side:</label>
        <div className="flex gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (currentSide !== 'YES') {
                const oldSide = currentSide;
                onUpdateSide('YES');
                // Emit activity event
                pushEvent({
                  type: 'updated',
                  positionId: strategy.id,
                  positionType: 'event',
                  message: `Switched ${strategy.eventLabel || 'Event'} to YES`,
                  metadata: {
                    field: 'side',
                    oldValue: oldSide,
                    newValue: 'YES',
                  },
                });
                
                // Dispatch planDrafted event
                window.dispatchEvent(
                  new CustomEvent('planDrafted', {
                    detail: { type: 'event', id: strategy.id },
                  })
                );
              }
            }}
            className={`flex-1 ${compact ? 'px-2 py-1 text-[10px]' : 'px-3 py-1.5 text-xs'} font-medium ${compact ? 'rounded' : 'rounded-lg'} transition-colors ${
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
                const oldSide = currentSide;
                onUpdateSide('NO');
                // Emit activity event
                pushEvent({
                  type: 'updated',
                  positionId: strategy.id,
                  positionType: 'event',
                  message: `Switched ${strategy.eventLabel || 'Event'} to NO`,
                  metadata: {
                    field: 'side',
                    oldValue: oldSide,
                    newValue: 'NO',
                  },
                });
                
                // Dispatch planDrafted event
                window.dispatchEvent(
                  new CustomEvent('planDrafted', {
                    detail: { type: 'event', id: strategy.id },
                  })
                );
              }
            }}
            className={`flex-1 ${compact ? 'px-2 py-1 text-[10px]' : 'px-3 py-1.5 text-xs'} font-medium ${compact ? 'rounded' : 'rounded-lg'} transition-colors ${
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
      <div className={`${spacingClass} border-t border-slate-100`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <label className={`${labelClass} font-medium text-slate-500 ${compact ? 'w-10' : 'w-12'} flex-shrink-0`}>Stake:</label>
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
            className={`flex-1 ${inputClass} border border-slate-200 ${compact ? 'rounded' : 'rounded-lg'} focus:outline-none focus:ring-1 focus:ring-pink-300 focus:border-pink-300`}
            min="0"
            step="0.01"
          />
          <button
            onClick={handleUpdate}
            disabled={isUpdating || !stakeInput || parseFloat(stakeInput) <= 0}
            className={`${buttonClass} font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 ${compact ? 'rounded' : 'rounded-lg'} transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {updateSuccess ? '✓' : isUpdating ? '...' : 'Update'}
          </button>
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
              positionType: 'event',
              message: `Closed ${strategy.eventLabel || 'Event'} position`,
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

