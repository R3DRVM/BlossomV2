# Debugging Summary - Chat Visibility & Prediction Markets

## Part 1: Text Visibility - Root Cause Analysis

### JSX Structure Analysis

**User Message Bubble:**
- Container: `rounded-3xl px-4 py-3 bg-gradient-to-br from-blossom-pink to-[#FF5A96] shadow-sm`
- Text element: `<p className="whitespace-pre-wrap m-0 chat-message-text-user">`
- CSS class: `.chat-message-text-user { color: #FFFFFF !important; opacity: 1 !important; }`

**Blossom Message Bubble:**
- Container: `rounded-3xl px-4 py-3 card-glass` (white/glass background)
- Text element: `<p className="whitespace-pre-wrap m-0 chat-message-text-assistant">`
- CSS class: `.chat-message-text-assistant { color: #1E293B !important; opacity: 1 !important; }`

**Confirm Button:**
- Button: `bg-blossom-pink hover:bg-[#FF5A96]`
- Span: `className="chat-button-text-enabled"` or `chat-button-text-disabled`
- CSS classes: `.chat-button-text-enabled { color: #FFFFFF !important; opacity: 1 !important; }`

### Root Cause Identified

The issue was CSS specificity conflicts. Tailwind classes like `text-white` and `text-slate-900` were being overridden by more specific selectors or parent container styles. The inline styles alone weren't sufficient because React doesn't support `!important` in style objects.

### Solution Applied

1. **Created dedicated CSS classes in `src/index.css`:**
   - `.chat-message-text-user` - Forces white text with `!important`
   - `.chat-message-text-assistant` - Forces dark text with `!important`
   - `.chat-button-text-enabled` - Forces white button text with `!important`
   - `.chat-button-text-disabled` - Forces gray button text with `!important`

2. **Updated `MessageBubble.tsx`:**
   - Removed conflicting Tailwind text color classes
   - Applied dedicated CSS classes that use `!important` to override any parent styles
   - Kept minimal inline styles for `fontWeight` only

### Why This Works

- CSS `!important` in a dedicated class file has higher specificity than inline styles or Tailwind utilities
- The classes are scoped to chat messages, avoiding conflicts with other UI elements
- No reliance on parent container styles or inheritance

---

## Part 2: Prediction Markets - Root Cause Analysis

### Frontend Mode Detection

**File:** `src/lib/config.ts`
- `USE_AGENT_BACKEND = import.meta.env.VITE_USE_AGENT_BACKEND === 'true'`
- **Default behavior:** If `VITE_USE_AGENT_BACKEND` is not set or not exactly `'true'`, it defaults to `false` (mock mode)

**File:** `src/components/Chat.tsx` (line 144)
- If `USE_AGENT_BACKEND === true`: Calls `callBlossomChat()` → backend `/api/chat`
- If `USE_AGENT_BACKEND === false`: Uses local `parseUserMessage()` and `generateBlossomResponse()` (mock mode)

### Backend Flow (When Enabled)

**File:** `agent/src/server/http.ts`
1. Receives request at `POST /api/chat`
2. Calls `buildBlossomPrompts()` which returns `isPredictionMarketQuery` flag
3. Checks stub mode: `provider === 'stub' || (!hasOpenAIKey && !hasAnthropicKey)`
4. If stub mode AND `isPredictionMarketQuery === true`:
   - Short-circuits to `buildPredictionMarketResponse()`
   - Returns numbered list of markets
5. Otherwise: Calls normal `callLlm()` path

### Root Cause Identified

**The app was running in mock mode by default** because:
- `VITE_USE_AGENT_BACKEND` was not set to `'true'`
- In mock mode, prediction market queries were handled by `generateBlossomResponse()` which returned generic perp advice
- The backend prediction-market logic never ran because requests never reached the backend

### Solution Applied

1. **Added logging to clarify mode:**
   - `[Chat] Using AGENT backend mode` - when backend is enabled
   - `[Chat] Using MOCK mode` - when mock mode is active

2. **Added mock mode fallback for prediction markets:**
   - Updated `generateBlossomResponse()` to detect prediction market queries
   - Returns numbered list of markets (mock data) when Kalshi/Polymarket queries are detected
   - Includes note that backend mode should be enabled for live data

3. **Backend logging already in place:**
   - `[api/chat] Stub mode check:` - Shows stub mode detection
   - `[prediction-detection]` - Shows detection results
   - `[api/chat] ✅ STUB SHORT-CIRCUIT:` - Shows when short-circuit runs

---

## Files Changed

### Part 1: Text Visibility
- `src/index.css` - Added CSS classes with `!important` for text visibility
- `src/components/MessageBubble.tsx` - Applied CSS classes, removed conflicting Tailwind classes

### Part 2: Prediction Markets
- `src/components/Chat.tsx` - Added logging for mode detection
- `src/lib/mockParser.ts` - Added prediction market detection and response in mock mode

---

## How to Verify

### Setup for Backend Mode (Prediction Markets)

1. **Create `.env` file in project root:**
   ```
   VITE_USE_AGENT_BACKEND=true
   VITE_AGENT_API_URL=http://localhost:3001
   ```

2. **Start backend:**
   ```bash
   cd agent
   npm run dev
   ```
   Backend runs on `http://localhost:3001` (stub mode by default, no LLM keys needed)

3. **Start frontend:**
   ```bash
   npm run dev
   ```

### Test 1: Chat Text Visibility

1. Navigate to Copilot view
2. Type "Test message" and press Send
3. **Verify:**
   - ✅ User message bubble shows white text on pink gradient (visible immediately)
   - ✅ Blossom response shows dark text on glass card (visible immediately)
   - ✅ If strategy card appears, "Confirm & Queue" button text is visible (no hover needed)

### Test 2: Prediction Markets (Backend Mode)

1. **Check frontend console:**
   - Should see: `[Chat] Using AGENT backend mode - request will go to backend`

2. Switch to "Event Markets" venue
3. Click: **"What are the top 5 prediction markets on Kalshi right now?"**

4. **Check backend terminal:**
   ```
   [api/chat] Received request: { userMessage: 'What are the top 5...', venue: 'event_demo' }
   [prediction-detection] { isPredictionMarketQuery: true, ... }
   [api/chat] Stub mode check: { isStubMode: true, isPredictionMarketQuery: true, ... }
   [api/chat] ✅ STUB SHORT-CIRCUIT: Building deterministic prediction market response
   [prediction-stub] Fetching Kalshi markets for stub response
   [api/chat] ✅ Stub response built: { preview: "Here are the top 5..." }
   ```

5. **Verify frontend:**
   - ✅ Response shows numbered list of Kalshi markets
   - ✅ No generic "I can help with perps..." message

### Test 3: Prediction Markets (Mock Mode)

1. **Remove or set `VITE_USE_AGENT_BACKEND=false`**

2. **Check frontend console:**
   - Should see: `[Chat] Using MOCK mode - request handled locally, backend not called`

3. Switch to "Event Markets" venue
4. Click: **"What are the top 5 prediction markets on Kalshi right now?"**

5. **Verify frontend:**
   - ✅ Response shows numbered list (mock data)
   - ✅ Includes note: "Note: This is mock data. Enable backend mode..."

---

## Environment Variables Summary

### For Backend Mode (Prediction Markets Work)
- `VITE_USE_AGENT_BACKEND=true` (required)
- `VITE_AGENT_API_URL=http://localhost:3001` (optional, defaults to localhost:3001)

### For Backend Stub Mode (No LLM Keys Needed)
- No backend env vars needed - stub mode is default
- Prediction markets use static fallback data

### For Live LLM (Optional)
- `BLOSSOM_MODEL_PROVIDER=openai` + `BLOSSOM_OPENAI_API_KEY=sk-...`
- OR `BLOSSOM_MODEL_PROVIDER=anthropic` + `BLOSSOM_ANTHROPIC_API_KEY=sk-ant-...`

---

## Summary

### Part 1: Text Visibility
- **Root Cause:** CSS specificity conflicts - Tailwind classes being overridden
- **Solution:** Dedicated CSS classes with `!important` to force visibility
- **Result:** All text (user, Blossom, buttons) now clearly visible

### Part 2: Prediction Markets
- **Root Cause:** App running in mock mode by default, backend never called
- **Solution:** Added logging + mock mode fallback for prediction markets
- **Result:** Prediction market queries work in both mock and backend modes



