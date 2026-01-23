# Route 2 Implementation: Atomic Funding Routes

## Summary

Implemented Route 2 (atomic funding routes) where ETH-only users can execute swaps in a single plan + single transaction. The system composes WRAP(ETH→WETH) + SWAP(WETH→tokenOut) actions atomically.

---

## A) Contract Changes

### 1. PlanTypes.sol
**File:** `contracts/src/PlanTypes.sol`

**Change:** Added `WRAP` to `ActionType` enum:
```solidity
enum ActionType {
    SWAP,
    WRAP,  // For ETH → WETH wrapping
    LEND_SUPPLY,
    LEND_BORROW,
    EVENT_BUY
}
```

### 2. WethWrapAdapter.sol (NEW)
**File:** `contracts/src/adapters/WethWrapAdapter.sol`

**Implementation:**
- Receives ETH via `msg.value`
- Calls `WETH.deposit()` to wrap ETH → WETH
- Transfers WETH to recipient (router or user)
- Returns amount wrapped

**Key methods:**
- `execute(bytes calldata innerData)`: Wraps ETH, transfers WETH to recipient
  - `innerData`: ABI-encoded `(address recipient)`

### 3. ExecutionRouter.sol
**File:** `contracts/src/ExecutionRouter.sol`

**Changes:**
1. Added `_executeWrapAction()`:
   - Forwards `msg.value` to WETH adapter
   - Adapter wraps ETH and transfers WETH to recipient
   - Emits `ActionExecuted` event

2. Updated `_executeSwapAction()`:
   - Checks if router already has `tokenIn` (from previous WRAP)
   - If router has enough, uses router's balance (no pull from user)
   - If not, pulls from user as before

3. Session mode: WRAP not supported (would need ETH in router)

### 4. DeploySepolia.s.sol
**File:** `contracts/script/DeploySepolia.s.sol`

**Changes:**
- Deploys `WethWrapAdapter` if `SEPOLIA_WETH_ADDRESS` is set
- Allowlists adapter in router
- Outputs `WETH_WRAP_ADAPTER_ADDRESS`

---

## B) Backend Changes

### 1. config.ts
**File:** `agent/src/config.ts`

**Change:** Added `WETH_WRAP_ADAPTER_ADDRESS` env var

### 2. ethTestnetExecutor.ts
**File:** `agent/src/executors/ethTestnetExecutor.ts`

**Changes:**
1. **Funding Route Detection:**
   - Detects when `executionRequest.tokenIn === "ETH"` and `fundingPolicy === "auto"`
   - Requires `WETH_WRAP_ADAPTER_ADDRESS` to be configured

2. **Action Composition:**
   - **Step 1 (WRAP):** Wraps ETH → WETH, transfers to router (if swap needed) or user (if tokenOut is WETH)
   - **Step 2 (SWAP):** Only if `tokenOut !== "WETH"`, swaps WETH → tokenOut
   - Sets `planValue` to wrap amount (user sends ETH with transaction)

3. **Warnings:**
   - Adds `FUNDING_ROUTE` warning explaining the atomic route

---

## C) Frontend Changes

### 1. config.ts
**File:** `src/lib/config.ts`

**Change:** Added `fundingRouteMode` feature flag:
```typescript
export const fundingRouteMode: 'manual' | 'atomic' =
  (import.meta.env.VITE_FUNDING_ROUTE_MODE as 'manual' | 'atomic') || 'manual';
```

### 2. Chat.tsx
**File:** `src/components/Chat.tsx`

**Changes:**
- Skips manual wrap step if `fundingRouteMode === 'atomic'`
- In atomic mode, plan includes WRAP action, so no separate wrap transaction needed
- In manual mode, keeps existing wrap step (Route 1)

---

## D) E2E Test Updates

### e2e-sepolia-smoke.ts
**File:** `agent/scripts/e2e-sepolia-smoke.ts`

**Changes:**
1. Added `E2E_INTENT` env var support (defaults to `swap_usdc_weth`)
2. Added `funding_route` intent:
   - Uses prompt: "I only have ETH. Swap 0.01 ETH to WETH."
   - Asserts plan includes WRAP as first action
   - Asserts SWAP as second action (if tokenOut !== WETH)
   - Asserts `value > 0` for WRAP
   - Asserts wrap adapter is correct

---

## E) Deployment Commands

### Deploy Contracts

```bash
cd contracts

# Set environment variables
export SEPOLIA_WETH_ADDRESS=0x...  # WETH contract on Sepolia
export SEPOLIA_UNISWAP_V3_ROUTER=0x...  # Uniswap V3 Router

# Deploy
forge script script/DeploySepolia.s.sol:DeploySepolia \
  --rpc-url $SEPOLIA_RPC_URL \
  --broadcast \
  --verify \
  -vvvv

# Copy output addresses:
# EXECUTION_ROUTER_ADDRESS=0x...
# WETH_WRAP_ADAPTER_ADDRESS=0x...
# UNISWAP_V3_ADAPTER_ADDRESS=0x...
```

### Backend Config

Add to `.env`:
```bash
WETH_WRAP_ADAPTER_ADDRESS=0x...  # From deploy output
```

### Frontend Config

For atomic mode:
```bash
VITE_FUNDING_ROUTE_MODE=atomic
```

For manual mode (default):
```bash
VITE_FUNDING_ROUTE_MODE=manual
# or omit (defaults to manual)
```

---

## F) E2E Test Commands

### Test Funding Route (Atomic)

```bash
cd agent

BLOSSOM_MODEL_PROVIDER=gemini \
BLOSSOM_GEMINI_API_KEY=your_key \
EXECUTION_MODE=eth_testnet \
EXECUTION_ROUTER_ADDRESS=0x... \
UNISWAP_V3_ADAPTER_ADDRESS=0x... \
WETH_WRAP_ADAPTER_ADDRESS=0x... \
WETH_ADDRESS_SEPOLIA=0x... \
REDACTED_ADDRESS_SEPOLIA=0x... \
ETH_TESTNET_RPC_URL=https://... \
E2E_INTENT=funding_route \
npm run e2e:sepolia
```

**Expected:**
- ✓ AI generates `executionRequest` with `tokenIn: "ETH"`
- ✓ Plan includes WRAP as first action
- ✓ Plan includes SWAP as second action (if tokenOut !== WETH)
- ✓ Plan `value > 0` (for WRAP)
- ✓ Wrap adapter is correct

### Test Regular Swap

```bash
E2E_INTENT=uniswap npm run e2e:sepolia
```

---

## G) Manual Verification Checklist

### MetaMask Verification (Once)

When testing atomic funding route in UI:

1. **Connect Wallet:** MetaMask → Sepolia
2. **Send Prompt:** "Swap 0.01 ETH to WETH on Sepolia"
3. **Confirm Trade:** Click confirm
4. **MetaMask Popup:**
   - **Transaction shows:**
     - `to`: ExecutionRouter address
     - `value`: 0.01 ETH (or wrap amount)
     - `data`: Plan calldata (includes WRAP + SWAP actions)
   - **Approve transaction**
5. **Verify:**
   - Transaction succeeds
   - Portfolio shows WETH balance increased
   - Explorer shows single transaction with both actions

### Expected Transaction Flow

**Atomic Mode (Route 2):**
1. User sends 1 transaction to ExecutionRouter
2. Router executes: WRAP(ETH→WETH) → SWAP(WETH→tokenOut)
3. All in one transaction, atomic

**Manual Mode (Route 1):**
1. User sends wrap transaction (separate)
2. Wait for confirmation
3. User sends swap transaction (separate)

---

## H) Key Differences: Route 1 vs Route 2

| Feature | Route 1 (Manual) | Route 2 (Atomic) |
|---------|------------------|------------------|
| **Transactions** | 2 (wrap + swap) | 1 (combined) |
| **User Experience** | Multi-step, requires waiting | Single-step, seamless |
| **Contract Changes** | None (uses existing WETH contract) | Requires WethWrapAdapter |
| **Frontend Flag** | `VITE_FUNDING_ROUTE_MODE=manual` | `VITE_FUNDING_ROUTE_MODE=atomic` |
| **E2E Intent** | N/A (uses uniswap) | `E2E_INTENT=funding_route` |
| **Plan Actions** | Swap only | WRAP + SWAP |

---

## I) Files Changed

**Contracts:**
- `contracts/src/PlanTypes.sol` - Added WRAP ActionType
- `contracts/src/adapters/WethWrapAdapter.sol` - NEW
- `contracts/src/ExecutionRouter.sol` - Added WRAP handling, updated SWAP to use router balance
- `contracts/script/DeploySepolia.s.sol` - Deploy WethWrapAdapter

**Backend:**
- `agent/src/config.ts` - Added WETH_WRAP_ADAPTER_ADDRESS
- `agent/src/executors/ethTestnetExecutor.ts` - Funding route composition

**Frontend:**
- `src/lib/config.ts` - Added fundingRouteMode flag
- `src/components/Chat.tsx` - Skip manual wrap in atomic mode

**Tests:**
- `agent/scripts/e2e-sepolia-smoke.ts` - Added funding_route intent test

---

## J) Environment Variables

**New:**
- `WETH_WRAP_ADAPTER_ADDRESS` - WethWrapAdapter contract address (backend)
- `VITE_FUNDING_ROUTE_MODE` - `manual` or `atomic` (frontend, defaults to `manual`)

**Existing (still required):**
- `EXECUTION_ROUTER_ADDRESS`
- `UNISWAP_V3_ADAPTER_ADDRESS`
- `WETH_ADDRESS_SEPOLIA`
- `REDACTED_ADDRESS_SEPOLIA`
- `ETH_TESTNET_RPC_URL`
- `BLOSSOM_GEMINI_API_KEY` (for E2E)

---

## K) Testing Status

✅ Contracts compiled
✅ Backend executor composes funding routes
✅ Frontend respects feature flag
✅ E2E test added for funding_route intent
⏳ Manual MetaMask verification pending (user must test)

---

## L) Next Steps

1. **Deploy WethWrapAdapter** to Sepolia
2. **Set backend env:** `WETH_WRAP_ADAPTER_ADDRESS`
3. **Set frontend env:** `VITE_FUNDING_ROUTE_MODE=atomic` (optional, defaults to manual)
4. **Run E2E:** `E2E_INTENT=funding_route npm run e2e:sepolia`
5. **Manual test:** UI flow with MetaMask

---

## M) Known Limitations

1. **Session Mode:** WRAP not supported (would need ETH in router)
2. **Multi-WRAP:** Only one WRAP per plan (MVP limitation)
3. **Value Tracking:** All `msg.value` goes to first WRAP action (MVP limitation)
4. **Slippage:** No slippage protection for funding routes (uses `amountOutMin = 0`)

---

## N) Rollback Plan

If Route 2 causes issues:

1. **Frontend:** Set `VITE_FUNDING_ROUTE_MODE=manual` (or omit)
2. **Backend:** Remove `WETH_WRAP_ADAPTER_ADDRESS` (funding routes won't compose)
3. **System falls back to Route 1** (manual wrap)

Route 1 remains fully functional and is the default.


