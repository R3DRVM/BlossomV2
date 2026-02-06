/**
 * IntentSuggestions Component
 *
 * Provides autocomplete suggestions for intent input based on user typing.
 * Shows categorized example intents when input is empty or matches patterns.
 * Features:
 * - Category-based suggestions (Trading, DeFi, Events, Portfolio)
 * - Fuzzy matching on partial input
 * - Keyboard navigation support
 * - Recent history integration
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  TrendingUp,
  TrendingDown,
  ArrowRightLeft,
  PiggyBank,
  Layers,
  History,
  Sparkles,
  ChevronRight,
} from 'lucide-react';

// Intent categories
export type IntentCategory = 'trading' | 'defi' | 'events' | 'portfolio' | 'recent';

// Suggestion interface
export interface IntentSuggestion {
  id: string;
  text: string;
  category: IntentCategory;
  description?: string;
  keywords: string[];
}

// Category configuration
const CATEGORY_CONFIG: Record<IntentCategory, {
  label: string;
  icon: typeof TrendingUp;
  color: string;
  bgColor: string;
}> = {
  trading: {
    label: 'Trading',
    icon: TrendingUp,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
  },
  defi: {
    label: 'DeFi',
    icon: PiggyBank,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
  },
  events: {
    label: 'Events',
    icon: Layers,
    color: 'text-amber-600',
    bgColor: 'bg-amber-50',
  },
  portfolio: {
    label: 'Portfolio',
    icon: ArrowRightLeft,
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-50',
  },
  recent: {
    label: 'Recent',
    icon: History,
    color: 'text-slate-600',
    bgColor: 'bg-slate-50',
  },
};

// Default suggestions by category
const DEFAULT_SUGGESTIONS: IntentSuggestion[] = [
  // Trading
  {
    id: 'trade-1',
    text: 'Long ETH with 3% risk',
    category: 'trading',
    description: 'Open a leveraged long position on Ethereum',
    keywords: ['long', 'eth', 'ethereum', 'buy', 'position'],
  },
  {
    id: 'trade-2',
    text: 'Short BTC with 2% risk at 10x',
    category: 'trading',
    description: 'Open a leveraged short position on Bitcoin',
    keywords: ['short', 'btc', 'bitcoin', 'sell', 'leverage'],
  },
  {
    id: 'trade-3',
    text: 'Hedge my SOL spot with perps',
    category: 'trading',
    description: 'Create a hedging position against spot holdings',
    keywords: ['hedge', 'sol', 'solana', 'spot', 'perp'],
  },
  {
    id: 'trade-4',
    text: 'Market-neutral BTC funding strategy',
    category: 'trading',
    description: 'Earn funding rates with neutral exposure',
    keywords: ['neutral', 'funding', 'btc', 'strategy'],
  },
  {
    id: 'trade-5',
    text: 'Close half my ETH position',
    category: 'trading',
    description: 'Partially close an existing position',
    keywords: ['close', 'half', 'eth', 'reduce'],
  },

  // DeFi
  {
    id: 'defi-1',
    text: 'Deposit $500 into Aave on Ethereum',
    category: 'defi',
    description: 'Supply assets to Aave lending protocol',
    keywords: ['deposit', 'aave', 'lend', 'supply', 'yield'],
  },
  {
    id: 'defi-2',
    text: 'Park 10% of my USDC into the safest yield',
    category: 'defi',
    description: 'Find optimal yield opportunity',
    keywords: ['yield', 'usdc', 'safe', 'park', 'deposit'],
  },
  {
    id: 'defi-3',
    text: 'Bridge 100 USDC from Ethereum to Solana',
    category: 'defi',
    description: 'Cross-chain asset transfer',
    keywords: ['bridge', 'usdc', 'ethereum', 'solana', 'transfer'],
  },
  {
    id: 'defi-4',
    text: 'Swap 50 USDC to ETH',
    category: 'defi',
    description: 'Token swap on current chain',
    keywords: ['swap', 'usdc', 'eth', 'exchange', 'trade'],
  },
  {
    id: 'defi-5',
    text: 'Withdraw all from Kamino',
    category: 'defi',
    description: 'Exit DeFi position',
    keywords: ['withdraw', 'kamino', 'exit', 'remove'],
  },

  // Events
  {
    id: 'event-1',
    text: 'Bet $50 YES on Trump wins 2024',
    category: 'events',
    description: 'Take a position on prediction market',
    keywords: ['bet', 'yes', 'trump', 'prediction', 'polymarket'],
  },
  {
    id: 'event-2',
    text: 'Risk 2% on the highest-volume prediction market',
    category: 'events',
    description: 'Find trending event markets',
    keywords: ['risk', 'prediction', 'volume', 'trending'],
  },
  {
    id: 'event-3',
    text: 'Show top 5 prediction markets on Polymarket',
    category: 'events',
    description: 'Browse popular event markets',
    keywords: ['show', 'top', 'polymarket', 'markets', 'list'],
  },

  // Portfolio
  {
    id: 'portfolio-1',
    text: 'Show my current exposure',
    category: 'portfolio',
    description: 'View all open positions and risk',
    keywords: ['show', 'exposure', 'positions', 'risk', 'portfolio'],
  },
  {
    id: 'portfolio-2',
    text: 'What are my riskiest positions?',
    category: 'portfolio',
    description: 'Identify high-risk holdings',
    keywords: ['risk', 'positions', 'riskiest', 'analyze'],
  },
  {
    id: 'portfolio-3',
    text: 'Reduce overall portfolio risk by 20%',
    category: 'portfolio',
    description: 'Systematic risk reduction',
    keywords: ['reduce', 'risk', 'portfolio', 'rebalance'],
  },
  {
    id: 'portfolio-4',
    text: 'Show my PnL for today',
    category: 'portfolio',
    description: 'View profit and loss summary',
    keywords: ['pnl', 'profit', 'loss', 'today', 'performance'],
  },
];

// Local storage key for recent intents
const RECENT_INTENTS_KEY = 'blossom_recent_intents';
const MAX_RECENT_INTENTS = 5;

// Get recent intents from storage
function getRecentIntents(): IntentSuggestion[] {
  try {
    const stored = localStorage.getItem(RECENT_INTENTS_KEY);
    if (!stored) return [];
    const recent = JSON.parse(stored) as string[];
    return recent.slice(0, MAX_RECENT_INTENTS).map((text, idx) => ({
      id: `recent-${idx}`,
      text,
      category: 'recent' as IntentCategory,
      keywords: text.toLowerCase().split(/\s+/),
    }));
  } catch {
    return [];
  }
}

// Save intent to recent history
export function saveRecentIntent(text: string): void {
  try {
    const stored = localStorage.getItem(RECENT_INTENTS_KEY);
    const recent = stored ? (JSON.parse(stored) as string[]) : [];

    // Remove if already exists
    const filtered = recent.filter((r) => r.toLowerCase() !== text.toLowerCase());

    // Add to front
    filtered.unshift(text);

    // Limit to max
    const limited = filtered.slice(0, MAX_RECENT_INTENTS);

    localStorage.setItem(RECENT_INTENTS_KEY, JSON.stringify(limited));
  } catch {
    // Ignore storage errors
  }
}

interface IntentSuggestionsProps {
  inputValue: string;
  onSelect: (suggestion: IntentSuggestion) => void;
  isVisible: boolean;
  onClose: () => void;
  maxSuggestions?: number;
  className?: string;
}

export default function IntentSuggestions({
  inputValue,
  onSelect,
  isVisible,
  onClose,
  maxSuggestions = 6,
  className = '',
}: IntentSuggestionsProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Get all suggestions including recent
  const allSuggestions = useMemo(() => {
    const recent = getRecentIntents();
    return [...recent, ...DEFAULT_SUGGESTIONS];
  }, []);

  // Filter and score suggestions based on input
  const filteredSuggestions = useMemo(() => {
    const query = inputValue.toLowerCase().trim();

    if (!query) {
      // Show mix of categories when empty
      const byCategory = new Map<IntentCategory, IntentSuggestion[]>();
      allSuggestions.forEach((s) => {
        const list = byCategory.get(s.category) || [];
        list.push(s);
        byCategory.set(s.category, list);
      });

      // Get 1-2 from each category, prioritize recent
      const result: IntentSuggestion[] = [];
      const recent = byCategory.get('recent') || [];
      result.push(...recent.slice(0, 2));

      ['trading', 'defi', 'events', 'portfolio'].forEach((cat) => {
        const catSuggestions = byCategory.get(cat as IntentCategory) || [];
        const remaining = maxSuggestions - result.length;
        if (remaining > 0) {
          result.push(...catSuggestions.slice(0, Math.ceil(remaining / 4)));
        }
      });

      return result.slice(0, maxSuggestions);
    }

    // Score each suggestion based on query match
    const scored = allSuggestions.map((suggestion) => {
      let score = 0;

      // Direct text match (highest weight)
      if (suggestion.text.toLowerCase().includes(query)) {
        score += 100;
      }

      // Keyword matches
      const queryWords = query.split(/\s+/);
      queryWords.forEach((word) => {
        if (suggestion.keywords.some((k) => k.includes(word))) {
          score += 10;
        }
      });

      // Starts with query (bonus)
      if (suggestion.text.toLowerCase().startsWith(query)) {
        score += 50;
      }

      // Recent bonus
      if (suggestion.category === 'recent') {
        score += 5;
      }

      return { suggestion, score };
    });

    // Filter to minimum score and sort
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSuggestions)
      .map((s) => s.suggestion);
  }, [inputValue, allSuggestions, maxSuggestions]);

  // Reset selection when suggestions change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredSuggestions]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isVisible || filteredSuggestions.length === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => (i + 1) % filteredSuggestions.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) =>
            i === 0 ? filteredSuggestions.length - 1 : i - 1
          );
          break;
        case 'Enter':
          if (filteredSuggestions[selectedIndex]) {
            e.preventDefault();
            onSelect(filteredSuggestions[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'Tab':
          if (filteredSuggestions[selectedIndex]) {
            e.preventDefault();
            onSelect(filteredSuggestions[selectedIndex]);
          }
          break;
      }
    },
    [isVisible, filteredSuggestions, selectedIndex, onSelect, onClose]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    if (isVisible) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isVisible, onClose]);

  if (!isVisible || filteredSuggestions.length === 0) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className={`absolute bottom-full left-0 right-0 mb-2 bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden z-50 ${className}`}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-slate-100 bg-gradient-to-r from-pink-50 to-white">
        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
          <Sparkles className="w-3 h-3 text-pink-400" />
          <span className="font-medium">Suggestions</span>
          <span className="text-slate-400">- Use arrows to navigate, Enter to select</span>
        </div>
      </div>

      {/* Suggestions list */}
      <div className="max-h-[280px] overflow-y-auto">
        {filteredSuggestions.map((suggestion, index) => {
          const config = CATEGORY_CONFIG[suggestion.category];
          const Icon = config.icon;
          const isSelected = index === selectedIndex;

          return (
            <button
              key={suggestion.id}
              onClick={() => onSelect(suggestion)}
              onMouseEnter={() => setSelectedIndex(index)}
              className={`
                w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors
                ${isSelected ? 'bg-pink-50' : 'hover:bg-slate-50'}
              `}
            >
              {/* Category icon */}
              <div className={`flex-shrink-0 w-7 h-7 rounded-lg ${config.bgColor} flex items-center justify-center`}>
                <Icon className={`w-3.5 h-3.5 ${config.color}`} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="text-sm text-slate-900 truncate">
                  {highlightMatch(suggestion.text, inputValue)}
                </div>
                {suggestion.description && (
                  <div className="text-[10px] text-slate-500 truncate mt-0.5">
                    {suggestion.description}
                  </div>
                )}
              </div>

              {/* Category badge */}
              <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-medium ${config.bgColor} ${config.color}`}>
                {config.label}
              </span>

              {/* Arrow indicator for selected */}
              {isSelected && (
                <ChevronRight className="w-3.5 h-3.5 text-pink-400 flex-shrink-0" />
              )}
            </button>
          );
        })}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-1.5 border-t border-slate-100 bg-slate-50">
        <div className="text-[9px] text-slate-400 text-center">
          Press <kbd className="px-1 py-0.5 bg-white rounded border border-slate-200 font-mono">Tab</kbd> to autocomplete
        </div>
      </div>
    </div>
  );
}

// Helper to highlight matching text
function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase().trim();
  const index = lowerText.indexOf(lowerQuery);

  if (index === -1) return text;

  return (
    <>
      {text.slice(0, index)}
      <span className="bg-pink-100 text-pink-700 font-medium">
        {text.slice(index, index + lowerQuery.length)}
      </span>
      {text.slice(index + lowerQuery.length)}
    </>
  );
}

// Export suggestions for use elsewhere
export { DEFAULT_SUGGESTIONS, CATEGORY_CONFIG };
