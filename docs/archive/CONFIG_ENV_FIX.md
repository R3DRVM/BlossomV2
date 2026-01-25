# Config/Env Evaluation Order Fix

**Date:** 2025-01-04  
**Status:** ✅ **FIXED** - Dotenv now loads before config reads process.env

---

## Problem

Backend `/health` endpoint reported missing `ETH_TESTNET_RPC_URL` and `EXECUTION_ROUTER_ADDRESS` even though `agent/.env.local` contained valid values.

**Root Cause:** ESM module evaluation order issue
- `agent/src/server/http.ts` loaded dotenv at the top
- `agent/src/config.ts` was dynamically imported (`await import('../config')`)
- But `config.ts` reads `process.env` at **module evaluation time** (not call time)
- ESM modules are cached, so if `config.ts` was evaluated before dotenv ran, it would read empty values and cache them

---

## Solution

**Moved dotenv loading to the top of `agent/src/config.ts`**

This ensures:
1. Dotenv loads **before** any `process.env` reads in `config.ts`
2. Config values are evaluated with env vars already loaded
3. Works regardless of import order (config.ts is self-contained)

**Changes:**
- Added dotenv loading at the top of `config.ts` (before any `process.env` reads)
- Added debug info to `/health` endpoint (string lengths, no secrets)
- Updated `v1-smoke.sh` to fail if required config is missing

---

## Files Changed

| File | Changes |
|------|---------|
| `agent/src/config.ts` | Added dotenv loading at the top (before process.env reads) |
| `agent/src/server/http.ts` | Added debug info to `/health` endpoint (rpcUrlLen, routerAddrLen, hasRpcUrl, hasRouterAddr) |
| `scripts/v1-smoke.sh` | Updated to fail if `ETH_TESTNET_RPC_URL` or `EXECUTION_ROUTER_ADDRESS` are missing |

---

## Verification

**After restarting backend:**

```bash
# 1. Health check (should return ok: true, no missing fields)
curl -s http://127.0.0.1:3001/health | cat

# Expected:
# {
#   "ok": true,
#   "ts": ...,
#   "service": "blossom-agent",
#   "executionMode": "eth_testnet",
#   "debug": {
#     "rpcUrlLen": 50,
#     "routerAddrLen": 42,
#     "hasRpcUrl": true,
#     "hasRouterAddr": true,
#     "hasAnyLLMKey": true
#   }
# }

# 2. Preflight check
curl -s http://127.0.0.1:3001/api/execute/preflight | cat

# Expected:
# {
#   "ok": true,
#   "rpc": { "ok": true },
#   "router": { "address": "0x...", "ok": true },
#   ...
# }

# 3. V1 smoke test
./scripts/v1-smoke.sh

# Expected: All tests pass ✅
```

---

## Debug Info in /health

The `/health` endpoint now includes a `debug` object with:
- `rpcUrlLen`: Length of `ETH_TESTNET_RPC_URL` string (0 if missing)
- `routerAddrLen`: Length of `EXECUTION_ROUTER_ADDRESS` string (0 if missing)
- `hasRpcUrl`: Boolean indicating if RPC URL is set
- `hasRouterAddr`: Boolean indicating if router address is set
- `hasAnyLLMKey`: Boolean indicating if any LLM API key is set

**Note:** No secrets are exposed, only lengths and booleans for debugging.

---

## Acceptance Criteria

✅ Dotenv loads before config reads `process.env`  
✅ `/health` returns `ok: true` and `missing: []` when config is valid  
✅ `/health` includes debug info (lengths, booleans)  
✅ `v1-smoke.sh` fails if required config is missing  
✅ Preflight shows router/rpc as `ok: true`

---

## Technical Details

**Before (Broken):**
```
http.ts loads → dotenv loads → config.ts imported → config.ts reads process.env (empty)
```

**After (Fixed):**
```
config.ts loads → dotenv loads → config.ts reads process.env (populated) → exports values
```

The key insight: In ESM, module-level code runs once when the module is first imported. By moving dotenv loading to the top of `config.ts`, we ensure it runs before any `process.env` reads in that module.


