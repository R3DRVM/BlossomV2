import { useState, useRef, useEffect } from 'react';
import MessageBubble from './MessageBubble';
import TypingIndicator from './TypingIndicator';
import { parseUserMessage, generateBlossomResponse, ParsedStrategy } from '../lib/mockParser';
import { useBlossomContext, ActiveTab, ChatMessage, Strategy } from '../context/BlossomContext';
import { USE_AGENT_BACKEND } from '../lib/config';
import { callBlossomChat } from '../lib/blossomApi';
import QuickStartPanel from './QuickStartPanel';
import BlossomHelperOverlay from './BlossomHelperOverlay';
import { HelpCircle } from 'lucide-react';

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

// Helper to get venue-aware suggestion chips
function getSuggestionChipsForVenue(venue: 'hyperliquid' | 'event_demo'): Array<{ label: string; prompt: string }> {
  if (venue === 'event_demo') {
    return [
      { label: 'Take YES on Fed cuts in March with 2% risk', prompt: 'Take YES on Fed cuts in March 2025 with 2% risk' },
      { label: 'Show me my event market exposure', prompt: 'Show me my event market exposure and max loss' },
      { label: 'Risk 2% on highest volume market', prompt: 'Risk 2% of my account on the highest-volume prediction market.' },
    ];
  }
  // Default: on-chain (hyperliquid) suggestions
  return [
    { label: 'Long ETH with 2% risk', prompt: 'Long ETH with 2% risk' },
    { label: 'Show me my current exposure', prompt: 'Show me my current exposure' },
    { label: 'Hedge my BTC with a short', prompt: 'Hedge my BTC with a short' },
  ];
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
    appendMessageToChat,
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

  // Auto-open helper on first load if conditions are met
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const hasSeenHelper = window.localStorage.getItem('blossom_has_seen_helper_v1') === 'true';
    if (hasSeenHelper) return;

    const hasNoMessages = messages.length === 0 || (messages.length === 1 && messages[0].id === 'welcome-0');
    const hasNoStrategies = strategies.length === 0;

    if (hasNoMessages && hasNoStrategies) {
      setShowHelper(true);
    }
  }, [messages.length, strategies.length]);

  // Keyboard shortcut for helper (? key)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '?' && e.shiftKey) {
        setShowHelper(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  // Default QuickStart to closed if no messages yet (to avoid overwhelming user)
  const [showQuickStart, setShowQuickStart] = useState(() => messages.length > 0);
  const [showHelper, setShowHelper] = useState(false);
  
  // Auto-collapse QuickStart when messages are cleared
  useEffect(() => {
    if (messages.length === 0) {
      setShowQuickStart(false);
    }
  }, [messages.length]);
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
    if (!textareaRef.current) return;

    // 1. Read the latest text from the DOM (primary source), falling back to state if needed
    const rawText = textareaRef.current.value ?? inputValue;
    const text = rawText.trim();

    // 2. If nothing to send OR we are mid-send, just return.
    //    IMPORTANT: do NOT clear the input here - this prevents the "text disappears but nothing sends" bug
    if (!text || isTyping) {
      return;
    }

    // 3. From this point on, we've decided to send.
    //    Set isTyping flag. DO NOT clear the input yet.
    setIsTyping(true);
    setIsAtBottom(true);

    const userText = text;
    
    // Important: capture a stable chat id for this send.
    // If we relied on appendMessageToActiveChat + activeChatId,
    // the first message after creating a new session can be lost
    // because activeChatId updates asynchronously.
    let targetChatId = activeChatId;
    if (!targetChatId) {
      // Ensure a session exists for this send.
      targetChatId = createNewChatSession();
      // Add welcome message to new session (will be added by useEffect, but ensure it's marked)
      hasShownWelcomeRef.current.add(targetChatId);
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
    const session = chatSessions.find(s => s.id === targetChatId);
    if (session && session.title === 'New chat') {
      const userMessages = session.messages.filter(m => m.isUser);
      if (userMessages.length === 0) {
        const title = generateSessionTitle(userText);
        updateChatSessionTitle(targetChatId, title);
      }
    }
    
    // Append user message using stable chat id
    appendMessageToChat(targetChatId, userMessage);

    // Helper function to clear input and stop typing (used in both agent and mock modes)
    const clearInputAndStopTyping = () => {
      if (textareaRef.current) {
        textareaRef.current.value = '';
      }
      setInputValue('');
      setIsTyping(false);
    };

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
        // Always append - never replace (using stable chat id)
        appendMessageToChat(targetChatId, blossomResponse);
      } catch (error: any) {
        console.error('Agent backend error:', error);
        const errorMessage: ChatMessage = {
          id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          text: "I couldn't reach the agent backend, so I didn't execute anything. Please try again.",
          isUser: false,
          timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        };
        // Always append - never replace (using stable chat id)
        appendMessageToChat(targetChatId, errorMessage);
      } finally {
        // 5. Only AFTER the send logic has run (success or failure) do we clear the input DOM value AND state.
        //    This ensures the text doesn't disappear if there's an error or early return.
        clearInputAndStopTyping();
      }
    } else {
      // Mock mode: existing behavior
      console.log('[Chat] Using MOCK mode - request handled locally, backend not called');
      const parsed = parseUserMessage(userText, { venue, strategies, selectedStrategyId, accountValue: account.accountValue });

      // Simulate thinking delay
      setTimeout(() => {
        // Helper to clear input and stop typing (called at end of all paths)
        const clearInputAndStopTyping = () => {
          if (textareaRef.current) {
            textareaRef.current.value = '';
          }
          setInputValue('');
          setIsTyping(false);
        };

        let strategyId: string | null = null;
        let strategy: ParsedStrategy | null = null;
        let defiProposalId: string | null = null;

        // Handle show_riskiest_positions intent first (before type narrowing from other intents)
        if (parsed.intent === 'show_riskiest_positions') {
          // Get all active strategies (perps + events)
          const activePerps = strategies.filter(
            s => s.instrumentType === 'perp' && (s.status === 'executed' || s.status === 'executing') && !s.isClosed
          );
          const activeEvents = strategies.filter(
            s => s.instrumentType === 'event' && (s.status === 'executed' || s.status === 'executing') && !s.isClosed
          );
          
          // Combine and sort by risk %
          const allActive = [...activePerps, ...activeEvents].sort((a, b) => (b.riskPercent || 0) - (a.riskPercent || 0));
          
          if (allActive.length === 0) {
            const responseText = "You don't have any open positions right now.";
            const blossomResponse: ChatMessage = {
              id: `risk-${Date.now()}`,
              text: responseText,
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            };
            appendMessageToChat(targetChatId, blossomResponse);
            clearInputAndStopTyping();
            return;
          }
          
          // Find strategies with risk > 5% (or top 3 if all are lower)
          const highRiskThreshold = 5;
          const highRiskStrategies = allActive.filter(s => (s.riskPercent || 0) > highRiskThreshold);
          const topStrategies = highRiskStrategies.length > 0 ? highRiskStrategies : allActive.slice(0, 3);
          const topStrategy = topStrategies[0];
          
          // Build response message
          let responseText = `Here are your ${topStrategies.length > 1 ? 'riskiest positions' : 'riskiest position'}:\n\n`;
          topStrategies.forEach((s, idx) => {
            const market = s.instrumentType === 'event' ? s.eventLabel || 'Event' : s.market;
            responseText += `${idx + 1}. ${market} (${s.side || s.eventSide}) - ${(s.riskPercent || 0).toFixed(1)}% risk\n`;
          });
          
          if (highRiskStrategies.length > 0) {
            responseText += `\n⚠️ ${highRiskStrategies.length} position${highRiskStrategies.length > 1 ? 's' : ''} exceed${highRiskStrategies.length > 1 ? '' : 's'} your 5% per-position guideline. Consider reducing size or closing some positions to manage risk.`;
          } else {
            responseText += `\nAll positions are within your risk guidelines.`;
          }
          
          const blossomResponse: ChatMessage = {
            id: `risk-${Date.now()}`,
            text: responseText,
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          };
          appendMessageToChat(targetChatId, blossomResponse);
          
          // Trigger drawer open with highlighted strategy (via window event for simplicity)
          // The RightPanel will listen for this event
          window.dispatchEvent(new CustomEvent('openStrategyDrawer', { detail: { strategyId: topStrategy.id } }));
          
          clearInputAndStopTyping();
          return;
        }

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
            appendMessageToChat(targetChatId, errorMessage);
            clearInputAndStopTyping();
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
          const formatUsd = (amount: number) => `$${amount.toLocaleString()}`;
          const formatRiskPct = (risk: number) => risk.toFixed(1);
          const riskPct = newRiskPercent;
          
          let responseText = `Size updated to ${formatUsd(newNotionalUsd || 0)} notional (~${formatRiskPct(riskPct)}% of your account at risk).\nTP/SL and liquidation buffer are unchanged.`;
          
          if (riskPct > 3) {
            responseText += `\n\n⚠ This is above your usual 3% per-trade risk.`;
          }
          
          const blossomResponse: ChatMessage = {
            id: `modify-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            text: responseText,
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            strategy: strategy,
            strategyId: strategyId,
          };
          appendMessageToChat(targetChatId, blossomResponse);
          clearInputAndStopTyping();
          return;
        } else if (parsed.intent === 'modify_event_strategy' && parsed.modifyEventStrategy) {
          // Handle event strategy modification (similar to perp modifications)
          const mod = parsed.modifyEventStrategy;
          const targetStrategy = strategies.find(s => s.id === mod.strategyId);
          
          if (!targetStrategy || targetStrategy.instrumentType !== 'event') {
            const errorMessage: ChatMessage = {
              id: `error-${Date.now()}`,
              text: "I don't see an active event strategy to update yet — try asking me for a new event position first.",
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            };
            appendMessageToChat(targetChatId, errorMessage);
            clearInputAndStopTyping();
            return;
          }
          
          // Determine new stake amount
          const accountValue = account.accountValue;
          const requestedStake = mod.newStakeUsd || targetStrategy.stakeUsd || 0;
          
          // For modifications, always treat as explicit override - no 3% cap
          // Only cap at account value / available cash for safety
          const usdcBalance = account.balances.find(b => b.symbol === 'REDACTED');
          const availableUsdc = usdcBalance?.balanceUsd || accountValue;
          const newStakeUsd = Math.min(requestedStake, Math.min(accountValue, availableUsdc));
          
          // Calculate new values
          const maxPayoutUsd = newStakeUsd * (targetStrategy.maxPayoutUsd || 0) / (targetStrategy.stakeUsd || 1);
          const riskPct = (newStakeUsd / accountValue) * 100;
          
          // Update the strategy (preserve market, side, eventKey, eventLabel)
          // For modifications, always set overrideRiskCap to true since it's an explicit user request
          updateEventStake(targetStrategy.id, {
            stakeUsd: newStakeUsd,
            maxPayoutUsd,
            maxLossUsd: newStakeUsd,
            riskPercent: riskPct,
            overrideRiskCap: true, // Modifications are always explicit overrides
            requestedStakeUsd: requestedStake,
          });
          
          // Create updated strategy object for display
          const updatedStrategy = { ...targetStrategy, stakeUsd: newStakeUsd, maxPayoutUsd, maxLossUsd: newStakeUsd, riskPercent: riskPct };
          strategyId = updatedStrategy.id;
          strategy = {
            market: updatedStrategy.eventKey || updatedStrategy.market,
            side: updatedStrategy.eventSide === 'YES' ? 'Long' : 'Short',
            riskPercent: riskPct,
            entryPrice: newStakeUsd,
            takeProfit: maxPayoutUsd,
            stopLoss: newStakeUsd,
            liqBuffer: 0,
            fundingImpact: 'Low' as const,
          };
          
          // Generate response with appropriate warning if risk exceeds 3%
          const formatUsd = (amount: number) => `$${amount.toLocaleString()}`;
          const formatRiskPct = (stake: number, account: number) => {
            if (!account || account <= 0) return '0.0';
            return ((stake / account) * 100).toFixed(1);
          };
          
          let responseText = '';
          const riskPctFormatted = formatRiskPct(newStakeUsd, accountValue);
          if (parseFloat(riskPctFormatted) > 3) {
            // Event modification - stake > 3% of account
            responseText = `I've updated your stake to ${formatUsd(newStakeUsd)} (${riskPctFormatted}% of your account).\nYour max loss is ${formatUsd(newStakeUsd)}. ⚠ This is above your usual 3% per-trade risk—make sure you're comfortable with this drawdown.`;
          } else {
            // Event modification - stake ≤ 3% of account
            responseText = `I've updated your stake to ${formatUsd(newStakeUsd)} (${riskPctFormatted}% of your account). Your max loss is ${formatUsd(newStakeUsd)}.`;
          }
          
          const blossomResponse: ChatMessage = {
            id: `modify-event-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            text: responseText,
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            strategy: strategy,
            strategyId: strategyId,
          };
          appendMessageToChat(targetChatId, blossomResponse);
          clearInputAndStopTyping();
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
            appendMessageToChat(targetChatId, errorMessage);
            clearInputAndStopTyping();
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
            appendMessageToChat(targetChatId, errorMessage);
            clearInputAndStopTyping();
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
          appendMessageToChat(targetChatId, blossomResponse);
          clearInputAndStopTyping();
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
            appendMessageToChat(targetChatId, blossomResponse);
            clearInputAndStopTyping();
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
        
        // Handle show_riskiest_positions intent (before modify checks to avoid type narrowing issues)
        if (parsed.intent === 'show_riskiest_positions') {
          // Get all active strategies (perps + events)
          const activePerps = strategies.filter(
            s => s.instrumentType === 'perp' && (s.status === 'executed' || s.status === 'executing') && !s.isClosed
          );
          const activeEvents = strategies.filter(
            s => s.instrumentType === 'event' && (s.status === 'executed' || s.status === 'executing') && !s.isClosed
          );
          
          // Combine and sort by risk %
          const allActive = [...activePerps, ...activeEvents].sort((a, b) => b.riskPercent - a.riskPercent);
          
          if (allActive.length === 0) {
            const responseText = "You don't have any open positions right now.";
            const blossomResponse: ChatMessage = {
              id: `risk-${Date.now()}`,
              text: responseText,
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            };
            appendMessageToChat(targetChatId, blossomResponse);
            clearInputAndStopTyping();
            return;
          }
          
          // Find strategies with risk > 5% (or top 3 if all are lower)
          const highRiskThreshold = 5;
          const highRiskStrategies = allActive.filter(s => s.riskPercent > highRiskThreshold);
          const topStrategies = highRiskStrategies.length > 0 ? highRiskStrategies : allActive.slice(0, 3);
          const topStrategy = topStrategies[0];
          
          // Build response message
          let responseText = `Here are your ${topStrategies.length > 1 ? 'riskiest positions' : 'riskiest position'}:\n\n`;
          topStrategies.forEach((s, idx) => {
            const market = s.instrumentType === 'event' ? s.eventLabel || 'Event' : s.market;
            responseText += `${idx + 1}. ${market} (${s.side || s.eventSide}) - ${s.riskPercent.toFixed(1)}% risk\n`;
          });
          
          if (highRiskStrategies.length > 0) {
            responseText += `\n⚠️ ${highRiskStrategies.length} position${highRiskStrategies.length > 1 ? 's' : ''} exceed${highRiskStrategies.length > 1 ? '' : 's'} your 5% per-position guideline. Consider reducing size or closing some positions to manage risk.`;
          } else {
            responseText += `\nAll positions are within your risk guidelines.`;
          }
          
          const blossomResponse: ChatMessage = {
            id: `risk-${Date.now()}`,
            text: responseText,
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          };
          appendMessageToChat(targetChatId, blossomResponse);
          
          // Trigger drawer open with highlighted strategy (via window event for simplicity)
          // The RightPanel will listen for this event
          window.dispatchEvent(new CustomEvent('openStrategyDrawer', { detail: { strategyId: topStrategy.id } }));
          
          clearInputAndStopTyping();
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
        // Always append - never replace (using stable chat id)
        appendMessageToChat(targetChatId, blossomResponse);
        // 5. Only AFTER the send logic has run do we clear the input DOM value AND state.
        //    This ensures the text doesn't disappear if there's an error or early return.
        clearInputAndStopTyping();
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

  // Listen for insertChatPrompt events (from Strategy Drawer empty state)
  useEffect(() => {
    const handleInsertPrompt = (event: CustomEvent) => {
      const prompt = event.detail.prompt;
      if (prompt) {
        setInputValue(prompt);
        textareaRef.current?.focus();
      }
    };
    
    window.addEventListener('insertChatPrompt', handleInsertPrompt as EventListener);
    return () => {
      window.removeEventListener('insertChatPrompt', handleInsertPrompt as EventListener);
    };
  }, []);

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
    <div className="flex flex-col h-full min-h-0 overflow-hidden relative">
      <div 
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto min-h-0 px-6 py-3 min-h-[400px]"
      >
        {/* Helper overlay */}
        <BlossomHelperOverlay open={showHelper} onClose={() => setShowHelper(false)} />
        
        {/* Helper trigger button */}
        <div className="absolute top-4 right-4 z-40">
          <button
            type="button"
            onClick={() => setShowHelper(true)}
            className="rounded-full p-2 text-slate-400 hover:text-slate-600 hover:bg-white/80 transition-colors"
            aria-label="Show help"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>

        <div className="max-w-3xl mx-auto min-h-[300px]">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <div className="text-[11px] font-medium text-slate-500 mb-3">Try asking Blossom…</div>
              {/* Only show suggestion chips when QuickStart is closed (to avoid visual overload) */}
              {!showQuickStart && (
                <div className="flex flex-wrap gap-2 justify-center">
                  {getSuggestionChipsForVenue(venue).map((chip, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setInputValue(chip.prompt);
                        if (textareaRef.current) {
                          textareaRef.current.value = chip.prompt;
                        }
                        textareaRef.current?.focus();
                      }}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] text-slate-700 hover:bg-pink-50 hover:border-pink-200 transition-colors"
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
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
            </>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>
      <div className="flex-shrink-0 border-t border-slate-100 bg-white/90 backdrop-blur-sm shadow-[0_-4px_20px_rgba(15,23,42,0.08)]">
        <div className="max-w-3xl mx-auto">
          {/* Toggle strip above QuickStart */}
          <div className="px-4 pt-1 pb-1 flex items-center justify-between">
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
            {!showQuickStart && messages.length === 0 && (
              <span className="text-[10px] text-slate-400">
                Tip: Use the Quick Start panel to generate a strategy instantly.
              </span>
            )}
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

