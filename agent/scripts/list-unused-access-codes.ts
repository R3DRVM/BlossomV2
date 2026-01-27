#!/usr/bin/env tsx
/**
 * List Unused Access Codes
 * Shows top 10 unused access codes (masked for security)
 */

import { query, getDatabaseIdentityHash } from '../execution-ledger/db-pg-client';

async function listUnusedAccessCodes(): Promise<void> {
  try {
    console.log('🔍 Fetching unused access codes...\n');

    // Get DB identity hash (safe to print)
    const dbHash = getDatabaseIdentityHash();
    console.log(`📊 Database Identity Hash: ${dbHash}\n`);

    // Query for unused codes
    const result = await query(`
      SELECT
        id,
        code,
        created_at,
        expires_at,
        max_uses,
        times_used,
        created_by
      FROM access_codes
      WHERE times_used < max_uses
        AND (expires_at IS NULL OR expires_at > $1)
      ORDER BY created_at DESC
      LIMIT 10
    `, [Math.floor(Date.now() / 1000)]);

    if (!result.rows || result.rows.length === 0) {
      console.log('❌ No unused access codes found.\n');
      return;
    }

    console.log(`✅ Found ${result.rows.length} unused codes:\n`);
    console.log('┌─────────────────────────────┬─────────────┬──────────────┬───────────┐');
    console.log('│ Code (Masked)               │ Max Uses    │ Times Used   │ Created   │');
    console.log('├─────────────────────────────┼─────────────┼──────────────┼───────────┤');

    for (const row of result.rows) {
      const maskedCode = maskCode(row.code);
      const createdDate = new Date(row.created_at * 1000).toISOString().split('T')[0];

      console.log(
        `│ ${maskedCode.padEnd(27)} │ ${String(row.max_uses).padEnd(11)} │ ` +
        `${String(row.times_used).padEnd(12)} │ ${createdDate} │`
      );
    }

    console.log('└─────────────────────────────┴─────────────┴──────────────┴───────────┘\n');
    console.log(`💡 Use check-access-code.ts --code <CODE> to check a specific code\n`);

  } catch (error: any) {
    console.error('❌ Error fetching access codes:', error.message);
    process.exit(1);
  }
}

/**
 * Mask access code for security (BLOSSOM-ABCD...WXYZ format)
 */
function maskCode(code: string): string {
  if (!code) return '****';

  if (code.startsWith('BLOSSOM-')) {
    const suffix = code.slice(8); // Remove BLOSSOM- prefix
    if (suffix.length >= 8) {
      return `BLOSSOM-${suffix.slice(0, 4)}...${suffix.slice(-4)}`;
    }
    return `BLOSSOM-${suffix.slice(0, 2)}...**`;
  }

  // Generic masking
  if (code.length >= 8) {
    return `${code.slice(0, 4)}...${code.slice(-4)}`;
  }
  return '****';
}

// Run if executed directly (ES module check)
listUnusedAccessCodes()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
