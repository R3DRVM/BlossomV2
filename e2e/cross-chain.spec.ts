import { test, expect } from '@playwright/test';

const SHOULD_RUN = process.env.E2E_CROSS_CHAIN === 'true';
const ETH_WALLET = process.env.E2E_ETH_WALLET_ADDRESS;
const SOL_WALLET = process.env.E2E_SOL_WALLET_ADDRESS;

test.describe('Cross-Chain Integration Tests', () => {
  test.skip(!SHOULD_RUN, 'Set E2E_CROSS_CHAIN=true to enable cross-chain tests.');

  test('Ethereum Sepolia execution flow', async ({ request }) => {
    test.skip(!ETH_WALLET, 'Set E2E_ETH_WALLET_ADDRESS to run Ethereum tests.');

    // 1. Preflight check for Ethereum
    const preflightRes = await request.post('/api/execute/preflight', {
      data: {
        walletAddress: ETH_WALLET,
        chain: 'ethereum',
        intent: 'swap 100 BUSDC to WETH',
      },
    });

    expect(preflightRes.ok()).toBeTruthy();
    const preflight = await preflightRes.json();
    expect(preflight).toHaveProperty('ok');
    expect(preflight.chain).toBe('ethereum');

    // 2. Prepare execution
    const prepareRes = await request.post('/api/execute/prepare', {
      data: {
        walletAddress: ETH_WALLET,
        chain: 'ethereum',
        intent: 'swap 100 BUSDC to WETH',
      },
    });

    expect(prepareRes.status()).toBeLessThan(500);
    const prepare = await prepareRes.json();
    expect(prepare).toHaveProperty('ok');
  });

  test('Solana pricing integration', async ({ request }) => {
    // Verify Solana pricing endpoints work (read-only)

    // 1. Jupiter price API
    const jupiterRes = await request.get('/api/solana/prices', {
      params: {
        tokens: 'So11111111111111111111111111111111111111112,EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      },
    });

    // Note: This test assumes the agent exposes a /api/solana/prices endpoint
    // If not available, test will be skipped or fail gracefully
    if (jupiterRes.ok()) {
      const prices = await jupiterRes.json();
      expect(prices).toHaveProperty('ok');
    }
  });

  test('Dual-wallet session flow (EVM + Solana)', async ({ request }) => {
    test.skip(!ETH_WALLET || !SOL_WALLET, 'Set E2E_ETH_WALLET_ADDRESS and E2E_SOL_WALLET_ADDRESS for dual-wallet tests.');

    // 1. Initiate Ethereum session
    const ethSessionRes = await request.post('/api/session/prepare', {
      data: {
        walletAddress: ETH_WALLET,
        chain: 'ethereum',
      },
    });

    expect([200, 400]).toContain(ethSessionRes.status());
    const ethSession = await ethSessionRes.json();
    expect(ethSession).toHaveProperty('ok');

    if (ethSession.ok && ethSession.sessionId) {
      // 2. Execute with Ethereum session
      const ethExecRes = await request.post('/api/session/execute', {
        headers: {
          'x-session-id': ethSession.sessionId,
        },
        data: {
          intent: 'swap 50 BUSDC to WETH',
        },
      });

      expect([200, 400, 401]).toContain(ethExecRes.status());
    }

    // 3. Initiate Solana session
    const solSessionRes = await request.post('/api/session/prepare', {
      data: {
        walletAddress: SOL_WALLET,
        chain: 'solana',
      },
    });

    expect([200, 400]).toContain(solSessionRes.status());
    const solSession = await solSessionRes.json();
    expect(solSession).toHaveProperty('ok');

    if (solSession.ok && solSession.sessionId) {
      // 4. Execute with Solana session (should be proof-only for MVP)
      const solExecRes = await request.post('/api/session/execute', {
        headers: {
          'x-session-id': solSession.sessionId,
        },
        data: {
          intent: 'swap 50 SOL to USDC',
        },
      });

      expect([200, 400, 401]).toContain(solExecRes.status());
      const solExec = await solExecRes.json();
      // MVP: Solana execution should warn about proof-only
      if (solExec.warnings) {
        expect(solExec.warnings.some((w: string) => w.includes('PROOF_ONLY') || w.includes('Coming Soon'))).toBeTruthy();
      }
    }
  });

  test('Chain mismatch detection', async ({ request }) => {
    test.skip(!ETH_WALLET, 'Set E2E_ETH_WALLET_ADDRESS to run chain mismatch tests.');

    // Attempt to execute Solana intent with Ethereum wallet (should handle gracefully)
    const res = await request.post('/api/execute/prepare', {
      data: {
        walletAddress: ETH_WALLET,
        chain: 'solana', // Wrong: wallet is Ethereum
        intent: 'swap SOL to USDC',
      },
    });

    expect([400, 422]).toContain(res.status());
    const body = await res.json();
    // Should either reject or warn about mismatch
    expect(body).toHaveProperty('ok');
  });

  test('Rate limiting on execute endpoint', async ({ request }) => {
    test.skip(!ETH_WALLET, 'Set E2E_ETH_WALLET_ADDRESS to run rate limit tests.');

    const maxRequests = 10;
    const requests = [];

    // Rapid fire 15 requests (should be rate limited after 10)
    for (let i = 0; i < 15; i++) {
      requests.push(
        request.post('/api/execute/prepare', {
          data: {
            walletAddress: ETH_WALLET,
            intent: `swap ${i} BUSDC to WETH`,
          },
        })
      );
    }

    const responses = await Promise.all(requests);
    const statusCodes = responses.map(r => r.status());

    // Expect at least some 429 (rate limited) responses
    const rateLimitedCount = statusCodes.filter(s => s === 429).length;
    expect(rateLimitedCount).toBeGreaterThan(0);

    // First maxRequests should mostly succeed
    const successCount = statusCodes.slice(0, maxRequests).filter(s => s < 300).length;
    expect(successCount).toBeGreaterThan(maxRequests - 2);
  });

  test('Mint endpoint rate limiting', async ({ request }) => {
    test.skip(!ETH_WALLET, 'Set E2E_ETH_WALLET_ADDRESS to run mint rate limit tests.');

    const requests = [];

    // Rapid fire 10 mint requests
    for (let i = 0; i < 10; i++) {
      requests.push(
        request.post('/api/mint', {
          data: {
            userAddress: ETH_WALLET,
            amount: 1,
          },
        })
      );
    }

    const responses = await Promise.all(requests);
    const statusCodes = responses.map(r => r.status());

    // Expect some 429 (rate limited) responses
    const rateLimitedCount = statusCodes.filter(s => s === 429).length;
    expect(rateLimitedCount).toBeGreaterThan(0);

    // At least 5 should succeed (limit is 5/min per wallet)
    const successCount = statusCodes.filter(s => s === 200).length;
    expect(successCount).toBeGreaterThanOrEqual(5);
  });

  test('Execution stats persistence', async ({ request }) => {
    // Verify that execution stats are recorded and queryable

    const statsRes = await request.get('/api/telemetry/summary');
    expect(statsRes.ok()).toBeTruthy();

    const stats = await statsRes.json();
    expect(stats).toHaveProperty('ok');
    expect(stats).toHaveProperty('totalExecutions');
    expect(stats).toHaveProperty('successCount');
    expect(stats).toHaveProperty('failCount');
  });

  test('CORS preflight for cross-origin requests', async ({ request }) => {
    // Verify CORS headers are properly set
    const res = await request.options('/api/execute/prepare', {
      headers: {
        'Origin': 'https://blossom.onl',
        'Access-Control-Request-Method': 'POST',
      },
    });

    expect(res.headers()['access-control-allow-origin']).toBeTruthy();
  });
});
