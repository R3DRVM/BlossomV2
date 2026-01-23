# V1 Testnet MVP Requirements & Implementation Status

**Target**: Sepolia-only, session-based one-click execution  
**Status**: 🚧 Implementation In Progress

---

## Core Requirements

### ✅ Completed
1. **Session mode default** - EXECUTION_AUTH_MODE defaults to 'session' for eth_testnet
2. **Preflight simulation** - eth_call before MetaMask prompt
3. **Gas limit fixes** - 15.5M cap, omit on failure
4. **Routing metadata** - Always Sepolia, correct venue

### 🚧 In Progress
1. **Session enable with caps/allowlists** - Need to enhance `/api/session/prepare` response
2. **Receipt confirmation** - Need to wait for receipt.status === 1
3. **Strategy lifecycle** - Need to enforce draft → executed → open → closed
4. **Session state tracking** - Need server-side session storage with nonce

### ⏳ Pending
1. **V1_DEMO mode** - Session-only, block direct execution
2. **Plan hash computation** - Server-side keccak256(abi.encode(plan))
3. **Risk evaluation** - Pre-execution net exposure/correlations
4. **Emergency kill switch** - EXECUTION_DISABLED flag
5. **Aave V3 integration** - Real Aave Pool on Sepolia
6. **Single-action enforcement** - Reject if plan.actions.length !== 1 when V1_DEMO=true

---

## Implementation Priority

### Phase 1: Critical Path (Must Have)
1. ✅ Session mode default
2. 🚧 Session enable returns capability snapshot
3. 🚧 Receipt confirmation (wait for receipt.status === 1)
4. 🚧 Strategy lifecycle (draft → executed → open)
5. 🚧 Session state tracking (nonce per user)

### Phase 2: Safety & UX (Should Have)
6. ⏳ V1_DEMO mode
7. ⏳ Plan hash computation
8. ⏳ Risk evaluation
9. ⏳ Emergency kill switch

### Phase 3: Real Integrations (Nice to Have)
10. ⏳ Aave V3 on Sepolia
11. ⏳ Single-action enforcement

---

## Next Steps

1. Enhance session enable to return capability snapshot
2. Add receipt confirmation to execution flow
3. Implement strategy lifecycle management
4. Add server-side session state tracking
5. Add V1_DEMO mode
6. Add plan hash computation
7. Create V1 Demo Checklist

---

## Notes

- Current session flow works but needs enhancement for caps/allowlists display
- Receipt confirmation exists but may not be enforced everywhere
- Strategy lifecycle needs explicit state transitions
- Session state is currently read from chain, need in-memory tracking for nonce


