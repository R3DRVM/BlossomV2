/**
 * Perp Position Indexer
 *
 * Watches DemoPerpEngine + DemoPerpAdapter events on Sepolia
 * and syncs position state to the ledger database.
 *
 * Events indexed:
 * - PositionOpened (DemoPerpEngine)
 * - PositionClosed (DemoPerpEngine)
 * - PerpPositionOpened (DemoPerpAdapter)
 * - PerpPositionClosed (DemoPerpAdapter)
 * - MarginDeposited (DemoPerpEngine)
 * - LiquidationTriggered (DemoPerpEngine)
 */
/**
 * Start the indexer loop
 */
export declare function startPerpIndexer(rpcUrl: string, perpEngineAddress: string): void;
/**
 * Stop the indexer
 */
export declare function stopPerpIndexer(): void;
/**
 * Check if indexer is running
 */
export declare function isIndexerRunning(): boolean;
/**
 * Manually trigger a single poll (for testing)
 */
export declare function triggerIndexerPoll(rpcUrl: string, perpEngineAddress: string): Promise<void>;
//# sourceMappingURL=perpIndexer.d.ts.map