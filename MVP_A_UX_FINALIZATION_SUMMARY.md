# MVP A UX Finalization Summary

## Files Changed

### 1. `src/lib/config.ts`
**Change:** Added `forceDemoPortfolio` flag
**Rationale:** Allows override to keep mock balances even in eth_testnet mode

### 2. `src/lib/walletAdapter.ts`
**Change:** Added `getChainId()` and `switchToSepolia()` functions
**Rationale:** Network detection and switching support

### 3. `src/context/BlossomContext.tsx`
**Change:** Modified `INITIAL_ACCOUNT` to be empty in eth_testnet mode (unless `forceDemoPortfolio=true`)
**Rationale:** No mock balances on first load in eth_testnet mode

### 4. `src/components/RightPanel.tsx`
**Change:** Added wallet-first UX:
- Shows "Connect Wallet" CTA when no wallet connected (eth_testnet mode)
- Shows network warning + "Switch to Sepolia" when wrong network
- Shows session status and "Create Session" CTA (session mode)
- Only shows balances/holdings when wallet connected or in sim mode
**Rationale:** Wallet must precede portfolio in eth_testnet mode

### 5. `src/components/Chat.tsx`
**Change:** 
- Added network enforcement (blocks execution if not on Sepolia)
- Added session-first enforcement (blocks execution if no active session in session mode)
- Updated executionResults handling to update portfolio from `result.portfolio`
**Rationale:** Enforce network and session requirements, ensure portfolio updates from execution results

### 6. `src/components/CreateSession.tsx`
**Change:** Fixed imports (use `callAgent` from `apiClient`, `sendTransaction` from `walletAdapter`)
**Rationale:** Correct import paths

---

## Manual Test Checklist

### Test 1: eth_testnet - Load → Connect Wallet → Balances Load

1. Set `VITE_EXECUTION_MODE=eth_testnet` (and NOT `VITE_FORCE_DEMO_PORTFOLIO=true`)
2. Start frontend
3. **Expected:** Wallet card shows "Connect Wallet (Sepolia)" button, no balances
4. Click "Connect Wallet"
5. **Expected:** MetaMask popup appears
6. Connect wallet
7. **Expected:** Wallet card shows real balances (ETH/WETH/USDC) from Sepolia

### Test 2: Wrong Network - Warning + Switch Network Works

1. Connect wallet on wrong network (e.g., Mainnet)
2. **Expected:** Wallet card shows amber warning: "Wrong Network" + "Switch to Sepolia" button
3. Click "Switch to Sepolia"
4. **Expected:** MetaMask prompts to switch network
5. Approve switch
6. **Expected:** Warning disappears, balances load

### Test 3: Session Mode - Create Session Once → Swap ETH→WETH Relayed Works

1. Set `VITE_EXECUTION_AUTH_MODE=session`
2. Connect wallet on Sepolia
3. **Expected:** Wallet card shows "Session Required" + "Create Session" button
4. Click "Create Session"
5. **Expected:** MetaMask popup for session creation tx
6. Sign transaction
7. **Expected:** Session status shows "Active"
8. Send chat: "Swap 0.01 ETH to WETH on Sepolia"
9. Click "Confirm & Execute"
10. **Expected:** NO MetaMask popup (relayed execution)
11. **Expected:** Transaction hash returned, portfolio updated

### Test 4: Sim Mode Still Looks/Works Exactly Like Investor Demo

1. Set `VITE_EXECUTION_MODE=sim` (or unset)
2. Start frontend
3. **Expected:** Wallet card shows mock balances ($10,000 account value, USDC/ETH/SOL)
4. **Expected:** No wallet connection required
5. **Expected:** All executions return `simulatedTxId`
6. **Expected:** Portfolio updates work as before

### Test 5: Force Demo Portfolio Override

1. Set `VITE_EXECUTION_MODE=eth_testnet` AND `VITE_FORCE_DEMO_PORTFOLIO=true`
2. Start frontend
3. **Expected:** Wallet card shows mock balances (even in eth_testnet mode)
4. **Expected:** No wallet connection required
5. **Expected:** Executions still use real testnet (if wallet connected)

---

## Environment Variables

### Frontend (.env.local)

```bash
# Execution mode
VITE_EXECUTION_MODE=eth_testnet  # or 'sim'
VITE_EXECUTION_AUTH_MODE=session  # or 'direct'
VITE_FUNDING_ROUTE_MODE=atomic  # or 'manual'

# Override (optional)
VITE_FORCE_DEMO_PORTFOLIO=true  # Keep mock balances even in eth_testnet

# RPC
VITE_ETH_TESTNET_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
```

---

## Expected Behaviors

### eth_testnet Mode (Default)
- **No wallet connected:** Empty wallet card with "Connect Wallet" CTA
- **Wrong network:** Warning + "Switch to Sepolia" CTA
- **Session mode + no session:** "Create Session" CTA, execution blocked
- **Session active:** "Session Active" badge, relayed execution works
- **Balances:** Real ETH/WETH/USDC from Sepolia

### sim Mode
- **Wallet card:** Shows mock balances immediately
- **No wallet required:** All executions simulated
- **Portfolio:** Mock updates as before

---

## Code Changes Summary

**Total files modified:** 6
- `src/lib/config.ts` - Added `forceDemoPortfolio` flag
- `src/lib/walletAdapter.ts` - Added network detection/switching
- `src/context/BlossomContext.tsx` - Empty account in eth_testnet mode
- `src/components/RightPanel.tsx` - Wallet-first UX
- `src/components/Chat.tsx` - Network/session enforcement + portfolio updates
- `src/components/CreateSession.tsx` - Fixed imports

**No access gate changes** - All gating code left untouched as requested.


