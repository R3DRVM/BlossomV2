# Blossom Execution Contracts

Foundry workspace for Blossom execution router and adapters.

## Setup

```bash
# Install dependencies
forge install openzeppelin/openzeppelin-contracts --no-commit

# Build
forge build

# Run tests
forge test

# Run tests with verbose output
forge test -vvv
```

## Contracts

- **ExecutionRouter**: Main router for executing signed execution plans atomically
- **IAdapter**: Interface for execution adapters
- **PlanTypes**: EIP-712 types and hashing utilities
- **MockSwapAdapter**: Mock adapter for testing

## Architecture

1. User creates a `Plan` with one or more `Action`s
2. User signs the plan using EIP-712 typed data signing
3. User (or relayer) calls `ExecutionRouter.execute(plan, signature)`
4. Router verifies signature, checks nonce, and executes all actions atomically
5. Each action is executed via an allowlisted adapter contract

## Security

- **Replay Protection**: Nonce-based replay protection per user
- **Deadline Enforcement**: Plans expire after deadline
- **Adapter Allowlist**: Only allowlisted adapters can be executed
- **Atomic Execution**: All actions execute or none do (revert on failure)
- **EIP-712 Signing**: Explicit user approval via typed data signatures

## Testing

All tests are in `test/ExecutionRouter.t.sol`:

- Happy path execution
- Replay protection
- Expired deadline rejection
- Disallowed adapter rejection
- Invalid signature rejection
- Multiple actions execution

## Deployment

### Quick Start (Recommended)

For a fully guided deployment experience, use the deployment script:

```bash
# 1. Set environment variables
export SEPOLIA_RPC_URL="https://sepolia.infura.io/v3/YOUR_INFURA_KEY"
export DEPLOYER_PRIVATE_KEY="0xYOUR_PRIVATE_KEY"

# 2. Run deployment script
cd contracts
./scripts/deploy-sepolia.sh
```

The script will:
- ✅ Check environment variables
- ✅ Install dependencies (if needed)
- ✅ Build contracts
- ✅ Run tests
- ✅ Deploy to Sepolia
- ✅ Print addresses for backend config

**See `ETH_TESTNET_MVP_SETUP.md` in the repo root for complete step-by-step instructions.**

### Manual Deployment

If you prefer to deploy manually:

1. **Prerequisites**:
   - Install Foundry: https://book.getfoundry.sh/getting-started/installation
   - Install OpenZeppelin: `forge install openzeppelin/openzeppelin-contracts --no-commit`
   - Set environment variables:
     ```bash
     export SEPOLIA_RPC_URL="https://sepolia.infura.io/v3/YOUR_INFURA_KEY"
     export DEPLOYER_PRIVATE_KEY="0xYOUR_PRIVATE_KEY"
     ```

2. **Deploy**:
   ```bash
   forge script script/DeploySepolia.s.sol:DeploySepolia \
     --rpc-url $SEPOLIA_RPC_URL \
     --broadcast \
     -vvvv
   ```

3. **Copy addresses** from output to backend config (see `DEPLOY_OUTPUT_TEMPLATE.env`)

### Verification

After deployment, verify the adapter is allowlisted:
```bash
cast call $EXECUTION_ROUTER_ADDRESS \
  "isAdapterAllowed(address)(bool)" \
  $MOCK_SWAP_ADAPTER_ADDRESS \
  --rpc-url $SEPOLIA_RPC_URL
```

Should return `true`.

