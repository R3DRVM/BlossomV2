# Phase 1: Rerun Strict E2E Verification

## Quick Command (SKIP_DEPLOY=1, PORT=3002)

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

# Optional: Set intent (default is 'mock')
export E2E_INTENT="mock"  # or "uniswap" or "swap_usdc_weth"

# Run the script
bash ./scripts/deploy-and-verify-sepolia.sh
```

## Expected Output

The script should:
1. ✅ Skip deployment (SKIP_DEPLOY=1)
2. ✅ Start backend on port 3002
3. ✅ Verify health and preflight (ok: true)
4. ✅ Run strict E2E test
5. ✅ Print full E2E output with assertions
6. ✅ Show PASS/FAIL summary

## If E2E Fails

The script will:
- Print full E2E output (no silent failures)
- Show backend logs (last 60 lines)
- Print exact exit code
- Clean up backend process

**Common Issues:**
- Preflight `ok: false` → Check env vars, RPC connectivity
- Portfolio 500 → Check REDACTED/WETH addresses, RPC URL
- Execute prepare fails → Check UNISWAP_V3_ADAPTER_ADDRESS is set

## Testing Different Intents

```bash
# Mock intent (no real swap)
export E2E_INTENT="mock"
bash ./scripts/deploy-and-verify-sepolia.sh

# Uniswap intent (real swap preparation)
export E2E_INTENT="uniswap"  # or "swap_usdc_weth"
bash ./scripts/deploy-and-verify-sepolia.sh
```

The `uniswap` intent will:
- Use `UNISWAP_V3_ADAPTER_ADDRESS`
- Prepare real swap calldata
- Validate adapter is allowlisted
- Assert transaction data is non-empty

