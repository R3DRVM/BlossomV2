/**
 * SIM Mode Banner
 * Persistent banner indicating simulation mode (ticker removed - now in center panel only)
 */

import { USE_AGENT_BACKEND } from '../lib/config';
import { BlossomLogo } from './BlossomLogo';

export function SimBanner() {
  return (
    <section className="w-full border-b border-blossom-outline/40 bg-white/70 backdrop-blur-md">
      <div className="mx-auto flex items-center px-4 py-1.5">
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
      </div>
    </section>
  );
}

