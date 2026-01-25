# Blossom MVP - Vercel Deployment Checklist

Quick reference checklist for deploying to production.

## Pre-Flight (Local)

```bash
# 1. Create Neon Postgres database
# → Get connection string from https://console.neon.tech

# 2. Apply database schema
DATABASE_URL='postgresql://user:pass@host/db?sslmode=require' \
  npx tsx agent/scripts/setup-neon-db.ts --apply-schema

# 3. Verify schema (should show ✓ for all 11 tables)
DATABASE_URL='postgresql://...' \
  npx tsx agent/scripts/setup-neon-db.ts --check-only

# 4. Generate access codes (stored in ACCESS_CODES_LOCAL.md)
npx tsx agent/scripts/generate-access-codes.ts --count=50

# 5. Save access codes to password manager (file is gitignored)
cat ACCESS_CODES_LOCAL.md
```

---

## Deploy to Vercel

```bash
# Install Vercel CLI (if needed)
npm i -g vercel

# Deploy
vercel --prod

# Follow prompts:
# - Link to existing project or create new
# - Project name: blossom-mvp
# - Root directory: . (current directory)
```

---

## Vercel Dashboard Configuration

### 1. Environment Variables

Go to: Project Settings → Environment Variables → Production

**Frontend variables** (VITE_* prefix):
```
VITE_AGENT_API_URL=https://api.blossom.onl
VITE_ACCESS_GATE_ENABLED=true
VITE_DEV_LEDGER_SECRET=<generate-random-secret>
```

**Backend variables** (serverless functions):
```
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require
BLOSSOM_MODEL_PROVIDER=openai
BLOSSOM_OPENAI_API_KEY=sk-...
BLOSSOM_OPENAI_MODEL=gpt-4o-mini
```

### 2. Add Domains

Go to: Project Settings → Domains

Add these 5 domains:
- `blossom.onl` (landing page)
- `app.blossom.onl` (gated app)
- `stats.blossom.onl` (public stats)
- `whitepaper.blossom.onl` (whitepaper)
- `api.blossom.onl` (backend API)

**DNS Setup**: Point each domain to Vercel (A/CNAME records)

**Wait**: SSL provisioning takes 10-30 minutes

---

## Post-Deployment Verification

Run these commands to verify everything works:

```bash
# 1. Health check (should return {"ok":true})
curl https://api.blossom.onl/health

# 2. Preflight verification (quick mode)
npx tsx agent/scripts/preflight-verify.ts \
  --baseUrl=https://api.blossom.onl \
  --quick

# 3. Check each subdomain loads
curl -I https://blossom.onl  # 200 OK
curl -I https://app.blossom.onl  # 200 OK
curl -I https://stats.blossom.onl  # 200 OK
curl -I https://whitepaper.blossom.onl  # 200 OK
curl https://api.blossom.onl/api/stats | jq  # Should return stats JSON
```

---

## Browser Testing

Open these URLs and verify:

- ✅ **https://blossom.onl** → Landing page loads
- ✅ **https://app.blossom.onl** → Access gate appears (enter code)
- ✅ **https://stats.blossom.onl** → Stats dashboard visible (no code required)
- ✅ **https://whitepaper.blossom.onl** → Whitepaper loads

In the gated app (`app.blossom.onl`):
- ✅ Enter valid access code → grants access
- ✅ Connect wallet → Solana/Ethereum wallets appear
- ✅ Type message → LLM responds
- ✅ Execute intent → (requires funded devnet wallet)

---

## Optional: Populate Stats with Test Data

```bash
# Run torture suite to generate synthetic execution data
export BASE_URL=https://api.blossom.onl
export VITE_DEV_LEDGER_SECRET=<your-secret>
npx tsx agent/scripts/run-torture-suite.ts

# Verify stats appear
open https://stats.blossom.onl
```

---

## Common Issues

| Issue | Fix |
|-------|-----|
| Health check 500 | Check Vercel logs: `vercel logs api` |
| "Database not connected" | Verify `DATABASE_URL` in Vercel env vars |
| Access gate not showing | Verify `VITE_ACCESS_GATE_ENABLED=true` |
| CORS errors | Check `VITE_AGENT_API_URL=https://api.blossom.onl` |
| Domain 404 | Wait for DNS propagation (5-60 min) |
| SSL not working | Wait for cert provisioning (10-30 min) |

Full troubleshooting guide: See DEPLOYMENT.md

---

## Rollback

If deployment fails:

```bash
# 1. Check recent deployments
vercel ls

# 2. Promote previous working deployment
vercel promote <deployment-url>

# 3. Or rollback in Vercel dashboard
# → Deployments → Select previous → Promote to Production
```

---

## Post-Launch Monitoring

- **Vercel Logs**: `vercel logs api --follow`
- **Error Rate**: Check Vercel dashboard → Analytics
- **Database**: Monitor Neon dashboard for connection count
- **Costs**: Free tier limits - 100 GB-hours/month compute

---

## Security Checklist

- [ ] `ACCESS_CODES_LOCAL.md` not committed (gitignored)
- [ ] `DATABASE_URL` only in Vercel backend env (not frontend)
- [ ] `VITE_DEV_LEDGER_SECRET` is unique (not reused password)
- [ ] OpenAI API key has spending limits set
- [ ] Neon database has IP allowlist (if needed)
- [ ] Stats endpoint is read-only (verified in code)

---

**Deployment Date**: _____________
**Deployed By**: _____________
**Neon Project**: _____________
**Vercel Project**: _____________

✅ **Production Ready**
