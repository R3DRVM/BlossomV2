# Event Modification Fix Summary

## Changes Made

### Files Modified

1. **`src/lib/mockParser.ts`**
   - Enhanced `parseEventModificationFromText()` to detect modification phrases: `change`, `make`, `bump`, `set`, `increase`, `decrease`, `adjust`, `update`, `modify`, `resize`
   - For modification phrases, always set `overrideRiskCap = true` (modifications are explicit user requests)
   - Updated `parseUserMessage()` to check for existing events and modification phrases before creating new events
   - Added debug logging for both event creation and modification intents

2. **`src/components/Chat.tsx`**
   - Removed 3% cap logic from `modify_event_strategy` handler
   - Modifications now only cap at account value / available cash (no 3% limit)
   - Always set `overrideRiskCap = true` for modifications
   - Updated response messages to warn about risk when exceeding 3% but still honor the request

3. **`DEV_NOTES_EVENT_PERP_RESIZE.md`**
   - Updated documentation with latest changes

## Key Logic Changes

### Modification Detection
- **Before**: Only detected modifications if user had "insisting" phrases AND stake > 3% cap
- **After**: Detects modifications if message contains modification phrases (`change`, `make it`, `bump`, etc.) OR has existing event + stake amount

### 3% Cap Application
- **Before**: Applied 3% cap even for modifications unless `overrideRiskCap = true` (which required "insisting" phrases)
- **After**: Modifications always bypass 3% cap - only capped at account value/available cash

### Override Logic
- **Before**: `overrideRiskCap = true` only if user "insisted" (specific phrases) AND stake > 3%
- **After**: `overrideRiskCap = true` for ALL modification phrases, regardless of stake amount

## Expected Debug Output

When running the test sequence in dev mode (with debug harness uncommented), you should see:

```
[event-debug] Starting test sequence...

[debug-event-intent] {
  raw: "take 500 on no for fed cuts in march",
  domain: "event",
  action: "event",
  eventKey: "FED_CUTS_MAR_2025",
  stakeUsd: 500,
  overrideRiskCap: false
}

[event-debug] {
  label: "1. New event (capped)",
  domain: "event",
  action: "event",
  eventKey: "FED_CUTS_MAR_2025",
  stakeUsd: 500,
  overrideRiskCap: false
}

[debug-event-intent] {
  raw: "let's change this to 2k",
  domain: null,
  action: "modify_event_strategy",
  eventKey: "FED_CUTS_MAR_2025",
  stakeUsd: 2000,
  overrideRiskCap: true,
  isModificationPhrase: true,
  isEventDomain: false,
  isAmbiguousButNotNewEvent: true
}

[event-debug] {
  label: "2. Resize same event (should NOT cap; stake = 2000)",
  domain: null,
  action: "modify_event_strategy",
  eventKey: "event-1",
  stakeUsd: 2000,
  overrideRiskCap: true
}

[debug-event-intent] {
  raw: "make it 2000 instead",
  domain: null,
  action: "modify_event_strategy",
  eventKey: "FED_CUTS_MAR_2025",
  stakeUsd: 2000,
  overrideRiskCap: true,
  isModificationPhrase: true,
  isEventDomain: false,
  isAmbiguousButNotNewEvent: true
}

[event-debug] {
  label: "3. Resize same event (make it 2000)",
  domain: null,
  action: "modify_event_strategy",
  eventKey: "event-1",
  stakeUsd: 2000,
  overrideRiskCap: true
}

[debug-event-intent] {
  raw: "bump this to 1500",
  domain: null,
  action: "modify_event_strategy",
  eventKey: "FED_CUTS_MAR_2025",
  stakeUsd: 1500,
  overrideRiskCap: true,
  isModificationPhrase: true,
  isEventDomain: false,
  isAmbiguousButNotNewEvent: true
}

[event-debug] {
  label: "4. Resize same event (bump to 1500)",
  domain: null,
  action: "modify_event_strategy",
  eventKey: "event-1",
  stakeUsd: 1500,
  overrideRiskCap: true
}

[debug-event-intent] {
  raw: "ok now take 200 on yes for us election winner 2024",
  domain: "event",
  action: "event",
  eventKey: "US_ELECTION_2024",
  stakeUsd: 200,
  overrideRiskCap: false
}

[event-debug] {
  label: "5. New unrelated event",
  domain: "event",
  action: "event",
  eventKey: "US_ELECTION_2024",
  stakeUsd: 200,
  overrideRiskCap: false
}

[event-debug] Test sequence complete.
```

## Test Cases

### 1. New Event (Capped)
**Input**: `take 500 on no for fed cuts in march`
**Expected**:
- Intent: `event`
- EventKey: `FED_CUTS_MAR_2025`
- Stake: Capped at $300 (3% of $10k account)
- Response: "I've capped this at $300 to keep risk at 3%..."

### 2. Resize Same Event
**Input**: `let's change this to 2k`
**Expected**:
- Intent: `modify_event_strategy`
- EventKey: `FED_CUTS_MAR_2025` (same as original)
- Stake: $2000 (NOT capped at 3%)
- OverrideRiskCap: `true`
- Response: "I've updated the stake to $2,000 (20.0% of your $10,000 account). ⚠️ Note: This raises your per-strategy risk to 20.0%..."

### 3. Resize Same Event (Alternative Phrase)
**Input**: `make it 2000 instead`
**Expected**:
- Intent: `modify_event_strategy`
- EventKey: `FED_CUTS_MAR_2025` (same as original)
- Stake: $2000 (NOT capped)
- OverrideRiskCap: `true`

### 4. Resize Same Event (Bump)
**Input**: `bump this to 1500`
**Expected**:
- Intent: `modify_event_strategy`
- EventKey: `FED_CUTS_MAR_2025` (same as original)
- Stake: $1500 (NOT capped)
- OverrideRiskCap: `true`

### 5. New Unrelated Event
**Input**: `ok now take 200 on yes for us election winner 2024`
**Expected**:
- Intent: `event` (new event, not modification)
- EventKey: `US_ELECTION_2024` (different from original)
- Stake: Capped at $300 (3% of $10k account)
- Response: "I've capped this at $300 to keep risk at 3%..."

## UX Copy Behavior

### A. New Event Drafts (create_event_strategy)

**When user asks for more than 3% (capped):**
```
You asked to stake $500. To stay within your risk settings, I've capped this at $300.

I've set your stake to $300, which is about 3.0% of your $10,000 account.

This follows your usual 3% per-event risk guideline so a single outcome doesn't dominate your portfolio. Your max loss on this trade is $300.
```

**When user asks for ≤3% or no specific amount:**
```
I've set your stake to $300, which is about 3.0% of your $10,000 account.

This follows your usual 3% per-event risk guideline so a single outcome doesn't dominate your portfolio. Your max loss on this trade is $300.
```

### B. Event Modifications (modify_event_strategy) - Stake ≤ 3%

**When new stake is ≤ 3% of account:**
```
I've updated the stake to $250, which is about 2.5% of your $10,000 account. Your max loss on this trade is $250.
```

### C. Event Modifications (modify_event_strategy) - Stake > 3%

**When new stake is > 3% of account:**
```
I've updated the stake to $750, which is about 7.5% of your $10,000 account.

This is above your usual 3% per-event risk guideline, so make sure you're comfortable with this level of drawdown — your max loss on this trade is $750.
```

**Key Points:**
- New events: Always mention the 3% guideline and explain capping when applicable
- Modifications: Never mention "capping" - modifications are explicit overrides
- Modifications >3%: Include a calm warning about exceeding the guideline
- All responses use consistent formatting: `formatUsd()` and `formatRiskPct()` helpers

## Verification Checklist

- ✅ Modification phrases detected: `change`, `make`, `bump`, `set`, `increase`, `decrease`, `adjust`, `update`, `modify`, `resize`
- ✅ Modifications always set `overrideRiskCap = true`
- ✅ 3% cap removed from modification handler
- ✅ Modifications only capped at account value/available cash
- ✅ Debug logging added for both creation and modification paths
- ✅ Test cases documented in debug harness
- ✅ UX copy updated for all three cases (new event capped, modification ≤3%, modification >3%)
- ✅ Helper functions added: `formatUsd()` and `formatRiskPct()`
- ✅ TypeScript build passes
- ✅ No linter errors

