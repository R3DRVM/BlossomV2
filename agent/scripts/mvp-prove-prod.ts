#!/usr/bin/env npx tsx
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

type StressSummary = {
  mode: string;
  sessions: number;
  sessionsOk: number;
  sessionsFail: number;
  actionsOk: number;
  actionsFail: number;
  actionsSkipped: number;
  successPct: number;
  failureBreakdown: Record<string, number>;
};

type ActionResult = {
  category: string;
  status: 'ok' | 'fail' | 'skipped';
  error?: string;
};

type SessionResult = {
  sessionId: string;
  actions: ActionResult[];
};

type CrossChainProof = {
  sessionId: string;
  agentId: string;
  originWallet: string;
  routeType: string;
  fromChain?: string;
  toChain: string;
  creditTxHash: string;
  executionTxHash: string;
  creditReceiptConfirmed?: boolean;
  executionReceiptConfirmed?: boolean;
};

type StressOutput = {
  runId: string;
  mode: string;
  summary: StressSummary;
  results: SessionResult[];
  crossChainProofs?: CrossChainProof[];
};

const BASE_URL = process.env.STRESS_PROD_BASE_URL || 'https://api.blossom.onl';
const COUNT = parseInt(process.env.STRESS_PROVE_COUNT || '10', 10);
const CONCURRENCY = parseInt(process.env.STRESS_PROVE_CONCURRENCY || '2', 10);
const logsDir = path.resolve(process.cwd(), 'logs');
const runStamp = new Date().toISOString().replace(/[:.]/g, '-');
const rawOutputPath = path.join(logsDir, `stress-tier1-crosschain-required-${runStamp}.json`);
const reportPath = path.join(logsDir, 'mvp-prove-report.json');

function runStressSuite(): Promise<number> {
  const args = [
    'tsx',
    'agent/scripts/live-stress-tester.ts',
    `--baseUrl=${BASE_URL}`,
    '--mode=tier1_crosschain_required',
    '--allow_execute',
    `--count=${COUNT}`,
    `--concurrency=${CONCURRENCY}`,
    `--output=${rawOutputPath}`,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn('npx', args, {
      stdio: 'inherit',
      env: process.env,
      cwd: process.cwd(),
    });
    proc.on('error', reject);
    proc.on('exit', (code) => resolve(code ?? 1));
  });
}

function assertHash(value: string | undefined): boolean {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value);
}

async function main() {
  fs.mkdirSync(logsDir, { recursive: true });

  const exitCode = await runStressSuite();
  let parsed: StressOutput | null = null;
  if (fs.existsSync(rawOutputPath)) {
    parsed = JSON.parse(fs.readFileSync(rawOutputPath, 'utf8')) as StressOutput;
  }

  const summary: StressSummary = parsed?.summary || {
    mode: 'tier1_crosschain_required',
    sessions: 0,
    sessionsOk: 0,
    sessionsFail: 0,
    actionsOk: 0,
    actionsFail: 0,
    actionsSkipped: 0,
    successPct: 0,
    failureBreakdown: {},
  };
  const results = Array.isArray(parsed?.results) ? parsed!.results : [];
  const proofs = ((parsed?.crossChainProofs || []) as CrossChainProof[]).filter((proof) =>
    proof.routeType === 'testnet_credit' &&
    String(proof.toChain || '').toLowerCase() === 'sepolia' &&
    assertHash(proof.creditTxHash) &&
    assertHash(proof.executionTxHash) &&
    proof.creditReceiptConfirmed === true &&
    proof.executionReceiptConfirmed === true
  );

  const crossChainActions = results.flatMap((session) =>
    (session.actions || []).filter((action) => action.category === 'cross_chain_route')
  );
  const skippedCrossChain = crossChainActions.filter((action) => action.status === 'skipped').length;
  const proofOnlyViolations = crossChainActions.filter((action) =>
    String(action.error || '').toLowerCase().includes('proof-only')
  ).length;

  const checks = {
    processExitZero: exitCode === 0,
    sessionsAllPassed: summary.sessions === COUNT && summary.sessionsOk === COUNT && summary.sessionsFail === 0,
    minimumProofs: proofs.length >= 5,
    noCrossChainSkips: skippedCrossChain === 0,
    noProofOnly: proofOnlyViolations === 0,
  };

  const ok = Object.values(checks).every(Boolean);
  const report = {
    ok,
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    mode: 'tier1_crosschain_required',
    requirements: {
      sessions: COUNT,
      minProofs: 5,
      noCrossChainSkips: true,
      noProofOnly: true,
    },
    checks,
    summary,
    proofCount: proofs.length,
    proofs,
    processExitCode: exitCode,
    rawStressOutputPath: rawOutputPath,
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log('\n=== MVP Proof Report ===');
  console.log(JSON.stringify({
    ok: report.ok,
    checks: report.checks,
    summary: report.summary,
    proofCount: report.proofCount,
    reportPath,
    rawStressOutputPath: rawOutputPath,
  }, null, 2));

  if (!ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('mvp:prove:prod failed:', error);
  process.exit(1);
});
