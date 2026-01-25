# Frontend-Backend Integration Guide

## Overview

The React frontend is now wired to the Blossom agent backend. You can toggle between mock mode (existing behavior) and agent mode (real backend) using an environment variable.

## Configuration

### Environment Variables

Create a `.env` file in the root directory:

```bash
# Enable agent backend (set to 'true' to use real backend)
VITE_USE_AGENT_BACKEND=true

# Agent backend URL (default: http://localhost:3001)
VITE_BLOSSOM_AGENT_URL=http://localhost:3001
```

### Mock Mode (Default)

If `VITE_USE_AGENT_BACKEND` is not set or not `'true'`:
- Frontend uses `mockParser.ts` for message parsing
- All state is managed locally in `BlossomContext`
- No API calls are made
- Works exactly as before

### Agent Mode

If `VITE_USE_AGENT_BACKEND=true`:
- Frontend calls `/api/chat` when user sends a message
- Frontend calls `/api/strategy/close` when closing strategies
- Backend portfolio snapshot becomes the source of truth
- State is synced from backend responses

## How It Works

### 1. Sending Messages (Chat.tsx)

**Mock Mode:**
- Uses `parseUserMessage()` from `mockParser.ts`
- Creates strategies locally via `addDraftStrategy()`
- Updates account state locally

**Agent Mode:**
- Calls `callBlossomChat()` from `blossomApi.ts`
- Sends user message + current portfolio to backend
- Receives `assistantMessage` + `actions[]` + `portfolio`
- Updates frontend state via `updateFromBackendPortfolio()`

### 2. Closing Strategies (MessageBubble.tsx)

**Mock Mode:**
- Calls `closeStrategy()` or `closeEventStrategy()` from context
- Updates state locally

**Agent Mode:**
- Calls `closeStrategyApi()` from `blossomApi.ts`
- Sends `strategyId` + `type` to backend
- Receives updated portfolio
- Updates frontend state via `updateFromBackendPortfolio()`

### 3. Portfolio Mapping (portfolioMapping.ts)

The `mapBackendPortfolioToFrontendState()` function converts backend portfolio format to frontend state:

- **Backend format**: `BlossomPortfolioSnapshot` (from agent)
- **Frontend format**: `AccountState` + `Strategy[]` + `DefiPosition[]`

This ensures compatibility between backend and frontend data structures.

## Error Handling

### Agent Mode Errors

**Chat errors:**
- If `/api/chat` fails, shows error message: "I couldn't reach the agent backend..."
- No state changes are made
- User can retry

**Close errors:**
- If `/api/strategy/close` fails, shows alert with error message
- Button is disabled during request (`isClosing` state)
- No state changes on error

### Loading States

- **Chat**: `isTyping` indicator shows while waiting for response
- **Close**: Button shows "Closing..." and is disabled during request

## Testing

### 1. Start Backend Agent

```bash
cd agent
npm install
npm run dev:agent
```

Backend runs on `http://localhost:3001`

### 2. Start Frontend

```bash
# Mock mode (default)
npm run dev

# Agent mode
# Create .env file with VITE_USE_AGENT_BACKEND=true
npm run dev
```

### 3. Test Agent Mode

1. Set `VITE_USE_AGENT_BACKEND=true` in `.env`
2. Restart frontend dev server
3. Send a message in Copilot:
   - "Long ETH with 3% risk"
   - "Park half my idle USDC into safest yield on Kamino"
   - "Take YES on Fed cuts in March with 2% account risk"
4. Verify:
   - Response comes from backend LLM
   - Portfolio updates across all tabs
   - Strategies appear in Execution Queue
5. Close a strategy:
   - Click "Close & Take Profit" or "Close & settle this event"
   - Verify portfolio updates

### 4. Test Mock Mode

1. Remove or set `VITE_USE_AGENT_BACKEND=false` in `.env`
2. Restart frontend dev server
3. Verify existing behavior works as before

## Files Modified

- `src/lib/blossomApi.ts` - API client functions
- `src/lib/config.ts` - Feature flag
- `src/lib/portfolioMapping.ts` - Backend-to-frontend mapping
- `src/context/BlossomContext.tsx` - Added `updateFromBackendPortfolio()`
- `src/components/Chat.tsx` - Agent mode message handling
- `src/components/MessageBubble.tsx` - Agent mode close handling
- `src/vite-env.d.ts` - TypeScript env types

## Architecture

```
User sends message
  ↓
Chat.tsx: handleSend()
  ↓
USE_AGENT_BACKEND?
  ├─ true → callBlossomChat() → Backend LLM → updateFromBackendPortfolio()
  └─ false → parseUserMessage() → Local mock → addDraftStrategy()

User closes strategy
  ↓
MessageBubble.tsx: onClick handler
  ↓
USE_AGENT_BACKEND?
  ├─ true → closeStrategyApi() → Backend → updateFromBackendPortfolio()
  └─ false → closeStrategy() → Local state update
```

## Notes

- Backend portfolio is always the source of truth in agent mode
- Frontend state is overwritten on each backend response
- Mock mode remains fully functional for development/testing
- No breaking changes to existing UI/UX

