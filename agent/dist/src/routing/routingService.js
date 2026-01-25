/**
 * Unified Routing Service
 * Sprint 3: dFlow routing with truthful metadata and deterministic fallback
 *
 * Rules:
 * - ROUTING_MODE='dflow' => hard fail if dFlow unavailable (return DFLOW_REQUIRED error)
 * - ROUTING_MODE='hybrid' => dFlow first, then fallback
 * - ROUTING_MODE='deterministic' => never call dFlow (always fallback)
 * - All responses include routing metadata (source, ok, reason, latencyMs)
 * - NEVER log API keys or include them in responses
 */
import { DFLOW_ENABLED, ROUTING_MODE, } from '../config';
import { isDflowConfigured, isDflowCapabilityAvailable, getSwapQuote as dflowGetSwapQuote, getEventMarkets as dflowGetEventMarkets, } from '../integrations/dflow/dflowClient';
import { makeCorrelationId } from '../utils/correlationId';
// DEV-ONLY: Force dFlow failure/timeout for testing
const DFLOW_FORCE_FAIL = process.env.DFLOW_FORCE_FAIL === 'true' && process.env.NODE_ENV !== 'production';
const DFLOW_FORCE_TIMEOUT = process.env.DFLOW_FORCE_TIMEOUT === 'true' && process.env.NODE_ENV !== 'production';
// DEV-ONLY: Track dFlow call count for deterministic mode proof
let dflowCallCount = 0;
let lastDflowCallAt = null;
export function getRoutingStats() {
    return { dflowCallCount, lastDflowCallAt };
}
export function resetRoutingStats() {
    dflowCallCount = 0;
    lastDflowCallAt = null;
}
/**
 * Get swap quote with routing metadata
 */
export async function getSwapQuoteRouted(params) {
    const startTime = Date.now();
    const correlationId = params.correlationId || makeCorrelationId('swap');
    const { tokenIn, tokenOut, amountIn, slippageBps, chainId, fallbackQuote } = params;
    // DEV-ONLY: Log routing request
    if (process.env.NODE_ENV !== 'production') {
        console.log(`[ROUTING] kind=swap_quote mode=${ROUTING_MODE} corr=${correlationId}`);
    }
    // ROUTING_MODE='deterministic' => never call dFlow
    if (ROUTING_MODE === 'deterministic') {
        if (fallbackQuote) {
            const fallbackData = await fallbackQuote();
            const latencyMs = Date.now() - startTime;
            if (fallbackData) {
                // DEV-ONLY: Log routing result
                if (process.env.NODE_ENV !== 'production') {
                    console.log(`[ROUTING] kind=swap_quote source=fallback latencyMs=${latencyMs} corr=${correlationId}`);
                }
                return {
                    ok: true,
                    data: {
                        tokenIn,
                        tokenOut,
                        amountIn,
                        amountOut: fallbackData.amountOut,
                        minAmountOut: fallbackData.minAmountOut,
                        slippageBps: slippageBps || 50,
                        routeSummary: fallbackData.routeSummary,
                        gas: fallbackData.gas,
                    },
                    routing: {
                        source: 'fallback',
                        kind: 'swap_quote',
                        ok: true,
                        reason: 'ROUTING_MODE=deterministic (dFlow disabled)',
                        latencyMs,
                        mode: 'deterministic',
                        correlationId,
                    },
                };
            }
        }
        const latencyMs = Date.now() - startTime;
        return {
            ok: false,
            routing: {
                source: 'fallback',
                kind: 'swap_quote',
                ok: false,
                reason: 'ROUTING_MODE=deterministic and fallback unavailable',
                latencyMs,
                mode: 'deterministic',
                correlationId,
            },
            error: {
                code: 'FALLBACK_UNAVAILABLE',
                message: 'Deterministic routing mode requires fallback quote provider',
            },
        };
    }
    // ROUTING_MODE='dflow' => hard fail if dFlow unavailable
    if (ROUTING_MODE === 'dflow') {
        if (!isDflowConfigured() || !isDflowCapabilityAvailable('swapsQuotes')) {
            const latencyMs = Date.now() - startTime;
            return {
                ok: false,
                routing: {
                    source: 'dflow',
                    kind: 'swap_quote',
                    ok: false,
                    reason: 'dFlow not configured or swapsQuotes capability unavailable',
                    latencyMs,
                    mode: ROUTING_MODE,
                    correlationId,
                },
                error: {
                    code: 'DFLOW_REQUIRED',
                    message: 'ROUTING_MODE=dflow requires dFlow to be configured and available',
                },
            };
        }
        // Try dFlow (or force fail/timeout in DEV mode)
        if (DFLOW_FORCE_FAIL) {
            const latencyMs = Date.now() - startTime;
            return {
                ok: false,
                routing: {
                    source: 'dflow',
                    kind: 'swap_quote',
                    ok: false,
                    reason: 'DEV: DFLOW_FORCE_FAIL=true (testing fallback)',
                    latencyMs,
                    mode: 'dflow',
                    correlationId,
                },
                error: {
                    code: 'DFLOW_REQUIRED',
                    message: 'dFlow routing required but forced to fail (DEV mode)',
                },
            };
        }
        if (DFLOW_FORCE_TIMEOUT) {
            // Simulate timeout by waiting longer than default timeout (10s)
            await new Promise(resolve => setTimeout(resolve, 11000));
        }
        // Track dFlow call (for deterministic mode proof)
        dflowCallCount++;
        lastDflowCallAt = Date.now();
        const dflowResult = await dflowGetSwapQuote({
            tokenIn,
            tokenOut,
            amountIn,
            slippageBps,
            chainId,
        });
        const latencyMs = Date.now() - startTime;
        // DEV-ONLY: Log routing result
        if (process.env.NODE_ENV !== 'production') {
            console.log(`[ROUTING] kind=swap_quote source=${dflowResult.ok ? 'dflow' : 'fallback'} latencyMs=${latencyMs} corr=${correlationId}`);
        }
        if (dflowResult.ok && dflowResult.data) {
            return {
                ok: true,
                data: {
                    tokenIn: dflowResult.data.tokenIn,
                    tokenOut: dflowResult.data.tokenOut,
                    amountIn: dflowResult.data.amountIn,
                    amountOut: dflowResult.data.amountOut,
                    minAmountOut: dflowResult.data.minAmountOut,
                    slippageBps: dflowResult.data.slippageBps,
                    route: dflowResult.data.route,
                    routeSummary: dflowResult.data.routeSummary,
                    gas: dflowResult.data.gas,
                    priceImpact: dflowResult.data.priceImpact,
                },
                routing: {
                    source: 'dflow',
                    kind: 'swap_quote',
                    ok: true,
                    latencyMs,
                    mode: 'dflow',
                    correlationId,
                },
            };
        }
        // dFlow failed in dflow mode => hard fail
        const errorReason = dflowResult.error || (DFLOW_FORCE_TIMEOUT ? 'timeout' : `HTTP ${dflowResult.statusCode || 'unknown'}`);
        return {
            ok: false,
            routing: {
                source: 'dflow',
                kind: 'swap_quote',
                ok: false,
                reason: errorReason,
                latencyMs,
                mode: 'dflow',
                correlationId,
            },
            error: {
                code: 'DFLOW_REQUIRED',
                message: `dFlow routing required but failed: ${errorReason}`,
            },
        };
    }
    // ROUTING_MODE='hybrid' => dFlow first, then fallback
    if (ROUTING_MODE === 'hybrid' || DFLOW_ENABLED) {
        // Try dFlow first (unless forced to fail/timeout in DEV)
        if (!DFLOW_FORCE_FAIL && !DFLOW_FORCE_TIMEOUT && isDflowConfigured() && isDflowCapabilityAvailable('swapsQuotes')) {
            // Track dFlow call
            dflowCallCount++;
            lastDflowCallAt = Date.now();
            const dflowResult = await dflowGetSwapQuote({
                tokenIn,
                tokenOut,
                amountIn,
                slippageBps,
                chainId,
            });
            const latencyMs = Date.now() - startTime;
            // DEV-ONLY: Log routing result
            if (process.env.NODE_ENV !== 'production') {
                console.log(`[ROUTING] kind=swap_quote source=${dflowResult.ok ? 'dflow' : 'fallback'} latencyMs=${latencyMs} corr=${correlationId}`);
            }
            if (dflowResult.ok && dflowResult.data) {
                return {
                    ok: true,
                    data: {
                        tokenIn: dflowResult.data.tokenIn,
                        tokenOut: dflowResult.data.tokenOut,
                        amountIn: dflowResult.data.amountIn,
                        amountOut: dflowResult.data.amountOut,
                        minAmountOut: dflowResult.data.minAmountOut,
                        slippageBps: dflowResult.data.slippageBps,
                        route: dflowResult.data.route,
                        routeSummary: dflowResult.data.routeSummary,
                        gas: dflowResult.data.gas,
                        priceImpact: dflowResult.data.priceImpact,
                    },
                    routing: {
                        source: 'dflow',
                        kind: 'swap_quote',
                        ok: true,
                        latencyMs,
                        mode: ROUTING_MODE,
                        correlationId,
                    },
                };
            }
            // dFlow failed, try fallback
            if (fallbackQuote) {
                const fallbackStartTime = Date.now();
                const fallbackData = await fallbackQuote();
                const totalLatencyMs = Date.now() - startTime;
                if (fallbackData) {
                    const fallbackReason = DFLOW_FORCE_FAIL
                        ? 'DEV: DFLOW_FORCE_FAIL=true (forced_fail)'
                        : DFLOW_FORCE_TIMEOUT
                            ? 'DEV: DFLOW_FORCE_TIMEOUT=true (timeout)'
                            : `dFlow failed: ${dflowResult.error || `HTTP ${dflowResult.statusCode || 'unknown'}`}`;
                    return {
                        ok: true,
                        data: {
                            tokenIn,
                            tokenOut,
                            amountIn,
                            amountOut: fallbackData.amountOut,
                            minAmountOut: fallbackData.minAmountOut,
                            slippageBps: slippageBps || 50,
                            routeSummary: fallbackData.routeSummary,
                            gas: fallbackData.gas,
                        },
                        routing: {
                            source: 'fallback',
                            kind: 'swap_quote',
                            ok: true,
                            reason: fallbackReason,
                            latencyMs: totalLatencyMs,
                            mode: ROUTING_MODE,
                            correlationId,
                        },
                    };
                }
            }
            // Both dFlow and fallback failed
            const errorReason = DFLOW_FORCE_TIMEOUT ? 'timeout' : (dflowResult.error || `HTTP ${dflowResult.statusCode || 'unknown'}`);
            return {
                ok: false,
                routing: {
                    source: 'dflow',
                    kind: 'swap_quote',
                    ok: false,
                    reason: errorReason,
                    latencyMs,
                    mode: ROUTING_MODE,
                    correlationId,
                },
                error: {
                    code: 'ROUTING_FAILED',
                    message: `dFlow failed and fallback unavailable: ${errorReason}`,
                },
            };
        }
    }
    // dFlow not enabled or not available, use fallback
    if (fallbackQuote) {
        const fallbackData = await fallbackQuote();
        const latencyMs = Date.now() - startTime;
        if (fallbackData) {
            return {
                ok: true,
                data: {
                    tokenIn,
                    tokenOut,
                    amountIn,
                    amountOut: fallbackData.amountOut,
                    minAmountOut: fallbackData.minAmountOut,
                    slippageBps: slippageBps || 50,
                    routeSummary: fallbackData.routeSummary,
                    gas: fallbackData.gas,
                },
                routing: {
                    source: 'fallback',
                    kind: 'swap_quote',
                    ok: true,
                    reason: 'dFlow not enabled or unavailable',
                    latencyMs,
                    mode: ROUTING_MODE,
                    correlationId,
                },
            };
        }
    }
    // No routing available
    const latencyMs = Date.now() - startTime;
    return {
        ok: false,
        routing: {
            source: 'fallback',
            kind: 'swap_quote',
            ok: false,
            reason: 'No routing providers available',
            latencyMs,
            mode: ROUTING_MODE,
            correlationId,
        },
        error: {
            code: 'ROUTING_UNAVAILABLE',
            message: 'No swap quote routing available',
        },
    };
}
/**
 * Get event markets with routing metadata
 */
export async function getEventMarketsRouted(params) {
    const startTime = Date.now();
    const correlationId = params.correlationId || makeCorrelationId('markets');
    const { limit = 10, fallbackMarkets } = params;
    // DEV-ONLY: Log routing request
    if (process.env.NODE_ENV !== 'production') {
        console.log(`[ROUTING] kind=event_markets mode=${ROUTING_MODE} corr=${correlationId}`);
    }
    // ROUTING_MODE='deterministic' => never call dFlow
    if (ROUTING_MODE === 'deterministic') {
        if (fallbackMarkets) {
            const fallbackData = await fallbackMarkets();
            const latencyMs = Date.now() - startTime;
            // DEV-ONLY: Log routing result
            if (process.env.NODE_ENV !== 'production') {
                console.log(`[ROUTING] kind=event_markets source=fallback latencyMs=${latencyMs} corr=${correlationId}`);
            }
            return {
                ok: true,
                data: fallbackData.slice(0, limit),
                routing: {
                    source: 'fallback',
                    kind: 'event_markets',
                    ok: true,
                    reason: 'ROUTING_MODE=deterministic (dFlow disabled)',
                    latencyMs,
                    mode: 'deterministic',
                    correlationId,
                },
            };
        }
        const latencyMs = Date.now() - startTime;
        return {
            ok: false,
            routing: {
                source: 'fallback',
                kind: 'event_markets',
                ok: false,
                reason: 'ROUTING_MODE=deterministic and fallback unavailable',
                latencyMs,
                mode: 'deterministic',
                correlationId,
            },
            error: {
                code: 'FALLBACK_UNAVAILABLE',
                message: 'Deterministic routing mode requires fallback markets provider',
            },
        };
    }
    // ROUTING_MODE='dflow' => hard fail if dFlow unavailable
    if (ROUTING_MODE === 'dflow') {
        if (!isDflowConfigured() || !isDflowCapabilityAvailable('eventsMarkets')) {
            const latencyMs = Date.now() - startTime;
            return {
                ok: false,
                routing: {
                    source: 'dflow',
                    kind: 'event_markets',
                    ok: false,
                    reason: 'dFlow not configured or eventsMarkets capability unavailable',
                    latencyMs,
                    mode: ROUTING_MODE,
                    correlationId,
                },
                error: {
                    code: 'DFLOW_REQUIRED',
                    message: 'ROUTING_MODE=dflow requires dFlow to be configured and available',
                },
            };
        }
        // Try dFlow (or force fail/timeout in DEV mode)
        if (DFLOW_FORCE_FAIL) {
            const latencyMs = Date.now() - startTime;
            return {
                ok: false,
                routing: {
                    source: 'dflow',
                    kind: 'event_markets',
                    ok: false,
                    reason: 'DEV: DFLOW_FORCE_FAIL=true (testing fallback)',
                    latencyMs,
                    mode: 'dflow',
                    correlationId,
                },
                error: {
                    code: 'DFLOW_REQUIRED',
                    message: 'dFlow routing required but forced to fail (DEV mode)',
                },
            };
        }
        if (DFLOW_FORCE_TIMEOUT) {
            // Simulate timeout by waiting longer than default timeout (10s)
            await new Promise(resolve => setTimeout(resolve, 11000));
        }
        // Track dFlow call
        dflowCallCount++;
        lastDflowCallAt = Date.now();
        const dflowResult = await dflowGetEventMarkets();
        const latencyMs = Date.now() - startTime;
        // DEV-ONLY: Log routing result
        if (process.env.NODE_ENV !== 'production') {
            console.log(`[ROUTING] kind=event_markets source=${dflowResult.ok ? 'dflow' : 'fallback'} latencyMs=${latencyMs} corr=${correlationId}`);
        }
        if (dflowResult.ok && dflowResult.data && Array.isArray(dflowResult.data) && dflowResult.data.length > 0) {
            return {
                ok: true,
                data: dflowResult.data.slice(0, limit).map(m => ({
                    id: m.id,
                    title: m.title,
                    yesPrice: m.yesPrice,
                    noPrice: m.noPrice,
                    volume24hUsd: m.volume24hUsd,
                    openInterestUsd: m.openInterestUsd,
                    liquidity: m.liquidity,
                    spread: m.spread,
                })),
                routing: {
                    source: 'dflow',
                    kind: 'event_markets',
                    ok: true,
                    latencyMs,
                    mode: 'dflow',
                    correlationId,
                },
            };
        }
        // dFlow failed in dflow mode => hard fail
        const errorReason = dflowResult.error || (DFLOW_FORCE_TIMEOUT ? 'timeout' : `HTTP ${dflowResult.statusCode || 'unknown'}`);
        return {
            ok: false,
            routing: {
                source: 'dflow',
                kind: 'event_markets',
                ok: false,
                reason: errorReason,
                latencyMs,
                mode: 'dflow',
                correlationId,
            },
            error: {
                code: 'DFLOW_REQUIRED',
                message: `dFlow routing required but failed: ${errorReason}`,
            },
        };
    }
    // ROUTING_MODE='hybrid' => dFlow first, then fallback
    if (ROUTING_MODE === 'hybrid' || DFLOW_ENABLED) {
        // Try dFlow first (unless forced to fail/timeout in DEV)
        if (!DFLOW_FORCE_FAIL && !DFLOW_FORCE_TIMEOUT && isDflowConfigured() && isDflowCapabilityAvailable('eventsMarkets')) {
            // Track dFlow call
            dflowCallCount++;
            lastDflowCallAt = Date.now();
            const dflowResult = await dflowGetEventMarkets();
            const latencyMs = Date.now() - startTime;
            // DEV-ONLY: Log routing result
            if (process.env.NODE_ENV !== 'production') {
                console.log(`[ROUTING] kind=event_markets source=${dflowResult.ok ? 'dflow' : 'fallback'} latencyMs=${latencyMs} corr=${correlationId}`);
            }
            if (dflowResult.ok && dflowResult.data && Array.isArray(dflowResult.data) && dflowResult.data.length > 0) {
                return {
                    ok: true,
                    data: dflowResult.data.slice(0, limit).map(m => ({
                        id: m.id,
                        title: m.title,
                        yesPrice: m.yesPrice,
                        noPrice: m.noPrice,
                        volume24hUsd: m.volume24hUsd,
                        openInterestUsd: m.openInterestUsd,
                        liquidity: m.liquidity,
                        spread: m.spread,
                    })),
                    routing: {
                        source: 'dflow',
                        kind: 'event_markets',
                        ok: true,
                        latencyMs,
                        mode: ROUTING_MODE,
                        correlationId,
                    },
                };
            }
            // dFlow failed, try fallback
            if (fallbackMarkets) {
                const fallbackData = await fallbackMarkets();
                const totalLatencyMs = Date.now() - startTime;
                const fallbackReason = DFLOW_FORCE_FAIL
                    ? 'DEV: DFLOW_FORCE_FAIL=true (forced_fail)'
                    : DFLOW_FORCE_TIMEOUT
                        ? 'DEV: DFLOW_FORCE_TIMEOUT=true (timeout)'
                        : `dFlow failed: ${dflowResult.error || `HTTP ${dflowResult.statusCode || 'unknown'}`}`;
                return {
                    ok: true,
                    data: fallbackData.slice(0, limit),
                    routing: {
                        source: 'fallback',
                        kind: 'event_markets',
                        ok: true,
                        reason: fallbackReason,
                        latencyMs: totalLatencyMs,
                        mode: ROUTING_MODE,
                        correlationId,
                    },
                };
            }
            // dFlow failed, no fallback
            const errorReason = DFLOW_FORCE_TIMEOUT ? 'timeout' : (dflowResult.error || `HTTP ${dflowResult.statusCode || 'unknown'}`);
            return {
                ok: false,
                routing: {
                    source: 'dflow',
                    kind: 'event_markets',
                    ok: false,
                    reason: errorReason,
                    latencyMs,
                    mode: ROUTING_MODE,
                    correlationId,
                },
                error: {
                    code: 'ROUTING_FAILED',
                    message: `dFlow failed and fallback unavailable: ${errorReason}`,
                },
            };
        }
    }
    // dFlow not enabled or not available, use fallback
    if (fallbackMarkets) {
        const fallbackData = await fallbackMarkets();
        const latencyMs = Date.now() - startTime;
        // DEV-ONLY: Log routing result
        if (process.env.NODE_ENV !== 'production') {
            console.log(`[ROUTING] kind=event_markets source=fallback latencyMs=${latencyMs} corr=${correlationId}`);
        }
        return {
            ok: true,
            data: fallbackData.slice(0, limit),
            routing: {
                source: 'fallback',
                kind: 'event_markets',
                ok: true,
                reason: 'dFlow not enabled or unavailable',
                latencyMs,
                mode: ROUTING_MODE,
                correlationId,
            },
        };
    }
    // No routing available
    const latencyMs = Date.now() - startTime;
    return {
        ok: false,
        routing: {
            source: 'fallback',
            kind: 'event_markets',
            ok: false,
            reason: 'No routing providers available',
            latencyMs,
            mode: ROUTING_MODE,
            correlationId,
        },
        error: {
            code: 'ROUTING_UNAVAILABLE',
            message: 'No event markets routing available',
        },
    };
}
//# sourceMappingURL=routingService.js.map