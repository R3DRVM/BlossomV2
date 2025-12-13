# Blossom Trading Copilot - Architecture Map

## 1. Full File Tree

```
src/
 ├─ components/
 │   ├─ AccountSummaryStrip.tsx          [Legacy - not used in current layout]
 │   ├─ BlossomLogo.tsx                   [Reusable logo component]
 │   ├─ Chat.tsx                          [Main chat interface - core component]
 │   ├─ ChatSimulation.tsx                [Landing page demo]
 │   ├─ CherryBlossomBackground.tsx       [Landing page background]
 │   ├─ ContextualPanel.tsx               [Legacy - replaced by PositionsTray]
 │   ├─ CopilotLayout.tsx                 [3-panel layout orchestrator]
 │   ├─ DeFiSummaryCard.tsx               [Legacy - not actively used]
 │   ├─ DeFiView.tsx                      [Legacy - not actively used]
 │   ├─ EmptyStateCard.tsx                [Reusable empty state]
 │   ├─ FeatureIcons.tsx                 [Landing page]
 │   ├─ FeatureSections.tsx               [Landing page]
 │   ├─ Header.tsx                        [Legacy - not used in current layout]
 │   ├─ HeroSection.tsx                   [Landing page]
 │   ├─ HeroTerminal.tsx                  [Landing page]
 │   ├─ landing/
 │   │   ├─ ChatPreview.tsx
 │   │   ├─ CherryBlossomBackground.tsx
 │   │   ├─ HeroSection.tsx
 │   │   └─ HeroTerminal.tsx
 │   ├─ LandingFooter.tsx                 [Landing page]
 │   ├─ LeftSidebar.tsx                   [User profile + chat history]
 │   ├─ MarketingAgentPreview.tsx         [Landing page]
 │   ├─ MarketingAgentTerminal.tsx        [Landing page]
 │   ├─ MessageBubble.tsx                 [Individual message + strategy cards]
 │   ├─ PortfolioView.tsx                 [Portfolio overview tab]
 │   ├─ PositionDetailsModal.tsx         [Legacy modal - not actively used]
 │   ├─ PositionsTray.tsx                 [Collapsible notifications tray]
 │   ├─ PositionSummaryCard.tsx           [Legacy - not actively used]
 │   ├─ QuickStartDock.tsx                [Legacy - replaced by QuickStartPanel]
 │   ├─ QuickStartPanel.tsx               [Quick action prompts]
 │   ├─ RightPanel.tsx                    [Wallet snapshot]
 │   ├─ RiskCenter.tsx                    [Risk metrics + editable rules]
 │   ├─ SidePanel.tsx                     [Legacy - not actively used]
 │   ├─ SimBanner.tsx                     [Legacy - not used in current layout]
 │   ├─ TabNav.tsx                        [Legacy - not used in current layout]
 │   ├─ TickerStrip.tsx                   [Asset price ticker]
 │   ├─ TypingIndicator.tsx               [Chat typing animation]
 │   └─ ui/
 │       ├─ Badge.tsx                     [Reusable badge component]
 │       ├─ Button.tsx                    [Reusable button component]
 │       └─ Card.tsx                      [Reusable card component]
 │
 ├─ config/
 │   └─ quickStartConfig.ts               [Quick start prompt definitions]
 │
 ├─ context/
 │   └─ BlossomContext.tsx                [Global state + business logic]
 │
 ├─ layouts/
 │   └─ BlossomAppShell.tsx               [Top-level app shell]
 │
 ├─ lib/
 │   ├─ apiClient.ts                      [HTTP client wrapper]
 │   ├─ blossomApi.ts                     [Agent backend API calls]
 │   ├─ config.ts                         [Feature flags (USE_AGENT_BACKEND)]
 │   ├─ mockData.ts                       [Static mock data]
 │   ├─ mockParser.ts                     [NL parsing + strategy generation]
 │   └─ portfolioMapping.ts               [Backend → frontend state mapper]
 │
 ├─ pages/
 │   └─ LandingPage.tsx                   [Marketing landing page]
 │
 ├─ routes/
 │   └─ AppRouter.tsx                     [React Router setup]
 │
 ├─ assets/
 │   ├─ blossom-logo.png
 │   └─ cherry-blossom-bg.png
 │
 ├─ App.tsx                               [Legacy - not used]
 ├─ main.tsx                              [React entry point]
 ├─ index.css                            [Global styles + Tailwind]
 └─ vite-env.d.ts                         [Vite type definitions]
```

---

## 2. Component Dependency Graph

### Chat.tsx
**Imports:**
- `MessageBubble` (renders messages)
- `TypingIndicator` (typing animation)
- `QuickStartPanel` (quick action prompts)
- `mockParser` (`parseUserMessage`, `generateBlossomResponse`, `ParsedStrategy`)
- `BlossomContext` (extensive: strategies, account, chat sessions, strategy actions)
- `blossomApi` (`callBlossomChat` - agent mode)
- `config` (`USE_AGENT_BACKEND`)

**Imported by:**
- `CopilotLayout.tsx` (renders Chat in center panel)

**Context dependencies:**
- Reads: `strategies`, `account`, `venue`, `chatSessions`, `activeChatId`, `selectedStrategyId`
- Writes: `addDraftStrategy`, `updateStrategy`, `updateEventStake`, `createNewChatSession`, `appendMessageToActiveChat`, `updateChatSessionTitle`, `setOnboarding`

**Utilities:**
- `parseUserMessage()` - NL intent detection
- `generateBlossomResponse()` - response text generation
- `findActivePerpStrategyForEdit()` - strategy modification target resolution

**Potential issues:**
- Large component (~800+ lines) - handles both mock and agent modes
- Directly calls `addDraftStrategy`, `updateStrategy` - tight coupling to context
- Strategy modification logic mixed with message handling

---

### MessageBubble.tsx
**Imports:**
- `BlossomContext` (strategy actions, account, riskProfile)
- `mockParser` (`ParsedStrategy` type)
- `blossomApi` (`closeStrategy` - agent mode)
- `BlossomLogo` (avatar)
- `config` (`USE_AGENT_BACKEND`)

**Imported by:**
- `Chat.tsx` (renders each message)

**Context dependencies:**
- Reads: `strategies`, `account`, `riskProfile`, `defiPositions`, `selectedStrategyId`
- Writes: `updateStrategyStatus`, `closeStrategy`, `closeEventStrategy`, `setSelectedStrategyId`, `setActiveTab`, `setOnboarding`

**Utilities:**
- `getBaseAsset()` - extracts base asset from market string
- `getStrategyReasoning()` - generates "Why this setup?" text
- `getPortfolioBiasWarning()` - warns about correlated positions

**Potential issues:**
- Strategy card rendering logic embedded in message component
- Risk evaluation (`isHighRisk`, `isVeryHighRisk`) uses `riskProfile.maxPerTradeRiskPct`
- "Confirm & Queue" button directly calls `updateStrategyStatus` - no validation layer

---

### RiskCenter.tsx
**Imports:**
- `BlossomContext` (account, strategies, riskProfile, manualWatchlist)
- `mockData` (`mockRiskMetrics`, `mockAlerts`)
- `lucide-react` (icons: `ChevronDown`, `Pencil`, `Trash2`)

**Imported by:**
- `CopilotLayout.tsx` (renders in center panel when `centerView === 'risk'`)

**Context dependencies:**
- Reads: `account`, `strategies`, `defiPositions`, `riskProfile`, `manualWatchlist`, `lastRiskSnapshot`
- Writes: `updateRiskProfile`, `resetRiskProfileToDefault`, `addWatchAsset`, `removeWatchAsset`, `setOnboarding`, `setLastRiskSnapshot`, `setActiveTab`

**Internal components:**
- `CollapsibleSection` - reusable collapsible card
- `EditableRiskRulesSection` - risk profile editor
- `LiquidationWatchlistSection` - watchlist with manual entries

**Potential issues:**
- Uses `mockRiskMetrics` for some metrics (not derived from real data)
- Strategy filter dropdown filters strategies but account-level metrics remain global
- Manual watchlist is separate from auto-derived positions (could be unified)

---

### QuickStartPanel.tsx
**Imports:**
- `quickStartConfig` (`QUICK_START_CATEGORIES`)

**Imported by:**
- `Chat.tsx` (renders above message input)

**Context dependencies:**
- None (pure presentational component)

**Utilities:**
- `QUICK_START_CATEGORIES` - static prompt definitions

**Potential issues:**
- No coupling to context - safe to modify
- Collapses after selection (local state only)

---

### PositionsTray.tsx
**Imports:**
- `BlossomContext` (strategies, defiPositions, account)
- `blossomApi` (`closeStrategy` - agent mode)
- `config` (`USE_AGENT_BACKEND`)

**Imported by:**
- `CopilotLayout.tsx` (docked bottom-right in right panel)

**Context dependencies:**
- Reads: `strategies`, `defiPositions`, `account`, `selectedStrategyId`
- Writes: `updateStrategy`, `closeEventStrategy`, `updateDeFiPlanDeposit`, `setSelectedStrategyId`

**Features:**
- Inline editing for perps (TP/SL, leverage, size)
- Inline editing for events (stake)
- Inline editing for DeFi (deposit amount)
- Auto-expands when positions are created

**Potential issues:**
- Complex inline editing state management (per-position edit modes)
- Directly mutates strategies via `updateStrategy` - no validation
- Event "Close & settle" calls `closeEventStrategy` - should verify state updates

---

### RightPanel.tsx
**Imports:**
- `BlossomContext` (account only)

**Imported by:**
- `CopilotLayout.tsx` (right sidebar)

**Context dependencies:**
- Reads: `account` (read-only)

**Features:**
- Wallet snapshot (balance, exposure, PnL)
- Token holdings list
- Action buttons (Fund/Send/Swap - not implemented)

**Potential issues:**
- Very simple - safe to modify
- Action buttons are TODOs

---

### LeftSidebar.tsx
**Imports:**
- `BlossomContext` (chat sessions, resetSim)
- `lucide-react` (`MoreHorizontal` icon)

**Imported by:**
- `CopilotLayout.tsx` (left sidebar)

**Context dependencies:**
- Reads: `chatSessions`, `activeChatId`
- Writes: `createNewChatSession`, `setActiveChat`, `deleteChatSession`, `resetSim`

**Features:**
- User profile card
- Reset SIM button
- New chat button
- Chat history list with delete (inline popover)

**Potential issues:**
- Safe to modify - isolated chat session management
- Delete uses `window.confirm` - could be replaced with custom modal

---

### BlossomContext.tsx
**Exports:**
- Types: `Strategy`, `AccountState`, `DefiPosition`, `RiskProfile`, `ManualWatchAsset`, `ChatSession`, `ChatMessage`, etc.
- Functions: `useBlossomContext()`, `getBaseAsset()`
- Component: `BlossomProvider`

**Imported by:**
- All major components (17+ files)

**State managed:**
- `strategies: Strategy[]` - all strategies (draft → closed)
- `account: AccountState` - wallet, balances, exposure, PnL
- `defiPositions: DefiPosition[]` - DeFi yield positions
- `selectedStrategyId: string | null` - currently selected strategy
- `activeTab: ActiveTab` - current tab (copilot/risk/portfolio)
- `venue: Venue` - trading venue (hyperliquid/event_demo)
- `onboarding: OnboardingState` - onboarding checklist
- `lastRiskSnapshot: RiskSnapshot | null` - for delta calculations
- `riskProfile: RiskProfile` - user-configurable risk thresholds
- `manualWatchlist: ManualWatchAsset[]` - manual liquidation watchlist
- `chatSessions: ChatSession[]` - multi-chat sessions
- `activeChatId: string | null` - active chat session

**Actions:**
- Strategy: `addDraftStrategy`, `updateStrategyStatus`, `updateStrategy`, `closeStrategy`, `closeEventStrategy`, `updateEventStake`
- Account: `recomputeAccountFromStrategies`, `resetSim`
- DeFi: `createDefiPlanFromCommand`, `confirmDefiPlan`, `updateDeFiPlanDeposit`
- Chat: `createNewChatSession`, `setActiveChat`, `appendMessageToActiveChat`, `updateChatSessionTitle`, `deleteChatSession`
- Risk: `updateRiskProfile`, `resetRiskProfileToDefault`
- Watchlist: `addWatchAsset`, `removeWatchAsset`, `updateWatchAsset`

**localStorage keys:**
- `blossom_chat_sessions` - serialized chat sessions
- `blossom_active_chat_id` - active chat ID
- `blossom_risk_profile` - risk profile settings
- `blossom_manual_watchlist` - manual watchlist entries

**Potential issues:**
- Very large file (~1000+ lines) - single source of truth but complex
- `recomputeAccountFromStrategies()` recalculates account from strategies - called after every strategy mutation
- Strategy status transitions not validated (could go draft → closed without queued/executing)
- `resetSim()` clears everything including chat sessions - might want separate "reset account" vs "reset all"

---

### mockParser.ts
**Exports:**
- Types: `ParsedIntent`, `ParsedStrategy`, `ParsedEventStrategy`, `StrategyModification`, `ParsedMessage`
- Functions: `parseUserMessage()`, `generateBlossomResponse()`, `findActivePerpStrategyForEdit()`, `parseModificationFromText()`

**Imported by:**
- `Chat.tsx` (primary consumer)

**Dependencies:**
- None (pure functions)

**Logic:**
- Intent detection (trade, defi, event, hedge, modify_perp_strategy, risk_question, general)
- Strategy modification parsing (size, risk%, leverage, side)
- Response text generation
- Active strategy resolution for edits

**Potential issues:**
- Regex-based parsing - could be brittle
- Modification parsing uses heuristics (e.g., "2k" → 2000, "3x" → leverage)
- No validation of parsed values (could produce invalid strategies)

---

## 3. State Architecture Overview

### Global State (BlossomContext)

**Core State:**
1. **Strategies** (`strategies: Strategy[]`)
   - All strategies regardless of status
   - Status flow: `draft` → `queued` → `executing` → `executed` → `closed`
   - Modified via: `addDraftStrategy()`, `updateStrategyStatus()`, `updateStrategy()`, `closeStrategy()`

2. **Account** (`account: AccountState`)
   - `accountValue`, `openPerpExposure`, `eventExposureUsd`, `totalPnlPct`, `simulatedPnlPct30d`, `balances[]`
   - Recalculated via `recomputeAccountFromStrategies()` after strategy mutations
   - Derived from executed strategies + DeFi positions

3. **DeFi Positions** (`defiPositions: DefiPosition[]`)
   - Status: `proposed` → `active`
   - Modified via: `createDefiPlanFromCommand()`, `confirmDefiPlan()`, `updateDeFiPlanDeposit()`

4. **Chat Sessions** (`chatSessions: ChatSession[]`, `activeChatId: string | null`)
   - Each session has: `id`, `title`, `createdAt`, `messages[]`
   - Persisted to localStorage
   - Modified via: `createNewChatSession()`, `setActiveChat()`, `appendMessageToActiveChat()`, `updateChatSessionTitle()`, `deleteChatSession()`

5. **Risk Profile** (`riskProfile: RiskProfile`)
   - `maxPerTradeRiskPct`, `minLiqBufferPct`, `fundingAlertThresholdPctPer8h`, `correlationHedgeThreshold`
   - Persisted to localStorage
   - Modified via: `updateRiskProfile()`, `resetRiskProfileToDefault()`

6. **Manual Watchlist** (`manualWatchlist: ManualWatchAsset[]`)
   - User-pinned assets for liquidation monitoring
   - Persisted to localStorage
   - Modified via: `addWatchAsset()`, `removeWatchAsset()`, `updateWatchAsset()`

**UI State:**
- `selectedStrategyId` - currently selected strategy (for highlighting)
- `activeTab` - current tab (copilot/risk/portfolio)
- `venue` - trading venue toggle
- `onboarding` - onboarding checklist state
- `lastRiskSnapshot` - for Risk Center delta calculations

### State Flow Patterns

**Strategy Creation:**
1. User sends message → `Chat.tsx` calls `parseUserMessage()`
2. `mockParser` returns `ParsedMessage` with intent + strategy data
3. `Chat.tsx` calls `addDraftStrategy()` → strategy added with status `draft`
4. `Chat.tsx` calls `appendMessageToActiveChat()` → message added to session
5. User clicks "Confirm & Queue" → `MessageBubble.tsx` calls `updateStrategyStatus(id, 'queued')`
6. Context updates status → `recomputeAccountFromStrategies()` recalculates account

**Strategy Modification:**
1. User sends modification message → `parseUserMessage()` detects `modify_perp_strategy` intent
2. `findActivePerpStrategyForEdit()` resolves target strategy
3. `parseModificationFromText()` extracts changes (size, risk%, leverage, side)
4. `Chat.tsx` calls `updateStrategy(id, updates)` → partial update applied
5. Strategy card re-renders with new values

**Account Recalculation:**
- Triggered by: `updateStrategyStatus()`, `closeStrategy()`, `confirmDefiPlan()`
- Logic: `recomputeAccountFromStrategies()`
  - Filters strategies with status `executed` or `executing`
  - Sums `notionalUsd` for perp exposure
  - Sums `stakeUsd` for event exposure
  - Updates `accountValue` from balances
  - Calculates PnL (simplified - uses `totalPnlPct`)

### localStorage Usage

**Keys:**
- `blossom_chat_sessions` - JSON array of `ChatSession[]`
- `blossom_active_chat_id` - string or null
- `blossom_risk_profile` - JSON object of `RiskProfile`
- `blossom_manual_watchlist` - JSON array of `ManualWatchAsset[]`

**Persistence:**
- Chat sessions: saved on every `appendMessageToActiveChat()`, `deleteChatSession()`, `updateChatSessionTitle()`
- Risk profile: saved on every `updateRiskProfile()`
- Manual watchlist: saved on every `addWatchAsset()`, `removeWatchAsset()`, `updateWatchAsset()`
- All cleared on `resetSim()`

**Potential issues:**
- No migration logic if schema changes
- No error handling if localStorage is full
- Chat sessions could grow large over time

---

## 4. UI Architecture

### Layout Hierarchy

```
main.tsx
 └─ BrowserRouter
     └─ AppRouter
         ├─ Route "/" → LandingPage
         └─ Route "/app" → BlossomAppShell
             └─ BlossomProvider
                 └─ AppContent
                     └─ CopilotLayout (3-panel layout)
                         ├─ LeftSidebar (w-64, hidden <lg)
                         ├─ Center Panel (flex-1)
                         │   ├─ Center Header (logo + tabs + venue toggle)
                         │   ├─ TickerStrip (only for copilot view)
                         │   └─ Content Area
                         │       ├─ Copilot view → Chat
                         │       ├─ Risk view → RiskCenter
                         │       └─ Portfolio view → PortfolioView
                         └─ RightPanel (w-[320px], hidden <lg)
                             └─ PositionsTray (docked bottom-right)
```

### Component Responsibilities

**Layout Components:**
- `BlossomAppShell` - Wraps app in `BlossomProvider`, provides gradient background
- `CopilotLayout` - 3-panel responsive layout, manages `centerView` state, renders header/tabs
- `LeftSidebar` - User profile + chat history
- `RightPanel` - Wallet snapshot (read-only)
- `PositionsTray` - Collapsible notifications tray (docked in right panel)

**Content Components:**
- `Chat` - Main chat interface, message list, input, QuickStartPanel
- `MessageBubble` - Individual message + strategy card rendering
- `RiskCenter` - Risk metrics, editable rules, watchlist
- `PortfolioView` - Portfolio overview with charts

**Strategy Card Rendering:**
- `MessageBubble.tsx` contains inline strategy card JSX
- Shows: market, side, risk%, entry, TP/SL, liq buffer, funding impact
- Actions: "Confirm & Queue", "Close position", "Why this setup?" toggle
- Risk warnings: yellow banner if risk > `riskProfile.maxPerTradeRiskPct`

**Notifications/Toasts:**
- No toast system currently
- Auto-close messages shown inline in `RiskCenter` (Agent Activity section)
- `PositionsTray` auto-expands when positions are created

**UI Primitives:**
- `components/ui/Button.tsx` - Reusable button (not widely used)
- `components/ui/Badge.tsx` - Reusable badge (not widely used)
- `components/ui/Card.tsx` - Reusable card (not widely used)
- Most components use inline Tailwind classes

---

## 5. Strategy & Risk Logic Overview

### Strategy Lifecycle

**Status Transitions:**
1. **draft** - Created by `addDraftStrategy()`, shown in chat with "Confirm & Queue" button
2. **queued** - User clicks "Confirm & Queue" → `updateStrategyStatus(id, 'queued')`
3. **executing** - (Not currently used in mock mode - would be set by backend)
4. **executed** - (Not currently used in mock mode - would be set by backend)
5. **closed** - User clicks "Close position" → `closeStrategy(id)` or `closeEventStrategy(id)`

**Current Behavior:**
- In mock mode, strategies go `draft` → `queued` → `executed` (skips `executing`)
- `updateStrategyStatus('queued')` immediately sets status to `executed` in mock mode
- `recomputeAccountFromStrategies()` filters for `executed` or `executing` status

**Strategy Modification:**
- `updateStrategy(id, updates)` - partial update (size, risk%, leverage, side, TP/SL)
- Used by: natural-language edits, inline editing in PositionsTray
- No validation - accepts any `Partial<Strategy>`
- Recalculates dependent fields (e.g., risk% from size, TP/SL from side)

### Risk Evaluation

**In MessageBubble.tsx:**
- `isHighRisk = strategy.riskPercent > riskProfile.maxPerTradeRiskPct`
- `isVeryHighRisk = strategy.riskPercent >= riskProfile.maxPerTradeRiskPct * 1.5`
- Shows yellow warning banner if `isHighRisk`
- Button tooltip shows warning if `isVeryHighRisk` (but button is never disabled)

**In RiskCenter.tsx:**
- Uses `riskProfile` values for editable rules
- Computes correlation from strategy groups
- Liquidation watchlist shows auto-derived positions + manual entries
- Strategy filter dropdown filters strategies for per-strategy metrics

**Risk Profile:**
- Default: `maxPerTradeRiskPct: 3`, `minLiqBufferPct: 15`, `fundingAlertThresholdPctPer8h: 0.15`, `correlationHedgeThreshold: 0.75`
- Editable in Risk Center → persisted to localStorage
- Used in chat warnings but not enforced (advisory only)

### Mock Logic

**Strategy Execution Simulation:**
- `applyExecutedStrategyToBalances()` - updates balances when strategy is executed
- Subtracts notional from REDACTED, adds to base asset
- Updates `openPerpExposure`, `totalPnlPct` (simplified - adds small delta)
- Called by `updateStrategyStatus()` when status changes to `executed`

**Account Recalculation:**
- `recomputeAccountFromStrategies()` - recalculates account from strategies
- Filters executed/executing strategies
- Sums perp exposure, event exposure
- Updates account value from balances

**Hedging Logic:**
- `parseUserMessage()` detects "hedge" intent
- `Chat.tsx` calculates net exposure for base asset
- Creates offsetting strategy (long → short, short → long)
- Sizes to bring net exposure to 0 (full hedge)

---

## 6. Known Fragile Areas

### Type Safety Issues

1. **ChatMessage.strategy type:**
   - `strategy?: any | null` - should be `ParsedStrategy | null`
   - Used inconsistently (sometimes `ParsedStrategy`, sometimes `any`)

2. **Strategy.instrumentType:**
   - Optional field (`instrumentType?: 'perp' | 'event'`)
   - Many components assume it exists or default to 'perp'
   - Could cause runtime errors if undefined

3. **Partial<Strategy> in updateStrategy:**
   - Accepts any partial update - no validation
   - Could create invalid states (e.g., negative risk%, missing required fields)

### Context Mutation Risks

1. **No validation in strategy mutations:**
   - `updateStrategy()` accepts any `Partial<Strategy>`
   - `updateStrategyStatus()` doesn't validate transitions
   - Could set invalid status (e.g., `draft` → `closed` without `queued`)

2. **Account recalculation timing:**
   - `recomputeAccountFromStrategies()` called after mutations
   - If multiple mutations happen quickly, could race
   - No batching or debouncing

3. **localStorage errors not handled:**
   - `saveChatSessionsToStorage()` catches errors but doesn't notify user
   - If localStorage is full, sessions could be lost silently

### Component Fragility

1. **MessageBubble.tsx:**
   - Large component (~560 lines)
   - Strategy card rendering embedded in message component
   - Risk evaluation logic mixed with presentation
   - Hard to test or refactor

2. **Chat.tsx:**
   - Very large (~800+ lines)
   - Handles both mock and agent modes
   - Strategy creation logic mixed with message handling
   - Natural-language modification logic embedded

3. **RiskCenter.tsx:**
   - Uses `mockRiskMetrics` for some metrics (not derived from real data)
   - Strategy filter filters strategies but account metrics remain global
   - Could be confusing if filter is set but account metrics don't change

### Missing Null Guards

1. **Strategy access:**
   - `strategies.find(s => s.id === id)` could return `undefined`
   - Many places assume strategy exists after find
   - Should use optional chaining or early returns

2. **Account value:**
   - `account.accountValue` used in divisions (e.g., risk% calculations)
   - No guard for `accountValue === 0`
   - Could cause `Infinity` or `NaN`

3. **riskProfile access:**
   - `riskProfile?.maxPerTradeRiskPct ?? 3` - has fallback but inconsistent
   - Some places use `riskProfile.maxPerTradeRiskPct` directly

### Circular Dependency Risks

**None detected** - all imports are unidirectional:
- Components → Context
- Components → lib utilities
- Context → lib utilities
- No component → component cycles

---

## 7. Safe Extension Points

### ✅ SAFE to Modify Extensively

1. **QuickStartPanel.tsx**
   - Pure presentational component
   - No context dependencies
   - Only reads static config
   - Can add new categories/prompts easily

2. **RightPanel.tsx**
   - Simple read-only component
   - Only reads `account`
   - Can add new wallet features safely

3. **LeftSidebar.tsx**
   - Isolated chat session management
   - Well-defined context interface
   - Can enhance UI without affecting other components

4. **RiskCenter.tsx** (with caution)
   - Self-contained risk display
   - Can add new metrics/cards
   - Be careful with strategy filter logic

5. **PortfolioView.tsx**
   - Read-only display component
   - Can add new charts/visualizations
   - Doesn't mutate state

### ⚠️ Modify with Caution

1. **MessageBubble.tsx**
   - Core strategy card rendering
   - Many components depend on its output
   - Risk evaluation logic embedded
   - **Recommendation:** Extract strategy card to separate component before major changes

2. **Chat.tsx**
   - Central message handling
   - Strategy creation logic embedded
   - Natural-language modification logic
   - **Recommendation:** Extract strategy creation to separate hook/utility

3. **PositionsTray.tsx**
   - Inline editing logic is complex
   - Directly mutates strategies
   - **Recommendation:** Add validation layer before mutations

### 🚫 Do NOT Modify Without Rewriting

1. **BlossomContext.tsx**
   - Single source of truth for all state
   - Many components depend on exact interface
   - **Recommendation:** If refactoring, create new context interface and migrate gradually

2. **mockParser.ts**
   - Core NL parsing logic
   - Used by Chat.tsx extensively
   - **Recommendation:** If replacing, build new parser alongside old one, then switch

3. **CopilotLayout.tsx**
   - Layout structure is critical
   - Height/overflow classes are carefully tuned
   - **Recommendation:** Test layout changes on multiple screen sizes

### 📍 Where to Add New Components

1. **New strategy card types:**
   - Create `components/StrategyCard.tsx` (extract from MessageBubble)
   - Create `components/PerpStrategyCard.tsx`, `components/EventStrategyCard.tsx`
   - Update `MessageBubble.tsx` to use new components

2. **New risk metrics:**
   - Add to `RiskCenter.tsx` as new `CollapsibleSection`
   - Or create `components/risk/` directory for risk-specific components

3. **New onboarding flows:**
   - Create `components/onboarding/` directory
   - Add to `CopilotLayout.tsx` or `Chat.tsx` conditionally

4. **Toast/notification system:**
   - Create `components/Toast.tsx` or use existing UI library
   - Add `ToastProvider` to `BlossomAppShell`
   - Use in `Chat.tsx`, `PositionsTray.tsx` for user feedback

---

## Summary: Safe Changes vs. Isolation Needed

### ✅ Safe to Change

- **UI Components:** QuickStartPanel, RightPanel, LeftSidebar, PortfolioView
- **Styling:** All Tailwind classes (no layout/height changes in CopilotLayout)
- **Static Content:** Landing page components, mock data
- **New Features:** New risk metrics, new quick start prompts, new portfolio views

### ⚠️ Needs Isolation Before Major Changes

- **Strategy Card Rendering:** Extract from MessageBubble to separate component
- **Strategy Creation Logic:** Extract from Chat.tsx to custom hook (`useStrategyCreation`)
- **Natural-Language Modification:** Extract to separate utility or hook
- **Risk Evaluation:** Extract to separate utility function

### 🚫 Requires Careful Planning

- **BlossomContext:** Any changes to interface will affect 17+ components
- **Strategy Status Transitions:** Add validation layer before allowing changes
- **Account Recalculation:** Consider batching/debouncing if performance issues arise
- **Layout Structure:** CopilotLayout height/overflow classes are critical - test thoroughly

### 🎯 Recommended Refactoring Priorities

1. **Extract Strategy Card Component**
   - Create `components/StrategyCard.tsx`
   - Move strategy card JSX from MessageBubble
   - Add proper TypeScript types
   - Makes MessageBubble smaller and strategy cards reusable

2. **Add Strategy Validation Layer**
   - Create `lib/strategyValidation.ts`
   - Validate status transitions, risk limits, required fields
   - Use in `updateStrategy()`, `updateStrategyStatus()`

3. **Extract Strategy Creation Hook**
   - Create `hooks/useStrategyCreation.ts`
   - Move strategy creation logic from Chat.tsx
   - Handles both mock and agent modes
   - Returns clean interface for Chat to use

4. **Unify Watchlist Data**
   - Combine auto-derived positions + manual watchlist in single data structure
   - Add `source: 'auto' | 'manual'` field
   - Simplifies LiquidationWatchlistSection rendering

5. **Add Toast System**
   - Install or create toast component
   - Replace `window.confirm` and inline messages
   - Better UX for user feedback

---

**End of Architecture Map**


