# Runbook: Real Aave v3 Sepolia DeFi Execution

**Purpose**: Complete step-by-step guide to deploy, configure, and prove real Aave supply execution on Sepolia testnet.

**Audience**: Engineers setting up or debugging real DeFi execution.

**Prerequisites**: 
- Foundry installed (`forge --version`)
- Node.js and npm installed
- Access to Sepolia RPC (Infura, Alchemy, etc.)
- Sepolia ETH for gas fees
- Sepolia test tokens (USDC or WETH)

---

## Phase 1: Deploy Aave Adapter

### Step 1.1: Deploy AaveV3SupplyAdapter

```bash
cd contracts

# Set required environment variables
export SEPOLIA_RPC_URL="https://sepolia.infura.io/v3/YOUR_INFURA_KEY"
export DEPLOYER_PRIVATE_KEY="0xYOUR_PRIVATE_KEY"

# Run deployment script
./scripts/deploy-sepolia.sh
```

**Expected Output**:
- Contract compilation success
- Tests passing
- Deployment transaction hash
- `AaveV3SupplyAdapter deployed at: 0x...`
- `AAVE_ADAPTER_ADDRESS=0x...` in output

**Troubleshooting**:
- **"SEPOLIA_RPC_URL not set"**: Set the env var before running script
- **"DEPLOYER_PRIVATE_KEY not set"**: Set the env var (must have Sepolia ETH)
- **"Deployment failed"**: Check RPC URL is accessible and deployer has ETH
- **"Tests failed"**: Run `forge test` separately to see test errors

### Step 1.2: Allowlist Adapter (if not automatic)

If deployer is not ExecutionRouter owner, allowlist manually:

```bash
cd contracts

# Set environment variables
export SEPOLIA_RPC_URL="https://sepolia.infura.io/v3/YOUR_INFURA_KEY"
export DEPLOYER_PRIVATE_KEY="0xYOUR_PRIVATE_KEY"
export EXECUTION_ROUTER_ADDRESS="0x..."  # Your router address
export AAVE_ADAPTER_ADDRESS="0x..."       # From Step 1.1 output

# Run allowlist script
./scripts/allowlist-aave-adapter.sh
```

**Or manually with cast**:
```bash
cast send $EXECUTION_ROUTER_ADDRESS \
  "setAdapterAllowed(address,bool)" \
  $AAVE_ADAPTER_ADDRESS true \
  --rpc-url $SEPOLIA_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY
```

**Verify allowlist**:
```bash
cast call $EXECUTION_ROUTER_ADDRESS \
  "isAdapterAllowed(address)(bool)" \
  $AAVE_ADAPTER_ADDRESS \
  --rpc-url $SEPOLIA_RPC_URL
```
Expected: `true`

---

## Phase 2: Configure Backend

### Step 2.1: Update Environment Variables

Edit `agent/.env.local` (create if missing):

```bash
# Aave V3 Sepolia Integration
AAVE_ADAPTER_ADDRESS=0x...  # From Step 1.1
AAVE_SEPOLIA_POOL_ADDRESS=0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951
LENDING_EXECUTION_MODE=real

# Required for execution
EXECUTION_ROUTER_ADDRESS=0x...  # Your router address
ETH_TESTNET_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY
ETH_TESTNET_CHAIN_ID=11155111

# Token addresses (Sepolia)
USDC_ADDRESS_SEPOLIA=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
WETH_ADDRESS_SEPOLIA=0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9

# Optional: Override USDC if using different testnet token
AAVE_USDC_ADDRESS=0x...  # Only if different from USDC_ADDRESS_SEPOLIA
```

### Step 2.2: Restart Backend

```bash
cd agent
npm run dev
```

**Verify backend is running**:
```bash
curl -s http://localhost:3001/health | jq .
```
Expected: `{ "ok": true, "executionMode": "eth_testnet" }`

---

## Phase 3: Verify Deployment

### Step 3.1: Run Adapter Deployment Proof

```bash
cd agent
npm run prove:aave-adapter:deployed
```

**Expected Output**:
- ✅ ADAPTER-1: AAVE_ADAPTER_ADDRESS is configured
- ✅ ADAPTER-2: Contract code exists at address
- ✅ ADAPTER-3: ExecutionRouter allowlist includes adapter
- ✅ ADAPTER-4: Preflight includes adapter in allowedAdapters

**If FAIL**:
- **ADAPTER-1**: Check `AAVE_ADAPTER_ADDRESS` in `agent/.env.local`
- **ADAPTER-2**: Verify deployment succeeded, check address is correct
- **ADAPTER-3**: Run allowlist script (Step 1.2)
- **ADAPTER-4**: Restart backend after setting env vars

### Step 3.2: Verify Preflight Shows Real Mode

```bash
curl -s http://localhost:3001/api/execute/preflight | jq '.lending'
```

**Expected**:
```json
{
  "enabled": true,
  "mode": "real",
  "vault": "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951",
  "adapter": "0x...",
  ...
}
```

**If mode="demo"**:
- Check `LENDING_EXECUTION_MODE=real` in `agent/.env.local`
- Restart backend
- Verify with curl again

---

## Phase 4: Fund Test Wallet & Create Session

### Step 4.1: Fund Test Wallet

**Get Sepolia ETH**:
- Use Sepolia faucet: https://sepoliafaucet.com/
- Or request from team

**Get Sepolia USDC**:
- Use Aave testnet faucet if available
- Or mint via testnet token contract if you have access
- Or use existing testnet USDC from previous tests

**Verify balance**:
```bash
# Using cast (requires RPC URL)
cast balance 0xYOUR_TEST_ADDRESS --rpc-url $SEPOLIA_RPC_URL

# Or via backend (if positions endpoint works)
curl -s "http://localhost:3001/api/defi/aave/positions?userAddress=0xYOUR_TEST_ADDRESS" | jq .
```

### Step 4.2: Approve Router to Spend Tokens

**Using MetaMask or wallet**:
1. Connect wallet to Sepolia
2. Find USDC token contract: `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`
3. Call `approve(spender, amount)`:
   - `spender`: Your `EXECUTION_ROUTER_ADDRESS`
   - `amount`: At least `TEST_AMOUNT_UNITS` (e.g., `1000000` for 1 USDC)

**Or using cast** (if you have private key):
```bash
cast send $USDC_ADDRESS_SEPOLIA \
  "approve(address,uint256)" \
  $EXECUTION_ROUTER_ADDRESS \
  1000000000000 \
  --rpc-url $SEPOLIA_RPC_URL \
  --private-key $TEST_WALLET_PRIVATE_KEY
```

**Verify allowance**:
```bash
cast call $USDC_ADDRESS_SEPOLIA \
  "allowance(address,address)(uint256)" \
  $TEST_USER_ADDRESS \
  $EXECUTION_ROUTER_ADDRESS \
  --rpc-url $SEPOLIA_RPC_URL
```

### Step 4.3: Create Session (One-Click Execution)

**Via UI**:
1. Open frontend: `http://localhost:5173`
2. Connect MetaMask to Sepolia
3. Navigate to "One-Click Execution" or session settings
4. Click "Enable One-Click Execution"
5. Sign the session creation transaction
6. Wait for confirmation
7. Verify UI shows "Session: Active"

**Verify session via API**:
```bash
curl -s "http://localhost:3001/api/debug/session-authority?address=0xYOUR_TEST_ADDRESS" | jq '.sessionStatus'
```

**Expected**:
```json
{
  "status": "active",
  "sessionId": "0x...",
  ...
}
```

**If not active**:
- Check transaction was mined: https://sepolia.etherscan.io/tx/YOUR_TX_HASH
- Check backend logs for errors
- Try creating session again

---

## Phase 5: Run Proofs

### Step 5.1: Prerequisites Check

```bash
cd agent
TEST_USER_ADDRESS=0x... \
TEST_TOKEN=USDC \
TEST_AMOUNT_UNITS=1000000 \
npm run prove:aave-defi:prereqs
```

**Expected Output**:
- ✅ PREREQ-1: Backend is healthy
- ✅ PREREQ-2a: Lending execution mode is 'real'
- ✅ PREREQ-2b: Aave adapter is in allowedAdapters
- ✅ PREREQ-3: Session is active
- ✅ PREREQ-4: Token balance sufficient
- ✅ PREREQ-5: Token allowance sufficient

**If FAIL**:
- **PREREQ-1**: Start backend: `cd agent && npm run dev`
- **PREREQ-2a**: Set `LENDING_EXECUTION_MODE=real` and restart backend
- **PREREQ-2b**: Deploy and allowlist adapter (Phase 1)
- **PREREQ-3**: Create session via UI (Step 4.3)
- **PREREQ-4**: Fund test wallet (Step 4.1)
- **PREREQ-5**: Approve router (Step 4.2)

**Prereq script outputs**:
- Exact missing balance delta: `Current: X, Required: Y`
- Exact missing allowance delta: `Current: X, Required: Y`
- Token address: `0x...`
- Router address: `0x...`
- SessionId: `0x...` (if available)

### Step 5.2: Real E2E Execution Proof

```bash
cd agent
TEST_USER_ADDRESS=0x... \
TEST_TOKEN=USDC \
TEST_AMOUNT_UNITS=1000000 \
npm run prove:aave-defi:real
```

**This runs**:
1. Prerequisites check (Step 5.1)
2. E2E smoke test (submits real transaction)
3. Post-tx verifier (confirms aToken balance increased)

**Expected Output**:
- ✅ All prerequisites pass
- ✅ Transaction hash returned
- ✅ Transaction mined with status=1
- ✅ aToken balance delta > 0
- ✅ Positions endpoint returns consistent schema

**Transaction Verification**:
- txHash is printed: `Transaction Hash: 0x...`
- Explorer link: `https://sepolia.etherscan.io/tx/0x...`
- Receipt status: `status=1` (success)
- Block number: Confirmed

**aToken Delta Verification**:
- Initial balance: `X`
- Final balance: `Y`
- Delta: `Y - X > 0`
- Positions endpoint schema: `{ positions: [...], routing: {...} }`

**If FAIL**:
- **No txHash**: Check session is active, adapter is allowlisted, balance/allowance sufficient
- **Transaction reverted**: Check Sepolia explorer for revert reason
- **No aToken delta**: Wait longer for indexing, or check aToken address is correct
- **Schema mismatch**: Check positions endpoint implementation

---

## Phase 6: Debug Common Failures

### Failure: "Adapter not in allowlist"

**Symptoms**: `PREREQ-2b` or `ADAPTER-3` fails

**Debug Steps**:
1. Check adapter was deployed: `cast code $AAVE_ADAPTER_ADDRESS --rpc-url $RPC`
2. Check router allowlist: `cast call $ROUTER "isAdapterAllowed(address)(bool)" $ADAPTER --rpc-url $RPC`
3. If false, run allowlist script (Step 1.2)

### Failure: "Lending mode is demo"

**Symptoms**: `PREREQ-2a` fails, preflight shows `mode: "demo"`

**Debug Steps**:
1. Check `agent/.env.local`: `grep LENDING_EXECUTION_MODE agent/.env.local`
2. Should be: `LENDING_EXECUTION_MODE=real`
3. Restart backend: `cd agent && npm run dev`
4. Verify: `curl -s http://localhost:3001/api/execute/preflight | jq '.lending.mode'`

### Failure: "Session not active"

**Symptoms**: `PREREQ-3` fails

**Debug Steps**:
1. Check session status: `curl -s "http://localhost:3001/api/debug/session-authority?address=0x..." | jq '.sessionStatus.status'`
2. If `not_created` or `expired`: Create session via UI (Step 4.3)
3. Check session tx was mined: https://sepolia.etherscan.io/tx/YOUR_SESSION_TX_HASH
4. Verify sessionId format: Should be `0x` + 64 hex chars

### Failure: "Insufficient balance"

**Symptoms**: `PREREQ-4` fails

**Debug Steps**:
1. Check balance: `cast balance $USER --rpc-url $RPC` (for ETH)
2. Check token balance: `cast call $TOKEN "balanceOf(address)(uint256)" $USER --rpc-url $RPC`
3. Fund wallet: Use Sepolia faucet or transfer from another wallet
4. Verify amount: Must be >= `TEST_AMOUNT_UNITS`

### Failure: "Insufficient allowance"

**Symptoms**: `PREREQ-5` fails

**Debug Steps**:
1. Check allowance: `cast call $TOKEN "allowance(address,address)(uint256)" $USER $ROUTER --rpc-url $RPC`
2. Approve router: Use MetaMask or cast (Step 4.2)
3. Verify spender: Must be `EXECUTION_ROUTER_ADDRESS` (not adapter)
4. Verify amount: Must be >= `TEST_AMOUNT_UNITS`

### Failure: "Transaction reverted"

**Symptoms**: E2E test gets txHash but receipt status=0

**Debug Steps**:
1. Check Sepolia explorer: https://sepolia.etherscan.io/tx/YOUR_TX_HASH
2. Look for revert reason in transaction details
3. Common reasons:
   - **"Adapter not allowed"**: Adapter not in router allowlist
   - **"Insufficient balance"**: Router doesn't have tokens (PULL failed)
   - **"Insufficient allowance"**: User didn't approve router
   - **"Session expired"**: Session deadline passed
4. Check backend logs for correlationId to trace execution

### Failure: "No aToken delta"

**Symptoms**: Transaction succeeds but positions endpoint shows no increase

**Debug Steps**:
1. Wait 10-30 seconds (indexing delay)
2. Check aToken address is correct: `curl -s "http://localhost:3001/api/defi/aave/positions?userAddress=0x..." | jq '.positions[0].aTokenAddress'`
3. Check aToken balance directly: `cast call $ATOKEN "balanceOf(address)(uint256)" $USER --rpc-url $RPC`
4. Verify transaction actually supplied: Check Sepolia explorer for Aave Pool interaction
5. Check positions endpoint schema: Should return `{ positions: [...], routing: {...} }`

---

## Phase 7: Release Checklist

Run this checklist before demos or handoffs:

### 7.1: Health & Preflight

```bash
# Health check
curl -s http://localhost:3001/health | jq '.ok'
# Expected: true

# Preflight check
curl -s http://localhost:3001/api/execute/preflight | jq '.lending.mode'
# Expected: "real"
```

### 7.2: Adapter Deployment Gate

```bash
cd agent
npm run prove:aave-adapter:deployed
# Expected: All 4 checks pass
```

### 7.3: Prerequisites Gate

```bash
cd agent
TEST_USER_ADDRESS=0x... \
TEST_TOKEN=USDC \
TEST_AMOUNT_UNITS=1000000 \
npm run prove:aave-defi:prereqs
# Expected: All 5 checks pass
```

### 7.4: Real E2E Gate

```bash
cd agent
TEST_USER_ADDRESS=0x... \
TEST_TOKEN=USDC \
TEST_AMOUNT_UNITS=1000000 \
npm run prove:aave-defi:real
# Expected: Prereqs + E2E + Post-tx all pass
# Expected: txHash present, status=1, aToken delta > 0
```

### 7.5: Positions Stress Test

```bash
cd agent
STRESS_CONCURRENCY=100 \
npm run stress:aave-positions
# Expected: >= 99% success rate, no 500s
```

### 7.6: Full CI-Safe Proof Suite

```bash
cd agent
npm run prove:all
# Expected: All gates pass (adapter gate may SKIP if not deployed, which is OK for CI)
```

**Checklist Summary**:
- [ ] Health endpoint returns `ok: true`
- [ ] Preflight shows `lending.mode: "real"`
- [ ] Adapter deployment proof passes (if adapter deployed)
- [ ] Prerequisites proof passes (with funded wallet)
- [ ] Real E2E proof passes (txHash, status=1, aToken delta > 0)
- [ ] Positions stress test passes (>= 99% success)
- [ ] CI-safe proof suite passes (dry-run + routing + stress)

---

## Quick Reference: Proof Commands

### CI-Safe (No Funded Wallet Required)
```bash
npm run prove:all
```
Runs: execution-kernel, session-authority, dflow-routing, new-user-wow, defi-execution:dry-run, aave-defi:preflight, aave-defi:dry-run, aave-defi:live-read, aave-defi:withdraw:dry-run, aave-adapter:deployed (may SKIP), aave-defi:e2e-smoke (SKIPs if no env), aave-defi:post-tx (SKIPs if no TX_HASH), stress tests

### Real E2E (Requires Funded Wallet)
```bash
TEST_USER_ADDRESS=0x... TEST_TOKEN=USDC TEST_AMOUNT_UNITS=1000000 npm run prove:aave-defi:real
```
Runs: adapter deployed check → prereqs → e2e smoke → post-tx verifier. **NEVER SKIPS**. Either PASSes or FAILs with actionable steps.

### Individual Gates
```bash
npm run prove:aave-adapter:deployed      # Adapter deployment verification
npm run prove:aave-defi:prereqs          # Prerequisites (requires env vars)
npm run prove:aave-defi:e2e-smoke        # Real transaction (requires env vars)
npm run prove:aave-defi:post-tx          # Post-tx verification (requires TX_HASH)
```

---

## Environment Variables Reference

### Required for Deployment
- `SEPOLIA_RPC_URL` - Sepolia RPC endpoint
- `DEPLOYER_PRIVATE_KEY` - Deployer private key (with Sepolia ETH)

### Required for Backend
- `AAVE_ADAPTER_ADDRESS` - Deployed adapter address
- `AAVE_SEPOLIA_POOL_ADDRESS` - Aave Pool address (0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951)
- `LENDING_EXECUTION_MODE` - Set to `real`
- `EXECUTION_ROUTER_ADDRESS` - Router address
- `ETH_TESTNET_RPC_URL` - Sepolia RPC URL
- `ETH_TESTNET_CHAIN_ID` - 11155111

### Required for Real Execution Proofs
- `TEST_USER_ADDRESS` - Funded test wallet address
- `TEST_TOKEN` - `USDC` or `WETH`
- `TEST_AMOUNT_UNITS` - Base units (e.g., `1000000` for 1 USDC)

### Optional
- `AAVE_USDC_ADDRESS` - Override USDC address if different
- `TEST_SESSION_ID` - Override sessionId (usually auto-resolved)
- `AGENT_API_BASE_URL` - Override API base (default: http://localhost:3001)

---

## Support & Troubleshooting

**Common Issues**:
- See Phase 6: Debug Common Failures

**Logs**:
- Backend logs: Check terminal running `npm run dev`
- Transaction logs: Check Sepolia explorer
- Proof logs: Check script output for correlationId, then grep backend logs

**Getting Help**:
- Check this runbook first
- Review proof script output for exact error messages
- Check backend logs for correlationId traces
- Verify all environment variables are set correctly
