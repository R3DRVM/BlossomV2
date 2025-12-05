import { useBlossomContext } from '../context/BlossomContext';

export default function TabNav() {
  const { activeTab, setActiveTab } = useBlossomContext();

  return (
    <div className="bg-white/95 backdrop-blur-sm border-b border-blossom-outline/60 px-6 py-2">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setActiveTab('copilot')}
          className={`px-4 py-2 text-sm rounded-full transition-all ${
            activeTab === 'copilot'
              ? 'bg-white text-blossom-ink shadow-sm border border-blossom-pink/40 font-semibold border-t-2 border-t-blossom-pink'
              : 'bg-transparent text-blossom-slate hover:bg-white/40 hover:text-blossom-ink font-medium'
          }`}
        >
          Copilot
        </button>
        <button
          onClick={() => setActiveTab('risk')}
          className={`px-4 py-2 text-sm rounded-full transition-all ${
            activeTab === 'risk'
              ? 'bg-white text-blossom-ink shadow-sm border border-blossom-pink/40 font-semibold border-t-2 border-t-blossom-pink'
              : 'bg-transparent text-blossom-slate hover:bg-white/40 hover:text-blossom-ink font-medium'
          }`}
        >
          Risk Center
        </button>
        <button
          onClick={() => setActiveTab('portfolio')}
          className={`px-4 py-2 text-sm rounded-full transition-all ${
            activeTab === 'portfolio'
              ? 'bg-white text-blossom-ink shadow-sm border border-blossom-pink/40 font-semibold border-t-2 border-t-blossom-pink'
              : 'bg-transparent text-blossom-slate hover:bg-white/40 hover:text-blossom-ink font-medium'
          }`}
        >
          Portfolio
        </button>
      </div>
    </div>
  );
}
