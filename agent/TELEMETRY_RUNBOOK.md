# Bloom Telemetry Runbook

## Overview

The Bloom telemetry system provides observability into user sessions, executions, and system health. It uses SQLite for minimal operational overhead.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     HTTP Server (http.ts)                       │
│  /api/telemetry/summary   /api/telemetry/users   /executions   │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                   telemetry/db.ts                               │
│  initDatabase() → upsertUser() → createExecution() → etc.      │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│              SQLite (agent/telemetry/telemetry.db)              │
│  Tables: users, sessions, executions, request_log, metrics     │
└─────────────────────────────────────────────────────────────────┘
```

## Database Schema

| Table | Purpose |
|-------|---------|
| `users` | Wallet addresses (hashed for privacy) |
| `sessions` | Session keys and status |
| `executions` | Execution history with outcomes |
| `request_log` | API request tracking |
| `metrics_rollup` | Hourly aggregated metrics |

## Quick Start

### 1. Verify DB Installation

```bash
cd /Users/redrum/Desktop/Bloom/agent
npm run prove:telemetry:db
```

Expected output: `✅ All telemetry DB proofs passed`

### 2. Verify Harness Infrastructure

```bash
npm run prove:telemetry:harness
```

Expected output: `✅ All telemetry harness proofs passed`

### 3. Run Load Test (Read-Only Mode)

```bash
# Default: 100 users, 50 concurrent reads
npm run load-test

# Custom configuration
npm run load-test -- --users=50 --read-concurrency=25
```

### 4. Access Dashboard Endpoints

With the backend running (`npm run dev`):

```bash
# Summary metrics
curl http://localhost:3001/api/telemetry/summary | jq .

# User list with session status
curl http://localhost:3001/api/telemetry/users | jq .

# Recent executions
curl http://localhost:3001/api/telemetry/executions?limit=20 | jq .
```

## Load Test Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `--users` | 100 | Number of ephemeral wallets to generate |
| `--read-concurrency` | 50 | Max concurrent read requests |
| `--exec-concurrency` | 5 | Max concurrent execution tests (capped for safety) |
| `--mode` | read-only | Test mode (`read-only` or `full`) |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TELEMETRY_DB_PATH` | `agent/telemetry/telemetry.db` | SQLite database path |
| `TELEMETRY_SALT` | (default salt) | Salt for hashing user addresses |
| `TELEMETRY_CONSOLE` | `false` | Log telemetry events to console |

## Endpoints Tested by Load Harness

| Endpoint | Purpose | Expected Response |
|----------|---------|-------------------|
| `/api/session/status` | Session validity check | 200 with session info or 400 if no session |
| `/api/execute/preflight` | Capabilities check | 200 with adapter allowlist |
| `/health` | Server health | 200 with `ok: true` |

## Interpreting Results

### Summary Table

```
| Endpoint                      | Total | OK   | Fail | OK%   | Avg ms | P95 ms |
|-------------------------------|-------|------|------|-------|--------|--------|
| /api/session/status           |   100 |  100 |    0 | 100.0 |     45 |     89 |
| /api/execute/preflight        |   100 |  100 |    0 | 100.0 |     23 |     56 |
| /health                       |    10 |   10 |    0 | 100.0 |     12 |     18 |
```

### Key Metrics

- **OK%**: Should be >99% for production readiness
- **Avg ms**: Should be <100ms for read endpoints
- **P95 ms**: Should be <500ms for acceptable UX

### Common Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| `NETWORK_ERROR` | Request timeout or connection failure | Check server health |
| `HTTP_500` | Server error | Check backend logs |
| `HTTP_429` | Rate limited | Reduce concurrency |

## Troubleshooting

### DB Not Found

```
Error: SQLITE_CANTOPEN: unable to open database file
```

Fix: Ensure telemetry directory exists:
```bash
mkdir -p agent/telemetry
```

### High Latency

If P95 > 500ms:
1. Check server CPU/memory
2. Reduce concurrency
3. Check RPC node health (for chain-dependent endpoints)

### Test Failures

If OK% < 95%:
1. Check backend logs: `DEBUG_EXECUTIONS=1 npm run dev`
2. Verify network connectivity
3. Check for rate limiting

## Proof Gates

| Script | What It Proves |
|--------|----------------|
| `prove:telemetry:db` | DB init, CRUD operations, aggregation |
| `prove:telemetry:harness` | Wallet gen, concurrency, percentiles |

Run both before deploying telemetry changes:

```bash
npm run prove:telemetry:db && npm run prove:telemetry:harness
```

## Safety Notes

1. **Private keys**: Generated wallets are ephemeral; private keys exist only in memory
2. **No real funds**: Load test wallets have no ETH or tokens
3. **Rate limiting**: Default concurrency is safe for local development
4. **Production**: Cap `exec-concurrency` at 5-10 for real network tests

---

## Devnet Statistics

### Overview

The devnet statistics system provides real-time metrics for the landing page Capabilities tab and the `/devnet` dashboard:

**Traffic Metrics (always visible):**
- Requests Processed (HTTP requests to the API)
- Devnet Users (unique wallet addresses)
- Traffic Success Rate (% of requests without errors)
- Recent Traffic Runs (load test history)

**Execution Metrics (conditionally hidden):**
- Executions Finalized (on-chain transactions)
- Devnet Volume Executed (by token)
- Devnet Fees Collected

### Execution Metrics Visibility

Execution metrics (Executions Finalized, Volume, Fees) are **intentionally hidden** until meaningful tx-backed volume exists. This ensures the UI displays truthful data to investors.

**Controlled by:**
1. `VITE_SHOW_EXECUTION_METRICS` env var (default: `false`)
2. Auto-hidden even if flag is true when:
   - `executions.allTime < 10` OR
   - Total volume across all tokens == 0

**To enable execution metrics in UI:**
```bash
# In .env.local (frontend)
VITE_SHOW_EXECUTION_METRICS=true
```

Then ensure at least 10 on-chain executions with volume have been recorded.

**Rationale:** Load tests generate high request counts but do not produce real on-chain transactions. Showing "Executions: 0" or "Volume: 0" alongside "Requests: 200K+" would be confusing to investors. By hiding these until meaningful execution data exists, the UI remains truthful.

### Devnet Stats API

**Endpoint:** `GET /api/telemetry/devnet-stats`

**Response:**
```json
{
  "ok": true,
  "data": {
    "users": { "allTime": 1500, "last24h": 200 },
    "transactions": { "allTime": 3000, "last24h": 500, "successCount": 2800, "failCount": 200 },
    "amountExecuted": {
      "byToken": [{ "token": "REDACTED", "totalUnits": "1000000.000000" }],
      "unpricedCount": 10
    },
    "feesCollected": {
      "byToken": [{ "token": "REDACTED", "totalFeeUnits": "2500.000000", "last24hFeeUnits": "500.000000" }],
      "feeBps": 25,
      "unpricedCount": 5
    },
    "generatedAt": "2024-01-20T12:00:00.000Z"
  }
}
```

### Fee Configuration

| Variable | Default | Range | Description |
|----------|---------|-------|-------------|
| `BLOSSOM_FEE_BPS` | 25 | 10-50 | Fee in basis points (25 = 0.25%) |

Fees are only applied to successful executions with amount/token data.

### Viewing Stats on Landing Page

1. Start the backend: `cd agent && npm run dev`
2. Start the frontend: `cd .. && npm run dev`
3. Open http://localhost:5173
4. Click "Capabilities" in navigation
5. Expand "View Devnet Statistics"
6. Stats auto-refresh every 10 seconds

---

## Devnet Load Testing (1500+ Users)

### Quick Start

```bash
cd agent

# Run 1500-user load test (60 seconds)
npm run devnet:load -- --users=1500 --read-concurrency=200 --duration=60

# Run smaller smoke test (50 users, 10 seconds)
npm run prove:devnet:load:smoke
```

### Load Test Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `--users` | 1500 | Number of devnet user addresses to generate |
| `--read-concurrency` | 200 | Max concurrent requests |
| `--duration` | 60 | Test duration in seconds |
| `--run-id` | auto | Unique identifier for this run |

### Execution Batch Test

For testing real execution flow (with fee accounting):

```bash
# Dry-run mode (validateOnly)
npm run devnet:exec-batch -- --n=25 --concurrency=5 --dry-run=true

# With token/amount
npm run devnet:exec-batch -- --n=25 --concurrency=5 --token=REDACTED --amount=1000000
```

### Endpoints Tested

| Endpoint | Purpose |
|----------|---------|
| `/health` | Server health |
| `/api/execute/preflight` | Capabilities check |
| `/api/session/status` | Session validation |
| `/api/defi/aave/positions` | DeFi positions read |
| `/api/execute/prepare` | Execution preparation |

---

## Generating Reports

```bash
# Generate report from latest telemetry data
npm run devnet:report

# Generate report with specific run ID
npm run devnet:report -- --run-id=devnet-load-1705766400000
```

Output: `DEVNET_LOAD_REPORT_<RUN_ID>.md` in project root.

### Report Contents

1. Executive summary (total requests, success rate, latency)
2. Unique devnet users
3. Processed transactions
4. Devnet volume executed (by token)
5. Devnet fees collected
6. Per-route performance table
7. Error analysis
8. Recent transaction hashes
9. Readiness assessment

---

## Proof Gates

### Available Proofs

| Script | What It Proves |
|--------|----------------|
| `prove:devnet:stats` | DB schema, non-negative values, fee bps range |
| `prove:devnet:load:smoke` | 50 users, 99%+ success in 10s |
| `prove:devnet:ui:stats` | Endpoint returns expected keys |

### Running Proofs

```bash
# Individual proofs
npm run prove:devnet:stats
npm run prove:devnet:load:smoke   # Requires backend running
npm run prove:devnet:ui:stats     # Requires backend running

# All proofs
npm run prove:devnet:stats && npm run prove:devnet:ui:stats
```

### CI/CD Integration

```yaml
# GitHub Actions example
- name: Prove Devnet Stats
  run: |
    cd agent
    npm run prove:devnet:stats
    npm run dev &
    sleep 5
    npm run prove:devnet:ui:stats
```

---

## Complete Workflow

### 1. Start Services

```bash
# Terminal 1: Backend
cd agent
npm run dev

# Terminal 2: Frontend
cd /Users/redrum/Desktop/Bloom
npm run dev
```

### 2. Run Load Test

```bash
cd agent
npm run devnet:load -- --users=1500 --read-concurrency=200 --duration=60
```

### 3. Run Execution Batch (Optional)

```bash
npm run devnet:exec-batch -- --n=25 --concurrency=5 --dry-run=true
```

### 4. Generate Report

```bash
npm run devnet:report
```

### 5. Verify Stats in UI

1. Open http://localhost:5173
2. Navigate to Capabilities section
3. Click "View Devnet Statistics"
4. Verify metrics match report

## Maintenance

### Compact Database

```bash
sqlite3 agent/telemetry/telemetry.db "VACUUM;"
```

### Export Data

```bash
sqlite3 -header -csv agent/telemetry/telemetry.db \
  "SELECT * FROM executions ORDER BY created_at DESC LIMIT 1000;" \
  > executions_export.csv
```

### Reset Database

```bash
rm agent/telemetry/telemetry.db
npm run prove:telemetry:db  # Recreates with schema
```
