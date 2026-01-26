/**
 * Dev Execution Ledger Dashboard
 * Private dev-only page for tracking REAL, verifiable executions across chains.
 *
 * GATED: Requires DEV_LEDGER_SECRET query param or env var
 * Route: /dev/ledger?secret=<DEV_LEDGER_SECRET>
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Database,
  RefreshCw,
  ArrowLeft,
  CheckCircle,
  XCircle,
  Clock,
  ExternalLink,
  Layers,
  Wallet,
  Activity,
  Server,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

// The secret MUST be configured in env. Query param is deprecated.
const LEDGER_SECRET = import.meta.env.VITE_DEV_LEDGER_SECRET || '';
const IS_SECRET_CONFIGURED = Boolean(import.meta.env.VITE_DEV_LEDGER_SECRET);

interface Execution {
  id: string;
  chain: string;
  network: string;
  intent: string;
  action: string;
  from_address: string;
  to_address?: string;
  token?: string;
  amount_units?: string;
  amount_display?: string;
  tx_hash?: string;
  status: string;
  error_code?: string;
  error_message?: string;
  explorer_url?: string;
  gas_used?: string;
  block_number?: number;
  latency_ms?: number;
  created_at: number;
}

interface Session {
  id: string;
  chain: string;
  network: string;
  user_address: string;
  session_id: string;
  status: string;
  expires_at?: number;
  created_at: number;
}

interface Asset {
  id: string;
  chain: string;
  network: string;
  wallet_address: string;
  token_symbol: string;
  balance_units?: string;
  balance_display?: string;
  updated_at: number;
}

interface LedgerSummary {
  totalExecutions: number;
  confirmedExecutions: number;
  failedExecutions: number;
  successRate: number;
  byChain: { chain: string; count: number; confirmed: number }[];
  activeSessions: number;
  trackedAssets: number;
  registeredWallets: number;
  recentExecutions: Execution[];
}

interface ProofBundle {
  ethereum: { txHash: string; explorerUrl: string; action: string; createdAt: number }[];
  solana: { txHash: string; explorerUrl: string; action: string; createdAt: number }[];
}

import { getAgentApiBaseUrl } from '../lib/apiClient';
const API_BASE = getAgentApiBaseUrl();

export default function DevLedgerPage() {
  const [searchParams] = useSearchParams();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [proofBundle, setProofBundle] = useState<ProofBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'executions' | 'sessions' | 'assets' | 'proofs'>('overview');
  const [showDeprecationWarning, setShowDeprecationWarning] = useState(false);

  // Check authorization
  // BULLETPROOF GATING: VITE_DEV_LEDGER_SECRET MUST be set in env
  useEffect(() => {
    const querySecret = searchParams.get('secret');

    // Show deprecation warning if query param used
    if (querySecret) {
      setShowDeprecationWarning(true);
    }

    // HARD REQUIREMENT: Env secret MUST be configured
    if (!IS_SECRET_CONFIGURED) {
      setIsAuthorized(false);
      setLoading(false);
      return;
    }

    setIsAuthorized(true);
  }, [searchParams]);

  const fetchData = useCallback(async () => {
    if (!isAuthorized) return;

    setLoading(true);
    setError(null);

    const secret = searchParams.get('secret') || LEDGER_SECRET;
    const headers = { 'X-Ledger-Secret': secret };

    try {
      const [summaryRes, execRes, sessionsRes, assetsRes, proofsRes] = await Promise.all([
        fetch(`${API_BASE}/api/ledger/summary`, { headers }),
        fetch(`${API_BASE}/api/ledger/executions?limit=50`, { headers }),
        fetch(`${API_BASE}/api/ledger/sessions?limit=20`, { headers }),
        fetch(`${API_BASE}/api/ledger/assets?limit=50`, { headers }),
        fetch(`${API_BASE}/api/ledger/proofs`, { headers }),
      ]);

      if (!summaryRes.ok || !execRes.ok) {
        throw new Error('Failed to fetch ledger data');
      }

      const summaryData = await summaryRes.json();
      const execData = await execRes.json();
      const sessionsData = await sessionsRes.json();
      const assetsData = await assetsRes.json();
      const proofsData = await proofsRes.json();

      if (summaryData.ok) setSummary(summaryData.data);
      if (execData.ok) setExecutions(execData.data);
      if (sessionsData.ok) setSessions(sessionsData.data);
      if (assetsData.ok) setAssets(assetsData.data);
      if (proofsData.ok) setProofBundle(proofsData.data);

      setLastUpdated(new Date());
    } catch (e) {
      setError('Failed to fetch ledger data. Is the agent running with ledger API enabled?');
    } finally {
      setLoading(false);
    }
  }, [isAuthorized, searchParams]);

  useEffect(() => {
    if (isAuthorized) {
      fetchData();
    }
  }, [isAuthorized, fetchData]);

  const formatTime = (timestamp: number): string => {
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

  // Unauthorized view - Ledger not configured
  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#FDF6F9] via-white to-[#F0F4FF] flex items-center justify-center">
        <div className="bg-white rounded-xl border border-[#E5E5E5] p-8 max-w-md text-center shadow-lg">
          <Database className="w-12 h-12 text-[#F25AA2] mx-auto mb-4" />
          <h1 className="text-xl font-bold text-[#111111] mb-2">Execution Ledger</h1>
          <p className="text-[#666666] mb-4">
            This is a private dev-only dashboard.
          </p>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-left mb-4">
            <p className="text-red-700 text-sm font-medium mb-2">Ledger Not Configured</p>
            <p className="text-red-600 text-xs">
              Set <code className="bg-red-100 px-1 rounded">VITE_DEV_LEDGER_SECRET</code> in your <code className="bg-red-100 px-1 rounded">.env.local</code> file.
            </p>
          </div>
          <p className="text-xs text-[#999999]">
            Query param authentication is deprecated. Environment variable is required.
          </p>
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
                <Database className="w-5 h-5 text-[#F25AA2]" />
                <h1 className="text-lg font-bold text-white">Execution Ledger</h1>
                <span className="px-2 py-0.5 text-xs bg-[#F25AA2]/20 text-[#F25AA2] rounded-full">DEV</span>
              </div>
            </div>
            <div className="flex items-center gap-4">
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

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Deprecation warning for query param auth */}
        {showDeprecationWarning && (
          <div className="bg-yellow-900/30 border border-yellow-500/50 rounded-lg p-4 text-yellow-400 flex items-start gap-3">
            <span className="text-yellow-400 text-lg">⚠️</span>
            <div>
              <p className="font-medium">Query secret is deprecated</p>
              <p className="text-sm text-yellow-500 mt-1">
                Set <code className="bg-yellow-900/50 px-1 rounded">VITE_DEV_LEDGER_SECRET</code> in your <code className="bg-yellow-900/50 px-1 rounded">.env.local</code> and remove <code className="bg-yellow-900/50 px-1 rounded">?secret=</code> from URL.
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-900/30 border border-red-500/50 rounded-lg p-4 text-red-400">
            {error}
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex gap-1 bg-[#1a1a2e] rounded-lg p-1 border border-[#333]">
          {[
            { id: 'overview', label: 'Overview', icon: Activity },
            { id: 'executions', label: 'Executions', icon: Layers },
            { id: 'sessions', label: 'Sessions', icon: Server },
            { id: 'assets', label: 'Assets', icon: Wallet },
            { id: 'proofs', label: 'Proof Bundle', icon: CheckCircle },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id as any)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === id
                  ? 'bg-[#F25AA2] text-white'
                  : 'text-[#888] hover:text-white hover:bg-[#333]'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && summary && (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-[#1a1a2e] rounded-xl border border-[#333] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Layers className="w-4 h-4 text-[#F25AA2]" />
                  <span className="text-xs text-[#888] uppercase tracking-wide">Total Executions</span>
                </div>
                <div className="text-2xl font-mono font-bold text-white">
                  {summary.totalExecutions}
                </div>
                <div className="text-xs text-[#666] mt-1">
                  <span className="text-green-400">{summary.confirmedExecutions}</span> confirmed
                </div>
              </div>

              <div className="bg-[#1a1a2e] rounded-xl border border-[#333] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <span className="text-xs text-[#888] uppercase tracking-wide">Success Rate</span>
                </div>
                <div className="text-2xl font-mono font-bold text-green-400">
                  {summary.successRate.toFixed(1)}%
                </div>
                <div className="text-xs text-[#666] mt-1">
                  <span className="text-red-400">{summary.failedExecutions}</span> failed
                </div>
              </div>

              <div className="bg-[#1a1a2e] rounded-xl border border-[#333] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Server className="w-4 h-4 text-blue-400" />
                  <span className="text-xs text-[#888] uppercase tracking-wide">Active Sessions</span>
                </div>
                <div className="text-2xl font-mono font-bold text-white">
                  {summary.activeSessions}
                </div>
              </div>

              <div className="bg-[#1a1a2e] rounded-xl border border-[#333] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Wallet className="w-4 h-4 text-purple-400" />
                  <span className="text-xs text-[#888] uppercase tracking-wide">Wallets</span>
                </div>
                <div className="text-2xl font-mono font-bold text-white">
                  {summary.registeredWallets}
                </div>
                <div className="text-xs text-[#666] mt-1">
                  {summary.trackedAssets} assets tracked
                </div>
              </div>
            </div>

            {/* By Chain Breakdown */}
            <div className="bg-[#1a1a2e] rounded-xl border border-[#333] p-6">
              <h3 className="text-sm font-semibold text-white mb-4">Executions by Chain</h3>
              <div className="grid grid-cols-2 gap-4">
                {summary.byChain.map((chain) => (
                  <div key={chain.chain} className="flex items-center justify-between p-3 bg-[#0f0f23] rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${
                        chain.chain === 'ethereum' ? 'bg-blue-400' : 'bg-purple-400'
                      }`} />
                      <span className="text-white capitalize">{chain.chain}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-white font-mono">{chain.count}</span>
                      <span className="text-[#666] text-xs ml-2">
                        ({chain.confirmed} confirmed)
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Executions Preview */}
            <div className="bg-[#1a1a2e] rounded-xl border border-[#333] overflow-hidden">
              <div className="px-6 py-4 border-b border-[#333] flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Recent Executions</h3>
                <button
                  onClick={() => setActiveTab('executions')}
                  className="text-xs text-[#F25AA2] hover:underline"
                >
                  View All
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#0f0f23]">
                    <tr className="text-left text-[#888] border-b border-[#333]">
                      <th className="px-4 py-3 font-medium">Time</th>
                      <th className="px-4 py-3 font-medium">Chain</th>
                      <th className="px-4 py-3 font-medium">Action</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">TX</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {summary.recentExecutions.slice(0, 5).map((exec) => (
                      <tr key={exec.id} className="border-b border-[#333] last:border-0 hover:bg-[#0f0f23]">
                        <td className="px-4 py-3 text-[#888]">{formatTime(exec.created_at)}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            exec.chain === 'ethereum' ? 'bg-blue-900/50 text-blue-400' : 'bg-purple-900/50 text-purple-400'
                          }`}>
                            {exec.chain}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-white capitalize">{exec.action}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
                            exec.status === 'confirmed' || exec.status === 'finalized'
                              ? 'bg-green-900/50 text-green-400'
                              : exec.status === 'failed'
                              ? 'bg-red-900/50 text-red-400'
                              : 'bg-yellow-900/50 text-yellow-400'
                          }`}>
                            {exec.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {exec.tx_hash && exec.explorer_url ? (
                            <a
                              href={exec.explorer_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#F25AA2] hover:underline flex items-center gap-1"
                            >
                              {truncateHash(exec.tx_hash)}
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : exec.tx_hash ? (
                            <span className="text-[#888]">{truncateHash(exec.tx_hash)}</span>
                          ) : (
                            <span className="text-[#666]">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Executions Tab */}
        {activeTab === 'executions' && (
          <div className="bg-[#1a1a2e] rounded-xl border border-[#333] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#0f0f23]">
                  <tr className="text-left text-[#888] border-b border-[#333]">
                    <th className="px-4 py-3 font-medium">Time</th>
                    <th className="px-4 py-3 font-medium">Chain</th>
                    <th className="px-4 py-3 font-medium">Intent</th>
                    <th className="px-4 py-3 font-medium">Action</th>
                    <th className="px-4 py-3 font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">TX Hash</th>
                    <th className="px-4 py-3 font-medium text-right">Latency</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {executions.map((exec) => (
                    <tr key={exec.id} className="border-b border-[#333] last:border-0 hover:bg-[#0f0f23]">
                      <td className="px-4 py-3 text-[#888]">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatTime(exec.created_at)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          exec.chain === 'ethereum' ? 'bg-blue-900/50 text-blue-400' : 'bg-purple-900/50 text-purple-400'
                        }`}>
                          {exec.chain}/{exec.network}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-white max-w-[200px] truncate" title={exec.intent}>
                        {exec.intent}
                      </td>
                      <td className="px-4 py-3 text-white capitalize">{exec.action}</td>
                      <td className="px-4 py-3 text-white">
                        {exec.amount_display || (exec.token ? `${exec.amount_units} ${exec.token}` : '-')}
                      </td>
                      <td className="px-4 py-3">
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
                      <td className="px-4 py-3">
                        {exec.tx_hash && exec.explorer_url ? (
                          <a
                            href={exec.explorer_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#F25AA2] hover:underline flex items-center gap-1"
                          >
                            {truncateHash(exec.tx_hash)}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : exec.tx_hash ? (
                          <span className="text-[#888]">{truncateHash(exec.tx_hash)}</span>
                        ) : (
                          <span className="text-[#666]">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-[#888]">
                        {exec.latency_ms ? `${exec.latency_ms}ms` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Sessions Tab */}
        {activeTab === 'sessions' && (
          <div className="bg-[#1a1a2e] rounded-xl border border-[#333] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#0f0f23]">
                  <tr className="text-left text-[#888] border-b border-[#333]">
                    <th className="px-4 py-3 font-medium">User</th>
                    <th className="px-4 py-3 font-medium">Chain</th>
                    <th className="px-4 py-3 font-medium">Session ID</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Expires</th>
                    <th className="px-4 py-3 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {sessions.map((session) => (
                    <tr key={session.id} className="border-b border-[#333] last:border-0 hover:bg-[#0f0f23]">
                      <td className="px-4 py-3 text-white">{truncateAddress(session.user_address)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          session.chain === 'ethereum' ? 'bg-blue-900/50 text-blue-400' : 'bg-purple-900/50 text-purple-400'
                        }`}>
                          {session.chain}/{session.network}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[#888]">{session.session_id}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${
                          session.status === 'active' ? 'bg-green-900/50 text-green-400' :
                          session.status === 'expired' ? 'bg-gray-900/50 text-gray-400' :
                          session.status === 'revoked' ? 'bg-red-900/50 text-red-400' :
                          'bg-yellow-900/50 text-yellow-400'
                        }`}>
                          {session.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[#888]">
                        {session.expires_at ? formatTime(session.expires_at) : '-'}
                      </td>
                      <td className="px-4 py-3 text-[#888]">{formatTime(session.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Assets Tab */}
        {activeTab === 'assets' && (
          <div className="bg-[#1a1a2e] rounded-xl border border-[#333] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#0f0f23]">
                  <tr className="text-left text-[#888] border-b border-[#333]">
                    <th className="px-4 py-3 font-medium">Wallet</th>
                    <th className="px-4 py-3 font-medium">Chain</th>
                    <th className="px-4 py-3 font-medium">Token</th>
                    <th className="px-4 py-3 font-medium text-right">Balance</th>
                    <th className="px-4 py-3 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {assets.map((asset) => (
                    <tr key={asset.id} className="border-b border-[#333] last:border-0 hover:bg-[#0f0f23]">
                      <td className="px-4 py-3 text-white">{truncateAddress(asset.wallet_address)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          asset.chain === 'ethereum' ? 'bg-blue-900/50 text-blue-400' : 'bg-purple-900/50 text-purple-400'
                        }`}>
                          {asset.chain}/{asset.network}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-white">{asset.token_symbol}</td>
                      <td className="px-4 py-3 text-right text-white">
                        {asset.balance_display || asset.balance_units || '-'}
                      </td>
                      <td className="px-4 py-3 text-[#888]">{formatTime(asset.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Proof Bundle Tab */}
        {activeTab === 'proofs' && proofBundle && (
          <div className="space-y-6">
            <div className="bg-[#1a1a2e] rounded-xl border border-[#333] p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Proof Bundle</h3>
              <p className="text-[#888] text-sm mb-6">
                Verified on-chain transaction hashes proving real execution capability.
              </p>

              {/* Ethereum Proofs */}
              <div className="mb-6">
                <h4 className="text-sm font-medium text-blue-400 mb-3 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-400" />
                  Ethereum Sepolia ({proofBundle.ethereum.length} proofs)
                </h4>
                {proofBundle.ethereum.length > 0 ? (
                  <div className="space-y-2">
                    {proofBundle.ethereum.map((proof, i) => (
                      <div key={i} className="flex items-center justify-between p-3 bg-[#0f0f23] rounded-lg">
                        <div className="flex items-center gap-3">
                          <CheckCircle className="w-4 h-4 text-green-400" />
                          <span className="text-white capitalize">{proof.action}</span>
                          <span className="text-[#666] text-xs">{formatTime(proof.createdAt)}</span>
                        </div>
                        <a
                          href={proof.explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#F25AA2] hover:underline flex items-center gap-1 font-mono text-sm"
                        >
                          {truncateHash(proof.txHash)}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[#666] text-sm">No confirmed Ethereum transactions yet.</p>
                )}
              </div>

              {/* Solana Proofs */}
              <div>
                <h4 className="text-sm font-medium text-purple-400 mb-3 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-purple-400" />
                  Solana Devnet ({proofBundle.solana.length} proofs)
                </h4>
                {proofBundle.solana.length > 0 ? (
                  <div className="space-y-2">
                    {proofBundle.solana.map((proof, i) => (
                      <div key={i} className="flex items-center justify-between p-3 bg-[#0f0f23] rounded-lg">
                        <div className="flex items-center gap-3">
                          <CheckCircle className="w-4 h-4 text-green-400" />
                          <span className="text-white capitalize">{proof.action}</span>
                          <span className="text-[#666] text-xs">{formatTime(proof.createdAt)}</span>
                        </div>
                        <a
                          href={proof.explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#F25AA2] hover:underline flex items-center gap-1 font-mono text-sm"
                        >
                          {truncateHash(proof.txHash)}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[#666] text-sm">No confirmed Solana transactions yet.</p>
                )}
              </div>
            </div>

            {/* Export Section */}
            <div className="bg-[#1a1a2e] rounded-xl border border-[#333] p-6">
              <h4 className="text-sm font-medium text-white mb-3">Export Proof Bundle</h4>
              <pre className="bg-[#0f0f23] p-4 rounded-lg overflow-x-auto text-xs text-[#888]">
                {JSON.stringify(proofBundle, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
