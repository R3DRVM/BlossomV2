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
/**
 * Detect which database to use based on environment
 */
export function detectDatabaseType() {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl && (databaseUrl.startsWith('postgres') || databaseUrl.startsWith('postgresql'))) {
        return 'postgres';
    }
    return 'sqlite';
}
/**
 * Get human-readable database info for logging
 */
export function getDatabaseInfo() {
    const type = detectDatabaseType();
    if (type === 'postgres') {
        // Redact password from URL for logging
        const url = process.env.DATABASE_URL || '';
        const redactedUrl = url.replace(/:([^:@]+)@/, ':***@');
        return { type, url: redactedUrl };
    }
    return { type };
}
/**
 * Log database connection info on startup
 */
export function logDatabaseInfo() {
    const info = getDatabaseInfo();
    if (info.type === 'postgres') {
        console.log(`🗄️  Database: PostgreSQL`);
        console.log(`   URL: ${info.url}`);
    }
    else {
        console.log(`🗄️  Database: SQLite (local development)`);
        console.log(`   Path: agent/execution-ledger/ledger.db`);
    }
}
// Re-export the main database module
// The db.ts module handles the actual implementation
export * from './db';
//# sourceMappingURL=db-factory.js.map