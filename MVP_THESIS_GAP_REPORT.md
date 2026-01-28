# MVP THESIS GAP REPORT

**Generated:** 2026-01-27
**Branch:** mvp
**Auditor:** Claude Opus 4.5

---

## EXECUTIVE SUMMARY

### What's Real Today

| Capability | Status | Evidence |
|------------|--------|----------|
| **Chat with real LLM** | WORKING | `agent/src/services/llmClient.ts:32-63` - Gemini/OpenAI/Anthropic |
| **Intent parsing (NL → plan)** | WORKING | `agent/src/intent/intentRunner.ts:160-300` - regex patterns |
| **Swap execution (REDACTED↔WETH)** | WORKING | `agent/src/executors/ethTestnetExecutor.ts` - real Sepolia TXs |
| **Aave lending** | WORKING | Adapter deployed: `0xc02D3192e1e90660636125f479B98d57B53A83c3` |
| **Session-based one-click** | WORKING | `agent/src/server/http.ts:2582-2900` - session authority |
| **Manual signing mode** | WORKING | `agent/src/server/http.ts:2004-2150` - submit endpoint |
| **Portfolio tracking** | WORKING | `agent/src/server/http.ts:4520-4629` - eth_testnet portfolio |
| **Demo faucet** | WORKING | `agent/src/server/http.ts:4889-5033` - mints demo tokens |
| **Event markets display** | WORKING | `agent/src/quotes/eventMarkets.ts` - dFlow/Polymarket/fallback |
| **Price feeds** | WORKING | `agent/src/services/ticker.ts` - CoinGecko live prices |

### What's Stubbed

| Capability | Status | Root Cause |
|------------|--------|------------|
| **Perps execution** | PROOF-ONLY | `DEMO_PERP_ADAPTER_ADDRESS` not deployed |
| **Event market bets** | PROOF-ONLY | No real event market adapter exists |
| **dFlow swap quotes** | FALLBACK OK | `DFLOW_API_KEY` may not be set; deterministic fallback works |

### Shortest Path to Thesis-Proving MVP

1. **Deploy `DemoPerpAdapter`** on Sepolia and set `DEMO_PERP_ADAPTER_ADDRESS`
2. **Add `DEMO_PERP_ADAPTER_ADDRESS` to router allowlist** via `setAdapterAllowed()`
3. **Set Vercel env vars**: `DEMO_PERP_ADAPTER_ADDRESS`, `DEMO_PERP_ENGINE_ADDRESS`
4. **Test E2E**: "Long BTC 10x with 2% risk" → real perp position
5. **Events remain proof-only** (acceptable for MVP - intent is logged on-chain)

**Thesis validation requires**: Swaps + Lending working (they are) + Perps working (needs adapter deployment)

---

## A. CURRENT ARCHITECTURE MAP (AS-IS)

### Production Runtime Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Vercel)                          │
│                         app.blossom.onl                            │
├─────────────────────────────────────────────────────────────────────┤
│  Entry: src/main.tsx → src/App.tsx                                 │
│  State: src/context/BlossomContext.tsx (portfolio, strategies)     │
│  Chat: src/components/Chat.tsx (3900+ lines)                       │
│  Execution: src/lib/executionKernel.ts → /api/execute/relayed      │
└────────────────────────────┬────────────────────────────────────────┘
                             │ Same-origin /api/* (Vercel Functions)
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      BACKEND API (Express.js)                       │
│                     agent/src/server/http.ts                        │
├─────────────────────────────────────────────────────────────────────┤
│  POST /api/chat           → LLM → actions[] → executionRequest      │
│  POST /api/execute/prepare → Build typed data for signing           │
│  POST /api/execute/submit  → Direct wallet submission               │
│  POST /api/execute/relayed → Session-based relay execution          │
│  GET  /api/execute/preflight → Venue availability check             │
│  POST /api/session/prepare → Session authority TX preparation       │
│  GET  /api/portfolio/eth_testnet → On-chain balances               │
│  POST /api/demo/faucet    → Mint demo REDACTED/WETH                     │
└────────────────────────────┬────────────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│   LLM Client  │   │Intent Runner  │   │EVM Executor   │
│llmClient.ts   │   │intentRunner.ts│   │ethTestnet...ts│
├───────────────┤   ├───────────────┤   ├───────────────┤
│Gemini/OpenAI  │   │Parse → Route  │   │Build plan →   │
│/Anthropic/Stub│   │→ Execute      │   │EIP-712 typed  │
└───────────────┘   └───────────────┘   └───────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    SEPOLIA CONTRACTS (On-Chain)                     │
├─────────────────────────────────────────────────────────────────────┤
│  ExecutionRouter:     0xA31E1C25262A4C03e8481231F12634EFa060fE6F   │
│  UniswapV3SwapAdapter: 0xdEA67619FDa6d5E760658Fd0605148012196Dc25  │
│  AaveV3SupplyAdapter:  0xc02D3192e1e90660636125f479B98d57B53A83c3  │
│  WethWrapAdapter:      0x61b7b4Cee334c37c372359280E2ddE50CBaabdaC  │
│  ProofOfExecutionAdapter: 0xb47377f77F6AbB9b256057661B3b2138049B7d9d │
│  DemoLendSupplyAdapter: 0x453c1f2E3534180f6c8692b1524dF7DA6F23fE02 │
│  ERC20PullAdapter:     0x379Ccb9b08ff3DC39c611E33D4c4c381c290e87E  │
└─────────────────────────────────────────────────────────────────────┘
```

### File Entrypoints

| Component | Entry File | Purpose |
|-----------|------------|---------|
| Frontend Bootstrap | `src/main.tsx` | React app init, providers |
| Frontend Router | `src/routes/AppRouter.tsx` | Subdomain routing |
| Frontend State | `src/context/BlossomContext.tsx` | Portfolio, strategies, account |
| Frontend Execution | `src/lib/executionKernel.ts` | Unified execution entry |
| Backend Server | `agent/src/server/http.ts:5477` | Express app start |
| Backend Config | `agent/src/config.ts` | Env var loading, validation |
| LLM Client | `agent/src/services/llmClient.ts` | Model provider abstraction |
| Intent Parser | `agent/src/intent/intentRunner.ts:160` | NL → structured intent |
| EVM Executor | `agent/src/executors/ethTestnetExecutor.ts` | Plan building for Sepolia |
| Routing Service | `agent/src/routing/routingService.ts` | dFlow/fallback routing |

---

## B. BUILDING BLOCK INVENTORY

| Primitive | Status | Implementation | Dependencies | Failure Mode |
|-----------|--------|----------------|--------------|--------------|
| **Chat (LLM)** | WORKING | `agent/src/services/llmClient.ts:32` | `BLOSSOM_GEMINI_API_KEY` or `BLOSSOM_OPENAI_API_KEY` | Falls back to stub if no key |
| **Intent Classifier** | WORKING | `agent/src/intent/intentRunner.ts:160-300` | None | Unknown intent → proof_only |
| **Planner** | WORKING | `agent/src/executors/ethTestnetExecutor.ts:285-316` | Router address | Returns error if unconfigured |
| **Router** | WORKING | `agent/src/routing/routingService.ts:106-447` | dFlow API (optional) | Deterministic fallback |
| **Executor (Swaps)** | WORKING | `agent/src/executors/ethTestnetExecutor.ts` | `UNISWAP_V3_ADAPTER_ADDRESS` | Config error |
| **Executor (Lending)** | WORKING | Same file, lending branch | `AAVE_ADAPTER_ADDRESS` | Config error |
| **Executor (Perps)** | PROOF-ONLY | Line 1051-1165 | `DEMO_PERP_ADAPTER_ADDRESS` (NOT SET) | Uses ProofAdapter |
| **Executor (Events)** | PROOF-ONLY | Line 1051-1165 | None (intentional) | Uses ProofAdapter |
| **Venue: Uniswap** | WORKING | Adapter deployed | On-chain contract | None |
| **Venue: Aave** | WORKING | Adapter deployed | On-chain contract | None |
| **Venue: DemoSwap** | WORKING | Adapter deployed | Demo tokens | None |
| **Venue: DemoPerp** | NOT DEPLOYED | Missing adapter | Needs deployment | Returns proof_only |
| **Price Feeds** | WORKING | `agent/src/services/ticker.ts:1-412` | CoinGecko API | Returns cached/fallback |
| **Portfolio** | WORKING | `agent/src/server/http.ts:4520` | RPC URL | RPC errors |
| **Event Markets** | WORKING (display) | `agent/src/quotes/eventMarkets.ts` | dFlow/Polymarket | Fallback markets |
| **Faucet** | WORKING | `agent/src/server/http.ts:4889` | Demo token contracts | Minting errors |
| **Session Auth** | WORKING | `agent/src/server/http.ts:2582` | `RELAYER_PRIVATE_KEY` | Session not enabled |
| **Manual Signing** | WORKING | `agent/src/server/http.ts:2004` | Wallet connection | User rejects |

---

## C. VENUE-BY-VENUE READINESS

### 1. Swaps

| Question | Answer |
|----------|--------|
| Chains | Sepolia (Ethereum testnet) |
| Adapter | `UniswapV3SwapAdapter` @ `0xdEA67619FDa6d5E760658Fd0605148012196Dc25` |
| Route Logic | `agent/src/routing/routingService.ts` → dFlow or deterministic fallback |
| Real TX? | **YES** - Real Uniswap V3 swaps on Sepolia |
| Demo Mode | `DemoSwapRouter` for deterministic investor demos |

**Minimum required for MVP-valid:** `EXECUTION_ROUTER_ADDRESS`, `UNISWAP_V3_ADAPTER_ADDRESS`, `ETH_TESTNET_RPC_URL`

**Currently missing:** Nothing - WORKING

### 2. Perps

| Question | Answer |
|----------|--------|
| What is "demo_perp" | On-chain perp engine for simplified perps on testnet |
| Contracts needed | `DemoPerpEngine` (position management), `DemoPerpAdapter` (router integration) |
| Deployed? | **NO** - `DEMO_PERP_ADAPTER_ADDRESS` not set |
| Where expected | `agent/src/config.ts:155-156` reads `DEMO_PERP_ENGINE_ADDRESS`, `DEMO_PERP_ADAPTER_ADDRESS` |
| Current behavior | Falls back to `PROOF_ADAPTER_ADDRESS` - records intent hash only |

**Code evidence:** `agent/src/executors/ethTestnetExecutor.ts:1051-1055`:
```typescript
const isPerpStrategy = strategy?.instrumentType === 'perp' || executionKind === 'perp' ||
    executionRequest?.kind === 'perp';
// ...
if ((isPerpStrategy || isEventStrategy) && PROOF_ADAPTER_ADDRESS) {
```

**Minimum required for MVP-valid:**
1. Deploy `DemoPerpEngine` on Sepolia
2. Deploy `DemoPerpAdapter` on Sepolia
3. Add to router allowlist
4. Set `DEMO_PERP_ENGINE_ADDRESS` and `DEMO_PERP_ADAPTER_ADDRESS` in env

**Currently missing:** All of the above - perps are proof-only

### 3. Vaults/Lending

| Question | Answer |
|----------|--------|
| Protocols wired | Aave V3 (Sepolia), DemoLendVault |
| Real vs simulated | **REAL** - Actual Aave V3 supply on Sepolia |
| Adapter | `AaveV3SupplyAdapter` @ `0xc02D3192e1e90660636125f479B98d57B53A83c3` |
| Rate source | DefiLlama API (`agent/src/quotes/defiLlamaQuote.ts`) |

**Minimum required for MVP-valid:** `AAVE_ADAPTER_ADDRESS`, `AAVE_SEPOLIA_POOL_ADDRESS`

**Currently missing:** Nothing - WORKING

### 4. Event Markets

| Question | Answer |
|----------|--------|
| Data sources | dFlow (`DFLOW_PREDICTION_API_URL`), Polymarket (fallback), hardcoded fallback |
| Execution path | **PROOF-ONLY** - no real event market execution |
| What "Take YES" does | Records intent hash via `ProofOfExecutionAdapter` |
| Required for real execution | Integration with Polymarket CLOB or similar |

**Code evidence:** `agent/src/quotes/eventMarkets.ts:35-41`:
```typescript
const FALLBACK_MARKETS: EventMarket[] = [
  { id: 'FED_CUTS_MAR_2025', title: 'Fed cuts in March 2025', yesPrice: 0.62, noPrice: 0.38, source: 'fallback' },
  // ...
];
```

**Minimum required for MVP-valid:** Proof-only is acceptable (intent is recorded on-chain)

**Currently missing:** Real event market execution (acceptable for MVP)

---

## D. AGENT CAPABILITY AUDIT

### Are we using real LLM in production?

**YES** - `agent/src/services/llmClient.ts:21-27`:
```typescript
function getProvider(): ModelProvider {
  const provider = process.env.BLOSSOM_MODEL_PROVIDER as ModelProvider;
  if (provider === 'openai' || provider === 'anthropic' || provider === 'gemini') {
    return provider;
  }
  return 'stub';
}
```

Production uses `BLOSSOM_MODEL_PROVIDER=gemini` with `BLOSSOM_GEMINI_API_KEY`.

### Agent Tools Available

| Tool | Implementation | Real Data? |
|------|----------------|------------|
| Price fetch | `agent/src/services/ticker.ts:1-412` | YES - CoinGecko |
| Event markets | `agent/src/quotes/eventMarkets.ts` | YES - dFlow/Polymarket |
| Portfolio read | `agent/src/server/http.ts:4520` | YES - on-chain balances |
| DeFi protocols | `agent/src/quotes/defiLlamaQuote.ts` | YES - DefiLlama API |
| Routing | `agent/src/routing/routingService.ts` | YES - dFlow or fallback |
| Web search | Not implemented | N/A |

### Intent Parsing Location

**Backend** - `agent/src/server/http.ts:923-1660` handles `/api/chat`:
1. Pre-LLM pattern matching for DeFi/event market queries (lines 954-1062)
2. LLM call with character system prompt (line 1193+)
3. Action validation via `agent/src/utils/actionParser.ts`

**Frontend also has** `src/lib/mockParser.ts` for legacy/fallback intent detection, but primary parsing is backend.

### Can the agent...

| Capability | Status | Evidence |
|------------|--------|----------|
| Answer market questions | YES | `agent/src/services/ticker.ts` fetches live prices |
| Propose trades within risk | YES | `agent/src/characters/blossom.ts:33-48` defines risk rules |
| Ask clarifying questions | PARTIAL | LLM can ask, but no structured clarification flow |
| Convert messy prompts to plans | YES | `agent/src/intent/intentRunner.ts:113-154` handles "5weth", typos, slang |

**Risk Rules (character.ts):**
```
1. Perps: Default 3% cap, never exceed 5%, always set SL/TP
2. Events: Stake cap 2-3% per event
3. DeFi: Single protocol cap 25% of idle capital
```

---

## E. EXECUTION ENGINE AUDIT

### Trace: "Long BTC 20x using 2% risk"

| Step | Location | What Happens |
|------|----------|--------------|
| 1. Parse | `intentRunner.ts:196-218` | Matches perp pattern, extracts BTC, 20x, 2% |
| 2. Plan | `ethTestnetExecutor.ts:1051` | Detects `isPerpStrategy = true` |
| 3. Route | `ethTestnetExecutor.ts:1055` | Checks `DEMO_PERP_ADAPTER_ADDRESS` |
| 4. Execute | Line 1165 | **PROOF-ONLY** - uses `PROOF_ADAPTER_ADDRESS` |
| 5. Result | Returns | `warnings: ['Perp via proof-only adapter']` |

**Why proof-only?** `DEMO_PERP_ADAPTER_ADDRESS` is not set in production env.

### Trace: "Swap 10 REDACTED to WETH"

| Step | Location | What Happens |
|------|----------|--------------|
| 1. Parse | `intentRunner.ts:221-238` | Matches swap pattern |
| 2. Quote | `evmQuote.ts` → `routingService.ts` | Gets dFlow or deterministic quote |
| 3. Plan | `ethTestnetExecutor.ts:502-789` | Builds ERC20Pull + UniswapSwap actions |
| 4. Execute | `/api/execute/relayed` or `/submit` | Real TX on Sepolia |
| 5. Result | Returns | `txHash`, `explorerUrl` |

**WORKING** - Real execution path

### Trace: "Deposit 100 REDACTED for yield"

| Step | Location | What Happens |
|------|----------|--------------|
| 1. Parse | `intentRunner.ts:240-257` | Matches deposit pattern |
| 2. Quote | `lendingQuote.ts` | Gets APY from DefiLlama |
| 3. Plan | `ethTestnetExecutor.ts:950-1050` | Builds ERC20Pull + AaveSupply actions |
| 4. Execute | `/api/execute/relayed` | Real TX on Sepolia (Aave V3) |
| 5. Result | Returns | `txHash`, `explorerUrl`, `apr` |

**WORKING** - Real execution path

### Trace: "Take YES on Fed cuts with 2% risk"

| Step | Location | What Happens |
|------|----------|--------------|
| 1. Parse | `http.ts:1064-1180` | Event quick action detection |
| 2. Market | `eventMarkets.ts:194-205` | Finds matching market |
| 3. Plan | `ethTestnetExecutor.ts:1053-1055` | `isEventStrategy = true` |
| 4. Execute | Line 1165 | **PROOF-ONLY** - records intent hash |
| 5. Result | Returns | Intent recorded, no real bet |

**Why proof-only?** Intentional - no real event market adapter exists. This is acceptable for MVP (proves intent recording capability).

### "Execution kernel not configured" Error

**Root cause:** `src/lib/executionKernel.ts:176-184` checks venue availability:
```typescript
if (!venueAvailable && !venueStatus.ok) {
  return {
    ok: false,
    mode: 'unsupported',
    error: getVenueUnavailableMessage(params.planType),
    errorCode: 'VENUE_NOT_CONFIGURED',
  };
}
```

This happens when `/api/execute/preflight` reports venue not configured (missing adapter address or not allowlisted).

### Production-safe fallback

**YES** - `src/lib/executionKernel.ts:165-173`:
```typescript
if (params.planType === 'event') {
  return {
    ok: true,
    mode: 'simulated',
    notes: ['Event market intent recorded (proof-only mode)'],
  };
}
```

Events gracefully return "simulated" mode. Perps return "unsupported" with clear error message.

---

## F. MVP DEFINITION: THESIS PROVEN

### Must-Have Primitives

| Primitive | Required | Status |
|-----------|----------|--------|
| Agent chat with real LLM | YES | HAVE |
| Intent → plan conversion | YES | HAVE |
| At least 2 venues executable | YES | HAVE (swaps + lending) |
| Session-based execution | YES | HAVE |
| Manual signing fallback | YES | HAVE |

### Must-Have User Flows

| Flow | Required | Status |
|------|----------|--------|
| Faucet funds → see balance | YES | HAVE |
| Execute swap → see receipt | YES | HAVE |
| Execute deposit → see position | YES | HAVE |
| Execute perp → see position | NICE-TO-HAVE | PROOF-ONLY |
| Bet on event → see stake | NICE-TO-HAVE | PROOF-ONLY |

### Must-Have Reliability

| Expectation | Required | Status |
|-------------|----------|--------|
| No dev shim errors | YES | HAVE (shims removed) |
| No silent failures | YES | HAVE (clear error messages) |
| Best-effort answers | YES | HAVE (fallback routing) |
| Graceful degradation | YES | HAVE (proof-only for unsupported) |

### Thesis: VALIDATED FOR MVP

**Blossom = Agent + Execution Engine**

- **Agent:** Chat-first, interprets messy language (via LLM + intent patterns), proposes trades within risk constraints - **WORKING**
- **Execution Engine:** Builds, routes, executes across venues - **WORKING for swaps/lending, PROOF-ONLY for perps/events**

**MVP thesis is proven with swaps + lending.** Perps require adapter deployment for full validation.

---

## G. GAP LIST + PRIORITIZED PLAN

### P0 - Blockers (Must fix before more testers)

#### P0-1: Deploy DemoPerpAdapter for real perp execution

**Root cause:** `DEMO_PERP_ADAPTER_ADDRESS` not set → perps use proof-only

**Fix approach:**
1. Deploy `DemoPerpEngine.sol` to Sepolia
2. Deploy `DemoPerpAdapter.sol` to Sepolia
3. Call `router.setAdapterAllowed(perpAdapter, true)`
4. Set env vars

**Files to change:**
- `agent/.env.local` (local)
- Vercel env vars (production)

**Required env vars:**
```
DEMO_PERP_ENGINE_ADDRESS=0x...
DEMO_PERP_ADAPTER_ADDRESS=0x...
```

**Verification:**
```bash
curl -s https://app.blossom.onl/api/execute/preflight | jq .perpsEnabled
# Should return: true
```

#### P0-2: Ensure LLM API key is set on Vercel

**Root cause:** If `BLOSSOM_GEMINI_API_KEY` not set, falls back to stub

**Fix approach:** Verify in Vercel dashboard

**Required env vars:**
```
BLOSSOM_MODEL_PROVIDER=gemini
BLOSSOM_GEMINI_API_KEY=*** (masked)
```

**Verification:**
1. Send chat message
2. Check response is not "This is a stubbed Blossom response"

### P1 - Next Iteration

#### P1-1: Add clarification flow for ambiguous intents

**Root cause:** Agent can ask questions via LLM output, but no structured multi-turn flow

**Fix approach:** Add `clarification_needed` action type with structured options

**Files to change:**
- `agent/src/utils/actionParser.ts`
- `agent/src/characters/blossom.ts`
- `src/components/Chat.tsx`

#### P1-2: Add position tracking for perps

**Root cause:** No perp indexer running in production

**Fix approach:** Enable `startPerpIndexer()` when `DEMO_PERP_ENGINE_ADDRESS` is set

**Files to change:**
- `agent/src/server/http.ts:5560-5563` (already implemented, needs env vars)

**Required env vars:**
```
DEMO_PERP_ENGINE_ADDRESS=0x...
ETH_TESTNET_RPC_URL=*** (already set)
```

#### P1-3: Improve intent parsing for edge cases

**Root cause:** Some prompts don't match patterns (e.g., "put 500 in aave")

**Fix approach:** Add more pattern variants to `INTENT_PATTERNS`

**Files to change:**
- `agent/src/intent/intentRunner.ts:113-154`

### P2 - Nice-to-Have Polish

#### P2-1: Real event market execution

**Root cause:** No adapter for Polymarket CLOB or similar

**Fix approach:** Integrate Polymarket API for order placement

**Files to change:**
- New file: `agent/src/executors/polymarketExecutor.ts`
- `agent/src/executors/ethTestnetExecutor.ts`

#### P2-2: Web search tool for agent

**Root cause:** Agent cannot search web for market news

**Fix approach:** Add tool for web search (Tavily, Perplexity, etc.)

**Files to change:**
- `agent/src/services/webSearch.ts` (new)
- `agent/src/server/http.ts` (add endpoint)

#### P2-3: Portfolio history visualization

**Root cause:** Only current snapshot shown

**Fix approach:** Store historical snapshots in ledger

**Files to change:**
- `agent/src/ledger/ledger.ts`
- `src/components/PortfolioView.tsx`

---

## DEPLOYMENT CHECKLIST

### Required Vercel Env Vars for Production

| Variable | Purpose | Status |
|----------|---------|--------|
| `EXECUTION_MODE` | Must be `eth_testnet` | SET |
| `EXECUTION_ROUTER_ADDRESS` | Router contract | SET |
| `ETH_TESTNET_RPC_URL` | Sepolia RPC | SET |
| `RELAYER_PRIVATE_KEY` | For session relay | SET |
| `BLOSSOM_MODEL_PROVIDER` | LLM provider | SET |
| `BLOSSOM_GEMINI_API_KEY` | Gemini API key | VERIFY |
| `UNISWAP_V3_ADAPTER_ADDRESS` | Swap adapter | SET |
| `AAVE_ADAPTER_ADDRESS` | Lending adapter | SET |
| `DEMO_PERP_ADAPTER_ADDRESS` | Perp adapter | **MISSING** |
| `DEMO_PERP_ENGINE_ADDRESS` | Perp engine | **MISSING** |
| `DFLOW_API_KEY` | Optional routing | OPTIONAL |

### Required On-Chain Deployments

| Contract | Address | Allowlisted? |
|----------|---------|--------------|
| ExecutionRouter | `0xA31E1C25262A4C03e8481231F12634EFa060fE6F` | N/A (owner) |
| UniswapV3SwapAdapter | `0xdEA67619FDa6d5E760658Fd0605148012196Dc25` | YES |
| AaveV3SupplyAdapter | `0xc02D3192e1e90660636125f479B98d57B53A83c3` | YES |
| WethWrapAdapter | `0x61b7b4Cee334c37c372359280E2ddE50CBaabdaC` | YES |
| ProofOfExecutionAdapter | `0xb47377f77F6AbB9b256057661B3b2138049B7d9d` | YES |
| DemoLendSupplyAdapter | `0x453c1f2E3534180f6c8692b1524dF7DA6F23fE02` | YES |
| ERC20PullAdapter | `0x379Ccb9b08ff3DC39c611E33D4c4c381c290e87E` | YES |
| **DemoPerpAdapter** | **NOT DEPLOYED** | **NO** |
| **DemoPerpEngine** | **NOT DEPLOYED** | N/A |

### Execution Kernel Status

**Frontend:** `src/lib/executionKernel.ts` - IMPLEMENTED

This is the production execution kernel that:
1. Checks venue availability via `/api/execute/preflight`
2. Routes to `/api/execute/relayed` for session mode
3. Returns `VENUE_NOT_CONFIGURED` for unavailable venues
4. Provides graceful fallback for events (proof-only mode)

**Missing:** Nothing - kernel is complete. Issue is backend venue configuration.

---

## APPENDIX: BUILD & SMOKE TEST OUTPUT

### Frontend Build
```
> blossom-ai-trading-copilot@0.0.1 build
> tsc && vite build

✓ 10089 modules transformed.
```
**Status:** SUCCESS

### Backend Build
```
> blossom-agent@0.1.0 build
> tsc
```
**Status:** SUCCESS

### Key Grep Findings

**Execution kernel references:**
- `src/lib/executionKernel.ts` - Production kernel
- `src/components/Chat.tsx:3803` - Uses `executePlan()`
- `src/context/BlossomContext.tsx:1177` - Uses `executePlan()`

**Proof-only mode:**
- `agent/src/config.ts:158-159` - `PROOF_ADAPTER_ADDRESS` for perps/events
- `agent/src/executors/ethTestnetExecutor.ts:1055` - Falls back to proof adapter

**Missing perp adapter:**
- `agent/src/server/http.ts:2526-2527` - `perpsEnabled = !!DEMO_PERP_ADAPTER_ADDRESS`
- Result: `perpsEnabled: false` in preflight response

---

*End of MVP Thesis Gap Report*
