#!/usr/bin/env npx tsx
/**
 * RPC Failover Test Script
 *
 * Tests that the RPC failover mechanism properly handles 429 rate limit errors
 * and switches to fallback endpoints.
 *
 * Usage:
 *   cd agent && npx tsx scripts/test-rpc-failover.ts
 *
 * Expected behavior:
 *   1. Sends rapid requests to trigger rate limiting on primary
 *   2. Observes failover to fallback endpoint
 *   3. Confirms requests succeed via fallback
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment
config({ path: resolve(__dirname, '../.env.local') });

import {
  initRpcProvider,
  createFailoverPublicClient,
  getProviderHealthStatus,
  resetAllCircuits,
  getCurrentActiveUrl,
  executeRpcWithFailover,
} from '../src/providers/rpcProvider';

const ETH_TESTNET_RPC_URL = process.env.ETH_TESTNET_RPC_URL;
const ALCHEMY_RPC_URL = process.env.ALCHEMY_RPC_URL;
const INFURA_RPC_URL = process.env.INFURA_RPC_URL;

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  RPC Failover Test                                                          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  // Check configuration
  console.log('Configuration:');
  console.log(`  Primary RPC:    ${ETH_TESTNET_RPC_URL ? maskUrl(ETH_TESTNET_RPC_URL) : '(not set)'}`);
  console.log(`  Alchemy:        ${ALCHEMY_RPC_URL ? maskUrl(ALCHEMY_RPC_URL) : '(not set)'}`);
  console.log(`  Infura:         ${INFURA_RPC_URL ? maskUrl(INFURA_RPC_URL) : '(not set)'}`);
  console.log('');

  if (!ETH_TESTNET_RPC_URL) {
    console.error('ERROR: ETH_TESTNET_RPC_URL not set in agent/.env.local');
    process.exit(1);
  }

  // Initialize provider with fallbacks
  const fallbacks: string[] = [];
  if (ALCHEMY_RPC_URL && !ETH_TESTNET_RPC_URL.includes('alchemy')) {
    fallbacks.push(ALCHEMY_RPC_URL);
  }
  if (INFURA_RPC_URL && !ETH_TESTNET_RPC_URL.includes('infura')) {
    fallbacks.push(INFURA_RPC_URL);
  }
  // Add public RPC as last resort
  fallbacks.push('https://rpc.sepolia.org');

  console.log(`Initializing with ${1 + fallbacks.length} endpoints...`);
  initRpcProvider(ETH_TESTNET_RPC_URL, fallbacks);
  console.log('');

  // Reset any previous circuit breaker state
  resetAllCircuits();

  // Test 1: Basic connectivity
  console.log('Test 1: Basic RPC connectivity');
  console.log('─────────────────────────────────────────');
  try {
    const blockNumber = await executeRpcWithFailover('eth_blockNumber', []);
    console.log(`  ✓ Current block: ${parseInt(blockNumber, 16)}`);
    console.log(`  ✓ Active endpoint: ${maskUrl(getCurrentActiveUrl() || 'unknown')}`);
  } catch (error: any) {
    console.log(`  ✗ Failed: ${error.message}`);
  }
  console.log('');

  // Test 2: Rapid requests to potentially trigger rate limit
  console.log('Test 2: Rapid requests (may trigger rate limit)');
  console.log('─────────────────────────────────────────');
  const requestCount = 20;
  let successCount = 0;
  let failCount = 0;
  const endpointUsed = new Map<string, number>();

  for (let i = 0; i < requestCount; i++) {
    try {
      await executeRpcWithFailover('eth_blockNumber', []);
      successCount++;
      const active = getCurrentActiveUrl() || 'unknown';
      endpointUsed.set(active, (endpointUsed.get(active) || 0) + 1);
      process.stdout.write('.');
    } catch (error) {
      failCount++;
      process.stdout.write('x');
    }
    // Small delay to observe behavior
    await new Promise(r => setTimeout(r, 50));
  }
  console.log('');
  console.log(`  Success: ${successCount}/${requestCount}`);
  console.log(`  Failures: ${failCount}/${requestCount}`);
  console.log('  Endpoints used:');
  for (const [url, count] of endpointUsed.entries()) {
    console.log(`    - ${maskUrl(url)}: ${count} requests`);
  }
  console.log('');

  // Test 3: Check health status
  console.log('Test 3: Provider health status');
  console.log('─────────────────────────────────────────');
  const status = getProviderHealthStatus();
  console.log(`  Active: ${status.active || 'none'}`);
  if (status.primary) {
    console.log(`  Primary: ${status.primary.url}`);
    console.log(`    - Healthy: ${status.primary.healthy}`);
    console.log(`    - Circuit Open: ${status.primary.circuitOpen}`);
    if (status.primary.rateLimitedUntil > Date.now()) {
      const remaining = Math.ceil((status.primary.rateLimitedUntil - Date.now()) / 1000);
      console.log(`    - Rate Limited: ${remaining}s remaining`);
    }
  }
  for (const fb of status.fallbacks) {
    console.log(`  Fallback: ${fb.url}`);
    console.log(`    - Healthy: ${fb.healthy}`);
    console.log(`    - Circuit Open: ${fb.circuitOpen}`);
    if (fb.rateLimitedUntil > Date.now()) {
      const remaining = Math.ceil((fb.rateLimitedUntil - Date.now()) / 1000);
      console.log(`    - Rate Limited: ${remaining}s remaining`);
    }
  }
  console.log('');

  // Test 4: Create and use viem client
  console.log('Test 4: Viem client with failover transport');
  console.log('─────────────────────────────────────────');
  try {
    const publicClient = createFailoverPublicClient();
    const block = await publicClient.getBlockNumber();
    console.log(`  ✓ getBlockNumber(): ${block}`);

    const balance = await publicClient.getBalance({
      address: '0x75B0406fFBcFCA51f8606FbbA340FB52A402f3e0', // Demo relayer
    });
    console.log(`  ✓ getBalance(): ${(Number(balance) / 1e18).toFixed(6)} ETH`);

    console.log(`  ✓ Active endpoint: ${maskUrl(getCurrentActiveUrl() || 'unknown')}`);
  } catch (error: any) {
    console.log(`  ✗ Failed: ${error.message}`);
  }
  console.log('');

  // Summary
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  Summary                                                                    ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
  if (successCount === requestCount) {
    console.log('✓ All requests succeeded');
  } else if (successCount > 0) {
    console.log(`⚠ ${successCount}/${requestCount} requests succeeded (some failover occurred)`);
  } else {
    console.log('✗ All requests failed - check RPC configuration');
  }

  if (endpointUsed.size > 1) {
    console.log('✓ Failover occurred - multiple endpoints were used');
  } else if (endpointUsed.size === 1) {
    console.log('ℹ No failover needed - single endpoint handled all requests');
  }

  console.log('');
  console.log('Done.');
}

function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.length > 20) {
      parsed.pathname = parsed.pathname.substring(0, 10) + '...[masked]';
    }
    parsed.search = '';
    return parsed.toString();
  } catch {
    return url.substring(0, 30) + '...';
  }
}

main().catch(console.error);
