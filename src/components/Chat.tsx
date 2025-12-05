import { useState, useRef, useEffect } from 'react';
import MessageBubble from './MessageBubble';
import TypingIndicator from './TypingIndicator';
import { parseUserMessage, generateBlossomResponse, ParsedStrategy } from '../lib/mockParser';
import { useBlossomContext, ActiveTab } from '../context/BlossomContext';
import { USE_AGENT_BACKEND } from '../lib/config';
import { callBlossomChat } from '../lib/blossomApi';

export interface Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: string;
  strategy?: ParsedStrategy | null;
  strategyId?: string | null;
  defiProposalId?: string | null;
}

interface ChatProps {
  selectedStrategyId: string | null;
}

const SUGGESTIONS = [
  'Long ETH with 3% risk, manage liquidation for me.',
  'Show my riskiest positions and how to reduce risk.',
  'Build a market-neutral funding strategy on BTC.',
  'Hedge my SOL spot with perps at 2% risk.',
];

const QUICK_PROMPTS_PERPS = [
  'Long ETH with 3% risk and manage liquidation for me',
  'Park half my idle USDC into the safest yield on Kamino',
  'Market-neutral BTC funding strategy',
  'Hedge my SOL spot with perps',
];

const QUICK_PROMPTS_EVENTS = [
  'Take YES on Fed cuts in March with 2% account risk.',
  'Bet $500 that BTC ETF is approved by Dec 31.',
  'Take NO on ETH ETF approval by June.',
  'Stake $300 on YES for crypto market cap above $3T.',
];

export default function Chat({ selectedStrategyId }: ChatProps) {
  const { addDraftStrategy, setOnboarding, activeTab, venue, account, createDefiPlanFromCommand, updateFromBackendPortfolio } = useBlossomContext();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      text: 'Hi, I\'m your trading copilot. Tell me what you\'d like to trade and how much risk you want to take.\n\nYou can scroll up to review past strategies, and select any strategy from the Execution Queue on the right.',
      isUser: false,
      timestamp: '10:22 AM',
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
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
  }, [messages, isTyping, isAtBottom]);

  const handleScroll = () => {
    checkIfAtBottom();
  };

  const handleSend = async () => {
    if (!inputValue.trim() || isTyping) return;

    const userText = inputValue.trim();
    const userMessageId = Date.now().toString();
    const userMessage: Message = {
      id: userMessageId,
      text: userText,
      isUser: true,
      timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsTyping(true);
    setIsAtBottom(true);

    if (USE_AGENT_BACKEND) {
      // Agent mode: call backend
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

        const blossomResponse: Message = {
          id: (Date.now() + 1).toString(),
          text: response.assistantMessage,
          isUser: false,
          timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          strategy: strategy,
          strategyId: strategyId,
          defiProposalId: defiProposalId,
        };
        setMessages(prev => [...prev, blossomResponse]);
        setIsTyping(false);
      } catch (error: any) {
        console.error('Agent backend error:', error);
        const errorMessage: Message = {
          id: (Date.now() + 1).toString(),
          text: "I couldn't reach the agent backend, so I didn't execute anything. Please try again.",
          isUser: false,
          timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        };
        setMessages(prev => [...prev, errorMessage]);
        setIsTyping(false);
      }
    } else {
      // Mock mode: existing behavior
      const parsed = parseUserMessage(userText, { venue });

      // Simulate thinking delay
      setTimeout(() => {
        const blossomResponseId = (Date.now() + 1).toString();
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
          
          // Calculate stake
          let stakeUsd: number;
          if (eventStrat.stakeUsd) {
            stakeUsd = eventStrat.stakeUsd;
          } else {
            const riskPct = eventStrat.riskPercent || 1;
            stakeUsd = (account.accountValue * riskPct) / 100;
            const usdcBalance = account.balances.find(b => b.symbol === 'USDC');
            const availableUsdc = usdcBalance?.balanceUsd || 0;
            stakeUsd = Math.min(stakeUsd, availableUsdc);
          }
          
          const maxPayoutUsd = stakeUsd * 1.7;
          const riskPct = eventStrat.riskPercent || (stakeUsd / account.accountValue) * 100;
          
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

        const blossomResponse: Message = {
          id: blossomResponseId,
          text: generateBlossomResponse(parsed),
          isUser: false,
          timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          strategy: strategy,
          strategyId: strategyId,
          defiProposalId: defiProposalId,
        };
        setMessages(prev => [...prev, blossomResponse]);
        setIsTyping(false);
      }, 1500);
    }
  };

  const handleQuickPrompt = (prompt: string) => {
    setInputValue(prompt);
    textareaRef.current?.focus();
  };

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
    <div className="flex flex-col h-full min-h-0">
      <div 
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto min-h-0 px-6 py-8"
      >
        <div className="max-w-3xl mx-auto">
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
      <div className="flex-shrink-0 border-t border-blossom-outline/50 bg-white/85 backdrop-blur-sm p-4 shadow-[0_-4px_20px_rgba(15,23,42,0.08)]">
        <div className="max-w-3xl mx-auto">
          <div className="flex gap-2 mb-3 overflow-x-auto pb-2">
            {(venue === 'hyperliquid' ? QUICK_PROMPTS_PERPS : QUICK_PROMPTS_EVENTS).map((prompt, idx) => (
              <button
                key={idx}
                onClick={() => handleQuickPrompt(prompt)}
                className="flex-shrink-0 rounded-full border border-blossom-outline/60 bg-white/70 text-xs text-blossom-slate px-3 py-1.5 hover:bg-blossom-pinkSoft/40 hover:text-blossom-ink transition-all whitespace-nowrap"
              >
                {prompt}
              </button>
            ))}
          </div>
          <div className="flex gap-3">
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
            <button
              onClick={handleSend}
              disabled={!inputValue.trim() || isTyping}
              className="px-6 py-2.5 bg-blossom-pink text-white rounded-xl hover:bg-[#FF5A96] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-[0_10px_25px_rgba(255,107,160,0.35)] text-sm font-medium"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

