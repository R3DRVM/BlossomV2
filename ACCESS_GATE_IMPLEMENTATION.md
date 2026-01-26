# Early Beta Access Gate Implementation

## Overview

Implemented a production-ready Early Beta Access Gate that appears when users open app.blossom.onl. The app UI is visible but blurred behind an overlay until the user is authorized via access code or joins the waitlist.

## Files Changed

### Frontend

1. **`src/components/AccessGateOverlay.tsx`** (NEW - 368 lines)
   - Full overlay component with blur backdrop
   - Waitlist form (email + optional telegram/twitter handles)
   - Collapsible access code input section (collapsed by default)
   - Success/error states for both flows
   - Fade-out animation when access granted
   - Links to stats, whitepaper, and home page

2. **`src/hooks/useAccessGate.ts`** (NEW - 56 lines)
   - Authorization state management hook
   - Checks `/api/access/status` on mount to verify gate pass cookie
   - Auto-authorize in dev mode if `VITE_ACCESS_GATE_ENABLED !== 'true'`
   - Fail-closed: shows gate if authorization check fails
   - Provides `grantAccess()` callback to trigger recheck

3. **`src/layouts/BlossomAppShell.tsx`** (MODIFIED)
   - Replaced old `AccessGate` component with new `AccessGateOverlay`
   - Uses `useAccessGate()` hook for authorization state
   - Conditionally renders overlay when `!isLoading && !isAuthorized`
   - App UI always renders (visible behind blur overlay)

### Backend

4. **`agent/src/server/http.ts`** (MODIFIED)
   - **Added** `import cookieParser from 'cookie-parser'`
   - **Added** `app.use(cookieParser())` middleware
   - **Updated** `POST /api/access/validate` → `POST /api/access/verify`
     - Now async (awaits `validateAccessCode()`)
     - Issues HTTP-only secure cookie `blossom_gate_pass` on success
     - Returns `{ ok: true, authorized: true }` or error
   - **Added** `GET /api/access/status`
     - Checks for `blossom_gate_pass` cookie
     - Returns `{ ok: true, authorized: boolean }`
     - Auto-authorize if `ACCESS_GATE_ENABLED !== 'true'`
   - **Updated** `POST /api/waitlist/join`
     - Now accepts `telegramHandle` and `twitterHandle` fields
     - Stores handles in `metadata` object in database

5. **`agent/src/utils/accessGate.ts`** (ALREADY UPDATED IN PREVIOUS SESSION)
   - Postgres-backed access code validation
   - Atomic single-use enforcement via `UPDATE ... WHERE times_used < max_uses`
   - Masked logging (codes/wallets never logged in full)

6. **`agent/package.json`** (MODIFIED)
   - Added `cookie-parser` and `@types/cookie-parser` dependencies

## API Endpoints

### POST /api/access/verify
Verify an access code and issue gate pass cookie.

**Request:**
```json
{
  "code": "BLOSSOM-XXXXXXXX"
}
```

**Response (Success):**
```json
{
  "ok": true,
  "authorized": true
}
```
- Sets HTTP-only cookie: `blossom_gate_pass=<token>`
- Cookie expires in 30 days

**Response (Error):**
```json
{
  "ok": false,
  "authorized": false,
  "error": "Invalid access code"
}
```

### GET /api/access/status
Check if user has valid gate pass cookie.

**Response (Authorized):**
```json
{
  "ok": true,
  "authorized": true
}
```

**Response (Not Authorized):**
```json
{
  "ok": true,
  "authorized": false
}
```

### POST /api/waitlist/join
Add email to waitlist with optional social handles.

**Request:**
```json
{
  "email": "user@example.com",
  "telegramHandle": "@username",
  "twitterHandle": "@username",
  "source": "app_gate"
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Successfully joined waitlist"
}
```

## Testing

### Test 1: Invalid Access Code
```bash
curl -X POST https://agent.blossom.onl/api/access/verify \
  -H "Content-Type: application/json" \
  -d '{"code":"INVALID-CODE"}' \
  -c cookies.txt
```

**Expected:** `{ "ok": false, "authorized": false, "error": "Invalid access code" }`

### Test 2: Valid Access Code
```bash
# Replace with a real unused code from the database
curl -X POST https://agent.blossom.onl/api/access/verify \
  -H "Content-Type: application/json" \
  -d '{"code":"BLOSSOM-XXXXXXXXXXXXXXXX"}' \
  -c cookies.txt -v
```

**Expected:**
- Response: `{ "ok": true, "authorized": true }`
- Cookie set: `Set-Cookie: blossom_gate_pass=...`

### Test 3: Reuse Same Code (Should Fail)
```bash
# Use the same code from Test 2
curl -X POST https://agent.blossom.onl/api/access/verify \
  -H "Content-Type: application/json" \
  -d '{"code":"BLOSSOM-XXXXXXXXXXXXXXXX"}' \
  -c cookies.txt
```

**Expected:** `{ "ok": false, "authorized": false, "error": "Access code already used" }`

### Test 4: Check Authorization Status (With Cookie)
```bash
curl -X GET https://agent.blossom.onl/api/access/status \
  -b cookies.txt
```

**Expected:** `{ "ok": true, "authorized": true }`

### Test 5: Check Authorization Status (Without Cookie)
```bash
curl -X GET https://agent.blossom.onl/api/access/status
```

**Expected:** `{ "ok": true, "authorized": false }`

### Test 6: Join Waitlist
```bash
curl -X POST https://agent.blossom.onl/api/waitlist/join \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "telegramHandle": "@testuser",
    "twitterHandle": "@testuser",
    "source": "app_gate"
  }'
```

**Expected:** `{ "ok": true, "message": "Successfully joined waitlist" }`

## Manual Browser Testing

### Test Flow 1: Access Code Path
1. Open https://app.blossom.onl (in incognito/private window)
2. Access gate overlay should appear immediately
3. Real app UI should be visible but blurred behind overlay
4. Click "I have an access code" to expand the access code section
5. Enter a valid access code (get one from admin)
6. Click "Unlock Access"
7. Gate should fade out and app should be accessible
8. Refresh page → Gate should NOT reappear (cookie persists)
9. Open DevTools Console → Should see zero errors

### Test Flow 2: Waitlist Path
1. Open https://app.blossom.onl (in incognito/private window)
2. Access gate overlay should appear
3. Enter email address
4. (Optional) Enter telegram and twitter handles
5. Click "Join Waitlist"
6. Success message should appear: "You're on the list!"
7. Gate should remain locked (joining waitlist doesn't grant access)
8. App should remain blurred behind overlay

### Test Flow 3: Invalid Code
1. Open https://app.blossom.onl (in incognito/private window)
2. Click "I have an access code"
3. Enter an invalid code (e.g., "INVALID-CODE")
4. Click "Unlock Access"
5. Error message should appear: "Invalid access code"
6. Gate should remain locked

## Database Verification

### Check Access Code Status
```bash
cd /Users/redrum/Desktop/Bloom/agent
DATABASE_URL=<production-db-url> npx tsx scripts/query-access-codes.ts
```

**Output:**
- Total codes: 85
- Available: X codes
- Used: Y codes
- List of codes with status

### Look Up Specific Code
```bash
DATABASE_URL=<production-db-url> npx tsx scripts/query-access-codes.ts BLOSSOM-XXXXXXXX
```

**Output:**
- Code details: status, max uses, times used, created at, last used at

### Check Waitlist Entries
```sql
-- Run against production database
SELECT * FROM waitlist
WHERE source = 'app_gate'
ORDER BY created_at DESC
LIMIT 10;
```

## Security Features

1. **HTTP-Only Cookies**: Gate pass stored in HTTP-only cookie (not accessible via JavaScript)
2. **Secure Flag**: Cookie has `secure` flag in production (HTTPS only)
3. **Single-Use Codes**: Atomic database transaction prevents race conditions
4. **Fail-Closed**: If authorization check fails, gate is shown
5. **Masked Logging**: Codes and wallets never logged in full (e.g., `BLOS...8EE`)
6. **No Secrets in Client Logs**: All validation happens server-side

## Development Mode

To disable the access gate in development:

```bash
# In .env.local
VITE_ACCESS_GATE_ENABLED=false
```

This will auto-authorize all users without showing the gate.

## Production Deployment

1. Ensure `ACCESS_GATE_ENABLED=true` in agent environment
2. Ensure Postgres database is connected (for access codes and waitlist)
3. Deploy frontend to app.blossom.onl
4. Deploy agent backend to agent.blossom.onl
5. Test all flows using curl commands above
6. Verify zero console errors in browser DevTools

## Environment Variables

### Frontend
- `VITE_ACCESS_GATE_ENABLED` - Set to "true" to enable gate (default: auto-detect in prod)
- `VITE_AGENT_API_BASE_URL` - Agent API base URL (default: https://agent.blossom.onl)

### Backend
- `ACCESS_GATE_ENABLED` - Set to "true" to enable access code validation
- `DATABASE_URL` - Postgres connection string (for access codes and waitlist)
- `NODE_ENV` - Set to "production" for secure cookies

## Known Issues / Notes

1. The old `AccessGate` component (`src/components/AccessGate.tsx`) is no longer used and can be removed
2. Cookie fallback to localStorage is not implemented (cookies are required)
3. Waitlist entries are stored in the main execution ledger database (not a separate DB)

## Next Steps

1. Generate beta access codes for initial testers
2. Monitor access gate logs for invalid code attempts
3. Export waitlist entries for email campaign
4. Consider adding rate limiting to prevent code brute-forcing
