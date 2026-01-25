# BlossomV2 Deployment Checklist

## Overview

- **Frontend**: Vite + React (deploy to Vercel)
- **Backend**: Node.js Express server (deploy to Railway)

---

## 1. RAILWAY (Backend)

### Configuration

| Setting | Value |
|---------|-------|
| **Root Directory** | `agent` |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm start` |
| **Node Version** | `20.x` (or latest LTS) |

### Environment Variables

| Variable | Example Value | Required | Description |
|----------|---------------|----------|-------------|
| `PORT` | `3001` | ✅ Auto-set by Railway | Server port (Railway sets this automatically) |
| `BLOSSOM_MODEL_PROVIDER` | `openai` or `anthropic` or `stub` | ❌ Optional | LLM provider. Defaults to `stub` if not set |
| `BLOSSOM_OPENAI_API_KEY` | `sk-...` | ⚠️ If using OpenAI | Required if `BLOSSOM_MODEL_PROVIDER=openai` |
| `BLOSSOM_OPENAI_MODEL` | `gpt-4o-mini` | ❌ Optional | OpenAI model. Defaults to `gpt-4o-mini` |
| `BLOSSOM_ANTHROPIC_API_KEY` | `sk-ant-...` | ⚠️ If using Anthropic | Required if `BLOSSOM_MODEL_PROVIDER=anthropic` |
| `BLOSSOM_ANTHROPIC_MODEL` | `claude-3-5-sonnet-20241022` | ❌ Optional | Anthropic model. Defaults to `claude-3-5-sonnet-20241022` |
| `KALSHI_API_URL` | `https://api.kalshi.com` | ❌ Optional | For real Kalshi integration (not used in demo) |
| `KALSHI_API_KEY` | `...` | ❌ Optional | For real Kalshi integration (not used in demo) |
| `POLYMARKET_API_URL` | `https://clob.polymarket.com` | ❌ Optional | For real Polymarket integration (not used in demo) |

### Health Check

**Endpoint**: `GET /health`

**Expected Response**:
```json
{
  "status": "ok",
  "service": "blossom-agent"
}
```

**Test URL**: `https://your-railway-app.up.railway.app/health`

### API Endpoints

- `POST /api/chat` - Chat with Blossom agent
- `POST /api/strategy/close` - Close a strategy
- `POST /api/reset` - Reset simulation state
- `GET /api/ticker?venue=hyperliquid` - Get ticker data
- `GET /health` - Health check

### Notes

- Railway automatically sets `PORT` environment variable
- Backend runs in "stub" mode (no real LLM) if no API keys are provided
- All endpoints use CORS and accept JSON
- No WebSockets or long-running streams

---

## 2. VERCEL (Frontend)

### Configuration

| Setting | Value |
|---------|-------|
| **Framework Preset** | `Vite` |
| **Build Command** | `npm install && npm run build` |
| **Output Directory** | `dist` |
| **Install Command** | `npm install` (default) |
| **Node Version** | `20.x` (or latest LTS) |

### Environment Variables

| Variable | Example Value | Required | Description |
|----------|---------------|----------|-------------|
| `VITE_AGENT_API_URL` | `https://your-railway-app.up.railway.app` | ❌ Optional | Backend API URL. Defaults to `http://localhost:3001` for local dev |
| `VITE_USE_AGENT_BACKEND` | `true` | ❌ Optional | Set to `true` to use backend. Defaults to mock mode if not set |

### Where Variables Are Used

- **`VITE_AGENT_API_URL`**: Used in `src/lib/apiClient.ts` - base URL for all API calls
- **`VITE_USE_AGENT_BACKEND`**: Used in `src/lib/config.ts` - feature flag to enable/disable backend mode

### Build Output

- Static files in `dist/`
- `dist/index.html` is the entry point
- All assets are bundled and optimized by Vite

### Notes

- Frontend works in mock mode if `VITE_USE_AGENT_BACKEND` is not set
- CORS is handled by the backend (allows all origins)
- No server-side rendering (pure static site)

---

## 3. Deployment Steps

### Step 1: Deploy Backend to Railway

1. Connect your GitHub repo to Railway
2. Create a new service
3. Set **Root Directory** to `agent`
4. Set **Build Command** to `npm install && npm run build`
5. Set **Start Command** to `npm start`
6. Add environment variables (see Railway section above)
7. Deploy and note the Railway URL (e.g., `https://blossom-agent.up.railway.app`)

### Step 2: Test Backend

1. Visit `https://your-railway-app.up.railway.app/health`
2. Should return `{"status":"ok","service":"blossom-agent"}`
3. Test a chat endpoint (optional):
   ```bash
   curl -X POST https://your-railway-app.up.railway.app/api/chat \
     -H "Content-Type: application/json" \
     -d '{"userMessage":"test","venue":"hyperliquid"}'
   ```

### Step 3: Deploy Frontend to Vercel

1. Connect your GitHub repo to Vercel
2. Set **Framework Preset** to `Vite`
3. Set **Root Directory** to `.` (root of repo)
4. Set **Build Command** to `npm install && npm run build`
5. Set **Output Directory** to `dist`
6. Add environment variables:
   - `VITE_AGENT_API_URL` = Your Railway backend URL
   - `VITE_USE_AGENT_BACKEND` = `true`
7. Deploy

### Step 4: Verify Integration

1. Visit your Vercel frontend URL
2. Navigate to `/app` (the demo)
3. Send a message in the chat
4. Verify it calls the backend (check Network tab in DevTools)
5. Verify response appears in the UI

---

## 4. Environment Variable Summary

### Backend (Railway) - Required for Demo Mode

**Minimum (Stub Mode - No Real AI)**:
- None required! Backend runs in stub mode by default.

**For Real AI (OpenAI)**:
- `BLOSSOM_MODEL_PROVIDER=openai`
- `BLOSSOM_OPENAI_API_KEY=sk-...`

**For Real AI (Anthropic)**:
- `BLOSSOM_MODEL_PROVIDER=anthropic`
- `BLOSSOM_ANTHROPIC_API_KEY=sk-ant-...`

### Frontend (Vercel) - Required for Backend Mode

**Minimum (Mock Mode)**:
- None required! Frontend uses mock parser by default.

**For Backend Integration**:
- `VITE_USE_AGENT_BACKEND=true`
- `VITE_AGENT_API_URL=https://your-railway-app.up.railway.app`

---

## 5. Caveats & Notes

### No Special Config Needed

- ✅ No WebSockets
- ✅ No long-running streams
- ✅ No server-sent events
- ✅ Standard HTTP REST API
- ✅ CORS handled by backend

### Stub Mode

- Backend runs in "stub" mode if no LLM API keys are provided
- Returns canned responses but still processes requests
- Useful for testing deployment without API costs

### Mock Mode

- Frontend runs in "mock" mode if `VITE_USE_AGENT_BACKEND` is not set
- Uses local `mockParser.ts` for message parsing
- No backend calls are made

---

## 6. Quick Test Commands

### Test Backend Health
```bash
curl https://your-railway-app.up.railway.app/health
```

### Test Backend Chat (Stub Mode)
```bash
curl -X POST https://your-railway-app.up.railway.app/api/chat \
  -H "Content-Type: application/json" \
  -d '{"userMessage":"Long ETH with 3% risk","venue":"hyperliquid"}'
```

### Test Backend Chat (With OpenAI)
```bash
# Set BLOSSOM_MODEL_PROVIDER=openai and BLOSSOM_OPENAI_API_KEY in Railway first
curl -X POST https://your-railway-app.up.railway.app/api/chat \
  -H "Content-Type: application/json" \
  -d '{"userMessage":"Long ETH with 3% risk","venue":"hyperliquid"}'
```

---

## 7. Troubleshooting

### Backend Issues

- **Port not found**: Railway sets `PORT` automatically, don't override it
- **Build fails**: Check Node version (should be 20.x or latest LTS)
- **Health check fails**: Verify `npm start` works locally first

### Frontend Issues

- **API calls fail**: Check `VITE_AGENT_API_URL` is set correctly
- **CORS errors**: Backend should allow all origins (already configured)
- **Build fails**: Check Node version and ensure all dependencies install

### Integration Issues

- **Frontend shows mock mode**: Set `VITE_USE_AGENT_BACKEND=true`
- **Backend returns stub responses**: Add LLM API keys if you want real AI
- **Network errors**: Verify Railway URL is accessible and health check works

