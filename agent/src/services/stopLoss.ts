/**
 * Stop-Loss Management Service
 * Automated stop-loss and take-profit order management
 *
 * Features:
 * - Stop-loss order creation and management
 * - Take-profit order creation and management
 * - Trailing stop functionality
 * - Order expiration handling
 * - Integration with position monitoring
 */

import { v4 as uuidv4 } from 'uuid';
import { getCurrentPrice, registerPosition, updatePositionLimits, type MonitoredPosition } from './riskMonitor';

// Order types
export type StopOrderType = 'stop_loss' | 'take_profit' | 'trailing_stop';
export type StopOrderStatus = 'pending' | 'triggered' | 'cancelled' | 'expired';

export interface StopOrder {
  id: string;
  positionId: string;
  market: string;
  side: 'long' | 'short';
  orderType: StopOrderType;
  triggerPrice: number;
  trailingPct?: number; // For trailing stops
  currentTrailingPrice?: number; // Current trailing stop price
  sizeUsd: number;
  status: StopOrderStatus;
  createdAt: number;
  triggeredAt?: number;
  expiresAt?: number;
  closeSizePct?: number; // Percentage of position to close (default 100%)
}

export interface CreateStopOrderParams {
  positionId: string;
  market: string;
  side: 'long' | 'short';
  orderType: StopOrderType;
  triggerPrice?: number; // Not required for trailing stops
  trailingPct?: number; // Required for trailing stops
  sizeUsd: number;
  expiresInMs?: number; // Optional expiration
  closeSizePct?: number; // Percentage of position to close
}

export interface TrailingStopConfig {
  trailingPct: number;       // e.g., 3 for 3%
  activationPnlPct?: number; // Only start trailing after X% profit
  stepPct?: number;          // Minimum price move to update (default 0.1%)
}

// In-memory order book
let stopOrders: Map<string, StopOrder> = new Map();
let ordersByPosition: Map<string, Set<string>> = new Map();

// Callbacks for order execution
type OrderTriggeredCallback = (order: StopOrder, currentPrice: number) => Promise<void>;
let onOrderTriggered: OrderTriggeredCallback | null = null;

/**
 * Set the callback for when an order is triggered
 */
export function setOrderTriggeredCallback(callback: OrderTriggeredCallback): void {
  onOrderTriggered = callback;
}

/**
 * Create a stop-loss order
 */
export async function createStopLoss(params: {
  positionId: string;
  market: string;
  side: 'long' | 'short';
  triggerPrice: number;
  sizeUsd: number;
  expiresInMs?: number;
  closeSizePct?: number;
}): Promise<StopOrder> {
  return createStopOrder({
    ...params,
    orderType: 'stop_loss',
  });
}

/**
 * Create a take-profit order
 */
export async function createTakeProfit(params: {
  positionId: string;
  market: string;
  side: 'long' | 'short';
  triggerPrice: number;
  sizeUsd: number;
  expiresInMs?: number;
  closeSizePct?: number;
}): Promise<StopOrder> {
  return createStopOrder({
    ...params,
    orderType: 'take_profit',
  });
}

/**
 * Create a trailing stop order
 */
export async function createTrailingStop(params: {
  positionId: string;
  market: string;
  side: 'long' | 'short';
  trailingPct: number;
  sizeUsd: number;
  expiresInMs?: number;
  closeSizePct?: number;
}): Promise<StopOrder> {
  // Get current price to initialize trailing stop
  const currentPrice = await getCurrentPrice(params.market);
  if (!currentPrice) {
    throw new Error(`Cannot get current price for ${params.market}`);
  }

  // Calculate initial trailing stop price
  let initialTrailingPrice: number;
  if (params.side === 'long') {
    // Trail below current price for long positions
    initialTrailingPrice = currentPrice * (1 - params.trailingPct / 100);
  } else {
    // Trail above current price for short positions
    initialTrailingPrice = currentPrice * (1 + params.trailingPct / 100);
  }

  const order = await createStopOrder({
    ...params,
    orderType: 'trailing_stop',
    triggerPrice: initialTrailingPrice,
  });

  // Set trailing config
  order.trailingPct = params.trailingPct;
  order.currentTrailingPrice = initialTrailingPrice;

  return order;
}

/**
 * Create a generic stop order
 */
async function createStopOrder(params: CreateStopOrderParams): Promise<StopOrder> {
  // Validate trigger price for non-trailing stop orders
  if (params.orderType !== 'trailing_stop' && (!params.triggerPrice || params.triggerPrice <= 0)) {
    throw new Error(`Invalid trigger price for ${params.orderType}: ${params.triggerPrice}`);
  }

  // Validate trailing percentage for trailing stops
  if (params.orderType === 'trailing_stop') {
    if (!params.trailingPct || params.trailingPct <= 0 || params.trailingPct > 50) {
      throw new Error(`Invalid trailing percentage: ${params.trailingPct}. Must be between 0 and 50.`);
    }
  }

  // Validate size
  if (!params.sizeUsd || params.sizeUsd <= 0) {
    throw new Error(`Invalid size: ${params.sizeUsd}`);
  }

  const order: StopOrder = {
    id: uuidv4(),
    positionId: params.positionId,
    market: params.market,
    side: params.side,
    orderType: params.orderType,
    triggerPrice: params.triggerPrice || 0,
    trailingPct: params.trailingPct,
    sizeUsd: params.sizeUsd,
    status: 'pending',
    createdAt: Date.now(),
    expiresAt: params.expiresInMs ? Date.now() + params.expiresInMs : undefined,
    closeSizePct: params.closeSizePct || 100,
  };

  // Store order
  stopOrders.set(order.id, order);

  // Index by position
  if (!ordersByPosition.has(params.positionId)) {
    ordersByPosition.set(params.positionId, new Set());
  }
  ordersByPosition.get(params.positionId)!.add(order.id);

  // Update risk monitor with new limits
  if (params.orderType === 'stop_loss') {
    updatePositionLimits(params.positionId, { stopLoss: params.triggerPrice });
  } else if (params.orderType === 'take_profit') {
    updatePositionLimits(params.positionId, { takeProfit: params.triggerPrice });
  } else if (params.orderType === 'trailing_stop' && params.trailingPct) {
    updatePositionLimits(params.positionId, { trailingStopPct: params.trailingPct });
  }

  console.log(`[StopLoss] Created ${order.orderType} order ${order.id} for position ${params.positionId}: ${params.market} at $${order.triggerPrice.toFixed(2)}`);

  return order;
}

/**
 * Cancel a stop order
 */
export function cancelOrder(orderId: string): boolean {
  const order = stopOrders.get(orderId);
  if (!order || order.status !== 'pending') {
    return false;
  }

  order.status = 'cancelled';
  console.log(`[StopLoss] Cancelled order ${orderId}`);

  // Clear from position limits
  if (order.orderType === 'stop_loss') {
    updatePositionLimits(order.positionId, { stopLoss: undefined });
  } else if (order.orderType === 'take_profit') {
    updatePositionLimits(order.positionId, { takeProfit: undefined });
  } else if (order.orderType === 'trailing_stop') {
    updatePositionLimits(order.positionId, { trailingStopPct: undefined });
  }

  return true;
}

/**
 * Cancel all orders for a position
 */
export function cancelPositionOrders(positionId: string): number {
  const orderIds = ordersByPosition.get(positionId);
  if (!orderIds) {
    return 0;
  }

  let cancelled = 0;
  for (const orderId of orderIds) {
    if (cancelOrder(orderId)) {
      cancelled++;
    }
  }

  return cancelled;
}

/**
 * Get order by ID
 */
export function getOrder(orderId: string): StopOrder | undefined {
  return stopOrders.get(orderId);
}

/**
 * Get all orders for a position
 */
export function getPositionOrders(positionId: string): StopOrder[] {
  const orderIds = ordersByPosition.get(positionId);
  if (!orderIds) {
    return [];
  }

  return Array.from(orderIds)
    .map(id => stopOrders.get(id))
    .filter((order): order is StopOrder => order !== undefined);
}

/**
 * Get all pending orders
 */
export function getPendingOrders(): StopOrder[] {
  return Array.from(stopOrders.values()).filter(order => order.status === 'pending');
}

/**
 * Check and trigger orders based on current prices
 * Should be called periodically or on price updates
 */
export async function checkOrders(): Promise<StopOrder[]> {
  const pendingOrders = getPendingOrders();
  const triggeredOrders: StopOrder[] = [];

  for (const order of pendingOrders) {
    try {
      // Check expiration
      if (order.expiresAt && Date.now() > order.expiresAt) {
        order.status = 'expired';
        console.log(`[StopLoss] Order ${order.id} expired`);
        continue;
      }

      // Get current price
      const currentPrice = await getCurrentPrice(order.market);
      if (!currentPrice) {
        continue;
      }

      // Update trailing stop if needed
      if (order.orderType === 'trailing_stop' && order.trailingPct) {
        if (order.side === 'long') {
          // Trail below the highest price for long
          const newTrailingPrice = currentPrice * (1 - order.trailingPct / 100);
          if (!order.currentTrailingPrice || newTrailingPrice > order.currentTrailingPrice) {
            order.currentTrailingPrice = newTrailingPrice;
            order.triggerPrice = newTrailingPrice;
            console.log(`[StopLoss] Trailing stop updated for ${order.id}: $${newTrailingPrice.toFixed(2)}`);
          }
        } else {
          // Trail above the lowest price for short
          const newTrailingPrice = currentPrice * (1 + order.trailingPct / 100);
          if (!order.currentTrailingPrice || newTrailingPrice < order.currentTrailingPrice) {
            order.currentTrailingPrice = newTrailingPrice;
            order.triggerPrice = newTrailingPrice;
            console.log(`[StopLoss] Trailing stop updated for ${order.id}: $${newTrailingPrice.toFixed(2)}`);
          }
        }
      }

      // Check if order should trigger
      let shouldTrigger = false;

      if (order.orderType === 'stop_loss' || order.orderType === 'trailing_stop') {
        // Stop-loss/trailing triggers when price moves against position
        if (order.side === 'long') {
          shouldTrigger = currentPrice <= order.triggerPrice;
        } else {
          shouldTrigger = currentPrice >= order.triggerPrice;
        }
      } else if (order.orderType === 'take_profit') {
        // Take-profit triggers when price moves in favor
        if (order.side === 'long') {
          shouldTrigger = currentPrice >= order.triggerPrice;
        } else {
          shouldTrigger = currentPrice <= order.triggerPrice;
        }
      }

      if (shouldTrigger) {
        order.status = 'triggered';
        order.triggeredAt = Date.now();
        triggeredOrders.push(order);

        console.log(`[StopLoss] Order ${order.id} triggered at $${currentPrice.toFixed(2)}`);

        // Execute callback if set
        if (onOrderTriggered) {
          try {
            await onOrderTriggered(order, currentPrice);
          } catch (error) {
            console.error(`[StopLoss] Order execution callback error:`, error);
          }
        }
      }
    } catch (error) {
      console.error(`[StopLoss] Error checking order ${order.id}:`, error);
    }
  }

  return triggeredOrders;
}

/**
 * Create a bracket order (stop-loss + take-profit)
 */
export async function createBracketOrder(params: {
  positionId: string;
  market: string;
  side: 'long' | 'short';
  entryPrice: number;
  sizeUsd: number;
  stopLossPct: number;
  takeProfitPct: number;
}): Promise<{ stopLoss: StopOrder; takeProfit: StopOrder }> {
  const { positionId, market, side, entryPrice, sizeUsd, stopLossPct, takeProfitPct } = params;

  // Calculate trigger prices
  let slPrice: number;
  let tpPrice: number;

  if (side === 'long') {
    slPrice = entryPrice * (1 - stopLossPct / 100);
    tpPrice = entryPrice * (1 + takeProfitPct / 100);
  } else {
    slPrice = entryPrice * (1 + stopLossPct / 100);
    tpPrice = entryPrice * (1 - takeProfitPct / 100);
  }

  const [stopLoss, takeProfit] = await Promise.all([
    createStopLoss({
      positionId,
      market,
      side,
      triggerPrice: slPrice,
      sizeUsd,
    }),
    createTakeProfit({
      positionId,
      market,
      side,
      triggerPrice: tpPrice,
      sizeUsd,
    }),
  ]);

  console.log(`[StopLoss] Created bracket order for ${market} ${side}: SL=$${slPrice.toFixed(2)}, TP=$${tpPrice.toFixed(2)}`);

  return { stopLoss, takeProfit };
}

/**
 * Modify an existing order
 */
export function modifyOrder(orderId: string, updates: {
  triggerPrice?: number;
  trailingPct?: number;
  closeSizePct?: number;
}): StopOrder | null {
  const order = stopOrders.get(orderId);
  if (!order || order.status !== 'pending') {
    return null;
  }

  if (updates.triggerPrice !== undefined) {
    order.triggerPrice = updates.triggerPrice;
    order.currentTrailingPrice = updates.triggerPrice;
  }

  if (updates.trailingPct !== undefined) {
    order.trailingPct = updates.trailingPct;
  }

  if (updates.closeSizePct !== undefined) {
    order.closeSizePct = updates.closeSizePct;
  }

  console.log(`[StopLoss] Modified order ${orderId}:`, updates);

  return order;
}

/**
 * Get order statistics
 */
export function getOrderStats(): {
  pending: number;
  triggered: number;
  cancelled: number;
  expired: number;
  byType: Record<StopOrderType, number>;
} {
  const orders = Array.from(stopOrders.values());

  const stats = {
    pending: 0,
    triggered: 0,
    cancelled: 0,
    expired: 0,
    byType: {
      stop_loss: 0,
      take_profit: 0,
      trailing_stop: 0,
    } as Record<StopOrderType, number>,
  };

  for (const order of orders) {
    if (order.status === 'pending') stats.pending++;
    if (order.status === 'triggered') stats.triggered++;
    if (order.status === 'cancelled') stats.cancelled++;
    if (order.status === 'expired') stats.expired++;
    stats.byType[order.orderType]++;
  }

  return stats;
}

/**
 * Clear all orders (for testing)
 */
export function clearOrders(): void {
  stopOrders.clear();
  ordersByPosition.clear();
}

/**
 * Auto-create stop-loss and take-profit for a new position
 * Uses default percentages based on position side
 */
export async function autoCreateStopOrders(position: {
  id: string;
  market: string;
  side: 'long' | 'short';
  entryPrice: number;
  sizeUsd: number;
  leverage?: number;
}, config?: {
  stopLossPct?: number;
  takeProfitPct?: number;
  useTrailingStop?: boolean;
  trailingPct?: number;
}): Promise<{ stopLoss?: StopOrder; takeProfit?: StopOrder; trailingStop?: StopOrder }> {
  const {
    stopLossPct = 3,
    takeProfitPct = 4,
    useTrailingStop = false,
    trailingPct = 2,
  } = config || {};

  const result: { stopLoss?: StopOrder; takeProfit?: StopOrder; trailingStop?: StopOrder } = {};

  // Calculate stop-loss price based on leverage-adjusted risk
  // Higher leverage = tighter stop-loss to protect margin
  const leverage = position.leverage || 1;
  const adjustedSlPct = Math.min(stopLossPct, 50 / leverage); // Max loss before liquidation

  let slPrice: number;
  let tpPrice: number;

  if (position.side === 'long') {
    slPrice = position.entryPrice * (1 - adjustedSlPct / 100);
    tpPrice = position.entryPrice * (1 + takeProfitPct / 100);
  } else {
    slPrice = position.entryPrice * (1 + adjustedSlPct / 100);
    tpPrice = position.entryPrice * (1 - takeProfitPct / 100);
  }

  // Create stop-loss
  result.stopLoss = await createStopLoss({
    positionId: position.id,
    market: position.market,
    side: position.side,
    triggerPrice: slPrice,
    sizeUsd: position.sizeUsd,
  });

  // Create take-profit
  result.takeProfit = await createTakeProfit({
    positionId: position.id,
    market: position.market,
    side: position.side,
    triggerPrice: tpPrice,
    sizeUsd: position.sizeUsd,
  });

  // Optionally create trailing stop
  if (useTrailingStop) {
    result.trailingStop = await createTrailingStop({
      positionId: position.id,
      market: position.market,
      side: position.side,
      trailingPct,
      sizeUsd: position.sizeUsd,
    });
  }

  // Register position with risk monitor
  registerPosition({
    id: position.id,
    market: position.market,
    side: position.side,
    entryPrice: position.entryPrice,
    sizeUsd: position.sizeUsd,
    leverage: leverage,
    stopLoss: slPrice,
    takeProfit: tpPrice,
    trailingStopPct: useTrailingStop ? trailingPct : undefined,
    createdAt: Date.now(),
  });

  console.log(`[StopLoss] Auto-created stop orders for ${position.market} ${position.side}: SL=$${slPrice.toFixed(2)}, TP=$${tpPrice.toFixed(2)}`);

  return result;
}
