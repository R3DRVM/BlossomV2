/**
 * Devnet Activity Page
 * Dedicated page showing comprehensive devnet metrics:
 * - Summary cards (traffic, executions, users)
 * - Runs table (last 10)
 * - Executions table (last 50) - hidden until meaningful execution volume
 *
 * Execution metrics are hidden until meaningful tx-backed data exists.
 * Controlled by VITE_SHOW_EXECUTION_METRICS env var (default false)
 * and auto-hidden if executions.allTime < 10 OR total volume == 0
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Activity, Users, Zap, RefreshCw, ArrowLeft, Clock, Server, CheckCircle, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getAgentApiBaseUrl } from '../lib/apiClient';

// Feature flag: hide execution metrics until meaningful tx volume exists
const SHOW_EXECUTION_METRICS_FLAG = import.meta.env.VITE_SHOW_EXECUTION_METRICS === 'true';

interface DevnetStats {
  traffic: {
    requestsAllTime: number;
    requestsLast24h: number;
    successRate24h: number;
    http5xx24h: number;
    visitorsAllTime: number;
    visitorsLast24h: number;
  };
  executions: {
    allTime: number;
    last24h: number;
    successCount: number;
    failCount: number;
  };
  users: {
    allTime: number;
    last24h: number;
  };
  amountExecuted: {
    byToken: Array<{ token: string; totalUnits: string }>;
    unpricedCount: number;
  };
  feesCollected: {
    byToken: Array<{ token: string; totalFeeUnits: string; last24hFeeUnits: string }>;
    feeBps: number;
    unpricedCount: number;
  };
  generatedAt: string;
}

interface DevnetRun {
  run_id: string;
  stage: number | null;
  users: number;
  concurrency: number;
  duration: number;
  total_requests: number;
  success_rate: number;
  p50_ms: number;
  p95_ms: number;
  http_5xx: number;
  top_error_code: string | null;
  started_at: string;
  ended_at: string;
  report_path: string | null;
  created_at: number;
}

interface Execution {
  id: string;
  user_address: string;
  draft_id?: string;
  correlation_id?: string;
  action: string;
  token?: string;
  amount_units?: string;
  mode: string;
  status: string;
  tx_hash?: string;
  error_code?: string;
  created_at: number;
  latency_ms?: number;
}

interface RpcHealth {
  ok: boolean;
  primary: { url: string; healthy: boolean; circuitOpen: boolean } | null;
  fallbacks: Array<{ url: string; healthy: boolean; circuitOpen: boolean }>;
}

const API_BASE = getAgentApiBaseUrl();
const REFRESH_INTERVAL_MS = 15000;

export default function DevnetActivityPage() {
  const [stats, setStats] = useState<DevnetStats | null>(null);
  const [runs, setRuns] = useState<DevnetRun[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [rpcHealth, setRpcHealth] = useState<RpcHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [statsRes, runsRes, execRes, rpcRes] = await Promise.all([
        fetch(`${API_BASE}/api/telemetry/devnet-stats`),
        fetch(`${API_BASE}/api/telemetry/runs?limit=10`),
        fetch(`${API_BASE}/api/telemetry/executions?limit=50`),
        fetch(`${API_BASE}/api/rpc/health`),
      ]);

      const statsData = await statsRes.json();
      const runsData = await runsRes.json();
      const execData = await execRes.json();
      const rpcData = await rpcRes.json();

      if (statsData.ok && statsData.data) {
        setStats(statsData.data);
      }
      if (runsData.ok && runsData.data) {
        setRuns(runsData.data);
      }
      if (execData.ok && execData.data) {
        setExecutions(execData.data);
      }
      if (rpcData) {
        setRpcHealth(rpcData);
      }

      setLastUpdated(new Date());
    } catch (e) {
      setError('Failed to fetch devnet data. Is the agent running?');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  const formatNumber = (n: number | null | undefined): string => {
    if (n == null) return '-';
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toLocaleString();
  };

  const formatTime = (timestamp: number | string | null | undefined): string => {
    if (timestamp == null) return '-';
    try {
      const date = typeof timestamp === 'number'
        ? new Date(timestamp * 1000)
        : new Date(timestamp);
      if (isNaN(date.getTime())) return '-';
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '-';
    }
  };

  const truncateAddress = (addr: string): string => {
    if (!addr) return '-';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const truncateHash = (hash: string): string => {
    if (!hash) return '-';
    return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
  };

  // Determine if execution metrics should be shown
  // Hidden unless: flag is true AND executions >= 5 AND has volume AND fees
  const showExecutionMetrics = useMemo(() => {
    if (!SHOW_EXECUTION_METRICS_FLAG) return false;
    if (!stats) return false;
    if (stats.executions.allTime < 5) return false;
    // Check if there's any volume
    const totalVolume = stats.amountExecuted.byToken.reduce((sum, t) => {
      return sum + parseFloat(t.totalUnits || '0');
    }, 0);
    // Check if there are any fees collected
    const totalFees = stats.feesCollected.byToken.reduce((sum, t) => {
      return sum + parseFloat(t.totalFeeUnits || '0');
    }, 0);
    // Hide if either volume or fees are zero (don't show misleading data)
    if (totalVolume === 0 || totalFees === 0) return false;
    return true;
  }, [stats]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#FDF6F9] via-white to-[#F0F4FF]">
      {/* Header */}
      <header className="border-b border-[#E5E5E5] bg-white/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link to="/" className="flex items-center gap-2 text-[#666666] hover:text-[#F25AA2] transition-colors">
                <ArrowLeft className="w-4 h-4" />
                Back to Home
              </Link>
              <div className="h-6 w-px bg-[#E5E5E5]" />
              <h1 className="text-xl font-bold text-[#111111]">Devnet Activity Dashboard</h1>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-xs text-[#666666]">
                Last updated: {lastUpdated ? lastUpdated.toLocaleTimeString() : 'Never'}
              </span>
              <button
                onClick={fetchData}
                disabled={loading}
                className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-[#F25AA2]/10 text-[#F25AA2] hover:bg-[#F25AA2]/20 transition-colors disabled:opacity-50"
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
          <h2 className="text-lg font-semibold text-[#111111] mb-4">Summary</h2>
          <div className={`grid grid-cols-2 ${showExecutionMetrics ? 'md:grid-cols-4 lg:grid-cols-5' : 'md:grid-cols-4'} gap-4`}>
            {/* Requests Processed */}
            <div className="bg-white rounded-xl border border-[#E5E5E5] p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-blue-500" />
                <span className="text-xs text-[#666666] uppercase tracking-wide">Requests</span>
              </div>
              <div className="text-2xl font-mono font-bold text-[#111111]">
                {stats ? formatNumber(stats.traffic.requestsAllTime) : '-'}
              </div>
              <div className="text-xs text-[#666666] mt-1">
                {stats && <span className="text-blue-500 font-medium">{formatNumber(stats.traffic.requestsLast24h)}</span>} last 24h
              </div>
            </div>

            {/* Executions - Only shown when meaningful */}
            {showExecutionMetrics && (
              <div className="bg-white rounded-xl border border-[#E5E5E5] p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4 text-[#F25AA2]" />
                  <span className="text-xs text-[#666666] uppercase tracking-wide">Executions</span>
                </div>
                <div className="text-2xl font-mono font-bold text-[#111111]">
                  {stats ? formatNumber(stats.executions.allTime) : '-'}
                </div>
                <div className="text-xs text-[#666666] mt-1">
                  <span className="text-green-600 font-medium">{stats?.executions.successCount ?? 0}</span> confirmed
                </div>
              </div>
            )}

            {/* Users */}
            <div className="bg-white rounded-xl border border-[#E5E5E5] p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-purple-500" />
                <span className="text-xs text-[#666666] uppercase tracking-wide">Users</span>
              </div>
              <div className="text-2xl font-mono font-bold text-[#111111]">
                {stats ? formatNumber(stats.users.allTime) : '-'}
              </div>
              <div className="text-xs text-[#666666] mt-1">
                <span className="text-purple-500 font-medium">{stats?.traffic.visitorsAllTime ?? 0}</span> visitors
              </div>
            </div>

            {/* Success Rate */}
            <div className="bg-white rounded-xl border border-[#E5E5E5] p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span className="text-xs text-[#666666] uppercase tracking-wide">Traffic Success</span>
              </div>
              <div className="text-2xl font-mono font-bold text-green-600">
                {stats?.traffic.successRate24h.toFixed(1) ?? '0.0'}%
              </div>
              <div className="text-xs text-[#666666] mt-1">
                {stats?.traffic.http5xx24h ?? 0} 5xx errors (24h)
              </div>
            </div>

            {/* RPC Status */}
            <div className="bg-white rounded-xl border border-[#E5E5E5] p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Server className="w-4 h-4 text-orange-500" />
                <span className="text-xs text-[#666666] uppercase tracking-wide">RPC Status</span>
              </div>
              <div className="text-2xl font-mono font-bold">
                {rpcHealth?.primary?.healthy ? (
                  <span className="text-green-600">Healthy</span>
                ) : rpcHealth?.primary?.circuitOpen ? (
                  <span className="text-red-600">Circuit Open</span>
                ) : (
                  <span className="text-yellow-600">Unknown</span>
                )}
              </div>
              <div className="text-xs text-[#666666] mt-1">
                {rpcHealth?.fallbacks.length ?? 0} fallback(s)
              </div>
            </div>
          </div>
        </section>

        {/* Latest Run Highlight */}
        {runs.length > 0 && runs[0] && (
          <section>
            <h2 className="text-lg font-semibold text-[#111111] mb-4">Latest Run</h2>
            <div className="bg-gradient-to-r from-[#F25AA2]/5 to-[#F0F4FF] rounded-xl border-2 border-[#F25AA2]/20 p-6 shadow-sm">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <p className="text-xs text-[#666666] uppercase tracking-wide mb-1">Run ID</p>
                  <p className="text-sm font-mono text-[#111111]" title={runs[0].run_id || ''}>
                    {runs[0].run_id || '-'}
                  </p>
                  <p className="text-xs text-[#666666] mt-1">
                    <Clock className="w-3 h-3 inline mr-1" />
                    {formatTime(runs[0].started_at)}
                  </p>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
                  <div className="text-center">
                    <p className="text-xs text-[#666666] uppercase tracking-wide">Requests</p>
                    <p className="text-2xl font-mono font-bold text-[#111111]">
                      {formatNumber(runs[0].total_requests)}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-[#666666] uppercase tracking-wide">Users</p>
                    <p className="text-2xl font-mono font-bold text-[#111111]">
                      {formatNumber(runs[0].users)}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-[#666666] uppercase tracking-wide">Success</p>
                    <p className={`text-2xl font-mono font-bold ${
                      (runs[0].success_rate ?? 0) >= 99 ? 'text-green-600' :
                      (runs[0].success_rate ?? 0) >= 95 ? 'text-yellow-600' : 'text-red-600'
                    }`}>
                      {runs[0].success_rate?.toFixed(1) ?? '0.0'}%
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-[#666666] uppercase tracking-wide">P95 Latency</p>
                    <p className={`text-2xl font-mono font-bold ${
                      (runs[0].p95_ms ?? 0) > 500 ? 'text-yellow-600' : 'text-[#111111]'
                    }`}>
                      {runs[0].p95_ms ?? '-'}ms
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Traffic Runs Table */}
        <section>
          <h2 className="text-lg font-semibold text-[#111111] mb-4">Recent Traffic Runs</h2>
          <div className="bg-white rounded-xl border border-[#E5E5E5] overflow-hidden shadow-sm">
            {runs.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#F9FAFB]">
                    <tr className="text-left text-[#666666] border-b border-[#E5E5E5]">
                      <th className="px-4 py-3 font-medium">Run ID</th>
                      <th className="px-4 py-3 font-medium">Started</th>
                      <th className="px-4 py-3 font-medium text-right">Users</th>
                      <th className="px-4 py-3 font-medium text-right">Requests</th>
                      <th className="px-4 py-3 font-medium text-right">Success %</th>
                      <th className="px-4 py-3 font-medium text-right">P50 (ms)</th>
                      <th className="px-4 py-3 font-medium text-right">P95 (ms)</th>
                      <th className="px-4 py-3 font-medium text-right">5xx</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {runs.map((run) => (
                      <tr key={run.run_id || Math.random()} className="border-b border-[#E5E5E5] last:border-0 hover:bg-[#F9FAFB]">
                        <td className="px-4 py-3 text-[#111111] truncate max-w-[200px]" title={run.run_id || ''}>
                          {(run.run_id?.length ?? 0) > 25 ? `${run.run_id?.slice(0, 25)}...` : (run.run_id || '-')}
                        </td>
                        <td className="px-4 py-3 text-[#666666]">
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatTime(run.started_at)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-[#111111]">{formatNumber(run.users)}</td>
                        <td className="px-4 py-3 text-right text-[#111111]">{formatNumber(run.total_requests)}</td>
                        <td className={`px-4 py-3 text-right font-semibold ${
                          (run.success_rate ?? 0) >= 99 ? 'text-green-600' :
                          (run.success_rate ?? 0) >= 95 ? 'text-yellow-600' : 'text-red-600'
                        }`}>
                          {run.success_rate?.toFixed(1) ?? '0.0'}%
                        </td>
                        <td className="px-4 py-3 text-right text-[#666666]">{run.p50_ms ?? '-'}</td>
                        <td className={`px-4 py-3 text-right ${(run.p95_ms ?? 0) > 500 ? 'text-yellow-600' : 'text-[#666666]'}`}>
                          {run.p95_ms ?? '-'}
                        </td>
                        <td className={`px-4 py-3 text-right font-semibold ${(run.http_5xx ?? 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {run.http_5xx ?? 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center text-[#666666]">
                <p>No traffic runs yet.</p>
                <p className="text-sm mt-2">Run <code className="bg-[#F0F0F0] px-2 py-1 rounded">npm run devnet:campaign</code> to generate data.</p>
              </div>
            )}
          </div>
        </section>

        {/* Executions Table - Only shown when meaningful execution data exists */}
        {showExecutionMetrics && (
          <section>
            <h2 className="text-lg font-semibold text-[#111111] mb-4">Recent Executions</h2>
            <div className="bg-white rounded-xl border border-[#E5E5E5] overflow-hidden shadow-sm">
              {executions.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-[#F9FAFB]">
                      <tr className="text-left text-[#666666] border-b border-[#E5E5E5]">
                        <th className="px-4 py-3 font-medium">Time</th>
                        <th className="px-4 py-3 font-medium">User</th>
                        <th className="px-4 py-3 font-medium">Action</th>
                        <th className="px-4 py-3 font-medium">Token</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">TX Hash</th>
                        <th className="px-4 py-3 font-medium text-right">Latency</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {executions.map((exec) => (
                        <tr key={exec.id} className="border-b border-[#E5E5E5] last:border-0 hover:bg-[#F9FAFB]">
                          <td className="px-4 py-3 text-[#666666]">{formatTime(exec.created_at)}</td>
                          <td className="px-4 py-3 text-[#111111]">{truncateAddress(exec.user_address)}</td>
                          <td className="px-4 py-3 text-[#111111] capitalize">{exec.action}</td>
                          <td className="px-4 py-3 text-[#666666]">{exec.token || '-'}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                              exec.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                              exec.status === 'failed' ? 'bg-red-100 text-red-700' :
                              exec.status === 'prepared' ? 'bg-blue-100 text-blue-700' :
                              'bg-gray-100 text-gray-700'
                            }`}>
                              {exec.status === 'confirmed' && <CheckCircle className="w-3 h-3" />}
                              {exec.status === 'failed' && <XCircle className="w-3 h-3" />}
                              {exec.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-[#666666]">
                            {exec.tx_hash ? (
                              <a
                                href={`https://sepolia.etherscan.io/tx/${exec.tx_hash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline"
                              >
                                {truncateHash(exec.tx_hash)}
                              </a>
                            ) : '-'}
                          </td>
                          <td className="px-4 py-3 text-right text-[#666666]">
                            {exec.latency_ms ? `${exec.latency_ms}ms` : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-8 text-center text-[#666666]">
                  <p>No executions recorded yet.</p>
                  <p className="text-sm mt-2">Execute a plan to see data here.</p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* RPC Health Details */}
        {rpcHealth && (
          <section>
            <h2 className="text-lg font-semibold text-[#111111] mb-4">RPC Provider Status</h2>
            <div className="bg-white rounded-xl border border-[#E5E5E5] p-4 shadow-sm">
              <div className="space-y-3">
                {rpcHealth.primary && (
                  <div className="flex items-center justify-between py-2 border-b border-[#E5E5E5]">
                    <div>
                      <span className="text-sm font-medium text-[#111111]">Primary</span>
                      <p className="text-xs text-[#666666] font-mono">{rpcHealth.primary.url}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {rpcHealth.primary.healthy ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                          <CheckCircle className="w-3 h-3" /> Healthy
                        </span>
                      ) : rpcHealth.primary.circuitOpen ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium">
                          <XCircle className="w-3 h-3" /> Circuit Open
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-medium">
                          Unknown
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {rpcHealth.fallbacks.map((fb, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-[#E5E5E5] last:border-0">
                    <div>
                      <span className="text-sm font-medium text-[#111111]">Fallback {i + 1}</span>
                      <p className="text-xs text-[#666666] font-mono">{fb.url}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {fb.healthy ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                          <CheckCircle className="w-3 h-3" /> Healthy
                        </span>
                      ) : fb.circuitOpen ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium">
                          <XCircle className="w-3 h-3" /> Circuit Open
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-medium">
                          Standby
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
