/**
 * Chat Preview Component
 * Miniature version of the real chat UI, cycling through Perps, DeFi, and Prediction Markets scenarios
 */

import { useState, useEffect } from 'react';
import { BlossomLogo } from '../BlossomLogo';

type Role = 'user' | 'blossom';

interface ChatMessage {
  role: Role;
  text: string;
}

interface ChatScenario {
  id: string;
  label: string;
  messages: ChatMessage[];
}

const SCENARIOS: ChatScenario[] = [
  {
    id: 'perps',
    label: 'Perps',
    messages: [
      {
        role: 'user',
        text: 'Long ETH with 3% risk and manage liquidation for me.',
      },
      {
        role: 'blossom',
        text: "I'll route your order to the venue with the best liquidity, size the position to 3% account risk, and manage liquidation with dynamic stop-losses and take-profit targets.",
      },
    ],
  },
  {
    id: 'defi',
    label: 'DeFi',
    messages: [
      {
        role: 'user',
        text: 'Park half my idle USDC into the safest yield on Kamino.',
      },
      {
        role: 'blossom',
        text: "Scanning Kamino USDC vaults for risk-adjusted yield… Selected a conservative, high-TVL vault and allocating 50% of idle USDC. I'll track APY and risk for you.",
      },
    ],
  },
  {
    id: 'prediction',
    label: 'Prediction Markets',
    messages: [
      {
        role: 'user',
        text: 'Risk 2% of my account on the highest-volume BTC ETF prediction market.',
      },
      {
        role: 'blossom',
        text: "Checking Kalshi and Polymarket for BTC ETF markets… Found the highest-volume market and staking 2% of your account notional. I'll monitor odds and P&L in your dashboard.",
      },
    ],
  },
];

export function ChatPreview() {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [showUserMessage, setShowUserMessage] = useState(true);
  const [showTyping, setShowTyping] = useState(false);
  const [showBlossomMessage, setShowBlossomMessage] = useState(false);

  const currentScenario = SCENARIOS[scenarioIndex];
  const userMessage = currentScenario.messages.find(m => m.role === 'user');
  const blossomMessage = currentScenario.messages.find(m => m.role === 'blossom');

  // Cycle through scenarios every ~7 seconds
  useEffect(() => {
    const scenarioTimer = setInterval(() => {
      setScenarioIndex((prev) => (prev + 1) % SCENARIOS.length);
      setShowUserMessage(false);
      setShowBlossomMessage(false);
      setShowTyping(false);
    }, 7000);

    return () => clearInterval(scenarioTimer);
  }, []);

  // Reset and animate messages when scenario changes
  useEffect(() => {
    setShowUserMessage(false);
    setShowBlossomMessage(false);
    setShowTyping(false);

    // Show user message immediately
    const userTimer = setTimeout(() => {
      setShowUserMessage(true);
    }, 200);

    // Show typing indicator after user message
    const typingTimer = setTimeout(() => {
      setShowTyping(true);
    }, 1200);

    // Show blossom message after typing
    const blossomTimer = setTimeout(() => {
      setShowTyping(false);
      setShowBlossomMessage(true);
    }, 2800);

    return () => {
      clearTimeout(userTimer);
      clearTimeout(typingTimer);
      clearTimeout(blossomTimer);
    };
  }, [scenarioIndex]);

  return (
    <div className="w-full max-w-xl mx-auto bg-white rounded-lg shadow-lg border border-[#E5E5E5] overflow-hidden" style={{ height: '380px' }}>
      {/* Header bar - matching real chat */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#E5E5E5]/50 bg-white/90 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-[#F25AA2]/30">
            <BlossomLogo size={14} />
          </div>
          <span className="text-sm font-medium text-[#111111]">Blossom SIM</span>
        </div>
        <div className="ml-auto">
          <div className="w-2 h-2 rounded-full bg-green-500" />
        </div>
      </div>

      {/* Chat messages area - matching real chat layout */}
      <div className="flex-1 overflow-y-auto px-4 py-4" style={{ height: 'calc(380px - 48px)' }}>
        <div className="max-w-full">
          {/* User message */}
          {showUserMessage && userMessage && (
            <div className="flex gap-3 mb-4 flex-row-reverse animate-fade-in">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-lg bg-[#F25AA2]">
                  👤
                </div>
              </div>
              <div className="flex flex-col items-end max-w-[70%]">
                <div className="text-sm font-medium text-gray-600 mb-1">You</div>
                <div className="rounded-3xl px-4 py-3 bg-gradient-to-br from-[#F25AA2] to-[#FF5A96] text-white shadow-sm">
                  <div className="whitespace-pre-wrap text-sm">{userMessage.text}</div>
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  {new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </div>
              </div>
            </div>
          )}

          {/* Typing indicator */}
          {showTyping && (
            <div className="flex gap-3 mb-4 flex-row animate-fade-in">
              <div className="flex-shrink-0">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-[#F25AA2]/30">
                  <BlossomLogo size={20} />
                </div>
              </div>
              <div className="flex flex-col items-start max-w-[70%]">
                <div className="text-sm font-medium text-gray-600 mb-1">Blossom</div>
                <div className="rounded-3xl px-4 py-3 bg-white text-[#111111] shadow-sm border border-[#E5E5E5] backdrop-blur-sm" style={{
                  background: 'rgba(255, 255, 255, 0.85)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  border: '1px solid rgba(229, 231, 235, 0.5)',
                }}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[#666666]">Blossom is typing</span>
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#F25AA2] opacity-60 animate-pulse" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-[#F25AA2] opacity-60 animate-pulse" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-[#F25AA2] opacity-60 animate-pulse" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Blossom message */}
          {showBlossomMessage && blossomMessage && (
            <div className="flex gap-3 mb-4 flex-row animate-fade-in">
              <div className="flex-shrink-0">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-[#F25AA2]/30">
                  <BlossomLogo size={20} />
                </div>
              </div>
              <div className="flex flex-col items-start max-w-[70%]">
                <div className="text-sm font-medium text-gray-600 mb-1">Blossom</div>
                <div className="rounded-3xl px-4 py-3 bg-white text-[#111111] shadow-sm border border-[#E5E5E5] backdrop-blur-sm" style={{
                  background: 'rgba(255, 255, 255, 0.85)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  border: '1px solid rgba(229, 231, 235, 0.5)',
                }}>
                  <div className="whitespace-pre-wrap text-sm">{blossomMessage.text}</div>
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  {new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Scenario label chip - positioned at top-right */}
      <div className="absolute top-2 right-4 px-3 py-1 bg-[#F25AA2] text-white text-xs font-medium rounded-full shadow-sm">
        {currentScenario.label}
      </div>
    </div>
  );
}
