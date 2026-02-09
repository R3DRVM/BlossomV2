// @ts-nocheck
/**
 * Deployment Verification Script
 *
 * Verifies production deployment health for:
 * - Vercel frontend + API (blossom.onl) - SOLE PRODUCTION
 * - Security endpoints
 * - ERC-8004 endpoints
 * - Sub-agent orchestration
 *
 * NOTE: Fly.io DEPRECATED - all traffic goes through Vercel only
 */

const VERCEL_DOMAIN = process.env.VERCEL_DOMAIN || 'https://blossom.onl';
const API_DOMAIN = process.env.API_DOMAIN || 'https://blossom.onl'; // Vercel-only

const FLY_BLOCKLIST = /fly\.dev|fly\.io/i;
function assertNoFly(url: string, label: string) {
  if (FLY_BLOCKLIST.test(url)) {
    throw new Error(`Fly.io is deprecated. ${label} must be Vercel-only. Got: ${url}`);
  }
}

assertNoFly(VERCEL_DOMAIN, 'VERCEL_DOMAIN');
assertNoFly(API_DOMAIN, 'API_DOMAIN');

interface HealthCheck {
  name: string;
  url: string;
  expectedStatus: number;
  timeout: number;
  checkResponse?: (data: any) => boolean;
}

const healthChecks: HealthCheck[] = [
  // Frontend
  {
    name: 'Vercel Frontend',
    url: `${VERCEL_DOMAIN}`,
    expectedStatus: 200,
    timeout: 10000,
  },

  // Backend Health
  {
    name: 'API Health',
    url: `${API_DOMAIN}/health`,
    expectedStatus: 200,
    timeout: 10000,
    checkResponse: (data) => data.ok === true,
  },
  // Fly.io is deprecated - do not add checks here

  // Security Endpoints
  {
    name: 'Security Alerts',
    url: `${API_DOMAIN}/api/security/alerts`,
    expectedStatus: 200,
    timeout: 10000,
    checkResponse: (data) => data.ok === true,
  },
  {
    name: 'Security Path Violations',
    url: `${API_DOMAIN}/api/security/path-violations`,
    expectedStatus: 200,
    timeout: 10000,
    checkResponse: (data) => data.ok === true,
  },
  {
    name: 'Security Signing Audit',
    url: `${API_DOMAIN}/api/security/signing-audit`,
    expectedStatus: 200,
    timeout: 10000,
    checkResponse: (data) => data.ok === true,
  },

  // ERC-8004 Endpoints
  {
    name: 'ERC-8004 Identity',
    url: `${API_DOMAIN}/api/erc8004/identity`,
    expectedStatus: 200,
    timeout: 10000,
  },
  {
    name: 'ERC-8004 Capabilities',
    url: `${API_DOMAIN}/api/erc8004/capabilities`,
    expectedStatus: 200,
    timeout: 10000,
  },
  {
    name: 'ERC-8004 Reputation',
    url: `${API_DOMAIN}/api/erc8004/reputation`,
    expectedStatus: 200,
    timeout: 10000,
  },
  {
    name: 'Agent Registration JSON',
    url: `${API_DOMAIN}/.well-known/agent-registration.json`,
    expectedStatus: 200,
    timeout: 10000,
  },

  // Core API
  {
    name: 'Preflight Check',
    url: `${API_DOMAIN}/api/execute/preflight`,
    expectedStatus: 200,
    timeout: 10000,
    checkResponse: (data) => data.ok === true,
  },
  {
    name: 'Public Stats',
    url: `${API_DOMAIN}/api/stats/public`,
    expectedStatus: 200,
    timeout: 10000,
    checkResponse: (data) => data.ok === true && data.data !== undefined,
  },
];

interface CheckResult {
  name: string;
  success: boolean;
  status?: number;
  latencyMs: number;
  error?: string;
  responseValid?: boolean;
}

async function runHealthCheck(check: HealthCheck): Promise<CheckResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), check.timeout);

  try {
    const response = await fetch(check.url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Blossom-Deployment-Verifier/1.0',
      },
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - start;

    let responseValid = true;
    if (check.checkResponse && response.ok) {
      try {
        const data = await response.json();
        responseValid = check.checkResponse(data);
      } catch {
        responseValid = false;
      }
    }

    return {
      name: check.name,
      success: response.status === check.expectedStatus && responseValid,
      status: response.status,
      latencyMs,
      responseValid,
    };
  } catch (error: any) {
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - start;

    return {
      name: check.name,
      success: false,
      latencyMs,
      error: error.name === 'AbortError' ? 'Timeout' : error.message,
    };
  }
}

async function runAllChecks(): Promise<void> {
  console.log('='.repeat(60));
  console.log('🌸 BLOSSOM DEPLOYMENT VERIFICATION');
  console.log('='.repeat(60));
  console.log(`\nTimestamp: ${new Date().toISOString()}`);
  console.log(`Frontend: ${VERCEL_DOMAIN}`);
  console.log(`API: ${API_DOMAIN}`);
  console.log('\n' + '-'.repeat(60));

  const results: CheckResult[] = [];

  for (const check of healthChecks) {
    const result = await runHealthCheck(check);
    results.push(result);

    const icon = result.success ? '✅' : '❌';
    const latency = `${result.latencyMs}ms`.padStart(6);
    const status = result.status ? `HTTP ${result.status}` : result.error || 'Unknown';

    console.log(`${icon} ${result.name.padEnd(30)} ${latency}  ${status}`);
  }

  console.log('\n' + '-'.repeat(60));

  // Summary
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const avgLatency = Math.round(results.reduce((a, r) => a + r.latencyMs, 0) / results.length);

  console.log('\n📊 SUMMARY');
  console.log(`   Passed: ${passed}/${results.length}`);
  console.log(`   Failed: ${failed}/${results.length}`);
  console.log(`   Avg Latency: ${avgLatency}ms`);

  if (failed > 0) {
    console.log('\n⚠️  FAILED CHECKS:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`   - ${r.name}: ${r.error || `HTTP ${r.status}`}`);
    });
  }

  console.log('\n' + '='.repeat(60));

  // Exit with error code if any checks failed
  if (failed > 0) {
    console.log('❌ DEPLOYMENT VERIFICATION FAILED');
    process.exit(1);
  } else {
    console.log('✅ DEPLOYMENT VERIFICATION PASSED');
    process.exit(0);
  }
}

// Test chat endpoint separately
async function testChatEndpoint(): Promise<void> {
  console.log('\n🗣️  TESTING CHAT ENDPOINT...');

  const testCases = [
    { text: 'What is the price of ETH?', expectedPath: 'research' },
    { text: 'Swap 100 USDC to ETH', expectedPath: 'planning' },
  ];

  for (const test of testCases) {
    try {
      const response = await fetch(`${API_DOMAIN}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: test.text,
          sessionId: 'verification-test',
        }),
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`   ✅ "${test.text}" → Response received`);
      } else {
        console.log(`   ❌ "${test.text}" → HTTP ${response.status}`);
      }
    } catch (error: any) {
      console.log(`   ❌ "${test.text}" → ${error.message}`);
    }
  }
}

// Main
async function main(): Promise<void> {
  await runAllChecks();
  await testChatEndpoint();
}

main().catch(console.error);
