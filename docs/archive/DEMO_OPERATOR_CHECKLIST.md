# Demo Operator Checklist

**Purpose:** Step-by-step guide for operators to configure and run investor demos.

---

## Quick Start

```bash
# 1. Run demo readiness check
./scripts/demo-ready-check.sh

# 2. Start backend (terminal 1)
cd agent && npm run dev

# 3. Start frontend (terminal 2)
npm run dev

# 4. Open browser
open http://localhost:5173
```

---

## Demo Modes

### Mode 1: SIM Mode (Default - No Wallet Needed)

**Use case:** Quick demo without real transactions

```bash
# agent/.env.local
EXECUTION_MODE=sim
BLOSSOM_MODEL_PROVIDER=gemini
BLOSSOM_GEMINI_API_KEY=your-key
```

**Behavior:**
- No wallet connection required
- Simulated execution (instant)
- No on-chain transactions
- Perfect for feature demos

---

### Mode 2: ETH Testnet Direct (Demo Deterministic Execution)

**Use case:** Show real on-chain transactions with reliable execution

```bash
# agent/.env.local

# Execution
EXECUTION_MODE=eth_testnet
EXECUTION_AUTH_MODE=direct

# RPC
ETH_TESTNET_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
ETH_TESTNET_CHAIN_ID=11155111

# Contracts (from deployment)
EXECUTION_ROUTER_ADDRESS=0x...
MOCK_SWAP_ADAPTER_ADDRESS=0x...
ERC20_PULL_ADAPTER_ADDRESS=0x...
UNISWAP_ADAPTER_ADDRESS=0x...
DEMO_REDACTED_ADDRESS=0x...
DEMO_WETH_ADDRESS=0x...
DEMO_SWAP_ROUTER_ADDRESS=0x...
DEMO_LEND_VAULT_ADDRESS=0x...
DEMO_LEND_ADAPTER_ADDRESS=0x...
PROOF_ADAPTER_ADDRESS=0x...

# Routing (deterministic = no external API)
ROUTING_MODE=deterministic

# LLM
BLOSSOM_MODEL_PROVIDER=gemini
BLOSSOM_GEMINI_API_KEY=your-key
```

**Behavior:**
- User signs each transaction
- Deterministic demo swap router (95% rate)
- Real on-chain execution
- Explorer links shown

---

### Mode 3: ETH Testnet Hybrid (1inch/dFlow Intelligence)

**Use case:** Show real routing decisions with demo execution

```bash
# agent/.env.local (add to Mode 2 config)

# Routing
ROUTING_MODE=hybrid
ONEINCH_API_KEY=your-key  # Optional, falls back gracefully

# OR use dFlow
DFLOW_ENABLED=true
DFLOW_API_KEY=your-key
DFLOW_BASE_URL=https://api.dflow.net
DFLOW_SWAPS_QUOTE_PATH=/v1/swaps/quote
DFLOW_EVENTS_MARKETS_PATH=/v1/events/markets
```

**Behavior:**
- Real routing quotes from 1inch or dFlow
- Execution still via demo router (deterministic)
- Shows "Powered by 1inch" or "Powered by dFlow" in messages

---

### Mode 4: ETH Testnet Session (One-Click UX)

**Use case:** Demonstrate one-time setup, then zero prompts

```bash
# agent/.env.local (add to Mode 2 config)

EXECUTION_AUTH_MODE=session
RELAYER_PRIVATE_KEY=0x... # Server-side relayer wallet
```

**Behavior:**
- First execution: user signs session + approval
- Subsequent executions: no wallet prompts (relayed)
- Same on-chain artifacts

---

## Deployment (Sepolia)

### Prerequisites

1. Foundry installed: `foundryup`
2. Sepolia testnet ETH (~0.1 ETH)
3. RPC URL (Infura or Alchemy)
4. Deployer private key (TEST WALLET ONLY)

### Deploy Contracts

```bash
cd contracts

# Set environment
export SEPOLIA_RPC_URL="https://sepolia.infura.io/v3/YOUR_KEY"
export DEPLOYER_PRIVATE_KEY="0xYOUR_PRIVATE_KEY"

# Deploy
./scripts/deploy-sepolia.sh
```

### Expected Output

```
=== Deployment Summary ===
ExecutionRouter: 0x...
MockSwapAdapter: 0x...
ERC20PullAdapter: 0x...
DEMO_REDACTED: 0x...
DEMO_WETH: 0x...
DemoSwapRouter: 0x...
UniswapV3SwapAdapter: 0x...
DemoLendVault: 0x...
DemoLendSupplyAdapter: 0x...
ProofOfExecutionAdapter: 0x...

Copy these addresses to your backend config.
```

### Copy to Backend

Copy all addresses to `agent/.env.local` as shown in Mode 2 config.

---

## Preflight Check

### Run Preflight

```bash
curl http://localhost:3001/api/execute/preflight | jq
```

### Expected Success Response

```json
{
  "mode": "eth_testnet",
  "ok": true,
  "chainId": 11155111,
  "router": "0x...",
  "adapter": "0x...",
  "rpc": true,
  "routing": {
    "mode": "hybrid",
    "liveRoutingEnabled": true,
    "hasApiKey": true,
    "executionMode": "demo"
  },
  "lending": {
    "enabled": true,
    "mode": "demo"
  },
  "dflow": {
    "enabled": false
  },
  "notes": [
    "Live routing: enabled (1inch)",
    "Swap execution: deterministic demo venue",
    "Lending: enabled (demo)"
  ]
}
```

### Interpret Preflight

| Field | Good | Bad |
|-------|------|-----|
| `ok` | `true` | `false` |
| `rpc` | `true` | `false` (check RPC URL) |
| `router` | `0x...` | `null` (deploy contracts) |
| `lending.enabled` | `true` | `false` (set vault addresses) |

---

## If Something Fails

### Decision Tree

```
Preflight returns ok:false?
├── rpc: false
│   └── Check ETH_TESTNET_RPC_URL is valid
├── router: null
│   └── Deploy contracts and set EXECUTION_ROUTER_ADDRESS
├── adapter not allowlisted
│   └── Redeploy contracts (script handles allowlisting)
└── notes contain errors
    └── Read notes[] for specific issue

Frontend shows "Preflight failed"?
├── Backend not running
│   └── cd agent && npm run dev
├── Wrong EXECUTION_MODE
│   └── Set EXECUTION_MODE=eth_testnet in agent/.env.local
└── Contract addresses not set
    └── Copy addresses from deployment output

Transaction fails on-chain?
├── "Router: adapter not allowed"
│   └── Adapter not allowlisted - redeploy
├── "ERC20: insufficient allowance"
│   └── Approval tx failed or skipped - retry
├── "ExecutionRouter: deadline exceeded"
│   └── Plan expired - prepare again
└── "Out of gas"
    └── Check wallet has ETH for gas
```

---

## Environment Variable Reference

### Required for ETH Testnet

| Variable | Description |
|----------|-------------|
| `EXECUTION_MODE` | `sim` or `eth_testnet` |
| `ETH_TESTNET_RPC_URL` | Sepolia RPC endpoint |
| `EXECUTION_ROUTER_ADDRESS` | Deployed router |
| `MOCK_SWAP_ADAPTER_ADDRESS` | Mock adapter |
| `ERC20_PULL_ADAPTER_ADDRESS` | Pull adapter |
| `DEMO_REDACTED_ADDRESS` | Demo REDACTED token |
| `DEMO_WETH_ADDRESS` | Demo WETH token |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `EXECUTION_AUTH_MODE` | `direct` or `session` | `direct` |
| `ROUTING_MODE` | `hybrid`, `dflow`, `deterministic` | `hybrid` |
| `DFLOW_ENABLED` | Enable dFlow provider | `false` |
| `BLOSSOM_MODEL_PROVIDER` | `openai`, `anthropic`, `gemini`, `stub` | `stub` |

---

## Demo Checklist

Before starting investor demo:

- [ ] Run `./scripts/demo-ready-check.sh` → READY
- [ ] Backend running (`cd agent && npm run dev`)
- [ ] Frontend running (`npm run dev`)
- [ ] Preflight returns `ok: true`
- [ ] Test wallet has Sepolia ETH
- [ ] Demo tokens minted (faucet or direct mint)
- [ ] AI provider configured (Gemini recommended)


