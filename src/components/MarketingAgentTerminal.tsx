import { useState, useEffect } from 'react';

interface Scenario {
  id: string;
  venue: 'On-chain' | 'Event Markets';
  command: string;
  steps: string[];
  finalState: string;
  finalStateColor: string;
}

const SCENARIOS: Scenario[] = [
  {
    id: 'perps',
    venue: 'On-chain',
    command: 'Long ETH with 3% risk and manage liquidation for me',
    steps: [
      'Analyzing ETH market structure across venues…',
      'Sizing position based on 3% account risk…',
      'Setting TP/SL and liquidation buffer…',
      'Routing order to best on-chain venue…',
    ],
    finalState: 'SIM Trade Executed · Entry: $3,247 · Size: $300',
    finalStateColor: 'text-teal-400',
  },
  {
    id: 'defi',
    venue: 'On-chain',
    command: 'Park half my idle REDACTED into the safest yield on Kamino',
    steps: [
      'Scanning DeFi yields across whitelisted protocols…',
      'Filtering by risk score and TVL…',
      'Allocating 50% of idle REDACTED to Kamino vault…',
    ],
    finalState: 'SIM Allocation Complete · APY: 8.5% · Duration: Open',
    finalStateColor: 'text-teal-400',
  },
  {
    id: 'events',
    venue: 'Event Markets',
    command: 'Risk 2% of my account on the highest-volume BTC ETF market',
    steps: [
      'Fetching top markets from Kalshi & Polymarket…',
      'Selecting BTC ETF approval by Dec 31 (Kalshi, YES 68%)…',
      'Sizing stake at 2% account risk…',
    ],
    finalState: 'SIM Ticket Placed · Stake: $200 · Current: 68% YES',
    finalStateColor: 'text-teal-400',
  },
];

export function MarketingAgentTerminal() {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [showCommand, setShowCommand] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [showFinal, setShowFinal] = useState(false);

  const currentScenario = SCENARIOS[scenarioIndex];

  useEffect(() => {
    // Reset state when scenario changes
    setShowCommand(false);
    setShowSteps(false);
    setShowFinal(false);
    setStepIndex(0);

    // Show command after a brief delay
    const commandTimer = setTimeout(() => {
      setShowCommand(true);
    }, 500);

    // Start showing steps after command appears
    const stepsTimer = setTimeout(() => {
      setShowSteps(true);
    }, 1500);

    return () => {
      clearTimeout(commandTimer);
      clearTimeout(stepsTimer);
    };
  }, [scenarioIndex]);

  useEffect(() => {
    if (!showSteps) return;

    // Show steps one by one
    if (stepIndex < currentScenario.steps.length) {
      const timer = setTimeout(() => {
        setStepIndex((prev) => prev + 1);
      }, 1000);

      return () => clearTimeout(timer);
    } else if (stepIndex === currentScenario.steps.length && !showFinal) {
      // Show final state after all steps
      const timer = setTimeout(() => {
        setShowFinal(true);
      }, 800);

      return () => clearTimeout(timer);
    } else if (showFinal) {
      // Move to next scenario after showing final state
      const timer = setTimeout(() => {
        setScenarioIndex((prev) => (prev + 1) % SCENARIOS.length);
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [showSteps, stepIndex, showFinal, currentScenario.steps.length]);

  return (
    <div className="landing-card p-0 overflow-hidden">
      {/* Terminal top bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900/90 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <div className="w-3 h-3 rounded-full bg-yellow-500" />
            <div className="w-3 h-3 rounded-full bg-green-500" />
          </div>
        </div>
        <div className="text-xs font-mono text-slate-300">blossom-agent — v1.0</div>
        <div className="text-xs text-slate-400">SIM mode · {currentScenario.venue}</div>
      </div>

      {/* Terminal content */}
      <div className="p-6 bg-slate-950/95 min-h-[400px] font-mono text-sm">
        <div className="space-y-3">
          {/* Command line */}
          {showCommand && (
            <div className="opacity-0 animate-fade-in">
              <span className="text-slate-400">$ </span>
              <span className="text-slate-200">{currentScenario.command}</span>
            </div>
          )}

          {/* Steps */}
          {showSteps &&
            currentScenario.steps.slice(0, stepIndex).map((step, idx) => (
              <div
                key={idx}
                className="opacity-0 animate-fade-in text-slate-400"
                style={{ animationDelay: `${idx * 100}ms` }}
              >
                {step}
              </div>
            ))}

          {/* Final state */}
          {showFinal && (
            <div className={`opacity-0 animate-fade-in ${currentScenario.finalStateColor} font-semibold mt-4 pt-4 border-t border-slate-700/50`}>
              {currentScenario.finalState}
            </div>
          )}

          {/* Cursor blink */}
          {showSteps && stepIndex < currentScenario.steps.length && (
            <span className="inline-block w-2 h-4 bg-slate-400 animate-pulse ml-1" />
          )}
        </div>
      </div>
    </div>
  );
}

