/**
 * SIM Mode Banner
 * Persistent banner indicating simulation mode
 */

import { USE_AGENT_BACKEND } from '../lib/config';

export function SimBanner() {
  return (
    <div className="w-full border-b border-purple-300/30 bg-purple-50/60 text-xs text-purple-900 px-4 py-2 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-2 w-2 rounded-full bg-purple-500" />
        <span>
          Blossom is running in <strong>SIM mode</strong>
          {USE_AGENT_BACKEND ? ' with real market prices' : ''}. No real orders are placed.
        </span>
      </div>
      <span className="text-[11px] text-purple-700/70">
        Environment: {USE_AGENT_BACKEND ? 'Agent (LLM + sims)' : 'Local mock'}
      </span>
    </div>
  );
}

