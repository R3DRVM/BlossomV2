/**
 * Blossom Agent HTTP Server
 * Provides API endpoints for the React front-end
 */

import express from 'express';
import cors from 'cors';
import { BlossomAction, BlossomPortfolioSnapshot } from '../types/blossom';
import { parseActionsFromResponse } from '../utils/actionParser';
import * as perpsSim from '../plugins/perps-sim';
import * as defiSim from '../plugins/defi-sim';
import * as eventSim from '../plugins/event-sim';

const app = express();
app.use(cors());
app.use(express.json());

// Set up balance callbacks for DeFi and Event sims
// Use perps sim as the source of truth for USDC balance
const getUsdcBalance = () => {
  return perpsSim.getUsdcBalance();
};

const updateUsdcBalance = (delta: number) => {
  perpsSim.updateUsdcBalance(delta);
};

defiSim.setBalanceCallbacks(getUsdcBalance, updateUsdcBalance);
eventSim.setBalanceCallbacks(getUsdcBalance, updateUsdcBalance);

/**
 * Build portfolio snapshot from all sims
 */
function buildPortfolioSnapshot(): BlossomPortfolioSnapshot {
  const perpsSnapshot = perpsSim.getPerpsSnapshot();
  const defiSnapshot = defiSim.getDefiSnapshot();
  const eventSnapshot = eventSim.getEventSnapshot();
  const eventExposureUsd = eventSim.getEventExposureUsd();

  // Calculate open perp exposure
  const openPerpExposureUsd = perpsSnapshot.positions
    .filter(p => !p.isClosed)
    .reduce((sum, p) => sum + p.sizeUsd, 0);

  // Build strategies array (combine all position types)
  const strategies = [
    ...perpsSnapshot.positions.map(p => ({
      type: 'perp' as const,
      status: p.isClosed ? 'closed' : 'executed',
      ...p,
    })),
    ...defiSnapshot.positions.map(p => ({
      type: 'defi' as const,
      status: p.isClosed ? 'closed' : 'active',
      ...p,
    })),
    ...eventSnapshot.positions.map(p => ({
      type: 'event' as const,
      status: p.isClosed ? 'closed' : 'executed',
      ...p,
    })),
  ];

  return {
    accountValueUsd: perpsSnapshot.accountValueUsd,
    balances: perpsSnapshot.balances,
    openPerpExposureUsd,
    eventExposureUsd,
    defiPositions: defiSnapshot.positions.map(p => ({
      id: p.id,
      protocol: p.protocol,
      asset: p.asset,
      depositUsd: p.depositUsd,
      apr: p.apr,
      openedAt: p.openedAt,
      isClosed: p.isClosed,
    })),
    strategies,
  };
}

/**
 * Apply action to appropriate sim
 */
function applyAction(action: BlossomAction): void {
  if (action.type === 'perp' && action.action === 'open') {
    perpsSim.openPerp({
      market: action.market,
      side: action.side,
      riskPct: action.riskPct,
      entry: action.entry,
      takeProfit: action.takeProfit,
      stopLoss: action.stopLoss,
    });
  } else if (action.type === 'defi' && action.action === 'deposit') {
    defiSim.openDefiPosition(
      action.protocol as 'Kamino' | 'RootsFi' | 'Jet',
      action.asset,
      action.amountUsd
    );
  } else if (action.type === 'event' && action.action === 'open') {
    eventSim.openEventPosition(
      action.eventKey,
      action.side,
      action.stakeUsd
    );
  }
}

/**
 * Generate assistant response (simplified for MVP)
 * In production, this would call the actual LLM via ElizaOS
 */
function generateAssistantResponse(
  userMessage: string,
  actions: BlossomAction[]
): string {
  if (actions.length === 0) {
    return "I understand your request. Let me help you with that.";
  }

  const action = actions[0];
  if (action.type === 'perp') {
    return `I've prepared a ${action.side} strategy for ${action.market} with ${action.riskPct}% risk. Entry at $${action.entry?.toLocaleString() || 'market'}, take profit at $${action.takeProfit?.toLocaleString() || 'auto'}, and stop loss at $${action.stopLoss?.toLocaleString() || 'auto'}. Review the details and confirm when ready.`;
  } else if (action.type === 'defi') {
    return `I've analyzed your request and prepared a DeFi yield plan using ${action.protocol} with ${action.apr}% APR. Deposit amount: $${action.amountUsd.toLocaleString()}. Review the details and confirm when ready.`;
  } else if (action.type === 'event') {
    return `I'll allocate a stake of $${action.stakeUsd.toLocaleString()} into the event market "${action.label}" (${action.side} side). Max payout: $${action.maxPayoutUsd.toLocaleString()}, max loss: $${action.maxLossUsd.toLocaleString()}. Review and confirm when ready.`;
  }

  return "I've processed your request. Check the actions for details.";
}

interface ChatRequest {
  userMessage: string;
  venue: 'hyperliquid' | 'event_demo';
  clientPortfolio?: Partial<BlossomPortfolioSnapshot>;
}

interface ChatResponse {
  assistantMessage: string;
  actions: BlossomAction[];
  portfolio: BlossomPortfolioSnapshot;
}

/**
 * POST /api/chat
 */
app.post('/api/chat', async (req, res) => {
  try {
    const { userMessage, venue, clientPortfolio }: ChatRequest = req.body;

    if (!userMessage) {
      return res.status(400).json({ error: 'userMessage is required' });
    }

    // Parse actions from user message
    const actions = parseActionsFromResponse(userMessage, { venue });

    // Apply actions to sims
    actions.forEach(action => {
      try {
        applyAction(action);
      } catch (error: any) {
        console.error(`Error applying action:`, error.message);
      }
    });

    // Generate assistant response
    const assistantMessage = generateAssistantResponse(userMessage, actions);

    // Build portfolio snapshot
    const portfolio = buildPortfolioSnapshot();

    const response: ChatResponse = {
      assistantMessage,
      actions,
      portfolio,
    };

    res.json(response);
  } catch (error: any) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

interface CloseRequest {
  strategyId: string;
  type: 'perp' | 'event' | 'defi';
}

interface CloseResponse {
  summaryMessage: string;
  portfolio: BlossomPortfolioSnapshot;
}

/**
 * POST /api/strategy/close
 */
app.post('/api/strategy/close', async (req, res) => {
  try {
    const { strategyId, type }: CloseRequest = req.body;

    if (!strategyId || !type) {
      return res.status(400).json({ error: 'strategyId and type are required' });
    }

    let summaryMessage = '';
    let pnl = 0;

    if (type === 'perp') {
      const result = perpsSim.closePerp(strategyId);
      pnl = result.pnl;
      summaryMessage = `Closed ${result.position.market} ${result.position.side} position. Realized PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
    } else if (type === 'event') {
      const result = eventSim.closeEventPosition(strategyId);
      pnl = result.pnl;
      const outcome = result.position.outcome === 'won' ? 'Won' : 'Lost';
      summaryMessage = `Settled event position "${result.position.label}" (${outcome}). Realized PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
    } else if (type === 'defi') {
      const result = defiSim.closeDefiPosition(strategyId);
      pnl = result.yieldEarned;
      summaryMessage = `Closed ${result.position.protocol} position. Yield earned: $${pnl.toFixed(2)}`;
    } else {
      return res.status(400).json({ error: `Unknown strategy type: ${type}` });
    }

    // Build updated portfolio snapshot
    const portfolio = buildPortfolioSnapshot();

    const response: CloseResponse = {
      summaryMessage,
      portfolio,
    };

    res.json(response);
  } catch (error: any) {
    console.error('Close strategy error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'blossom-agent' });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🌸 Blossom Agent server running on http://localhost:${PORT}`);
  console.log(`   API endpoints:`);
  console.log(`   - POST /api/chat`);
  console.log(`   - POST /api/strategy/close`);
  console.log(`   - GET  /health`);
});

