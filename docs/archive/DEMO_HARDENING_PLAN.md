# Demo Safety Hardening Plan

## Goal
Ensure investor demo stability: multi-strategy create + update via chat + right panel edits + confirm flow must work reliably without regressions.

---

## 1. Critical Path State Flow Map

### First Message → Session Creation → Draft → Confirm Flow

```
User Action: "long btc with 2% risk"
  ↓
handleSend() [Chat.tsx:2219]
  ↓
processUserMessage(userText) [Chat.tsx:855]
  ├─ Line 894: targetChatId = ensureActiveChatId()
  │  └─ ensureActiveChatId() [Chat.tsx:829]
  │     ├─ If activeChatId exists → return it
  │     └─ Else → createNewChatSession() [BlossomContext.tsx:683]
  │        └─ Creates Session A, sets activeChatId = Session A
  │
  ├─ Line 934: appendMessageToChat(targetChatId, userMessage)
  │  └─ BlossomContext.tsx:711
  │     ├─ Creates session defensively if missing
  │     ├─ Appends user message
  │     └─ B4: Updates title if first user message (line 728-740)
  │
  ├─ Line 988: parseUserMessage() → returns parsed intent
  │
  ├─ Line 1434: determineIntentStrictV2() → returns 'create'
  │
  ├─ Line 1490: handleCreatePerpDraftFromSpec(..., targetChatId, ...)
  │  └─ Chat.tsx:475
  │     ├─ Line 599: Uses passed targetChatId (NO createNewChatSession)
  │     ├─ Line 629: appendMessageToChat(targetChatId, draftCard)
  │     └─ Line 632: activeDraftChatIdRef.current = targetChatId
  │
User Action: Click "Confirm & Execute"
  ↓
handleConfirmTrade(draftId) [Chat.tsx:2306]
  ├─ Line 2301: targetChatId = activeDraftChatIdRef.current || activeChatId
  │  └─ Uses stored targetChatId from draft creation
  ├─ Line 2310: updateStrategyStatus(draftId, 'executed')
  ├─ Line 2359: Finds draft message in targetChatId session
  └─ Line 2381: updateMessageInChat(targetChatId, draftMessageId, executedMessage)
     └─ BlossomContext.tsx:751
        └─ Updates message in same session
```

### Key State Variables

**Session Management:**
- `activeChatId` (BlossomContext) - Currently visible session
- `targetChatId` (processUserMessage local) - Session for current send flow
- `activeDraftChatIdRef` (Chat.tsx:130) - Stored targetChatId from draft creation
- `chatSessions` (BlossomContext) - All sessions array

**Message Tracking:**
- `activeDraftMessageIdRef` (Chat.tsx:129) - Draft card message ID for replacement
- `lastHandledMessageKeyRef` (Chat.tsx:126) - Prevents duplicate message handling

**Strategy State:**
- `strategies` (BlossomContext) - All strategies (draft/queued/executing/executed)
- `selectedStrategyId` (BlossomContext) - Currently selected for editing

---

## 2. Invariants to Enforce (DEV Tripwires)

### INV-1: Single targetChatId Per Send Flow
**Rule:** `processUserMessage` computes `targetChatId` exactly once at the start, and all downstream functions use that same `targetChatId`.

**Tripwire:**
```typescript
// In processUserMessage, after ensureActiveChatId()
if (import.meta.env.DEV) {
  const targetChatIdSnapshot = targetChatId;
  // Assert no createNewChatSession() calls in downstream handlers
  // Check: activeDraftChatIdRef should match targetChatIdSnapshot after draft creation
}
```

**File/Line:** Chat.tsx:894 (targetChatId computation)

---

### INV-2: No createNewChatSession in Downstream Handlers
**Rule:** `handleCreatePerpDraftFromSpec`, `handleConfirmTrade`, `handleUpdateStrategy` must NOT call `createNewChatSession()` as fallback.

**Tripwire:**
```typescript
// In handleCreatePerpDraftFromSpec
if (import.meta.env.DEV && !targetChatId) {
  console.error('[INV-2] handleCreatePerpDraftFromSpec called without targetChatId');
  throw new Error('targetChatId is required');
}
```

**Current Violations:**
- ✅ FIXED: Chat.tsx:599 - Removed `createNewChatSession()` fallback
- ⚠️ REMAINING: Chat.tsx:341 - `handleParsed` has fallback (but accepts opts.targetChatId)
- ⚠️ REMAINING: Chat.tsx:2048, 2098 - `handleUpdateStrategy` has fallback

**File/Lines:**
- Chat.tsx:341 (handleParsed - acceptable if opts.targetChatId provided)
- Chat.tsx:2048, 2098 (handleUpdateStrategy - should pass targetChatId)

---

### INV-3: Confirm Uses Stored targetChatId
**Rule:** `handleConfirmTrade` must use `activeDraftChatIdRef.current` (not `activeChatId || createNewChatSession()`).

**Tripwire:**
```typescript
// In handleConfirmTrade
if (import.meta.env.DEV) {
  if (!activeDraftChatIdRef.current && !activeChatId) {
    console.error('[INV-3] handleConfirmTrade: No targetChatId available');
  }
  if (activeDraftChatIdRef.current && activeDraftChatIdRef.current !== activeChatId) {
    console.warn('[INV-3] handleConfirmTrade: Using stored targetChatId different from activeChatId', {
      stored: activeDraftChatIdRef.current,
      active: activeChatId
    });
  }
}
```

**File/Line:** Chat.tsx:2301 (✅ FIXED - uses activeDraftChatIdRef)

---

### INV-4: Title Update in Same State Update
**Rule:** Session title must be updated inside `appendMessageToChat` state update (not in separate `updateChatSessionTitle` call with stale state).

**Tripwire:**
```typescript
// In appendMessageToChat, after title update
if (import.meta.env.DEV && message.isUser) {
  const session = next.find(s => s.id === chatId);
  if (session && session.title === 'New chat' && session.messages.filter(m => m.isUser).length > 0) {
    console.error('[INV-4] Title not updated for first user message', { chatId, messageId: message.id });
  }
}
```

**File/Line:** BlossomContext.tsx:728-740 (✅ FIXED - title update in same state update)

---

### INV-5: updateMessageInChat Always Available
**Rule:** `updateMessageInChat` must be defined in BlossomContext and available at runtime.

**Tripwire:**
```typescript
// At callsites (Chat.tsx:2068, 2371)
if (import.meta.env.DEV && typeof updateMessageInChat !== 'function') {
  console.error('[INV-5] updateMessageInChat is not a function', {
    type: typeof updateMessageInChat,
    available: 'updateMessageInChat' in useBlossomContext()
  });
}
```

**File/Lines:**
- BlossomContext.tsx:751 (✅ FIXED - function defined)
- Chat.tsx:2068, 2371 (✅ FIXED - defensive guards added)

---

### INV-6: No Stale Closure in Persistence
**Rule:** All persistence functions (`appendMessageToChat`, `updateMessageInChat`, `updateChatSessionTitle`) must use explicit `chatId` parameter, not `activeChatId` from closure.

**Tripwire:**
```typescript
// In all persistence functions
if (import.meta.env.DEV) {
  // Verify no activeChatId dependency in useCallback
  // Verify saveChatSessionsToStorage uses chatId parameter, not activeChatId
}
```

**File/Lines:**
- BlossomContext.tsx:711 (✅ FIXED - no activeChatId dependency)
- BlossomContext.tsx:751 (✅ FIXED - uses chatId parameter)
- BlossomContext.tsx:761 (✅ FIXED - uses id parameter)

---

### INV-7: Session Count Stability
**Rule:** During a single send → draft → confirm flow, session count should remain constant (no duplicate sessions).

**Tripwire:**
```typescript
// In processUserMessage
const sessionCountBefore = chatSessions.length;
// ... after draft creation
const sessionCountAfter = chatSessions.length;
if (import.meta.env.DEV && sessionCountAfter > sessionCountBefore + 1) {
  console.error('[INV-7] Multiple sessions created during single send', {
    before: sessionCountBefore,
    after: sessionCountAfter,
    sessions: chatSessions.map(s => ({ id: s.id, title: s.title }))
  });
}
```

**File/Line:** Chat.tsx:894 (add tripwire after ensureActiveChatId)

---

## 3. Minimal Acceptance Test List

### Test 1: First Message Persists in Visible Session
**Setup:**
- Clear storage
- Fresh app state

**Steps:**
1. Send first message: "hello, this is my first message"
2. Wait 1 second

**Assertions:**
- Exactly 1 session exists
- Active session contains 1 user message
- Session title is NOT "New chat" (should be message preview)
- Left panel shows the message in chat history

**Test Location:** `runVerificationTests()` - Test 1

---

### Test 2: updateMessageInChat Available at Runtime
**Setup:**
- Fresh app state

**Steps:**
1. Send message: "long btc with 2% risk"
2. Wait for draft creation
3. Check `typeof updateMessageInChat === 'function'`

**Assertions:**
- `updateMessageInChat` is a function
- No runtime error when accessing from context

**Test Location:** `runVerificationTests()` - Test 2

---

### Test 3: No Duplicate Sessions During Create+Confirm
**Setup:**
- Fresh app state

**Steps:**
1. Record initial session count
2. Send message: "long eth with 3% risk"
3. Wait for draft creation
4. Record session count after draft
5. Confirm draft (simulate)
6. Record session count after confirm

**Assertions:**
- Session count increases by exactly 1 after first message
- Session count remains constant after draft creation
- Session count remains constant after confirm

**Test Location:** `runVerificationTests()` - Test 3

---

### Test 4: Multi-Position Support (BTC + ETH)
**Setup:**
- Fresh app state

**Steps:**
1. Create & execute BTC position
2. Create & execute ETH position
3. Verify both positions visible in right panel

**Assertions:**
- Both BTC and ETH strategies exist with status 'executed'
- Both positions visible in RightPanel
- No session duplication

**Test Location:** `runAcceptanceLocal()` - Test 4 (existing)

---

### Test 5: Update Path Uses Correct Session
**Setup:**
- BTC position already executed

**Steps:**
1. Send: "update BTC leverage to 10x"
2. Verify update applies to BTC strategy
3. Verify message updates in same session as original draft

**Assertions:**
- Router chooses 'updateSelected' (not 'create')
- Only BTC strategy leverage changes
- ETH strategy unchanged
- Update message in same chat session

**Test Location:** `runAcceptanceLocal()` - Test 3 (existing)

---

### Test 6: Title Updates on First User Message
**Setup:**
- Fresh app state

**Steps:**
1. Send first message: "long btc with 20x leverage"
2. Check session title immediately

**Assertions:**
- Session title is NOT "New chat"
- Session title contains preview of user message (first 8 words)
- Title persists after page refresh

**Test Location:** `runVerificationTests()` - Test 1 (includes title check)

---

### Test 7: Confirm Updates Executed Card in Same Session
**Setup:**
- Draft created in Session A

**Steps:**
1. Confirm draft
2. Verify executed card appears in Session A (not new session)
3. Verify draft card is replaced (not duplicated)

**Assertions:**
- Executed message in same session as draft
- Only 1 message with strategyId (draft replaced, not duplicated)
- `activeDraftChatIdRef.current` matches session ID

**Test Location:** Manual test (add to `runVerificationTests()`)

---

### Test 8: Right Panel Edits Don't Create Sessions
**Setup:**
- BTC position executed

**Steps:**
1. Edit BTC size in right panel
2. Verify no new chat session created
3. Verify update applies to strategy

**Assertions:**
- Session count unchanged
- Strategy updated correctly
- No chat messages created for right panel edits

**Test Location:** Manual test

---

## 4. Remaining Duplicate Session Creation Points

### ⚠️ Remaining Issues

**1. handleParsed (Chat.tsx:341)**
```typescript
const targetChatId = opts?.targetChatId || activeChatId || createNewChatSession();
```
**Status:** Acceptable if `opts.targetChatId` is always provided. Should verify all callers pass it.

**Callers:**
- Chat.tsx:950 - From clarification continuation (passes `targetChatId`)
- Chat.tsx:1170 - From injected parsed result (should pass `targetChatId`)
- Chat.tsx:1430 - From CREATE path (should pass `targetChatId`)

**Recommendation:** Add DEV tripwire to ensure `opts.targetChatId` is always provided.

---

**2. handleUpdateStrategy (Chat.tsx:2048, 2098)**
```typescript
handleUpdateStrategy(targetStrategyId, updates, parsed.strategy, targetChatId || activeChatId || createNewChatSession());
```
**Status:** Should pass `targetChatId` from parent (processUserMessage).

**Recommendation:** 
- Pass `targetChatId` from `processUserMessage` to `handleParsed`
- Pass `targetChatId` from `handleParsed` to `handleUpdateStrategy`
- Remove `createNewChatSession()` fallback

---

### ✅ Fixed Issues

**1. handleCreatePerpDraftFromSpec (Chat.tsx:599)**
- ✅ FIXED: Now accepts `targetChatId` parameter, no fallback

**2. handleConfirmTrade (Chat.tsx:2301)**
- ✅ FIXED: Uses `activeDraftChatIdRef.current`, no fallback

---

## 5. Remaining Stale-Closure Persistence Points

### ✅ All Fixed

**1. appendMessageToChat (BlossomContext.tsx:711)**
- ✅ FIXED: No `activeChatId` dependency, uses `chatId` parameter

**2. updateMessageInChat (BlossomContext.tsx:751)**
- ✅ FIXED: Uses `chatId` parameter, no closure dependencies

**3. updateChatSessionTitle (BlossomContext.tsx:761)**
- ✅ FIXED: Uses `id` parameter, no `activeChatId` dependency

**4. setActiveChat (BlossomContext.tsx:702)**
- ✅ FIXED: Uses functional update for `chatSessions`

---

## 6. Implementation Checklist

### Critical Path Hardening

- [x] **Fix A:** `updateMessageInChat` function implemented
- [x] **Fix B:** Single `targetChatId` per send flow
- [x] **Fix B:** Title update in same state update
- [x] **Fix B:** Confirm uses stored `targetChatId`

### Remaining Hardening

- [ ] **INV-2:** Remove `createNewChatSession()` fallback from `handleUpdateStrategy` (Chat.tsx:2048, 2098)
- [ ] **INV-2:** Ensure all `handleParsed` callers pass `targetChatId` (Chat.tsx:950, 1170, 1430)
- [ ] **INV-7:** Add session count stability tripwire in `processUserMessage`
- [ ] **Test 7:** Add confirm-updates-card test to `runVerificationTests()`
- [ ] **Test 8:** Add right panel edit test (manual verification)

### DEV Tripwires to Add

- [ ] INV-1 tripwire: Verify `targetChatId` consistency
- [ ] INV-2 tripwire: Assert no `createNewChatSession()` in downstream handlers
- [ ] INV-3 tripwire: Verify confirm uses stored `targetChatId`
- [ ] INV-4 tripwire: Verify title updated for first user message
- [ ] INV-5 tripwire: Verify `updateMessageInChat` available
- [ ] INV-6 tripwire: Verify no stale closures in persistence
- [ ] INV-7 tripwire: Verify session count stability

---

## 7. File/Line Reference Summary

### Critical Functions

**Session Management:**
- `ensureActiveChatId()` - Chat.tsx:829
- `createNewChatSession()` - BlossomContext.tsx:683
- `appendMessageToChat()` - BlossomContext.tsx:711
- `updateMessageInChat()` - BlossomContext.tsx:751
- `updateChatSessionTitle()` - BlossomContext.tsx:761

**Message Flow:**
- `processUserMessage()` - Chat.tsx:855
- `handleCreatePerpDraftFromSpec()` - Chat.tsx:475
- `handleConfirmTrade()` - Chat.tsx:2306
- `handleUpdateStrategy()` - Chat.tsx:683

**State Tracking:**
- `activeDraftChatIdRef` - Chat.tsx:130
- `activeDraftMessageIdRef` - Chat.tsx:129

### Remaining Risk Points

**Duplicate Session Creation:**
- Chat.tsx:341 - `handleParsed` fallback (acceptable if targetChatId provided)
- Chat.tsx:2048, 2098 - `handleUpdateStrategy` fallback (should be removed)

**Stale State Reads:**
- None remaining (all fixed)

---

## 8. Demo Stability Guarantees

### What's Guaranteed (After Fixes)

✅ **First message always appears** - Single `targetChatId` per send, no duplicate sessions  
✅ **Title updates correctly** - Title update in same state update, no stale reads  
✅ **Confirm doesn't crash** - `updateMessageInChat` always available with defensive guards  
✅ **Multi-position works** - No session creation during updates, strict routing preserved  
✅ **Right panel edits safe** - No chat session creation for UI-only edits  

### What Needs Verification

⚠️ **Update path session consistency** - `handleUpdateStrategy` should receive `targetChatId`  
⚠️ **All handleParsed callers** - Should pass `targetChatId` explicitly  

---

## 9. Next Steps (Minimal Implementation)

1. **Remove remaining fallbacks:**
   - Chat.tsx:2048, 2098 - Pass `targetChatId` to `handleUpdateStrategy`
   - Verify all `handleParsed` callers pass `targetChatId`

2. **Add DEV tripwires:**
   - INV-1 through INV-7 as specified above

3. **Extend tests:**
   - Add Test 7 (confirm updates card) to `runVerificationTests()`
   - Add Test 8 (right panel edits) as manual verification

4. **Documentation:**
   - Add comments explaining `targetChatId` flow
   - Document why `activeDraftChatIdRef` is needed

---

## 10. Risk Assessment

**Current Risk Level:** 🟡 Medium (after fixes)

**Remaining Risks:**
- `handleUpdateStrategy` fallback could create duplicate session (low probability, only if `targetChatId` and `activeChatId` both null)
- `handleParsed` fallback acceptable if all callers pass `targetChatId` (needs verification)

**Mitigation:**
- Add DEV tripwires to catch violations
- Extend acceptance tests to cover edge cases
- Manual verification during demo prep

---

**Last Updated:** After Fix A & B implementation  
**Status:** Core fixes complete, hardening tripwires pending


