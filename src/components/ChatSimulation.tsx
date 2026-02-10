import { useState, useEffect } from 'react';
import { BlossomLogo } from './BlossomLogo';

interface ChatScenario {
  id: string;
  userMessage: string;
  blossomResponse: string; // Single response instead of steps for cleaner UI
}

// Chat scenarios - can be easily updated here
const SCENARIOS: ChatScenario[] = [
  {
    id: 'perps',
    userMessage: 'Long ETH with 3% risk and manage liquidation for me.',
    blossomResponse: 'I\'ll open a long ETH position with 3% account risk. Setting take profit at $3,450 and stop loss at $3,100 to maintain a safe liquidation buffer. Position size: $300 notional.',
  },
  {
    id: 'defi',
    userMessage: 'Park half my idle bUSDC into the safest yield on Kamino.',
    blossomResponse: 'Allocating 50% of idle bUSDC ($2,000) to Kamino bUSDC vault. This is a conservative yield strategy with high TVL and low risk. Estimated APY: 9.2%.',
  },
  {
    id: 'events',
    userMessage: 'Risk 2% of my account on the highest-volume BTC ETF prediction market.',
    blossomResponse: 'Selected BTC ETF approval by Dec 31 (Kalshi). Current odds: 68% YES. Staking $200 (2% of account) with max payout of $340 if YES wins.',
  },
];

export function ChatSimulation() {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [showUserMessage, setShowUserMessage] = useState(false);
  const [userMessageComplete, setUserMessageComplete] = useState(false);
  const [showBlossomResponse, setShowBlossomResponse] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isBlossomTyping, setIsBlossomTyping] = useState(false);

  const currentScenario = SCENARIOS[scenarioIndex];

  useEffect(() => {
    // Reset state when scenario changes
    setShowUserMessage(false);
    setUserMessageComplete(false);
    setShowBlossomResponse(false);
    setIsTyping(false);
    setIsBlossomTyping(false);

    // Start typing user message
    const userTimer = setTimeout(() => {
      setShowUserMessage(true);
      setIsTyping(true);
      // Simulate typing duration
      setTimeout(() => {
        setIsTyping(false);
        setUserMessageComplete(true);
      }, currentScenario.userMessage.length * 40); // ~40ms per character
    }, 800);

    return () => clearTimeout(userTimer);
  }, [scenarioIndex, currentScenario.userMessage.length]);

  useEffect(() => {
    if (!userMessageComplete) return;

    // Show Blossom typing indicator
    const typingTimer = setTimeout(() => {
      setIsBlossomTyping(true);
      setTimeout(() => {
        setIsBlossomTyping(false);
        setShowBlossomResponse(true);
      }, 1000); // Typing for 1 second
    }, 500);

    return () => clearTimeout(typingTimer);
  }, [userMessageComplete]);

  useEffect(() => {
    if (!showBlossomResponse) return;

    // Move to next scenario after showing response
    const nextTimer = setTimeout(() => {
      setScenarioIndex((prev) => (prev + 1) % SCENARIOS.length);
    }, 3000); // Show response for 3 seconds

    return () => clearTimeout(nextTimer);
  }, [showBlossomResponse]);

  return (
    <div className="bg-white p-5 md:p-6 relative z-20" style={{ 
      borderRadius: '20px',
      boxShadow: '0 10px 30px rgba(0, 0, 0, 0.04)',
      border: '1px solid #EDEDED',
    }}>
      {/* SIM mode info */}
      <div className="flex items-center gap-2 mb-5 pb-3 border-b border-slate-100">
        <span className="text-[10px] text-[#6B7280]">SIM mode · Mock data · No real trades</span>
      </div>

      {/* Chat thread */}
      <div className="space-y-4 min-h-[280px]">
        {/* User message */}
        {showUserMessage && (
          <div className="flex justify-end animate-fade-in">
            <div className="bg-white border border-[#EDEDED] px-4 py-2.5 max-w-[85%]" style={{
              borderRadius: '16px 16px 4px 16px',
              boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.04)',
            }}>
              <p className="text-sm text-[#333333] leading-relaxed">
                {currentScenario.userMessage}
                {isTyping && (
                  <span className="inline-block w-2 h-4 bg-[#F25AA2] ml-1.5 animate-pulse" />
                )}
              </p>
            </div>
          </div>
        )}

        {/* Blossom typing indicator */}
        {userMessageComplete && isBlossomTyping && (
          <div className="flex items-start gap-2 animate-fade-in">
            <div className="w-7 h-7 rounded-full bg-[#FFD6E6] flex items-center justify-center flex-shrink-0">
              <BlossomLogo size={18} className="opacity-90" />
            </div>
            <div className="bg-[#FFD6E6] px-4 py-2.5" style={{
              borderRadius: '4px 16px 16px 16px',
            }}>
              <div className="flex gap-1">
                <span className="w-2 h-2 rounded-full bg-[#F25AA2] animate-pulse" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-[#F25AA2] animate-pulse" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full bg-[#F25AA2] animate-pulse" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        {/* Blossom response */}
        {showBlossomResponse && (
          <div className="flex items-start gap-2 animate-fade-in">
            <div className="w-7 h-7 rounded-full bg-[#FFD6E6] flex items-center justify-center flex-shrink-0">
              <BlossomLogo size={18} className="opacity-90" />
            </div>
            <div className="bg-[#FFD6E6] px-4 py-2.5 max-w-[85%]" style={{
              borderRadius: '4px 16px 16px 16px',
              boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.04)',
            }}>
              <p className="text-sm text-[#333333] leading-relaxed">{currentScenario.blossomResponse}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
