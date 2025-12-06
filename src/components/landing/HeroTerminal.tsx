/**
 * Hero Terminal Preview
 * macOS-style terminal window with cycling scenarios
 * Based on SuddenGreenCad reference design
 */

import { useState, useEffect } from 'react';

interface TerminalStep {
  text: string;
  status: 'info' | 'success' | 'warning';
}

interface TerminalScenario {
  id: string;
  prompt: string;
  steps: TerminalStep[];
}

const SCENARIOS: TerminalScenario[] = [
  {
    id: 'perps',
    prompt: 'Long ETH with 3% risk and manage liquidation',
    steps: [
      { text: 'Analyzing market structure for ETH/USD...', status: 'info' },
      { text: 'Identified bullish divergence on 4H timeframe.', status: 'success' },
      { text: 'Executing Long: 10x Leverage, 3% Risk per trade.', status: 'warning' },
      { text: 'Position Opened @ $3,450. Stop Loss set at $3,380.', status: 'success' },
    ],
  },
  {
    id: 'defi',
    prompt: 'Park half my idle USDC into safest yield on Kamino',
    steps: [
      { text: 'Scanning Kamino vaults for optimal risk-adjusted yield...', status: 'info' },
      { text: 'Selected: USDC yield vault (TVL: $12.4M, APY: 9.2%)', status: 'success' },
      { text: 'Allocating $2,000 (50% of idle USDC)', status: 'warning' },
      { text: '✓ Deposit confirmed. Tracking yield in portfolio.', status: 'success' },
    ],
  },
  {
    id: 'events',
    prompt: 'Risk 2% on highest-volume BTC ETF prediction market',
    steps: [
      { text: 'Querying Kalshi and Polymarket for BTC ETF markets...', status: 'info' },
      { text: 'Selected: BTC ETF approval by Dec 31 (Kalshi)', status: 'success' },
      { text: 'Current odds: 68% YES | Stake: $200 (2% of account)', status: 'warning' },
      { text: '✓ Position opened. Max payout: $340 if YES wins.', status: 'success' },
    ],
  },
];

export function HeroTerminal() {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [step, setStep] = useState(0);

  const currentScenario = SCENARIOS[scenarioIndex];

  useEffect(() => {
    // Cycle through steps
    const stepTimer = setInterval(() => {
      setStep((prev) => {
        if (prev < currentScenario.steps.length - 1) {
          return prev + 1;
        } else {
          // Move to next scenario after showing all steps
          setTimeout(() => {
            setScenarioIndex((prev) => (prev + 1) % SCENARIOS.length);
            setStep(0);
          }, 2000); // Pause before next scenario
          return prev;
        }
      });
    }, 2500); // Show each step for 2.5s

    return () => clearInterval(stepTimer);
  }, [currentScenario.steps.length, scenarioIndex]);

  // Reset step when scenario changes
  useEffect(() => {
    setStep(0);
  }, [scenarioIndex]);

  return (
    <div
      className="w-full rounded-xl overflow-hidden border border-[#E5E5E5] bg-white/50 backdrop-blur-xl shadow-2xl"
      style={{
        boxShadow: '0 22px 55px rgba(15, 23, 42, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.05)',
      }}
    >
      {/* macOS-style title bar */}
      <div className="bg-[#FAFAFA] px-4 py-3 flex items-center gap-2 border-b border-[#E5E5E5]">
        {/* Traffic light dots */}
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500/50 border border-red-600/20" />
          <div className="w-3 h-3 rounded-full bg-yellow-500/50 border border-yellow-600/20" />
          <div className="w-3 h-3 rounded-full bg-green-500/50 border border-green-600/20" />
        </div>
        {/* Window title */}
        <div className="ml-4 text-xs text-[#666666] font-mono">blossom-agent-v2.exe</div>
      </div>

      {/* Terminal content */}
      <div className="p-6 font-mono text-sm min-h-[200px] flex flex-col gap-3 bg-white/80">
        {/* Prompt line */}
        <div className="text-[#666666] flex gap-2">
          <span className="text-[#F25AA2] font-bold">user@blossom:~$</span>
          <span className="text-[#111111]">{currentScenario.prompt}</span>
        </div>

        {/* Output steps */}
        {currentScenario.steps.map((s, i) => {
          const isVisible = i <= step;
          const colorMap = {
            success: '#16A34A', // Green
            warning: '#F59E0B', // Amber
            info: '#2563EB', // Blue
          };

          return (
            <div
              key={i}
              className="flex gap-2 transition-opacity duration-300"
              style={{
                opacity: isVisible ? 1 : 0,
                color: colorMap[s.status],
              }}
            >
              <span>{'>'}</span>
              <span>{s.text}</span>
            </div>
          );
        })}

        {/* P&L tracking (show on last step) */}
        {step === currentScenario.steps.length - 1 && (
          <div className="mt-4 border-t border-[#E5E5E5] pt-4">
            <div className="flex justify-between items-center text-xs text-[#666666] uppercase tracking-wider">
              <span>P&L Live Tracking</span>
              <span className="text-[#16A34A] font-bold animate-pulse">+1.2%</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

