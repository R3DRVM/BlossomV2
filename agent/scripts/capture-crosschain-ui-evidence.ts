#!/usr/bin/env npx tsx
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const APP_URL = process.env.EVIDENCE_APP_URL || 'https://app.blossom.onl';
const ACCESS_CODE = process.env.BLOSSOM_ACCESS_CODE || process.env.ACCESS_CODE || '';
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.resolve(process.cwd(), 'logs', `ui-evidence-${timestamp}`);

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();

  const report: Record<string, any> = {
    appUrl: APP_URL,
    startedAt: Date.now(),
    artifacts: {},
    checks: {},
  };

  try {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: path.join(outDir, '01-initial.png'), fullPage: true });
    report.artifacts.initial = path.join(outDir, '01-initial.png');

    if (ACCESS_CODE) {
      const gateInput = page.locator('input[placeholder*="code"], input[name="code"]');
      if (await gateInput.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
        await gateInput.first().fill(ACCESS_CODE);
        const submit = page.getByRole('button', { name: /enter|unlock|continue|submit/i });
        if (await submit.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
          await submit.first().click();
          await page.waitForTimeout(1_500);
        }
      }
    }

    const textarea = page.locator('textarea').first();
    await textarea.waitFor({ timeout: 30_000 });
    await textarea.fill('Long BTC with 3x leverage using 100 bUSDC collateral and route from Solana devnet to Sepolia.');

    const sendButton = page.getByRole('button', { name: /^send$/i }).first();
    if (await sendButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await sendButton.click();
    } else {
      await textarea.press('Enter');
    }

    const confirmButton = page.getByRole('button', { name: /confirm & execute/i }).first();
    await confirmButton.waitFor({ timeout: 60_000 });
    await confirmButton.click();

    const routingSeen = await page.getByText('Routing...', { exact: false }).first().isVisible({ timeout: 20_000 }).catch(() => false);
    if (routingSeen) {
      await page.screenshot({ path: path.join(outDir, '02-routing.png'), fullPage: true });
      report.artifacts.routing = path.join(outDir, '02-routing.png');
    }

    const executingSeen = await page.getByText('Executing...', { exact: false }).first().isVisible({ timeout: 40_000 }).catch(() => false);
    if (executingSeen) {
      await page.screenshot({ path: path.join(outDir, '03-executing.png'), fullPage: true });
      report.artifacts.executing = path.join(outDir, '03-executing.png');
    }

    await delay(1_500);
    const whySetupSeen = await page.getByText('Why this setup?', { exact: false }).first().isVisible({ timeout: 10_000 }).catch(() => false);
    const routeBulletSeen = await page.getByText(/routed your busdc/i).first().isVisible({ timeout: 10_000 }).catch(() => false);
    if (whySetupSeen || routeBulletSeen) {
      await page.screenshot({ path: path.join(outDir, '04-route-bullet.png'), fullPage: true });
      report.artifacts.routeBullet = path.join(outDir, '04-route-bullet.png');
    }

    const domPath = path.join(outDir, 'dom-capture.html');
    fs.writeFileSync(domPath, await page.content(), 'utf8');
    report.artifacts.dom = domPath;
    report.checks = {
      routingSeen,
      executingSeen,
      whySetupSeen,
      routeBulletSeen,
    };
  } finally {
    report.finishedAt = Date.now();
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
    await context.close();
    await browser.close();
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch((error) => {
  console.error('[capture-crosschain-ui-evidence] failed', error);
  process.exit(1);
});

