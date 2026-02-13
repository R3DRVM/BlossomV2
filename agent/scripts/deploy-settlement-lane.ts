#!/usr/bin/env npx tsx
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type SettlementChain = 'base_sepolia' | 'sepolia';

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function normalizeChain(raw: string | undefined): SettlementChain {
  const value = String(raw || '').trim().toLowerCase();
  if (value.includes('base')) return 'base_sepolia';
  return 'sepolia';
}

function runCommand(cmd: string, args: string[], cwd: string, env?: Record<string, string>): string {
  const result = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...(env || {}) },
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  const combined = `${result.stdout || ''}${result.stderr || ''}`;
  if (combined.trim().length > 0) {
    process.stdout.write(combined);
  }
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed with exit code ${result.status}`);
  }
  return combined;
}

function runCommandQuiet(cmd: string, args: string[], cwd: string, env?: Record<string, string>): string {
  const result = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...(env || {}) },
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  const combined = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed with exit code ${result.status}`);
  }
  return combined;
}

function parseDeployOutput(output: string): Record<string, `0x${string}`> {
  const map: Record<string, `0x${string}`> = {};
  const regex = /ENV:([A-Z0-9_]+)\s+(0x[a-fA-F0-9]{40})/g;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(output)) !== null) {
    map[match[1]] = match[2] as `0x${string}`;
  }
  return map;
}

function getCode(rpcUrl: string, address: string): string {
  return runCommandQuiet('cast', ['code', address, '--rpc-url', rpcUrl], process.cwd()).trim();
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, ms));
}

function getCodeWithRetry(rpcUrl: string, address: string, maxTimeoutMs = 60_000): string {
  const startTime = Date.now();
  let attempt = 0;
  let lastCodeLength = 0;
  let backoffMs = 750;

  console.log(`[verify] Checking bytecode at ${address}...`);

  while (Date.now() - startTime < maxTimeoutMs) {
    attempt += 1;
    try {
      const code = getCode(rpcUrl, address);
      lastCodeLength = code === '0x' ? 0 : (code.length - 2) / 2;

      if (code !== '0x') {
        const elapsedMs = Date.now() - startTime;
        console.log(`[verify] ✓ ${address} - code present (${lastCodeLength} bytes, ${attempt} attempts, ${elapsedMs}ms)`);
        return code;
      }
    } catch (error) {
      // Retry transient RPC or provider throttling failures.
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (attempt === 1 || attempt % 3 === 0) {
        console.log(`[verify] ${address} - attempt ${attempt} failed: ${errorMsg.slice(0, 80)}`);
      }
    }

    if (Date.now() - startTime + backoffMs < maxTimeoutMs) {
      sleepSync(backoffMs);
      backoffMs = Math.min(1500, backoffMs + 250); // Exponential backoff up to 1500ms
    } else {
      break;
    }
  }

  const elapsedMs = Date.now() - startTime;
  console.log(`[verify] ✗ ${address} - NO CODE after ${attempt} attempts, ${elapsedMs}ms (last code length: ${lastCodeLength})`);
  return '0x';
}

function castCall(rpcUrl: string, to: string, signature: string, args: string[] = []): string {
  return runCommandQuiet('cast', ['call', to, signature, ...args, '--rpc-url', rpcUrl], process.cwd()).trim();
}

function castCallWithRetry(rpcUrl: string, to: string, signature: string, args: string[] = [], retries = 6): string {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return castCall(rpcUrl, to, signature, args);
    } catch (error) {
      if (attempt >= retries) {
        throw error;
      }
      sleepSync(900 + attempt * 250);
    }
  }
  throw new Error(`cast call failed for ${signature}`);
}

function main() {
  const repoRoot = path.resolve(__dirname, '../..');
  const contractsDir = path.resolve(repoRoot, 'contracts');
  const logsDir = path.resolve(repoRoot, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  const chain = normalizeChain(arg('chain') || process.env.SETTLEMENT_CHAIN_OVERRIDE || process.env.DEFAULT_SETTLEMENT_CHAIN);
  const isBase = chain === 'base_sepolia';
  const rpcUrl =
    arg('rpc-url') ||
    (isBase ? process.env.BASE_SEPOLIA_RPC_URL : process.env.ETH_TESTNET_RPC_URL) ||
    '';
  const privateKey =
    arg('private-key') ||
    (isBase ? process.env.RELAYER_PRIVATE_KEY_BASE_SEPOLIA : process.env.RELAYER_PRIVATE_KEY) ||
    process.env.RELAYER_PRIVATE_KEY ||
    '';

  if (!rpcUrl) {
    throw new Error(`Missing RPC URL for ${chain}. Set --rpc-url or env (${isBase ? 'BASE_SEPOLIA_RPC_URL' : 'ETH_TESTNET_RPC_URL'}).`);
  }
  if (!privateKey) {
    throw new Error(`Missing private key for ${chain}. Set --private-key or env (${isBase ? 'RELAYER_PRIVATE_KEY_BASE_SEPOLIA' : 'RELAYER_PRIVATE_KEY'}).`);
  }

  const settleWethAddress =
    arg('weth-address') ||
    (isBase ? process.env.DEMO_WETH_ADDRESS_BASE_SEPOLIA : process.env.DEMO_WETH_ADDRESS) ||
    '';
  const aavePoolAddress = arg('aave-pool') || process.env.AAVE_V3_POOL_ADDRESS || '';

  const deployEnv: Record<string, string> = {};
  if (/^0x[a-fA-F0-9]{40}$/.test(settleWethAddress)) {
    deployEnv.SETTLEMENT_WETH_ADDRESS = settleWethAddress;
  }
  if (/^0x[a-fA-F0-9]{40}$/.test(aavePoolAddress)) {
    deployEnv.AAVE_V3_POOL_ADDRESS = aavePoolAddress;
  }

  const forgeArgs = [
    'script',
    'script/DeploySettlementLane.s.sol:DeploySettlementLane',
    '--rpc-url',
    rpcUrl,
    '--private-key',
    privateKey,
    '--broadcast',
    '-vvvv',
  ];

  console.log(`[deploy-settlement-lane] chain=${chain} rpc=${rpcUrl.slice(0, 32)}...`);
  const output = runCommand('forge', forgeArgs, contractsDir, deployEnv);
  const deployed = parseDeployOutput(output);

  const requiredKeys = [
    'EXECUTION_ROUTER_ADDRESS',
    'DEMO_BUSDC_ADDRESS',
    'DEMO_PERP_ADAPTER_ADDRESS',
    'DEMO_PERP_ENGINE_ADDRESS',
    'DEMO_EVENT_ADAPTER_ADDRESS',
  ];
  for (const key of requiredKeys) {
    if (!deployed[key]) {
      throw new Error(`Deployment output missing ${key}`);
    }
  }

  // Contract code + minimal read assertions
  const verification: Record<string, any> = {};
  const checkAddresses = Object.values(deployed);
  for (const address of checkAddresses) {
    const code = getCodeWithRetry(rpcUrl, address);
    verification[address] = {
      codePresent: code !== '0x',
      codeSize: code === '0x' ? 0 : (code.length - 2) / 2,
    };
    if (code === '0x') {
      throw new Error(`Contract code missing at ${address}`);
    }
  }

  const ownerAddress = runCommand('cast', ['wallet', 'address', '--private-key', privateKey], process.cwd()).trim();
  const router = deployed.EXECUTION_ROUTER_ADDRESS;
  const busdc = deployed.DEMO_BUSDC_ADDRESS;
  const perpAdapter = deployed.DEMO_PERP_ADAPTER_ADDRESS;

  const reads = {
    ownerAddress,
    busdcDecimals: castCallWithRetry(rpcUrl, busdc, 'decimals()(uint8)'),
    busdcBalanceRouter: castCallWithRetry(rpcUrl, busdc, 'balanceOf(address)(uint256)', [router]),
    busdcAllowanceOwnerPerp: castCallWithRetry(rpcUrl, busdc, 'allowance(address,address)(uint256)', [ownerAddress, perpAdapter]),
    routerPerpAllowed: castCallWithRetry(rpcUrl, router, 'isAdapterAllowed(address)(bool)', [perpAdapter]),
    perpAdapterEngine: castCallWithRetry(rpcUrl, perpAdapter, 'perpEngine()(address)'),
  };

  const now = new Date().toISOString().replace(/[:.]/g, '-');
  const artifact = {
    generatedAt: new Date().toISOString(),
    chain,
    rpcUrl,
    deployer: ownerAddress,
    deployed,
    verification,
    reads,
    expectedEnv: isBase
      ? {
          BUSDC_ADDRESS_BASE_SEPOLIA: deployed.DEMO_BUSDC_ADDRESS,
          EXECUTION_ROUTER_ADDRESS_BASE_SEPOLIA: deployed.EXECUTION_ROUTER_ADDRESS,
          DEMO_PERP_ADAPTER_ADDRESS_BASE_SEPOLIA: deployed.DEMO_PERP_ADAPTER_ADDRESS,
          DEMO_EVENT_ADAPTER_ADDRESS_BASE_SEPOLIA: deployed.DEMO_EVENT_ADAPTER_ADDRESS,
          DEMO_WETH_ADDRESS_BASE_SEPOLIA: deployed.DEMO_WETH_ADDRESS,
          ROUTER_ADDRESS_BASE_SEPOLIA: deployed.DEMO_SWAP_ROUTER_ADDRESS,
        }
      : {
          DEMO_BUSDC_ADDRESS: deployed.DEMO_BUSDC_ADDRESS,
          EXECUTION_ROUTER_ADDRESS: deployed.EXECUTION_ROUTER_ADDRESS,
          DEMO_PERP_ADAPTER_ADDRESS: deployed.DEMO_PERP_ADAPTER_ADDRESS,
          DEMO_EVENT_ADAPTER_ADDRESS: deployed.DEMO_EVENT_ADAPTER_ADDRESS,
          DEMO_WETH_ADDRESS: deployed.DEMO_WETH_ADDRESS,
          DEMO_SWAP_ROUTER_ADDRESS: deployed.DEMO_SWAP_ROUTER_ADDRESS,
        },
  };

  const chainArtifact = path.resolve(logsDir, `${chain}-deploy-${now}.json`);
  fs.writeFileSync(chainArtifact, JSON.stringify(artifact, null, 2));
  if (isBase) {
    const baseArtifact = path.resolve(logsDir, 'base-sepolia-deploy.json');
    fs.writeFileSync(baseArtifact, JSON.stringify(artifact, null, 2));
  }

  console.log('\n[deploy-settlement-lane] Deployment artifact written:');
  console.log(chainArtifact);
  if (isBase) {
    console.log(path.resolve(logsDir, 'base-sepolia-deploy.json'));
  }

  console.log('\n[deploy-settlement-lane] Required Vercel env wiring:');
  const envMap = artifact.expectedEnv as Record<string, string>;
  for (const [key, value] of Object.entries(envMap)) {
    console.log(`${key}=${value}`);
  }
}

main();
