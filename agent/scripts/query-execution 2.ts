#!/usr/bin/env tsx
import pkg from 'pg';
const { Pool } = pkg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL required');
  process.exit(1);
}

const executionId = process.argv[2];
if (!executionId) {
  console.error('❌ Usage: tsx query-execution.ts <execution-id>');
  process.exit(1);
}

async function query() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });

  try {
    console.log(`\n🔍 Querying execution: ${executionId}\n`);

    const result = await pool.query(
      'SELECT id, status, tx_hash, intent_id, chain, created_at FROM executions WHERE id = $1',
      [executionId]
    );

    if (result.rows.length === 0) {
      console.log('❌ Execution not found in database');

      // Check total executions count
      const countResult = await pool.query('SELECT COUNT(*) as count FROM executions');
      console.log(`\n📊 Total executions in database: ${countResult.rows[0].count}`);
    } else {
      const exec = result.rows[0];
      console.log('✅ Execution found:');
      console.log(`   ID: ${exec.id}`);
      console.log(`   Status: ${exec.status}`);
      console.log(`   TX Hash: ${exec.tx_hash || 'null'}`);
      console.log(`   Intent ID: ${exec.intent_id || 'null'}`);
      console.log(`   Chain: ${exec.chain}`);
      console.log(`   Created: ${exec.created_at ? new Date(exec.created_at * 1000).toISOString() : 'null'}`);
    }

    await pool.end();
  } catch (error: any) {
    console.error('❌ Query failed:', error.message);
    process.exit(1);
  }
}

query();
