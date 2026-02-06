/**
 * Enhanced Statistics Module
 * Tracks execution events, chain metrics, and cross-chain activity.
 *
 * Features:
 * - Privacy-preserving wallet hashing
 * - Chain-specific metrics (Ethereum + Solana)
 * - Real-time event posting to external API
 * - In-memory aggregation for quick access
 */

import { createHash } from 'crypto';
import { trackWallet, getWalletMetrics, type WalletMetrics } from './telemetry/walletTracker';
import { recordFailure, getFailureMetrics, incrementRequestCount, type FailureMetrics } from './telemetry/failureAnalytics';

// ============================================
// Types
// ============================================

export type ChainType = 'ethereum' | 'solana' | 'unknown';
export type ExecutionStatus = 'success' | 'failed' | 'pending' | 'timeout';
export type IntentKind = 'swap' | 'perp' | 'defi' | 'event' | 'transfer' | 'bridge' | 'other';

export interface StatsEvent {
  type: string;
  status?: ExecutionStatus;
  chain?: ChainType;
  network?: string;
  venue?: string;
  intentKind?: IntentKind;
  usdEstimate?: number | null;
  feeBps?: number;
  feeBusdc?: number | null;
  txHash?: string;
  userHash?: string;
  timestamp?: number;
  latencyMs?: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface ChainMetrics {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  successRate: number;
  totalUsdRouted: number;
  avgLatencyMs: number;
  last24hExecutions: number;
  last24hUsdRouted: number;
}

export interface CrossChainMetrics {
  ethereum: ChainMetrics;
  solana: ChainMetrics;
  combined: ChainMetrics;
  chainDistribution: {
    ethereum: number;  // percentage
    solana: number;
  };
  multiChainWallets: number;  // wallets using both chains
}

export interface EnhancedStats {
  // Core metrics
  totalEvents: number;
  eventsLast24h: number;
  eventsLast1h: number;

  // Chain metrics
  chainMetrics: CrossChainMetrics;

  // Wallet metrics
  walletMetrics: WalletMetrics;

  // Failure analytics
  failureMetrics: FailureMetrics;

  // Intent breakdown
  intentBreakdown: Record<IntentKind, {
    count: number;
    successRate: number;
    avgUsd: number;
  }>;

  // Venue breakdown
  venueBreakdown: Record<string, {
    count: number;
    successRate: number;
    totalUsd: number;
  }>;

  generatedAt: string;
}

// ============================================
// In-memory Storage
// ============================================

interface StoredEvent extends StatsEvent {
  id: string;
}

const eventStore: StoredEvent[] = [];
const MAX_EVENTS = 10000;

// Chain-specific counters
const chainCounters: Record<ChainType, {
  total: number;
  success: number;
  failed: number;
  usdRouted: number;
  latencySum: number;
  latencyCount: number;
  events24h: StoredEvent[];
}> = {
  ethereum: { total: 0, success: 0, failed: 0, usdRouted: 0, latencySum: 0, latencyCount: 0, events24h: [] },
  solana: { total: 0, success: 0, failed: 0, usdRouted: 0, latencySum: 0, latencyCount: 0, events24h: [] },
  unknown: { total: 0, success: 0, failed: 0, usdRouted: 0, latencySum: 0, latencyCount: 0, events24h: [] },
};

// Intent counters
const intentCounters: Record<IntentKind, {
  count: number;
  success: number;
  usdTotal: number;
}> = {
  swap: { count: 0, success: 0, usdTotal: 0 },
  perp: { count: 0, success: 0, usdTotal: 0 },
  defi: { count: 0, success: 0, usdTotal: 0 },
  event: { count: 0, success: 0, usdTotal: 0 },
  transfer: { count: 0, success: 0, usdTotal: 0 },
  bridge: { count: 0, success: 0, usdTotal: 0 },
  other: { count: 0, success: 0, usdTotal: 0 },
};

// Venue counters
const venueCounters: Record<string, {
  count: number;
  success: number;
  usdTotal: number;
}> = {};

// ============================================
// Configuration
// ============================================

const STATS_API_URL = process.env.STATS_API_URL || '';
const STATS_SALT = process.env.TELEMETRY_SALT || 'blossom-stats-salt-v1';

// ============================================
// Helper Functions
// ============================================

/**
 * Hash wallet address for privacy
 */
function hashWallet(address?: string | null): string | undefined {
  if (!address) return undefined;
  return createHash('sha256')
    .update(STATS_SALT + address.toLowerCase())
    .digest('hex')
    .slice(0, 12);
}

/**
 * Generate unique event ID
 */
function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Clean old events from 24h window
 */
function cleanOldEvents(): void {
  const cutoff = Date.now() - 86400000; // 24 hours ago

  for (const chain of Object.keys(chainCounters) as ChainType[]) {
    chainCounters[chain].events24h = chainCounters[chain].events24h.filter(
      e => (e.timestamp || 0) > cutoff
    );
  }
}

/**
 * Detect chain from various inputs
 */
function detectChain(chain?: string, network?: string): ChainType {
  if (!chain && !network) return 'unknown';

  const combined = `${chain || ''} ${network || ''}`.toLowerCase();

  if (combined.includes('sol') || combined.includes('devnet')) {
    return 'solana';
  }
  if (combined.includes('eth') || combined.includes('sepolia') || combined.includes('mainnet')) {
    return 'ethereum';
  }

  return 'unknown';
}

/**
 * Detect intent kind from type or context
 */
function detectIntentKind(type?: string): IntentKind {
  if (!type) return 'other';

  const lower = type.toLowerCase();

  if (lower.includes('swap')) return 'swap';
  if (lower.includes('perp') || lower.includes('position')) return 'perp';
  if (lower.includes('defi') || lower.includes('lend') || lower.includes('supply') || lower.includes('deposit')) return 'defi';
  if (lower.includes('event') || lower.includes('bet') || lower.includes('predict')) return 'event';
  if (lower.includes('transfer') || lower.includes('send')) return 'transfer';
  if (lower.includes('bridge')) return 'bridge';

  return 'other';
}

// ============================================
// Core Functions
// ============================================

/**
 * Post a stats event (enhanced version)
 */
export async function postStatsEvent(
  event: Omit<StatsEvent, 'timestamp' | 'userHash'> & { userAddress?: string | null }
): Promise<void> {
  const timestamp = Date.now();
  const userHash = hashWallet(event.userAddress);
  const chain = detectChain(event.chain, event.network);
  const intentKind = event.intentKind || detectIntentKind(event.type);

  // Build full event
  const fullEvent: StoredEvent = {
    id: generateEventId(),
    ...event,
    chain,
    intentKind,
    userHash,
    timestamp,
  };

  // Store locally
  eventStore.push(fullEvent);
  if (eventStore.length > MAX_EVENTS) {
    eventStore.shift();
  }

  // Track request
  incrementRequestCount();

  // Update chain counters
  chainCounters[chain].total++;
  chainCounters[chain].events24h.push(fullEvent);

  if (event.status === 'success') {
    chainCounters[chain].success++;
  } else if (event.status === 'failed') {
    chainCounters[chain].failed++;

    // Record failure for analytics
    recordFailure({
      errorMessage: event.errorMessage || 'Unknown error',
      errorCode: event.errorCode,
      chain,
      intentType: intentKind === 'other' ? 'other' : intentKind,
      walletHash: userHash,
    });
  }

  if (event.usdEstimate) {
    chainCounters[chain].usdRouted += event.usdEstimate;
  }

  if (event.latencyMs) {
    chainCounters[chain].latencySum += event.latencyMs;
    chainCounters[chain].latencyCount++;
  }

  // Update intent counters
  intentCounters[intentKind].count++;
  if (event.status === 'success') {
    intentCounters[intentKind].success++;
  }
  if (event.usdEstimate) {
    intentCounters[intentKind].usdTotal += event.usdEstimate;
  }

  // Update venue counters
  if (event.venue) {
    if (!venueCounters[event.venue]) {
      venueCounters[event.venue] = { count: 0, success: 0, usdTotal: 0 };
    }
    venueCounters[event.venue].count++;
    if (event.status === 'success') {
      venueCounters[event.venue].success++;
    }
    if (event.usdEstimate) {
      venueCounters[event.venue].usdTotal += event.usdEstimate;
    }
  }

  // Track wallet
  if (event.userAddress) {
    trackWallet(event.userAddress, chain, event.status === 'success');
  }

  // Post to external API (non-blocking)
  if (STATS_API_URL) {
    try {
      await fetch(STATS_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...event,
          chain,
          intentKind,
          userHash,
          timestamp,
        }),
      });
    } catch (error) {
      // Fail open: stats should never block execution
      console.warn('[stats] Failed to post stats event:', (error as Error).message);
    }
  }

  // Clean old events periodically
  if (eventStore.length % 100 === 0) {
    cleanOldEvents();
  }
}

/**
 * Get chain-specific metrics
 */
function getChainMetrics(chain: ChainType): ChainMetrics {
  const counter = chainCounters[chain];
  cleanOldEvents();

  return {
    totalExecutions: counter.total,
    successfulExecutions: counter.success,
    failedExecutions: counter.failed,
    successRate: counter.total > 0 ? (counter.success / counter.total) * 100 : 0,
    totalUsdRouted: counter.usdRouted,
    avgLatencyMs: counter.latencyCount > 0 ? counter.latencySum / counter.latencyCount : 0,
    last24hExecutions: counter.events24h.length,
    last24hUsdRouted: counter.events24h.reduce((sum, e) => sum + (e.usdEstimate || 0), 0),
  };
}

/**
 * Get cross-chain metrics
 */
export function getCrossChainMetrics(): CrossChainMetrics {
  const ethereum = getChainMetrics('ethereum');
  const solana = getChainMetrics('solana');

  const combinedTotal = ethereum.totalExecutions + solana.totalExecutions;
  const combinedSuccess = ethereum.successfulExecutions + solana.successfulExecutions;
  const combinedFailed = ethereum.failedExecutions + solana.failedExecutions;
  const combinedUsd = ethereum.totalUsdRouted + solana.totalUsdRouted;
  const combined24hExec = ethereum.last24hExecutions + solana.last24hExecutions;
  const combined24hUsd = ethereum.last24hUsdRouted + solana.last24hUsdRouted;

  // Calculate weighted average latency
  const ethLatencyWeight = chainCounters.ethereum.latencyCount;
  const solLatencyWeight = chainCounters.solana.latencyCount;
  const totalWeight = ethLatencyWeight + solLatencyWeight;
  const combinedAvgLatency = totalWeight > 0
    ? (ethereum.avgLatencyMs * ethLatencyWeight + solana.avgLatencyMs * solLatencyWeight) / totalWeight
    : 0;

  // Get wallet metrics to find multi-chain wallets
  const walletMetrics = getWalletMetrics();
  const multiChainWallets = Object.values(walletMetrics.walletsByChain).length > 1
    ? Math.min(walletMetrics.walletsByChain.ethereum || 0, walletMetrics.walletsByChain.solana || 0)
    : 0;

  return {
    ethereum,
    solana,
    combined: {
      totalExecutions: combinedTotal,
      successfulExecutions: combinedSuccess,
      failedExecutions: combinedFailed,
      successRate: combinedTotal > 0 ? (combinedSuccess / combinedTotal) * 100 : 0,
      totalUsdRouted: combinedUsd,
      avgLatencyMs: combinedAvgLatency,
      last24hExecutions: combined24hExec,
      last24hUsdRouted: combined24hUsd,
    },
    chainDistribution: {
      ethereum: combinedTotal > 0 ? (ethereum.totalExecutions / combinedTotal) * 100 : 50,
      solana: combinedTotal > 0 ? (solana.totalExecutions / combinedTotal) * 100 : 50,
    },
    multiChainWallets,
  };
}

/**
 * Get intent breakdown
 */
export function getIntentBreakdown(): EnhancedStats['intentBreakdown'] {
  const result: EnhancedStats['intentBreakdown'] = {} as any;

  for (const [kind, counter] of Object.entries(intentCounters)) {
    result[kind as IntentKind] = {
      count: counter.count,
      successRate: counter.count > 0 ? (counter.success / counter.count) * 100 : 0,
      avgUsd: counter.count > 0 ? counter.usdTotal / counter.count : 0,
    };
  }

  return result;
}

/**
 * Get venue breakdown
 */
export function getVenueBreakdown(): EnhancedStats['venueBreakdown'] {
  const result: EnhancedStats['venueBreakdown'] = {};

  for (const [venue, counter] of Object.entries(venueCounters)) {
    result[venue] = {
      count: counter.count,
      successRate: counter.count > 0 ? (counter.success / counter.count) * 100 : 0,
      totalUsd: counter.usdTotal,
    };
  }

  return result;
}

/**
 * Get enhanced stats summary
 */
export function getEnhancedStats(): EnhancedStats {
  const now = Date.now();
  const hour = 3600000;
  const day = 86400000;

  cleanOldEvents();

  const eventsLast24h = eventStore.filter(e => now - (e.timestamp || 0) < day).length;
  const eventsLast1h = eventStore.filter(e => now - (e.timestamp || 0) < hour).length;

  return {
    totalEvents: eventStore.length,
    eventsLast24h,
    eventsLast1h,

    chainMetrics: getCrossChainMetrics(),
    walletMetrics: getWalletMetrics(),
    failureMetrics: getFailureMetrics(),
    intentBreakdown: getIntentBreakdown(),
    venueBreakdown: getVenueBreakdown(),

    generatedAt: new Date().toISOString(),
  };
}

/**
 * Get recent events for debugging
 */
export function getRecentEvents(limit: number = 50): StatsEvent[] {
  return eventStore.slice(-limit).reverse();
}

/**
 * Clear stats (for testing)
 */
export function clearStats(): void {
  eventStore.length = 0;

  for (const chain of Object.keys(chainCounters) as ChainType[]) {
    chainCounters[chain] = {
      total: 0,
      success: 0,
      failed: 0,
      usdRouted: 0,
      latencySum: 0,
      latencyCount: 0,
      events24h: [],
    };
  }

  for (const kind of Object.keys(intentCounters) as IntentKind[]) {
    intentCounters[kind] = { count: 0, success: 0, usdTotal: 0 };
  }

  for (const venue of Object.keys(venueCounters)) {
    delete venueCounters[venue];
  }
}
