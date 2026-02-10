import { useState } from 'react';
import { Strategy } from '../context/BlossomContext';
import { useBlossomContext } from '../context/BlossomContext';
import { USE_AGENT_BACKEND } from '../lib/config';
import { closeStrategy as closeStrategyApi } from '../lib/blossomApi';
import RiskBadge from './RiskBadge';

interface PositionSummaryCardProps {
  strategy: Strategy;
}

export default function PositionSummaryCard({ strategy }: PositionSummaryCardProps) {
  const { closeStrategy, updateFromBackendPortfolio, setSelectedStrategyId } = useBlossomContext();
  const [isClosing, setIsClosing] = useState(false);

  // Calculate current PnL (simulated)
  const currentPrice = strategy.entry * 1.02; // Simulate 2% gain
  const riskPct = strategy.riskPercent ?? 0;
  const pnl = strategy.side === 'Long' 
    ? ((currentPrice - strategy.entry) / strategy.entry) * riskPct * 100
    : ((strategy.entry - currentPrice) / strategy.entry) * riskPct * 100;
  const pnlUsd = (strategy.entry * riskPct / 100) * (pnl / 100);

  // Calculate leverage (simplified)
  const leverage = Math.round((strategy.takeProfit - strategy.stopLoss) / strategy.entry * 10);

  const handleClose = async () => {
    if (isClosing) return;
    
    if (USE_AGENT_BACKEND) {
      setIsClosing(true);
      try {
        const response = await closeStrategyApi({
          strategyId: strategy.id,
          type: 'perp',
        });
        updateFromBackendPortfolio(response.portfolio);
      } catch (error: any) {
        console.error('Failed to close position:', error);
        alert(`Failed to close position: ${error.message}`);
      } finally {
        setIsClosing(false);
      }
    } else {
      closeStrategy(strategy.id);
    }
  };

  return (
    <div className="card-glass p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-blossom-ink">Position Summary</h2>
        <span className="px-2 py-0.5 text-xs font-medium text-blossom-pink bg-blossom-pinkSoft border border-blossom-pink/40 rounded-full">
          {strategy.status === 'executed' ? 'Active' : strategy.status}
        </span>
      </div>

      <div className="space-y-3 text-sm mb-4">
        <div className="flex justify-between">
          <span className="text-blossom-slate">Market:</span>
          <span className="font-medium text-blossom-ink">{strategy.market}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-blossom-slate">Side:</span>
          <span className={`font-medium ${strategy.side === 'Long' ? 'text-blossom-success' : 'text-blossom-danger'}`}>
            {strategy.side}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-blossom-slate">Entry Price:</span>
          <span className="font-medium text-blossom-ink">${strategy.entry.toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-blossom-slate">Size / Leverage:</span>
          <span className="font-medium text-blossom-ink">{riskPct}% / {leverage}x</span>
        </div>
        {typeof strategy.riskPercent === 'number' && (
          <div className="flex justify-between items-center">
            <span className="text-blossom-slate">Risk:</span>
            <div className="flex items-center gap-2">
              <span className="font-medium text-blossom-ink">{strategy.riskPercent}%</span>
              <RiskBadge riskPercent={strategy.riskPercent} />
            </div>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-blossom-slate">Take Profit:</span>
          <span className="font-medium text-blossom-success">${strategy.takeProfit.toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-blossom-slate">Stop Loss:</span>
          <span className="font-medium text-blossom-danger">${strategy.stopLoss.toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-blossom-slate">Liquidation Buffer:</span>
          <span className="font-medium text-blossom-ink">~18%</span>
        </div>
        {strategy.status === 'executed' && (
          <div className="pt-2 border-t border-blossom-outline/50">
            <div className="flex justify-between">
              <span className="text-blossom-slate">Current PnL (Sim):</span>
              <span className={`font-medium ${pnl >= 0 ? 'text-blossom-success' : 'text-blossom-danger'}`}>
                {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}% (${pnlUsd >= 0 ? '+' : ''}${pnlUsd.toFixed(2)})
              </span>
            </div>
          </div>
        )}
      </div>

      {strategy.status === 'executed' && !strategy.isClosed && (
        <div className="space-y-2 pt-4 border-t border-blossom-outline/50">
          <button
            onClick={() => {
              // TODO: Implement edit TP/SL
              alert('Edit TP/SL - Coming soon');
            }}
            className="w-full px-3 py-2 text-xs font-medium text-blossom-ink bg-white border border-blossom-outline/60 rounded-lg hover:bg-blossom-pinkSoft/40 transition-colors"
          >
            Edit TP/SL
          </button>
          <button
            onClick={() => {
              // TODO: Implement change leverage
              alert('Change leverage - Coming soon');
            }}
            className="w-full px-3 py-2 text-xs font-medium text-blossom-ink bg-white border border-blossom-outline/60 rounded-lg hover:bg-blossom-pinkSoft/40 transition-colors"
          >
            Change leverage
          </button>
          <button
            onClick={() => {
              // TODO: Implement adjust size
              alert('Adjust position size - Coming soon');
            }}
            className="w-full px-3 py-2 text-xs font-medium text-blossom-ink bg-white border border-blossom-outline/60 rounded-lg hover:bg-blossom-pinkSoft/40 transition-colors"
          >
            Adjust size
          </button>
          <button
            onClick={handleClose}
            disabled={isClosing}
            className="w-full px-3 py-2 text-xs font-medium text-white bg-blossom-danger rounded-lg hover:bg-blossom-danger/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isClosing ? 'Closing...' : 'Let Blossom lock in profits'}
          </button>
          <button
            onClick={() => {
              setSelectedStrategyId(strategy.id);
              // Focus chat input to ask Blossom
            }}
            className="w-full px-3 py-2 text-xs font-medium text-blossom-pink bg-blossom-pinkSoft border border-blossom-pink/40 rounded-lg hover:bg-blossom-pinkSoft/60 transition-colors"
          >
            Ask Blossom: Optimize risk
          </button>
        </div>
      )}
    </div>
  );
}

