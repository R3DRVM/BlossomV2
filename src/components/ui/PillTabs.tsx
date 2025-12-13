
export interface PillTab {
  id: string;
  label: string;
  count?: number;
}

interface PillTabsProps {
  tabs: PillTab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  className?: string;
}

export default function PillTabs({ tabs, activeTab, onTabChange, className = '' }: PillTabsProps) {
  return (
    <div className={`flex items-center gap-1 border-b border-slate-100 ${className}`}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`px-2 py-1 text-[10px] font-medium transition-colors border-b-2 ${
            activeTab === tab.id
              ? 'border-pink-500 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          {tab.label}
          {tab.count !== undefined && tab.count > 0 && (
            <span className="ml-1 text-[9px] text-slate-400">({tab.count})</span>
          )}
        </button>
      ))}
    </div>
  );
}

