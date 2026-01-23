# Three Blocker Audit — Investor Demo Polish

**Date:** 2025-12-27  
**Mode:** Read-only (no code changes)

---

## A) Pricing Cache Divergence — Root Cause & Fix Plan

### Current Data Flow Map

#### 1. `src/lib/demoPriceFeed.ts` (Canonical Source)
- **Function:** `getDemoSpotPrices(symbols: DemoSymbol[])` (lines 131-236)
- **Cache:** Module-level `priceCache: PriceCache | null` (line 29)
- **TTL:** 12s (`CACHE_TTL_MS = 12 * 1000`, line 30)
- **Calls CoinGecko:** Yes, via `fetchFromCoinGecko()` (lines 62-125)
- **Deduplication:** In-flight request deduplication (lines 33, 162-164)
- **Backoff:** 15s → 30s → 60s (lines 36-39)
- **Returns:** `Record<DemoSymbol, DemoPriceSnapshot>` with `isLive` flag

#### 2. `src/lib/liveSpot.ts` (Duplicate Cache)
- **Function:** `getCachedLiveTicker()` (lines 60-138)
- **Cache:** Module-level `tickerCache: LiveTickerCache | null` (line 30)
- **TTL:** 12s (`CACHE_TTL_MS = 12 * 1000`, line 31)
- **Calls CoinGecko:** Indirectly via `getDemoSpotPrices()` (line 69)
- **Problem:** Creates separate cache from `demoPriceFeed.ts` cache
- **Flow:** 
  1. Calls `getDemoSpotPrices()` (line 69)
  2. Extracts prices into `tickerCache` (lines 72-86)
  3. This creates a **second cache** with same TTL but different structure

- **Function:** `getLiveSpotForMarket(market: string)` (lines 145-181)
- **Calls CoinGecko:** Indirectly via `getDemoSpotPrices([symbol])` (line 155)
- **No cache:** Calls `getDemoSpotPrices()` directly (no local cache)
- **Fallback:** Calls `getCachedLiveTicker()` if demo feed returns static (line 168)

#### 3. `src/components/TickerStrip.tsx` (Ticker Display)
- **Function:** `fetchTicker()` (lines 183-355)
- **Polling:** 12s interval (line 161: `POLLING_INTERVAL_MS = 12 * 1000`)
- **Calls CoinGecko:** Directly via `getDemoSpotPrices(['BTC', 'ETH', 'SOL', 'AVAX', 'LINK'])` (line 238)
- **Cache Used:** `demoPriceFeed.ts` cache (via `getDemoSpotPrices()`)
- **Builds Payload:** Creates `TickerPayload` from `demoPrices` (lines 245-284)
- **Entry Price Source:** Not used (ticker only displays prices, doesn't anchor entry)

#### 4. `src/components/MessageBubble.tsx` (Entry Anchoring)
- **Function:** `useEffect` hook (lines 117-142)
- **Calls:**
  1. `getLiveSpotForMarket(strategy.market)` (line 120) → calls `getDemoSpotPrices([symbol])` → uses `demoPriceFeed.ts` cache
  2. `getCachedLiveTicker()` (line 134) → uses `liveSpot.ts` `tickerCache` (duplicate cache)
- **State:** `liveEntrySnapshot` (line 85), `livePrices` (line 84)
- **Entry Price Source:** `perpDisplay` object (lines 145-180)
  - Prefers `liveEntrySnapshot?.entryUsd` (from `getLiveSpotForMarket`)
  - Falls back to `livePrices[symbol]` (from `getCachedLiveTicker`)
- **Problem:** Two separate caches can have different timestamps, causing price divergence

#### 5. `src/components/ExecutionDetailsDisclosure.tsx` (TP/SL Display)
- **Function:** `useEffect` hook (lines 42-66)
- **Calls:** Same pattern as MessageBubble
  1. `getLiveSpotForMarket(strategy.market)` (line 45)
  2. `getCachedLiveTicker()` (line 58)
- **Entry Price Source:** `liveEntrySnapshot?.entryUsd` or `livePrices[spotSymbol]` (line 70)
- **TP/SL Computation:** `computeIndicativeTpSl()` (line 71)

### Root Cause

**Duplicate Caches:**
1. `demoPriceFeed.ts:29` → `priceCache` (12s TTL)
2. `liveSpot.ts:30` → `tickerCache` (12s TTL)

**Divergence Scenario:**
- Ticker polls at T=0s → `getDemoSpotPrices()` → caches in `priceCache` → shows $60,000
- User creates plan at T=6s → `getLiveSpotForMarket()` → reads from `priceCache` (still valid) → shows $60,000 ✅
- But if `getCachedLiveTicker()` is called separately, it creates `tickerCache` at different time → may show different price ❌

**Actual Issue:**
- `getCachedLiveTicker()` calls `getDemoSpotPrices()` but then **re-caches** the result in `tickerCache`
- If `getDemoSpotPrices()` cache expires between calls, `tickerCache` may have stale data
- `MessageBubble` calls both functions, creating race condition

### Canonical Price Source Recommendation

**Single Cache Owner:** `src/lib/demoPriceFeed.ts`
- Keep `priceCache` as the single source of truth
- Export cache accessor (read-only) if needed

**Thin Wrappers:**
1. `getCachedLiveTicker()` → Remove `tickerCache`, directly return prices from `getDemoSpotPrices()`
2. `getLiveSpotForMarket()` → Already calls `getDemoSpotPrices()` directly (no change needed)

**Fix Plan:**
- **File:** `src/lib/liveSpot.ts`
- **Change:** Remove `tickerCache` (lines 24-31)
- **Change:** `getCachedLiveTicker()` (lines 60-138) → Call `getDemoSpotPrices()` and return prices directly (no re-caching)
- **Result:** All price reads go through single `demoPriceFeed.ts` cache

**Risk:** Low (removes duplicate cache, simplifies data flow)

---

## B) Event Venue Label Source-Awareness — Root Cause & Fix Plan

### Current Source Values

#### Backend (`agent/src/services/ticker.ts`)
- **Function:** `getEventMarketsTicker()` (lines 175-233)
- **Returns:** `TickerPayload` with `source: 'polymarket' | 'kalshi' | 'static'` (line 232)
- **Logic:** 
  - `hasLivePolymarket ? 'polymarket' : hasLiveKalshi ? 'kalshi' : 'static'` (line 232)
- **Also:** `isLive: boolean` (line 231), `lastUpdatedMs: number` (line 230)

#### Frontend (`src/components/TickerStrip.tsx`)
- **Function:** `fetchTicker()` for `venue === 'event_demo'` (lines 195-223)
- **Uses Source:** Reads `payload.source` but doesn't store it anywhere accessible to strategy cards
- **Display:** Shows sections labeled "Kalshi" or "Polymarket" (from `item.meta`, line 207)

#### Strategy Interface (`src/context/BlossomContext.tsx`)
- **Interface:** `Strategy` (lines 8-37)
- **Event Fields:** `eventKey`, `eventLabel`, `stakeUsd`, `maxPayoutUsd`, `eventSide`, `eventOutcome`
- **Missing:** No field for `marketSource` or `venueSource`
- **Problem:** Source information from ticker is lost when strategy is created

#### Display Locations (Hardcoded)

1. **Collapsed Event Card** (`src/components/MessageBubble.tsx:412`)
   - **Line 412:** `"Polymarket • Polygon (simulated)"`
   - **Hardcoded:** Always shows Polymarket, regardless of actual source

2. **Expanded Routing Section** (`src/components/ExecutionDetailsDisclosure.tsx:206-211`)
   - **Line 206:** `"Polymarket (simulated)"`
   - **Line 211:** `"Polygon (simulated)"`
   - **Hardcoded:** Always shows Polymarket/Polygon

### Root Cause

**Source Information Loss:**
- Ticker payload has `source` field (polymarket/kalshi/static)
- But when event strategy is created, source is not stored in `Strategy` object
- Display components have no way to know the actual source
- Result: Always shows "Polymarket • Polygon" even for Kalshi markets

### Fix Plan

**Option 1: Add Optional Field to Strategy (Minimal)**
- **File:** `src/context/BlossomContext.tsx`
- **Change:** Add `eventMarketSource?: 'polymarket' | 'kalshi' | 'static'` to `Strategy` interface (line 37, after `requestedStakeUsd`)
- **Risk:** Low (optional field, backward compatible)

**Option 2: Pass Source During Strategy Creation**
- **Files:** 
  - `src/components/Chat.tsx` (where `addDraftStrategy()` is called)
  - `src/context/BlossomContext.tsx` (`addDraftStrategy()` function)
- **Change:** When creating event strategy, read current ticker `source` and store in `eventMarketSource`
- **Risk:** Medium (requires ticker state access in Chat component)

**Option 3: Derive Source from Ticker at Display Time (No Strategy Change)**
- **Files:**
  - `src/components/MessageBubble.tsx`
  - `src/components/ExecutionDetailsDisclosure.tsx`
- **Change:** Read `venue` from context, check if `venue === 'event_demo'`, then read ticker payload `source` from TickerStrip state or context
- **Risk:** Medium (requires ticker state sharing)

**Recommended: Option 1 + Option 2**
- Add `eventMarketSource` field (optional)
- Store source when creating event strategy (read from ticker or pass as param)

**Display Logic:**
- **Venue Label:**
  - `strategy.eventMarketSource === 'polymarket'` → "Polymarket"
  - `strategy.eventMarketSource === 'kalshi'` → "Kalshi"
  - `strategy.eventMarketSource === 'static'` or undefined → "Prediction Markets (demo)"
- **Chain Label:**
  - `strategy.eventMarketSource === 'polymarket'` → "Polygon"
  - `strategy.eventMarketSource === 'kalshi'` → "Kalshi" (no chain)
  - Otherwise → "Simulated"

**Files to Modify:**
1. `src/context/BlossomContext.tsx:37` → Add `eventMarketSource?: 'polymarket' | 'kalshi' | 'static'`
2. `src/components/Chat.tsx` → When creating event strategy, read ticker source and pass to `addDraftStrategy()`
3. `src/components/MessageBubble.tsx:412` → Use `strategy.eventMarketSource` for venue label
4. `src/components/ExecutionDetailsDisclosure.tsx:206-211` → Use `strategy.eventMarketSource` for venue/chain labels

**Risk:** Low (optional field, display-only changes)

---

## C) Missing 4th Event Quick Card — Root Cause & Fix Plan

### Current State

**File:** `src/components/QuickStartPanel.tsx`
- **Function:** `getQuickActionsForVenue(venue: Venue)` (lines 12-51)
- **Event Array:** Lines 14-30
- **Count:** 3 items only
- **Items:**
  1. "Bet on macro events" (line 15-19)
  2. "Scan my event exposure" (line 20-24)
  3. "Risk-adjusted event sizing" (line 25-29)

### Root Cause

**Missing Item:** 4th card was requested but never added to the array.

### Fix Plan

**File:** `src/components/QuickStartPanel.tsx`
- **Location:** Line 29 (after 3rd item, before closing bracket)
- **Add:**
  ```typescript
  {
    title: 'Explore top markets',
    description: 'View the highest-volume prediction markets right now.',
    prompt: 'Show me the top 5 prediction markets by volume',
  },
  ```

**Grid Layout:** Already supports 4 items (2x2 grid, line 143: `grid grid-cols-2`)

**Risk:** None (UI-only, array addition)

---

## Summary: Minimal Patch Plan

### Blocker 1: Pricing Cache Divergence

**Files:**
- `src/lib/liveSpot.ts`

**Changes:**
1. Remove `tickerCache` (lines 24-31)
2. Modify `getCachedLiveTicker()` (lines 60-138):
   - Remove `tickerCache` read/write
   - Call `getDemoSpotPrices()` directly
   - Return prices object immediately (no re-caching)

**Risk:** Low (removes duplicate, simplifies flow)

---

### Blocker 2: Event Venue Label Source-Awareness

**Files:**
1. `src/context/BlossomContext.tsx:37` → Add `eventMarketSource?: 'polymarket' | 'kalshi' | 'static'`
2. `src/components/Chat.tsx` → Read ticker source when creating event strategy, pass to `addDraftStrategy()`
3. `src/components/MessageBubble.tsx:412` → Replace hardcoded "Polymarket • Polygon" with conditional based on `strategy.eventMarketSource`
4. `src/components/ExecutionDetailsDisclosure.tsx:206-211` → Replace hardcoded labels with conditional

**Helper Function (optional):**
- Create `formatEventVenueDisplay(source?: 'polymarket' | 'kalshi' | 'static')` in `src/lib/formatPlanCard.ts`
- Returns `{ venue: string, chain: string }`

**Risk:** Low (optional field, display-only)

---

### Blocker 3: Missing 4th Quick Card

**File:**
- `src/components/QuickStartPanel.tsx:29`

**Change:**
- Add 4th object to array (see exact code above)

**Risk:** None

---

## Risks & Gotchas

### High Risk (Don't Touch)
- Session management (`appendMessageToChat`, `updateMessageInChat`)
- Confirm flow (`handleConfirmTrade`, refs)
- Strategy state transitions (`addDraftStrategy`, `updateStrategyStatus`)

### Medium Risk (Test Thoroughly)
- **Cache removal:** Ensure `getCachedLiveTicker()` callers still work (MessageBubble, ExecutionDetailsDisclosure)
- **Source propagation:** Ensure ticker source is available when strategy is created (may need to read from TickerStrip state or context)

### Low Risk (Safe)
- UI label changes (display-only)
- Array addition (no logic change)

---

## Estimated Effort

- **Blocker 1:** 30 minutes (remove duplicate cache)
- **Blocker 2:** 1 hour (add field, propagate source, update 2 display locations)
- **Blocker 3:** 5 minutes (add array item)

**Total:** ~2 hours


