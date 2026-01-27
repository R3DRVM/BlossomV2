import { useBlossomContext } from '../context/BlossomContext';

export default function AccountSummaryStrip() {
  const { account } = useBlossomContext();
  
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
          <span className="text-[10px] text-blossom-slate px-2 py-1 bg-slate-50 rounded-full border border-blossom-outline/40">
            Testnet Mode
          </span>
        </div>
      </div>
    </div>
  );
}

