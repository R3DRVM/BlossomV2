#!/usr/bin/env npx tsx
/**
 * Access Code Generator (Deployment Day Version)
 *
 * Generates N access codes and outputs them to:
 * 1. DATABASE (hosted Postgres via DATABASE_URL) - PREFERRED
 * 2. A local file (gitignored) for secure admin reference
 *
 * SECURITY: NEVER prints codes to console (deployment day requirement)
 *
 * Usage:
 *   npx tsx agent/scripts/generate-access-codes.ts --count=50
 *   npx tsx agent/scripts/generate-access-codes.ts --count=50 --singleUse
 *   npx tsx agent/scripts/generate-access-codes.ts --count=50 --label="beta_batch_1"
 *   npx tsx agent/scripts/generate-access-codes.ts --count=50 --label="beta_batch_1" --singleUse --writeDb
 *
 * Output file: ACCESS_CODES_LOCAL.md (NEVER commit this!)
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// Parse CLI args
const args = process.argv.slice(2);
const countArg = args.find(a => a.startsWith('--count='));
const formatArg = args.find(a => a.startsWith('--format='));
const labelArg = args.find(a => a.startsWith('--label='));
const singleUseFlag = args.includes('--singleUse');
const writeDbFlag = args.includes('--writeDb');

const COUNT = countArg ? parseInt(countArg.split('=')[1], 10) : 50;
const FORMAT = formatArg?.split('=')[1] || 'md';
const LABEL = labelArg?.split('=')[1] || null;
const MAX_USES = singleUseFlag ? 1 : 999; // 999 = effectively unlimited

/**
 * Generate a secure, readable access code
 * Format: XXXX-XXXX-XXXX (12 chars + 2 dashes)
 */
function generateCode(): string {
  // Use crypto-safe random bytes
  const bytes = crypto.randomBytes(9); // 9 bytes = 72 bits = enough entropy

  // Convert to base36 (0-9, a-z) for readability
  const chars = bytes.toString('hex').toUpperCase();

  // Take 12 chars and format as XXXX-XXXX-XXXX
  const code = chars.slice(0, 12);
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
}

/**
 * Hash a code for secure storage
 */
function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

/**
 * Write codes to database (Postgres via DATABASE_URL)
 */
async function writeCodesToDatabase(codes: Array<{ code: string; hash: string; created: string }>) {
  if (!process.env.DATABASE_URL) {
    console.warn('⚠️  DATABASE_URL not set - skipping database write');
    console.warn('   Codes will only be written to local file');
    return false;
  }

  try {
    // Use pg package (already installed in agent dependencies)
    const { default: pkg } = await import('pg');
    const { Client } = pkg;

    // Mask URL for logging (SECURITY: never log full DATABASE_URL)
    const urlMasked = process.env.DATABASE_URL.replace(/\/\/[^@]+@/, '//<credentials>@');
    console.log(`[db] Connecting to database: ${urlMasked.split('?')[0]}...`);

    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
    });

    await client.connect();
    console.log('[db] Connected successfully');

    // Insert codes into access_codes table
    const now = Math.floor(Date.now() / 1000); // Unix timestamp

    let inserted = 0;
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      const id = `ac_${crypto.randomBytes(8).toString('hex')}`;
      const metadata = JSON.stringify({
        label: LABEL,
        singleUse: singleUseFlag,
        generatedAt: c.created,
        batchIndex: i + 1,
      });

      try {
        await client.query(
          `INSERT INTO access_codes (id, code, created_at, expires_at, max_uses, times_used, last_used_at, created_by, metadata_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [id, c.code, now, null, MAX_USES, 0, null, LABEL || 'generate-access-codes-script', metadata]
        );
        inserted++;
      } catch (err: any) {
        // Check for unique constraint violation (code already exists)
        if (err.code === '23505') {
          console.warn(`⚠️  Code ${i + 1} already exists in database (skipping)`);
        } else {
          throw err;
        }
      }
    }

    await client.end();
    console.log(`✅ Wrote ${inserted} codes to database (${codes.length - inserted} duplicates skipped)`);
    return true;
  } catch (error: any) {
    console.error('❌ Failed to write to database:', error.message);
    return false;
  }
}

// Generate codes
const codes: { code: string; hash: string; created: string }[] = [];
const now = new Date().toISOString();

for (let i = 0; i < COUNT; i++) {
  const code = generateCode();
  codes.push({
    code,
    hash: hashCode(code),
    created: now,
  });
}

// Main execution (async wrapper)
async function main() {
  // Write to database if flag is set
  if (writeDbFlag) {
    await writeCodesToDatabase(codes);
  }

  // Output to file
  const outputDir = path.resolve(process.cwd());
  const outputFile = path.join(outputDir, 'ACCESS_CODES_LOCAL.md');

  if (FORMAT === 'csv') {
    // CSV format for import
    const csv = [
      'code,hash,created,max_uses,label',
      ...codes.map(c => `${c.code},${c.hash},${c.created},${MAX_USES},${LABEL || ''}`),
    ].join('\n');

    fs.writeFileSync(outputFile.replace('.md', '.csv'), csv);
    console.log(`\n✅ Generated ${COUNT} access codes`);
    console.log(`📄 Wrote codes to: ${outputFile.replace('.md', '.csv')}`);
  } else if (FORMAT === 'env') {
    // ENV format (comma-separated codes for WHITELIST_ACCESS_CODES)
    const envValue = codes.map(c => c.code).join(',');
    const envFile = path.join(outputDir, 'ACCESS_CODES_LOCAL_ENV.txt');
    fs.writeFileSync(envFile, `WHITELIST_ACCESS_CODES=${envValue}\n`);
    console.log(`\n✅ Generated ${COUNT} access codes`);
    console.log(`📄 Wrote ENV format to: ${envFile}`);
    console.log('\n⚠️  SECURITY: Codes are in the file above. Do NOT print to console!\n');
  } else {
    // Markdown format (default) - DEPLOYMENT DAY VERSION (no console print)
    const md = `# Blossom Access Codes

**Generated:** ${now}
**Count:** ${COUNT}
**Max Uses:** ${MAX_USES} ${singleUseFlag ? '(single-use)' : '(multi-use)'}
**Label:** ${LABEL || 'none'}

## IMPORTANT SECURITY NOTICE

- This file is GITIGNORED and must NEVER be committed
- Store these codes securely (password manager recommended)
- NEVER print codes to console or logs
- Share codes individually with authorized users only

## Access Codes

| # | Code | Hash (first 16 chars) | Max Uses |
|---|------|----------------------|----------|
${codes.map((c, i) => `| ${i + 1} | \`${c.code}\` | ${c.hash.slice(0, 16)}... | ${MAX_USES} |`).join('\n')}

## Database Status

${writeDbFlag ? '✅ Codes written to database (access_codes table)' : '⚠️  NOT written to database (use --writeDb flag)'}

## Usage Instructions

### For Testers
1. Copy individual code from table above
2. Visit https://app.blossom.onl
3. Enter code at access gate
4. Code will be validated against database

### For Verification
Use the validation endpoint (requires LEDGER_SECRET):
\`\`\`bash
curl -X POST https://api.blossom.onl/api/access/validate \\
  -H "Content-Type: application/json" \\
  -H "x-ledger-secret: <secret>" \\
  -d '{"code": "<code-from-table>"}'
\`\`\`

## Batch Metadata

- **Batch Label**: ${LABEL || 'unlabeled'}
- **Single Use**: ${singleUseFlag ? 'Yes' : 'No'}
- **Generated At**: ${now}
- **Created By**: generate-access-codes-script
`;

    fs.writeFileSync(outputFile, md);
    console.log(`\n✅ Generated ${COUNT} access codes`);
    console.log(`📄 Wrote codes to: ${outputFile}`);
    console.log(`   Label: ${LABEL || 'none'}`);
    console.log(`   Max uses: ${MAX_USES}`);
    console.log(`   Database: ${writeDbFlag ? 'WRITTEN ✅' : 'NOT WRITTEN (use --writeDb)'}`);
    console.log('\n⚠️  SECURITY: Codes are in the file above. Do NOT print to console!');
    console.log('⚠️  This file is gitignored. Do NOT commit it!\n');
  }
}

// Run main
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
