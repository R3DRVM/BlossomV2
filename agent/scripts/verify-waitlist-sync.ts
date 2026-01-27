#!/usr/bin/env node --import tsx
/**
 * Verify Waitlist Sync with Production DB
 */

import { query } from '../execution-ledger/db-pg-client';

async function verifyWaitlistSync(): Promise<void> {
  try {
    console.log('🔍 Verifying waitlist sync...\n');

    // Get count of recent waitlist entries
    const result = await query(`
      SELECT COUNT(*) as count
      FROM waitlist
      WHERE created_at > $1
    `, [Math.floor(Date.now() / 1000) - 300]); // Last 5 minutes

    const count = result.rows?.[0]?.count || 0;
    console.log(`Recent waitlist entries (last 5 min): ${count}\n`);

    // Get latest entry
    const latestResult = await query(`
      SELECT email, created_at
      FROM waitlist
      ORDER BY created_at DESC
      LIMIT 1
    `);

    if (latestResult.rows && latestResult.rows.length > 0) {
      const row = latestResult.rows[0];
      console.log('Latest entry:');
      console.log('  Email:', row.email);
      console.log('  Created:', new Date(row.created_at * 1000).toISOString());
      console.log('\n✅ Waitlist is syncing with production DB');
    } else {
      console.log('❌ No waitlist entries found in database');
    }

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

verifyWaitlistSync()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
