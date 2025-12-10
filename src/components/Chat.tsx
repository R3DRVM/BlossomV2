import { useState, useRef, useEffect } from 'react';
import MessageBubble from './MessageBubble';
import TypingIndicator from './TypingIndicator';
import { parseUserMessage, generateBlossomResponse, ParsedStrategy } from '../lib/mockParser';
import { useBlossomContext, ActiveTab, ChatMessage, Strategy } from '../context/BlossomContext';
import { USE_AGENT_BACKEND } from '../lib/config';
import { callBlossomChat } from '../lib/blossomApi';
import QuickStartPanel from './QuickStartPanel';

// Re-export Message type for backward compatibility
export type Message = ChatMessage;

interface ChatProps {
  selectedStrategyId: string | null;
  onRegisterInsertPrompt?: (handler: (text: string) => void) => void;
}

const SUGGESTIONS = [
  'Long ETH with 3% risk, manage liquidation for me.',
  'Show my riskiest positions and how to reduce risk.',
  'Build a market-neutral funding strategy on BTC.',
  'Hedge my SOL spot with perps at 2% risk.',
];

// Legacy conveyor belt quick prompts (kept for potential re-enablement)
// Set showLegacyQuickActions = true to restore the old conveyor belt UI
// @ts-ignore - intentionally unused, kept for potential re-enablement
const showLegacyQuickActions = false;

// @ts-ignore - intentionally unused, kept for potential re-enablement
const QUICK_PROMPTS_PERPS = [
  'Long ETH with 3% risk and manage liquidation for me',
  'Park half my idle REDACTED into the safest yield on Kamino',
  'Market-neutral BTC funding strategy',
  'Hedge my SOL spot with perps',
];

// @ts-ignore - intentionally unused, kept for potential re-enablement
const QUICK_PROMPTS_EVENTS = [
  'What are the top 5 prediction markets on Kalshi right now?',
  'What are the top 5 trending prediction markets on Polymarket?',
  'Risk 2% of my account on the highest-volume prediction market.',
];

// Welcome message constant
const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome-0',
  text: 'Hi, I\'m your trading copilot. Tell me what you\'d like to trade and how much risk you want to take.\n\nYou can scroll up to review past strategies, and select any strategy from the Execution Queue on the right.',
  isUser: false,
  timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
};

// Helper to generate session title from first user message
function generateSessionTitle(text: string): string {
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/);
  if (words.length <= 8) {
    return trimmed;
  }
  return words.slice(0, 8).join(' ') + '…';
}

export default function Chat({ selectedStrategyId, onRegisterInsertPrompt }: ChatProps) {
  const { 
    addDraftStrategy, 
    setOnboarding, 
    activeTab, 
    venue, 
    account, 
    createDefiPlanFromCommand, 
    updateFromBackendPortfolio, 
    strategies, 
    updateEventStake,
    updateStrategy,
    getBaseAsset,
    chatSessions,
    activeChatId,
    createNewChatSession,
    appendMessageToActiveChat,
    updateChatSessionTitle,
  } = useBlossomContext();
  
  // Derive current session and messages from context
  const currentSession = chatSessions.find(s => s.id === activeChatId) || null;
  const messages = currentSession?.messages ?? [];
  
  // Track if we've shown welcome message for current session
  const hasShownWelcomeRef = useRef<Set<string>>(new Set());
  
  // Ensure welcome message is shown for new/empty sessions
  useEffect(() => {
    if (activeChatId && currentSession && currentSession.messages.length === 0 && !hasShownWelcomeRef.current.has(activeChatId)) {
      appendMessageToActiveChat(WELCOME_MESSAGE);
      hasShownWelcomeRef.current.add(activeChatId);
    }
  }, [activeChatId, currentSession, appendMessageToActiveChat]);
  
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [showQuickStart, setShowQuickStart] = useState(true);
  const strategyRefsMap = useRef<Map<string, HTMLDivElement>>(new Map());
  const lastActiveTabRef = useRef<ActiveTab | null>(null);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % SUGGESTIONS.length);
    }, 7000);
    return () => clearInterval(interval);
  }, []);
  
  // Restore scroll position when returning to copilot tab
  useEffect(() => {
    if (activeTab === 'copilot' && lastActiveTabRef.current !== 'copilot') {
      // Just switched to copilot tab
      if (selectedStrategyId) {
        const strategyElement = strategyRefsMap.current.get(selectedStrategyId);
        if (strategyElement && messagesContainerRef.current) {
          setTimeout(() => {
            strategyElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 100);
        }
      } else {
        // No selected strategy, scroll to bottom
        setTimeout(() => {
          if (messagesContainerRef.current) {
            messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
          }
        }, 100);
      }
    }
    lastActiveTabRef.current = activeTab;
  }, [activeTab, selectedStrategyId]);

  const checkIfAtBottom = () => {
    if (messagesContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
      const threshold = 100; // pixels from bottom
      setIsAtBottom(scrollHeight - scrollTop - clientHeight < threshold);
    }
  };

  useEffect(() => {
    if (isAtBottom && messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages.length, isTyping, isAtBottom]);

  const handleScroll = () => {
    checkIfAtBottom();
  };

  const handleSend = async () => {
    if (!inputValue.trim() || isTyping) return;

    const userText = inputValue.trim();
    
    // Create session if none exists
    let currentActiveChatId = activeChatId;
    if (!currentActiveChatId) {
      currentActiveChatId = createNewChatSession();
      // Add welcome message to new session (will be added by useEffect, but ensure it's marked)
      hasShownWelcomeRef.current.add(currentActiveChatId);
    }
    
    // Ensure unique message ID with timestamp + random component
    const userMessageId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const userMessage: ChatMessage = {
      id: userMessageId,
      text: userText,
      isUser: true,
      timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    };

    // Update session title if this is the first user message
    // We need to check the session after we get the current one, but before appending
    // So we check the current session state
    const session = chatSessions.find(s => s.id === currentActiveChatId);
    if (session && session.title === 'New chat') {
      const userMessages = session.messages.filter(m => m.isUser);
      if (userMessages.length === 0) {
        const title = generateSessionTitle(userText);
        updateChatSessionTitle(currentActiveChatId, title);
      }
    }
    
    // Append user message
    appendMessageToActiveChat(userMessage);
    setInputValue('');
    setIsTyping(true);
    setIsAtBottom(true);

    if (USE_AGENT_BACKEND) {
      // Agent mode: call backend
      console.log('[Chat] Using AGENT backend mode - request will go to backend');
      try {
        const response = await callBlossomChat({
          userMessage: userText,
          venue,
          clientPortfolio: {
            accountValueUsd: account.accountValue,
            balances: account.balances,
            openPerpExposureUsd: account.openPerpExposure,
            eventExposureUsd: account.eventExposureUsd,
          },
        });

        // Update state from backend portfolio
        updateFromBackendPortfolio(response.portfolio);

        // Find strategy IDs from actions
        let strategyId: string | null = null;
        let strategy: ParsedStrategy | null = null;
        let defiProposalId: string | null = null;

        if (response.actions && response.actions.length > 0) {
          const action = response.actions[0];
          // Find the strategy that matches this action
          // The backend should have created it, so we look for the most recent matching strategy
          const matchingStrategy = response.portfolio.strategies?.find((s: any) => {
            if (action.type === 'perp') {
              return s.type === 'perp' && s.market === action.market && s.side === action.side;
            } else if (action.type === 'event') {
              return s.type === 'event' && s.eventKey === action.eventKey;
            } else if (action.type === 'defi') {
              return s.type === 'defi' && s.protocol === action.protocol;
            }
            return false;
          });

          if (matchingStrategy) {
            strategyId = matchingStrategy.id;
            if (action.type === 'perp') {
              strategy = {
                market: action.market,
                side: action.side === 'long' ? 'Long' : 'Short',
                riskPercent: action.riskPct,
                entryPrice: action.entry || 0,
                takeProfit: action.takeProfit || 0,
                stopLoss: action.stopLoss || 0,
                liqBuffer: 15,
                fundingImpact: 'Low',
              };
            } else if (action.type === 'event') {
              strategy = {
                market: action.eventKey,
                side: action.side === 'YES' ? 'Long' : 'Short',
                riskPercent: (action.stakeUsd / account.accountValue) * 100,
                entryPrice: action.stakeUsd,
                takeProfit: action.maxPayoutUsd,
                stopLoss: action.maxLossUsd,
                liqBuffer: 0,
                fundingImpact: 'Low',
              };
            }
          }

          // Check for DeFi proposal
          if (action.type === 'defi') {
            const defiPos = response.portfolio.defiPositions?.find((p: any) => 
              p.protocol === action.protocol && !p.isClosed
            );
            if (defiPos) {
              defiProposalId = defiPos.id;
            }
            setOnboarding(prev => ({ ...prev, queuedStrategy: true })); // DeFi counts as "queued"
          } else if (action.type === 'perp') {
            setOnboarding(prev => ({ ...prev, openedTrade: true })); // Perp trade
          } else if (action.type === 'event') {
            setOnboarding(prev => ({ ...prev, openedTrade: true })); // Event also counts
          }
        }

        const blossomResponse: ChatMessage = {
          id: `assistant-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          text: response.assistantMessage,
          isUser: false,
          timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          strategy: strategy,
          strategyId: strategyId,
          defiProposalId: defiProposalId,
        };
        // Always append - never replace
        appendMessageToActiveChat(blossomResponse);
        setIsTyping(false);
      } catch (error: any) {
        console.error('Agent backend error:', error);
        const errorMessage: ChatMessage = {
          id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          text: "I couldn't reach the agent backend, so I didn't execute anything. Please try again.",
          isUser: false,
          timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        };
        // Always append - never replace
        appendMessageToActiveChat(errorMessage);
        setIsTyping(false);
      }
    } else {
      // Mock mode: existing behavior
      console.log('[Chat] Using MOCK mode - request handled locally, backend not called');
      const parsed = parseUserMessage(userText, { venue, strategies, selectedStrategyId });

      // Simulate thinking delay
      setTimeout(() => {
        let strategyId: string | null = null;
        let strategy: ParsedStrategy | null = null;
        let defiProposalId: string | null = null;

        if (parsed.intent === 'defi') {
          // Create DeFi plan and get the proposal
          const defiProposal = createDefiPlanFromCommand(userText);
          defiProposalId = defiProposal.id;
          setOnboarding(prev => ({ ...prev, queuedStrategy: true }));
        } else if (parsed.intent === 'event' && parsed.eventStrategy) {
          // Create event strategy
          const eventStrat = parsed.eventStrategy;
          
          // Calculate stake with 3% risk cap
          const maxEventRiskPct = 0.03; // 3% per-strategy cap (same as perps)
          const maxStakeUsd = Math.round(account.accountValue * maxEventRiskPct);
          
          let stakeUsd: number;
          let requestedStakeUsd: number | undefined = undefined;
          let wasCapped = false;
          
          if (eventStrat.stakeUsd) {
            requestedStakeUsd = eventStrat.stakeUsd;
            stakeUsd = Math.min(eventStrat.stakeUsd, maxStakeUsd);
            wasCapped = eventStrat.stakeUsd > maxStakeUsd;
          } else {
            const riskPct = eventStrat.riskPercent || 1;
            stakeUsd = (account.accountValue * riskPct) / 100;
            stakeUsd = Math.min(stakeUsd, maxStakeUsd);
            wasCapped = (eventStrat.riskPercent || 1) * account.accountValue / 100 > maxStakeUsd;
          }
          
          // Also check available REDACTED balance
          const usdcBalance = account.balances.find(b => b.symbol === 'REDACTED');
          const availableUsdc = usdcBalance?.balanceUsd || 0;
          stakeUsd = Math.min(stakeUsd, availableUsdc);
          
          const maxPayoutUsd = stakeUsd * 1.7;
          const riskPct = (stakeUsd / account.accountValue) * 100;
          
          // Store capping info for response message
          (eventStrat as any).requestedStakeUsd = requestedStakeUsd;
          (eventStrat as any).wasCapped = wasCapped;
          (eventStrat as any).finalStakeUsd = stakeUsd;
          
          const newStrategy = addDraftStrategy({
            side: eventStrat.eventSide === 'YES' ? 'Long' : 'Short',
            market: eventStrat.eventKey,
            riskPercent: riskPct,
            entry: stakeUsd,
            takeProfit: maxPayoutUsd,
            stopLoss: stakeUsd,
            sourceText: userText,
            instrumentType: 'event',
            eventKey: eventStrat.eventKey,
            eventLabel: eventStrat.eventLabel,
            eventSide: eventStrat.eventSide,
            stakeUsd: stakeUsd,
            maxPayoutUsd: maxPayoutUsd,
            maxLossUsd: stakeUsd,
            overrideRiskCap: false, // Default: no override
            requestedStakeUsd: requestedStakeUsd, // Store original request
          });
          strategyId = newStrategy.id;
          strategy = {
            market: eventStrat.eventKey,
            side: eventStrat.eventSide === 'YES' ? 'Long' : 'Short',
            riskPercent: riskPct,
            entryPrice: stakeUsd,
            takeProfit: maxPayoutUsd,
            stopLoss: stakeUsd,
            liqBuffer: 0,
            fundingImpact: 'Low',
          };
          setOnboarding(prev => ({ ...prev, openedTrade: true }));
        } else if (parsed.intent === 'modify_perp_strategy' && parsed.modifyPerpStrategy) {
          // Handle perp strategy modification
          const mod = parsed.modifyPerpStrategy;
          const targetStrategy = strategies.find(s => s.id === mod.strategyId);
          
          if (!targetStrategy || targetStrategy.instrumentType !== 'perp') {
            const errorMessage: ChatMessage = {
              id: `error-${Date.now()}`,
              text: "I don't see an active strategy to update yet — try asking me for a new trade first.",
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            };
            appendMessageToActiveChat(errorMessage);
            setIsTyping(false);
            return;
          }
          
          // Build update object
          const updates: Partial<Strategy> = {};
          let newRiskPercent = targetStrategy.riskPercent;
          let newNotionalUsd = targetStrategy.notionalUsd;
          
          // Apply modifications
          if (mod.modification.sizeUsd) {
            newNotionalUsd = mod.modification.sizeUsd;
            // Recalculate risk percent based on new size
            newRiskPercent = (newNotionalUsd / account.accountValue) * 100;
            updates.notionalUsd = newNotionalUsd;
          }
          
          if (mod.modification.riskPercent) {
            newRiskPercent = mod.modification.riskPercent;
            // Recalculate notional based on new risk percent
            newNotionalUsd = (account.accountValue * newRiskPercent) / 100;
            updates.riskPercent = newRiskPercent;
            updates.notionalUsd = newNotionalUsd;
          }
          
          if (mod.modification.leverage) {
            // Leverage affects notional for the same risk
            // For now, we'll just store it as a note or adjust risk accordingly
            // In a real system, leverage would affect position sizing
            // For mock mode, we'll treat it as adjusting the effective risk
            updates.riskPercent = newRiskPercent; // Keep risk the same, leverage is informational
          }
          
          if (mod.modification.side) {
            updates.side = mod.modification.side;
            // Recalculate TP/SL for new side
            const basePrice = targetStrategy.entry || 3500;
            if (mod.modification.side === 'Long') {
              updates.takeProfit = Math.round(basePrice * 1.04);
              updates.stopLoss = Math.round(basePrice * 0.97);
            } else {
              updates.takeProfit = Math.round(basePrice * 0.96);
              updates.stopLoss = Math.round(basePrice * 1.03);
            }
          }
          
          // Update the strategy
          if (mod.strategyId) {
            updateStrategy(mod.strategyId, updates);
          }
          
          // Create updated strategy object for display
          const updatedStrategy = { ...targetStrategy, ...updates };
          strategyId = updatedStrategy.id;
          strategy = {
            market: updatedStrategy.market,
            side: updatedStrategy.side,
            riskPercent: newRiskPercent,
            entryPrice: updatedStrategy.entry,
            takeProfit: updatedStrategy.takeProfit,
            stopLoss: updatedStrategy.stopLoss,
            liqBuffer: 15,
            fundingImpact: 'Low' as const,
          };
          
          // Generate response with risk warning
          (parsed as any).accountValue = account.accountValue;
          const responseText = generateBlossomResponse(parsed, userText);
          const blossomResponse: ChatMessage = {
            id: `modify-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            text: responseText,
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            strategy: strategy,
            strategyId: strategyId,
          };
          appendMessageToActiveChat(blossomResponse);
          setIsTyping(false);
          return;
        } else if (parsed.intent === 'update_event_stake' && parsed.updateEventStake) {
          // Update existing event strategy stake
          const update = parsed.updateEventStake;
          
          // Find the most recent event strategy (or use strategyId if provided)
          const eventStrategies = strategies.filter(s => 
            s.instrumentType === 'event' && 
            (s.status === 'executed' || s.status === 'executing') && 
            !s.isClosed
          );
          
          if (eventStrategies.length === 0) {
            const errorMessage: ChatMessage = {
              id: `error-${Date.now()}`,
              text: "I couldn't find an active event position to update. Please create an event position first.",
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            };
            appendMessageToActiveChat(errorMessage);
            setIsTyping(false);
            return;
          }
          
          const targetStrategy = update.strategyId 
            ? eventStrategies.find(s => s.id === update.strategyId)
            : eventStrategies[0]; // Use most recent if no ID specified
          
          if (!targetStrategy) {
            const errorMessage: ChatMessage = {
              id: `error-${Date.now()}`,
              text: "I couldn't find the event position to update.",
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            };
            appendMessageToActiveChat(errorMessage);
            setIsTyping(false);
            return;
          }
          
          // Determine new stake amount
          const accountValue = account.accountValue;
          const maxAllowedUsd = accountValue; // Hard sanity cap
          const requestedStake = update.newStakeUsd || targetStrategy.requestedStakeUsd || targetStrategy.stakeUsd || 0;
          const newStakeUsd = Math.min(requestedStake, maxAllowedUsd);
          
          // Calculate new values
          const maxPayoutUsd = newStakeUsd * (targetStrategy.maxPayoutUsd || 0) / (targetStrategy.stakeUsd || 1);
          const riskPct = (newStakeUsd / accountValue) * 100;
          
          // Update the strategy
          updateEventStake(targetStrategy.id, {
            stakeUsd: newStakeUsd,
            maxPayoutUsd,
            maxLossUsd: newStakeUsd,
            riskPercent: riskPct,
            overrideRiskCap: update.overrideRiskCap || false,
            requestedStakeUsd: requestedStake,
          });
          
          const blossomResponse: ChatMessage = {
            id: `update-${Date.now()}`,
            text: generateBlossomResponse(parsed, userText),
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          };
          appendMessageToActiveChat(blossomResponse);
          setIsTyping(false);
        } else if (parsed.intent === 'hedge' && parsed.strategy) {
          // Handle hedging: calculate net exposure and create opposite side
          const baseAsset = getBaseAsset(parsed.strategy.market);
          
          // Calculate net exposure for this asset
          const executedPerps = strategies.filter(s => 
            s.instrumentType === 'perp' && 
            (s.status === 'executed' || s.status === 'executing') && 
            !s.isClosed &&
            getBaseAsset(s.market) === baseAsset
          );
          
          let netLongExposure = 0;
          let netShortExposure = 0;
          
          executedPerps.forEach(s => {
            const notional = s.notionalUsd || (account.accountValue * s.riskPercent / 100);
            if (s.side === 'Long') {
              netLongExposure += notional;
            } else {
              netShortExposure += notional;
            }
          });
          
          const netExposure = netLongExposure - netShortExposure;
          
          // Determine hedge side: if net long, hedge with short; if net short, hedge with long
          let hedgeSide: 'Long' | 'Short' = 'Short';
          if (netExposure < 0) {
            // Net short, so hedge with long
            hedgeSide = 'Long';
          } else if (netExposure === 0) {
            // Already flat, don't create a hedge
            const blossomResponse: ChatMessage = {
              id: `hedge-${Date.now()}`,
              text: `You're already flat on ${baseAsset}. No hedge needed.`,
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            };
            appendMessageToActiveChat(blossomResponse);
            setIsTyping(false);
            return;
          }
          
          // Size the hedge to offset 50% of net exposure (partial hedge)
          // Or use the requested risk percent if specified
          const hedgeRiskPercent = parsed.strategy.riskPercent;
          
          // Adjust TP/SL for the hedge side
          const basePrice = parsed.strategy.entryPrice;
          const hedgeTakeProfit = hedgeSide === 'Long' 
            ? basePrice * 1.04  // 4% up for long hedge
            : basePrice * 0.96; // 4% down for short hedge
          const hedgeStopLoss = hedgeSide === 'Long'
            ? basePrice * 0.97  // 3% down for long hedge
            : basePrice * 1.03; // 3% up for short hedge
          
          // Create hedge strategy with opposite side
          const hedgeStrategy = {
            ...parsed.strategy,
            side: hedgeSide,
            takeProfit: Math.round(hedgeTakeProfit),
            stopLoss: Math.round(hedgeStopLoss),
          };
          
          const newStrategy = addDraftStrategy({
            side: hedgeSide,
            market: parsed.strategy.market,
            riskPercent: hedgeRiskPercent,
            entry: parsed.strategy.entryPrice,
            takeProfit: hedgeStrategy.takeProfit,
            stopLoss: hedgeStrategy.stopLoss,
            sourceText: userText,
            instrumentType: 'perp',
          });
          strategyId = newStrategy.id;
          strategy = hedgeStrategy;
          setOnboarding(prev => ({ ...prev, openedTrade: true }));
        } else if (parsed.intent === 'trade' && parsed.strategy) {
          // Create perp strategy (existing behavior)
          const newStrategy = addDraftStrategy({
            side: parsed.strategy.side,
            market: parsed.strategy.market,
            riskPercent: parsed.strategy.riskPercent,
            entry: parsed.strategy.entryPrice,
            takeProfit: parsed.strategy.takeProfit,
            stopLoss: parsed.strategy.stopLoss,
            sourceText: userText,
            instrumentType: 'perp',
          });
          strategyId = newStrategy.id;
          strategy = parsed.strategy;
          setOnboarding(prev => ({ ...prev, openedTrade: true }));
        }

        // Pass account value to response generator for capping messages
        (parsed as any).accountValue = account.accountValue;
        
        // For modify_perp_strategy, we already handled the response above
        if (parsed.intent === 'modify_perp_strategy') {
          // Response was already sent above, just return
          return;
        }
        
        const blossomResponse: ChatMessage = {
          id: `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          text: generateBlossomResponse(parsed, userText),
          isUser: false,
          timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          strategy: strategy,
          strategyId: strategyId,
          defiProposalId: defiProposalId,
        };
        // Always append - never replace
        appendMessageToActiveChat(blossomResponse);
        setIsTyping(false);
      }, 1500);
    }
  };

  const handleQuickPrompt = (prompt: string) => {
    // Hide QuickStart panel
    setShowQuickStart(false);
    // Set the prompt in input and send
    setInputValue(prompt);
    // Use setTimeout to ensure state is updated before calling handleSend
    setTimeout(() => {
      handleSend();
    }, 0);
  };

  // Expose insertPrompt handler to parent
  useEffect(() => {
    if (onRegisterInsertPrompt) {
      onRegisterInsertPrompt(handleQuickPrompt);
    }
  }, [onRegisterInsertPrompt]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '48px';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [inputValue]);

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div 
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto min-h-0 px-6 py-3 min-h-[400px]"
      >
        <div className="max-w-3xl mx-auto min-h-[300px]">
          {messages.map(msg => (
            <MessageBubble
              key={msg.id}
              text={msg.text}
              isUser={msg.isUser}
              timestamp={msg.timestamp}
              strategy={msg.strategy}
              strategyId={msg.strategyId}
              selectedStrategyId={selectedStrategyId}
              defiProposalId={msg.defiProposalId}
              onInsertPrompt={(text) => {
                setInputValue(text);
                textareaRef.current?.focus();
              }}
              onRegisterStrategyRef={(id, element) => {
                if (element) {
                  strategyRefsMap.current.set(id, element);
                } else {
                  strategyRefsMap.current.delete(id);
                }
              }}
            />
          ))}
          {isTyping && <TypingIndicator />}
          <div ref={messagesEndRef} />
        </div>
      </div>
      <div className="flex-shrink-0 border-t border-slate-100 bg-white/90 backdrop-blur-sm shadow-[0_-4px_20px_rgba(15,23,42,0.08)]">
        <div className="max-w-3xl mx-auto">
          {/* Toggle strip above QuickStart */}
          <div className="px-4 pt-1 pb-1 flex items-center">
            <button
              type="button"
              onClick={() => setShowQuickStart(v => !v)}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-medium text-slate-500 hover:bg-pink-50 transition-colors"
            >
              <span>Quick actions</span>
              {showQuickStart ? (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              )}
            </button>
          </div>
          {/* Quick Start Panel */}
          {showQuickStart && (
            <QuickStartPanel onSelectPrompt={handleQuickPrompt} />
          )}
          {/* Message Input */}
          <div className="p-4">
            <div className="flex items-center gap-3">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={inputValue.trim().length > 0 ? '' : SUGGESTIONS[placeholderIndex]}
                className="flex-1 resize-none border border-blossom-outline/60 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blossom-pink/30 focus:border-blossom-pink bg-white/90 text-sm"
                rows={1}
                style={{ minHeight: '48px', maxHeight: '120px' }}
              />
              {(() => {
                const canSend = inputValue.trim().length > 0 && !isTyping;
                const sendLabel = isTyping ? 'Sending...' : 'Send';
                return (
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={!canSend}
                    className={`ml-3 flex items-center justify-center rounded-full px-6 h-11 text-sm font-medium tracking-wide bg-[#FF5AA3] text-white transition-colors transition-shadow duration-150 ${
                      canSend
                        ? 'shadow-[0_10px_25px_rgba(255,107,160,0.35)] hover:bg-[#FF4B9A] hover:shadow-md cursor-pointer'
                        : 'opacity-60 shadow-sm cursor-not-allowed'
                    }`}
                  >
                    <span>{sendLabel}</span>
                    <svg
                      className="ml-2 h-4 w-4"
                      viewBox="0 0 20 20"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M4 10h9.5M11 6l3.5 4L11 14"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

