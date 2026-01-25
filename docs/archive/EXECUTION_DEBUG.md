# Execution Debug Guide

**Purpose**: Debug and verify ETH testnet execution on Sepolia

---

## Quick Start

### Enable Debug Logging

**Backend:**
```bash
export DEBUG_EXECUTION=true
# Or in agent/.env.local:
DEBUG_EXECUTION=true
```

**Frontend:**
```bash
# In .env.local:
VITE_DEBUG_EXECUTION=true
```

### Run Demo Readiness Check

```bash
./scripts/demo-readiness.sh
```

This checks:
- API endpoints are reachable
- Chat responses include `executionRequest` for actionable intents
- `/api/execute/prepare` returns valid transaction data with `chainId=11155111`
- Routing metadata shows `chain: 'Sepolia'`

---

## Execution Flow

### 1. User Clicks "Confirm & Execute"

**Frontend**: `src/components/Chat.tsx:handleConfirmTrade()`
- Calls `/api/execute/prepare` with `draftId`, `userAddress`, `executionRequest`
- Receives: `{ to, data, value, chainId, routing, ... }`

### 2. Transaction Construction

**Frontend**: `src/components/Chat.tsx:3771-3775`
```typescript
const routerTx: PreparedTx = {
  to: prepareData.to,
  data: encodedData, // encodeFunctionData(executeBySender, [plan])
  value: prepareData.value || '0x0',
};
```

### 3. Preflight Simulation (NEW)

**Frontend**: `src/lib/walletAdapter.ts:sendTransaction()`
- Performs `eth_call` with exact tx params
- If revert: decodes revert reason and blocks MetaMask prompt
- If success: continues to gas estimation

### 4. Gas Estimation

**Frontend**: `src/lib/walletAdapter.ts:sendTransaction()`
- Calls `eth_estimateGas` with tx params
- Applies 1.2x multiplier
- Caps to 15.5M (below Sepolia's 16,777,216 cap)
- If fails: omits `gasLimit` (MetaMask estimates)

### 5. MetaMask Prompt

**Frontend**: `src/lib/walletAdapter.ts:sendTransaction()`
- Sends `eth_sendTransaction` with:
  - `to`, `data`, `value`
  - `gas` (only if estimateGas succeeded)
  - No `gasLimit` if estimateGas failed (MetaMask estimates)

---

## Debug Output

### Backend Logs (DEBUG_EXECUTION=true)

**Startup:**
```
🔧 ETH Testnet Execution Configuration
   Chain ID: 11155111 (Sepolia: 11155111)
   Router Address: 0x12345678...abcdef
   Adapter Addresses:
     - MOCK_SWAP: 0xabcdef12...345678
     - UNISWAP_V3: 0x567890ab...cdef12
   RPC URL: https://sepolia.infura.io/...
```

**Execution Prepare:**
```
[ethTestnetExecutor] DEBUG_EXECUTION: {
  chainId: 11155111,
  to: "0x12345678...",
  value: "0x0",
  dataLength: 1234,
  dataBytes: 616,
  routerAddress: "0x12345678...",
  adapterAddresses: ["0xabcdef12..."],
  actionTypes: [6],
  routingMetadata: {
    venue: "Uniswap V3",
    chain: "Sepolia",
    executionVenue: "Uniswap V3"
  }
}

[ethTestnetExecutor] Static call check: SUCCESS (tx should not revert)
```

### Frontend Logs (DEBUG_EXECUTION=true)

**Preflight:**
```
[walletAdapter] Preflight simulation: SUCCESS {
  to: "0x12345678...",
  dataLength: 1234,
  value: "0x0"
}
```

**Gas Estimation:**
```
[walletAdapter] Gas estimation: {
  estimated: "150000",
  withMultiplier: "180000",
  final: "180000",
  clamped: false,
  to: "0x12345678...",
  dataLength: 1234,
  value: "0x0"
}
```

**Transaction Send:**
```
[walletAdapter] Sending transaction: {
  to: "0x12345678...",
  dataLength: 1234,
  value: "0x0",
  gasLimit: "0x2bf20",
  estimateGasError: "none"
}
```

---

## Common Issues

### 1. "Gas limit too high (cap: 16777216, tx: 21000000)"

**Cause**: MetaMask using default 21M when `estimateGas` fails

**Fix**: Already implemented - if `estimateGas` fails, omit `gasLimit` so MetaMask estimates

**Verify**: Check logs for `[walletAdapter] Omitting gasLimit - MetaMask will estimate`

### 2. "Transaction will revert"

**Cause**: Preflight simulation (`eth_call`) failed

**Fix**: Check revert reason in logs:
```
[walletAdapter] Preflight simulation: FAILED (tx will revert): <reason>
[walletAdapter] Revert details: {
  to: "...",
  errorData: "0x08c379a0...",
  decodedReason: "Insufficient balance" or "Invalid adapter" etc.
}
```

**Common Revert Reasons**:
- `Insufficient balance`: User doesn't have enough tokens
- `Invalid adapter`: Adapter address is wrong or not deployed
- `Invalid nonce`: Nonce mismatch (try again)
- `Deadline expired`: Transaction deadline passed (re-prepare)

### 3. Wrong Routing Metadata (Hyperliquid/Base instead of Sepolia)

**Cause**: Routing metadata not explicitly set to Sepolia

**Fix**: Already implemented - routing metadata always uses `chain: 'Sepolia'`

**Verify**: Check `/api/execute/prepare` response:
```json
{
  "routing": {
    "chain": "Sepolia",
    "venue": "Uniswap V3",
    "executionVenue": "Uniswap V3"
  }
}
```

### 4. Contract Configuration Errors

**Cause**: Missing or invalid contract addresses

**Fix**: Check startup logs for validation errors:
```
❌ ERROR: ETH testnet configuration validation failed:
  - ETH_TESTNET_CHAIN_ID must be 11155111 (Sepolia), got 1
  - EXECUTION_ROUTER_ADDRESS has invalid format: 0x123
```

**Verify**: All addresses must be valid Ethereum addresses (0x + 40 hex chars)

---

## Testing Checklist

### Manual Test

1. **Start Demo**:
   ```bash
   ./scripts/restart-demo.sh
   ```

2. **Enable Debug**:
   ```bash
   export DEBUG_EXECUTION=true  # Backend
   # VITE_DEBUG_EXECUTION=true in .env.local  # Frontend
   ```

3. **Test Each Intent**:
   - Perp: "open BTC long 2x with 2% risk"
   - Event: "bet YES on Fed rate cut with $5"
   - DeFi: "park 10 usdc into yield"

4. **Verify**:
   - ✅ Card shows "Chain: Sepolia" and correct venue
   - ✅ Clicking "Confirm & Execute" shows MetaMask with gasLimit <= 15.5M (or omitted)
   - ✅ Transaction submits successfully (txHash returned)
   - ✅ No "gas limit too high" errors
   - ✅ No "transaction will revert" errors (unless actually reverting)

### Automated Test

```bash
./scripts/demo-readiness.sh
```

This verifies:
- ✅ All API endpoints reachable
- ✅ Chat responses include `executionRequest`
- ✅ `/api/execute/prepare` returns valid data with `chainId=11155111`
- ✅ Routing metadata shows `chain: 'Sepolia'`

---

## Configuration Requirements

### Required Environment Variables

**Backend (`agent/.env.local`):**
```bash
EXECUTION_MODE=eth_testnet
ETH_TESTNET_CHAIN_ID=11155111
ETH_TESTNET_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
EXECUTION_ROUTER_ADDRESS=0x...
MOCK_SWAP_ADAPTER_ADDRESS=0x...  # Or UNISWAP_V3_ADAPTER_ADDRESS
PROOF_ADAPTER_ADDRESS=0x...  # For perp/event
```

### Validation

On startup, the backend validates:
- ✅ `ETH_TESTNET_CHAIN_ID === 11155111`
- ✅ `EXECUTION_ROUTER_ADDRESS` is valid address format
- ✅ All adapter addresses are valid address format (if set)
- ✅ `ETH_TESTNET_RPC_URL` is valid HTTP/HTTPS URL

If validation fails, startup logs show clear errors.

---

## Troubleshooting

### Transaction Reverts

1. **Check Preflight Logs**:
   ```
   [walletAdapter] Preflight simulation: FAILED
   [walletAdapter] Revert details: { decodedReason: "..." }
   ```

2. **Common Causes**:
   - Wrong contract addresses (check startup logs)
   - Insufficient balance (check user's token balance)
   - Missing approvals (check if approval flow runs)
   - Invalid nonce (re-prepare transaction)

3. **Fix**:
   - Verify contract addresses match deployed Sepolia contracts
   - Ensure user has sufficient balance
   - Check approval transactions completed
   - Re-prepare if nonce/deadline expired

### Gas Estimation Fails

1. **Check Logs**:
   ```
   [walletAdapter] Gas estimation failed: <error>
   [walletAdapter] Omitting gasLimit - MetaMask will estimate
   ```

2. **Behavior**:
   - If preflight passed, gas estimation failure is usually fine
   - MetaMask will estimate gas itself
   - Transaction should still succeed

3. **If Transaction Still Fails**:
   - Check MetaMask error message
   - Verify contract addresses are correct
   - Check RPC URL is accessible

---

## Summary

**Key Fixes**:
1. ✅ Preflight simulation (`eth_call`) before MetaMask prompt
2. ✅ Gas limit capped to 15.5M (or omitted on failure)
3. ✅ Routing metadata always uses `chain: 'Sepolia'`
4. ✅ Contract configuration validated on startup
5. ✅ Comprehensive debug logging with `DEBUG_EXECUTION=true`

**Result**: Execution should work reliably on Sepolia with clear error messages if something fails.


