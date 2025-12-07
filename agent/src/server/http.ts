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
import { resetAllSims, getPortfolioSnapshot } from '../services/state';
import { getOnchainTicker, getEventMarketsTicker } from '../services/ticker';

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
 * (Now uses centralized helper)
 */
function buildPortfolioSnapshot(): BlossomPortfolioSnapshot {
  return getPortfolioSnapshot();
}

/**
 * Apply action to appropriate sim
 */
async function applyAction(action: BlossomAction): Promise<void> {
  if (action.type === 'perp' && action.action === 'open') {
    await perpsSim.openPerp({
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
    // Apply 3% risk cap for event positions (unless override is explicitly set)
    const portfolio = buildPortfolioSnapshot();
    const accountValue = portfolio.accountValueUsd;
    const maxEventRiskPct = 0.03; // 3% per-strategy cap (same as perps)
    const maxStakeUsd = Math.round(accountValue * maxEventRiskPct);
    
    // Cap stake at 3% of account value (unless overrideRiskCap is true)
    if (!action.overrideRiskCap) {
      const cappedStakeUsd = Math.min(action.stakeUsd, maxStakeUsd);
      
      // Update action with capped stake if it was reduced
      if (cappedStakeUsd < action.stakeUsd) {
        action.stakeUsd = cappedStakeUsd;
        action.maxLossUsd = cappedStakeUsd;
        // Recalculate max payout based on capped stake
        // This is a simplified calculation - in reality we'd need market prices
        const payoutMultiple = action.maxPayoutUsd / action.stakeUsd;
        action.maxPayoutUsd = cappedStakeUsd * payoutMultiple;
      }
    } else {
      // Override: only cap at account value (sanity check)
      const maxAllowedUsd = accountValue;
      if (action.stakeUsd > maxAllowedUsd) {
        action.stakeUsd = maxAllowedUsd;
        action.maxLossUsd = maxAllowedUsd;
        const payoutMultiple = action.maxPayoutUsd / action.stakeUsd;
        action.maxPayoutUsd = maxAllowedUsd * payoutMultiple;
      }
    }
    
    await eventSim.openEventPosition(
      action.eventKey,
      action.side,
      action.stakeUsd,
      action.label // Pass label for live markets
    );
  } else if (action.type === 'event' && action.action === 'update') {
    // Update event position stake
    if (!action.positionId) {
      throw new Error('positionId is required for event update action');
    }
    
    await eventSim.updateEventStake({
      positionId: action.positionId,
      newStakeUsd: action.stakeUsd,
      overrideRiskCap: action.overrideRiskCap || false,
      requestedStakeUsd: action.requestedStakeUsd,
    });
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

    // Log incoming request for debugging
    console.log('[api/chat] Received request:', { 
      userMessage: userMessage.substring(0, 100), 
      venue,
      messageLength: userMessage.length 
    });

    // Get current portfolio snapshot before applying new actions
    const portfolioBefore = buildPortfolioSnapshot();
    const portfolioForPrompt = clientPortfolio ? { ...portfolioBefore, ...clientPortfolio } : portfolioBefore;

    // Build prompts for LLM (now async to fetch live market data)
    const { systemPrompt, userPrompt, isPredictionMarketQuery } = await buildBlossomPrompts({
      userMessage,
      portfolio: portfolioForPrompt,
      venue: venue || 'hyperliquid',
    });

    let assistantMessage = '';
    let actions: BlossomAction[] = [];

    // Check if we're in stub mode and this is a prediction market query
    const hasOpenAIKey = !!process.env.BLOSSOM_OPENAI_API_KEY;
    const hasAnthropicKey = !!process.env.BLOSSOM_ANTHROPIC_API_KEY;
    const provider = process.env.BLOSSOM_MODEL_PROVIDER || 'stub';
    const isStubMode = provider === 'stub' || (!hasOpenAIKey && !hasAnthropicKey);

    // Log stub mode detection for debugging
    console.log('[api/chat] Stub mode check:', {
      provider,
      hasOpenAIKey,
      hasAnthropicKey,
      isStubMode,
      isPredictionMarketQuery,
      userMessage: userMessage.substring(0, 100)
    });

    if (isStubMode && isPredictionMarketQuery) {
      // Short-circuit: build deterministic response for prediction markets in stub mode
      console.log('[api/chat] ✅ STUB SHORT-CIRCUIT: Building deterministic prediction market response');
      
      try {
        const { buildPredictionMarketResponse } = await import('../utils/actionParser');
        const accountValue = portfolioForPrompt?.accountValueUsd || 10000;
        const stubResponse = await buildPredictionMarketResponse(
          userMessage, 
          venue || 'hyperliquid',
          accountValue
        );
        assistantMessage = stubResponse.assistantMessage;
        actions = stubResponse.actions;
        console.log('[api/chat] ✅ Stub response built:', { 
          messageLength: assistantMessage.length, 
          actionCount: actions.length,
          preview: assistantMessage.substring(0, 150)
        });
      } catch (error: any) {
        console.error('[api/chat] ❌ Failed to build stub prediction market response:', error.message);
        // Fall through to normal stub LLM call
        const llmOutput = await callLlm({ systemPrompt, userPrompt });
        const modelResponse = parseModelResponse(llmOutput.rawJson);
        assistantMessage = modelResponse.assistantMessage;
        actions = modelResponse.actions;
      }
    } else {
      // Normal flow: call LLM (stub or real)
      console.log('[api/chat] → Normal LLM flow (stub or real)');
      // Normal flow: call LLM (stub or real)
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
    }

    // Apply validated actions to sims
    for (const action of actions) {
      try {
        await applyAction(action);
      } catch (error: any) {
        console.error(`Error applying action:`, error.message);
        // Remove failed action from array
        const index = actions.indexOf(action);
        if (index > -1) {
          actions.splice(index, 1);
        }
      }
    }

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
  liveMarkToMarketUsd?: number; // Optional: live mark-to-market value for event positions
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
      const result = await perpsSim.closePerp(strategyId);
      pnl = result.pnl;
      summaryMessage = `Closed ${result.position.market} ${result.position.side} position. Realized PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
    } else if (type === 'event') {
      const result = await eventSim.closeEventPosition(strategyId);
      pnl = result.pnl;
      const outcome = result.position.outcome === 'won' ? 'Won' : 'Lost';
      let pnlMessage = `Realized PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
      if (result.liveMarkToMarketUsd !== undefined) {
        pnlMessage += ` (Live MTM: ${result.liveMarkToMarketUsd >= 0 ? '+' : ''}$${result.liveMarkToMarketUsd.toFixed(2)})`;
      }
      summaryMessage = `Settled event position "${result.position.label}" (${outcome}). ${pnlMessage}`;
    } else if (type === 'defi') {
      const result = defiSim.closeDefiPosition(strategyId);
      pnl = result.yieldEarned;
      summaryMessage = `Closed ${result.position.protocol} position. Yield earned: $${pnl.toFixed(2)}`;
    } else {
      return res.status(400).json({ error: `Unknown strategy type: ${type}` });
    }

    // Build updated portfolio snapshot
    const portfolio = buildPortfolioSnapshot();

    // If this was an event close with liveMarkToMarketUsd, attach it to the strategy in the portfolio
    if (type === 'event' && result.liveMarkToMarketUsd !== undefined) {
      const strategyIndex = portfolio.strategies.findIndex((s: any) => s.id === strategyId);
      if (strategyIndex >= 0) {
        portfolio.strategies[strategyIndex] = {
          ...portfolio.strategies[strategyIndex],
          liveMarkToMarketUsd: result.liveMarkToMarketUsd,
        };
      }
    }

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
 * POST /api/reset
 */
app.post('/api/reset', async (req, res) => {
  try {
    // Reset all sim states to initial
    resetAllSims();
    
    // Build fresh portfolio snapshot
    const snapshot = getPortfolioSnapshot();
    
    res.json({ 
      portfolio: snapshot, 
      message: 'Simulation state reset.' 
    });
  } catch (err: any) {
    console.error('Failed to reset sim state', err);
    res.status(500).json({ error: 'Failed to reset simulation state' });
  }
});

/**
 * GET /api/ticker
 */
app.get('/api/ticker', async (req, res) => {
  try {
    const venue = (req.query.venue as string) || 'hyperliquid';
    
    if (venue === 'event_demo') {
      const payload = await getEventMarketsTicker();
      res.json({
        venue: payload.venue,
        sections: payload.sections,
      });
    } else {
      const payload = await getOnchainTicker();
      res.json({
        venue: payload.venue,
        sections: payload.sections,
      });
    }
  } catch (error: any) {
    console.error('Ticker error:', error);
    // Return fallback payload
    if (req.query.venue === 'event_demo') {
      res.json({
        venue: 'event_demo',
        sections: [
          {
            id: 'kalshi',
            label: 'Kalshi',
            items: [
              { label: 'Fed cuts in March 2025', value: '62%', meta: 'Kalshi' },
              { label: 'BTC ETF approved by Dec 31', value: '68%', meta: 'Kalshi' },
            ],
          },
        ],
      });
    } else {
      res.json({
        venue: 'hyperliquid',
        sections: [
          {
            id: 'majors',
            label: 'Majors',
            items: [
              { label: 'BTC', value: '$60,000', change: '+2.5%', meta: '24h' },
              { label: 'ETH', value: '$3,000', change: '+1.8%', meta: '24h' },
            ],
          },
        ],
      });
    }
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
  console.log(`   - GET  /api/ticker`);
  console.log(`   - GET  /health`);
});

