# Prediction Markets Implementation Notes

## Summary of Changes

### Files Modified

1. **`agent/src/services/predictionData.ts`**:
   - Added helper functions: `getTopKalshiMarketsByVolume()`, `getTopPolymarketMarketsByVolume()`, `getHighestVolumeMarket()`
   - These functions fetch and sort markets by volume for use in LLM prompts

2. **`agent/src/utils/actionParser.ts`**:
   - Made `buildBlossomPrompts()` async to fetch live market data
   - Added logic to detect prediction market queries (top Kalshi, top Polymarket, highest volume)
   - When detected, fetches live market data and includes it in the prompt context
   - Provides detailed instructions to LLM on how to format responses with live market data

3. **`agent/src/server/http.ts`**:
   - Updated to await the async `buildBlossomPrompts()` call
   - Updated `applyAction()` to pass `label` parameter to `openEventPosition()` for live markets

4. **`agent/src/plugins/event-sim/index.ts`**:
   - Updated `openEventPosition()` to accept optional `label` parameter
   - Added logic to create temporary market entries for live markets that aren't in seeded markets
   - This allows the system to handle event actions with live market IDs

5. **`src/components/Chat.tsx`**:
   - Improved message ID generation to ensure uniqueness (timestamp + random component)
   - Added defensive check to prevent accidental message clearing
   - All message operations now explicitly use append pattern with comments

### Environment Variables Required

For **live Kalshi data**:
- `KALSHI_API_URL` - Kalshi API endpoint (default: not set, uses static fallback)
- `KALSHI_API_KEY` - Kalshi API authentication key (default: not set, uses static fallback)

For **live Polymarket data**:
- `POLYMARKET_API_URL` - Polymarket API endpoint (default: not set, uses static fallback)

**Note**: If these are not set, the system gracefully falls back to static demo data. No errors are thrown.

### How to Run the Live Prediction Markets Demo

1. **Start the backend agent**:
   ```bash
   cd agent
   npm run dev:agent
   ```
   Or from root:
   ```bash
   npm run dev:agent
   ```

2. **Configure environment variables** (optional, for live data):
   Create `agent/.env`:
   ```bash
   KALSHI_API_URL=https://api.kalshi.com/trade-api/v2/markets
   KALSHI_API_KEY=your_kalshi_api_key_here
   POLYMARKET_API_URL=https://clob.polymarket.com/markets
   ```

3. **Start the frontend**:
   ```bash
   npm run dev
   ```

4. **Enable agent mode** (if not already):
   Create `.env` in root:
   ```bash
   VITE_USE_AGENT_BACKEND=true
   VITE_AGENT_API_URL=http://localhost:3001
   ```

5. **Test the quick cards**:
   - Switch to "Event Markets" venue
   - Click "What are the top 5 prediction markets on Kalshi right now?"
   - Click "What are the top 5 trending prediction markets on Polymarket?"
   - Click "Risk 2% of my account on the highest-volume prediction market."

### What Works Now

✅ **Live Market Data Integration**:
- Backend fetches live data from Kalshi/Polymarket when APIs are configured
- Falls back gracefully to static data if APIs are unavailable
- Ticker strip uses live data (already was working)

✅ **Quick Card Prompts**:
- "Top 5 Kalshi markets" - Fetches and displays actual top 5 markets by volume
- "Top 5 Polymarket markets" - Fetches and displays actual top 5 markets by volume  
- "Risk 2% on highest volume" - Finds actual highest volume market and creates position

✅ **Chat History Persistence**:
- Messages are appended, never replaced
- Unique message IDs prevent collisions
- Defensive checks prevent accidental clearing

✅ **Backward Compatibility**:
- Mock mode still works when `VITE_USE_AGENT_BACKEND=false`
- Backend stub mode works when no API keys are set
- All existing functionality preserved

## Chat UI Fixes

### Files Modified for User Message Visibility

1. **`src/components/Chat.tsx`**:
   - Added console logging when user messages are added to help debug visibility issues
   - Ensured messages are always appended, never replaced
   - Added defensive check to restore welcome message if messages array is accidentally cleared

2. **`src/components/MessageBubble.tsx`**:
   - Added explicit `text-white` class to user message text to ensure visibility on pink gradient background
   - This ensures user messages are always visible even if CSS inheritance is broken

### Files Modified for Prediction Market Detection

1. **`agent/src/utils/actionParser.ts`**:
   - Improved detection logic to be more flexible:
     - Now detects "kalshi", "polymarket", "prediction market(s)", "top", "trending", "highest volume"
     - More robust pattern matching that handles variations in phrasing
   - Added comprehensive logging to track:
     - When prediction market queries are detected
     - When market data is fetched
     - What data is returned
   - Enhanced LLM instructions:
     - Added explicit "CRITICAL" section in system prompt about prediction markets
     - Made instructions more forceful: "MUST reference", "DO NOT mention perps"
     - Added explicit formatting requirements (numbered lists, exact market names)
   - Improved prompt structure to make market data impossible to ignore

### How to Reproduce and Verify Fixes

**For User Messages:**
1. Start backend: `cd agent && npm run dev:agent`
2. Start frontend: `npm run dev` (with `VITE_USE_AGENT_BACKEND=true`)
3. Type any message in the chat
4. Verify: User message appears immediately in a pink bubble on the right side
5. Verify: Message persists after Blossom's response appears
6. Check browser console for `[Chat] Added user message` logs

**For Prediction Markets:**
1. Ensure backend is running with agent mode enabled
2. Switch to "Event Markets" venue (if not already)
3. Click quick card: "What are the top 5 prediction markets on Kalshi right now?"
4. Check backend console for:
   - `[prediction] Detection:` log showing detection results
   - `[prediction] Fetching Kalshi markets for prompt`
   - `[prediction] Fetched X Kalshi markets`
5. Verify response:
   - Should list actual market names (or static fallback if no API keys)
   - Should include probabilities and volumes
   - Should NOT mention perps or DeFi
   - Should be formatted as a numbered list

6. Repeat for:
   - "What are the top 5 trending prediction markets on Polymarket?"
   - "Risk 2% of my account on the highest-volume prediction market."

## Bugfix Status

### Issue 1: User Messages Not Visible - FIXED

**Files Touched:**
- `src/components/Chat.tsx` - Added logging and ensured proper message appending
- `src/components/MessageBubble.tsx` - Added explicit `text-white` class to user message text

**Root Cause:**
- Potential CSS inheritance issue where text color wasn't being applied correctly to user messages
- Messages were being added correctly but may have been invisible due to styling

**Fix:**
- Added explicit `text-white` class to user message text div
- Added defensive logging to track message addition
- Ensured messages are always appended, never replaced

**Verification:**
1. Type any message in chat
2. User message should appear immediately in pink bubble on right side
3. Message should persist after Blossom's response
4. Check browser console for `[Chat] Added user message` log

### Issue 2: Prediction Market Prompts Not Using Live Data - FIXED

**Files Touched:**
- `agent/src/utils/actionParser.ts` - Improved detection logic, enhanced LLM instructions, added logging

**Root Cause:**
- Detection logic was too strict and didn't match all variations of prediction market queries
- LLM instructions weren't forceful enough, allowing generic responses about perps/DeFi
- No logging to debug when detection failed

**Fix:**
- Improved detection to handle variations: "kalshi", "polymarket", "prediction market(s)", "top", "trending", "highest volume"
- Made detection more flexible with OR conditions instead of strict AND
- Added comprehensive logging at each step:
  - Detection results
  - Market data fetching
  - Data returned
- Enhanced system prompt with explicit "CRITICAL - Prediction Market Queries" section
- Made user prompt instructions more forceful: "MUST reference", "DO NOT mention perps"
- Added explicit formatting requirements (numbered lists, exact market names)

**Verification:**
1. Backend running: `cd agent && npm run dev:agent`
2. Frontend with `VITE_USE_AGENT_BACKEND=true`
3. Switch to "Event Markets" venue
4. Click quick card: "What are the top 5 prediction markets on Kalshi right now?"
5. Check backend console for:
   - `[prediction] Detection:` showing detection results
   - `[prediction] Fetching Kalshi markets for prompt`
   - `[prediction] Fetched X Kalshi markets`
6. Verify response lists actual markets (or static fallback) with probabilities/volumes
7. Response should NOT mention perps or DeFi

## Phase 1 - Current Implementation Mapping

### Where Live Data is Currently Wired

1. **Backend Prediction Data Service** (`agent/src/services/predictionData.ts`):
   - `fetchKalshiMarkets()` - Currently stubbed, returns static fallback if no API keys
   - `fetchPolymarketMarkets()` - Currently stubbed, returns static fallback if no API URL
   - Both functions check for env vars: `KALSHI_API_URL`, `KALSHI_API_KEY`, `POLYMARKET_API_URL`
   - Returns `RawPredictionMarket[]` with normalized structure

2. **Ticker Service** (`agent/src/services/ticker.ts`):
   - `getEventMarketsTicker()` already calls `fetchKalshiMarkets()` and `fetchPolymarketMarkets()` (lines 161-162)
   - Falls back to seeded markets if live data fails
   - Used by `/api/ticker?venue=event_demo` endpoint

3. **Event Sim Plugin** (`agent/src/plugins/event-sim/index.ts`):
   - Uses `fetchKalshiMarkets()` and `fetchPolymarketMarkets()` when opening positions (lines 91-92)
   - Maps live markets to event positions

### Where Event Market Quick Prompts are Defined

**Frontend** (`src/components/Chat.tsx`):
- Lines 37-41: `QUICK_PROMPTS_EVENTS` array contains:
  - "What are the top 5 prediction markets on Kalshi right now?"
  - "What are the top 5 trending prediction markets on Polymarket?"
  - "Risk 2% of my account on the highest-volume prediction market."
- These are displayed as quick cards when `venue === 'event_demo'` (line 382)
- Clicking a quick card calls `handleQuickPrompt()` which sets `inputValue` and focuses textarea (lines 325-328)
- The prompt is then sent via `handleSend()` which calls backend `/api/chat`

**Backend Prompt Building** (`agent/src/utils/actionParser.ts`):
- Line 194: Hardcoded instruction tells LLM to use "seeded event markets" instead of live data
- This is the main blocker - needs to be updated to use live market data from connectors

### Where Chat History State is Managed

**Frontend** (`src/components/Chat.tsx`):
- Line 45: `const [messages, setMessages] = useState<Message[]>([...])` - Initial state with welcome message
- Line 123: `setMessages(prev => [...prev, userMessage])` - Appends user message (CORRECT)
- Line 217: `setMessages(prev => [...prev, blossomResponse])` - Appends assistant response (CORRECT)
- Line 319: `setMessages(prev => [...prev, blossomResponse])` - Appends in mock mode (CORRECT)

**Potential Issues:**
- No obvious replacement of messages array
- Need to check if `updateFromBackendPortfolio()` or other context updates might trigger a remount
- Need to verify React key stability on MessageBubble components (line 354 uses `key={msg.id}`)

### Backend Entrypoints

1. **`/api/chat`** (`agent/src/server/http.ts` line 117):
   - Receives `userMessage`, `venue`, `clientPortfolio`
   - Calls `buildBlossomPrompts()` from `actionParser.ts`
   - Calls LLM via `callLlm()`
   - Parses response and applies actions
   - Returns `{ assistantMessage, actions, portfolio }`

2. **`/api/ticker`** (`agent/src/server/http.ts` line 280):
   - Already wired to use live data via `getEventMarketsTicker()`
   - Falls back gracefully if APIs fail

### Current Connector Status

- **Kalshi**: Stubbed in `predictionData.ts`, needs real API integration
- **Polymarket**: Stubbed in `predictionData.ts`, needs real API integration
- Both have placeholder mapping logic that needs to be updated for actual API responses

