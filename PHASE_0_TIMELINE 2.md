# Phase 0 - Reproduction Timeline

## Test Execution

**Time**: 2026-01-26 02:29:14 UTC
**Intent ID**: `5045fde1-ead2-4a21-9fa6-abcb64d19441`
**Execution ID**: `3bca2a0e-1ebc-4fb1-8c4c-bfa5051223cc`
**Request**: `POST /api/ledger/intents/execute` with `{"intentText":"swap 0.5 REDACTED for WETH","chain":"ethereum","planOnly":false}`

## API Response (12.5 seconds)

```json
{
  "ok": true,
  "intentId": "5045fde1-ead2-4a21-9fa6-abcb64d19441",
  "status": "confirmed",
  "executionId": "3bca2a0e-1ebc-4fb1-8c4c-bfa5051223cc",
  "txHash": "0x60798cb73993d5d30b5a05aa9a2d27c41078a5288b3b109c5b8c461785423619",
  "explorerUrl": "https://sepolia.etherscan.io/tx/0x60798cb73993d5d30b5a05aa9a2d27c41078a5288b3b109c5b8c461785423619",
  "metadata": {"executedKind": "real"}
}
```

**✅ API Claims**:
- Status: `confirmed`
- Has execution ID
- Has transaction hash
- Has explorer URL

## Database Reality (Queried Immediately After)

### Intent State
```
ID: 5045fde1-ead2-4a21-9fa6-abcb64d19441
Status: executing ❌ (should be "confirmed")
Kind: swap
Created: 2026-01-26T02:29:14.000Z ✅
Confirmed: null ❌ (should have timestamp)
Executed: 2026-01-26T02:29:14.000Z ✅
```

### Executions Table
```
Linked Executions: 0 ❌ (should have 1 row with ID 3bca2a0e...)
```

### Database Summary
```
Total Intents: 15
Confirmed Intents: 0 ❌ (should be at least 1)
Total Executions: 0 ❌ (should be at least 1)
```

## The Mismatch (PROVEN)

| Field | API Says | Database Shows | Status |
|-------|----------|----------------|--------|
| Intent Status | `confirmed` | `executing` | ❌ MISMATCH |
| Confirmed At | (implied) | `null` | ❌ MISMATCH |
| Execution Row | ID `3bca2a0e...` | 0 rows | ❌ MISSING |
| TX Hash | `0x60798...` | N/A (no exec row) | ❌ MISSING |

## What Works

1. ✅ Intent creation (`id`, `status=executing`, `created_at`, `executed_at` all persist)
2. ✅ API completes successfully in 12.5s
3. ✅ No HTTP errors (200 OK)
4. ✅ `executed_at` timestamp is set

## What Fails

1. ❌ `updateIntentStatus()` with `status: "confirmed"` doesn't persist
2. ❌ `updateIntentStatus()` with `confirmed_at` timestamp doesn't persist
3. ❌ `createExecution()` doesn't create row in executions table
4. ❌ All "final stage" Postgres writes are lost

## Hypothesis

The intent lifecycle is:
1. **Create intent** → ✅ Works (row inserted, status=executing)
2. **Execute transaction** → ✅ Works (executed_at timestamp set)
3. **Confirm intent + create execution** → ❌ FAILS (writes don't persist)

**Most Likely Cause**:
- Serverless function returns HTTP response before final Postgres writes complete
- Connection pool closes or function terminates mid-write
- Missing `await` or transaction not committed before function exit

## Root Cause Analysis

**CODE AUDIT FINDINGS**:

1. ✅ `intentRunner.ts` properly awaits all database operations:
   - `await createExecution(...)` (line 1956)
   - `await linkExecutionToIntent(...)` (line 1970)
   - `await updateExecution(...)` (line 2006)
   - `await updateIntentStatus(..., { status: 'confirmed', ... })` (line 2016)

2. ✅ `db-pg.ts` properly implements async functions with logging:
   - `updateIntentStatus()` awaits `query()` and logs rowCount (line 148-149)
   - `createExecution()` awaits `queryOne()` with logging (line 191)

3. ❌ **CRITICAL ISSUE FOUND in `db-pg-client.ts` (lines 55-61)**:
   ```typescript
   export async function query<T = any>(
     sql: string,
     params: any[] = []
   ): Promise<QueryResult<T>> {
     const pool = getPgPool();
     return pool.query<T>(sql, params);  // ⚠️ AUTO-COMMIT MODE
   }
   ```

**The Problem**:
- Using `pool.query()` in serverless environment
- Queries execute in auto-commit mode (each query is its own transaction)
- Serverless function can return HTTP response **before** connection pool flushes to database
- Once HTTP response sent, Vercel freezes/terminates the function
- Pending writes in connection buffer are lost

**Why Intent Creation Works But Confirmation Doesn't**:
- Intent creation happens EARLY in the 12.5s execution window
- Postgres has time to flush these writes before function returns
- Final `updateIntentStatus(confirmed)` and `createExecution()` happen at END
- Function returns HTTP 200 immediately after these calls
- Connection pool doesn't flush before function freeze

## Next Steps (Phase 1)

Create **durable write wrapper** using explicit transactions:
1. Wrap confirm-stage writes in `transaction()` block
2. Ensure COMMIT before returning HTTP response
3. Add verification that rowCount > 0
4. Test with single execution to prove fix
