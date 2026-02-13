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
  fundingMode?:
    | 'relayed'
    | 'relayed_after_topup'
    | 'user_pays_gas'
    | 'user_paid_required'
    | 'sponsor_gas_drip'
    | 'unknown';
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
const SETTLEMENT_CHAIN = (() => {
  const raw = String(process.env.SETTLEMENT_CHAIN_OVERRIDE || process.env.DEFAULT_SETTLEMENT_CHAIN || 'base_sepolia')
    .trim()
    .toLowerCase();
  if (raw.includes('base')) return 'base_sepolia';
  if (raw.includes('sep') || raw.includes('eth')) return 'sepolia';
  return 'base_sepolia';
})();
const STRESS_MODE = process.env.STRESS_PROVE_MODE || (SETTLEMENT_CHAIN === 'base_sepolia' ? 'tier1_crosschain_required_base' : 'tier1_crosschain_required');
const MIN_PROOFS = parseInt(
  process.env.STRESS_PROVE_MIN_PROOFS || (SETTLEMENT_CHAIN === 'base_sepolia' ? '10' : '5'),
  10
);
const MIN_CROSSCHAIN_PROOFS = parseInt(
  process.env.STRESS_PROVE_MIN_CROSSCHAIN_PROOFS || (SETTLEMENT_CHAIN === 'base_sepolia' ? '10' : '2'),
  10
);
const GLOBAL_TIMEOUT_MS = Math.max(
  60_000,
  parseInt(process.env.STRESS_PROVE_GLOBAL_TIMEOUT_MS || '1200000', 10)
);
const logsDir = path.resolve(process.cwd(), 'logs');
const runStamp = new Date().toISOString().replace(/[:.]/g, '-');
const rawOutputPath = path.join(logsDir, `stress-${STRESS_MODE}-${runStamp}.json`);
const reportPath = path.join(logsDir, 'mvp-prove-report.json');

function runStressSuite(): Promise<{ exitCode: number; timedOut: boolean; durationMs: number; error?: string }> {
  const args = [
    'tsx',
    'agent/scripts/live-stress-tester.ts',
    `--baseUrl=${BASE_URL}`,
    `--mode=${STRESS_MODE}`,
    `--settlement-chain=${SETTLEMENT_CHAIN}`,
    '--allow_execute',
    '--allow_wallet_fallback',
    '--prove',
    `--count=${COUNT}`,
    `--concurrency=${CONCURRENCY}`,
    `--output=${rawOutputPath}`,
  ];

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let timedOut = false;
    const proc = spawn('npx', args, {
      stdio: 'inherit',
      env: process.env,
      cwd: process.cwd(),
    });
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      }, 2500).unref();
    }, GLOBAL_TIMEOUT_MS);
    timer.unref();
    proc.on('error', reject);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        timedOut,
        durationMs: Date.now() - startedAt,
        ...(timedOut ? { error: `stress_run_timeout_after_${GLOBAL_TIMEOUT_MS}ms` } : {}),
      });
    });
  });
}

function assertHash(value: string | undefined): boolean {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value);
}

async function main() {
  fs.mkdirSync(logsDir, { recursive: true });

  let runResult: { exitCode: number; timedOut: boolean; durationMs: number; error?: string } = {
    exitCode: 1,
    timedOut: false,
    durationMs: 0,
  };
  let runError: string | undefined;
  try {
    runResult = await runStressSuite();
  } catch (error: any) {
    runError = error?.message || String(error);
  }

  let parsed: StressOutput | null = null;
  if (fs.existsSync(rawOutputPath)) {
    try {
      parsed = JSON.parse(fs.readFileSync(rawOutputPath, 'utf8')) as StressOutput;
    } catch (error: any) {
      runError = runError || `failed_to_parse_stress_output:${error?.message || String(error)}`;
    }
  } else {
    runError = runError || 'stress_output_missing';
  }

  const summary: StressSummary = parsed?.summary || {
    mode: STRESS_MODE,
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
    String(proof.toChain || '').toLowerCase() === SETTLEMENT_CHAIN &&
    (
      proof.fundingMode === 'relayed' ||
      proof.fundingMode === 'relayed_after_topup' ||
      proof.fundingMode === 'user_pays_gas' ||
      proof.fundingMode === 'user_paid_required'
    ) &&
    assertHash(proof.creditTxHash) &&
    assertHash(proof.executionTxHash) &&
    proof.creditReceiptConfirmed === true &&
    proof.executionReceiptConfirmed === true
  );
  const crossChainProofs = ((parsed?.crossChainProofs || []) as CrossChainProof[]).filter((proof) =>
    proof.routeType === 'testnet_credit' &&
    String(proof.toChain || '').toLowerCase() === SETTLEMENT_CHAIN &&
    assertHash(proof.creditTxHash) &&
    assertHash(proof.executionTxHash) &&
    proof.creditReceiptConfirmed === true &&
    proof.executionReceiptConfirmed === true
  );

  const crossChainActions = results.flatMap((session) =>
    (session.actions || []).filter((action) => action.category === 'cross_chain_route')
  );
  const proofOnlyViolations = crossChainActions.filter((action) =>
    String(action.error || '').toLowerCase().includes('proof-only')
  ).length;

  // BASE_FALLBACK_VIOLATION check - hard fail if any base-required proof falls back to Sepolia
  const baseFallbackViolations = results.flatMap(session =>
    (session.actions || []).filter(action =>
      action.category === 'cross_chain_route' &&
      action.status === 'ok' &&
      STRESS_MODE === 'tier1_crosschain_required_base' &&
      (action as any).routeToChain !== 'base_sepolia'
    )
  ).length;

  const checks = {
    processExitZero: runResult.exitCode === 0 && !runResult.timedOut && !runError,
    minimumProofs: proofs.length >= MIN_PROOFS,
    minimumCrossChainProofs: crossChainProofs.length >= MIN_CROSSCHAIN_PROOFS,
    noProofOnly: proofOnlyViolations === 0,
    noBaseFallback: baseFallbackViolations === 0,
    outputProduced: fs.existsSync(rawOutputPath),
  };

  const ok =
    checks.processExitZero &&
    checks.minimumProofs &&
    checks.minimumCrossChainProofs &&
    checks.noProofOnly &&
    checks.noBaseFallback &&
    checks.outputProduced;
  const report = {
    ok,
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    mode: STRESS_MODE,
    settlementChain: SETTLEMENT_CHAIN,
    settlementChainVerification: {
      target: SETTLEMENT_CHAIN,
      allProofsMatchTarget: baseFallbackViolations === 0,
      fallbackViolationCount: baseFallbackViolations,
    },
    requirements: {
      sessions: COUNT,
      minProofs: MIN_PROOFS,
      minCrossChainProofs: MIN_CROSSCHAIN_PROOFS,
      noProofOnly: true,
      noBaseFallback: STRESS_MODE === 'tier1_crosschain_required_base',
      allowedFundingModes: ['relayed', 'relayed_after_topup', 'user_pays_gas', 'user_paid_required'],
    },
    checks,
    summary,
    proofCount: proofs.length,
    crossChainProofCount: crossChainProofs.length,
    proofs,
    crossChainProofs,
    processExitCode: runResult.exitCode,
    timedOut: runResult.timedOut,
    durationMs: runResult.durationMs,
    ...(runResult.error ? { runError: runResult.error } : {}),
    ...(runError ? { parseOrRunError: runError } : {}),
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
