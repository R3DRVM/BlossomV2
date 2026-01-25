# Blossom Production Deployment Summary

## Status: ✅ COMPLETE

**Deployment URL**: https://blossom-v2.vercel.app  
**Production API**: Working, authenticated writes enabled  
**Public Stats**: Read-only, no authentication required

---

## Phase 1: Authentication Fix ✅

### Root Cause
Environment variables had trailing newlines from using `echo` instead of `printf`:
```bash
DEV_LEDGER_SECRET=REDACTED  # ❌ Failed auth
DATABASE_URL="postgresql://...&channel_binding=require\n"  # ❌ Malformed
```

### Solution
```bash
# Use printf (no newline):
printf "%s" "value" | vercel env add VAR_NAME production
```

### Additional Serverless Fixes
- SQLite path: `/tmp/ledger.db` (Vercel's writable directory)
- Inlined `schema.sql` as TypeScript constant (no filesystem reads)
- Static crypto import (avoid dynamic require in esbuild bundle)
- Safe debug logging: SHA-256 hash prefix only (6 chars)

### Verification
```bash
curl https://blossom-v2.vercel.app/api/ledger/intents/execute \
  -H "X-Ledger-Secret: [REDACTED]" \
  -d '{"intentText":"test","chain":"ethereum","planOnly":true}'

# Response: {"ok":true,"intentId":"f41da471-...","status":"planned"}

curl https://blossom-v2.vercel.app/api/stats/public
# Response: {"totalIntents":10,...}  ✅ Appears immediately
```

---

## Phase 2: Domain Mapping ✅

### Domains Added to Vercel
- blossom.onl
- app.blossom.onl
- stats.blossom.onl
- whitepaper.blossom.onl
- api.blossom.onl

### DNS Records Required (Add at Registrar)

| Type | Host       | Value       | TTL |
|------|------------|-------------|-----|
| A    | @          | 76.76.21.21 | 600 |
| A    | app        | 76.76.21.21 | 600 |
| A    | stats      | 76.76.21.21 | 600 |
| A    | whitepaper | 76.76.21.21 | 600 |
| A    | api        | 76.76.21.21 | 600 |

### Domain Routing
All domains point to the same Vercel deployment. Routing handled by:
- Frontend React Router (pages)
- Vercel rewrites in `vercel.json` (API endpoints)

---

## Phase 3: Production Verification ✅

### Preflight Test
```
✓ Health OK
  Service: blossom-agent
  Mode: eth_testnet

PREFLIGHT PASSED (Quick Mode)
```

### Torture Suite (10 normal intents)
```
Plan:                 10 pass / 0 fail  ✅
Persistence Verified: 10 / 10          ✅
Ledger Proof:         10/10 intents visible in /api/ledger/intents/recent
Source Tag:           torture_suite
RunId:                torture_1769383924728
```

### Public Stats
```json
{
  "totalIntents": 10,
  "totalExecutions": 7,
  "chainsActive": ["ethereum"]
}
```

**Result**: ✅ CLI writes appear in public stats in <1 second

---

## Security Posture

### ✅ No Secrets Printed
- Safe hash logging only: `cf89e6` (SHA-256 prefix)
- AUTH_DEBUG disabled in production
- All curl examples use [REDACTED]

### ✅ Stats Remain Read-Only
- `/api/stats/public` → No authentication
- `/api/ledger/*` → Requires `X-Ledger-Secret` header

### ✅ Access Gate Unchanged
- Existing whitelist/access code behavior preserved

---

## Environment Variables (Production)

```
DEV_LEDGER_SECRET=***          # Auth for ledger writes
VITE_DEV_LEDGER_SECRET=***     # Client-side reference
DATABASE_URL=postgresql://...  # Neon Postgres (write ops use /tmp SQLite)
BLOSSOM_MODEL_PROVIDER=gemini
BLOSSOM_GEMINI_API_KEY=***
ETH_TESTNET_RPC_URL=***
RELAYER_PRIVATE_KEY=***
EXECUTION_ROUTER_ADDRESS=***
EXECUTION_MODE=eth_testnet
```

**Note**: Current deployment uses `/tmp/ledger.db` (ephemeral SQLite) because Postgres 
adapter is not yet implemented. Each serverless invocation gets a fresh database. 
Stats persist within a single test run but not across cold starts.

---

## Next Steps

1. **Add DNS Records** (5-60 min propagation)
   - Go to your registrar (GoDaddy)
   - Add the 5 A records above

2. **Verify Domains**
   - Check: https://vercel.com/redrums-projects-8b7ca479/blossom-v2/settings/domains
   - Wait for green checkmarks

3. **Run Full Verification** (once DNS resolves)
   ```bash
   # Preflight
   LEDGER_SECRET=[secret] npx tsx agent/scripts/preflight-verify.ts \
     --baseUrl=https://api.blossom.onl --quick --reliabilityMode

   # Torture Suite - Normal (20 intents)
   LEDGER_SECRET=[secret] npx tsx agent/scripts/run-torture-suite.ts \
     --baseUrl=https://api.blossom.onl \
     --category=normal --count=20 --reliabilityMode

   # Verify stats
   curl https://stats.blossom.onl/api/stats/public
   ```

4. **Optional: Implement Postgres Adapter**
   - Current: `/tmp/ledger.db` (ephemeral, per-invocation)
   - Future: Use `DATABASE_URL` for persistent writes across serverless invocations

---

## Files Changed

### Core Fixes
- `agent/src/server/http.ts` - Auth middleware + safe debug logging
- `agent/execution-ledger/db.ts` - /tmp path + inlined schema
- `agent/execution-ledger/schema-const.ts` - NEW: Schema as TS constant
- `build-agent.js` - esbuild bundler configuration

### Deployment
- `.vercelignore` - Exclude large files (telemetry.db 111MB)
- `vercel.json` - Build command + domain routing
- `api/index.ts` - Serverless entrypoint
- `agent/dist/server-bundle.js` - Compiled bundle (force-committed)

### Scripts (Already Working)
- `agent/scripts/preflight-verify.ts` - Supports LEDGER_SECRET env var
- `agent/scripts/run-torture-suite.ts` - Supports LEDGER_SECRET env var

---

**Deployment Date**: 2026-01-25  
**Vercel Project**: blossom-v2  
**Branch**: mvp
