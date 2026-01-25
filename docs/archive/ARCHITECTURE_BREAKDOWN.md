# BlossomV2 MVP Architecture Breakdown

## 1. Chat & Message Rendering

### Message Creation Flow

**Component**: `src/components/Chat.tsx`

- **User Message Creation** (lines 111-142):
  - `handleSend()` function creates user message when user types and hits Enter or clicks Send
  - User message object structure:
    ```typescript
    {
      id: `user-${Date.now()}-${random}`,
      text: userText.trim(),
      isUser: true,
      timestamp: formatted time string
    }
    ```
  - Message is appended to `messages` state array using `setMessages(prev => [...prev, userMessage])`
  - State is managed via `useState<Message[]>` with initial welcome message

- **Assistant Message Creation** (lines 224-234 for agent mode, 328-338 for mock mode):
  - After backend response or mock parsing, assistant message is created
  - Structure includes optional `strategy`, `strategyId`, `defiProposalId` props
  - Also appended to messages array (never replaces)

### Message Rendering

**Component**: `src/components/MessageBubble.tsx`

- **Rendering Logic** (lines 120-148):
  - Receives `isUser` prop to determine user vs assistant
  - Maps over `messages` array in `Chat.tsx` (line 371), passing each message to `MessageBubble`
  - Uses `key={msg.id}` for React reconciliation

- **User Message Styling** (lines 137-148):
  - **Container**: `bg-gradient-to-br from-blossom-pink to-[#FF5A96] shadow-sm` (pink gradient)
  - **Text**: Inline style `{ color: '#FFFFFF', opacity: 1 }` (white text, explicit opacity)
  - **Layout**: `flex-row-reverse` (right-aligned), `items-end` (right side)
  - **Avatar**: Pink circle with 👤 emoji

- **Blossom Message Styling** (lines 137-148):
  - **Container**: `card-glass` class (semi-transparent white with backdrop blur)
  - **Text**: Inline style `{ color: '#1E293B', opacity: 1 }` (dark text, explicit opacity)
  - **Layout**: `flex-row` (left-aligned), `items-start` (left side)
  - **Avatar**: White circle with BlossomLogo component

### Strategy Card & "Confirm & Queue" Button

**Component**: `src/components/MessageBubble.tsx` (lines 144-280)

- **Strategy Card Rendering**:
  - Only rendered when `!isUser && strategy` (line 149)
  - Uses `card-glass` class for background
  - Shows strategy details (market, side, risk, entry, TP/SL) or event details (stake, max payout, max loss)

- **"Confirm & Queue" Button** (lines 261-280):
  - **Location**: Inside strategy card, only shown when `isDraft && !isVeryHighRisk`
  - **Component**: Native `<button>` element (not a shared component)
  - **Styling**:
    - **Enabled state**: 
      - Classes: `bg-blossom-pink hover:bg-[#FF5A96] shadow-[0_10px_25px_rgba(255,107,160,0.35)]`
      - Inline style: `{ color: '#FFFFFF', opacity: 1 }` (white text, explicit opacity)
    - **Disabled state**:
      - Classes: `bg-blossom-outline/40 cursor-not-allowed`
      - Inline style: `{ color: '#64748B', opacity: 1 }` (gray text, explicit opacity)
  - **Behavior**: Calls `handleConfirmAndQueue()` which updates strategy status from 'draft' → 'queued' → 'executing' → 'executed'
  - **No hover-only text**: Text is always visible via inline styles with explicit opacity

### Text Visibility Notes

- **No CSS inheritance issues**: All text colors use inline `style` prop with explicit `opacity: 1`
- **No group-hover dependencies**: Button text is visible in normal state, hover only changes background shade
- **No text-transparent or opacity-0**: All text elements have explicit color and opacity values

---

## 2. Event Markets Data Flow

### Quick Card Definition

**Location**: `src/components/Chat.tsx` (lines 37-41)

```typescript
const QUICK_PROMPTS_EVENTS = [
  'What are the top 5 prediction markets on Kalshi right now?',
  'What are the top 5 trending prediction markets on Polymarket?',
  'Risk 2% of my account on the highest-volume prediction market.',
];
```

- Quick cards are conditionally rendered based on `venue` (line 401)
- When `venue === 'event_demo'`, `QUICK_PROMPTS_EVENTS` are shown
- When `venue === 'hyperliquid'`, `QUICK_PROMPTS_PERPS` are shown

### Venue Toggle

**Component**: `src/components/Header.tsx`

- Toggle buttons switch between `'hyperliquid'` and `'event_demo'`
- State managed in `BlossomContext` via `venue` and `setVenue`
- Venue is passed to backend in chat requests

### Complete Call Chain: Quick Card → Response

#### Step 1: User Clicks Quick Card
- **File**: `src/components/Chat.tsx`
- **Function**: `handleQuickPrompt(prompt: string)` (line 344)
- **Action**: Sets `inputValue` to the prompt text and focuses textarea
- User then clicks Send or hits Enter

#### Step 2: Frontend Sends Request
- **File**: `src/components/Chat.tsx`
- **Function**: `handleSend()` (line 111)
- **Flow**:
  1. Creates user message and appends to state
  2. If `USE_AGENT_BACKEND === true`:
     - Calls `callBlossomChat()` from `src/lib/blossomApi.ts` (line 147)
     - Passes: `{ userMessage, venue, clientPortfolio }`
  3. If `USE_AGENT_BACKEND === false`:
     - Uses local `parseUserMessage()` and `generateBlossomResponse()` (mock mode)

#### Step 3: API Client Layer
- **File**: `src/lib/blossomApi.ts`
- **Function**: `callBlossomChat()` (line 84)
- **Action**: 
  - Calls `callAgent('/api/chat', { method: 'POST', body: JSON.stringify(req) })`
  - `callAgent` is from `src/lib/apiClient.ts` which uses `VITE_AGENT_API_URL` (defaults to `http://localhost:3001`)

#### Step 4: Backend HTTP Handler
- **File**: `agent/src/server/http.ts`
- **Route**: `POST /api/chat` (line 118)
- **Flow**:
  1. Receives `{ userMessage, venue, clientPortfolio }`
  2. Logs request (line 127)
  3. Builds portfolio snapshot
  4. Calls `await buildBlossomPrompts({ userMessage, portfolio, venue })` (line 138)
  5. Calls LLM via `callLlm({ systemPrompt, userPrompt })` (line 149)
  6. Parses response and applies actions
  7. Returns `{ assistantMessage, actions, portfolio }`

#### Step 5: Prediction Market Detection
- **File**: `agent/src/utils/actionParser.ts`
- **Function**: `buildBlossomPrompts()` (line 114)
- **Detection Logic** (lines 207-224):
  - Only runs when `venue === 'event_demo'` (line 204)
  - Converts message to lowercase
  - Checks for keywords:
    - `hasKalshi`: message includes "kalshi"
    - `hasPolymarket`: message includes "polymarket"
    - `hasPredictionMarket`: message includes "prediction market" or "prediction markets"
    - `hasTop`: message includes "top" or "trending"
    - `hasHighestVolume`: message includes "highest" and ("volume" or "vol")
    - `hasRightNow`: message includes "right now"
  - **Detection Flags**:
    - `isAskingTopKalshi = hasKalshi && (hasTop || hasPredictionMarket || hasRightNow)`
    - `isAskingTopPolymarket = hasPolymarket && (hasTop || hasPredictionMarket || hasRightNow)`
    - `isAskingHighestVolume = hasHighestVolume && (hasKalshi || hasPolymarket || hasPredictionMarket)`
    - `isPredictionMarketQuery = isAskingTopKalshi || isAskingTopPolymarket || isAskingHighestVolume || (hasKalshi && hasPredictionMarket) || (hasPolymarket && hasPredictionMarket)`

#### Step 6: Market Data Fetching
- **File**: `agent/src/utils/actionParser.ts` (lines 239-263)
- **Functions Called** (from `agent/src/services/predictionData.ts`):
  - `getTopKalshiMarketsByVolume(5)` - if `isAskingTopKalshi || isAskingHighestVolume || (isPredictionMarketQuery && hasKalshi)`
  - `getTopPolymarketMarketsByVolume(5)` - if `isAskingTopPolymarket || isAskingHighestVolume || (isPredictionMarketQuery && hasPolymarket)`
  - `getHighestVolumeMarket()` - if `isAskingHighestVolume`
- **Data Structure Returned**:
  ```typescript
  RawPredictionMarket[] = [{
    id: string,
    title: string,
    source: 'KALSHI' | 'POLYMARKET',
    yesPrice: number,  // 0-1
    noPrice: number,   // 0-1
    volume24hUsd?: number,
    openInterestUsd?: number
  }]
  ```

#### Step 7: Data Fetching Implementation
- **File**: `agent/src/services/predictionData.ts`
- **Functions**:
  - `fetchKalshiMarkets()` (line 81): Checks `KALSHI_API_URL` and `KALSHI_API_KEY` env vars
    - If not set: returns `STATIC_KALSHI_MARKETS` (3 static markets)
    - If set: fetches from API, maps response, sorts by volume, returns top 15
  - `fetchPolymarketMarkets()` (line 179): Checks `POLYMARKET_API_URL` env var
    - If not set: returns `STATIC_POLYMARKET_MARKETS` (3 static markets)
    - If set: fetches from API, maps response, sorts by volume, returns top 15
  - `getTopKalshiMarketsByVolume(limit)` (line 272): Calls `fetchKalshiMarkets()`, sorts by volume, returns top N
  - `getTopPolymarketMarketsByVolume(limit)` (line 285): Calls `fetchPolymarketMarkets()`, sorts by volume, returns top N
  - `getHighestVolumeMarket()` (line 298): Fetches both, merges, sorts, returns single highest volume market

#### Step 8: Prompt Construction
- **File**: `agent/src/utils/actionParser.ts` (lines 267-332)
- **When `isPredictionMarketQuery === true`**:
  1. Adds `**PREDICTION MARKET DATA:**` section to userPrompt
  2. If `kalshiMarkets.length > 0`: Lists markets with format:
     ```
     1. "Market Title" - X% YES probability, $Yk 24h volume
     ```
  3. If `kalshiMarkets.length === 0` but query is about Kalshi: Adds static fallback data
  4. Same for Polymarket markets
  5. Adds `**CRITICAL - PREDICTION MARKET MODE ACTIVATED:**` section with:
     - Mandatory response format (numbered list)
     - Explicit prohibitions (no perps, no generic advice)
     - Example response format
     - "ABSOLUTELY FORBIDDEN" section

#### Step 9: LLM Call
- **File**: `agent/src/services/llmClient.ts` (called from `http.ts` line 149)
- **Function**: `callLlm({ systemPrompt, userPrompt })`
- **Returns**: `{ rawJson: string }` containing JSON with `{ assistantMessage: string, actions: BlossomAction[] }`

#### Step 10: Response Parsing & Action Application
- **File**: `agent/src/server/http.ts` (lines 151-174)
- **Flow**:
  1. Parses LLM JSON response via `parseModelResponse()`
  2. Validates actions via `validateActions()`
  3. Applies each action via `applyAction()`:
     - For `event` actions: calls `eventSim.openEventPosition(eventKey, side, stakeUsd, label)`
  4. Builds updated portfolio snapshot
  5. Returns `{ assistantMessage, actions, portfolio }`

#### Step 11: Event Sim Plugin
- **File**: `agent/src/plugins/event-sim/index.ts`
- **Function**: `openEventPosition()` (line 70)
- **Flow**:
  1. Looks for market in `SEEDED_MARKETS` by `eventKey`
  2. If not found, tries to find in live markets (fetches from `predictionData.ts`)
  3. If found in live markets, creates temporary market entry with:
     - `winProbability` calculated from `yesPrice` or `noPrice` based on side
     - `payoutMultiple = 1 / winProbability`
  4. Deducts stake from REDACTED balance
  5. Creates `EventPosition` with market source tracking (`KALSHI`, `POLYMARKET`, or `DEMO`)
  6. Returns position

#### Step 12: Frontend Receives Response
- **File**: `src/components/Chat.tsx` (lines 147-234)
- **Flow**:
  1. Receives `{ assistantMessage, actions, portfolio }`
  2. Updates portfolio state via `updateFromBackendPortfolio()`
  3. Finds matching strategy from portfolio
  4. Creates assistant message with strategy details
  5. Appends to messages array
  6. Renders via `MessageBubble` component

### Static Fallback Data

**File**: `agent/src/services/predictionData.ts` (lines 16-76)

- **Kalshi Static Markets**:
  - "Fed cuts in March 2025" (62% YES, $125k volume)
  - "BTC ETF approved by Dec 31" (68% YES, $280k volume)
  - "ETH ETF approved by June 2025" (58% YES, $95k volume)

- **Polymarket Static Markets**:
  - "US Election Winner 2024" (50% YES, $450k volume)
  - "Crypto market cap above $3T by year-end" (52% YES, $180k volume)
  - "ETH above $5k by year-end" (45% YES, $120k volume)

- **Seeded Markets in Event Sim**:
  - File: `agent/src/plugins/event-sim/index.ts` (lines 11-48)
  - Same market keys as static data, with `winProbability` and `payoutMultiple` values

---

## 3. Modes & Environment

### Frontend Modes

**Control**: `VITE_USE_AGENT_BACKEND` environment variable

- **Mock Mode** (default if `VITE_USE_AGENT_BACKEND` not set or `false`):
  - Uses `src/lib/mockParser.ts` for message parsing
  - All state managed locally in `BlossomContext`
  - No API calls to backend
  - Quick cards still work but use local parsing logic

- **Agent Mode** (when `VITE_USE_AGENT_BACKEND=true`):
  - Calls backend at `VITE_AGENT_API_URL` (defaults to `http://localhost:3001`)
  - Uses `src/lib/blossomApi.ts` → `src/lib/apiClient.ts` for HTTP requests
  - Portfolio state synced from backend responses
  - Requires backend server to be running

### Backend Modes

**Control**: LLM provider env vars + prediction market env vars

- **Stub Mode** (default if no LLM API keys):
  - `BLOSSOM_MODEL_PROVIDER` not set or set to `'stub'`
  - Returns canned responses but still processes requests
  - Still validates actions and applies them to sims
  - Prediction markets still work (uses static fallback)

- **Live LLM Mode**:
  - `BLOSSOM_MODEL_PROVIDER=openai` + `BLOSSOM_OPENAI_API_KEY=sk-...`
  - OR `BLOSSOM_MODEL_PROVIDER=anthropic` + `BLOSSOM_ANTHROPIC_API_KEY=sk-ant-...`
  - Makes real LLM API calls
  - Returns actual AI-generated responses

### Prediction Market Data Modes

**Control**: `KALSHI_API_URL`, `KALSHI_API_KEY`, `POLYMARKET_API_URL` environment variables

- **Static Fallback Mode** (default):
  - If `KALSHI_API_URL` or `KALSHI_API_KEY` not set → uses `STATIC_KALSHI_MARKETS`
  - If `POLYMARKET_API_URL` not set → uses `STATIC_POLYMARKET_MARKETS`
  - No errors thrown, graceful fallback
  - Functions in `predictionData.ts` log fallback usage

- **Live Kalshi Data**:
  - Requires: `KALSHI_API_URL` and `KALSHI_API_KEY` set
  - Fetches from Kalshi API, maps response, returns top markets by volume
  - Falls back to static if API call fails

- **Live Polymarket Data**:
  - Requires: `POLYMARKET_API_URL` set
  - Fetches from Polymarket API, maps response, returns top markets by volume
  - Falls back to static if API call fails

### Environment Variables Summary

**Frontend** (`.env` in root):
- `VITE_USE_AGENT_BACKEND` - Enable/disable backend mode (default: false/mock)
- `VITE_AGENT_API_URL` - Backend API base URL (default: `http://localhost:3001`)

**Backend** (`agent/.env`):
- `PORT` - Server port (default: 3001)
- `BLOSSOM_MODEL_PROVIDER` - `'openai'`, `'anthropic'`, or `'stub'` (default: stub)
- `BLOSSOM_OPENAI_API_KEY` - Required if using OpenAI
- `BLOSSOM_OPENAI_MODEL` - OpenAI model (default: `gpt-4o-mini`)
- `BLOSSOM_ANTHROPIC_API_KEY` - Required if using Anthropic
- `BLOSSOM_ANTHROPIC_MODEL` - Anthropic model (default: `claude-3-5-sonnet-20241022`)
- `KALSHI_API_URL` - Kalshi API endpoint (optional, defaults to static fallback)
- `KALSHI_API_KEY` - Kalshi API key (optional, defaults to static fallback)
- `POLYMARKET_API_URL` - Polymarket API endpoint (optional, defaults to static fallback)

### Mode Combinations

1. **Pure Mock**: Frontend mock mode + backend not running
   - All parsing local, no API calls

2. **Backend Stub**: Frontend agent mode + backend stub mode
   - Frontend calls backend, backend returns canned responses
   - Prediction markets use static fallback

3. **Live LLM + Static Markets**: Frontend agent mode + backend with LLM keys + no prediction market keys
   - Real AI responses, but prediction markets use static data

4. **Full Live**: Frontend agent mode + backend with LLM keys + prediction market API keys
   - Real AI responses + live Kalshi/Polymarket data

---

## Key Files Reference

### Frontend Chat Flow
- `src/components/Chat.tsx` - Main chat component, message state, send handler
- `src/components/MessageBubble.tsx` - Message rendering, strategy cards, Confirm button
- `src/lib/blossomApi.ts` - API client wrapper
- `src/lib/apiClient.ts` - HTTP client with base URL config
- `src/lib/config.ts` - Feature flags (`USE_AGENT_BACKEND`)
- `src/context/BlossomContext.tsx` - Global state (venue, messages, strategies)

### Backend Prediction Markets
- `agent/src/server/http.ts` - HTTP routes (`/api/chat`, `/api/ticker`)
- `agent/src/utils/actionParser.ts` - Prompt building, prediction market detection
- `agent/src/services/predictionData.ts` - Kalshi/Polymarket data fetching
- `agent/src/plugins/event-sim/index.ts` - Event position simulation
- `agent/src/services/llmClient.ts` - LLM API calls

### Configuration
- `QUICK_START.md` - Local development setup
- `DEPLOYMENT_CHECKLIST.md` - Environment variables and deployment
- `src/components/Header.tsx` - Venue toggle UI



