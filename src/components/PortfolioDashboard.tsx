/**
 * PortfolioDashboard Component
 *
 * Unified cross-chain portfolio view displaying assets across Ethereum and Solana.
 * Features:
 * - Real-time balance updates using TanStack Query
 * - Aggregated view with chain breakdown
 * - Position PnL tracking
 * - Mobile responsive design
 */

import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  AlertCircle,
  Layers,
  ArrowRightLeft,
  PiggyBank,
} from 'lucide-react';
import { callAgent } from '../lib/apiClient';
import { useBlossomContext } from '../context/BlossomContext';

// Types
interface TokenBalance {
  symbol: string;
  name: string;
  balance: number;
  balanceUsd: number;
  chain: 'ethereum' | 'solana';
  tokenAddress?: string;
  decimals: number;
  priceUsd: number;
  change24h?: number;
}

interface Position {
  id: string;
  type: 'perp' | 'defi' | 'event';
  label: string;
  chain: 'ethereum' | 'solana';
  venue: string;
  sizeUsd: number;
  pnlUsd: number;
  pnlPercent: number;
  side?: 'Long' | 'Short' | 'YES' | 'NO';
}

interface PortfolioData {
  totalValueUsd: number;
  totalPnlUsd: number;
  totalPnlPercent: number;
  balances: TokenBalance[];
  positions: Position[];
  lastUpdated: number;
}

interface PortfolioDashboardProps {
  className?: string;
  showPositions?: boolean;
  compactMode?: boolean;
}

// Chain configuration
const CHAIN_CONFIG = {
  ethereum: {
    label: 'Ethereum',
    shortLabel: 'ETH',
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    icon: '⟠',
  },
  solana: {
    label: 'Solana',
    shortLabel: 'SOL',
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
    icon: '◎',
  },
};

// Fetch portfolio data
async function fetchPortfolioData(
  evmAddress: string | undefined,
  solAddress: string | undefined
): Promise<PortfolioData> {
  // Default empty portfolio
  const emptyPortfolio: PortfolioData = {
    totalValueUsd: 0,
    totalPnlUsd: 0,
    totalPnlPercent: 0,
    balances: [],
    positions: [],
    lastUpdated: Date.now(),
  };

  const normalizedEvmAddress = (typeof evmAddress === 'string' && /^0x[a-fA-F0-9]{40}$/.test(evmAddress))
    ? evmAddress
    : undefined;

  if (!normalizedEvmAddress && !solAddress) {
    return emptyPortfolio;
  }

  try {
    // Fetch EVM balances
    let evmBalances: TokenBalance[] = [];
    if (normalizedEvmAddress) {
      try {
        const response = await callAgent(`/api/wallet/balances?address=${encodeURIComponent(normalizedEvmAddress)}`, {
          method: 'GET',
        });
        if (response.ok) {
          const data = await response.json();
          evmBalances = (data.balances || []).map((b: any) => ({
            symbol: b.symbol,
            name: b.name || b.symbol,
            balance: b.balance || 0,
            balanceUsd: b.balanceUsd || 0,
            chain: 'ethereum' as const,
            tokenAddress: b.tokenAddress,
            decimals: b.decimals || 18,
            priceUsd: b.priceUsd || 0,
            change24h: b.change24h,
          }));
        }
      } catch (e) {
        console.warn('[PortfolioDashboard] Failed to fetch EVM balances:', e);
      }
    }

    // Fetch Solana balances (placeholder - would need actual Solana balance fetching)
    let solBalances: TokenBalance[] = [];
    if (solAddress) {
      // TODO: Implement Solana balance fetching when backend supports it
      // For now, show placeholder
    }

    const allBalances = [...evmBalances, ...solBalances];
    const totalValue = allBalances.reduce((sum, b) => sum + b.balanceUsd, 0);

    return {
      totalValueUsd: totalValue,
      totalPnlUsd: 0, // Would come from positions
      totalPnlPercent: 0,
      balances: allBalances,
      positions: [], // Would come from positions endpoint
      lastUpdated: Date.now(),
    };
  } catch (error) {
    console.error('[PortfolioDashboard] Failed to fetch portfolio:', error);
    return emptyPortfolio;
  }
}

// Format currency
function formatUsd(value: number, compact = false): string {
  if (compact && value >= 1000) {
    return `$${(value / 1000).toFixed(1)}k`;
  }
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Format percent
function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

// Chain breakdown component
function ChainBreakdown({
  balances,
  chain,
}: {
  balances: TokenBalance[];
  chain: 'ethereum' | 'solana';
}) {
  const config = CHAIN_CONFIG[chain];
  const chainBalances = balances.filter((b) => b.chain === chain);
  const totalValue = chainBalances.reduce((sum, b) => sum + b.balanceUsd, 0);

  if (chainBalances.length === 0) {
    return null;
  }

  return (
    <div className={`rounded-lg border ${config.borderColor} ${config.bgColor} p-3`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{config.icon}</span>
          <span className={`text-xs font-medium ${config.color}`}>{config.label}</span>
        </div>
        <span className="text-xs font-semibold text-slate-900">{formatUsd(totalValue)}</span>
      </div>

      <div className="space-y-1">
        {chainBalances.slice(0, 5).map((balance) => (
          <div key={`${chain}-${balance.symbol}`} className="flex items-center justify-between text-[10px]">
            <span className="text-slate-600">{balance.symbol}</span>
            <div className="flex items-center gap-2">
              <span className="text-slate-500">{balance.balance.toFixed(4)}</span>
              <span className="font-medium text-slate-700">{formatUsd(balance.balanceUsd)}</span>
            </div>
          </div>
        ))}
        {chainBalances.length > 5 && (
          <div className="text-[10px] text-slate-500 text-center pt-1">
            +{chainBalances.length - 5} more tokens
          </div>
        )}
      </div>
    </div>
  );
}

// Position row component
function PositionRow({ position }: { position: Position }) {
  const isProfitable = position.pnlUsd >= 0;

  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
      <div className="flex items-center gap-2">
        <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${
          position.type === 'perp' ? 'bg-blue-100' :
          position.type === 'defi' ? 'bg-purple-100' :
          'bg-amber-100'
        }`}>
          {position.type === 'perp' && <TrendingUp className="w-3 h-3 text-blue-600" />}
          {position.type === 'defi' && <PiggyBank className="w-3 h-3 text-purple-600" />}
          {position.type === 'event' && <Layers className="w-3 h-3 text-amber-600" />}
        </div>
        <div>
          <div className="text-xs font-medium text-slate-900">{position.label}</div>
          <div className="text-[10px] text-slate-500">
            {position.venue} {position.side && `(${position.side})`}
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-xs font-medium text-slate-900">{formatUsd(position.sizeUsd)}</div>
        <div className={`text-[10px] font-medium ${isProfitable ? 'text-emerald-600' : 'text-rose-600'}`}>
          {formatPercent(position.pnlPercent)}
        </div>
      </div>
    </div>
  );
}

export default function PortfolioDashboard({
  className = '',
  showPositions = true,
  compactMode = false,
}: PortfolioDashboardProps) {
  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  const { publicKey: solanaPublicKey, connected: solanaConnected } = useWallet();
  const { account, strategies, defiPositions } = useBlossomContext();
  const queryClient = useQueryClient();

  const [expandedChain, setExpandedChain] = useState<'ethereum' | 'solana' | null>(null);
  const [showAllPositions, setShowAllPositions] = useState(false);

  const solanaAddress = solanaPublicKey?.toBase58();

  // Query portfolio data with auto-refresh
  const {
    data: portfolioData,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['portfolio', evmAddress, solanaAddress],
    queryFn: () => fetchPortfolioData(evmAddress, solanaAddress),
    enabled: evmConnected || solanaConnected,
    refetchInterval: 30000, // Refresh every 30 seconds
    staleTime: 10000, // Consider stale after 10 seconds
  });

  // Compute positions from context
  const positions: Position[] = useMemo(() => {
    const result: Position[] = [];

    // Add perp positions from strategies
    strategies
      .filter((s) => s.instrumentType === 'perp' && s.status === 'executed' && !s.isClosed)
      .forEach((s) => {
        result.push({
          id: s.id,
          type: 'perp',
          label: s.market,
          chain: 'ethereum', // Assuming EVM for now
          venue: 'Hyperliquid',
          sizeUsd: s.notionalUsd || 0,
          pnlUsd: s.realizedPnlUsd || 0,
          pnlPercent: s.realizedPnlPct || 0,
          side: s.side,
        });
      });

    // Add event positions
    strategies
      .filter((s) => s.instrumentType === 'event' && s.status === 'executed' && !s.isClosed)
      .forEach((s) => {
        result.push({
          id: s.id,
          type: 'event',
          label: s.eventLabel || 'Event',
          chain: 'ethereum',
          venue: s.eventMarketSource || 'Polymarket',
          sizeUsd: s.stakeUsd || 0,
          pnlUsd: 0,
          pnlPercent: 0,
          side: s.eventSide,
        });
      });

    // Add DeFi positions
    defiPositions
      .filter((p) => p.status === 'active')
      .forEach((p) => {
        result.push({
          id: p.id,
          type: 'defi',
          label: `${p.protocol} ${p.asset}`,
          chain: 'ethereum',
          venue: p.protocol,
          sizeUsd: p.depositUsd,
          pnlUsd: 0,
          pnlPercent: p.apyPct || 0,
        });
      });

    return result;
  }, [strategies, defiPositions]);

  // Use context account value as fallback
  const totalValue = portfolioData?.totalValueUsd || account.accountValue;
  const totalPnl = account.totalPnlPct;

  // Not connected state
  if (!evmConnected && !solanaConnected) {
    return (
      <div className={`rounded-xl border border-slate-200 bg-white p-4 ${className}`}>
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <Wallet className="w-8 h-8 text-slate-300 mb-2" />
          <p className="text-sm text-slate-600 font-medium">Connect Wallet</p>
          <p className="text-xs text-slate-400 mt-1">
            Connect your wallet to view your portfolio
          </p>
        </div>
      </div>
    );
  }

  // Compact mode
  if (compactMode) {
    return (
      <div className={`rounded-xl border border-slate-200 bg-white p-3 ${className}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wide">Portfolio</div>
            <div className="text-lg font-semibold text-slate-900">
              {isLoading ? (
                <span className="text-slate-400">Loading...</span>
              ) : (
                formatUsd(totalValue)
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isLoading && (
              <span className={`text-xs font-medium ${totalPnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {formatPercent(totalPnl)}
              </span>
            )}
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="p-1.5 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Chain pills */}
        <div className="flex gap-1.5 mt-2">
          {evmConnected && (
            <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-[10px] font-medium rounded-full">
              {CHAIN_CONFIG.ethereum.icon} ETH
            </span>
          )}
          {solanaConnected && (
            <span className="px-2 py-0.5 bg-purple-50 text-purple-600 text-[10px] font-medium rounded-full">
              {CHAIN_CONFIG.solana.icon} SOL
            </span>
          )}
        </div>
      </div>
    );
  }

  // Full dashboard
  return (
    <div className={`rounded-xl border border-slate-200 bg-white overflow-hidden ${className}`}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-slate-500" />
            <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
              Portfolio
            </span>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-700 transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${isFetching ? 'animate-spin' : ''}`} />
            {isFetching ? 'Updating...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Total value */}
      <div className="px-4 py-4 bg-gradient-to-br from-pink-50 via-white to-purple-50">
        <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Total Value</div>
        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-bold text-slate-900">
            {isLoading ? (
              <span className="text-slate-400">Loading...</span>
            ) : (
              formatUsd(totalValue)
            )}
          </span>
          {!isLoading && (
            <span className={`flex items-center gap-0.5 text-sm font-medium ${totalPnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {totalPnl >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {formatPercent(totalPnl)}
            </span>
          )}
        </div>

        {/* Chain breakdown pills */}
        <div className="flex gap-2 mt-3">
          {evmConnected && (
            <button
              onClick={() => setExpandedChain(expandedChain === 'ethereum' ? null : 'ethereum')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                expandedChain === 'ethereum'
                  ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-200'
                  : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
              }`}
            >
              <span>{CHAIN_CONFIG.ethereum.icon}</span>
              <span>Ethereum</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${expandedChain === 'ethereum' ? 'rotate-180' : ''}`} />
            </button>
          )}
          {solanaConnected && (
            <button
              onClick={() => setExpandedChain(expandedChain === 'solana' ? null : 'solana')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                expandedChain === 'solana'
                  ? 'bg-purple-100 text-purple-700 ring-2 ring-purple-200'
                  : 'bg-purple-50 text-purple-600 hover:bg-purple-100'
              }`}
            >
              <span>{CHAIN_CONFIG.solana.icon}</span>
              <span>Solana</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${expandedChain === 'solana' ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {/* Expanded chain breakdown */}
      {expandedChain && portfolioData && (
        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50">
          <ChainBreakdown balances={portfolioData.balances} chain={expandedChain} />
        </div>
      )}

      {/* Error state */}
      {isError && (
        <div className="px-4 py-3 border-t border-slate-100 bg-rose-50">
          <div className="flex items-center gap-2 text-xs text-rose-700">
            <AlertCircle className="w-4 h-4" />
            <span>Failed to load portfolio data</span>
          </div>
        </div>
      )}

      {/* Positions */}
      {showPositions && positions.length > 0 && (
        <div className="px-4 py-3 border-t border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
              Open Positions ({positions.length})
            </span>
            {positions.length > 3 && (
              <button
                onClick={() => setShowAllPositions(!showAllPositions)}
                className="text-[10px] text-pink-600 hover:text-pink-700"
              >
                {showAllPositions ? 'Show less' : 'Show all'}
              </button>
            )}
          </div>

          <div className="space-y-0">
            {(showAllPositions ? positions : positions.slice(0, 3)).map((position) => (
              <PositionRow key={position.id} position={position} />
            ))}
          </div>
        </div>
      )}

      {/* Empty positions state */}
      {showPositions && positions.length === 0 && !isLoading && (
        <div className="px-4 py-4 border-t border-slate-100 text-center">
          <Layers className="w-6 h-6 text-slate-300 mx-auto mb-2" />
          <p className="text-xs text-slate-500">No open positions</p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            Start by opening a trade in the chat
          </p>
        </div>
      )}

      {/* Last updated */}
      {portfolioData && (
        <div className="px-4 py-2 border-t border-slate-100 bg-slate-50/50">
          <div className="text-[9px] text-slate-400 text-center">
            Last updated: {new Date(portfolioData.lastUpdated).toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
}

// Export compact version
export function PortfolioDashboardCompact(props: Omit<PortfolioDashboardProps, 'compactMode'>) {
  return <PortfolioDashboard {...props} compactMode />;
}
