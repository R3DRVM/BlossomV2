import { useState, useRef, useEffect } from 'react';
import MessageBubble from './MessageBubble';
import TypingIndicator from './TypingIndicator';
import { parseUserMessage, generateBlossomResponse, ParsedStrategy } from '../lib/mockParser';
import { useBlossomContext, ActiveTab, Venue } from '../context/BlossomContext';

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
  'Long ETH 3% risk, auto TP/SL',
  'Market-neutral BTC funding strategy',
  'Hedge my SOL spot with perps',
  'Show portfolio risk summary',
];

const QUICK_PROMPTS_EVENTS = [
  'Bet $500 that BTC ETF is approved by Dec 31.',
  'Take YES on Fed cuts in March with 2% account risk.',
  'Risk 1% on a NO position for ETH ETF delay.',
  'Stake $300 on YES for rate cuts by Q2.',
];

export default function Chat({ selectedStrategyId }: ChatProps) {
  const { addDraftStrategy, setOnboarding, activeTab, venue, account, createDefiPlanFromCommand, latestDefiProposal } = useBlossomContext();
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

  const handleSend = () => {
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

    // Parse message with venue context
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
        text: generateBlossomResponse(parsed, userText),
        isUser: false,
        timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        strategy: strategy,
        strategyId: strategyId,
        defiProposalId: defiProposalId,
      };
      setMessages(prev => [...prev, blossomResponse]);
      setIsTyping(false);
    }, 1500);
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
      <div className="flex-shrink-0 border-t border-gray-200 bg-white p-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex gap-2 mb-3 overflow-x-auto pb-2">
            {(venue === 'hyperliquid' ? QUICK_PROMPTS_PERPS : QUICK_PROMPTS_EVENTS).map((prompt, idx) => (
              <button
                key={idx}
                onClick={() => handleQuickPrompt(prompt)}
                className="flex-shrink-0 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors whitespace-nowrap"
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
              className="flex-1 resize-none border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              rows={1}
              style={{ minHeight: '48px', maxHeight: '120px' }}
            />
            <button
              onClick={handleSend}
              disabled={!inputValue.trim() || isTyping}
              className="px-6 py-3 bg-purple-500 text-white rounded-lg font-medium hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

