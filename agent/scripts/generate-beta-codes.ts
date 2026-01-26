#!/usr/bin/env npx tsx
/**
 * Generate Beta Access Codes
 * Single-use codes for early testers
 */

import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const COUNT = parseInt(process.argv.find(a => a.startsWith('--count='))?.split('=')[1] || '25');
const LABEL = process.argv.find(a => a.startsWith('--label='))?.split('=')[1] || 'beta_handpicked_20260125_v3';

async function main() {
  const { query } = await import('../execution-ledger/db-pg-client');

  console.log('═══════════════════════════════════════════════════════════');
  console.log('BETA ACCESS CODE GENERATION');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Count: ${COUNT}`);
  console.log(`Label: ${LABEL}`);
  console.log('');

  // Generate codes
  const codes: string[] = [];
  const now = Math.floor(Date.now() / 1000);

  console.log('Generating codes...');
  for (let i = 0; i < COUNT; i++) {
    const code = `BLOSSOM-${randomBytes(8).toString('hex').toUpperCase()}`;
    const id = randomBytes(12).toString('hex');
    codes.push(code);

    try {
      await query(`
        INSERT INTO access_codes (
          id, code, created_at, expires_at, max_uses, times_used,
          last_used_at, created_by, metadata_json
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO NOTHING
      `, [
        id,
        code,
        now,
        null, // no expiration
        1, // single-use
        0, // not used yet
        null, // not used yet
        'system',
        JSON.stringify({ label: LABEL, generated_at: new Date().toISOString() }),
      ]);
    } catch (err: any) {
      console.error(`  Error inserting code ${i + 1}: ${err.message}`);
    }

    process.stdout.write(`  [${i + 1}/${COUNT}]\r`);
  }

  console.log('');
  console.log(`✓ Generated ${COUNT} codes`);
  console.log('');

  // Write to gitignored file
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const exportPath = path.join(scriptDir, '../../ACCESS_CODES_LOCAL.md');
  const content = `# Beta Access Codes - ${LABEL}

Generated: ${new Date().toISOString()}
Count: ${COUNT}

## Codes

${codes.map((code, i) => `${i + 1}. \`${code}\``).join('\n')}

## Usage

These codes are single-use and stored in production Postgres.
Users enter the code during signup/login to gain beta access.

**DO NOT commit this file to git** - it is gitignored.
`;

  fs.writeFileSync(exportPath, content, 'utf8');
  console.log(`✓ Exported to: ${exportPath}`);
  console.log('');

  // Verify first 3 codes in DB
  console.log('Verification (first 3 codes in DB):');
  console.log('-----------------------------------------------------------');

  for (let i = 0; i < Math.min(3, codes.length); i++) {
    const result = await query(`
      SELECT code, created_at, max_uses, times_used, created_by, metadata_json
      FROM access_codes WHERE code = $1
    `, [codes[i]]);

    if (result.rows && result.rows.length > 0) {
      const row = result.rows[0];
      const metadata = row.metadata_json ? JSON.parse(row.metadata_json) : {};
      console.log(`[${i + 1}] ${row.code}`);
      console.log(`    Label: ${metadata.label || 'N/A'}`);
      console.log(`    Created: ${new Date(row.created_at * 1000).toISOString()}`);
      console.log(`    Max Uses: ${row.max_uses}`);
      console.log(`    Times Used: ${row.times_used}`);
    } else {
      console.log(`[${i + 1}] ${codes[i]} - NOT FOUND IN DB`);
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('✅ BETA CODES GENERATION COMPLETE');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
