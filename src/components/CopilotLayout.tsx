import { useRef, useState, useEffect } from 'react';
import { useBlossomContext } from '../context/BlossomContext';
import Chat from './Chat';
import LeftSidebar from './LeftSidebar';
import RightPanel from './RightPanel';
import { TickerStrip } from './TickerStrip';
import { BlossomLogo } from './BlossomLogo';
import RiskCenter from './RiskCenter';
import PortfolioView from './PortfolioView';
import PositionsTray from './PositionsTray';

type CenterView = 'copilot' | 'risk' | 'portfolio';

export default function CopilotLayout() {
  const { selectedStrategyId, onboarding, setOnboarding, strategies, defiPositions, activeTab, setActiveTab, venue, setVenue } = useBlossomContext();
  const insertPromptRef = useRef<((text: string) => void) | null>(null);
  
  // Local center view state - syncs with global activeTab but keeps 3-panel layout
  const [centerView, setCenterView] = useState<CenterView>('copilot');
  
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
  
  const handleCenterViewChange = (view: CenterView) => {
    setCenterView(view);
    setActiveTab(view); // Sync with global state
  };

  // Auto-open tray when positions are created
  const activePerps = strategies.filter(s => 
    s.instrumentType === 'perp' && 
    (s.status === 'executed' || s.status === 'executing') && 
    !s.isClosed
  );
  const activeEvents = strategies.filter(s => 
    s.instrumentType === 'event' && 
    (s.status === 'executed' || s.status === 'executing') && 
    !s.isClosed
  );
  const activeDefi = defiPositions.filter(p => p.status === 'active');
  const proposedDefi = defiPositions.filter(p => p.status === 'proposed');
  const totalPositions = activePerps.length + activeEvents.length + activeDefi.length + proposedDefi.length;
  
  // Determine if we should auto-open (when going from 0 to >0 positions)
  const [hasHadPositions, setHasHadPositions] = useState(totalPositions > 0);
  const shouldAutoOpen = !hasHadPositions && totalPositions > 0;
  
  useEffect(() => {
    if (totalPositions > 0) {
      setHasHadPositions(true);
    }
  }, [totalPositions]);

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
                <button
                  onClick={() => handleCenterViewChange('risk')}
                  className={`text-[11px] font-medium transition-colors ${
                    centerView === 'risk'
                      ? 'text-slate-900 border-b border-pink-200 pb-0.5'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Risk Center
                </button>
                <button
                  onClick={() => handleCenterViewChange('portfolio')}
                  className={`text-[11px] font-medium transition-colors ${
                    centerView === 'portfolio'
                      ? 'text-slate-900 border-b border-pink-200 pb-0.5'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Portfolio Overview
                </button>
              </div>
            </div>
            
            {/* Right: Venue Toggle */}
            <div className="flex items-center gap-2">
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
              {!onboarding.dismissed && !allDone && (
                <div className="mb-3 card-glass px-4 py-3 text-xs text-blossom-ink mx-6 mt-4">
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
                      <span>Park idle USDC into yield (e.g. Park half my idle USDC in the safest Kamino vault).</span>
                    </li>
                    <li className={`flex items-start gap-2 ${hasEvent ? 'text-blossom-slate line-through' : ''}`}>
                      <span className="mt-0.5">{hasEvent ? '✓' : '•'}</span>
                      <span>Try an event market (switch venue to Event Markets and use Take YES on Fed cuts in March with 2% risk).</span>
                    </li>
                  </ol>
                </div>
              )}
              {onboarding.dismissed && allDone && (
                <div className="mb-2 mx-6 mt-4 text-right">
                  <button
                    type="button"
                    onClick={() => setOnboarding(prev => ({ ...prev, dismissed: false }))}
                    className="text-xs text-blossom-slate hover:text-blossom-ink hover:underline transition-colors"
                  >
                    Replay onboarding
                  </button>
                </div>
              )}
              <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
                <Chat 
                  selectedStrategyId={selectedStrategyId}
                  onRegisterInsertPrompt={(handler) => {
                    insertPromptRef.current = handler;
                  }}
                />
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
          <div className="hidden lg:flex flex-shrink-0">
            <div className="relative w-[320px] xl:w-[340px] pr-4 pl-2 min-h-0 overflow-hidden">
              <RightPanel
                selectedStrategyId={selectedStrategyId}
                onQuickAction={(action) => {
                  const prompts = {
                    perp: 'Long ETH with 3% risk and manage liquidation for me',
                    defi: 'Park half my idle USDC into the safest yield on Kamino',
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
              {/* Positions Tray - Docked bottom-right inside column */}
              <PositionsTray defaultOpen={shouldAutoOpen} />
            </div>
          </div>
        </div>
      );
    }

