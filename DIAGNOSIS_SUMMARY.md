# Production Issues - Diagnosis Summary

## WHAT WAS WRONG

### Issue 1: Stats Page Making Localhost Health Calls
**Problem**: `API_BASE` was a constant evaluated at module load time, before `window` object was available in some scenarios, causing it to fall back to `localhost:3001`.

**Fix**: Changed `API_BASE` from a constant to a function call `getApiBaseUrl()` that evaluates at runtime.

**Files Changed**:
- `src/pages/DevStatsPage.tsx` (lines 158, 214, 221, 263-266, 309)

### Issue 2: Stats API Missing Recent Data
**Problem**: `/api/stats/public` endpoint only returned aggregate counts, no recent intents or executions list.

**Fix**: Added `recentIntents` array to the public stats response (sanitized, no metadata).

**Files Changed**:
- `agent/src/server/http.ts` (lines 6673-6713)

### Issue 3: Test Script Used planOnly Mode
**Problem**: `run-execution-checks.ts` had all tests with `planOnly: true`, so no real executions were created.

**Fix**: Updated test cases to mix plan-only and real executions with smaller amounts.

**Files Changed**:
- `agent/scripts/run-execution-checks.ts` (lines 22-28)

### Issue 4: **CRITICAL - UNRESOLVED** Postgres Writes Not Persisting
**Problem**:
- API returns status "confirmed" for intents
- Database shows intents stuck in "executing" status
- `confirmed_at` timestamp is null
- Executions table is empty (0 rows)
- This suggests async Postgres writes are completing in-memory but not persisting to database

**Evidence**:
```sql
-- Database state after "successful" executions
SELECT COUNT(*) FROM intents WHERE status = 'confirmed';
-- Result: 0

SELECT COUNT(*) FROM intents WHERE status = 'executing';
-- Result: 4

SELECT COUNT(*) FROM executions;
-- Result: 0
```

**Attempted Fixes** (deployed but untested due to DB query issues):
- Added error logging to `updateIntentStatus` and `createExecution`
- Added `rowCount` logging to verify updates are happening

**Next Steps Needed**:
1. Check Vercel logs to see if Postgres operations are logging errors
2. Verify that `updateIntentStatusAsync` is actually executing the UPDATE query
3. Check if there's a connection pool issue or transactions not committing
4. Consider if serverless cold starts are causing connection issues

## PROOF OF CURRENT STATE

### API Response
```json
{
  "ok": true,
  "data": {
    "totalIntents": 12,
    "confirmedIntents": 0,
    "totalExecutions": 0,
    "successfulExecutions": 0,
    "recentIntents": [ ...7 items... ]
  }
}
```

### Database State
```
Intents by status:
  planned: 8
  executing: 4
  confirmed: 0

Total executions: 0

Last 5 intents:
  4a5842a3 executing (confirmed_at: null)
  80570463 executing (confirmed_at: null)
  49ffc935 executing (confirmed_at: null)
  4f9d2424 executing (confirmed_at: null)
  c4860739 planned
```

## WHAT'S WORKING

✅ Stats API returns data (no 500 errors)
✅ Recent intents are included in API response
✅ Intents are created successfully (12 total)
✅ Frontend no longer makes localhost calls (API_BASE fix deployed)
✅ API responds with "confirmed" status quickly

## WHAT'S BROKEN

❌ Confirmed intents count = 0 (should be 3-5)
❌ Executions count = 0 (should match confirmed intents)
❌ Intents stuck in "executing" status never transition to "confirmed"
❌ `confirmed_at` timestamps never set
❌ Recent Executions empty (because executions table empty)

## FILES CHANGED

1. `src/pages/DevStatsPage.tsx` - API_BASE function + recentIntents rendering
2. `agent/src/server/http.ts` - Added recentIntents to /api/stats/public
3. `agent/scripts/run-execution-checks.ts` - Mixed planOnly and real executions
4. `agent/execution-ledger/db-pg.ts` - Added logging to UPDATE/INSERT operations

## NEXT ACTIONS REQUIRED

1. **Check Vercel Logs** for Postgres errors:
   ```bash
   vercel logs https://blossom-v2.vercel.app --since=10m | grep "\[Postgres\]"
   ```

2. **Test Direct Postgres Connection** to verify credentials work

3. **Add Transaction Wrapper** to ensure commits happen:
   ```typescript
   await transaction(async (client) => {
     // Create execution
     // Update intent status
     // Commit happens automatically
   });
   ```

4. **Check Serverless Timeout**: Verify 30s is enough for Postgres writes

5. **Fallback Option**: If Postgres writes continue failing, temporarily use SQLite-on-disk until root cause found

## TEST RESULTS

Execution checks showed:
- ✓ 5/5 tests "passed" (API returned success)
- ✗ 0 confirmed intents in database
- ✗ 0 executions in database
- ✗ All test intents stuck in "executing" status

**Conclusion**: Tests appear to pass but don't actually persist data correctly.
