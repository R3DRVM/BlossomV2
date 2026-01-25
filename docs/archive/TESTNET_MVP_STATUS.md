# Blossom Sepolia Testnet MVP - Status

**Last Updated:** 2025-01-XX  
**Status:** ✅ MVP Ready for Testing

## What Works Today

Blossom's Sepolia testnet MVP enables AI-driven execution of on-chain swaps through a secure execution router. The system supports:

- **Direct Mode**: Users sign and broadcast transactions themselves via MetaMask
- **Session Mode**: Relayer executes on behalf of users (one-time session setup)
- **Real Swaps**: Uniswap V3 swaps on Sepolia testnet
- **Auto-Approval**: Automatic ERC20 approval handling
- **Portfolio Sync**: Real-time balance fetching (ETH, USDC, WETH)

## Deployed Contract Addresses (Sepolia)

```
EXECUTION_ROUTER_ADDRESS=0xC274dba8381C3Dcd4823Fb17f980ad32caDf751e
MOCK_SWAP_ADAPTER_ADDRESS=0x0a68599554ceFE00304e2b7dDfB129528F66d31F
UNISWAP_V3_ADAPTER_ADDRESS=0x9D2E705FA2f63cd85CfB72f973F85A34A173fC4A
```

## Token Addresses (Sepolia)

```
USDC_ADDRESS_SEPOLIA=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
WETH_ADDRESS_SEPOLIA=0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14
```

## Required Environment Variables

### Direct Mode (User Signs Transactions)

```bash
# Execution mode
export EXECUTION_MODE=eth_testnet
export EXECUTION_AUTH_MODE=direct

# RPC endpoint
export ETH_TESTNET_RPC_URL="https://sepolia.infura.io/v3/YOUR_KEY"
# OR
export ETH_TESTNET_RPC_URL="https://ethereum-sepolia-rpc.publicnode.com"

# Contract addresses
export EXECUTION_ROUTER_ADDRESS="0xC274dba8381C3Dcd4823Fb17f980ad32caDf751e"
export MOCK_SWAP_ADAPTER_ADDRESS="0x0a68599554ceFE00304e2b7dDfB129528F66d31F"
export UNISWAP_V3_ADAPTER_ADDRESS="0x9D2E705FA2f63cd85CfB72f973F85A34A173fC4A"

# Token addresses
export USDC_ADDRESS_SEPOLIA="0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
export WETH_ADDRESS_SEPOLIA="0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"
```

### Session Mode (Relayer Executes)

All direct mode variables **plus**:

```bash
export EXECUTION_AUTH_MODE=session
export RELAYER_PRIVATE_KEY="0x..."  # Wallet with Sepolia ETH for gas
```

**Security Note:** The relayer wallet must have sufficient Sepolia ETH to pay for gas. Users still control their funds; the relayer only executes pre-signed plans.

## Known-Good RPC Endpoints

### Primary (Recommended)
- **Infura**: `https://sepolia.infura.io/v3/YOUR_INFURA_KEY`
- **Alchemy**: `https://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY`

### Fallback (Public)
- **PublicNode**: `https://ethereum-sepolia-rpc.publicnode.com`
- **DRPC**: `https://sepolia.drpc.org`

**Note:** Avoid `https://rpc.sepolia.org` (Cloudflare 522 errors).

## Quick Start Commands

### 1. Start Backend

```bash
cd /Users/redrum/Desktop/Bloom/agent

# Set all required env vars (see above)
export EXECUTION_MODE=eth_testnet
export EXECUTION_AUTH_MODE=direct
export ETH_TESTNET_RPC_URL="..."
# ... (all other vars)

# Start on default port 3001
npm run dev

# OR start on custom port
PORT=3002 npm run dev
```

### 2. Verify Health

```bash
# Health check
curl http://localhost:3001/health

# Expected: {"status":"ok","service":"blossom-agent"}
```

### 3. Run Preflight Check

```bash
curl http://localhost:3001/api/execute/preflight

# Expected: {"ok":true,"mode":"eth_testnet","chainId":11155111,...}
```

### 4. Run Strict E2E Verification

```bash
cd /Users/redrum/Desktop/Bloom

# Set test user address
export TEST_USER_ADDRESS="0x7abFA1E1c78DfAd99A0428D9437dF05157c08FcC"
export BASE_URL="http://localhost:3001"  # Match your backend port

# Run E2E with mock intent
node agent/scripts/e2e-sepolia-smoke.ts --full --intent mock

# OR run with real Uniswap intent (prepare only, no broadcast)
node agent/scripts/e2e-sepolia-smoke.ts --full --intent swap_usdc_weth
```

### 5. Full Deployment + Verification (One Command)

```bash
cd /Users/redrum/Desktop/Bloom

# Set all env vars (including DEPLOYER_PRIVATE_KEY if deploying)
export SEPOLIA_RPC_URL="..."
export DEPLOYER_PRIVATE_KEY="0x..."  # Only if deploying
export PORT=3002  # Optional: use different port
export BASE_URL="http://localhost:3002"  # Match PORT

# Run full deploy + verify
bash ./scripts/deploy-and-verify-sepolia.sh

# OR skip deployment (use existing contracts)
export SKIP_DEPLOY=1
export EXECUTION_ROUTER_ADDRESS="0xC274dba8381C3Dcd4823Fb17f980ad32caDf751e"
export MOCK_SWAP_ADAPTER_ADDRESS="0x0a68599554ceFE00304e2b7dDfB129528F66d31F"
export UNISWAP_V3_ADAPTER_ADDRESS="0x9D2E705FA2f63cd85CfB72f973F85A34A173fC4A"
export USDC_ADDRESS_SEPOLIA="0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
export WETH_ADDRESS_SEPOLIA="0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"

bash ./scripts/deploy-and-verify-sepolia.sh
```

## What's NOT Included (Yet)

- Frontend UI integration (backend-only MVP)
- Multi-chain support (Sepolia only)
- Additional adapters (Uniswap V3 only)
- Transaction broadcasting from backend (prepare only)
- Session revocation UI
- Spend limit UI

## Troubleshooting

### Preflight Returns `ok: false`

**Common causes:**
- Missing environment variables (check `/api/execute/preflight` response `notes` array)
- RPC endpoint unreachable
- Contract not deployed at specified address
- Adapter not allowlisted in router

**Fix:** Set all required env vars and verify contract addresses on Sepolia explorer.

### Portfolio Endpoint Returns 500

**Common causes:**
- `ETH_TESTNET_RPC_URL` not set or invalid
- `USDC_ADDRESS_SEPOLIA` or `WETH_ADDRESS_SEPOLIA` not set
- RPC endpoint rate-limited

**Fix:** Verify RPC URL and token addresses are correct.

### E2E Test Fails

**Check:**
1. Backend is running (`curl http://localhost:3001/health`)
2. Preflight returns `ok: true`
3. All required env vars are set
4. Test user address has format `0x` + 40 hex chars

**Fix:** Run with `--full` flag to see exact missing variables.

## Next Steps

See `docs/TESTNET_MANUAL_TESTING.md` for detailed testing procedures.

