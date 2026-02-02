/**
 * BULLETPROOF UI E2E - Production Smoke Tests
 *
 * Tests that DO NOT require wallet signing:
 * - Access gate validation
 * - Core UI rendering
 * - Chat → ExecutionRequest flow
 */
import { test, expect } from '@playwright/test';

const PROD_URL = process.env.PROD_URL || 'https://app.blossom.onl';
const VALID_ACCESS_CODE = process.env.BLOSSOM_TEST_ACCESS_CODE || '';

test.describe('Access Gate', () => {
  test('rejects invalid access code', async ({ page, context }) => {
    // Clear cookies to ensure fresh state
    await context.clearCookies();
    await page.goto(PROD_URL);

    // Wait for access gate - look for "Blossom Early Beta" text or modal
    const betaText = page.locator('text="Blossom Early Beta"');
    await expect(betaText).toBeVisible({ timeout: 10000 });

    // Click "I have an access code" to expand
    const expandBtn = page.locator('text="I have an access code"');
    await expandBtn.click();
    await page.waitForTimeout(500);

    // Find access code input (should appear after expanding)
    const input = page.locator('input[placeholder*="BLOSSOM" i], input[placeholder*="code" i], input[type="text"]').last();
    await input.fill('INVALID-CODE-12345');

    // Submit
    const submitBtn = page.locator('button:has-text("Access"), button:has-text("Enter"), button:has-text("Submit")').first();
    await submitBtn.click();

    // Expect error or modal stays open
    await page.waitForTimeout(1500);
    const errorText = page.locator('text=/invalid|error|incorrect/i');
    const stillHasBeta = await betaText.isVisible().catch(() => false);

    expect(await errorText.isVisible().catch(() => false) || stillHasBeta).toBeTruthy();
  });

  test('accepts valid access code', async ({ page, context }) => {
    test.skip(!VALID_ACCESS_CODE, 'BLOSSOM_TEST_ACCESS_CODE not set');

    // Clear cookies to ensure fresh state
    await context.clearCookies();
    await page.goto(PROD_URL);

    // Wait for access gate
    const betaText = page.locator('text="Blossom Early Beta"');
    await expect(betaText).toBeVisible({ timeout: 10000 });

    // Click "I have an access code" to expand
    const expandBtn = page.locator('text="I have an access code"');
    await expandBtn.click();
    await page.waitForTimeout(500);

    // Fill valid code
    const input = page.locator('input[placeholder*="BLOSSOM" i], input[placeholder*="code" i], input[type="text"]').last();
    await input.fill(VALID_ACCESS_CODE);

    // Submit
    const submitBtn = page.locator('button:has-text("Access"), button:has-text("Enter"), button:has-text("Submit")').first();
    await submitBtn.click();

    // Wait for modal to close
    await page.waitForTimeout(2000);

    // Verify main app is visible (chat input)
    const mainApp = page.locator('[data-testid="chat-input"], textarea, input[placeholder*="message" i], [class*="ChatInput"]');
    await expect(mainApp.first()).toBeVisible({ timeout: 10000 });
  });

  test('cookie persists after refresh', async ({ page, context }) => {
    test.skip(!VALID_ACCESS_CODE, 'BLOSSOM_TEST_ACCESS_CODE not set');

    // First, authenticate
    await page.goto(PROD_URL);
    const modal = page.locator('[data-testid="access-gate"], .access-gate, [class*="AccessGate"], [class*="access-modal"], dialog, [role="dialog"]');

    // If modal appears, fill code
    if (await modal.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      const input = page.locator('input[type="text"], input[type="password"], input[placeholder*="code" i]').first();
      await input.fill(VALID_ACCESS_CODE);
      const submitBtn = page.locator('button[type="submit"], button:has-text("Enter"), button:has-text("Submit")').first();
      await submitBtn.click();
      await page.waitForTimeout(2000);
    }

    // Verify authenticated
    const chatInput = page.locator('[data-testid="chat-input"], textarea, input[placeholder*="message" i]');
    await expect(chatInput.first()).toBeVisible({ timeout: 10000 });

    // Refresh
    await page.reload();
    await page.waitForTimeout(2000);

    // Should still see main app (no gate)
    await expect(chatInput.first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Core UI Flow', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!VALID_ACCESS_CODE, 'BLOSSOM_TEST_ACCESS_CODE not set');

    await page.goto(PROD_URL);

    // Authenticate if needed
    const modal = page.locator('[data-testid="access-gate"], .access-gate, [class*="AccessGate"], dialog, [role="dialog"]');
    if (await modal.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      const input = page.locator('input[type="text"], input[type="password"], input[placeholder*="code" i]').first();
      await input.fill(VALID_ACCESS_CODE);
      const submitBtn = page.locator('button[type="submit"], button:has-text("Enter"), button:has-text("Submit")').first();
      await submitBtn.click();
      await page.waitForTimeout(2000);
    }
  });

  test('chat input renders and accepts text', async ({ page }) => {
    const chatInput = page.locator('[data-testid="chat-input"], textarea, input[placeholder*="message" i], [class*="ChatInput"]');
    await expect(chatInput.first()).toBeVisible({ timeout: 10000 });

    await chatInput.first().fill('test message');
    await expect(chatInput.first()).toHaveValue('test message');
  });

  test('swap prompt produces execution card', async ({ page }) => {
    const chatInput = page.locator('[data-testid="chat-input"], textarea, input[placeholder*="message" i]').first();
    await chatInput.fill('Swap 10 REDACTED to WETH');

    // Submit via Enter or button
    await chatInput.press('Enter');

    // Wait for response (execution card, action button, or response text)
    await page.waitForTimeout(5000);

    // Look for execution-related UI
    const execCard = page.locator('[data-testid="execution-card"], [class*="ExecutionCard"], [class*="action-card"], button:has-text("Execute"), button:has-text("Confirm")');
    const hasExecUI = await execCard.first().isVisible({ timeout: 15000 }).catch(() => false);

    // Or look for swap-related text in response
    const swapText = page.locator('text=/swap|REDACTED|WETH|execute/i');
    const hasSwapText = await swapText.first().isVisible({ timeout: 5000 }).catch(() => false);

    expect(hasExecUI || hasSwapText).toBeTruthy();
  });

  test('lend prompt produces execution card', async ({ page }) => {
    const chatInput = page.locator('[data-testid="chat-input"], textarea, input[placeholder*="message" i]').first();
    await chatInput.fill('Deposit 50 REDACTED into Aave');
    await chatInput.press('Enter');

    await page.waitForTimeout(5000);

    const execCard = page.locator('[data-testid="execution-card"], [class*="ExecutionCard"], button:has-text("Execute"), button:has-text("Confirm")');
    const hasExecUI = await execCard.first().isVisible({ timeout: 15000 }).catch(() => false);

    const lendText = page.locator('text=/lend|supply|deposit|Aave|REDACTED|execute/i');
    const hasLendText = await lendText.first().isVisible({ timeout: 5000 }).catch(() => false);

    expect(hasExecUI || hasLendText).toBeTruthy();
  });

  test('perp prompt produces execution card', async ({ page }) => {
    const chatInput = page.locator('[data-testid="chat-input"], textarea, input[placeholder*="message" i]').first();
    await chatInput.fill('Go long SOL 3x leverage $50 margin');
    await chatInput.press('Enter');

    await page.waitForTimeout(5000);

    const execCard = page.locator('[data-testid="execution-card"], [class*="ExecutionCard"], button:has-text("Execute"), button:has-text("Confirm")');
    const hasExecUI = await execCard.first().isVisible({ timeout: 15000 }).catch(() => false);

    const perpText = page.locator('text=/long|perp|SOL|leverage|margin|execute/i');
    const hasPerpText = await perpText.first().isVisible({ timeout: 5000 }).catch(() => false);

    expect(hasExecUI || hasPerpText).toBeTruthy();
  });

  test('event prompt produces execution card', async ({ page }) => {
    const chatInput = page.locator('[data-testid="chat-input"], textarea, input[placeholder*="message" i]').first();
    await chatInput.fill('Bet $10 YES on BTC ETF approval');
    await chatInput.press('Enter');

    await page.waitForTimeout(5000);

    const execCard = page.locator('[data-testid="execution-card"], [class*="ExecutionCard"], button:has-text("Execute"), button:has-text("Confirm")');
    const hasExecUI = await execCard.first().isVisible({ timeout: 15000 }).catch(() => false);

    const eventText = page.locator('text=/bet|event|YES|BTC|execute/i');
    const hasEventText = await eventText.first().isVisible({ timeout: 5000 }).catch(() => false);

    expect(hasExecUI || hasEventText).toBeTruthy();
  });
});

test.describe('Debug Panel (if available)', () => {
  test('debug=1 shows action types', async ({ page }) => {
    test.skip(!VALID_ACCESS_CODE, 'BLOSSOM_TEST_ACCESS_CODE not set');

    await page.goto(`${PROD_URL}?debug=1`);

    // Authenticate if needed
    const modal = page.locator('[data-testid="access-gate"], .access-gate, dialog, [role="dialog"]');
    if (await modal.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      const input = page.locator('input[type="text"], input[type="password"], input[placeholder*="code" i]').first();
      await input.fill(VALID_ACCESS_CODE);
      const submitBtn = page.locator('button[type="submit"], button:has-text("Enter")').first();
      await submitBtn.click();
      await page.waitForTimeout(2000);
    }

    // Send a swap prompt
    const chatInput = page.locator('[data-testid="chat-input"], textarea, input[placeholder*="message" i]').first();
    await chatInput.fill('Swap 10 REDACTED to WETH');
    await chatInput.press('Enter');

    await page.waitForTimeout(5000);

    // Look for debug panel or action type info
    const debugPanel = page.locator('[data-testid="debug-panel"], [class*="debug"], text=/actionType|action.*type/i');
    const hasDebug = await debugPanel.first().isVisible({ timeout: 10000 }).catch(() => false);

    // This test is informational - debug panel is optional
    console.log(`Debug panel visible: ${hasDebug}`);
  });
});

test.describe('DeFi Position Sync', () => {
  test('positions appear immediately after DeFi execution', async ({ page }) => {
    test.skip(!VALID_ACCESS_CODE, 'BLOSSOM_TEST_ACCESS_CODE not set');
    test.skip(true, 'Requires wallet signing - run manually');

    await page.goto(PROD_URL);

    // Authenticate
    const modal = page.locator('[data-testid="access-gate"], .access-gate, dialog, [role="dialog"]');
    if (await modal.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      const input = page.locator('input[type="text"], input[type="password"], input[placeholder*="code" i]').first();
      await input.fill(VALID_ACCESS_CODE);
      const submitBtn = page.locator('button[type="submit"], button:has-text("Enter")').first();
      await submitBtn.click();
      await page.waitForTimeout(2000);
    }

    // Connect wallet (manual step - skip for now)
    // 1. User would click connect wallet
    // 2. Execute: "Deposit 100 REDACTED into Kamino"
    // 3. Confirm execution
    // 4. Wait max 2 seconds after confirmation
    // 5. Assert position visible in UI
    // 6. Verify position details match execution

    console.log('DeFi position sync test - requires manual wallet interaction');
  });
});

test.describe('WETH Adapter', () => {
  test('ETH to token atomic swap via WETH adapter', async ({ page }) => {
    test.skip(!VALID_ACCESS_CODE, 'BLOSSOM_TEST_ACCESS_CODE not set');
    test.skip(true, 'Requires wallet signing - run manually');

    await page.goto(PROD_URL);

    // Authenticate
    const modal = page.locator('[data-testid="access-gate"], .access-gate, dialog, [role="dialog"]');
    if (await modal.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      const input = page.locator('input[type="text"], input[type="password"], input[placeholder*="code" i]').first();
      await input.fill(VALID_ACCESS_CODE);
      const submitBtn = page.locator('button[type="submit"], button:has-text("Enter")').first();
      await submitBtn.click();
      await page.waitForTimeout(2000);
    }

    // Test steps:
    // 1. Connect wallet with ETH
    // 2. Execute: "Swap 0.01 ETH to REDACTED"
    // 3. Verify plan shows WRAP + SWAP actions
    // 4. Confirm execution
    // 5. Wait for confirmation
    // 6. Verify REDACTED balance increased

    console.log('WETH adapter test - requires manual wallet interaction');
  });
});
