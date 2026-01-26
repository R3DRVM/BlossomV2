#!/usr/bin/env npx tsx
/**
 * Stats Cleanup Script
 * Archives/deletes test noise from production database while preserving real activity
 *
 * Usage:
 *   npx tsx agent/scripts/cleanup-test-data.ts --dry-run
 *   npx tsx agent/scripts/cleanup-test-data.ts --execute
 */

const args = process.argv.slice(2);
const isDryRun = !args.includes('--execute');
const sourcePrefix = args.find(a => a.startsWith('--sourcePrefix='))?.split('=')[1] || null;
const olderThanHours = parseInt(args.find(a => a.startsWith('--olderThanHours='))?.split('=')[1] || '0');
const keepLastN = parseInt(args.find(a => a.startsWith('--keepLastNPerSource='))?.split('=')[1] || '0');

console.log('═══════════════════════════════════════════════════════════');
console.log('STATS CLEANUP SCRIPT');
console.log('═══════════════════════════════════════════════════════════');
console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'EXECUTE (will delete)'}`);
console.log('');

// Criteria for cleanup:
// 1. source IN ('dev_debug', 'local_test', 'old_prod_debug', 'cli', 'torture_suite')
// 2. status = 'executing' AND created_at > 10 minutes ago (stuck)
// 3. tx_hash IS NULL AND status != 'planned' AND created_at > 24 hours ago
// 4. created_at < specific cutoff date (before current proof run window)

const CLEANUP_CRITERIA = {
  testSources: ['dev_debug', 'local_test', 'old_prod_debug'],
  stuckExecutingMinutes: 10,
  orphanedHours: 24,
  beforeDate: '2026-01-25T00:00:00Z', // Before today's proof runs
};

async function main() {
  const { query, queryOne } = await import('../execution-ledger/db-pg-client');

  console.log('Cleanup Criteria:');
  console.log(`  - Test sources: ${CLEANUP_CRITERIA.testSources.join(', ')}`);
  console.log(`  - Stuck executions: older than ${CLEANUP_CRITERIA.stuckExecutingMinutes} minutes`);
  console.log(`  - Orphaned records: older than ${CLEANUP_CRITERIA.orphanedHours} hours`);
  console.log(`  - Before date: ${CLEANUP_CRITERIA.beforeDate}`);
  console.log('');

  // COUNT what we'd delete
  const intentCountQuery = `
    SELECT COUNT(*) as count FROM intents
    WHERE metadata_json::text LIKE '%"source":"dev_debug"%'
       OR metadata_json::text LIKE '%"source":"local_test"%'
       OR metadata_json::text LIKE '%"source":"old_prod_debug"%'
       OR (status = 'executing' AND created_at < datetime('now', '-${CLEANUP_CRITERIA.stuckExecutingMinutes} minutes'))
       OR (status != 'planned' AND created_at < datetime('now', '-${CLEANUP_CRITERIA.orphanedHours} hours'))
  `;

  const execCountQuery = `
    SELECT COUNT(*) as count FROM executions
    WHERE metadata_json::text LIKE '%"source":"dev_debug"%'
       OR metadata_json::text LIKE '%"source":"local_test"%'
       OR metadata_json::text LIKE '%"source":"old_prod_debug"%'
       OR (status = 'executing' AND created_at < datetime('now', '-${CLEANUP_CRITERIA.stuckExecutingMinutes} minutes'))
       OR (tx_hash IS NULL AND status != 'planned' AND created_at < datetime('now', '-${CLEANUP_CRITERIA.orphanedHours} hours'))
  `;

  try {
    // For Postgres, we need to adjust the queries
    const intentCount = await queryOne<{count: string}>(
      `SELECT COUNT(*) as count FROM intents
       WHERE (metadata_json::text LIKE '%dev_debug%'
          OR metadata_json::text LIKE '%local_test%'
          OR metadata_json::text LIKE '%old_prod_debug%')`,
      []
    );

    const execCount = await queryOne<{count: string}>(
      `SELECT COUNT(*) as count FROM executions e
       WHERE e.intent_id IN (
         SELECT id FROM intents WHERE metadata_json::text LIKE '%dev_debug%'
         OR metadata_json::text LIKE '%local_test%'
         OR metadata_json::text LIKE '%old_prod_debug%'
       )`,
      []
    );

    console.log('Records to clean:');
    console.log(`  Intents: ${intentCount?.count || 0}`);
    console.log(`  Executions: ${execCount?.count || 0}`);
    console.log('');

    if (isDryRun) {
      console.log('✅ DRY RUN COMPLETE - No changes made');
      console.log('Run with --execute to perform cleanup');
    } else {
      console.log('Deleting test data...');

      // Delete executions first (foreign key constraints)
      await query(
        `DELETE FROM executions
         WHERE intent_id IN (
           SELECT id FROM intents WHERE metadata_json::text LIKE '%dev_debug%'
           OR metadata_json::text LIKE '%local_test%'
           OR metadata_json::text LIKE '%old_prod_debug%'
         )`,
        []
      );

      // Delete intents
      await query(
        `DELETE FROM intents
         WHERE (metadata_json::text LIKE '%dev_debug%'
            OR metadata_json::text LIKE '%local_test%'
            OR metadata_json::text LIKE '%old_prod_debug%')`,
        []
      );

      console.log('✅ CLEANUP COMPLETE');
    }
  } catch (error: any) {
    console.error('❌ Error during cleanup:', error.message);
    process.exit(1);
  }
}

main();
