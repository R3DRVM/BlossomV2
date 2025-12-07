interface EmptyStateCardProps {
  onQuickAction?: (action: 'perp' | 'defi' | 'event') => void;
}

export default function EmptyStateCard({ onQuickAction }: EmptyStateCardProps) {

  return (
    <div className="card-glass p-6 text-center">
      <div className="mb-4">
        <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-blossom-pinkSoft/40 flex items-center justify-center">
          <svg className="w-8 h-8 text-blossom-pink" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </div>
        <h3 className="text-base font-semibold text-blossom-ink mb-2">No active positions</h3>
        <p className="text-sm text-blossom-slate">
          As you start trading, your open positions and risk summaries will appear here.
        </p>
      </div>
      
      {onQuickAction && (
        <div className="mt-6 space-y-2">
          <button
            onClick={() => onQuickAction('perp')}
            className="w-full px-4 py-2 text-sm font-medium text-blossom-ink bg-white border border-blossom-outline/60 rounded-lg hover:bg-blossom-pinkSoft/40 hover:border-blossom-pink/40 transition-colors"
          >
            Open a perp trade
          </button>
          <button
            onClick={() => onQuickAction('defi')}
            className="w-full px-4 py-2 text-sm font-medium text-blossom-ink bg-white border border-blossom-outline/60 rounded-lg hover:bg-blossom-pinkSoft/40 hover:border-blossom-pink/40 transition-colors"
          >
            Deposit into yield
          </button>
          <button
            onClick={() => onQuickAction('event')}
            className="w-full px-4 py-2 text-sm font-medium text-blossom-ink bg-white border border-blossom-outline/60 rounded-lg hover:bg-blossom-pinkSoft/40 hover:border-blossom-pink/40 transition-colors"
          >
            Explore event markets
          </button>
        </div>
      )}
    </div>
  );
}

