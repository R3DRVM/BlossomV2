/**
 * Beta Investor Demo E2E Tests
 *
 * P0 Bug Fixes Verification:
 * 1. CHAT ISOLATION: Different identities don't see each other's chat
 * 2. BASIC CONVO: "hi", "balance" get friendly responses
 * 3. QUICK ACTIONS: Allocate buttons create valid drafts
 * 4. PERP BTC 20x: No generic EXECUTION_ERROR, helpful response
 * 5. ZERO 500s: Core flows don't return server errors
 */
import { test, expect, Page, BrowserContext } from '@playwright/test';

const PROD_URL = process.env.PROD_URL || 'https://app.blossom.onl';
const LOCAL_URL = process.env.LOCAL_URL || 'http://localhost:5173';
const TEST_URL = process.env.TEST_URL || LOCAL_URL;
const VALID_ACCESS_CODE = process.env.BLOSSOM_TEST_ACCESS_CODE || '';

// Helper: Authenticate via access gate if needed
async function authenticateIfNeeded(page: Page, accessCode: string) {
  // Check for access gate
  const betaText = page.locator('text="Blossom"');
  const isGateVisible = await betaText.isVisible({ timeout: 5000 }).catch(() => false);

  if (isGateVisible) {
    // Click "Have an access code?" or similar
    const expandBtn = page.locator('text=/have.*access.*code|access code/i');
    if (await expandBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expandBtn.click();
      await page.waitForTimeout(500);
    }

    // Fill access code
    const input = page.locator('input[placeholder*="code" i], input[type="text"]').last();
    await input.fill(accessCode);

    // Submit
    const submitBtn = page.locator('button:has-text("Access"), button:has-text("Unlock"), button:has-text("Enter")').first();
    await submitBtn.click();

    // Wait for gate to close
    await page.waitForTimeout(2000);
  }
}

// Helper: Send a chat message and wait for response
async function sendMessageAndWaitForResponse(page: Page, message: string): Promise<string> {
  const chatInput = page.locator('textarea, input[placeholder*="message" i], [data-testid="chat-input"]').first();
  await expect(chatInput).toBeVisible({ timeout: 10000 });

  await chatInput.fill(message);
  await chatInput.press('Enter');

  // Wait for response (new message bubble from Blossom)
  await page.waitForTimeout(5000);

  // Get the latest assistant message
  const assistantMessages = page.locator('.message-bubble:not(.user-message), [data-user="false"], [class*="isUser-false"]');
  const count = await assistantMessages.count();

  if (count > 0) {
    const lastMessage = assistantMessages.last();
    return await lastMessage.innerText();
  }

  // Fallback: Get any recent text response
  const anyResponse = await page.locator('text=/hi|hello|help|balance|swap|perp|I can/i').last().innerText().catch(() => '');
  return anyResponse;
}

// Helper: Clear localStorage for fresh state
async function clearStorageForIdentity(context: BrowserContext, identityPrefix: string) {
  await context.addInitScript((prefix) => {
    // Clear all localStorage keys for this identity
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.includes(prefix)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
  }, identityPrefix);
}

test.describe('P0 Security: Chat Isolation', () => {
  test('two anonymous users with same access code have isolated chat', async ({ browser }) => {
    test.skip(!VALID_ACCESS_CODE, 'BLOSSOM_TEST_ACCESS_CODE not set');

    // Create two separate browser contexts (simulating two users)
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      // User A: Authenticate and send a message
      await pageA.goto(TEST_URL);
      await authenticateIfNeeded(pageA, VALID_ACCESS_CODE);

      const chatInputA = pageA.locator('textarea, input[placeholder*="message" i]').first();
      await expect(chatInputA).toBeVisible({ timeout: 15000 });

      await chatInputA.fill('User A secret message 12345');
      await chatInputA.press('Enter');
      await pageA.waitForTimeout(3000);

      // User B: Authenticate with SAME code and check they don't see A's message
      await pageB.goto(TEST_URL);
      await authenticateIfNeeded(pageB, VALID_ACCESS_CODE);

      const chatInputB = pageB.locator('textarea, input[placeholder*="message" i]').first();
      await expect(chatInputB).toBeVisible({ timeout: 15000 });

      // Wait for chat to load
      await pageB.waitForTimeout(2000);

      // User B should NOT see User A's secret message
      const userAMessageInB = await pageB.locator('text="User A secret message 12345"').isVisible().catch(() => false);

      expect(userAMessageInB).toBe(false);

      // Verify User A still sees their message
      const userAMessageInA = await pageA.locator('text="User A secret message 12345"').isVisible().catch(() => false);
      expect(userAMessageInA).toBe(true);

    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});

test.describe('P0 UX: Conversational Baseline', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_URL);
    if (VALID_ACCESS_CODE) {
      await authenticateIfNeeded(page, VALID_ACCESS_CODE);
    }
  });

  test('"hi" returns friendly greeting, not "I didn\'t understand"', async ({ page }) => {
    const response = await sendMessageAndWaitForResponse(page, 'hi');

    // Should NOT contain the old error message
    expect(response.toLowerCase()).not.toContain("didn't understand");
    expect(response.toLowerCase()).not.toContain("try: 'long btc");

    // Should contain friendly greeting elements
    const isFriendly = response.toLowerCase().includes('hi') ||
                       response.toLowerCase().includes('hello') ||
                       response.toLowerCase().includes('blossom') ||
                       response.toLowerCase().includes('help') ||
                       response.toLowerCase().includes('swap') ||
                       response.toLowerCase().includes('perp');
    expect(isFriendly).toBe(true);
  });

  test('"hello" returns friendly greeting', async ({ page }) => {
    const response = await sendMessageAndWaitForResponse(page, 'hello');

    expect(response.toLowerCase()).not.toContain("didn't understand");
    expect(response.length).toBeGreaterThan(10);
  });

  test('"whats my balance" returns guidance (not error)', async ({ page }) => {
    const response = await sendMessageAndWaitForResponse(page, 'whats my balance');

    // Should NOT contain error messages
    expect(response.toLowerCase()).not.toContain("didn't understand");
    expect(response.toLowerCase()).not.toContain("try: 'long btc");

    // Should contain balance-related guidance
    const hasBalanceInfo = response.toLowerCase().includes('balance') ||
                          response.toLowerCase().includes('wallet') ||
                          response.toLowerCase().includes('token') ||
                          response.toLowerCase().includes('connect') ||
                          response.toLowerCase().includes('usdc') ||
                          response.toLowerCase().includes('$');
    expect(hasBalanceInfo).toBe(true);
  });

  test('"help" returns capability list', async ({ page }) => {
    const response = await sendMessageAndWaitForResponse(page, 'help');

    expect(response.toLowerCase()).not.toContain("didn't understand");

    // Should list capabilities
    const hasCapabilities = response.toLowerCase().includes('swap') ||
                           response.toLowerCase().includes('perp') ||
                           response.toLowerCase().includes('defi') ||
                           response.toLowerCase().includes('trade');
    expect(hasCapabilities).toBe(true);
  });

  test('"what can you do" returns capability list', async ({ page }) => {
    const response = await sendMessageAndWaitForResponse(page, 'what can you do');

    expect(response.toLowerCase()).not.toContain("didn't understand");
    expect(response.length).toBeGreaterThan(50);
  });
});

test.describe('P0 UX/EXEC: Quick Actions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_URL);
    if (VALID_ACCESS_CODE) {
      await authenticateIfNeeded(page, VALID_ACCESS_CODE);
    }
  });

  test('sending DeFi allocate command does not return 500', async ({ page }) => {
    // Use the new natural language format
    const chatInput = page.locator('textarea, input[placeholder*="message" i]').first();
    await expect(chatInput).toBeVisible({ timeout: 15000 });

    await chatInput.fill('Deposit 10% of my REDACTED into Aave');
    await chatInput.press('Enter');

    await page.waitForTimeout(5000);

    // Should NOT see server error
    const hasServerError = await page.locator('text=/server error|500|ERR-/i').isVisible().catch(() => false);
    expect(hasServerError).toBe(false);

    // Should see some response about deposit/allocate
    const hasResponse = await page.locator('text=/deposit|allocate|aave|yield|usdc/i').first().isVisible().catch(() => false);
    expect(hasResponse).toBe(true);
  });

  test('sending DeFi $500 allocate command works', async ({ page }) => {
    const chatInput = page.locator('textarea, input[placeholder*="message" i]').first();
    await expect(chatInput).toBeVisible({ timeout: 15000 });

    await chatInput.fill('Deposit $500 REDACTED into Aave');
    await chatInput.press('Enter');

    await page.waitForTimeout(5000);

    const hasServerError = await page.locator('text=/server error|500|ERR-/i').isVisible().catch(() => false);
    expect(hasServerError).toBe(false);
  });
});

test.describe('P0 EXEC: Perp BTC 20x', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_URL);
    if (VALID_ACCESS_CODE) {
      await authenticateIfNeeded(page, VALID_ACCESS_CODE);
    }
  });

  test('"Long BTC 20x with 2% risk" does not return generic EXECUTION_ERROR', async ({ page }) => {
    const response = await sendMessageAndWaitForResponse(page, 'Long BTC 20x with 2% risk');

    // Should NOT see generic EXECUTION_ERROR
    expect(response).not.toContain('EXECUTION_ERROR');
    expect(response.toLowerCase()).not.toContain('execution failed: execution_error');

    // Should see some valid response about BTC/perp/position
    const hasValidResponse = response.toLowerCase().includes('btc') ||
                            response.toLowerCase().includes('long') ||
                            response.toLowerCase().includes('perp') ||
                            response.toLowerCase().includes('position') ||
                            response.toLowerCase().includes('leverage') ||
                            response.toLowerCase().includes('plan') ||
                            response.toLowerCase().includes('draft');
    expect(hasValidResponse).toBe(true);
  });

  test('"Long BTC with 20x leverage... Show execution plan" returns plan', async ({ page }) => {
    const response = await sendMessageAndWaitForResponse(page, 'Long BTC with 20x leverage using 2% risk. Show me the execution plan across venues.');

    // Should NOT see EXECUTION_ERROR
    expect(response).not.toContain('EXECUTION_ERROR');

    // Should see plan-related content
    const hasPlanContent = response.toLowerCase().includes('plan') ||
                          response.toLowerCase().includes('execution') ||
                          response.toLowerCase().includes('btc') ||
                          response.toLowerCase().includes('leverage') ||
                          response.toLowerCase().includes('margin') ||
                          response.toLowerCase().includes('position');
    expect(hasPlanContent).toBe(true);
  });

  test('Hedge BTC exposure query does not fail', async ({ page }) => {
    const response = await sendMessageAndWaitForResponse(page, 'Hedge my BTC and ETH exposure with a short BTC perp position.');

    // Should NOT see generic execution errors
    expect(response).not.toContain('EXECUTION_ERROR');

    // Should see some relevant response
    expect(response.length).toBeGreaterThan(20);
  });
});

test.describe('P0: Zero 500s on Core Flows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_URL);
    if (VALID_ACCESS_CODE) {
      await authenticateIfNeeded(page, VALID_ACCESS_CODE);
    }
  });

  test('swap command does not return 500', async ({ page }) => {
    const chatInput = page.locator('textarea, input[placeholder*="message" i]').first();
    await expect(chatInput).toBeVisible({ timeout: 15000 });

    await chatInput.fill('Swap 10 REDACTED to WETH');
    await chatInput.press('Enter');

    await page.waitForTimeout(5000);

    const hasServerError = await page.locator('text=/server error|500|ERR-/i').isVisible().catch(() => false);
    expect(hasServerError).toBe(false);
  });

  test('perp command does not return 500', async ({ page }) => {
    const chatInput = page.locator('textarea, input[placeholder*="message" i]').first();
    await expect(chatInput).toBeVisible({ timeout: 15000 });

    await chatInput.fill('Long ETH 5x with 2% risk');
    await chatInput.press('Enter');

    await page.waitForTimeout(5000);

    const hasServerError = await page.locator('text=/server error|500|ERR-/i').isVisible().catch(() => false);
    expect(hasServerError).toBe(false);
  });

  test('event bet command does not return 500', async ({ page }) => {
    const chatInput = page.locator('textarea, input[placeholder*="message" i]').first();
    await expect(chatInput).toBeVisible({ timeout: 15000 });

    await chatInput.fill('Bet $10 YES on Fed rate cut');
    await chatInput.press('Enter');

    await page.waitForTimeout(5000);

    const hasServerError = await page.locator('text=/server error|500|ERR-/i').isVisible().catch(() => false);
    expect(hasServerError).toBe(false);
  });
});
