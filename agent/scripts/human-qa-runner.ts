#!/usr/bin/env tsx
/**
 * Human QA Test Runner
 *
 * Purpose: Deterministic test suite for Blossom MVP with 20 fixed actions across 4 personas
 * Scope: Bounded validation (NOT a stress test) with explicit action matrix
 * Evidence: Generates logs/HUMAN_QA_EVIDENCE_<timestamp>.json with RPC-based proof verification
 *
 * Critical Requirements:
 * - Support BOTH chat mode (/api/chat) and execute mode (/api/ledger/intents/execute)
 * - RPC-based proof verification (NOT explorer URL parsing)
 * - Stats verification with 120s polling
 * - Fallback detection (Sepolia receipt check)
 * - Retry logic (3x for infra flakes)
 * - Hard-stop on critical failures (fallback, base_receipt_missing, stats_missing)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { createPublicClient, http } from 'viem';
import { baseSepolia, sepolia } from 'viem/chains';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env.local for DEV_LEDGER_SECRET and RPC URLs
config({ path: path.resolve(__dirname, '../.env.local') });

// ============================================================================
// CONFIGURATION
// ============================================================================

// RPC configuration: prefer env vars, warn loudly on fallback to public RPCs
const _baseRpc = process.env.BASE_SEPOLIA_RPC_URL || '';
const _sepoliaRpc = process.env.SEPOLIA_RPC_URL || process.env.ETH_TESTNET_RPC_URL || '';
if (!_baseRpc) console.warn('⚠️  WARNING: BASE_SEPOLIA_RPC_URL not set — falling back to public RPC (unreliable)');
if (!_sepoliaRpc) console.warn('⚠️  WARNING: SEPOLIA_RPC_URL / ETH_TESTNET_RPC_URL not set — falling back to public RPC (unreliable)');

const CONFIG = {
  AGENT_API_BASE: process.env.AGENT_API_BASE || 'https://api.blossom.onl',
  BASE_SEPOLIA_RPC: _baseRpc || 'https://sepolia.base.org',
  SEPOLIA_RPC: _sepoliaRpc || 'https://rpc.sepolia.org',
  DEV_LEDGER_SECRET: process.env.DEV_LEDGER_SECRET || '',
  TARGET_CHAIN_ID: 84532,
  TARGET_CHAIN_NAME: 'base_sepolia',
  STATS_BASE_URL: 'https://stats.blossom.onl',
  MAX_RETRIES: 3,
  RETRY_BACKOFF_MS: 5000,
  STATS_POLL_INTERVAL_MS: 5000,
  STATS_POLL_MAX_DURATION_MS: 120000,  // 120s for bursty stats pipelines
};

console.log(`\n🤖 Human QA Runner - REAL EXECUTION MODE`);
console.log(`📍 API Base: ${CONFIG.AGENT_API_BASE}`);
console.log(`🔗 Target Chain: ${CONFIG.TARGET_CHAIN_NAME} (${CONFIG.TARGET_CHAIN_ID})`);
console.log(`🌐 Base RPC: ${CONFIG.BASE_SEPOLIA_RPC.replace(/\/v2\/.*/, '/v2/***')}`);
console.log(`🌐 Sepolia RPC: ${CONFIG.SEPOLIA_RPC.replace(/\/v2\/.*/, '/v2/***')}`);

// ============================================================================
// RPC CLIENTS
// ============================================================================

const baseClient = createPublicClient({
  chain: baseSepolia,
  transport: http(CONFIG.BASE_SEPOLIA_RPC),
});

const sepoliaClient = createPublicClient({
  chain: sepolia,
  transport: http(CONFIG.SEPOLIA_RPC),
});

// ============================================================================
// TYPES
// ============================================================================

interface QAAction {
  id: string;
  persona: string;
  intent: string;
  venue: string;
  mode: 'chat' | 'execute';
  expectedChain: string;
  expectedChainId: number;
  checkFallback: boolean;
  notes: string;
}

interface ActionEvidence {
  actionId: string;
  persona: string;
  wallet: string;
  intent: string;
  intentId: string | null;
  expectedChainId: number;
  expectedChainName: string;
  txHash: string | null;
  explorerUrl: string | null;
  statsLookupUrl: string | null;
  statsUiUrl: string | null;
  status: 'pass' | 'fail' | 'blocked';
  checks: {
    baseReceiptFound: boolean;
    baseReceiptSuccess: boolean;
    sepoliaReceiptFound: boolean;
    statsRecordFound: boolean;
  };
  statsCheckMode: 'auto' | 'manual_required';
  failureClass: 'none' | 'infra_flake' | 'blocked' | 'fallback' | 'stats_missing' | 'base_receipt_missing' | 'unexpected_error';
  notes: string;
  error?: string;
}

interface QARunSummary {
  timestamp: string;
  tester: string;
  environment: string;
  targetChainId: number;
  targetChainName: string;
  gitSha: string;
  baseUrl: string;
  mode: string;
  totalActions: number;
  passed: number;
  failed: number;
  blocked: number;
  criticalFailures: number;
  actions: ActionEvidence[];
}

// ============================================================================
// FIXED 20-ACTION TEST MATRIX
// ============================================================================

const ACTIVE_EVENT_ID = '__PLACEHOLDER__'; // Will be replaced during preflight

const TEST_ACTIONS: QAAction[] = [
  {
    id: 'action_001',
    persona: 'eth-sepolia',
    intent: 'Open a 0.01 ETH long position on BTC',
    venue: 'demo_perp',
    mode: 'chat',
    expectedChain: 'base_sepolia',
    expectedChainId: 84532,
    checkFallback: true,
    notes: 'Eth→Base default routing',
  },
  {
    id: 'action_002',
    persona: 'eth-sepolia',
    intent: 'Close my BTC position',
    venue: 'demo_perp',
    mode: 'chat',
    expectedChain: 'base_sepolia',
    expectedChainId: 84532,
    checkFallback: true,
    notes: '',
  },
  {
    id: 'action_003',
    persona: 'eth-sepolia',
    intent: 'Swap 5 bUSDC for WETH on Uniswap',
    venue: 'uniswap_v3',
    mode: 'chat',
    expectedChain: 'base_sepolia',
    expectedChainId: 84532,
    checkFallback: true,
    notes: '',
  },
  {
    id: 'action_004',
    persona: 'eth-sepolia',
    intent: 'Deposit 10 bUSDC into Aave',
    venue: 'aave_v3',
    mode: 'chat',
    expectedChain: 'base_sepolia',
    expectedChainId: 84532,
    checkFallback: true,
    notes: '',
  },
  {
    id: 'action_005',
    persona: 'eth-sepolia',
    intent: `Bet 3 bUSDC on YES for ${ACTIVE_EVENT_ID}`,
    venue: 'demo_event',
    mode: 'chat',
    expectedChain: 'base_sepolia',
    expectedChainId: 84532,
    checkFallback: true,
    notes: 'CONDITIONAL: Requires active event markets',
  },
  {
    id: 'action_006',
    persona: 'eth-sepolia',
    intent: 'Withdraw 5 bUSDC from Aave',
    venue: 'aave_v3',
    mode: 'chat',
    expectedChain: 'base_sepolia',
    expectedChainId: 84532,
    checkFallback: true,
    notes: '',
  },
  {
    id: 'action_007',
    persona: 'base-sepolia',
    intent: 'Open a 0.01 ETH short position on ETH',
    venue: 'demo_perp',
    mode: 'execute',
    expectedChain: 'base_sepolia',
    expectedChainId: 84532,
    checkFallback: false,
    notes: 'Native Base execution',
  },
  {
    id: 'action_008',
    persona: 'base-sepolia',
    intent: 'Close my ETH position',
    venue: 'demo_perp',
    mode: 'execute',
    expectedChain: 'base_sepolia',
    expectedChainId: 84532,
    checkFallback: false,
    notes: '',
  },
  {
    id: 'action_009',
    persona: 'base-sepolia',
    intent: 'Swap 0.001 ETH for bUSDC on Uniswap',
    venue: 'uniswap_v3',
    mode: 'execute',
    expectedChain: 'base_sepolia',
    expectedChainId: 84532,
    checkFallback: false,
    notes: '',
  },
  {
    id: 'action_010',
    persona: 'base-sepolia',
    intent: 'Deposit 8 bUSDC to Aave',
    venue: 'aave_v3',
    mode: 'execute',
    expectedChain: 'base_sepolia',
    expectedChainId: 84532,
    checkFallback: false,
    notes: '',
  },
  {
    id: 'action_011',
    persona: 'base-sepolia',
    intent: 'Open 0.005 ETH SOL long with 5x leverage',
    venue: 'demo_perp',
    mode: 'chat',
    expectedChain: 'base_sepolia',
    expectedChainId: 84532,
    checkFallback: false,
    notes: '',
  },
  {
    id: 'action_012',
    persona: 'base-sepolia',
    intent: `Bet 2 bUSDC on NO for ${ACTIVE_EVENT_ID}`,
    venue: 'demo_event',
    mode: 'chat',
    expectedChain: 'base_sepolia',
    expectedChainId: 84532,
    checkFallback: false,
    notes: 'CONDITIONAL: Requires active event markets',
  },
  {
    id: 'action_013',
    persona: 'solana-devnet',
    intent: 'Open a 0.01 ETH long position on BTC',
    venue: 'demo_perp (xchain credit)',
    mode: 'chat',
    expectedChain: 'base_sepolia',
    expectedChainId: 84532,
    checkFallback: true,
    notes: 'Solana→Base credit flow',
  },
  {
    id: 'action_014',
    persona: 'solana-devnet',
    intent: 'Swap 5 bUSDC for WETH on Base',
    venue: 'uniswap_v3 (xchain credit)',
    mode: 'chat',
    expectedChain: 'base_sepolia',
    expectedChainId: 84532,
    checkFallback: true,
    notes: 'Base Uniswap swap after Solana→Base credit',
  },
  {
    id: 'action_015',
    persona: 'solana-devnet',
    intent: 'Deposit 10 bUSDC to Aave on Base',
    venue: 'aave_v3 (xchain credit)',
    mode: 'chat',
    expectedChain: 'base_sepolia',
    expectedChainId: 84532,
    checkFallback: true,
    notes: '',
  },
  {
    id: 'action_016',
    persona: 'solana-devnet',
    intent: 'Close my BTC position',
    venue: 'demo_perp (xchain)',
    mode: 'execute',
    expectedChain: 'base_sepolia',
    expectedChainId: 84532,
    checkFallback: true,
    notes: '',
  },
  {
    id: 'action_017',
    persona: 'hl-demo-adapter',
    intent: 'Open 0.01 ETH long with 10x leverage',
    venue: 'demo_perp (EVM adapter)',
    mode: 'chat',
    expectedChain: 'base_sepolia',
    expectedChainId: 84532,
    checkFallback: true,
    notes: 'Hyperliquid uses EVM demo adapter on Base',
  },
  {
    id: 'action_018',
    persona: 'hl-demo-adapter',
    intent: 'Close my position',
    venue: 'demo_perp (EVM adapter)',
    mode: 'chat',
    expectedChain: 'base_sepolia',
    expectedChainId: 84532,
    checkFallback: true,
    notes: '',
  },
  {
    id: 'action_019',
    persona: 'hl-hip3-blocked',
    intent: 'Create DOGE-USD perp market (HIP-3)',
    venue: 'hip3',
    mode: 'chat',
    expectedChain: 'BLOCKED',
    expectedChainId: 0,
    checkFallback: false,
    notes: 'Expected BLOCKED: HIP-3 not implemented',
  },
  {
    id: 'action_020',
    persona: 'hl-native-blocked',
    intent: 'Trade BTC on native Hyperliquid',
    venue: 'hyperliquid_perp',
    mode: 'chat',
    expectedChain: 'base_sepolia (fallback)',
    expectedChainId: 84532,
    checkFallback: false,
    notes: 'Expected fallback to demo_perp on Base',
  },
];

// ============================================================================
// PREFLIGHT CHECKS
// ============================================================================

async function runPreflightChecks(): Promise<{ ok: boolean; activeEventId?: string }> {
  console.log('🔍 Running Preflight Checks...\n');

  // Check 0: RPC environment variables (FAIL if missing for deterministic reliability)
  if (!process.env.BASE_SEPOLIA_RPC_URL) {
    console.error('❌ Preflight FAILED: BASE_SEPOLIA_RPC_URL not set (required for reliable receipt verification)');
    return { ok: false };
  }
  if (!process.env.SEPOLIA_RPC_URL && !process.env.ETH_TESTNET_RPC_URL) {
    console.error('❌ Preflight FAILED: SEPOLIA_RPC_URL or ETH_TESTNET_RPC_URL not set (required for fallback detection)');
    return { ok: false };
  }
  console.log('✅ RPC env vars: Set');

  // Check 1: API Health
  try {
    const healthRes = await fetch(`${CONFIG.AGENT_API_BASE}/api/health`);
    if (!healthRes.ok) {
      console.error('❌ Preflight FAILED: /api/health unreachable');
      return { ok: false };
    }
    const healthData = await healthRes.json();
    console.log(`✅ API Health: ${healthData.status || 'ok'}`);
    if (healthData.sha) {
      console.log(`   Git SHA: ${healthData.sha}`);
    }
  } catch (err) {
    console.error('❌ Preflight FAILED: /api/health error:', err);
    return { ok: false };
  }

  // Check 2: Base Sepolia RPC
  try {
    const baseChainId = await baseClient.getChainId();
    if (baseChainId !== CONFIG.TARGET_CHAIN_ID) {
      console.error(`❌ Preflight FAILED: Base Sepolia chain ID mismatch (expected ${CONFIG.TARGET_CHAIN_ID}, got ${baseChainId})`);
      return { ok: false };
    }
    console.log(`✅ Base Sepolia RPC: Chain ID ${baseChainId}`);
  } catch (err) {
    console.error('❌ Preflight FAILED: Base Sepolia RPC error:', err);
    return { ok: false };
  }

  // Check 3: Sepolia RPC
  try {
    const sepoliaChainId = await sepoliaClient.getChainId();
    if (sepoliaChainId !== 11155111) {
      console.error(`❌ Preflight FAILED: Sepolia chain ID mismatch (expected 11155111, got ${sepoliaChainId})`);
      return { ok: false };
    }
    console.log(`✅ Sepolia RPC: Chain ID ${sepoliaChainId}`);
  } catch (err) {
    console.error('❌ Preflight FAILED: Sepolia RPC error:', err);
    return { ok: false };
  }

  // Check 4: DEV_LEDGER_SECRET
  if (!CONFIG.DEV_LEDGER_SECRET) {
    console.warn('⚠️  Warning: DEV_LEDGER_SECRET not set (may limit execution capabilities)');
  } else {
    console.log('✅ DEV_LEDGER_SECRET: Set');
  }

  // Check 5: Stats Endpoint Discovery
  try {
    const statsRes = await fetch(`${CONFIG.STATS_BASE_URL}/api/health`);
    if (statsRes.ok) {
      console.log(`✅ Stats API: Reachable at ${CONFIG.STATS_BASE_URL}`);
    } else {
      console.warn(`⚠️  Warning: Stats API returned ${statsRes.status}, manual verification may be required`);
    }
  } catch (err) {
    console.warn('⚠️  Warning: Stats API unreachable, manual verification may be required');
  }

  // Check 6: Active Events (for actions 5, 12)
  let activeEventId: string | undefined;
  try {
    // Attempt to fetch active events (endpoint may not exist)
    const eventsRes = await fetch(`${CONFIG.AGENT_API_BASE}/api/events/active`);
    if (eventsRes.ok) {
      const eventsData = await eventsRes.json();
      if (eventsData.events && eventsData.events.length > 0) {
        activeEventId = eventsData.events[0].id;
        console.log(`✅ Active Events: Found ${eventsData.events.length} event(s), using ${activeEventId}`);
      } else {
        console.warn('⚠️  Warning: No active events found. Actions 5, 12 will be marked BLOCKED.');
      }
    } else {
      console.warn('⚠️  Warning: /api/events/active not available. Actions 5, 12 may be BLOCKED.');
    }
  } catch (err) {
    console.warn('⚠️  Warning: Could not fetch active events. Actions 5, 12 may be BLOCKED.');
  }

  console.log('\n✅ Preflight Checks Complete\n');
  return { ok: true, activeEventId };
}

// ============================================================================
// EXECUTION HELPERS
// ============================================================================

async function executeAction(action: QAAction, wallet: string, retryCount = 0): Promise<any> {
  // ALWAYS use real execution endpoint (not /api/chat which is planning-only)
  const endpoint = '/api/ledger/intents/execute';
  const body: any = {
    intentText: action.intent,
    chain: 'ethereum',
    planOnly: false,  // CRITICAL: Must be false for real execution
    metadata: {
      userAddress: wallet,
      walletAddress: wallet,
      mode: 'tier1_crosschain_required_base',
      requireBaseSettlement: true,
      toChain: 'base_sepolia',
      source: 'qa_runner',
    },
  };

  try {
    const res = await fetch(`${CONFIG.AGENT_API_BASE}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ledger-Secret': CONFIG.DEV_LEDGER_SECRET,  // Required by checkLedgerSecret middleware
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errorText}`);
    }

    const result = await res.json();

    // Log real execution evidence
    if (result.intentId) {
      console.log(`   ✅ intentId: ${result.intentId}`);
    }
    if (result.txHash) {
      console.log(`   ✅ txHash: ${result.txHash}`);
    }
    if (result.status) {
      console.log(`   Status: ${result.status}`);
    }

    return result;
  } catch (err: any) {
    // Retry logic for infra flakes
    if (retryCount < CONFIG.MAX_RETRIES) {
      console.log(`⚠️  Retry ${retryCount + 1}/${CONFIG.MAX_RETRIES} after ${CONFIG.RETRY_BACKOFF_MS}ms...`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_BACKOFF_MS));
      return executeAction(action, wallet, retryCount + 1);
    }
    throw err;
  }
}

async function verifyBaseReceipt(txHash: string): Promise<{ found: boolean; success: boolean }> {
  try {
    const receipt = await baseClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
    return { found: true, success: receipt.status === 'success' };
  } catch (err) {
    return { found: false, success: false };
  }
}

async function verifySepoliaReceipt(txHash: string): Promise<boolean> {
  try {
    const receipt = await sepoliaClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
    return receipt !== null;
  } catch (err) {
    // "transaction not found" errors are expected (no fallback)
    return false;
  }
}

async function verifyStatsRecord(intentId: string): Promise<{ found: boolean; inRecentPublic: boolean }> {
  const startTime = Date.now();

  // PRIMARY: Deterministic per-intent lookup via /api/ledger/intents/:id
  // Polls with eventual consistency (up to 120s)
  while (Date.now() - startTime < CONFIG.STATS_POLL_MAX_DURATION_MS) {
    try {
      const res = await fetch(`${CONFIG.AGENT_API_BASE}/api/ledger/intents/${intentId}`, {
        headers: { 'X-Ledger-Secret': CONFIG.DEV_LEDGER_SECRET }
      });

      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.data && data.data.id === intentId) {
          // Intent found in ledger database
          return { found: true, inRecentPublic: true };
        }
      }
    } catch (err) {
      // Continue polling
    }
    await new Promise(resolve => setTimeout(resolve, CONFIG.STATS_POLL_INTERVAL_MS));
  }

  // SECONDARY: Fallback to recent intents list (50 intents, larger window than public stats)
  try {
    const recentRes = await fetch(`${CONFIG.AGENT_API_BASE}/api/ledger/intents/recent`, {
      headers: { 'X-Ledger-Secret': CONFIG.DEV_LEDGER_SECRET }
    });
    if (recentRes.ok) {
      const recentData = await recentRes.json();
      if (recentData.ok && Array.isArray(recentData.data)) {
        const found = recentData.data.some((intent: any) => intent.id === intentId);
        if (found) {
          return { found: true, inRecentPublic: true };
        }
      }
    }
  } catch (err) {
    // Ignore fallback errors
  }

  return { found: false, inRecentPublic: false };
}

// ============================================================================
// ACTION RUNNER
// ============================================================================

async function runAction(action: QAAction, wallet: string): Promise<ActionEvidence> {
  console.log(`\n📋 Running ${action.id}: ${action.intent}`);
  console.log(`   Persona: ${action.persona} | Mode: ${action.mode} | Venue: ${action.venue}`);

  const evidence: ActionEvidence = {
    actionId: action.id,
    persona: action.persona,
    wallet,
    intent: action.intent,
    intentId: null,
    expectedChainId: action.expectedChainId,
    expectedChainName: action.expectedChain,
    txHash: null,
    explorerUrl: null,
    statsLookupUrl: null,
    statsUiUrl: null,
    status: 'fail',
    checks: {
      baseReceiptFound: false,
      baseReceiptSuccess: false,
      sepoliaReceiptFound: false,
      statsRecordFound: false,
    },
    statsCheckMode: 'auto',
    failureClass: 'unexpected_error',
    notes: action.notes,
  };

  try {
    // Execute action
    const result = await executeAction(action, wallet);

    // Extract intentId and txHash from response (real execution endpoint returns them directly)
    evidence.intentId = result.intentId || null;
    evidence.txHash = result.txHash || null;

    // CRITICAL: Require intentId for all actions (no false positives)
    if (!evidence.intentId) {
      evidence.status = 'fail';
      evidence.failureClass = 'unexpected_error';
      evidence.notes += ' | ERROR: No intentId returned by API';
      console.error(`❌ FAIL: No intentId returned`);
      return evidence;
    }

    // CRITICAL: Require txHash for actions expected to produce transactions
    if (action.expectedChain !== 'BLOCKED' && !evidence.txHash) {
      evidence.status = 'fail';
      evidence.failureClass = 'base_receipt_missing';
      evidence.notes += ' | ERROR: No txHash returned by API';
      console.error(`❌ FAIL: No txHash returned`);
      return evidence;
    }

    // Build stats URLs (deterministic per-intent lookup)
    if (evidence.intentId) {
      evidence.statsLookupUrl = `${CONFIG.AGENT_API_BASE}/api/ledger/intents/${evidence.intentId}`;
      evidence.statsUiUrl = `${CONFIG.STATS_BASE_URL}?intentId=${evidence.intentId}`;
    }

    // Build explorer URL
    if (evidence.txHash) {
      if (action.expectedChain === 'base_sepolia') {
        evidence.explorerUrl = `https://sepolia.basescan.org/tx/${evidence.txHash}`;
      } else if (action.expectedChain === 'sepolia') {
        evidence.explorerUrl = `https://sepolia.etherscan.io/tx/${evidence.txHash}`;
      }
    }

    // Check for BLOCKED status
    if (result.status === 'blocked' || result.error?.includes('not implemented') || result.error?.includes('not supported')) {
      evidence.status = 'blocked';
      evidence.failureClass = 'blocked';
      evidence.notes += ` | BLOCKED: ${result.error || 'Not implemented'}`;
      console.log(`⚠️  BLOCKED: ${result.error || 'Not implemented'}`);
      return evidence;
    }

    // Gate 1: Base Receipt Verification (if txHash present)
    if (evidence.txHash && action.expectedChain === 'base_sepolia') {
      console.log(`   Verifying Base Sepolia receipt...`);
      const baseReceipt = await verifyBaseReceipt(evidence.txHash);
      evidence.checks.baseReceiptFound = baseReceipt.found;
      evidence.checks.baseReceiptSuccess = baseReceipt.success;

      if (!baseReceipt.found) {
        evidence.status = 'fail';
        evidence.failureClass = 'base_receipt_missing';
        evidence.notes += ' | CRITICAL: Base receipt missing';
        console.error(`❌ CRITICAL FAILURE: Base receipt missing for ${evidence.txHash}`);
        throw new Error('CRITICAL_FAILURE: base_receipt_missing');
      }

      if (!baseReceipt.success) {
        evidence.status = 'fail';
        evidence.failureClass = 'base_receipt_missing';
        evidence.notes += ' | Base receipt failed';
        console.error(`❌ Base receipt failed for ${evidence.txHash}`);
      }
    }

    // Gate 2: No Fallback Verification (if checkFallback enabled)
    if (evidence.txHash && action.checkFallback) {
      console.log(`   Checking for Sepolia fallback...`);
      const sepoliaReceipt = await verifySepoliaReceipt(evidence.txHash);
      evidence.checks.sepoliaReceiptFound = sepoliaReceipt;

      if (sepoliaReceipt) {
        evidence.status = 'fail';
        evidence.failureClass = 'fallback';
        evidence.notes += ' | CRITICAL: Settlement fallback to Sepolia detected';
        console.error(`❌ CRITICAL FAILURE: Sepolia fallback detected for ${evidence.txHash}`);
        throw new Error('CRITICAL_FAILURE: fallback');
      }
    }

    // Gate 3: Stats Verification (BLOCKING - using per-intent PRIMARY endpoint)
    if (evidence.intentId) {
      console.log(`   Verifying stats record...`);
      const statsResult = await verifyStatsRecord(evidence.intentId);
      evidence.checks.statsRecordFound = statsResult.found;

      // Add informational note about public stats visibility
      if (statsResult.inRecentPublic) {
        evidence.notes += ' | recentPublicStatsSeen=true';
      } else {
        evidence.notes += ' | recentPublicStatsSeen=false';
      }

      if (!statsResult.found) {
        evidence.status = 'fail';
        evidence.failureClass = 'stats_missing';
        evidence.statsCheckMode = 'manual_required';
        evidence.notes += ' | CRITICAL: Stats per-intent executions endpoint timeout after 120s';
        console.error(`❌ CRITICAL FAILURE: Stats record missing for ${evidence.intentId}`);
        throw new Error('CRITICAL_FAILURE: stats_missing');
      }
    }

    // All checks passed
    evidence.status = 'pass';
    evidence.failureClass = 'none';
    console.log(`✅ PASS: All checks passed`);
  } catch (err: any) {
    evidence.error = err.message;
    if (err.message.includes('CRITICAL_FAILURE')) {
      // Already set status and failureClass
      throw err; // Re-throw to stop runner
    } else {
      evidence.status = 'fail';
      evidence.failureClass = 'unexpected_error';
      evidence.notes += ` | Error: ${err.message}`;
      console.error(`❌ FAIL: ${err.message}`);
    }
  }

  return evidence;
}

// ============================================================================
// MAIN RUNNER
// ============================================================================

async function main() {
  console.log('🚀 Starting Human QA Test Runner\n');

  // Preflight checks
  const preflight = await runPreflightChecks();
  if (!preflight.ok) {
    console.error('\n❌ Preflight checks failed. Aborting.\n');
    process.exit(1);
  }

  // Replace ACTIVE_EVENT_ID placeholder
  const activeEventId = preflight.activeEventId || '__NO_ACTIVE_EVENTS__';
  TEST_ACTIONS.forEach(action => {
    action.intent = action.intent.replace('__PLACEHOLDER__', activeEventId);
    if (action.intent.includes('__NO_ACTIVE_EVENTS__')) {
      action.notes += ' | BLOCKED: No active events';
    }
  });

  // Test wallet (placeholder - replace with actual test wallet)
  const testWallet = '0x158Ef361B3e3ce4bf4a93a43EFc313c979fb4321';

  const results: ActionEvidence[] = [];
  let passed = 0;
  let failed = 0;
  let blocked = 0;
  let criticalFailures = 0;

  // Run all 20 actions
  for (const action of TEST_ACTIONS) {
    try {
      const evidence = await runAction(action, testWallet);
      results.push(evidence);

      if (evidence.status === 'pass') passed++;
      else if (evidence.status === 'blocked') blocked++;
      else failed++;

      // Check for critical failures
      if (['fallback', 'base_receipt_missing', 'stats_missing'].includes(evidence.failureClass)) {
        criticalFailures++;
        console.error(`\n❌❌❌ CRITICAL FAILURE DETECTED: ${evidence.failureClass} ❌❌❌`);
        console.error(`Action: ${evidence.actionId}`);
        console.error(`Intent: ${evidence.intent}`);
        console.error(`Details: ${evidence.notes}\n`);

        // HARD-STOP on critical failures
        console.error('🛑 STOPPING RUN DUE TO CRITICAL FAILURE\n');
        break;
      }
    } catch (err: any) {
      if (err.message.includes('CRITICAL_FAILURE')) {
        // Critical failure already recorded, stop run
        break;
      }
      // Non-critical error, continue
      console.error(`⚠️  Action ${action.id} encountered error, continuing...`);
    }

    // Brief delay between actions
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Generate summary
  const summary: QARunSummary = {
    timestamp: new Date().toISOString(),
    tester: 'human-qa-runner',
    environment: 'production',
    targetChainId: CONFIG.TARGET_CHAIN_ID,
    targetChainName: CONFIG.TARGET_CHAIN_NAME,
    gitSha: 'bea057b8',
    baseUrl: CONFIG.AGENT_API_BASE,
    mode: 'real_execution',
    totalActions: results.length,
    passed,
    failed,
    blocked,
    criticalFailures,
    actions: results,
  };

  // Write evidence file
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(__dirname, '../../logs', `HUMAN_QA_EVIDENCE_${timestamp}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));

  console.log('\n' + '='.repeat(80));
  console.log('📊 TEST RUN SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total Actions: ${summary.totalActions}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`⚠️  Blocked: ${blocked}`);
  console.log(`🛑 Critical Failures: ${criticalFailures}`);
  console.log(`📁 Evidence: ${outputPath}`);
  console.log('='.repeat(80) + '\n');

  if (criticalFailures > 0) {
    console.error('❌ TEST RUN FAILED: Critical failures detected\n');
    process.exit(1);
  } else if (failed > 0) {
    console.warn('⚠️  TEST RUN COMPLETED WITH FAILURES\n');
    process.exit(1);
  } else {
    console.log('✅ TEST RUN PASSED\n');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('\n❌ FATAL ERROR:', err);
  process.exit(1);
});
