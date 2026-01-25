/**
 * Telemetry Logger
 * Writes JSON lines to logs/telemetry.jsonl for MVP observability.
 * Also writes to SQLite database for structured queries.
 * Privacy-preserving: user addresses are hashed with TELEMETRY_SALT.
 */
/**
 * Hash a user address for privacy
 */
export declare function hashAddress(address: string): string;
/**
 * Telemetry event types
 */
export type TelemetryEventType = 'chat_request' | 'chat_response' | 'prepare_success' | 'prepare_fail' | 'approve_prepare' | 'submit_tx' | 'relayed_tx' | 'session_prepare' | 'tx_confirmed' | 'tx_failed' | 'tx_timeout' | 'preflight_check' | 'execution_complete' | 'error';
/**
 * Telemetry event payload
 */
export interface TelemetryPayload {
    mode?: 'sim' | 'eth_testnet';
    authMode?: 'direct' | 'session';
    draftId?: string;
    userHash?: string;
    txHash?: string;
    actionTypes?: number[];
    blockNumber?: number;
    success?: boolean;
    error?: string;
    latencyMs?: number;
    notes?: string[];
    executionKind?: string;
    venue?: string;
}
/**
 * Log a telemetry event
 * Fail open: never crashes the server, silently fails if logging is unavailable
 */
export declare function logEvent(type: TelemetryEventType, payload: TelemetryPayload): void;
/**
 * Track an execution in the SQLite database
 */
export declare function trackExecution(params: {
    userAddress: string;
    draftId?: string;
    correlationId?: string;
    action: string;
    token?: string;
    amountUnits?: string;
    mode?: string;
}): Promise<string | null>;
/**
 * Update an execution with results
 */
export declare function updateExecutionResult(correlationId: string, result: {
    status: 'submitted' | 'confirmed' | 'failed';
    txHash?: string;
    errorCode?: string;
    errorMessage?: string;
    latencyMs?: number;
}): Promise<void>;
/**
 * Track session status
 */
export declare function trackSessionStatus(userAddress: string, sessionId: string, status: string, expiresAt?: number): Promise<void>;
/**
 * Log a request to the database
 */
export declare function logRequestToDb(params: {
    endpoint: string;
    method?: string;
    userAddress?: string;
    correlationId?: string;
    statusCode?: number;
    latencyMs?: number;
    errorCode?: string;
}): Promise<void>;
/**
 * Create a scoped logger for a specific request
 */
export declare function createRequestLogger(userAddress?: string, mode?: string, authMode?: string): {
    log: (type: TelemetryEventType, payload?: Partial<TelemetryPayload>) => void;
};
//# sourceMappingURL=logger.d.ts.map