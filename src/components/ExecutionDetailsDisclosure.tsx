import { useState } from 'react';
import { Strategy, DefiPosition } from '../context/BlossomContext';
import { ChevronDown } from 'lucide-react';
import RiskBadge from './RiskBadge';

interface ExecutionDetailsDisclosureProps {
  strategy?: Strategy;
  defiPosition?: DefiPosition;
  venue?: 'hyperliquid' | 'event_demo';
  isExecuted?: boolean;
}

export default function ExecutionDetailsDisclosure({
  strategy,
  defiPosition,
  venue = 'hyperliquid',
  isExecuted = false,
}: ExecutionDetailsDisclosureProps) {
  const [showWhyPlan, setShowWhyPlan] = useState(false);
  const [showRouteDetails, setShowRouteDetails] = useState(false);
  
  const planType = strategy?.instrumentType || (defiPosition ? 'defi' : null);
  if (!planType) return null;
  
  const hasStopLoss = strategy?.stopLoss && strategy.stopLoss > 0;
  const hasTakeProfit = strategy?.takeProfit && strategy.takeProfit > 0;

  return (
    <div className="space-y-2 pt-2 border-t border-blossom-outline/20">
      {/* Why this plan? */}
      <div>
        <button
          onClick={() => setShowWhyPlan(!showWhyPlan)}
          className="w-full flex items-center justify-between text-[10px] text-slate-500 hover:text-slate-700 transition-colors"
        >
          <span>Why this plan?</span>
          <ChevronDown className={`w-3 h-3 transition-transform ${showWhyPlan ? 'rotate-180' : ''}`} />
        </button>
        {showWhyPlan && (
          <div className="mt-1.5 pt-1.5 border-t border-slate-100 space-y-1 text-[10px] text-slate-600">
            {strategy && strategy.instrumentType === 'perp' && (
              <>
                <div>Risk basis: Sized to ~{strategy.riskPercent?.toFixed(1) || '0'}% of account based on risk setting</div>
                <div>Leverage rationale: Leverage chosen to keep liquidation buffer above ~15% (simulated)</div>
                <div>TP/SL rationale: TP/SL placed relative to entry to maintain favorable R:R (simulated)</div>
              </>
            )}
            {strategy && strategy.instrumentType === 'event' && (
              <>
                <div>Risk basis: Sized to ~{strategy.riskPercent?.toFixed(1) || '0'}% of account based on risk setting</div>
                <div>Stake rationale: Stake amount balances potential payout with risk tolerance</div>
              </>
            )}
            {defiPosition && (
              <>
                <div>Protocol selection: Chosen for highest APY within risk band</div>
                <div>Deposit sizing: Optimized for yield while maintaining liquidity</div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Route */}
      <div>
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-slate-500">Route</span>
          <span className="font-medium text-slate-900">Optimized execution (abstracted)</span>
        </div>
        <button
          onClick={() => setShowRouteDetails(!showRouteDetails)}
          className="w-full flex items-center justify-between text-[10px] text-slate-500 hover:text-slate-700 transition-colors"
        >
          <span>Details</span>
          <ChevronDown className={`w-3 h-3 transition-transform ${showRouteDetails ? 'rotate-180' : ''}`} />
        </button>
        {showRouteDetails && (
          <div className="mt-1.5 pt-1.5 border-t border-slate-100 space-y-1 text-[10px] text-slate-600">
            <div className="flex justify-between">
              <span>Venue:</span>
              <span className="font-medium">{venue === 'hyperliquid' ? 'Hyperliquid (simulated)' : 'Event Markets (simulated)'}</span>
            </div>
            <div className="flex justify-between">
              <span>Chain:</span>
              <span className="font-medium">Abstracted (auto-selected)</span>
            </div>
            <div className="flex justify-between">
              <span>Est. slippage:</span>
              <span className="font-medium">&lt; 0.10% (simulated)</span>
            </div>
            <div className="flex justify-between">
              <span>Settlement:</span>
              <span className="font-medium">T+0 (simulated)</span>
            </div>
            <div className="mt-1.5 pt-1.5 border-t border-slate-100 text-[9px] text-slate-400 italic">
              Execution details shown are simulated for demo purposes.
            </div>
          </div>
        )}
      </div>

      {/* Monitoring chips (only when executed) */}
      {isExecuted && (
        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-100">
          <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-blue-50 text-blue-700">
            Monitoring
          </span>
          {hasStopLoss && (
            <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-rose-50 text-rose-700">
              SL armed
            </span>
          )}
          {hasTakeProfit && (
            <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-emerald-50 text-emerald-700">
              TP armed
            </span>
          )}
          {strategy?.riskPercent && (
            <RiskBadge riskPercent={strategy.riskPercent} />
          )}
        </div>
      )}
    </div>
  );
}

