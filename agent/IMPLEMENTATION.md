# Blossom Agent Implementation Status

## Phase 0: Import Otaku/Eliza Backend ✅

- Created `agent/` folder structure
- Set up TypeScript configuration
- Created package.json with minimal dependencies (no ElizaOS core yet for MVP)
- Branding updated to "Blossom Agent"

## Phase 1: Blossom Character & Types ✅

- Created `agent/src/types/blossom.ts` with:
  - `BlossomAction` type (perp/defi/event)
  - `BlossomPortfolioSnapshot` interface
- Created `agent/src/characters/blossom.ts` with character definition
- Created `agent/src/utils/actionParser.ts` for parsing model output

## Phase 2: Perps Simulation Plugin ✅

- Created `agent/src/plugins/perps-sim/`
- Implements:
  - `openPerp()` - Opens perp positions with risk-based sizing
  - `closePerp()` - Closes positions with deterministic PnL
  - `getPerpsSnapshot()` - Returns account state
  - Balance management with USDC tracking

## Phase 3: DeFi Simulation Plugin ✅

- Created `agent/src/plugins/defi-sim/`
- Implements:
  - `openDefiPosition()` - Deposits into yield vaults
  - `closeDefiPosition()` - Withdraws with yield calculation
  - `getDefiSnapshot()` - Returns DeFi state
  - Supports Kamino, RootsFi, Jet protocols

## Phase 4: Event Markets Simulation Plugin ✅

- Created `agent/src/plugins/event-sim/`
- Implements:
  - `openEventPosition()` - Opens event market positions
  - `closeEventPosition()` - Settles events with win/loss outcomes
  - `getEventSnapshot()` - Returns event state
  - Seeded markets: Fed cuts, BTC ETF, Generic

## Phase 5: HTTP API Server ✅

- Created `agent/src/server/http.ts`
- Endpoints:
  - `POST /api/chat` - Chat with Blossom, returns actions + portfolio
  - `POST /api/strategy/close` - Close a strategy
  - `GET /health` - Health check
- Integrates all three simulation plugins
- Builds unified portfolio snapshot

## Phase 6: Front-end Integration Points ✅

- Created `src/lib/blossomApi.ts` with:
  - `callBlossomChat()` function
  - `closeStrategy()` function
  - Type definitions matching backend
- Added TODO comments in:
  - `src/lib/mockParser.ts`
  - `src/context/BlossomContext.tsx`

## Next Steps

1. **LLM Integration**: Connect to OpenAI/Anthropic/OpenRouter for real natural language processing
2. **Structured Output**: Use JSON mode or function calling to get proper BlossomAction[] from LLM
3. **Front-end Wiring**: Replace mockParser calls with callBlossomChat() in Chat.tsx
4. **State Sync**: Ensure front-end BlossomContext stays in sync with backend portfolio
5. **Error Handling**: Add proper error handling and retry logic
6. **Testing**: Add unit tests for plugins and integration tests for API

## Running the Agent

```bash
cd agent
npm install
npm run dev:agent
```

Server runs on `http://localhost:3001` by default.

## Testing the API

```bash
# Test chat endpoint
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "userMessage": "Long ETH with 3% risk and manage liquidation.",
    "venue": "hyperliquid"
  }'

# Test close endpoint
curl -X POST http://localhost:3001/api/strategy/close \
  -H "Content-Type: application/json" \
  -d '{
    "strategyId": "some-id",
    "type": "perp"
  }'
```

