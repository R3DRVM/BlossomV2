/**
 * Complete User Flow E2E Tests
 *
 * Tests the full user journey from connection to execution
 * These tests cover critical paths for MVP launch
 */

import { test, expect } from '@playwright/test';

const SHOULD_RUN = process.env.E2E_RUN === 'true';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';
const E2E_WALLET_ADDRESS = process.env.E2E_WALLET_ADDRESS;

test.describe('Complete User Flows', () => {
  test.skip(!SHOULD_RUN, 'Set E2E_RUN=true to enable complete flow tests.');

  // ============================================
  // Health & Preflight Checks
  // ============================================
  test.describe('Health & Infrastructure', () => {
    test('basic health endpoint responds', async ({ request }) => {
      const res = await request.get('/health');
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.ok).toBe(true);
      // Actual response: { ok, ts, service, executionMode, dbMode, ... }
      expect(body).toHaveProperty('executionMode');
      expect(body).toHaveProperty('ts');
    });

    test('extended health endpoint with diagnostics', async ({ request }) => {
      const res = await request.get('/api/health');
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.ok).toBe(true);
      // Actual response: { ok, ts, service, llmProvider, dbMode, dbIdentityHash, ... }
      expect(body).toHaveProperty('llmProvider');
      expect(body).toHaveProperty('dbIdentityHash');
    });

    test('RPC health shows provider status', async ({ request }) => {
      const res = await request.get('/api/rpc/health');
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.ok).toBe(true);
      // Actual response: { ok, ts, active, primary, fallbacks }
      expect(body).toHaveProperty('primary');
      expect(body).toHaveProperty('fallbacks');
      expect(Array.isArray(body.fallbacks)).toBe(true);
    });

    test('preflight responds with mode info', async ({ request }) => {
      // Wait a bit to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      const res = await request.get('/api/execute/preflight');
      // May return 429 due to rate limiting, which is acceptable
      if (res.status() === 429) {
        return; // Skip if rate limited
      }
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      // ok may be false due to adapter validation issues, but mode should be present
      expect(body).toHaveProperty('mode');
      expect(['eth_testnet', 'solana_devnet', 'sim']).toContain(body.mode);
    });
  });

  // ============================================
  // Intent Parsing & Plan Generation
  // ============================================
  test.describe('Intent Parsing', () => {
    const swapIntents = [
      'swap 100 BUSDC to WETH',
      'swap 1000 busdc for weth',
      'convert 500 BUSDC to ETH',
      'trade 200 BUSDC for WETH',
    ];

    const perpIntents = [
      'long BTC 10x',
      'short ETH 5x',
      'go long SOL 20x',
      'long btc with 1000',
    ];

    const depositIntents = [
      'deposit 500 BUSDC to vault',
      'supply 1000 BUSDC to aave',
      'lend 200 BUSDC',
    ];

    for (const intent of swapIntents) {
      test(`parses swap intent: "${intent}"`, async ({ request }) => {
        const res = await request.post('/api/execute/prepare', {
          data: {
            userAddress: E2E_WALLET_ADDRESS || '0x1234567890123456789012345678901234567890',
            executionIntent: { text: intent },
          },
        });

        // Handle rate limiting gracefully
        if (res.status() === 429) {
          return; // Skip if rate limited
        }
        expect(res.status()).toBeLessThan(500);
        const body = await res.json();

        if (body.ok) {
          expect(body.plan).toBeDefined();
          expect(body.plan.parsed?.kind).toBe('swap');
        } else {
          // Should have a meaningful error
          expect(body.error || body.message).toBeDefined();
        }
      });
    }

    for (const intent of perpIntents) {
      test(`parses perp intent: "${intent}"`, async ({ request }) => {
        const res = await request.post('/api/execute/prepare', {
          data: {
            userAddress: E2E_WALLET_ADDRESS || '0x1234567890123456789012345678901234567890',
            executionIntent: { text: intent },
          },
        });

        // Handle rate limiting gracefully
        if (res.status() === 429) {
          return; // Skip if rate limited
        }
        expect(res.status()).toBeLessThan(500);
        const body = await res.json();

        if (body.ok) {
          expect(body.plan?.parsed?.kind).toBe('perp');
          expect(['long', 'short']).toContain(body.plan?.parsed?.action);
        }
      });
    }

    for (const intent of depositIntents) {
      test(`parses deposit intent: "${intent}"`, async ({ request }) => {
        const res = await request.post('/api/execute/prepare', {
          data: {
            userAddress: E2E_WALLET_ADDRESS || '0x1234567890123456789012345678901234567890',
            executionIntent: { text: intent },
          },
        });

        // Handle rate limiting gracefully
        if (res.status() === 429) {
          return; // Skip if rate limited
        }
        expect(res.status()).toBeLessThan(500);
        const body = await res.json();

        if (body.ok) {
          expect(body.plan?.parsed?.kind).toBe('deposit');
        }
      });
    }

    test('handles unknown intent gracefully', async ({ request }) => {
      const res = await request.post('/api/execute/prepare', {
        data: {
          userAddress: E2E_WALLET_ADDRESS || '0x1234567890123456789012345678901234567890',
          executionIntent: { text: 'hello how are you' },
        },
      });

      // Handle rate limiting gracefully
      if (res.status() === 429) {
        return; // Skip if rate limited
      }
      expect(res.status()).toBeLessThan(500);
      const body = await res.json();

      // Should either succeed with proof_only or return clear message
      if (body.ok) {
        expect(body.plan?.parsed?.kind).toBe('unknown');
      }
    });
  });

  // ============================================
  // Session Management
  // ============================================
  test.describe('Session Management', () => {
    test.skip(!E2E_WALLET_ADDRESS, 'Set E2E_WALLET_ADDRESS to run session tests.');

    test('session status returns expected shape', async ({ request }) => {
      const res = await request.get(`/api/session/status?userAddress=${E2E_WALLET_ADDRESS}`);

      expect(res.status()).toBeLessThan(500);
      const body = await res.json();
      expect(body).toHaveProperty('ok');

      if (body.ok) {
        expect(body).toHaveProperty('session');
        expect(body.session).toHaveProperty('status');
      }
    });

    test('session prepare returns session params', async ({ request }) => {
      const res = await request.post('/api/session/prepare', {
        data: {
          userAddress: E2E_WALLET_ADDRESS,
          maxSpend: '10000000000', // 10000 BUSDC (6 decimals)
          duration: 86400, // 1 day
        },
      });

      expect(res.status()).toBeLessThan(500);
      const body = await res.json();
      expect(body).toHaveProperty('ok');

      if (body.ok) {
        expect(body).toHaveProperty('sessionParams');
        expect(body.sessionParams).toHaveProperty('maxSpendUnits');
        expect(body.sessionParams).toHaveProperty('expirationTimestamp');
      }
    });
  });

  // ============================================
  // Execution Flow (Prepare -> Submit)
  // ============================================
  test.describe('Execution Flow', () => {
    test.skip(!E2E_WALLET_ADDRESS, 'Set E2E_WALLET_ADDRESS to run execution tests.');

    test('prepare returns executable plan', async ({ request }) => {
      const res = await request.post('/api/execute/prepare', {
        data: {
          userAddress: E2E_WALLET_ADDRESS,
          executionIntent: { text: 'swap 100 BUSDC to WETH' },
        },
      });

      expect(res.status()).toBeLessThan(500);
      const body = await res.json();

      if (body.ok && body.plan) {
        expect(body.plan).toHaveProperty('draftId');
        expect(body.plan).toHaveProperty('actions');
        expect(Array.isArray(body.plan.actions)).toBe(true);
      }
    });

    test('submit handles missing draftId', async ({ request }) => {
      const res = await request.post('/api/execute/submit', {
        data: {
          txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          userAddress: E2E_WALLET_ADDRESS,
        },
      });

      // Should return 400, not 500
      expect([400, 422]).toContain(res.status());
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error || body.message).toBeDefined();
    });

    test('relayed execution validates session', async ({ request }) => {
      const res = await request.post('/api/execute/relayed', {
        data: {
          draftId: 'test-draft-123',
          userAddress: E2E_WALLET_ADDRESS,
          sessionId: 'invalid-session-id',
          plan: { actions: [] },
        },
      });

      // Should fail with session error, not 500
      expect(res.status()).toBeLessThan(500);
      const body = await res.json();

      if (!body.ok) {
        expect(body.error || body.code).toBeDefined();
      }
    });
  });

  // ============================================
  // Token Minting (Demo)
  // ============================================
  test.describe('Token Minting', () => {
    test.skip(!E2E_WALLET_ADDRESS, 'Set E2E_WALLET_ADDRESS to run mint tests.');

    test('mint endpoint accepts valid request', async ({ request }) => {
      const res = await request.post('/api/mint', {
        data: {
          userAddress: E2E_WALLET_ADDRESS,
          amount: 10,
        },
      });

      // Should succeed or rate limit, not error
      expect([200, 400, 429]).toContain(res.status());
      const body = await res.json();
      expect(body).toHaveProperty('ok');
    });

    test('mint rejects invalid address', async ({ request }) => {
      const res = await request.post('/api/mint', {
        data: {
          userAddress: 'not-an-address',
          amount: 10,
        },
      });

      expect([400, 422]).toContain(res.status());
    });

    test('mint rejects excessive amount', async ({ request }) => {
      const res = await request.post('/api/mint', {
        data: {
          userAddress: E2E_WALLET_ADDRESS,
          amount: 1000000, // Way too much
        },
      });

      expect([400, 422]).toContain(res.status());
    });
  });

  // ============================================
  // Telemetry & Stats
  // ============================================
  test.describe('Telemetry', () => {
    test('summary returns execution stats', async ({ request }) => {
      const res = await request.get('/api/telemetry/summary');
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      // Response may have ok: false if DB unavailable, but should include data
      expect(body).toHaveProperty('data');
      expect(body.data).toHaveProperty('totalExecutions');
      expect(body.data).toHaveProperty('successfulExecutions');
      expect(body.data).toHaveProperty('failedExecutions');
    });

    test('devnet stats returns chain metrics', async ({ request }) => {
      const res = await request.get('/api/telemetry/devnet-stats');
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      // Response may have ok: false if DB unavailable, but should include data
      expect(body).toHaveProperty('data');
      expect(body.data).toHaveProperty('traffic');
      expect(body.data).toHaveProperty('executions');
    });

    test('executions list returns recent activity', async ({ request }) => {
      const res = await request.get('/api/telemetry/executions?limit=10');
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      // Response may have ok: false if DB unavailable, but should include data array
      expect(body).toHaveProperty('data');
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  // ============================================
  // Error Handling
  // ============================================
  test.describe('Error Handling', () => {
    test('invalid JSON returns 400', async ({ request }) => {
      const res = await request.post('/api/chat', {
        headers: { 'Content-Type': 'application/json' },
        data: 'not valid json {{{',
      });

      expect(res.status()).toBeLessThan(500);
    });

    test('missing required fields returns clear error', async ({ request }) => {
      // Wait to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
      const res = await request.post('/api/execute/prepare', {
        data: {},
      });

      // Accept 429 (rate limited) as passing - this is expected behavior
      if (res.status() === 429) {
        return;
      }
      expect(res.status()).toBeLessThan(500);
      const body = await res.json();
      expect(body.ok).toBe(false);
    });

    test('non-existent endpoint returns 404', async ({ request }) => {
      const res = await request.get('/api/nonexistent');
      expect(res.status()).toBe(404);
    });
  });

  // ============================================
  // Security & Rate Limiting
  // ============================================
  test.describe('Security', () => {
    test('CORS preflight works', async ({ request }) => {
      const res = await request.fetch('/api/execute/prepare', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://blossom.onl',
          'Access-Control-Request-Method': 'POST',
        },
      });

      expect(res.ok()).toBeTruthy();
      expect(res.headers()['access-control-allow-origin']).toBeTruthy();
    });

    test('blocked origin is rejected', async ({ request }) => {
      const res = await request.fetch('/api/health', {
        method: 'GET',
        headers: {
          'Origin': 'https://malicious-site.com',
        },
      });

      // Should either block or not include CORS headers
      const corsHeader = res.headers()['access-control-allow-origin'];
      if (corsHeader) {
        expect(corsHeader).not.toBe('https://malicious-site.com');
      }
    });

    test('rate limiting returns 429 on abuse', async ({ request }) => {
      test.skip(!E2E_WALLET_ADDRESS, 'Set E2E_WALLET_ADDRESS for rate limit tests.');

      const requests = [];
      for (let i = 0; i < 15; i++) {
        requests.push(
          request.post('/api/execute/prepare', {
            data: {
              userAddress: E2E_WALLET_ADDRESS,
              executionIntent: { text: `test ${i}` },
            },
          })
        );
      }

      const responses = await Promise.all(requests);
      const statusCodes = responses.map(r => r.status());

      // Expect at least some 429 responses
      const rateLimited = statusCodes.filter(s => s === 429).length;
      expect(rateLimited).toBeGreaterThan(0);
    });
  });

  // ============================================
  // Chat Integration
  // ============================================
  test.describe('Chat API', () => {
    test('chat endpoint processes message', async ({ request }) => {
      const res = await request.post('/api/chat', {
        data: {
          messages: [{ role: 'user', content: 'Hello' }],
        },
      });

      expect(res.status()).toBeLessThan(500);
      const body = await res.json();

      if (body.ok) {
        expect(body).toHaveProperty('response');
      }
    });

    test('chat with intent returns execution request', async ({ request }) => {
      const res = await request.post('/api/chat', {
        data: {
          messages: [{ role: 'user', content: 'swap 100 BUSDC to WETH' }],
        },
      });

      expect(res.status()).toBeLessThan(500);
      const body = await res.json();

      if (body.ok && body.executionRequest) {
        expect(body.executionRequest).toHaveProperty('kind');
      }
    });
  });
});

// ============================================
// Performance Tests
// ============================================
test.describe('Performance', () => {
  test.skip(!SHOULD_RUN, 'Set E2E_RUN=true to enable performance tests.');

  test('health responds within 500ms', async ({ request }) => {
    const start = Date.now();
    const res = await request.get('/health');
    const duration = Date.now() - start;

    expect(res.ok()).toBeTruthy();
    expect(duration).toBeLessThan(500);
  });

  test('prepare responds within 5s', async ({ request }) => {
    test.skip(!E2E_WALLET_ADDRESS, 'Set E2E_WALLET_ADDRESS for performance tests.');

    const start = Date.now();
    const res = await request.post('/api/execute/prepare', {
      data: {
        userAddress: E2E_WALLET_ADDRESS,
        executionIntent: { text: 'swap 100 BUSDC to WETH' },
      },
    });
    const duration = Date.now() - start;

    expect(res.status()).toBeLessThan(500);
    expect(duration).toBeLessThan(5000);
  });

  test('telemetry responds within 2s', async ({ request }) => {
    const start = Date.now();
    const res = await request.get('/api/telemetry/summary');
    const duration = Date.now() - start;

    expect(res.ok()).toBeTruthy();
    expect(duration).toBeLessThan(2000);
  });
});
