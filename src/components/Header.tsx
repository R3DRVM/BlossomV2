import { useBlossomContext } from '../context/BlossomContext';

export default function Header() {
  const { venue, setVenue, resetSim } = useBlossomContext();

  return (
    <header className="bg-white border-b border-gray-200">
      <div className="px-6 py-3 flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <div className="text-2xl">🌸</div>
            <h1 className="text-lg font-semibold text-gray-900">
              Blossom – AI Trading Copilot
            </h1>
          </div>
          <p className="text-xs text-gray-500 ml-11">
            Natural-language perps execution • Risk automation • DeFi aggregation (coming soon)
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-gray-100 rounded-full p-1">
            <button className="px-4 py-1.5 bg-white rounded-full text-sm font-medium text-gray-900 shadow-sm">
              SIM
            </button>
            <button 
              onClick={() => {
                // Show a simple alert for now - could be replaced with toast
                alert('This prototype runs in simulation only. No real trading is performed.');
              }}
              className="px-4 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-700"
            >
              LIVE
            </button>
          </div>
          <div className="relative">
            <select
              value={venue}
              onChange={(e) => setVenue(e.target.value as 'hyperliquid' | 'event_demo')}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="hyperliquid">Hyperliquid (Perps - Demo)</option>
              <option value="event_demo">Event Markets (Demo)</option>
            </select>
          </div>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-400 to-pink-400"></div>
        </div>
      </div>
    </header>
  );
}

