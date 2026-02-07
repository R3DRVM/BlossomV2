#!/usr/bin/env npx tsx
// @ts-nocheck
/**
 * Setup Relayer Approvals
 *
 * Approves demo tokens (bUSDC, WETH) to the ExecutionRouter contract
 * from the relayer wallet. Required for automated relayer execution.
 *
 * Usage:
 *   npx tsx agent/scripts/setup-relayer-approvals.ts
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  createWalletClient,
  createPublicClient,
  http,
  parseAbi,
  maxUint256,
  formatEther,
} from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const agentDir = resolve(__dirname, '..');

config({ path: resolve(agentDir, '.env.local') });
config({ path: resolve(agentDir, '.env') });

// ============================================
// Configuration
// ============================================

const RELAYER_PRIVATE_KEY = (process.env.RELAYER_PRIVATE_KEY || '').trim() as `0x${string}`;
const EXECUTION_ROUTER_ADDRESS = (process.env.EXECUTION_ROUTER_ADDRESS || '').trim() as `0x${string}`;
const DEMO_BUSDC_ADDRESS = (process.env.DEMO_BUSDC_ADDRESS || process.env.DEMO_USDC_ADDRESS || '').trim();
const DEMO_WETH_ADDRESS = (process.env.DEMO_WETH_ADDRESS || '').trim();
const ETH_TESTNET_RPC_URL = (process.env.ETH_TESTNET_RPC_URL || '').trim();

// ERC20 ABI for approve
const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
]);

// Colors
const colors = {
  reset: '\x1b[0m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

// ============================================
// Main Script
// ============================================

async function main() {
  console.log('');
  console.log(`${colors.blue}╔══════════════════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.blue}║                    RELAYER APPROVAL SETUP                               ║${colors.reset}`);
  console.log(`${colors.blue}╚══════════════════════════════════════════════════════════════════════════╝${colors.reset}`);
  console.log('');

  // Validate configuration
  if (!RELAYER_PRIVATE_KEY) {
    console.log(`${colors.red}ERROR: RELAYER_PRIVATE_KEY not set${colors.reset}`);
    process.exit(1);
  }
  if (!EXECUTION_ROUTER_ADDRESS) {
    console.log(`${colors.red}ERROR: EXECUTION_ROUTER_ADDRESS not set${colors.reset}`);
    process.exit(1);
  }
  if (!ETH_TESTNET_RPC_URL) {
    console.log(`${colors.red}ERROR: ETH_TESTNET_RPC_URL not set${colors.reset}`);
    process.exit(1);
  }

  // Create clients
  const account = privateKeyToAccount(RELAYER_PRIVATE_KEY);
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(ETH_TESTNET_RPC_URL),
  });
  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(ETH_TESTNET_RPC_URL),
  });

  console.log(`${colors.cyan}Configuration:${colors.reset}`);
  console.log(`  Relayer Address:  ${account.address}`);
  console.log(`  Router Address:   ${EXECUTION_ROUTER_ADDRESS}`);
  console.log(`  Network:          Sepolia`);
  console.log('');

  // Check ETH balance
  const ethBalance = await publicClient.getBalance({ address: account.address });
  console.log(`  ETH Balance:      ${formatEther(ethBalance)} ETH`);

  if (ethBalance === 0n) {
    console.log(`${colors.red}ERROR: Relayer has no ETH for gas. Fund it first!${colors.reset}`);
    process.exit(1);
  }
  console.log('');

  // Tokens to approve
  const tokens = [
    { name: 'bUSDC', address: DEMO_BUSDC_ADDRESS },
    { name: 'WETH', address: DEMO_WETH_ADDRESS },
  ].filter(t => t.address);

  if (tokens.length === 0) {
    console.log(`${colors.red}ERROR: No demo token addresses configured${colors.reset}`);
    process.exit(1);
  }

  console.log(`${colors.cyan}Tokens to Approve:${colors.reset}`);
  for (const token of tokens) {
    console.log(`  ${token.name}: ${token.address}`);
  }
  console.log('');

  // Approve each token
  for (const token of tokens) {
    console.log(`${colors.cyan}[${token.name}]${colors.reset} Checking allowance...`);

    try {
      // Check current allowance
      const currentAllowance = await publicClient.readContract({
        address: token.address as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [account.address, EXECUTION_ROUTER_ADDRESS],
      });

      // Check balance
      const balance = await publicClient.readContract({
        address: token.address as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [account.address],
      });

      console.log(`  Current Allowance: ${currentAllowance.toString()}`);
      console.log(`  Balance:           ${balance.toString()}`);

      if (currentAllowance >= maxUint256 / 2n) {
        console.log(`  ${colors.green}Already approved (max allowance)${colors.reset}`);
        console.log('');
        continue;
      }

      // Approve max
      console.log(`  Sending approve transaction...`);

      const hash = await walletClient.writeContract({
        address: token.address as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [EXECUTION_ROUTER_ADDRESS, maxUint256],
      });

      console.log(`  ${colors.green}Tx Hash: ${hash}${colors.reset}`);
      console.log(`  Waiting for confirmation...`);

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === 'success') {
        console.log(`  ${colors.green}SUCCESS: ${token.name} approved to router${colors.reset}`);
      } else {
        console.log(`  ${colors.red}FAILED: Transaction reverted${colors.reset}`);
      }
    } catch (error: any) {
      console.log(`  ${colors.red}ERROR: ${error.message}${colors.reset}`);
    }
    console.log('');
  }

  console.log(`${colors.green}╔══════════════════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.green}║                    RELAYER SETUP COMPLETE                               ║${colors.reset}`);
  console.log(`${colors.green}╚══════════════════════════════════════════════════════════════════════════╝${colors.reset}`);
  console.log('');
  console.log(`Next: Run live-execution-runner.ts to test automated executions`);
  console.log('');
}

main().catch(console.error);
