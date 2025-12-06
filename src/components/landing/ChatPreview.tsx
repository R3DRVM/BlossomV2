/**
 * Chat Preview Component
 * Miniature chat UI preview cycling through Perps, DeFi, and Prediction Markets scenarios
 */

import { useEffect, useState } from 'react';
import { Card } from '../ui/Card';
import { BlossomLogo } from '../BlossomLogo';

type ScenarioId = 'perps' | 'defi' | 'predictions';

type Phase = 'user' | 'typing' | 'assistant';

interface Scenario {
  id: ScenarioId;
  label: string;
  userMessage: string;
  blossomMessage: string;
  executionMessage: string;
}

const SCENARIOS: Scenario[] = [
  {
    id: 'perps',
    label: 'Perps',
    userMessage: 'Long ETH with 3% risk and manage liquidation for me.',
    blossomMessage: 'Opening a 3% risk long on ETH, setting take profit and stop loss to maintain a safe liquidation buffer, and tracking P&L in your portfolio.',
    executionMessage: 'Executed: Long ETH perp position opened with 3% account risk. TP and SL orders are live, and the position is now visible in your portfolio.',
  },
  {
    id: 'defi',
    label: 'DeFi',
    userMessage: 'Park half my idle USDC into the safest yield on Kamino.',
    blossomMessage: "Allocating 50% of idle USDC into a conservative Kamino vault with high TVL and a stable yield profile. I'll monitor APY and rebalance if needed.",
    executionMessage: 'Executed: 50% of idle USDC deployed — 30% into Kamino Conservative USDC vault and 20% into Kamino Stable USDC vault. Live blended APY and vault health are now tracked in your dashboard.',
  },
  {
    id: 'predictions',
    label: 'Prediction Markets',
    userMessage: 'Risk 2% of my account on the highest-volume BTC ETF prediction market.',
    blossomMessage: 'Routing 2% of account equity into the most liquid BTC ETF approval market, checking spreads and max payout before placing your position.',
    executionMessage: 'Executed: 2% of account equity staked across the top BTC ETF approval market at best available odds. Position is live and will be monitored for risk and payout.',
  },
];

export function ChatPreview() {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('user');
  const scenario = SCENARIOS[index];

  useEffect(() => {
    // Reset phase when scenario changes
    setPhase('user');

    // Phase 1: User message appears immediately (0s)
    // Phase 2: Typing indicator appears after ~1s
    const typingTimer = setTimeout(() => {
      setPhase('typing');
    }, 1000);

    // Phase 3: Blossom reply appears after ~2.5s total
    const assistantTimer = setTimeout(() => {
      setPhase('assistant');
    }, 2500);

    // Move to next scenario after ~8.5s total
    const nextScenarioTimer = setTimeout(() => {
      setIndex((prev) => (prev + 1) % SCENARIOS.length);
    }, 8500);

    return () => {
      clearTimeout(typingTimer);
      clearTimeout(assistantTimer);
      clearTimeout(nextScenarioTimer);
    };
  }, [index]);

  return (
    <Card className="w-full max-w-xl mx-auto rounded-3xl shadow-xl border border-[#FFD6E6] bg-white/95 backdrop-blur p-6 md:p-7">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="inline-flex items-center px-3 py-1 rounded-full border border-[#F9A4C8] bg-white/90 text-xs font-medium text-[#F25AA2] shadow-sm">
          {scenario.label}
        </div>
        <span className="text-xs text-gray-400">Preview only</span>
      </div>

      {/* Chat bubbles */}
      <div className="space-y-3">
        {/* User bubble (right) - shown in all phases */}
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

        {/* Typing indicator (left) - shown only in 'typing' phase */}
        {phase === 'typing' && (
          <div className="flex items-start gap-2 animate-fade-in">
            <div className="mt-1 flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-[#F25AA2]/30">
              <BlossomLogo size={16} />
            </div>
            <div className="max-w-[82%]">
              <div className="mb-1 text-[11px] text-gray-400">Blossom</div>
              <div className="rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-sm shadow-sm border border-[#E5E5E5] backdrop-blur-sm" style={{
                background: 'rgba(255, 255, 255, 0.85)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
              }}>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#F25AA2] opacity-60 animate-pulse" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#F25AA2] opacity-60 animate-pulse" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#F25AA2] opacity-60 animate-pulse" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Blossom bubbles (left) - shown only in 'assistant' phase */}
        {phase === 'assistant' && (
          <div className="space-y-3 animate-fade-in">
            {/* Main Blossom reply bubble */}
            <div className="flex items-start gap-2">
              <div className="mt-1 flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-[#F25AA2]/30">
                <BlossomLogo size={16} />
              </div>
              <div className="max-w-[82%]">
                <div className="mb-1 text-[11px] text-gray-400">Blossom</div>
                <div className="rounded-3xl rounded-bl-sm bg-white px-4 py-3 text-sm text-[#111111] shadow-sm border border-[#E5E5E5] backdrop-blur-sm" style={{
                  background: 'rgba(255, 255, 255, 0.85)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                }}>
                  {scenario.blossomMessage}
                </div>
                <div className="mt-1 text-[10px] text-gray-400">Just now</div>
              </div>
            </div>

            {/* Execution confirmation bubble */}
            <div className="flex items-start gap-2 pl-9">
              <div className="mt-1 h-6 w-6 rounded-full border border-emerald-200 bg-emerald-50 flex items-center justify-center text-[10px] font-medium text-emerald-600 shadow-sm">
                ✓
              </div>
              <div className="max-w-[75%]">
                <div className="mb-1 text-[11px] font-medium text-emerald-600">
                  Execution
                </div>
                <div className="rounded-2xl bg-emerald-50/70 border border-emerald-100 px-3 py-2 text-xs text-emerald-800 leading-snug">
                  {scenario.executionMessage}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

export default ChatPreview;
