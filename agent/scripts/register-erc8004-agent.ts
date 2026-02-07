#!/usr/bin/env npx tsx
/**
 * ERC-8004 Agent Registration Script
 *
 * Registers Blossom as an agent on the ERC-8004 Identity Registry.
 *
 * Usage:
 *   npx tsx agent/scripts/register-erc8004-agent.ts
 *
 * Prerequisites:
 *   1. ERC-8004 registry contracts deployed to Sepolia
 *   2. RELAYER_PRIVATE_KEY configured with sufficient ETH for gas
 *   3. ERC8004_IDENTITY_REGISTRY_SEPOLIA set to registry address
 *
 * After registration, set ERC8004_AGENT_ID in your .env file.
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

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           ERC-8004 Agent Registration Script                 ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // Check configuration
  const {
    ERC8004_ENABLED,
    ERC8004_IDENTITY_REGISTRY_SEPOLIA,
    ERC8004_AGENT_ID,
    ERC8004_AGENT_URI,
    logERC8004Config,
    getBlossomCapabilities,
    getCapabilitySummary,
    buildBlossomRegistrationFile,
  } = await import('../src/erc8004/index.js');

  console.log('📋 Current Configuration:');
  console.log('');
  logERC8004Config();
  console.log('');

  // Check if already registered
  if (ERC8004_AGENT_ID !== undefined) {
    console.log(`✅ Agent already registered with ID: ${ERC8004_AGENT_ID}`);
    console.log('');
    console.log('To re-register, remove ERC8004_AGENT_ID from your .env file.');
    process.exit(0);
  }

  // Check prerequisites
  const issues: string[] = [];

  if (!process.env.ERC8004_IDENTITY_REGISTRY_SEPOLIA) {
    issues.push('ERC8004_IDENTITY_REGISTRY_SEPOLIA not set');
  }

  if (!process.env.RELAYER_PRIVATE_KEY) {
    issues.push('RELAYER_PRIVATE_KEY not set (required for signing registration tx)');
  }

  if (!process.env.ETH_TESTNET_RPC_URL) {
    issues.push('ETH_TESTNET_RPC_URL not set (required for Sepolia connection)');
  }

  if (issues.length > 0) {
    console.log('❌ Prerequisites not met:');
    issues.forEach((issue) => console.log(`   - ${issue}`));
    console.log('');
    console.log('Please configure the required environment variables and try again.');
    process.exit(1);
  }

  // Show capabilities that will be registered
  console.log('📦 Capabilities to be registered:');
  console.log('');
  console.log(getCapabilitySummary());
  console.log('');

  // Show registration file preview
  console.log('📄 Registration File Preview:');
  console.log('');
  const registrationFile = buildBlossomRegistrationFile();
  console.log(JSON.stringify(registrationFile, null, 2));
  console.log('');

  // Registration not yet implemented
  console.log('⚠️  On-chain registration requires ERC-8004 registry contracts to be deployed.');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Deploy ERC-8004 registry contracts to Sepolia');
  console.log('  2. Set ERC8004_IDENTITY_REGISTRY_SEPOLIA to the deployed address');
  console.log('  3. Run this script again to complete registration');
  console.log('');
  console.log('For now, you can test the integration locally:');
  console.log('  - GET /api/erc8004/capabilities - View declared capabilities');
  console.log('  - GET /api/erc8004/reputation - View reputation score from stats');
  console.log('  - GET /.well-known/agent-registration.json - View registration file');
  console.log('');

  // Manual registration instructions
  console.log('📝 Manual Registration (when registry is available):');
  console.log('');
  console.log('  1. Call registerAgent() on the Identity Registry contract:');
  console.log(`     - name: "Blossom Agent"`);
  console.log(`     - description: "${registrationFile.description}"`);
  console.log(`     - agentURI: "${ERC8004_AGENT_URI}"`);
  console.log('');
  console.log('  2. Note the minted token ID from the transaction receipt');
  console.log('');
  console.log('  3. Add to your .env file:');
  console.log('     ERC8004_AGENT_ID=<token_id>');
  console.log('');

  process.exit(0);
}

main().catch((error) => {
  console.error('Registration failed:', error);
  process.exit(1);
});
