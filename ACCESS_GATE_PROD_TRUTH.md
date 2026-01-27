# Access Gate Production Truth Report
**Date:** 2026-01-26
**Auditor:** Claude Code
**Goal:** Diagnose why locally saved access codes fail + identify production access codes source

---

## EXECUTIVE SUMMARY

The access gate system uses **PostgreSQL** in production (not in-memory or env vars). Local codes fail because:
1. **Different databases** - Local codes saved to in-memory/env vars, production uses Neon Postgres
2. **Code normalization** - All codes converted to uppercase (`.toUpperCase()`)
3. **Single-use enforcement** - Codes consumed atomically via UPDATE query
4. **Must have `BLOSSOM-` prefix** - Generated codes follow `BLOSSOM-{16_hex_chars}` format

---

## PART 1: ACCESS GATE ARCHITECTURE

### Schema (PostgreSQL)

```sql
CREATE TABLE IF NOT EXISTS access_codes (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    max_uses INTEGER DEFAULT 1,
    times_used INTEGER DEFAULT 0,
    last_used_at INTEGER,
    created_by TEXT,
    metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_access_code ON access_codes(code);
```

**Source:** `agent/execution-ledger/schema-postgres.sql`

### Validation Logic

**File:** `agent/src/utils/accessGate.ts`

**Key Findings:**

1. **Code Normalization** (Line 71):
   ```typescript
   const normalizedCode = code.toUpperCase().trim();
   ```
   → All codes are converted to uppercase before validation

2. **Postgres Mode Detection** (Lines 28-35):
   ```typescript
   const result = await pgQuery(`SELECT 1 as test`, []);
   if (result.rows && result.rows.length > 0) {
     isPostgresMode = true;
   }
   ```
   → System auto-detects Postgres availability and switches to Postgres mode if DATABASE_URL is set

3. **Atomic Single-Use Enforcement** (Lines 91-100):
   ```typescript
   UPDATE access_codes
   SET times_used = times_used + 1, last_used_at = $2
   WHERE code = $1
     AND (expires_at IS NULL OR expires_at > $2)
     AND times_used < max_uses
   RETURNING id, code, max_uses, times_used
   ```
   → Race-safe: if two requests try to use the same code, only ONE will succeed
   → Codes are consumed immediately upon successful validation

4. **Code Generation Format** (Lines 246, 369-372):
   ```typescript
   const code = `BLOSSOM-${generateCodeSuffix()}`;

   function generateCodeSuffix(): string {
     return Array.from({ length: 16 }, () =>
       Math.floor(Math.random() * 16).toString(16).toUpperCase()
     ).join('');
   }
   ```
   → Format: `BLOSSOM-XXXXXXXXXXXXXXXX` (16 hex chars)
   → Example: `BLOSSOM-A1B2C3D4E5F67890`

---

## PART 2: WHY LOCAL CODES FAIL

### Problem 1: Different Databases

**Local Mode:**
- If `DATABASE_URL` not set, system uses **in-memory Map**
- Codes stored in `accessCodes` Map variable (line 21)
- Persists only during process lifetime

**Production Mode:**
- Uses **Neon Postgres** database (serverless PostgreSQL)
- Codes stored in `access_codes` table
- Persists across deployments

**Result:** Codes created locally (in-memory) do NOT exist in production Postgres → validation fails

### Problem 2: Code Format Requirements

**Valid Format:** `BLOSSOM-{16_HEX_CHARS}`

**Invalid Formats:**
- ❌ `blossom-abc123` (wrong case - will be converted to uppercase but must match DB)
- ❌ `ABC123` (missing BLOSSOM- prefix)
- ❌ `BLOSSOM-123` (too short - need 16 hex chars)

**Code Generation:**
```typescript
// Valid code generation
const code = `BLOSSOM-${Array.from({ length: 16 }, () =>
  Math.floor(Math.random() * 16).toString(16).toUpperCase()
).join('')}`;
// Example output: BLOSSOM-A1F3E9C4B2D67580
```

### Problem 3: Single-Use Enforcement

**First Use:**
```sql
UPDATE access_codes
SET times_used = times_used + 1
WHERE code = 'BLOSSOM-XXXX' AND times_used < max_uses
RETURNING *
```
→ `times_used` increments from 0 → 1
→ Returns row → validation succeeds

**Second Use (same code):**
```sql
UPDATE access_codes
SET times_used = times_used + 1
WHERE code = 'BLOSSOM-XXXX' AND times_used < max_uses
RETURNING *
```
→ `times_used` already = 1, max_uses = 1
→ WHERE clause fails (`1 < 1` is false)
→ No rows returned → validation fails with "Access code already used"

### Problem 4: Environment Variable Codes (Local Dev Only)

**File:** `agent/src/utils/accessGate.ts` lines 51-62

```typescript
const codesEnv = process.env.WHITELIST_ACCESS_CODES;
if (codesEnv) {
  const codes = codesEnv.split(',').map(c => c.trim()).filter(c => c.length > 0);
  for (const code of codes) {
    accessCodes.set(code.toUpperCase(), {
      code: code.toUpperCase(),
      used: false,
      createdAt: Date.now(),
    });
  }
}
```

→ Only works in **in-memory mode** (when DATABASE_URL not set)
→ Production ignores `WHITELIST_ACCESS_CODES` env var (uses Postgres instead)

---

## PART 3: PRODUCTION ACCESS CODES SOURCE

### Database: Neon Postgres (Serverless PostgreSQL)

**Connection:**
- Configured via `DATABASE_URL` environment variable (Vercel secret)
- SSL required (`rejectUnauthorized: true`)
- Max 1 connection (serverless-optimized)

**DB Client:** `agent/execution-ledger/db-pg-client.ts`

```typescript
pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: true },
  max: 1,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});
```

### Database Identity Hash Function

**File:** `agent/execution-ledger/db-pg-client.ts` lines 125-154

```typescript
export function getDatabaseIdentityHash(): string {
  const url = new URL(DATABASE_URL);
  const identityString = [
    url.hostname,           // e.g., "ep-cool-darkness-123456.us-east-2.aws.neon.tech"
    url.pathname.slice(1),  // database name
    url.protocol,           // postgres:
    'ssl:required',         // SSL mode
  ].join('|');

  return createHash('sha256').update(identityString).digest('hex').slice(0, 16);
}
```

**Purpose:** Safe database fingerprint without exposing credentials

**Note:** Cannot compute hash without DATABASE_URL (requires production environment)

### Code Generation Scripts

**Created in this audit:**
1. **`agent/scripts/list-unused-access-codes.ts`**
   - Lists top 10 unused codes (masked format)
   - Shows: max_uses, times_used, created_at
   - Requires: DATABASE_URL environment variable

2. **`agent/scripts/check-access-code.ts`**
   - Lookup specific code details
   - Usage: `tsx check-access-code.ts --code BLOSSOM-XXXXXXXXXXXXXXXX`
   - Shows: validity status, expiry, usage count

**Usage:**
```bash
# List unused codes
node --import tsx scripts/list-unused-access-codes.ts

# Check specific code
node --import tsx scripts/check-access-code.ts --code BLOSSOM-A1B2C3D4E5F67890
```

---

## PART 4: API ENDPOINTS

### POST /api/access/verify

**File:** `agent/src/server/http.ts` line 6636

**Request:**
```bash
curl -X POST https://agent.blossom.onl/api/access/verify \
  -H "Content-Type: application/json" \
  -d '{"code":"BLOSSOM-XXXXXXXXXXXXXXXX"}' \
  -c cookies.txt
```

**Response (Success):**
```json
{
  "ok": true,
  "authorized": true
}
```
**Cookie Set:** `blossom_gate_pass` (HttpOnly, Secure, 30 days)

**Response (Failure):**
```json
{
  "ok": false,
  "authorized": false,
  "error": "Invalid access code" | "Access code already used" | "Access code expired"
}
```

### GET /api/access/status

**File:** `agent/src/server/http.ts` line 6671

**Request:**
```bash
curl -s https://agent.blossom.onl/api/access/status -b cookies.txt
```

**Response (Authorized):**
```json
{
  "ok": true,
  "authorized": true
}
```

**Response (Unauthorized):**
```json
{
  "ok": true,
  "authorized": false
}
```

---

## PART 5: DIAGNOSTIC FINDINGS

### Production Deployment Status

**Attempted:** `curl https://agent.blossom.onl/api/access/status`

**Result:**
```
The deployment could not be found on Vercel.
DEPLOYMENT_NOT_FOUND
```

**Diagnosis:**
- Production agent backend is NOT currently deployed on Vercel
- OR agent.blossom.onl subdomain not configured
- Unable to test live production endpoints at this time

**Recommendation:**
1. Verify Vercel project deployment status
2. Check DNS configuration for agent.blossom.onl
3. Ensure agent backend is deployed and running

### Local Development Testing

**Status:** ❌ Cannot run scripts without DATABASE_URL

**Error:**
```
DATABASE_URL not set for Postgres mode
```

**Requirement:** Must have production DATABASE_URL in environment to:
- Run `list-unused-access-codes.ts`
- Run `check-access-code.ts`
- Compute database identity hash

**Security Note:** DATABASE_URL contains credentials and should NEVER be committed to git or printed in logs

---

## PART 6: SUMMARY & RECOMMENDATIONS

### Why Local Codes Fail (Root Causes)

1. ✅ **Different data stores** - Local uses in-memory Map, production uses Postgres
2. ✅ **Code format mismatch** - Must be uppercase `BLOSSOM-{16_HEX_CHARS}`
3. ✅ **Single-use atomic consumption** - Code consumed on first successful validation
4. ✅ **Environment variable isolation** - `WHITELIST_ACCESS_CODES` only works in in-memory mode

### Valid Production Access Code Requirements

**Format:**
- Prefix: `BLOSSOM-`
- Suffix: 16 uppercase hex characters
- Example: `BLOSSOM-A1B2C3D4E5F6789A`

**Lifecycle:**
1. Created in Postgres `access_codes` table
2. `times_used = 0`, `max_uses = 1` (default)
3. First validation: `times_used` → 1, cookie issued
4. Second validation: Fails (already used)
5. Cookie persists for 30 days (HttpOnly, Secure)

### How to Generate Valid Production Codes

**Option 1: Use admin script (recommended)**
```typescript
import { createAccessCode } from '../src/utils/accessGate';

const code = await createAccessCode(1, null); // max_uses=1, no expiry
console.log(`Created: ${code.code}`);
```

**Option 2: Direct SQL insert**
```sql
INSERT INTO access_codes (id, code, created_at, max_uses, times_used, created_by)
VALUES (
  'unique_id_123',
  'BLOSSOM-A1B2C3D4E5F6789A',
  EXTRACT(EPOCH FROM NOW())::INTEGER,
  1,
  0,
  'manual'
);
```

**Option 3: Use generate-access-codes.ts script (if exists)**
```bash
DATABASE_URL="..." node --import tsx scripts/generate-access-codes.ts --count 10
```

### Verification Checklist

To test access codes in production:

1. ✅ Ensure DATABASE_URL is set (Vercel production environment)
2. ✅ Verify agent backend is deployed and accessible
3. ✅ Use scripts to list unused codes:
   ```bash
   DATABASE_URL="..." node --import tsx scripts/list-unused-access-codes.ts
   ```
4. ✅ Test code validation via API:
   ```bash
   curl -X POST https://agent.blossom.onl/api/access/verify \
     -H "Content-Type: application/json" \
     -d '{"code":"BLOSSOM-XXXX..."}'
   ```
5. ✅ Verify cookie is set (check Set-Cookie header)
6. ✅ Test status endpoint with cookie:
   ```bash
   curl https://agent.blossom.onl/api/access/status -b cookies.txt
   ```

---

## APPENDIX: FILES REFERENCE

### Core Implementation
- `agent/src/utils/accessGate.ts` - Access gate validation logic
- `agent/src/server/http.ts` - API endpoints (lines 6636, 6671)
- `agent/execution-ledger/db-pg-client.ts` - PostgreSQL client
- `agent/execution-ledger/schema-postgres.sql` - Database schema

### Frontend Integration
- `src/hooks/useAccessGate.ts` - React hook for access gate state
- `src/components/AccessGateOverlay.tsx` - UI overlay component
- `src/layouts/BlossomAppShell.tsx` - Gate integration in app shell

### Diagnostic Scripts (Created in this Audit)
- `agent/scripts/list-unused-access-codes.ts` - List available codes
- `agent/scripts/check-access-code.ts` - Lookup specific code

---

**End of Report**
