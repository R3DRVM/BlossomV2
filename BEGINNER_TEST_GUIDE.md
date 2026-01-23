# Beginner Test Guide

**Purpose:** Step-by-step manual testing guide for investor demos on Sepolia testnet.

---

## Quick Start (Recommended)

**One command to start everything:**
```bash
npm run dev:demo
```

This starts both frontend (http://localhost:5173) and backend (http://127.0.0.1:3001) together.

**To stop:** Press `Ctrl+C`

---

## Prerequisites

### 1. Environment Setup

**Backend (`agent/.env.local`):**
```bash
# Execution
EXECUTION_MODE=eth_testnet
EXECUTION_AUTH_MODE=direct  # or 'session' for one-click mode

# RPC
ETH_TESTNET_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
ETH_TESTNET_CHAIN_ID=11155111

# Contracts (from deployment)
EXECUTION_ROUTER_ADDRESS=0x...
MOCK_SWAP_ADAPTER_ADDRESS=0x...
ERC20_PULL_ADAPTER_ADDRESS=0x...
DEMO_REDACTED_ADDRESS=0x...
DEMO_WETH_ADDRESS=0x...
DEMO_SWAP_ROUTER_ADDRESS=0x...
DEMO_LEND_VAULT_ADDRESS=0x...
DEMO_LEND_ADAPTER_ADDRESS=0x...
PROOF_ADAPTER_ADDRESS=0x...

# LLM (optional, stub works for testing)
BLOSSOM_MODEL_PROVIDER=stub  # or 'gemini' with API key

# Routing
ROUTING_MODE=deterministic  # or 'hybrid' with 1inch key
```

**Frontend:** No env vars needed (uses backend API)

### 2. Start Services

**Terminal 1 - Backend:**
```bash
cd agent
npm run dev
# Should start on http://localhost:3001
```

**Terminal 2 - Frontend:**
```bash
npm run dev
# Should start on http://localhost:5173
```

### 3. Verify Preflight

```bash
curl http://localhost:3001/api/execute/preflight | jq
```

**Expected:**
```json
{
  "mode": "eth_testnet",
  "ok": true,
  "chainId": 11155111,
  "router": "0x...",
  "rpc": true,
  "routing": { "mode": "deterministic" },
  "lending": { "enabled": true }
}
```

---

## Test Flow: Connect Wallet → Verify Balance → Execute Actions

### Step 1: Connect Wallet

1. Open http://localhost:5173/app
2. Click **"Connect Wallet (Sepolia)"** in RightPanel
3. MetaMask popup appears
4. Select Sepolia network (if prompted)
5. Click **"Connect"** in MetaMask

**Expected:**
- RightPanel shows "Loading..." briefly
- Then shows actual ETH balance (e.g., "$900.00" for 0.3 ETH @ $3000)
- Wallet address truncated in header
- "Disconnect" icon button appears next to balance

**If balance shows $0.00:**
- Check browser console for errors
- Verify `GET /api/wallet/balances?address=0x...` returns non-zero ETH
- Check network tab: endpoint should return `{ "native": { "formatted": "0.3" } }`

---

### Step 2: Verify Network

**If on wrong network:**
- RightPanel shows amber warning: "Wrong Network"
- Click **"Switch to Sepolia"**
- MetaMask prompts to switch
- After switch, balance should load

**If still showing $0.00 after switch:**
- Click refresh icon (↻) next to balance
- Check console for balance fetch errors

---

### Step 3: Test Swap (REDACTED → WETH)

1. Type in chat: **"Swap 100 REDACTED to WETH"**
2. AI responds with strategy card
3. Review card: shows REDACTED → WETH, ~95 WETH expected (demo rate)
4. Click **"Confirm & Execute"**
5. If first time: approve REDACTED in MetaMask
6. Confirm execution tx in MetaMask
7. Wait for confirmation (~15-30s on Sepolia)

**Expected:**
- Strategy card status: `pending` → `executing` → `executed`
- Assistant message includes Etherscan link
- Etherscan shows successful tx with `ActionExecuted(SWAP)` event

**Verify on Etherscan:**
- Status: Success
- To: ExecutionRouter address
- Events: `ActionExecuted` with `actionType: 0` (SWAP)

---

### Step 4: Test Lending (Supply REDACTED)

1. Type in chat: **"Supply 100 REDACTED to lending"**
2. AI responds with DeFi card
3. Review card: shows DemoLendVault, APY ~5%
4. Click **"Confirm & Execute"**
5. Approve REDACTED (if needed)
6. Confirm execution tx
7. Wait for confirmation

**Expected:**
- Strategy card shows `executed`
- Assistant message includes Etherscan link
- Etherscan shows 2 events:
  - `ActionExecuted` with `actionType: 2` (PULL)
  - `ActionExecuted` with `actionType: 3` (LEND_SUPPLY)
- DemoLendVault emits `Deposit` event

---

### Step 5: Test Perps (Proof-of-Execution)

1. Type in chat: **"Long ETH with 3x leverage, 3% risk"**
2. AI responds with perps strategy card
3. Review card: shows market, side, leverage, risk
4. Click **"Confirm & Execute"**
5. Confirm tx in MetaMask
6. Wait for confirmation

**Expected:**
- Strategy card shows `executed`
- Assistant message: "On-chain proof recorded"
- Etherscan link provided
- Etherscan shows `ProofRecorded` event:
  - `venueType: 1` (perps)
  - `summary: "PERP:ETH-LONG-3x-3%"`

---

### Step 6: Test Events (Proof-of-Execution)

1. Type in chat: **"Buy YES on Fed rate cut, $50 stake"**
2. AI responds with event market card
3. Review card: shows market, outcome, stake
4. Click **"Confirm & Execute"**
5. Confirm tx in MetaMask
6. Wait for confirmation

**Expected:**
- Strategy card shows `executed`
- Etherscan shows `ProofRecorded` event:
  - `venueType: 2` (event)
  - `summary: "EVENT:fedcuts-YES-50USD"`

---

## Session Mode (One-Click Execution)

### Setup Session

1. Set `EXECUTION_AUTH_MODE=session` in backend `.env.local`
2. Restart backend
3. Connect wallet (same as Step 1)
4. First execution: user signs session creation tx
5. User signs approval tx (one-time)

**After session setup:**
- Subsequent executions: **NO wallet prompts**
- Txs are relayed by backend
- Explorer links still show real txs

### Test Session Mode

1. Execute any action (swap/lend/perps/event)
2. **No MetaMask popup** (tx relayed)
3. Wait for confirmation
4. Verify on Etherscan: relayer address is `msg.sender`

---

## Common Failure Modes

### 1. Balance Shows $0.00

**Symptoms:**
- MetaMask shows 0.3 ETH
- RightPanel shows $0.00

**Diagnosis:**
```bash
# Test endpoint directly
curl "http://localhost:3001/api/wallet/balances?address=YOUR_ADDRESS" | jq
```

**Fixes:**
- Check `ETH_TESTNET_RPC_URL` is valid
- Verify address is correct (check browser console)
- Check backend logs for RPC errors
- Try refresh icon (↻) next to balance

### 2. Wrong Network

**Symptoms:**
- Amber warning: "Wrong Network"
- Balance shows $0.00

**Fix:**
- Click "Switch to Sepolia" button
- Or manually switch in MetaMask

### 3. Transaction Fails

**Symptoms:**
- Strategy stays `pending`
- Error message in chat

**Common Causes:**
- Insufficient gas (add more Sepolia ETH)
- Approval failed (retry approval)
- Deadline exceeded (prepare again)
- Adapter not allowed (redeploy contracts)

**Fix:**
- Check error message in chat
- Retry with fresh approval if needed
- Verify contracts are deployed and allowlisted

### 4. RPC Down

**Symptoms:**
- Preflight returns `rpc: false`
- Balance fetch fails

**Fix:**
- Check `ETH_TESTNET_RPC_URL` is reachable
- Try different RPC provider (Infura, Alchemy, QuickNode)
- Verify API key is valid

### 5. Missing Env Vars

**Symptoms:**
- Preflight returns `ok: false`
- Notes mention missing addresses

**Fix:**
- Deploy contracts: `cd contracts && ./scripts/deploy-sepolia.sh`
- Copy addresses to `agent/.env.local`
- Restart backend

---

## Verification Checklist

After completing all flows:

- [ ] Wallet connects and shows correct ETH balance
- [ ] Swap produces real tx with Etherscan link
- [ ] Lending produces real tx with PULL + LEND_SUPPLY events
- [ ] Perps produces proof tx with ProofRecorded event
- [ ] Events produces proof tx with ProofRecorded event
- [ ] Session mode: second tx requires no wallet prompt
- [ ] Disconnect clears state and re-prompt works
- [ ] Wrong network warning appears and switch works
- [ ] Refresh icon updates balances

---

## Quick Reference: Etherscan Event Signatures

| Event | Signature | Description |
|-------|-----------|-------------|
| `ActionExecuted` | `0x...` | Router action executed |
| `ProofRecorded` | `0x...` | Proof-of-execution recorded |
| `Deposit` | `0x...` | Lending vault deposit |

**Action Types:**
- `0` = SWAP
- `2` = PULL
- `3` = LEND_SUPPLY
- `6` = PROOF

**Venue Types:**
- `1` = Perps
- `2` = Events

---

## Next Steps

- Run automated tests: `npx playwright test`
- Check demo readiness: `./scripts/demo-ready-check.sh`
- Review telemetry: `agent/logs/telemetry.jsonl`

