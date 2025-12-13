import { useState, useEffect, useRef } from 'react';
import { useBlossomContext, Strategy, DefiPosition, AccountState, isOpenPerp, isOpenEvent, isActiveDefi, getOpenPositionsCount } from '../context/BlossomContext';
import { X } from 'lucide-react';
import PerpPositionEditor from './positions/PerpPositionEditor';
import EventPositionEditor from './positions/EventPositionEditor';

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
                    <PerpPositionEditor
                      strategy={item as Strategy}
                      compact={false}
                      onUpdateSize={(newSize) => {
                        updatePerpSizeById((item as Strategy).id, newSize);
                      }}
                      onUpdateTpSl={(newTp, newSl) => {
                        updatePerpTpSlById((item as Strategy).id, newTp, newSl);
                      }}
                      onUpdateLeverage={(newLeverage) => {
                        updatePerpLeverageById((item as Strategy).id, newLeverage);
                      }}
                      onClose={() => handleCloseStrategy(item as Strategy)}
                    />
                  )}
                  {isEvent && (
                    <EventPositionEditor
                      strategy={item as Strategy}
                      compact={false}
                      onUpdateStake={(newStake) => {
                        updateEventStakeById((item as Strategy).id, newStake);
                      }}
                      onUpdateSide={(newSide) => {
                        updateEventSideById((item as Strategy).id, newSide);
                      }}
                      onClose={() => handleCloseStrategy(item as Strategy)}
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

// PerpStrategyCard and EventStrategyCard have been extracted to:
// - src/components/positions/PerpPositionEditor.tsx
// - src/components/positions/EventPositionEditor.tsx
// These components are now reused in both StrategyDrawer and RightPanel

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

