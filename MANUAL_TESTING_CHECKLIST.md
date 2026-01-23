# Manual Testing Checklist: Zero to MVP Verified

**Purpose**: Step-by-step guide to verify the complete ETH testnet execution flow from scratch.

**Prerequisites**:
- Node.js and npm installed
- Foundry installed (`forge` command available)
- MetaMask installed and configured for Sepolia
- Sepolia ETH in deployer wallet and test user wallet
- Sepolia REDACTED/WETH tokens for swap testing

---

## Phase 0: Automated Verification (Recommended First Step)

### Step 0: Run Automated Verification

Before manual testing, run the automated verification script to ensure the repo is in a good state:

```bash
# Basic verification (no testnet checks)
./scripts/mvp-verify.sh

# With testnet checks (requires EXECUTION_MODE=eth_testnet)
EXECUTION_MODE=eth_testnet ./scripts/mvp-verify.sh

# With portfolio endpoint test
EXECUTION_MODE=eth_testnet TEST_USER_ADDRESS=0xYOUR_ADDRESS ./scripts/mvp-verify.sh
```

**Expected Output**:
- ✅ All automated checks pass (contracts, builds, endpoints)
- ✅ Testnet readiness verified (if EXECUTION_MODE=eth_testnet)
- ✅ Clear list of remaining manual steps

**If verification fails**:
- Fix the reported issues
- Re-run the script until all automated checks pass
- Then proceed to Phase 1

**✅ Phase 0 Complete**: All automated checks pass, ready for manual testing.

---

## Phase 1: Local Backend Sanity (No Chain Required)

### Step 1: Start Backend

```bash
cd agent
npm run dev
```

**Expected**: Server starts on `http://localhost:3001` with endpoint list logged.

**Check**: Look for console output showing all registered endpoints.

---

### Step 2: Run Endpoint Smoke Test

```bash
./scripts/endpoint-smoke-test.sh http://localhost:3001
```

**Expected Results**:
- ✅ **Green (PASS)** for core endpoints:
  - `GET /health`
  - `GET /api/ticker`
  - `POST /api/chat`
  - `POST /api/strategy/close`
  - `POST /api/reset`
  - `GET /api/execute/preflight` (sim mode)

- ⏭️ **Yellow (SKIP)** for testnet endpoints (if env not set):
  - `GET /api/portfolio/eth_testnet`
  - `POST /api/execute/prepare`
  - `POST /api/session/prepare`
  - `POST /api/execute/relayed`

- ❌ **No reds/500s** - All endpoints should return valid HTTP responses

**If anything is RED**:
- Stop and paste the output
- Check backend logs for errors
- Verify all dependencies are installed (`npm install` in `agent/`)

**✅ Phase 1 Complete**: All core endpoints respond correctly.

---

## Phase 2: Sepolia Deployment + Backend Preflight

### Step 3: Deploy Contracts to Sepolia

```bash
export SEPOLIA_RPC_URL="https://sepolia.infura.io/v3/YOUR_KEY"  # or your RPC
export DEPLOYER_PRIVATE_KEY="0x..."  # Your deployer wallet private key
export SEPOLIA_UNISWAP_V3_ROUTER="0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E"  # Sepolia SwapRouter02

cd contracts
./scripts/deploy-sepolia.sh
```

**Expected Output**:
- Contracts compile successfully
- Deployment transactions sent
- Addresses printed:
  - `EXECUTION_ROUTER_ADDRESS=0x...`
  - `MOCK_SWAP_ADAPTER_ADDRESS=0x...`
  - `UNISWAP_V3_ADAPTER_ADDRESS=0x...`

**Copy these addresses** - you'll need them in the next step.

**Verify on Etherscan**:
- Visit Sepolia Etherscan
- Search for `EXECUTION_ROUTER_ADDRESS`
- Confirm contract is deployed and verified

---

### Step 4: Set Backend Environment Variables

Create or update `agent/.env` (or set in your shell):

```bash
# Execution mode
EXECUTION_MODE=eth_testnet

# RPC and chain
ETH_TESTNET_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
ETH_TESTNET_CHAIN_ID=11155111

# Contract addresses (from Step 3)
EXECUTION_ROUTER_ADDRESS=0x...  # From deploy output
MOCK_SWAP_ADAPTER_ADDRESS=0x...  # From deploy output
UNISWAP_V3_ADAPTER_ADDRESS=0x...  # From deploy output

# Token addresses (Sepolia)
REDACTED_ADDRESS_SEPOLIA=0x94a9D9AC831246580d0C5B0C5c8b0b0C5B0C5B0C  # Verify on Sepolia
WETH_ADDRESS_SEPOLIA=0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9  # Sepolia WETH

# For session mode (Phase 4)
EXECUTION_AUTH_MODE=direct  # Start with direct mode
RELAYER_PRIVATE_KEY=0x...  # Only needed for session mode
```

**Important**: 
- Replace placeholder addresses with actual Sepolia token addresses
- Verify `REDACTED_ADDRESS_SEPOLIA` and `WETH_ADDRESS_SEPOLIA` on Sepolia Etherscan
- Keep `MOCK_SWAP_ADAPTER_ADDRESS` even if using Uniswap (some tests may reference it)

---

### Step 5: Restart Backend and Run Preflight

**Restart backend** (if running, stop with Ctrl+C and restart):

```bash
cd agent
npm run dev
```

**Run preflight check**:

```bash
curl http://localhost:3001/api/execute/preflight | jq
```

**Expected Response**:

```json
{
  "mode": "eth_testnet",
  "ok": true,
  "chainId": 11155111,
  "router": "0x...",
  "adapter": "0x...",
  "rpc": true,
  "notes": []
}
```

**If `ok: false`**:
- Check the `notes` array for specific errors:
  - `"Config error: EXECUTION_ROUTER_ADDRESS not configured"` → Set env var
  - `"Router contract not deployed"` → Verify address on Etherscan
  - `"Adapter not allowlisted"` → Run deployment script again or manually allowlist
  - `"RPC error: ..."` → Check RPC URL and network connectivity

**Fix issues** and re-run preflight until `ok: true`.

**✅ Phase 2 Complete**: Contracts deployed, backend configured, preflight passes.

---

## Phase 3: Frontend Direct Mode Test (Approve + Execute)

### Step 6: Set Frontend Environment Variables

Create or update `frontend/.env.local`:

```bash
VITE_EXECUTION_MODE=eth_testnet
VITE_EXECUTION_AUTH_MODE=direct
VITE_ETH_TESTNET_INTENT=swap_usdc_weth  # or swap_weth_usdc
```

**Note**: 
- `swap_usdc_weth` = swap REDACTED → WETH (you need REDACTED)
- `swap_weth_usdc` = swap WETH → REDACTED (you need WETH)

---

### Step 7: Start Frontend and Connect MetaMask

```bash
npm run dev
```

**In Browser**:
1. Open `http://localhost:5173` (or your dev server URL)
2. Click "Connect Wallet" or similar
3. MetaMask popup appears
4. Select Sepolia network (if not already)
5. Approve connection

**Verify**: Wallet address is displayed in UI.

---

### Step 8: Confirm Portfolio Sync

**Wait ~15 seconds** after wallet connection.

**Check UI**:
- Right panel or portfolio section should show:
  - **ETH balance** (matches MetaMask)
  - **REDACTED balance** (matches MetaMask, if you have REDACTED)
  - **WETH balance** (matches MetaMask, if you have WETH)
  - **DEFI balance** (preserved from simulation, if any)

**Verify**:
- Balances update every ~15 seconds
- Account value = sum of all balances
- No console errors in browser DevTools

**If balances don't sync**:
- Check browser console for errors
- Verify backend `/api/portfolio/eth_testnet` endpoint works:
  ```bash
  curl "http://localhost:3001/api/portfolio/eth_testnet?userAddress=YOUR_ADDRESS" | jq
  ```
- Check backend logs for RPC errors

**✅ Portfolio sync verified**: Real balances displayed in UI.

---

### Step 9: Ensure You Have TokenIn

**For `swap_usdc_weth`**:
- You need **Sepolia REDACTED** in your wallet
- Get from: Sepolia faucet, Uniswap, or bridge

**For `swap_weth_usdc`**:
- You need **WETH** in your wallet
- Wrap ETH on Sepolia Uniswap, or get from faucet

**Verify in MetaMask**:
- Open MetaMask
- Check token balances
- Ensure you have at least 1-10 tokens for testing

---

### Step 10: Execute Swap

**In Chat UI**:
1. Type any message that creates a draft plan (e.g., "Swap 10 REDACTED for WETH")
2. A draft card appears
3. Click **"Confirm & Execute"**

**Expected Wallet Prompts**:

**First Time (if allowance missing)**:
1. **MetaMask popup #1**: "Approve REDACTED spending cap"
   - Transaction: `approve(spender: ExecutionRouter, amount: ...)`
   - Click "Confirm"
   - Wait for confirmation

2. **MetaMask popup #2**: "Execute swap"
   - Transaction: `executeBySender(plan)` to ExecutionRouter
   - Click "Confirm"
   - Wait for confirmation

**Subsequent Times (allowance exists)**:
- Only **one popup**: Execute swap transaction

**Expected Results**:

**In UI**:
- Strategy status flips to `executed`
- Chat shows success message
- Portfolio balances update (REDACTED decreases, WETH increases)

**In MetaMask**:
- Transaction appears in Activity
- Click transaction → View on Etherscan
- On Etherscan, verify:
  - Transaction goes to `EXECUTION_ROUTER_ADDRESS`
  - Status: Success
  - Events include `SwapExecuted` event

**In Browser Console** (DEV mode):
- Logs show: `[handleConfirmTrade] Execution successful, txHash: 0x...`

**If execution fails**:
- Check MetaMask for rejection
- Check browser console for errors
- Check backend logs for prepare/submit errors
- Verify token balances are sufficient

**✅ Phase 3 Complete**: Direct mode swap execution works end-to-end.

---

## Phase 4: Session Mode Test (One-Time Setup, Then Zero Prompts)

### Step 11: Set Backend Environment for Session Mode

Update `agent/.env`:

```bash
EXECUTION_AUTH_MODE=session
RELAYER_PRIVATE_KEY=0x...  # Private key of relayer wallet (funded with Sepolia ETH)
```

**Important**:
- Relayer wallet must have Sepolia ETH for gas
- Relayer address will be the `executor` in sessions
- Keep relayer private key secure (never commit to git)

**Restart backend** after changing env vars.

---

### Step 12: Set Frontend Environment for Session Mode

Update `frontend/.env.local`:

```bash
VITE_EXECUTION_AUTH_MODE=session
```

**Restart frontend** (or refresh if using HMR).

---

### Step 13: First Session Execution

**In Chat UI**:
1. Create a new draft plan (or use existing)
2. Click **"Confirm & Execute"**

**Expected Flow**:

**Step 1: Session Creation (One-Time)**:
- **MetaMask popup**: "Create session"
  - Transaction: `createSession(sessionId, executor, expiresAt, maxSpend, allowedAdapters)`
  - Click "Confirm"
  - Wait for confirmation
  - UI shows: "Session created successfully"

**Step 2: Token Approval (One-Time, if needed)**:
- **MetaMask popup**: "Approve token" (if allowance missing)
  - Transaction: `approve(spender: ExecutionRouter, amount: ...)`
  - Click "Confirm"
  - Wait for confirmation

**Step 3: Execution (Relayed)**:
- **No wallet popup** (backend relays transaction)
- UI shows: "Executing..." then "Executed"
- Strategy status flips to `executed`

**Verify**:
- Check browser console for: `[handleConfirmTrade] Relayed execution successful, txHash: 0x...`
- Check Etherscan: Transaction from relayer address to ExecutionRouter
- Check backend logs: `[relayer] Sent relayed transaction: ...`

**✅ First session execution complete**: Session created, execution relayed.

---

### Step 14: Second Execution (Zero Prompts)

**In Chat UI**:
1. Create another draft plan
2. Click **"Confirm & Execute"**

**Expected**:
- **No wallet popups** (session exists, allowance exists)
- Backend relays transaction immediately
- UI flips to `executed` after txHash returned
- Execution happens in background (no user interaction)

**Verify**:
- Check Etherscan: New transaction from relayer
- Check backend logs: Relayed transaction sent
- Check UI: Strategy executed, balances updated

**If wallet popup appears**:
- Check browser console for errors
- Verify `sessionId` is stored in `localStorage`
- Check backend logs for session validation errors

**✅ Phase 4 Complete**: Session mode works with zero prompts after setup.

---

## Phase 5: Negative Tests

### Step 15: Insufficient Balance Test

**Setup**:
- Set `VITE_ETH_TESTNET_INTENT=swap_usdc_weth`
- Ensure your wallet has **no REDACTED** (or very little)

**In Chat UI**:
1. Create a draft plan
2. Click **"Confirm & Execute"**

**Expected**:
- **No wallet popups**
- Chat shows error message: "Insufficient balance: You need X REDACTED but only have Y"
- Strategy status remains `draft` (NOT executed)
- No transaction sent

**Verify**:
- Check browser console: `INSUFFICIENT_BALANCE` warning logged
- Check backend logs: Prepare endpoint returns warning
- UI shows clear error message to user

**✅ Insufficient balance handled gracefully**.

---

### Step 16: Allowance Revoked Test

**Setup**:
1. In MetaMask, go to token (REDACTED or WETH)
2. Click "Revoke" or set allowance to 0
3. Or use Etherscan to revoke approval

**In Chat UI**:
1. Create a draft plan
2. Click **"Confirm & Execute"**

**Expected**:
- **MetaMask popup**: "Approve token" (auto-triggered)
  - Transaction: `approve(spender: ExecutionRouter, amount: ...)`
  - Click "Confirm"
- After approval, execution proceeds automatically
- No manual intervention needed

**Verify**:
- Check browser console: Approval detected, sent automatically
- Execution continues after approval confirms
- Strategy flips to `executed`

**✅ Auto-approve works when allowance revoked**.

---

## MVP Verified ✅

**Once all phases pass, you can claim**:

✅ **Blossom executes real on-chain swaps on Sepolia from chat confirmation**
- Direct mode: User signs each execution
- Session mode: Zero prompts after one-time setup

✅ **Supports both direct and session-based execution**
- Direct: Full user control, one prompt per execution
- Session: Delegated execution, zero prompts after setup

✅ **Shows real wallet balances in the same UI**
- Portfolio syncs every 15 seconds
- ETH, REDACTED, WETH balances from chain
- Preserves simulated balances (DEFI, etc.)

✅ **Enforces security constraints**
- Nonces prevent replay attacks
- Deadlines enforce time limits
- Adapter allowlists restrict adapters
- Session spend caps limit session spending
- Balance/allowance checks prevent failed transactions

---

## Troubleshooting

### Backend won't start
- Check Node.js version: `node --version` (should be 18+)
- Run `npm install` in `agent/`
- Check port 3001 is not in use

### Preflight fails
- Verify all env vars are set: `env | grep EXECUTION`
- Check RPC URL is accessible: `curl $ETH_TESTNET_RPC_URL`
- Verify contract addresses on Etherscan

### Frontend won't connect wallet
- Check MetaMask is installed and unlocked
- Verify Sepolia network is added
- Check browser console for errors

### Swaps fail
- Verify token balances are sufficient
- Check token addresses are correct (Sepolia)
- Verify Uniswap router address is correct
- Check backend logs for RPC errors

### Session mode doesn't work
- Verify `RELAYER_PRIVATE_KEY` is set
- Check relayer wallet has Sepolia ETH
- Verify `EXECUTION_AUTH_MODE=session` in both frontend and backend
- Check `localStorage` for `sessionId`

---

## Next Steps

After MVP verification:
1. **Add more action types** (beyond swaps)
2. **Improve error messages** (user-friendly)
3. **Add transaction status tracking** (pending → confirmed)
4. **Add gas estimation** (show gas costs before execution)
5. **Add slippage protection** (user-configurable)
6. **Add multi-hop swaps** (REDACTED → ETH → WETH)

---

**Last Updated**: 2025-01-28  
**Status**: Ready for testing

