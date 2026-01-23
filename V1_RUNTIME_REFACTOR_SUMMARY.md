# V1/V1.1 Runtime Refactor Summary

**Date:** 2025-01-03  
**Status:** ✅ **COMPLETE** - Testnet-only by default, SIM mode isolated

---

## Changes Made

### 1. Default to Testnet Mode ✅

**Backend (`agent/src/config.ts`):**
- `EXECUTION_MODE` now defaults to `eth_testnet` (was `sim`)
- `EXECUTION_AUTH_MODE` defaults to `direct`
- SIM mode only available if `ALLOW_SIM_MODE=true` is explicitly set
- Auto-switches to `eth_testnet` if `EXECUTION_MODE=sim` is set but `ALLOW_SIM_MODE` is not `true`

**Frontend (`src/lib/config.ts`):**
- `VITE_EXECUTION_MODE` now defaults to `eth_testnet` (was `sim`)
- SIM UI/features only available if `VITE_ALLOW_SIM_MODE=true` is explicitly set

### 2. SIM Mode Hard Isolation ✅

**Backend:**
- `/api/wallet/balances` only returns SIM mode if `ALLOW_SIM_MODE=true`
- `/api/execute/preflight` only returns SIM mode if `ALLOW_SIM_MODE=true`
- `/api/reset` only resets simulation state if SIM mode is allowed; otherwise only resets chat state

**Result:** SIM mode cannot leak into V1/V1.1 flows unless explicitly enabled.

### 3. Startup Validation ✅

**Backend (`agent/src/server/http.ts`):**
- `/health` endpoint validates required config and returns `ok: false` + `missing: []` if vars missing
- Startup banner shows clear errors with actionable fix commands
- Validates:
  - `ETH_TESTNET_RPC_URL` (required for eth_testnet mode)
  - `EXECUTION_ROUTER_ADDRESS` (required for eth_testnet mode)
  - `BLOSSOM_GEMINI_API_KEY` (or other LLM key, required for `/api/chat`)

**Result:** Backend fails fast with clear errors if required config is missing.

### 4. Scripts Updated ✅

**`scripts/restart-demo.sh`:**
- Runs health check after startup
- Checks execution mode (must be `eth_testnet`)
- Runs preflight check
- Only prints "READY" if all checks pass
- Provides actionable guidance if config missing

**`scripts/v1-smoke.sh` (NEW):**
- Asserts `executionMode=eth_testnet` in health response
- Asserts preflight returns `ok: true`
- Asserts wallet balances does NOT return SIM mode
- Tests all critical endpoints

### 5. Documentation Updated ✅

**`bloomoverview.md`:**
- Added "Blossom V1/V1.1 Runtime Rules" section
- Documents default behavior (testnet-only)
- Documents SIM mode isolation
- Documents required env vars
- Documents startup commands and expected outputs

---

## Required Environment Variables for V1/V1.1

**Backend (`agent/.env.local`):**
```bash
# Required for eth_testnet mode
ETH_TESTNET_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
EXECUTION_ROUTER_ADDRESS=0x...
BLOSSOM_GEMINI_API_KEY=...  # Or BLOSSOM_OPENAI_API_KEY or BLOSSOM_ANTHROPIC_API_KEY
```

**Frontend (`.env.local` or `.env`):**
```bash
# Optional - defaults to eth_testnet
VITE_EXECUTION_MODE=eth_testnet
VITE_EXECUTION_AUTH_MODE=direct
```

---

## Exact Commands to Run Locally

### 1. Start Demo
```bash
./scripts/restart-demo.sh
```

**Expected Output:**
```
✅ Backend health check passed
✅ Preflight check passed
==========================================
✅ Demo READY
==========================================
```

### 2. Verify Health
```bash
curl -s http://127.0.0.1:3001/health
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

### 3. Run V1 Smoke Test
```bash
./scripts/v1-smoke.sh
```

**Expected Output:**
```
==========================================
V1/V1.1 Smoke Test
==========================================

Test 1: Health check (executionMode=eth_testnet)
✅ PASS (executionMode=eth_testnet)

Testing /api/execute/preflight... ✅ PASS
Testing /api/prices/simple... ✅ PASS
Testing /api/session/status... ✅ PASS

==========================================
Results: 5 passed, 0 failed
==========================================

✅ All V1/V1.1 smoke tests passed!
```

---

## Files Changed

| File | Changes |
|------|---------|
| `agent/src/config.ts` | Default to eth_testnet, SIM mode requires ALLOW_SIM_MODE=true |
| `src/lib/config.ts` | Default to eth_testnet, SIM mode requires VITE_ALLOW_SIM_MODE=true |
| `agent/src/server/http.ts` | SIM mode checks, startup validation, health endpoint validation |
| `scripts/restart-demo.sh` | Health + preflight checks, execution mode validation |
| `scripts/v1-smoke.sh` | New: V1/V1.1 smoke test script |
| `bloomoverview.md` | Added "Blossom V1/V1.1 Runtime Rules" section |

---

## Build & Test Status

```
✓ Frontend: vite build passed
✓ Backend: tsc passed
✓ Forge tests: All passing
✓ No linter errors
```

---

## Verification Results

**After implementation, run:**

```bash
# 1. Build verification
npm run build
cd agent && npm run build
forge test

# 2. Start demo
./scripts/restart-demo.sh

# 3. Verify health
curl -s http://127.0.0.1:3001/health

# 4. Run smoke test
./scripts/v1-smoke.sh
```

**Expected:** All checks pass, executionMode=eth_testnet, no SIM mode leakage.

---

## Summary

✅ **V1/V1.1 now runs testnet-only by default**  
✅ **SIM mode is hard-isolated and requires explicit opt-in**  
✅ **Backend validates required config and fails fast**  
✅ **Scripts verify configuration before declaring "READY"**  
✅ **Documentation updated with runtime rules**

**Result:** Zero ambiguity, zero "backend misconfigured" investor failure modes. V1/V1.1 is boringly reliable.


