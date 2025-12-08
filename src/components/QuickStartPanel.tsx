import { useState } from 'react';
import { QUICK_START_CATEGORIES, QuickStartCategoryId } from '../config/quickStartConfig';

interface QuickStartPanelProps {
  onSelectPrompt: (prompt: string) => void;
}

export default function QuickStartPanel({ onSelectPrompt }: QuickStartPanelProps) {
  const [selectedCategoryId, setSelectedCategoryId] = useState<QuickStartCategoryId | null>(null);

  // Root view: show category grid
  if (selectedCategoryId === null) {
    return (
      <div className="mt-3 px-4 pb-4">
        <div className="rounded-2xl border border-slate-100 bg-white/90 shadow-sm px-3 py-2.5 max-h-40 overflow-y-auto">
          <div className="mb-1.5">
            <h3 className="text-[10px] font-semibold tracking-[0.18em] text-slate-500 uppercase">QUICK START</h3>
            <div className="h-px bg-slate-100 mt-1"></div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {QUICK_START_CATEGORIES.map((category) => (
              <button
                key={category.id}
                onClick={() => setSelectedCategoryId(category.id)}
                className="rounded-xl border border-slate-100 bg-white px-2.5 py-2 hover:bg-pink-50/60 hover:border-pink-200 transition-all cursor-pointer text-left"
              >
                <div className="text-[11px] font-medium text-slate-900">
                  {category.label}
                </div>
                <div className="mt-0.5 text-[10px] text-slate-500">
                  {category.description}
                </div>
              </button>
            ))}
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

