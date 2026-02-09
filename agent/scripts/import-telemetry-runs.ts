/**
 * Import historical telemetry runs from local DB to production
 *
 * This script:
 * 1. Reads runs from local SQLite DB
 * 2. Exports them as SQL for manual import into Vercel Postgres
 * 3. Marks them with source='local_import' and imported_at timestamp
 *
 * Usage:
 *   npx tsx agent/scripts/import-telemetry-runs.ts --dry-run
 *   npx tsx agent/scripts/import-telemetry-runs.ts --export
 *   npx tsx agent/scripts/import-telemetry-runs.ts
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Local DB path
const LOCAL_DB_PATH = process.env.LOCAL_DB_PATH || path.join(__dirname, '../telemetry/telemetry.db');

// Production API (Vercel-only)
const PROD_API_URL = process.env.PROD_API_URL || 'https://blossom.onl';
const FLY_BLOCKLIST = /fly\.dev|fly\.io/i;

function assertNoFly(url: string): void {
  if (FLY_BLOCKLIST.test(url)) {
    throw new Error(`Fly.io is deprecated. Set PROD_API_URL to Vercel (blossom.onl). Got: ${url}`);
  }
}

assertNoFly(PROD_API_URL);

interface DevnetRun {
  id: number;
  run_id: string;
  stage: number | null;
  users: number;
  concurrency: number;
  duration: number;
  total_requests: number;
  success_rate: number;
  p50_ms: number;
  p95_ms: number;
  http_5xx: number;
  top_error_code: string | null;
  started_at: string;
  ended_at: string;
  report_path: string | null;
  created_at: number;
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  const exportOnly = process.argv.includes('--export');

  console.log('='.repeat(60));
  console.log('Telemetry Runs Import Tool');
  console.log('='.repeat(60));
  console.log(`Mode: ${isDryRun ? 'DRY-RUN' : exportOnly ? 'EXPORT-ONLY' : 'LIVE IMPORT'}`);
  console.log(`Local DB: ${LOCAL_DB_PATH}`);
  console.log(`Prod API: ${PROD_API_URL}`);
  console.log('');

  // Open local DB
  const localDb = new Database(LOCAL_DB_PATH, { readonly: true });

  // Get all runs from local DB
  const localRuns = localDb.prepare(`
    SELECT * FROM runs ORDER BY id ASC
  `).all() as DevnetRun[];

  console.log(`Found ${localRuns.length} runs in local DB:`);
  localRuns.forEach(run => {
    console.log(`  [${run.id}] ${run.run_id} - ${run.users} users, ${run.total_requests} reqs, ${run.success_rate}% success`);
  });
  console.log('');

  // Fetch existing runs from production
  console.log('Fetching existing runs from production...');
  const prodResponse = await fetch(`${PROD_API_URL}/api/telemetry/runs?limit=100`);
  const prodData = await prodResponse.json() as { ok: boolean; data: DevnetRun[] };

  if (!prodData.ok) {
    console.error('Failed to fetch production runs');
    process.exit(1);
  }

  const existingRunIds = new Set(prodData.data.map(r => r.run_id));
  console.log(`Found ${prodData.data.length} runs in production.`);
  console.log('');

  // Determine which runs to import
  const runsToImport = localRuns.filter(r => !existingRunIds.has(r.run_id));

  console.log(`Runs to import: ${runsToImport.length}`);
  if (runsToImport.length === 0) {
    console.log('All local runs already exist in production. Nothing to import.');
    localDb.close();
    return;
  }

  runsToImport.forEach(run => {
    console.log(`  Will import: ${run.run_id}`);
  });
  console.log('');

  if (isDryRun) {
    console.log('DRY-RUN complete. Use without --dry-run to import.');
    localDb.close();
    return;
  }

  // Automated import is deprecated. Export SQL for manual import.
  const importedAt = Math.floor(Date.now() / 1000);
  const source = 'local_import';

  // Generate SQL statements for each run
  const sqlStatements = runsToImport.map(run => {
    const values = [
      `'${run.run_id}'`,
      run.stage ?? 'NULL',
      run.users,
      run.concurrency,
      run.duration,
      run.total_requests,
      run.success_rate,
      run.p50_ms,
      run.p95_ms,
      run.http_5xx,
      run.top_error_code ? `'${run.top_error_code}'` : 'NULL',
      `'${run.started_at}'`,
      run.ended_at ? `'${run.ended_at}'` : 'NULL',
      run.report_path ? `'${run.report_path}'` : 'NULL',
      run.created_at,
      `'${source}'`,
      importedAt,
    ].join(', ');

    return `INSERT OR IGNORE INTO runs (run_id, stage, users, concurrency, duration, total_requests, success_rate, p50_ms, p95_ms, http_5xx, top_error_code, started_at, ended_at, report_path, created_at, source, imported_at) VALUES (${values});`;
  });

  console.log('Generated SQL statements:');
  console.log('');
  sqlStatements.forEach(sql => console.log(sql));
  console.log('');
  console.log(exportOnly
    ? 'EXPORT-ONLY complete. Run these on prod DB manually.'
    : 'Automated import is disabled. Run these on prod DB manually.'
  );
  localDb.close();
  return;
}

main().catch(console.error);
