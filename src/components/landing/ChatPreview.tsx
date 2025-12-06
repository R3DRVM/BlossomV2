/**
 * Chat Preview Component
 * Simplified chat-style preview cycling through Perps, DeFi, and Prediction Markets scenarios
 */

import { useState, useEffect } from 'react';

interface ChatScenario {
  id: string;
  label: string;
  user: string;
  blossom: string[];
}

const SCENARIOS: ChatScenario[] = [
  {
    id: 'perps',
    label: 'Perps',
    user: 'Long ETH with 3% risk and manage liquidation for me.',
    blossom: [
      'Analyzing ETH/USDT perps across supported venues…',
      'Found best liquidity and spread on Hyperliquid.',
      'Opening long with 3% account risk, TP at $3,450 and SL at $3,100.',
    ],
  },
  {
    id: 'defi',
    label: 'DeFi',
    user: 'Park half my idle REDACTED into the safest yield on Kamino.',
    blossom: [
      'Scanning Kamino REDACTED strategies for risk-adjusted yield…',
      'Selected conservative vault with high TVL and low volatility.',
      'Allocating 50% of idle REDACTED and tracking yield in your portfolio.',
    ],
  },
  {
    id: 'prediction',
    label: 'Prediction Markets',
    user: 'Risk 2% of my account on the highest-volume BTC ETF prediction market.',
    blossom: [
      'Querying Kalshi and Polymarket for BTC ETF markets…',
      'Selected highest-volume BTC ETF approval market with 68% current odds.',
      'Staking 2% of account notional. Position live and tracked in your Risk Center.',
    ],
  },
];

export function ChatPreview() {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [showTyping, setShowTyping] = useState(false);
  const [blossomMessageIndex, setBlossomMessageIndex] = useState(0);
  const [showBlossomMessage, setShowBlossomMessage] = useState(false);

  const currentScenario = SCENARIOS[scenarioIndex];

  // Cycle through scenarios every ~7 seconds
  useEffect(() => {
    const scenarioTimer = setInterval(() => {
      setScenarioIndex((prev) => (prev + 1) % SCENARIOS.length);
      setShowBlossomMessage(false);
      setBlossomMessageIndex(0);
    }, 7000);

    return () => clearInterval(scenarioTimer);
  }, []);

  // Reset message state when scenario changes
  useEffect(() => {
    setShowBlossomMessage(false);
    setBlossomMessageIndex(0);
    setShowTyping(true);

    // Show typing indicator for 1.5s, then show first message
    const typingTimer = setTimeout(() => {
      setShowTyping(false);
      setShowBlossomMessage(true);
      setBlossomMessageIndex(0);
    }, 1500);

    return () => clearTimeout(typingTimer);
  }, [scenarioIndex]);

  // Cycle through blossom messages
  useEffect(() => {
    if (!showBlossomMessage || blossomMessageIndex >= currentScenario.blossom.length - 1) {
      return;
    }

    const messageTimer = setTimeout(() => {
      setBlossomMessageIndex((prev) => prev + 1);
    }, 2000);

    return () => clearTimeout(messageTimer);
  }, [showBlossomMessage, blossomMessageIndex, currentScenario.blossom.length]);

  return (
    <div className="w-full max-w-xl mx-auto bg-white rounded-2xl shadow-xl border border-[#FFD6E6] p-4 md:p-5 relative">
      {/* Scenario label chip */}
      <div className="absolute -top-3 left-4 px-3 py-1 bg-[#F25AA2] text-white text-xs font-medium rounded-full shadow-sm">
        {currentScenario.label}
      </div>

      {/* Chat content */}
      <div className="space-y-3 mt-2">
        {/* User message bubble - right aligned */}
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-white border border-[#E5E5E5] px-3 py-2 text-sm text-[#111111]">
            {currentScenario.user}
          </div>
        </div>

        {/* Blossom reply - left aligned */}
        <div className="flex justify-start">
          {showTyping ? (
            // Typing indicator
            <div className="max-w-[80%] rounded-2xl rounded-bl-sm bg-[#FFD6E6] border border-[#FFB6D9] px-3 py-2 text-sm">
              <div className="flex gap-1 items-center">
                <span className="text-[#F25AA2]">Blossom</span>
                <span className="text-[#666666] ml-2">is typing</span>
                <div className="flex gap-1 ml-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#F25AA2] opacity-60 animate-pulse" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#F25AA2] opacity-60 animate-pulse" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#F25AA2] opacity-60 animate-pulse" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          ) : showBlossomMessage ? (
            // Show blossom messages one by one
            <div className="max-w-[80%] space-y-2">
              {currentScenario.blossom.slice(0, blossomMessageIndex + 1).map((message, idx) => (
                <div
                  key={idx}
                  className="rounded-2xl rounded-bl-sm bg-[#FFD6E6] border border-[#FFB6D9] px-3 py-2 text-sm text-[#111111]"
                  style={{
                    animation: idx === blossomMessageIndex ? 'fadeIn 0.3s ease-in' : 'none',
                  }}
                >
                  {message}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

