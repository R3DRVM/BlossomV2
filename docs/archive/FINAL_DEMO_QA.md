# Final Investor Demo QA Checklist

## Pricing / Perps

- [ ] Execute "short ETH …" and confirm Entry/TP/SL match between main card and right panel
- [ ] Refresh page; same strategy still shows consistent Entry/TP/SL
- [ ] Toggle open/close disclosure; values don't change unexpectedly
- [ ] PerpPositionEditor shows live-anchored TP/SL placeholders when available

## Event Markets

- [ ] In Event Markets venue, "Show me the top 5 prediction markets by volume" shows a list (not Generic Event)
- [ ] Markets list displays: title, YES/NO prices, volume, source (Polymarket/Kalshi/Demo)
- [ ] Clicking "Bet YES" or "Bet NO" on a market inserts the correct prompt
- [ ] Clicking a market action creates a draft for that specific market
- [ ] Collapsed event card has Confirm & Execute and shows correct venue label
- [ ] Venue label changes based on source (Polymarket vs demo fallback)
- [ ] Event strategy created from market list has correct eventMarketSource (when implemented)

## Stability

- [ ] No repeating console errors; no growing spam
- [ ] Network calls are rate-limited/backed off on failure
- [ ] Markets list fetch fails gracefully (shows error message, doesn't crash)
- [ ] Live price fetch failures don't cause blank screens

## Implementation Notes

### A) TP/SL Disparity Fix
- Created `src/lib/perpDisplay.ts` with `getCanonicalPerpDisplay()` helper
- Updated `PerpPositionEditor` to use canonical helper for placeholders
- `MessageBubble` and `ExecutionDetailsDisclosure` already use live-anchored values
- All components now reference the same canonical cache from `demoPriceFeed.ts`

### B) Market List Feature
- Added `list_top_event_markets` intent to parser
- Created `src/lib/eventMarkets.ts` with `getTopEventMarkets()` (Polymarket public API)
- Added markets list renderer in `MessageBubble.tsx`
- Clicking "Bet YES/NO" inserts prompt with market title
- Falls back to static markets if fetch fails

### C) Event Venue Source-Awareness
- `eventMarketSource` field added to Strategy interface
- `formatEventVenueDisplay()` helper in `formatPlanCard.ts`
- Display components use source-aware labels
- Currently defaults to 'static' when creating from market list (can be enhanced to match market source)


