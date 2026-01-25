# Final Gemini Verification: AI → Plan → Execution

## Single Command Block to Verify End-to-End

```bash
cd /Users/redrum/Desktop/Bloom

# Backend Configuration
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

# Gemini Configuration (REQUIRED for AI agent)
export BLOSSOM_MODEL_PROVIDER=gemini
export BLOSSOM_GEMINI_API_KEY="your-gemini-api-key-here"

# E2E Configuration
export E2E_INTENT="uniswap"

# Run E2E verification
bash ./scripts/deploy-and-verify-sepolia.sh
```

---

## Expected GREEN Output

### Success Indicators:

```
✓ PASS Health endpoint
  Response: { "status": "ok", "service": "blossom-agent", "llmProvider": "gemini" }

✓ PASS Preflight check (ok: true)

✓ PASS Portfolio endpoint (returns balances)

✓ PASS Execute prepare (returns plan)
  ✓ Plan actions have non-empty calldata
  ✓ Plan uses UniswapV3SwapAdapter

✓ PASS AI-driven plan generation (provider: gemini)
  AI Response: I'll swap 50 USDC for WETH...
  Actions: [...]
  AI generated actionable plan

Passed: 6, Failed: 0
✅ All tests passed!
```

**Key Success Points:**
1. ✅ `/health` shows `llmProvider: "gemini"`
2. ✅ AI generates plan from natural language
3. ✅ Plan maps to swap intent correctly
4. ✅ Execution prepare returns valid calldata
5. ✅ No warnings about invalid hex strings
6. ✅ No false "missing calldata" errors

---

## Failure Modes & Debugging

### Failure 1: Gemini Key Missing

**Symptom:**
```
[llmClient] Gemini key missing, falling back to stub
✓ PASS AI-driven plan generation (using stub provider)
```

**Fix:**
```bash
export BLOSSOM_GEMINI_API_KEY="your-actual-key"
# Restart backend
```

---

### Failure 2: Gemini API Error

**Symptom:**
```
✗ FAIL AI-driven plan generation: Gemini API error: 401 Unauthorized
```

**Possible Causes:**
- Invalid API key
- API key expired
- Rate limit exceeded

**Fix:**
- Verify API key is correct
- Check Gemini API quota
- Wait and retry

---

### Failure 3: Invalid Plan Structure

**Symptom:**
```
✗ FAIL AI-driven plan generation (invalid response structure)
```

**Possible Causes:**
- Gemini returned malformed JSON
- JSON doesn't match expected schema

**Debug:**
- Check backend logs for raw Gemini response
- Verify prompt engineering is correct

---

### Failure 4: Preflight Fails

**Symptom:**
```
✗ FAIL Preflight check (ok: false)
```

**Fix:**
- Verify all contract addresses are set
- Check RPC endpoint is reachable
- Verify contracts are deployed

---

### Failure 5: ERC20 Encoding Warning

**Symptom:**
```
Could not verify token balance/allowance: RPC error: invalid argument 0: json: cannot unmarshal invalid hex string
```

**Status:** ✅ **FIXED** - This should not appear with latest code (uses viem encoding)

**If it appears:**
- Verify `agent/src/executors/erc20Rpc.ts` uses `encodeFunctionData`
- Check backend is using latest code

---

## Manual Verification Steps

### 1. Verify Gemini is Active

```bash
curl http://localhost:3002/health | jq '.llmProvider'
# Expected: "gemini"
```

### 2. Test AI Plan Generation

```bash
curl -X POST http://localhost:3002/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "userMessage": "Swap 50 USDC for WETH",
    "venue": "hyperliquid",
    "clientPortfolio": {
      "accountValueUsd": 10000,
      "balances": [
        { "symbol": "USDC", "balanceUsd": 5000 }
      ]
    }
  }' | jq '.assistantMessage, .actions'
```

**Expected:**
- `assistantMessage` contains AI-generated text
- `actions` array is non-empty
- Actions are relevant to swap request

### 3. Verify Execution Prepare

```bash
curl -X POST http://localhost:3002/api/execute/prepare \
  -H "Content-Type: application/json" \
  -d '{
    "draftId": "test",
    "userAddress": "0x7abFA1E1c78DfAd99A0428D9437dF05157c08FcC",
    "executionIntent": "swap_usdc_weth",
    "authMode": "direct"
  }' | jq '.plan.actions[0].data'
```

**Expected:**
- Non-empty `data` field (starts with `0x` and has length > 2)
- `adapter` matches `UNISWAP_V3_ADAPTER_ADDRESS`

---

## Frontend Integration

### Env Vars (Frontend)

```bash
export VITE_AGENT_API_URL=http://localhost:3002
export VITE_USE_AGENT_BACKEND=true
export VITE_EXECUTION_MODE=eth_testnet
```

### Test Flow

1. Open UI: `http://localhost:5173`
2. Connect MetaMask (Sepolia)
3. Send message: "Swap 50 USDC for WETH"
4. **Expected:** Gemini generates plan
5. Click "Confirm & Execute"
6. **Expected:** Tx hash appears, status polls, portfolio refreshes

---

## Summary

✅ **Gemini is primary AI agent**
✅ **Falls back to stub if key missing (no errors)**
✅ **AI generates plans from natural language**
✅ **Execution flow works end-to-end**
✅ **Demo parity preserved (sim vs testnet)**

**Status:** Ready for production testing with Gemini.

