"use strict";
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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordExecution = recordExecution;
exports.updateLedgerExecution = updateLedgerExecution;
exports.getLedgerSummary = getLedgerSummary;
exports.getProofBundle = getProofBundle;
exports.registerWallet = registerWallet;
exports.buildExplorerUrl = buildExplorerUrl;
exports.recordExecutionWithResult = recordExecutionWithResult;
exports.createPosition = createPosition;
exports.getPosition = getPosition;
exports.getPositionByOnChainId = getPositionByOnChainId;
exports.updatePosition = updatePosition;
exports.closePosition = closePosition;
exports.getOpenPositions = getOpenPositions;
exports.getRecentPositions = getRecentPositions;
exports.getPositionStats = getPositionStats;
exports.getIndexerState = getIndexerState;
exports.upsertIndexerState = upsertIndexerState;
exports.createExecutionStep = createExecutionStep;
exports.updateExecutionStep = updateExecutionStep;
exports.getExecutionSteps = getExecutionSteps;
// Lazy-loaded ledger module (use any to avoid rootDir issues with typeof import)
let ledgerDb = null;
async function getLedgerDb() {
    if (!ledgerDb) {
        try {
            ledgerDb = await Promise.resolve().then(() => __importStar(require('../../execution-ledger/db')));
        }
        catch (error) {
            console.warn('[ledger] Execution ledger DB not available:', error);
            throw error;
        }
    }
    return ledgerDb;
}
/**
 * Record a new execution to the ledger
 * Returns the execution ID for later updates
 */
async function recordExecution(params) {
    const db = await getLedgerDb();
    const exec = db.createExecution({
        chain: params.chain,
        network: params.network,
        kind: params.kind,
        venue: params.venue,
        intent: params.intent,
        action: params.action,
        fromAddress: params.fromAddress,
        toAddress: params.toAddress,
        token: params.token,
        amountUnits: params.amountUnits,
        amountDisplay: params.amountDisplay,
        usdEstimate: params.usdEstimate,
        usdEstimateIsEstimate: params.usdEstimateIsEstimate,
        relayerAddress: params.relayerAddress,
        sessionId: params.sessionId,
    });
    return exec.id;
}
/**
 * Update an existing execution in the ledger
 */
async function updateLedgerExecution(id, updates) {
    const db = await getLedgerDb();
    db.updateExecution(id, updates);
}
/**
 * Get the ledger summary
 */
async function getLedgerSummary() {
    const db = await getLedgerDb();
    return db.getLedgerSummary();
}
/**
 * Get the proof bundle
 */
async function getProofBundle() {
    const db = await getLedgerDb();
    return db.getProofBundle();
}
/**
 * Register a wallet in the ledger
 */
async function registerWallet(params) {
    const db = await getLedgerDb();
    return db.registerWallet(params);
}
/**
 * Build explorer URL based on chain/network
 */
function buildExplorerUrl(chain, network, txHash) {
    if (chain === 'ethereum') {
        if (network === 'sepolia') {
            return `https://sepolia.etherscan.io/tx/${txHash}`;
        }
        else if (network === 'mainnet') {
            return `https://etherscan.io/tx/${txHash}`;
        }
    }
    else if (chain === 'solana') {
        if (network === 'devnet') {
            return `https://explorer.solana.com/tx/${txHash}?cluster=devnet`;
        }
        else if (network === 'mainnet') {
            return `https://explorer.solana.com/tx/${txHash}`;
        }
    }
    return '';
}
/**
 * Record execution with immediate result update
 * Convenience wrapper for record + update in one call
 */
async function recordExecutionWithResult(params, result) {
    const execId = await recordExecution(params);
    const explorerUrl = result.txHash
        ? buildExplorerUrl(params.chain, params.network, result.txHash)
        : undefined;
    await updateLedgerExecution(execId, {
        status: result.success ? 'confirmed' : 'failed',
        txHash: result.txHash,
        explorerUrl,
        blockNumber: result.blockNumber,
        gasUsed: result.gasUsed,
        latencyMs: result.latencyMs,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
    });
    return execId;
}
/**
 * Create a new position in the ledger
 */
async function createPosition(params) {
    const db = await getLedgerDb();
    return db.createPosition(params);
}
/**
 * Get position by ID
 */
async function getPosition(id) {
    const db = await getLedgerDb();
    return db.getPosition(id);
}
/**
 * Get position by on-chain ID
 */
async function getPositionByOnChainId(chain, network, venue, onChainId) {
    const db = await getLedgerDb();
    return db.getPositionByOnChainId(chain, network, venue, onChainId);
}
/**
 * Update a position
 */
async function updatePosition(id, updates) {
    const db = await getLedgerDb();
    db.updatePosition(id, updates);
}
/**
 * Close a position
 */
async function closePosition(id, txHash, explorerUrl, pnl, status = 'closed') {
    const db = await getLedgerDb();
    db.closePosition(id, txHash, explorerUrl, pnl, status);
}
/**
 * Get all open positions
 */
async function getOpenPositions(chain, network) {
    const db = await getLedgerDb();
    return db.getOpenPositions(chain, network);
}
/**
 * Get recent positions
 */
async function getRecentPositions(limit) {
    const db = await getLedgerDb();
    return db.getRecentPositions(limit);
}
/**
 * Get position stats
 */
async function getPositionStats() {
    const db = await getLedgerDb();
    return db.getPositionStats();
}
/**
 * Get indexer state for a contract
 */
async function getIndexerState(chain, network, contractAddress) {
    const db = await getLedgerDb();
    return db.getIndexerState(chain, network, contractAddress);
}
/**
 * Update or create indexer state
 */
async function upsertIndexerState(chain, network, contractAddress, lastIndexedBlock) {
    const db = await getLedgerDb();
    db.upsertIndexerState(chain, network, contractAddress, lastIndexedBlock);
}
/**
 * Create an execution step
 */
async function createExecutionStep(params) {
    const db = await getLedgerDb();
    return db.createExecutionStep(params);
}
/**
 * Update an execution step
 */
async function updateExecutionStep(id, updates) {
    const db = await getLedgerDb();
    db.updateExecutionStep(id, updates);
}
/**
 * Get execution steps for an execution
 */
async function getExecutionSteps(executionId) {
    const db = await getLedgerDb();
    return db.getExecutionSteps(executionId);
}
//# sourceMappingURL=ledger.js.map