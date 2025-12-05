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
    <div className={`flex gap-3 mb-6 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className="flex-shrink-0">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-lg ${
          isUser ? 'bg-purple-500' : 'bg-gray-300'
        }`}>
          {isUser ? '👤' : '🌸'}
        </div>
      </div>
      <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-[70%]`}>
        <div className="text-sm font-medium text-gray-600 mb-1">
          {isUser ? 'You' : 'Blossom'}
        </div>
        <div className={`rounded-2xl px-4 py-3 ${
          isUser 
            ? 'bg-purple-500 text-white' 
            : 'bg-white border border-gray-200 text-gray-900'
        }`}>
          <div className="whitespace-pre-wrap">{text}</div>
        </div>
        {!isUser && strategy && (
          <div 
            ref={strategyPreviewRef}
            className={`mt-3 w-full max-w-md bg-white rounded-lg p-4 shadow-sm ${
              isSelected 
                ? 'border-2 border-purple-500 bg-purple-50' 
                : 'border border-gray-200'
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Strategy Preview</h3>
              {isSelected && (
                <span className="px-2 py-0.5 text-xs font-medium text-purple-700 bg-purple-200 rounded-full">
                  Active
                </span>
              )}
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Market:</span>
                <span className="font-medium text-gray-900">{currentStrategy?.eventLabel || currentStrategy?.eventKey || strategy.market}</span>
              </div>
              {currentStrategy?.instrumentType === 'event' && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Type:</span>
                  <span className="font-medium text-gray-600 text-xs">Event contract (Sim)</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-600">Side:</span>
                <span className={`font-medium ${
                  (currentStrategy?.eventSide === 'YES' || strategy.side === 'Long') ? 'text-green-600' : 'text-red-600'
                }`}>
                  {currentStrategy?.eventSide || strategy.side}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Risk:</span>
                <span className="font-medium text-gray-900">{strategy.riskPercent}% of account</span>
              </div>
              {currentStrategy?.instrumentType === 'event' ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Stake:</span>
                    <span className="font-medium text-gray-900">${(currentStrategy.stakeUsd || strategy.entryPrice).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Max Payout:</span>
                    <span className="font-medium text-green-600">${(currentStrategy.maxPayoutUsd || strategy.takeProfit).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Max Loss:</span>
                    <span className="font-medium text-red-600">${(currentStrategy.maxLossUsd || strategy.stopLoss).toLocaleString()}</span>
                  </div>
                  <div className="mt-2 pt-2 border-t border-gray-100 text-xs text-gray-500">
                    Instrument: Event contract (demo - no real trades).
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Entry:</span>
                    <span className="font-medium text-gray-900">${strategy.entryPrice.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Take Profit:</span>
                    <span className="font-medium text-green-600">${strategy.takeProfit.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Stop Loss:</span>
                    <span className="font-medium text-red-600">${strategy.stopLoss.toLocaleString()}</span>
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
              <button 
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleConfirmAndQueue();
                }}
                disabled={isVeryHighRisk}
                className={`mt-4 w-full px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  !isVeryHighRisk
                    ? 'bg-purple-500 text-white hover:bg-purple-600'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
                title={isVeryHighRisk ? 'Risk too high' : undefined}
              >
                Confirm & Queue
              </button>
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
                className="mt-4 w-full px-4 py-2 text-sm font-medium rounded-lg bg-green-500 text-white hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                className="mt-4 w-full px-4 py-2 text-sm font-medium rounded-lg bg-green-500 text-white hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
              <div className="mt-2 rounded-md bg-purple-50 px-3 py-2 text-xs text-purple-800 border border-purple-100">
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
          <div className="mt-3 w-full max-w-md bg-white rounded-lg p-4 shadow-sm border border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">DeFi Plan (Sim)</h3>
            <div className="space-y-2 text-sm mb-4">
              <div className="flex justify-between">
                <span className="text-gray-600">Protocol:</span>
                <span className="font-medium text-gray-900">{defiProposal.protocol}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Asset:</span>
                <span className="font-medium text-gray-900">{defiProposal.asset}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Deposit:</span>
                <span className="font-medium text-gray-900">${defiProposal.depositUsd.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">APY:</span>
                <span className="font-medium text-green-600">{defiProposal.apyPct}%</span>
              </div>
            </div>
            <div className="text-xs text-gray-600 mb-4 pt-3 border-t border-gray-100">
              Choosing the highest APY within your risk band using idle REDACTED.
            </div>
            {defiProposal.status === 'proposed' ? (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  confirmDefiPlan(defiProposal.id);
                }}
                className="w-full px-4 py-2 text-sm font-medium text-white bg-purple-500 rounded-lg hover:bg-purple-600 transition-colors"
              >
                Confirm deposit (Sim)
              </button>
            ) : (
              <div className="w-full px-4 py-2 text-sm font-medium text-center text-gray-500 bg-gray-100 rounded-lg">
                Active
              </div>
            )}
          </div>
        )}

        {/* Cross-tab CTAs for executed strategies */}
        {!isUser && strategy && isExecuted && strategyId && (
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-purple-700">
            <button
              type="button"
              className="underline hover:text-purple-900"
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

