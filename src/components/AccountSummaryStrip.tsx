import { useState } from 'react';
import { useBlossomContext } from '../context/BlossomContext';

export default function AccountSummaryStrip() {
  const { account, resetSim } = useBlossomContext();
  const [isResetting, setIsResetting] = useState(false);
  
  const balanceText = account.balances
    .map(b => `${b.symbol}: $${b.balanceUsd.toLocaleString()}`)
    .join(' • ');
  
  return (
    <div className="bg-white border-b border-blossom-outline px-6 py-2.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between text-xs">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-blossom-slate">Account Value:</span>
            <span className="font-semibold text-blossom-ink">${account.accountValue.toLocaleString()}</span>
          </div>
          <span className="text-blossom-outline">•</span>
          <div className="flex items-center gap-1.5">
            <span className="text-blossom-slate">Perp Exposure:</span>
            <span className="font-medium text-blossom-ink">${account.openPerpExposure.toLocaleString()}</span>
          </div>
          <span className="text-blossom-outline">•</span>
          <div className="flex items-center gap-1.5">
            <span className="text-blossom-slate">Total PnL:</span>
            <span className="font-semibold text-blossom-success">+{account.totalPnlPct.toFixed(1)}%</span>
          </div>
          <span className="text-blossom-outline hidden lg:inline">•</span>
          <div className="hidden lg:flex items-center gap-1.5">
            <span className="text-blossom-slate text-[11px]">{balanceText}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              if (window.confirm('Reset SIM account to initial state?')) {
                setIsResetting(true);
                try {
                  await resetSim();
                } catch (error: any) {
                  alert(`Failed to reset: ${error.message}`);
                } finally {
                  setIsResetting(false);
                }
              }
            }}
            disabled={isResetting}
            className="px-3 py-1 text-xs font-medium text-blossom-slate border border-blossom-outline rounded-full hover:bg-blossom-pinkLight hover:border-blossom-pink transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isResetting ? 'Resetting...' : 'Reset SIM'}
          </button>
        </div>
      </div>
    </div>
  );
}

