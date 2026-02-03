#!/usr/bin/env node
/**
 * MVP capability probes: ETH testnet, Solana devnet, Stellar, adapters.
 * Read-only; loads agent/.env.local when run from repo root.
 * Exit non-zero only if a REQUIRED capability for MVP is missing.
 * Source: PRODUCTION_FIX_SUMMARY.md, MVP_FINALIZATION_PLAN.md.
 */
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const agentEnvPath = join(repoRoot, 'agent', '.env.local');

function loadAgentEnv() {
  if (!existsSync(agentEnvPath)) return;
  const raw = readFileSync(agentEnvPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}

const MVP_REQUIRED = [
  'EXECUTION_MODE',
  'EXECUTION_AUTH_MODE',
  'EXECUTION_ROUTER_ADDRESS',
  'DEMO_PERP_ADAPTER_ADDRESS',
  'DEMO_EVENT_ADAPTER_ADDRESS',
  'DEMO_USDC_ADDRESS',
  'RELAYER_PRIVATE_KEY',
  'ETH_TESTNET_RPC_URL',
  'BLOSSOM_MODEL_PROVIDER',
  'BLOSSOM_GEMINI_API_KEY',
];

const SOLANA_KEYS = ['SOLANA_RPC_URL', 'SOLANA_PRIVATE_KEY'];
const STELLAR_KEYS = ['STELLAR_HORIZON_URL', 'STELLAR_ANCHOR_URL', 'HORIZON_URL'];
const ADAPTER_KEYS = [
  'DEMO_PERP_ADAPTER_ADDRESS',
  'DEMO_EVENT_ADAPTER_ADDRESS',
  'MOCK_SWAP_ADAPTER_ADDRESS',
  'UNISWAP_V3_ADAPTER_ADDRESS',
  'WETH_WRAP_ADAPTER_ADDRESS',
];

loadAgentEnv();

let failed = false;
console.log('\n--- Blossom MVP capabilities ---\n');

const has = (key) => {
  const v = process.env[key];
  return v !== undefined && String(v).trim() !== '';
};

console.log('[Required for MVP]');
for (const key of MVP_REQUIRED) {
  const ok = has(key);
  if (!ok) failed = true;
  console.log(`  ${ok ? '✓' : '✗'} ${key}`);
}

console.log('\n[Solana devnet]');
const solanaRpc = has('SOLANA_RPC_URL');
const solanaKey = has('SOLANA_PRIVATE_KEY');
console.log(`  ${solanaRpc ? '✓' : '○'} SOLANA_RPC_URL ${solanaRpc ? '(configured)' : '(default devnet used if not set)'}`);
console.log(`  ${solanaKey ? '✓' : '○'} SOLANA_PRIVATE_KEY (signer) ${solanaKey ? 'present' : 'not set'}`);

console.log('\n[Stellar]');
const stellarUrls = STELLAR_KEYS.filter((k) => has(k));
if (stellarUrls.length) {
  stellarUrls.forEach((k) => console.log(`  ✓ ${k}`));
} else {
  console.log('  ○ No STELLAR_HORIZON_URL / STELLAR_ANCHOR_URL / HORIZON_URL set');
}

console.log('\n[Adapters registered]');
for (const key of ADAPTER_KEYS) {
  const ok = has(key);
  console.log(`  ${ok ? '✓' : '○'} ${key}`);
}

console.log('');
if (failed) {
  console.log('FAIL — required MVP capability missing. Set vars in agent/.env.local (see PRODUCTION_FIX_SUMMARY.md).\n');
  process.exit(1);
}
console.log('PASS — required capabilities present.\n');
process.exit(0);
