import { useBlossomContext } from '../context/BlossomContext';
import Chat from './Chat';
import SidePanel from './SidePanel';

export default function CopilotLayout() {
  const { selectedStrategyId, onboarding, setOnboarding, strategies, defiPositions } = useBlossomContext();
  // Check if user has tried all three: perp, defi, event
  const hasPerp = strategies.some(s => s.instrumentType === 'perp' && s.status !== 'draft');
  const hasDefi = defiPositions.length > 0 || onboarding.queuedStrategy;
  const hasEvent = strategies.some(s => s.instrumentType === 'event' && s.status !== 'draft');
  const allDone = hasPerp && hasDefi && hasEvent;

  return (
    <div className="h-full flex lg:flex-row flex-col gap-4 px-4 pb-4 overflow-hidden">
      <div className="flex-1 flex flex-col min-h-0 bg-white rounded-lg overflow-hidden">
        {!onboarding.dismissed && !allDone && (
          <div className="mb-3 card-glass px-4 py-3 text-xs text-blossom-ink mx-4 mt-4">
            <div className="flex justify-between items-start mb-2">
              <span className="font-medium text-sm">Getting started with Blossom</span>
              <button
                type="button"
                className="text-blossom-slate hover:text-blossom-ink transition-colors"
                onClick={() => setOnboarding(prev => ({ ...prev, dismissed: true }))}
              >
                ×
              </button>
            </div>
            <ol className="space-y-1.5 list-none pl-0 text-xs">
              <li className={`flex items-start gap-2 ${hasPerp ? 'text-blossom-slate line-through' : ''}`}>
                <span className="mt-0.5">{hasPerp ? '✓' : '•'}</span>
                <span>Open your first perp trade (e.g. Long ETH with 3% risk and auto TP/SL).</span>
              </li>
              <li className={`flex items-start gap-2 ${hasDefi ? 'text-blossom-slate line-through' : ''}`}>
                <span className="mt-0.5">{hasDefi ? '✓' : '•'}</span>
                <span>Park idle REDACTED into yield (e.g. Park half my idle REDACTED in the safest Kamino vault).</span>
              </li>
              <li className={`flex items-start gap-2 ${hasEvent ? 'text-blossom-slate line-through' : ''}`}>
                <span className="mt-0.5">{hasEvent ? '✓' : '•'}</span>
                <span>Try an event market (switch venue to Event Markets and use Take YES on Fed cuts in March with 2% risk).</span>
              </li>
            </ol>
          </div>
        )}
        {onboarding.dismissed && allDone && (
          <div className="mb-2 mx-4 mt-4 text-right">
            <button
              type="button"
              onClick={() => setOnboarding(prev => ({ ...prev, dismissed: false }))}
              className="text-xs text-blossom-slate hover:text-blossom-ink hover:underline transition-colors"
            >
              Replay onboarding
            </button>
          </div>
        )}
        <Chat selectedStrategyId={selectedStrategyId} />
      </div>
      <SidePanel selectedStrategyId={selectedStrategyId} />
    </div>
  );
}

