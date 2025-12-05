# Blossom V2 - AI Trading Copilot

A ChatGPT-style interface for AI-powered trading strategies, risk management, and DeFi actions.

## Features

- **Copilot Chat**: Natural language interface for creating trading strategies
- **Risk Center**: Real-time risk monitoring and exposure tracking
- **Portfolio View**: Performance analytics and strategy breakdown
- **Multi-Venue Support**: 
  - Hyperliquid (Perpetuals)
  - Event Markets (Demo)
- **DeFi Integration**: Yield farming and DeFi position management
- **Strategy Lifecycle**: Draft → Queued → Executing → Executed → Closed
- **Backend Agent Service**: Simulated trading engine with perps, DeFi, and event markets

## Tech Stack

**Frontend:**
- React + TypeScript
- Vite
- TailwindCSS
- React Context API for state management

**Backend Agent:**
- Express.js HTTP server
- Simulation plugins for perps, DeFi, and event markets
- TypeScript

## Getting Started

### Frontend Only (Mock Mode)

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

### With Backend Agent

```bash
# Install all dependencies (frontend + agent)
npm run install:all

# Start both frontend and agent
npm run dev:all

# Or start separately:
npm run dev          # Frontend only
npm run dev:agent    # Agent only
```

The agent runs on `http://localhost:3001` by default.

## Project Structure

```
├── src/                    # React frontend
│   ├── components/         # React components
│   ├── context/           # Global state management
│   ├── lib/              # Utilities and API client
│   └── main.tsx          # Entry point
├── agent/                 # Backend agent service
│   ├── src/
│   │   ├── characters/   # Blossom character definition
│   │   ├── plugins/      # Simulation plugins
│   │   │   ├── perps-sim/
│   │   │   ├── defi-sim/
│   │   │   └── event-sim/
│   │   ├── server/       # HTTP API server
│   │   ├── types/        # Shared types
│   │   └── utils/        # Utilities
│   └── package.json
└── package.json           # Root package.json
```

## API Endpoints

The agent service exposes:

- `POST /api/chat` - Chat with Blossom agent
- `POST /api/strategy/close` - Close a strategy
- `GET /health` - Health check

## Development Notes

- The frontend currently uses mock data (`src/lib/mockParser.ts`)
- Integration points are prepared in `src/lib/blossomApi.ts`
- TODO comments mark where to replace mocks with real API calls
- The agent uses simplified simulation logic for MVP

## Note

This is a mockup/demo. All trading data is simulated for demonstration purposes.

