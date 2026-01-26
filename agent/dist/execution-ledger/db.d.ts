/**
 * Bloom Execution Ledger Database
 * Supports both SQLite (local dev) and Postgres (production)
 *
 * Mode selection:
 * - Local: Uses SQLite (default) when DATABASE_URL is not set
 * - Production: Uses Postgres when DATABASE_URL is set
 *
 * Note: The synchronous functions below work with SQLite.
 * For Postgres support in production, use the async helpers or
 * run setup-neon-db.ts to initialize the Postgres schema.
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
export type Chain = 'ethereum' | 'solana';
export type Network = 'sepolia' | 'devnet' | 'mainnet';
export type ExecutionStatus = 'pending' | 'submitted' | 'confirmed' | 'finalized' | 'failed';
export type SessionStatus = 'preparing' | 'active' | 'revoked' | 'expired';
export type ExecutionKind = 'perp' | 'deposit' | 'bridge' | 'swap' | 'proof' | 'relay' | 'transfer';
export type ExecutionVenue = 'drift' | 'hl' | 'hyperliquid' | 'perp_demo' | 'aave' | 'kamino' | 'deposit_demo' | 'lifi' | 'wormhole' | 'bridge_demo' | 'uniswap' | 'jupiter' | 'swap_demo' | 'native';
export interface Execution {
    id: string;
    chain: Chain;
    network: Network;
    kind?: ExecutionKind;
    venue?: ExecutionVenue;
    intent: string;
    action: string;
    from_address: string;
    to_address?: string;
    token?: string;
    amount_units?: string;
    amount_display?: string;
    usd_estimate?: number;
    usd_estimate_is_estimate?: number;
    tx_hash?: string;
    status: ExecutionStatus;
    error_code?: string;
    error_message?: string;
    explorer_url?: string;
    gas_used?: string;
    block_number?: number;
    latency_ms?: number;
    relayer_address?: string;
    session_id?: string;
    created_at: number;
    updated_at: number;
}
export interface Route {
    id: string;
    execution_id: string;
    step_index: number;
    action_type: number;
    adapter_address?: string;
    target_address?: string;
    encoded_data?: string;
    status: string;
    tx_hash?: string;
    created_at: number;
}
export interface Session {
    id: string;
    chain: Chain;
    network: Network;
    user_address: string;
    session_id: string;
    relayer_address?: string;
    status: SessionStatus;
    expires_at?: number;
    created_tx?: string;
    revoked_tx?: string;
    created_at: number;
    updated_at: number;
}
export interface Asset {
    id: string;
    chain: Chain;
    network: Network;
    wallet_address: string;
    token_address?: string;
    token_symbol: string;
    balance_units?: string;
    balance_display?: string;
    last_tx_hash?: string;
    updated_at: number;
}
export interface Wallet {
    id: string;
    chain: Chain;
    network: Network;
    address: string;
    label?: string;
    is_primary: number;
    created_at: number;
}
export declare function createExecution(params: {
    chain: Chain;
    network: Network;
    kind?: ExecutionKind;
    venue?: ExecutionVenue;
    intent: string;
    action: string;
    fromAddress: string;
    toAddress?: string;
    token?: string;
    amountUnits?: string;
    amountDisplay?: string;
    usdEstimate?: number;
    usdEstimateIsEstimate?: boolean;
    relayerAddress?: string;
    sessionId?: string;
}): Execution;
export declare function updateExecution(id: string, updates: Partial<{
    status: ExecutionStatus;
    kind: ExecutionKind;
    venue: ExecutionVenue;
    txHash: string;
    explorerUrl: string;
    errorCode: string;
    errorMessage: string;
    gasUsed: string;
    blockNumber: number;
    latencyMs: number;
    usdEstimate: number;
    usdEstimateIsEstimate: boolean;
    relayerAddress: string;
    sessionId: string;
}>): void;
export declare function getExecution(id: string): Execution | undefined;
export declare function getExecutionByTxHash(txHash: string): Execution | undefined;
export interface ListResult<T> {
    data: T[];
    meta: {
        totalInDb: number;
        limit: number;
        offset: number;
    };
}
export declare function countExecutions(params?: {
    chain?: Chain;
    network?: Network;
    status?: ExecutionStatus;
}): number;
export declare function listExecutions(params?: {
    chain?: Chain;
    network?: Network;
    status?: ExecutionStatus;
    limit?: number;
    offset?: number;
}): Execution[];
export declare function listExecutionsWithMeta(params?: {
    chain?: Chain;
    network?: Network;
    status?: ExecutionStatus;
    limit?: number;
    offset?: number;
}): ListResult<Execution>;
export declare function createRoute(params: {
    executionId: string;
    stepIndex: number;
    actionType: number;
    adapterAddress?: string;
    targetAddress?: string;
    encodedData?: string;
}): Route;
export declare function getRoutesForExecution(executionId: string): Route[];
export declare function updateRoute(id: string, updates: {
    status?: string;
    txHash?: string;
}): void;
export declare function upsertSession(params: {
    chain: Chain;
    network: Network;
    userAddress: string;
    sessionId: string;
    relayerAddress?: string;
    status: SessionStatus;
    expiresAt?: number;
    createdTx?: string;
}): Session;
export declare function countSessions(params?: {
    chain?: Chain;
    network?: Network;
    status?: SessionStatus;
}): number;
export declare function listSessions(params?: {
    chain?: Chain;
    network?: Network;
    status?: SessionStatus;
    limit?: number;
}): Session[];
export declare function listSessionsWithMeta(params?: {
    chain?: Chain;
    network?: Network;
    status?: SessionStatus;
    limit?: number;
}): ListResult<Session>;
export declare function upsertAsset(params: {
    chain: Chain;
    network: Network;
    walletAddress: string;
    tokenAddress?: string;
    tokenSymbol: string;
    balanceUnits?: string;
    balanceDisplay?: string;
    lastTxHash?: string;
}): Asset;
export declare function countAssets(params?: {
    chain?: Chain;
    network?: Network;
    walletAddress?: string;
}): number;
export declare function listAssets(params?: {
    chain?: Chain;
    network?: Network;
    walletAddress?: string;
    limit?: number;
}): Asset[];
export declare function listAssetsWithMeta(params?: {
    chain?: Chain;
    network?: Network;
    walletAddress?: string;
    limit?: number;
}): ListResult<Asset>;
export declare function registerWallet(params: {
    chain: Chain;
    network: Network;
    address: string;
    label?: string;
    isPrimary?: boolean;
}): Wallet;
export declare function getPrimaryWallet(chain: Chain, network: Network): Wallet | undefined;
export declare function listWallets(params?: {
    chain?: Chain;
    network?: Network;
}): Wallet[];
export interface LedgerSummary {
    totalExecutions: number;
    confirmedExecutions: number;
    failedExecutions: number;
    successRate: number;
    byChain: {
        chain: string;
        count: number;
        confirmed: number;
    }[];
    activeSessions: number;
    trackedAssets: number;
    registeredWallets: number;
    recentExecutions: Execution[];
}
export declare function getLedgerSummary(): LedgerSummary;
/**
 * Get all confirmed transaction hashes for proof bundle
 */
export declare function getProofBundle(): {
    ethereum: {
        txHash: string;
        explorerUrl: string;
        action: string;
        createdAt: number;
    }[];
    solana: {
        txHash: string;
        explorerUrl: string;
        action: string;
        createdAt: number;
    }[];
};
export interface ExecutionStep {
    id: string;
    execution_id: string;
    step_index: number;
    action: string;
    stage?: string;
    tx_hash?: string;
    explorer_url?: string;
    status: string;
    error_code?: string;
    error_message?: string;
    created_at: number;
}
export declare function createExecutionStep(params: {
    executionId: string;
    stepIndex: number;
    action: string;
    stage?: string;
}): ExecutionStep;
export declare function updateExecutionStep(id: string, updates: Partial<{
    status: string;
    stage: string;
    txHash: string;
    explorerUrl: string;
    errorCode: string;
    errorMessage: string;
}>): void;
export declare function getExecutionSteps(executionId: string): ExecutionStep[];
export interface StatsSummary {
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    successRate: number;
    successRateRaw: number;
    successRateAdjusted: number;
    uniqueWallets: number;
    totalUsdRouted: number;
    relayedTxCount: number;
    chainsActive: string[];
    byKind: {
        kind: string;
        count: number;
        usdTotal: number;
    }[];
    byVenue: {
        venue: string;
        count: number;
        usdTotal: number;
    }[];
    byChain: {
        chain: string;
        network: string;
        count: number;
        successCount: number;
        failedCount: number;
    }[];
    avgLatencyMs: number;
    lastExecutionAt: number | null;
}
export declare function getSummaryStats(): StatsSummary;
export declare function getRecentExecutions(limit?: number): Execution[];
export type IntentKind = 'perp' | 'deposit' | 'swap' | 'bridge' | 'unknown';
export type IntentStatus = 'queued' | 'planned' | 'routed' | 'executing' | 'confirmed' | 'failed';
export type IntentFailureStage = 'plan' | 'route' | 'execute' | 'confirm' | 'quote';
export interface Intent {
    id: string;
    created_at: number;
    intent_text: string;
    intent_kind?: IntentKind;
    requested_chain?: string;
    requested_venue?: string;
    usd_estimate?: number;
    status: IntentStatus;
    planned_at?: number;
    executed_at?: number;
    confirmed_at?: number;
    failure_stage?: IntentFailureStage;
    error_code?: string;
    error_message?: string;
    metadata_json?: string;
}
export declare function createIntent(params: {
    intentText: string;
    intentKind?: IntentKind;
    requestedChain?: string;
    requestedVenue?: string;
    usdEstimate?: number;
    metadataJson?: string;
}): Intent;
export declare function updateIntentStatus(id: string, updates: Partial<{
    status: IntentStatus;
    intentKind: IntentKind;
    requestedChain: string;
    requestedVenue: string;
    usdEstimate: number;
    plannedAt: number;
    executedAt: number;
    confirmedAt: number;
    failureStage: IntentFailureStage;
    errorCode: string;
    errorMessage: string;
    metadataJson: string;
}>): void;
export declare function getIntent(id: string): Intent | undefined;
export declare function getRecentIntents(limit?: number): Intent[];
export interface IntentStatsSummary {
    totalIntents: number;
    confirmedIntents: number;
    failedIntents: number;
    intentSuccessRate: number;
    byKind: {
        kind: string;
        count: number;
        confirmed: number;
        failed: number;
    }[];
    byStatus: {
        status: string;
        count: number;
    }[];
    failuresByStage: {
        stage: string;
        count: number;
    }[];
    failuresByCode: {
        code: string;
        count: number;
    }[];
    recentIntents: Intent[];
}
export declare function getIntentStatsSummary(): IntentStatsSummary;
export declare function linkExecutionToIntent(executionId: string, intentId: string): void;
export declare function getExecutionsForIntent(intentId: string): Execution[];
export declare function getSummaryStatsWithIntents(): StatsSummary & {
    totalIntents: number;
    intentSuccessRate: number;
    failedIntentsByStage: {
        stage: string;
        count: number;
    }[];
};
export interface Position {
    id: string;
    chain: 'ethereum' | 'solana';
    network: string;
    venue: string;
    market: string;
    side: 'long' | 'short';
    leverage?: number;
    margin_units?: string;
    margin_display?: string;
    size_units?: string;
    entry_price?: string;
    status: 'open' | 'closed' | 'liquidated';
    opened_at: number;
    closed_at?: number;
    open_tx_hash?: string;
    open_explorer_url?: string;
    close_tx_hash?: string;
    close_explorer_url?: string;
    pnl?: string;
    user_address: string;
    on_chain_position_id?: string;
    intent_id?: string;
    execution_id?: string;
    created_at: number;
    updated_at: number;
}
export interface CreatePositionInput {
    chain: 'ethereum' | 'solana';
    network: string;
    venue: string;
    market: string;
    side: 'long' | 'short';
    leverage?: number;
    margin_units?: string;
    margin_display?: string;
    size_units?: string;
    entry_price?: string;
    open_tx_hash?: string;
    open_explorer_url?: string;
    user_address: string;
    on_chain_position_id?: string;
    intent_id?: string;
    execution_id?: string;
}
export declare function createPosition(input: CreatePositionInput): Position;
export declare function getPosition(id: string): Position | null;
export declare function getPositionByOnChainId(chain: string, network: string, venue: string, onChainPositionId: string): Position | null;
export declare function updatePosition(id: string, updates: Partial<Omit<Position, 'id' | 'created_at'>>): void;
export declare function closePosition(id: string, closeTxHash: string, closeExplorerUrl: string, pnl?: string, status?: 'closed' | 'liquidated'): void;
export declare function getOpenPositions(filters?: {
    chain?: string;
    network?: string;
    venue?: string;
    user_address?: string;
}): Position[];
export declare function getRecentPositions(limit?: number): Position[];
export declare function getPositionsByStatus(status: 'open' | 'closed' | 'liquidated', limit?: number): Position[];
export declare function getPositionStats(): {
    total: number;
    open: number;
    closed: number;
    liquidated: number;
    byMarket: {
        market: string;
        count: number;
    }[];
};
export interface IndexerState {
    id: string;
    chain: string;
    network: string;
    contract_address: string;
    last_indexed_block: number;
    updated_at: number;
}
export declare function getIndexerState(chain: string, network: string, contractAddress: string): IndexerState | null;
export declare function upsertIndexerState(chain: string, network: string, contractAddress: string, lastIndexedBlock: number): void;
export interface WaitlistEntry {
    id: string;
    email?: string;
    wallet_address?: string;
    created_at: number;
    source?: string;
    metadata_json?: string;
}
export declare function addToWaitlist(params: {
    email?: string;
    walletAddress?: string;
    source?: string;
    metadata?: Record<string, any>;
}): string;
export declare function getWaitlistEntries(limit?: number): WaitlistEntry[];
export declare function getWaitlistCount(): number;
export declare const getStatsSummary: typeof getSummaryStats;
export declare const getIntentStats: typeof getIntentStatsSummary;
/**
 * ============================================================
 * ASYNC/POSTGRES SUPPORT
 * Async-capable exports that route to Postgres in production
 * ============================================================
 */
/**
 * Async-capable intent creation (uses Postgres if DATABASE_URL is set)
 */
export declare function createIntentAsync(params: {
    intentText: string;
    intentKind?: string;
    requestedChain?: string;
    requestedVenue?: string;
    usdEstimate?: number;
    metadataJson?: string;
}): Promise<Intent>;
/**
 * Async-capable intent status update (uses Postgres if DATABASE_URL is set)
 */
export declare function updateIntentStatusAsync(id: string, updates: {
    status?: string;
    plannedAt?: number;
    executedAt?: number;
    confirmedAt?: number;
    failureStage?: string;
    errorCode?: string;
    errorMessage?: string;
    metadataJson?: string;
}): Promise<void>;
/**
 * Async-capable execution creation (uses Postgres if DATABASE_URL is set)
 */
export declare function createExecutionAsync(params: {
    id?: string;
    chain: Chain;
    network: Network;
    kind?: string;
    venue?: string;
    intent: string;
    action: string;
    fromAddress: string;
    toAddress?: string;
    token?: string;
    amountUnits?: string;
    amountDisplay?: string;
    usdEstimate?: number;
    txHash?: string;
    status?: string;
    errorCode?: string;
    errorMessage?: string;
    explorerUrl?: string;
    relayerAddress?: string;
    sessionId?: string;
    intentId?: string;
}): Promise<Execution>;
/**
 * Async-capable execution update (uses Postgres if DATABASE_URL is set)
 */
export declare function updateExecutionAsync(id: string, updates: {
    txHash?: string;
    status?: string;
    errorCode?: string;
    errorMessage?: string;
    explorerUrl?: string;
    gasUsed?: string;
    blockNumber?: number;
    latencyMs?: number;
}): Promise<void>;
/**
 * Finalize execution in atomic transaction
 * Creates execution row + updates intent status in single transaction
 * Ensures both writes persist before serverless function exits
 */
export declare function finalizeExecutionTransactionAsync(params: {
    intentId: string;
    execution: {
        id?: string;
        chain: any;
        network: any;
        kind?: any;
        venue?: any;
        intent: string;
        action: string;
        fromAddress: string;
        toAddress?: string;
        token?: string;
        amountUnits?: string;
        amountDisplay?: string;
        usdEstimate?: number;
        usdEstimateIsEstimate?: boolean;
        txHash?: string;
        status?: any;
        errorCode?: string;
        errorMessage?: string;
        explorerUrl?: string;
        relayerAddress?: string;
        sessionId?: string;
    };
    steps?: Array<{
        stepIndex: number;
        action: string;
        chain: string;
        venue?: string;
        status?: string;
        txHash?: string;
        explorerUrl?: string;
        amount?: string;
        token?: string;
    }>;
    intentStatus: {
        status: any;
        confirmedAt?: number;
        failedAt?: number;
        failureStage?: string;
        errorCode?: string;
        errorMessage?: string;
        metadataJson?: string;
    };
}): Promise<{
    executionId: string;
}>;
/**
 * Async-capable get intent (uses Postgres if DATABASE_URL is set)
 */
export declare function getIntentAsync(id: string): Promise<Intent | undefined>;
/**
 * Async-capable get recent intents (uses Postgres if DATABASE_URL is set)
 */
export declare function getRecentIntentsAsync(limit?: number): Promise<Intent[]>;
/**
 * Async-capable get summary stats (uses Postgres if DATABASE_URL is set)
 */
export declare function getSummaryStatsAsync(): Promise<StatsSummary>;
/**
 * Async-capable get intent stats summary (uses Postgres if DATABASE_URL is set)
 */
export declare function getIntentStatsSummaryAsync(): Promise<IntentStatsSummary>;
/**
 * Async-capable get recent executions (uses Postgres if DATABASE_URL is set)
 */
export declare function getRecentExecutionsAsync(limit?: number): Promise<Execution[]>;
/**
 * Async-capable get executions for intent (uses Postgres if DATABASE_URL is set)
 */
export declare function getExecutionsForIntentAsync(intentId: string): Promise<Execution[]>;
/**
 * Async-capable link execution to intent (uses Postgres if DATABASE_URL is set)
 */
export declare function linkExecutionToIntentAsync(executionId: string, intentId: string): Promise<void>;
/**
 * Async-capable create execution step (uses Postgres if DATABASE_URL is set)
 */
export declare function createExecutionStepAsync(params: {
    executionId: string;
    stepIndex: number;
    action: string;
    stage?: string;
    status?: string;
}): Promise<ExecutionStep>;
/**
 * Async-capable update execution step (uses Postgres if DATABASE_URL is set)
 */
export declare function updateExecutionStepAsync(id: string, updates: {
    status?: string;
    txHash?: string;
    errorCode?: string;
    errorMessage?: string;
    explorerUrl?: string;
}): Promise<void>;
/**
 * Async-capable get summary stats with intents (uses Postgres if DATABASE_URL is set)
 */
export declare function getSummaryStatsWithIntentsAsync(): Promise<StatsSummary & {
    totalIntents: number;
    confirmedIntents: number;
    failedIntents: number;
    intentSuccessRate: number;
}>;
//# sourceMappingURL=db.d.ts.map