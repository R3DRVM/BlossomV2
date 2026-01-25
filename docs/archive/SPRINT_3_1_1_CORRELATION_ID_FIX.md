# Sprint 3.1.1: Correlation ID Uniqueness Hardening

## Root Cause Explanation

Under high concurrency (200+ requests), correlation IDs were colliding because they were generated using `Date.now()` which only has millisecond precision. When multiple requests fire simultaneously within the same millisecond, they get identical timestamps, leading to duplicate correlation IDs. The `Math.random()` suffix helped but wasn't sufficient under extreme concurrency.

**Solution**: Replace all correlation ID generation with `crypto.randomUUID()`, which guarantees globally unique IDs even under maximum concurrency.

## Files Changed

### 1. `agent/src/utils/correlationId.ts` (NEW)
- Created centralized correlation ID generator using `crypto.randomUUID()`
- Exports `makeCorrelationId(prefix?: string)` function
- Format: `"prefix-uuid"` or just `"uuid"` if no prefix

### 2. `agent/src/routing/routingService.ts` (lines 26, 115, 461)
- Added import: `import { makeCorrelationId } from '../utils/correlationId';`
- Replaced `generateCorrelationId()` calls with `makeCorrelationId('swap')` and `makeCorrelationId('markets')`

### 3. `agent/src/quotes/eventMarkets.ts` (lines 55, 119)
- Replaced `markets-${Date.now()}-${Math.random()...}` with `makeCorrelationId('markets')`
- Uses dynamic import to avoid circular dependencies

### 4. `agent/src/quotes/evmQuote.ts` (line 177)
- Replaced `swap-${Date.now()}-${Math.random()...}` with `makeCorrelationId('swap')`
- Uses dynamic import to avoid circular dependencies

### 5. `agent/src/executors/ethTestnetExecutor.ts` (lines 29, 1302, 1318)
- Added import: `import { makeCorrelationId } from '../utils/correlationId';`
- Replaced `executor-${Date.now()}-${Math.random()...}` with `makeCorrelationId('executor')` in both fallback routing metadata locations

### 6. `agent/src/server/http.ts` (lines 71, 85-87, 865)
- Added import: `import { makeCorrelationId } from './utils/correlationId';`
- Updated `generateCorrelationId()` to use `makeCorrelationId()` (no prefix for HTTP-level IDs)
- Replaced `error-${Date.now()}` with `makeCorrelationId('error')`

### 7. `agent/scripts/stress-test-routing.ts` (line 180)
- Updated correlation ID extraction to handle nested `routing.routing.correlationId` path for swap quotes
- Added fallback to top-level `correlationId` if nested path not found

## Testing

To verify the fix, run:

```bash
# Start backend
cd agent && npm run dev

# In another terminal, run stress test at high concurrency
cd agent && STRESS_CONCURRENCY=200 npm run stress:routing
```

**Expected Results:**
- ✅ Correlation IDs unique >= 99.9% (200/200 unique)
- ✅ Routing metadata present >= 95% for both endpoints
- ✅ No duplicate correlation IDs in any test mode

## Implementation Details

All correlation ID generation now uses `crypto.randomUUID()`, which:
- Generates RFC 4122 version 4 UUIDs
- Guarantees uniqueness even under maximum concurrency
- No timestamp dependency, eliminating collision risk
- Format: `550e8400-e29b-41d4-a716-446655440000`

Prefixes are preserved for debugging:
- `markets-{uuid}` for event markets requests
- `swap-{uuid}` for swap quote requests  
- `executor-{uuid}` for executor fallback routing metadata
- `error-{uuid}` for error responses
- `{uuid}` (no prefix) for HTTP-level correlation IDs
