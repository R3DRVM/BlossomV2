/**
 * Database Factory
 * Provides a unified interface for SQLite (local) and Postgres (production)
 *
 * Usage:
 *   - Local dev: Uses SQLite (default, via better-sqlite3)
 *   - Production: Uses Postgres (via DATABASE_URL env var)
 *
 * Detection:
 *   - If DATABASE_URL is set and starts with 'postgres', use Postgres
 *   - Otherwise, use SQLite
 */
export type DatabaseType = 'sqlite' | 'postgres';
/**
 * Detect which database to use based on environment
 */
export declare function detectDatabaseType(): DatabaseType;
/**
 * Get human-readable database info for logging
 */
export declare function getDatabaseInfo(): {
    type: DatabaseType;
    url?: string;
};
/**
 * Log database connection info on startup
 */
export declare function logDatabaseInfo(): void;
export * from './db';
//# sourceMappingURL=db-factory.d.ts.map