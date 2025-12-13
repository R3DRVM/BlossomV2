# Risk Center & Portfolio Overview Architecture Breakdown

## 1. Risk Center

### A) Entry Points & Routes

**Route/Component:**
- **File:** `src/App.tsx` (lines 28-30)
- **Route:** Tab-based navigation (no URL routing)
- **Tab Navigation:** `src/components/TabNav.tsx` (lines 20-28)
  - Button: "Risk Center" → sets `activeTab` to `'risk'`
- **Page Container:** `src/components/RiskCenter.tsx` (line 388)
- **Layout Integration:** 
  - `src/App.tsx` conditionally renders `<RiskCenter />` when `activeTab === 'risk'`
  - Also available in `src/components/CopilotLayout.tsx` (lines 191-195) as a center view option

**Navigation Flow:**
```
TabNav.tsx (button click) 
  → setActiveTab('risk') 
  → App.tsx / CopilotLayout.tsx 
  → RiskCenter.tsx renders
```

### B) UI Composition

**Main Component:** `src/components/RiskCenter.tsx`

**Key Sub-Components:**

1. **`CollapsibleSection`** (lines 6-41, inline in RiskCenter.tsx)
   - **Purpose:** Reusable collapsible card wrapper
   - **Displays:** Title, subtitle, chevron icon
   - **Actions:** Toggle open/closed state

2. **`EditableRiskRulesSection`** (lines 43-203, inline in RiskCenter.tsx)
   - **Purpose:** Editable risk profile settings
   - **Displays:** 
     - Max per-trade risk %
     - Min liquidation buffer %
     - Funding alert threshold
     - Correlation hedge threshold
   - **Actions:** 
     - Edit mode toggle
     - Save/Cancel edits
     - Reset to defaults
   - **Data Source:** `riskProfile` from `BlossomContext`

3. **`LiquidationWatchlistSection`** (lines 205-386, inline in RiskCenter.tsx)
   - **Purpose:** Monitor liquidation buffers for positions
   - **Displays:** 
     - Table: Market, Side, Liq Buffer, Note
     - Auto-populated from executed strategies
     - Manual watchlist entries
   - **Actions:** 
     - Add asset to watchlist
     - Remove asset from watchlist
   - **Data Source:** `executedStrategies` + `manualWatchlist` from context

**Main Sections (in order):**

1. **Account Overview Card** (lines 567-592)
   - Account Value
   - Open Perp Exposure
   - Margin Used %
   - Available Margin %
   - Mode badge (SIM)

2. **Risk Metrics** (CollapsibleSection, lines 595-622)
   - Max Drawdown (30d) - from `mockRiskMetrics`
   - 24h VaR - from `mockRiskMetrics`
   - Volatility Regime - from `mockRiskMetrics`
   - Cross-Position Correlation - **calculated inline** (lines 446-452)

3. **Strategy Status** (CollapsibleSection, lines 625-661)
   - Active, Draft, Queued, Executing, Executed, Closed counts
   - **Calculated inline** from filtered strategies (lines 454-462)

4. **DeFi Exposure** (CollapsibleSection, lines 664-684)
   - Total DeFi deposits
   - Active DeFi positions count
   - Max single-protocol exposure
   - **Calculated inline** (lines 465-469)

5. **Event Markets Exposure** (CollapsibleSection, lines 687-707)
   - Total event stake
   - Open event positions count
   - Largest single event concentration %
   - **Calculated inline** (lines 430-445)

6. **Liquidation Watchlist** (LiquidationWatchlistSection, lines 710-715)
   - Table of monitored positions

7. **Recent Alerts** (lines 721-740)
   - **Data Source:** `mockAlerts` from `src/lib/mockData.ts`
   - Static mock data

8. **Event Alerts (Mock)** (lines 743-786)
   - Open event positions with risk status
   - **Calculated inline** from `openEventStrategies`

9. **Risk Rules** (EditableRiskRulesSection, lines 789-793)
   - Editable risk profile

10. **Agent Activity (Mock)** (CollapsibleSection, lines 796-825)
    - Mock agent actions
    - "Let Blossom lock in profits" button → calls `autoCloseProfitableStrategies()`

**Additional UI Elements:**
- **Strategy Filter Dropdown** (lines 526-554)
  - Filter metrics by specific strategy or "All strategies"
  - **State:** `strategyFilter` (line 392)
- **"What Changed" Banner** (lines 514-523)
  - Shows delta since last visit
  - **Data Source:** `lastRiskSnapshot` from context, compared to current `account`

### C) Data Dependencies & Calculations

**Data Sources:**
- `account: AccountState` from `BlossomContext`
- `strategies: Strategy[]` from `BlossomContext`
- `defiPositions: DefiPosition[]` from `BlossomContext`
- `riskProfile: RiskProfile` from `BlossomContext`
- `manualWatchlist: ManualWatchAsset[]` from `BlossomContext`
- `lastRiskSnapshot: RiskSnapshot | null` from `BlossomContext`
- `mockRiskMetrics` from `src/lib/mockData.ts` (static)
- `mockAlerts` from `src/lib/mockData.ts` (static)

**Calculations (all inline in RiskCenter.tsx):**

1. **Delta Calculation** (lines 394-418)
   - Compares current `account` to `lastRiskSnapshot`
   - Computes: `valueDelta`, `exposureDelta`, `pnlDelta`
   - Updates snapshot on mount

2. **Strategy Filtering** (lines 421-423)
   - Filters strategies by `strategyFilter` state

3. **Executed Strategies** (lines 426-428)
   - Filters: `status === 'executed' || status === 'executing'` AND `!isClosed`

4. **Event Metrics** (lines 430-445)
   - `totalEventStake`: sum of `stakeUsd` from open events
   - `numEventPositions`: count of open events
   - `largestEventStake`: max stake from open events
   - `eventConcentrationPct`: `(largestEventStake / accountValue) * 100`

5. **Correlation Calculation** (lines 446-452)
   - Groups strategies by `market-side` key
   - Counts max group size
   - Maps to: `maxGroupSize > 2` → 'High', `> 1` → 'Medium', else 'Low'

6. **Strategy Status Counts** (lines 454-462)
   - Counts by status: draft, queued, executing, executed, closed
   - `activeCount`: sum of draft + queued + executing

7. **DeFi Aggregates** (lines 465-469)
   - `activeDefiPositions`: filters `status === 'active'`
   - `totalDefiDeposits`: sum of `depositUsd`
   - `maxSingleProtocolExposure`: max `depositUsd` across positions

8. **Margin Calculations** (lines 490-491)
   - `marginUsed`: `(openPerpExposure / accountValue) * 100`
   - `availableMargin`: `100 - marginUsed`

**Helper Functions Used:**
- `isOpenPerp`, `isOpenEvent`, `isActiveDefi` from `src/context/BlossomContext.tsx` (exported, lines 234-256)
- `getOpenPositionsCount` from `src/context/BlossomContext.tsx` (exported, lines 257-264)

**Duplicated Calculations:**
- **Margin Used/Available:** Calculated in `RiskCenter.tsx` (line 490) and likely in `RightPanel.tsx` (not verified, but similar pattern)
- **DeFi Aggregates:** Similar logic in `PortfolioView.tsx` (lines 25-26) and `RiskCenter.tsx` (lines 465-469)
- **Event Exposure:** Similar logic in `PortfolioView.tsx` (line 29) and `RiskCenter.tsx` (lines 438-445)

### D) "What to Change for X"

**To add an exposure-by-asset chart:**
- **Files:** `src/components/RiskCenter.tsx`
- **Location:** Add new section after "Account Overview" (around line 593)
- **Data:** Reuse `exposureByAsset` calculation from `PortfolioView.tsx` (lines 43-65) or compute inline
- **Component:** Create new chart component or use existing sparkline pattern from PortfolioView

**To add risk alerts:**
- **Files:** `src/components/RiskCenter.tsx` (lines 721-740)
- **Location:** "Recent Alerts" section
- **Data:** Replace `mockAlerts` with computed alerts from:
  - `riskProfile` thresholds
  - `account` metrics (margin, drawdown)
  - `strategies` (correlation, liquidation buffers)
- **Helper:** Create `computeRiskAlerts(account, strategies, riskProfile)` function

**To add action buttons like hedge/reduce/close %:**
- **Files:** `src/components/RiskCenter.tsx`
- **Location:** Add to "Account Overview" card or new "Quick Actions" section
- **Actions:** 
  - `hedge()` → create opposite position via context
  - `reduceExposure(percent)` → call `updatePerpSizeById` for all positions
  - `closePercent(percent)` → close positions proportionally
- **Context Helpers:** Use existing `updatePerpSizeById`, `closeStrategy`, or add new helpers

---

## 2. Portfolio Overview

### A) Entry Points & Routes

**Route/Component:**
- **File:** `src/App.tsx` (lines 31-33)
- **Route:** Tab-based navigation (no URL routing)
- **Tab Navigation:** `src/components/TabNav.tsx` (lines 29-38)
  - Button: "Portfolio" → sets `activeTab` to `'portfolio'`
- **Page Container:** `src/components/PortfolioView.tsx` (line 4)
- **Layout Integration:**
  - `src/App.tsx` conditionally renders `<PortfolioView />` when `activeTab === 'portfolio'`
  - Also available in `src/components/CopilotLayout.tsx` (lines 197-201) as a center view option

**Navigation Flow:**
```
TabNav.tsx (button click) 
  → setActiveTab('portfolio') 
  → App.tsx / CopilotLayout.tsx 
  → PortfolioView.tsx renders
```

### B) UI Composition

**Main Component:** `src/components/PortfolioView.tsx`

**Key Sections (in order):**

1. **Account Performance Card** (lines 134-166)
   - Total PnL (All Time) - from `account.totalPnlPct`
   - 30d PnL - from `account.simulatedPnlPct30d`
   - Open Strategies count
   - Closed Strategies count
   - Total Executed count
   - Win Rate - from `mockPortfolioStats.winRate`
   - Avg R:R - from `mockPortfolioStats.avgRR`

2. **Exposure by Asset Card** (lines 169-189)
   - Horizontal bar chart showing:
     - USDC / Spot & Cash %
     - Perps %
     - DeFi (yield) %
     - Event Markets %
   - **Calculated inline** (lines 43-65)

3. **PnL Over Time (Mock)** Card (lines 195-217)
   - Sparkline chart (30-day mock data)
   - Best day, Worst day, Max drawdown stats
   - **Data:** `sparklineData` (hardcoded array, line 10)
   - **Stats:** from `mockPortfolioStats`

4. **Strategy Breakdown Card** (lines 220-239)
   - List of strategy types with:
     - Name
     - Status badge (Active/Experimental)
     - PnL share %
   - **Calculated inline** (lines 67-98)

**Empty State** (lines 122-128):
- Shows when `hasActivePositions === false`
- Message: "No active positions yet."

**Selected Strategy Indicator** (lines 113-120):
- Shows current `selectedStrategyId` if set
- Displays: market, side, risk %

### C) Data Dependencies & Calculations

**Data Sources:**
- `account: AccountState` from `BlossomContext`
- `strategies: Strategy[]` from `BlossomContext`
- `defiPositions: DefiPosition[]` from `BlossomContext`
- `selectedStrategyId: string | null` from `BlossomContext`
- `mockPortfolioStats` from `src/lib/mockData.ts` (static)

**Calculations (all inline in PortfolioView.tsx):**

1. **Sparkline Data** (line 10)
   - Hardcoded 30-day array (mock)

2. **Executed/Open/Closed Strategies** (lines 20-22)
   - `executedStrategies`: `status === 'executed' || status === 'closed'`
   - `openStrategies`: `status === 'executed' && !isClosed`
   - `closedStrategies`: `status === 'closed'`

3. **DeFi Exposure** (lines 25-26)
   - `activeDefiPositions`: filters `status === 'active'`
   - `totalDefiDeposits`: sum of `depositUsd`

4. **Exposure by Asset** (lines 28-65)
   - `totalEventExposure`: from `account.eventExposureUsd`
   - `perpExposure`: from `account.openPerpExposure`
   - `spotAndCash`: `accountValue - (perpExposure + totalDefiDeposits + totalEventExposure)`
   - `exposureByAsset`: array with percentages for each asset class
   - **Fallback:** Mock data if `totalForExposure === 0` (lines 61-65)

5. **Strategy Breakdown** (lines 67-98)
   - `openPerpStrategies`: filters perps (non-event, executed, not closed)
   - `openEventStrategies`: filters events (executed, not closed)
   - `totalStrategyCount`: sum of open perps + events + active DeFi
   - `strategyBreakdown`: array with PnL share % per strategy type
   - **Fallback:** Mock data if `totalStrategyCount === 0` (lines 93-98)

6. **Has Active Positions** (line 101)
   - `hasActivePositions`: `openStrategies.length > 0 || activeDefiPositions.length > 0`

**Helper Functions Used:**
- None explicitly (all calculations inline)
- Could reuse `isOpenPerp`, `isOpenEvent`, `isActiveDefi` but currently doesn't

**Duplicated Calculations:**
- **DeFi Aggregates:** Same logic in `RiskCenter.tsx` (lines 465-469) and `PortfolioView.tsx` (lines 25-26)
- **Event Exposure:** Similar logic in `RiskCenter.tsx` (lines 438-445) and `PortfolioView.tsx` (line 29)
- **Open Strategies Filtering:** Similar patterns across all three views

### D) "What to Change for X"

**To add an exposure-by-asset chart:**
- **Files:** `src/components/PortfolioView.tsx` (lines 169-189)
- **Location:** Already exists as horizontal bars
- **Enhancement:** Replace bars with pie chart or donut chart component
- **Data:** Already calculated in `exposureByAsset` (lines 43-65)

**To add risk alerts:**
- **Files:** `src/components/PortfolioView.tsx`
- **Location:** Add new section after "Account Performance" card
- **Data:** Reuse risk alert logic from `RiskCenter.tsx` or create shared helper
- **Component:** Similar to "Recent Alerts" in RiskCenter (lines 721-740)

**To add action buttons like hedge/reduce/close %:**
- **Files:** `src/components/PortfolioView.tsx`
- **Location:** Add to "Account Performance" card or new "Quick Actions" section
- **Actions:** Same as Risk Center (see above)
- **Context Helpers:** Use existing `updatePerpSizeById`, `closeStrategy`, or add new helpers

---

## 3. Shared Patterns & Opportunities

### Duplicated Logic

1. **DeFi Aggregates:**
   - `RiskCenter.tsx` (lines 465-469)
   - `PortfolioView.tsx` (lines 25-26)
   - **Opportunity:** Extract to `src/lib/portfolioCalculations.ts` → `getDefiAggregates(defiPositions)`

2. **Event Exposure:**
   - `RiskCenter.tsx` (lines 430-445)
   - `PortfolioView.tsx` (line 29)
   - **Opportunity:** Extract to `src/lib/portfolioCalculations.ts` → `getEventExposure(strategies, account)`

3. **Open Strategies Filtering:**
   - All three views filter strategies differently
   - **Opportunity:** Use exported helpers `isOpenPerp`, `isOpenEvent` consistently

4. **Margin Calculations:**
   - `RiskCenter.tsx` (line 490)
   - Likely in `RightPanel.tsx` (not verified)
   - **Opportunity:** Extract to `src/lib/portfolioCalculations.ts` → `getMarginMetrics(account)`

### Mock Data Dependencies

- `mockRiskMetrics` (Risk Center)
- `mockAlerts` (Risk Center)
- `mockPortfolioStats` (Portfolio View)
- `sparklineData` (Portfolio View, hardcoded)

**Opportunity:** Replace with real calculations or backend API calls

### Missing Calculations

- **Real VaR calculation** (currently mock)
- **Real drawdown calculation** (currently mock)
- **Real volatility regime** (currently mock)
- **Real PnL over time** (currently hardcoded sparkline)
- **Real win rate** (currently mock)
- **Real R:R** (currently mock)

---

## 4. Context Helpers Available

**From `src/context/BlossomContext.tsx`:**

- `isOpenPerp(strategy)` - exported helper (line 234)
- `isOpenEvent(strategy)` - exported helper (line 243)
- `isActiveDefi(position)` - exported helper (line 252)
- `getOpenPositionsCount(strategies, defiPositions)` - exported helper (line 257)
- `updatePerpSizeById(id, newSize)` - context method
- `updatePerpTpSlById(id, newTp, newSl)` - context method
- `updatePerpLeverageById(id, newLeverage)` - context method
- `updateEventStakeById(id, newStake)` - context method
- `updateEventSideById(id, newSide)` - context method
- `updateDeFiDepositById(id, newDeposit)` - context method
- `closeStrategy(id)` - context method
- `closeEventStrategy(id)` - context method
- `autoCloseProfitableStrategies()` - context method
- `recomputeAccountFromStrategies()` - context method

---

## 5. File Structure Summary

```
src/
├── App.tsx                          # Main app, conditionally renders RiskCenter/PortfolioView
├── components/
│   ├── TabNav.tsx                   # Tab navigation (Copilot / Risk Center / Portfolio)
│   ├── RiskCenter.tsx               # Risk Center page (831 lines)
│   ├── PortfolioView.tsx            # Portfolio Overview page (246 lines)
│   ├── CopilotLayout.tsx            # Layout wrapper (also supports risk/portfolio views)
│   └── RightPanel.tsx               # Wallet + Positions (shared across views)
├── context/
│   └── BlossomContext.tsx           # Global state + helpers (isOpenPerp, getOpenPositionsCount, etc.)
└── lib/
    └── mockData.ts                  # Mock data (mockRiskMetrics, mockAlerts, mockPortfolioStats)
```

---

## 6. Proposed UX Upgrades

### Risk Center - 3 High-Impact Upgrades

#### Upgrade 1: Real-Time Risk Alerts with Action Buttons
**What the user sees:**
- Replace static "Recent Alerts" with computed alerts based on actual portfolio state
- Each alert shows:
  - Icon (warning/info)
  - Timestamp (real-time or "Just now")
  - Message (e.g., "Margin used: 85% (above 80% threshold)")
  - Action button: "Reduce exposure", "Hedge", "Close 25%", etc.
- Alerts auto-dismiss after action or manual dismiss

**Files to edit:**
- `src/components/RiskCenter.tsx` (lines 721-740)
- **New file:** `src/lib/riskAlerts.ts` (helper function)

**Existing state/helpers to reuse:**
- `account` (margin, exposure)
- `strategies` (correlation, liquidation buffers)
- `riskProfile` (thresholds)
- `updatePerpSizeById`, `closeStrategy` (for actions)

**Complexity:** **M** (Medium)
- Create alert computation logic (~100 lines)
- Add action button handlers (~50 lines)
- Update UI to show computed alerts (~30 lines)

---

#### Upgrade 2: Interactive Correlation Matrix
**What the user sees:**
- Replace text "Cross-Position Correlation: High/Medium/Low" with a visual correlation matrix
- Small grid showing:
  - Rows/columns: Each open position (market-side)
  - Cells: Correlation coefficient (0-1) with color coding
  - Hover: Shows exact correlation value
- Click a cell → highlights correlated positions
- Add "Hedge correlated positions" button when correlation > threshold

**Files to edit:**
- `src/components/RiskCenter.tsx` (lines 614-620, replace correlation display)
- **New file:** `src/components/CorrelationMatrix.tsx` (new component)

**Existing state/helpers to reuse:**
- `executedStrategies` (already computed)
- `riskProfile.correlationHedgeThreshold` (threshold)
- `updatePerpSizeById`, `closeStrategy` (for hedging actions)

**Complexity:** **M** (Medium)
- Create correlation calculation helper (~50 lines)
- Build matrix component (~150 lines)
- Wire to Risk Center (~30 lines)

---

#### Upgrade 3: Quick Actions Panel for Risk Reduction
**What the user sees:**
- New collapsible section: "Quick Actions"
- Three action buttons:
  1. **"Reduce Exposure by 25%"** → Reduces size of all perp positions by 25%
  2. **"Hedge Long Positions"** → Creates opposite short positions for all longs
  3. **"Close Riskiest Position"** → Closes position with highest risk %
- Each button shows:
  - What it will do (e.g., "Will close ETH-PERP Long @ 5% risk")
  - Confirmation dialog before execution
- Success feedback: Toast or inline message

**Files to edit:**
- `src/components/RiskCenter.tsx` (add new section after "Account Overview")
- **New file:** `src/lib/riskActions.ts` (helper functions)

**Existing state/helpers to reuse:**
- `strategies` (to find riskiest, filter longs)
- `updatePerpSizeById` (reduce exposure)
- `closeStrategy` (close position)
- `addDraftStrategy` (for hedging - creates new position)

**Complexity:** **S** (Small)
- Create action helpers (~80 lines)
- Add UI section (~60 lines)
- Wire confirmation dialogs (~40 lines)

---

### Portfolio Overview - 3 High-Impact Upgrades

#### Upgrade 1: Real PnL Over Time Chart (Replace Mock Sparkline)
**What the user sees:**
- Replace hardcoded sparkline with real PnL data
- Chart shows:
  - X-axis: Time (last 30 days, or since first position)
  - Y-axis: Cumulative PnL %
  - Line chart with hover tooltips
  - Markers for significant events (position opened/closed)
- Add time range selector: 7d / 30d / All time
- Show current PnL vs. previous period comparison

**Files to edit:**
- `src/components/PortfolioView.tsx` (lines 195-217, replace sparkline)
- **New file:** `src/lib/pnlHistory.ts` (helper to compute PnL over time)
- **New file:** `src/components/PnLChart.tsx` (chart component, or use existing library)

**Existing state/helpers to reuse:**
- `strategies` (with `realizedPnlPct`, `createdAt`, `closedAt`)
- `account.totalPnlPct` (current total)
- `account.simulatedPnlPct30d` (30d baseline)

**Complexity:** **M** (Medium)
- Create PnL history calculation (~100 lines)
- Build or integrate chart component (~150 lines)
- Add time range selector (~40 lines)

---

#### Upgrade 2: Exposure by Asset Interactive Chart
**What the user sees:**
- Replace horizontal bars with interactive pie/donut chart
- Chart shows:
  - Slices: USDC/Cash, Perps, DeFi, Event Markets
  - Hover: Shows exact $ amount and %
  - Click slice: Filters positions list below (if we add one)
- Add breakdown tooltip:
  - Perps slice → shows per-market breakdown (ETH, BTC, SOL, etc.)
  - DeFi slice → shows per-protocol breakdown
- Add "Rebalance" button that suggests allocation changes

**Files to edit:**
- `src/components/PortfolioView.tsx` (lines 169-189, replace bars)
- **New file:** `src/components/ExposureChart.tsx` (chart component)

**Existing state/helpers to reuse:**
- `exposureByAsset` (already calculated)
- `strategies` (for per-market breakdown)
- `defiPositions` (for per-protocol breakdown)

**Complexity:** **S** (Small)
- Create chart component (~120 lines)
- Add breakdown tooltips (~50 lines)
- Wire to existing data (~20 lines)

---

#### Upgrade 3: Strategy Performance Table with Sort/Filter
**What the user sees:**
- New section: "Strategy Performance"
- Table showing:
  - Columns: Market, Side, Status, Risk %, Entry, Current PnL %, Realized PnL %, Opened, Closed
  - Sortable columns (click header to sort)
  - Filter dropdown: All / Open / Closed / Perps / Events
  - Row click → highlights position in right panel (if visible)
- Add "Close" button per row for open positions
- Color coding: Green for profitable, red for loss

**Files to edit:**
- `src/components/PortfolioView.tsx` (add new section after "Strategy Breakdown")
- **New file:** `src/components/StrategyPerformanceTable.tsx` (table component)

**Existing state/helpers to reuse:**
- `strategies` (all data)
- `closeStrategy`, `closeEventStrategy` (for close actions)
- `setSelectedStrategyId` (for highlighting)

**Complexity:** **M** (Medium)
- Create table component (~200 lines)
- Add sort/filter logic (~80 lines)
- Wire actions (~40 lines)

---

## 7. Implementation Priority Recommendations

**Quick Wins (S complexity, high impact):**
1. Risk Center: Quick Actions Panel
2. Portfolio Overview: Interactive Exposure Chart

**Medium Effort (M complexity, high impact):**
1. Risk Center: Real-Time Risk Alerts
2. Portfolio Overview: Strategy Performance Table
3. Risk Center: Correlation Matrix
4. Portfolio Overview: Real PnL Chart

**Consider for Future:**
- Extract shared calculation helpers to reduce duplication
- Replace all mock data with real calculations
- Add backend API integration for historical PnL data

