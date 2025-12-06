/**
 * Chat Preview Component
 * Miniature version of the real chat UI, cycling through Perps, DeFi, and Prediction Markets scenarios
 */

import { useState, useEffect } from 'react';
import { BlossomLogo } from '../BlossomLogo';

type ScenarioId = 'perps' | 'defi' | 'predictions';

interface Scenario {
  id: ScenarioId;
  label: string;
  userMessage: string;
  blossomMessage: string;
}

const SCENARIOS: Scenario[] = [
  {
    id: 'perps',
    label: 'Perps',
    userMessage: 'Long ETH with 3% risk and manage liquidation for me.',
    blossomMessage:
      "I'll size this position at 3% account risk, scan perp venues for best liquidity, and place TP/SL with a safe liquidation buffer.",
  },
  {
    id: 'defi',
    label: 'DeFi',
    userMessage: 'Park half my idle REDACTED into the safest yield on Kamino.',
    blossomMessage:
      "Allocating 50% of idle REDACTED into a conservative Kamino vault with high TVL and low drawdown history. I'll monitor APY and rebalance if needed.",
  },
  {
    id: 'predictions',
    label: 'Prediction Markets',
    userMessage: 'Risk 2% of my account on the highest-volume BTC ETF prediction market.',
    blossomMessage:
      'Routing 2% of account equity into the most liquid BTC ETF approval market, checking spreads and max payout before placing the trade.',
  },
];

export function ChatPreview() {
  const [index, setIndex] = useState(0);
  const scenario = SCENARIOS[index];

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((prev) => (prev + 1) % SCENARIOS.length);
    }, 7500);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative max-w-md w-full mx-auto rounded-2xl shadow-lg border border-[#E5E5E5] bg-white p-5 md:p-6">
      {/* Scenario label */}
      <div className="flex items-center justify-between mb-3">
        <div className="px-3 py-1 bg-[#F25AA2] text-white text-xs font-medium rounded-full shadow-sm">
          {scenario.label}
        </div>
        <span className="text-xs text-gray-400">Preview only</span>
      </div>

      {/* Getting started header - simplified version */}
      <div className="mb-4 rounded-xl bg-white/80 backdrop-blur-sm px-3 py-2 text-xs border border-[#E5E5E5]/50 shadow-sm">
        <p className="font-medium text-[#111111] mb-1.5">Getting started with Blossom</p>
        <ul className="list-disc list-inside space-y-0.5 text-[#666666]">
          <li>Open a perp trade with defined risk.</li>
          <li>Park idle stablecoins into DeFi yield.</li>
          <li>Express views via prediction markets.</li>
        </ul>
      </div>

      <div className="space-y-4">
        {/* User bubble (right) - matching real chat styling */}
        <div className="flex gap-3 mb-4 flex-row-reverse">
          <div className="flex-shrink-0">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-lg bg-[#F25AA2]">
              👤
            </div>
          </div>
          <div className="flex flex-col items-end max-w-[70%]">
            <div className="text-sm font-medium text-gray-600 mb-1">You</div>
            <div className="rounded-3xl px-4 py-3 bg-gradient-to-br from-[#F25AA2] to-[#FF5A96] text-white shadow-sm">
              <div className="whitespace-pre-wrap text-sm">{scenario.userMessage}</div>
            </div>
            <div className="text-xs text-gray-400 mt-1">
              {new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </div>
          </div>
        </div>

        {/* Blossom bubble (left) - matching real chat styling */}
        <div className="flex gap-3 mb-4 flex-row">
          <div className="flex-shrink-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-[#F25AA2]/30">
              <BlossomLogo size={20} />
            </div>
          </div>
          <div className="flex flex-col items-start max-w-[70%]">
            <div className="text-sm font-medium text-gray-600 mb-1">Blossom</div>
            <div className="rounded-3xl px-4 py-3 card-glass text-[#111111]">
              <div className="whitespace-pre-wrap text-sm">{scenario.blossomMessage}</div>
            </div>
            <div className="text-xs text-gray-400 mt-1">
              Blossom • just now
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
