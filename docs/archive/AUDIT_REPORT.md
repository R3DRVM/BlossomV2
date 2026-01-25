# Read-Only Audit Report: Two Critical Regressions

## Executive Summary

This audit identifies root causes and minimal fix plans for two regressions:
1. **First user message disappears from chat history** - Race condition in session creation/persistence
2. **Sizing intent mismatch** - Explicit margin amounts ignored, defaulting to 3% risk

---

## Issue 1: First User Message Disappears from Chat History

### Root Cause Analysis

**File:** `src/components/Chat.tsx`  
**Root Cause:** Stale closure in `appendMessageToChat` + race condition between session creation and message append

### Evidence Trail

1. **Session Creation Flow** (lines 801-825, 872-914):
   - `processUserMessage()` calls `ensureActiveChatId()` at line 872
   - `ensureActiveChatId()` creates session via `createNewChatSession()` (line 814)
   - `createNewChatSession()` in `BlossomContext.tsx:663-680`:
     - Creates new session object
     - Calls `setChatSessions()` with updater function (line 673)
     - Calls `setActiveChatId(newId)` (line 678)
     - **Problem:** `setActiveChatId` is async React state update

2. **Message Append Flow** (line 914):
   - `appendMessageToChat(targetChatId, userMessage)` is called
   - `targetChatId` is the return value from `ensureActiveChatId()` (correct)
   - BUT: `appendMessageToChat` closure captures `activeChatId` from render (line 701)

3. **The Bug** (`BlossomContext.tsx:688-702`):
   ```typescript
   const appendMessageToChat = useCallback(
     (chatId: string, message: ChatMessage) => {
       setChatSessions(prev => {
         const next = prev.map(session =>
           session.id === chatId
             ? { ...session, messages: [...session.messages, message] }
             : session
         );
         // BUG: activeChatId here is stale (from closure capture)
         saveChatSessionsToStorage(next, activeChatId ?? chatId);  // Line 697
         return next;
       });
     },
     [activeChatId]  // Line 701: Dependency on activeChatId causes stale closure
   );
   ```

4. **State Ordering Race**:
   - T0: `ensureActiveChatId()` returns `newId`, but `activeChatId` state hasn't updated yet
   - T1: `appendMessageToChat(newId, message)` executes
   - T2: Inside closure, `activeChatId` is still `null` (stale)
   - T3: `saveChatSessionsToStorage(next, activeChatId ?? chatId)` saves with `newId` (correct fallback)
   - **BUT:** If session doesn't exist in `prev` yet (React batching), message is appended to non-existent session
   - T4: React state updates complete, but message was lost

5. **Additional Issue** (`BlossomContext.tsx:682-685`):
   ```typescript
   const setActiveChat = useCallback((id: string) => {
     setActiveChatId(id);
     saveChatSessionsToStorage(chatSessions, id);  // Line 684: Uses stale chatSessions
   }, [chatSessions]);
   ```
   - `setActiveChat` is called by `ensureActiveChatId()` (line 817)
   - But `chatSessions` in closure may not include the newly created session yet

### Exact Root Cause

**File:** `src/context/BlossomContext.tsx`  
**Lines:** 688-702 (`appendMessageToChat`)

**Problem:** The closure captures `activeChatId` from a previous render. When a new session is created:
1. `ensureActiveChatId()` returns the new ID synchronously
2. But `activeChatId` state hasn't updated yet (React async state)
3. `appendMessageToChat(newId, message)` uses the correct `chatId` parameter
4. BUT `saveChatSessionsToStorage(next, activeChatId ?? chatId)` may use stale `activeChatId`
5. More critically: If `setChatSessions` hasn't flushed yet, the session may not exist in `prev`, so message is appended to a session that doesn't exist in the array

**Secondary Issue:** `createNewChatSession()` calls `setActiveChatId()` but the session may not be in `chatSessions` array when `appendMessageToChat` runs if React batches updates.

### Minimal Fix Plan

**File:** `src/context/BlossomContext.tsx`

**Change 1:** Fix `appendMessageToChat` to not depend on `activeChatId` closure:
```typescript
// Line 688-702: Replace with
const appendMessageToChat = useCallback(
  (chatId: string, message: ChatMessage) => {
    setChatSessions(prev => {
      // Ensure session exists (create if missing - defensive)
      const sessionExists = prev.some(s => s.id === chatId);
      let next: ChatSession[];
      if (!sessionExists) {
        // Session doesn't exist yet - create it
        const newSession: ChatSession = {
          id: chatId,
          title: 'New chat',
          createdAt: Date.now(),
          messages: [message],
        };
        next = [newSession, ...prev];
      } else {
        next = prev.map(session =>
          session.id === chatId
            ? { ...session, messages: [...session.messages, message] }
            : session
        );
      }
      // Use chatId directly (not activeChatId from closure)
      saveChatSessionsToStorage(next, chatId);
      return next;
    });
  },
  [] // Remove activeChatId dependency
);
```

**Change 2:** Fix `setActiveChat` to use functional update:
```typescript
// Line 682-685: Replace with
const setActiveChat = useCallback((id: string) => {
  setActiveChatId(id);
  setChatSessions(prev => {
    // Use functional update to get latest sessions
    saveChatSessionsToStorage(prev, id);
    return prev;
  });
}, []); // Remove chatSessions dependency
```

**Change 3:** Ensure `createNewChatSession` is atomic:
```typescript
// Line 663-680: Already correct, but add defensive check in appendMessageToChat (above)
```

**Why This Works:**
- `appendMessageToChat` no longer depends on stale `activeChatId`
- Creates session defensively if it doesn't exist (handles race condition)
- Uses `chatId` parameter directly for storage (always correct)
- `setActiveChat` uses functional update to get latest sessions

---

## Issue 2: Sizing Intent Mismatch ("1k with 20x" becomes "3% risk")

### Root Cause Analysis

**File:** `src/components/Chat.tsx`  
**Root Cause:** `normalizePerpCreateSpec` defaults `riskPercent` to 3 even when `marginUsd` is provided, and `handleCreatePerpDraftFromSpec` doesn't recompute `riskPercent` from `marginUsd`.

### Evidence Trail

1. **Parsing Layer** (`src/lib/mockParser.ts:124-207`):
   - `parseModificationFromText()` correctly extracts `sizeUsd` from "1k", "$1,000", etc. (lines 131-153)
   - Returns `{ sizeUsd: 1000 }` for "1k"
   - **Correct behavior**

2. **Spec Normalization** (`Chat.tsx:411-469`):
   ```typescript
   // Line 436-439: Gets riskPercent with default 3
   const riskPercent = parsed.strategy?.riskPercent ?? 
                      parsed.modifyPerpStrategy?.modification.riskPercent ?? 
                      3;  // DEFAULT 3% - PROBLEM
   
   // Line 442: Gets modification (has sizeUsd = 1000)
   const modification = parseModificationFromText(userText);
   
   // Line 447-453: Sets marginUsd if sizeUsd exists
   let marginUsd: number | undefined = undefined;
   if (modification?.sizeUsd && modification.sizeUsd > 0) {
     marginUsd = modification.sizeUsd;  // marginUsd = 1000 ✓
   } else if (parsed.strategy?.riskPercent) {
     marginUsd = undefined;
   }
   
   // Line 460-468: Returns spec with BOTH riskPercent=3 AND marginUsd=1000
   return {
     side,
     riskPercent,  // = 3 (WRONG - should be derived from marginUsd)
     leverage,
     marginUsd,    // = 1000 (CORRECT)
     ...
   };
   ```

3. **Draft Creation** (`Chat.tsx:472-574`):
   ```typescript
   // Line 503-506: Gets values from spec
   let finalRiskPercent = spec.riskPercent;  // = 3 (from default)
   let finalMarginUsd: number | undefined = spec.marginUsd;  // = 1000
   
   // Line 522-524: If marginUsd exists, doesn't recompute riskPercent
   if (finalMarginUsd && finalLeverage) {
     // Margin-based: already have margin, leverage is set
     // No need to recompute  <-- BUG: Should recompute riskPercent here
   } else if (finalRiskPercent && finalLeverage) {
     // Risk-based: compute margin from risk
     const sizing = computePerpFromRisk({...});
     finalMarginUsd = sizing.marginUsd;
   }
   
   // Line 561-574: Creates strategy with riskPercent=3 (WRONG)
   const newStrategy = addDraftStrategy({
     ...
     riskPercent: finalRiskPercent,  // = 3 (should be derived from marginUsd)
     marginUsd: finalMarginUsd,     // = 1000 (correct)
     ...
   });
   ```

4. **UI Display** (`Chat.tsx:577-587`):
   ```typescript
   // Line 581: Message shows riskPercent=3 instead of derived value
   const parsedStrategyForMessage: ParsedStrategy = {
     ...
     riskPercent: finalRiskPercent,  // = 3 (shown in UI)
     ...
   };
   ```

### Exact Root Cause

**File:** `src/components/Chat.tsx`  
**Lines:** 
- 436-439: `riskPercent` defaulted to 3 even when `marginUsd` is provided
- 522-524: `handleCreatePerpDraftFromSpec` doesn't recompute `riskPercent` from `marginUsd`

**Problem:** When user provides explicit margin amount ("1k", "$1,000"), the system:
1. ✅ Correctly parses `marginUsd = 1000`
2. ❌ Still defaults `riskPercent = 3` (should derive from margin)
3. ❌ Creates strategy with `riskPercent=3` instead of `riskPercent = (marginUsd / accountValue) * 100`
4. ❌ UI displays "3% risk" instead of showing the actual risk implied by $1,000 margin

**Expected Behavior:**
- If `marginUsd` is provided → `riskPercent` should be derived: `(marginUsd / accountValue) * 100`
- `riskPercent` should only be used as primary input if `marginUsd` is NOT provided
- UI should show the derived risk% when margin is the anchor

### Minimal Fix Plan

**File:** `src/components/Chat.tsx`

**Change 1:** Fix `normalizePerpCreateSpec` to not default riskPercent when marginUsd exists:
```typescript
// Line 436-453: Replace with
// Get leverage and margin from parseModificationFromText + extractedParams
const modification = parseModificationFromText(userText);
const leverage = extractedParams?.leverage ?? 
                modification?.leverage ?? 
                1;

let marginUsd: number | undefined = undefined;
let riskPercent: number | undefined = undefined;

if (modification?.sizeUsd && modification.sizeUsd > 0) {
  // User provided explicit margin amount - this is the anchor
  marginUsd = modification.sizeUsd;
  // Don't set riskPercent here - will be derived in handleCreatePerpDraftFromSpec
  riskPercent = undefined;
} else {
  // No explicit margin - use riskPercent as primary input
  riskPercent = parsed.strategy?.riskPercent ?? 
               parsed.modifyPerpStrategy?.modification.riskPercent ?? 
               3;
  marginUsd = undefined; // Will be computed from riskPercent
}

// Line 460-468: Return with riskPercent as undefined when marginUsd is provided
return {
  side,
  riskPercent,  // undefined if marginUsd provided, else 3 or parsed value
  leverage,
  marginUsd,    // 1000 if provided, else undefined
  stopLoss,
  takeProfit,
  entryPrice,
};
```

**Change 2:** Fix `handleCreatePerpDraftFromSpec` to derive riskPercent from marginUsd:
```typescript
// Line 502-544: Replace with
// Compute sizing
let finalRiskPercent = spec.riskPercent;
let finalStopLoss = spec.stopLoss;
let finalLeverage: number | undefined = spec.leverage;
let finalMarginUsd: number | undefined = spec.marginUsd;

if (extractedParams) {
  if (extractedParams.wantsRestOfPortfolio) {
    finalRiskPercent = 95;
    finalMarginUsd = undefined; // Will be computed from risk
  } else if (extractedParams.wantsFullPort) {
    finalRiskPercent = 95;
    finalMarginUsd = undefined; // Will be computed from risk
  }
  if (extractedParams.wantsNoStopLoss) {
    finalStopLoss = 0;
  }
  if (extractedParams.leverage) {
    finalLeverage = extractedParams.leverage;
  }
}

// FIX: Prioritize marginUsd over riskPercent when marginUsd is provided
if (finalMarginUsd && finalLeverage) {
  // Margin-based: user provided explicit margin amount
  // Derive riskPercent from margin: risk% = (margin / accountValue) * 100
  finalRiskPercent = account.accountValue > 0
    ? (finalMarginUsd / account.accountValue) * 100
    : 3; // Fallback if accountValue is 0
  // marginUsd and leverage are already set, no need to recompute
} else if (finalRiskPercent && finalLeverage) {
  // Risk-based: compute margin from risk
  const sizing = computePerpFromRisk({
    accountValue: account.accountValue,
    riskPercent: finalRiskPercent,
    leverage: finalLeverage,
  });
  finalMarginUsd = sizing.marginUsd;
} else {
  // Default leverage if missing
  finalLeverage = finalLeverage || 1;
  if (finalRiskPercent) {
    const sizing = computePerpFromRisk({
      accountValue: account.accountValue,
      riskPercent: finalRiskPercent,
      leverage: finalLeverage,
    });
    finalMarginUsd = sizing.marginUsd;
  }
}
```

**Why This Works:**
- When `marginUsd` is provided, `riskPercent` is derived (not defaulted to 3)
- When `riskPercent` is provided (and no marginUsd), margin is computed from risk (existing behavior)
- UI will show correct risk% when margin is the anchor
- Strategy object stores both `marginUsd` and derived `riskPercent` consistently

---

## Acceptance Tests

### Test 1: First Message Persistence

**Setup:**
1. Clear localStorage: `localStorage.clear()`
2. Reload page (fresh session)
3. Send first message: "long btc with 20x"

**Expected:**
- Message appears in chat immediately
- Message persists after page refresh
- Message appears in left sidebar "Chat History"
- Session is created and activeChatId is set

**Current Behavior (Bug):**
- Message may disappear after refresh
- Message may not appear in chat history

**Test Location:** Manual test in browser console + E2E test file (to be created)

---

### Test 2: Explicit Margin Amount ("1k with 20x")

**Input:** "long btc using 1000 with 20x leverage"

**Expected:**
- `strategy.marginUsd === 1000`
- `strategy.leverage === 20`
- `strategy.notionalUsd === 20000` (margin * leverage)
- `strategy.riskPercent === (1000 / accountValue) * 100` (derived, not 3)
- UI shows: "Long BTC-PERP with $1,000 margin (20x leverage, X% risk)"

**Current Behavior (Bug):**
- `strategy.riskPercent === 3` (wrong)
- UI shows "3% risk" instead of derived risk%

**Test Location:** Unit test in `src/components/Chat.test.tsx` (to be created)

---

### Test 3: Explicit Risk Percent ("3% risk with 20x")

**Input:** "long btc with 3% risk and 20x leverage"

**Expected:**
- `strategy.riskPercent === 3`
- `strategy.leverage === 20`
- `strategy.marginUsd === (accountValue * 0.03) / 20` (computed from risk)
- `strategy.notionalUsd === marginUsd * 20`
- UI shows: "Long BTC-PERP with 3% risk (20x leverage, $X margin)"

**Current Behavior:** ✅ Should work (risk-based path)

**Test Location:** Unit test in `src/components/Chat.test.tsx` (to be created)

---

### Test 4: UPDATE Path Still Works

**Input:** "update BTC leverage to 10x"

**Expected:**
- Routes to UPDATE (not CREATE)
- Updates existing BTC strategy leverage to 10x
- Does not create new strategy
- Does not affect other strategies (ETH, SOL, etc.)

**Current Behavior:** ✅ Should work (strict routing)

**Test Location:** Unit test in `src/components/Chat.test.tsx` (to be created)

---

## Tripwires / Invariants

### Invariant 1: Multi-Position Support
- **Guard:** After fix, verify BTC + ETH positions both visible
- **Test:** Create BTC long, then ETH long, verify both in portfolio
- **Risk:** Fix might break multi-position rendering

### Invariant 2: Strict CREATE/UPDATE Routing
- **Guard:** `determineIntentStrictV2` must still route correctly
- **Test:** "long btc" → CREATE, "update btc leverage" → UPDATE
- **Risk:** Fix might break routing logic

### Invariant 3: Storage Consistency
- **Guard:** `saveChatSessionsToStorage` must use correct chatId
- **Test:** Create session, append message, reload, verify message exists
- **Risk:** Fix might break storage key

### Invariant 4: Margin vs Risk Priority
- **Guard:** When both marginUsd and riskPercent provided, margin wins
- **Test:** "long btc using 1k with 3% risk" → marginUsd=1000, riskPercent derived
- **Risk:** Fix might break edge cases

---

## File-by-File Change Summary

### `src/context/BlossomContext.tsx`
- **Lines 688-702:** Fix `appendMessageToChat` closure + defensive session creation
- **Lines 682-685:** Fix `setActiveChat` to use functional update
- **Impact:** Issue 1 fix

### `src/components/Chat.tsx`
- **Lines 436-453:** Fix `normalizePerpCreateSpec` to not default riskPercent when marginUsd exists
- **Lines 502-544:** Fix `handleCreatePerpDraftFromSpec` to derive riskPercent from marginUsd
- **Impact:** Issue 2 fix

### Test Files (to be created)
- `src/components/__tests__/Chat.test.tsx`: Unit tests for sizing logic
- `src/__e2e__/chat-persistence.test.ts`: E2E test for message persistence

---

## Implementation Order

1. **Issue 1 Fix First** (higher priority - data loss)
   - Fix `appendMessageToChat` closure
   - Fix `setActiveChat` functional update
   - Test: First message persistence

2. **Issue 2 Fix Second** (UX issue)
   - Fix `normalizePerpCreateSpec` riskPercent logic
   - Fix `handleCreatePerpDraftFromSpec` margin→risk derivation
   - Test: "1k with 20x" → correct risk%

3. **Add Tests**
   - Unit tests for sizing logic
   - E2E test for persistence
   - Manual regression tests

---

## Risk Assessment

**Issue 1 Fix Risk:** 🟡 Medium
- Changes core persistence logic
- Must test thoroughly with multiple sessions
- Risk of breaking existing chat history

**Issue 2 Fix Risk:** 🟢 Low
- Isolated to sizing calculation
- Doesn't affect routing or multi-position
- Easy to test with unit tests

**Combined Risk:** 🟡 Medium
- Both fixes are surgical and isolated
- No changes to UI rendering
- No changes to routing logic
- Comprehensive test coverage recommended


