# Public Deployment Split Runbook

This document explains the separation between public-facing deployments and the private testnet MVP.

## Architecture Overview

```
PUBLIC INTERNET
      │
      ├── blossom.ceo (Landing + /devnet dashboard)
      │         │
      │         └──▶ blossom-telemetry.fly.dev (TELEMETRY_ONLY=true)
      │                    │
      │                    └── Read-only telemetry data
      │                        - Traffic stats
      │                        - Run history
      │                        - NO execution/session endpoints
      │
      └── blossom-agent.fly.dev (TELEMETRY_ONLY=true, legacy)
                 │
                 └── Also secured with TELEMETRY_ONLY mode
                     Contains historical telemetry data

PRIVATE (Local Only)
      │
      └── localhost:3001 (Full agent with TELEMETRY_ONLY=false)
                 │
                 └── Full execution capabilities
                     - /api/execute/*
                     - /api/session/*
                     - /api/chat
                     - etc.
```

## Deployment URLs

| Resource | URL | Purpose |
|----------|-----|---------|
| **Landing Page** | https://blossom.ceo | Public landing + link to devnet |
| **Devnet Dashboard** | https://blossom.ceo/devnet | Read-only telemetry stats |
| **Telemetry Agent** | https://blossom-telemetry.fly.dev | Primary telemetry API (TELEMETRY_ONLY=true) |
| **Legacy Agent** | https://blossom-agent.fly.dev | Secondary telemetry API (TELEMETRY_ONLY=true) |
| **Private Testnet** | localhost:3001 | Local development only |

## TELEMETRY_ONLY Mode

When `TELEMETRY_ONLY=true` is set:

### Allowed Endpoints (Return 200)
```
GET  /health
GET  /api/health
GET  /api/rpc/health
GET  /api/telemetry/summary
GET  /api/telemetry/devnet-stats
GET  /api/telemetry/users
GET  /api/telemetry/executions
GET  /api/telemetry/runs
GET  /api/telemetry/debug
POST /api/telemetry/runs
```

### Blocked Endpoints (Return 403)
```
POST /api/chat
POST /api/execute/*
POST /api/session/*
GET  /api/session/*
POST /api/setup/*
POST /api/token/*
GET  /api/portfolio/*
GET  /api/defi/*
GET  /api/wallet/*
POST /api/demo/*
GET  /api/debug/*
... and all other non-telemetry routes
```

## Verification Commands

### 1. Verify Public Telemetry Works
```bash
# Should return traffic stats
curl -s https://blossom-telemetry.fly.dev/api/telemetry/devnet-stats | jq '.data.traffic'

# Should return run history
curl -s "https://blossom-telemetry.fly.dev/api/telemetry/runs?limit=5" | jq '.data'
```

### 2. Verify Execution Endpoints Are Blocked
```bash
# Should return 403 Forbidden
curl -s -X POST https://blossom-telemetry.fly.dev/api/execute/prepare \
  -H "Content-Type: application/json" -d '{}' | jq '.error'
# Expected: "Forbidden: This endpoint is disabled in telemetry-only mode"

curl -s -X POST https://blossom-telemetry.fly.dev/api/session/prepare \
  -H "Content-Type: application/json" -d '{}' | jq '.error'
# Expected: "Forbidden: This endpoint is disabled in telemetry-only mode"

curl -s -X POST https://blossom-telemetry.fly.dev/api/chat \
  -H "Content-Type: application/json" -d '{"message":"test"}' | jq '.error'
# Expected: "Forbidden: This endpoint is disabled in telemetry-only mode"
```

### 3. Verify Legacy Agent Is Also Secured
```bash
# Should also return 403
curl -s -X POST https://blossom-agent.fly.dev/api/execute/prepare \
  -H "Content-Type: application/json" -d '{}' | jq '.error'
# Expected: "Forbidden: This endpoint is disabled in telemetry-only mode"
```

### 4. Verify Frontend Points to Telemetry Agent
```bash
# Check that devnet page loads
curl -s -o /dev/null -w "%{http_code}" https://blossom.ceo/devnet
# Expected: 200
```

## Running Private Testnet MVP

For full execution capabilities, run the agent locally:

```bash
cd agent

# Create .env.local with required secrets (NOT committed to git)
cat > .env.local << 'EOF'
# RPC
ETH_TESTNET_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY

# Execution
EXECUTION_MODE=eth_testnet
EXECUTION_ROUTER_ADDRESS=0x...

# Session
EXECUTION_AUTH_MODE=session
SESSION_MANAGER_ADDRESS=0x...

# LLM (at least one required)
BLOSSOM_GEMINI_API_KEY=...
# or BLOSSOM_OPENAI_API_KEY=...
# or BLOSSOM_ANTHROPIC_API_KEY=...

# CRITICAL: Do NOT set TELEMETRY_ONLY=true for local dev
EOF

# Start local agent with full capabilities
npm run dev
```

The local agent at `localhost:3001` will have full execution capabilities.

## Security Checklist

- [x] TELEMETRY_ONLY=true on blossom-telemetry.fly.dev
- [x] TELEMETRY_ONLY=true on blossom-agent.fly.dev
- [x] Execution endpoints return 403 on public deployments
- [x] Session endpoints return 403 on public deployments
- [x] Frontend points to telemetry-only agent
- [x] No secrets in /api/telemetry/debug response
- [x] Private testnet runs only locally

## Fly.io Apps

| App | Purpose | Config |
|-----|---------|--------|
| `blossomv2` | Frontend (nginx) | fly.toml (root) |
| `blossom-telemetry` | Telemetry-only agent | agent/fly.telemetry.toml |
| `blossom-agent` | Legacy agent (now secured) | agent/fly.toml |

## Redeploying

### Frontend
```bash
cd /path/to/bloom
fly deploy --config fly.toml --app blossomv2
```

### Telemetry Agent
```bash
cd /path/to/bloom/agent
fly deploy --config fly.telemetry.toml
```

### Legacy Agent (if needed)
```bash
cd /path/to/bloom/agent
fly deploy --config fly.toml
```

---

*Generated: 2026-01-23*
*Blossom Security Split v1.0*
