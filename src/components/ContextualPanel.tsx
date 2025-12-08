import { useState } from 'react';
import { useBlossomContext } from '../context/BlossomContext';
import { USE_AGENT_BACKEND } from '../lib/config';
import { closeStrategy as closeStrategyApi } from '../lib/blossomApi';
import EmptyStateCard from './EmptyStateCard';
import PositionSummaryCard from './PositionSummaryCard';
import DeFiSummaryCard from './DeFiSummaryCard';

interface ContextualPanelProps {
  selectedStrategyId: string | null;
  onQuickAction?: (action: 'perp' | 'defi' | 'event') => void;
  onInsertPrompt?: (text: string) => void; // For inserting prompts into chat
}

type PanelTab = 'perps' | 'defi' | 'events';

export default function ContextualPanel({ selectedStrategyId, onQuickAction, onInsertPrompt }: ContextualPanelProps) {
  const { strategies, defiPositions } = useBlossomContext();
  const [activeTab, setActiveTab] = useState<PanelTab>('perps');

  // Get active positions
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

  // Determine which state we're in
  const hasAnyPositions = activePerps.length > 0 || activeEvents.length > 0 || activeDefi.length > 0 || proposedDefi.length > 0;
  
  // Always show tabs when there are any positions (allows switching between types even if only one exists)
  const shouldShowTabs = hasAnyPositions;

  // Get perp position for Perps tab
  const getPerpPosition = () => {
    // If a perp strategy is selected, show that
    if (selectedStrategyId) {
      const selected = strategies.find(s => s.id === selectedStrategyId);
      if (selected && !selected.isClosed && selected.instrumentType === 'perp') {
        return selected;
      }
    }
    // Otherwise, show most recent active perp
    return activePerps.length > 0 ? activePerps[0] : null;
  };

  // Get DeFi position for DeFi tab
  const getDefiPosition = () => {
    // Prioritize proposed over active
    if (proposedDefi.length > 0) {
      return proposedDefi[0];
    }
    if (activeDefi.length > 0) {
      return activeDefi[0];
    }
    return null;
  };

  // Get event position for Events tab
  const getEventPosition = () => {
    // If an event strategy is selected, show that
    if (selectedStrategyId) {
      const selected = strategies.find(s => s.id === selectedStrategyId);
      if (selected && !selected.isClosed && selected.instrumentType === 'event') {
        return selected;
      }
    }
    // Otherwise, show most recent active event
    return activeEvents.length > 0 ? activeEvents[0] : null;
  };

  // Get position based on active tab (for single position type state)
  const getCurrentPosition = () => {
    if (activePerps.length > 0) {
      return { type: 'perp' as const, strategy: getPerpPosition() };
    }
    if (activeEvents.length > 0) {
      return { type: 'event' as const, strategy: getEventPosition() };
    }
    const defiPos = getDefiPosition();
    if (defiPos) {
      return { type: 'defi' as const, position: defiPos };
    }
    return null;
  };

  const currentPosition = getCurrentPosition();
  const perpPosition = getPerpPosition();
  const defiPosition = getDefiPosition();
  const eventPosition = getEventPosition();

  // STATE 1: No positions - show empty state with tabs
  if (!hasAnyPositions) {
    return (
      <div className="w-full overflow-hidden flex flex-col">
        {/* Tabs - always show even when empty */}
        <div className="flex border-b border-slate-100 bg-white/90 flex-shrink-0">
          <button
            onClick={() => setActiveTab('perps')}
            className={`flex-1 px-4 py-3 text-xs font-medium transition-colors ${
              activeTab === 'perps'
                ? 'text-blossom-pink border-b-2 border-blossom-pink bg-blossom-pinkSoft/20'
                : 'text-blossom-slate hover:text-blossom-ink hover:bg-blossom-pinkSoft/10'
            }`}
          >
            Perps
          </button>
          <button
            onClick={() => setActiveTab('defi')}
            className={`flex-1 px-4 py-3 text-xs font-medium transition-colors ${
              activeTab === 'defi'
                ? 'text-blossom-pink border-b-2 border-blossom-pink bg-blossom-pinkSoft/20'
                : 'text-blossom-slate hover:text-blossom-ink hover:bg-blossom-pinkSoft/10'
            }`}
          >
            DeFi
          </button>
          <button
            onClick={() => setActiveTab('events')}
            className={`flex-1 px-4 py-3 text-xs font-medium transition-colors ${
              activeTab === 'events'
                ? 'text-blossom-pink border-b-2 border-blossom-pink bg-blossom-pinkSoft/20'
                : 'text-blossom-slate hover:text-blossom-ink hover:bg-blossom-pinkSoft/10'
            }`}
          >
            Events
          </button>
        </div>
        {/* Empty state content */}
        <div className="flex-1 overflow-y-auto p-6">
          <EmptyStateCard onQuickAction={onQuickAction} />
        </div>
      </div>
    );
  }

  // STATE 4: Has positions - show tabs
  if (shouldShowTabs) {
    return (
      <div className="w-full overflow-hidden flex flex-col">
        {/* Tabs */}
        <div className="flex border-b border-slate-100 bg-white/90">
          <button
            onClick={() => setActiveTab('perps')}
            className={`flex-1 px-4 py-3 text-xs font-medium transition-colors ${
              activeTab === 'perps'
                ? 'text-blossom-pink border-b-2 border-blossom-pink bg-blossom-pinkSoft/20'
                : 'text-blossom-slate hover:text-blossom-ink hover:bg-blossom-pinkSoft/10'
            }`}
          >
            Perps {activePerps.length > 0 && `(${activePerps.length})`}
          </button>
          <button
            onClick={() => setActiveTab('defi')}
            className={`flex-1 px-4 py-3 text-xs font-medium transition-colors ${
              activeTab === 'defi'
                ? 'text-blossom-pink border-b-2 border-blossom-pink bg-blossom-pinkSoft/20'
                : 'text-blossom-slate hover:text-blossom-ink hover:bg-blossom-pinkSoft/10'
            }`}
          >
            DeFi {(activeDefi.length + proposedDefi.length) > 0 && `(${activeDefi.length + proposedDefi.length})`}
          </button>
          <button
            onClick={() => setActiveTab('events')}
            className={`flex-1 px-4 py-3 text-xs font-medium transition-colors ${
              activeTab === 'events'
                ? 'text-blossom-pink border-b-2 border-blossom-pink bg-blossom-pinkSoft/20'
                : 'text-blossom-slate hover:text-blossom-ink hover:bg-blossom-pinkSoft/10'
            }`}
          >
            Events {activeEvents.length > 0 && `(${activeEvents.length})`}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'perps' && (
            <>
              {perpPosition ? (
                <PositionSummaryCard strategy={perpPosition} />
              ) : (
                <div className="card-glass p-6 text-center">
                  <div className="mb-2">
                    <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-blossom-pinkSoft/40 flex items-center justify-center">
                      <svg className="w-6 h-6 text-blossom-pink" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                    </div>
                    <h3 className="text-sm font-semibold text-blossom-ink mb-1">No perp positions</h3>
                    <p className="text-xs text-blossom-slate">Open a perp trade to see position details here.</p>
                  </div>
                </div>
              )}
            </>
          )}
          {activeTab === 'defi' && (
            <>
              {defiPosition ? (
                <DeFiSummaryCard position={defiPosition} onInsertPrompt={onInsertPrompt} />
              ) : (
                <div className="card-glass p-6 text-center">
                  <div className="mb-2">
                    <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-blossom-pinkSoft/40 flex items-center justify-center">
                      <svg className="w-6 h-6 text-blossom-pink" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <h3 className="text-sm font-semibold text-blossom-ink mb-1">No DeFi positions yet</h3>
                    <p className="text-xs text-blossom-slate">Ask Blossom to move idle USDC into yield.</p>
                  </div>
                </div>
              )}
            </>
          )}
          {activeTab === 'events' && (
            <>
              {eventPosition ? (
                <EventSummaryCard strategy={eventPosition} />
              ) : (
                <div className="card-glass p-6 text-center">
                  <div className="mb-2">
                    <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-blossom-pinkSoft/40 flex items-center justify-center">
                      <svg className="w-6 h-6 text-blossom-pink" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                    </div>
                    <h3 className="text-sm font-semibold text-blossom-ink mb-1">No event positions</h3>
                    <p className="text-xs text-blossom-slate">Open an event market position to see details here.</p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // STATE 2 or 3: Single position type
  return (
    <div className="w-full p-6">
      {currentPosition?.type === 'perp' && currentPosition.strategy && (
        <PositionSummaryCard strategy={currentPosition.strategy} />
      )}
      {currentPosition?.type === 'event' && currentPosition.strategy && (
        <EventSummaryCard strategy={currentPosition.strategy} />
      )}
      {currentPosition?.type === 'defi' && currentPosition.position && (
        <DeFiSummaryCard position={currentPosition.position} onInsertPrompt={onInsertPrompt} />
      )}
    </div>
  );
}

// Event Summary Card (similar to Position but for events)
function EventSummaryCard({ strategy }: { strategy: any }) {
  const { closeEventStrategy, updateFromBackendPortfolio, setSelectedStrategyId, updateEventStake, account } = useBlossomContext();
  const [isClosing, setIsClosing] = useState(false);
  const [isEditingStake, setIsEditingStake] = useState(false);
  const [editStakeValue, setEditStakeValue] = useState('');
  const [editOverrideCheckbox, setEditOverrideCheckbox] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const handleClose = async () => {
    if (isClosing) return;
    
    if (USE_AGENT_BACKEND) {
      setIsClosing(true);
      try {
        const response = await closeStrategyApi({
          strategyId: strategy.id,
          type: 'event',
        });
        updateFromBackendPortfolio(response.portfolio);
      } catch (error: any) {
        console.error('Failed to close event:', error);
        alert(`Failed to close event: ${error.message}`);
      } finally {
        setIsClosing(false);
      }
    } else {
      closeEventStrategy(strategy.id);
    }
  };

  return (
    <div className="card-glass p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-blossom-ink">Event Position</h2>
        <span className="px-2 py-0.5 text-xs font-medium text-blossom-pink bg-blossom-pinkSoft border border-blossom-pink/40 rounded-full">
          {strategy.status === 'executed' ? 'Active' : strategy.status}
        </span>
      </div>

      <div className="space-y-3 text-sm mb-4">
        <div className="flex justify-between">
          <span className="text-blossom-slate">Market:</span>
          <span className="font-medium text-blossom-ink">{strategy.eventLabel || strategy.eventKey}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-blossom-slate">Side:</span>
          <span className={`font-medium ${strategy.eventSide === 'YES' ? 'text-blossom-success' : 'text-blossom-danger'}`}>
            {strategy.eventSide}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-blossom-slate">Stake:</span>
          <span className="font-medium text-blossom-ink">${(strategy.stakeUsd || strategy.entry).toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-blossom-slate">Max Payout:</span>
          <span className="font-medium text-blossom-success">${(strategy.maxPayoutUsd || strategy.takeProfit).toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-blossom-slate">Max Loss:</span>
          <span className="font-medium text-blossom-danger">${(strategy.maxLossUsd || strategy.stopLoss).toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-blossom-slate">Risk:</span>
          <span className="font-medium text-blossom-ink">{strategy.riskPercent?.toFixed(1)}%</span>
        </div>
        {strategy.overrideRiskCap && (
          <div className="pt-2 border-t border-blossom-outline/50">
            <div className="text-xs text-blossom-danger font-medium">
              ⚠️ Warning: This exceeds your usual 3% per-trade risk cap.
            </div>
          </div>
        )}
      </div>

      {strategy.status === 'executed' && !strategy.isClosed && (
        <div className="space-y-2 pt-4 border-t border-blossom-outline/50">
          {!isEditingStake ? (
            <>
              <button
                onClick={() => {
                  setIsEditingStake(true);
                  setEditStakeValue(strategy.stakeUsd?.toString() || '');
                  setEditOverrideCheckbox(strategy.overrideRiskCap || false);
                  setEditError(null);
                }}
                className="w-full px-3 py-2 text-xs font-medium text-blossom-ink bg-white border border-blossom-outline/60 rounded-lg hover:bg-blossom-pinkSoft/40 transition-colors"
              >
                Edit stake / risk
              </button>
              <button
                onClick={handleClose}
                disabled={isClosing}
                className="w-full px-3 py-2 text-xs font-medium text-white bg-blossom-danger rounded-lg hover:bg-blossom-danger/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isClosing ? 'Closing...' : 'Close & settle'}
              </button>
              <button
                onClick={() => {
                  setSelectedStrategyId(strategy.id);
                }}
                className="w-full px-3 py-2 text-xs font-medium text-blossom-pink bg-blossom-pinkSoft border border-blossom-pink/40 rounded-lg hover:bg-blossom-pinkSoft/60 transition-colors"
              >
                Ask Blossom: Optimize risk
              </button>
            </>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-blossom-ink mb-1">Stake Amount ($)</label>
                <input
                  type="number"
                  value={editStakeValue}
                  onChange={(e) => {
                    setEditStakeValue(e.target.value);
                    setEditError(null);
                  }}
                  className="w-full px-3 py-2 text-sm border border-blossom-outline/60 rounded-lg focus:outline-none focus:ring-2 focus:ring-blossom-pink/30"
                  placeholder="Enter stake amount"
                />
              </div>
              <div className="text-xs text-blossom-slate">
                Current risk: {strategy.riskPercent?.toFixed(1)}%<br />
                3% cap = ${Math.round(account.accountValue * 0.03).toLocaleString()}
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editOverrideCheckbox}
                  onChange={(e) => setEditOverrideCheckbox(e.target.checked)}
                  className="w-4 h-4 text-blossom-pink border-blossom-outline/60 rounded focus:ring-blossom-pink/30"
                />
                <span className="text-xs text-blossom-ink">Allow stake above 3% cap (override risk)</span>
              </label>
              {editError && (
                <div className="text-xs text-blossom-danger bg-blossom-danger/10 px-2 py-1 rounded">
                  {editError}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const desiredStake = parseFloat(editStakeValue);
                    if (isNaN(desiredStake) || desiredStake <= 0) {
                      setEditError('Please enter a valid stake amount');
                      return;
                    }
                    
                    const accountValue = account.accountValue;
                    const threePctCap = Math.round(accountValue * 0.03);
                    const isOverride = desiredStake > threePctCap && editOverrideCheckbox;
                    
                    if (desiredStake > threePctCap && !editOverrideCheckbox) {
                      setEditError(`This exceeds your 3% cap ($${threePctCap.toLocaleString()}). Check 'Allow stake above 3% cap' to override.`);
                      return;
                    }
                    
                    if (desiredStake > accountValue) {
                      setEditError(`Stake cannot exceed account value ($${accountValue.toLocaleString()})`);
                      return;
                    }
                    
                    // Update the strategy
                    const maxPayoutUsd = desiredStake * (strategy.maxPayoutUsd || 0) / (strategy.stakeUsd || 1);
                    const riskPct = (desiredStake / accountValue) * 100;
                    
                    updateEventStake(strategy.id, {
                      stakeUsd: desiredStake,
                      maxPayoutUsd,
                      maxLossUsd: desiredStake,
                      riskPercent: riskPct,
                      overrideRiskCap: isOverride,
                      requestedStakeUsd: desiredStake,
                    });
                    
                    setIsEditingStake(false);
                    setEditError(null);
                  }}
                  className="flex-1 px-3 py-2 text-xs font-medium text-white bg-blossom-pink rounded-lg hover:bg-[#FF5A96] transition-colors"
                >
                  Update stake
                </button>
                <button
                  onClick={() => {
                    setIsEditingStake(false);
                    setEditError(null);
                  }}
                  className="px-3 py-2 text-xs font-medium text-blossom-slate bg-white border border-blossom-outline/60 rounded-lg hover:bg-blossom-pinkSoft/40 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

