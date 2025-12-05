import { useBlossomContext } from '../context/BlossomContext';
import { BlossomLogo } from './BlossomLogo';

export default function Header() {
  const { venue, setVenue } = useBlossomContext();

  return (
    <header className="bg-white border-b border-blossom-outline h-16 flex items-center">
      <div className="px-6 w-full flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BlossomLogo className="h-7 w-7 drop-shadow-sm" />
          <div className="flex flex-col">
            <h1 className="text-lg font-semibold text-blossom-ink leading-tight">Blossom</h1>
            <p className="text-xs text-blossom-slate leading-tight">AI Trading Copilot</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setVenue('hyperliquid')}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
              venue === 'hyperliquid'
                ? 'bg-blossom-pink text-white'
                : 'bg-white text-blossom-slate border border-blossom-outline hover:bg-blossom-pinkLight'
            }`}
          >
            Hyperliquid
          </button>
          <button
            onClick={() => setVenue('event_demo')}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
              venue === 'event_demo'
                ? 'bg-blossom-pink text-white'
                : 'bg-white text-blossom-slate border border-blossom-outline hover:bg-blossom-pinkLight'
            }`}
          >
            Event Markets
          </button>
        </div>
      </div>
    </header>
  );
}
