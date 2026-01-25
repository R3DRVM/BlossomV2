/**
 * Bloom Telemetry Database
 * SQLite-based telemetry for tracking users, sessions, and executions
 */
import Database from 'better-sqlite3';
/**
 * Initialize the database connection and run migrations
 */
export declare function initDatabase(): Database.Database;
/**
 * Get the database instance (initializes if needed)
 */
export declare function getDatabase(): Database.Database;
/**
 * Close the database connection
 */
export declare function closeDatabase(): void;
export interface User {
    id: string;
    address: string;
    created_at: number;
    notes?: string;
}
export declare function upsertUser(address: string, notes?: Record<string, any>): User;
export declare function getUser(address: string): User | undefined;
export declare function listUsers(limit?: number, offset?: number): User[];
export interface Session {
    id: string;
    user_address: string;
    session_id: string;
    status: string;
    expires_at?: number;
    created_at: number;
    updated_at: number;
}
export declare function upsertSession(userAddress: string, sessionId: string, status: string, expiresAt?: number): Session;
export declare function getLatestSession(userAddress: string): Session | undefined;
export interface Execution {
    id: string;
    user_address: string;
    draft_id?: string;
    correlation_id?: string;
    action: string;
    token?: string;
    amount_units?: string;
    mode: string;
    status: string;
    tx_hash?: string;
    error_code?: string;
    error_message?: string;
    created_at: number;
    updated_at: number;
    latency_ms?: number;
}
export declare function createExecution(params: {
    userAddress: string;
    draftId?: string;
    correlationId?: string;
    action: string;
    token?: string;
    amountUnits?: string;
    mode?: string;
}): Execution;
export declare function updateExecution(id: string, updates: {
    status?: string;
    txHash?: string;
    errorCode?: string;
    errorMessage?: string;
    latencyMs?: number;
}): void;
export declare function updateExecutionByCorrelationId(correlationId: string, updates: {
    status?: string;
    txHash?: string;
    errorCode?: string;
    errorMessage?: string;
    latencyMs?: number;
}): void;
export declare function getExecution(id: string): Execution | undefined;
export declare function listExecutions(limit?: number, offset?: number): Execution[];
export declare function logRequest(params: {
    endpoint: string;
    method?: string;
    userAddress?: string;
    correlationId?: string;
    statusCode?: number;
    latencyMs?: number;
    errorCode?: string;
}): void;
export interface TelemetrySummary {
    totalUsers: number;
    totalSessions: number;
    activeSessions: number;
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    successRate: number;
    avgLatencyMs: number | null;
    topErrors: {
        error_code: string;
        count: number;
    }[];
    recentExecutions: Execution[];
}
export declare function getTelemetrySummary(): TelemetrySummary;
export declare function getUsersWithSessionStatus(): Array<User & {
    session_status?: string;
    session_id?: string;
}>;
export interface DevnetStats {
    users: {
        allTime: number;
        last24h: number;
    };
    transactions: {
        allTime: number;
        last24h: number;
        successCount: number;
        failCount: number;
    };
    amountExecuted: {
        byToken: Array<{
            token: string;
            totalUnits: string;
        }>;
        unpricedCount: number;
    };
    feesCollected: {
        byToken: Array<{
            token: string;
            totalFeeUnits: string;
            last24hFeeUnits: string;
        }>;
        feeBps: number;
        unpricedCount: number;
    };
    generatedAt: string;
}
/**
 * Get comprehensive devnet statistics for landing page
 */
export declare function getDevnetStats(feeBps: number): DevnetStats;
/**
 * Update execution with fee information (call after successful execution)
 */
export declare function updateExecutionWithFee(id: string, amountUnits: string | undefined, feeBps: number): void;
export interface TrafficStats {
    requests: {
        allTime: number;
        last24h: number;
        successRate24h: number;
        http5xx24h: number;
    };
    visitors: {
        allTime: number;
        last24h: number;
    };
    generatedAt: string;
}
/**
 * Get traffic statistics (HTTP request-level metrics)
 * This is separate from execution stats which track on-chain transactions
 */
export declare function getTrafficStats(windowHours?: number): TrafficStats;
/**
 * Get request log stats for load test reports
 */
export declare function getRequestLogStats(runId?: string): {
    totalRequests: number;
    byEndpoint: Array<{
        endpoint: string;
        count: number;
        successCount: number;
        avgLatencyMs: number;
        p95LatencyMs: number;
    }>;
    errorCodes: Array<{
        code: string;
        count: number;
    }>;
    http5xxCount: number;
};
/**
 * Get recent transaction hashes for reporting
 */
export declare function getRecentTxHashes(limit?: number): string[];
/**
 * Migrate database to add fee columns if they don't exist
 */
export declare function migrateAddFeeColumns(): void;
export interface DevnetRun {
    run_id: string;
    stage: number | null;
    users: number;
    concurrency: number;
    duration: number;
    total_requests: number;
    success_rate: number;
    p50_ms: number;
    p95_ms: number;
    http_5xx: number;
    top_error_code: string | null;
    started_at: string;
    ended_at: string;
    report_path: string | null;
    created_at: number;
}
/**
 * Ensure runs table exists
 */
export declare function ensureRunsTable(): void;
/**
 * Insert or update a run record
 */
export declare function upsertRun(run: Omit<DevnetRun, 'created_at'>): void;
/**
 * List recent devnet traffic runs
 */
export declare function listRuns(limit?: number): DevnetRun[];
/**
 * Get a specific run by run_id
 */
export declare function getRun(runId: string): DevnetRun | undefined;
//# sourceMappingURL=db.d.ts.map