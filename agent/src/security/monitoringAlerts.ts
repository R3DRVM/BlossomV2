// @ts-nocheck
/**
 * Security Monitoring and Alerts
 *
 * Real-time monitoring for security events with alerting.
 *
 * Security Amendment: Monitoring alerts for path violations,
 * failed delegations, and suspicious activity.
 */

// ============================================
// Alert Types
// ============================================

export type AlertSeverity = 'info' | 'warning' | 'critical' | 'emergency';

export type AlertCategory =
  | 'path_violation'
  | 'delegation_failed'
  | 'spend_limit_exceeded'
  | 'injection_attempt'
  | 'session_abuse'
  | 'rate_limit'
  | 'signing_anomaly'
  | 'bridge_stuck'
  | 'system_error';

export interface SecurityAlert {
  id: string;
  timestamp: number;
  category: AlertCategory;
  severity: AlertSeverity;
  message: string;
  details: Record<string, unknown>;
  sessionId?: string;
  walletAddress?: string;
  acknowledged: boolean;
  acknowledgedAt?: number;
  acknowledgedBy?: string;
}

// ============================================
// Alert Store
// ============================================

const alerts: SecurityAlert[] = [];
const MAX_ALERTS = 5000;
let alertCounter = 0;

/**
 * Create a new security alert
 */
export function createAlert(params: {
  category: AlertCategory;
  severity: AlertSeverity;
  message: string;
  details?: Record<string, unknown>;
  sessionId?: string;
  walletAddress?: string;
}): SecurityAlert {
  const alert: SecurityAlert = {
    id: `alert-${++alertCounter}-${Date.now()}`,
    timestamp: Date.now(),
    category: params.category,
    severity: params.severity,
    message: params.message,
    details: params.details || {},
    sessionId: params.sessionId,
    walletAddress: params.walletAddress,
    acknowledged: false,
  };

  alerts.push(alert);

  // Trim old alerts
  if (alerts.length > MAX_ALERTS) {
    // Keep unacknowledged critical/emergency alerts
    const toRemove = alerts.findIndex(
      a => a.acknowledged || !['critical', 'emergency'].includes(a.severity)
    );
    if (toRemove >= 0) {
      alerts.splice(toRemove, 1);
    } else {
      alerts.shift();
    }
  }

  // Trigger immediate notification for critical/emergency
  if (params.severity === 'critical' || params.severity === 'emergency') {
    triggerImmediateNotification(alert);
  }

  // Log for console monitoring
  const logFn = params.severity === 'emergency' ? console.error
    : params.severity === 'critical' ? console.error
    : params.severity === 'warning' ? console.warn
    : console.log;

  logFn(`[ALERT:${params.severity.toUpperCase()}] ${params.category}: ${params.message}`, params.details);

  return alert;
}

/**
 * Acknowledge an alert
 */
export function acknowledgeAlert(alertId: string, acknowledgedBy?: string): boolean {
  const alert = alerts.find(a => a.id === alertId);
  if (!alert) return false;

  alert.acknowledged = true;
  alert.acknowledgedAt = Date.now();
  alert.acknowledgedBy = acknowledgedBy;

  return true;
}

/**
 * Get alerts with filtering
 */
export function getAlerts(params?: {
  category?: AlertCategory;
  severity?: AlertSeverity;
  unacknowledgedOnly?: boolean;
  since?: number;
  limit?: number;
}): SecurityAlert[] {
  let result = [...alerts];

  if (params?.category) {
    result = result.filter(a => a.category === params.category);
  }

  if (params?.severity) {
    result = result.filter(a => a.severity === params.severity);
  }

  if (params?.unacknowledgedOnly) {
    result = result.filter(a => !a.acknowledged);
  }

  if (params?.since) {
    result = result.filter(a => a.timestamp >= params.since);
  }

  result.sort((a, b) => b.timestamp - a.timestamp);

  if (params?.limit) {
    result = result.slice(0, params.limit);
  }

  return result;
}

// ============================================
// Alert Helpers for Specific Events
// ============================================

/**
 * Alert: Path violation detected
 */
export function alertPathViolation(params: {
  sessionId: string;
  currentPath: string;
  attemptedPath: string;
  input: string;
  blocked: boolean;
}): SecurityAlert {
  return createAlert({
    category: 'path_violation',
    severity: params.blocked ? 'warning' : 'critical',
    message: `Path violation: ${params.currentPath} → ${params.attemptedPath}`,
    details: {
      currentPath: params.currentPath,
      attemptedPath: params.attemptedPath,
      input: params.input.substring(0, 100),
      blocked: params.blocked,
    },
    sessionId: params.sessionId,
  });
}

/**
 * Alert: Delegation failed
 */
export function alertDelegationFailed(params: {
  parentAgentId: string;
  subAgentId?: string;
  reason: string;
  task?: string;
}): SecurityAlert {
  return createAlert({
    category: 'delegation_failed',
    severity: 'warning',
    message: `Delegation failed: ${params.reason}`,
    details: {
      parentAgentId: params.parentAgentId,
      subAgentId: params.subAgentId,
      reason: params.reason,
      task: params.task?.substring(0, 100),
    },
  });
}

/**
 * Alert: Spend limit exceeded
 */
export function alertSpendLimitExceeded(params: {
  sessionId: string;
  walletAddress: string;
  requestedUsd: number;
  limitUsd: number;
  operation: string;
}): SecurityAlert {
  return createAlert({
    category: 'spend_limit_exceeded',
    severity: 'warning',
    message: `Spend limit exceeded: $${params.requestedUsd} > $${params.limitUsd}`,
    details: {
      requestedUsd: params.requestedUsd,
      limitUsd: params.limitUsd,
      operation: params.operation,
      overage: params.requestedUsd - params.limitUsd,
    },
    sessionId: params.sessionId,
    walletAddress: params.walletAddress,
  });
}

/**
 * Alert: Injection attempt detected
 */
export function alertInjectionAttempt(params: {
  sessionId?: string;
  input: string;
  injectionType: string;
  blocked: boolean;
}): SecurityAlert {
  return createAlert({
    category: 'injection_attempt',
    severity: params.blocked ? 'warning' : 'critical',
    message: `Injection attempt: ${params.injectionType}`,
    details: {
      injectionType: params.injectionType,
      inputPreview: params.input.substring(0, 50) + '...',
      blocked: params.blocked,
    },
    sessionId: params.sessionId,
  });
}

/**
 * Alert: Session abuse pattern
 */
export function alertSessionAbuse(params: {
  sessionId: string;
  walletAddress: string;
  pattern: 'rapid_requests' | 'unusual_hours' | 'geographic_anomaly' | 'capability_escalation';
  details: Record<string, unknown>;
}): SecurityAlert {
  return createAlert({
    category: 'session_abuse',
    severity: 'warning',
    message: `Session abuse pattern: ${params.pattern}`,
    details: {
      pattern: params.pattern,
      ...params.details,
    },
    sessionId: params.sessionId,
    walletAddress: params.walletAddress,
  });
}

/**
 * Alert: Bridge stuck
 */
export function alertBridgeStuck(params: {
  bridgeId: string;
  provider: string;
  sourceChain: string;
  destChain: string;
  stuckAtStage: string;
  stuckMinutes: number;
}): SecurityAlert {
  const severity: AlertSeverity = params.stuckMinutes > 60 ? 'critical' : 'warning';

  return createAlert({
    category: 'bridge_stuck',
    severity,
    message: `Bridge stuck at ${params.stuckAtStage} for ${params.stuckMinutes}m`,
    details: {
      bridgeId: params.bridgeId,
      provider: params.provider,
      sourceChain: params.sourceChain,
      destChain: params.destChain,
      stuckAtStage: params.stuckAtStage,
      stuckMinutes: params.stuckMinutes,
    },
  });
}

/**
 * Alert: Signing anomaly
 */
export function alertSigningAnomaly(params: {
  sessionId?: string;
  walletAddress: string;
  anomalyType: 'wallet_mismatch' | 'unexpected_backend_sign' | 'private_key_leak';
  details: Record<string, unknown>;
}): SecurityAlert {
  return createAlert({
    category: 'signing_anomaly',
    severity: params.anomalyType === 'private_key_leak' ? 'emergency' : 'critical',
    message: `Signing anomaly: ${params.anomalyType}`,
    details: {
      anomalyType: params.anomalyType,
      ...params.details,
    },
    sessionId: params.sessionId,
    walletAddress: params.walletAddress,
  });
}

// ============================================
// Immediate Notification
// ============================================

type NotificationHandler = (alert: SecurityAlert) => void | Promise<void>;
const notificationHandlers: NotificationHandler[] = [];

/**
 * Register a handler for immediate notifications
 */
export function onCriticalAlert(handler: NotificationHandler): () => void {
  notificationHandlers.push(handler);
  return () => {
    const idx = notificationHandlers.indexOf(handler);
    if (idx >= 0) notificationHandlers.splice(idx, 1);
  };
}

/**
 * Trigger immediate notification
 */
async function triggerImmediateNotification(alert: SecurityAlert): Promise<void> {
  for (const handler of notificationHandlers) {
    try {
      await handler(alert);
    } catch (error) {
      console.error('[monitoring] Notification handler error:', error);
    }
  }

  // Log to stderr for external monitoring tools (Datadog, etc.)
  if (alert.severity === 'emergency') {
    process.stderr.write(`[EMERGENCY] ${JSON.stringify(alert)}\n`);
  }
}

// ============================================
// Metrics and Dashboard
// ============================================

export interface AlertMetrics {
  total: number;
  byCategory: Record<AlertCategory, number>;
  bySeverity: Record<AlertSeverity, number>;
  unacknowledged: number;
  last24hCount: number;
  lastHourCount: number;
  criticalUnacked: number;
}

/**
 * Get alert metrics for dashboard
 */
export function getAlertMetrics(): AlertMetrics {
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const dayAgo = now - 24 * 60 * 60 * 1000;

  const byCategory: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};

  for (const alert of alerts) {
    byCategory[alert.category] = (byCategory[alert.category] || 0) + 1;
    bySeverity[alert.severity] = (bySeverity[alert.severity] || 0) + 1;
  }

  return {
    total: alerts.length,
    byCategory: byCategory as Record<AlertCategory, number>,
    bySeverity: bySeverity as Record<AlertSeverity, number>,
    unacknowledged: alerts.filter(a => !a.acknowledged).length,
    last24hCount: alerts.filter(a => a.timestamp >= dayAgo).length,
    lastHourCount: alerts.filter(a => a.timestamp >= hourAgo).length,
    criticalUnacked: alerts.filter(
      a => !a.acknowledged && (a.severity === 'critical' || a.severity === 'emergency')
    ).length,
  };
}

/**
 * Get health status based on alerts
 */
export function getSecurityHealth(): {
  status: 'healthy' | 'degraded' | 'critical';
  issues: string[];
} {
  const metrics = getAlertMetrics();
  const issues: string[] = [];

  // Check for unacknowledged critical alerts
  if (metrics.criticalUnacked > 0) {
    issues.push(`${metrics.criticalUnacked} unacknowledged critical alert(s)`);
  }

  // Check for high alert rate
  if (metrics.lastHourCount > 50) {
    issues.push(`High alert rate: ${metrics.lastHourCount} alerts in last hour`);
  }

  // Check for recurring patterns
  const emergencyCount = metrics.bySeverity['emergency'] || 0;
  if (emergencyCount > 0) {
    issues.push(`${emergencyCount} emergency-level alerts`);
  }

  // Determine status
  let status: 'healthy' | 'degraded' | 'critical' = 'healthy';
  if (emergencyCount > 0 || metrics.criticalUnacked > 5) {
    status = 'critical';
  } else if (metrics.criticalUnacked > 0 || issues.length > 0) {
    status = 'degraded';
  }

  return { status, issues };
}

// ============================================
// Rate Limiting Monitor
// ============================================

interface RateLimitBucket {
  count: number;
  windowStart: number;
}

const rateLimitBuckets = new Map<string, RateLimitBucket>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_THRESHOLDS: Record<string, number> = {
  path_violation: 10,
  injection_attempt: 5,
  spend_limit_exceeded: 20,
  delegation_failed: 15,
};

/**
 * Check if alert type is being spammed
 */
export function checkAlertRateLimit(category: AlertCategory): boolean {
  const now = Date.now();
  const key = category;
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitBuckets.set(key, { count: 1, windowStart: now });
    return false;
  }

  bucket.count++;

  const threshold = RATE_LIMIT_THRESHOLDS[category] || 30;
  if (bucket.count > threshold) {
    // Rate limited - don't create more alerts of this type
    return true;
  }

  return false;
}

// ============================================
// Cleanup
// ============================================

/**
 * Cleanup old acknowledged alerts
 */
export function cleanupOldAlerts(maxAgeDays: number = 7): number {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const before = alerts.length;

  // Remove old acknowledged alerts
  for (let i = alerts.length - 1; i >= 0; i--) {
    const alert = alerts[i];
    if (alert.acknowledged && alert.timestamp < cutoff) {
      alerts.splice(i, 1);
    }
  }

  return before - alerts.length;
}
