# ExecutionRouter Implementation Notes

## Action Type Handling

The ExecutionRouter now has special handling for three action types:

### SWAP Actions
- **Direct mode** (`execute()`): Router checks if it already holds `tokenIn` (from previous WRAP/PULL actions). If not, pulls from user. Then approves adapter and executes swap.
- **Session mode** (`executeWithSession()`): Same behavior - checks router balance first, only pulls if needed.

### WRAP Actions  
- **Direct mode**: Router forwards `msg.value` to adapter. Adapter wraps ETH → WETH.
- **Session mode**: Not supported (would require ETH in router).

### PULL Actions
- **Direct mode**: Router pulls tokens from user (using router's approval), then calls adapter for validation.
- **Session mode**: Same behavior - router pulls tokens, then calls adapter.

### Generic Actions
- All other action types go through generic adapter execution path.
- Router forwards 0 ETH by default (adapters can be payable for future ETH-requiring actions).

## Adapter Interface

All adapters implement `IAdapter.execute(bytes calldata data) external payable`:
- Most adapters ignore `msg.value` (ERC20 operations only)
- WRAP adapter receives ETH via `msg.value`
- Router forwards 0 ETH by default, except for WRAP actions

## Session Mode

Session execution unwraps action data from `(maxSpendUnits, innerData)` format before calling adapters. This allows spend-aware accounting while keeping adapter interfaces clean.

## Changes from Previous Implementation

1. **Added PULL action type** to `PlanTypes.ActionType` enum
2. **Added special handling** for PULL actions in both `execute()` and `executeWithSession()`
3. **Fixed `execute()` function** to include SWAP/WRAP/PULL special handling (previously only `executeBySender()` had this)
4. **Updated SWAP session execution** to check router balance before pulling tokens (enables PULL + SWAP composition)
