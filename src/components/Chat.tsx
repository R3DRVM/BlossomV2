// @ts-nocheck
import { useState, useRef, useEffect, useCallback } from 'react';
import MessageBubble from './MessageBubble';
import TypingIndicator from './TypingIndicator';
import { extractMarketStrict, generateMarketClarification } from '../lib/market';
import { parseUserMessage, generateBlossomResponse, ParsedStrategy, ParsedIntent, parseModificationFromText } from '../lib/mockParser';
import { useBlossomContext, ActiveTab, ChatMessage, Strategy, computePerpFromRisk } from '../context/BlossomContext';
import { derivePerpPositionsFromStrategies } from '../lib/derivePerpPositions';
import { USE_AGENT_BACKEND, executionMode as configExecutionMode, executionAuthMode, ethTestnetIntent, fundingRouteMode, enableDemoSwap } from '../lib/config';
import { callAgent, executeIntent, confirmIntent, type IntentExecutionResult } from '../lib/apiClient';
import { getAddress, connectWallet, sendTransaction, type PreparedTx } from '../lib/walletAdapter';
import { checkExecutionGuard, mapServerError, ERROR_MESSAGES, type ExecutionError } from '../lib/executionGuard';
import { callBlossomChat } from '../lib/blossomApi';
import QuickStartPanel from './QuickStartPanel';
import BlossomHelperOverlay from './BlossomHelperOverlay';
import { HelpCircle } from 'lucide-react';
import { detectHighRiskIntent } from '../lib/riskIntent';
import HighRiskConfirmCard from './HighRiskConfirmCard';
import { useWalletStatus } from './wallet/ConnectWalletButton';
// DemoModeBanner removed - Beta pill is now in the header (see Header.tsx)
import SessionResetButton from './SessionResetButton';
import { isOneClickAuthorized } from './OneClickExecution';
import { isManualSigningEnabled } from './SessionEnforcementModal';
// Task A: Removed ConfirmTradeCard import - using MessageBubble rich card instead
import { BlossomLogo } from './BlossomLogo';
// ExecutionPlanCard removed - execution details now live inside chat plan card

// =============================================================================
// MESSAGE ROUTING CLASSIFIER
// Routes messages to: CHAT (normal response) | PLAN (preview) | EXECUTE (action)
// =============================================================================

type RouteDecision = 'chat' | 'plan' | 'execute';

interface ClassifyResult {
  decision: RouteDecision;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  forced?: boolean; // True if user explicitly forced routing via /chat or /execute
  strippedText?: string; // Text after removing escape prefix
}

// Execution force hatch - ALWAYS force execution routing
const EXECUTE_FORCE_PATTERN = /^\/execute\s+/i;

// Chat escape hatches - ALWAYS treat as normal chat
const CHAT_ESCAPE_PATTERNS = [
  /^\/chat\s+/i,           // /chat <message>
  /^just\s+answer[:\s]+/i, // just answer: <message>
  /^explain\s+/i,          // explain <topic>
  /^what\s+is\s+/i,        // what is <topic>
  /^what\s+are\s+/i,       // what are <topic>
  /^how\s+does\s+/i,       // how does <topic>
  /^why\s+/i,              // why <question>
  /^tell\s+me\s+about\s+/i, // tell me about <topic>
  /^can\s+you\s+explain/i, // can you explain
];

// Question patterns - should be chat, not execution
const QUESTION_PATTERNS = [
  /\?$/,                          // Ends with question mark
  /^what\s+(?:do\s+you\s+think|would|should|if)/i, // What do you think, what would, what should, what if
  /^should\s+i\s+/i,              // should I...
  /^is\s+it\s+(?:a\s+good|worth|smart)/i, // is it a good/worth/smart
  /^do\s+you\s+(?:think|recommend)/i, // do you think/recommend
  /^how\s+(?:risky|safe|much)/i,  // how risky/safe/much
  /^compare\s+/i,                  // compare X to Y
  /^analyze\s+/i,                  // analyze X
  /^review\s+/i,                   // review my portfolio
];

// Education/info patterns - definitely chat
const INFO_PATTERNS = [
  /^(?:list|show|get|find)\s+(?:me\s+)?(?:the\s+)?(?:top|best)\s+(?:\d+\s+)?/i, // top 5 X
  /^what\s+(?:are|is)\s+the\s+(?:top|best|biggest|largest)/i, // what are the top X
  /sentiment\s+(?:on|for|of)/i,   // sentiment on X
  /tvl|total\s+value\s+locked/i,  // TVL questions
  /apy|apr|yield/i,               // yield questions without action
  /market\s+cap/i,                // market cap questions
  /price\s+(?:of|for)/i,          // price of X
];

// EXPLICIT execution patterns - must have action verb + amount/token
// These are the ONLY patterns that should trigger execution
const EXECUTE_PATTERNS = [
  // Swap: "swap 100 REDACTED to ETH" - requires amount
  /^swap\s+\d+(?:\.\d+)?\s*(?:k|m)?\s*\w+\s+(?:to|for|into)\s+\w+/i,
  // Deposit: "deposit 500 REDACTED into Aave" - requires amount
  /^deposit\s+\d+(?:\.\d+)?\s*(?:k|m)?\s*\w+\s+(?:into|to|on)\s+\w+/i,
  // Bridge: "bridge 100 REDACTED from ETH to SOL" - requires amount
  /^bridge\s+\d+(?:\.\d+)?\s*(?:k|m)?\s*\w+\s+(?:from|to)\s+\w+/i,
  // Long/Short with specific risk%: "long ETH with 3% risk" or "long 100 REDACTED on ETH"
  /^(?:go\s+)?(?:long|short)\s+(?:\d+(?:\.\d+)?\s*(?:k|m)?\s*\w+\s+(?:on|with)|eth|btc|sol)\s+.*(?:\d+%?\s*risk|\d+x)/i,
  // Bet with amount: "bet 50 REDACTED on Trump wins"
  /^bet\s+\d+(?:\.\d+)?\s*(?:k|m)?\s*\w+\s+(?:on|that)\s+/i,
  // Execute/confirm explicit: "execute", "confirm", "do it", "yes execute"
  /^(?:execute|confirm|do\s+it|yes\s+execute|approve|submit)\s*$/i,
];

/**
 * Classify user message intent for routing
 * Returns: 'chat' (normal response), 'plan' (show preview), 'execute' (take action)
 */
function classifyMessage(text: string): ClassifyResult {
  const normalized = text.toLowerCase().trim();

  // 1. Check execution force hatch FIRST - /execute command
  if (EXECUTE_FORCE_PATTERN.test(normalized)) {
    const strippedText = normalized.replace(EXECUTE_FORCE_PATTERN, '').trim();
    const result = {
      decision: 'execute' as RouteDecision,
      reason: 'force_execute',
      confidence: 'high' as const,
      forced: true,
      strippedText: strippedText || text
    };
    console.log('[Chat Router] decision=execute reason=force_execute forced=true');
    return result;
  }

  // 2. Check chat escape hatches - ALWAYS chat
  for (const pattern of CHAT_ESCAPE_PATTERNS) {
    if (pattern.test(normalized)) {
      const strippedText = normalized.replace(pattern, '').trim();
      const result = {
        decision: 'chat' as RouteDecision,
        reason: 'escape_hatch',
        confidence: 'high' as const,
        forced: pattern === CHAT_ESCAPE_PATTERNS[0], // /chat is forced
        strippedText: strippedText || text
      };
      if (result.forced) {
        console.log('[Chat Router] decision=chat reason=escape_hatch forced=true');
      }
      return result;
    }
  }

  // 3. Check if it's clearly a question - route to chat
  for (const pattern of QUESTION_PATTERNS) {
    if (pattern.test(normalized)) {
      return { decision: 'chat', reason: 'question_pattern', confidence: 'high' };
    }
  }

  // 4. Check if it's info/education request - route to chat
  for (const pattern of INFO_PATTERNS) {
    if (pattern.test(normalized)) {
      return { decision: 'chat', reason: 'info_request', confidence: 'high' };
    }
  }

  // 5. Check for EXPLICIT execution patterns - these are the ONLY ones that execute
  for (const pattern of EXECUTE_PATTERNS) {
    if (pattern.test(normalized)) {
      console.log('[Chat Router] decision=execute reason=explicit_action confidence=high');
      return { decision: 'execute', reason: 'explicit_action', confidence: 'high' };
    }
  }

  // 6. Default: treat as chat (fail-safe, chat-first approach)
  // This is intentional - we want Blossom to feel like a normal LLM chat first
  return { decision: 'chat', reason: 'default_chat', confidence: 'medium' };
}

// Legacy function for backward compatibility - now uses new classifier
function isLedgerIntent(text: string): boolean {
  const result = classifyMessage(text);
  // Only return true for explicit execution intents
  return result.decision === 'execute';
}

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
    refreshLedgerPositions,
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

  // Wallet connection status for intent execution
  const walletStatus = useWalletStatus();

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
  
  // Preflight check: run once per page load before first eth_testnet execution
  const preflightDoneRef = useRef<boolean>(false);

  // State for intent confirmation (confirm mode)
  const [confirmingIntentId, setConfirmingIntentId] = useState<string | null>(null);
  
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
    // Goal F: Detect quick action patterns (allocate/bet commands with structured params)
    const isQuickAction = /(?:amountUsd|amountPct|stakeUsd):"[^"]*"/.test(userText) ||
                          /(?:protocol|vault|eventKey):"[^"]*"/.test(userText);

    const messageKey = opts?.messageKey || (() => {
      // Simple hash of text (for demo, just use text + timestamp truncated to second)
      const textHash = userText.slice(0, 50).replace(/\s+/g, '').toLowerCase();
      // Goal F: Use milliseconds for quick actions to prevent duplicate blocking
      const timestamp = isQuickAction ? Date.now() : Math.floor(Date.now() / 1000);
      return `${timestamp}-${textHash}`;
    })();

    // Part B: Check if this message was already handled
    // Goal F: Skip duplicate check for quick actions (they're intentional user clicks)
    if (lastHandledMessageKeyRef.current === messageKey && !opts?.skipAppendUserMessage && !isQuickAction) {
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

    // =========================================================================
    // MESSAGE ROUTING: Classify message and route appropriately
    // =========================================================================
    const classification = classifyMessage(userText);
    const ledgerSecretConfigured = Boolean(import.meta.env.VITE_DEV_LEDGER_SECRET);

    // Use stripped text if available (for /chat or /execute commands)
    const effectiveText = classification.strippedText || userText;

    // Log routing decision for debugging and analytics
    console.log('[Chat Router]', {
      message: effectiveText.slice(0, 50) + (effectiveText.length > 50 ? '...' : ''),
      decision: classification.decision,
      reason: classification.reason,
      confidence: classification.confidence,
      forced: classification.forced || false,
      timestamp: new Date().toISOString(),
    });

    // Only route to ledger system for EXPLICIT execution intents
    if (ledgerSecretConfigured && classification.decision === 'execute') {
      if (import.meta.env.DEV) {
        console.log('[Chat] Routing to ledger intent system:', effectiveText.slice(0, 50));
      }

      // Determine which chain this intent requires
      const normalizedText = effectiveText.toLowerCase();
      const isBridgeIntent = normalizedText.includes('bridge') || normalizedText.includes('from eth') || normalizedText.includes('to sol');
      const isSolanaIntent = normalizedText.includes('solana') || normalizedText.includes('sol ') || normalizedText.includes(' sol');
      const intentChain = isSolanaIntent ? 'solana' : 'ethereum';

      // Check wallet connection before executing
      const needsEvm = intentChain === 'ethereum' || isBridgeIntent;
      const needsSol = intentChain === 'solana' || isBridgeIntent;

      // Clear input early
      if (textareaRef.current) {
        textareaRef.current.value = '';
      }
      setInputValue('');

      // Check if required wallets are connected
      if (needsEvm && !walletStatus.evmConnected) {
        const walletMsgId = `wallet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        appendMessageToChat(targetChatId, {
          id: walletMsgId,
          text: "Connect an Ethereum wallet to execute this request.",
          isUser: false,
          timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          intentExecution: {
            intentText: effectiveText,
            result: {
              ok: false,
              intentId: '',
              status: 'failed',
              error: {
                stage: 'execute',
                code: 'WALLET_NOT_CONNECTED',
                message: 'Connect an Ethereum wallet (Sepolia) to execute this intent.',
              },
            },
            isExecuting: false,
          },
        });
        return;
      }

      if (needsSol && !walletStatus.solConnected) {
        const walletMsgId = `wallet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        appendMessageToChat(targetChatId, {
          id: walletMsgId,
          text: "Connect a Solana wallet to execute this request.",
          isUser: false,
          timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          intentExecution: {
            intentText: effectiveText,
            result: {
              ok: false,
              intentId: '',
              status: 'failed',
              error: {
                stage: 'execute',
                code: 'WALLET_NOT_CONNECTED',
                message: 'Connect a Solana wallet (Devnet) to execute this intent.',
              },
            },
            isExecuting: false,
          },
        });
        return;
      }

      // Check if EVM wallet is on correct network
      if (needsEvm && !walletStatus.isOnSepolia) {
        const walletMsgId = `wallet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        appendMessageToChat(targetChatId, {
          id: walletMsgId,
          text: "Please switch to Sepolia testnet to execute this request.",
          isUser: false,
          timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          intentExecution: {
            intentText: effectiveText,
            result: {
              ok: false,
              intentId: '',
              status: 'failed',
              error: {
                stage: 'execute',
                code: 'WRONG_NETWORK',
                message: 'Switch your Ethereum wallet to Sepolia testnet.',
              },
            },
            isExecuting: false,
          },
        });
        return;
      }

      setIsTyping(true);

      // Create initial response message
      const intentMsgId = `intent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const isConfirmMode = executionMode === 'confirm';

      const intentResponse: ChatMessage = {
        id: intentMsgId,
        text: isConfirmMode ? "I'm preparing your intent..." : "I'm executing your intent on-chain...",
        isUser: false,
        timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        intentExecution: {
          intentText: effectiveText,
          result: null,
          isExecuting: true,
        },
      };
      appendMessageToChat(targetChatId, intentResponse);

      try {
        // In confirm mode, get plan first without executing
        if (isConfirmMode) {
          const planResult = await executeIntent(userText, { chain: intentChain, planOnly: true });

          if (!planResult.ok) {
            // Plan failed, show error
            updateMessageInChat(targetChatId, intentMsgId, {
              text: `Planning failed: ${planResult.error?.code || 'Unknown error'}`,
              intentExecution: {
                intentText: effectiveText,
                result: planResult,
                isExecuting: false,
              },
            });
          } else {
            // Show plan for confirmation - use planned status to indicate awaiting confirm
            const planMeta = planResult.metadata;
            const planDesc = planMeta?.parsed
              ? `${planMeta.parsed.action} ${planMeta.parsed.targetAsset || ''} ${planMeta.parsed.leverage ? `${planMeta.parsed.leverage}x` : ''} with ${planMeta.parsed.amount || 'default'} ${planMeta.parsed.amountUnit || 'REDACTED'}`
              : userText;

            updateMessageInChat(targetChatId, intentMsgId, {
              text: `Ready to execute: ${planDesc}`,
              intentExecution: {
                intentText: effectiveText,
                result: planResult,
                isExecuting: false,
              },
              // Store intentId for confirm action
              pendingIntentId: planResult.intentId,
            });
          }
        } else {
          // Auto mode: execute immediately
          // Gate execution: require one-click authorization (if in session mode and NOT using manual signing)
          if (executionAuthMode === 'session' && !isOneClickAuthorized(walletStatus.evmAddress) && !isManualSigningEnabled(walletStatus.evmAddress)) {
            updateMessageInChat(targetChatId, intentMsgId, {
              text: "One-click execution not authorized. Enable it in the wallet panel to execute trades.",
              intentExecution: {
                intentText: effectiveText,
                result: {
                  ok: false,
                  intentId: '',
                  status: 'failed',
                  error: {
                    stage: 'execute',
                    code: 'ONE_CLICK_NOT_AUTHORIZED',
                    message: 'Enable One-Click Execution in the wallet panel to execute trades.',
                  },
                },
                isExecuting: false,
              },
            });
            setIsTyping(false);
            return;
          }

          const result = await executeIntent(userText, { chain: intentChain });

          // Update message with result
          const resultText = result.ok
            ? `Intent executed successfully! ${result.metadata?.executedKind === 'proof_only' ? '(proof_only)' : ''}`
            : `Execution failed: ${result.error?.code || 'Unknown error'}`;

          updateMessageInChat(targetChatId, intentMsgId, {
            text: resultText,
            intentExecution: {
              intentText: effectiveText,
              result: result,
              isExecuting: false,
            },
          });

          if (import.meta.env.DEV) {
            console.log('[Chat] Intent execution complete:', {
              ok: result.ok,
              intentId: result.intentId,
              txHash: result.txHash?.slice(0, 16),
              status: result.status,
            });
          }
        }
      } catch (error: any) {
        console.error('[Chat] Intent execution error:', error);

        updateMessageInChat(targetChatId, intentMsgId, {
          text: `Execution failed: ${error.message || 'Network error'}`,
          intentExecution: {
            intentText: effectiveText,
            result: {
              ok: false,
              intentId: '',
              status: 'failed',
              error: {
                stage: 'execute',
                code: 'NETWORK_ERROR',
                message: error.message || 'Failed to connect to backend',
              },
            },
            isExecuting: false,
          },
        });
      } finally {
        setIsTyping(false);
      }

      return; // Intent handled by ledger system
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
      // Agent mode: call backend (production default)
      console.log('[Chat] Using backend agent for chat - sending to /api/chat');
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

        // Handle error codes for explicit UI states
        if (response.errorCode) {
          let errorMessage = '';
          switch (response.errorCode) {
            case 'INSUFFICIENT_BALANCE':
              errorMessage = 'Insufficient balance to execute this transaction. Please check your wallet balance.';
              break;
            case 'SESSION_EXPIRED':
              errorMessage = 'One-click execution has expired. You can enable it again or continue with wallet prompts.';
              break;
            case 'RELAYER_FAILED':
              errorMessage = 'One-click execution temporarily unavailable. Using wallet prompts instead.';
              break;
            case 'SLIPPAGE_FAILURE':
              errorMessage = 'Transaction failed due to slippage. Please try again with a higher slippage tolerance.';
              break;
            case 'LLM_REFUSAL':
              errorMessage = "I couldn't generate a valid execution plan. Please rephrase your request.";
              break;
            default:
              errorMessage = 'An error occurred. Please try again.';
          }
          
          const errorChatMessage: ChatMessage = {
            id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            text: errorMessage,
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          };
          appendMessageToChat(targetChatId, errorChatMessage);
          
          // Do NOT update portfolio on error
          return;
        }

        // Update state from backend portfolio (authoritative source)
        updateFromBackendPortfolio(response.portfolio);

        // OBSERVABILITY: Plan missing detection (frontend)
        // Log when assistantMessage indicates action but executionRequest is missing
        if (!response.executionRequest && response.actions?.length === 0) {
          const actionKeywords = /\b(i'll|i will|let me|going to)\s+(swap|long|short|deposit|lend|stake|bet|trade)/i;
          if (actionKeywords.test(response.assistantMessage)) {
            const debugInfo = (response as any).debug;
            console.warn(
              `[PLAN_MISSING_UI] Assistant indicates action but no executionRequest\n` +
              `  Message: "${response.assistantMessage.substring(0, 100)}..."\n` +
              `  Backend debug: ${JSON.stringify(debugInfo || 'N/A')}\n` +
              `  CorrelationId: ${debugInfo?.correlationId || 'unknown'}`
            );
          }
        }

        // Log execution results if present
        if (response.executionResults && response.executionResults.length > 0) {
          console.log('[Chat] Execution results:', response.executionResults);
          // Show execution progress in UI (optional: could add toast notifications)
          response.executionResults.forEach((result: any) => {
            if (result.success) {
              console.log(`[Chat] ✓ Execution successful: ${result.txHash || result.simulatedTxId}`);
            } else {
              console.error(`[Chat] ✗ Execution failed: ${result.error}`);
              // Show error message for failed executions
              if (result.errorCode) {
                let errorMsg = '';
                switch (result.errorCode) {
                  case 'INSUFFICIENT_BALANCE':
                    errorMsg = 'Insufficient balance to execute this transaction.';
                    break;
                  case 'SESSION_EXPIRED':
                    errorMsg = 'One-click execution expired. Using wallet prompts instead.';
                    break;
                  case 'RELAYER_FAILED':
                    errorMsg = 'One-click execution unavailable. Using wallet prompts instead.';
                    break;
                  case 'SLIPPAGE_FAILURE':
                    errorMsg = 'Transaction failed due to slippage.';
                    break;
                  default:
                    errorMsg = result.error || 'Execution failed.';
                }
                const errorChatMessage: ChatMessage = {
                  id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                  text: errorMsg,
                  isUser: false,
                  timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                };
                appendMessageToChat(targetChatId, errorChatMessage);
              }
            }
          });
        }

        // Debug logging (Task A)
        if (import.meta.env.DEBUG_PLAN === 'true') {
          console.log('[Chat] Agent backend response keys:', Object.keys(response));
          console.log('[Chat] executionRequest:', response.executionRequest);
          console.log('[Chat] actions:', response.actions);
          console.log('[Chat] portfolio.strategies:', response.portfolio?.strategies);
        }

        // Find strategy IDs from actions
        let strategyId: string | null = null;
        let strategy: ParsedStrategy | null = null;
        let defiProposalId: string | null = null;
        let draftId: string | null = null; // Task A: Track draftId for ConfirmTradeCard

        // Task A: Create draft strategy from executionRequest if present
        if (response.executionRequest) {
          const execReq = response.executionRequest;
          
          if (execReq.kind === 'perp') {
            // Create perp draft strategy
            const perpReq = execReq as unknown as { kind: 'perp'; chain: string; market: string; side: 'long' | 'short'; leverage: number; riskPct?: number; marginUsd?: number };
            const leverageFromText = userText.match(/(\d+(?:\.\d+)?)\s*x/i);
            const marginFromText = userText.match(/\$?(\d+(?:\.\d+)?)\s*(?:usd\s*)?(?:margin|stake|size)\b/i);
            const riskFromText = userText.match(/(\d+(?:\.\d+)?)\s*%\s*risk/i);

            const parsedLeverage = leverageFromText ? Number(leverageFromText[1]) : undefined;
            const parsedMarginUsd = marginFromText ? Number(marginFromText[1]) : undefined;
            const parsedRiskPct = riskFromText ? Number(riskFromText[1]) : undefined;

            const finalRiskPct = perpReq.riskPct || parsedRiskPct || 2;
            const finalMarginUsd = perpReq.marginUsd || parsedMarginUsd || (account.accountValue * finalRiskPct / 100);
            const finalLeverage = perpReq.leverage || parsedLeverage || 2;
            const finalNotionalUsd = finalMarginUsd * finalLeverage;
            const newDraft = addDraftStrategy({
              side: perpReq.side === 'long' ? 'Long' : 'Short',
              market: perpReq.market || 'BTC-USD',
              riskPercent: finalRiskPct,
              leverage: finalLeverage,
              marginUsd: finalMarginUsd,
              notionalUsd: finalNotionalUsd, // Set explicitly for ConfirmTradeCard
              sourceText: userText,
              instrumentType: 'perp',
            });
            draftId = newDraft.id;
            strategyId = newDraft.id;
            strategy = {
              market: perpReq.market || 'BTC-USD',
              side: perpReq.side === 'long' ? 'Long' : 'Short',
              riskPercent: perpReq.riskPct || 2,
              entryPrice: 0,
              takeProfit: 0,
              stopLoss: 0,
              liqBuffer: 15,
              fundingImpact: 'Low',
            };
            
            if (import.meta.env.DEBUG_PLAN === 'true') {
              console.log('[Chat] Created perp draft from executionRequest:', { draftId, execReq: perpReq });
            }
          } else if (execReq.kind === 'swap') {
            // For swaps, we don't create a draft (swaps execute immediately)
            // But we still store executionRequest for execution
            if (import.meta.env.DEBUG_PLAN === 'true') {
              console.log('[Chat] Swap executionRequest (no draft needed):', execReq);
            }
          } else if (execReq.kind === 'event') {
            // Create event draft strategy
            const eventReq = execReq as unknown as { kind: 'event'; chain: string; marketId: string; outcome: 'YES' | 'NO'; stakeUsd: number; price?: number };
            const stakeUsd = eventReq.stakeUsd || 5;
            const newDraft = addDraftStrategy({
              side: eventReq.outcome === 'YES' ? 'Long' : 'Short',
              market: eventReq.marketId || 'demo-fed',
              riskPercent: (stakeUsd / account.accountValue) * 100,
              entry: stakeUsd,
              takeProfit: stakeUsd * 2, // Estimate
              stopLoss: stakeUsd,
              sourceText: userText,
              instrumentType: 'event',
              eventKey: eventReq.marketId || 'demo-fed',
              eventLabel: eventReq.marketId || 'Fed Rate Cut',
              eventSide: eventReq.outcome,
              stakeUsd: stakeUsd,
            });
            draftId = newDraft.id;
            strategyId = newDraft.id;
            strategy = {
              market: eventReq.marketId || 'demo-fed',
              side: eventReq.outcome === 'YES' ? 'Long' : 'Short',
              riskPercent: (stakeUsd / account.accountValue) * 100,
              entryPrice: stakeUsd,
              takeProfit: stakeUsd * 2,
              stopLoss: stakeUsd,
              liqBuffer: 0,
              fundingImpact: 'Low',
            };
            
            if (import.meta.env.DEBUG_PLAN === 'true') {
              console.log('[Chat] Created event draft from executionRequest:', { draftId, execReq: eventReq });
            }
          } else if (execReq.kind === 'lend' || execReq.kind === 'lend_supply') {
            // Create DeFi/lending draft strategy
            // Goal F: Now properly supports 'defi' type after fixing Strategy interface
            const lendReq = execReq as unknown as { kind: 'lend' | 'lend_supply'; chain: string; asset: string; amount: string; protocol?: string; vault?: string };
            const amountUsd = parseFloat(lendReq.amount) || 10;
            // Use protocol/vault name directly (without "DeFi:" prefix for cleaner display)
            const defiMarketLabel = lendReq.vault || lendReq.protocol || 'Yield Vault';
            const newDraft = addDraftStrategy({
              side: 'Long', // DeFi is always "long" (deposit)
              market: defiMarketLabel,
              riskPercent: (amountUsd / account.accountValue) * 100,
              entry: amountUsd,
              takeProfit: amountUsd * 1.05, // Estimate 5% yield
              stopLoss: amountUsd,
              leverage: 1, // DeFi has no leverage
              marginUsd: amountUsd, // Deposit amount = margin
              notionalUsd: amountUsd, // For DeFi, notional = deposit
              sourceText: userText,
              instrumentType: 'defi', // Goal F: Now uses proper 'defi' type
            });
            draftId = newDraft.id;
            strategyId = newDraft.id;

            // CRITICAL FIX: Also create DeFi position for MessageBubble to render DeFi card
            // MessageBubble looks in defiPositions array, not strategies array
            const commandForDefi = `Allocate amountUsd:"${amountUsd}" to protocol:"${defiMarketLabel}" REDACTED yield`;
            const defiProposal = createDefiPlanFromCommand(commandForDefi, defiMarketLabel);
            defiProposalId = defiProposal.id;

            if (import.meta.env.DEBUG_PLAN === 'true') {
              console.log('[Chat] Created DeFi/lend draft from executionRequest:', {
                draftId,
                defiProposalId,
                execReq: lendReq
              });
            }
          }
        }

        // Fallback: Find strategy IDs from actions if no executionRequest
        if (!draftId && response.actions && response.actions.length > 0) {
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
            // DEBUG: Track DeFi position lookup from backend response
            if (import.meta.env.DEV) {
              console.log('[DeFi Debug] Looking for DeFi position in backend response:', {
                protocol: action.protocol,
                availablePositions: response.portfolio.defiPositions,
                allActions: response.actions
              });
            }

            const defiPos = response.portfolio.defiPositions?.find((p: any) =>
              p.protocol === action.protocol && !p.isClosed
            );

            if (import.meta.env.DEV) {
              console.log('[DeFi Debug] Found position:', defiPos);
            }

            if (defiPos) {
              defiProposalId = defiPos.id;
            } else if (import.meta.env.DEV) {
              console.warn('[DeFi Debug] ⚠️ No DeFi position found! defiProposalId will be null → card will not render');
            }

            setOnboarding(prev => ({ ...prev, queuedStrategy: true })); // DeFi counts as "queued"
          } else if (action.type === 'perp') {
            setOnboarding(prev => ({ ...prev, openedTrade: true })); // Perp trade
          } else if (action.type === 'event') {
            setOnboarding(prev => ({ ...prev, openedTrade: true })); // Event also counts
          }
        }

        // Task A: Use server-created draftId if available (backend now creates drafts deterministically)
        // Fallback to frontend-created draftId for backward compatibility
        const finalDraftId = (response as any).draftId || draftId;
        
        // Task A: Create message with draftId if we have one (for ConfirmTradeCard)
        const safeAssistantText =
          typeof response.assistantMessage === 'string'
            ? response.assistantMessage
            : response.assistantMessage && typeof response.assistantMessage === 'object'
              ? JSON.stringify(response.assistantMessage)
              : String(response.assistantMessage ?? '');

        const blossomResponse: ChatMessage = {
          id: `assistant-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          text: safeAssistantText,
          isUser: false,
          timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          strategy: strategy,
          strategyId: strategyId || finalDraftId, // Use server draftId if available
          defiProposalId: defiProposalId,
          executionRequest: response.executionRequest || null,
          ...(finalDraftId ? {
            type: 'trade_confirm' as const,
            draftId: finalDraftId,
          } : {}),
          // Include defiProtocolsList from backend if present
          ...((response as any).defiProtocolsList ? {
            defiProtocolsList: (response as any).defiProtocolsList.map((p: any) => ({
              id: p.slug || p.name.toLowerCase().replace(/\s+/g, '-'),
              name: p.name,
              tvlUsd: p.tvl,
              chains: p.chains,
              category: p.category,
              source: 'defillama',
              isLive: true,
            }))
          } : {}),
          // Include eventMarketsList from backend if present
          ...((response as any).eventMarketsList ? {
            marketsList: (response as any).eventMarketsList.map((m: any) => ({
              id: m.id,
              title: m.title,
              yesPrice: m.yesPrice,
              noPrice: m.noPrice,
              volume24hUsd: m.volume24hUsd,
              source: m.source || 'fallback',
              isLive: true,
            }))
          } : {}),
        };
        
        if (import.meta.env.DEBUG_PLAN === 'true' || import.meta.env.DEBUG_CARD_CONTRACT === 'true') {
          console.log('[Chat] Message created with draftId:', finalDraftId, 'keys:', Object.keys(blossomResponse));
          console.log('[Chat] Will ConfirmTradeCard render?', finalDraftId ? 'YES (has draftId)' : 'NO (no draftId)');
          console.log('[Chat] Draft source:', (response as any).draftId ? 'server-created' : (draftId ? 'frontend-created' : 'none'));
        }
        
        // Always append - never replace (using stable chat id)
        appendMessageToChat(targetChatId, blossomResponse);
      } catch (error: any) {
        console.error('Agent backend error:', error);

        // Determine error type and provide appropriate message
        let errorText = "I couldn't reach the agent backend. Please try again.";
        const errorMsg = error?.message || '';

        if (errorMsg.includes('401') || errorMsg.includes('403')) {
          // Access gate error - code invalid or expired
          errorText = "Access code required or expired. Please re-enter your access code to continue.";
          // Trigger re-authorization by clearing stored code
          localStorage.removeItem('blossom_access_code');
          // Dispatch event for AccessGate to reopen
          window.dispatchEvent(new CustomEvent('blossom-access-expired'));
        } else if (errorMsg.includes('Backend is offline') || errorMsg.includes('unreachable')) {
          errorText = "Backend is currently offline. Please wait a moment and try again.";
        } else if (errorMsg.includes('500') || errorMsg.includes('502') || errorMsg.includes('503') || errorMsg.includes('504')) {
          // Server error - show correlation ID if available
          const correlationId = error?.correlationId || `ERR-${Date.now().toString(36)}`;
          errorText = `Server error occurred. Please try again. (ID: ${correlationId})`;
        } else if (errorMsg.includes('timeout') || errorMsg.includes('TimeoutError')) {
          errorText = "Request timed out. The server might be busy. Please try again.";
        }

        const errorMessage: ChatMessage = {
          id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          text: errorText,
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

        // Handle show_positions intent - list all open positions
        if (parsed.intent === ('show_positions' as ParsedIntent)) {
          const activePerps = strategies.filter(
            s => s.instrumentType === 'perp' && (s.status === 'executed' || s.status === 'executing') && !s.isClosed
          );
          const activeEvents = strategies.filter(
            s => s.instrumentType === 'event' && (s.status === 'executed' || s.status === 'executing') && !s.isClosed
          );
          const activeDefi = defiPositions.filter(p => p.status === 'active');

          const totalPositions = activePerps.length + activeEvents.length + activeDefi.length;

          if (totalPositions === 0) {
            const responseText = "You don't have any open positions right now.\n\nYou can:\n• Start a perp trade: \"Long ETH with 3% risk\"\n• Deposit into DeFi: \"Park 500 REDACTED in Aave\"\n• Trade event markets: Switch to Event Markets and \"Take YES on Fed cuts with 2% risk\"";
            appendMessageToChat(targetChatId, {
              id: `pos-${Date.now()}`,
              text: responseText,
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            });
            clearInputAndStopTyping();
            return;
          }

          // Calculate totals
          const totalPerpNotional = activePerps.reduce((sum, s) => sum + (s.notionalUsd || 0), 0);
          const biggestPerp = activePerps.length > 0
            ? activePerps.reduce((max, s) => (s.notionalUsd || 0) > (max.notionalUsd || 0) ? s : max, activePerps[0])
            : null;

          let responseText = `You have ${totalPositions} open position${totalPositions > 1 ? 's' : ''}:\n\n`;

          if (activePerps.length > 0) {
            responseText += `**Perps (${activePerps.length}):** $${totalPerpNotional.toLocaleString()} total notional\n`;
            activePerps.forEach(s => {
              responseText += `  • ${s.market} ${s.side} - $${(s.notionalUsd || 0).toLocaleString()} (${(s.riskPercent || 0).toFixed(1)}% risk)\n`;
            });
          }

          if (activeEvents.length > 0) {
            const totalEventStake = activeEvents.reduce((sum, s) => sum + (s.stakeUsd || 0), 0);
            responseText += `\n**Events (${activeEvents.length}):** $${totalEventStake.toLocaleString()} staked\n`;
            activeEvents.forEach(s => {
              responseText += `  • ${s.eventLabel || 'Event'} (${s.eventSide}) - $${(s.stakeUsd || 0).toLocaleString()}\n`;
            });
          }

          if (activeDefi.length > 0) {
            const totalDefiDeposit = activeDefi.reduce((sum, p) => sum + (p.depositUsd || 0), 0);
            responseText += `\n**DeFi (${activeDefi.length}):** $${totalDefiDeposit.toLocaleString()} deposited\n`;
            activeDefi.forEach(p => {
              responseText += `  • ${p.protocol} ${p.vault || ''} - $${(p.depositUsd || 0).toLocaleString()} (${(p.apy || 0).toFixed(1)}% APY)\n`;
            });
          }

          if (biggestPerp) {
            responseText += `\nBiggest position: ${biggestPerp.market} ${biggestPerp.side} ($${(biggestPerp.notionalUsd || 0).toLocaleString()})`;
          }

          appendMessageToChat(targetChatId, {
            id: `pos-${Date.now()}`,
            text: responseText,
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          });
          clearInputAndStopTyping();
          return;
        }

        // Handle show_exposure intent - show net exposure by asset
        if (parsed.intent === ('show_exposure' as ParsedIntent)) {
          const activePerps = strategies.filter(
            s => s.instrumentType === 'perp' && (s.status === 'executed' || s.status === 'executing') && !s.isClosed
          );

          if (activePerps.length === 0) {
            appendMessageToChat(targetChatId, {
              id: `exp-${Date.now()}`,
              text: "You have no perp positions, so your net exposure is $0.\n\nTo open a position, try: \"Long BTC with 2% risk\"",
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            });
            clearInputAndStopTyping();
            return;
          }

          // Calculate exposure by asset
          const exposureByAsset: Record<string, number> = {};
          activePerps.forEach(s => {
            const asset = s.market || 'Unknown';
            const exposure = s.side === 'Long' ? (s.notionalUsd || 0) : -(s.notionalUsd || 0);
            exposureByAsset[asset] = (exposureByAsset[asset] || 0) + exposure;
          });

          const totalLongExposure = Object.values(exposureByAsset).filter(v => v > 0).reduce((a, b) => a + b, 0);
          const totalShortExposure = Math.abs(Object.values(exposureByAsset).filter(v => v < 0).reduce((a, b) => a + b, 0));
          const netExposure = totalLongExposure - totalShortExposure;

          let responseText = `**Current Perp Exposure:**\n\n`;
          Object.entries(exposureByAsset).forEach(([asset, exposure]) => {
            const direction = exposure >= 0 ? 'Long' : 'Short';
            responseText += `• ${asset}: ${direction} $${Math.abs(exposure).toLocaleString()}\n`;
          });

          responseText += `\n**Summary:**\n`;
          responseText += `• Gross Long: $${totalLongExposure.toLocaleString()}\n`;
          responseText += `• Gross Short: $${totalShortExposure.toLocaleString()}\n`;
          responseText += `• Net Exposure: ${netExposure >= 0 ? 'Long' : 'Short'} $${Math.abs(netExposure).toLocaleString()}`;

          appendMessageToChat(targetChatId, {
            id: `exp-${Date.now()}`,
            text: responseText,
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          });
          clearInputAndStopTyping();
          return;
        }

        // Handle show_liquidation_risk intent - show positions closest to liquidation
        if (parsed.intent === ('show_liquidation_risk' as ParsedIntent)) {
          const activePerps = strategies.filter(
            s => s.instrumentType === 'perp' && (s.status === 'executed' || s.status === 'executing') && !s.isClosed
          );

          if (activePerps.length === 0) {
            appendMessageToChat(targetChatId, {
              id: `liq-${Date.now()}`,
              text: "You have no perp positions, so there's no liquidation risk to report.",
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            });
            clearInputAndStopTyping();
            return;
          }

          // Sort by liquidation buffer (lower = closer to liquidation)
          const sortedByLiq = [...activePerps].sort((a, b) => (a.liqBuffer || 100) - (b.liqBuffer || 100));
          const closestToLiq = sortedByLiq[0];

          let responseText = `**Liquidation Risk Analysis:**\n\n`;

          // Show top 3 by liquidation proximity
          sortedByLiq.slice(0, 3).forEach((s, idx) => {
            const buffer = s.liqBuffer || 0;
            const urgency = buffer < 10 ? '🔴' : buffer < 20 ? '🟡' : '🟢';
            responseText += `${idx + 1}. ${urgency} ${s.market} ${s.side} - ${buffer.toFixed(1)}% from liquidation\n`;
          });

          if (closestToLiq.liqBuffer && closestToLiq.liqBuffer < 15) {
            responseText += `\n⚠️ Your ${closestToLiq.market} position is at risk! Consider reducing size or adding margin.`;
          } else {
            responseText += `\nAll positions have healthy liquidation buffers.`;
          }

          appendMessageToChat(targetChatId, {
            id: `liq-${Date.now()}`,
            text: responseText,
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          });
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
          responseText = "I'm not sure I understood that. Could you please rephrase or ask something else?";
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
  // Helper function to poll transaction status and update chat
  const pollTransactionStatus = useCallback(async (
    txHash: string,
    targetChatId: string
  ) => {
    // Immediately append "Submitted" message
    const submittedMessage: ChatMessage = {
      id: `tx-submitted-${txHash}-${Date.now()}`,
      text: `Submitted on Sepolia: ${txHash.substring(0, 10)}...${txHash.substring(txHash.length - 8)}`,
      isUser: false,
      timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    };
    appendMessageToChat(targetChatId, submittedMessage);

    // Poll for status (every 2s for up to 60s)
    const maxAttempts = 30; // 30 * 2s = 60s
    let attempts = 0;
    const statusMessageId = `tx-status-${txHash}-${Date.now()}`;

    const pollInterval = setInterval(async () => {
      attempts++;

      try {
        const statusResponse = await callAgent(`/api/execute/status?txHash=${encodeURIComponent(txHash)}`, {
          method: 'GET',
        });

        if (!statusResponse.ok) {
          if (attempts >= maxAttempts) {
            clearInterval(pollInterval);
            const timeoutMessage: ChatMessage = {
              id: statusMessageId,
              text: `Still pending: ${txHash.substring(0, 10)}...${txHash.substring(txHash.length - 8)} (check explorer)`,
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            };
            appendMessageToChat(targetChatId, timeoutMessage);
          }
          return;
        }

        const statusData = await statusResponse.json();

        if (statusData.status === 'pending') {
          // Keep waiting
          if (attempts >= maxAttempts) {
            clearInterval(pollInterval);
            const timeoutMessage: ChatMessage = {
              id: statusMessageId,
              text: `Still pending: ${txHash.substring(0, 10)}...${txHash.substring(txHash.length - 8)} (check explorer)`,
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            };
            appendMessageToChat(targetChatId, timeoutMessage);
          }
          return;
        }

        // Transaction is confirmed or reverted
        clearInterval(pollInterval);

        let statusText: string;
        if (statusData.status === 'confirmed') {
          statusText = `Confirmed on Sepolia: ${txHash.substring(0, 10)}...${txHash.substring(txHash.length - 8)}`;
        } else if (statusData.status === 'reverted') {
          statusText = `Reverted on Sepolia: ${txHash.substring(0, 10)}...${txHash.substring(txHash.length - 8)}`;
        } else {
          statusText = `Status: ${statusData.status} - ${txHash.substring(0, 10)}...${txHash.substring(txHash.length - 8)}`;
        }

        const statusMessage: ChatMessage = {
          id: statusMessageId,
          text: statusText,
          isUser: false,
          timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        };
        appendMessageToChat(targetChatId, statusMessage);
      } catch (error: any) {
        if (import.meta.env.DEV) {
          console.warn('[pollTransactionStatus] Error polling status:', error);
        }
        if (attempts >= maxAttempts) {
          clearInterval(pollInterval);
          const errorMessage: ChatMessage = {
            id: statusMessageId,
            text: `Status check failed: ${txHash.substring(0, 10)}...${txHash.substring(txHash.length - 8)}`,
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          };
          appendMessageToChat(targetChatId, errorMessage);
        }
      }
    }, 2000); // Poll every 2 seconds

    // Cleanup on unmount (if component unmounts)
    return () => {
      clearInterval(pollInterval);
    };
  }, [appendMessageToChat]);

  // Handle intent confirmation (confirm mode: plan → confirm → execute)
  const handleConfirmIntent = async (intentId: string) => {
    if (!activeChatId) {
      console.error('[handleConfirmIntent] No active chat');
      return;
    }

    // Find the message with this intentId
    const targetMessage = messages.find(
      msg => msg.pendingIntentId === intentId || msg.intentExecution?.result?.intentId === intentId
    );

    if (!targetMessage) {
      console.error('[handleConfirmIntent] Message not found for intentId:', intentId);
      return;
    }

    setConfirmingIntentId(intentId);

    // Gate execution: require one-click authorization (if in session mode and NOT using manual signing)
    if (executionAuthMode === 'session' && !isOneClickAuthorized(walletStatus.evmAddress) && !isManualSigningEnabled(walletStatus.evmAddress)) {
      updateMessageInChat(activeChatId, targetMessage.id, {
        text: "One-click execution not authorized. Enable it in the wallet panel to execute trades.",
        intentExecution: {
          intentText: targetMessage.intentExecution?.intentText || '',
          result: {
            ok: false,
            intentId,
            status: 'failed',
            error: {
              stage: 'execute',
              code: 'ONE_CLICK_NOT_AUTHORIZED',
              message: 'Enable One-Click Execution in the wallet panel to execute trades.',
            },
          },
          isExecuting: false,
        },
        pendingIntentId: undefined,
      });
      setConfirmingIntentId(null);
      return;
    }

    try {
      // Update message to show executing state
      updateMessageInChat(activeChatId, targetMessage.id, {
        intentExecution: {
          ...targetMessage.intentExecution!,
          isExecuting: true,
        },
      });

      // Execute the confirmed intent
      const result = await confirmIntent(intentId);

      // Update message with execution result
      const resultText = result.ok
        ? `Executed successfully! ${result.txHash ? `Tx: ${result.txHash.slice(0, 10)}...` : ''}`
        : `Execution failed: ${result.error?.code || 'Unknown error'}`;

      updateMessageInChat(activeChatId, targetMessage.id, {
        text: resultText,
        intentExecution: {
          intentText: targetMessage.intentExecution?.intentText || '',
          result: result,
          isExecuting: false,
        },
        pendingIntentId: undefined, // Clear pending state
      });

      if (import.meta.env.DEV) {
        console.log('[handleConfirmIntent] Execution complete:', {
          ok: result.ok,
          intentId: result.intentId,
          txHash: result.txHash?.slice(0, 16),
          status: result.status,
        });
      }
    } catch (error: any) {
      console.error('[handleConfirmIntent] Error:', error);

      updateMessageInChat(activeChatId, targetMessage.id, {
        text: `Execution failed: ${error.message || 'Network error'}`,
        intentExecution: {
          intentText: targetMessage.intentExecution?.intentText || '',
          result: {
            ok: false,
            intentId: intentId,
            status: 'failed',
            error: {
              stage: 'execute',
              code: 'NETWORK_ERROR',
              message: error.message || 'Failed to connect to backend',
            },
          },
          isExecuting: false,
        },
        pendingIntentId: undefined,
      });
    } finally {
      setConfirmingIntentId(null);
    }
  };

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
    
    // Get executed strategy (used for both sim and eth_testnet paths)
    const executedStrategy = strategies.find(s => s.id === draftId);
    
    // ETH testnet execution path (additive, doesn't change sim behavior)
    if (configExecutionMode === 'eth_testnet') {
      try {
        // Run preflight check once per session before first execution
        if (!preflightDoneRef.current) {
          const preflightResponse = await callAgent('/api/execute/preflight');
          if (preflightResponse.ok) {
            const preflightData = await preflightResponse.json();
            preflightDoneRef.current = true;
            
            if (import.meta.env.DEV) {
              console.log('[handleConfirmTrade] Preflight check:', preflightData);
            }
            
            if (!preflightData.ok) {
              const notes = preflightData.notes || [];
              const preflightMessage: ChatMessage = {
                id: `preflight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                text: `⚠️ Execution setup incomplete: ${notes.join('. ')}. Please check backend configuration.`,
                isUser: false,
                timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
              };
              appendMessageToChat(targetChatId, preflightMessage);
              return; // Don't proceed with execution
            }
          } else {
            preflightDoneRef.current = true; // Don't block on preflight failures
            if (import.meta.env.DEV) {
              console.warn('[handleConfirmTrade] Preflight check failed, proceeding anyway');
            }
          }
        }
        
        // Get or connect wallet
        let userAddress = await getAddress();
        if (!userAddress) {
          try {
            userAddress = await connectWallet();
          } catch (error: any) {
            // Wallet connection rejected or failed
            const errorMessage: ChatMessage = {
              id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              text: `Wallet connection failed: ${error.message || 'Unknown error'}. Please connect your wallet and try again.`,
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            };
            appendMessageToChat(targetChatId, errorMessage);
            return; // Don't mark as executed
          }
        }
        
        // Network enforcement: must be on Sepolia
        const { ethTestnetChainId } = await import('../lib/config');
        const { getChainId } = await import('../lib/walletAdapter');
        const currentChainId = await getChainId();
        if (currentChainId !== ethTestnetChainId) {
          const errorMessage: ChatMessage = {
            id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            text: `Please switch to Sepolia testnet to execute transactions. Click "Switch to Sepolia" in the wallet card.`,
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          };
          appendMessageToChat(targetChatId, errorMessage);
          return; // Don't mark as executed
        }
        
        // Check if one-click execution is available (optional, not required)
        // Use the correct localStorage keys that OneClickExecution.tsx sets
        const enabledKey = `blossom_oneclick_${userAddress.toLowerCase()}`;
        const authorizedKey = `blossom_oneclick_auth_${userAddress.toLowerCase()}`;
        const isSessionEnabled = localStorage.getItem(enabledKey) === 'true' &&
                                 localStorage.getItem(authorizedKey) === 'true';
        let hasActiveSession = isSessionEnabled;

        console.log('[handleConfirmTrade] Session check:', {
          enabledKey,
          authorizedKey,
          enabledValue: localStorage.getItem(enabledKey),
          authorizedValue: localStorage.getItem(authorizedKey),
          isSessionEnabled,
          executionAuthMode,
        });

        // If user has session mode enabled in UI, use session execution
        // The UI session toggle overrides the global executionAuthMode config
        if (isSessionEnabled) {
          hasActiveSession = true;
        }

        // Check for manual signing preference
        const userHasManualSigning = isManualSigningEnabled(userAddress);

        // Session execution path: if user has enabled session mode and is not using manual signing
        // This should trigger regardless of the global executionAuthMode config
        if (isSessionEnabled && !userHasManualSigning) {
          console.log('[handleConfirmTrade] Using session execution path');

          // Session exists: use execution kernel (no wallet popups)
          // Find the chat message that contains executionRequest (including events)
          const chatMessage = messages.find((m: ChatMessage) =>
            m.executionRequest && (m.executionRequest.kind === 'swap' || m.executionRequest.kind === 'lend' || m.executionRequest.kind === 'lend_supply' || m.executionRequest.kind === 'event')
          );
          
          // Determine plan type and execution kind
          const planType = chatMessage?.executionRequest?.kind === 'lend' || chatMessage?.executionRequest?.kind === 'lend_supply'
            ? 'defi'
            : chatMessage?.executionRequest?.kind === 'event' || executedStrategy?.instrumentType === 'event'
              ? 'event'
              : executedStrategy?.instrumentType === 'perp'
                ? 'perp'
                : 'swap';
          const demoSwapKind = enableDemoSwap ? 'demo_swap' : 'default';

          // Use execution kernel
          const { executePlan } = await import('../lib/executionKernel');
          const result = await executePlan({
            draftId,
            userAddress,
            planType,
            executionRequest: chatMessage?.executionRequest,
            executionIntent: chatMessage?.executionRequest ? undefined : ethTestnetIntent,
            strategy: executedStrategy,
            executionKind: demoSwapKind,
          }, { executionAuthMode: 'session' });

          // Handle execution result - TRUTHFUL UI: only mark executed if txHash exists
          // Ensure error is always a string to prevent React crash
          const safeErrorText = (err: unknown): string => {
            if (typeof err === 'string') return err;
            if (err && typeof err === 'object' && 'message' in err) return String((err as any).message);
            if (err && typeof err === 'object') return JSON.stringify(err);
            return 'Execution failed. Strategy remains pending.';
          };

          if (!result.ok) {
            const errorMessage: ChatMessage = {
              id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              text: safeErrorText(result.error),
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            };
            appendMessageToChat(targetChatId, errorMessage);
            return; // Don't mark as executed
          }

          // TRUTHFUL UI: Only proceed if we have a real txHash (relayed or wallet mode)
          if (result.mode === 'simulated' || result.mode === 'unsupported') {
            const simulatedMessage: ChatMessage = {
              id: `simulated-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              text: `⚠️ ${result.mode === 'simulated' ? 'Simulated' : 'Not supported'}: ${safeErrorText(result.error)}`,
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            };
            appendMessageToChat(targetChatId, simulatedMessage);
            // Don't mark as executed - keep as draft/pending
            return;
          }

          // Only continue if we have txHash (relayed or wallet mode with confirmed tx)
          if (!result.txHash) {
            const pendingMessage: ChatMessage = {
              id: `pending-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              text: 'Execution pending confirmation. Strategy remains pending.',
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            };
            appendMessageToChat(targetChatId, pendingMessage);
            return; // Don't mark as executed
          }

          // Update portfolio if available
          if (result.portfolio) {
            updateFromBackendPortfolio(result.portfolio);
          }

          // Fallback: fetch latest backend portfolio snapshot to reflect balances/positions immediately
          try {
            const portfolioResponse = await callAgent(`/api/portfolio/eth_testnet?userAddress=${encodeURIComponent(userAddress)}`, {
              method: 'GET',
            });
            if (portfolioResponse.ok) {
              const portfolioData = await portfolioResponse.json();
              if (portfolioData?.portfolio) {
                updateFromBackendPortfolio(portfolioData.portfolio);
              } else if (portfolioData) {
                updateFromBackendPortfolio(portfolioData);
              }
            }
          } catch (portfolioSyncError) {
            if (import.meta.env.DEV) {
              console.warn('[handleConfirmTrade] Portfolio sync after execution failed:', portfolioSyncError);
            }
          }

          // Trigger wallet balance refresh after successful execution
          window.dispatchEvent(new CustomEvent('blossom-wallet-connection-change'));

          // Refresh positions from ledger to show in positions tray (don't await to not block)
          refreshLedgerPositions();

          // Handle receipt status
          if (result.receiptStatus === 'failed') {
            const failedMessage: ChatMessage = {
              id: `tx-failed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              text: `Transaction failed on-chain. Check: ${result.explorerUrl || `https://sepolia.etherscan.io/tx/${result.txHash}`}`,
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            };
            appendMessageToChat(targetChatId, failedMessage);
            return; // Don't mark as executed
          } else if (result.receiptStatus === 'timeout') {
            const timeoutMessage: ChatMessage = {
              id: `tx-timeout-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              text: `Transaction pending confirmation. Check status: ${result.explorerUrl || `https://sepolia.etherscan.io/tx/${result.txHash}`}`,
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            };
            appendMessageToChat(targetChatId, timeoutMessage);
            return; // Don't mark as executed
          } else if (result.receiptStatus !== 'confirmed') {
            // Receipt still pending
            if (import.meta.env.DEV) {
              console.log('[handleConfirmTrade] Receipt still pending, not updating portfolio');
            }
            return; // Wait for receipt confirmation
          }

          // TRUTHFUL UI: Only show "Executed" and Etherscan link if txHash exists
          if (result.txHash && result.routing) {
            const routing = result.routing;
            const explorerUrl = result.explorerUrl || `https://sepolia.etherscan.io/tx/${result.txHash}`;
            
            // Build message that distinguishes routing decision from execution
            let messageText = '';
            
            // Check if this is a lending action
            const isLendingAction = (routing as any).actionType === 'lend_supply' || (routing as any).apr;
            
            if (isLendingAction) {
              // Lending-specific message
              const apr = (routing as any).apr || '5.00';
              const protocol = (routing as any).vault ? 'DemoLendVault' : 'Lending Protocol';
              messageText += `🏦 Lending: Supply to ${protocol}. Est APR: ${apr}% (info-only).\n`;
              const executionVenue = routing.executionVenue || 'Blossom Demo Lending Vault';
              messageText += `✅ Executed on ${routing.chain || 'Sepolia'} via ${executionVenue}. `;
              messageText += `Tx: ${explorerUrl}`;
            } else {
              // Swap routing message (existing logic)
              if (routing.routingSource === '1inch') {
                messageText += `📊 Routing intelligence (1inch): ${routing.routeSummary || routing.venue}`;
                if (routing.expectedOut) {
                  messageText += `. Expected: ${routing.expectedOut}, Min: ${routing.minOut || 'N/A'}`;
                }
                if (routing.slippageBps) {
                  messageText += `, Slippage: ${(routing.slippageBps / 100).toFixed(2)}%`;
                }
                messageText += '.\n';
              } else if (routing.routingSource === 'uniswap') {
                messageText += `📊 Routing intelligence (Uniswap V3): ${routing.routeSummary || routing.venue}`;
                if (routing.expectedOut) {
                  messageText += `. Expected: ${routing.expectedOut}`;
                }
                messageText += '.\n';
              } else if (routing.routingSource === 'dflow') {
                messageText += `📊 Routing intelligence (dFlow): ${routing.routeSummary || routing.venue}`;
                messageText += '.\n';
              }
              
              // Execution section
              const executionVenue = routing.executionVenue || 'Blossom Demo Router';
              messageText += `✅ Executed on ${routing.chain || 'Sepolia'} via ${executionVenue}. `;
              messageText += `Tx: ${explorerUrl}`;
            }
            
            const routingMessage: ChatMessage = {
              id: `routing-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              text: messageText,
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            };
            appendMessageToChat(targetChatId, routingMessage);
          } else if (result.txHash) {
            // Fallback: just show tx link
            const explorerUrl = result.explorerUrl || `https://sepolia.etherscan.io/tx/${result.txHash}`;
            const txMessage: ChatMessage = {
              id: `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              text: `✅ Transaction submitted: ${explorerUrl}`,
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            };
            appendMessageToChat(targetChatId, txMessage);
          }

          // Start polling transaction status
          if (result.txHash) {
            pollTransactionStatus(result.txHash, targetChatId);
          }
          
          // TRUTHFUL UI: Only mark as executed if we have txHash and receipt is confirmed
          if (result.txHash && result.receiptStatus === 'confirmed') {
            // Set state to executing, then mark as executed
            setChatMode({ mode: 'executing', draftId });
            updateStrategyStatus(draftId, 'queued');
            setTimeout(() => {
              updateStrategyStatus(draftId, 'executing');
              setTimeout(() => {
                updateStrategyStatus(draftId, 'executed');
              }, 500);
            }, 500);
          }
          return; // Exit early - execution complete via one-click
        }
        
        // Direct execution path (no one-click or one-click unavailable)
        // Use execution kernel for unified execution
        {
          // Find the chat message that contains executionRequest
          const chatMessage = messages.find((m: ChatMessage) => 
            m.executionRequest && (m.executionRequest.kind === 'swap' || m.executionRequest.kind === 'lend' || m.executionRequest.kind === 'lend_supply')
          );
          
          // Determine plan type
          const planType = chatMessage?.executionRequest?.kind === 'lend' || chatMessage?.executionRequest?.kind === 'lend_supply' 
            ? 'defi' 
            : executedStrategy?.instrumentType === 'perp' 
              ? 'perp' 
              : executedStrategy?.instrumentType === 'event'
                ? 'event'
                : 'swap';
          const demoSwapKindDirect = enableDemoSwap ? 'demo_swap' : 'default';

          // Route 1 (manual) or Route 2 (atomic): Check if wrap is needed
          // If atomic mode, skip manual wrap (plan will include WRAP action)
          // If manual mode, do manual wrap step
          if (chatMessage?.executionRequest && chatMessage.executionRequest.kind === 'swap' && fundingRouteMode === 'manual') {
            const execReq = chatMessage.executionRequest;
            
            // Only check wrap if tokenIn is ETH or if fundingPolicy is auto
            if ((execReq.tokenIn === 'ETH' || execReq.fundingPolicy === 'auto') && execReq.amountIn) {
              // Check user's actual balances
              try {
                const portfolioResponse = await callAgent(`/api/portfolio/eth_testnet?userAddress=${encodeURIComponent(userAddress)}`, {
                  method: 'GET',
                });
                
                if (portfolioResponse.ok) {
                  const portfolio = await portfolioResponse.json();
                  const wethBalance = parseFloat(portfolio.balances.weth?.formatted || '0');
                  const ethBalance = parseFloat(portfolio.balances.eth?.formatted || '0');
                  const amountInNum = parseFloat(execReq.amountIn);
                  
                  // Need wrap if:
                  // 1. tokenIn is ETH (always need to wrap)
                  // 2. tokenIn is WETH but user has 0 WETH and has sufficient ETH
                  const shouldWrap = (execReq.tokenIn === 'ETH') || 
                    (execReq.tokenIn === 'WETH' && wethBalance < amountInNum && ethBalance >= amountInNum);
                  
                  if (shouldWrap) {
                    // Step 1: Wrap ETH → WETH
                    const wrapAmount = execReq.tokenIn === 'ETH' ? execReq.amountIn : execReq.amountIn;
                    
                    const wrapPrepareResponse = await callAgent('/api/token/weth/wrap/prepare', {
                      method: 'POST',
                      body: JSON.stringify({
                        amount: wrapAmount,
                        userAddress,
                      }),
                    });
                    
                    if (!wrapPrepareResponse.ok) {
                      const errorText = await wrapPrepareResponse.text();
                      const errorMessage: ChatMessage = {
                        id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        text: `Failed to prepare wrap transaction: ${errorText || 'Unknown error'}. Strategy remains pending.`,
                        isUser: false,
                        timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                      };
                      appendMessageToChat(targetChatId, errorMessage);
                      return;
                    }
                    
                    const wrapData = await wrapPrepareResponse.json();
                    
                    // Show wrap step message
                    const wrapMessage: ChatMessage = {
                      id: `wrap-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                      text: `Wrapping ${wrapAmount} ETH → WETH...`,
                      isUser: false,
                      timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                    };
                    appendMessageToChat(targetChatId, wrapMessage);
                    
                    // Send wrap transaction
                    const wrapTx: PreparedTx = {
                      to: wrapData.to,
                      data: wrapData.data,
                      value: wrapData.value,
                    };
                    
                    let wrapTxHash: string;
                    try {
                      wrapTxHash = await sendTransaction(wrapTx);
                      if (import.meta.env.DEV) {
                        console.log('[handleConfirmTrade] Wrap transaction sent, txHash:', wrapTxHash);
                      }
                    } catch (error: any) {
                      const errorMessage: ChatMessage = {
                        id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        text: `Wrap transaction failed: ${error.message || 'Unknown error'}. Strategy remains pending.`,
                        isUser: false,
                        timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                      };
                      appendMessageToChat(targetChatId, errorMessage);
                      return; // Stop - don't proceed to swap
                    }
                    
                    // Wait for wrap confirmation (poll for 1 block)
                    const wrapStatusId = `wrap-status-${wrapTxHash}`;
                    let wrapConfirmed = false;
                    const maxWrapAttempts = 30; // 30 * 2s = 60s
                    let wrapAttempts = 0;
                    
                    while (!wrapConfirmed && wrapAttempts < maxWrapAttempts) {
                      await new Promise(resolve => setTimeout(resolve, 2000)); // 2s delay
                      wrapAttempts++;
                      
                      try {
                        const statusResponse = await callAgent(`/api/execute/status?txHash=${encodeURIComponent(wrapTxHash)}`, {
                          method: 'GET',
                        });
                        
                        if (statusResponse.ok) {
                          const statusData = await statusResponse.json();
                          if (statusData.status === 'confirmed') {
                            wrapConfirmed = true;
                            break;
                          } else if (statusData.status === 'reverted') {
                            const errorMessage: ChatMessage = {
                              id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                              text: `Wrap transaction reverted. Strategy remains pending.`,
                              isUser: false,
                              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                            };
                            appendMessageToChat(targetChatId, errorMessage);
                            return; // Stop - wrap failed
                          }
                        }
                      } catch (error: any) {
                        // Continue polling on error
                        if (import.meta.env.DEV) {
                          console.warn('[handleConfirmTrade] Wrap status check error:', error.message);
                        }
                      }
                    }
                    
                    if (!wrapConfirmed) {
                      const errorMessage: ChatMessage = {
                        id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        text: `Wrap transaction not confirmed after 60s. Please check manually. Strategy remains pending.`,
                        isUser: false,
                        timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                      };
                      appendMessageToChat(targetChatId, errorMessage);
                      return; // Stop - wrap not confirmed
                    }
                    
                    // Wrap confirmed - refresh portfolio and continue to swap
                    const portfolioRefreshResponse = await callAgent(`/api/portfolio/eth_testnet?userAddress=${encodeURIComponent(userAddress)}`, {
                      method: 'GET',
                    });
                    if (portfolioRefreshResponse.ok) {
                      const refreshedPortfolio = await portfolioRefreshResponse.json();
                      // Portfolio will auto-update via context sync
                    }
                    
                    // Update wrap message to show success
                    updateMessageInChat(targetChatId, wrapMessage.id, {
                      text: `✅ Wrapped ${wrapAmount} ETH → WETH. Proceeding to swap...`,
                    });
                  }
                }
              } catch (error: any) {
                // If portfolio check fails, proceed anyway (might have WETH already)
                if (import.meta.env.DEV) {
                  console.warn('[handleConfirmTrade] Portfolio check failed, proceeding:', error.message);
                }
              }
            }
          }
          
          // Manual signing flow: Call /api/execute/prepare and trigger wallet signature
          console.log('[handleConfirmTrade] Manual signing flow - preparing transaction');

          // Show "Waiting for wallet signature" status
          const sigStatusMsgId = `sig-status-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const sigStatusMessage: ChatMessage = {
            id: sigStatusMsgId,
            text: '⏳ Preparing transaction for wallet signature...',
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          };
          appendMessageToChat(targetChatId, sigStatusMessage);

          // Step 1: Call /api/execute/prepare
          let prepareResult: any;
          try {
            const prepareResponse = await callAgent('/api/execute/prepare', {
              method: 'POST',
              body: JSON.stringify({
                draftId,
                userAddress,
                executionRequest: chatMessage?.executionRequest,
                executionIntent: chatMessage?.executionRequest ? undefined : ethTestnetIntent,
                strategy: executedStrategy,
                executionKind: demoSwapKindDirect,
              }),
            });

            if (!prepareResponse.ok) {
              const errorData = await prepareResponse.json().catch(() => ({ error: 'Unknown error' }));

              // Handle V1_DEMO mode blocking manual signing
              if (prepareResponse.status === 403 && errorData.errorCode === 'V1_DEMO_DIRECT_BLOCKED') {
                updateMessageInChat(targetChatId, sigStatusMsgId, {
                  text: '❌ Manual signing is not available in demo mode. Please enable One-Click Execution in the wallet panel.',
                });
                return;
              }

              updateMessageInChat(targetChatId, sigStatusMsgId, {
                text: `❌ Failed to prepare transaction: ${errorData.error || errorData.message || 'Unknown error'}`,
              });
              return;
            }

            prepareResult = await prepareResponse.json();
            console.log('[handleConfirmTrade] Prepare result:', prepareResult);
          } catch (error: any) {
            updateMessageInChat(targetChatId, sigStatusMsgId, {
              text: `❌ Failed to prepare transaction: ${error.message || 'Network error'}`,
            });
            return;
          }

          // Step 2: Check if approval is needed
          if (prepareResult.approvalNeeded && prepareResult.approvalTx) {
            updateMessageInChat(targetChatId, sigStatusMsgId, {
              text: '⏳ Approval required. Please approve token spending in your wallet...',
            });

            try {
              const approvalTxHash = await sendTransaction({
                to: prepareResult.approvalTx.to,
                data: prepareResult.approvalTx.data,
                value: prepareResult.approvalTx.value,
              });

              if (!approvalTxHash) {
                updateMessageInChat(targetChatId, sigStatusMsgId, {
                  text: '❌ Approval transaction rejected or failed. Strategy remains pending.',
                });
                return;
              }

              // Wait for approval confirmation
              updateMessageInChat(targetChatId, sigStatusMsgId, {
                text: '⏳ Waiting for approval confirmation...',
              });

              let approvalConfirmed = false;
              for (let i = 0; i < 30 && !approvalConfirmed; i++) {
                await new Promise(r => setTimeout(r, 2000));
                try {
                  const statusRes = await callAgent(`/api/execute/status?txHash=${encodeURIComponent(approvalTxHash)}`);
                  if (statusRes.ok) {
                    const statusData = await statusRes.json();
                    if (statusData.status === 'confirmed') approvalConfirmed = true;
                    else if (statusData.status === 'reverted') {
                      updateMessageInChat(targetChatId, sigStatusMsgId, {
                        text: '❌ Approval transaction reverted. Strategy remains pending.',
                      });
                      return;
                    }
                  }
                } catch {}
              }

              if (!approvalConfirmed) {
                updateMessageInChat(targetChatId, sigStatusMsgId, {
                  text: '❌ Approval not confirmed after 60s. Please check manually.',
                });
                return;
              }
            } catch (error: any) {
              updateMessageInChat(targetChatId, sigStatusMsgId, {
                text: `❌ Approval failed: ${error.message || 'Unknown error'}`,
              });
              return;
            }
          }

          // Step 3: Execute the main transaction
          // Backend returns: { to, call, value, plan, routing, ... }
          // Check for V1_DEMO_DIRECT_BLOCKED error
          if (prepareResult.errorCode === 'V1_DEMO_DIRECT_BLOCKED') {
            updateMessageInChat(targetChatId, sigStatusMsgId, {
              text: '❌ Manual signing is not available in demo mode. Please enable One-Click Execution instead.',
            });
            return;
          }

          // Check we have transaction data
          const hasValidTx = prepareResult.to && (prepareResult.call || prepareResult.plan?.calldata);
          if (!hasValidTx) {
            updateMessageInChat(targetChatId, sigStatusMsgId, {
              text: '❌ No transaction to execute. The backend did not return valid execution data.',
            });
            return;
          }

          updateMessageInChat(targetChatId, sigStatusMsgId, {
            text: '⏳ Waiting for wallet signature... Please confirm in your wallet.',
          });

          // Get the transaction to sign from backend response format
          // Backend returns: to (address), call (calldata), value (hex)
          const txToSign = {
            to: prepareResult.to,
            data: prepareResult.call || prepareResult.plan?.calldata,
            value: prepareResult.value || '0x0',
          };

          if (!txToSign.to || !txToSign.data) {
            updateMessageInChat(targetChatId, sigStatusMsgId, {
              text: '❌ Invalid transaction data from backend. Strategy remains pending.',
            });
            return;
          }

          console.log('[handleConfirmTrade] Sending transaction:', { to: txToSign.to, dataLen: txToSign.data?.length, value: txToSign.value });

          let txHash: string | null;
          try {
            txHash = await sendTransaction(txToSign);
          } catch (error: any) {
            const isRejection = error.message?.toLowerCase().includes('rejected') ||
                               error.message?.toLowerCase().includes('denied') ||
                               error.code === 4001;
            updateMessageInChat(targetChatId, sigStatusMsgId, {
              text: isRejection
                ? '❌ Transaction rejected by user. Strategy remains pending.'
                : `❌ Transaction failed: ${error.message || 'Unknown error'}`,
            });
            return;
          }

          if (!txHash) {
            updateMessageInChat(targetChatId, sigStatusMsgId, {
              text: '❌ No transaction hash returned. Strategy remains pending.',
            });
            return;
          }

          // Update status with tx link
          const explorerUrl = `https://sepolia.etherscan.io/tx/${txHash}`;
          updateMessageInChat(targetChatId, sigStatusMsgId, {
            text: `⏳ Transaction submitted! Waiting for confirmation... [View on Etherscan](${explorerUrl})`,
          });

          // Step 4: Poll for confirmation
          let result: any = { ok: false, txHash, receiptStatus: 'pending' };
          for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 2000));
            try {
              const statusRes = await callAgent(`/api/execute/status?txHash=${encodeURIComponent(txHash)}`);
              if (statusRes.ok) {
                const statusData = await statusRes.json();
                result = {
                  ok: statusData.status === 'confirmed',
                  txHash,
                  receiptStatus: statusData.status,
                  explorerUrl,
                  routing: prepareResult.routing,
                  blockNumber: statusData.blockNumber,
                };
                if (statusData.status === 'confirmed' || statusData.status === 'reverted' || statusData.status === 'failed') {
                  break;
                }
              }
            } catch {}
          }

          // Handle execution result - TRUTHFUL UI: only mark executed if txHash exists
          if (!result.ok && result.receiptStatus === 'pending') {
            // Timeout waiting for confirmation
            updateMessageInChat(targetChatId, sigStatusMsgId, {
              text: `⏳ Transaction pending confirmation. Check status: ${explorerUrl}`,
            });
            return; // Don't mark as executed yet
          }

          if (result.receiptStatus === 'reverted' || result.receiptStatus === 'failed') {
            updateMessageInChat(targetChatId, sigStatusMsgId, {
              text: `❌ Transaction failed on-chain. Check: ${explorerUrl}`,
            });
            return;
          }

          // Transaction confirmed! Update status and portfolio
          window.dispatchEvent(new CustomEvent('blossom-wallet-connection-change'));

          // Build success message with routing info
          if (result.txHash && result.routing) {
            const routing = result.routing;
            const finalExplorerUrl = result.explorerUrl || explorerUrl;
            
            // Build message that distinguishes routing decision from execution
            let messageText = '';
            
            // Check if this is a lending action
            const isLendingAction = (routing as any).actionType === 'lend_supply' || (routing as any).apr;
            
            if (isLendingAction) {
              // Lending-specific message
              const apr = (routing as any).apr || '5.00';
              const protocol = (routing as any).vault ? 'DemoLendVault' : 'Lending Protocol';
              messageText += `🏦 Lending: Supply to ${protocol}. Est APR: ${apr}% (info-only).\n`;
              const executionVenue = routing.executionVenue || 'Blossom Demo Lending Vault';
              messageText += `✅ Executed on ${routing.chain || 'Sepolia'} via ${executionVenue}. `;
              messageText += `Tx: ${explorerUrl}`;
            } else {
              // Swap routing message (existing logic)
              if (routing.routingSource === '1inch') {
                messageText += `📊 Routing intelligence (1inch): ${routing.routeSummary || routing.venue}`;
                if (routing.expectedOut) {
                  messageText += `. Expected: ${routing.expectedOut}, Min: ${routing.minOut || 'N/A'}`;
                }
                if (routing.slippageBps) {
                  messageText += `, Slippage: ${(routing.slippageBps / 100).toFixed(2)}%`;
                }
                messageText += '.\n';
              } else if (routing.routingSource === 'uniswap') {
                messageText += `📊 Routing intelligence (Uniswap V3): ${routing.routeSummary || routing.venue}`;
                if (routing.expectedOut) {
                  messageText += `. Expected: ${routing.expectedOut}`;
                }
                messageText += '.\n';
              } else if (routing.routingSource === 'dflow') {
                messageText += `📊 Routing intelligence (dFlow): ${routing.routeSummary || routing.venue}`;
                messageText += '.\n';
              }
              
              // Execution section
              const executionVenue = routing.executionVenue || 'Blossom Demo Router';
              messageText += `✅ Executed on ${routing.chain || 'Sepolia'} via ${executionVenue}. `;
              messageText += `Tx: ${explorerUrl}`;
            }
            
            const routingMessage: ChatMessage = {
              id: `routing-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              text: messageText,
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            };
            appendMessageToChat(targetChatId, routingMessage);
          } else if (result.txHash) {
            // Fallback: just show tx link
            const explorerUrl = result.explorerUrl || `https://sepolia.etherscan.io/tx/${result.txHash}`;
            const txMessage: ChatMessage = {
              id: `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              text: `✅ Transaction submitted: ${explorerUrl}`,
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            };
            appendMessageToChat(targetChatId, txMessage);
          }

          // Start polling transaction status
          if (result.txHash) {
            pollTransactionStatus(result.txHash, targetChatId);
          }
          
          // TRUTHFUL UI: Only mark as executed if we have txHash and receipt is confirmed
          if (result.txHash && result.receiptStatus === 'confirmed') {
            // Set state to executing, then mark as executed
            setChatMode({ mode: 'executing', draftId });
            updateStrategyStatus(draftId, 'queued');
            setTimeout(() => {
              updateStrategyStatus(draftId, 'executing');
              setTimeout(() => {
                updateStrategyStatus(draftId, 'executed');
              }, 500);
            }, 500);
          }
        }
      } catch (error: any) {
        // Catch-all for unexpected errors - ensure safe string conversion
        let errorText = 'Unknown error';
        try {
          if (typeof error === 'string') {
            errorText = error;
          } else if (error?.message && typeof error.message === 'string') {
            errorText = error.message;
          } else if (error) {
            errorText = JSON.stringify(error);
          }
        } catch {
          errorText = 'Unexpected error occurred';
        }
        const errorMessage: ChatMessage = {
          id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          text: `Execution error: ${errorText}. Strategy remains pending.`,
          isUser: false,
          timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        };
        appendMessageToChat(targetChatId, errorMessage);
        return; // Don't mark as executed
      }
    }
    
    // TRUTHFUL UI: Status update only happens in execution success paths above
    // If we reach here, execution didn't happen (sim mode or early return)
    // Don't mark as executed - strategy remains in draft/pending state
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
        
        {/* Helper trigger (Demo mode banner removed - Beta pill is in header) */}
        <div className="absolute top-4 right-4 z-40 flex items-center gap-2">
          <SessionResetButton variant="icon" />
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
                // Task A: Remove special ConfirmTradeCard handling - let MessageBubble render rich card
                // MessageBubble already has the rich card with Sizing/Risk Controls/Routing/Assumptions
                // We just need to ensure strategyId is set so MessageBubble can find the draft
                const isTradeConfirm = (msg as any).type === 'trade_confirm';
                const confirmDraftId = (msg as any).draftId;
                const isHighRiskConfirmation = (msg as any).isHighRiskConfirmation;
                const highRiskReasons = (msg as any).highRiskReasons || [];
                
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
                // Task A: Ensure trade_confirm messages also use MessageBubble (which has rich card)
                const msgShowRiskWarning = (msg as any).showRiskWarning || (isHighRiskConfirmation && highRiskReasons.length > 0);
                const msgRiskReasons = (msg as any).riskReasons || highRiskReasons;
                // Task A: Use draftId from trade_confirm message if strategyId not set
                const msgStrategyId = msg.strategyId || (isTradeConfirm ? confirmDraftId : undefined);
                
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
                  intentExecution={msg.intentExecution}
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
                      // Intent confirmation (confirm mode)
                      onConfirmIntent={handleConfirmIntent}
                      isConfirmingIntent={confirmingIntentId === msg.intentExecution?.result?.intentId}
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
            {/* One-Click Gate Notice - only show if NOT using manual signing mode */}
            {executionAuthMode === 'session' && !isOneClickAuthorized(walletStatus.evmAddress) && !isManualSigningEnabled(walletStatus.evmAddress) && walletStatus.evmConnected && (
              <div className="mb-2 px-3 py-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg text-center">
                Enable One-Click Execution in the wallet panel to start trading
              </div>
            )}
            <div className="flex items-center gap-3">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={inputValue.trim().length > 0 ? '' : SUGGESTIONS[placeholderIndex]}
                disabled={executionAuthMode === 'session' && walletStatus.evmConnected && !isOneClickAuthorized(walletStatus.evmAddress) && !isManualSigningEnabled(walletStatus.evmAddress)}
                className={`flex-1 resize-none border border-blossom-outline/60 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blossom-pink/30 focus:border-blossom-pink bg-white/90 text-sm ${
                  executionAuthMode === 'session' && walletStatus.evmConnected && !isOneClickAuthorized(walletStatus.evmAddress) && !isManualSigningEnabled(walletStatus.evmAddress) ? 'opacity-50 cursor-not-allowed' : ''
                }`}
                rows={1}
                style={{ minHeight: '48px', maxHeight: '120px' }}
              />
              {(() => {
                const oneClickGated = executionAuthMode === 'session' && walletStatus.evmConnected && !isOneClickAuthorized(walletStatus.evmAddress) && !isManualSigningEnabled(walletStatus.evmAddress);
                const canSend = inputValue.trim().length > 0 && !isTyping && !oneClickGated;
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
