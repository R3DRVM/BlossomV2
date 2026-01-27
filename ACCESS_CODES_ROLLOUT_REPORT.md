# Access Codes Rollout Report
**Date:** 2026-01-27
**Target Deployment:** d9ec4af (live at api.blossom.onl)
**Status:** ⚠️ **BLOCKED - Database Mismatch**

---

## Executive Summary

Generated 50 production access codes and successfully inserted them into Neon Postgres database `25239fc4374e810e`. However, **live verification failed** due to database mismatch between the DATABASE_URL pulled from Vercel and the database actually used by the live API at `api.blossom.onl`.

**Result:** Cannot guarantee codes will work until database mismatch is resolved.

---

## PHASE 1: Endpoint Verification ✅

**Live Domain:** `api.blossom.onl`
**Build SHA:** `d9ec4af` (confirmed via `x-build-sha` header)

| Endpoint | Status | Response |
|----------|--------|----------|
| `GET /api/access/status` | ✅ 200 OK | `{"ok":true,"authorized":false}` |
| `POST /api/access/verify` | ✅ 200 OK | Returns proper error for invalid codes |
| `POST /api/waitlist/join` | ✅ 200 OK | `{"ok":true,"message":"Successfully joined waitlist"}` |

**Conclusion:** All access gate endpoints operational on `api.blossom.onl`

---

## PHASE 2: Code Generation ✅

**Database Identity Hash:** `25239fc4374e810e`
**Label:** `beta_mvp_live_d9ec4af_20260127_v1`
**Count:** 50 codes
**Format:** `BLOSSOM-{16_UPPERCASE_HEX}`
**Status:** All inserted successfully into production Postgres

### Configuration
```
max_uses: 1
times_used: 0
expires_at: NULL (never expires)
created_by: system
metadata_json: {"label":"beta_mvp_live_d9ec4af_20260127_v1"}
```

### Sample Codes (Masked)
```
BLOSSOM-636A...0385
BLOSSOM-51F4...C555
BLOSSOM-C501...B258
BLOSSOM-946D...3374
BLOSSOM-1565...0808
... and 45 more
```

**Full codes exported to:** `ACCESS_CODES_LOCAL.md` (gitignored)

**Query to list unused codes:**
```sql
SELECT code FROM access_codes
WHERE metadata_json::json->>'label' = 'beta_mvp_live_d9ec4af_20260127_v1'
  AND times_used < max_uses
ORDER BY created_at DESC;
```

---

## PHASE 3: Live Verification ❌ FAILED

### Test 1: Access Code Validation

**Test Code (Masked):** `BLOSSOM-636A...0385`

**Request:**
```bash
curl -X POST https://api.blossom.onl/api/access/verify \
  -H "Content-Type: application/json" \
  -d '{"code":"BLOSSOM-636A1...0385"}'
```

**Response:**
```json
{"ok":false,"authorized":false,"error":"Invalid access code"}
```

**Database Verification:**
```
✅ Code found in database:
   Code: BLOSSOM-636A...0385
   times_used: 0
   max_uses: 1
   expires_at: never
```

**Analysis:** Code exists in database but API returns "Invalid access code" → **Database mismatch**

### Test 2: Waitlist Database Sync

**Test Email:** `test_1769487053@example.com`

**API Response:**
```json
{"ok":true,"message":"Successfully joined waitlist"}
```

**Database Query:**
```sql
SELECT email FROM waitlist WHERE email = 'test_1769487053@example.com';
```

**Result:** ❌ Email NOT found in database

**Analysis:** API accepts waitlist entry but entry does NOT appear in queried database → **Database mismatch confirmed**

---

## Root Cause Analysis

### Problem: Database Mismatch

The live API at `api.blossom.onl` is **NOT connected to the same Postgres database** as the DATABASE_URL environment variable pulled from Vercel production environment.

### Evidence:

1. **Access Code Test:**
   - Code inserted into database `25239fc4374e810e`
   - Code query succeeds: `times_used=0, max_uses=1`
   - API verification fails: `"Invalid access code"`
   - **Conclusion:** API queries different database

2. **Waitlist Sync Test:**
   - API accepts waitlist submission: `200 OK`
   - Database query returns 0 rows
   - **Conclusion:** API writes to different database

### Possible Causes:

1. **Multiple DATABASE_URL configurations**
   - Preview vs Production environment mismatch
   - Different DATABASE_URL for different deployment contexts

2. **Stale deployment**
   - Live API might be from older deployment with different DATABASE_URL
   - Build SHA is correct (d9ec4af) but environment variables might differ

3. **In-Memory Mode Fallback**
   - API might have failed to connect to Postgres during initialization
   - Fell back to in-memory mode (no persistent storage)
   - Codes stored in volatile memory, not database

4. **Database Connection String Mismatch**
   - DATABASE_URL might point to different Neon project/branch
   - Connection pooling or proxy configuration issue

---

## Recommendations

### Immediate Actions

1. **Verify Live API Database Connection**
   ```bash
   # Add temporary debug endpoint to show DB identity hash
   GET /api/access/debug-db-identity
   # Should return: {"dbHash":"25239fc4374e810e"}
   ```

2. **Check Vercel Environment Variables**
   - Verify DATABASE_URL is set for production deployment
   - Check if preview/development environments have different values
   - Confirm no typos or whitespace in DATABASE_URL

3. **Review API Logs**
   ```bash
   vercel logs api.blossom.onl --prod
   ```
   Look for:
   - `[accessGate] Initialized with Postgres backend` (✅ good)
   - `[accessGate] Postgres unavailable, using in-memory mode` (❌ problem)
   - Database connection errors

4. **Test with Known Working Code**
   - If any codes have worked before, check their label/batch
   - Query database for codes with `times_used > 0`
   - Compare database identity hash

### Verification Steps

Once database mismatch is resolved:

1. Pick one unused code from database
2. Test with:
   ```bash
   curl -X POST https://api.blossom.onl/api/access/verify \
     -H "Content-Type: application/json" \
     -d '{"code":"BLOSSOM-XXXX..."}'
   ```
3. Verify `Set-Cookie: blossom_gate_pass=...` header
4. Test status endpoint:
   ```bash
   curl https://api.blossom.onl/api/access/status \
     -b cookies.txt
   # Should return: {"ok":true,"authorized":true}
   ```

---

## Deliverables

### ✅ Completed

- ✅ Verified live API endpoints (all operational)
- ✅ Generated 50 production access codes
- ✅ Inserted codes into Neon Postgres database `25239fc4374e810e`
- ✅ Exported full codes to `ACCESS_CODES_LOCAL.md` (gitignored)
- ✅ Created diagnostic scripts:
  - `agent/scripts/generate-production-codes.ts`
  - `agent/scripts/export-recent-codes.ts`

### ❌ Blocked

- ❌ Live verification with production API (database mismatch)
- ❌ Proof of "guaranteed working" codes (cannot verify until DB matched)

---

## Database Identity Comparison

| Component | Database Hash | Status |
|-----------|---------------|--------|
| Local Query (DATABASE_URL) | `25239fc4374e810e` | ✅ Connected |
| Code Insert Script | `25239fc4374e810e` | ✅ Success |
| Waitlist Verification | `25239fc4374e810e` | ✅ Query works |
| Live API (api.blossom.onl) | `unknown` | ❌ Different DB |

---

## Next Steps

1. **Diagnose Database Mismatch**
   - Add debug endpoint to return DB identity hash from live API
   - Compare with `25239fc4374e810e`
   - Identify correct DATABASE_URL for live deployment

2. **Option A: Use Correct Database**
   - If live API uses different DATABASE_URL
   - Re-run code generation with correct DATABASE_URL
   - Generate new batch into correct database

3. **Option B: Fix Live API Connection**
   - If live API should use `25239fc4374e810e`
   - Verify DATABASE_URL environment variable in Vercel
   - Redeploy if needed to pick up correct DATABASE_URL
   - Test existing 50 codes (should work after fix)

---

## Files Generated

- `ACCESS_CODES_LOCAL.md` - 50 full access codes (gitignored)
- `agent/scripts/generate-production-codes.ts` - Code generation script
- `agent/scripts/export-recent-codes.ts` - Code export script
- `ACCESS_CODES_ROLLOUT_REPORT.md` - This report (safe to commit)

---

## Security Notes

- ✅ Full codes NEVER printed to console
- ✅ Console output shows only masked codes (`BLOSSOM-ABCD...789A`)
- ✅ Full codes exported ONLY to gitignored file
- ✅ All database queries use parameterized statements (SQL injection safe)
- ✅ No DATABASE_URL or credentials exposed in logs

---

**Report Generated:** 2026-01-27
**Author:** Claude Code (Release Engineer)
**Status:** Awaiting database mismatch resolution
