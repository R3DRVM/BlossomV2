#!/usr/bin/env node --import tsx
/**
 * Generate Production Access Codes
 * Inserts codes directly into production Postgres (no local storage)
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

interface GenerateOptions {
  count: number;
  label: string;
  outputFile: string;
}

async function generateProductionCodes(options: GenerateOptions): Promise<void> {
  const { count, label, outputFile } = options;

  console.log('🔐 PRODUCTION CODE GENERATION');
  console.log('════════════════════════════════════════\n');

  // Get DB identity hash (safe to print)
  const dbHash = getDatabaseIdentityHash();
  console.log(`📊 Database Identity: ${dbHash}`);
  console.log(`📝 Batch Label: ${label}`);
  console.log(`🎯 Target Count: ${count} codes\n`);

  // Generate codes
  const codes: Array<{ id: string; code: string; created_at: number }> = [];
  const now = Math.floor(Date.now() / 1000);

  for (let i = 0; i < count; i++) {
    const code = `BLOSSOM-${generateCodeSuffix()}`;
    const id = generateId();
    codes.push({ id, code, created_at: now });
  }

  console.log(`✅ Generated ${codes.length} codes\n`);

  // Insert into production Postgres
  console.log('💾 Inserting into production database...');

  let inserted = 0;
  const errors: string[] = [];

  for (const { id, code, created_at } of codes) {
    try {
      await query(`
        INSERT INTO access_codes (
          id, code, created_at, expires_at, max_uses, times_used,
          last_used_at, created_by, metadata_json
        )
        VALUES ($1, $2, $3, NULL, 1, 0, NULL, 'system', $4)
      `, [id, code, created_at, JSON.stringify({ label })]);

      inserted++;
    } catch (error: any) {
      if (error.message.includes('duplicate key')) {
        // Retry with new code
        const newCode = `BLOSSOM-${generateCodeSuffix()}`;
        try {
          await query(`
            INSERT INTO access_codes (
              id, code, created_at, expires_at, max_uses, times_used,
              last_used_at, created_by, metadata_json
            )
            VALUES ($1, $2, $3, NULL, 1, 0, NULL, 'system', $4)
          `, [id, newCode, created_at, JSON.stringify({ label })]);

          // Update our local array for export
          const idx = codes.findIndex(c => c.id === id);
          if (idx !== -1) codes[idx].code = newCode;

          inserted++;
        } catch (retryError: any) {
          errors.push(`Retry failed for ${maskCode(newCode)}: ${retryError.message}`);
        }
      } else {
        errors.push(`Failed ${maskCode(code)}: ${error.message}`);
      }
    }
  }

  console.log(`✅ Inserted ${inserted}/${count} codes into production\n`);

  if (errors.length > 0) {
    console.log(`⚠️  ${errors.length} errors occurred:`);
    errors.slice(0, 3).forEach(err => console.log(`   - ${err}`));
    if (errors.length > 3) console.log(`   ... and ${errors.length - 3} more\n`);
  }

  // Export full codes to local file (gitignored)
  const projectRoot = join(__dirname, '..', '..');
  const fullOutputPath = join(projectRoot, outputFile);

  const markdown = [
    '# Production Access Codes',
    `**Generated:** ${new Date().toISOString()}`,
    `**Label:** ${label}`,
    `**Count:** ${inserted} codes`,
    `**Database:** ${dbHash}`,
    '',
    '⚠️ **SECURITY WARNING: DO NOT COMMIT THIS FILE**',
    '',
    '## Full Codes (Single-Use)',
    '',
    '```',
    ...codes.map(c => c.code),
    '```',
    '',
    '## Usage',
    '',
    '1. Copy a code from above',
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
  console.log('📋 Sample Codes (Masked):');
  console.log('┌──────────────────────────────┐');
  codes.slice(0, 5).forEach(c => {
    console.log(`│ ${maskCode(c.code).padEnd(28)} │`);
  });
  console.log('└──────────────────────────────┘\n');

  // Count currently unused codes with this label
  const unusedResult = await query(`
    SELECT COUNT(*) as unused_count
    FROM access_codes
    WHERE metadata_json::json->>'label' = $1
      AND times_used < max_uses
      AND (expires_at IS NULL OR expires_at > $2)
  `, [label, now]);

  const unusedCount = unusedResult.rows?.[0]?.unused_count || 0;
  console.log(`📊 Currently unused codes with label "${label}": ${unusedCount}\n`);

  console.log('════════════════════════════════════════');
  console.log('✅ PRODUCTION CODE GENERATION COMPLETE');
}

/**
 * Generate 16 uppercase hex characters for code suffix
 */
function generateCodeSuffix(): string {
  return Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 16).toString(16).toUpperCase()
  ).join('');
}

/**
 * Generate 24-character hex ID
 */
function generateId(): string {
  return Array.from({ length: 24 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
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
function parseArgs(): GenerateOptions {
  const args = process.argv.slice(2);

  const countIndex = args.indexOf('--count');
  const count = countIndex !== -1 && countIndex < args.length - 1
    ? parseInt(args[countIndex + 1], 10)
    : 50;

  const labelIndex = args.indexOf('--label');
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const label = labelIndex !== -1 && labelIndex < args.length - 1
    ? args[labelIndex + 1]
    : `beta_mvp_live_d9ec4af_${today}_v1`;

  const outputIndex = args.indexOf('--output');
  const outputFile = outputIndex !== -1 && outputIndex < args.length - 1
    ? args[outputIndex + 1]
    : 'ACCESS_CODES_LOCAL.md';

  return { count, label, outputFile };
}

// Run
const options = parseArgs();
generateProductionCodes(options)
  .then(() => process.exit(0))
  .catch(error => {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  });
