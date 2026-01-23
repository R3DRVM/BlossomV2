# Ethereum Testnet MVP Setup Guide

This guide walks you through deploying Blossom execution contracts to Sepolia testnet and configuring the backend to use them.

## Prerequisites

1. **Foundry installed**: https://book.getfoundry.sh/getting-started/installation
   ```bash
   curl -L https://foundry.paradigm.xyz | bash
   foundryup
   ```

2. **Sepolia testnet ETH**: Get testnet ETH from a faucet:
   - https://sepoliafaucet.com/
   - https://faucet.quicknode.com/ethereum/sepolia
   - You'll need ~0.1 ETH for deployment gas

3. **RPC URL**: Get a free Sepolia RPC endpoint:
   - Infura: https://infura.io/ (create account, create project, get API key)
   - Alchemy: https://www.alchemy.com/ (create account, create app, get API key)
   - Your RPC URL will look like: `https://sepolia.infura.io/v3/YOUR_API_KEY`

4. **Private Key**: Export your deployer wallet's private key
   - **IMPORTANT**: Use a test wallet, never your main wallet
   - Never commit private keys to git
   - Format: `0x` followed by 64 hex characters

## Step 1: Set Environment Variables

Open a terminal and set the required environment variables:

```bash
export SEPOLIA_RPC_URL="https://sepolia.infura.io/v3/YOUR_INFURA_KEY"
export DEPLOYER_PRIVATE_KEY="0xYOUR_PRIVATE_KEY"
```

**For security, you can also create a `.env` file in the `contracts/` directory:**

```bash
cd contracts
cat > .env << EOF
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY
DEPLOYER_PRIVATE_KEY=0xYOUR_PRIVATE_KEY
EOF
```

Then load it:
```bash
source .env
```

**⚠️ Security Note**: Add `contracts/.env` to `.gitignore` if it's not already there.

## Step 2: Run Deployment Script

Navigate to the contracts directory and run the deployment script:

```bash
cd contracts
./scripts/deploy-sepolia.sh
```

The script will:
1. ✅ Check environment variables are set
2. ✅ Install OpenZeppelin contracts (if needed)
3. ✅ Build contracts
4. ✅ Run tests
5. ✅ Deploy to Sepolia
6. ✅ Print deployed addresses

**Expected output:**
```
=== Deployment Successful! ===

Copy these values to your backend config:

EXECUTION_ROUTER_ADDRESS=0x...
MOCK_SWAP_ADAPTER_ADDRESS=0x...
ETH_TESTNET_CHAIN_ID=11155111
ETH_TESTNET_RPC_URL=https://sepolia.infura.io/v3/...
```

## Step 3: Configure Backend

### Option A: Backend .env file (Recommended)

1. **Locate backend .env file**:
   - Path: `agent/.env` (if it exists)
   - Or create it at the repo root: `.env`

2. **Add the deployment values**:
   ```bash
   # Copy from deployment output
   EXECUTION_ROUTER_ADDRESS=0x...  # From deployment script output
   MOCK_SWAP_ADAPTER_ADDRESS=0x...  # From deployment script output
   ETH_TESTNET_CHAIN_ID=11155111
   ETH_TESTNET_RPC_URL=https://sepolia.infura.io/v3/...  # Same as SEPOLIA_RPC_URL
   ```

3. **Verify backend config**:
   - Check `agent/src/config.ts` reads these variables
   - The backend should use `process.env.EXECUTION_ROUTER_ADDRESS` etc.

### Option B: Use Template File

1. **Copy template**:
   ```bash
   cp contracts/DEPLOY_OUTPUT_TEMPLATE.env agent/.env
   # Or: cp contracts/DEPLOY_OUTPUT_TEMPLATE.env .env
   ```

2. **Fill in values** from deployment output

## Step 4: Enable ETH Testnet Mode (Frontend)

1. **Set frontend environment variable**:
   ```bash
   # In your .env.local or .env file (frontend root)
   VITE_EXECUTION_MODE=eth_testnet
   ```

2. **Set RPC URL** (if needed):
   ```bash
   VITE_ETH_TESTNET_RPC_URL=https://sepolia.infura.io/v3/...  # Same RPC URL
   ```

3. **Restart dev server**:
   ```bash
   npm run dev
   ```

## Step 5: Preflight Check

Before testing execution, run a preflight check to verify everything is configured correctly:

```bash
# Make sure backend is running first
cd agent && npm run dev

# In another terminal, run preflight check
curl http://localhost:3001/api/execute/preflight
```

**Expected output (success):**
```json
{
  "mode": "eth_testnet",
  "ok": true,
  "chainId": 11155111,
  "router": {
    "address": "0x...",
    "codePresent": true
  },
  "adapter": {
    "address": "0x...",
    "allowlisted": true
  },
  "rpc": {
    "ok": true
  },
  "notes": [
    "✅ Router contract deployed",
    "✅ Adapter is allowlisted",
    "✅ RPC endpoint is reachable",
    "✅ Nonce call succeeds"
  ]
}
```

**If `ok: false`, review the notes array for specific issues.**

## Step 6: First-time Setup for Swaps

If you plan to use swap execution (`VITE_ETH_TESTNET_INTENT=swap_usdc_weth` or `swap_weth_usdc`), you'll need:

1. **Get Sepolia Test Tokens:**
   - **REDACTED on Sepolia**: Get test REDACTED from a Sepolia faucet or bridge
   - **WETH on Sepolia**: Wrap Sepolia ETH using a WETH contract, or get from a testnet faucet
   - Ensure you have enough tokens for your swap amount (default is 100 REDACTED or 0.1 WETH)

2. **Approve Router (Automatic):**
   - On first swap execution, Blossom will automatically prompt you to approve the ExecutionRouter to spend your tokens
   - This is a one-time approval per token (unless you revoke it)
   - The approval amount matches the swap amount (no infinite approvals in MVP)

3. **Session Mode (Optional):**
   - If using session mode (`VITE_EXECUTION_AUTH_MODE=session`), create a session after approving tokens
   - Session creation is a one-time wallet transaction
   - After session setup, subsequent swaps require zero wallet prompts

**Note**: If you don't have sufficient token balance, Blossom will show a clear error message and abort safely without marking the strategy as executed.

## Step 7: Smoke Test Script (Automated)

For a complete automated check, use the smoke test script:

```bash
# Run the smoke test (deploys contracts, checks config, runs preflight)
./scripts/eth-testnet-smoke.sh
```

The script will:
1. ✅ Check environment variables
2. ✅ Deploy contracts (with confirmation)
3. ✅ Prompt you to set deployed addresses
4. ✅ Check backend configuration
5. ✅ Verify backend is running
6. ✅ Run preflight check
7. ✅ Print readiness status

**Note:** The script assumes the backend is running. Start it separately:
```bash
cd agent && npm run dev
```

## Step 7: Verify Deployment (Manual)

### Check contracts on Etherscan

1. Visit https://sepolia.etherscan.io/
2. Search for your `EXECUTION_ROUTER_ADDRESS`
3. Verify the contract is deployed and verified

### Verify adapter is allowlisted

Using Foundry's `cast` tool:

```bash
cast call $EXECUTION_ROUTER_ADDRESS \
  "isAdapterAllowed(address)(bool)" \
  $MOCK_SWAP_ADAPTER_ADDRESS \
  --rpc-url $SEPOLIA_RPC_URL
```

Should return: `true`

## Rollback to Sim Mode

If you need to switch back to simulation mode (no on-chain execution):

1. **Frontend**:
   ```bash
   # Remove or comment out in .env.local
   # VITE_EXECUTION_MODE=eth_testnet
   ```
   Or set explicitly:
   ```bash
   VITE_EXECUTION_MODE=sim
   ```

2. **Backend**: No changes needed (backend will use sim mode if router address is not set)

3. **Restart dev server**:
   ```bash
   npm run dev
   ```

## Troubleshooting

### Deployment fails with "insufficient funds"
- Get more Sepolia ETH from a faucet
- Check your deployer address has enough balance: https://sepolia.etherscan.io/

### Deployment fails with "wrong chain"
- Verify you're using Sepolia RPC URL (chain ID 11155111)
- Check `SEPOLIA_RPC_URL` is correct

### Addresses not extracted from output
- Manually find addresses in the deployment output
- Look for lines: "ExecutionRouter deployed at:" and "MockSwapAdapter deployed at:"
- Copy addresses to your backend config manually

### Backend can't find environment variables
- Ensure `.env` file is in the correct location (`agent/.env` or repo root)
- Restart backend server after adding variables
- Check variable names match exactly (case-sensitive)

### Frontend still uses sim mode
- Verify `VITE_EXECUTION_MODE=eth_testnet` is set
- Restart dev server (`npm run dev`)
- Check browser console for any errors

## Next Steps

Once deployed and configured:

1. ✅ Contracts are live on Sepolia
2. ✅ Backend has router/adapter addresses
3. ✅ Frontend is in `eth_testnet` mode
4. ✅ Users can connect wallets and execute plans

**Note**: This is testnet only. For mainnet deployment, use a similar process but:
- Use mainnet RPC URL
- Use mainnet chain ID (1)
- Deploy with a secure, audited process
- Use a multisig wallet for router ownership

