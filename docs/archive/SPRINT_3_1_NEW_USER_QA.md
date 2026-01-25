# Sprint 3.1: New-User "Wow" QA Script

**Purpose**: Step-by-step guide for non-developers to verify dFlow routing works correctly

## Fresh User Setup

### 1. Clear Browser State
```bash
# Open browser in incognito/private mode
# OR clear localStorage manually:
# In browser console: localStorage.clear(); location.reload();
```

### 2. Start Services
```bash
# Terminal 1: Backend
cd agent
npm run dev

# Terminal 2: Frontend
cd ..  # (back to root)
npm run dev

# Wait for both to start (backend shows "Server listening on port 3001")
```

### 3. Verify Backend Health
```bash
curl -s http://localhost:3001/health | jq .
# Expected: { "ok": true, "executionMode": "eth_testnet", ... }
```

## Test A: "Show top prediction markets"

### Steps:
1. Open browser: `http://localhost:5173`
2. Connect MetaMask wallet (Sepolia testnet)
3. In chat, type: **"Show me top prediction markets"**
4. Press Enter

### What You Should See:

**In Chat UI:**
- Assistant message: "Here are the top X prediction markets by volume right now:"
- List of markets with titles and probabilities

**In Browser Console (F12 → Console):**
- Look for: `[ROUTING] kind=event_markets source=dflow latencyMs=... corr=...`
  OR
- Look for: `[ROUTING] kind=event_markets source=fallback latencyMs=... corr=...`

**In Network Tab (F12 → Network):**
1. Find the request to `/api/chat`
2. Click on it → Response tab
3. Look for `routing` field in JSON:
```json
{
  "routing": {
    "source": "dflow" | "fallback",
    "kind": "event_markets",
    "ok": true,
    "latencyMs": 123,
    "mode": "hybrid" | "deterministic" | "dflow",
    "correlationId": "markets-1234567890-abc123"
  }
}
```

### Expected Routing Metadata:
- ✅ `source`: Either `"dflow"` (if dFlow worked) or `"fallback"` (if dFlow failed/unavailable)
- ✅ `kind`: `"event_markets"`
- ✅ `ok`: `true` (if markets were returned)
- ✅ `latencyMs`: Number (milliseconds, e.g., `150`)
- ✅ `mode`: Current ROUTING_MODE (`"hybrid"`, `"deterministic"`, or `"dflow"`)
- ✅ `correlationId`: String starting with `"markets-"`

### How to Share for Debugging:
- Copy the `correlationId` from the response
- Share it with developers: "correlationId: markets-1234567890-abc123"
- Developers can search backend logs for this ID

## Test B: "Swap 0.01 ETH to WETH"

### Steps:
1. In chat, type: **"Swap 0.01 ETH to WETH"**
2. Press Enter
3. Wait for execution plan card to appear
4. Click **"Execute"** button

### What You Should See:

**In Chat UI:**
- Execution plan card showing swap details
- After execution: Transaction hash message (if successful)
- Or error message if execution failed

**In Browser Console:**
- Look for: `[ROUTING] kind=swap_quote source=dflow latencyMs=... corr=...`
  OR
- Look for: `[ROUTING] kind=swap_quote source=fallback latencyMs=... corr=...`

**In Network Tab:**
1. Find the request to `/api/execute/prepare`
2. Click on it → Response tab
3. Look for `routing` field (may be nested):
```json
{
  "routing": {
    "venue": "...",
    "chain": "Sepolia",
    "routingSource": "dflow" | "deterministic" | "uniswap",
    "routing": {
      "source": "dflow" | "fallback",
      "kind": "swap_quote",
      "ok": true,
      "latencyMs": 200,
      "mode": "hybrid",
      "correlationId": "swap-1234567890-xyz789"
    }
  }
}
```

### Expected Routing Metadata:
- ✅ `routing.routing.source`: Either `"dflow"` or `"fallback"`
- ✅ `routing.routing.kind`: `"swap_quote"`
- ✅ `routing.routing.ok`: `true` (if quote was successful)
- ✅ `routing.routing.latencyMs`: Number
- ✅ `routing.routing.mode`: Current ROUTING_MODE
- ✅ `routing.routing.correlationId`: String starting with `"swap-"`

### How to Share for Debugging:
- Copy the `correlationId` from `routing.routing.correlationId`
- Share: "correlationId: swap-1234567890-xyz789"

## Test C: Force Fallback Mode (Graceful Degrade)

### Steps:
1. Stop backend (Ctrl+C in Terminal 1)
2. Set environment variable: `DFLOW_FORCE_FAIL=true`
3. Restart backend:
```bash
cd agent
DFLOW_FORCE_FAIL=true npm run dev
```
4. Repeat Test A and Test B

### What You Should See:

**In Browser Console:**
- `[ROUTING] kind=event_markets source=fallback latencyMs=... corr=...`
- `[ROUTING] kind=swap_quote source=fallback latencyMs=... corr=...`

**In Network Tab:**
- `routing.source`: `"fallback"`
- `routing.reason`: Contains `"forced_fail"` or `"dFlow failed: ..."`

### Expected Behavior:
- ✅ Markets still appear (from Polymarket fallback)
- ✅ Swap quotes still work (from Uniswap/1inch fallback)
- ✅ Routing metadata shows `source="fallback"` with reason
- ✅ No errors in UI (graceful degradation)

## Verification Checklist

After running all tests, verify:

- [ ] Event markets request includes `routing` metadata with all required fields
- [ ] Swap quote request includes `routing.routing` metadata with all required fields
- [ ] Console shows `[ROUTING]` logs for each request
- [ ] Correlation IDs are present and unique for each request
- [ ] Fallback mode works without errors
- [ ] No API keys appear in responses (check Network tab responses)

## Troubleshooting

### "No routing metadata in response"
- Check if request actually went through routing service
- Some requests may bypass routing (e.g., cached responses)
- Try a fresh request with a unique message

### "correlationId not found"
- Check browser console for `[ROUTING]` logs
- correlationId is logged in console even if not in response
- Backend logs will also contain correlationId

### "dFlow not working"
- Check backend logs for dFlow errors
- Verify `DFLOW_ENABLED=true` in `agent/.env.local`
- Verify `DFLOW_API_KEY` is set (but never appears in responses)
- Check preflight: `curl -s http://localhost:3001/api/execute/preflight | jq .dflow`

## Quick Reference: Routing Metadata Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `source` | string | Routing source used | `"dflow"` or `"fallback"` |
| `kind` | string | Type of routing request | `"swap_quote"` or `"event_markets"` |
| `ok` | boolean | Whether routing succeeded | `true` or `false` |
| `reason` | string? | Fallback reason (if source=fallback) | `"dFlow failed: timeout"` |
| `latencyMs` | number | Request latency in milliseconds | `150` |
| `mode` | string | Current ROUTING_MODE | `"hybrid"`, `"deterministic"`, `"dflow"` |
| `correlationId` | string | Unique request ID for debugging | `"markets-1234567890-abc123"` |
