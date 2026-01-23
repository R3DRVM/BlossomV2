# Execution Runbook: From Docs to Working MVP

**Goal:** Make it work end-to-end, not just documented.

---

## PHASE A: E2E Tests - Make Both Intents Pass

### Command Block 1: E2E Intent = Mock

```bash
cd /Users/redrum/Desktop/Bloom

export PORT=3002
export BASE_URL="http://localhost:3002"
export SKIP_DEPLOY=1
export SEPOLIA_RPC_URL="https://sepolia.infura.io/v3/b9ea983becaf4298a2b7a47a3942c886"
export ETH_TESTNET_RPC_URL="$SEPOLIA_RPC_URL"
export EXECUTION_ROUTER_ADDRESS="0xC274dba8381C3Dcd4823Fb17f980ad32caDf751e"
export MOCK_SWAP_ADAPTER_ADDRESS="0x0a68599554ceFE00304e2b7dDfB129528F66d31F"
export UNISWAP_V3_ADAPTER_ADDRESS="0x9D2E705FA2f63cd85CfB72f973F85A34A173fC4A"
export USDC_ADDRESS_SEPOLIA="0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
export WETH_ADDRESS_SEPOLIA="0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"
export TEST_USER_ADDRESS="0x7abFA1E1c78DfAd99A0428D9437dF05157c08FcC"
export E2E_INTENT="mock"

bash ./scripts/deploy-and-verify-sepolia.sh
```

**Expected Output:**
- ✅ Preflight check (ok: true)
- ✅ Portfolio endpoint (returns balances)
- ✅ Execute prepare (returns plan)
- ✅ Final: `Passed: X, Failed: 0`

---

### Command Block 2: E2E Intent = Uniswap

```bash
cd /Users/redrum/Desktop/Bloom

export PORT=3002
export BASE_URL="http://localhost:3002"
export SKIP_DEPLOY=1
export SEPOLIA_RPC_URL="https://sepolia.infura.io/v3/b9ea983becaf4298a2b7a47a3942c886"
export ETH_TESTNET_RPC_URL="$SEPOLIA_RPC_URL"
export EXECUTION_ROUTER_ADDRESS="0xC274dba8381C3Dcd4823Fb17f980ad32caDf751e"
export MOCK_SWAP_ADAPTER_ADDRESS="0x0a68599554ceFE00304e2b7dDfB129528F66d31F"
export UNISWAP_V3_ADAPTER_ADDRESS="0x9D2E705FA2f63cd85CfB72f973F85A34A173fC4A"
export USDC_ADDRESS_SEPOLIA="0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
export WETH_ADDRESS_SEPOLIA="0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"
export TEST_USER_ADDRESS="0x7abFA1E1c78DfAd99A0428D9437dF05157c08FcC"
export E2E_INTENT="uniswap"

bash ./scripts/deploy-and-verify-sepolia.sh
```

**Expected Output:**
- ✅ Preflight check (ok: true)
- ✅ Portfolio endpoint (returns balances)
- ✅ Execute prepare (returns plan with Uniswap adapter)
- ✅ Assertions pass (router, adapter, calldata)
- ✅ Final: `Passed: X, Failed: 0`

---

### Failure Triage

**If Preflight Fails (`ok: false`):**
```bash
# Manual check
curl http://localhost:3002/api/execute/preflight | jq

# Common fixes:
# 1. Verify all env vars exported (check script output)
# 2. Test RPC: curl "$SEPOLIA_RPC_URL" (should return JSON-RPC)
# 3. Verify contract addresses on Sepolia explorer
```

**If Portfolio Fails (500 error):**
```bash
# Manual check
curl "http://localhost:3002/api/portfolio/eth_testnet?userAddress=0x7abFA1E1c78DfAd99A0428D9437dF05157c08FcC" | jq

# Common fixes:
# 1. Verify USDC_ADDRESS_SEPOLIA and WETH_ADDRESS_SEPOLIA are set
# 2. Check RPC connectivity
```

**If Prepare Fails:**
```bash
# Check backend logs
tail -f /tmp/blossom-backend.log

# Common fixes:
# 1. Verify UNISWAP_V3_ADAPTER_ADDRESS set (for uniswap intent)
# 2. Verify preflight passed first
```

**If Assertions Fail:**
- Check E2E output for specific assertion failure
- Verify router/adapter addresses match preflight
- Verify calldata is non-empty

---

## PHASE B: UI Wiring - Connect Frontend to Testnet Backend

### Frontend Environment Variables

**Option 1: Create `.env.local` file (recommended)**

```bash
cd /Users/redrum/Desktop/Bloom
cat > .env.local << 'EOF'
VITE_AGENT_API_URL=http://localhost:3002
VITE_USE_AGENT_BACKEND=true
VITE_EXECUTION_MODE=eth_testnet
VITE_EXECUTION_AUTH_MODE=direct
VITE_ETH_TESTNET_INTENT=mock
EOF
```

**Option 2: Export in terminal**

```bash
export VITE_AGENT_API_URL=http://localhost:3002
export VITE_USE_AGENT_BACKEND=true
export VITE_EXECUTION_MODE=eth_testnet
export VITE_EXECUTION_AUTH_MODE=direct
export VITE_ETH_TESTNET_INTENT=mock
```

**Key Files:**
- `src/lib/apiClient.ts:6` - Uses `VITE_AGENT_API_URL`
- `src/lib/config.ts:8` - Uses `VITE_EXECUTION_MODE`
- `src/lib/config.ts:5` - Uses `VITE_USE_AGENT_BACKEND`

---

### Two-Terminal Local Dev Setup

**Terminal 1: Backend Agent**

```bash
cd /Users/redrum/Desktop/Bloom/agent

export PORT=3002
export EXECUTION_MODE=eth_testnet
export EXECUTION_AUTH_MODE=direct
export ETH_TESTNET_RPC_URL="https://sepolia.infura.io/v3/b9ea983becaf4298a2b7a47a3942c886"
export EXECUTION_ROUTER_ADDRESS="0xC274dba8381C3Dcd4823Fb17f980ad32caDf751e"
export MOCK_SWAP_ADAPTER_ADDRESS="0x0a68599554ceFE00304e2b7dDfB129528F66d31F"
export UNISWAP_V3_ADAPTER_ADDRESS="0x9D2E705FA2f63cd85CfB72f973F85A34A173fC4A"
export USDC_ADDRESS_SEPOLIA="0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
export WETH_ADDRESS_SEPOLIA="0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"

npm run dev
```

**Expected:** `🌸 Blossom Agent server running on http://localhost:3002`

**Verify:** `curl http://localhost:3002/health` returns `{"status":"ok"}`

---

**Terminal 2: Frontend**

```bash
cd /Users/redrum/Desktop/Bloom

# If using .env.local, just run:
npm run dev

# If using exports, set env vars first:
export VITE_AGENT_API_URL=http://localhost:3002
export VITE_USE_AGENT_BACKEND=true
export VITE_EXECUTION_MODE=eth_testnet
export VITE_EXECUTION_AUTH_MODE=direct
export VITE_ETH_TESTNET_INTENT=mock

npm run dev
```

**Expected:** Frontend runs on `http://localhost:5173` (or Vite default port)

**Verify:** Open browser console, check for API calls to `http://localhost:3002`

---

### Success Criteria: End-to-End Flow

**Test Steps:**
1. Open frontend: `http://localhost:5173`
2. Connect MetaMask wallet (switch to Sepolia testnet)
3. Send message: "Swap 100 USDC for WETH"
4. Click "Confirm & Execute"

**Verify Each Step:**

✅ **Prepare Request:**
- Browser console shows: `POST http://localhost:3002/api/execute/prepare`
- Response includes `plan` with `actions` array

✅ **Transaction Hash:**
- Chat shows: "Submitted on Sepolia: 0x..."
- Wallet shows transaction in MetaMask

✅ **Status Polling:**
- Chat shows: "Confirmed on Sepolia: 0x..." (after ~15s)
- Or: "Reverted on Sepolia: 0x..." (if failed)

✅ **Portfolio Refresh:**
- Portfolio panel shows updated balances
- USDC decreases, WETH increases (for swap)
- Updates every 15s automatically

**Checkpoints:**
- Network tab: Verify API calls to `localhost:3002`
- Console: Check for errors
- Chat: Verify tx hash and status messages
- Portfolio: Verify balance updates

---

## PHASE C: LLM Provider - Gemini (Primary Agent)

### Gemini Configuration

**Backend Env Vars:**
```bash
export BLOSSOM_MODEL_PROVIDER=gemini
export BLOSSOM_GEMINI_API_KEY="your-key-here"
export BLOSSOM_GEMINI_MODEL="gemini-1.5-pro"  # Optional, default
```

**Security:**
- ✅ Key only read from `process.env` (server-side)
- ✅ Never logged or persisted
- ✅ Falls back to stub if key missing (no error)

**Verification:**
```bash
curl http://localhost:3002/health | jq
# Returns: { "llmProvider": "gemini" }
```

---

## PHASE C (Legacy): LLM Provider - Gemini or Stub

### Current Env Var Names

**Provider Selection:**
- `BLOSSOM_MODEL_PROVIDER=stub|anthropic|openai|gemini` (default: `stub`)

**Provider-Specific Keys:**
- `BLOSSOM_ANTHROPIC_API_KEY` (for Anthropic)
- `BLOSSOM_OPENAI_API_KEY` (for OpenAI)
- `BLOSSOM_GEMINI_API_KEY` (for Gemini)

**Model Selection (optional):**
- `BLOSSOM_ANTHROPIC_MODEL` (default: `claude-3-5-sonnet-20241022`)
- `BLOSSOM_OPENAI_MODEL` (default: `gpt-4o-mini`)
- `BLOSSOM_GEMINI_MODEL` (default: `gemini-1.5-pro`)

**Code Path:** `agent/src/services/llmClient.ts:21-27` (provider selection)

**Provider Logging:** Added in `agent/src/services/llmClient.ts:34` - logs provider name

---

### STUB Mode Smoke Test

**Setup:**
```bash
cd /Users/redrum/Desktop/Bloom/agent

export BLOSSOM_MODEL_PROVIDER=stub
# Don't set any API keys

export PORT=3002
export EXECUTION_MODE=eth_testnet
# ... (other testnet env vars)

npm run dev
```

**Test via API:**
```bash
curl -X POST http://localhost:3002/api/chat \
  -H "Content-Type: application/json" \
  -d '{"userMessage":"Long ETH with 3% risk","venue":"hyperliquid"}' | jq
```

**Expected Response:**
```json
{
  "assistantMessage": "This is a stubbed Blossom response...",
  "actions": [],
  "portfolio": { ... }
}
```

**Verify:**
- ✅ No external API calls (check backend logs)
- ✅ Returns stub message
- ✅ Works without API keys

**UI Test:**
1. Open frontend, send message: "Long ETH with 3% risk"
2. **Expected:** Stub response appears in chat
3. **Verify:** No API keys required, works offline

---

### Gemini Mode Checklist (No Keys in Code)

**Setup:**
```bash
cd /Users/redrum/Desktop/Bloom/agent

export BLOSSOM_MODEL_PROVIDER=gemini
export BLOSSOM_GEMINI_API_KEY="your-key-here"  # Set your actual key

export PORT=3002
export EXECUTION_MODE=eth_testnet
# ... (other testnet env vars)

npm run dev
```

**Verification Steps:**

1. **Check Provider Logging:**
   - Backend logs show: `[llmClient] Using provider: gemini`
   - **How:** Send chat message, check backend terminal

2. **Check API Calls:**
   - Backend logs show requests to: `https://generativelanguage.googleapis.com/v1beta/models/...`
   - **How:** Monitor backend terminal for API calls

3. **Test Response:**
   - Send message: "Long ETH with 3% risk"
   - **Expected:** Real AI response (not stub)
   - **Verify:** Response is contextual and relevant

**Code Path Verification:**
- `agent/src/services/llmClient.ts:53-55` - Routes to `callGemini()`
- `agent/src/services/llmClient.ts:148-195` - Gemini implementation

**Error Handling:**
- If `BLOSSOM_GEMINI_API_KEY` not set: Throws error: `BLOSSOM_GEMINI_API_KEY is not set...`
- If provider not recognized: Falls back to stub

---

## Complete Success Checklist

### Phase A: E2E Tests
- [ ] `E2E_INTENT=mock` passes with `Failed: 0`
- [ ] `E2E_INTENT=uniswap` passes with `Failed: 0`
- [ ] Preflight returns `ok: true`
- [ ] Portfolio returns balances
- [ ] Execute prepare returns plan with non-empty calldata

### Phase B: UI Wiring
- [ ] Frontend connects to backend on port 3002
- [ ] User can connect MetaMask wallet
- [ ] User can send message and get plan
- [ ] User can click "Confirm & Execute"
- [ ] Transaction hash appears in chat
- [ ] Status polling shows "Confirmed" or "Reverted"
- [ ] Portfolio refreshes with updated balances

### Phase C: LLM Provider
- [ ] Stub mode works (no API keys)
- [ ] Gemini mode works (with API key)
- [ ] Provider switching works (env var change)
- [ ] Error handling works (missing key → clear error)

---

## Quick Triage Reference

**Backend not starting:**
- Check: Port 3002 available? (`lsof -nP -iTCP:3002`)
- Fix: Kill process or use different port

**Frontend can't connect:**
- Check: `VITE_AGENT_API_URL=http://localhost:3002` set?
- Fix: Set env var and restart frontend

**Wallet not connecting:**
- Check: MetaMask installed? On Sepolia network?
- Fix: Install MetaMask, switch to Sepolia

**Transaction fails:**
- Check: Wallet has Sepolia ETH? Token balances sufficient?
- Fix: Fund wallet via faucet, check balances

**LLM not responding:**
- Check: Provider env var set? API key set (if not stub)?
- Fix: Set `BLOSSOM_MODEL_PROVIDER` and required API key

**Preflight fails:**
- Check: All env vars exported? RPC reachable?
- Fix: Verify env vars, test RPC connectivity

**Portfolio fails:**
- Check: `USDC_ADDRESS_SEPOLIA` and `WETH_ADDRESS_SEPOLIA` set?
- Fix: Export missing env vars

---

**Status:** Ready to execute. Run Phase A commands first, then Phase B, then Phase C.

