# DeFi Panel Implementation Notes

## Current State Structure

### DefiPosition Interface
```typescript
interface DefiPosition {
  id: string;
  command: string;           // Original user command that created this plan
  protocol: string;          // 'Kamino', 'RootsFi', 'Jet'
  asset: string;            // 'REDACTED yield vault'
  depositUsd: number;       // Amount deposited/allocated
  apyPct: number;           // Annual percentage yield
  status: 'proposed' | 'active';
  createdAt: string;        // Timestamp
}
```

### State Management
- **Location**: `src/context/BlossomContext.tsx`
- **State variable**: `defiPositions: DefiPosition[]`
- **Creation**: `createDefiPlanFromCommand(command: string)` - called from Chat.tsx when user sends DeFi command
- **Confirmation**: `confirmDefiPlan(id: string)` - moves plan from 'proposed' to 'active', updates account balances

### Account Balance Updates
When a DeFi plan is confirmed:
1. Deducts `depositUsd` from REDACTED balance
2. Adds `depositUsd` to DEFI balance (or creates DEFI balance if it doesn't exist)
3. Recalculates total account value

### Right Panel Integration
- **Component**: `src/components/ContextualPanel.tsx`
- **Card Component**: `src/components/DeFiSummaryCard.tsx`
- **Current behavior**: Shows protocol, asset, APY, deposit amount
- **Tab selection**: DeFi tab shows most recent active or proposed DeFi position

## New Features Added

### 1. Edit Deposit Flow
- **Component**: `DeFiSummaryCard.tsx`
- **State**: Local React state for editing mode (`isEditingDeposit`, `editDepositValue`, `editError`)
- **Function**: `updateDeFiPlanDeposit(id: string, newDepositUsd: number)` in BlossomContext
- **Behavior**: 
  - Updates deposit amount in state
  - Recalculates account balances (adjusts REDACTED and DEFI balances based on deposit delta)
  - Only works for active positions (not proposed)
  - Validates: ≥ 0, ≤ account value, sufficient REDACTED for increases
  - Shows inline error messages for validation failures

### 2. Optimize Yield Quick Action
- **Component**: `DeFiSummaryCard.tsx`
- **Risk Preference Selector**: Three-option segmented control (Conservative, Balanced, Aggressive)
- **Default**: Balanced
- **Prompt Insertion**: Uses `onInsertPrompt` callback passed from ContextualPanel → CopilotLayout → Chat
- **Prompts**:
  - **Conservative**: "Optimize my DeFi yield prioritizing safety and blue-chip protocols, even if APY is lower."
  - **Balanced**: "Optimize my DeFi yield mixing safety and moderate risk to improve APY without extreme tail risk."
  - **Aggressive**: "Optimize my DeFi yield using more aggressive protocols. I'm comfortable taking on higher risk for higher APY. Show me a new plan and explain the trade-offs."

### 3. Context Updates
- **New function**: `updateDeFiPlanDeposit(id: string, newDepositUsd: number)`
- **Location**: `src/context/BlossomContext.tsx`
- **Behavior**: 
  - Finds position by ID
  - Only updates if status is 'active'
  - Calculates deposit delta (new - old)
  - Validates REDACTED balance for increases
  - Updates REDACTED balance: `balanceUsd - depositDelta`
  - Updates DEFI balance: `balanceUsd + depositDelta`
  - Recalculates total account value
  - Updates position deposit amount in state

### 4. Props & Handlers
- **DeFiSummaryCard props**:
  - `position: DefiPosition` (existing)
  - `onInsertPrompt?: (text: string) => void` (new - for quick actions)
- **ContextualPanel**: 
  - Receives `onInsertPrompt` prop from CopilotLayout
  - Passes it to DeFiSummaryCard in both tabbed and single-position states
- **CopilotLayout**: 
  - Provides `insertPromptRef` callback to Chat
  - Passes `onInsertPrompt` wrapper to ContextualPanel

### 5. UX Details
- **Edit Deposit**:
  - Inline form (not modal) with numeric input
  - Helper text: "This is simulated; no real deposits."
  - Save button disabled when value is invalid
  - Inline error messages (no toasts)
  - Cancel button to exit edit mode
- **Risk Preference**:
  - Segmented control with three options
  - Active state highlighted with pink background
  - Only shown when position is active or proposed
- **Empty State**: 
  - Already implemented in ContextualPanel
  - Shows "No DeFi positions yet. Ask Blossom to move idle REDACTED into yield."

