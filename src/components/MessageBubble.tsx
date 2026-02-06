import { useRef, useEffect, useState } from 'react';
import { ParsedStrategy } from '../lib/mockParser';
import { useBlossomContext, getBaseAsset } from '../context/BlossomContext';
import { USE_AGENT_BACKEND } from '../lib/config';
import { closeStrategy as closeStrategyApi } from '../lib/blossomApi';
import { BlossomLogo } from './BlossomLogo';
import RiskBadge from './RiskBadge';
import ExecutionDetailsDisclosure from './ExecutionDetailsDisclosure';
import { useExecution } from '../context/ExecutionContext';
import { useActivityFeed } from '../context/ActivityFeedContext';
import { formatLeverage, formatMarginNotional, formatVenueDisplay, getSimulatedRouteDisplay, formatUsdOrDash, formatEventVenueDisplay } from '../lib/formatPlanCard';
import { getCachedLiveTicker, marketToSpotSymbol, computeIndicativeTpSl, getLiveSpotForMarket } from '../lib/liveSpot';
import { getCollapsedPreviewFields, type CollapsedPreviewFields } from '../lib/collapsedPreview';
import IntentExecutionCard from './IntentExecutionCard';
import type { IntentExecutionResult } from '../lib/apiClient';

function sanitizeMessageText(input: unknown): string {
  const raw = typeof input === 'string'
    ? input
    : (input && typeof input === 'object' ? JSON.stringify(input) : String(input ?? ''));
  // React escapes by default, but we still normalize angle brackets to guard against any future HTML rendering.
  return raw.replace(/</g, '‹').replace(/>/g, '›');
}

interface MessageBubbleProps {
  text: string;
  isUser: boolean;
  timestamp: string;
  strategy?: ParsedStrategy | null;
  strategyId?: string | null;
  selectedStrategyId?: string | null;
  defiProposalId?: string | null;
  executionMode?: 'auto' | 'confirm' | 'manual';
  onInsertPrompt?: (text: string) => void;
  onRegisterStrategyRef?: (id: string, element: HTMLDivElement | null) => void;
  // Part 1: Support for draft actions and high-risk warning
  onConfirmDraft?: (draftId: string) => void;
  showRiskWarning?: boolean;
  riskReasons?: string[];
  marketsList?: Array<{
    id: string;
    title: string;
    yesPrice: number;
    noPrice: number;
    volume24hUsd?: number;
    source: 'polymarket' | 'kalshi' | 'static';
    isLive: boolean;
  }> | null;
  defiProtocolsList?: Array<{
    id: string;
    name: string;
    tvlUsd: number;
    chains: string[];
    category?: string;
    source: 'defillama' | 'static';
    isLive: boolean;
  }> | null;
  onSendMessage?: (text: string) => void; // Auto-send handler for market list buttons
  // Intent execution (from ledger system)
  intentExecution?: {
    intentText: string;
    result: IntentExecutionResult | null;
    isExecuting: boolean;
  } | null;
  // Confirm intent handler (for confirm mode)
  onConfirmIntent?: (intentId: string) => void;
  isConfirmingIntent?: boolean;
}

function getStrategyReasoning(strategy: ParsedStrategy, instrumentType?: 'perp' | 'event' | 'defi'): string[] {
  const reasons: string[] = [];

  if (instrumentType === 'event') {
    reasons.push('Event contract risk is capped at your stake amount.');
    reasons.push('Max payout reflects the odds implied by the market (1.7x for demo).');
    reasons.push('Your loss is limited to the stake; no liquidation risk.');
    reasons.push('This is a simulated event contract for demo purposes.');
    return reasons;
  } else if (instrumentType === 'defi') {
    reasons.push('DeFi deposits earn yield passively (typically 3-8% APY).');
    reasons.push('Risk is limited to smart contract risk and protocol solvency.');
    reasons.push('No leverage or liquidation risk - deposits can be withdrawn anytime.');
    return reasons;
  }

  if (strategy.side === 'Long') {
    reasons.push('Market is trending up, so I\'m favoring a long bias.');
  } else {
    reasons.push('You\'re hedging by taking a short against spot exposure.');
  }

  // Note: riskProfile is not available in this helper, so we'll use a default
  // The actual threshold check happens in the component where riskProfile is available
  const defaultThreshold = 3;
  if (strategy.riskPercent <= defaultThreshold) {
    reasons.push(`Risk is capped at or below your typical ${defaultThreshold}% per-strategy target.`);
  } else {
    reasons.push(`Risk is above the usual ${defaultThreshold}% per-strategy target, so I'm keeping a tighter SL.`);
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

export default function MessageBubble({ text, isUser, timestamp, strategy, strategyId, selectedStrategyId, defiProposalId, executionMode, onInsertPrompt, onRegisterStrategyRef, onConfirmDraft, showRiskWarning, riskReasons, marketsList, defiProtocolsList, onSendMessage, intentExecution, onConfirmIntent, isConfirmingIntent }: MessageBubbleProps) {
  const { updateStrategyStatus, recomputeAccountFromStrategies, strategies, setActiveTab, setSelectedStrategyId, setOnboarding, closeStrategy, closeEventStrategy, defiPositions, latestDefiProposal, confirmDefiPlan, updateFromBackendPortfolio, account, riskProfile, venue } = useBlossomContext();
  const { addPendingPlan, removePendingPlan, setLastAction } = useExecution();
  const { pushEvent } = useActivityFeed();
  const [isClosing, setIsClosing] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const [isCardExpanded, setIsCardExpanded] = useState(false);
  const [livePrices, setLivePrices] = useState<{ BTC?: number; ETH?: number; SOL?: number; AVAX?: number; LINK?: number }>({});
  const [liveEntrySnapshot, setLiveEntrySnapshot] = useState<{ entryUsd: number; source: 'coingecko' | 'agent' } | null>(null);
  const isMountedRef = useRef(true);
  
  // Find the DeFi proposal for this message
  const defiProposal = defiProposalId
    ? (defiPositions.find(p => p.id === defiProposalId) || (latestDefiProposal?.id === defiProposalId ? latestDefiProposal : null))
    : null;

  // DEBUG: Track DeFi proposal lookup in MessageBubble (wrapped in useEffect to prevent spam)
  const hasLoggedDeFiWarningRef = useRef(false);
  useEffect(() => {
    if (import.meta.env.DEV && defiProposalId) {
      if (!defiProposal && !hasLoggedDeFiWarningRef.current) {
        console.warn('[MessageBubble] ⚠️ DeFi proposal ID exists but proposal not found!', {
          defiProposalId,
          availableDefiPositions: defiPositions,
          latestDefiProposal,
          messageText: text
        });
        hasLoggedDeFiWarningRef.current = true;
      } else if (defiProposal) {
        console.log('[MessageBubble] ✓ Found DeFi proposal:', {
          defiProposalId,
          proposal: defiProposal
        });
        hasLoggedDeFiWarningRef.current = false; // Reset for next time
      }
    }
  }, [defiProposalId, defiProposal, defiPositions, latestDefiProposal, text]);
  const strategyPreviewRef = useRef<HTMLDivElement>(null);
  const isSelected = strategyId && strategyId === selectedStrategyId;
  
  // Get current strategy status
  const currentStrategy = strategyId ? strategies.find(s => s.id === strategyId) : null;
  const currentStatus = currentStrategy?.status || 'draft';
  const isDraft = currentStatus === 'draft';
  const isExecuted = currentStatus === 'executed';
  const isBlocked = (currentStatus as string) === 'blocked'; // Type assertion for pre-existing 'blocked' status
  const isClosed = currentStrategy?.isClosed || false;
  
  const maxPerTrade = riskProfile?.maxPerTradeRiskPct ?? 3;
  const isHighRisk = strategy ? strategy.riskPercent > maxPerTrade : false;
  const isVeryHighRisk = strategy ? strategy.riskPercent >= maxPerTrade * 1.5 : false;
  
  const biasWarning = strategy ? getPortfolioBiasWarning(strategies, strategy) : null;
  
  // Fetch live prices for perp instruments (display-only)
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (currentStrategy?.instrumentType === 'perp' && strategy?.market) {
      // Try direct market lookup first (more accurate)
      getLiveSpotForMarket(strategy.market).then(snapshot => {
        if (isMountedRef.current && snapshot) {
          setLiveEntrySnapshot(snapshot);
          // Also update livePrices for backward compatibility
          const symbol = marketToSpotSymbol(strategy.market);
          if (symbol) {
            setLivePrices(prev => ({ ...prev, [symbol]: snapshot.entryUsd }));
          }
        }
      }).catch(() => {
        // Fail silently
      });

      // Also fetch all prices for ticker compatibility
      getCachedLiveTicker().then(prices => {
        if (isMountedRef.current) {
          setLivePrices(prices);
        }
      }).catch(() => {
        // Fail silently, fall back to parser values
      });
    }
  }, [currentStrategy?.instrumentType, strategy?.market]);
  
  // Compute live-anchored entry/TP/SL for perps (stable derived object, always defined)
  const perpDisplay = (() => {
    // Only compute for perp instruments
    if (currentStrategy?.instrumentType !== 'perp' || !strategy) {
      return {
        entry: strategy?.entryPrice ?? null,
        tp: strategy?.takeProfit ?? null,
        sl: strategy?.stopLoss ?? null,
        hasLive: false,
      };
    }
    
    // Prefer direct market lookup, then fall back to livePrices
    const liveEntry = liveEntrySnapshot?.entryUsd ?? (() => {
      const spotSymbol = strategy.market ? marketToSpotSymbol(strategy.market) : null;
      return spotSymbol && livePrices[spotSymbol] ? livePrices[spotSymbol] : null;
    })();
    
    if (liveEntry && liveEntry > 0 && strategy.side) {
      // Use live entry and compute indicative TP/SL
      const indicativeTpSl = computeIndicativeTpSl({ side: strategy.side, entry: liveEntry });
      return {
        entry: liveEntry,
        tp: indicativeTpSl.tp,
        sl: indicativeTpSl.sl,
        hasLive: true,
      };
    }
    
    // Fall back to strategy values
    return {
      entry: strategy.entryPrice ?? null,
      tp: strategy.takeProfit ?? null,
      sl: strategy.stopLoss ?? null,
      hasLive: false,
    };
  })();
  
  // Determine if button should be disabled (only for technical reasons, not risk)
  const disableReason = !strategyId || !isDraft 
    ? 'Only draft strategies can be queued' 
    : undefined;
  
  // Track pending confirmations for Confirm mode
  useEffect(() => {
    if (executionMode === 'confirm' && strategyId && isDraft && !isExecuted) {
      addPendingPlan(strategyId, (currentStrategy?.instrumentType || 'perp') as 'perp' | 'event' | 'defi');
    }
    return () => {
      if (strategyId) {
        removePendingPlan(strategyId);
      }
    };
  }, [executionMode, strategyId, isDraft, isExecuted, currentStrategy?.instrumentType, addPendingPlan, removePendingPlan]);
  
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
    
    // Remove from pending if in Confirm mode
    if (executionMode === 'confirm' && strategyId) {
      removePendingPlan(strategyId);
    }
    
    // Update last action
    const actionText = `Confirmed ${currentStrategy?.market || currentStrategy?.eventLabel || 'position'} plan`;
    setLastAction(actionText);
    
    // Emit activity event
    pushEvent({
      type: 'alert',
      positionId: strategyId,
      positionType: (currentStrategy?.instrumentType || 'perp') as 'perp' | 'event' | 'defi',
      message: `Confirmed execution plan for ${currentStrategy?.market || currentStrategy?.eventLabel || 'position'}`,
    });
    
    setOnboarding(prev => ({ ...prev, queuedStrategy: true }));
    updateStrategyStatus(strategyId, 'queued');
    
    // Simulate execution sequence
    setTimeout(() => {
      updateStrategyStatus(strategyId!, 'executing');
      
      setTimeout(() => {
        updateStrategyStatus(strategyId!, 'executed');
        recomputeAccountFromStrategies();
        
        // Update last action on execution
        const executedActionText = `Executed ${currentStrategy?.market || currentStrategy?.eventLabel || 'position'} plan`;
        setLastAction(executedActionText);
      }, 2000);
    }, 1500);
  };
  
  const handleSuggestionClick = (suggestion: string) => {
    if (onInsertPrompt) {
      onInsertPrompt(suggestion);
    }
  };
  return (
    <div className={`flex gap-2 mb-1.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className="flex-shrink-0">
        {isUser ? (
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-lg bg-blossom-pink">
            👤
          </div>
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-blossom-pink/30">
            <BlossomLogo size={20} />
          </div>
        )}
      </div>
      <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-[92%] sm:max-w-[70%]`}>
        <div className="text-[11px] font-medium text-gray-600 mb-0.5">
          {isUser ? 'You' : 'Blossom'}
        </div>
        <div className={`rounded-3xl px-2.5 py-1.5 leading-relaxed ${
          isUser 
            ? 'bg-gradient-to-br from-blossom-pink to-[#FF5A96] shadow-sm' 
            : 'card-glass'
        }`}>
          <p
            className={`whitespace-pre-wrap m-0 ${isUser ? 'chat-message-text-user' : 'chat-message-text-assistant'}`}
            style={isUser ? { fontWeight: 400 } : { fontWeight: 400 }}
          >
            {sanitizeMessageText(text)}
          </p>
          {/* Intent Execution Card (from ledger system) */}
          {!isUser && intentExecution && (
            <IntentExecutionCard
              intentText={intentExecution.intentText}
              result={intentExecution.result}
              isExecuting={intentExecution.isExecuting}
              onConfirm={onConfirmIntent}
              isConfirming={isConfirmingIntent}
            />
          )}
          {/* Markets List (for list_top_event_markets intent) */}
          {!isUser && Array.isArray(marketsList) && marketsList.length > 0 && (() => {
            try {
              return (
                <div className="mt-3 space-y-2">
                  {marketsList.map((market) => {
                    // Null-safe field extraction
                    const marketId = market?.id || `market-${Math.random()}`;
                    const marketTitle = typeof market?.title === 'string' ? market.title : String(market?.title ?? '—');
                    const yesPrice = typeof market?.yesPrice === 'number' ? market.yesPrice : 0.5;
                    const noPrice = typeof market?.noPrice === 'number' ? market.noPrice : 0.5;
                    const volume24hUsd = typeof market?.volume24hUsd === 'number' ? market.volume24hUsd : undefined;
                    const source = market?.source || 'static';
                    const isLive = market?.isLive === true;
                    
                    // Only render if we have at least a title
                    if (!marketTitle || marketTitle === '—') {
                      if (import.meta.env.DEV) {
                        if (import.meta.env.DEV) {
                          console.warn('[MessageBubble] Skipping market with missing title', { market });
                        }
                      }
                      return null;
                    }
                    
                    return (
                      <div
                        key={marketId}
                        className="border border-slate-200 rounded-lg bg-white p-3 space-y-2"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-slate-900 mb-1">
                              {marketTitle}
                            </div>
                            <div className="flex items-center gap-3 text-[10px] text-slate-500">
                              <span>YES: {Math.round(yesPrice * 100)}%</span>
                              <span>NO: {Math.round(noPrice * 100)}%</span>
                              {volume24hUsd !== undefined && volume24hUsd > 0 && (
                                <span>Vol: ${(volume24hUsd / 1000).toFixed(0)}k</span>
                              )}
                              <span className="text-slate-400">
                                {source === 'polymarket' ? 'Polymarket' : source === 'kalshi' ? 'Kalshi' : 'Synthetic'}
                                {isLive && <span className="ml-1 text-[9px]">• Live</span>}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => {
                              if (!marketTitle || marketTitle === '—') return;
                              
                              const messageText = `Bet YES on "${marketTitle}" with 2% risk`;
                              
                              // Prefer auto-send if available, otherwise fall back to insert prompt
                              if (onSendMessage) {
                                onSendMessage(messageText);
                              } else if (onInsertPrompt) {
                                onInsertPrompt(messageText);
                              }
                            }}
                            disabled={!marketTitle || marketTitle === '—'}
                            className="flex-1 px-2 py-1.5 text-[10px] font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-pink-50 hover:border-pink-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Bet YES
                          </button>
                          <button
                            onClick={() => {
                              if (!marketTitle || marketTitle === '—') return;
                              
                              const messageText = `Bet NO on "${marketTitle}" with 2% risk`;
                              
                              // Prefer auto-send if available, otherwise fall back to insert prompt
                              if (onSendMessage) {
                                onSendMessage(messageText);
                              } else if (onInsertPrompt) {
                                onInsertPrompt(messageText);
                              }
                            }}
                            disabled={!marketTitle || marketTitle === '—'}
                            className="flex-1 px-2 py-1.5 text-[10px] font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-pink-50 hover:border-pink-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Bet NO
                          </button>
                        </div>
                      </div>
                    );
                  }).filter(Boolean)}
                </div>
              );
            } catch (error) {
              if (import.meta.env.DEV) {
                if (import.meta.env.DEV) {
                  console.warn('[MessageBubble] Error rendering markets list', error);
                }
              }
              return null;
            }
          })()}
          
          {/* DeFi Protocols List (for list_top_defi_protocols intent) */}
          {!isUser && Array.isArray(defiProtocolsList) && defiProtocolsList.length > 0 && (() => {
            try {
              return (
                <div className="mt-3 space-y-2">
                  {defiProtocolsList.map((protocol) => {
                    // Null-safe field extraction
                    const protocolId = protocol?.id || `protocol-${Math.random()}`;
                    const protocolName = typeof protocol?.name === 'string' ? protocol.name : String(protocol?.name ?? '—');
                    const tvlUsd = typeof protocol?.tvlUsd === 'number' ? protocol.tvlUsd : 0;
                    const chains = Array.isArray(protocol?.chains) ? protocol.chains : [];
                    const category = protocol?.category || undefined;
                    const source = protocol?.source || 'static';
                    const isLive = protocol?.isLive === true;
                    
                    // Only render if we have at least a name
                    if (!protocolName || protocolName === '—') {
                      if (import.meta.env.DEV) {
                        console.warn('[MessageBubble] Skipping protocol with missing name', { protocol });
                      }
                      return null;
                    }
                    
                    // Format TVL
                    const tvlFormatted = tvlUsd >= 1e9 
                      ? `$${(tvlUsd / 1e9).toFixed(1)}B`
                      : tvlUsd >= 1e6
                      ? `$${(tvlUsd / 1e6).toFixed(1)}M`
                      : `$${(tvlUsd / 1000).toFixed(0)}k`;
                    
                    return (
                      <div
                        key={protocolId}
                        className="border border-slate-200 rounded-lg bg-white p-3 space-y-2"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-slate-900 mb-1">
                              {protocolName}
                            </div>
                            <div className="flex items-center gap-3 text-[10px] text-slate-500 flex-wrap">
                              <span>TVL: {tvlFormatted}</span>
                              {category && (
                                <span>{category}</span>
                              )}
                              {chains.length > 0 && (
                                <span>{chains.slice(0, 2).join(', ')}{chains.length > 2 ? '...' : ''}</span>
                              )}
                              <span className="text-slate-400">
                                {source === 'defillama' ? 'DefiLlama' : 'Demo'}
                                {isLive && <span className="ml-1 text-[9px]">• Live</span>}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => {
                              if (!protocolName || protocolName === '—') return;

                              // P0 Fix: Use natural language instead of coded string
                              // Old: `Allocate amountPct:"10" to protocol:"${protocolName}" REDACTED yield`
                              // New: Natural language that the LLM/parser can understand
                              const messageText = `Deposit 10% of my bUSDC into ${protocolName}`;

                              // Prefer auto-send if available, otherwise fall back to insert prompt
                              if (onSendMessage) {
                                onSendMessage(messageText);
                              } else if (onInsertPrompt) {
                                onInsertPrompt(messageText);
                              }
                            }}
                            disabled={!protocolName || protocolName === '—'}
                            className="flex-1 px-2 py-1.5 text-[10px] font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-pink-50 hover:border-pink-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Allocate 10%
                          </button>
                          <button
                            onClick={() => {
                              if (!protocolName || protocolName === '—') return;

                              // P0 Fix: Use natural language instead of coded string
                              // Old: `Allocate amountUsd:"500" to protocol:"${protocolName}" REDACTED yield`
                              // New: Natural language that the LLM/parser can understand
                              const messageText = `Deposit $500 bUSDC into ${protocolName}`;

                              // Prefer auto-send if available, otherwise fall back to insert prompt
                              if (onSendMessage) {
                                onSendMessage(messageText);
                              } else if (onInsertPrompt) {
                                onInsertPrompt(messageText);
                              }
                            }}
                            disabled={!protocolName || protocolName === '—'}
                            className="flex-1 px-2 py-1.5 text-[10px] font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-pink-50 hover:border-pink-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Allocate $500
                          </button>
                        </div>
                      </div>
                    );
                  }).filter(Boolean)}
                </div>
              );
            } catch (error) {
              if (import.meta.env.DEV) {
                console.warn('[MessageBubble] Error rendering DeFi protocols list', error);
              }
              return null;
            }
          })()}
        </div>
        {!isUser && strategy && (
          <div 
            ref={strategyPreviewRef}
            {...(currentStrategy?.instrumentType === 'event' && currentStatus === 'draft' ? { 'data-coachmark': 'event-draft-card' } : {})}
            className={`mt-1.5 w-full max-w-md strategy-card card-glass transition-all duration-300 ${
              currentStatus === 'draft' || currentStatus === 'queued'
                ? ''
                : currentStatus === 'executing'
                ? 'bg-blossom-pinkSoft/40'
                : currentStatus === 'executed' && !isClosed
                ? ''
                : ''
            }             ${isSelected ? 'ring-2 ring-blossom-pink/30' : ''}`}
          >
            {/* Header - clickable to expand/collapse */}
            <button
              onClick={() => setIsCardExpanded(!isCardExpanded)}
              className="w-full flex items-center justify-between p-3 pb-1.5 border-b border-blossom-outline/20 hover:bg-slate-50/50 transition-colors"
            >
              <h3 className="text-xs font-semibold text-blossom-ink">
                {currentStrategy?.eventLabel || currentStrategy?.eventKey || strategy.market}
              </h3>
              <div className="flex items-center gap-2">
              <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
                currentStatus === 'draft'
                  ? 'bg-gray-100 text-gray-600'
                  : currentStatus === 'queued'
                  ? 'bg-blossom-slate/10 text-blossom-slate'
                  : currentStatus === 'executing'
                  ? 'bg-blossom-pink/10 text-blossom-pink border border-blossom-pink/30'
                    : (currentStatus as string) === 'blocked'
                  ? 'bg-amber-100 text-amber-700 border border-amber-300'
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
                   (currentStatus as string) === 'blocked' ? 'Needs funding' :
                 currentStatus === 'executed' && !isClosed ? 'Executed' :
                 isClosed && currentStrategy?.eventOutcome === 'won' ? 'Settled - Won' :
                 isClosed && currentStrategy?.eventOutcome === 'lost' ? 'Settled - Lost' :
                 isClosed ? 'Closed' : 'Active'}
              </span>
                <svg
                  className={`w-3 h-3 text-slate-400 transition-transform ${isCardExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </div>
            </button>
            
            {/* Collapsed: 2 compact rows (perp, event, and DeFi) */}
            {!isCardExpanded && (currentStrategy || defiProposal) && (() => {
              const preview = getCollapsedPreviewFields(
                currentStrategy || undefined, 
                defiProposal || undefined, 
                strategy || undefined,
                account.accountValue || 10000 // Pass account value for deriving amounts
              );
              if (!preview) return null;
              
              // Determine tone: pending (yellow-ish) for drafts/proposed, neutral (gray) for executed/active
              const isPending = isDraft || (defiProposal?.status === 'proposed');
              const textTone = isPending ? 'text-amber-700' : 'text-slate-600';
              const secondaryTone = isPending ? 'text-amber-600' : 'text-slate-500';
              
              // Extract side/color for perp/event
              const sideColor = currentStrategy?.instrumentType === 'perp' 
                ? (strategy.side === 'Long' ? 'text-emerald-600' : 'text-rose-600')
                : currentStrategy?.instrumentType === 'event'
                ? ((currentStrategy.eventSide || strategy.side) === 'YES' ? 'text-emerald-600' : 'text-rose-600')
                : 'text-slate-700';
              
              // Get routing display
              let routingDisplay = preview.routingLabel;
              if (currentStrategy?.instrumentType === 'perp') {
                const route = getSimulatedRouteDisplay({
                  strategyId,
                  market: strategy.market,
                  instrumentType: currentStrategy?.instrumentType,
                  executionMode,
                });
                routingDisplay = executionMode === 'auto' || executionMode === undefined
                  ? `${route.venueLabel} • ${route.chainLabel}`
                  : formatVenueDisplay(venue, executionMode);
              } else if (currentStrategy?.instrumentType === 'event') {
                const venueDisplay = formatEventVenueDisplay(currentStrategy.eventMarketSource);
                const chainPart = venueDisplay.chain === '—' ? '' : ` • ${venueDisplay.chain}`;
                routingDisplay = `${venueDisplay.venue}${chainPart}`;
              }
              
              return (
                <div className="px-3 py-2 space-y-1.5 text-[11px]">
                  {/* Row 1: Primary info */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      {currentStrategy && (
                        <span className={`font-medium ${sideColor}`}>
                          {preview.primaryLabel.split(' ')[0]}
                        </span>
                      )}
                      {!currentStrategy && defiProposal && (
                        <span className={`font-medium ${textTone}`}>
                          {preview.primaryLabel}
                        </span>
                      )}
                      {currentStrategy && (
                        <>
                          <span className={textTone}>{preview.primaryLabel.split(' ').slice(1).join(' ')}</span>
                          <span className="text-slate-400">•</span>
                        </>
                      )}
                      <span className={`truncate ${textTone}`}>
                        {preview.primaryValue}
                      </span>
                    </div>
                    {preview.secondaryValue && (
                      <div className={`flex items-center gap-2 flex-shrink-0 ${secondaryTone}`}>
                        <span>{preview.secondaryValue}</span>
                      </div>
                    )}
                  </div>
                  
                  {/* Row 2: Routing/Execution */}
                  <div className={`flex items-center justify-between ${secondaryTone}`}>
                    <span className="truncate">
                      {routingDisplay}
                      {currentStrategy?.instrumentType === 'event' && (
                        <span className="text-slate-400 text-[9px]"> (simulated)</span>
                      )}
                    </span>
                    {preview.routingValue && (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-slate-400 text-[9px]">{preview.routingValue}</span>
                      </div>
                    )}
                    {currentStrategy?.instrumentType === 'event' && !preview.routingValue && (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-slate-400 text-[9px]">Max payout: {formatUsdOrDash(currentStrategy.maxPayoutUsd ?? strategy.takeProfit)}</span>
                      </div>
                    )}
                    {currentStrategy?.instrumentType === 'perp' && (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {(() => {
                          const route = getSimulatedRouteDisplay({
                            strategyId,
                            market: strategy.market,
                            instrumentType: currentStrategy?.instrumentType,
                            executionMode,
                          });
                          return <span className="text-slate-400 text-[9px]">{route.slippageLabel}</span>;
                        })()}
                      </div>
                    )}
                  </div>
                  
                  {/* Chips row (single-line, truncation-safe) */}
                  {(isExecuted || isDraft || (defiProposal && defiProposal.status === 'proposed')) && (
                    <div className="flex items-center gap-1.5 flex-wrap overflow-hidden">
                      {isExecuted && (
                        <>
                          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-blue-50 text-blue-700 whitespace-nowrap">Monitoring</span>
                          {currentStrategy?.instrumentType === 'perp' && currentStrategy.stopLoss && currentStrategy.stopLoss > 0 && (
                            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-rose-50 text-rose-700 whitespace-nowrap">SL armed</span>
                          )}
                          {currentStrategy?.instrumentType === 'perp' && currentStrategy.takeProfit && currentStrategy.takeProfit > 0 && (
                            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-emerald-50 text-emerald-700 whitespace-nowrap">TP armed</span>
                          )}
                          {currentStrategy && <RiskBadge riskPercent={strategy.riskPercent} />}
                        </>
                      )}
                      {(isDraft || (defiProposal && defiProposal.status === 'proposed')) && (
                        <span className="text-slate-500 text-[10px] whitespace-nowrap">Draft ready to confirm</span>
                      )}
                    </div>
                  )}
                  
                  {/* CTA row (collapsed) - only for drafts */}
                  {isDraft && strategyId && (
                    <div className="pt-1.5 border-t border-slate-100">
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (onConfirmDraft) {
                            onConfirmDraft(strategyId);
                          } else {
                            handleConfirmAndQueue();
                          }
                        }}
                        disabled={!!disableReason}
                        className={`w-full px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                          !disableReason
                            ? 'bg-blossom-pink text-white hover:bg-blossom-pink/90 shadow-sm'
                            : 'bg-blossom-outline/40 text-slate-400 cursor-not-allowed'
                        }`}
                        title={disableReason ?? (isVeryHighRisk ? 'Risk is elevated, proceed with caution' : undefined)}
                      >
                        Confirm & Execute
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}
            
            {/* Expanded: Full details */}
            {isCardExpanded && (
            <div className="max-h-[60vh] overflow-y-auto p-3 pt-1.5">
              <div className="grid grid-cols-2 gap-1.5 text-xs mb-2">
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
                      <div className="font-medium text-blossom-ink">{formatUsdOrDash(currentStrategy.stakeUsd ?? strategy.entryPrice)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-blossom-slate mb-0.5">Max Payout</div>
                      <div className="font-medium text-blossom-success">{formatUsdOrDash(currentStrategy.maxPayoutUsd ?? strategy.takeProfit)}</div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-xs text-blossom-slate mb-0.5">Max Loss</div>
                      <div className="font-medium text-blossom-danger">{formatUsdOrDash(currentStrategy.maxLossUsd ?? strategy.stopLoss)}</div>
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
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-blossom-ink">
                        {strategy.riskPercent}%
                        {(() => {
                          const riskUsd = (strategy.riskPercent / 100) * account.accountValue;
                          return riskUsd > 0 ? (
                            <span className="text-[11px] text-slate-500 ml-1">
                              · ${riskUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </span>
                          ) : null;
                        })()}
                      </span>
                      <RiskBadge riskPercent={strategy.riskPercent} />
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-blossom-slate mb-0.5">Entry</div>
                      <div className="flex items-center gap-1">
                        <span className="font-medium text-blossom-ink">{formatUsdOrDash(perpDisplay.entry)}</span>
                        {perpDisplay.hasLive && (
                          <span 
                            className="text-slate-400 text-[9px]"
                            title="Prices are live. Execution is simulated. TP/SL are indicative for demo."
                          >
                            Live
                          </span>
                        )}
                      </div>
                  </div>
                  <div>
                    <div className="text-xs text-blossom-slate mb-0.5">Take Profit</div>
                      <div className="flex items-center gap-1">
                        <span className="font-medium text-blossom-success">{formatUsdOrDash(perpDisplay.tp)}</span>
                        {perpDisplay.hasLive && (
                          <span 
                            className="text-slate-400 text-[9px]"
                            title="Prices are live. Execution is simulated. TP/SL are indicative for demo."
                          >
                            Live
                          </span>
                        )}
                      </div>
                  </div>
                  <div>
                    <div className="text-xs text-blossom-slate mb-0.5">Stop Loss</div>
                      <div className="flex items-center gap-1">
                        <span className="font-medium text-blossom-danger">{formatUsdOrDash(perpDisplay.sl)}</span>
                        {perpDisplay.hasLive && (
                          <span 
                            className="text-slate-400 text-[9px]"
                            title="Prices are live. Execution is simulated. TP/SL are indicative for demo."
                          >
                            Live
                          </span>
                        )}
                      </div>
                  </div>
                </>
              )}
            </div>
            
            {/* Explanation microcopy */}
            {currentStrategy?.instrumentType === 'perp' && (
              <div className="mt-1.5 px-3 pb-1.5">
                <p className="text-[11px] text-slate-500">
                  Blossom interpreted this as: <span className="font-medium text-slate-700">{strategy.side}</span>{' '}
                  {(() => {
                    // Use final notional if available (after execution), otherwise compute from parsed values
                    const notionalUsd = currentStrategy.notionalUsd || (strategy.riskPercent / 100) * account.accountValue * (currentStrategy.leverage || 1);
                    return `$${notionalUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} notional`;
                  })()} on <span className="font-medium text-slate-700">{strategy.market}</span>{' '}
                  {(() => {
                    return `at ${formatLeverage(currentStrategy.leverage)}`;
                  })()} using {(() => {
                    // Use final margin if available, otherwise compute from riskPercent
                    const marginUsd = currentStrategy.marginUsd || (strategy.riskPercent / 100) * account.accountValue;
                    const marginPct = account.accountValue > 0 ? (marginUsd / account.accountValue) * 100 : 0;
                    return `$${marginUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} margin (~${marginPct.toFixed(1)}% of portfolio)`;
                  })()}
                  {perpDisplay.hasLive && (
                    <span className="text-slate-400 text-[9px] ml-1" title="Prices are live. Execution is simulated. TP/SL are indicative for demo.">
                      (Live prices)
                    </span>
                  )}.
                  {/* Step 3: Show collateral note if margin is capped or blocked */}
                  {((currentStrategy as any).executionNote || currentStrategy.marginUsd === 0 || 
                    (currentStrategy.marginUsd && currentStrategy.marginUsd < (strategy.riskPercent / 100) * account.accountValue)) && (
                    <span className="block mt-0.5 text-[10px] text-slate-400 italic">
                      Perps are collateralized by bUSDC only in this demo.
                    </span>
                  )}
                  {(currentStrategy as any).executionNote && (
                    <span className="block mt-0.5 text-[10px] text-amber-600">Note: {(currentStrategy as any).executionNote}</span>
                  )}
                </p>
              </div>
            )}
            {currentStrategy?.instrumentType === 'event' && currentStrategy && (
              <div className="mt-1.5 px-3 pb-1.5">
                <p className="text-[11px] text-slate-500">
                  Blossom interpreted this as: <span className="font-medium text-slate-700">{currentStrategy.eventSide || strategy.side}</span>{' '}
                  {formatUsdOrDash(currentStrategy.stakeUsd ?? strategy.entryPrice)} on{' '}
                  <span className="font-medium text-slate-700">{currentStrategy.eventLabel || currentStrategy.eventKey || strategy.market}</span>{' '}
                  with max payoff of {formatUsdOrDash(currentStrategy.maxPayoutUsd ?? strategy.takeProfit)} if your outcome wins.
                </p>
              </div>
            )}
            
            {/* Risk Guardrails - only show when expanded */}
            {isCardExpanded && (
              <>
            {/* Risk Guardrails */}
            {!isHighRisk && (
              <div className="mt-1.5 text-[11px] text-gray-500">
                This keeps your per-strategy risk at or below {maxPerTrade}% of account.
              </div>
            )}
            {isHighRisk && (
              <div className="mt-1.5 rounded-md bg-yellow-50 px-2.5 py-1.5 text-[11px] text-yellow-800 border border-yellow-200">
                This strategy uses {strategy.riskPercent}% of your account, above your typical {maxPerTrade}% risk per trade.
                Make sure you're comfortable with a larger drawdown.
              </div>
            )}
            
            {isBlocked && (
              <div className="pt-1.5 border-t border-blossom-outline/50 space-y-2">
                <div className="text-[11px] text-amber-700 mb-2 px-1">
                  {(currentStrategy as any)?.executionNote || 'Insufficient bUSDC collateral to open this position.'}
                </div>
                <button 
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // Feature 8: Fund REDACTED button (disabled - fundUsdc not available)
                    // if (fundUsdc) {
                    //   fundUsdc(2000);
                      if (import.meta.env.DEV) {
                      console.warn('[MessageBubble] fundUsdc not available');
                      }
                    // }
                  }}
                  className="w-full h-10 px-4 text-sm font-medium rounded-xl transition-all bg-amber-500 hover:bg-amber-600 text-white shadow-sm"
                >
                  Fund bUSDC
                </button>
              </div>
            )}
            {/* Part 1: Inline high-risk warning (compact, collapses after confirm) */}
            {isDraft && showRiskWarning && riskReasons && riskReasons.length > 0 && (
              <div className="mb-3 p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <div className="text-xs font-medium text-amber-800 mb-1">High-risk trade</div>
                    <ul className="text-xs text-amber-700 space-y-0.5 list-disc list-inside">
                      {riskReasons.map((reason, idx) => (
                        <li key={idx}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
            {/* Part 1: Draft action button - only "Confirm & Execute" (no Edit/Cancel) */}
            {isDraft && strategyId && (
              <div className="pt-3 border-t border-slate-100">
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (onConfirmDraft) {
                      onConfirmDraft(strategyId);
                    } else {
                      // Fallback to existing handler
                      handleConfirmAndQueue();
                    }
                  }}
                  data-testid="confirm-trade"
                  {...(currentStrategy?.instrumentType === 'event' ? { 'data-coachmark': 'event-confirm' } : {})}
                  disabled={!!disableReason}
                  className={`w-full px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                    !disableReason
                      ? 'bg-blossom-pink text-white hover:bg-blossom-pink/90 shadow-sm'
                      : 'bg-blossom-outline/40 text-slate-400 cursor-not-allowed'
                  }`}
                  title={disableReason ?? (isVeryHighRisk ? 'Risk is elevated, proceed with caution' : undefined)}
                >
                  Confirm & Execute
                </button>
              </div>
            )}
            
            {/* Execution Details Disclosure - shown for draft/queued/executed */}
            {(isDraft || currentStatus === 'queued' || isExecuted) && (
              <ExecutionDetailsDisclosure
                strategy={currentStrategy || undefined}
                defiPosition={defiProposalId ? (defiPositions.find(p => p.id === defiProposalId) || undefined) : undefined}
                venue={venue}
                isExecuted={isExecuted && !isClosed}
                executionMode={executionMode}
              />
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
                className="w-full h-9 px-3 text-xs font-medium rounded-xl bg-blossom-success text-white hover:bg-blossom-success/90 hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                {isClosing ? 'Closing...' : 'Close & Settle (Sim)'}
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
              <div className="mt-1.5 px-2.5 py-1 text-[11px] font-medium rounded-lg bg-gray-100 text-gray-700 text-center">
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
              <div className="mt-1.5 px-2.5 py-1 text-[11px] font-medium rounded-lg bg-gray-100 text-gray-700 text-center">
                {currentStatus === 'queued' ? 'Queued...' : 'Executing...'}
              </div>
            )}
              </>
            )}
            </div>
            )}
          </div>
        )}
        
        {/* Reasoning Block - 2 bullets max + "More rationale" disclosure */}
        {!isUser && strategy && (
          <div className="mt-1.5 rounded-lg border border-gray-100/80 bg-gray-50/60 px-2.5 py-1.5">
            <div className="text-[11px] font-medium text-gray-600 mb-1">Why this setup?</div>
            <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-gray-600">
              {getStrategyReasoning(strategy, currentStrategy?.instrumentType).slice(0, 2).map((line, idx) => (
                <li key={idx}>{line}</li>
              ))}
            </ul>
            {getStrategyReasoning(strategy, currentStrategy?.instrumentType).length > 2 && (
              <>
            <button
              onClick={() => setShowReasoning(!showReasoning)}
                  className="text-left mt-1.5 pt-1.5 border-t border-gray-200/60 w-full"
                >
                  <span className="text-[10px] text-gray-500 hover:text-gray-700 underline">{showReasoning ? 'Less' : 'More rationale'}</span>
            </button>
            {showReasoning && (
              <div className="mt-1.5 pt-1.5 border-t border-gray-200/60">
                <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-gray-600">
                      {getStrategyReasoning(strategy, currentStrategy?.instrumentType).slice(2).map((line, idx) => (
                        <li key={idx + 2}>{line}</li>
                  ))}
                </ul>
                
                {biasWarning && (
                  <div className="mt-1.5 rounded-md bg-blossom-pinkSoft/60 px-2 py-1 text-[10px] text-blossom-ink border border-blossom-pink/30">
                    {biasWarning}
                  </div>
                )}
                  </div>
                )}
              </>
            )}
            {biasWarning && getStrategyReasoning(strategy, currentStrategy?.instrumentType).length <= 2 && (
              <div className="mt-1.5 rounded-md bg-blossom-pinkSoft/60 px-2 py-1 text-[10px] text-blossom-ink border border-blossom-pink/30">
                {biasWarning}
              </div>
            )}
          </div>
        )}
        
        {/* Follow-up Suggestions */}
        {!isUser && strategy && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            <button
              onClick={() => handleSuggestionClick(`Simulate PnL for this strategy if ${strategy.market.replace('-PERP', '')} moves ±10%`)}
              className="px-2.5 py-1 text-[11px] font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors"
            >
              Simulate PnL if price moves ±10%
            </button>
            <button
              onClick={() => handleSuggestionClick('Show liquidation risk for this strategy')}
              className="px-2.5 py-1 text-[11px] font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors"
            >
              Show liquidation risk
            </button>
            <button
              onClick={() => handleSuggestionClick(`Hedge this ${strategy.market} ${strategy.side.toLowerCase()} exposure`)}
              className="px-2.5 py-1 text-[11px] font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors"
            >
              Hedge this exposure
            </button>
            <button
              onClick={() => {
                setSelectedStrategyId(strategyId || null);
                setActiveTab('portfolio');
              }}
              className="px-2.5 py-1 text-[11px] font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors"
            >
              Show portfolio impact
            </button>
          </div>
        )}
        
        {/* DeFi Plan Card */}
        {!isUser && defiProposal && (
          <div className="mt-1.5 w-full max-w-md bg-white rounded-2xl shadow-sm border border-blossom-outline strategy-card">
            {/* Header - clickable to expand/collapse */}
            <button
              onClick={() => setIsCardExpanded(!isCardExpanded)}
              className="w-full flex items-center justify-between p-3 pb-1.5 border-b border-blossom-outline/20 hover:bg-slate-50/50 transition-colors"
            >
              <h3 className="text-sm font-semibold text-blossom-ink">DeFi Plan</h3>
              <div className="flex items-center gap-2">
                <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
                  defiProposal.status === 'proposed'
                    ? 'bg-gray-100 text-gray-600'
                    : 'bg-blossom-pink text-white'
                }`}>
                  {defiProposal.status === 'proposed' ? 'Proposed' : 'Active'}
                </span>
                <svg
                  className={`w-3 h-3 text-slate-400 transition-transform ${isCardExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>
            
            {/* Collapsed: DeFi preview (unified with perps/events) */}
            {!isCardExpanded && defiProposal && (() => {
              const preview = getCollapsedPreviewFields(
                undefined,
                defiProposal,
                undefined,
                account.accountValue || 10000
              );
              if (!preview) return null;
              
              const isPending = defiProposal.status === 'proposed';
              const textTone = isPending ? 'text-amber-700' : 'text-slate-600';
              const secondaryTone = isPending ? 'text-amber-600' : 'text-slate-500';
              
              return (
                <div className="px-3 py-2 space-y-1.5 text-[11px]">
                  {/* Row 1: Primary info */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`font-medium ${textTone}`}>
                        {preview.primaryLabel}
                      </span>
                      <span className="text-slate-400">•</span>
                      <span className={`truncate ${textTone}`}>
                        {preview.primaryValue}
                      </span>
                    </div>
                    {preview.secondaryValue && (
                      <div className={`flex items-center gap-2 flex-shrink-0 ${secondaryTone}`}>
                        <span>{preview.secondaryValue}</span>
                      </div>
                    )}
                  </div>
                  
                  {/* Row 2: Routing/Execution */}
                  <div className={`flex items-center justify-between ${secondaryTone}`}>
                    <span className="truncate">
                      {preview.routingLabel}
                    </span>
                  </div>
                </div>
              );
            })()}
            
            {/* Expanded: Full details */}
            {isCardExpanded && (
            <div className="max-h-[60vh] overflow-y-auto p-3 pt-1.5">
              <div className="grid grid-cols-2 gap-1.5 text-xs mb-2">
              <div>
                <div className="text-xs text-blossom-slate mb-0.5">Protocol</div>
                <div className="text-xs font-medium text-blossom-ink">{defiProposal.protocol}</div>
              </div>
              <div>
                <div className="text-xs text-blossom-slate mb-0.5">Asset</div>
                <div className="text-xs font-medium text-blossom-ink">{defiProposal.asset}</div>
              </div>
              <div>
                <div className="text-xs text-blossom-slate mb-0.5">Deposit</div>
                <div className="text-xs font-medium text-blossom-ink">${defiProposal.depositUsd.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-blossom-slate mb-0.5">APY</div>
                <div className="text-xs font-medium text-blossom-success">{defiProposal.apyPct}%</div>
              </div>
            </div>
            <div className="text-[11px] text-blossom-slate mb-2 pt-1.5 border-t border-blossom-outline/50">
              <div className="mb-1">Choosing the highest APY within your risk band using idle bUSDC.</div>
              <div className="text-[10px] text-slate-400">Execution (simulated): Bridge → Swap → Deposit</div>
            </div>
            {defiProposal.status === 'proposed' ? (
              <div className="pt-1.5 border-t border-blossom-outline/50">
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    confirmDefiPlan(defiProposal.id);
                  }}
                  className="w-full h-10 px-4 text-sm font-medium rounded-xl bg-blossom-pink text-white hover:bg-blossom-pink/90 hover:shadow-md transition-all shadow-sm"
                >
                  Confirm & Execute
                </button>
              </div>
            ) : (
              <div className="w-full h-9 px-3 text-xs font-medium text-center text-blossom-slate bg-blossom-pinkLight rounded-xl flex items-center justify-center">
                Active
              </div>
            )}
            <div className="mt-2 pt-1.5 border-t border-blossom-outline/50 text-[11px] text-blossom-slate">
              Instrument: DeFi yield (Sim – no real deposits)
            </div>
            </div>
            )}
            
            {/* Collapsed CTA for DeFi */}
            {!isCardExpanded && defiProposal.status === 'proposed' && (
              <div className="px-3 py-2 pt-1.5 border-t border-slate-100">
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    confirmDefiPlan(defiProposal.id);
                  }}
                  className="w-full px-3 py-2 text-xs font-medium rounded-lg bg-blossom-pink text-white hover:bg-blossom-pink/90 shadow-sm transition-colors"
                >
                  Confirm & Execute
                </button>
              </div>
            )}
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
        <div className="text-[11px] text-slate-400 mt-1">
          {timestamp}
        </div>
      </div>
    </div>
  );
}
