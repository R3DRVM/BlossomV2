# Sprint 4.7: Aave Adapter Deployment Guide

## Summary

Implemented Aave V3 Supply Adapter contract, deployment script updates, and proof harness to enable real Aave supply execution on Sepolia testnet.

## Prerequisites to Deploy Adapter

### Required Environment Variables
- `SEPOLIA_RPC_URL` - Sepolia RPC endpoint (e.g., Infura, Alchemy)
- `DEPLOYER_PRIVATE_KEY` - Private key of deployer account (must have Sepolia ETH for gas)

### Required Configuration
- ExecutionRouter must already be deployed (from previous deployment)
- Deployer should be the owner of ExecutionRouter (to automatically allowlist the adapter)
  - If not owner, adapter can be allowlisted manually (see Step 1b)

### Optional Environment Variables
- `AAVE_V3_POOL_ADDRESS` - Aave V3 Pool address (defaults to `0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951` on Sepolia)

### Missing Secrets Check

If you don't have `DEPLOYER_PRIVATE_KEY` or `SEPOLIA_RPC_URL`, the deployment will fail with clear error messages. Do NOT guess these values.

## Deployment Steps

### Step 1: Deploy Adapter

```bash
cd contracts

# Set environment variables
export SEPOLIA_RPC_URL="https://sepolia.infura.io/v3/YOUR_INFURA_KEY"
export DEPLOYER_PRIVATE_KEY="0xYOUR_PRIVATE_KEY"

# Run deployment script
./scripts/deploy-sepolia.sh
```

The script will:
- Build contracts
- Run tests
- Deploy AaveV3SupplyAdapter to Sepolia
- Automatically allowlist it in ExecutionRouter (if deployer is owner)
- Print addresses for backend config

**Note**: If deployer is not ExecutionRouter owner, you'll need to allowlist manually (see Step 1b below).

### Step 1b: Allowlist Adapter (if not done automatically)

If the deployer is not the ExecutionRouter owner, allowlist manually:

```bash
cd contracts

# Set environment variables
export SEPOLIA_RPC_URL="https://sepolia.infura.io/v3/YOUR_INFURA_KEY"
export DEPLOYER_PRIVATE_KEY="0xYOUR_PRIVATE_KEY"
export EXECUTION_ROUTER_ADDRESS="0x..."  # Your router address
export AAVE_ADAPTER_ADDRESS="0x..."     # From deployment output

# Run allowlist script
./scripts/allowlist-aave-adapter.sh
```

Or manually with cast:
```bash
cast send $EXECUTION_ROUTER_ADDRESS \
  "setAdapterAllowed(address,bool)" \
  $AAVE_ADAPTER_ADDRESS true \
  --rpc-url $SEPOLIA_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY
```

### Step 2: Update Backend Configuration

Add to `agent/.env.local`:

```bash
# Aave V3 Sepolia Integration
AAVE_ADAPTER_ADDRESS=0x...  # From deployment output
AAVE_SEPOLIA_POOL_ADDRESS=0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951
LENDING_EXECUTION_MODE=real
AAVE_USDC_ADDRESS=0x...  # Sepolia USDC address (if different from default)
```

### Step 3: Restart Backend

```bash
cd agent
npm run dev
```

### Step 4: Verify Deployment

```bash
cd agent
npm run prove:aave-adapter:deployed
```

This verifies:
- AAVE_ADAPTER_ADDRESS is configured
- Contract code exists at address
- Router allowlist includes adapter
- Preflight includes adapter in allowedAdapters

## Contract Details

### AaveV3SupplyAdapter

**Location**: `contracts/src/adapters/AaveV3SupplyAdapter.sol`

**Interface**: Matches `DemoLendSupplyAdapter` encoding for compatibility:
- Input: `(address asset, address pool, uint256 amount, address onBehalfOf)`
- Note: `pool` parameter is ignored (uses constructor value), kept for encoding compatibility

**Functionality**:
- Receives asset from router (after PULL action)
- Approves Aave Pool to spend asset
- Calls `IPool.supply(asset, amount, onBehalfOf, 0)`
- Returns empty bytes (no return value needed)

**Safety**:
- Validates asset != address(0)
- Validates amount > 0
- Validates onBehalfOf != address(0)
- Uses OpenZeppelin SafeERC20 for token operations

### Tests

**Location**: `contracts/test/AaveV3SupplyAdapter.t.sol`

**Coverage**:
- ✅ Supply USDC to Aave Pool
- ✅ Revert if invalid asset
- ✅ Revert if amount zero
- ✅ Revert if invalid onBehalfOf
- ✅ Referral code is zero
- ✅ Pool address is immutable

All tests pass: `forge test --match-contract AaveV3SupplyAdapterTest`

## Proof Gates

### prove:aave-adapter:deployed

**Command**: `npm run prove:aave-adapter:deployed`

**Verifies**:
- ADAPTER-1: AAVE_ADAPTER_ADDRESS is configured
- ADAPTER-2: Contract code exists at address (eth_getCode != 0x)
- ADAPTER-3: ExecutionRouter allowlist includes adapter
- ADAPTER-4: Preflight includes adapter in allowedAdapters

**Exit Codes**:
- 0: All checks pass
- 1: Any check fails (with actionable error messages)

### Integration with prove:all

The adapter deployment proof should run BEFORE real execution proofs:

```json
"prove:all": "... && npm run prove:aave-adapter:deployed && npm run prove:aave-defi:prereqs && ..."
```

## Files Changed

### New Files
1. **`contracts/src/adapters/AaveV3SupplyAdapter.sol`** (NEW - 80 lines)
   - Production-ready Aave V3 supply adapter
   - Matches DemoLendSupplyAdapter encoding for compatibility
   - Uses OpenZeppelin SafeERC20

2. **`contracts/test/AaveV3SupplyAdapter.t.sol`** (NEW - 150 lines)
   - Comprehensive test suite
   - All tests passing

3. **`agent/scripts/prove-aave-adapter-deployed.ts`** (NEW - 200 lines)
   - Verifies adapter deployment and allowlisting
   - Checks contract code, router allowlist, preflight inclusion

4. **`SPRINT_4_7_AAVE_ADAPTER_DEPLOY.md`** (NEW - this file)
   - Complete deployment guide

### Updated Files
5. **`contracts/script/DeploySepolia.s.sol`** (UPDATED)
   - Added AaveV3SupplyAdapter deployment
   - Automatically allowlists adapter (if deployer is router owner)
   - Prints AAVE_ADAPTER_ADDRESS in output

6. **`contracts/scripts/deploy-sepolia.sh`** (UPDATED)
   - Extracts AAVE_ADAPTER_ADDRESS from deployment output
   - Prints config values including Aave settings

7. **`contracts/scripts/allowlist-aave-adapter.sh`** (NEW)
   - Standalone script to allowlist adapter if deployer is not router owner
   - Verifies allowlist status before and after

7. **`agent/src/server/http.ts`** (UPDATED - lines 2238-2258)
   - Updated preflight lending status to detect real Aave mode
   - Returns correct vault/adapter addresses for real Aave
   - Updated notes to indicate Aave V3 Sepolia when enabled

8. **`agent/package.json`** (UPDATED)
   - Added: `"prove:aave-adapter:deployed": "tsx scripts/prove-aave-adapter-deployed.ts"`

## Verification Commands

### After Deployment

1. **Verify adapter deployment**:
   ```bash
   cd agent
   npm run prove:aave-adapter:deployed
   ```

2. **Verify preflight shows real mode**:
   ```bash
   curl -s http://localhost:3001/api/execute/preflight | jq '.lending'
   ```
   Expected: `{ "mode": "real", "enabled": true, ... }`

3. **Verify adapter in allowedAdapters**:
   ```bash
   curl -s http://localhost:3001/api/execute/preflight | jq '.allowedAdapters'
   ```
   Expected: Array includes AAVE_ADAPTER_ADDRESS

4. **Run full proof** (once user is funded/approved/session active):
   ```bash
   cd agent
   TEST_USER_ADDRESS=0x... TEST_TOKEN=USDC TEST_AMOUNT_UNITS=1000000 npm run prove:aave-defi:real
   ```

## Known Limitations

1. **Manual Allowlisting**: If deployer is not ExecutionRouter owner, adapter must be allowlisted manually using `contracts/scripts/allowlist-aave-adapter.sh` or the cast command shown in Step 1b.

2. **USDC Address**: The adapter uses the USDC address from `AAVE_USDC_ADDRESS` env var or falls back to default. Ensure the correct Sepolia USDC address is configured.

3. **Pool Address**: Currently hardcoded to Sepolia Aave V3 Pool. For other chains, update constructor or add chain-specific deployment.

## Next Steps

Once adapter is deployed and verified:

1. **Set backend config** (see Step 2 above)
2. **Restart backend** to pick up new config
3. **Run adapter deployment proof**: `npm run prove:aave-adapter:deployed`
4. **Verify preflight shows real mode**: `curl -s http://localhost:3001/api/execute/preflight | jq '.lending.mode'` (should be "real")
5. **Run full E2E proof** (with funded user): `npm run prove:aave-defi:real`

## Proof Gate Integration

The adapter deployment proof is integrated into `prove:all`:

```bash
cd agent
npm run prove:all
```

This runs adapter deployment check BEFORE real execution proofs, ensuring adapter is deployed and allowlisted before attempting real transactions.

## Troubleshooting

### Adapter not in allowlist
- Check deployer is ExecutionRouter owner
- Manually allowlist using `cast send` command above
- Verify with: `cast call $ROUTER "isAdapterAllowed(address)(bool)" $ADAPTER --rpc-url $RPC`

### Preflight shows mode="demo"
- Check `LENDING_EXECUTION_MODE=real` in `agent/.env.local`
- Restart backend after setting env var
- Verify with: `curl -s http://localhost:3001/api/execute/preflight | jq '.lending.mode'`

### Contract code not found
- Verify deployment succeeded (check deployment output)
- Verify address is correct in `agent/.env.local`
- Check RPC URL is correct and accessible
