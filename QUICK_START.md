# Quick Start Guide

## 🚀 Services Running

### Backend Agent
- **URL**: http://localhost:3001
- **Status**: ✅ Running
- **Health Check**: http://localhost:3001/health

### Frontend React App
- **URL**: http://localhost:5173
- **Status**: ✅ Running
- **Mode**: Mock mode (no .env file = default mock behavior)

## 📝 Current Configuration

Since there's no `.env` file, the frontend is running in **mock mode**:
- Uses local `mockParser.ts` for message parsing
- All state managed locally
- No API calls to backend

## 🔄 To Enable Agent Mode

1. Create `.env` file in the root directory:
   ```bash
   VITE_USE_AGENT_BACKEND=true
   VITE_BLOSSOM_AGENT_URL=http://localhost:3001
   ```

2. Restart the frontend dev server (Ctrl+C and `npm run dev`)

3. The frontend will now:
   - Call `/api/chat` when you send messages
   - Use the backend LLM (if configured) or stub mode
   - Sync portfolio state from backend

## 🧪 Test the Backend

```bash
# Test health endpoint
curl http://localhost:3001/health

# Test chat endpoint (stub mode - no API keys needed)
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"userMessage": "Long ETH with 3% risk", "venue": "hyperliquid"}'
```

## 🛑 Stop Services

Press `Ctrl+C` in the terminal windows where the servers are running, or:

```bash
# Kill processes on ports
lsof -ti:3001 | xargs kill -9
lsof -ti:5173 | xargs kill -9
```

## 📚 Next Steps

1. **Open the frontend**: http://localhost:5173
2. **Try mock mode**: Send messages, create strategies (works without backend)
3. **Enable agent mode**: Create `.env` file and restart frontend
4. **Configure LLM** (optional): Add API keys to `agent/.env` for real AI responses

