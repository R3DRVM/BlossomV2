import { test, expect } from '@playwright/test';

const SHOULD_RUN = process.env.E2E_RUN === 'true';
const SHOULD_MINT = process.env.E2E_MINT === 'true';
const E2E_WALLET_ADDRESS = process.env.E2E_WALLET_ADDRESS;
const PREPARE_BODY_RAW = process.env.E2E_PREPARE_BODY;

let prepareBody: any | null = null;
if (PREPARE_BODY_RAW) {
  try {
    prepareBody = JSON.parse(PREPARE_BODY_RAW);
  } catch (error) {
    console.warn('[e2e] Invalid E2E_PREPARE_BODY JSON, skipping prepare test.');
  }
}

test.describe('MVP API Flow (mint -> execute -> stats)', () => {
  test.skip(!SHOULD_RUN, 'Set E2E_RUN=true and ensure BACKEND_URL points to a running API.');

  test('health responds', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('ok');
  });

  test('preflight responds', async ({ request }) => {
    const res = await request.get('/api/execute/preflight');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('ok');
    expect(body).toHaveProperty('mode');
  });

  test('mint bUSDC (optional)', async ({ request }) => {
    test.skip(!SHOULD_MINT || !E2E_WALLET_ADDRESS, 'Set E2E_MINT=true and E2E_WALLET_ADDRESS to enable mint.');

    const res = await request.post('/api/mint', {
      data: {
        userAddress: E2E_WALLET_ADDRESS,
        amount: 10,
      },
    });

    expect([200, 400, 429]).toContain(res.status());
    const body = await res.json();
    expect(body).toHaveProperty('ok');
  });

  test('prepare execution (optional)', async ({ request }) => {
    test.skip(!prepareBody, 'Set E2E_PREPARE_BODY JSON to run prepare test.');

    const res = await request.post('/api/execute/prepare', { data: prepareBody });
    expect(res.status()).toBeLessThan(500);
    const body = await res.json();
    expect(body).toHaveProperty('ok');
  });

  test('stats summary responds', async ({ request }) => {
    const res = await request.get('/api/telemetry/summary');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('ok');
  });
});
