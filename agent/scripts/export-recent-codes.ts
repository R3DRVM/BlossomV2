#!/usr/bin/env node --import tsx
/**
 * Export Recently Generated Access Codes
 * Retrieves codes from production Postgres and exports to local file
 *
 * SECURITY:
 * - Full codes exported ONLY to ACCESS_CODES_LOCAL.md (gitignored)
 * - Console output shows ONLY masked codes
 */

import { query, getDatabaseIdentityHash } from '../execution-ledger/db-pg-client';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ExportOptions {
  label: string;
  outputFile: string;
}

async function exportRecentCodes(options: ExportOptions): Promise<void> {
  const { label, outputFile } = options;

  console.log('📤 EXPORTING PRODUCTION CODES');
  console.log('════════════════════════════════════════\n');

  // Get DB identity hash (safe to print)
  const dbHash = getDatabaseIdentityHash();
  console.log(`📊 Database Identity: ${dbHash}`);
  console.log(`📝 Label Filter: ${label}\n`);

  // Query for codes with this label
  const result = await query(`
    SELECT code, created_at, times_used, max_uses
    FROM access_codes
    WHERE metadata_json::json->>'label' = $1
    ORDER BY created_at DESC
    LIMIT 100
  `, [label]);

  if (!result.rows || result.rows.length === 0) {
    console.log(`❌ No codes found with label "${label}"\n`);
    return;
  }

  const codes = result.rows;
  const unusedCodes = codes.filter(c => c.times_used < c.max_uses);

  console.log(`✅ Found ${codes.length} codes with label "${label}"`);
  console.log(`   Unused: ${unusedCodes.length}`);
  console.log(`   Used: ${codes.length - unusedCodes.length}\n`);

  // Export full codes to local file (gitignored)
  const projectRoot = join(__dirname, '..', '..');
  const fullOutputPath = join(projectRoot, outputFile);

  const markdown = [
    '# Production Access Codes',
    `**Generated:** ${new Date().toISOString()}`,
    `**Label:** ${label}`,
    `**Total Count:** ${codes.length} codes`,
    `**Unused Count:** ${unusedCodes.length} codes`,
    `**Database:** ${dbHash}`,
    '',
    '⚠️ **SECURITY WARNING: DO NOT COMMIT THIS FILE**',
    '',
    '## Full Codes (Single-Use)',
    '',
    '### Unused Codes',
    '```',
    ...unusedCodes.map(c => c.code),
    '```',
    '',
    ...(codes.length > unusedCodes.length ? [
      '### Used Codes (For Reference)',
      '```',
      ...codes.filter(c => c.times_used >= c.max_uses).map(c => c.code),
      '```',
      '',
    ] : []),
    '## Usage',
    '',
    '1. Copy an unused code from above',
    '2. Visit https://app.blossom.onl',
    '3. Click "I have an access code"',
    '4. Paste code and click "Unlock Access"',
    '5. Code will be consumed and cannot be reused',
    '',
  ].join('\n');

  writeFileSync(fullOutputPath, markdown, 'utf8');
  console.log(`📄 Full codes exported to: ${outputFile}`);
  console.log(`   (This file is gitignored - DO NOT commit)\n`);

  // Show masked samples
  console.log('📋 Sample Unused Codes (Masked):');
  console.log('┌──────────────────────────────┐');
  unusedCodes.slice(0, 5).forEach(c => {
    console.log(`│ ${maskCode(c.code).padEnd(28)} │`);
  });
  if (unusedCodes.length > 5) {
    console.log(`│ ... and ${unusedCodes.length - 5} more`.padEnd(29) + '│');
  }
  console.log('└──────────────────────────────┘\n');

  console.log('════════════════════════════════════════');
  console.log('✅ EXPORT COMPLETE');
}

/**
 * Mask code for console output (BLOSSOM-ABCD...789A)
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

  return code.length >= 8 ? `${code.slice(0, 4)}...${code.slice(-4)}` : '****';
}

// Parse CLI arguments
function parseArgs(): ExportOptions {
  const args = process.argv.slice(2);

  const labelIndex = args.indexOf('--label');
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const label = labelIndex !== -1 && labelIndex < args.length - 1
    ? args[labelIndex + 1]
    : `beta_mvp_live_d9ec4af_${today}_v1`;

  const outputIndex = args.indexOf('--output');
  const outputFile = outputIndex !== -1 && outputIndex < args.length - 1
    ? args[outputIndex + 1]
    : 'ACCESS_CODES_LOCAL.md';

  return { label, outputFile };
}

// Run
const options = parseArgs();
exportRecentCodes(options)
  .then(() => process.exit(0))
  .catch(error => {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  });
