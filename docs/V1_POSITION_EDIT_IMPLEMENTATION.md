# V1 Position Edit Implementation

**Status**: 🚧 In Progress

---

## Current State

### ✅ Completed
1. Receipt-driven updates in Chat.tsx - Only updates portfolio after receipt.status === 1
2. Backend receipt confirmation - `/api/execute/relayed` waits for receipt.status === 1

### 🚧 In Progress
1. RightPanel edit handlers - Need to call backend instead of local state updates
2. Executing state tracking - Need to track in-flight executions
3. Explorer links - Need to display txHash + blockNumber in RightPanel

### ⏳ Pending
1. Backend edit execution kinds - Need to add `perp_close`, `perp_update`, `lend_withdraw`, `event_close`
2. Strategy execution nonce - Need to track per-strategy nonce for idempotency

---

## Implementation Plan

### Phase 1: Frontend Receipt-Driven Updates ✅
- [x] Chat.tsx checks receiptStatus before updating portfolio
- [x] Only updates if receiptStatus === 'confirmed'

### Phase 2: RightPanel Edit Handlers 🚧
- [ ] Replace local state updates with backend calls
- [ ] Add executing state tracking
- [ ] Disable buttons during execution
- [ ] Show explorer links

### Phase 3: Backend Edit Execution Kinds ⏳
- [ ] Add `perp_close` execution kind
- [ ] Add `perp_update` execution kind (resize, SL/TP)
- [ ] Add `lend_withdraw` execution kind
- [ ] Add `event_close` execution kind
- [ ] Add strategy execution nonce tracking

---

## Files Modified

1. `src/components/Chat.tsx` - ✅ Receipt-driven updates
2. `src/components/RightPanel.tsx` - 🚧 Edit handlers (in progress)
3. `src/context/BlossomContext.tsx` - 🚧 Executing state tracking (in progress)
4. `agent/src/executors/ethTestnetExecutor.ts` - ⏳ Edit execution kinds (pending)

---

## Next Steps

1. Add executing state tracking in BlossomContext
2. Update RightPanel edit handlers to call backend
3. Add backend edit execution kinds
4. Test end-to-end flow


