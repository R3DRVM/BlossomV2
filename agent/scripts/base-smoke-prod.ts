#!/usr/bin/env tsx
/**
 * Base Sepolia Production Smoke Test
 *
 * Validates Base Sepolia settlement lane health using real production endpoints.
 * Performs health checks, bytecode verification, and one deterministic happy-path test.
 *
 * Usage:
 *   npm run base:smoke:prod
 *   DEV_LEDGER_SECRET=xxx BASE_SEPOLIA_RPC_URL=xxx npm run base:smoke:prod
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { config as loadDotenv } from 'dotenv';
import { createPublicClient, http, type Address } from 'viem';
import { baseSepolia } from 'viem/chains';

// ================================================================
// ENV LOADING - Multi-file fallback for local development
// ================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../..');

// Attempt to load env files in priority order (first found wins per variable)
const envFiles = [
  resolve(repoRoot, '.env.local'),
  resolve(repoRoot, '.env'),
  resolve(repoRoot, 'agent', '.env.local'),
  resolve(repoRoot, 'agent', '.env'),
];

const loadedFiles: string[] = [];
for (const envFile of envFiles) {
  if (fs.existsSync(envFile)) {
    loadDotenv({ path: envFile, override: false }); // Don't override already-set vars
    loadedFiles.push(envFile);
  }
}

// Debug: Non-sensitive env loading status (only if DEBUG_ENV_LOADING=1)
if (process.env.DEBUG_ENV_LOADING === '1') {
  console.log('[base-smoke-prod] Env loading debug:');
  console.log('  Attempted files:', envFiles.map(f => path.relative(repoRoot, f)));
  console.log('  Loaded files:', loadedFiles.map(f => path.relative(repoRoot, f)));
  console.log('  DEV_LEDGER_SECRET present:', !!process.env.DEV_LEDGER_SECRET);
  console.log('  LEDGER_SECRET present:', !!process.env.LEDGER_SECRET);
  console.log('  BASE_SEPOLIA_RPC_URL present:', !!process.env.BASE_SEPOLIA_RPC_URL);
  console.log();
}

// ================================================================
// CONSTANTS
// ================================================================

const BASE_SEPOLIA_CHAIN_ID = 84532;
const BASESCAN_BASE_URL = 'https://sepolia.basescan.org/tx/';

const BASE_URL = process.env.BASE_URL ?? 'https://api.blossom.onl';
// Compatibility shim: Accept LEDGER_SECRET as fallback for DEV_LEDGER_SECRET
const LEDGER_SECRET = process.env.DEV_LEDGER_SECRET || process.env.LEDGER_SECRET;
// Compatibility: Try multiple env var names, fallback to public RPC
const BASE_SEPOLIA_RPC_URL =
  process.env.BASE_SEPOLIA_RPC_URL ||
  process.env.BASE_RPC_URL ||
  'https://sepolia.base.org'; // Public Base Sepolia RPC (default fallback)

// ================================================================
// HELPER FUNCTIONS
// ================================================================

function buildExplorerLink(txHash: string): string {
  return `${BASESCAN_BASE_URL}${txHash}`;
}

function isTransientHttpStatus(code: number): boolean {
  return code === 429 || (code >= 500 && code <= 599);
}

function isTransientErrorMessage(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes('timeout') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('temporarily unavailable') ||
    lower.includes('rate limit')
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

async function getCodeWithRetry(
  rpcUrl: string,
  address: Address,
  maxRetries: number = 3
): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getCode',
          params: [address, 'latest'],
        }),
      });

      if (!response.ok) {
        throw new Error(`RPC returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(`RPC error: ${data.error.message || JSON.stringify(data.error)}`);
      }

      return data.result || '0x';
    } catch (error: any) {
      lastError = error;
      if (attempt < maxRetries) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        console.log(`[base-smoke-prod] eth_getCode attempt ${attempt} failed, retrying in ${backoffMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }

  throw lastError || new Error('getCodeWithRetry failed without error');
}

async function confirmSettlementReceipt(
  txHash: string,
  rpcUrl: string,
  maxRetries: number = 4
): Promise<boolean> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await withTimeout(
        fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_getTransactionReceipt',
            params: [txHash],
          }),
        }),
        35000,
        `eth_getTransactionReceipt(${txHash})`
      );

      if (!response.ok) {
        throw new Error(`RPC returned ${response.status}`);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(`RPC error: ${data.error.message}`);
      }

      const receipt = data.result;
      if (!receipt) {
        console.log(`[base-smoke-prod] Receipt not found for ${txHash}, attempt ${attempt}/${maxRetries}`);
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
        return false;
      }

      const status = receipt.status;
      return status === '0x1' || status === 1 || status === true;
    } catch (error: any) {
      lastError = error;
      if (attempt < maxRetries) {
        const backoffMs = 800 * Math.pow(2, attempt - 1);
        console.log(`[base-smoke-prod] Receipt check attempt ${attempt} failed, retrying in ${backoffMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }

  throw lastError || new Error('confirmSettlementReceipt failed');
}

// ================================================================
// SMOKE TEST CHECKS
// ================================================================

interface CheckResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  [key: string]: any;
}

async function checkHealthEndpoint(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const response = await withTimeout(
      fetch(`${BASE_URL}/api/health`),
      5000,
      'health endpoint'
    );

    if (!response.ok) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: `HTTP ${response.status}`,
      };
    }

    const data = await response.json();
    return {
      ok: data.ok === true,
      latencyMs: Date.now() - start,
      baseSepolia: data.baseSepolia,
    };
  } catch (error: any) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: error.message,
    };
  }
}

async function checkRelayerStatus(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const response = await withTimeout(
      fetch(`${BASE_URL}/api/relayer/status?chain=base_sepolia`, {
        headers: {
          'X-Ledger-Secret': LEDGER_SECRET || '',
        },
      }),
      10000,
      'relayer status'
    );

    if (!response.ok) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: `HTTP ${response.status}`,
      };
    }

    const data = await response.json();
    return {
      ok: data.relayer?.okToExecute === true,
      latencyMs: Date.now() - start,
      balanceEth: data.relayer?.balanceEth,
      okToExecute: data.relayer?.okToExecute,
    };
  } catch (error: any) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: error.message,
    };
  }
}

async function checkChainId(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const response = await withTimeout(
      fetch(BASE_SEPOLIA_RPC_URL!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_chainId',
          params: [],
        }),
      }),
      5000,
      'eth_chainId'
    );

    if (!response.ok) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: `RPC returned ${response.status}`,
      };
    }

    const data = await response.json();
    const chainIdHex = data.result;
    const chainId = parseInt(chainIdHex, 16);

    return {
      ok: chainId === BASE_SEPOLIA_CHAIN_ID,
      latencyMs: Date.now() - start,
      chainId,
      expectedChainId: BASE_SEPOLIA_CHAIN_ID,
      error: chainId !== BASE_SEPOLIA_CHAIN_ID ? `Chain ID mismatch: got ${chainId}, expected ${BASE_SEPOLIA_CHAIN_ID}` : undefined,
    };
  } catch (error: any) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: error.message,
    };
  }
}

async function verifyBytecode(
  name: string,
  address: Address
): Promise<CheckResult> {
  const start = Date.now();
  try {
    const code = await withTimeout(
      getCodeWithRetry(BASE_SEPOLIA_RPC_URL!, address, 3),
      60000,
      `bytecode verification for ${name}`
    );

    const codeSize = code === '0x' ? 0 : (code.length - 2) / 2; // Subtract '0x' prefix

    return {
      ok: codeSize > 0,
      latencyMs: Date.now() - start,
      codeSize,
      address,
      error: codeSize === 0 ? 'No bytecode found (contract not deployed)' : undefined,
    };
  } catch (error: any) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: error.message,
    };
  }
}

async function runHappyPathTest(): Promise<CheckResult> {
  const start = Date.now();
  try {
    // Execute deterministic intent with explicit metadata forcing tier1 path
    const response = await withTimeout(
      fetch(`${BASE_URL}/api/ledger/intents/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Ledger-Secret': LEDGER_SECRET || '',
        },
        body: JSON.stringify({
          userPrompt: 'Open a 0.01 ETH long position on BTC',
          metadata: {
            mode: 'tier1_crosschain_required_base',
            requireBaseSettlement: true,
            routeTypeRequired: 'testnet_credit',
            toChain: 'base_sepolia',
            strictSettlementChain: true,
            deterministic: true,
            bypassLLM: true,
          },
        }),
      }),
      90000,
      'happy path test'
    );

    const data = await response.json();

    // Check for transient errors (allow retry)
    if (!response.ok) {
      const isTransient = isTransientHttpStatus(response.status) ||
        (data.message && isTransientErrorMessage(data.message));

      if (!isTransient) {
        // Non-transient error - fail immediately
        return {
          ok: false,
          latencyMs: Date.now() - start,
          error: `Non-transient error: ${response.status} ${data.message || data.error || 'Unknown error'}`,
          responseStatus: response.status,
          responseBody: data,
        };
      }

      // Transient error - will be retried by caller
      throw new Error(`Transient error: ${response.status} ${data.message || 'Unknown'}`);
    }

    // Extract transaction hashes
    const creditTxHash = data.executionMeta?.route?.creditTxHash || data.creditTxHash;
    const executionTxHash = data.executionMeta?.txHash || data.txHash || data.executionTxHash;
    const executionMeta = data.executionMeta;

    // ASSERT: Prevent false "ok" artifacts
    if (!creditTxHash || !creditTxHash.startsWith('0x')) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: 'Missing or invalid creditTxHash',
        responseBody: data,
      };
    }

    if (!executionTxHash || !executionTxHash.startsWith('0x')) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: 'Missing or invalid executionTxHash',
        responseBody: data,
      };
    }

    if (executionMeta?.route?.routeType !== 'testnet_credit') {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: `Route type must be testnet_credit, got: ${executionMeta?.route?.routeType}`,
        responseBody: data,
      };
    }

    if (executionMeta?.route?.toChain !== 'base_sepolia') {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: `Route must target base_sepolia, got: ${executionMeta?.route?.toChain}`,
        responseBody: data,
      };
    }

    // OPTIONAL: Check for fallback
    if (executionMeta?.settlementChain && executionMeta.settlementChain !== 'base_sepolia') {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: `Settlement chain must be base_sepolia, got: ${executionMeta.settlementChain}`,
        responseBody: data,
      };
    }

    if (executionMeta?.route?.fallbackUsed === true) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: 'Fallback was used (should not happen in base-required mode)',
        responseBody: data,
      };
    }

    // Confirm both receipts on Base Sepolia
    console.log(`[base-smoke-prod] Confirming credit receipt: ${creditTxHash}`);
    const creditReceiptConfirmed = await confirmSettlementReceipt(creditTxHash, BASE_SEPOLIA_RPC_URL!);

    console.log(`[base-smoke-prod] Confirming execution receipt: ${executionTxHash}`);
    const executionReceiptConfirmed = await confirmSettlementReceipt(executionTxHash, BASE_SEPOLIA_RPC_URL!);

    return {
      ok: creditReceiptConfirmed && executionReceiptConfirmed,
      latencyMs: Date.now() - start,
      creditTxHash,
      executionTxHash,
      creditReceiptConfirmed,
      executionReceiptConfirmed,
      explorerLinks: {
        credit: buildExplorerLink(creditTxHash),
        execution: buildExplorerLink(executionTxHash),
      },
    };
  } catch (error: any) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: error.message,
    };
  }
}

// ================================================================
// MAIN
// ================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('Base Sepolia Production Smoke Test');
  console.log('='.repeat(80));
  console.log();

  // Prerequisites check (after env loading attempt)
  if (!LEDGER_SECRET) {
    console.error('[base-smoke-prod] ERROR: DEV_LEDGER_SECRET (or LEDGER_SECRET) not set');
    console.error('');
    console.error('Env loading status:');
    console.error('  Attempted files:', envFiles.map(f => path.relative(repoRoot, f)));
    console.error('  Loaded files:', loadedFiles.length > 0 ? loadedFiles.map(f => path.relative(repoRoot, f)) : 'none');
    console.error('  DEV_LEDGER_SECRET present:', !!process.env.DEV_LEDGER_SECRET);
    console.error('  LEDGER_SECRET present:', !!process.env.LEDGER_SECRET);
    console.error('');
    console.error('To fix: Set DEV_LEDGER_SECRET in one of these files:');
    console.error('  - .env.local (recommended)');
    console.error('  - agent/.env.local');
    console.error('  - Or export it: export DEV_LEDGER_SECRET="your-secret"');
    process.exit(1);
  }
  // Note: BASE_SEPOLIA_RPC_URL now has a public fallback, so this check is mainly for debugging
  if (!BASE_SEPOLIA_RPC_URL) {
    console.error('[base-smoke-prod] ERROR: BASE_SEPOLIA_RPC_URL could not be determined (should not happen)');
    process.exit(1);
  }

  console.log(`BASE_URL: ${BASE_URL}`);
  console.log(`BASE_SEPOLIA_RPC_URL: ${BASE_SEPOLIA_RPC_URL}`);
  console.log();

  const artifact: any = {
    ok: false,
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    checks: {},
  };

  // 1. Health endpoint
  console.log('[1/7] Checking health endpoint...');
  artifact.checks.healthEndpoint = await checkHealthEndpoint();
  console.log(`  ✓ ${artifact.checks.healthEndpoint.ok ? 'PASS' : 'FAIL'} (${artifact.checks.healthEndpoint.latencyMs}ms)`);
  if (artifact.checks.healthEndpoint.error) {
    console.log(`    Error: ${artifact.checks.healthEndpoint.error}`);
  }

  // 2. Relayer status
  console.log('[2/7] Checking relayer status...');
  artifact.checks.relayerStatus = await checkRelayerStatus();
  console.log(`  ✓ ${artifact.checks.relayerStatus.ok ? 'PASS' : 'FAIL'} (${artifact.checks.relayerStatus.latencyMs}ms)`);
  if (artifact.checks.relayerStatus.balanceEth) {
    console.log(`    Balance: ${artifact.checks.relayerStatus.balanceEth} ETH`);
  }
  if (artifact.checks.relayerStatus.error) {
    console.log(`    Error: ${artifact.checks.relayerStatus.error}`);
  }

  // 3. Chain ID verification
  console.log('[3/7] Verifying chain ID...');
  artifact.checks.chainId = await checkChainId();
  console.log(`  ✓ ${artifact.checks.chainId.ok ? 'PASS' : 'FAIL'} (${artifact.checks.chainId.latencyMs}ms)`);
  if (artifact.checks.chainId.chainId) {
    console.log(`    Chain ID: ${artifact.checks.chainId.chainId} (expected: ${BASE_SEPOLIA_CHAIN_ID})`);
  }
  if (artifact.checks.chainId.error) {
    console.log(`    Error: ${artifact.checks.chainId.error}`);
  }

  // 4. Bytecode verification
  console.log('[4/7] Verifying contract bytecode...');

  // Get contract addresses from env
  const routerAddress = process.env.EXECUTION_ROUTER_ADDRESS_BASE_SEPOLIA as Address;
  const busdcAddress = process.env.BUSDC_ADDRESS_BASE_SEPOLIA as Address;
  const perpAdapterAddress = process.env.DEMO_PERP_ADAPTER_ADDRESS_BASE_SEPOLIA as Address;

  artifact.checks.bytecodeVerification = {};

  if (routerAddress) {
    console.log(`  [4a] Router: ${routerAddress}`);
    artifact.checks.bytecodeVerification.router = await verifyBytecode('ExecutionRouter', routerAddress);
    console.log(`    ✓ ${artifact.checks.bytecodeVerification.router.ok ? 'PASS' : 'FAIL'} (${artifact.checks.bytecodeVerification.router.latencyMs}ms, ${artifact.checks.bytecodeVerification.router.codeSize} bytes)`);
  } else {
    artifact.checks.bytecodeVerification.router = { ok: false, error: 'EXECUTION_ROUTER_ADDRESS_BASE_SEPOLIA not set' };
    console.log(`    ✗ FAIL: EXECUTION_ROUTER_ADDRESS_BASE_SEPOLIA not set`);
  }

  if (busdcAddress) {
    console.log(`  [4b] bUSDC: ${busdcAddress}`);
    artifact.checks.bytecodeVerification.busdc = await verifyBytecode('bUSDC', busdcAddress);
    console.log(`    ✓ ${artifact.checks.bytecodeVerification.busdc.ok ? 'PASS' : 'FAIL'} (${artifact.checks.bytecodeVerification.busdc.latencyMs}ms, ${artifact.checks.bytecodeVerification.busdc.codeSize} bytes)`);
  } else {
    artifact.checks.bytecodeVerification.busdc = { ok: false, error: 'BUSDC_ADDRESS_BASE_SEPOLIA not set' };
    console.log(`    ✗ FAIL: BUSDC_ADDRESS_BASE_SEPOLIA not set`);
  }

  if (perpAdapterAddress) {
    console.log(`  [4c] Perp Adapter: ${perpAdapterAddress}`);
    artifact.checks.bytecodeVerification.perpAdapter = await verifyBytecode('DemoPerpAdapter', perpAdapterAddress);
    console.log(`    ✓ ${artifact.checks.bytecodeVerification.perpAdapter.ok ? 'PASS' : 'FAIL'} (${artifact.checks.bytecodeVerification.perpAdapter.latencyMs}ms, ${artifact.checks.bytecodeVerification.perpAdapter.codeSize} bytes)`);
  } else {
    artifact.checks.bytecodeVerification.perpAdapter = { ok: false, error: 'DEMO_PERP_ADAPTER_ADDRESS_BASE_SEPOLIA not set' };
    console.log(`    ✗ FAIL: DEMO_PERP_ADAPTER_ADDRESS_BASE_SEPOLIA not set`);
  }

  // 5. Happy path test (with retry for transient errors)
  console.log('[5/7] Running happy path test (with retry for transient errors)...');
  let happyPathResult: CheckResult | null = null;
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      happyPathResult = await runHappyPathTest();
      break; // Success - exit retry loop
    } catch (error: any) {
      if (attempt < maxRetries && isTransientErrorMessage(error.message)) {
        console.log(`  Attempt ${attempt} failed (transient), retrying...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        // Final attempt or non-transient error
        happyPathResult = {
          ok: false,
          error: error.message,
        };
        break;
      }
    }
  }

  artifact.checks.happyPathTest = happyPathResult;
  console.log(`  ✓ ${artifact.checks.happyPathTest.ok ? 'PASS' : 'FAIL'} (${artifact.checks.happyPathTest.latencyMs || 0}ms)`);
  if (artifact.checks.happyPathTest.creditTxHash) {
    console.log(`    Credit TX: ${artifact.checks.happyPathTest.creditTxHash}`);
    console.log(`    Execution TX: ${artifact.checks.happyPathTest.executionTxHash}`);
    console.log(`    Explorer: ${artifact.checks.happyPathTest.explorerLinks?.credit}`);
  }
  if (artifact.checks.happyPathTest.error) {
    console.log(`    Error: ${artifact.checks.happyPathTest.error}`);
  }

  // Determine overall status
  artifact.ok =
    artifact.checks.healthEndpoint.ok &&
    artifact.checks.relayerStatus.ok &&
    artifact.checks.chainId.ok &&
    artifact.checks.bytecodeVerification.router?.ok &&
    artifact.checks.bytecodeVerification.busdc?.ok &&
    artifact.checks.bytecodeVerification.perpAdapter?.ok &&
    artifact.checks.happyPathTest.ok;

  // Write artifacts
  console.log();
  console.log('='.repeat(80));
  console.log('Writing artifacts...');
  console.log('='.repeat(80));

  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  // Write latest artifact
  const artifactPath = path.join(logsDir, 'base-smoke-prod.json');
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  console.log(`✓ Artifact written to: ${artifactPath}`);

  // Write timestamped copy
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const timestampedPath = path.join(logsDir, `base-smoke-prod-${timestamp}.json`);
  fs.writeFileSync(timestampedPath, JSON.stringify(artifact, null, 2));
  console.log(`✓ Timestamped artifact: ${timestampedPath}`);

  console.log();
  console.log('='.repeat(80));
  console.log(`OVERALL STATUS: ${artifact.ok ? '✅ PASS' : '❌ FAIL'}`);
  console.log('='.repeat(80));

  process.exit(artifact.ok ? 0 : 1);
}

main().catch((error) => {
  console.error('[base-smoke-prod] Fatal error:', error);
  process.exit(1);
});
