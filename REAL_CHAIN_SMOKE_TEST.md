# Real Chain Smoke Test (Sepolia)

## Overview

This document provides an exact, reproducible flow for testing Blossom MVP A on Sepolia testnet with a real wallet. This proves real-wallet correctness for whitelist testing.

---

## Prerequisites

1. **MetaMask installed** and connected to Sepolia testnet
2. **Test wallet** with at least 0.1 ETH on Sepolia
3. **Backend running** with session mode enabled
4. **Frontend running** and connected to backend

---

## Environment Setup

### Backend (.env)

```bash
EXECUTION_MODE=eth_testnet
EXECUTION_AUTH_MODE=session
EXECUTION_ROUTER_ADDRESS=0x...  # Deployed ExecutionRouter
UNISWAP_V3_ADAPTER_ADDRESS=0x...  # Deployed UniswapV3SwapAdapter
WETH_WRAP_ADAPTER_ADDRESS=0x...  # Deployed WethWrapAdapter
WETH_ADDRESS_SEPOLIA=0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14  # Official Sepolia WETH
REDACTED_ADDRESS_SEPOLIA=0x...  # Sepolia REDACTED (if available)
ETH_TESTNET_RPC_URL=https://sepolia.infura.io/v3/...  # Or public RPC
RELAYER_PRIVATE_KEY=0x...  # Wallet with Sepolia ETH for gas
BLOSSOM_MODEL_PROVIDER=gemini
BLOSSOM_GEMINI_API_KEY=your_key
```

### Frontend (.env)

```bash
VITE_USE_AGENT_BACKEND=true
VITE_EXECUTION_MODE=eth_testnet
VITE_EXECUTION_AUTH_MODE=session
VITE_ETH_TESTNET_RPC_URL=https://sepolia.infura.io/v3/...
VITE_FUNDING_ROUTE_MODE=atomic  # Use Route 2
```

---

## Exact Test Flow

### Step 1: Initial Wallet State

**Before starting, record:**
- Wallet ETH balance: `X ETH`
- Wallet WETH balance: `0 WETH` (or minimal)
- Wallet REDACTED balance: `0 REDACTED` (or minimal)

**Expected:**
- User has ETH but no WETH/REDACTED (for Route 2 test)

---

### Step 2: Create Session

1. **Open UI:** `http://localhost:5173`
2. **Connect Wallet:** Click "Connect Wallet" → Select MetaMask → Approve
3. **Create Session:**
   - Click "Create Session" button
   - MetaMask popup appears
   - **Transaction details:**
     - `to`: ExecutionRouter address
     - `value`: 0 ETH
     - `data`: Session creation calldata
   - Approve transaction
   - Wait for confirmation (1 block)

**Expected Wallet Deltas:**
- ETH: `-0.0001 ETH` (gas only, ~$0.10 at 20 gwei)
- WETH: `0 WETH` (unchanged)
- REDACTED: `0 REDACTED` (unchanged)

**Verify:**
- Session status shows "Active"
- Session expiry: 7 days from now
- Session max spend: 10 ETH

---

### Step 3: Swap ETH → WETH (Route 2, Relayed)

1. **Send Chat Message:**
   ```
   Swap 0.01 ETH to WETH on Sepolia
   ```

2. **Expected Chat Response:**
   - Gemini returns `executionRequest`:
     ```json
     {
       "kind": "swap",
       "chain": "sepolia",
       "tokenIn": "ETH",
       "tokenOut": "WETH",
       "amountIn": "0.01",
       "fundingPolicy": "auto"
     }
     ```

3. **Click "Confirm Trade"**

4. **Expected Flow:**
   - **No MetaMask popup** (relayed execution)
   - Backend prepares plan with:
     - Action 1: WRAP (ETH → WETH)
     - Action 2: SWAP (WETH → WETH, passthrough)
   - Backend relays transaction
   - Transaction hash returned immediately

5. **Wait for Confirmation:**
   - Poll `/api/execute/status` until `status === 'confirmed'`
   - Typically 12-30 seconds on Sepolia

**Expected Wallet Deltas:**
- ETH: `-0.01 ETH` (wrapped amount)
- WETH: `+0.01 WETH` (received from wrap)
- REDACTED: `0 REDACTED` (unchanged)
- **Gas:** Paid by relayer (user pays nothing)

**Verify:**
- Transaction on Sepolia explorer shows:
  - `from`: Relayer address (not user)
  - `to`: ExecutionRouter address
  - `value`: 0.01 ETH
  - `data`: Plan calldata (WRAP + SWAP)
- Portfolio shows WETH balance increased
- No partial portfolio state

---

### Step 4: Verify Portfolio State

**Check Backend Portfolio:**
```bash
curl http://localhost:3001/api/portfolio/eth_testnet?userAddress=YOUR_ADDRESS
```

**Expected Response:**
```json
{
  "accountValueUsd": 10000,
  "balances": [
    { "symbol": "ETH", "balanceUsd": 29.99 },
    { "symbol": "WETH", "balanceUsd": 0.01 * ETH_PRICE },
    { "symbol": "REDACTED", "balanceUsd": 0 }
  ],
  "openPerpExposureUsd": 0,
  "eventExposureUsd": 0,
  "defiPositions": [],
  "strategies": []
}
```

**Check Frontend Portfolio:**
- RightPanel shows WETH balance
- Account value updated
- No stale state

---

## Expected Wallet Deltas Summary

| Step | ETH Delta | WETH Delta | REDACTED Delta | Gas Paid By |
|------|-----------|------------|------------|-------------|
| **Initial** | `X ETH` | `0 WETH` | `0 REDACTED` | - |
| **Create Session** | `-0.0001 ETH` | `0 WETH` | `0 REDACTED` | User |
| **Swap (Relayed)** | `-0.01 ETH` | `+0.01 WETH` | `0 REDACTED` | Relayer |
| **Final** | `X - 0.0101 ETH` | `0.01 WETH` | `0 REDACTED` | - |

**Total User Cost:** ~0.0101 ETH (0.01 for swap + 0.0001 for session)

---

## Failure Cases to Test

### 1. Insufficient Balance

**Test:** Try to swap more ETH than wallet has
```
Swap 100 ETH to WETH on Sepolia
```

**Expected:**
- Backend returns warning: `INSUFFICIENT_BALANCE`
- UI shows clear error message
- No transaction attempted
- Portfolio unchanged

### 2. Session Expired

**Test:** Wait for session to expire (or manually revoke)

**Expected:**
- Relayed execution fails with "session expired"
- UI shows clear error message
- User prompted to create new session
- Portfolio unchanged

### 3. Relayer Failure

**Test:** Stop relayer wallet or set insufficient balance

**Expected:**
- Relayed execution fails with "insufficient funds for gas"
- UI shows clear error message
- User can retry or use direct mode
- Portfolio unchanged

### 4. LLM Refusal

**Test:** Send prompt that LLM refuses

**Expected:**
- Backend returns `modelOk: false`
- UI shows: "I couldn't generate a valid execution plan"
- No actions executed
- Portfolio unchanged

---

## Verification Checklist

- [ ] Session created successfully
- [ ] Session status shows "Active"
- [ ] Swap executed via relay (no user signature)
- [ ] Transaction confirmed on Sepolia
- [ ] Wallet ETH decreased by 0.01 ETH
- [ ] Wallet WETH increased by 0.01 WETH
- [ ] Portfolio updated correctly
- [ ] No partial state
- [ ] Explorer link works
- [ ] All failure cases handled gracefully

---

## Troubleshooting

### Transaction Stuck

- Check relayer wallet has ETH
- Check session is active
- Check Sepolia network status

### Portfolio Not Updating

- Check backend `/api/portfolio/eth_testnet` endpoint
- Verify frontend calls `updateFromBackendPortfolio()`
- Check browser console for errors

### Session Not Found

- Check `localStorage` for `blossom_session_${userAddress}`
- Verify session exists on-chain via `/api/session/status`
- Create new session if needed

---

## Success Criteria

✅ **Session created** and active  
✅ **Swap executed** via relay (no user signature)  
✅ **Wallet state** matches expected deltas  
✅ **Portfolio state** matches wallet state  
✅ **No partial updates** or stale state  
✅ **All failure cases** handled gracefully  

**If all criteria pass, MVP A is ready for whitelist testing.**


