/**
 * Blossom Agent HTTP Server
 * Provides API endpoints for the React front-end
 */
// Load environment variables FIRST (before any other imports that use process.env)
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const agentDir = resolve(__dirname, '../..');
const rootDir = resolve(agentDir, '..');
// Load .env files with precedence (most specific first)
// Precedence: agent/.env.local → agent/.env → root/.env.local → root/.env
const envFiles = [
    resolve(agentDir, '.env.local'),
    resolve(agentDir, '.env'),
    resolve(rootDir, '.env.local'),
    resolve(rootDir, '.env'),
];
let loadedEnvFile = null;
for (const envFile of envFiles) {
    const result = config({ path: envFile });
    if (!result.error) {
        loadedEnvFile = envFile;
        break; // First successful load wins
    }
}
// Log which env file was loaded (or if none)
if (loadedEnvFile) {
    console.log(`📄 Loaded environment from: ${loadedEnvFile}`);
}
else {
    console.log(`⚠️  No .env file found (using system environment variables)`);
}
import express from 'express';
import cors from 'cors';
import { validateActions, buildBlossomPrompts } from '../utils/actionParser';
import { callLlm } from '../services/llmClient';
import * as perpsSim from '../plugins/perps-sim';
import * as defiSim from '../plugins/defi-sim';
import * as eventSim from '../plugins/event-sim';
import { resetAllSims, getPortfolioSnapshot } from '../services/state';
import { getOnchainTicker, getEventMarketsTicker } from '../services/ticker';
import { logExecutionArtifact, getExecutionArtifacts } from '../utils/executionLogger';
import { loadAccessCodesFromEnv, checkAccess } from '../utils/accessGate';
import { logEvent, hashAddress } from '../telemetry/logger';
import { waitForReceipt } from '../executors/evmReceipt';
const app = express();
app.use(cors());
app.use(express.json());
// Access gate feature flag
const ACCESS_GATE_ENABLED = process.env.ACCESS_GATE_ENABLED === "true";
const maybeCheckAccess = ACCESS_GATE_ENABLED ? checkAccess : (req, res, next) => next();
// Initialize access gate on startup (safe - won't crash if disabled)
loadAccessCodesFromEnv();
// Set up balance callbacks for DeFi and Event sims
// Use perps sim as the source of truth for REDACTED balance
const getUsdcBalance = () => {
    return perpsSim.getUsdcBalance();
};
const updateUsdcBalance = (delta) => {
    perpsSim.updateUsdcBalance(delta);
};
defiSim.setBalanceCallbacks(getUsdcBalance, updateUsdcBalance);
eventSim.setBalanceCallbacks(getUsdcBalance, updateUsdcBalance);
/**
 * Build portfolio snapshot from all sims
 * (Now uses centralized helper)
 */
function buildPortfolioSnapshot() {
    return getPortfolioSnapshot();
}
/**
 * Apply action to appropriate sim and return unified ExecutionResult
 */
async function applyAction(action) {
    const portfolioBefore = buildPortfolioSnapshot();
    const { v4: uuidv4 } = await import('uuid');
    const simulatedTxId = `sim_${uuidv4()}`;
    try {
        if (action.type === 'perp' && action.action === 'open') {
            const position = await perpsSim.openPerp({
                market: action.market,
                side: action.side,
                riskPct: action.riskPct,
                entry: action.entry,
                takeProfit: action.takeProfit,
                stopLoss: action.stopLoss,
            });
            const portfolioAfter = buildPortfolioSnapshot();
            const accountValueDelta = portfolioAfter.accountValueUsd - portfolioBefore.accountValueUsd;
            const balanceDeltas = portfolioAfter.balances.map(b => {
                const before = portfolioBefore.balances.find(b2 => b2.symbol === b.symbol);
                return {
                    symbol: b.symbol,
                    deltaUsd: b.balanceUsd - (before?.balanceUsd || 0),
                };
            });
            return {
                success: true,
                status: 'success',
                simulatedTxId,
                positionDelta: {
                    type: 'perp',
                    positionId: position.id,
                    sizeUsd: position.sizeUsd,
                    entryPrice: position.entryPrice,
                    side: position.side,
                },
                portfolioDelta: {
                    accountValueDeltaUsd: accountValueDelta,
                    balanceDeltas,
                    exposureDeltaUsd: portfolioAfter.openPerpExposureUsd - portfolioBefore.openPerpExposureUsd,
                },
                portfolio: portfolioAfter,
            };
        }
        else if (action.type === 'defi' && action.action === 'deposit') {
            const position = defiSim.openDefiPosition(action.protocol, action.asset, action.amountUsd);
            const portfolioAfter = buildPortfolioSnapshot();
            const accountValueDelta = portfolioAfter.accountValueUsd - portfolioBefore.accountValueUsd;
            const balanceDeltas = portfolioAfter.balances.map(b => {
                const before = portfolioBefore.balances.find(b2 => b2.symbol === b.symbol);
                return {
                    symbol: b.symbol,
                    deltaUsd: b.balanceUsd - (before?.balanceUsd || 0),
                };
            });
            return {
                success: true,
                status: 'success',
                simulatedTxId,
                positionDelta: {
                    type: 'defi',
                    positionId: position.id,
                    sizeUsd: position.depositUsd,
                },
                portfolioDelta: {
                    accountValueDeltaUsd: accountValueDelta,
                    balanceDeltas,
                },
                portfolio: portfolioAfter,
            };
        }
        else if (action.type === 'event' && action.action === 'open') {
            // Apply 3% risk cap for event positions (unless override is explicitly set)
            const accountValue = portfolioBefore.accountValueUsd;
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
                    const payoutMultiple = action.maxPayoutUsd / action.stakeUsd;
                    action.maxPayoutUsd = cappedStakeUsd * payoutMultiple;
                }
            }
            else {
                // Override: only cap at account value (sanity check)
                const maxAllowedUsd = accountValue;
                if (action.stakeUsd > maxAllowedUsd) {
                    action.stakeUsd = maxAllowedUsd;
                    action.maxLossUsd = maxAllowedUsd;
                    const payoutMultiple = action.maxPayoutUsd / action.stakeUsd;
                    action.maxPayoutUsd = maxAllowedUsd * payoutMultiple;
                }
            }
            const position = await eventSim.openEventPosition(action.eventKey, action.side, action.stakeUsd, action.label // Pass label for live markets
            );
            const portfolioAfter = buildPortfolioSnapshot();
            const accountValueDelta = portfolioAfter.accountValueUsd - portfolioBefore.accountValueUsd;
            const balanceDeltas = portfolioAfter.balances.map(b => {
                const before = portfolioBefore.balances.find(b2 => b2.symbol === b.symbol);
                return {
                    symbol: b.symbol,
                    deltaUsd: b.balanceUsd - (before?.balanceUsd || 0),
                };
            });
            return {
                success: true,
                status: 'success',
                simulatedTxId,
                positionDelta: {
                    type: 'event',
                    positionId: position.id,
                    sizeUsd: position.stakeUsd,
                    side: position.side,
                },
                portfolioDelta: {
                    accountValueDeltaUsd: accountValueDelta,
                    balanceDeltas,
                    exposureDeltaUsd: portfolioAfter.eventExposureUsd - portfolioBefore.eventExposureUsd,
                },
                portfolio: portfolioAfter,
            };
        }
        else if (action.type === 'event' && action.action === 'update') {
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
            const portfolioAfter = buildPortfolioSnapshot();
            return {
                success: true,
                status: 'success',
                simulatedTxId,
                portfolio: portfolioAfter,
            };
        }
        // Unknown action type
        const portfolioAfter = buildPortfolioSnapshot();
        return {
            success: false,
            status: 'failed',
            error: `Unknown action type: ${action.type}`,
            portfolio: portfolioAfter,
        };
    }
    catch (error) {
        const portfolioAfter = buildPortfolioSnapshot();
        return {
            success: false,
            status: 'failed',
            error: error.message || 'Unknown error',
            portfolio: portfolioAfter,
        };
    }
}
async function parseModelResponse(rawJson, isSwapPrompt = false, isDefiPrompt = false, userMessage, isPerpPrompt = false, isEventPrompt = false) {
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
        // Parse and validate executionRequest
        let executionRequest = null;
        let modelOk = true;
        if (parsed.executionRequest) {
            const { validateExecutionRequest } = await import('../utils/actionParser');
            executionRequest = validateExecutionRequest(parsed.executionRequest);
            if (!executionRequest && (isSwapPrompt || isDefiPrompt || isPerpPrompt || isEventPrompt)) {
                // Invalid executionRequest - try deterministic fallback
                modelOk = false;
                console.error('[parseModelResponse] Invalid executionRequest, will try fallback');
            }
        }
        else if (isSwapPrompt || isDefiPrompt || isPerpPrompt || isEventPrompt) {
            // Missing executionRequest - try deterministic fallback
            modelOk = false;
            console.error('[parseModelResponse] Missing executionRequest, will try fallback');
        }
        // If model failed and we have a prompt, try deterministic fallback
        if (!modelOk && userMessage && (isSwapPrompt || isDefiPrompt || isPerpPrompt || isEventPrompt)) {
            const fallback = await applyDeterministicFallback(userMessage, isSwapPrompt, isDefiPrompt, isPerpPrompt, isEventPrompt);
            if (fallback) {
                return {
                    assistantMessage: `(Fallback planner) ${fallback.assistantMessage}`,
                    actions: fallback.actions,
                    executionRequest: fallback.executionRequest,
                    modelOk: true,
                };
            }
        }
        return { assistantMessage, actions, executionRequest, modelOk };
    }
    catch (error) {
        console.error('Failed to parse model response:', error.message);
        console.error('Raw JSON:', rawJson);
        // If parsing failed and we have a prompt, try deterministic fallback
        if (userMessage && (isSwapPrompt || isDefiPrompt || isPerpPrompt || isEventPrompt)) {
            const fallback = await applyDeterministicFallback(userMessage, isSwapPrompt, isDefiPrompt, isPerpPrompt, isEventPrompt);
            if (fallback) {
                return {
                    assistantMessage: `(Fallback planner) ${fallback.assistantMessage}`,
                    actions: fallback.actions,
                    executionRequest: fallback.executionRequest,
                    modelOk: true,
                };
            }
        }
        throw error;
    }
}
/**
 * Normalize user input to handle edge cases like "5weth" → "5 weth"
 */
function normalizeUserInput(userMessage) {
    // Token patterns: eth, weth, usdc, usdt, dai, btc, sol
    const tokenPattern = /\b(\d+\.?\d*)(eth|weth|usdc|usdt|dai|btc|sol)\b/gi;
    let normalized = userMessage;
    // Replace "5weth" → "5 weth", "0.3eth" → "0.3 eth", etc.
    normalized = normalized.replace(tokenPattern, (match, amount, token) => {
        return `${amount} ${token}`;
    });
    // Handle arrow operators: "5weth->usdc" → "5 weth to usdc"
    normalized = normalized.replace(/(\d+\.?\d*\s*\w+)\s*[-=]>\s*(\w+)/gi, '$1 to $2');
    // Handle commas: "5weth, to usdc" → "5 weth to usdc"
    normalized = normalized.replace(/,\s*to\s+/gi, ' to ');
    return normalized;
}
/**
 * Deterministic fallback for when LLM fails
 */
async function applyDeterministicFallback(userMessage, isSwapPrompt, isDefiPrompt, isPerpPrompt = false, isEventPrompt = false) {
    // Normalize input before parsing
    const normalizedMessage = normalizeUserInput(userMessage);
    const lowerMessage = normalizedMessage.toLowerCase();
    if (isEventPrompt) {
        // Extract event details
        const stakeMatch = userMessage.match(/\$(\d+)/) || userMessage.match(/(\d+)\s*(usd|dollar)/i);
        const stakeUsd = stakeMatch ? parseFloat(stakeMatch[1]) : 5;
        const outcome = lowerMessage.includes('yes') ? 'YES' : 'NO';
        // Find matching market
        const { findEventMarketByKeyword } = await import('../quotes/eventMarkets');
        const keyword = lowerMessage.includes('fed') ? 'fed' : lowerMessage.includes('rate cut') ? 'rate cut' : 'fed';
        const market = await findEventMarketByKeyword(keyword);
        return {
            assistantMessage: `I'll bet ${outcome} on "${market?.title || 'Fed Rate Cut'}" with $${stakeUsd}.`,
            actions: [],
            executionRequest: {
                kind: 'event',
                chain: 'sepolia',
                marketId: market?.id || 'demo-fed',
                outcome: outcome,
                stakeUsd,
                price: outcome === 'YES' ? market?.yesPrice : market?.noPrice,
            },
        };
    }
    if (isPerpPrompt) {
        // Extract perp details
        const assetMatch = lowerMessage.match(/(btc|eth|sol)/);
        const leverageMatch = userMessage.match(/(\d+)x/i);
        const riskMatch = userMessage.match(/(\d+)%\s*risk/i) || userMessage.match(/risk.*?(\d+)%/i);
        const sideMatch = lowerMessage.match(/(long|short)/);
        const asset = assetMatch ? assetMatch[1].toUpperCase() : 'ETH';
        const leverage = leverageMatch ? parseInt(leverageMatch[1]) : 2;
        const riskPct = riskMatch ? parseFloat(riskMatch[1]) : 2;
        const side = sideMatch ? sideMatch[1] : 'long';
        return {
            assistantMessage: `I'll open a ${side} ${asset} perp position with ${leverage}x leverage and ${riskPct}% risk.`,
            actions: [],
            executionRequest: {
                kind: 'perp',
                chain: 'sepolia',
                market: `${asset}-USD`,
                side: side,
                leverage,
                riskPct,
                marginUsd: 100,
            },
        };
    }
    if (isSwapPrompt) {
        // Extract amount and tokens
        const amountMatch = userMessage.match(/(\d+\.?\d*)\s*(usdc|weth|eth)/i);
        const tokenInMatch = lowerMessage.match(/(usdc|weth|eth)/);
        const tokenOutMatch = lowerMessage.match(/to\s+(usdc|weth|eth)/);
        if (amountMatch && tokenInMatch) {
            const amount = amountMatch[1];
            const tokenIn = tokenInMatch[1].toUpperCase() === 'ETH' ? 'ETH' : tokenInMatch[1].toUpperCase();
            const tokenOut = tokenOutMatch ? (tokenOutMatch[1].toUpperCase() === 'ETH' ? 'WETH' : tokenOutMatch[1].toUpperCase()) :
                (tokenIn === 'REDACTED' ? 'WETH' : 'REDACTED');
            return {
                assistantMessage: `I'll swap ${amount} ${tokenIn} to ${tokenOut} on Sepolia.`,
                actions: [],
                executionRequest: {
                    kind: 'swap',
                    chain: 'sepolia',
                    tokenIn: tokenIn,
                    tokenOut: tokenOut,
                    amountIn: amount,
                    slippageBps: 50,
                    fundingPolicy: tokenIn === 'ETH' ? 'auto' : 'require_tokenIn',
                },
            };
        }
    }
    if (isDefiPrompt) {
        // Extract amount
        const amountMatch = userMessage.match(/(\d+\.?\d*)\s*(usdc|dollar)/i);
        const amount = amountMatch ? amountMatch[1] : '10';
        // Get vault recommendation
        const { getVaultRecommendation } = await import('../quotes/defiLlamaQuote');
        const vault = await getVaultRecommendation(parseFloat(amount));
        return {
            assistantMessage: `I'll park ${amount} REDACTED into yield. Recommended: ${vault?.name || 'Aave REDACTED'} at ${vault?.apy.toFixed(2) || '5.00'}% APY.`,
            actions: [],
            executionRequest: {
                kind: 'lend_supply',
                chain: 'sepolia',
                asset: 'REDACTED',
                amount,
                protocol: 'demo',
                vault: vault?.name || 'Aave REDACTED',
            },
        };
    }
    return null;
}
/**
 * POST /api/chat
 */
app.post('/api/chat', maybeCheckAccess, async (req, res) => {
    const chatStartTime = Date.now();
    try {
        const { userMessage, venue, clientPortfolio } = req.body;
        // Telemetry: log chat request
        logEvent('chat_request', {
            venue,
            notes: [userMessage.substring(0, 50) + (userMessage.length > 50 ? '...' : '')],
        });
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
        // Normalize user input first (handle edge cases like "5weth" → "5 weth")
        const normalizedUserMessage = normalizeUserInput(userMessage);
        // Build prompts for LLM (now async to fetch live market data)
        // Use normalized message for prompt building
        const { systemPrompt, userPrompt, isPredictionMarketQuery } = await buildBlossomPrompts({
            userMessage: normalizedUserMessage,
            portfolio: portfolioForPrompt,
            venue: venue || 'hyperliquid',
        });
        let assistantMessage = '';
        let actions = [];
        let modelResponse = null;
        // Detect if this is a swap prompt (use normalized message)
        const isSwapPrompt = /swap|exchange|convert/i.test(normalizedUserMessage) &&
            (normalizedUserMessage.toLowerCase().includes('usdc') ||
                normalizedUserMessage.toLowerCase().includes('weth') ||
                normalizedUserMessage.toLowerCase().includes('eth'));
        // Detect if this is a DeFi/yield prompt
        const isDefiPrompt = /park|deposit|earn yield|lend|supply/i.test(normalizedUserMessage) &&
            (normalizedUserMessage.toLowerCase().includes('usdc') ||
                normalizedUserMessage.toLowerCase().includes('yield') ||
                normalizedUserMessage.toLowerCase().includes('stablecoin'));
        // Detect if this is a perp prompt
        const isPerpPrompt = /open|long|short|perp/i.test(normalizedUserMessage) &&
            (normalizedUserMessage.toLowerCase().includes('btc') ||
                normalizedUserMessage.toLowerCase().includes('eth') ||
                normalizedUserMessage.toLowerCase().includes('sol') ||
                normalizedUserMessage.toLowerCase().includes('2x') ||
                normalizedUserMessage.toLowerCase().includes('3x') ||
                normalizedUserMessage.toLowerCase().includes('leverage'));
        // Detect if this is an event prompt
        const isEventPrompt = /bet|wager|risk.*on|event/i.test(normalizedUserMessage) &&
            (normalizedUserMessage.toLowerCase().includes('yes') ||
                normalizedUserMessage.toLowerCase().includes('no') ||
                normalizedUserMessage.toLowerCase().includes('fed') ||
                normalizedUserMessage.toLowerCase().includes('rate cut'));
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
            isSwapPrompt,
            userMessage: userMessage.substring(0, 100)
        });
        if (isStubMode && isPredictionMarketQuery) {
            // Short-circuit: build deterministic response for prediction markets in stub mode
            console.log('[api/chat] ✅ STUB SHORT-CIRCUIT: Building deterministic prediction market response');
            try {
                const { buildPredictionMarketResponse } = await import('../utils/actionParser');
                const accountValue = portfolioForPrompt?.accountValueUsd || 10000;
                const stubResponse = await buildPredictionMarketResponse(userMessage, venue || 'hyperliquid', accountValue);
                assistantMessage = stubResponse.assistantMessage;
                actions = stubResponse.actions;
                modelResponse = {
                    assistantMessage,
                    actions,
                    executionRequest: null,
                    modelOk: true,
                };
                console.log('[api/chat] ✅ Stub response built:', {
                    messageLength: assistantMessage.length,
                    actionCount: actions.length,
                    preview: assistantMessage.substring(0, 150)
                });
            }
            catch (error) {
                console.error('[api/chat] ❌ Failed to build stub prediction market response:', error.message);
                // Fall through to normal stub LLM call
                const llmOutput = await callLlm({ systemPrompt, userPrompt });
                modelResponse = await parseModelResponse(llmOutput.rawJson, isSwapPrompt);
                assistantMessage = modelResponse.assistantMessage;
                actions = modelResponse.actions;
            }
        }
        else {
            // Normal flow: call LLM (stub or real)
            console.log('[api/chat] → Normal LLM flow (stub or real)');
            // Normalize user input before processing
            const normalizedUserMessage = normalizeUserInput(userMessage);
            const normalizedUserPrompt = userPrompt.replace(userMessage, normalizedUserMessage);
            // Detect prompts on normalized message
            const normalizedIsSwapPrompt = /swap|exchange|convert/i.test(normalizedUserMessage) &&
                (normalizedUserMessage.toLowerCase().includes('usdc') ||
                    normalizedUserMessage.toLowerCase().includes('weth') ||
                    normalizedUserMessage.toLowerCase().includes('eth'));
            const normalizedIsDefiPrompt = /park|deposit|earn yield|lend|supply/i.test(normalizedUserMessage) &&
                (normalizedUserMessage.toLowerCase().includes('usdc') ||
                    normalizedUserMessage.toLowerCase().includes('yield') ||
                    normalizedUserMessage.toLowerCase().includes('stablecoin'));
            const normalizedIsPerpPrompt = /open|long|short|perp/i.test(normalizedUserMessage) &&
                (normalizedUserMessage.toLowerCase().includes('btc') ||
                    normalizedUserMessage.toLowerCase().includes('eth') ||
                    normalizedUserMessage.toLowerCase().includes('sol') ||
                    normalizedUserMessage.toLowerCase().includes('2x') ||
                    normalizedUserMessage.toLowerCase().includes('3x') ||
                    normalizedUserMessage.toLowerCase().includes('leverage'));
            const normalizedIsEventPrompt = /bet|wager|risk.*on|event/i.test(normalizedUserMessage) &&
                (normalizedUserMessage.toLowerCase().includes('yes') ||
                    normalizedUserMessage.toLowerCase().includes('no') ||
                    normalizedUserMessage.toLowerCase().includes('fed') ||
                    normalizedUserMessage.toLowerCase().includes('rate cut'));
            try {
                // Call LLM with normalized prompt
                const llmOutput = await callLlm({ systemPrompt, userPrompt: normalizedUserPrompt });
                // Parse JSON response with normalized message for fallback
                modelResponse = await parseModelResponse(llmOutput.rawJson, normalizedIsSwapPrompt, normalizedIsDefiPrompt, normalizedUserMessage, normalizedIsPerpPrompt, normalizedIsEventPrompt);
                assistantMessage = modelResponse.assistantMessage;
                actions = modelResponse.actions;
                // If model failed, try deterministic fallback immediately
                if (!modelResponse.modelOk && (normalizedIsSwapPrompt || normalizedIsDefiPrompt || normalizedIsPerpPrompt || normalizedIsEventPrompt)) {
                    const fallback = await applyDeterministicFallback(normalizedUserMessage, normalizedIsSwapPrompt, normalizedIsDefiPrompt, normalizedIsPerpPrompt, normalizedIsEventPrompt);
                    if (fallback) {
                        modelResponse = {
                            assistantMessage: fallback.assistantMessage,
                            actions: fallback.actions,
                            executionRequest: fallback.executionRequest,
                            modelOk: true,
                        };
                        assistantMessage = fallback.assistantMessage;
                        actions = fallback.actions;
                    }
                }
            }
            catch (error) {
                console.error('LLM call or parsing error:', error.message);
                // Try deterministic fallback before giving up
                if (normalizedIsSwapPrompt || normalizedIsDefiPrompt || normalizedIsPerpPrompt || normalizedIsEventPrompt) {
                    const fallback = await applyDeterministicFallback(normalizedUserMessage, normalizedIsSwapPrompt, normalizedIsDefiPrompt, normalizedIsPerpPrompt, normalizedIsEventPrompt);
                    if (fallback) {
                        modelResponse = {
                            assistantMessage: fallback.assistantMessage,
                            actions: fallback.actions,
                            executionRequest: fallback.executionRequest,
                            modelOk: true,
                        };
                        assistantMessage = fallback.assistantMessage;
                        actions = fallback.actions;
                    }
                    else {
                        // Last resort: return safe response
                        assistantMessage = "I couldn't safely parse a trading plan, so I didn't execute any actions. Please rephrase or try a simpler command.";
                        actions = [];
                        modelResponse = {
                            assistantMessage,
                            actions: [],
                            executionRequest: null,
                            modelOk: false,
                        };
                    }
                }
                else {
                    // Fallback: return safe response with no actions
                    assistantMessage = "I couldn't safely parse a trading plan, so I didn't execute any actions. Please rephrase or try a simpler command.";
                    actions = [];
                    modelResponse = {
                        assistantMessage,
                        actions: [],
                        executionRequest: null,
                        modelOk: false,
                    };
                }
            }
        }
        // Apply validated actions to sims and collect execution results
        const executionResults = [];
        for (const action of actions) {
            try {
                const result = await applyAction(action);
                executionResults.push(result);
                // If execution failed, remove action from array
                if (!result.success) {
                    const index = actions.indexOf(action);
                    if (index > -1) {
                        actions.splice(index, 1);
                    }
                }
            }
            catch (error) {
                console.error(`Error applying action:`, error.message);
                // Remove failed action from array
                const index = actions.indexOf(action);
                if (index > -1) {
                    actions.splice(index, 1);
                }
                // Add failed result
                const portfolioAfter = buildPortfolioSnapshot();
                executionResults.push({
                    success: false,
                    status: 'failed',
                    error: error.message || 'Unknown error',
                    portfolio: portfolioAfter,
                });
            }
        }
        // Build updated portfolio snapshot after applying actions
        const portfolioAfter = buildPortfolioSnapshot();
        // Get executionRequest from modelResponse if available
        const executionRequest = modelResponse?.executionRequest ?? null;
        const modelOk = modelResponse?.modelOk !== false;
        // Task 3: Enforce backend invariants for actionable intents
        // Perp/event/defi intents MUST have executionRequest (swaps may execute immediately)
        const hasActionableIntent = actions.length > 0 && actions.some(a => a.type === 'perp' || a.type === 'event' || a.type === 'defi');
        if (hasActionableIntent && !executionRequest) {
            // Actionable intent detected but executionRequest missing - return structured error
            if (process.env.DEBUG_RESPONSE === 'true') {
                console.error('[api/chat] MISSING_EXECUTION_REQUEST for actionable intent:', {
                    actions: actions.map(a => ({ type: a.type })),
                    modelOk,
                    debugHints: {
                        modelResponse: modelResponse ? 'present' : 'missing',
                        fallbackApplied: modelResponse?.modelOk === false,
                    },
                });
            }
            return res.status(200).json({
                ok: false,
                assistantMessage: "I couldn't generate a valid execution plan. Please try rephrasing your request.",
                actions: [],
                executionRequest: null,
                modelOk: false,
                portfolio: portfolioAfter,
                executionResults: [],
                errorCode: 'MISSING_EXECUTION_REQUEST',
            });
        }
        // Task A: Create draft strategy server-side for actionable intents (deterministic)
        let serverDraftId = undefined;
        if (executionRequest) {
            const { v4: uuidv4 } = await import('uuid');
            const accountValue = portfolioAfter.accountValueUsd || 10000; // Fallback for demo
            if (executionRequest.kind === 'perp') {
                const perpReq = executionRequest;
                const marginUsd = perpReq.marginUsd || (accountValue * (perpReq.riskPct || 2) / 100);
                const leverage = perpReq.leverage || 2;
                const notionalUsd = marginUsd * leverage;
                serverDraftId = `draft-${uuidv4()}`;
                const draftStrategy = {
                    id: serverDraftId,
                    type: 'perp',
                    status: 'draft',
                    side: perpReq.side,
                    market: perpReq.market || 'BTC-USD',
                    riskPct: perpReq.riskPct || 2,
                    entry: 0, // Will be set on execution
                    takeProfit: 0,
                    stopLoss: 0,
                    sourceText: userMessage.substring(0, 200), // Truncate for storage
                    marginUsd,
                    leverage,
                    notionalUsd,
                    sizeUsd: notionalUsd, // For portfolio mapping
                    isClosed: false,
                    createdAt: new Date().toISOString(),
                    // Task B: Add routing fields for rich card UI
                    routingVenue: 'Sepolia Testnet', // Will be updated from executionRequest if available
                    routingChain: 'Sepolia',
                    routingSlippage: perpReq.slippageBps ? `${(perpReq.slippageBps / 100).toFixed(2)}%` : '0.5%',
                };
                // Add draft to portfolio.strategies
                portfolioAfter.strategies.push(draftStrategy);
                if (process.env.DEBUG_CARD_CONTRACT === 'true') {
                    console.log('[api/chat] Created perp draft server-side:', {
                        draftId: serverDraftId,
                        market: draftStrategy.market,
                        side: draftStrategy.side,
                        marginUsd,
                        leverage,
                        notionalUsd,
                    });
                }
            }
            else if (executionRequest.kind === 'event') {
                const eventReq = executionRequest;
                const stakeUsd = eventReq.stakeUsd || 5;
                const riskPct = (stakeUsd / accountValue) * 100;
                serverDraftId = `draft-${uuidv4()}`;
                const draftStrategy = {
                    id: serverDraftId,
                    type: 'event',
                    status: 'draft',
                    side: eventReq.outcome === 'YES' ? 'YES' : 'NO',
                    market: eventReq.marketId || 'demo-fed',
                    eventKey: eventReq.marketId || 'demo-fed',
                    label: eventReq.marketId || 'Fed Rate Cut',
                    riskPct,
                    entry: stakeUsd,
                    takeProfit: stakeUsd * 2, // Estimate
                    stopLoss: stakeUsd,
                    sourceText: userMessage.substring(0, 200),
                    stakeUsd,
                    maxPayoutUsd: stakeUsd * 2,
                    maxLossUsd: stakeUsd,
                    sizeUsd: stakeUsd, // For portfolio mapping
                    isClosed: false,
                    createdAt: new Date().toISOString(),
                };
                portfolioAfter.strategies.push(draftStrategy);
                if (process.env.DEBUG_CARD_CONTRACT === 'true') {
                    console.log('[api/chat] Created event draft server-side:', {
                        draftId: serverDraftId,
                        marketId: draftStrategy.eventKey,
                        outcome: draftStrategy.side,
                        stakeUsd,
                    });
                }
            }
            else if (executionRequest.kind === 'lend' || executionRequest.kind === 'lend_supply') {
                const lendReq = executionRequest;
                const amountUsd = parseFloat(lendReq.amount) || 10;
                const riskPct = (amountUsd / accountValue) * 100;
                // Clamp APY to realistic demo range (Task A requirement)
                const apyPct = 5.0; // Default to Aave REDACTED 5% for demo
                serverDraftId = `draft-${uuidv4()}`;
                const defiMarketLabel = `DeFi: ${lendReq.vault || lendReq.protocol || 'Yield'}`;
                const draftStrategy = {
                    id: serverDraftId,
                    type: 'perp', // Use perp type for UI compatibility (ConfirmTradeCard needs marginUsd, leverage)
                    status: 'draft',
                    side: 'long', // DeFi is always "long" (deposit)
                    market: defiMarketLabel,
                    riskPct,
                    entry: amountUsd,
                    takeProfit: amountUsd * 1.05, // Estimate 5% yield
                    stopLoss: amountUsd,
                    sourceText: userMessage.substring(0, 200),
                    marginUsd: amountUsd, // Deposit amount = margin
                    leverage: 1, // DeFi has no leverage
                    notionalUsd: amountUsd, // For DeFi, notional = deposit
                    sizeUsd: amountUsd, // For portfolio mapping
                    isClosed: false,
                    createdAt: new Date().toISOString(),
                    // Task B: Add routing fields for rich card UI
                    routingVenue: lendReq.protocol || 'Aave',
                    routingChain: 'Sepolia',
                    routingSlippage: '0.5%',
                };
                portfolioAfter.strategies.push(draftStrategy);
                if (process.env.DEBUG_CARD_CONTRACT === 'true') {
                    console.log('[api/chat] Created DeFi/lend draft server-side:', {
                        draftId: serverDraftId,
                        market: defiMarketLabel,
                        amountUsd,
                        apyPct,
                    });
                }
            }
        }
        // Task B: Enforce contract invariants - if actionable intent, must have draft
        if (hasActionableIntent && executionRequest && !serverDraftId) {
            // This should never happen if executionRequest exists, but add safety check
            if (process.env.DEBUG_CARD_CONTRACT === 'true') {
                console.error('[api/chat] WARNING: Actionable intent but no draft created:', {
                    executionRequestKind: executionRequest?.kind,
                    actions: actions.map(a => ({ type: a.type })),
                });
            }
        }
        const response = {
            assistantMessage,
            actions,
            executionRequest,
            modelOk,
            portfolio: portfolioAfter,
            executionResults, // Include execution results
            errorCode: (!modelOk && !executionRequest) ? 'LLM_REFUSAL' : undefined, // Only set LLM_REFUSAL if no executionRequest was generated (even after fallback)
            draftId: serverDraftId, // Task A: Server-created draft ID for UI to set msg.type + msg.draftId
        };
        // Task C: DEBUG_CARD_CONTRACT logging
        if (process.env.DEBUG_CARD_CONTRACT === 'true') {
            console.log('[api/chat] Card Contract Debug:', {
                prompt: userMessage.substring(0, 100),
                executionRequestKind: executionRequest?.kind || 'none',
                draftCreated: !!serverDraftId,
                draftId: serverDraftId || 'none',
                draftLocation: serverDraftId ? 'portfolio.strategies' : 'none',
                portfolioStrategiesCount: portfolioAfter.strategies.length,
                portfolioStrategiesIds: portfolioAfter.strategies.map((s) => ({ id: s.id, status: s.status, type: s.type })),
            });
        }
        // Debug logging for contract verification (Task C)
        if (process.env.DEBUG_RESPONSE === 'true') {
            const redactedResponse = JSON.parse(JSON.stringify(response));
            // Redact secrets (private keys, signatures) but keep structure
            if (redactedResponse.executionRequest) {
                // Remove any sensitive fields from executionRequest if present
                delete redactedResponse.executionRequest.privateKey;
                delete redactedResponse.executionRequest.signature;
            }
            console.log('[api/chat] Response JSON:', JSON.stringify(redactedResponse, null, 2));
        }
        // Log execution artifacts if enabled
        if (process.env.DEBUG_EXECUTIONS === '1' && executionResults.length > 0) {
            executionResults.forEach(result => {
                logExecutionArtifact({
                    executionRequest,
                    executionResult: result,
                    userAddress: req.body.clientPortfolio?.userAddress,
                });
            });
        }
        // Telemetry: log chat response
        logEvent('chat_response', {
            success: modelOk,
            latencyMs: Date.now() - chatStartTime,
            notes: [`actions: ${actions.length}`, executionRequest ? `kind: ${executionRequest.kind}` : 'no_exec'],
        });
        res.json(response);
    }
    catch (error) {
        console.error('Chat error:', error);
        logEvent('chat_response', {
            success: false,
            error: error.message,
            latencyMs: Date.now() - chatStartTime,
        });
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});
/**
 * POST /api/strategy/close
 */
app.post('/api/strategy/close', async (req, res) => {
    try {
        const { strategyId, type } = req.body;
        if (!strategyId || !type) {
            return res.status(400).json({ error: 'strategyId and type are required' });
        }
        let summaryMessage = '';
        let pnl = 0;
        let eventResult;
        if (type === 'perp') {
            const result = await perpsSim.closePerp(strategyId);
            pnl = result.pnl;
            summaryMessage = `Closed ${result.position.market} ${result.position.side} position. Realized PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
        }
        else if (type === 'event') {
            const result = await eventSim.closeEventPosition(strategyId);
            pnl = result.pnl;
            const outcome = result.position.outcome === 'won' ? 'Won' : 'Lost';
            let pnlMessage = `Realized PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
            if (result.liveMarkToMarketUsd !== undefined) {
                pnlMessage += ` (Live MTM: ${result.liveMarkToMarketUsd >= 0 ? '+' : ''}$${result.liveMarkToMarketUsd.toFixed(2)})`;
                eventResult = { liveMarkToMarketUsd: result.liveMarkToMarketUsd };
            }
            summaryMessage = `Settled event position "${result.position.label}" (${outcome}). ${pnlMessage}`;
        }
        else if (type === 'defi') {
            const result = defiSim.closeDefiPosition(strategyId);
            pnl = result.yieldEarned;
            summaryMessage = `Closed ${result.position.protocol} position. Yield earned: $${pnl.toFixed(2)}`;
        }
        else {
            return res.status(400).json({ error: `Unknown strategy type: ${type}` });
        }
        // Build updated portfolio snapshot
        const portfolio = buildPortfolioSnapshot();
        // If this was an event close with liveMarkToMarketUsd, attach it to the strategy in the portfolio
        if (type === 'event' && eventResult?.liveMarkToMarketUsd !== undefined) {
            const strategyIndex = portfolio.strategies.findIndex((s) => s.id === strategyId);
            if (strategyIndex >= 0) {
                portfolio.strategies[strategyIndex] = {
                    ...portfolio.strategies[strategyIndex],
                    liveMarkToMarketUsd: eventResult.liveMarkToMarketUsd,
                };
            }
        }
        const response = {
            summaryMessage,
            portfolio,
        };
        res.json(response);
    }
    catch (error) {
        console.error('Close strategy error:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});
/**
 * POST /api/reset
 * V1/V1.1: Only resets chat state (no portfolio reset)
 * SIM mode: Resets simulation state (only if ALLOW_SIM_MODE=true)
 */
app.post('/api/reset', async (req, res) => {
    try {
        const { EXECUTION_MODE } = await import('../config');
        const ALLOW_SIM_MODE = process.env.ALLOW_SIM_MODE === 'true';
        // In SIM mode with explicit permission, reset simulation state
        if (EXECUTION_MODE === 'sim' && ALLOW_SIM_MODE) {
            resetAllSims();
            const snapshot = getPortfolioSnapshot();
            res.json({
                portfolio: snapshot,
                message: 'Simulation state reset.'
            });
            return;
        }
        // V1/V1.1: Only reset chat state (no portfolio reset)
        res.json({
            message: 'Chat state reset.'
        });
    }
    catch (err) {
        console.error('Failed to reset state', err);
        res.status(500).json({ error: 'Failed to reset state' });
    }
});
/**
 * GET /api/ticker
 */
app.get('/api/ticker', async (req, res) => {
    try {
        const venue = req.query.venue || 'hyperliquid';
        if (venue === 'event_demo') {
            const payload = await getEventMarketsTicker();
            res.json({
                venue: payload.venue,
                sections: payload.sections,
                lastUpdatedMs: payload.lastUpdatedMs ?? Date.now(),
                isLive: payload.isLive ?? false,
                source: payload.source ?? 'static',
            });
        }
        else {
            const payload = await getOnchainTicker();
            res.json({
                venue: payload.venue,
                sections: payload.sections,
                lastUpdatedMs: payload.lastUpdatedMs ?? Date.now(),
                isLive: payload.isLive ?? false,
                source: payload.source ?? 'static',
            });
        }
    }
    catch (error) {
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
                lastUpdatedMs: Date.now(),
                isLive: false,
                source: 'static',
            });
        }
        else {
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
                lastUpdatedMs: Date.now(),
                isLive: false,
                source: 'static',
            });
        }
    }
});
/**
 * POST /api/execute/prepare
 * Prepare execution plan for ETH testnet
 */
app.post('/api/execute/prepare', maybeCheckAccess, async (req, res) => {
    const prepareStartTime = Date.now();
    try {
        const { EXECUTION_MODE, EXECUTION_DISABLED, V1_DEMO } = await import('../config');
        // V1: Emergency kill switch
        if (EXECUTION_DISABLED) {
            return res.status(503).json({
                error: 'Execution temporarily disabled',
                errorCode: 'EXECUTION_DISABLED',
                message: 'Execution has been temporarily disabled. Please try again later.',
            });
        }
        if (EXECUTION_MODE !== 'eth_testnet') {
            return res.status(400).json({
                error: 'Execute endpoint only available in eth_testnet mode',
            });
        }
        // V1_DEMO: Block direct execution if session not enabled
        if (V1_DEMO && req.body.authMode !== 'session') {
            return res.status(403).json({
                error: 'V1_DEMO mode requires session-based execution',
                errorCode: 'V1_DEMO_DIRECT_BLOCKED',
                message: 'Direct execution is disabled in V1_DEMO mode. Please enable one-click execution first.',
            });
        }
        const { prepareEthTestnetExecution } = await import('../executors/ethTestnetExecutor');
        // Accept executionRequest from chat or fallback to executionIntent
        const result = await prepareEthTestnetExecution(req.body);
        // Include demo token addresses for frontend approval flow
        const { DEMO_REDACTED_ADDRESS, DEMO_WETH_ADDRESS, EXECUTION_ROUTER_ADDRESS } = await import('../config');
        // Telemetry: log prepare success
        const actionTypes = result.plan?.actions?.map((a) => a.actionType) || [];
        logEvent('prepare_success', {
            draftId: req.body.draftId,
            userHash: req.body.userAddress ? hashAddress(req.body.userAddress) : undefined,
            authMode: req.body.authMode,
            actionTypes,
            executionKind: req.body.executionKind,
            latencyMs: Date.now() - prepareStartTime,
            success: true,
        });
        res.json({
            chainId: result.chainId,
            to: result.to,
            value: result.value,
            plan: result.plan,
            planHash: result.planHash, // V1: Include server-computed planHash
            typedData: result.typedData,
            call: result.call,
            requirements: result.requirements,
            summary: result.summary,
            warnings: result.warnings,
            routing: result.routing, // Include routing metadata for demo swaps
            demoTokens: DEMO_REDACTED_ADDRESS && DEMO_WETH_ADDRESS ? {
                DEMO_REDACTED: DEMO_REDACTED_ADDRESS,
                DEMO_WETH: DEMO_WETH_ADDRESS,
                routerAddress: EXECUTION_ROUTER_ADDRESS,
            } : undefined,
        });
    }
    catch (error) {
        console.error('[api/execute/prepare] Error:', error);
        logEvent('prepare_fail', {
            draftId: req.body.draftId,
            error: error.message,
            latencyMs: Date.now() - prepareStartTime,
            success: false,
        });
        res.status(500).json({
            error: 'Failed to prepare execution',
            message: error.message,
        });
    }
});
/**
 * POST /api/setup/approve
 * Prepare ERC20 approval transaction
 */
app.post('/api/setup/approve', maybeCheckAccess, async (req, res) => {
    try {
        const { userAddress, tokenAddress, spenderAddress, amount } = req.body;
        if (!userAddress || !tokenAddress || !spenderAddress || !amount) {
            return res.status(400).json({
                error: 'userAddress, tokenAddress, spenderAddress, and amount are required',
            });
        }
        // Telemetry: log approve prepare
        logEvent('approve_prepare', {
            userHash: userAddress ? hashAddress(userAddress) : undefined,
            notes: [tokenAddress.substring(0, 10) + '...', spenderAddress.substring(0, 10) + '...'],
        });
        // Encode approve function call
        const { encodeFunctionData } = await import('viem');
        const approveAbi = [
            {
                name: 'approve',
                type: 'function',
                stateMutability: 'nonpayable',
                inputs: [
                    { name: 'spender', type: 'address' },
                    { name: 'amount', type: 'uint256' },
                ],
                outputs: [{ name: '', type: 'bool' }],
            },
        ];
        // Handle MaxUint256 string
        const amountBigInt = amount === 'MaxUint256'
            ? BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
            : BigInt(amount);
        const data = encodeFunctionData({
            abi: approveAbi,
            functionName: 'approve',
            args: [spenderAddress, amountBigInt],
        });
        const { ETH_TESTNET_CHAIN_ID } = await import('../config');
        res.json({
            chainId: ETH_TESTNET_CHAIN_ID,
            to: tokenAddress,
            data,
            value: '0x0',
            summary: `Approve ${spenderAddress.substring(0, 10)}... to spend tokens`,
        });
    }
    catch (error) {
        console.error('[api/setup/approve] Error:', error);
        res.status(500).json({
            error: 'Failed to prepare approval',
            message: error.message,
        });
    }
});
/**
 * POST /api/execute/submit
 * Submit transaction hash after execution
 * Returns unified ExecutionResult with receipt confirmation in eth_testnet mode
 */
app.post('/api/execute/submit', maybeCheckAccess, async (req, res) => {
    const submitStartTime = Date.now();
    try {
        const { draftId, txHash, userAddress } = req.body;
        if (!draftId || !txHash) {
            return res.status(400).json({
                error: 'draftId and txHash are required',
            });
        }
        // Telemetry: log submit
        logEvent('submit_tx', {
            draftId,
            txHash,
            userHash: userAddress ? hashAddress(userAddress) : undefined,
        });
        // Get portfolio before
        const portfolioBefore = buildPortfolioSnapshot();
        const { EXECUTION_MODE, ETH_TESTNET_RPC_URL } = await import('../config');
        // In eth_testnet mode, wait for receipt confirmation
        let receiptStatus = 'confirmed';
        let blockNumber;
        let receiptError;
        if (EXECUTION_MODE === 'eth_testnet' && ETH_TESTNET_RPC_URL) {
            const receiptResult = await waitForReceipt(ETH_TESTNET_RPC_URL, txHash, {
                timeoutMs: 60000,
                pollMs: 2000,
            });
            receiptStatus = receiptResult.status;
            blockNumber = receiptResult.blockNumber;
            receiptError = receiptResult.error;
            // Telemetry: log receipt result
            if (receiptStatus === 'confirmed') {
                logEvent('tx_confirmed', {
                    draftId,
                    txHash,
                    blockNumber,
                    latencyMs: Date.now() - submitStartTime,
                    success: true,
                });
            }
            else if (receiptStatus === 'failed') {
                logEvent('tx_failed', {
                    draftId,
                    txHash,
                    blockNumber,
                    error: receiptError,
                    success: false,
                });
            }
            else if (receiptStatus === 'timeout') {
                logEvent('tx_timeout', {
                    draftId,
                    txHash,
                    error: receiptError,
                    success: false,
                });
            }
        }
        const portfolioAfter = buildPortfolioSnapshot();
        // Build response based on receipt status
        // Map receipt status to ExecutionResult status (which only supports 'success' | 'failed')
        const mappedStatus = receiptStatus === 'confirmed' ? 'success' : 'failed';
        const result = {
            success: receiptStatus === 'confirmed',
            status: mappedStatus,
            txHash,
            receiptStatus,
            blockNumber,
            error: receiptError,
            portfolioDelta: {
                accountValueDeltaUsd: portfolioAfter.accountValueUsd - portfolioBefore.accountValueUsd,
                balanceDeltas: portfolioAfter.balances.map(b => {
                    const before = portfolioBefore.balances.find(b2 => b2.symbol === b.symbol);
                    return {
                        symbol: b.symbol,
                        deltaUsd: b.balanceUsd - (before?.balanceUsd || 0),
                    };
                }),
            },
            portfolio: portfolioAfter,
        };
        // Task 4: Add execution path proof for direct execution
        res.json({
            ...result,
            notes: ['execution_path:direct'], // Task 4: Unambiguous evidence of execution path
        });
    }
    catch (error) {
        console.error('[api/execute/submit] Error:', error);
        logEvent('error', {
            error: error.message,
            notes: ['submit_tx_error'],
        });
        const portfolioAfter = buildPortfolioSnapshot();
        const result = {
            success: false,
            status: 'failed',
            error: error.message || 'Failed to submit transaction',
            portfolio: portfolioAfter,
        };
        res.status(500).json(result);
    }
});
/**
 * GET /api/execute/preflight
 * Preflight check for execution readiness
 */
app.get('/api/execute/preflight', async (req, res) => {
    try {
        const { EXECUTION_MODE } = await import('../config');
        const ALLOW_SIM_MODE = process.env.ALLOW_SIM_MODE === 'true';
        // Only allow SIM mode if explicitly enabled
        if (EXECUTION_MODE === 'sim' && ALLOW_SIM_MODE) {
            return res.json({
                mode: 'sim',
                ok: true,
                notes: ['sim mode'],
            });
        }
        // If SIM requested but not allowed, treat as eth_testnet
        if (EXECUTION_MODE === 'sim' && !ALLOW_SIM_MODE) {
            // Fall through to eth_testnet handling
        }
        if (EXECUTION_MODE !== 'eth_testnet') {
            return res.status(400).json({
                error: 'Preflight endpoint only available in sim or eth_testnet mode',
            });
        }
        const { ETH_TESTNET_RPC_URL, EXECUTION_ROUTER_ADDRESS, MOCK_SWAP_ADAPTER_ADDRESS, requireEthTestnetConfig, } = await import('../config');
        const notes = [];
        let ok = true;
        // Validate config
        try {
            requireEthTestnetConfig();
        }
        catch (error) {
            ok = false;
            notes.push(`Config error: ${error.message}`);
        }
        // Check RPC connectivity
        let rpcOk = false;
        if (ETH_TESTNET_RPC_URL) {
            try {
                const response = await fetch(ETH_TESTNET_RPC_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: 1,
                        method: 'eth_blockNumber',
                        params: [],
                    }),
                });
                rpcOk = response.ok;
                if (!rpcOk) {
                    notes.push('RPC call failed');
                }
            }
            catch (error) {
                notes.push(`RPC error: ${error.message}`);
            }
        }
        else {
            notes.push('ETH_TESTNET_RPC_URL not configured');
        }
        // Check router deployment
        let routerOk = false;
        if (EXECUTION_ROUTER_ADDRESS && ETH_TESTNET_RPC_URL && rpcOk) {
            try {
                const { eth_getCode } = await import('../executors/evmRpc');
                const code = await eth_getCode(ETH_TESTNET_RPC_URL, EXECUTION_ROUTER_ADDRESS);
                routerOk = code !== '0x' && code.length > 2;
                if (!routerOk) {
                    notes.push('Router contract not deployed at EXECUTION_ROUTER_ADDRESS');
                }
            }
            catch (error) {
                notes.push(`Router check error: ${error.message}`);
            }
        }
        else {
            notes.push('Cannot check router: missing EXECUTION_ROUTER_ADDRESS or RPC');
        }
        // Check adapter allowlist (if router is deployed)
        let adapterOk = false;
        if (routerOk && MOCK_SWAP_ADAPTER_ADDRESS && ETH_TESTNET_RPC_URL) {
            try {
                const { eth_call } = await import('../executors/evmRpc');
                const { encodeFunctionData } = await import('viem');
                if (!EXECUTION_ROUTER_ADDRESS) {
                    throw new Error('EXECUTION_ROUTER_ADDRESS not configured');
                }
                // Call router.isAdapterAllowed(address) - public mapping getter
                const data = encodeFunctionData({
                    abi: [
                        {
                            name: 'isAdapterAllowed',
                            type: 'function',
                            stateMutability: 'view',
                            inputs: [{ name: '', type: 'address' }],
                            outputs: [{ name: '', type: 'bool' }],
                        },
                    ],
                    functionName: 'isAdapterAllowed',
                    args: [MOCK_SWAP_ADAPTER_ADDRESS],
                });
                // Debug logging (safe: no secrets)
                console.log('[preflight] Adapter check:', {
                    method: 'eth_call',
                    to: EXECUTION_ROUTER_ADDRESS,
                    data: data,
                    dataLength: data.length,
                });
                // Ensure data is valid hex (at least "0x")
                if (!data || !data.startsWith('0x') || data.length < 4) {
                    throw new Error(`Invalid call data: ${data}`);
                }
                const result = await eth_call(ETH_TESTNET_RPC_URL, EXECUTION_ROUTER_ADDRESS, data);
                const { decodeBool } = await import('../executors/evmRpc');
                adapterOk = decodeBool(result);
                if (!adapterOk) {
                    notes.push('Adapter not allowlisted in router');
                }
            }
            catch (error) {
                notes.push(`Adapter check error: ${error.message}`);
                console.error('[preflight] Adapter check failed:', error);
            }
        }
        // Check nonce fetching capability
        // Use eth_getTransactionCount instead of eth_call for simpler, more reliable check
        let nonceOk = false;
        if (routerOk && ETH_TESTNET_RPC_URL) {
            try {
                if (!EXECUTION_ROUTER_ADDRESS) {
                    throw new Error('EXECUTION_ROUTER_ADDRESS not configured');
                }
                // Use a test address to check nonce fetching
                const testAddress = '0x' + '1'.repeat(40);
                // Debug logging (safe: no secrets)
                console.log('[preflight] Nonce check:', {
                    method: 'eth_getTransactionCount',
                    address: testAddress,
                });
                // Use eth_getTransactionCount for nonce check (simpler and more reliable)
                const response = await fetch(ETH_TESTNET_RPC_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: 1,
                        method: 'eth_getTransactionCount',
                        params: [testAddress.toLowerCase(), 'latest'],
                    }),
                });
                const jsonResult = await response.json();
                const result = jsonResult;
                if (result.error) {
                    throw new Error(`RPC error: ${result.error.message || 'Unknown error'}`);
                }
                // If we get a result (even "0x0"), nonce fetching works
                nonceOk = result.result !== undefined;
            }
            catch (error) {
                notes.push(`Nonce check error: ${error.message}`);
                console.error('[preflight] Nonce check failed:', error);
            }
        }
        if (!rpcOk || !routerOk || !adapterOk || !nonceOk) {
            ok = false;
        }
        // Check routing configuration
        const { ROUTING_MODE, ONEINCH_API_KEY, EXECUTION_SWAP_MODE, } = await import('../config');
        // Check 1inch connectivity
        let oneinchOk = false;
        if (ONEINCH_API_KEY) {
            try {
                // Quick health check: try to get a quote for a small swap
                const testResponse = await fetch(`https://api.1inch.dev/swap/v6.0/11155111/quote?src=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48&dst=0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2&amount=1000000`, {
                    headers: {
                        'Authorization': `Bearer ${ONEINCH_API_KEY}`,
                        'Accept': 'application/json',
                    },
                    signal: AbortSignal.timeout(3000), // 3s timeout
                });
                oneinchOk = testResponse.ok;
            }
            catch (error) {
                // Timeout or network error - not critical
                oneinchOk = false;
            }
        }
        const routingStatus = {
            mode: ROUTING_MODE,
            liveRoutingEnabled: ROUTING_MODE === 'hybrid',
            hasApiKey: !!ONEINCH_API_KEY,
            connectivityOk: oneinchOk,
            executionMode: EXECUTION_SWAP_MODE,
        };
        if (ROUTING_MODE === 'hybrid') {
            if (oneinchOk) {
                notes.push('Live routing: enabled (1inch - connected)');
            }
            else {
                notes.push('Live routing: enabled (1inch - API key present but connectivity check failed)');
            }
        }
        else {
            notes.push('Live routing: disabled (deterministic fallback)');
        }
        if (EXECUTION_SWAP_MODE === 'demo') {
            notes.push('Swap execution: deterministic demo venue');
        }
        // Check lending configuration
        const { DEMO_LEND_VAULT_ADDRESS, DEMO_LEND_ADAPTER_ADDRESS, LENDING_EXECUTION_MODE, LENDING_RATE_SOURCE, } = await import('../config');
        // Check DefiLlama connectivity
        let defillamaOk = false;
        if (LENDING_RATE_SOURCE === 'defillama') {
            try {
                const testResponse = await fetch('https://yields.llama.fi/pools', {
                    headers: { 'Accept': 'application/json' },
                    signal: AbortSignal.timeout(3000), // 3s timeout
                });
                defillamaOk = testResponse.ok;
            }
            catch (error) {
                // Timeout or network error - not critical
                defillamaOk = false;
            }
        }
        const lendingStatus = {
            enabled: !!DEMO_LEND_VAULT_ADDRESS && !!DEMO_LEND_ADAPTER_ADDRESS,
            mode: LENDING_EXECUTION_MODE || 'demo',
            vault: DEMO_LEND_VAULT_ADDRESS || null,
            adapter: DEMO_LEND_ADAPTER_ADDRESS || null,
            rateSource: LENDING_RATE_SOURCE || 'demo',
            defillamaOk,
        };
        if (lendingStatus.enabled) {
            if (LENDING_RATE_SOURCE === 'defillama' && defillamaOk) {
                notes.push(`Lending: enabled (${lendingStatus.mode}, DefiLlama - connected)`);
            }
            else if (LENDING_RATE_SOURCE === 'defillama') {
                notes.push(`Lending: enabled (${lendingStatus.mode}, DefiLlama - connectivity check failed)`);
            }
            else {
                notes.push(`Lending: enabled (${lendingStatus.mode})`);
            }
        }
        else {
            notes.push('Lending: disabled (vault or adapter not configured)');
        }
        // Check dFlow configuration
        const { DFLOW_ENABLED, DFLOW_API_KEY, DFLOW_BASE_URL, DFLOW_EVENTS_MARKETS_PATH, DFLOW_EVENTS_QUOTE_PATH, DFLOW_SWAPS_QUOTE_PATH, DFLOW_REQUIRE, } = await import('../config');
        const dflowStatus = {
            enabled: DFLOW_ENABLED,
            ok: DFLOW_ENABLED && !!DFLOW_API_KEY && !!DFLOW_BASE_URL,
            required: DFLOW_REQUIRE,
            capabilities: {
                eventsMarkets: DFLOW_ENABLED && !!DFLOW_EVENTS_MARKETS_PATH,
                eventsQuotes: DFLOW_ENABLED && !!DFLOW_EVENTS_QUOTE_PATH,
                swapsQuotes: DFLOW_ENABLED && !!DFLOW_SWAPS_QUOTE_PATH,
            },
        };
        if (DFLOW_ENABLED) {
            if (dflowStatus.ok) {
                const caps = [];
                if (dflowStatus.capabilities.eventsMarkets)
                    caps.push('events-markets');
                if (dflowStatus.capabilities.eventsQuotes)
                    caps.push('events-quotes');
                if (dflowStatus.capabilities.swapsQuotes)
                    caps.push('swaps-quotes');
                notes.push(`dFlow: enabled (${caps.join(', ') || 'no capabilities'})`);
            }
            else {
                notes.push('dFlow: enabled but not configured (missing API_KEY or BASE_URL)');
                if (DFLOW_REQUIRE) {
                    ok = false;
                    notes.push('dFlow is required but not properly configured');
                }
            }
        }
        else {
            notes.push('dFlow: disabled');
        }
        // Update routing notes based on dFlow
        if (ROUTING_MODE === 'dflow' && dflowStatus.capabilities.swapsQuotes) {
            notes.push('Live routing: enabled (dFlow)');
        }
        res.json({
            mode: 'eth_testnet',
            ok,
            chainId: 11155111,
            router: EXECUTION_ROUTER_ADDRESS || null,
            adapter: MOCK_SWAP_ADAPTER_ADDRESS || null,
            rpc: rpcOk,
            routing: routingStatus,
            lending: lendingStatus,
            dflow: dflowStatus,
            notes,
        });
    }
    catch (error) {
        console.error('[api/execute/preflight] Error:', error);
        res.status(500).json({
            error: 'Failed to run preflight check',
            message: error.message,
        });
    }
});
// Rate limiting for session endpoints (in-memory, per endpoint)
const sessionEndpointCooldowns = new Map();
const SESSION_COOLDOWN_MS = 1500;
function checkSessionCooldown(endpoint) {
    const now = Date.now();
    const lastCall = sessionEndpointCooldowns.get(endpoint);
    if (lastCall && (now - lastCall) < SESSION_COOLDOWN_MS) {
        return false; // Still in cooldown
    }
    sessionEndpointCooldowns.set(endpoint, now);
    return true; // Not in cooldown
}
/**
 * POST /api/session/prepare
 * Prepare session creation transaction
 * NEVER returns 400 - always returns 200 with enabled:false if not configured
 */
app.post('/api/session/prepare', async (req, res) => {
    try {
        const { EXECUTION_MODE, EXECUTION_AUTH_MODE } = await import('../config');
        // Accept both body and query params
        const userAddress = req.body?.userAddress || req.query?.userAddress;
        // Check cooldown (only log once per cooldown window)
        const cooldownKey = `prepare-${userAddress || 'empty'}`;
        const inCooldown = !checkSessionCooldown(cooldownKey);
        if (inCooldown && process.env.DEBUG_SESSION !== 'true') {
            // Skip logging if in cooldown and not debug mode
        }
        else if (process.env.DEBUG_SESSION === 'true') {
            console.log('[api/session/prepare] Request:', { userAddress, EXECUTION_MODE, EXECUTION_AUTH_MODE });
        }
        // If not in session mode, return enabled:false
        if (EXECUTION_MODE !== 'eth_testnet' || EXECUTION_AUTH_MODE !== 'session') {
            return res.json({
                ok: true,
                status: 'disabled', // Top-level status field for UI
                session: {
                    enabled: false,
                    reason: 'NOT_CONFIGURED',
                    required: ['EXECUTION_MODE=eth_testnet', 'EXECUTION_AUTH_MODE=session'],
                },
                cooldownMs: SESSION_COOLDOWN_MS,
            });
        }
        // If userAddress missing, return enabled:false
        if (!userAddress || typeof userAddress !== 'string') {
            return res.json({
                ok: true,
                status: 'not_created', // Top-level status field for UI
                session: {
                    enabled: false,
                    reason: 'MISSING_FIELDS',
                    required: ['userAddress'],
                },
                cooldownMs: SESSION_COOLDOWN_MS,
            });
        }
        // Telemetry: log session prepare
        logEvent('session_prepare', {
            userHash: hashAddress(userAddress),
            authMode: 'session',
        });
        const { EXECUTION_ROUTER_ADDRESS, MOCK_SWAP_ADAPTER_ADDRESS, UNISWAP_V3_ADAPTER_ADDRESS, WETH_WRAP_ADAPTER_ADDRESS, RELAYER_PRIVATE_KEY, requireRelayerConfig, } = await import('../config');
        requireRelayerConfig();
        // Generate session ID
        const { keccak256, toBytes, parseUnits } = await import('viem');
        const sessionId = keccak256(toBytes(userAddress + Date.now().toString()));
        // Derive relayer address from private key
        const { privateKeyToAccount } = await import('viem/accounts');
        const relayerAccount = privateKeyToAccount(RELAYER_PRIVATE_KEY);
        const executor = relayerAccount.address;
        // Set session parameters
        const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60); // 7 days
        const maxSpend = BigInt(parseUnits('10', 18)); // 10 ETH max spend (in wei)
        // Build allowed adapters list (include all configured adapters)
        const allowedAdapters = [];
        if (MOCK_SWAP_ADAPTER_ADDRESS) {
            allowedAdapters.push(MOCK_SWAP_ADAPTER_ADDRESS.toLowerCase());
        }
        if (UNISWAP_V3_ADAPTER_ADDRESS) {
            allowedAdapters.push(UNISWAP_V3_ADAPTER_ADDRESS.toLowerCase());
        }
        if (WETH_WRAP_ADAPTER_ADDRESS) {
            allowedAdapters.push(WETH_WRAP_ADAPTER_ADDRESS.toLowerCase());
        }
        if (allowedAdapters.length === 0) {
            return res.status(400).json({
                error: 'No adapters configured. At least one adapter must be configured.',
            });
        }
        // Encode createSession call
        const { encodeFunctionData } = await import('viem');
        const createSessionAbi = [
            {
                name: 'createSession',
                type: 'function',
                stateMutability: 'nonpayable',
                inputs: [
                    { name: 'sessionId', type: 'bytes32' },
                    { name: 'executor', type: 'address' },
                    { name: 'expiresAt', type: 'uint64' },
                    { name: 'maxSpend', type: 'uint256' },
                    { name: 'allowedAdapters', type: 'address[]' },
                ],
                outputs: [],
            },
        ];
        const data = encodeFunctionData({
            abi: createSessionAbi,
            functionName: 'createSession',
            args: [
                sessionId,
                executor,
                BigInt(expiresAt),
                maxSpend,
                allowedAdapters,
            ],
        });
        // V1: Return capability snapshot (caps, allowlists, approvals, expiresAt)
        const capabilitySnapshot = {
            sessionId,
            caps: {
                maxSpend: maxSpend.toString(),
                maxSpendUsd: '10000', // Approximate USD value of 10 ETH
                expiresAt: expiresAt.toString(),
                expiresAtIso: new Date(Number(expiresAt) * 1000).toISOString(),
            },
            allowlistedAdapters: allowedAdapters,
            approvals: [], // V1: Router approval handled during session creation
            expiresAt: Number(expiresAt),
        };
        // Return enabled:true with exact shape expected by frontend
        const prepareResponse = {
            ok: true,
            status: 'preparing', // Top-level status field for UI
            session: {
                enabled: true,
                sessionId,
                to: EXECUTION_ROUTER_ADDRESS,
                data,
                value: '0x0',
                summary: `Create session for ${userAddress.substring(0, 10)}... with executor ${executor.substring(0, 10)}...`,
                capabilitySnapshot, // V1: Include capability snapshot
            },
            cooldownMs: SESSION_COOLDOWN_MS,
        };
        // Debug logging for contract verification (Task C)
        if (process.env.DEBUG_RESPONSE === 'true') {
            const redactedResponse = JSON.parse(JSON.stringify(prepareResponse));
            // Redact calldata (contains sensitive info)
            if (redactedResponse.session?.data) {
                redactedResponse.session.data = redactedResponse.session.data.substring(0, 20) + '...';
            }
            console.log('[api/session/prepare] Response JSON:', JSON.stringify(redactedResponse, null, 2));
        }
        res.json(prepareResponse);
    }
    catch (error) {
        // Never throw - always return 200 with enabled:false
        if (process.env.DEBUG_SESSION === 'true') {
            console.error('[api/session/prepare] Error:', error);
        }
        res.json({
            ok: true,
            status: 'disabled', // Top-level status field for UI
            session: {
                enabled: false,
                reason: 'RPC_ERROR',
                required: ['RPC_OK'],
            },
            errorCode: 'RPC_ERROR',
            cooldownMs: SESSION_COOLDOWN_MS,
        });
    }
});
/**
 * POST /api/execute/relayed
 * Execute a plan using session permissions (relayed by backend)
 */
app.post('/api/execute/relayed', maybeCheckAccess, async (req, res) => {
    const relayedStartTime = Date.now();
    try {
        const { EXECUTION_MODE, EXECUTION_AUTH_MODE, EXECUTION_DISABLED, V1_DEMO } = await import('../config');
        // V1: Emergency kill switch
        if (EXECUTION_DISABLED) {
            return res.status(503).json({
                error: 'Execution temporarily disabled',
                errorCode: 'EXECUTION_DISABLED',
                message: 'Execution has been temporarily disabled. Please try again later.',
            });
        }
        // V1_DEMO: Enforce single-action plans for canonical flows
        if (V1_DEMO && req.body.plan && req.body.plan.actions && req.body.plan.actions.length !== 1) {
            return res.status(400).json({
                error: 'V1_DEMO mode requires single-action plans',
                errorCode: 'V1_DEMO_MULTI_ACTION_REJECTED',
                message: `Plan has ${req.body.plan.actions.length} actions. V1_DEMO mode only allows single-action plans.`,
            });
        }
        // Check if session is actually enabled (server-side check)
        let sessionEnabled = false;
        if (EXECUTION_MODE === 'eth_testnet' && EXECUTION_AUTH_MODE === 'session') {
            try {
                // Quick check: verify relayer and router are configured
                const { RELAYER_PRIVATE_KEY, EXECUTION_ROUTER_ADDRESS, ETH_TESTNET_RPC_URL } = await import('../config');
                if (RELAYER_PRIVATE_KEY && EXECUTION_ROUTER_ADDRESS && ETH_TESTNET_RPC_URL) {
                    // Optionally verify router has code (quick check with timeout)
                    try {
                        const codeResponse = await Promise.race([
                            fetch(ETH_TESTNET_RPC_URL, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    jsonrpc: '2.0',
                                    id: 1,
                                    method: 'eth_getCode',
                                    params: [EXECUTION_ROUTER_ADDRESS, 'latest'],
                                }),
                            }),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000)),
                        ]);
                        if (codeResponse.ok) {
                            const codeData = await codeResponse.json();
                            const code = codeData.result || '0x';
                            sessionEnabled = code !== '0x' && code.length > 2;
                        }
                    }
                    catch (error) {
                        // RPC check failed - treat as disabled
                        sessionEnabled = false;
                    }
                }
            }
            catch (error) {
                // Config check failed - treat as disabled
                sessionEnabled = false;
            }
        }
        // If session is disabled, force direct execution path (return success with notes)
        if (!sessionEnabled) {
            const portfolioAfter = buildPortfolioSnapshot();
            return res.json({
                success: true,
                status: 'success',
                notes: ['session_disabled_fell_back_to_direct'],
                portfolio: portfolioAfter,
                chainId: 11155111,
            });
        }
        const { draftId, userAddress, plan, sessionId } = req.body;
        if (!draftId || !userAddress || !plan || !sessionId) {
            // Missing required fields - fall back to direct mode
            const portfolioAfter = buildPortfolioSnapshot();
            return res.json({
                success: true,
                status: 'success',
                notes: ['session_disabled_fell_back_to_direct', 'missing_required_fields'],
                portfolio: portfolioAfter,
                chainId: 11155111,
            });
        }
        // STRICT SERVER-SIDE GUARDS
        const { EXECUTION_ROUTER_ADDRESS, UNISWAP_V3_ADAPTER_ADDRESS, WETH_WRAP_ADAPTER_ADDRESS, MOCK_SWAP_ADAPTER_ADDRESS, REDACTED_ADDRESS_SEPOLIA, WETH_ADDRESS_SEPOLIA, } = await import('../config');
        // Guard 1: Validate action count (max 4 for MVP)
        if (!plan.actions || !Array.isArray(plan.actions)) {
            return res.status(400).json({
                error: 'Plan must have actions array',
            });
        }
        if (plan.actions.length > 4) {
            return res.status(400).json({
                error: `Plan exceeds maximum action count (4). Got ${plan.actions.length} actions.`,
            });
        }
        if (plan.actions.length === 0) {
            return res.status(400).json({
                error: 'Plan must have at least one action',
            });
        }
        // Guard 2: Validate allowed adapters only
        const allowedAdapters = new Set();
        if (UNISWAP_V3_ADAPTER_ADDRESS) {
            allowedAdapters.add(UNISWAP_V3_ADAPTER_ADDRESS.toLowerCase());
        }
        if (WETH_WRAP_ADAPTER_ADDRESS) {
            allowedAdapters.add(WETH_WRAP_ADAPTER_ADDRESS.toLowerCase());
        }
        if (MOCK_SWAP_ADAPTER_ADDRESS) {
            allowedAdapters.add(MOCK_SWAP_ADAPTER_ADDRESS.toLowerCase());
        }
        for (const action of plan.actions) {
            const adapter = action.adapter?.toLowerCase();
            if (!adapter) {
                return res.status(400).json({
                    error: 'Action missing adapter address',
                });
            }
            if (!allowedAdapters.has(adapter)) {
                return res.status(400).json({
                    error: `Adapter ${adapter} not allowed. Allowed adapters: ${Array.from(allowedAdapters).join(', ')}`,
                });
            }
        }
        // Guard 3: Validate deadline (must be <= 10 minutes from now)
        const now = Math.floor(Date.now() / 1000);
        const deadline = parseInt(plan.deadline);
        const maxDeadline = now + 10 * 60; // 10 minutes
        if (deadline > maxDeadline) {
            return res.status(400).json({
                error: `Plan deadline too far in future. Maximum: ${maxDeadline} (10 minutes), got: ${deadline}`,
            });
        }
        if (deadline <= now) {
            return res.status(400).json({
                error: 'Plan deadline must be in the future',
            });
        }
        // Guard 4: Validate token allowlist (ETH/WETH/REDACTED only for MVP)
        const allowedTokens = new Set();
        if (WETH_ADDRESS_SEPOLIA) {
            allowedTokens.add(WETH_ADDRESS_SEPOLIA.toLowerCase());
        }
        if (REDACTED_ADDRESS_SEPOLIA) {
            allowedTokens.add(REDACTED_ADDRESS_SEPOLIA.toLowerCase());
        }
        // Decode actions to check tokens
        const { decodeAbiParameters, parseUnits } = await import('viem');
        for (const action of plan.actions) {
            if (action.actionType === 0) {
                // SWAP action - decode to check tokens
                try {
                    const decoded = decodeAbiParameters([
                        { type: 'address' }, // tokenIn
                        { type: 'address' }, // tokenOut
                        { type: 'uint24' }, // fee
                        { type: 'uint256' }, // amountIn
                        { type: 'uint256' }, // amountOutMin
                        { type: 'address' }, // recipient
                        { type: 'uint256' }, // deadline
                    ], action.data);
                    const tokenIn = decoded[0].toLowerCase();
                    const tokenOut = decoded[1].toLowerCase();
                    if (!allowedTokens.has(tokenIn)) {
                        return res.status(400).json({
                            error: `Token ${tokenIn} not allowed. Allowed tokens: ${Array.from(allowedTokens).join(', ')}`,
                        });
                    }
                    if (!allowedTokens.has(tokenOut)) {
                        return res.status(400).json({
                            error: `Token ${tokenOut} not allowed. Allowed tokens: ${Array.from(allowedTokens).join(', ')}`,
                        });
                    }
                    // Guard 5: Validate max amountIn per swap (e.g. 1 ETH worth)
                    const amountIn = decoded[3];
                    const maxAmountIn = BigInt(parseUnits('1', 18)); // 1 ETH max per swap
                    if (amountIn > maxAmountIn) {
                        return res.status(400).json({
                            error: `Swap amountIn exceeds maximum (1 ETH). Got ${amountIn.toString()}`,
                        });
                    }
                }
                catch (error) {
                    // If decode fails, might be session mode wrapped data - skip token validation
                    console.warn('[api/execute/relayed] Could not decode swap action, skipping token validation:', error.message);
                }
            }
        }
        // Guard 6: Validate value (max 1 ETH for WRAP actions)
        const planValue = BigInt(req.body.value || '0x0');
        const maxValue = BigInt(parseUnits('1', 18)); // 1 ETH max
        if (planValue > maxValue) {
            return res.status(400).json({
                error: `Plan value exceeds maximum (1 ETH). Got ${planValue.toString()}`,
            });
        }
        const { sendRelayedTx } = await import('../executors/relayer');
        // Encode executeWithSession call
        const { encodeFunctionData } = await import('viem');
        const executeWithSessionAbi = [
            {
                name: 'executeWithSession',
                type: 'function',
                stateMutability: 'nonpayable',
                inputs: [
                    { name: 'sessionId', type: 'bytes32' },
                    {
                        name: 'plan',
                        type: 'tuple',
                        components: [
                            { name: 'user', type: 'address' },
                            { name: 'nonce', type: 'uint256' },
                            { name: 'deadline', type: 'uint256' },
                            {
                                name: 'actions',
                                type: 'tuple[]',
                                components: [
                                    { name: 'actionType', type: 'uint8' },
                                    { name: 'adapter', type: 'address' },
                                    { name: 'data', type: 'bytes' },
                                ],
                            },
                        ],
                    },
                ],
                outputs: [],
            },
        ];
        const data = encodeFunctionData({
            abi: executeWithSessionAbi,
            functionName: 'executeWithSession',
            args: [
                sessionId,
                {
                    user: plan.user,
                    nonce: BigInt(plan.nonce),
                    deadline: BigInt(plan.deadline),
                    actions: plan.actions.map((a) => ({
                        actionType: a.actionType,
                        adapter: a.adapter,
                        data: a.data,
                    })),
                },
            ],
        });
        // Get portfolio before execution
        const portfolioBefore = buildPortfolioSnapshot();
        // V1: Compute planHash server-side (keccak256(abi.encode(plan)))
        const { keccak256, encodeAbiParameters } = await import('viem');
        const planHash = keccak256(encodeAbiParameters([
            { type: 'address' }, // user
            { type: 'uint256' }, // nonce
            { type: 'uint256' }, // deadline
            {
                type: 'tuple[]', // actions
                components: [
                    { type: 'uint8' }, // actionType
                    { type: 'address' }, // adapter
                    { type: 'bytes' }, // data
                ],
            },
        ], [
            plan.user,
            BigInt(plan.nonce),
            BigInt(plan.deadline),
            plan.actions.map((a) => ({
                actionType: a.actionType,
                adapter: a.adapter,
                data: a.data,
            })),
        ]));
        // Send relayed transaction
        const txHash = await sendRelayedTx({
            to: EXECUTION_ROUTER_ADDRESS,
            data,
            value: req.body.value || '0x0',
        });
        // V1: Wait for receipt confirmation (receipt.status === 1)
        const { ETH_TESTNET_RPC_URL } = await import('../config');
        let receiptStatus = 'pending';
        let blockNumber;
        let receiptError;
        if (ETH_TESTNET_RPC_URL) {
            const { waitForReceipt } = await import('../executors/evmReceipt');
            const receiptResult = await waitForReceipt(ETH_TESTNET_RPC_URL, txHash, {
                timeoutMs: 60000,
                pollMs: 2000,
            });
            receiptStatus = receiptResult.status;
            blockNumber = receiptResult.blockNumber;
            receiptError = receiptResult.error;
        }
        // V1: Only update portfolio if receipt.status === 1 (confirmed)
        const portfolioAfter = receiptStatus === 'confirmed'
            ? buildPortfolioSnapshot()
            : portfolioBefore;
        const result = {
            success: receiptStatus === 'confirmed',
            status: receiptStatus === 'confirmed' ? 'success' : 'failed',
            txHash,
            receiptStatus,
            blockNumber,
            planHash, // V1: Include server-computed planHash
            error: receiptError,
            portfolioDelta: {
                accountValueDeltaUsd: portfolioAfter.accountValueUsd - portfolioBefore.accountValueUsd,
                balanceDeltas: portfolioAfter.balances.map(b => {
                    const before = portfolioBefore.balances.find(b2 => b2.symbol === b.symbol);
                    return {
                        symbol: b.symbol,
                        deltaUsd: b.balanceUsd - (before?.balanceUsd || 0),
                    };
                }),
            },
            portfolio: portfolioAfter,
        };
        // Log execution artifact
        if (process.env.DEBUG_EXECUTIONS === '1') {
            logExecutionArtifact({
                executionRequest: null, // Not available in relayed endpoint
                plan: req.body.plan,
                executionResult: result,
                userAddress: req.body.userAddress,
                draftId: req.body.draftId,
            });
        }
        // Telemetry: log relayed tx
        const actionTypes = req.body.plan?.actions?.map((a) => a.actionType) || [];
        logEvent('relayed_tx', {
            draftId: req.body.draftId,
            userHash: req.body.userAddress ? hashAddress(req.body.userAddress) : undefined,
            txHash,
            actionTypes,
            authMode: 'session',
            latencyMs: Date.now() - relayedStartTime,
            success: true,
        });
        // Task 4: Add execution path proof
        // Task 4: Add execution path proof
        res.json({
            ...result,
            chainId: 11155111, // Sepolia
            explorerUrl: `https://sepolia.etherscan.io/tx/${txHash}`,
            notes: ['execution_path:relayed'], // Task 4: Unambiguous evidence of execution path
        });
    }
    catch (error) {
        console.error('[api/execute/relayed] Error:', error);
        // Determine error code for UI handling
        let errorCode = 'RELAYER_FAILED';
        if (error.message?.includes('session') || error.message?.includes('Session')) {
            errorCode = 'SESSION_EXPIRED';
        }
        else if (error.message?.includes('insufficient') || error.message?.includes('balance')) {
            errorCode = 'INSUFFICIENT_BALANCE';
        }
        else if (error.message?.includes('slippage') || error.message?.includes('amountOutMin')) {
            errorCode = 'SLIPPAGE_FAILURE';
        }
        const portfolioAfter = buildPortfolioSnapshot();
        const result = {
            success: false,
            status: 'failed',
            error: error.message || 'Failed to execute relayed transaction',
            portfolio: portfolioAfter,
        };
        // Log failed execution artifact
        if (process.env.DEBUG_EXECUTIONS === '1') {
            logExecutionArtifact({
                executionRequest: null,
                plan: req.body.plan,
                executionResult: result,
                userAddress: req.body.userAddress,
                draftId: req.body.draftId,
            });
        }
        res.status(500).json({
            ...result,
            errorCode,
        });
    }
});
/**
 * GET /api/session/status
 * Get session status (for feature detection and direct mode compatibility)
 * NEVER returns 400 - always returns 200 with enabled:false if not configured
 */
app.get('/api/session/status', async (req, res) => {
    try {
        const { EXECUTION_MODE, EXECUTION_AUTH_MODE } = await import('../config');
        // Accept both query and body params
        const userAddress = req.query?.userAddress || req.body?.userAddress;
        const sessionId = req.query?.sessionId || req.body?.sessionId;
        // Check cooldown
        const cooldownKey = `status-${userAddress || 'empty'}-${sessionId || 'empty'}`;
        const inCooldown = !checkSessionCooldown(cooldownKey);
        if (inCooldown && process.env.DEBUG_SESSION !== 'true') {
            // Skip logging if in cooldown
        }
        else if (process.env.DEBUG_SESSION === 'true') {
            console.log('[api/session/status] GET request:', { userAddress, sessionId, EXECUTION_MODE, EXECUTION_AUTH_MODE });
        }
        // In direct mode or sim mode, return enabled: false
        if (EXECUTION_MODE !== 'eth_testnet' || EXECUTION_AUTH_MODE !== 'session') {
            return res.json({
                ok: true,
                status: 'disabled', // Top-level status field for UI
                session: {
                    enabled: false,
                    reason: 'NOT_CONFIGURED',
                    required: ['EXECUTION_MODE=eth_testnet', 'EXECUTION_AUTH_MODE=session'],
                },
                mode: EXECUTION_AUTH_MODE || 'direct',
                cooldownMs: SESSION_COOLDOWN_MS,
            });
        }
        // If no sessionId provided, return enabled:false (no valid session exists)
        if (!sessionId || typeof sessionId !== 'string') {
            return res.json({
                ok: true,
                status: 'not_created', // Top-level status field for UI
                session: {
                    enabled: false,
                    reason: 'MISSING_FIELDS',
                    required: ['sessionId'],
                },
                mode: 'session',
                cooldownMs: SESSION_COOLDOWN_MS,
            });
        }
        // Check for active session on-chain (only if sessionId provided)
        const { EXECUTION_ROUTER_ADDRESS, ETH_TESTNET_RPC_URL } = await import('../config');
        if (!ETH_TESTNET_RPC_URL || !EXECUTION_ROUTER_ADDRESS) {
            return res.json({
                ok: true,
                status: 'disabled', // Top-level status field for UI
                session: {
                    enabled: false,
                    reason: 'NOT_CONFIGURED',
                    required: ['ETH_TESTNET_RPC_URL', 'EXECUTION_ROUTER_ADDRESS'],
                },
                mode: 'session',
                cooldownMs: SESSION_COOLDOWN_MS,
            });
        }
        try {
            // Read session from contract (with timeout)
            const { createPublicClient, http } = await import('viem');
            const { sepolia } = await import('viem/chains');
            const publicClient = createPublicClient({
                chain: sepolia,
                transport: http(ETH_TESTNET_RPC_URL),
            });
            const sessionAbi = [
                {
                    name: 'sessions',
                    type: 'function',
                    stateMutability: 'view',
                    inputs: [{ name: '', type: 'bytes32' }],
                    outputs: [
                        { name: 'owner', type: 'address' },
                        { name: 'executor', type: 'address' },
                        { name: 'expiresAt', type: 'uint64' },
                        { name: 'maxSpend', type: 'uint256' },
                        { name: 'spent', type: 'uint256' },
                        { name: 'active', type: 'bool' },
                    ],
                },
            ];
            const sessionResult = await Promise.race([
                publicClient.readContract({
                    address: EXECUTION_ROUTER_ADDRESS,
                    abi: sessionAbi,
                    functionName: 'sessions',
                    args: [sessionId],
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
            ]);
            const now = BigInt(Math.floor(Date.now() / 1000));
            let status = 'not_created';
            const { owner, executor, expiresAt, maxSpend, spent, active } = sessionResult;
            if (active) {
                if (expiresAt > now) {
                    status = 'active';
                }
                else {
                    status = 'expired';
                }
            }
            else if (owner !== '0x0000000000000000000000000000000000000000') {
                status = 'revoked';
            }
            // Only return enabled:true if session is active
            const statusResponse = {
                ok: true,
                status, // Top-level status field for UI (matches session.status)
                session: {
                    enabled: status === 'active',
                    status,
                    sessionId,
                    owner,
                    executor,
                    expiresAt: expiresAt.toString(),
                    maxSpend: maxSpend.toString(),
                    spent: spent.toString(),
                    active,
                },
                mode: 'session',
                cooldownMs: SESSION_COOLDOWN_MS,
            };
            // Debug logging for contract verification (Task C)
            if (process.env.DEBUG_RESPONSE === 'true') {
                console.log('[api/session/status] GET Response JSON:', JSON.stringify(statusResponse, null, 2));
            }
            return res.json(statusResponse);
        }
        catch (error) {
            // RPC error or timeout - return enabled:false
            if (process.env.DEBUG_SESSION === 'true') {
                console.warn('[api/session/status] RPC check failed:', error.message);
            }
            const errorResponse = {
                ok: true,
                status: 'not_created', // Top-level status field for UI
                session: {
                    enabled: false,
                    reason: error.message?.includes('timeout') ? 'RPC_ERROR' : 'MISSING_FIELDS',
                    required: error.message?.includes('timeout') ? ['RPC_OK'] : ['sessionId'],
                },
                mode: 'session',
                errorCode: error.message?.includes('timeout') ? 'RPC_ERROR' : undefined,
                cooldownMs: SESSION_COOLDOWN_MS,
            };
            // Debug logging for contract verification (Task C)
            if (process.env.DEBUG_RESPONSE === 'true') {
                console.log('[api/session/status] GET Error Response JSON:', JSON.stringify(errorResponse, null, 2));
            }
            return res.json(errorResponse);
        }
    }
    catch (error) {
        // Never throw - always return 200
        if (process.env.DEBUG_SESSION === 'true') {
            console.error('[api/session/status] Error:', error);
        }
        res.json({
            ok: true,
            status: 'disabled', // Top-level status field for UI
            session: {
                enabled: false,
                reason: 'RPC_ERROR',
                required: ['RPC_OK'],
            },
            errorCode: 'RPC_ERROR',
            cooldownMs: SESSION_COOLDOWN_MS,
        });
    }
});
/**
 * POST /api/session/status
 * Get detailed session status (active/expired/revoked)
 * NEVER returns 400 - always returns 200 with enabled:false if not configured
 * This is an alias for GET /api/session/status (same logic)
 */
app.post('/api/session/status', async (req, res) => {
    // Delegate to GET handler logic (same behavior)
    try {
        const { EXECUTION_MODE, EXECUTION_AUTH_MODE } = await import('../config');
        // Accept both body and query params
        const userAddress = req.body?.userAddress || req.query?.userAddress;
        const sessionId = req.body?.sessionId || req.query?.sessionId;
        // Check cooldown
        const cooldownKey = `status-${userAddress || 'empty'}-${sessionId || 'empty'}`;
        const inCooldown = !checkSessionCooldown(cooldownKey);
        if (inCooldown && process.env.DEBUG_SESSION !== 'true') {
            // Skip logging if in cooldown
        }
        else if (process.env.DEBUG_SESSION === 'true') {
            console.log('[api/session/status] POST request:', { userAddress, sessionId, EXECUTION_MODE, EXECUTION_AUTH_MODE });
        }
        // Task D: Check if session mode is properly configured (POST handler)
        const { RELAYER_PRIVATE_KEY: RELAYER_PRIVATE_KEY_POST, EXECUTION_ROUTER_ADDRESS: EXECUTION_ROUTER_ADDRESS_POST, ETH_TESTNET_RPC_URL: ETH_TESTNET_RPC_URL_POST } = await import('../config');
        const isSessionModeConfiguredPost = EXECUTION_MODE === 'eth_testnet' && EXECUTION_AUTH_MODE === 'session';
        const hasRequiredConfigPost = !!(RELAYER_PRIVATE_KEY_POST && EXECUTION_ROUTER_ADDRESS_POST && ETH_TESTNET_RPC_URL_POST);
        // In direct mode or sim mode, return enabled: false
        if (!isSessionModeConfiguredPost || !hasRequiredConfigPost) {
            const missing = [];
            if (!RELAYER_PRIVATE_KEY_POST)
                missing.push('RELAYER_PRIVATE_KEY');
            if (!EXECUTION_ROUTER_ADDRESS_POST)
                missing.push('EXECUTION_ROUTER_ADDRESS');
            if (!ETH_TESTNET_RPC_URL_POST)
                missing.push('ETH_TESTNET_RPC_URL');
            return res.json({
                ok: true,
                status: 'disabled', // Top-level status field for UI
                session: {
                    enabled: false,
                    reason: !isSessionModeConfiguredPost ? 'NOT_CONFIGURED' : 'MISSING_CONFIG',
                    required: !isSessionModeConfiguredPost
                        ? ['EXECUTION_MODE=eth_testnet', 'EXECUTION_AUTH_MODE=session']
                        : missing,
                },
                mode: EXECUTION_AUTH_MODE || 'direct',
                cooldownMs: SESSION_COOLDOWN_MS,
            });
        }
        // If no sessionId provided, return enabled:false
        if (!sessionId || typeof sessionId !== 'string') {
            return res.json({
                ok: true,
                status: 'not_created', // Top-level status field for UI
                session: {
                    enabled: false,
                    reason: 'MISSING_FIELDS',
                    required: ['sessionId'],
                },
                mode: 'session',
                cooldownMs: SESSION_COOLDOWN_MS,
            });
        }
        const { EXECUTION_ROUTER_ADDRESS, ETH_TESTNET_RPC_URL } = await import('../config');
        // Check for active session on-chain (only if sessionId provided)
        if (!ETH_TESTNET_RPC_URL || !EXECUTION_ROUTER_ADDRESS) {
            return res.json({
                ok: true,
                status: 'not_created', // Top-level status field for UI
                session: {
                    enabled: false,
                    reason: 'NOT_CONFIGURED',
                    required: ['ETH_TESTNET_RPC_URL', 'EXECUTION_ROUTER_ADDRESS'],
                },
                mode: 'session',
                cooldownMs: SESSION_COOLDOWN_MS,
            });
        }
        try {
            // Read session from contract (with timeout)
            const { createPublicClient, http } = await import('viem');
            const { sepolia } = await import('viem/chains');
            const publicClient = createPublicClient({
                chain: sepolia,
                transport: http(ETH_TESTNET_RPC_URL),
            });
            const sessionAbi = [
                {
                    name: 'sessions',
                    type: 'function',
                    stateMutability: 'view',
                    inputs: [{ name: '', type: 'bytes32' }],
                    outputs: [
                        { name: 'owner', type: 'address' },
                        { name: 'executor', type: 'address' },
                        { name: 'expiresAt', type: 'uint64' },
                        { name: 'maxSpend', type: 'uint256' },
                        { name: 'spent', type: 'uint256' },
                        { name: 'active', type: 'bool' },
                    ],
                },
            ];
            const sessionResult = await Promise.race([
                publicClient.readContract({
                    address: EXECUTION_ROUTER_ADDRESS,
                    abi: sessionAbi,
                    functionName: 'sessions',
                    args: [sessionId],
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
            ]);
            const now = BigInt(Math.floor(Date.now() / 1000));
            let status = 'not_created';
            const { owner, executor, expiresAt, maxSpend, spent, active } = sessionResult;
            if (active) {
                if (expiresAt > now) {
                    status = 'active';
                }
                else {
                    status = 'expired';
                }
            }
            else if (owner !== '0x0000000000000000000000000000000000000000') {
                status = 'revoked';
            }
            // Only return enabled:true if session is active
            return res.json({
                ok: true,
                status, // Top-level status field for UI (matches session.status)
                session: {
                    enabled: status === 'active',
                    status,
                    sessionId,
                    owner,
                    executor,
                    expiresAt: expiresAt.toString(),
                    maxSpend: maxSpend.toString(),
                    spent: spent.toString(),
                    active,
                },
                mode: 'session',
                cooldownMs: SESSION_COOLDOWN_MS,
            });
        }
        catch (error) {
            // RPC error, timeout, or session doesn't exist - return enabled:false
            if (process.env.DEBUG_SESSION === 'true') {
                console.warn('[api/session/status] RPC check failed or session not found:', error.message);
            }
            return res.json({
                ok: true,
                status: 'not_created', // Top-level status field for UI
                session: {
                    enabled: false,
                    reason: error.message?.includes('timeout') ? 'RPC_ERROR' : 'MISSING_FIELDS',
                    required: error.message?.includes('timeout') ? ['RPC_OK'] : ['sessionId'],
                },
                mode: 'session',
                errorCode: error.message?.includes('timeout') ? 'RPC_ERROR' : undefined,
                cooldownMs: SESSION_COOLDOWN_MS,
            });
        }
    }
    catch (error) {
        // Never throw - always return 200
        if (process.env.DEBUG_SESSION === 'true') {
            console.error('[api/session/status] Error:', error);
        }
        res.json({
            ok: true,
            session: {
                enabled: false,
                reason: 'RPC_ERROR',
                required: ['RPC_OK'],
            },
            errorCode: 'RPC_ERROR',
            cooldownMs: SESSION_COOLDOWN_MS,
        });
    }
});
/**
 * POST /api/session/revoke/prepare
 * Prepare session revocation transaction
 */
app.post('/api/session/revoke/prepare', async (req, res) => {
    try {
        const { EXECUTION_MODE, EXECUTION_AUTH_MODE } = await import('../config');
        if (EXECUTION_MODE !== 'eth_testnet' || EXECUTION_AUTH_MODE !== 'session') {
            return res.status(400).json({
                error: 'Session endpoint only available in eth_testnet mode with session auth',
            });
        }
        const { sessionId } = req.body;
        if (!sessionId || typeof sessionId !== 'string') {
            return res.status(400).json({
                error: 'sessionId is required',
            });
        }
        const { EXECUTION_ROUTER_ADDRESS } = await import('../config');
        // Encode revokeSession call
        const { encodeFunctionData } = await import('viem');
        const revokeSessionAbi = [
            {
                name: 'revokeSession',
                type: 'function',
                stateMutability: 'nonpayable',
                inputs: [{ name: 'sessionId', type: 'bytes32' }],
                outputs: [],
            },
        ];
        const data = encodeFunctionData({
            abi: revokeSessionAbi,
            functionName: 'revokeSession',
            args: [sessionId],
        });
        res.json({
            to: EXECUTION_ROUTER_ADDRESS,
            data,
            value: '0x0',
            summary: `Revoke session ${sessionId.substring(0, 10)}...`,
        });
    }
    catch (error) {
        console.error('[api/session/revoke/prepare] Error:', error);
        res.status(500).json({
            error: 'Failed to prepare session revocation',
            message: error.message,
        });
    }
});
/**
 * POST /api/token/weth/wrap/prepare
 * Prepare WETH wrap transaction (ETH → WETH)
 */
app.post('/api/token/weth/wrap/prepare', async (req, res) => {
    try {
        const { amount, userAddress } = req.body;
        if (!amount || !userAddress) {
            return res.status(400).json({
                error: 'amount and userAddress are required',
            });
        }
        // Validate address format
        const addressRegex = /^0x[a-fA-F0-9]{40}$/;
        if (!addressRegex.test(userAddress)) {
            return res.status(400).json({
                error: 'Invalid userAddress format',
            });
        }
        const { WETH_ADDRESS_SEPOLIA } = await import('../config');
        if (!WETH_ADDRESS_SEPOLIA) {
            return res.status(500).json({
                error: 'WETH_ADDRESS_SEPOLIA not configured',
            });
        }
        // WETH.deposit() is payable, so data is just the function selector
        // Function selector: deposit() = 0xd0e30db0
        const data = '0xd0e30db0';
        // Convert amount to wei (18 decimals)
        const { parseUnits } = await import('viem');
        const amountWei = parseUnits(amount, 18);
        const value = '0x' + amountWei.toString(16);
        res.json({
            chainId: 11155111, // Sepolia
            to: WETH_ADDRESS_SEPOLIA.toLowerCase(),
            data,
            value,
            summary: `Wrap ${amount} ETH to WETH`,
        });
    }
    catch (error) {
        console.error('[api/token/weth/wrap/prepare] Error:', error);
        res.status(500).json({
            error: 'Failed to prepare wrap transaction',
            message: error.message,
        });
    }
});
/**
 * POST /api/token/approve/prepare
 * Prepare ERC20 approve transaction
 */
app.post('/api/token/approve/prepare', async (req, res) => {
    try {
        const { token, spender, amount, userAddress } = req.body;
        if (!token || !spender || !amount || !userAddress) {
            return res.status(400).json({
                error: 'token, spender, amount, and userAddress are required',
            });
        }
        // Validate address format
        const addressRegex = /^0x[a-fA-F0-9]{40}$/;
        if (!addressRegex.test(token) || !addressRegex.test(spender) || !addressRegex.test(userAddress)) {
            return res.status(400).json({
                error: 'Invalid address format',
            });
        }
        // Encode ERC20 approve call
        const { encodeFunctionData } = await import('viem');
        const approveAbi = [
            {
                name: 'approve',
                type: 'function',
                stateMutability: 'nonpayable',
                inputs: [
                    { name: 'spender', type: 'address' },
                    { name: 'amount', type: 'uint256' },
                ],
                outputs: [{ name: '', type: 'bool' }],
            },
        ];
        // Convert amount to bigint (handle hex or decimal string)
        const amountBigInt = typeof amount === 'string' && amount.startsWith('0x')
            ? BigInt(amount)
            : BigInt(amount);
        const data = encodeFunctionData({
            abi: approveAbi,
            functionName: 'approve',
            args: [spender, amountBigInt],
        });
        res.json({
            chainId: 11155111, // Sepolia
            to: token,
            data,
            value: '0x0',
            summary: `Approve ${spender.substring(0, 10)}... to spend tokens`,
        });
    }
    catch (error) {
        console.error('[api/token/approve/prepare] Error:', error);
        res.status(500).json({
            error: 'Failed to prepare approve transaction',
            message: error.message,
        });
    }
});
/**
 * GET /api/execute/status
 * Get transaction status by hash
 */
app.get('/api/execute/status', async (req, res) => {
    try {
        const { txHash } = req.query;
        if (!txHash || typeof txHash !== 'string') {
            return res.status(400).json({
                error: 'txHash query parameter is required',
            });
        }
        // Validate txHash format
        if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
            return res.status(400).json({
                error: 'Invalid txHash format (must be 0x followed by 64 hex characters)',
            });
        }
        // Check execution mode
        const executionMode = process.env.EXECUTION_MODE || 'sim';
        if (executionMode !== 'eth_testnet') {
            return res.json({
                status: 'unsupported',
                message: 'Transaction status tracking only available in eth_testnet mode',
            });
        }
        // Require RPC URL
        const { ETH_TESTNET_RPC_URL } = await import('../config');
        if (!ETH_TESTNET_RPC_URL) {
            return res.status(500).json({
                error: 'ETH_TESTNET_RPC_URL not configured',
            });
        }
        // Call eth_getTransactionReceipt
        const receiptResponse = await fetch(ETH_TESTNET_RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'eth_getTransactionReceipt',
                params: [txHash],
            }),
        });
        if (!receiptResponse.ok) {
            throw new Error(`RPC call failed: ${receiptResponse.statusText}`);
        }
        const jsonResult = await receiptResponse.json();
        const receiptResult = jsonResult;
        if (receiptResult.error) {
            throw new Error(`RPC error: ${receiptResult.error.message || JSON.stringify(receiptResult.error)}`);
        }
        const receipt = receiptResult.result;
        // If receipt is null, transaction is pending
        if (!receipt || receipt === null) {
            return res.json({
                status: 'pending',
                txHash,
            });
        }
        // Parse receipt status
        const statusHex = receipt.status;
        let status;
        if (statusHex === '0x1' || statusHex === '0x01') {
            status = 'confirmed';
        }
        else if (statusHex === '0x0' || statusHex === '0x00') {
            status = 'reverted';
        }
        else {
            // Unknown status, treat as pending
            return res.json({
                status: 'pending',
                txHash,
            });
        }
        // Build response
        const response = {
            status,
            txHash,
            blockNumber: receipt.blockNumber || null,
            gasUsed: receipt.gasUsed || null,
        };
        // Include to/from if available
        if (receipt.to) {
            response.to = receipt.to;
        }
        if (receipt.from) {
            response.from = receipt.from;
        }
        res.json(response);
    }
    catch (error) {
        console.error('[api/execute/status] Error:', error);
        res.status(500).json({
            error: 'Failed to fetch transaction status',
            message: error.message,
        });
    }
});
/**
 * GET /api/portfolio/eth_testnet
 * Get real token balances for a user address on Sepolia
 */
app.get('/api/portfolio/eth_testnet', maybeCheckAccess, async (req, res) => {
    try {
        const { userAddress } = req.query;
        if (!userAddress || typeof userAddress !== 'string') {
            return res.status(400).json({
                error: 'userAddress query parameter is required',
            });
        }
        // Validate address format
        if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
            return res.status(400).json({
                error: 'Invalid userAddress format',
            });
        }
        // Check execution mode
        const executionMode = process.env.EXECUTION_MODE || 'sim';
        if (executionMode !== 'eth_testnet') {
            return res.status(400).json({
                error: 'Portfolio endpoint only available in eth_testnet mode',
            });
        }
        // Require config
        const { ETH_TESTNET_RPC_URL, REDACTED_ADDRESS_SEPOLIA, WETH_ADDRESS_SEPOLIA } = await import('../config');
        if (!ETH_TESTNET_RPC_URL) {
            return res.status(500).json({
                error: 'ETH_TESTNET_RPC_URL not configured',
            });
        }
        if (!REDACTED_ADDRESS_SEPOLIA || !WETH_ADDRESS_SEPOLIA) {
            return res.status(500).json({
                error: 'REDACTED_ADDRESS_SEPOLIA and WETH_ADDRESS_SEPOLIA must be configured',
            });
        }
        // Import RPC helpers
        const { erc20_balanceOf } = await import('../executors/erc20Rpc');
        // Fetch ETH balance
        const ethBalanceResponse = await fetch(ETH_TESTNET_RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'eth_getBalance',
                params: [userAddress.toLowerCase(), 'latest'],
            }),
        });
        if (!ethBalanceResponse.ok) {
            throw new Error(`RPC call failed: ${ethBalanceResponse.statusText}`);
        }
        const ethResultUnknown = await ethBalanceResponse.json();
        const ethResult = ethResultUnknown;
        if (ethResult.error) {
            throw new Error(`RPC error: ${ethResult.error.message || JSON.stringify(ethResult.error)}`);
        }
        const ethWei = BigInt(ethResult.result || '0x0');
        const ethFormatted = (Number(ethWei) / 1e18).toFixed(6);
        // Fetch REDACTED balance
        const usdcBalance = await erc20_balanceOf(REDACTED_ADDRESS_SEPOLIA, userAddress);
        const usdcFormatted = (Number(usdcBalance) / 1e6).toFixed(2);
        // Fetch WETH balance
        const wethBalance = await erc20_balanceOf(WETH_ADDRESS_SEPOLIA, userAddress);
        const wethFormatted = (Number(wethBalance) / 1e18).toFixed(6);
        res.json({
            chainId: 11155111, // Sepolia
            userAddress: userAddress.toLowerCase(),
            balances: {
                eth: {
                    wei: '0x' + ethWei.toString(16),
                    formatted: ethFormatted,
                },
                usdc: {
                    raw: '0x' + usdcBalance.toString(16),
                    decimals: 6,
                    formatted: usdcFormatted,
                },
                weth: {
                    raw: '0x' + wethBalance.toString(16),
                    decimals: 18,
                    formatted: wethFormatted,
                },
            },
        });
    }
    catch (error) {
        console.error('[api/portfolio/eth_testnet] Error:', error);
        res.status(500).json({
            error: 'Failed to fetch portfolio balances',
            message: error.message,
        });
    }
});
/**
 * GET /api/wallet/balances
 * Bulletproof balance fetcher - always returns native ETH, optionally includes demo tokens
 * Never errors just because token addresses aren't configured
 */
app.get('/api/wallet/balances', maybeCheckAccess, async (req, res) => {
    try {
        const { address } = req.query;
        if (!address || typeof address !== 'string') {
            return res.status(400).json({
                error: 'address query parameter is required',
            });
        }
        // Validate address format
        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
            return res.status(400).json({
                error: 'Invalid address format',
            });
        }
        // Get config
        const { EXECUTION_MODE, ETH_TESTNET_RPC_URL, ETH_TESTNET_CHAIN_ID, DEMO_REDACTED_ADDRESS, DEMO_WETH_ADDRESS } = await import('../config');
        // Handle SIM mode - only if explicitly allowed
        const ALLOW_SIM_MODE = process.env.ALLOW_SIM_MODE === 'true';
        if (EXECUTION_MODE === 'sim' && ALLOW_SIM_MODE) {
            return res.json({
                chainId: 11155111,
                address: address.toLowerCase(),
                native: {
                    symbol: 'ETH',
                    wei: '0x0',
                    formatted: '0.0',
                },
                tokens: [],
                notes: ['SIM mode: returning zero balances'],
                timestamp: Date.now(),
            });
        }
        // If SIM mode requested but not allowed, treat as eth_testnet
        if (EXECUTION_MODE === 'sim' && !ALLOW_SIM_MODE) {
            // Fall through to eth_testnet handling
        }
        // In eth_testnet mode, RPC URL is required
        if (!ETH_TESTNET_RPC_URL) {
            return res.status(503).json({
                ok: false,
                code: 'RPC_NOT_CONFIGURED',
                message: 'ETH_TESTNET_RPC_URL is missing',
                fix: 'Set ETH_TESTNET_RPC_URL in agent/.env.local then restart backend.',
            });
        }
        const chainId = ETH_TESTNET_CHAIN_ID || 11155111;
        const tokens = [];
        const notes = [];
        // Fetch native ETH balance (always) with timeout
        let ethWei = BigInt(0);
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout
            const ethBalanceResponse = await fetch(ETH_TESTNET_RPC_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'eth_getBalance',
                    params: [address.toLowerCase(), 'latest'],
                }),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (ethBalanceResponse.ok) {
                const ethResultUnknown = await ethBalanceResponse.json();
                const ethResult = ethResultUnknown;
                if (!ethResult.error && ethResult.result) {
                    ethWei = BigInt(ethResult.result);
                }
                else if (ethResult.error) {
                    throw new Error(`RPC error: ${ethResult.error.message || JSON.stringify(ethResult.error)}`);
                }
            }
            else {
                throw new Error(`RPC HTTP error: ${ethBalanceResponse.status} ${ethBalanceResponse.statusText}`);
            }
        }
        catch (e) {
            // If timeout or network error, return structured error
            if (e.name === 'AbortError' || e.message?.includes('fetch')) {
                return res.status(503).json({
                    ok: false,
                    code: 'RPC_UNREACHABLE',
                    message: 'RPC endpoint is unreachable or timed out',
                    fix: 'Check ETH_TESTNET_RPC_URL in agent/.env.local and ensure RPC endpoint is accessible.',
                });
            }
            notes.push(`ETH balance fetch failed: ${e.message}`);
        }
        // Fetch demo token balances (if configured)
        if (DEMO_REDACTED_ADDRESS) {
            try {
                const { erc20_balanceOf } = await import('../executors/erc20Rpc');
                const balance = await erc20_balanceOf(DEMO_REDACTED_ADDRESS, address);
                tokens.push({
                    address: DEMO_REDACTED_ADDRESS,
                    symbol: 'REDACTED',
                    decimals: 6,
                    raw: '0x' + balance.toString(16),
                    formatted: (Number(balance) / 1e6).toFixed(2),
                });
            }
            catch (e) {
                notes.push(`REDACTED balance fetch failed: ${e.message}`);
            }
        }
        else {
            notes.push('DEMO_REDACTED_ADDRESS not configured');
        }
        if (DEMO_WETH_ADDRESS) {
            try {
                const { erc20_balanceOf } = await import('../executors/erc20Rpc');
                const balance = await erc20_balanceOf(DEMO_WETH_ADDRESS, address);
                tokens.push({
                    address: DEMO_WETH_ADDRESS,
                    symbol: 'WETH',
                    decimals: 18,
                    raw: '0x' + balance.toString(16),
                    formatted: (Number(balance) / 1e18).toFixed(6),
                });
            }
            catch (e) {
                notes.push(`WETH balance fetch failed: ${e.message}`);
            }
        }
        else {
            notes.push('DEMO_WETH_ADDRESS not configured');
        }
        const ethFormatted = (Number(ethWei) / 1e18).toFixed(6);
        res.json({
            chainId,
            address: address.toLowerCase(),
            native: {
                symbol: 'ETH',
                wei: '0x' + ethWei.toString(16),
                formatted: ethFormatted,
            },
            tokens,
            notes: notes.length > 0 ? notes : undefined,
            timestamp: Date.now(),
        });
    }
    catch (error) {
        console.error('[api/wallet/balances] Error:', error);
        res.status(500).json({
            error: 'Failed to fetch wallet balances',
            message: error.message,
        });
    }
});
/**
 * Health check endpoint
 * Simple endpoint that never depends on chain config - just confirms server is up
 */
app.get('/health', async (req, res) => {
    try {
        const { EXECUTION_MODE, ETH_TESTNET_RPC_URL, EXECUTION_ROUTER_ADDRESS, } = await import('../config');
        // Check API keys
        const hasGeminiKey = !!process.env.BLOSSOM_GEMINI_API_KEY;
        const hasOpenAIKey = !!process.env.BLOSSOM_OPENAI_API_KEY;
        const hasAnthropicKey = !!process.env.BLOSSOM_ANTHROPIC_API_KEY;
        const hasAnyLLMKey = hasGeminiKey || hasOpenAIKey || hasAnthropicKey;
        // Dev-safe debug info (no secrets, just lengths)
        const rpcUrlLen = ETH_TESTNET_RPC_URL ? ETH_TESTNET_RPC_URL.length : 0;
        const routerAddrLen = EXECUTION_ROUTER_ADDRESS ? EXECUTION_ROUTER_ADDRESS.length : 0;
        // V1/V1.1 validation: check required vars for eth_testnet mode
        const missing = [];
        let ok = true;
        if (EXECUTION_MODE === 'eth_testnet') {
            if (!ETH_TESTNET_RPC_URL) {
                missing.push('ETH_TESTNET_RPC_URL');
                ok = false;
            }
            if (!EXECUTION_ROUTER_ADDRESS) {
                missing.push('EXECUTION_ROUTER_ADDRESS');
                ok = false;
            }
            if (!hasAnyLLMKey) {
                missing.push('BLOSSOM_GEMINI_API_KEY (or BLOSSOM_OPENAI_API_KEY or BLOSSOM_ANTHROPIC_API_KEY)');
                ok = false;
            }
        }
        res.json({
            ok,
            ts: Date.now(),
            service: 'blossom-agent',
            executionMode: EXECUTION_MODE || 'eth_testnet',
            // Dev-safe debug info
            debug: {
                rpcUrlLen,
                routerAddrLen,
                hasRpcUrl: !!ETH_TESTNET_RPC_URL,
                hasRouterAddr: !!EXECUTION_ROUTER_ADDRESS,
                hasAnyLLMKey,
            },
            ...(missing.length > 0 && { missing }),
        });
    }
    catch (error) {
        // If config import fails, still return health
        res.json({
            ok: false,
            ts: Date.now(),
            service: 'blossom-agent',
            executionMode: 'unknown',
            missing: ['config_load_failed'],
            error: error instanceof Error ? error.message : 'unknown',
        });
    }
});
/**
 * Extended health check with LLM provider info (for debugging)
 */
app.get('/api/health', (req, res) => {
    // Get LLM provider info (non-sensitive)
    const provider = process.env.BLOSSOM_MODEL_PROVIDER || 'stub';
    const hasGeminiKey = !!process.env.BLOSSOM_GEMINI_API_KEY;
    const hasOpenAIKey = !!process.env.BLOSSOM_OPENAI_API_KEY;
    const hasAnthropicKey = !!process.env.BLOSSOM_ANTHROPIC_API_KEY;
    // Determine effective provider (fallback to stub if key missing)
    let effectiveProvider = provider;
    if (provider === 'gemini' && !hasGeminiKey) {
        effectiveProvider = 'stub';
    }
    else if (provider === 'openai' && !hasOpenAIKey) {
        effectiveProvider = 'stub';
    }
    else if (provider === 'anthropic' && !hasAnthropicKey) {
        effectiveProvider = 'stub';
    }
    res.json({
        ok: true,
        ts: Date.now(),
        service: 'blossom-agent',
        llmProvider: effectiveProvider, // Non-sensitive: just the provider name
    });
});
const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0'; // Bind to all interfaces by default
// Print startup banner with configuration status (Task C: Session config logging)
(async () => {
    try {
        const { EXECUTION_MODE, EXECUTION_AUTH_MODE, ETH_TESTNET_RPC_URL, EXECUTION_ROUTER_ADDRESS, RELAYER_PRIVATE_KEY, ETH_TESTNET_CHAIN_ID, } = await import('../config');
        // Check API keys from process.env (not exported from config)
        const hasGeminiKey = !!process.env.BLOSSOM_GEMINI_API_KEY;
        const hasOpenAIKey = !!process.env.BLOSSOM_OPENAI_API_KEY;
        const hasAnthropicKey = !!process.env.BLOSSOM_ANTHROPIC_API_KEY;
        // Task C: Redact RPC URL (show only first/last chars)
        const redactedRpcUrl = ETH_TESTNET_RPC_URL
            ? `${ETH_TESTNET_RPC_URL.substring(0, 20)}...${ETH_TESTNET_RPC_URL.substring(ETH_TESTNET_RPC_URL.length - 10)}`
            : 'not configured';
        // Task 3: Startup banner with chainId, router, adapter addresses
        if (EXECUTION_MODE === 'eth_testnet') {
            const { MOCK_SWAP_ADAPTER_ADDRESS, UNISWAP_V3_ADAPTER_ADDRESS, UNISWAP_ADAPTER_ADDRESS, WETH_WRAP_ADAPTER_ADDRESS, ERC20_PULL_ADAPTER_ADDRESS, PROOF_ADAPTER_ADDRESS, } = await import('../config');
            console.log(`\n🔧 ETH Testnet Execution Configuration`);
            console.log(`   Chain ID: ${ETH_TESTNET_CHAIN_ID || 'N/A'} (Sepolia: 11155111)`);
            console.log(`   Router Address: ${EXECUTION_ROUTER_ADDRESS ? `${EXECUTION_ROUTER_ADDRESS.substring(0, 10)}...${EXECUTION_ROUTER_ADDRESS.substring(EXECUTION_ROUTER_ADDRESS.length - 8)}` : 'NOT SET'}`);
            console.log(`   Adapter Addresses:`);
            if (MOCK_SWAP_ADAPTER_ADDRESS)
                console.log(`     - MOCK_SWAP: ${MOCK_SWAP_ADAPTER_ADDRESS.substring(0, 10)}...${MOCK_SWAP_ADAPTER_ADDRESS.substring(MOCK_SWAP_ADAPTER_ADDRESS.length - 8)}`);
            if (UNISWAP_V3_ADAPTER_ADDRESS)
                console.log(`     - UNISWAP_V3: ${UNISWAP_V3_ADAPTER_ADDRESS.substring(0, 10)}...${UNISWAP_V3_ADAPTER_ADDRESS.substring(UNISWAP_V3_ADAPTER_ADDRESS.length - 8)}`);
            if (UNISWAP_ADAPTER_ADDRESS)
                console.log(`     - UNISWAP: ${UNISWAP_ADAPTER_ADDRESS.substring(0, 10)}...${UNISWAP_ADAPTER_ADDRESS.substring(UNISWAP_ADAPTER_ADDRESS.length - 8)}`);
            if (WETH_WRAP_ADAPTER_ADDRESS)
                console.log(`     - WETH_WRAP: ${WETH_WRAP_ADAPTER_ADDRESS.substring(0, 10)}...${WETH_WRAP_ADAPTER_ADDRESS.substring(WETH_WRAP_ADAPTER_ADDRESS.length - 8)}`);
            if (ERC20_PULL_ADAPTER_ADDRESS)
                console.log(`     - ERC20_PULL: ${ERC20_PULL_ADAPTER_ADDRESS.substring(0, 10)}...${ERC20_PULL_ADAPTER_ADDRESS.substring(ERC20_PULL_ADAPTER_ADDRESS.length - 8)}`);
            if (PROOF_ADAPTER_ADDRESS)
                console.log(`     - PROOF: ${PROOF_ADAPTER_ADDRESS.substring(0, 10)}...${PROOF_ADAPTER_ADDRESS.substring(PROOF_ADAPTER_ADDRESS.length - 8)}`);
            console.log(`   RPC URL: ${redactedRpcUrl}`);
            console.log(``);
        }
        // Task 4: DEBUG_DEMO banner for execution path proof
        if (process.env.DEBUG_DEMO === 'true') {
            console.log(`\n🔍 DEBUG_DEMO: Execution Path Configuration`);
            console.log(`   EXECUTION_MODE: ${EXECUTION_MODE}`);
            console.log(`   EXECUTION_AUTH_MODE: ${EXECUTION_AUTH_MODE || 'direct'}`);
            console.log(`   Router Address: ${EXECUTION_ROUTER_ADDRESS ? `${EXECUTION_ROUTER_ADDRESS.substring(0, 10)}...` : 'NOT SET'}`);
            console.log(`   Relayer PK Present: ${!!RELAYER_PRIVATE_KEY}`);
            console.log(`   RPC URL: ${redactedRpcUrl}`);
            console.log(`   Chain ID: ${ETH_TESTNET_CHAIN_ID || 'N/A'}`);
            console.log(``);
        }
        console.log(`\n🌸 Blossom Agent Startup Configuration`);
        console.log(`   Port: ${PORT}`);
        console.log(`   Host: ${HOST}`);
        console.log(`   EXECUTION_MODE: ${EXECUTION_MODE}`);
        console.log(`   EXECUTION_AUTH_MODE: ${EXECUTION_AUTH_MODE || 'direct'}`);
        console.log(`\n   Configuration Status:`);
        console.log(`   ✓ hasEthRpcUrl: ${!!ETH_TESTNET_RPC_URL} (${redactedRpcUrl})`);
        console.log(`   ✓ hasExecutionRouterAddress: ${!!EXECUTION_ROUTER_ADDRESS} ${EXECUTION_ROUTER_ADDRESS ? `(${EXECUTION_ROUTER_ADDRESS.substring(0, 10)}...)` : ''}`);
        console.log(`   ✓ hasGeminiKey: ${hasGeminiKey}`);
        console.log(`   ✓ hasOpenAIKey: ${hasOpenAIKey}`);
        console.log(`   ✓ hasAnthropicKey: ${hasAnthropicKey}`);
        // Task C: Session mode requirements
        if (EXECUTION_AUTH_MODE === 'session') {
            console.log(`\n   Session Mode Requirements:`);
            console.log(`   ✓ hasRelayerPrivateKey: ${!!RELAYER_PRIVATE_KEY}`);
            console.log(`   ✓ hasExecutionRouterAddress: ${!!EXECUTION_ROUTER_ADDRESS}`);
            console.log(`   ✓ hasEthRpcUrl: ${!!ETH_TESTNET_RPC_URL}`);
            if (!RELAYER_PRIVATE_KEY || !EXECUTION_ROUTER_ADDRESS || !ETH_TESTNET_RPC_URL) {
                console.log(`\n   ⚠️  WARNING: Session mode requires:`);
                if (!RELAYER_PRIVATE_KEY)
                    console.log(`      - RELAYER_PRIVATE_KEY`);
                if (!EXECUTION_ROUTER_ADDRESS)
                    console.log(`      - EXECUTION_ROUTER_ADDRESS`);
                if (!ETH_TESTNET_RPC_URL)
                    console.log(`      - ETH_TESTNET_RPC_URL`);
                console.log(`      Session mode will be disabled. Direct mode will be used instead.`);
            }
            else {
                console.log(`   ✓ Session mode configured`);
            }
        }
        if (EXECUTION_MODE === 'eth_testnet') {
            // Task 4: Validate contract configuration on startup
            try {
                const { validateEthTestnetConfig } = await import('../config');
                await validateEthTestnetConfig();
                console.log(`   ✓ ETH testnet configuration validated`);
            }
            catch (error) {
                console.log(`\n   ❌ ERROR: ETH testnet configuration validation failed:`);
                console.log(`      ${error.message}`);
                console.log(`      Please fix configuration errors before using eth_testnet mode.`);
            }
            if (!ETH_TESTNET_RPC_URL) {
                console.log(`\n   ⚠️  WARNING: ETH_TESTNET_RPC_URL not configured`);
                console.log(`      Set it in agent/.env.local to enable testnet features`);
            }
            if (!EXECUTION_ROUTER_ADDRESS) {
                console.log(`\n   ⚠️  WARNING: EXECUTION_ROUTER_ADDRESS not configured`);
                console.log(`      Deploy contracts and set address in agent/.env.local`);
            }
        }
        console.log(``);
    }
    catch (error) {
        console.log(`🌸 Blossom Agent (config load skipped)`);
    }
})();
app.listen(PORT, HOST, () => {
    const listenUrl = HOST === '0.0.0.0' ? `http://127.0.0.1:${PORT}` : `http://${HOST}:${PORT}`;
    console.log(`🌸 Blossom Agent server listening on ${listenUrl}`);
    console.log(`   Health check: http://127.0.0.1:${PORT}/health`);
    console.log(`   API endpoints:`);
    console.log(`   - POST /api/chat`);
    console.log(`   - POST /api/strategy/close`);
    console.log(`   - POST /api/reset`);
    console.log(`   - GET  /api/ticker`);
    console.log(`   - POST /api/execute/prepare`);
    console.log(`   - POST /api/execute/submit`);
    console.log(`   - GET  /api/execute/status`);
    console.log(`   - GET  /api/execute/preflight`);
    console.log(`   - POST /api/session/prepare`);
    console.log(`   - POST /api/execute/relayed`);
    console.log(`   - POST /api/token/approve/prepare`);
    console.log(`   - POST /api/token/weth/wrap/prepare`);
    console.log(`   - GET  /api/portfolio/eth_testnet`);
    console.log(`   - GET  /health`);
    console.log(`   - GET  /api/debug/executions`);
    console.log(`   - POST /api/access/validate`);
    console.log(`   - POST /api/access/check`);
    console.log(`   - GET  /api/access/codes (admin)`);
    console.log(`   - POST /api/access/codes/generate (admin)`);
    console.log(`   - GET  /api/prices/eth`);
});
/**
 * GET /api/prices/simple
 * Proxy for CoinGecko simple/price endpoint with caching and rate limiting
 * Query params: ids (comma-separated), vs_currencies (default: usd)
 */
app.get('/api/prices/simple', async (req, res) => {
    try {
        const idsParam = req.query.ids;
        const vsCurrenciesParam = req.query.vs_currencies;
        if (!idsParam || typeof idsParam !== 'string') {
            return res.status(400).json({
                ok: false,
                code: 'MISSING_IDS',
                message: 'ids query parameter is required (comma-separated coin IDs)',
                fix: 'Add ?ids=ethereum,bitcoin&vs_currencies=usd to the URL',
            });
        }
        const ids = idsParam;
        const vs_currencies = (typeof vsCurrenciesParam === 'string' ? vsCurrenciesParam : 'usd');
        // In-memory cache (60s TTL)
        const cache = global.__priceCache || {};
        const cacheKey = `${ids}-${vs_currencies}`;
        const now = Date.now();
        if (cache[cacheKey] && (now - cache[cacheKey].timestamp) < 60000) {
            return res.json(cache[cacheKey].data);
        }
        // Rate limiting: max 1 request per 2 seconds (request coalescing)
        const lastRequest = global.__lastPriceRequest || 0;
        if (now - lastRequest < 2000) {
            // Return cached data if available, otherwise return error
            if (cache[cacheKey]) {
                return res.json(cache[cacheKey].data);
            }
            return res.status(503).json({
                ok: false,
                code: 'RATE_LIMITED',
                message: 'Rate limited - please wait 2 seconds between requests',
                fix: 'Wait 2 seconds and retry, or use cached data',
            });
        }
        global.__lastPriceRequest = now;
        // Fetch from CoinGecko
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=${encodeURIComponent(vs_currencies)}&include_24hr_change=true`;
        const response = await fetch(url, {
            headers: {
                'Accept': 'application/json',
            },
            signal: AbortSignal.timeout(5000), // 5s timeout
        });
        if (!response.ok) {
            // Return cached data if available
            if (cache[cacheKey]) {
                return res.json(cache[cacheKey].data);
            }
            // Return static fallback for common coins
            const staticPrices = {};
            const coinIds = ids.split(',');
            for (const coinId of coinIds) {
                if (coinId === 'ethereum') {
                    staticPrices.ethereum = { usd: 3000 };
                }
                else if (coinId === 'bitcoin') {
                    staticPrices.bitcoin = { usd: 45000 };
                }
                else if (coinId === 'solana') {
                    staticPrices.solana = { usd: 100 };
                }
                else if (coinId === 'avalanche-2') {
                    staticPrices['avalanche-2'] = { usd: 40 };
                }
                else if (coinId === 'chainlink') {
                    staticPrices.chainlink = { usd: 14 };
                }
            }
            return res.json(staticPrices);
        }
        const data = await response.json();
        // Update cache
        if (!global.__priceCache) {
            global.__priceCache = {};
        }
        global.__priceCache[cacheKey] = {
            data,
            timestamp: now,
        };
        res.json(data);
    }
    catch (error) {
        console.error('[api/prices/simple] Error:', error);
        // Return cached data if available
        const cache = global.__priceCache || {};
        const idsParam = req.query.ids;
        const vsCurrenciesParam = req.query.vs_currencies;
        const vs_currencies = (typeof vsCurrenciesParam === 'string' ? vsCurrenciesParam : 'usd');
        const cacheKey = `${typeof idsParam === 'string' ? idsParam : ''}-${vs_currencies}`;
        if (cache[cacheKey]) {
            return res.json(cache[cacheKey].data);
        }
        // Never throw - always return 200 with fallback
        const staticPrices = {};
        const coinIds = (typeof idsParam === 'string' ? idsParam.split(',') : []);
        for (const coinId of coinIds) {
            if (coinId === 'ethereum') {
                staticPrices.ethereum = { usd: 3000 };
            }
            else if (coinId === 'bitcoin') {
                staticPrices.bitcoin = { usd: 45000 };
            }
        }
        res.json(staticPrices);
    }
});
/**
 * GET /api/prices/eth
 * Get current ETH price in USD
 */
app.get('/api/prices/eth', async (req, res) => {
    try {
        const { getPrice } = await import('../services/prices');
        const priceSnapshot = await getPrice('ETH');
        res.json({
            symbol: 'ETH',
            priceUsd: priceSnapshot.priceUsd,
            source: priceSnapshot.source || 'coingecko',
        });
    }
    catch (error) {
        console.error('[api/prices/eth] Error:', error);
        // Fallback to static price
        res.json({
            symbol: 'ETH',
            priceUsd: 3000,
            source: 'fallback',
        });
    }
});
/**
 * GET /api/debug/executions
 * Dump execution artifacts for debugging
 */
app.get('/api/debug/executions', (req, res) => {
    try {
        if (process.env.DEBUG_EXECUTIONS !== '1') {
            return res.status(403).json({
                error: 'Debug mode not enabled. Set DEBUG_EXECUTIONS=1',
            });
        }
        const artifacts = getExecutionArtifacts();
        res.json({
            count: artifacts.length,
            artifacts,
        });
    }
    catch (error) {
        console.error('[api/debug/executions] Error:', error);
        res.status(500).json({
            error: 'Failed to dump execution artifacts',
            message: error.message,
        });
    }
});
//# sourceMappingURL=http.js.map