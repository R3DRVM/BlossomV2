// @ts-nocheck
/**
 * Blossom Agent HTTP Server
 * Provides API endpoints for the React front-end
 */

// Load environment variables FIRST (before any other imports that use process.env)
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import * as Sentry from '@sentry/node';

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

let loadedEnvFile: string | null = null;
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
} else {
  console.log(`⚠️  No .env file found (using system environment variables)`);
}

const SENTRY_DSN = process.env.SENTRY_DSN || process.env.SENTRY_DSN_BACKEND;
const SENTRY_ENV = process.env.SENTRY_ENV || process.env.VERCEL_ENV || process.env.NODE_ENV || 'development';
const SENTRY_RELEASE = process.env.VERCEL_GIT_COMMIT_SHA
  ? `agent@${process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)}`
  : undefined;
const SENTRY_ENABLED = !!SENTRY_DSN;

if (SENTRY_ENABLED) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENV,
    release: SENTRY_RELEASE,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    sendDefaultPii: false,
  });
  console.log(`📡 Sentry enabled (${SENTRY_ENV})`);
}

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { BlossomAction, BlossomPortfolioSnapshot, BlossomExecutionRequest, ExecutionResult } from '../types/blossom';
import { validateActions, buildBlossomPrompts } from '../utils/actionParser';
import { appendMessage } from '../conversation';
import { callLlm } from '../services/llmClient';
import * as perpsSim from '../plugins/perps-sim';
import * as defiSim from '../plugins/defi-sim';
import { verifyRequestAuth, getAuthMode } from '../auth';
import { startCrossChainCreditFinalizer } from '../services/crossChainCreditRouter';
import {
  getSettlementChainRuntimeConfig,
  isSettlementChainExecutionReady,
  normalizeSettlementChain,
  resolveExecutionSettlementChain,
} from '../config/settlementChains';

// Allowed CORS origins for MVP
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://blossom.onl',
  'https://www.blossom.onl',
  'https://app.blossom.onl',
  'https://api.blossom.onl',
  // Preview/staging subdomains
  /^https:\/\/.*\.blossom\.onl$/,
  // Vercel preview deployments
  /^https:\/\/blossom-v2.*\.vercel\.app$/,
  /^https:\/\/.*-redrums-projects.*\.vercel\.app$/,
];
import * as eventSim from '../plugins/event-sim';
import { resetAllSims, getPortfolioSnapshot } from '../services/state';
import { getOnchainTicker, getEventMarketsTicker } from '../services/ticker';
import { logExecutionArtifact, getExecutionArtifacts, dumpExecutionArtifacts } from '../utils/executionLogger';
import { validateAccessCode, hasAccess, initializeAccessGate, getAllAccessCodes, createAccessCode, revokeAccessCode, checkAccess } from '../utils/accessGate';
import { logEvent, createRequestLogger, hashAddress } from '../telemetry/logger';
import { waitForReceipt } from '../executors/evmReceipt';
import { checkAndRecordMint } from '../utils/mintLimiter';
import { postStatsEvent } from '../stats';

// State machine imports for intent path isolation
import {
  IntentPath,
  IntentState,
  classifyIntentPath,
  classifyIntentPathWithValidation,
  validatePathIntegrity,
  getContext,
  updateContext,
  transitionPath,
  processConfirmation,
  isConfirmation,
  isCancellation,
  resetContextState,
  logTransition,
  ConfirmationType,
} from '../intent/intentStateMachine';

/**
 * JSON-RPC Response type
 */
type JsonRpcResponse<T = unknown> = {
  result?: T;
  error?: { message?: string; code?: number; data?: unknown };
};

const app = express();

// Best-effort finalizer for cross-chain credit receipts. Safe no-op on cold instances.
startCrossChainCreditFinalizer();

// Vercel/production runs behind proxies and sets X-Forwarded-For.
// express-rate-limit will throw if `trust proxy` is false in that scenario.
if (process.env.VERCEL === '1' || process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Rate limits for high-risk execution endpoints
// Increased limits for testing and legitimate usage
const executeRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 50, // Increased from 10 to 50 requests/minute
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      ok: false,
      error: 'Rate limit exceeded. Please wait a moment before trying again.',
      errorCode: 'RATE_LIMIT_EXCEEDED',
      retryAfter: 60,
    });
  },
  keyGenerator: (req) => {
    const wallet = req.headers['x-wallet-address'];
    if (Array.isArray(wallet)) return wallet[0];
    return (wallet as string) || req.ip;
  },
});

const sessionRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 50, // Increased from 10 to 50 requests/minute
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      ok: false,
      error: 'Rate limit exceeded. Please wait a moment before trying again.',
      errorCode: 'RATE_LIMIT_EXCEEDED',
      retryAfter: 60,
    });
  },
  keyGenerator: (req) => {
    const wallet = req.headers['x-wallet-address'];
    if (Array.isArray(wallet)) return wallet[0];
    return (wallet as string) || req.ip;
  },
});

// Rate limit for mint endpoint - prevent DoS attacks on token minting
const mintRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 20, // Increased from 5 to 20 requests per minute (users may retry)
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      ok: false,
      error: 'Too many mint requests. Please wait a moment before trying again.',
      errorCode: 'RATE_LIMIT_EXCEEDED',
      retryAfter: 60,
    });
  },
  keyGenerator: (req) => {
    const wallet = req.headers['x-wallet-address'];
    if (Array.isArray(wallet)) return wallet[0];
    return (wallet as string) || req.ip;
  },
});

// SECURITY FIX: Global rate limit to prevent distributed DoS across endpoints
// This catches attackers who spread requests across multiple endpoints
const globalRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 200, // Increased from 100 to 200 requests per minute (more generous for legitimate users)
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      ok: false,
      error: 'Too many requests. Please slow down.',
      errorCode: 'RATE_LIMIT_EXCEEDED',
      retryAfter: 60,
    });
  },
  // Skip rate limiting for health checks
  skip: (req) => req.path === '/health' || req.path === '/api/health' || req.path === '/api/rpc/health',
});

// Configure CORS with specific origins for security
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like curl, mobile apps, or same-origin)
    if (!origin) {
      return callback(null, true);
    }

    // Check against allowed origins
    const isAllowed = ALLOWED_ORIGINS.some(allowed => {
      if (typeof allowed === 'string') {
        return origin === allowed;
      }
      // RegExp for pattern matching (subdomains)
      return allowed.test(origin);
    });

    if (isAllowed) {
      return callback(null, true);
    }

    // In development, also allow any localhost port
    if (process.env.NODE_ENV !== 'production' && origin.includes('localhost')) {
      return callback(null, true);
    }

    console.warn(`[CORS] Blocked origin: ${origin}`);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Ledger-Secret', 'X-Access-Code', 'X-Wallet-Address', 'x-correlation-id'],
}));

// SECURITY: Apply global rate limit before other middleware
app.use(globalRateLimit);

app.use(express.json());
app.use(cookieParser());

// Auth gate for execution endpoints (AUTH_MODE=siwe)
async function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const result = await verifyRequestAuth(req);
  if (!result.ok) {
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized',
      reason: result.reason || 'invalid_signature',
      authMode: getAuthMode(),
    });
  }
  return next();
}

// Apply rate limits to execution/session routes
app.use('/api/execute', executeRateLimit);
app.use('/api/session', sessionRateLimit);

// Minimal request validation schemas
const ExecutePrepareSchema = z.object({
  draftId: z.string().min(1).optional(),
  userAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  authMode: z.enum(['direct', 'session']).optional(),
  executionRequest: z.object({ kind: z.string() }).passthrough().optional(),
  executionIntent: z.any().optional(),
}).passthrough();

const ExecuteRelayedSchema = z.object({
  draftId: z.string().min(1),
  userAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  sessionId: z.string().min(1),
  plan: z.object({ actions: z.array(z.any()).optional() }).passthrough(),
}).passthrough();

const ExecuteSubmitSchema = z.object({
  draftId: z.string().min(1),
  txHash: z.string().min(1),
  userAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  strategy: z.any().optional(),
  executionRequest: z.any().optional(),
}).passthrough();

// ============================================
// TELEMETRY-ONLY MODE: Block sensitive endpoints
// ============================================
const TELEMETRY_ONLY = process.env.TELEMETRY_ONLY === 'true';

// Allowlisted routes in telemetry-only mode (read-only telemetry data)
const TELEMETRY_ALLOWLIST = [
  'GET /health',
  'GET /api/health',
  'GET /api/rpc/health',
  'GET /api/telemetry/summary',
  'GET /api/telemetry/devnet-stats',
  'GET /api/telemetry/users',
  'GET /api/telemetry/executions',
  'GET /api/telemetry/runs',
  'GET /api/telemetry/debug',
  'POST /api/telemetry/runs', // Allow campaign script to post run data
];

if (TELEMETRY_ONLY) {
  console.log('');
  console.log('================================================================================');
  console.log('  TELEMETRY-ONLY MODE ENABLED');
  console.log('  Only read-only telemetry endpoints are accessible.');
  console.log('  All execution, session, and sensitive endpoints are BLOCKED.');
  console.log('================================================================================');
  console.log('');
  console.log('ALLOWED ROUTES:');
  TELEMETRY_ALLOWLIST.forEach(route => console.log(`  ✅ ${route}`));
  console.log('');
  console.log('BLOCKED ROUTES (returning 403):');
  console.log('  ❌ POST /api/chat');
  console.log('  ❌ POST /api/execute/*');
  console.log('  ❌ POST /api/session/*');
  console.log('  ❌ GET /api/session/*');
  console.log('  ❌ POST /api/setup/*');
  console.log('  ❌ POST /api/token/*');
  console.log('  ❌ GET /api/portfolio/*');
  console.log('  ❌ GET /api/defi/*');
  console.log('  ❌ GET /api/wallet/*');
  console.log('  ❌ POST /api/demo/*');
  console.log('  ❌ GET /api/debug/*');
  console.log('  ❌ ... and all other non-telemetry routes');
  console.log('================================================================================');
  console.log('');

  // Middleware to block non-allowlisted routes
  app.use((req, res, next) => {
    const routeKey = `${req.method} ${req.path}`;

    // Check if route is in allowlist
    const isAllowed = TELEMETRY_ALLOWLIST.some(allowed => {
      // Exact match
      if (routeKey === allowed) return true;
      // Prefix match for paths with params (e.g., GET /api/telemetry/runs?limit=10)
      const [method, path] = allowed.split(' ');
      if (req.method === method && req.path === path) return true;
      return false;
    });

    if (!isAllowed) {
      console.log(`[TELEMETRY_ONLY] BLOCKED: ${routeKey}`);
      return res.status(403).json({
        ok: false,
        error: 'Forbidden: This endpoint is disabled in telemetry-only mode',
        telemetryOnly: true,
      });
    }

    next();
  });
}

// ============================================
// OBSERVABILITY: Correlation ID + Request Logging
// ============================================
import { randomUUID } from 'crypto';
import { makeCorrelationId } from '../utils/correlationId';

// Extend Express Request type for correlation ID
declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
    }
  }
}

/**
 * Generate short correlation ID (8 chars for readability)
 */
function generateCorrelationId(): string {
  // Use centralized correlation ID generator for consistency
  return makeCorrelationId();
}

/**
 * Get build SHA for version tracking
 * Uses VERCEL_GIT_COMMIT_SHA in production, or generates from git if available
 */
function getBuildSha(): string {
  // In Vercel production, use the git commit SHA from env
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  }

  // Fallback: try to read from git (local dev)
  try {
    const { execSync } = require('child_process');
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    return sha;
  } catch {
    return 'dev';
  }
}

const BUILD_SHA = getBuildSha();

/**
 * Correlation ID middleware
 * - Accepts x-correlation-id header if provided
 * - Generates one if not provided
 * - Attaches to req and response header
 * - Adds build version header
 * - Logs request/response timing
 */
app.use((req, res, next) => {
  const correlationId = (req.headers['x-correlation-id'] as string) || generateCorrelationId();
  req.correlationId = correlationId;
  res.setHeader('x-correlation-id', correlationId);
  res.setHeader('x-build-sha', BUILD_SHA);

  const startTime = Date.now();

  // Get visitor address from headers or query (check multiple param names)
  const visitorAddress = (req.headers['x-visitor-address'] as string) ||
                        (req.query.userAddress as string) ||
                        (req.query.visitor as string) ||
                        (req.query.address as string) ||
                        null;

  // Log response on finish
  res.on('finish', async () => {
    const duration = Date.now() - startTime;
    const isSessionOrExecute = req.path.includes('/session/') || req.path.includes('/execute/');

    // Always log session/execute routes, others only in dev or on error
    if (isSessionOrExecute || process.env.NODE_ENV !== 'production' || res.statusCode >= 400) {
      console.log(`[${correlationId}] ${req.method} ${req.path} -> ${res.statusCode} (${duration}ms)`);
    }

    // Log ALL requests to database for devnet stats (skip static assets)
    if (!req.path.includes('.') && req.path.startsWith('/')) {
      try {
        const { logRequest } = await import('../../telemetry/db');
        logRequest({
          endpoint: req.path,
          method: req.method,
          userAddress: visitorAddress,
          statusCode: res.statusCode,
          latencyMs: duration,
          correlationId,
        });
      } catch (e) {
        // Fail silently - don't break request handling
      }
    }
  });

  next();
});

/**
 * Async handler wrapper for proper error propagation
 */
type AsyncHandler = (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<any>;

function asyncHandler(fn: AsyncHandler): express.RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Session trace logger - logs session state transitions (NO secrets)
 */
function logSessionTrace(correlationId: string, event: string, data: Record<string, any> = {}): void {
  const safeData = { ...data };
  // Remove any potential secrets
  delete safeData.privateKey;
  delete safeData.signature;
  delete safeData.apiKey;
  delete safeData.secret;
  
  console.log(`[${correlationId}] [SESSION] ${event}`, JSON.stringify(safeData));
}

/**
 * Execution trace logger - logs execution state transitions (NO secrets)
 */
function logExecuteTrace(correlationId: string, event: string, data: Record<string, any> = {}): void {
  const safeData = { ...data };
  // Remove any potential secrets
  delete safeData.privateKey;
  delete safeData.signature;
  delete safeData.apiKey;
  delete safeData.secret;
  
  console.log(`[${correlationId}] [EXECUTE] ${event}`, JSON.stringify(safeData));
}

/**
 * Plan missing logger - logs when executionRequest is expected but missing
 */
function logPlanMissing(correlationId: string, suspectedIntent: string, userMessage: string): void {
  const snippet = userMessage.substring(0, 100) + (userMessage.length > 100 ? '...' : '');
  console.log(`[${correlationId}] [PLAN_MISSING] suspectedIntent=${suspectedIntent} message="${snippet}"`);
}

/**
 * Detect if user message suggests an actionable intent
 */
function detectSuspectedIntent(userMessage: string): string | null {
  const lower = userMessage.toLowerCase();
  
  // Swap intents
  if (/\b(swap|exchange|convert)\b/.test(lower)) return 'swap';
  
  // Perp intents  
  if (/\b(long|short|leverage|perp|margin|position)\b/.test(lower)) return 'perp';
  
  // DeFi intents
  if (/\b(deposit|lend|supply|borrow|stake|yield|apy|earn|lending)\b/.test(lower)) return 'defi';
  
  // Event intents
  if (/\b(bet|predict|prediction|wager)\b/.test(lower)) return 'event';
  
  return null;
}

// Access gate feature flag (fail-closed: enabled in production by default)
const isProductionEnv = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
const accessGateDisabledEnv = process.env.ACCESS_GATE_DISABLED === 'true';
const ACCESS_GATE_ENABLED = isProductionEnv ? !accessGateDisabledEnv : (process.env.ACCESS_GATE_ENABLED === 'true');
const maybeCheckAccess = ACCESS_GATE_ENABLED ? checkAccess : (req: any, res: any, next: any) => next();

// Initialize access gate on startup (Postgres-backed, with in-memory fallback)
// CRITICAL: Use top-level await to ensure Postgres connection test completes before handling requests
try {
  await initializeAccessGate();
} catch (error) {
  console.error('[http] Failed to initialize access gate:', error);
  console.error('[http] Continuing with in-memory fallback mode');
}

// Set up balance callbacks for DeFi and Event sims
// Use perps sim as the source of truth for REDACTED balance
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
 * Apply action to appropriate sim and return unified ExecutionResult
 */
async function applyAction(action: BlossomAction): Promise<ExecutionResult> {
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
    } else if (action.type === 'defi' && action.action === 'deposit') {
      const position = defiSim.openDefiPosition(
        action.protocol as 'Kamino' | 'RootsFi' | 'Jet',
        action.asset,
        action.amountUsd
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
    } else if (action.type === 'event' && action.action === 'open') {
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
      
      const position = await eventSim.openEventPosition(
        action.eventKey,
        action.side,
        action.stakeUsd,
        action.label // Pass label for live markets
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
  } catch (error: any) {
    const portfolioAfter = buildPortfolioSnapshot();
    return {
      success: false,
      status: 'failed',
      error: error.message || 'Unknown error',
      portfolio: portfolioAfter,
    };
  }
}

/**
 * Parse LLM JSON response into assistant message and actions
 */
interface ModelResponse {
  assistantMessage: string;
  actions: BlossomAction[];
  executionRequest?: BlossomExecutionRequest | null;
  modelOk?: boolean;
}

async function parseModelResponse(
  rawJson: string, 
  isSwapPrompt: boolean = false, 
  isDefiPrompt: boolean = false, 
  userMessage?: string,
  isPerpPrompt: boolean = false,
  isEventPrompt: boolean = false
): Promise<ModelResponse> {
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
    let executionRequest: BlossomExecutionRequest | null = null;
    let modelOk = true;

    if (parsed.executionRequest) {
      const { validateExecutionRequest } = await import('../utils/actionParser');
      executionRequest = validateExecutionRequest(parsed.executionRequest);
      if (!executionRequest && (isSwapPrompt || isDefiPrompt || isPerpPrompt || isEventPrompt)) {
        // Invalid executionRequest - try deterministic fallback
        modelOk = false;
        console.error('[parseModelResponse] Invalid executionRequest, will try fallback');
      }
    } else if (isSwapPrompt || isDefiPrompt || isPerpPrompt || isEventPrompt) {
      // Missing executionRequest - try deterministic fallback
      modelOk = false;
      console.error('[parseModelResponse] Missing executionRequest, will try fallback');
    }

    // If model failed and we have a prompt, try deterministic fallback
    if (!modelOk && userMessage && (isSwapPrompt || isDefiPrompt || isPerpPrompt || isEventPrompt)) {
      const fallback = await applyDeterministicFallback(userMessage, isSwapPrompt, isDefiPrompt, isPerpPrompt, isEventPrompt, portfolioForPrompt);
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
  } catch (error: any) {
    console.error('Failed to parse model response:', error.message);
    console.error('Raw JSON:', rawJson);
    
    // If parsing failed and we have a prompt, try deterministic fallback
    if (userMessage && (isSwapPrompt || isDefiPrompt || isPerpPrompt || isEventPrompt)) {
      const fallback = await applyDeterministicFallback(userMessage, isSwapPrompt, isDefiPrompt, isPerpPrompt, isEventPrompt, portfolioForPrompt);
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
 * Generate helpful fallback response when intent is unclear
 * Instead of saying "I can't process", offer helpful options
 */
function generateHelpfulFallback(userMessage: string, portfolio: BlossomPortfolioSnapshot | null): string {
  const lower = userMessage.toLowerCase();
  const STABLE_SYMBOLS = new Set(['BLSMUSDC', 'REDACTED', 'USDC', 'BUSDC']);

  // Check for swap/trade intent
  if (lower.includes('swap') || lower.includes('trade') || lower.includes('exchange') || lower.includes('convert')) {
    return "I'd be happy to help with a swap! What token would you like to swap, and how much? For example: 'Swap 10 bUSDC to WETH' or 'Swap 0.01 ETH to bUSDC'.";
  }

  // Check for yield/earn intent
  if (lower.includes('yield') || lower.includes('earn') || lower.includes('apy') || lower.includes('interest') || lower.includes('stake')) {
    return "Looking for yield opportunities? I can help deploy your bUSDC into DeFi protocols. How much would you like to deposit? For example: 'Deposit 100 bUSDC into Aave'.";
  }

  // Check for prediction/bet intent
  if (lower.includes('bet') || lower.includes('predict') || lower.includes('market') || lower.includes('event') || lower.includes('kalshi') || lower.includes('polymarket')) {
    return "Want to explore prediction markets? I can show you the top markets by volume, or help you place a bet. Try: 'Show me top Polymarket markets' or 'Bet $20 YES on Fed rate cut'.";
  }

  // Check for perp/leverage intent
  if (lower.includes('perp') || lower.includes('leverage') || lower.includes('long') || lower.includes('short') || lower.includes('futures')) {
    return "Ready to trade perps? Tell me what you'd like to trade: 'Long BTC with 5x leverage' or 'Short ETH with 2% risk'.";
  }

  // Check for money/invest/profit intent (vague)
  if (lower.includes('money') || lower.includes('invest') || lower.includes('profit') || lower.includes('make') || lower.includes('grow')) {
    const stableBalanceUsd =
      portfolio?.balances.find(b => STABLE_SYMBOLS.has(String(b.symbol || '').toUpperCase()))?.balanceUsd || 0;
    if (stableBalanceUsd > 0) {
      return `I can help you put your $${stableBalanceUsd.toLocaleString()} bUSDC to work! Here are your options:\n\n1. **Yield**: Deploy to DeFi protocols for ~4-8% APY\n2. **Trade Perps**: Open leveraged positions on BTC/ETH/SOL\n3. **Prediction Markets**: Bet on real-world events\n4. **Swap**: Exchange for other tokens\n\nWhat sounds interesting?`;
    }
    return "I can help you explore opportunities! Here's what I can do:\n\n1. **Yield**: Deploy bUSDC to earn APY\n2. **Trade Perps**: Open leveraged positions\n3. **Prediction Markets**: Bet on events\n4. **Swap**: Exchange tokens\n\nWhat would you like to explore?";
  }

  // Check for help/what can you do intent
  if (lower.includes('help') || lower.includes('what can') || lower.includes('what do you') || lower.includes('how do')) {
    return "I'm Blossom, your AI trading copilot! I can help with:\n\n1. **Swaps**: 'Swap 100 bUSDC to WETH'\n2. **Perps**: 'Long BTC with 5x leverage'\n3. **DeFi Yield**: 'Deposit 500 bUSDC into Aave'\n4. **Prediction Markets**: 'Show me top Kalshi markets'\n\nWhat would you like to do?";
  }

  // Generic fallback - offer options
  return "I can help with swaps, perps trading, DeFi yield, and prediction markets. What would you like to explore? Try:\n\n- 'Swap 10 bUSDC to WETH'\n- 'Long BTC with 3x leverage'\n- 'Show me top prediction markets'\n- 'Deposit 100 bUSDC for yield'";
}

/**
 * Normalize user input to handle edge cases like "5weth" → "5 weth"
 */
function normalizeUserInput(userMessage: string | undefined): string {
  if (!userMessage) {
    return '';
  }
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
async function applyDeterministicFallback(
  userMessage: string,
  isSwapPrompt: boolean,
  isDefiPrompt: boolean,
  isPerpPrompt: boolean = false,
  isEventPrompt: boolean = false,
  portfolio?: { accountValueUsd: number; balances: any[]; openPerpExposureUsd?: number; eventExposureUsd?: number; defiPositions?: any[]; strategies?: any[] }
): Promise<{ assistantMessage: string; actions: BlossomAction[]; executionRequest: BlossomExecutionRequest | null } | null> {
  // Normalize input before parsing
  const normalizedMessage = normalizeUserInput(userMessage);
  const lowerMessage = normalizedMessage.toLowerCase();

  // Detect target chain from user message
  // Priority: explicit "solana" mention > SOL token detection > default to sepolia
  const isSolanaIntent = lowerMessage.includes('solana') ||
    lowerMessage.includes(' sol ') ||
    lowerMessage.match(/\bsol\b/) !== null ||
    lowerMessage.match(/\bwsol\b/) !== null ||
    lowerMessage.match(/swap.*sol/i) !== null ||
    lowerMessage.match(/buy.*sol/i) !== null ||
    lowerMessage.match(/sell.*sol/i) !== null;

  const targetChain = isSolanaIntent ? 'solana' : 'sepolia';
  const chainDisplay = isSolanaIntent ? 'Solana Devnet' : 'Sepolia';

  if (isEventPrompt) {
    // Extract event details
    const stakeMatch = userMessage.match(/\$(\d+)/) || userMessage.match(/(\d+)\s*(usd|usdc|dollar)/i);
    const stakeUsd = stakeMatch ? parseFloat(stakeMatch[1]) : 5;

    // Check for price level betting: "BTC above 70k" or "ETH below 2000"
    const priceLevelMatch = lowerMessage.match(/(btc|bitcoin|eth|ethereum|sol|solana)\s*(?:will\s+be\s*)?(?:above|below|over|under|at)\s*\$?(\d+(?:\.\d+)?)\s*(k|m)?/i);

    if (priceLevelMatch) {
      // Price level betting
      const asset = priceLevelMatch[1].toUpperCase().replace(/BITCOIN/i, 'BTC').replace(/ETHEREUM/i, 'ETH').replace(/SOLANA/i, 'SOL');
      const direction = lowerMessage.includes('above') || lowerMessage.includes('over') ? 'above' : 'below';
      let priceLevel = parseFloat(priceLevelMatch[2]);
      const multiplier = priceLevelMatch[3]?.toLowerCase();
      if (multiplier === 'k') priceLevel *= 1000;
      if (multiplier === 'm') priceLevel *= 1000000;

      const marketTitle = `${asset} ${direction} $${priceLevel.toLocaleString()}`;

      return {
        assistantMessage: `I'll place a $${stakeUsd} bet that ${asset} will be ${direction} $${priceLevel.toLocaleString()}. This is a prediction market bet.`,
        actions: [],
        executionRequest: {
          kind: 'event',
          chain: targetChain,
          marketId: `${asset}_PRICE_${direction.toUpperCase()}_${priceLevel}`,
          outcome: 'YES' as 'YES' | 'NO',
          stakeUsd,
          price: 0.50, // Default 50/50 for price prediction
          metadata: {
            type: 'price_level',
            asset,
            direction,
            priceLevel,
          },
        },
      };
    }

    // Standard yes/no event betting (Fed rate cut, etc.)
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
        chain: targetChain,
        marketId: market?.id || 'FED_CUTS_MAR_2025',
        outcome: outcome as 'YES' | 'NO',
        stakeUsd,
        price: outcome === 'YES' ? market?.yesPrice : market?.noPrice,
      },
    };
  }
  
  if (isPerpPrompt) {
    // Extract perp details
    const assetMatch = lowerMessage.match(/(btc|eth|sol)/);
    // Support decimal leverage like "5.5x" or "2.5x"
    const leverageMatch = userMessage.match(/(\d+(?:\.\d+)?)x/i);
    const riskMatch = userMessage.match(/(\d+)%\s*risk/i) || userMessage.match(/risk.*?(\d+)%/i);
    const marginMatch =
      userMessage.match(/(?:with|using)\s+\$?(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:usd\s*)?(?:margin|stake|collateral|size)/i) ||
      userMessage.match(/\$?(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:usd\s*)?(?:margin|stake|collateral|size)/i);
    const sideMatch = lowerMessage.match(/(long|short)/);

    const asset = assetMatch ? assetMatch[1].toUpperCase() : 'ETH';
    let leverage = leverageMatch ? parseFloat(leverageMatch[1]) : 2;
    const requestedMarginUsd = marginMatch ? parseFloat(marginMatch[1].replace(/,/g, '')) : undefined;
    let riskPct = riskMatch ? parseFloat(riskMatch[1]) : 2;
    const side = sideMatch ? sideMatch[1] : 'long';

    // P0 Fix: Check if user is asking for an execution plan (not immediate execution)
    const isPlanRequest = /show\s*(me\s*)?(the\s+)?execution\s*plan|execution\s*plan|plan\s*across\s*venues|compare\s*venues/i.test(userMessage);

    // P0 Fix: Clamp leverage to supported demo limits (1-20x)
    const MAX_DEMO_LEVERAGE = 20;
    const leverageWarning = leverage > MAX_DEMO_LEVERAGE
      ? `Note: Requested ${leverage}x leverage exceeds demo max (${MAX_DEMO_LEVERAGE}x). Using ${MAX_DEMO_LEVERAGE}x instead.\n\n`
      : '';
    leverage = Math.min(leverage, MAX_DEMO_LEVERAGE);

    // Supported markets in demo
    const SUPPORTED_MARKETS = ['BTC', 'ETH', 'SOL'];
    const isMarketSupported = SUPPORTED_MARKETS.includes(asset);

    // If market not supported, suggest alternatives
    if (!isMarketSupported) {
      return {
        assistantMessage: `**${asset} perps aren't available in the Sepolia demo yet.**\n\n` +
          `I can trade these markets:\n` +
          `• **BTC-USD** - Long/Short Bitcoin\n` +
          `• **ETH-USD** - Long/Short Ethereum\n` +
          `• **SOL-USD** - Long/Short Solana\n\n` +
          `Would you like me to open a ${side} position on ETH or BTC with ${leverage}x leverage instead?`,
        actions: [],
        executionRequest: null,
      };
    }

    // Calculate margin based on risk and account value
    const accountValue = portfolio?.accountValueUsd || 10000;
    const marginUsd = requestedMarginUsd ?? Math.round((accountValue * riskPct) / 100);
    if (!riskMatch && requestedMarginUsd !== undefined && accountValue > 0) {
      riskPct = Math.max(0.1, (requestedMarginUsd / accountValue) * 100);
    }
    riskPct = Math.round(riskPct * 100) / 100;

    // If asking for plan, provide a rich execution plan without auto-executing
    if (isPlanRequest) {
      const notionalUsd = marginUsd * leverage;

      return {
        assistantMessage: `**Execution Plan: ${side.toUpperCase()} ${asset} Perp**\n\n` +
          leverageWarning +
          `**Position Details:**\n` +
          `• Market: ${asset}-USD\n` +
          `• Side: ${side.charAt(0).toUpperCase() + side.slice(1)}\n` +
          `• Leverage: ${leverage}x\n` +
          `• Risk: ${riskPct}% of account\n` +
          `• Margin: $${marginUsd.toLocaleString()}\n` +
          `• Notional: $${notionalUsd.toLocaleString()}\n\n` +
          `**Venue:** Demo Perp Adapter (Sepolia Testnet)\n\n` +
          `This is a demo execution - no real funds at risk.\n\n` +
          `Type "execute" or "confirm" to proceed with this trade.`,
        actions: [],
        executionRequest: {
          kind: 'perp',
          chain: targetChain,
          market: `${asset}-USD`,
          side: side as 'long' | 'short',
          leverage,
          riskPct,
          marginUsd,
          planOnly: true, // Frontend should show this as a draft
        },
      };
    }

    return {
      assistantMessage: leverageWarning + `I'll open a ${side} ${asset} perp position with ${leverage}x leverage and ${riskPct}% risk.`,
      actions: [],
      executionRequest: {
        kind: 'perp',
        chain: targetChain,
        market: `${asset}-USD`,
        side: side as 'long' | 'short',
        leverage,
        riskPct,
        marginUsd,
      },
    };
  }
  
  if (isSwapPrompt) {
    // Extract amount and tokens (including SOL for Solana swaps)
    const amountMatch = userMessage.match(/(\d+\.?\d*)\s*(usdc|weth|eth|sol|wsol)/i);
    const tokenInMatch = lowerMessage.match(/(usdc|weth|eth|sol|wsol)/);
    const tokenOutMatch = lowerMessage.match(/(?:to|for)\s+(usdc|weth|eth|sol|wsol)/);

    if (amountMatch && tokenInMatch) {
      const amount = amountMatch[1];
      const rawTokenIn = tokenInMatch[1].toUpperCase();
      const tokenIn = rawTokenIn === 'ETH' ? 'ETH' : rawTokenIn === 'WSOL' ? 'SOL' : rawTokenIn;

      let tokenOut: string;
      if (tokenOutMatch) {
        const rawOut = tokenOutMatch[1].toUpperCase();
        tokenOut = rawOut === 'ETH' ? 'WETH' : rawOut === 'WSOL' ? 'SOL' : rawOut;
      } else {
        // Default output based on chain and input
        if (isSolanaIntent) {
          tokenOut = tokenIn === 'SOL' ? 'USDC' : 'SOL';
        } else {
          tokenOut = tokenIn === 'USDC' ? 'WETH' : 'USDC';
        }
      }

      return {
        assistantMessage: `I'll swap ${amount} ${tokenIn} to ${tokenOut} on ${chainDisplay}.`,
        actions: [],
        executionRequest: {
          kind: 'swap',
          chain: targetChain,
          tokenIn,
          tokenOut,
          amountIn: amount,
          slippageBps: 50,
          fundingPolicy: tokenIn === 'ETH' || tokenIn === 'SOL' ? 'auto' : 'require_tokenIn',
        },
      };
    }
  }
  
  if (isDefiPrompt) {
    // NEW: Check for structured allocation format first (from quick action buttons)
    const structuredAllocMatch = userMessage.match(/allocate\s+amount(Usd|Pct):"?(\d+\.?\d*)"?\s+to\s+protocol:"?([^"]+?)"?(?:\s+(?:REDACTED|bUSDC|blsmUSDC)|\s+yield|$)/i);

    let amount: string;
    let vaultName: string | undefined;

    if (structuredAllocMatch) {
      // Structured format: "Allocate amountUsd:"500" to protocol:"Aave V3" REDACTED yield"
      const [_, amountType, amountValue, protocolName] = structuredAllocMatch;

      if (amountType.toLowerCase() === 'pct') {
        // Percentage allocation: calculate from account value
        const accountValue = portfolio?.accountValueUsd || 10000;
        const percentage = parseFloat(amountValue);
        amount = ((accountValue * percentage) / 100).toFixed(0);
      } else {
        // USD allocation
        amount = amountValue;
      }

      vaultName = protocolName.trim();
      console.log('[deterministic fallback] Parsed structured allocation:', { amount, vaultName, format: 'structured' });
    } else {
      // FALLBACK: Natural language format with improved parsing (P0 Fix)
      // Handles: "Deposit 10% of my REDACTED into X", "Deposit $500 REDACTED into X", etc.

      // Check for percentage allocation first: "10%" or "10 percent"
      const percentMatch = userMessage.match(/(\d+\.?\d*)\s*%\s*(?:of\s*(?:my\s*)?(?:usdc|busdc|blsmusdc|balance|portfolio))?/i) ||
                          userMessage.match(/(\d+\.?\d*)\s*percent/i);

      // Check for explicit protocol name in the message
      const protocolMatch = userMessage.match(/(?:into|to|in|on)\s+([A-Za-z0-9\.\s]+?)(?:\s+(?:yield|vault|for)|$)/i);
      const explicitProtocol = protocolMatch?.[1]?.trim();

      if (percentMatch) {
        // Percentage allocation: "Deposit 10% of my REDACTED into X"
        const percentage = parseFloat(percentMatch[1]);
        const accountValue = portfolio?.accountValueUsd || 10000;
        const computedAmount = ((accountValue * percentage) / 100).toFixed(0);
        amount = computedAmount;
        vaultName = explicitProtocol || undefined;
        console.log('[deterministic fallback] Parsed percentage allocation:', { percentage, amount, vaultName, format: 'natural-percent' });
      } else {
        // Dollar amount: "Deposit $500 REDACTED into X" or "deposit 500 REDACTED"
        const amountMatch = userMessage.match(/\$(\d+\.?\d*)/i) ||
                            userMessage.match(/(\d+\.?\d*)\s*(?:usdc|dollar|into|in|to|for)?.*?(?:yield|vault|defi|aave|compound)/i) ||
                            userMessage.match(/(?:park|deposit|lend|supply)\s+(\d+\.?\d*)/i);
        amount = amountMatch ? amountMatch[1] : '10';
        vaultName = explicitProtocol || undefined;
        console.log('[deterministic fallback] Parsed dollar allocation:', { amount, vaultName, format: 'natural-dollar' });
      }

      // If no explicit protocol, get recommendation from DefiLlama
      if (!vaultName) {
        const { getVaultRecommendation } = await import('../quotes/defiLlamaQuote');
        const vault = await getVaultRecommendation(parseFloat(amount));
        vaultName = vault?.name;
        console.log('[deterministic fallback] Using recommended vault:', { vaultName });
      }
    }

    return {
      assistantMessage: `I'll allocate $${amount} to ${vaultName || 'yield vault'} on ${chainDisplay}. ${vaultName ? `Earning ~5-7% APY.` : 'Recommended: Aave bUSDC at 5.00% APY.'}`,
      actions: [],
      executionRequest: {
        kind: 'lend_supply',
        chain: targetChain,
        asset: 'REDACTED',
        amount,
        protocol: 'demo',
        vault: vaultName || 'Aave REDACTED',
      },
    };
  }
  
  return null;
}

interface ChatRequest {
  userMessage: string;
  venue: 'hyperliquid' | 'event_demo';
  clientPortfolio?: Partial<BlossomPortfolioSnapshot>;
  conversationId?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  route?: 'chat' | 'planner';
}

/**
 * Task 0: Sim Blueprint Contract (Source of Truth)
 * 
 * For ConfirmTradeCard to render, the UI requires:
 * 1. Message object with:
 *    - msg.type === 'trade_confirm'
 *    - msg.draftId (string ID)
 * 2. Draft strategy in strategies array (found by strategies.find(s => s.id === draftId)):
 *    - id: string (stable, matches draftId)
 *    - status: 'draft'
 *    - side: 'Long' | 'Short'
 *    - market: string
 *    - riskPercent: number
 *    - marginUsd: number (required for ConfirmTradeCard)
 *    - leverage: number (required for ConfirmTradeCard)
 *    - notionalUsd: number (required for ConfirmTradeCard, or calculated as marginUsd * leverage)
 *    - entry: number
 *    - takeProfit: number (optional)
 *    - stopLoss: number (optional)
 *    - instrumentType: 'perp' | 'event'
 *    - sourceText: string
 * 
 * Backend must create draft strategy server-side and return:
 * - draftId in ChatResponse (for UI to set msg.type + msg.draftId)
 * - draft strategy in portfolio.strategies with status: 'draft'
 */
interface ChatResponse {
  assistantMessage: string;
  actions: BlossomAction[];
  executionRequest?: BlossomExecutionRequest | null;
  modelOk?: boolean; // true if model successfully parsed, false on refusal/invalid
  portfolio: BlossomPortfolioSnapshot;
  executionResults?: ExecutionResult[]; // Unified execution results
  errorCode?: 'INSUFFICIENT_BALANCE' | 'SESSION_EXPIRED' | 'RELAYER_FAILED' | 'SLIPPAGE_FAILURE' | 'LLM_REFUSAL' | 'UNKNOWN_ERROR';
  draftId?: string; // Task A: Server-created draft strategy ID (for UI to set msg.type + msg.draftId)
}

/**
 * POST /api/chat
 */
app.post('/api/chat', maybeCheckAccess, async (req, res) => {
  const chatStartTime = Date.now();
  try {
    const { userMessage, venue, clientPortfolio, conversationId, history, route }: ChatRequest = req.body;

    const chatDebugEnabled = process.env.DEBUG_CHAT === 'true';
    // Telemetry: log chat request
    logEvent('chat_request', {
      venue,
      notes: [userMessage ? (userMessage.substring(0, 50) + (userMessage.length > 50 ? '...' : '')) : 'undefined'],
    });

    if (!userMessage) {
      return res.status(400).json({ error: 'userMessage is required' });
    }

    // Log incoming request for debugging
    if (chatDebugEnabled) {
      console.log('[api/chat] Received request:', { 
        userMessage: userMessage ? userMessage.substring(0, 100) : 'undefined', 
        venue,
        messageLength: userMessage ? userMessage.length : 0,
        conversationId: conversationId || 'none',
        historyLength: Array.isArray(history) ? history.length : 0,
        route: route || 'planner',
      });
    }

    // Get current portfolio snapshot before applying new actions
    const portfolioBefore = buildPortfolioSnapshot();
    const portfolioForPrompt = clientPortfolio ? { ...portfolioBefore, ...clientPortfolio } : portfolioBefore;

    // Normalize user input first (handle edge cases like "5weth" → "5 weth")
    const normalizedUserMessage = normalizeUserInput(userMessage);

    const conversationSessionId = conversationId
      ? `conv:${conversationId}`
      : undefined;

    // =============================================================================
    // CONVERSATIONAL BASELINE (P0 Fix: Friendly responses for common queries)
    // =============================================================================
    // These handlers provide instant, friendly responses without hitting the LLM
    // for common conversational patterns that testers/users expect to work.

    // 1. GREETINGS: "hi", "hello", "hey", "yo", "sup", "good morning", etc.
    const GREETING_RE = /^(hi|hello|hey|yo|sup|howdy|hola|good\s*(morning|afternoon|evening)|what'?s?\s*up|greetings?)[\s!?.]*$/i;
    if (GREETING_RE.test(normalizedUserMessage.trim())) {
      if (chatDebugEnabled) {
        console.log('[api/chat] Greeting detected - returning friendly response');
      }
      const portfolioAfter = buildPortfolioSnapshot();
      const usdcBalance = portfolioAfter.balances.find(b => b.symbol === 'REDACTED')?.balanceUsd || 0;

      let greeting = "Hi! I'm Blossom, your AI trading copilot. ";
      if (usdcBalance > 0) {
        greeting += `You have $${usdcBalance.toLocaleString()} bUSDC ready to deploy.\n\n`;
      } else {
        greeting += "It looks like you don't have any tokens yet. Connect your wallet and visit the faucet to get test tokens.\n\n";
      }
      greeting += "Here's what I can help with:\n";
      greeting += "• **Swaps**: 'Swap 10 bUSDC to WETH'\n";
      greeting += "• **Perps**: 'Long ETH with 3x leverage'\n";
      greeting += "• **DeFi Yield**: 'Deposit 100 bUSDC into Aave'\n";
      greeting += "• **Prediction Markets**: 'Bet $20 YES on Fed rate cut'\n\n";
      greeting += "What would you like to do?";

      return res.json({
        ok: true,
        assistantMessage: greeting,
        actions: [],
        executionRequest: null,
        modelOk: true,
        portfolio: portfolioAfter,
        executionResults: [],
      });
    }

    // 2. BALANCE QUERIES: "what's my balance", "whats my balance", "balance", "how much do i have"
    const BALANCE_RE = /^(what'?s?\s*(my\s*)?(balance|money|funds|holdings)|my\s*balance|balance|how\s*much\s*(do\s*i\s*have|money)|show\s*(my\s*)?(balance|funds))[\s?!]*$/i;
    if (BALANCE_RE.test(normalizedUserMessage.trim())) {
      if (chatDebugEnabled) {
        console.log('[api/chat] Balance query detected');
      }
      const portfolioAfter = buildPortfolioSnapshot();
      const balances = portfolioAfter.balances || [];

      // Check if we have client portfolio with real balances
      const hasRealBalances = clientPortfolio?.balances?.length > 0 || balances.some(b => b.balanceUsd > 0);

      if (!hasRealBalances) {
        // No wallet connected or no balances
        const response = "I don't see any token balances yet. Here's what you can do:\n\n" +
          "1. **Connect your wallet** using the button in the top right\n" +
          "2. **Get test tokens** from the Sepolia faucet\n" +
          "3. Once you have tokens, I can help you swap, trade, or earn yield!\n\n" +
          "Need help getting started? Just ask!";

        return res.json({
          ok: true,
          assistantMessage: response,
          actions: [],
          executionRequest: null,
          modelOk: true,
          portfolio: portfolioAfter,
          executionResults: [],
        });
      }

      // Build balance response
      let response = "**Your Current Balances:**\n\n";
      const displayBalances = clientPortfolio?.balances?.length > 0 ? clientPortfolio.balances : balances;

      for (const bal of displayBalances) {
        if (bal.balanceUsd > 0) {
          const symbol = bal.symbol === 'REDACTED' ? 'bUSDC' : bal.symbol;
          response += `• ${symbol}: $${bal.balanceUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`;
        }
      }

      const totalValue = displayBalances.reduce((sum: number, b: any) => sum + (b.balanceUsd || 0), 0);
      response += `\n**Total:** $${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n\n`;
      response += "What would you like to do with your tokens?";

      return res.json({
        ok: true,
        assistantMessage: response,
        actions: [],
        executionRequest: null,
        modelOk: true,
        portfolio: portfolioAfter,
        executionResults: [],
      });
    }

    // 3. HELP/CAPABILITY QUERIES: "help", "what can you do", "how do you work"
    const HELP_RE = /^(help|what\s*can\s*you\s*(do|help\s*with)|how\s*(do\s*you\s*work|does\s*this\s*work)|what\s*are\s*you|who\s*are\s*you|getting\s*started|how\s*to\s*(start|begin|use))[\s?!]*$/i;
    if (HELP_RE.test(normalizedUserMessage.trim())) {
      if (chatDebugEnabled) {
        console.log('[api/chat] Help query detected');
      }
      const portfolioAfter = buildPortfolioSnapshot();

      const response = "I'm Blossom, your AI trading copilot! Here's what I can help with:\n\n" +
        "**🔄 Swaps**\n" +
        "• 'Swap 100 bUSDC to WETH'\n" +
        "• 'Convert 0.1 ETH to bUSDC'\n\n" +
        "**📈 Perpetual Trading**\n" +
        "• 'Long ETH with 5x leverage using 3% risk'\n" +
        "• 'Short BTC 10x with $50 margin'\n\n" +
        "**💰 DeFi Yield**\n" +
        "• 'Deposit 500 bUSDC into Aave'\n" +
        "• 'Show me top DeFi protocols by TVL'\n\n" +
        "**🎯 Prediction Markets**\n" +
        "• 'Bet $20 YES on Fed rate cut'\n" +
        "• 'Show top Polymarket events'\n\n" +
        "**📊 Portfolio**\n" +
        "• 'What's my balance?'\n" +
        "• 'Show my positions'\n" +
        "• 'What's my exposure?'\n\n" +
        "Just type what you want to do in plain English!";

      return res.json({
        ok: true,
        assistantMessage: response,
        actions: [],
        executionRequest: null,
        modelOk: true,
        portfolio: portfolioAfter,
        executionResults: [],
      });
    }

    // =============================================================================
    // STATE MACHINE: Intent Path Isolation (Phase 1)
    // =============================================================================
    // Get or create session context for state machine tracking
    const walletAddress = req.headers['x-wallet-address'] as string;
    const chatSessionId = walletAddress
      ? `chat:${walletAddress.toLowerCase()}`
      : `chat:anonymous:${req.ip || 'unknown'}`;

    const stateContext = getContext(chatSessionId);
    if (walletAddress && !stateContext.walletAddress) {
      updateContext(chatSessionId, { walletAddress: walletAddress.toLowerCase() });
    }

    // Check if this is a confirmation/cancellation response
    if (stateContext.currentState === IntentState.CONFIRMING) {
      // User is responding to a confirmation request
      if (isConfirmation(normalizedUserMessage) || isCancellation(normalizedUserMessage)) {
        const confirmResult = processConfirmation(chatSessionId, normalizedUserMessage);

        if (confirmResult.confirmed) {
          // User confirmed - proceed with execution
          // The pendingIntent will be executed below with confirmedIntentId set
          logTransition(chatSessionId, 'USER_CONFIRMED', {
            pendingIntentId: stateContext.pendingIntentId,
          });

          // If there's a pending execution request, return it with confirmation status
          if (stateContext.pendingIntent) {
            const portfolioAfter = buildPortfolioSnapshot();
            return res.json({
              ok: true,
              assistantMessage: "Confirmed. Executing your request...",
              actions: [],
              executionRequest: null, // Frontend will handle re-triggering execution
              modelOk: true,
              portfolio: portfolioAfter,
              executionResults: [],
              confirmationStatus: {
                confirmed: true,
                pendingIntent: stateContext.pendingIntent,
                sessionId: chatSessionId,
              },
            });
          }
        } else {
          // User cancelled or response didn't match
          logTransition(chatSessionId, isCancellation(normalizedUserMessage) ? 'USER_CANCELLED' : 'CONFIRMATION_RETRY', {});

          const portfolioAfter = buildPortfolioSnapshot();
          return res.json({
            ok: true,
            assistantMessage: confirmResult.message || "Action cancelled. What else can I help you with?",
            actions: [],
            executionRequest: null,
            modelOk: true,
            portfolio: portfolioAfter,
            executionResults: [],
            confirmationStatus: {
              confirmed: false,
              cancelled: isCancellation(normalizedUserMessage),
            },
          });
        }
      }
      // If not a confirmation/cancellation, reset state and process as new intent
      resetContextState(chatSessionId);
    }

    // Classify the intent path early for state machine tracking
    // Use validation to detect cross-category mismatches (e.g., "bet on BTC long")
    const classifyResult = classifyIntentPathWithValidation(normalizedUserMessage);
    const intentPath = classifyResult.path;

    // Log PATH_VIOLATION if mismatch detected
    if (classifyResult.mismatch) {
      console.warn('[api/chat] PATH_VIOLATION detected:', {
        userMessage: normalizedUserMessage.substring(0, 100),
        detectedPath: classifyResult.mismatch.detectedPath,
        conflictingKeywords: classifyResult.mismatch.conflictingKeywords,
        suggestedPath: classifyResult.mismatch.suggestedPath,
      });

      // Return helpful error to user instead of proceeding with ambiguous intent
      const portfolioAfter = buildPortfolioSnapshot();
      return res.json({
        ok: true,
        assistantMessage: `I detected a potential mismatch in your intent. ${classifyResult.mismatch.message} Please clarify what you'd like to do.`,
        actions: [],
        executionRequest: null,
        modelOk: true,
        portfolio: portfolioAfter,
        executionResults: [],
        metadata: {
          pathViolation: true,
          detectedPath: classifyResult.mismatch.detectedPath,
          conflictingKeywords: classifyResult.mismatch.conflictingKeywords,
          suggestedPath: classifyResult.mismatch.suggestedPath,
        },
      });
    }

    logTransition(chatSessionId, 'INTENT_CLASSIFIED', {
      intentPath,
      currentPath: stateContext.currentPath,
      userMessage: normalizedUserMessage.substring(0, 50),
    });

    // =============================================================================

    // CRITICAL: Detect DeFi TVL query FIRST (before LLM call)
    // Matches: "show me top 5 defi protocols by TVL", "list top defi protocols", etc.
    const LIST_DEFI_PROTOCOLS_RE = /\b(show\s+me\s+)?(top\s+(\d+)\s+)?(defi\s+)?protocols?\s+(by\s+)?(tvl|total\s+value\s+locked)\b/i;
    const hasListDefiProtocolsIntent = LIST_DEFI_PROTOCOLS_RE.test(normalizedUserMessage) ||
      /\b(list|show|display|fetch|get|explore)\s+(top|best|highest)\s+(\d+)?\s*(defi\s+)?protocols?\b/i.test(normalizedUserMessage) ||
      /\b(best\s+defi|top\s+defi|explore\s+top\s+protocols)\b/i.test(normalizedUserMessage) ||
      /\b(top\s+5\s+defi|top\s+defi\s+protocols|defi\s+protocols\s+by\s+tvl)\b/i.test(normalizedUserMessage);

    if (hasListDefiProtocolsIntent) {
      if (chatDebugEnabled) {
      console.log('[api/chat] DeFi TVL query detected - fetching top protocols');
    }

      // Extract requested count (default: 5)
      let requestedCount = 5;
      const numericMatch = normalizedUserMessage.match(/\btop\s+(\d+)\s+(defi\s+)?protocols?\b/i);
      if (numericMatch && numericMatch[1]) {
        requestedCount = parseInt(numericMatch[1], 10);
      }

      try {
        const { getTopProtocolsByTVL } = await import('../quotes/defiLlamaQuote');
        const protocols = await getTopProtocolsByTVL(requestedCount);

        // Return response with protocol list (frontend will render with quick action buttons)
        const portfolioAfter = buildPortfolioSnapshot();
        return res.json({
          ok: true,
          assistantMessage: `Here are the top ${protocols.length} DeFi protocol${protocols.length !== 1 ? 's' : ''} by TVL right now:`,
          actions: [],
          executionRequest: null,
          modelOk: true,
          portfolio: portfolioAfter,
          executionResults: [],
          defiProtocolsList: protocols, // Special field for protocol list
        });
      } catch (error: any) {
        console.error('[api/chat] Failed to fetch DeFi protocols:', error.message);
        // Return error response
        const portfolioAfter = buildPortfolioSnapshot();
        return res.json({
          ok: false,
          assistantMessage: "I couldn't fetch the DeFi protocols right now. Please try again later.",
          actions: [],
          executionRequest: null,
          modelOk: false,
          portfolio: portfolioAfter,
          executionResults: [],
        });
      }
    }

    // CRITICAL: Detect Price Query FIRST (before LLM call)
    // Matches: "what is ETH price", "btc price right now", "wuts btc doin", "eth price?", etc.
    const PRICE_QUERY_RE = /\b(what('?s|\s+is)?\s+)?(the\s+)?(current\s+)?(eth|btc|sol|bitcoin|ethereum|solana)\s*(price|value|worth|cost|rate|doin|doing)?\s*(right\s+now|rn|today|currently)?\s*\??$/i;
    const SLANG_PRICE_RE = /\b(wut|wuts|whats|wat|how\s+much)\s+(is\s+)?(eth|btc|sol|bitcoin|ethereum|solana)\s*(doing|doin|worth|at|rn|right\s+now)?\b/i;
    // Matches: "is sol pumping", "is eth up", "is btc down today", "how is eth doing"
    const PUMP_PRICE_RE = /\b(is|how\s+is)\s+(eth|btc|sol|bitcoin|ethereum|solana)\s+(pumping|dumping|up|down|doing|mooning|crashing|performing)\s*(today|rn|right\s+now|currently)?\s*\??$/i;
    // Exclude swap/trade intents from price query detection
    const isSwapIntent = /\b(swap|exchange|trade|convert|buy|sell)\b/i.test(normalizedUserMessage);
    const hasPriceQueryIntent = !isSwapIntent && (PRICE_QUERY_RE.test(normalizedUserMessage) || SLANG_PRICE_RE.test(normalizedUserMessage) || PUMP_PRICE_RE.test(normalizedUserMessage));

    if (hasPriceQueryIntent) {
      if (chatDebugEnabled) {
        console.log('[api/chat] Price query detected');
      }

      // Extract which asset(s) user is asking about
      const ethMatch = /\b(eth|ethereum)\b/i.test(normalizedUserMessage);
      const btcMatch = /\b(btc|bitcoin)\b/i.test(normalizedUserMessage);
      const solMatch = /\b(sol|solana)\b/i.test(normalizedUserMessage);

      try {
        const { getPrice } = await import('../services/prices');
        const prices: { symbol: string; priceUsd: number; source: string }[] = [];

        if (ethMatch) {
          const ethPrice = await getPrice('ETH');
          prices.push({ symbol: 'ETH', priceUsd: ethPrice.priceUsd, source: ethPrice.source || 'coingecko' });
        }
        if (btcMatch) {
          const btcPrice = await getPrice('BTC');
          prices.push({ symbol: 'BTC', priceUsd: btcPrice.priceUsd, source: btcPrice.source || 'coingecko' });
        }
        if (solMatch) {
          const solPrice = await getPrice('SOL');
          prices.push({ symbol: 'SOL', priceUsd: solPrice.priceUsd, source: solPrice.source || 'coingecko' });
        }

        // Default to ETH if no specific match
        if (prices.length === 0) {
          const ethPrice = await getPrice('ETH');
          prices.push({ symbol: 'ETH', priceUsd: ethPrice.priceUsd, source: ethPrice.source || 'coingecko' });
        }

        const timestamp = new Date().toISOString();
        const priceLines = prices.map(p => `${p.symbol}: $${p.priceUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join('\n');
        const sources = [...new Set(prices.map(p => p.source))].join(', ');

        const portfolioAfter = buildPortfolioSnapshot();
        return res.json({
          ok: true,
          assistantMessage: `${priceLines}\n\nSource: ${sources} | Updated: ${timestamp}`,
          actions: [],
          executionRequest: null,
          modelOk: true,
          portfolio: portfolioAfter,
          executionResults: [],
          priceData: prices.map(p => ({ ...p, timestamp })),
        });
      } catch (error: any) {
        console.error('[api/chat] Failed to fetch price:', error.message);
        const portfolioAfter = buildPortfolioSnapshot();
        return res.json({
          ok: false,
          assistantMessage: "I couldn't fetch the current price. Please try again.",
          actions: [],
          executionRequest: null,
          modelOk: false,
          portfolio: portfolioAfter,
          executionResults: [],
        });
      }
    }

    // CRITICAL: Detect Position/Exposure Query FIRST (before LLM call)
    // Matches: "show my positions", "current exposure", "closest to liquidation", etc.
    const POSITION_QUERY_RE = /\b(show|display|what('?s|'re|\s+are)?|list|get)\s+(my\s+)?(current\s+)?(positions?|exposure|holdings?|portfolio|balances?)\b/i;
    const LIQUIDATION_QUERY_RE = /\b(closest|nearest|which)\s+(to\s+)?(liquidation|liq)\b/i;
    const EXPOSURE_QUERY_RE = /\b(my\s+)?(current\s+)?(perp\s+)?exposure\b/i;
    const hasPositionQueryIntent = POSITION_QUERY_RE.test(normalizedUserMessage) ||
                                   LIQUIDATION_QUERY_RE.test(normalizedUserMessage) ||
                                   EXPOSURE_QUERY_RE.test(normalizedUserMessage);

    if (hasPositionQueryIntent) {
      if (chatDebugEnabled) {
        console.log('[api/chat] Position/exposure query detected');
      }

      // Use clientPortfolio if available, otherwise use server-side portfolio
      const portfolio = clientPortfolio || portfolioBefore;
      const balances = Array.isArray(portfolio.balances) ? portfolio.balances : [];
      const defiPositions = Array.isArray(portfolio.defiPositions) ? portfolio.defiPositions : [];
      const strategies = Array.isArray(portfolio.strategies) ? portfolio.strategies : [];
      const perpExposure = portfolio.openPerpExposureUsd || 0;
      const eventExposure = portfolio.eventExposureUsd || 0;

      // Build response based on query type
      let responseMessage = '';

      if (LIQUIDATION_QUERY_RE.test(normalizedUserMessage)) {
        // Find position closest to liquidation
        const activePerps = strategies.filter((s: any) => s.status === 'active' && s.instrumentType === 'perp');
        if (activePerps.length === 0) {
          responseMessage = "You don't have any active perp positions that could be liquidated.";
        } else {
          // Sort by distance to liquidation (simplified: higher leverage = closer to liq)
          const sorted = [...activePerps].sort((a: any, b: any) => (b.leverage || 1) - (a.leverage || 1));
          const closest = sorted[0];
          responseMessage = `Your position closest to liquidation:\n\n` +
            `**${closest.side || 'Long'} ${closest.market || 'ETH-USD'}** @ ${closest.leverage || 1}x\n` +
            `Entry: $${closest.entry?.toLocaleString() || 'N/A'}\n` +
            `Size: $${closest.notionalUsd?.toLocaleString() || 'N/A'}\n` +
            `PnL: ${closest.unrealizedPnlUsd >= 0 ? '+' : ''}$${closest.unrealizedPnlUsd?.toFixed(2) || '0.00'}`;
        }
      } else if (EXPOSURE_QUERY_RE.test(normalizedUserMessage)) {
        responseMessage = `**Current Exposure:**\n\n` +
          `Perp Exposure: $${perpExposure.toLocaleString()}\n` +
          `Event Exposure: $${eventExposure.toLocaleString()}\n` +
          `Total: $${(perpExposure + eventExposure).toLocaleString()}`;
      } else {
        // General positions query
        const positionLines: string[] = [];

        if (balances.length > 0) {
          positionLines.push('**Balances:**');
          balances.slice(0, 5).forEach((b: any) => {
            positionLines.push(`  ${b.symbol}: $${(b.balanceUsd || 0).toLocaleString()}`);
          });
        }

        if (defiPositions.length > 0) {
          positionLines.push('\n**DeFi Positions:**');
          defiPositions.slice(0, 5).forEach((p: any) => {
            positionLines.push(`  ${p.protocol} ${p.type}: $${(p.valueUsd || 0).toLocaleString()} (${p.asset})`);
          });
        }

        const activeStrategies = strategies.filter((s: any) => s.status === 'active');
        if (activeStrategies.length > 0) {
          positionLines.push('\n**Active Positions:**');
          activeStrategies.slice(0, 5).forEach((s: any) => {
            const pnl = s.unrealizedPnlUsd || 0;
            positionLines.push(`  ${s.side || 'Long'} ${s.market}: $${(s.notionalUsd || 0).toLocaleString()} (${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)})`);
          });
        }

        if (positionLines.length === 0) {
          responseMessage = "You don't have any positions yet. Try:\n- 'Swap 10 bUSDC to WETH'\n- 'Long BTC with 3x leverage'\n- 'Deposit 100 bUSDC for yield'";
        } else {
          responseMessage = positionLines.join('\n');
        }
      }

      const portfolioAfter = buildPortfolioSnapshot();
      return res.json({
        ok: true,
        assistantMessage: responseMessage,
        actions: [],
        executionRequest: null,
        modelOk: true,
        portfolio: portfolioAfter,
        executionResults: [],
      });
    }

    // CRITICAL: Detect Event Markets list query FIRST (before LLM call)
    // Matches: "show me top 5 prediction markets by volume", "top event markets", etc.
    const LIST_EVENT_MARKETS_RE = /\b(show\s+me\s+)?(top\s+(\d+)\s+)?(prediction|pred|event)\s+markets?\s*(by\s+)?(volume|tvl)?\b/i;
    const hasListEventMarketsIntent = LIST_EVENT_MARKETS_RE.test(normalizedUserMessage) ||
      /\b(list|show|display|fetch|get|explore)\s+(top|best|highest)\s+(\d+)?\s*(prediction|pred|event)\s+markets?\b/i.test(normalizedUserMessage) ||
      /\b(best\s+prediction|top\s+prediction|top\s+pred|top\s+event|explore\s+top\s+markets)\b/i.test(normalizedUserMessage) ||
      /\b(top\s+5\s+prediction|top\s+prediction\s+markets|prediction\s+markets\s+by\s+volume|top\s+pred\s+markets?)\b/i.test(normalizedUserMessage) ||
      /\b(show\s+me\s+top\s+(prediction|pred)\s+markets?)\b/i.test(normalizedUserMessage);

    if (hasListEventMarketsIntent) {
      if (chatDebugEnabled) {
        console.log('[api/chat] Event Markets list query detected - fetching top markets');
      }

      // Extract requested count (default: 5)
      let requestedCount = 5;
      const numericMatch = normalizedUserMessage.match(/\btop\s+(\d+)\s+(prediction|event)\s+markets?\b/i);
      if (numericMatch && numericMatch[1]) {
        requestedCount = parseInt(numericMatch[1], 10);
      }

      try {
        const { getEventMarketsWithRouting } = await import('../quotes/eventMarkets');
        const result = await getEventMarketsWithRouting(requestedCount);

        // Return response with event market list (frontend will render with quick action buttons)
        const portfolioAfter = buildPortfolioSnapshot();
        return res.json({
          ok: true,
          assistantMessage: `Here are the top ${result.markets.length} prediction market${result.markets.length !== 1 ? 's' : ''} by volume right now:`,
          actions: [],
          executionRequest: null,
          modelOk: true,
          portfolio: portfolioAfter,
          executionResults: [],
          eventMarketsList: result.markets, // Special field for event market list
          routing: result.routing, // Sprint 3: Truthful routing metadata
        });
      } catch (error: any) {
        console.error('[api/chat] Failed to fetch event markets:', error.message, error.stack);
        // Return error response with fallback routing metadata
        const portfolioAfter = buildPortfolioSnapshot();
        const correlationId = req.correlationId || makeCorrelationId('error');
        return res.json({
          ok: false,
          assistantMessage: "I couldn't fetch the prediction markets right now. Please try again later.",
          actions: [],
          executionRequest: null,
          modelOk: false,
          portfolio: portfolioAfter,
          executionResults: [],
          routing: {
            source: 'fallback',
            kind: 'event_markets',
            ok: false,
            reason: `Error: ${error.message || 'Unknown error'}`,
            latencyMs: 0,
            mode: process.env.ROUTING_MODE || 'hybrid',
            correlationId,
          },
        });
      }
    }

    // Detect event market quick action format
    // Format 1 (structured): "Bet YES on market:"Fed cuts rates" stakeUsd:"50""
    // Format 2 (natural): "Bet YES on "Trump wins" with 2% risk"
    const hasEventQuickActionStructured = /bet\s+(YES|NO)\s+on\s+market:"?([^"]+?)"?(?:\s+stake(Usd|Pct):"?(\d+\.?\d*)"?)?/i.test(normalizedUserMessage);
    const hasEventQuickActionNatural = /bet\s+(YES|NO)\s+on\s+"([^"]+)"\s+with\s+(\d+\.?\d*)%\s+risk/i.test(normalizedUserMessage);

    if (hasEventQuickActionStructured || hasEventQuickActionNatural) {
      let eventMatch;
      let isNaturalFormat = false;

      if (hasEventQuickActionNatural) {
        eventMatch = normalizedUserMessage.match(/bet\s+(YES|NO)\s+on\s+"([^"]+)"\s+with\s+(\d+\.?\d*)%\s+risk/i);
        isNaturalFormat = true;
      } else {
        eventMatch = normalizedUserMessage.match(/bet\s+(YES|NO)\s+on\s+market:"?([^"]+?)"?(?:\s+stake(Usd|Pct):"?(\d+\.?\d*)"?)?/i);
      }

      if (eventMatch) {
        let outcome: string;
        let marketTitle: string;
        let stakeUsd: number;

        if (isNaturalFormat) {
          // Natural format: "Bet YES on "Trump wins" with 2% risk"
          const [fullMatch, outcomeRaw, marketTitleRaw, riskPct] = eventMatch;
          outcome = outcomeRaw;
          marketTitle = marketTitleRaw;
          const accountValue = portfolioBefore?.accountValueUsd || 10000;
          stakeUsd = (accountValue * parseFloat(riskPct)) / 100;
          console.log('[event quick action] Natural format detected:', { outcome, marketTitle, riskPct, accountValue, stakeUsd });
        } else {
          // Structured format: "Bet YES on market:"Fed cuts" stakeUsd:"50""
          const [_, outcomeRaw, marketTitleRaw, stakeType, stakeValue] = eventMatch;
          outcome = outcomeRaw;
          marketTitle = marketTitleRaw;

          if (stakeType?.toLowerCase() === 'pct') {
            const accountValue = portfolioBefore?.accountValueUsd || 10000;
            stakeUsd = (accountValue * parseFloat(stakeValue || '2')) / 100;
          } else {
            stakeUsd = parseFloat(stakeValue || '50');
          }
          console.log('[event quick action] Structured format detected:', { outcome, marketTitle, stakeType, stakeUsd });
        }

        // Find matching market from event markets ticker
        try {
          const { getEventMarketsWithRouting } = await import('../quotes/eventMarkets');
          const result = await getEventMarketsWithRouting(10);
          const markets = result.markets;
          const matchedMarket = markets.find(m =>
            m.title.toLowerCase().includes(marketTitle.toLowerCase()) ||
            marketTitle.toLowerCase().includes(m.title.toLowerCase())
          );

          if (matchedMarket) {
            const price = outcome === 'YES' ? matchedMarket.yesPrice : matchedMarket.noPrice;
            const maxPayout = stakeUsd / price;

            const portfolioAfter = buildPortfolioSnapshot();
            return res.json({
              ok: true,
              assistantMessage: `I'll place a ${outcome} bet on "${matchedMarket.title}" with $${stakeUsd.toFixed(0)} stake. At ${(price * 100).toFixed(1)}¢ odds, your max payout is $${maxPayout.toFixed(0)}. Confirm to execute?`,
              actions: [],
              executionRequest: {
                kind: 'event',
                chain: resolveExecutionSettlementChain(process.env.DEFAULT_SETTLEMENT_CHAIN || 'base_sepolia'),
                marketId: matchedMarket.id,
                outcome,
                stakeUsd,
                price,
              },
              modelOk: true,
              portfolio: portfolioAfter,
              executionResults: [],
            });
          } else {
            console.warn('[deterministic fallback] No matching event market found for:', marketTitle);
            // Fall through to LLM if no match found
          }
        } catch (error: any) {
          console.error('[deterministic fallback] Failed to fetch event markets:', error.message);
          // Fall through to LLM on error
        }
      }
    }

    // Build prompts for LLM (now async to fetch live market data)
    // Use normalized message for prompt building
    const { systemPrompt, userPrompt, isPredictionMarketQuery } = await buildBlossomPrompts({
      userMessage: normalizedUserMessage,
      portfolio: portfolioForPrompt,
      venue: venue || 'hyperliquid',
    });

    const boundedHistory = Array.isArray(history) ? history.slice(-16) : [];

    if (conversationSessionId) {
      appendMessage(conversationSessionId, {
        role: 'user',
        content: normalizedUserMessage,
      });
    }
    const historyBlock = boundedHistory.length
      ? `**Conversation History:**\n${boundedHistory
          .map(item => `${item.role.toUpperCase()}: ${item.content}`)
          .join('\n')}\n\n`
      : '';

    let llmSystemPrompt = systemPrompt;
    let llmUserPrompt = userPrompt;
    const routeDecision = route || 'planner';
    const wantsChatOnly = routeDecision === 'chat';

    if (wantsChatOnly) {
      llmSystemPrompt = `You are Blossom, a conversational assistant. Answer the user's question directly and helpfully without producing any trading actions. Respond with ONLY a JSON object that includes "assistantMessage", an empty "actions" array, and "executionRequest": null. Do NOT omit executionRequest.\n\n${systemPrompt}`;
      llmUserPrompt = `${historyBlock}${userPrompt}`;
    } else if (boundedHistory.length > 0) {
      llmUserPrompt = `${historyBlock}${userPrompt}`;
    }

    if (chatDebugEnabled) {
      const hasGeminiKey = Boolean(process.env.BLOSSOM_GEMINI_API_KEY || process.env.GEMINI_API_KEY);
      console.log('[api/chat] LLM context debug', {
        provider: process.env.BLOSSOM_MODEL_PROVIDER || 'stub',
        hasGeminiKey,
        conversationId: conversationId || 'none',
        historyLength: boundedHistory.length,
        route: routeDecision,
      });
    }

    let assistantMessage = '';
    let actions: BlossomAction[] = [];
    let modelResponse: ModelResponse | null = null;

    // Detect if this is a swap prompt (use normalized message)
    const isSwapPrompt = /swap|exchange|convert/i.test(normalizedUserMessage) && 
      (normalizedUserMessage.toLowerCase().includes('usdc') || 
       normalizedUserMessage.toLowerCase().includes('weth') || 
       normalizedUserMessage.toLowerCase().includes('eth'));
    
    // Detect if this is a DeFi/yield prompt
    const isDefiPrompt = /park|deposit|earn yield|lend|supply|allocate/i.test(normalizedUserMessage) &&
      (normalizedUserMessage.toLowerCase().includes('usdc') ||
       normalizedUserMessage.toLowerCase().includes('yield') ||
       normalizedUserMessage.toLowerCase().includes('stablecoin') ||
       normalizedUserMessage.toLowerCase().includes('protocol'));
    
    // Detect if this is a perp prompt
    const isPerpPrompt = /open|long|short|perp/i.test(normalizedUserMessage) && 
      (normalizedUserMessage.toLowerCase().includes('btc') || 
       normalizedUserMessage.toLowerCase().includes('eth') || 
       normalizedUserMessage.toLowerCase().includes('sol') ||
       normalizedUserMessage.toLowerCase().includes('2x') ||
       normalizedUserMessage.toLowerCase().includes('3x') ||
       normalizedUserMessage.toLowerCase().includes('leverage'));
    
    // Detect if this is an event prompt - match patterns like "bet X on Y above/below Z"
    // IMPORTANT: Perp intents take priority - if isPerpPrompt is true, isEventPrompt should be false
    const hasPerpKeywords = /\b(long|short|perp|leverage|\d+x)\b/i.test(normalizedUserMessage);
    // Extended event keywords: "bet/wager/risk on/event/prediction market" OR "YES/NO on" patterns OR "take YES/NO"
    const hasEventKeywords = /bet|wager|risk.*on|event|prediction\s*market/i.test(normalizedUserMessage) ||
      /\b(yes|no)\s+on\b/i.test(normalizedUserMessage) ||
      /\btake\s+(yes|no)\b/i.test(normalizedUserMessage);
    const isEventPrompt = !isPerpPrompt && !hasPerpKeywords && hasEventKeywords &&
      (normalizedUserMessage.toLowerCase().includes('yes') ||
       normalizedUserMessage.toLowerCase().includes('no') ||
       normalizedUserMessage.toLowerCase().includes('fed') ||
       normalizedUserMessage.toLowerCase().includes('rate cut') ||
       /(?:above|below|over|under|at)\s*\$?\d+/i.test(normalizedUserMessage) ||
       /btc|bitcoin|eth|ethereum|sol|solana/i.test(normalizedUserMessage));

    // Check if we're in stub mode and this is a prediction market query
    const hasOpenAIKey = !!process.env.BLOSSOM_OPENAI_API_KEY;
    const hasAnthropicKey = !!process.env.BLOSSOM_ANTHROPIC_API_KEY;
    const provider = process.env.BLOSSOM_MODEL_PROVIDER || 'stub';
    const isStubMode = provider === 'stub' || (!hasOpenAIKey && !hasAnthropicKey);

    // Log stub mode detection for debugging
    if (chatDebugEnabled) {
      console.log('[api/chat] Stub mode check:', {
        provider,
        hasOpenAIKey,
        hasAnthropicKey,
        isStubMode,
        isPredictionMarketQuery,
        isSwapPrompt,
        userMessage: userMessage.substring(0, 100)
      });
    }

    if (isStubMode && isPredictionMarketQuery) {
      // Short-circuit: build deterministic response for prediction markets in stub mode
      if (chatDebugEnabled) {
        console.log('[api/chat] ✅ STUB SHORT-CIRCUIT: Building deterministic prediction market response');
      }
      
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
        modelResponse = {
          assistantMessage,
          actions,
          executionRequest: null,
          modelOk: true,
        };
        if (chatDebugEnabled) {
          console.log('[api/chat] ✅ Stub response built:', { 
            messageLength: assistantMessage?.length || 0, 
            actionCount: actions.length,
            preview: assistantMessage ? assistantMessage.substring(0, 150) : 'N/A'
          });
        }
      } catch (error: any) {
        console.error('[api/chat] ❌ Failed to build stub prediction market response:', error.message);
        // Fall through to normal stub LLM call
        const llmOutput = await callLlm({ systemPrompt: llmSystemPrompt, userPrompt: llmUserPrompt });
        modelResponse = await parseModelResponse(
          llmOutput.rawJson,
          wantsChatOnly ? false : isSwapPrompt,
          false,
          normalizeUserInput(userMessage),
          false,
          false
        );
        assistantMessage = modelResponse.assistantMessage;
        actions = modelResponse.actions;
      }
    } else {
      // Normal flow: call LLM (stub or real)
      if (chatDebugEnabled) {
        console.log('[api/chat] → Normal LLM flow (stub or real)');
      }
      
      // Normalize user input before processing
      const normalizedUserMessage = normalizeUserInput(userMessage);
      const normalizedUserPrompt = `${historyBlock}${userPrompt.replace(userMessage, normalizedUserMessage)}`;
      
      // Detect prompts on normalized message
      const normalizedIsSwapPrompt = /swap|exchange|convert/i.test(normalizedUserMessage) && 
        (normalizedUserMessage.toLowerCase().includes('usdc') || 
         normalizedUserMessage.toLowerCase().includes('weth') || 
         normalizedUserMessage.toLowerCase().includes('eth'));
      const normalizedIsDefiPrompt = /park|deposit|earn yield|lend|supply|allocate/i.test(normalizedUserMessage) &&
        (normalizedUserMessage.toLowerCase().includes('usdc') ||
         normalizedUserMessage.toLowerCase().includes('yield') ||
         normalizedUserMessage.toLowerCase().includes('stablecoin') ||
         normalizedUserMessage.toLowerCase().includes('protocol'));
      const normalizedIsPerpPrompt = /open|long|short|perp/i.test(normalizedUserMessage) && 
        (normalizedUserMessage.toLowerCase().includes('btc') || 
         normalizedUserMessage.toLowerCase().includes('eth') || 
         normalizedUserMessage.toLowerCase().includes('sol') ||
         normalizedUserMessage.toLowerCase().includes('2x') ||
         normalizedUserMessage.toLowerCase().includes('3x') ||
         normalizedUserMessage.toLowerCase().includes('leverage'));
      // IMPORTANT: Perp intents take priority - if normalizedIsPerpPrompt is true, isEventPrompt should be false
      const normalizedHasPerpKeywords = /\b(long|short|perp|leverage|\d+x)\b/i.test(normalizedUserMessage);
      // Extended event keywords: "bet/wager/risk on/event/prediction market" OR "YES/NO on" patterns OR "take YES/NO"
      const normalizedHasEventKeywords = /bet|wager|risk.*on|event|prediction\s*market/i.test(normalizedUserMessage) ||
        /\b(yes|no)\s+on\b/i.test(normalizedUserMessage) ||
        /\btake\s+(yes|no)\b/i.test(normalizedUserMessage);
      const normalizedIsEventPrompt = !normalizedIsPerpPrompt && !normalizedHasPerpKeywords && normalizedHasEventKeywords &&
        (normalizedUserMessage.toLowerCase().includes('yes') ||
         normalizedUserMessage.toLowerCase().includes('no') ||
         normalizedUserMessage.toLowerCase().includes('fed') ||
         normalizedUserMessage.toLowerCase().includes('rate cut') ||
         /(?:above|below|over|under|at)\s*\$?\d+/i.test(normalizedUserMessage) ||
         /btc|bitcoin|eth|ethereum|sol|solana/i.test(normalizedUserMessage));
      
      try {
        // Call LLM with normalized prompt
        const llmOutput = await callLlm({ systemPrompt: llmSystemPrompt, userPrompt: wantsChatOnly ? llmUserPrompt : normalizedUserPrompt });

        // Parse JSON response with normalized message for fallback
        modelResponse = await parseModelResponse(
          llmOutput.rawJson,
          wantsChatOnly ? false : normalizedIsSwapPrompt,
          wantsChatOnly ? false : normalizedIsDefiPrompt,
          normalizedUserMessage,
          wantsChatOnly ? false : normalizedIsPerpPrompt,
          wantsChatOnly ? false : normalizedIsEventPrompt
        );
        assistantMessage = modelResponse.assistantMessage;
        actions = modelResponse.actions;
        
        // If model failed OR succeeded but missing executionRequest for execution intents, try deterministic fallback
        const needsFallback = !wantsChatOnly && (
          !modelResponse.modelOk ||
          (!modelResponse.executionRequest && (normalizedIsSwapPrompt || normalizedIsDefiPrompt || normalizedIsPerpPrompt || normalizedIsEventPrompt))
        );

        if (needsFallback && (normalizedIsSwapPrompt || normalizedIsDefiPrompt || normalizedIsPerpPrompt || normalizedIsEventPrompt)) {
          console.log('[api/chat] Triggering deterministic fallback for execution intent');
          const fallback = await applyDeterministicFallback(normalizedUserMessage, normalizedIsSwapPrompt, normalizedIsDefiPrompt, normalizedIsPerpPrompt, normalizedIsEventPrompt, portfolioForPrompt);
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
      } catch (error: any) {
        console.error('LLM call or parsing error:', error.message);
        // Try deterministic fallback before giving up
        if (!wantsChatOnly && (normalizedIsSwapPrompt || normalizedIsDefiPrompt || normalizedIsPerpPrompt || normalizedIsEventPrompt)) {
          const fallback = await applyDeterministicFallback(normalizedUserMessage, normalizedIsSwapPrompt, normalizedIsDefiPrompt, normalizedIsPerpPrompt, normalizedIsEventPrompt, portfolioForPrompt);
          if (fallback) {
            modelResponse = {
              assistantMessage: fallback.assistantMessage,
              actions: fallback.actions,
              executionRequest: fallback.executionRequest,
              modelOk: true,
            };
            assistantMessage = fallback.assistantMessage;
            actions = fallback.actions;
          } else {
            // Last resort: use helpful fallback instead of generic error
            assistantMessage = generateHelpfulFallback(normalizedUserMessage, portfolioForPrompt);
            actions = [];
            modelResponse = {
              assistantMessage,
              actions: [],
              executionRequest: null,
              modelOk: true, // Mark as OK since we're providing helpful guidance
            };
          }
        } else {
          // No specific intent detected - use helpful fallback to guide user
          assistantMessage = generateHelpfulFallback(normalizedUserMessage, portfolioForPrompt);
          actions = [];
          modelResponse = {
            assistantMessage,
            actions: [],
            executionRequest: null,
            modelOk: true, // Mark as OK since we're providing helpful guidance
          };
        }
      }
    }

    if (conversationSessionId) {
      appendMessage(conversationSessionId, {
        role: 'assistant',
        content: assistantMessage || '',
      });
    }

    // Apply validated actions to sims and collect execution results
    const executionResults: ExecutionResult[] = [];
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
      } catch (error: any) {
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
    let serverDraftId: string | undefined = undefined;
    let safeExecutionRequest = executionRequest;
    let safeActions = actions;
    let safeExecutionResults = executionResults;

    // Guardrail: route='chat' must never return executable payloads.
    if (wantsChatOnly) {
      safeExecutionRequest = null;
      safeActions = [];
      safeExecutionResults = [];
    }

    // Task 3: Enforce backend invariants for actionable intents
    // Perp/event/defi intents MUST have executionRequest (swaps may execute immediately)
    const hasActionableIntent = safeActions.length > 0 && safeActions.some(a => 
      a.type === 'perp' || a.type === 'event' || a.type === 'defi'
    );
    
    if (hasActionableIntent && !safeExecutionRequest) {
      // Actionable intent detected but executionRequest missing - return structured error
      if (process.env.DEBUG_RESPONSE === 'true') {
        console.error('[api/chat] MISSING_EXECUTION_REQUEST for actionable intent:', {
          actions: safeActions.map(a => ({ type: a.type })),
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
        errorCode: 'MISSING_EXECUTION_REQUEST' as const,
      });
    }

    // Task A: Create draft strategy server-side for actionable intents (deterministic)
    if (safeExecutionRequest) {
      const { v4: uuidv4 } = await import('uuid');
      const accountValue = portfolioAfter.accountValueUsd || 10000; // Fallback for demo
      
      if (safeExecutionRequest.kind === 'perp') {
        const perpReq = safeExecutionRequest as { kind: 'perp'; chain: string; market: string; side: 'long' | 'short'; leverage: number; riskPct?: number; marginUsd?: number };
        const marginUsd = perpReq.marginUsd || (accountValue * (perpReq.riskPct || 2) / 100);
        const leverage = perpReq.leverage || 2;

        // Warn if user mentioned leverage but LLM didn't extract it
        if (!perpReq.leverage && userMessage.match(/\d+(\.\d+)?x/i)) {
          const mentionedLeverage = userMessage.match(/(\d+(?:\.\d+)?)x/i);
          console.warn(
            `[api/chat] User mentioned ${mentionedLeverage?.[0]} leverage but LLM didn't extract it. ` +
            `Using default ${leverage}x. This is a parsing failure.`
          );
        }

        const notionalUsd = marginUsd * leverage;
        
        serverDraftId = `draft-${uuidv4()}`;
        const draftStrategy = {
          id: serverDraftId,
          type: 'perp' as const,
          status: 'draft' as const,
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
      } else if (safeExecutionRequest.kind === 'event') {
        const eventReq = safeExecutionRequest as { kind: 'event'; chain: string; marketId: string; outcome: 'YES' | 'NO'; stakeUsd: number; price?: number };
        const stakeUsd = eventReq.stakeUsd || 5;
        const riskPct = (stakeUsd / accountValue) * 100;
        
        serverDraftId = `draft-${uuidv4()}`;
        const draftStrategy = {
          id: serverDraftId,
          type: 'event' as const,
          status: 'draft' as const,
          side: eventReq.outcome === 'YES' ? 'YES' : 'NO',
          market: eventReq.marketId || 'FED_CUTS_MAR_2025',
          eventKey: eventReq.marketId || 'FED_CUTS_MAR_2025',
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
      } else if (safeExecutionRequest.kind === 'lend' || safeExecutionRequest.kind === 'lend_supply') {
        const lendReq = safeExecutionRequest as { kind: 'lend' | 'lend_supply'; chain: string; asset: string; amount: string; protocol?: string; vault?: string };
        const amountUsd = parseFloat(lendReq.amount) || 10;
        const riskPct = (amountUsd / accountValue) * 100;
        
        // Clamp APY to realistic demo range (Task A requirement)
        const apyPct = 5.0; // Default to Aave REDACTED 5% for demo
        
        serverDraftId = `draft-${uuidv4()}`;
        const draftStrategy = {
          id: serverDraftId,
          type: 'defi' as const,
          status: 'draft' as const,
          protocol: lendReq.vault || lendReq.protocol || 'Aave REDACTED',
          vault: lendReq.vault || 'Aave REDACTED',
          depositUsd: amountUsd,
          apyPct,
          sourceText: userMessage.substring(0, 200),
          isClosed: false,
          createdAt: new Date().toISOString(),
          riskPct,
          sizeUsd: amountUsd,
          // For compatibility with ConfirmTradeCard (expects perp-like fields)
          market: lendReq.vault || lendReq.protocol || 'Aave REDACTED',
          side: 'long', // DeFi deposits are always "long"
          marginUsd: amountUsd, // Deposit amount = margin for card display
          leverage: 1, // DeFi has no leverage
          notionalUsd: amountUsd, // Exposure = deposit amount
          riskPercent: riskPct, // ConfirmTradeCard expects riskPercent (not riskPct)
          entry: amountUsd,
          takeProfit: amountUsd * (1 + apyPct / 100), // Show APY as take profit
          stopLoss: amountUsd, // Max loss = deposit amount
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
    if (hasActionableIntent && safeExecutionRequest && !serverDraftId) {
      // This should never happen if executionRequest exists, but add safety check
      if (process.env.DEBUG_CARD_CONTRACT === 'true') {
        console.error('[api/chat] WARNING: Actionable intent but no draft created:', {
          executionRequestKind: safeExecutionRequest?.kind,
          actions: safeActions.map(a => ({ type: a.type })),
        });
      }
    }

    const response: ChatResponse & { metadata?: { route: 'chat' | 'planner' } } = {
      assistantMessage,
      actions: safeActions,
      executionRequest: safeExecutionRequest,
      modelOk,
      portfolio: portfolioAfter,
      executionResults: safeExecutionResults, // Include execution results
      errorCode: (!modelOk && !safeExecutionRequest) ? 'LLM_REFUSAL' : undefined, // Only set LLM_REFUSAL if no executionRequest was generated (even after fallback)
      draftId: wantsChatOnly ? undefined : serverDraftId, // Task A: Server-created draft ID for UI to set msg.type + msg.draftId
      metadata: { route: routeDecision },
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
        portfolioStrategiesIds: portfolioAfter.strategies.map((s: any) => ({ id: s.id, status: s.status, type: s.type })),
      });
    }

    // Debug logging for contract verification (Task C)
    if (process.env.DEBUG_RESPONSE === 'true') {
      const redactedResponse = JSON.parse(JSON.stringify(response));
      // Redact secrets (private keys, signatures) but keep structure
      if (redactedResponse.executionRequest) {
        // Remove any sensitive fields from executionRequest if present
        delete (redactedResponse.executionRequest as any).privateKey;
        delete (redactedResponse.executionRequest as any).signature;
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

    // OBSERVABILITY: Plan missing detection (Objective C)
    // Log when executionRequest is missing but user message suggests actionable intent
    const correlationId = req.correlationId || 'unknown';
    if (!executionRequest && actions.length === 0) {
      const suspectedIntent = detectSuspectedIntent(userMessage);
      if (suspectedIntent) {
        logPlanMissing(correlationId, suspectedIntent, userMessage);
        
        // Add debug field in dev only
        if (process.env.NODE_ENV !== 'production') {
          (response as any).debug = {
            planMissingReason: 'no_executionRequest_from_model',
            suspectedIntent,
            correlationId,
          };
        }
      }
    }

    res.json(response);
  } catch (error: any) {
    console.error('Chat error:', error);
    logEvent('chat_response', {
      success: false,
      error: error.message,
      latencyMs: Date.now() - chatStartTime,
    });
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
    let eventResult: { liveMarkToMarketUsd?: number } | undefined;

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
        eventResult = { liveMarkToMarketUsd: result.liveMarkToMarketUsd };
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
    if (type === 'event' && eventResult?.liveMarkToMarketUsd !== undefined) {
      const strategyIndex = portfolio.strategies.findIndex((s: any) => s.id === strategyId);
      if (strategyIndex >= 0) {
        portfolio.strategies[strategyIndex] = {
          ...portfolio.strategies[strategyIndex],
          liveMarkToMarketUsd: eventResult.liveMarkToMarketUsd,
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
  } catch (err: any) {
    console.error('Failed to reset state', err);
    res.status(500).json({ error: 'Failed to reset state' });
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
        lastUpdatedMs: payload.lastUpdatedMs ?? Date.now(),
        isLive: payload.isLive ?? false,
        source: payload.source ?? 'static',
      });
    } else {
      const payload = await getOnchainTicker();
      res.json({
        venue: payload.venue,
        sections: payload.sections,
        lastUpdatedMs: payload.lastUpdatedMs ?? Date.now(),
        isLive: payload.isLive ?? false,
        source: payload.source ?? 'static',
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
        lastUpdatedMs: Date.now(),
        isLive: false,
        source: 'static',
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
app.post('/api/execute/prepare', requireAuth, maybeCheckAccess, async (req, res) => {
  const correlationId = req.correlationId || generateCorrelationId();
  const prepareStartTime = Date.now();
  
  // Extract key info for trace (no secrets)
  const { draftId, executionRequest, userAddress } = req.body || {};
  logExecuteTrace(correlationId, 'prepare:start', {
    kind: executionRequest?.kind,
    draftId: draftId?.substring(0, 8),
    userAddress: userAddress?.substring(0, 10),
  });
  
  try {
    const parsed = ExecutePrepareSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid request body',
        errorCode: 'INVALID_BODY',
        details: parsed.error.flatten(),
        correlationId,
      });
    }
    req.body = parsed.data;

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

    // Debug: log request body
    console.log('[api/execute/prepare] Request body:', JSON.stringify(req.body, null, 2));

    // Accept executionRequest from chat or fallback to executionIntent
    const result = await prepareEthTestnetExecution(req.body);

    // Include demo token addresses for frontend approval flow
    const { DEMO_REDACTED_ADDRESS, DEMO_WETH_ADDRESS, EXECUTION_ROUTER_ADDRESS, ETH_TESTNET_RPC_URL } = await import('../config');

    // Guard: verify all plan adapters are globally allowlisted in the router.
    // This prevents wallet prompts for transactions that would always revert.
    if (result?.plan?.actions?.length && EXECUTION_ROUTER_ADDRESS && ETH_TESTNET_RPC_URL) {
      const { eth_call, decodeBool } = await import('../executors/evmRpc');
      const { encodeFunctionData } = await import('viem');
      const isAdapterAllowedAbi = [
        {
          name: 'isAdapterAllowed',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ name: '', type: 'address' }],
          outputs: [{ name: '', type: 'bool' }],
        },
      ] as const;

      for (const [index, action] of result.plan.actions.entries()) {
        const adapter = action?.adapter;
        if (!adapter || !/^0x[a-fA-F0-9]{40}$/.test(adapter)) {
          return res.status(400).json({
            ok: false,
            error: 'Invalid adapter on prepared plan action',
            errorCode: 'INVALID_ADAPTER',
            details: { index, adapter },
            correlationId,
          });
        }

        try {
          const data = encodeFunctionData({
            abi: isAdapterAllowedAbi,
            functionName: 'isAdapterAllowed',
            args: [adapter as `0x${string}`],
          });
          const callResult = await eth_call(ETH_TESTNET_RPC_URL, EXECUTION_ROUTER_ADDRESS, data);
          const isAllowed = decodeBool(callResult);
          if (!isAllowed) {
            return res.status(400).json({
              ok: false,
              error: 'Prepared plan uses adapter not allowlisted in router',
              errorCode: 'ADAPTER_NOT_ALLOWED',
              details: { index, adapter },
              correlationId,
            });
          }
        } catch (adapterCheckError: any) {
          return res.status(400).json({
            ok: false,
            error: 'Failed to verify adapter allowlist status',
            errorCode: 'ADAPTER_CHECK_FAILED',
            details: { index, adapter, message: adapterCheckError.message },
            correlationId,
          });
        }
      }
    }

    let callData: string | undefined;
    try {
      if ((result as any)?.plan) {
        const { encodeFunctionData } = await import('viem');
        const executeBySenderAbi = [
          {
            name: 'executeBySender',
            type: 'function',
            stateMutability: 'nonpayable',
            inputs: [
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
        ] as const;
        callData = encodeFunctionData({
          abi: executeBySenderAbi,
          functionName: 'executeBySender',
          args: [(result as any).plan],
        });
      }
    } catch (encodeErr: any) {
      console.warn('[api/execute/prepare] Failed to encode callData:', encodeErr?.message);
    }
    
    // Telemetry: log prepare success
    const actionTypes = result.plan?.actions?.map((a: any) => a.actionType) || [];
    logEvent('prepare_success', {
      draftId: req.body.draftId,
      userHash: req.body.userAddress ? hashAddress(req.body.userAddress) : undefined,
      authMode: req.body.authMode,
      actionTypes,
      executionKind: req.body.executionKind,
      latencyMs: Date.now() - prepareStartTime,
      success: true,
    });
    
    // Trace log: prepare success
    logExecuteTrace(correlationId, 'prepare:ok', {
      planSteps: result.plan?.actions?.length || 0,
      actionTypes,
      latencyMs: Date.now() - prepareStartTime,
    });
    
    res.json({
      chainId: result.chainId,
      to: result.to,
      value: result.value,
      plan: result.plan,
      planHash: (result as any).planHash, // V1: Include server-computed planHash
      typedData: result.typedData,
      call: callData || result.call,
      callData,
      requirements: result.requirements,
      summary: result.summary,
      warnings: result.warnings,
      routing: result.routing, // Include routing metadata for demo swaps
      correlationId, // Include correlationId for client tracing
      demoTokens: DEMO_REDACTED_ADDRESS && DEMO_WETH_ADDRESS ? {
        DEMO_REDACTED: DEMO_REDACTED_ADDRESS,
        DEMO_WETH: DEMO_WETH_ADDRESS,
        routerAddress: EXECUTION_ROUTER_ADDRESS,
      } : undefined,
    });
  } catch (error: any) {
    console.error('[api/execute/prepare] Error:', error);
    
    // Trace log: prepare error
    logExecuteTrace(correlationId, 'prepare:error', {
      error: error.message,
      code: error.code || 'UNKNOWN',
      latencyMs: Date.now() - prepareStartTime,
    });
    
    logEvent('prepare_fail', {
      draftId: req.body.draftId,
      error: error.message,
      latencyMs: Date.now() - prepareStartTime,
      success: false,
    });
    res.status(500).json({
      error: 'Failed to prepare execution',
      message: error.message,
      correlationId, // Include correlationId in error response
    });
  }
});

/**
 * POST /api/setup/check-balance
 * Check user's bUSDC balance across supported chains
 */
app.post('/api/setup/check-balance', maybeCheckAccess, async (req, res) => {
  try {
    const { userAddress, solanaAddress } = req.body;

    if (!userAddress) {
      return res.status(400).json({
        error: 'userAddress is required',
      });
    }

    const { DEMO_REDACTED_ADDRESS, ETH_TESTNET_RPC_URL } = await import('../config');

    const balances: { chain: string; balance: string; hasBalance: boolean }[] = [];

    // Check Ethereum Sepolia balance
    if (DEMO_REDACTED_ADDRESS && ETH_TESTNET_RPC_URL) {
      try {
        const { encodeFunctionData, createPublicClient, http, formatUnits } = await import('viem');
        const { sepolia } = await import('viem/chains');

        const publicClient = createPublicClient({
          chain: sepolia,
          transport: http(ETH_TESTNET_RPC_URL),
        });

        const balanceOfAbi = [
          {
            name: 'balanceOf',
            type: 'function',
            stateMutability: 'view',
            inputs: [{ name: 'account', type: 'address' }],
            outputs: [{ name: '', type: 'uint256' }],
          },
        ] as const;

        const data = encodeFunctionData({
          abi: balanceOfAbi,
          functionName: 'balanceOf',
          args: [userAddress as `0x${string}`],
        });

        const result = await publicClient.call({
          to: DEMO_REDACTED_ADDRESS as `0x${string}`,
          data: data as `0x${string}`,
        });

        const balance = result.data ? BigInt(result.data) : 0n;
        const balanceFormatted = formatUnits(balance, 6);

        balances.push({
          chain: 'ethereum',
          balance: balanceFormatted,
          hasBalance: balance > 0n,
        });
      } catch (error) {
        console.warn('[check-balance] Ethereum check failed:', error);
      }
    }

    // Check Solana balance (if solanaAddress provided)
    if (solanaAddress) {
      try {
        const { getSolanaBalance } = await import('../utils/solanaBusdcMinter');
        const solBalance = await getSolanaBalance(solanaAddress);
        balances.push({
          chain: 'solana',
          balance: solBalance.toString(),
          hasBalance: solBalance > 0,
        });
      } catch (error) {
        console.warn('[check-balance] Solana check failed:', error);
      }
    }

    // Check Hyperliquid balance (uses same EVM address)
    // Note: Hyperliquid testnet check would go here if needed

    const hasAnyBalance = balances.some((b) => b.hasBalance);

    res.json({
      ok: true,
      hasBalance: hasAnyBalance,
      balances,
      needsMint: !hasAnyBalance,
    });
  } catch (error: any) {
    console.error('[api/setup/check-balance] Error:', error);
    res.status(500).json({
      error: 'Failed to check balance',
      message: error.message,
      hasBalance: false,
    });
  }
});

/**
 * POST /api/setup/check-approval
 * Check if user has approved ExecutionRouter to spend tokens
 */
app.post('/api/setup/check-approval', maybeCheckAccess, async (req, res) => {
  try {
    const { userAddress } = req.body;

    if (!userAddress) {
      return res.status(400).json({
        error: 'userAddress is required',
      });
    }

    const { EXECUTION_ROUTER_ADDRESS, DEMO_REDACTED_ADDRESS, ETH_TESTNET_RPC_URL } = await import('../config');

    if (!EXECUTION_ROUTER_ADDRESS || !DEMO_REDACTED_ADDRESS || !ETH_TESTNET_RPC_URL) {
      return res.status(503).json({
        error: 'Approval check not available',
        hasApproval: false,
      });
    }

    // Check allowance
    const { encodeFunctionData, createPublicClient, http } = await import('viem');
    const { sepolia } = await import('viem/chains');

    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http(ETH_TESTNET_RPC_URL),
    });

    const allowanceAbi = [
      {
        name: 'allowance',
        type: 'function',
        stateMutability: 'view',
        inputs: [
          { name: 'owner', type: 'address' },
          { name: 'spender', type: 'address' },
        ],
        outputs: [{ name: '', type: 'uint256' }],
      },
    ] as const;

    const data = encodeFunctionData({
      abi: allowanceAbi,
      functionName: 'allowance',
      args: [userAddress as `0x${string}`, EXECUTION_ROUTER_ADDRESS.trim() as `0x${string}`],
    });

    const result = await publicClient.call({
      to: DEMO_REDACTED_ADDRESS as `0x${string}`,
      data: data as `0x${string}`,
    });

    const allowance = result.data ? BigInt(result.data) : 0n;
    const hasApproval = allowance > 0n;

    res.json({
      ok: true,
      hasApproval,
      allowance: allowance.toString(),
      tokenAddress: DEMO_REDACTED_ADDRESS,
      spenderAddress: EXECUTION_ROUTER_ADDRESS.trim(),
    });
  } catch (error: any) {
    console.error('[api/setup/check-approval] Error:', error);
    res.status(500).json({
      error: 'Failed to check approval',
      message: error.message,
      hasApproval: false,
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
    ] as const;

    // Handle MaxUint256 string
    const amountBigInt = amount === 'MaxUint256' 
      ? BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
      : BigInt(amount);

    const data = encodeFunctionData({
      abi: approveAbi,
      functionName: 'approve',
      args: [spenderAddress as `0x${string}`, amountBigInt],
    });

    const { ETH_TESTNET_CHAIN_ID } = await import('../config');

    res.json({
      chainId: ETH_TESTNET_CHAIN_ID,
      to: tokenAddress,
      data,
      value: '0x0',
      summary: `Approve ${spenderAddress.substring(0, 10)}... to spend tokens`,
    });
  } catch (error: any) {
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
app.post('/api/execute/submit', requireAuth, maybeCheckAccess, async (req, res) => {
  const submitStartTime = Date.now();
  try {
    const parsed = ExecuteSubmitSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid request body',
        errorCode: 'INVALID_BODY',
        details: parsed.error.flatten(),
      });
    }
    req.body = parsed.data;

    const { draftId, txHash, userAddress, strategy, executionRequest } = req.body;

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
    let receiptStatus: 'confirmed' | 'failed' | 'timeout' | 'pending' = 'confirmed';
    let blockNumber: number | undefined;
    let receiptError: string | undefined;
    
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
      } else if (receiptStatus === 'failed') {
        logEvent('tx_failed', {
          draftId,
          txHash,
          blockNumber,
          error: receiptError,
          success: false,
        });
      } else if (receiptStatus === 'timeout') {
        logEvent('tx_timeout', {
          draftId,
          txHash,
          error: receiptError,
          success: false,
        });
      }
    }

    // Post execution stats (best-effort)
    try {
      const feeBps = Number(process.env.BUSDC_FEE_BPS || 25);
      const usdEstimate =
        strategy?.notionalUsd ||
        strategy?.usdNotional ||
        executionRequest?.amountUsd ||
        executionRequest?.stakeUsd ||
        null;
      const feeBusdc = usdEstimate ? (Number(usdEstimate) * feeBps) / 10000 : null;

      await postStatsEvent({
        type: 'execution',
        status: receiptStatus,
        chain: EXECUTION_MODE === 'eth_testnet' ? 'ethereum/sepolia' : EXECUTION_MODE,
        venue: strategy?.venue || executionRequest?.venue,
        usdEstimate: usdEstimate ? Number(usdEstimate) : null,
        feeBps,
        feeBusdc,
        txHash,
        userAddress,
      });
    } catch {
      // Swallow stats errors (non-blocking)
    }

    // Update sim state after successful ProofOfExecution
    if (receiptStatus === 'confirmed' && (strategy || executionRequest)) {
      // perpsSim, eventSim, defiSim are already imported at top of file

      // Determine execution type from strategy or executionRequest
      const isPerp = strategy?.instrumentType === 'perp' || strategy?.type === 'perp' || executionRequest?.kind === 'perp';
      const isEvent = strategy?.instrumentType === 'event' || strategy?.type === 'event' || executionRequest?.kind === 'event';
      const isDefi = strategy?.instrumentType === 'defi' || strategy?.type === 'defi' || executionRequest?.kind === 'lend';

      if (isPerp) {
        // Add perp position to sim state
        await perpsSim.openPerp({
          market: strategy?.market || executionRequest?.market || 'BTC-USD',
          side: strategy?.side || strategy?.direction || executionRequest?.side || 'long',
          riskPct: strategy?.riskPercent || strategy?.riskPct || executionRequest?.riskPct || 2,
          entry: strategy?.entry || executionRequest?.entryPrice || 0,
          takeProfit: strategy?.takeProfit || executionRequest?.takeProfitPrice || 0,
          stopLoss: strategy?.stopLoss || executionRequest?.stopLossPrice || 0,
        });
        console.log('[api/execute/submit] Updated perpsSim with new position');
      } else if (isEvent) {
        // Add event position to sim state
        await eventSim.openEventPosition(
          strategy?.market || executionRequest?.marketId || 'unknown-event',
          strategy?.outcome || strategy?.side || executionRequest?.outcome || 'YES',
          strategy?.stakeUsd || executionRequest?.stakeUsd || 10
        );
        console.log('[api/execute/submit] Updated eventSim with new position');
      } else if (isDefi) {
        // Add DeFi position to sim state
        await defiSim.openDefiPosition(
          strategy?.protocol || 'DemoLend',
          strategy?.depositUsd || executionRequest?.amountUsd || 100
        );
        console.log('[api/execute/submit] Updated defiSim with new position');
      }
    }

    const portfolioAfter = buildPortfolioSnapshot();
    
    // Build response based on receipt status
    // Map receipt status to ExecutionResult status (which only supports 'success' | 'failed')
    const mappedStatus: 'success' | 'failed' = receiptStatus === 'confirmed' ? 'success' : 'failed';
    
    const result: ExecutionResult & { receiptStatus?: string; blockNumber?: number } = {
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
  } catch (error: any) {
    console.error('[api/execute/submit] Error:', error);
    logEvent('error', {
      error: error.message,
      notes: ['submit_tx_error'],
    });
    const portfolioAfter = buildPortfolioSnapshot();
    const result: ExecutionResult = {
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

    const {
      ETH_TESTNET_RPC_URL,
      EXECUTION_ROUTER_ADDRESS,
      MOCK_SWAP_ADAPTER_ADDRESS,
      requireEthTestnetConfig,
    } = await import('../config');

    const notes: string[] = [];
    let ok = true;

    // Validate config
    try {
      requireEthTestnetConfig();
    } catch (error: any) {
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
      } catch (error: any) {
        notes.push(`RPC error: ${error.message}`);
      }
    } else {
      notes.push('ETH_TESTNET_RPC_URL not configured');
    }

    // Check router deployment
    let routerOk = false;
    const routerAddressValid = !!EXECUTION_ROUTER_ADDRESS && /^0x[a-fA-F0-9]{40}$/.test(EXECUTION_ROUTER_ADDRESS);
    if (!routerAddressValid && EXECUTION_ROUTER_ADDRESS) {
      notes.push(`Router address invalid format: ${EXECUTION_ROUTER_ADDRESS}`);
    }
    if (routerAddressValid && ETH_TESTNET_RPC_URL && rpcOk) {
      try {
        const { eth_getCode } = await import('../executors/evmRpc');
        const code = await eth_getCode(ETH_TESTNET_RPC_URL, EXECUTION_ROUTER_ADDRESS);
        routerOk = code !== '0x' && code.length > 2;
        if (!routerOk) {
          notes.push('Router contract not deployed at EXECUTION_ROUTER_ADDRESS');
        }
      } catch (error: any) {
        notes.push(`Router check error: ${error.message}`);
      }
    } else {
      notes.push('Cannot check router: missing/invalid EXECUTION_ROUTER_ADDRESS or RPC');
    }

    // Check adapter allowlist (if router is deployed)
    let adapterOk = false;
    const mockAdapterValid = !!MOCK_SWAP_ADAPTER_ADDRESS && /^0x[a-fA-F0-9]{40}$/.test(MOCK_SWAP_ADAPTER_ADDRESS);
    if (routerOk && mockAdapterValid && ETH_TESTNET_RPC_URL) {
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
          args: [MOCK_SWAP_ADAPTER_ADDRESS as `0x${string}`],
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
      } catch (error: any) {
        notes.push(`Adapter check error: ${error.message}`);
        console.error('[preflight] Adapter check failed:', error);
      }
    } else if (routerOk && MOCK_SWAP_ADAPTER_ADDRESS && !mockAdapterValid) {
      notes.push(`Adapter address invalid format: ${MOCK_SWAP_ADAPTER_ADDRESS}`);
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
        
        const jsonResult: unknown = await response.json();
        const result = jsonResult as { result?: string; error?: { message?: string } };
        
        if (result.error) {
          throw new Error(`RPC error: ${result.error.message || 'Unknown error'}`);
        }
        
        // If we get a result (even "0x0"), nonce fetching works
        nonceOk = result.result !== undefined;
      } catch (error: any) {
        notes.push(`Nonce check error: ${error.message}`);
        console.error('[preflight] Nonce check failed:', error);
      }
    }

    if (!rpcOk || !routerOk || !adapterOk || !nonceOk) {
      ok = false;
    }

    // Check routing configuration
    const {
      ROUTING_MODE,
      ONEINCH_API_KEY,
      EXECUTION_SWAP_MODE,
    } = await import('../config');

    // Check 1inch connectivity
    let oneinchOk = false;
    if (ONEINCH_API_KEY) {
      try {
        // Quick health check: try to get a quote for a small swap
        const testResponse = await fetch(
          `https://api.1inch.dev/swap/v6.0/11155111/quote?src=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48&dst=0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2&amount=1000000`,
          {
            headers: {
              'Authorization': `Bearer ${ONEINCH_API_KEY}`,
              'Accept': 'application/json',
            },
            signal: AbortSignal.timeout(3000), // 3s timeout
          }
        );
        oneinchOk = testResponse.ok;
      } catch (error: any) {
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
      } else {
        notes.push('Live routing: enabled (1inch - API key present but connectivity check failed)');
      }
    } else if (ROUTING_MODE === 'dflow') {
      notes.push('Live routing: enabled (dFlow)');
    } else {
      notes.push('Live routing: disabled (deterministic fallback)');
    }

    if (EXECUTION_SWAP_MODE === 'demo') {
      notes.push('Swap execution: deterministic demo venue');
    }

    // Check lending configuration
    const {
      DEMO_LEND_VAULT_ADDRESS,
      DEMO_LEND_ADAPTER_ADDRESS,
      LENDING_EXECUTION_MODE,
      LENDING_RATE_SOURCE,
      AAVE_SEPOLIA_POOL_ADDRESS,
      AAVE_ADAPTER_ADDRESS,
    } = await import('../config');

    // Check DefiLlama connectivity
    let defillamaOk = false;
    if (LENDING_RATE_SOURCE === 'defillama') {
      try {
        const testResponse = await fetch('https://yields.llama.fi/pools', {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(3000), // 3s timeout
        });
        defillamaOk = testResponse.ok;
      } catch (error: any) {
        // Timeout or network error - not critical
        defillamaOk = false;
      }
    }

    // Check for real Aave config (variables already imported above at line 2223-2224)
    const hasAaveConfig = !!AAVE_SEPOLIA_POOL_ADDRESS && !!AAVE_ADAPTER_ADDRESS;
    const isRealAave = LENDING_EXECUTION_MODE === 'real' && hasAaveConfig;
    
    const lendingStatus = {
      enabled: isRealAave || (!!DEMO_LEND_VAULT_ADDRESS && !!DEMO_LEND_ADAPTER_ADDRESS),
      mode: LENDING_EXECUTION_MODE || 'demo',
      vault: isRealAave ? AAVE_SEPOLIA_POOL_ADDRESS : (DEMO_LEND_VAULT_ADDRESS || null),
      adapter: isRealAave ? AAVE_ADAPTER_ADDRESS : (DEMO_LEND_ADAPTER_ADDRESS || null),
      rateSource: LENDING_RATE_SOURCE || 'demo',
      defillamaOk,
    };

    if (lendingStatus.enabled) {
      if (isRealAave) {
        notes.push(`Lending: enabled (${lendingStatus.mode}, Aave V3 Sepolia)`);
      } else if (LENDING_RATE_SOURCE === 'defillama' && defillamaOk) {
        notes.push(`Lending: enabled (${lendingStatus.mode}, DefiLlama - connected)`);
      } else if (LENDING_RATE_SOURCE === 'defillama') {
        notes.push(`Lending: enabled (${lendingStatus.mode}, DefiLlama - connectivity check failed)`);
      } else {
        notes.push(`Lending: enabled (${lendingStatus.mode})`);
      }
    } else {
      if (LENDING_EXECUTION_MODE === 'real' && !hasAaveConfig) {
        notes.push('Lending: disabled (real mode requested but AAVE_SEPOLIA_POOL_ADDRESS or AAVE_ADAPTER_ADDRESS not configured)');
      } else {
        notes.push('Lending: disabled (vault or adapter not configured)');
      }
    }

    // Check dFlow configuration
    const {
      DFLOW_ENABLED,
      DFLOW_API_KEY,
      DFLOW_BASE_URL,
      DFLOW_EVENTS_MARKETS_PATH,
      DFLOW_EVENTS_QUOTE_PATH,
      DFLOW_SWAPS_QUOTE_PATH,
      DFLOW_REQUIRE,
    } = await import('../config');

    const dflowStatus = {
      enabled: DFLOW_ENABLED,
      ok: DFLOW_ENABLED && !!DFLOW_API_KEY,
      required: DFLOW_REQUIRE,
      capabilities: {
        eventsMarkets: DFLOW_ENABLED && !!DFLOW_EVENTS_MARKETS_PATH,
        eventsQuotes: DFLOW_ENABLED && !!DFLOW_EVENTS_QUOTE_PATH,
        swapsQuotes: DFLOW_ENABLED && !!DFLOW_SWAPS_QUOTE_PATH,
      },
    };

    if (DFLOW_ENABLED && dflowStatus.ok) {
      const caps = [];
      if (dflowStatus.capabilities.eventsMarkets) caps.push('events-markets');
      if (dflowStatus.capabilities.eventsQuotes) caps.push('events-quotes');
      if (dflowStatus.capabilities.swapsQuotes) caps.push('swaps-quotes');
      notes.push(`dFlow: enabled (${caps.join(', ') || 'no capabilities'})`);
    } else {
      if (DFLOW_ENABLED && !DFLOW_API_KEY) {
        notes.push('dFlow: enabled but missing API key');
      } else {
        notes.push('dFlow: disabled (optional for MVP)');
      }
    }
    if (DFLOW_REQUIRE && !dflowStatus.ok) {
      notes.push('dFlow: required but not configured (MVP uses deterministic routing)');
    }
    // Do NOT set ok = false for dFlow; Sepolia execution must not be blocked by missing dFlow

    // Build allowed adapters list for capabilities
    // Note: AAVE_ADAPTER_ADDRESS already imported above at line 2224
    const {
      PROOF_ADAPTER_ADDRESS,
      ERC20_PULL_ADAPTER_ADDRESS,
      UNISWAP_V3_ADAPTER_ADDRESS,
      WETH_WRAP_ADAPTER_ADDRESS,
    } = await import('../config');

    // Check perps configuration
    const { DEMO_PERP_ADAPTER_ADDRESS, DEMO_PERP_ENGINE_ADDRESS, DEMO_EVENT_ADAPTER_ADDRESS, DEMO_EVENT_ENGINE_ADDRESS } = await import('../config');
    const perpsEnabled = !!DEMO_PERP_ADAPTER_ADDRESS && routerOk;
    const eventsRealEnabled = !!DEMO_EVENT_ADAPTER_ADDRESS && routerOk;

    // Collect all configured adapters to verify on-chain
    const configuredAdapters: string[] = [];
    if (UNISWAP_V3_ADAPTER_ADDRESS) configuredAdapters.push(UNISWAP_V3_ADAPTER_ADDRESS.toLowerCase());
    if (WETH_WRAP_ADAPTER_ADDRESS) configuredAdapters.push(WETH_WRAP_ADAPTER_ADDRESS.toLowerCase());
    if (MOCK_SWAP_ADAPTER_ADDRESS) configuredAdapters.push(MOCK_SWAP_ADAPTER_ADDRESS.toLowerCase());
    if (PROOF_ADAPTER_ADDRESS) configuredAdapters.push(PROOF_ADAPTER_ADDRESS.toLowerCase());
    if (ERC20_PULL_ADAPTER_ADDRESS) configuredAdapters.push(ERC20_PULL_ADAPTER_ADDRESS.toLowerCase());
    if (DEMO_LEND_ADAPTER_ADDRESS) configuredAdapters.push(DEMO_LEND_ADAPTER_ADDRESS.toLowerCase());
    if (AAVE_ADAPTER_ADDRESS) configuredAdapters.push(AAVE_ADAPTER_ADDRESS.toLowerCase());
    if (DEMO_PERP_ADAPTER_ADDRESS) configuredAdapters.push(DEMO_PERP_ADAPTER_ADDRESS.toLowerCase());
    if (DEMO_EVENT_ADAPTER_ADDRESS) configuredAdapters.push(DEMO_EVENT_ADAPTER_ADDRESS.toLowerCase());

    // Verify each adapter is on-chain allowlisted in the router
    // This prevents the "Prepared plan uses adapter not allowlisted in router" error
    const allowedAdapters: string[] = [];
    const notAllowlistedAdapters: string[] = [];

    if (routerOk && ETH_TESTNET_RPC_URL && EXECUTION_ROUTER_ADDRESS) {
      const { eth_call, decodeBool } = await import('../executors/evmRpc');
      const { encodeFunctionData } = await import('viem');
      const isAdapterAllowedAbi = [
        {
          name: 'isAdapterAllowed',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ name: '', type: 'address' }],
          outputs: [{ name: '', type: 'bool' }],
        },
      ] as const;

      for (const adapter of configuredAdapters) {
        try {
          const data = encodeFunctionData({
            abi: isAdapterAllowedAbi,
            functionName: 'isAdapterAllowed',
            args: [adapter as `0x${string}`],
          });
          const result = await eth_call(ETH_TESTNET_RPC_URL, EXECUTION_ROUTER_ADDRESS, data);
          const isAllowed = decodeBool(result);
          if (isAllowed) {
            allowedAdapters.push(adapter);
          } else {
            notAllowlistedAdapters.push(adapter);
          }
        } catch (error: any) {
          console.warn(`[preflight] Failed to check adapter ${adapter}:`, error.message);
          // Don't add adapter if we can't verify
          notAllowlistedAdapters.push(adapter);
        }
      }

      // Log adapters not allowlisted for debugging
      if (notAllowlistedAdapters.length > 0) {
        console.warn('[preflight] Adapters configured but NOT on-chain allowlisted:', notAllowlistedAdapters);
        notes.push(`${notAllowlistedAdapters.length} adapter(s) configured but not on-chain allowlisted`);
      }
    } else {
      // If we can't verify on-chain, include all configured adapters (fallback)
      allowedAdapters.push(...configuredAdapters);
      notes.push('Could not verify adapter allowlist on-chain (router/RPC unavailable)');
    }

    // Venue availability flags for frontend execution routing
    const swapEnabled = adapterOk && routerOk && rpcOk;
    const lendingEnabled = lendingStatus.enabled && routerOk;
    const eventsEnabled = eventsRealEnabled || true; // Events always available (real or proof-only mode)

    // MVP: Collect missing env vars for debugging production parity issues
    const missingEnvVars: string[] = [];
    if (!EXECUTION_ROUTER_ADDRESS) missingEnvVars.push('EXECUTION_ROUTER_ADDRESS');
    if (!MOCK_SWAP_ADAPTER_ADDRESS) missingEnvVars.push('MOCK_SWAP_ADAPTER_ADDRESS');
    if (!ETH_TESTNET_RPC_URL) missingEnvVars.push('ETH_TESTNET_RPC_URL');
    if (!DEMO_PERP_ADAPTER_ADDRESS) missingEnvVars.push('DEMO_PERP_ADAPTER_ADDRESS');
    if (!DEMO_PERP_ENGINE_ADDRESS) missingEnvVars.push('DEMO_PERP_ENGINE_ADDRESS');
    // dFlow is optional for MVP; do not add to missingEnvVars

    // Swap token configuration check (can use real OR demo addresses)
    const { REDACTED_ADDRESS_SEPOLIA, WETH_ADDRESS_SEPOLIA, DEMO_REDACTED_ADDRESS, DEMO_WETH_ADDRESS } = await import('../config');
    const swapTokenConfigOk = !!(
      (REDACTED_ADDRESS_SEPOLIA && WETH_ADDRESS_SEPOLIA) ||
      (DEMO_REDACTED_ADDRESS && DEMO_WETH_ADDRESS)
    );
    const swapTokenAddresses = {
      usdc: REDACTED_ADDRESS_SEPOLIA || DEMO_REDACTED_ADDRESS || null,
      weth: WETH_ADDRESS_SEPOLIA || DEMO_WETH_ADDRESS || null,
      source: REDACTED_ADDRESS_SEPOLIA ? 'real' : DEMO_REDACTED_ADDRESS ? 'demo' : 'none',
    };

    res.json({
      mode: 'eth_testnet',
      ok,
      chainId: 11155111,
      executionRouterAddress: EXECUTION_ROUTER_ADDRESS || null,
      allowedAdapters,
      router: EXECUTION_ROUTER_ADDRESS || null, // Legacy field
      adapter: MOCK_SWAP_ADAPTER_ADDRESS || null, // Legacy field
      adapterOk, // For legacy compatibility
      rpc: rpcOk,
      routing: routingStatus,
      lending: lendingStatus,
      dflow: dflowStatus,
      // Venue availability flags for frontend execution routing
      swapEnabled,
      swapTokenConfigOk,
      swapTokenAddresses,
      perpsEnabled,
      lendingEnabled,
      eventsEnabled,
      // MVP: Include missing env vars for production debugging
      missingEnvVars: missingEnvVars.length > 0 ? missingEnvVars : undefined,
      notes,
    });
  } catch (error: any) {
    console.error('[api/execute/preflight] Error:', error);
    res.status(500).json({
      error: 'Failed to run preflight check',
      message: error.message,
    });
  }
});

// Rate limiting for session endpoints (in-memory, per endpoint)
const sessionEndpointCooldowns = new Map<string, number>();
const SESSION_COOLDOWN_MS = 1500;

function checkSessionCooldown(endpoint: string): boolean {
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
  const correlationId = req.correlationId || generateCorrelationId();
  
  // Safe logging: body keys (no secrets)
  const bodyKeys = req.body ? Object.keys(req.body) : [];
  logSessionTrace(correlationId, 'prepare:start', { 
    hasBody: !!req.body,
    bodyKeys,
  });
  
  try {
    const { EXECUTION_MODE, EXECUTION_AUTH_MODE } = await import('../config');
    
    // Accept both body and query params, support both userAddress and address (backward compat)
    const userAddress = req.body?.userAddress || req.body?.address || req.query?.userAddress || req.query?.address;

    // Check cooldown (only log once per cooldown window)
    const cooldownKey = `prepare-${userAddress || 'empty'}`;
    const inCooldown = !checkSessionCooldown(cooldownKey);
    if (inCooldown && process.env.DEBUG_SESSION !== 'true') {
      // Skip logging if in cooldown and not debug mode
    } else if (process.env.DEBUG_SESSION === 'true') {
      console.log('[api/session/prepare] Request:', { userAddress, EXECUTION_MODE, EXECUTION_AUTH_MODE });
    }

    // If not in session mode, return enabled:false (200 OK but disabled)
    if (EXECUTION_MODE !== 'eth_testnet' || EXECUTION_AUTH_MODE !== 'session') {
      return res.json({
        ok: true,
        status: 'disabled', // Top-level status field for UI
        session: {
          enabled: false,
          reason: 'NOT_CONFIGURED',
          required: ['EXECUTION_MODE=eth_testnet', 'EXECUTION_AUTH_MODE=session'],
        },
        correlationId,
        cooldownMs: SESSION_COOLDOWN_MS,
      });
    }

    // VALIDATION: userAddress is required - return 400 if missing
    if (!userAddress || typeof userAddress !== 'string') {
      logSessionTrace(correlationId, 'prepare:error', { 
        error: 'Missing userAddress',
        code: 'MISSING_USER_ADDRESS',
      });
      return res.status(400).json({
        ok: false,
        correlationId,
        error: {
          code: 'MISSING_USER_ADDRESS',
          message: 'userAddress (or address) is required in request body',
        },
      });
    }

    // Safe log: derived address (truncated)
    logSessionTrace(correlationId, 'prepare:validated', {
      userAddress: userAddress.substring(0, 10) + '...',
    });

    // Telemetry: log session prepare
    logEvent('session_prepare', {
      userHash: hashAddress(userAddress),
      authMode: 'session',
    });

    const {
      EXECUTION_ROUTER_ADDRESS,
      MOCK_SWAP_ADAPTER_ADDRESS,
      UNISWAP_V3_ADAPTER_ADDRESS,
      WETH_WRAP_ADAPTER_ADDRESS,
      ERC20_PULL_ADAPTER_ADDRESS,
      PROOF_ADAPTER_ADDRESS,
      DEMO_LEND_ADAPTER_ADDRESS,
      AAVE_ADAPTER_ADDRESS,
      DEMO_PERP_ADAPTER_ADDRESS,
      DEMO_EVENT_ADAPTER_ADDRESS,
      RELAYER_PRIVATE_KEY,
      ETH_TESTNET_RPC_URL,
      requireRelayerConfig,
    } = await import('../config');

    // Preflight: fail with structured 400 when session signing prerequisites are missing.
    // This avoids opaque 500s (FUNCTION_INVOCATION_FAILED) and makes stress runner bucketing deterministic.
    const missingPrereqs: string[] = [];
    if (!RELAYER_PRIVATE_KEY) missingPrereqs.push('RELAYER_PRIVATE_KEY');
    if (!ETH_TESTNET_RPC_URL) missingPrereqs.push('ETH_TESTNET_RPC_URL');
    if (!EXECUTION_ROUTER_ADDRESS) missingPrereqs.push('EXECUTION_ROUTER_ADDRESS');
    if (missingPrereqs.length > 0) {
      logSessionTrace(correlationId, 'prepare:error', {
        error: 'Missing session prepare prerequisites',
        code: 'SESSION_PREPARE_MISSING_PREREQ',
        missingPrereqs,
      });
      return res.status(400).json({
        ok: false,
        correlationId,
        error: {
          code: 'SESSION_PREPARE_MISSING_PREREQ',
          message: `Missing prerequisites: ${missingPrereqs.join(', ')}`,
          missingPrereqs,
        },
      });
    }

    requireRelayerConfig();

    // DEV-ONLY: Log router + chain diagnostics
    if (process.env.NODE_ENV !== 'production') {
      try {
        const { createPublicClient, http } = await import('viem');
        const publicClient = createPublicClient({
          chain: settlementConfig.chain,
          transport: http(ETH_TESTNET_RPC_URL),
        });
        
        const chainId = await publicClient.getChainId();
        const routerCode = await publicClient.getBytecode({ address: EXECUTION_ROUTER_ADDRESS as `0x${string}` });
        const routerIsContract = routerCode && routerCode !== '0x' && routerCode.length > 2;
        
        logSessionTrace(correlationId, 'prepare:diagnostics', {
          chainId,
          routerAddress: EXECUTION_ROUTER_ADDRESS,
          routerIsContract,
          routerCodeLength: routerCode?.length || 0,
        });
      } catch (diagError: any) {
        logSessionTrace(correlationId, 'prepare:diagnostics:error', {
          error: diagError.message,
        });
      }
    }

    // Generate session ID with cryptographic entropy (SECURITY FIX)
    // Previous: userAddress + timestamp (predictable)
    // Now: userAddress + timestamp + crypto random bytes (unpredictable)
    const { keccak256, toBytes, parseUnits } = await import('viem');
    const { randomBytes } = await import('crypto');
    const entropy = randomBytes(32).toString('hex');
    const sessionId = keccak256(
      toBytes(userAddress + Date.now().toString() + entropy)
    );

    // DEBUG: Log generated sessionId
    console.log('[session/prepare] Generated sessionId:', sessionId);
    console.log('[session/prepare] For userAddress:', userAddress);

    // Derive relayer address from private key
    const { privateKeyToAccount } = await import('viem/accounts');
    const relayerAccount = privateKeyToAccount(RELAYER_PRIVATE_KEY as `0x${string}`);
    const executor = relayerAccount.address;

    // Set session parameters
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60); // 7 days
    // Session spend cap uses token units (bUSDC 6 decimals)
    // Generous limit: 1M bUSDC allows users to open any reasonable position size
    const maxSpendBusdc = process.env.SESSION_MAX_SPEND_BUSDC || '1000000';
    const maxSpend = BigInt(parseUnits(maxSpendBusdc, 6));

    // Build allowed adapters list (include all configured adapters that are globally allowlisted in router)
    const configuredAdapters = [
      MOCK_SWAP_ADAPTER_ADDRESS,
      UNISWAP_V3_ADAPTER_ADDRESS,
      WETH_WRAP_ADAPTER_ADDRESS,
      ERC20_PULL_ADAPTER_ADDRESS,
      PROOF_ADAPTER_ADDRESS,
      DEMO_LEND_ADAPTER_ADDRESS,
      AAVE_ADAPTER_ADDRESS,
      DEMO_PERP_ADAPTER_ADDRESS,
      DEMO_EVENT_ADAPTER_ADDRESS,
    ]
      .filter((addr): addr is string => !!addr && /^0x[a-fA-F0-9]{40}$/.test(addr))
      .map((addr) => addr.toLowerCase() as `0x${string}`);

    const dedupedConfiguredAdapters = Array.from(new Set(configuredAdapters));

    const isAdapterAllowedAbi = [
      {
        name: 'isAdapterAllowed',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: '', type: 'address' }],
        outputs: [{ name: '', type: 'bool' }],
      },
    ] as const;

    const allowedAdapters: `0x${string}`[] = [];
    const skippedAdapters: string[] = [];

    if (EXECUTION_ROUTER_ADDRESS && ETH_TESTNET_RPC_URL) {
      const { eth_call, decodeBool } = await import('../executors/evmRpc');
      const { encodeFunctionData } = await import('viem');
      for (const adapter of dedupedConfiguredAdapters) {
        try {
          const data = encodeFunctionData({
            abi: isAdapterAllowedAbi,
            functionName: 'isAdapterAllowed',
            args: [adapter],
          });
          const result = await eth_call(ETH_TESTNET_RPC_URL, EXECUTION_ROUTER_ADDRESS, data);
          const isAllowed = decodeBool(result);
          if (isAllowed) {
            allowedAdapters.push(adapter);
          } else {
            skippedAdapters.push(adapter);
          }
        } catch (adapterCheckError: any) {
          skippedAdapters.push(`${adapter} (check_error: ${adapterCheckError.message})`);
        }
      }
    } else {
      // If we cannot verify on-chain allowlist, keep existing configured adapters (best effort).
      allowedAdapters.push(...dedupedConfiguredAdapters);
    }

    if (allowedAdapters.length === 0) {
      return res.status(400).json({
        error: 'No globally allowlisted adapters are configured for session creation.',
        notes: skippedAdapters,
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
    ] as const;

    const data = encodeFunctionData({
      abi: createSessionAbi,
      functionName: 'createSession',
      args: [
        sessionId as `0x${string}`,
        executor as `0x${string}`,
        BigInt(expiresAt),
        maxSpend,
        allowedAdapters,
      ],
    });

    // DEBUG: Verify sessionId is encoded correctly in data
    // createSession selector (4 bytes) + sessionId (32 bytes) starts at position 10 (after 0x + 8 hex chars)
    const encodedSessionId = '0x' + data.slice(10, 74);
    console.log('[session/prepare] Encoded data sessionId:', encodedSessionId);
    console.log('[session/prepare] SessionIds match:', sessionId.toLowerCase() === encodedSessionId.toLowerCase());

    // V1: Return capability snapshot (caps, allowlists, approvals, expiresAt)
    const capabilitySnapshot = {
      sessionId,
      caps: {
        maxSpend: maxSpend.toString(),
        maxSpendUsd: maxSpendBusdc, // bUSDC is USD-pegged in demo
        expiresAt: expiresAt.toString(),
        expiresAtIso: new Date(Number(expiresAt) * 1000).toISOString(),
      },
      allowlistedAdapters: allowedAdapters,
      approvals: [], // V1: Router approval handled during session creation
      expiresAt: Number(expiresAt),
    };

    // VALIDATION: Ensure transaction fields are present
    const txTo = EXECUTION_ROUTER_ADDRESS;
    const txData = data;
    const txFieldsPresent = {
      to: !!txTo,
      data: !!txData,
      sessionId: !!sessionId,
    };

    // Safe log: transaction field validation
    logSessionTrace(correlationId, 'prepare:txBuilt', {
      txFieldsPresent,
      toLength: txTo?.length || 0,
      dataLength: txData?.length || 0,
    });

    // Return 500 if critical fields are missing (configuration error)
    if (!txTo || !txData || !sessionId) {
      const missingFields = [];
      if (!txTo) missingFields.push('to (EXECUTION_ROUTER_ADDRESS)');
      if (!txData) missingFields.push('data (encoded function call)');
      if (!sessionId) missingFields.push('sessionId');
      
      logSessionTrace(correlationId, 'prepare:error', {
        error: 'Missing transaction fields',
        code: 'MISSING_TX_FIELDS',
        missingFields,
      });
      
      return res.status(500).json({
        ok: false,
        correlationId,
        error: {
          code: 'MISSING_TX_FIELDS',
          message: `Failed to build transaction: missing ${missingFields.join(', ')}`,
          missingFields,
        },
      });
    }

    // Return enabled:true with exact shape expected by frontend
    const prepareResponse = {
      ok: true,
      status: 'preparing', // Top-level status field for UI
      session: {
        enabled: true,
        sessionId,
        to: txTo,
        data: txData,
        value: '0x0',
        summary: `Create session for ${userAddress.substring(0, 10)}... with executor ${executor.substring(0, 10)}...`,
        capabilitySnapshot, // V1: Include capability snapshot
        skippedAdapters,
      },
      correlationId, // Include correlationId for client tracing
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

    // Trace log: prepare success (no secrets)
    logSessionTrace(correlationId, 'prepare:ok', { 
      sessionId: sessionId.substring(0, 10) + '...', 
      userAddress: userAddress.substring(0, 10) + '...',
      expiresAt: expiresAt.toString(), // Convert BigInt to string for JSON
      txFieldsPresent,
    });

    res.json(prepareResponse);
  } catch (error: any) {
    // Trace log: prepare error with full details (dev only for stack)
    const errorInfo: Record<string, any> = {
      error: error.message,
      code: error.code || 'UNKNOWN',
      name: error.name,
    };
    
    if (process.env.NODE_ENV !== 'production') {
      errorInfo.stack = error.stack;
      errorInfo.cause = error.cause;
    }
    
    logSessionTrace(correlationId, 'prepare:error', errorInfo);
    
    // Log full error in dev mode
    if (process.env.DEBUG_SESSION === 'true' || process.env.NODE_ENV !== 'production') {
      console.error(`[${correlationId}] [api/session/prepare] Error:`, error);
    }
    
    // Return 500 for unexpected errors (not 200)
    res.status(500).json({
      ok: false,
      correlationId,
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.message || 'Failed to prepare session',
        ...(process.env.NODE_ENV !== 'production' ? { stack: error.stack } : {}),
      },
    });
  }
});

/**
 * POST /api/execute/relayed
 * Execute a plan using session permissions (relayed by backend)
 */
app.post('/api/execute/relayed', requireAuth, maybeCheckAccess, async (req, res) => {
  console.log('[api/execute/relayed] Handler invoked - DEBUG MARKER V2');
  const correlationId = req.correlationId || generateCorrelationId();
  const relayedStartTime = Date.now();
  
  // Trace log: relayed start (no secrets)
  const { sessionId, plan, userAddress } = req.body || {};
  logExecuteTrace(correlationId, 'relayed:start', {
    sessionId: sessionId?.substring(0, 10),
    userAddress: userAddress?.substring(0, 10),
    planActions: plan?.actions?.length,
  });
  
  try {
    const parsed = ExecuteRelayedSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid request body',
        errorCode: 'INVALID_BODY',
        details: parsed.error.flatten(),
        correlationId,
      });
    }
    req.body = parsed.data;

    const { EXECUTION_MODE, EXECUTION_AUTH_MODE, EXECUTION_DISABLED, V1_DEMO } = await import('../config');
    
    // V1: Emergency kill switch
    if (EXECUTION_DISABLED) {
      return res.status(503).json({
        error: 'Execution temporarily disabled',
        errorCode: 'EXECUTION_DISABLED',
        message: 'Execution has been temporarily disabled. Please try again later.',
      });
    }
    
    // V1_DEMO: Enforce small action counts (allow PULL + SWAP/LEND as 2-step flows)
    if (V1_DEMO && req.body.plan && req.body.plan.actions && req.body.plan.actions.length > 2) {
      return res.status(400).json({
        error: 'V1_DEMO mode only allows 1-2 action plans',
        errorCode: 'V1_DEMO_MULTI_ACTION_REJECTED',
        message: `Plan has ${req.body.plan.actions.length} actions. V1_DEMO allows up to 2 actions (e.g. PULL + SWAP/LEND).`,
      });
    }

    const requestedMode = String(req.body?.metadata?.mode || '').toLowerCase();
    const requestedSettlementChain = String(
      req.body?.metadata?.toChain ||
      req.body?.toChain ||
      process.env.DEFAULT_SETTLEMENT_CHAIN ||
      'base_sepolia'
    );
    const requestedSettlementChainNormalized = normalizeSettlementChain(requestedSettlementChain);
    const baseRequiredMode =
      requestedSettlementChainNormalized === 'base_sepolia' &&
      (
        requestedMode === 'tier1_crosschain_required_base' ||
        req.body?.metadata?.requireBaseSettlement === true ||
        req.body?.metadata?.strictSettlementChain === true
      );
    const settlementChain = resolveExecutionSettlementChain(requestedSettlementChain, {
      allowFallback: !baseRequiredMode,
    });
    if (baseRequiredMode && (!isSettlementChainExecutionReady('base_sepolia') || settlementChain !== 'base_sepolia')) {
      return res.status(422).json({
        ok: false,
        success: false,
        error: 'Base settlement lane is not configured for execution.',
        errorCode: 'BASE_LANE_NOT_CONFIGURED',
        notes: ['Set BUSDC/ExecutionRouter/Perp adapter Base Sepolia addresses before running base-required mode.'],
      });
    }

    // Check if session is actually enabled (server-side check)
    let sessionEnabled = false;
    if (EXECUTION_MODE === 'eth_testnet' && EXECUTION_AUTH_MODE === 'session') {
      try {
        // Quick check: verify relayer and router are configured
        const { RELAYER_PRIVATE_KEY } = await import('../config');
        const requestedChain = resolveExecutionSettlementChain(requestedSettlementChain, {
          allowFallback: !baseRequiredMode,
        });
        const chainRuntime = getSettlementChainRuntimeConfig(requestedChain);
        const routerAddress = chainRuntime.executionRouterAddress;
        const rpcUrl = chainRuntime.rpcUrl;
        if ((chainRuntime.relayerPrivateKey || RELAYER_PRIVATE_KEY) && routerAddress && rpcUrl) {
          // Optionally verify router has code (quick check with timeout)
          try {
            const codeResponse = await Promise.race([
              fetch(rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  jsonrpc: '2.0',
                  id: 1,
                  method: 'eth_getCode',
                  params: [routerAddress, 'latest'],
                }),
              }),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000)),
            ]) as Response;
            
            if (codeResponse.ok) {
              const codeData = await codeResponse.json();
              const code = codeData.result || '0x';
              sessionEnabled = code !== '0x' && code.length > 2;
            }
          } catch (error: any) {
            // RPC check failed - treat as disabled
            sessionEnabled = false;
          }
        }
      } catch (error: any) {
        // Config check failed - treat as disabled
        sessionEnabled = false;
      }
    }

    // If session is disabled, return clear error (not silent success)
    if (!sessionEnabled) {
      if (process.env.DEBUG_DIAGNOSTICS === 'true') {
        console.log('[DEBUG_DIAGNOSTICS] session unauthorized: session execution not configured (router/relayer/RPC check)');
      }
      return res.status(503).json({
        ok: false,
        success: false,
        error: 'Session execution not available. Please use manual signing or check backend configuration.',
        errorCode: 'SESSION_NOT_CONFIGURED',
        notes: ['Session mode requires EXECUTION_MODE=eth_testnet, EXECUTION_AUTH_MODE=session, and valid router contract'],
      });
    }

    const { draftId, userAddress, plan, sessionId } = req.body;
    const settlementConfig = getSettlementChainRuntimeConfig(settlementChain);
    const settlementRouterAddress = settlementConfig.executionRouterAddress;
    const settlementRpcUrl = settlementConfig.rpcUrl;
    let executionRouteMeta: any = {
      didRoute: false,
      fromChain: settlementChain,
      toChain: settlementChain,
      reason: `Execution funded directly on ${settlementConfig.label}.`,
    };
    let executionFundingMode: 'relayed' | 'relayed_after_topup' | 'user_paid_required' | 'blocked_needs_gas' = 'relayed';
    let executionFundingMeta: any = {
      mode: 'relayed',
      reasonCode: 'RELAYER_OK',
      relayerBalanceEth: 0,
      minEth: 0,
      didTopup: false,
      minUserGasEth: parseFloat(process.env.MIN_USER_GAS_ETH || '0.003'),
    };
    const {
      buildRelayedQueueKey,
      getRelayedExecutionQueueResponse,
    } = await import('../services/relayedExecutionQueue');

    const queueKey = buildRelayedQueueKey({
      draftId,
      userAddress,
      sessionId,
      nonce: plan?.nonce,
    });
    const existingQueueResponse = getRelayedExecutionQueueResponse(queueKey);
    if (existingQueueResponse) {
      return res.status(existingQueueResponse.statusCode).json({
        ...existingQueueResponse.body,
        correlationId,
      });
    }

    if (!draftId || !userAddress || !plan || !sessionId) {
      if (process.env.DEBUG_DIAGNOSTICS === 'true') {
        console.log('[DEBUG_DIAGNOSTICS] session unauthorized: missing required fields (draftId, userAddress, plan, sessionId)');
      }
      return res.status(400).json({
        ok: false,
        success: false,
        error: 'Missing required fields for session execution',
        errorCode: 'MISSING_FIELDS',
        notes: ['Required: draftId, userAddress, plan, sessionId'],
        chainId: 11155111,
      });
    }

    const { maybeTopUpRelayer } = await import('../services/relayerTopUp');
    void maybeTopUpRelayer(settlementChain, {
      reason: 'relayed_execute_preflight',
      fireAndForget: true,
    });

    // ================================================================
    // PLAN NORMALIZATION: Convert high-level intent to on-chain format
    // ================================================================
    // The frontend sends a simplified intent format. We need to convert it
    // to the on-chain ExecutionPlan format before validation and execution.

    // Import config values BEFORE action normalization (fixes TDZ error)
    const configModule = await import('../config');
    const DEMO_REDACTED_ADDRESS = configModule.DEMO_REDACTED_ADDRESS || configModule.DEMO_BUSDC_ADDRESS;
    const REDACTED_ADDRESS_SEPOLIA = configModule.REDACTED_ADDRESS_SEPOLIA;
    const WETH_ADDRESS_SEPOLIA = configModule.WETH_ADDRESS_SEPOLIA;
    const ALLOW_PROOF_ONLY = configModule.ALLOW_PROOF_ONLY;

    // Add missing plan fields
    if (!plan.user) {
      plan.user = userAddress;
    }
    if (plan.nonce === undefined || plan.nonce === null) {
      // Generate nonce from timestamp + random to ensure uniqueness
      plan.nonce = Math.floor(Date.now() / 1000) * 1000 + Math.floor(Math.random() * 1000);
    }
    if (!plan.deadline) {
      // Default deadline: 5 minutes from now
      plan.deadline = Math.floor(Date.now() / 1000) + 5 * 60;
    }

    // Map action type strings to numeric actionType enum
    const actionTypeMap: Record<string, number> = {
      'swap': 0,
      'demo_swap': 0,
      'wrap': 1,
      'unwrap': 2,
      'lend': 3,
      'lend_supply': 3,
      'defi': 3,
      'borrow': 4,
      'repay': 5,
      'event_buy': 5,
      'proof': 6,
      'perp': 7,
      'event': 8,
    };

    // Normalize actions
    for (const action of plan.actions) {
      // Convert string type to numeric actionType
      if (action.type && action.actionType === undefined) {
        action.actionType = actionTypeMap[action.type] ?? 0;
      }

      // If data is an object (execution request), we need to handle it
      // For now, encode it as a simple proof/event action
      if (action.data && typeof action.data === 'object' && !action.data.startsWith?.('0x')) {
        const { encodeAbiParameters } = await import('viem');

        // Get action type for encoding
        const actionType = action.actionType ?? actionTypeMap[action.type] ?? 0;

        if (actionType === 8) { // EVENT action (DemoEventAdapter)
          const { keccak256, stringToBytes, parseUnits } = await import('viem');
          const eventData = action.data;
          const marketIdRaw = eventData.eventId || eventData.marketId || eventData.market || 'demo-market';
          const marketId = marketIdRaw.startsWith('0x') && marketIdRaw.length === 66
            ? marketIdRaw
            : keccak256(stringToBytes(marketIdRaw));
          const outcome = String(eventData.outcome || 'yes').toLowerCase() === 'no' || eventData.outcome === false ? 2 : 1;
          const stakeAmount = parseUnits(String(eventData.stakeUsd || eventData.amount || 5), 6);
          const user = (plan.user || userAddress) as `0x${string}`;
          const stakeToken = (DEMO_REDACTED_ADDRESS || REDACTED_ADDRESS_SEPOLIA || '0x0000000000000000000000000000000000000000') as `0x${string}`;

          try {
            const adapterData = encodeAbiParameters(
              [
                { type: 'uint8', name: 'action' },
                { type: 'address', name: 'user' },
                { type: 'bytes32', name: 'marketId' },
                { type: 'uint256', name: 'amount' },
              ],
              [outcome, user, marketId as `0x${string}`, stakeAmount]
            );
            const routerData = encodeAbiParameters(
              [
                { type: 'address', name: 'stakeToken' },
                { type: 'uint256', name: 'amount' },
                { type: 'bytes', name: 'adapterData' },
              ],
              [stakeToken, stakeAmount, adapterData]
            );
            const maxSpendUnits = stakeAmount;
            action.data = encodeAbiParameters(
              [{ type: 'uint256' }, { type: 'bytes' }],
              [maxSpendUnits, routerData]
            );
          } catch (encodeError: any) {
            console.warn('[relayed] Failed to encode event data, using fallback:', encodeError.message);
            action.data = '0x' + Buffer.from(JSON.stringify(eventData)).toString('hex');
          }
        } else if (actionType === 7) { // PERP action (DemoPerpAdapter)
          const { parseUnits } = await import('viem');
          const perpData = action.data;
          const marketRaw = (perpData.market || perpData.asset || perpData.token || 'ETH').toString().toUpperCase();
          const marketMap: Record<string, number> = { 'BTC': 0, 'BTC-USD': 0, 'ETH': 1, 'ETH-USD': 1, 'SOL': 2, 'SOL-USD': 2 };
          const marketEnum = marketMap[marketRaw] ?? 1;
          const sideEnum = String(perpData.direction || 'long').toLowerCase() === 'short' || perpData.isLong === false ? 1 : 0;
          const leverage = BigInt(perpData.leverage || perpData.leverageX || 5);
          const marginAmount = parseUnits(String(perpData.marginUsd || perpData.depositUsd || perpData.amount || 100), 6);
          const user = (plan.user || userAddress) as `0x${string}`;
          const marginToken = (DEMO_REDACTED_ADDRESS || REDACTED_ADDRESS_SEPOLIA || '0x0000000000000000000000000000000000000000') as `0x${string}`;

          try {
            const adapterData = encodeAbiParameters(
              [
                { type: 'uint8', name: 'action' },
                { type: 'address', name: 'user' },
                { type: 'uint8', name: 'market' },
                { type: 'uint8', name: 'side' },
                { type: 'uint256', name: 'margin' },
                { type: 'uint256', name: 'leverage' },
              ],
              [1, user, marketEnum, sideEnum, marginAmount, leverage]
            );
            const routerData = encodeAbiParameters(
              [
                { type: 'address', name: 'marginToken' },
                { type: 'uint256', name: 'margin' },
                { type: 'bytes', name: 'adapterData' },
              ],
              [marginToken, marginAmount, adapterData]
            );
            const maxSpendUnits = marginAmount;
            action.data = encodeAbiParameters(
              [{ type: 'uint256' }, { type: 'bytes' }],
              [maxSpendUnits, routerData]
            );
          } catch (encodeError: any) {
            console.warn('[relayed] Failed to encode perp data, using fallback:', encodeError.message);
            action.data = '0x' + Buffer.from(JSON.stringify(perpData)).toString('hex');
          }
        } else if (actionType === 3) { // Lend action (DemoLend/Aave)
          const { parseUnits } = await import('viem');
          const lendData = action.data;
          const asset = lendData.asset || lendData.token || DEMO_REDACTED_ADDRESS || REDACTED_ADDRESS_SEPOLIA || '0x0000000000000000000000000000000000000000';
          const vault = lendData.vault || lendData.vaultAddress || lendData.pool || '0x0000000000000000000000000000000000000000';
          const amount = parseUnits(String(lendData.amount || 100), asset?.toLowerCase() === (WETH_ADDRESS_SEPOLIA || '').toLowerCase() ? 18 : 6);
          const user = (plan.user || userAddress) as `0x${string}`;

          try {
            const innerData = encodeAbiParameters(
              [
                { type: 'address', name: 'asset' },
                { type: 'address', name: 'vault' },
                { type: 'uint256', name: 'amount' },
                { type: 'address', name: 'onBehalfOf' },
              ],
              [asset as `0x${string}`, vault as `0x${string}`, amount, user]
            );
            // Session wrapper with maxSpendUnits equal to amount (in token units)
            action.data = encodeAbiParameters(
              [{ type: 'uint256' }, { type: 'bytes' }],
              [amount, innerData]
            );
          } catch (encodeError: any) {
            console.warn('[relayed] Failed to encode lend data, using fallback:', encodeError.message);
            action.data = '0x' + Buffer.from(JSON.stringify(lendData)).toString('hex');
          }
        } else {
          // Default: encode as JSON bytes
          action.data = '0x' + Buffer.from(JSON.stringify(action.data)).toString('hex');
        }
      }
    }

    console.log('[relayed] Normalized plan:', {
      user: plan.user?.slice(0, 10),
      nonce: plan.nonce,
      deadline: plan.deadline,
      actionsCount: plan.actions?.length,
      firstActionType: plan.actions?.[0]?.actionType,
    });

    // STRICT SERVER-SIDE GUARDS
    // Note: DEMO_REDACTED_ADDRESS, REDACTED_ADDRESS_SEPOLIA, WETH_ADDRESS_SEPOLIA already imported above
    const EXECUTION_ROUTER_ADDRESS = settlementRouterAddress || configModule.EXECUTION_ROUTER_ADDRESS;
    const ETH_TESTNET_RPC_URL = settlementRpcUrl || configModule.ETH_TESTNET_RPC_URL;
    const UNISWAP_V3_ADAPTER_ADDRESS = configModule.UNISWAP_V3_ADAPTER_ADDRESS;
    const WETH_WRAP_ADAPTER_ADDRESS = configModule.WETH_WRAP_ADAPTER_ADDRESS;
    const MOCK_SWAP_ADAPTER_ADDRESS = configModule.MOCK_SWAP_ADAPTER_ADDRESS;

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

    // Guard 2: Validate allowed adapters only (reuse UNISWAP_V3_ADAPTER_ADDRESS, WETH_WRAP_ADAPTER_ADDRESS, MOCK_SWAP_ADAPTER_ADDRESS from above)
    const adapterConfig = await import('../config');
    const PROOF_ADAPTER_ADDRESS = adapterConfig.PROOF_ADAPTER_ADDRESS;
    const ERC20_PULL_ADAPTER_ADDRESS = adapterConfig.ERC20_PULL_ADAPTER_ADDRESS;
    const DEMO_LEND_ADAPTER_ADDRESS = adapterConfig.DEMO_LEND_ADAPTER_ADDRESS;
    const AAVE_ADAPTER_ADDRESS_RELAYED = adapterConfig.AAVE_ADAPTER_ADDRESS;
    const DEMO_PERP_ADAPTER_ADDRESS_RELAYED = adapterConfig.DEMO_PERP_ADAPTER_ADDRESS;

    const allowedAdapters = new Set<string>();
    if (UNISWAP_V3_ADAPTER_ADDRESS) {
      allowedAdapters.add(UNISWAP_V3_ADAPTER_ADDRESS.toLowerCase());
    }
    if (WETH_WRAP_ADAPTER_ADDRESS) {
      allowedAdapters.add(WETH_WRAP_ADAPTER_ADDRESS.toLowerCase());
    }
    if (MOCK_SWAP_ADAPTER_ADDRESS) {
      allowedAdapters.add(MOCK_SWAP_ADAPTER_ADDRESS.toLowerCase());
    }
    if (PROOF_ADAPTER_ADDRESS) {
      allowedAdapters.add(PROOF_ADAPTER_ADDRESS.toLowerCase());
    }
    if (ERC20_PULL_ADAPTER_ADDRESS) {
      allowedAdapters.add(ERC20_PULL_ADAPTER_ADDRESS.toLowerCase());
    }
    if (DEMO_LEND_ADAPTER_ADDRESS) {
      allowedAdapters.add(DEMO_LEND_ADAPTER_ADDRESS.toLowerCase());
    }
    if (AAVE_ADAPTER_ADDRESS_RELAYED) {
      allowedAdapters.add(AAVE_ADAPTER_ADDRESS_RELAYED.toLowerCase());
    }
    // MVP: Allow DEMO_PERP_ADAPTER for real perp execution
    if (DEMO_PERP_ADAPTER_ADDRESS_RELAYED) {
      allowedAdapters.add(DEMO_PERP_ADAPTER_ADDRESS_RELAYED.toLowerCase());
    }

    // Resolve adapters and validate
    const DEMO_EVENT_ADAPTER_ADDRESS = adapterConfig.DEMO_EVENT_ADAPTER_ADDRESS;
    if (DEMO_EVENT_ADAPTER_ADDRESS) {
      allowedAdapters.add(DEMO_EVENT_ADAPTER_ADDRESS.toLowerCase());
    }

    for (const action of plan.actions) {
      let adapter = action.adapter?.toLowerCase();

      // If adapter is zero address or missing, resolve based on action type
      if (!adapter || adapter === '0x0000000000000000000000000000000000000000') {
        // Resolve adapter based on action type from metadata
        const actionType = action.type || action.data?.kind || plan.metadata?.planType;
        console.log('[relayed] Resolving adapter for action type:', actionType);

        if (actionType === 'swap' || actionType === 'demo_swap') {
          adapter = MOCK_SWAP_ADAPTER_ADDRESS?.toLowerCase() || UNISWAP_V3_ADAPTER_ADDRESS?.toLowerCase();
        } else if (actionType === 'defi' || actionType === 'lend' || actionType === 'lend_supply') {
          adapter = DEMO_LEND_ADAPTER_ADDRESS?.toLowerCase() || AAVE_ADAPTER_ADDRESS_RELAYED?.toLowerCase();
        } else if (actionType === 'perp') {
          adapter = DEMO_PERP_ADAPTER_ADDRESS_RELAYED?.toLowerCase();
        } else if (actionType === 'event') {
          adapter = DEMO_EVENT_ADAPTER_ADDRESS?.toLowerCase() || PROOF_ADAPTER_ADDRESS?.toLowerCase();
        } else if (actionType === 'proof' || action.actionType === 6) {
          adapter = PROOF_ADAPTER_ADDRESS?.toLowerCase();
        }

        if (adapter) {
          action.adapter = adapter;
          console.log('[relayed] Resolved adapter to:', adapter);
        }
      }

      if (!adapter) {
        return res.status(400).json({
          ok: false,
          error: {
            code: 'ADAPTER_MISSING',
            message: 'Action missing adapter address and could not be resolved',
          },
          correlationId,
        });
      }
      if (!allowedAdapters.has(adapter)) {
        return res.status(400).json({
          ok: false,
          error: {
            code: 'ADAPTER_NOT_ALLOWED',
            adapter,
            allowedAdapters: Array.from(allowedAdapters),
            message: `Adapter ${adapter} not allowed. Allowed adapters: ${Array.from(allowedAdapters).join(', ')}`,
          },
          correlationId,
        });
      }
    }

    // Guard 2b: Verify adapters are actually allowlisted on-chain (prevents on-chain revert)
    if (EXECUTION_ROUTER_ADDRESS && ETH_TESTNET_RPC_URL) {
      try {
        const { eth_call, decodeBool } = await import('../executors/evmRpc');
        const { encodeFunctionData } = await import('viem');
        const isAdapterAllowedAbi = [
          {
            name: 'isAdapterAllowed',
            type: 'function',
            stateMutability: 'view',
            inputs: [{ name: '', type: 'address' }],
            outputs: [{ name: '', type: 'bool' }],
          },
        ] as const;

        const uniqueAdapters = Array.from(new Set(plan.actions.map(a => a.adapter?.toLowerCase())));
        for (const adapter of uniqueAdapters) {
          if (!adapter) continue;
          const data = encodeFunctionData({
            abi: isAdapterAllowedAbi,
            functionName: 'isAdapterAllowed',
            args: [adapter as `0x${string}`],
          });
          const result = await eth_call(ETH_TESTNET_RPC_URL, EXECUTION_ROUTER_ADDRESS, data);
          const isAllowed = decodeBool(result);
          if (!isAllowed) {
            return res.status(400).json({
              ok: false,
              error: {
                code: 'ADAPTER_NOT_ALLOWED',
                adapter,
                message: `Adapter ${adapter} is not allowlisted in router`,
              },
              correlationId,
            });
          }
        }
      } catch (error: any) {
        return res.status(400).json({
          ok: false,
          error: {
            code: 'ADAPTER_CHECK_FAILED',
            message: `Failed to verify adapter allowlist status: ${error.message}`,
          },
          correlationId,
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
    // Include both standard Sepolia tokens AND Aave-specific tokens
    const { AAVE_REDACTED_ADDRESS, AAVE_WETH_ADDRESS } = await import('../config');
    const allowedTokens = new Set<string>();
    if (WETH_ADDRESS_SEPOLIA) {
      allowedTokens.add(WETH_ADDRESS_SEPOLIA.toLowerCase());
    }
    if (REDACTED_ADDRESS_SEPOLIA) {
      allowedTokens.add(REDACTED_ADDRESS_SEPOLIA.toLowerCase());
    }
    // Add Aave-specific tokens for lending
    if (AAVE_REDACTED_ADDRESS) {
      allowedTokens.add(AAVE_REDACTED_ADDRESS.toLowerCase());
    }
    if (AAVE_WETH_ADDRESS) {
      allowedTokens.add(AAVE_WETH_ADDRESS.toLowerCase());
    }

    // Decode actions to check tokens
    const { decodeAbiParameters, parseUnits } = await import('viem');
    for (const action of plan.actions) {
      if (action.actionType === 0) {
        // SWAP action - decode to check tokens
        try {
          const decoded = decodeAbiParameters(
            [
              { type: 'address' }, // tokenIn
              { type: 'address' }, // tokenOut
              { type: 'uint24' }, // fee
              { type: 'uint256' }, // amountIn
              { type: 'uint256' }, // amountOutMin
              { type: 'address' }, // recipient
              { type: 'uint256' }, // deadline
            ],
            action.data as `0x${string}`
          );
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

          // Guard 5: Validate max amountIn per swap
          // Generous limit: 100 ETH worth allows large trades
          const amountIn = decoded[3];
          const maxAmountIn = BigInt(parseUnits('100', 18)); // 100 ETH max per swap
          if (amountIn > maxAmountIn) {
            return res.status(400).json({
              error: `Swap amountIn exceeds maximum (100 ETH). Got ${amountIn.toString()}`,
            });
          }
        } catch (error: any) {
          // If decode fails, might be session mode wrapped data - skip token validation
          console.warn('[api/execute/relayed] Could not decode swap action, skipping token validation:', error.message);
        }
      }
    }

    // Guard 6: Validate value (max for WRAP actions and ETH transfers)
    // Generous limit: 100 ETH allows large wraps and transfers
    const planValue = BigInt(req.body.value || '0x0');
    const maxValue = BigInt(parseUnits('100', 18)); // 100 ETH max
    if (planValue > maxValue) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'POLICY_EXCEEDED',
          message: `Plan value exceeds maximum (100 ETH). Got ${planValue.toString()}`,
        },
        correlationId,
      });
    }

    // Guard 7: Verify token approval hasn't expired/been revoked
    // This is a safety net to catch approval issues at execution time
    if (EXECUTION_ROUTER_ADDRESS && ETH_TESTNET_RPC_URL && DEMO_REDACTED_ADDRESS) {
      try {
        const { createPublicClient, http, encodeFunctionData } = await import('viem');
        const { sepolia } = await import('viem/chains');

        const publicClient = createPublicClient({
          chain: sepolia,
          transport: http(ETH_TESTNET_RPC_URL),
        });

        const allowanceAbi = [
          {
            name: 'allowance',
            type: 'function',
            stateMutability: 'view',
            inputs: [
              { name: 'owner', type: 'address' },
              { name: 'spender', type: 'address' },
            ],
            outputs: [{ name: '', type: 'uint256' }],
          },
        ] as const;

        const data = encodeFunctionData({
          abi: allowanceAbi,
          functionName: 'allowance',
          args: [plan.user as `0x${string}`, EXECUTION_ROUTER_ADDRESS.trim() as `0x${string}`],
        });

        const result = await Promise.race([
          publicClient.call({
            to: DEMO_REDACTED_ADDRESS as `0x${string}`,
            data: data as `0x${string}`,
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
        ]) as { data?: `0x${string}` };

        const allowance = result.data ? BigInt(result.data) : 0n;

        if (allowance === 0n) {
          return res.status(400).json({
            ok: false,
            error: {
              code: 'APPROVAL_REQUIRED',
              message: 'Token approval expired or missing. Please re-authorize token spending.',
              tokenAddress: DEMO_REDACTED_ADDRESS,
              spenderAddress: EXECUTION_ROUTER_ADDRESS.trim(),
            },
            correlationId,
          });
        }
      } catch (error: any) {
        // Don't block execution on RPC failure - log and continue
        console.warn('[relayed] Approval check failed (continuing):', error.message);
      }
    }

    // SPRINT 2: Session Authority Policy Enforcement
    const validateOnly = req.query?.validateOnly === 'true' || req.body?.validateOnly === true;
    
    // Helper to get session status from on-chain
    const getSessionStatusFromChain = async (sessionId: string): Promise<{
      active: boolean;
      owner: string;
      executor: string;
      expiresAt: bigint;
      maxSpend: bigint;
      spent: bigint;
      status: 'active' | 'expired' | 'revoked' | 'not_created';
    } | null> => {
      try {
        const { ETH_TESTNET_RPC_URL, EXECUTION_ROUTER_ADDRESS } = await import('../config');
        if (!ETH_TESTNET_RPC_URL || !EXECUTION_ROUTER_ADDRESS) {
          return null;
        }

        const { createPublicClient, http } = await import('viem');
        const { sepolia } = await import('viem/chains');
        const publicClient = createPublicClient({
          chain: sepolia,
          transport: http(ETH_TESTNET_RPC_URL),
        });

        const normalizedSessionId = sessionId.startsWith('0x') ? sessionId : `0x${sessionId}`;
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
        ] as const;

        const sessionResult = await Promise.race([
          publicClient.readContract({
            address: EXECUTION_ROUTER_ADDRESS as `0x${string}`,
            abi: sessionAbi,
            functionName: 'sessions',
            args: [normalizedSessionId as `0x${string}`],
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
        ]) as any;

        const owner = sessionResult[0];
        const executor = sessionResult[1];
        const expiresAt = sessionResult[2];
        const maxSpend = sessionResult[3];
        const spent = sessionResult[4];
        const active = sessionResult[5];

        const now = BigInt(Math.floor(Date.now() / 1000));
        let status: 'active' | 'expired' | 'revoked' | 'not_created' = 'not_created';

        if (active) {
          if (expiresAt > now) {
            status = 'active';
          } else {
            status = 'expired';
          }
        } else if (owner !== '0x0000000000000000000000000000000000000000') {
          status = 'revoked';
        }

        return {
          active: status === 'active',
          owner,
          executor,
          expiresAt,
          maxSpend,
          spent,
          status,
        };
      } catch (error) {
        return null;
      }
    };

    // Evaluate SessionPolicy
    const { evaluateSessionPolicy, estimatePlanSpend } = await import('./sessionPolicy');
    
    // DEV-ONLY: Allow policyOverride in validateOnly mode for testing
    let policyOverride: { maxSpendUnits?: string; skipSessionCheck?: boolean } | undefined;
    if (validateOnly && (process.env.NODE_ENV !== 'production' || process.env.DEV === 'true')) {
      policyOverride = req.body.policyOverride;
      // If maxSpendUnits is provided, also skip session check to test spend limits directly
      if (policyOverride?.maxSpendUnits) {
        policyOverride.skipSessionCheck = true;
      }
    }
    
    const policyResult = await evaluateSessionPolicy(
      sessionId,
      userAddress,
      plan,
      allowedAdapters,
      getSessionStatusFromChain,
      policyOverride
    );

    // Log policy evaluation for dev diagnostics
    const spendEstimate = await estimatePlanSpend(plan);
    
    // Determine instrument type from plan actions
    let instrumentType: 'swap' | 'perp' | 'defi' | 'event' | undefined;
    if (plan.actions.length > 0) {
      const firstAction = plan.actions[0];
      if (firstAction.actionType === 0 || firstAction.actionType === 2) instrumentType = 'swap';
      else if (firstAction.actionType === 3) instrumentType = 'defi';
      else if (firstAction.actionType === 7) instrumentType = 'perp';
      else if (firstAction.actionType === 8) instrumentType = 'event';
      else if (firstAction.actionType === 6) instrumentType = 'event'; // PROOF fallback
    }
    instrumentType = instrumentType || spendEstimate.instrumentType;

    if (process.env.NODE_ENV !== 'production') {
      logExecuteTrace(correlationId, 'policy:evaluated', {
        allowed: policyResult.allowed,
        code: policyResult.code,
        spendWei: spendEstimate.spendWei.toString(),
        determinable: spendEstimate.determinable,
        instrumentType,
      });
    }

    if (!policyResult.allowed) {
      // Log failed attempt
      if (process.env.NODE_ENV !== 'production') {
        addRelayedAttempt({
          correlationId,
          timestamp: Date.now(),
          userAddress,
          sessionId,
          adapter: plan.actions[0]?.adapter || 'unknown',
          instrumentType,
          spendAttempted: spendEstimate.spendWei.toString(),
          result: 'failed',
          errorCode: policyResult.code,
        });
      }

      // Policy check failed - return structured error
      // Ensure consistent error format for validateOnly and normal execution
      const errorResponse = {
        ok: false,
        correlationId,
        error: {
          code: policyResult.code || 'POLICY_FAILED',
          message: policyResult.message || 'Session policy check failed',
          ...(policyResult.details || {}),
        },
      };
      
      // Include correlationId in response header
      res.setHeader('x-correlation-id', correlationId);
      return res.status(400).json(errorResponse);
    }

    // If validateOnly mode, return success without submitting transaction
    if (validateOnly) {
      // Log validateOnly attempt
      if (process.env.NODE_ENV !== 'production') {
        addRelayedAttempt({
          correlationId,
          timestamp: Date.now(),
          userAddress,
          sessionId,
          adapter: plan.actions[0]?.adapter || 'unknown',
          instrumentType,
          spendAttempted: spendEstimate.spendWei.toString(),
          result: 'ok',
        });
      }

      return res.json({
        ok: true,
        wouldAllow: true,
        correlationId,
        policy: {
          sessionStatus: 'active',
          spendEstimate: {
            spendWei: spendEstimate.spendWei.toString(),
            determinable: spendEstimate.determinable,
            instrumentType,
          },
        },
        note: 'validateOnly mode: policy check passed, transaction not submitted',
      });
    }

    const requestedFromChain = String(
      req.body?.fromChain ||
      req.body?.chain ||
      req.body?.metadata?.fromChain ||
      req.body?.metadata?.chain ||
      ''
    );
    const userSolanaAddress = String(
      req.body?.userSolanaAddress ||
      req.body?.solanaAddress ||
      req.body?.metadata?.userSolanaAddress ||
      req.body?.metadata?.solanaAddress ||
      ''
    ).trim();
    const amountUsdHint = Number(
      req.body?.amountUsd ||
      req.body?.metadata?.amountUsd ||
      req.body?.plan?.metadata?.amountUsd ||
      0
    );

    const { ensureExecutionFunding } = await import('../services/crossChainCreditRouter');
    const fundingTimeoutMs = Math.max(1_000, parseInt(process.env.EXECUTION_FUNDING_TIMEOUT_MS || '20000', 10));
    let fundingResult;
    try {
      fundingResult = await Promise.race([
        ensureExecutionFunding({
          userId: req.body?.metadata?.userId || userAddress?.toLowerCase(),
          sessionId,
          userEvmAddress: userAddress,
          userSolanaAddress: userSolanaAddress || undefined,
          fromChain: requestedFromChain || undefined,
          toChain: settlementChain,
          amountUsdRequired: Number.isFinite(amountUsdHint) && amountUsdHint > 0 ? amountUsdHint : undefined,
          spendEstimateUnits: spendEstimate?.spendWei,
          instrumentType,
        }),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`CROSS_CHAIN_ROUTE_TIMEOUT:${fundingTimeoutMs}`)), fundingTimeoutMs);
        }),
      ]);
    } catch (error: any) {
      return res.status(504).json({
        ok: false,
        success: false,
        error: "Couldn't verify routing prerequisites in time. Please retry.",
        errorCode: 'CROSS_CHAIN_ROUTE_TIMEOUT',
        executionMeta: {
          route: {
            didRoute: false,
            fromChain: requestedFromChain || 'unknown',
            toChain: settlementChain,
            reason: 'Cross-chain funding stage timed out before execution.',
          },
        },
        queued: false,
        correlationId,
      });
    }

    if (!fundingResult.ok) {
      return res.status(409).json({
        ok: false,
        success: false,
        error: fundingResult.userMessage,
        errorCode: fundingResult.code || 'CROSS_CHAIN_ROUTE_FAILED',
        executionMeta: {
          route: fundingResult.route || {
            didRoute: false,
            fromChain: requestedFromChain || 'unknown',
            toChain: settlementChain,
            reason: 'Cross-chain route failed before execution.',
          },
        },
        queued: false,
        correlationId,
      });
    }
    executionRouteMeta = fundingResult.route || executionRouteMeta;

    console.log('[api/execute/relayed] Policy passed, importing relayer...');
    const { sendRelayedTx } = await import('../executors/relayer');
    console.log('[api/execute/relayed] Relayer imported, importing viem...');

    // Encode executeWithSession call
    const { encodeFunctionData } = await import('viem');
    console.log('[api/execute/relayed] Viem imported, encoding function data...');
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
    ] as const;

    // Debug: log plan values before encoding
    console.log('[api/execute/relayed] Plan values:', {
      user: plan.user,
      nonce: plan.nonce,
      nonceType: typeof plan.nonce,
      deadline: plan.deadline,
      deadlineType: typeof plan.deadline,
      actionsCount: plan.actions?.length,
    });

    // Validate plan fields before BigInt conversion
    if (plan.nonce === undefined || plan.nonce === null) {
      return res.status(400).json({
        error: 'Plan nonce is required',
        errorCode: 'INVALID_PLAN',
        details: { nonce: plan.nonce, deadline: plan.deadline },
      });
    }
    if (plan.deadline === undefined || plan.deadline === null) {
      return res.status(400).json({
        error: 'Plan deadline is required',
        errorCode: 'INVALID_PLAN',
        details: { nonce: plan.nonce, deadline: plan.deadline },
      });
    }
    if (!plan.user) {
      return res.status(400).json({
        error: 'Plan user is required',
        errorCode: 'INVALID_PLAN',
        details: { user: plan.user },
      });
    }
    if (!Array.isArray(plan.actions) || plan.actions.length === 0) {
      return res.status(400).json({
        error: 'Plan actions array is required and must not be empty',
        errorCode: 'INVALID_PLAN',
        details: { actions: plan.actions },
      });
    }
    // Validate each action has required fields
    for (let i = 0; i < plan.actions.length; i++) {
      const action = plan.actions[i];
      if (action.actionType === undefined || action.actionType === null) {
        return res.status(400).json({
          error: `Action ${i} missing actionType`,
          errorCode: 'INVALID_PLAN',
          details: { actionIndex: i, action },
        });
      }
      if (!action.adapter) {
        return res.status(400).json({
          error: `Action ${i} missing adapter address`,
          errorCode: 'INVALID_PLAN',
          details: { actionIndex: i, action },
        });
      }
      if (!action.data) {
        return res.status(400).json({
          error: `Action ${i} missing data`,
          errorCode: 'INVALID_PLAN',
          details: { actionIndex: i, action },
        });
      }
    }

    // Debug: log each action before encoding
    console.log('[api/execute/relayed] Actions before encoding:');
    for (let i = 0; i < plan.actions.length; i++) {
      const a = plan.actions[i];
      console.log(`  Action ${i}:`, {
        actionType: a.actionType,
        actionTypeType: typeof a.actionType,
        adapter: a.adapter?.slice(0, 15) + '...',
        adapterType: typeof a.adapter,
        dataLen: a.data?.length,
        dataType: typeof a.data,
      });
    }

    let data: string;
    try {
      data = encodeFunctionData({
        abi: executeWithSessionAbi,
        functionName: 'executeWithSession',
        args: [
          sessionId as `0x${string}`,
          {
            user: plan.user as `0x${string}`,
            nonce: BigInt(plan.nonce),
            deadline: BigInt(plan.deadline),
            actions: plan.actions.map((a: any) => ({
              actionType: a.actionType,
              adapter: a.adapter as `0x${string}`,
              data: a.data as `0x${string}`,
            })),
          },
        ],
      });
      console.log('[api/execute/relayed] encodeFunctionData SUCCESS, dataLen:', data.length);
    } catch (encodeErr: any) {
      console.error('[api/execute/relayed] encodeFunctionData FAILED:', encodeErr.message);
      console.error('[api/execute/relayed] Full plan.actions:', JSON.stringify(plan.actions, null, 2));
      throw encodeErr;
    }

    // Get portfolio before execution
    const portfolioBefore = buildPortfolioSnapshot();

    // V1: Compute planHash server-side (keccak256(abi.encode(plan)))
    const { keccak256, encodeAbiParameters } = await import('viem');
    let planHash: string;
    try {
      planHash = keccak256(
        encodeAbiParameters(
          [
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
          [
            plan.user as `0x${string}`,
            BigInt(plan.nonce),
            BigInt(plan.deadline),
            plan.actions.map((a: any) => ({
              actionType: a.actionType,
              adapter: a.adapter as `0x${string}`,
              data: a.data as `0x${string}`,
            })),
          ]
        )
      );
      console.log('[api/execute/relayed] planHash computed:', planHash.slice(0, 20) + '...');
    } catch (hashErr: any) {
      console.error('[api/execute/relayed] planHash FAILED:', hashErr.message);
      throw hashErr;
    }

    // Send relayed transaction
    const { maybeDripUserGas, noteFundingRecoveryMode, recordGasCreditAccrual } = await import('../services/relayerTopUp');
    const { executionFundingPolicy } = await import('../services/executionFundingPolicy');

    const fundingPolicy = await executionFundingPolicy({
      chain: settlementChain,
      userAddress,
      attemptTopupSync: true,
      topupReason: 'relayed_low_balance_sync',
      topupTimeoutMs: Math.max(1_000, parseInt(process.env.RELAYER_TOPUP_SYNC_TIMEOUT_MS || '12000', 10)),
    });
    executionFundingMode = fundingPolicy.mode;
    executionFundingMeta = fundingPolicy.executionMetaFunding;

    if (fundingPolicy.mode === 'user_paid_required') {
      noteFundingRecoveryMode('user_pays_gas');
      return res.status(409).json({
        ok: false,
        success: false,
        queued: false,
        mode: 'wallet_fallback',
        fundingMode: 'user_paid_required',
        errorCode: 'USER_PAID_REQUIRED',
        error: fundingPolicy.userMessage,
        needs_wallet_signature: true,
        execution: {
          mode: 'wallet_fallback',
          chain: settlementChain,
          tx: {
            to: EXECUTION_ROUTER_ADDRESS!,
            data,
            value: req.body.value || '0x0',
          },
        },
        machine: {
          queued: false,
          reason: fundingPolicy.reasonCode,
        },
        executionMeta: {
          route: executionRouteMeta,
          funding: fundingPolicy.executionMetaFunding,
          fundingMode: 'user_paid_required',
          chain: settlementChain,
        },
        correlationId,
      });
    }

    if (fundingPolicy.mode === 'blocked_needs_gas') {
      if (fundingPolicy.sponsorEligible && userAddress) {
        const dripAttempt = await maybeDripUserGas(settlementChain, userAddress, {
          reason: 'execute_relayer_low_balance',
          fireAndForget: false,
        });
        if (dripAttempt.ok) {
          return res.status(402).json({
            ok: false,
            success: false,
            queued: false,
            errorCode: 'BLOCKED_NEEDS_GAS',
            error: 'Execution requires wallet gas (testnet ETH). Top-up sent. Continue with wallet.',
            needs_wallet_signature: true,
            gasDrip: {
              txHash: dripAttempt.txHash,
              amountEth: dripAttempt.amountEth,
            },
            execution: {
              mode: 'wallet_fallback',
              chain: settlementChain,
              tx: {
                to: EXECUTION_ROUTER_ADDRESS!,
                data,
                value: req.body.value || '0x0',
              },
            },
            machine: {
              queued: false,
              reason: 'SPONSOR_DRIP_AVAILABLE',
            },
            executionMeta: {
              route: executionRouteMeta,
              funding: {
                ...fundingPolicy.executionMetaFunding,
                sponsorReason: dripAttempt.reason || fundingPolicy.executionMetaFunding.sponsorReason,
              },
              fundingMode: 'blocked_needs_gas',
              chain: settlementChain,
            },
            correlationId,
          });
        }
      }

      return res.status(402).json({
        ok: false,
        success: false,
        queued: false,
        errorCode: 'BLOCKED_NEEDS_GAS',
        error: fundingPolicy.userMessage,
        machine: {
          queued: false,
          reason: fundingPolicy.reasonCode,
        },
        executionMeta: {
          route: executionRouteMeta,
          funding: fundingPolicy.executionMetaFunding,
          fundingMode: 'blocked_needs_gas',
          chain: settlementChain,
        },
        correlationId,
      });
    }

    noteFundingRecoveryMode('relayed');
    const txHash = await sendRelayedTx({
      to: EXECUTION_ROUTER_ADDRESS!,
      data,
      value: req.body.value || '0x0',
      chain: settlementChain,
    });

    // Log successful attempt (before receipt confirmation)
    if (process.env.NODE_ENV !== 'production') {
      addRelayedAttempt({
        correlationId,
        timestamp: Date.now(),
        userAddress,
        sessionId,
        adapter: plan.actions[0]?.adapter || 'unknown',
        instrumentType: spendEstimate.instrumentType,
        spendAttempted: spendEstimate.spendWei.toString(),
        result: 'ok',
        txHash,
      });
    }

    // V1: Wait for receipt confirmation (receipt.status === 1)
    // ETH_TESTNET_RPC_URL already imported at line 3932 via guardConfig
    let receiptStatus: 'confirmed' | 'failed' | 'timeout' | 'pending' = 'pending';
    let blockNumber: number | undefined;
    let receiptError: string | undefined;

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

    // CRITICAL FIX: Record position to ledger when confirmed
    if (receiptStatus === 'confirmed' && txHash) {
      recordGasCreditAccrual({
        fundingMode:
          executionFundingMode === 'relayed' || executionFundingMode === 'relayed_after_topup'
            ? 'relayed'
            : 'user_pays_gas',
      });
      try {
        const { createPosition, createExecution, updateExecution } = await import('../../execution-ledger/db');

        // Extract position details from plan
        const action = plan.actions[0];
        const actionData = action?.data || {};
        const metadata = plan.metadata || {};

        // Determine instrument type and market
        const actionType = action?.actionType;
        let venue: any = 'swap_demo';
        let market = 'ETH';
        let side: 'long' | 'short' = 'long';
        let leverage = 1;
        let kind: any = 'swap';

        if (actionType === 7) { // Perp
          venue = 'perp_demo';
          kind = 'perp';
          market = actionData.asset || actionData.token || 'ETH';
          side = actionData.direction === 'short' || actionData.isLong === false ? 'short' : 'long';
          leverage = actionData.leverage || actionData.leverageX || 10;
        } else if (actionType === 6) { // Event/Proof
          venue = 'perp_demo'; // Use perp_demo for events too
          kind = 'proof';
          market = actionData.market || actionData.eventId || 'EVENT';
          side = actionData.outcome === 'no' || actionData.outcome === false ? 'short' : 'long';
        } else if (actionType === 3) { // Lend/DeFi
          venue = 'deposit_demo';
          kind = 'deposit';
          market = actionData.asset || actionData.token || 'REDACTED';
          side = 'long'; // Deposits are always "long"
        } else if (actionType === 0) { // Swap
          venue = 'swap_demo';
          kind = 'swap';
          market = actionData.tokenOut || 'ETH';
          side = 'long';
        }

        // Record execution first
        const execution = createExecution({
          chain: 'ethereum',
          network: 'sepolia',
          fromAddress: userAddress,
          toAddress: EXECUTION_ROUTER_ADDRESS || '',
          token: market,
          amountUnits: actionData.amount?.toString() || actionData.size?.toString() || '0',
          amountDisplay: `${actionData.amount || actionData.depositUsd || 100} USD`,
          usdEstimate: actionData.depositUsd || actionData.amount || 100,
          kind,
          venue,
          intent: metadata.executionIntent || metadata.draftId || 'relayed_execution',
          action: `${kind}_${market}`.toLowerCase(),
          relayerAddress: RELAYER_PRIVATE_KEY ? 'relayer' : undefined,
          sessionId: sessionId,
        });

        // Update execution with txHash
        updateExecution(execution.id, {
          txHash,
          explorerUrl: `https://sepolia.etherscan.io/tx/${txHash}`,
          status: 'confirmed',
        });

        // Record position (except for swaps which don't create persistent positions)
        if (actionType !== 0) {
          createPosition({
            chain: 'ethereum',
            network: 'sepolia',
            venue,
            market,
            side,
            leverage,
            margin_units: actionData.amount?.toString() || actionData.depositUsd?.toString(),
            margin_display: `${actionData.amount || actionData.depositUsd || 100} REDACTED`,
            size_units: actionData.size?.toString(),
            entry_price: actionData.entryPrice?.toString(),
            user_address: userAddress.toLowerCase(),
            open_tx_hash: txHash,
            open_explorer_url: `https://sepolia.etherscan.io/tx/${txHash}`,
            intent_id: metadata.draftId,
            execution_id: execution.id,
          });

          console.log(`[relayed] Recorded position for ${userAddress.toLowerCase()}: ${market} ${side} on ${venue}`);
        }
      } catch (ledgerError: any) {
        // Don't fail the execution, just log the ledger error
        console.error('[relayed] Failed to record to ledger:', ledgerError.message);
      }
    }

    // V1: Only update portfolio if receipt.status === 1 (confirmed)
    const portfolioAfter = receiptStatus === 'confirmed'
      ? buildPortfolioSnapshot()
      : portfolioBefore;

    const result: ExecutionResult & { receiptStatus?: string; blockNumber?: number; planHash?: string } = {
      success: receiptStatus === 'confirmed',
      status: receiptStatus === 'confirmed' ? 'success' : 'failed',
      txHash,
      receiptStatus,
      blockNumber,
      planHash, // V1: Include server-computed planHash
      error: receiptError,
      executionMeta: {
        route: executionRouteMeta,
        funding: executionFundingMeta,
      },
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
    const actionTypes = req.body.plan?.actions?.map((a: any) => a.actionType) || [];
    logEvent('relayed_tx', {
      draftId: req.body.draftId,
      userHash: req.body.userAddress ? hashAddress(req.body.userAddress) : undefined,
      txHash,
      actionTypes,
      authMode: 'session',
      latencyMs: Date.now() - relayedStartTime,
      success: true,
    });

    // Trace log: relayed success
    logExecuteTrace(correlationId, 'relayed:ok', {
      txHash,
      actionTypes,
      latencyMs: Date.now() - relayedStartTime,
    });

    // Task 4: Add execution path proof
    res.json({
      ...result,
      chainId: settlementConfig.chain.id,
      explorerUrl: `${settlementConfig.explorerTxBaseUrl}${txHash}`,
      correlationId, // Include correlationId for client tracing
      userAddress: userAddress.toLowerCase(), // Include userAddress for wallet scoping
      notes: ['execution_path:relayed'], // Task 4: Unambiguous evidence of execution path
      executionMeta: {
        route: executionRouteMeta,
        funding: executionFundingMeta,
        fundingMode: executionFundingMode,
        chain: settlementChain,
      },
    });
  } catch (error: any) {
    if (process.env.DEBUG_DIAGNOSTICS === 'true') {
      console.log('[DEBUG_DIAGNOSTICS] execution failed after session:', error?.message || String(error));
    }
    console.error('[api/execute/relayed] Error:', error);
    
    // Trace log: relayed error
    logExecuteTrace(correlationId, 'relayed:error', {
      error: error.message,
      latencyMs: Date.now() - relayedStartTime,
    });
    
    // Determine error code for UI handling
    let errorCode = 'RELAYER_FAILED';
    const errorMessage = String(error?.message || '');
    const errorBucket = String(error?.bucket || '').toLowerCase();
    if (errorBucket === 'relayer_low_balance' || errorMessage.includes('RELAYER_LOW_BALANCE')) {
      errorCode = 'RELAYER_LOW_BALANCE';
    } else if (errorBucket === 'relayer_topup_failed') {
      errorCode = 'RELAYER_TOPUP_FAILED';
    } else if (errorBucket === 'nonce_collision') {
      errorCode = 'NONCE_COLLISION';
    } else if (errorBucket === 'rpc_rate_limit') {
      errorCode = 'RPC_RATE_LIMIT';
    } else if (errorBucket === 'execution_revert') {
      errorCode = 'EXECUTION_REVERT';
    } else if (error.message?.includes('session') || error.message?.includes('Session')) {
      errorCode = 'SESSION_EXPIRED';
    } else if (error.message?.includes('insufficient') || error.message?.includes('balance')) {
      errorCode = 'INSUFFICIENT_BALANCE';
    } else if (error.message?.includes('slippage') || error.message?.includes('amountOutMin')) {
      errorCode = 'SLIPPAGE_FAILURE';
    }

    // Log failed attempt
    if (process.env.NODE_ENV !== 'production' && req.body.plan) {
      try {
        const { estimatePlanSpend } = await import('./sessionPolicy');
        const spendEstimate = await estimatePlanSpend(req.body.plan);
        addRelayedAttempt({
          correlationId,
          timestamp: Date.now(),
          userAddress: req.body.userAddress || 'unknown',
          sessionId: req.body.sessionId || 'unknown',
          adapter: req.body.plan.actions?.[0]?.adapter || 'unknown',
          instrumentType: spendEstimate.instrumentType,
          spendAttempted: spendEstimate.spendWei.toString(),
          result: 'failed',
          errorCode,
        });
      } catch (logError) {
        // Ignore logging errors
      }
    }

    const portfolioAfter = buildPortfolioSnapshot();
    const result: ExecutionResult = {
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

    const errorLower = String(error?.message || '').toLowerCase();
    const isTimeoutError =
      errorLower.includes('timed out') ||
      errorLower.includes('timeout') ||
      errorLower.includes('function_invocation_failed');
    const statusCode = isTimeoutError ? 504 : 500;

    res.status(statusCode).json({
      ...result,
      errorCode: isTimeoutError && errorCode === 'RELAYER_FAILED' ? 'INVOCATION_TIMEOUT' : errorCode,
      ...(errorBucket ? { failureBucket: errorBucket } : {}),
      correlationId, // Include correlationId in error response
      executionMeta: {
        route: executionRouteMeta,
        funding: executionFundingMeta,
        fundingMode: executionFundingMode,
        chain: settlementChain,
      },
    });
  }
});

/**
 * GET /api/relayer/status?chain=base_sepolia|sepolia
 * Returns relayer balance and funding capacity details.
 */
app.get('/api/relayer/status', async (req, res) => {
  try {
    const chain = normalizeSettlementChain(String(req.query.chain || process.env.DEFAULT_SETTLEMENT_CHAIN || 'base_sepolia'));

    const { getRelayerStatus } = await import('../services/relayerTopUp');
    const status = await getRelayerStatus(chain);
    const providedSecret = (req.headers['x-ledger-secret'] as string | undefined) || '';
    const isAuthorized = !!DEV_LEDGER_SECRET && providedSecret === DEV_LEDGER_SECRET;

    if (!isAuthorized) {
      status.funding = {
        ...status.funding,
        fundingAddress: undefined,
        fundingBalanceEth: undefined,
      };
    }

    return res.json(status);
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      chain: normalizeSettlementChain(String(req.query.chain || process.env.DEFAULT_SETTLEMENT_CHAIN || 'base_sepolia')),
      error: error?.message || 'Failed to fetch relayer status',
    });
  }
});

/**
 * POST /api/gas/drip?chain=base_sepolia|sepolia&address=0x...
 * Sends a capped ETH drip from funding wallet to a user wallet for beta continuity.
 */
app.post('/api/gas/drip', requireAuth, maybeCheckAccess, async (req, res) => {
  try {
    const chain = normalizeSettlementChain(String(req.query.chain || req.body?.chain || process.env.DEFAULT_SETTLEMENT_CHAIN || 'base_sepolia'));
    const chainRuntime = getSettlementChainRuntimeConfig(chain);
    const address = String(req.query.address || req.body?.address || '').trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({ ok: false, errorCode: 'INVALID_ADDRESS', error: 'A valid EVM address is required.' });
    }

    const providedSecret = String((req.headers['x-ledger-secret'] as string | undefined) || '');
    const headerWallet = String((req.headers['x-wallet-address'] as string | undefined) || '').toLowerCase();
    const isLedgerAuthorized = !!DEV_LEDGER_SECRET && providedSecret === DEV_LEDGER_SECRET;
    const isWalletOwner = headerWallet === address.toLowerCase();
    if (!isLedgerAuthorized && !isWalletOwner) {
      return res.status(403).json({
        ok: false,
        errorCode: 'UNAUTHORIZED_DRIP',
        error: 'Gas drip requires X-Ledger-Secret or matching X-Wallet-Address.',
      });
    }

    const { canSponsorGasDrip, maybeDripUserGas, getRelayerStatus } = await import('../services/relayerTopUp');
    const eligibility = await canSponsorGasDrip(chain, address);
    if (!eligibility.ok) {
      const insufficientFunding = String(eligibility.reason || '').includes('funding_wallet_insufficient');
      return res.status(insufficientFunding ? 402 : 429).json({
        ok: false,
        errorCode: insufficientFunding ? 'FUNDING_WALLET_UNDERFUNDED' : 'GAS_DRIP_CAP_REACHED',
        error: "Insufficient gas to execute. Click 'Top up gas' or retry later.",
        reason: eligibility.reason,
        eligibility,
      });
    }

    const drip = await maybeDripUserGas(chain, address, {
      reason: 'api_gas_drip',
      fireAndForget: false,
    });
    if (!drip.ok || !drip.txHash) {
      return res.status(500).json({
        ok: false,
        errorCode: 'GAS_DRIP_FAILED',
        error: drip.error || drip.reason || 'Gas drip failed',
        drip,
      });
    }

    try {
      const { createExecutionAsync, updateExecutionAsync } = await import('../../execution-ledger/db');
      const relayerStatus = await getRelayerStatus(chain);
      const execution = await createExecutionAsync({
        chain: 'ethereum',
        network: chain,
        kind: 'transfer',
        venue: 'native',
        intent: 'gas_drip',
        action: 'gas_drip',
        fromAddress: relayerStatus.funding.fundingAddress || 'funding_wallet',
        toAddress: address,
        token: 'ETH',
        amountDisplay: `${Number(drip.amountEth || 0).toFixed(6)} ETH`,
        amountUnits: Number(drip.amountEth || 0).toFixed(6),
        txHash: drip.txHash,
        status: 'submitted',
        explorerUrl: `${chainRuntime.explorerTxBaseUrl}${drip.txHash}`,
      });
      await updateExecutionAsync(execution.id, {
        status: 'confirmed',
        txHash: drip.txHash,
        explorerUrl: `${chainRuntime.explorerTxBaseUrl}${drip.txHash}`,
      });
    } catch (auditError: any) {
      console.warn('[api/gas/drip] Audit log failed:', auditError?.message || String(auditError));
    }

    return res.json({
      ok: true,
      chain,
      address: address.toLowerCase(),
      txHash: drip.txHash,
      amountEth: drip.amountEth,
      explorerUrl: `${chainRuntime.explorerTxBaseUrl}${drip.txHash}`,
      message: 'Gas drip sent successfully.',
    });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      errorCode: 'GAS_DRIP_FAILED',
      error: error?.message || 'Failed to send gas drip',
    });
  }
});

/**
 * GET /api/session/status
 * Get session status (for feature detection and direct mode compatibility)
 * NEVER returns 400 - always returns 200 with enabled:false if not configured
 */
app.get('/api/session/status', async (req, res) => {
  const correlationId = req.correlationId || generateCorrelationId();
  
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
    } else if (process.env.DEBUG_SESSION === 'true') {
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

    // VALIDATION: Ensure sessionId is valid bytes32 format (0x + 64 hex chars = 66 total)
    const normalizedSessionId = sessionId.startsWith('0x') ? sessionId : `0x${sessionId}`;
    if (normalizedSessionId.length !== 66) {
      logSessionTrace(correlationId, 'status:error', {
        error: 'Invalid sessionId format',
        sessionIdLength: normalizedSessionId.length,
        expectedLength: 66,
        sessionId: normalizedSessionId.substring(0, 20) + '...',
      });
      return res.json({
        ok: true,
        status: 'not_created',
        session: {
          enabled: false,
          reason: 'INVALID_SESSION_ID_FORMAT',
          message: `sessionId must be bytes32 (0x + 64 hex chars, got ${normalizedSessionId.length} chars)`,
        },
        mode: 'session',
        correlationId,
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

      // DEV-ONLY: Log router + chain diagnostics
      if (process.env.NODE_ENV !== 'production') {
        try {
          const chainId = await publicClient.getChainId();
          const routerCode = await publicClient.getBytecode({ address: EXECUTION_ROUTER_ADDRESS as `0x${string}` });
          const routerIsContract = routerCode && routerCode !== '0x' && routerCode.length > 2;
          
          logSessionTrace(correlationId, 'status:diagnostics', {
            chainId,
            routerAddress: EXECUTION_ROUTER_ADDRESS,
            routerIsContract,
            routerCodeLength: routerCode?.length || 0,
            sessionId: sessionId.substring(0, 10) + '...',
          });
        } catch (diagError: any) {
          // Ignore diagnostic errors
        }
      }

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
      ] as const;

      // DEV-ONLY: Log sessionId being queried
      if (process.env.NODE_ENV !== 'production') {
        logSessionTrace(correlationId, 'status:querying', {
          sessionId: sessionId.substring(0, 10) + '...',
          sessionIdLength: sessionId.length,
          routerAddress: EXECUTION_ROUTER_ADDRESS,
        });
      }

      const sessionResult = await Promise.race([
        publicClient.readContract({
          address: EXECUTION_ROUTER_ADDRESS as `0x${string}`,
          abi: sessionAbi,
          functionName: 'sessions',
          args: [normalizedSessionId as `0x${string}`],
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
      ]) as any;

      // Contract returns array, not object: [owner, executor, expiresAt, maxSpend, spent, active]
      const owner = sessionResult[0];
      const executor = sessionResult[1];
      const expiresAt = sessionResult[2];
      const maxSpend = sessionResult[3];
      const spent = sessionResult[4];
      const active = sessionResult[5];

      // DEV-ONLY: Log query result
      if (process.env.NODE_ENV !== 'production') {
        logSessionTrace(correlationId, 'status:queryResult', {
          active: active || false,
          owner: owner?.substring(0, 10) + '...' || 'none',
          expiresAt: expiresAt?.toString() || 'none',
        });
      }

      const now = BigInt(Math.floor(Date.now() / 1000));
      let status: 'not_created' | 'active' | 'expired' | 'revoked' = 'not_created';

      if (active) {
        if (expiresAt > now) {
          status = 'active';
        } else {
          status = 'expired';
        }
      } else if (owner !== '0x0000000000000000000000000000000000000000') {
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
    } catch (error: any) {
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
  } catch (error: any) {
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
    } else if (process.env.DEBUG_SESSION === 'true') {
      console.log('[api/session/status] POST request:', { userAddress, sessionId, EXECUTION_MODE, EXECUTION_AUTH_MODE });
    }

    // Task D: Check if session mode is properly configured (POST handler)
    const { RELAYER_PRIVATE_KEY: RELAYER_PRIVATE_KEY_POST, EXECUTION_ROUTER_ADDRESS: EXECUTION_ROUTER_ADDRESS_POST, ETH_TESTNET_RPC_URL: ETH_TESTNET_RPC_URL_POST } = await import('../config');
    const isSessionModeConfiguredPost = EXECUTION_MODE === 'eth_testnet' && EXECUTION_AUTH_MODE === 'session';
    const hasRequiredConfigPost = !!(RELAYER_PRIVATE_KEY_POST && EXECUTION_ROUTER_ADDRESS_POST && ETH_TESTNET_RPC_URL_POST);
    
    // In direct mode or sim mode, return enabled: false
    if (!isSessionModeConfiguredPost || !hasRequiredConfigPost) {
      const missing: string[] = [];
      if (!RELAYER_PRIVATE_KEY_POST) missing.push('RELAYER_PRIVATE_KEY');
      if (!EXECUTION_ROUTER_ADDRESS_POST) missing.push('EXECUTION_ROUTER_ADDRESS');
      if (!ETH_TESTNET_RPC_URL_POST) missing.push('ETH_TESTNET_RPC_URL');
      
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

    // VALIDATION: Ensure sessionId is valid bytes32 format (0x + 64 hex chars = 66 total)
    const normalizedSessionId = sessionId.startsWith('0x') ? sessionId : `0x${sessionId}`;
    if (normalizedSessionId.length !== 66) {
      const correlationId = req.correlationId || 'unknown';
      logSessionTrace(correlationId, 'status:error', {
        error: 'Invalid sessionId format',
        sessionIdLength: normalizedSessionId.length,
        expectedLength: 66,
        sessionId: normalizedSessionId.substring(0, 20) + '...',
      });
      return res.json({
        ok: true,
        status: 'not_created',
        session: {
          enabled: false,
          reason: 'INVALID_SESSION_ID_FORMAT',
          message: `sessionId must be bytes32 (0x + 64 hex chars, got ${normalizedSessionId.length} chars)`,
        },
        mode: 'session',
        correlationId,
        cooldownMs: SESSION_COOLDOWN_MS,
      });
    }

    const { EXECUTION_ROUTER_ADDRESS, ETH_TESTNET_RPC_URL } = await import('../config');
    const correlationId = req.correlationId || 'unknown';

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
      ] as const;

      // DEBUG: Log incoming sessionId for POST handler
      console.log('[session/status] POST Querying sessionId:', normalizedSessionId);
      console.log('[session/status] Contract address:', EXECUTION_ROUTER_ADDRESS);

      const sessionResult = await Promise.race([
        publicClient.readContract({
          address: EXECUTION_ROUTER_ADDRESS as `0x${string}`,
          abi: sessionAbi,
          functionName: 'sessions',
          args: [normalizedSessionId as `0x${string}`],
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
      ]) as any;

      // Contract returns array, not object: [owner, executor, expiresAt, maxSpend, spent, active]
      const owner = sessionResult[0];
      const executor = sessionResult[1];
      const expiresAt = sessionResult[2];
      const maxSpend = sessionResult[3];
      const spent = sessionResult[4];
      const active = sessionResult[5];

      const now = BigInt(Math.floor(Date.now() / 1000));
      let status: 'not_created' | 'active' | 'expired' | 'revoked' = 'not_created';

      // DEBUG: Log contract query result
      console.log('[session/status] Contract query result:', {
        owner,
        executor,
        expiresAt: expiresAt?.toString(),
        active,
        isOwnerZero: owner === '0x0000000000000000000000000000000000000000',
      });

      if (active) {
        if (expiresAt > now) {
          status = 'active';
        } else {
          status = 'expired';
        }
      } else if (owner !== '0x0000000000000000000000000000000000000000') {
        status = 'revoked';
      }

      // DEBUG: Log final status
      console.log('[session/status] Final status:', status);

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
    } catch (error: any) {
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
  } catch (error: any) {
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
 * POST /api/session/validate
 * Validate that a stored session is still active on-chain
 * Used by frontend to verify localStorage session is still valid before using
 */
app.post('/api/session/validate', asyncHandler(async (req, res) => {
  const { userAddress, sessionId } = req.body;

  if (!userAddress || !sessionId) {
    return res.json({ valid: false, reason: 'MISSING_FIELDS' });
  }

  try {
    const { EXECUTION_MODE, EXECUTION_AUTH_MODE, ETH_TESTNET_RPC_URL, EXECUTION_ROUTER_ADDRESS } = await import('../config');

    // Check if session mode is enabled
    if (EXECUTION_MODE !== 'eth_testnet' || EXECUTION_AUTH_MODE !== 'session') {
      return res.json({ valid: false, reason: 'SESSION_MODE_DISABLED' });
    }

    if (!ETH_TESTNET_RPC_URL || !EXECUTION_ROUTER_ADDRESS) {
      return res.json({ valid: false, reason: 'NOT_CONFIGURED' });
    }

    // Query on-chain session state
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
    ] as const;

    // Normalize sessionId
    const normalizedSessionId = sessionId.startsWith('0x') ? sessionId : `0x${sessionId}`;

    const sessionResult = await Promise.race([
      publicClient.readContract({
        address: EXECUTION_ROUTER_ADDRESS as `0x${string}`,
        abi: sessionAbi,
        functionName: 'sessions',
        args: [normalizedSessionId as `0x${string}`],
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('RPC timeout')), 5000)),
    ]) as [string, string, bigint, bigint, bigint, boolean];

    const [owner, executor, expiresAt, maxSpend, spent, active] = sessionResult;
    const now = Math.floor(Date.now() / 1000);
    const expiresAtNum = Number(expiresAt);

    // Check if session is valid
    if (!active) {
      return res.json({ valid: false, reason: 'SESSION_NOT_ACTIVE' });
    }

    if (expiresAtNum > 0 && expiresAtNum < now) {
      return res.json({ valid: false, reason: 'SESSION_EXPIRED' });
    }

    // Session is valid
    return res.json({
      valid: true,
      sessionId: normalizedSessionId,
      expiresAt: expiresAtNum,
      remainingMs: expiresAtNum > 0 ? (expiresAtNum - now) * 1000 : null,
      owner: owner.toLowerCase(),
      executor: executor.toLowerCase(),
    });
  } catch (error: any) {
    console.warn('[api/session/validate] Error validating session:', error.message);
    return res.json({
      valid: false,
      reason: error.message?.includes('timeout') ? 'RPC_ERROR' : 'VALIDATION_ERROR',
    });
  }
}));

/**
 * POST /api/session/validate-complete
 * Comprehensive validation: checks both session status AND token approval
 * Used to catch expired/missing approvals for existing users on app load
 */
app.post('/api/session/validate-complete', asyncHandler(async (req, res) => {
  const { userAddress, sessionId } = req.body;

  if (!userAddress || !sessionId) {
    return res.json({
      sessionValid: false,
      approvalValid: false,
      reason: 'MISSING_FIELDS',
    });
  }

  try {
    const {
      EXECUTION_MODE,
      EXECUTION_AUTH_MODE,
      ETH_TESTNET_RPC_URL,
      EXECUTION_ROUTER_ADDRESS,
      DEMO_REDACTED_ADDRESS,
    } = await import('../config');

    // Check if session mode is enabled
    if (EXECUTION_MODE !== 'eth_testnet' || EXECUTION_AUTH_MODE !== 'session') {
      return res.json({
        sessionValid: false,
        approvalValid: false,
        reason: 'SESSION_MODE_DISABLED',
      });
    }

    if (!ETH_TESTNET_RPC_URL || !EXECUTION_ROUTER_ADDRESS || !DEMO_REDACTED_ADDRESS) {
      return res.json({
        sessionValid: false,
        approvalValid: false,
        reason: 'NOT_CONFIGURED',
      });
    }

    // Setup viem client
    const { createPublicClient, http, encodeFunctionData } = await import('viem');
    const { sepolia } = await import('viem/chains');

    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http(ETH_TESTNET_RPC_URL),
    });

    // Normalize sessionId
    const normalizedSessionId = sessionId.startsWith('0x') ? sessionId : `0x${sessionId}`;

    // Define ABIs
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
    ] as const;

    const allowanceAbi = [
      {
        name: 'allowance',
        type: 'function',
        stateMutability: 'view',
        inputs: [
          { name: 'owner', type: 'address' },
          { name: 'spender', type: 'address' },
        ],
        outputs: [{ name: '', type: 'uint256' }],
      },
    ] as const;

    // Parallel on-chain validation calls with timeout
    const [sessionResult, allowanceResult] = await Promise.race([
      Promise.all([
        // Session validation
        publicClient.readContract({
          address: EXECUTION_ROUTER_ADDRESS as `0x${string}`,
          abi: sessionAbi,
          functionName: 'sessions',
          args: [normalizedSessionId as `0x${string}`],
        }),
        // Approval validation
        (async () => {
          const data = encodeFunctionData({
            abi: allowanceAbi,
            functionName: 'allowance',
            args: [userAddress as `0x${string}`, EXECUTION_ROUTER_ADDRESS.trim() as `0x${string}`],
          });
          return publicClient.call({
            to: DEMO_REDACTED_ADDRESS as `0x${string}`,
            data: data as `0x${string}`,
          });
        })(),
      ]),
      new Promise((_, reject) => setTimeout(() => reject(new Error('RPC timeout')), 5000)),
    ]) as [
      [string, string, bigint, bigint, bigint, boolean],
      { data?: `0x${string}` }
    ];

    // Process session validation
    const [owner, executor, expiresAt, maxSpend, spent, active] = sessionResult;
    const now = Math.floor(Date.now() / 1000);
    const expiresAtNum = Number(expiresAt);

    let sessionValid = true;
    let sessionReason = null;

    if (!active) {
      sessionValid = false;
      sessionReason = 'SESSION_NOT_ACTIVE';
    } else if (expiresAtNum > 0 && expiresAtNum < now) {
      sessionValid = false;
      sessionReason = 'SESSION_EXPIRED';
    }

    // Process approval validation
    const allowance = allowanceResult.data ? BigInt(allowanceResult.data) : 0n;
    const approvalValid = allowance > 0n;

    // Return comprehensive validation result
    return res.json({
      sessionValid,
      sessionReason,
      sessionId: normalizedSessionId,
      sessionActive: active,
      sessionExpired: expiresAtNum > 0 && expiresAtNum < now,
      expiresAt: expiresAtNum,
      remainingMs: expiresAtNum > 0 ? (expiresAtNum - now) * 1000 : null,
      owner: owner.toLowerCase(),
      executor: executor.toLowerCase(),
      approvalValid,
      allowance: allowance.toString(),
      needsApproval: !approvalValid,
      tokenAddress: DEMO_REDACTED_ADDRESS,
      spenderAddress: EXECUTION_ROUTER_ADDRESS.trim(),
    });
  } catch (error: any) {
    console.warn('[api/session/validate-complete] Error:', error.message);
    return res.json({
      sessionValid: false,
      approvalValid: false,
      reason: error.message?.includes('timeout') ? 'RPC_ERROR' : 'VALIDATION_ERROR',
      error: error.message,
    });
  }
}));

/**
 * GET /api/debug/session (read-only, gated by DEBUG_DIAGNOSTICS=true)
 * Returns session config and optional on-chain session presence. No secrets; only boolean flags and prefixes.
 * Session state (enabledKey, authorizedKey, sessionId) lives in client localStorage; server cannot see it unless
 * caller passes ?sessionId=...&userAddress=... for a redacted on-chain check.
 */
if (process.env.DEBUG_DIAGNOSTICS === 'true') {
  app.get('/api/debug/session', async (req, res) => {
    try {
      const { EXECUTION_MODE, EXECUTION_AUTH_MODE, EXECUTION_ROUTER_ADDRESS, ETH_TESTNET_RPC_URL } = await import('../config');
      const sessionEnabled = EXECUTION_MODE === 'eth_testnet' && EXECUTION_AUTH_MODE === 'session';
      const sessionId = typeof req.query?.sessionId === 'string' ? req.query.sessionId.trim() : null;
      const userAddress = typeof req.query?.userAddress === 'string' ? req.query.userAddress.trim().toLowerCase() : null;

      const base: Record<string, unknown> = {
        ok: true,
        executionMode: EXECUTION_MODE,
        authMode: EXECUTION_AUTH_MODE,
        sessionEnabled,
        serverSeesSession: false,
        note: 'Session state is client-side (localStorage). Server cannot see it. Pass ?sessionId=0x...&userAddress=0x... for redacted on-chain check.',
      };

      if (!sessionId && !userAddress) {
        return res.json(base);
      }

      const sessionIdPrefix = sessionId ? sessionId.slice(0, 8) : null;
      const addressPrefix = userAddress ? userAddress.slice(0, 8) : null;
      base.enabledKeyPrefix = userAddress ? `blossom_oneclick_${userAddress.slice(0, 8)}` : null;
      base.authorizedKeyPrefix = userAddress ? `blossom_oneclick_auth_${userAddress.slice(0, 8)}` : null;
      base.sessionIdPrefix = sessionIdPrefix;

      if (!sessionId || sessionId.length !== 66 || !sessionId.startsWith('0x')) {
        base.hasSession = null;
        base.sessionCheckNote = 'sessionId missing or invalid format (need 0x + 64 hex).';
        return res.json(base);
      }

      if (!ETH_TESTNET_RPC_URL || !EXECUTION_ROUTER_ADDRESS) {
        base.hasSession = null;
        base.sessionCheckNote = 'RPC or router not configured; cannot check on-chain.';
        return res.json(base);
      }

      try {
        const { createPublicClient, http } = await import('viem');
        const { sepolia } = await import('viem/chains');
        const publicClient = createPublicClient({
          chain: sepolia,
          transport: http(ETH_TESTNET_RPC_URL),
        });
        const sessionAbi = [
          { name: 'sessions', type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'bytes32' }], outputs: [
            { name: 'owner', type: 'address' }, { name: 'executor', type: 'address' }, { name: 'expiresAt', type: 'uint64' },
            { name: 'maxSpend', type: 'uint256' }, { name: 'spent', type: 'uint256' }, { name: 'active', type: 'bool' },
          ] },
        ] as const;
        const normalizedSessionId = sessionId.startsWith('0x') ? sessionId : `0x${sessionId}`;
        const sessionResult = await Promise.race([
          publicClient.readContract({
            address: EXECUTION_ROUTER_ADDRESS as `0x${string}`,
            abi: sessionAbi,
            functionName: 'sessions',
            args: [normalizedSessionId as `0x${string}`],
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
        ]) as [string, string, bigint, bigint, bigint, boolean];
        const [, , expiresAt, , , active] = sessionResult;
        const now = BigInt(Math.floor(Date.now() / 1000));
        const hasSession = active && expiresAt > now;
        base.hasSession = hasSession;
        base.serverSeesSession = hasSession;
        base.sessionCheckNote = hasSession ? 'on-chain session active and not expired' : (active ? 'on-chain session expired' : 'no on-chain session for this sessionId');
      } catch (onChainErr: any) {
        base.hasSession = null;
        base.serverSeesSession = false;
        base.sessionCheckNote = `on-chain check failed: ${onChainErr?.message || String(onChainErr)}`;
      }

      return res.json(base);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String((e as Error).message) });
    }
  });
}

/**
 * POST /api/session/validate-complete
 * Validate both session existence AND token approval in one call
 * Catches cases where localStorage shows authorized but approval expired
 */
app.post('/api/session/validate-complete', async (req, res) => {
  try {
    const { sessionId, userAddress } = req.body;

    if (!sessionId || !userAddress) {
      return res.status(400).json({
        ok: false,
        error: 'sessionId and userAddress are required',
      });
    }

    const { EXECUTION_ROUTER_ADDRESS, DEMO_REDACTED_ADDRESS, ETH_TESTNET_RPC_URL, EXECUTION_MODE, EXECUTION_AUTH_MODE } = await import('../config');

    // Check if session mode is enabled
    if (EXECUTION_MODE !== 'eth_testnet' || EXECUTION_AUTH_MODE !== 'session') {
      return res.json({
        ok: true,
        sessionValid: false,
        approvalValid: false,
        reason: 'Session mode not enabled',
      });
    }

    if (!EXECUTION_ROUTER_ADDRESS || !ETH_TESTNET_RPC_URL) {
      return res.json({
        ok: true,
        sessionValid: false,
        approvalValid: false,
        reason: 'Router not configured',
      });
    }

    // Parallel validation: session + approval
    const validationPromises: Promise<any>[] = [];

    // 1. Session validation
    const sessionPromise = (async () => {
      try {
        const { encodeFunctionData, createPublicClient, http } = await import('viem');
        const { sepolia } = await import('viem/chains');

        const publicClient = createPublicClient({
          chain: sepolia,
          transport: http(ETH_TESTNET_RPC_URL),
        });

        const getSessionAbi = [
          {
            name: 'getSession',
            type: 'function',
            stateMutability: 'view',
            inputs: [{ name: 'sessionId', type: 'bytes32' }],
            outputs: [
              {
                name: '',
                type: 'tuple',
                components: [
                  { name: 'owner', type: 'address' },
                  { name: 'executor', type: 'address' },
                  { name: 'expiresAt', type: 'uint64' },
                  { name: 'maxSpend', type: 'uint256' },
                  { name: 'spent', type: 'uint256' },
                  { name: 'maxSpendPerTx', type: 'uint256' },
                  { name: 'active', type: 'bool' },
                  { name: 'revoked', type: 'bool' },
                ],
              },
            ],
          },
        ] as const;

        const data = encodeFunctionData({
          abi: getSessionAbi,
          functionName: 'getSession',
          args: [sessionId as `0x${string}`],
        });

        const result = await Promise.race([
          publicClient.call({
            to: EXECUTION_ROUTER_ADDRESS.trim() as `0x${string}`,
            data: data as `0x${string}`,
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Session check timeout')), 3000)),
        ]) as any;

        if (!result.data || result.data === '0x' || result.data.length < 10) {
          return { sessionValid: false, reason: 'Session not found' };
        }

        const { decodeAbiParameters } = await import('viem');
        const decoded = decodeAbiParameters(getSessionAbi[0].outputs, result.data);
        const session = decoded[0];

        const now = BigInt(Math.floor(Date.now() / 1000));
        const isActive = session.active && !session.revoked;
        const isExpired = session.expiresAt < now;
        const ownerMatches = session.owner.toLowerCase() === userAddress.toLowerCase();

        return {
          sessionValid: isActive && !isExpired && ownerMatches,
          sessionActive: isActive,
          sessionExpired: isExpired,
          sessionOwner: session.owner,
        };
      } catch (error: any) {
        console.warn('[validate-complete] Session check failed:', error.message);
        return { sessionValid: false, reason: error.message };
      }
    })();

    validationPromises.push(sessionPromise);

    // 2. Approval validation
    const approvalPromise = (async () => {
      if (!DEMO_REDACTED_ADDRESS) {
        return { approvalValid: false, reason: 'Token address not configured' };
      }

      try {
        const { encodeFunctionData, createPublicClient, http } = await import('viem');
        const { sepolia } = await import('viem/chains');

        const publicClient = createPublicClient({
          chain: sepolia,
          transport: http(ETH_TESTNET_RPC_URL),
        });

        const allowanceAbi = [
          {
            name: 'allowance',
            type: 'function',
            stateMutability: 'view',
            inputs: [
              { name: 'owner', type: 'address' },
              { name: 'spender', type: 'address' },
            ],
            outputs: [{ name: '', type: 'uint256' }],
          },
        ] as const;

        const data = encodeFunctionData({
          abi: allowanceAbi,
          functionName: 'allowance',
          args: [userAddress as `0x${string}`, EXECUTION_ROUTER_ADDRESS.trim() as `0x${string}`],
        });

        const result = await Promise.race([
          publicClient.call({
            to: DEMO_REDACTED_ADDRESS as `0x${string}`,
            data: data as `0x${string}`,
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Approval check timeout')), 3000)),
        ]) as any;

        const allowance = result.data ? BigInt(result.data) : 0n;
        const hasApproval = allowance > 0n;

        return {
          approvalValid: hasApproval,
          allowance: allowance.toString(),
          tokenAddress: DEMO_REDACTED_ADDRESS,
          spenderAddress: EXECUTION_ROUTER_ADDRESS.trim(),
        };
      } catch (error: any) {
        console.warn('[validate-complete] Approval check failed:', error.message);
        return { approvalValid: false, reason: error.message };
      }
    })();

    validationPromises.push(approvalPromise);

    // Wait for both checks
    const [sessionResult, approvalResult] = await Promise.all(validationPromises);

    res.json({
      ok: true,
      ...sessionResult,
      ...approvalResult,
      needsApproval: !approvalResult.approvalValid,
    });
  } catch (error: any) {
    console.error('[api/session/validate-complete] Error:', error);
    res.status(500).json({
      ok: false,
      error: 'Validation failed',
      details: error.message,
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
    ] as const;

    const data = encodeFunctionData({
      abi: revokeSessionAbi,
      functionName: 'revokeSession',
      args: [sessionId as `0x${string}`],
    });

    res.json({
      to: EXECUTION_ROUTER_ADDRESS,
      data,
      value: '0x0',
      summary: `Revoke session ${sessionId.substring(0, 10)}...`,
    });
  } catch (error: any) {
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
  } catch (error: any) {
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
    ] as const;

    // Convert amount to bigint (handle hex or decimal string)
    const amountBigInt = typeof amount === 'string' && amount.startsWith('0x')
      ? BigInt(amount)
      : BigInt(amount);

    const data = encodeFunctionData({
      abi: approveAbi,
      functionName: 'approve',
      args: [spender as `0x${string}`, amountBigInt],
    });

    res.json({
      chainId: 11155111, // Sepolia
      to: token,
      data,
      value: '0x0',
      summary: `Approve ${spender.substring(0, 10)}... to spend tokens`,
    });
  } catch (error: any) {
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

    const jsonResult: unknown = await receiptResponse.json();
    const receiptResult = jsonResult as JsonRpcResponse<{
      status?: string;
      blockNumber?: string;
      gasUsed?: string;
      to?: string;
      from?: string;
    } | null>;
    
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
    let status: 'confirmed' | 'reverted';
    
    if (statusHex === '0x1' || statusHex === '0x01') {
      status = 'confirmed';
    } else if (statusHex === '0x0' || statusHex === '0x00') {
      status = 'reverted';
    } else {
      // Unknown status, treat as pending
      return res.json({
        status: 'pending',
        txHash,
      });
    }

    // Build response
    const response: any = {
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
  } catch (error: any) {
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

    const ethResultUnknown: unknown = await ethBalanceResponse.json();
    const ethResult = ethResultUnknown as JsonRpcResponse<string>;
    
    if (ethResult.error) {
      throw new Error(`RPC error: ${ethResult.error.message || JSON.stringify(ethResult.error)}`);
    }

    const ethWei = BigInt(ethResult.result || '0x0');
    const { formatUnits } = await import('viem');
    const ethUi = formatUnits(ethWei, 18);
    const ethNum = Number(ethUi);
    const ethFormatted = Number.isFinite(ethNum) ? ethNum.toFixed(6) : ethUi;

    // Fetch REDACTED balance
    const { erc20_decimals } = await import('../executors/erc20Rpc');
    const usdcBalance = await erc20_balanceOf(REDACTED_ADDRESS_SEPOLIA, userAddress);
    let usdcDecimals = 6;
    try {
      usdcDecimals = await erc20_decimals(REDACTED_ADDRESS_SEPOLIA);
    } catch {
      // Fallback to 6 decimals for stable tokens
    }
    const usdcUi = formatUnits(usdcBalance, usdcDecimals);
    const usdcNum = Number(usdcUi);
    const usdcFormatted = Number.isFinite(usdcNum) ? usdcNum.toFixed(2) : usdcUi;

    // Fetch WETH balance
    const wethBalance = await erc20_balanceOf(WETH_ADDRESS_SEPOLIA, userAddress);
    let wethDecimals = 18;
    try {
      wethDecimals = await erc20_decimals(WETH_ADDRESS_SEPOLIA);
    } catch {
      // Fallback to 18 decimals for WETH
    }
    const wethUi = formatUnits(wethBalance, wethDecimals);
    const wethNum = Number(wethUi);
    const wethFormatted = Number.isFinite(wethNum) ? wethNum.toFixed(6) : wethUi;

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
          decimals: usdcDecimals,
          formatted: usdcFormatted,
        },
        weth: {
          raw: '0x' + wethBalance.toString(16),
          decimals: wethDecimals,
          formatted: wethFormatted,
        },
      },
    });
  } catch (error: any) {
    console.error('[api/portfolio/eth_testnet] Error:', error);
    res.status(500).json({
      error: 'Failed to fetch portfolio balances',
      message: error.message,
    });
  }
});

/**
 * GET /api/defi/aave/positions
 * Read Aave positions (aToken balances) for a user
 */
app.get('/api/defi/aave/positions', maybeCheckAccess, async (req, res) => {
  const userAddress = typeof req.query.userAddress === 'string' ? req.query.userAddress : null;
  
  try {
    if (!userAddress) {
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

    const { readAavePositions } = await import('../defi/aave/positions');
    const positions = await readAavePositions(userAddress as `0x${string}`);

    // Ensure stable schema: always return positions array (empty if no positions)
    // Never return 500 for "no position" case - empty array is valid
    res.json({
      ok: true,
      chainId: 11155111, // Sepolia
      userAddress,
      positions: Array.isArray(positions) ? positions : [],
      timestamp: Date.now(),
    });
  } catch (error: any) {
    console.error('[api/defi/aave/positions] Error:', error);
    // Never 500 for "no position" - return empty array instead
    // Only 500 for actual server errors (config missing, RPC down, etc.)
    const isServerError = error.message?.includes('not configured') || 
                          error.message?.includes('RPC') ||
                          error.message?.includes('ETH_TESTNET_RPC_URL');
    
    if (isServerError) {
      res.status(500).json({
        ok: false,
        error: error.message || 'Failed to read Aave positions',
      });
    } else {
      // For other errors (e.g., asset not found, aToken fetch failed), return empty array
      // This ensures stable schema and no 500s for "no position" case
      res.json({
        ok: true,
        chainId: 11155111,
        userAddress: userAddress || 'unknown',
        positions: [],
        timestamp: Date.now(),
      });
    }
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
    const { 
      EXECUTION_MODE,
      ETH_TESTNET_RPC_URL, 
      ETH_TESTNET_CHAIN_ID,
      DEMO_REDACTED_ADDRESS, 
      DEMO_WETH_ADDRESS 
    } = await import('../config');

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
    const tokens: Array<{ address: string; symbol: string; decimals: number; raw: string; formatted: string }> = [];
    const notes: string[] = [];

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
        const ethResultUnknown: unknown = await ethBalanceResponse.json();
        const ethResult = ethResultUnknown as JsonRpcResponse<string>;
        if (!ethResult.error && ethResult.result) {
          ethWei = BigInt(ethResult.result);
        } else if (ethResult.error) {
          throw new Error(`RPC error: ${ethResult.error.message || JSON.stringify(ethResult.error)}`);
        }
      } else {
        throw new Error(`RPC HTTP error: ${ethBalanceResponse.status} ${ethBalanceResponse.statusText}`);
      }
    } catch (e: any) {
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
        const { erc20_balanceOf, erc20_decimals } = await import('../executors/erc20Rpc');
        const { formatUnits } = await import('viem');
        const balance = await erc20_balanceOf(DEMO_REDACTED_ADDRESS, address);
        let decimals = 6;
        try {
          const fetched = await erc20_decimals(DEMO_REDACTED_ADDRESS);
          // Stable fallback guard: if token metadata is invalid, preserve 6-decimal stable assumption.
          decimals = Number.isFinite(fetched) && fetched > 0 && fetched <= 18 ? fetched : 6;
        } catch {
          // Fallback to 6 decimals for stable tokens
        }
        const ui = formatUnits(balance, decimals);
        tokens.push({
          address: DEMO_REDACTED_ADDRESS,
          symbol: 'REDACTED',
          decimals,
          raw: '0x' + balance.toString(16),
          formatted: ui,
        });
      } catch (e: any) {
        notes.push(`REDACTED balance fetch failed: ${e.message}`);
      }
    } else {
      notes.push('DEMO_REDACTED_ADDRESS not configured');
    }

    if (DEMO_WETH_ADDRESS) {
      try {
        const { erc20_balanceOf, erc20_decimals } = await import('../executors/erc20Rpc');
        const { formatUnits } = await import('viem');
        const balance = await erc20_balanceOf(DEMO_WETH_ADDRESS, address);
        let decimals = 18;
        try {
          const fetched = await erc20_decimals(DEMO_WETH_ADDRESS);
          decimals = Number.isFinite(fetched) && fetched > 0 && fetched <= 18 ? fetched : 18;
        } catch {
          // Fallback to 18 decimals for WETH
        }
        const ui = formatUnits(balance, decimals);
        tokens.push({
          address: DEMO_WETH_ADDRESS,
          symbol: 'WETH',
          decimals,
          raw: '0x' + balance.toString(16),
          formatted: ui,
        });
      } catch (e: any) {
        notes.push(`WETH balance fetch failed: ${e.message}`);
      }
    } else {
      notes.push('DEMO_WETH_ADDRESS not configured');
    }

    const { formatUnits } = await import('viem');
    const ethUi = formatUnits(ethWei, 18);
    const ethNum = Number(ethUi);
    const ethFormatted = Number.isFinite(ethNum) ? ethNum.toFixed(6) : ethUi;

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
  } catch (error: any) {
    console.error('[api/wallet/balances] Error:', error);
    res.status(500).json({
      error: 'Failed to fetch wallet balances',
      message: error.message,
    });
  }
});

/**
 * GET /api/demo/config
 * Returns demo faucet configuration status
 */
app.get('/api/demo/config', async (req, res) => {
  try {
    const { EXECUTION_MODE, DEMO_BUSDC_ADDRESS, DEMO_REDACTED_ADDRESS, DEMO_WETH_ADDRESS } = await import('../config');
    const stableAddress = DEMO_BUSDC_ADDRESS || DEMO_REDACTED_ADDRESS;

    const missing: string[] = [];
    if (!stableAddress) missing.push('DEMO_BUSDC_ADDRESS');
    if (!DEMO_WETH_ADDRESS) missing.push('DEMO_WETH_ADDRESS');

    res.json({
      ok: true,
      configured: missing.length === 0 && EXECUTION_MODE === 'eth_testnet',
      executionMode: EXECUTION_MODE,
      missing: missing
    });
  } catch (error: any) {
    console.error('[api/demo/config] Error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to check demo config'
    });
  }
});

/**
 * POST /api/demo/faucet
 * Mints demo tokens (bUSDC and WETH) to a user address
 * Only available in eth_testnet mode
 */
app.post('/api/demo/faucet', maybeCheckAccess, async (req, res) => {
  try {
    const { EXECUTION_MODE, DEMO_BUSDC_ADDRESS, DEMO_REDACTED_ADDRESS, DEMO_WETH_ADDRESS } = await import('../config');
    const stableAddress = DEMO_BUSDC_ADDRESS || DEMO_REDACTED_ADDRESS;

    // Only allow in testnet mode
    if (EXECUTION_MODE !== 'eth_testnet') {
      return res.status(400).json({
        ok: false,
        error: 'Faucet only available in eth_testnet mode'
      });
    }

    // Validate demo token addresses are configured
    if (!stableAddress || !DEMO_WETH_ADDRESS) {
      const missing: string[] = [];
      if (!stableAddress) missing.push('DEMO_BUSDC_ADDRESS');
      if (!DEMO_WETH_ADDRESS) missing.push('DEMO_WETH_ADDRESS');

      return res.status(503).json({
        ok: false,
        error: 'Faucet not configured',
        missing: missing
      });
    }

    const { userAddress } = req.body;

    if (!userAddress || typeof userAddress !== 'string') {
      return res.status(400).json({
        ok: false,
        error: 'userAddress is required'
      });
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/i.test(userAddress)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid userAddress format'
      });
    }

    console.log(`[api/demo/faucet] Minting tokens to ${userAddress}...`);

    // Import minting utility
    const { mintDemoTokens } = await import('../utils/demoTokenMinter');

    const result = await mintDemoTokens(userAddress);

    console.log(`[api/demo/faucet] Successfully minted tokens:`, result);

    res.json({
      ok: true,
      success: true,
      txHashes: result.txHashes,
      amounts: result.amounts
    });
  } catch (error: any) {
    console.error('[api/demo/faucet] Error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to mint demo tokens',
      details: error.message
    });
  }
});

/**
 * POST /api/mint-busdc
 * Alias for /api/mint - Mint bUSDC for testnet use
 * Endpoint name requested by QuickStartPanel UI
 */
function normalizeMintChain(raw?: string): 'ethereum' | 'solana' | 'hyperliquid' {
  if (!raw) return 'ethereum';
  const normalized = raw.toLowerCase();
  if (['sol', 'solana', 'devnet'].includes(normalized)) return 'solana';
  if (['hl', 'hyperliquid', 'hyperliquid_testnet'].includes(normalized)) return 'hyperliquid';
  if (['eth', 'ethereum', 'sepolia'].includes(normalized)) return 'ethereum';
  return 'ethereum';
}

function isValidMintAddress(chain: 'ethereum' | 'solana' | 'hyperliquid', address: string): boolean {
  if (chain === 'solana') {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  }
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

app.post('/api/mint-busdc', mintRateLimit, maybeCheckAccess, async (req, res) => {
  try {
    const { EXECUTION_MODE } = await import('../config');

    if (EXECUTION_MODE !== 'eth_testnet') {
      return res.status(400).json({
        ok: false,
        error: 'Mint only available in eth_testnet mode'
      });
    }

    const { userAddress, amount, chain, recipientAddress, solanaAddress } = req.body || {};
    const targetChain = normalizeMintChain(chain);
    const settlementChain = resolveExecutionSettlementChain(
      String(req.body?.toChain || req.body?.settlementChain || process.env.DEFAULT_SETTLEMENT_CHAIN || 'base_sepolia')
    );
    const targetAddress =
      targetChain === 'solana'
        ? (solanaAddress || recipientAddress || userAddress)
        : (userAddress || recipientAddress);

    if (!targetAddress || typeof targetAddress !== 'string') {
      return res.status(400).json({
        ok: false,
        error: 'userAddress is required'
      });
    }

    if (!isValidMintAddress(targetChain, targetAddress)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid userAddress format'
      });
    }

    // Default to random 100-500 bUSDC if not provided
    const defaultAmount = Math.floor(100 + Math.random() * 401);
    const amountNum = Number(amount ?? defaultAmount);
    if (!Number.isFinite(amountNum) || amountNum <= 0 || amountNum > 10000) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid amount (must be 1-10000)'
      });
    }

    const limitCheck = await checkAndRecordMint(targetAddress, amountNum, targetChain);
    if (!limitCheck.ok) {
      return res.status(429).json({
        ok: false,
        error: 'Daily mint limit exceeded',
        remaining: limitCheck.remaining,
        cap: limitCheck.cap
      });
    }

    console.log(`[api/mint-busdc] Minting ${amountNum} bUSDC to ${targetAddress} on ${targetChain}...`);

    let txHash: string | undefined;
    let signature: string | undefined;
    let explorerUrl: string | undefined;

    if (targetChain === 'solana') {
      const { mintSolanaBusdc } = await import('../utils/solanaBusdcMinter');
      const result = await mintSolanaBusdc(targetAddress, amountNum);
      signature = result.signature;
      explorerUrl = result.explorerUrl;
    } else if (targetChain === 'hyperliquid') {
      const { mintHyperliquidBusdc } = await import('../utils/hyperliquidBusdcMinter');
      const result = await mintHyperliquidBusdc(targetAddress, amountNum);
      txHash = result.txHash;
    } else {
      const { mintBusdc } = await import('../utils/demoTokenMinter');
      const result = await mintBusdc(targetAddress, amountNum, { chain: settlementChain });
      txHash = result.txHash;
    }

    console.log(`[api/mint-busdc] Success: ${txHash || signature}`);

    res.json({
      ok: true,
      success: true,
      chain: targetChain === 'ethereum' ? settlementChain : targetChain,
      txHash,
      signature,
      explorerUrl,
      amount: amountNum,
      remaining: limitCheck.remaining,
      message: `Minted ${amountNum} bUSDC to your wallet`
    });
  } catch (error: any) {
    console.error('[api/mint-busdc] Error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to mint bUSDC',
      details: error.message
    });
  }
});

/**
 * POST /api/mint
 * Mint bUSDC for testnet use with a daily cap (default 1000/day)
 */
app.post('/api/mint', mintRateLimit, maybeCheckAccess, async (req, res) => {
  try {
    const { EXECUTION_MODE } = await import('../config');

    if (EXECUTION_MODE !== 'eth_testnet') {
      return res.status(400).json({
        ok: false,
        error: 'Mint only available in eth_testnet mode'
      });
    }

    const { userAddress, amount, chain, recipientAddress, solanaAddress } = req.body || {};
    const targetChain = normalizeMintChain(chain);
    const settlementChain = resolveExecutionSettlementChain(
      String(req.body?.toChain || req.body?.settlementChain || process.env.DEFAULT_SETTLEMENT_CHAIN || 'base_sepolia')
    );
    const targetAddress =
      targetChain === 'solana'
        ? (solanaAddress || recipientAddress || userAddress)
        : (userAddress || recipientAddress);

    if (!targetAddress || typeof targetAddress !== 'string') {
      return res.status(400).json({
        ok: false,
        error: 'userAddress is required'
      });
    }

    if (!isValidMintAddress(targetChain, targetAddress)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid userAddress format'
      });
    }

    const defaultAmount = Math.floor(100 + Math.random() * 401);
    const amountNum = Number(amount ?? defaultAmount);
    if (!Number.isFinite(amountNum) || amountNum <= 0 || amountNum > 10000) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid amount (must be 1-10000)'
      });
    }

    const limitCheck = await checkAndRecordMint(targetAddress, amountNum, targetChain);
    if (!limitCheck.ok) {
      return res.status(429).json({
        ok: false,
        error: 'Daily mint limit exceeded',
        remaining: limitCheck.remaining,
        cap: limitCheck.cap
      });
    }

    console.log(`[api/mint] Minting ${amountNum} bUSDC to ${targetAddress} on ${targetChain}...`);

    let txHash: string | undefined;
    let signature: string | undefined;
    let explorerUrl: string | undefined;

    if (targetChain === 'solana') {
      const { mintSolanaBusdc } = await import('../utils/solanaBusdcMinter');
      const result = await mintSolanaBusdc(targetAddress, amountNum);
      signature = result.signature;
      explorerUrl = result.explorerUrl;
    } else if (targetChain === 'hyperliquid') {
      const { mintHyperliquidBusdc } = await import('../utils/hyperliquidBusdcMinter');
      const result = await mintHyperliquidBusdc(targetAddress, amountNum);
      txHash = result.txHash;
    } else {
      const { mintBusdc } = await import('../utils/demoTokenMinter');
      const result = await mintBusdc(targetAddress, amountNum, { chain: settlementChain });
      txHash = result.txHash;
    }

    res.json({
      ok: true,
      success: true,
      chain: targetChain === 'ethereum' ? settlementChain : targetChain,
      txHash,
      signature,
      explorerUrl,
      amount: amountNum,
      remaining: limitCheck.remaining
    });
  } catch (error: any) {
    console.error('[api/mint] Error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to mint bUSDC',
      details: error.message
    });
  }
});

/**
 * GET /api/demo/relayer
 * Returns the relayer address (for automated testing scripts)
 */
app.get('/api/demo/relayer', maybeCheckAccess, async (req, res) => {
  try {
    const { RELAYER_PRIVATE_KEY, EXECUTION_ROUTER_ADDRESS } = await import('../config');

    if (!RELAYER_PRIVATE_KEY) {
      return res.status(503).json({
        ok: false,
        error: 'Relayer not configured',
      });
    }

    const { privateKeyToAccount } = await import('viem/accounts');
    const relayerAccount = privateKeyToAccount(RELAYER_PRIVATE_KEY as `0x${string}`);

    res.json({
      ok: true,
      relayerAddress: relayerAccount.address.toLowerCase(),
      routerAddress: EXECUTION_ROUTER_ADDRESS?.toLowerCase(),
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: 'Failed to get relayer info',
      details: error.message,
    });
  }
});

/**
 * POST /api/demo/execute-direct
 * Execute a plan directly via executeBySender (for automated testing)
 * This endpoint bypasses session requirements and sends tx directly from relayer
 * ONLY enabled in non-production environments
 */
app.post('/api/demo/execute-direct', maybeCheckAccess, async (req, res) => {
  try {
    // Safety: Only allow in development/testing or with explicit flag
    const nodeEnv = process.env.NODE_ENV;
    const allowDirect = (process.env.ALLOW_DIRECT_EXECUTION || '').trim();
    console.log('[api/demo/execute-direct] ENV check:', { nodeEnv, allowDirect });

    if (nodeEnv === 'production' && allowDirect !== 'true') {
      return res.status(403).json({
        ok: false,
        error: 'Direct execution not allowed in production without ALLOW_DIRECT_EXECUTION=true',
      });
    }

    const { EXECUTION_MODE, EXECUTION_ROUTER_ADDRESS, ETH_TESTNET_RPC_URL, RELAYER_PRIVATE_KEY } = await import('../config');

    if (EXECUTION_MODE !== 'eth_testnet') {
      return res.status(400).json({
        ok: false,
        error: 'Direct execution only available in eth_testnet mode',
      });
    }

    if (!EXECUTION_ROUTER_ADDRESS || !ETH_TESTNET_RPC_URL || !RELAYER_PRIVATE_KEY) {
      return res.status(503).json({
        ok: false,
        error: 'Direct execution not configured',
        missing: [
          !EXECUTION_ROUTER_ADDRESS && 'EXECUTION_ROUTER_ADDRESS',
          !ETH_TESTNET_RPC_URL && 'ETH_TESTNET_RPC_URL',
          !RELAYER_PRIVATE_KEY && 'RELAYER_PRIVATE_KEY',
        ].filter(Boolean),
      });
    }

    const { plan, userAddress, useRelayerAsUser } = req.body;

    if (!plan) {
      return res.status(400).json({
        ok: false,
        error: 'plan is required',
      });
    }

    // Validate plan structure
    if (!plan.user || !plan.nonce || !plan.deadline || !Array.isArray(plan.actions) || plan.actions.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid plan structure',
        required: ['user', 'nonce', 'deadline', 'actions[]'],
      });
    }

    // Import viem for encoding
    const { createWalletClient, createPublicClient, http, encodeFunctionData } = await import('viem');
    const { sepolia } = await import('viem/chains');
    const { privateKeyToAccount } = await import('viem/accounts');

    // Create relayer account to get address
    const relayerAccount = privateKeyToAccount(RELAYER_PRIVATE_KEY as `0x${string}`);
    const relayerAddress = relayerAccount.address.toLowerCase();

    // If useRelayerAsUser is true, override plan.user with relayer address
    // This allows testing execution without session
    let effectivePlan = { ...plan };
    if (useRelayerAsUser) {
      console.log('[api/demo/execute-direct] Using relayer as plan user for testing');
      effectivePlan.user = relayerAddress;
    }

    // Validate plan.user matches sender (relayer) for executeBySender
    if (effectivePlan.user.toLowerCase() !== relayerAddress) {
      return res.status(400).json({
        ok: false,
        error: 'executeBySender requires plan.user to match sender. Set useRelayerAsUser=true for testing.',
        planUser: effectivePlan.user,
        relayerAddress,
      });
    }

    console.log('[api/demo/execute-direct] Executing plan for', effectivePlan.user);
    console.log('[api/demo/execute-direct] Plan:', {
      user: effectivePlan.user,
      nonce: effectivePlan.nonce,
      deadline: effectivePlan.deadline,
      actionsCount: effectivePlan.actions.length,
    });

    // executeBySender ABI
    const executeBySenderAbi = [
      {
        name: 'executeBySender',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
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
    ] as const;

    // Encode the call with effectivePlan
    const data = encodeFunctionData({
      abi: executeBySenderAbi,
      functionName: 'executeBySender',
      args: [
        {
          user: effectivePlan.user as `0x${string}`,
          nonce: BigInt(effectivePlan.nonce),
          deadline: BigInt(effectivePlan.deadline),
          actions: effectivePlan.actions.map((a: any) => ({
            actionType: a.actionType,
            adapter: a.adapter as `0x${string}`,
            data: a.data as `0x${string}`,
          })),
        },
      ],
    });

    console.log('[api/demo/execute-direct] Encoded data length:', data.length);

    // Create clients (reuse relayerAccount)
    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http(ETH_TESTNET_RPC_URL),
    });
    const walletClient = createWalletClient({
      account: relayerAccount,
      chain: sepolia,
      transport: http(ETH_TESTNET_RPC_URL),
    });

    // Handle approval requirements if provided in request
    const approvalRequirements = req.body.approvalRequirements || [];
    const approvalTxHashes: string[] = [];

    if (useRelayerAsUser && approvalRequirements.length > 0) {
      console.log('[api/demo/execute-direct] Processing', approvalRequirements.length, 'approval(s)...');

      const approveAbi = [
        {
          name: 'approve',
          type: 'function',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'spender', type: 'address' },
            { name: 'amount', type: 'uint256' },
          ],
          outputs: [{ type: 'bool' }],
        },
      ] as const;

      for (const approval of approvalRequirements) {
        const { token, spender, amount } = approval;
        console.log('[api/demo/execute-direct] Approving', token, 'for', spender);

        const approveData = encodeFunctionData({
          abi: approveAbi,
          functionName: 'approve',
          args: [spender as `0x${string}`, BigInt(amount)],
        });

        const approveTxHash = await walletClient.sendTransaction({
          to: token as `0x${string}`,
          data: approveData,
        });

        console.log('[api/demo/execute-direct] Approval tx:', approveTxHash);
        await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
        approvalTxHashes.push(approveTxHash);
      }
    }

    // Estimate gas
    let gasLimit: bigint;
    try {
      const estimatedGas = await publicClient.estimateGas({
        to: EXECUTION_ROUTER_ADDRESS as `0x${string}`,
        data: data as `0x${string}`,
        account: relayerAccount,
      });
      gasLimit = estimatedGas * BigInt(120) / BigInt(100); // 1.2x multiplier
      if (gasLimit > BigInt(12_000_000)) {
        gasLimit = BigInt(12_000_000);
      }
      console.log('[api/demo/execute-direct] Gas estimate:', estimatedGas.toString());
    } catch (error: any) {
      console.error('[api/demo/execute-direct] Gas estimation failed:', error.message);
      return res.status(400).json({
        ok: false,
        error: 'Gas estimation failed - transaction would likely revert',
        details: error.message,
        approvalTxHashes: approvalTxHashes.length > 0 ? approvalTxHashes : undefined,
      });
    }

    // Send transaction
    const txHash = await walletClient.sendTransaction({
      to: EXECUTION_ROUTER_ADDRESS as `0x${string}`,
      data: data as `0x${string}`,
      gas: gasLimit,
    });

    console.log('[api/demo/execute-direct] Transaction sent:', txHash);

    // Wait for receipt
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    console.log('[api/demo/execute-direct] Transaction confirmed:', {
      hash: txHash,
      status: receipt.status,
      gasUsed: receipt.gasUsed.toString(),
    });

    // Record execution to database for stats tracking
    if (receipt.status === 'success') {
      try {
        const { recordExecutionWithResult } = await import('../ledger/ledger');
        // Use recordAsAddress for unique wallet tracking (allows sims to pass agent wallet addresses)
        // Falls back to effectivePlan.user (relayer) if not provided
        const recordAddress = req.body.recordAsAddress || effectivePlan.user;
        const execId = await recordExecutionWithResult({
          chain: 'ethereum',
          network: 'sepolia',
          kind: req.body.kind || 'swap',
          venue: req.body.venue || 'demo_dex',
          fromAddress: recordAddress,
          intent: req.body.amountDisplay || 'demo-execute-direct',
          action: req.body.kind || 'swap',
          usdEstimate: req.body.usdEstimate || 10,
          amountDisplay: req.body.amountDisplay || 'Relayer execution',
          relayerAddress: effectivePlan.user,
        }, {
          success: true,
          txHash,
        });
        console.log('[api/demo/execute-direct] Recorded execution:', execId, 'for address:', recordAddress);
      } catch (recordError: any) {
        console.warn('[api/demo/execute-direct] Failed to record execution:', recordError.message);
      }
    }

    res.json({
      ok: true,
      success: receipt.status === 'success',
      txHash,
      approvalTxHashes: approvalTxHashes.length > 0 ? approvalTxHashes : undefined,
      receipt: {
        status: receipt.status,
        gasUsed: receipt.gasUsed.toString(),
        blockNumber: receipt.blockNumber.toString(),
      },
      explorerUrl: `https://sepolia.etherscan.io/tx/${txHash}`,
    });
  } catch (error: any) {
    console.error('[api/demo/execute-direct] Error:', error);
    res.status(500).json({
      ok: false,
      error: 'Direct execution failed',
      details: error.message,
    });
  }
});

/**
 * Health check endpoint
 * Simple endpoint that never depends on chain config - just confirms server is up
 */
app.get('/health', async (req, res) => {
  try {
    const {
      EXECUTION_MODE,
      ETH_TESTNET_RPC_URL,
      EXECUTION_ROUTER_ADDRESS,
    } = await import('../config');

    // Get database identity hash for production verification
    const { getDatabaseIdentityHash } = await import('../../execution-ledger/db');
    const dbIdentityHash = getDatabaseIdentityHash();
    const dbMode = process.env.DATABASE_URL ? 'postgres' : 'sqlite';

    // Check API keys
    const hasGeminiKey = !!process.env.BLOSSOM_GEMINI_API_KEY;
    const hasOpenAIKey = !!process.env.BLOSSOM_OPENAI_API_KEY;
    const hasAnthropicKey = !!process.env.BLOSSOM_ANTHROPIC_API_KEY;
    const hasAnyLLMKey = hasGeminiKey || hasOpenAIKey || hasAnthropicKey;

    // Dev-safe debug info (no secrets, just lengths)
    const rpcUrlLen = ETH_TESTNET_RPC_URL ? ETH_TESTNET_RPC_URL.length : 0;
    const routerAddrLen = EXECUTION_ROUTER_ADDRESS ? EXECUTION_ROUTER_ADDRESS.length : 0;
    
    // V1/V1.1 validation: check required vars for eth_testnet mode
    const missing: string[] = [];
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
      dbMode,
      dbIdentityHash,
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
  } catch (error) {
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
app.get('/api/health', async (req, res) => {
  // Get database identity hash for production verification
  const { getDatabaseIdentityHash } = await import('../../execution-ledger/db');
  const dbIdentityHash = getDatabaseIdentityHash();
  const dbMode = process.env.DATABASE_URL ? 'postgres' : 'sqlite';

  // Get LLM provider info (non-sensitive)
  const provider = process.env.BLOSSOM_MODEL_PROVIDER || 'stub';
  const hasGeminiKey = !!process.env.BLOSSOM_GEMINI_API_KEY;
  const hasOpenAIKey = !!process.env.BLOSSOM_OPENAI_API_KEY;
  const hasAnthropicKey = !!process.env.BLOSSOM_ANTHROPIC_API_KEY;

  // Determine effective provider (fallback to stub if key missing)
  let effectiveProvider = provider;
  if (provider === 'gemini' && !hasGeminiKey) {
    effectiveProvider = 'stub';
  } else if (provider === 'openai' && !hasOpenAIKey) {
    effectiveProvider = 'stub';
  } else if (provider === 'anthropic' && !hasAnthropicKey) {
    effectiveProvider = 'stub';
  }

  // Get git branch from Vercel or git
  const gitBranch = process.env.VERCEL_GIT_COMMIT_REF || 'unknown';
  const buildEnv = process.env.VERCEL_ENV || process.env.NODE_ENV || 'development';

  const response: any = {
    ok: true,
    ts: Date.now(),
    service: 'blossom-agent',
    llmProvider: effectiveProvider, // Non-sensitive: just the provider name
    dbMode,
    dbIdentityHash,
    // Build metadata for deployment verification
    gitSha: BUILD_SHA,
    gitBranch,
    buildEnv,
  };

  // Safe debug info (only when AUTH_DEBUG=1)
  if (process.env.AUTH_DEBUG === '1') {
    const ledgerSecret = process.env.DEV_LEDGER_SECRET || '';
    response.authDebug = {
      hasLedgerSecret: !!ledgerSecret,
      ledgerSecretHash: ledgerSecret ? createHash('sha256').update(ledgerSecret).digest('hex').slice(0, 6) : 'empty'
    };
  }

  res.json(response);
});

/**
 * RPC Provider Health endpoint
 * Shows status of primary and fallback RPC endpoints with circuit breaker state
 */
app.get('/api/rpc/health', async (req, res) => {
  try {
    const { getProviderHealthStatus } = await import('../providers/rpcProvider');
    const status = getProviderHealthStatus();

    res.json({
      ok: true,
      ts: Date.now(),
      ...status,
    });
  } catch (error) {
    // Provider not initialized
    res.json({
      ok: false,
      ts: Date.now(),
      error: 'RPC provider not initialized',
      primary: null,
      fallbacks: [],
    });
  }
});

/**
 * Reset RPC circuit breakers (manual recovery)
 */
app.post('/api/rpc/reset', async (req, res) => {
  try {
    const { resetAllCircuits } = await import('../providers/rpcProvider');
    resetAllCircuits();
    res.json({ ok: true, message: 'All circuit breakers reset' });
  } catch (error) {
    res.json({ ok: false, error: 'RPC provider not initialized' });
  }
});

// ============================================
// Telemetry Dashboard Endpoints
// ============================================

/**
 * Get telemetry summary (for dashboard)
 */
app.get('/api/telemetry/summary', async (req, res) => {
  try {
    const { getTelemetrySummary } = await import('../../telemetry/db');
    const summary = getTelemetrySummary();
    res.json({ ok: true, data: summary });
  } catch (error) {
    // Fail open - return empty summary if DB not available
    res.json({
      ok: false,
      error: 'Telemetry DB not available',
      data: {
        totalUsers: 0,
        totalSessions: 0,
        activeSessions: 0,
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        successRate: 0,
        avgLatencyMs: null,
        topErrors: [],
        recentExecutions: [],
      },
    });
  }
});

/**
 * Devnet Statistics endpoint for landing page
 * Returns comprehensive stats:
 *   - traffic: HTTP requests processed (from request_log)
 *   - executions: On-chain transactions finalized (from executions)
 *   - users, amounts, fees
 */
app.get('/api/telemetry/devnet-stats', async (req, res) => {
  try {
    const { getDevnetStats, getTrafficStats, migrateAddFeeColumns } = await import('../../telemetry/db');
    const { BLOSSOM_FEE_BPS } = await import('../config');

    // Ensure fee columns exist (migration)
    migrateAddFeeColumns();

    const executionStats = getDevnetStats(BLOSSOM_FEE_BPS);
    const trafficStats = getTrafficStats(24);

    // Combined response with clear separation
    res.json({
      ok: true,
      data: {
        // Traffic stats (HTTP requests - what load tests generate)
        traffic: {
          requestsAllTime: trafficStats.requests.allTime,
          requestsLast24h: trafficStats.requests.last24h,
          successRate24h: trafficStats.requests.successRate24h,
          http5xx24h: trafficStats.requests.http5xx24h,
          visitorsAllTime: trafficStats.visitors.allTime,
          visitorsLast24h: trafficStats.visitors.last24h,
        },
        // Execution stats (on-chain transactions - real DeFi actions)
        executions: {
          allTime: executionStats.transactions.allTime,
          last24h: executionStats.transactions.last24h,
          successCount: executionStats.transactions.successCount,
          failCount: executionStats.transactions.failCount,
        },
        // User stats (from users table)
        users: executionStats.users,
        // Volume and fees
        amountExecuted: executionStats.amountExecuted,
        feesCollected: executionStats.feesCollected,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    // Fail open with empty stats
    res.json({
      ok: false,
      error: 'Devnet stats unavailable',
      data: {
        traffic: {
          requestsAllTime: 0,
          requestsLast24h: 0,
          successRate24h: 100,
          http5xx24h: 0,
          visitorsAllTime: 0,
          visitorsLast24h: 0,
        },
        executions: { allTime: 0, last24h: 0, successCount: 0, failCount: 0 },
        users: { allTime: 0, last24h: 0 },
        amountExecuted: { byToken: [], unpricedCount: 0 },
        feesCollected: { byToken: [], feeBps: 25, unpricedCount: 0 },
        generatedAt: new Date().toISOString(),
      },
    });
  }
});

/**
 * Get users with session status
 */
app.get('/api/telemetry/users', async (req, res) => {
  try {
    const { getUsersWithSessionStatus } = await import('../../telemetry/db');
    const users = getUsersWithSessionStatus();
    res.json({ ok: true, data: users });
  } catch (error) {
    res.json({ ok: false, error: 'Telemetry DB not available', data: [] });
  }
});

/**
 * Get recent executions
 */
app.get('/api/telemetry/executions', async (req, res) => {
  try {
    const { listExecutions } = await import('../../telemetry/db');
    const limit = parseInt(req.query.limit as string || '50', 10);
    const offset = parseInt(req.query.offset as string || '0', 10);
    const executions = listExecutions(limit, offset);
    res.json({ ok: true, data: executions });
  } catch (error) {
    res.json({ ok: false, error: 'Telemetry DB not available', data: [] });
  }
});

/**
 * Get recent devnet traffic runs
 * Returns run metadata for display on landing page
 */
app.get('/api/telemetry/runs', async (req, res) => {
  try {
    const { listRuns, ensureRunsTable } = await import('../../telemetry/db');
    ensureRunsTable();
    const limit = parseInt(req.query.limit as string || '5', 10);
    const runs = listRuns(limit);
    res.json({ ok: true, data: runs });
  } catch (error) {
    // Fail open with empty list
    res.json({ ok: true, data: [] });
  }
});

/**
 * POST /api/telemetry/runs
 * Store a load test run result (called by campaign scripts)
 */
app.post('/api/telemetry/runs', async (req, res) => {
  try {
    const { upsertRun, ensureRunsTable } = await import('../../telemetry/db');
    ensureRunsTable();

    const {
      run_id,
      started_at,
      duration_secs,
      total_users,
      concurrency,
      total_requests,
      success_rate,
      p50_ms,
      p95_ms,
      http_5xx_count,
      top_error,
    } = req.body;

    if (!run_id) {
      return res.status(400).json({ ok: false, error: 'run_id is required' });
    }

    // Map to DevnetRun interface fields
    upsertRun({
      run_id,
      stage: null,
      users: total_users || 0,
      concurrency: concurrency || 0,
      duration: duration_secs || 0,
      total_requests: total_requests || 0,
      success_rate: success_rate || 0,
      p50_ms: p50_ms || 0,
      p95_ms: p95_ms || 0,
      http_5xx: http_5xx_count || 0,
      top_error_code: top_error || null,
      started_at: started_at || new Date().toISOString(),
      ended_at: new Date().toISOString(),
      report_path: null,
    });

    res.json({ ok: true, run_id });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message || 'Failed to store run' });
  }
});

/**
 * GET /api/telemetry/debug
 * Audit endpoint for investor verification
 * Shows database path, writability, table info, and row counts
 */
app.get('/api/telemetry/debug', async (req, res) => {
  try {
    const { getDatabase, ensureRunsTable } = await import('../../telemetry/db');
    const db = getDatabase();
    ensureRunsTable();

    // Get database path
    const dbPath = process.env.TELEMETRY_DB_PATH || './telemetry/telemetry.db';

    // Check if writable by attempting a test
    let isWritable = false;
    try {
      db.exec('SELECT 1');
      isWritable = true;
    } catch (e) {
      isWritable = false;
    }

    // Get table list
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const tableNames = tables.map(t => t.name);

    // Get row counts for key tables
    const counts: Record<string, number> = {};
    for (const table of ['users', 'request_log', 'executions', 'runs', 'access_codes']) {
      try {
        const row = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
        counts[table] = row?.count ?? 0;
      } catch {
        counts[table] = -1; // Table doesn't exist
      }
    }

    // Get latest run
    let latestRun = null;
    try {
      latestRun = db.prepare('SELECT run_id, started_at, total_requests, success_rate FROM runs ORDER BY created_at DESC LIMIT 1').get();
    } catch {
      // No runs table or empty
    }

    // Get app version/commit if available
    const appVersion = process.env.FLY_IMAGE_REF || process.env.VERCEL_GIT_COMMIT_SHA || 'unknown';

    res.json({
      ok: true,
      debug: {
        dbPath,
        isWritable,
        tables: tableNames,
        rowCounts: counts,
        latestRun,
        appVersion,
        nodeEnv: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: error.message || 'Failed to get debug info',
    });
  }
});

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0'; // Bind to all interfaces by default

// Print startup banner with configuration status (Task C: Session config logging)
(async () => {
  try {
    const {
      EXECUTION_MODE,
      EXECUTION_AUTH_MODE,
      ETH_TESTNET_RPC_URL,
      EXECUTION_ROUTER_ADDRESS,
      RELAYER_PRIVATE_KEY,
      ETH_TESTNET_CHAIN_ID,
    } = await import('../config');
    
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
      const { 
        MOCK_SWAP_ADAPTER_ADDRESS,
        UNISWAP_V3_ADAPTER_ADDRESS,
        UNISWAP_ADAPTER_ADDRESS,
        WETH_WRAP_ADAPTER_ADDRESS,
        ERC20_PULL_ADAPTER_ADDRESS,
        PROOF_ADAPTER_ADDRESS,
      } = await import('../config');
      
      console.log(`\n🔧 ETH Testnet Execution Configuration`);
      console.log(`   Chain ID: ${ETH_TESTNET_CHAIN_ID || 'N/A'} (Sepolia: 11155111)`);
      console.log(`   Router Address: ${EXECUTION_ROUTER_ADDRESS ? `${EXECUTION_ROUTER_ADDRESS.substring(0, 10)}...${EXECUTION_ROUTER_ADDRESS.substring(EXECUTION_ROUTER_ADDRESS.length - 8)}` : 'NOT SET'}`);
      console.log(`   Adapter Addresses:`);
      if (MOCK_SWAP_ADAPTER_ADDRESS) console.log(`     - MOCK_SWAP: ${MOCK_SWAP_ADAPTER_ADDRESS.substring(0, 10)}...${MOCK_SWAP_ADAPTER_ADDRESS.substring(MOCK_SWAP_ADAPTER_ADDRESS.length - 8)}`);
      if (UNISWAP_V3_ADAPTER_ADDRESS) console.log(`     - UNISWAP_V3: ${UNISWAP_V3_ADAPTER_ADDRESS.substring(0, 10)}...${UNISWAP_V3_ADAPTER_ADDRESS.substring(UNISWAP_V3_ADAPTER_ADDRESS.length - 8)}`);
      if (UNISWAP_ADAPTER_ADDRESS) console.log(`     - UNISWAP: ${UNISWAP_ADAPTER_ADDRESS.substring(0, 10)}...${UNISWAP_ADAPTER_ADDRESS.substring(UNISWAP_ADAPTER_ADDRESS.length - 8)}`);
      if (WETH_WRAP_ADAPTER_ADDRESS) console.log(`     - WETH_WRAP: ${WETH_WRAP_ADAPTER_ADDRESS.substring(0, 10)}...${WETH_WRAP_ADAPTER_ADDRESS.substring(WETH_WRAP_ADAPTER_ADDRESS.length - 8)}`);
      if (ERC20_PULL_ADAPTER_ADDRESS) console.log(`     - ERC20_PULL: ${ERC20_PULL_ADAPTER_ADDRESS.substring(0, 10)}...${ERC20_PULL_ADAPTER_ADDRESS.substring(ERC20_PULL_ADAPTER_ADDRESS.length - 8)}`);
      if (PROOF_ADAPTER_ADDRESS) console.log(`     - PROOF: ${PROOF_ADAPTER_ADDRESS.substring(0, 10)}...${PROOF_ADAPTER_ADDRESS.substring(PROOF_ADAPTER_ADDRESS.length - 8)}`);
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
        if (!RELAYER_PRIVATE_KEY) console.log(`      - RELAYER_PRIVATE_KEY`);
        if (!EXECUTION_ROUTER_ADDRESS) console.log(`      - EXECUTION_ROUTER_ADDRESS`);
        if (!ETH_TESTNET_RPC_URL) console.log(`      - ETH_TESTNET_RPC_URL`);
        console.log(`      Session mode will be disabled. Direct mode will be used instead.`);
      } else {
        console.log(`   ✓ Session mode configured`);
      }
    }
    
    if (EXECUTION_MODE === 'eth_testnet') {
      // Task 4: Validate contract configuration on startup
      try {
        const { validateEthTestnetConfig } = await import('../config');
        await validateEthTestnetConfig();
        console.log(`   ✓ ETH testnet configuration validated`);
      } catch (error: any) {
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

      // Initialize RPC provider with failover
      if (ETH_TESTNET_RPC_URL) {
        try {
          const { initRpcProvider } = await import('../providers/rpcProvider');
          const { ETH_RPC_FALLBACK_URLS } = await import('../config');
          initRpcProvider(ETH_TESTNET_RPC_URL, ETH_RPC_FALLBACK_URLS);
          if (ETH_RPC_FALLBACK_URLS.length > 0) {
            console.log(`   ✓ RPC failover configured with ${ETH_RPC_FALLBACK_URLS.length} fallback(s)`);
          }
        } catch (error: any) {
          console.log(`   ⚠️  RPC provider init skipped: ${error.message}`);
        }
      }

      try {
        const { startRelayerTopUpService } = await import('../services/relayerTopUp');
        startRelayerTopUpService();
      } catch (error: any) {
        console.log(`   ⚠️  Relayer top-up service init skipped: ${error.message}`);
      }
    }
    console.log(``);
  } catch (error) {
    console.log(`🌸 Blossom Agent (config load skipped)`);
  }
})();

// Export app for Vercel serverless (must be before listen())
export { app };

// Only listen if not in serverless mode (Vercel sets VERCEL=1)
if (!process.env.VERCEL) {
  app.listen(PORT, HOST, async () => {
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
  console.log(`   - GET  /api/relayer/status`);
  console.log(`   - POST /api/token/approve/prepare`);
  console.log(`   - POST /api/token/weth/wrap/prepare`);
  console.log(`   - GET  /api/portfolio/eth_testnet`);
  console.log(`   - GET  /health`);
  console.log(`   - GET  /api/debug/executions`);
  console.log(`   - POST /api/access/validate`);
  console.log(`   - GET  /api/ledger/positions`);
  console.log(`   - GET  /api/ledger/positions/recent`);

  // Start perp indexer if configured
  try {
    const { startPerpIndexer } = await import('../indexer/perpIndexer');
    const rpcUrl = process.env.ETH_TESTNET_RPC_URL;
    const perpEngineAddress = process.env.DEMO_PERP_ENGINE_ADDRESS;

    if (rpcUrl && perpEngineAddress) {
      startPerpIndexer(rpcUrl, perpEngineAddress);
    } else {
      console.log('   [indexer] Perp indexer disabled (config missing)');
    }
  } catch (err: any) {
    console.log('   [indexer] Failed to start:', err.message);
  }
  console.log(`   - POST /api/access/check`);
  console.log(`   - GET  /api/access/codes (admin)`);
  console.log(`   - POST /api/access/codes/generate (admin)`);
  console.log(`   - GET  /api/prices/eth`);
  });
} else {
  console.log('🌸 Blossom Agent (Vercel serverless mode - app exported, not listening)');
}

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
    const cache = (global as any).__priceCache || {};
    const cacheKey = `${ids}-${vs_currencies}`;
    const now = Date.now();
    
    if (cache[cacheKey] && (now - cache[cacheKey].timestamp) < 60000) {
      return res.json(cache[cacheKey].data);
    }

    // Rate limiting: max 1 request per 2 seconds (request coalescing)
    const lastRequest = (global as any).__lastPriceRequest || 0;
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
    (global as any).__lastPriceRequest = now;

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
      const staticPrices: Record<string, any> = {};
      const coinIds = ids.split(',');
      for (const coinId of coinIds) {
        if (coinId === 'ethereum') {
          staticPrices.ethereum = { usd: 3000 };
        } else if (coinId === 'bitcoin') {
          staticPrices.bitcoin = { usd: 45000 };
        } else if (coinId === 'solana') {
          staticPrices.solana = { usd: 100 };
        } else if (coinId === 'avalanche-2') {
          staticPrices['avalanche-2'] = { usd: 40 };
        } else if (coinId === 'chainlink') {
          staticPrices.chainlink = { usd: 14 };
        }
      }
      return res.json(staticPrices);
    }

    const data = await response.json();
    
    // Update cache
    if (!(global as any).__priceCache) {
      (global as any).__priceCache = {};
    }
    (global as any).__priceCache[cacheKey] = {
      data,
      timestamp: now,
    };

    res.json(data);
  } catch (error: any) {
    console.error('[api/prices/simple] Error:', error);
    // Return cached data if available
    const cache = (global as any).__priceCache || {};
    const idsParam = req.query.ids;
    const vsCurrenciesParam = req.query.vs_currencies;
    const vs_currencies = (typeof vsCurrenciesParam === 'string' ? vsCurrenciesParam : 'usd');
    const cacheKey = `${typeof idsParam === 'string' ? idsParam : ''}-${vs_currencies}`;
    if (cache[cacheKey]) {
      return res.json(cache[cacheKey].data);
    }
    // Never throw - always return 200 with fallback
    const staticPrices: Record<string, any> = {};
    const coinIds = (typeof idsParam === 'string' ? idsParam.split(',') : []);
    for (const coinId of coinIds) {
      if (coinId === 'ethereum') {
        staticPrices.ethereum = { usd: 3000 };
      } else if (coinId === 'bitcoin') {
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
  } catch (error: any) {
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
  } catch (error: any) {
    console.error('[api/debug/executions] Error:', error);
    res.status(500).json({
      error: 'Failed to dump execution artifacts',
      message: error.message,
    });
  }
});

/**
 * GET /api/debug/contracts
 * Shows configured contract addresses and allowlist status
 * AUTH-GATED: Requires DEV_LEDGER_SECRET or DEBUG_EXECUTIONS=1
 */
app.get('/api/debug/contracts', async (req, res) => {
  // Auth gate: require DEBUG_EXECUTIONS=1 or valid ledger secret
  const ledgerSecret = process.env.DEV_LEDGER_SECRET;
  const authHeader = req.headers['x-ledger-secret'] as string;
  const isAuthorized = process.env.DEBUG_EXECUTIONS === '1' ||
    (ledgerSecret && authHeader === ledgerSecret);

  if (!isAuthorized) {
    return res.status(403).json({
      error: 'Unauthorized. Set DEBUG_EXECUTIONS=1 or provide x-ledger-secret header',
    });
  }

  try {
    const {
      EXECUTION_MODE,
      EXECUTION_ROUTER_ADDRESS,
      MOCK_SWAP_ADAPTER_ADDRESS,
      UNISWAP_V3_ADAPTER_ADDRESS,
      ERC20_PULL_ADAPTER_ADDRESS,
      WETH_WRAP_ADAPTER_ADDRESS,
      DEMO_LEND_ADAPTER_ADDRESS,
      PROOF_ADAPTER_ADDRESS,
      AAVE_ADAPTER_ADDRESS,
      DEMO_PERP_ENGINE_ADDRESS,
      DEMO_PERP_ADAPTER_ADDRESS,
      DEMO_EVENT_ENGINE_ADDRESS,
      DEMO_EVENT_ADAPTER_ADDRESS,
      DEMO_REDACTED_ADDRESS,
      DEMO_WETH_ADDRESS,
      DEMO_SWAP_ROUTER_ADDRESS,
      DEMO_LEND_VAULT_ADDRESS,
      ETH_TESTNET_RPC_URL,
    } = await import('../config');

    // Check allowlist status for each adapter
    const allowlistStatus: Record<string, boolean | string> = {};

    const adaptersToCheck = [
      { name: 'MOCK_SWAP_ADAPTER', address: MOCK_SWAP_ADAPTER_ADDRESS },
      { name: 'UNISWAP_V3_ADAPTER', address: UNISWAP_V3_ADAPTER_ADDRESS },
      { name: 'ERC20_PULL_ADAPTER', address: ERC20_PULL_ADAPTER_ADDRESS },
      { name: 'WETH_WRAP_ADAPTER', address: WETH_WRAP_ADAPTER_ADDRESS },
      { name: 'DEMO_LEND_ADAPTER', address: DEMO_LEND_ADAPTER_ADDRESS },
      { name: 'PROOF_ADAPTER', address: PROOF_ADAPTER_ADDRESS },
      { name: 'AAVE_ADAPTER', address: AAVE_ADAPTER_ADDRESS },
      { name: 'DEMO_PERP_ADAPTER', address: DEMO_PERP_ADAPTER_ADDRESS },
      { name: 'DEMO_EVENT_ADAPTER', address: DEMO_EVENT_ADAPTER_ADDRESS },
    ];

    if (EXECUTION_ROUTER_ADDRESS && ETH_TESTNET_RPC_URL) {
      const { eth_call } = await import('../executors/evmRpc');
      const { encodeFunctionData } = await import('viem');

      for (const adapter of adaptersToCheck) {
        if (!adapter.address) {
          allowlistStatus[adapter.name] = 'NOT_CONFIGURED';
          continue;
        }

        try {
          const data = encodeFunctionData({
            abi: [{
              name: 'isAdapterAllowed',
              type: 'function',
              stateMutability: 'view',
              inputs: [{ name: '', type: 'address' }],
              outputs: [{ name: '', type: 'bool' }],
            }],
            functionName: 'isAdapterAllowed',
            args: [adapter.address as `0x${string}`],
          });

          const result = await eth_call(ETH_TESTNET_RPC_URL, EXECUTION_ROUTER_ADDRESS, data);
          const { decodeBool } = await import('../executors/evmRpc');
          allowlistStatus[adapter.name] = decodeBool(result);
        } catch (e: any) {
          allowlistStatus[adapter.name] = `ERROR: ${e.message}`;
        }
      }
    }

    // Missing env vars detection
    const missingEnvVars: string[] = [];
    if (!EXECUTION_ROUTER_ADDRESS) missingEnvVars.push('EXECUTION_ROUTER_ADDRESS');
    if (!MOCK_SWAP_ADAPTER_ADDRESS) missingEnvVars.push('MOCK_SWAP_ADAPTER_ADDRESS');
    if (!DEMO_PERP_ENGINE_ADDRESS) missingEnvVars.push('DEMO_PERP_ENGINE_ADDRESS');
    if (!DEMO_PERP_ADAPTER_ADDRESS) missingEnvVars.push('DEMO_PERP_ADAPTER_ADDRESS');
    if (!ETH_TESTNET_RPC_URL) missingEnvVars.push('ETH_TESTNET_RPC_URL');

    // Venue enabled flags
    const perpsEnabled = !!DEMO_PERP_ADAPTER_ADDRESS && !!EXECUTION_ROUTER_ADDRESS;
    const swapsEnabled = !!MOCK_SWAP_ADAPTER_ADDRESS && !!EXECUTION_ROUTER_ADDRESS;
    const lendingEnabled = !!DEMO_LEND_ADAPTER_ADDRESS || !!AAVE_ADAPTER_ADDRESS;

    res.json({
      ok: true,
      executionMode: EXECUTION_MODE,
      contracts: {
        router: EXECUTION_ROUTER_ADDRESS || null,
        adapters: {
          mockSwap: MOCK_SWAP_ADAPTER_ADDRESS || null,
          uniswapV3: UNISWAP_V3_ADAPTER_ADDRESS || null,
          erc20Pull: ERC20_PULL_ADAPTER_ADDRESS || null,
          wethWrap: WETH_WRAP_ADAPTER_ADDRESS || null,
          demoLend: DEMO_LEND_ADAPTER_ADDRESS || null,
          proof: PROOF_ADAPTER_ADDRESS || null,
          aave: AAVE_ADAPTER_ADDRESS || null,
          demoPerp: DEMO_PERP_ADAPTER_ADDRESS || null,
        },
        engines: {
          demoPerp: DEMO_PERP_ENGINE_ADDRESS || null,
        },
        tokens: {
          demoUsdc: DEMO_REDACTED_ADDRESS || null,
          demoWeth: DEMO_WETH_ADDRESS || null,
        },
        venues: {
          demoSwapRouter: DEMO_SWAP_ROUTER_ADDRESS || null,
          demoLendVault: DEMO_LEND_VAULT_ADDRESS || null,
        },
      },
      allowlistStatus,
      venueFlags: {
        perpsEnabled,
        swapsEnabled,
        lendingEnabled,
        eventsEnabled: true, // Always enabled (proof-only)
      },
      missingEnvVars,
      chainId: 11155111,
    });
  } catch (error: any) {
    console.error('[api/debug/contracts] Error:', error);
    res.status(500).json({
      error: 'Failed to get contract status',
      message: error.message,
    });
  }
});

/**
 * In-memory ring buffer for relayed execution attempts (dev-only diagnostics)
 */
interface RelayedAttempt {
  correlationId: string;
  timestamp: number;
  userAddress: string;
  sessionId: string;
  adapter: string;
  instrumentType?: 'swap' | 'perp' | 'defi' | 'event';
  spendAttempted?: string;
  result: 'ok' | 'failed';
  txHash?: string;
  errorCode?: string;
}

const relayedAttempts: RelayedAttempt[] = [];
const MAX_ATTEMPTS_HISTORY = 10;

function addRelayedAttempt(attempt: RelayedAttempt): void {
  relayedAttempts.unshift(attempt);
  if (relayedAttempts.length > MAX_ATTEMPTS_HISTORY) {
    relayedAttempts.pop();
  }
}

/**
 * GET /api/debug/routing-stats
 * Dev-only endpoint to inspect routing service call statistics
 */
app.get('/api/debug/routing-stats', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Debug endpoint not available in production' });
  }

  try {
    const { getRoutingStats, resetRoutingStats } = await import('../routing/routingService');
    
    // Support reset query param
    if (req.query.reset === 'true') {
      resetRoutingStats();
    }
    
    const stats = getRoutingStats();
    res.json({
      dflowCallCount: stats.dflowCallCount,
      lastDflowCallAt: stats.lastDflowCallAt,
      lastDflowCallAtIso: stats.lastDflowCallAt ? new Date(stats.lastDflowCallAt).toISOString() : null,
    });
  } catch (error: any) {
    res.status(500).json({
      error: error.message || 'Failed to get routing stats',
    });
  }
});

/**
 * GET /api/debug/session-authority
 * Dev-only endpoint to inspect session authority state and recent attempts
 */
app.get('/api/debug/session-authority', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Debug endpoint not available in production' });
  }

  try {
    const userAddress = req.query.address as string;
    if (!userAddress) {
      return res.status(400).json({ error: 'address query parameter required' });
    }

    const {
      EXECUTION_ROUTER_ADDRESS,
      ETH_TESTNET_RPC_URL,
      UNISWAP_V3_ADAPTER_ADDRESS,
      WETH_WRAP_ADAPTER_ADDRESS,
      MOCK_SWAP_ADAPTER_ADDRESS,
      PROOF_ADAPTER_ADDRESS,
      ERC20_PULL_ADAPTER_ADDRESS,
      DEMO_LEND_ADAPTER_ADDRESS,
    } = await import('../config');

    // Get chain ID
    let chainId = 11155111; // Sepolia default
    if (ETH_TESTNET_RPC_URL) {
      try {
        const { createPublicClient, http } = await import('viem');
        const { sepolia } = await import('viem/chains');
        const publicClient = createPublicClient({
          chain: sepolia,
          transport: http(ETH_TESTNET_RPC_URL),
        });
        chainId = await publicClient.getChainId();
      } catch (error) {
        // Use default
      }
    }

    // Get session status (if sessionId can be found from recent attempts)
    let sessionStatus: any = null;
    try {
      const recentAttempt = relayedAttempts.find(a => a.userAddress.toLowerCase() === userAddress.toLowerCase());
      if (recentAttempt && ETH_TESTNET_RPC_URL && EXECUTION_ROUTER_ADDRESS) {
        const { createPublicClient, http } = await import('viem');
        const { sepolia } = await import('viem/chains');
        const publicClient = createPublicClient({
          chain: sepolia,
          transport: http(ETH_TESTNET_RPC_URL),
        });

        const normalizedSessionId = recentAttempt.sessionId.startsWith('0x') 
          ? recentAttempt.sessionId 
          : `0x${recentAttempt.sessionId}`;

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
        ] as const;

        try {
          const sessionResult = await Promise.race([
            publicClient.readContract({
              address: EXECUTION_ROUTER_ADDRESS as `0x${string}`,
              abi: sessionAbi,
              functionName: 'sessions',
              args: [normalizedSessionId as `0x${string}`],
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
          ]) as any;

          const now = BigInt(Math.floor(Date.now() / 1000));
          let status: 'active' | 'expired' | 'revoked' | 'not_created' = 'not_created';
          if (sessionResult[5]) { // active
            status = sessionResult[2] > now ? 'active' : 'expired';
          } else if (sessionResult[0] !== '0x0000000000000000000000000000000000000000') {
            status = 'revoked';
          }

          sessionStatus = {
            status,
            owner: sessionResult[0],
            executor: sessionResult[1],
            expiresAt: sessionResult[2].toString(),
            maxSpend: sessionResult[3].toString(),
            spent: sessionResult[4].toString(),
            active: sessionResult[5],
          };
        } catch (error) {
          // RPC error - skip
        }
      }
    } catch (error) {
      // Skip session status if error
    }

    // Build allowed adapters list
    const allowedAdapters: string[] = [];
    if (UNISWAP_V3_ADAPTER_ADDRESS) allowedAdapters.push(UNISWAP_V3_ADAPTER_ADDRESS.toLowerCase());
    if (WETH_WRAP_ADAPTER_ADDRESS) allowedAdapters.push(WETH_WRAP_ADAPTER_ADDRESS.toLowerCase());
    if (MOCK_SWAP_ADAPTER_ADDRESS) allowedAdapters.push(MOCK_SWAP_ADAPTER_ADDRESS.toLowerCase());
    if (PROOF_ADAPTER_ADDRESS) allowedAdapters.push(PROOF_ADAPTER_ADDRESS.toLowerCase());
    if (ERC20_PULL_ADAPTER_ADDRESS) allowedAdapters.push(ERC20_PULL_ADAPTER_ADDRESS.toLowerCase());
    if (DEMO_LEND_ADAPTER_ADDRESS) allowedAdapters.push(DEMO_LEND_ADAPTER_ADDRESS.toLowerCase());

    // Get recent attempts for this user
    const userAttempts = relayedAttempts
      .filter(a => a.userAddress.toLowerCase() === userAddress.toLowerCase())
      .slice(0, 10);

    // Extract sessionId from recentAttempts if session is active
    let activeSessionId: string | null = null;
    if (sessionStatus?.status === 'active' && userAttempts.length > 0) {
      // Get sessionId from the most recent attempt
      activeSessionId = userAttempts[0].sessionId || null;
    }

    res.json({
      chainId,
      executionRouterAddress: EXECUTION_ROUTER_ADDRESS || null,
      sessionStatus: sessionStatus ? {
        ...sessionStatus,
        sessionId: activeSessionId || sessionStatus.sessionId || null,
      } : null,
      sessionId: activeSessionId, // Top-level for easy access
      effectivePolicy: {
        allowedAdapters,
        maxSpendPerTx: '10000000000000000000', // 10 ETH in wei (from session creation)
      },
      recentAttempts: userAttempts,
    });
  } catch (error: any) {
    res.status(500).json({
      error: error.message || 'Failed to get session authority state',
    });
  }
});

/**
 * GET /api/debug/dflow-probe
 * Probe dFlow API endpoints for discovery (dev only)
 * NEVER logs API key, only status codes
 */
app.get('/api/debug/dflow-probe', async (req, res) => {
  try {
    const { probeDflowEndpoints } = await import('../integrations/dflow/dflowClient');
    const results = await probeDflowEndpoints();
    
    // Find working endpoints (status 200, 401, or 403 indicate endpoint exists)
    const workingQuoteEndpoints = results.quoteApi.filter(r => r.status >= 200 && r.status < 500);
    const workingPredictionEndpoints = results.predictionApi.filter(r => r.status >= 200 && r.status < 500);
    
    res.json({
      summary: {
        configured: results.configured,
        apiKeySet: results.apiKeySet,
        quoteApiWorking: workingQuoteEndpoints.length,
        predictionApiWorking: workingPredictionEndpoints.length,
      },
      quoteApi: results.quoteApi,
      predictionApi: results.predictionApi,
      recommendations: [
        results.apiKeySet ? null : 'Set DFLOW_API_KEY in .env.local',
        workingQuoteEndpoints.find(e => e.path === '/v1/swap/quote') ? 'Set DFLOW_SWAPS_QUOTE_PATH=/v1/swap/quote' : null,
        workingPredictionEndpoints.find(e => e.path === '/v1/events/markets') ? 'Set DFLOW_EVENTS_MARKETS_PATH=/v1/events/markets' : null,
        workingPredictionEndpoints.find(e => e.path === '/v1/markets') ? 'Alt: Set DFLOW_EVENTS_MARKETS_PATH=/v1/markets' : null,
      ].filter(Boolean),
    });
  } catch (error: any) {
    console.error('[api/debug/dflow-probe] Error:', error);
    res.status(500).json({
      error: 'Failed to probe dFlow endpoints',
      message: error.message,
    });
  }
});

/**
 * GET /api/debug/session-recent
 * Query recent SessionCreated events (dev only)
 * Helps find sessionId and txHash for diagnosis
 */
app.get('/api/debug/session-recent', async (req, res) => {
  try {
    const { EXECUTION_ROUTER_ADDRESS, ETH_TESTNET_RPC_URL } = await import('../config');
    
    if (!ETH_TESTNET_RPC_URL || !EXECUTION_ROUTER_ADDRESS) {
      return res.status(500).json({ error: 'ETH_TESTNET_RPC_URL or EXECUTION_ROUTER_ADDRESS not configured' });
    }

    const { createPublicClient, http } = await import('viem');
    const { sepolia } = await import('viem/chains');
    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http(ETH_TESTNET_RPC_URL),
    });

    // Query recent SessionCreated events (last 1000 blocks)
    const currentBlock = await publicClient.getBlockNumber();
    const fromBlock = currentBlock - 1000n;

    const executionRouterAbi = [
      {
        type: 'event',
        name: 'SessionCreated',
        inputs: [
          { name: 'sessionId', type: 'bytes32', indexed: true },
          { name: 'owner', type: 'address', indexed: true },
          { name: 'executor', type: 'address', indexed: true },
          { name: 'expiresAt', type: 'uint64', indexed: false },
          { name: 'maxSpend', type: 'uint256', indexed: false },
        ],
      },
    ] as const;

    const events = await publicClient.getLogs({
      address: EXECUTION_ROUTER_ADDRESS as `0x${string}`,
      event: executionRouterAbi[0],
      fromBlock,
      toBlock: 'latest',
    });

    res.json({
      routerAddress: EXECUTION_ROUTER_ADDRESS,
      currentBlock: currentBlock.toString(),
      fromBlock: fromBlock.toString(),
      eventsFound: events.length,
      events: events.slice(-10).map((e: any) => ({
        blockNumber: e.blockNumber.toString(),
        transactionHash: e.transactionHash,
        sessionId: e.args.sessionId,
        owner: e.args.owner,
        executor: e.args.executor,
        expiresAt: e.args.expiresAt.toString(),
        maxSpend: e.args.maxSpend.toString(),
      })),
    });
  } catch (error: any) {
    console.error('[api/debug/session-recent] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/debug/session-diagnose
 * Diagnose session transaction (dev only)
 * Analyzes a transaction hash to determine why session status might be failing
 */
app.get('/api/debug/session-diagnose', async (req, res) => {
  try {
    const { txHash } = req.query;
    
    if (!txHash || typeof txHash !== 'string') {
      return res.status(400).json({
        error: 'txHash query parameter is required',
      });
    }

    const {
      EXECUTION_ROUTER_ADDRESS,
      ETH_TESTNET_RPC_URL,
    } = await import('../config');

    if (!ETH_TESTNET_RPC_URL || !EXECUTION_ROUTER_ADDRESS) {
      return res.status(500).json({
        error: 'ETH_TESTNET_RPC_URL or EXECUTION_ROUTER_ADDRESS not configured',
      });
    }

    const { createPublicClient, http, decodeEventLog } = await import('viem');
    const { sepolia } = await import('viem/chains');
    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http(ETH_TESTNET_RPC_URL),
    });

    // Get chain ID
    const chainId = await publicClient.getChainId();

    // Check router contract
    const routerCode = await publicClient.getBytecode({ address: EXECUTION_ROUTER_ADDRESS as `0x${string}` });
    const routerIsContract = routerCode && routerCode !== '0x' && routerCode.length > 2;

    // Get transaction
    const tx = await publicClient.getTransaction({ hash: txHash as `0x${string}` });
    
    // Get receipt
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });

    // Decode logs using ExecutionRouter ABI (must match contract exactly)
    const executionRouterAbi = [
      {
        type: 'event',
        name: 'SessionCreated',
        inputs: [
          { name: 'sessionId', type: 'bytes32', indexed: true },
          { name: 'owner', type: 'address', indexed: true },
          { name: 'executor', type: 'address', indexed: true }, // Fixed: executor is indexed in contract
          { name: 'expiresAt', type: 'uint64', indexed: false },
          { name: 'maxSpend', type: 'uint256', indexed: false },
        ],
      },
    ] as const;

    const emittedEvents: Array<{ name: string; sessionId?: string; owner?: string }> = [];
    let sessionCreatedEvent: { sessionId: string; owner: string; executor: string; expiresAt: bigint; maxSpend: bigint } | null = null;

    if (receipt.logs) {
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: executionRouterAbi,
            data: log.data,
            topics: log.topics,
          });
          
          emittedEvents.push({ name: decoded.eventName });
          
          if (decoded.eventName === 'SessionCreated') {
            sessionCreatedEvent = {
              sessionId: (decoded.args as any).sessionId,
              owner: (decoded.args as any).owner,
              executor: (decoded.args as any).executor,
              expiresAt: (decoded.args as any).expiresAt,
              maxSpend: (decoded.args as any).maxSpend,
            };
          }
        } catch {
          // Not a SessionCreated event, skip
        }
      }
    }

    res.json({
      chainId,
      routerAddress: EXECUTION_ROUTER_ADDRESS,
      routerIsContract,
      routerCodeLength: routerCode?.length || 0,
      tx: {
        to: tx.to,
        input: tx.input.substring(0, 10), // First 10 bytes (function selector + first param)
        value: tx.value.toString(),
      },
      receipt: {
        status: receipt.status,
        blockNumber: receipt.blockNumber.toString(),
        logsCount: receipt.logs.length,
      },
      events: {
        emitted: emittedEvents.map(e => e.name),
        sessionCreated: sessionCreatedEvent ? {
          sessionId: sessionCreatedEvent.sessionId,
          owner: sessionCreatedEvent.owner,
          executor: sessionCreatedEvent.executor,
          expiresAt: sessionCreatedEvent.expiresAt.toString(),
          maxSpend: sessionCreatedEvent.maxSpend.toString(),
        } : null,
      },
    });
  } catch (error: any) {
    console.error('[api/debug/session-diagnose] Error:', error);
    res.status(500).json({
      error: 'Failed to diagnose session transaction',
      message: error.message,
    });
  }
});

// ============================================
// EXECUTION LEDGER API (Dev-only)
// ============================================

const DEV_LEDGER_SECRET = process.env.DEV_LEDGER_SECRET || '';

// Safe hash helper for debug logging (never logs raw secrets)
function safeHash(value: string): string {
  if (!value) return 'empty';
  return createHash('sha256').update(value).digest('hex').slice(0, 6);
}

/**
 * Middleware to check ledger secret
 * BULLETPROOF GATING:
 * - DEV_LEDGER_SECRET MUST be set, otherwise 403
 * - Secret MUST be provided via X-Ledger-Secret header (NOT query param - leaks to logs/history)
 * - No fallbacks, no exceptions
 */
function checkLedgerSecret(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authDebug = process.env.AUTH_DEBUG === '1';

  // HARD REQUIREMENT: DEV_LEDGER_SECRET must be configured
  if (!DEV_LEDGER_SECRET) {
    if (authDebug) {
      console.warn('[ledger-auth] hasEnvSecret=false, envSecretHashPrefix=empty');
    }
    console.warn('[ledger] DEV_LEDGER_SECRET not configured - blocking all ledger API access');
    return res.status(403).json({
      ok: false,
      error: 'Ledger not configured: DEV_LEDGER_SECRET env var required'
    });
  }

  // ONLY accept header-based auth (query params leak to logs/browser history)
  const providedSecret = req.headers['x-ledger-secret'] as string;

  if (authDebug) {
    console.log('[ledger-auth] hasEnvSecret=true, envSecretHashPrefix=' + safeHash(DEV_LEDGER_SECRET));
    console.log('[ledger-auth] hasHeaderSecret=' + !!providedSecret + ', headerSecretHashPrefix=' + safeHash(providedSecret || ''));
    console.log('[ledger-auth] comparisonResult=' + (providedSecret === DEV_LEDGER_SECRET ? 'match' : 'mismatch'));
  }

  // Warn if query param was used (deprecated)
  if (req.query.secret) {
    console.warn('[ledger] Query param ?secret= is deprecated and ignored. Use X-Ledger-Secret header.');
  }

  if (!providedSecret || providedSecret !== DEV_LEDGER_SECRET) {
    return res.status(403).json({ ok: false, error: 'Unauthorized: Invalid or missing X-Ledger-Secret header' });
  }

  next();
}

/**
 * GET /api/ledger/summary
 * Returns summary of all executions across chains
 */
app.get('/api/ledger/summary', checkLedgerSecret, async (req, res) => {
  try {
    const { getLedgerSummary } = await import('../../execution-ledger/db');
    const summary = getLedgerSummary();
    res.json({ ok: true, data: summary });
  } catch (error) {
    res.json({
      ok: false,
      error: 'Execution ledger not available',
      data: {
        totalExecutions: 0,
        confirmedExecutions: 0,
        failedExecutions: 0,
        successRate: 0,
        byChain: [],
        activeSessions: 0,
        trackedAssets: 0,
        registeredWallets: 0,
        recentExecutions: [],
      },
    });
  }
});

/**
 * GET /api/ledger/executions
 * Returns list of executions with optional filters
 */
app.get('/api/ledger/executions', checkLedgerSecret, async (req, res) => {
  try {
    const { listExecutionsWithMeta } = await import('../../execution-ledger/db');
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const chain = req.query.chain as any;
    const network = req.query.network as any;
    const status = req.query.status as any;

    const result = listExecutionsWithMeta({ chain, network, status, limit, offset });
    res.json({ ok: true, data: result.data, meta: result.meta });
  } catch (error) {
    res.json({ ok: false, error: 'Failed to fetch executions', data: [], meta: { totalInDb: 0, limit: 50, offset: 0 } });
  }
});

/**
 * GET /api/ledger/sessions
 * Returns list of sessions across chains
 */
app.get('/api/ledger/sessions', checkLedgerSecret, async (req, res) => {
  try {
    const { listSessionsWithMeta } = await import('../../execution-ledger/db');
    const limit = parseInt(req.query.limit as string) || 50;
    const chain = req.query.chain as any;
    const network = req.query.network as any;
    const status = req.query.status as any;

    const result = listSessionsWithMeta({ chain, network, status, limit });
    res.json({ ok: true, data: result.data, meta: result.meta });
  } catch (error) {
    res.json({ ok: false, error: 'Failed to fetch sessions', data: [], meta: { totalInDb: 0, limit: 50, offset: 0 } });
  }
});

/**
 * GET /api/ledger/assets
 * Returns list of tracked assets
 */
app.get('/api/ledger/assets', checkLedgerSecret, async (req, res) => {
  try {
    const { listAssetsWithMeta } = await import('../../execution-ledger/db');
    const limit = parseInt(req.query.limit as string) || 100;
    const chain = req.query.chain as any;
    const network = req.query.network as any;
    const walletAddress = req.query.wallet as string;

    const result = listAssetsWithMeta({ chain, network, walletAddress, limit });
    res.json({ ok: true, data: result.data, meta: result.meta });
  } catch (error) {
    res.json({ ok: false, error: 'Failed to fetch assets', data: [], meta: { totalInDb: 0, limit: 100, offset: 0 } });
  }
});

/**
 * GET /api/ledger/proofs
 * Returns proof bundle for all confirmed executions
 */
app.get('/api/ledger/proofs', checkLedgerSecret, async (req, res) => {
  try {
    const { getProofBundle } = await import('../../execution-ledger/db');
    const proofs = getProofBundle();
    res.json({ ok: true, data: proofs });
  } catch (error) {
    res.json({
      ok: false,
      error: 'Failed to fetch proof bundle',
      data: { ethereum: [], solana: [] },
    });
  }
});

/**
 * GET /api/ledger/wallets
 * Returns list of registered dev wallets
 */
app.get('/api/ledger/wallets', checkLedgerSecret, async (req, res) => {
  try {
    const { listWallets } = await import('../../execution-ledger/db');
    const chain = req.query.chain as any;
    const network = req.query.network as any;

    const wallets = listWallets({ chain, network });
    res.json({ ok: true, data: wallets });
  } catch (error) {
    res.json({ ok: false, error: 'Failed to fetch wallets', data: [] });
  }
});

/**
 * GET /api/ledger/stats/summary
 * Returns comprehensive execution statistics for the dashboard
 */
app.get('/api/ledger/stats/summary', checkLedgerSecret, async (req, res) => {
  try {
    const { getSummaryStatsAsync } = await import('../../execution-ledger/db');
    const stats = await getSummaryStatsAsync();
    res.json({ ok: true, data: stats });
  } catch (error) {
    console.error('[ledger] Failed to fetch stats summary:', error);
    res.json({
      ok: false,
      error: 'Failed to fetch stats summary',
      data: null,
    });
  }
});

/**
 * GET /api/ledger/stats/recent
 * Returns recent executions for the activity feed
 */
app.get('/api/ledger/stats/recent', checkLedgerSecret, async (req, res) => {
  try {
    const { getRecentExecutions } = await import('../../execution-ledger/db');
    const limit = parseInt(req.query.limit as string) || 20;
    const executions = getRecentExecutions(Math.min(limit, 100)); // Cap at 100
    res.json({ ok: true, data: executions });
  } catch (error) {
    console.error('[ledger] Failed to fetch recent executions:', error);
    res.json({ ok: false, error: 'Failed to fetch recent executions', data: [] });
  }
});

/**
 * GET /api/ledger/executions/:id
 * Returns a single execution by ID
 */
app.get('/api/ledger/executions/:id', checkLedgerSecret, async (req, res) => {
  try {
    const { getExecution } = await import('../../execution-ledger/db');
    const execution = getExecution(req.params.id);
    if (!execution) {
      return res.status(404).json({ ok: false, error: 'Execution not found', data: null });
    }
    res.json({ ok: true, data: execution });
  } catch (error) {
    console.error('[ledger] Failed to fetch execution:', error);
    res.json({ ok: false, error: 'Failed to fetch execution', data: null });
  }
});

/**
 * GET /api/ledger/executions/:id/steps
 * Returns steps for a specific execution
 */
app.get('/api/ledger/executions/:id/steps', checkLedgerSecret, async (req, res) => {
  try {
    const { getExecutionSteps, getExecution } = await import('../../execution-ledger/db');

    // Verify execution exists
    const execution = getExecution(req.params.id);
    if (!execution) {
      return res.status(404).json({ ok: false, error: 'Execution not found', data: [] });
    }

    const steps = getExecutionSteps(req.params.id);
    res.json({ ok: true, data: steps });
  } catch (error) {
    console.error('[ledger] Failed to fetch execution steps:', error);
    res.json({ ok: false, error: 'Failed to fetch execution steps', data: [] });
  }
});

// ============================================
// INTENT TRACKING ENDPOINTS
// ============================================

/**
 * GET /api/ledger/intents/recent
 * Returns recent intents for the activity feed
 */
app.get('/api/ledger/intents/recent', checkLedgerSecret, async (req, res) => {
  try {
    const { getRecentIntentsAsync } = await import('../../execution-ledger/db');
    const limit = parseInt(req.query.limit as string) || 50;
    const intents = await getRecentIntentsAsync(Math.min(limit, 100));
    res.json({ ok: true, data: intents });
  } catch (error) {
    console.error('[ledger] Failed to fetch recent intents:', error);
    res.json({ ok: false, error: 'Failed to fetch intents', data: [] });
  }
});

/**
 * GET /api/ledger/intents/:id
 * Returns a single intent by ID
 */
app.get('/api/ledger/intents/:id', checkLedgerSecret, async (req, res) => {
  try {
    const { getIntentAsync, getExecutionsForIntentAsync } = await import('../../execution-ledger/db');
    const intent = await getIntentAsync(req.params.id);

    if (!intent) {
      return res.status(404).json({ ok: false, error: 'Intent not found', data: null });
    }

    // Include linked executions
    const executions = await getExecutionsForIntentAsync(req.params.id);

    res.json({
      ok: true,
      data: {
        ...intent,
        executions,
      },
    });
  } catch (error) {
    console.error('[ledger] Failed to fetch intent:', error);
    res.json({ ok: false, error: 'Failed to fetch intent', data: null });
  }
});

/**
 * GET /api/ledger/stats/intents
 * Returns comprehensive intent statistics for the dashboard
 */
app.get('/api/ledger/stats/intents', checkLedgerSecret, async (req, res) => {
  try {
    const { getIntentStatsSummaryAsync } = await import('../../execution-ledger/db');
    const stats = await getIntentStatsSummaryAsync();
    res.json({ ok: true, data: stats });
  } catch (error) {
    console.error('[ledger] Failed to fetch intent stats:', error);
    res.json({
      ok: false,
      error: 'Failed to fetch intent stats',
      data: {
        totalIntents: 0,
        confirmedIntents: 0,
        failedIntents: 0,
        intentSuccessRate: 0,
        byKind: [],
        byStatus: [],
        failuresByStage: [],
        failuresByCode: [],
        recentIntents: [],
      },
    });
  }
});

/**
 * GET /api/ledger/intents/:id/executions
 * Returns executions linked to a specific intent
 */
app.get('/api/ledger/intents/:id/executions', checkLedgerSecret, async (req, res) => {
  try {
    const { getIntent, getExecutionsForIntent } = await import('../../execution-ledger/db');

    // Verify intent exists
    const intent = getIntent(req.params.id);
    if (!intent) {
      return res.status(404).json({ ok: false, error: 'Intent not found', data: [] });
    }

    const executions = getExecutionsForIntent(req.params.id);
    res.json({ ok: true, data: executions });
  } catch (error) {
    console.error('[ledger] Failed to fetch intent executions:', error);
    res.json({ ok: false, error: 'Failed to fetch intent executions', data: [] });
  }
});

/**
 * POST /api/ledger/intents/execute
 * Execute an intent through the full pipeline (parse → route → execute → confirm)
 *
 * Options:
 * - planOnly: true → Returns plan without executing (for confirm mode)
 * - intentId: string → Execute a previously planned intent (skip parse/route)
 *
 * Returns execution result with explorer links
 */
app.post('/api/ledger/intents/execute', checkLedgerSecret, async (req, res) => {
  try {
    const { intentText, chain = 'ethereum', planOnly = false, intentId, metadata } = req.body;

    // Import the intent runner functions
    const { runIntent, executeIntentById, recordFailedIntent } = await import('../intent/intentRunner');
    const { ALLOW_PROOF_ONLY } = await import('../config');
    const { maybeTopUpRelayer } = await import('../services/relayerTopUp');
    const { executionFundingPolicy } = await import('../services/executionFundingPolicy');
    const { isTier1RelayedExecutionSupported, isTier1RelayedMode } = await import('../intent/tier1SupportedVenues');
    const { ensureExecutionFunding } = await import('../services/crossChainCreditRouter');
    const callerMetadata = typeof metadata === 'object' && metadata !== null ? metadata : {};
    const requestedMode = String(callerMetadata.mode || '').toLowerCase();
    const tier1RelayedRequired = isTier1RelayedMode(requestedMode);
    const requestedCategory = typeof callerMetadata.category === 'string' ? callerMetadata.category : undefined;
    const forceCrossChainRoute = callerMetadata.forceCrossChainRoute === true;
    let crossChainRouteMeta: any = null;

    const userEvmAddressRaw = String(
      callerMetadata.userAddress ||
      callerMetadata.walletAddress ||
      req.body?.userAddress ||
      ''
    ).trim();
    const userSolanaAddressRaw = String(
      callerMetadata.userSolanaAddress ||
      callerMetadata.solanaAddress ||
      req.body?.solanaAddress ||
      ''
    ).trim();
    const requestedFromChain = String(
      callerMetadata.fromChain ||
      callerMetadata.sourceChain ||
      req.body?.fromChain ||
      ''
    ).trim();

    const inferredAmountFromIntent = (() => {
      if (!intentText || typeof intentText !== 'string') {
        return undefined;
      }
      const amountMatch = intentText.match(/(\d+(?:\.\d+)?)\s*(?:bUSDC|REDACTED|USDC|BUSDC)?/i);
      if (!amountMatch) {
        return undefined;
      }
      const parsedAmount = Number(amountMatch[1]);
      return Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : undefined;
    })();
    // Prefer explicit caller-provided amountUsd for deterministic test flows.
    const amountUsdHint = Number(callerMetadata.amountUsd || callerMetadata.amountUsdRequired || inferredAmountFromIntent || 0);
    const requestedToChain = String(
      callerMetadata.toChain ||
      req.body?.toChain ||
      process.env.DEFAULT_SETTLEMENT_CHAIN ||
      'base_sepolia'
    );
    const requestedToChainNormalized = normalizeSettlementChain(requestedToChain);
    const baseRequiredMode =
      requestedToChainNormalized === 'base_sepolia' &&
      (
        requestedMode === 'tier1_crosschain_required_base' ||
        callerMetadata.requireBaseSettlement === true ||
        callerMetadata.strictSettlementChain === true
      );
    const settlementChain = resolveExecutionSettlementChain(requestedToChain, {
      allowFallback: !baseRequiredMode,
    });
    if (baseRequiredMode && (!isSettlementChainExecutionReady('base_sepolia') || settlementChain !== 'base_sepolia')) {
      return res.status(422).json({
        ok: false,
        intentId: intentId || '',
        status: 'unsupported',
        error: {
          stage: 'execute',
          code: 'BASE_LANE_NOT_CONFIGURED',
          message: 'Base settlement lane is not configured. Set Base bUSDC/router/perp addresses before running base-required mode.',
        },
      });
    }
    let fundingPolicySnapshot: any = null;
    let fundingPolicyMode: string | undefined;

    const attachFundingMeta = (payload: any) => {
      const currentFunding =
        payload?.executionMeta?.funding ||
        payload?.metadata?.funding ||
        fundingPolicySnapshot ||
        {
          mode: fundingPolicyMode || 'relayed',
          reasonCode: fundingPolicyMode === 'relayed_after_topup' ? 'RELAYER_TOPUP_OK' : 'RELAYER_OK',
          minUserGasEth: parseFloat(process.env.MIN_USER_GAS_ETH || '0.003'),
          didTopup: fundingPolicyMode === 'relayed_after_topup',
        };
      return {
        ...payload,
        executionMeta: {
          ...(payload?.executionMeta || {}),
          ...(crossChainRouteMeta ? { route: crossChainRouteMeta } : {}),
          funding: currentFunding,
          fundingMode: String(currentFunding?.mode || payload?.mode || fundingPolicyMode || 'relayed'),
        },
      };
    };

    if (!planOnly) {
      void maybeTopUpRelayer(settlementChain, {
        reason: 'ledger_execute_preflight',
        fireAndForget: true,
      });
      const fundingDecision = await executionFundingPolicy({
        chain: settlementChain,
        userAddress: userEvmAddressRaw || undefined,
        // In deterministic prove/stress modes we accept smaller wallet gas balances.
        // Actual transaction submission will still fail if the wallet is truly underfunded.
        minUserGasEthOverride:
          requestedMode === 'tier1_crosschain_resilient'
            ? Number(process.env.PROVE_MIN_USER_GAS_ETH || '0.0001')
            : undefined,
        attemptTopupSync: true,
        topupReason: 'ledger_execute_preflight_sync',
        topupTimeoutMs: Math.max(1_000, parseInt(process.env.RELAYER_TOPUP_SYNC_TIMEOUT_MS || '12000', 10)),
      });
      fundingPolicySnapshot = fundingDecision.executionMetaFunding;
      fundingPolicyMode = fundingDecision.mode;

      if (
        /^0x[a-fA-F0-9]{40}$/.test(userEvmAddressRaw) &&
        (userSolanaAddressRaw.length > 0 || requestedFromChain.toLowerCase().includes('sol'))
      ) {
        const shouldUseUserPaidCreditMint =
          requestedMode === 'tier1_crosschain_resilient' &&
          fundingDecision.mode === 'user_paid_required' &&
          (
            forceCrossChainRoute ||
            String(callerMetadata.scenario || '').toLowerCase().includes('solana_origin_to_sepolia') ||
            String(callerMetadata.scenario || '').toLowerCase().includes('solana_origin_to_base')
          );

        if (shouldUseUserPaidCreditMint) {
          crossChainRouteMeta = {
            didRoute: true,
            routeType: 'testnet_credit',
            fromChain: requestedFromChain || 'solana_devnet',
            toChain: settlementChain,
            reason: 'Wallet-funded cross-chain credit mint required for deterministic execution.',
            creditedAmountUsd: Number.isFinite(amountUsdHint) && amountUsdHint > 0 ? amountUsdHint : undefined,
          };
          // Tell downstream executor to allow a pre-mint collateral gap (mint is submitted first by wallet fallback).
          (callerMetadata as any).assumeSepoliaStableAfterUserCreditMint = true;
          (callerMetadata as any).assumeSettlementStableAfterUserCreditMint = true;
          (callerMetadata as any).creditMintAmountUsd = Number.isFinite(amountUsdHint) && amountUsdHint > 0 ? amountUsdHint : undefined;
        } else {
          const funding = await ensureExecutionFunding({
            userId: String(callerMetadata.userId || userEvmAddressRaw.toLowerCase()),
            sessionId: String(callerMetadata.sessionId || ''),
            userEvmAddress: userEvmAddressRaw,
            userSolanaAddress: userSolanaAddressRaw || undefined,
            fromChain: requestedFromChain || 'solana_devnet',
            toChain: settlementChain,
            amountUsdRequired: Number.isFinite(amountUsdHint) && amountUsdHint > 0 ? amountUsdHint : undefined,
            instrumentType:
              requestedCategory === 'perp' || requestedCategory === 'event' || requestedCategory === 'deposit'
                ? (requestedCategory === 'deposit' ? 'defi' : requestedCategory)
                : undefined,
            forceRoute: forceCrossChainRoute || requestedCategory === 'cross_chain_route',
          });

          if (!funding.ok) {
            return res.status(409).json({
              ok: false,
              intentId: intentId || '',
              status: 'failed',
              error: {
                stage: 'execute',
                code: 'CROSS_CHAIN_ROUTE_FAILED',
                message: funding.userMessage,
                detailCode: funding.code,
              },
              executionMeta: {
                route: funding.route,
                ...(fundingPolicySnapshot ? { funding: fundingPolicySnapshot } : {}),
              },
            });
          }
          crossChainRouteMeta = funding.route;
        }
      }
    }

    if (tier1RelayedRequired && !isTier1RelayedExecutionSupported({ chain: String(chain), category: requestedCategory })) {
      return res.status(422).json({
        ok: false,
        intentId: intentId || '',
        status: 'unsupported',
        error: {
          stage: 'execute',
          code: 'UNSUPPORTED_VENUE',
          message: `Tier1 relayed-required supports ethereum swap/deposit/event/perp only (chain=${chain}, category=${requestedCategory || 'unspecified'})`,
        },
      });
    }

    // If intentId is provided, execute the existing planned intent
    if (intentId && typeof intentId === 'string') {
      const result = await executeIntentById(intentId);
      if (!planOnly && !ALLOW_PROOF_ONLY && result?.ok && result?.metadata?.executedKind === 'proof_only') {
        if (tier1RelayedRequired) {
          return res.status(422).json({
            ok: false,
            intentId,
            status: 'unsupported',
            error: {
              stage: 'execute',
              code: 'UNSUPPORTED_VENUE',
              message: 'Tier1 relayed-required does not permit proof-only fallback for this route.',
            },
            executionMeta: {
              ...(fundingPolicySnapshot ? { funding: fundingPolicySnapshot } : {}),
            },
          });
        }
        return res.status(409).json({
          ok: false,
          intentId,
          status: 'failed',
          error: {
            stage: 'execute',
            code: 'PROOF_ONLY_BLOCKED',
            message: 'Proof-only execution is disabled. Configure venue support or set ALLOW_PROOF_ONLY=true.',
          },
          executionMeta: {
            ...(fundingPolicySnapshot ? { funding: fundingPolicySnapshot } : {}),
          },
        });
      }
      return res.json(attachFundingMeta(result));
    }

    // Build standard metadata with source tracking
    const origin = req.headers.origin || req.headers.referer || 'unknown';

    // Determine source: CLI scripts set source explicitly, UI doesn't
    const source = callerMetadata.source || (origin.includes('localhost') || origin.includes('blossom') ? 'ui' : 'unknown');
    const domain = callerMetadata.domain || (origin !== 'unknown' ? new URL(origin).host : 'unknown');

    const enrichedMetadata = {
      ...callerMetadata,
      source,
      domain,
      timestamp: Date.now(),
    };

    // Validate intentText - record failure if missing
    if (!intentText || typeof intentText !== 'string' || !intentText.trim()) {
      // Record the failed intent so it appears in stats
      const failedResult = await recordFailedIntent({
        intentText: intentText || '',
        failureStage: 'plan',
        errorCode: 'INVALID_REQUEST',
        errorMessage: 'intentText is required (or intentId to execute planned intent)',
        metadata: enrichedMetadata,
      });

      return res.status(400).json(failedResult);
    }

    // Run the intent through the pipeline
    const result = await runIntent(intentText, {
      chain: chain as 'ethereum' | 'solana' | 'hyperliquid' | 'both',
      planOnly: Boolean(planOnly),
      metadata: enrichedMetadata,
    });

    if (!planOnly && !ALLOW_PROOF_ONLY && result?.ok && result?.metadata?.executedKind === 'proof_only') {
      if (tier1RelayedRequired) {
        return res.status(422).json({
          ok: false,
          intentId: result.intentId || '',
          status: 'unsupported',
          error: {
            stage: 'execute',
            code: 'UNSUPPORTED_VENUE',
            message: 'Tier1 relayed-required does not permit proof-only fallback for this route.',
          },
          executionMeta: {
            ...(fundingPolicySnapshot ? { funding: fundingPolicySnapshot } : {}),
          },
        });
      }
      return res.status(409).json({
        ok: false,
        intentId: result.intentId || '',
        status: 'failed',
        error: {
          stage: 'execute',
          code: 'PROOF_ONLY_BLOCKED',
          message: 'Proof-only execution is disabled. Configure venue support or set ALLOW_PROOF_ONLY=true.',
        },
        executionMeta: {
          ...(fundingPolicySnapshot ? { funding: fundingPolicySnapshot } : {}),
        },
      });
    }

    // Return the result with deterministic funding metadata
    res.json(attachFundingMeta(result));
  } catch (error: any) {
    console.error('[ledger] Intent execution error:', error);
    res.status(500).json({
      ok: false,
      intentId: '',
      status: 'failed',
      error: {
        stage: 'execute',
        code: 'INTERNAL_ERROR',
        message: error.message || 'Internal server error',
      },
    });
  }
});

// ============================================
// POSITIONS API ENDPOINTS
// ============================================

/**
 * GET /api/ledger/positions/recent
 * Get recent positions (all statuses)
 */
app.get('/api/ledger/positions/recent', checkLedgerSecret, async (req, res) => {
  try {
    const { getRecentPositions } = await import('../../execution-ledger/db');
    const limit = parseInt(req.query.limit as string) || 20;
    const positions = getRecentPositions(Math.min(limit, 100));
    res.json({ ok: true, positions });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/ledger/positions
 * Get positions with optional filters
 */
app.get('/api/ledger/positions', checkLedgerSecret, async (req, res) => {
  try {
    const { getOpenPositionsAsync } = await import('../../execution-ledger/db');
    const status = req.query.status as string;
    const chain = req.query.chain as string;
    const network = req.query.network as string;
    const venue = req.query.venue as string;
    const userAddress = req.query.userAddress as string;

    let positions;
    if (status === 'open') {
      positions = await getOpenPositionsAsync({ chain, network, venue, user_address: userAddress });
    } else {
      // Default to open positions
      positions = await getOpenPositionsAsync({ chain, network, venue, user_address: userAddress });
    }

    res.json({ ok: true, positions });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/ledger/positions/:id
 * Get a specific position by ID
 */
app.get('/api/ledger/positions/:id', checkLedgerSecret, async (req, res) => {
  try {
    const { getPosition } = await import('../../execution-ledger/db');
    const position = getPosition(req.params.id);

    if (!position) {
      return res.status(404).json({ ok: false, error: 'Position not found' });
    }

    res.json({ ok: true, position });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/ledger/positions/stats
 * Get position statistics
 */
app.get('/api/ledger/positions/stats', checkLedgerSecret, async (req, res) => {
  try {
    const { getPositionStats } = await import('../../execution-ledger/db');
    const stats = getPositionStats();
    res.json({ ok: true, stats });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================
// ACCESS GATE + WAITLIST ENDPOINTS
// ============================================

/**
 * POST /api/access/verify
 * Verify an access code and issue gate pass cookie (public endpoint)
 */
app.post('/api/access/verify', async (req, res) => {
  try {
    const { code, walletAddress } = req.body;

    if (!code) {
      return res.json({ ok: false, authorized: false, error: 'Access code required' });
    }

    const result = await validateAccessCode(code, walletAddress);

    if (result.valid) {
      // Issue gate pass cookie (HTTP-only, secure in production)
      const gatePass = `blossom_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      res.cookie('blossom_gate_pass', gatePass, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      console.log('[access] Gate pass issued successfully');
      return res.json({ ok: true, authorized: true });
    } else {
      return res.json({ ok: false, authorized: false, error: result.error || 'Invalid access code' });
    }
  } catch (error: any) {
    console.error('[access] Verification error:', error.message);
    res.json({ ok: false, authorized: false, error: 'Verification failed' });
  }
});

/**
 * POST /api/access/validate
 * Alias for /api/access/verify (frontend compatibility)
 */
app.post('/api/access/validate', async (req, res) => {
  try {
    const { code, walletAddress } = req.body;

    if (!code) {
      return res.json({ ok: false, valid: false, error: 'Access code required' });
    }

    const result = await validateAccessCode(code, walletAddress);

    if (result.valid) {
      // Issue gate pass cookie
      const gatePass = `blossom_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      res.cookie('blossom_gate_pass', gatePass, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      console.log('[access] Gate pass issued via /validate endpoint');
      return res.json({ ok: true, valid: true });
    } else {
      return res.json({ ok: false, valid: false, error: result.error || 'Invalid access code' });
    }
  } catch (error: any) {
    console.error('[access] Validation error:', error.message);
    res.json({ ok: false, valid: false, error: 'Validation failed' });
  }
});

/**
 * GET /api/access/status
 * Check if user has valid gate pass (public endpoint)
 */
app.get('/api/access/status', async (req, res) => {
  try {
    // Check if gate is enabled (default: ON in production, OFF in dev)
    // Fail-closed: gate is enabled unless explicitly disabled
    const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
    const accessGateDisabled = process.env.ACCESS_GATE_DISABLED === 'true';
    const accessGateEnabled = isProduction ? !accessGateDisabled : (process.env.ACCESS_GATE_ENABLED === 'true');

    if (!accessGateEnabled) {
      // Gate disabled, everyone authorized
      return res.json({ ok: true, authorized: true });
    }

    // Check for gate pass cookie
    const gatePass = req.cookies?.blossom_gate_pass;

    if (gatePass && gatePass.startsWith('blossom_')) {
      // Valid gate pass format
      return res.json({ ok: true, authorized: true });
    }

    // No gate pass
    return res.json({ ok: true, authorized: false });
  } catch (error: any) {
    console.error('[access] Status check error:', error.message);
    res.json({ ok: false, authorized: false, error: 'Status check failed' });
  }
});

/**
 * POST /api/admin/access/generate
 * Generate a new access code (admin-only endpoint)
 * Protected by ADMIN_API_KEY environment variable
 */
app.post('/api/admin/access/generate', async (req, res) => {
  try {
    const adminKey = process.env.ADMIN_API_KEY;
    const providedKey = req.headers['x-admin-key'] || req.headers['authorization']?.replace('Bearer ', '');

    if (!adminKey) {
      console.warn('[admin] ADMIN_API_KEY not configured');
      return res.status(503).json({ ok: false, error: 'Admin API not configured' });
    }

    if (providedKey !== adminKey) {
      console.warn('[admin] Invalid admin key attempt');
      return res.status(403).json({ ok: false, error: 'Invalid admin key' });
    }

    const { maxUses = 1000, expiresInDays, metadata } = req.body;
    const expiresAt = expiresInDays ? Math.floor(Date.now() / 1000) + (expiresInDays * 24 * 60 * 60) : null;

    const accessCode = await createAccessCode(maxUses, expiresAt, metadata);

    if (!accessCode) {
      return res.status(500).json({ ok: false, error: 'Failed to create access code' });
    }

    console.log(`[admin] Created access code: ${accessCode.code.slice(0, 8)}...`);

    res.json({
      ok: true,
      code: accessCode.code,
      maxUses: accessCode.max_uses,
      expiresAt: accessCode.expires_at,
    });
  } catch (error: any) {
    console.error('[admin] Generate code error:', error.message);
    res.status(500).json({ ok: false, error: 'Failed to generate code' });
  }
});

/**
 * GET /api/admin/access/codes
 * List all access codes (admin-only endpoint)
 */
app.get('/api/admin/access/codes', async (req, res) => {
  try {
    const adminKey = process.env.ADMIN_API_KEY;
    const providedKey = req.headers['x-admin-key'] || req.headers['authorization']?.replace('Bearer ', '');

    if (!adminKey) {
      return res.status(503).json({ ok: false, error: 'Admin API not configured' });
    }

    if (providedKey !== adminKey) {
      return res.status(403).json({ ok: false, error: 'Invalid admin key' });
    }

    const codes = await getAllAccessCodes();

    // Mask codes for security (show only first 8 chars)
    const maskedCodes = codes.map(c => ({
      ...c,
      code: `${c.code.slice(0, 12)}...`,
    }));

    res.json({ ok: true, codes: maskedCodes, count: codes.length });
  } catch (error: any) {
    console.error('[admin] List codes error:', error.message);
    res.status(500).json({ ok: false, error: 'Failed to list codes' });
  }
});

/**
 * POST /api/waitlist/join
 * Add email or wallet to waitlist (public endpoint)
 */
app.post('/api/waitlist/join', async (req, res) => {
  try {
    const { email, walletAddress, telegramHandle, twitterHandle, source } = req.body;

    // Require at least one identifier
    if (!email && !walletAddress) {
      return res.status(400).json({ ok: false, error: 'Email or wallet address required' });
    }

    // Basic email validation
    if (email && !email.includes('@')) {
      return res.status(400).json({ ok: false, error: 'Invalid email format' });
    }

    // Basic wallet validation
    if (walletAddress) {
      const isEth = walletAddress.startsWith('0x') && walletAddress.length === 42;
      const isSolana = walletAddress.length >= 32 && walletAddress.length <= 44;
      if (!isEth && !isSolana) {
        return res.status(400).json({ ok: false, error: 'Invalid wallet address format' });
      }
    }

    // Store in database (using Postgres-compatible query)
    try {
      const dbPgClient = await import('../../execution-ledger/db-pg-client');
      const pgQuery = dbPgClient.query;

      // Build metadata object for telegram/twitter handles
      const metadata: Record<string, any> = {};
      if (telegramHandle) metadata.telegramHandle = telegramHandle;
      if (twitterHandle) metadata.twitterHandle = twitterHandle;

      const id = `wl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const now = Math.floor(Date.now() / 1000);

      await pgQuery(`
        INSERT INTO waitlist (id, email, wallet_address, created_at, source, metadata_json)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        id,
        email || null,
        walletAddress || null,
        now,
        source || 'landing',
        Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null
      ]);

      // Don't log actual email/wallet for privacy
      console.log(`[waitlist] New signup from ${source || 'landing'}: ${id.slice(0, 8)}...`);

      res.json({ ok: true, message: 'Successfully joined waitlist' });
    } catch (dbError: any) {
      // If addToWaitlist doesn't exist, store in memory as fallback
      console.log(`[waitlist] DB storage failed, using fallback:`, dbError.message);

      // In-memory fallback (for MVP)
      const waitlistEntries = (global as any).__waitlist || [];
      waitlistEntries.push({
        id: `wl_${Date.now()}`,
        email,
        walletAddress,
        telegramHandle,
        twitterHandle,
        source: source || 'landing',
        createdAt: Date.now(),
      });
      (global as any).__waitlist = waitlistEntries;

      res.json({ ok: true, message: 'Successfully joined waitlist' });
    }
  } catch (error: any) {
    console.error('[waitlist] Join error:', error.message);
    res.status(500).json({ ok: false, error: 'Failed to join waitlist' });
  }
});

/**
 * GET /api/stats/public
 * Public read-only stats endpoint (no auth required)
 */
app.get('/api/stats/public', async (req, res) => {
  try {
    const { getSummaryStatsAsync, getIntentStatsSummaryAsync, getRecentIntentsAsync, getRecentExecutionsAsync, getDatabaseIdentityHash } = await import('../../execution-ledger/db');

    // Get database identity hash for production verification
    const dbIdentityHash = getDatabaseIdentityHash();

    // Return limited public stats (async for Postgres support)
    const [summary, intentStats, recentIntents, recentExecutions] = await Promise.all([
      getSummaryStatsAsync(),
      getIntentStatsSummaryAsync(),
      getRecentIntentsAsync(20),
      getRecentExecutionsAsync(20),
    ]);

    // Sanitize recent intents (remove metadata, keep only safe fields)
    const safeIntents = recentIntents.map(intent => ({
      id: intent.id,
      status: intent.status,
      intent_kind: intent.intent_kind,
      requested_chain: intent.requested_chain,
      created_at: intent.created_at,
      confirmed_at: intent.confirmed_at,
    }));

    // Sanitize recent executions (include txHash, chain, network for explorer links, and USD estimate)
    // Count executions with missing USD estimates for debugging
    const missingUsdCount = recentExecutions.filter(exec =>
      exec.status === 'confirmed' && (exec.usd_estimate === null || exec.usd_estimate === undefined)
    ).length;

    const safeExecutions = recentExecutions.map(exec => {
      const feeBps = summary.feeBps || 25;
      const isSuccessful = exec.status === 'confirmed' || exec.status === 'finalized';
      const feeBlsmUsdc = isSuccessful && exec.usd_estimate ? Number(exec.usd_estimate) * (feeBps / 10000) : 0;
      return ({
      id: exec.id,
      chain: exec.chain,
      network: exec.network,
      kind: exec.kind,
      venue: exec.venue,
      status: exec.status,
      tx_hash: exec.tx_hash,
      explorer_url: exec.explorer_url,
      created_at: exec.created_at,
      intent_id: exec.intent_id,
      usd_estimate: exec.usd_estimate || null,
      amount_display: (exec.amount_display || null)?.replace?.(/\bREDACTED\b/g, 'bUSDC') ?? null,
      fee_blsm_usdc: Math.round(feeBlsmUsdc * 10000) / 10000,
    });
    });

    res.json({
      ok: true,
      data: {
        totalIntents: intentStats.totalIntents || 0,
        confirmedIntents: intentStats.confirmedIntents || 0,
        totalExecutions: summary.totalExecutions || 0,
        successfulExecutions: summary.successfulExecutions || 0,
        successRate: summary.successRate || 0,
        totalUsdRouted: summary.totalUsdRouted || 0,
        totalFeeBlsmUsdc: summary.totalFeeBlsmUsdc || 0,
        feeBps: summary.feeBps || 25,
        feeTokenSymbol: summary.feeTokenSymbol || 'bUSDC',
        feeTreasuryAddress: summary.feeTreasuryAddress || null,
        uniqueWallets: summary.uniqueWallets || 0,
        chainsActive: summary.chainsActive || [],
        recentIntents: safeIntents || [],
        recentExecutions: safeExecutions || [],
        missingUsdEstimateCount: missingUsdCount,
        dbIdentityHash,
        lastUpdated: Date.now(),
      },
    });
  } catch (error: any) {
    console.error('Public stats error:', error.message);
    // Return empty stats on error (don't expose internal errors)
    res.json({
      ok: true,
      data: {
        totalIntents: 0,
        confirmedIntents: 0,
        totalExecutions: 0,
        successfulExecutions: 0,
        successRate: 0,
        totalUsdRouted: 0,
        totalFeeBlsmUsdc: 0,
        feeBps: 25,
        feeTokenSymbol: 'bUSDC',
        feeTreasuryAddress: null,
        chainsActive: [],
        recentIntents: [],
        recentExecutions: [],
        lastUpdated: Date.now(),
      },
    });
  }
});

// ============================================
// ERC-8004 TRUSTLESS AI AGENTS ENDPOINTS
// ============================================

/**
 * GET /api/erc8004/identity
 * Returns the agent's ERC-8004 identity information
 */
app.get('/api/erc8004/identity', asyncHandler(async (req, res) => {
  try {
    const {
      ERC8004_ENABLED,
      getAgentIdentity,
      isAgentRegistered,
    } = await import('../erc8004/index.js');

    if (!ERC8004_ENABLED) {
      return res.json({
        ok: false,
        error: 'ERC-8004 integration is disabled',
        enabled: false,
      });
    }

    const identity = getAgentIdentity();
    const registered = isAgentRegistered();

    res.json({
      ok: true,
      enabled: true,
      registered,
      identity: identity
        ? {
            agentId: identity.agentId.toString(),
            owner: identity.owner,
            agentURI: identity.agentURI,
            chainId: identity.chainId,
            registryAddress: identity.registryAddress,
            fullyQualifiedId: identity.fullyQualifiedId,
          }
        : null,
    });
  } catch (error: any) {
    console.error('[erc8004] Identity endpoint error:', error.message);
    res.status(500).json({
      ok: false,
      error: 'Failed to get agent identity',
      details: error.message,
    });
  }
}));

/**
 * GET /api/erc8004/reputation
 * Returns the agent's reputation score derived from execution stats
 */
app.get('/api/erc8004/reputation', asyncHandler(async (req, res) => {
  try {
    const {
      ERC8004_ENABLED,
      getReputationSummary,
      formatReputationScore,
      getReputationTier,
    } = await import('../erc8004/index.js');

    if (!ERC8004_ENABLED) {
      return res.json({
        ok: false,
        error: 'ERC-8004 integration is disabled',
        enabled: false,
      });
    }

    const reputation = await getReputationSummary();

    if (!reputation) {
      return res.json({
        ok: true,
        enabled: true,
        reputation: null,
        message: 'No reputation data available',
      });
    }

    res.json({
      ok: true,
      enabled: true,
      reputation: {
        agentId: reputation.agentId.toString(),
        score: reputation.averageScore,
        scoreFormatted: formatReputationScore(reputation.averageScore),
        tier: getReputationTier(reputation.averageScore),
        winRate: Math.round(reputation.winRate * 100) / 100,
        executionCount: reputation.executionCount,
        totalVolumeUsd: Math.round(reputation.totalVolumeUsd * 100) / 100,
        avgLatencyMs: reputation.avgLatencyMs,
        totalFeedbackCount: reputation.totalFeedbackCount,
        byCategory: reputation.byCategory,
        updatedAt: reputation.updatedAt,
      },
    });
  } catch (error: any) {
    console.error('[erc8004] Reputation endpoint error:', error.message);
    res.status(500).json({
      ok: false,
      error: 'Failed to get reputation summary',
      details: error.message,
    });
  }
}));

/**
 * GET /api/erc8004/capabilities
 * Returns the agent's declared capabilities
 */
app.get('/api/erc8004/capabilities', asyncHandler(async (req, res) => {
  try {
    const {
      ERC8004_ENABLED,
      getBlossomCapabilities,
      getCapabilitySummary,
    } = await import('../erc8004/index.js');

    if (!ERC8004_ENABLED) {
      return res.json({
        ok: false,
        error: 'ERC-8004 integration is disabled',
        enabled: false,
      });
    }

    const capabilities = getBlossomCapabilities();
    const summary = getCapabilitySummary();

    res.json({
      ok: true,
      enabled: true,
      capabilities,
      summary,
      count: capabilities.length,
    });
  } catch (error: any) {
    console.error('[erc8004] Capabilities endpoint error:', error.message);
    res.status(500).json({
      ok: false,
      error: 'Failed to get capabilities',
      details: error.message,
    });
  }
}));

/**
 * POST /api/erc8004/validate
 * Validates an action against declared capabilities
 */
app.post('/api/erc8004/validate', asyncHandler(async (req, res) => {
  try {
    const {
      ERC8004_ENABLED,
      validateActionAgainstCapabilities,
    } = await import('../erc8004/index.js');

    if (!ERC8004_ENABLED) {
      return res.json({
        ok: false,
        error: 'ERC-8004 integration is disabled',
        enabled: false,
      });
    }

    const { kind, chain, venue, asset, leverage, amountUsd } = req.body;

    if (!kind) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required field: kind',
      });
    }

    const result = validateActionAgainstCapabilities({
      kind,
      chain,
      venue,
      asset,
      leverage,
      amountUsd,
    });

    res.json({
      ok: true,
      validation: result,
    });
  } catch (error: any) {
    console.error('[erc8004] Validate endpoint error:', error.message);
    res.status(500).json({
      ok: false,
      error: 'Failed to validate action',
      details: error.message,
    });
  }
}));

/**
 * GET /.well-known/agent-registration.json
 * ERC-8004 standard discovery endpoint for agent registration
 */
app.get('/.well-known/agent-registration.json', asyncHandler(async (req, res) => {
  try {
    const { buildBlossomRegistrationFile } = await import('../erc8004/index.js');

    const registrationFile = buildBlossomRegistrationFile();

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    res.json(registrationFile);
  } catch (error: any) {
    console.error('[erc8004] Registration file error:', error.message);
    res.status(500).json({
      error: 'Failed to generate registration file',
      details: error.message,
    });
  }
}));

/**
 * GET /api/erc8004/feedback
 * Returns ERC-8004 feedback statistics
 */
app.get('/api/erc8004/feedback', asyncHandler(async (req, res) => {
  try {
    const {
      ERC8004_ENABLED,
      ERC8004_AGENT_ID,
    } = await import('../erc8004/index.js');

    if (!ERC8004_ENABLED) {
      return res.json({
        ok: false,
        error: 'ERC-8004 integration is disabled',
        enabled: false,
      });
    }

    const { getERC8004FeedbackStats, getERC8004Feedback } = await import('../../execution-ledger/db.js');

    const agentId = ERC8004_AGENT_ID?.toString() || '0';
    const stats = getERC8004FeedbackStats(agentId);
    const recentFeedback = getERC8004Feedback({ agentId, limit: 10 });

    res.json({
      ok: true,
      enabled: true,
      agentId,
      stats,
      recentFeedback: recentFeedback.map((f) => ({
        id: f.id,
        category: f.category,
        score: f.score,
        amountUsd: f.amount_usd,
        submittedOnchain: f.submitted_onchain === 1,
        createdAt: f.created_at,
      })),
    });
  } catch (error: any) {
    console.error('[erc8004] Feedback endpoint error:', error.message);
    res.status(500).json({
      ok: false,
      error: 'Failed to get feedback stats',
      details: error.message,
    });
  }
}));

// ============================================
// SECURITY MONITORING ENDPOINTS
// ============================================

/**
 * GET /api/security/alerts
 * Returns security alerts for monitoring dashboard
 */
app.get('/api/security/alerts', asyncHandler(async (req, res) => {
  try {
    const { getAlerts, getAlertMetrics, getSecurityHealth } = await import('../security/index.js');

    const category = req.query.category as string | undefined;
    const severity = req.query.severity as string | undefined;
    const unacknowledgedOnly = req.query.unacknowledged === 'true';
    const limit = parseInt(req.query.limit as string) || 50;

    const alerts = getAlerts({
      category: category as any,
      severity: severity as any,
      unacknowledgedOnly,
      limit,
    });

    const metrics = getAlertMetrics();
    const health = getSecurityHealth();

    res.json({
      ok: true,
      alerts,
      metrics,
      health,
    });
  } catch (error: any) {
    console.error('[security] Alerts endpoint error:', error.message);
    res.status(500).json({
      ok: false,
      error: 'Failed to get security alerts',
    });
  }
}));

/**
 * POST /api/security/alerts/:id/acknowledge
 * Acknowledge a security alert
 */
app.post('/api/security/alerts/:id/acknowledge', asyncHandler(async (req, res) => {
  try {
    const { acknowledgeAlert } = await import('../security/index.js');

    const alertId = req.params.id;
    const acknowledgedBy = req.body.acknowledgedBy || 'admin';

    const success = acknowledgeAlert(alertId, acknowledgedBy);

    res.json({
      ok: success,
      message: success ? 'Alert acknowledged' : 'Alert not found',
    });
  } catch (error: any) {
    console.error('[security] Acknowledge error:', error.message);
    res.status(500).json({
      ok: false,
      error: 'Failed to acknowledge alert',
    });
  }
}));

/**
 * GET /api/security/path-violations
 * Returns path violation summary for monitoring
 */
app.get('/api/security/path-violations', asyncHandler(async (req, res) => {
  try {
    const { getPathViolations, getViolationSummary } = await import('../security/index.js');

    const limit = parseInt(req.query.limit as string) || 50;
    const since = req.query.since ? parseInt(req.query.since as string) : undefined;

    const violations = getPathViolations({ limit, since });
    const summary = getViolationSummary();

    res.json({
      ok: true,
      violations,
      summary,
    });
  } catch (error: any) {
    console.error('[security] Path violations endpoint error:', error.message);
    res.status(500).json({
      ok: false,
      error: 'Failed to get path violations',
    });
  }
}));

/**
 * GET /api/security/signing-audit
 * Returns signing decision audit log
 */
app.get('/api/security/signing-audit', asyncHandler(async (req, res) => {
  try {
    const { getSigningAudit, getSigningAuditSummary } = await import('../security/index.js');

    const limit = parseInt(req.query.limit as string) || 50;
    const operation = req.query.operation as string | undefined;

    const entries = getSigningAudit({
      limit,
      operation: operation as any,
    });
    const summary = getSigningAuditSummary();

    res.json({
      ok: true,
      entries,
      summary,
    });
  } catch (error: any) {
    console.error('[security] Signing audit endpoint error:', error.message);
    res.status(500).json({
      ok: false,
      error: 'Failed to get signing audit',
    });
  }
}));

/**
 * POST /api/security/fuzz-test
 * Run fuzz tests against intent parser (dev/staging only)
 */
app.post('/api/security/fuzz-test', asyncHandler(async (req, res) => {
  try {
    // Only allow in non-production environments
    if (process.env.NODE_ENV === 'production' && !req.query.force) {
      return res.status(403).json({
        ok: false,
        error: 'Fuzz testing disabled in production',
      });
    }

    const { runFuzzSuite } = await import('../security/index.js');

    // Mock parser for testing
    const mockParser = async (input: string) => {
      // This would be replaced with actual intent parsing in real tests
      return { kind: 'swap', rawInput: input } as any;
    };

    const categories = req.body.categories as string[] | undefined;
    const results = await runFuzzSuite(mockParser, categories as any);

    res.json({
      ok: true,
      results: {
        total: results.total,
        passed: results.passed,
        failed: results.failed,
        passRate: Math.round((results.passed / results.total) * 100),
        details: results.results.filter(r => !r.passed),
      },
    });
  } catch (error: any) {
    console.error('[security] Fuzz test endpoint error:', error.message);
    res.status(500).json({
      ok: false,
      error: 'Fuzz test failed',
      details: error.message,
    });
  }
}));

// ============================================
// OBSERVABILITY: Central Error Handler
// ============================================

/**
 * Central error handler for uncaught errors
 * - Logs full error details in dev only (stack/cause)
 * - Returns structured JSON response
 * - Includes correlationId for tracing
 */
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const correlationId = req.correlationId || 'unknown';

  if (SENTRY_ENABLED) {
    Sentry.captureException(err, {
      tags: {
        correlationId,
        path: req.path,
        method: req.method,
      },
    });
  }
  
  // Log error details (dev only for full stack)
  const errorLog: Record<string, any> = {
    correlationId,
    name: err.name || 'Error',
    message: err.message || 'Unknown error',
    code: err.code,
    path: req.path,
    method: req.method,
  };
  
  if (process.env.NODE_ENV !== 'production') {
    errorLog.stack = err.stack;
    errorLog.cause = err.cause;
  }
  
  console.error(`[${correlationId}] [ERROR] Unhandled error:`, JSON.stringify(errorLog, null, 2));
  
  // Build response (don't expose stack in production)
  const errorResponse: Record<string, any> = {
    ok: false,
    correlationId,
    error: {
      message: err.message || 'Internal server error',
      code: err.code || 'INTERNAL_ERROR',
    },
  };
  
  if (process.env.NODE_ENV !== 'production') {
    errorResponse.error.stack = err.stack;
  }
  
  res.status(err.status || 500).json(errorResponse);
});
