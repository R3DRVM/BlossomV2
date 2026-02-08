import { useBlossomContext } from '../context/BlossomContext';
import { BlossomLogo } from './BlossomLogo';
import { useERC8004Identity } from '../hooks/useERC8004';
import { CheckCircle } from 'lucide-react';

export default function Header() {
  const { venue, setVenue } = useBlossomContext();
  const { isRegistered, isEnabled } = useERC8004Identity();

  return (
    <header className="bg-white/95 backdrop-blur-sm border-b border-blossom-outline/60 h-10 flex items-center sticky top-0 z-20">
      <div className="px-6 w-full flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BlossomLogo size={24} className="drop-shadow-sm" />
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm font-semibold text-blossom-ink leading-tight">Blossom</h1>
              <span className="px-1.5 py-0.5 text-[10px] font-bold tracking-wide bg-emerald-500/15 text-emerald-600 border border-emerald-500/30 rounded">
                LIVE
              </span>
              {/* Verified Agent Badge - only show when registered */}
              {isEnabled && isRegistered && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 rounded flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" />
                  Verified
                </span>
              )}
            </div>
            <p className="text-xs text-blossom-slate leading-tight">AI Trading Copilot</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setVenue('hyperliquid')}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-all flex items-center gap-1.5 ${
              venue === 'hyperliquid'
                ? 'bg-white/90 text-blossom-ink shadow-sm border border-blossom-pink/40'
                : 'bg-transparent text-blossom-slate hover:bg-white/60 hover:text-blossom-ink'
            }`}
          >
            {venue === 'hyperliquid' && (
              <span className="mr-2 inline-flex h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_2px_rgba(255,255,255,0.8)]" />
            )}
            <span>On-chain</span>
          </button>
          <button
            onClick={() => setVenue('event_demo')}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-all flex items-center gap-1.5 ${
              venue === 'event_demo'
                ? 'bg-white/90 text-blossom-ink shadow-sm border border-blossom-pink/40'
                : 'bg-transparent text-blossom-slate hover:bg-white/60 hover:text-blossom-ink'
            }`}
          >
            {venue === 'event_demo' && (
              <span className="mr-2 inline-flex h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_2px_rgba(255,255,255,0.8)]" />
            )}
            <span>Event Markets</span>
          </button>
        </div>
      </div>
    </header>
  );
}
