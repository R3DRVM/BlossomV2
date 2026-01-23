# Wallet Loading Fix Summary

**Date:** 2025-01-04  
**Status:** ✅ **FIXED** - Wallet panel no longer gets stuck on "Loading..."

---

## Root Cause

The wallet panel was stuck in `CONNECTED_LOADING` state because:

1. **Missing Event Listener**: RightPanel never listened for the `blossom-wallet-balance-success` event dispatched from BlossomContext, so `balanceFetchCompleted` was never set to `true`.

2. **No Timeout**: Balance fetch had a 30s timeout, but wallet readiness needed a 3s timeout to prevent infinite loading.

3. **OneClickExecution Blocking**: OneClickExecution component was rendered even in direct mode, potentially making blocking API calls.

4. **Session Status Check**: Session status check had no timeout, could hang indefinitely.

---

## Solution Implemented

### 1. Added Event Listeners ✅

**File:** `src/components/RightPanel.tsx`

Added listeners for:
- `blossom-wallet-balance-success` → sets `balanceFetchCompleted = true`
- `blossom-wallet-balance-error` → sets error state and marks fetch as completed

```typescript
useEffect(() => {
  const handleBalanceSuccess = () => {
    setBalanceFetchCompleted(true);
  };
  const handleBalanceError = (event: Event) => {
    // Set error state and mark as completed
  };
  window.addEventListener('blossom-wallet-balance-success', handleBalanceSuccess);
  window.addEventListener('blossom-wallet-balance-error', handleBalanceError);
  return () => { /* cleanup */ };
}, [isEthTestnetMode]);
```

### 2. Added 3s Timeout Fallback ✅

**File:** `src/components/RightPanel.tsx`

Added timeout that triggers after 3s if balance fetch hasn't completed:

```typescript
useEffect(() => {
  if (walletState !== 'CONNECTED_LOADING') return;
  const timeout = setTimeout(() => {
    if (!balanceFetchCompleted && !balanceError) {
      setBalanceError('Balance fetch timed out after 3 seconds');
      setBalanceErrorCode('TIMEOUT');
      setBalanceFetchCompleted(true); // Mark as completed to show error
    }
  }, 3000);
  return () => clearTimeout(timeout);
}, [walletState, balanceFetchCompleted, balanceError]);
```

### 3. Shortened API Timeouts for Wallet-Init Calls ✅

**File:** `src/lib/apiClient.ts`

Reduced timeout from 30s to 3s for wallet-init calls:
- `/health`
- `/api/session/status`
- `/api/wallet/balances`

```typescript
const isWalletInitCall = path.includes('/health') || path.includes('/session/status') || path.includes('/wallet/balances');
const timeoutMs = isWalletInitCall ? 3000 : 30000; // 3s for wallet init, 30s for others
```

### 4. Hide OneClickExecution in Direct Mode ✅

**File:** `src/components/RightPanel.tsx`

Only render OneClickExecution when `isSessionMode === true`:

```typescript
{isSessionMode && (
  <OneClickExecution
    userAddress={walletAddress}
    onEnabled={handleOneClickEnabled}
    onDisabled={handleOneClickDisabled}
  />
)}
```

### 5. Added Timeout to Session Status Check ✅

**File:** `src/components/RightPanel.tsx`

Added 3s timeout to session status check using AbortController:

```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 3000);
try {
  const response = await callAgent('/api/session/status', {
    method: 'POST',
    body: JSON.stringify({ userAddress: address, sessionId: storedSessionId }),
    signal: controller.signal,
  });
} finally {
  clearTimeout(timeoutId);
}
```

### 6. Added Dev-Only Debug Panel ✅

**File:** `src/components/RightPanel.tsx`

Added collapsible debug panel (dev mode only) showing:
- Current wallet state
- Last state transition
- Balance fetch status
- Chain ID
- Backend execution mode
- Frontend auth mode
- Backend health status
- API base URL
- Error details (if any)

---

## Files Changed

| File | Changes |
|------|---------|
| `src/components/RightPanel.tsx` | Added event listeners, timeout fallback, debug panel, hide OneClickExecution in direct mode, timeout on session check |
| `src/lib/apiClient.ts` | Reduced timeout to 3s for wallet-init API calls |

---

## Verification Commands

**1. Start demo:**
```bash
./scripts/restart-demo.sh
```

**2. Open app:**
```
http://127.0.0.1:5173/app
```

**3. Connect wallet:**
- Click "Connect Wallet (Sepolia)"
- Wallet should reach `CONNECTED_READY` within 3 seconds
- If it times out, shows error state with retry button

**4. Check debug panel (dev mode only):**
- Scroll down in wallet card
- Click "Debug Details" to expand
- Verify:
  - `State: CONNECTED_READY`
  - `Balance Fetch: ✅`
  - `Chain ID: 11155111 ✅`
  - `Backend Healthy: ✅`

**5. Test timeout:**
- Stop backend: `lsof -ti :3001 | xargs kill -9`
- Connect wallet
- Should show error after 3s: "Balance fetch timed out after 3 seconds"

**6. Test direct mode:**
- Verify `EXECUTION_AUTH_MODE=direct` in `.env.local`
- Connect wallet
- Should NOT show "Enable one-click execution" prompt
- Should reach READY without waiting for session

---

## Expected Behavior After Fix

1. **Connect Wallet:**
   - State: `DISCONNECTED` → `CONNECTING` → `CONNECTED_LOADING` → `CONNECTED_READY`
   - Total time: < 3 seconds
   - No infinite loading

2. **Direct Mode:**
   - No "Enable one-click execution" prompt
   - No session status check blocking
   - Wallet reaches READY immediately after balance fetch

3. **Error Handling:**
   - If backend offline: Shows `BACKEND_OFFLINE` immediately
   - If balance fetch fails: Shows error after 3s with retry button
   - If timeout: Shows "Balance fetch timed out" with fix command

4. **Debug Panel (dev only):**
   - Shows all state transitions
   - Shows API base URL
   - Shows error details with fix commands

---

## Summary

✅ **Wallet panel no longer gets stuck on "Loading..."**  
✅ **3s timeout prevents infinite loading**  
✅ **Direct mode doesn't block on session**  
✅ **OneClickExecution hidden in direct mode**  
✅ **Dev debug panel shows state transitions**  
✅ **All wallet-init API calls have 3s timeout**

**Status:** Wallet connection is now bulletproof and reaches READY or shows error within 3 seconds.


