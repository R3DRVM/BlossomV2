# ETH Testnet Execution Integration Seams

## 1. Data Available in `Chat.tsx:handleConfirmTrade()`

### File: `src/components/Chat.tsx:2582`

**Function Signature**:
```typescript
const handleConfirmTrade = async (draftId: string) => {
  // draftId: string - The ID of the draft strategy to confirm
}
```

**Available Context Variables** (from `useBlossomContext()` hook, line 91-116):

| Variable | Type | Source | Available Data |
|----------|------|--------|----------------|
| `strategies` | `Strategy[]` | Context | All strategies (draft, executed, closed) |
| `defiPositions` | `DefiPosition[]` | Context | All DeFi positions (proposed, active) |
| `account` | `AccountState` | Context | Account value, balances, exposure |
| `venue` | `'hyperliquid' \| 'event_demo'` | Context | Current venue |
| `activeChatId` | `string \| null` | Context | Active chat session ID |
| `chatSessions` | `ChatSession[]` | Context | All chat sessions |

**Draft Strategy Object** (retrieved at line 2639):
```typescript
const executedStrategy = strategies.find(s => s.id === draftId);
// Type: Strategy | undefined
```

**Full `Strategy` Interface** (`src/context/BlossomContext.tsx:8-39`):
```typescript
interface Strategy {
  id: string;
  createdAt: string;
  side: 'Long' | 'Short';
  market: string;                    // e.g., "ETH-PERP", "BTC-PERP"
  riskPercent: number;                // e.g., 3.0
  entry: number;                      // Entry price
  takeProfit: number;                 // Take profit price
  stopLoss: number;                   // Stop loss price
  status: 'draft' | 'queued' | 'executing' | 'executed' | 'closed';
  sourceText: string;                 // Original user message
  notionalUsd?: number;               // Position size (margin × leverage)
  marginUsd?: number;                 // Collateral amount
  isClosed: boolean;
  closedAt?: string;
  realizedPnlUsd?: number;
  realizedPnlPct?: number;
  instrumentType?: 'perp' | 'event';  // 'perp' or 'event'
  leverage?: number;                  // Leverage (1-100x)
  // Event-specific fields (if instrumentType === 'event')
  eventKey?: string;
  eventLabel?: string;
  stakeUsd?: number;
  maxPayoutUsd?: number;
  maxLossUsd?: number;
  eventSide?: 'YES' | 'NO';
  eventMarketSource?: 'polymarket' | 'kalshi' | 'static';
}
```

**DeFi Position Object** (if confirming DeFi):
- Retrieved via: `defiPositions.find(p => p.id === draftId)`
- **File**: `src/context/BlossomContext.tsx:61-70`
- **Type**: `DefiPosition`
```typescript
interface DefiPosition {
  id: string;
  command: string;                    // Original command text
  protocol: string;                    // e.g., "Aave", "Lido", "Morpho"
  asset: string;                      // e.g., "REDACTED"
  depositUsd: number;                 // Deposit amount
  apyPct: number;                     // APY percentage
  status: 'proposed' | 'active';
  createdAt: string;
}
```

**Other Available Data**:
- `targetChatId`: `string | null` (line 2584) - Chat session ID for the draft
- `activeDraftMessageIdRef.current`: `string | null` (line 2638) - Message ID containing the draft card
- `account.accountValue`: `number` - Total account value
- `account.balances`: `AssetBalance[]` - Current balances (REDACTED, ETH, SOL, etc.)

**Current Behavior** (lines 2596-2602):
1. Sets status to `'queued'` → `'executing'` → `'executed'` (with timeouts)
2. Updates chat message to show executed state
3. Recomputes account from strategies

---

## 2. Backend `BlossomAction` Union Type

### File: `agent/src/types/blossom.ts:6-40`

**Full Type Definition**:
```typescript
export type BlossomAction =
  | {
      type: 'perp';
      action: 'open' | 'close';
      market: string;              // 'ETH-PERP', 'BTC-PERP'
      side: 'long' | 'short';      // lowercase (frontend uses 'Long'/'Short')
      riskPct: number;             // Risk as % of account (e.g., 3.0)
      entry?: number;              // Optional entry price
      takeProfit?: number;          // Optional TP price
      stopLoss?: number;            // Optional SL price
      reasoning: string[];         // Array of reasoning strings
    }
  | {
      type: 'defi';
      action: 'deposit' | 'withdraw';
      protocol: string;            // 'Kamino', 'RootsFi', 'Jet', 'Aave', 'Lido', etc.
      asset: string;               // 'REDACTED' (typically)
      amountUsd: number;           // Deposit/withdraw amount
      apr: number;                 // APY/APR percentage
      reasoning: string[];         // Array of reasoning strings
    }
  | {
      type: 'event';
      action: 'open' | 'close' | 'update';
      eventKey: string;            // 'FED_CUTS_MAR_2025'
      label: string;               // Human-readable title
      side: 'YES' | 'NO';
      stakeUsd: number;            // Stake amount
      maxPayoutUsd: number;        // Maximum payout if win
      maxLossUsd: number;          // Maximum loss (typically = stakeUsd)
      reasoning: string[];         // Array of reasoning strings
      positionId?: string;         // Required for 'update' action
      overrideRiskCap?: boolean;   // For 'update' action
      requestedStakeUsd?: number;  // For 'update' action
    };
```

**DeFi Action Fields for "Swap-like" Operations**:

Currently, DeFi actions are **deposit/withdraw only** - no swap fields exist.

**Available Fields**:
- `protocol`: String (e.g., "Aave", "Lido", "Morpho")
- `asset`: String (e.g., "REDACTED") - **single asset only, no swap pairs**
- `amountUsd`: Number - Deposit amount
- `apr`: Number - APY percentage

**Missing Fields for Swap Operations**:
- ❌ `fromAsset` / `toAsset` (swap pairs)
- ❌ `slippageTolerance` (swap slippage)
- ❌ `route` (swap route/path)
- ❌ `minAmountOut` (minimum output for swap)

**Note**: To support swap-like DeFi operations, the `BlossomAction` type would need to be extended:
```typescript
| {
    type: 'defi';
    action: 'swap' | 'deposit' | 'withdraw';
    protocol?: string;           // Optional for swaps (could be DEX)
    fromAsset: string;           // e.g., "REDACTED"
    toAsset: string;             // e.g., "ETH"
    amountUsd: number;           // Input amount
    slippageTolerance?: number;  // e.g., 0.01 (1%)
    minAmountOut?: number;       // Minimum output
    reasoning: string[];
  }
```

**Current DeFi Execution** (`agent/src/server/http.ts:55-60`):
```typescript
else if (action.type === 'defi' && action.action === 'deposit') {
  defiSim.openDefiPosition(
    action.protocol as 'Kamino' | 'RootsFi' | 'Jet',
    action.asset,
    action.amountUsd
  );
}
```

---

## 3. Environment/Config Utilities

### Frontend Config

**File**: `src/lib/config.ts`

**Current Exports**:
```typescript
export const USE_AGENT_BACKEND =
  import.meta.env.VITE_USE_AGENT_BACKEND === 'true';
```

**Usage Pattern**:
- Uses `import.meta.env.VITE_*` (Vite environment variables)
- Boolean flag: `VITE_USE_AGENT_BACKEND=true` enables backend mode

**Other Frontend Env Vars** (found in codebase):
- `import.meta.env.DEV` - Development mode flag (used throughout for DEV-only logging)
- `import.meta.env.VITE_AGENT_API_URL` - Backend API URL (referenced but not in config.ts)
- `import.meta.env.VITE_EVENT_MARKETS_SOURCE` - Event markets source ('polymarket' or default)

**Location**: `src/lib/config.ts:5-6`

### Backend Config

**File**: `agent/src/server/http.ts` and `agent/src/services/llmClient.ts`

**Environment Variables Read** (via `process.env`):

| Variable | Location | Purpose |
|----------|----------|---------|
| `BLOSSOM_OPENAI_API_KEY` | `llmClient.ts:64`, `http.ts:190` | OpenAI API key |
| `BLOSSOM_ANTHROPIC_API_KEY` | `llmClient.ts:102`, `http.ts:191` | Anthropic API key |
| `BLOSSOM_MODEL_PROVIDER` | `llmClient.ts:22`, `http.ts:192` | LLM provider ('openai' \| 'anthropic' \| 'stub') |
| `BLOSSOM_OPENAI_MODEL` | `llmClient.ts:69` | OpenAI model name (default: 'gpt-4o-mini') |
| `BLOSSOM_ANTHROPIC_MODEL` | `llmClient.ts:107` | Anthropic model name (default: 'claude-3-5-sonnet-20241022') |
| `PORT` | `http.ts:449` | Server port (default: 3001) |
| `KALSHI_API_URL` | `predictionData.ts:83` | Kalshi API URL |
| `KALSHI_API_KEY` | `predictionData.ts:84` | Kalshi API key |
| `POLYMARKET_API_URL` | `predictionData.ts:313` | Polymarket API URL |
| `NODE_ENV` | `predictionData.ts:399` | Node environment ('production' or other) |

**No Centralized Config File**: Backend reads `process.env` directly in each service file.

**Recommended Pattern for ETH Testnet**:
- Frontend: Add to `src/lib/config.ts`:
  ```typescript
  export const EXECUTION_MODE = import.meta.env.VITE_EXECUTION_MODE || 'simulation';
  export const ETH_TESTNET_RPC_URL = import.meta.env.VITE_ETH_TESTNET_RPC_URL;
  ```
- Backend: Create `agent/src/config.ts`:
  ```typescript
  export const EXECUTION_MODE = process.env.EXECUTION_MODE || 'simulation';
  export const ETH_TESTNET_RPC_URL = process.env.ETH_TESTNET_RPC_URL;
  export const ETH_TESTNET_CHAIN_ID = parseInt(process.env.ETH_TESTNET_CHAIN_ID || '11155111'); // Sepolia
  ```

---

## Integration Diff Plan

### Files to Create (New)

1. **`agent/src/executors/ethTestnetExecutor.ts`** (NEW)
   - Purpose: ETH testnet execution logic
   - Functions: `prepareTransaction()`, `submitTransaction()`, `executePerp()`, `executeDefi()`, `executeEvent()`
   - Dependencies: ethers.js or viem for contract interaction

2. **`agent/src/config.ts`** (NEW)
   - Purpose: Centralized backend config
   - Exports: `EXECUTION_MODE`, `ETH_TESTNET_RPC_URL`, `ETH_TESTNET_CHAIN_ID`

3. **`src/lib/walletAdapter.ts`** (NEW)
   - Purpose: Wallet connection and transaction signing
   - Functions: `connectWallet()`, `signTransaction()`, `getWalletAddress()`
   - Dependencies: ethers.js or viem, wallet adapter library

4. **`agent/src/types/execution.ts`** (NEW)
   - Purpose: Execution request/response types
   - Types: `ExecutionRequest`, `ExecutionResult`, `UnsignedTransaction`

### Files to Modify (Existing)

1. **`src/lib/config.ts`** (MODIFY)
   - Add: `EXECUTION_MODE`, `ETH_TESTNET_RPC_URL` exports
   - Line: After line 6

2. **`src/components/Chat.tsx`** (MODIFY)
   - Function: `handleConfirmTrade()` (line 2582)
   - Changes:
     - Check `EXECUTION_MODE === 'testnet'`
     - If testnet: Call `POST /api/execute/prepare` → wallet sign → `POST /api/execute/submit`
     - If simulation: Keep current behavior (lines 2596-2602)
   - Also modify: `confirmDefiPlan()` handler (if DeFi needs testnet execution)

3. **`agent/src/server/http.ts`** (MODIFY)
   - Add: `POST /api/execute/prepare` endpoint (after line 280)
   - Add: `POST /api/execute/submit` endpoint (after prepare endpoint)
   - Changes:
     - Import `ethTestnetExecutor` and `config`
     - Check `EXECUTION_MODE` before calling executor
   - Line: After line 280 (after `/api/chat` endpoint)

4. **`agent/src/types/blossom.ts`** (MODIFY - Optional)
   - Add: Swap fields to `BlossomAction` type (if swap support needed)
   - Line: After line 26 (extend `defi` action type)

5. **`src/context/BlossomContext.tsx`** (MODIFY - Optional)
   - Add: `txHash?: string` to `Strategy` interface (line 8-39)
   - Add: `txHash?: string` to `DefiPosition` interface (line 61-70)
   - Purpose: Store transaction hash after testnet execution

### Files NOT to Touch

- ❌ `src/components/MessageBubble.tsx` - UI rendering (no changes)
- ❌ `src/components/ConfirmTradeCard.tsx` - UI component (no changes)
- ❌ `agent/src/plugins/perps-sim/index.ts` - Keep for simulation fallback
- ❌ `agent/src/plugins/defi-sim/index.ts` - Keep for simulation fallback
- ❌ `agent/src/plugins/event-sim/index.ts` - Keep for simulation fallback
- ❌ `src/lib/mockParser.ts` - Intent parsing (no changes)
- ❌ `src/lib/riskIntent.ts` - Risk detection (no changes)

---

## Summary

**Data Available in `handleConfirmTrade()`**:
- ✅ `draftId: string` (argument)
- ✅ `executedStrategy: Strategy | undefined` (via `strategies.find()`)
- ✅ `account: AccountState` (account value, balances)
- ✅ `venue: 'hyperliquid' | 'event_demo'` (current venue)
- ✅ Full `Strategy` object with all fields (market, side, riskPercent, leverage, marginUsd, notionalUsd, etc.)

**Backend `BlossomAction` Type**:
- ✅ Location: `agent/src/types/blossom.ts:6-40`
- ✅ DeFi action has: `protocol`, `asset`, `amountUsd`, `apr`
- ❌ No swap fields (would need type extension for swap operations)

**Config Utilities**:
- ✅ Frontend: `src/lib/config.ts` (uses `import.meta.env.VITE_*`)
- ✅ Backend: Direct `process.env` reads (no centralized config file yet)

**Integration Points**:
- **Primary**: `Chat.tsx:handleConfirmTrade()` - Add testnet execution path
- **Backend**: `agent/src/server/http.ts` - Add `/api/execute` endpoints
- **New Module**: `agent/src/executors/ethTestnetExecutor.ts` - Testnet execution logic

---

**Report Generated**: 2025-12-28  
**Status**: ✅ Read-only audit complete


