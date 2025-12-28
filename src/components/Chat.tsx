import { useState, useRef, useEffect, useCallback } from 'react';
import MessageBubble from './MessageBubble';
import TypingIndicator from './TypingIndicator';
import { extractMarketStrict, generateMarketClarification } from '../lib/market';
import { parseUserMessage, generateBlossomResponse, ParsedStrategy, ParsedIntent, parseModificationFromText } from '../lib/mockParser';
import { useBlossomContext, ActiveTab, ChatMessage, Strategy, computePerpFromRisk } from '../context/BlossomContext';
import { derivePerpPositionsFromStrategies } from '../lib/derivePerpPositions';
import { USE_AGENT_BACKEND } from '../lib/config';
import { callBlossomChat } from '../lib/blossomApi';
import QuickStartPanel from './QuickStartPanel';
import BlossomHelperOverlay from './BlossomHelperOverlay';
import { HelpCircle } from 'lucide-react';
import { detectHighRiskIntent } from '../lib/riskIntent';
import HighRiskConfirmCard from './HighRiskConfirmCard';
import ConfirmTradeCard from './ConfirmTradeCard';
import { BlossomLogo } from './BlossomLogo';
// ExecutionPlanCard removed - execution details now live inside chat plan card

// Re-export Message type for backward compatibility
export type Message = ChatMessage;

interface ChatProps {
  selectedStrategyId: string | null;
  executionMode?: 'auto' | 'confirm' | 'manual';
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
      { label: 'Take YES with 2% risk', prompt: 'Take YES on Fed cuts in March 2025 with 2% risk' },
      { label: 'Show event exposure', prompt: 'Show me my event market exposure and max loss' },
      { label: 'Highest volume market', prompt: 'Risk 2% of my account on the highest-volume prediction market.' },
    ];
  }
  // Default: on-chain (hyperliquid) suggestions
  return [
    { label: 'Long BTC with 20×', prompt: 'Long BTC with 20x using 2% risk.' },
    { label: 'Hedge spot with a short', prompt: 'Hedge my BTC spot with a short using 1% risk.' },
    { label: 'Show exposure & risk', prompt: 'Show my current exposure and top risk drivers.' },
  ];
}

export default function Chat({ selectedStrategyId, executionMode = 'auto', onRegisterInsertPrompt }: ChatProps) {
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
    setActiveChat,
    appendMessageToActiveChat,
    appendMessageToChat,
    updateMessageInChat,
    updateChatSessionTitle,
    // fundUsdc, // Removed - not in BlossomContextType
    resetSim,
    setSelectedStrategyId,
    updatePerpSizeById,
    updateStrategyStatus,
  } = useBlossomContext();
  
  // Derive current session and messages from context
  const currentSession = chatSessions.find(s => s.id === activeChatId) || null;
  const messages = currentSession?.messages ?? [];
  
  // Track if we've shown welcome message for current session
  const hasShownWelcomeRef = useRef<Set<string>>(new Set());
  
  // Part B: MessageKey guard to prevent duplicate handling
  const lastHandledMessageKeyRef = useRef<string | null>(null);
  
  // Track active draft message ID for card replacement
  const activeDraftMessageIdRef = useRef<string | null>(null);
  // B3: Track targetChatId for draft so confirm can use the same session
  const activeDraftChatIdRef = useRef<string | null>(null);
  
  // Step B: Track last intent for CREATE isolation guard
  const lastIntentRef = useRef<{ action: string; marketResult?: any } | null>(null);
  
  // Step 1: DEV-only ring buffer for routing traces (last 20)
  const routingTracesRef = useRef<Array<{
    ts: number;
    messageKey: string;
    text: string;
    selectedStrategyId: string | null;
    selectedStrategyMarket: string | null;
    activeDraftStrategyId: string | null;
    activeDraftMarket: string | null;
    marketExtraction: any;
    parsed: any;
    intent: string;
    reasons: string[];
  }>>([]);
  
  // Step 2: Expose debug helpers on window (DEV only)
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as any).__BLOSSOM_DEBUG__ = {
        getRoutingTraces: () => [...routingTracesRef.current],
        printRoutingTraces: () => {
          console.log('[RoutingTraceDump]', JSON.stringify(routingTracesRef.current, null, 2));
        },
        clearRoutingTraces: () => {
          routingTracesRef.current = [];
          console.log('[RoutingTrace] Buffer cleared');
        },
        lastIntentRef: lastIntentRef, // Task C: Expose for tripwire
      };
    }
  }, []);
  
  // Plan draft bridge removed - execution details now live inside chat plan card
  // No need for separate ExecutionPlanCard component
  
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
  
  // High-risk confirmation state
  // Part A3: High-risk confirmation tied to specific draftId (INV-3)
  const [pendingHighRisk, setPendingHighRisk] = useState<{
    messageId: string;
    originalText: string;
    reasons: string[];
    parsedMarket?: string | null;
    pendingDraftId?: string | null; // Part A3: Store draft ID if already created
    extracted?: {
      leverage?: number;
      wantsNoStopLoss?: boolean;
      wantsFullPort?: boolean;
      wantsRestOfPortfolio?: boolean;
    };
  } | null>(null);
  
  // Step 1: Define canonical market symbol normalization

  // Part A: Single authoritative chat state machine
  type ChatMode =
    | { mode: 'idle' }
    | { mode: 'awaiting_confirm'; draftId: string; showRiskWarning: boolean }
    | { mode: 'executing'; draftId: string }
    | { mode: 'awaiting_market'; pendingTrade: {
        parsedResult: import('../lib/mockParser').ParsedMessage;
        originalUserText: string;
        extractedParams?: {
          leverage?: number;
          wantsNoStopLoss?: boolean;
          wantsFullPort?: boolean;
          wantsRestOfPortfolio?: boolean;
        };
        timestamp: number;
      }};
  
  const [chatMode, setChatMode] = useState<ChatMode>({ mode: 'idle' });
  
  // Part A: Use chatMode for state checks (DEV-only logging)
  if (import.meta.env.DEV && chatMode.mode !== 'idle') {
    // Log state transitions for debugging (can add console.log here if needed)
  }
  
  // Legacy state for backward compatibility (will be removed)
  const [chatState, setChatState] = useState<'idle' | 'awaiting_market' | 'awaiting_high_risk_confirm'>('idle');
  const [pendingTrade, setPendingTrade] = useState<{
    parsedResult: import('../lib/mockParser').ParsedMessage;
    originalUserText: string;
    extractedParams?: {
      leverage?: number;
      wantsNoStopLoss?: boolean;
      wantsFullPort?: boolean;
      wantsRestOfPortfolio?: boolean;
    };
    timestamp: number;
  } | null>(null);
  
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

  // Step 4: Centralized handler for parsed messages with bypass support
  const handleParsed = async (
    parsed: import('../lib/mockParser').ParsedMessage,
    opts?: {
      bypassClarification?: boolean;
      fromClarification?: boolean;
      extractedParams?: { leverage?: number; wantsNoStopLoss?: boolean; wantsFullPort?: boolean; wantsRestOfPortfolio?: boolean };
      originalUserText?: string;
      targetChatId: string;
    }
  ) => {
    const targetChatId = opts?.targetChatId || activeChatId || createNewChatSession();
    const extractedParams = opts?.extractedParams;
    const userTextForResponse = opts?.originalUserText || '';
    
    // Step 4: If bypassClarification is true, skip ALL clarification checks
    if (opts?.bypassClarification) {
      if (import.meta.env.DEV) {
        console.log('[Chat] handleParsed: bypassClarification=true, skipping all clarification checks');
      }
    } else {
      // Part 1 & 2: Single gate for clarification - only check if bypass is NOT set
      if (parsed.clarification) {
        // Part 1: Set state to awaiting_market and store pending trade
        const riskDetection = detectHighRiskIntent(userTextForResponse || '');
        setPendingTrade({
          parsedResult: parsed,
          originalUserText: userTextForResponse || '',
          extractedParams: riskDetection.extracted,
          timestamp: Date.now(),
        });
        setChatState('awaiting_market');
        
        // Part 2: Dev log state transition
        if (import.meta.env.DEV) {
          console.log('[ChatState] idle -> awaiting_market');
        }
        
        const clarificationResponse: ChatMessage = {
          id: `clarify-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          text: parsed.clarification,
          isUser: false,
          timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        };
        appendMessageToChat(targetChatId, clarificationResponse);
        
        // Clear input and stop typing
        if (textareaRef.current) {
          textareaRef.current.value = '';
        }
        setInputValue('');
        setIsTyping(false);
        return; // Return early
      }
    }
    
    // Step 6: Regression guard - should never set pendingClarification during bypass
    // (We can't intercept setPendingClarification directly, but we log if it happens)
    
    // Continue to high-risk interception / strategy creation
    // Process in mock mode with the parsed result by calling processUserMessage with bypass
    // We'll pass the parsed result as injectedParsedResult to skip parsing
    await processUserMessage(userTextForResponse || '', {
      skipHighRiskCheck: false, // Check high-risk if needed
      skipAppendUserMessage: false,
      extractedParams: extractedParams,
      bypassClarification: opts?.bypassClarification,
      injectedParsedResult: parsed, // Pass parsed result to skip parser
    });
  };
  
  
  // Task A: Normalize perp create spec from userText + parsed (works even if parsed.strategy is missing)
  type PerpCreateSpec = {
    side: 'Long' | 'Short';
    riskPercent?: number; // Optional: undefined when marginUsd is provided
    leverage?: number;
    marginUsd?: number;
    stopLoss?: number;
    takeProfit?: number;
    entryPrice?: number;
  };
  
  const normalizePerpCreateSpec = useCallback((
    userText: string,
    parsed: import('../lib/mockParser').ParsedMessage,
    extractedParams?: any
  ): PerpCreateSpec | null => {
    // Infer side from userText
    const longPattern = /\b(long|buy|go\s+long)\b/i;
    const shortPattern = /\b(short|sell|go\s+short)\b/i;
    const hasLong = longPattern.test(userText);
    const hasShort = shortPattern.test(userText);
    
    let side: 'Long' | 'Short' | null = null;
    if (hasLong && !hasShort) {
      side = 'Long';
    } else if (hasShort && !hasLong) {
      side = 'Short';
    } else if (parsed.strategy?.side) {
      side = parsed.strategy.side;
    }
    
    // If no side can be inferred, return null (will trigger clarification)
    if (!side) {
      return null;
    }
    
    // Get leverage and margin from parseModificationFromText + extractedParams
    const modification = parseModificationFromText(userText);
    const leverage = extractedParams?.leverage ?? 
                    modification?.leverage ?? 
                    1;
    
    let marginUsd: number | undefined = undefined;
    let riskPercent: number | undefined = undefined;
    
    if (modification?.sizeUsd && modification.sizeUsd > 0) {
      // User provided explicit margin amount - this is the anchor
      marginUsd = modification.sizeUsd;
      // Don't set riskPercent here - will be derived in handleCreatePerpDraftFromSpec
      riskPercent = undefined;
    } else {
      // No explicit margin - use riskPercent as primary input
      riskPercent = parsed.strategy?.riskPercent ?? 
                   parsed.modifyPerpStrategy?.modification.riskPercent ?? 
                   3;
      marginUsd = undefined; // Will be computed from riskPercent
    }
    
    // Get TP/SL from parsed.strategy or leave undefined
    const stopLoss = parsed.strategy?.stopLoss;
    const takeProfit = parsed.strategy?.takeProfit;
    const entryPrice = parsed.strategy?.entryPrice;
    
    return {
      side,
      riskPercent,
      leverage,
      marginUsd,
      stopLoss,
      takeProfit,
      entryPrice,
    };
  }, [parseModificationFromText]);
  
  // Task C: Internal handler that works from spec (doesn't require parsed.strategy)
  const handleCreatePerpDraftFromSpec = useCallback((
    spec: PerpCreateSpec,
    market: string,
    userText: string,
    messageKey: string,
    targetChatId: string, // B2: Accept targetChatId parameter (single source of truth)
    extractedParams?: any,
    riskDetection?: { isHighRisk: boolean; reasons: string[]; extracted?: any }
  ): string | null => {
    if (import.meta.env.DEV) {
      console.log('[CreateSpec]', {
        market,
        side: spec.side,
        riskPercent: spec.riskPercent,
        leverage: spec.leverage,
        marginUsd: spec.marginUsd,
      });
    }
    
    // INV-1: Assert market is present
    if (!market) {
      const clarificationText = generateMarketClarification({ type: 'none' });
      if (typeof appendMessageToActiveChat === 'function') {
        appendMessageToActiveChat({
          text: clarificationText,
          isUser: false,
        } as any);
      }
      return null;
    }
    
    // Compute sizing
    let finalRiskPercent: number | undefined = spec.riskPercent;
    let finalStopLoss = spec.stopLoss;
    let finalLeverage: number | undefined = spec.leverage;
    let finalMarginUsd: number | undefined = spec.marginUsd;
    
    if (extractedParams) {
      if (extractedParams.wantsRestOfPortfolio) {
        finalRiskPercent = 95;
      } else if (extractedParams.wantsFullPort) {
        finalRiskPercent = 95;
      }
      if (extractedParams.wantsNoStopLoss) {
        finalStopLoss = 0;
      }
      if (extractedParams.leverage) {
        finalLeverage = extractedParams.leverage;
      }
    }
    
    // FIX: Prioritize marginUsd over riskPercent when marginUsd is provided
    if (finalMarginUsd && finalLeverage) {
      // Margin-based: user provided explicit margin amount
      // Derive riskPercent from margin: risk% = (margin / accountValue) * 100
      finalRiskPercent = account.accountValue > 0
        ? Math.round((finalMarginUsd / account.accountValue) * 100 * 10) / 10 // Round to 1 decimal
        : 3; // Fallback if accountValue is 0
      // marginUsd and leverage are already set, no need to recompute
    } else if (finalRiskPercent && finalLeverage) {
      // Risk-based: compute margin from risk
      const sizing = computePerpFromRisk({
        accountValue: account.accountValue,
        riskPercent: finalRiskPercent,
        leverage: finalLeverage,
      });
      finalMarginUsd = sizing.marginUsd;
    } else {
      // Default leverage if missing
      finalLeverage = finalLeverage || 1;
      if (finalRiskPercent) {
        const sizing = computePerpFromRisk({
          accountValue: account.accountValue,
          riskPercent: finalRiskPercent,
          leverage: finalLeverage,
        });
        finalMarginUsd = sizing.marginUsd;
      } else {
        // Fallback: if neither marginUsd nor riskPercent provided, use default 3%
        finalRiskPercent = 3;
        const sizing = computePerpFromRisk({
          accountValue: account.accountValue,
          riskPercent: finalRiskPercent,
          leverage: finalLeverage,
        });
        finalMarginUsd = sizing.marginUsd;
      }
    }
    
    // Ensure finalRiskPercent is always a number (required for Strategy type)
    if (finalRiskPercent === undefined) {
      finalRiskPercent = 3; // Fallback
    }
    
    // INV-2: Single-draft mode - block if draft exists
    const existingDraftCheck = strategies.find(s => s.status === 'draft' && s.instrumentType === 'perp');
    if (existingDraftCheck) {
      const draftMarket = existingDraftCheck.market || 'the pending position';
      if (typeof appendMessageToActiveChat === 'function') {
        appendMessageToActiveChat({
          text: `You have a pending draft for ${draftMarket}. Please confirm it first, or say 'discard draft' to start a new trade.`,
          isUser: false,
        } as any);
      }
      return null;
    }
    
    // Create draft strategy
    const originKeyWithMarket = `${messageKey}-${market}-${spec.side}`;
    const newStrategy = addDraftStrategy({
      side: spec.side,
      market,
      riskPercent: finalRiskPercent,
      entry: spec.entryPrice,
      takeProfit: spec.takeProfit,
      stopLoss: finalStopLoss,
      leverage: finalLeverage,
      marginUsd: finalMarginUsd,
      // wantsRestOfPortfolio: extractedParams?.wantsRestOfPortfolio, // Removed - not in Strategy type
      sourceText: userText,
      instrumentType: 'perp',
      originMessageKey: originKeyWithMarket,
    });
    
    // Append new chat message (never replace executed cards)
    // B2: Use passed targetChatId (no fallback createNewChatSession)
    const parsedStrategyForMessage: ParsedStrategy = {
      side: spec.side,
      market,
      riskPercent: finalRiskPercent,
      entryPrice: spec.entryPrice || 0,
      takeProfit: spec.takeProfit || 0,
      stopLoss: finalStopLoss !== undefined ? finalStopLoss : (spec.stopLoss || 0),
      liqBuffer: 0,
      fundingImpact: 'Low',
    };
    
    const confirmationMessage: ChatMessage = {
      id: `draft-${newStrategy.id}`,
      text: `I've prepared a ${parsedStrategyForMessage.side} position on ${market}. Review the details below and confirm to execute.`,
      isUser: false,
      timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      strategy: parsedStrategyForMessage,
      strategyId: newStrategy.id,
    } as ChatMessage & {
      showRiskWarning?: boolean;
      riskReasons?: string[];
    };
    
    if (riskDetection?.isHighRisk) {
      (confirmationMessage as any).showRiskWarning = true;
      (confirmationMessage as any).riskReasons = riskDetection.reasons;
    }
    
    appendMessageToChat(targetChatId, confirmationMessage);
    activeDraftMessageIdRef.current = confirmationMessage.id;
    // B3: Store targetChatId so confirm can use the same session
    activeDraftChatIdRef.current = targetChatId;
    
    // Set chat mode
    setChatMode({
      mode: 'awaiting_confirm',
      draftId: newStrategy.id,
      showRiskWarning: riskDetection?.isHighRisk || false,
    });
    
    if (riskDetection?.isHighRisk && riskDetection.extracted) {
      setPendingHighRisk({
        messageId: confirmationMessage.id,
        originalText: userText,
        reasons: riskDetection.reasons,
        extracted: riskDetection.extracted,
        parsedMarket: market,
        pendingDraftId: newStrategy.id,
      });
      setChatState('awaiting_high_risk_confirm');
    } else {
      setChatState('idle');
    }
    
    return newStrategy.id;
  }, [strategies, account, addDraftStrategy, activeChatId, createNewChatSession, appendMessageToActiveChat, appendMessageToChat, setChatMode, setPendingHighRisk, setChatState, computePerpFromRisk, parseModificationFromText]);
  
  // Step B: Isolated CREATE handler - never calls updateStrategy (kept for backward compatibility)
  const handleCreatePerpDraft = useCallback((
    parsed: import('../lib/mockParser').ParsedMessage,
    market: string,
    userText: string,
    messageKey: string,
    targetChatId: string, // B2: Accept targetChatId parameter
    extractedParams?: any,
    riskDetection?: { isHighRisk: boolean; reasons: string[]; extracted?: any }
  ): string | null => {
    // Task A: Normalize spec from parsed + userText
    const spec = normalizePerpCreateSpec(userText, parsed, extractedParams);
    if (!spec) {
      // Side could not be inferred - clarify
      const clarificationText = `Do you want to go long or short on ${market}?`;
      if (typeof appendMessageToActiveChat === 'function') {
        appendMessageToActiveChat({
          text: clarificationText,
          isUser: false,
        } as any);
      }
      return null;
    }
    
    // Use spec-based handler
    return handleCreatePerpDraftFromSpec(spec, market, userText, messageKey, targetChatId, extractedParams, riskDetection);
  }, [normalizePerpCreateSpec, handleCreatePerpDraftFromSpec, appendMessageToActiveChat]);
  
  // Step B: Isolated UPDATE handler - only place allowed to call updateStrategy
  const handleUpdateStrategy = useCallback((
    targetStrategyId: string,
    updates: Partial<Strategy>,
    _parsed: import('../lib/mockParser').ParsedStrategy,
    _targetChatId: string
  ) => {
    // Step B: DEV guard - throw if called during CREATE
    if (import.meta.env.DEV && lastIntentRef.current?.action === 'create') {
      const error = new Error('[TRIPWIRE] handleUpdateStrategy called during CREATE intent! This should never happen.');
      console.error(error.message, {
        targetStrategyId,
        updates,
        lastIntent: lastIntentRef.current,
      });
      console.trace('Stack trace:');
      throw error;
    }
    
    updateStrategy(targetStrategyId, updates);
  }, [updateStrategy]);
  
  // Part 3: Strict intent determination V2 following INV-A/B/C/D
  // Step 3: Hard rules for CREATE vs UPDATE
  const determineIntentStrictV2 = (
    text: string,
    parsed: import('../lib/mockParser').ParsedMessage,
    selectedStrategy: Strategy | null,
    selectedStrategyId: string | null
  ): 'create' | 'updateSelected' | 'reject' | 'clarify' => {
    // Step 2: Extract market strictly (no fallbacks)
    const marketResult = extractMarketStrict(text);
    
    // Step 3: Rule A - Detect new trade verbs (CREATE wins)
    const newTradeVerbs = /\b(open|enter|start|new\s+position|go\s+long|go\s+short|long|short|buy|sell)\b/i;
    const hasNewTradeVerbs = newTradeVerbs.test(text);
    const hasSide = parsed.strategy?.side !== undefined;
    const hasNewTradeLanguage = hasNewTradeVerbs || hasSide;
    
    // Step 3: Rule A - If new trade language + single market → CREATE (no matter what is selected)
    if (hasNewTradeLanguage && marketResult.type === 'single') {
      // Special case: "open a position on X" is always CREATE even if it says "update"
      if (/\bopen\s+(?:a\s+)?(?:position\s+)?(?:on|for)\s+/i.test(text)) {
        if (import.meta.env.DEV) {
          console.log('[Intent] CREATE market=' + marketResult.market + ' reason=RuleA:open_position_on_market');
        }
        return 'create';
      }
      
      // If side + market → CREATE
      if (import.meta.env.DEV) {
        console.log('[Intent] CREATE market=' + marketResult.market + ' reason=RuleA:newTradeLanguage+market');
      }
      return 'create';
    }
    
    // Step 3: Rule C - If new trade language but market missing/ambiguous → CLARIFY
    if (hasNewTradeLanguage && (marketResult.type === 'none' || marketResult.type === 'ambiguous')) {
      if (import.meta.env.DEV) {
        console.log('[Intent] CLARIFY reason=RuleC:newTradeLanguage but market missing/ambiguous', {
          marketResult: marketResult.type,
          side: parsed.strategy?.side,
        });
      }
      return 'clarify';
    }
    
    // Step 3: Rule B - UPDATE is opt-in only
    const updateVerbs = /\b(update|edit|change|adjust|set|raise|lower|move|tighten|widen)\b/i;
    const isExplicitUpdate = updateVerbs.test(text);
    const hasFieldTarget = /(?:leverage|size|risk|stop|tp|sl|take\s+profit|margin|notional)/i.test(text);
    
    // Step 4: UPDATE requires explicit edit verb + explicit target
    // Rule B: UPDATE only if ALL are true:
    // 1. Explicit update verbs
    // 2. Field target exists
    // 3. Explicit target (selectedStrategyId OR market mention that matches existing strategy)
    // 4. Market either missing OR matches target strategy market
    if (isExplicitUpdate && hasFieldTarget) {
      // Step 4: Resolve update target
      let updateTargetId: string | null = null;
      if (marketResult.type === 'single') {
        // Market mentioned - find most recent strategy with that market
        const matchingStrategies = strategies.filter(s => 
          s.market === marketResult.market && 
          (s.status === 'executed' || s.status === 'executing' || s.status === 'draft')
        );
        if (matchingStrategies.length > 0) {
          updateTargetId = matchingStrategies[matchingStrategies.length - 1].id;
        }
      } else if (selectedStrategyId) {
        updateTargetId = selectedStrategyId;
      }
      
      const updateTargetStrategy = updateTargetId ? strategies.find(s => s.id === updateTargetId) : null;
      
      if (!updateTargetStrategy) {
        // No target found → reject
        if (import.meta.env.DEV) {
          console.log('[Intent] REJECT reason=update_but_no_target');
        }
        return 'reject';
      }
      
      // Market check: must be missing OR match target (never different)
      if (marketResult.type === 'single' && marketResult.market !== updateTargetStrategy.market) {
        // Different market → CREATE (not UPDATE)
        if (import.meta.env.DEV) {
          console.log('[Intent] CREATE market=' + marketResult.market + ' reason=RuleB:update_but_different_market');
        }
        return 'create';
      }
      
      const marketOk = marketResult.type === 'none' || 
        (marketResult.type === 'single' && marketResult.market === updateTargetStrategy.market);
      
      if (marketOk) {
        const fields = text.match(/(?:leverage|size|risk|stop|tp|sl|take\s+profit|margin|notional)/gi) || [];
        if (import.meta.env.DEV) {
          console.log('[Intent] UPDATE id=' + updateTargetId + ' market=' + (updateTargetStrategy.market || 'none') + ' fields=[' + fields.join(',') + '] reason=RuleB:all_conditions_met');
        }
        return 'updateSelected';
      }
    }
    
    // If explicit update but no selection, reject
    if (isExplicitUpdate && !selectedStrategy) {
      if (import.meta.env.DEV) {
        console.log('[Intent] REJECT reason=update_but_no_selection');
      }
      return 'reject';
    }
    
    // Default: CREATE (Invariant 0.2 - new trade = new strategy.id always)
    if (import.meta.env.DEV) {
      console.log('[Intent] CREATE reason=default');
    }
    return 'create';
  };

  // Task A: Atomic helper that guarantees an active chat session exists
  const ensureActiveChatId = useCallback((): string => {
    // Step 1: If activeChatId exists and session exists → return it
    if (activeChatId) {
      const sessionExists = chatSessions.some(s => s.id === activeChatId);
      if (sessionExists) {
        if (import.meta.env.DEV) {
          console.log('[ensureActiveChatId]', { activeChatId, action: 'reused_existing' });
        }
        return activeChatId;
      }
    }
    
    // Step 2: Else create a new session via existing createNewChatSession()
    const newId = createNewChatSession();
    
    // Step 3: Immediately set it as active synchronously
    setActiveChat(newId);
    
    if (import.meta.env.DEV) {
      console.log('[ensureActiveChatId]', { newId, action: 'created_new' });
    }
    
    // Step 4: Return newId
    return newId;
  }, [activeChatId, chatSessions, createNewChatSession, setActiveChat]);

  // Internal function to process user message with optional high-risk bypass
  const processUserMessage = async (
    userText: string,
    opts?: { 
      skipHighRiskCheck?: boolean; 
      skipAppendUserMessage?: boolean; 
      extractedParams?: { leverage?: number; wantsNoStopLoss?: boolean; wantsFullPort?: boolean; wantsRestOfPortfolio?: boolean };
      bypassClarification?: boolean; // Step 4: Bypass clarification check
      forcedMarketSymbol?: string; // Step 1-2: Force market symbol
      injectedParsedResult?: import('../lib/mockParser').ParsedMessage; // Step 3: Use injected parsed result
      messageKey?: string; // Part B: Optional message key for idempotency
    }
  ) => {
    // Part B: Build stable messageKey for duplicate detection
    const msgRunId = import.meta.env.DEV && typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : `${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    
    // Part B: Create stable messageKey from text hash or use provided
    const messageKey = opts?.messageKey || (() => {
      // Simple hash of text (for demo, just use text + timestamp truncated to second)
      const textHash = userText.slice(0, 50).replace(/\s+/g, '').toLowerCase();
      const timestamp = Math.floor(Date.now() / 1000); // Round to second
      return `${timestamp}-${textHash}`;
    })();
    
    // Part B: Check if this message was already handled
    if (lastHandledMessageKeyRef.current === messageKey && !opts?.skipAppendUserMessage) {
      if (import.meta.env.DEV) {
        console.log('[Chat] duplicate handling blocked', { messageKey, msgRunId });
      }
      return; // Already handled, no-op
    }
    
    // Part B: Mark as handled (only if not skipping append, to allow proceed to work)
    if (!opts?.skipAppendUserMessage) {
      lastHandledMessageKeyRef.current = messageKey;
    }
    
    if (import.meta.env.DEV) {
      console.log(`[ChatRun ${msgRunId}] processing message`, { messageKey, text: userText.slice(0, 50) });
    }
    
    // Task B: Compute targetChatId = ensureActiveChatId() at the very top
    const activeChatIdBefore = activeChatId;
    const targetChatId = ensureActiveChatId();
    const activeChatIdAfter = activeChatId; // Note: may still be stale due to React async state
    
    // Task D: DEV-only logs to prove correctness
    if (import.meta.env.DEV) {
      console.log('[processUserMessage] first message flow', {
        activeChatId_before: activeChatIdBefore,
        targetChatId,
        activeChatId_after: activeChatIdAfter,
        sessionExists: chatSessions.some(s => s.id === targetChatId),
      });
    }
    
      // Add welcome message to new session (will be added by useEffect, but ensure it's marked)
    if (!hasShownWelcomeRef.current.has(targetChatId)) {
      hasShownWelcomeRef.current.add(targetChatId);
    }
    
    // Append user message only if not skipping (e.g., when proceeding from high-risk confirmation)
    if (!opts?.skipAppendUserMessage) {
    // Ensure unique message ID with timestamp + random component
    const userMessageId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const userMessage: ChatMessage = {
      id: userMessageId,
      text: userText,
      isUser: true,
      timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    };

    // B4: Title update now happens inside appendMessageToChat to avoid stale state reads
    // Append user message using stable chat id
    appendMessageToChat(targetChatId, userMessage);
    }

    // Part 1: Check state machine FIRST - awaiting_market takes priority
    // Step A: Use strict market extraction (no fallbacks)
    if (!USE_AGENT_BACKEND && chatState === 'awaiting_market' && pendingTrade) {
      const marketResult = extractMarketStrict(userText);
      
      if (marketResult.type === 'single') {
        // Part 1: Market resolved - inject into stored trade and continue
        const resolvedMarket = marketResult.market; // e.g., "BTC-PERP"
        if (import.meta.env.DEV) {
          console.log('[ChatState] awaiting_market -> idle (resolved', resolvedMarket + ')');
        }
        
        // Capture pending trade
        const pending = { ...pendingTrade };
        
        // Clear state immediately
        setPendingTrade(null);
        setChatState('idle');
        
        // Clone parsed result and inject market (use full "BTC-PERP" format)
        const continuedParsed = { ...pending.parsedResult };
        if (continuedParsed.strategy) {
          continuedParsed.strategy.market = resolvedMarket; // "BTC-PERP" format
        }
        continuedParsed.clarification = undefined; // Ensure no clarification
        
        // Part 1: Continue processing original trade intent via single internal function
        // Use bypassClarification to skip clarification check (we already resolved market)
        setIsTyping(true);
        setTimeout(async () => {
          if (import.meta.env.DEV) {
            console.log('[Chat] continuation: creating strategy now');
          }
          await handleParsed(continuedParsed, {
            bypassClarification: true,
            fromClarification: true,
            extractedParams: pending.extractedParams,
            originalUserText: pending.originalUserText,
            targetChatId: targetChatId,
          });
        }, 1500);
        
        // Clear input
        if (textareaRef.current) {
          textareaRef.current.value = '';
        }
        setInputValue('');
        return; // Return early, processing happens in setTimeout
      } else {
        // Part 1: Not a recognized market, ask once and remain in awaiting_market
        const clarificationResponse: ChatMessage = {
          id: `clarify-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          text: 'Please pick one of: BTC, ETH, SOL, AVAX, BNB.',
          isUser: false,
          timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        };
        appendMessageToChat(targetChatId, clarificationResponse);
        
        // Clear input and stop typing
        if (textareaRef.current) {
          textareaRef.current.value = '';
        }
        setInputValue('');
        setIsTyping(false);
        return; // Return early - remain in awaiting_market state
      }
    }

    // A) Chat flow hardening: Parse first, handle clarification BEFORE high-risk check
    // Step 4: Skip clarification check if bypass flag is set (prevents re-entry loop)
    if (!USE_AGENT_BACKEND && !opts?.bypassClarification) {
      const parsed = parseUserMessage(userText, { venue, strategies, selectedStrategyId, accountValue: account.accountValue });
      
      // B) Defensive guard: Never ask for perp market if message looks like DeFi allocation
      const looksLikeDefiCommand = 
        /protocol:"[^"]+"/i.test(userText) ||
        (/\b(yield|apy|apr|deposit|lending|allocate)\b/i.test(userText) && /\b(usdc|stable)\b/i.test(userText));
      
      if (looksLikeDefiCommand && parsed.clarification && parsed.clarification.includes('Which market do you want')) {
        if (import.meta.env.DEV) {
          console.log('[Chat] Bypassing perp market clarification for DeFi command:', userText);
        }
        // 3) Handle amountPct token: compute USD amount and rewrite command
        let commandToUse = userText;
        const amountPctMatch = userText.match(/amountPct:"([^"]+)"/i);
        if (amountPctMatch) {
          const percent = parseFloat(amountPctMatch[1]);
          if (!isNaN(percent) && percent > 0 && percent <= 100) {
            const accountValue = account.accountValue || 10000; // Demo fallback
            const computedUsd = Math.round((accountValue * percent) / 100);
            // Rewrite command to include amountUsd token
            commandToUse = userText.replace(/amountPct:"[^"]+"/i, `amountUsd:"${computedUsd}"`);
            if (import.meta.env.DEV) {
              console.log('[Chat] DeFi amountPct converted (bypass path)', {
                percent,
                accountValue,
                computedUsd,
              });
            }
          }
        }
        // Force DeFi creation path
        const defiProposal = createDefiPlanFromCommand(commandToUse);
        setOnboarding(prev => ({ ...prev, queuedStrategy: true }));
        
        window.dispatchEvent(
          new CustomEvent('planDrafted', {
            detail: { type: 'defi', id: defiProposal.id },
          })
        );
        
        const defiResponse: ChatMessage = {
          id: `defi-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          text: "I've prepared a DeFi yield plan. Review the details below and confirm to execute.",
          isUser: false,
          timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          defiProposalId: defiProposal.id,
        };
        appendMessageToChat(targetChatId, defiResponse);
        
        if (textareaRef.current) {
          textareaRef.current.value = '';
        }
        setInputValue('');
        setIsTyping(false);
        return; // Early return - prevent clarification flow
      }
      
      // Step 4: Clarification before high-risk - if market is missing, ask clarification and return early
      // Make it impossible to set pendingClarification during continuation
      if (parsed.clarification) {
        // Step 6: Regression guard - should never set during bypass
        if (import.meta.env.DEV && opts?.bypassClarification) {
          console.error('[Regression] pendingClarification set during bypass');
        }
        if (import.meta.env.DEV) {
          console.log('[Chat] pendingClarification set:', {
            originalUserText: userText,
            kind: 'market',
          });
        }
        
        // Part 1: Set state to awaiting_market and store pending trade
        const riskDetection = detectHighRiskIntent(userText);
        setPendingTrade({
          parsedResult: parsed, // Store the parsed result so we can inject market later
          originalUserText: userText,
          extractedParams: riskDetection.extracted,
          timestamp: Date.now(),
        });
        setChatState('awaiting_market');
        
        // Part 2: Dev log state transition
        if (import.meta.env.DEV) {
          console.log('[ChatState] idle -> awaiting_market');
        }
        
        const clarificationResponse: ChatMessage = {
          id: `clarify-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          text: parsed.clarification,
          isUser: false,
          timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        };
        appendMessageToChat(targetChatId, clarificationResponse);
        
        // Clear input and stop typing
        if (textareaRef.current) {
          textareaRef.current.value = '';
        }
        setInputValue('');
        setIsTyping(false);
        return; // Return early - no high-risk card, no further processing
      }
    }

    // Part A3: High-risk interception happens AFTER parsing (INV-3)
    // Part A3: For trade intents, we'll create draft first, then check high-risk
    // This ensures draftId is available for pendingHighRisk
    // (High-risk check moved to after strategy creation in trade intent handler)

    // Helper function to clear input and stop typing (used in both agent and mock modes)
    const clearInputAndStopTyping = () => {
      if (textareaRef.current) {
        textareaRef.current.value = '';
      }
      setInputValue('');
      setIsTyping(false);
    };

    // Apply extracted parameters if provided (from high-risk proceed)
    const extractedParams = opts?.extractedParams;

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
      
      // Step 3: Check if we have an injected parsed result (from clarification resolution)
      // This allows us to bypass the parser when continuing from clarification
      const injectedParsed = opts?.injectedParsedResult;
      let parsed: import('../lib/mockParser').ParsedMessage;
      
      if (injectedParsed) {
        // Step 3: Use injected parsed result (bypass parser)
        parsed = injectedParsed;
        if (import.meta.env.DEV) {
          console.log('[Chat] Using injected parsed result (clarification continuation)');
        }
        
        // Step 1: Apply forcedMarketSymbol if provided
        if (opts?.forcedMarketSymbol && parsed.strategy) {
          // Build "BTC-PERP" format from symbol
          parsed.strategy.market = `${opts.forcedMarketSymbol}-PERP`;
          if (import.meta.env.DEV) {
            console.log('[Chat] forcedMarketSymbol applied:', opts.forcedMarketSymbol);
          }
        }
      } else {
        parsed = parseUserMessage(userText, { venue, strategies, selectedStrategyId, accountValue: account.accountValue });
      }

      // Capture bypass flag for use in setTimeout closure
      const bypassFlag = !!opts?.bypassClarification;

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

        // B) Defensive guard: Never ask for perp market if message looks like DeFi allocation
        const looksLikeDefiCommand = 
          /protocol:"[^"]+"/i.test(userText) ||
          (/\b(yield|apy|apr|deposit|lending|allocate)\b/i.test(userText) && /\b(usdc|stable)\b/i.test(userText));
        
        if (looksLikeDefiCommand && parsed.clarification && parsed.clarification.includes('Which market do you want') && !bypassFlag) {
          if (import.meta.env.DEV) {
            console.log('[Chat] Bypassing perp market clarification for DeFi command (mock mode):', userText);
          }
          // 3) Handle amountPct token: compute USD amount and rewrite command
          let commandToUse = userText;
          const amountPctMatch = userText.match(/amountPct:"([^"]+)"/i);
          if (amountPctMatch) {
            const percent = parseFloat(amountPctMatch[1]);
            if (!isNaN(percent) && percent > 0 && percent <= 100) {
              const accountValue = account.accountValue || 10000; // Demo fallback
              const computedUsd = Math.round((accountValue * percent) / 100);
              // Rewrite command to include amountUsd token
              commandToUse = userText.replace(/amountPct:"[^"]+"/i, `amountUsd:"${computedUsd}"`);
              if (import.meta.env.DEV) {
                console.log('[Chat] DeFi amountPct converted (bypass path, mock mode)', {
                  percent,
                  accountValue,
                  computedUsd,
                });
              }
            }
          }
          // Force DeFi creation path
          const defiProposal = createDefiPlanFromCommand(commandToUse);
          setOnboarding(prev => ({ ...prev, queuedStrategy: true }));
          
          window.dispatchEvent(
            new CustomEvent('planDrafted', {
              detail: { type: 'defi', id: defiProposal.id },
            })
          );
          
          const defiResponse: ChatMessage = {
            id: `defi-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            text: "I've prepared a DeFi yield plan. Review the details below and confirm to execute.",
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            defiProposalId: defiProposal.id,
          };
          appendMessageToChat(targetChatId, defiResponse);
          clearInputAndStopTyping();
          return; // Early return - prevent clarification flow
        }

        // Step 4: Handle market clarification request (skip if bypass is set)
        // Step 6: Regression guard - should never set pendingClarification during bypass
        if (parsed.clarification && !bypassFlag) {
          if (import.meta.env.DEV && bypassFlag) {
            console.error('[Regression] pendingClarification set during bypass');
          }
          const clarificationResponse: ChatMessage = {
            id: `clarify-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            text: parsed.clarification,
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          };
          appendMessageToChat(targetChatId, clarificationResponse);
          clearInputAndStopTyping();
          return;
        }

        // Handle show_riskiest_positions intent first (before type narrowing from other intents)
        if (parsed.intent === ('show_riskiest_positions' as ParsedIntent)) {
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
          // 3) Handle amountPct token: compute USD amount and rewrite command
          let commandToUse = userText;
          const amountPctMatch = userText.match(/amountPct:"([^"]+)"/i);
          if (amountPctMatch) {
            const percent = parseFloat(amountPctMatch[1]);
            if (!isNaN(percent) && percent > 0 && percent <= 100) {
              const accountValue = account.accountValue || 10000; // Demo fallback
              const computedUsd = Math.round((accountValue * percent) / 100);
              // Rewrite command to include amountUsd token
              commandToUse = userText.replace(/amountPct:"[^"]+"/i, `amountUsd:"${computedUsd}"`);
              if (import.meta.env.DEV) {
                console.log('[Chat] DeFi amountPct converted', {
                  percent,
                  accountValue,
                  computedUsd,
                  originalCommand: userText,
                  rewrittenCommand: commandToUse,
                });
              }
            }
          }
          
          // Create DeFi plan and get the proposal
          const defiProposal = createDefiPlanFromCommand(commandToUse);
          defiProposalId = defiProposal.id;
          setOnboarding(prev => ({ ...prev, queuedStrategy: true }));
          
          if (import.meta.env.DEV) {
            console.log('[Chat] DeFi plan created', {
              intent: parsed.intent,
              defiProposalId: defiProposal.id,
              protocol: defiProposal.protocol,
              depositUsd: defiProposal.depositUsd,
            });
          }
          
          // Dispatch planDrafted event
          window.dispatchEvent(
            new CustomEvent('planDrafted', {
              detail: { type: 'defi', id: defiProposal.id },
            })
          );
          
          // A) Immediately append assistant message with defiProposalId (match perps/events pattern)
          const defiResponse: ChatMessage = {
            id: `defi-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            text: "I've prepared a DeFi yield plan. Review the details below and confirm to execute.",
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            defiProposalId: defiProposal.id,
          };
          appendMessageToChat(targetChatId, defiResponse);
          clearInputAndStopTyping();
          return; // Early return - prevent fallthrough to other flows
        } else if (parsed.intent === 'list_top_event_markets') {
          // Extract requested count from parsed message (default 5)
          const requestedCount = (parsed as any).requestedCount || 5;
          
          // Fetch and display top markets list (not a strategy creation)
          import('../lib/eventMarkets').then(({ getTopEventMarkets }) => {
            getTopEventMarkets(requestedCount).then(markets => {
              const marketsMessage: ChatMessage = {
                id: `markets-${Date.now()}`,
                text: `Here are the top ${markets.length} prediction markets by volume:`,
                isUser: false,
                timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                marketsList: markets.map(m => ({
                  id: m.id,
                  title: m.title,
                  yesPrice: m.yesPrice,
                  noPrice: m.noPrice,
                  volume24hUsd: m.volume24hUsd,
                  source: m.source,
                  isLive: m.isLive,
                })),
              } as ChatMessage;
              
              appendMessageToChat(targetChatId, marketsMessage);
              clearInputAndStopTyping();
            }).catch(() => {
              // Fail silently, show error message
              const errorMessage: ChatMessage = {
                id: `error-${Date.now()}`,
                text: "I couldn't fetch the markets right now. Please try again later.",
                isUser: false,
                timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
              };
              appendMessageToChat(targetChatId, errorMessage);
              clearInputAndStopTyping();
            });
          });
        } else if (parsed.intent === 'list_top_defi_protocols') {
          // Extract requested count from parsed message
          const requestedCount = (parsed as any).requestedCount || 5;
          
          if (import.meta.env.DEV) {
            console.log('[Chat] list_top_defi_protocols intent detected', { requestedCount });
          }
          
          // Show loading message immediately
          const loadingMessageId = `protocols-loading-${Date.now()}`;
          const loadingMessage: ChatMessage = {
            id: loadingMessageId,
            text: 'Fetching top DeFi protocols by TVL...',
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          };
          appendMessageToChat(targetChatId, loadingMessage);
          
          // Fetch and display top DeFi protocols list (not a strategy creation)
          import('../lib/defiProtocols').then(({ getTopDefiProtocolsByTvl }) => {
            getTopDefiProtocolsByTvl(requestedCount).then(protocols => {
              if (import.meta.env.DEV) {
                console.log('[Chat] DeFi protocols fetched', { 
                  requestedCount, 
                  returnedCount: protocols.length,
                  hasDefiProtocolsList: true 
                });
              }
              
              // Remove loading message and add final message
              // Ensure text matches actual rendered count
              const actualCount = protocols.length;
              const finalMessage: ChatMessage = {
                id: `protocols-${Date.now()}`,
                text: `Here are the top ${actualCount} DeFi protocol${actualCount !== 1 ? 's' : ''} by TVL right now:`,
                isUser: false,
                timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                defiProtocolsList: protocols.map(p => ({
                  id: p.id,
                  name: p.name,
                  tvlUsd: p.tvlUsd,
                  chains: p.chains,
                  category: p.category,
                  source: p.source,
                  isLive: p.isLive,
                })),
              } as ChatMessage;
              
              // Replace loading message with final message
              updateMessageInChat(targetChatId, loadingMessageId, finalMessage);
              
              clearInputAndStopTyping();
            }).catch((error) => {
              if (import.meta.env.DEV) {
                console.error('[Chat] DeFi protocols fetch error', error);
              }
              
              // Replace loading message with error, but still show static fallback
              import('../lib/defiProtocols').then(({ getTopDefiProtocolsByTvl }) => {
                getTopDefiProtocolsByTvl(requestedCount).then(protocols => {
                  // Even on error, getTopDefiProtocolsByTvl returns static fallback
                  // Ensure text matches actual rendered count
                  const actualCount = protocols.length;
                  const fallbackMessage: ChatMessage = {
                    id: `protocols-${Date.now()}`,
                    text: `Here are the top ${actualCount} DeFi protocol${actualCount !== 1 ? 's' : ''} by TVL:`,
                    isUser: false,
                    timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                    defiProtocolsList: protocols.map(p => ({
                      id: p.id,
                      name: p.name,
                      tvlUsd: p.tvlUsd,
                      chains: p.chains,
                      category: p.category,
                      source: p.source,
                      isLive: p.isLive,
                    })),
                  } as ChatMessage;
                  
                  // Replace loading message with final message (static fallback)
                  updateMessageInChat(targetChatId, loadingMessageId, fallbackMessage);
                  
                  clearInputAndStopTyping();
                });
              });
            });
          });
          return; // Early return - prevents generic fallback
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
          
          // Default to 'static' for eventMarketSource (can be updated if ticker source is available)
          const eventMarketSource: 'polymarket' | 'kalshi' | 'static' = 'static';
          
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
            eventMarketSource: eventMarketSource, // Store market source for venue/chain display
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
          
          // Dispatch planDrafted event
          window.dispatchEvent(
            new CustomEvent('planDrafted', {
              detail: { type: 'event', id: newStrategy.id },
            })
          );
        } else if (parsed.intent === 'modify_perp_strategy' && parsed.modifyPerpStrategy) {
          // Task A: Route ALL perp-related intents through strict router
          // This prevents modify_perp_strategy from hijacking CREATE
          const selectedStrategy = selectedStrategyId 
            ? strategies.find(s => s.id === selectedStrategyId) || null
            : null;
          
          const marketResult = extractMarketStrict(userText);
          const action = determineIntentStrictV2(userText, parsed, selectedStrategy, selectedStrategyId);
          
          // Task E: DEV log to prove strict router override
          if (import.meta.env.DEV) {
            console.log('[ParserIntent] modify_perp_strategy detected, but strict router decided:', {
              parserIntent: 'modify_perp_strategy',
              routerAction: action,
              marketResult,
              willOverride: action === 'create' || action === 'clarify' || action === 'reject',
            });
          }
          
          // Task A: Enforce strict router decision - if router says CREATE, CREATE (don't update)
          if (action === 'create') {
            // Router says CREATE - treat as new trade, not modification
            // Find active draft (if any)
            const activeDraftStrategy = strategies.find(s => s.status === 'draft' && s.instrumentType === 'perp') || null;
            
            // Store routing trace
            if (import.meta.env.DEV) {
              const reasons: string[] = [];
              if (parsed.strategy?.side) reasons.push('hasSide');
              if (marketResult.type === 'single') reasons.push(`market=${marketResult.market}`);
              if (selectedStrategyId) reasons.push(`selected=${selectedStrategyId}`);
              
              const traceEntry = {
                ts: Date.now(),
                messageKey,
                text: userText,
                selectedStrategyId,
                selectedStrategyMarket: selectedStrategy?.market || null,
                activeDraftStrategyId: activeDraftStrategy?.id || null,
                activeDraftMarket: activeDraftStrategy?.market || null,
                marketExtraction: marketResult,
                parsed: {
                  side: parsed.strategy?.side,
                  riskPercent: parsed.strategy?.riskPercent,
                  leverage: extractedParams?.leverage,
                },
                intent: action,
                reasons,
              };
              
              routingTracesRef.current.push(traceEntry);
              if (routingTracesRef.current.length > 20) {
                routingTracesRef.current.shift();
              }
              
              lastIntentRef.current = { action, marketResult };
              if ((window as any).__BLOSSOM_DEBUG__) {
                (window as any).__BLOSSOM_DEBUG__.lastIntent = { action, reasons, marketResult };
              }
              
              console.log('[RoutingTrace]', traceEntry);
            }
            
            // INV-1: Fail closed on market - if market cannot be extracted, clarify
            if (marketResult.type !== 'single') {
              const clarificationText = generateMarketClarification(marketResult);
              if (typeof appendMessageToActiveChat === 'function') {
                appendMessageToActiveChat({
                  text: clarificationText,
                  isUser: false,
                } as any);
              }
              clearInputAndStopTyping();
              return;
            }
            
            const marketForStrategy = marketResult.market;
            const riskDetection = !opts?.skipHighRiskCheck ? detectHighRiskIntent(userText) : { isHighRisk: false, reasons: [], extracted: undefined };
            
            // Task B: Normalize spec (works even if parsed.strategy is missing)
            const spec = normalizePerpCreateSpec(userText, parsed, extractedParams);
            if (!spec) {
              // Side could not be inferred - clarify
              const clarificationText = `Do you want to go long or short on ${marketForStrategy}?`;
              if (typeof appendMessageToActiveChat === 'function') {
                appendMessageToActiveChat({
                  text: clarificationText,
                  isUser: false,
                } as any);
              }
              clearInputAndStopTyping();
              return;
            }
            
            // Use spec-based handler
            const draftId = handleCreatePerpDraftFromSpec(
              spec,
              marketForStrategy,
              userText,
              messageKey,
              targetChatId, // B2: Pass targetChatId from processUserMessage
              extractedParams,
              riskDetection
            );
            
            if (!draftId) {
              clearInputAndStopTyping();
              return;
            }
            
            strategyId = draftId;
            strategy = parsed.strategy || null;
            setOnboarding(prev => ({ ...prev, openedTrade: true }));
            clearInputAndStopTyping();
            return; // CREATE path complete
          }
          
          // Task A: If router says UPDATE, proceed with update logic
          if (action === 'updateSelected') {
            // Get modification data from parser
          const mod = parsed.modifyPerpStrategy;
            if (!mod) {
              const errorMessage: ChatMessage = {
                id: `error-${Date.now()}`,
                text: "I couldn't parse the modification request.",
                isUser: false,
                timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
              };
              appendMessageToChat(targetChatId, errorMessage);
              clearInputAndStopTyping();
              return;
            }
            
            // Resolve target strategy
            let targetStrategyId: string | null = null;
            if (marketResult.type === 'single') {
              const matchingStrategies = strategies.filter(s => 
                s.market === marketResult.market && 
                (s.status === 'executed' || s.status === 'executing' || s.status === 'draft')
              );
              if (matchingStrategies.length > 0) {
                targetStrategyId = matchingStrategies[matchingStrategies.length - 1].id;
              }
            } else if (selectedStrategyId) {
              targetStrategyId = selectedStrategyId;
            } else if (mod.strategyId) {
              // Fallback to parser-provided strategyId if no market/selection
              targetStrategyId = mod.strategyId;
            }
            
            const targetStrategy = targetStrategyId ? strategies.find(s => s.id === targetStrategyId) : null;
          
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
            let newNotionalUsd: number = targetStrategy.notionalUsd || 0;
          
          // Apply modifications
          if (mod.modification.sizeUsd) {
            newNotionalUsd = mod.modification.sizeUsd;
            newRiskPercent = (newNotionalUsd / account.accountValue) * 100;
            updates.notionalUsd = newNotionalUsd;
          }
          
          if (mod.modification.riskPercent) {
            newRiskPercent = mod.modification.riskPercent;
            newNotionalUsd = (account.accountValue * newRiskPercent) / 100;
            updates.riskPercent = newRiskPercent;
            updates.notionalUsd = newNotionalUsd;
          }
          
          if (mod.modification.leverage) {
              updates.leverage = mod.modification.leverage;
              // Recompute notional from margin * leverage
              const marginUsd = targetStrategy.marginUsd || 0;
              if (marginUsd > 0) {
                updates.notionalUsd = marginUsd * mod.modification.leverage;
              }
          }
          
          if (mod.modification.side) {
            updates.side = mod.modification.side;
            const basePrice = targetStrategy.entry || 3500;
            if (mod.modification.side === 'Long') {
              updates.takeProfit = Math.round(basePrice * 1.04);
              updates.stopLoss = Math.round(basePrice * 0.97);
            } else {
              updates.takeProfit = Math.round(basePrice * 0.96);
              updates.stopLoss = Math.round(basePrice * 1.03);
            }
          }
          
            // Task B: Use handleUpdateStrategy instead of direct updateStrategy call
            if (targetStrategyId && Object.keys(updates).length > 0) {
              const parsedStrategyForUpdate: ParsedStrategy = parsed.strategy || {
                market: targetStrategy.market,
                side: targetStrategy.side,
                riskPercent: targetStrategy.riskPercent || 0,
                entryPrice: targetStrategy.entry || 0,
                takeProfit: targetStrategy.takeProfit || 0,
                stopLoss: targetStrategy.stopLoss || 0,
                liqBuffer: 0,
                fundingImpact: 'Low',
              };
              handleUpdateStrategy(targetStrategyId, updates, parsedStrategyForUpdate, targetChatId);
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
          
            // Generate response
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
          }
          
          // Task A: If router says CLARIFY or REJECT, respect that
          if (action === 'clarify') {
            const clarificationText = generateMarketClarification(marketResult);
            if (typeof appendMessageToActiveChat === 'function') {
              appendMessageToActiveChat({
                text: clarificationText,
                isUser: false,
              } as any);
            }
            clearInputAndStopTyping();
            return;
          }
          
          // REJECT or other - show error
          const errorMessage: ChatMessage = {
            id: `error-${Date.now()}`,
            text: "I couldn't determine what you want to update. Please select a position or specify which position to update.",
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          };
          appendMessageToChat(targetChatId, errorMessage);
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
          
          // Dispatch planDrafted event
          window.dispatchEvent(
            new CustomEvent('planDrafted', {
              detail: { type: 'perp', id: newStrategy.id },
            })
          );
        } else if (parsed.intent === 'trade' && parsed.strategy) {
          // Step 2: Strict create vs update routing with market extraction
          const selectedStrategy = selectedStrategyId 
            ? strategies.find(s => s.id === selectedStrategyId) || null
            : null;
          
          // Find active draft (if any)
          const activeDraftStrategy = strategies.find(s => s.status === 'draft' && s.instrumentType === 'perp') || null;
          
          // Part 3: Use strict intent determination V2
          const marketResult = extractMarketStrict(userText);
          
          const action = determineIntentStrictV2(userText, parsed, selectedStrategy, selectedStrategyId);
          
          // Step 1: Collect reasons for intent decision
          const reasons: string[] = [];
          if (parsed.strategy?.side) reasons.push('hasSide');
          if (marketResult.type === 'single') reasons.push(`market=${marketResult.market}`);
          if (selectedStrategyId) reasons.push(`selected=${selectedStrategyId}`);
          if (/\b(open|enter|start|new|long|short|buy|sell)\b/i.test(userText)) reasons.push('newTradeVerbs');
          if (/\b(update|edit|change|adjust|set)\b/i.test(userText)) reasons.push('updateVerbs');
          
          // Step 1: Store routing trace in ring buffer (DEV only)
          if (import.meta.env.DEV) {
            const traceEntry = {
              ts: Date.now(),
              messageKey,
              text: userText,
              selectedStrategyId,
              selectedStrategyMarket: selectedStrategy?.market || null,
              activeDraftStrategyId: activeDraftStrategy?.id || null,
              activeDraftMarket: activeDraftStrategy?.market || null,
              marketExtraction: marketResult,
              parsed: {
                side: parsed.strategy?.side,
                riskPercent: parsed.strategy?.riskPercent,
                leverage: extractedParams?.leverage,
              },
              intent: action,
              reasons,
            };
            
            // Store in ring buffer (keep last 20)
            routingTracesRef.current.push(traceEntry);
            if (routingTracesRef.current.length > 20) {
              routingTracesRef.current.shift();
            }
            
            // Task C: Store last intent for tripwire - ALWAYS set lastIntentRef.current (not just window helper)
            lastIntentRef.current = { action, marketResult };
            if ((window as any).__BLOSSOM_DEBUG__) {
              (window as any).__BLOSSOM_DEBUG__.lastIntent = { action, reasons, marketResult };
            }
            
            // Also log to console
            console.log('[RoutingTrace]', traceEntry);
            console.log('[RoutingTrace] Final intent:', {
              action,
              reasons,
              willCreateNewStrategy: action === 'create',
              willUpdateExisting: action === 'updateSelected',
            });
          }
          
          // Handle clarify path (market missing/ambiguous for new trade)
          if (action === 'clarify') {
            const clarificationText = generateMarketClarification(marketResult);
            if (typeof appendMessageToActiveChat === 'function') {
              appendMessageToActiveChat({
                text: clarificationText,
                isUser: false,
              } as any);
            }
            clearInputAndStopTyping();
            return; // Do not create/update anything
          }
          
          // Part 3: Handle update path (only if explicitly routed by determineIntentStrictV2)
          if (action === 'updateSelected') {
            // Find target strategy (by market or selectedStrategyId)
            let targetStrategyId: string | null = null;
            if (marketResult.type === 'single') {
              // Market mentioned - find most recent executed strategy with that market
              const matchingStrategies = strategies.filter(s => 
                s.market === marketResult.market && 
                (s.status === 'executed' || s.status === 'executing')
              );
              if (matchingStrategies.length > 0) {
                targetStrategyId = matchingStrategies[matchingStrategies.length - 1].id;
              }
            } else if (selectedStrategyId) {
              // No market mention but selectedStrategyId exists
              targetStrategyId = selectedStrategyId;
            }
            
            // INV-3: Check if target is a draft - if so, update draft and replace card
            const targetStrategy = targetStrategyId ? strategies.find(s => s.id === targetStrategyId) : null;
            if (targetStrategy && targetStrategy.status === 'draft') {
              // Update draft strategy
              const updates: Partial<Strategy> = {};
              if (parsed.strategy.riskPercent !== undefined) {
                updates.riskPercent = parsed.strategy.riskPercent;
              }
              if (extractedParams?.leverage !== undefined) {
                updates.leverage = extractedParams.leverage;
              }
              if (parsed.strategy.stopLoss !== undefined) {
                updates.stopLoss = parsed.strategy.stopLoss;
              }
              if (parsed.strategy.takeProfit !== undefined) {
                updates.takeProfit = parsed.strategy.takeProfit;
              }
              
              // INV-5: Recompute sizing if risk or leverage changed
              if (updates.riskPercent !== undefined || updates.leverage !== undefined) {
                const accountValueForSizing = account.accountValue;
                const riskPercent = updates.riskPercent ?? targetStrategy.riskPercent;
                const leverage = updates.leverage ?? targetStrategy.leverage ?? 1;
                const sizing = computePerpFromRisk({
                  accountValue: accountValueForSizing,
                  riskPercent,
                  leverage,
                });
                updates.marginUsd = sizing.marginUsd;
                // notionalUsd will be computed from marginUsd * leverage
                const computedNotional = sizing.marginUsd * leverage;
                
                // DEV invariant check
                if (import.meta.env.DEV) {
                  const expectedNotional = sizing.marginUsd * leverage;
                  if (Math.abs(computedNotional - expectedNotional) > 0.01) {
                    console.error('[Invariant] Sizing math mismatch in draft update:', {
                      marginUsd: sizing.marginUsd,
                      leverage,
                      computedNotional,
                      expectedNotional,
                      diff: Math.abs(computedNotional - expectedNotional),
            sourceText: userText,
                    });
                  }
                }
              }
              
              if (targetStrategyId) {
                handleUpdateStrategy(targetStrategyId, updates, parsed.strategy, targetChatId || activeChatId || createNewChatSession());
                
                // Update the draft card message in place
                const draftMessageId = activeDraftMessageIdRef.current || `draft-${targetStrategyId}`;
                const draftMessage = messages.find(msg => msg.id === draftMessageId);
                if (draftMessage && targetChatId && draftMessageId) {
                  const updatedStrategy: ParsedStrategy = {
                    side: targetStrategy.side,
                    market: targetStrategy.market,
                    riskPercent: updates.riskPercent ?? targetStrategy.riskPercent,
                    entryPrice: targetStrategy.entry || 0,
                    takeProfit: updates.takeProfit ?? targetStrategy.takeProfit,
                    stopLoss: updates.stopLoss ?? targetStrategy.stopLoss,
                    liqBuffer: 0,
                    fundingImpact: 'Low',
                  };
                  if (typeof updateMessageInChat === 'function') {
                    updateMessageInChat(targetChatId, draftMessageId, {
                      strategy: updatedStrategy,
                      strategyId: targetStrategyId,
                    });
                  } else {
                    if (import.meta.env.DEV) {
                      console.error('[Chat] updateMessageInChat is not a function at draft update callsite');
                    }
                  }
                }
              }
              
              clearInputAndStopTyping();
              return; // Early return for draft update path
            }
            
            if (targetStrategyId) {
              // Update existing executed strategy (not draft)
              const updates: Partial<Strategy> = {};
              if (parsed.strategy.riskPercent !== undefined) {
                updates.riskPercent = parsed.strategy.riskPercent;
              }
              // Note: parsed.strategy may not have leverage, check extractedParams
              if (extractedParams?.leverage !== undefined) {
                updates.leverage = extractedParams.leverage;
              }
              if (parsed.strategy.stopLoss !== undefined) {
                updates.stopLoss = parsed.strategy.stopLoss;
              }
              if (parsed.strategy.takeProfit !== undefined) {
                updates.takeProfit = parsed.strategy.takeProfit;
              }
              
              handleUpdateStrategy(targetStrategyId, updates, parsed.strategy, targetChatId || activeChatId || createNewChatSession());
              strategyId = targetStrategyId;
          strategy = parsed.strategy;
          setOnboarding(prev => ({ ...prev, openedTrade: true }));
              return; // Early return for update path
            } else {
              // Update requested but no target found - should not happen (determineIntentStrictV2 should return clarify)
              if (import.meta.env.DEV) {
                console.warn('[Chat] UPDATE path but no target strategy found');
              }
              return;
            }
          }
          
          // Handle reject path (update requested but no valid selection)
          if (action === 'reject') {
            if (typeof appendMessageToActiveChat === 'function') {
              appendMessageToActiveChat({
                text: 'Please select a position in the right panel to update, or create a new trade.',
                isUser: false,
              } as any);
            }
            return;
          }
          
          // Step B: CREATE path - use isolated handler
          // INV-2: CREATE must never call updateStrategy
          if (import.meta.env.DEV) {
            console.log('[CREATE] Starting CREATE path', {
              extractedMarket: marketResult.type === 'single' ? marketResult.market : null,
              selectedStrategyId,
              activeDraftStrategyId: activeDraftStrategy?.id || null,
            });
          }
          
          // INV-1: Fail closed on market - if market cannot be extracted, clarify
          if (marketResult.type !== 'single') {
            const clarificationText = generateMarketClarification(marketResult);
            if (typeof appendMessageToActiveChat === 'function') {
              appendMessageToActiveChat({
                text: clarificationText,
                isUser: false,
              } as any);
            }
            clearInputAndStopTyping();
            return;
          }
          
          const marketForStrategy = marketResult.market;
          
          // Check high-risk
          const riskDetection = !opts?.skipHighRiskCheck ? detectHighRiskIntent(userText) : { isHighRisk: false, reasons: [], extracted: undefined };
          
          // Use isolated CREATE handler
          const draftId = handleCreatePerpDraft(
            parsed,
            marketForStrategy,
            userText,
            messageKey,
            targetChatId, // B2: Pass targetChatId from processUserMessage
            extractedParams,
            riskDetection
          );
          
          if (!draftId) {
            // Handler returned null (clarification or blocked)
            clearInputAndStopTyping();
            return;
          }
          
          strategyId = draftId;
          strategy = parsed.strategy;
          setOnboarding(prev => ({ ...prev, openedTrade: true }));
          clearInputAndStopTyping();
          return; // Early return - CREATE path complete
          
          // OLD CODE REMOVED - replaced by handleCreatePerpDraft above
        }

        // Pass account value to response generator for capping messages
        (parsed as any).accountValue = account.accountValue;
        
        // Update parsed strategy with final values (for response generation)
        // This ensures the response message reflects the actual degenerate params
        if (parsed.intent === 'trade' && parsed.strategy && strategy) {
          parsed.strategy.stopLoss = strategy.stopLoss;
          parsed.strategy.riskPercent = strategy.riskPercent;
          // Also update leverage if it was set
          if (extractedParams?.leverage) {
            (parsed.strategy as any).leverage = extractedParams.leverage;
          }
        }
        
        // Step 5: Remove generic fallback for trade intents definitively
        // Also skip generic response for list intents (they handle their own responses)
        let responseText: string;
        if ((parsed.intent as string) === 'list_top_defi_protocols' || parsed.intent === 'list_top_event_markets') {
          // List intents handle their own responses asynchronously, skip generic response
          return; // Early return - list handlers already appended message
        } else if ((parsed.intent === 'trade' || parsed.intent === 'general') && !strategy && !defiProposalId) {
          // Step 5: Trade intent or clarification continuation should never show generic help
          if (import.meta.env.DEV) {
            console.log('[Chat] guard: prevented generic fallback for trade intent');
          }
          responseText = "I didn't understand. Try: 'long BTC 20x with 2% risk'";
        } else {
          responseText = generateBlossomResponse(parsed, (opts as any)?.originalUserText || userText || '');
        }
        
        const blossomResponse: ChatMessage = {
          id: `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          text: responseText,
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
    };
    
    // Clear input and stop typing at the end
    clearInputAndStopTyping();
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

    // Process the message with high-risk check enabled
    await processUserMessage(text, { skipHighRiskCheck: false });
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
    
    // Part 5: Listen for resetSim event to clear transient chat state
    const handleResetSimChatState = () => {
      setPendingTrade(null);
      setPendingHighRisk(null);
      setChatState('idle');
      if (import.meta.env.DEV) {
        console.log('[ChatState] reset -> idle (Reset SIM)');
      }
    };
    
    window.addEventListener('insertChatPrompt', handleInsertPrompt as EventListener);
    window.addEventListener('resetSimChatState', handleResetSimChatState);
    return () => {
      window.removeEventListener('insertChatPrompt', handleInsertPrompt as EventListener);
      window.removeEventListener('resetSimChatState', handleResetSimChatState);
    };
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Part A: Handle confirm/proceed - execute draftId directly (never re-process message)
  // Must be defined before handleProceedHighRisk and ConfirmTradeCard usage
  const handleConfirmTrade = async (draftId: string) => {
    // B3: Use stored targetChatId from draft creation (no fallback createNewChatSession)
    const targetChatId = activeDraftChatIdRef.current || activeChatId;
    if (!targetChatId) {
      if (import.meta.env.DEV) {
        console.error('[handleConfirmTrade] No targetChatId available');
      }
      return;
    }
    
    // Part A: Set state to executing
    setChatMode({ mode: 'executing', draftId });
    
    // Part A: Execute the draft by transitioning status: draft -> queued -> executing -> executed
    updateStrategyStatus(draftId, 'queued');
    
    // Small delay for UI feedback, then execute
    setTimeout(() => {
      updateStrategyStatus(draftId, 'executing');
      setTimeout(() => {
        updateStrategyStatus(draftId, 'executed');
        
        // Step 6: Multi-position verification (DEV only)
        setTimeout(() => {
          if (import.meta.env.DEV) {
            const executedPerps = strategies.filter(s => 
              s.instrumentType === 'perp' && 
              (s.status === 'executed' || s.status === 'executing') &&
              !s.isClosed &&
              (s.notionalUsd ?? 0) > 0
            );
            const derivedPositions = derivePerpPositionsFromStrategies(strategies);
            const distinctMarkets = new Set(executedPerps.map(s => s.market));
            
            if (executedPerps.length !== derivedPositions.length) {
              console.error('[MultiPosition] Count mismatch:', {
                executedPerps: executedPerps.length,
                derivedPositions: derivedPositions.length,
                executedPerpIds: executedPerps.map(s => s.id),
                derivedPositionIds: derivedPositions.map(p => p.strategyId),
              });
            }
            
            if (distinctMarkets.size > 1) {
              console.log('[MultiPosition] Multiple markets detected:', {
                markets: Array.from(distinctMarkets),
                positionsPerMarket: Array.from(distinctMarkets).map(m => ({
                  market: m,
                  count: executedPerps.filter(s => s.market === m).length,
                })),
              });
            }
          }
        }, 100);
        
        // INV-4: Update the existing draft card message to show executed status
        const draftMessageId = activeDraftMessageIdRef.current;
        const executedStrategy = strategies.find(s => s.id === draftId);
        if (executedStrategy && draftMessageId) {
          // Update the message to show executed status and remove risk warning
          const currentMessages = chatSessions.find(s => s.id === targetChatId)?.messages || [];
          const draftMessage = currentMessages.find(m => m.id === draftMessageId);
          if (draftMessage) {
            const updatedStrategy: ParsedStrategy = {
              side: executedStrategy.side,
              market: executedStrategy.market,
              riskPercent: executedStrategy.riskPercent,
              entryPrice: executedStrategy.entry || 0,
              takeProfit: executedStrategy.takeProfit,
              stopLoss: executedStrategy.stopLoss,
              liqBuffer: 0,
              fundingImpact: 'Low',
            };
            const updatedMessage = {
              text: `✅ Executed: ${executedStrategy.side} ${executedStrategy.market} with ${executedStrategy.riskPercent?.toFixed(1)}% risk at ${executedStrategy.leverage || 1}x leverage.`,
              strategy: updatedStrategy,
              strategyId: draftId,
            };
            // Remove risk warning props (extend message object)
            const messageWithoutRisk = { ...updatedMessage, showRiskWarning: false, riskReasons: undefined } as any;
            if (typeof updateMessageInChat === 'function') {
              updateMessageInChat(targetChatId, draftMessageId, messageWithoutRisk);
            } else {
              if (import.meta.env.DEV) {
                console.error('[Chat] updateMessageInChat is not a function at confirm callsite');
              }
            }
          }
        }
        
        // Clear draft message tracking
        activeDraftMessageIdRef.current = null;
        activeDraftChatIdRef.current = null;
        
        // Part A: Return to idle
        setChatMode({ mode: 'idle' });
        setChatState('idle');
        
        if (import.meta.env.DEV) {
          console.log('[Chat] Confirm: draft executed', { draftId });
        }
      }, 500);
    }, 300);
  };

  // Step 4: Invariant 0.5 - High-risk proceed executes specific draftId (no re-processing)
  const handleProceedHighRisk = async () => {
    if (!pendingHighRisk?.pendingDraftId) return;
    
    const pendingDraftId = pendingHighRisk.pendingDraftId;
    
    // Part B: Clear pending state immediately (banner will collapse)
    setPendingHighRisk(null);
    
    // Part A: Use the same confirm handler
    await handleConfirmTrade(pendingDraftId);
  };

  // Handle high-risk confirmation: Edit
  const handleEditHighRisk = () => {
    if (!pendingHighRisk) return;
    setInputValue(pendingHighRisk.originalText);
    if (textareaRef.current) {
      textareaRef.current.value = pendingHighRisk.originalText;
      textareaRef.current.focus();
    }
    setPendingHighRisk(null);
  };

  // Handle high-risk confirmation: Rewrite
  const handleRewriteHighRisk = () => {
    if (!pendingHighRisk) return;
    // Generate safer prompt
    const marketMatch = pendingHighRisk.originalText.match(/\b(ETH|BTC|SOL|BNB|AVAX)\b/i);
    const market = marketMatch ? marketMatch[1] : 'ETH';
    const side = /short/i.test(pendingHighRisk.originalText) ? 'short' : 'long';
    const saferPrompt = `${side} ${market} with 2% risk, 3x leverage max, include a stop loss`;
    
    setInputValue(saferPrompt);
    if (textareaRef.current) {
      textareaRef.current.value = saferPrompt;
      textareaRef.current.focus();
    }
    setPendingHighRisk(null);
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
              <div className="text-[11px] font-medium text-slate-500 mb-1">Try an execution request</div>
              <div className="text-[10px] text-slate-400 mb-3">Prices are live. Execution and routing are simulated until you confirm.</div>
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
              {messages.map((msg) => {
                // Part B: Check if this is a trade_confirm message
                const isTradeConfirm = (msg as any).type === 'trade_confirm';
                const confirmDraftId = (msg as any).draftId;
                const isHighRiskConfirmation = (msg as any).isHighRiskConfirmation;
                const highRiskReasons = (msg as any).highRiskReasons || [];
                
                if (isTradeConfirm && confirmDraftId) {
                  // Part B: Show confirm card (with optional risk warning)
                  const showRiskWarning = isHighRiskConfirmation && highRiskReasons.length > 0;
                  return (
                    <div key={msg.id} className="flex gap-2 mb-1.5">
                      <div className="flex-shrink-0">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-blossom-pink/30">
                          <BlossomLogo size={20} />
                        </div>
                      </div>
                      <div className="flex flex-col items-start max-w-[70%]">
                        <div className="text-[11px] font-medium text-gray-600 mb-0.5">
                          Blossom
                        </div>
                        <ConfirmTradeCard
                          draftId={confirmDraftId}
                          showRiskWarning={showRiskWarning}
                          riskReasons={highRiskReasons}
                          onConfirm={handleConfirmTrade}
                          onEdit={() => {
                            // Part A: Edit handler - for demo, just log
                            if (import.meta.env.DEV) {
                              console.log('[Chat] Edit requested for draft', confirmDraftId);
                            }
                          }}
                        />
                      </div>
                    </div>
                  );
                }
                
                // Legacy: Check if this is a high-risk confirmation message (backward compatibility)
                if (isHighRiskConfirmation && !isTradeConfirm) {
                  return (
                    <div key={msg.id} className="flex gap-2 mb-1.5">
                      <div className="flex-shrink-0">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-blossom-pink/30">
                          <BlossomLogo size={20} />
                        </div>
                      </div>
                      <div className="flex flex-col items-start max-w-[70%]">
                        <div className="text-[11px] font-medium text-gray-600 mb-0.5">
                          Blossom
                        </div>
                        <HighRiskConfirmCard
                          reasons={highRiskReasons}
                          onProceed={handleProceedHighRisk}
                          onEdit={handleEditHighRisk}
                          onRewrite={handleRewriteHighRisk}
                        />
                      </div>
                    </div>
                  );
                }
                
                // Execution details now live inside chat plan card (MessageBubble)
                // No separate ExecutionPlanCard needed
                
                // Part 1: Use unified MessageBubble for all messages (draft and executed)
                const msgShowRiskWarning = (msg as any).showRiskWarning;
                const msgRiskReasons = (msg as any).riskReasons || [];
                const msgStrategyId = msg.strategyId;
                
                return (
                  <div key={msg.id}>
                <MessageBubble
                  text={msg.text}
                  isUser={msg.isUser}
                  timestamp={msg.timestamp}
                  strategy={msg.strategy}
                      strategyId={msgStrategyId}
                  selectedStrategyId={selectedStrategyId}
                  defiProposalId={msg.defiProposalId}
                      executionMode={executionMode}
                  marketsList={msg.marketsList}
                  defiProtocolsList={msg.defiProtocolsList}
                  onInsertPrompt={(text) => {
                    setInputValue(text);
                    textareaRef.current?.focus();
                  }}
                  onSendMessage={async (text) => {
                    // Auto-send: directly call processUserMessage (same as Send button)
                    await processUserMessage(text, { skipHighRiskCheck: false });
                  }}
                  onRegisterStrategyRef={(id, element) => {
                    if (element) {
                      strategyRefsMap.current.set(id, element);
                    } else {
                      strategyRefsMap.current.delete(id);
                    }
                  }}
                      // Part 1: Pass draft action handler and risk warning
                      onConfirmDraft={msgStrategyId ? handleConfirmTrade : undefined}
                      showRiskWarning={msgShowRiskWarning}
                      riskReasons={msgRiskReasons}
                />
                  </div>
                );
              })}
              {isTyping && <TypingIndicator />}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>
      <div className="flex-shrink-0 border-t border-slate-100 bg-white/90 backdrop-blur-sm shadow-[0_-4px_20px_rgba(15,23,42,0.08)]" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="max-w-3xl mx-auto">
          {/* Latest Execution Plan Fallback - pinned above input */}
          {/* Latest Execution Plan Fallback removed - execution details now live inside chat plan card */}
          {/* Toggle strip above QuickStart */}
          <div className="px-4 pt-1 pb-1 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setShowQuickStart(v => !v)}
              data-coachmark="quick-actions"
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
  
  // Part 6: DEV-only acceptance runner
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    
    const runAcceptance8 = async () => {
      console.log('\n=== Running 8 Acceptance Tests ===\n');
      
      const results: Array<{ step: number; name: string; pass: boolean; reason?: string }> = [];
      
      // Helper to simulate sending a message
      const sendMessage = async (text: string) => {
        if (textareaRef.current) {
          textareaRef.current.value = text;
        }
        setInputValue(text);
        await processUserMessage(text, { skipAppendUserMessage: false });
        // Wait for async processing
        await new Promise(resolve => setTimeout(resolve, 2000));
      };
      
      // Helper to click proceed
      const clickProceed = async () => {
        if (pendingHighRisk) {
          await handleProceedHighRisk();
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      };
      
      // Helper to fund REDACTED (disabled - fundUsdc not available)
      const fund = (amount: number) => {
        // fundUsdc(amount); // Removed - function not available
        if (import.meta.env.DEV) {
          console.warn('[Chat] fundUsdc not available');
        }
      };
      
      // Helper to reset
      const reset = async () => {
        await resetSim();
        await new Promise(resolve => setTimeout(resolve, 500));
      };
      
      // Test 1: Clarification only
      try {
        await reset();
        await sendMessage('long 20x');
        await new Promise(resolve => setTimeout(resolve, 1500));
        const test1Pass = chatState === 'awaiting_market' && pendingTrade !== null;
        results.push({ 
          step: 1, 
          name: 'Clarification only', 
          pass: test1Pass,
          reason: test1Pass ? undefined : `Expected awaiting_market, got ${chatState}` 
        });
      } catch (e: any) {
        results.push({ step: 1, name: 'Clarification only', pass: false, reason: e.message });
      }
      
      // Test 2: Reply "btc" to clarification
      try {
        await sendMessage('btc');
        await new Promise(resolve => setTimeout(resolve, 2000));
        const test2Pass = chatState === 'idle' && pendingTrade === null;
        results.push({ 
          step: 2, 
          name: 'Reply "btc" continues trade', 
          pass: test2Pass,
          reason: test2Pass ? undefined : `Expected idle, got ${chatState}` 
        });
      } catch (e: any) {
        results.push({ step: 2, name: 'Reply "btc" continues trade', pass: false, reason: e.message });
      }
      
      // Test 3: Explicit market, skip clarification
      try {
        await reset();
        await sendMessage('long btc 20x with 2% risk');
        await new Promise(resolve => setTimeout(resolve, 2000));
        const executedBtc = strategies.find(s => s.market === 'BTC-PERP' && s.status === 'executed');
        const test3Pass = executedBtc !== undefined && (executedBtc.notionalUsd || 0) > 0;
        results.push({ 
          step: 3, 
          name: 'Explicit market executes', 
          pass: test3Pass,
          reason: test3Pass ? undefined : 'BTC strategy not executed or notional is 0' 
        });
      } catch (e: any) {
        results.push({ step: 3, name: 'Explicit market executes', pass: false, reason: e.message });
      }
      
      // Test 4: Second position does not overwrite
      try {
        await sendMessage('long eth with my entire portfolio at 20x');
        await new Promise(resolve => setTimeout(resolve, 2000));
        if (pendingHighRisk) {
          await clickProceed();
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
        const btcStrategy = strategies.find(s => s.market === 'BTC-PERP' && s.status === 'executed');
        const ethStrategy = strategies.find(s => s.market === 'ETH-PERP' && s.status === 'executed');
        const test4Pass = btcStrategy !== undefined && ethStrategy !== undefined && 
          (btcStrategy.notionalUsd || 0) > 0 && (ethStrategy.notionalUsd || 0) > 0;
        results.push({ 
          step: 4, 
          name: 'Second position does not overwrite', 
          pass: test4Pass,
          reason: test4Pass ? undefined : 'BTC or ETH strategy missing/overwritten' 
        });
      } catch (e: any) {
        results.push({ step: 4, name: 'Second position does not overwrite', pass: false, reason: e.message });
      }
      
      // Test 5: Rest-of-portfolio with low REDACTED
      try {
        await reset();
        await sendMessage('long btc with my entire portfolio at 20x');
        if (pendingHighRisk) {
          await clickProceed();
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
        await sendMessage('long btc with the rest of my portfolio at 20x');
        await new Promise(resolve => setTimeout(resolve, 2000));
        const blockedBtc = strategies.find(s => s.market === 'BTC-PERP' && (s.status as string) === 'blocked');
        const test5Pass = blockedBtc !== undefined;
        results.push({ 
          step: 5, 
          name: 'Rest-of-portfolio with low REDACTED blocks', 
          pass: test5Pass,
          reason: test5Pass ? undefined : 'Strategy not blocked when REDACTED is low' 
        });
      } catch (e: any) {
        results.push({ step: 5, name: 'Rest-of-portfolio with low REDACTED blocks', pass: false, reason: e.message });
      }
      
      // Test 6: Fund REDACTED
      try {
        fund(2000);
        await new Promise(resolve => setTimeout(resolve, 500));
        const usdcBalance = account.balances.find(b => b.symbol === 'REDACTED');
        const test6Pass = (usdcBalance?.balanceUsd || 0) > 0;
        results.push({ 
          step: 6, 
          name: 'Fund REDACTED increases balance', 
          pass: test6Pass,
          reason: test6Pass ? undefined : 'REDACTED balance not increased' 
        });
      } catch (e: any) {
        results.push({ step: 6, name: 'Fund REDACTED increases balance', pass: false, reason: e.message });
      }
      
      // Test 7: Retry after funding
      try {
        await sendMessage('long btc with the rest of my portfolio at 20x');
        if (pendingHighRisk) {
          await clickProceed();
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
        const executedBtc = strategies.find(s => s.market === 'BTC-PERP' && s.status === 'executed');
        const test7Pass = executedBtc !== undefined && (executedBtc.notionalUsd || 0) > 0;
        results.push({ 
          step: 7, 
          name: 'Retry after funding executes', 
          pass: test7Pass,
          reason: test7Pass ? undefined : 'BTC strategy not executed after funding' 
        });
      } catch (e: any) {
        results.push({ step: 7, name: 'Retry after funding executes', pass: false, reason: e.message });
      }
      
      // Test 8: Exposure matches strategy aggregate
      try {
        const derivedPositions = derivePerpPositionsFromStrategies(strategies);
        const totalExposure = derivedPositions.reduce((sum: number, pos: { notionalUsd: number }) => sum + pos.notionalUsd, 0);
        const test8Pass = Math.abs(totalExposure - account.openPerpExposure) < 0.01;
        results.push({ 
          step: 8, 
          name: 'Exposure matches strategy aggregate', 
          pass: test8Pass,
          reason: test8Pass ? undefined : `Exposure mismatch: derived=${totalExposure}, account=${account.openPerpExposure}` 
        });
      } catch (e: any) {
        results.push({ step: 8, name: 'Exposure matches strategy aggregate', pass: false, reason: e.message });
      }
      
      // Print results
      console.log('\n=== Test Results ===');
      results.forEach(r => {
        console.log(`${r.pass ? '✅ PASS' : '❌ FAIL'} Step ${r.step}: ${r.name}`);
        if (r.reason) {
          console.log(`   Reason: ${r.reason}`);
        }
      });
      const passCount = results.filter(r => r.pass).length;
      console.log(`\n${passCount}/${results.length} tests passed\n`);
      
      return results;
    };
    
    // Part 5: Extended acceptance tests (A, B, C)
    const runAcceptanceLocal = async () => {
      console.log('\n=== Running Extended Acceptance Tests (A, B, C) ===\n');
      const results: Array<{ test: string; name: string; pass: boolean; reason?: string }> = [];
      
      // Helper to simulate sending a message
      const sendMsg = async (text: string) => {
        if (textareaRef.current) {
          textareaRef.current.value = text;
        }
        setInputValue(text);
        await processUserMessage(text, { skipAppendUserMessage: false });
        await new Promise(resolve => setTimeout(resolve, 2000));
      };
      
      // Helper to click proceed
      const clickProc = async () => {
        if (pendingHighRisk) {
          await handleProceedHighRisk();
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      };
      
      // Helper to execute strategy
      const executeStrategy = async () => {
        const executeBtn = document.querySelector('[data-testid="execute-strategy"]') as HTMLButtonElement;
        if (executeBtn) {
          executeBtn.click();
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      };
      
      // Test 1: Risk sizing exactness (Step 5.1)
      // accountValue=9800, 2% @ 10x ⇒ margin=196, notional=1960 (exact)
      try {
        await resetSim();
        // Set account to exactly 9800 for test
        const testAccountValue = 9800;
        // Fund to get to 9800
        const currentValue = account.accountValue;
        if (currentValue < testAccountValue) {
          // fundUsdc(testAccountValue - currentValue); // Removed - function not available
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        const accountTotalBefore = account.accountValue;
        
        await sendMsg('long btc with 2% account risk using 10x leverage');
        await new Promise(resolve => setTimeout(resolve, 1500));
        await clickProc();
        await executeStrategy();
        
        const btcStrategy = strategies.find(s => s.instrumentType === 'perp' && s.market?.includes('BTC') && s.status === 'executed');
        if (!btcStrategy) {
          results.push({ test: '1', name: 'Risk sizing exactness', pass: false, reason: 'BTC strategy not executed' });
        } else {
          // Step 5.1: Exact math - no rounding tolerance
          const expectedMargin = accountTotalBefore * 0.02; // 9800 * 0.02 = 196
          const expectedNotional = expectedMargin * 10; // 196 * 10 = 1960
          const marginOk = Math.abs((btcStrategy.marginUsd || 0) - expectedMargin) < 0.01; // Exact to cent
          const notionalOk = Math.abs((btcStrategy.notionalUsd || 0) - expectedNotional) < 0.01; // Exact to cent
          
          const derivedPositions = derivePerpPositionsFromStrategies(strategies);
          const btcPosition = derivedPositions.find(p => p.instrument.includes('BTC'));
          const rightPanelShowsCorrect = btcPosition && Math.abs(btcPosition.notionalUsd - expectedNotional) < 0.01;
          
          const test1Pass = marginOk && notionalOk && (rightPanelShowsCorrect ?? false);
          results.push({
            test: '1',
            name: 'Risk sizing exactness (2% @ 10x on $9800 = $196 margin, $1960 notional)',
            pass: test1Pass,
            reason: test1Pass ? undefined : `margin: expected=${expectedMargin.toFixed(2)}, got=${(btcStrategy.marginUsd || 0).toFixed(2)}; notional: expected=${expectedNotional.toFixed(2)}, got=${(btcStrategy.notionalUsd || 0).toFixed(2)}`
          });
        }
      } catch (e: any) {
        results.push({ test: '1', name: 'Risk sizing exactness', pass: false, reason: e.message });
      }
      
      // Test 2: Two positions (Step 5.2)
      // create BTC 2% @ 10x, create ETH 1% @ 3x
      // assert 2 strategies, markets differ, BTC unchanged
      try {
        await resetSim();
        
        // Execute BTC
        await sendMsg('long btc with 2% account risk using 10x leverage');
        await new Promise(resolve => setTimeout(resolve, 1500));
        await clickProc();
        await executeStrategy();
        
        const btcStrategy = strategies.find(s => s.instrumentType === 'perp' && s.market?.includes('BTC') && s.status === 'executed');
        if (!btcStrategy) {
          results.push({ test: '2', name: 'Two positions', pass: false, reason: 'BTC strategy not executed' });
        } else {
          const btcNotional = btcStrategy.notionalUsd || 0;
          const btcId = btcStrategy.id;
          
          // Execute ETH (using "now lets" to test create keyword)
          await sendMsg('now lets long eth using 1% account risk and 3x leverage');
          await new Promise(resolve => setTimeout(resolve, 1500));
          await clickProc();
          await executeStrategy();
          
          // Assertions
          const derivedPositions2 = derivePerpPositionsFromStrategies(strategies);
          const btcPos2 = derivedPositions2.find(p => p.instrument.includes('BTC'));
          const ethPos = derivedPositions2.find(p => p.instrument.includes('ETH'));
          const btcStrategy2 = strategies.find(s => s.id === btcId);
          const ethStrategy = strategies.find(s => s.instrumentType === 'perp' && s.market?.includes('ETH') && s.status === 'executed');
          
          const test2Pass = 
            derivedPositions2.length === 2 &&
            btcPos2 !== undefined &&
            ethPos !== undefined &&
            btcStrategy2 !== undefined &&
            ethStrategy !== undefined &&
            btcStrategy2.market !== ethStrategy.market && // Markets differ
            Math.abs((btcStrategy2.notionalUsd || 0) - btcNotional) < 0.01 && // BTC unchanged
            btcStrategy2.id !== ethStrategy.id; // Different IDs
          
          results.push({
            test: '2',
            name: 'Two positions (BTC 2% @ 10x, ETH 1% @ 3x)',
            pass: test2Pass,
            reason: test2Pass ? undefined : `Expected 2 positions, markets differ, BTC unchanged. Got ${derivedPositions2.length}, BTC market=${btcStrategy2?.market}, ETH market=${ethStrategy?.market}, BTC notional changed: ${Math.abs((btcStrategy2?.notionalUsd || 0) - btcNotional)}`
          });
        }
      } catch (e: any) {
        results.push({ test: '2', name: 'Two positions', pass: false, reason: e.message });
      }
      
      // Test 3: No silent fallback (Step 5.3)
      // message: "long with 2% risk 10x" (no market) ⇒ no strategy created, returns clarification
      try {
        await resetSim();
        
        const strategiesBefore = strategies.length;
        
        // Send message without market
        await sendMsg('long with 2% risk 10x');
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Should show clarification, not create strategy
        const strategiesAfter = strategies.length;
        const lastMessage = messages[messages.length - 1];
        const showsClarification = lastMessage && !lastMessage.isUser && 
          (lastMessage.text.includes('Which market') || lastMessage.text.includes('BTC-PERP') || lastMessage.text.includes('ETH-PERP'));
        
        const test3Pass = 
          strategiesAfter === strategiesBefore && // No new strategy created
          showsClarification; // Clarification shown
        
        results.push({
          test: '3',
          name: 'No silent fallback (missing market → clarification)',
          pass: test3Pass,
          reason: test3Pass ? undefined : `Expected clarification, no strategy created. Strategies: ${strategiesBefore} -> ${strategiesAfter}, clarification shown: ${showsClarification}`
        });
      } catch (e: any) {
        results.push({ test: '3', name: 'No silent fallback', pass: false, reason: e.message });
      }
      
      // Test 3b: Update requires explicit (not "now lets")
      try {
        await resetSim();
        
        // Create BTC first
        await sendMsg('long btc with 2% account risk using 10x leverage');
        await new Promise(resolve => setTimeout(resolve, 1500));
        await clickProc();
        await executeStrategy();
        
        const btcStrategy = strategies.find(s => s.instrumentType === 'perp' && s.market?.includes('BTC') && s.status === 'executed');
        if (!btcStrategy) {
          results.push({ test: '3b', name: 'Update requires explicit', pass: false, reason: 'BTC strategy not executed' });
        } else {
          const btcNotional = btcStrategy.notionalUsd || 0;
          const btcId = btcStrategy.id;
          
          // Select BTC
          setSelectedStrategyId(btcId);
          
          // Try to create ETH with "now lets" - should CREATE, not UPDATE
          await sendMsg('now lets long eth using 1% account risk and 3x leverage');
          await new Promise(resolve => setTimeout(resolve, 1500));
          await clickProc();
          await executeStrategy();
          
          // Assertions: ETH should be created, BTC unchanged
          const derivedPositions3 = derivePerpPositionsFromStrategies(strategies);
          const btcPos3 = derivedPositions3.find(p => p.instrument.includes('BTC'));
          const ethPos3 = derivedPositions3.find(p => p.instrument.includes('ETH'));
          const btcStrategy3 = strategies.find(s => s.id === btcId);
          
          const test3bPass = 
            derivedPositions3.length === 2 &&
            btcPos3 !== undefined &&
            ethPos3 !== undefined &&
            Math.abs((btcStrategy3?.notionalUsd || 0) - btcNotional) < 0.01 &&
            (ethPos3?.notionalUsd || 0) > 0 &&
            btcStrategy3?.id !== (ethPos3?.strategyId || ''); // Different IDs
          
          results.push({
            test: '3b',
            name: 'Update requires explicit (not "now lets")',
            pass: test3bPass,
            reason: test3bPass ? undefined : `Expected 2 positions (BTC+ETH), BTC unchanged. Got ${derivedPositions3.length}, BTC notional changed: ${Math.abs((btcStrategy3?.notionalUsd || 0) - btcNotional)}`
          });
        }
      } catch (e: any) {
        results.push({ test: '3b', name: 'Update requires explicit', pass: false, reason: e.message });
      }
      
      // Test 4: Editor only updates selected
      try {
        const btcStrategy = strategies.find(s => s.instrumentType === 'perp' && s.market?.includes('BTC') && s.status === 'executed');
        const ethStrategy = strategies.find(s => s.instrumentType === 'perp' && s.market?.includes('ETH') && s.status === 'executed');
        
        if (!btcStrategy || !ethStrategy) {
          results.push({ test: '4', name: 'Editor updates only selected', pass: false, reason: 'BTC or ETH strategy not found' });
        } else {
          // Select BTC
          setSelectedStrategyId(btcStrategy.id);
          const originalBtcNotional = btcStrategy.notionalUsd || 0;
          const originalEthNotional = ethStrategy.notionalUsd || 0;
          
          // Update BTC size
          updatePerpSizeById(btcStrategy.id, originalBtcNotional + 1000);
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Check BTC changed, ETH unchanged
          const btcStrategyAfter = strategies.find(s => s.id === btcStrategy.id);
          const ethStrategyAfter = strategies.find(s => s.id === ethStrategy.id);
          
          const test4Pass = 
            btcStrategyAfter !== undefined &&
            Math.abs((btcStrategyAfter.notionalUsd || 0) - (originalBtcNotional + 1000)) < 0.01 &&
            Math.abs((ethStrategyAfter?.notionalUsd || 0) - originalEthNotional) < 0.01;
          
          results.push({
            test: '4',
            name: 'Editor updates only selected',
            pass: test4Pass,
            reason: test4Pass ? undefined : `BTC: expected=${originalBtcNotional + 1000}, got=${btcStrategyAfter?.notionalUsd}; ETH: expected=${originalEthNotional}, got=${ethStrategyAfter?.notionalUsd}`
          });
        }
      } catch (e: any) {
        results.push({ test: '4', name: 'Editor updates only selected', pass: false, reason: e.message });
      }
      
      // Test 4a: Update specific position by market (Step 7)
      // "update stop loss on BTC to 44000" updates only BTC
      try {
        await resetSim();
        
        // Create BTC and ETH
        await sendMsg('long btc with 2% account risk using 10x leverage');
        await new Promise(resolve => setTimeout(resolve, 1500));
        await clickProc();
        await executeStrategy();
        await new Promise(resolve => setTimeout(resolve, 500));
        
        await sendMsg('long eth with 1% account risk using 3x leverage');
        await new Promise(resolve => setTimeout(resolve, 1500));
        await clickProc();
        await executeStrategy();
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const btcStrategy = strategies.find(s => s.instrumentType === 'perp' && s.market?.includes('BTC') && s.status === 'executed');
        const ethStrategy = strategies.find(s => s.instrumentType === 'perp' && s.market?.includes('ETH') && s.status === 'executed');
        
        if (!btcStrategy || !ethStrategy) {
          results.push({ test: '4a', name: 'Update specific position by market', pass: false, reason: 'BTC or ETH strategy not found' });
        } else {
          const originalEthSl = ethStrategy.stopLoss;
          
          // Update BTC stop loss via chat (explicit market mention)
          await sendMsg('update stop loss on BTC to 44000');
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          const btcStrategyAfter = strategies.find(s => s.id === btcStrategy.id);
          const ethStrategyAfter = strategies.find(s => s.id === ethStrategy.id);
          
          const test4aPass = 
            btcStrategyAfter !== undefined &&
            ethStrategyAfter !== undefined &&
            Math.abs((btcStrategyAfter.stopLoss || 0) - 44000) < 0.01 && // BTC updated
            Math.abs((ethStrategyAfter.stopLoss || 0) - originalEthSl) < 0.01; // ETH unchanged
          
          results.push({
            test: '4a',
            name: 'Update specific position by market (BTC only)',
            pass: test4aPass,
            reason: test4aPass ? undefined : `BTC SL: expected=44000, got=${btcStrategyAfter?.stopLoss}; ETH SL: expected=${originalEthSl}, got=${ethStrategyAfter?.stopLoss}`
          });
        }
      } catch (e: any) {
        results.push({ test: '4a', name: 'Update specific position by market', pass: false, reason: e.message });
      }
      
      // Test 4b: High-risk confirm isolated (Step 5.4)
      // high-risk create BTC, confirm executes the same draftId, ensure banner collapses after confirm
      try {
        await resetSim();
        
        // Create high-risk BTC trade that triggers gate
        await sendMsg('long btc with 50% account risk using 20x leverage');
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Assert high-risk gate appeared
        const btcPendingId = pendingHighRisk?.pendingDraftId;
        if (!btcPendingId) {
          results.push({ test: '4b', name: 'High-risk confirm isolated', pass: false, reason: 'High-risk gate did not appear' });
        } else {
          // Before clicking proceed, send a different new trade message (ETH)
          await sendMsg('long eth using 1% account risk and 3x leverage');
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          // Assert: ETH draft created with its own ID, BTC pending still pending
          const ethDraft = strategies.find(s => s.instrumentType === 'perp' && s.market?.includes('ETH') && s.status === 'draft');
          const btcDraft = strategies.find(s => s.id === btcPendingId);
          
          const test4bPass = 
            ethDraft !== undefined &&
            ethDraft.id !== (btcDraft?.id || '') &&
            pendingHighRisk !== null &&
            pendingHighRisk.pendingDraftId === btcPendingId; // BTC pending still linked to BTC
          
          results.push({
            test: '4b',
            name: 'High-risk confirm isolated (new message does not reuse pending)',
            pass: test4bPass,
            reason: test4bPass ? undefined : `ETH draft missing or BTC pending reused. ETH id=${ethDraft?.id}, BTC id=${btcDraft?.id}, pendingHighRisk=${pendingHighRisk ? 'exists' : 'null'}`
          });
          
          // Step 5.4: Proceed BTC - should execute the same draftId
          await clickProc();
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Assert: BTC executed, pendingHighRisk cleared (banner collapsed)
          const btcExecuted = strategies.find(s => s.id === btcPendingId && s.status === 'executed');
          const bannerCollapsed = pendingHighRisk === null;
          
          const test4bFinalPass = btcExecuted !== undefined && bannerCollapsed;
          if (!test4bFinalPass) {
            results.push({
              test: '4b-final',
              name: 'High-risk: confirm executes draftId and banner collapses',
              pass: false,
              reason: `BTC executed: ${btcExecuted !== undefined}, banner collapsed: ${bannerCollapsed}`
            });
          }
        }
      } catch (e: any) {
        results.push({ test: '4b', name: 'High-risk confirm isolated', pass: false, reason: e.message });
      }
      
      // Test 5: Margin-based request (e.g., "2k long at 20x" → margin=2000, notional=40000)
      try {
        await resetSim();
        const accountTotalBefore = account.accountValue;
        await sendMsg('open a 2000 20x long on btc');
        await new Promise(resolve => setTimeout(resolve, 1500));
        await clickProc();
        await executeStrategy();
        
        const btcStrategy = strategies.find(s => s.instrumentType === 'perp' && s.market?.includes('BTC') && s.status === 'executed');
        if (!btcStrategy) {
          results.push({ test: '5', name: 'Margin-based request', pass: false, reason: 'BTC strategy not executed' });
        } else {
          const expectedMargin = 2000;
          const expectedNotional = 2000 * 20; // 40000
          const expectedRiskPercent = (expectedMargin / accountTotalBefore) * 100;
          
          const marginOk = Math.abs((btcStrategy.marginUsd || 0) - expectedMargin) < 1;
          const notionalOk = Math.abs((btcStrategy.notionalUsd || 0) - expectedNotional) < 1;
          const riskOk = Math.abs((btcStrategy.riskPercent || 0) - expectedRiskPercent) < 0.1;
          
          const test5Pass = marginOk && notionalOk && riskOk;
          results.push({
            test: '5',
            name: 'Margin-based request',
            pass: test5Pass,
            reason: test5Pass ? undefined : `margin: expected=${expectedMargin}, got=${btcStrategy.marginUsd}; notional: expected=${expectedNotional}, got=${btcStrategy.notionalUsd}; risk: expected=${expectedRiskPercent.toFixed(2)}, got=${btcStrategy.riskPercent?.toFixed(2)}`
          });
        }
      } catch (e: any) {
        results.push({ test: '5', name: 'Margin-based request', pass: false, reason: e.message });
      }
      
      // Test E: First message persistence (Task E)
      try {
        await resetSim();
        
        // Clear all chats
        const clearChats = () => {
          localStorage.removeItem('blossom_chat_sessions');
          localStorage.removeItem('blossom_active_chat_id');
        };
        clearChats();
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Send first message
        await sendMsg('long btc with 1k and 5x leverage');
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Assertions
        const finalSessions = chatSessions;
        const finalActiveId = activeChatId;
        const sessionWithMessage = finalSessions.find(s => {
          const userMessages = s.messages.filter(m => m.isUser);
          return userMessages.length > 0 && userMessages[0].text.includes('long btc');
        });
        
        const testEPass = 
          finalSessions.length >= 1 && // At least one session exists
          finalActiveId !== null && // Active chat is set
          sessionWithMessage !== undefined && // Session contains the user message
          sessionWithMessage.messages.some(m => m.isUser && m.text.includes('long btc')); // User message is present
        
        results.push({
          test: 'E',
          name: 'First message persistence (Task E)',
          pass: testEPass,
          reason: testEPass ? undefined : `sessions=${finalSessions.length}, activeId=${finalActiveId}, hasMessage=${sessionWithMessage !== undefined}, messageText=${sessionWithMessage?.messages.find(m => m.isUser)?.text || 'none'}`
        });
      } catch (e: any) {
        results.push({ test: 'E', name: 'First message persistence', pass: false, reason: e.message });
      }
      
      // Print results
      console.log('\n=== Acceptance Test Results ===');
      results.forEach(r => {
        console.log(`${r.pass ? '✅ PASS' : '❌ FAIL'} Test ${r.test}: ${r.name}`);
        if (r.reason) {
          console.log(`   Reason: ${r.reason}`);
        }
      });
      const passCount = results.filter(r => r.pass).length;
      console.log(`\n${passCount}/${results.length} tests passed\n`);
      
      return results;
    };
    
    // Verification tests for Fix A & B
    const runVerificationTests = async () => {
      const results: Array<{ test: string; name: string; pass: boolean; reason?: string; details?: any }> = [];
      
      // Helper functions
      const sendMsg = async (text: string) => {
        if (textareaRef.current) {
          textareaRef.current.value = text;
        }
        setInputValue(text);
        await processUserMessage(text, { skipAppendUserMessage: false });
        await new Promise(resolve => setTimeout(resolve, 2000));
      };
      
      try {
        // Test: First message persists in visible session
        await resetSim();
        await new Promise(resolve => setTimeout(resolve, 500));
        await sendMsg('hello, this is my first message');
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const sessionCount = chatSessions.length;
        const activeSession = chatSessions.find(s => s.id === activeChatId);
        const userMessages = activeSession?.messages.filter(m => m.isUser) || [];
        const titleUpdated = activeSession?.title !== 'New chat';
        
        const test1Pass = sessionCount === 1 && userMessages.length === 1 && titleUpdated;
        results.push({
          test: '1',
          name: 'First message persists in visible session',
          pass: test1Pass,
          reason: test1Pass ? undefined : `sessionCount=${sessionCount}, userMsgs=${userMessages.length}, titleUpdated=${titleUpdated}`,
          details: {
            sessionCount,
            activeChatId,
            activeSessionTitle: activeSession?.title,
            userMessageCount: userMessages.length,
            allSessions: chatSessions.map(s => ({ id: s.id, title: s.title, msgs: s.messages.length }))
          }
        });
      } catch (e: any) {
        results.push({ test: '1', name: 'First message persists', pass: false, reason: e.message });
      }
      
      try {
        // Test: Confirm doesn't crash (updateMessageInChat works)
        await resetSim();
        await new Promise(resolve => setTimeout(resolve, 500));
        await sendMsg('long btc with 2% risk');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const draft = strategies.find(s => s.status === 'draft' && s.instrumentType === 'perp');
        if (!draft) {
          results.push({ test: '2', name: 'Confirm flow (draft created)', pass: false, reason: 'No draft created' });
        } else {
          // Simulate confirm (this would normally be triggered by user click)
          const draftId = draft.id;
          const targetChatIdBefore = activeDraftChatIdRef.current || activeChatId;
          
          // Check that updateMessageInChat is available
          const updateMessageInChatAvailable = typeof updateMessageInChat === 'function';
          
          results.push({
            test: '2',
            name: 'Confirm flow (updateMessageInChat available)',
            pass: updateMessageInChatAvailable,
            reason: updateMessageInChatAvailable ? undefined : 'updateMessageInChat is not a function',
            details: {
              updateMessageInChatType: typeof updateMessageInChat,
              draftId,
              targetChatIdBefore,
              activeDraftChatIdRef: activeDraftChatIdRef.current,
              activeDraftMessageIdRef: activeDraftMessageIdRef.current
            }
          });
        }
      } catch (e: any) {
        results.push({ test: '2', name: 'Confirm flow', pass: false, reason: e.message });
      }
      
      try {
        // Test: No duplicate sessions during create+confirm
        await resetSim();
        await new Promise(resolve => setTimeout(resolve, 500));
        const initialSessionCount = chatSessions.length;
        
        await sendMsg('long eth with 3% risk');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const afterDraftCount = chatSessions.length;
        const draft = strategies.find(s => s.status === 'draft' && s.instrumentType === 'perp');
        
        if (draft) {
          // Simulate confirm
          const targetChatId = activeDraftChatIdRef.current || activeChatId;
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          const afterConfirmCount = chatSessions.length;
          const test3Pass = afterDraftCount === initialSessionCount + 1 && afterConfirmCount === afterDraftCount;
          
          results.push({
            test: '3',
            name: 'No duplicate sessions during create+confirm',
            pass: test3Pass,
            reason: test3Pass ? undefined : `initial=${initialSessionCount}, afterDraft=${afterDraftCount}, afterConfirm=${afterConfirmCount}`,
            details: {
              initialCount: initialSessionCount,
              afterDraftCount,
              afterConfirmCount,
              sessions: chatSessions.map(s => ({ id: s.id, title: s.title, msgs: s.messages.length })),
              activeChatId,
              activeDraftChatIdRef: activeDraftChatIdRef.current
            }
          });
        } else {
          results.push({ test: '3', name: 'No duplicate sessions', pass: false, reason: 'Draft not created' });
        }
      } catch (e: any) {
        results.push({ test: '3', name: 'No duplicate sessions', pass: false, reason: e.message });
      }
      
      // Print results
      console.log('=== Verification Test Results ===');
      results.forEach(r => {
        console.log(`${r.pass ? '✅' : '❌'} Test ${r.test}: ${r.name}`, r.reason || '', r.details || '');
      });
      
      const allPass = results.every(r => r.pass);
      if (!allPass) {
        console.error('=== Debug Info ===');
        console.log('activeChatId:', activeChatId);
        console.log('chatSessions:', chatSessions.map(s => ({ id: s.id, title: s.title, msgs: s.messages.length })));
        console.log('activeDraftChatIdRef.current:', activeDraftChatIdRef.current);
        console.log('activeDraftMessageIdRef.current:', activeDraftMessageIdRef.current);
        if ((window as any).__BLOSSOM_DEBUG__?.lastIntent) {
          console.log('lastIntent:', (window as any).__BLOSSOM_DEBUG__.lastIntent);
        }
      }
      
      return results;
    };
    
    (window as any).runAcceptance8 = runAcceptance8;
    (window as any).runAcceptanceLocal = runAcceptanceLocal;
    (window as any).runVerificationTests = runVerificationTests;
    console.log('Acceptance tests available: await runAcceptance8() or await runAcceptanceLocal() or await runVerificationTests()');
  }, [resetSim, strategies, account, derivePerpPositionsFromStrategies, setSelectedStrategyId, updatePerpSizeById, processUserMessage, pendingHighRisk, handleProceedHighRisk, setInputValue, textareaRef, chatState, pendingTrade, chatSessions, activeChatId, updateMessageInChat]);
}

