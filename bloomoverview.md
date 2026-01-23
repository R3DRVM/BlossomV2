# Blossom Execution Layer Overview

**Last Updated**: 2025-01-03

This document provides a comprehensive overview of the Blossom repository for engineers and LLMs (Cursor, Claude Code, etc.) who need to continue development safely without breaking the existing investor demo UI.

---

## Table of Contents

1. [High-Level Product Framing](#high-level-product-framing)
2. [Repo Map](#repo-map)
3. [Execution Modes and Flows](#execution-modes-and-flows)
4. [API Surface](#api-surface)
5. [Plan Schema and Adapters](#plan-schema-and-adapters)
6. [Contracts: Router and Security Model](#contracts-router-and-security-model)
7. [Deployment and Configuration](#deployment-and-configuration)
8. [Current Integration Status](#current-integration-status)
9. [Do Not Touch](#do-not-touch)
10. [Change Log](#change-log)
11. [Buckets & Roadmap Status](#buckets--roadmap-status)
    - [Bucket A — Demo Reliability (READY)](#bucket-a--demo-reliability-ready)
    - [Bucket B — Core Execution Completion (NEXT)](#bucket-b--core-execution-completion-next)
    - [Bucket C — Real Integrations (Planned)](#bucket-c--real-integrations-planned)

---

## High-Level Product Framing

### What Is Blossom?

Blossom is an **AI-powered trading copilot** that enables users to execute trades across multiple venues through natural language conversation. The core flow is:

```
User speaks → AI Planner generates plan → User confirms → Execution
```

Key components:
- **Chat Interface**: Users describe their trading intent in natural language
- **AI Planner**: Gemini-powered LLM parses intent and generates execution plans
- **Execution Layer**: Plans are executed either simulated (sim mode) or on-chain (ETH testnet mode)
- **Portfolio Tracking**: Real-time portfolio updates after each execution

### Long-Term Vision

- Cross-chain execution (Ethereum, Solana, L2s)
- Multi-venue support (DEXes, perps, lending, prediction markets)
- Session-based permissions for one-click execution
- Fully non-custodial with user-signed plans

### Current Investor Demo

The investor demo is a **fully functional UI** with:
- Real chat interaction with AI
- Real market data (prices, prediction markets from Polymarket)
- Execution can be **simulated** (default) or **real on Sepolia testnet**
- Portfolio cards, position tracking, and strategy management all work

**Important**: The UI is production-quality and must not be broken. Backend execution can be swapped between sim and testnet modes.

---

## Repo Map

### Top-Level Directory Structure

```
Bloom/
├── agent/              # Backend Express server (AI agent + execution)
├── contracts/          # Solidity smart contracts (Foundry workspace)
├── docs/               # Documentation files
├── scripts/            # Shell scripts for testing/deployment
├── src/                # Frontend React application (Vite + TypeScript)
├── dist/               # Production build output
└── [various .md files] # Architecture and setup documentation
```

### Key Frontend Files (`src/`)

| Path | Description |
|------|-------------|
| `src/components/Chat.tsx` | Main chat component with execution flow logic (`handleConfirmTrade`) |
| `src/context/BlossomContext.tsx` | Global state: portfolio, strategies, chat sessions, execution mode |
| `src/lib/config.ts` | Frontend feature flags (`VITE_EXECUTION_MODE`, `VITE_EXECUTION_AUTH_MODE`) |
| `src/lib/walletAdapter.ts` | Wallet connection utilities (MetaMask, injected provider selection) |
| `src/lib/blossomApi.ts` | API client types for chat and execution |
| `src/lib/apiClient.ts` | HTTP client with access gate header injection |
| `src/components/RightPanel.tsx` | Strategy queue and portfolio display |
| `src/components/OneClickExecution.tsx` | Session enable/disable UX component |
| `src/layouts/BlossomAppShell.tsx` | Main app shell with access gate integration |

### Key Backend Files (`agent/src/`)

| Path | Description |
|------|-------------|
| `server/http.ts` | Express server with all API endpoints |
| `executors/ethTestnetExecutor.ts` | Builds execution plans for Sepolia (PULL+SWAP, WRAP, etc.) |
| `executors/relayer.ts` | Sends relayed transactions using session permissions |
| `executors/evmRpc.ts` | Low-level EVM RPC utilities (eth_call, nonce fetching) |
| `executors/erc20Rpc.ts` | ERC20-specific RPC utilities (balanceOf, allowance) |
| `quotes/evmQuote.ts` | Quote provider for demo swap router |
| `config.ts` | Backend configuration (env var loading, validation) |
| `types/blossom.ts` | Core types: `BlossomAction`, `BlossomExecutionRequest`, `ExecutionResult` |
| `types/execution.ts` | Request/response types for prepare/submit flow |
| `plugins/perps-sim/` | Simulated perpetuals trading |
| `plugins/defi-sim/` | Simulated DeFi lending/deposits |
| `plugins/event-sim/` | Simulated prediction market positions |
| `utils/actionParser.ts` | LLM prompt building and response parsing |
| `utils/accessGate.ts` | Access code validation middleware |
| `services/llmClient.ts` | Gemini API client |

### Key Contract Files (`contracts/src/`)

| Path | Description |
|------|-------------|
| `ExecutionRouter.sol` | Main router: executes plans, manages sessions, adapter allowlist |
| `PlanTypes.sol` | EIP-712 types: `Plan`, `Action`, `ActionType` enum |
| `IAdapter.sol` | Interface for execution adapters (`execute(bytes) payable`) |
| `adapters/MockSwapAdapter.sol` | Mock adapter for testing |
| `adapters/ERC20PullAdapter.sol` | Pulls ERC20 tokens from user to router |
| `adapters/UniswapV3SwapAdapter.sol` | Executes swaps via Uniswap V3 interface |
| `adapters/WethWrapAdapter.sol` | Wraps ETH → WETH |
| `demo/DemoERC20.sol` | Mintable ERC20 for demo tokens (DEMO_USDC, DEMO_WETH) |
| `demo/DemoSwapRouter.sol` | Deterministic swap router (95% rate, no liquidity issues) |

### Deployment Scripts

| Path | Description |
|------|-------------|
| `contracts/script/DeploySepolia.s.sol` | Foundry deployment script for Sepolia |
| `contracts/scripts/deploy-sepolia.sh` | Shell wrapper for deployment |
| `scripts/eth-testnet-smoke.sh` | Smoke test for testnet setup |

### Key Documentation

| Path | Description |
|------|-------------|
| `ETH_TESTNET_MVP_SETUP.md` | Complete setup guide for Sepolia deployment |
| `contracts/README.md` | Contracts architecture and deployment |
| `contracts/IMPLEMENTATION.md` | Action type handling details |
| `docs/SESSION_MODE_RUNBOOK.md` | Session mode setup and usage |
| `docs/LOCAL_BOOT.md` | Local development startup |

---

## Execution Modes and Flows

Blossom supports three execution modes:

### Mode A: SIM (Simulated - Default)

**Trigger**: `VITE_EXECUTION_MODE=sim` or unset

```
┌─────────────┐    ┌────────────────┐    ┌─────────────────┐
│   Chat.tsx  │───▶│  POST /api/chat│───▶│   Sim Plugins   │
│handleConfirm│    │  (actions)     │    │(perps/defi/event)│
└─────────────┘    └────────────────┘    └─────────────────┘
                           │
                           ▼
                   ┌────────────────┐
                   │ simulatedTxId  │
                   │ portfolio update│
                   └────────────────┘
```

**Env vars**: 
- Frontend: `VITE_EXECUTION_MODE=sim` (or unset)
- Backend: `EXECUTION_MODE=sim` (or unset)

**Endpoints called**: 
- `POST /api/chat` → Returns `executionResults[]` with `simulatedTxId`

**What's real**: AI planning, portfolio tracking, market data
**What's simulated**: Execution (no blockchain transactions)

---

### Mode B: ETH Testnet Direct Mode

**Trigger**: `VITE_EXECUTION_MODE=eth_testnet` + `VITE_EXECUTION_AUTH_MODE=direct`  
**Flow**: `Chat.tsx` → `/execute/prepare` → MetaMask sign → `/execute/submit` → ExecutionResult  
**Env vars**: Frontend: `VITE_EXECUTION_MODE=eth_testnet`, `VITE_EXECUTION_AUTH_MODE=direct`. Backend: `EXECUTION_MODE=eth_testnet`, `EXECUTION_ROUTER_ADDRESS`, adapter addresses.  
**Endpoints**: `/api/execute/preflight`, `/api/execute/prepare`, `/api/token/approve/prepare` (if needed), `/api/execute/submit`  
**Contract**: `ExecutionRouter.executeBySender(plan)` - user signs tx directly

---

### Mode C: ETH Testnet Session Mode (One-Click Execution)

**Trigger**: `VITE_EXECUTION_MODE=eth_testnet` + `VITE_EXECUTION_AUTH_MODE=session`  
**Setup**: User → `/session/prepare` → MetaMask sign `createSession()` (once per 7 days)  
**Execution**: `Chat.tsx` → `/execute/prepare` → `/execute/relayed` → Relayer submits → ExecutionResult  
**Env vars**: All direct mode vars + `RELAYER_PRIVATE_KEY`  
**Endpoints**: `/api/session/prepare`, `/api/session/status`, `/api/execute/prepare`, `/api/execute/relayed`  
**Contracts**: `ExecutionRouter.createSession(...)` (user), `ExecutionRouter.executeWithSession(...)` (relayer)

---

## API Surface

### `POST /api/chat`

**When used**: Every user message in chat

**Request**:
```typescript
{
  userMessage: string;
  venue: 'hyperliquid' | 'event_demo';
  clientPortfolio?: BlossomPortfolioSnapshot;
}
```

**Response**:
```typescript
{
  assistantMessage: string;
  actions: BlossomAction[];           // Simulated actions
  executionRequest?: BlossomExecutionRequest; // For on-chain execution
  executionResults?: ExecutionResult[];
  modelOk: boolean;
  errorCode?: string;
  portfolio?: BlossomPortfolioSnapshot;
}
```

---

### `POST /api/execute/prepare`

**When used**: Before ETH testnet execution (both direct and session)

**Request**:
```typescript
{
  draftId: string;
  userAddress: string;
  strategy?: Strategy;
  authMode?: 'direct' | 'session';
  executionIntent?: 'mock' | 'swap_usdc_weth' | 'swap_weth_usdc';
  executionRequest?: BlossomExecutionRequest;
}
```

**Response**: `{ chainId, to, value, plan, typedData, call, requirements?, summary, warnings?, routing? }`

---

### `POST /api/execute/submit`

**When used**: After user sends tx (direct mode)

**Request**: `{ draftId: string; txHash: string; }`

**Response**: `ExecutionResult`

---

### `POST /api/execute/relayed`

**When used**: Session mode execution (backend submits)

**Request**: `{ userAddress, sessionId, plan, value? }`  
**Response**: `ExecutionResult` with `txHash`

**Server-side guards**:
- Max 4 actions per plan
- Deadline ≤ 10 minutes
- Only allowed adapters
- Max 1 ETH per swap
- Only allowed tokens (ETH/WETH/USDC)

---

### `POST /api/session/prepare`

**When used**: Creating a new session

**Request**: `{ userAddress: string; }`

**Response**: `{ sessionId, to, data, value: '0x0', summary }`

---

### `POST /api/session/status`

**When used**: Checking if session is active

**Request**: `{ userAddress, sessionId }`  
**Response**: `{ status: 'active' | 'expired' | 'revoked' | 'not_found', ... }`

---

### `GET /api/execute/preflight`

**When used**: Check if testnet execution is configured

**Response**: `{ mode: string; ok: boolean; notes: string[]; ... }`

---

### `POST /api/setup/approve`

**When used**: Prepare ERC20 approval transaction

**Request**: `{ userAddress, tokenAddress, spenderAddress, amount }`  
**Response**: `{ to, data, value: '0x0', summary }`

---

## Plan Schema and Adapters

### ActionType Enum (`PlanTypes.sol`)

```solidity
enum ActionType {
    SWAP,        // 0 - Execute token swap
    WRAP,        // 1 - Wrap ETH → WETH
    PULL,        // 2 - Pull ERC20 from user to router
    LEND_SUPPLY, // 3 - Supply to lending protocol (future)
    LEND_BORROW, // 4 - Borrow from lending protocol (future)
    EVENT_BUY    // 5 - Buy event position (future)
}
```

### Plan Struct

```solidity
struct Plan {
    address user;      // User address
    uint256 nonce;     // Replay protection
    uint256 deadline;  // Unix timestamp
    Action[] actions;  // Executed atomically
}

struct Action {
    uint8 actionType;  // ActionType enum value
    address adapter;   // Adapter contract
    bytes data;        // Adapter-specific calldata
}
```

### Session Spend-Aware Encoding

**Session mode**: `action.data = abi.encode(maxSpendUnits, innerData)`. Router decodes, updates `session.spent`, calls adapter with `innerData`.  
**Direct mode**: `action.data` is raw `innerData`.

---

### Adapters

#### MockSwapAdapter
- **Purpose**: Testing only
- **Data encoding**: Any bytes (ignored)
- **Behavior**: Emits event, returns `abi.encode(true)`

#### ERC20PullAdapter
- **Purpose**: Transfer tokens from user to router
- **Data encoding**: `abi.encode(token, from, amount)`
- **Behavior**: Router does `safeTransferFrom`, adapter validates and returns success
- **Note**: The actual pull happens in `ExecutionRouter._executePullAction()`

#### UniswapV3SwapAdapter
- **Purpose**: Execute swaps via Uniswap V3 or compatible router
- **Data encoding**: `abi.encode(tokenIn, tokenOut, fee, amountIn, amountOutMin, recipient, deadline)`
- **Behavior**: 
  1. Pulls tokens from router (caller)
  2. Approves swap router
  3. Calls `exactInputSingle`
  4. Returns `abi.encode(amountOut)`

#### WethWrapAdapter
- **Purpose**: Wrap ETH → WETH
- **Data encoding**: `abi.encode(recipient)`
- **Behavior**:
  1. Receives ETH via `msg.value`
  2. Calls `WETH.deposit()`
  3. Transfers WETH to recipient
- **Special handling**: Router forwards `msg.value` for WRAP actions

#### DemoSwapRouter + DemoERC20s
- **Purpose**: Deterministic swap venue for investor demos
- **Rate**: Fixed 95% (5% fee)
- **Decimals**: Handles 6 (USDC) ↔ 18 (WETH) conversions
- **Liquidity**: Pre-seeded at deployment (1M USDC, 1000 WETH)

---

## Contracts: Router and Security Model

### Security Model

- **Nonces**: `mapping(address => uint256) public nonces` - each plan uses current nonce, increments on execution, prevents replay
- **Deadline**: `require(plan.deadline >= block.timestamp)` - plans expire (typical: 10 minutes)
- **Global Adapter Allowlist**: `mapping(address => bool) public isAdapterAllowed` - owner-controlled, all actions must use allowlisted adapters
- **Session Adapter Allowlist**: `mapping(bytes32 => mapping(address => bool))` - per-session restrictions, adapters must be in both global AND session allowlists
- **Session Caps**: `Session { owner, executor, expiresAt, maxSpend, spent, active }` - `maxSpend` is total cap, `spent` accumulates, reverts if `spent + maxSpendUnits > maxSpend`
- **Atomicity**: All actions execute or none do. Any adapter failure reverts entire transaction (uses `try/catch` with revert)

---

## Deployment and Configuration

### Prerequisites

1. **Foundry**: https://book.getfoundry.sh/getting-started/installation
2. **Sepolia ETH**: ~0.1 ETH from a faucet
3. **RPC URL**: Infura or Alchemy endpoint
4. **Deployer Private Key**: Test wallet only, never main wallet

### Deployment Steps

```bash
# 1. Set environment variables
export SEPOLIA_RPC_URL="https://sepolia.infura.io/v3/YOUR_KEY"
export DEPLOYER_PRIVATE_KEY="0xYOUR_PRIVATE_KEY"

# 2. Run deployment
cd contracts
./scripts/deploy-sepolia.sh
```

### Expected Output

```
EXECUTION_ROUTER_ADDRESS=0x...
MOCK_SWAP_ADAPTER_ADDRESS=0x...
ERC20_PULL_ADAPTER_ADDRESS=0x...
DEMO_USDC_ADDRESS=0x...
DEMO_WETH_ADDRESS=0x...
DEMO_SWAP_ROUTER_ADDRESS=0x...
UNISWAP_ADAPTER_ADDRESS=0x...
```

### Environment Variable Reference

#### Frontend (`.env.local`)

| Variable | Values | Description |
|----------|--------|-------------|
| `VITE_USE_AGENT_BACKEND` | `true` / `false` | Enable backend integration |
| `VITE_EXECUTION_MODE` | `sim` / `eth_testnet` | Execution mode |
| `VITE_EXECUTION_AUTH_MODE` | `direct` / `session` | Auth mode for testnet |
| `VITE_ETH_TESTNET_INTENT` | `mock` / `swap_usdc_weth` / `swap_weth_usdc` | Default swap intent |
| `VITE_FUNDING_ROUTE_MODE` | `manual` / `atomic` | ETH wrapping strategy |
| `VITE_ACCESS_GATE_ENABLED` | `true` / `false` | Enable access code gate |
| `VITE_FORCE_DEMO_PORTFOLIO` | `true` / `false` | Force demo balances |

#### Backend (`agent/.env.local`)

| Variable | Description |
|----------|-------------|
| `EXECUTION_MODE` | `sim` or `eth_testnet` |
| `EXECUTION_AUTH_MODE` | `direct` or `session` |
| `ETH_TESTNET_RPC_URL` | Sepolia RPC URL |
| `ETH_TESTNET_CHAIN_ID` | `11155111` (Sepolia) |
| `EXECUTION_ROUTER_ADDRESS` | Deployed router address |
| `MOCK_SWAP_ADAPTER_ADDRESS` | Mock adapter address |
| `ERC20_PULL_ADAPTER_ADDRESS` | Pull adapter address |
| `UNISWAP_ADAPTER_ADDRESS` | Uniswap adapter address |
| `DEMO_USDC_ADDRESS` | Demo USDC token |
| `DEMO_WETH_ADDRESS` | Demo WETH token |
| `DEMO_SWAP_ROUTER_ADDRESS` | Demo swap router |
| `RELAYER_PRIVATE_KEY` | For session mode only |
| `ACCESS_GATE_ENABLED` | `true` / `false` |
| `BLOSSOM_GEMINI_API_KEY` | Gemini API key |

### Preflight Checklist

```bash
# Start backend
cd agent && npm run dev

# Check configuration
curl http://localhost:3001/api/execute/preflight
```

**Success response**:
```json
{
  "mode": "eth_testnet",
  "ok": true,
  "notes": [
    "✅ Router contract deployed",
    "✅ Adapter is allowlisted",
    "✅ RPC endpoint is reachable"
  ]
}
```

---

## Hybrid Routing Model

Blossom uses a **hybrid routing model** that separates route intelligence from execution:

### Architecture

**Decision Layer**: 1inch/Uniswap/aggregators for routing intelligence (read-only)  
**Execution Layer**: DemoSwapRouter (Sepolia) - fixed 95% rate, deterministic execution  
Plan: PULL → SWAP (via UniswapV3SwapAdapter)

### Configuration

| Env Variable | Values | Default | Description |
|--------------|--------|---------|-------------|
| `ROUTING_MODE` | `hybrid`, `deterministic` | `hybrid` | Use 1inch for routing intelligence |
| `EXECUTION_SWAP_MODE` | `demo`, `real` | `demo` | Execute via DemoSwapRouter |
| `ROUTING_REQUIRE_LIVE_QUOTE` | `true`, `false` | `false` | Fail if live quote unavailable |
| `ONEINCH_API_KEY` | string | - | API key for 1inch (optional) |
| `ONEINCH_BASE_URL` | URL | `https://api.1inch.dev` | 1inch API endpoint |

### Behavior by Mode

**Hybrid (default)**: 1inch for routing intelligence → DemoSwapRouter for execution. Falls back to deterministic if 1inch fails.  
**Deterministic**: Fixed 95% rate, DemoSwapRouter, no external APIs.

Chat displays routing source and execution venue with tx link after execution.

### Switching to Real Execution

Set `EXECUTION_SWAP_MODE=real`, configure real token addresses, deploy adapter pointing to real Uniswap router. **Warning:** Requires actual liquidity and user approvals.

### Files

| File | Purpose |
|------|---------|
| `agent/src/quotes/oneInchQuote.ts` | 1inch API integration (read-only) |
| `agent/src/quotes/evmQuote.ts` | `getSwapRoutingDecision()` - hybrid logic |
| `agent/src/config.ts` | Routing config variables |

---

## Lending Venue

Blossom supports lending operations using the same hybrid model as swaps.

### Architecture

```
User: "Supply 250 USDC to lending"
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DECISION LAYER (APR data)                    │
│                                                                 │
│  ┌─────────────┐                                               │
│  │  DefiLlama  │ → APR data (when available)                   │
│  │  API        │                                               │
│  └──────┬──────┘                                               │
│         │                                                       │
│         ▼                                                       │
│  ┌───────────────────────┐                                     │
│  │   Lending Routing     │                                     │
│  │   - Est APR: 5.00%    │                                     │
│  │   - Protocol: Demo    │                                     │
│  └───────────┬───────────┘                                     │
└──────────────┼──────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────┐
│                   EXECUTION LAYER (Deterministic)               │
│                                                                 │
│  Plan: PULL → LEND_SUPPLY                                       │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                DemoLendVault (Sepolia)                     │ │
│  │                                                            │ │
│  │  • 1:1 share issuance                                     │ │
│  │  • Informational APR (5%)                                 │ │
│  │  • Deterministic for investor demos                       │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Configuration

| Env Variable | Values | Default | Description |
|--------------|--------|---------|-------------|
| `DEMO_LEND_VAULT_ADDRESS` | address | - | DemoLendVault contract address |
| `DEMO_LEND_ADAPTER_ADDRESS` | address | - | DemoLendSupplyAdapter contract address |
| `LENDING_EXECUTION_MODE` | `demo`, `real` | `demo` | Execute via DemoLendVault or real protocol |
| `LENDING_RATE_SOURCE` | `defillama`, `aave`, `none` | `defillama` | APR data source |
| `AAVE_POOL_ADDRESS` | address | - | Aave V3 Pool address (for real mode) |

### Plan Structure

Action 0: PULL (actionType: 2) - transfer USDC from user to router  
Action 1: LEND_SUPPLY (actionType: 3) - deposit to vault

### Contracts

| Contract | Path | Purpose |
|----------|------|---------|
| `DemoLendVault` | `contracts/src/demo/DemoLendVault.sol` | ERC4626-style vault with 1:1 shares |
| `DemoLendSupplyAdapter` | `contracts/src/adapters/DemoLendSupplyAdapter.sol` | Adapter for vault deposits |

### Switching to Real Aave

Set `LENDING_EXECUTION_MODE=real`, configure `AAVE_POOL_ADDRESS`, deploy Aave adapter, update executor.

---

## Session Mode Requirements

**Status**: Session mode is **optional**. DIRECT mode works regardless of session configuration.

### When Session Mode Works

Session mode enables one-click execution (user signs session creation once, then backend relays subsequent transactions). It requires:

| Requirement | Env Variable | Description |
|-------------|--------------|-------------|
| **Relayer Private Key** | `RELAYER_PRIVATE_KEY` | Private key of relayer wallet (must have ETH for gas) |
| **Execution Router** | `EXECUTION_ROUTER_ADDRESS` | Deployed ExecutionRouter contract address |
| **RPC URL** | `ETH_TESTNET_RPC_URL` | Sepolia RPC endpoint (Infura, Alchemy, etc.) |
| **Mode Config** | `EXECUTION_MODE=eth_testnet` | Must be in testnet mode |
| **Auth Config** | `EXECUTION_AUTH_MODE=session` | Must explicitly enable session mode |

### Verification

Backend startup logs show session mode status with requirement checks.  
**If disabled**: `/api/session/status` returns `{ ok: true, status: "not_created", session: { enabled: false, reason: "NOT_CONFIGURED", required: [...] } }`  
**Note**: DIRECT mode works regardless. Session is optional enhancement.

### Setup Steps

1. Deploy ExecutionRouter contract to Sepolia
2. Set `EXECUTION_ROUTER_ADDRESS` in `agent/.env.local`
3. Generate relayer wallet: `cast wallet new` (or use existing)
4. Fund relayer wallet with Sepolia ETH (for gas)
5. Set `RELAYER_PRIVATE_KEY` in `agent/.env.local` (keep secret!)
6. Set `EXECUTION_AUTH_MODE=session` in `agent/.env.local`
7. Restart backend - check startup logs for "Session mode configured"

---

## Demo Readiness Checklist

**Last Updated**: 2025-01-XX

Before running a demo, verify the following:

### Pre-Demo Verification

1. **Run Demo Readiness Script**
   ```bash
   ./scripts/demo-readiness.sh
   ```
   Must exit with code 0 (all checks pass).

2. **Check Backend Startup Logs**
   - Verify `EXECUTION_MODE` and `EXECUTION_AUTH_MODE` are correct
   - Check session mode requirements (if using session mode)
   - Ensure no critical warnings

3. **Test Representative Prompts**
   - "open BTC long 2x with 2% risk" → Should show ConfirmTradeCard
   - "bet YES on Fed rate cut with $5" → Should show ConfirmTradeCard
   - "park 10 usdc into yield" → Should show ConfirmTradeCard
   - "swap 5 usdc to weth" → Should execute immediately (no card)

### Contract Parity

**Key Requirements**:
- `/api/chat` response must include:
  - `assistantMessage` (string)
  - `actions` (array, non-empty for valid intents)
  - `executionRequest` (object, non-null for perp/event/defi intents)
  - `portfolio` (object with `strategies` array)

- For perp/event/defi intents:
  - `executionRequest.kind` must match intent type
  - `executionRequest` must have required fields (market, side, leverage for perp; marketId, outcome, stakeUsd for event; asset, amount for defi)

- Message structure:
  - `type: 'trade_confirm'` when `draftId` exists
  - `draftId` set from created draft strategy
  - `executionRequest` stored on message

### Session Mode

- If `NOT_CONFIGURED`: Plan cards still render, execution uses direct mode
- If configured: `/api/session/status` returns top-level `status` field (never undefined)
- Enable flow: One MetaMask signature, button updates, no loops

### Known Non-Blocking Differences

1. DeFi drafts use `instrumentType: 'perp'` (works correctly, not semantically perfect)
2. Mock mode DeFi uses different component (dev-only, not production path)
3. Portfolio.strategies fallback path (less tested than primary executionRequest path)

**Risk**: Low. Demo should work correctly.

---

## Current Integration Status

### Status: Real vs Simulated

| Feature | Status | Details |
|---------|--------|---------|
| Session creation | ✅ Real | On-chain tx via `createSession()` |
| Session revocation | ✅ Real | On-chain tx via `revokeSession()` |
| Relayed execution | ✅ Real | Backend sends tx with session |
| Demo token swaps | ✅ Real | DEMO_USDC ↔ DEMO_WETH on Sepolia |
| Demo lending supply | ✅ Real | DEMO_USDC → DemoLendVault on Sepolia |
| ETH → WETH wrapping | ✅ Real | Via WethWrapAdapter |
| Real Uniswap swaps | ⚠️ Partial | Adapter exists, needs liquidity |
| Real Aave lending | ⚠️ Partial | Adapter ready, needs `LENDING_EXECUTION_MODE=real` |
| Perps (Hyperliquid) | ❌ Simulated | No on-chain perps yet |
| Prediction markets | ❌ Simulated | Polymarket data real, execution sim |
| Wallet balances (eth_testnet) | ✅ Real | Fetched from Sepolia RPC |

### Mocked Execution Paths

- **Perps**: `agent/src/plugins/perps-sim/` - Full simulation with margin, PnL
- **DeFi**: `agent/src/plugins/defi-sim/` - Deposit/withdraw simulation
- **Events**: `agent/src/plugins/event-sim/` - Prediction market simulation

All simulated paths return `ExecutionResult` with `simulatedTxId`.

### Next Work Items

1. ~~**Fix TS compile errors**~~ ✅ Completed (0 errors)
2. ~~**Wire Chat.tsx approval flow**~~ ✅ Completed
3. ~~**Store routing metadata**~~ ✅ Completed (displayed in assistant messages)
4. ~~**Hybrid routing with 1inch**~~ ✅ Completed (real quotes, deterministic execution)
5. **Real DEX execution** - Set `EXECUTION_SWAP_MODE=real` and ensure liquidity
6. **Multi-chain support** - Abstract chain-specific logic
7. **Additional quote providers** - dFlow, 0x, Paraswap (nice-to-have)

---

## Telemetry

Blossom includes minimal telemetry for MVP observability without storing PII.

### What Is Logged

| Event Type | When | Key Fields |
|------------|------|------------|
| `chat_request` | Chat message received | venue, truncated message |
| `chat_response` | Chat response sent | success, action count, latency |
| `prepare_success` | Execution plan prepared | draftId, userHash, actionTypes |
| `prepare_fail` | Preparation failed | error, draftId |
| `approve_prepare` | Approval tx prepared | userHash, token (truncated) |
| `submit_tx` | Transaction submitted | draftId, txHash, userHash |
| `relayed_tx` | Relayed tx submitted | draftId, txHash, actionTypes |
| `session_prepare` | Session creation started | userHash |
| `tx_confirmed` | Receipt shows success | txHash, blockNumber, latency |
| `tx_failed` | Receipt shows failure | txHash, blockNumber, error |
| `tx_timeout` | Receipt not found in time | txHash, error |

### Privacy

- **User addresses are hashed** with `sha256(TELEMETRY_SALT + address)` - only first 16 chars stored
- **No request bodies** logged raw
- **No PII** (emails, names, IPs)
- Logs stored in `agent/logs/telemetry.jsonl`

### Configuration

| Env Variable | Default | Description |
|--------------|---------|-------------|
| `TELEMETRY_SALT` | internal default | Salt for address hashing |
| `TELEMETRY_CONSOLE` | `false` | Also log to console |

### Log File Location

`agent/logs/telemetry.jsonl` - JSON lines format

Each line is a JSON object:

```json
{"ts":"2025-01-03T12:00:00.000Z","type":"tx_confirmed","txHash":"0x...","blockNumber":12345,"latencyMs":3200,"success":true}
```

---

## Receipt Confirmation

In `eth_testnet` mode, `/api/execute/submit` waits for on-chain receipt before returning.

### Behavior Differences

| Mode | Behavior |
|------|----------|
| SIM | Immediate `{ ok: true }` return |
| ETH_TESTNET | Wait up to 60s for receipt, poll every 2s |

### Updated Response Shape

```typescript
interface SubmitResponse {
  success: boolean;
  status: 'success' | 'failed';
  txHash: string;
  receiptStatus?: 'confirmed' | 'failed' | 'timeout' | 'pending';
  blockNumber?: number;
  error?: string;
  portfolioDelta: { ... };
  portfolio: BlossomPortfolioSnapshot;
}
```

### Frontend Handling

| receiptStatus | Frontend Action |
|---------------|-----------------|
| `confirmed` | Mark strategy as `executed` |
| `failed` | Keep pending, show error message |
| `timeout` | Keep pending, show "check tx" message |

### Preflight Check

Before first execution in `eth_testnet` mode, frontend calls `GET /api/execute/preflight`:
- If `ok: false`, show warning and block execution
- Result cached per page load

---

## dFlow Integration

dFlow is an optional provider for routing intelligence and event market data.

### Architecture

Provider registry: dFlow (preferred) or fallback (Polymarket/Kalshi/1inch/deterministic) for market data and quotes.

### Key Distinction

| Layer | What | Source |
|-------|------|--------|
| **Decision** | Routing intelligence, prices, quotes | dFlow / 1inch |
| **Execution** | On-chain transactions | Demo Router (deterministic) |

### Configuration

Env vars: `DFLOW_ENABLED`, `DFLOW_API_KEY`, `DFLOW_BASE_URL`, capability paths (`DFLOW_EVENTS_MARKETS_PATH`, etc.), `DFLOW_REQUIRE`, `ROUTING_MODE`.  
**Selection**: `DFLOW_ENABLED && path set` → dFlow, else `DFLOW_REQUIRE` → fail, else → fallback

### Files

| File | Purpose |
|------|---------|
| `agent/src/integrations/dflow/dflowClient.ts` | API client |
| `agent/src/integrations/dflow/DFLOW_CAPABILITIES.md` | Capability assessment |
| `agent/src/providers/types.ts` | Provider interfaces |
| `agent/src/providers/dflowProvider.ts` | dFlow implementations |
| `agent/src/providers/fallbackProvider.ts` | Fallback implementations |
| `agent/src/providers/providerRegistry.ts` | Selection logic |

---

## Proof-of-Execution Adapter

For perps and event markets where real venue adapters don't exist yet, Blossom uses a proof-of-execution pattern to record user intent on-chain.

### Contract

**Location:** `contracts/src/adapters/ProofOfExecutionAdapter.sol`

**Event:**
```solidity
event ProofRecorded(
    address indexed user,
    uint8 indexed venueType,   // 1=perps, 2=event
    bytes32 indexed intentHash,
    string summary,
    uint256 timestamp
);
```

**Venue Types:**
| Type | Value | Description |
|------|-------|-------------|
| PERPS | 1 | Perpetual futures trades |
| EVENT | 2 | Event/prediction market positions |

### Action Type

`PROOF = 6` in `PlanTypes.ActionType` enum

### Data Encoding

```typescript
innerData = abi.encode(
  userAddress,    // address - who is executing
  venueType,      // uint8 - 1 or 2
  intentHash,     // bytes32 - keccak256 of canonical intent JSON
  summary         // string - max 160 chars, e.g. "PERP:ETH-LONG-3x-3%"
)
```

### Canonical Intent Format

**Perps:**
```json
{
  "type": "perp",
  "market": "ETH-USD",
  "side": "long",
  "leverage": 3,
  "riskPct": 3,
  "marginUsd": 100,
  "tp": "",
  "sl": "",
  "timestamp": 1704307200
}
```

**Events:**
```json
{
  "type": "event",
  "marketId": "fed-rate-cut",
  "outcome": "YES",
  "stakeUsd": 50,
  "timestamp": 1704307200
}
```

### Environment Variable

```bash
PROOF_ADAPTER_ADDRESS=0x...  # Set after deployment
```

---

## Acceptance Testing

### Documents

| File | Purpose |
|------|---------|
| `MVP_ACCEPTANCE_AUDIT.md` | LLM/ElizaOS integration status |
| `TESTNET_V1_ACCEPTANCE.md` | Full acceptance criteria for MVP |

### Running Tests

```bash
# One-command local check
./scripts/local-mvp-check.sh

# Just API tests
npx playwright test

# With browser (for full e2e)
npx playwright test --headed
```

### Test Files

| File | Tests |
|------|-------|
| `e2e/testnet-v1.spec.ts` | API acceptance tests |
| `contracts/test/ProofOfExecutionAdapter.t.sol` | Contract unit tests |

### Acceptance Checklist

- [ ] `forge test` passes (68 tests)
- [ ] `npm run build` passes (frontend)
- [ ] `npm run build` passes (agent)
- [ ] Preflight returns `ok: true`
- [ ] Demo swap produces txHash + explorer link
- [ ] Lending produces txHash + explorer link
- [ ] Perps confirmation produces proof tx
- [ ] Events confirmation produces proof tx
- [ ] Telemetry logs events
- [ ] Receipt confirmation gates status updates

---

## Do Not Touch

These components are fragile and essential for the investor demo:

### UI Components - DO NOT MODIFY

| Component | Reason |
|-----------|--------|
| `src/components/RightPanel.tsx` | Core investor demo UI - strategy cards, portfolio |
| `src/components/ConfirmTradeCard.tsx` | Trade confirmation UX |
| `src/components/MessageBubble.tsx` | Chat message rendering |
| `src/components/PortfolioView.tsx` | Portfolio display |
| `src/components/PositionSummaryCard.tsx` | Position cards |
| `src/pages/LandingPage.tsx` | Marketing landing page |
| `src/components/landing/*` | Landing page sections |

### State Management - MODIFY WITH CAUTION

| File | Notes |
|------|-------|
| `src/context/BlossomContext.tsx` | Global state - any changes affect entire app |
| `src/lib/walletAdapter.ts` | Wallet connection - already working |

### Contract ABIs - SYNC WITH CONTRACTS

The following must stay in sync with deployed contracts:
- Router ABI encoding in `ethTestnetExecutor.ts`
- Session creation ABI in `http.ts`
- EIP-712 type definitions

---

## Change Log

**Recent Major Updates** (see `docs/` for detailed changelogs):

- **2025-01-XX**: Receipt-driven updates, V1 position management, plan hash computation, V1_DEMO mode, emergency kill switch
- **2025-01-XX**: Session status fixes, demo readiness script, contract parity verification
- **2025-01-XX**: Backend draft creation, deterministic plan cards, execution path proof
- **2025-01-XX**: V1 testnet demo completion (routing, DeFi, perps, events, planner fallbacks)
- **2025-01-03**: Demo blocker fixes (env loading, error states, restart script)
- **2025-01-03**: Backend crash fix, wallet balance UX, telemetry, receipt confirmation
- **2025-01-03**: dFlow integration, MVP acceptance, proof-of-execution adapter
- **2025-01-03**: Lending venue, hybrid routing, session mode implementation

**Full changelog details**: See individual docs in `docs/` directory for comprehensive change history.

---

### 2025-01-03 (Historical Updates)

**Key milestones**:
- Demo blocker fixes (env loading, error states, restart script)
- Backend crash fixes, wallet balance UX, telemetry
- Request spam elimination, one-command startup
- Backend connection reliability, offline detection
- Wallet state machine, explicit connect UX
- Investor demo readiness, dFlow integration
- MVP acceptance, proof-of-execution adapter
- Polish & reliability (telemetry, receipt confirmation)

**Details**: See `docs/` directory for comprehensive change history.

---

## Buckets & Roadmap Status

This section defines the current execution state of Blossom and serves as the authoritative checklist for product readiness. Buckets are gated milestones — a bucket is not considered complete until all exit criteria are met.

---

### Bucket A — Demo Reliability (READY)

**Goal:**  
Ensure the demo behaves as a boringly reliable, investor-grade application. No infinite loading states. No unexplained failures. Clear recovery when misconfigured.

**Status:** ✅ **READY**

#### What Bucket A Guarantees

- Application boots cleanly with backend verification
- Wallet connection never hangs
- Balances render correctly (including zero balances)
- Backend failures surface as actionable UI banners
- No recurring red console errors during normal demo usage

#### Completed Work

- Wallet state machine fixed to transition on fetch completion, not balance value
- `/api/session/status` endpoint implemented and made non-blocking
- CoinGecko calls fully proxied through backend with caching
- Backend health gating prevents request spam
- Explicit env loading and startup diagnostics added
- Structured backend error codes (`RPC_NOT_CONFIGURED`, `RPC_UNREACHABLE`)
- Restart and demo readiness scripts added
- Dev-only wallet debug accordion added for state inspection

#### Verification Commands

```bash
./scripts/restart-demo.sh
curl -s http://127.0.0.1:3001/health
./scripts/demo-ready-check.sh
npx playwright test -g "health|wallet|session|prices"
```

#### Exit Criteria (Must Hold)

- Wallet never remains in "Loading…" indefinitely
- No red console errors during normal demo flow
- Backend offline or misconfigured states are clearly surfaced
- Demo can be restarted and validated repeatedly without manual fixes

**Deliverables:**
- `BUCKET_A_RELIABILITY_REPORT.md`
- Passing frontend + backend builds
- Passing targeted e2e tests

---

### Bucket B — Core Execution Completion (NEXT)

**Goal:**  
Transform the demo from "it works" into a credible execution product with real transaction flows and transparency.

**Status:** ⏳ **NEXT**

#### Required Work (In Order)

1. **Fix TypeScript errors**
   - Resolve remaining errors in `ethTestnetExecutor.ts`
   - `npm run build` must pass cleanly

2. **Wire ERC-20 Approvals**
   - Detect required approvals from `/api/execute/prepare`
   - Execute approval flow before execution
   - UI reflects approval progress without breaking existing components

3. **Persist & Display Routing Metadata**
   - Store routing source, venue, slippage, fee tier
   - Render metadata subtly in execution/position summaries

4. **Enable Real Quotes**
   - Use dFlow or fallback aggregator for live quotes
   - Clearly indicate quote source in UI
   - Ensure deterministic fallback behavior

#### Exit Criteria

- User can complete a full approve → execute flow
- Routing and quote provenance is visible
- No dead-end execution paths
- Execution UX remains consistent with Bucket A reliability standards

---

### Bucket C — Real Integrations (Planned)

**Scope (Not Started):**
- Hyperliquid perps execution
- Aave lending/borrowing
- Polymarket event execution
- Hybrid sim → real fallback logic

**Note:** Bucket C work must not begin until Bucket B is complete and stable.

---

## Blossom V1/V1.1 Runtime Rules

**Default Behavior: Testnet-Only**

Blossom V1/V1.1 runs in **testnet-only mode by default**. SIM mode is isolated to internal dev usage and requires explicit opt-in flags.

### Default Configuration

**Backend:**
- `EXECUTION_MODE` defaults to `eth_testnet` (not `sim`)
- `EXECUTION_AUTH_MODE` defaults to `direct`
- SIM mode only available if `ALLOW_SIM_MODE=true` is explicitly set
- If `EXECUTION_MODE=sim` is set but `ALLOW_SIM_MODE` is not `true`, backend auto-switches to `eth_testnet` and logs a warning

**Frontend:**
- `VITE_EXECUTION_MODE` defaults to `eth_testnet` (not `sim`)
- SIM UI/features only available if `VITE_ALLOW_SIM_MODE=true` is explicitly set

### Required Environment Variables for V1/V1.1

For `eth_testnet` mode, the following are **required** and validated on startup:

**Backend (`agent/.env.local`):**
```bash
# Required for eth_testnet mode
ETH_TESTNET_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
EXECUTION_ROUTER_ADDRESS=0x...
BLOSSOM_GEMINI_API_KEY=...  # Or BLOSSOM_OPENAI_API_KEY or BLOSSOM_ANTHROPIC_API_KEY
```

**Frontend (`.env.local` or `.env`):**
```bash
# Optional - defaults to eth_testnet
VITE_EXECUTION_MODE=eth_testnet
VITE_EXECUTION_AUTH_MODE=direct
```

### Startup Validation

The backend validates required configuration on startup:

1. **Health Endpoint (`/health`):**
   - Always available (even if config missing)
   - Returns `ok: false` and `missing: [...]` array if required vars are missing
   - Includes `executionMode` field

2. **Startup Banner:**
   - Logs configuration status
   - Shows clear errors if required vars missing
   - Provides actionable fix commands

3. **Fail-Fast Behavior:**
   - Backend starts but `/health` reports `ok: false` if config missing
   - Preflight endpoint (`/api/execute/preflight`) validates all required config
   - UI can check health status before attempting operations

### SIM Mode Isolation

SIM mode is **hard-isolated** and cannot leak into V1/V1.1:

- **Backend:** Only enabled if `ALLOW_SIM_MODE=true`
- **Frontend:** Only enabled if `VITE_ALLOW_SIM_MODE=true`
- **Endpoints:**
  - `/api/wallet/balances` never returns "SIM mode" unless `ALLOW_SIM_MODE=true`
  - `/api/execute/preflight` only returns SIM mode if explicitly allowed
  - `/api/reset` only resets simulation state if SIM mode is allowed; otherwise only resets chat state

### Startup Commands

**Standard V1/V1.1 Startup:**
```bash
# One-command startup (recommended)
./scripts/restart-demo.sh

# Manual startup (2 terminals)
# Terminal 1:
cd agent && PORT=3001 npm run dev

# Terminal 2:
npm run dev
```

**Verification:**
```bash
# Health check (should show executionMode=eth_testnet)
curl -s http://127.0.0.1:3001/health

# Preflight check (should return ok: true)
curl -s http://127.0.0.1:3001/api/execute/preflight

# V1/V1.1 smoke test
./scripts/v1-smoke.sh
```

### Expected Output

**`./scripts/restart-demo.sh` output:**
```
✅ Backend health check passed
✅ Preflight check passed
==========================================
✅ Demo READY
==========================================
```

**`curl -s http://127.0.0.1:3001/health` output:**
```json
{
  "ok": true,
  "ts": 1234567890,
  "service": "blossom-agent",
  "executionMode": "eth_testnet"
}
```

**If configuration missing:**
```json
{
  "ok": false,
  "ts": 1234567890,
  "service": "blossom-agent",
  "executionMode": "eth_testnet",
  "missing": [
    "ETH_TESTNET_RPC_URL",
    "EXECUTION_ROUTER_ADDRESS"
  ]
}
```

### Internal Dev Usage (SIM Mode)

To enable SIM mode for internal development:

**Backend:**
```bash
ALLOW_SIM_MODE=true EXECUTION_MODE=sim npm run dev
```

**Frontend:**
```bash
VITE_ALLOW_SIM_MODE=true VITE_EXECUTION_MODE=sim npm run dev
```

**Note:** SIM mode is **not** available in normal V1/V1.1 flows and will not appear unless explicitly enabled.

---

**End of Document**

