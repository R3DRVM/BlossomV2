# Final Command: Gemini AI Agent Verification

## Single Copy-Paste Command Block

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

```
✓ PASS Health endpoint
  Response: { "status": "ok", "service": "blossom-agent", "llmProvider": "gemini" }

✓ PASS Preflight check (ok: true)

✓ PASS Portfolio endpoint (returns balances)

✓ PASS Execute prepare (returns plan)
  ✓ Plan actions have non-empty calldata
  ✓ Plan uses UniswapV3SwapAdapter

✓ PASS AI-driven plan generation (provider: gemini)
  LLM Provider: gemini
  AI Response: I'll swap 50 USDC for WETH...
  Actions: [...]
  AI generated actionable plan

Passed: 6, Failed: 0
✅ All tests passed!
```

---

## Failure Modes & Debugging

### Failure 1: Gemini Key Missing

**Output:**
```
[llmClient] Gemini key missing, falling back to stub
✓ SKIP AI-driven plan generation (using stub provider)
```

**Fix:**
```bash
export BLOSSOM_GEMINI_API_KEY="your-actual-key"
# Restart backend
```

---

### Failure 2: Gemini API Error

**Output:**
```
✗ FAIL AI-driven plan generation: Gemini API error: 401 Unauthorized
```

**Causes:**
- Invalid API key
- Expired key
- Rate limit

**Fix:**
- Verify key at https://aistudio.google.com/apikey
- Check quota/limits
- Wait and retry

---

### Failure 3: Preflight Fails

**Output:**
```
✗ FAIL Preflight check (ok: false)
```

**Fix:**
- Verify all contract addresses exported
- Check RPC endpoint: `curl "$SEPOLIA_RPC_URL"`
- Verify contracts deployed on Sepolia

---

## What Success Looks Like

1. ✅ **Health shows Gemini:** `/health` returns `"llmProvider": "gemini"`
2. ✅ **AI generates plan:** Natural language → structured plan
3. ✅ **Plan maps correctly:** Swap intent → Uniswap adapter
4. ✅ **Execution ready:** Prepare returns valid calldata
5. ✅ **No warnings:** No hex string errors, no false assertions

---

## Next Steps After Success

1. **Frontend Test:**
   - Set `VITE_AGENT_API_URL=http://localhost:3002`
   - Set `VITE_USE_AGENT_BACKEND=true`
   - Set `VITE_EXECUTION_MODE=eth_testnet`
   - Open UI, connect wallet, test full flow

2. **Optional: Submit Test:**
   - Add `export E2E_SUBMIT=1`
   - Add `export EXECUTION_AUTH_MODE=session`
   - Add `export RELAYER_PRIVATE_KEY="0x..."`
   - Re-run to test real transaction submission

---

**Status:** Ready to run. Replace `your-gemini-api-key-here` with your actual key.

