# Demo Operator Quickstart

**Purpose:** One-command startup and troubleshooting guide for investor demos.

---

## Quick Start (One Command)

```bash
./scripts/restart-demo.sh
```

Or manually:
```bash
npm run dev:demo
```

This starts both frontend and backend together. You'll see:
- Frontend: http://localhost:5173
- Backend: http://127.0.0.1:3001
- Health check: http://127.0.0.1:3001/health

**Press Ctrl+C to stop both.**

### Verify Backend is Running

```bash
curl -s http://127.0.0.1:3001/health
```

Expected response:
```json
{"ok":true,"ts":1234567890,"service":"blossom-agent"}
```

If you see `RPC_NOT_CONFIGURED` in the UI:
1. Open `agent/.env.local`
2. Set `ETH_TESTNET_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY`
3. Restart backend: `cd agent && npm run dev`

---

## Prerequisites

### 1. Install Dependencies

```bash
npm run install:all
```

This installs dependencies for both root and `agent/` directory.

### 2. Environment Variables

Create `agent/.env.local` with:

```bash
# Execution Mode
EXECUTION_MODE=eth_testnet
EXECUTION_AUTH_MODE=direct  # or 'session' for one-click mode

# RPC
ETH_TESTNET_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
ETH_TESTNET_CHAIN_ID=11155111

# Contracts (from deployment)
EXECUTION_ROUTER_ADDRESS=0x...
MOCK_SWAP_ADAPTER_ADDRESS=0x...
# ... (see DEMO_OPERATOR_CHECKLIST.md for full list)

# LLM (optional - stub works for testing)
BLOSSOM_MODEL_PROVIDER=stub
```

---

## Manual Startup (If Needed)

**Terminal 1 - Backend:**
```bash
cd agent
PORT=3001 npm run dev
```

**Terminal 2 - Frontend:**
```bash
npm run dev
```

---

## Verify Backend is Running

```bash
./scripts/check-backend.sh
```

**Expected output:**
```
✅ Backend is healthy
{
  "ok": true,
  "ts": 1704307200000,
  "service": "blossom-agent"
}
```

**If backend is offline:**
```
❌ Backend is not reachable

To start the backend:
  npm run dev:demo
```

---

## Troubleshooting

### Issue: `/health` fails

**Symptoms:**
- `curl http://127.0.0.1:3001/health` returns connection refused
- Frontend shows "Backend Offline" banner

**Fix:**
1. Check if backend process is running: `ps aux | grep "tsx.*http.ts"`
2. If not running, start it: `npm run dev:demo`
3. Check backend logs for errors
4. Verify PORT is not already in use: `lsof -i :3001`

### Issue: Frontend shows "Backend Offline" but backend is running

**Symptoms:**
- Backend responds to `curl http://127.0.0.1:3001/health`
- Frontend still shows offline banner

**Fix:**
1. Check `VITE_AGENT_BASE_URL` in frontend (should be unset or `http://127.0.0.1:3001`)
2. Check browser console for CORS errors
3. Verify backend is binding to `0.0.0.0` (check startup logs)
4. Try hard refresh: `Cmd+Shift+R` (Mac) or `Ctrl+Shift+R` (Windows/Linux)

### Issue: Request spam / ERR_CONNECTION_REFUSED floods

**Symptoms:**
- Browser console shows repeated connection refused errors
- Network tab shows many failed requests

**Fix:**
1. This should be fixed - the health gate blocks all requests when backend is offline
2. If still happening, check that `src/lib/apiClient.ts` has the health gate
3. Verify `BlossomContext` stops polling when `isBackendHealthy()` is false

### Issue: Wallet connects but balance shows $0.00

**Symptoms:**
- MetaMask shows ETH balance
- Blossom shows $0.00

**Fix:**
1. Check backend logs for `/api/wallet/balances` calls
2. Verify `ETH_TESTNET_RPC_URL` is correct and reachable
3. Check browser console for balance fetch errors
4. Click refresh icon (↻) next to balance
5. Verify wallet is on Sepolia network (chainId 11155111)

### Issue: Backend crashes on startup

**Symptoms:**
- Backend starts then immediately exits
- Error in console about missing env vars

**Fix:**
1. Check `agent/.env.local` exists and has required vars
2. Verify `EXECUTION_MODE` is set (defaults to 'sim' if missing)
3. For eth_testnet mode, ensure `ETH_TESTNET_RPC_URL` is set
4. Check backend logs for specific error message

---

## Environment Variable Reference

### Required for eth_testnet mode

| Variable | Description | Example |
|----------|-------------|---------|
| `EXECUTION_MODE` | `sim` or `eth_testnet` | `eth_testnet` |
| `ETH_TESTNET_RPC_URL` | Sepolia RPC endpoint | `https://sepolia.infura.io/v3/...` |
| `ETH_TESTNET_CHAIN_ID` | Sepolia chain ID | `11155111` |
| `EXECUTION_ROUTER_ADDRESS` | Deployed router | `0x...` |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Backend port | `3001` |
| `HOST` | Backend bind address | `0.0.0.0` |
| `EXECUTION_AUTH_MODE` | `direct` or `session` | `direct` |
| `BLOSSOM_MODEL_PROVIDER` | `stub`, `gemini`, `openai`, `anthropic` | `stub` |
| `VITE_AGENT_BASE_URL` | Frontend API base URL | `http://127.0.0.1:3001` |

---

## Health Check Endpoints

| Endpoint | Purpose | Dependencies |
|----------|---------|--------------|
| `GET /health` | Simple health check | None (always works) |
| `GET /api/health` | Extended health with LLM info | None |
| `GET /api/execute/preflight` | Full config validation | Chain config required |

**Use `/health` for basic connectivity checks.**

---

## Demo Readiness Checklist

Before investor demo:

- [ ] Run `npm run dev:demo` - both services start
- [ ] Run `./scripts/check-backend.sh` - returns ✅
- [ ] Run `./scripts/demo-ready-check.sh` - all checks pass
- [ ] Open http://localhost:5173/app
- [ ] Connect wallet (Sepolia)
- [ ] Verify ETH balance displays (not $0.00)
- [ ] Test swap flow: "Swap 100 USDC to WETH"
- [ ] Verify tx appears on Etherscan

---

## Next Steps

- See `BEGINNER_TEST_GUIDE.md` for step-by-step testing
- See `DEMO_OPERATOR_CHECKLIST.md` for full configuration guide
- See `MANUAL_INVESTOR_TEST_SCRIPT.md` for user-facing test script

