# Blossom Investor Demo Polish Audit

**Date:** 2025-12-27  
**Scope:** On-chain (Hyperliquid) + Event Markets (Polymarket/Kalshi) demo flows  
**Mode:** Read-only audit (no code changes)

---

## 1. Current Demo Flow Map

### On-Chain (Hyperliquid) Flow

1. **App Load** (`src/main.tsx:12`)
   - Console noise filter installed
   - Context providers initialized
   - Venue defaults to `'hyperliquid'`

2. **Ticker Initialization** (`src/components/TickerStrip.tsx:357-361`)
   - Polls every 12s
   - Priority: CoinGecko demo feed → Agent backend → Static fallback
   - Status indicator: "Live • as of HH:MM:SS" | "Stale • ..." | "Static (demo)"

3. **Empty State** (`src/components/Chat.tsx:2477-2501`)
   - Header: "Try an execution request"
   - Subtext: "Prices are live. Execution and routing are simulated until you confirm."
   - Quick suggestion chips (3 for on-chain)

4. **Quick Start Panel** (`src/components/QuickStartPanel.tsx:12-50`)
   - 3 quick action cards for on-chain
   - Grid layout (2 columns)

5. **Message Submit** (`src/components/Chat.tsx:890-932`)
   - `processUserMessage()` called
   - `targetChatId` computed once via `ensureActiveChatId()`
   - User message appended via `appendMessageToChat(targetChatId, userMessage)`
   - Title auto-updates on first user message (inside `appendMessageToChat`)

6. **Draft Creation** (`src/components/Chat.tsx:525-632`)
   - `handleCreatePerpDraftFromSpec()` creates draft strategy
   - `activeDraftChatIdRef.current = targetChatId` stored
   - Draft message rendered in `MessageBubble.tsx`

7. **Collapsed Card Display** (`src/components/MessageBubble.tsx:343-432`)
   - Row 1: Side + Market + Notional + Leverage + Risk%
   - Row 2: Venue • Chain + Slippage
   - Chips: Monitoring/SL/TP/Risk badge (if executed) or "Draft ready to confirm"
   - CTA: "Confirm & Execute" button (only for drafts)

8. **Confirm Flow** (`src/components/Chat.tsx:2301-2398`)
   - `handleConfirmTrade()` uses `activeDraftChatIdRef.current || activeChatId`
   - Status transitions: `draft → queued → executing → executed`
   - Message updated via `updateMessageInChat()` to show executed status
   - Refs cleared: `activeDraftChatIdRef.current = null`

9. **Portfolio Update** (`src/components/RightPanel.tsx:137-150`)
   - Uses `derivePerpPositionsFromStrategies()` as single source of truth
   - PnL computed from live prices (if available)

### Event Markets Flow

1. **Venue Switch** (`src/components/CopilotLayout.tsx:194-199`)
   - User switches to `venue === 'event_demo'`
   - Ticker switches to event markets feed

2. **Event Ticker** (`agent/src/services/ticker.ts:175-233`)
   - Priority: Polymarket public feed → Kalshi (if configured) → Snapshot → Static
   - Sections: Kalshi + Polymarket (grouped)
   - Metadata: `isLive`, `source`, `lastUpdatedMs`

3. **Empty State** (`src/components/Chat.tsx:2477-2501`)
   - Same header/subtext
   - Event-specific suggestion chips (3 + new 4th card)

4. **Quick Start Panel** (`src/components/QuickStartPanel.tsx:13-30`)
   - 4 quick action cards (includes "Explore top markets")
   - Grid layout (2 columns)

5. **Message Submit** (same as on-chain)

6. **Draft Creation** (`src/components/Chat.tsx:657-664`)
   - `handleCreatePerpDraft()` handles event strategies
   - Same `targetChatId` tracking

7. **Collapsed Card Display** (`src/components/MessageBubble.tsx:388-418`)
   - Row 1: YES/NO + Event Label + Stake + Risk%
   - Row 2: "Polymarket • Polygon (simulated)" + Max payout
   - Chips: Same pattern (no SL/TP for events)
   - CTA: "Confirm & Execute" button (parity with perps)

8. **Confirm Flow** (same as on-chain)

9. **Portfolio Update** (`src/components/RightPanel.tsx`)
   - Event positions shown separately
   - Uses `strategy.eventLabel`, `stakeUsd`, `maxPayoutUsd`

---

## 2. Implemented Features Checklist

### Pricing & Ticker

- ✅ **CoinGecko Live Feed** (`src/lib/demoPriceFeed.ts`)
  - Public API, no keys required
  - 12s cache TTL
  - Backoff: 15s → 30s → 60s
  - `isLive` flag correctly set

- ✅ **Ticker Strip** (`src/components/TickerStrip.tsx`)
  - On-chain: CoinGecko → Agent → Static
  - Event: Polymarket → Kalshi → Snapshot → Static
  - Status labels: "Live", "Stale", "Static (demo)", "Connecting..."
  - Stale-while-revalidate pattern
  - Unmount guards (`isMountedRef`)

- ⚠️ **Entry Price Anchoring** (`src/lib/liveSpot.ts`)
  - Uses `getDemoSpotPrices()` (CoinGecko)
  - Falls back to agent if enabled
  - TP/SL computed from live entry (±4% TP, ∓2% SL)
  - **Gap:** No shared cache between ticker and entry anchoring (separate 12s caches)

- ✅ **Console Noise Filter** (`src/lib/consoleNoiseFilter.ts`)
  - Suppresses browser extension errors
  - Installed early in `main.tsx:12`

### Strategy Cards

- ✅ **Collapsed Perp Card** (`src/components/MessageBubble.tsx:343-432`)
  - 2 compact rows + chips + CTA
  - Live entry anchoring with "Live" micro-label

- ✅ **Collapsed Event Card** (`src/components/MessageBubble.tsx:388-418`)
  - Parity with perp (2 rows + chips + CTA)
  - Shows "Polymarket • Polygon (simulated)"

- ✅ **Expanded Details** (`src/components/ExecutionDetailsDisclosure.tsx`)
  - Sections: Sizing, Risk controls, Routing, Assumptions
  - Event routing shows Polymarket/Polygon
  - Perp routing shows simulated multi-venue

- ✅ **Confirm Button Consistency**
  - Same handler for perp + event
  - "Confirm & Execute" label consistent (4 occurrences)

### Session Management

- ✅ **First Message Persistence** (`src/context/BlossomContext.tsx:688-749`)
  - `appendMessageToChat()` uses explicit `chatId` (not `activeChatId`)
  - Defensive session creation inside `setChatSessions` callback
  - Title auto-updates on first user message

- ✅ **Draft Tracking** (`src/components/Chat.tsx:130, 632, 2303`)
  - `activeDraftChatIdRef` stores `targetChatId` during draft creation
  - `activeDraftMessageIdRef` stores message ID
  - Cleared after confirmation

- ✅ **Confirm Flow** (`src/components/Chat.tsx:2301-2398`)
  - Uses stored `targetChatId` from ref
  - Updates message via `updateMessageInChat()`
  - No duplicate session creation

### Event Markets

- ✅ **Polymarket Public Feed** (`agent/src/services/predictionData.ts:196-277`)
  - Attempts `https://clob.polymarket.com/markets`
  - 30s cache TTL
  - Backoff: 15s → 30s → 60s
  - One-time DEV warning

- ✅ **Event Ticker Priority** (`agent/src/services/ticker.ts:177-179`)
  - Polymarket first, then Kalshi
  - Correct `isLive`/`source` metadata

- ✅ **4th Quick Card** (`src/components/QuickStartPanel.tsx:30`)
  - "Explore top markets" added
  - Grid layout accommodates 4 cards (2x2)

- ⚠️ **Venue/Chain Labels** (`src/components/ExecutionDetailsDisclosure.tsx:200-214`)
  - Events show "Polymarket • Polygon (simulated)"
  - **Gap:** Hardcoded, doesn't reflect actual source (polymarket vs kalshi)

### Backend Integration

- ✅ **Agent Ticker Endpoint** (`agent/src/server/http.ts:378-440`)
  - Routes by `venue` query param
  - Returns `isLive`, `source`, `lastUpdatedMs`
  - Graceful fallback on error

- ✅ **Config & API Client** (`src/lib/config.ts`, `src/lib/apiClient.ts`)
  - `USE_AGENT_BACKEND` flag
  - `AGENT_API_BASE_URL` with fallback
  - URL construction prevents double slashes

---

## 3. Top 10 Polish Issues (Ranked by Investor Impact)

### 🔴 Critical (Blocks Demo Credibility)

**1. Pricing Source Divergence**
- **Issue:** Ticker and entry anchoring use separate caches (both 12s TTL, but not shared)
- **Impact:** Ticker shows $60k BTC, plan card Entry shows $59.8k (different fetch times)
- **Location:** `src/lib/demoPriceFeed.ts:30` (ticker cache) vs `src/lib/liveSpot.ts:30` (entry cache)
- **Fix:** Share single `priceCache` between `getDemoSpotPrices()` and `getCachedLiveTicker()`

**2. Event Venue Label Doesn't Reflect Source**
- **Issue:** Always shows "Polymarket • Polygon" even when source is Kalshi or static
- **Impact:** Misleading venue attribution
- **Location:** `src/components/ExecutionDetailsDisclosure.tsx:200-214`, `src/components/MessageBubble.tsx:412`
- **Fix:** Pass `source` from ticker payload → strategy → display components

**3. Missing 4th Quick Card Implementation**
- **Issue:** Audit shows 4th card was requested, but `getQuickActionsForVenue()` only returns 3 items
- **Impact:** "Explore top markets" card not visible in UI
- **Location:** `src/components/QuickStartPanel.tsx:13-30` (array has 3 items, needs 4th)
- **Fix:** Add 4th item: `{ title: 'Explore top markets', description: 'View the highest-volume prediction markets right now.', prompt: 'Show me the top 5 prediction markets by volume' }`

### 🟡 High (Affects UX Coherence)

**4. Stale Price Display During Backoff**
- **Issue:** When CoinGecko fails, backoff prevents fetch, but UI may show stale "Live" label
- **Impact:** Misleading freshness indicator
- **Location:** `src/components/TickerStrip.tsx:382-434`
- **Fix:** Check `lastUpdatedMs` age against backoff window, show "Stale" if > backoff delay

**5. Event Markets Ticker Shows "Connecting..." Indefinitely**
- **Issue:** If Polymarket public API fails silently, ticker may never show data
- **Impact:** Empty ticker strip during demo
- **Location:** `src/components/TickerStrip.tsx:195-223` (event path)
- **Fix:** Add timeout + fallback to snapshot after 3 failures

**6. Inconsistent "Live" Micro-Label Display**
- **Issue:** "Live" label appears in expanded details but not consistently in collapsed card
- **Impact:** Unclear when prices are live vs static
- **Location:** `src/components/MessageBubble.tsx:420-456` (expanded) vs `343-432` (collapsed)
- **Fix:** Add "Live" micro-label to collapsed card Row 1 (Entry price)

**7. Console Logs Not Gated Behind DEV**
- **Issue:** 121 `console.log/warn/error` calls found, not all gated
- **Impact:** Console noise in production
- **Location:** Multiple files (see grep results)
- **Fix:** Wrap non-critical logs in `if (import.meta.env.DEV)`

### 🟢 Medium (Minor Polish)

**8. Event Card Max Payout Truncation**
- **Issue:** Collapsed card Row 2 shows "Max payout: $X" but may truncate on narrow screens
- **Impact:** Information loss
- **Location:** `src/components/MessageBubble.tsx:415`
- **Fix:** Add `truncate` class or move to tooltip

**9. Polymarket Public API Endpoint May Not Exist**
- **Issue:** `https://clob.polymarket.com/markets` may not be a valid public endpoint
- **Impact:** Always falls back to static (defeats purpose)
- **Location:** `agent/src/services/predictionData.ts:201`
- **Fix:** Verify endpoint or use known public API (e.g., The Graph subgraph)

**10. Missing "Simulated" Label on Event Max Payout**
- **Issue:** Max payout shown without "(simulated)" qualifier
- **Impact:** Inconsistent labeling
- **Location:** `src/components/MessageBubble.tsx:415`
- **Fix:** Add `(simulated)` suffix consistent with venue label

---

## 4. Minimal Patch Plan

### Fix 1: Shared Price Cache
**Files:**
- `src/lib/demoPriceFeed.ts (export cache)`
- `src/lib/liveSpot.ts (import and use shared cache)`

**Changes:**
- Export `priceCache` from `demoPriceFeed.ts`
- `getCachedLiveTicker()` reads from same cache
- Single source of truth for all price displays

**Risk:** Low (cache structure unchanged, just shared)

---

### Fix 2: Event Source Propagation
**Files:**
- `agent/src/services/ticker.ts:224-233` (return source in payload)
- `src/components/TickerStrip.tsx:195-223` (store source in component state)
- `src/components/ExecutionDetailsDisclosure.tsx:200-214` (read source from strategy or context)
- `src/components/MessageBubble.tsx:412` (same)

**Changes:**
- Add `source?: 'polymarket' | 'kalshi' | 'static'` to Strategy interface (optional)
- Pass source from ticker → strategy creation → display
- Conditional label: "Polymarket" if source=polymarket, "Kalshi" if source=kalshi, "Event Markets" if static

**Risk:** Medium (requires Strategy interface change, but optional field is safe)

---

### Fix 3: Add 4th Quick Card
**Files:**
- `src/components/QuickStartPanel.tsx:13-30`

**Changes:**
- Add 4th object to array:
  ```typescript
  {
    title: 'Explore top markets',
    description: 'View the highest-volume prediction markets right now.',
    prompt: 'Show me the top 5 prediction markets by volume',
  }
  ```

**Risk:** Low (UI-only, grid already supports 4 items)

---

### Fix 4: Stale Detection During Backoff
**Files:**
- `src/components/TickerStrip.tsx:382-434`

**Changes:**
- Check if `lastUpdatedMs` is older than backoff delay
- If stale + in backoff, show "Stale" not "Live"

**Risk:** Low (display logic only)

---

### Fix 5: Event Ticker Timeout
**Files:**
- `src/components/TickerStrip.tsx:195-223`

**Changes:**
- Track failure count for event markets separately
- After 3 failures, fallback to snapshot (not just static)

**Risk:** Low (adds safety net)

---

### Fix 6: "Live" Label in Collapsed Card
**Files:**
- `src/components/MessageBubble.tsx:343-365` (perp Row 1)
- `src/components/MessageBubble.tsx:388-407` (event Row 1)

**Changes:**
- Add "Live" micro-label next to Entry price when `perpDisplay.hasLive === true`
- Same pattern as expanded details

**Risk:** Low (UI-only)

---

### Fix 7: DEV-Only Console Logs
**Files:**
- Multiple (see grep results)

**Changes:**
- Wrap non-critical logs: `if (import.meta.env.DEV) { console.log(...) }`
- Keep errors/warnings for production (but gate noisy ones)

**Risk:** Low (logging only)

---

### Fix 8: Max Payout Truncation
**Files:**
- `src/components/MessageBubble.tsx:415`

**Changes:**
- Add `truncate` class or move to tooltip
- Or use `formatUsdOrDash()` for consistent formatting

**Risk:** Low (UI-only)

---

### Fix 9: Polymarket Endpoint Verification
**Files:**
- `agent/src/services/predictionData.ts:196-277`

**Changes:**
- Test `https://clob.polymarket.com/markets` endpoint
- If invalid, switch to known public API (The Graph subgraph or documented REST endpoint)
- Update error handling

**Risk:** Medium (requires endpoint research, but fallback exists)

---

### Fix 10: "Simulated" on Max Payout
**Files:**
- `src/components/MessageBubble.tsx:415`

**Changes:**
- Add `(simulated)` suffix: `Max payout: {formatUsdOrDash(...)} (simulated)`

**Risk:** Low (UI-only)

---

## 5. Risk Notes

### High Risk (Don't Touch Without Careful Testing)

1. **Session Management** (`src/context/BlossomContext.tsx:688-749`)
   - `appendMessageToChat()` has defensive session creation
   - Changing this could break first message persistence
   - **Don't modify** unless fixing a confirmed bug

2. **Confirm Flow** (`src/components/Chat.tsx:2301-2398`)
   - Uses refs to track draft chat/message
   - Changing this could break multi-position support
   - **Don't modify** unless fixing a confirmed bug

3. **Strategy State Transitions** (`src/context/BlossomContext.tsx:455-500`)
   - `addDraftStrategy()`, `updateStrategyStatus()` are core
   - Changing these could break execution pipeline
   - **Don't modify** unless fixing a confirmed bug

### Medium Risk (Test Thoroughly)

4. **Price Cache Sharing** (Fix 1)
   - Sharing cache between ticker and entry anchoring
   - Risk: Cache invalidation timing issues
   - **Mitigation:** Keep TTLs aligned (both 12s)

5. **Strategy Interface Changes** (Fix 2)
   - Adding optional `source` field
   - Risk: Type mismatches if not optional
   - **Mitigation:** Make field optional, provide defaults

### Low Risk (Safe to Modify)

6. **UI Labels** (Fixes 6, 8, 10)
   - Presentation-only changes
   - Risk: Visual inconsistency (minor)
   - **Mitigation:** Test in both venues

7. **Console Logging** (Fix 7)
   - DEV-only gating
   - Risk: Missing logs in production (acceptable)
   - **Mitigation:** Keep critical errors ungated

---

## 6. Single Truth Pricing Consistency

### Current State

**Canonical Function:** `getDemoSpotPrices()` in `src/lib/demoPriceFeed.ts:131`
- Returns `Record<DemoSymbol, DemoPriceSnapshot>`
- Used by: TickerStrip (direct), Entry anchoring (via `getCachedLiveTicker()`)

**Divergences:**

1. **Separate Caches**
   - `demoPriceFeed.ts:29` has `priceCache` (12s TTL)
   - `liveSpot.ts:30` has `tickerCache` (12s TTL)
   - **Impact:** Ticker and entry may show different prices if fetched at different times

2. **Fallback Chain Differences**
   - Ticker: CoinGecko → Agent → Static
   - Entry: CoinGecko → Agent → Parser values (not static)
   - **Impact:** Entry may show parser value while ticker shows static

3. **PnL Simulation**
   - Uses `derivePerpPositionsFromStrategies()` which reads `strategy.entry`
   - Entry anchoring updates display but not `strategy.entry` field
   - **Impact:** PnL computed from parser entry, not live entry

**Recommendation:**
- Share single cache (Fix 1)
- Ensure entry anchoring updates `strategy.entry` if live price available (or compute PnL from display value)

---

## 7. Happy Path Validation

### On-Chain Happy Path

✅ **Step 1:** App loads → Ticker shows "Live • as of ..." (CoinGecko prices)  
✅ **Step 2:** User clicks quick action → Prompt inserted  
✅ **Step 3:** User sends message → Draft created, collapsed card shows  
✅ **Step 4:** Collapsed card shows live Entry (if available) + "Confirm & Execute"  
✅ **Step 5:** User confirms → Status transitions, message updates  
✅ **Step 6:** Portfolio updates → Right panel shows position  

**Ambiguity Points:**
- ⚠️ Entry price may differ from ticker (separate caches)
- ⚠️ "Live" label only in expanded details, not collapsed

### Event Markets Happy Path

✅ **Step 1:** Switch to Event Markets → Ticker shows Polymarket/Kalshi sections  
✅ **Step 2:** User sees 4 quick cards (including "Explore top markets")  
✅ **Step 3:** User sends message → Draft created, collapsed card shows  
✅ **Step 4:** Collapsed card shows "Polymarket • Polygon (simulated)" + "Confirm & Execute"  
✅ **Step 5:** User confirms → Status transitions, message updates  
✅ **Step 6:** Portfolio updates → Event position shown  

**Ambiguity Points:**
- ⚠️ Venue label always "Polymarket" even if source is Kalshi
- ⚠️ 4th quick card ("Explore top markets") not implemented (only 3 items in array)

---

## Summary

**Strengths:**
- Solid foundation: session management, confirm flow, live pricing
- Good error handling: backoff, stale-while-revalidate, unmount guards
- Consistent UI patterns: collapsed cards, confirm buttons

**Gaps:**
- Pricing source divergence (separate caches)
- Event venue label doesn't reflect source
- Missing 4th quick card implementation
- Minor UI inconsistencies (Live labels, simulated suffixes)

**Priority:**
1. Fix pricing cache sharing (critical)
2. Add 4th quick card (trivial, high visibility)
3. Propagate event source to labels (medium effort, high impact)
4. Polish UI labels (low effort, medium impact)

**Estimated Effort:** 2-3 hours for all fixes (excluding endpoint research for Fix 9)

