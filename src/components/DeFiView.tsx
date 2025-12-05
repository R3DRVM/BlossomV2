import { useState } from 'react';
import { useBlossomContext } from '../context/BlossomContext';

export default function DeFiView() {
  const {
    createDefiPlanFromCommand,
    confirmDefiPlan,
    latestDefiProposal,
    defiPositions,
    account,
  } = useBlossomContext();

  const [commandInput, setCommandInput] = useState('');

  const handleGeneratePlan = () => {
    const command = commandInput.trim() || 'Deploy idle REDACTED into safest yield with max 5% drawdown.';
    createDefiPlanFromCommand(command);
    setCommandInput('');
  };

  const activePositions = defiPositions.filter(p => p.status === 'active');
  const idleUsdc = account.balances.find(b => b.symbol === 'REDACTED')?.balanceUsd || 0;

  return (
    <div className="h-full overflow-y-auto bg-gray-100 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">DeFi Actions (Simulated)</h1>
          <p className="text-sm text-gray-600">
            Blossom bundles yield, lending, and LPing behind a single natural-language request.
          </p>
        </div>

        {/* Command Input */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Generate DeFi Plan</h2>
          <div className="flex gap-2">
            <textarea
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              placeholder="Deploy idle REDACTED into safest yield with max 5% drawdown."
              className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
              rows={2}
            />
            <button
              onClick={handleGeneratePlan}
              className="px-4 py-2 text-sm font-medium text-white bg-purple-500 rounded-lg hover:bg-purple-600 transition-colors"
            >
              Generate Plan (Mock)
            </button>
          </div>
          <div className="mt-2 text-xs text-gray-500">
            Idle REDACTED: ${idleUsdc.toLocaleString()}
          </div>
        </div>

        {/* Proposed Plan */}
        {latestDefiProposal && latestDefiProposal.status === 'proposed' && (
          <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Proposed DeFi Plan</h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Command:</span>
                <span className="font-medium text-gray-900 max-w-md text-right">{latestDefiProposal.command}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Protocol:</span>
                <span className="font-medium text-gray-900">{latestDefiProposal.protocol}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Asset:</span>
                <span className="font-medium text-gray-900">{latestDefiProposal.asset}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Deposit:</span>
                <span className="font-medium text-gray-900">${latestDefiProposal.depositUsd.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Est. APY:</span>
                <span className="font-medium text-green-600">{latestDefiProposal.apyPct}%</span>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="text-xs font-medium text-gray-700 mb-2">Why this route?</div>
              <ul className="space-y-1 text-xs text-gray-600 list-disc pl-5">
                <li>Uses a conservative yield vault on {latestDefiProposal.protocol}.</li>
                <li>Keeps at least 50% of REDACTED in cash.</li>
                <li>Targets moderate APY with controlled risk.</li>
              </ul>
            </div>

            <button
              onClick={() => confirmDefiPlan(latestDefiProposal.id)}
              className="mt-4 w-full px-4 py-2 text-sm font-medium text-white bg-purple-500 rounded-lg hover:bg-purple-600 transition-colors"
            >
              Confirm deposit (Sim)
            </button>
          </div>
        )}

        {/* Active Positions */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Active DeFi Positions</h2>
          {activePositions.length === 0 ? (
            <p className="text-sm text-gray-500">No active DeFi positions yet.</p>
          ) : (
            <div className="space-y-3">
              {activePositions.map((position) => (
                <div key={position.id} className="border-b border-gray-100 pb-3 last:border-0 last:pb-0">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{position.protocol}</div>
                      <div className="text-xs text-gray-600 mt-1">{position.asset}</div>
                    </div>
                    <span className="px-2 py-0.5 text-xs font-medium text-green-700 bg-green-100 rounded-full">
                      Active
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs mt-2">
                    <div>
                      <span className="text-gray-600">Deposit:</span>
                      <span className="ml-1 font-medium text-gray-900">${position.depositUsd.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">APY:</span>
                      <span className="ml-1 font-medium text-green-600">{position.apyPct}%</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Created:</span>
                      <span className="ml-1 font-medium text-gray-900">{position.createdAt}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

