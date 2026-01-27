#!/usr/bin/env npx tsx
/**
 * Failure Breakdown Helper
 *
 * Queries the ledger DB for recent failures and groups them by:
 * - error_code
 * - venue
 * - failure_stage
 *
 * Usage:
 *   npx tsx agent/scripts/failure-breakdown.ts
 *   npx tsx agent/scripts/failure-breakdown.ts --limit 100
 *
 * Environment:
 *   Must be run from agent directory or have access to execution-ledger/db.ts
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { config } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const agentDir = resolve(__dirname, '..');
config({ path: resolve(agentDir, '.env.local') });

// Colors
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const NC = '\x1b[0m';

// Parse CLI args
const args = process.argv.slice(2);
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 50;

interface FailureRecord {
  id: string;
  intent_text: string;
  intent_kind: string;
  requested_venue: string;
  status: string;
  failure_stage: string;
  error_code: string;
  error_message: string;
  created_at: number;
}

async function main() {
  console.log(`\n${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}`);
  console.log(`${BLUE}║                    FAILURE BREAKDOWN                           ║${NC}`);
  console.log(`${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}\n`);

  // Import DB module
  const { getDatabase } = await import('../execution-ledger/db');
  const db = getDatabase();

  // Get recent failures
  const failures = db.prepare(`
    SELECT
      id,
      intent_text,
      intent_kind,
      requested_venue,
      status,
      failure_stage,
      error_code,
      error_message,
      created_at
    FROM intents
    WHERE status = 'failed'
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as FailureRecord[];

  if (failures.length === 0) {
    console.log(`${GREEN}No failures found in the last ${limit} records!${NC}\n`);
    return;
  }

  console.log(`Found ${failures.length} failures in last ${limit} records\n`);

  // Group by error_code
  console.log(`${YELLOW}═══ By Error Code ═══${NC}`);
  const byCode: Record<string, FailureRecord[]> = {};
  for (const f of failures) {
    const code = f.error_code || 'UNKNOWN';
    if (!byCode[code]) byCode[code] = [];
    byCode[code].push(f);
  }

  const sortedCodes = Object.entries(byCode).sort((a, b) => b[1].length - a[1].length);
  console.log('');
  console.log(`${'Error Code'.padEnd(30)} ${'Count'.padEnd(6)} ${'Sample Intent'}`);
  console.log('─'.repeat(80));

  for (const [code, records] of sortedCodes) {
    const sample = records[0];
    const intentPreview = (sample.intent_text || '').slice(0, 30);
    console.log(`${code.padEnd(30)} ${String(records.length).padEnd(6)} ${DIM}${intentPreview}${NC}`);
  }

  // Group by venue
  console.log(`\n${YELLOW}═══ By Venue ═══${NC}`);
  const byVenue: Record<string, FailureRecord[]> = {};
  for (const f of failures) {
    const venue = f.requested_venue || 'unknown';
    if (!byVenue[venue]) byVenue[venue] = [];
    byVenue[venue].push(f);
  }

  const sortedVenues = Object.entries(byVenue).sort((a, b) => b[1].length - a[1].length);
  console.log('');
  console.log(`${'Venue'.padEnd(20)} ${'Count'.padEnd(6)} ${'Top Error Code'}`);
  console.log('─'.repeat(60));

  for (const [venue, records] of sortedVenues) {
    // Find top error code for this venue
    const venueErrors: Record<string, number> = {};
    for (const r of records) {
      const code = r.error_code || 'UNKNOWN';
      venueErrors[code] = (venueErrors[code] || 0) + 1;
    }
    const topError = Object.entries(venueErrors).sort((a, b) => b[1] - a[1])[0];
    console.log(`${venue.padEnd(20)} ${String(records.length).padEnd(6)} ${topError ? topError[0] : '-'}`);
  }

  // Group by failure_stage
  console.log(`\n${YELLOW}═══ By Failure Stage ═══${NC}`);
  const byStage: Record<string, FailureRecord[]> = {};
  for (const f of failures) {
    const stage = f.failure_stage || 'unknown';
    if (!byStage[stage]) byStage[stage] = [];
    byStage[stage].push(f);
  }

  const sortedStages = Object.entries(byStage).sort((a, b) => b[1].length - a[1].length);
  console.log('');
  console.log(`${'Stage'.padEnd(15)} ${'Count'.padEnd(6)} ${'Top Error Code'}`);
  console.log('─'.repeat(50));

  for (const [stage, records] of sortedStages) {
    const stageErrors: Record<string, number> = {};
    for (const r of records) {
      const code = r.error_code || 'UNKNOWN';
      stageErrors[code] = (stageErrors[code] || 0) + 1;
    }
    const topError = Object.entries(stageErrors).sort((a, b) => b[1] - a[1])[0];
    console.log(`${stage.padEnd(15)} ${String(records.length).padEnd(6)} ${topError ? topError[0] : '-'}`);
  }

  // Group by intent_kind
  console.log(`\n${YELLOW}═══ By Intent Kind ═══${NC}`);
  const byKind: Record<string, FailureRecord[]> = {};
  for (const f of failures) {
    const kind = f.intent_kind || 'unknown';
    if (!byKind[kind]) byKind[kind] = [];
    byKind[kind].push(f);
  }

  const sortedKinds = Object.entries(byKind).sort((a, b) => b[1].length - a[1].length);
  console.log('');
  console.log(`${'Kind'.padEnd(15)} ${'Count'.padEnd(6)} ${'Top Error Code'}`);
  console.log('─'.repeat(50));

  for (const [kind, records] of sortedKinds) {
    const kindErrors: Record<string, number> = {};
    for (const r of records) {
      const code = r.error_code || 'UNKNOWN';
      kindErrors[code] = (kindErrors[code] || 0) + 1;
    }
    const topError = Object.entries(kindErrors).sort((a, b) => b[1] - a[1])[0];
    console.log(`${kind.padEnd(15)} ${String(records.length).padEnd(6)} ${topError ? topError[0] : '-'}`);
  }

  // Recent failure sample
  console.log(`\n${YELLOW}═══ Recent Failures (last 5) ═══${NC}`);
  console.log('');

  const recentFive = failures.slice(0, 5);
  for (const f of recentFive) {
    const date = new Date(f.created_at * 1000).toISOString().slice(0, 19);
    console.log(`${DIM}${date}${NC} ${f.id.slice(0, 8)}`);
    console.log(`  ${CYAN}Intent:${NC} ${(f.intent_text || '').slice(0, 50)}`);
    console.log(`  ${CYAN}Kind:${NC} ${f.intent_kind || '-'}  ${CYAN}Venue:${NC} ${f.requested_venue || '-'}`);
    console.log(`  ${RED}Error:${NC} ${f.error_code || 'UNKNOWN'} @ ${f.failure_stage || 'unknown'}`);
    if (f.error_message) {
      console.log(`  ${DIM}${f.error_message.slice(0, 70)}${NC}`);
    }
    console.log('');
  }

  // Overall stats
  const statsResult = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM intents
  `).get() as { total: number; confirmed: number; failed: number };

  const successRate = statsResult.total > 0
    ? ((statsResult.confirmed / (statsResult.confirmed + statsResult.failed)) * 100).toFixed(1)
    : '0.0';

  console.log(`${BLUE}═══ Overall Stats ═══${NC}`);
  console.log(`Total intents:    ${statsResult.total}`);
  console.log(`Confirmed:        ${statsResult.confirmed}`);
  console.log(`Failed:           ${statsResult.failed}`);
  console.log(`Success rate:     ${successRate}%`);
  console.log('');
}

main().catch((error) => {
  console.error(`\n${RED}ERROR: ${error.message}${NC}\n`);
  process.exit(1);
});
