# End-to-End Runbook: From Docs to Working MVP

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
export REDACTED_ADDRESS_SEPOLIA="0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
export WETH_ADDRESS_SEPOLIA="0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"
export TEST_USER_ADDRESS="0x7abFA1E1c78DfAd99A0428D9437dF05157c08FcC"
export E2E_INTENT="mock"

bash ./scripts/deploy-and-verify-sepolia.sh
```

**Expected:** `Passed: X, Failed: 0`

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
export REDACTED_ADDRESS_SEPOLIA="0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
export WETH_ADDRESS_SEPOLIA="0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"
export TEST_USER_ADDRESS="0x7abFA1E1c78DfAd99A0428D9437dF05157c08FcC"
export E2E_INTENT="uniswap"

bash ./scripts/deploy-and-verify-sepolia.sh
```

**Expected:** `Passed: X, Failed: 0`

---

### Failure Triage

**If Preflight Fails:**
- Check: `curl http://localhost:3002/api/execute/preflight | jq`
- Fix: Verify all env vars exported, RPC reachable, contracts deployed

**If Portfolio Fails:**
- Check: `curl "http://localhost:3002/api/portfolio/eth_testnet?userAddress=0x7abFA1E1c78DfAd99A0428D9437dF05157c08FcC" | jq`
- Fix: Verify `REDACTED_ADDRESS_SEPOLIA` and `WETH_ADDRESS_SEPOLIA` are set

**If Prepare Fails:**
- Check: Backend logs (`tail -f /tmp/blossom-backend.log`)
- Fix: Verify `UNISWAP_V3_ADAPTER_ADDRESS` set (for uniswap intent)

**If Assertions Fail:**
- Check: E2E output shows which assertion failed
- Fix: Verify router/adapter addresses match preflight

---

## PHASE B: UI Wiring - Connect Frontend to Testnet Backend

### Frontend Environment Variables

Create `.env.local` in repo root (or set in terminal):

```bash
# Point frontend to testnet backend
VITE_AGENT_API_URL=http://localhost:3002
VITE_USE_AGENT_BACKEND=true
VITE_EXECUTION_MODE=eth_testnet
VITE_EXECUTION_AUTH_MODE=direct
VITE_ETH_TESTNET_INTENT=mock
```

**Key Files:**
- `src/lib/apiClient.ts:6` - Uses `VITE_AGENT_API_URL` (default: `http://localhost:3001`)
- `src/lib/config.ts:8` - Uses `VITE_EXECUTION_MODE` (default: `sim`)
- `src/lib/config.ts:5` - Uses `VITE_USE_AGENT_BACKEND` (default: `false`)

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
export REDACTED_ADDRESS_SEPOLIA="0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
export WETH_ADDRESS_SEPOLIA="0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"

npm run dev
```

**Expected:** `🌸 Blossom Agent server running on http://localhost:3002`

---

**Terminal 2: Frontend**

```bash
cd /Users/redrum/Desktop/Bloom

# Set frontend env vars (or create .env.local)
export VITE_AGENT_API_URL=http://localhost:3002
export VITE_USE_AGENT_BACKEND=true
export VITE_EXECUTION_MODE=eth_testnet
export VITE_EXECUTION_AUTH_MODE=direct
export VITE_ETH_TESTNET_INTENT=mock

npm run dev
```

**Expected:** Frontend runs on `http://localhost:5173` (or similar Vite port)

---

### Success Criteria: End-to-End Flow

**Test Flow:**
1. Open frontend in browser: `http://localhost:5173`
2. Connect MetaMask wallet (switch to Sepolia testnet)
3. Send message: "Swap 100 REDACTED for WETH"
4. Click "Confirm & Execute"
5. **Verify:**
   - ✅ Wallet prompts for approval (if needed)
   - ✅ Wallet prompts for execution transaction
   - ✅ Transaction hash appears in chat: "Submitted on Sepolia: 0x..."
   - ✅ Status updates: "Confirmed on Sepolia: 0x..." (after ~15s)
   - ✅ Portfolio refreshes (REDACTED decreases, WETH increases)

**Checkpoints:**
- **Prepare:** Check browser console for `/api/execute/prepare` call
- **Tx Hash:** Check chat for "Submitted on Sepolia" message
- **Status:** Check chat for "Confirmed" or "Reverted" message
- **Portfolio:** Check portfolio panel for updated balances

---

## PHASE C: LLM Provider - Gemini or Stub

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

---

### STUB Mode Smoke Test

**Setup:**
```bash
cd /Users/redrum/Desktop/Bloom/agent

export BLOSSOM_MODEL_PROVIDER=stub
# Don't set any API keys

npm run dev
```

**Test Prompts:**
1. `curl -X POST http://localhost:3002/api/chat -H "Content-Type: application/json" -d '{"userMessage":"Long ETH with 3% risk","venue":"hyperliquid"}' | jq`
2. **Expected:** Returns stub response with `assistantMessage` and empty `actions` array
3. **Verify:** No external API calls made (check backend logs)

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

npm run dev
```

**Verification Steps:**
1. **Check Provider Logging:**
   - Add temporary log in `agent/src/services/llmClient.ts:33`:
     ```typescript
     console.log('[llmClient] Using provider:', provider);
     ```
   - Restart backend, send chat message
   - **Expected:** Log shows `Using provider: gemini`

2. **Check API Calls:**
   - Monitor backend logs for Gemini API calls
   - **Expected:** Requests to `https://generativelanguage.googleapis.com/v1beta/models/...`

3. **Test Response:**
   - Send message: "Long ETH with 3% risk"
   - **Expected:** Real AI response (not stub)

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

---

**Status:** Ready to execute. Run Phase A commands first, then Phase B, then Phase C.

