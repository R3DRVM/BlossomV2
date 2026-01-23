# Local Boot Commands - MVP A (No Gate)

## Exact Two-Terminal Commands

### Terminal A: Backend

```bash
cd /Users/redrum/Desktop/Bloom/agent
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

**Keep this terminal running** - do not close or kill it.

---

### Terminal B: Frontend

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

**Keep this terminal running** - do not close or kill it.

---

## Verification Commands

### Check Backend Health

```bash
curl -s http://localhost:3001/health
```

**Expected:**
```json
{"status":"ok","service":"blossom-agent","llmProvider":"gemini"}
```

### Check Portfolio Endpoint

```bash
curl -s "http://localhost:3001/api/portfolio/eth_testnet?userAddress=0x0000000000000000000000000000000000000000"
```

**Expected:** JSON with balances (all zeros for dummy address)

---

## Browser URLs

**Frontend:** http://127.0.0.1:5173

**Expected:**
- ✅ No AccessGate screen
- ✅ Main app loads directly
- ✅ Can connect wallet

---

## Happy Path User Flow

1. **Open:** http://127.0.0.1:5173
2. **Connect Wallet:** Click "Connect Wallet" → MetaMask → Switch to Sepolia
3. **Create Session:** Click "Create Session" → Sign transaction
4. **Swap:** Type "Swap 0.01 ETH to WETH on Sepolia" → Click "Confirm Trade"
5. **Verify:** Transaction hash appears, portfolio updates, no MetaMask popup (relayed)

---

## Fixes Applied

✅ **Backend:** `checkAccess` imported and `maybeCheckAccess` implemented  
✅ **Frontend:** Skips AccessGate when `VITE_ACCESS_GATE_ENABLED=false`  
✅ **CSS:** `@import` moved to line 1 (before any comments)  

**Both servers should stay running without crashes.**


