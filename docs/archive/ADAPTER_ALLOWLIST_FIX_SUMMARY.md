# Adapter Allowlist Fix Summary

## Root Cause

When `sessionActive=true`, executing perp plans (e.g., "Long BTC with 20x") failed with:
```
"Adapter 0x.... not allowed. Allowed adapters: ..."
```

**Root cause**: The backend's `/api/execute/relayed` endpoint only allowed 3 adapters:
- `UNISWAP_V3_ADAPTER_ADDRESS` (swaps)
- `WETH_WRAP_ADAPTER_ADDRESS` (wrapping)
- `MOCK_SWAP_ADAPTER_ADDRESS` (demo swaps)

But perp plans use `PROOF_ADAPTER_ADDRESS`, which was **not** in the allowlist, causing relayed execution to fail with HTTP 400.

## Files Changed

### 1. `agent/src/server/http.ts`

**Changes**:
- **Lines 2759-2803**: Extended adapter allowlist to include:
  - `PROOF_ADAPTER_ADDRESS` (for perps/events)
  - `ERC20_PULL_ADAPTER_ADDRESS` (for token pulls)
  - `DEMO_LEND_ADAPTER_ADDRESS` (for DeFi lending)
- **Lines 2778-2803**: Improved error reporting for adapter-not-allowed:
  - Returns structured error: `{ ok: false, error: { code: 'ADAPTER_NOT_ALLOWED', adapter, allowedAdapters }, correlationId }`
  - HTTP 400 with clear error code
- **Lines 2288-2299**: Extended `/api/execute/preflight` to return:
  - `allowedAdapters: string[]` - List of all allowlisted adapters
  - `executionRouterAddress: string | null` - Router address
  - `chainId: number` - Chain ID (11155111 for Sepolia)

### 2. `src/lib/executionKernel.ts`

**Changes**:
- **Lines 36-95**: Added `getExecutionCapabilities()` function:
  - Fetches capabilities from `/api/execute/preflight`
  - In-memory cache with 30s TTL
  - Returns `allowedAdapters`, `chainId`, `executionRouterAddress`
- **Lines 77-147**: Added **capabilities gate** in `executeViaRelayed()`:
  - After preparing plan, checks if all action adapters are in allowlist
  - If adapter not allowlisted → returns `mode: 'unsupported'` with `ADAPTER_NOT_ALLOWED` reason
  - **Prevents relayed execution attempt** when adapter is not allowlisted
- **Lines 162-190**: Improved error handling for relayed execution failures:
  - Parses structured error responses
  - Detects `ADAPTER_NOT_ALLOWED` error code
  - Returns appropriate `unsupported` mode with clear reason
- **Lines 435-465**: Extended `logExecutionDebug()` to include:
  - `adapterAddress: string | undefined`
  - `adapterAllowed: boolean | undefined`
  - Exposed in `window.__BLOSSOM_LAST_EXECUTION__` for dev debugging

### 3. No Changes to Quick Actions

**Reason**: The BTC quick action prompt ("Long BTC with 20x leverage using 2% risk") is just text that goes to the LLM. The LLM generates an `executionRequest` with `kind: 'perp'`, and the backend correctly uses `PROOF_ADAPTER_ADDRESS` (now allowlisted). No changes needed.

## How It Works

### Before Fix:
1. User executes "Long BTC with 20x" with session ON
2. Kernel chooses `relayed` mode
3. Calls `/api/execute/prepare` → gets plan with `PROOF_ADAPTER_ADDRESS`
4. Calls `/api/execute/relayed` → **HTTP 400**: "Adapter not allowed"
5. UI shows generic error

### After Fix:
1. User executes "Long BTC with 20x" with session ON
2. Kernel chooses `relayed` mode
3. Calls `/api/execute/prepare` → gets plan with `PROOF_ADAPTER_ADDRESS`
4. **Capabilities gate**: Checks if `PROOF_ADAPTER_ADDRESS` is in allowlist
5. ✅ Adapter is allowlisted → proceeds to relayed execution
6. OR ❌ Adapter not allowlisted → returns `unsupported` mode immediately (no relayed attempt)
7. UI shows truthful "Not supported" message with reason

## Manual Test Script

### Test 1: Session ON + BTC Quick Action → Should Execute Relayed
1. Enable one-click execution (session ON)
2. Click quick action: "Long BTC with 20x leverage using 2% risk"
3. Click "Confirm & Execute"
4. **Expected**: 
   - ✅ NO wallet popup
   - ✅ Execution succeeds with txHash
   - ✅ Console shows `chosenMode: "relayed"`, `adapterAllowed: true`
   - ✅ `window.__BLOSSOM_LAST_EXECUTION__` shows adapter info

### Test 2: Session ON + Unsupported Adapter → Should Show "Not Supported"
1. (This test requires a plan with an unsupported adapter - would need backend to generate one)
2. **Expected**:
   - ✅ NO relayed execution attempt
   - ✅ Returns `mode: "unsupported"` with `ADAPTER_NOT_ALLOWED` reason
   - ✅ UI shows "⚠️ Not supported: ADAPTER_NOT_ALLOWED..."
   - ✅ Strategy remains in draft/pending (NOT executed)
   - ✅ Console shows `adapterAllowed: false`

### Test 3: Session ON + Swap → Should Execute Relayed
1. Enable one-click execution
2. Send: "Swap 0.01 ETH to WETH"
3. Click "Confirm & Execute"
4. **Expected**:
   - ✅ NO wallet popup
   - ✅ Execution succeeds with txHash
   - ✅ Uses `UNISWAP_V3_ADAPTER_ADDRESS` (allowlisted)

### Test 4: Dev Logging
1. Execute any plan with session ON
2. Open browser console
3. Type: `window.__BLOSSOM_LAST_EXECUTION__`
4. **Expected**: Object includes:
   - `adapterAddress`: string (if available)
   - `adapterAllowed`: boolean (if checked)
   - `chosenMode`: "relayed"
   - `sessionActive`: true

## Verification Checklist

- [ ] Session ON + BTC quick action → executes relayed with txHash
- [ ] Session ON + swap → executes relayed with txHash
- [ ] Session ON + unsupported adapter → shows "Not supported", no relayed attempt
- [ ] Console shows adapter info in `__BLOSSOM_LAST_EXECUTION__`
- [ ] Backend returns structured error for adapter-not-allowed
- [ ] Preflight endpoint returns `allowedAdapters` array
- [ ] Capabilities cache works (30s TTL)

## Summary

✅ **Root cause fixed**: `PROOF_ADAPTER_ADDRESS` added to allowlist
✅ **Capabilities gate added**: Kernel checks adapter before relayed execution
✅ **Error reporting hardened**: Structured errors with error codes
✅ **Dev logging enhanced**: Adapter info in debug object
✅ **Truthful UI maintained**: Only shows "Executed" if txHash exists

The execution kernel now prevents relayed execution attempts when adapters are not allowlisted, returning `unsupported` mode immediately with a clear reason. This keeps the UI truthful and prevents unnecessary backend calls.
