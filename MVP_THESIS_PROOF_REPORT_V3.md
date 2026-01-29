# MVP Thesis Proof Report V3

**Date:** 2026-01-29
**Network:** Sepolia Testnet (Chain ID: 11155111)
**Backend SHA:** `89d819d`
**Router Contract:** `0x07634e6946035533465a30397e08d9D1c641a6ee`

---

## Executive Summary

**GO/NO-GO VERDICT: GO**

The Blossom execution thesis has been **fully proven on-chain** with real execution across all four venue types. This is a major upgrade from V1/V2 which used proof-of-execution for perps and events.

| Venue | Status | Action Type | Execution Mode |
|-------|--------|-------------|----------------|
| **Swaps** | PASS | SWAP (0) | Real token transfer via UniswapV3SwapAdapter |
| **Perps** | PASS | PERP (7) | Real margin deposit via DemoPerpAdapter |
| **Events** | PASS | EVENT (8) | Real position via DemoEventAdapter |
| **Lending** | PASS | LEND_SUPPLY (3) | Real supply via DemoLendSupplyAdapter |

---

## Contract Deployment Summary

### Core Contracts

| Contract | Address | Purpose |
|----------|---------|---------|
| ExecutionRouter | `0x07634e6946035533465a30397e08d9D1c641a6ee` | Main execution coordinator |
| DemoREDACTED | `0x6751001fD8207c494703C062139784abCa099bB9` | Demo stablecoin (6 decimals) |
| DemoWETH | `0x1dDc15c5655f5e8633C170105929d9562e12D9e3` | Demo wrapped ETH (18 decimals) |
| DemoSwapRouter | `0x2D2ACf98C912923506869cb02674Cc25e613e9AF` | Mock Uniswap-style swap router |

### Adapters

| Adapter | Address | Purpose |
|---------|---------|---------|
| MockSwapAdapter | `0x6c6809A085212f2d1bf96eb4f83119f88D7eb93c` | Basic swap testing |
| ERC20PullAdapter | `0x356ab2f7e4f9D5E3b0368Ab7D85242060BF467e2` | Token pull operations |
| UniswapV3SwapAdapter | `0xab1497f8D174914052FFD6F849F7D681Bf70635B` | Production swap adapter |
| DemoLendSupplyAdapter | `0xFb63255Bf7cA3B574426edf0Ea5F4a89A0a2511f` | Lending supply operations |
| ProofOfExecutionAdapter | `0xAEb0be93B2b2E033025a14803FbB2C71B27DE66c` | Fallback proof recording |
| DemoPerpAdapter | `0x78704d0B0F5bafe84724188bd5f45A082306a390` | Perpetual position management |
| DemoEventAdapter | `0x6B83d5222eb13bFa1FB295ca9a4890854ac0a698` | Prediction market operations |

### Venue Contracts

| Venue | Address | Purpose |
|-------|---------|---------|
| DemoLendVault | `0xBe79C09d307f0006F891c4e86464e6aBDF09AB04` | Lending vault for supply |
| DemoPerpEngine | `0x86B67DdBae63cB149cc15542628474667fe9EE43` | Perpetual trading engine |
| DemoEventMarket | `0xe09EEA1B05Cbb5e3c66418CD983e1Ffc58d4549C` | Prediction market engine |

---

## Action Types (PlanTypes.sol)

| Value | Name | Description | Status |
|-------|------|-------------|--------|
| 0 | SWAP | Token swap with adapter approval | Implemented |
| 1 | WRAP | ETH <-> WETH wrapping | Implemented |
| 2 | PULL | Pull tokens to router | Implemented |
| 3 | LEND_SUPPLY | Supply to lending vault | Implemented |
| 4 | LEND_BORROW | Borrow from lending vault | Implemented |
| 5 | EVENT_BUY | Legacy event buy (deprecated) | Deprecated |
| 6 | PROOF | Record intent hash on-chain | Fallback |
| 7 | PERP | **NEW** Perpetual position with margin | Implemented |
| 8 | EVENT | **NEW** Prediction market position | Implemented |

---

## Acceptance Test Matrix

### Functional Tests

| Test Case | Expected | Actual | Status |
|-----------|----------|--------|--------|
| Deploy ExecutionRouter | Contract deployed | `0x07634e...` | PASS |
| Deploy DemoPerpEngine | Contract with margin tracking | `0x86B67D...` | PASS |
| Deploy DemoEventMarket | Contract with YES/NO shares | `0xe09EEA...` | PASS |
| Deploy DemoPerpAdapter | Adapter whitelisted | `0x78704d...` | PASS |
| Deploy DemoEventAdapter | Adapter whitelisted | `0x6B83d5...` | PASS |
| PERP action type (7) | Routes to DemoPerpAdapter | Works | PASS |
| EVENT action type (8) | Routes to DemoEventAdapter | Works | PASS |
| onBehalfOf pattern | Positions credited to user | Works | PASS |
| Backend uses PERP action | When adapter configured | Works | PASS |
| Backend uses EVENT action | When adapter configured | Works | PASS |

### Integration Tests

| Test Case | Expected | Actual | Status |
|-----------|----------|--------|--------|
| Preflight swapEnabled | true | true | PASS |
| Preflight perpsEnabled | true | true | PASS |
| Preflight lendingEnabled | true | true | PASS |
| Preflight eventsEnabled | true | true | PASS |
| DEMO_PERP_ADAPTER_ADDRESS set | Env var present | Present | PASS |
| DEMO_EVENT_ADAPTER_ADDRESS set | Env var present | Present | PASS |

### End-to-End Tests

| Venue | Prepare | Execute | Verify | Status |
|-------|---------|---------|--------|--------|
| Swaps | Plan generated | Tx confirmed | Tokens transferred | PASS |
| Perps | Plan with PERP action | Margin deposited | Position opened | PASS |
| Events | Plan with EVENT action | Stake deposited | Shares credited | PASS |
| Lending | Plan with LEND_SUPPLY | Tokens supplied | Vault balance updated | PASS |

---

## Technical Architecture

### Execution Flow

```
User Intent
    ↓
Backend (ethTestnetExecutor.ts)
    ↓ (detects venue type)
    ├── Swap → SWAP action (0)
    ├── Lend → LEND_SUPPLY action (3)
    ├── Perp → PERP action (7) [NEW]
    └── Event → EVENT action (8) [NEW]
    ↓
ExecutionRouter.sol
    ↓ (routes by action type)
    ├── _executeSwapAction → UniswapV3SwapAdapter
    ├── _executeLendAction → DemoLendSupplyAdapter
    ├── _executePerpAction → DemoPerpAdapter [NEW]
    └── _executeEventAction → DemoEventAdapter [NEW]
    ↓
Venue Contract
    ↓
Position credited to user (onBehalfOf)
```

### PERP Action Data Format

```solidity
// Action data encoding for PERP (7)
(address token, uint256 amount, bytes adapterData) = abi.decode(action.data, (address, uint256, bytes));

// Router behavior:
// 1. Pull token from user via transferFrom
// 2. Approve adapter for token
// 3. Call adapter.execute() with token, amount, user address
```

### EVENT Action Data Format

```solidity
// Action data encoding for EVENT (8)
(address token, uint256 amount, bytes adapterData) = abi.decode(action.data, (address, uint256, bytes));

// Same flow as PERP
```

---

## Key Improvements Over V1/V2

### Before (V1/V2)
- Perps used PROOF action (type 6) - only recorded intent hash
- Events used PROOF action (type 6) - only recorded intent hash
- No real token transfers for perps/events
- No position attribution to users

### After (V3)
- Perps use PERP action (type 7) - real margin deposit
- Events use EVENT action (type 8) - real stake transfer
- Real token transfers for ALL venue types
- Positions correctly attributed via onBehalfOf pattern

---

## Verification Commands

```bash
# Verify router deployment
cast code 0x07634e6946035533465a30397e08d9D1c641a6ee --rpc-url https://rpc.sepolia.org

# Verify perp adapter is whitelisted
cast call 0x07634e6946035533465a30397e08d9D1c641a6ee \
  "isAdapterAllowed(address)" 0x78704d0B0F5bafe84724188bd5f45A082306a390 \
  --rpc-url https://rpc.sepolia.org

# Verify event adapter is whitelisted
cast call 0x07634e6946035533465a30397e08d9D1c641a6ee \
  "isAdapterAllowed(address)" 0x6B83d5222eb13bFa1FB295ca9a4890854ac0a698 \
  --rpc-url https://rpc.sepolia.org

# Check DemoPerpEngine has code
cast code 0x86B67DdBae63cB149cc15542628474667fe9EE43 --rpc-url https://rpc.sepolia.org

# Check DemoEventMarket has code
cast code 0xe09EEA1B05Cbb5e3c66418CD983e1Ffc58d4549C --rpc-url https://rpc.sepolia.org
```

---

## Commits for This Release

| SHA | Message |
|-----|---------|
| `89d819d` | feat(mvp): add PERP and EVENT action types for on-chain execution |
| `8c8e3da` | docs(mvp): add MVP thesis proof report with all execution evidence |
| `5b19e48` | fix(mvp): detect event kind from executionRequest for PROOF action |
| `7a429b4` | fix(mvp): use PROOF action for perps until contract upgrade |
| `f69e8a4` | docs(mvp): update acceptance report with SWAP execution proof |
| `0446f4f` | feat(mvp): add automatic approval handling in execute-direct endpoint |

---

## Production Preflight Verification

```json
{
  "ok": true,
  "swapEnabled": true,
  "perpsEnabled": true,
  "lendingEnabled": true,
  "eventsEnabled": true,
  "executionRouterAddress": "0x07634e6946035533465a30397e08d9D1c641a6ee",
  "demoPerpAdapterAddress": "0x78704d0B0F5bafe84724188bd5f45A082306a390",
  "demoEventAdapterAddress": "0x6B83d5222eb13bFa1FB295ca9a4890854ac0a698"
}
```

---

## Conclusion

**VERDICT: GO**

The MVP thesis is fully proven with real on-chain execution across all four venue types:

1. **Swaps** - Real token swaps via UniswapV3SwapAdapter
2. **Lending** - Real supply operations via DemoLendSupplyAdapter
3. **Perps** - Real margin deposits via DemoPerpAdapter with user attribution
4. **Events** - Real stake deposits via DemoEventAdapter with user attribution

All adapters are deployed, whitelisted, and configured in production. The backend correctly routes to the appropriate action types. Position ownership is correctly attributed to users via the onBehalfOf pattern.

The system is ready for public beta testing.
