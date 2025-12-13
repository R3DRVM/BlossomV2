import { useState } from 'react';
import { useBlossomContext } from '../context/BlossomContext';
import { mockPortfolioStats } from '../lib/mockData';
import { computeExposureByAsset, computeExposureByType, computeOpenPositionsList } from '../lib/portfolioComputed';
import SectionHeader from './ui/SectionHeader';
import PillTabs from './ui/PillTabs';

export default function PortfolioView() {
  const { account, strategies, selectedStrategyId, defiPositions, setActiveTab } = useBlossomContext();
  const [strategyTableFilter, setStrategyTableFilter] = useState<'all' | 'perp' | 'event' | 'defi'>('all');
  
  const selectedStrategy = selectedStrategyId ? strategies.find(s => s.id === selectedStrategyId) : null;
  
  
  // Extract account values (using account directly in computeExposureByAsset)
  
  // Derive exposure by asset from account balances + executed strategies (include closed for display)
  const executedStrategies = strategies.filter(s => s.status === 'executed' || s.status === 'closed');
  const openStrategies = strategies.filter(s => s.status === 'executed' && !s.isClosed);
  const closedStrategies = strategies.filter(s => s.status === 'closed');
  
  // Compute exposure by asset using shared helper
  const exposureByAsset = computeExposureByAsset(account, strategies, defiPositions);
  const exposureByTypeData = computeExposureByType(account, strategies, defiPositions);
  const openPositions = computeOpenPositionsList(strategies, defiPositions);
  
  // Convert exposureByType to array format
  const exposureByType = [
    { type: 'Spot' as const, usdValue: exposureByTypeData.spot, percentage: Math.round((exposureByTypeData.spot / exposureByTypeData.total) * 100) },
    { type: 'Perps' as const, usdValue: exposureByTypeData.perps, percentage: Math.round((exposureByTypeData.perps / exposureByTypeData.total) * 100) },
    { type: 'DeFi' as const, usdValue: exposureByTypeData.defi, percentage: Math.round((exposureByTypeData.defi / exposureByTypeData.total) * 100) },
    { type: 'Events' as const, usdValue: exposureByTypeData.events, percentage: Math.round((exposureByTypeData.events / exposureByTypeData.total) * 100) },
  ].filter(item => item.usdValue > 0);

  const handleQuickAction = (prompt: string) => {
    setActiveTab('copilot');
    window.dispatchEvent(
      new CustomEvent('insertChatPrompt', {
        detail: { prompt },
      })
    );
  };

  const handleViewPosition = (positionId: string, positionType: 'perp' | 'event' | 'defi') => {
    setActiveTab('copilot');
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('focusRightPanelPosition', {
          detail: { positionId, positionType },
        })
      );
    }, 100);
  };

  // Generate simulated PnL data (30 days)
  const generatePnLData = () => {
    const days = 30;
    const data: { date: string; pnl: number }[] = [];
    const basePnl = account.totalPnlPct || 0;
    let currentPnl = basePnl * 0.7; // Start lower
    
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      // Add some variance
      currentPnl += (Math.random() - 0.45) * 0.5;
      if (currentPnl < 0) currentPnl = 0;
      data.push({
        date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        pnl: Math.max(0, currentPnl),
      });
    }
    return data;
  };

  const pnlData = generatePnLData();
  const maxPnL = Math.max(...pnlData.map(d => d.pnl), 1);
  
  // Get active DeFi positions for display
  const activeDefiPositions = defiPositions.filter(p => p.status === 'active');
  
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

  // Check if there are effectively no active positions
  const hasActivePositions = openStrategies.length > 0 || activeDefiPositions.length > 0;

  // Filter positions for table
  const filteredPositions = strategyTableFilter === 'all'
    ? openPositions
    : openPositions.filter(p => p.type === strategyTableFilter);

  return (
    <div className="h-full overflow-y-auto bg-transparent p-6">
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

        {/* Quick Actions */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <SectionHeader title="Quick Actions" subtitle="Common portfolio management tasks" />
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              onClick={() => handleQuickAction('Hedge my current exposure to 1% risk')}
              className="px-3 py-1.5 text-xs font-medium bg-pink-50 hover:bg-pink-100 text-pink-700 rounded-lg border border-pink-200 transition-colors"
            >
              Hedge exposure
            </button>
            <button
              onClick={() => handleQuickAction('Reduce my risk to 1% per position')}
              className="px-3 py-1.5 text-xs font-medium bg-pink-50 hover:bg-pink-100 text-pink-700 rounded-lg border border-pink-200 transition-colors"
            >
              Reduce risk to 1%
            </button>
            <button
              onClick={() => handleQuickAction('Close all my open positions')}
              className="px-3 py-1.5 text-xs font-medium bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg border border-slate-200 transition-colors"
            >
              Close all positions
            </button>
          </div>
        </div>
        {!hasActivePositions ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 shadow-sm text-center">
            <p className="text-sm text-gray-600 mb-2">No active positions yet.</p>
            <p className="text-xs text-gray-500">
              Once you confirm a trade or plan, your portfolio will populate here.
            </p>
          </div>
        ) : (
          <>
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
            <SectionHeader title="Exposure by Asset" />
            <div className="space-y-2">
              {exposureByAsset.slice(0, 8).map((item, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <div className="w-16 text-xs text-gray-600 truncate">{item.asset}</div>
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

        {/* Exposure Map: By Type */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <SectionHeader title="Exposure by Type" />
          <div className="space-y-2 mt-3">
            {exposureByType.map((item, idx) => (
              <div key={idx} className="flex items-center gap-3">
                <div className="w-20 text-xs text-gray-600">{item.type}</div>
                <div className="flex-1 bg-gray-200 rounded-full h-4 overflow-hidden">
                  <div
                    className={`h-full ${
                      item.type === 'Perps' ? 'bg-blue-500' :
                      item.type === 'DeFi' ? 'bg-green-500' :
                      item.type === 'Events' ? 'bg-purple-500' : 'bg-gray-400'
                    }`}
                    style={{ width: `${item.percentage}%` }}
                  />
                </div>
                <div className="w-16 text-xs font-medium text-gray-900 text-right">
                  ${item.usdValue.toLocaleString()}
                </div>
                <div className="w-12 text-xs text-gray-500 text-right">{item.percentage}%</div>
              </div>
            ))}
          </div>
        </div>

        {/* Row 2: Wider Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* PnL Over Time */}
          <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
            <SectionHeader title="PnL Over Time" subtitle="Simulated 30-day performance" />
            <div className="mb-4 mt-3">
              <div className="h-32 bg-gray-50 rounded border border-gray-200 p-3 relative">
                <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <polyline
                    fill="none"
                    stroke="#ec4899"
                    strokeWidth="0.5"
                    points={pnlData.map((d, i) => {
                      const x = (i / (pnlData.length - 1)) * 100;
                      const y = 100 - (d.pnl / maxPnL) * 100;
                      return `${x},${y}`;
                    }).join(' ')}
                  />
                </svg>
                <div className="absolute bottom-0 left-0 right-0 flex justify-between text-[8px] text-gray-400 px-1">
                  <span>{pnlData[0]?.date}</span>
                  <span>{pnlData[Math.floor(pnlData.length / 2)]?.date}</span>
                  <span>{pnlData[pnlData.length - 1]?.date}</span>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-2 text-center">Simulated data</p>
            </div>
            <ul className="space-y-1 text-sm text-gray-600">
              <li>Best day: <span className="text-green-600 font-medium">+{mockPortfolioStats.bestDay}%</span></li>
              <li>Worst day: <span className="text-red-600 font-medium">{mockPortfolioStats.worstDay}%</span></li>
              <li>Max drawdown: <span className="text-red-600 font-medium">{mockPortfolioStats.maxDrawdown}%</span></li>
            </ul>
          </div>

          {/* Strategy Breakdown */}
          <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
            <SectionHeader title="Strategy Breakdown" />
            <div className="space-y-3 mt-3">
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

        {/* Strategy Performance Table */}
        {openPositions.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
            <SectionHeader title="Strategy Performance" />
            <div className="mt-3">
              <PillTabs
                tabs={[
                  { id: 'all', label: 'All', count: openPositions.length },
                  { id: 'perp', label: 'Perps', count: openPositions.filter(p => p.type === 'perp').length },
                  { id: 'event', label: 'Events', count: openPositions.filter(p => p.type === 'event').length },
                  { id: 'defi', label: 'DeFi', count: openPositions.filter(p => p.type === 'defi').length },
                ]}
                activeTab={strategyTableFilter}
                onTabChange={(tab) => setStrategyTableFilter(tab as typeof strategyTableFilter)}
                className="mb-3"
              />
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 px-2 font-semibold text-gray-700">Position</th>
                      <th className="text-right py-2 px-2 font-semibold text-gray-700">Size</th>
                      <th className="text-right py-2 px-2 font-semibold text-gray-700">Risk %</th>
                      <th className="text-right py-2 px-2 font-semibold text-gray-700">PnL %</th>
                      <th className="text-right py-2 px-2 font-semibold text-gray-700">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPositions.map((pos) => {
                      const size = pos.notionalUsd || pos.stakeUsd || pos.depositUsd || 0;
                      return (
                        <tr key={pos.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-2 px-2">
                            <div className="font-medium text-gray-900">{pos.market}</div>
                            <div className="text-[10px] text-gray-500 capitalize">{pos.type}</div>
                          </td>
                          <td className="text-right py-2 px-2 text-gray-700">${size.toLocaleString()}</td>
                          <td className="text-right py-2 px-2 text-gray-700">
                            {pos.riskPercent ? `${pos.riskPercent.toFixed(1)}%` : '-'}
                          </td>
                          <td className={`text-right py-2 px-2 ${
                            (pos.pnlPct || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {(pos.pnlPct || 0) >= 0 ? '+' : ''}{(pos.pnlPct || 0).toFixed(1)}%
                          </td>
                          <td className="text-right py-2 px-2">
                            <button
                              onClick={() => handleViewPosition(pos.id, pos.type)}
                              className="text-pink-600 hover:text-pink-700 hover:underline text-[10px] font-medium"
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );
}

