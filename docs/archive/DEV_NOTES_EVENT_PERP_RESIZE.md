# Event/Perp Resize Modification Flow

## Implementation Summary

### Latest Changes (Event Modification Fix)

**Problem**: Event modifications like "let's change this to 2k" were not being detected correctly, and the 3% cap was still being applied.

**Solution**:
1. Made modification detection more aggressive by detecting phrases like "change", "make it", "bump", "set", "increase", "decrease", "adjust", "update", "modify", "resize"
2. For modification phrases, always set `overrideRiskCap = true` (modifications are explicit user requests)
3. Removed 3% cap logic from `modify_event_strategy` handler - modifications always respect the requested stake (capped only at account value)
4. Added debug logging to track intent classification

**Key Changes**:
- `parseEventModificationFromText()` now detects modification phrases and always sets `overrideRiskCap = true` for them
- `parseUserMessage()` checks for existing events and modification phrases before creating new events
- `Chat.tsx` `modify_event_strategy` handler no longer applies 3% cap - only caps at account value/available cash

### Files Modified
1. **`src/lib/mockParser.ts`**
   - Added `findActiveEventStrategyForEdit()` helper (mirrors `findActivePerpStrategyForEdit`)
   - Added `parseEventModificationFromText()` helper to extract stake amount and detect override intent
   - Added `introducesNewEventTopic()` helper to distinguish new events from modifications
   - Added `modify_event_strategy` intent type and `modifyEventStrategy` field to `ParsedMessage`
   - Updated `parseUserMessage()` to detect event modifications before creating new events
   - Updated `generateBlossomResponse()` to handle `modify_event_strategy` intent
   - Updated debug harness with event modification test cases

2. **`src/components/Chat.tsx`**
   - Updated `parseUserMessage()` call to pass `accountValue`
   - Added handler for `modify_event_strategy` intent (similar to perp modifications)
   - Updated skip logic to handle both `modify_perp_strategy` and `modify_event_strategy`

3. **`DEV_NOTES_EVENT_PERP_RESIZE.md`** (this file)
   - Documentation of the implementation

### How Event Modification Parallels Perp Modification

**Parsing Layer:**
- **Perp**: `parseModificationFromText()` → `findActivePerpStrategyForEdit()` → returns `modify_perp_strategy`
- **Event**: `parseEventModificationFromText()` → `findActiveEventStrategyForEdit()` → returns `modify_event_strategy`

**Application Layer:**
- **Perp**: Finds target strategy → builds updates → calls `updateStrategy()` → generates response
- **Event**: Finds target strategy → builds updates → calls `updateEventStake()` → generates response

**Key Differences:**
- Events use `stakeUsd` instead of `notionalUsd`
- Events have `overrideRiskCap` flag to bypass 3% cap when user insists
- Events preserve `eventKey`, `eventLabel`, `eventSide` (market identity)

### Override Detection Heuristics

The `parseEventModificationFromText()` function uses the following regex patterns to detect "insisting" phrases:

```typescript
const overridePhrases = [
  /\bstick\s+to\b/i,           // "stick to 500"
  /\bfull\b/i,                 // "full 500", "do the full 500"
  /\binstead\b/i,               // "make it 1000 instead"
  /\bi'?m\s+ok\s+taking\s+more\s+risk\b/i,  // "I'm ok taking more risk"
  /\boverride\b/i,              // "override the cap"
  /\bignore\s+the\s+cap\b/i,    // "ignore the cap"
  /\bno\s+cap\b/i,              // "no cap"
  /\bdo\s+the\s+full\b/i,       // "do the full 500"
  /\buse\s+the\s+full\b/i,      // "use the full 500"
];
```

**Override Logic:**
- If `userIsInsisting === true` AND `newStakeUsd > maxRecommendedStake` (3% of account)
- Then `overrideRiskCap = true`
- When `overrideRiskCap === true`, the stake is set to `requestedStake` (capped only at account value for safety)
- When `overrideRiskCap === false`, the stake is capped at 3% of account value

**Stake Parsing:**
- Dollar format: `$500`, `$1,500`
- K format: `500k`, `1.5k`
- Plain numbers: `500`, `1000` (must be 100-100000 range)

## Perp Modification Flow (Current Implementation)

### Parsing Layer (`src/lib/mockParser.ts`)

1. **`parseModificationFromText(text: string)`**
   - Extracts modification intent from user text
   - Returns `StrategyModification` with optional fields:
     - `sizeUsd?: number` (e.g., "2k", "$1,500", "2000")
     - `riskPercent?: number` (e.g., "2% risk", "risk 1.5%")
     - `leverage?: number` (e.g., "2x leverage", "make it 3x")
     - `side?: 'Long' | 'Short'` (e.g., "flip short", "go long instead")

2. **`findActivePerpStrategyForEdit(strategies, selectedStrategyId)`**
   - First checks if `selectedStrategyId` refers to a perp strategy
   - Falls back to most recent perp strategy (draft/queued/executed/executing, not closed)
   - Returns `{ id: string } | null`

3. **`parseUserMessage()` - Modification Detection**
   - Calls `parseModificationFromText()` to extract modifications
   - If modifications found AND strategies available:
     - Calls `findActivePerpStrategyForEdit()` to find target
     - If target found, returns:
       ```typescript
       {
         intent: 'modify_perp_strategy',
         modifyPerpStrategy: {
           strategyId: activeStrategy.id,
           modification: StrategyModification
         }
       }
       ```

### Application Layer (`src/components/Chat.tsx`)

1. **Handles `modify_perp_strategy` intent**
   - Finds target strategy by ID
   - Builds update object:
     - If `sizeUsd` provided → updates `notionalUsd`, recalculates `riskPercent`
     - If `riskPercent` provided → updates `riskPercent`, recalculates `notionalUsd`
     - If `leverage` provided → updates risk (informational)
     - If `side` provided → updates side, recalculates TP/SL
   - Calls `updateStrategy(strategyId, updates)` from context
   - Generates response with updated strategy card

2. **Context Update (`src/context/BlossomContext.tsx`)**
   - `updateStrategy(id, updates)` applies partial updates to strategy
   - Recomputes account if risk/size changed

## Event Modification Flow (To Be Implemented)

### Required Changes

1. **Add `findActiveEventStrategyForEdit()` helper** (mirror of perp version)
   - Check `selectedStrategyId` for event strategy
   - Fall back to most recent event strategy (draft/queued/executed/executing, not closed)

2. **Add `parseEventModificationFromText()` helper**
   - Extract stake amount (similar to `sizeUsd` parsing)
   - Extract risk percentage
   - Detect "override" intent (e.g., "stick to 500", "full 500", "make it 1000 instead")

3. **Add `modify_event_strategy` intent** to `ParsedIntent` type
   - Structure similar to `modifyPerpStrategy`:
     ```typescript
     modifyEventStrategy?: {
       strategyId?: string;
       newStakeUsd?: number;
       overrideRiskCap: boolean;
     }
     ```

4. **Update `parseUserMessage()` event branch**
   - After detecting event domain, check if:
     - There's an existing event draft/strategy
     - User message contains amount but no new event topic
     - If yes → return `modify_event_strategy` instead of new event

5. **Add handling in `Chat.tsx`**
   - Similar to perp modification:
     - Find target event strategy
     - Update stake, maxLoss, maxPayout, riskPercent
     - Call `updateEventStake()` or `updateStrategy()`
     - Generate response with updated event card

6. **Override Logic**
   - Detect "insisting" phrases: "stick to", "full", "instead", "i'm ok taking more risk", "override"
   - When `overrideRiskCap: true`, do not re-apply 3% cap
   - Show warning in response but honor the override

