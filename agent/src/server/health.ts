/**
 * Health Check Module
 *
 * Provides comprehensive health check functionality for production monitoring.
 * Endpoints:
 * - /health - Basic liveness check
 * - /api/health - Extended health with component status
 * - /api/rpc/health - RPC provider health with failover status
 * - /api/health/deep - Deep health check (database, providers, etc.)
 */

import type { Express, Request, Response } from 'express';

// Health check result type
export interface HealthCheckResult {
  ok: boolean;
  component: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs?: number;
  error?: string;
  details?: Record<string, any>;
}

export interface DeepHealthResult {
  ok: boolean;
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  components: {
    database: HealthCheckResult;
    rpc: HealthCheckResult;
    llm: HealthCheckResult;
    redis?: HealthCheckResult;
  };
  metrics: {
    memoryUsageMB: number;
    memoryLimitMB: number;
    cpuUsage?: number;
  };
}

// Module start time for uptime calculation
const startTime = Date.now();

/**
 * Get build version from environment
 */
function getVersion(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  }
  try {
    const { execSync } = require('child_process');
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Check database connectivity
 */
async function checkDatabase(): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const { getDatabaseIdentityHash } = await import('../../execution-ledger/db');
    const hash = getDatabaseIdentityHash();
    return {
      ok: true,
      component: 'database',
      status: 'healthy',
      latencyMs: Date.now() - start,
      details: {
        identityHash: hash?.slice(0, 8) || 'unknown',
        type: process.env.DATABASE_URL ? 'postgres' : 'sqlite',
      },
    };
  } catch (error: any) {
    return {
      ok: false,
      component: 'database',
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      error: error.message?.slice(0, 100),
    };
  }
}

/**
 * Check RPC provider connectivity
 */
async function checkRPC(): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const { getProviderHealthStatus } = await import('../providers/rpcProvider');
    const status = getProviderHealthStatus();

    // Collect all providers into an array
    const providers: any[] = [];
    if (status.primary) providers.push({ ...status.primary, name: 'primary' });
    if (status.fallbacks) providers.push(...status.fallbacks.map((f: any, i: number) => ({ ...f, name: `fallback-${i}` })));

    const healthyProviders = providers.filter((p: any) => !p.circuitOpen).length;
    const totalProviders = providers.length;

    return {
      ok: healthyProviders > 0,
      component: 'rpc',
      status: healthyProviders === totalProviders ? 'healthy' : healthyProviders > 0 ? 'degraded' : 'unhealthy',
      latencyMs: Date.now() - start,
      details: {
        healthyProviders,
        totalProviders,
        activeProvider: status.active,
        providers: providers.map((p: any) => ({
          name: p.name,
          healthy: !p.circuitOpen,
        })),
      },
    };
  } catch (error: any) {
    return {
      ok: false,
      component: 'rpc',
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      error: error.message?.slice(0, 100),
    };
  }
}

/**
 * Check LLM provider connectivity
 */
async function checkLLM(): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const provider = process.env.BLOSSOM_MODEL_PROVIDER || 'stub';
    const hasKey = !!(
      process.env.BLOSSOM_GEMINI_API_KEY ||
      process.env.BLOSSOM_OPENAI_API_KEY ||
      process.env.BLOSSOM_ANTHROPIC_API_KEY
    );

    // For stub provider, always healthy
    if (provider === 'stub') {
      return {
        ok: true,
        component: 'llm',
        status: 'healthy',
        latencyMs: Date.now() - start,
        details: { provider: 'stub', mode: 'mock' },
      };
    }

    return {
      ok: hasKey,
      component: 'llm',
      status: hasKey ? 'healthy' : 'degraded',
      latencyMs: Date.now() - start,
      details: {
        provider,
        configured: hasKey,
      },
    };
  } catch (error: any) {
    return {
      ok: false,
      component: 'llm',
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      error: error.message?.slice(0, 100),
    };
  }
}

/**
 * Get memory metrics
 */
function getMemoryMetrics(): { memoryUsageMB: number; memoryLimitMB: number } {
  const usage = process.memoryUsage();
  const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);

  // Vercel functions have 1024MB limit by default
  const limitMB = parseInt(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE || '1024', 10);

  return {
    memoryUsageMB: heapUsedMB,
    memoryLimitMB: limitMB,
  };
}

/**
 * Perform deep health check
 */
export async function performDeepHealthCheck(): Promise<DeepHealthResult> {
  const [database, rpc, llm] = await Promise.all([
    checkDatabase(),
    checkRPC(),
    checkLLM(),
  ]);

  const allOk = database.ok && rpc.ok && llm.ok;
  const metrics = getMemoryMetrics();

  return {
    ok: allOk,
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: getVersion(),
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    components: {
      database,
      rpc,
      llm,
    },
    metrics,
  };
}

/**
 * Register health check endpoints on Express app
 */
export function registerHealthEndpoints(app: Express): void {
  // Basic liveness check
  app.get('/health/liveness', (req: Request, res: Response) => {
    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
    });
  });

  // Readiness check (can serve traffic)
  app.get('/health/readiness', async (req: Request, res: Response) => {
    try {
      const result = await performDeepHealthCheck();
      const httpStatus = result.ok ? 200 : 503;

      res.status(httpStatus).json({
        ready: result.ok,
        timestamp: result.timestamp,
        components: Object.fromEntries(
          Object.entries(result.components).map(([k, v]) => [k, v.status])
        ),
      });
    } catch (error: any) {
      res.status(503).json({
        ready: false,
        error: error.message,
      });
    }
  });

  // Deep health check (detailed diagnostics)
  app.get('/api/health/deep', async (req: Request, res: Response) => {
    try {
      const result = await performDeepHealthCheck();
      const httpStatus = result.ok ? 200 : 503;

      res.status(httpStatus).json(result);
    } catch (error: any) {
      res.status(500).json({
        ok: false,
        error: error.message,
      });
    }
  });

  // Startup probe (for Kubernetes-style deployments)
  app.get('/health/startup', async (req: Request, res: Response) => {
    try {
      // Check critical components are initialized
      const db = await checkDatabase();

      if (db.ok) {
        res.json({
          started: true,
          timestamp: new Date().toISOString(),
        });
      } else {
        res.status(503).json({
          started: false,
          error: 'Database not ready',
        });
      }
    } catch (error: any) {
      res.status(503).json({
        started: false,
        error: error.message,
      });
    }
  });
}

/**
 * Health check middleware for monitoring
 * Logs health status periodically
 */
export function startHealthMonitor(intervalMs: number = 60000): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const result = await performDeepHealthCheck();

      if (!result.ok) {
        console.warn('[health] Degraded system health:', JSON.stringify({
          database: result.components.database.status,
          rpc: result.components.rpc.status,
          llm: result.components.llm.status,
          memoryUsageMB: result.metrics.memoryUsageMB,
        }));
      }

      // Log memory usage if getting high
      const memoryUsagePercent = (result.metrics.memoryUsageMB / result.metrics.memoryLimitMB) * 100;
      if (memoryUsagePercent > 80) {
        console.warn(`[health] High memory usage: ${memoryUsagePercent.toFixed(1)}%`);
      }
    } catch (error: any) {
      console.error('[health] Health check failed:', error.message);
    }
  }, intervalMs);
}

export default {
  registerHealthEndpoints,
  performDeepHealthCheck,
  startHealthMonitor,
  checkDatabase,
  checkRPC,
  checkLLM,
};
