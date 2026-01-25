# Sprint 4 Verification Pack: Aave DeFi E2E and Post-Tx Proofs

## Overview

This verification pack adds three new proof scripts to validate real Aave DeFi execution end-to-end:

1. **E2E Smoke Test** - Submits a real Aave supply transaction and verifies aToken balance increase
2. **Post-Tx Verifier** - Verifies aToken balance after a known successful transaction
3. **Withdraw Dry-Run** - Verifies withdraw returns unsupported (until implemented), never fake txHash

## Required Environment Variables

### For E2E Smoke Test (`prove:aave-defi:e2e-smoke`)

**Required:**
- `TEST_USER_ADDRESS` - User address with active session and token balance
- `TEST_TOKEN` - Token to supply (`REDACTED` or `WETH`)
- `TEST_AMOUNT_UNITS` - Amount in token units (e.g., `1000000` for 1 REDACTED with 6 decimals, or wei for WETH)

**Optional:**
- `TEST_SESSION_ID` - Session ID (if needed for session resolution)
- `TEST_SESSION_OWNER` - Session owner address (if needed)

**Example:**
```bash
TEST_USER_ADDRESS=0x1234... TEST_TOKEN=REDACTED TEST_AMOUNT_UNITS=1000000 npm run prove:aave-defi:e2e-smoke
```

### For Post-Tx Verifier (`prove:aave-defi:post-tx`)

**Required:**
- `TX_HASH` - Transaction hash of a successful Aave supply transaction
- `TEST_USER_ADDRESS` - User address that executed the transaction

**Example:**
```bash
TX_HASH=0xabcd... TEST_USER_ADDRESS=0x1234... npm run prove:aave-defi:post-tx
```

### For Withdraw Dry-Run (`prove:aave-defi:withdraw:dry-run`)

**No required env vars** - Uses default test address

## How to Fund TEST_USER_ADDRESS on Sepolia

### Step 1: Get Sepolia ETH
1. Visit [Sepolia Faucet](https://sepoliafaucet.com/) or [Alchemy Sepolia Faucet](https://sepoliafaucet.com/)
2. Enter your `TEST_USER_ADDRESS`
3. Request Sepolia ETH (minimum 0.1 ETH recommended)

### Step 2: Get Test Tokens

**For REDACTED:**
- Use Aave testnet interface: https://app.aave.com/ (enable Testnet Mode)
- Or use a Sepolia REDACTED faucet if available
- Or deploy/mint test REDACTED tokens if you have a testnet deployment

**For WETH:**
- Wrap Sepolia ETH to WETH using the WETH contract on Sepolia
- Or use a WETH faucet if available

### Step 3: Approve Token Spending

Before running the E2E smoke test, you must approve the ExecutionRouter to spend your tokens:

```bash
# Using cast (Foundry) or similar tool
cast send <REDACTED_ADDRESS> "approve(address,uint256)" <EXECUTION_ROUTER_ADDRESS> <AMOUNT> \
  --rpc-url $SEPOLIA_RPC_URL \
  --private-key $PRIVATE_KEY
```

Or use MetaMask:
1. Connect to Sepolia
2. Go to token contract on Etherscan
3. Use "Write Contract" → `approve` function
4. Enter `EXECUTION_ROUTER_ADDRESS` as spender
5. Enter amount (or max: `115792089237316195423570985008687907853269984665640564039457`)

### Step 4: Create Session

1. Open Blossom frontend
2. Connect MetaMask with `TEST_USER_ADDRESS`
3. Enable "One-Click Execution"
4. Sign the session creation transaction
5. Verify session shows "Active" status

## What Failures Mean and How to Fix

### E2E Smoke Test Failures

#### `SESSION_NOT_ACTIVE: create session once via UI`
- **Cause**: No active session for TEST_USER_ADDRESS
- **Fix**: Create session via UI (see Step 4 above)

#### `ALLOWANCE_MISSING: approve once`
- **Cause**: Token allowance insufficient
- **Fix**: Approve ExecutionRouter to spend tokens (see Step 3 above)

#### `User has insufficient token balance`
- **Cause**: TEST_USER_ADDRESS doesn't have enough tokens
- **Fix**: Fund the address with test tokens (see Step 2 above)

#### `Lending execution mode is real` fails
- **Cause**: Backend not configured for real Aave execution
- **Fix**: Set `LENDING_EXECUTION_MODE=real` in `agent/.env.local`

#### `Aave adapter is NOT allowlisted`
- **Cause**: AAVE_ADAPTER_ADDRESS not in ExecutionRouter allowlist
- **Fix**: Deploy Aave adapter and add to allowlist, or set `AAVE_ADAPTER_ADDRESS` in backend config

#### `Transaction receipt shows failed`
- **Cause**: Transaction reverted on-chain
- **Fix**: Check transaction on Etherscan for revert reason, verify adapter is deployed correctly

#### `aToken balance increased after supply` fails
- **Cause**: Position read failed or transaction didn't actually supply
- **Fix**: Check transaction logs on Etherscan, verify Aave pool address is correct

### Post-Tx Verifier Failures

#### `Transaction receipt not found`
- **Cause**: TX_HASH doesn't exist or hasn't been mined yet
- **Fix**: Wait for transaction to be mined, verify TX_HASH is correct

#### `Transaction receipt shows failed`
- **Cause**: Transaction reverted
- **Fix**: This is expected if transaction failed - use a successful transaction hash

#### `User has aToken balance > 0` fails
- **Cause**: Position read failed or user has no aToken balance
- **Fix**: Verify TEST_USER_ADDRESS is correct, check if transaction actually supplied tokens

### Withdraw Dry-Run Failures

#### `validateOnly mode never returns txHash` fails
- **Cause**: Backend bug - validateOnly returned txHash
- **Fix**: This is a critical bug - validateOnly must never return txHash

#### `Withdraw validation returns truthful response` fails
- **Cause**: Backend returned fake success for unsupported operation
- **Fix**: Backend should return error/unsupported, not fake txHash

## Exact Commands to Run

### Run All Proofs (with SKIP for missing env)
```bash
cd agent
npm run prove:all
```

### Run Individual Proofs

**Preflight (always runs):**
```bash
cd agent
npm run prove:aave-defi:preflight
```

**Dry-Run (always runs):**
```bash
cd agent
npm run prove:aave-defi:dry-run
```

**Live Read (skips if TX_HASH not set):**
```bash
cd agent
npm run prove:aave-defi:live-read
```

**Withdraw Dry-Run (always runs):**
```bash
cd agent
npm run prove:aave-defi:withdraw:dry-run
```

**E2E Smoke (skips if required env not set):**
```bash
cd agent
TEST_USER_ADDRESS=0x... TEST_TOKEN=REDACTED TEST_AMOUNT_UNITS=1000000 npm run prove:aave-defi:e2e-smoke
```

**Post-Tx (skips if TX_HASH not set):**
```bash
cd agent
TX_HASH=0x... TEST_USER_ADDRESS=0x... npm run prove:aave-defi:post-tx
```

## Expected Output

### Successful E2E Smoke Test
```
🎉 ALL INVARIANTS PASSED

📝 Transaction Hash: 0x...
🔗 Explorer: https://sepolia.etherscan.io/tx/0x...
🔍 Correlation ID: ...
```

### Successful Post-Tx Verifier
```
🎉 ALL INVARIANTS PASSED

📝 Transaction Hash: 0x...
🔗 Explorer: https://sepolia.etherscan.io/tx/0x...
   Position details:
     REDACTED: 1.0 (balance: 1000000)
```

### Successful Withdraw Dry-Run
```
🎉 ALL INVARIANTS PASSED
   Note: Withdraw is not yet implemented. This proof verifies truthful behavior.
```

## Troubleshooting

### Backend Not Running
```bash
cd agent
npm run dev
```

### RPC Issues
- Verify `ETH_TESTNET_RPC_URL` is set in `agent/.env.local`
- Test RPC connectivity: `curl -X POST $ETH_TESTNET_RPC_URL -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`

### Session Issues
- Check session status: `curl "http://localhost:3001/api/debug/session-authority?address=$TEST_USER_ADDRESS"`
- Verify session is active and not expired

### Token Issues
- Check balance: Use Etherscan or `cast balance $TEST_USER_ADDRESS --rpc-url $SEPOLIA_RPC_URL`
- Check allowance: Use Etherscan contract read or `cast call $TOKEN_ADDRESS "allowance(address,address)" $TEST_USER_ADDRESS $EXECUTION_ROUTER_ADDRESS --rpc-url $SEPOLIA_RPC_URL`

## Integration with prove:all

The `prove:all` command includes all three new proof scripts:
- `prove:aave-defi:withdraw:dry-run` - Always runs
- `prove:aave-defi:e2e-smoke` - SKIPs if env not set (exit 0)
- `prove:aave-defi:post-tx` - SKIPs if env not set (exit 0)

This allows `prove:all` to pass even when E2E tests are not configured, while still verifying withdraw behavior.
