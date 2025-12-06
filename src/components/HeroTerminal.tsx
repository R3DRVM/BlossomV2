/**
 * Hero Terminal Preview
 * macOS-style terminal window showing Blossom agent interactions
 * Cycles through perps, DeFi, and prediction market scenarios
 */

import { useState, useEffect } from 'react';

interface TerminalScenario {
  id: string;
  prompt: string;
  output: string[];
}

const SCENARIOS: TerminalScenario[] = [
  {
    id: 'perps',
    prompt: 'Long ETH with 3% risk and manage liquidation',
    output: [
      'Analyzing ETH/USD market conditions...',
      'Position size: $300 (3% of $10,000 account)',
      'Entry: $3,200 | TP: $3,450 | SL: $3,100',
      '✓ Position opened. Monitoring liquidation buffer.',
    ],
  },
  {
    id: 'defi',
    prompt: 'Park half my idle REDACTED into safest yield on Kamino',
    output: [
      'Scanning Kamino vaults for optimal risk-adjusted yield...',
      'Selected: REDACTED yield vault (TVL: $12.4M, APY: 9.2%)',
      'Allocating $2,000 (50% of idle REDACTED)',
      '✓ Deposit confirmed. Tracking yield in portfolio.',
    ],
  },
  {
    id: 'events',
    prompt: 'Risk 2% on highest-volume BTC ETF prediction market',
    output: [
      'Querying Kalshi and Polymarket for BTC ETF markets...',
      'Selected: BTC ETF approval by Dec 31 (Kalshi)',
      'Current odds: 68% YES | Stake: $200 (2% of account)',
      '✓ Position opened. Max payout: $340 if YES wins.',
    ],
  },
];

export function HeroTerminal() {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [showOutput, setShowOutput] = useState(false);
  const [outputLineIndex, setOutputLineIndex] = useState(0);

  const currentScenario = SCENARIOS[scenarioIndex];

  useEffect(() => {
    // Reset when scenario changes
    setShowOutput(false);
    setOutputLineIndex(0);

    // Show prompt immediately
    const promptTimer = setTimeout(() => {
      setShowOutput(true);
    }, 500);

    return () => clearTimeout(promptTimer);
  }, [scenarioIndex]);

  useEffect(() => {
    if (!showOutput) return;

    // Animate output lines one by one
    if (outputLineIndex < currentScenario.output.length) {
      const lineTimer = setTimeout(() => {
        setOutputLineIndex((prev) => prev + 1);
      }, 800);

      return () => clearTimeout(lineTimer);
    } else {
      // Move to next scenario after showing all output
      const nextTimer = setTimeout(() => {
        setScenarioIndex((prev) => (prev + 1) % SCENARIOS.length);
      }, 3000);

      return () => clearTimeout(nextTimer);
    }
  }, [showOutput, outputLineIndex, currentScenario.output.length, scenarioIndex]);

  return (
    <div
      className="bg-white overflow-hidden"
      style={{
        borderRadius: '20px',
        border: '1px solid #E5E5E5',
        boxShadow: '0 22px 55px rgba(15, 23, 42, 0.12)',
      }}
    >
      {/* macOS-style title bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#E5E5E5] bg-[#FAFAFA]">
        {/* Traffic light dots */}
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#FF5F57]" />
          <div className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
          <div className="w-3 h-3 rounded-full bg-[#28CA42]" />
        </div>
        {/* Window title */}
        <div className="flex-1 text-center">
          <span className="text-xs text-[#666666] font-medium">blossom-agent-v1.0</span>
        </div>
        {/* Spacer for symmetry */}
        <div className="w-[42px]" />
      </div>

      {/* Terminal content */}
      <div className="p-5 font-mono" style={{ fontFamily: '"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace' }}>
        <div className="space-y-1 text-sm">
          {/* Prompt line */}
          <div className="flex items-start gap-2">
            <span className="text-[#F25AA2] font-medium">user@blossom:~$</span>
            <span className="text-[#333333]">{currentScenario.prompt}</span>
          </div>

          {/* Output lines */}
          {showOutput && (
            <div className="mt-3 space-y-1">
              {currentScenario.output.slice(0, outputLineIndex + 1).map((line, idx) => {
                // Color code different types of output
                let lineColor = '#333333';
                if (line.includes('✓') || line.includes('Selected:')) {
                  lineColor = '#16A34A'; // Green for success
                } else if (line.includes('$') || line.includes('%') || line.includes('APY')) {
                  lineColor = '#2563EB'; // Blue for numbers/values
                } else if (line.includes('Analyzing') || line.includes('Scanning') || line.includes('Querying')) {
                  lineColor = '#7C3AED'; // Purple for processing
                }

                return (
                  <div key={idx} className="text-sm" style={{ color: lineColor }}>
                    {line}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

