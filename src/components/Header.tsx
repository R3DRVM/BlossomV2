import { useBlossomContext } from '../context/BlossomContext';
import { BlossomLogo } from './BlossomLogo';
import { useERC8004Identity, useERC8004Reputation } from '../hooks/useERC8004';
import { Shield, CheckCircle } from 'lucide-react';

export default function Header() {
  const { venue, setVenue } = useBlossomContext();
  const { isRegistered, agentId, isEnabled } = useERC8004Identity();
  const { tier, score, formattedScore } = useERC8004Reputation();

  return (
    <header className="bg-white/95 backdrop-blur-sm border-b border-blossom-outline/60 h-10 flex items-center sticky top-0 z-20">
      <div className="px-6 w-full flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BlossomLogo size={24} className="drop-shadow-sm" />
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm font-semibold text-blossom-ink leading-tight">Blossom</h1>
              <span className="px-1.5 py-0.5 text-[10px] font-bold tracking-wide bg-blossom-pink/15 text-blossom-pink border border-blossom-pink/30 rounded">
                BETA
              </span>
            </div>
            <p className="text-xs text-blossom-slate leading-tight">AI Trading Copilot</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* ERC-8004 Agent Badge */}
          {isEnabled && (
            <div
              className={`px-2 py-1 text-[10px] font-medium rounded-full flex items-center gap-1 border ${
                isRegistered
                  ? tier === 'excellent' || tier === 'good'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : tier === 'fair' || tier === 'neutral'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-slate-50 text-slate-600 border-slate-200'
                  : 'bg-slate-50 text-slate-500 border-slate-200'
              }`}
              title={isRegistered ? `Agent #${agentId} | ${formattedScore}` : 'Agent not registered'}
            >
              {isRegistered ? (
                <>
                  <CheckCircle className="w-3 h-3" />
                  <span>Agent #{agentId}</span>
                  <span className="opacity-70">|</span>
                  <span className="capitalize">{tier}</span>
                </>
              ) : (
                <>
                  <Shield className="w-3 h-3" />
                  <span>Unverified</span>
                </>
              )}
            </div>
          )}

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
