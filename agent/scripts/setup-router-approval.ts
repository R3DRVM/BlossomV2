#!/usr/bin/env tsx
/**
 * Setup Router Approval Script
 * Helps users approve ExecutionRouter to spend bUSDC for session-mode executions
 */

import { createPublicClient, createWalletClient, http, parseUnits, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { EXECUTION_ROUTER_ADDRESS, DEMO_REDACTED_ADDRESS, ETH_TESTNET_RPC_URL } from '../src/config';

const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

async function main() {
  // Get user private key from args or env
  const userPrivateKey = process.argv[2] || process.env.USER_PRIVATE_KEY;

  if (!userPrivateKey) {
    console.error('Usage: tsx scripts/setup-router-approval.ts <user-private-key>');
    console.error('   Or: USER_PRIVATE_KEY=0x... tsx scripts/setup-router-approval.ts');
    process.exit(1);
  }

  if (!EXECUTION_ROUTER_ADDRESS || !DEMO_REDACTED_ADDRESS || !ETH_TESTNET_RPC_URL) {
    console.error('Missing required config: EXECUTION_ROUTER_ADDRESS, DEMO_REDACTED_ADDRESS, ETH_TESTNET_RPC_URL');
    process.exit(1);
  }

  const account = privateKeyToAccount(userPrivateKey as `0x${string}`);
  console.log('User address:', account.address);
  console.log('ExecutionRouter:', EXECUTION_ROUTER_ADDRESS);
  console.log('bUSDC:', DEMO_REDACTED_ADDRESS);

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(ETH_TESTNET_RPC_URL),
  });

  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(ETH_TESTNET_RPC_URL),
  });

  // Check current balance
  const balance = await publicClient.readContract({
    address: DEMO_REDACTED_ADDRESS as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });

  console.log('\nCurrent bUSDC balance:', formatUnits(balance, 6), 'USDC');

  // Check current allowance
  const currentAllowance = await publicClient.readContract({
    address: DEMO_REDACTED_ADDRESS as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account.address, EXECUTION_ROUTER_ADDRESS as `0x${string}`],
  });

  console.log('Current allowance:', formatUnits(currentAllowance, 6), 'USDC');

  if (currentAllowance > 0n) {
    console.log('\n✅ Approval already exists!');
    console.log('If you want to increase it, run this script again with --reset');
    return;
  }

  // Approve max amount (type(uint256).max)
  const maxUint256 = BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935');
  const approvalAmount = maxUint256;

  console.log('\nApproving ExecutionRouter to spend bUSDC...');
  console.log('Amount: UNLIMITED (type(uint256).max)');

  const hash = await walletClient.writeContract({
    address: DEMO_REDACTED_ADDRESS as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [EXECUTION_ROUTER_ADDRESS as `0x${string}`, approvalAmount],
  });

  console.log('Transaction sent:', hash);
  console.log('Waiting for confirmation...');

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status === 'success') {
    console.log('\n✅ Approval successful!');
    console.log('Block:', receipt.blockNumber);
    console.log('Gas used:', receipt.gasUsed.toString());

    // Verify new allowance
    const newAllowance = await publicClient.readContract({
      address: DEMO_REDACTED_ADDRESS as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [account.address, EXECUTION_ROUTER_ADDRESS as `0x${string}`],
    });

    console.log('New allowance:', newAllowance === maxUint256 ? 'UNLIMITED' : formatUnits(newAllowance, 6) + ' USDC');
    console.log('\n🎉 You can now execute transactions in session mode!');
  } else {
    console.error('\n❌ Approval failed!');
    console.error('Receipt:', receipt);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
