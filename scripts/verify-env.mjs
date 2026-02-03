#!/usr/bin/env node
/**
 * Env verification for Blossom MVP deployment.
 * Reads agent/.env.local when present; checks required vars for backend + frontend.
 * Source of truth: PRODUCTION_FIX_SUMMARY.md, MVP_FINALIZATION_PLAN.md
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

const BACKEND_REQUIRED = [
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

const BACKEND_OPTIONAL = ['WETH_WRAP_ADAPTER_ADDRESS'];

const FRONTEND_OPTIONAL = ['VITE_AGENT_BASE_URL', 'VITE_AGENT_API_URL', 'VITE_BACKEND_URL'];

function check(scope, required, optional) {
  const missing = [];
  const blank = [];
  const present = [];
  for (const key of required) {
    const v = process.env[key];
    if (v === undefined) missing.push(key);
    else if (String(v).trim() === '') blank.push(key);
    else present.push(key);
  }
  for (const key of optional) {
    const v = process.env[key];
    if (v !== undefined && String(v).trim() !== '') present.push(key + ' (optional)');
    else if (v !== undefined) blank.push(key + ' (optional)');
  }
  return { scope, missing, blank, present };
}

function run(agentOnly = false, webOnly = false) {
  loadAgentEnv();

  const results = [];
  if (!webOnly) {
    results.push(check('backend (agent)', BACKEND_REQUIRED, BACKEND_OPTIONAL));
  }
  if (!agentOnly) {
    results.push(check('frontend (web)', [], FRONTEND_OPTIONAL));
  }

  let failed = false;
  console.log('\n--- Blossom env verification ---\n');

  for (const { scope, missing, blank, present } of results) {
    console.log(`[${scope}]`);
    if (missing.length) {
      failed = true;
      console.log('  MISSING (required):', missing.join(', '));
    }
    if (blank.length) {
      failed = true;
      console.log('  BLANK (set but empty):', blank.join(', '));
    }
    if (present.length) console.log('  OK:', present.join(', '));
    console.log('');
  }

  if (failed) {
    console.log('FAIL — fix missing/blank vars and re-run. See PRODUCTION_FIX_SUMMARY.md\n');
    process.exit(1);
  }
  console.log('PASS — required env vars present.\n');
  process.exit(0);
}

const agentOnly = process.argv.includes('--agent-only');
const webOnly = process.argv.includes('--web-only');
run(agentOnly, webOnly);
