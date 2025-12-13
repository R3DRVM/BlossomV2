import { useExecution } from '../context/ExecutionContext';

interface ExecutionStatusBarProps {
  executionMode: 'auto' | 'confirm' | 'manual';
  venue: 'hyperliquid' | 'event_demo';
}

export default function ExecutionStatusBar({ executionMode, venue }: ExecutionStatusBarProps) {
  const { lastAction, pendingPlans } = useExecution();
  
  const handleLastActionClick = () => {
    if (!lastAction) return;
    
    // Try to find the relevant position or activity feed item
    // For now, just scroll to the most recent plan card
    const planCards = document.querySelectorAll('[data-plan-id]');
    if (planCards.length > 0) {
      const latestCard = planCards[planCards.length - 1];
      latestCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Add temporary highlight
      latestCard.classList.add('ring-2', 'ring-pink-400');
      setTimeout(() => {
        latestCard.classList.remove('ring-2', 'ring-pink-400');
      }, 1500);
    }
  };
  
  return (
    <div className="flex-shrink-0 border-t border-slate-100 bg-white/90 backdrop-blur-sm px-4 py-1.5">
      <div className="max-w-3xl mx-auto flex items-center justify-between text-[10px] text-slate-600">
        <div className="flex items-center gap-3">
          <span className="font-medium">Mode:</span>
          <span className="capitalize">{executionMode}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-medium">Venue:</span>
          <span>{venue === 'hyperliquid' ? 'On-chain' : 'Event Markets'}</span>
        </div>
        {executionMode === 'confirm' && pendingPlans.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-pink-600 font-medium">Pending: {pendingPlans.length}</span>
          </div>
        )}
        {lastAction ? (
          <button
            onClick={handleLastActionClick}
            className="text-pink-600 hover:text-pink-700 hover:underline transition-colors cursor-pointer"
          >
            {lastAction}
          </button>
        ) : (
          <span className="text-slate-400">Run a plan to see actions here</span>
        )}
      </div>
    </div>
  );
}

