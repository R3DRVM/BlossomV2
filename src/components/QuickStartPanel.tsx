import { useState, useEffect } from 'react';
import { Star, X, Shield, CheckCircle2, Activity } from 'lucide-react';
import { QUICK_START_CATEGORIES, QuickStartCategoryId } from '../config/quickStartConfig';
import { useBlossomContext, Venue } from '../context/BlossomContext';
import { getSavedPrompts, savePrompt, deletePrompt, isPromptSaved, SavedPrompt } from '../lib/savedPrompts';
import { useERC8004Identity, useERC8004Reputation, useERC8004Capabilities } from '../hooks/useERC8004';

interface QuickStartPanelProps {
  onSelectPrompt: (prompt: string) => void;
}

// Helper to get venue-specific quick actions
function getQuickActionsForVenue(venue: Venue): Array<{ title: string; description: string; prompt: string }> {
  if (venue === 'event_demo') {
    return [
      {
        title: 'Bet on macro events',
        description: 'Take a YES/NO view on a key macro outcome.',
        prompt: 'Take YES on Fed cuts in March with 2% risk',
      },
      {
        title: 'Scan my event exposure',
        description: 'See how much of my account is tied to event markets.',
        prompt: 'Show me my event market exposure and the riskiest positions',
      },
      {
        title: 'Risk-adjusted event sizing',
        description: 'Use a conservative stake based on my risk rules.',
        prompt: 'Risk 2% on the highest volume event market',
      },
      {
        title: 'Explore top markets',
        description: 'View the highest-volume prediction markets right now.',
        prompt: 'Show me the top 5 prediction markets by volume',
      },
    ];
  }

  // Default: on-chain / hyperliquid
  return [
    {
      title: 'Long BTC with live prices',
      description: 'Route across venues for optimal execution.',
      prompt: 'Long BTC with 20x leverage using 2% risk. Show me the execution plan across venues.',
    },
    {
      title: 'Check exposure & risk',
      description: 'See where my risk is concentrated right now.',
      prompt: 'Show me my current perp exposure and largest risk buckets',
    },
    {
      title: 'Multi-venue execution',
      description: 'Route a hedge across optimal venues and chains.',
      prompt: 'Hedge my BTC and ETH exposure with a short BTC perp position. Route across the best venues.',
    },
    {
      title: 'Explore top DeFi protocols',
      description: 'View the highest TVL DeFi protocols right now.',
      prompt: 'Show me the top 5 DeFi protocols by TVL',
    },
  ];
}

export default function QuickStartPanel({ onSelectPrompt }: QuickStartPanelProps) {
  const { venue } = useBlossomContext();
  const [selectedCategoryId, setSelectedCategoryId] = useState<QuickStartCategoryId | null>(null);
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);
  const [showSaved, setShowSaved] = useState(false);

  // ERC-8004 Agent info
  const { isEnabled, isRegistered, agentId } = useERC8004Identity();
  const { tier, executionCount, totalVolumeUsd, formattedScore } = useERC8004Reputation();
  const { hasSwap, hasPerp, hasLend, hasEvent } = useERC8004Capabilities();

  // Load saved prompts
  useEffect(() => {
    setSavedPrompts(getSavedPrompts());
  }, []);

  const handleSavePrompt = (prompt: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      if (isPromptSaved(prompt)) {
        // Find and delete
        const existing = savedPrompts.find(p => p.text.toLowerCase().trim() === prompt.toLowerCase().trim());
        if (existing) {
          deletePrompt(existing.id);
          setSavedPrompts(getSavedPrompts());
        }
      } else {
        savePrompt(prompt);
        setSavedPrompts(getSavedPrompts());
      }
    } catch (error) {
      console.error('Error saving prompt:', error);
      // Don't let errors break the UI
    }
  };

  const handleDeleteSaved = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deletePrompt(id);
    setSavedPrompts(getSavedPrompts());
  };

  // Root view: show venue-specific quick actions + saved prompts
  if (selectedCategoryId === null) {
    const quickActions = getQuickActionsForVenue(venue);

    // Format volume nicely
    const formatVolume = (usd: number) => {
      if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
      if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`;
      return `$${usd.toFixed(0)}`;
    };

    // Build capability pills
    const capabilityPills: string[] = [
      hasSwap && 'Swap',
      hasPerp && 'Perps',
      hasLend && 'Lending',
      hasEvent && 'Events',
    ].filter((cap): cap is string => typeof cap === 'string');

    return (
      <div className="mt-3 px-4 pb-4 space-y-3">
        {/* ERC-8004 Agent Credentials */}
        {isEnabled && (
          <div className="rounded-2xl border border-slate-100 bg-white/90 shadow-sm px-3 py-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isRegistered ? (
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span className="text-[11px] font-medium text-slate-700">
                      Verified Agent #{agentId}
                    </span>
                    <span className="text-[10px] text-slate-400">|</span>
                    <span className={`text-[10px] font-medium ${
                      tier === 'excellent' || tier === 'good'
                        ? 'text-emerald-600'
                        : tier === 'fair' || tier === 'neutral'
                        ? 'text-amber-600'
                        : 'text-slate-500'
                    }`}>
                      {formattedScore}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Shield className="w-4 h-4 text-slate-400" />
                    <span className="text-[11px] text-slate-500">Unverified Agent</span>
                  </div>
                )}
              </div>
              {isRegistered && (
                <div className="flex items-center gap-2 text-[10px] text-slate-400">
                  <span className="flex items-center gap-1">
                    <Activity className="w-3 h-3" />
                    {executionCount} txs
                  </span>
                  <span>|</span>
                  <span>{formatVolume(totalVolumeUsd)} routed</span>
                </div>
              )}
            </div>
            {capabilityPills.length > 0 && (
              <div className="flex items-center gap-1 mt-1.5">
                {capabilityPills.map((cap) => (
                  <span
                    key={cap}
                    className="px-1.5 py-0.5 text-[9px] font-medium bg-slate-100 text-slate-600 rounded"
                  >
                    {cap}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Saved Prompts Section */}
        {savedPrompts.length > 0 && (
          <div className="rounded-2xl border border-slate-100 bg-white/90 shadow-sm px-3 py-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="text-[10px] font-semibold tracking-[0.18em] text-slate-500 uppercase">SAVED</h3>
              <button
                onClick={() => setShowSaved(!showSaved)}
                className="text-[10px] text-slate-500 hover:text-slate-700"
              >
                {showSaved ? 'Hide' : 'Show'}
              </button>
            </div>
            {showSaved && (
              <div className="space-y-1.5 mt-2">
                {savedPrompts.map((prompt) => (
                  <div
                    key={prompt.id}
                    className="group relative rounded-lg border border-slate-100 bg-white px-2.5 py-2 hover:bg-pink-50/60 hover:border-pink-200 transition-all"
                  >
                    <button
                      onClick={() => onSelectPrompt(prompt.text)}
                      className="w-full text-left"
                    >
                      <div className="text-[11px] font-medium text-slate-900 pr-6">
                        {prompt.text}
                      </div>
                    </button>
                    <button
                      onClick={(e) => handleDeleteSaved(prompt.id, e)}
                      className="absolute right-2 top-2 p-0.5 opacity-0 group-hover:opacity-100 hover:bg-rose-100 rounded transition-opacity"
                    >
                      <X className="w-3 h-3 text-rose-600" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Suggested Actions - Compact Grid */}
        <div className="rounded-2xl border border-slate-100 bg-white/90 shadow-sm px-3 py-2.5">
          <div className="mb-1.5">
            <h3 className="text-[10px] font-semibold tracking-[0.18em] text-slate-500 uppercase mb-1">SUGGESTED FIRST ACTIONS</h3>
            <div className="h-px bg-slate-100 mt-1"></div>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {quickActions.map((action, idx) => {
              const isSaved = isPromptSaved(action.prompt);
              const isExploreTopMarkets = action.title === 'Explore top markets';
              return (
                <div
                  key={idx}
                  {...(isExploreTopMarkets ? { 'data-coachmark': 'event-explore-top-markets' } : {})}
                  className="group relative rounded-lg border border-slate-100 bg-white px-2 py-1.5 hover:bg-pink-50/60 hover:border-pink-200 transition-all"
                >
                  <button
                    onClick={() => onSelectPrompt(action.prompt)}
                    className="w-full text-left pr-5"
                  >
                    <div className="text-[10px] font-medium text-slate-900 line-clamp-1">
                      {action.title}
                    </div>
                    <div className="mt-0.5 text-[9px] text-slate-500 line-clamp-1">
                      {action.description}
                    </div>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSavePrompt(action.prompt, e);
                    }}
                    className={`absolute right-1 top-1 p-0.5 rounded transition-colors ${
                      isSaved
                        ? 'text-yellow-500 bg-yellow-50'
                        : 'opacity-0 group-hover:opacity-100 text-slate-400 hover:text-yellow-500 hover:bg-yellow-50'
                    }`}
                  >
                    <Star className={`w-3 h-3 ${isSaved ? 'fill-current' : ''}`} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Sub-view: show prompts for selected category
  const selectedCategory = QUICK_START_CATEGORIES.find(cat => cat.id === selectedCategoryId);
  
  if (!selectedCategory) {
    return null;
  }

  return (
    <div className="mt-3 px-4 pb-4">
      <div className="rounded-2xl border border-slate-100 bg-white/90 shadow-sm px-3 py-2 max-h-48 overflow-y-auto">
        {/* Back button - always visible at top */}
        <div className="sticky top-0 bg-white/95 backdrop-blur-sm -mx-3 px-3 pt-2 pb-1.5 -mt-2 mb-1.5 border-b border-slate-100/50 z-10">
          <button
            onClick={() => setSelectedCategoryId(null)}
            className="flex items-center gap-1.5 text-[10px] text-slate-500 hover:text-slate-800 transition-colors"
          >
            <svg 
              className="w-2.5 h-2.5" 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span>Back to Quick Start</span>
          </button>
        </div>

        {/* Category title */}
        <div className="mb-2">
          <h3 className="text-xs font-medium text-slate-900">{selectedCategory.label}</h3>
          <p className="text-[10px] text-slate-500 mt-0.5">{selectedCategory.description}</p>
        </div>

        {/* Sub-prompts - 2-column grid on md+ */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
          {selectedCategory.subPrompts.map((subPrompt) => (
            <button
              key={subPrompt.id}
              onClick={() => onSelectPrompt(subPrompt.prompt)}
              className="rounded-xl border border-slate-100 bg-white px-2.5 py-1.5 text-left text-[10px] font-medium text-slate-800 hover:border-pink-200 hover:bg-pink-50/60 transition-all"
            >
              {subPrompt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

