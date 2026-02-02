# Blossom MVP Comprehensive Production Audit

**Date:** 2026-02-01
**Auditor:** Claude Code
**Production URL:** https://blossom.onl
**Backend API:** https://api.blossom.onl

---

## Executive Summary

The Blossom MVP has a **well-designed ledger system** with proper per-wallet position scoping, but the **execution flow bypasses this ledger entirely**, using global simulation state instead. This is the root cause of all position isolation failures.

### Critical Issues Found: 15
- **5 CRITICAL** - App-breaking bugs
- **4 HIGH** - Significant functionality issues
- **6 MEDIUM** - Non-blocking but should fix

---

## System Health Check (Live Production)

| Endpoint | Status | Notes |
|----------|--------|-------|
| `/health` | ✅ OK | Backend healthy, db=postgres |
| `/api/execute/preflight` | ✅ OK | All adapters configured |
| `/api/rpc/health` | ✅ OK | 5 RPC endpoints healthy |
| `/api/session/status` | ⚠️ PARTIAL | Returns `enabled: false` |

### Configured Adapters (8 total):
- UniswapV3, WETH Wrap, Mock Swap, Proof
- ERC20 Pull, Demo Lend, Demo Perp, Demo Event

---

## CRITICAL BUGS (App-Breaking)

### BUG #1: Global Simulation State NOT Per-User
**Severity:** CRITICAL
**Impact:** All users see each other's positions

**Location:**
- `agent/src/plugins/perps-sim/index.ts` line 26
- `agent/src/plugins/defi-sim/index.ts` line 16

**Problem:** All simulation state is stored in module-level variables:
```typescript
// perps-sim/index.ts line 26
let accountState: PerpsAccountState = {
  accountValueUsd: 10000,
  balances: [...INITIAL_BALANCES],
  positions: [],  // SHARED BY ALL USERS
};
```

**Result:**
- User A opens position → stored in global `accountState`
- User B requests positions → sees User A's positions
- `/api/reset` endpoint resets positions for ALL users

---

### BUG #2: Execution Never Records to Ledger
**Severity:** CRITICAL
**Impact:** Positions lost on page refresh

**Location:** `agent/src/server/http.ts` lines 4174-4198

**Problem:** After relayed transaction succeeds, only `buildPortfolioSnapshot()` is called. NO call to `createPosition()` or any ledger recording.

**The ledger system exists and is properly designed:**
```sql
-- schema.sql: positions table with user_address scoping
CREATE INDEX idx_positions_user ON positions(user_address);
```

**But it's never used!** The execution flow goes:
1. ✅ Transaction sent on-chain
2. ✅ Receipt confirmed
3. ❌ Position NOT recorded to ledger
4. ❌ Frontend calls `refreshLedgerPositions()` → returns empty

---

### BUG #3: Silent Session Fallback Without Frontend Notice
**Severity:** CRITICAL
**Impact:** User thinks trade executed when it didn't

**Location:** `agent/src/server/http.ts` lines 3389-3398

**Problem:** If `sessionEnabled` is false, endpoint returns:
```typescript
return res.json({
  success: true,  // LOOKS LIKE SUCCESS
  status: 'success',
  notes: ['session_disabled_fell_back_to_direct'],  // HIDDEN IN NOTES
  portfolio: portfolioAfter,  // FROM SIMULATION, NOT CHAIN
});
```

**Frontend code** (`executionKernel.ts` line 229) checks `response.ok` which is TRUE. The `notes` field is NOT checked.

**Result:** Frontend shows "Executed!" but nothing was sent on-chain.

---

### BUG #4: Frontend Doesn't Validate Backend Session Status
**Severity:** CRITICAL
**Impact:** Session execution attempted when backend can't support it

**Location:** `src/components/Chat.tsx` lines 3756-3786

**Problem:** Frontend checks localStorage keys but never queries `/api/session/status` to verify backend is configured for session mode.

```typescript
// Frontend assumes session works if localStorage says so
const isSessionEnabled = localStorage.getItem(enabledKey) === 'true' &&
                         localStorage.getItem(authorizedKey) === 'true';

if (isSessionEnabled && !userHasManualSigning) {
  // Proceeds directly without backend validation!
}
```

---

### BUG #5: Portfolio Response Missing User Identifier
**Severity:** CRITICAL
**Impact:** Wrong portfolio applied to wrong wallet

**Location:** `agent/src/server/http.ts` lines 4179-4198

**Problem:** Portfolio response has no `userAddress` field:
```typescript
const result = {
  success: true,
  portfolio: portfolioAfter,  // No userAddress!
};
```

If frontend caches portfolio responses, it may apply wrong portfolio to wrong wallet.

---

## HIGH SEVERITY BUGS

### BUG #6: Wrap Timeout Leaves Funds in Limbo
**Location:** `src/components/Chat.tsx` lines 4104-4131

**Problem:** If wrap TX doesn't confirm within 60 seconds:
- Function returns early
- WETH balance already deducted
- Swap never executes
- User stuck with wrapped ETH, no swap

---

### BUG #7: No Nonce Replay Protection
**Location:** `agent/src/server/http.ts` lines 3424-3427

**Problem:** Nonce generated from timestamp + random, no duplicate check. Network retry can cause double execution.

---

### BUG #8: Position Refresh Doesn't Validate Wallet Match
**Location:** `src/context/BlossomContext.tsx` line 1717

**Problem:** `refreshLedgerPositions()` calls `getOpenPositions()` without passing current wallet address. If wallet switched, wrong positions returned.

---

### BUG #9: DeFi Positions Not Synced on Page Load
**Location:** Multiple files

**Problem:** DeFi positions stored in:
- Simulation state (defi-sim)
- Aave on-chain state
- NOT in execution-ledger

`refreshLedgerPositions()` only queries ledger, missing DeFi.

---

## MEDIUM SEVERITY BUGS

### BUG #10: planHash Computed but Never Used
**Location:** `agent/src/server/http.ts` lines 4096-4132

**Problem:** Security/audit hash computed but never stored or verified.

### BUG #11: Unvalidated userAddress in Ledger Query
**Location:** `agent/src/server/http.ts` line 7622

**Problem:** `userAddress` query param not validated. If undefined, may return all positions.

### BUG #12: Session Status Endpoint Requires sessionId
**Location:** `/api/session/status`

**Problem:** Returns `enabled: false, reason: MISSING_FIELDS` when no sessionId provided. Frontend can't check if session mode is configured.

### BUG #13: Error Objects Can Still Leak to UI
**Location:** Various error handlers

**Problem:** Some error paths still pass objects that could cause React #31.

### BUG #14: No Rate Limiting on Execution Endpoints
**Location:** `/api/execute/relayed`

**Problem:** No protection against rapid-fire execution attempts.

### BUG #15: Session Creation Has No On-Chain Validation
**Location:** Session flow

**Problem:** Frontend can set localStorage keys without actual on-chain session.

---

## Recommended Fixes (Priority Order)

### P0 - IMMEDIATE (Blocking MVP Demo)

#### Fix 1: Record Positions to Ledger After Execution
```typescript
// In agent/src/server/http.ts after line 4173
import { createPosition } from '../../execution-ledger/db';

// After confirmed receipt:
if (receiptStatus === 'confirmed') {
  await createPosition({
    chain: 'ethereum',
    network: 'sepolia',
    venue: instrumentType,
    market: action.data?.asset || 'ETH',
    side: action.data?.direction || 'long',
    leverage: action.data?.leverage,
    user_address: userAddress.toLowerCase(),
    open_tx_hash: txHash,
    intent_id: plan.metadata?.draftId,
  });
}
```

#### Fix 2: Return Error When Session Disabled (Not Silent Success)
```typescript
// In agent/src/server/http.ts line 3389
if (!sessionEnabled) {
  return res.status(503).json({
    ok: false,
    error: 'Session execution not available',
    errorCode: 'SESSION_NOT_CONFIGURED',
    notes: ['Backend not configured for session mode'],
  });
}
```

#### Fix 3: Add Session Preflight Check in Frontend
```typescript
// In src/components/Chat.tsx before session execution
const sessionCheck = await callAgent('/api/session/status?userAddress=' + userAddress);
const sessionData = await sessionCheck.json();
if (!sessionData.session?.enabled) {
  throw new Error('Session mode not available: ' + sessionData.session?.reason);
}
```

### P1 - HIGH (Fix Within 48 Hours)

#### Fix 4: Scope Simulation State Per User
```typescript
// In agent/src/plugins/perps-sim/index.ts
// Replace global state with Map keyed by userAddress
const userStates = new Map<string, PerpsAccountState>();

export function getOrCreateUserState(userAddress: string): PerpsAccountState {
  const key = userAddress.toLowerCase();
  if (!userStates.has(key)) {
    userStates.set(key, {
      accountValueUsd: 10000,
      balances: [...INITIAL_BALANCES],
      positions: []
    });
  }
  return userStates.get(key)!;
}
```

#### Fix 5: Add userAddress to Portfolio Response
```typescript
// In agent/src/server/http.ts
return res.json({
  ok: true,
  portfolio: portfolioAfter,
  userAddress: userAddress.toLowerCase(),  // ADD THIS
});
```

### P2 - MEDIUM (Fix Within 1 Week)

- Add nonce idempotency check
- Add rate limiting
- Validate userAddress format in ledger queries
- Store and verify planHash
- Add on-chain session validation

---

## Testing Checklist for Testers

### Before Testing:
1. Clear localStorage: `localStorage.clear()`
2. Hard refresh: Cmd+Shift+R
3. Connect fresh wallet

### Test Cases:

| # | Test | Expected | Current Status |
|---|------|----------|----------------|
| 1 | Enable session mode | UI shows "Session Mode" | ✅ Works |
| 2 | Execute swap | TX on chain, position in tray | ❌ Position lost |
| 3 | Refresh page | Position still visible | ❌ Position gone |
| 4 | Different wallet, check positions | Only own positions | ❌ Sees all users |
| 5 | Execute DeFi deposit | Position recorded | ❌ Not recorded |
| 6 | Execute event market bet | Position recorded | ❌ Not recorded |
| 7 | Backend session disabled | Clear error message | ❌ Silent "success" |

---

## Architecture Diagram

```
Current Flow (BROKEN):
┌─────────┐    ┌──────────┐    ┌────────────┐    ┌───────────┐
│ Frontend│───>│ /relayed │───>│ GLOBAL SIM │───>│ Portfolio │
│ Chat.tsx│    │ endpoint │    │  (shared)  │    │ (shared)  │
└─────────┘    └──────────┘    └────────────┘    └───────────┘
                                     │
                                     X (NOT CONNECTED)
                                     │
                              ┌──────────────┐
                              │   LEDGER DB  │
                              │ (per-wallet) │
                              └──────────────┘

Fixed Flow (CORRECT):
┌─────────┐    ┌──────────┐    ┌────────────┐    ┌───────────┐
│ Frontend│───>│ /relayed │───>│ ON-CHAIN TX│───>│ LEDGER DB │
│ Chat.tsx│    │ endpoint │    │  Sepolia   │    │ (indexed  │
└─────────┘    └──────────┘    └────────────┘    │ by wallet)│
                                                  └───────────┘
```

---

## Summary

The Blossom MVP has excellent infrastructure (ledger DB, adapters, session system) but the **execution flow bypasses this infrastructure entirely**, falling back to global simulation state.

**Key Fix:** Connect the relayed execution endpoint to the ledger database using `createPosition()` after confirmed receipts, with proper `user_address` scoping.

This single change will resolve the majority of reported issues.
