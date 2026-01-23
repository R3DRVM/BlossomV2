# Local Runbook: Chat → Execution Request → Funding Routes

## A) Implementation Proof

### Git Diffs

**Files Changed:**
- `agent/src/types/blossom.ts` - Added `BlossomExecutionRequest` type
- `agent/src/utils/actionParser.ts` - Added validation + updated prompts
- `agent/src/server/http.ts` - Updated chat endpoint + added wrap endpoint
- `agent/src/executors/ethTestnetExecutor.ts` - Added executionRequest support + fixed float math
- `agent/scripts/e2e-sepolia-smoke.ts` - Made E2E strict (fails on empty plans)
- `src/lib/blossomApi.ts` - Added executionRequest to ChatResponse
- `src/context/BlossomContext.tsx` - Added executionRequest to ChatMessage
- `src/components/Chat.tsx` - Wired executionRequest + wrap step

**See:** `git diff --stat` and `git diff` output above.

### New Endpoint: `POST /api/token/weth/wrap/prepare`

**Location:** `agent/src/server/http.ts` lines 964-1010

**Request:**
```json
{
  "amount": "0.01",  // decimal string (ETH amount)
  "userAddress": "0x..."
}
```

**Response:**
```json
{
  "chainId": 11155111,
  "to": "0x...",  // WETH_ADDRESS_SEPOLIA
  "data": "0xd0e30db0",  // WETH.deposit() selector
  "value": "0x2386f26fc10000",  // amount in wei (parseUnits(amount, 18))
  "summary": "Wrap 0.01 ETH to WETH"
}
```

---

## B) Local Run Commands

### Backend (Port 3002)

```bash
cd agent

# Set environment variables
export BLOSSOM_MODEL_PROVIDER=gemini
export BLOSSOM_GEMINI_API_KEY=your_key_here
export EXECUTION_MODE=eth_testnet
export EXECUTION_ROUTER_ADDRESS=0x...
export UNISWAP_V3_ADAPTER_ADDRESS=0x...
export WETH_ADDRESS_SEPOLIA=0x...
export USDC_ADDRESS_SEPOLIA=0x...
export ETH_TESTNET_RPC_URL=https://sepolia.infura.io/v3/... # or public RPC

# Start backend
PORT=3002 npm run dev
# or
PORT=3002 node dist/index.js
```

**Expected output:**
```
🌸 Blossom Agent server running on http://localhost:3002
   API endpoints:
   - POST /api/chat
   - POST /api/execute/prepare
   - POST /api/token/weth/wrap/prepare
   ...
```

### Frontend (Vite 5173)

```bash
# From project root
export VITE_USE_AGENT_BACKEND=true
export VITE_EXECUTION_MODE=eth_testnet
export VITE_ETH_TESTNET_RPC_URL=https://sepolia.infura.io/v3/...

npm run dev
```

**Expected output:**
```
  VITE v5.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

---

## C) UI Test Flow: ETH-Only Scenario

### Prerequisites
1. Backend running on `http://localhost:3002`
2. Frontend running on `http://localhost:5173`
3. MetaMask connected to Sepolia testnet
4. Wallet has ETH but **no WETH** (or very little)

### Test Steps

1. **Open UI:** Navigate to `http://localhost:5173`

2. **Connect Wallet:** Click "Connect Wallet" → Select MetaMask → Approve connection

3. **Send Chat Message:**
   ```
   Swap 0.01 ETH to WETH on Sepolia
   ```

4. **Expected Chat Response:**
   - Gemini returns `executionRequest` with:
     - `kind: "swap"`
     - `tokenIn: "ETH"`
     - `tokenOut: "WETH"`
     - `amountIn: "0.01"`
     - `fundingPolicy: "auto"` (or default)

5. **Confirm Trade:** Click "Confirm" on the strategy card

6. **Expected Flow:**
   - **Step 1: Wrap** (if user has ETH but no WETH)
     - UI shows: "Wrapping 0.01 ETH → WETH..."
     - MetaMask popup: Wrap transaction (to WETH contract, value = 0.01 ETH)
     - User approves → Transaction sent
     - UI waits for confirmation (polls `/api/execute/status`)
     - On confirmation: "✅ Wrapped 0.01 ETH → WETH. Proceeding to swap..."
   
   - **Step 2: Approve** (if needed)
     - UI shows approval transaction
     - MetaMask popup: Approve WETH spending
     - User approves → Transaction sent
   
   - **Step 3: Swap**
     - UI shows swap transaction
     - MetaMask popup: Execute swap via ExecutionRouter
     - User approves → Transaction sent
     - UI polls status → Shows "✅ Confirmed" with tx hash

7. **Verify:**
   - Check portfolio: Should show WETH balance increased
   - Check transaction on Sepolia explorer
   - All steps completed atomically (wrap → approve → swap)

### Error Cases to Test

1. **Wrap Rejection:**
   - User rejects wrap transaction
   - Expected: Error message, strategy remains pending, no swap attempted

2. **Wrap Failure:**
   - Wrap transaction reverts (e.g., insufficient ETH)
   - Expected: Error message after 60s timeout, strategy remains pending

3. **Insufficient ETH:**
   - User has < 0.01 ETH
   - Expected: Backend returns warning, UI shows error before wrap

---

## D) Strict E2E Test

### Command

```bash
cd agent

BLOSSOM_MODEL_PROVIDER=gemini \
BLOSSOM_GEMINI_API_KEY=your_key_here \
EXECUTION_MODE=eth_testnet \
EXECUTION_ROUTER_ADDRESS=0x... \
UNISWAP_V3_ADAPTER_ADDRESS=0x... \
WETH_ADDRESS_SEPOLIA=0x... \
USDC_ADDRESS_SEPOLIA=0x... \
ETH_TESTNET_RPC_URL=https://... \
npm run e2e:sepolia
```

### Expected Test Results

**Test 6: AI-Driven Plan Generation (Strict)**
- ✓ LLM Provider: gemini
- ✓ AI generated valid executionRequest for ETH-only scenario
- ✓ executionRequest.amountIn present and parseable
- ✓ fundingPolicy defaults to auto if not provided

**Test 6b: WETH Wrap Endpoint**
- ✓ Wrap response has required fields (to, data, value)
- ✓ to equals WETH_ADDRESS_SEPOLIA
- ✓ data equals 0xd0e30db0 (WETH.deposit() selector)
- ✓ value equals parseUnits(amountIn, 18)

**Test 6c: Bridge executionRequest → prepare**
- ✓ Plan has SWAP action
- ✓ Swap action has non-empty calldata
- ✓ Adapter is UniswapV3SwapAdapter
- ✓ Approvals returned if needed

### Failure Cases

If any assertion fails, E2E exits with code 1:
- Missing `executionRequest` → FAIL
- Invalid `amountIn` → FAIL
- Missing calldata → FAIL
- Wrong adapter → FAIL

---

## E) Environment Variables

**No new env vars required** - uses existing:

- `BLOSSOM_MODEL_PROVIDER` (gemini)
- `BLOSSOM_GEMINI_API_KEY` (read from env only, never logged)
- `EXECUTION_MODE` (eth_testnet)
- `EXECUTION_ROUTER_ADDRESS`
- `UNISWAP_V3_ADAPTER_ADDRESS`
- `WETH_ADDRESS_SEPOLIA`
- `USDC_ADDRESS_SEPOLIA`
- `ETH_TESTNET_RPC_URL`

---

## F) Verification Checklist

- [x] Gemini returns `executionRequest` for swap prompts
- [x] E2E fails if Gemini refuses (`modelOk=false`)
- [x] E2E fails if `executionRequest` missing
- [x] Wrap endpoint returns correct payload
- [x] UI shows wrap step before swap (if needed)
- [x] Wrap transaction waits for confirmation
- [x] Portfolio refreshes after wrap
- [x] Swap proceeds only after wrap confirms
- [x] Error handling: wrap failure stops execution
- [x] No float math (all uses `parseUnits`)

---

## G) Troubleshooting

### Backend won't start
- Check all env vars are set
- Verify `BLOSSOM_GEMINI_API_KEY` is valid
- Check port 3002 is available

### Frontend can't connect
- Verify `VITE_USE_AGENT_BACKEND=true`
- Check backend is running on port 3002
- Check CORS (backend should allow all origins)

### Gemini returns empty executionRequest
- Check API key is set correctly
- Verify prompt includes "swap" + token names
- Check backend logs for parse errors

### Wrap step not showing
- Verify user has ETH but no WETH
- Check portfolio endpoint returns correct balances
- Verify `executionRequest.tokenIn === "ETH"`

### Wrap transaction fails
- Check user has sufficient ETH (amount + gas)
- Verify WETH contract address is correct
- Check Sepolia network is selected in MetaMask


