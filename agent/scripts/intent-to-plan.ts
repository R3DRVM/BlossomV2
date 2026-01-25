#!/usr/bin/env npx tsx
/**
 * Intent-to-Plan CLI Script
 *
 * Transforms natural language intent into an ExecutionPlan.
 * This is the core "Blossom as AI execution layer" primitive.
 *
 * Usage:
 *   npx tsx agent/scripts/intent-to-plan.ts \
 *     --intent "Wrap 0.001 ETH to WETH and supply to Aave" \
 *     --user 0x158Ef361B3e3ce4bf4a93a43EFc313c979fb4321 \
 *     --auth direct
 *
 * Output: JSON ExecutionPlan + Action list + calldata + required approvals
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { config } from 'dotenv';
import { parseArgs } from 'util';
import { encodeAbiParameters, parseUnits } from 'viem';

// Setup paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const agentDir = resolve(__dirname, '..');
const rootDir = resolve(agentDir, '..');

// Load environment
config({ path: resolve(agentDir, '.env.local') });
config({ path: resolve(rootDir, '.env.local') });

// Import config (after env loaded)
import {
  EXECUTION_ROUTER_ADDRESS,
  WETH_WRAP_ADAPTER_ADDRESS,
  WETH_ADDRESS_SEPOLIA,
  AAVE_ADAPTER_ADDRESS,
  AAVE_SEPOLIA_POOL_ADDRESS,
  AAVE_WETH_ADDRESS,
  ERC20_PULL_ADAPTER_ADDRESS,
  PROOF_ADAPTER_ADDRESS,
  ETH_TESTNET_RPC_URL,
  ETH_TESTNET_CHAIN_ID,
} from '../src/config';

// Import utilities
import { eth_call, padAddress, encodeCall, decodeUint256 } from '../src/executors/evmRpc';

// Action types from PlanTypes.sol
enum ActionType {
  SWAP = 0,
  WRAP = 1,
  PULL = 2,
  LEND_SUPPLY = 3,
  LEND_BORROW = 4,
  EVENT_BUY = 5,
  PROOF = 6,
}

interface Action {
  actionType: number;
  adapter: string;
  data: string;
}

interface ExecutionPlan {
  user: string;
  nonce: string;
  deadline: string;
  actions: Action[];
}

interface PlanResult {
  ok: boolean;
  intent: string;
  parsedIntent: {
    action: string;
    amount?: string;
    asset?: string;
    targetProtocol?: string;
    steps: string[];
  };
  plan: ExecutionPlan;
  call: {
    to: string;
    method: string;
    value: string;
  };
  approvals: Array<{
    token: string;
    spender: string;
    amount: string;
    description: string;
  }>;
  summary: string;
  warnings: string[];
  chainId: number;
}

/**
 * Parse natural language intent into structured intent
 */
function parseIntent(intent: string): {
  action: 'wrap' | 'supply' | 'wrap_and_supply' | 'swap' | 'proof';
  amount: string;
  asset: string;
  targetProtocol?: string;
  steps: string[];
} {
  const lower = intent.toLowerCase();

  // Pattern: "Wrap X ETH to WETH and supply to Aave"
  if (lower.includes('wrap') && lower.includes('supply') && lower.includes('aave')) {
    const amountMatch = intent.match(/(\d+\.?\d*)\s*ETH/i);
    const amount = amountMatch ? amountMatch[1] : '0.001';
    return {
      action: 'wrap_and_supply',
      amount,
      asset: 'ETH',
      targetProtocol: 'Aave V3',
      steps: [
        `1. Wrap ${amount} ETH to WETH via WethWrapAdapter`,
        `2. Pull WETH from user to router via ERC20PullAdapter`,
        `3. Supply WETH to Aave V3 Pool via AaveV3SupplyAdapter`,
      ],
    };
  }

  // Pattern: "Wrap X ETH to WETH"
  if (lower.includes('wrap') && !lower.includes('supply')) {
    const amountMatch = intent.match(/(\d+\.?\d*)\s*ETH/i);
    const amount = amountMatch ? amountMatch[1] : '0.001';
    return {
      action: 'wrap',
      amount,
      asset: 'ETH',
      steps: [`1. Wrap ${amount} ETH to WETH via WethWrapAdapter`],
    };
  }

  // Pattern: "Supply X WETH to Aave"
  if (lower.includes('supply') && lower.includes('aave')) {
    const amountMatch = intent.match(/(\d+\.?\d*)\s*WETH/i);
    const amount = amountMatch ? amountMatch[1] : '0.001';
    return {
      action: 'supply',
      amount,
      asset: 'WETH',
      targetProtocol: 'Aave V3',
      steps: [
        `1. Pull ${amount} WETH from user to router via ERC20PullAdapter`,
        `2. Supply WETH to Aave V3 Pool via AaveV3SupplyAdapter`,
      ],
    };
  }

  // Default: proof-of-execution (for unrecognized intents)
  return {
    action: 'proof',
    amount: '0',
    asset: 'N/A',
    steps: ['1. Record proof-of-execution on-chain'],
  };
}

/**
 * Fetch nonce from ExecutionRouter contract
 */
async function fetchNonce(userAddress: string): Promise<string> {
  if (!ETH_TESTNET_RPC_URL || !EXECUTION_ROUTER_ADDRESS) {
    return '0';
  }

  const functionSelector = '0x7ecebe00'; // nonces(address)
  const paddedAddr = padAddress(userAddress);
  const callData = encodeCall(functionSelector, paddedAddr.slice(2));

  try {
    const result = await eth_call(ETH_TESTNET_RPC_URL, EXECUTION_ROUTER_ADDRESS, callData);
    return decodeUint256(result);
  } catch (error) {
    console.error('Failed to fetch nonce, using 0:', error);
    return '0';
  }
}

/**
 * Build execution plan from parsed intent
 */
async function buildPlan(
  userAddress: string,
  parsedIntent: ReturnType<typeof parseIntent>,
  authMode: 'direct' | 'session'
): Promise<{
  plan: ExecutionPlan;
  approvals: PlanResult['approvals'];
  value: string;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const approvals: PlanResult['approvals'] = [];
  const actions: Action[] = [];
  let value = '0x0';

  // Fetch nonce
  const nonce = await fetchNonce(userAddress);

  // Set deadline: 10 minutes from now
  const deadline = Math.floor(Date.now() / 1000) + 10 * 60;

  // Build actions based on intent
  if (parsedIntent.action === 'wrap' || parsedIntent.action === 'wrap_and_supply') {
    // Validate adapters
    if (!WETH_WRAP_ADAPTER_ADDRESS) {
      throw new Error('WETH_WRAP_ADAPTER_ADDRESS not configured');
    }
    if (!WETH_ADDRESS_SEPOLIA) {
      throw new Error('WETH_ADDRESS_SEPOLIA not configured');
    }

    const wrapAmount = parseUnits(parsedIntent.amount, 18);

    // WRAP action: ETH -> WETH
    // For wrap_and_supply: WETH goes to router (so router can supply)
    // For wrap only: WETH goes to user
    const wrapRecipient = parsedIntent.action === 'wrap_and_supply'
      ? EXECUTION_ROUTER_ADDRESS!.toLowerCase()
      : userAddress.toLowerCase();

    const wrapData = encodeAbiParameters(
      [{ type: 'address' }],
      [wrapRecipient as `0x${string}`]
    );

    actions.push({
      actionType: ActionType.WRAP,
      adapter: WETH_WRAP_ADAPTER_ADDRESS.toLowerCase(),
      data: wrapData,
    });

    // Set ETH value for wrap
    value = '0x' + wrapAmount.toString(16);

    // If wrap_and_supply, add supply action
    if (parsedIntent.action === 'wrap_and_supply') {
      if (!AAVE_ADAPTER_ADDRESS) {
        throw new Error('AAVE_ADAPTER_ADDRESS not configured');
      }
      if (!AAVE_SEPOLIA_POOL_ADDRESS) {
        throw new Error('AAVE_SEPOLIA_POOL_ADDRESS not configured');
      }

      // LEND_SUPPLY action: supply WETH to Aave
      // AaveV3SupplyAdapter expects: (asset, pool, amount, onBehalfOf)
      const supplyData = encodeAbiParameters(
        [
          { type: 'address' }, // asset
          { type: 'address' }, // pool (ignored by adapter, uses constructor value)
          { type: 'uint256' }, // amount
          { type: 'address' }, // onBehalfOf
        ],
        [
          (AAVE_WETH_ADDRESS || WETH_ADDRESS_SEPOLIA).toLowerCase() as `0x${string}`,
          AAVE_SEPOLIA_POOL_ADDRESS.toLowerCase() as `0x${string}`,
          wrapAmount,
          userAddress.toLowerCase() as `0x${string}`,
        ]
      );

      actions.push({
        actionType: ActionType.LEND_SUPPLY,
        adapter: AAVE_ADAPTER_ADDRESS.toLowerCase(),
        data: supplyData,
      });

      // Router needs WETH allowance from itself (handled internally)
      // But we need user to approve router for the WETH if doing a PULL first
      // In wrap_and_supply, WETH is already in router from wrap, no PULL needed

      warnings.push(
        'Wrap+Supply: WETH will be deposited to router first, then supplied to Aave.'
      );
    }
  } else if (parsedIntent.action === 'supply') {
    // Supply existing WETH to Aave
    if (!AAVE_ADAPTER_ADDRESS || !AAVE_SEPOLIA_POOL_ADDRESS) {
      throw new Error('AAVE adapter addresses not configured');
    }
    if (!ERC20_PULL_ADAPTER_ADDRESS) {
      throw new Error('ERC20_PULL_ADAPTER_ADDRESS not configured');
    }

    const supplyAmount = parseUnits(parsedIntent.amount, 18);
    const wethAddress = (AAVE_WETH_ADDRESS || WETH_ADDRESS_SEPOLIA)!.toLowerCase();

    // PULL action: transfer WETH from user to router
    const pullData = encodeAbiParameters(
      [
        { type: 'address' }, // token
        { type: 'address' }, // from
        { type: 'uint256' }, // amount
      ],
      [
        wethAddress as `0x${string}`,
        userAddress.toLowerCase() as `0x${string}`,
        supplyAmount,
      ]
    );

    actions.push({
      actionType: ActionType.PULL,
      adapter: ERC20_PULL_ADAPTER_ADDRESS.toLowerCase(),
      data: pullData,
    });

    // LEND_SUPPLY action
    const supplyData = encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'address' },
      ],
      [
        wethAddress as `0x${string}`,
        AAVE_SEPOLIA_POOL_ADDRESS.toLowerCase() as `0x${string}`,
        supplyAmount,
        userAddress.toLowerCase() as `0x${string}`,
      ]
    );

    actions.push({
      actionType: ActionType.LEND_SUPPLY,
      adapter: AAVE_ADAPTER_ADDRESS.toLowerCase(),
      data: supplyData,
    });

    // User needs to approve router to pull WETH
    approvals.push({
      token: wethAddress,
      spender: EXECUTION_ROUTER_ADDRESS!.toLowerCase(),
      amount: supplyAmount.toString(),
      description: `Approve ExecutionRouter to transfer ${parsedIntent.amount} WETH`,
    });
  } else {
    // PROOF action for unrecognized intents
    if (!PROOF_ADAPTER_ADDRESS) {
      throw new Error('PROOF_ADAPTER_ADDRESS not configured');
    }

    // Create intent hash from intent string
    const intentBytes = new TextEncoder().encode(parsedIntent.steps.join(' | '));
    const intentHash = '0x' + Array.from(intentBytes.slice(0, 32))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    const proofData = encodeAbiParameters(
      [
        { type: 'address' }, // user
        { type: 'uint8' },   // venueType
        { type: 'bytes32' }, // intentHash
        { type: 'string' },  // summary
      ],
      [
        userAddress.toLowerCase() as `0x${string}`,
        0, // venueType: 0 for generic
        intentHash as `0x${string}`,
        'Intent recorded via CLI',
      ]
    );

    actions.push({
      actionType: ActionType.PROOF,
      adapter: PROOF_ADAPTER_ADDRESS.toLowerCase(),
      data: proofData,
    });

    warnings.push(
      'PROOF_ONLY: Intent not fully recognized. Recording proof-of-execution only.'
    );
  }

  return {
    plan: {
      user: userAddress.toLowerCase(),
      nonce,
      deadline: deadline.toString(),
      actions,
    },
    approvals,
    value,
    warnings,
  };
}

async function main() {
  console.log('\n🌸 Blossom Intent-to-Plan CLI\n');

  // Parse arguments
  const { values } = parseArgs({
    options: {
      intent: { type: 'string', short: 'i' },
      user: { type: 'string', short: 'u' },
      auth: { type: 'string', short: 'a', default: 'direct' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });

  if (values.help || !values.intent || !values.user) {
    console.log(`Usage:
  npx tsx agent/scripts/intent-to-plan.ts \\
    --intent "Wrap 0.001 ETH to WETH and supply to Aave" \\
    --user 0x... \\
    --auth direct|session

Options:
  --intent, -i   Natural language execution intent (required)
  --user, -u     User wallet address (required)
  --auth, -a     Auth mode: direct or session (default: direct)
  --help, -h     Show this help
`);
    process.exit(values.help ? 0 : 1);
  }

  const intent = values.intent;
  const userAddress = values.user;
  const authMode = values.auth as 'direct' | 'session';

  console.log(`Intent: "${intent}"`);
  console.log(`User:   ${userAddress}`);
  console.log(`Auth:   ${authMode}`);
  console.log(`Chain:  Sepolia (${ETH_TESTNET_CHAIN_ID})\n`);

  // Validate config
  if (!EXECUTION_ROUTER_ADDRESS) {
    console.error('❌ EXECUTION_ROUTER_ADDRESS not configured');
    process.exit(1);
  }

  // Parse intent
  console.log('📝 Parsing intent...');
  const parsedIntent = parseIntent(intent);
  console.log(`   Action: ${parsedIntent.action}`);
  console.log(`   Amount: ${parsedIntent.amount} ${parsedIntent.asset}`);
  if (parsedIntent.targetProtocol) {
    console.log(`   Target: ${parsedIntent.targetProtocol}`);
  }
  console.log(`   Steps:`);
  parsedIntent.steps.forEach(s => console.log(`     ${s}`));

  // Build plan
  console.log('\n🔧 Building execution plan...');
  const { plan, approvals, value, warnings } = await buildPlan(
    userAddress,
    parsedIntent,
    authMode
  );

  // Generate summary
  const summary = parsedIntent.action === 'wrap_and_supply'
    ? `Wrap ${parsedIntent.amount} ETH → WETH, supply to Aave V3 on Sepolia`
    : parsedIntent.action === 'wrap'
    ? `Wrap ${parsedIntent.amount} ETH → WETH on Sepolia`
    : parsedIntent.action === 'supply'
    ? `Supply ${parsedIntent.amount} WETH to Aave V3 on Sepolia`
    : 'Record proof-of-execution';

  // Build result
  const result: PlanResult = {
    ok: true,
    intent,
    parsedIntent: {
      action: parsedIntent.action,
      amount: parsedIntent.amount,
      asset: parsedIntent.asset,
      targetProtocol: parsedIntent.targetProtocol,
      steps: parsedIntent.steps,
    },
    plan,
    call: {
      to: EXECUTION_ROUTER_ADDRESS,
      method: 'executeBySender',
      value,
    },
    approvals,
    summary,
    warnings,
    chainId: ETH_TESTNET_CHAIN_ID,
  };

  // Output
  console.log('\n✅ Plan generated successfully!\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('EXECUTION PLAN JSON:');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(JSON.stringify(result, null, 2));

  // Print warnings
  if (warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    warnings.forEach(w => console.log(`   - ${w}`));
  }

  // Print approvals needed
  if (approvals.length > 0) {
    console.log('\n📋 Approvals Required:');
    approvals.forEach(a => {
      console.log(`   Token:   ${a.token}`);
      console.log(`   Spender: ${a.spender}`);
      console.log(`   Amount:  ${a.amount}`);
      console.log(`   Desc:    ${a.description}`);
      console.log();
    });
  }

  // Print execution command
  console.log('\n🚀 To execute this plan with cast:');
  console.log(`   cast send ${EXECUTION_ROUTER_ADDRESS} \\`);
  console.log(`     "executeBySender((address,uint256,uint256,(uint8,address,bytes)[]))" \\`);
  console.log(`     "(${plan.user},${plan.nonce},${plan.deadline},[(${plan.actions.map(a =>
    `${a.actionType},${a.adapter},${a.data}`
  ).join('),(')})])" \\`);
  console.log(`     --value ${parseInt(value, 16) || 0} \\`);
  console.log(`     --private-key $TEST_WALLET_PRIVATE_KEY`);

  return result;
}

main().catch(console.error);
