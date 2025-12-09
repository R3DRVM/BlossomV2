import { useState, useRef, useEffect } from 'react';
import MessageBubble from './MessageBubble';
import TypingIndicator from './TypingIndicator';
import { parseUserMessage, generateBlossomResponse, ParsedStrategy } from '../lib/mockParser';
import { useBlossomContext, ActiveTab } from '../context/BlossomContext';
import { USE_AGENT_BACKEND } from '../lib/config';
import { callBlossomChat } from '../lib/blossomApi';
import QuickStartPanel from './QuickStartPanel';

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

export default function Chat({ selectedStrategyId, onRegisterInsertPrompt }: ChatProps) {
  const { addDraftStrategy, setOnboarding, activeTab, venue, account, createDefiPlanFromCommand, updateFromBackendPortfolio, strategies, updateEventStake, getBaseAsset, updateStrategy, closeStrategy, closeEventStrategy } = useBlossomContext();
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
  }, [messages, isTyping, isAtBottom]);

  const handleScroll = () => {
    checkIfAtBottom();
  };

  const handleSend = async () => {
    if (!inputValue.trim() || isTyping) return;

    const userText = inputValue.trim();
    // Ensure unique message ID with timestamp + random component
    const userMessageId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const userMessage: Message = {
      id: userMessageId,
      text: userText,
      isUser: true,
      timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    };

    // Always append - never replace
    setMessages(prev => {
      // Defensive check: ensure we're not accidentally clearing messages
      if (prev.length === 0 && userMessage.id !== '0') {
        return [
          {
            id: '0',
            text: 'Hi, I\'m your trading copilot. Tell me what you\'d like to trade and how much risk you want to take.\n\nYou can scroll up to review past strategies, and select any strategy from the Execution Queue on the right.',
            isUser: false,
            timestamp: '10:22 AM',
          },
          userMessage,
        ];
      }
      return [...prev, userMessage];
    });
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

        const blossomResponse: Message = {
          id: `assistant-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          text: response.assistantMessage,
          isUser: false,
          timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          strategy: strategy,
          strategyId: strategyId,
          defiProposalId: defiProposalId,
        };
        // Always append - never replace
        setMessages(prev => [...prev, blossomResponse]);
        setIsTyping(false);
      } catch (error: any) {
        console.error('Agent backend error:', error);
        const errorMessage: Message = {
          id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          text: "I couldn't reach the agent backend, so I didn't execute anything. Please try again.",
          isUser: false,
          timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        };
        // Always append - never replace
        setMessages(prev => [...prev, errorMessage]);
        setIsTyping(false);
      }
    } else {
      // Mock mode: existing behavior
      console.log('[Chat] Using MOCK mode - request handled locally, backend not called');
      const parsed = parseUserMessage(userText, { venue });

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
            const errorMessage: Message = {
              id: `error-${Date.now()}`,
              text: "I couldn't find an active event position to update. Please create an event position first.",
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            };
            setMessages(prev => [...prev, errorMessage]);
            setIsTyping(false);
            return;
          }
          
          const targetStrategy = update.strategyId 
            ? eventStrategies.find(s => s.id === update.strategyId)
            : eventStrategies[0]; // Use most recent if no ID specified
          
          if (!targetStrategy) {
            const errorMessage: Message = {
              id: `error-${Date.now()}`,
              text: "I couldn't find the event position to update.",
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            };
            setMessages(prev => [...prev, errorMessage]);
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
          
          const blossomResponse: Message = {
            id: `update-${Date.now()}`,
            text: generateBlossomResponse(parsed, userText),
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          };
          setMessages(prev => [...prev, blossomResponse]);
          setIsTyping(false);
        } else if (parsed.intent === 'modifyPerpPosition' && parsed.positionModification) {
          // Handle perp position modifications
          const mod = parsed.positionModification;
          
          // Find matching perp position
          let targetStrategy = null;
          if (mod.symbol) {
            const matchingPerps = strategies.filter(s => 
              s.instrumentType === 'perp' && 
              (s.status === 'executed' || s.status === 'executing') && 
              !s.isClosed &&
              getBaseAsset(s.market) === mod.symbol
            );
            // Use most recent if multiple matches
            targetStrategy = matchingPerps.length > 0 ? matchingPerps[matchingPerps.length - 1] : null;
          } else {
            // No symbol specified, use most recent perp
            const allPerps = strategies.filter(s => 
              s.instrumentType === 'perp' && 
              (s.status === 'executed' || s.status === 'executing') && 
              !s.isClosed
            );
            targetStrategy = allPerps.length > 0 ? allPerps[allPerps.length - 1] : null;
          }
          
          if (!targetStrategy) {
            const errorMessage: Message = {
              id: `error-${Date.now()}`,
              text: mod.symbol 
                ? `I couldn't find an open ${mod.symbol} perp position. Try specifying the asset (e.g. 'my ETH long').`
                : "I couldn't find an open perp position that matches that description. Try specifying the asset (e.g. 'my ETH long').",
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            };
            setMessages(prev => [...prev, errorMessage]);
            setIsTyping(false);
            return;
          }
          
          // Build update object
          const updates: any = {};
          if (mod.riskPercent !== undefined) {
            updates.riskPercent = mod.riskPercent;
            // Recalculate notional based on new risk
            updates.notionalUsd = account.accountValue * mod.riskPercent / 100;
          }
          if (mod.leverage !== undefined) {
            updates.leverage = mod.leverage;
          }
          if (mod.takeProfit !== undefined) {
            updates.takeProfit = mod.takeProfit;
          }
          if (mod.stopLoss !== undefined) {
            updates.stopLoss = mod.stopLoss;
          }
          
          // Apply updates
          updateStrategy(targetStrategy.id, updates);
          
          // Generate confirmation message
          const confirmParts: string[] = [];
          if (mod.riskPercent !== undefined) {
            confirmParts.push(`risk to ${mod.riskPercent}%`);
          }
          if (mod.leverage !== undefined) {
            confirmParts.push(`leverage to ${mod.leverage}x`);
          }
          if (mod.takeProfit !== undefined) {
            confirmParts.push(`take profit to $${mod.takeProfit.toLocaleString()}`);
          }
          if (mod.stopLoss !== undefined) {
            confirmParts.push(`stop loss to $${mod.stopLoss.toLocaleString()}`);
          }
          
          const confirmText = confirmParts.length > 0
            ? `Got it. I've updated your ${targetStrategy.market} ${targetStrategy.side.toLowerCase()} position: ${confirmParts.join(', ')}.`
            : `Got it. I've updated your ${targetStrategy.market} position.`;
          
          const blossomResponse: Message = {
            id: `modify-${Date.now()}`,
            text: confirmText,
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          };
          setMessages(prev => [...prev, blossomResponse]);
          setIsTyping(false);
          return;
        } else if (parsed.intent === 'closePerpPosition' && parsed.positionModification) {
          // Handle perp position close
          const mod = parsed.positionModification;
          
          // Find matching perp position
          let targetStrategy = null;
          if (mod.symbol) {
            const matchingPerps = strategies.filter(s => 
              s.instrumentType === 'perp' && 
              (s.status === 'executed' || s.status === 'executing') && 
              !s.isClosed &&
              getBaseAsset(s.market) === mod.symbol
            );
            targetStrategy = matchingPerps.length > 0 ? matchingPerps[matchingPerps.length - 1] : null;
          } else {
            const allPerps = strategies.filter(s => 
              s.instrumentType === 'perp' && 
              (s.status === 'executed' || s.status === 'executing') && 
              !s.isClosed
            );
            targetStrategy = allPerps.length > 0 ? allPerps[allPerps.length - 1] : null;
          }
          
          if (!targetStrategy) {
            const errorMessage: Message = {
              id: `error-${Date.now()}`,
              text: mod.symbol 
                ? `I couldn't find an open ${mod.symbol} perp position to close.`
                : "I couldn't find an open perp position to close. Try specifying the asset (e.g. 'close my ETH long').",
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            };
            setMessages(prev => [...prev, errorMessage]);
            setIsTyping(false);
            return;
          }
          
          // Close the position
          closeStrategy(targetStrategy.id);
          
          const blossomResponse: Message = {
            id: `close-${Date.now()}`,
            text: `Done. I've closed your ${targetStrategy.market} ${targetStrategy.side.toLowerCase()} position and realized PnL in the sim wallet.`,
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          };
          setMessages(prev => [...prev, blossomResponse]);
          setIsTyping(false);
          return;
        } else if (parsed.intent === 'modifyEventPosition' && parsed.positionModification) {
          // Handle event position modifications
          const mod = parsed.positionModification;
          
          // Find matching event position
          let targetStrategy = null;
          if (mod.eventKey) {
            const matchingEvents = strategies.filter(s => 
              s.instrumentType === 'event' && 
              (s.status === 'executed' || s.status === 'executing') && 
              !s.isClosed &&
              s.eventKey === mod.eventKey
            );
            targetStrategy = matchingEvents.length > 0 ? matchingEvents[matchingEvents.length - 1] : null;
          } else {
            const allEvents = strategies.filter(s => 
              s.instrumentType === 'event' && 
              (s.status === 'executed' || s.status === 'executing') && 
              !s.isClosed
            );
            targetStrategy = allEvents.length > 0 ? allEvents[allEvents.length - 1] : null;
          }
          
          if (!targetStrategy) {
            const errorMessage: Message = {
              id: `error-${Date.now()}`,
              text: "I couldn't find an open event position that matches that description. Try specifying the event name.",
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            };
            setMessages(prev => [...prev, errorMessage]);
            setIsTyping(false);
            return;
          }
          
          // Update stake if provided
          if (mod.stake !== undefined) {
            const accountValue = account.accountValue;
            const maxAllowedUsd = accountValue;
            const newStakeUsd = Math.min(mod.stake, maxAllowedUsd);
            const maxPayoutUsd = newStakeUsd * (targetStrategy.maxPayoutUsd || 0) / (targetStrategy.stakeUsd || 1);
            const riskPct = (newStakeUsd / accountValue) * 100;
            
            updateEventStake(targetStrategy.id, {
              stakeUsd: newStakeUsd,
              maxPayoutUsd,
              maxLossUsd: newStakeUsd,
              riskPercent: riskPct,
              overrideRiskCap: newStakeUsd > (accountValue * 0.03),
              requestedStakeUsd: mod.stake,
            });
            
            const blossomResponse: Message = {
              id: `modify-event-${Date.now()}`,
              text: `Got it. I've updated the stake on your ${targetStrategy.eventLabel || 'event'} position to $${newStakeUsd.toLocaleString()}.`,
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            };
            setMessages(prev => [...prev, blossomResponse]);
            setIsTyping(false);
            return;
          }
        } else if (parsed.intent === 'closeEventPosition' && parsed.positionModification) {
          // Handle event position close
          const mod = parsed.positionModification;
          
          // Find matching event position
          let targetStrategy = null;
          if (mod.eventKey) {
            const matchingEvents = strategies.filter(s => 
              s.instrumentType === 'event' && 
              (s.status === 'executed' || s.status === 'executing') && 
              !s.isClosed &&
              s.eventKey === mod.eventKey
            );
            targetStrategy = matchingEvents.length > 0 ? matchingEvents[matchingEvents.length - 1] : null;
          } else {
            const allEvents = strategies.filter(s => 
              s.instrumentType === 'event' && 
              (s.status === 'executed' || s.status === 'executing') && 
              !s.isClosed
            );
            targetStrategy = allEvents.length > 0 ? allEvents[allEvents.length - 1] : null;
          }
          
          if (!targetStrategy) {
            const errorMessage: Message = {
              id: `error-${Date.now()}`,
              text: "I couldn't find an open event position to close. Try specifying the event name (e.g. 'close my Fed cuts event').",
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            };
            setMessages(prev => [...prev, errorMessage]);
            setIsTyping(false);
            return;
          }
          
          // Close the event position
          closeEventStrategy(targetStrategy.id);
          
          const blossomResponse: Message = {
            id: `close-event-${Date.now()}`,
            text: `Done. I've closed your ${targetStrategy.eventLabel || 'event'} position and realized PnL in the sim wallet.`,
            isUser: false,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          };
          setMessages(prev => [...prev, blossomResponse]);
          setIsTyping(false);
          return;
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
            const blossomResponse: Message = {
              id: `hedge-${Date.now()}`,
              text: `You're already flat on ${baseAsset}. No hedge needed.`,
              isUser: false,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            };
            setMessages(prev => [...prev, blossomResponse]);
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
        
        const blossomResponse: Message = {
          id: `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          text: generateBlossomResponse(parsed, userText),
          isUser: false,
          timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          strategy: strategy,
          strategyId: strategyId,
          defiProposalId: defiProposalId,
        };
        // Always append - never replace
        setMessages(prev => [...prev, blossomResponse]);
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
    <div className="flex flex-col h-full min-h-0">
      <div 
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto min-h-0 px-6 py-3"
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

