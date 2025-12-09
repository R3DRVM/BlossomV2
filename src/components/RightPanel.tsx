import { useBlossomContext } from '../context/BlossomContext';

interface RightPanelProps {
  selectedStrategyId?: string | null;
  onQuickAction?: (action: 'perp' | 'defi' | 'event') => void;
  onInsertPrompt?: (text: string) => void;
}

export default function RightPanel(_props: RightPanelProps) {
  const { account } = useBlossomContext();

  const handleFund = () => {
    // TODO: Implement fund functionality
    console.log('Fund clicked');
  };

  const handleSend = () => {
    // TODO: Implement send functionality
    console.log('Send clicked');
  };

  const handleSwap = () => {
    // TODO: Implement swap functionality
    console.log('Swap clicked');
  };

  // Calculate perp PnL (simplified - using totalPnlPct for now)
  const perpPnlUsd = account.accountValue * (account.totalPnlPct / 100);
  const perpPnlSign = account.totalPnlPct >= 0 ? '+' : '';

  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden bg-slate-50">
      {/* Wallet Snapshot - Sticky at top */}
      <div className="flex-shrink-0 sticky top-0 z-10 pt-4 pb-3">
        {/* Wallet Card */}
        <div className="rounded-2xl border border-slate-100 bg-white shadow-sm px-4 py-4 space-y-3 w-full">
          {/* Title */}
          <div className="text-[11px] font-semibold tracking-[0.12em] text-slate-500 uppercase">WALLET</div>
          
          {/* Total Balance */}
          <div>
            <div className="text-xl font-semibold text-slate-900">
              ${account.accountValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">Simulation • On-chain</div>
          </div>

          {/* Summary Row */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <span className="text-[11px] text-slate-500">Perp exposure:</span>
              <span className="text-xs font-medium text-slate-900">${account.openPerpExposure.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[11px] text-slate-500">Total PnL:</span>
              <span className={`text-xs font-medium ${account.totalPnlPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                {perpPnlSign}{account.totalPnlPct.toFixed(1)}%
              </span>
            </div>
          </div>

          {/* Token Holdings */}
          <div>
            <div className="text-[11px] font-semibold tracking-[0.12em] text-slate-500 uppercase mb-2">Holdings</div>
            <div className="space-y-1.5">
              {account.balances.map((balance) => {
                // For REDACTED, quantity equals USD value (1:1), so show as quantity
                // For other tokens, show USD value (quantity would require current price data)
                const displayValue = balance.symbol === 'REDACTED'
                  ? balance.balanceUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  : `$${balance.balanceUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                
                return (
                  <div key={balance.symbol} className="flex justify-between items-center">
                    <span className="text-xs font-medium text-slate-700">{balance.symbol}</span>
                    <div className="text-right">
                      <div className="text-xs text-slate-500">{displayValue}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Mini PnL / Exposure Preview */}
          <div className="pt-3 border-t border-slate-100 space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-[11px] text-slate-500">Perps PnL (sim):</span>
              <span className={`text-xs font-medium ${perpPnlUsd >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                {perpPnlSign}${Math.abs(perpPnlUsd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / {perpPnlSign}{account.totalPnlPct.toFixed(1)}%
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[11px] text-slate-500">Open Perp Exposure:</span>
              <span className="text-xs font-medium text-slate-900">${account.openPerpExposure.toLocaleString()}</span>
            </div>
          </div>
          
          {/* Action Buttons */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            <button
              onClick={handleFund}
              className="flex-1 rounded-full border border-slate-200 bg-slate-50 text-xs font-medium text-slate-700 hover:bg-pink-50 hover:border-pink-200 transition py-2"
            >
              Fund
            </button>
            <button
              onClick={handleSend}
              className="flex-1 rounded-full border border-slate-200 bg-slate-50 text-xs font-medium text-slate-700 hover:bg-pink-50 hover:border-pink-200 transition py-2"
            >
              Send
            </button>
            <button
              onClick={handleSwap}
              className="flex-1 rounded-full border border-slate-200 bg-slate-50 text-xs font-medium text-slate-700 hover:bg-pink-50 hover:border-pink-200 transition py-2"
            >
              Swap
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

