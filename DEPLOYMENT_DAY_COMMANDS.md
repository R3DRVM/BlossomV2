# Deployment Day Commands - Quick Reference

**Goal**: Conservative proof of life with RPC reliability mode

---

## 🔑 Phase 1: Generate Access Codes

```bash
# Set environment variables
export DATABASE_URL='postgresql://user:pass@host/db?sslmode=require'
export VITE_DEV_LEDGER_SECRET='your-secret'

# Generate 50 single-use codes
npx tsx agent/scripts/generate-access-codes.ts \
  --count=50 \
  --singleUse \
  --label="beta_batch_1" \
  --writeDb

# Save codes to password manager
cat ACCESS_CODES_LOCAL.md
# Copy codes, then securely delete local file if needed
```

---

## ✅ Phase 2: Preflight Verification

```bash
# Quick health check with reliability mode
npx tsx agent/scripts/preflight-verify.ts \
  --baseUrl=https://api.blossom.onl \
  --quick \
  --reliabilityMode

# Expected: "PREFLIGHT PASSED (Quick Mode)"
```

---

## 🧪 Phase 3: Torture Suite - Stage A (SAFE)

Run these 3 categories in sequence:

```bash
# 1. Normal category (20 intents)
npx tsx agent/scripts/run-torture-suite.ts \
  --baseUrl=https://api.blossom.onl \
  --category=normal \
  --count=20 \
  --reliabilityMode

# 2. Natural language (15 intents)
npx tsx agent/scripts/run-torture-suite.ts \
  --baseUrl=https://api.blossom.onl \
  --category=natural_language \
  --count=15 \
  --reliabilityMode

# 3. Plan edit (10 intents)
npx tsx agent/scripts/run-torture-suite.ts \
  --baseUrl=https://api.blossom.onl \
  --category=plan_edit \
  --count=10 \
  --reliabilityMode

# Review results:
# - Check adjusted success rate >= 90%
# - If ≥90%, proceed to Stage B
# - If <90%, STOP and identify blockers
```

---

## 🔄 Phase 4: Torture Suite - Stage B (CONDITIONAL)

**Only run if Stage A >= 90% adjusted success rate**

```bash
# 1. Cross-chain (10 intents)
npx tsx agent/scripts/run-torture-suite.ts \
  --baseUrl=https://api.blossom.onl \
  --category=cross_chain \
  --count=10 \
  --reliabilityMode

# 2. Extreme (10 intents)
npx tsx agent/scripts/run-torture-suite.ts \
  --baseUrl=https://api.blossom.onl \
  --category=extreme \
  --count=10 \
  --reliabilityMode

# 3. Rapid fire (8 intents) - ONLY if explicitly allowed
npx tsx agent/scripts/run-torture-suite.ts \
  --baseUrl=https://api.blossom.onl \
  --category=rapid_fire \
  --count=8 \
  --reliabilityMode \
  --burst
```

---

## 📊 Phase 5: Visual Verification

Open these URLs in browser:

```bash
# 1. Landing page
open https://blossom.onl
# ✓ Links work: Capabilities, Statistics, Whitepaper

# 2. Access gate
open https://app.blossom.onl
# ✓ Access gate appears
# ✓ Enter code from ACCESS_CODES_LOCAL.md
# ✓ Grants access to app

# 3. Public stats (NO CODE REQUIRED)
open https://stats.blossom.onl
# ✓ Unique Wallets displays
# ✓ Success Rate (adjusted) displays
# ✓ Recent intents visible
# ✓ Explorer links clickable

# 4. Whitepaper
open https://whitepaper.blossom.onl
# ✓ Whitepaper loads

# 5. Verify stats update in real-time
# - Note runId from torture suite output
# - Check stats page shows intents with that runId
# - Should appear within 60 seconds
```

---

## 🔍 Debugging Commands

### Check health
```bash
curl https://api.blossom.onl/health | jq
# Expected: {"ok": true, ...}
```

### Check stats API
```bash
curl -H "X-Ledger-Secret: $VITE_DEV_LEDGER_SECRET" \
  https://api.blossom.onl/api/ledger/stats/summary | jq
# Expected: uniqueWallets, successRateRaw, successRateAdjusted
```

### Check recent intents
```bash
curl -H "X-Ledger-Secret: $VITE_DEV_LEDGER_SECRET" \
  https://api.blossom.onl/api/ledger/intents/recent?limit=10 | jq
# Expected: Array of recent intents with runId
```

### Validate access code (don't print code!)
```bash
# Copy code from ACCESS_CODES_LOCAL.md first
CODE="XXXX-XXXX-XXXX"
curl -X POST https://api.blossom.onl/api/access/validate \
  -H "Content-Type: application/json" \
  -H "X-Ledger-Secret: $VITE_DEV_LEDGER_SECRET" \
  -d "{\"code\": \"$CODE\"}" | jq
# Expected: {"ok": true, "valid": true}
```

---

## 📈 Success Metrics

### Preflight
- ✅ Health OK
- ✅ Stats API OK
- ✅ No errors

### Torture Suite Stage A
- **Target**: ≥90% adjusted success rate
- **Accept**: ≥75% (conditional pass, identify blockers)
- **Fail**: <75% (stop deployment)

### Torture Suite Stage B (if run)
- **Target**: ≥85% adjusted success rate
- **Expected**: Some RPC rate limiting (tagged as infra failure)

### Visual Checks
- ✅ All 4 subdomains load
- ✅ Access gate works
- ✅ Stats update in real-time
- ✅ Unique Wallets displays
- ✅ Success Rate Adjusted displays

---

## 🚨 Failure Scenarios

### Preflight fails
```bash
# Check Vercel logs
vercel logs api

# Check DATABASE_URL
echo $DATABASE_URL | sed 's/:.*@/:***@/g'

# Verify Neon database
DATABASE_URL='...' npx tsx agent/scripts/setup-neon-db.ts --check-only
```

### Torture suite low success rate
```bash
# Review error codes and failure stages
# Look for patterns:
# - RPC_RATE_LIMITED (expected, excluded from adjusted rate)
# - RPC_UNAVAILABLE (infra issue)
# - Other error codes (investigate)

# Check RPC provider health
# - Alchemy dashboard
# - Infura dashboard
# - Public RPC status
```

### Stats not updating
```bash
# Verify backend writes to same database
curl https://api.blossom.onl/health | jq '.database'

# Check LEDGER_SECRET matches
echo $VITE_DEV_LEDGER_SECRET

# Verify recent intents endpoint
curl -H "X-Ledger-Secret: $VITE_DEV_LEDGER_SECRET" \
  https://api.blossom.onl/api/ledger/intents/recent?limit=5 | jq
```

---

## 📝 Notes

### Environment Variables (Production)
```bash
# Frontend (Vercel)
VITE_AGENT_API_URL=https://api.blossom.onl
VITE_ACCESS_GATE_ENABLED=true
VITE_DEV_LEDGER_SECRET=<secret>

# Backend (Vercel serverless)
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require
BLOSSOM_MODEL_PROVIDER=openai
BLOSSOM_OPENAI_API_KEY=sk-...
BLOSSOM_OPENAI_MODEL=gpt-4o-mini

# Optional: RPC providers
ETH_TESTNET_RPC_URL=<primary>
ETH_RPC_FALLBACK_URLS=<fallback1>,<fallback2>
ALCHEMY_RPC_URL=<alchemy>
INFURA_RPC_URL=<infura>
```

### Reliability Mode Features
- ✅ Failover transport (primary → fallbacks → public RPCs)
- ✅ Circuit breakers (2 failures, 30s backoff)
- ✅ Rate limit detection (429 → 60s cooldown)
- ✅ Pacing (250-500ms between intents, 1-2s between phases)
- ✅ Filters out rapid_fire unless --burst

### Timing Expectations
- Preflight: 1-2 minutes (5 intents with pacing)
- Torture Stage A: 8-12 minutes (45 intents with pacing)
- Torture Stage B: 5-8 minutes (28 intents with pacing)
- Stats update latency: <60 seconds

---

## ✅ Final Checklist

- [ ] Access codes generated and stored securely
- [ ] Preflight passed
- [ ] Torture Stage A passed (≥90% adjusted success)
- [ ] Torture Stage B passed (if run)
- [ ] All visual checks passed
- [ ] Stats dashboard shows:
  - [ ] Unique Wallets
  - [ ] Success Rate Adjusted
  - [ ] Recent intents from torture suite
- [ ] No secrets logged in Vercel logs
- [ ] Access code validation works

**If all checked: DEPLOYMENT SUCCESSFUL** 🎉
