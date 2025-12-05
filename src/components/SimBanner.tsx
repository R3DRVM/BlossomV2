/**
 * SIM Mode Banner
 * Persistent banner indicating simulation mode
 */

import { USE_AGENT_BACKEND } from '../lib/config';
import { BlossomLogo } from './BlossomLogo';

export function SimBanner() {
  return (
    <div className="w-full border-b border-blossom-outline/60 bg-blossom-pinkLight/30 text-xs text-blossom-ink px-4 py-2 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <BlossomLogo size={18} className="opacity-60" />
        <span>
          SIM mode · {USE_AGENT_BACKEND ? 'Real prices' : 'Mock data'} · No live orders
        </span>
      </div>
      {USE_AGENT_BACKEND && (
        <span className="text-[11px] text-blossom-slate">
          Powered by Blossom Agent
        </span>
      )}
    </div>
  );
}

