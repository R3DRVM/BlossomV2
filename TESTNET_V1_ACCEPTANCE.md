# Testnet V1 Acceptance Criteria

**Version:** 1.0  
**Date:** 2025-01-03  
**Purpose:** Define exactly what "polished MVP" means for investor demos on Sepolia testnet.

---

## Overview

The Blossom MVP must enable users to execute three core flows with verifiable on-chain artifacts:

1. **Perps Trade** - Long/short with risk % + TP/SL
2. **Yield Parking** - Supply idle USDC to lending
3. **Event Markets** - Buy YES/NO positions

Each flow must produce either:
- **Real Execution** - Router plan tx (swap, lend)
- **Proof-of-Execution** - On-chain proof tx (perps, events) until real adapters exist

---

## Getting Started Flows

### Flow A: Perps Trade

**User Action:**
> "Go long 3x on ETH with 3% of my account"

**Expected UI Behavior:**
1. AI responds with strategy recommendation
2. Strategy card appears with: market, side, leverage, TP/SL levels
3. User clicks "Confirm & Execute"
4. Transaction processes
5. Strategy flips to "executed" status
6. Explorer link appears in assistant message

**Expected Network Interaction (eth_testnet mode):**
- Wallet connected on Sepolia
- If real perp adapter exists: Execute router plan
- If not: Execute proof-of-execution tx

**Expected On-Chain Artifact:**
| Real Adapter | Artifact |
|--------------|----------|
| Not available | `ProofOfExecutionAdapter` tx with `ProofRecorded` event |
| Available | Real perp protocol tx |

**Proof Event Contents:**
- `venueType`: 1 (perps)
- `intentHash`: keccak256 of canonical intent (market, side, leverage, riskPct, marginUsd)
- `summary`: "PERP:ETH-LONG-3x-3%"

**Explorer Link Format:**
```
https://sepolia.etherscan.io/tx/0x{txHash}
```

---

### Flow B: Park Idle USDC into Yield

**User Action:**
> "Put 250 USDC into lending"

**Expected UI Behavior:**
1. AI responds with yield recommendation
2. DeFi card appears with: protocol, APY, amount
3. User clicks "Confirm & Execute"
4. Approval tx (if needed)
5. Deposit tx executes
6. Strategy flips to "executed" status
7. Explorer link appears

**Expected Network Interaction (eth_testnet mode):**
- Approval for DEMO_USDC to ExecutionRouter (one-time)
- PULL + LEND_SUPPLY plan execution via router

**Expected On-Chain Artifact:**
| Component | Artifact |
|-----------|----------|
| Plan | 2 actions: PULL, LEND_SUPPLY |
| Tx | Real router execution |
| Event | `DemoLendVault.Deposit(caller, owner, assets, shares)` |

**Explorer Link Format:**
```
https://sepolia.etherscan.io/tx/0x{txHash}
```

---

### Flow C: Event Markets (YES/NO)

**User Action:**
> "Buy 50 USDC on YES for Fed rate cut"

**Expected UI Behavior:**
1. AI responds with event market analysis
2. Event card appears with: market, outcome, stake, payout
3. User clicks "Confirm & Execute"
4. Transaction processes
5. Strategy flips to "executed" status
6. Explorer link appears

**Expected Network Interaction (eth_testnet mode):**
- If real event adapter exists: Execute real market tx
- If not: Execute proof-of-execution tx

**Expected On-Chain Artifact:**
| Real Adapter | Artifact |
|--------------|----------|
| Not available | `ProofOfExecutionAdapter` tx with `ProofRecorded` event |
| Available | Real event market protocol tx |

**Proof Event Contents:**
- `venueType`: 2 (event)
- `intentHash`: keccak256 of canonical intent (marketId, outcome, stakeUsd)
- `summary`: "EVENT:fedcuts-YES-50USD"

---

## Quick Actions Acceptance

Quick Actions are buttons that appear after AI responses.

### Classification

| Quick Action | Type | On-Chain Artifact |
|--------------|------|-------------------|
| "Simulate PnL" | Informational | None (local calc) |
| "Show liquidation risk" | Informational | None (local calc) |
| "Set stop-loss at X" | Actionable | Proof tx (modify perp) |
| "Take profit at Y" | Actionable | Proof tx (modify perp) |
| "Add to position" | Actionable | Real/Proof tx |
| "Close position" | Actionable | Real/Proof tx |
| "Withdraw from yield" | Actionable | Real tx (lend_withdraw) |

### Actionable Quick Action Requirements

1. Must call backend `/api/execute/prepare`
2. Must execute tx (real or proof)
3. Must wait for receipt confirmation
4. Must append assistant message with:
   - Action summary
   - Explorer link
   - Confirmation status

---

## Verification Checklist

### Pre-Execution Checks

- [ ] Wallet connected on Sepolia (chainId: 11155111)
- [ ] Preflight check passes (`GET /api/execute/preflight`)
- [ ] Demo tokens funded (DEMO_USDC balance > 0)
- [ ] Router approval exists (or will prompt)

### Per-Execution Checks

- [ ] Tx submitted to chain
- [ ] Receipt confirms (status: 0x1)
- [ ] Strategy status updates to "executed"
- [ ] Explorer link displayed
- [ ] Telemetry logged (`tx_confirmed` event)

### Event Verification (Proof Txs)

For perps/events using proof adapter:
- [ ] `ProofRecorded` event emitted
- [ ] `venueType` matches (1=perps, 2=event)
- [ ] `intentHash` matches canonical encoding
- [ ] `summary` ≤ 160 chars

---

## Contract Addresses (Sepolia)

After deployment, these addresses will be used:

| Contract | Env Variable | Purpose |
|----------|--------------|---------|
| ExecutionRouter | `EXECUTION_ROUTER_ADDRESS` | Plan execution |
| ERC20PullAdapter | `ERC20_PULL_ADAPTER_ADDRESS` | Token transfers |
| UniswapV3SwapAdapter | `UNISWAP_ADAPTER_ADDRESS` | Demo swaps |
| DemoLendVault | `DEMO_LEND_VAULT_ADDRESS` | Demo lending |
| DemoLendSupplyAdapter | `DEMO_LEND_ADAPTER_ADDRESS` | Lending adapter |
| ProofOfExecutionAdapter | `PROOF_ADAPTER_ADDRESS` | Perps/events proof |
| DEMO_USDC | `DEMO_USDC_ADDRESS` | Demo token |
| DEMO_WETH | `DEMO_WETH_ADDRESS` | Demo token |

---

## Test Scenarios

### E2E Test: Swap Flow
1. Connect wallet (Sepolia)
2. Say "Swap 100 USDC to WETH"
3. Confirm strategy
4. Verify: approval tx (if needed) + swap tx
5. Verify: receipt status = confirmed
6. Verify: explorer link valid

### E2E Test: Lending Flow
1. Connect wallet (Sepolia)
2. Say "Supply 100 USDC to lending"
3. Confirm strategy
4. Verify: approval tx (if needed) + lend tx
5. Verify: receipt status = confirmed
6. Verify: `Deposit` event emitted

### E2E Test: Perps Flow (Proof)
1. Connect wallet (Sepolia)
2. Say "Long ETH 3x with 3% risk"
3. Confirm strategy
4. Verify: proof tx executed
5. Verify: `ProofRecorded` event with venueType=1
6. Verify: explorer link valid

### E2E Test: Event Flow (Proof)
1. Connect wallet (Sepolia)
2. Say "Buy YES on fed rate cut, 50 USDC"
3. Confirm strategy
4. Verify: proof tx executed
5. Verify: `ProofRecorded` event with venueType=2
6. Verify: explorer link valid

---

## Failure Modes

| Failure | Expected Behavior |
|---------|-------------------|
| Tx reverts | Strategy stays "pending", error message shown |
| Receipt timeout | Strategy stays "pending", "check tx" message shown |
| Wallet disconnected | Error message, prompt to reconnect |
| Wrong network | Error message with "Switch to Sepolia" prompt |
| Preflight fails | Execution blocked, config warning shown |

---

## Success Criteria

The MVP is "polished" when:

1. ✅ All 3 getting-started flows produce on-chain artifacts
2. ✅ Explorer links work for all executed strategies
3. ✅ Proof-of-execution covers perps/events until real adapters exist
4. ✅ Receipt confirmation gates strategy status updates
5. ✅ Telemetry captures all execution events
6. ✅ Automated e2e tests pass locally
7. ✅ SIM mode remains unchanged

---

## dFlow-Enhanced Mode (Optional)

When dFlow is enabled (`DFLOW_ENABLED=true`), the system can use dFlow for:

### Data/Quotes (Real)

| Capability | What it provides |
|------------|------------------|
| Events Markets | Real-time event market listings with prices |
| Events Quotes | Best execution price for event trades |
| Swaps Quotes | Routing intelligence for swap trades |

### Execution (Demo)

| Component | Status |
|-----------|--------|
| Swaps | Deterministic via DemoSwapRouter |
| Lending | Deterministic via DemoLendVault |
| Perps/Events | Proof-of-execution on-chain |

**Key point:** dFlow enhances the "routing decision" layer but execution remains deterministic for reliable demos.

### dFlow Configuration

```bash
# Enable dFlow
DFLOW_ENABLED=true
DFLOW_API_KEY=your-api-key
DFLOW_BASE_URL=https://api.dflow.net

# Capability paths (set to enable each capability)
DFLOW_EVENTS_MARKETS_PATH=/v1/events/markets
DFLOW_EVENTS_QUOTE_PATH=/v1/events/quote
DFLOW_SWAPS_QUOTE_PATH=/v1/swaps/quote

# Optional: fail if dFlow unavailable
DFLOW_REQUIRE=false
```

### Verification

Check preflight for dFlow status:
```bash
curl http://localhost:3001/api/execute/preflight | jq '.dflow'
```

Expected when enabled:
```json
{
  "enabled": true,
  "ok": true,
  "required": false,
  "capabilities": {
    "eventsMarkets": true,
    "eventsQuotes": true,
    "swapsQuotes": true
  }
}
```

