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
