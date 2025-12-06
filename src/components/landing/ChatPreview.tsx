/**
 * Chat Preview Component
 * Miniature chat UI preview cycling through Perps, DeFi, and Prediction Markets scenarios
 */

import { useEffect, useState } from 'react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
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
      "Great. I'll size your position at 3% account risk, scan perp venues for best liquidity, and place TP/SL with a safe liquidation buffer.",
  },
  {
    id: 'defi',
    label: 'DeFi',
    userMessage: 'Park half my idle USDC into the safest yield on Kamino.',
    blossomMessage:
      "Allocating 50% of idle USDC into a conservative Kamino vault with high TVL and a stable yield profile. I'll monitor APY and rebalance if needed.",
  },
  {
    id: 'predictions',
    label: 'Prediction Markets',
    userMessage: 'Risk 2% of my account on the highest-volume BTC ETF prediction market.',
    blossomMessage:
      'Routing 2% of account equity into the most liquid BTC ETF approval market, checking spreads and max payout before placing your position.',
  },
];

export function ChatPreview() {
  const [index, setIndex] = useState(0);
  const scenario = SCENARIOS[index];

  useEffect(() => {
    const id = setInterval(
      () => setIndex((prev) => (prev + 1) % SCENARIOS.length),
      7500
    );
    return () => clearInterval(id);
  }, []);

  return (
    <Card className="relative max-w-md w-full mx-auto rounded-2xl border border-[#FFD6E6] bg-white/90 shadow-xl backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <Badge className="bg-[#F25AA2] text-white border border-[#F25AA2]/30">
          {scenario.label}
        </Badge>
        <span className="text-xs text-gray-400">Preview only</span>
      </div>

      {/* Getting started hint */}
      <div className="mb-4 rounded-xl bg-white/80 backdrop-blur-sm px-3 py-2 text-[11px] text-[#666666] border border-[#E5E5E5]/50">
        <p className="font-medium text-[#111111] mb-1">
          Getting started with Blossom
        </p>
        <ul className="list-disc list-inside space-y-0.5">
          <li>Open a perp trade with defined risk.</li>
          <li>Park idle stablecoins into DeFi yield.</li>
          <li>Express views via prediction markets.</li>
        </ul>
      </div>

      {/* Chat bubbles */}
      <div className="space-y-3">
        {/* User bubble (right) */}
        <div className="flex justify-end">
          <div className="max-w-[80%]">
            <div className="flex justify-end mb-1">
              <span className="text-[11px] text-gray-400">You</span>
            </div>
            <div className="rounded-2xl rounded-br-sm bg-gradient-to-br from-[#F25AA2] to-[#FF7EB3] px-3 py-2 text-sm text-white shadow-sm">
              {scenario.userMessage}
            </div>
          </div>
        </div>

        {/* Blossom bubble (left) */}
        <div
          key={scenario.id}
          className="flex items-start gap-2 animate-fade-in"
        >
          {/* Avatar – Blossom logo */}
          <div className="mt-1 flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-[#F25AA2]/30">
            <BlossomLogo size={16} />
          </div>
          <div className="max-w-[82%]">
            <div className="mb-1 text-[11px] text-gray-400">Blossom</div>
            <div className="rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-sm text-[#111111] shadow-sm border border-[#E5E5E5] backdrop-blur-sm" style={{
              background: 'rgba(255, 255, 255, 0.85)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
            }}>
              {scenario.blossomMessage}
            </div>
            <div className="mt-1 text-[10px] text-gray-400">Just now</div>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default ChatPreview;
