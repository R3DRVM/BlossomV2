import { Strategy, DefiPosition } from '../../context/BlossomContext';
import RiskBadge from '../RiskBadge';

export type ExecutionMode = 'auto' | 'confirm' | 'manual';

interface ExecutionPlanCardProps {
  strategy?: Strategy;
  defiPosition?: DefiPosition;
  executionMode: ExecutionMode;
  venue?: 'hyperliquid' | 'event_demo';
  onInsertPrompt?: (text: string) => void;
}

/**
 * ExecutionPlanCard is now read-only - execution details moved to chat plan card
 * This component is kept for backward compatibility but should not be used for new plans
 * All execution happens via chat plan "Confirm & Queue" button in MessageBubble
 */
export default function ExecutionPlanCard({
  strategy,
  defiPosition,
  executionMode: _executionMode,
  venue: _venue = 'hyperliquid',
  onInsertPrompt: _onInsertPrompt,
}: ExecutionPlanCardProps) {
  const planType = strategy?.instrumentType || (defiPosition ? 'defi' : null);
  if (!planType) return null;

  return (
    <div className="mt-2 w-full max-w-md bg-white rounded-lg border border-slate-200 shadow-sm transition-all">
      {/* Header */}
      <div className="px-3 py-2 border-b border-slate-100">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-slate-900">Execution Plan (Read-only)</h4>
        </div>
      </div>

      {/* Plan Summary */}
      <div className="px-3 py-2.5 space-y-2">
        {strategy && strategy.instrumentType === 'perp' && (
          <>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Market</span>
              <span className="font-medium text-slate-900">{strategy.market}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Side</span>
              <span className={`font-medium ${strategy.side === 'Long' ? 'text-emerald-600' : 'text-rose-600'}`}>
                {strategy.side}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Size</span>
              <span className="font-medium text-slate-900">${(strategy.notionalUsd || 0).toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Leverage</span>
              <span className="font-medium text-slate-900">{strategy.leverage || 'N/A'}x</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Take Profit</span>
              <span className="font-medium text-emerald-600">${strategy.takeProfit.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Stop Loss</span>
              <span className="font-medium text-rose-600">${strategy.stopLoss.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
              <span className="text-slate-500">Risk</span>
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-slate-900">{strategy.riskPercent?.toFixed(1) || 'N/A'}%</span>
                <RiskBadge riskPercent={strategy.riskPercent} />
              </div>
            </div>
          </>
        )}

        {strategy && strategy.instrumentType === 'event' && (
          <>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Market</span>
              <span className="font-medium text-slate-900">{strategy.eventLabel || strategy.market}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Side</span>
              <span className={`font-medium ${strategy.eventSide === 'YES' ? 'text-emerald-600' : 'text-rose-600'}`}>
                {strategy.eventSide}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Stake</span>
              <span className="font-medium text-slate-900">${(strategy.stakeUsd || 0).toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
              <span className="text-slate-500">Risk</span>
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-slate-900">{strategy.riskPercent?.toFixed(1) || 'N/A'}%</span>
                <RiskBadge riskPercent={strategy.riskPercent} />
              </div>
            </div>
          </>
        )}

        {defiPosition && (
          <>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Protocol</span>
              <span className="font-medium text-slate-900">{defiPosition.protocol}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Asset</span>
              <span className="font-medium text-slate-900">{defiPosition.asset}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Deposit</span>
              <span className="font-medium text-slate-900">${defiPosition.depositUsd.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">APY</span>
              <span className="font-medium text-emerald-600">{defiPosition.apyPct}%</span>
            </div>
          </>
        )}

        <div className="pt-2 border-t border-slate-100 text-[10px] text-slate-500 italic">
          Execution details now live in chat plan card. Use "Confirm & Queue" button in chat.
        </div>
      </div>
    </div>
  );
}
