#!/usr/bin/env npx tsx
/**
 * Verify DB Fields - USD Estimates + Wallet Addresses
 * Direct DB query to prove persistence
 */

async function main() {
  const { query, queryRows } = await import('../execution-ledger/db-pg-client');

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('DB VERIFICATION - USD Estimates + Wallet Addresses');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Get recent 5 confirmed executions
  const recent = await queryRows<any>(
    `SELECT id, chain, status, usd_estimate, from_address, tx_hash, created_at
     FROM executions
     WHERE status = $1
     ORDER BY created_at DESC
     LIMIT 5`,
    ['confirmed']
  );

  console.log('Recent Confirmed Executions:\n');
  recent.forEach((row: any, idx: number) => {
    console.log(`[${idx + 1}] ${row.chain.toUpperCase()} - ${row.tx_hash.slice(0, 16)}...`);
    console.log(`    USD Estimate: ${row.usd_estimate ?? 'NULL'}`);
    console.log(`    From Address: ${row.from_address.slice(0, 20)}...`);
    console.log(`    Status: ${row.status}`);
    console.log('');
  });

  // Count unique wallets
  const walletCount = await queryRows<{unique_wallets: string}>(
    `SELECT COUNT(DISTINCT from_address) as unique_wallets
     FROM executions
     WHERE status = $1`,
    ['confirmed']
  );

  console.log(`Unique Wallets (confirmed): ${walletCount[0]?.unique_wallets || 0}\n`);

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
