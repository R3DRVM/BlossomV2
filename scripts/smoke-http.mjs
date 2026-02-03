#!/usr/bin/env node
/**
 * MVP readiness smoke: health + preflight + session readiness.
 * No browser; for CI and prod backend checks.
 * Source: MVP_FINALIZATION_PLAN.md (curl checks).
 */
const BASE_URL = process.env.BASE_URL || process.argv[2] || 'http://localhost:3001';

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
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
  console.log('Smoke HTTP (MVP readiness):', BASE_URL, '\n');

  try {
    const health = await fetchJson(`${BASE_URL}/api/health`);
    if (health?.ok !== true) {
      console.error('FAIL /api/health: expected { ok: true }, got', health);
      process.exit(1);
    }
    console.log('OK /api/health');

    const preflight = await fetchJson(`${BASE_URL}/api/execute/preflight`);
    if (preflight?.chainId === undefined && preflight?.swapEnabled === undefined) {
      console.error('FAIL /api/execute/preflight: expected chainId or swapEnabled, got', Object.keys(preflight || {}));
      process.exit(1);
    }
    console.log('OK /api/execute/preflight');

    const sessionStatus = await fetchJson(`${BASE_URL}/api/session/status`);
    if (sessionStatus?.ok !== true) {
      console.error('FAIL /api/session/status: expected { ok: true }, got', sessionStatus);
      process.exit(1);
    }
    if (sessionStatus?.mode === undefined && sessionStatus?.session === undefined) {
      console.error('FAIL /api/session/status: expected mode or session, got', Object.keys(sessionStatus || {}));
      process.exit(1);
    }
    console.log('OK /api/session/status (session readiness)');
  } catch (e) {
    if (e.cause?.code === 'ECONNREFUSED' || e.message?.includes('fetch failed'))
      console.error('FAIL Backend not reachable at', BASE_URL);
    else
      console.error('FAIL', e.message);
    process.exit(1);
  }

  console.log('\nPASS');
  process.exit(0);
}

run();
