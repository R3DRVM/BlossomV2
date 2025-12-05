import { useBlossomContext } from '../context/BlossomContext';
import Chat from './Chat';
import SidePanel from './SidePanel';

export default function CopilotLayout() {
  const { selectedStrategyId, onboarding, setOnboarding } = useBlossomContext();
  const allDone = onboarding.openedTrade && onboarding.queuedStrategy && onboarding.openedRiskCenter;

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
              <li className={onboarding.openedTrade ? 'line-through text-gray-500' : ''}>
                Ask Blossom to open a perps trade.
              </li>
              <li className={onboarding.queuedStrategy ? 'line-through text-gray-500' : ''}>
                Confirm & queue the strategy.
              </li>
              <li className={onboarding.openedRiskCenter ? 'line-through text-gray-500' : ''}>
                Check the impact in the Risk Center tab.
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

