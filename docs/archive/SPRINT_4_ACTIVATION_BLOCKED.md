# Sprint 4 Activation — BLOCKED

**Status**: ⏸️ **BLOCKED** - Backend Not Responding

---

## Phase 0: Environment Inspection

### Results
- ✅ `agent/.env.local` exists
- ✅ `LENDING_EXECUTION_MODE=real` configured
- ✅ `EXECUTION_ROUTER_ADDRESS=0xA31E1C25262A4C03e8481231F12634EFa060fE6F` configured
- ✅ `ETH_TESTNET_RPC_URL` configured
- ✅ `AAVE_SEPOLIA_POOL_ADDRESS` added to `.env.local`
- ⚠️ `AAVE_ADAPTER_ADDRESS` missing (needs deployment)
- ⚠️ `DEPLOYER_PRIVATE_KEY` not found in `agent/.env.local` (may be in contracts/.env or set via CLI)

### Backend Status
- ⚠️ Backend process running (PID 42513) but **NOT responding to HTTP requests**
- ❌ `curl http://localhost:3001/health` fails (connection refused/timeout)

---

## BLOCKER: Backend Not Responding

**Issue**: Backend process exists but HTTP endpoint is not accessible.

**Root Cause**: Backend may need restart after env changes, or port binding issue.

---

## Exact Remediation Steps

### Step 1: Restart Backend
```bash
# Kill existing backend
pkill -f 'tsx.*http.ts' || kill 42513

# Restart backend
cd agent
npm run dev
```

### Step 2: Wait for Startup
Wait 5-10 seconds for backend to fully start.

### Step 3: Verify Health
```bash
curl -s http://localhost:3001/health | jq '.ok'
# Expected: true
```

### Step 4: Verify Preflight Shows Real Mode
```bash
curl -s http://localhost:3001/api/execute/preflight | jq '.lending.mode'
# Expected: "real"
```

If not "real", check `agent/.env.local` has:
```
LENDING_EXECUTION_MODE=real
AAVE_SEPOLIA_POOL_ADDRESS=0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951
```

### Step 5: Continue Activation
Once backend responds, continue with:
1. Deploy adapter (if not deployed)
2. Run `npm run prove:aave-adapter:deployed`
3. Check session for test wallet
4. Run prereqs proof
5. Run real execution proof

---

## Next Steps After Backend Restart

### Phase 2: Deploy Adapter (if not deployed)

**Check if adapter already deployed**:
```bash
cd agent
npm run prove:aave-adapter:deployed
```

**If FAIL (adapter not deployed)**:
```bash
cd contracts

# Set deployment vars (use existing ETH_TESTNET_RPC_URL from agent/.env.local)
export SEPOLIA_RPC_URL="<value from ETH_TESTNET_RPC_URL>"
export DEPLOYER_PRIVATE_KEY="0x..."  # Must have Sepolia ETH

# Deploy
./scripts/deploy-sepolia.sh

# Extract AAVE_ADAPTER_ADDRESS from output and add to agent/.env.local
echo "AAVE_ADAPTER_ADDRESS=0x..." >> agent/.env.local

# Restart backend
cd ../agent
npm run dev
```

**Allowlist adapter** (if deploy script didn't do it):
```bash
cd contracts
export SEPOLIA_RPC_URL="..."
export DEPLOYER_PRIVATE_KEY="0x..."
export EXECUTION_ROUTER_ADDRESS="0xA31E1C25262A4C03e8481231F12634EFa060fE6F"
export AAVE_ADAPTER_ADDRESS="0x..."  # From deployment output
./scripts/allowlist-aave-adapter.sh
```

### Phase 3: Verify Adapter Deployment
```bash
cd agent
npm run prove:aave-adapter:deployed
# Must PASS before continuing
```

### Phase 4: Check Session + Prereqs
```bash
# Check session
curl -s "http://localhost:3001/api/debug/session-authority?address=0x7abFA1E1c78DfAd99A0428D9437dF05157c08FcC" | jq

# Run prereqs
cd agent
TEST_USER_ADDRESS=0x7abFA1E1c78DfAd99A0428D9437dF05157c08FcC \
TEST_TOKEN=REDACTED \
TEST_AMOUNT_UNITS=1000000 \
npm run prove:aave-defi:prereqs
```

**If prereqs FAIL**:
- Missing REDACTED balance: Script will print exact token address + missing delta
- Missing allowance: Script will print exact approval command
- Missing session: Manual UI session creation required

### Phase 5: Real Execution
```bash
cd agent
TEST_USER_ADDRESS=0x7abFA1E1c78DfAd99A0428D9437dF05157c08FcC \
TEST_TOKEN=REDACTED \
TEST_AMOUNT_UNITS=1000000 \
npm run prove:real
```

**Expected Output**:
- ✅ Adapter Deployment: PASSED
- ✅ Prerequisites: PASSED
- ✅ Real E2E Execution: PASSED
- ✅ Transaction: 0x... (TX_HASH)
- ✅ Explorer: https://sepolia.etherscan.io/tx/0x...

### Phase 6: Post-Tx Verification
```bash
cd agent
TX_HASH=0x... \  # From prove:real output
TEST_USER_ADDRESS=0x7abFA1E1c78DfAd99A0428D9437dF05157c08FcC \
npm run prove:aave-defi:post-tx
```

### Phase 7: Concurrency Stress Test
```bash
cd agent
TEST_USER_ADDRESS=0x7abFA1E1c78DfAd99A0428D9437dF05157c08FcC \
STRESS_CONCURRENCY=100 \
npm run stress:aave-positions
```

**Expected**: >=99% success, 0 500s, schema valid

---

## Current Configuration

**Router Address**: `0xA31E1C25262A4C03e8481231F12634EFa060fE6F`  
**Test Wallet**: `0x7abFA1E1c78DfAd99A0428D9437dF05157c08FcC`  
**Target Asset**: REDACTED  
**Target Amount**: 1 REDACTED (1000000 units)  
**Aave Pool**: `0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951`

**Missing**:
- AAVE_ADAPTER_ADDRESS (needs deployment)
- Backend HTTP response (needs restart)

---

**STOPPED**: Backend not responding. Follow remediation steps above, then re-run activation.
