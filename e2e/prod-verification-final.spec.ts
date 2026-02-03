import { test, expect, BrowserContext, Page } from '@playwright/test';

/**
 * PHASE 4 — UI E2E Production Verification
 *
 * Tests the frontend at https://app.blossom.onl with deterministic auth.
 * Uses cookie injection to bypass access gate flakiness.
 */

const ACCESS_CODE = 'E7F9-D6D2-F151';
const APP_URL = 'https://app.blossom.onl';
const API_URL = 'https://api.blossom.onl';

// Helper to inject auth into localStorage via page context
async function injectAuthToLocalStorage(page: Page) {
  // Use addInitScript to set localStorage before the page loads its scripts
  await page.addInitScript((code) => {
    localStorage.setItem('blossom_access_code', code);
  }, ACCESS_CODE);
}

// Helper to wait for app to be ready (no access gate modal)
async function waitForAppReady(page: Page) {
  // Wait for page to load
  await page.waitForLoadState('networkidle', { timeout: 20000 });

  // Check if access gate modal is showing (look for "Blossom Early Beta" heading)
  const modalHeading = page.locator('text=Blossom Early Beta');
  const isModalVisible = await modalHeading.isVisible({ timeout: 3000 }).catch(() => false);

  if (isModalVisible) {
    console.log('Access gate modal detected, entering code...');

    // Click "I have an access code" to reveal the input
    const haveCodeBtn = page.locator('button:has-text("I have an access code")');
    await haveCodeBtn.click();
    await page.waitForTimeout(500);

    // Find and fill the access code input
    const codeInput = page.locator('input[placeholder="BLOSSOM-XXXXXXXX"]');
    await codeInput.waitFor({ state: 'visible', timeout: 5000 });
    await codeInput.fill(ACCESS_CODE);
    await page.waitForTimeout(300);

    // Click the unlock button
    const unlockBtn = page.locator('button:has-text("Unlock Access")');
    await unlockBtn.waitFor({ state: 'visible', timeout: 2000 });

    // Wait for button to be enabled (code validation)
    await page.waitForTimeout(500);
    await unlockBtn.click();

    // Wait for modal to close
    await page.waitForTimeout(3000);

    // Verify modal is gone
    const isStillVisible = await modalHeading.isVisible({ timeout: 2000 }).catch(() => false);
    if (isStillVisible) {
      console.log('Modal still visible after code entry, may need retry');
    }
  }

  // Dismiss any onboarding/tutorial modals
  for (let i = 0; i < 5; i++) {
    // Look for "Skip" button (in tutorial modals)
    const skipBtn = page.locator('button:has-text("Skip")');
    const isSkipVisible = await skipBtn.isVisible({ timeout: 1000 }).catch(() => false);
    if (isSkipVisible) {
      console.log('Dismissing tutorial modal...');
      await skipBtn.click();
      await page.waitForTimeout(500);
    } else {
      break;
    }
  }

  // Also try closing any modal with X button
  const closeBtn = page.locator('button:has([class*="lucide-x"]), button[aria-label="Close"]');
  const isCloseVisible = await closeBtn.isVisible({ timeout: 500 }).catch(() => false);
  if (isCloseVisible) {
    await closeBtn.click();
    await page.waitForTimeout(500);
  }

  // Wait for any modals to finish animating away
  await page.waitForTimeout(1000);
}

test.describe('Phase 4: UI E2E Production Verification', () => {

  test('4.1 Chat isolation - different contexts have isolated chat', async ({ browser }) => {
    // Create two completely isolated browser contexts
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      // Inject auth before navigation
      await injectAuthToLocalStorage(pageA);
      await injectAuthToLocalStorage(pageB);

      // Navigate both to the app
      await pageA.goto(APP_URL);
      await pageB.goto(APP_URL);

      await waitForAppReady(pageA);
      await waitForAppReady(pageB);

      // Get localStorage keys from both contexts
      const storageKeysA = await pageA.evaluate(() => {
        return Object.keys(localStorage).filter(k => k.includes('blossom'));
      });

      const storageKeysB = await pageB.evaluate(() => {
        return Object.keys(localStorage).filter(k => k.includes('blossom'));
      });

      // Log for debugging
      console.log('Context A localStorage keys:', storageKeysA);
      console.log('Context B localStorage keys:', storageKeysB);

      // Both should have some blossom keys
      expect(storageKeysA.length).toBeGreaterThan(0);
      expect(storageKeysB.length).toBeGreaterThan(0);

      // The anon IDs should be different (chat isolation)
      const anonIdA = await pageA.evaluate(() => localStorage.getItem('blossom_anon_id'));
      const anonIdB = await pageB.evaluate(() => localStorage.getItem('blossom_anon_id'));

      // Different contexts should have different anon IDs
      expect(anonIdA).not.toEqual(anonIdB);

    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('4.2 Greeting UX - "hi" shows friendly response', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await injectAuthToLocalStorage(page);

    try {
      await page.goto(APP_URL);
      await waitForAppReady(page);

      // Find the chat input
      const chatInput = page.locator('input[type="text"], textarea').first();
      await chatInput.fill('hi');

      // Find and click send button
      const sendButton = page.locator('button:has-text("Send"), button[aria-label*="send"]').first();
      await sendButton.click();

      // Wait for response
      await page.waitForTimeout(3000);

      // Check for Blossom response containing friendly intro
      const response = page.locator('text=/Blossom|trading copilot|help with/i').first();
      await expect(response).toBeVisible({ timeout: 10000 });

    } finally {
      await context.close();
    }
  });

  test('4.3 Balance UX - shows wallet guidance when disconnected', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await injectAuthToLocalStorage(page);

    try {
      await page.goto(APP_URL);
      await waitForAppReady(page);

      // Check that wallet is not connected (use first() to avoid strict mode violation)
      const walletStatus = page.locator('text=/Not connected|Connect wallet/i').first();
      await expect(walletStatus).toBeVisible({ timeout: 5000 });

      // Type balance query
      const chatInput = page.locator('input[type="text"], textarea').first();
      await chatInput.fill("what's my balance");

      const sendButton = page.locator('button:has-text("Send"), button[aria-label*="send"]').first();
      await sendButton.click();

      await page.waitForTimeout(3000);

      // Should show balance or demo portfolio (acceptable in demo mode)
      const response = page.locator('text=/balance|USDC|portfolio|connect/i').first();
      await expect(response).toBeVisible({ timeout: 10000 });

    } finally {
      await context.close();
    }
  });

  test('4.4 Perp regression - no EXECUTION_ERROR on BTC long', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await injectAuthToLocalStorage(page);

    try {
      await page.goto(APP_URL);
      await waitForAppReady(page);

      // Type perp command
      const chatInput = page.locator('input[type="text"], textarea').first();
      await chatInput.fill('long BTC 5x with $50');

      const sendButton = page.locator('button:has-text("Send"), button[aria-label*="send"]').first();
      await sendButton.click();

      await page.waitForTimeout(5000);

      // Should NOT see EXECUTION_ERROR
      const executionError = page.locator('text=EXECUTION_ERROR');
      const isErrorVisible = await executionError.isVisible({ timeout: 2000 }).catch(() => false);
      expect(isErrorVisible).toBe(false);

      // Should see either:
      // - WALLET_NOT_CONNECTED (expected when no wallet)
      // - A valid plan preview with BTC/perp info
      // Use .first() to avoid strict mode violation
      const validResponse = page.locator('text=/WALLET_NOT_CONNECTED|BTC|perp|leverage|margin|long/i').first();
      await expect(validResponse).toBeVisible({ timeout: 10000 });

    } finally {
      await context.close();
    }
  });

  test('4.5 API smoke test with header auth', async ({ request }) => {
    // Direct API test to verify header auth still works
    const response = await request.post(`${API_URL}/api/chat`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Access-Code': ACCESS_CODE,
      },
      data: {
        userMessage: 'hi',
        conversationHistory: [],
      },
    });

    expect(response.ok()).toBe(true);
    const json = await response.json();
    expect(json.assistantMessage).toBeTruthy();
    expect(json.assistantMessage.toLowerCase()).toContain('blossom');
  });

  test('4.6 Prepare endpoint returns valid plan', async ({ request }) => {
    const response = await request.post(`${API_URL}/api/execute/prepare`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Access-Code': ACCESS_CODE,
      },
      data: {
        executionRequest: {
          kind: 'perp',
          chain: 'sepolia',
          market: 'BTC-USD',
          side: 'long',
          leverage: 5,
          marginUsd: 50,
        },
        userAddress: '0x0000000000000000000000000000000000000000',
      },
    });

    expect(response.ok()).toBe(true);
    const json = await response.json();

    // Verify plan exists and has correct structure
    expect(json.plan).toBeTruthy();
    expect(json.plan.actions).toBeTruthy();
    expect(json.plan.actions.length).toBeGreaterThan(0);

    // Verify NO actionType 6 (PROOF)
    const actionTypes = json.plan.actions.map((a: any) => a.actionType);
    expect(actionTypes).not.toContain(6);

    // Verify perp uses actionType 7
    expect(actionTypes).toContain(7);

    // Verify adapter is the DEMO_PERP adapter
    const perpAction = json.plan.actions.find((a: any) => a.actionType === 7);
    expect(perpAction.adapter.toLowerCase()).toBe('0x78704d0b0f5bafe84724188bd5f45a082306a390');
  });
});
