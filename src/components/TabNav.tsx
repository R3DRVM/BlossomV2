import { useBlossomContext } from '../context/BlossomContext';

export default function TabNav() {
  const { activeTab, setActiveTab } = useBlossomContext();

  return (
    <div className="bg-white border-b border-gray-200 px-6 py-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setActiveTab('copilot')}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            activeTab === 'copilot'
              ? 'bg-purple-500 text-white'
              : 'bg-transparent border border-gray-300 text-gray-700 hover:bg-gray-50'
          }`}
        >
          Copilot
        </button>
        <button
          onClick={() => setActiveTab('risk')}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            activeTab === 'risk'
              ? 'bg-purple-500 text-white'
              : 'bg-transparent border border-gray-300 text-gray-700 hover:bg-gray-50'
          }`}
        >
          Risk Center
        </button>
        <button
          onClick={() => setActiveTab('portfolio')}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            activeTab === 'portfolio'
              ? 'bg-purple-500 text-white'
              : 'bg-transparent border border-gray-300 text-gray-700 hover:bg-gray-50'
          }`}
        >
          Portfolio
        </button>
      </div>
    </div>
  );
}

