#!/usr/bin/env tsx
/**
 * Clean up stuck intents in production database
 *
 * Marks intents as failed if they've been stuck in intermediate states:
 * - "executing" for more than 5 minutes -> failed with failure_stage="execution_timeout"
 * - "planned" for more than 5 minutes -> failed with failure_stage="never_executed"
 *
 * This is a one-time cleanup script for old test intents.
 */

import 'dotenv/config';

async function cleanupStuckIntents() {
  // Check for DATABASE_URL
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable required');
    process.exit(1);
  }

  const pgModule = await import('pg');
  const { Pool } = pgModule.default;

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: true,
    },
  });

  try {
    console.log('🔍 Finding stuck intents...\n');

    // Find intents stuck in "executing" for > 5 minutes
    const executingResult = await pool.query(`
      SELECT id, status, created_at, intent_kind
      FROM intents
      WHERE status = 'executing'
        AND created_at < (EXTRACT(EPOCH FROM NOW()) - 300)::bigint
      ORDER BY created_at DESC
    `);

    // Find intents stuck in "planned" for > 5 minutes
    const plannedResult = await pool.query(`
      SELECT id, status, created_at, intent_kind
      FROM intents
      WHERE status = 'planned'
        AND created_at < (EXTRACT(EPOCH FROM NOW()) - 300)::bigint
      ORDER BY created_at DESC
    `);

    console.log(`Found ${executingResult.rows.length} intents stuck in "executing"`);
    console.log(`Found ${plannedResult.rows.length} intents stuck in "planned"`);
    console.log('');

    if (executingResult.rows.length === 0 && plannedResult.rows.length === 0) {
      console.log('✅ No stuck intents found. Database is clean.');
      await pool.end();
      return;
    }

    // Update executing -> failed
    if (executingResult.rows.length > 0) {
      console.log('Marking stuck "executing" intents as failed...');

      await pool.query(`
        UPDATE intents
        SET status = 'failed',
            failure_stage = 'execution_timeout',
            error_code = 'TIMEOUT',
            error_message = 'Intent stuck in executing state - marked failed by cleanup script'
        WHERE status = 'executing'
          AND created_at < (EXTRACT(EPOCH FROM NOW()) - 300)::bigint
      `);

      console.log(`  ✅ Marked ${executingResult.rows.length} intents as failed (timeout)`);
    }

    // Update planned -> failed
    if (plannedResult.rows.length > 0) {
      console.log('Marking stuck "planned" intents as failed...');

      await pool.query(`
        UPDATE intents
        SET status = 'failed',
            failure_stage = 'never_executed',
            error_code = 'NOT_EXECUTED',
            error_message = 'Intent planned but never executed - marked failed by cleanup script'
        WHERE status = 'planned'
          AND created_at < (EXTRACT(EPOCH FROM NOW()) - 300)::bigint
      `);

      console.log(`  ✅ Marked ${plannedResult.rows.length} intents as failed (never_executed)`);
    }

    console.log('');
    console.log('✅ Cleanup complete!');
    console.log('');

    // Show updated stats
    const statsResult = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
        COUNT(CASE WHEN status = 'executing' THEN 1 END) as executing,
        COUNT(CASE WHEN status = 'planned' THEN 1 END) as planned
      FROM intents
    `);

    const stats = statsResult.rows[0];
    console.log('Updated intent stats:');
    console.log(`  Total: ${stats.total}`);
    console.log(`  Confirmed: ${stats.confirmed}`);
    console.log(`  Failed: ${stats.failed}`);
    console.log(`  Executing: ${stats.executing}`);
    console.log(`  Planned: ${stats.planned}`);

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

cleanupStuckIntents();
