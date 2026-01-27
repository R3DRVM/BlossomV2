# Deployment Day Implementation Plan

**Date**: 2026-01-25
**Goal**: Conservative "proof of life" deployment with minimal infra risk

---

## PHASE 0: Sanity Checks

**Files to verify** (read-only checks):
- `agent/execution-ledger/db.ts` - Confirm DATABASE_URL detection
- `agent/src/server/http.ts` - Confirm serverless mode works
- `src/lib/apiClient.ts` - Confirm writes go to VITE_AGENT_API_URL
- `agent/src/server/http.ts` - Confirm stats endpoints are read-only

**Actions**:
- Grep for DATABASE_URL usage in db layer
- Confirm VERCEL flag skips listen()
- Verify stats routes have no mutation methods

**Deliverable**: PASS/FAIL report (no secrets printed)

---

## PHASE 1: Access Codes

**Files to modify**:
1. `agent/scripts/generate-access-codes.ts`
   - Add --count, --singleUse, --label flags
   - Write to DATABASE_URL via API or direct connection
   - Output to ACCESS_CODES_LOCAL.md (gitignored)
   - NEVER print codes to console

2. Verify `.gitignore` contains `ACCESS_CODES_LOCAL.*`

**Actions**:
- Run script with --count=50 --label="beta_batch_1"
- Validate 2 codes via API call (no console print)
- Confirm codes appear in hosted DB

**Deliverable**: "Wrote codes to ACCESS_CODES_LOCAL.md" message only

---

## PHASE 2: RPC Reliability Infrastructure

**Files to create/modify**:

1. `agent/src/chains/ethereum/rpc-failover.ts` (NEW)
   - Collect RPCs from env: ETH_TESTNET_RPC_URL, ETH_RPC_FALLBACK_URLS, ALCHEMY_RPC_URL, INFURA_RPC_URL
   - Deduplicate, prefer Alchemy in top 2 fallbacks
   - Create failover transport with:
     - 429 detection + rotation
     - Exponential backoff + jitter
     - Circuit breaker (60s cooldown for rate-limited)

2. `agent/src/chains/ethereum/client.ts` (MODIFY)
   - Add createReliableClient() function
   - Use failover transport when reliability mode enabled

3. `agent/scripts/preflight-verify.ts` (MODIFY)
   - Add --reliabilityMode flag
   - Add pacing: 250-500ms between intents, 1-2s between confirms
   - Set process.env.ENABLE_RELIABILITY_MODE

4. `agent/scripts/run-torture-suite.ts` (MODIFY)
   - Add --reliabilityMode flag
   - Add --category filter (normal, natural_language, plan_edit, cross_chain, extreme, rapid_fire)
   - Add --count limit
   - Add pacing in reliability mode
   - Disable burst unless --burst explicitly passed

5. `agent/execution-ledger/db.ts` (MODIFY)
   - Add metadata.rpcInfraFailure field support
   - Add error_code standardization: RPC_RATE_LIMITED, RPC_UNAVAILABLE, RPC_ERROR

**Actions**:
- Implement failover transport
- Add reliability mode flag to scripts
- Test locally with reliability mode

**Deliverable**: Scripts support --reliabilityMode with pacing

---

## PHASE 3: Stats Enhancements

**Files to modify**:

1. `agent/src/server/routes/stats.ts` (or wherever stats endpoint lives)
   - Add uniqueWallets query: `COUNT(DISTINCT from_address)` or from wallets table
   - Add successRateRaw calculation
   - Add successRateAdjusted calculation (excludes metadata.rpcInfraFailure=true)
   - Return in /api/stats or /api/ledger/stats/summary

2. `src/pages/DevStatsPage.tsx` (MODIFY - minimal UI change)
   - Add "Unique Wallets" display using existing summary component/styles
   - Add successRateAdjusted display (if not already shown)
   - NO theme/layout/spacing/typography changes

**Actions**:
- Query unique wallets from DB
- Calculate adjusted success rate
- Display in existing UI styles only

**Deliverable**: Stats page shows uniqueWallets + adjusted success rate

---

## PHASE 4: Verification Runs

**Scripts to run** (in order):

1. **Preflight** (conservative):
   ```bash
   npx tsx agent/scripts/preflight-verify.ts \
     --baseUrl=https://api.blossom.onl \
     --quick \
     --reliabilityMode
   ```

2. **Torture Stage A** (safe suite):
   ```bash
   # Normal category
   npx tsx agent/scripts/run-torture-suite.ts \
     --baseUrl=https://api.blossom.onl \
     --category=normal \
     --count=20 \
     --reliabilityMode

   # Natural language
   npx tsx agent/scripts/run-torture-suite.ts \
     --baseUrl=https://api.blossom.onl \
     --category=natural_language \
     --count=15 \
     --reliabilityMode

   # Plan edit
   npx tsx agent/scripts/run-torture-suite.ts \
     --baseUrl=https://api.blossom.onl \
     --category=plan_edit \
     --count=10 \
     --reliabilityMode
   ```

3. **Torture Stage B** (conditional - ONLY if Stage A >= 90% adjusted success):
   ```bash
   # Cross-chain
   npx tsx agent/scripts/run-torture-suite.ts \
     --baseUrl=https://api.blossom.onl \
     --category=cross_chain \
     --count=10 \
     --reliabilityMode

   # Extreme
   npx tsx agent/scripts/run-torture-suite.ts \
     --baseUrl=https://api.blossom.onl \
     --category=extreme \
     --count=10 \
     --reliabilityMode

   # Rapid fire (ONLY if explicitly allowed)
   npx tsx agent/scripts/run-torture-suite.ts \
     --baseUrl=https://api.blossom.onl \
     --category=rapid_fire \
     --count=8 \
     --reliabilityMode \
     --burst
   ```

**Actions**:
- Run each script with --reliabilityMode
- Capture runId for each run
- Verify intents appear on stats.blossom.onl within 60s
- Summarize failures by error_code + failure_stage
- Count infra-limited failures separately

**Deliverable**: Success rates, failure summary, stats verification

---

## PHASE 5: Visual Checks

**Browser checks** (manual):
- [ ] https://blossom.onl - Landing links work (Capabilities, Statistics, Whitepaper)
- [ ] https://stats.blossom.onl - Read-only stats, explorer links clickable
- [ ] https://whitepaper.blossom.onl - Whitepaper loads
- [ ] https://app.blossom.onl - Access gate:
  - [ ] Waitlist submit works
  - [ ] Access code unlock works
- [ ] RunId test data visible in stats within 60s

**Deliverable**: Visual check PASS/FAIL

---

## Files to Touch (Summary)

### NEW FILES:
- `agent/src/chains/ethereum/rpc-failover.ts` - Failover transport implementation
- `DEPLOYMENT_DAY_PLAN.md` - This file

### MODIFIED FILES:
- `agent/scripts/generate-access-codes.ts` - Add flags, safe output
- `agent/scripts/preflight-verify.ts` - Add --reliabilityMode
- `agent/scripts/run-torture-suite.ts` - Add --reliabilityMode, --category, --count
- `agent/src/chains/ethereum/client.ts` - Add createReliableClient()
- `agent/execution-ledger/db.ts` - Add rpcInfraFailure metadata support
- `agent/src/server/routes/stats.ts` - Add uniqueWallets, adjusted success rate
- `src/pages/DevStatsPage.tsx` - Display new stats (minimal UI change)

### VERIFIED (no changes needed):
- `.gitignore` - Already has ACCESS_CODES_LOCAL.*
- `agent/execution-ledger/schema-postgres.sql` - access_codes table exists
- `agent/src/server/http.ts` - Stats routes already read-only

---

## Implementation Order

1. **Phase 0**: Sanity checks (read files, grep, verify)
2. **Phase 1**: Access codes script
3. **Phase 2**: RPC reliability infrastructure
4. **Phase 3**: Stats enhancements
5. **Phase 4**: Run verification scripts
6. **Phase 5**: Manual browser checks

---

## Success Criteria

**PASS** if:
- ✅ Preflight passes with --reliabilityMode
- ✅ Torture Stage A >= 90% adjusted success rate
- ✅ Stats show uniqueWallets + adjusted success rate
- ✅ Access codes generated safely (no console print)
- ✅ All visual checks pass
- ✅ No secrets logged

**CONDITIONAL PASS** if:
- ⚠️ Torture Stage A 75-89% adjusted success (identify blockers)
- ⚠️ Some RPC rate limiting (expected, tagged as infra failure)

**FAIL** if:
- ❌ Preflight fails (systemic issue)
- ❌ Torture Stage A < 75% adjusted success
- ❌ Secrets leaked in logs
- ❌ Stats not updating from CLI runs

---

**Ready to proceed with implementation?**
