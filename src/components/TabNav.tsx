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
              ? 'bg-white/90 text-blossom-ink shadow-sm border-b-2 border-b-blossom-pink ring-1 ring-blossom-pink/40 font-semibold'
              : 'bg-transparent text-blossom-slate hover:bg-white/60 hover:text-blossom-ink font-medium'
          }`}
        >
          Copilot
        </button>
        {/* Risk Center and Portfolio tabs hidden for beta */}
        {/* TODO: Re-enable these tabs post-beta launch */}
      </div>
    </div>
  );
}
