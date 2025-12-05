import { useEffect, useState } from 'react';
import { useBlossomContext } from '../context/BlossomContext';
import { mockRiskMetrics, mockPositions, mockAlerts, mockRiskRules } from '../lib/mockData';

export default function RiskCenter() {
  const { account, strategies, selectedStrategyId, setSelectedStrategyId, setOnboarding, lastRiskSnapshot, setLastRiskSnapshot, setActiveTab, autoCloseProfitableStrategies, defiPositions } = useBlossomContext();
  const [delta, setDelta] = useState<{ valueDelta: number; exposureDelta: number; pnlDelta: number } | null>(null);
  const [autoCloseMessage, setAutoCloseMessage] = useState<string | null>(null);
  
  useEffect(() => {
    setOnboarding(prev => ({ ...prev, openedRiskCenter: true }));
    
    if (!lastRiskSnapshot) {
      setLastRiskSnapshot({
        accountValue: account.accountValue,
        openPerpExposure: account.openPerpExposure,
        totalPnlPct: account.totalPnlPct,
      });
      return;
    }

    const valueDelta = account.accountValue - lastRiskSnapshot.accountValue;
    const exposureDelta = account.openPerpExposure - lastRiskSnapshot.openPerpExposure;
    const pnlDelta = account.totalPnlPct - lastRiskSnapshot.totalPnlPct;

    setDelta({ valueDelta, exposureDelta, pnlDelta });

    setLastRiskSnapshot({
      accountValue: account.accountValue,
      openPerpExposure: account.openPerpExposure,
      totalPnlPct: account.totalPnlPct,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  // Compute correlation based on strategies (exclude closed)
  const executedStrategies = strategies.filter(s => 
    (s.status === 'executed' || s.status === 'executing') && !s.isClosed
  );
  
  // Compute event market metrics (only open events)
  const openEventStrategies = strategies.filter(s => 
    s.instrumentType === 'event' && s.status === 'executed' && !s.isClosed
  );
  // Use account.eventExposureUsd which is maintained by the context
  const totalEventStake = account.eventExposureUsd;
  const numEventPositions = openEventStrategies.length;
  const largestEventStake = openEventStrategies.length > 0
    ? Math.max(...openEventStrategies.map(s => s.stakeUsd || 0))
    : 0;
  const eventConcentrationPct = account.accountValue > 0 && largestEventStake > 0
    ? (largestEventStake / account.accountValue) * 100
    : 0;
  const marketGroups = executedStrategies.reduce((acc, s) => {
    const key = `${s.market}-${s.side}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const maxGroupSize = Math.max(...Object.values(marketGroups), 0);
  const correlation = maxGroupSize > 2 ? 'High' : maxGroupSize > 1 ? 'Medium' : 'Low';
  
  // Count strategies by status
  const statusCounts = strategies.reduce((acc, s) => {
    acc[s.status] = (acc[s.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  // Compute DeFi aggregates
  const activeDefiPositions = defiPositions.filter(p => p.status === 'active');
  const totalDefiDeposits = activeDefiPositions.reduce((sum, p) => sum + p.depositUsd, 0);
  const maxSingleProtocolExposure = activeDefiPositions.length > 0
    ? Math.max(...activeDefiPositions.map(p => p.depositUsd))
    : 0;
  
  const handleAutoClose = () => {
    const closedCount = autoCloseProfitableStrategies();
    if (closedCount > 0) {
      setAutoCloseMessage(`Closed ${closedCount} profitable strateg${closedCount !== 1 ? 'ies' : 'y'} in SIM.`);
      setTimeout(() => setAutoCloseMessage(null), 5000);
    }
  };
  
  const marginUsed = Math.round((account.openPerpExposure / account.accountValue) * 100);
  const availableMargin = 100 - marginUsed;

  const selectedStrategy = selectedStrategyId ? strategies.find(s => s.id === selectedStrategyId) : null;

  return (
    <div className="h-full overflow-y-auto bg-gray-100 p-6">
      <div className="max-w-7xl mx-auto">
        <p className="text-xs text-blossom-slate mb-4 max-w-2xl">
          Blossom turns your Copilot commands into a risk profile here.
        </p>
        <p className="text-sm text-gray-600 mb-2">
          Blossom monitors account-level risk, liquidation buffers, volatility, and correlation in real time.
        </p>
        <p className="text-sm text-gray-600 mt-1 mb-6">
          Want to adjust this profile?{' '}
          <button
            type="button"
            className="text-blossom-pink underline hover:text-blossom-pink/80"
            onClick={() => setActiveTab('copilot')}
          >
            Ask the Copilot to rebalance →
          </button>
        </p>
        
        {/* What changed banner */}
        {delta && (Math.abs(delta.valueDelta) > 1 || Math.abs(delta.pnlDelta) > 0.01 || Math.abs(delta.exposureDelta) > 1) && (
          <div className="mb-3 rounded-lg border border-blue-100 bg-blue-50 px-4 py-2 text-xs text-blue-900">
            <span className="font-medium">Since your last visit:</span>
            <ul className="mt-1 list-disc pl-4 space-y-0.5">
              <li>Account value: {delta.valueDelta >= 0 ? '+' : '-'}${Math.abs(delta.valueDelta).toFixed(2)}</li>
              <li>Open perp exposure: {delta.exposureDelta >= 0 ? '+' : '-'}${Math.abs(delta.exposureDelta).toFixed(2)}</li>
              <li>Total PnL: {delta.pnlDelta >= 0 ? '+' : '-'}{Math.abs(delta.pnlDelta).toFixed(2)}%</li>
            </ul>
          </div>
        )}
        
        {/* Strategy filter */}
        <div className="mb-3 flex items-center gap-2 text-sm">
          <span className="text-gray-600">View metrics for:</span>
          <select
            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-sm"
            value={selectedStrategyId || 'all'}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedStrategyId(val === 'all' ? null : val);
            }}
          >
            <option value="all">All strategies</option>
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.market} · {s.side.toUpperCase()} · {s.riskPercent}%
              </option>
            ))}
          </select>
        </div>
        
        {selectedStrategy && (
          <div className="mb-3 text-xs text-gray-600">
            Metrics focused on: {selectedStrategy.market} {selectedStrategy.side.toLowerCase()} @ {selectedStrategy.riskPercent}% risk.
          </div>
        )}
        <div className="lg:grid lg:grid-cols-3 lg:gap-4 space-y-4 lg:space-y-0">
          {/* Left side - 2 columns wide */}
          <div className="lg:col-span-2 space-y-4">
            {/* Account Overview */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Account Overview</h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Account Value:</span>
                  <span className="font-medium text-gray-900">${account.accountValue.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Open Perp Exposure:</span>
                  <span className="font-medium text-gray-900">${account.openPerpExposure.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Margin Used:</span>
                  <span className="font-medium text-gray-900">{marginUsed}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Available Margin:</span>
                  <span className="font-medium text-green-600">{availableMargin}%</span>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <span className="px-2 py-1 text-xs font-medium text-blossom-pink bg-blossom-pinkSoft border border-blossom-pink/40 rounded-full">
                    Mode: SIM
                  </span>
                </div>
              </div>
            </div>

            {/* Risk Metrics */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Risk Metrics</h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Max Drawdown (30d):</span>
                  <span className="font-medium text-red-600">{mockRiskMetrics.maxDrawdown30d}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">24h VaR:</span>
                  <span className="font-medium text-gray-900">{mockRiskMetrics.var24h}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Volatility Regime:</span>
                  <span className="font-medium text-yellow-600">{mockRiskMetrics.volatilityRegime}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Cross-Position Correlation:</span>
                  <span className={`font-medium ${
                    correlation === 'High' ? 'text-red-600' : correlation === 'Medium' ? 'text-yellow-600' : 'text-green-600'
                  }`}>
                    {correlation}
                  </span>
                </div>
              </div>
            </div>
            
            {/* Strategy Status Summary */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Strategy Status</h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Active Strategies:</span>
                  <span className="font-medium text-gray-900">{executedStrategies.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Draft:</span>
                  <span className="font-medium text-gray-600">{statusCounts.draft || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Queued:</span>
                  <span className="font-medium text-yellow-600">{statusCounts.queued || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Executing:</span>
                  <span className="font-medium text-blue-600">{statusCounts.executing || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Executed:</span>
                  <span className="font-medium text-green-600">{statusCounts.executed || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Closed:</span>
                  <span className="font-medium text-gray-600">{statusCounts.closed || 0}</span>
                </div>
              </div>
            </div>

            {/* DeFi Exposure */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">DeFi Exposure</h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Total DeFi deposits:</span>
                  <span className="font-medium text-gray-900">${totalDefiDeposits.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Active DeFi positions:</span>
                  <span className="font-medium text-gray-900">{activeDefiPositions.length}</span>
                </div>
                {maxSingleProtocolExposure > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Max single-protocol exposure:</span>
                    <span className="font-medium text-gray-900">${maxSingleProtocolExposure.toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Event Markets Exposure */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Event Markets Exposure</h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Total event stake:</span>
                  <span className="font-medium text-gray-900">${totalEventStake.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Open event positions:</span>
                  <span className="font-medium text-gray-900">{numEventPositions}</span>
                </div>
                {eventConcentrationPct > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Largest single event:</span>
                    <span className="font-medium text-gray-900">{eventConcentrationPct.toFixed(1)}% of account</span>
                  </div>
                )}
              </div>
            </div>

            {/* Liquidation Watchlist */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Liquidation Watchlist</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 text-gray-600 font-medium">Market</th>
                      <th className="text-left py-2 text-gray-600 font-medium">Side</th>
                      <th className="text-left py-2 text-gray-600 font-medium">Liq Buffer</th>
                      <th className="text-left py-2 text-gray-600 font-medium">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mockPositions.map((pos, idx) => (
                      <tr key={idx} className="border-b border-gray-100 last:border-0">
                        <td className="py-2 text-gray-900">{pos.market}</td>
                        <td className={`py-2 font-medium ${
                          pos.side === 'Long' ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {pos.side}
                        </td>
                        <td className="py-2 text-gray-900">{pos.liqBuffer}%</td>
                        <td className="py-2">
                          <span className={`px-2 py-0.5 text-xs rounded-full ${
                            pos.note === 'Healthy' 
                              ? 'bg-green-100 text-green-700' 
                              : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {pos.note}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Right side - 1 column wide */}
          <div className="space-y-4">
            {/* Recent Alerts */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Recent Alerts</h2>
              <div className="space-y-3">
                {mockAlerts.map((alert, idx) => (
                  <div key={idx} className="text-sm">
                    <div className="flex items-start gap-2">
                      <span className="text-xs text-gray-500 font-mono">{alert.time}</span>
                      <span className={`px-2 py-0.5 text-xs rounded-full ${
                        alert.type === 'warning' 
                          ? 'bg-yellow-100 text-yellow-700' 
                          : 'bg-blue-100 text-blue-700'
                      }`}>
                        {alert.type === 'warning' ? 'Warning' : 'Info'}
                      </span>
                    </div>
                    <p className="text-gray-700 mt-1 ml-12">{alert.message}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Risk Rules */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Risk Rules (Example)</h2>
              <ul className="space-y-2 text-sm text-gray-700">
                {mockRiskRules.map((rule, idx) => (
                  <li key={idx} className="flex items-start">
                    <span className="mr-2 mt-0.5">✓</span>
                    <span>{rule}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Agent Activity */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Agent Activity (Mock)</h2>
              <div className="space-y-2 text-sm text-gray-700 mb-4">
                {autoCloseMessage ? (
                  <div className="rounded-md bg-green-50 px-3 py-2 text-green-800 border border-green-200">
                    {autoCloseMessage}
                  </div>
                ) : (
                  <>
                    <div className="flex items-start">
                      <span className="mr-2 mt-0.5">•</span>
                      <span>Risk Agent adjusted SL range on SOL-PERP due to volatility.</span>
                    </div>
                    <div className="flex items-start">
                      <span className="mr-2 mt-0.5">•</span>
                      <span>Execution Agent queued hedge on BTC-PERP after correlation alert.</span>
                    </div>
                    <div className="flex items-start">
                      <span className="mr-2 mt-0.5">•</span>
                      <span>Strategy Agent suggested reducing exposure in highly correlated pairs.</span>
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={handleAutoClose}
                className="w-full px-4 py-2 text-sm font-medium text-blossom-pink bg-blossom-pinkSoft border border-blossom-pink/40 rounded-lg hover:bg-blossom-pinkSoft/80 transition-colors"
              >
                Let Blossom lock in profits
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

