# Blossom Backend + Execution Wiring Map

## Current Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    FRONTEND (React)                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  User Message → Chat.tsx:processUserMessage()                  │
│    ↓                                                            │
│  Creates Draft Strategy (status='draft')                        │
│    ↓                                                            │
│  User clicks "Confirm & Execute"                               │
│    ↓                                                            │
│  Chat.tsx:handleConfirmTrade(draftId)                         │
│    ↓                                                            │
│  updateStrategyStatus(draftId, 'executed')                      │
│    ↓                                                            │
│  UI updates (MessageBubble shows executed state)                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ (if USE_AGENT_BACKEND=true)
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND (Express Server)                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  POST /api/chat                                                 │
│    ↓                                                            │
│  buildBlossomPrompts() → callLlm()                             │
│    ↓                                                            │
│  validateActions() → applyAction()                             │
│    ↓                                                            │
│  perps-sim / defi-sim / event-sim plugins                      │
│    ↓                                                            │
│  buildPortfolioSnapshot() → return to frontend                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key Point**: In **mock mode** (default), execution is **frontend-only** - no backend call. In **agent mode**, backend is called for planning, but execution is still simulated in-memory.

---

## 1. Backend Chat Endpoint Implementation

### File: `agent/src/server/http.ts`

**Endpoint**: `POST /api/chat` (line 160)

**Request Shape** (`ChatRequest` interface, line 145):
```typescript
{
  userMessage: string;
  venue: 'hyperliquid' | 'event_demo';
  clientPortfolio?: Partial<BlossomPortfolioSnapshot>; // Optional frontend state sync
}
```

**Response Shape** (`ChatResponse` interface, line 151):
```typescript
{
  assistantMessage: string;        // Natural language response
  actions: BlossomAction[];        // Structured actions (perp/defi/event)
  portfolio: BlossomPortfolioSnapshot; // Updated portfolio state
}
```

**Flow**:
1. Receives `userMessage` and `venue` (line 162)
2. Builds LLM prompts via `buildBlossomPrompts()` (line 180)
3. Calls LLM via `callLlm()` (line 238)
4. Parses JSON response via `parseModelResponse()` (line 241)
5. Validates actions via `validateActions()` (line 134)
6. Applies actions via `applyAction()` (line 255) → calls simulation plugins
7. Builds portfolio snapshot via `buildPortfolioSnapshot()` (line 267)
8. Returns response (line 275)

**Other Endpoints**:
- `POST /api/strategy/close` (line 296): Closes a strategy, returns PnL
- `POST /api/reset` (line 357): Resets all simulation state
- `GET /api/ticker` (line 378): Returns market ticker data

---

## 2. Plan Draft Type Definitions

### Frontend Types

**File**: `src/context/BlossomContext.tsx`

**`Strategy` Interface** (line 8-39):
```typescript
interface Strategy {
  id: string;
  createdAt: string;
  side: 'Long' | 'Short';
  market: string;
  riskPercent: number;
  entry: number;
  takeProfit: number;
  stopLoss: number;
  status: 'draft' | 'queued' | 'executing' | 'executed' | 'closed';
  sourceText: string;
  notionalUsd?: number;
  marginUsd?: number;
  isClosed: boolean;
  instrumentType?: 'perp' | 'event';
  leverage?: number;
  // Event-specific fields
  eventKey?: string;
  eventLabel?: string;
  stakeUsd?: number;
  maxPayoutUsd?: number;
  maxLossUsd?: number;
  eventSide?: 'YES' | 'NO';
  eventMarketSource?: 'polymarket' | 'kalshi' | 'static';
}
```

**`DefiPosition` Interface** (line 61-70):
```typescript
interface DefiPosition {
  id: string;
  command: string;
  protocol: string;
  asset: string;
  depositUsd: number;
  apyPct: number;
  status: 'proposed' | 'active';
  createdAt: string;
}
```

### Backend Types

**File**: `agent/src/types/blossom.ts`

**`BlossomAction` Type** (line 6-40):
```typescript
type BlossomAction =
  | {
      type: 'perp';
      action: 'open' | 'close';
      market: string;
      side: 'long' | 'short';
      riskPct: number;
      entry?: number;
      takeProfit?: number;
      stopLoss?: number;
      reasoning: string[];
    }
  | {
      type: 'defi';
      action: 'deposit' | 'withdraw';
      protocol: string;
      asset: string;
      amountUsd: number;
      apr: number;
      reasoning: string[];
    }
  | {
      type: 'event';
      action: 'open' | 'close' | 'update';
      eventKey: string;
      label: string;
      side: 'YES' | 'NO';
      stakeUsd: number;
      maxPayoutUsd: number;
      maxLossUsd: number;
      reasoning: string[];
      positionId?: string;
      overrideRiskCap?: boolean;
    };
```

**`BlossomPortfolioSnapshot` Interface** (line 42-57):
```typescript
interface BlossomPortfolioSnapshot {
  accountValueUsd: number;
  balances: { symbol: string; balanceUsd: number }[];
  openPerpExposureUsd: number;
  eventExposureUsd: number;
  defiPositions: {
    id: string;
    protocol: string;
    asset: string;
    depositUsd: number;
    apr: number;
    openedAt: number;
    isClosed: boolean;
  }[];
  strategies: any[]; // Mirrors frontend Strategy[]
}
```

**Key Mapping**:
- Frontend `Strategy` ↔ Backend `BlossomAction` (when using agent mode)
- Frontend `DefiPosition` ↔ Backend `BlossomAction` (type='defi')
- No unified `PlanDraft` type exists yet (would be useful for ETH testnet integration)

---

## 3. UI "Confirm" Action Handler

### Primary Handler: `handleConfirmTrade()`

**File**: `src/components/Chat.tsx` (line 2582)

**Function Signature**:
```typescript
const handleConfirmTrade = async (draftId: string) => {
  // Gets targetChatId from activeDraftChatIdRef
  // Updates strategy status to 'executed'
  // Updates chat message to show executed state
  // Recomputes account from strategies
}
```

**What It Calls Today**:
1. `updateStrategyStatus(draftId, 'executed')` (line 2602)
   - **Location**: `src/context/BlossomContext.tsx:updateStrategyStatus()` (line 140)
   - **Effect**: Changes strategy status from `'draft'` → `'executed'`, updates account balances in-memory
2. `updateMessageInChat(targetChatId, draftMessageId, executedMessage)` (line 2381)
   - **Location**: `src/context/BlossomContext.tsx:updateMessageInChat()` (line 751)
   - **Effect**: Updates chat message to show executed state (neutral gray, not amber)
3. `recomputeAccountFromStrategies()` (line 2603)
   - **Location**: `src/context/BlossomContext.tsx:recomputeAccountFromStrategies()` (line 144)
   - **Effect**: Recalculates account value, balances, exposure from all strategies

**Alternative Handler**: `handleConfirmAndQueue()` (MessageBubble.tsx, line 231)
- Used when `executionMode === 'confirm'`
- Sets status to `'queued'` → `'executing'` → `'executed'` (with timeouts)
- Same end result: status becomes `'executed'`

**DeFi Handler**: `confirmDefiPlan()`
- **File**: `src/context/BlossomContext.tsx` (line 1067)
- **Effect**: Changes `DefiPosition.status` from `'proposed'` → `'active'`
- **Called from**: `MessageBubble.tsx` (line 1242, 1267), `DeFiSummaryCard.tsx` (line 110)

**Key Point**: **No backend call happens on confirm** - execution is purely frontend state update. This is the cleanest place to inject ETH testnet execution.

---

## 4. Simulated Execution Location and Boundary

### Simulation Plugins

**Location**: `agent/src/plugins/`

#### Perps Simulation
**File**: `agent/src/plugins/perps-sim/index.ts`

**Key Functions**:
- `openPerp(spec)` (line 35): Opens perp position, deducts REDACTED, creates `PerpPosition`
- `closePerp(id)` (line 93): Closes position, calculates PnL, credits REDACTED
- `getPerpsSnapshot()` (line 138): Returns account state with positions

**State**: In-memory `accountState` object (line 26) with balances and positions array

#### DeFi Simulation
**File**: `agent/src/plugins/defi-sim/index.ts`

**Key Functions**:
- `openDefiPosition(protocol, asset, amountUsd)` (line 35): Deposits into protocol, deducts REDACTED
- `closeDefiPosition(id)` (line 74): Withdraws with yield calculation, credits REDACTED
- `getDefiSnapshot()` (line 102): Returns DeFi state

**State**: In-memory `defiState` object (line 16) with positions array

#### Event Simulation
**File**: `agent/src/plugins/event-sim/index.ts`

**Key Functions**:
- `openEventPosition(eventKey, side, stakeUsd, label)` (line 70): Opens event bet, deducts REDACTED
- `closeEventPosition(id)` (line 246): Settles event (win/loss), credits payout or loses stake
- `getEventSnapshot()` (line 308): Returns event state

**State**: In-memory `eventState` object (line 50) with markets and positions arrays

### Execution Boundary

**File**: `agent/src/server/http.ts`

**`applyAction()` Function** (line 45):
```typescript
async function applyAction(action: BlossomAction): Promise<void> {
  if (action.type === 'perp' && action.action === 'open') {
    await perpsSim.openPerp({ ... });
  } else if (action.type === 'defi' && action.action === 'deposit') {
    defiSim.openDefiPosition(...);
  } else if (action.type === 'event' && action.action === 'open') {
    await eventSim.openEventPosition(...);
  }
}
```

**Cleanest Boundary to Swap in Real Executor**:
- **Replace `applyAction()`** with a strategy pattern:
  - `SimulationExecutor.applyAction()` → current behavior
  - `EthTestnetExecutor.applyAction()` → new behavior (calls smart contracts)
- **Or replace plugin functions directly**:
  - `perpsSim.openPerp()` → `ethPerpsExecutor.openPerp()` (calls Hyperliquid testnet API)
  - `defiSim.openDefiPosition()` → `ethDefiExecutor.openDefiPosition()` (calls protocol contracts)
  - `eventSim.openEventPosition()` → `ethEventExecutor.openEventPosition()` (calls Polymarket testnet)

**Recommendation**: Create an `Executor` interface and swap implementations based on environment variable (e.g., `EXECUTION_MODE=simulation|testnet|mainnet`).

---

## 5. Risk Gating / Approval Signing Logic

### Risk Detection

**File**: `src/lib/riskIntent.ts`

**Function**: `detectHighRiskIntent(userText)` (line 17)

**Detects**:
- High leverage (>= 10x) (line 22-37)
- Full portfolio allocation (line 58-72)
- "Rest of portfolio" allocation (line 40-53)
- No stop-loss requests (line 74-87)

**Returns**: `HighRiskDetection` with `isHighRisk`, `reasons[]`, `extracted` fields

**Usage**: `Chat.tsx` calls this before creating draft (line 13, referenced in `processUserMessage`)

### Risk Warning UI

**File**: `src/components/HighRiskConfirmCard.tsx`
- Shows warning banner with risk reasons
- User must explicitly confirm high-risk trades

**File**: `src/components/ConfirmTradeCard.tsx`
- Displays trade details (margin, notional, risk, TP/SL)
- Has `onConfirm` callback that calls `handleConfirmTrade()`

### Approval Signing Logic

**Current State**: **NONE EXISTS**

- No wallet connection (MetaMask, WalletConnect, etc.)
- No transaction signing
- No private key storage
- No on-chain transaction submission

**Where Signing Would Happen (Future)**:
1. **Frontend**: User approves in wallet extension (MetaMask popup)
2. **Frontend**: Signs transaction with wallet
3. **Frontend**: Sends signed transaction to backend
4. **Backend**: Submits to ETH testnet (via RPC or exchange API)

**Proposed Flow**:
```
handleConfirmTrade(draftId)
  ↓
Check if EXECUTION_MODE=testnet
  ↓
Build unsigned transaction (or order params)
  ↓
Return to frontend → trigger wallet popup
  ↓
User signs → send signed tx to backend
  ↓
Backend submits to testnet
  ↓
Update strategy status to 'executed' with tx hash
```

---

## File Map: What Each File Does

### Frontend Execution Files

| File | Purpose | Key Functions |
|------|---------|---------------|
| `src/components/Chat.tsx` | Main chat handler, message processing | `processUserMessage()`, `handleConfirmTrade()` |
| `src/context/BlossomContext.tsx` | Global state, strategy management | `addDraftStrategy()`, `updateStrategyStatus()`, `confirmDefiPlan()` |
| `src/components/MessageBubble.tsx` | Renders draft/executed cards | `handleConfirmAndQueue()` |
| `src/components/ConfirmTradeCard.tsx` | Confirmation UI for trades | Displays trade details, `onConfirm` callback |
| `src/components/HighRiskConfirmCard.tsx` | High-risk warning UI | Shows risk reasons, requires explicit confirm |
| `src/lib/riskIntent.ts` | Risk detection logic | `detectHighRiskIntent()` |
| `src/lib/mockParser.ts` | Intent parsing (mock mode) | `parseUserMessage()`, `determineIntentStrictV2()` |

### Backend Execution Files

| File | Purpose | Key Functions |
|------|---------|---------------|
| `agent/src/server/http.ts` | HTTP API server | `POST /api/chat`, `applyAction()` |
| `agent/src/types/blossom.ts` | Backend type definitions | `BlossomAction`, `BlossomPortfolioSnapshot` |
| `agent/src/plugins/perps-sim/index.ts` | Perps simulation | `openPerp()`, `closePerp()`, `getPerpsSnapshot()` |
| `agent/src/plugins/defi-sim/index.ts` | DeFi simulation | `openDefiPosition()`, `closeDefiPosition()` |
| `agent/src/plugins/event-sim/index.ts` | Event simulation | `openEventPosition()`, `closeEventPosition()` |
| `agent/src/utils/actionParser.ts` | Action validation | `validateActions()`, `buildBlossomPrompts()` |
| `agent/src/services/state.ts` | Portfolio snapshot | `getPortfolioSnapshot()`, `resetAllSims()` |

---

## Minimum Integration Points for ETH Testnet Execution

### Option 1: Frontend Confirm Handler (Recommended)

**File**: `src/components/Chat.tsx:handleConfirmTrade()` (line 2582)

**Changes**:
1. Check environment variable: `VITE_EXECUTION_MODE === 'testnet'`
2. If testnet:
   - Call new backend endpoint: `POST /api/execute` with draft strategy
   - Backend builds unsigned transaction
   - Return transaction to frontend
   - Frontend triggers wallet popup (MetaMask)
   - User signs → send signed tx to backend
   - Backend submits to testnet
   - Update strategy with `txHash` and status `'executed'`
3. If simulation (default):
   - Keep current behavior: `updateStrategyStatus(draftId, 'executed')`

**New Backend Endpoint**: `POST /api/execute`
- Input: `{ strategyId, strategyType: 'perp'|'event'|'defi', strategyData }`
- Output: `{ unsignedTransaction, gasEstimate, network: 'sepolia'|'goerli' }`

**New Backend Endpoint**: `POST /api/execute/submit`
- Input: `{ strategyId, signedTransaction }`
- Output: `{ txHash, status: 'pending'|'confirmed' }`

### Option 2: Backend Executor Swap

**File**: `agent/src/server/http.ts:applyAction()` (line 45)

**Changes**:
1. Create `Executor` interface:
   ```typescript
   interface Executor {
     applyAction(action: BlossomAction): Promise<ExecutionResult>;
   }
   ```
2. Implement `SimulationExecutor` (wraps current plugins)
3. Implement `EthTestnetExecutor` (calls smart contracts/APIs)
4. Swap based on env var: `EXECUTION_MODE=simulation|testnet`

**Advantage**: No frontend changes, execution happens in backend

**Disadvantage**: Requires wallet signing in backend (security risk) or complex flow

### Option 3: Hybrid (Frontend Signing + Backend Execution)

**Recommended Approach**:

1. **Frontend** (`Chat.tsx:handleConfirmTrade`):
   - If testnet: Call `POST /api/execute/prepare` with draft
   - Receive unsigned transaction
   - Trigger wallet popup, user signs
   - Call `POST /api/execute/submit` with signed tx

2. **Backend** (`agent/src/server/http.ts`):
   - `POST /api/execute/prepare`: Builds unsigned transaction, returns to frontend
   - `POST /api/execute/submit`: Submits signed transaction to testnet, returns tx hash

3. **New Executor Module** (`agent/src/executors/ethTestnetExecutor.ts`):
   - `prepareTransaction(strategy)`: Builds unsigned tx
   - `submitTransaction(signedTx)`: Submits to testnet RPC

**Files to Create/Modify**:
- ✅ `agent/src/executors/ethTestnetExecutor.ts` (new)
- ✅ `agent/src/server/http.ts` (add 2 endpoints)
- ✅ `src/components/Chat.tsx` (modify `handleConfirmTrade`)
- ✅ `src/lib/walletAdapter.ts` (new, wallet connection/signing)

**Files NOT to Touch**:
- ❌ UI components (MessageBubble, ConfirmTradeCard) - keep as-is
- ❌ Strategy types (Strategy, DefiPosition) - keep as-is
- ❌ Simulation plugins - keep for fallback/testing

---

## Summary

**Current State**:
- Execution is **simulated** (in-memory state)
- Confirm action is **frontend-only** (`updateStrategyStatus`)
- No wallet/signing logic exists
- Risk gating exists but is UI-only (no on-chain enforcement)

**Integration Points**:
1. **Primary**: `Chat.tsx:handleConfirmTrade()` - add testnet execution path
2. **Secondary**: `agent/src/server/http.ts` - add `/api/execute` endpoints
3. **New Module**: `agent/src/executors/ethTestnetExecutor.ts` - testnet execution logic

**Minimal Changes Required**:
- 3 new files (executor, wallet adapter, API endpoints)
- 1 modified file (Chat.tsx confirm handler)
- No UI changes needed
- No type changes needed (reuse existing Strategy/DefiPosition types)

---

**Report Generated**: 2025-12-28  
**Status**: ✅ Read-only audit complete


