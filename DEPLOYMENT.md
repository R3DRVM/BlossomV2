# Blossom MVP Deployment Guide

This guide covers deploying the Blossom MVP to Vercel with Neon Postgres, access-gated app, and public stats.

## Quick Start

For experienced users who just need the commands:

```bash
# 1. Create Neon database and apply schema
DATABASE_URL='postgresql://...' npx tsx agent/scripts/setup-neon-db.ts --apply-schema

# 2. Generate access codes
npx tsx agent/scripts/generate-access-codes.ts --count=50

# 3. Deploy to Vercel (follow prompts for env vars)
vercel --prod

# 4. Verify deployment
npx tsx agent/scripts/preflight-verify.ts --baseUrl=https://api.blossom.onl --quick
```

See full steps below for detailed instructions and troubleshooting.

---

## Architecture Overview

| Subdomain | Route | Access |
|-----------|-------|--------|
| `blossom.onl` | Landing page | Public |
| `app.blossom.onl` | Chat + execution app | Gated (access code) |
| `stats.blossom.onl` | Statistics dashboard | Public (read-only) |
| `whitepaper.blossom.onl` | Whitepaper | Public |

---

## Step 1: Create Neon Postgres Database

1. Go to [Neon Console](https://console.neon.tech)
2. Create a new project (free tier is fine)
3. Copy the connection string (looks like `postgresql://user:pass@host/db?sslmode=require`)

### Run Schema Migration

```bash
# Recommended: Using setup script (checks connection + applies schema)
DATABASE_URL='postgresql://...' npx tsx agent/scripts/setup-neon-db.ts --apply-schema

# Alternative: Using psql directly
psql "$DATABASE_URL" < agent/execution-ledger/schema-postgres.sql

# Verify tables were created
DATABASE_URL='postgresql://...' npx tsx agent/scripts/setup-neon-db.ts --check-only
```

**Expected output:**
```
[neon-setup] Connecting to: postgresql://...[REDACTED]
  ✓ Connected to database: neondb
[neon-setup] Checking tables...
  ✓ executions
  ✓ execution_steps
  ✓ routes
  ✓ sessions
  ✓ assets
  ✓ wallets
  ✓ intents
  ✓ positions
  ✓ indexer_state
  ✓ access_codes
  ✓ waitlist
All expected tables exist!
```

---

## Step 2: Generate Access Codes

```bash
# Generate 50 access codes (output to ACCESS_CODES_LOCAL.md - gitignored)
npx tsx agent/scripts/generate-access-codes.ts --count=50

# View generated codes
cat ACCESS_CODES_LOCAL.md
```

**Important:** Store these codes securely. They are gitignored and should never be committed.

---

## Step 3: Configure Vercel

### Environment Variables

Set these in Vercel project settings → Environment Variables.

**IMPORTANT**: In Vercel, you can scope variables to "Production", "Preview", or "Development". For the variables below, set them for **Production** (and optionally Preview if you want staging environments).

**Frontend Variables** (VITE_* prefix - available to client-side code):

```bash
# Backend API URL (Vercel will serve this from api.blossom.onl)
VITE_AGENT_API_URL=https://api.blossom.onl

# Enable access gate in production
VITE_ACCESS_GATE_ENABLED=true

# Ledger API secret (for write operations - keep secure!)
VITE_DEV_LEDGER_SECRET=your-secure-random-secret-here
```

**Backend Variables** (for serverless API functions only):

```bash
# Database connection (Neon Postgres)
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require

# LLM Model Provider
BLOSSOM_MODEL_PROVIDER=openai
BLOSSOM_OPENAI_API_KEY=sk-your-key-here
BLOSSOM_OPENAI_MODEL=gpt-4o-mini

# Optional: Gemini fallback
# BLOSSOM_GEMINI_API_KEY=your-gemini-key
```

**Security Notes**:
- `DATABASE_URL` should ONLY be set for backend/serverless functions (not exposed to frontend)
- `VITE_DEV_LEDGER_SECRET` is exposed to frontend - use a dedicated secret, not your database password
- Never commit `.env` files or secrets to git

### Domain Configuration

In Vercel project settings → Domains, add all 5 domains:

1. **blossom.onl** (root domain)
   - Points to: landing page
   - Route: `/` (LandingPage.tsx)
   - Access: Public

2. **app.blossom.onl**
   - Points to: gated application
   - Route: Detected in AppRouter.tsx via `window.location.hostname`
   - Access: Access code required (AccessGate.tsx)

3. **stats.blossom.onl**
   - Points to: public statistics dashboard
   - Route: `/dev/stats` (DevStatsPage.tsx)
   - Access: Public (read-only mode)

4. **whitepaper.blossom.onl**
   - Points to: whitepaper viewer
   - Route: `/whitepaper` (WhitepaperPage.tsx)
   - Access: Public

5. **api.blossom.onl**
   - Points to: serverless backend API
   - Route: `/api/*` and `/health` → api/index.ts
   - Access: API endpoints (used by frontend)

**DNS Configuration**:
- All domains should be A/CNAME records pointing to Vercel's infrastructure
- Vercel will auto-provision SSL certificates
- DNS propagation can take 5-60 minutes

**Verification**:
After adding domains, verify each subdomain loads correctly:
```bash
curl https://blossom.onl  # Should return landing page HTML
curl https://app.blossom.onl  # Should return app HTML
curl https://stats.blossom.onl  # Should return stats page HTML
curl https://whitepaper.blossom.onl  # Should return whitepaper page
curl https://api.blossom.onl/health  # Should return {"ok":true}
```

### Build Settings

- **Framework**: Vite
- **Build Command**: `npm run build`
- **Output Directory**: `dist`
- **Install Command**: `npm install`

---

## Step 4: Deploy to Vercel (Frontend + API)

The MVP uses **Vercel Serverless Functions** for the agent API backend. Both frontend and backend deploy together.

### Deploy Steps

```bash
# Install Vercel CLI (if not already installed)
npm i -g vercel

# Deploy to production
vercel --prod

# Follow prompts:
# - Link to existing project or create new
# - Set project name (e.g., blossom-mvp)
# - Confirm root directory (.)
```

### Post-Deployment Configuration

After deployment, configure domains and environment variables in the Vercel dashboard.

---

## Step 5: Run Preflight Verification

After Vercel deployment completes, verify the production API is working correctly.

### Quick Health Check (No Secrets Required)

```bash
# Verify API is responding
npx tsx agent/scripts/preflight-verify.ts --baseUrl=https://api.blossom.onl --quick
```

Expected output:
```
[preflight] Checking health at https://api.blossom.onl/health...
  ✓ Health OK (200)
  ✓ Database: Connected
  ✓ Model Provider: Configured
PREFLIGHT PASSED (quick mode)
```

### Full Verification (Requires LEDGER_SECRET)

```bash
# Full verification including write operations
VITE_DEV_LEDGER_SECRET=your-secret \
  npx tsx agent/scripts/preflight-verify.ts \
  --baseUrl=https://api.blossom.onl \
  --verbose
```

Expected output:
```
[preflight] Checking health at https://api.blossom.onl/health...
  ✓ Health OK
  ✓ Stats API OK (/api/stats)
  ✓ Database tables verified
  ✓ Access codes table accessible
  ✓ Waitlist table accessible
PREFLIGHT PASSED
```

### Troubleshooting

**If health check fails (500/503)**:
- Check Vercel function logs: `vercel logs api`
- Verify `DATABASE_URL` is set in Vercel environment variables
- Verify Neon database is running and accessible
- Check database schema was applied: `npx tsx agent/scripts/setup-neon-db.ts --check-only`

**If "Database: Not Connected"**:
- Verify `DATABASE_URL` connection string format: `postgresql://user:pass@host/db?sslmode=require`
- Test connection manually: `DATABASE_URL='...' npx tsx agent/scripts/setup-neon-db.ts --check-only`
- Check Neon dashboard for connection limits or suspended project

---

## Step 6: Populate Production Ledger (Optional)

To populate the production ledger with test execution data for demo purposes:

### Option A: Run Torture Suite

```bash
# Set production API URL and secret
export BASE_URL=https://api.blossom.onl
export VITE_DEV_LEDGER_SECRET=your-secret

# Run full torture suite (generates synthetic executions)
npx tsx agent/scripts/run-torture-suite.ts
```

**What this does**:
- Generates synthetic execution records across multiple chains (Solana, Ethereum)
- Creates test data for: swaps, perp positions, DeFi deposits, prediction markets
- Populates stats dashboard with realistic-looking data
- Uses `--baseUrl` parameter to write to production database via API

### Option B: Real User Execution

Instead of synthetic data, you can:
1. Visit `app.blossom.onl`
2. Enter an access code
3. Connect wallet
4. Execute real intents (requires funded wallet on devnet/testnet)

### Verify Results

After running either option, check the stats dashboard:

```bash
# Visit in browser
open https://stats.blossom.onl

# Or check via API
curl https://api.blossom.onl/api/stats | jq '.intents | length'
```

Expected stats to appear:
- Total executions count
- Success/failure breakdown
- Chain distribution (Solana vs Ethereum)
- Venue distribution (Jupiter, Aave, Polymarket, etc.)
- Recent execution timeline

**Note**: Stats are **read-only** when accessed from `stats.blossom.onl` (public mode). Write operations require authenticated session via `app.blossom.onl`.

---

## Local Development

### Dual Database Support

The codebase automatically detects database type:
- If `DATABASE_URL` starts with `postgres://` → uses Postgres
- Otherwise → uses local SQLite at `agent/execution-ledger/ledger.db`

```bash
# Local dev (SQLite)
npm run dev

# Local dev with Postgres
DATABASE_URL=postgresql://... npm run dev
```

### Running Locally

```bash
# Terminal 1: Frontend
npm run dev

# Terminal 2: Backend
cd agent && npm run dev

# Access locally
# http://localhost:5173 (frontend)
# http://localhost:3001 (backend)
```

---

## Troubleshooting

### Vercel Deployment Issues

**Build fails with TypeScript errors**:
- Current workaround: `vercel.json` uses `vite build` instead of `npm run build` to skip TypeScript checking
- Errors in `Chat.tsx` and `BlossomContext.tsx` are pre-existing and don't affect runtime
- Vite can still build successfully despite TypeScript errors

**"Cannot find module '../agent/src/server/http.js'"**:
- Ensure postinstall script ran: `cd agent && npm install`
- Manually install agent deps: `cd agent && npm install && cd ..`
- Redeploy: `vercel --prod`

**Function timeout (FUNCTION_INVOCATION_TIMEOUT)**:
- Increase `maxDuration` in `vercel.json` functions config
- Current setting: 30 seconds (should be sufficient for most LLM calls)
- Max on free tier: 10 seconds; Pro tier: 60 seconds

### API and Database Issues

**Health check returns 500/503**:
- Check Vercel function logs: `vercel logs api`
- Verify `DATABASE_URL` environment variable is set
- Test database connection: `DATABASE_URL='...' npx tsx agent/scripts/setup-neon-db.ts --check-only`
- Verify Neon project is active (not paused due to inactivity)

**"Database connection failed"**:
- Verify connection string format: `postgresql://user:pass@ep-xxx.region.aws.neon.tech/dbname?sslmode=require`
- Must include `?sslmode=require` for Neon
- Check Neon dashboard → Connection Details for correct string
- Verify IP allowlist in Neon (if enabled) - Vercel uses dynamic IPs

**"Table does not exist" errors**:
- Schema not applied - run: `DATABASE_URL='...' npx tsx agent/scripts/setup-neon-db.ts --apply-schema`
- Verify all 11 tables created: `--check-only` flag

### Frontend Issues

**Access gate not showing**:
- Verify `VITE_ACCESS_GATE_ENABLED=true` in Vercel environment variables
- Check correct subdomain: gate only shows on `app.blossom.onl`, not `blossom.onl`
- Clear browser cache and localStorage
- Verify `AccessGate.tsx` component is rendering (check browser console)

**"Failed to fetch" or CORS errors**:
- Verify `VITE_AGENT_API_URL=https://api.blossom.onl` is set
- Check CORS configuration in `agent/src/server/http.ts`
- Pattern should allow `^https:\/\/.*\.blossom\.onl$`
- Clear browser cache

**Stats not updating after execution**:
- Verify execution actually succeeded (check API logs)
- Check `VITE_DEV_LEDGER_SECRET` matches between frontend and backend
- Stats endpoint: `https://api.blossom.onl/api/stats`
- Try refreshing stats page with cache bypass (Cmd+Shift+R / Ctrl+Shift+F5)

**LLM not responding / "Model error"**:
- Verify `BLOSSOM_OPENAI_API_KEY` is set in Vercel backend environment
- Check OpenAI API key is valid and has credits
- Check Vercel function logs for error details
- Verify `BLOSSOM_MODEL_PROVIDER=openai` is set

### Domain and SSL Issues

**Domain shows "Deployment not found"**:
- DNS not propagated yet - wait 5-60 minutes
- Verify DNS records point to Vercel (check in domain registrar)
- In Vercel dashboard, ensure domain shows "Active" status

**SSL certificate not provisioned**:
- Vercel auto-provisions - can take 10-30 minutes
- Verify domain ownership in Vercel dashboard
- Check DNS records are correct (A/CNAME)

**Subdomain routing not working (wrong page loads)**:
- Verify `AppRouter.tsx` uses `window.location.hostname` for routing
- Check browser console for JavaScript errors
- Clear browser cache and try incognito mode

---

## Production Deployment Checklist

### Pre-Deployment

- [ ] **Neon database created** and connection string obtained
- [ ] **Database schema applied**: Run `DATABASE_URL='...' npx tsx agent/scripts/setup-neon-db.ts --apply-schema`
- [ ] **Schema verified**: All 11 tables exist (run with `--check-only`)
- [ ] **Access codes generated**: Run `npx tsx agent/scripts/generate-access-codes.ts --count=50`
- [ ] **Access codes stored securely**: `ACCESS_CODES_LOCAL.md` saved to password manager (gitignored)

### Vercel Configuration

- [ ] **Vercel project created**: `vercel --prod` completed successfully
- [ ] **Frontend environment variables set**:
  - `VITE_AGENT_API_URL=https://api.blossom.onl`
  - `VITE_ACCESS_GATE_ENABLED=true`
  - `VITE_DEV_LEDGER_SECRET=<your-secret>`
- [ ] **Backend environment variables set**:
  - `DATABASE_URL=postgresql://...`
  - `BLOSSOM_MODEL_PROVIDER=openai`
  - `BLOSSOM_OPENAI_API_KEY=sk-...`
  - `BLOSSOM_OPENAI_MODEL=gpt-4o-mini`
- [ ] **All 5 domains configured**:
  - `blossom.onl` (landing)
  - `app.blossom.onl` (gated app)
  - `stats.blossom.onl` (public stats)
  - `whitepaper.blossom.onl` (whitepaper)
  - `api.blossom.onl` (backend API)
- [ ] **SSL certificates active**: All domains show green padlock in browser

### Post-Deployment Verification

- [ ] **Health check passes**: `curl https://api.blossom.onl/health` returns `{"ok":true}`
- [ ] **Preflight verification passes**: `npx tsx agent/scripts/preflight-verify.ts --baseUrl=https://api.blossom.onl --quick`
- [ ] **Landing page loads**: Visit `https://blossom.onl`
- [ ] **Access gate active**: Visit `https://app.blossom.onl` - should show access code prompt
- [ ] **Access code works**: Enter valid code - should grant access to app
- [ ] **Stats dashboard public**: Visit `https://stats.blossom.onl` - should load without code
- [ ] **Whitepaper loads**: Visit `https://whitepaper.blossom.onl`

### Functional Testing

- [ ] **Wallet connection works**: Connect Solana wallet in gated app
- [ ] **Chat interface responds**: Type message - LLM should respond
- [ ] **Intent execution works**: Submit executable intent (requires funded devnet wallet)
- [ ] **Stats update**: After execution, stats dashboard shows new data
- [ ] **Waitlist captures emails**: Submit email on landing page - verify in database

### Security Verification

- [ ] **Secrets not logged**: Check Vercel function logs - no `DATABASE_URL` or secrets visible
- [ ] **Stats read-only**: Public stats page cannot write to database
- [ ] **CORS configured**: Only `*.blossom.onl` origins allowed
- [ ] **Access codes required**: Cannot access app without valid code
- [ ] **Database isolated**: Frontend cannot directly access `DATABASE_URL`

---

## Security Notes

- **Never commit** `.env`, access codes, or private keys
- Stats endpoint is **read-only** - no public mutation
- Access codes are validated server-side
- Waitlist entries are stored in database
- All secrets should be in Vercel environment variables only
