# V1 Demo Checklist

**Target**: Sepolia Testnet MVP with one-click execution  
**Time**: <3 minutes to complete all 4 canonical intents

---

## Prerequisites

1. **Start Demo**:
   ```bash
   ./scripts/restart-demo.sh
   ```

2. **Verify Configuration**:
   ```bash
   ./scripts/demo-readiness.sh
   ```
   Should show:
   - ✅ All API endpoints reachable
   - ✅ Session endpoints return valid status
   - ✅ Execution preflight checks pass

3. **Connect Wallet**:
   - Open `http://127.0.0.1:5173/app`
   - Connect MetaMask (Sepolia network)
   - Ensure wallet has Sepolia ETH for gas

---

## Step 1: Enable One-Click Execution (One Signature)

1. **Click "Enable one-click execution"** button in UI
2. **Sign MetaMask transaction** (creates session on-chain)
3. **Verify Session Active**:
   - UI shows "Session Active" banner
   - Banner displays:
     - Max spend: 10 ETH (or configured cap)
     - Expires: 7 days from now
     - Allowed adapters: [list]
   - No errors in console

**Expected**: ✅ One MetaMask signature, session created, banner visible

---

## Step 2: Execute Perp Strategy

1. **Send Prompt**: "open BTC long 2x with 2% risk"
2. **Verify Card Renders**:
   - ✅ ConfirmTradeCard appears
   - ✅ Shows "Chain: Sepolia"
   - ✅ Shows "Venue: [actual adapter name]"
   - ✅ Shows risk %, leverage, margin, notional
   - ✅ Shows planHash (if implemented)
3. **Click "Confirm & Execute"**
4. **Verify Execution**:
   - ✅ **NO MetaMask prompt** (session-based)
   - ✅ UI shows "Executing..." or loading state
   - ✅ After ~10-30s, shows success message
   - ✅ Displays txHash with explorer link
   - ✅ Strategy status changes: draft → executed → open
   - ✅ Portfolio updates (new perp position visible)

**Expected**: ✅ Zero MetaMask prompts, txHash returned, position visible

---

## Step 3: Execute DeFi Strategy

1. **Send Prompt**: "park 10 usdc into yield"
2. **Verify Card Renders**:
   - ✅ ConfirmTradeCard appears
   - ✅ Shows "Chain: Sepolia"
   - ✅ Shows "Venue: Aave V3" (or actual venue)
   - ✅ Shows deposit amount, expected yield
3. **Click "Confirm & Execute"**
4. **Verify Execution**:
   - ✅ **NO MetaMask prompt**
   - ✅ txHash returned
   - ✅ Strategy status: draft → executed → open
   - ✅ Portfolio shows DeFi position

**Expected**: ✅ Zero MetaMask prompts, DeFi position created

---

## Step 4: Execute Event Strategy

1. **Send Prompt**: "bet YES on Fed rate cut with $5"
2. **Verify Card Renders**:
   - ✅ ConfirmTradeCard appears
   - ✅ Shows "Chain: Sepolia"
   - ✅ Shows "Venue: [event market adapter]"
   - ✅ Shows stake amount, outcome (YES/NO)
3. **Click "Confirm & Execute"**
4. **Verify Execution**:
   - ✅ **NO MetaMask prompt**
   - ✅ txHash returned
   - ✅ Strategy status: draft → executed → open
   - ✅ Portfolio shows event position

**Expected**: ✅ Zero MetaMask prompts, event bet placed

---

## Step 5: Execute Swap

1. **Send Prompt**: "swap 10 USDC to ETH"
2. **Verify Behavior**:
   - ✅ Swap executes immediately (no confirm card)
   - ✅ **NO MetaMask prompt** (session-based)
   - ✅ txHash returned
   - ✅ Portfolio balances update (USDC decreases, ETH increases)

**Expected**: ✅ Zero MetaMask prompts, swap executed, balances updated

---

## Verification Checklist

### Session Integrity
- [ ] Only **ONE** MetaMask signature total (session enable)
- [ ] All 4 executions use relayed path (no MetaMask prompts)
- [ ] Session banner shows correct caps/allowlists
- [ ] Session expires at correct time (7 days)

### Execution Results
- [ ] All 4 strategies produce **mined txHash** (not just pending)
- [ ] All txHashes have `receipt.status === 1` (confirmed)
- [ ] Explorer links work (e.g., `https://sepolia.etherscan.io/tx/0x...`)
- [ ] Block numbers are present in execution results

### Strategy Lifecycle
- [ ] Perp: draft → executed → open (with txHash)
- [ ] DeFi: draft → executed → open (with txHash)
- [ ] Event: draft → executed → open (with txHash)
- [ ] Swap: executes immediately, no draft state

### Portfolio Updates
- [ ] Perp position visible in portfolio
- [ ] DeFi position visible in portfolio
- [ ] Event position visible in portfolio
- [ ] Swap balances updated correctly
- [ ] Net exposure calculated correctly
- [ ] Risk metrics updated (if implemented)

### Routing Metadata
- [ ] All cards show "Chain: Sepolia" (not Base/Hyperliquid)
- [ ] All cards show actual venue (Uniswap V3, Aave V3, etc.)
- [ ] Slippage shown where applicable
- [ ] No placeholder/generic values

### Risk Evaluation (if implemented)
- [ ] Pre-execution risk check runs
- [ ] High-risk strategies show warning
- [ ] Net exposure calculated correctly
- [ ] Correlations considered (if implemented)

### Error Handling
- [ ] Failed transactions show error card with decoded revert reason
- [ ] Strategy remains in draft state if execution fails
- [ ] No silent failures
- [ ] Clear error messages

---

## Troubleshooting

### "Execution temporarily disabled"
- **Cause**: `EXECUTION_DISABLED=true` in backend
- **Fix**: Remove or set to `false` in `agent/.env.local`

### "V1_DEMO mode requires session-based execution"
- **Cause**: `V1_DEMO=true` and trying direct execution
- **Fix**: Enable session first, or set `V1_DEMO=false`

### "Transaction will revert" before MetaMask
- **Cause**: Preflight simulation failed
- **Fix**: Check revert reason in logs, verify contract addresses, check balances/approvals

### MetaMask still prompts on Execute
- **Cause**: Session not enabled or not active
- **Fix**: Check session status, re-enable if needed

### No txHash returned
- **Cause**: Execution failed or timeout
- **Fix**: Check backend logs, verify relayer has ETH, check RPC URL

---

## Success Criteria

✅ **All 4 canonical intents execute successfully**  
✅ **Only ONE MetaMask signature total** (session enable)  
✅ **All executions produce mined txHash with receipt.status === 1**  
✅ **Portfolio updates correctly after each execution**  
✅ **Strategy lifecycle enforced (draft → executed → open)**  
✅ **Routing metadata accurate (Sepolia + actual venue)**  
✅ **No errors or silent failures**

---

## Time Target

- **Session Enable**: ~30 seconds (sign + mine)
- **Perp Execution**: ~30 seconds (relayed + mine)
- **DeFi Execution**: ~30 seconds (relayed + mine)
- **Event Execution**: ~30 seconds (relayed + mine)
- **Swap Execution**: ~30 seconds (relayed + mine)

**Total**: ~2.5 minutes for all 4 executions + session enable

---

## Notes

- First execution may be slower (session creation + first execution)
- Subsequent executions should be faster (session already active)
- If any execution fails, check logs with `DEBUG_EXECUTION=true`
- Explorer links should work immediately after txHash returned


