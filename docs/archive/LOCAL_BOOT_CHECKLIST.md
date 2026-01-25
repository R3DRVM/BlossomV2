# Local Boot Checklist - MVP A (No Gate)

## Prerequisites

- Node.js 20+ installed
- MetaMask installed (for wallet connection)
- Sepolia testnet ETH in wallet (for real swaps)
- Backend env vars configured (see below)

---

## Step 1: Verify Backend Setup

The backend is already configured with:
- ✅ `checkAccess` exported from `agent/src/utils/accessGate.ts`
- ✅ `maybeCheckAccess` middleware that bypasses gate when disabled
- ✅ All routes use `maybeCheckAccess` instead of `checkAccess`
- ✅ `loadAccessCodesFromEnv()` is safe (won't crash if disabled)

**No code changes needed** - backend is ready.

---

## Step 2: Verify Frontend Setup

The frontend is already configured with:
- ✅ `VITE_ACCESS_GATE_ENABLED` check in `BlossomAppShell.tsx`
- ✅ Skips AccessGate UI when disabled
- ✅ CSS @import moved to top of `src/index.css`

**No code changes needed** - frontend is ready.

---

## Step 3: Start Backend (Terminal A)

```bash
cd agent
ACCESS_GATE_ENABLED=false npm run dev
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
[accessGate] Access gate is disabled
```

**Keep this terminal running** - do not close it.

---

## Step 4: Start Frontend (Terminal B)

```bash
cd /Users/redrum/Desktop/Bloom
VITE_ACCESS_GATE_ENABLED=false npm run dev -- --host 127.0.0.1 --port 5173
```

**Expected Output:**
```
  VITE v5.x.x  ready in xxx ms

  ➜  Local:   http://127.0.0.1:5173/
  ➜  Network: use --host to expose
```

**Keep this terminal running** - do not close it.

---

## Step 5: Verify Backend Health

In a **new terminal** (Terminal C), run:

```bash
curl -s http://localhost:3001/health
```

**Expected Response:**
```json
{
  "status": "ok",
  "service": "blossom-agent",
  "llmProvider": "gemini"
}
```

---

## Step 6: Verify Portfolio Endpoint

```bash
curl -s "http://localhost:3001/api/portfolio/eth_testnet?userAddress=0x0000000000000000000000000000000000000000"
```

**Expected Response:**
```json
{
  "chainId": 11155111,
  "userAddress": "0x0000000000000000000000000000000000000000",
  "balances": {
    "eth": {
      "wei": "0x0",
      "formatted": "0.000000"
    },
    "usdc": {
      "raw": "0x0",
      "decimals": 6,
      "formatted": "0.00"
    },
    "weth": {
      "raw": "0x0",
      "decimals": 18,
      "formatted": "0.000000"
    }
  }
}
```

**Note:** Replace `0x0000...` with your actual wallet address for real balances.

---

## Step 7: Open Frontend in Browser

**URL:** http://127.0.0.1:5173

**Expected:**
- ✅ **No AccessGate screen** - main app loads directly
- ✅ Landing page or main UI visible
- ✅ No "Access code required" errors

---

## Step 8: Happy Path User Flow

### 8.1 Connect Wallet
1. Click "Connect Wallet" button
2. Select MetaMask
3. **Switch to Sepolia testnet** (if not already)
4. Approve connection
5. ✅ Wallet card shows real ETH/WETH/USDC balances

### 8.2 Create Session
1. Click "Create Session" button (if visible)
2. MetaMask popup appears
3. Sign the session creation transaction
4. ✅ Session status shows "Active"
5. ✅ No more MetaMask popups for subsequent executions (relayed mode)

### 8.3 Execute Swap
1. In chat, type: **"Swap 0.01 ETH to WETH on Sepolia"**
2. Click "Confirm Trade" or equivalent button
3. ✅ **No MetaMask popup** (execution is relayed via session)
4. ✅ Transaction hash appears
5. ✅ Portfolio updates automatically
6. ✅ Success message displayed

### 8.4 Verify Transaction
1. Click transaction hash to open Sepolia explorer
2. ✅ Transaction confirmed on-chain
3. ✅ Wallet balance updated (ETH decreased, WETH increased)

---

## Troubleshooting

### Backend Won't Start

**Error:** `ReferenceError: checkAccess is not defined`

**Fix:** Already fixed - `checkAccess` is imported from `accessGate.ts`. If you still see this:
1. Verify `agent/src/utils/accessGate.ts` exports `checkAccess`
2. Verify `agent/src/server/http.ts` imports it
3. Restart backend

**Error:** Missing env vars

**Fix:** Create `agent/.env.local` with required vars (see env checklist below)

---

### Frontend Shows AccessGate Screen

**Fix:** Ensure `VITE_ACCESS_GATE_ENABLED=false` is set when starting:
```bash
VITE_ACCESS_GATE_ENABLED=false npm run dev
```

**Verify:** Check browser console for env var value:
```javascript
console.log(import.meta.env.VITE_ACCESS_GATE_ENABLED) // Should be "false"
```

---

### Vite CSS Error: @import must precede all other statements

**Fix:** Already fixed - `@import` is at line 2 of `src/index.css` (after comment, before @tailwind)

**Verify:** Check `src/index.css` - first non-comment line should be the @import

---

### Backend Returns 401 on API Calls

**Error:** `{"error": "Access code required"}`

**Fix:** Ensure `ACCESS_GATE_ENABLED=false` when starting backend:
```bash
ACCESS_GATE_ENABLED=false npm run dev
```

**Verify:** Backend logs should show: `[accessGate] Access gate is disabled`

---

## Environment Variables Checklist

### Backend (`agent/.env.local`)

**Required:**
```bash
# Access Gate (disabled for local)
ACCESS_GATE_ENABLED=false

# Execution mode
EXECUTION_MODE=eth_testnet
EXECUTION_AUTH_MODE=session

# Contracts (fill in your deployed addresses)
EXECUTION_ROUTER_ADDRESS=0x...
UNISWAP_V3_ADAPTER_ADDRESS=0x...
WETH_WRAP_ADAPTER_ADDRESS=0x...
WETH_ADDRESS_SEPOLIA=0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14
USDC_ADDRESS_SEPOLIA=0x...

# RPC & Relayer
ETH_TESTNET_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
RELAYER_PRIVATE_KEY=0x...

# LLM
BLOSSOM_MODEL_PROVIDER=gemini
BLOSSOM_GEMINI_API_KEY=your_key

# Server
PORT=3001
```

**Optional:**
```bash
DEBUG_EXECUTIONS=1
```

### Frontend (`.env.local`)

**Required:**
```bash
# Access Gate (disabled for local)
VITE_ACCESS_GATE_ENABLED=false

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

## Summary

✅ **Backend:** Fixed - `checkAccess` imported, `maybeCheckAccess` bypasses gate when disabled  
✅ **Frontend:** Fixed - Skips AccessGate UI when `VITE_ACCESS_GATE_ENABLED=false`  
✅ **CSS:** Fixed - `@import` moved to top of `src/index.css`  

**Ready to boot!** Use the two-terminal commands above.


