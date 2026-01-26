#!/usr/bin/env npx tsx
/**
 * Query Access Codes Status
 * Admin utility to check access codes in production Postgres
 */

async function main() {
  const { query } = await import('../execution-ledger/db-pg-client');

  const filter = process.argv[2]; // Optional: 'used', 'unused', 'all', or specific code

  console.log('═══════════════════════════════════════════════════════════');
  console.log('ACCESS CODES STATUS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  if (filter && filter !== 'used' && filter !== 'unused' && filter !== 'all') {
    // Query specific code
    console.log(`Looking up code: ${filter}`);
    console.log('');

    const result = await query(`
      SELECT id, code, created_at, expires_at, max_uses, times_used, last_used_at, created_by, metadata_json
      FROM access_codes
      WHERE code = $1
    `, [filter.toUpperCase()]);

    if (result.rows && result.rows.length > 0) {
      const row = result.rows[0];
      const metadata = row.metadata_json ? JSON.parse(row.metadata_json) : {};

      console.log('Code Details:');
      console.log(`  Code:        ${row.code}`);
      console.log(`  Status:      ${row.times_used >= row.max_uses ? '✗ USED' : '✓ AVAILABLE'}`);
      console.log(`  Max Uses:    ${row.max_uses}`);
      console.log(`  Times Used:  ${row.times_used}`);
      console.log(`  Created:     ${new Date(row.created_at * 1000).toISOString()}`);
      console.log(`  Last Used:   ${row.last_used_at ? new Date(row.last_used_at * 1000).toISOString() : 'Never'}`);
      console.log(`  Label:       ${metadata.label || 'N/A'}`);
      console.log('');
    } else {
      console.log('❌ Code not found in database');
      console.log('');
    }

    process.exit(0);
  }

  // Summary query
  const summaryResult = await query(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN times_used >= max_uses THEN 1 ELSE 0 END) as used,
      SUM(CASE WHEN times_used < max_uses THEN 1 ELSE 0 END) as available
    FROM access_codes
  `, []);

  if (summaryResult.rows && summaryResult.rows.length > 0) {
    const summary = summaryResult.rows[0];
    console.log('Summary:');
    console.log(`  Total Codes:      ${summary.total}`);
    console.log(`  Available:        ${summary.available} codes`);
    console.log(`  Used:             ${summary.used} codes`);
    console.log('');
  }

  // List codes based on filter
  let whereClause = '';
  let queryParams: any[] = [];

  if (filter === 'used') {
    whereClause = 'WHERE times_used >= max_uses';
  } else if (filter === 'unused') {
    whereClause = 'WHERE times_used < max_uses';
  }
  // 'all' or no filter shows everything

  const listResult = await query(`
    SELECT id, code, created_at, max_uses, times_used, last_used_at, metadata_json
    FROM access_codes
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT 50
  `, queryParams);

  if (listResult.rows && listResult.rows.length > 0) {
    console.log(`Access Codes (${filter || 'all'}, limit 50):`);
    console.log('-----------------------------------------------------------');

    listResult.rows.forEach((row, idx) => {
      const metadata = row.metadata_json ? JSON.parse(row.metadata_json) : {};
      const status = row.times_used >= row.max_uses ? '✗ USED' : '✓ AVAIL';
      const label = metadata.label ? ` [${metadata.label}]` : '';

      console.log(`[${idx + 1}] ${status} ${row.code}${label}`);
      if (row.last_used_at) {
        console.log(`    Last used: ${new Date(row.last_used_at * 1000).toISOString()}`);
      }
    });
    console.log('');
  } else {
    console.log('No codes found matching filter.');
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('Usage:');
  console.log('  npm run query-codes              # Show all codes');
  console.log('  npm run query-codes used         # Show used codes only');
  console.log('  npm run query-codes unused       # Show available codes only');
  console.log('  npm run query-codes BLOSSOM-XXX  # Look up specific code');
  console.log('');

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
