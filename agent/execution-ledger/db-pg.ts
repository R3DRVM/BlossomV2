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
  intentKind?: string;
  requestedChain?: string;
  requestedVenue?: string;
  usdEstimate?: number;
  metadataJson?: string;
}

interface UpdateIntentStatusParams {
  status?: string;
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
  chain: string;
  network: string;
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
  usdEstimateIsEstimate?: boolean;
  txHash?: string;
  status?: string;
  errorCode?: string;
  errorMessage?: string;
  explorerUrl?: string;
  relayerAddress?: string;
  sessionId?: string;
  intentId?: string;
}

interface UpdateExecutionParams {
  status?: string;
  txHash?: string;
  explorerUrl?: string;
  blockNumber?: number;
  gasUsed?: string;
  latencyMs?: number;
  errorCode?: string;
  errorMessage?: string;
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
      params.usdEstimateIsEstimate !== undefined ? params.usdEstimateIsEstimate : true,
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
 * DURABLE CONFIRM TRANSACTION
 * Wraps confirm-stage writes in explicit transaction to ensure commit before function exit
 * This fixes the serverless persistence bug where HTTP response was sent before Postgres flush
 */
export async function confirmIntentWithExecution(
  intentId: string,
  executionId: string,
  updates: {
    intentStatus: UpdateIntentStatusParams;
    executionStatus: UpdateExecutionParams;
  }
): Promise<void> {
  console.log(`[Postgres] BEGIN CONFIRM TRANSACTION for intent ${intentId.slice(0,8)}, exec ${executionId.slice(0,8)}`);

  await transaction(async (client) => {
    // Update execution status
    const execFields: string[] = [];
    const execValues: any[] = [];
    let execParamIndex = 1;

    if (updates.executionStatus.status !== undefined) {
      execFields.push(`status = $${execParamIndex++}`);
      execValues.push(updates.executionStatus.status);
    }
    if (updates.executionStatus.txHash !== undefined) {
      execFields.push(`tx_hash = $${execParamIndex++}`);
      execValues.push(updates.executionStatus.txHash);
    }
    if (updates.executionStatus.explorerUrl !== undefined) {
      execFields.push(`explorer_url = $${execParamIndex++}`);
      execValues.push(updates.executionStatus.explorerUrl);
    }
    if (updates.executionStatus.blockNumber !== undefined) {
      execFields.push(`block_number = $${execParamIndex++}`);
      execValues.push(updates.executionStatus.blockNumber);
    }
    if (updates.executionStatus.gasUsed !== undefined) {
      execFields.push(`gas_used = $${execParamIndex++}`);
      execValues.push(updates.executionStatus.gasUsed);
    }
    if (updates.executionStatus.latencyMs !== undefined) {
      execFields.push(`latency_ms = $${execParamIndex++}`);
      execValues.push(updates.executionStatus.latencyMs);
    }

    if (execFields.length > 0) {
      execFields.push(`updated_at = $${execParamIndex++}`);
      execValues.push(Math.floor(Date.now() / 1000));
      execValues.push(executionId);

      const execSql = `UPDATE executions SET ${execFields.join(', ')} WHERE id = $${execParamIndex}`;
      const execResult = await client.query(execSql, execValues);
      console.log(`[Postgres]   Execution update: ${execResult.rowCount || 0} rows`);
    }

    // Update intent status to confirmed
    const intentFields: string[] = [];
    const intentValues: any[] = [];
    let intentParamIndex = 1;

    if (updates.intentStatus.status !== undefined) {
      intentFields.push(`status = $${intentParamIndex++}`);
      intentValues.push(updates.intentStatus.status);
    }
    if (updates.intentStatus.confirmedAt !== undefined) {
      intentFields.push(`confirmed_at = $${intentParamIndex++}`);
      intentValues.push(updates.intentStatus.confirmedAt);
    }
    if (updates.intentStatus.metadataJson !== undefined) {
      intentFields.push(`metadata_json = $${intentParamIndex++}`);
      intentValues.push(updates.intentStatus.metadataJson);
    }

    if (intentFields.length > 0) {
      intentValues.push(intentId);
      const intentSql = `UPDATE intents SET ${intentFields.join(', ')} WHERE id = $${intentParamIndex}`;
      const intentResult = await client.query(intentSql, intentValues);
      console.log(`[Postgres]   Intent update: ${intentResult.rowCount || 0} rows`);

      if (intentResult.rowCount === 0) {
        throw new Error(`Intent ${intentId} not found for confirmation`);
      }
    }

    console.log(`[Postgres] COMMIT CONFIRM TRANSACTION`);
  });
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
  const sql = `
    SELECT
      COUNT(*) as total_executions,
      COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as successful_executions,
      COALESCE(SUM(CASE WHEN status = 'confirmed' THEN usd_estimate ELSE 0 END), 0) as total_usd_routed,
      COUNT(DISTINCT chain) as chains_count
    FROM executions
  `;

  const row = await queryOne<any>(sql, []);

  const chainsResult = await queryRows<{chain: string}>('SELECT DISTINCT chain FROM executions WHERE status = $1', ['confirmed']);
  const chainsActive = chainsResult.map(r => r.chain);

  const totalExecs = parseInt(row?.total_executions || '0');
  const successfulExecs = parseInt(row?.successful_executions || '0');

  return {
    totalExecutions: totalExecs,
    successfulExecutions: successfulExecs,
    successRate: totalExecs > 0 ? (successfulExecs / totalExecs) * 100 : 0,
    totalUsdRouted: parseFloat(row?.total_usd_routed || '0'),
    chainsActive,
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

  const sql = convertPlaceholders(
    `INSERT INTO execution_steps (
      id, execution_id, step_index, status, action, chain, venue,
      amount, token, tx_hash, explorer_url, error_code, error_message,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *`
  );

  const row = await queryOne(sql, [
    id,
    params.executionId,
    params.stepIndex || 0,
    params.status || 'pending',
    params.action,
    params.chain,
    params.venue || null,
    params.amount || null,
    params.token || null,
    params.txHash || null,
    params.explorerUrl || null,
    params.errorCode || null,
    params.errorMessage || null,
    now,
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
