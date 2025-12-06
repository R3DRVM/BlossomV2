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
    <div className="w-full border-b border-blossom-outline/60 bg-blossom-pinkSoft/50 text-xs text-blossom-slate px-4 py-2">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-2">
          <BlossomLogo size={18} className="opacity-60" />
          <span>
            SIM mode · {USE_AGENT_BACKEND ? 'Real prices' : 'Mock data'} · No live orders
          </span>
        </div>
        <div className="flex items-center gap-2">
          <TickerStrip venue={venue} />
          {USE_AGENT_BACKEND && (
            <span className="text-[11px] text-blossom-slate ml-2 hidden sm:inline">
              Powered by Blossom Agent
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

