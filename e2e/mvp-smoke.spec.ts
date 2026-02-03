/**
 * MVP golden-path smoke: site loads, no wallet.
 * Backend health/preflight: use `npm run smoke:http` (scripts/smoke-http.mjs).
 */
import { test, expect } from '@playwright/test';

test.describe('MVP smoke', () => {
  test('site loads and shows app or gate', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible({ timeout: 15000 });
    const hasBlossom = page.locator('text=/Blossom/i').first();
    await expect(hasBlossom).toBeVisible({ timeout: 10000 });
  });
});
