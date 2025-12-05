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
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-all ${
              venue === 'hyperliquid'
                ? 'bg-blossom-pinkSoft text-blossom-ink border-transparent shadow-sm'
                : 'bg-white/70 text-blossom-slate border border-blossom-outline/60 hover:bg-white/90 hover:shadow-sm'
            }`}
          >
            Hyperliquid
          </button>
          <button
            onClick={() => setVenue('event_demo')}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-all ${
              venue === 'event_demo'
                ? 'bg-blossom-pinkSoft text-blossom-ink border-transparent shadow-sm'
                : 'bg-white/70 text-blossom-slate border border-blossom-outline/60 hover:bg-white/90 hover:shadow-sm'
            }`}
          >
            Event Markets
          </button>
        </div>
      </div>
    </header>
  );
}
