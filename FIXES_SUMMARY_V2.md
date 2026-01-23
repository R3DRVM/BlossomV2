# Fixes Summary - Chat Visibility & Prediction Market Stub Mode

## Part 1: Chat Text Visibility Fixes

### Files Changed
- `src/components/MessageBubble.tsx`

### Changes Made

#### 1. User Message Text (lines 142-147)
**Before:**
- Only inline style: `style={{ color: '#FFFFFF', opacity: 1 }}`
- No Tailwind classes for text color

**After:**
- Added explicit Tailwind classes: `text-white opacity-100`
- Kept inline style as backup: `style={{ color: '#FFFFFF', opacity: 1 }}`
- **Why**: Inline styles can be overridden by CSS specificity. Adding Tailwind classes ensures visibility even if parent containers have conflicting styles.

#### 2. Blossom Message Text (lines 142-147)
**Before:**
- Only inline style: `style={{ color: '#1E293B', opacity: 1 }}`
- No Tailwind classes for text color

**After:**
- Added explicit Tailwind classes: `text-slate-900 opacity-100`
- Kept inline style as backup: `style={{ color: '#1E293B', opacity: 1 }}`
- **Why**: Same reason - dual protection against CSS inheritance issues.

#### 3. "Confirm & Queue" Button Text (lines 270-275)
**Before:**
- Only inline style in enabled state: `style={{ color: '#FFFFFF', opacity: 1 }}`
- Only inline style in disabled state: `style={{ color: '#64748B', opacity: 1 }}`
- No Tailwind classes

**After:**
- Added explicit Tailwind classes:
  - Enabled: `text-white opacity-100`
  - Disabled: `text-slate-600 opacity-100`
- Kept inline styles as backup
- **Why**: Button text was invisible until hover. Explicit classes ensure visibility in all states.

### Classes Removed/Overridden
- None explicitly removed, but added explicit classes to override any potential parent container styles
- No `text-transparent`, `opacity-0`, or `group-hover:*` dependencies found

### Verification
- User messages: White text (`text-white`) on pink gradient background
- Blossom messages: Dark text (`text-slate-900`) on glass card background
- "Confirm & Queue" button: White text (`text-white`) on pink button, gray text (`text-slate-600`) when disabled

---

## Part 2: Prediction Market Stub Mode Short-Circuit

### Files Changed
- `agent/src/server/http.ts`
- `agent/src/utils/actionParser.ts`

### Changes Made

#### 1. Modified `buildBlossomPrompts()` Return Type
**File**: `agent/src/utils/actionParser.ts` (line 114)

**Before:**
```typescript
Promise<{ systemPrompt: string; userPrompt: string }>
```

**After:**
```typescript
Promise<{ systemPrompt: string; userPrompt: string; isPredictionMarketQuery: boolean }>
```

**Why**: Need to expose detection flag to HTTP handler for stub mode short-circuit.

#### 2. Added Detection Flag Calculation
**File**: `agent/src/utils/actionParser.ts` (lines 201-220)

- Moved detection logic to top of function (before venue-specific prompt building)
- Calculates `isPredictionMarketQuery` flag early
- Reuses same detection variables in venue-specific section

**Why**: Avoid code duplication and ensure consistent detection.

#### 3. Added `buildPredictionMarketResponse()` Function
**File**: `agent/src/utils/actionParser.ts` (lines 345-420)

**Purpose**: Builds deterministic response for prediction market queries in stub mode.

**Logic:**
1. Detects which platform (Kalshi/Polymarket) from user message
2. Fetches markets using existing helpers (`getTopKalshiMarketsByVolume()`, `getTopPolymarketMarketsByVolume()`)
3. Formats numbered list response with:
   - Market title
   - YES/NO probabilities
   - 24h volume
4. If user asks to "risk X%", creates event action with calculated stake
5. Returns `{ assistantMessage: string, actions: BlossomAction[] }` in same format as LLM response

**Why**: Stub LLM provider returns generic text. This bypasses LLM for prediction market queries and returns proper market lists.

#### 4. Modified HTTP Handler for Stub Mode Short-Circuit
**File**: `agent/src/server/http.ts` (lines 137-160)

**Before:**
- Always called `callLlm()` regardless of mode or query type

**After:**
- Checks if stub mode: `!process.env.BLOSSOM_MODEL_PROVIDER || process.env.BLOSSOM_MODEL_PROVIDER === 'stub' || (!process.env.BLOSSOM_OPENAI_API_KEY && !process.env.BLOSSOM_ANTHROPIC_API_KEY)`
- If stub mode AND `isPredictionMarketQuery === true`:
  - Calls `buildPredictionMarketResponse()` instead of `callLlm()`
  - Logs short-circuit action
- Otherwise: Normal LLM flow (stub or real)

**Why**: Ensures prediction market quick cards work correctly even without LLM API keys.

### Logging Added
- `[api/chat] Stub mode + prediction market query - building deterministic response`
- `[api/chat] Built stub prediction market response: { messageLength, actionCount }`
- `[prediction-stub] Fetching Kalshi/Polymarket markets for stub response`

### Response Format
The stub response matches the LLM response format:
```typescript
{
  assistantMessage: string,  // Numbered list of markets
  actions: BlossomAction[]    // Empty for discovery, event action for "risk X%" queries
}
```

This ensures the frontend doesn't need any changes - it receives the same shape regardless of stub vs real LLM.

---

## Verification Steps

### Part 1: Chat Visibility
1. Start frontend: `npm run dev` (or with `VITE_USE_AGENT_BACKEND=true`)
2. Send a message (e.g., click "Long ETH with 3% risk..." quick card)
3. Verify:
   - ✅ User message bubble shows white text on pink gradient
   - ✅ Blossom response shows dark text on glass card
   - ✅ "Confirm & Queue" button shows white text (not invisible)

### Part 2: Prediction Market Stub Mode
1. Start backend in stub mode (no `BLOSSOM_MODEL_PROVIDER` or API keys): `cd agent && npm run dev`
2. Start frontend with backend enabled: `VITE_USE_AGENT_BACKEND=true npm run dev`
3. Switch to "Event Markets" venue
4. Click "What are the top 5 prediction markets on Kalshi right now?"
5. Verify:
   - ✅ Backend logs show: `[api/chat] Stub mode + prediction market query - building deterministic response`
   - ✅ Response shows numbered list of Kalshi markets (from static fallback or live API if configured)
   - ✅ No generic "I can help with perps..." message
6. Click "What are the top 5 trending prediction markets on Polymarket?"
7. Verify:
   - ✅ Response shows numbered list of Polymarket markets
   - ✅ No generic perp advice

### Expected Backend Logs (Stub Mode)
```
[api/chat] Received request: { userMessage: 'What are the top 5 prediction markets on Kalshi right now?', venue: 'event_demo' }
[prediction] Detection: { isPredictionMarketQuery: true, ... }
[api/chat] Stub mode + prediction market query - building deterministic response
[prediction-stub] Fetching Kalshi markets for stub response
[PredictionData] Kalshi API not configured, using static fallback
[api/chat] Built stub prediction market response: { messageLength: 450, actionCount: 0 }
```

---

## Environment Variables

### For Stub Mode (Default)
- No env vars needed - works out of the box
- Uses static fallback markets from `predictionData.ts`

### For Live Prediction Markets (Optional)
- `KALSHI_API_URL` - Kalshi API endpoint
- `KALSHI_API_KEY` - Kalshi API key
- `POLYMARKET_API_URL` - Polymarket API endpoint

### For Live LLM (Optional)
- `BLOSSOM_MODEL_PROVIDER=openai` + `BLOSSOM_OPENAI_API_KEY=sk-...`
- OR `BLOSSOM_MODEL_PROVIDER=anthropic` + `BLOSSOM_ANTHROPIC_API_KEY=sk-ant-...`

**Note**: With live LLM, prediction market queries still go through the LLM (with market data in prompt). The stub short-circuit only applies when no LLM keys are configured.

---

## Summary

### Part 1: Text Visibility
- **Root Cause**: Inline styles alone weren't sufficient - needed explicit Tailwind classes
- **Solution**: Added `text-white opacity-100` / `text-slate-900 opacity-100` classes alongside inline styles
- **Result**: All text (user messages, Blossom messages, button labels) now visible without hover

### Part 2: Prediction Market Stub Mode
- **Root Cause**: Stub LLM provider returns generic text, doesn't understand prediction market queries
- **Solution**: Short-circuit stub LLM for prediction market queries, build deterministic response using market data helpers
- **Result**: Prediction market quick cards work correctly in stub mode, returning proper market lists

Both fixes maintain backward compatibility and don't break existing functionality.



