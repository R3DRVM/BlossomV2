# dFlow Capabilities Assessment

**Date:** 2025-01-03  
**Purpose:** Document where dFlow can plug into Blossom's existing architecture.

---

## Current Architecture Analysis

### 1. Existing dFlow References

**Found:** None in production code (only mentions in documentation)

Searched patterns: `dflow`, `dFlow`, `DFLOW`  
Results: Only `bloomoverview.md` mentions dFlow as a future quote provider

### 2. Current Event Market Data Flow

**Location:** `agent/src/services/predictionData.ts`

**Current providers:**
1. **Kalshi** - API with key (fallback to static)
2. **Polymarket** - Public API (fallback to static)

**Data format (`RawPredictionMarket`):**
```typescript
{
  id: string;
  title: string;
  source: 'KALSHI' | 'POLYMARKET';
  yesPrice: number;   // 0–1
  noPrice: number;    // 0–1
  volume24hUsd?: number;
  openInterestUsd?: number;
  isLive?: boolean;
}
```

**Normalization for UI:**
- `agent/src/services/ticker.ts` converts to `TickerItem` format
- UI expects `TickerPayload` with sections array

### 3. Current Routing Decisions

**Location:** `agent/src/quotes/evmQuote.ts`

**Current providers:**
1. **1inch** - Real-time quotes when `ROUTING_MODE=hybrid`
2. **Deterministic** - Fixed demo quotes (default fallback)

**Routing decision format (`RoutingDecision`):**
```typescript
{
  venue: string;
  chain: string;
  expectedOut: string;
  minOut: string;
  slippageBps: number;
  feeTier?: string;
  route?: string;
  routeSummary?: string;
  routingSource: 'deterministic' | '1inch' | 'dflow';
  gas?: string;
  warnings?: string[];
  settlementEstimate?: string;
  executionVenue?: string;
  executionNote?: string;
}
```

---

## dFlow Integration Points

### Capability 1: Event Market Data Provider

**Integration point:** Replace/enhance `fetchKalshiMarkets()` and `fetchPolymarketMarkets()`

**What dFlow would provide:**
- Real-time event market listings
- Prices/probabilities
- Volume/liquidity data
- Market metadata

**Required dFlow endpoint:** `DFLOW_EVENTS_MARKETS_PATH`

**Normalization needed:** Map dFlow response to `RawPredictionMarket[]`

### Capability 2: Event Quote Provider

**Integration point:** New function in quotes subsystem

**What dFlow would provide:**
- Best execution price for event trades
- Slippage estimates
- Liquidity depth

**Required dFlow endpoint:** `DFLOW_EVENTS_QUOTE_PATH`

**Usage:** Enrich proof-of-execution metadata for event trades

### Capability 3: Swap Quote Provider (Optional)

**Integration point:** Add to `getSwapRoutingDecision()` in `evmQuote.ts`

**What dFlow would provide:**
- Routing intelligence for swaps
- Alternative to 1inch quotes
- Potentially better rates

**Required dFlow endpoint:** `DFLOW_SWAPS_QUOTE_PATH`

**Fallback:** 1inch → deterministic

### Capability 4: Swap Execution

**Status:** ❌ NOT IMPLEMENTED

Execution stays with existing adapters:
- DemoSwapRouter (deterministic demo)
- UniswapV3SwapAdapter (when real execution enabled)

dFlow would only provide routing intelligence, not execution.

---

## Provider Selection Logic

```
                      ┌─────────────────────────────────────┐
                      │        DFLOW_ENABLED=true?          │
                      └──────────────┬────────────────────┘
                                     │
                    ┌───────────────▼───────────────┐
                    │  DFLOW_API_KEY + PATH set?    │
                    └───────────────┬───────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            │ YES                   │ NO                    │
            ▼                       ▼                       │
    ┌───────────────┐       ┌───────────────────┐          │
    │ Use dFlow     │       │ DFLOW_REQUIRE?    │          │
    │ provider      │       └───────┬───────────┘          │
    └───────────────┘               │                      │
                        ┌───────────┼───────────┐          │
                        │ true      │ false     │          │
                        ▼           ▼           │          │
                ┌────────────┐  ┌──────────┐   │          │
                │ Preflight  │  │ Use      │   │          │
                │ FAIL       │  │ fallback │◄──┴──────────┘
                └────────────┘  └──────────┘
```

---

## Environment Variables Needed

```bash
# Core dFlow config
DFLOW_ENABLED=false              # Master toggle
DFLOW_API_KEY=                   # API authentication
DFLOW_BASE_URL=                  # Base URL (e.g., https://api.dflow.net)

# Capability-specific paths
DFLOW_EVENTS_MARKETS_PATH=       # e.g., /v1/events/markets
DFLOW_EVENTS_QUOTE_PATH=         # e.g., /v1/events/quote
DFLOW_SWAPS_QUOTE_PATH=          # e.g., /v1/swaps/quote

# Behavior flags
DFLOW_REQUIRE=false              # If true, fail when dFlow unavailable
```

---

## UI Impact

**No UI component changes required.**

Changes limited to:
1. Chat.tsx assistant messages can show "Powered by dFlow"
2. Routing metadata includes `routingSource: 'dflow'`
3. Event market data may show "Source: dFlow" in messages

---

## Recommended Implementation Order

1. **dFlow client** - Generic request helper
2. **Provider interfaces** - Abstract data access
3. **Event markets provider** - Replace Polymarket/Kalshi
4. **Swap quote provider** - Alternative to 1inch
5. **Preflight integration** - Report dFlow status
6. **Tests** - Mocked provider tests


