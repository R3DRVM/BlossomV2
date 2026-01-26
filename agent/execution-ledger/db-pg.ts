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
        const stepSql = convertPlaceholders(
          `INSERT INTO execution_steps (
            id, execution_id, step_index, status, action, chain, venue,
            amount, token, tx_hash, explorer_url, error_code, error_message,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );

        await client.query(stepSql, [
          stepId,
          executionId,
          step.stepIndex || 0,
          step.status || 'confirmed',
          step.action,
          step.chain,
          step.venue || null,
          step.amount || null,
          step.token || null,
          step.txHash || null,
          step.explorerUrl || null,
          null, // error_code
          null, // error_message
          now,
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
    if (params.intentStatus.failedAt !== undefined) {
      intentFields.push(`failed_at = $${intentParamIndex++}`);
      intentValues.push(params.intentStatus.failedAt);
    }
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
