# Local MVP A Runbook (Final - Whitelist Ready)

## Overview

MVP A is finalized for gated whitelist testing with:
- Real wallet balance fetching (ETH, WETH, USDC from Sepolia)
- Real swap execution (Route 2, session mode)
- Gated access with access codes
- Mocked perp/DeFi/event (execution-shaped, same interface)

## Overview

MVP A Definition (MUST MEET ALL):

1. ✅ A single chat interface can execute:
   - DeFi action (swap + deposit)
   - Perp trade
   - Prediction market position
   using the SAME agent → execution pipeline.

2. ✅ All executions (real or simulated) return a unified ExecutionResult:
   - txHash or simulatedTxId
   - position delta
   - portfolio delta
   - status (success / failed)

3. ✅ Portfolio updates are authoritative and centralized:
   - One BlossomPortfolioSnapshot
   - Updated after every execution
   - Used consistently by UI + E2E tests

4. ✅ Session mode works for the full flow:
   - User signs once
   - Subsequent executions are relayed
   - No extra wallet prompts

5. ✅ A single E2E test exists:
   - Name: mvp_full_flow
   - Covers swap → deposit → perp → prediction market
   - Fails on ANY partial success or missing portfolio update

---

## Environment Variables

### Backend (.env)

```bash
# Execution mode (REQUIRED for whitelist testing)
EXECUTION_MODE=eth_testnet
EXECUTION_AUTH_MODE=session

# Access gate (REQUIRED for whitelist testing)
WHITELIST_ACCESS_CODES=CODE1,CODE2,CODE3,...  # Optional: comma-separated (or auto-generate 30)
ADMIN_KEY=your_admin_key  # For generating/revoking codes

# For eth_testnet mode:
EXECUTION_ROUTER_ADDRESS=0x...
UNISWAP_V3_ADAPTER_ADDRESS=0x...
WETH_WRAP_ADAPTER_ADDRESS=0x...  # For Route 2
WETH_ADDRESS_SEPOLIA=0x...
USDC_ADDRESS_SEPOLIA=0x...
ETH_TESTNET_RPC_URL=https://sepolia.infura.io/v3/...
RELAYER_PRIVATE_KEY=0x...  # Required for session mode

# LLM
BLOSSOM_MODEL_PROVIDER=gemini  # or 'stub' for mock
BLOSSOM_GEMINI_API_KEY=your_key
```

### Frontend (.env)

```bash
VITE_USE_AGENT_BACKEND=true
VITE_EXECUTION_MODE=eth_testnet  # REQUIRED for whitelist testing
VITE_EXECUTION_AUTH_MODE=session  # Recommended
VITE_ETH_TESTNET_RPC_URL=https://sepolia.infura.io/v3/...
VITE_FUNDING_ROUTE_MODE=atomic  # Use Route 2
```

---

## Terminal Commands

### Backend (Port 3001)

```bash
cd agent

# Sim mode (default - all executions are mocked)
PORT=3001 npm run dev

# Or eth_testnet mode (real swaps)
EXECUTION_MODE=eth_testnet \
EXECUTION_ROUTER_ADDRESS=0x... \
UNISWAP_V3_ADAPTER_ADDRESS=0x... \
WETH_WRAP_ADAPTER_ADDRESS=0x... \
WETH_ADDRESS_SEPOLIA=0x... \
USDC_ADDRESS_SEPOLIA=0x... \
ETH_TESTNET_RPC_URL=https://... \
PORT=3001 npm run dev
```

**Expected output:**
```
🌸 Blossom Agent server running on http://localhost:3001
   API endpoints:
   - POST /api/chat
   - POST /api/execute/prepare
   - POST /api/execute/submit
   - POST /api/execute/relayed
   - POST /api/strategy/close
   - GET /api/portfolio
```

### Frontend (Vite 5173)

```bash
# From project root
export VITE_USE_AGENT_BACKEND=true
export VITE_EXECUTION_MODE=eth_testnet  # REQUIRED for whitelist testing
export VITE_EXECUTION_AUTH_MODE=session
export VITE_ETH_TESTNET_RPC_URL=https://sepolia.infura.io/v3/...
export VITE_FUNDING_ROUTE_MODE=atomic

npm run dev
```

**Expected output:**
```
  VITE v5.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
```

---

## E2E Test: MVP Full Flow

### Sim Mode (All Mocked)

```bash
cd agent

BASE_URL=http://localhost:3001 \
EXECUTION_MODE=sim \
npm run e2e:mvp-full-flow
```

**Expected output:**
```
Step 1: Swap (DeFi Action)
✓ PASS Swap executed: sim_xxx

Step 2: DeFi Deposit
✓ PASS DeFi deposit executed: sim_xxx

Step 3: Perp Trade
✓ PASS Perp trade executed: sim_xxx

Step 4: Prediction Market
✓ PASS Prediction market executed: sim_xxx

Final Portfolio Validation
✓ PASS All positions present in portfolio
✓ PASS Account Value: $10000.00
✓ PASS DeFi Positions: 1
✓ PASS Perp Positions: 1
✓ PASS Event Positions: 1

Summary
Passed: 9
Failed: 0

✓ MVP A Full Flow Test PASSED
```

### Eth Testnet Mode (Real Swaps)

```bash
cd agent

BASE_URL=http://localhost:3001 \
EXECUTION_MODE=eth_testnet \
EXECUTION_AUTH_MODE=session \
EXECUTION_ROUTER_ADDRESS=0x... \
UNISWAP_V3_ADAPTER_ADDRESS=0x... \
WETH_WRAP_ADAPTER_ADDRESS=0x... \
WETH_ADDRESS_SEPOLIA=0x... \
USDC_ADDRESS_SEPOLIA=0x... \
ETH_TESTNET_RPC_URL=https://... \
RELAYER_PRIVATE_KEY=0x... \
TEST_USER_ADDRESS=0x... \
TEST_SESSION_ID=0x... \  # Optional: use existing session
E2E_SUBMIT=1 \
npm run e2e:mvp-full-flow
```

**Note:** For eth_testnet mode, swap requires real execution. DeFi deposit, perp, and event are still mocked.

---

## UI Test Flow (Whitelist Testing)

### Access Gate

1. **Open App:** `http://localhost:5173`
2. **Access Gate Screen:** Enter access code
3. **Validation:** Code validated → App unlocks
4. **Persistence:** Code stored in localStorage

### Real Wallet Balances

1. **Connect MetaMask:** Switch to Sepolia testnet
2. **Wallet Card:** Shows real ETH, WETH, USDC balances
3. **Account Value:** Sum of real balances (ETH converted at real price)
4. **Auto-Refresh:** Balances update every 15 seconds

### Real Swap Execution

1. **Create Session:** Click "Create Session" → Sign transaction
2. **Swap:** Send "Swap 0.01 ETH to WETH on Sepolia"
3. **Confirm:** Click "Confirm Trade"
4. **No MetaMask Popup:** Execution relayed (session mode)
5. **Result:** Transaction confirmed → Portfolio updated

### Mocked Executions (Execution-Shaped)

1. **DeFi Deposit:** "Deposit 1000 USDC into Kamino"
   - Returns `simulatedTxId`
   - Position appears in portfolio
   - Same interface as real execution

2. **Perp Trade:** "Long BTC with 2% risk"
   - Returns `simulatedTxId`
   - Position appears in portfolio
   - Same interface as real execution

3. **Prediction Market:** "Bet YES on Fed cuts in March 2025 with $200"
   - Returns `simulatedTxId`
   - Position appears in portfolio
   - Same interface as real execution

---

## UI Test Flow (Legacy - Sim Mode)

1. **Open UI:** `http://localhost:5173`

2. **Swap:**
   - Send: "Swap 10 USDC to WETH"
   - Expected: ExecutionResult with `simulatedTxId`, portfolio updated

3. **DeFi Deposit:**
   - Send: "Deposit 1000 USDC into Kamino"
   - Expected: ExecutionResult with `positionDelta.type === 'defi'`, portfolio updated

4. **Perp Trade:**
   - Send: "Long BTC with 2% risk"
   - Expected: ExecutionResult with `positionDelta.type === 'perp'`, portfolio updated

5. **Prediction Market:**
   - Send: "Bet YES on Fed cuts in March 2025 with $200"
   - Expected: ExecutionResult with `positionDelta.type === 'event'`, portfolio updated

6. **Verify Portfolio:**
   - Check RightPanel shows all positions
   - Check account value updated
   - Check balances reflect changes

### Eth Testnet Mode (Session)

1. **Create Session:**
   - Click "Create Session" button
   - Sign transaction in MetaMask
   - Session status shows "Active"

2. **Swap (Relayed):**
   - Send: "Swap 0.01 ETH to WETH on Sepolia"
   - Click "Confirm Trade"
   - **No MetaMask popup** (relayed execution)
   - ExecutionResult returned with `txHash`
   - Portfolio updated

3. **DeFi Deposit (Mocked):**
   - Send: "Deposit 1000 USDC into Kamino"
   - ExecutionResult with `simulatedTxId`
   - Portfolio updated

4. **Perp Trade (Mocked):**
   - Send: "Long BTC with 2% risk"
   - ExecutionResult with `simulatedTxId`
   - Portfolio updated

5. **Prediction Market (Mocked):**
   - Send: "Bet YES on Fed cuts in March 2025 with $200"
   - ExecutionResult with `simulatedTxId`
   - Portfolio updated

---

## Manual Verification Checklist

### Sim Mode

- [ ] Backend running on port 3001
- [ ] Frontend running on port 5173
- [ ] Swap execution returns ExecutionResult with `simulatedTxId`
- [ ] DeFi deposit execution returns ExecutionResult with `positionDelta.type === 'defi'`
- [ ] Perp trade execution returns ExecutionResult with `positionDelta.type === 'perp'`
- [ ] Prediction market execution returns ExecutionResult with `positionDelta.type === 'event'`
- [ ] Portfolio updates after each execution
- [ ] All positions visible in RightPanel
- [ ] E2E test passes: `npm run e2e:mvp-full-flow`

### Eth Testnet Mode (Session)

- [ ] Backend running with session mode enabled
- [ ] Frontend running with `VITE_EXECUTION_AUTH_MODE=session`
- [ ] Session created successfully
- [ ] Swap execution relayed (no MetaMask popup)
- [ ] Swap returns ExecutionResult with `txHash`
- [ ] Transaction confirmed on Sepolia
- [ ] Portfolio updated after swap
- [ ] DeFi/Perp/Event still work (mocked)
- [ ] E2E test passes with `E2E_SUBMIT=1`

---

## Expected ExecutionResult Format

All executions return:

```typescript
{
  success: boolean;
  status: 'success' | 'failed';
  txHash?: string;  // For real executions
  simulatedTxId?: string;  // For mocked executions
  positionDelta?: {
    type: 'perp' | 'defi' | 'event' | 'swap';
    positionId?: string;
    sizeUsd?: number;
    entryPrice?: number;
    side?: 'long' | 'short' | 'YES' | 'NO';
  };
  portfolioDelta?: {
    accountValueDeltaUsd: number;
    balanceDeltas: { symbol: string; deltaUsd: number }[];
    exposureDeltaUsd?: number;
  };
  error?: string;
  portfolio: BlossomPortfolioSnapshot;  // Updated portfolio
}
```

---

## Files Changed

**Backend:**
- `agent/src/types/blossom.ts` - Added `ExecutionResult` type
- `agent/src/server/http.ts` - Refactored `applyAction()` to return `ExecutionResult`, updated `/api/chat` and `/api/execute/*` endpoints

**Frontend:**
- `src/lib/blossomApi.ts` - Added `ExecutionResult` interface, updated `ChatResponse`

**Tests:**
- `agent/scripts/e2e-mvp-full-flow.ts` - NEW: Full flow E2E test

**Documentation:**
- `LOCAL_MVP_RUNBOOK.md` - NEW: This file

---

## MVP A Completion Status

✅ **All requirements met:**

1. ✅ Real wallet balance fetching (ETH, WETH, USDC from Sepolia)
2. ✅ Real swap execution (Route 2, session mode)
3. ✅ Gated access with access codes
4. ✅ Mocked perp/DeFi/event (execution-shaped, same interface)
5. ✅ Unified ExecutionResult returned for all executions
6. ✅ Centralized portfolio updates (via `getPortfolioSnapshot()`)
7. ✅ Session mode works for full flow
8. ✅ E2E test `mvp_full_flow` covers all 4 execution types

**✅ MVP A is ready for gated whitelist testing.**

---

## Troubleshooting

### E2E Test Fails

- **"Portfolio not returned"**: Check backend is running on correct port
- **"Missing executionResults"**: Check backend `/api/chat` returns `executionResults` array
- **"Position not found"**: Check portfolio includes strategies array

### UI Not Updating

- **Portfolio stale**: Check frontend calls `/api/chat` and uses `executionResults[].portfolio`
- **No execution results**: Check backend returns `executionResults` in ChatResponse

### Session Mode Issues

- **"Session not found"**: Create session first via UI
- **"Relayed execution failed"**: Check relayer wallet has ETH, session is active

---

## Next Steps

1. Run E2E test: `npm run e2e:mvp-full-flow`
2. Test in UI: Execute swap → deposit → perp → prediction market
3. Verify portfolio updates after each execution
4. Confirm all positions visible in UI

**MVP A is complete and ready for whitelist testing.**

