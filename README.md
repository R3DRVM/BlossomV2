# Blossom

Blossom is an AI execution layer that abstracts chains, venues, and assets. Users express trading intent in natural language (e.g., "Long BTC with 20× leverage"), and Blossom generates an execution plan and routes across the optimal venue/chain path based on fees and slippage, handling asset conversion and approvals automatically.

## What This Demo Shows

This demo simulates Blossom's end-to-end execution flow to communicate the product vision. The simulation demonstrates:

- Natural language intent parsing and strategy generation
- Multi-venue routing optimization (perpetuals, event markets, DeFi)
- Risk-adjusted position sizing and leverage management
- Real-time portfolio tracking and risk monitoring
- Cross-chain execution abstraction

**Simulation Boundaries:** All routing decisions, venue selection, slippage estimates, and settlement times are simulated for demonstration purposes. Production integrations with live venues and chains are required for real execution.

## Getting Started

### Prerequisites

- Node.js 18+ and npm

### Installation

```bash
# Install dependencies for both frontend and agent
npm run install:all
```

### Development

**Live Prices in Dev:**

To enable live price feeds from CoinGecko via the agent backend:

1. Create `.env.local` at the repo root (this file is gitignored):
   ```bash
   VITE_USE_AGENT_BACKEND=true
   VITE_AGENT_API_URL=http://localhost:3001
   ```

2. Start both frontend and agent services:
   ```bash
   npm run dev:all
   ```

This will:
- Start the frontend dev server on `http://localhost:5173`
- Start the agent service on `http://localhost:3001`
- Enable live price feeds for BTC/ETH/SOL/AVAX/LINK from CoinGecko
- Enable live event markets if `KALSHI_API_URL`/`KALSHI_API_KEY` or `POLYMARKET_API_URL` are configured

**Without `.env.local`:**

If `.env.local` is not present, the app runs in mock mode with static demo data. The ticker will show "Static (demo)" and prices will not update.

**Individual Services:**

```bash
# Frontend only (mock mode)
npm run dev

# Agent only
npm run dev:agent
```

The frontend runs on `http://localhost:5173` by default. The agent service runs on `http://localhost:3001`.

### Production Build

```bash
npm run build
```

### Verification

Before manual testing, run the automated verification script to ensure everything is configured correctly:

```bash
# Basic verification (contracts, builds, endpoints)
# Note: Backend must be running separately
./scripts/mvp-verify.sh

# Auto-start backend if not running (recommended for first-time users)
./scripts/mvp-verify.sh --start-backend

# With testnet checks (requires EXECUTION_MODE=eth_testnet)
EXECUTION_MODE=eth_testnet ./scripts/mvp-verify.sh --start-backend

# With portfolio endpoint test
EXECUTION_MODE=eth_testnet TEST_USER_ADDRESS=0xYOUR_ADDRESS ./scripts/mvp-verify.sh --start-backend
```

The script will:
- ✅ Run contract tests (`forge test`)
- ✅ Build frontend and backend
- ✅ Check backend health (or auto-start with `--start-backend`)
- ✅ Run endpoint smoke tests
- ✅ Verify testnet readiness (if `EXECUTION_MODE=eth_testnet`)
- ✅ Provide a clear report of remaining manual steps

### E2E Sepolia Smoke Test

For a more comprehensive test of the Sepolia execution flow without UI:

```bash
# Set required environment variables
export EXECUTION_MODE=eth_testnet
export TEST_USER_ADDRESS=0xYOUR_ADDRESS
export EXECUTION_AUTH_MODE=direct  # or 'session'

# Run E2E smoke test (dry-run, no transactions sent)
node agent/scripts/e2e-sepolia-smoke.ts

# With session mode
EXECUTION_AUTH_MODE=session node agent/scripts/e2e-sepolia-smoke.ts

# Actually relay transactions (session mode only, requires RELAYER_PRIVATE_KEY)
EXECUTION_AUTH_MODE=session node agent/scripts/e2e-sepolia-smoke.ts --actually-relay
```

The E2E script will:
- ✅ Test `/health` endpoint
- ✅ Test `/api/execute/preflight`
- ✅ Test `/api/portfolio/eth_testnet`
- ✅ Test `/api/execute/prepare` with swap intent
- ✅ Test `/api/token/approve/prepare` if approval needed
- ✅ Test `/api/session/prepare` if in session mode
- ✅ Print transaction payloads (dry-run by default)

**Quickstart (Mac):**

1. Install dependencies:
   ```bash
   npm run install:all
   ```

2. Start backend (in one terminal):
   ```bash
   cd agent && npm run dev
   ```

3. Run verification (in another terminal):
   ```bash
   ./scripts/mvp-verify.sh
   ```

   Or use auto-start:
   ```bash
   ./scripts/mvp-verify.sh --start-backend
   ```

4. Expected output:
   ```
   ✔ All automated checks PASSED
   ```

See `MANUAL_TESTING_CHECKLIST.md` for complete testing guide.

## Demo Flows

Try these example prompts to explore Blossom's capabilities:

1. **Basic Perpetual Position**
   - "Long BTC with 3% risk at 10× leverage"
   - "Short ETH with 2% account risk"

2. **Multi-Position Portfolio**
   - "Long BTC with 2% risk"
   - "Long ETH with 2% risk" (creates second position)

3. **Risk-Adjusted Sizing**
   - "Long BTC with $1,000 margin at 20× leverage"
   - "Open a position using my entire portfolio"

4. **Event Markets**
   - "Bet $500 that BTC will be above $100k by end of month"

5. **Position Management**
   - "Update BTC leverage to 5×"
   - "Close my ETH position"

## Architecture

**Frontend:**
- React + TypeScript + Vite
- TailwindCSS for styling
- React Context API for global state

**Backend Agent (Optional):**
- Express.js HTTP server on port 3001
- Live price feeds from CoinGecko API (BTC/ETH/SOL/AVAX/LINK)
- Event market integration (Kalshi/Polymarket) when API keys are configured in `.env.local`
- Simulation plugins for perps, DeFi, and event markets
- LLM integration for natural language processing

## Project Structure

```
├── src/                    # React frontend
│   ├── components/         # UI components
│   ├── context/           # Global state management
│   └── lib/              # Utilities and API client
├── agent/                 # Backend agent service (optional)
└── package.json
```

## Disclaimer

This is a demonstration prototype. All trading data, routing decisions, venue quotes, and execution outcomes are simulated. Production deployment requires integration with live trading venues, chain infrastructure, and risk management systems.
