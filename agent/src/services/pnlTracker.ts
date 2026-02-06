/**
 * PnL Tracking and Alerts Service
 * Real-time PnL calculation with configurable alert thresholds
 *
 * Features:
 * - Real-time PnL calculation (unrealized + realized)
 * - Configurable alert thresholds
 * - Position-level and portfolio-level tracking
 * - Historical PnL tracking
 * - Notification system (console/log based for MVP)
 */

import { v4 as uuidv4 } from 'uuid';
import { getCurrentPrice } from './riskMonitor';

// PnL types
export interface PositionPnL {
  positionId: string;
  market: string;
  side: 'long' | 'short';
  entryPrice: number;
  currentPrice: number;
  sizeUsd: number;
  leverage: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  realizedPnlUsd: number;
  lastUpdated: number;
  isClosed: boolean;
}

export interface PortfolioPnL {
  totalUnrealizedPnlUsd: number;
  totalUnrealizedPnlPct: number;
  totalRealizedPnlUsd: number;
  totalPnlUsd: number;
  totalPnlPct: number;
  positionCount: number;
  highWatermarkUsd: number;
  currentDrawdownPct: number;
  maxDrawdownPct: number;
  lastUpdated: number;
}

export interface PnLAlert {
  id: string;
  type: 'profit_target' | 'loss_threshold' | 'drawdown' | 'daily_limit';
  severity: 'info' | 'warning' | 'critical';
  positionId?: string;
  market?: string;
  message: string;
  pnlValue: number;
  threshold: number;
  timestamp: number;
}

export interface AlertThresholds {
  // Position-level alerts
  positionProfitPct: number;     // Alert when position profit exceeds (e.g., 10%)
  positionLossPct: number;       // Alert when position loss exceeds (e.g., -5%)

  // Portfolio-level alerts
  portfolioDrawdownPct: number;  // Alert on drawdown (e.g., 10%)
  dailyLossLimitUsd: number;     // Alert on daily loss limit (e.g., 500)
  dailyLossLimitPct: number;     // Alert on daily loss % (e.g., 5%)

  // Profit-taking alerts
  takeProfitReminderPct: number; // Remind to take profit (e.g., 5%)
}

export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  positionProfitPct: 10,
  positionLossPct: 5,
  portfolioDrawdownPct: 10,
  dailyLossLimitUsd: 500,
  dailyLossLimitPct: 5,
  takeProfitReminderPct: 5,
};

// In-memory state
let positionPnLs: Map<string, PositionPnL> = new Map();
let portfolioPnL: PortfolioPnL = createEmptyPortfolioPnL();
let pnlAlerts: PnLAlert[] = [];
let alertThresholds: AlertThresholds = { ...DEFAULT_ALERT_THRESHOLDS };
let dailyStartingValue: number = 0;
let dailyResetDate: string = '';

// Historical PnL for charting
interface PnLSnapshot {
  timestamp: number;
  portfolioValueUsd: number;
  unrealizedPnlUsd: number;
  realizedPnlUsd: number;
}
let pnlHistory: PnLSnapshot[] = [];
const MAX_HISTORY_LENGTH = 1000;

// Alert listeners
type PnLAlertListener = (alert: PnLAlert) => void;
const alertListeners: Set<PnLAlertListener> = new Set();

function createEmptyPortfolioPnL(): PortfolioPnL {
  return {
    totalUnrealizedPnlUsd: 0,
    totalUnrealizedPnlPct: 0,
    totalRealizedPnlUsd: 0,
    totalPnlUsd: 0,
    totalPnlPct: 0,
    positionCount: 0,
    highWatermarkUsd: 0,
    currentDrawdownPct: 0,
    maxDrawdownPct: 0,
    lastUpdated: Date.now(),
  };
}

/**
 * Register a position for PnL tracking
 */
export function registerPositionForPnL(position: {
  id: string;
  market: string;
  side: 'long' | 'short';
  entryPrice: number;
  sizeUsd: number;
  leverage?: number;
}): void {
  const pnl: PositionPnL = {
    positionId: position.id,
    market: position.market,
    side: position.side,
    entryPrice: position.entryPrice,
    currentPrice: position.entryPrice,
    sizeUsd: position.sizeUsd,
    leverage: position.leverage || 1,
    unrealizedPnlUsd: 0,
    unrealizedPnlPct: 0,
    realizedPnlUsd: 0,
    lastUpdated: Date.now(),
    isClosed: false,
  };

  positionPnLs.set(position.id, pnl);
  console.log(`[PnLTracker] Registered position ${position.id} for PnL tracking: ${position.market} ${position.side}`);
}

/**
 * Close a position and record realized PnL
 */
export function closePositionPnL(positionId: string, realizedPnlUsd: number): void {
  const pnl = positionPnLs.get(positionId);
  if (!pnl) {
    console.warn(`[PnLTracker] Position ${positionId} not found`);
    return;
  }

  pnl.realizedPnlUsd = realizedPnlUsd;
  pnl.unrealizedPnlUsd = 0;
  pnl.unrealizedPnlPct = 0;
  pnl.isClosed = true;
  pnl.lastUpdated = Date.now();

  console.log(`[PnLTracker] Closed position ${positionId} with realized PnL: $${realizedPnlUsd.toFixed(2)}`);

  // Update portfolio realized PnL
  portfolioPnL.totalRealizedPnlUsd += realizedPnlUsd;
}

/**
 * Update position with current price and calculate PnL
 */
async function updatePositionPnL(pnl: PositionPnL): Promise<void> {
  if (pnl.isClosed) {
    return;
  }

  const currentPrice = await getCurrentPrice(pnl.market);
  if (!currentPrice) {
    return;
  }

  pnl.currentPrice = currentPrice;

  // Calculate unrealized PnL
  const priceDelta = pnl.side === 'long'
    ? currentPrice - pnl.entryPrice
    : pnl.entryPrice - currentPrice;

  // PnL based on position size and price movement
  const notionalSize = pnl.sizeUsd * pnl.leverage;
  pnl.unrealizedPnlUsd = (priceDelta / pnl.entryPrice) * notionalSize;
  pnl.unrealizedPnlPct = (priceDelta / pnl.entryPrice) * 100 * pnl.leverage;
  pnl.lastUpdated = Date.now();

  // Check for position-level alerts
  checkPositionAlerts(pnl);
}

/**
 * Check position-level alert thresholds
 */
function checkPositionAlerts(pnl: PositionPnL): void {
  // Profit alert
  if (pnl.unrealizedPnlPct >= alertThresholds.positionProfitPct) {
    emitPnLAlert({
      type: 'profit_target',
      severity: 'info',
      positionId: pnl.positionId,
      market: pnl.market,
      message: `Position ${pnl.market} ${pnl.side} has reached +${pnl.unrealizedPnlPct.toFixed(1)}% profit ($${pnl.unrealizedPnlUsd.toFixed(2)})`,
      pnlValue: pnl.unrealizedPnlPct,
      threshold: alertThresholds.positionProfitPct,
    });
  }

  // Loss alert
  if (pnl.unrealizedPnlPct <= -alertThresholds.positionLossPct) {
    emitPnLAlert({
      type: 'loss_threshold',
      severity: 'warning',
      positionId: pnl.positionId,
      market: pnl.market,
      message: `Position ${pnl.market} ${pnl.side} has reached ${pnl.unrealizedPnlPct.toFixed(1)}% loss ($${pnl.unrealizedPnlUsd.toFixed(2)})`,
      pnlValue: pnl.unrealizedPnlPct,
      threshold: -alertThresholds.positionLossPct,
    });
  }

  // Take profit reminder
  if (pnl.unrealizedPnlPct >= alertThresholds.takeProfitReminderPct) {
    emitPnLAlert({
      type: 'profit_target',
      severity: 'info',
      positionId: pnl.positionId,
      market: pnl.market,
      message: `Consider taking profit on ${pnl.market} ${pnl.side}: +${pnl.unrealizedPnlPct.toFixed(1)}%`,
      pnlValue: pnl.unrealizedPnlPct,
      threshold: alertThresholds.takeProfitReminderPct,
    });
  }
}

/**
 * Update all positions and portfolio PnL
 */
export async function updateAllPnL(portfolioValueUsd?: number): Promise<PortfolioPnL> {
  const positions = Array.from(positionPnLs.values());

  // Update each position
  for (const pnl of positions) {
    try {
      await updatePositionPnL(pnl);
    } catch (error) {
      console.error(`[PnLTracker] Error updating position ${pnl.positionId}:`, error);
    }
  }

  // Calculate portfolio totals
  const openPositions = positions.filter(p => !p.isClosed);
  const totalUnrealizedPnlUsd = openPositions.reduce((sum, p) => sum + p.unrealizedPnlUsd, 0);
  const totalRealizedPnlUsd = positions.reduce((sum, p) => sum + p.realizedPnlUsd, 0);
  const totalSizeUsd = openPositions.reduce((sum, p) => sum + p.sizeUsd, 0);

  portfolioPnL.totalUnrealizedPnlUsd = totalUnrealizedPnlUsd;
  portfolioPnL.totalRealizedPnlUsd = totalRealizedPnlUsd;
  portfolioPnL.totalPnlUsd = totalUnrealizedPnlUsd + totalRealizedPnlUsd;
  portfolioPnL.positionCount = openPositions.length;
  portfolioPnL.lastUpdated = Date.now();

  // Calculate percentages if we have portfolio value
  if (portfolioValueUsd && portfolioValueUsd > 0) {
    portfolioPnL.totalUnrealizedPnlPct = (totalUnrealizedPnlUsd / portfolioValueUsd) * 100;
    portfolioPnL.totalPnlPct = (portfolioPnL.totalPnlUsd / portfolioValueUsd) * 100;

    // Update high watermark and drawdown
    const currentValue = portfolioValueUsd + totalUnrealizedPnlUsd;
    if (currentValue > portfolioPnL.highWatermarkUsd) {
      portfolioPnL.highWatermarkUsd = currentValue;
    }

    if (portfolioPnL.highWatermarkUsd > 0) {
      portfolioPnL.currentDrawdownPct = ((portfolioPnL.highWatermarkUsd - currentValue) / portfolioPnL.highWatermarkUsd) * 100;
      if (portfolioPnL.currentDrawdownPct > portfolioPnL.maxDrawdownPct) {
        portfolioPnL.maxDrawdownPct = portfolioPnL.currentDrawdownPct;
      }
    }

    // Record snapshot for history
    recordPnLSnapshot(portfolioValueUsd, totalUnrealizedPnlUsd, totalRealizedPnlUsd);
  }

  // Check portfolio-level alerts
  checkPortfolioAlerts(portfolioValueUsd);

  return portfolioPnL;
}

/**
 * Check portfolio-level alert thresholds
 */
function checkPortfolioAlerts(portfolioValueUsd?: number): void {
  // Drawdown alert
  if (portfolioPnL.currentDrawdownPct >= alertThresholds.portfolioDrawdownPct) {
    emitPnLAlert({
      type: 'drawdown',
      severity: 'critical',
      message: `Portfolio drawdown has reached ${portfolioPnL.currentDrawdownPct.toFixed(1)}% from high watermark`,
      pnlValue: portfolioPnL.currentDrawdownPct,
      threshold: alertThresholds.portfolioDrawdownPct,
    });
  }

  // Daily loss limit checks
  const today = new Date().toISOString().split('T')[0];
  if (today !== dailyResetDate) {
    dailyResetDate = today;
    dailyStartingValue = portfolioValueUsd || 0;
  }

  if (dailyStartingValue > 0 && portfolioValueUsd) {
    const dailyLossUsd = dailyStartingValue - portfolioValueUsd;
    const dailyLossPct = (dailyLossUsd / dailyStartingValue) * 100;

    if (dailyLossUsd >= alertThresholds.dailyLossLimitUsd) {
      emitPnLAlert({
        type: 'daily_limit',
        severity: 'critical',
        message: `Daily loss limit reached: -$${dailyLossUsd.toFixed(2)} (limit: $${alertThresholds.dailyLossLimitUsd})`,
        pnlValue: dailyLossUsd,
        threshold: alertThresholds.dailyLossLimitUsd,
      });
    }

    if (dailyLossPct >= alertThresholds.dailyLossLimitPct) {
      emitPnLAlert({
        type: 'daily_limit',
        severity: 'critical',
        message: `Daily loss percentage limit reached: -${dailyLossPct.toFixed(1)}% (limit: ${alertThresholds.dailyLossLimitPct}%)`,
        pnlValue: dailyLossPct,
        threshold: alertThresholds.dailyLossLimitPct,
      });
    }
  }
}

/**
 * Emit a PnL alert
 */
function emitPnLAlert(alert: Omit<PnLAlert, 'id' | 'timestamp'>): void {
  // Deduplicate: don't emit same alert type for same position within 5 minutes
  const recentCutoff = Date.now() - 5 * 60 * 1000;
  const isDuplicate = pnlAlerts.some(a =>
    a.type === alert.type &&
    a.positionId === alert.positionId &&
    a.timestamp > recentCutoff
  );

  if (isDuplicate) {
    return;
  }

  const fullAlert: PnLAlert = {
    ...alert,
    id: uuidv4(),
    timestamp: Date.now(),
  };

  pnlAlerts.push(fullAlert);

  // Keep only last 100 alerts
  if (pnlAlerts.length > 100) {
    pnlAlerts = pnlAlerts.slice(-100);
  }

  // Notify listeners
  for (const listener of alertListeners) {
    try {
      listener(fullAlert);
    } catch (error) {
      console.error('[PnLTracker] Alert listener error:', error);
    }
  }

  // Log based on severity
  const logFn = fullAlert.severity === 'critical' ? console.error :
                fullAlert.severity === 'warning' ? console.warn :
                console.log;
  logFn(`[PnLTracker] ${fullAlert.severity.toUpperCase()}: ${fullAlert.message}`);
}

/**
 * Record a PnL snapshot for historical tracking
 */
function recordPnLSnapshot(portfolioValueUsd: number, unrealizedPnlUsd: number, realizedPnlUsd: number): void {
  pnlHistory.push({
    timestamp: Date.now(),
    portfolioValueUsd,
    unrealizedPnlUsd,
    realizedPnlUsd,
  });

  // Trim history if too long
  if (pnlHistory.length > MAX_HISTORY_LENGTH) {
    pnlHistory = pnlHistory.slice(-MAX_HISTORY_LENGTH);
  }
}

/**
 * Get position PnL
 */
export function getPositionPnL(positionId: string): PositionPnL | undefined {
  return positionPnLs.get(positionId);
}

/**
 * Get all position PnLs
 */
export function getAllPositionPnLs(): PositionPnL[] {
  return Array.from(positionPnLs.values());
}

/**
 * Get portfolio PnL summary
 */
export function getPortfolioPnL(): PortfolioPnL {
  return { ...portfolioPnL };
}

/**
 * Get PnL history for charting
 */
export function getPnLHistory(limit?: number): PnLSnapshot[] {
  return limit ? pnlHistory.slice(-limit) : [...pnlHistory];
}

/**
 * Get recent PnL alerts
 */
export function getPnLAlerts(limit: number = 50): PnLAlert[] {
  return pnlAlerts.slice(-limit);
}

/**
 * Subscribe to PnL alerts
 */
export function subscribeToPnLAlerts(listener: PnLAlertListener): () => void {
  alertListeners.add(listener);
  return () => alertListeners.delete(listener);
}

/**
 * Update alert thresholds
 */
export function updateAlertThresholds(updates: Partial<AlertThresholds>): void {
  alertThresholds = { ...alertThresholds, ...updates };
  console.log('[PnLTracker] Alert thresholds updated:', alertThresholds);
}

/**
 * Get current alert thresholds
 */
export function getAlertThresholds(): AlertThresholds {
  return { ...alertThresholds };
}

/**
 * Get PnL summary for a specific time window
 */
export function getPnLSummary(windowMs?: number): {
  periodPnlUsd: number;
  periodPnlPct: number;
  numTrades: number;
  winRate: number;
  avgWinUsd: number;
  avgLossUsd: number;
} {
  const cutoff = windowMs ? Date.now() - windowMs : 0;
  const positions = Array.from(positionPnLs.values())
    .filter(p => p.isClosed && p.lastUpdated >= cutoff);

  if (positions.length === 0) {
    return {
      periodPnlUsd: 0,
      periodPnlPct: 0,
      numTrades: 0,
      winRate: 0,
      avgWinUsd: 0,
      avgLossUsd: 0,
    };
  }

  const wins = positions.filter(p => p.realizedPnlUsd > 0);
  const losses = positions.filter(p => p.realizedPnlUsd < 0);

  const periodPnlUsd = positions.reduce((sum, p) => sum + p.realizedPnlUsd, 0);
  const totalSize = positions.reduce((sum, p) => sum + p.sizeUsd, 0);

  return {
    periodPnlUsd,
    periodPnlPct: totalSize > 0 ? (periodPnlUsd / totalSize) * 100 : 0,
    numTrades: positions.length,
    winRate: positions.length > 0 ? (wins.length / positions.length) * 100 : 0,
    avgWinUsd: wins.length > 0 ? wins.reduce((sum, p) => sum + p.realizedPnlUsd, 0) / wins.length : 0,
    avgLossUsd: losses.length > 0 ? Math.abs(losses.reduce((sum, p) => sum + p.realizedPnlUsd, 0) / losses.length) : 0,
  };
}

/**
 * Clear all PnL tracking state (for testing)
 */
export function clearPnLState(): void {
  positionPnLs.clear();
  portfolioPnL = createEmptyPortfolioPnL();
  pnlAlerts = [];
  pnlHistory = [];
  dailyStartingValue = 0;
  dailyResetDate = '';
}
