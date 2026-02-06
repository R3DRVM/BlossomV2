/**
 * Wallet Tracker Module
 * Privacy-preserving tracking of unique wallet addresses and activity metrics.
 *
 * Features:
 * - Hashes wallet addresses (SHA-256 truncated) for privacy
 * - Tracks unique wallets per day/week
 * - Measures wallet retention and activity patterns
 * - Tracks first-seen and last-seen timestamps
 */

import { createHash } from 'crypto';

// In-memory cache for fast lookups (backed by database)
const walletCache = new Map<string, WalletRecord>();

// Salt for privacy-preserving hashes
const WALLET_SALT = process.env.TELEMETRY_SALT || 'blossom-wallet-salt-v1';

export interface WalletRecord {
  walletHash: string;
  firstSeenAt: number;
  lastSeenAt: number;
  totalRequests: number;
  totalExecutions: number;
  chains: Set<string>;
  lastChain?: string;
}

export interface WalletMetrics {
  // Unique wallet counts
  uniqueWalletsAllTime: number;
  uniqueWalletsLast24h: number;
  uniqueWalletsLast7d: number;
  uniqueWalletsLast30d: number;

  // Activity metrics
  activeWalletsLast24h: number;  // Wallets with >1 request in 24h
  returningWallets: number;      // Wallets seen on multiple days
  newWalletsLast24h: number;     // First-time wallets in 24h

  // Engagement
  avgRequestsPerWallet: number;
  avgExecutionsPerWallet: number;

  // Chain breakdown
  walletsByChain: Record<string, number>;

  // Top wallets (hashed)
  topWalletsByRequests: Array<{ walletHash: string; requests: number }>;

  generatedAt: string;
}

/**
 * Hash a wallet address for privacy
 * Uses first 16 chars of SHA-256 for readability while maintaining privacy
 */
export function hashWallet(address: string): string {
  if (!address) return 'unknown';
  return createHash('sha256')
    .update(WALLET_SALT + address.toLowerCase())
    .digest('hex')
    .substring(0, 16);
}

/**
 * Track a wallet interaction (request or execution)
 */
export function trackWallet(
  address: string,
  chain?: string,
  isExecution: boolean = false
): WalletRecord {
  const walletHash = hashWallet(address);
  const now = Math.floor(Date.now() / 1000);

  let record = walletCache.get(walletHash);

  if (!record) {
    record = {
      walletHash,
      firstSeenAt: now,
      lastSeenAt: now,
      totalRequests: 0,
      totalExecutions: 0,
      chains: new Set(),
    };
    walletCache.set(walletHash, record);
  }

  record.lastSeenAt = now;
  record.totalRequests += 1;

  if (isExecution) {
    record.totalExecutions += 1;
  }

  if (chain) {
    record.chains.add(chain);
    record.lastChain = chain;
  }

  return record;
}

/**
 * Get wallet metrics summary
 */
export function getWalletMetrics(): WalletMetrics {
  const now = Math.floor(Date.now() / 1000);
  const day = 86400;
  const week = day * 7;
  const month = day * 30;

  const wallets = Array.from(walletCache.values());

  // Time-based filters
  const last24h = wallets.filter(w => now - w.lastSeenAt < day);
  const last7d = wallets.filter(w => now - w.lastSeenAt < week);
  const last30d = wallets.filter(w => now - w.lastSeenAt < month);

  // New wallets (first seen in last 24h)
  const newWallets = wallets.filter(w => now - w.firstSeenAt < day);

  // Active wallets (>1 request in 24h - approximated by requests)
  const activeWallets = last24h.filter(w => w.totalRequests > 1);

  // Returning wallets (seen on multiple days - approximated by first/last difference)
  const returningWallets = wallets.filter(w => w.lastSeenAt - w.firstSeenAt > day);

  // Chain breakdown
  const walletsByChain: Record<string, number> = {};
  for (const w of wallets) {
    for (const chain of w.chains) {
      walletsByChain[chain] = (walletsByChain[chain] || 0) + 1;
    }
  }

  // Top wallets by requests
  const topWalletsByRequests = [...wallets]
    .sort((a, b) => b.totalRequests - a.totalRequests)
    .slice(0, 10)
    .map(w => ({ walletHash: w.walletHash, requests: w.totalRequests }));

  // Averages
  const totalRequests = wallets.reduce((sum, w) => sum + w.totalRequests, 0);
  const totalExecutions = wallets.reduce((sum, w) => sum + w.totalExecutions, 0);

  return {
    uniqueWalletsAllTime: wallets.length,
    uniqueWalletsLast24h: last24h.length,
    uniqueWalletsLast7d: last7d.length,
    uniqueWalletsLast30d: last30d.length,

    activeWalletsLast24h: activeWallets.length,
    returningWallets: returningWallets.length,
    newWalletsLast24h: newWallets.length,

    avgRequestsPerWallet: wallets.length > 0 ? totalRequests / wallets.length : 0,
    avgExecutionsPerWallet: wallets.length > 0 ? totalExecutions / wallets.length : 0,

    walletsByChain,
    topWalletsByRequests,

    generatedAt: new Date().toISOString(),
  };
}

/**
 * Get retention metrics
 */
export function getRetentionMetrics(): {
  day1Retention: number;
  day7Retention: number;
  day30Retention: number;
  cohorts: Array<{ date: string; newWallets: number; returnedNextDay: number }>;
} {
  const now = Math.floor(Date.now() / 1000);
  const day = 86400;

  const wallets = Array.from(walletCache.values());

  // Calculate retention rates
  const oldEnoughForD1 = wallets.filter(w => now - w.firstSeenAt > day);
  const returnedD1 = oldEnoughForD1.filter(w => w.lastSeenAt - w.firstSeenAt >= day);
  const day1Retention = oldEnoughForD1.length > 0
    ? (returnedD1.length / oldEnoughForD1.length) * 100
    : 0;

  const oldEnoughForD7 = wallets.filter(w => now - w.firstSeenAt > day * 7);
  const returnedD7 = oldEnoughForD7.filter(w => w.lastSeenAt - w.firstSeenAt >= day * 7);
  const day7Retention = oldEnoughForD7.length > 0
    ? (returnedD7.length / oldEnoughForD7.length) * 100
    : 0;

  const oldEnoughForD30 = wallets.filter(w => now - w.firstSeenAt > day * 30);
  const returnedD30 = oldEnoughForD30.filter(w => w.lastSeenAt - w.firstSeenAt >= day * 30);
  const day30Retention = oldEnoughForD30.length > 0
    ? (returnedD30.length / oldEnoughForD30.length) * 100
    : 0;

  // Build cohort analysis for last 7 days
  const cohorts: Array<{ date: string; newWallets: number; returnedNextDay: number }> = [];
  for (let i = 7; i >= 1; i--) {
    const dayStart = now - (day * i);
    const dayEnd = dayStart + day;

    const cohort = wallets.filter(w => w.firstSeenAt >= dayStart && w.firstSeenAt < dayEnd);
    const returned = cohort.filter(w => w.lastSeenAt >= dayEnd);

    cohorts.push({
      date: new Date(dayStart * 1000).toISOString().split('T')[0],
      newWallets: cohort.length,
      returnedNextDay: returned.length,
    });
  }

  return {
    day1Retention,
    day7Retention,
    day30Retention,
    cohorts,
  };
}

/**
 * Export wallet data for persistence (call on shutdown)
 */
export function exportWalletData(): WalletRecord[] {
  return Array.from(walletCache.values()).map(w => ({
    ...w,
    chains: w.chains, // Will need serialization
  }));
}

/**
 * Import wallet data on startup
 */
export function importWalletData(data: Array<Omit<WalletRecord, 'chains'> & { chains: string[] }>): void {
  for (const record of data) {
    walletCache.set(record.walletHash, {
      ...record,
      chains: new Set(record.chains),
    });
  }
}

/**
 * Clear wallet cache (for testing)
 */
export function clearWalletCache(): void {
  walletCache.clear();
}
