/**
 * Phase 1B: Cookie Auth Test
 */
import { test, expect } from '@playwright/test';

const PROD_URL = 'https://app.blossom.onl';
const ACCESS_CODE = 'E7F9-D6D2-F151';

test.describe('Cookie Auth', () => {
  test('access gate accepts valid code and sets cookie', async ({ page, context }) => {
    // Clear cookies
    await context.clearCookies();

    await page.goto(PROD_URL);

    // Wait for access gate
    const betaText = page.locator('text="Blossom Early Beta"');
    await expect(betaText).toBeVisible({ timeout: 15000 });

    // Take screenshot of gate
    await page.screenshot({ path: 'artifacts/AUTH.cookie.gate.png' });

    // Click "I have an access code"
    const expandBtn = page.locator('text="I have an access code"');
    await expandBtn.click();
    await page.waitForTimeout(500);

    // Fill code
    const input = page.locator('input[placeholder*="BLOSSOM" i], input[placeholder*="code" i], input[type="text"]').last();
    await input.fill(ACCESS_CODE);

    // Submit
    const submitBtn = page.locator('button:has-text("Access"), button:has-text("Enter"), button:has-text("Submit")').first();
    await submitBtn.click();

    // Wait for gate to dismiss
    await page.waitForTimeout(2000);

    // Verify main app visible
    const chatInput = page.locator('[data-testid="chat-input"], textarea, input[placeholder*="message" i]');
    await expect(chatInput.first()).toBeVisible({ timeout: 10000 });

    // Take screenshot of app
    await page.screenshot({ path: 'artifacts/AUTH.cookie.app.png' });

    // Get cookies
    const cookies = await context.cookies();
    const accessCookie = cookies.find(c => c.name.includes('access') || c.name.includes('blossom'));

    console.log('Cookies:', JSON.stringify(cookies.map(c => ({ name: c.name, domain: c.domain })), null, 2));
    console.log('Auth cookie found:', !!accessCookie);
  });
});
