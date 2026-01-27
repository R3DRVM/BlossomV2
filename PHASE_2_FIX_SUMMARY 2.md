# Phase 2 - Fix Implementation

## Root Cause

**Serverless Postgres Persistence Bug**:
- `pool.query()` executes in auto-commit mode (each query is its own implicit transaction)
- Serverless function returns HTTP response before connection pool flushes pending writes
- Once HTTP 200 is sent, Vercel freezes/terminates the function
- Confirm-stage writes (updateExecution, updateIntentStatus) happen at END of execution
- Connection buffer never flushes before function freeze → **writes lost**

**Why Intent Creation Worked**:
- Happens EARLY in 12.5s execution window
- Postgres has time to flush before function returns
- Only confirm-stage writes were affected

## The Fix

Created **`confirmIntentWithExecution()`** function in `db-pg.ts`:

```typescript
export async function confirmIntentWithExecution(
  intentId: string,
  executionId: string,
  updates: {
    intentStatus: UpdateIntentStatusParams;
    executionStatus: UpdateExecutionParams;
  }
): Promise<void>
```

**How It Works**:
1. Uses existing `transaction()` helper from `db-pg-client.ts`
2. Wraps BOTH execution and intent updates in single BEGIN/COMMIT block
3. Ensures Postgres COMMIT happens before function returns
4. If either update fails, entire transaction rolls back (atomic)

**Transaction Flow**:
```
BEGIN
  UPDATE executions SET status='confirmed', tx_hash=... WHERE id=...
  UPDATE intents SET status='confirmed', confirmed_at=... WHERE id=...
COMMIT  ← This MUST complete before HTTP response
```

## Files Changed

### 1. `agent/execution-ledger/db-pg.ts`

**Added** (lines 325-412):
- `confirmIntentWithExecution()` - durable transaction wrapper
- Uses `transaction()` helper to ensure explicit COMMIT
- Logs transaction BEGIN/COMMIT for debugging
- Throws error if intent not found (prevents silent failures)

**Enhanced Logging**:
- Added rowCount to all update operations
- Warns if UPDATE affects 0 rows
- Logs transaction lifecycle

### 2. `agent/src/intent/intentRunner.ts`

**Updated `executeEthereum()` (lines ~2003-2027)**:

Before:
```typescript
await updateExecution(execution.id, {...});
await updateIntentStatus(intentId, { status: 'confirmed', ... });
```

After:
```typescript
const { confirmIntentWithExecution } = await import('../../execution-ledger/db-pg.js');

await confirmIntentWithExecution(intentId, execution.id, {
  executionStatus: { status: 'confirmed', txHash, ... },
  intentStatus: { status: 'confirmed', confirmedAt: now, ... },
});
```

**Updated `executePerpEthereum()` (lines ~1356-1379)**:
- Same pattern: replaced separate calls with durable transaction

## Why This Works

1. **Explicit Transaction Boundary**:
   - `BEGIN` acquired connection from pool
   - Both UPDATEs execute on same connection
   - `COMMIT` flushes to disk
   - Connection released back to pool

2. **Synchronous Before Return**:
   - Function CANNOT return HTTP response until `await confirmIntentWithExecution()` completes
   - TypeScript `await` ensures COMMIT finishes before next line
   - Only after COMMIT does function return success to caller

3. **Atomic Semantics**:
   - If execution update succeeds but intent update fails → ROLLBACK both
   - No partial state in database
   - Errors propagate to caller

## What's NOT Changed

- Intent creation (still uses auto-commit, works fine since it's early in lifecycle)
- Failure paths (don't need transaction, already have correct error semantics)
- Link execution to intent (happens before confirm stage)
- Stats queries (read-only)

## Verification Plan (Phase 3)

1. Run single real execution via run-execution-checks.ts
2. Check Vercel logs for `[Postgres] BEGIN CONFIRM TRANSACTION` and `COMMIT`
3. Query Neon immediately:
   - `SELECT status, confirmed_at FROM intents WHERE id = ...` → should be 'confirmed'
   - `SELECT COUNT(*) FROM executions WHERE intent_id = ...` → should be 1
4. Verify stats API shows incremented counts
5. Verify stats.blossom.onl shows execution with explorer link
