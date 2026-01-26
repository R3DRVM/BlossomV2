/**
 * Execution Statistics Dashboard
 *
 * Two modes:
 * - Dev mode (default): Requires VITE_DEV_LEDGER_SECRET, shows verification panel
 * - Public mode (isPublic=true): Read-only, no auth required, no verification panel
 *
 * Route: /dev/stats (dev) or /stats (public) or stats.blossom.onl (public)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart3,
  RefreshCw,
  ArrowLeft,
  CheckCircle,
  XCircle,
  Clock,
  ExternalLink,
  DollarSign,
  Zap,
  Send,
  AlertTriangle,
  Server,
  ChevronDown,
  ChevronRight,
  Activity,
  Copy,
  AlertOctagon,
  Globe,
  Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { executeIntent, type IntentExecutionResult } from '../lib/apiClient';

// The secret MUST be configured in env for dev mode
const LEDGER_SECRET = import.meta.env.VITE_DEV_LEDGER_SECRET || '';
const IS_SECRET_CONFIGURED = Boolean(import.meta.env.VITE_DEV_LEDGER_SECRET);

interface DevStatsPageProps {
  /** When true, shows public read-only view without auth */
  isPublic?: boolean;
}

interface StatsSummary {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  successRate: number; // Legacy field (same as successRateRaw)
  successRateRaw?: number; // Raw success rate (includes infra failures)
  successRateAdjusted?: number; // Success rate excluding RPC/infra failures
  uniqueWallets?: number; // Unique wallet addresses
  totalUsdRouted: number;
  relayedTxCount: number;
  chainsActive: string[];
  byKind: { kind: string; count: number; usdTotal: number }[];
  byVenue: { venue: string; count: number; usdTotal: number }[];
  byChain: { chain: string; network: string; count: number; successCount: number; failedCount: number }[];
  avgLatencyMs: number;
  lastExecutionAt: number | null;
}

interface IntentStats {
  totalIntents: number;
  confirmedIntents: number;
  failedIntents: number;
  intentSuccessRate: number;
  byKind: { kind: string; count: number; confirmed: number; failed: number }[];
  byStatus: { status: string; count: number }[];
  failuresByStage: { stage: string; count: number }[];
  failuresByCode: { code: string; count: number }[];
}

interface Intent {
  id: string;
  created_at: number;
  intent_text: string;
  intent_kind?: string;
  requested_chain?: string;
  requested_venue?: string;
  usd_estimate?: number;
  status: string;
  planned_at?: number;
  executed_at?: number;
  confirmed_at?: number;
  failure_stage?: string;
  error_code?: string;
  error_message?: string;
  metadata_json?: string;
}

interface Execution {
  id: string;
  chain: string;
  network: string;
  kind?: string;
  venue?: string;
  intent: string;
  action: string;
  from_address: string;
  to_address?: string;
  token?: string;
  amount_units?: string;
  amount_display?: string;
  usd_estimate?: number;
  usd_estimate_is_estimate?: number;
  tx_hash?: string;
  status: string;
  error_code?: string;
  error_message?: string;
  explorer_url?: string;
  gas_used?: string;
  block_number?: number;
  latency_ms?: number;
  relayer_address?: string;
  session_id?: string;
  created_at: number;
}

interface ExecutionStep {
  id: string;
  execution_id: string;
  step_index: number;
  action: string;
  tx_hash?: string;
  explorer_url?: string;
  status: string;
  error_message?: string;
  created_at: number;
}

// Determine API base URL
// PREFER SAME-ORIGIN (no CORS): In production, all subdomains (stats, app, api) map to the same Vercel deployment
// So we use relative paths by default. Only use absolute URLs for local dev or cross-origin cases.
const getApiBase = () => {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;

    // PRODUCTION (Vercel): Use same-origin relative paths (no CORS)
    // All *.blossom.onl and *.vercel.app domains map to the same deployment
    if (hostname.includes('blossom.onl') || hostname.includes('vercel.app')) {
      return ''; // Empty string = same-origin relative paths (/api/...)
    }
  }

  // LOCAL DEV: Check env vars for explicit override
  if (import.meta.env.VITE_AGENT_API_BASE_URL) {
    return import.meta.env.VITE_AGENT_API_BASE_URL;
  }
  if (import.meta.env.VITE_AGENT_BASE_URL) {
    return import.meta.env.VITE_AGENT_BASE_URL;
  }

  // LOCAL DEV FALLBACK: Default to localhost backend
  return 'http://localhost:3001';
};

// Make this a function to ensure it's evaluated at runtime with window available
const getApiBaseUrl = () => getApiBase();
const REFRESH_INTERVAL_MS = 30000;

export default function DevStatsPage({ isPublic = false }: DevStatsPageProps) {
  // In public mode, always authorized (read-only). In dev mode, require secret.
  const [isAuthorized, setIsAuthorized] = useState(isPublic);
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [intentStats, setIntentStats] = useState<IntentStats | null>(null);
  const [intents, setIntents] = useState<Intent[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [expandedExecution, setExpandedExecution] = useState<string | null>(null);
  const [expandedIntent, setExpandedIntent] = useState<string | null>(null);
  const [executionSteps, setExecutionSteps] = useState<Record<string, ExecutionStep[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [apiHealth, setApiHealth] = useState<'healthy' | 'error' | 'unknown'>('unknown');

  // Verification panel state
  const [verifyIntent, setVerifyIntent] = useState('swap 0.001 ETH to REDACTED');
  const [verifyChain, setVerifyChain] = useState<'ethereum' | 'solana'>('ethereum');
  const [verifyRunning, setVerifyRunning] = useState(false);
  const [verifyResult, setVerifyResult] = useState<IntentExecutionResult | null>(null);

  // Torture run filter state
  const [showTortureRuns, setShowTortureRuns] = useState(false);

  // Check authorization
  useEffect(() => {
    // Public mode is always authorized (read-only)
    if (isPublic) {
      setIsAuthorized(true);
      return;
    }
    // Dev mode requires secret
    if (!IS_SECRET_CONFIGURED) {
      setIsAuthorized(false);
      setLoading(false);
      return;
    }
    setIsAuthorized(true);
  }, [isPublic]);

  const fetchData = useCallback(async () => {
    if (!isAuthorized) return;

    setLoading(true);
    setError(null);

    // Cache-busting param to ensure fresh data on manual refresh
    const cacheBust = `_t=${Date.now()}`;

    try {
      if (isPublic) {
        // PUBLIC MODE: Use public read-only endpoint (no auth required)
        const statsRes = await fetch(`${getApiBaseUrl()}/api/stats/public?${cacheBust}`, {
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' }
        });

        if (!statsRes.ok) {
          const status = statsRes.status;
          const endpoint = `${getApiBaseUrl()}/api/stats/public`;
          throw new Error(`Failed to fetch stats (HTTP ${status} from ${endpoint})`);
        }

        const statsData = await statsRes.json();

        if (statsData.ok) {
          // Map public stats format to internal stats format
          const publicData = statsData.data;
          setStats({
            totalExecutions: publicData.totalExecutions || 0,
            successfulExecutions: publicData.successfulExecutions || 0,
            failedExecutions: (publicData.totalExecutions || 0) - (publicData.successfulExecutions || 0),
            successRate: publicData.successRate || 0,
            totalUsdRouted: publicData.totalUsdRouted || 0,
            relayedTxCount: 0, // Not in public stats
            chainsActive: publicData.chainsActive || [],
            byKind: [],
            byVenue: [],
            byChain: [],
            avgLatencyMs: 0,
            lastExecutionAt: null,
          });
          setIntentStats({
            totalIntents: publicData.totalIntents || 0,
            confirmedIntents: publicData.confirmedIntents || 0,
            failedIntents: (publicData.totalIntents || 0) - (publicData.confirmedIntents || 0),
            intentSuccessRate: publicData.totalIntents > 0
              ? ((publicData.confirmedIntents || 0) / publicData.totalIntents) * 100
              : 0,
            byKind: [],
            byStatus: [],
            failuresByStage: [],
            failuresByCode: [],
          });
          // Set recent intents if available
          if (publicData.recentIntents && Array.isArray(publicData.recentIntents)) {
            setIntents(publicData.recentIntents);
          }
          // Set recent executions if available
          if (publicData.recentExecutions && Array.isArray(publicData.recentExecutions)) {
            setExecutions(publicData.recentExecutions);
          }
          setApiHealth('healthy');
        }
      } else {
        // DEV MODE: Use full authenticated endpoints
        const headers = { 'X-Ledger-Secret': LEDGER_SECRET };

        const [statsRes, recentRes, intentStatsRes, intentsRes] = await Promise.all([
          fetch(`${getApiBaseUrl()}/api/ledger/stats/summary?${cacheBust}`, { headers, cache: 'no-store' }),
          fetch(`${getApiBaseUrl()}/api/ledger/stats/recent?limit=20&${cacheBust}`, { headers, cache: 'no-store' }),
          fetch(`${getApiBaseUrl()}/api/ledger/stats/intents?${cacheBust}`, { headers, cache: 'no-store' }),
          fetch(`${getApiBaseUrl()}/api/ledger/intents/recent?limit=50&${cacheBust}`, { headers, cache: 'no-store' }),
        ]);

        if (!statsRes.ok || !recentRes.ok) {
          throw new Error('Failed to fetch stats data');
        }

        const statsData = await statsRes.json();
        const recentData = await recentRes.json();
        const intentStatsData = await intentStatsRes.json();
        const intentsData = await intentsRes.json();

        if (statsData.ok) {
          setStats(statsData.data);
          setApiHealth('healthy');
        }
        if (recentData.ok) {
          setExecutions(recentData.data);
        }
        if (intentStatsData.ok) {
          setIntentStats(intentStatsData.data);
        }
        if (intentsData.ok) {
          setIntents(intentsData.data);
        }
      }

      setLastUpdated(new Date());
    } catch (e: any) {
      const errorMsg = e.message || 'Failed to fetch stats data. Is the agent running with ledger API enabled?';
      setError(errorMsg);
      setApiHealth('error');
      console.error('[DevStatsPage] Fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [isAuthorized, isPublic]);

  const fetchExecutionSteps = useCallback(async (executionId: string) => {
    if (executionSteps[executionId]) return; // Already fetched

    const headers = { 'X-Ledger-Secret': LEDGER_SECRET };
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/ledger/executions/${executionId}/steps`, { headers });
      const data = await res.json();
      if (data.ok) {
        setExecutionSteps(prev => ({ ...prev, [executionId]: data.data }));
      }
    } catch (e) {
      console.error('Failed to fetch execution steps:', e);
    }
  }, [executionSteps]);

  const toggleExpanded = (executionId: string) => {
    // In public mode, disable expansion (requires auth to fetch execution steps)
    if (isPublic) {
      return;
    }

    if (expandedExecution === executionId) {
      setExpandedExecution(null);
    } else {
      setExpandedExecution(executionId);
      fetchExecutionSteps(executionId);
    }
  };

  useEffect(() => {
    if (isAuthorized) {
      fetchData();
      const interval = setInterval(fetchData, REFRESH_INTERVAL_MS);
      return () => clearInterval(interval);
    }
  }, [isAuthorized, fetchData]);

  const formatNumber = (n: number | null | undefined): string => {
    if (n == null) return '-';
    if (n >= 1000000) return `${(n / 1000000).toFixed(2)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toLocaleString();
  };

  const formatUsd = (n: number | null | undefined): string => {
    if (n == null || n === 0) return '$0.00';
    if (n < 0.01) return '<$0.01';
    return `$${n.toFixed(2)}`;
  };

  const formatTime = (timestamp: number | null | undefined): string => {
    if (timestamp == null) return '-';
    return new Date(timestamp * 1000).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const truncateAddress = (addr: string): string => {
    if (!addr) return '-';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const truncateHash = (hash: string): string => {
    if (!hash) return '-';
    return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
  };

  const isValidExplorerUrl = (url: string | undefined): boolean => {
    if (!url) return false;
    return url.startsWith('https://') && (
      url.includes('etherscan.io') ||
      url.includes('explorer.solana.com') ||
      url.includes('basescan.org') ||
      url.includes('arbiscan.io')
    );
  };

  const copyToClipboard = async (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      // Could add toast notification here
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const getKindColor = (kind: string | undefined): string => {
    switch (kind) {
      case 'perp': return 'bg-orange-900/50 text-orange-400';
      case 'deposit': return 'bg-green-900/50 text-green-400';
      case 'bridge': return 'bg-purple-900/50 text-purple-400';
      case 'swap': return 'bg-blue-900/50 text-blue-400';
      case 'proof': return 'bg-pink-900/50 text-pink-400';
      case 'relay': return 'bg-cyan-900/50 text-cyan-400';
      case 'transfer': return 'bg-yellow-900/50 text-yellow-400';
      default: return 'bg-gray-900/50 text-gray-400';
    }
  };

  const getIntentStatusColor = (status: string | undefined): string => {
    switch (status) {
      case 'confirmed': return 'bg-green-900/50 text-green-400';
      case 'failed': return 'bg-red-900/50 text-red-400';
      case 'executing': return 'bg-yellow-900/50 text-yellow-400';
      case 'routed': return 'bg-cyan-900/50 text-cyan-400';
      case 'planned': return 'bg-blue-900/50 text-blue-400';
      case 'queued': return 'bg-gray-900/50 text-gray-400';
      default: return 'bg-gray-900/50 text-gray-400';
    }
  };

  const toggleIntentExpanded = (intentId: string) => {
    if (expandedIntent === intentId) {
      setExpandedIntent(null);
    } else {
      setExpandedIntent(intentId);
    }
  };

  const parseMetadataJson = (json: string | undefined): Record<string, any> | null => {
    if (!json) return null;
    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  };

  // Unauthorized view
  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#FDF6F9] via-white to-[#F0F4FF] flex items-center justify-center">
        <div className="bg-white rounded-xl border border-[#E5E5E5] p-8 max-w-md text-center shadow-lg">
          <BarChart3 className="w-12 h-12 text-[#F25AA2] mx-auto mb-4" />
          <h1 className="text-xl font-bold text-[#111111] mb-2">Execution Statistics</h1>
          <p className="text-[#666666] mb-4">
            This is a private dev-only dashboard.
          </p>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-left mb-4">
            <p className="text-red-700 text-sm font-medium mb-2">Dashboard Not Configured</p>
            <p className="text-red-600 text-xs">
              Set <code className="bg-red-100 px-1 rounded">VITE_DEV_LEDGER_SECRET</code> in your <code className="bg-red-100 px-1 rounded">.env.local</code> file.
            </p>
          </div>
          <Link
            to="/"
            className="inline-flex items-center gap-2 mt-6 text-[#F25AA2] hover:underline"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f0f23]">
      {/* Header */}
      <header className="border-b border-[#333] bg-[#1a1a2e]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link to="/" className="flex items-center gap-2 text-[#888] hover:text-[#F25AA2] transition-colors">
                <ArrowLeft className="w-4 h-4" />
                Back
              </Link>
              <div className="h-6 w-px bg-[#333]" />
              <div className="flex items-center gap-2">
                {isPublic ? (
                  <Globe className="w-5 h-5 text-[#F25AA2]" />
                ) : (
                  <BarChart3 className="w-5 h-5 text-[#F25AA2]" />
                )}
                <h1 className="text-lg font-bold text-white">
                  {isPublic ? 'Blossom Statistics' : 'Execution Statistics'}
                </h1>
                {isPublic ? (
                  <span className="px-2 py-0.5 text-xs bg-green-900/50 text-green-400 rounded-full">LIVE</span>
                ) : (
                  <span className="px-2 py-0.5 text-xs bg-[#F25AA2]/20 text-[#F25AA2] rounded-full">DEV</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4">
              {/* Health Indicator */}
              <div className="flex items-center gap-2 text-xs">
                <div className={`w-2 h-2 rounded-full ${
                  apiHealth === 'healthy' ? 'bg-green-400 animate-pulse' :
                  apiHealth === 'error' ? 'bg-red-400' : 'bg-yellow-400'
                }`} />
                <span className={
                  apiHealth === 'healthy' ? 'text-green-400' :
                  apiHealth === 'error' ? 'text-red-400' : 'text-yellow-400'
                }>
                  {apiHealth === 'healthy' ? 'API Healthy' :
                   apiHealth === 'error' ? 'API Error' : 'Checking...'}
                </span>
              </div>
              {/* CLI Runs Toggle (torture/burnin/verify) */}
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={showTortureRuns}
                  onChange={(e) => setShowTortureRuns(e.target.checked)}
                  className="w-3 h-3 rounded bg-[#333] border-[#555] text-[#F25AA2] focus:ring-[#F25AA2]"
                />
                <span className={showTortureRuns ? 'text-[#F25AA2]' : 'text-[#666]'}>
                  Show CLI runs
                </span>
              </label>
              <span className="text-xs text-[#666]">
                {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : ''}
              </span>
              <button
                onClick={fetchData}
                disabled={loading}
                className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-[#F25AA2]/20 text-[#F25AA2] hover:bg-[#F25AA2]/30 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {error && (
          <div className="bg-red-900/30 border border-red-500/50 rounded-lg p-4 text-red-400">
            {error}
          </div>
        )}

        {/* Summary Cards */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-4">Summary</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {/* Total Executions */}
            <div className="bg-[#1a1a2e] rounded-xl border border-[#333] p-4">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4 text-[#F25AA2]" />
                <span className="text-xs text-[#888] uppercase tracking-wide">Executions</span>
              </div>
              <div className="text-2xl font-mono font-bold text-white">
                {stats ? formatNumber(stats.totalExecutions) : '-'}
              </div>
              <div className="text-xs text-[#666] mt-1">
                <span className="text-green-400">{stats?.successfulExecutions ?? 0}</span> successful
              </div>
            </div>

            {/* USD Routed */}
            <div className="bg-[#1a1a2e] rounded-xl border border-[#333] p-4">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="w-4 h-4 text-green-400" />
                <span className="text-xs text-[#888] uppercase tracking-wide">USD Routed</span>
              </div>
              <div className="text-2xl font-mono font-bold text-green-400">
                {stats ? formatUsd(stats.totalUsdRouted) : '-'}
              </div>
              <div className="text-xs text-[#666] mt-1">
                estimated value
              </div>
            </div>

            {/* Success Rate */}
            <div className="bg-[#1a1a2e] rounded-xl border border-[#333] p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-4 h-4 text-green-400" />
                <span className="text-xs text-[#888] uppercase tracking-wide">Success Rate</span>
              </div>
              <div className={`text-2xl font-mono font-bold ${
                (stats?.successRateAdjusted ?? stats?.successRate ?? 0) >= 90 ? 'text-green-400' :
                (stats?.successRateAdjusted ?? stats?.successRate ?? 0) >= 70 ? 'text-yellow-400' : 'text-red-400'
              }`}>
                {(stats?.successRateAdjusted ?? stats?.successRate)?.toFixed(1) ?? '0.0'}%
              </div>
              {stats?.successRateAdjusted !== undefined && stats?.successRateRaw !== undefined &&
               Math.abs((stats?.successRateAdjusted ?? 0) - (stats?.successRateRaw ?? 0)) > 1 && (
                <div className="text-xs text-[#666] mt-1">
                  {stats?.successRateRaw?.toFixed(1)}% raw
                </div>
              )}
            </div>

            {/* Relayed TX */}
            <div className="bg-[#1a1a2e] rounded-xl border border-[#333] p-4">
              <div className="flex items-center gap-2 mb-2">
                <Send className="w-4 h-4 text-cyan-400" />
                <span className="text-xs text-[#888] uppercase tracking-wide">Relayed TX</span>
              </div>
              <div className="text-2xl font-mono font-bold text-cyan-400">
                {stats ? formatNumber(stats.relayedTxCount) : '-'}
              </div>
              <div className="text-xs text-[#666] mt-1">
                via relayer
              </div>
            </div>

            {/* Failures */}
            <div className="bg-[#1a1a2e] rounded-xl border border-[#333] p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <span className="text-xs text-[#888] uppercase tracking-wide">Failures</span>
              </div>
              <div className="text-2xl font-mono font-bold text-red-400">
                {stats?.failedExecutions ?? 0}
              </div>
            </div>

            {/* Chains Active */}
            <div className="bg-[#1a1a2e] rounded-xl border border-[#333] p-4">
              <div className="flex items-center gap-2 mb-2">
                <Server className="w-4 h-4 text-purple-400" />
                <span className="text-xs text-[#888] uppercase tracking-wide">Chains</span>
              </div>
              <div className="text-2xl font-mono font-bold text-purple-400">
                {stats?.chainsActive?.length ?? 0}
              </div>
              <div className="text-xs text-[#666] mt-1">
                {stats?.chainsActive?.join(', ') || 'none'}
              </div>
            </div>

            {/* Unique Wallets */}
            <div className="bg-[#1a1a2e] rounded-xl border border-[#333] p-4">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-blue-400" />
                <span className="text-xs text-[#888] uppercase tracking-wide">Unique Wallets</span>
              </div>
              <div className="text-2xl font-mono font-bold text-blue-400">
                {stats?.uniqueWallets ?? 0}
              </div>
              <div className="text-xs text-[#666] mt-1">
                distinct addresses
              </div>
            </div>
          </div>
        </section>

        {/* Intent Summary Cards */}
        {intentStats && intentStats.totalIntents > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-white mb-4">Intent Tracking</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Total Intents */}
              <div className="bg-[#1a1a2e] rounded-xl border border-[#333] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="w-4 h-4 text-[#F25AA2]" />
                  <span className="text-xs text-[#888] uppercase tracking-wide">Intents</span>
                </div>
                <div className="text-2xl font-mono font-bold text-white">
                  {formatNumber(intentStats.totalIntents)}
                </div>
                <div className="text-xs text-[#666] mt-1">
                  <span className="text-green-400">{intentStats.confirmedIntents}</span> confirmed
                </div>
              </div>

              {/* Intent Success Rate */}
              <div className="bg-[#1a1a2e] rounded-xl border border-[#333] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <span className="text-xs text-[#888] uppercase tracking-wide">Intent Success</span>
                </div>
                <div className={`text-2xl font-mono font-bold ${
                  intentStats.intentSuccessRate >= 90 ? 'text-green-400' :
                  intentStats.intentSuccessRate >= 70 ? 'text-yellow-400' : 'text-red-400'
                }`}>
                  {intentStats.intentSuccessRate.toFixed(1)}%
                </div>
              </div>

              {/* Failed Intents */}
              <div className="bg-[#1a1a2e] rounded-xl border border-[#333] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <XCircle className="w-4 h-4 text-red-400" />
                  <span className="text-xs text-[#888] uppercase tracking-wide">Failed</span>
                </div>
                <div className="text-2xl font-mono font-bold text-red-400">
                  {intentStats.failedIntents}
                </div>
              </div>

              {/* Failure Breakdown */}
              <div className="bg-[#1a1a2e] rounded-xl border border-[#333] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-yellow-400" />
                  <span className="text-xs text-[#888] uppercase tracking-wide">By Stage</span>
                </div>
                <div className="text-xs space-y-1 mt-2">
                  {intentStats.failuresByStage.slice(0, 3).map(f => (
                    <div key={f.stage} className="flex justify-between">
                      <span className="text-[#666]">{f.stage}</span>
                      <span className="text-red-400">{f.count}</span>
                    </div>
                  ))}
                  {intentStats.failuresByStage.length === 0 && (
                    <span className="text-[#666]">No failures</span>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Breakdown Cards */}
        {stats && (stats.byKind.length > 0 || stats.byChain.length > 0) && (
          <section>
            <h2 className="text-lg font-semibold text-white mb-4">Breakdown</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* By Kind */}
              {stats.byKind.length > 0 && (
                <div className="bg-[#1a1a2e] rounded-xl border border-[#333] p-4">
                  <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-[#F25AA2]" />
                    By Kind
                  </h3>
                  <div className="space-y-2">
                    {stats.byKind.map((k) => (
                      <div key={k.kind} className="flex items-center justify-between p-2 bg-[#0f0f23] rounded-lg">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-xs ${getKindColor(k.kind)}`}>
                            {k.kind || 'unknown'}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-white font-mono">{k.count}</span>
                          {k.usdTotal > 0 && (
                            <span className="text-[#666] text-xs ml-2">
                              ({formatUsd(k.usdTotal)})
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* By Chain */}
              {stats.byChain.length > 0 && (
                <div className="bg-[#1a1a2e] rounded-xl border border-[#333] p-4">
                  <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                    <Server className="w-4 h-4 text-purple-400" />
                    By Chain
                  </h3>
                  <div className="space-y-2">
                    {stats.byChain.map((c) => (
                      <div key={`${c.chain}-${c.network}`} className="flex items-center justify-between p-2 bg-[#0f0f23] rounded-lg">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${
                            c.chain === 'ethereum' ? 'bg-blue-400' : 'bg-purple-400'
                          }`} />
                          <span className="text-white capitalize">{c.chain}/{c.network}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-white font-mono">{c.count}</span>
                          <span className="text-green-400 text-xs ml-2">
                            {c.successCount} ok
                          </span>
                          {c.failedCount > 0 && (
                            <span className="text-red-400 text-xs ml-1">
                              {c.failedCount} fail
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Recent Executions Table */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-4">Recent Executions</h2>
          <div className="bg-[#1a1a2e] rounded-xl border border-[#333] overflow-hidden">
            {executions.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-[#0f0f23]">
                    <tr className="text-left text-[#888] border-b border-[#333]">
                      <th className="px-3 py-2 font-medium w-8"></th>
                      <th className="px-3 py-2 font-medium">ID</th>
                      <th className="px-3 py-2 font-medium">Chain</th>
                      <th className="px-3 py-2 font-medium">Kind</th>
                      <th className="px-3 py-2 font-medium">Venue</th>
                      <th className="px-3 py-2 font-medium text-right">USD Est.</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Time</th>
                      <th className="px-3 py-2 font-medium">Relayed</th>
                      <th className="px-3 py-2 font-medium">Explorer</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {executions.map((exec) => (
                      <React.Fragment key={exec.id}>
                        <tr
                          className={`border-b border-[#333] ${!isPublic ? 'hover:bg-[#0f0f23] cursor-pointer' : ''} ${
                            expandedExecution === exec.id ? 'bg-[#0f0f23]' : ''
                          }`}
                          onClick={() => !isPublic && toggleExpanded(exec.id)}
                        >
                          <td className="px-3 py-2">
                            {!isPublic && (expandedExecution === exec.id ? (
                              <ChevronDown className="w-4 h-4 text-[#888]" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-[#888]" />
                            ))}
                          </td>
                          <td className="px-3 py-2 text-[#888]" title={exec.id}>
                            {exec.id.slice(0, 8)}...
                          </td>
                          <td className="px-3 py-2">
                            <span className={`px-2 py-0.5 rounded text-xs ${
                              exec.chain === 'ethereum' ? 'bg-blue-900/50 text-blue-400' : 'bg-purple-900/50 text-purple-400'
                            }`}>
                              {exec.chain}/{exec.network}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`px-2 py-0.5 rounded text-xs ${getKindColor(exec.kind)}`}>
                              {exec.kind || '-'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-white">{exec.venue || '-'}</td>
                          <td className="px-3 py-2 text-right text-green-400">
                            {exec.usd_estimate ? formatUsd(exec.usd_estimate) : '-'}
                            {exec.usd_estimate_is_estimate === 1 && (
                              <span className="text-[#666] text-xs ml-1">~</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
                              exec.status === 'confirmed' || exec.status === 'finalized'
                                ? 'bg-green-900/50 text-green-400'
                                : exec.status === 'failed'
                                ? 'bg-red-900/50 text-red-400'
                                : exec.status === 'submitted'
                                ? 'bg-yellow-900/50 text-yellow-400'
                                : 'bg-gray-900/50 text-gray-400'
                            }`}>
                              {exec.status === 'confirmed' && <CheckCircle className="w-3 h-3" />}
                              {exec.status === 'failed' && <XCircle className="w-3 h-3" />}
                              {exec.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-[#888]">
                            <div className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatTime(exec.created_at)}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            {exec.relayer_address ? (
                              <span className="text-cyan-400" title={exec.relayer_address}>
                                {truncateAddress(exec.relayer_address)}
                              </span>
                            ) : (
                              <span className="text-[#666]">-</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {exec.explorer_url ? (
                              <div className="flex items-center gap-2">
                                {isValidExplorerUrl(exec.explorer_url) ? (
                                  <a
                                    href={exec.explorer_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[#F25AA2] hover:underline flex items-center gap-1"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {truncateHash(exec.tx_hash || '')}
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                ) : (
                                  <span className="flex items-center gap-1 text-yellow-400" title="Invalid explorer URL">
                                    {truncateHash(exec.tx_hash || '')}
                                    <AlertOctagon className="w-3 h-3" />
                                  </span>
                                )}
                                {exec.tx_hash && (
                                  <button
                                    onClick={(e) => copyToClipboard(exec.tx_hash!, e)}
                                    className="text-[#666] hover:text-white p-1 rounded"
                                    title="Copy tx hash"
                                  >
                                    <Copy className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            ) : (
                              <span className="text-[#666]">-</span>
                            )}
                          </td>
                        </tr>
                        {/* Expanded Row - Execution Steps */}
                        {expandedExecution === exec.id && (
                          <tr key={`${exec.id}-steps`}>
                            <td colSpan={10} className="bg-[#0a0a15] p-4">
                              <div className="pl-8">
                                <h4 className="text-xs font-semibold text-[#888] uppercase tracking-wide mb-2">
                                  Execution Details
                                </h4>
                                <div className="grid grid-cols-2 gap-4 text-xs mb-4">
                                  <div>
                                    <span className="text-[#666]">Intent:</span>
                                    <span className="text-white ml-2">{exec.intent}</span>
                                  </div>
                                  <div>
                                    <span className="text-[#666]">Action:</span>
                                    <span className="text-white ml-2">{exec.action}</span>
                                  </div>
                                  <div>
                                    <span className="text-[#666]">From:</span>
                                    <span className="text-white ml-2 font-mono">{truncateAddress(exec.from_address)}</span>
                                  </div>
                                  {exec.to_address && (
                                    <div>
                                      <span className="text-[#666]">To:</span>
                                      <span className="text-white ml-2 font-mono">{truncateAddress(exec.to_address)}</span>
                                    </div>
                                  )}
                                  {exec.token && (
                                    <div>
                                      <span className="text-[#666]">Token:</span>
                                      <span className="text-white ml-2">{exec.token}</span>
                                    </div>
                                  )}
                                  {exec.amount_display && (
                                    <div>
                                      <span className="text-[#666]">Amount:</span>
                                      <span className="text-white ml-2">{exec.amount_display}</span>
                                    </div>
                                  )}
                                  {exec.latency_ms && (
                                    <div>
                                      <span className="text-[#666]">Latency:</span>
                                      <span className="text-white ml-2">{exec.latency_ms}ms</span>
                                    </div>
                                  )}
                                  {exec.gas_used && (
                                    <div>
                                      <span className="text-[#666]">Gas:</span>
                                      <span className="text-white ml-2">{exec.gas_used}</span>
                                    </div>
                                  )}
                                  {exec.error_message && (
                                    <div className="col-span-2">
                                      <span className="text-[#666]">Error:</span>
                                      <span className="text-red-400 ml-2">{exec.error_message}</span>
                                    </div>
                                  )}
                                </div>

                                {/* Execution Steps */}
                                {executionSteps[exec.id] && executionSteps[exec.id].length > 0 && (
                                  <div className="mt-4">
                                    <h4 className="text-xs font-semibold text-[#888] uppercase tracking-wide mb-2">
                                      Steps
                                    </h4>
                                    <div className="space-y-2">
                                      {executionSteps[exec.id].map((step) => (
                                        <div key={step.id} className="flex items-center justify-between p-2 bg-[#1a1a2e] rounded-lg">
                                          <div className="flex items-center gap-3">
                                            <span className="text-[#666] text-xs w-6">#{step.step_index}</span>
                                            <span className="text-white capitalize">{step.action}</span>
                                          </div>
                                          <div className="flex items-center gap-4">
                                            <span className={`px-2 py-0.5 rounded-full text-xs ${
                                              step.status === 'confirmed' ? 'bg-green-900/50 text-green-400' :
                                              step.status === 'failed' ? 'bg-red-900/50 text-red-400' :
                                              'bg-gray-900/50 text-gray-400'
                                            }`}>
                                              {step.status}
                                            </span>
                                            {step.explorer_url && (
                                              <div className="flex items-center gap-2">
                                                {isValidExplorerUrl(step.explorer_url) ? (
                                                  <a
                                                    href={step.explorer_url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-[#F25AA2] hover:underline flex items-center gap-1 text-xs"
                                                  >
                                                    {truncateHash(step.tx_hash || '')}
                                                    <ExternalLink className="w-3 h-3" />
                                                  </a>
                                                ) : (
                                                  <span className="flex items-center gap-1 text-yellow-400 text-xs" title="Invalid URL">
                                                    {truncateHash(step.tx_hash || '')}
                                                    <AlertOctagon className="w-3 h-3" />
                                                  </span>
                                                )}
                                                {step.tx_hash && (
                                                  <button
                                                    onClick={(e) => copyToClipboard(step.tx_hash!, e)}
                                                    className="text-[#666] hover:text-white p-1"
                                                    title="Copy tx hash"
                                                  >
                                                    <Copy className="w-3 h-3" />
                                                  </button>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {executionSteps[exec.id] && executionSteps[exec.id].length === 0 && (
                                  <p className="text-[#666] text-xs">No steps recorded for this execution.</p>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center text-[#666]">
                <p>No executions recorded yet.</p>
                <p className="text-sm mt-2">Run a smoke test to see data here.</p>
              </div>
            )}
          </div>
        </section>

        {/* Internal Verification Panel - Hidden in public mode */}
        {!isPublic && (
        <section className="bg-[#1a1a2e] rounded-xl border border-[#333] p-4">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-400" />
            Internal Verification
          </h2>
          <p className="text-sm text-[#888] mb-4">
            Test intent execution directly from the UI. Results are recorded in the ledger.
          </p>

          <div className="space-y-3">
            {/* Intent Input */}
            <div>
              <label className="block text-sm text-[#888] mb-1">Intent Text</label>
              <input
                type="text"
                value={verifyIntent}
                onChange={(e) => setVerifyIntent(e.target.value)}
                placeholder="e.g., swap 0.001 ETH to REDACTED"
                className="w-full px-3 py-2 bg-[#0f0f23] border border-[#333] rounded-lg text-white placeholder-[#555] focus:border-[#666] focus:outline-none text-sm"
              />
            </div>

            {/* Chain Selection */}
            <div>
              <label className="block text-sm text-[#888] mb-1">Chain</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setVerifyChain('ethereum')}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    verifyChain === 'ethereum'
                      ? 'bg-blue-600 text-white'
                      : 'bg-[#0f0f23] border border-[#333] text-[#888] hover:border-[#555]'
                  }`}
                >
                  Ethereum (Sepolia)
                </button>
                <button
                  onClick={() => setVerifyChain('solana')}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    verifyChain === 'solana'
                      ? 'bg-purple-600 text-white'
                      : 'bg-[#0f0f23] border border-[#333] text-[#888] hover:border-[#555]'
                  }`}
                >
                  Solana (Devnet)
                </button>
              </div>
            </div>

            {/* Execute Button */}
            <button
              onClick={async () => {
                if (!verifyIntent.trim()) return;
                setVerifyRunning(true);
                setVerifyResult(null);
                try {
                  const result = await executeIntent(verifyIntent, { chain: verifyChain });
                  setVerifyResult(result);
                  // Refresh stats after execution
                  fetchData();
                } catch (err: any) {
                  setVerifyResult({
                    ok: false,
                    intentId: '',
                    status: 'failed',
                    error: {
                      stage: 'execute',
                      code: 'UI_ERROR',
                      message: err.message || 'Execution failed',
                    },
                  });
                } finally {
                  setVerifyRunning(false);
                }
              }}
              disabled={verifyRunning || !verifyIntent.trim()}
              className={`w-full px-4 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                verifyRunning || !verifyIntent.trim()
                  ? 'bg-[#333] text-[#666] cursor-not-allowed'
                  : 'bg-gradient-to-r from-pink-500 to-purple-500 text-white hover:from-pink-600 hover:to-purple-600'
              }`}
            >
              {verifyRunning ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Executing...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Execute Intent
                </>
              )}
            </button>

            {/* Result Display */}
            {verifyResult && (
              <div
                className={`p-3 rounded-lg border ${
                  verifyResult.ok
                    ? 'bg-green-900/20 border-green-800'
                    : 'bg-red-900/20 border-red-800'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  {verifyResult.ok ? (
                    <CheckCircle className="w-4 h-4 text-green-400" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-400" />
                  )}
                  <span className={verifyResult.ok ? 'text-green-400' : 'text-red-400'}>
                    {verifyResult.ok ? 'Execution Successful' : 'Execution Failed'}
                  </span>
                  {verifyResult.metadata?.executedKind === 'proof_only' && (
                    <span className="px-2 py-0.5 rounded text-xs bg-amber-900/30 text-amber-400">
                      proof_only
                    </span>
                  )}
                </div>

                {verifyResult.ok && verifyResult.txHash && (
                  <div className="space-y-1 text-sm">
                    <div className="flex items-center gap-2 text-[#888]">
                      <span>TX:</span>
                      <code className="text-white font-mono">
                        {verifyResult.txHash.slice(0, 12)}...{verifyResult.txHash.slice(-8)}
                      </code>
                      {verifyResult.explorerUrl && (
                        <a
                          href={verifyResult.explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:text-blue-300 flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" />
                          View
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[#888]">
                      <span>Intent ID:</span>
                      <code className="text-white font-mono text-xs">{verifyResult.intentId}</code>
                    </div>
                  </div>
                )}

                {!verifyResult.ok && verifyResult.error && (
                  <div className="text-sm">
                    <p className="text-red-300">
                      {verifyResult.error.stage}: {verifyResult.error.code}
                    </p>
                    <p className="text-[#888] mt-1">{verifyResult.error.message}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
        )}

        {/* Recent Intents Table */}
        {intents.length > 0 && (() => {
          // Filter intents based on CLI run toggle
          const filteredIntents = intents.filter((intent) => {
            const metadata = parseMetadataJson(intent.metadata_json);
            const isCliRun = metadata?.source === 'cli' || metadata?.source === 'torture_suite';
            // Show CLI runs only if toggle is ON, hide them if toggle is OFF
            return showTortureRuns ? true : !isCliRun;
          });

          const cliCount = intents.filter((intent) => {
            const metadata = parseMetadataJson(intent.metadata_json);
            return metadata?.source === 'cli' || metadata?.source === 'torture_suite';
          }).length;

          return (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Recent Intents</h2>
              {cliCount > 0 && (
                <span className="text-xs text-[#666]">
                  {showTortureRuns ? (
                    <span className="text-[#F25AA2]">{cliCount} CLI intents shown</span>
                  ) : (
                    <span>{cliCount} CLI intents hidden</span>
                  )}
                </span>
              )}
            </div>
            <div className="bg-[#1a1a2e] rounded-xl border border-[#333] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#0f0f23]">
                    <tr className="text-left text-[#888] border-b border-[#333]">
                      <th className="px-3 py-2 font-medium w-8"></th>
                      <th className="px-3 py-2 font-medium">Intent</th>
                      <th className="px-3 py-2 font-medium">Kind</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium text-right">USD Est.</th>
                      <th className="px-3 py-2 font-medium">Chain / Venue</th>
                      <th className="px-3 py-2 font-medium">Created</th>
                      <th className="px-3 py-2 font-medium">Failure</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {filteredIntents.map((intent) => (
                      <React.Fragment key={intent.id}>
                        <tr
                          className={`border-b border-[#333] hover:bg-[#0f0f23] cursor-pointer ${
                            expandedIntent === intent.id ? 'bg-[#0f0f23]' : ''
                          }`}
                          onClick={() => toggleIntentExpanded(intent.id)}
                        >
                          <td className="px-3 py-2">
                            {expandedIntent === intent.id ? (
                              <ChevronDown className="w-4 h-4 text-[#888]" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-[#888]" />
                            )}
                          </td>
                          <td className="px-3 py-2 text-white max-w-[200px] truncate" title={intent.intent_text}>
                            {intent.intent_text}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              <span className={`px-2 py-0.5 rounded text-xs ${getKindColor(intent.intent_kind)}`}>
                                {intent.intent_kind || 'unknown'}
                              </span>
                              {(() => {
                                const meta = parseMetadataJson(intent.metadata_json);
                                const source = meta?.source;
                                if (source === 'cli') {
                                  return (
                                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-blue-900/50 text-blue-400" title={`CLI: ${meta?.category || 'unknown'}`}>
                                      CLI
                                    </span>
                                  );
                                }
                                if (source === 'torture_suite') {
                                  return (
                                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-orange-900/50 text-orange-400" title="Torture Suite">
                                      TS
                                    </span>
                                  );
                                }
                                if (source === 'ui') {
                                  return (
                                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-green-900/50 text-green-400" title={`UI: ${meta?.domain || 'unknown'}`}>
                                      UI
                                    </span>
                                  );
                                }
                                return null;
                              })()}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${getIntentStatusColor(intent.status)}`}>
                              {intent.status === 'confirmed' && <CheckCircle className="w-3 h-3" />}
                              {intent.status === 'failed' && <XCircle className="w-3 h-3" />}
                              {intent.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right text-green-400">
                            {intent.usd_estimate ? formatUsd(intent.usd_estimate) : '-'}
                          </td>
                          <td className="px-3 py-2 text-[#888]">
                            {intent.requested_chain || '-'} / {intent.requested_venue || '-'}
                          </td>
                          <td className="px-3 py-2 text-[#888]">
                            <div className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatTime(intent.created_at)}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            {intent.status === 'failed' ? (
                              <div className="text-red-400 text-xs">
                                <span className="font-medium">{intent.failure_stage}</span>
                                {intent.error_code && <span className="ml-1">({intent.error_code})</span>}
                              </div>
                            ) : (
                              <span className="text-[#666]">-</span>
                            )}
                          </td>
                        </tr>
                        {/* Expanded Row - Intent Details */}
                        {expandedIntent === intent.id && (
                          <tr key={`${intent.id}-details`}>
                            <td colSpan={8} className="bg-[#0a0a15] p-4">
                              <div className="pl-8">
                                <h4 className="text-xs font-semibold text-[#888] uppercase tracking-wide mb-2">
                                  Intent Details
                                </h4>
                                <div className="grid grid-cols-2 gap-4 text-xs mb-4">
                                  <div>
                                    <span className="text-[#666]">ID:</span>
                                    <span className="text-white ml-2 font-mono">{intent.id}</span>
                                  </div>
                                  <div>
                                    <span className="text-[#666]">Full Intent:</span>
                                    <span className="text-white ml-2">{intent.intent_text}</span>
                                  </div>
                                  {intent.planned_at && (
                                    <div>
                                      <span className="text-[#666]">Planned At:</span>
                                      <span className="text-white ml-2">{formatTime(intent.planned_at)}</span>
                                    </div>
                                  )}
                                  {intent.executed_at && (
                                    <div>
                                      <span className="text-[#666]">Executed At:</span>
                                      <span className="text-white ml-2">{formatTime(intent.executed_at)}</span>
                                    </div>
                                  )}
                                  {intent.confirmed_at && (
                                    <div>
                                      <span className="text-[#666]">Confirmed At:</span>
                                      <span className="text-white ml-2">{formatTime(intent.confirmed_at)}</span>
                                    </div>
                                  )}
                                  {intent.error_message && (
                                    <div className="col-span-2">
                                      <span className="text-[#666]">Error:</span>
                                      <span className="text-red-400 ml-2">{intent.error_message}</span>
                                    </div>
                                  )}
                                </div>

                                {/* Parsed Metadata */}
                                {intent.metadata_json && (
                                  <div className="mt-4">
                                    <h4 className="text-xs font-semibold text-[#888] uppercase tracking-wide mb-2">
                                      Metadata
                                    </h4>
                                    <pre className="text-xs text-[#888] bg-[#1a1a2e] p-2 rounded overflow-x-auto max-h-40">
                                      {JSON.stringify(parseMetadataJson(intent.metadata_json), null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
          );
        })()}

        {/* Last Execution Timestamp */}
        {stats?.lastExecutionAt && (
          <div className="text-center text-xs text-[#666]">
            Last execution: {formatTime(stats.lastExecutionAt)}
          </div>
        )}
      </main>
    </div>
  );
}
