#!/usr/bin/env npx tsx
async function main() {
  const { query } = await import('../execution-ledger/db-pg-client');

  const result = await query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'access_codes'
    ORDER BY ordinal_position
  `, []);

  console.log('access_codes table schema:');
  console.log(JSON.stringify(result.rows, null, 2));

  process.exit(0);
}

main();
