# Sprint 3.1.1: Deterministic Mode Stress Test Fix

## Root Cause

The stress test was checking dFlow call count for deterministic mode based on the test configuration (`modeConfig.name === 'deterministic'`), not the actual backend routing mode. This caused false failures when the backend was running in hybrid/dflow mode but the test was configured to test deterministic mode.

## Files Changed

### 1. `agent/scripts/stress-test-routing.ts` (lines 333-387)
- **Added**: Preflight check at start of each test mode to get actual backend routing mode
- **Changed**: Deterministic mode check now only runs when `actualRoutingMode === 'deterministic'`
- **Added**: Warning message when deterministic mode is requested but backend is in different mode
- **Result**: Prevents false failures when backend mode doesn't match test expectation

### 2. `SPRINT_3_1_STRESS_AND_WOW.md` (lines 11, 46-56)
- **Added**: Note about automatic backend routing mode detection
- **Updated**: Instructions for testing deterministic mode with explicit backend restart requirement

## Proof Outputs

### Test 1: Default Run (Backend in hybrid/dflow mode)

```bash
$ cd agent && STRESS_CONCURRENCY=200 npm run stress:routing
```

**Output excerpt:**
```
Testing Mode: deterministic
============================================================

📊 Backend routing mode: dflow
⚠️  Note: Backend should be running with:
   ROUTING_MODE=deterministic

⚠️  Skipping deterministic mode check: backend is in dflow mode, not deterministic
   To test deterministic mode, restart backend with: ROUTING_MODE=deterministic npm run dev

[1/2] Testing Event Markets...
Event Markets Results:
  Total Requests: 200
  ✅ Success: 200
  📊 Routing Present: 200/200 (100.0%)
  🔑 Unique Correlation IDs: 200
  🔄 Duplicate Correlation IDs: 0

[2/2] Testing Swap Quotes...
Swap Quotes Results:
  Total Requests: 200
  ✅ Success: 200
  📊 Routing Present: 200/200 (100.0%)
  🔑 Unique Correlation IDs: 200
  🔄 Duplicate Correlation IDs: 0

⚠️  Skipping deterministic mode dFlow check: backend is in dflow mode

============================================================
STRESS TEST SUMMARY
============================================================
🎉 ALL STRESS TESTS PASSED
   ✅ 1200 total requests handled correctly
   ✅ Routing metadata present in all responses
   ✅ Correlation IDs are unique
   ✅ LatencyMs >= 0
```

**Result**: ✅ PASS - No false failures. Deterministic check correctly skipped.

### Test 2: Deterministic Mode (Backend Restarted with ROUTING_MODE=deterministic)

**To test deterministic mode** (requires backend restart):

```bash
# Terminal 1: Stop backend, restart with deterministic mode
cd agent
ROUTING_MODE=deterministic npm run dev

# Terminal 2: Run stress test
cd agent
STRESS_TEST_MODE=deterministic npm run stress:routing
```

**Expected output** (when backend is actually in deterministic mode):
```
Testing Mode: deterministic
============================================================

📊 Backend routing mode: deterministic
⚠️  Note: Backend should be running with:
   ROUTING_MODE=deterministic

[1/2] Testing Event Markets...
Event Markets Results:
  Total Requests: 200
  ✅ Success: 200
  📊 Routing Present: 200/200 (100.0%)
  🔑 Unique Correlation IDs: 200
  🔄 Duplicate Correlation IDs: 0

[2/2] Testing Swap Quotes...
Swap Quotes Results:
  Total Requests: 200
  ✅ Success: 200
  📊 Routing Present: 200/200 (100.0%)
  🔑 Unique Correlation IDs: 200
  🔄 Duplicate Correlation IDs: 0

🔍 Deterministic Mode Check (backend mode: deterministic):
   dFlow calls before: 0
   dFlow calls after: 0
   ✅ dFlow was not called (as expected)

============================================================
STRESS TEST SUMMARY
============================================================
🎉 ALL STRESS TESTS PASSED
```

## Summary

✅ **Requirement 1**: Stress test never reports deterministic-mode failure when `preflight.routing.mode != "deterministic"` - **SATISFIED**

✅ **Requirement 2**: When `STRESS_TEST_MODE=deterministic` AND `preflight.routing.mode === "deterministic"`, script asserts dFlow call count does not increase - **SATISFIED**

✅ **Requirement 3**: Updated documentation with exact instructions for running deterministic mode - **SATISFIED**

The fix ensures the stress test only checks dFlow call count when the backend is actually in deterministic mode, preventing false failures in hybrid/dflow mode.
