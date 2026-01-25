# Blossom Repository Map

**Last Updated:** 2025-01-XX  
**Project:** Blossom (formerly Bloom) - AI Trading Copilot with Execution Layer

---

## Project Summary

- **Purpose**: AI-powered trading copilot that abstracts chains, venues, and assets. Users express intent in natural language, Blossom generates execution plans and routes across optimal venues.
- **Architecture**: React frontend (Vite) + Express backend agent (optional) + Foundry smart contracts (Sepolia testnet)
- **Execution Modes**: Simulation (default), Direct (user signs), Session (one-click via relayer)
- **Venues Supported**: Perpetuals (sim), Event Markets (sim), DeFi lending (sim + Sepolia), Swaps (Sepolia Uniswap)
- **LLM Integration**: Supports OpenAI, Anthropic, Gemini, or stub mode (no API keys)
- **Deployment**: Frontend builds to static files (nginx), agent runs as Node.js service, contracts deploy to Sepolia
- **Testing**: Playwright E2E tests, Foundry contract tests, smoke test scripts
- **Key Feature**: Natural language → execution plan → on-chain transaction (Sepolia) or simulation (demo)
- **Production Status**: MVP on Sepolia testnet, simulation mode for demos
- **Critical Path**: User message → LLM → action parser → execution prepare → plan → sign → execute → portfolio sync

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (React)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐  │
│  │   Chat.tsx   │→ │ blossomApi.ts│→ │   apiClient.ts      │  │
│  │ (UI Entry)   │  │ (API Wrapper)│  │ (HTTP + Health Gate) │  │
│  └──────────────┘  └──────────────┘  └─────────────────────┘  │
│         │                    │                    │              │
│         └────────────────────┼────────────────────┘              │
│                              │                                    │
│                    ┌─────────▼─────────┐                          │
│                    │  mockParser.ts    │ (fallback if no backend)│
│                    └───────────────────┘                          │
└───────────────────────────────┬───────────────────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │   Agent Backend       │
                    │  (Express, Port 3001) │
                    └───────────┬───────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
┌───────▼────────┐   ┌──────────▼──────────┐  ┌────────▼────────┐
│  LLM Client    │   │  Action Parser      │  │  Executors      │
│ (OpenAI/       │   │  (Validates JSON)   │  │  - evmRpc       │
│  Anthropic/     │   │                     │  │  - relayer      │
│  Gemini/Stub)  │   │                     │  │  - evmReceipt  │
└────────────────┘   └─────────────────────┘  └────────┬────────┘
                                                        │
                                        ┌───────────────┼───────────────┐
                                        │               │               │
                                ┌───────▼────┐  ┌──────▼─────┐  ┌──────▼─────┐
                                │  Plugins   │  │  Providers │  │   Quotes   │
                                │  - perps   │  │  - dflow   │  │  - uniswap │
                                │  - defi    │  │  - fallback│  │  - defi    │
                                │  - event   │  └────────────┘  │  - event   │
                                └────────────┘                  └────────────┘
                                        │
                                        │
                    ┌───────────────────▼───────────────────┐
                    │      Smart Contracts (Foundry)         │
                    │  ┌─────────────────────────────────┐   │
                    │  │  ExecutionRouter.sol           │   │
                    │  │  (EIP-712 Plan Execution)     │   │
                    │  └─────────────────────────────────┘   │
                    │  ┌─────────────────────────────────┐   │
                    │  │  MockSwapAdapter.sol           │   │
                    │  │  (Demo Swap Adapter)           │   │
                    │  └─────────────────────────────────┘   │
                    └─────────────────────────────────────────┘
                                        │
                                        │
                    ┌───────────────────▼───────────────────┐
                    │         Sepolia Testnet               │
                    │  (Deployed Contracts + User Wallets)  │
                    └───────────────────────────────────────┘
```

---

## Folder-by-Folder Map

### `/` (Root)

**Purpose**: Project root with configuration, documentation, and orchestration scripts.

**Key Files**:
- `package.json` - Frontend dependencies and scripts (`dev`, `build`, `dev:all`)
- `vite.config.ts` - Vite build config (port 5173, React plugin)
- `tsconfig.json` - TypeScript config (excludes `_suddengreencard`)
- `Dockerfile` - Production build (Node → nginx static files)
- `fly.toml` - Fly.io deployment config (app: blossomv2)
- `playwright.config.ts` - E2E test config (tests `./e2e`, backend URL: localhost:3001)
- `nginx.conf` - SPA fallback routing for production
- `README.md` - Main project documentation (getting started, architecture)
- `QUICK_START.md` - Quick start guide (services, mock mode, agent mode)

**Runtime Criticality**: **Critical** (build configs, deployment)

**Interfaces**:
- Frontend depends on root `package.json` scripts
- Dockerfile builds frontend and serves via nginx
- Scripts in `/scripts` orchestrate multi-service workflows

---

### `/agent` (Backend Agent Service)

**Purpose**: Express.js HTTP server that provides LLM integration, execution planning, portfolio sync, and blockchain interaction. Optional - frontend can run in mock mode without it.

**Key Entrypoints**:
- `agent/src/server/http.ts` - Main Express server (entrypoint via `npm run dev:agent`)
- `agent/src/index.ts` - Exports character and types (library entrypoint)
- `agent/src/services/llmClient.ts` - LLM provider abstraction (OpenAI/Anthropic/Gemini/Stub)
- `agent/src/utils/actionParser.ts` - Validates and parses `BlossomAction[]` from LLM JSON
- `agent/src/types/execution.ts` - Execution request/response types (`ExecutePrepareRequest`, `Plan`)

**Key Subfolders**:

#### `agent/src/executors/` - **Critical**
- `evmRpc.ts` - RPC calls to Ethereum (get balance, call, sendTransaction)
- `evmReceipt.ts` - Transaction receipt polling and status checking
- `relayer.ts` - Session mode transaction relaying (signs with `RELAYER_PRIVATE_KEY`)
- `ethTestnetExecutor.ts` - Sepolia-specific execution logic
- `erc20Rpc.ts` - ERC20 token operations (balance, approve, transfer)

#### `agent/src/plugins/` - **Important** (Simulation)
- `perps-sim/index.ts` - Perpetual futures simulation (no real orders)
- `defi-sim/index.ts` - DeFi lending simulation (yield calculations)
- `event-sim/index.ts` - Event market simulation (prediction markets)

#### `agent/src/providers/` - **Important**
- `dflowProvider.ts` - dFlow blockchain provider (event markets)
- `fallbackProvider.ts` - Fallback RPC provider chain
- `providerRegistry.ts` - Provider selection and failover

#### `agent/src/quotes/` - **Important**
- `uniswapQuoter.ts` - Uniswap swap quotes (Sepolia)
- `oneInchQuote.ts` - 1inch aggregator quotes
- `defiLlamaQuote.ts` - DeFi yield vault data (APY, TVL)
- `eventMarkets.ts` - Kalshi/Polymarket market data
- `lendingQuote.ts` - Lending protocol quotes (Aave, Compound)
- `evmQuote.ts` - Generic EVM quote interface

#### `agent/src/services/` - **Critical**
- `llmClient.ts` - LLM provider (OpenAI/Anthropic/Gemini/Stub)
- `state.ts` - In-memory portfolio state (simulation mode)
- `ticker.ts` - Price feed service (CoinGecko integration)
- `prices.ts` - Price aggregation and caching
- `predictionData.ts` - Prediction market data fetching

#### `agent/src/integrations/` - **Optional**
- `dflow/` - dFlow integration (event markets, client, tests)

#### `agent/src/telemetry/` - **Optional**
- `logger.ts` - Execution telemetry logging

#### `agent/src/utils/` - **Critical**
- `actionParser.ts` - LLM JSON → `BlossomAction[]` validation
- `accessGate.ts` - Access control (whitelist mode)
- `executionLogger.ts` - Execution logging
- `demoTokenMinter.ts` - Demo token minting (testnet)

**API Endpoints** (from `agent/src/server/http.ts`):
- `POST /api/chat` - Chat with Blossom agent (LLM → actions)
- `POST /api/execute/prepare` - Generate execution plan (Plan + EIP-712 data)
- `POST /api/execute/submit` - Submit transaction hash
- `POST /api/session/prepare` - Create session (session mode)
- `POST /api/execute/relayed` - Execute via relayer (session mode)
- `GET /api/portfolio/eth_testnet` - Get portfolio balances (Sepolia)
- `GET /api/wallet/balances` - Get wallet balances (ETH + tokens)
- `GET /api/execute/preflight` - Check execution readiness (contracts, RPC)
- `GET /health` - Health check
- `POST /api/strategy/close` - Close a strategy
- `POST /api/reset` - Reset simulation state

**Runtime Criticality**: **Important** (optional for mock mode, required for live execution)

**Interfaces**:
- Frontend calls via `src/lib/apiClient.ts` → `src/lib/blossomApi.ts`
- Environment: `VITE_USE_AGENT_BACKEND=true` enables backend mode
- Port: 3001 (configurable via `PORT` env var)
- Shared types: `agent/src/types/blossom.ts` (re-exported by frontend)

**Scripts**:
- `agent/scripts/e2e-sepolia-smoke.ts` - E2E smoke test (Sepolia execution flow)
- `agent/scripts/e2e-mvp-full-flow.ts` - Full MVP flow test

---

### `/src` (Frontend React Application)

**Purpose**: React + TypeScript frontend built with Vite. Provides chat UI, portfolio view, risk center, and execution confirmation.

**Key Entrypoints**:
- `src/main.tsx` - React app entrypoint (renders `AppRouter` with context providers)
- `src/App.tsx` - Main app component (tab navigation, command bar)
- `src/routes/AppRouter.tsx` - React Router (routes: `/` → LandingPage, `/app` → BlossomAppShell)
- `src/components/Chat.tsx` - Main chat interface (message handling, execution flow)
- `src/lib/blossomApi.ts` - Backend API client (`callBlossomChat`, `closeStrategy`)
- `src/lib/mockParser.ts` - Mock message parser (fallback when backend unavailable)
- `src/context/BlossomContext.tsx` - Global state (strategies, portfolio, active tab)
- `src/context/ExecutionContext.tsx` - Execution state (pending plans, last action)

**Key Subfolders**:

#### `src/components/` - **Critical** (65 files)
- `Chat.tsx` - Main chat UI (message bubbles, execution flow, wallet integration)
- `MessageBubble.tsx` - Message rendering (user/assistant, rich cards)
- `ConfirmTradeCard.tsx` - Execution confirmation card (plan details, confirm button)
- `PortfolioView.tsx` - Portfolio display (positions, balances, exposure)
- `RiskCenter.tsx` - Risk analysis UI (VaR, correlations, alerts)
- `DeFiView.tsx` - DeFi positions view
- `StrategyDrawer.tsx` - Strategy details drawer
- `PositionEditorCard.tsx` - Position editing UI
- `OneClickExecution.tsx` - One-click execution UI (session mode)
- `CreateSession.tsx` - Session creation UI
- `RevokeSession.tsx` - Session revocation UI
- `SessionStatus.tsx` - Session status indicator
- `execution/ExecutionPlanCard.tsx` - Execution plan display
- `positions/PerpPositionEditor.tsx` - Perp position editor
- `positions/EventPositionEditor.tsx` - Event position editor
- `risk/CorrelationMatrix.tsx` - Risk correlation matrix
- `ui/` - Reusable UI components (Button, Card, Badge, etc.)

#### `src/lib/` - **Critical**
- `blossomApi.ts` - Backend API client (chat, close, reset)
- `apiClient.ts` - HTTP client with health gate (blocks calls if backend offline)
- `mockParser.ts` - Mock intent parser (fallback, no backend needed)
- `config.ts` - Frontend config (execution mode, auth mode, backend URL)
- `walletAdapter.ts` - Wallet integration (MetaMask, connect, sendTransaction)
- `walletBalances.ts` - Wallet balance fetching
- `portfolioMapping.ts` - Portfolio data transformation
- `portfolioComputed.ts` - Portfolio calculations (exposure, risk)
- `format.ts` - Number/currency formatting
- `perpDisplay.ts` - Perp position formatting
- `polymarket.ts` - Polymarket integration
- `eventMarkets.ts` - Event market data
- `defiProtocols.ts` - DeFi protocol definitions
- `demoPriceFeed.ts` - Demo price feed (fallback)
- `liveSpot.ts` - Live spot price fetching
- `riskAlerts.ts` - Risk alert generation
- `riskIntent.ts` - High-risk intent detection
- `savedPrompts.ts` - Saved prompt management

#### `src/context/` - **Critical**
- `BlossomContext.tsx` - Global app state (strategies, portfolio, activeTab, venue)
- `ExecutionContext.tsx` - Execution state (pendingPlans, lastAction)
- `ActivityFeedContext.tsx` - Activity feed state

#### `src/layouts/` - **Critical**
- `BlossomAppShell.tsx` - Main app shell (header, tabs, content area)

#### `src/pages/` - **Important**
- `LandingPage.tsx` - Landing page (marketing)

#### `src/config/` - **Important**
- `quickStartConfig.ts` - Quick start configuration

#### `src/assets/` - **Optional**
- `blossom-logo.png`, `cherry-blossom-bg.png` - Brand assets

#### `src/_suddengreencard/` - **Legacy/Sandbox** ⚠️
**Status**: Not used in runtime. Excluded from `tsconfig.json`. Appears to be a separate UI library/component set (possibly from a different project or experiment).

**Purpose**: Contains a full-stack application structure with:
- `client/` - React client with extensive UI component library
- `server/` - Backend server code
- `shared/` - Shared schema/types

**Runtime Criticality**: **Legacy** (excluded from build, not imported anywhere)

**Recommendation**: Can be safely ignored or removed if not needed for future work.

**Runtime Criticality**: **Critical** (core frontend application)

**Interfaces**:
- Calls backend via `src/lib/apiClient.ts` (if `VITE_USE_AGENT_BACKEND=true`)
- Falls back to `src/lib/mockParser.ts` if backend unavailable
- Wallet integration via `src/lib/walletAdapter.ts` (MetaMask)
- Environment: `.env.local` (gitignored) for `VITE_USE_AGENT_BACKEND`, `VITE_AGENT_API_URL`

---

### `/contracts` (Smart Contracts)

**Purpose**: Foundry workspace for Blossom execution router and adapters. Deploys to Sepolia testnet.

**Key Files**:
- `contracts/foundry.toml` - Foundry config (Solidity 0.8.25, optimizer, OpenZeppelin remappings)
- `contracts/README.md` - Contract documentation (setup, deployment, testing)
- `contracts/scripts/deploy-sepolia.sh` - Deployment script (checks env, builds, tests, deploys)

**Contracts** (from README):
- `ExecutionRouter.sol` - Main router (executes signed plans atomically, EIP-712 verification)
- `IAdapter.sol` - Adapter interface
- `PlanTypes.sol` - EIP-712 types and hashing utilities
- `MockSwapAdapter.sol` - Mock adapter for testing

**Runtime Criticality**: **Critical** (required for Sepolia execution)

**Interfaces**:
- Backend reads contract addresses from env vars (`EXECUTION_ROUTER_ADDRESS`, `MOCK_SWAP_ADAPTER_ADDRESS`)
- Deployment outputs to `DEPLOY_OUTPUT_TEMPLATE.env`
- Tests: `forge test` (in `contracts/` directory)

**Deployment**:
- Requires: `SEPOLIA_RPC_URL`, `DEPLOYER_PRIVATE_KEY`
- Command: `./contracts/scripts/deploy-sepolia.sh`
- Output: Contract addresses printed to console (copy to backend `.env`)

---

### `/scripts` (Utility Scripts)

**Purpose**: Shell scripts for development, testing, deployment, and verification.

**Scripts** (13 total):

1. **`mvp-verify.sh`** - **Critical**
   - Verifies MVP readiness (contract tests, builds, backend health, endpoints, testnet config)
   - Options: `--start-backend` (auto-start backend if not running)
   - Environment: `EXECUTION_MODE=eth_testnet`, `TEST_USER_ADDRESS`

2. **`endpoint-smoke-test.sh`** - **Important**
   - Smoke tests backend endpoints (`/health`, `/api/execute/preflight`, `/api/portfolio/eth_testnet`)

3. **`eth-testnet-smoke.sh`** - **Important**
   - Sepolia-specific smoke tests

4. **`demo-readiness.sh`** - **Important**
   - Checks demo readiness (API endpoints, session endpoints, execution preflight)

5. **`demo-smoke.sh`** - **Optional**
   - Demo smoke tests

6. **`deploy-and-verify-sepolia.sh`** - **Important**
   - Deploys contracts to Sepolia and verifies deployment

7. **`check-backend.sh`** - **Optional**
   - Checks backend health

8. **`debug-chat.sh`** - **Optional**
   - Debug chat endpoint

9. **`local-mvp-check.sh`** - **Optional**
   - Local MVP checks

10. **`restart-demo.sh`** - **Optional**
    - Restarts demo services

11. **`ui-wallet-check.sh`** - **Optional**
    - UI wallet checks

12. **`v1-smoke.sh`** - **Optional**
    - V1 smoke tests

13. **`demo-ready-check.sh`** - **Optional**
    - Demo readiness check

**Runtime Criticality**: **Important** (development and deployment tooling)

**Interfaces**:
- Scripts call backend APIs, run `forge` commands, check environment variables
- Used in CI/CD and local development workflows

---

### `/docs` (Documentation)

**Purpose**: Project documentation (34 markdown files). Mix of implementation notes, runbooks, audits, and requirements.

**Canonical Documentation** (Source of Truth):

1. **MVP Requirements**: `docs/V1_MVP_REQUIREMENTS.md`
   - V1 testnet MVP requirements and implementation status
   - Core requirements, phases, priorities

2. **Session Mode**: `docs/SESSION_MODE_AUDIT.md`, `docs/SESSION_MODE_RUNBOOK.md`
   - Session mode implementation audit
   - Session mode runbook (setup, testing)

3. **Wallet Model**: `docs/WALLET_MODEL_DECISION.md`
   - Wallet model decision and recommendation

4. **Demo Readiness**: `docs/DEMO_READINESS_AUDIT.md`, `docs/V1_DEMO_CHECKLIST.md`
   - Demo readiness audit
   - V1 demo checklist (step-by-step testing)

5. **Deployment**: `docs/TESTNET_MVP_STATUS.md`, `docs/END_TO_END_RUNBOOK.md`
   - Testnet MVP status (deployed contracts, env vars, quick start)
   - End-to-end runbook

6. **Execution**: `docs/EXECUTION_RUNBOOK.md`, `docs/AI_EXECUTION_BOUNDARY.md`
   - Execution runbook
   - AI execution boundary (what AI can/cannot do)

**Other Notable Docs**:
- `docs/V1_IMPLEMENTATION_PLAN.md` - V1 implementation plan
- `docs/V1_IMPLEMENTATION_SUMMARY.md` - V1 implementation summary
- `docs/V1_DELIVERABLES.md` - V1 deliverables
- `docs/MVP_BULLETPROOF_DELIVERABLES.md` - MVP deliverables checklist
- `docs/PHASE_1_RUNBOOK.md` - Phase 1 verification runbook
- `docs/LOCAL_BOOT.md` - Local boot instructions
- `docs/AI_AGENT_FLOW.md` - AI agent flow documentation

**Runtime Criticality**: **Optional** (documentation only, not used by runtime)

---

### `/e2e` (End-to-End Tests)

**Purpose**: Playwright E2E tests for API and integration testing.

**Files**:
- `e2e/testnet-v1.spec.ts` - Testnet V1 acceptance tests
  - Tests: health, preflight, demo swap, lending, perps proof, events proof, session mode, wallet balance API

**Runtime Criticality**: **Important** (testing, not used by runtime)

**Interfaces**:
- Tests call backend APIs directly (no browser automation for most tests)
- Backend URL: `BACKEND_URL` env var (default: `http://localhost:3001`)
- Frontend URL: `FRONTEND_URL` env var (default: `http://localhost:5173`)

**What "Passing" Implies**:
- Backend endpoints are functional
- Execution prepare returns valid plans
- Session mode works
- Portfolio endpoints return data
- Wallet balance API works

---

### `/screenshots` (UI Screenshots)

**Purpose**: UI screenshots for documentation and reference.

**Subfolders**:
- `CurrentIssues/` - Screenshots of current issues
- `DefiSim/` - DeFi simulation screenshots

**Runtime Criticality**: **Optional** (documentation assets)

---

## Runtime Paths

### User Types Intent → Execution Flow

**Path 1: Mock Mode (No Backend)**
```
User types in Chat.tsx
  → parseUserMessage() (mockParser.ts)
  → generateBlossomResponse() (mockParser.ts)
  → Creates Strategy in BlossomContext
  → Renders ExecutionPlanCard
  → User clicks "Confirm"
  → Simulates execution (no real transaction)
  → Updates portfolio state (local)
```

**Path 2: Agent Mode (Backend Available)**
```
User types in Chat.tsx
  → callBlossomChat() (blossomApi.ts)
  → callAgent() (apiClient.ts) [health gate check]
  → POST /api/chat (agent/src/server/http.ts)
  → buildBlossomPrompts() (actionParser.ts)
  → callLlm() (llmClient.ts) [OpenAI/Anthropic/Gemini/Stub]
  → validateActions() (actionParser.ts)
  → Returns ChatResponse { assistantMessage, actions, executionRequest?, portfolio }
  → Frontend creates Strategy
  → Renders ExecutionPlanCard
  → User clicks "Confirm & Execute"
  → POST /api/execute/prepare (agent/src/server/http.ts)
  → ethTestnetExecutor.prepareExecution() (ethTestnetExecutor.ts)
  → Builds Plan + EIP-712 typed data
  → Returns ExecutePrepareResponse { plan, typedData, to, value, data }
  → Frontend: sendTransaction() (walletAdapter.ts)
  → MetaMask prompts user to sign
  → Transaction sent to Sepolia
  → POST /api/execute/submit (agent/src/server/http.ts)
  → evmReceipt.pollReceipt() (evmReceipt.ts)
  → Returns execution status
  → Frontend polls portfolio: GET /api/portfolio/eth_testnet
  → Portfolio updates in UI
```

**Path 3: Session Mode (One-Click)**
```
User enables session (CreateSession.tsx)
  → POST /api/session/prepare (agent/src/server/http.ts)
  → Returns session creation transaction
  → User signs once (MetaMask)
  → Session created on-chain
  → User types intent → same as Path 2 until "Confirm & Execute"
  → POST /api/execute/prepare (with authMode: 'session')
  → Returns session-wrapped plan
  → POST /api/execute/relayed (agent/src/server/http.ts)
  → relayer.relayTransaction() (relayer.ts)
  → Relayer signs and sends transaction
  → No MetaMask prompt for user
  → Execution completes
  → Portfolio updates
```

**Key Functions**:
- `src/components/Chat.tsx:handleSendMessage()` - Entry point for user messages
- `src/lib/blossomApi.ts:callBlossomChat()` - Backend API call
- `agent/src/server/http.ts:POST /api/chat` - Backend chat handler
- `agent/src/utils/actionParser.ts:buildBlossomPrompts()` - LLM prompt builder
- `agent/src/services/llmClient.ts:callLlm()` - LLM provider call
- `agent/src/server/http.ts:POST /api/execute/prepare` - Execution plan generator
- `agent/src/executors/ethTestnetExecutor.ts:prepareExecution()` - Plan builder
- `src/lib/walletAdapter.ts:sendTransaction()` - Wallet transaction sender
- `agent/src/executors/relayer.ts:relayTransaction()` - Session mode relayer

---

## Commands / Workflows

### Local Development

**Frontend Only (Mock Mode)**:
```bash
npm run dev
# Frontend runs on http://localhost:5173
# Uses mockParser.ts (no backend needed)
```

**Backend Only**:
```bash
cd agent && npm run dev:agent
# Backend runs on http://localhost:3001
# Requires: .env file with API keys (optional, stub mode works)
```

**Both Services**:
```bash
npm run dev:all
# Starts both frontend and backend concurrently
# Requires: .env.local with VITE_USE_AGENT_BACKEND=true
```

**With Live Prices**:
```bash
# Create .env.local at root:
VITE_USE_AGENT_BACKEND=true
VITE_AGENT_API_URL=http://localhost:3001

# Start both:
npm run dev:all
```

### Demo Smoke Test

```bash
# Start backend:
cd agent && npm run dev:agent

# In another terminal, run verification:
./scripts/mvp-verify.sh --start-backend

# Or run demo readiness check:
./scripts/demo-readiness.sh
```

### Sepolia Deploy & Verify

**Deploy Contracts**:
```bash
cd contracts
export SEPOLIA_RPC_URL="https://sepolia.infura.io/v3/YOUR_KEY"
export DEPLOYER_PRIVATE_KEY="0xYOUR_KEY"
./scripts/deploy-sepolia.sh
```

**Configure Backend**:
```bash
# Copy contract addresses to agent/.env:
EXECUTION_ROUTER_ADDRESS=0x...
MOCK_SWAP_ADAPTER_ADDRESS=0x...
ETH_TESTNET_RPC_URL=$SEPOLIA_RPC_URL
EXECUTION_MODE=eth_testnet
EXECUTION_AUTH_MODE=direct  # or 'session'
```

**Verify Deployment**:
```bash
# Run E2E smoke test:
export EXECUTION_MODE=eth_testnet
export TEST_USER_ADDRESS=0xYOUR_ADDRESS
export EXECUTION_AUTH_MODE=direct
node agent/scripts/e2e-sepolia-smoke.ts

# Or with session mode:
export EXECUTION_AUTH_MODE=session
export RELAYER_PRIVATE_KEY=0xRELAYER_KEY
node agent/scripts/e2e-sepolia-smoke.ts --actually-relay
```

### E2E Tests

```bash
# Run Playwright tests:
npx playwright test

# Or specific test file:
npx playwright test e2e/testnet-v1.spec.ts

# Requires:
# - Backend running on http://localhost:3001
# - Frontend running on http://localhost:5173 (for browser tests)
# - EXECUTION_MODE=eth_testnet (for testnet tests)
```

---

## Canonical Documentation List

### MVP Requirements
- **Primary**: `docs/V1_MVP_REQUIREMENTS.md`
- **Secondary**: `docs/MVP_BULLETPROOF_DELIVERABLES.md`, `docs/V1_DELIVERABLES.md`

### Session Mode
- **Primary**: `docs/SESSION_MODE_AUDIT.md`
- **Secondary**: `docs/SESSION_MODE_RUNBOOK.md`, `docs/WALLET_MODEL_DECISION.md`

### Wallet Model
- **Primary**: `docs/WALLET_MODEL_DECISION.md`
- **Secondary**: `docs/SESSION_MODE_AUDIT.md`

### Demo Readiness
- **Primary**: `docs/DEMO_READINESS_AUDIT.md`, `docs/V1_DEMO_CHECKLIST.md`
- **Secondary**: `docs/MVP_BULLETPROOF_DELIVERABLES.md`

### Deployment
- **Primary**: `docs/TESTNET_MVP_STATUS.md`, `docs/END_TO_END_RUNBOOK.md`
- **Secondary**: `docs/PHASE_1_RUNBOOK.md`, `docs/LOCAL_BOOT.md`

### Execution Flow
- **Primary**: `docs/EXECUTION_RUNBOOK.md`, `docs/AI_EXECUTION_BOUNDARY.md`
- **Secondary**: `docs/AI_AGENT_FLOW.md`

**Note**: Some documentation may be outdated or duplicate. When in doubt, check the "Primary" sources first, then cross-reference with implementation code.

---

## Duplicate/Legacy Areas

### `src/_suddengreencard/` - **Legacy/Sandbox** ⚠️

**Status**: Not used in runtime. Excluded from `tsconfig.json` (`"exclude": ["src/_suddengreencard"]`). No imports found in codebase.

**Purpose**: Appears to be a separate UI library/component set, possibly from a different project or experiment. Contains:
- Full-stack application structure (client, server, shared)
- Extensive UI component library (50+ components)
- Drizzle ORM configuration
- Vite plugin for meta images

**Recommendation**: Can be safely ignored or removed if not needed for future work. If unsure, check git history for context.

---

## Production vs Demo/Legacy

### Production-Critical
- `/src` (frontend) - **Critical**
- `/agent` (backend) - **Important** (optional for mock mode)
- `/contracts` (smart contracts) - **Critical** (for Sepolia execution)
- Root config files (`package.json`, `vite.config.ts`, `Dockerfile`) - **Critical**

### Demo/Simulation
- `agent/src/plugins/*` - Simulation plugins (perps-sim, defi-sim, event-sim)
- `src/lib/mockParser.ts` - Mock parser (fallback when backend unavailable)
- `src/lib/demoPriceFeed.ts` - Demo price feed

### Legacy/Sandbox
- `src/_suddengreencard/` - Not used, excluded from build

### Optional/Development
- `/scripts` - Development tooling
- `/docs` - Documentation
- `/e2e` - E2E tests
- `/screenshots` - UI screenshots

---

## Shared Types & Interfaces

**Backend → Frontend Types**:
- `agent/src/types/blossom.ts` - `BlossomAction`, `BlossomPortfolioSnapshot`, `BlossomExecutionRequest`
- `agent/src/types/execution.ts` - `ExecutePrepareRequest`, `ExecutePrepareResponse`, `Plan`
- Frontend re-exports: `src/lib/blossomApi.ts` (types match backend)

**API Contracts**:
- Chat: `POST /api/chat` → `ChatRequest` → `ChatResponse`
- Execute: `POST /api/execute/prepare` → `ExecutePrepareRequest` → `ExecutePrepareResponse`
- Portfolio: `GET /api/portfolio/eth_testnet` → `BlossomPortfolioSnapshot`
- Session: `POST /api/session/prepare` → Session creation data

**Environment Variables** (Backend):
- `BLOSSOM_MODEL_PROVIDER` - LLM provider (openai/anthropic/gemini/stub)
- `BLOSSOM_OPENAI_API_KEY`, `BLOSSOM_ANTHROPIC_API_KEY`, `BLOSSOM_GEMINI_API_KEY` - API keys
- `EXECUTION_MODE` - Execution mode (eth_testnet/sim)
- `EXECUTION_AUTH_MODE` - Auth mode (direct/session)
- `ETH_TESTNET_RPC_URL` - Sepolia RPC URL
- `EXECUTION_ROUTER_ADDRESS` - Deployed router address
- `RELAYER_PRIVATE_KEY` - Relayer private key (session mode)

**Environment Variables** (Frontend):
- `VITE_USE_AGENT_BACKEND` - Enable backend mode (true/false)
- `VITE_AGENT_API_URL` - Backend URL (default: http://localhost:3001)

---

## Notes

- **Mock Mode**: Frontend can run standalone with `mockParser.ts` (no backend needed)
- **Stub Mode**: Backend can run without LLM API keys (returns canned responses)
- **Session Mode**: Requires `RELAYER_PRIVATE_KEY` (wallet with Sepolia ETH for gas)
- **Direct Mode**: User signs each transaction (no relayer needed)
- **Simulation**: All execution is simulated unless `EXECUTION_MODE=eth_testnet`
- **Contracts**: Only deployed to Sepolia testnet (no mainnet deployment)
