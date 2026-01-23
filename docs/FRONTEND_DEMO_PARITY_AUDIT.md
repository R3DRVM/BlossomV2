# Frontend "Demo Parity" Read-Only Audit

**Purpose:** Identify what must change to point UI at testnet backend while preserving demo UX.

---

## 1. How Demo Creates "Starting Balances"

### Location: `src/context/BlossomContext.tsx`

**Lines 240-253:**
```typescript
const INITIAL_BALANCES: AssetBalance[] = [
  { symbol: 'REDACTED', balanceUsd: 4000 },
  { symbol: 'ETH', balanceUsd: 3000 },
  { symbol: 'SOL', balanceUsd: 3000 },
];

const INITIAL_ACCOUNT: AccountState = {
  accountValue: 10000,
  openPerpExposure: 0,
  eventExposureUsd: 0,
  totalPnlPct: 0,
  simulatedPnlPct30d: 0,
  balances: INITIAL_BALANCES,
};
```

**How it's used:**
- Initialized in `BlossomProvider` component
- Used as default `account` state
- Overwritten by backend portfolio sync in `eth_testnet` mode (lines 1400-1491)

**Components that render balances:**
- Portfolio panel (RightPanel or similar)
- Account value display
- Balance cards in UI

---

## 2. Simulated vs On-Chain Decision

### Location: `src/lib/config.ts`

**Lines 5-20:**
```typescript
export const USE_AGENT_BACKEND = import.meta.env.VITE_USE_AGENT_BACKEND === 'true';
export const executionMode: string = import.meta.env.VITE_EXECUTION_MODE || 'sim';
export const ethTestnetChainId = 11155111; // Sepolia
export const ethTestnetRpcUrl = import.meta.env.VITE_ETH_TESTNET_RPC_URL;
export const executionAuthMode: 'direct' | 'session' = 
  (import.meta.env.VITE_EXECUTION_AUTH_MODE as 'direct' | 'session') || 'direct';
export const ethTestnetIntent: 'mock' | 'swap_usdc_weth' | 'swap_weth_usdc' =
  (import.meta.env.VITE_ETH_TESTNET_INTENT as 'mock' | 'swap_usdc_weth' | 'swap_weth_usdc') || 'mock';
```

**Decision logic:**
- `executionMode === 'eth_testnet'` → Use on-chain execution
- `executionMode === 'sim'` → Use simulated execution (default)

### Location: `src/lib/apiClient.ts`

**Line 6:**
```typescript
export const AGENT_API_BASE_URL = import.meta.env.VITE_AGENT_API_URL ?? 'http://localhost:3001';
```

**Current behavior:**
- Defaults to `http://localhost:3001`
- Can be overridden via `VITE_AGENT_API_URL`

---

## 3. Request/Response Flow

### Flow: User Message → Plan → Confirm → Execute → Tx Hash → Status → Portfolio

**Step 1: User Message → Plan**
- **File:** `src/components/Chat.tsx`
- **Function:** `handleSendMessage()` (around line 500-800)
- **API Call:** `POST /api/chat` via `callAgent('/api/chat', ...)`
- **Request:** `{ userMessage, venue, clientPortfolio }`
- **Response:** `{ assistantMessage, actions, portfolio }`
- **Condition:** Uses `USE_AGENT_BACKEND` flag (line 8)

**Step 2: Plan → Confirm**
- **File:** `src/components/Chat.tsx`
- **Component:** `ConfirmTradeCard` (imported line 17)
- **Trigger:** User clicks "Confirm & Execute"
- **Function:** `handleConfirmTrade()` (around line 2580-3300)

**Step 3: Confirm → Execute (Direct Mode)**
- **File:** `src/components/Chat.tsx`
- **Lines:** 2992-3210
- **Flow:**
  1. Call `POST /api/execute/prepare` with `{ draftId, userAddress, strategy, executionIntent, authMode }`
  2. Check `requirements.approvals` → Auto-approve if needed (lines 3010-3080)
  3. Re-prepare after approvals (line 3086)
  4. Encode EIP-712 typed data (lines 3100-3160)
  5. Call `sendTransaction()` from `walletAdapter.ts` (line 3170)
  6. Get `txHash` from wallet
  7. Call `POST /api/execute/submit` with `{ draftId, txHash }` (line 3187)
  8. Call `pollTransactionStatus(txHash, targetChatId)` (line 3208)

**Step 4: Confirm → Execute (Session Mode)**
- **File:** `src/components/Chat.tsx`
- **Lines:** 2750-2988
- **Flow:**
  1. Check if session exists (localStorage, line 2740)
  2. If not: Call `POST /api/session/prepare` → User signs session creation tx (lines 2750-2798)
  3. If exists: Call `POST /api/execute/prepare` with `authMode: 'session'` (line 2801)
  4. Check approvals (same as direct mode, lines 2810-2890)
  5. Call `POST /api/execute/relayed` with `{ draftId, userAddress, plan, sessionId }` (line 2940)
  6. Get `txHash` from backend
  7. Call `POST /api/execute/submit` (line 2963)
  8. Call `pollTransactionStatus(txHash, targetChatId)` (line 2988)

**Step 5: Tx Hash → Status Polling**
- **File:** `src/components/Chat.tsx`
- **Function:** `pollTransactionStatus()` (lines 2584-2673)
- **Flow:**
  1. Immediately append "Submitted on Sepolia: <txHash>" message (line 2589)
  2. Poll `GET /api/execute/status?txHash=...` every 2s for up to 60s (line 2606)
  3. On `confirmed`: Append "Confirmed on Sepolia: <txHash>" (line 2646)
  4. On `reverted`: Append "Reverted on Sepolia: <txHash>" (line 2648)
  5. On timeout: Append "Still pending: <txHash> (check explorer)" (line 2615)

**Step 6: Status → Portfolio Refresh**
- **File:** `src/context/BlossomContext.tsx`
- **Lines:** 1390-1491
- **Flow:**
  1. `useEffect` hook runs when `executionMode === 'eth_testnet'` (line 1390)
  2. Polls `GET /api/portfolio/eth_testnet?userAddress=...` every 15s (line 1483)
  3. Merges real balances (REDACTED, WETH, ETH) with simulated balances (DEFI, etc.)
  4. Updates `account` state (line 1465)
  5. UI automatically re-renders with new balances

---

## 4. Required Changes Checklist

### A. Base URL Configuration

**File:** `src/lib/apiClient.ts`
- **Line 6:** Change default or use `VITE_AGENT_API_URL`
- **Action:** Set `VITE_AGENT_API_URL=http://localhost:3002` (or production URL)

**File:** `src/lib/config.ts`
- **Line 6:** `VITE_USE_AGENT_BACKEND` must be `true` for backend calls
- **Line 8:** `VITE_EXECUTION_MODE=eth_testnet` to enable testnet mode
- **Line 13:** `VITE_ETH_TESTNET_RPC_URL` (optional, for frontend wallet operations)

---

### B. Balance Switching (Simulated → Real Wallet)

**File:** `src/context/BlossomContext.tsx`
- **Lines 1390-1491:** Already implemented! ✅
- **Condition:** `executionMode === 'eth_testnet'` (line 1390)
- **Behavior:** 
  - Polls `/api/portfolio/eth_testnet` every 15s
  - Merges real balances (REDACTED, WETH, ETH) with simulated (DEFI)
  - Preserves existing simulated positions

**No changes needed** - Already works!

---

### C. Transaction Hash Surfacing

**File:** `src/components/Chat.tsx`
- **Lines 2584-2673:** Already implemented! ✅
- **Function:** `pollTransactionStatus()` already appends messages to chat
- **Messages:** "Submitted", "Confirmed", "Reverted", "Still pending"

**No changes needed** - Already works!

---

### D. Wallet Connection

**File:** `src/lib/walletAdapter.ts`
- **Lines 45-64:** `connectWallet()` uses `window.ethereum`
- **Lines 71-87:** `getAddress()` gets current connected address
- **Lines 96-133:** `sendTransaction()` sends via MetaMask

**Current behavior:**
- Requires MetaMask or injected wallet
- Works with any injected `window.ethereum` provider

**For testnet MVP:**
- ✅ Already works with MetaMask on Sepolia
- ✅ No changes needed

---

### E. Execution Intent Routing

**File:** `src/components/Chat.tsx`
- **Line 8:** Imports `ethTestnetIntent` from config
- **Line 2806:** Passes `executionIntent: ethTestnetIntent` to `/api/execute/prepare`
- **Line 2997:** Same for direct mode

**Current behavior:**
- Uses `VITE_ETH_TESTNET_INTENT` env var (default: 'mock')
- Can be set to 'swap_usdc_weth' or 'swap_weth_usdc'

**For testnet MVP:**
- ✅ Already configurable via env var
- ✅ No changes needed

---

## Summary: What Must Change

### Minimal Changes Required:

1. **Environment Variables (`.env.local` or build-time):**
   ```bash
   VITE_USE_AGENT_BACKEND=true
   VITE_EXECUTION_MODE=eth_testnet
   VITE_AGENT_API_URL=http://localhost:3002  # Match backend PORT
   VITE_EXECUTION_AUTH_MODE=direct  # or 'session'
   VITE_ETH_TESTNET_INTENT=mock  # or 'swap_usdc_weth'
   ```

2. **No Code Changes Required:**
   - ✅ Portfolio sync already implemented
   - ✅ Transaction status polling already implemented
   - ✅ Wallet connection already works
   - ✅ Execution flow already supports testnet mode

### Optional Enhancements (Not Required for MVP):

1. **Session Mode UI:**
   - Add session status indicator
   - Add session revocation button
   - Show session expiry countdown

2. **Transaction Explorer Links:**
   - Convert tx hash messages to clickable Sepolia explorer links
   - Format: `https://sepolia.etherscan.io/tx/${txHash}`

3. **Balance Refresh on Tx Confirmation:**
   - Trigger portfolio sync immediately after tx confirmed
   - Currently polls every 15s (acceptable for MVP)

---

## File Paths + Line Ranges Summary

| Component | File | Lines | Change Required |
|-----------|------|-------|----------------|
| Base URL | `src/lib/apiClient.ts` | 6 | Set `VITE_AGENT_API_URL` env var |
| Execution Mode | `src/lib/config.ts` | 8 | Set `VITE_EXECUTION_MODE=eth_testnet` |
| Portfolio Sync | `src/context/BlossomContext.tsx` | 1390-1491 | ✅ Already implemented |
| Tx Status Polling | `src/components/Chat.tsx` | 2584-2673 | ✅ Already implemented |
| Execution Flow | `src/components/Chat.tsx` | 2750-3210 | ✅ Already implemented |
| Wallet Connection | `src/lib/walletAdapter.ts` | 45-133 | ✅ Already works |

**Verdict:** Frontend is already testnet-ready! Only env vars need to be set.

