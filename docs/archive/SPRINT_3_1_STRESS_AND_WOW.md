# Sprint 3.1: Stress Test + New User Wow Path Scripts

## 1. Concurrency + Rate-Limit Stress Test

**Script**: `agent/scripts/stress-test-routing.ts`  
**Command**: `cd agent && npm run stress:routing`

### Purpose
Proves routing metadata stays correct under burst load ("I mashed buttons" test).

### Important: Backend Routing Mode Detection
The stress test automatically detects the backend's actual routing mode via `/api/execute/preflight` and only asserts dFlow call count when the backend is actually in deterministic mode. This prevents false failures when testing in hybrid/dflow mode.

### What It Tests
- Fires 50-200 concurrent requests to:
  - Event markets route (`/api/chat`)
  - Swap quote route (`/api/execute/prepare`)
- Runs in three modes:
  - `ROUTING_MODE=deterministic` (should not call dFlow)
  - `ROUTING_MODE=hybrid + DFLOW_FORCE_FAIL=true` (should fallback gracefully)
  - `ROUTING_MODE=hybrid + DFLOW_FORCE_TIMEOUT=true` (should handle timeout)

### Assertions
- ✅ 100% (or at least 95%) responses include routing metadata
- ✅ All `latencyMs >= 0`
- ✅ Correlation IDs are unique (99%+ unique, no duplicates)
- ✅ Deterministic mode does not increment `dflowCallCount`

### Usage

**Basic (default: 50 concurrent requests, all modes)**:
```bash
cd agent
npm run stress:routing
```

**Custom concurrency**:
```bash
STRESS_CONCURRENCY=100 npm run stress:routing
```

**Test specific mode**:
```bash
STRESS_TEST_MODE=deterministic npm run stress:routing
STRESS_TEST_MODE=hybrid-fail npm run stress:routing
STRESS_TEST_MODE=hybrid-timeout npm run stress:routing
```

**Important**: For deterministic/hybrid-fail/hybrid-timeout modes, you **MUST** restart the backend with the appropriate environment variables. The stress test checks the actual backend routing mode via `/api/execute/preflight` and only asserts dFlow call count when the backend is actually in deterministic mode.

```bash
# Terminal 1: Stop current backend (Ctrl+C), then restart with deterministic mode
cd agent
ROUTING_MODE=deterministic npm run dev

# Terminal 2: Run stress test (will detect deterministic mode from preflight)
cd agent
STRESS_TEST_MODE=deterministic npm run stress:routing
```

**Note**: If you run the stress test in deterministic mode but the backend is in hybrid/dflow mode, the test will skip the dFlow call count check and show a warning. This prevents false failures.

### Example Output

```
🚀 Sprint 3.1: Concurrency + Rate-Limit Stress Test
============================================================
API Base: http://localhost:3001
Concurrency: 50 requests per endpoint
Test Mode: all
============================================================

Testing Mode: deterministic
  Firing 50 concurrent requests to /api/chat (event markets)...
  Firing 50 concurrent requests to /api/execute/prepare (swap quote)...

Event Markets Results:
  Total Requests: 50
  ✅ Success: 48
  ❌ Failure: 2
  📊 Routing Present: 48/50 (96.0%)
  🔑 Unique Correlation IDs: 48
  🔄 Duplicate Correlation IDs: 0
  ⏱️  Latency Stats (ms):
     Min: 45
     Max: 320
     Avg: 125
     P50: 110
     P95: 280
     P99: 310

🔍 Deterministic Mode Check:
   dFlow calls before: 0
   dFlow calls after: 0
   ✅ dFlow was not called (as expected)

============================================================
🎉 ALL STRESS TESTS PASSED
   ✅ 300 total requests handled correctly
   ✅ Routing metadata present in all responses
   ✅ Correlation IDs are unique
   ✅ LatencyMs >= 0
   ✅ Deterministic mode does not call dFlow
```

---

## 2. "New User Wow Path" End-to-End Proof

**Script**: `agent/scripts/prove-new-user-wow.ts`  
**Command**: `cd agent && npm run prove:new-user-wow`

### Purpose
Pre-demo sanity check before every tester session. Single command that prints a friendly pass/fail checklist.

### What It Tests
1. ✅ `/health` - Backend is healthy
2. ✅ `/api/execute/preflight` - Verify `routing.mode` + dFlow capabilities
3. ✅ Event markets endpoint - Call once, verify routing metadata
4. ✅ Swap quote endpoint - Call once, verify routing metadata

### Output Format
```
✨ Sprint 3.1: "New User Wow Path" End-to-End Proof
============================================================

[1/4] Checking /health...
[2/4] Checking /api/execute/preflight...
[3/4] Testing event markets endpoint...
[4/4] Testing swap quote endpoint...

============================================================
NEW USER WOW PATH CHECKLIST
============================================================

✅ [1] Health: PASS
   Backend is healthy

✅ [2] Preflight: PASS
   Routing mode: hybrid, dFlow enabled: true

✅ [3] Event Markets: PASS
   source=fallback mode=hybrid latencyMs=150ms corr=markets-1234567890-abc123...

✅ [4] Swap Quote: PASS
   source=dflow mode=hybrid latencyMs=200ms corr=swap-1234567890-xyz789...

📊 Routing Summary:
   EVENT_MARKETS: source=fallback mode=hybrid      corr=markets-1234567890-abc123...
   SWAP_QUOTE:    source=dflow    mode=hybrid      corr=swap-1234567890-xyz789...

============================================================
🎉 ALL CHECKS PASSED (4/4)
   Ready for demo! ✨
```

### Usage

**Basic**:
```bash
cd agent
npm run prove:new-user-wow
```

**Custom API base**:
```bash
AGENT_API_BASE_URL=http://localhost:3001 npm run prove:new-user-wow
```

**Custom test user**:
```bash
TEST_USER_ADDRESS=0xYourAddress npm run prove:new-user-wow
```

### When to Run
- **Before every demo session**
- **After backend restart**
- **After environment variable changes**
- **Before showing routing features to new users**

---

## Quick Reference

| Script | Command | Purpose | When to Use |
|--------|---------|---------|-------------|
| Stress Test | `npm run stress:routing` | Prove routing under load | Before release, after routing changes |
| New User Wow | `npm run prove:new-user-wow` | Pre-demo sanity check | Before every demo, after backend restart |

---

## Troubleshooting

### Stress Test Fails: "Only X% responses include routing metadata"
- Check backend logs for errors
- Verify routing service is not throwing exceptions
- Check if backend is rate-limiting requests
- Increase timeout if requests are timing out

### Stress Test Fails: "Found duplicate correlationIds"
- This indicates correlation ID generation is not thread-safe
- Check `routingService.ts` correlation ID generation
- Ensure each request gets a unique ID

### New User Wow Fails: "Event Markets: FAIL"
- Check backend is running: `curl http://localhost:3001/health`
- Check backend logs for errors
- Verify routing service is properly imported and called

### New User Wow Fails: "Swap Quote: source=unknown"
- Swap quote routing metadata may not be present if routing service is not called
- Check if swap goes through routing service in `evmQuote.ts`
- Verify executor includes routing metadata in response

---

## Integration with CI/CD

Both scripts exit with code 0 on success, 1 on failure, making them suitable for CI/CD:

```bash
# CI/CD example
cd agent
npm run prove:new-user-wow && npm run stress:routing || exit 1
```
