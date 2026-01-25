# V1 Testnet MVP Implementation Plan

**Status**: 🚧 In Progress  
**Target**: Sepolia-only, session-based one-click execution

---

## Implementation Phases

### Phase 1: Session Mode as Default ✅ (In Progress)
- [x] Make EXECUTION_AUTH_MODE default to 'session' for eth_testnet
- [ ] Enhance session enable with caps/allowlists/approvals
- [ ] Add session capability snapshot endpoint
- [ ] Store session state server-side with nonce tracking

### Phase 2: Receipt Confirmation & Strategy Lifecycle
- [ ] Wait for receipt.status === 1 before UI updates
- [ ] Enforce draft → executed → open → closed lifecycle
- [ ] Persist txHash + blockNumber on strategy
- [ ] Show explorer link on executed strategies

### Phase 3: Risk Evaluation & Portfolio Updates
- [ ] Pre-execution risk evaluation (net exposure, correlations)
- [ ] Update portfolio after receipt confirmation
- [ ] Unified portfolio aggregation across strategy types

### Phase 4: V1_DEMO Mode & Safety Features
- [ ] Add V1_DEMO=true mode (session-only, block direct)
- [ ] Add EXECUTION_DISABLED emergency kill switch
- [ ] Add planHash computation and display
- [ ] Single-action plan enforcement for canonical flows

### Phase 5: Real Aave Integration
- [ ] Add AAVE_POOL_ADDRESS config constant
- [ ] Validate Aave Pool address on startup
- [ ] Integrate real Aave V3 on Sepolia

### Phase 6: Testing & Documentation
- [ ] Update demo-readiness.sh with execution checks
- [ ] Create V1 Demo Checklist
- [ ] Add E2E tests

---

## Current Status

**Completed**:
- ✅ Session mode default for eth_testnet
- ✅ Preflight simulation (eth_call)
- ✅ Gas limit fixes (15.5M cap)
- ✅ Routing metadata fixes (always Sepolia)

**In Progress**:
- 🚧 Session enable flow enhancements
- 🚧 Receipt confirmation
- 🚧 Strategy lifecycle management

**Pending**:
- ⏳ Risk evaluation
- ⏳ V1_DEMO mode
- ⏳ Plan hash computation
- ⏳ Emergency kill switch

---

## Next Steps

1. Enhance session enable flow with caps/allowlists
2. Add receipt confirmation to execution flow
3. Implement strategy lifecycle management
4. Add risk evaluation
5. Add V1_DEMO mode
6. Create V1 Demo Checklist


