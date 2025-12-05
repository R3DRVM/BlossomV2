import { useState } from 'react';
import { useBlossomContext } from '../context/BlossomContext';
import { mockPositions } from '../lib/mockData';
import { PositionDetailsModal } from './PositionDetailsModal';

interface SidePanelProps {
  selectedStrategyId: string | null;
}

export default function SidePanel({ selectedStrategyId }: SidePanelProps) {
  const { strategies, setSelectedStrategyId, account, defiPositions } = useBlossomContext();
  const [modalStrategy, setModalStrategy] = useState<string | null>(null);
  const [modalDefiPosition, setModalDefiPosition] = useState<string | null>(null);
  
  // Get the selected strategy or default to most recent
  const selectedStrategy = strategies.find(s => s.id === selectedStrategyId) || strategies[0] || null;
  
  // Filter out closed strategies from openPerpExposure calculation
  const activeStrategies = strategies.filter(s => 
    (s.status === 'executed' || s.status === 'executing') && !s.isClosed
  );

  return (
    <div className="w-full lg:w-80 xl:w-96 flex-shrink-0 bg-gray-50 border-l border-gray-200 p-6 overflow-y-auto">
      <div className="space-y-6">
        {selectedStrategy && (
          <>
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-gray-900">Active Strategy</h2>
                <span className="px-2 py-0.5 text-xs font-medium text-purple-700 bg-purple-100 rounded-full">
                  AI-generated
                </span>
              </div>
              <div className="text-xs text-gray-500 mb-4">Status: {selectedStrategy.status === 'draft' ? 'Draft' : selectedStrategy.status === 'queued' ? 'Queued' : selectedStrategy.status === 'executing' ? 'Executing' : 'Executed'} (Sim)</div>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Market:</span>
                  <span className="font-medium text-gray-900">{selectedStrategy.eventLabel || selectedStrategy.eventKey || selectedStrategy.market}</span>
                </div>
                {selectedStrategy.instrumentType === 'event' && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Type:</span>
                    <span className="font-medium text-gray-600 text-xs">Event contract (Sim)</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-600">Side:</span>
                  <span className={`font-medium ${
                    (selectedStrategy.eventSide === 'YES' || selectedStrategy.side === 'Long') ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {selectedStrategy.eventSide || selectedStrategy.side}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Risk:</span>
                  <span className="font-medium text-gray-900">{selectedStrategy.riskPercent}% of account</span>
                </div>
                {selectedStrategy.instrumentType === 'event' ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Stake:</span>
                      <span className="font-medium text-gray-900">${(selectedStrategy.stakeUsd || selectedStrategy.entry).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Max Payout:</span>
                      <span className="font-medium text-green-600">${(selectedStrategy.maxPayoutUsd || selectedStrategy.takeProfit).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Max Loss:</span>
                      <span className="font-medium text-red-600">${(selectedStrategy.maxLossUsd || selectedStrategy.stopLoss).toLocaleString()}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Entry:</span>
                      <span className="font-medium text-gray-900">${selectedStrategy.entry.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Take Profit:</span>
                      <span className="font-medium text-green-600">${selectedStrategy.takeProfit.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Stop Loss:</span>
                      <span className="font-medium text-red-600">${selectedStrategy.stopLoss.toLocaleString()}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Risk Snapshot</h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Max Loss:</span>
                  <span className="font-medium text-red-600">-{selectedStrategy.riskPercent}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Liquidation Buffer:</span>
                  <span className="font-medium text-gray-900">~18%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Funding Impact:</span>
                  <span className="font-medium text-green-600">Low</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Cross-Position Correlation:</span>
                  <span className="font-medium text-green-600">Low</span>
                </div>
              </div>
            </div>
          </>
        )}

        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <div className="mb-3">
            <div className="text-xs text-gray-500 mb-2">Hyperliquid Account (Demo) • Total PnL: <span className="text-green-600 font-medium">+{account.totalPnlPct.toFixed(1)}%</span></div>
            <h2 className="text-sm font-semibold text-gray-900">Spot & Perp Exposure</h2>
          </div>
          <div className="space-y-3 mb-4">
            {account.balances.map((balance, idx) => (
              <div key={idx} className="flex justify-between text-sm">
                <span className="text-gray-600">{balance.symbol}:</span>
                <span className="font-medium text-gray-900">${balance.balanceUsd.toLocaleString()}</span>
              </div>
            ))}
            {account.openPerpExposure > 0 && (
              <div className="pt-2 border-t border-gray-100">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Open Perp Exposure:</span>
                  <span className="font-medium text-gray-900">${account.openPerpExposure.toLocaleString()}</span>
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {activeStrategies.length} active strategy{activeStrategies.length !== 1 ? 'ies' : ''}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-gray-900">Positions (Mock)</h2>
          </div>
          <div className="space-y-3">
            {mockPositions.slice(0, 2).map((pos, idx) => (
              <div key={idx} className="text-sm border-b border-gray-100 pb-3 last:border-0 last:pb-0">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-medium text-gray-900">{pos.market}</span>
                  <span className={`font-medium ${
                    pos.side === 'Long' ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {pos.side}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-gray-600">
                  <span>Size: {pos.size}</span>
                  <span>Entry: {pos.entry}</span>
                </div>
                <div className="mt-1 text-xs font-medium">
                  PnL: <span className={pos.pnl.startsWith('+') ? 'text-green-600' : 'text-red-600'}>
                    {pos.pnl}
                  </span>
                </div>
              </div>
            ))}
            </div>
          </div>

        {/* DeFi Positions */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">DeFi Positions (Sim)</h2>
          {defiPositions.filter(p => p.status === 'active').length === 0 ? (
            <p className="text-sm text-gray-500">No active DeFi positions yet. Ask the copilot to move idle USDC into yield.</p>
          ) : (
            <div className="space-y-3">
              {defiPositions.filter(p => p.status === 'active').map((position) => (
                <button
                  key={position.id}
                  onClick={() => setModalDefiPosition(position.id)}
                  className="w-full text-left border-b border-gray-100 pb-3 last:border-0 last:pb-0 hover:bg-gray-50 rounded-lg p-2 -m-2 transition-colors"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{position.protocol}</div>
                      <div className="text-xs text-gray-600 mt-1">{position.asset}</div>
                    </div>
                    <span className="px-2 py-0.5 text-xs font-medium text-green-700 bg-green-100 rounded-full">
                      Active
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                    <div>
                      <span className="text-gray-600">Deposit:</span>
                      <span className="ml-1 font-medium text-gray-900">${position.depositUsd.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">APY:</span>
                      <span className="ml-1 font-medium text-green-600">{position.apyPct}%</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Event Markets */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Event Markets (Sim)</h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Total Event Stake:</span>
              <span className="font-medium text-gray-900">${account.eventExposureUsd.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Open Event Positions:</span>
              <span className="font-medium text-gray-900">
                {strategies.filter(s => s.instrumentType === 'event' && s.status === 'executed' && !s.isClosed).length}
              </span>
            </div>
            {strategies.filter(s => s.instrumentType === 'event' && s.isClosed).length > 0 && (
              <div className="flex justify-between pt-2 border-t border-gray-100">
                <span className="text-gray-600">Settled Events:</span>
                <span className="font-medium text-gray-600">
                  {strategies.filter(s => s.instrumentType === 'event' && s.isClosed).length}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Execution Queue */}
        {strategies.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Execution Queue (Sim)</h2>
            <div className="space-y-2">
              {strategies.slice(0, 5).map((strategyItem) => {
                const isSelected = strategyItem.id === selectedStrategyId;
                const statusColors = {
                  draft: 'bg-gray-100 text-gray-600',
                  queued: 'bg-yellow-100 text-yellow-700',
                  executing: 'bg-blue-100 text-blue-700',
                  executed: 'bg-green-100 text-green-700',
                  closed: 'bg-gray-200 text-gray-600',
                };
                return (
                  <button
                    key={strategyItem.id}
                    onClick={() => {
                      setSelectedStrategyId(strategyItem.id);
                      if (strategyItem.status === 'executed' || strategyItem.isClosed) {
                        setModalStrategy(strategyItem.id);
                      }
                    }}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      isSelected
                        ? 'border-purple-500 bg-purple-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">
                          {strategyItem.market}
                        </span>
                        <span className="text-xs text-gray-400">·</span>
                        <span className={`text-sm font-medium ${
                          strategyItem.side === 'Long' ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {strategyItem.side}
                        </span>
                      </div>
                      <span className="text-xs text-gray-500">{strategyItem.createdAt}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-600">Risk: {strategyItem.riskPercent}%</span>
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                        strategyItem.isClosed 
                          ? statusColors.closed 
                          : statusColors[strategyItem.status]
                      }`}>
                        {strategyItem.isClosed 
                          ? (strategyItem.instrumentType === 'event' && strategyItem.eventOutcome 
                              ? `Closed (${strategyItem.eventOutcome === 'won' ? 'Won' : 'Lost'})` 
                              : 'Closed')
                          : strategyItem.status.charAt(0).toUpperCase() + strategyItem.status.slice(1)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">DeFi Aggregation (Coming Soon)</h2>
          <ul className="space-y-2 text-sm text-gray-600">
            <li className="flex items-start">
              <span className="mr-2">•</span>
              <span>Lending: Kamino, Jet, RootsFi</span>
            </li>
            <li className="flex items-start">
              <span className="mr-2">•</span>
              <span>Yield vaults & LP strategies</span>
            </li>
            <li className="flex items-start">
              <span className="mr-2">•</span>
              <span>Cross-chain routing</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Position Details Modal */}
      <PositionDetailsModal
        isOpen={!!modalStrategy || !!modalDefiPosition}
        onClose={() => {
          setModalStrategy(null);
          setModalDefiPosition(null);
        }}
        strategy={modalStrategy ? strategies.find(s => s.id === modalStrategy) || null : null}
        defiPosition={modalDefiPosition ? defiPositions.find(p => p.id === modalDefiPosition) || null : null}
      />
    </div>
  );
}

