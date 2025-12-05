import { useState } from 'react';
import { useBlossomContext } from '../context/BlossomContext';

export default function AccountSummaryStrip() {
  const { account, resetSim } = useBlossomContext();
  const [isResetting, setIsResetting] = useState(false);
  
  const balanceText = account.balances
    .map(b => `${b.symbol}: $${b.balanceUsd.toLocaleString()}`)
    .join(' • ');
  
  return (
    <div className="bg-gray-50 border-b border-gray-200 px-6 py-2">
      <div className="max-w-7xl mx-auto flex items-center justify-between text-xs">
        <div className="flex items-center gap-6">
          <div>
            <span className="text-gray-500">Account Value:</span>
            <span className="ml-2 font-medium text-gray-900">${account.accountValue.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-gray-500">Open Perp Exposure:</span>
            <span className="ml-2 font-medium text-gray-900">${account.openPerpExposure.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-gray-500">Total PnL:</span>
            <span className="ml-2 font-medium text-green-600">+{account.totalPnlPct.toFixed(1)}%</span>
          </div>
          <div className="hidden lg:block">
            <span className="text-gray-500">{balanceText}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
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
            className="px-2 py-1 text-xs font-medium text-gray-600 hover:text-gray-900 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isResetting ? 'Resetting...' : 'Reset SIM'}
          </button>
          <span className="px-2 py-0.5 text-xs font-medium text-purple-700 bg-purple-100 rounded-full">
            Mode: SIM
          </span>
          <span className="text-xs text-gray-500 hidden sm:inline">• No real orders are placed.</span>
        </div>
      </div>
    </div>
  );
}

