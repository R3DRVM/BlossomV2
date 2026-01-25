# Blossom Sepolia Testnet - Manual Testing Guide

This guide helps testers verify Blossom's testnet MVP without requiring frontend access.

## Prerequisites

- Node.js 18+ installed
- Access to Sepolia testnet (RPC endpoint)
- Basic command-line familiarity
- `curl` or `httpie` for API testing

## Setup

### 1. Clone and Install

```bash
cd /Users/redrum/Desktop/Bloom/agent
npm install
```

### 2. Set Environment Variables

Create a shell script or export directly:

```bash
export EXECUTION_MODE=eth_testnet
export EXECUTION_AUTH_MODE=direct
export ETH_TESTNET_RPC_URL="https://sepolia.infura.io/v3/YOUR_KEY"
export EXECUTION_ROUTER_ADDRESS="0xC274dba8381C3Dcd4823Fb17f980ad32caDf751e"
export MOCK_SWAP_ADAPTER_ADDRESS="0x0a68599554ceFE00304e2b7dDfB129528F66d31F"
export UNISWAP_V3_ADAPTER_ADDRESS="0x9D2E705FA2f63cd85CfB72f973F85A34A173fC4A"
export REDACTED_ADDRESS_SEPOLIA="0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
export WETH_ADDRESS_SEPOLIA="0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"
```

**Important:** Never commit these to git. Use environment variables only.

### 3. Start Backend

```bash
cd /Users/redrum/Desktop/Bloom/agent
PORT=3001 npm run dev
```

You should see:
```
🌸 Blossom Agent server running on http://localhost:3001
   API endpoints:
   - POST /api/chat
   ...
```

## Testing Procedures

### Test 1: Health Check

```bash
curl http://localhost:3001/health
```

**Expected:**
```json
{"status":"ok","service":"blossom-agent"}
```

**If fails:** Backend not running or wrong port.

---

### Test 2: Preflight Check

```bash
curl http://localhost:3001/api/execute/preflight
```

**Expected (Success):**
```json
{
  "ok": true,
  "mode": "eth_testnet",
  "chainId": 11155111,
  "router": "0xC274dba8381C3Dcd4823Fb17f980ad32caDf751e",
  "adapter": "0x0a68599554ceFE00304e2b7dDfB129528F66d31F",
  "rpc": true,
  "notes": []
}
```

**Expected (Failure - Missing Config):**
```json
{
  "ok": false,
  "mode": "eth_testnet",
  "notes": [
    "EXECUTION_ROUTER_ADDRESS not configured",
    "MOCK_SWAP_ADAPTER_ADDRESS not configured"
  ]
}
```

**If fails:**
1. Check `notes` array for missing variables
2. Export missing variables
3. Restart backend
4. Retry

---

### Test 3: Portfolio Endpoint

```bash
# Replace with a real Sepolia address
curl "http://localhost:3001/api/portfolio/eth_testnet?userAddress=0x7abFA1E1c78DfAd99A0428D9437dF05157c08FcC"
```

**Expected:**
```json
{
  "chainId": 11155111,
  "userAddress": "0x7abfa1e1c78dfad99a0428d9437df05157c08fcc",
  "balances": {
    "eth": {
      "wei": "0x...",
      "formatted": "0.25"
    },
    "usdc": {
      "raw": "0x...",
      "decimals": 6,
      "formatted": "1000.00"
    },
    "weth": {
      "raw": "0x...",
      "decimals": 18,
      "formatted": "0.5"
    }
  }
}
```

**If fails:**
- Check `ETH_TESTNET_RPC_URL` is valid
- Check `REDACTED_ADDRESS_SEPOLIA` and `WETH_ADDRESS_SEPOLIA` are set
- Verify RPC endpoint is reachable

---

### Test 4: Prepare Swap Execution

```bash
curl -X POST http://localhost:3001/api/execute/prepare \
  -H "Content-Type: application/json" \
  -d '{
    "draftId": "test-draft-1",
    "userAddress": "0x7abFA1E1c78DfAd99A0428D9437dF05157c08FcC",
    "executionIntent": "swap_usdc_weth",
    "authMode": "direct"
  }'
```

**Expected:**
```json
{
  "chainId": 11155111,
  "to": "0xC274dba8381C3Dcd4823Fb17f980ad32caDf751e",
  "value": "0x0",
  "plan": {
    "user": "0x7abfa1e1c78dfad99a0428d9437df05157c08fcc",
    "nonce": "0",
    "deadline": "1735689600",
    "actions": [
      {
        "actionType": 3,
        "adapter": "0x9D2E705FA2f63cd85CfB72f973F85A34A173fC4A",
        "data": "0x..."
      }
    ]
  },
  "requirements": {
    "approvals": [
      {
        "token": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
        "spender": "0xC274dba8381C3Dcd4823Fb17f980ad32caDf751e",
        "amount": "100000000"
      }
    ]
  },
  "summary": "Swap 100 REDACTED for WETH via Uniswap V3"
}
```

**Key Fields to Verify:**
- `to` matches `EXECUTION_ROUTER_ADDRESS`
- `plan.actions[0].adapter` matches `UNISWAP_V3_ADAPTER_ADDRESS`
- `plan.actions[0].data` is non-empty (starts with `0x`)
- `requirements.approvals` exists if user needs to approve tokens

**If fails:**
- Check all env vars are set
- Verify preflight returns `ok: true`
- Check backend logs for errors

---

### Test 5: Prepare Token Approval

If Test 4 returned `requirements.approvals`, prepare an approval:

```bash
curl -X POST http://localhost:3001/api/token/approve/prepare \
  -H "Content-Type: application/json" \
  -d '{
    "token": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    "spender": "0xC274dba8381C3Dcd4823Fb17f980ad32caDf751e",
    "amount": "100000000",
    "userAddress": "0x7abFA1E1c78DfAd99A0428D9437dF05157c08FcC"
  }'
```

**Expected:**
```json
{
  "chainId": 11155111,
  "to": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  "data": "0x095ea7b3...",
  "value": "0x0",
  "summary": "Approve ExecutionRouter to spend 100 REDACTED"
}
```

**Key Fields:**
- `to` is the token address
- `data` is non-empty (ERC20 approve calldata)
- `value` is `"0x0"` (no ETH sent)

---

## Interpreting Common Failures

### "RPC error: invalid argument 0: json: cannot unmarshal invalid hex string"

**Cause:** Malformed RPC call data (usually fixed in latest version).

**Fix:** Ensure backend is using latest code with proper hex encoding.

---

### "Adapter check error: RPC error: ..."

**Cause:** Adapter not allowlisted or RPC call failed.

**Fix:**
1. Verify `MOCK_SWAP_ADAPTER_ADDRESS` is allowlisted in router
2. Check RPC endpoint is reachable
3. Verify contract addresses are correct

---

### "Portfolio endpoint: ETH_TESTNET_RPC_URL not configured"

**Cause:** Missing RPC URL environment variable.

**Fix:** Export `ETH_TESTNET_RPC_URL` and restart backend.

---

### "Execute prepare: UNISWAP_V3_ADAPTER_ADDRESS not configured"

**Cause:** Missing adapter address for swap intent.

**Fix:** Export `UNISWAP_V3_ADAPTER_ADDRESS` and restart backend.

---

### Preflight `ok: false` with "Router contract not deployed"

**Cause:** Contract address incorrect or contract not deployed.

**Fix:**
1. Verify address on Sepolia explorer
2. Check `EXECUTION_ROUTER_ADDRESS` matches deployed contract
3. Ensure contract has bytecode (not EOA)

---

## Automated E2E Testing

For comprehensive testing, use the E2E script:

```bash
cd /Users/redrum/Desktop/Bloom

export TEST_USER_ADDRESS="0x7abFA1E1c78DfAd99A0428D9437dF05157c08FcC"
export BASE_URL="http://localhost:3001"

# Run with mock intent (no real swap)
node agent/scripts/e2e-sepolia-smoke.ts --full --intent mock

# Run with real Uniswap intent (prepare only)
node agent/scripts/e2e-sepolia-smoke.ts --full --intent swap_usdc_weth
```

**Expected Output:**
- ✓ PASS Health endpoint
- ✓ PASS Preflight check (ok: true)
- ✓ PASS Portfolio endpoint
- ✓ PASS Execute prepare (returns plan)
- Passed: X, Failed: 0

---

## Session Mode Testing

To test session mode (relayer execution):

```bash
export EXECUTION_AUTH_MODE=session
export RELAYER_PRIVATE_KEY="0x..."  # Wallet with Sepolia ETH

# Restart backend
PORT=3001 npm run dev
```

Then test session preparation:

```bash
curl -X POST http://localhost:3001/api/session/prepare \
  -H "Content-Type: application/json" \
  -d '{
    "userAddress": "0x7abFA1E1c78DfAd99A0428D9437dF05157c08FcC"
  }'
```

**Expected:** Returns transaction payload to create session (user signs this once).

**Note:** Session mode requires `RELAYER_PRIVATE_KEY` with Sepolia ETH for gas.

---

## Next Steps

Once manual testing passes:
1. Verify all endpoints return expected responses
2. Test with different user addresses
3. Test with different swap intents (`swap_usdc_weth`, `swap_weth_usdc`)
4. Verify transaction status tracking (if implemented)

For production readiness, see `docs/TESTNET_MVP_STATUS.md`.

