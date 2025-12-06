import { useState, useEffect } from 'react';
import { BlossomLogo } from './BlossomLogo';

interface PreviewScenario {
  id: string;
  userMessage: string;
  blossomResponse: string;
  strategyCard: {
    title: string;
    market: string;
    details: string[];
    pnl?: string;
  };
}

const SCENARIOS: PreviewScenario[] = [
  {
    id: 'perps',
    userMessage: 'Long ETH with 3% risk and manage liquidation for me',
    blossomResponse: 'I\'ll open a long ETH position with 3% account risk. Setting TP at $3,450 and SL at $3,100 to maintain a safe liquidation buffer.',
    strategyCard: {
      title: 'Active Strategy',
      market: 'ETH-PERP',
      details: ['Side: Long', 'Entry: $3,247', 'TP: $3,450', 'SL: $3,100'],
      pnl: '+$45.20',
    },
  },
  {
    id: 'defi',
    userMessage: 'Park half my idle USDC into the safest yield on Kamino',
    blossomResponse: 'Allocating 50% of idle USDC ($2,000) to Kamino USDC vault. This is a conservative yield strategy with high TVL and low risk.',
    strategyCard: {
      title: 'DeFi Plan',
      market: 'Kamino USDC vault',
      details: ['Protocol: Kamino', 'Deposit: $2,000', 'Est. APY: 9.2%'],
    },
  },
  {
    id: 'events',
    userMessage: 'Risk 2% of my account on the highest-volume BTC ETF market on Kalshi',
    blossomResponse: 'Selected BTC ETF approval by Dec 31 (Kalshi). Current odds: 68% YES. Staking $200 (2% of account) with max payout of $340.',
    strategyCard: {
      title: 'Event Position',
      market: 'BTC ETF approved by Dec 31',
      details: ['Side: YES', 'Stake: $200', 'Current: 68% YES', 'Source: Kalshi'],
    },
  },
];

export function MarketingAgentPreview() {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setIsVisible(false);
      setTimeout(() => {
        setScenarioIndex((prev) => (prev + 1) % SCENARIOS.length);
        setIsVisible(true);
      }, 400);
    }, 9000); // Change every 9 seconds

    return () => clearInterval(interval);
  }, []);

  const currentScenario = SCENARIOS[scenarioIndex];

  return (
    <div className="bg-white/5 border border-white/10 rounded-3xl p-4 md:p-5 backdrop-blur-2xl shadow-xl text-[11px] md:text-xs">
      {/* SIM banner */}
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/10">
        <div className="w-2 h-2 rounded-full bg-blossom-pink" />
        <span className="text-[10px] text-slate-300">SIM mode · Mock data · No live orders</span>
      </div>

      {/* Mini nav */}
      <div className="flex gap-2 mb-4">
        {['Copilot', 'Risk Center', 'Portfolio'].map((tab, idx) => (
          <button
            key={idx}
            className={`px-2 py-1 rounded text-[10px] transition-colors ${
              idx === 0
                ? 'bg-blossom-pink/20 text-white font-medium'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Main content area */}
      <div className="grid grid-cols-2 gap-3">
        {/* Left: Chat */}
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <div className="w-6 h-6 rounded-full bg-blossom-pink/20 flex items-center justify-center flex-shrink-0">
              <BlossomLogo size={14} className="opacity-80" />
            </div>
            <div
              className={`flex-1 transition-opacity duration-400 ${
                isVisible ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <div className="bg-white/10 rounded-lg p-2 text-slate-100">
                <p className="text-[10px] leading-tight">{currentScenario.blossomResponse}</p>
              </div>
            </div>
          </div>
          <div className="text-[9px] text-slate-400 pl-8">
            {currentScenario.userMessage}
          </div>
        </div>

        {/* Right: Strategy card */}
        <div
          className={`bg-white/5 border border-white/10 rounded-xl p-3 transition-opacity duration-400 ${
            isVisible ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className="text-[10px] font-semibold text-white mb-2">
            {currentScenario.strategyCard.title}
          </div>
          <div className="text-[9px] text-slate-300 mb-2">
            {currentScenario.strategyCard.market}
          </div>
          <div className="space-y-1">
            {currentScenario.strategyCard.details.map((detail, idx) => (
              <div key={idx} className="text-[9px] text-slate-400">
                {detail}
              </div>
            ))}
            {currentScenario.strategyCard.pnl && (
              <div className="text-[10px] font-medium text-blossom-success mt-2">
                {currentScenario.strategyCard.pnl}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

