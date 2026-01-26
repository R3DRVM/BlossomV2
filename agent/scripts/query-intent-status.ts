#!/usr/bin/env tsx
/**
 * Query intent status from production Neon database
 */

import pkg from 'pg';
const { Pool } = pkg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable required');
  process.exit(1);
}

const intentId = process.argv[2];
if (!intentId) {
  console.error('❌ Usage: tsx query-intent-status.ts <intent-id>');
  process.exit(1);
}

async function queryIntent() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });

  try {
    console.log(`\n🔍 Querying intent: ${intentId}`);
    console.log('─'.repeat(60));

    // Query intent
    const intentResult = await pool.query(
      'SELECT id, status, intent_kind, confirmed_at, executed_at, created_at FROM intents WHERE id = $1',
      [intentId]
    );

    if (intentResult.rows.length === 0) {
      console.log('❌ Intent not found in database');
    } else {
      const intent = intentResult.rows[0];
      console.log('\n📋 Intent Status:');
      console.log(`   ID: ${intent.id}`);
      console.log(`   Status: ${intent.status}`);
      console.log(`   Kind: ${intent.intent_kind}`);
      console.log(`   Created: ${intent.created_at ? new Date(intent.created_at * 1000).toISOString() : 'null'}`);
      console.log(`   Confirmed: ${intent.confirmed_at ? new Date(intent.confirmed_at * 1000).toISOString() : 'null'}`);
      console.log(`   Executed: ${intent.executed_at ? new Date(intent.executed_at * 1000).toISOString() : 'null'}`);
    }

    // Query executions
    const execResult = await pool.query(
      'SELECT id, status, tx_hash, created_at FROM executions WHERE intent_id = $1',
      [intentId]
    );

    console.log(`\n🔗 Linked Executions: ${execResult.rows.length}`);
    if (execResult.rows.length > 0) {
      execResult.rows.forEach((exec, i) => {
        console.log(`\n   Execution ${i + 1}:`);
        console.log(`   ID: ${exec.id}`);
        console.log(`   Status: ${exec.status}`);
        console.log(`   TX Hash: ${exec.tx_hash || 'null'}`);
        console.log(`   Created: ${exec.created_at ? new Date(exec.created_at * 1000).toISOString() : 'null'}`);
      });
    }

    console.log('\n' + '─'.repeat(60));

    // Summary stats
    const statsResult = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM intents) as total_intents,
        (SELECT COUNT(*) FROM intents WHERE status = 'confirmed') as confirmed_intents,
        (SELECT COUNT(*) FROM executions) as total_executions
    `);

    console.log('\n📊 Database Summary:');
    const stats = statsResult.rows[0];
    console.log(`   Total Intents: ${stats.total_intents}`);
    console.log(`   Confirmed: ${stats.confirmed_intents}`);
    console.log(`   Total Executions: ${stats.total_executions}`);
    console.log('');

  } catch (error: any) {
    console.error('❌ Query failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

queryIntent();
