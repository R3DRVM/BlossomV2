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
   VITE_BACKEND_URL=https://blossom-agent.fly.dev
   VITE_STATS_URL=https://blossom-telemetry.fly.dev
   ```
6. Deploy branch: `main`

**Verify:**

```bash
# Frontend should be live at production URL
curl https://blossom.onl/
```

### Phase 2: Fly.io Backend (Agent) Deployment

The backend agent is containerized and deployed to Fly.io.

**Configure Fly.io:**

```bash
# 1. Install Fly CLI
curl -L https://fly.io/install.sh | sh

# 2. Log in
fly auth login

# 3. Create app (first time only)
cd agent
fly apps create blossom-agent

# 4. Set secrets (from your .env.local)
fly secrets set \
  ETH_TESTNET_RPC_URL="<YOUR_RPC_URL>" \
  RELAYER_PRIVATE_KEY="<YOUR_RELAYER_KEY>" \
  BLOSSOM_MODEL_PROVIDER="gemini" \
  BLOSSOM_GEMINI_API_KEY="<YOUR_KEY>" \
  ADMIN_KEY="<YOUR_ADMIN_KEY>"

# 5. Deploy
fly deploy

# 6. Verify
fly open
curl https://blossom-agent.fly.dev/api/health
```

**Monitor:**

```bash
# View logs
fly logs -a blossom-agent

# Check status
fly status -a blossom-agent

# Metrics
fly metrics
```

### Phase 3: Fly.io Telemetry Dashboard Deployment

The stats dashboard displays execution telemetry.

```bash
# 1. Deploy dashboard
cd devnet-dashboard
fly deploy -a blossom-telemetry

# 2. Verify
curl https://blossom-telemetry.fly.dev/

# 3. Check it's receiving stats
# Should see execution events appearing in real-time
```

## Post-Deployment Verification

### 1. Health Checks (Day 1)

```bash
# Frontend
curl https://blossom.onl/ -I
# Should return 200

# Backend
curl https://blossom-agent.fly.dev/api/health -H "Accept: application/json"
# Should return { ok: true }

# Telemetry Dashboard
curl https://blossom-telemetry.fly.dev/ -I
# Should return 200
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
  curl -X POST https://blossom-agent.fly.dev/api/mint \
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
3. Add DSN to Fly secrets:
   ```bash
   fly secrets set SENTRY_DSN="<YOUR_SENTRY_DSN>"
   fly deploy
   ```
4. Verify errors are being captured

**Uptime Monitoring:**

Set up a simple uptime monitor:

```bash
# Create a cron job to check health
*/5 * * * * curl -f https://blossom-agent.fly.dev/api/health || \
  (echo "Blossom agent down!" | mail -s "Alert" admin@example.com)
```

### 4. Database Verification (Day 2)

**Check telemetry database:**

```bash
# SSH into Fly app and check database
fly ssh console -a blossom-agent

# Inside the container:
sqlite3 agent/telemetry/telemetry.db
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
ab -n 1000 -c 100 https://blossom-agent.fly.dev/api/health
```

**Target:**
- 50+ concurrent users
- <500ms p95 response time
- <1% error rate

## Rollback Plan

If issues occur:

### Quick Rollback

```bash
# Revert to previous Fly deployment
fly releases
fly releases rollback <VERSION>

# Or manually redeploy from stable commit
git checkout <STABLE_COMMIT>
cd agent
fly deploy
```

### Vercel Rollback

```bash
# Automatic - go to Vercel dashboard
# Select "Deployments" tab
# Click "..." menu on previous deployment
# Select "Restore"
```

## Troubleshooting

### Issue: "RPC rate limited"

**Solution:** Update RPC URL in Fly secrets
```bash
fly secrets set ETH_TESTNET_RPC_URL="<NEW_RPC_URL>"
fly deploy
```

### Issue: "Session enforcement failed"

**Solution:** Check agent logs
```bash
fly logs -a blossom-agent | grep -i session
```

### Issue: "Mint endpoint returning 500"

**Solution:** Check database state
```bash
fly ssh console -a blossom-agent
sqlite3 agent/telemetry/telemetry.db
> PRAGMA integrity_check;
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
   fly logs | grep -i "private_key\|secret\|password" | wc -l
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
