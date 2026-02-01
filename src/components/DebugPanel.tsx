/**
 * Debug Panel
 *
 * Admin-only panel showing build info, preflight status, and config issues.
 * Only visible when ?debug=1 query param is present.
 */

import { useState, useEffect } from 'react';
import { X, RefreshCw, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { callAgent } from '../lib/apiClient';

interface PreflightData {
  ok: boolean;
  swapEnabled: boolean;
  perpsEnabled: boolean;
  lendingEnabled: boolean;
  eventsEnabled: boolean;
  notes: string[];
  mode?: string;
  chainId?: number;
}

interface BuildInfo {
  sha: string;
  branch: string;
  env: string;
  time: string;
}

export default function DebugPanel() {
  const [isVisible, setIsVisible] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [preflight, setPreflight] = useState<PreflightData | null>(null);
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);
  const [backendHealth, setBackendHealth] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // Check if debug mode is enabled via query param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('debug') === '1') {
      setIsVisible(true);
      // Get frontend build info
      const windowBuild = (window as any).__BLOSSOM_BUILD__;
      if (windowBuild) {
        setBuildInfo(windowBuild);
      }
      // Fetch backend info
      refresh();
    }
  }, []);

  const refresh = async () => {
    setIsLoading(true);
    try {
      // Fetch preflight using callAgent (routes to proper backend URL)
      const preflightRes = await callAgent('/api/execute/preflight');
      if (preflightRes.ok) {
        setPreflight(await preflightRes.json());
      }

      // Fetch backend health using callAgent
      const healthRes = await callAgent('/health');
      if (healthRes.ok) {
        setBackendHealth(await healthRes.json());
      }

      setLastRefresh(new Date());
    } catch (err) {
      console.error('[DebugPanel] Refresh failed:', err);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isVisible) return null;

  const StatusIcon = ({ ok }: { ok: boolean }) => (
    ok ? <CheckCircle className="w-3 h-3 text-green-500" /> : <XCircle className="w-3 h-3 text-red-500" />
  );

  // Collapsed: just show badge
  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="fixed bottom-4 right-4 z-50 px-3 py-1.5 bg-slate-800 text-white text-xs font-mono rounded-full shadow-lg hover:bg-slate-700 transition-colors flex items-center gap-2"
      >
        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        {buildInfo?.sha || backendHealth?.gitSha || 'DEBUG'}
      </button>
    );
  }

  // Expanded: full panel
  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 bg-slate-900 text-white rounded-lg shadow-2xl border border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-800 border-b border-slate-700">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Debug Panel</span>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            disabled={isLoading}
            className="p-1 hover:bg-slate-700 rounded transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setIsExpanded(false)}
            className="p-1 hover:bg-slate-700 rounded transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-3 space-y-3 text-xs font-mono">
        {/* Build Info */}
        <div>
          <div className="text-slate-400 mb-1">Frontend Build</div>
          <div className="bg-slate-800 rounded p-2 space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-500">SHA:</span>
              <span className="text-green-400">{buildInfo?.sha || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Branch:</span>
              <span>{buildInfo?.branch || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Env:</span>
              <span className={buildInfo?.env === 'production' ? 'text-green-400' : 'text-yellow-400'}>
                {buildInfo?.env || '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Backend Health */}
        <div>
          <div className="text-slate-400 mb-1">Backend Health</div>
          <div className="bg-slate-800 rounded p-2 space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-500">SHA:</span>
              <span className="text-green-400">{backendHealth?.gitSha || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">LLM:</span>
              <span>{backendHealth?.llmProvider || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">DB:</span>
              <span>{backendHealth?.dbMode || '—'}</span>
            </div>
          </div>
        </div>

        {/* Preflight Status */}
        <div>
          <div className="text-slate-400 mb-1">Execution Venues</div>
          <div className="bg-slate-800 rounded p-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <span>Swaps</span>
              <StatusIcon ok={preflight?.swapEnabled ?? false} />
            </div>
            <div className="flex items-center justify-between">
              <span>Perps</span>
              <StatusIcon ok={preflight?.perpsEnabled ?? false} />
            </div>
            <div className="flex items-center justify-between">
              <span>Lending</span>
              <StatusIcon ok={preflight?.lendingEnabled ?? false} />
            </div>
            <div className="flex items-center justify-between">
              <span>Events</span>
              <StatusIcon ok={preflight?.eventsEnabled ?? false} />
            </div>
          </div>
        </div>

        {/* Notes/Warnings */}
        {preflight?.notes && preflight.notes.length > 0 && (
          <div>
            <div className="text-slate-400 mb-1 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-yellow-500" />
              Config Notes
            </div>
            <div className="bg-slate-800 rounded p-2 space-y-1 text-[10px] text-slate-400">
              {preflight.notes.map((note, i) => (
                <div key={i} className="break-words">• {note}</div>
              ))}
            </div>
          </div>
        )}

        {/* Last Refresh */}
        {lastRefresh && (
          <div className="text-[10px] text-slate-500 text-right">
            Updated: {lastRefresh.toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  );
}
