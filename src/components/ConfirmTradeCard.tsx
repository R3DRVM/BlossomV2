import { AlertTriangle, X } from 'lucide-react';
import { useBlossomContext } from '../context/BlossomContext';
import { formatUsd } from '../lib/format';
import { useState } from 'react';

interface ConfirmTradeCardProps {
  draftId: string;
  showRiskWarning: boolean;
  riskReasons?: string[];
  onConfirm: (draftId: string) => void;
  onEdit: () => void;
}

export default function ConfirmTradeCard({ draftId, showRiskWarning, riskReasons = [], onConfirm, onEdit }: ConfirmTradeCardProps) {
  const { strategies } = useBlossomContext();
  const [riskWarningCollapsed, setRiskWarningCollapsed] = useState(false);
  
  const draft = strategies.find(s => s.id === draftId);
  if (!draft) return null;
  
  const marginUsd = draft.marginUsd || 0;
  const notionalUsd = draft.notionalUsd || (marginUsd * (draft.leverage || 1));
  const riskUsd = marginUsd; // riskUsd = marginUsd
  
  return (
    <div className="mt-2 w-full max-w-md bg-white rounded-lg border border-slate-200 shadow-sm">
      {/* Part B: Compact risk warning section (collapsible) */}
      {showRiskWarning && !riskWarningCollapsed && (
        <div className="px-3 py-2 border-b border-amber-100 bg-amber-50/50">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2 flex-1">
              <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <h4 className="text-xs font-semibold text-slate-900 mb-1">High-Risk Request</h4>
                {riskReasons.length > 0 && (
                  <ul className="space-y-0.5">
                    {riskReasons.map((reason, idx) => (
                      <li key={idx} className="text-[11px] text-slate-600 flex items-start gap-1.5">
                        <span className="text-amber-500 mt-0.5">•</span>
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <button
              onClick={() => setRiskWarningCollapsed(true)}
              className="text-slate-400 hover:text-slate-600 flex-shrink-0"
              aria-label="Dismiss warning"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
      
      {/* Trade details */}
      <div className="px-3 py-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-slate-900">Trade Confirmation</h4>
          <span className="text-[10px] text-slate-500">{draft.market}</span>
        </div>
        
        <div className="space-y-1.5 text-[11px]">
          <div className="flex justify-between">
            <span className="text-slate-600">Side:</span>
            <span className="font-medium text-slate-900">{draft.side}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Notional (Exposure):</span>
            <span className="font-medium text-slate-900">{formatUsd(notionalUsd)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Margin (Collateral):</span>
            <span className="font-medium text-slate-900">{formatUsd(marginUsd)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Risk:</span>
            <span className="font-medium text-slate-900">
              {draft.riskPercent?.toFixed(1)}% ({formatUsd(riskUsd)})
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Leverage:</span>
            <span className="font-medium text-slate-900">{draft.leverage || 1}x</span>
          </div>
          {draft.takeProfit && (
            <div className="flex justify-between">
              <span className="text-slate-600">Take Profit:</span>
              <span className="font-medium text-slate-900">{formatUsd(draft.takeProfit)}</span>
            </div>
          )}
          {draft.stopLoss && (
            <div className="flex justify-between">
              <span className="text-slate-600">Stop Loss:</span>
              <span className="font-medium text-slate-900">{formatUsd(draft.stopLoss)}</span>
            </div>
          )}
        </div>
        
        {/* Action buttons */}
        <div className="flex gap-2 pt-1 border-t border-slate-100">
          <button
            onClick={() => onConfirm(draftId)}
            className="flex-1 px-3 py-1.5 bg-blossom-pink text-white text-xs font-medium rounded hover:bg-blossom-pink/90 transition-colors"
          >
            Confirm & Execute
          </button>
          <button
            onClick={onEdit}
            className="px-3 py-1.5 border border-slate-300 text-slate-700 text-xs font-medium rounded hover:bg-slate-50 transition-colors"
          >
            Edit
          </button>
        </div>
      </div>
    </div>
  );
}



