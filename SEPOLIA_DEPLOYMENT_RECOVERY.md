# Sepolia Deployment Recovery Report

**Date:** 2025-01-04  
**Status:** ✅ **RECOVERED** - ExecutionRouter address found and verified on-chain

---

## Diagnosis

**Problem:** Backend health endpoint reported missing:
- `EXECUTION_ROUTER_ADDRESS`
- `RELAYER_PRIVATE_KEY`

**Root Cause:** 
- ExecutionRouter was deployed but address not set in `agent/.env.local`
- `EXECUTION_AUTH_MODE` was set to `session` (requires relayer), switched to `direct` for Bucket A

---

## Found Evidence

### Deployment Artifacts

**Location:** `contracts/broadcast/DeploySepolia.s.sol/11155111/run-latest.json`

**Deployed Contracts (Sepolia Chain ID: 11155111):**

| Contract | Address | Source |
|----------|---------|--------|
| **ExecutionRouter** | `0xc274dba8381c3dcd4823fb17f980ad32cadf751e` | `contracts/broadcast/DeploySepolia.s.sol/11155111/run-latest.json:7` |
| **MockSwapAdapter** | `0x0a68599554cefe00304e2b7ddfb129528f66d31f` | `contracts/broadcast/DeploySepolia.s.sol/11155111/run-latest.json:25` |
| **UniswapV3SwapAdapter** | `0x9d2e705fa2f63cd85cfb72f973f85a34a173fc4a` | `contracts/broadcast/DeploySepolia.s.sol/11155111/run-latest.json:65` |

**Deployment Transaction:**
- ExecutionRouter: `0xee8425b79f624cec644a7fad4271716710916dd19715df465dc5a680f9d75fb3`
- Chain ID: `11155111` (Sepolia)

### On-Chain Verification

**ExecutionRouter Address:** `0xc274dba8381c3dcd4823fb17f980ad32cadf751e`
- ✅ **Code exists:** Verified via `eth_getCode` on Sepolia
- ✅ **Balance:** 0 wei (expected for contract)
- ✅ **Status:** Active and deployed

---

## Actions Taken

### 1. Environment File Loading

**Confirmed:** Backend loads env files with precedence:
1. `agent/.env.local` (highest priority)
2. `agent/.env`
3. `root/.env.local`
4. `root/.env`

**Result:** `agent/.env.local` is loaded first (as expected).

### 2. Address Recovery

**ExecutionRouter:** Found in latest deployment artifact and verified on-chain.

### 3. Relayer Configuration

**Decision:** Switched `EXECUTION_AUTH_MODE` from `session` to `direct` for Bucket A.

**Reasoning:**
- Relayer is only required for session mode (`EXECUTION_AUTH_MODE=session`)
- Session mode requires `RELAYER_PRIVATE_KEY` (must be funded with Sepolia ETH)
- Direct mode (`EXECUTION_AUTH_MODE=direct`) does not require relayer
- Bucket A (Demo Reliability) focuses on direct execution flows

**Note:** If session mode is needed later, set:
- `EXECUTION_AUTH_MODE=session`
- `RELAYER_PRIVATE_KEY=<private_key_of_funded_wallet>`

### 4. Environment File Updates

**Updated `agent/.env.local`:**
- ✅ Set `EXECUTION_ROUTER_ADDRESS=0xc274dba8381c3dcd4823fb17f980ad32cadf751e`
- ✅ Set `EXECUTION_AUTH_MODE=direct`
- ✅ Added `MOCK_SWAP_ADAPTER_ADDRESS=0x0a68599554cefe00304e2b7ddfb129528f66d31f`
- ✅ Added `UNISWAP_V3_ADAPTER_ADDRESS=0x9d2e705fa2f63cd85cfb72f973f85a34a173fc4a`

---

## Relayer Requirements (For Future Session Mode)

**What is the relayer?**
- The relayer is a backend-controlled wallet that executes transactions on behalf of users in session mode
- Users create a session once, then the relayer executes subsequent transactions without user prompts
- Enables "one-click" execution UX

**Required Configuration:**
- `RELAYER_PRIVATE_KEY`: Private key of a wallet funded with Sepolia ETH
- Wallet must have ETH for gas fees
- Wallet address is derived from private key and used as `executor` in session creation

**Where it's used:**
- `agent/src/server/http.ts`: `/api/session/prepare` and `/api/execute/relayed` endpoints
- Only required when `EXECUTION_AUTH_MODE=session`

**Current Status:** Not required (using `direct` mode)

---

## Exact .env.local Lines to Set

**Required for eth_testnet mode:**
```bash
EXECUTION_ROUTER_ADDRESS=0xc274dba8381c3dcd4823fb17f980ad32cadf751e
EXECUTION_AUTH_MODE=direct
MOCK_SWAP_ADAPTER_ADDRESS=0x0a68599554cefe00304e2b7ddfb129528f66d31f
UNISWAP_V3_ADAPTER_ADDRESS=0x9d2e705fa2f63cd85cfb72f973f85a34a173fc4a
```

**Already configured (do not change):**
- `ETH_TESTNET_RPC_URL=***` (already set)
- `BLOSSOM_GEMINI_API_KEY=***` (already set)

**For session mode (optional, future):**
```bash
RELAYER_PRIVATE_KEY=<paste_private_key_of_funded_wallet_here>
```

**Note:** Do NOT commit private keys to git. Keep them in `.env.local` (already in `.gitignore`).

---

## Verification Commands

**1. Check health endpoint:**
```bash
curl -s http://127.0.0.1:3001/health | cat
```

**Expected Output:**
```json
{
  "ok": true,
  "ts": 1234567890,
  "service": "blossom-agent",
  "executionMode": "eth_testnet"
}
```

**2. Check preflight:**
```bash
curl -s http://127.0.0.1:3001/api/execute/preflight | cat
```

**Expected Output:**
```json
{
  "ok": true,
  "rpc": { "ok": true },
  "router": { "address": "0xc274dba8381c3dcd4823fb17f980ad32cadf751e", "ok": true },
  "notes": []
}
```

**3. Run V1 smoke test:**
```bash
./scripts/v1-smoke.sh
```

**Expected:** All tests pass ✅

---

## Summary

✅ **ExecutionRouter address recovered:** `0xc274dba8381c3dcd4823fb17f980ad32cadf751e`  
✅ **On-chain verification:** Code exists, contract is active  
✅ **Environment updated:** `agent/.env.local` configured with router and adapter addresses  
✅ **Auth mode switched:** Changed from `session` to `direct` (no relayer required for Bucket A)  
✅ **Ready for verification:** Health endpoint should now return `ok: true`

**Next Steps:**
1. Restart backend: `cd agent && npm run dev`
2. Verify health: `curl -s http://127.0.0.1:3001/health`
3. Run smoke test: `./scripts/v1-smoke.sh`

---

## Files Modified

- `agent/.env.local` - Added ExecutionRouter and adapter addresses, switched to direct mode


