#!/usr/bin/env npx tsx
// @ts-nocheck
/**
 * Spawn Torture Sub-Agents Script
 *
 * Registers 10-20 venue-specific sub-agents for torture testing.
 * Each sub-agent is specialized for a specific venue/chain combination.
 *
 * Usage:
 *   npx tsx agent/scripts/spawn-torture-subagents.ts
 *
 * Prerequisites:
 *   1. SUBAGENT_DELEGATION_ENABLED=true in .env
 *   2. ERC8004_AGENT_ID set (parent agent ID)
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const agentDir = resolve(__dirname, '..');

config({ path: resolve(agentDir, '.env.local') });
config({ path: resolve(agentDir, '.env') });

import {
  registerSubAgent,
  listSubAgents,
  getOrchestratorStatus,
} from '../src/erc8004/subAgentOrchestrator';

import type { CapabilityKind } from '../src/erc8004/types';

// ============================================
// Sub-Agent Definitions
// ============================================

interface SubAgentDef {
  name: string;
  capabilities: CapabilityKind[];
  specialization?: {
    chain?: string;
    venue?: string;
    assetAllowlist?: string[];
  };
  spendLimitUsd: number;
  expiresInMs: number;
}

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SPEND_LIMIT = 1000;

const SUB_AGENT_DEFINITIONS: SubAgentDef[] = [
  // Solana Bridge Sub-Agent
  {
    name: 'SolanaBridgeSub',
    capabilities: ['bridge'],
    specialization: {
      chain: 'solana',
    },
    spendLimitUsd: DEFAULT_SPEND_LIMIT,
    expiresInMs: TWENTY_FOUR_HOURS_MS,
  },
  // Hyperliquid Perp Sub-Agent
  {
    name: 'HyperliquidPerpSub',
    capabilities: ['perp', 'perp_create'],
    specialization: {
      venue: 'hyperliquid',
    },
    spendLimitUsd: DEFAULT_SPEND_LIMIT,
    expiresInMs: TWENTY_FOUR_HOURS_MS,
  },
  // DeFi Deposit Sub-Agent (Aave)
  {
    name: 'DeFiDepositSub',
    capabilities: ['lend'],
    specialization: {
      venue: 'aave',
    },
    spendLimitUsd: DEFAULT_SPEND_LIMIT,
    expiresInMs: TWENTY_FOUR_HOURS_MS,
  },
  // Jupiter Swap Sub-Agent
  {
    name: 'JupiterSwapSub',
    capabilities: ['swap'],
    specialization: {
      chain: 'solana',
      venue: 'jupiter',
    },
    spendLimitUsd: DEFAULT_SPEND_LIMIT,
    expiresInMs: TWENTY_FOUR_HOURS_MS,
  },
  // Uniswap Swap Sub-Agent
  {
    name: 'UniswapSwapSub',
    capabilities: ['swap'],
    specialization: {
      chain: 'ethereum',
      venue: 'uniswap',
    },
    spendLimitUsd: DEFAULT_SPEND_LIMIT,
    expiresInMs: TWENTY_FOUR_HOURS_MS,
  },
  // LiFi Bridge Sub-Agent
  {
    name: 'BridgeLiFiSub',
    capabilities: ['bridge'],
    specialization: {
      venue: 'lifi',
    },
    spendLimitUsd: DEFAULT_SPEND_LIMIT,
    expiresInMs: TWENTY_FOUR_HOURS_MS,
  },
  // Wormhole Bridge Sub-Agent
  {
    name: 'BridgeWormholeSub',
    capabilities: ['bridge'],
    specialization: {
      venue: 'wormhole',
    },
    spendLimitUsd: DEFAULT_SPEND_LIMIT,
    expiresInMs: TWENTY_FOUR_HOURS_MS,
  },
  // Event Betting Sub-Agent
  {
    name: 'EventBettingSub',
    capabilities: ['event'],
    spendLimitUsd: DEFAULT_SPEND_LIMIT,
    expiresInMs: TWENTY_FOUR_HOURS_MS,
  },
  // Perp Creation Sub-Agent
  {
    name: 'PerpCreationSub',
    capabilities: ['perp_create'],
    spendLimitUsd: DEFAULT_SPEND_LIMIT,
    expiresInMs: TWENTY_FOUR_HOURS_MS,
  },
  // Analysis/Proof Sub-Agent
  {
    name: 'AnalysisSub',
    capabilities: ['proof'],
    spendLimitUsd: DEFAULT_SPEND_LIMIT,
    expiresInMs: TWENTY_FOUR_HOURS_MS,
  },
  // Additional venue-specific sub-agents for comprehensive coverage
  // Arbitrum Swap Sub-Agent
  {
    name: 'ArbitrumSwapSub',
    capabilities: ['swap'],
    specialization: {
      chain: 'arbitrum',
    },
    spendLimitUsd: DEFAULT_SPEND_LIMIT,
    expiresInMs: TWENTY_FOUR_HOURS_MS,
  },
  // Base Swap Sub-Agent
  {
    name: 'BaseSwapSub',
    capabilities: ['swap'],
    specialization: {
      chain: 'base',
    },
    spendLimitUsd: DEFAULT_SPEND_LIMIT,
    expiresInMs: TWENTY_FOUR_HOURS_MS,
  },
  // Polygon DeFi Sub-Agent
  {
    name: 'PolygonDeFiSub',
    capabilities: ['lend', 'swap'],
    specialization: {
      chain: 'polygon',
    },
    spendLimitUsd: DEFAULT_SPEND_LIMIT,
    expiresInMs: TWENTY_FOUR_HOURS_MS,
  },
  // Optimism Bridge Sub-Agent
  {
    name: 'OptimismBridgeSub',
    capabilities: ['bridge'],
    specialization: {
      chain: 'optimism',
    },
    spendLimitUsd: DEFAULT_SPEND_LIMIT,
    expiresInMs: TWENTY_FOUR_HOURS_MS,
  },
  // Multi-Chain Perp Sub-Agent
  {
    name: 'MultiChainPerpSub',
    capabilities: ['perp'],
    spendLimitUsd: DEFAULT_SPEND_LIMIT,
    expiresInMs: TWENTY_FOUR_HOURS_MS,
  },
];

// ============================================
// Main Script
// ============================================

async function main() {
  console.log('');
  console.log('============================================================');
  console.log('         Spawn Torture Sub-Agents Script                    ');
  console.log('============================================================');
  console.log('');

  // Get parent agent ID
  const parentAgentId = process.env.ERC8004_AGENT_ID
    ? BigInt(process.env.ERC8004_AGENT_ID)
    : 1n; // Default to 1 for testing

  console.log('[config] Parent Agent ID:', parentAgentId.toString());
  console.log('[config] Sub-agents to spawn:', SUB_AGENT_DEFINITIONS.length);
  console.log('[config] Spend limit per agent: $' + DEFAULT_SPEND_LIMIT);
  console.log('[config] Expiration: 24 hours');
  console.log('');

  // Check orchestrator status
  const status = getOrchestratorStatus();
  console.log('[status] Orchestrator enabled:', status.enabled);
  console.log('[status] Current sub-agent count:', status.subAgentCount);
  console.log('[status] Active delegations:', status.activeDelegationCount);
  console.log('');

  if (!status.enabled) {
    console.log('[warn] Sub-agent delegation is disabled.');
    console.log('[warn] Set SUBAGENT_DELEGATION_ENABLED=true to enable.');
    console.log('');
    console.log('[info] Proceeding in dry-run mode (will show what would be registered)...');
    console.log('');

    // Show what would be registered
    console.log('------------------------------------------------------------');
    console.log('Sub-agents that would be registered:');
    console.log('------------------------------------------------------------');

    for (const def of SUB_AGENT_DEFINITIONS) {
      console.log('');
      console.log(`  [${def.name}]`);
      console.log(`    Capabilities: ${def.capabilities.join(', ')}`);
      if (def.specialization?.chain) {
        console.log(`    Chain: ${def.specialization.chain}`);
      }
      if (def.specialization?.venue) {
        console.log(`    Venue: ${def.specialization.venue}`);
      }
      console.log(`    Spend Limit: $${def.spendLimitUsd}`);
      console.log(`    Expires In: ${def.expiresInMs / (1000 * 60 * 60)} hours`);
    }

    console.log('');
    console.log('------------------------------------------------------------');
    console.log('To register these sub-agents, set SUBAGENT_DELEGATION_ENABLED=true');
    console.log('------------------------------------------------------------');
    process.exit(0);
  }

  // Register sub-agents
  console.log('------------------------------------------------------------');
  console.log('Registering sub-agents...');
  console.log('------------------------------------------------------------');
  console.log('');

  const registrations: { name: string; id: string; success: boolean; error?: string }[] = [];

  for (const def of SUB_AGENT_DEFINITIONS) {
    try {
      const registration = await registerSubAgent({
        parentAgentId,
        capabilities: def.capabilities,
        spendLimitUsd: def.spendLimitUsd,
        expiresInMs: def.expiresInMs,
        specialization: def.specialization,
      });

      registrations.push({
        name: def.name,
        id: registration.id,
        success: true,
      });

      console.log(`[ok] ${def.name}`);
      console.log(`     ID: ${registration.id}`);
      console.log(`     Capabilities: ${def.capabilities.join(', ')}`);
      if (def.specialization?.chain) {
        console.log(`     Chain: ${def.specialization.chain}`);
      }
      if (def.specialization?.venue) {
        console.log(`     Venue: ${def.specialization.venue}`);
      }
      console.log('');
    } catch (error: any) {
      registrations.push({
        name: def.name,
        id: '',
        success: false,
        error: error.message,
      });

      console.log(`[error] ${def.name}`);
      console.log(`        Error: ${error.message}`);
      console.log('');
    }
  }

  // Summary
  console.log('------------------------------------------------------------');
  console.log('Registration Summary');
  console.log('------------------------------------------------------------');
  console.log('');

  const successful = registrations.filter((r) => r.success);
  const failed = registrations.filter((r) => !r.success);

  console.log(`Total registered: ${successful.length}/${registrations.length}`);
  console.log('');

  if (successful.length > 0) {
    console.log('Successful registrations:');
    for (const reg of successful) {
      console.log(`  - ${reg.name}: ${reg.id}`);
    }
    console.log('');
  }

  if (failed.length > 0) {
    console.log('Failed registrations:');
    for (const reg of failed) {
      console.log(`  - ${reg.name}: ${reg.error}`);
    }
    console.log('');
  }

  // List all active sub-agents
  const allSubAgents = listSubAgents({ parentAgentId, activeOnly: true });
  console.log('------------------------------------------------------------');
  console.log(`Active Sub-Agents (total: ${allSubAgents.length})`);
  console.log('------------------------------------------------------------');
  console.log('');

  for (const agent of allSubAgents) {
    const expiresIn = Math.round((agent.expiresAt - Date.now()) / (1000 * 60 * 60));
    console.log(`  [${agent.id.slice(0, 8)}...]`);
    console.log(`    Capabilities: ${agent.delegatedCapabilities.join(', ')}`);
    console.log(`    Spend Limit: $${agent.spendLimitUsd}`);
    console.log(`    Expires in: ${expiresIn} hours`);
    if (agent.specialization?.chain) {
      console.log(`    Chain: ${agent.specialization.chain}`);
    }
    if (agent.specialization?.venue) {
      console.log(`    Venue: ${agent.specialization.venue}`);
    }
    console.log('');
  }

  // Final status
  const finalStatus = getOrchestratorStatus();
  console.log('------------------------------------------------------------');
  console.log('Final Orchestrator Status');
  console.log('------------------------------------------------------------');
  console.log(`  Sub-agent count: ${finalStatus.subAgentCount}`);
  console.log(`  Active delegations: ${finalStatus.activeDelegationCount}`);
  console.log(`  Default spend limit: $${finalStatus.defaultSpendLimitUsd}`);
  console.log('');

  console.log('Done!');
  process.exit(successful.length === registrations.length ? 0 : 1);
}

main().catch((error) => {
  console.error('Script failed:', error);
  process.exit(1);
});
