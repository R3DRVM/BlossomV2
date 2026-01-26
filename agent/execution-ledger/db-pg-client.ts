/**
 * PostgreSQL Client for Execution Ledger
 * Serverless-safe connection pooling for Neon/Vercel production deployments
 */

import pkg from 'pg';
const { Pool } = pkg;
import type { Pool as PgPool, PoolClient, QueryResult } from 'pg';
import { createHash } from 'crypto';

// Global pool cache for serverless (prevents connection exhaustion)
declare global {
  var __pgPool: PgPool | undefined;
}

let pool: PgPool | null = null;

/**
 * Get or create PostgreSQL pool with SSL enabled
 */
export function getPgPool(): PgPool {
  if (pool) return pool;

  // Check for existing global pool (serverless warm start)
  if (global.__pgPool) {
    pool = global.__pgPool;
    return pool;
  }

  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL not set for Postgres mode');
  }

  // Create new pool with SSL required
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
      rejectUnauthorized: true,
    },
    max: 1, // Serverless: minimize connections
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  // Cache globally for serverless
  global.__pgPool = pool;

  console.log('🗄️  PostgreSQL pool initialized (Neon)');
  return pool;
}

/**
 * Execute a query with automatic parameter conversion
 */
export async function query<T = any>(
  sql: string,
  params: any[] = []
): Promise<QueryResult<any>> {
  const pool = getPgPool();
  return pool.query(sql, params) as any;
}

/**
 * Execute a query and return rows
 */
export async function queryRows<T = any>(
  sql: string,
  params: any[] = []
): Promise<T[]> {
  const result = await query<T>(sql, params);
  return result.rows;
}

/**
 * Execute a query and return first row or undefined
 */
export async function queryOne<T = any>(
  sql: string,
  params: any[] = []
): Promise<T | undefined> {
  const rows = await queryRows<T>(sql, params);
  return rows[0];
}

/**
 * Execute multiple statements (transaction)
 */
export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pool = getPgPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Close the pool (for graceful shutdown)
 */
export async function closePgPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    global.__pgPool = undefined;
    console.log('🗄️  PostgreSQL pool closed');
  }
}

/**
 * Get a safe database identity hash for verifying same-DB across endpoints
 * SECURITY: This hash is computed from non-secret identifiers only (host, database name, SSL mode)
 * NEVER includes passwords or sensitive connection parameters
 */
export function getDatabaseIdentityHash(): string {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    return 'no-database-url';
  }

  try {
    // Parse DATABASE_URL to extract non-secret identifiers
    const url = new URL(DATABASE_URL);

    // Build identity string from non-secret components
    const identityString = [
      url.hostname,           // e.g., "ep-cool-darkness-123456.us-east-2.aws.neon.tech"
      url.pathname.slice(1),  // database name (remove leading /)
      url.protocol,           // postgres: or postgresql:
      'ssl:required',         // Our SSL mode (hardcoded in config)
    ].join('|');

    // Create SHA-256 hash
    const hash = createHash('sha256')
      .update(identityString)
      .digest('hex');

    // Return first 16 chars for brevity
    return hash.slice(0, 16);
  } catch (error) {
    console.error('Error generating DB identity hash:', error);
    return 'hash-error';
  }
}

/**
 * Convert SQLite-style ? placeholders to Postgres $1, $2, etc.
 */
export function convertPlaceholders(sql: string): string {
  let index = 1;
  return sql.replace(/\?/g, () => `$${index++}`);
}
