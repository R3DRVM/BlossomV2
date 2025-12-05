/**
 * Blossom Agent HTTP Server
 * Provides API endpoints for the React front-end
 */

import express from 'express';
import cors from 'cors';
import { BlossomAction, BlossomPortfolioSnapshot } from '../types/blossom';
import { validateActions, buildBlossomPrompts } from '../utils/actionParser';
import { callLlm } from '../services/llmClient';
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
 * Parse LLM JSON response into assistant message and actions
 */
interface ModelResponse {
  assistantMessage: string;
  actions: BlossomAction[];
}

function parseModelResponse(rawJson: string): ModelResponse {
  try {
    const parsed = JSON.parse(rawJson);
    
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('Response is not an object');
    }

    const assistantMessage = typeof parsed.assistantMessage === 'string' 
      ? parsed.assistantMessage 
      : 'I understand your request.';

    const actions = Array.isArray(parsed.actions) 
      ? validateActions(parsed.actions)
      : [];

    return { assistantMessage, actions };
  } catch (error: any) {
    console.error('Failed to parse model response:', error.message);
    console.error('Raw JSON:', rawJson);
    throw error;
  }
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

    // Get current portfolio snapshot before applying new actions
    const portfolioBefore = buildPortfolioSnapshot();
    const portfolioForPrompt = clientPortfolio ? { ...portfolioBefore, ...clientPortfolio } : portfolioBefore;

    // Build prompts for LLM
    const { systemPrompt, userPrompt } = buildBlossomPrompts({
      userMessage,
      portfolio: portfolioForPrompt,
      venue: venue || 'hyperliquid',
    });

    let assistantMessage = '';
    let actions: BlossomAction[] = [];

    try {
      // Call LLM
      const llmOutput = await callLlm({ systemPrompt, userPrompt });

      // Parse JSON response
      const modelResponse = parseModelResponse(llmOutput.rawJson);
      assistantMessage = modelResponse.assistantMessage;
      actions = modelResponse.actions;
    } catch (error: any) {
      console.error('LLM call or parsing error:', error.message);
      // Fallback: return safe response with no actions
      assistantMessage = "I couldn't safely parse a trading plan, so I didn't execute any actions. Please rephrase or try a simpler command.";
      actions = [];
    }

    // Apply validated actions to sims
    actions.forEach(action => {
      try {
        applyAction(action);
      } catch (error: any) {
        console.error(`Error applying action:`, error.message);
        // Remove failed action from array
        const index = actions.indexOf(action);
        if (index > -1) {
          actions.splice(index, 1);
        }
      }
    });

    // Build updated portfolio snapshot after applying actions
    const portfolioAfter = buildPortfolioSnapshot();

    const response: ChatResponse = {
      assistantMessage,
      actions,
      portfolio: portfolioAfter,
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

