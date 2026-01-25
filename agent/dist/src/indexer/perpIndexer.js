"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.startPerpIndexer = startPerpIndexer;
exports.stopPerpIndexer = stopPerpIndexer;
exports.isIndexerRunning = isIndexerRunning;
exports.triggerIndexerPoll = triggerIndexerPoll;
const viem_1 = require("viem");
const chains_1 = require("viem/chains");
const ledger_1 = require("../ledger/ledger");
// Event ABIs
const POSITION_OPENED_ABI = (0, viem_1.parseAbiItem)('event PositionOpened(address indexed user, uint256 indexed positionId, uint8 market, uint8 side, uint256 margin, uint256 size, uint256 leverage, uint256 entryPrice)');
const POSITION_CLOSED_ABI = (0, viem_1.parseAbiItem)('event PositionClosed(address indexed user, uint256 indexed positionId, uint256 exitPrice, int256 pnl, uint256 marginReturned)');
const LIQUIDATION_ABI = (0, viem_1.parseAbiItem)('event LiquidationTriggered(address indexed user, uint256 indexed positionId, uint256 liquidationPrice, int256 loss)');
// Market enum mapping
const MARKET_MAP = {
    0: 'BTC',
    1: 'ETH',
    2: 'SOL',
};
// Side enum mapping
const SIDE_MAP = {
    0: 'long',
    1: 'short',
};
// Indexer configuration
const INDEXER_CONFIG = {
    chain: 'ethereum',
    network: 'sepolia',
    venue: 'demo_perp',
    pollIntervalMs: 15000, // 15 seconds
    maxBlocksPerPoll: 1000, // Don't index more than 1000 blocks at once
    startBlock: 10100000, // Start from a recent block (adjust based on deployment)
};
let isRunning = false;
let pollTimeout = null;
/**
 * Build explorer URL for a transaction
 */
function buildExplorerUrl(txHash) {
    return `https://sepolia.etherscan.io/tx/${txHash}`;
}
/**
 * Process PositionOpened event
 */
async function processPositionOpened(log, perpEngineAddress, timestamp) {
    try {
        const args = log.args;
        if (!args)
            return;
        const user = args.user;
        const positionId = args.positionId?.toString() || '0';
        const market = MARKET_MAP[Number(args.market)] || 'BTC';
        const side = SIDE_MAP[Number(args.side)] || 'long';
        const margin = args.margin?.toString() || '0';
        const size = args.size?.toString() || '0';
        const leverage = Number(args.leverage) || 1;
        const entryPrice = args.entryPrice?.toString() || '0';
        // Check if position already exists
        const existing = await (0, ledger_1.getPositionByOnChainId)(INDEXER_CONFIG.chain, INDEXER_CONFIG.network, INDEXER_CONFIG.venue, positionId);
        if (existing) {
            // Position already indexed
            return;
        }
        // Create new position
        const txHash = log.transactionHash || '';
        await (0, ledger_1.createPosition)({
            chain: INDEXER_CONFIG.chain,
            network: INDEXER_CONFIG.network,
            venue: INDEXER_CONFIG.venue,
            market,
            side,
            leverage,
            margin_units: margin,
            margin_display: `${(Number(margin) / 1e6).toFixed(2)} USDC`,
            size_units: size,
            entry_price: entryPrice,
            open_tx_hash: txHash,
            open_explorer_url: txHash ? buildExplorerUrl(txHash) : undefined,
            user_address: user,
            on_chain_position_id: positionId,
        });
        console.log(`[indexer] Indexed new position: ${market} ${side} (id=${positionId})`);
    }
    catch (err) {
        console.error(`[indexer] Error processing PositionOpened:`, err.message);
    }
}
/**
 * Process PositionClosed event
 */
async function processPositionClosed(log) {
    try {
        const args = log.args;
        if (!args)
            return;
        const positionId = args.positionId?.toString() || '0';
        const pnl = args.pnl?.toString() || '0';
        // Find the position
        const position = await (0, ledger_1.getPositionByOnChainId)(INDEXER_CONFIG.chain, INDEXER_CONFIG.network, INDEXER_CONFIG.venue, positionId);
        if (!position) {
            console.log(`[indexer] Position not found for close event: ${positionId}`);
            return;
        }
        if (position.status !== 'open') {
            // Already closed
            return;
        }
        const txHash = log.transactionHash || '';
        await (0, ledger_1.closePosition)(position.id, txHash, txHash ? buildExplorerUrl(txHash) : '', pnl, 'closed');
        console.log(`[indexer] Closed position: ${position.market} ${position.side} (id=${positionId})`);
    }
    catch (err) {
        console.error(`[indexer] Error processing PositionClosed:`, err.message);
    }
}
/**
 * Process LiquidationTriggered event
 */
async function processLiquidation(log) {
    try {
        const args = log.args;
        if (!args)
            return;
        const positionId = args.positionId?.toString() || '0';
        const loss = args.loss?.toString() || '0';
        // Find the position
        const position = await (0, ledger_1.getPositionByOnChainId)(INDEXER_CONFIG.chain, INDEXER_CONFIG.network, INDEXER_CONFIG.venue, positionId);
        if (!position) {
            console.log(`[indexer] Position not found for liquidation event: ${positionId}`);
            return;
        }
        if (position.status !== 'open') {
            return;
        }
        const txHash = log.transactionHash || '';
        await (0, ledger_1.closePosition)(position.id, txHash, txHash ? buildExplorerUrl(txHash) : '', loss, 'liquidated');
        console.log(`[indexer] Liquidated position: ${position.market} ${position.side} (id=${positionId})`);
    }
    catch (err) {
        console.error(`[indexer] Error processing Liquidation:`, err.message);
    }
}
/**
 * Index events from a block range
 */
async function indexBlockRange(client, perpEngineAddress, fromBlock, toBlock) {
    // Get PositionOpened events
    const openedLogs = await client.getLogs({
        address: perpEngineAddress,
        event: POSITION_OPENED_ABI,
        fromBlock,
        toBlock,
    });
    for (const log of openedLogs) {
        const block = await client.getBlock({ blockNumber: log.blockNumber });
        await processPositionOpened(log, perpEngineAddress, Number(block.timestamp));
    }
    // Get PositionClosed events
    const closedLogs = await client.getLogs({
        address: perpEngineAddress,
        event: POSITION_CLOSED_ABI,
        fromBlock,
        toBlock,
    });
    for (const log of closedLogs) {
        await processPositionClosed(log);
    }
    // Get Liquidation events
    const liquidationLogs = await client.getLogs({
        address: perpEngineAddress,
        event: LIQUIDATION_ABI,
        fromBlock,
        toBlock,
    });
    for (const log of liquidationLogs) {
        await processLiquidation(log);
    }
}
/**
 * Single indexer poll iteration
 */
async function pollOnce(client, perpEngineAddress) {
    try {
        // Get current block
        const currentBlock = await client.getBlockNumber();
        // Get last indexed block
        const state = await (0, ledger_1.getIndexerState)(INDEXER_CONFIG.chain, INDEXER_CONFIG.network, perpEngineAddress);
        const lastIndexedBlock = state?.last_indexed_block
            ? BigInt(state.last_indexed_block)
            : BigInt(INDEXER_CONFIG.startBlock);
        // Nothing to index if we're caught up
        if (lastIndexedBlock >= currentBlock) {
            return;
        }
        // Calculate range to index
        const fromBlock = lastIndexedBlock + 1n;
        const maxToBlock = fromBlock + BigInt(INDEXER_CONFIG.maxBlocksPerPoll);
        const toBlock = maxToBlock > currentBlock ? currentBlock : maxToBlock;
        // Index the range
        await indexBlockRange(client, perpEngineAddress, fromBlock, toBlock);
        // Update state
        await (0, ledger_1.upsertIndexerState)(INDEXER_CONFIG.chain, INDEXER_CONFIG.network, perpEngineAddress, Number(toBlock));
        if (toBlock - fromBlock > 0n) {
            console.log(`[indexer] Indexed blocks ${fromBlock}-${toBlock}`);
        }
    }
    catch (err) {
        // Don't spam logs - only log errors once per minute
        console.error(`[indexer] Poll error:`, err.message?.slice(0, 100));
    }
}
/**
 * Start the indexer loop
 */
function startPerpIndexer(rpcUrl, perpEngineAddress) {
    if (isRunning) {
        console.log('[indexer] Already running');
        return;
    }
    if (!perpEngineAddress) {
        console.log('[indexer] No perp engine address configured, skipping');
        return;
    }
    console.log('[indexer] Starting perp position indexer');
    console.log(`[indexer] Contract: ${perpEngineAddress}`);
    isRunning = true;
    const client = (0, viem_1.createPublicClient)({
        chain: chains_1.sepolia,
        transport: (0, viem_1.http)(rpcUrl),
    });
    const poll = async () => {
        if (!isRunning)
            return;
        await pollOnce(client, perpEngineAddress);
        // Schedule next poll
        pollTimeout = setTimeout(poll, INDEXER_CONFIG.pollIntervalMs);
    };
    // Start polling
    poll();
}
/**
 * Stop the indexer
 */
function stopPerpIndexer() {
    console.log('[indexer] Stopping perp position indexer');
    isRunning = false;
    if (pollTimeout) {
        clearTimeout(pollTimeout);
        pollTimeout = null;
    }
}
/**
 * Check if indexer is running
 */
function isIndexerRunning() {
    return isRunning;
}
/**
 * Manually trigger a single poll (for testing)
 */
async function triggerIndexerPoll(rpcUrl, perpEngineAddress) {
    const client = (0, viem_1.createPublicClient)({
        chain: chains_1.sepolia,
        transport: (0, viem_1.http)(rpcUrl),
    });
    await pollOnce(client, perpEngineAddress);
}
//# sourceMappingURL=perpIndexer.js.map