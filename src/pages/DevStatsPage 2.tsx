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
import { executeIntent, getAgentApiBaseUrl, type IntentExecutionResult } from '../lib/apiClient';
import { formatUsdDashboard, formatNumberDashboard, formatTime, truncateAddress, truncateHash } from '../utils/formatters';

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

// Use shared API base URL function from apiClient.ts (single source of truth)
const getApiBaseUrl = () => getAgentApiBaseUrl();
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

  // Using formatters from utils/formatters.ts

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
      case 'perp': return 'bg-orange-100 text-orange-700';
      case 'deposit': return 'bg-green-100 text-green-700';
      case 'bridge': return 'bg-purple-100 text-purple-700';
      case 'swap': return 'bg-blue-100 text-blue-700';
      case 'proof': return 'bg-pink-100 text-pink-700';
      case 'relay': return 'bg-cyan-100 text-cyan-700';
      case 'transfer': return 'bg-yellow-100 text-yellow-700';
      default: return 'bg-gray-200 text-gray-700';
    }
  };

  const getIntentStatusColor = (status: string | undefined): string => {
    switch (status) {
      case 'confirmed': return 'bg-green-100 text-green-700';
      case 'failed': return 'bg-red-100 text-red-700';
      case 'executing': return 'bg-yellow-100 text-yellow-700';
      case 'routed': return 'bg-cyan-100 text-cyan-700';
      case 'planned': return 'bg-blue-100 text-blue-700';
      case 'queued': return 'bg-gray-200 text-gray-700';
      default: return 'bg-gray-200 text-gray-700';
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
    <div className="min-h-screen bg-gradient-to-br from-[#FDF6F9] via-white to-[#F0F4FF]">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white/80 backdrop-blur-md sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link to="/" className="flex items-center gap-2 text-gray-500 hover:text-[#F25AA2] transition-colors">
                <ArrowLeft className="w-4 h-4" />
                Back
              </Link>
              <div className="h-6 w-px bg-gray-200" />
              <div className="flex items-center gap-2">
                {isPublic ? (
                  <Globe className="w-5 h-5 text-[#F25AA2]" />
                ) : (
                  <BarChart3 className="w-5 h-5 text-[#F25AA2]" />
                )}
                <h1 className="text-lg font-bold text-gray-900">
                  {isPublic ? 'Blossom Statistics' : 'Execution Statistics'}
                </h1>
                <span className="px-2 py-0.5 text-xs bg-[#F25AA2]/10 text-[#F25AA2] rounded-full font-medium border border-[#F25AA2]/20">
                  BETA
                </span>
                {!isPublic && (
                  <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">DEV</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4">
              {/* Health Indicator */}
              <div className="flex items-center gap-2 text-xs">
                <div className={`w-2 h-2 rounded-full ${
                  apiHealth === 'healthy' ? 'bg-green-500 animate-pulse' :
                  apiHealth === 'error' ? 'bg-red-500' : 'bg-yellow-500'
                }`} />
                <span className={
                  apiHealth === 'healthy' ? 'text-green-600' :
                  apiHealth === 'error' ? 'text-red-600' : 'text-yellow-600'
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
                  className="w-3 h-3 rounded border-gray-300 text-[#F25AA2] focus:ring-[#F25AA2]"
                />
                <span className={showTortureRuns ? 'text-[#F25AA2]' : 'text-gray-500'}>
                  Show CLI runs
                </span>
              </label>
              <span className="text-xs text-gray-500">
                {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : ''}
              </span>
              <button
                onClick={fetchData}
                disabled={loading}
                className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-[#F25AA2] text-white hover:bg-[#E14A92] transition-colors disabled:opacity-50 shadow-sm"
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
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
            {error}
          </div>
        )}

        {/* Summary Cards */}
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Summary</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {/* Total Executions */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4 text-[#F25AA2]" />
                <span className="text-xs text-gray-500 uppercase tracking-wide">Executions</span>
              </div>
              <div className="text-2xl font-mono font-bold text-gray-900">
                {stats ? formatNumberDashboard(stats.totalExecutions) : '-'}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                <span className="text-green-600">{stats?.successfulExecutions ?? 0}</span> successful
              </div>
            </div>

            {/* USD Routed */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="w-4 h-4 text-green-600" />
                <span className="text-xs text-gray-500 uppercase tracking-wide">USD Routed</span>
              </div>
              <div className="text-2xl font-mono font-bold text-green-600">
                {stats ? formatUsdDashboard(stats.totalUsdRouted) : '-'}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                estimated value
              </div>
            </div>

            {/* Success Rate */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <span className="text-xs text-gray-500 uppercase tracking-wide">Success Rate</span>
              </div>
              <div className={`text-2xl font-mono font-bold ${
                (stats?.successRateAdjusted ?? stats?.successRate ?? 0) >= 90 ? 'text-green-600' :
                (stats?.successRateAdjusted ?? stats?.successRate ?? 0) >= 70 ? 'text-yellow-600' : 'text-red-600'
              }`}>
                {(stats?.successRateAdjusted ?? stats?.successRate)?.toFixed(1) ?? '0.0'}%
              </div>
              {stats?.successRateAdjusted !== undefined && stats?.successRateRaw !== undefined &&
               Math.abs((stats?.successRateAdjusted ?? 0) - (stats?.successRateRaw ?? 0)) > 1 && (
                <div className="text-xs text-gray-500 mt-1">
                  {stats?.successRateRaw?.toFixed(1)}% raw
                </div>
              )}
            </div>

            {/* Relayed TX */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Send className="w-4 h-4 text-cyan-600" />
                <span className="text-xs text-gray-500 uppercase tracking-wide">Relayed TX</span>
              </div>
              <div className="text-2xl font-mono font-bold text-cyan-600">
                {stats ? formatNumberDashboard(stats.relayedTxCount) : '-'}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                via relayer
              </div>
            </div>

            {/* Failures */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <span className="text-xs text-gray-500 uppercase tracking-wide">Failures</span>
              </div>
              <div className="text-2xl font-mono font-bold text-red-600">
                {stats?.failedExecutions ?? 0}
              </div>
            </div>

            {/* Chains Active */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Server className="w-4 h-4 text-purple-600" />
                <span className="text-xs text-gray-500 uppercase tracking-wide">Chains</span>
              </div>
              <div className="text-2xl font-mono font-bold text-purple-600">
                {stats?.chainsActive?.length ?? 0}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {stats?.chainsActive?.join(', ') || 'none'}
              </div>
            </div>

            {/* Unique Wallets */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-blue-600" />
                <span className="text-xs text-gray-500 uppercase tracking-wide">Unique Wallets</span>
              </div>
              <div className="text-2xl font-mono font-bold text-blue-600">
                {stats?.uniqueWallets ?? 0}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                distinct addresses
              </div>
            </div>
          </div>
        </section>

        {/* Intent Summary Cards */}
        {intentStats && intentStats.totalIntents > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Intent Tracking</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Total Intents */}
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="w-4 h-4 text-[#F25AA2]" />
                  <span className="text-xs text-gray-500 uppercase tracking-wide">Intents</span>
                </div>
                <div className="text-2xl font-mono font-bold text-gray-900">
                  {formatNumberDashboard(intentStats.totalIntents)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  <span className="text-green-600">{intentStats.confirmedIntents}</span> confirmed
                </div>
              </div>

              {/* Intent Success Rate */}
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span className="text-xs text-gray-500 uppercase tracking-wide">Intent Success</span>
                </div>
                <div className={`text-2xl font-mono font-bold ${
                  intentStats.intentSuccessRate >= 90 ? 'text-green-600' :
                  intentStats.intentSuccessRate >= 70 ? 'text-yellow-600' : 'text-red-600'
                }`}>
                  {intentStats.intentSuccessRate.toFixed(1)}%
                </div>
              </div>

              {/* Failed Intents */}
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <XCircle className="w-4 h-4 text-red-600" />
                  <span className="text-xs text-gray-500 uppercase tracking-wide">Failed</span>
                </div>
                <div className="text-2xl font-mono font-bold text-red-600">
                  {intentStats.failedIntents}
                </div>
              </div>

              {/* Failure Breakdown */}
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-yellow-600" />
                  <span className="text-xs text-gray-500 uppercase tracking-wide">By Stage</span>
                </div>
                <div className="text-xs space-y-1 mt-2">
                  {intentStats.failuresByStage.slice(0, 3).map(f => (
                    <div key={f.stage} className="flex justify-between">
                      <span className="text-gray-500">{f.stage}</span>
                      <span className="text-red-600">{f.count}</span>
                    </div>
                  ))}
                  {intentStats.failuresByStage.length === 0 && (
                    <span className="text-gray-500">No failures</span>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Breakdown Cards */}
        {stats && (stats.byKind.length > 0 || stats.byChain.length > 0) && (
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Breakdown</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* By Kind */}
              {stats.byKind.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-[#F25AA2]" />
                    By Kind
                  </h3>
                  <div className="space-y-2">
                    {stats.byKind.map((k) => (
                      <div key={k.kind} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-xs ${getKindColor(k.kind)}`}>
                            {k.kind || 'unknown'}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-gray-900 font-mono">{k.count}</span>
                          {k.usdTotal > 0 && (
                            <span className="text-gray-500 text-xs ml-2">
                              ({formatUsdDashboard(k.usdTotal)})
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
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-2">
                    <Server className="w-4 h-4 text-purple-600" />
                    By Chain
                  </h3>
                  <div className="space-y-2">
                    {stats.byChain.map((c) => (
                      <div key={`${c.chain}-${c.network}`} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${
                            c.chain === 'ethereum' ? 'bg-blue-400' : 'bg-purple-400'
                          }`} />
                          <span className="text-gray-900 capitalize">{c.chain}/{c.network}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-gray-900 font-mono">{c.count}</span>
                          <span className="text-green-600 text-xs ml-2">
                            {c.successCount} ok
                          </span>
                          {c.failedCount > 0 && (
                            <span className="text-red-600 text-xs ml-1">
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
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Executions</h2>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {executions.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr className="text-left text-gray-500 border-b border-gray-200">
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
                          className={`border-b border-gray-200 ${!isPublic ? 'hover:bg-gray-50 cursor-pointer' : ''} ${
                            expandedExecution === exec.id ? 'bg-gray-50' : ''
                          }`}
                          onClick={() => !isPublic && toggleExpanded(exec.id)}
                        >
                          <td className="px-3 py-2">
                            {!isPublic && (expandedExecution === exec.id ? (
                              <ChevronDown className="w-4 h-4 text-gray-500" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-gray-500" />
                            ))}
                          </td>
                          <td className="px-3 py-2 text-gray-500" title={exec.id}>
                            {exec.id.slice(0, 8)}...
                          </td>
                          <td className="px-3 py-2">
                            <span className={`px-2 py-0.5 rounded text-xs ${
                              exec.chain === 'ethereum' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                            }`}>
                              {exec.chain}/{exec.network}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`px-2 py-0.5 rounded text-xs ${getKindColor(exec.kind)}`}>
                              {exec.kind || '-'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-900">{exec.venue || '-'}</td>
                          <td className="px-3 py-2 text-right text-green-600">
                            {exec.usd_estimate ? formatUsdDashboard(exec.usd_estimate) : '-'}
                            {exec.usd_estimate_is_estimate === 1 && (
                              <span className="text-gray-500 text-xs ml-1">~</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
                              exec.status === 'confirmed' || exec.status === 'finalized'
                                ? 'bg-green-100 text-green-700'
                                : exec.status === 'failed'
                                ? 'bg-red-100 text-red-700'
                                : exec.status === 'submitted'
                                ? 'bg-yellow-100 text-yellow-700'
                                : 'bg-gray-200 text-gray-700'
                            }`}>
                              {exec.status === 'confirmed' && <CheckCircle className="w-3 h-3" />}
                              {exec.status === 'failed' && <XCircle className="w-3 h-3" />}
                              {exec.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-500">
                            <div className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatTime(exec.created_at)}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            {exec.relayer_address ? (
                              <span className="text-cyan-600" title={exec.relayer_address}>
                                {truncateAddress(exec.relayer_address)}
                              </span>
                            ) : (
                              <span className="text-gray-500">-</span>
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
                                  <span className="flex items-center gap-1 text-yellow-600" title="Invalid explorer URL">
                                    {truncateHash(exec.tx_hash || '')}
                                    <AlertOctagon className="w-3 h-3" />
                                  </span>
                                )}
                                {exec.tx_hash && (
                                  <button
                                    onClick={(e) => copyToClipboard(exec.tx_hash!, e)}
                                    className="text-gray-500 hover:text-gray-900 p-1 rounded"
                                    title="Copy tx hash"
                                  >
                                    <Copy className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            ) : (
                              <span className="text-gray-500">-</span>
                            )}
                          </td>
                        </tr>
                        {/* Expanded Row - Execution Steps */}
                        {expandedExecution === exec.id && (
                          <tr key={`${exec.id}-steps`}>
                            <td colSpan={10} className="bg-gray-100 p-4">
                              <div className="pl-8">
                                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                  Execution Details
                                </h4>
                                <div className="grid grid-cols-2 gap-4 text-xs mb-4">
                                  <div>
                                    <span className="text-gray-500">Intent:</span>
                                    <span className="text-gray-900 ml-2">{exec.intent}</span>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">Action:</span>
                                    <span className="text-gray-900 ml-2">{exec.action}</span>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">From:</span>
                                    <span className="text-gray-900 ml-2 font-mono">{truncateAddress(exec.from_address)}</span>
                                  </div>
                                  {exec.to_address && (
                                    <div>
                                      <span className="text-gray-500">To:</span>
                                      <span className="text-gray-900 ml-2 font-mono">{truncateAddress(exec.to_address)}</span>
                                    </div>
                                  )}
                                  {exec.token && (
                                    <div>
                                      <span className="text-gray-500">Token:</span>
                                      <span className="text-gray-900 ml-2">{exec.token}</span>
                                    </div>
                                  )}
                                  {exec.amount_display && (
                                    <div>
                                      <span className="text-gray-500">Amount:</span>
                                      <span className="text-gray-900 ml-2">{exec.amount_display}</span>
                                    </div>
                                  )}
                                  {exec.latency_ms && (
                                    <div>
                                      <span className="text-gray-500">Latency:</span>
                                      <span className="text-gray-900 ml-2">{exec.latency_ms}ms</span>
                                    </div>
                                  )}
                                  {exec.gas_used && (
                                    <div>
                                      <span className="text-gray-500">Gas:</span>
                                      <span className="text-gray-900 ml-2">{exec.gas_used}</span>
                                    </div>
                                  )}
                                  {exec.error_message && (
                                    <div className="col-span-2">
                                      <span className="text-gray-500">Error:</span>
                                      <span className="text-red-600 ml-2">{exec.error_message}</span>
                                    </div>
                                  )}
                                </div>

                                {/* Execution Steps */}
                                {executionSteps[exec.id] && executionSteps[exec.id].length > 0 && (
                                  <div className="mt-4">
                                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                      Steps
                                    </h4>
                                    <div className="space-y-2">
                                      {executionSteps[exec.id].map((step) => (
                                        <div key={step.id} className="flex items-center justify-between p-2 bg-white rounded-lg">
                                          <div className="flex items-center gap-3">
                                            <span className="text-gray-500 text-xs w-6">#{step.step_index}</span>
                                            <span className="text-gray-900 capitalize">{step.action}</span>
                                          </div>
                                          <div className="flex items-center gap-4">
                                            <span className={`px-2 py-0.5 rounded-full text-xs ${
                                              step.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                                              step.status === 'failed' ? 'bg-red-100 text-red-700' :
                                              'bg-gray-200 text-gray-700'
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
                                                  <span className="flex items-center gap-1 text-yellow-600 text-xs" title="Invalid URL">
                                                    {truncateHash(step.tx_hash || '')}
                                                    <AlertOctagon className="w-3 h-3" />
                                                  </span>
                                                )}
                                                {step.tx_hash && (
                                                  <button
                                                    onClick={(e) => copyToClipboard(step.tx_hash!, e)}
                                                    className="text-gray-500 hover:text-gray-900 p-1"
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
                                  <p className="text-gray-500 text-xs">No steps recorded for this execution.</p>
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
              <div className="p-8 text-center text-gray-500">
                <p>No executions recorded yet.</p>
                <p className="text-sm mt-2">Run a smoke test to see data here.</p>
              </div>
            )}
          </div>
        </section>

        {/* Internal Verification Panel - Hidden in public mode */}
        {!isPublic && (
        <section className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-600" />
            Internal Verification
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            Test intent execution directly from the UI. Results are recorded in the ledger.
          </p>

          <div className="space-y-3">
            {/* Intent Input */}
            <div>
              <label className="block text-sm text-gray-500 mb-1">Intent Text</label>
              <input
                type="text"
                value={verifyIntent}
                onChange={(e) => setVerifyIntent(e.target.value)}
                placeholder="e.g., swap 0.001 ETH to REDACTED"
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder-[#555] focus:border-[#666] focus:outline-none text-sm"
              />
            </div>

            {/* Chain Selection */}
            <div>
              <label className="block text-sm text-gray-500 mb-1">Chain</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setVerifyChain('ethereum')}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    verifyChain === 'ethereum'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-50 border border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  Ethereum (Sepolia)
                </button>
                <button
                  onClick={() => setVerifyChain('solana')}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    verifyChain === 'solana'
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-50 border border-gray-200 text-gray-500 hover:border-gray-300'
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
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
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
                    <CheckCircle className="w-4 h-4 text-green-600" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-600" />
                  )}
                  <span className={verifyResult.ok ? 'text-green-600' : 'text-red-600'}>
                    {verifyResult.ok ? 'Execution Successful' : 'Execution Failed'}
                  </span>
                  {verifyResult.metadata?.executedKind === 'proof_only' && (
                    <span className="px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-700">
                      proof_only
                    </span>
                  )}
                </div>

                {verifyResult.ok && verifyResult.txHash && (
                  <div className="space-y-1 text-sm">
                    <div className="flex items-center gap-2 text-gray-500">
                      <span>TX:</span>
                      <code className="text-gray-900 font-mono">
                        {verifyResult.txHash.slice(0, 12)}...{verifyResult.txHash.slice(-8)}
                      </code>
                      {verifyResult.explorerUrl && (
                        <a
                          href={verifyResult.explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-300 flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" />
                          View
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-gray-500">
                      <span>Intent ID:</span>
                      <code className="text-gray-900 font-mono text-xs">{verifyResult.intentId}</code>
                    </div>
                  </div>
                )}

                {!verifyResult.ok && verifyResult.error && (
                  <div className="text-sm">
                    <p className="text-red-300">
                      {verifyResult.error.stage}: {verifyResult.error.code}
                    </p>
                    <p className="text-gray-500 mt-1">{verifyResult.error.message}</p>
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
              <h2 className="text-lg font-semibold text-gray-900">Recent Intents</h2>
              {cliCount > 0 && (
                <span className="text-xs text-gray-500">
                  {showTortureRuns ? (
                    <span className="text-[#F25AA2]">{cliCount} CLI intents shown</span>
                  ) : (
                    <span>{cliCount} CLI intents hidden</span>
                  )}
                </span>
              )}
            </div>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr className="text-left text-gray-500 border-b border-gray-200">
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
                          className={`border-b border-gray-200 hover:bg-gray-50 cursor-pointer ${
                            expandedIntent === intent.id ? 'bg-gray-50' : ''
                          }`}
                          onClick={() => toggleIntentExpanded(intent.id)}
                        >
                          <td className="px-3 py-2">
                            {expandedIntent === intent.id ? (
                              <ChevronDown className="w-4 h-4 text-gray-500" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-gray-500" />
                            )}
                          </td>
                          <td className="px-3 py-2 text-gray-900 max-w-[200px] truncate" title={intent.intent_text}>
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
                                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-blue-100 text-blue-700" title={`CLI: ${meta?.category || 'unknown'}`}>
                                      CLI
                                    </span>
                                  );
                                }
                                if (source === 'torture_suite') {
                                  return (
                                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-orange-100 text-orange-700" title="Torture Suite">
                                      TS
                                    </span>
                                  );
                                }
                                if (source === 'ui') {
                                  return (
                                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-green-100 text-green-700" title={`UI: ${meta?.domain || 'unknown'}`}>
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
                          <td className="px-3 py-2 text-right text-green-600">
                            {intent.usd_estimate ? formatUsdDashboard(intent.usd_estimate) : '-'}
                          </td>
                          <td className="px-3 py-2 text-gray-500">
                            {intent.requested_chain || '-'} / {intent.requested_venue || '-'}
                          </td>
                          <td className="px-3 py-2 text-gray-500">
                            <div className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatTime(intent.created_at)}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            {intent.status === 'failed' ? (
                              <div className="text-red-600 text-xs">
                                <span className="font-medium">{intent.failure_stage}</span>
                                {intent.error_code && <span className="ml-1">({intent.error_code})</span>}
                              </div>
                            ) : (
                              <span className="text-gray-500">-</span>
                            )}
                          </td>
                        </tr>
                        {/* Expanded Row - Intent Details */}
                        {expandedIntent === intent.id && (
                          <tr key={`${intent.id}-details`}>
                            <td colSpan={8} className="bg-gray-100 p-4">
                              <div className="pl-8">
                                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                  Intent Details
                                </h4>
                                <div className="grid grid-cols-2 gap-4 text-xs mb-4">
                                  <div>
                                    <span className="text-gray-500">ID:</span>
                                    <span className="text-gray-900 ml-2 font-mono">{intent.id}</span>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">Full Intent:</span>
                                    <span className="text-gray-900 ml-2">{intent.intent_text}</span>
                                  </div>
                                  {intent.planned_at && (
                                    <div>
                                      <span className="text-gray-500">Planned At:</span>
                                      <span className="text-gray-900 ml-2">{formatTime(intent.planned_at)}</span>
                                    </div>
                                  )}
                                  {intent.executed_at && (
                                    <div>
                                      <span className="text-gray-500">Executed At:</span>
                                      <span className="text-gray-900 ml-2">{formatTime(intent.executed_at)}</span>
                                    </div>
                                  )}
                                  {intent.confirmed_at && (
                                    <div>
                                      <span className="text-gray-500">Confirmed At:</span>
                                      <span className="text-gray-900 ml-2">{formatTime(intent.confirmed_at)}</span>
                                    </div>
                                  )}
                                  {intent.error_message && (
                                    <div className="col-span-2">
                                      <span className="text-gray-500">Error:</span>
                                      <span className="text-red-600 ml-2">{intent.error_message}</span>
                                    </div>
                                  )}
                                </div>

                                {/* Parsed Metadata */}
                                {intent.metadata_json && (
                                  <div className="mt-4">
                                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                      Metadata
                                    </h4>
                                    <pre className="text-xs text-gray-500 bg-white p-2 rounded overflow-x-auto max-h-40">
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
          <div className="text-center text-xs text-gray-500">
            Last execution: {formatTime(stats.lastExecutionAt)}
          </div>
        )}
      </main>
    </div>
  );
}
