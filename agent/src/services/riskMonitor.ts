/**
 * Risk Monitor Service
 * Real-time risk monitoring with Chainlink price oracle integration (Sepolia)
 *
 * Features:
 * - Chainlink price feeds on Sepolia
 * - Position monitoring with configurable thresholds
 * - Circuit breaker for high volatility
 * - Integration with stop-loss/take-profit system
 */

import { createPublicClient, http, parseAbi, type Address } from 'viem';
import { sepolia } from 'viem/chains';
import { getPrice, type PriceSymbol } from './prices';
import { ETH_TESTNET_RPC_URL } from '../config';

// Chainlink Price Feed Addresses on Sepolia
// https://docs.chain.link/data-feeds/price-feeds/addresses?network=ethereum&page=1#sepolia-testnet
export const CHAINLINK_FEEDS_SEPOLIA: Record<string, Address> = {
  'ETH/USD': '0x694AA1769357215DE4FAC081bf1f309aDC325306',
  'BTC/USD': '0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43',
  'LINK/USD': '0xc59E3633BAAC79493d908e63626716e204A45EdF',
  'SOL/USD': '0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1', // Note: May not exist on Sepolia
};

// Chainlink AggregatorV3 ABI (minimal)
const AGGREGATOR_V3_ABI = parseAbi([
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() external view returns (uint8)',
  'function description() external view returns (string memory)',
]);

// Risk thresholds
export interface RiskThresholds {
  maxLeverage: number;              // e.g., 20
  maxDrawdownPct: number;           // e.g., 50
  maxPositionSizePct: number;       // e.g., 25 (% of portfolio)
  volatilityCircuitBreakerPct: number; // e.g., 10 (24h volatility)
  minLiquidationBufferPct: number;  // e.g., 15
}

export const DEFAULT_RISK_THRESHOLDS: RiskThresholds = {
  maxLeverage: 20,
  maxDrawdownPct: 50,
  maxPositionSizePct: 25,
  volatilityCircuitBreakerPct: 10,
  minLiquidationBufferPct: 15,
};

// Monitoring state
export interface MonitoredPosition {
  id: string;
  market: string;
  side: 'long' | 'short';
  entryPrice: number;
  sizeUsd: number;
  leverage: number;
  stopLoss?: number;
  takeProfit?: number;
  trailingStopPct?: number;
  trailingStopPrice?: number; // Current trailing stop price
  createdAt: number;
  lastCheckedAt?: number;
  currentPrice?: number;
  unrealizedPnlPct?: number;
}

export interface RiskAlert {
  id: string;
  type: 'stop_loss' | 'take_profit' | 'trailing_stop' | 'liquidation_warning' | 'drawdown' | 'volatility' | 'leverage';
  severity: 'info' | 'warning' | 'critical';
  positionId?: string;
  market?: string;
  message: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

export interface ChainlinkPriceData {
  price: number;
  decimals: number;
  updatedAt: number;
  roundId: bigint;
}

// In-memory state
let monitoredPositions: Map<string, MonitoredPosition> = new Map();
let riskAlerts: RiskAlert[] = [];
let riskThresholds: RiskThresholds = { ...DEFAULT_RISK_THRESHOLDS };
let priceCache: Map<string, { price: number; timestamp: number }> = new Map();
let isMonitorRunning = false;
let monitorInterval: ReturnType<typeof setInterval> | null = null;

// Alert listeners
type AlertListener = (alert: RiskAlert) => void;
const alertListeners: Set<AlertListener> = new Set();

/**
 * Create Viem client for Sepolia
 */
function getViemClient() {
  if (!ETH_TESTNET_RPC_URL) {
    throw new Error('ETH_TESTNET_RPC_URL not configured');
  }
  return createPublicClient({
    chain: sepolia,
    transport: http(ETH_TESTNET_RPC_URL),
  });
}

/**
 * Get price from Chainlink oracle on Sepolia
 */
export async function getChainlinkPrice(pair: string): Promise<ChainlinkPriceData | null> {
  const feedAddress = CHAINLINK_FEEDS_SEPOLIA[pair];
  if (!feedAddress) {
    console.warn(`[RiskMonitor] No Chainlink feed for ${pair}`);
    return null;
  }

  try {
    const client = getViemClient();

    const [latestRound, decimals] = await Promise.all([
      client.readContract({
        address: feedAddress,
        abi: AGGREGATOR_V3_ABI,
        functionName: 'latestRoundData',
      }),
      client.readContract({
        address: feedAddress,
        abi: AGGREGATOR_V3_ABI,
        functionName: 'decimals',
      }),
    ]);

    const [roundId, answer, , updatedAt] = latestRound;
    const price = Number(answer) / Math.pow(10, Number(decimals));

    return {
      price,
      decimals: Number(decimals),
      updatedAt: Number(updatedAt),
      roundId: roundId,
    };
  } catch (error) {
    console.error(`[RiskMonitor] Chainlink fetch error for ${pair}:`, error);
    return null;
  }
}

/**
 * Get current price for a market (Chainlink with fallback to CoinGecko/Pyth)
 */
export async function getCurrentPrice(market: string): Promise<number | null> {
  const baseSymbol = market.split('-')[0].toUpperCase();
  const pair = `${baseSymbol}/USD`;

  // Check cache first (15 second TTL)
  const cached = priceCache.get(pair);
  if (cached && Date.now() - cached.timestamp < 15000) {
    return cached.price;
  }

  // Try Chainlink first
  const chainlinkData = await getChainlinkPrice(pair);
  if (chainlinkData) {
    priceCache.set(pair, { price: chainlinkData.price, timestamp: Date.now() });
    return chainlinkData.price;
  }

  // Fallback to CoinGecko/Pyth via existing price service
  try {
    const priceSymbol = baseSymbol as PriceSymbol;
    const snapshot = await getPrice(priceSymbol);
    if (snapshot.priceUsd > 0) {
      priceCache.set(pair, { price: snapshot.priceUsd, timestamp: Date.now() });
      return snapshot.priceUsd;
    }
  } catch (error) {
    console.warn(`[RiskMonitor] Price fetch fallback failed for ${market}:`, error);
  }

  return null;
}

/**
 * Register a position for monitoring
 */
export function registerPosition(position: MonitoredPosition): void {
  monitoredPositions.set(position.id, {
    ...position,
    createdAt: position.createdAt || Date.now(),
  });
  console.log(`[RiskMonitor] Registered position ${position.id} for monitoring: ${position.market} ${position.side}`);
}

/**
 * Unregister a position from monitoring
 */
export function unregisterPosition(positionId: string): void {
  monitoredPositions.delete(positionId);
  console.log(`[RiskMonitor] Unregistered position ${positionId}`);
}

/**
 * Update position stop-loss/take-profit
 */
export function updatePositionLimits(
  positionId: string,
  updates: { stopLoss?: number; takeProfit?: number; trailingStopPct?: number }
): void {
  const position = monitoredPositions.get(positionId);
  if (position) {
    Object.assign(position, updates);
    console.log(`[RiskMonitor] Updated limits for position ${positionId}:`, updates);
  }
}

/**
 * Emit a risk alert
 */
function emitAlert(alert: Omit<RiskAlert, 'id' | 'timestamp'>): void {
  const fullAlert: RiskAlert = {
    ...alert,
    id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: Date.now(),
  };

  riskAlerts.push(fullAlert);

  // Keep only last 100 alerts
  if (riskAlerts.length > 100) {
    riskAlerts = riskAlerts.slice(-100);
  }

  // Notify listeners
  for (const listener of alertListeners) {
    try {
      listener(fullAlert);
    } catch (error) {
      console.error('[RiskMonitor] Alert listener error:', error);
    }
  }

  // Log to console based on severity
  const logFn = alert.severity === 'critical' ? console.error :
                alert.severity === 'warning' ? console.warn :
                console.log;
  logFn(`[RiskMonitor] ${alert.severity.toUpperCase()}: ${alert.message}`);
}

/**
 * Calculate PnL percentage for a position
 */
function calculatePnlPct(position: MonitoredPosition, currentPrice: number): number {
  const { entryPrice, side } = position;

  if (side === 'long') {
    return ((currentPrice - entryPrice) / entryPrice) * 100;
  } else {
    return ((entryPrice - currentPrice) / entryPrice) * 100;
  }
}

/**
 * Check a single position for risk conditions
 */
async function checkPosition(position: MonitoredPosition): Promise<void> {
  const currentPrice = await getCurrentPrice(position.market);
  if (!currentPrice) {
    console.warn(`[RiskMonitor] Could not get price for ${position.market}`);
    return;
  }

  const pnlPct = calculatePnlPct(position, currentPrice);

  // Update position with current data
  position.lastCheckedAt = Date.now();
  position.currentPrice = currentPrice;
  position.unrealizedPnlPct = pnlPct;

  // Check stop-loss
  if (position.stopLoss) {
    const slTriggered = position.side === 'long'
      ? currentPrice <= position.stopLoss
      : currentPrice >= position.stopLoss;

    if (slTriggered) {
      emitAlert({
        type: 'stop_loss',
        severity: 'critical',
        positionId: position.id,
        market: position.market,
        message: `Stop-loss triggered for ${position.market} ${position.side} at $${currentPrice.toFixed(2)} (SL: $${position.stopLoss.toFixed(2)})`,
        data: { currentPrice, stopLoss: position.stopLoss, pnlPct },
      });
    }
  }

  // Check take-profit
  if (position.takeProfit) {
    const tpTriggered = position.side === 'long'
      ? currentPrice >= position.takeProfit
      : currentPrice <= position.takeProfit;

    if (tpTriggered) {
      emitAlert({
        type: 'take_profit',
        severity: 'info',
        positionId: position.id,
        market: position.market,
        message: `Take-profit triggered for ${position.market} ${position.side} at $${currentPrice.toFixed(2)} (TP: $${position.takeProfit.toFixed(2)})`,
        data: { currentPrice, takeProfit: position.takeProfit, pnlPct },
      });
    }
  }

  // Check and update trailing stop
  if (position.trailingStopPct && position.trailingStopPct > 0) {
    if (position.side === 'long') {
      // For long: trail below highest price
      const newTrailingStop = currentPrice * (1 - position.trailingStopPct / 100);
      if (!position.trailingStopPrice || newTrailingStop > position.trailingStopPrice) {
        position.trailingStopPrice = newTrailingStop;
        console.log(`[RiskMonitor] Trailing stop updated for ${position.id}: $${newTrailingStop.toFixed(2)}`);
      }

      if (position.trailingStopPrice && currentPrice <= position.trailingStopPrice) {
        emitAlert({
          type: 'trailing_stop',
          severity: 'critical',
          positionId: position.id,
          market: position.market,
          message: `Trailing stop triggered for ${position.market} long at $${currentPrice.toFixed(2)} (Trailing: $${position.trailingStopPrice.toFixed(2)})`,
          data: { currentPrice, trailingStop: position.trailingStopPrice, pnlPct },
        });
      }
    } else {
      // For short: trail above lowest price
      const newTrailingStop = currentPrice * (1 + position.trailingStopPct / 100);
      if (!position.trailingStopPrice || newTrailingStop < position.trailingStopPrice) {
        position.trailingStopPrice = newTrailingStop;
        console.log(`[RiskMonitor] Trailing stop updated for ${position.id}: $${newTrailingStop.toFixed(2)}`);
      }

      if (position.trailingStopPrice && currentPrice >= position.trailingStopPrice) {
        emitAlert({
          type: 'trailing_stop',
          severity: 'critical',
          positionId: position.id,
          market: position.market,
          message: `Trailing stop triggered for ${position.market} short at $${currentPrice.toFixed(2)} (Trailing: $${position.trailingStopPrice.toFixed(2)})`,
          data: { currentPrice, trailingStop: position.trailingStopPrice, pnlPct },
        });
      }
    }
  }

  // Check leverage limits
  if (position.leverage > riskThresholds.maxLeverage) {
    emitAlert({
      type: 'leverage',
      severity: 'warning',
      positionId: position.id,
      market: position.market,
      message: `Position ${position.market} exceeds max leverage (${position.leverage}x > ${riskThresholds.maxLeverage}x limit)`,
      data: { leverage: position.leverage, maxLeverage: riskThresholds.maxLeverage },
    });
  }

  // Check liquidation buffer (simplified - assumes 100% margin requirement at entry)
  const marginUsedPct = 100 - (100 / position.leverage) * (1 + pnlPct / 100);
  if (marginUsedPct > (100 - riskThresholds.minLiquidationBufferPct)) {
    emitAlert({
      type: 'liquidation_warning',
      severity: 'critical',
      positionId: position.id,
      market: position.market,
      message: `Low liquidation buffer for ${position.market} ${position.side}: ${(100 - marginUsedPct).toFixed(1)}% remaining`,
      data: { marginUsedPct, buffer: 100 - marginUsedPct, minBuffer: riskThresholds.minLiquidationBufferPct },
    });
  }
}

/**
 * Run a single monitoring cycle
 */
async function runMonitorCycle(): Promise<void> {
  const positions = Array.from(monitoredPositions.values());

  if (positions.length === 0) {
    return; // Nothing to monitor
  }

  console.log(`[RiskMonitor] Checking ${positions.length} positions...`);

  for (const position of positions) {
    try {
      await checkPosition(position);
    } catch (error) {
      console.error(`[RiskMonitor] Error checking position ${position.id}:`, error);
    }
  }
}

/**
 * Start the risk monitoring loop
 */
export function startMonitor(intervalMs: number = 15000): void {
  if (isMonitorRunning) {
    console.log('[RiskMonitor] Monitor already running');
    return;
  }

  console.log(`[RiskMonitor] Starting risk monitor with ${intervalMs}ms interval`);
  isMonitorRunning = true;

  // Run immediately, then on interval
  runMonitorCycle();
  monitorInterval = setInterval(runMonitorCycle, intervalMs);
}

/**
 * Stop the risk monitoring loop
 */
export function stopMonitor(): void {
  if (!isMonitorRunning) {
    return;
  }

  console.log('[RiskMonitor] Stopping risk monitor');
  isMonitorRunning = false;

  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}

/**
 * Subscribe to risk alerts
 */
export function subscribeToAlerts(listener: AlertListener): () => void {
  alertListeners.add(listener);
  return () => alertListeners.delete(listener);
}

/**
 * Get all monitored positions
 */
export function getMonitoredPositions(): MonitoredPosition[] {
  return Array.from(monitoredPositions.values());
}

/**
 * Get recent risk alerts
 */
export function getRiskAlerts(limit: number = 50): RiskAlert[] {
  return riskAlerts.slice(-limit);
}

/**
 * Update risk thresholds
 */
export function updateRiskThresholds(updates: Partial<RiskThresholds>): void {
  riskThresholds = { ...riskThresholds, ...updates };
  console.log('[RiskMonitor] Risk thresholds updated:', riskThresholds);
}

/**
 * Get current risk thresholds
 */
export function getRiskThresholds(): RiskThresholds {
  return { ...riskThresholds };
}

/**
 * Check if monitor is running
 */
export function isMonitorActive(): boolean {
  return isMonitorRunning;
}

/**
 * Clear all monitoring state (for testing)
 */
export function clearMonitorState(): void {
  monitoredPositions.clear();
  riskAlerts = [];
  priceCache.clear();
}
