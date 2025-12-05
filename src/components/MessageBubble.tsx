import { useRef, useEffect, useState } from 'react';
import { ParsedStrategy } from '../lib/mockParser';
import { useBlossomContext, getBaseAsset } from '../context/BlossomContext';
import { USE_AGENT_BACKEND } from '../lib/config';
import { closeStrategy as closeStrategyApi } from '../lib/blossomApi';

interface MessageBubbleProps {
  text: string;
  isUser: boolean;
  timestamp: string;
  strategy?: ParsedStrategy | null;
  strategyId?: string | null;
  selectedStrategyId?: string | null;
  defiProposalId?: string | null;
  onInsertPrompt?: (text: string) => void;
  onRegisterStrategyRef?: (id: string, element: HTMLDivElement | null) => void;
}

function getStrategyReasoning(strategy: ParsedStrategy, instrumentType?: 'perp' | 'event'): string[] {
  const reasons: string[] = [];

  if (instrumentType === 'event') {
    reasons.push('Event contract risk is capped at your stake amount.');
    reasons.push('Max payout reflects the odds implied by the market (1.7x for demo).');
    reasons.push('Your loss is limited to the stake; no liquidation risk.');
    reasons.push('This is a simulated event contract for demo purposes.');
    return reasons;
  }

  if (strategy.side === 'Long') {
    reasons.push('Market is trending up, so I\'m favoring a long bias.');
  } else {
    reasons.push('You\'re hedging by taking a short against spot exposure.');
  }

  if (strategy.riskPercent <= 3) {
    reasons.push('Risk is capped at or below your typical 3% per-strategy target.');
  } else {
    reasons.push('Risk is above the usual 3% per-strategy target, so I\'m keeping a tighter SL.');
  }

  reasons.push('Stop loss and take-profit are set to maintain a comfortable liquidation buffer.');

  return reasons;
}

function getPortfolioBiasWarning(strategies: any[], newStrategy: ParsedStrategy): string | null {
  const base = getBaseAsset(newStrategy.market);
  const executedStrategies = strategies.filter(s => s.status === 'executed');
  
  const sameSide = executedStrategies.filter(
    (s) => getBaseAsset(s.market) === base && s.side === newStrategy.side
  );

  if (sameSide.length >= 2) {
    return `You already have multiple ${base} ${newStrategy.side} strategies active. This adds to an existing ${base} ${newStrategy.side} bias. Consider hedging or using smaller size.`;
  }

  return null;
}

export default function MessageBubble({ text, isUser, timestamp, strategy, strategyId, selectedStrategyId, defiProposalId, onInsertPrompt, onRegisterStrategyRef }: MessageBubbleProps) {
  const { updateStrategyStatus, recomputeAccountFromStrategies, strategies, setActiveTab, setSelectedStrategyId, setOnboarding, closeStrategy, closeEventStrategy, defiPositions, latestDefiProposal, confirmDefiPlan, updateFromBackendPortfolio } = useBlossomContext();
  const [isClosing, setIsClosing] = useState(false);
  
  // Find the DeFi proposal for this message
  const defiProposal = defiProposalId 
    ? (defiPositions.find(p => p.id === defiProposalId) || (latestDefiProposal?.id === defiProposalId ? latestDefiProposal : null))
    : null;
  const strategyPreviewRef = useRef<HTMLDivElement>(null);
  const isSelected = strategyId && strategyId === selectedStrategyId;
  
  // Get current strategy status
  const currentStrategy = strategyId ? strategies.find(s => s.id === strategyId) : null;
  const currentStatus = currentStrategy?.status || 'draft';
  const isDraft = currentStatus === 'draft';
  const isExecuted = currentStatus === 'executed';
  const isClosed = currentStrategy?.isClosed || false;
  
  const isHighRisk = strategy ? strategy.riskPercent > 3 : false;
  const isVeryHighRisk = strategy ? strategy.riskPercent >= 5 : false;
  
  const biasWarning = strategy ? getPortfolioBiasWarning(strategies, strategy) : null;
  
  // Register strategy ref for scroll restoration
  useEffect(() => {
    if (strategyId && strategyPreviewRef.current && onRegisterStrategyRef) {
      onRegisterStrategyRef(strategyId, strategyPreviewRef.current);
    }
    return () => {
      if (strategyId && onRegisterStrategyRef) {
        onRegisterStrategyRef(strategyId, null);
      }
    };
  }, [strategyId, onRegisterStrategyRef]);

  const handleConfirmAndQueue = () => {
    if (!strategyId || !isDraft) return;
    
    setOnboarding(prev => ({ ...prev, queuedStrategy: true }));
    updateStrategyStatus(strategyId, 'queued');
    
    // Simulate execution sequence
    setTimeout(() => {
      updateStrategyStatus(strategyId!, 'executing');
      
      setTimeout(() => {
        updateStrategyStatus(strategyId!, 'executed');
        recomputeAccountFromStrategies();
      }, 2000);
    }, 1500);
  };
  
  const handleSuggestionClick = (suggestion: string) => {
    if (onInsertPrompt) {
      onInsertPrompt(suggestion);
    }
  };
  return (
    <div className={`flex gap-3 mb-4 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className="flex-shrink-0">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-lg ${
          isUser ? 'bg-blossom-pink' : 'bg-gray-300'
        }`}>
          {isUser ? '👤' : '🌸'}
        </div>
      </div>
      <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-[70%]`}>
        <div className="text-sm font-medium text-gray-600 mb-1">
          {isUser ? 'You' : 'Blossom'}
        </div>
        <div className={`rounded-3xl px-4 py-3 ${
          isUser 
            ? 'bg-gradient-to-br from-blossom-pink to-[#FF5A96] text-white shadow-sm' 
            : 'card-glass text-blossom-ink'
        }`}>
          <div className="whitespace-pre-wrap">{text}</div>
        </div>
        {!isUser && strategy && (
          <div 
            ref={strategyPreviewRef}
            className={`mt-3 w-full max-w-md strategy-card card-glass p-5 transition-all duration-300 ${
              currentStatus === 'draft' || currentStatus === 'queued'
                ? ''
                : currentStatus === 'executing'
                ? 'bg-blossom-pinkSoft/40'
                : currentStatus === 'executed' && !isClosed
                ? ''
                : ''
            } ${isSelected ? 'ring-2 ring-blossom-pink/30' : ''}`}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-blossom-ink">
                {currentStrategy?.eventLabel || currentStrategy?.eventKey || strategy.market}
              </h3>
              <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
                currentStatus === 'draft'
                  ? 'bg-gray-100 text-gray-600'
                  : currentStatus === 'queued'
                  ? 'bg-blossom-slate/10 text-blossom-slate'
                  : currentStatus === 'executing'
                  ? 'bg-blossom-pink/10 text-blossom-pink border border-blossom-pink/30'
                  : currentStatus === 'executed' && !isClosed
                  ? 'bg-blossom-pink text-white'
                  : isClosed && currentStrategy?.realizedPnlUsd && currentStrategy.realizedPnlUsd > 0
                  ? 'bg-blossom-success text-white'
                  : isClosed && currentStrategy?.realizedPnlUsd && currentStrategy.realizedPnlUsd < 0
                  ? 'bg-blossom-danger text-white'
                  : 'bg-gray-100 text-gray-600 border border-blossom-outline'
              }`}>
                {currentStatus === 'draft' ? 'Draft' :
                 currentStatus === 'queued' ? 'Queued' :
                 currentStatus === 'executing' ? 'Executing' :
                 currentStatus === 'executed' && !isClosed ? 'Executed' :
                 isClosed && currentStrategy?.eventOutcome === 'won' ? 'Settled - Won' :
                 isClosed && currentStrategy?.eventOutcome === 'lost' ? 'Settled - Lost' :
                 isClosed ? 'Closed' : 'Active'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm mb-4">
              {currentStrategy?.instrumentType === 'event' ? (
                <>
                  <div>
                    <div className="text-xs text-blossom-slate mb-0.5">Type</div>
                    <div className="font-medium text-blossom-ink">Event Contract</div>
                  </div>
                  <div>
                    <div className="text-xs text-blossom-slate mb-0.5">Side</div>
                    <div className={`font-medium ${
                      currentStrategy.eventSide === 'YES' ? 'text-blossom-success' : 'text-blossom-danger'
                    }`}>
                      {currentStrategy.eventSide}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-blossom-slate mb-0.5">Stake</div>
                    <div className="font-medium text-blossom-ink">${(currentStrategy.stakeUsd || strategy.entryPrice).toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-xs text-blossom-slate mb-0.5">Max Payout</div>
                    <div className="font-medium text-blossom-success">${(currentStrategy.maxPayoutUsd || strategy.takeProfit).toLocaleString()}</div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-xs text-blossom-slate mb-0.5">Max Loss</div>
                    <div className="font-medium text-blossom-danger">${(currentStrategy.maxLossUsd || strategy.stopLoss).toLocaleString()}</div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <div className="text-xs text-blossom-slate mb-0.5">Side</div>
                    <div className={`font-medium ${
                      strategy.side === 'Long' ? 'text-blossom-success' : 'text-blossom-danger'
                    }`}>
                      {strategy.side}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-blossom-slate mb-0.5">Risk</div>
                    <div className="font-medium text-blossom-ink">{strategy.riskPercent}%</div>
                  </div>
                  <div>
                    <div className="text-xs text-blossom-slate mb-0.5">Entry</div>
                    <div className="font-medium text-blossom-ink">${strategy.entryPrice.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-xs text-blossom-slate mb-0.5">Take Profit</div>
                    <div className="font-medium text-blossom-success">${strategy.takeProfit.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-xs text-blossom-slate mb-0.5">Stop Loss</div>
                    <div className="font-medium text-blossom-danger">${strategy.stopLoss.toLocaleString()}</div>
                  </div>
                </>
              )}
            </div>
            
            {/* Risk Guardrails */}
            {!isHighRisk && (
              <div className="mt-3 text-xs text-gray-600">
                This keeps your per-strategy risk at or below 3% of account.
              </div>
            )}
            {isHighRisk && (
              <div className="mt-3 rounded-md bg-yellow-50 px-3 py-2 text-xs text-yellow-800 border border-yellow-200">
                This strategy uses {strategy.riskPercent}% of your account, above your typical 3% risk per trade.
                Make sure you're comfortable with a larger drawdown.
              </div>
            )}
            
            {isDraft && (
              <div className="pt-3 border-t border-blossom-outline/50">
                <button 
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleConfirmAndQueue();
                  }}
                  disabled={isVeryHighRisk}
                className={`w-full h-10 px-4 text-sm font-medium rounded-xl transition-all ${
                  !isVeryHighRisk
                    ? 'bg-blossom-pink text-white hover:bg-[#FF5A96] shadow-[0_10px_25px_rgba(255,107,160,0.35)]'
                    : 'bg-blossom-outline/40 text-blossom-slate cursor-not-allowed'
                }`}
                  title={isVeryHighRisk ? 'Risk too high' : undefined}
                >
                  Confirm & Queue
                </button>
              </div>
            )}
            {isExecuted && !isClosed && currentStrategy?.instrumentType === 'event' && (
              <button
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (isClosing) return;
                  
                  if (USE_AGENT_BACKEND) {
                    setIsClosing(true);
                    try {
                      const response = await closeStrategyApi({
                        strategyId: strategyId!,
                        type: 'event',
                      });
                      updateFromBackendPortfolio(response.portfolio);
                      // Optionally show summary message
                      console.log('Event closed:', response.summaryMessage);
                    } catch (error: any) {
                      console.error('Failed to close event:', error);
                      alert(`Failed to close event: ${error.message}`);
                    } finally {
                      setIsClosing(false);
                    }
                  } else {
                    closeEventStrategy(strategyId!);
                  }
                }}
                disabled={isClosing}
                className="w-full h-10 px-4 text-sm font-medium rounded-xl bg-blossom-success text-white hover:bg-blossom-success/90 hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                {isClosing ? 'Closing...' : 'Close & settle this event (Sim)'}
              </button>
            )}
            {isExecuted && !isClosed && currentStrategy?.instrumentType !== 'event' && (
              <button
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (isClosing) return;
                  
                  if (USE_AGENT_BACKEND) {
                    setIsClosing(true);
                    try {
                      const response = await closeStrategyApi({
                        strategyId: strategyId!,
                        type: 'perp',
                      });
                      updateFromBackendPortfolio(response.portfolio);
                      // Optionally show summary message
                      console.log('Strategy closed:', response.summaryMessage);
                    } catch (error: any) {
                      console.error('Failed to close strategy:', error);
                      alert(`Failed to close strategy: ${error.message}`);
                    } finally {
                      setIsClosing(false);
                    }
                  } else {
                    closeStrategy(strategyId!);
                  }
                }}
                disabled={isClosing}
                className="w-full h-10 px-4 text-sm font-medium rounded-xl bg-blossom-success text-white hover:bg-blossom-success/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                {isClosing ? 'Closing...' : 'Close & Take Profit (Sim)'}
              </button>
            )}
            {isClosed && currentStrategy && (
              <div className="mt-4 px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 text-gray-700 text-center">
                {currentStrategy.instrumentType === 'event' && currentStrategy.eventOutcome ? (
                  <>
                    Settled - {currentStrategy.eventOutcome === 'won' ? 'Won' : 'Lost'} (
                    <span className={currentStrategy.realizedPnlUsd && currentStrategy.realizedPnlUsd >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {currentStrategy.realizedPnlUsd && currentStrategy.realizedPnlUsd >= 0 ? '+' : ''}${currentStrategy.realizedPnlUsd?.toFixed(2) || '0.00'}
                    </span>)
                  </>
                ) : (
                  <>
                    Closed · Realized PnL: <span className={currentStrategy.realizedPnlUsd && currentStrategy.realizedPnlUsd >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {currentStrategy.realizedPnlUsd && currentStrategy.realizedPnlUsd >= 0 ? '+' : ''}${currentStrategy.realizedPnlUsd?.toFixed(2) || '0.00'}
                    </span>
                  </>
                )}
              </div>
            )}
            {(currentStatus === 'queued' || currentStatus === 'executing') && (
              <div className="mt-4 px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 text-gray-700 text-center">
                {currentStatus === 'queued' ? 'Queued...' : 'Executing...'}
              </div>
            )}
          </div>
        )}
        
        {/* Reasoning Block */}
        {!isUser && strategy && (
          <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-700">
            <div className="font-medium mb-1">Why this setup?</div>
            <ul className="list-disc pl-5 space-y-1">
              {getStrategyReasoning(strategy, currentStrategy?.instrumentType).map((line, idx) => (
                <li key={idx}>{line}</li>
              ))}
            </ul>
            
            {biasWarning && (
              <div className="mt-2 rounded-md bg-blossom-pinkSoft px-3 py-2 text-xs text-blossom-ink border border-blossom-pink/40">
                {biasWarning}
              </div>
            )}
          </div>
        )}
        
        {/* Follow-up Suggestions */}
        {!isUser && strategy && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => handleSuggestionClick(`Simulate PnL for this strategy if ${strategy.market.replace('-PERP', '')} moves ±10%`)}
              className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors"
            >
              Simulate PnL if price moves ±10%
            </button>
            <button
              onClick={() => handleSuggestionClick('Show liquidation risk for this strategy')}
              className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors"
            >
              Show liquidation risk
            </button>
            <button
              onClick={() => handleSuggestionClick(`Hedge this ${strategy.market} ${strategy.side.toLowerCase()} exposure`)}
              className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors"
            >
              Hedge this exposure
            </button>
            <button
              onClick={() => {
                setSelectedStrategyId(strategyId || null);
                setActiveTab('portfolio');
              }}
              className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors"
            >
              Show portfolio impact
            </button>
          </div>
        )}
        
        {/* DeFi Plan Card */}
        {!isUser && defiProposal && (
          <div className="mt-3 w-full max-w-md bg-white rounded-2xl p-5 shadow-sm border border-blossom-outline strategy-card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-blossom-ink">DeFi Plan (Sim)</h3>
              <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
                defiProposal.status === 'proposed'
                  ? 'bg-gray-100 text-gray-600'
                  : 'bg-blossom-pink text-white'
              }`}>
                {defiProposal.status === 'proposed' ? 'Proposed' : 'Active'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm mb-4">
              <div>
                <div className="text-xs text-blossom-slate mb-0.5">Protocol</div>
                <div className="text-sm font-medium text-blossom-ink">{defiProposal.protocol}</div>
              </div>
              <div>
                <div className="text-xs text-blossom-slate mb-0.5">Asset</div>
                <div className="text-sm font-medium text-blossom-ink">{defiProposal.asset}</div>
              </div>
              <div>
                <div className="text-xs text-blossom-slate mb-0.5">Deposit</div>
                <div className="text-sm font-medium text-blossom-ink">${defiProposal.depositUsd.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-blossom-slate mb-0.5">APY</div>
                <div className="text-sm font-medium text-blossom-success">{defiProposal.apyPct}%</div>
              </div>
            </div>
            <div className="text-xs text-blossom-slate mb-4 pt-3 border-t border-blossom-outline/50">
              Choosing the highest APY within your risk band using idle REDACTED.
            </div>
            {defiProposal.status === 'proposed' ? (
              <div className="pt-3 border-t border-blossom-outline/50">
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    confirmDefiPlan(defiProposal.id);
                  }}
                  className="w-full h-10 px-4 text-sm font-medium rounded-xl bg-blossom-pink text-white hover:bg-blossom-pink/90 hover:shadow-md transition-all shadow-sm"
                >
                  Confirm deposit (Sim)
                </button>
              </div>
            ) : (
              <div className="w-full h-10 px-4 text-sm font-medium text-center text-blossom-slate bg-blossom-pinkLight rounded-xl flex items-center justify-center">
                Active
              </div>
            )}
            <div className="mt-4 pt-3 border-t border-blossom-outline/50 text-xs text-blossom-slate">
              Instrument: DeFi yield (Sim – no real deposits)
            </div>
          </div>
        )}

        {/* Cross-tab CTAs for executed strategies */}
        {!isUser && strategy && isExecuted && strategyId && (
          <div className="mt-2 flex flex-wrap gap-3 text-xs">
            <button
              type="button"
              className="text-blossom-pink hover:underline hover:text-blossom-pink/80"
              onClick={() => {
                setSelectedStrategyId(strategyId);
                setActiveTab('risk');
              }}
            >
              View this strategy's impact in Risk Center →
            </button>
            <button
              type="button"
              className="underline hover:text-purple-900"
              onClick={() => {
                setSelectedStrategyId(strategyId);
                setActiveTab('portfolio');
              }}
            >
              See portfolio breakdown →
            </button>
          </div>
        )}
        <div className="text-xs text-gray-400 mt-1">
          {timestamp}
        </div>
      </div>
    </div>
  );
}

