#!/usr/bin/env node
/**
 * Regression smoke: health, preflight, session, and optional positions stability.
 * Run locally or against prod: BASE_URL=https://api.blossom.onl node scripts/smoke-positions.mjs
 * Optional: set LEDGER_SECRET to assert positions endpoint returns stable count across two reads (no duplication).
 */
const BASE_URL = process.env.BASE_URL || process.argv[2] || 'http://localhost:3001';
const LEDGER_SECRET = process.env.LEDGER_SECRET || process.env.VITE_DEV_LEDGER_SECRET;

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000), ...opts });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`${url} ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function run() {
  console.log('Smoke positions (regression):', BASE_URL, '\n');

  try {
    const health = await fetchJson(`${BASE_URL}/api/health`);
    if (health?.ok !== true) {
      console.error('FAIL /api/health: expected { ok: true }');
      process.exit(1);
    }
    console.log('OK /api/health');

    const preflight = await fetchJson(`${BASE_URL}/api/execute/preflight`);
    if (preflight?.chainId === undefined && preflight?.swapEnabled === undefined) {
      console.error('FAIL /api/execute/preflight: expected chainId or swapEnabled');
      process.exit(1);
    }
    console.log('OK /api/execute/preflight');

    const sessionStatus = await fetchJson(`${BASE_URL}/api/session/status`);
    if (sessionStatus?.ok !== true) {
      console.error('FAIL /api/session/status: expected { ok: true }');
      process.exit(1);
    }
    console.log('OK /api/session/status');

    if (LEDGER_SECRET) {
      const positionsUrl = `${BASE_URL}/api/ledger/positions?status=open`;
      const headers = { 'X-Ledger-Secret': LEDGER_SECRET };
      const data1 = await fetchJson(positionsUrl, { headers });
      const count1 = Array.isArray(data1.positions) ? data1.positions.length : 0;
      const data2 = await fetchJson(positionsUrl, { headers });
      const count2 = Array.isArray(data2.positions) ? data2.positions.length : 0;
      if (count1 !== count2) {
        console.error('FAIL positions stability: first read', count1, 'second read', count2);
        process.exit(1);
      }
      console.log('OK /api/ledger/positions (stable count:', count1, ')');
    } else {
      console.log('SKIP /api/ledger/positions (set LEDGER_SECRET for positions stability check)');
    }
  } catch (e) {
    if (e.cause?.code === 'ECONNREFUSED' || e.message?.includes('fetch failed')) {
      console.error('FAIL Backend not reachable at', BASE_URL);
    } else {
      console.error('FAIL', e.message);
    }
    process.exit(1);
  }

  console.log('\nPASS');
  process.exit(0);
}

run();
