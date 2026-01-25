# Read-Only Audit: updateMessageInChat Error & First Message Disappearing

## Part A: updateMessageInChat is not a function

### Root Cause
**`updateMessageInChat` is destructured from `useBlossomContext()` but is never defined, exported, or provided in `BlossomContext.tsx`.**

### Evidence Trail

1. **Callsite (Chat.tsx:2371):**
   ```typescript
   updateMessageInChat(targetChatId, draftMessageId, messageWithoutRisk);
   ```
   - Called during `handleConfirmTrade` after executing a strategy
   - Purpose: Update the draft card message to show executed status

2. **Other callsite (Chat.tsx:2068):**
   ```typescript
   updateMessageInChat(targetChatId, draftMessageId, {
     strategy: updatedStrategy,
     strategyId: targetStrategyId,
   });
   ```
   - Called during draft update flow

3. **Destructuring (Chat.tsx:109):**
   ```typescript
   const { 
     ...
     updateMessageInChat,
     ...
   } = useBlossomContext();
   ```
   - Attempts to get `updateMessageInChat` from context

4. **BlossomContext.tsx Interface (line 160):**
   ```typescript
   updateChatSessionTitle: (id: string, title: string) => void;
   deleteChatSession: (id: string) => void;
   ```
   - **MISSING:** `updateMessageInChat` is not in `BlossomContextType` interface

5. **BlossomContext.tsx Provider Value (lines 1275-1290):**
   ```typescript
   value={{
     ...
     appendMessageToChat,
     updateChatSessionTitle,
     deleteChatSession,
     ...
   }}
   ```
   - **MISSING:** `updateMessageInChat` is not in provider value

6. **No Definition Found:**
   - Searched entire codebase: `updateMessageInChat` is never defined as a function
   - Only exists as a destructured variable that resolves to `undefined`

### Precise Reason
The function was likely planned but never implemented, or was removed during a refactor. The callsites remain but the function definition, interface entry, and provider value are all missing.

### File/Line References
- **Chat.tsx:109** - Destructuring from context (undefined)
- **Chat.tsx:2068** - First callsite (runtime error)
- **Chat.tsx:2371** - Second callsite (runtime error)
- **BlossomContext.tsx:160** - Interface missing entry
- **BlossomContext.tsx:1280** - Provider value missing entry

---

## Part B: First User Message Disappears / Title Stays "New chat"

### Root Cause
**Multiple session creation points create race conditions. The first message may be appended to a different session than the one shown in the UI, and title updates use stale state.**

### What "Disappears" Means
The message exists in `chatSessions` state, but:
1. It's in a different session than `activeChatId` (the one shown in left panel)
2. OR the session title never updates from "New chat" because the title check uses stale `chatSessions` state

### Lifecycle Map for First Send

```
handleSend (line 2219)
  ↓
processUserMessage (line 828)
  ↓
ensureActiveChatId() (line 894)
  ├─ If activeChatId exists → return it
  └─ Else → createNewChatSession() (line 836) → creates Session A
  ↓
targetChatId = ensureActiveChatId() return value
  ↓
appendMessageToChat(targetChatId, userMessage) (line 934)
  └─ Appends to Session A
  ↓
[Later in flow]
handleCreatePerpDraftFromSpec (line 475)
  └─ Line 599: const targetChatId = activeChatId || createNewChatSession()
     └─ If activeChatId is still null/stale → creates Session B
     └─ Appends draft card to Session B
```

### Multiple Session Creation Points

1. **processUserMessage (line 894):**
   - Calls `ensureActiveChatId()` which may create Session A
   - Uses `targetChatId` from this call

2. **handleCreatePerpDraftFromSpec (line 599):**
   - **PROBLEM:** Creates a NEW session if `activeChatId` is null
   - This happens AFTER `processUserMessage` already created one
   - Creates Session B, appends draft card to Session B
   - User message is in Session A, draft card is in Session B

3. **handleConfirmTrade (line 2299):**
   - `const targetChatId = activeChatId || createNewChatSession();`
   - Could create Session C if `activeChatId` is stale

4. **handleUpdateStrategy (line 2052):**
   - `targetChatId || activeChatId || createNewChatSession()`
   - Fallback creates Session D

### Race Condition Details

**Scenario: First message in fresh app**
1. T0: `processUserMessage` calls `ensureActiveChatId()`
   - `activeChatId` is `null`
   - Creates Session A with ID `session-a`
   - Calls `setActiveChatId('session-a')` (async React state)
   - Returns `'session-a'`

2. T1: `appendMessageToChat('session-a', userMessage)` executes
   - Appends user message to Session A
   - Session A now has 1 user message

3. T2: React state hasn't flushed yet
   - `activeChatId` in component is still `null`
   - `chatSessions` may not include Session A yet (if React batches)

4. T3: `handleCreatePerpDraftFromSpec` executes (line 599)
   - `activeChatId` is still `null` (stale closure)
   - Creates Session B with ID `session-b`
   - Calls `setActiveChatId('session-b')` (async)
   - Appends draft card to Session B

5. T4: React state flushes
   - `activeChatId` becomes `'session-b'` (last write wins)
   - UI shows Session B (which has draft card but NO user message)
   - Session A (with user message) is not visible

### Title Update Issue

**Chat.tsx:926-931:**
```typescript
const session = chatSessions.find(s => s.id === targetChatId);
if (session && session.title === 'New chat') {
  const userMessages = session.messages.filter(m => m.isUser);
  if (userMessages.length === 0) {
    const title = generateSessionTitle(userText);
    updateChatSessionTitle(targetChatId, title);
  }
}
```

**Problem:**
- Checks `chatSessions.find(s => s.id === targetChatId)` which may be stale
- If React hasn't flushed the session creation, `session` is `undefined`
- Title update never happens
- Even if session exists, it checks `userMessages.length === 0` BEFORE appending, so it should work, but the check happens on stale state

### File/Line References

**Session Creation:**
- **Chat.tsx:836** - `ensureActiveChatId` creates session
- **Chat.tsx:599** - `handleCreatePerpDraftFromSpec` creates SECOND session
- **Chat.tsx:2299** - `handleConfirmTrade` creates session as fallback
- **Chat.tsx:2052** - `handleUpdateStrategy` creates session as fallback

**Message Append:**
- **Chat.tsx:934** - User message appended to `targetChatId`
- **Chat.tsx:599** - Draft card uses different `targetChatId` (may be different session)

**Title Update:**
- **Chat.tsx:926-931** - Title update uses stale `chatSessions` state

---

## Minimal Fix Plan

### Fix 1: updateMessageInChat

**Add to BlossomContext.tsx:**

1. **Define function (after `appendMessageToChat`, around line 730):**
   ```typescript
   const updateMessageInChat = useCallback(
     (chatId: string, messageId: string, updates: Partial<ChatMessage>) => {
       setChatSessions(prev => {
         const next = prev.map(session => {
           if (session.id === chatId) {
             return {
               ...session,
               messages: session.messages.map(msg =>
                 msg.id === messageId ? { ...msg, ...updates } : msg
               ),
             };
           }
           return session;
         });
         saveChatSessionsToStorage(next, chatId);
         return next;
       });
     },
     []
   );
   ```

2. **Add to interface (line 160, after `appendMessageToChat`):**
   ```typescript
   updateMessageInChat: (chatId: string, messageId: string, updates: Partial<ChatMessage>) => void;
   ```

3. **Add to provider value (line 1280, after `appendMessageToChat`):**
   ```typescript
   updateMessageInChat,
   ```

4. **Add defensive guard in Chat.tsx:2371:**
   ```typescript
   if (typeof updateMessageInChat === 'function') {
     updateMessageInChat(targetChatId, draftMessageId, messageWithoutRisk);
   } else if (import.meta.env.DEV) {
     console.error('[handleConfirmTrade] updateMessageInChat is not a function');
   }
   ```

### Fix 2: First Message Disappearing

**Single source of truth for targetChatId:**

1. **Pass targetChatId through call chain:**
   - `processUserMessage` computes `targetChatId` once (line 894)
   - Pass `targetChatId` to `handleCreatePerpDraftFromSpec` as parameter
   - Remove `createNewChatSession()` call from `handleCreatePerpDraftFromSpec` (line 599)

2. **Update handleCreatePerpDraftFromSpec signature (line 475):**
   ```typescript
   const handleCreatePerpDraftFromSpec = useCallback((
     spec: PerpCreateSpec,
     market: string,
     userText: string,
     messageKey: string,
     targetChatId: string, // ADD THIS
     extractedParams?: any,
     riskDetection?: { isHighRisk: boolean; reasons: string[]; extracted?: any }
   ): string | null => {
   ```

3. **Remove session creation from handleCreatePerpDraftFromSpec (line 599):**
   ```typescript
   // REMOVE: const targetChatId = activeChatId || createNewChatSession();
   // Use the passed targetChatId parameter instead
   ```

4. **Update all callers to pass targetChatId:**
   - Line 1488: `handleCreatePerpDraftFromSpec(spec, marketForStrategy, userText, messageKey, targetChatId, extractedParams, riskDetection)`
   - Line 2150: Similar update for `handleCreatePerpDraft`

5. **Fix title update to use functional state:**
   - Line 926: Use `setChatSessions(prev => { ... })` to get latest state
   - Or move title update to AFTER message append completes

6. **Fix handleConfirmTrade (line 2299):**
   - Should receive `targetChatId` from parent or compute once
   - Don't create new session as fallback

### Acceptance Tests

1. **First message persists:**
   - Clear storage → send first message → assert exactly 1 session → assert session has 1 user message → assert left panel title updates

2. **Confirm does not crash:**
   - Create draft → confirm → assert no runtime error → assert executed message updates properly

---

## Summary

**Part A Root Cause:** `updateMessageInChat` function is missing from BlossomContext definition, interface, and provider value.

**Part B Root Cause:** Multiple `createNewChatSession()` calls create race conditions where the user message goes to one session but the UI shows a different session. Title updates use stale state.

**Risk Level:** Medium - Both issues cause visible bugs but don't break core functionality.


