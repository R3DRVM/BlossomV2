import { useState } from 'react';
import { Strategy, DefiPosition, AccountState } from '../context/BlossomContext';
import { useActivityFeed } from '../context/ActivityFeedContext';
import RiskBadge from './RiskBadge';

interface PositionEditorCardProps {
  position: Strategy | DefiPosition;
  account: AccountState;
  onUpdateStake?: (stake: number) => void;
  onUpdateSide?: (side: 'YES' | 'NO') => void;
  onUpdateDeposit?: (deposit: number) => void;
  onClose: () => void;
  compact?: boolean;
  showDetailsLink?: boolean;
  onOpenFull?: () => void;
}

export default function PositionEditorCard({
  position,
  account,
  onUpdateStake,
  onUpdateSide,
  onUpdateDeposit,
  onClose,
  compact = false,
  showDetailsLink = false,
  onOpenFull,
}: PositionEditorCardProps) {
  const isPerp = 'instrumentType' in position && position.instrumentType === 'perp';
  const isEvent = 'instrumentType' in position && position.instrumentType === 'event';
  const isDefi = 'protocol' in position;

  if (isPerp) {
    // Perp positions: compact view shows summary + close, full editing in drawer
    return <PerpEditorCard strategy={position as Strategy} onClose={onClose} compact={compact} showDetailsLink={showDetailsLink} onOpenFull={onOpenFull} />;
  }

  if (isEvent) {
    return (
      <EventEditorCard
        strategy={position as Strategy}
        onUpdateStake={onUpdateStake!}
        onUpdateSide={onUpdateSide!}
        onClose={onClose}
        compact={compact}
        showDetailsLink={showDetailsLink}
        onOpenFull={onOpenFull}
      />
    );
  }

  if (isDefi) {
    return (
      <DefiEditorCard
        position={position as DefiPosition}
        account={account}
        onUpdateDeposit={onUpdateDeposit!}
        onClose={onClose}
        compact={compact}
        showDetailsLink={showDetailsLink}
        onOpenFull={onOpenFull}
      />
    );
  }

  return null;
}

function PerpEditorCard({
  strategy,
  onClose,
  compact,
  showDetailsLink,
  onOpenFull,
}: {
  strategy: Strategy;
  onClose: () => void;
  compact: boolean;
  showDetailsLink: boolean;
  onOpenFull?: () => void;
}) {
  // Note: Perp editing (size, leverage, TP/SL) is complex and kept in StrategyDrawer
  // This compact view only shows summary + close button
  const pnlUsd = strategy.realizedPnlUsd || 0;
  const pnlPct = strategy.realizedPnlPct || 0;
  const pnlSign = pnlPct >= 0 ? '+' : '';
  const currentSize = strategy.notionalUsd || 0;

  if (compact) {
    return (
      <div className="border border-slate-200 rounded-lg p-2 bg-white">
        <div className="flex items-start justify-between mb-1.5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-xs font-semibold text-slate-900 truncate">{strategy.market}</span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                  strategy.side === 'Long' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                }`}
              >
                {strategy.side}
              </span>
            </div>
            <div className="text-[10px] text-slate-500 space-y-0.5">
              <div>Size: ${currentSize.toLocaleString()}</div>
              <div className="flex items-center gap-1.5">
                {typeof strategy.riskPercent === 'number' && (
                  <>
                    <span>Risk: {strategy.riskPercent.toFixed(1)}%</span>
                    <RiskBadge riskPercent={strategy.riskPercent} />
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="text-right ml-2">
            <div className={`text-xs font-semibold ${pnlPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {pnlSign}${Math.abs(pnlUsd).toLocaleString()}
            </div>
            <div className={`text-[10px] ${pnlPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {pnlSign}{pnlPct.toFixed(1)}%
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-1.5 mt-2 pt-2 border-t border-slate-100">
          {showDetailsLink && onOpenFull && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenFull();
              }}
              className="text-[10px] text-slate-500 hover:text-slate-700 transition-colors"
            >
              View details →
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="px-2 py-1 text-[10px] font-medium bg-rose-100 hover:bg-rose-200 text-rose-700 rounded transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  // Full mode (for drawer) - not implemented here, use existing StrategyDrawer components
  return null;
}

function EventEditorCard({
  strategy,
  onUpdateStake,
  onUpdateSide,
  onClose,
  compact,
  showDetailsLink,
  onOpenFull,
}: {
  strategy: Strategy;
  onUpdateStake: (stake: number) => void;
  onUpdateSide: (side: 'YES' | 'NO') => void;
  onClose: () => void;
  compact: boolean;
  showDetailsLink: boolean;
  onOpenFull?: () => void;
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

  if (compact) {
    return (
      <div className="border border-slate-200 rounded-lg p-2 bg-white">
        <div className="flex items-start justify-between mb-1.5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-xs font-semibold text-slate-900 truncate">
                {strategy.eventLabel || 'Event'}
              </span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                  currentSide === 'YES' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                }`}
              >
                {currentSide}
              </span>
            </div>
            <div className="text-[10px] text-slate-500 space-y-0.5">
              <div>Stake: ${stake.toLocaleString()}</div>
              <div className="flex items-center gap-1.5">
                {typeof strategy.riskPercent === 'number' && (
                  <>
                    <span>Risk: {strategy.riskPercent.toFixed(1)}%</span>
                    <RiskBadge riskPercent={strategy.riskPercent} />
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="text-right ml-2">
            <div className="text-xs font-semibold text-slate-900">
              +${impliedPayoff.toLocaleString()}
            </div>
            <div className="text-[10px] text-slate-500">if wins</div>
          </div>
        </div>

        {/* Side Toggle - Compact */}
        <div className="mt-1.5 pt-1.5 border-t border-slate-100" onClick={(e) => e.stopPropagation()}>
          <div className="flex gap-1.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (currentSide !== 'YES') {
                  onUpdateSide('YES');
                }
              }}
              className={`flex-1 px-2 py-1 text-[10px] font-medium rounded transition-colors ${
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
              className={`flex-1 px-2 py-1 text-[10px] font-medium rounded transition-colors ${
                currentSide === 'NO'
                  ? 'bg-rose-100 text-rose-700 border border-rose-300'
                  : 'bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              NO
            </button>
          </div>
        </div>

        {/* Stake Input - Compact */}
        <div className="mt-1.5 pt-1.5 border-t border-slate-100" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] font-medium text-slate-500 w-10 flex-shrink-0">Stake:</label>
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
              className="flex-1 px-1.5 py-0.5 text-[10px] border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-pink-300 focus:border-pink-300"
              min="0"
              step="0.01"
            />
            <button
              onClick={handleUpdate}
              disabled={isUpdating || !stakeInput || parseFloat(stakeInput) <= 0}
              className="px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {updateSuccess ? '✓' : isUpdating ? '...' : 'Update'}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-1.5 mt-2 pt-2 border-t border-slate-100">
          {showDetailsLink && onOpenFull && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenFull();
              }}
              className="text-[10px] text-slate-500 hover:text-slate-700 transition-colors"
            >
              View details →
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="px-2 py-1 text-[10px] font-medium bg-rose-100 hover:bg-rose-200 text-rose-700 rounded transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  // Full mode (for drawer) - not implemented here, use existing StrategyDrawer components
  return null;
}

function DefiEditorCard({
  position,
  account,
  onUpdateDeposit,
  onClose,
  compact,
  showDetailsLink,
  onOpenFull,
}: {
  position: DefiPosition;
  account: AccountState;
  onUpdateDeposit: (deposit: number) => void;
  onClose: () => void;
  compact: boolean;
  showDetailsLink: boolean;
  onOpenFull?: () => void;
}) {
  const { pushEvent } = useActivityFeed();
  const [depositInput, setDepositInput] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState(false);
  const usdcBalance = account.balances.find(b => b.symbol === 'REDACTED')?.balanceUsd || 0;

  const handleUpdate = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    const newDeposit = parseFloat(depositInput);
    if (isNaN(newDeposit) || newDeposit < 0) return;
    
    const oldDeposit = position.depositUsd;
    setIsUpdating(true);
    onUpdateDeposit(newDeposit);
    setDepositInput('');
    setUpdateSuccess(true);
    
    // Emit activity event
    pushEvent({
      type: 'updated',
      positionId: position.id,
      positionType: 'defi',
      message: `Updated ${position.protocol} ${position.asset} deposit`,
      metadata: {
        field: 'deposit',
        oldValue: oldDeposit,
        newValue: newDeposit,
      },
    });
    
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

  if (compact) {
    return (
      <div className="border border-slate-200 rounded-lg p-2 bg-white">
        <div className="flex items-start justify-between mb-1.5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-xs font-semibold text-slate-900 truncate">{position.protocol}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 flex-shrink-0">
                {position.asset}
              </span>
            </div>
            <div className="text-[10px] text-slate-500 space-y-0.5">
              <div>Deposit: ${position.depositUsd.toLocaleString()}</div>
              <div>APY: {position.apyPct.toFixed(1)}%</div>
            </div>
          </div>
          <div className="text-right ml-2">
            <div className="text-xs font-semibold text-emerald-600">
              ${((position.depositUsd * position.apyPct) / 100 / 365).toFixed(2)}
            </div>
            <div className="text-[10px] text-slate-500">daily yield</div>
          </div>
        </div>

        {/* Blocker #4: TX Hash Display */}
        {position.txHash && (
          <div className="mt-2 pt-2 border-t border-gray-700/50">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">Transaction:</span>
              <a
                href={position.explorerUrl || `https://sepolia.etherscan.io/tx/${position.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-blue-400 hover:text-blue-300"
                onClick={(e) => e.stopPropagation()}
              >
                {position.txHash.slice(0, 6)}...{position.txHash.slice(-4)}
                <span className="text-gray-500">⎘</span>
              </a>
            </div>
            {position.blockNumber && (
              <div className="flex items-center justify-between text-xs mt-1">
                <span className="text-gray-400">Status:</span>
                <span className="text-green-400">Confirmed • Block {position.blockNumber.toLocaleString()}</span>
              </div>
            )}
          </div>
        )}

        {/* Deposit Input - Compact */}
        <div className="mt-1.5 pt-1.5 border-t border-slate-100" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] font-medium text-slate-500 w-12 flex-shrink-0">Deposit:</label>
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
              className="flex-1 px-1.5 py-0.5 text-[10px] border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-pink-300 focus:border-pink-300"
              min="0"
              step="0.01"
            />
            <button
              onClick={handleMax}
              className="px-1 py-0.5 text-[10px] font-medium text-slate-500 hover:text-slate-700 transition-colors"
              title="Use all available bUSDC"
            >
              Max
            </button>
            <button
              onClick={handleUpdate}
              disabled={isUpdating || !depositInput || parseFloat(depositInput) < 0}
              className="px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {updateSuccess ? '✓' : isUpdating ? '...' : 'Update'}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-1.5 mt-2 pt-2 border-t border-slate-100">
          {showDetailsLink && onOpenFull && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenFull();
              }}
              className="text-[10px] text-slate-500 hover:text-slate-700 transition-colors"
            >
              View details →
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="px-2 py-1 text-[10px] font-medium bg-rose-100 hover:bg-rose-200 text-rose-700 rounded transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  // Full mode (for drawer) - not implemented here, use existing StrategyDrawer components
  return null;
}
