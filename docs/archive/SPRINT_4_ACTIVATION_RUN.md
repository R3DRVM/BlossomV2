# Sprint 4 Activation: Bulletproof Pillars 1–4

## Known Values
- EXECUTION_ROUTER_ADDRESS=0xA31E1C25262A4C03e8481231F12634EFa060fE6F
- TEST_USER_ADDRESS=0x7abFA1E1c78DfAd99A0428D9437dF05157c08FcC
- Sepolia RPC: Infura (from existing env)

---

## PHASE 0 — CLEAN STATE CHECK

### Command: `git status --porcelain`
```
A  .gitmodules
 M ARCHITECTURE.md
[... many modified and untracked files ...]
```

### Command: `git rev-parse --short HEAD`
```
bd577b9
```

### Action: Created checkpoint branch
```
git checkout -b sprint4-activation-checkpoint
```
**Status**: Checkpoint created. Proceeding with activation.

---

## PHASE 1 — BACKEND MUST BE REACHABLE

### Step 1: Check listening ports
```bash
lsof -iTCP -sTCP:LISTEN | egrep "(node|tsx|bun)"
```
**Output**: Port 5173 (frontend) was listening.

### Step 2: Kill existing processes
```bash
pkill -f "src/server/http.ts" || true
pkill -f "tsx watch" || true
```

### Step 3: Start backend
```bash
cd agent && npm run dev
```

### Step 4: Fix duplicate declaration error
**Error**: `The symbol "AAVE_ADAPTER_ADDRESS" has already been declared` at line 2324

**Fix**: Removed duplicate `AAVE_ADAPTER_ADDRESS` from second import (line 2324), keeping the one from line 2224.

### Step 5: Verify health endpoint
```bash
curl -sS http://localhost:3001/health
```
**Output**:
```json
{
  "ok": true,
  "ts": 1768977882687,
  "service": "blossom-agent",
  "executionMode": "eth_testnet",
  "debug": {
    "rpcUrlLen": 61,
    "routerAddrLen": 42,
    "hasRpcUrl": true,
    "hasRouterAddr": true,
    "hasAnyLLMKey": true
  }
}
```

**Status**: ✅ PASS - Backend reachable at http://localhost:3001/health

---

## PHASE 2 — PREFLIGHT MUST SHOW REAL MODE

### Command: `curl -sS http://localhost:3001/api/execute/preflight | jq '.lending, .allowedAdapters'`
**Output**:
```json
{
  "enabled": true,
  "mode": "real",
  "vault": "0xD00142756bd509E5201E6265fc3Dd9d5DdFE68D8",
  "adapter": "0x453c1f2E3534180f6c8692b1524dF7DA6F23fE02",
  "rateSource": "defillama",
  "defillamaOk": true
}
[
  "0xdea67619fda6d5e760658fd0605148012196dc25",
  "0x61b7b4cee334c37c372359280e2dde50cbaabdac",
  "0xf881814cd708213b6db1a7e2ab1b866ca41c784b",
  "0xb47377f77f6abb9b256057661b3b2138049b7d9d",
  "0x379ccb9b08ff3dc39c611e33d4c4c381c290e87e",
  "0x453c1f2e3534180f6c8692b1524df7da6f23fe02"
]
```

**Status**: ✅ PASS - Preflight shows `lending.mode: "real"` and AAVE adapter is in `allowedAdapters`

---

## PHASE 3 — BASELINE GATES (PILLARS 1–3)

### Command: `npm run prove:execution-kernel`
**Output**: ✅ PASS - All 13 tests passed (S1, S2, S3 invariants)

### Command: `npm run prove:session-authority`
**Output**: ✅ PASS - All 8 tests passed (I1, I2-RUNTIME, I3-RUNTIME, I4-RUNTIME, I5)

### Command: `npm run prove:dflow-routing`
**Output**: ✅ PASS - All 17 tests passed (R1-R6 routing invariants)

### Command: `npm run prove:new-user-wow`
**Output**: ✅ PASS - All 4 checks passed (health, preflight, event markets, swap quote)

### Command: `npm run prove:all`
**Output**: First 4 baseline gates passed. Later proofs (aave-adapter:deployed, etc.) expected to fail until Phase 4 completes.

**Status**: ✅ PASS - All baseline gates (Pillars 1-3) verified

---

## PHASE 4 — ADAPTER DEPLOY + ALLOWLIST

### Step 1: Run forge test
**Output**: ✅ All 74 tests passed

### Step 2: Check if adapter already deployed
**Finding**: AAVE adapter already deployed and allowlisted at `0x453c1f2E3534180f6c8692b1524dF7DA6F23fE02`

### Step 3: Add AAVE_ADAPTER_ADDRESS to agent/.env.local
```bash
echo "AAVE_ADAPTER_ADDRESS=0x453c1f2E3534180f6c8692b1524dF7DA6F23fE02" >> agent/.env.local
```

### Step 4: Restart backend and verify
**Command**: `npm run prove:aave-adapter:deployed`
**Output**: ✅ PASS - All 4 tests passed
- ADAPTER-1: AAVE_ADAPTER_ADDRESS is configured
- ADAPTER-2: Contract code exists at AAVE_ADAPTER_ADDRESS
- ADAPTER-3: ExecutionRouter allowlist includes AAVE_ADAPTER_ADDRESS
- ADAPTER-4: Preflight allowedAdapters includes AAVE_ADAPTER_ADDRESS

**Status**: ✅ PASS - Adapter deployed and allowlisted

---

## PHASE 5 — REAL PROOF (PILLAR 4)
