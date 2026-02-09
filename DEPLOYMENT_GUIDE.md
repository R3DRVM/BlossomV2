# Blossom MVP Deployment Guide

This guide walks through deploying Blossom to production for the MVP launch.

## Pre-Deployment Checklist

### Local Setup (Day 1)

```bash
# 1. Install dependencies
npm ci
cd agent && npm ci && cd ..

# 2. Set up environment
# Copy .env templates
cp agent/.env.local.example agent/.env.local
# Edit with your values (RPC URL, relayer key, API keys, etc.)
```

### Run All Tests Locally

```bash
# Contract tests
cd contracts
forge test -v

# E2E API tests
npm run test:e2e E2E_RUN=true

# (Optional) UI tests - requires frontend running
npm run test:e2e:ui E2E_UI=true FRONTEND_URL=http://localhost:5173
```

## Deployment Phases

### Phase 1: Vercel Frontend Deployment

The frontend is deployed to Vercel and auto-deploys on `main` branch.

**Configure Vercel:**

1. Connect GitHub repo: https://vercel.com/new
2. Select project root: `/` (monorepo)
3. Set build command: `npm run build`
4. Set output directory: `dist`
5. Add environment variables:
   ```
   VITE_AGENT_BASE_URL=https://blossom.onl
   ```
6. Deploy branch: `mvp`

**Verify:**

```bash
# Frontend should be live at production URL
curl https://blossom.onl/
```

### Phase 2: Vercel API Deployment

The backend API is deployed on Vercel alongside the frontend.

**Configure Vercel (API + Frontend):**

1. Ensure `mvp` is the production branch in Vercel.
2. Set backend secrets in Vercel environment variables (RPC URLs, relayer key, model provider keys, admin key).
3. Deploy (Vercel auto-deploys on push to `mvp`).

**Verify:**

```bash
curl https://blossom.onl/health
```

### Phase 3: Stats/Telemetry (Vercel)

Stats are served from the Vercel API.

```bash
curl https://blossom.onl/api/stats/public
```

## Post-Deployment Verification

### 1. Health Checks (Day 1)

```bash
# Frontend
curl https://blossom.onl/ -I
# Should return 200

# Backend
curl https://blossom.onl/health -H "Accept: application/json"
# Should return { ok: true }
```

### 2. Functional Testing (Day 1)

**Manual test flow:**

1. Open https://blossom.onl/ in browser
2. Connect MetaMask wallet (Sepolia testnet)
3. Mint some bUSDC (click "Mint" button)
4. Try a simple swap
5. Check execution history

**Verify rate limiting:**

```bash
# Rapid fire requests should be rate limited
for i in {1..15}; do
  curl -X POST https://blossom.onl/api/mint \
    -H "Content-Type: application/json" \
    -d '{"userAddress":"0xYOUR_ADDRESS","amount":1}' &
done
wait

# Should see some 429 (Too Many Requests) responses
```

### 3. Monitoring Setup (Day 1)

**Sentry Error Tracking:**

1. Create account at https://sentry.io
2. Create new project for Blossom
3. Add DSN to Vercel environment variables and redeploy.
4. Verify errors are being captured

**Uptime Monitoring:**

Set up a simple uptime monitor:

```bash
# Create a cron job to check health
*/5 * * * * curl -f https://blossom.onl/health || \
  (echo "Blossom agent down!" | mail -s "Alert" admin@example.com)
```

### 4. Database Verification (Day 2)

**Check telemetry database:**

```bash
# Check Postgres via DATABASE_URL (Vercel Postgres)
psql "$DATABASE_URL"
> SELECT COUNT(*) FROM executions;
> SELECT COUNT(*) FROM mint_records;
```

**Should see:**
- Increasing execution count from successful transactions
- Mint records for test users

### 5. Load Testing (Day 2, Optional)

```bash
# Using k6 (install: https://k6.io/)
k6 run tests/load.js \
  --vus 50 \
  --duration 5m \
  --ramp-up 1m

# Or using ab (Apache Bench):
ab -n 1000 -c 100 https://blossom.onl/health
```

**Target:**
- 50+ concurrent users
- <500ms p95 response time
- <1% error rate

## Rollback Plan

If issues occur:

### Vercel Rollback

```bash
# Automatic - go to Vercel dashboard
# Select "Deployments" tab
# Click "..." menu on previous deployment
# Select "Restore"
```

## Troubleshooting

### Issue: "RPC rate limited"

**Solution:** Update RPC URL in Vercel environment variables
```bash
# Vercel Dashboard -> Settings -> Environment Variables
# Update ETH_TESTNET_RPC_URL and redeploy
```

### Issue: "Session enforcement failed"

**Solution:** Check API logs
```bash
# Vercel Dashboard -> Logs
```

### Issue: "Mint endpoint returning 500"

**Solution:** Check database state (Vercel Postgres)
```bash
psql "$DATABASE_URL"
> SELECT 1;
```

### Issue: "CORS error from frontend"

**Solution:** Verify CORS config in `agent/src/server/http.ts`
- Ensure frontend URL is in `ALLOWED_ORIGINS`
- Redeploy agent after updating

## Security Hardening

Before production launch, verify:

1. **Secrets Management**
   ```bash
   # Ensure no secrets in git
   git log --all -p | grep -i "private_key\|api_key" | head -10
   ```

2. **Rate Limits**
   - `/api/mint`: 5 req/min per wallet ✅
   - `/api/execute`: 10 req/min per wallet ✅
   - `/api/session`: 10 req/min per wallet ✅

3. **CORS Allowlist**
   - Production: `https://blossom.onl` only
   - Staging: `https://staging.blossom.onl`
   - Dev: `http://localhost:5173`

4. **Environment Variables**
   ```bash
   # Verify sensitive vars are NOT logged
   # Review Vercel logs for accidental secret leaks
   # Should be 0
   ```

## Ongoing Maintenance

### Daily

- Monitor Sentry error rate (<1% target)
- Check Fly app status
- Review execution telemetry

### Weekly

- Review Fly logs for patterns
- Check database size growth
- Audit new user sign-ups

### Monthly

- Update dependencies
- Review and rotate secrets if needed
- Audit access logs

## Documentation & Support

- **Architecture**: See [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Security**: See [SECURITY.md](./SECURITY.md) & [SECURITY_CHECKLIST.md](./SECURITY_CHECKLIST.md)
- **Runtime Variables**: See `agent/.env.local.example`
- **Database Schema**: See `agent/telemetry/schema.sql`

## Emergency Contacts

- **Critical Issues**: [team-slack or support email]
- **Security Issues**: security@blossom.onl
- **Uptime Alerts**: Set up via Fly.io dashboard

## Deployment Success Criteria

✅ All checks passing = Ready for production

- [ ] Frontend loads without errors
- [ ] Backend health endpoint returns 200
- [ ] Telemetry dashboard receives events
- [ ] Rate limiting works (429 responses)
- [ ] Sentry is capturing errors
- [ ] Database is growing (mint/execution records)
- [ ] No critical Sentry issues
- [ ] <500ms p95 latency
- [ ] <1% error rate

Once all items checked, the MVP is live! 🚀
