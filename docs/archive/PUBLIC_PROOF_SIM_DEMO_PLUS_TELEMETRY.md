# Public Proof: Simulated Demo + Telemetry Dashboard

This document provides investor-grade verification of the 2-track public deployment.

## Deployment Architecture

```
PUBLIC INTERNET
      │
      ├── blossom.ceo                      → Simulated Demo (Jan 8 investor demo build)
      │     └── /app                       → Interactive simulated trading
      │
      ├── blossom-devnet.fly.dev           → Devnet Statistics Dashboard
      │     └── devnet.blossom.ceo         → (after DNS setup)
      │
      └── blossom-telemetry.fly.dev        → Telemetry API (TELEMETRY_ONLY=true)
            └── Read-only stats + runs
            └── ALL execution endpoints BLOCKED
```

## 1. Simulated Demo (blossom.ceo)

### Commit Hash & Release
- **Git Commit**: `bd577b97b61c298bba580983672e1f000b4f2e77`
- **Commit Date**: Dec 27, 2025 16:03:48
- **Commit Message**: "fix(defi): correct allocation amounts + stabilize execution drafts; add polymarket live markets"
- **Fly Release**: v22 (deployed Jan 23, 2026)
- **Image**: `blossomv2:deployment-01KFMSE3T9KJS0GV4RCPQHAS1E`

### Routes
| Path | Description |
|------|-------------|
| `/` | Landing page |
| `/app` | Interactive simulated demo |

### Verification
```bash
# Landing page loads
curl -s -o /dev/null -w "%{http_code}" https://blossom.ceo
# Expected: 200

# App route loads
curl -s -o /dev/null -w "%{http_code}" https://blossom.ceo/app
# Expected: 200

# Page title confirms sim demo
curl -s https://blossom.ceo | grep -o '<title>[^<]*</title>'
# Expected: <title>Blossom – AI Trading Copilot</title>
```

### What This Build Contains
- Simulated perp trading with local state
- Simulated DeFi deposits with local state
- Simulated event market betting
- Polymarket live data integration
- **NO** testnet execution kernel
- **NO** session management
- **NO** devnet dashboard

---

## 2. Devnet Statistics Dashboard

### URLs
| Resource | URL |
|----------|-----|
| Dashboard | https://blossom-devnet.fly.dev |
| Subdomain (after DNS) | https://devnet.blossom.ceo |

### DNS Records for GoDaddy
Add these records to point `devnet.blossom.ceo` to the dashboard:

| Type | Name | Value |
|------|------|-------|
| A | devnet | 66.241.125.183 |
| AAAA | devnet | 2a09:8280:1::c8:a113:0 |

Or use CNAME:
| Type | Name | Value |
|------|------|-------|
| CNAME | devnet | knxxjjr.blossom-devnet.fly.dev |

### Features
- Real-time traffic stats from telemetry API
- Run history table
- Auto-refresh every 30 seconds
- Pure HTML/JS (no React build required)
- Uses Tailwind CSS via CDN

### Verification
```bash
# Dashboard loads
curl -s -o /dev/null -w "%{http_code}" https://blossom-devnet.fly.dev
# Expected: 200

# Dashboard title
curl -s https://blossom-devnet.fly.dev | grep -o '<title>[^<]*</title>'
# Expected: <title>Blossom Devnet Statistics</title>

# No localhost calls (check HTML)
curl -s https://blossom-devnet.fly.dev | grep -c "localhost"
# Expected: 0
```

---

## 3. Telemetry API (blossom-telemetry.fly.dev)

### Configuration
- **TELEMETRY_ONLY**: `true`
- **Persistent Volume**: `/data/telemetry.sqlite`

### Allowed Endpoints (Return 200)
```bash
curl -s https://blossom-telemetry.fly.dev/health | jq '.ok'
# true

curl -s https://blossom-telemetry.fly.dev/api/telemetry/devnet-stats | jq '.ok'
# true

curl -s "https://blossom-telemetry.fly.dev/api/telemetry/runs?limit=5" | jq '.ok'
# true
```

### Blocked Endpoints (Return 403)
```bash
# Execute endpoints BLOCKED
curl -s -X POST https://blossom-telemetry.fly.dev/api/execute/prepare \
  -H "Content-Type: application/json" -d '{}' | jq '.error'
# "Forbidden: This endpoint is disabled in telemetry-only mode"

# Session endpoints BLOCKED
curl -s -X POST https://blossom-telemetry.fly.dev/api/session/prepare \
  -H "Content-Type: application/json" -d '{}' | jq '.error'
# "Forbidden: This endpoint is disabled in telemetry-only mode"

# Chat endpoint BLOCKED
curl -s -X POST https://blossom-telemetry.fly.dev/api/chat \
  -H "Content-Type: application/json" -d '{"message":"test"}' | jq '.error'
# "Forbidden: This endpoint is disabled in telemetry-only mode"
```

---

## 4. Current Telemetry Data

### Traffic Stats
```bash
curl -s https://blossom-telemetry.fly.dev/api/telemetry/devnet-stats | jq '.data.traffic'
```

**Response (as of 2026-01-23):**
```json
{
  "requestsAllTime": 5075,
  "requestsLast24h": 5075,
  "successRate24h": 100,
  "http5xx24h": 0,
  "visitorsAllTime": 45,
  "visitorsLast24h": 45
}
```

### Latest Run
```bash
curl -s "https://blossom-telemetry.fly.dev/api/telemetry/runs?limit=1" | jq '.data[0]'
```

**Response:**
```json
{
  "run_id": "telemetry_seed_2026-01-23",
  "users": 50,
  "concurrency": 200,
  "duration": 21,
  "total_requests": 4637,
  "success_rate": 100,
  "p50_ms": 135,
  "p95_ms": 901,
  "http_5xx": 0
}
```

---

## 5. Security Statement

### Public Deployments Block Execution

**All public deployments have execution endpoints BLOCKED:**

| Deployment | /api/execute/* | /api/session/* | /api/chat |
|------------|----------------|----------------|-----------|
| blossom.ceo | N/A (sim demo) | N/A | N/A |
| blossom-devnet.fly.dev | N/A (static) | N/A | N/A |
| blossom-telemetry.fly.dev | **403 BLOCKED** | **403 BLOCKED** | **403 BLOCKED** |
| blossom-agent.fly.dev | **403 BLOCKED** | **403 BLOCKED** | **403 BLOCKED** |

### No Fake Metrics
- Traffic stats are real HTTP request logs
- Visitor counts are real unique addresses
- Run history shows actual load test campaigns
- **Executions/Volume/Fees hidden** when no real tx data exists

---

## 6. Verification Checklist

- [x] blossom.ceo serves simulated demo (commit bd577b9)
- [x] blossom.ceo/app loads interactive demo
- [x] blossom-devnet.fly.dev serves statistics dashboard
- [x] Dashboard shows real traffic stats
- [x] Dashboard shows run history
- [x] No localhost:3001 calls in public deployments
- [x] /api/execute/* returns 403 on telemetry agent
- [x] /api/session/* returns 403 on telemetry agent
- [x] No CORS errors (telemetry API allows all origins)
- [x] Persistent SQLite volume for stats

---

*Generated: 2026-01-23*
*Blossom Public Deploy Split v1.0*
