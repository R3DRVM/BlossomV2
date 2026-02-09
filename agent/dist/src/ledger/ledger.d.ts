/**
 * Execution Ledger Wrapper
 * Convenience module for recording executions to the ledger
 *
 * Uses dynamic imports to avoid TypeScript rootDir issues
 * (execution-ledger is outside src directory like telemetry)
 *
 * Usage:
 *   import { recordExecution, updateLedgerExecution } from './ledger/ledger';
 *
 *   // Record a new execution
 *   const execId = await recordExecution({
 *     chain: 'ethereum',
 *     network: 'sepolia',
 *     intent: 'Supply 0.01 WETH to Aave',
 *     action: 'lend_supply',
 *     fromAddress: '0x...',
 *     token: 'WETH',
 *     amountUnits: '10000000000000000',
 *     amountDisplay: '0.01 WETH',
 *   });
 *
 *   // Update after confirmation
 *   await updateLedgerExecution(execId, {
 *     status: 'confirmed',
 *     txHash: '0x...',
 *     explorerUrl: 'https://sepolia.etherscan.io/tx/0x...',
 *   });
 */
export type Chain = 'ethereum' | 'solana' | 'hyperliquid';
export type Network = 'sepolia' | 'devnet' | 'mainnet' | 'hyperliquid_testnet';
export type ExecutionStatus = 'pending' | 'submitted' | 'confirmed' | 'finalized' | 'failed';
export type ExecutionKind = 'perp' | 'deposit' | 'bridge' | 'swap' | 'proof' | 'relay' | 'transfer';
export type ExecutionVenue = 'drift' | 'hl' | 'hyperliquid' | 'perp_demo' | 'aave' | 'kamino' | 'deposit_demo' | 'lifi' | 'wormhole' | 'bridge_demo' | 'uniswap' | 'jupiter' | 'swap_demo' | 'native';
export interface RecordExecutionParams {
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
}
export interface ExecutionUpdateParams {
    status?: ExecutionStatus;
    kind?: ExecutionKind;
    venue?: ExecutionVenue;
    txHash?: string;
    explorerUrl?: string;
    errorCode?: string;
    errorMessage?: string;
    gasUsed?: string;
    blockNumber?: number;
    latencyMs?: number;
    usdEstimate?: number;
    usdEstimateIsEstimate?: boolean;
    relayerAddress?: string;
    sessionId?: string;
}
/**
 * Record a new execution to the ledger
 * Returns the execution ID for later updates
 */
export declare function recordExecution(params: RecordExecutionParams): Promise<string>;
/**
 * Update an existing execution in the ledger
 */
export declare function updateLedgerExecution(id: string, updates: ExecutionUpdateParams): Promise<void>;
/**
 * Get the ledger summary
 */
export declare function getLedgerSummary(): Promise<any>;
/**
 * Get the proof bundle
 */
export declare function getProofBundle(): Promise<any>;
/**
 * Register a wallet in the ledger
 */
export declare function registerWallet(params: {
    chain: Chain;
    network: Network;
    address: string;
    label?: string;
    isPrimary?: boolean;
}): Promise<any>;
/**
 * Build explorer URL based on chain/network
 */
export declare function buildExplorerUrl(chain: Chain, network: Network, txHash: string): string;
/**
 * Record execution with immediate result update
 * Convenience wrapper for record + update in one call
 */
export declare function recordExecutionWithResult(params: RecordExecutionParams, result: {
    success: boolean;
    txHash?: string;
    blockNumber?: number;
    gasUsed?: string;
    latencyMs?: number;
    errorCode?: string;
    errorMessage?: string;
}): Promise<string>;
export interface PositionParams {
    chain: Chain;
    network: Network;
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
export interface Position {
    id: string;
    chain: Chain;
    network: Network;
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
}
/**
 * Create a new position in the ledger
 */
export declare function createPosition(params: PositionParams): Promise<Position>;
/**
 * Get position by ID
 */
export declare function getPosition(id: string): Promise<Position | null>;
/**
 * Get position by on-chain ID
 */
export declare function getPositionByOnChainId(chain: Chain, network: Network, venue: string, onChainId: string): Promise<Position | null>;
/**
 * Update a position
 */
export declare function updatePosition(id: string, updates: Partial<Omit<Position, 'id' | 'chain' | 'network' | 'venue'>>): Promise<void>;
/**
 * Close a position
 */
export declare function closePosition(id: string, txHash: string, explorerUrl: string, pnl: string, status?: 'closed' | 'liquidated'): Promise<void>;
/**
 * Get all open positions
 */
export declare function getOpenPositions(chain?: Chain, network?: Network): Promise<Position[]>;
/**
 * Get recent positions
 */
export declare function getRecentPositions(limit?: number): Promise<Position[]>;
/**
 * Get position stats
 */
export declare function getPositionStats(): Promise<any>;
export interface IndexerState {
    id: string;
    chain: Chain;
    network: Network;
    contract_address: string;
    last_indexed_block: number;
    updated_at: number;
}
/**
 * Get indexer state for a contract
 */
export declare function getIndexerState(chain: Chain, network: Network, contractAddress: string): Promise<IndexerState | null>;
/**
 * Update or create indexer state
 */
export declare function upsertIndexerState(chain: Chain, network: Network, contractAddress: string, lastIndexedBlock: number): Promise<void>;
export interface ExecutionStepParams {
    executionId: string;
    stepIndex: number;
    action: string;
    stage?: string;
}
/**
 * Create an execution step
 */
export declare function createExecutionStep(params: ExecutionStepParams): Promise<any>;
/**
 * Update an execution step
 */
export declare function updateExecutionStep(id: string, updates: Partial<{
    status: string;
    stage: string;
    txHash: string;
    explorerUrl: string;
    errorCode: string;
    errorMessage: string;
}>): Promise<void>;
/**
 * Get execution steps for an execution
 */
export declare function getExecutionSteps(executionId: string): Promise<any>;
//# sourceMappingURL=ledger.d.ts.map