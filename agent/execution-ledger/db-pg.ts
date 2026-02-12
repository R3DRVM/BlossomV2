/**
 * PostgreSQL Implementation of Execution Ledger
 * Async versions of all db.ts functions for production Postgres deployments
 */

import { randomUUID } from 'crypto';
import { query, queryOne, queryRows, convertPlaceholders, transaction } from './db-pg-client.js';

// Re-export types from db.ts
export type {
  Execution,
  Route,
  Session,
  Asset,
  Wallet,
  ExecutionStep,
  Intent,
  Position,
  IndexerState,
  Chain,
  Network,
  StatsSummary,
  IntentStatsSummary,
} from './db.js';

interface CreateIntentParams {
  intentText: string;
  intentKind?: any;
  requestedChain?: string;
  requestedVenue?: string;
  usdEstimate?: number;
  metadataJson?: string;
}

interface UpdateIntentStatusParams {
  status?: any;
  plannedAt?: number;
  executedAt?: number;
  confirmedAt?: number;
  requestedChain?: string;
  requestedVenue?: string;
  failureStage?: string;
  errorCode?: string;
  errorMessage?: string;
  metadataJson?: string;
}

interface CreateExecutionParams {
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
  intentId?: string;
}

interface UpdateExecutionParams {
  status?: any;
  txHash?: string;
  explorerUrl?: string;
  blockNumber?: number;
  gasUsed?: string;
  latencyMs?: number;
  errorCode?: string;
  errorMessage?: string;
}

interface CreateCrossChainCreditParams {
  userId?: string;
  sessionId?: string;
  fromChain: string;
  toChain: string;
  amountUsd: number;
  stableSymbol: string;
  fromAddress?: string;
  toAddress?: string;
  status?: 'created' | 'credit_submitted' | 'credited' | 'failed';
  errorCode?: string;
  metaJson?: string;
}

interface UpdateCrossChainCreditParams {
  status?: 'created' | 'credit_submitted' | 'credited' | 'failed';
  errorCode?: string;
  metaJson?: string;
}

let crossChainCreditsTableReady = false;

async function ensureCrossChainCreditsTable(): Promise<void> {
  if (crossChainCreditsTableReady) {
    return;
  }

  await query(`
    CREATE TABLE IF NOT EXISTS cross_chain_credits (
      id TEXT PRIMARY KEY,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      user_id TEXT,
      session_id TEXT,
      from_chain TEXT NOT NULL,
      to_chain TEXT NOT NULL,
      amount_usd DOUBLE PRECISION NOT NULL,
      stable_symbol TEXT NOT NULL,
      from_address TEXT,
      to_address TEXT,
      status TEXT NOT NULL DEFAULT 'created',
      error_code TEXT,
      meta_json TEXT
    )
  `);
  await query('CREATE INDEX IF NOT EXISTS idx_cross_chain_credits_user ON cross_chain_credits(user_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_cross_chain_credits_session ON cross_chain_credits(session_id)');
  await query('CREATE INDEX IF NOT EXISTS idx_cross_chain_credits_status ON cross_chain_credits(status)');
  await query('CREATE INDEX IF NOT EXISTS idx_cross_chain_credits_created ON cross_chain_credits(created_at)');

  crossChainCreditsTableReady = true;
}

/**
 * Create a new intent record
 */
export async function createIntent(params: CreateIntentParams) {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);

  const sql = convertPlaceholders(
    `INSERT INTO intents (
      id, created_at, intent_text, intent_kind, requested_chain, requested_venue,
      usd_estimate, status, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *`
  );

  const row = await queryOne(sql, [
    id,
    now,
    params.intentText,
    params.intentKind || null,
    params.requestedChain || null,
    params.requestedVenue || null,
    params.usdEstimate || null,
    'queued',
    params.metadataJson || null,
  ]);

  return row;
}

/**
 * Update intent status and metadata
 */
export async function updateIntentStatus(id: string, updates: UpdateIntentStatusParams): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (updates.status !== undefined) {
    fields.push(`status = $${paramIndex++}`);
    values.push(updates.status);
  }
  if (updates.plannedAt !== undefined) {
    fields.push(`planned_at = $${paramIndex++}`);
    values.push(updates.plannedAt);
  }
  if (updates.executedAt !== undefined) {
    fields.push(`executed_at = $${paramIndex++}`);
    values.push(updates.executedAt);
  }
  if (updates.confirmedAt !== undefined) {
    fields.push(`confirmed_at = $${paramIndex++}`);
    values.push(updates.confirmedAt);
  }
  if (updates.requestedChain !== undefined) {
    fields.push(`requested_chain = $${paramIndex++}`);
    values.push(updates.requestedChain);
  }
  if (updates.requestedVenue !== undefined) {
    fields.push(`requested_venue = $${paramIndex++}`);
    values.push(updates.requestedVenue);
  }
  if (updates.failureStage !== undefined) {
    fields.push(`failure_stage = $${paramIndex++}`);
    values.push(updates.failureStage);
  }
  if (updates.errorCode !== undefined) {
    fields.push(`error_code = $${paramIndex++}`);
    values.push(updates.errorCode);
  }
  if (updates.errorMessage !== undefined) {
    const truncated = updates.errorMessage.substring(0, 500);
    fields.push(`error_message = $${paramIndex++}`);
    values.push(truncated);
  }
  if (updates.metadataJson !== undefined) {
    fields.push(`metadata_json = $${paramIndex++}`);
    values.push(updates.metadataJson);
  }

  if (fields.length === 0) return;

  values.push(id);
  const sql = `UPDATE intents SET ${fields.join(', ')} WHERE id = $${paramIndex}`;

  try {
    const result = await query(sql, values);
    const rowCount = result.rowCount || 0;
    console.log(`[Postgres] Updated intent ${id.slice(0,8)} - rows: ${rowCount}, status: ${updates.status || 'n/a'}`);

    if (rowCount === 0) {
      console.warn(`[Postgres] WARNING: Update affected 0 rows for intent ${id.slice(0,8)}`);
    }
  } catch (error: any) {
    console.error(`[Postgres] Failed to update intent ${id.slice(0,8)}:`, error.message);
    throw error;
  }
}

/**
 * Get intent by ID
 */
export async function getIntent(id: string) {
  const sql = convertPlaceholders('SELECT * FROM intents WHERE id = ?');
  return queryOne(sql, [id]);
}

/**
 * Get recent intents
 */
export async function getRecentIntents(limit: number = 50) {
  const sql = convertPlaceholders('SELECT * FROM intents ORDER BY created_at DESC LIMIT ?');
  return queryRows(sql, [limit]);
}

/**
 * Create execution record
 */
export async function createExecution(params: CreateExecutionParams) {
  const id = params.id || randomUUID();
  const now = Math.floor(Date.now() / 1000);

  const sql = convertPlaceholders(
    `INSERT INTO executions (
      id, chain, network, kind, venue, intent, action, from_address, to_address,
      token, amount_units, amount_display, usd_estimate, usd_estimate_is_estimate,
      tx_hash, status, error_code, error_message, explorer_url, relayer_address,
      session_id, intent_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *`
  );

  try {
    console.log(`[Postgres] Creating execution ${id.slice(0,8)} for intent ${params.intentId?.slice(0,8) || 'none'}`);
    const row = await queryOne(sql, [
      id,
      params.chain,
      params.network,
      params.kind || null,
      params.venue || null,
      params.intent,
      params.action,
      params.fromAddress,
      params.toAddress || null,
      params.token || null,
      params.amountUnits || null,
      params.amountDisplay || null,
      params.usdEstimate || null,
      params.usdEstimateIsEstimate !== undefined ? (params.usdEstimateIsEstimate ? 1 : 0) : 1,
      params.txHash || null,
      params.status || 'pending',
      params.errorCode || null,
      params.errorMessage || null,
      params.explorerUrl || null,
      params.relayerAddress || null,
      params.sessionId || null,
      params.intentId || null,
      now,
      now,
    ]);
    console.log(`[Postgres] Created execution ${id.slice(0,8)} successfully`);
    return row;
  } catch (error: any) {
    console.error(`[Postgres] Failed to create execution ${id.slice(0,8)}:`, error.message);
    throw error;
  }
}

/**
 * Update execution record
 */
export async function updateExecution(id: string, updates: UpdateExecutionParams): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (updates.status !== undefined) {
    fields.push(`status = $${paramIndex++}`);
    values.push(updates.status);
  }
  if (updates.txHash !== undefined) {
    fields.push(`tx_hash = $${paramIndex++}`);
    values.push(updates.txHash);
  }
  if (updates.explorerUrl !== undefined) {
    fields.push(`explorer_url = $${paramIndex++}`);
    values.push(updates.explorerUrl);
  }
  if (updates.blockNumber !== undefined) {
    fields.push(`block_number = $${paramIndex++}`);
    values.push(updates.blockNumber);
  }
  if (updates.gasUsed !== undefined) {
    fields.push(`gas_used = $${paramIndex++}`);
    values.push(updates.gasUsed);
  }
  if (updates.latencyMs !== undefined) {
    fields.push(`latency_ms = $${paramIndex++}`);
    values.push(updates.latencyMs);
  }
  if (updates.errorCode !== undefined) {
    fields.push(`error_code = $${paramIndex++}`);
    values.push(updates.errorCode);
  }
  if (updates.errorMessage !== undefined) {
    fields.push(`error_message = $${paramIndex++}`);
    values.push(updates.errorMessage);
  }

  if (fields.length === 0) return;

  fields.push(`updated_at = $${paramIndex++}`);
  values.push(Math.floor(Date.now() / 1000));

  values.push(id);
  const sql = `UPDATE executions SET ${fields.join(', ')} WHERE id = $${paramIndex}`;

  try {
    const result = await query(sql, values);
    console.log(`[Postgres] Updated execution ${id.slice(0,8)} - rows affected: ${result.rowCount || 0}`);
  } catch (error: any) {
    console.error(`[Postgres] Failed to update execution ${id.slice(0,8)}:`, error.message);
    throw error;
  }
}

/**
 * Create a cross-chain credit routing receipt row.
 */
export async function createCrossChainCredit(params: CreateCrossChainCreditParams) {
  await ensureCrossChainCreditsTable();

  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const sql = convertPlaceholders(
    `INSERT INTO cross_chain_credits (
      id, created_at, updated_at, user_id, session_id, from_chain, to_chain,
      amount_usd, stable_symbol, from_address, to_address, status, error_code, meta_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *`
  );

  return queryOne(sql, [
    id,
    now,
    now,
    params.userId || null,
    params.sessionId || null,
    params.fromChain,
    params.toChain,
    params.amountUsd,
    params.stableSymbol,
    params.fromAddress || null,
    params.toAddress || null,
    params.status || 'created',
    params.errorCode || null,
    params.metaJson || null,
  ]);
}

/**
 * Update a cross-chain credit routing receipt row.
 */
export async function updateCrossChainCredit(id: string, updates: UpdateCrossChainCreditParams): Promise<void> {
  await ensureCrossChainCreditsTable();

  const fields: string[] = ['updated_at = $1'];
  const values: any[] = [Math.floor(Date.now() / 1000)];
  let paramIndex = 2;

  if (updates.status !== undefined) {
    fields.push(`status = $${paramIndex++}`);
    values.push(updates.status);
  }
  if (updates.errorCode !== undefined) {
    fields.push(`error_code = $${paramIndex++}`);
    values.push(updates.errorCode);
  }
  if (updates.metaJson !== undefined) {
    fields.push(`meta_json = $${paramIndex++}`);
    values.push(updates.metaJson);
  }

  if (fields.length <= 1) {
    return;
  }

  values.push(id);
  await query(`UPDATE cross_chain_credits SET ${fields.join(', ')} WHERE id = $${paramIndex}`, values);
}

export async function getCrossChainCreditsByStatus(
  statuses: Array<'created' | 'credit_submitted' | 'credited' | 'failed'>,
  limit: number = 50
) {
  await ensureCrossChainCreditsTable();

  const normalized = (statuses || []).filter(Boolean);
  if (normalized.length === 0) return [];

  const cappedLimit = Math.max(1, Math.min(limit, 200));
  const statusParams = normalized.map((_, idx) => `$${idx + 1}`).join(', ');
  const sql = `SELECT * FROM cross_chain_credits WHERE status IN (${statusParams}) ORDER BY created_at DESC LIMIT $${
    normalized.length + 1
  }`;
  return queryRows(sql, [...normalized, cappedLimit]);
}

/**
 * Link execution to intent
 */
export async function linkExecutionToIntent(executionId: string, intentId: string): Promise<void> {
  const sql = convertPlaceholders('UPDATE executions SET intent_id = ? WHERE id = ?');

  try {
    const result = await query(sql, [intentId, executionId]);
    console.log(`[Postgres] Linked execution ${executionId.slice(0,8)} to intent ${intentId.slice(0,8)} - rows: ${result.rowCount || 0}`);
  } catch (error: any) {
    console.error(`[Postgres] Failed to link execution to intent:`, error.message);
    throw error;
  }
}

/**
 * ATOMIC EXECUTION FINALIZATION TRANSACTION
 * Creates execution row + updates intent status in single transaction
 * Ensures both writes persist before serverless function exits
 */
export async function finalizeExecutionTransaction(params: {
  intentId: string;
  execution: CreateExecutionParams;
  steps?: Array<{
    stepIndex: number;
    action: string;
    chain: string;
    venue?: string;
    stage?: string;
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
}): Promise<{ executionId: string }> {
  const executionId = params.execution.id || randomUUID();
  const now = Math.floor(Date.now() / 1000);

  console.log(`[Postgres] BEGIN FINALIZE TRANSACTION for intent ${params.intentId.slice(0,8)}`);

  await transaction(async (client) => {
    // 1. Insert execution row
    const execSql = convertPlaceholders(
      `INSERT INTO executions (
        id, chain, network, kind, venue, intent, action, from_address, to_address,
        token, amount_units, amount_display, usd_estimate, usd_estimate_is_estimate,
        tx_hash, status, error_code, error_message, explorer_url, relayer_address,
        session_id, intent_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id`
    );

    const execResult = await client.query(execSql, [
      executionId,
      params.execution.chain,
      params.execution.network,
      params.execution.kind || null,
      params.execution.venue || null,
      params.execution.intent,
      params.execution.action,
      params.execution.fromAddress,
      params.execution.toAddress || null,
      params.execution.token || null,
      params.execution.amountUnits || null,
      params.execution.amountDisplay || null,
      params.execution.usdEstimate || null,
      params.execution.usdEstimateIsEstimate !== undefined ? (params.execution.usdEstimateIsEstimate ? 1 : 0) : 1,
      params.execution.txHash || null,
      params.execution.status || 'confirmed',
      params.execution.errorCode || null,
      params.execution.errorMessage || null,
      params.execution.explorerUrl || null,
      params.execution.relayerAddress || null,
      params.execution.sessionId || null,
      params.intentId,
      now,
      now,
    ]);

    console.log(`[Postgres]   Execution insert: ${execResult.rowCount || 0} rows (id: ${executionId.slice(0,8)})`);

    if (execResult.rowCount === 0) {
      throw new Error('Failed to insert execution row');
    }

    // 2. Insert execution steps (if any)
    if (params.steps && params.steps.length > 0) {
      for (const step of params.steps) {
        const stepId = randomUUID();
        // Use only columns that exist in Postgres schema
        const stepSql = convertPlaceholders(
          `INSERT INTO execution_steps (
            id, execution_id, step_index, status, action, stage,
            tx_hash, explorer_url, error_code, error_message, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );

        await client.query(stepSql, [
          stepId,
          executionId,
          step.stepIndex || 0,
          step.status || 'confirmed',
          step.action,
          step.stage || null,
          step.txHash || null,
          step.explorerUrl || null,
          null, // error_code
          null, // error_message
          now,
        ]);
      }
      console.log(`[Postgres]   Execution steps insert: ${params.steps.length} rows`);
    }

    // 3. Update intent to final status (confirmed or failed)
    const intentFields: string[] = [];
    const intentValues: any[] = [];
    let intentParamIndex = 1;

    if (params.intentStatus.status !== undefined) {
      intentFields.push(`status = $${intentParamIndex++}`);
      intentValues.push(params.intentStatus.status);
    }
    if (params.intentStatus.confirmedAt !== undefined) {
      intentFields.push(`confirmed_at = $${intentParamIndex++}`);
      intentValues.push(params.intentStatus.confirmedAt);
    }
    // Note: failedAt is not a column in the intents table - failure info stored in failure_stage, error_code, error_message
    if (params.intentStatus.failureStage !== undefined) {
      intentFields.push(`failure_stage = $${intentParamIndex++}`);
      intentValues.push(params.intentStatus.failureStage);
    }
    if (params.intentStatus.errorCode !== undefined) {
      intentFields.push(`error_code = $${intentParamIndex++}`);
      intentValues.push(params.intentStatus.errorCode);
    }
    if (params.intentStatus.errorMessage !== undefined) {
      intentFields.push(`error_message = $${intentParamIndex++}`);
      intentValues.push(params.intentStatus.errorMessage);
    }
    if (params.intentStatus.metadataJson !== undefined) {
      intentFields.push(`metadata_json = $${intentParamIndex++}`);
      intentValues.push(params.intentStatus.metadataJson);
    }

    intentValues.push(params.intentId);
    const intentSql = `UPDATE intents SET ${intentFields.join(', ')} WHERE id = $${intentParamIndex}`;
    const intentResult = await client.query(intentSql, intentValues);
    console.log(`[Postgres]   Intent update: ${intentResult.rowCount || 0} rows (status: ${params.intentStatus.status})`);

    if (intentResult.rowCount === 0) {
      throw new Error(`Intent ${params.intentId} not found for finalization`);
    }

    console.log(`[Postgres] COMMIT FINALIZE TRANSACTION`);
  });

  return { executionId };
}

/**
 * Get intent statistics summary
 */
export async function getIntentStatsSummary() {
  const sql = `
    SELECT
      COUNT(*) as total_intents,
      COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed_intents,
      COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_intents
    FROM intents
  `;

  const row = await queryOne<any>(sql, []);

  return {
    totalIntents: parseInt(row?.total_intents || '0'),
    confirmedIntents: parseInt(row?.confirmed_intents || '0'),
    failedIntents: parseInt(row?.failed_intents || '0'),
  };
}

/**
 * Get summary statistics
 */
export async function getSummaryStats() {
  // Fee configuration
  const rawFeeBps = parseInt(process.env.BLOSSOM_FEE_BPS || '25', 10);
  const feeBps = Math.min(50, Math.max(10, isNaN(rawFeeBps) ? 25 : rawFeeBps));
  const feeTokenSymbol = process.env.BLOSSOM_FEE_TOKEN_SYMBOL || 'bUSDC';
  const feeTreasuryAddress =
    process.env.BLOSSOM_TREASURY_ADDRESS ||
    process.env.RELAYER_ADDRESS ||
    process.env.RELAYER_WALLET_ADDRESS ||
    null;

  const sql = `
    SELECT
      COUNT(*) as total_executions,
      COUNT(CASE WHEN status IN ('confirmed', 'finalized') THEN 1 END) as successful_executions,
      COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_executions,
      COALESCE(SUM(CASE WHEN status IN ('confirmed', 'finalized') THEN usd_estimate ELSE 0 END), 0) as total_usd_routed,
      COUNT(DISTINCT chain) as chains_count,
      COUNT(DISTINCT CASE WHEN status IN ('confirmed', 'finalized') AND from_address IS NOT NULL THEN from_address END) as unique_wallets,
      COUNT(CASE WHEN relayer_address IS NOT NULL THEN 1 END) as relayed_count,
      AVG(CASE WHEN latency_ms IS NOT NULL THEN latency_ms END) as avg_latency_ms
    FROM executions
  `;

  const row = await queryOne<any>(sql, []);

  const chainsResult = await queryRows<{chain: string}>('SELECT DISTINCT chain FROM executions WHERE status IN ($1, $2)', ['confirmed', 'finalized']);
  const chainsActive = chainsResult.map(r => r.chain);

  const totalExecs = parseInt(row?.total_executions || '0');
  const successfulExecs = parseInt(row?.successful_executions || '0');
  const failedExecs = parseInt(row?.failed_executions || '0');
  const totalUsdRouted = parseFloat(row?.total_usd_routed || '0');

  // Calculate protocol fee (0.25% = 25 bps)
  const totalFeeBlsmUsdc = totalUsdRouted * (feeBps / 10000);

  // Get breakdown by kind for reputation system
  const kindSql = `
    SELECT kind, COUNT(*) as count
    FROM executions
    WHERE status IN ('confirmed', 'finalized')
    GROUP BY kind
    ORDER BY count DESC
  `;
  const kindRows = await queryRows<{kind: string, count: string}>(kindSql, []);
  const byKind = kindRows.map(r => ({ kind: r.kind, count: parseInt(r.count || '0') }));

  // Calculate adjusted success rate (excluding RPC/infra failures)
  const infraFailSql = `
    SELECT COUNT(*) as count FROM executions
    WHERE status = 'failed'
    AND error_code NOT IN ('RPC_RATE_LIMITED', 'RPC_UNAVAILABLE', 'RPC_ERROR', 'RPC_TIMEOUT')
  `;
  const infraFailRow = await queryOne<any>(infraFailSql, []);
  const nonInfraFailedExec = parseInt(infraFailRow?.count || '0');
  const rpcInfraFailed = failedExecs - nonInfraFailedExec;
  const adjustedTotal = totalExecs - rpcInfraFailed;

  const successRateRaw = totalExecs > 0 ? (successfulExecs / totalExecs) * 100 : 0;
  const successRateAdjusted = adjustedTotal > 0 ? (successfulExecs / adjustedTotal) * 100 : successRateRaw;

  return {
    totalExecutions: totalExecs,
    successfulExecutions: successfulExecs,
    failedExecutions: failedExecs,
    successRate: successRateRaw,
    successRateRaw,
    successRateAdjusted,
    totalUsdRouted,
    totalFeeBlsmUsdc: Math.round(totalFeeBlsmUsdc * 100) / 100,
    feeBps,
    feeTokenSymbol,
    feeTreasuryAddress,
    chainsActive,
    uniqueWallets: parseInt(row?.unique_wallets || '0'),
    relayedTxCount: parseInt(row?.relayed_count || '0'),
    avgLatencyMs: Math.round(parseFloat(row?.avg_latency_ms || '0')),
    byKind,
  };
}

/**
 * Get recent executions
 */
export async function getRecentExecutions(limit: number = 50) {
  const sql = convertPlaceholders('SELECT * FROM executions ORDER BY created_at DESC LIMIT ?');
  return queryRows(sql, [limit]);
}

/**
 * Create execution step
 */
export async function createExecutionStep(params: any) {
  const id = params.id || randomUUID();
  const now = Math.floor(Date.now() / 1000);

  // Use only columns that exist in Postgres schema
  const sql = convertPlaceholders(
    `INSERT INTO execution_steps (
      id, execution_id, step_index, status, action, stage,
      tx_hash, explorer_url, error_code, error_message, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *`
  );

  const row = await queryOne(sql, [
    id,
    params.executionId,
    params.stepIndex || 0,
    params.status || 'pending',
    params.action,
    params.stage || null,
    params.txHash || null,
    params.explorerUrl || null,
    params.errorCode || null,
    params.errorMessage || null,
    now,
  ]);

  return row;
}

/**
 * Update execution step
 */
export async function updateExecutionStep(id: string, updates: any): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (updates.status !== undefined) {
    fields.push(`status = $${paramIndex++}`);
    values.push(updates.status);
  }
  if (updates.txHash !== undefined) {
    fields.push(`tx_hash = $${paramIndex++}`);
    values.push(updates.txHash);
  }
  if (updates.explorerUrl !== undefined) {
    fields.push(`explorer_url = $${paramIndex++}`);
    values.push(updates.explorerUrl);
  }
  if (updates.errorCode !== undefined) {
    fields.push(`error_code = $${paramIndex++}`);
    values.push(updates.errorCode);
  }
  if (updates.errorMessage !== undefined) {
    fields.push(`error_message = $${paramIndex++}`);
    values.push(updates.errorMessage);
  }

  if (fields.length === 0) return;

  fields.push(`updated_at = $${paramIndex++}`);
  values.push(Math.floor(Date.now() / 1000));

  values.push(id);
  const sql = `UPDATE execution_steps SET ${fields.join(', ')} WHERE id = $${paramIndex}`;

  await query(sql, values);
}

/**
 * Get executions for a specific intent
 */
export async function getExecutionsForIntent(intentId: string) {
  const sql = convertPlaceholders('SELECT * FROM executions WHERE intent_id = ? ORDER BY created_at DESC');
  return queryRows(sql, [intentId]);
}

/**
 * Get summary stats with intents
 */
export async function getSummaryStatsWithIntents() {
  const execSql = `
    SELECT
      COUNT(*) as total_executions,
      COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as successful_executions,
      COALESCE(SUM(CASE WHEN status = 'confirmed' THEN usd_estimate ELSE 0 END), 0) as total_usd_routed,
      COUNT(DISTINCT chain) as chains_count
    FROM executions
  `;

  const intentSql = `
    SELECT
      COUNT(*) as total_intents,
      COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed_intents,
      COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_intents,
      COUNT(CASE WHEN failure_stage IS NOT NULL THEN 1 END) as total_failures,
      failure_stage,
      COUNT(*) as stage_count
    FROM intents
    WHERE failure_stage IS NOT NULL
    GROUP BY failure_stage
  `;

  const execRow = await queryOne<any>(execSql, []);
  const intentRows = await queryRows<any>(intentSql, []);
  const intentCountSql = `
    SELECT
      COUNT(*) as total_intents,
      COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed_intents,
      COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_intents
    FROM intents
  `;
  const intentCountRow = await queryOne<any>(intentCountSql, []);

  const chainsResult = await queryRows<{chain: string}>('SELECT DISTINCT chain FROM executions WHERE status = $1', ['confirmed']);
  const chainsActive = chainsResult.map(r => r.chain);

  const totalExecs = parseInt(execRow?.total_executions || '0');
  const successfulExecs = parseInt(execRow?.successful_executions || '0');
  const totalIntents = parseInt(intentCountRow?.total_intents || '0');
  const confirmedIntents = parseInt(intentCountRow?.confirmed_intents || '0');
  const failedIntents = parseInt(intentCountRow?.failed_intents || '0');

  return {
    totalExecutions: totalExecs,
    successfulExecutions: successfulExecs,
    successRate: totalExecs > 0 ? (successfulExecs / totalExecs) * 100 : 0,
    totalUsdRouted: parseFloat(execRow?.total_usd_routed || '0'),
    chainsActive,
    totalIntents,
    confirmedIntents,
    failedIntents,
    intentSuccessRate: totalIntents > 0 ? (confirmedIntents / totalIntents) * 100 : 0,
    failedIntentsByStage: intentRows.map(r => ({
      stage: r.failure_stage,
      count: parseInt(r.stage_count),
    })),
  };
}

/**
 * Create a position in the ledger (Postgres)
 */
export async function createPosition(input: {
  chain: string;
  network: string;
  venue: string;
  market: string;
  side: string;
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
}) {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);

  const sql = convertPlaceholders(`
    INSERT INTO positions (
      id, chain, network, venue, market, side, leverage,
      margin_units, margin_display, size_units, entry_price,
      status, opened_at, open_tx_hash, open_explorer_url,
      user_address, on_chain_position_id, intent_id, execution_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `);

  const row = await queryOne(sql, [
    id,
    input.chain,
    input.network,
    input.venue,
    input.market,
    input.side,
    input.leverage ?? null,
    input.margin_units ?? null,
    input.margin_display ?? null,
    input.size_units ?? null,
    input.entry_price ?? null,
    now,
    input.open_tx_hash ?? null,
    input.open_explorer_url ?? null,
    input.user_address,
    input.on_chain_position_id ?? null,
    input.intent_id ?? null,
    input.execution_id ?? null,
    now,
    now,
  ]);

  console.log(`[Postgres] Created position: ${id} for ${input.market} ${input.side}`);
  return row;
}

/**
 * Get open positions (Postgres)
 */
export async function getOpenPositions(filters?: {
  chain?: string;
  network?: string;
  venue?: string;
  user_address?: string;
}) {
  let sql = 'SELECT * FROM positions WHERE status = $1';
  const params: any[] = ['open'];
  let paramIndex = 2;

  if (filters?.chain) {
    sql += ` AND chain = $${paramIndex++}`;
    params.push(filters.chain);
  }
  if (filters?.network) {
    sql += ` AND network = $${paramIndex++}`;
    params.push(filters.network);
  }
  if (filters?.venue) {
    sql += ` AND venue = $${paramIndex++}`;
    params.push(filters.venue);
  }
  if (filters?.user_address) {
    sql += ` AND user_address = $${paramIndex++}`;
    params.push(filters.user_address);
  }

  sql += ' ORDER BY opened_at DESC';

  return queryRows(sql, params);
}
