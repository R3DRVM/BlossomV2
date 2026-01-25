/**
 * dFlow Client Tests
 * Uses mocked fetch responses - no real network calls
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// Mock the config module
vi.mock('../../../config', () => ({
    DFLOW_ENABLED: true,
    DFLOW_API_KEY: 'test-api-key',
    DFLOW_BASE_URL: 'https://api.dflow.test',
    DFLOW_EVENTS_MARKETS_PATH: '/v1/events/markets',
    DFLOW_EVENTS_QUOTE_PATH: '/v1/events/quote',
    DFLOW_SWAPS_QUOTE_PATH: '/v1/swaps/quote',
}));
// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;
describe('dFlow Client', () => {
    beforeEach(() => {
        mockFetch.mockReset();
    });
    afterEach(() => {
        vi.clearAllMocks();
    });
    describe('isDflowConfigured', () => {
        it('returns true when all config is set', async () => {
            const { isDflowConfigured } = await import('../dflowClient');
            expect(isDflowConfigured()).toBe(true);
        });
    });
    describe('isDflowCapabilityAvailable', () => {
        it('returns true for eventsMarkets when path is set', async () => {
            const { isDflowCapabilityAvailable } = await import('../dflowClient');
            expect(isDflowCapabilityAvailable('eventsMarkets')).toBe(true);
        });
        it('returns true for eventsQuotes when path is set', async () => {
            const { isDflowCapabilityAvailable } = await import('../dflowClient');
            expect(isDflowCapabilityAvailable('eventsQuotes')).toBe(true);
        });
        it('returns true for swapsQuotes when path is set', async () => {
            const { isDflowCapabilityAvailable } = await import('../dflowClient');
            expect(isDflowCapabilityAvailable('swapsQuotes')).toBe(true);
        });
    });
    describe('getDflowCapabilities', () => {
        it('returns all capabilities when fully configured', async () => {
            const { getDflowCapabilities } = await import('../dflowClient');
            const caps = getDflowCapabilities();
            expect(caps.enabled).toBe(true);
            expect(caps.eventsMarkets).toBe(true);
            expect(caps.eventsQuotes).toBe(true);
            expect(caps.swapsQuotes).toBe(true);
        });
    });
    describe('getEventMarkets', () => {
        it('returns markets on success', async () => {
            const mockMarkets = [
                {
                    id: 'fed-rate-cut',
                    title: 'Fed cuts rates in March 2025',
                    yesPrice: 0.62,
                    noPrice: 0.38,
                    volume24hUsd: 125000,
                },
                {
                    id: 'btc-etf',
                    title: 'BTC ETF approved',
                    yesPrice: 0.75,
                    noPrice: 0.25,
                    volume24hUsd: 280000,
                },
            ];
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockMarkets,
            });
            const { getEventMarkets } = await import('../dflowClient');
            const result = await getEventMarkets();
            expect(result.ok).toBe(true);
            expect(result.data).toHaveLength(2);
            expect(result.data?.[0].id).toBe('fed-rate-cut');
        });
        it('returns error on API failure', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
            });
            const { getEventMarkets } = await import('../dflowClient');
            const result = await getEventMarkets();
            expect(result.ok).toBe(false);
            expect(result.error).toContain('dFlow API error');
        });
        it('returns error on network failure', async () => {
            mockFetch.mockRejectedValueOnce(new Error('Network error'));
            const { getEventMarkets } = await import('../dflowClient');
            const result = await getEventMarkets();
            expect(result.ok).toBe(false);
            expect(result.error).toContain('Network error');
        });
    });
    describe('getSwapQuote', () => {
        it('returns quote on success', async () => {
            const mockQuote = {
                tokenIn: '0xREDACTED',
                tokenOut: '0xWETH',
                amountIn: '100000000',
                amountOut: '95000000000000000000',
                minAmountOut: '94500000000000000000',
                slippageBps: 50,
                routeSummary: 'REDACTED → WETH via Uniswap V3',
            };
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockQuote,
            });
            const { getSwapQuote } = await import('../dflowClient');
            const result = await getSwapQuote({
                tokenIn: '0xREDACTED',
                tokenOut: '0xWETH',
                amountIn: '100000000',
            });
            expect(result.ok).toBe(true);
            expect(result.data?.amountOut).toBe('95000000000000000000');
        });
    });
    describe('dflowHealthCheck', () => {
        it('returns ok on successful health check', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ status: 'ok' }),
            });
            const { dflowHealthCheck } = await import('../dflowClient');
            const result = await dflowHealthCheck();
            expect(result.ok).toBe(true);
            expect(result.latencyMs).toBeGreaterThanOrEqual(0);
        });
        it('returns ok on 404 (no health endpoint)', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 404,
            });
            const { dflowHealthCheck } = await import('../dflowClient');
            const result = await dflowHealthCheck();
            expect(result.ok).toBe(true);
        });
    });
});
describe('dFlow Provider Selection', () => {
    beforeEach(() => {
        mockFetch.mockReset();
        vi.resetModules();
    });
    it('falls back when dFlow is unavailable', async () => {
        // Override config to disable dFlow
        vi.doMock('../../../config', () => ({
            DFLOW_ENABLED: false,
            DFLOW_API_KEY: undefined,
            DFLOW_BASE_URL: undefined,
            DFLOW_EVENTS_MARKETS_PATH: undefined,
            DFLOW_EVENTS_QUOTE_PATH: undefined,
            DFLOW_SWAPS_QUOTE_PATH: undefined,
        }));
        const { isDflowConfigured } = await import('../dflowClient');
        expect(isDflowConfigured()).toBe(false);
    });
});
//# sourceMappingURL=dflowClient.test.js.map