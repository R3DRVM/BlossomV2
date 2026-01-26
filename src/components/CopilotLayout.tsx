import { useRef, useState, useEffect } from 'react';
import { useBlossomContext } from '../context/BlossomContext';
import { useExecution } from '../context/ExecutionContext';
import Chat from './Chat';
import LeftSidebar from './LeftSidebar';
import RightPanel from './RightPanel';
import { TickerStrip } from './TickerStrip';
import { BlossomLogo } from './BlossomLogo';
import RiskCenter from './RiskCenter';
import PortfolioView from './PortfolioView';
import PositionsTray from './PositionsTray';
import ExecutionStatusBar from './ExecutionStatusBar';
import OnboardingCoachmarks from './OnboardingCoachmarks';
import EventMarketsCoachmarks from './EventMarketsCoachmarks';

type CenterView = 'copilot' | 'risk' | 'portfolio';
type ExecutionMode = 'auto' | 'confirm' | 'manual';

export default function CopilotLayout() {
  const { selectedStrategyId, onboarding, setOnboarding, strategies, defiPositions, activeTab, setActiveTab, venue, setVenue } = useBlossomContext();
  const { pendingPlans } = useExecution();
  const insertPromptRef = useRef<((text: string) => void) | null>(null);
  
  // Execution Mode state (persisted in localStorage)
  const [executionMode, setExecutionMode] = useState<ExecutionMode>(() => {
    const saved = localStorage.getItem('blossom.executionMode');
    return (saved as ExecutionMode) || 'auto';
  });

  useEffect(() => {
    localStorage.setItem('blossom.executionMode', executionMode);
  }, [executionMode]);
  
  // Handle pending confirmations badge click
  const handlePendingClick = () => {
    if (pendingPlans.length === 0) return;
    // Find the most recent pending plan and scroll to it
    const latestPlan = pendingPlans[pendingPlans.length - 1];
    const planCard = document.querySelector(`[data-plan-id="${latestPlan.id}"]`);
    if (planCard) {
      planCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Add temporary highlight
      planCard.classList.add('ring-2', 'ring-pink-400');
      setTimeout(() => {
        planCard.classList.remove('ring-2', 'ring-pink-400');
      }, 1500);
    }
  };
  
  // Local center view state - syncs with global activeTab but keeps 3-panel layout
  const [centerView, setCenterView] = useState<CenterView>('copilot');
  
  // Onboarding coachmarks (on-chain)
  const [showOnboarding, setShowOnboarding] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('blossom.onboardingSeen') !== 'true';
  });
  
  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
  };

  // Event Markets coachmarks (separate from on-chain)
  const [showEventOnboarding, setShowEventOnboarding] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('blossom.onboardingSeen.event') !== 'true';
  });
  
  const handleEventOnboardingComplete = () => {
    setShowEventOnboarding(false);
  };
  
  // Sync centerView with global activeTab when it changes
  useEffect(() => {
    if (activeTab === 'copilot' || activeTab === 'risk' || activeTab === 'portfolio') {
      setCenterView(activeTab);
    }
  }, [activeTab]);
  
  // Check if user has tried all three: perp, defi, event
  const hasPerp = strategies.some(s => s.instrumentType === 'perp' && s.status !== 'draft');
  const hasDefi = defiPositions.length > 0 || onboarding.queuedStrategy;
  const hasEvent = strategies.some(s => s.instrumentType === 'event' && s.status !== 'draft');
  const allDone = hasPerp && hasDefi && hasEvent;
  
  // Auto-dismiss banner when user has created their first strategy
  const hasAnyStrategy = strategies.length > 0 && strategies.some(s => s.status !== 'draft');
  const shouldShowBanner = !onboarding.dismissed && !allDone && !hasAnyStrategy;
  
  const handleCenterViewChange = (view: CenterView) => {
    setCenterView(view);
    setActiveTab(view); // Sync with global state
  };

  // Note: Auto-open behavior for Positions Tray is disabled
  // Strategy Drawer now handles auto-opening when first position is created (see RightPanel.tsx)

  return (
    <div className="flex h-full w-full bg-slate-50 overflow-hidden">
      {/* Left Sidebar - hidden below lg */}
      <div className="hidden lg:flex w-64 flex-shrink-0 min-h-0 overflow-hidden">
        <LeftSidebar />
      </div>

      {/* Center Panel - Main Chat - always visible, flex-1 */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Center Header - Compact */}
        <div className="flex-shrink-0 bg-white border-b border-slate-100 px-4 py-2">
          <div className="flex items-center justify-between">
            {/* Left: Logo + Title + Mini Tabs */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <BlossomLogo size={20} className="drop-shadow-sm" />
                <h1 className="text-sm font-semibold text-slate-900">Blossom</h1>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleCenterViewChange('copilot')}
                  className={`text-[11px] font-medium transition-colors ${
                    centerView === 'copilot'
                      ? 'text-slate-900 border-b border-pink-200 pb-0.5'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Copilot
                </button>
                {/* Risk Center and Portfolio Overview tabs hidden for beta */}
                {/* TODO: Re-enable these tabs post-beta launch */}
              </div>
            </div>
            
            {/* Right: Execution Mode + Venue Toggle */}
            <div className="flex items-center gap-2">
              {/* Execution Mode Selector */}
              <div 
                className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5"
                data-coachmark="execution-mode"
              >
                {(['auto', 'confirm', 'manual'] as ExecutionMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setExecutionMode(mode)}
                    className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
                      executionMode === mode
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    title={
                      mode === 'auto' ? 'Auto-execute plans' :
                      mode === 'confirm' ? 'Require confirmation before execution' :
                      'Manual execution only'
                    }
                  >
                    {mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>
              
              {/* Pending Confirmations Badge (only in Confirm mode) */}
              {executionMode === 'confirm' && pendingPlans.length > 0 && (
                <button
                  onClick={handlePendingClick}
                  className="px-2.5 py-1 text-[10px] font-medium rounded-full bg-pink-100 text-pink-700 border border-pink-200 hover:bg-pink-200 transition-colors"
                  title={`${pendingPlans.length} plan${pendingPlans.length !== 1 ? 's' : ''} pending confirmation`}
                >
                  Pending ({pendingPlans.length})
                </button>
              )}

              {/* Venue Toggle */}
              <button
                onClick={() => setVenue('hyperliquid')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-full transition-all flex items-center gap-1.5 ${
                  venue === 'hyperliquid'
                    ? 'bg-pink-50 text-blossom-pink border border-pink-200'
                    : 'bg-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {venue === 'hyperliquid' && (
                  <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                )}
                <span>On-chain</span>
              </button>
              <button
                onClick={() => setVenue('event_demo')}
                data-coachmark="event-tab"
                className={`px-2.5 py-1 text-[11px] font-medium rounded-full transition-all flex items-center gap-1.5 ${
                  venue === 'event_demo'
                    ? 'bg-pink-50 text-blossom-pink border border-pink-200'
                    : 'bg-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {venue === 'event_demo' && (
                  <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                )}
                <span>Event Markets</span>
              </button>
            </div>
          </div>
        </div>

            {/* Ticker Strip - only for Copilot view */}
            {centerView === 'copilot' && (
              <div className="flex-shrink-0 bg-white border-b border-slate-100 px-4 py-1 overflow-hidden h-7">
                <TickerStrip venue={venue} />
              </div>
            )}

        {/* Content Area - Scrollable */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-white">
          {centerView === 'copilot' && (
            <>
              {shouldShowBanner && (
                <div className="mb-3 card-glass px-4 py-3 text-xs text-blossom-ink mx-6 mt-4 flex-shrink-0">
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
                <div className="mb-2 mx-6 mt-4 text-right flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setOnboarding(prev => ({ ...prev, dismissed: false }))}
                    className="text-xs text-blossom-slate hover:text-blossom-ink hover:underline transition-colors"
                  >
                    Replay onboarding
                  </button>
                </div>
              )}
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
                <div className="flex-1 overflow-y-auto">
                  <Chat 
                    selectedStrategyId={selectedStrategyId}
                    executionMode={executionMode}
                    onRegisterInsertPrompt={(handler) => {
                      insertPromptRef.current = handler;
                    }}
                  />
                </div>
                <ExecutionStatusBar 
                  executionMode={executionMode}
                  venue={venue}
                />
                {showOnboarding && centerView === 'copilot' && venue !== 'event_demo' && (
                  <OnboardingCoachmarks onComplete={handleOnboardingComplete} />
                )}
                {showEventOnboarding && centerView === 'copilot' && venue === 'event_demo' && (
                  <EventMarketsCoachmarks onComplete={handleEventOnboardingComplete} />
                )}
              </div>
            </>
          )}
          
          {centerView === 'risk' && (
            <div className="flex-1 overflow-y-auto min-h-0">
              <RiskCenter />
            </div>
          )}
          
          {centerView === 'portfolio' && (
            <div className="flex-1 overflow-y-auto min-h-0">
              <PortfolioView />
            </div>
          )}
        </div>
      </div>

          {/* Right Panel - Wallet + Positions - hidden below lg */}
          <div className="hidden lg:flex flex-shrink-0 h-full">
            <div className="relative w-[320px] xl:w-[340px] pr-4 pl-2 h-full flex flex-col min-h-0">
              <RightPanel
                selectedStrategyId={selectedStrategyId}
                onQuickAction={(action) => {
                  const prompts = {
                    perp: 'Long ETH with 3% risk and manage liquidation for me',
                    defi: 'Park half my idle REDACTED into the safest yield on Kamino',
                    event: 'Risk 2% of my account on the highest-volume prediction market.'
                  };
                  if (insertPromptRef.current) {
                    insertPromptRef.current(prompts[action]);
                  }
                }}
                onInsertPrompt={(text) => {
                  if (insertPromptRef.current) {
                    insertPromptRef.current(text);
                  }
                }}
              />
              {/* Positions Tray - Disabled (hidden behind ENABLE_POSITIONS_TRAY flag) */}
              <PositionsTray defaultOpen={false} />
            </div>
          </div>
        </div>
      );
    }

