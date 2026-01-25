# Whitelist Mode Configuration

## Overview

This document defines the locked configuration for MVP A whitelist testing. All limits are enforced server-side to ensure safety.

---

## Execution Modes

### Sim Mode (Default)

- **Purpose:** Safe testing without real transactions
- **Configuration:**
  ```bash
  EXECUTION_MODE=sim
  ```
- **Behavior:**
  - All executions return `simulatedTxId`
  - No on-chain transactions
  - Portfolio updates are in-memory only
  - Safe for unlimited testing

### Eth Testnet Mode

- **Purpose:** Real transactions on Sepolia testnet
- **Configuration:**
  ```bash
  EXECUTION_MODE=eth_testnet
  EXECUTION_AUTH_MODE=direct  # or 'session'
  ```
- **Behavior:**
  - Swaps execute on-chain (real transactions)
  - DeFi/Perp/Event still mocked (return `simulatedTxId`)
  - Portfolio updates reflect real wallet state

---

## Session Limits

### Session Creation

- **Max Spend:** 10 ETH per session
- **Expiry:** 7 days from creation
- **Allowed Adapters:** UniswapV3, WethWrap, Mock (only)
- **Max Actions per Plan:** 4 actions
- **Max Value per Plan:** 1 ETH

### Session Scope

- **Chain:** Sepolia only
- **Tokens:** WETH, USDC only
- **Max Amount per Swap:** 1 ETH worth
- **Deadline:** Max 10 minutes from now

---

## Server-Side Guards

All limits are enforced in `/api/execute/relayed`:

### Guard 1: Action Count

```typescript
if (plan.actions.length > 4) {
  return res.status(400).json({
    error: `Plan exceeds maximum action count (4). Got ${plan.actions.length} actions.`,
  });
}
```

### Guard 2: Allowed Adapters

```typescript
const allowedAdapters = new Set([
  UNISWAP_V3_ADAPTER_ADDRESS,
  WETH_WRAP_ADAPTER_ADDRESS,
  MOCK_SWAP_ADAPTER_ADDRESS,
]);
```

### Guard 3: Deadline

```typescript
const maxDeadline = now + 10 * 60; // 10 minutes
if (deadline > maxDeadline) {
  return res.status(400).json({
    error: `Plan deadline too far in future. Maximum: ${maxDeadline} (10 minutes)`,
  });
}
```

### Guard 4: Token Allowlist

```typescript
const allowedTokens = new Set([
  WETH_ADDRESS_SEPOLIA,
  USDC_ADDRESS_SEPOLIA,
]);
```

### Guard 5: Max Amount per Swap

```typescript
const maxAmountIn = BigInt(parseUnits('1', 18)); // 1 ETH max
if (amountIn > maxAmountIn) {
  return res.status(400).json({
    error: `Swap amountIn exceeds maximum (1 ETH)`,
  });
}
```

### Guard 6: Max Value per Plan

```typescript
const maxValue = BigInt(parseUnits('1', 18)); // 1 ETH max
if (planValue > maxValue) {
  return res.status(400).json({
    error: `Plan value exceeds maximum (1 ETH)`,
  });
}
```

---

## Failure Handling

### Insufficient Balance

- **Detection:** Backend checks wallet balance before execution
- **Response:** `400` with error: `INSUFFICIENT_BALANCE`
- **UI:** Shows clear error message, no portfolio update

### Session Expired

- **Detection:** Backend checks session expiry before relay
- **Response:** `400` with error: `SESSION_EXPIRED`
- **UI:** Prompts user to create new session

### Relayer Failure

- **Detection:** Transaction submission fails
- **Response:** `500` with error: `RELAYER_FAILED`
- **UI:** Shows error, allows retry or direct mode

### Slippage Failure

- **Detection:** Swap execution reverts on-chain
- **Response:** Transaction receipt shows `status === 'reverted'`
- **UI:** Shows error, portfolio unchanged

### LLM Refusal

- **Detection:** `modelOk === false` in chat response
- **Response:** `executionRequest: null`, `actions: []`
- **UI:** Shows: "I couldn't generate a valid execution plan"

---

## Debug Mode

### Execution Artifacts

Enable debug logging:

```bash
DEBUG_EXECUTIONS=1
```

This logs:
- `executionRequest`
- `plan`
- `executionResult`

Artifacts stored in-memory (last 100 executions).

### Dump Artifacts

```bash
curl http://localhost:3001/api/debug/executions
```

Returns JSON array of execution artifacts.

---

## Configuration Summary

| Setting | Value | Enforced |
|---------|-------|----------|
| Max actions per plan | 4 | ✅ Server-side |
| Max ETH per execution | 1 ETH | ✅ Server-side |
| Max session spend | 10 ETH | ✅ On-chain |
| Session expiry | 7 days | ✅ On-chain |
| Deadline max | 10 minutes | ✅ Server-side |
| Allowed adapters | Uniswap, WethWrap, Mock | ✅ Server-side |
| Allowed tokens | WETH, USDC | ✅ Server-side |

---

## Whitelist Testing Checklist

- [ ] Sim mode tested (all execution types)
- [ ] Eth testnet mode tested (swap only)
- [ ] Session creation tested
- [ ] Relayed execution tested
- [ ] All failure cases tested
- [ ] Server-side guards verified
- [ ] Debug artifacts working
- [ ] Portfolio updates correct
- [ ] No partial state mutations

---

## Safety Guarantees

✅ **No silent failures:** All errors return explicit error messages  
✅ **No partial updates:** Portfolio only updates on successful execution  
✅ **Server-side validation:** All limits enforced before execution  
✅ **Session scoping:** Limited to safe adapters and tokens  
✅ **Amount caps:** Max 1 ETH per execution prevents large losses  

**MVP A is safe for whitelist testing when all checks pass.**


