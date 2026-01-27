#!/usr/bin/env tsx
/**
 * Check Access Code
 * Lookup specific access code details
 * Usage: tsx check-access-code.ts --code <CODE>
 */

import { query, getDatabaseIdentityHash } from '../execution-ledger/db-pg-client';

async function checkAccessCode(code: string): Promise<void> {
  try {
    const normalizedCode = code.toUpperCase().trim();

    console.log(`🔍 Checking access code: ${maskCode(normalizedCode)}\n`);

    // Get DB identity hash (safe to print)
    const dbHash = getDatabaseIdentityHash();
    console.log(`📊 Database Identity Hash: ${dbHash}\n`);

    // Query for the code
    const result = await query(`
      SELECT
        id,
        code,
        created_at,
        expires_at,
        max_uses,
        times_used,
        last_used_at,
        created_by,
        metadata_json
      FROM access_codes
      WHERE code = $1
    `, [normalizedCode]);

    if (!result.rows || result.rows.length === 0) {
      console.log('❌ Access code not found in database.\n');
      console.log('💡 Possible reasons:');
      console.log('   - Code does not exist');
      console.log('   - Code format is incorrect (should be BLOSSOM-XXXXXXXXXXXXXXXX)');
      console.log('   - Code was deleted/revoked\n');
      return;
    }

    const row = result.rows[0];
    const now = Math.floor(Date.now() / 1000);

    console.log('✅ Access code found!\n');
    console.log('┌─────────────────────────┬──────────────────────────────────────┐');
    console.log('│ Field                   │ Value                                │');
    console.log('├─────────────────────────┼──────────────────────────────────────┤');
    console.log(`│ Code (Masked)           │ ${maskCode(row.code).padEnd(36)} │`);
    console.log(`│ ID                      │ ${row.id.padEnd(36)} │`);
    console.log(`│ Max Uses                │ ${String(row.max_uses).padEnd(36)} │`);
    console.log(`│ Times Used              │ ${String(row.times_used).padEnd(36)} │`);
    console.log(`│ Created By              │ ${(row.created_by || 'unknown').padEnd(36)} │`);
    console.log(`│ Created At              │ ${formatTimestamp(row.created_at).padEnd(36)} │`);

    if (row.expires_at) {
      const expired = row.expires_at <= now;
      const expiryStr = formatTimestamp(row.expires_at);
      console.log(`│ Expires At              │ ${(expiryStr + (expired ? ' (EXPIRED)' : '')).padEnd(36)} │`);
    } else {
      console.log(`│ Expires At              │ ${'Never'.padEnd(36)} │`);
    }

    if (row.last_used_at) {
      console.log(`│ Last Used At            │ ${formatTimestamp(row.last_used_at).padEnd(36)} │`);
    } else {
      console.log(`│ Last Used At            │ ${'Never'.padEnd(36)} │`);
    }

    if (row.metadata_json) {
      console.log(`│ Metadata                │ ${row.metadata_json.slice(0, 34).padEnd(36)} │`);
    }

    console.log('└─────────────────────────┴──────────────────────────────────────┘\n');

    // Determine status
    const isExpired = row.expires_at && row.expires_at <= now;
    const isUsedUp = row.times_used >= row.max_uses;
    const isValid = !isExpired && !isUsedUp;

    if (isValid) {
      console.log('✅ STATUS: VALID (can be used)\n');
    } else {
      console.log('❌ STATUS: INVALID\n');
      if (isExpired) {
        console.log('   Reason: Code has expired\n');
      }
      if (isUsedUp) {
        console.log('   Reason: Code has been fully consumed\n');
      }
    }

  } catch (error: any) {
    console.error('❌ Error checking access code:', error.message);
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

/**
 * Format Unix timestamp to readable date
 */
function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

// Parse CLI arguments
function parseArgs(): string | null {
  const args = process.argv.slice(2);
  const codeIndex = args.indexOf('--code');

  if (codeIndex === -1 || codeIndex === args.length - 1) {
    console.error('❌ Usage: tsx check-access-code.ts --code <CODE>\n');
    console.error('Example: tsx check-access-code.ts --code BLOSSOM-ABCD1234WXYZ5678\n');
    return null;
  }

  return args[codeIndex + 1];
}

// Run if executed directly (ES module check)
const code = parseArgs();
if (!code) {
  process.exit(1);
}

checkAccessCode(code)
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
