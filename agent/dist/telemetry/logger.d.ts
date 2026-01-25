/**
 * Telemetry Logger
 * Writes JSON lines to logs/telemetry.jsonl for MVP observability.
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
 * Create a scoped logger for a specific request
 */
export declare function createRequestLogger(userAddress?: string, mode?: string, authMode?: string): {
    log: (type: TelemetryEventType, payload?: Partial<TelemetryPayload>) => void;
};
//# sourceMappingURL=logger.d.ts.map