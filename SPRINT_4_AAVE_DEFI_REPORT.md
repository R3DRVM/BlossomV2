# Sprint 4: Real Aave v3 DeFi Execution Report

## Summary

Implemented real Aave v3 DeFi execution on Sepolia testnet with market config, execution wiring, position reads, and comprehensive proof harnesses.

## Files Changed

### A) Market Config Module
1. **`agent/src/defi/aave/market.ts`** (NEW)
   - Single source of truth for Aave v3 Sepolia market configuration
   - Exposes: `chainId`, `poolAddress`, `poolAddressesProvider`, `poolDataProvider`, `supportedAssets`
   - Functions: `getAaveMarketConfig()`, `getATokenAddress()`, `getSupportedAsset()`, `getSupportedAssets()`
   - Dynamically fetches aToken addresses via PoolDataProvider

### B) Position Reader Module
2. **`agent/src/defi/aave/positions.ts`** (NEW)
   - Reads aToken balances from chain
   - Functions: `readAavePositions()`, `readAavePosition()`
   - Returns structured position data with balances and USD values

### C) Backend Updates
3. **`agent/src/server/sessionPolicy.ts`** (lines 102-121)
   - Added LEND_SUPPLY (actionType 3) spend estimation
   - Supports both direct and session mode data encoding
   - Prevents POLICY_UNDETERMINED_SPEND for normal Aave supply operations

4. **`agent/src/server/http.ts`** (lines 2310-2347, 2811-2839, 4300-4330)
   - Added `AAVE_ADAPTER_ADDRESS` to allowlist in preflight endpoint
   - Added `AAVE_ADAPTER_ADDRESS` to allowlist in relayed execution validation
   - Added `GET /api/defi/aave/positions` endpoint for reading aToken balances

5. **`agent/src/executors/ethTestnetExecutor.ts`** (lines 850-893)
   - Updated to use new market config module
   - Uses `getAaveMarketConfig()` and `getSupportedAsset()` for Aave integration
   - Respects `LENDING_EXECUTION_MODE=real` to enable real Aave execution
   - Falls back to VaultSim if Aave not configured

### D) Proof Scripts
6. **`agent/scripts/prove-aave-defi:preflight.ts`** (NEW)
   - Verifies market config loads correctly
   - Verifies preflight returns Aave capability fields without secrets

7. **`agent/scripts/prove-aave-defi:dry-run.ts`** (NEW)
   - Verifies Aave SUPPLY plan can be prepared
   - Verifies adapter is allowlisted
   - Verifies policy spend check works
   - Verifies validateOnly never returns txHash

8. **`agent/scripts/prove-aave-defi:live-read.ts`** (NEW)
   - Verifies aToken balance reads from chain
   - Verifies reserve data can be fetched (if implemented)
   - Skips gracefully if TX_HASH not provided

9. **`agent/package.json`** (lines 19-20)
   - Added: `prove:aave-defi:preflight`, `prove:aave-defi:dry-run`, `prove:aave-defi:live-read`
   - Updated: `prove:all` to include all three Aave proof scripts

## Invariants and Proofs

### P1: Market Config & Preflight
- **P1-1**: Market config loads with correct chainId, pool address, and supported assets
- **P1-2**: Preflight returns Aave capability fields (allowedAdapters, lending status) without secrets
- **Proof**: `npm run prove:aave-defi:preflight`

### P2: Dry-Run Validation
- **P2-1**: Aave SUPPLY plan can be transformed into executionRequest
- **P2-2**: Aave adapter is allowlisted (or returns ADAPTER_NOT_ALLOWED if not configured)
- **P2-3**: Policy spend check passes (or returns POLICY_EXCEEDED/POLICY_UNDETERMINED_SPEND)
- **P2-4**: validateOnly mode never returns txHash
- **Proof**: `npm run prove:aave-defi:dry-run`

### P3: Live Position Reads
- **P3-1**: User aToken balance can be read from chain via `/api/defi/aave/positions`
- **P3-2**: Reserve data can be fetched from PoolDataProvider (if RPC available)
- **Proof**: `npm run prove:aave-defi:live-read` (skips if TX_HASH not provided)

## Commands to Run

### Run All Proofs
```bash
cd agent
npm run prove:all
```

### Run Individual Aave Proofs
```bash
cd agent
npm run prove:aave-defi:preflight
npm run prove:aave-defi:dry-run
npm run prove:aave-defi:live-read  # Optional: requires TX_HASH env var
```

### Test Aave Position Reads
```bash
curl "http://localhost:3001/api/defi/aave/positions?userAddress=0x..."
```

## Configuration

### Required Environment Variables

**Backend (`agent/.env.local`):**
```bash
# Aave v3 Configuration
LENDING_EXECUTION_MODE=real  # Set to 'real' to enable Aave execution
AAVE_SEPOLIA_POOL_ADDRESS=0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951  # Official Aave v3 Pool on Sepolia
AAVE_ADAPTER_ADDRESS=0x...  # Your deployed Aave adapter address
AAVE_USDC_ADDRESS=0x...  # Optional: USDC address on Sepolia (defaults to market config)

# Required for execution
ETH_TESTNET_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
EXECUTION_ROUTER_ADDRESS=0x...
ERC20_PULL_ADAPTER_ADDRESS=0x...
```

### Market Config

The market config module (`agent/src/defi/aave/market.ts`) uses official Aave v3 Sepolia addresses:
- **Pool**: `0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951`
- **PoolAddressesProvider**: `0x012bAC54348C0E635dCAc9D5FB99f06F24136C9A`
- **PoolDataProvider**: `0x3e9708d80f7B3e43118013075F7e95CE3AB31F31`

Supported assets are configured in the module and can be extended.

## Known Limitations

1. **aToken Address Fetching**: aToken addresses are fetched dynamically via PoolDataProvider. If RPC is unavailable, positions may not be readable.

2. **APY Data**: Supply APY is not currently fetched from reserve data. This can be added by calling `PoolDataProvider.getReserveData()`.

3. **Withdraw Support**: Withdraw functionality is not yet implemented. Only supply operations are supported.

4. **Asset Support**: Currently supports USDC only. Additional assets can be added to `market.ts` `supportedAssets` array.

5. **Live Read Test**: The `prove:aave-defi:live-read` script requires a `TX_HASH` environment variable pointing to a successful Aave supply transaction. Without it, the test skips gracefully.

6. **Adapter Deployment**: The Aave adapter contract must be deployed and allowlisted in the ExecutionRouter. This is not part of this sprint.

## Execution Flow

1. **User creates DeFi plan** → `executionRequest: { kind: 'lend', amountUsd: 100, asset: 'USDC' }`
2. **Frontend calls executionKernel** → Routes to relayed execution when `sessionActive=true`
3. **Backend prepares plan** → Uses market config to get Aave pool address and asset address
4. **Backend validates** → Checks adapter allowlist and session policy
5. **Backend executes** → Calls Aave adapter via ExecutionRouter (relayed)
6. **User receives txHash** → Position can be read via `/api/defi/aave/positions`

## Truthful UI Enforcement

- UI only shows "Executed" when `txHash` exists (enforced by executionKernel)
- Position reads return empty array if user has no aToken balance
- No fake positions are created - all data comes from chain reads

## Next Steps

1. Deploy Aave adapter contract and add to ExecutionRouter allowlist
2. Test end-to-end with real Aave supply transaction
3. Add withdraw support (LEND_WITHDRAW action type)
4. Fetch APY from reserve data for display
5. Add support for additional assets (WETH, etc.)
