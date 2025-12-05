import { useBlossomContext } from '../context/BlossomContext';
import Chat from './Chat';
import SidePanel from './SidePanel';

export default function CopilotLayout() {
  const { selectedStrategyId, onboarding, setOnboarding, strategies, defiPositions, venue } = useBlossomContext();
  // Check if user has tried all three: perp, defi, event
  const hasPerp = strategies.some(s => s.instrumentType === 'perp' && s.status !== 'draft');
  const hasDefi = defiPositions.length > 0 || onboarding.queuedStrategy;
  const hasEvent = strategies.some(s => s.instrumentType === 'event' && s.status !== 'draft');
  const allDone = hasPerp && hasDefi && hasEvent;

  return (
    <div className="h-full flex lg:flex-row flex-col gap-4 px-4 pb-4 overflow-hidden">
      <div className="flex-1 flex flex-col min-h-0 bg-white rounded-lg overflow-hidden">
        {!onboarding.dismissed && !allDone && (
          <div className="mb-3 rounded-lg border border-purple-100 bg-purple-50 px-4 py-3 text-xs text-purple-900 mx-4 mt-4">
            <div className="flex justify-between items-start mb-2">
              <span className="font-medium">Getting started with Blossom</span>
              <button
                type="button"
                className="text-purple-700 hover:text-purple-900"
                onClick={() => setOnboarding(prev => ({ ...prev, dismissed: true }))}
              >
                ×
              </button>
            </div>
            <ol className="space-y-1 list-decimal pl-4">
              <li className={hasPerp ? 'line-through text-gray-500' : ''}>
                Open your first perp trade (e.g. Long ETH with 3% risk and auto TP/SL).
              </li>
              <li className={hasDefi ? 'line-through text-gray-500' : ''}>
                Park idle REDACTED into yield (e.g. Park half my idle REDACTED in the safest Kamino vault).
              </li>
              <li className={hasEvent ? 'line-through text-gray-500' : ''}>
                Try an event market (switch venue to Event Markets and use Take YES on Fed cuts in March with 2% risk).
              </li>
            </ol>
          </div>
        )}
        <Chat selectedStrategyId={selectedStrategyId} />
      </div>
      <SidePanel selectedStrategyId={selectedStrategyId} />
    </div>
  );
}

