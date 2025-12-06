/**
 * SIM Mode Banner
 * Persistent banner indicating simulation mode with ticker strip
 */

import { USE_AGENT_BACKEND } from '../lib/config';
import { BlossomLogo } from './BlossomLogo';
import { TickerStrip } from './TickerStrip';
import { useBlossomContext } from '../context/BlossomContext';

export function SimBanner() {
  const { venue } = useBlossomContext();

  return (
    <section className="w-full border-b border-blossom-outline/40 bg-white/70 backdrop-blur-md">
      <div className="mx-auto flex items-center justify-between px-4 py-2 gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <BlossomLogo size={14} className="opacity-70 flex-shrink-0" />
          <div className="flex items-center gap-2 text-[11px] text-blossom-slate whitespace-nowrap">
            <span>SIM mode</span>
            <span className="text-blossom-slate/50">·</span>
            <span>{USE_AGENT_BACKEND ? 'Real prices' : 'Mock data'}</span>
            <span className="text-blossom-slate/50">·</span>
            <span>No live orders</span>
          </div>
        </div>
        <TickerStrip venue={venue} />
      </div>
    </section>
  );
}

