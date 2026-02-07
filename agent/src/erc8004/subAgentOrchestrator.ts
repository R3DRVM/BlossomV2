// @ts-nocheck
/**
 * ERC-8004 Sub-Agent Orchestrator
 *
 * Enables sub-agent orchestration via ERC-8004:
 * - Register sub-agents with delegated capabilities
 * - Route tasks to qualified sub-agents
 * - Track delegation status and spend limits
 * - Revoke delegations when needed
 *
 * Phase 5: ERC-8004 Sub-Agent Distribution
 */

import { randomUUID } from 'crypto';
import type {
  SubAgentRegistration,
  DelegationRequest,
  DelegationResult,
  SubAgentStatus,
  SubAgentSelectionCriteria,
  CapabilityKind,
} from './types';
import { ERC8004Error } from './types';

// ============================================
// Configuration
// ============================================

const SUBAGENT_DELEGATION_ENABLED = process.env.SUBAGENT_DELEGATION_ENABLED === 'true';
const SUBAGENT_SPEND_LIMIT_USD = parseFloat(process.env.SUBAGENT_SPEND_LIMIT_USD || '1000');
const SUBAGENT_DEFAULT_TIMEOUT_MS = 60 * 1000; // 1 minute default

// ============================================
// In-Memory Stores
// (Upgrade to DB persistence for production)
// ============================================

const subAgents = new Map<string, SubAgentRegistration>();
const activeDelegations = new Map<string, DelegationResult>();
const subAgentStats = new Map<string, {
  tasksCompleted: number;
  tasksFailed: number;
  totalSpendUsd: number;
  lastActivityAt: number;
}>();

// ============================================
// Sub-Agent Registration
// ============================================

/**
 * Register a new sub-agent with delegated capabilities
 */
export async function registerSubAgent(params: {
  parentAgentId: bigint;
  subAgentId?: bigint;
  capabilities: CapabilityKind[];
  spendLimitUsd?: number;
  expiresInMs?: number;
  specialization?: SubAgentRegistration['specialization'];
}): Promise<SubAgentRegistration> {
  if (!SUBAGENT_DELEGATION_ENABLED) {
    throw new ERC8004Error(
      'Sub-agent delegation is not enabled',
      'DELEGATION_FAILED',
      { reason: 'SUBAGENT_DELEGATION_ENABLED=false' }
    );
  }

  const now = Date.now();
  const id = randomUUID();

  const registration: SubAgentRegistration = {
    id,
    parentAgentId: params.parentAgentId,
    subAgentId: params.subAgentId ?? params.parentAgentId,
    delegatedCapabilities: params.capabilities,
    spendLimitUsd: params.spendLimitUsd ?? SUBAGENT_SPEND_LIMIT_USD,
    expiresAt: params.expiresInMs
      ? now + params.expiresInMs
      : now + 24 * 60 * 60 * 1000, // Default 24 hours
    revoked: false,
    createdAt: now,
    specialization: params.specialization,
  };

  subAgents.set(id, registration);

  // Initialize stats
  subAgentStats.set(id, {
    tasksCompleted: 0,
    tasksFailed: 0,
    totalSpendUsd: 0,
    lastActivityAt: now,
  });

  console.log(`[sub-agent] Registered sub-agent ${id} with capabilities: ${params.capabilities.join(', ')}`);

  return registration;
}

/**
 * Revoke a sub-agent delegation
 */
export async function revokeDelegation(subAgentId: string): Promise<void> {
  const registration = subAgents.get(subAgentId);
  if (!registration) {
    throw new ERC8004Error(
      `Sub-agent ${subAgentId} not found`,
      'SUBAGENT_NOT_FOUND'
    );
  }

  registration.revoked = true;
  subAgents.set(subAgentId, registration);

  console.log(`[sub-agent] Revoked delegation for sub-agent ${subAgentId}`);
}

/**
 * Get sub-agent registration
 */
export function getSubAgentRegistration(subAgentId: string): SubAgentRegistration | null {
  return subAgents.get(subAgentId) || null;
}

/**
 * List all registered sub-agents
 */
export function listSubAgents(params?: {
  parentAgentId?: bigint;
  capability?: CapabilityKind;
  activeOnly?: boolean;
}): SubAgentRegistration[] {
  const now = Date.now();
  let registrations = Array.from(subAgents.values());

  if (params?.parentAgentId) {
    registrations = registrations.filter(r => r.parentAgentId === params.parentAgentId);
  }

  if (params?.capability) {
    registrations = registrations.filter(r =>
      r.delegatedCapabilities.includes(params.capability!)
    );
  }

  if (params?.activeOnly) {
    registrations = registrations.filter(r =>
      !r.revoked && r.expiresAt > now
    );
  }

  return registrations;
}

// ============================================
// Task Delegation
// ============================================

/**
 * Delegate a task to a qualified sub-agent
 */
export async function delegateTask(
  request: DelegationRequest
): Promise<DelegationResult> {
  if (!SUBAGENT_DELEGATION_ENABLED) {
    throw new ERC8004Error(
      'Sub-agent delegation is not enabled',
      'DELEGATION_FAILED'
    );
  }

  // Find qualified sub-agents
  const qualified = findQualifiedSubAgents({
    capabilities: request.requiredCapabilities,
    preferredChain: request.chain,
    preferredVenue: request.venue,
  });

  if (qualified.length === 0) {
    throw new ERC8004Error(
      'No qualified sub-agents available for this task',
      'SUBAGENT_NOT_FOUND',
      { requiredCapabilities: request.requiredCapabilities }
    );
  }

  // Select best sub-agent (by reputation and availability)
  const selected = selectBestSubAgent(qualified, request);
  const selectedReg = subAgents.get(selected.id)!;

  // Check spend limit
  const stats = subAgentStats.get(selected.id);
  const remainingBudget = selectedReg.spendLimitUsd - (stats?.totalSpendUsd || 0);

  if (request.estimatedUsd > remainingBudget) {
    throw new ERC8004Error(
      `Task estimated cost ($${request.estimatedUsd}) exceeds remaining budget ($${remainingBudget})`,
      'SPEND_LIMIT_EXCEEDED',
      { estimatedUsd: request.estimatedUsd, remainingBudget }
    );
  }

  // Create delegation result
  const taskId = randomUUID();
  const result: DelegationResult = {
    delegatedTo: selectedReg.subAgentId,
    taskId,
    status: 'pending',
  };

  activeDelegations.set(taskId, result);

  console.log(`[sub-agent] Delegated task ${taskId} to sub-agent ${selected.id}`);

  return result;
}

/**
 * Find sub-agents matching selection criteria
 */
export function findQualifiedSubAgents(
  criteria: SubAgentSelectionCriteria
): SubAgentRegistration[] {
  const now = Date.now();

  return listSubAgents({ activeOnly: true }).filter(reg => {
    // Check capabilities
    const hasAllCapabilities = criteria.capabilities.every(cap =>
      reg.delegatedCapabilities.includes(cap)
    );
    if (!hasAllCapabilities) return false;

    // Check chain specialization
    if (criteria.preferredChain && reg.specialization?.chain) {
      if (reg.specialization.chain !== criteria.preferredChain) return false;
    }

    // Check venue specialization
    if (criteria.preferredVenue && reg.specialization?.venue) {
      if (reg.specialization.venue !== criteria.preferredVenue) return false;
    }

    // Check reputation
    if (criteria.minReputationScore !== undefined) {
      const status = getSubAgentStatus(reg.id);
      if (status && status.reputationScore < criteria.minReputationScore) return false;
    }

    // Check success rate
    if (criteria.minSuccessRate !== undefined) {
      const status = getSubAgentStatus(reg.id);
      if (status && status.successRate < criteria.minSuccessRate) return false;
    }

    return true;
  });
}

/**
 * Select the best sub-agent from qualified list
 */
function selectBestSubAgent(
  qualified: SubAgentRegistration[],
  request: DelegationRequest
): SubAgentRegistration {
  // Sort by reputation score (derived from stats)
  const scored = qualified.map(reg => {
    const stats = subAgentStats.get(reg.id);
    const totalTasks = (stats?.tasksCompleted || 0) + (stats?.tasksFailed || 0);
    const successRate = totalTasks > 0
      ? (stats?.tasksCompleted || 0) / totalTasks
      : 0.5;

    // Calculate score: success rate + recency bonus
    const recencyBonus = stats?.lastActivityAt
      ? Math.min(0.1, (Date.now() - stats.lastActivityAt) / (24 * 60 * 60 * 1000))
      : 0;

    const score = successRate * 0.8 + recencyBonus * 0.2;

    return { reg, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored[0].reg;
}

/**
 * Validate a delegation against sub-agent capabilities
 */
export async function validateDelegation(
  subAgentId: string,
  request: DelegationRequest
): Promise<{ valid: boolean; errors?: string[] }> {
  const reg = subAgents.get(subAgentId);
  if (!reg) {
    return { valid: false, errors: ['Sub-agent not found'] };
  }

  const errors: string[] = [];

  // Check if revoked
  if (reg.revoked) {
    errors.push('Sub-agent delegation has been revoked');
  }

  // Check expiration
  if (reg.expiresAt < Date.now()) {
    errors.push('Sub-agent delegation has expired');
  }

  // Check capabilities
  const missingCaps = request.requiredCapabilities.filter(
    cap => !reg.delegatedCapabilities.includes(cap)
  );
  if (missingCaps.length > 0) {
    errors.push(`Missing capabilities: ${missingCaps.join(', ')}`);
  }

  // Check spend limit
  const stats = subAgentStats.get(subAgentId);
  const remainingBudget = reg.spendLimitUsd - (stats?.totalSpendUsd || 0);
  if (request.estimatedUsd > remainingBudget) {
    errors.push(`Estimated cost ($${request.estimatedUsd}) exceeds remaining budget ($${remainingBudget})`);
  }

  // Check chain specialization
  if (request.chain && reg.specialization?.chain && reg.specialization.chain !== request.chain) {
    errors.push(`Sub-agent specializes in ${reg.specialization.chain}, not ${request.chain}`);
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  };
}

// ============================================
// Status Tracking
// ============================================

/**
 * Get sub-agent status
 */
export function getSubAgentStatus(subAgentId: string): SubAgentStatus | null {
  const reg = subAgents.get(subAgentId);
  if (!reg) return null;

  const stats = subAgentStats.get(subAgentId);
  const totalTasks = (stats?.tasksCompleted || 0) + (stats?.tasksFailed || 0);
  const successRate = totalTasks > 0
    ? ((stats?.tasksCompleted || 0) / totalTasks) * 100
    : 50;

  // Count active delegations for this sub-agent
  const activeTasks = Array.from(activeDelegations.values()).filter(
    d => d.delegatedTo === reg.subAgentId && d.status === 'in_progress'
  ).length;

  // Calculate reputation score (-100 to +100)
  const baseScore = successRate - 50; // 0-100 -> -50 to +50
  const volumeBonus = Math.min(25, (stats?.totalSpendUsd || 0) / 1000); // Up to +25 for volume
  const reputationScore = Math.round(baseScore + volumeBonus);

  return {
    subAgentId: reg.subAgentId,
    available: !reg.revoked && reg.expiresAt > Date.now(),
    activeTaskCount: activeTasks,
    remainingSpendUsd: reg.spendLimitUsd - (stats?.totalSpendUsd || 0),
    reputationScore: Math.max(-100, Math.min(100, reputationScore)),
    successRate,
    lastActivityAt: stats?.lastActivityAt || reg.createdAt,
  };
}

/**
 * Update delegation result
 */
export function updateDelegationResult(
  taskId: string,
  update: Partial<DelegationResult>
): DelegationResult | null {
  const delegation = activeDelegations.get(taskId);
  if (!delegation) return null;

  Object.assign(delegation, update);
  activeDelegations.set(taskId, delegation);

  // Update stats if completed/failed
  if (update.status === 'completed' || update.status === 'failed') {
    const reg = Array.from(subAgents.values()).find(
      r => r.subAgentId === delegation.delegatedTo
    );
    if (reg) {
      const stats = subAgentStats.get(reg.id) || {
        tasksCompleted: 0,
        tasksFailed: 0,
        totalSpendUsd: 0,
        lastActivityAt: Date.now(),
      };

      if (update.status === 'completed') {
        stats.tasksCompleted++;
      } else {
        stats.tasksFailed++;
      }

      if (update.spentUsd) {
        stats.totalSpendUsd += update.spentUsd;
      }

      stats.lastActivityAt = Date.now();
      subAgentStats.set(reg.id, stats);
    }
  }

  return delegation;
}

/**
 * Get delegation result by task ID
 */
export function getDelegationResult(taskId: string): DelegationResult | null {
  return activeDelegations.get(taskId) || null;
}

// ============================================
// Intent Runner Integration
// ============================================

/**
 * Check if an intent should be delegated to a sub-agent
 */
export function shouldDelegate(
  parsed: any, // ParsedIntent
  route: any   // RouteDecision
): boolean {
  if (!SUBAGENT_DELEGATION_ENABLED) return false;

  // Check if there are qualified sub-agents
  const qualified = findQualifiedSubAgents({
    capabilities: [parsed.kind as CapabilityKind],
    preferredChain: route?.chain,
    preferredVenue: route?.venue,
  });

  return qualified.length > 0;
}

/**
 * Delegate an intent to a sub-agent
 */
export async function delegateToSubAgent(
  parsed: any, // ParsedIntent
  route: any   // RouteDecision
): Promise<DelegationResult | null> {
  if (!shouldDelegate(parsed, route)) {
    return null;
  }

  try {
    const result = await delegateTask({
      task: parsed.rawParams?.original || `${parsed.action} ${parsed.targetAsset || ''}`,
      requiredCapabilities: [parsed.kind as CapabilityKind],
      estimatedUsd: parsed.amount ? parseFloat(parsed.amount) : 100,
      timeout: SUBAGENT_DEFAULT_TIMEOUT_MS,
      chain: route?.chain,
      venue: route?.venue,
      parsedIntent: parsed,
    });

    return result;
  } catch (error: any) {
    console.warn(`[sub-agent] Delegation failed: ${error.message}`);
    return null;
  }
}

// ============================================
// Cleanup
// ============================================

/**
 * Cleanup expired sub-agents and old delegations
 */
export function cleanupSubAgents(): number {
  const now = Date.now();
  let cleaned = 0;

  // Remove expired sub-agents
  for (const [id, reg] of subAgents) {
    if (reg.expiresAt < now) {
      subAgents.delete(id);
      subAgentStats.delete(id);
      cleaned++;
    }
  }

  // Remove old delegations (older than 24 hours)
  const maxAge = 24 * 60 * 60 * 1000;
  for (const [taskId, delegation] of activeDelegations) {
    if (['completed', 'failed'].includes(delegation.status)) {
      activeDelegations.delete(taskId);
      cleaned++;
    }
  }

  return cleaned;
}

// Run cleanup every hour
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const cleaned = cleanupSubAgents();
    if (cleaned > 0) {
      console.log(`[sub-agent] Cleaned up ${cleaned} expired items`);
    }
  }, 60 * 60 * 1000);
}

// ============================================
// Module Status
// ============================================

/**
 * Get orchestrator status
 */
export function getOrchestratorStatus(): {
  enabled: boolean;
  subAgentCount: number;
  activeDelegationCount: number;
  defaultSpendLimitUsd: number;
} {
  return {
    enabled: SUBAGENT_DELEGATION_ENABLED,
    subAgentCount: subAgents.size,
    activeDelegationCount: activeDelegations.size,
    defaultSpendLimitUsd: SUBAGENT_SPEND_LIMIT_USD,
  };
}
