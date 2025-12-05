import { useBlossomContext } from '../context/BlossomContext';
import { BlossomLogo } from './BlossomLogo';

export default function Header() {
  const { venue, setVenue } = useBlossomContext();

  return (
    <header className="bg-white/95 backdrop-blur-sm border-b border-blossom-outline/60 h-14 flex items-center sticky top-0 z-20">
      <div className="px-6 w-full flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BlossomLogo size={24} className="drop-shadow-sm" />
          <div className="flex flex-col">
            <h1 className="text-sm font-semibold text-blossom-ink leading-tight">Blossom</h1>
            <p className="text-xs text-blossom-slate leading-tight">AI Trading Copilot</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setVenue('hyperliquid')}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-all flex items-center gap-1.5 ${
              venue === 'hyperliquid'
                ? 'bg-white text-blossom-ink shadow-sm border border-blossom-pink/40'
                : 'bg-transparent text-blossom-slate hover:bg-white/40 hover:text-blossom-ink'
            }`}
          >
            {venue === 'hyperliquid' && (
              <span className="h-1.5 w-1.5 rounded-full bg-blossom-pink" />
            )}
            Hyperliquid
          </button>
          <button
            onClick={() => setVenue('event_demo')}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-all flex items-center gap-1.5 ${
              venue === 'event_demo'
                ? 'bg-white text-blossom-ink shadow-sm border border-blossom-pink/40'
                : 'bg-transparent text-blossom-slate hover:bg-white/40 hover:text-blossom-ink'
            }`}
          >
            {venue === 'event_demo' && (
              <span className="h-1.5 w-1.5 rounded-full bg-blossom-pink" />
            )}
            Event Markets
          </button>
        </div>
      </div>
    </header>
  );
}
