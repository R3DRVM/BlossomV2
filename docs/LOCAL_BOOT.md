# Local Boot Guide - MVP A

## Quick Start

### Prerequisites

- Node.js 20+ installed
- MetaMask installed (for wallet connection)
- Sepolia testnet ETH in wallet (for real swaps)

---

## Phase 0: Verification

### Servers Required

1. **Backend (Agent Service)**
   - Port: `3001` (default, configurable via `PORT` env var)
   - Command: `cd agent && npm run dev`
   - Health check: `GET http://localhost:3001/health`

2. **Frontend (Vite)**
   - Port: `5173` (Vite default)
   - Command: `npm run dev` (from project root)
   - URL: `http://localhost:5173`

### Access Gate Components

✅ **Frontend:**
- `src/components/AccessGate.tsx` - Access gate UI component
- `src/layouts/BlossomAppShell.tsx` - Mounts access gate (line 64)

✅ **Backend:**
- `agent/src/utils/accessGate.ts` - Access code management
- `agent/src/server/http.ts` - Middleware `checkAccess()` (line ~30)
- Endpoints:
  - `POST /api/access/validate` - Validate access code
  - `POST /api/access/check` - Check if user has access
  - `GET /api/access/codes` - List codes (admin)
  - `POST /api/access/codes/generate` - Generate codes (admin)

### Session Endpoints

✅ **Backend:**
- `POST /api/session/prepare` - Prepare session creation tx
- `POST /api/session/status` - Get session status
- `POST /api/session/revoke/prepare` - Prepare revocation tx
- `POST /api/execute/relayed` - Execute via session (relayed)

### Swap Execution (Route 2)

✅ **Backend:**
- `POST /api/execute/prepare` - Prepare swap plan (WRAP + SWAP)
- `POST /api/execute/relayed` - Execute relayed swap
- `GET /api/portfolio/eth_testnet` - Fetch real balances

✅ **Required Env Vars:**
- `EXECUTION_MODE=eth_testnet`
- `EXECUTION_AUTH_MODE=session`
- `EXECUTION_ROUTER_ADDRESS`
- `UNISWAP_V3_ADAPTER_ADDRESS`
- `WETH_WRAP_ADAPTER_ADDRESS`
- `WETH_ADDRESS_SEPOLIA`
- `REDACTED_ADDRESS_SEPOLIA`
- `ETH_TESTNET_RPC_URL`
- `RELAYER_PRIVATE_KEY`

---

## Phase 1: Environment Templates

### Backend Env Template

Create `agent/.env.local`:

```bash
# Execution mode
EXECUTION_MODE=eth_testnet
EXECUTION_AUTH_MODE=session

# Access gate
WHITELIST_ACCESS_CODES=  # Optional: comma-separated codes (or auto-generate 30)
ADMIN_KEY=REDACTED  # For generating/revoking codes

# ETH testnet contracts
EXECUTION_ROUTER_ADDRESS=0x...
UNISWAP_V3_ADAPTER_ADDRESS=0x...
WETH_WRAP_ADAPTER_ADDRESS=0x...
WETH_ADDRESS_SEPOLIA=0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14
REDACTED_ADDRESS_SEPOLIA=0x...

# RPC
ETH_TESTNET_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
RELAYER_PRIVATE_KEY=0x...  # Wallet with Sepolia ETH for gas

# LLM
BLOSSOM_MODEL_PROVIDER=gemini
BLOSSOM_GEMINI_API_KEY=your_key

# Optional
PORT=3001
DEBUG_EXECUTIONS=1
```

### Frontend Env Template

Create `.env.local` (project root):

```bash
# Backend connection
VITE_AGENT_API_URL=http://localhost:3001
VITE_USE_AGENT_BACKEND=true

# Execution mode
VITE_EXECUTION_MODE=eth_testnet
VITE_EXECUTION_AUTH_MODE=session
VITE_FUNDING_ROUTE_MODE=atomic

# RPC
VITE_ETH_TESTNET_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
```

---

## Phase 2: Boot Commands

### Terminal 1: Backend

```bash
cd agent

# Load env vars (if using .env.local, they load automatically)
# Or export manually:
export EXECUTION_MODE=eth_testnet
export EXECUTION_AUTH_MODE=session
export EXECUTION_ROUTER_ADDRESS=0x...
export UNISWAP_V3_ADAPTER_ADDRESS=0x...
export WETH_WRAP_ADAPTER_ADDRESS=0x...
export WETH_ADDRESS_SEPOLIA=0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14
export REDACTED_ADDRESS_SEPOLIA=0x...
export ETH_TESTNET_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
export RELAYER_PRIVATE_KEY=0x...
export BLOSSOM_MODEL_PROVIDER=gemini
export BLOSSOM_GEMINI_API_KEY=your_key
export ADMIN_KEY=your_admin_key
export PORT=3001

npm run dev
```

**Expected Output:**
```
🌸 Blossom Agent server running on http://localhost:3001
   API endpoints:
   - POST /api/chat
   - POST /api/execute/prepare
   - POST /api/execute/submit
   - POST /api/execute/relayed
   - POST /api/session/prepare
   - POST /api/session/status
   - GET  /api/portfolio/eth_testnet
   - GET  /api/prices/eth
   - POST /api/access/validate
   - POST /api/access/check
   - GET  /api/access/codes (admin)
   - POST /api/access/codes/generate (admin)
   - GET  /api/debug/executions
   - GET  /health
```

**Verify:**
```bash
curl http://localhost:3001/health
# Expected: {"status":"ok","service":"blossom-agent","llmProvider":"..."}
```

### Terminal 2: Frontend

```bash
# From project root
export VITE_AGENT_API_URL=http://localhost:3001
export VITE_USE_AGENT_BACKEND=true
export VITE_EXECUTION_MODE=eth_testnet
export VITE_EXECUTION_AUTH_MODE=session
export VITE_FUNDING_ROUTE_MODE=atomic
export VITE_ETH_TESTNET_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY

npm run dev
```

**Expected Output:**
```
  VITE v5.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

**Verify:**
- Open `http://localhost:5173`
- Access gate screen should appear

---

## Phase 3: Generate Access Code

### Generate Code (Admin)

```bash
curl -H "X-Admin-Key: your_admin_key" \
     -H "Content-Type: application/json" \
     -X POST http://localhost:3001/api/access/codes/generate \
     -d '{"count": 1}'
```

**Expected Response:**
```json
{
  "codes": [
    {
      "code": "ABCD1234",
      "used": false,
      "createdAt": 1234567890
    }
  ]
}
```

**Save the code** (e.g., `ABCD1234`) - you'll need it to unlock the app.

---

## Phase 4: User Flow Test

### Manual Checklist

1. **Open App:**
   - Navigate to `http://localhost:5173`
   - ✅ Access gate screen appears

2. **Enter Access Code:**
   - Enter the code from step above (e.g., `ABCD1234`)
   - Click "Continue"
   - ✅ App unlocks, main UI appears

3. **Connect Wallet:**
   - Click "Connect Wallet" button
   - Select MetaMask
   - Switch to Sepolia testnet (if not already)
   - ✅ Wallet connected

4. **Verify Real Balances:**
   - Check wallet card (top right)
   - ✅ Shows real ETH balance
   - ✅ Shows real WETH balance (if > 0)
   - ✅ Shows real REDACTED balance (if > 0)
   - ✅ Account value = sum of balances

5. **Create Session:**
   - Click "Create Session" button
   - MetaMask popup appears
   - Sign transaction
   - ✅ Session status shows "Active"

6. **Execute Swap:**
   - Send chat message: "Swap 0.01 ETH to WETH on Sepolia"
   - Click "Confirm Trade"
   - ✅ **No MetaMask popup** (relayed execution)
   - ✅ Transaction hash returned
   - ✅ Portfolio updated

7. **Test Mocked Executions:**
   - DeFi: "Deposit 1000 REDACTED into Kamino"
   - Perp: "Long BTC with 2% risk"
   - Event: "Bet YES on Fed cuts in March 2025 with $200"
   - ✅ All return `simulatedTxId`
   - ✅ Positions appear in portfolio

---

## Expected Outputs

### Backend Health Check

```bash
curl http://localhost:3001/health
```

**Expected:**
```json
{
  "status": "ok",
  "service": "blossom-agent",
  "llmProvider": "gemini"
}
```

### Access Code Generation

```bash
curl -H "X-Admin-Key: your_admin_key" \
     -H "Content-Type: application/json" \
     -X POST http://localhost:3001/api/access/codes/generate \
     -d '{"count": 1}'
```

**Expected:**
```json
{
  "codes": [
    {
      "code": "ABCD1234",
      "used": false,
      "createdAt": 1234567890
    }
  ]
}
```

### Access Validation

```bash
curl -X POST http://localhost:3001/api/access/validate \
     -H "Content-Type: application/json" \
     -d '{"code": "ABCD1234"}'
```

**Expected:**
```json
{
  "valid": true
}
```

### Portfolio Fetch

```bash
curl "http://localhost:3001/api/portfolio/eth_testnet?userAddress=0x..." \
     -H "X-Access-Code: ABCD1234"
```

**Expected:**
```json
{
  "chainId": 11155111,
  "userAddress": "0x...",
  "balances": {
    "eth": {
      "wei": "0x...",
      "formatted": "0.100000"
    },
    "usdc": {
      "raw": "0x...",
      "decimals": 6,
      "formatted": "0.00"
    },
    "weth": {
      "raw": "0x...",
      "decimals": 18,
      "formatted": "0.000000"
    }
  }
}
```

---

## Troubleshooting

### Backend Won't Start

- **Check:** Missing required env vars
- **Fix:** Add all required vars to `agent/.env.local`
- **Verify:** `curl http://localhost:3001/health`

### Frontend Can't Connect to Backend

- **Check:** `VITE_AGENT_API_URL` matches backend port
- **Fix:** Set `VITE_AGENT_API_URL=http://localhost:3001`
- **Verify:** Browser console shows API calls to correct URL

### Access Gate Always Shows

- **Check:** Access code not validated
- **Fix:** Generate code and enter it
- **Verify:** `localStorage.getItem('blossom_access_code')` in browser console

### Wallet Balances Not Showing

- **Check:** Wallet connected to Sepolia
- **Fix:** Switch MetaMask to Sepolia testnet
- **Verify:** `curl http://localhost:3001/api/portfolio/eth_testnet?userAddress=0x...`

### Session Creation Fails

- **Check:** `EXECUTION_ROUTER_ADDRESS` configured
- **Fix:** Add to `agent/.env.local`
- **Verify:** Backend logs show session prepare endpoint called

### Relayed Execution Fails

- **Check:** `RELAYER_PRIVATE_KEY` has Sepolia ETH
- **Fix:** Fund relayer wallet
- **Verify:** Session is active (`/api/session/status`)

---

## Code Changes Made

**None** - This is a read-only verification and documentation phase.

All components exist and are properly wired:
- ✅ Access gate component and integration
- ✅ Backend middleware and endpoints
- ✅ Session endpoints
- ✅ Swap execution (Route 2)
- ✅ Portfolio sync with real balances


