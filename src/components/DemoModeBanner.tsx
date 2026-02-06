/**
 * Demo Mode Banner
 *
 * Always-visible indicator showing this is Sepolia testnet mode.
 * Provides faucet links and demo token info.
 */

import { useState } from 'react';
import { TestTube2, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { FAUCET_URLS, DEMO_TOKEN_INFO } from '../lib/executionGuard';

interface DemoModeBannerProps {
  className?: string;
  compact?: boolean;
}

export default function DemoModeBanner({ className = '', compact = false }: DemoModeBannerProps) {
  const [expanded, setExpanded] = useState(false);

  if (compact) {
    return (
      <div className={`flex items-center gap-1.5 px-2 py-1 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700 ${className}`}>
        <TestTube2 className="w-3 h-3" />
        <span>Demo Mode: Sepolia Testnet</span>
      </div>
    );
  }

  return (
    <div className={`bg-amber-50 border border-amber-200 rounded-lg ${className}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 text-amber-700 hover:bg-amber-100/50 transition-colors rounded-lg"
      >
        <div className="flex items-center gap-2">
          <TestTube2 className="w-4 h-4" />
          <span className="text-sm font-medium">Demo Mode: Sepolia Testnet</span>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4" />
        ) : (
          <ChevronDown className="w-4 h-4" />
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3">
          <p className="text-xs text-amber-600">
            Testnet only. No real funds are used, and all balances are demo bUSDC.
            Execution may fail if your wallet lacks Sepolia gas.
          </p>

          <div className="space-y-2">
            <h4 className="text-xs font-medium text-amber-800">Get Testnet ETH for Gas:</h4>
            <div className="flex flex-wrap gap-2">
              <a
                href={FAUCET_URLS.sepoliaEth}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 px-2 py-1 bg-white border border-amber-200 rounded text-xs text-amber-700 hover:bg-amber-50 transition-colors"
              >
                Sepolia Faucet
                <ExternalLink className="w-3 h-3" />
              </a>
              <a
                href={FAUCET_URLS.sepoliaAlt}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 px-2 py-1 bg-white border border-amber-200 rounded text-xs text-amber-700 hover:bg-amber-50 transition-colors"
              >
                Alchemy Faucet
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-medium text-amber-800">Demo Token Addresses:</h4>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-amber-600">bUSDC:</span>
                <code className="font-mono text-amber-800 bg-white px-1 rounded">
                  {DEMO_TOKEN_INFO.usdc.address.slice(0, 10)}...
                </code>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-amber-600">WETH:</span>
                <code className="font-mono text-amber-800 bg-white px-1 rounded">
                  {DEMO_TOKEN_INFO.weth.address.slice(0, 10)}...
                </code>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
