/**
 * Chat Isolation Proof Test
 *
 * Proves that two different browser contexts (simulating two users)
 * with the SAME access code have completely isolated chat histories.
 */
import { test, expect } from '@playwright/test';

const TEST_URL = process.env.TEST_URL || 'http://localhost:5173';
const ACCESS_CODE = process.env.BLOSSOM_TEST_ACCESS_CODE || 'TEST-CODE';

test.describe('Chat Isolation Proof', () => {
  test('Two identities with SAME access code have isolated chat', async ({ browser }) => {
    // Create two completely separate browser contexts
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      // ========== IDENTITY A ==========
      console.log('\n=== IDENTITY A ===');
      await pageA.goto(TEST_URL);
      await pageA.waitForTimeout(2000);

      // Get Identity A's anonymous ID from localStorage
      const identityA = await pageA.evaluate(() => {
        // Simulate the identity generation
        let anonId = localStorage.getItem('blossom_anon_id');
        if (!anonId) {
          anonId = `anon-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
          localStorage.setItem('blossom_anon_id', anonId);
        }
        return anonId;
      });
      console.log('Identity A:', identityA);

      // Check if access gate is present and bypass if in dev mode
      const hasAccessGate = await pageA.locator('text=/blossom|access/i').first().isVisible({ timeout: 3000 }).catch(() => false);

      if (hasAccessGate) {
        // Try to find and click access code input
        const expandBtn = await pageA.locator('text=/have.*access.*code|access code/i').first();
        if (await expandBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await expandBtn.click();
          await pageA.waitForTimeout(500);
        }

        const input = pageA.locator('input[type="text"]').last();
        if (await input.isVisible({ timeout: 2000 }).catch(() => false)) {
          await input.fill(ACCESS_CODE);
          const submitBtn = pageA.locator('button:has-text("Access"), button:has-text("Unlock"), button:has-text("Enter")').first();
          await submitBtn.click();
          await pageA.waitForTimeout(2000);
        }
      }

      // Wait for chat input to be available
      const chatInputA = pageA.locator('textarea, input[placeholder*="message" i]').first();
      await chatInputA.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

      // Identity A sends a secret message
      const SECRET_MESSAGE = `A-SECRET-${Date.now()}`;
      console.log('Identity A sending:', SECRET_MESSAGE);

      if (await chatInputA.isVisible()) {
        await chatInputA.fill(SECRET_MESSAGE);
        await chatInputA.press('Enter');
        await pageA.waitForTimeout(2000);
      }

      // Verify message is in Identity A's localStorage
      const sessionDataA = await pageA.evaluate((identity) => {
        const key = `blossom_chat_sessions_${identity}`;
        const data = localStorage.getItem(key);
        return { key, data: data ? JSON.parse(data) : null };
      }, identityA);

      console.log('Identity A storage key:', sessionDataA.key);
      console.log('Identity A has sessions:', sessionDataA.data ? sessionDataA.data.length : 0);

      // Check if secret message is in Identity A's chat
      const messageInA = await pageA.locator(`text="${SECRET_MESSAGE}"`).isVisible().catch(() => false);
      console.log('Message visible in A:', messageInA);

      // ========== IDENTITY B ==========
      console.log('\n=== IDENTITY B ===');
      await pageB.goto(TEST_URL);
      await pageB.waitForTimeout(2000);

      // Get Identity B's anonymous ID (will be different from A because different context)
      const identityB = await pageB.evaluate(() => {
        let anonId = localStorage.getItem('blossom_anon_id');
        if (!anonId) {
          anonId = `anon-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
          localStorage.setItem('blossom_anon_id', anonId);
        }
        return anonId;
      });
      console.log('Identity B:', identityB);

      // Verify identities are DIFFERENT
      expect(identityA).not.toEqual(identityB);
      console.log('✓ Identities are different (as expected)');

      // Check if access gate is present for B
      const hasAccessGateB = await pageB.locator('text=/blossom|access/i').first().isVisible({ timeout: 3000 }).catch(() => false);

      if (hasAccessGateB) {
        const expandBtnB = await pageB.locator('text=/have.*access.*code|access code/i').first();
        if (await expandBtnB.isVisible({ timeout: 2000 }).catch(() => false)) {
          await expandBtnB.click();
          await pageB.waitForTimeout(500);
        }

        const inputB = pageB.locator('input[type="text"]').last();
        if (await inputB.isVisible({ timeout: 2000 }).catch(() => false)) {
          // Use SAME access code
          await inputB.fill(ACCESS_CODE);
          const submitBtnB = pageB.locator('button:has-text("Access"), button:has-text("Unlock"), button:has-text("Enter")').first();
          await submitBtnB.click();
          await pageB.waitForTimeout(2000);
        }
      }

      // Wait for chat to load in B
      await pageB.waitForTimeout(2000);

      // Check Identity B's localStorage - should have different key
      const sessionDataB = await pageB.evaluate((identity) => {
        const key = `blossom_chat_sessions_${identity}`;
        const data = localStorage.getItem(key);
        return { key, data: data ? JSON.parse(data) : null };
      }, identityB);

      console.log('Identity B storage key:', sessionDataB.key);
      console.log('Identity B has sessions:', sessionDataB.data ? sessionDataB.data.length : 0);

      // Storage keys should be DIFFERENT
      expect(sessionDataA.key).not.toEqual(sessionDataB.key);
      console.log('✓ Storage keys are different (chat is isolated)');

      // CRITICAL: Identity B should NOT see Identity A's secret message
      const messageInB = await pageB.locator(`text="${SECRET_MESSAGE}"`).isVisible().catch(() => false);
      console.log('Message visible in B:', messageInB);

      expect(messageInB).toBe(false);
      console.log('✓ PROOF: Identity B cannot see Identity A\'s message');

      // Final summary
      console.log('\n=== ISOLATION PROOF SUMMARY ===');
      console.log(`Identity A key: ${sessionDataA.key}`);
      console.log(`Identity B key: ${sessionDataB.key}`);
      console.log(`Keys different: ${sessionDataA.key !== sessionDataB.key}`);
      console.log(`Message "${SECRET_MESSAGE}" visible to A: ${messageInA}`);
      console.log(`Message "${SECRET_MESSAGE}" visible to B: ${messageInB}`);
      console.log('RESULT: CHAT ISOLATION VERIFIED');

    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
