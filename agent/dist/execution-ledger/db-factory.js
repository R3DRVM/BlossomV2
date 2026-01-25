"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectDatabaseType = detectDatabaseType;
exports.getDatabaseInfo = getDatabaseInfo;
exports.logDatabaseInfo = logDatabaseInfo;
/**
 * Detect which database to use based on environment
 */
function detectDatabaseType() {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl && (databaseUrl.startsWith('postgres') || databaseUrl.startsWith('postgresql'))) {
        return 'postgres';
    }
    return 'sqlite';
}
/**
 * Get human-readable database info for logging
 */
function getDatabaseInfo() {
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
function logDatabaseInfo() {
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
__exportStar(require("./db"), exports);
//# sourceMappingURL=db-factory.js.map