# Demo Deploy Proof Bundle

**Generated:** 2026-01-22 23:25 PST

## Branch Structure

| Branch | Commit Hash | Purpose |
|--------|-------------|---------|
| `demo` | `92ae3c75636f1f7bb8d497f67d393005bbc2f517` | Public simulated demo (frozen) + devnet stats link |
| `mvp` | `88291acfec64f3bae83360d2a9c84595d8366b35` | Ongoing testnet/MVP development |

## Demo Branch Details

- **Base commit:** `bd577b97b61c298bba580983672e1f000b4f2e77` (simulated demo, no wallet connect)
- **Added:** Devnet Statistics link in navigation pointing to `https://blossom-devnet.fly.dev`
- **Does NOT include:** eth_testnet mode, wallet connect, session auth, execution endpoints

## Fly.io Releases

| App | Version | Status | Image |
|-----|---------|--------|-------|
| blossomv2 | v24 | complete | deployment-01KFMVG1K7E4RMH1C98BQAN63J |
| blossom-telemetry | v1 | running (needs attention) | deployment-01KFMQZAVBHM66CX4Q1SQHCR22 |
| blossom-devnet | v1 | running | deployment-01KFMSPGPHCM64AJ2CTVT80VX7 |

## Verification URLs

### 1. Landing Page
- **URL:** https://blossom.ceo
- **Expected:** Landing page loads with cherry blossom background
- **Devnet Link:** Navigation shows "Devnet Statistics" link

### 2. Simulated Demo App
- **URL:** https://blossom.ceo/app
- **Expected:**
  - Shows mock balances (~$50,000 range)
  - "Demo: execution simulated" badge visible
  - NO "Connect Wallet (Sepolia)" button
  - NO "ETH_TESTNET" badge

### 3. Devnet Dashboard
- **URL:** https://blossom-devnet.fly.dev
- **Expected:**
  - Shows "Devnet Statistics" title
  - Shows "Recent Traffic Runs" table
  - Reads from telemetry API

## Technical Verification

### JS Bundle Check (blossom.ceo)
```
Bundle: assets/index-DvLhJMec.js
"Connect Wallet" occurrences: 0
"blossom-devnet" link: PRESENT
```

### config.ts at demo branch
```javascript
/**
 * Feature flags and configuration
 */

export const USE_AGENT_BACKEND =
  import.meta.env.VITE_USE_AGENT_BACKEND === 'true';
```
*No executionMode, no eth_testnet, no wallet connect logic*

## Known Issues

### Telemetry API (blossom-telemetry.fly.dev)
- **Status:** HTTP 502
- **Cause:** App not listening on 0.0.0.0:3001
- **Impact:** Devnet dashboard may not load live run data
- **Fix Required:** Check fly.toml internal_port and app binding

## Commands to Verify

```bash
# Check no wallet connect in bundle
curl -s https://blossom.ceo/assets/index-DvLhJMec.js | grep -c "Connect Wallet"
# Expected: 0

# Check devnet link present
curl -s https://blossom.ceo/assets/index-DvLhJMec.js | grep -o "blossom-devnet"
# Expected: blossom-devnet

# Check devnet dashboard loads
curl -s -I https://blossom-devnet.fly.dev
# Expected: HTTP/2 200
```

## Summary

| Requirement | Status |
|-------------|--------|
| Public demo shows simulated mode (no wallet connect) | ✅ VERIFIED |
| Demo shows mock balances immediately | ✅ VERIFIED |
| Devnet stats link present | ✅ VERIFIED |
| Devnet dashboard accessible | ✅ VERIFIED |
| MVP work preserved in `mvp` branch | ✅ VERIFIED |
| Telemetry API functional | ⚠️ NEEDS FIX |
