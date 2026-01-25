# Strategy Drawer Architecture

## State Structure

### Open Strategies
All open strategies are stored in `BlossomContext`:

1. **Perp Strategies**: Counted as open when:
   - `instrumentType === 'perp'`
   - `status === 'executed' || status === 'executing'`
   - `isClosed === false`
   - Fields: `market`, `side`, `notionalUsd`, `riskPercent`, `entry`, `takeProfit`, `stopLoss`, `realizedPnlUsd`, `realizedPnlPct`

2. **DeFi Positions**: Counted as active when:
   - `status === 'active'`
   - Fields: `protocol`, `asset`, `depositUsd`, `apyPct`

3. **Event Positions**: Counted as open when:
   - `instrumentType === 'event'`
   - `status === 'executed' || status === 'executing'`
   - `isClosed === false`
   - Fields: `eventLabel`, `eventSide`, `stakeUsd`, `maxPayoutUsd`, `maxLossUsd`, `riskPercent`

### Position Counting Helpers

**Location**: `src/context/BlossomContext.tsx`

Shared helper functions ensure consistent counting across the app:

```typescript
// Individual position type checkers
isOpenPerp(strategy: Strategy): boolean
isOpenEvent(strategy: Strategy): boolean
isActiveDefi(position: DefiPosition): boolean

// Total count helper
getOpenPositionsCount(strategies: Strategy[], defiPositions: DefiPosition[]): number
```

**Usage**: Both `RightPanel.tsx` (Positions button badge) and `StrategyDrawer.tsx` (header count) use `getOpenPositionsCount()` as the single source of truth.

**Examples**:
- 1 executed perp, 1 active DeFi, 1 draft event → `openPositionsCount = 2`
- 1 closed perp, 0 others → `openPositionsCount = 0`
- 1 executed perp, 1 executing event, 1 active DeFi → `openPositionsCount = 3`

**Excluded from count**:
- Draft strategies (`status === 'draft'`)
- Queued strategies (`status === 'queued'`)
- Closed positions (`isClosed === true`)
- Proposed DeFi plans (`status === 'proposed'`)

### Actions Available

**Perps:**
- `closeStrategy(id)` - Close position
- `updateStrategy(id, updates)` - Edit TP/SL, size, leverage
- `setSelectedStrategyId(id)` - Select for detail view

**DeFi:**
- `updateDeFiPlanDeposit(id, newDepositUsd)` - Edit deposit
- Close via removing from defiPositions (need to check if there's a close function)

**Events:**
- `closeEventStrategy(id)` - Close position
- `updateEventStake(id, updates)` - Edit stake

## Component Structure

### StrategyDrawer.tsx (Primary Positions UI)
- **Role**: Primary surface for viewing and managing all open positions
- **Location**: Slide-over panel from right side
- **Title**: "Open positions (N)" where N is the count of active positions
- **Tabs**: All | Perps | DeFi | Events
- **Each strategy row shows**:
  - Key metrics (market, side, size/stake, risk %)
  - PnL (for perps) or implied payoff (for events)
  - "View Details" button → Opens Contextual Panel and closes drawer
  - "Close" button → Closes the position
- **Empty State**: Shows helpful message with example prompts and "Insert a starter prompt" button
- **Auto-open**: Opens automatically when first position is created (0 → 1 transition)

### Integration Points
- **"Positions" button** in RightPanel (below wallet card)
  - Shows count badge of active positions
  - Opens Strategy Drawer
- **Chat strategy cards**: "View in Positions" link
  - Opens drawer and highlights the strategy
  - Scrolls to highlighted strategy
- Uses `useBlossomContext()` to read all state
- Uses existing action functions from context
- Highlight strategy via `highlightedStrategyId` prop and scrolls to it

## User Flows

### Chat → Drawer → Details Path

1. **Chat Strategy Card**:
   - User sees strategy card in chat message
   - Clicks "View in Positions" link (for draft strategies)
   - Drawer opens with strategy highlighted

2. **Strategy Drawer** (Primary Positions Surface - Self-Contained):
   - **Role**: Primary surface for viewing and editing all open positions
   - **Self-contained**: All editing happens within the drawer; no navigation to other panels
   - **Inline Quick Controls**: Each card has compact inline editors for common edits:
     - **Perp cards**: 
       - Size input + Update button (calculates risk % automatically)
       - Leverage slider (1-20x range) with tick marks at 1x, 3x, 5x, 10x, 15x, 20x
         - Auto-updates on slider release (no separate Update button)
         - Pink thumb matches Blossom accent color
         - Numeric readout shows current value
       - Take Profit row: single input + Update button + caption ("Above entry" / "Below entry")
       - Stop Loss row: single input + Update button + caption ("Below entry" / "Above entry")
       - All controls use the same validation and feedback pattern
     - **Event cards**: Stake input + Update button (calculates risk % and max payout)
     - **DeFi cards**: Deposit input + Max button + Update button
   - **Close button**: Separate, explicit button to close position/plan
   - Controls use `stopPropagation()` to prevent triggering card click
   - Enter key in input fields triggers update
   - Visual feedback: Update button shows "✓" for 1.5s after successful update
   - **Card click**: Currently does nothing special (visual hover only); all editing via inline controls
   - Updates propagate immediately to:
     - Drawer cards (visual update)
     - Portfolio top bar / account summary
     - Strategy cards in chat (if visible)

3. **Contextual Panel** (Primary Control Surface):
   - Shows detailed view of selected strategy
   - **All editing controls live here**:
     - Perps: TP/SL, leverage, size, close
     - Events: stake (with override), close
     - DeFi: deposit, close/stop plan
   - User can close position
   - **Visual feedback**: When opened from drawer, the summary card briefly highlights to draw attention

### Self-Contained Design

**Philosophy**: The Strategy Drawer is the primary editing surface. Users should not be navigated to a second panel when editing positions.

**No External Navigation**:
- Drawer does not dispatch `blossom:openPositionControls` or any other navigation events
- Card clicks do not trigger navigation to Contextual Panel
- All editing happens via inline controls within the drawer
- Updates propagate through shared state (BlossomContext) to all UI surfaces

**Right Panel in Copilot**:
- Shows only Wallet card + Positions button
- No ContextualPanel rendered in Copilot view
- Clicking Positions opens the drawer for both viewing and editing

## Quick Update Helpers

The drawer uses shared helper functions from `BlossomContext` to ensure consistency across the UI:

### `updatePerpSizeById(id: string, newSizeUsd: number)`
- Calculates risk % from new size and account value
- Updates `notionalUsd` and `riskPercent` via `updateStrategy()`
- Automatically recomputes account state

### `updatePerpTpSlById(id: string, newTakeProfit: number, newStopLoss: number)`
- Updates take profit and stop loss for a perp position
- Validates TP/SL make sense for the position side:
  - Long: TP > entry, SL < entry
  - Short: TP < entry, SL > entry
- Validates positive values
- Updates `takeProfit` and `stopLoss` via `updateStrategy()`

### `updatePerpLeverageById(id: string, newLeverage: number)`
- **Leverage is authoritative**: Stores `strategy.leverage` as the single source of truth
- Clamps leverage to 1-20 for UI consistency (helper accepts up to 100x for flexibility)
- Calculates new TP/SL based on leverage formula: `spread = (entry * clampedLeverage) / 10`
- For Long: `TP = entry + spread/2`, `SL = entry - spread/2`
- For Short: `TP = entry - spread/2`, `SL = entry + spread/2`
- Updates `leverage`, `takeProfit`, and `stopLoss` via `updateStrategy()`
- **Slider sync**: The Strategy Drawer slider always reflects `strategy.leverage` (or falls back to calculating from TP/SL for legacy positions)

### `updateEventStakeById(id: string, newStakeUsd: number)`
- Calculates risk % from new stake and account value
- Preserves payout ratio (maintains original stake:maxPayout ratio)
- Updates `stakeUsd`, `maxPayoutUsd`, `maxLossUsd`, and `riskPercent` via `updateEventStake()`
- Sets `overrideRiskCap: true` for explicit modifications
- Automatically recomputes account state

### `updateEventSideById(id: string, newSide: 'YES' | 'NO')`
- Updates the event side (YES/NO) for an event position
- Validates newSide is 'YES' or 'NO'
- Keeps stake, eventKey, eventLabel, and other fields unchanged
- Risk % and max payout remain the same (they're based on stake, not side)
- Updates `eventSide` via `updateEventStake()`

### `updateDeFiDepositById(id: string, newDepositUsd: number)`
- Alias for `updateDeFiPlanDeposit()`
- Handles balance transfers between REDACTED and DEFI
- Validates sufficient balances before applying changes
- Zero-sum reallocation (account value unchanged)

**Location**: `src/context/BlossomContext.tsx` (defined after `updateDeFiPlanDeposit`)

**Usage**: All drawer inline controls call these helpers, ensuring updates propagate to:
- Strategy Drawer cards (immediate visual update)
- Contextual Panel summary cards
- Chat strategy cards
- Portfolio top bar / account summary

### Leverage Slider Tick Marks

The leverage slider uses **discrete ticks**: `LEVERAGE_TICKS = [1, 3, 5, 10, 15, 20]`.

**Rationale**: These anchor points represent:
- **1x**: Conservative, no leverage
- **3x**: Low leverage, common for beginners
- **5x**: Moderate leverage
- **10x**: Higher leverage, common in DeFi perps
- **15x**: Aggressive leverage
- **20x**: Maximum UI range (helper accepts up to 100x)

**Visual Design**:
- Slider works on indices (0-5) mapping to the tick values
- Vertical tick lines along the slider track visually anchor each leverage level
- Muted text labels (1x, 3x, 5x, 10x, 15x, 20x) below the track
- Thumb always aligns with a tick line and label
- Tick lines use subtle styling (`bg-slate-300/60`) to match the Blossom aesthetic

## Copilot Integration

### Intent: `show_riskiest_positions`
- Parse user message for keywords: "riskiest", "highest risk", "reduce risk", ">5%", etc.
- Compute sorted list: `[...activePerps, ...activeEvents].sort((a, b) => b.riskPercent - a.riskPercent)`
- Generate chat response with summary
- **Opens Strategy Drawer** and highlights top strategy
- Drawer scrolls to highlighted strategy

## Summary

**Last Updated**: 2025-12-11

### Recent Changes

1. **Position Counting Logic**:
   - Created shared helper functions in `BlossomContext.tsx`:
     - `isOpenPerp()`, `isOpenEvent()`, `isActiveDefi()` - individual position type checkers
     - `getOpenPositionsCount()` - total count helper
   - Updated `RightPanel.tsx` and `StrategyDrawer.tsx` to use shared helpers
   - Ensures consistent counting: only truly open positions (executed/executing, not closed) are counted
   - Badge and header now reflect the same count

2. **Leverage Slider Enhancements**:
   - Added visual tick marks at 1x, 3x, 5x, 10x, 15x, 20x
   - Tick marks displayed as muted text labels below slider
   - Provides visual guidance for common leverage levels
   - Slider behavior unchanged (auto-updates on release, 1-20x range)

**Helper Functions Location**: `src/context/BlossomContext.tsx` (exported utility functions)

## Positions Tray Status

**Current Status**: Disabled/Hidden by default

The Positions Tray component is now behind a feature flag (`ENABLE_POSITIONS_TRAY = false`) in `PositionsTray.tsx`. 

**Rationale**: Strategy Drawer is now the primary positions UI. The tray was creating duplicate functionality and visual clutter.

**To re-enable** (if needed for testing):
1. Set `ENABLE_POSITIONS_TRAY = true` in `PositionsTray.tsx`
2. The tray will appear docked at bottom-right
3. Note: Auto-open behavior is still disabled in `CopilotLayout.tsx`

**What users see instead**:
- Right panel "Positions" button → Opens Strategy Drawer
- Strategy Drawer → Unified view of all positions (navigator + quick close)
- Contextual Panel → Detailed view of selected position (primary editing surface)

## UX Design Decisions

### Drawer as Navigator, Contextual Panel as Control Surface

**Strategy Drawer**:
- Purpose: Navigation and quick overview
- Actions: Click card to open controls, close position
- **No edit controls**: Drawer does not expose TP/SL, leverage, size, stake, or deposit editors
- Rationale: Keeps drawer lightweight and focused on navigation

**Contextual Panel**:
- Purpose: Primary editing and control surface
- Actions: All editing controls (TP/SL, leverage, size, stake, deposit, close)
- Rationale: Centralizes all "real editing" in one place for consistency

## RiskBadge Component

A reusable component (`src/components/RiskBadge.tsx`) provides consistent risk visualization across the app.

**Usage**:
- Strategy Drawer cards (Perps, Events)
- Contextual Panel summary cards (PositionSummaryCard, EventSummaryCard)
- Chat strategy cards (MessageBubble)

**Thresholds**:
- ≤ 2%: Low risk (green)
- > 2% and ≤ 5%: Medium risk (amber)
- > 5%: High risk (red)

**Implementation**: Renders as a small pill badge next to risk percentage for visual consistency.

