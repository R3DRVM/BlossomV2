# Contextual Panel Redesign - Implementation Summary

## Overview
Redesigned the right-side panel of the Blossom Copilot UI to show only one contextual panel at a time, based on user intent and current positions.

## Files Created

### 1. `src/components/EmptyStateCard.tsx`
**Purpose:** Shows placeholder when no positions are open

**Features:**
- Title: "No active positions"
- Body text explaining what will appear
- Optional quick action buttons:
  - Open a perp trade
  - Deposit into yield
  - Explore event markets

### 2. `src/components/PositionSummaryCard.tsx`
**Purpose:** Shows summary for perp trades (STATE 2)

**Fields Displayed:**
- Market (e.g., ETH-PERP)
- Side (Long/Short)
- Entry Price
- Size / Leverage (calculated)
- Risk %
- Take Profit / Stop Loss
- Liquidation Buffer
- Current PnL (Sim only) - calculated from simulated price movement

**Actions:**
- Edit TP/SL (placeholder - "Coming soon")
- Change leverage (placeholder)
- Adjust size (placeholder)
- Close position (functional - calls backend or mock)
- Ask Blossom: Optimize risk (selects strategy and focuses chat)

### 3. `src/components/DeFiSummaryCard.tsx`
**Purpose:** Shows summary for DeFi yield plans (STATE 3)

**Fields Displayed:**
- Protocol (Kamino, etc.)
- Asset (USDC Yield Vault, etc.)
- APY
- Deposit amount

**Actions (when proposed):**
- Edit deposit amount (placeholder)
- View risk info (placeholder)
- Execute plan (functional - calls `confirmDefiPlan()`)
- Cancel (placeholder)

**States:**
- Proposed: Shows action buttons
- Active: Shows "Position is active and earning yield" message

### 4. `src/components/ContextualPanel.tsx`
**Purpose:** Main controller that determines which panel to show

**State Logic:**
1. **STATE 1 - No positions:** Shows `EmptyStateCard`
2. **STATE 2 - Single perp trade:** Shows `PositionSummaryCard` for the active perp
3. **STATE 3 - Single DeFi plan:** Shows `DeFiSummaryCard` for the active/proposed DeFi position
4. **STATE 4 - Multiple position types:** Shows tabbed interface with:
   - Perps tab (with count)
   - DeFi tab (with count)
   - Events tab (with count)
   - Each tab shows the relevant summary card

**Position Selection Logic:**
- If `selectedStrategyId` is set, shows that strategy's summary
- Otherwise, shows the most recent active position of the current tab type
- Automatically switches tabs when multiple position types exist

**Event Summary:**
- Includes `EventSummaryCard` component (inline) for event market positions
- Shows market, side (YES/NO), stake, max payout, max loss, risk %
- Actions: Close & settle, Ask Blossom: Optimize risk

## Files Modified

### `src/components/CopilotLayout.tsx`
- Replaced `SidePanel` import with `ContextualPanel`
- Added `insertPromptRef` to allow quick actions from empty state to insert prompts into chat
- Passes `onQuickAction` handler to `ContextualPanel`

### `src/components/Chat.tsx`
- Added `onRegisterInsertPrompt` prop to expose `handleQuickPrompt` function
- Allows parent components to trigger prompt insertion

## State Management

The panel automatically updates when:
- New strategies are created (via `BlossomContext`)
- Strategies are executed/closed
- DeFi positions are created/confirmed
- `selectedStrategyId` changes

## Key Features

### 1. Reactive Updates
- Panel updates immediately when Blossom generates a new plan
- No manual refresh needed

### 2. Contextual Display
- Only shows relevant information for current state
- Removes clutter (old risk center, execution history, etc.)

### 3. Quick Actions
- Empty state buttons trigger chat prompts
- "Ask Blossom" buttons select strategy and focus chat

### 4. Tabbed Interface
- Only appears when multiple position types exist
- Shows counts for each type
- Smooth tab switching

## Removed Features

The following were removed from the old `SidePanel`:
- Full risk center metrics
- Detailed liquidation calculations
- Execution history queue
- Mock positions display
- DeFi aggregation "Coming Soon" section
- Multiple simultaneous cards showing different information

## Styling

All cards use:
- `card-glass` class for consistent glassmorphism styling
- Consistent spacing and typography
- Blossom color scheme (pink, slate, success, danger)
- Responsive layout (w-80 on lg, w-96 on xl)

## Testing Checklist

1. **Empty State:**
   - ✅ Shows placeholder card when no positions
   - ✅ Quick action buttons insert prompts into chat

2. **Single Perp Trade:**
   - ✅ Shows position summary with all fields
   - ✅ Close position button works
   - ✅ "Ask Blossom" selects strategy

3. **Single DeFi Plan:**
   - ✅ Shows DeFi summary when plan is proposed
   - ✅ Execute plan button works
   - ✅ Shows active state after execution

4. **Multiple Positions:**
   - ✅ Shows tabs when multiple position types exist
   - ✅ Tab switching updates displayed card
   - ✅ Counts show correct numbers

5. **Event Markets:**
   - ✅ Shows event summary card
   - ✅ Close & settle button works

## Future Enhancements

Placeholder actions marked "Coming soon":
- Edit TP/SL for perp positions
- Change leverage
- Adjust position size
- Edit DeFi deposit amount
- View DeFi risk info
- Cancel DeFi plan

These can be implemented later as needed.


