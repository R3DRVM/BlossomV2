# Deployment Summary

## Commit
- **Hash**: `bd577b97b61c298bba580983672e1f000b4f2e77`
- **Message**: `fix(defi): correct allocation amounts + stabilize execution drafts; add polymarket live markets`

## Changes Deployed

### DeFi Allocation Fixes
- Added `amountUsd:"..."` and `amountPct:"..."` token parsing in `createDefiPlanFromCommand()`
- Updated DeFi protocol list buttons to send tokenized messages
- Added percentage-to-USD conversion in Chat handler before plan creation
- Fixed DeFi handler to append assistant message and return early (prevents fallthrough)

### DeFi Execution Draft Stability
- Added defensive guard to prevent DeFi commands from entering perp market clarification flow
- Ensured DeFi collapsed preview uses same amber pending tones as perps/events
- Updated CTA label to "Confirm & Execute" for consistency

### Polymarket Live Markets
- Added `src/lib/polymarket.ts` with Gamma API integration
- Wired into `src/lib/eventMarkets.ts` behind `VITE_EVENT_MARKETS_SOURCE=polymarket` env var
- Maintains existing fallback chain (Polymarket → Public API → Static)

### Files Changed
- 16 files changed, 2045 insertions(+), 287 deletions(-)
- New files: `polymarket.ts`, `defiProtocols.ts`, `collapsedPreview.ts`, `EventMarketsCoachmarks.tsx`, `nginx.conf`

## Deployed URLs

### Fly.io
- **URL**: https://blossomv2.fly.dev/
- **Status**: ✅ Deployed successfully
- **Health Check**: HTTP 200 (homepage loads)
- **Note**: DNS AAAA warning is normal and will resolve

### Vercel
- **Production URL**: https://blossom-v2-fe5a5lyx1-redrums-projects-8b7ca479.vercel.app
- **Status**: ✅ Ready (deployed ~39s ago)
- **Note**: May require authentication or custom domain configuration

## Verification

### Build Status
- ✅ TypeScript compilation: Passed
- ✅ Vite build: Passed (453.59 kB main bundle, 124.21 kB gzipped)
- ⚠️ CSS warning: `@import` must precede other statements (non-blocking)

### Manual Smoke Tests (Local)
- ✅ "Allocate $500" creates DeFi plan with Deposit = $500
- ✅ "Allocate 10%" creates DeFi plan with Deposit = $1,000 (on $10k demo)
- ✅ DeFi draft card renders with collapsed preview in amber + routing line
- ✅ Event markets render and "top markets" works (Polymarket path if enabled)

## Warnings

1. **CSS Import Order**: Vite warning about `@import` statement order (non-blocking, cosmetic)
2. **Fly.io DNS**: AAAA record warning (normal, will propagate)
3. **Vercel 401**: Production URL may require authentication or custom domain setup

## Next Steps (TODO)

1. **DeFi Protocol Filtering**
   - Filter out non-actionable entries (e.g., bridges like WBTC)
   - Or label them more clearly in the UI

2. **DeFi APY Sourcing**
   - Add APY fetching for DeFi protocols (optional enhancement)
   - Keep TVL as primary metric
   - Consider DefiLlama APY endpoints

3. **Event Markets Source Badges**
   - Improve Polymarket/Kalshi "source badges" display
   - Remove any remaining "synthetic/demo" language
   - Ensure consistent labeling across all event market surfaces

4. **Event Markets Loading State**
   - Add consistent loading message for event markets (similar to DeFi protocols)
   - Show "Fetching top prediction markets..." while loading
   - Replace with final message when complete


