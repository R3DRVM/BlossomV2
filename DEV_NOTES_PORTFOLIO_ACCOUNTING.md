# Portfolio Accounting System

## Current State Structure

### AccountState Interface
```typescript
interface AccountState {
  accountValue: number;           // Total account value (sum of all balances + unrealized PnL)
  openPerpExposure: number;       // Total notional value of open perp positions
  eventExposureUsd: number;       // Total stake in event markets
  totalPnlPct: number;            // Total PnL percentage
  simulatedPnlPct30d: number;     // 30-day simulated PnL
  balances: AssetBalance[];       // Array of asset balances
}
```

### AssetBalance Interface
```typescript
interface AssetBalance {
  symbol: string;    // 'USDC', 'ETH', 'SOL', 'DEFI', etc.
  balanceUsd: number; // Balance in USD
}
```

### Initial Account State
- **Account Value**: $10,000
- **Balances**:
  - USDC: $4,000
  - ETH: $3,000
  - SOL: $3,000
  - DEFI: $0 (not present initially, added when first DeFi plan is confirmed)

## Top Bar Display

**Component**: `src/components/AccountSummaryStrip.tsx`

**Data Source**: `account` from `BlossomContext`

**Displayed Values**:
1. **Account Value**: `account.accountValue`
2. **Perp Exposure**: `account.openPerpExposure`
3. **Total PnL**: `account.totalPnlPct`
4. **Balances**: `account.balances.map(b => \`${b.symbol}: $${b.balanceUsd}\`)`

## Current Accounting Logic

### DeFi Plan Confirmation (`confirmDefiPlan`)
**Location**: `src/context/BlossomContext.tsx:540`

**Current Behavior**:
1. Subtracts `depositUsd` from USDC balance
2. Adds `depositUsd` to DEFI balance (or creates DEFI if it doesn't exist)
3. Recalculates `accountValue` as sum of all balances

**Issue**: The recalculation should preserve account value (zero-sum reallocation), but the current implementation may be double-counting or not properly handling the transfer.

### DeFi Deposit Update (`updateDeFiPlanDeposit`)
**Location**: `src/context/BlossomContext.tsx:592`

**Current Behavior**:
1. Calculates delta: `newDepositUsd - oldDepositUsd`
2. If delta > 0: subtracts from USDC, adds to DEFI
3. If delta < 0: subtracts from DEFI, adds to USDC
4. Recalculates `accountValue` as sum of all balances

**Issue**: Same as above - account value recalculation may not be preserving the zero-sum nature.

## Expected Behavior

### DeFi Deposit = Zero-Sum Reallocation
- **Account Value**: Should remain constant (it's just moving money between buckets)
- **USDC**: Decreases by deposit amount
- **DEFI**: Increases by deposit amount
- **Other balances**: Unchanged

### Account Value Calculation
The account value should be:
```
accountValue = sum(all balances) + unrealizedPnL
```

For DeFi deposits (which don't have unrealized PnL in the current sim):
```
accountValue = USDC + ETH + SOL + DEFI + ... (all balances)
```

Since we're just moving USDC → DEFI, the sum should remain constant.

## Fix Strategy

1. **Ensure accountValue is calculated correctly** - it should be the sum of all balances
2. **Verify DeFi deposit doesn't double-count** - when moving USDC → DEFI, the total should stay the same
3. **Add safeguards** - prevent overdrawing USDC or DEFI
4. **Document assumptions** - currently only one active DeFi plan is supported

## Implementation Details

### DeFi Plan Confirmation (`confirmDefiPlan`)
**Location**: `src/context/BlossomContext.tsx:540`

**Fixed Behavior**:
1. Validates sufficient USDC balance before proceeding
2. Subtracts `depositUsd` from USDC balance (with Math.max to prevent negatives)
3. Adds `depositUsd` to DEFI balance (or creates DEFI if it doesn't exist)
4. Recalculates `accountValue` as sum of all balances
5. **Result**: Zero-sum reallocation - account value stays constant

### DeFi Deposit Update (`updateDeFiPlanDeposit`)
**Location**: `src/context/BlossomContext.tsx:592`

**Fixed Behavior**:
1. Calculates delta: `newDepositUsd - oldDepositUsd`
2. Validates sufficient balances:
   - If delta > 0: checks USDC has enough
   - If delta < 0: checks DEFI has enough to refund
3. Applies delta:
   - If increasing: USDC decreases, DEFI increases
   - If decreasing: USDC increases (refund), DEFI decreases
4. Recalculates `accountValue` as sum of all balances
5. **Result**: Zero-sum reallocation - account value stays constant

### Key Safeguards
- **No overdrawing**: Uses `Math.max(0, balance - delta)` to prevent negative balances
- **Validation**: Checks sufficient balance before applying changes
- **Early returns**: Returns unchanged state if validation fails
- **Zero-sum guarantee**: Account value = sum of all balances, so moving between buckets keeps total constant

## Verification Steps

### Scenario 1: Fresh Account → Create and Activate DeFi Plan
**Initial State**:
- Account Value: $10,000
- USDC: $4,000
- ETH: $3,000
- SOL: $3,000
- DEFI: $0 (not present)

**Action**: Create and activate DeFi plan with deposit = $2,700

**Expected After Activation**:
- Account Value: $10,000 (unchanged - zero-sum reallocation)
- USDC: $1,300 ($4,000 - $2,700)
- ETH: $3,000 (unchanged)
- SOL: $3,000 (unchanged)
- DEFI: $2,700 (new balance created)

**Verification**: `$1,300 + $3,000 + $3,000 + $2,700 = $10,000` ✓

### Scenario 2: Increase DeFi Deposit
**Current State**:
- Account Value: $10,000
- USDC: $1,300
- DEFI: $2,700

**Action**: Edit deposit from $2,700 to $3,000 (increase by $300)

**Expected**:
- Account Value: $10,000 (unchanged)
- USDC: $1,000 ($1,300 - $300)
- DEFI: $3,000 ($2,700 + $300)

**Verification**: `$1,000 + $3,000 + $3,000 + $3,000 = $10,000` ✓

### Scenario 3: Decrease DeFi Deposit
**Current State**:
- Account Value: $10,000
- USDC: $1,000
- DEFI: $3,000

**Action**: Edit deposit from $3,000 to $1,500 (decrease by $1,500)

**Expected**:
- Account Value: $10,000 (unchanged)
- USDC: $2,500 ($1,000 + $1,500 refund)
- DEFI: $1,500 ($3,000 - $1,500)

**Verification**: `$2,500 + $3,000 + $3,000 + $1,500 = $10,000` ✓

## Portfolio State Location

**Primary State**: `src/context/BlossomContext.tsx`
- **State Variable**: `account: AccountState` (React state)
- **Initial Value**: `INITIAL_ACCOUNT` constant
- **Updates**: Via `setAccount()` calls in:
  - `confirmDefiPlan()` - when DeFi plan is activated
  - `updateDeFiPlanDeposit()` - when deposit is edited
  - `updateStrategyStatus()` - when perp/event strategies are executed
  - `applyExecutedStrategyToBalances()` - helper for perp strategies

**Display**: `src/components/AccountSummaryStrip.tsx`
- Reads `account` from `BlossomContext`
- Displays: Account Value, Perp Exposure, Total PnL, and all balances

## Assumptions

1. **Single Active DeFi Plan**: Currently only one active DeFi position is supported. Multiple active positions would require more complex accounting.

2. **Account Value = Sum of Balances**: In the current sim, account value is simply the sum of all balance buckets. No unrealized PnL is added for DeFi positions.

3. **Zero-Sum Reallocation**: DeFi deposits are treated as moving funds between buckets (USDC ↔ DEFI), not as creating new value.

4. **No Yield Accrual**: The sim doesn't currently accrue yield on DeFi positions. The DEFI balance represents the principal only.

5. **Balance Validation**: The system validates sufficient balance before allowing increases, but allows decreases even if it would result in zero DEFI balance (position can be fully withdrawn).

