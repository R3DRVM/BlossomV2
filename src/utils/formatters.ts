/**
 * Dashboard formatting utilities
 * Consistent number/currency formatting across the app
 */

/**
 * Format USD for dashboard display (NO cents)
 * - If >= 1M: show as "1.2M" (1 decimal max)
 * - Otherwise: show as integer with commas like "189,870"
 * - Never show cents
 */
export function formatUsdDashboard(value: number | undefined | null): string {
  if (value == null || value === 0) return '$0';

  // Handle negative values
  const isNegative = value < 0;
  const absValue = Math.abs(value);

  // Format based on magnitude
  let formatted: string;
  if (absValue >= 1_000_000) {
    // Show as millions with 1 decimal max
    const millions = absValue / 1_000_000;
    formatted = `$${millions.toFixed(1)}M`;
  } else {
    // Show as integer with commas (no cents)
    formatted = `$${Math.floor(absValue).toLocaleString('en-US')}`;
  }

  return isNegative ? `-${formatted}` : formatted;
}

/**
 * Format number for dashboard display
 * - If >= 1M: "1.2M"
 * - If >= 1K: "1.5K"
 * - Otherwise: "123"
 */
export function formatNumberDashboard(value: number | undefined | null): string {
  if (value == null) return '-';

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return Math.floor(value).toLocaleString('en-US');
}

/**
 * Format timestamp for display
 */
export function formatTime(timestamp: number | null | undefined): string {
  if (timestamp == null) return '-';
  return new Date(timestamp * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Truncate address for display
 */
export function truncateAddress(addr: string): string {
  if (!addr) return '-';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/**
 * Truncate hash for display
 */
export function truncateHash(hash: string): string {
  if (!hash) return '-';
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}
