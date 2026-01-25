# Phase 0: Deployment Sanity Check Report

**Date**: 2026-01-25
**Status**: ✅ PASS

---

## Backend Serverless Configuration

### Database Mode Detection
- ✅ `agent/execution-ledger/db.ts` imports `detectDatabaseType()` from db-factory
- ✅ Detects DATABASE_URL environment variable
- ✅ Logs warning when Postgres mode detected
- ✅ Falls back to SQLite for local compatibility

**Code Location**: agent/execution-ledger/db.ts:30
```typescript
const dbType = detectDatabaseType();
logDatabaseInfo();
```

### Serverless Mode
- ✅ `agent/src/server/http.ts` exports Express app before listen()
- ✅ Conditional listen() based on `process.env.VERCEL`
- ✅ When VERCEL=1: app exported, no server listening
- ✅ When VERCEL not set: local server starts on port 3001

**Code Location**: agent/src/server/http.ts:5406-5456
```typescript
export { app };

if (!process.env.VERCEL) {
  app.listen(PORT, HOST, ...);
} else {
  console.log('🌸 Blossom Agent (Vercel serverless mode - app exported, not listening)');
}
```

---

## API Client Configuration

### Frontend → Backend Communication
- ✅ Uses `VITE_AGENT_API_URL` (or VITE_AGENT_BASE_URL as fallback)
- ✅ Defaults to http://127.0.0.1:3001 for local dev
- ✅ All API calls use centralized base URL

**Code Location**: src/lib/apiClient.ts:8
```typescript
export const AGENT_API_BASE_URL =
  import.meta.env.VITE_AGENT_BASE_URL ??
  import.meta.env.VITE_AGENT_API_URL ??
  'http://127.0.0.1:3001';
```

**Production Configuration**:
- Environment variable: `VITE_AGENT_API_URL=https://api.blossom.onl`
- All frontend writes → hosted Postgres via serverless API

---

## Stats Endpoints (Read-Only Verification)

### API Routes Audit
- ✅ `/api/telemetry/devnet-stats` - GET only
- ✅ `/api/debug/routing-stats` - GET only
- ✅ `/api/ledger/stats/summary` - GET only (with checkLedgerSecret)
- ✅ `/api/ledger/stats/recent` - GET only (with checkLedgerSecret)
- ✅ `/api/ledger/stats/intents` - GET only (with checkLedgerSecret)
- ✅ `/api/ledger/positions/stats` - GET only (with checkLedgerSecret)
- ✅ `/api/stats/public` - GET only (public access)

**No mutation routes found** (POST/PUT/PATCH/DELETE for stats)

**Code Locations**: agent/src/server/http.ts:5044-6643

---

## Access Codes Security

### Gitignore Configuration
- ✅ `.gitignore` contains `ACCESS_CODES_LOCAL.md`
- ✅ `.gitignore` contains `ACCESS_CODES_LOCAL.csv`
- ✅ Generated codes will NOT be committed to repo

**Code Location**: .gitignore:48-49

---

## Database Schema

### Access Codes Table
- ✅ `access_codes` table exists in schema-postgres.sql
- ✅ Columns: id, code (UNIQUE), created_at, expires_at, max_uses, times_used, last_used_at, created_by, metadata_json
- ✅ Index on `code` column for fast lookups

**Code Location**: agent/execution-ledger/schema-postgres.sql:181-193

---

## Environment Variables (Production Setup)

### Required Frontend Variables
```
VITE_AGENT_API_URL=https://api.blossom.onl
VITE_ACCESS_GATE_ENABLED=true
VITE_DEV_LEDGER_SECRET=<redacted>
```

### Required Backend Variables
```
DATABASE_URL=postgresql://<redacted>
BLOSSOM_MODEL_PROVIDER=openai
BLOSSOM_OPENAI_API_KEY=<redacted>
BLOSSOM_OPENAI_MODEL=gpt-4o-mini
```

**Security**: DATABASE_URL is ONLY in backend environment (not exposed to frontend)

---

## Verification Summary

| Check | Status | Details |
|-------|--------|---------|
| DATABASE_URL detection | ✅ PASS | Detects Postgres mode correctly |
| Serverless mode | ✅ PASS | VERCEL flag skips listen() |
| API client routing | ✅ PASS | Uses VITE_AGENT_API_URL |
| Stats read-only | ✅ PASS | All stats routes are GET only |
| Access codes gitignore | ✅ PASS | Codes will not be committed |
| Schema has access_codes table | ✅ PASS | Table exists with proper fields |

---

## PHASE 0 STATUS: ✅ PASS

All sanity checks passed. Ready to proceed to Phase 1 (Access Codes Generation).

---

**Next Steps**:
1. Implement access codes generation script (Phase 1)
2. Add RPC reliability infrastructure (Phase 2)
3. Enhance stats with uniqueWallets + adjusted success rate (Phase 3)
4. Run verification scripts (Phase 4)
5. Visual browser checks (Phase 5)
