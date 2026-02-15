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

// Type definitions (copied to avoid import issues)
export type Chain = 'ethereum' | 'solana' | 'hyperliquid';
export type Network = 'sepolia' | 'devnet' | 'mainnet' | 'hyperliquid_testnet';
export type ExecutionStatus = 'pending' | 'submitted' | 'confirmed' | 'finalized' | 'failed';
export type ExecutionKind = 'perp' | 'perp_create' | 'deposit' | 'bridge' | 'swap' | 'proof' | 'relay' | 'transfer';
export type ExecutionVenue =
  | 'drift' | 'hl' | 'hyperliquid' | 'perp_demo' | 'hip3'
  | 'aave' | 'kamino' | 'deposit_demo'
  | 'lifi' | 'wormhole' | 'bridge_demo'
  | 'uniswap' | 'jupiter' | 'swap_demo'
  | 'native';

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

// Lazy-loaded ledger module (use any to avoid rootDir issues with typeof import)
let ledgerDb: any = null;

async function getLedgerDb() {
  if (!ledgerDb) {
    try {
      ledgerDb = await import('../../execution-ledger/db');
    } catch (error) {
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
export async function recordExecution(params: RecordExecutionParams): Promise<string> {
  const db = await getLedgerDb();

  // Use async function to ensure Postgres writes when configured
  const exec = await db.createExecutionAsync({
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
export async function updateLedgerExecution(
  id: string,
  updates: ExecutionUpdateParams
): Promise<void> {
  const db = await getLedgerDb();
  // Use async function to ensure Postgres writes when configured
  await db.updateExecutionAsync(id, updates);
}

/**
 * Get the ledger summary
 */
export async function getLedgerSummary() {
  const db = await getLedgerDb();
  return db.getLedgerSummary();
}

/**
 * Get the proof bundle
 */
export async function getProofBundle() {
  const db = await getLedgerDb();
  return db.getProofBundle();
}

/**
 * Register a wallet in the ledger
 */
export async function registerWallet(params: {
  chain: Chain;
  network: Network;
  address: string;
  label?: string;
  isPrimary?: boolean;
}) {
  const db = await getLedgerDb();
  return db.registerWallet(params);
}

/**
 * Build explorer URL based on chain/network
 */
export function buildExplorerUrl(
  chain: Chain,
  network: Network,
  txHash: string
): string {
  if (chain === 'ethereum') {
    if (network === 'sepolia') {
      return `https://sepolia.etherscan.io/tx/${txHash}`;
    } else if (network === 'mainnet') {
      return `https://etherscan.io/tx/${txHash}`;
    }
  } else if (chain === 'solana') {
    if (network === 'devnet') {
      return `https://explorer.solana.com/tx/${txHash}?cluster=devnet`;
    } else if (network === 'mainnet') {
      return `https://explorer.solana.com/tx/${txHash}`;
    }
  } else if (chain === 'hyperliquid') {
    if (network === 'hyperliquid_testnet') {
      return `https://testnet.purrsec.com/tx/${txHash}`;
    }
    return `https://purrsec.com/tx/${txHash}`;
  }
  return '';
}

/**
 * Record execution with immediate result update
 * Convenience wrapper for record + update in one call
 */
export async function recordExecutionWithResult(
  params: RecordExecutionParams,
  result: {
    success: boolean;
    txHash?: string;
    blockNumber?: number;
    gasUsed?: string;
    latencyMs?: number;
    errorCode?: string;
    errorMessage?: string;
  }
): Promise<string> {
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

// ============================================================================
// Position Management (for indexer and intent runner)
// ============================================================================

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
export async function createPosition(params: PositionParams): Promise<Position> {
  const db = await getLedgerDb();
  return db.createPosition(params) as Position;
}

/**
 * Get position by ID
 */
export async function getPosition(id: string): Promise<Position | null> {
  const db = await getLedgerDb();
  return db.getPosition(id) as Position | null;
}

/**
 * Get position by on-chain ID
 */
export async function getPositionByOnChainId(
  chain: Chain,
  network: Network,
  venue: string,
  onChainId: string
): Promise<Position | null> {
  const db = await getLedgerDb();
  return db.getPositionByOnChainId(chain, network, venue, onChainId) as Position | null;
}

/**
 * Update a position
 */
export async function updatePosition(
  id: string,
  updates: Partial<Omit<Position, 'id' | 'chain' | 'network' | 'venue'>>
): Promise<void> {
  const db = await getLedgerDb();
  db.updatePosition(id, updates);
}

/**
 * Close a position
 */
export async function closePosition(
  id: string,
  txHash: string,
  explorerUrl: string,
  pnl: string,
  status: 'closed' | 'liquidated' = 'closed'
): Promise<void> {
  const db = await getLedgerDb();
  db.closePosition(id, txHash, explorerUrl, pnl, status);
}

/**
 * Get all open positions
 */
export async function getOpenPositions(chain?: Chain, network?: Network): Promise<Position[]> {
  const db = await getLedgerDb();
  return db.getOpenPositions(chain, network) as Position[];
}

/**
 * Get recent positions
 */
export async function getRecentPositions(limit?: number): Promise<Position[]> {
  const db = await getLedgerDb();
  return db.getRecentPositions(limit) as Position[];
}

/**
 * Get position stats
 */
export async function getPositionStats() {
  const db = await getLedgerDb();
  return db.getPositionStats();
}

// ============================================================================
// Indexer State Management
// ============================================================================

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
export async function getIndexerState(
  chain: Chain,
  network: Network,
  contractAddress: string
): Promise<IndexerState | null> {
  const db = await getLedgerDb();
  return db.getIndexerState(chain, network, contractAddress) as IndexerState | null;
}

/**
 * Update or create indexer state
 */
export async function upsertIndexerState(
  chain: Chain,
  network: Network,
  contractAddress: string,
  lastIndexedBlock: number
): Promise<void> {
  const db = await getLedgerDb();
  db.upsertIndexerState(chain, network, contractAddress, lastIndexedBlock);
}

// ============================================================================
// Execution Steps
// ============================================================================

export interface ExecutionStepParams {
  executionId: string;
  stepIndex: number;
  action: string;
  stage?: string;
}

/**
 * Create an execution step
 */
export async function createExecutionStep(params: ExecutionStepParams) {
  const db = await getLedgerDb();
  return db.createExecutionStep(params);
}

/**
 * Update an execution step
 */
export async function updateExecutionStep(
  id: string,
  updates: Partial<{
    status: string;
    stage: string;
    txHash: string;
    explorerUrl: string;
    errorCode: string;
    errorMessage: string;
  }>
) {
  const db = await getLedgerDb();
  db.updateExecutionStep(id, updates);
}

/**
 * Get execution steps for an execution
 */
export async function getExecutionSteps(executionId: string) {
  const db = await getLedgerDb();
  return db.getExecutionSteps(executionId);
}
