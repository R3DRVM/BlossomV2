import { useState, useEffect } from 'react';
import { BlossomLogo } from './BlossomLogo';

interface ChatScenario {
  id: string;
  userMessage: string;
  blossomSteps: string[];
}

const SCENARIOS: ChatScenario[] = [
  {
    id: 'perps',
    userMessage: 'Long ETH with 3% risk and manage liquidation for me.',
    blossomSteps: [
      'Analyzing ETH market structure and funding.',
      'Sizing position based on 3% account risk.',
      'Placing entry on on-chain perps venue.',
      'Setting TP/SL and liquidation buffer.',
    ],
  },
  {
    id: 'defi',
    userMessage: 'Park half my idle USDC into the safest yield on Kamino.',
    blossomSteps: [
      'Scanning Kamino vaults by risk and APY.',
      'Allocating 50% of idle USDC to top-ranked vault.',
      'Tracking yield and health in your portfolio.',
    ],
  },
  {
    id: 'events',
    userMessage: 'Risk 2% of my account on the highest-volume BTC ETF prediction market.',
    blossomSteps: [
      'Finding top BTC ETF markets on Kalshi & Polymarket.',
      'Allocating 2% risk to the leading YES market.',
      'Monitoring odds and marking-to-market in your dashboard.',
    ],
  },
];

export function ChatSimulation() {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [showUserMessage, setShowUserMessage] = useState(false);
  const [userMessageComplete, setUserMessageComplete] = useState(false);
  const [visibleSteps, setVisibleSteps] = useState(0);
  const [isTyping, setIsTyping] = useState(false);

  const currentScenario = SCENARIOS[scenarioIndex];

  useEffect(() => {
    // Reset state when scenario changes
    setShowUserMessage(false);
    setUserMessageComplete(false);
    setVisibleSteps(0);
    setIsTyping(false);

    // Start typing user message
    const userTimer = setTimeout(() => {
      setShowUserMessage(true);
      setIsTyping(true);
      // Simulate typing duration
      setTimeout(() => {
        setIsTyping(false);
        setUserMessageComplete(true);
      }, currentScenario.userMessage.length * 50); // ~50ms per character
    }, 500);

    return () => clearTimeout(userTimer);
  }, [scenarioIndex, currentScenario.userMessage.length]);

  useEffect(() => {
    if (!userMessageComplete) return;

    // Show Blossom steps one by one
    if (visibleSteps < currentScenario.blossomSteps.length) {
      const timer = setTimeout(() => {
        setVisibleSteps((prev) => prev + 1);
      }, 800);

      return () => clearTimeout(timer);
    } else {
      // Move to next scenario after showing all steps
      const timer = setTimeout(() => {
        setScenarioIndex((prev) => (prev + 1) % SCENARIOS.length);
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [userMessageComplete, visibleSteps, currentScenario.blossomSteps.length]);

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-pink-100 p-4 md:p-6">
      {/* SIM mode pill */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-1.5 h-1.5 rounded-full bg-blossom-pink" />
        <span className="text-[10px] text-slate-500">SIM mode · Mock data · No live orders</span>
      </div>

      {/* Chat thread */}
      <div className="space-y-3 min-h-[300px]">
        {/* User message */}
        {showUserMessage && (
          <div className="flex justify-end">
            <div className="bg-white border border-slate-200 rounded-2xl rounded-tr-sm px-4 py-2 max-w-[80%]">
              <p className="text-sm text-slate-800">
                {currentScenario.userMessage}
                {isTyping && (
                  <span className="inline-block w-2 h-4 bg-blossom-pink ml-1 animate-pulse" />
                )}
              </p>
            </div>
          </div>
        )}

        {/* Blossom responses */}
        {userMessageComplete &&
          currentScenario.blossomSteps.slice(0, visibleSteps).map((step, idx) => (
            <div key={idx} className="flex items-start gap-2">
              <div className="w-6 h-6 rounded-full bg-blossom-pink/10 flex items-center justify-center flex-shrink-0">
                <BlossomLogo size={16} className="opacity-80" />
              </div>
              <div className="bg-pink-50 rounded-2xl rounded-tl-sm px-4 py-2 max-w-[80%]">
                <p className="text-sm text-slate-700">{step}</p>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

