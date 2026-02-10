import { AlertTriangle } from 'lucide-react';

interface HighRiskConfirmCardProps {
  reasons: string[];
  onProceed: () => void;
  onEdit: () => void;
  onRewrite?: () => void;
}

export default function HighRiskConfirmCard({ reasons, onProceed, onEdit, onRewrite }: HighRiskConfirmCardProps) {
  return (
    <div className="mt-2 w-full max-w-md bg-white rounded-lg border border-slate-200 shadow-sm">
      <div className="px-3 py-2.5 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <h4 className="text-xs font-semibold text-slate-900">High-Risk Request Detected</h4>
        </div>
      </div>
      <div className="p-3 space-y-3">
        <p className="text-xs text-slate-600">
          This could result in rapid liquidation and large losses.
        </p>
        {reasons.length > 0 && (
          <ul className="space-y-1">
            {reasons.map((reason, idx) => (
              <li key={idx} className="text-[11px] text-slate-500 flex items-start gap-1.5">
                <span className="text-amber-500 mt-0.5">•</span>
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        )}
        {/* Step 3: Collateral model note */}
        <p className="text-[10px] text-slate-400 italic pt-1 border-t border-slate-100">
          Demo note: Perps use bUSDC collateral only (no auto-swap in simulation).
        </p>
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onProceed();
            }}
            className="flex-1 h-9 px-4 text-xs font-medium rounded-lg transition-all bg-amber-500 hover:bg-amber-600 text-white shadow-sm"
          >
            Proceed exactly as written
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onEdit();
            }}
            className="flex-1 h-9 px-4 text-xs font-medium rounded-lg transition-all border border-slate-200 hover:bg-slate-50 text-slate-700 bg-white"
          >
            Edit request
          </button>
        </div>
        {onRewrite && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRewrite();
            }}
            className="w-full text-[10px] text-slate-500 hover:text-slate-700 hover:underline transition-colors text-center"
          >
            Rewrite with guardrails
          </button>
        )}
      </div>
    </div>
  );
}
