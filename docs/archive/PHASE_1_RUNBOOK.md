# Phase 1: Strict E2E Rerun - Runbook

## Single Copy-Paste Command Block

```bash
cd /Users/redrum/Desktop/Bloom

# Set all required environment variables
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

# Test with mock intent
export E2E_INTENT="mock"
bash ./scripts/deploy-and-verify-sepolia.sh
```

**After mock passes, test uniswap intent:**
```bash
export E2E_INTENT="uniswap"
bash ./scripts/deploy-and-verify-sepolia.sh
```

## Expected Output

**Success indicators:**
- ✅ Preflight check (ok: true)
- ✅ Portfolio endpoint (returns balances)
- ✅ Execute prepare (returns plan with non-empty calldata)
- ✅ Assertions pass (router, adapter, calldata validation)
- ✅ Final summary: `Passed: X, Failed: 0`

**Script behavior:**
- Prints full E2E output (no silent failures)
- Shows backend logs on failure (last 60 lines)
- Prints exact exit code
- Cleans up backend process on exit

---

## Failure Triage

### Preflight Returns `ok: false`

**Check:**
1. All env vars exported? (script will fail early if missing)
2. RPC endpoint reachable? (`curl "$SEPOLIA_RPC_URL"` should work)
3. Contract addresses correct? (verify on Sepolia explorer)
4. Adapter allowlisted? (check preflight `notes` array)

**Common errors:**
- `Adapter check error: RPC error: invalid argument` → Fixed in latest code (uses viem encoding)
- `Nonce check error: RPC error: invalid argument` → Fixed in latest code (uses eth_getTransactionCount)
- `Router contract not deployed` → Verify `EXECUTION_ROUTER_ADDRESS` has bytecode

**Fix:**
- Verify env vars match deployed addresses
- Check RPC endpoint is accessible
- Restart backend after env var changes

---

### Portfolio Endpoint Returns 500

**Check:**
1. `ETH_TESTNET_RPC_URL` set and valid?
2. `REDACTED_ADDRESS_SEPOLIA` and `WETH_ADDRESS_SEPOLIA` set?
3. RPC endpoint rate-limited?

**Common errors:**
- `ETH_TESTNET_RPC_URL not configured` → Export the env var
- `Failed to fetch portfolio balances` → Check RPC connectivity
- `RPC error: rate limit exceeded` → Use different RPC endpoint

**Fix:**
- Export missing env vars
- Try fallback RPC: `export ETH_TESTNET_RPC_URL="https://ethereum-sepolia-rpc.publicnode.com"`
- Restart backend

---

### Execute Prepare Fails

**Check:**
1. Preflight returned `ok: true`?
2. `UNISWAP_V3_ADAPTER_ADDRESS` set (for uniswap intent)?
3. `REDACTED_ADDRESS_SEPOLIA` and `WETH_ADDRESS_SEPOLIA` set?
4. Backend logs show errors?

**Common errors:**
- `UNISWAP_V3_ADAPTER_ADDRESS not configured` → Export the env var
- `REDACTED_ADDRESS_SEPOLIA not configured` → Export the env var
- `Failed to fetch nonce` → RPC connectivity issue

**Fix:**
- Export all required env vars
- Check backend logs: `tail -f /tmp/blossom-backend.log`
- Verify RPC endpoint is working

---

### E2E Assertions Fail

**Check:**
1. Router address matches preflight?
2. Adapter is allowlisted (from preflight)?
3. Transaction target is ExecutionRouter?
4. Plan actions have non-empty calldata?
5. Uniswap adapter used (for uniswap intent)?

**Common failures:**
- `Router mismatch` → Preflight and prepare using different addresses
- `Plan actions missing calldata` → Encoding issue in executor
- `Plan adapter mismatch` → Wrong adapter address in env

**Fix:**
- Verify env vars are consistent
- Check backend logs for encoding errors
- Re-run preflight to verify addresses

---

## Manual Verification Steps

If script passes but you want to verify manually:

```bash
# 1. Check backend is running
curl http://localhost:3002/health

# 2. Check preflight
curl http://localhost:3002/api/execute/preflight | jq

# 3. Check portfolio
curl "http://localhost:3002/api/portfolio/eth_testnet?userAddress=0x7abFA1E1c78DfAd99A0428D9437dF05157c08FcC" | jq

# 4. Check execute prepare
curl -X POST http://localhost:3002/api/execute/prepare \
  -H "Content-Type: application/json" \
  -d '{"draftId":"test","userAddress":"0x7abFA1E1c78DfAd99A0428D9437dF05157c08FcC","executionIntent":"mock","authMode":"direct"}' | jq
```

---

## Success Criteria

**Both intents must pass:**
- `E2E_INTENT=mock` → Passed: X, Failed: 0
- `E2E_INTENT=uniswap` → Passed: X, Failed: 0

**All checks must pass:**
- Preflight `ok: true`
- Portfolio returns balances
- Execute prepare returns plan
- Assertions pass (router, adapter, calldata)

**No silent failures:**
- Full E2E output printed
- Backend logs shown on failure
- Exit code clearly displayed

