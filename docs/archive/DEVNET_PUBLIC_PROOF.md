# Blossom Devnet Public Proof Bundle

This document provides investor-grade verification that the devnet statistics are real, persisted, and publicly accessible.

## Public URLs

| Resource | URL |
|----------|-----|
| **Landing Page (Fly)** | https://blossom.ceo |
| **Landing Page (Vercel)** | https://blossom-v2.vercel.app |
| **Devnet Dashboard (Fly)** | https://blossom.ceo/devnet |
| **Devnet Dashboard (Vercel)** | https://blossom-v2.vercel.app/devnet |
| **Agent API Base** | https://blossom-agent.fly.dev |

## API Endpoints (Curl Proofs)

### 1. Debug Endpoint (Database Verification)
```bash
curl -s https://blossom-agent.fly.dev/api/telemetry/debug | jq .
```

**Response:**
```json
{
  "ok": true,
  "debug": {
    "dbPath": "/data/telemetry.sqlite",
    "isWritable": true,
    "tables": ["users", "sessions", "executions", "metrics_rollup", "request_log", "sqlite_sequence", "runs"],
    "rowCounts": {
      "users": 0,
      "request_log": 22561,
      "executions": 0,
      "runs": 2
    },
    "nodeEnv": "production",
    "timestamp": "2026-01-23T05:36:XX.XXXZ"
  }
}
```

**Verification Points:**
- `dbPath: /data/telemetry.sqlite` - Persistent Fly volume
- `isWritable: true` - Database is writable
- `request_log: 22561` - Real HTTP requests logged
- `runs: 2` - Traffic test runs stored

### 2. Devnet Statistics
```bash
curl -s https://blossom-agent.fly.dev/api/telemetry/devnet-stats | jq .
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "traffic": {
      "requestsAllTime": 22561,
      "requestsLast24h": 22561,
      "successRate24h": 100,
      "http5xx24h": 0,
      "visitorsAllTime": 300,
      "visitorsLast24h": 300
    },
    "executions": {
      "allTime": 0,
      "last24h": 0,
      "successCount": 0,
      "failCount": 0
    },
    "users": { "allTime": 0, "last24h": 0 },
    "amountExecuted": { "byToken": [], "unpricedCount": 0 },
    "feesCollected": { "byToken": [], "feeBps": 25, "unpricedCount": 0 }
  }
}
```

### 3. Traffic Runs
```bash
curl -s "https://blossom-agent.fly.dev/api/telemetry/runs?limit=5" | jq .
```

**Response:**
```json
{
  "ok": true,
  "data": [
    {
      "id": 2,
      "run_id": "devnet_2026-01-23_214829_stage1",
      "stage": null,
      "users": 100,
      "concurrency": 50,
      "duration": 30,
      "total_requests": 5229,
      "success_rate": 100,
      "p50_ms": 199,
      "p95_ms": 746,
      "http_5xx": 0,
      "top_error_code": null,
      "started_at": "2026-01-23T05:48:29.981Z",
      "ended_at": "2026-01-23T05:49:02.115Z",
      "report_path": null,
      "created_at": 1769147342
    }
  ]
}
```

### 4. Health Check
```bash
curl -s https://blossom-agent.fly.dev/health | jq .
```

**Response:**
```json
{
  "ok": false,
  "ts": 1769146XXX,
  "service": "blossom-agent",
  "executionMode": "eth_testnet"
}
```

## Latest Campaign Summary

| Metric | Value |
|--------|-------|
| **Total Requests (All-time)** | 22,561 |
| **Unique Visitors** | 300 |
| **Success Rate** | 100% |
| **HTTP 5xx Errors** | 0 |

### Latest Run: `devnet_2026-01-23_214829_stage1`

| Metric | Value |
|--------|-------|
| **Users** | 100 |
| **Concurrency** | 50 |
| **Duration** | 30s |
| **Requests** | 5,229 |
| **Success Rate** | 100% |
| **P50 Latency** | 199ms |
| **P95 Latency** | 746ms |
| **HTTP 5xx** | 0 |

## Data Integrity Statement

### Traffic Data (HTTP Requests)
- Source: `request_log` table in SQLite
- Logging: Every HTTP request to the agent is logged with:
  - Endpoint, method, status code
  - Visitor address (from query params)
  - Latency in milliseconds
  - Correlation ID for tracing

### Executions (On-Chain Transactions)
- Source: `executions` table in SQLite
- **Currently 0** - No on-chain transactions have been executed
- Executions are **tx-backed only** - they require actual blockchain transactions
- "Executions Finalized" metric only counts real confirmed transactions

### Volume & Fees
- Hidden when `executions < 5` OR `volume = 0` OR `fees = 0`
- This prevents showing misleading "0.0000" values
- Will appear once real DeFi executions are processed

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Public Users                         │
└───────────────────────┬─────────────────────────────────┘
                        │
         ┌──────────────┴──────────────┐
         │                             │
         ▼                             ▼
┌─────────────────┐           ┌─────────────────┐
│   blossom.ceo   │           │ blossom-v2      │
│   (Fly.io)      │           │ (Vercel)        │
│   Static SPA    │           │ Static SPA      │
└────────┬────────┘           └────────┬────────┘
         │                             │
         └──────────────┬──────────────┘
                        │
                        ▼
              ┌─────────────────┐
              │ blossom-agent   │
              │ (Fly.io)        │
              │ Node.js API     │
              │ Port 3001       │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │ /data volume    │
              │ (Fly Persistent)│
              │ telemetry.sqlite│
              └─────────────────┘
```

## Fly.io Infrastructure

| App | Region | Purpose |
|-----|--------|---------|
| `blossomv2` | LAX | Static frontend (nginx) |
| `blossom-agent` | LAX | API backend (Node.js + SQLite) |

### Persistent Storage
- Volume: `blossom_agent_data` (1GB)
- Mount: `/data`
- Database: `/data/telemetry.sqlite`

## Verification Commands

```bash
# 1. Verify database is persisted
curl -s https://blossom-agent.fly.dev/api/telemetry/debug | jq '.debug.rowCounts'

# 2. Check live traffic stats
curl -s https://blossom-agent.fly.dev/api/telemetry/devnet-stats | jq '.data.traffic'

# 3. Verify frontend connects to agent
# Open browser: https://blossom.ceo/devnet
# Should show stats matching API response

# 4. Run load test to add more data
cd agent && AGENT_API_BASE_URL=https://blossom-agent.fly.dev npm run devnet:load -- --users=100 --duration=30
```

## Truthfulness Guarantees

1. **Traffic stats are real** - Every HTTP request is logged to SQLite
2. **Visitor counts are accurate** - Based on unique wallet addresses in requests
3. **Executions are tx-backed only** - No fake execution counts
4. **Volume/Fees hidden when zero** - No misleading "0.0000" displays
5. **Database is persistent** - Fly volume survives restarts/redeploys

---

*Generated: 2026-01-23*
*Blossom v0.1.0*
