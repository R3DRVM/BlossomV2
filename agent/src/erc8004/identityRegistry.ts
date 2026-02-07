/**
 * ERC-8004 Identity Registry
 *
 * Handles agent identity registration and management via ERC-721 NFT.
 * Provides functions to:
 * - Register Blossom as an agent on-chain
 * - Retrieve agent identity
 * - Build ERC-8004 registration file
 */

import type { Address, Hash, Log } from 'viem';
import { encodeFunctionData, decodeEventLog, keccak256, toHex } from 'viem';
import {
  ERC8004_ENABLED,
  ERC8004_AGENT_ID,
  ERC8004_AGENT_URI,
  ERC8004_IDENTITY_REGISTRY_SEPOLIA,
  requireIdentityRegistry,
} from './config.js';
import type {
  AgentIdentity,
  AgentRegistrationFile,
  BlossomCapability,
  RegisterAgentParams,
  ERC8004ErrorCode,
} from './types.js';
import { ERC8004Error } from './types.js';
import { getBlossomCapabilities } from './validationRegistry.js';
import {
  getWalletClient,
  getPublicClient,
  getRelayerAddress,
  getRelayerAccount,
  estimateGasPrices,
  estimateContractGas,
  validateRelayerBalance,
  waitForTransaction,
  parseTransactionError,
  GAS_LIMITS,
} from './onchainClient.js';
import IdentityRegistryABI from './abis/IdentityRegistry.json' assert { type: 'json' };

// Chain ID for Sepolia testnet
const SEPOLIA_CHAIN_ID = 11155111;

// ============================================
// Agent Identity Management
// ============================================

/**
 * Get the current agent identity
 * Returns undefined if agent is not registered
 */
export function getAgentIdentity(): AgentIdentity | undefined {
  if (!ERC8004_ENABLED) {
    return undefined;
  }

  if (ERC8004_AGENT_ID === undefined) {
    return undefined;
  }

  const registryAddress = ERC8004_IDENTITY_REGISTRY_SEPOLIA;
  if (!registryAddress) {
    return undefined;
  }

  return {
    agentId: ERC8004_AGENT_ID,
    owner: process.env.RELAYER_ADDRESS as Address || '0x0000000000000000000000000000000000000000',
    agentURI: ERC8004_AGENT_URI,
    chainId: SEPOLIA_CHAIN_ID,
    registryAddress,
    fullyQualifiedId: `eip155:${SEPOLIA_CHAIN_ID}:${registryAddress}`,
  };
}

/**
 * Check if agent is registered
 */
export function isAgentRegistered(): boolean {
  return ERC8004_ENABLED && ERC8004_AGENT_ID !== undefined;
}

/**
 * Get the fully qualified agent ID
 * Format: "eip155:{chainId}:{registryAddress}"
 */
export function getFullyQualifiedAgentId(): string | undefined {
  const identity = getAgentIdentity();
  if (!identity) {
    return undefined;
  }
  return identity.fullyQualifiedId;
}

// ============================================
// Registration File Generation
// ============================================

/**
 * Build the ERC-8004 registration file (/.well-known/agent-registration.json)
 * This file is served at the agent URI and contains agent metadata
 */
export function buildBlossomRegistrationFile(): AgentRegistrationFile {
  const identity = getAgentIdentity();
  const capabilities = getBlossomCapabilities();

  const now = new Date().toISOString();
  const operatorAddress =
    (process.env.RELAYER_ADDRESS as Address) ||
    '0x0000000000000000000000000000000000000000';

  return {
    version: '1.0.0',
    name: 'Blossom Agent',
    description:
      'AI-powered DeFi execution agent supporting swaps, perpetuals, lending, and prediction markets on Ethereum and Solana.',
    agentId: identity?.fullyQualifiedId || `eip155:${SEPOLIA_CHAIN_ID}:unregistered`,
    operator: operatorAddress,
    chains: [SEPOLIA_CHAIN_ID], // Sepolia testnet only for now
    capabilities,
    reputationRegistry: ERC8004_IDENTITY_REGISTRY_SEPOLIA,
    validationRegistry: undefined, // Not deployed yet
    endpoints: {
      api: 'https://api.blossom.onl',
      health: 'https://api.blossom.onl/health',
      capabilities: 'https://api.blossom.onl/api/erc8004/capabilities',
      reputation: 'https://api.blossom.onl/api/erc8004/reputation',
    },
    metadata: {
      createdAt: now,
      updatedAt: now,
      website: 'https://blossom.onl',
      docs: 'https://docs.blossom.onl',
    },
  };
}

// ============================================
// On-Chain Registration
// ============================================

// ABI for the registerAgent function
const REGISTER_AGENT_ABI = IdentityRegistryABI.abi.find(
  (item: any) => item.type === 'function' && item.name === 'registerAgent'
);

// ABI for the AgentRegistered event
const AGENT_REGISTERED_EVENT = IdentityRegistryABI.abi.find(
  (item: any) => item.type === 'event' && item.name === 'AgentRegistered'
);

/**
 * Register Blossom as an agent on the ERC-8004 Identity Registry
 *
 * Performs on-chain registration by:
 * 1. Encoding the registerAgent call
 * 2. Estimating gas and validating balance
 * 3. Submitting transaction
 * 4. Waiting for confirmation and extracting token ID
 *
 * @param params Registration parameters
 * @returns Registered agent identity
 */
export async function registerBlossomAgent(
  params: RegisterAgentParams
): Promise<AgentIdentity> {
  // Validate configuration
  if (!ERC8004_ENABLED) {
    throw new ERC8004Error(
      'ERC-8004 is not enabled',
      'CONFIG_MISSING'
    );
  }

  const registryAddress = requireIdentityRegistry();

  // Check if already registered
  if (ERC8004_AGENT_ID !== undefined) {
    throw new ERC8004Error(
      `Agent already registered with ID: ${ERC8004_AGENT_ID}`,
      'REGISTRATION_FAILED',
      { existingAgentId: ERC8004_AGENT_ID.toString() }
    );
  }

  console.log(`[erc8004] Registering agent on-chain...`);
  console.log(`[erc8004] Registry: ${registryAddress}`);
  console.log(`[erc8004] Name: ${params.name}`);
  console.log(`[erc8004] URI: ${params.agentURI}`);

  try {
    const walletClient = getWalletClient();
    const publicClient = getPublicClient();
    const relayerAddress = getRelayerAddress();

    // Use relayer address as agent wallet if not specified
    const agentWallet = params.agentWallet || relayerAddress;

    // Encode the function call
    const data = encodeFunctionData({
      abi: IdentityRegistryABI.abi,
      functionName: 'registerAgent',
      args: [params.name, params.description, params.agentURI, agentWallet],
    });

    // Estimate gas
    const estimatedGas = await estimateContractGas({
      to: registryAddress,
      data,
    }).catch(() => GAS_LIMITS.REGISTER_AGENT);

    // Get gas prices
    const { maxFeePerGas, maxPriorityFeePerGas } = await estimateGasPrices();

    // Validate balance
    await validateRelayerBalance(estimatedGas, maxFeePerGas);

    console.log(`[erc8004] Estimated gas: ${estimatedGas}`);
    console.log(`[erc8004] Submitting registration transaction...`);

    // Send transaction
    const hash = await walletClient.sendTransaction({
      account: getRelayerAccount(),
      to: registryAddress,
      data,
      gas: estimatedGas,
      maxFeePerGas,
      maxPriorityFeePerGas,
      chain: null,
    });

    console.log(`[erc8004] Transaction submitted: ${hash}`);

    // Wait for confirmation
    const receipt = await waitForTransaction(hash);

    console.log(`[erc8004] Transaction confirmed in block ${receipt.blockNumber}`);

    // Extract token ID from AgentRegistered event
    const agentId = extractAgentIdFromReceipt(receipt.logs);

    if (agentId === undefined) {
      throw new ERC8004Error(
        'Failed to extract agent ID from transaction receipt',
        'REGISTRATION_FAILED',
        { transactionHash: hash }
      );
    }

    console.log(`[erc8004] Agent registered successfully with ID: ${agentId}`);
    console.log(`[erc8004] IMPORTANT: Add this to your .env file:`);
    console.log(`ERC8004_AGENT_ID=${agentId}`);

    // Return the new identity
    return {
      agentId,
      owner: relayerAddress,
      agentURI: params.agentURI,
      agentWallet,
      chainId: SEPOLIA_CHAIN_ID,
      registryAddress,
      fullyQualifiedId: `eip155:${SEPOLIA_CHAIN_ID}:${registryAddress}`,
      registeredAt: Math.floor(Date.now() / 1000),
    };
  } catch (error) {
    // Handle known error types
    if (error instanceof ERC8004Error) {
      throw error;
    }

    const parsedError = parseTransactionError(error);
    throw new ERC8004Error(
      `Registration failed: ${parsedError.message}`,
      'REGISTRATION_FAILED',
      { errorType: parsedError.type, originalError: String(error) }
    );
  }
}

/**
 * Extract agent ID from transaction receipt logs
 */
function extractAgentIdFromReceipt(logs: Log[]): bigint | undefined {
  for (const log of logs) {
    try {
      if (!AGENT_REGISTERED_EVENT) continue;

      const decoded = decodeEventLog({
        abi: IdentityRegistryABI.abi,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName === 'AgentRegistered') {
        const args = decoded.args as unknown as { tokenId: bigint };
        return args.tokenId;
      }
    } catch {
      // Not the event we're looking for, continue
    }
  }

  // Fallback: Try to extract from Transfer event (ERC-721 mint)
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: IdentityRegistryABI.abi,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName === 'Transfer') {
        const args = decoded.args as unknown as { from: Address; to: Address; tokenId: bigint };
        // Mint is Transfer from zero address
        if (args.from === '0x0000000000000000000000000000000000000000') {
          return args.tokenId;
        }
      }
    } catch {
      // Not the event we're looking for, continue
    }
  }

  return undefined;
}

/**
 * Check if relayer is already registered on-chain
 */
export async function checkOnchainRegistration(): Promise<{
  isRegistered: boolean;
  agentId?: bigint;
}> {
  if (!ERC8004_IDENTITY_REGISTRY_SEPOLIA) {
    return { isRegistered: false };
  }

  try {
    const publicClient = getPublicClient();
    const relayerAddress = getRelayerAddress();

    // Call isRegistered on the registry
    const isRegistered = await publicClient.readContract({
      address: ERC8004_IDENTITY_REGISTRY_SEPOLIA,
      abi: IdentityRegistryABI.abi,
      functionName: 'isRegistered',
      args: [relayerAddress],
    }) as boolean;

    if (!isRegistered) {
      return { isRegistered: false };
    }

    // Get agent ID
    const agentId = await publicClient.readContract({
      address: ERC8004_IDENTITY_REGISTRY_SEPOLIA,
      abi: IdentityRegistryABI.abi,
      functionName: 'getAgentByOwner',
      args: [relayerAddress],
    }) as bigint;

    return { isRegistered: true, agentId };
  } catch (error) {
    console.warn(`[erc8004] Failed to check on-chain registration: ${error}`);
    return { isRegistered: false };
  }
}

/**
 * Update agent URI on-chain
 */
export async function updateAgentURI(newURI: string): Promise<Hash> {
  if (!isAgentRegistered()) {
    throw new ERC8004Error(
      'Agent is not registered',
      'NOT_REGISTERED'
    );
  }

  const registryAddress = requireIdentityRegistry();
  const agentId = ERC8004_AGENT_ID;

  if (agentId === undefined) {
    throw new ERC8004Error(
      'Agent ID not configured',
      'CONFIG_MISSING'
    );
  }

  console.log(`[erc8004] Updating agent URI on-chain...`);
  console.log(`[erc8004] New URI: ${newURI}`);

  try {
    const walletClient = getWalletClient();

    // Encode the function call
    const data = encodeFunctionData({
      abi: IdentityRegistryABI.abi,
      functionName: 'updateAgentURI',
      args: [agentId, newURI],
    });

    // Estimate gas
    const estimatedGas = await estimateContractGas({
      to: registryAddress,
      data,
    }).catch(() => GAS_LIMITS.UPDATE_AGENT_URI);

    // Get gas prices
    const { maxFeePerGas, maxPriorityFeePerGas } = await estimateGasPrices();

    // Validate balance
    await validateRelayerBalance(estimatedGas, maxFeePerGas);

    // Send transaction
    const hash = await walletClient.sendTransaction({
      account: getRelayerAccount(),
      to: registryAddress,
      data,
      gas: estimatedGas,
      maxFeePerGas,
      maxPriorityFeePerGas,
      chain: null,
    });

    console.log(`[erc8004] URI update transaction: ${hash}`);

    // Wait for confirmation
    await waitForTransaction(hash);

    console.log(`[erc8004] Agent URI updated successfully`);
    return hash;
  } catch (error) {
    if (error instanceof ERC8004Error) {
      throw error;
    }

    const parsedError = parseTransactionError(error);
    throw new ERC8004Error(
      `URI update failed: ${parsedError.message}`,
      'REGISTRATION_FAILED',
      { errorType: parsedError.type, originalError: String(error) }
    );
  }
}

// ============================================
// Utility Functions
// ============================================

/**
 * Format agent ID for display
 */
export function formatAgentId(agentId: bigint): string {
  return `Agent #${agentId.toString()}`;
}

/**
 * Parse agent ID from string
 */
export function parseAgentId(idString: string): bigint | undefined {
  try {
    // Handle various formats: "123", "#123", "Agent #123"
    const cleaned = idString.replace(/^(agent\s*)?#?\s*/i, '');
    const parsed = BigInt(cleaned);
    return parsed >= 0n ? parsed : undefined;
  } catch {
    return undefined;
  }
}
