import { useState, useEffect, useRef, useMemo } from 'react';
import { useBlossomContext } from '../context/BlossomContext';
import { computeOpenPositionsList } from '../lib/portfolioComputed';
import { Search, ArrowRight } from 'lucide-react';

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  category: 'navigate' | 'position' | 'action';
  action: () => void;
}

interface CommandBarProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tab: 'copilot' | 'risk' | 'portfolio') => void;
  onInsertChatPrompt: (text: string) => void;
}

export default function CommandBar({ isOpen, onClose, onNavigate, onInsertChatPrompt }: CommandBarProps) {
  const { strategies, defiPositions, setActiveTab } = useBlossomContext();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Get open positions
  const openPositions = useMemo(() => computeOpenPositionsList(strategies, defiPositions), [strategies, defiPositions]);

  // Build command items
  const allCommands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [];

    // Navigation commands
    items.push({
      id: 'nav-copilot',
      label: 'Go to Copilot',
      description: 'Open the chat interface',
      category: 'navigate',
      action: () => {
        setActiveTab('copilot');
        onNavigate('copilot');
        onClose();
      },
    });
    // Risk Center and Portfolio Overview hidden for beta
    // TODO: Re-enable these commands post-beta launch
    // items.push({
    //   id: 'nav-risk',
    //   label: 'Go to Risk Center',
    //   description: 'View risk metrics and alerts',
    //   category: 'navigate',
    //   action: () => {
    //     setActiveTab('risk');
    //     onNavigate('risk');
    //     onClose();
    //   },
    // });
    // items.push({
    //   id: 'nav-portfolio',
    //   label: 'Go to Portfolio Overview',
    //   description: 'View portfolio performance',
    //   category: 'navigate',
    //   action: () => {
    //     setActiveTab('portfolio');
    //     onNavigate('portfolio');
    //     onClose();
    //   },
    // });

    // Position commands
    openPositions.forEach((pos) => {
      const typeLabel = pos.type === 'perp' ? 'Perp' : pos.type === 'event' ? 'Event' : 'DeFi';
      const sideLabel = pos.side ? ` ${pos.side}` : '';
      items.push({
        id: `pos-${pos.id}`,
        label: `${pos.market}${sideLabel}`,
        description: `${typeLabel} position`,
        category: 'position',
      action: () => {
        setActiveTab('copilot');
        onNavigate('copilot');
        // Dispatch custom event for RightPanel to handle
        // Use setTimeout to ensure tab switch completes first
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent('focusRightPanelPosition', {
              detail: { positionId: pos.id, positionType: pos.type },
            })
          );
        }, 150);
        onClose();
      },
      });
    });

    // Action commands
    items.push({
      id: 'action-reduce-leverage',
      label: 'Reduce leverage',
      description: 'Reduce leverage on open positions',
      category: 'action',
      action: () => {
        setActiveTab('copilot');
        onNavigate('copilot');
        onInsertChatPrompt('Reduce leverage on my open positions');
        onClose();
      },
    });
    items.push({
      id: 'action-close-25',
      label: 'Close 25%',
      description: 'Close 25% of open positions',
      category: 'action',
      action: () => {
        setActiveTab('copilot');
        onNavigate('copilot');
        onInsertChatPrompt('Close 25% of my open positions');
        onClose();
      },
    });
    items.push({
      id: 'action-add-stop-loss',
      label: 'Add stop loss',
      description: 'Add stop loss to positions without one',
      category: 'action',
      action: () => {
        setActiveTab('copilot');
        onNavigate('copilot');
        onInsertChatPrompt('Add stop loss to my positions without one');
        onClose();
      },
    });
    items.push({
      id: 'action-hedge',
      label: 'Hedge exposure',
      description: 'Hedge my current exposure',
      category: 'action',
      action: () => {
        setActiveTab('copilot');
        onNavigate('copilot');
        onInsertChatPrompt('Hedge my current exposure');
        onClose();
      },
    });

    return items;
  }, [openPositions, onNavigate, onClose, onInsertChatPrompt, setActiveTab]);

  // Filter commands based on query
  const filteredCommands = useMemo(() => {
    if (!query.trim()) return allCommands;
    const lowerQuery = query.toLowerCase();
    return allCommands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(lowerQuery) ||
        cmd.description?.toLowerCase().includes(lowerQuery) ||
        cmd.category === lowerQuery
    );
  }, [allCommands, query]);

  // Reset selected index when filtered results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredCommands.length]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          filteredCommands[selectedIndex].action();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredCommands, selectedIndex, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current && filteredCommands.length > 0) {
      const selectedElement = listRef.current.children[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [selectedIndex, filteredCommands.length]);

  if (!isOpen) return null;

  const getCategoryLabel = (category: string) => {
    switch (category) {
      case 'navigate':
        return 'Navigation';
      case 'position':
        return 'Positions';
      case 'action':
        return 'Actions';
      default:
        return category;
    }
  };

  // Group commands by category
  const groupedCommands = filteredCommands.reduce((acc, cmd) => {
    if (!acc[cmd.category]) {
      acc[cmd.category] = [];
    }
    acc[cmd.category].push(cmd);
    return acc;
  }, {} as Record<string, CommandItem[]>);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] px-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Command Bar Modal */}
      <div className="relative w-full max-w-2xl bg-white rounded-lg border border-slate-200 shadow-xl">
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200">
          <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search..."
            className="flex-1 text-sm text-slate-900 placeholder-slate-400 outline-none bg-transparent"
            autoComplete="off"
          />
          <div className="flex items-center gap-1 text-xs text-slate-400">
            <kbd className="px-1.5 py-0.5 bg-slate-100 rounded text-[10px] font-mono">
              {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}
            </kbd>
            <span className="text-[10px]">+</span>
            <kbd className="px-1.5 py-0.5 bg-slate-100 rounded text-[10px] font-mono">K</kbd>
          </div>
        </div>

        {/* Results List */}
        <div
          ref={listRef}
          className="max-h-96 overflow-y-auto"
        >
          {filteredCommands.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              No commands found
            </div>
          ) : (
            Object.entries(groupedCommands).map(([category, commands]) => (
              <div key={category} className="py-2">
                <div className="px-4 py-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                  {getCategoryLabel(category)}
                </div>
                {commands.map((cmd) => {
                  const globalIndex = filteredCommands.indexOf(cmd);
                  const isSelected = globalIndex === selectedIndex;
                  return (
                    <button
                      key={cmd.id}
                      onClick={cmd.action}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 transition-colors ${
                        isSelected ? 'bg-pink-50 border-l-2 border-pink-500' : ''
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-900">{cmd.label}</div>
                        {cmd.description && (
                          <div className="text-xs text-slate-500 mt-0.5">{cmd.description}</div>
                        )}
                      </div>
                      <ArrowRight className={`w-4 h-4 text-slate-400 flex-shrink-0 ${isSelected ? 'text-pink-500' : ''}`} />
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-slate-200 bg-slate-50/50">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Navigate with ↑↓ • Select with Enter • Close with Esc</span>
            <span className="text-[10px]">{filteredCommands.length} result{filteredCommands.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

