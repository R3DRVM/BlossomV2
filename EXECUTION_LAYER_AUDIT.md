# Execution Layer Architecture Audit

## Executive Summary

Blossom's execution layer is a **simulation-first architecture** designed for investor demos, with clear separation between planning (frontend parser/LLM), execution simulation (backend plugins), and UI presentation. The system supports three venues: perpetual swaps (Hyperliquid), event markets (Polymarket/Kalshi), and DeFi yield (protocols). All execution is currently **simulated** via in-memory state machines; no on-chain transactions occur. The architecture is well-positioned for incremental real execution integration through formalized interfaces (Planner, Executor, VenueAdapter, QuoteProvider) that can be implemented without touching existing simulation logic.

**Key Findings:**
- **Frontend**: React-based chat interface with rule-based parser (`mockParser.ts`) that can be replaced with Gemini
- **Backend**: Express server with three simulation plugins (perps, defi, event) that maintain in-memory state
- **Execution Flow**: User message → parse intent → create draft → confirm → simulate execution → update UI
- **AI Integration**: Currently uses stub/OpenAI/Anthropic via `agent/src/services/llmClient.ts`; Gemini can plug in at the same point
- **Security**: No wallet/signing logic exists; all secrets are environment variables (API keys only)
- **Data Sources**: Live prices (CoinGecko), event markets (Polymarket Gamma API), DeFi protocols (DefiLlama)

---

## A. High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React)                         │
├─────────────────────────────────────────────────────────────────┤
│  Chat.tsx (processUserMessage)                                  │
│    ↓                                                             │
│  mockParser.ts (parseUserMessage) OR                           │
│  blossomApi.ts → POST /api/chat (if USE_AGENT_BACKEND=true)    │
│    ↓                                                             │
│  BlossomContext.tsx (addDraftStrategy / createDefiPlan)        │
│    ↓                                                             │
│  MessageBubble.tsx (render draft card)                          │
│    ↓                                                             │
│  ConfirmTradeCard.tsx / handleConfirmTrade()                    │
│    ↓                                                             │
│  updateStrategyStatus('executed') → UI updates                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ (if USE_AGENT_BACKEND=true)
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND (Express Server)                      │
├─────────────────────────────────────────────────────────────────┤
│  agent/src/server/http.ts                                       │
│    POST /api/chat                                                │
│      ↓                                                           │
│    buildBlossomPrompts() → callLlm()                            │
│      ↓                                                           │
│    validateActions() → applyAction()                            │
│      ↓                                                           │
│    perps-sim / defi-sim / event-sim plugins                     │
│      ↓                                                           │
│    buildPortfolioSnapshot() → return to frontend                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    DATA SOURCES (External)                      │
├─────────────────────────────────────────────────────────────────┤
│  • CoinGecko (spot prices) → src/lib/demoPriceFeed.ts           │
│  • Polymarket Gamma API → src/lib/polymarket.ts                 │
│  • DefiLlama → src/lib/defiProtocols.ts                         │
│  • Agent backend prices → agent/src/services/prices.ts          │
└─────────────────────────────────────────────────────────────────┘
```

**Current Execution Modes:**
1. **Mock Mode** (`USE_AGENT_BACKEND=false`): Frontend-only, uses `mockParser.ts` for intent detection, creates drafts in-memory
2. **Agent Mode** (`USE_AGENT_BACKEND=true`): Frontend calls backend `/api/chat`, backend uses LLM (OpenAI/Anthropic/stub), returns actions + portfolio

---

## B. Concrete File Map + Key Functions + Data Types

### Frontend Core Files

| File | Key Functions | Data Types |
|------|---------------|------------|
| `src/components/Chat.tsx` | `processUserMessage()` (line 856), `handleConfirmTrade()` (line 2306), `handleCreatePerpDraftFromSpec()` (line 475) | `ChatMessage`, `ParsedMessage` |
| `src/context/BlossomContext.tsx` | `addDraftStrategy()` (line 139), `createDefiPlanFromCommand()` (line 962), `updateStrategyStatus()` (line 140) | `Strategy`, `DefiPosition`, `ChatSession` |
| `src/lib/mockParser.ts` | `parseUserMessage()` (line 1136), `determineIntentStrictV2()` (line 1434) | `ParsedIntent`, `ParsedStrategy`, `ParsedEventStrategy` |
| `src/components/MessageBubble.tsx` | `handleConfirmAndQueue()` (line 231) | Renders draft/executed cards |
| `src/components/ConfirmTradeCard.tsx` | `onConfirm()` callback | Displays confirmation UI |
| `src/components/ExecutionDetailsDisclosure.tsx` | Renders routing/sizing/risk details | `Strategy`, `DefiPosition` |
| `src/lib/blossomApi.ts` | `callBlossomChat()` (line 84) | `ChatRequest`, `ChatResponse` |
| `src/lib/config.ts` | `USE_AGENT_BACKEND` flag (line 5) | Environment-based config |

### Backend Core Files

| File | Key Functions | Data Types |
|------|---------------|------------|
| `agent/src/server/http.ts` | `POST /api/chat` (line 160), `applyAction()` (line 45), `buildPortfolioSnapshot()` (line 38) | `BlossomAction`, `BlossomPortfolioSnapshot` |
| `agent/src/utils/actionParser.ts` | `validateActions()` (line 13), `buildBlossomPrompts()` (line 146) | `BlossomAction[]` |
| `agent/src/services/llmClient.ts` | `callLlm()` (line 32), `callOpenAI()`, `callAnthropic()` | `LlmChatInput`, `LlmChatOutput` |
| `agent/src/plugins/perps-sim/index.ts` | `openPerp()` (line 35), `closePerp()` (line 93) | `PerpPosition`, `PerpsAccountState` |
| `agent/src/plugins/defi-sim/index.ts` | `openDefiPosition()`, `closeDefiPosition()` | `DefiPosition`, `DefiAccountState` |
| `agent/src/plugins/event-sim/index.ts` | `openEventPosition()`, `closeEventPosition()` | `EventPosition`, `EventAccountState` |
| `agent/src/services/state.ts` | `getPortfolioSnapshot()` (line 23), `resetAllSims()` (line 14) | `BlossomPortfolioSnapshot` |
| `agent/src/services/prices.ts` | `getPrice()` | `PriceSnapshot` |
| `agent/src/services/ticker.ts` | `getOnchainTicker()`, `getEventMarketsTicker()` | `TickerPayload` |

### Data Source Files

| File | Key Functions | Data Types |
|------|---------------|------------|
| `src/lib/demoPriceFeed.ts` | `getDemoSpotPrices()` | `DemoPriceSnapshot`, `DemoSymbol` |
| `src/lib/polymarket.ts` | `getTopPolymarketMarkets()` | `PolymarketMarket` |
| `src/lib/defiProtocols.ts` | `getTopDefiProtocolsByTvl()` | `DefiProtocolListItem` |
| `src/lib/eventMarkets.ts` | `getTopEventMarkets()` | `EventMarket`, `MarketListItem` |
| `src/lib/liveSpot.ts` | `getCachedLiveTicker()`, `getLiveSpotForMarket()` | Price cache utilities |

### Key Data Types

**Frontend:**
- `Strategy` (`src/context/BlossomContext.tsx:8-39`): Core strategy object with `id`, `market`, `side`, `riskPercent`, `status`, `instrumentType`, etc.
- `DefiPosition` (`src/context/BlossomContext.tsx:61-70`): DeFi position with `protocol`, `asset`, `depositUsd`, `apyPct`
- `ChatMessage` (`src/context/BlossomContext.tsx:101-127`): Chat message with optional `strategyId`, `defiProposalId`, `marketsList`, `defiProtocolsList`
- `ParsedMessage` (`src/lib/mockParser.ts:34-54`): Parsed intent with `strategy`, `eventStrategy`, `modifyPerpStrategy`, etc.

**Backend:**
- `BlossomAction` (`agent/src/types/blossom.ts:6-40`): Union type for perp/defi/event actions
- `BlossomPortfolioSnapshot` (`agent/src/types/blossom.ts:42-57`): Portfolio state with account value, balances, positions

---

## C. Current Execution Flow: User Message → Parse → Plan/Draft → Confirm → "Execute" → UI Updates

### Flow 1: Mock Mode (Frontend-Only)

```
1. User sends message: "Long BTC with 2% risk"
   ↓
2. Chat.tsx:processUserMessage() (line 856)
   - ensureActiveChatId() → creates/gets chat session
   - appendMessageToChat(userMessage)
   ↓
3. mockParser.ts:parseUserMessage() (line 1136)
   - Returns ParsedMessage with intent='trade', strategy={market: 'BTC-PERP', side: 'Long', riskPercent: 2}
   ↓
4. Chat.tsx:handleCreatePerpDraftFromSpec() (line 475)
   - computePerpFromRisk() → calculates margin/notional/leverage
   - addDraftStrategy() → creates Strategy with status='draft'
   - appendMessageToChat(draftCard) → shows draft in chat
   ↓
5. User clicks "Confirm & Execute"
   ↓
6. Chat.tsx:handleConfirmTrade() (line 2306)
   - updateStrategyStatus(draftId, 'executed')
   - updateMessageInChat() → updates chat message to show executed state
   - recomputeAccountFromStrategies() → updates account balances
   ↓
7. UI updates:
   - MessageBubble.tsx renders executed card (neutral gray, not amber)
   - RightPanel.tsx shows new position
   - Account value updates
```

### Flow 2: Agent Mode (Backend LLM)

```
1. User sends message: "Long BTC with 2% risk"
   ↓
2. Chat.tsx:processUserMessage() (line 856)
   - Checks USE_AGENT_BACKEND flag
   ↓
3. blossomApi.ts:callBlossomChat() (line 84)
   - POST /api/chat with {userMessage, venue, clientPortfolio}
   ↓
4. agent/src/server/http.ts:POST /api/chat (line 160)
   - buildBlossomPrompts() → creates system/user prompts
   - callLlm() → calls OpenAI/Anthropic/stub
   - parseModelResponse() → extracts actions from JSON
   - validateActions() → sanitizes actions
   - applyAction() → calls perps-sim/defi-sim/event-sim
   - buildPortfolioSnapshot() → returns updated portfolio
   ↓
5. Frontend receives response:
   - assistantMessage: "I've prepared a Long BTC position..."
   - actions: [{type: 'perp', action: 'open', ...}]
   - portfolio: {accountValueUsd, balances, positions}
   ↓
6. Chat.tsx processes actions:
   - Maps BlossomAction[] to Strategy objects
   - addDraftStrategy() → creates drafts
   - appendMessageToChat() → shows draft cards
   ↓
7. User confirms → same as Flow 1 steps 5-7
```

### Key State Transitions

- `Strategy.status`: `'draft'` → `'queued'` → `'executing'` → `'executed'` → `'closed'`
- `DefiPosition.status`: `'proposed'` → `'active'`
- Chat session: Created on first message, title updated from first user message

---

## D. Current Venues Supported (Perps/Events/DeFi) and How They're Represented

### 1. Perpetual Swaps (Hyperliquid)

**Representation:**
- `Strategy.instrumentType = 'perp'`
- `Strategy.market`: e.g., `'BTC-PERP'`, `'ETH-PERP'`
- `Strategy.side`: `'Long' | 'Short'`
- `Strategy.leverage`: 1-100x (typically 1-20x in UI)
- `Strategy.marginUsd`: Collateral amount
- `Strategy.notionalUsd`: Position size (margin × leverage)
- `Strategy.riskPercent`: Risk as % of account value

**Execution:**
- **Mock**: `computePerpFromRisk()` in `BlossomContext.tsx` calculates sizing
- **Agent**: `agent/src/plugins/perps-sim/openPerp()` simulates position opening
- **Real (future)**: Would call Hyperliquid API to place order

**Routing Display:**
- `formatVenueDisplay('hyperliquid')` → "Auto-selected → Hyperliquid (simulated)"
- `getSimulatedRouteDisplay()` → deterministic venue/chain/slippage display

### 2. Event Markets (Polymarket/Kalshi)

**Representation:**
- `Strategy.instrumentType = 'event'`
- `Strategy.eventKey`: e.g., `'fed-cuts-mar-2025'`
- `Strategy.eventLabel`: Human-readable title
- `Strategy.eventSide`: `'YES' | 'NO'`
- `Strategy.stakeUsd`: Amount staked
- `Strategy.maxPayoutUsd`: Maximum payout if win
- `Strategy.maxLossUsd`: Maximum loss (typically = stakeUsd)
- `Strategy.eventMarketSource`: `'polymarket' | 'kalshi' | 'static'`

**Execution:**
- **Mock**: `createEventPlanFromCommand()` in `BlossomContext.tsx`
- **Agent**: `agent/src/plugins/event-sim/openEventPosition()` simulates position
- **Real (future)**: Would call Polymarket/Kalshi API to place bet

**Data Sources:**
- Live: `src/lib/polymarket.ts` (Gamma API) or `agent/src/services/predictionData.ts`
- Static: `src/lib/eventMarkets.ts:getStaticMarkets()`

### 3. DeFi Yield (Protocols)

**Representation:**
- `DefiPosition` (separate type, not Strategy)
- `DefiPosition.protocol`: e.g., `'Aave'`, `'Lido'`, `'Morpho'`
- `DefiPosition.asset`: e.g., `'REDACTED'`
- `DefiPosition.depositUsd`: Deposit amount
- `DefiPosition.apyPct`: Annual percentage yield

**Execution:**
- **Mock**: `createDefiPlanFromCommand()` in `BlossomContext.tsx` (line 962)
- **Agent**: `agent/src/plugins/defi-sim/openDefiPosition()` simulates deposit
- **Real (future)**: Would call protocol contract (e.g., Aave lending pool)

**Data Sources:**
- Live: `src/lib/defiProtocols.ts` (DefiLlama API)
- Static: `src/lib/defiProtocols.ts:STATIC_PROTOCOLS`

---

## E. Backend "Engine" Capabilities (What It Does Today, What Is Mocked, What Is Live Fetched)

### What the Backend Does Today

1. **LLM Integration** (`agent/src/services/llmClient.ts`):
   - Supports OpenAI (GPT-4o-mini), Anthropic (Claude 3.5 Sonnet), or stub mode
   - Returns structured JSON with `assistantMessage` and `actions[]`
   - **Status**: ✅ Live (when API keys configured)

2. **Action Validation** (`agent/src/utils/actionParser.ts:validateActions()`):
   - Validates `BlossomAction[]` against schema
   - Enforces risk caps (5% max for perps, 3% for events)
   - Filters invalid actions
   - **Status**: ✅ Live (always runs)

3. **Simulation Plugins**:
   - **Perps** (`agent/src/plugins/perps-sim/`): In-memory position tracking, PnL calculation
   - **DeFi** (`agent/src/plugins/defi-sim/`): In-memory deposit tracking, yield calculation
   - **Events** (`agent/src/plugins/event-sim/`): In-memory bet tracking, win/loss outcomes
   - **Status**: ✅ Mocked (all in-memory, no on-chain)

4. **Portfolio Snapshot** (`agent/src/services/state.ts:getPortfolioSnapshot()`):
   - Aggregates state from all three sims
   - Returns `BlossomPortfolioSnapshot` with account value, balances, positions
   - **Status**: ✅ Mocked (derived from in-memory state)

5. **Price Fetching** (`agent/src/services/prices.ts`):
   - Fetches live prices from CoinGecko (via `getPrice()`)
   - Falls back to static prices if API fails
   - **Status**: ✅ Live (CoinGecko API)

6. **Ticker Data** (`agent/src/services/ticker.ts`):
   - `getOnchainTicker()`: Returns perp market data (majors, alts, funding)
   - `getEventMarketsTicker()`: Returns event market data (Polymarket/Kalshi)
   - **Status**: ✅ Live (when APIs configured) / Mocked (static fallback)

### What Is Mocked

- **All execution**: No on-chain transactions, all state is in-memory
- **Wallet/signing**: No private keys, no transaction signing
- **Order placement**: No actual orders sent to exchanges
- **Settlement**: Event markets use deterministic win/loss (seeded)
- **Yield accrual**: DeFi positions use fixed APY, no real yield calculation

### What Is Live Fetched

- **Spot prices**: CoinGecko API (via `demoPriceFeed.ts` or `agent/src/services/prices.ts`)
- **Event markets**: Polymarket Gamma API (when `VITE_EVENT_MARKETS_SOURCE=polymarket`)
- **DeFi protocols**: DefiLlama API (TVL, protocols list)
- **LLM responses**: OpenAI/Anthropic APIs (when configured)

---

## F. Where AI Lives Today (If Anywhere), and the Best Insertion Points for Gemini

### Current AI Integration

**Location**: `agent/src/services/llmClient.ts`

**Current Flow:**
1. `agent/src/server/http.ts:POST /api/chat` (line 160)
2. Calls `buildBlossomPrompts()` → creates system/user prompts
3. Calls `callLlm()` → routes to OpenAI/Anthropic/stub
4. Parses JSON response → extracts `assistantMessage` and `actions[]`
5. Validates actions → filters invalid ones
6. Applies actions → calls simulation plugins

**Current Providers:**
- OpenAI: `callOpenAI()` (line 63)
- Anthropic: `callAnthropic()` (line 101)
- Stub: Returns canned response (line 35)

### Best Insertion Points for Gemini

#### Option 1: Replace `callLlm()` (Recommended)

**File**: `agent/src/services/llmClient.ts`

**Changes:**
- Add `'gemini'` to `ModelProvider` type (line 19)
- Add `callGemini()` function (similar to `callOpenAI()`)
- Update `callLlm()` to route to Gemini when `BLOSSOM_MODEL_PROVIDER=gemini`

**Advantages:**
- Minimal changes (single file)
- Reuses existing prompt building and validation
- No changes to frontend or other backend code

**Schema Gemini Should Return:**
```json
{
  "assistantMessage": "Natural language explanation...",
  "actions": [
    {
      "type": "perp",
      "action": "open",
      "market": "ETH-PERP",
      "side": "long",
      "riskPct": 3.0,
      "entry": 3500,
      "takeProfit": 3640,
      "stopLoss": 3395,
      "reasoning": ["ETH is trending up", "Risk within limits"]
    }
  ]
}
```

**Validation:**
- `validateActions()` in `agent/src/utils/actionParser.ts` already sanitizes outputs
- Enforces risk caps, type checking, required fields

#### Option 2: Frontend Parser Replacement (Alternative)

**File**: `src/lib/mockParser.ts`

**Changes:**
- Replace `parseUserMessage()` with Gemini call
- Return same `ParsedMessage` shape
- Keep existing intent detection logic as fallback

**Advantages:**
- Works in mock mode (no backend required)
- Faster response (no network round-trip)

**Disadvantages:**
- Requires API key in frontend (security risk)
- Duplicates logic between frontend and backend

**Recommendation**: Use Option 1 (backend integration) for security and consistency.

### Gemini Integration Requirements

1. **API Key**: Store in `agent/.env` as `BLOSSOM_GEMINI_API_KEY`
2. **Model**: Use Gemini free tier model (e.g., `gemini-1.5-flash` or `gemini-1.5-pro`)
3. **JSON Mode**: Gemini supports JSON mode via `response_mime_type: "application/json"`
4. **Prompt Format**: Reuse `buildBlossomPrompts()` output (system + user prompts)
5. **Error Handling**: Fall back to stub mode if Gemini API fails

### Validation/Sanitization Points

1. **`validateActions()`** (`agent/src/utils/actionParser.ts:13`):
   - Type checks all fields
   - Enforces risk caps (5% perp, 3% event)
   - Filters invalid actions
   - **Location**: Before `applyAction()` is called

2. **`applyAction()`** (`agent/src/server/http.ts:45`):
   - Additional checks (e.g., REDACTED balance for perps)
   - Throws errors if action cannot be applied
   - **Location**: Before simulation plugins are called

3. **Frontend** (`src/components/Chat.tsx`):
   - `detectHighRiskIntent()` (line 13) flags high-risk requests
   - Shows confirmation card before execution
   - **Location**: Before draft creation

---

## G. Security Boundaries: Where Secrets Live, Where Signing Would Happen, Where NOT to Put API Keys

### Current Security Model

**No Wallet/Signing Logic Exists:**
- No private keys stored
- No transaction signing
- No wallet connection (MetaMask, WalletConnect, etc.)
- All execution is simulated

### Where Secrets Live (Current)

1. **Backend API Keys** (`agent/.env`):
   - `BLOSSOM_OPENAI_API_KEY`
   - `BLOSSOM_ANTHROPIC_API_KEY`
   - `BLOSSOM_GEMINI_API_KEY` (future)
   - **Location**: Server-side only, never exposed to frontend

2. **Frontend Config** (`src/lib/config.ts`):
   - `VITE_USE_AGENT_BACKEND`: Boolean flag (safe to expose)
   - `VITE_AGENT_API_URL`: Backend URL (safe to expose)
   - **Location**: Environment variables, bundled into frontend build

3. **External API Keys** (if any):
   - None currently required (CoinGecko, Polymarket, DefiLlama are public APIs)
   - **Future**: If Kalshi API key needed, store in `agent/.env`

### Where Signing Would Happen (Future)

**Proposed Architecture:**
```
┌─────────────────────────────────────────────────────────┐
│  Frontend: User clicks "Confirm & Execute"            │
│    ↓                                                     │
│  Frontend: Calls backend /api/execute                   │
│    ↓                                                     │
│  Backend: Validates plan, builds transaction            │
│    ↓                                                     │
│  Backend: Returns unsigned transaction to frontend      │
│    ↓                                                     │
│  Frontend: User approves in wallet (MetaMask/etc.)      │
│    ↓                                                     │
│  Frontend: Signs transaction with wallet                │
│    ↓                                                     │
│  Frontend: Sends signed transaction to backend           │
│    ↓                                                     │
│  Backend: Submits to on-chain (Hyperliquid/etc.)        │
└─────────────────────────────────────────────────────────┘
```

**Key Principles:**
- **Never store private keys** in backend or frontend
- **Signing happens in user's wallet** (browser extension, hardware wallet)
- **Backend only builds transactions**, never signs
- **Frontend acts as intermediary** between backend and wallet

### Where NOT to Put API Keys

1. **❌ Frontend code** (`src/`): Never hardcode API keys in React components
2. **❌ Git repository**: Never commit `.env` files (already in `.gitignore`)
3. **❌ Client-side environment variables**: `VITE_*` vars are bundled into frontend, visible to users
4. **❌ Browser localStorage**: Never store API keys in localStorage
5. **✅ Backend `.env` only**: All secrets should live in `agent/.env` (server-side)

### Security Recommendations for Real Execution

1. **Transaction Signing**:
   - Use wallet adapter (e.g., `@solana/wallet-adapter`, `ethers.js` with MetaMask)
   - Sign in frontend, send signed tx to backend
   - Backend only validates and submits

2. **API Key Management**:
   - Use environment variables for all secrets
   - Use secret management service (e.g., Fly.io secrets, Vercel env vars) in production
   - Rotate keys regularly

3. **Rate Limiting**:
   - Add rate limits to `/api/chat` endpoint
   - Prevent abuse of LLM APIs

4. **Input Validation**:
   - Already implemented via `validateActions()`
   - Add additional checks for transaction amounts, addresses, etc.

---

## H. Minimal Interface Proposals (Types Only, No Implementation)

### 1. Planner Interface

**Purpose**: Abstract the planning/strategy generation layer (currently `mockParser.ts` or LLM)

**Location**: `src/lib/interfaces/planner.ts` (new file)

```typescript
export interface PlanDraft {
  instrumentType: 'perp' | 'event' | 'defi';
  // Perp fields
  market?: string;
  side?: 'Long' | 'Short';
  riskPercent?: number;
  leverage?: number;
  entry?: number;
  takeProfit?: number;
  stopLoss?: number;
  // Event fields
  eventKey?: string;
  eventLabel?: string;
  eventSide?: 'YES' | 'NO';
  stakeUsd?: number;
  maxPayoutUsd?: number;
  maxLossUsd?: number;
  // DeFi fields
  protocol?: string;
  asset?: string;
  depositUsd?: number;
  apyPct?: number;
  // Metadata
  reasoning?: string[];
  sourceText: string;
}

export interface Planner {
  /**
   * Generate a plan draft from user message
   * @param userMessage - Natural language user input
   * @param context - Current portfolio state, venue, etc.
   * @returns PlanDraft or null if no plan can be generated
   */
  generatePlan(
    userMessage: string,
    context: {
      venue: 'hyperliquid' | 'event_demo';
      accountValue?: number;
      existingStrategies?: any[];
    }
  ): Promise<PlanDraft | null>;
}
```

**Implementations:**
- `MockPlanner` (current `mockParser.ts`)
- `GeminiPlanner` (new, calls Gemini API)
- `OpenAIPlanner` (wraps existing LLM client)

### 2. Executor Interface

**Purpose**: Abstract execution layer (currently simulation plugins)

**Location**: `agent/src/interfaces/executor.ts` (new file)

```typescript
export interface ExecutionResult {
  success: boolean;
  transactionHash?: string; // On-chain tx hash if real execution
  error?: string;
  positionId?: string; // ID of created position
}

export interface ExecutionRequest {
  planDraft: PlanDraft;
  venue: 'hyperliquid' | 'event_demo';
  // Additional execution params
  slippageTolerance?: number;
  maxGasPrice?: number;
}

export interface Executor {
  /**
   * Execute a plan draft
   * @param request - Execution request with plan and params
   * @returns Execution result with transaction hash or error
   */
  execute(request: ExecutionRequest): Promise<ExecutionResult>;

  /**
   * Check if executor can handle this venue/instrument
   */
  canExecute(venue: string, instrumentType: string): boolean;
}
```

**Implementations:**
- `SimulationExecutor` (current plugins, returns mock tx hash)
- `HyperliquidExecutor` (new, calls Hyperliquid API)
- `PolymarketExecutor` (new, calls Polymarket API)
- `DefiExecutor` (new, calls protocol contracts)

### 3. VenueAdapter Interface

**Purpose**: Abstract venue-specific logic (routing, quotes, execution)

**Location**: `agent/src/interfaces/venueAdapter.ts` (new file)

```typescript
export interface VenueQuote {
  venue: string;
  chain: string;
  estimatedSlippage: number; // e.g., 0.001 (0.1%)
  estimatedGasUsd?: number;
  estimatedSettlementTime: string; // e.g., "T+0", "~1 block"
  routeNote?: string; // e.g., "Auto-selected → Hyperliquid"
}

export interface VenueAdapter {
  /**
   * Get execution quote for a plan
   * @param planDraft - Plan to get quote for
   * @returns Quote with venue, chain, slippage, etc.
   */
  getQuote(planDraft: PlanDraft): Promise<VenueQuote>;

  /**
   * Get available markets/instruments for this venue
   */
  getAvailableMarkets(): Promise<string[]>;

  /**
   * Check if venue supports this instrument type
   */
  supportsInstrumentType(instrumentType: 'perp' | 'event' | 'defi'): boolean;
}
```

**Implementations:**
- `HyperliquidAdapter` (new, calls Hyperliquid API for quotes)
- `PolymarketAdapter` (new, calls Polymarket API)
- `SimulationAdapter` (current, returns deterministic quotes)

### 4. QuoteProvider Interface

**Purpose**: Abstract price/quote fetching (currently `demoPriceFeed.ts`, `liveSpot.ts`)

**Location**: `src/lib/interfaces/quoteProvider.ts` (new file)

```typescript
export interface PriceQuote {
  symbol: string; // e.g., "BTC", "ETH"
  priceUsd: number;
  source: 'coingecko' | 'agent' | 'venue' | 'static';
  isLive: boolean;
  lastUpdatedMs: number;
  change24hPct?: number;
}

export interface QuoteProvider {
  /**
   * Get current price for a symbol
   * @param symbol - Symbol to get price for (e.g., "BTC", "ETH-PERP")
   * @returns Price quote or null if unavailable
   */
  getPrice(symbol: string): Promise<PriceQuote | null>;

  /**
   * Get prices for multiple symbols
   */
  getPrices(symbols: string[]): Promise<Record<string, PriceQuote>>;

  /**
   * Check if provider has live data
   */
  isLive(): boolean;
}
```

**Implementations:**
- `CoinGeckoQuoteProvider` (current `demoPriceFeed.ts`)
- `VenueQuoteProvider` (new, fetches from exchange APIs)
- `StaticQuoteProvider` (fallback)

### Integration Points

**Current Flow with Interfaces:**
```
User Message
  ↓
Planner.generatePlan() → PlanDraft
  ↓
VenueAdapter.getQuote() → VenueQuote
  ↓
User confirms
  ↓
Executor.execute() → ExecutionResult
  ↓
UI updates
```

**Benefits:**
- **Planner**: Swap `MockPlanner` → `GeminiPlanner` without changing execution
- **Executor**: Swap `SimulationExecutor` → `HyperliquidExecutor` without changing planning
- **VenueAdapter**: Add new venues (e.g., dYdX, GMX) by implementing interface
- **QuoteProvider**: Swap price sources without changing UI

---

## Next 3 Surgical PRs (Based on Audit Findings)

### PR 1: Add Gemini Planner Integration
**Title**: `feat(agent): add Gemini free tier planner integration`

**Changes:**
- Add `callGemini()` to `agent/src/services/llmClient.ts`
- Add `BLOSSOM_GEMINI_API_KEY` env var support
- Update `ModelProvider` type to include `'gemini'`
- Add Gemini JSON mode configuration
- **Files**: `agent/src/services/llmClient.ts`, `agent/.env.example`

**Testing:**
- Test with Gemini free tier API key
- Verify JSON response parsing
- Verify action validation still works

### PR 2: Formalize Executor Interface
**Title**: `refactor(agent): extract executor interface from simulation plugins`

**Changes:**
- Create `agent/src/interfaces/executor.ts` with `Executor` interface
- Wrap existing plugins in `SimulationExecutor` class
- Update `applyAction()` to use `Executor` interface
- **Files**: `agent/src/interfaces/executor.ts`, `agent/src/server/http.ts`, `agent/src/plugins/*/index.ts`

**Testing:**
- Verify existing simulation still works
- Verify no breaking changes to frontend

### PR 3: Add VenueAdapter for Real Execution Prep
**Title**: `feat(agent): add VenueAdapter interface for multi-venue routing`

**Changes:**
- Create `agent/src/interfaces/venueAdapter.ts` with `VenueAdapter` interface
- Implement `SimulationVenueAdapter` (wraps current routing logic)
- Update `getSimulatedRouteDisplay()` to use adapter
- **Files**: `agent/src/interfaces/venueAdapter.ts`, `src/lib/formatPlanCard.ts`

**Testing:**
- Verify routing display still works
- Verify no UI changes

---

## Appendix: Key Line References

### Frontend
- `src/components/Chat.tsx:856` - `processUserMessage()` entry point
- `src/components/Chat.tsx:2306` - `handleConfirmTrade()` execution trigger
- `src/context/BlossomContext.tsx:139` - `addDraftStrategy()` draft creation
- `src/context/BlossomContext.tsx:962` - `createDefiPlanFromCommand()` DeFi planning
- `src/lib/mockParser.ts:1136` - `parseUserMessage()` intent parsing
- `src/lib/mockParser.ts:1434` - `determineIntentStrictV2()` intent classification

### Backend
- `agent/src/server/http.ts:160` - `POST /api/chat` endpoint
- `agent/src/server/http.ts:45` - `applyAction()` execution application
- `agent/src/utils/actionParser.ts:13` - `validateActions()` action validation
- `agent/src/utils/actionParser.ts:146` - `buildBlossomPrompts()` prompt building
- `agent/src/services/llmClient.ts:32` - `callLlm()` LLM routing
- `agent/src/plugins/perps-sim/index.ts:35` - `openPerp()` perp execution
- `agent/src/plugins/defi-sim/index.ts` - DeFi execution
- `agent/src/plugins/event-sim/index.ts` - Event execution

---

**Report Generated**: 2025-12-28
**Audit Scope**: Execution layer architecture, AI integration points, security boundaries
**Status**: ✅ Complete (Read-only, no code changes)


