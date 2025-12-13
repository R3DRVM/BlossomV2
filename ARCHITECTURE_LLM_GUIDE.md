# Blossom AI - Architecture & Codebase Guide

**Last Updated**: 2025-12-12

This document provides a comprehensive, LLM-friendly explanation of the Blossom AI codebase architecture, file structure, and data flows. Use this guide to understand where to make changes and how the application works.

---

## 1. Tech Stack & High-Level Architecture

### Frontend

- **Framework**: React 18+ with TypeScript
- **Build Tool**: Vite 5.x (not Next.js)
- **Routing**: React Router v6 (`src/routes/AppRouter.tsx`)
  - Routes: `/` (Landing Page), `/app` (Main Application)
- **Styling**: Tailwind CSS 3.x
  - Config: `tailwind.config.js`
  - Custom theme tokens: `blossom-pink`, `blossom-slate`, etc.
  - Global styles: `src/index.css`
- **State Management**: React Context API (`src/context/BlossomContext.tsx`)
  - Single global context provider wrapping the entire app
  - No Redux, Zustand, or TanStack Query
  - Local component state for UI-only concerns (drawer open/closed, input values, etc.)

### Backend / Agent

- **Runtime**: Node.js (TypeScript)
- **Framework**: Express-like HTTP server (`agent/src/server/http.ts`)
- **Location**: `agent/` directory (separate package)
- **Purpose**: Simulates trading operations and provides LLM-powered chat responses
- **Plugins**: Modular simulation plugins for different asset types:
  - `agent/src/plugins/perps-sim/` - Perpetual futures simulation
  - `agent/src/plugins/defi-sim/` - DeFi yield simulation
  - `agent/src/plugins/event-sim/` - Prediction market simulation

### Communication Layer

- **Mode Toggle**: `USE_AGENT_BACKEND` flag in `src/lib/config.ts`
  - `false` (default): Frontend uses `mockParser.ts` for local-only chat responses
  - `true`: Frontend calls agent API via `src/lib/blossomApi.ts`
- **API Client**: `src/lib/apiClient.ts` - HTTP client wrapper
- **Agent API Base**: Configured in `agent/src/server/http.ts` (typically `http://localhost:3001`)

### Persistence

- **Frontend**: `localStorage` for:
  - Chat sessions (`blossom.chatSessions`)
  - Saved prompts (`blossom.savedPrompts`)
  - Risk profile settings (`blossom.riskProfile`)
- **Backend**: In-memory state (no database)
  - State lives in `agent/src/services/state.ts`
  - Resets on server restart

### External Services

- **LLM Integration**: OpenAI-compatible API (configured in `agent/src/services/llmClient.ts`)
- **Price Data**: Mock/simulated prices (no real market data integration yet)
- **Deployment**:
  - **Frontend**: Vercel (Git integration, auto-deploys on push to `main`)
  - **Backend**: Fly.io (`fly.toml` config, app name: `blossomv2`)

---

## 2. File & Folder Map

### Root Level

- `package.json` - Frontend dependencies and scripts (`npm run dev`, `npm run build`)
- `vite.config.ts` - Vite build configuration
- `tsconfig.json` - TypeScript configuration for frontend
- `tailwind.config.js` - Tailwind CSS theme and custom tokens
- `Dockerfile` - Multi-stage build for Fly.io deployment (builds frontend, serves with nginx)
- `fly.toml` - Fly.io deployment configuration
- `index.html` - Entry HTML file (Vite serves this)

### `src/` - Frontend Source

#### `src/main.tsx`
- **Purpose**: Application entry point
- **What it does**: Renders `<App />` wrapped in React Router, mounts to DOM

#### `src/App.tsx`
- **Purpose**: Top-level app component
- **What it does**: 
  - Wraps app in `BlossomProvider` (context)
  - Renders `AppRouter` for routing
  - Handles tab switching (Copilot / Risk Center / Portfolio Overview)

#### `src/routes/AppRouter.tsx`
- **Purpose**: Route definitions
- **Routes**:
  - `/` → `LandingPage.tsx`
  - `/app` → `BlossomAppShell.tsx` (main app)

#### `src/layouts/BlossomAppShell.tsx`
- **Purpose**: Main app shell layout
- **What it does**: Wraps app in `BlossomProvider` and `ToastProvider`, renders `CopilotLayout`

#### `src/components/` - UI Components

**Layout Components:**
- `CopilotLayout.tsx` - 3-panel layout (Left Sidebar, Center Panel, Right Panel)
- `LeftSidebar.tsx` - Chat history list, user profile, "New Chat" button
- `RightPanel.tsx` - Wallet card, "Positions" button (opens Strategy Drawer)
- `Header.tsx` - Top navigation (mode tabs: Copilot/Risk/Portfolio, venue toggle)

**Core Chat Interface:**
- `Chat.tsx` - Main chat component
  - Message list, input area, typing indicator
  - Handles user messages, calls `mockParser.ts` or agent API
  - Manages chat sessions (create, switch, delete)
  - Renders strategy cards in chat bubbles
- `MessageBubble.tsx` - Individual message rendering
  - User messages (right-aligned)
  - Blossom responses (left-aligned)
  - Strategy cards embedded in messages
- `TypingIndicator.tsx` - "Blossom is thinking..." animation

**Strategy & Positions:**
- `StrategyDrawer.tsx` - **Primary positions surface** (slide-over from right)
  - Self-contained editing interface
  - Tabs: All / Perps / DeFi / Events
  - Inline controls: size, leverage slider, TP/SL, stake, side toggle
  - Uses shared `getOpenPositionsCount()` helper
- `PositionsTray.tsx` - Legacy positions panel (currently disabled via `ENABLE_POSITIONS_TRAY = false`)
- `PositionSummaryCard.tsx` - Perp position summary (used in ContextualPanel)
- `EventSummaryCard.tsx` - Event position summary
- `DeFiSummaryCard.tsx` - DeFi position summary
- `ContextualPanel.tsx` - Detailed position view (not rendered in Copilot view, only in Risk Center)

**Quick Actions & Prompts:**
- `QuickStartPanel.tsx` - Collapsible panel with starter prompts and saved prompts
- `QuickStartDock.tsx` - Dock-style quick actions (if used)

**Risk & Portfolio:**
- `RiskCenter.tsx` - Risk analysis dashboard (Risk Center tab)
- `PortfolioView.tsx` - Portfolio overview with charts (Portfolio Overview tab)
- `RiskBadge.tsx` - Reusable risk level badge (Low/Medium/High)

**Other UI Components:**
- `BlossomHelperOverlay.tsx` - Help/onboarding overlay
- `TickerStrip.tsx` - Price ticker display
- `AccountSummaryStrip.tsx` - Account summary bar
- `SimBanner.tsx` - Simulation mode banner
- `toast/` - Toast notification system (`ToastProvider.tsx`, `useToast.ts`)

#### `src/context/BlossomContext.tsx`
- **Purpose**: Global application state
- **What it manages**:
  - Strategies (perp + event positions)
  - DeFi positions
  - Account state (balances, PnL, exposure)
  - Chat sessions
  - Active tab (copilot/risk/portfolio)
  - Venue (hyperliquid/event_demo)
  - Onboarding state
  - Risk profile
- **Key functions**:
  - `addDraftStrategy()` - Create new strategy
  - `updateStrategyStatus()` - Change strategy status (draft → executed)
  - `updateStrategy()` - Update strategy fields
  - `updateEventStake()` - Update event position stake
  - `closeStrategy()` / `closeEventStrategy()` - Close positions
  - `updatePerpSizeById()` / `updatePerpTpSlById()` / `updatePerpLeverageById()` - Quick perp updates
  - `updateEventStakeById()` / `updateEventSideById()` - Quick event updates
  - `updateDeFiDepositById()` - Quick DeFi updates
  - `getOpenPositionsCount()` - Shared position counting helper
  - `recomputeAccountFromStrategies()` - Recalculate account state from positions

#### `src/lib/` - Utilities & Business Logic

**Core Logic:**
- `mockParser.ts` - **Local-only intent parser** (used when `USE_AGENT_BACKEND = false`)
  - Parses user messages into intents (`trade`, `event`, `defi`, `modify_perp_strategy`, etc.)
  - Returns `ParsedMessage` with strategy details
  - No LLM calls, pure rule-based parsing
- `blossomApi.ts` - **Agent API client** (used when `USE_AGENT_BACKEND = true`)
  - `callBlossomChat()` - Sends message to agent, gets LLM response
  - `getPortfolio()` - Fetches portfolio state from agent
- `apiClient.ts` - HTTP client wrapper (fetch with error handling)
- `config.ts` - Configuration flags (`USE_AGENT_BACKEND`, etc.)

**Data Transformation:**
- `portfolioMapping.ts` - Maps agent portfolio format to frontend state format
- `savedPrompts.ts` - localStorage helpers for saved prompts
- `mockData.ts` - Mock data generators (if used)

**Configuration:**
- `config/quickStartConfig.ts` - Starter prompt templates by venue

#### `src/pages/`
- `LandingPage.tsx` - Marketing landing page

#### `src/assets/`
- `blossom-logo.png` - Logo asset
- `cherry-blossom-bg.png` - Background image

### `agent/` - Backend Agent Service

#### `agent/package.json`
- Separate Node.js package
- Scripts: `npm run dev:agent` (starts HTTP server)

#### `agent/src/index.ts`
- **Purpose**: Agent service entry point
- **What it does**: Initializes state, starts HTTP server, sets up plugins

#### `agent/src/server/`
- `http.ts` - Express-like HTTP server
  - Endpoints: `/chat`, `/portfolio`, `/health`
  - Serves frontend static files in production
- `routes.ts` - Route handlers
- `static.ts` - Static file serving

#### `agent/src/services/`
- `state.ts` - **Global agent state**
  - Portfolio state (positions, balances, account value)
  - State mutations (open/close positions, update balances)
- `llmClient.ts` - LLM API client (OpenAI-compatible)
- `prices.ts` - Mock price data
- `ticker.ts` - Ticker data simulation
- `predictionData.ts` - Event market data simulation

#### `agent/src/plugins/`
- `perps-sim/index.ts` - Perpetual futures simulation
  - Functions: `openPerp()`, `closePerp()`, `getPositions()`
- `defi-sim/index.ts` - DeFi yield simulation
  - Functions: `deposit()`, `withdraw()`, `getPositions()`
- `event-sim/index.ts` - Prediction market simulation
  - Functions: `placeBet()`, `settleEvent()`, `getPositions()`

#### `agent/src/utils/`
- `actionParser.ts` - Parses LLM responses into executable actions

#### `agent/src/characters/`
- `blossom.ts` - Blossom character/persona configuration

#### `agent/src/types/`
- `blossom.ts` - Shared TypeScript types between agent and frontend

---

## 3. Core User Flows & Features

### Flow 1 – Open a Perp Position via Chat

**User Action**: Types "Long ETH with 2% risk" in chat

**Step-by-step**:
1. User types message → `src/components/Chat.tsx` `handleSend()`
2. Message parsed:
   - If `USE_AGENT_BACKEND = false`: `src/lib/mockParser.ts` `parseUserMessage()`
   - If `USE_AGENT_BACKEND = true`: `src/lib/blossomApi.ts` `callBlossomChat()` → agent `/chat` endpoint
3. Parser returns `ParsedMessage` with `intent: 'trade'` and `strategy` object
4. `Chat.tsx` creates draft strategy:
   - Calls `addDraftStrategy()` from `BlossomContext`
   - Strategy status: `'draft'`
5. Strategy card rendered in chat via `MessageBubble.tsx`
6. User clicks "Confirm & Queue":
   - `MessageBubble.tsx` calls `updateStrategyStatus(id, 'executed')`
   - `BlossomContext` updates strategy, recomputes account state
7. Position appears in:
   - Strategy Drawer (auto-opens if first position)
   - RightPanel wallet summary
   - Portfolio view

**Key Files**:
- `src/components/Chat.tsx` (lines ~213-820) - Message handling
- `src/lib/mockParser.ts` - Intent parsing (local mode)
- `src/context/BlossomContext.tsx` - Strategy creation/updates
- `src/components/MessageBubble.tsx` - Strategy card rendering

### Flow 2 – Edit Position in Strategy Drawer

**User Action**: Opens Strategy Drawer, adjusts leverage slider on perp position

**Step-by-step**:
1. User clicks "Positions" button → `src/components/RightPanel.tsx`
2. `RightPanel.tsx` sets `isDrawerOpen = true`
3. `StrategyDrawer.tsx` renders:
   - Filters active positions using `getOpenPositionsCount()` helper
   - Shows perp card with inline controls
4. User drags leverage slider:
   - Slider works on indices (0-5) mapping to `[1, 3, 5, 10, 15, 20]`
   - On release: calls `updatePerpLeverageById(id, leverage)`
5. `BlossomContext.updatePerpLeverageById()`:
   - Updates `strategy.leverage`
   - Recalculates TP/SL from leverage formula
   - Calls `updateStrategy()` to persist
6. UI updates immediately (drawer, wallet, portfolio)

**Key Files**:
- `src/components/StrategyDrawer.tsx` - Drawer UI and controls
- `src/components/RightPanel.tsx` - Drawer toggle
- `src/context/BlossomContext.tsx` - `updatePerpLeverageById()` helper (line ~1066)

### Flow 3 – Flip Event Side (YES/NO Toggle)

**User Action**: Clicks YES/NO button on event card in Strategy Drawer

**Step-by-step**:
1. `StrategyDrawer.tsx` renders `EventStrategyCard`
2. User clicks NO button (currently YES):
   - Calls `updateEventSideById(id, 'NO')`
3. `BlossomContext.updateEventSideById()`:
   - Finds strategy by id
   - Updates `eventSide` field via `updateEventStake()`
   - Keeps stake, risk %, max payout unchanged
4. UI updates: side badge changes, all surfaces reflect new side

**Key Files**:
- `src/components/StrategyDrawer.tsx` - Event card with side toggle (line ~664)
- `src/context/BlossomContext.tsx` - `updateEventSideById()` helper (line ~1129)

### Flow 4 – Show Riskiest Positions (Intent-Driven)

**User Action**: Types "Show my riskiest positions"

**Step-by-step**:
1. `Chat.tsx` receives message
2. `mockParser.ts` detects keywords → `intent: 'show_riskiest_positions'`
3. `Chat.tsx` handles intent (line ~405):
   - Filters active strategies (perps + events)
   - Sorts by `riskPercent` descending
   - Generates summary message
4. Dispatches `openStrategyDrawer` custom event with `strategyId`
5. `RightPanel.tsx` listens for event, opens drawer, highlights strategy

**Key Files**:
- `src/lib/mockParser.ts` - Intent detection (line ~647)
- `src/components/Chat.tsx` - Intent handler (line ~405)
- `src/components/RightPanel.tsx` - Event listener (line ~17)

### Flow 5 – Save & Use Prompt Template

**User Action**: Clicks star icon on quick start prompt, then clicks saved prompt later

**Step-by-step**:
1. User clicks star → `src/components/QuickStartPanel.tsx`
2. Calls `savePrompt()` from `src/lib/savedPrompts.ts`
3. Saves to `localStorage` under `blossom.savedPrompts` key
4. Later, user clicks saved prompt chip:
   - Dispatches `insertChatPrompt` custom event
5. `Chat.tsx` listens for event, inserts text into input field

**Key Files**:
- `src/lib/savedPrompts.ts` - localStorage helpers
- `src/components/QuickStartPanel.tsx` - Save/load UI
- `src/components/Chat.tsx` - Event listener for prompt insertion

---

## 4. State Management & Data Flow

### Global State (`src/context/BlossomContext.tsx`)

**Single Source of Truth**: `BlossomContext` provides all app state via React Context.

**State Structure**:
```typescript
{
  strategies: Strategy[]           // All strategies (perp + event)
  defiPositions: DefiPosition[]     // Active DeFi plans
  account: AccountState             // Balances, PnL, exposure
  chatSessions: ChatSession[]       // Chat history
  activeChatId: string | null       // Current chat
  activeTab: 'copilot' | 'risk' | 'portfolio'
  venue: 'hyperliquid' | 'event_demo'
  riskProfile: RiskProfile          // User risk settings
  // ... update functions
}
```

**How State Updates**:
1. User action (click, input, etc.) → Component calls context function
2. Context function updates state via `setStrategies()`, `setAccount()`, etc.
3. All subscribed components re-render automatically
4. Derived calculations (risk %, PnL) recomputed via `recomputeAccountFromStrategies()`

**Important State Helpers**:
- `getOpenPositionsCount()` - Counts truly open positions (used by RightPanel badge and Drawer header)
- `isOpenPerp()` / `isOpenEvent()` / `isActiveDefi()` - Position type checkers
- `updatePerpSizeById()` - Updates perp size, recalculates risk %
- `updatePerpLeverageById()` - Updates leverage, recalculates TP/SL
- `updatePerpTpSlById()` - Updates TP/SL, recalculates leverage
- `updateEventStakeById()` - Updates event stake, recalculates risk % and max payout
- `updateEventSideById()` - Flips event side (YES/NO)

### Local Component State

**UI-Only State** (not in global context):
- Drawer open/closed: `useState` in `RightPanel.tsx`
- Input field values: `useState` in `StrategyDrawer.tsx` cards
- Typing indicator: `useState` in `Chat.tsx`
- Tab selection: `useState` in `StrategyDrawer.tsx`

### Data Flow Patterns

**Strategy Creation**:
```
User message → mockParser → ParsedMessage → addDraftStrategy() → strategies[] updated → UI re-renders
```

**Position Update**:
```
User edits in drawer → updatePerpSizeById() → updateStrategy() → strategies[] updated → recomputeAccountFromStrategies() → account updated → UI re-renders
```

**Chat Session Management**:
```
User creates chat → createNewChatSession() → chatSessions[] updated → localStorage saved → UI shows new chat
```

---

## 5. API / Backend Integration

### Frontend → Backend Communication

**Mode Toggle**: `src/lib/config.ts` defines `USE_AGENT_BACKEND` flag

**When `USE_AGENT_BACKEND = false` (Default - Local Mode)**:
- All chat handled by `src/lib/mockParser.ts`
- No HTTP calls to agent
- Pure frontend simulation
- Strategy execution happens in `BlossomContext` directly

**When `USE_AGENT_BACKEND = true` (Agent Mode)**:
- Chat messages sent to agent via `src/lib/blossomApi.ts`
- Agent endpoint: `/chat` (POST)
- Agent returns LLM-generated response
- Portfolio state synced via `/portfolio` endpoint
- Agent state lives in `agent/src/services/state.ts`

### Agent API Endpoints

**Location**: `agent/src/server/http.ts`

**Endpoints**:
- `POST /chat` - Send user message, get LLM response
- `GET /portfolio` - Get current portfolio state
- `GET /health` - Health check

**Agent Response Format**:
- Chat response: `{ text: string, actions?: BlossomAction[] }`
- Actions parsed by `agent/src/utils/actionParser.ts`
- Actions executed by plugins (`perps-sim`, `defi-sim`, `event-sim`)

### Environment Variables

**Frontend**:
- No `.env` file required for local development
- `USE_AGENT_BACKEND` hardcoded in `src/lib/config.ts`

**Backend**:
- `agent/.env.example` - Template for agent env vars
- LLM API key configured in `agent/src/services/llmClient.ts`

### Error Handling

**Frontend**:
- API errors caught in `src/lib/apiClient.ts`
- Errors shown via toast notifications (`src/components/toast/`)
- Fallback to local mode if agent unavailable

**Backend**:
- Errors logged to console
- HTTP errors returned as JSON with error messages

---

## 6. Configuration, Environment & Deployment

### Build Configuration

**Frontend**:
- `vite.config.ts` - Vite build settings
- `tsconfig.json` - TypeScript compiler options
- `tailwind.config.js` - Tailwind theme and custom tokens

**Backend**:
- `agent/tsconfig.json` - Agent TypeScript config
- `agent/package.json` - Agent dependencies

### Environment Files

- No `.env` files committed (use `.env.example` as template)
- Configuration flags in `src/lib/config.ts`

### Deployment Configuration

**Vercel (Frontend)**:
- Git integration (auto-deploys on push to `main`)
- No `vercel.json` file (uses Vercel defaults)
- Build command: `npm run build`
- Output directory: `dist/`

**Fly.io (Backend)**:
- `fly.toml` - Fly.io app configuration
  - App name: `blossomv2`
  - Region: `lax` (Los Angeles)
  - Memory: 1GB
  - Auto-start/stop enabled
- `Dockerfile` - Multi-stage build:
  - Stage 1: Build frontend with Node.js
  - Stage 2: Serve with nginx
- Deploy command: `flyctl deploy --remote-only`

### Build Scripts (`package.json`)

- `npm run dev` - Start Vite dev server (frontend)
- `npm run build` - Build frontend for production
- `npm run preview` - Preview production build
- `npm run dev:agent` - Start agent server (in `agent/` directory)
- `npm run dev:all` - Run both frontend and agent concurrently

---

## 7. "Where To Change What" Cheat Sheet

### Leverage Slider Behavior & Visuals
- **Main component**: `src/components/StrategyDrawer.tsx` (line ~447-495)
  - Discrete tick array: `LEVERAGE_TICKS = [1, 3, 5, 10, 15, 20]`
  - Slider state: `leverageIndex` (0-5)
  - Visual tick lines: `inset-x-1` positioned divs
  - Update handler: `handleLeverageSliderRelease()` calls `updatePerpLeverageById()`
- **Update logic**: `src/context/BlossomContext.tsx` `updatePerpLeverageById()` (line ~1066)
  - Formula: `spread = (entry * leverage) / 10`
  - Recalculates TP/SL from leverage
- **Type definition**: `src/context/BlossomContext.tsx` `Strategy` interface (line ~24) - `leverage?: number`

### Strategy Drawer UI & Controls
- **Main component**: `src/components/StrategyDrawer.tsx`
  - Header count: Uses `getOpenPositionsCount()` (line ~38)
  - Perp cards: Size, leverage, TP/SL controls (line ~229-583)
  - Event cards: Stake, side toggle (line ~585-700)
  - DeFi cards: Deposit, Max button (line ~700+)
- **Position counting**: `src/context/BlossomContext.tsx` `getOpenPositionsCount()` (line ~252)
- **Empty state**: `src/components/StrategyDrawer.tsx` (line ~135-150)

### Risk/Guardrails Configuration
- **Risk caps**: `src/components/Chat.tsx` (line ~415) - `maxEventRiskPct = 0.03` (3%)
- **Risk profile**: `src/context/BlossomContext.tsx` `RiskProfile` interface
- **RiskBadge thresholds**: `src/components/RiskBadge.tsx`
  - Low: ≤ 2%
  - Medium: > 2% and ≤ 5%
  - High: > 5%
- **Position counting logic**: `src/context/BlossomContext.tsx` `isOpenPerp()`, `isOpenEvent()`, `isActiveDefi()` (line ~228-250)

### Execution / Order Submission Flow
- **Local mode**: `src/components/Chat.tsx` → `addDraftStrategy()` → `updateStrategyStatus('executed')`
- **Agent mode**: `src/lib/blossomApi.ts` → agent `/chat` → `agent/src/utils/actionParser.ts` → plugins execute
- **Strategy creation**: `src/context/BlossomContext.tsx` `addDraftStrategy()` (line ~435)
- **Status updates**: `src/context/BlossomContext.tsx` `updateStrategyStatus()` (line ~500)

### Layout & Navigation Shell
- **Main layout**: `src/components/CopilotLayout.tsx`
  - 3-panel structure (Left, Center, Right)
  - Mode tabs (Copilot/Risk/Portfolio)
  - Venue toggle
- **App shell**: `src/layouts/BlossomAppShell.tsx` - Wraps in providers
- **Routing**: `src/routes/AppRouter.tsx` - Route definitions
- **Top nav**: `src/components/Header.tsx` - Logo, tabs, venue buttons

### AI / Model Integration
- **Local parsing**: `src/lib/mockParser.ts` - Rule-based intent parsing (no LLM)
- **Agent LLM**: `agent/src/services/llmClient.ts` - OpenAI-compatible API client
- **Agent chat handler**: `agent/src/server/routes.ts` - `/chat` endpoint
- **Action parsing**: `agent/src/utils/actionParser.ts` - Converts LLM text to executable actions
- **Character config**: `agent/src/characters/blossom.ts` - Blossom persona/prompts

### Intent Parsing & Chat Logic
- **Parser**: `src/lib/mockParser.ts` `parseUserMessage()`
  - Detects intents: `trade`, `event`, `defi`, `modify_perp_strategy`, `modify_event_strategy`, `show_riskiest_positions`, etc.
  - Returns `ParsedMessage` with strategy details
- **Chat handler**: `src/components/Chat.tsx` `handleSend()`
  - Routes to appropriate intent handler
  - Creates strategies, updates positions, generates responses

### Position State & Updates
- **Global state**: `src/context/BlossomContext.tsx`
  - `strategies[]` - All strategies
  - `defiPositions[]` - DeFi plans
  - `account` - Account state
- **Update helpers**: `src/context/BlossomContext.tsx`
  - `updatePerpSizeById()` - Perp size updates
  - `updatePerpLeverageById()` - Leverage updates
  - `updatePerpTpSlById()` - TP/SL updates
  - `updateEventStakeById()` - Event stake updates
  - `updateEventSideById()` - Event side flips
  - `updateDeFiDepositById()` - DeFi deposit updates

### Saved Prompts System
- **Storage**: `src/lib/savedPrompts.ts` - localStorage helpers
- **UI**: `src/components/QuickStartPanel.tsx` - Save/load interface
- **Integration**: `src/components/Chat.tsx` - Listens for `insertChatPrompt` event

### Risk Badge Component
- **Component**: `src/components/RiskBadge.tsx`
- **Usage**: Imported in `StrategyDrawer.tsx`, `MessageBubble.tsx`, `ContextualPanel.tsx`
- **Props**: `riskPercent?: number | null`

### Agent Simulation Plugins
- **Perps**: `agent/src/plugins/perps-sim/index.ts` - `openPerp()`, `closePerp()`
- **DeFi**: `agent/src/plugins/defi-sim/index.ts` - `deposit()`, `withdraw()`
- **Events**: `agent/src/plugins/event-sim/index.ts` - `placeBet()`, `settleEvent()`

---

## Key Architectural Decisions

1. **Single Context for State**: All global state in `BlossomContext.tsx` - no Redux/Zustand
2. **Local-First by Default**: `USE_AGENT_BACKEND = false` means no backend required for basic functionality
3. **Self-Contained Drawer**: Strategy Drawer is primary editing surface, no navigation to other panels
4. **Shared Helpers**: Position counting, update functions centralized in context
5. **Discrete Leverage**: Leverage slider only allows preset values (1x, 3x, 5x, 10x, 15x, 20x)
6. **Type Safety**: Full TypeScript, shared types between frontend and agent

---

## Common Modification Patterns

**To add a new intent**:
1. Add intent to `ParsedIntent` type in `src/lib/mockParser.ts`
2. Add detection logic in `parseUserMessage()`
3. Add handler in `src/components/Chat.tsx` `handleSend()`

**To add a new position type**:
1. Extend `Strategy` interface in `src/context/BlossomContext.tsx`
2. Add card component in `src/components/StrategyDrawer.tsx`
3. Add update helper in `BlossomContext.tsx`
4. Update `getOpenPositionsCount()` if needed

**To change risk calculation**:
1. Find calculation in `src/context/BlossomContext.tsx` update helpers
2. Modify formula, ensure `recomputeAccountFromStrategies()` is called

**To modify UI styling**:
1. Check `tailwind.config.js` for custom tokens
2. Edit component files directly (Tailwind classes)
3. Global styles in `src/index.css`

---

This guide should enable another LLM to make targeted changes to specific features without needing to understand the entire codebase first.

