// @ts-nocheck
/**
 * Security Module Index
 *
 * Exports for security hardening, fuzz testing, and monitoring.
 */

// ============================================
// Intent Fuzz Testing
// ============================================
export {
  FUZZ_TEST_CASES,
  sanitizeIntentInput,
  validateAmount,
  runFuzzTest,
  runFuzzSuite,
  recordPathViolation,
  getPathViolations,
  getViolationSummary,
  type FuzzTestCase,
  type FuzzCategory,
  type FuzzResult,
  type PathViolation,
} from './intentFuzzTester.js';

// ============================================
// Non-Custodial Guards
// ============================================
export {
  canBackendSign,
  validateBridgeNonCustodial,
  getBridgeSigningFlow,
  validateSessionCreation,
  logSigningDecision,
  getSigningAudit,
  getSigningAuditSummary,
  assertNoPrivateKeysInRequest,
  assertWalletMatchesSession,
  type SigningContext,
  type SigningOperation,
  type GuardResult,
  type SigningStep,
  type SigningAuditEntry,
} from './nonCustodialGuards.js';

// ============================================
// Monitoring and Alerts
// ============================================
export {
  createAlert,
  acknowledgeAlert,
  getAlerts,
  alertPathViolation,
  alertDelegationFailed,
  alertSpendLimitExceeded,
  alertInjectionAttempt,
  alertSessionAbuse,
  alertBridgeStuck,
  alertSigningAnomaly,
  onCriticalAlert,
  getAlertMetrics,
  getSecurityHealth,
  checkAlertRateLimit,
  cleanupOldAlerts,
  type AlertSeverity,
  type AlertCategory,
  type SecurityAlert,
  type AlertMetrics,
} from './monitoringAlerts.js';
