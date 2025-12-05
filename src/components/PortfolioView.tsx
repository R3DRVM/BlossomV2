import { useBlossomContext } from '../context/BlossomContext';
import { mockPortfolioStats } from '../lib/mockData';

export default function PortfolioView() {
  const { account, strategies, selectedStrategyId, defiPositions } = useBlossomContext();
  
  const selectedStrategy = selectedStrategyId ? strategies.find(s => s.id === selectedStrategyId) : null;
  
  // Simple sparkline data (mock 30-day PnL)
  const sparklineData = [0, 0.5, 1.2, 0.8, 1.5, 2.1, 1.8, 2.3, 2.0, 2.5, 2.8, 3.1, 2.9, 3.2, 3.5, 3.8, 3.6, 3.9, 4.1, 3.8, 4.0, 4.2, 4.1, 4.0, 3.9, 3.7, 3.8, 4.0, 4.1, 4.1];

  const maxValue = Math.max(...sparklineData);
  const minValue = Math.min(...sparklineData);
  const range = maxValue - minValue;
  
  // Extract account values
  const { accountValue, eventExposureUsd, openPerpExposure } = account;
  
  // Derive exposure by asset from account balances + executed strategies (include closed for display)
  const executedStrategies = strategies.filter(s => s.status === 'executed' || s.status === 'closed');
  const openStrategies = strategies.filter(s => s.status === 'executed' && !s.isClosed);
  const closedStrategies = strategies.filter(s => s.status === 'closed');
  
  // Compute DeFi exposure
  const activeDefiPositions = defiPositions.filter(p => p.status === 'active');
  const totalDefiDeposits = activeDefiPositions.reduce((sum, p) => sum + (p.depositUsd ?? 0), 0);
  
  // Event markets exposure
  const totalEventExposure = eventExposureUsd ?? 0;
  
  // Perps exposure
  const perpExposure = openPerpExposure ?? 0;
  
  // Cash / residual (spot balances minus exposures)
  const spotAndCash = Math.max(
    accountValue - (perpExposure + totalDefiDeposits + totalEventExposure),
    0
  );
  
  // Total for exposure calculation
  const totalForExposure = perpExposure + totalDefiDeposits + totalEventExposure + spotAndCash || 1;
  
  // Build exposure by asset array
  const exposureByAsset = totalForExposure > 0 ? [
    {
      asset: 'USDC / Spot & Cash',
      percentage: Math.round((spotAndCash / totalForExposure) * 100),
    },
    ...(perpExposure > 0 ? [{
      asset: 'Perps',
      percentage: Math.round((perpExposure / totalForExposure) * 100),
    }] : []),
    ...(totalDefiDeposits > 0 ? [{
      asset: 'DeFi (yield)',
      percentage: Math.round((totalDefiDeposits / totalForExposure) * 100),
    }] : []),
    ...(totalEventExposure > 0 ? [{
      asset: 'Event Markets',
      percentage: Math.round((totalEventExposure / totalForExposure) * 100),
    }] : []),
  ] : [
    { asset: 'USDC', percentage: 40 },
    { asset: 'ETH', percentage: 30 },
    { asset: 'SOL', percentage: 30 },
  ];
  
  // Strategy breakdown (only count open strategies)
  const openPerpStrategies = strategies.filter(
    s => s.instrumentType !== 'event' && s.status === 'executed' && !s.isClosed
  );
  const openEventStrategies = strategies.filter(
    s => s.instrumentType === 'event' && s.status === 'executed' && !s.isClosed
  );
  
  const totalStrategyCount = openPerpStrategies.length + openEventStrategies.length + activeDefiPositions.length || 1;
  
  const strategyBreakdown = totalStrategyCount > 0 ? [
    ...(openPerpStrategies.length > 0 ? [{
      name: 'Trend-following / Perps',
      pnlShare: Math.round((openPerpStrategies.length / totalStrategyCount) * 100),
      status: 'Active' as const,
    }] : []),
    ...(openEventStrategies.length > 0 ? [{
      name: 'Event / Prediction strategies (Sim)',
      pnlShare: Math.round((openEventStrategies.length / totalStrategyCount) * 100),
      status: 'Active' as const,
    }] : []),
    ...(activeDefiPositions.length > 0 ? [{
      name: 'Yield / DeFi strategies (Sim)',
      pnlShare: Math.round((activeDefiPositions.length / totalStrategyCount) * 100),
      status: 'Active' as const,
    }] : []),
  ] : [
    { name: 'Trend-following perps', pnlShare: 45, status: 'Active' as const },
    { name: 'Funding carry', pnlShare: 30, status: 'Active' as const },
    { name: 'Hedging', pnlShare: 15, status: 'Active' as const },
    { name: 'Other', pnlShare: 10, status: 'Experimental' as const },
  ];

  return (
    <div className="h-full overflow-y-auto bg-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <p className="text-xs text-blossom-slate mb-4 max-w-2xl">
          A SIM view of how your strategies are performing over time.
        </p>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm text-gray-600">
            Blossom aggregates performance and exposure across strategies and venues.
          </p>
          {selectedStrategy && (
            <span className="text-xs text-gray-500">
              View: {selectedStrategy.market} {selectedStrategy.side.toLowerCase()} @ {selectedStrategy.riskPercent}% risk
            </span>
          )}
          {!selectedStrategy && (
            <span className="text-xs text-gray-500">View: All strategies</span>
          )}
        </div>
        {/* Row 1: Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Account Performance */}
          <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Account Performance</h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Total PnL (All Time):</span>
                <span className="font-medium text-green-600">+{account.totalPnlPct.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">30d PnL:</span>
                <span className="font-medium text-green-600">+{account.simulatedPnlPct30d.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Open Strategies:</span>
                <span className="font-medium text-gray-900">{openStrategies.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Closed Strategies:</span>
                <span className="font-medium text-gray-600">{closedStrategies.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Total Executed:</span>
                <span className="font-medium text-gray-900">{executedStrategies.length} / {strategies.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Win Rate:</span>
                <span className="font-medium text-gray-900">{mockPortfolioStats.winRate}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Avg R:R:</span>
                <span className="font-medium text-gray-900">{mockPortfolioStats.avgRR}</span>
              </div>
            </div>
          </div>

          {/* Exposure by Asset */}
          <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Exposure by Asset</h2>
            <div className="space-y-2">
              {exposureByAsset.map((item, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <div className="w-16 text-xs text-gray-600">{item.asset}</div>
                  <div className="flex-1 bg-gray-200 rounded-full h-4 overflow-hidden">
                    <div
                      className={`h-full ${
                        idx === 0 ? 'bg-blossom-pink' :
                        idx === 1 ? 'bg-blue-500' :
                        idx === 2 ? 'bg-green-500' : 'bg-gray-400'
                      }`}
                      style={{ width: `${item.percentage}%` }}
                    />
                  </div>
                  <div className="w-12 text-xs font-medium text-gray-900 text-right">{item.percentage}%</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Row 2: Wider Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* PnL Over Time */}
          <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">PnL Over Time (Mock)</h2>
            <div className="mb-4">
              <div className="h-24 bg-gray-50 rounded border border-gray-200 p-2 flex items-end gap-1">
                {sparklineData.map((value, idx) => {
                  const height = range > 0 ? ((value - minValue) / range) * 100 : 50;
                  return (
                    <div
                      key={idx}
                      className="flex-1 bg-blossom-pink rounded-t"
                      style={{ height: `${height}%` }}
                    />
                  );
                })}
              </div>
              <p className="text-xs text-gray-500 mt-2">Last 30 days (simulated)</p>
            </div>
            <ul className="space-y-1 text-sm text-gray-600">
              <li>Best day: <span className="text-green-600 font-medium">+{mockPortfolioStats.bestDay}%</span></li>
              <li>Worst day: <span className="text-red-600 font-medium">{mockPortfolioStats.worstDay}%</span></li>
              <li>Max drawdown: <span className="text-red-600 font-medium">{mockPortfolioStats.maxDrawdown}%</span></li>
            </ul>
          </div>

          {/* Strategy Breakdown */}
          <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Strategy Breakdown</h2>
            <div className="space-y-3">
              {strategyBreakdown.map((strategy, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-700">{strategy.name}</span>
                    <span className={`px-2 py-0.5 text-xs rounded-full ${
                      strategy.status === 'Active'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {strategy.status}
                    </span>
                  </div>
                  <span className="font-medium text-gray-900">{strategy.pnlShare}% of PnL</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

