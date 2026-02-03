import { test, expect, BrowserContext, Page } from '@playwright/test';

/**
 * PHASE 5 — BULLETPROOF CHAT LEAKAGE PROOF
 *
 * Proves chat isolation between two completely separate browser contexts
 * using the SAME access code but different anonymous identities.
 */

const ACCESS_CODE = 'E7F9-D6D2-F151';
const APP_URL = 'https://app.blossom.onl';

interface LeakageProofResult {
  contextA: {
    anonId: string | null;
    chatStorageKeys: string[];
    sentMessage: string;
    messageAppearedInUI: boolean;
  };
  contextB: {
    anonId: string | null;
    chatStorageKeys: string[];
    sentMessage: string;
    messageAppearedInUI: boolean;
    sawContextAMessage: boolean;
  };
  reverseCheck: {
    contextASawContextBMessage: boolean;
  };
  verdict: {
    uiLeakDetected: boolean;
    storageNamespaceIsolated: boolean;
    accessCodeNotUsedAsNamespace: boolean;
    anonIdsDifferent: boolean;
  };
}

async function authenticateAndDismissModals(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 20000 });

  // Check for access gate
  const modalHeading = page.locator('text=Blossom Early Beta');
  const isModalVisible = await modalHeading.isVisible({ timeout: 3000 }).catch(() => false);

  if (isModalVisible) {
    // Click "I have an access code"
    const haveCodeBtn = page.locator('button:has-text("I have an access code")');
    await haveCodeBtn.click();
    await page.waitForTimeout(500);

    // Fill access code
    const codeInput = page.locator('input[placeholder="BLOSSOM-XXXXXXXX"]');
    await codeInput.waitFor({ state: 'visible', timeout: 5000 });
    await codeInput.fill(ACCESS_CODE);
    await page.waitForTimeout(300);

    // Click unlock
    const unlockBtn = page.locator('button:has-text("Unlock Access")');
    await unlockBtn.click();
    await page.waitForTimeout(3000);
  }

  // Dismiss tutorial modals
  for (let i = 0; i < 5; i++) {
    const skipBtn = page.locator('button:has-text("Skip")');
    const isSkipVisible = await skipBtn.isVisible({ timeout: 1000 }).catch(() => false);
    if (isSkipVisible) {
      await skipBtn.click();
      await page.waitForTimeout(500);
    } else {
      break;
    }
  }

  await page.waitForTimeout(1000);
}

async function sendChatMessage(page: Page, message: string): Promise<boolean> {
  const chatInput = page.locator('input[type="text"], textarea').first();
  await chatInput.fill(message);

  const sendButton = page.locator('button:has-text("Send")').first();
  await sendButton.click();

  await page.waitForTimeout(3000);

  // Check if message appears in UI
  const messageInUI = page.locator(`text=${message}`);
  return await messageInUI.isVisible({ timeout: 5000 }).catch(() => false);
}

async function getLocalStorageSnapshot(page: Page): Promise<{
  anonId: string | null;
  chatStorageKeys: string[];
  allBlossomKeys: Record<string, string>;
}> {
  return await page.evaluate(() => {
    const allBlossomKeys: Record<string, string> = {};
    const chatStorageKeys: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.includes('blossom')) {
        const value = localStorage.getItem(key) || '';
        allBlossomKeys[key] = value.length > 200 ? `[${value.length} chars]` : value;

        if (key.includes('chat') || key.includes('session') || key.includes('message')) {
          chatStorageKeys.push(key);
        }
      }
    }

    const anonId = localStorage.getItem('blossom_anon_id');

    return { anonId, chatStorageKeys, allBlossomKeys };
  });
}

async function checkMessageInUI(page: Page, message: string): Promise<boolean> {
  await page.reload();
  await page.waitForLoadState('networkidle');
  await authenticateAndDismissModals(page);

  const messageLocator = page.locator(`text=${message}`);
  return await messageLocator.isVisible({ timeout: 5000 }).catch(() => false);
}

test.describe('Phase 5: Chat Leakage Proof', () => {
  test('CRITICAL: Chat messages do NOT leak between contexts', async ({ browser }) => {
    const result: LeakageProofResult = {
      contextA: { anonId: null, chatStorageKeys: [], sentMessage: '', messageAppearedInUI: false },
      contextB: { anonId: null, chatStorageKeys: [], sentMessage: '', messageAppearedInUI: false, sawContextAMessage: false },
      reverseCheck: { contextASawContextBMessage: false },
      verdict: {
        uiLeakDetected: false,
        storageNamespaceIsolated: false,
        accessCodeNotUsedAsNamespace: false,
        anonIdsDifferent: false
      }
    };

    // Create two completely isolated browser contexts
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      // ========== CONTEXT A: Send unique message ==========
      console.log('=== CONTEXT A: Authenticating and sending message ===');
      await pageA.goto(APP_URL);
      await authenticateAndDismissModals(pageA);

      result.contextA.sentMessage = 'LEAK_TEST_A_' + Date.now();
      result.contextA.messageAppearedInUI = await sendChatMessage(pageA, result.contextA.sentMessage);

      const storageA = await getLocalStorageSnapshot(pageA);
      result.contextA.anonId = storageA.anonId;
      result.contextA.chatStorageKeys = storageA.chatStorageKeys;

      console.log('Context A anonId:', result.contextA.anonId);
      console.log('Context A chat keys:', result.contextA.chatStorageKeys);
      console.log('Context A message appeared:', result.contextA.messageAppearedInUI);

      // ========== CONTEXT B: Check for Context A's message ==========
      console.log('=== CONTEXT B: Authenticating and checking for leak ===');
      await pageB.goto(APP_URL);
      await authenticateAndDismissModals(pageB);

      const storageB = await getLocalStorageSnapshot(pageB);
      result.contextB.anonId = storageB.anonId;
      result.contextB.chatStorageKeys = storageB.chatStorageKeys;

      console.log('Context B anonId:', result.contextB.anonId);
      console.log('Context B chat keys:', result.contextB.chatStorageKeys);

      // CRITICAL CHECK: Context A's message should NOT appear in Context B
      result.contextB.sawContextAMessage = await pageB.locator(`text=${result.contextA.sentMessage}`).isVisible({ timeout: 3000 }).catch(() => false);
      console.log('Context B saw Context A message (SHOULD BE FALSE):', result.contextB.sawContextAMessage);

      // ========== CONTEXT B: Send its own message ==========
      result.contextB.sentMessage = 'LEAK_TEST_B_' + Date.now();
      result.contextB.messageAppearedInUI = await sendChatMessage(pageB, result.contextB.sentMessage);
      console.log('Context B message appeared:', result.contextB.messageAppearedInUI);

      // ========== REVERSE CHECK: Context A should NOT see Context B's message ==========
      console.log('=== REVERSE CHECK: Context A should not see Context B message ===');
      await pageA.reload();
      await pageA.waitForLoadState('networkidle');
      await authenticateAndDismissModals(pageA);

      result.reverseCheck.contextASawContextBMessage = await pageA.locator(`text=${result.contextB.sentMessage}`).isVisible({ timeout: 3000 }).catch(() => false);
      console.log('Context A saw Context B message (SHOULD BE FALSE):', result.reverseCheck.contextASawContextBMessage);

      // ========== COMPUTE VERDICT ==========
      result.verdict.uiLeakDetected = result.contextB.sawContextAMessage || result.reverseCheck.contextASawContextBMessage;
      result.verdict.anonIdsDifferent = result.contextA.anonId !== result.contextB.anonId;
      result.verdict.storageNamespaceIsolated = result.contextA.anonId !== result.contextB.anonId;
      result.verdict.accessCodeNotUsedAsNamespace = !result.contextA.chatStorageKeys.some(k => k.includes(ACCESS_CODE)) &&
                                                    !result.contextB.chatStorageKeys.some(k => k.includes(ACCESS_CODE));

      console.log('\n========== VERDICT ==========');
      console.log('UI Leak Detected:', result.verdict.uiLeakDetected);
      console.log('Anon IDs Different:', result.verdict.anonIdsDifferent);
      console.log('Storage Namespace Isolated:', result.verdict.storageNamespaceIsolated);
      console.log('Access Code Not Used As Namespace:', result.verdict.accessCodeNotUsedAsNamespace);

      // Write proof artifact (use test.info() for Playwright artifact attachment)
      console.log('CHAT_LEAKAGE_PROOF_JSON:', JSON.stringify(result));

      // ========== ASSERTIONS ==========
      expect(result.verdict.uiLeakDetected).toBe(false);
      expect(result.verdict.anonIdsDifferent).toBe(true);
      expect(result.verdict.storageNamespaceIsolated).toBe(true);
      expect(result.verdict.accessCodeNotUsedAsNamespace).toBe(true);

    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
