# UI Inventory & UX Walkthrough

**Last Updated**: 2025-12-11

This document provides a comprehensive overview of the Blossom Copilot UI surfaces, interactions, and user flows. It's intended for developers joining the project who need to quickly understand the current state of the application.

---

## UI Surfaces

### 1. Top Navigation / Mode Toggles

**Location**: `src/components/Header.tsx`

- **Mode Tabs**: 
  - **Copilot**: Main chat-based trading interface (default)
  - **Risk Center**: Risk analysis and portfolio risk metrics
  - **Portfolio Overview**: High-level portfolio visualization
- **Venue Toggle**: "Simulation • On-chain" indicator (currently shows simulation mode)
- **Reset SIM**: Button to reset the simulation state (clears all positions, resets account)

### 2. Left Sidebar

**Location**: `src/components/LeftSidebar.tsx`

- **Chat Sessions List**: 
  - Shows all chat sessions with titles
  - Active chat highlighted
  - Click to switch between sessions
  - "+ New Chat" button to create new session
- **Reset SIM**: Quick access to reset simulation

### 3. Copilot Main Area

**Location**: `src/components/CopilotLayout.tsx` (main container), `src/components/Chat.tsx` (chat interface)

#### 3.1. Chat Interface

- **Message Bubbles**:
  - User messages (right-aligned, white background)
  - Blossom responses (left-aligned, pink-tinted background)
  - Timestamps for each message
- **Strategy Cards** (rendered in chat):
  - **Perp Strategy Cards**: Market, side (Long/Short), size, risk %, entry, TP/SL, leverage
    - "Confirm & Queue" button (primary action)
    - "View in Positions" link (opens Strategy Drawer)
    - RiskBadge component showing Low/Medium/High risk
  - **Event Strategy Cards**: Event label, side (YES/NO), stake, risk %, max payout
    - "Confirm & Queue" button
    - "View in Positions" link
    - RiskBadge component
  - **DeFi Plan Cards**: Protocol, asset, deposit, APY
    - "Confirm & Queue" button
    - "View in Positions" link
- **Input Area**:
  - Textarea for user input
  - Send button
  - Typing indicator when Blossom is "thinking"
- **Quick Start Panel** (collapsible):
  - Starter prompts (chips/buttons)
  - "Saved" section with saved prompt templates
  - Star icon to save prompts to localStorage (`blossom.savedPrompts`)

#### 3.2. Quick Start Panel

**Location**: `src/components/QuickStartPanel.tsx`

- **Starter Prompts**: Pre-defined prompt chips (e.g., "Long ETH with 2% risk")
- **Saved Prompts**: User-saved prompt templates from localStorage
  - Click to insert into chat input
  - Star icon to save/unsave prompts
- **Collapsible**: Can be expanded/collapsed

### 4. Right Panel / Wallet (Copilot View)

**Location**: `src/components/RightPanel.tsx`

- **Wallet Card** (sticky at top):
  - Total account value (large display)
  - "Simulation • On-chain" indicator
  - Perp exposure amount
  - Total PnL percentage (color-coded: green/red)
  - Token holdings list (REDACTED, ETH, SOL, etc.)
  - Mini PnL/exposure preview
  - Action buttons: Fund, Send, Swap (currently placeholders)
- **Positions Button**: Below wallet card
  - Shows count badge of open positions (only executed/executing, not closed)
  - Badge uses shared `getOpenPositionsCount()` helper for consistency
  - Opens Strategy Drawer (slide-over from right)
  - Listens for `openStrategyDrawer` custom event from Chat
  - Badge shows 0 or is hidden when no open positions
- **Note**: In Copilot view, the right panel shows only Wallet + Positions button. No ContextualPanel is rendered here. The Strategy Drawer is the primary surface for viewing and editing positions.

### 5. Strategy Drawer (Primary Positions Surface)

**Location**: `src/components/StrategyDrawer.tsx`

**Role**: Self-contained primary surface for viewing and editing all open positions.

#### 5.1. Header

- **Title**: "Open positions (N)" where N is the count of truly open positions (uses shared `getOpenPositionsCount()` helper)
- **Close Button**: X button to close the drawer
- **Auto-open behavior**: 
  - Opens automatically when number of active positions goes from 0 → 1
  - Opens when `show_riskiest_positions` intent is triggered

#### 5.2. Tabs

Filter by strategy type:
- **All**: Shows all active strategies (perps + events + DeFi)
- **Perps**: Only perp positions
- **DeFi**: Only active DeFi plans
- **Events**: Only event positions
- Each tab shows count badge

#### 5.3. Strategy Cards

List of active positions with inline quick controls:

##### Perp Cards

- **Header**: Market, side badge (Long/Short), size, risk %, PnL (USD + %)
- **Inline Controls**:
  - **Size**: Numeric input + Update button (calculates risk % automatically)
  - **Leverage**: Discrete slider (1-20x range) with tick marks at 1x, 3x, 5x, 10x, 15x, 20x
    - Works on indices (0-5) mapping to tick values
    - Vertical tick lines along the track visually anchor each leverage level
    - Auto-updates on slider release (no Update button)
    - Pink thumb, numeric readout shows current value
    - Thumb always aligns with a tick line and label
  - **Take Profit**: Single input + Update button + caption ("Above entry" / "Below entry")
  - **Stop Loss**: Single input + Update button + caption ("Below entry" / "Above entry")
- **RiskBadge**: Shows Low/Medium/High risk next to risk percentage
- **Close Button**: Closes the position

##### Event Cards

- **Header**: Event label, side badge (YES/NO), stake, risk %, max payout, implied payoff
- **Inline Controls**:
  - **Side Toggle**: Two pill buttons (YES/NO) to flip the event side
    - Active side uses green (YES) or red (NO) pill style matching chat cards
    - Inactive side is light/outlined
    - Updates `eventSide` via `updateEventSideById()`
    - Keeps stake unchanged
  - **Stake**: Numeric input + Update button (adjusts stake, recalculates risk %)
- **RiskBadge**: Shows Low/Medium/High risk next to risk percentage
- **Close Button**: Closes the position

##### DeFi Cards

- **Header**: Protocol, asset badge, deposit, APY, daily yield estimate
- **Inline Controls**:
  - **Deposit**: Numeric input + Max button + Update button
    - Max button sets deposit to available REDACTED balance
    - Updates deposit via `updateDeFiDepositById()`
- **Close Button**: Closes/withdraws from the plan

#### 5.4. Empty State

When no positions are open:
- **Title**: "No open positions yet"
- **Subtitle**: "Start by asking me to open a trade, for example:"
  - "Long ETH with 2% risk"
  - "Park my idle REDACTED in yield"
  - "Bet 500 on the US election"
- **Button**: "Insert a starter prompt" (inserts "Long ETH with 2% risk" into chat input)

#### 5.5. Behavior

- **Self-contained**: All editing happens within the drawer; no navigation to other panels
- **Controls use `stopPropagation()`**: Prevents triggering card click events
- **Enter key**: Triggers update in input fields
- **Visual feedback**: Update buttons show "✓" for 1.5s after successful update
- **Highlighted strategy**: When opened via `show_riskiest_positions`, the riskiest strategy is highlighted with pink border/background

### 6. Positions Tray

**Location**: `src/components/PositionsTray.tsx`

**Status**: Currently disabled/hidden in the main UX flow.

- **Purpose**: Was previously used as a mini positions panel
- **Current state**: Not auto-opened, UI entry point hidden (or behind `ENABLE_POSITIONS_TRAY` flag set to `false`)
- **Note**: Strategy Drawer is now the primary positions surface. Positions Tray may still exist in code but is not part of the normal user flow.

### 7. Risk Center

**Location**: `src/components/RiskCenter.tsx`

- **Risk Metrics**: 
  - Total portfolio risk
  - Per-position risk breakdown
  - Risk distribution charts
- **Risk Alerts**: Warnings for high-risk positions
- **Risk Reduction Suggestions**: Recommendations for reducing exposure

### 8. Portfolio Overview

**Location**: `src/components/PortfolioView.tsx`

- **High-level Portfolio Metrics**:
  - Total account value
  - PnL summary
  - Asset allocation
  - Position distribution
- **Visualizations**: Charts and graphs showing portfolio composition

---

## Interactive Elements by Area

### Top Navigation

- **Mode Tabs**: Click to switch between Copilot / Risk Center / Portfolio Overview
- **Venue Toggle**: Currently informational only (shows "Simulation")
- **Reset SIM**: Click to clear all positions and reset account to initial state

### Left Sidebar

- **Chat Session**: Click to switch active chat
- **+ New Chat**: Creates new chat session
- **Reset SIM**: Quick access to reset

### Chat Interface

- **Input Textarea**: Type message and press Enter or click Send
- **Send Button**: Submits message to Blossom
- **Strategy Card "Confirm & Queue"**: 
  - Creates draft strategy
  - Queues for execution
  - Updates account state
- **Strategy Card "View in Positions"**: 
  - Opens Strategy Drawer
  - Highlights the strategy (if applicable)
- **Quick Start Chips**: Click to insert prompt into input
- **Saved Prompt Star**: Click to save/unsave prompt template

### Right Panel / Wallet

- **Positions Button**: 
  - Click to open Strategy Drawer
  - Badge shows count of open positions
- **Wallet Card**: 
  - Currently read-only (Fund/Send/Swap are placeholders)
  - Displays account summary

### Strategy Drawer

- **Tab Buttons**: Click to filter by strategy type (All/Perps/DeFi/Events)
- **Perp Card Controls**:
  - **Size Input**: Type new size, press Enter or click Update
  - **Leverage Slider**: Drag thumb to adjust leverage (snaps to ticks: 1x, 3x, 5x, 10x, 15x, 20x)
  - **TP Input**: Type new take profit, press Enter or click Update
  - **SL Input**: Type new stop loss, press Enter or click Update
  - **Close Button**: Closes the perp position
- **Event Card Controls**:
  - **Side Toggle**: Click YES or NO button to flip side
  - **Stake Input**: Type new stake, press Enter or click Update
  - **Close Button**: Closes the event position
- **DeFi Card Controls**:
  - **Deposit Input**: Type new deposit, press Enter or click Update
  - **Max Button**: Sets deposit to available REDACTED
  - **Close Button**: Closes/withdraws from DeFi plan
- **Backdrop**: Click outside drawer to close
- **Empty State "Insert a starter prompt"**: Inserts example prompt into chat input

---

## Strategy & Positions UX

### Opening a Position

#### Perp Trade

1. User sends message: "Long ETH with 2% risk"
2. Blossom parses intent and creates strategy card in chat
3. Strategy card shows: market, side, risk %, entry, TP/SL, leverage
4. User clicks "Confirm & Queue"
5. Strategy status transitions to "executed"
6. Position appears in:
   - Wallet summary (exposure updated)
   - Strategy Drawer (auto-opens if first position)
   - Portfolio view

#### Event Position

1. User sends message: "Take YES on Fed cuts in March with 2% risk"
2. Blossom creates event strategy card
3. User clicks "Confirm & Queue"
4. Event position becomes active
5. Appears in Strategy Drawer under Events tab

#### DeFi Plan

1. User sends message: "Park my idle REDACTED in yield"
2. Blossom creates DeFi plan card
3. User clicks "Confirm & Queue"
4. DeFi plan becomes active
5. Appears in Strategy Drawer under DeFi tab

### Editing a Position

#### Perp Position

**Via Strategy Drawer**:

1. Open Strategy Drawer (click Positions button)
2. Navigate to Perps tab (or All tab)
3. Find the perp card
4. **Change Size**:
   - Type new size in Size input
   - Click Update or press Enter
   - Risk % recalculates automatically
   - Updates propagate to all UI surfaces
5. **Adjust Leverage**:
   - Drag slider thumb to desired tick (1x, 3x, 5x, 10x, 15x, 20x)
   - Release mouse/touch to apply
   - TP/SL automatically recalculate based on leverage
   - Leverage value stored in `strategy.leverage`
6. **Update TP/SL**:
   - Type new TP value in Take Profit input
   - Click Update or press Enter
   - TP updates, SL stays unchanged
   - Leverage recalculates from new TP/SL spread (drawer snaps to nearest tick)
   - Same process for Stop Loss
7. **Close Position**:
   - Click Close button
   - Position removed, count decrements

**Via Chat** (natural language):

1. User sends: "Increase size to $500" or "Set leverage to 10x"
2. Blossom parses `modify_perp_strategy` intent
3. Updates the position via `updatePerpSizeById` or `updatePerpLeverageById`
4. Responds with confirmation message
5. Strategy Drawer reflects changes immediately

#### Event Position

**Via Strategy Drawer**:

1. Open Strategy Drawer
2. Navigate to Events tab
3. Find the event card
4. **Change Stake**:
   - Type new stake in Stake input
   - Click Update or press Enter
   - Risk % and max payout recalculate
5. **Flip Side**:
   - Click YES or NO button in side toggle
   - Side updates immediately
   - Stake, risk %, max payout remain unchanged
6. **Close Position**:
   - Click Close button
   - Position removed

**Via Chat**:

1. User sends: "Bump this to 1500" (referring to event stake)
2. Blossom parses `modify_event_strategy` intent
3. Updates stake via `updateEventStakeById`
4. Responds with confirmation (includes risk warning if > 3%)
5. Strategy Drawer reflects changes

#### DeFi Position

**Via Strategy Drawer**:

1. Open Strategy Drawer
2. Navigate to DeFi tab
3. Find the DeFi card
4. **Change Deposit**:
   - Type new deposit in Deposit input
   - Or click Max to use all available REDACTED
   - Click Update or press Enter
   - Balances update (REDACTED ↔ DEFI)
5. **Close Plan**:
   - Click Close button
   - Withdraws deposit, closes plan

### Position Counting

**Shared Helper**: `getOpenPositionsCount(strategies, defiPositions)` in `src/context/BlossomContext.tsx`

**What Counts as "Open"**:

- **Perps**: `instrumentType === 'perp' && (status === 'executed' || status === 'executing') && !isClosed`
- **Events**: `instrumentType === 'event' && (status === 'executed' || status === 'executing') && !isClosed`
- **DeFi**: `status === 'active'`

**What's Excluded**:
- Draft strategies (`status === 'draft'`)
- Queued strategies (`status === 'queued'`)
- Closed positions (`isClosed === true`)
- Proposed DeFi plans (`status === 'proposed'`)

**Usage**:
- **RightPanel.tsx**: Positions button badge
- **StrategyDrawer.tsx**: Header count "Open positions (N)"
- Both use the same helper, ensuring consistency

---

## Intent-Driven Interactions

### Natural Language Intents

**Location**: `src/lib/mockParser.ts`

#### `trade` Intent
- **Triggers**: "Long ETH", "Short BTC", "Buy SOL"
- **Action**: Creates perp strategy card in chat
- **Response**: Strategy card with market, side, risk %, entry, TP/SL, leverage

#### `modify_perp_strategy` Intent
- **Triggers**: "Increase size to $500", "Set leverage to 10x", "Update TP to 4000"
- **Action**: Updates existing perp position via `updatePerpSizeById`, `updatePerpLeverageById`, or `updatePerpTpSlById`
- **Response**: Confirmation message with updated values
- **Warning**: If risk % > 3%, includes warning: "⚠ This is above your usual 3% per-trade risk."

#### `modify_event_strategy` Intent
- **Triggers**: "Bump this to 1500", "Change stake to $200"
- **Action**: Updates event stake via `updateEventStakeById`
- **Response**: Confirmation with risk % and max loss
- **Warning**: If risk % > 3%, includes warning about drawdown

#### `show_riskiest_positions` Intent
- **Triggers**: "Show my riskiest positions", "Which trades are using more than 5%?"
- **Action**: 
  - Computes sorted list of positions by risk %
  - Generates chat summary
  - Opens Strategy Drawer
  - Highlights top riskiest strategy
  - Scrolls drawer to highlighted strategy

#### `defi_plan` Intent
- **Triggers**: "Park my idle REDACTED in yield", "Deposit in Aave"
- **Action**: Creates DeFi plan card in chat
- **Response**: DeFi plan card with protocol, asset, deposit, APY

---

## Reusable Components

### RiskBadge

**Location**: `src/components/RiskBadge.tsx`

**Props**:
- `riskPercent?: number | null`
- `className?: string`

**Behavior**:
- Renders `null` if `riskPercent` is missing, `NaN`, or `< 0`
- **Thresholds**:
  - `≤ 2%`: "Low risk" (green badge: `bg-emerald-50 text-emerald-600`)
  - `> 2% and ≤ 5%`: "Medium risk" (amber badge: `bg-amber-50 text-amber-600`)
  - `> 5%`: "High risk" (red badge: `bg-rose-50 text-rose-600`)

**Used in**:
- Strategy Drawer cards (PerpStrategyCard, EventStrategyCard)
- Contextual Panel summary cards (PositionSummaryCard, EventSummaryCard)
- Chat strategy cards (MessageBubble)

---

## Current Copilot UX Walkthrough (2025-12-11)

A concise snapshot of the current user journey:

1. **Start in Copilot** → User sends message: "Long ETH with 2% risk"
2. **Blossom proposes strategy** → Strategy card appears in chat with market, side, risk %, entry, TP/SL, leverage, RiskBadge
3. **User confirms** → Clicks "Confirm & Queue" button on strategy card
4. **Position becomes active** → Status transitions to "executed", position appears in:
   - Wallet summary (exposure updated)
   - Positions drawer (auto-opens if first position)
   - Portfolio view
5. **View/edit in Positions drawer** → Click "Positions" button in right panel:
   - Drawer opens showing "Open positions (N)" header
   - Perp card shows inline controls:
     - Size: input + Update (adjusts position size, recalculates risk %)
     - Leverage: discrete slider with tick marks (1x-20x, auto-updates on release)
       - Vertical tick lines visually anchor each leverage level
       - Thumb always aligns with tick line and label
     - Take Profit: input + Update + caption
     - Stop Loss: input + Update + caption
6. **Edit position** → User adjusts leverage via slider → TP/SL automatically recalculated
7. **Edit TP/SL directly** → User types new TP value → Updates only TP, keeps current SL, leverage recalculates and drawer snaps to nearest tick
8. **Close position** → Click "Close" button → Position removed, count decrements
9. **Event positions** → Same drawer pattern: side toggle (YES/NO), stake input + Update, inline editing
10. **DeFi positions** → Same drawer pattern: deposit input + Max + Update, inline editing
11. **Empty state** → When all positions closed, drawer shows "Open positions (0)" with helpful prompts
12. **Count consistency** → Badge on Positions button and drawer header always match (shared helper function)

**Key UX Principles**:
- Drawer is self-contained: all editing happens inline, no navigation to other panels
- Count reflects only truly open positions (executed/executing, not closed)
- Leverage slider provides visual guidance with discrete ticks and tick lines
- Each control (Size, Leverage, TP, SL) updates independently with immediate feedback
- Natural language modifications via chat work alongside drawer edits

---

## Current Limitations / TODOs

### Known Limitations

- **No keyboard shortcuts**: Drawer doesn't have keyboard shortcuts (e.g., Cmd+K to open)
- **Mobile responsiveness**: Drawer may need refinement for mobile screens
- **DeFi detail view**: No deep detail view for DeFi plans (just inline deposit edit)
- **Positions Tray**: Still exists in code but disabled/hidden (may be removed in future)
- **Contextual Panel**: Not rendered in Copilot view (only in Risk Center/Portfolio if used there)
- **Leverage range**: UI slider limited to 1-20x, but helper accepts up to 100x (for flexibility)
- **No animation polish**: Drawer open/close could use smoother transitions

### Potential Improvements

- Add keyboard shortcuts for common actions
- Improve mobile drawer UX (maybe bottom sheet on mobile)
- Add "Lock profits" action for perps
- Add reordering for saved prompts
- Add limit on number of saved prompts
- Add risk reduction suggestions in drawer (beyond just showing riskiest)
- Add keyboard navigation within drawer (arrow keys to move between cards)

---

## Technical Notes

### State Management

- **BlossomContext**: Single source of truth for all strategies, DeFi positions, account state
- **Shared Helpers**: `updatePerpSizeById`, `updatePerpTpSlById`, `updatePerpLeverageById`, `updateEventStakeById`, `updateEventSideById`, `updateDeFiDepositById`
- **Position Counting**: `getOpenPositionsCount()` ensures consistent counting across UI

### Event System

- **Custom Events**:
  - `openStrategyDrawer`: Dispatched from Chat to open drawer
  - `insertChatPrompt`: Dispatched from drawer empty state to insert prompt into chat input

### LocalStorage

- **Saved Prompts**: Stored under `blossom.savedPrompts` key
- **Chat Sessions**: Stored in localStorage for persistence

---

## File Locations

- **Main Layout**: `src/components/CopilotLayout.tsx`
- **Chat**: `src/components/Chat.tsx`
- **Strategy Drawer**: `src/components/StrategyDrawer.tsx`
- **Right Panel**: `src/components/RightPanel.tsx`
- **Quick Start**: `src/components/QuickStartPanel.tsx`
- **RiskBadge**: `src/components/RiskBadge.tsx`
- **Context**: `src/context/BlossomContext.tsx`
- **Parser**: `src/lib/mockParser.ts`
