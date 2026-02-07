/**
 * ERC-8004 React Hooks
 *
 * Provides React hooks for fetching and managing ERC-8004 agent data:
 * - Identity (agent ID, registration status)
 * - Reputation (score, volume, execution count)
 * - Capabilities (supported actions, limits)
 */

import { useState, useEffect, useCallback } from 'react';
import { AGENT_API_BASE_URL } from '../lib/apiClient';

// ============================================
// Types
// ============================================

export interface AgentIdentity {
  enabled: boolean;
  registered: boolean;
  agentId?: string;
  fullyQualifiedId?: string;
  chainId?: number;
  registryAddress?: string;
  agentURI?: string;
}

export interface AgentReputation {
  agentId: string;
  score: number;
  tier: 'excellent' | 'good' | 'fair' | 'neutral' | 'poor' | 'very_poor';
  formattedScore: string;
  totalFeedbackCount: number;
  winRate: number;
  executionCount: number;
  totalVolumeUsd: number;
  avgLatencyMs: number;
  byCategory: Record<string, { count: number; avgScore: number }>;
  updatedAt: number;
}

export interface AgentCapability {
  kind: string;
  chains: string[];
  venues: string[];
  maxLeverageSupported?: number;
  assetAllowlist?: string[];
  limits?: {
    maxAmountUsd?: number;
    minAmountUsd?: number;
    dailyVolumeUsd?: number;
  };
}

export interface CapabilitiesResponse {
  enabled: boolean;
  capabilities: AgentCapability[];
  summary: string;
}

// ============================================
// useERC8004Identity
// ============================================

export function useERC8004Identity() {
  const [identity, setIdentity] = useState<AgentIdentity | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchIdentity = useCallback(async () => {
    try {
      const response = await fetch(`${AGENT_API_BASE_URL}/api/erc8004/identity`);

      if (!response.ok) {
        throw new Error(`Failed to fetch identity: ${response.status}`);
      }

      const data = await response.json();
      setIdentity(data);
      setError(null);
    } catch (err: any) {
      console.error('[useERC8004Identity] Error:', err);
      setError(err.message || 'Failed to fetch identity');
      setIdentity(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIdentity();
  }, [fetchIdentity]);

  return {
    identity,
    isLoading,
    error,
    refetch: fetchIdentity,
    isRegistered: identity?.registered ?? false,
    isEnabled: identity?.enabled ?? false,
    agentId: identity?.agentId,
    fullyQualifiedId: identity?.fullyQualifiedId,
  };
}

// ============================================
// useERC8004Reputation
// ============================================

export function useERC8004Reputation(options?: { refreshInterval?: number }) {
  const [reputation, setReputation] = useState<AgentReputation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReputation = useCallback(async () => {
    try {
      const response = await fetch(`${AGENT_API_BASE_URL}/api/erc8004/reputation`);

      if (!response.ok) {
        throw new Error(`Failed to fetch reputation: ${response.status}`);
      }

      const data = await response.json();
      setReputation(data.reputation);
      setError(null);
    } catch (err: any) {
      console.error('[useERC8004Reputation] Error:', err);
      setError(err.message || 'Failed to fetch reputation');
      setReputation(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReputation();

    // Optional auto-refresh
    if (options?.refreshInterval) {
      const interval = setInterval(fetchReputation, options.refreshInterval);
      return () => clearInterval(interval);
    }
  }, [fetchReputation, options?.refreshInterval]);

  return {
    reputation,
    isLoading,
    error,
    refetch: fetchReputation,
    score: reputation?.score ?? 0,
    tier: reputation?.tier ?? 'neutral',
    formattedScore: reputation?.formattedScore ?? 'Unknown',
    executionCount: reputation?.executionCount ?? 0,
    totalVolumeUsd: reputation?.totalVolumeUsd ?? 0,
    winRate: reputation?.winRate ?? 0,
  };
}

// ============================================
// useERC8004Capabilities
// ============================================

export function useERC8004Capabilities() {
  const [capabilities, setCapabilities] = useState<AgentCapability[]>([]);
  const [summary, setSummary] = useState<string>('');
  const [isEnabled, setIsEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCapabilities = useCallback(async () => {
    try {
      const response = await fetch(`${AGENT_API_BASE_URL}/api/erc8004/capabilities`);

      if (!response.ok) {
        throw new Error(`Failed to fetch capabilities: ${response.status}`);
      }

      const data: CapabilitiesResponse = await response.json();
      setCapabilities(data.capabilities);
      setSummary(data.summary);
      setIsEnabled(data.enabled);
      setError(null);
    } catch (err: any) {
      console.error('[useERC8004Capabilities] Error:', err);
      setError(err.message || 'Failed to fetch capabilities');
      setCapabilities([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCapabilities();
  }, [fetchCapabilities]);

  // Helper to check if a specific capability exists
  const hasCapability = useCallback(
    (kind: string, chain?: string): boolean => {
      return capabilities.some((cap) => {
        if (cap.kind !== kind) return false;
        if (chain && !cap.chains.includes(chain)) return false;
        return true;
      });
    },
    [capabilities]
  );

  // Helper to get capability by kind
  const getCapability = useCallback(
    (kind: string, chain?: string): AgentCapability | undefined => {
      return capabilities.find((cap) => {
        if (cap.kind !== kind) return false;
        if (chain && !cap.chains.includes(chain)) return false;
        return true;
      });
    },
    [capabilities]
  );

  return {
    capabilities,
    summary,
    isEnabled,
    isLoading,
    error,
    refetch: fetchCapabilities,
    hasCapability,
    getCapability,
    // Convenience getters
    hasSwap: hasCapability('swap'),
    hasPerp: hasCapability('perp'),
    hasLend: hasCapability('lend'),
    hasEvent: hasCapability('event'),
    hasBridge: hasCapability('bridge'),
  };
}

// ============================================
// Combined Hook
// ============================================

export function useERC8004() {
  const identity = useERC8004Identity();
  const reputation = useERC8004Reputation();
  const capabilities = useERC8004Capabilities();

  return {
    identity,
    reputation,
    capabilities,
    isLoading: identity.isLoading || reputation.isLoading || capabilities.isLoading,
    isEnabled: identity.isEnabled,
    isRegistered: identity.isRegistered,
  };
}
