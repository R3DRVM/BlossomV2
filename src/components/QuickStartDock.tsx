import { useState } from 'react';

type QuickStartCategory = 'root' | 'perps' | 'defi' | 'events' | 'risk' | 'research' | 'tools';

interface QuickStartDockProps {
  onInsertPrompt: (text: string) => void;
}

interface CategoryCard {
  id: QuickStartCategory;
  title: string;
  subtitle: string;
  icon?: string;
}

const ROOT_CATEGORIES: CategoryCard[] = [
  { id: 'perps', title: 'Perp trading', subtitle: 'Perp strategies & hedging', icon: '📈' },
  { id: 'defi', title: 'DeFi yield', subtitle: 'Park idle stablecoins into yield', icon: '💰' },
  { id: 'events', title: 'Event markets', subtitle: 'Kalshi & Polymarket ideas', icon: '🎯' },
  { id: 'risk', title: 'Risk & portfolio', subtitle: 'Risk checks & rebalancing', icon: '📊' },
  { id: 'research', title: 'Research & pricing', subtitle: 'Market data & narratives', icon: '🔍' },
  { id: 'tools', title: 'Tools & utilities', subtitle: 'Funding, transfers, misc', icon: '🛠️' },
];

const PERPS_PROMPTS = [
  'Long ETH with 3% risk and manage liquidation for me',
  'Hedge my SOL spot with perps at 2% risk',
  'Show my riskiest perp positions and how to reduce risk',
];

const DEFI_PROMPTS = [
  'Park half my idle bUSDC into the safest yield on Kamino',
  'Build a diversified bUSDC yield ladder with conservative risk',
  'Rotate some yield into higher-risk, higher-APY DeFi positions',
];

const EVENTS_PROMPTS = [
  'What are the top 5 prediction markets on Kalshi right now?',
  'What are the top 5 trending prediction markets on Polymarket?',
  'Risk 2% of my account on the highest-volume prediction market.',
];

const RISK_PROMPTS = [
  'Show my riskiest positions and how to reduce risk',
  'Run a portfolio VaR and show main contributors',
  'Suggest a hedging plan for my current book',
];

const RESEARCH_PROMPTS = [
  'Give me an ETH market summary for the next 24h',
  'What\'s driving BTC price action right now?',
  'Summarize on-chain flows for majors',
];

const TOOLS_PROMPTS = [
  'Show me my portfolio performance this week',
  'Export a summary of my strategies',
];

export default function QuickStartDock({ onInsertPrompt }: QuickStartDockProps) {
  const [activeCategory, setActiveCategory] = useState<QuickStartCategory>('root');

  const getPromptsForCategory = (category: QuickStartCategory): string[] => {
    switch (category) {
      case 'perps':
        return PERPS_PROMPTS;
      case 'defi':
        return DEFI_PROMPTS;
      case 'events':
        return EVENTS_PROMPTS;
      case 'risk':
        return RISK_PROMPTS;
      case 'research':
        return RESEARCH_PROMPTS;
      case 'tools':
        return TOOLS_PROMPTS;
      default:
        return [];
    }
  };

  const handlePromptClick = (prompt: string) => {
    onInsertPrompt(prompt);
  };

  // Root view: grid of category cards
  if (activeCategory === 'root') {
    return (
      <div className="px-6 py-4 border-t border-slate-100 bg-white/90 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto">
          <h3 className="text-sm font-medium text-slate-800 mb-3">Quick start</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {ROOT_CATEGORIES.map((category) => (
              <button
                key={category.id}
                onClick={() => setActiveCategory(category.id)}
                className="bg-white/90 border border-slate-100 rounded-2xl p-3 text-left hover:bg-blossom-pinkSoft/20 hover:border-blossom-pink/40 transition-all shadow-sm hover:shadow-md"
              >
                <div className="flex items-start gap-2 mb-1">
                  {category.icon && <span className="text-lg">{category.icon}</span>}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-800 truncate">{category.title}</div>
                    <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">{category.subtitle}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Sub-view: list of prompts with back button
  const prompts = getPromptsForCategory(activeCategory);
  const activeCategoryData = ROOT_CATEGORIES.find(c => c.id === activeCategory);

  return (
    <div className="px-6 py-4 border-t border-slate-100 bg-white/90 backdrop-blur-sm">
      <div className="max-w-3xl mx-auto">
        {/* Back button */}
        <button
          onClick={() => setActiveCategory('root')}
          className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-800 mb-4 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span>Back to Quick Start</span>
        </button>

        {/* Category title */}
        {activeCategoryData && (
          <div className="flex items-center gap-2 mb-3">
            {activeCategoryData.icon && <span className="text-lg">{activeCategoryData.icon}</span>}
            <h3 className="text-sm font-medium text-slate-800">{activeCategoryData.title}</h3>
          </div>
        )}

        {/* Prompt list */}
        <div className="space-y-2">
          {prompts.map((prompt, idx) => (
            <button
              key={idx}
              onClick={() => handlePromptClick(prompt)}
              className="w-full text-left bg-white border border-slate-100 rounded-xl p-3 hover:bg-blossom-pinkSoft/20 hover:border-blossom-pink/40 transition-all shadow-sm hover:shadow-md text-sm text-slate-700 hover:text-slate-900"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
