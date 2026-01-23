#!/usr/bin/env tsx
/**
 * Devnet Traffic Campaign Runner
 *
 * Orchestrates multiple load test stages with automatic reporting.
 * Each stage generates unique RUN_ID and stores metrics in telemetry DB.
 *
 * Usage:
 *   npm run devnet:campaign
 *   npm run devnet:campaign -- --stages="100:50:60,500:100:120,1500:200:180"
 *
 * Stage format: users:concurrency:duration_seconds
 */

import { spawn } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse CLI args
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.replace('--', '').split('=');
  acc[key] = value;
  return acc;
}, {} as Record<string, string>);

// Default stages: users:concurrency:duration
const DEFAULT_STAGES = [
  { users: 100, concurrency: 50, duration: 60 },
  { users: 500, concurrency: 100, duration: 120 },
  { users: 1500, concurrency: 200, duration: 180 },
  { users: 2500, concurrency: 300, duration: 300 },
];

interface StageConfig {
  users: number;
  concurrency: number;
  duration: number;
}

interface StageResult {
  runId: string;
  stage: number;
  config: StageConfig;
  totalRequests: number;
  successRate: number;
  p50Ms: number;
  p95Ms: number;
  http5xx: number;
  topErrorCode: string | null;
  startedAt: string;
  endedAt: string;
  reportPath: string;
}

const results: StageResult[] = [];

/**
 * Parse custom stages from CLI
 */
function parseStages(stagesArg?: string): StageConfig[] {
  if (!stagesArg) return DEFAULT_STAGES;

  return stagesArg.split(',').map(s => {
    const [users, concurrency, duration] = s.split(':').map(Number);
    return { users, concurrency, duration };
  });
}

/**
 * Generate RUN_ID with timestamp and stage number
 */
function generateRunId(stageNum: number): string {
  const now = new Date();
  const date = now.toISOString().split('T')[0]; // yyyy-mm-dd
  const time = now.toTimeString().split(' ')[0].replace(/:/g, ''); // hhmmss
  return `devnet_${date}_${time}_stage${stageNum}`;
}

/**
 * Run a command and capture output
 */
function runCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd: path.join(__dirname, '..'),
      shell: true,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const str = data.toString();
      stdout += str;
      process.stdout.write(str);
    });

    proc.stderr.on('data', (data) => {
      const str = data.toString();
      stderr += str;
      process.stderr.write(str);
    });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

/**
 * Store run metadata in telemetry DB (local) and via API (remote)
 */
async function storeRunMetadata(result: StageResult): Promise<void> {
  // Build run data payload
  const runData = {
    run_id: result.runId,
    started_at: result.startedAt,
    duration_secs: result.config.duration,
    total_users: result.config.users,
    concurrency: result.config.concurrency,
    total_requests: result.totalRequests,
    success_count: Math.round(result.totalRequests * result.successRate / 100),
    fail_count: Math.round(result.totalRequests * (100 - result.successRate) / 100),
    success_rate: result.successRate,
    p50_ms: result.p50Ms,
    p95_ms: result.p95Ms,
    http_5xx_count: result.http5xx,
    top_error: result.topErrorCode,
  };

  // POST to remote agent API if configured
  const apiBase = process.env.AGENT_API_BASE_URL;
  if (apiBase && !apiBase.includes('localhost')) {
    try {
      const response = await fetch(`${apiBase}/api/telemetry/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(runData),
      });
      const json = await response.json();
      if (json.ok) {
        console.log(`   Stored run metadata to ${apiBase} for ${result.runId}`);
      } else {
        console.warn(`   Warning: Remote API returned error: ${json.error}`);
      }
    } catch (e) {
      console.warn(`   Warning: Could not POST run to API: ${(e as Error).message}`);
    }
  }

  // Also store locally
  try {
    const { initDatabase, getDatabase, migrateAddFeeColumns } = await import('../telemetry/db');
    initDatabase();
    migrateAddFeeColumns();

    // Ensure runs table exists
    const db = getDatabase();
    db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT UNIQUE NOT NULL,
        stage INTEGER,
        users INTEGER,
        concurrency INTEGER,
        duration INTEGER,
        total_requests INTEGER,
        success_rate REAL,
        p50_ms INTEGER,
        p95_ms INTEGER,
        http_5xx INTEGER,
        top_error_code TEXT,
        started_at TEXT,
        ended_at TEXT,
        report_path TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );
      CREATE INDEX IF NOT EXISTS idx_runs_run_id ON runs(run_id);
      CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at);
    `);

    // Insert run
    db.prepare(`
      INSERT OR REPLACE INTO runs (
        run_id, stage, users, concurrency, duration,
        total_requests, success_rate, p50_ms, p95_ms, http_5xx,
        top_error_code, started_at, ended_at, report_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      result.runId,
      result.stage,
      result.config.users,
      result.config.concurrency,
      result.config.duration,
      result.totalRequests,
      result.successRate,
      result.p50Ms,
      result.p95Ms,
      result.http5xx,
      result.topErrorCode,
      result.startedAt,
      result.endedAt,
      result.reportPath
    );

    console.log(`   Stored run metadata locally for ${result.runId}`);
  } catch (e) {
    console.warn(`   Warning: Could not store run metadata locally: ${(e as Error).message}`);
  }
}

/**
 * Parse metrics from load test output
 */
function parseLoadTestOutput(output: string): Partial<StageResult> {
  const metrics: Partial<StageResult> = {
    totalRequests: 0,
    successRate: 0,
    p50Ms: 0,
    p95Ms: 0,
    http5xx: 0,
    topErrorCode: null,
  };

  // Parse "Total Requests: X"
  const totalMatch = output.match(/Total Requests:\s*(\d+)/i);
  if (totalMatch) metrics.totalRequests = parseInt(totalMatch[1], 10);

  // Parse overall success rate "Overall: X/Y OK (Z%)"
  const overallMatch = output.match(/Overall:\s*(\d+)\/(\d+)\s*OK\s*\((\d+\.?\d*)%\)/i);
  if (overallMatch) {
    metrics.totalRequests = parseInt(overallMatch[2], 10);
    metrics.successRate = parseFloat(overallMatch[3]);
  }

  // Parse "P50 latency: Xms"
  const p50Match = output.match(/P50 latency:\s*(\d+)ms/i);
  if (p50Match) metrics.p50Ms = parseInt(p50Match[1], 10);

  // Parse "P95 latency: Xms"
  const p95Match = output.match(/P95 latency:\s*(\d+)ms/i);
  if (p95Match) metrics.p95Ms = parseInt(p95Match[1], 10);

  // Parse "HTTP 5xx errors: X"
  const http5xxMatch = output.match(/HTTP 5xx errors:\s*(\d+)/i);
  if (http5xxMatch) metrics.http5xx = parseInt(http5xxMatch[1], 10);

  // Parse top error code
  const errorMatch = output.match(/Top Error Codes:\s*\n\s*(\w+):\s*\d+/);
  if (errorMatch) metrics.topErrorCode = errorMatch[1];

  return metrics;
}

/**
 * Run a single stage
 */
async function runStage(stageNum: number, config: StageConfig): Promise<StageResult> {
  const runId = generateRunId(stageNum);
  const startedAt = new Date().toISOString();

  console.log(`\n${'='.repeat(70)}`);
  console.log(`STAGE ${stageNum}: ${config.users} users, ${config.concurrency} concurrency, ${config.duration}s`);
  console.log(`RUN_ID: ${runId}`);
  console.log(`${'='.repeat(70)}\n`);

  // Run load test
  const loadTestResult = await runCommand('npx', [
    'tsx',
    'scripts/devnet-load-test.ts',
    `--users=${config.users}`,
    `--read-concurrency=${config.concurrency}`,
    `--duration=${config.duration}`,
    `--run-id=${runId}`,
  ]);

  const endedAt = new Date().toISOString();

  // Parse metrics from output
  const metrics = parseLoadTestOutput(loadTestResult.stdout);

  // Generate report
  console.log(`\n   Generating report...`);
  await runCommand('npx', [
    'tsx',
    'scripts/generate-devnet-report.ts',
    `--run-id=${runId}`,
  ]);

  const reportPath = `DEVNET_LOAD_REPORT_${runId}.md`;

  const result: StageResult = {
    runId,
    stage: stageNum,
    config,
    totalRequests: metrics.totalRequests || 0,
    successRate: metrics.successRate || 0,
    p50Ms: metrics.p50Ms || 0,
    p95Ms: metrics.p95Ms || 0,
    http5xx: metrics.http5xx || 0,
    topErrorCode: metrics.topErrorCode || null,
    startedAt,
    endedAt,
    reportPath,
  };

  // Store in DB
  await storeRunMetadata(result);

  return result;
}

/**
 * Print final summary
 */
function printSummary(): void {
  console.log(`\n${'='.repeat(70)}`);
  console.log('CAMPAIGN SUMMARY');
  console.log(`${'='.repeat(70)}\n`);

  console.log('| Stage | Users | Concurrency | Duration | Requests | Success% | P50ms | P95ms | 5xx | Top Error |');
  console.log('|-------|-------|-------------|----------|----------|----------|-------|-------|-----|-----------|');

  for (const r of results) {
    console.log(
      `| ${r.stage.toString().padStart(5)} | ${r.config.users.toString().padStart(5)} | ${r.config.concurrency.toString().padStart(11)} | ${r.config.duration.toString().padStart(8)}s | ${r.totalRequests.toString().padStart(8)} | ${r.successRate.toFixed(1).padStart(8)}% | ${r.p50Ms.toString().padStart(5)} | ${r.p95Ms.toString().padStart(5)} | ${r.http5xx.toString().padStart(3)} | ${(r.topErrorCode || 'none').padEnd(9)} |`
    );
  }

  console.log('');

  // Overall stats
  const totalRequests = results.reduce((sum, r) => sum + r.totalRequests, 0);
  const avgSuccessRate = results.reduce((sum, r) => sum + r.successRate, 0) / results.length;
  const maxP95 = Math.max(...results.map(r => r.p95Ms));
  const totalHttp5xx = results.reduce((sum, r) => sum + r.http5xx, 0);

  console.log('Overall Campaign Statistics:');
  console.log(`   Total Requests: ${totalRequests.toLocaleString()}`);
  console.log(`   Avg Success Rate: ${avgSuccessRate.toFixed(2)}%`);
  console.log(`   Max P95 Latency: ${maxP95}ms`);
  console.log(`   Total HTTP 5xx: ${totalHttp5xx}`);
  console.log('');

  console.log('Report Files:');
  for (const r of results) {
    console.log(`   Stage ${r.stage}: ${r.reportPath}`);
  }

  console.log('');

  // Pass/Fail
  if (avgSuccessRate >= 99 && totalHttp5xx === 0) {
    console.log('CAMPAIGN RESULT: PASS');
  } else if (avgSuccessRate >= 95) {
    console.log('CAMPAIGN RESULT: WARNING (review errors)');
  } else {
    console.log('CAMPAIGN RESULT: FAIL');
  }

  console.log(`${'='.repeat(70)}\n`);
}

/**
 * Main
 */
async function main(): Promise<void> {
  console.log(`${'='.repeat(70)}`);
  console.log('DEVNET TRAFFIC CAMPAIGN RUNNER');
  console.log(`${'='.repeat(70)}`);

  const stages = parseStages(args['stages']);

  console.log(`\nCampaign Configuration:`);
  console.log(`   Stages: ${stages.length}`);
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    console.log(`   Stage ${i + 1}: ${s.users} users, ${s.concurrency} concurrency, ${s.duration}s`);
  }

  // Run stages
  for (let i = 0; i < stages.length; i++) {
    const result = await runStage(i + 1, stages[i]);
    results.push(result);

    // Brief pause between stages
    if (i < stages.length - 1) {
      console.log(`\n   Cooling down for 5 seconds before next stage...`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  // Print summary
  printSummary();
}

// Run
main().catch(error => {
  console.error('Campaign failed:', error);
  process.exit(1);
});
