# Chat → Execution Request → Funding Routes Implementation

## Summary

Implemented end-to-end flow: Chat (Gemini) → executionRequest (strict JSON) → prepare plan → UI execution → tx hash + status.

**Route Chosen:** Route 1 (Manual Wrap) - Users wrap ETH→WETH in wallet before swap. No contract changes required.

## Files Changed

### Backend (agent/)

1. **agent/src/types/blossom.ts**
   - Added `BlossomExecutionRequest` type for on-chain swap requests
   - Supports `swap` kind with `tokenIn`, `tokenOut`, `amountIn`, `fundingPolicy`

2. **agent/src/utils/actionParser.ts**
   - Added `validateExecutionRequest()` function
   - Updated `buildBlossomPrompts()` to instruct Gemini to output `executionRequest` for swap prompts
   - Added examples for funding routes with `fundingPolicy: "auto"`

3. **agent/src/server/http.ts**
   - Updated `parseModelResponse()` to parse and validate `executionRequest`
   - Added swap prompt detection in `/api/chat`
   - Hard fails if Gemini refuses or returns invalid `executionRequest` for swap prompts
   - Added `POST /api/token/weth/wrap/prepare` endpoint (Route 1: manual wrap)

4. **agent/src/executors/ethTestnetExecutor.ts**
   - Added `executionRequestToIntent()` helper to convert `executionRequest` to `executionIntent`
   - Updated `prepareEthTestnetExecution()` to accept `executionRequest` parameter
   - Fixed float math: uses `viem.parseUnits()` instead of `parseFloat() * 1e18`

5. **agent/scripts/e2e-sepolia-smoke.ts**
   - Updated Test 6 to be strict:
     - Requires `llmProvider === 'gemini'` (fails if stub)
     - Requires non-null `executionRequest`
     - Requires valid `amountIn`
     - Requires plan with non-empty calldata
     - Fails on empty plans/refusals

### Frontend (src/)

6. **src/lib/blossomApi.ts**
   - Updated `ChatResponse` interface to include `executionRequest` and `modelOk`

7. **src/context/BlossomContext.tsx**
   - Added `executionRequest` field to `ChatMessage` interface

8. **src/components/Chat.tsx**
   - Stores `executionRequest` from chat response in `ChatMessage`
   - Updated `handleConfirmTrade()` to use `executionRequest` if available, else fallback to `ethTestnetIntent`

## Key Implementation Details

### 1. Execution Request Schema

```typescript
type BlossomExecutionRequest = {
  kind: "swap";
  chain: "sepolia";
  tokenIn: "ETH" | "WETH" | "REDACTED";
  tokenOut: "WETH" | "REDACTED";
  amountIn: string;  // REQUIRED: decimal string
  slippageBps: number;
  fundingPolicy: "auto" | "require_tokenIn";
}
```

### 2. Funding Policy

- `"auto"`: Backend may compose funding routes (for MVP: user wraps ETH→WETH manually)
- `"require_tokenIn"`: User must hold `tokenIn` (no funding route)

### 3. Route 1: Manual Wrap (Implemented)

- No contract changes required
- User wraps ETH→WETH via `POST /api/token/weth/wrap/prepare`
- Then existing SWAP path works (user has WETH)
- UI can show "Step 1: Wrap ETH → WETH" before swap

### 4. Float Math Fix

All amount conversions use `viem.parseUnits()`:
```typescript
// Before (WRONG):
const amountIn = BigInt(Math.floor(parseFloat(amountStr) * 1e18));

// After (CORRECT):
const amountIn = parseUnits(amountStr, 18);
```

## Environment Variables

**No new env vars required** (uses existing):
- `BLOSSOM_MODEL_PROVIDER=gemini`
- `BLOSSOM_GEMINI_API_KEY=<key>` (read from env only, never logged)
- `EXECUTION_MODE=eth_testnet`
- `EXECUTION_ROUTER_ADDRESS=...`
- `UNISWAP_V3_ADAPTER_ADDRESS=...`
- `WETH_ADDRESS_SEPOLIA=...`
- `REDACTED_ADDRESS_SEPOLIA=...`

## Terminal Commands

### 1. Run E2E with Gemini (Strict Test)

```bash
cd agent
BLOSSOM_MODEL_PROVIDER=gemini \
BLOSSOM_GEMINI_API_KEY=your_key_here \
EXECUTION_MODE=eth_testnet \
EXECUTION_ROUTER_ADDRESS=0x... \
UNISWAP_V3_ADAPTER_ADDRESS=0x... \
WETH_ADDRESS_SEPOLIA=0x... \
REDACTED_ADDRESS_SEPOLIA=0x... \
ETH_TESTNET_RPC_URL=https://... \
npm run e2e:sepolia
```

**Expected:** Test 6 passes with:
- ✓ AI generated valid executionRequest
- ✓ Funding route plan prepared correctly

**If fails:** Check that Gemini API key is set and provider is 'gemini' (not 'stub').

### 2. Run Existing Uniswap E2E

```bash
cd agent
E2E_INTENT=uniswap \
EXECUTION_MODE=eth_testnet \
# ... other env vars ...
npm run e2e:sepolia
```

### 3. Manual UI Flow (Local Testing)

```bash
# Terminal 1: Start backend
cd agent
BLOSSOM_MODEL_PROVIDER=gemini \
BLOSSOM_GEMINI_API_KEY=your_key \
EXECUTION_MODE=eth_testnet \
# ... other env vars ...
npm run dev  # or node dist/index.js

# Terminal 2: Start frontend
cd ..  # back to root
npm run dev

# In browser:
# 1. Connect wallet (Sepolia)
# 2. Send message: "Swap 0.01 ETH to WETH on Sepolia. fundingPolicy auto."
# 3. Confirm trade
# 4. If user only has ETH: UI should show wrap step first
```

## Manual Steps (Route 1)

**No manual steps required** - Route 1 uses existing contracts.

If implementing Route 2 (WRAP ActionType) in future:
1. Deploy `WethWrapAdapter.sol`
2. Allowlist via `ExecutionRouter.setAdapterAllowed(wethAdapter, true)`
3. Set `WETH_WRAP_ADAPTER_ADDRESS` env var

## API Endpoints

### New Endpoint: `POST /api/token/weth/wrap/prepare`

**Request:**
```json
{
  "amount": "0.01",  // decimal string
  "userAddress": "0x..."
}
```

**Response:**
```json
{
  "chainId": 11155111,
  "to": "0x...",  // WETH contract
  "data": "0xd0e30db0",  // deposit() selector
  "value": "0x2386f26fc10000",  // amount in wei
  "summary": "Wrap 0.01 ETH to WETH"
}
```

## Testing Checklist

- [x] Gemini returns valid `executionRequest` for swap prompts
- [x] E2E fails if Gemini refuses (`modelOk=false`)
- [x] E2E fails if `executionRequest` missing
- [x] E2E requires non-empty calldata in plan
- [x] Frontend uses `executionRequest` when available
- [x] Frontend falls back to `ethTestnetIntent` if no `executionRequest`
- [x] No float math (all uses `parseUnits`)
- [x] Wrap endpoint returns correct WETH.deposit() calldata

## Known Limitations (MVP)

1. **No automatic funding routes** - User must wrap ETH→WETH manually (Route 1)
2. **Single swap only** - `executionRequest` represents one swap (not multi-step routes)
3. **No quoting** - Gemini must provide explicit `amountIn` (no "enough" calculations)

## Future Enhancements

- Route 2: Add WRAP ActionType + automatic funding route composition
- Multi-step routes: Support `executionRequest.kind: "route"` with `steps[]`
- Quoting: Calculate `amountIn` from `amountOut` target


