#!/usr/bin/env npx tsx
/**
 * Neon Database Setup Script
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx tsx agent/scripts/setup-neon-db.ts
 *   npx tsx agent/scripts/setup-neon-db.ts --check-only
 *   npx tsx agent/scripts/setup-neon-db.ts --apply-schema
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const DIM = '\x1b[2m';
const NC = '\x1b[0m';

const args = process.argv.slice(2);
const checkOnly = args.includes('--check-only');
const applySchema = args.includes('--apply-schema');

const EXPECTED_TABLES = [
  'executions',
  'execution_steps',
  'routes',
  'sessions',
  'assets',
  'wallets',
  'intents',
  'positions',
  'indexer_state',
  'access_codes',
  'waitlist',
];

async function run() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error(`${RED}ERROR: DATABASE_URL environment variable is not set${NC}`);
    console.log(`
To set up Neon:
1. Go to https://console.neon.tech
2. Create a new project (free tier)
3. Copy the connection string
4. Run: DATABASE_URL='postgresql://...' npx tsx agent/scripts/setup-neon-db.ts
`);
    process.exit(1);
  }

  // Mask the URL for display
  const maskedUrl = databaseUrl.substring(0, 15) + '...[REDACTED]';
  console.log(`${BLUE}[neon-setup]${NC} Connecting to: ${maskedUrl}`);

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    // Test connection
    console.log(`${BLUE}[neon-setup]${NC} Testing connection...`);
    const testResult = await pool.query('SELECT NOW() as time, current_database() as db');
    console.log(`${GREEN}  ✓ Connected to database: ${testResult.rows[0].db}${NC}`);
    console.log(`${DIM}    Server time: ${testResult.rows[0].time}${NC}`);

    // Check existing tables
    console.log(`\n${BLUE}[neon-setup]${NC} Checking tables...`);
    const tablesResult = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    const existingTables = tablesResult.rows.map((r: any) => r.table_name);
    console.log(`${DIM}  Found ${existingTables.length} tables${NC}`);

    const missingTables = EXPECTED_TABLES.filter(t => !existingTables.includes(t));
    const presentTables = EXPECTED_TABLES.filter(t => existingTables.includes(t));

    for (const table of presentTables) {
      console.log(`${GREEN}  ✓ ${table}${NC}`);
    }
    for (const table of missingTables) {
      console.log(`${YELLOW}  ✗ ${table} (missing)${NC}`);
    }

    if (missingTables.length === 0) {
      console.log(`\n${GREEN}All expected tables exist!${NC}`);

      // Show some stats
      const intentCount = await pool.query('SELECT COUNT(*) as count FROM intents');
      const execCount = await pool.query('SELECT COUNT(*) as count FROM executions');
      const accessCount = await pool.query('SELECT COUNT(*) as count FROM access_codes');
      const waitlistCount = await pool.query('SELECT COUNT(*) as count FROM waitlist');

      console.log(`\n${BLUE}[neon-setup]${NC} Current data:`);
      console.log(`  Intents: ${intentCount.rows[0].count}`);
      console.log(`  Executions: ${execCount.rows[0].count}`);
      console.log(`  Access codes: ${accessCount.rows[0].count}`);
      console.log(`  Waitlist entries: ${waitlistCount.rows[0].count}`);

    } else if (applySchema) {
      console.log(`\n${BLUE}[neon-setup]${NC} Applying schema...`);

      const schemaPath = path.join(__dirname, '../execution-ledger/schema-postgres.sql');
      const schema = fs.readFileSync(schemaPath, 'utf-8');

      // Execute schema
      await pool.query(schema);

      console.log(`${GREEN}  ✓ Schema applied successfully${NC}`);

      // Verify
      const verifyResult = await pool.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name
      `);

      const newTables = verifyResult.rows.map((r: any) => r.table_name);
      const stillMissing = EXPECTED_TABLES.filter(t => !newTables.includes(t));

      if (stillMissing.length === 0) {
        console.log(`${GREEN}  ✓ All ${EXPECTED_TABLES.length} tables created${NC}`);
      } else {
        console.log(`${RED}  ✗ Still missing: ${stillMissing.join(', ')}${NC}`);
      }

    } else if (!checkOnly) {
      console.log(`\n${YELLOW}Missing ${missingTables.length} tables.${NC}`);
      console.log(`Run with --apply-schema to create them:`);
      console.log(`  DATABASE_URL='...' npx tsx agent/scripts/setup-neon-db.ts --apply-schema`);
    }

  } catch (error: any) {
    console.error(`${RED}Database error: ${error.message}${NC}`);
    if (error.code === 'ENOTFOUND') {
      console.log(`${YELLOW}Check that your DATABASE_URL hostname is correct${NC}`);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run().catch(e => {
  console.error(`${RED}Fatal error: ${e.message}${NC}`);
  process.exit(1);
});
