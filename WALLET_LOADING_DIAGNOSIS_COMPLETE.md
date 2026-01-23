# Wallet Loading Diagnosis & Fix - Complete

**Date:** 2025-01-04  
**Status:** ✅ **FIXED** - Wallet panel no longer gets stuck on "Loading..." with full instrumentation

---

## Root Cause (1-2 Paragraphs)

The wallet panel was stuck in `CONNECTED_LOADING` state because **RightPanel never listened for the `blossom-wallet-balance-success` event** dispatched from BlossomContext. When the balance fetch completed successfully, BlossomContext dispatched the event, but RightPanel had no listener to set `balanceFetchCompleted = true`. This meant the state machine never transitioned from `CONNECTED_LOADING` to `CONNECTED_READY`, leaving the UI stuck on "Loading..." indefinitely. Additionally, there were no timeouts on wallet-init API calls (health, session status, balances), so if any call hung, the wallet would remain in loading state forever. The OneClickExecution component was also rendered in direct mode, potentially making blocking API calls that could delay wallet readiness.

---

## Solution Implemented

### 1. Added Event Listeners with Instrumentation ✅

**File:** `src/components/RightPanel.tsx`

- Added listeners for `blossom-wallet-balance-success` and `blossom-wallet-balance-error`
- Tracks duration, HTTP status, and timestamp for each event
- Logs detailed timing info in dev mode

### 2. Added 3s Timeout Fallback ✅

**File:** `src/components/RightPanel.tsx`

- Timeout triggers after 3s if balance fetch hasn't completed
- Shows error state with actionable fix message
- Prevents infinite loading

### 3. Shortened API Timeouts for Wallet-Init Calls ✅

**File:** `src/lib/apiClient.ts`

- Reduced timeout from 30s to 3s for:
  - `/health`
  - `/api/session/status`
  - `/api/wallet/balances`

### 4. Hide OneClickExecution in Direct Mode ✅

**File:** `src/components/RightPanel.tsx`

- Only renders OneClickExecution when `isSessionMode === true`
- Direct mode doesn't show "Enable one-click execution" prompt

### 5. Added Timeout to Session Status Check ✅

**File:** `src/components/RightPanel.tsx`

- 3s timeout using AbortController
- Non-blocking (doesn't prevent wallet READY)
- Tracks timing and status

### 6. Enhanced Debug Panel with Full Instrumentation ✅

**File:** `src/components/RightPanel.tsx`

- Shows API call timings (health, session, balances)
- Displays HTTP status, duration (ms), and timestamp for each call
- Shows which "gate" is blocking READY state
- Dev-only (behind `import.meta.env.DEV`)

### 7. Instrumented BlossomContext Balance Fetch ✅

**File:** `src/context/BlossomContext.tsx`

- Tracks fetch start time
- Dispatches duration and status in success/error events
- Enables RightPanel to show accurate timing

---

## Files Changed

| File | Changes |
|------|---------|
| `src/components/RightPanel.tsx` | Added event listeners with timing, timeout fallback, enhanced debug panel, hide OneClickExecution in direct mode, instrumented session check |
| `src/lib/apiClient.ts` | Reduced timeout to 3s for wallet-init API calls |
| `src/context/BlossomContext.tsx` | Added timing instrumentation to balance fetch events |

---

## Exact Commands to Verify

### 1. Start Demo

```bash
./scripts/restart-demo.sh
```

### 2. Open App

```
http://127.0.0.1:5173/app
```

### 3. Connect Wallet & Check Debug Panel

1. Click "Connect Wallet (Sepolia)"
2. Wallet should reach `CONNECTED_READY` within 3 seconds
3. Scroll down in wallet card
4. Click "Debug Details" to expand
5. Verify:
   - `State: CONNECTED_READY`
   - `Balance Fetch: ✅`
   - `Chain ID: 11155111 ✅`
   - `Backend Healthy: ✅`
   - **API Call Timings section shows:**
     - `Health: 200 in 45ms ✅ (timestamp)`
     - `Balances: 200 in 67ms ✅ (timestamp)`
     - (Session only shown if in session mode)

### 4. Test Timeout

```bash
# Stop backend
lsof -ti :3001 | xargs kill -9

# Connect wallet in UI
# Should show error after 3s: "Balance fetch timed out after 3 seconds"
# Debug panel should show:
#   Health: 0 in 3000ms ❌ (timeout)
#   Balances: 0 in 3000ms ❌ (timeout)
```

### 5. Test Direct Mode

- Verify `EXECUTION_AUTH_MODE=direct` in `.env.local`
- Connect wallet
- Should NOT show "Enable one-click execution" prompt
- Should reach READY without waiting for session
- Debug panel should show `Frontend Auth: direct`

### 6. Test Network Switching

- Connect wallet on Sepolia → Should reach READY
- Switch to different network → Should show "Wrong Network" immediately
- Switch back to Sepolia → Should return to READY
- No infinite spinners

### 7. Run Wallet Readiness Check

```bash
./scripts/ui-wallet-check.sh
```

Expected output:
```
==========================================
UI Wallet Readiness Check
==========================================

Test 1: Health check (must return < 3s)
✅ PASS (45ms)

Test 2: Session status (must return < 3s)
✅ PASS (52ms)

Test 3: Wallet balances (must return < 3s)
✅ PASS (67ms)

==========================================
Results: All wallet endpoints respond quickly
==========================================

✅ Wallet readiness check passed!
   All endpoints return within 3s timeout
```

---

## Debug Panel Location

**In the UI:**
1. Open `http://127.0.0.1:5173/app`
2. Connect wallet (if not already connected)
3. Scroll down in the **Wallet card** (right panel)
4. Look for **"Debug Details"** button (dev mode only)
5. Click to expand and see:
   - Current wallet state
   - Last state transition
   - Balance fetch status
   - Chain ID
   - Backend execution mode
   - Frontend auth mode
   - Backend health status
   - API base URL
   - **API Call Timings** (health, session, balances with duration, status, timestamp)
   - Error details (if any)

---

## Expected Behavior After Fix

1. **Connect Wallet:**
   - State: `DISCONNECTED` → `CONNECTING` → `CONNECTED_LOADING` → `CONNECTED_READY`
   - Total time: < 3 seconds
   - No infinite loading
   - Debug panel shows all API call timings

2. **Direct Mode:**
   - No "Enable one-click execution" prompt
   - No session status check blocking
   - Wallet reaches READY immediately after balance fetch
   - Debug panel shows `Frontend Auth: direct`

3. **Error Handling:**
   - If backend offline: Shows `BACKEND_OFFLINE` immediately
   - If balance fetch fails: Shows error after 3s with retry button
   - If timeout: Shows "Balance fetch timed out" with fix command
   - Debug panel shows failed API call with duration and status

4. **Network Switching:**
   - Switch away from Sepolia → Shows "Wrong Network" immediately
   - Switch back to Sepolia → Returns to READY
   - No infinite spinners

---

## Summary

✅ **Wallet panel no longer gets stuck on "Loading..."**  
✅ **3s timeout prevents infinite loading**  
✅ **Direct mode doesn't block on session**  
✅ **OneClickExecution hidden in direct mode**  
✅ **Full instrumentation with API call timings**  
✅ **Dev debug panel shows state transitions and timing**  
✅ **All wallet-init API calls have 3s timeout**

**Status:** Wallet connection is now bulletproof and reaches READY or shows error within 3 seconds, with full instrumentation for debugging.


