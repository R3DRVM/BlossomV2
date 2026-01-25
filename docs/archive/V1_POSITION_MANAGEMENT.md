# V1 Position Management Implementation Plan

**Goal**: RightPanel positions update only after receipt.status === 1, with edit handlers for close/resize/withdraw

---

## Implementation Tasks

### 1. Receipt-Driven Updates ✅
- `/api/execute/relayed` already waits for receipt.status === 1
- Frontend must check `receiptStatus === 'confirmed'` before updating portfolio
- Update Chat.tsx to only call `updateFromBackendPortfolio` when receipt confirmed

### 2. RightPanel Edit Handlers 🚧
- Add handlers for:
  - Perp: close, resize (margin/leverage), update SL/TP
  - DeFi: withdraw (partial/full)
  - Event: sell/close
- Each handler calls `/api/execute/prepare` → `/api/execute/relayed` with edit execution kind
- Use existing strategy.id (stable ID)
- Include `strategyExecutionNonce` for idempotency

### 3. Strategy Lifecycle States
- draft → executing → open (confirmed) → closed/error
- Only transition to open after receipt.status === 1
- Show "executing..." state during in-flight execution

### 4. UI States
- Disable edit buttons during executing state
- Show explorer link (txHash + blockNumber)
- Show error card with revert reason on failure

### 5. Backend Edit Execution Kinds
- Verify backend supports: `perp_close`, `perp_update`, `lend_withdraw`, `event_close`
- If not, add support in `ethTestnetExecutor.ts`

---

## Files to Modify

1. `src/components/Chat.tsx` - Check receiptStatus before updating portfolio
2. `src/components/RightPanel.tsx` - Add edit handlers
3. `src/context/BlossomContext.tsx` - Add executing state tracking
4. `agent/src/executors/ethTestnetExecutor.ts` - Add edit execution kinds (if needed)

---

## Next Steps

1. Fix Chat.tsx to check receiptStatus
2. Add edit handlers in RightPanel
3. Add executing state tracking
4. Test end-to-end flow


