/**
 * Sprint 3.1: "New User Wow Path" End-to-End Proof
 * Single command that prints a friendly pass/fail checklist
 * 
 * Pre-demo sanity check before every tester session
 */

const API_BASE = process.env.AGENT_API_BASE_URL || 'http://localhost:3001';
const TEST_USER_ADDRESS = process.env.TEST_USER_ADDRESS || '0x' + '1'.repeat(40);

interface ChecklistItem {
  name: string;
  passed: boolean;
  message: string;
  details?: any;
}

const checklist: ChecklistItem[] = [];

function addCheck(name: string, passed: boolean, message: string, details?: any): void {
  checklist.push({ name, passed, message, details });
}

async function fetchJSON(url: string, options: RequestInit = {}): Promise<any> {
  try {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(10000), // 10s timeout
    });
    if (!response.ok) {
      const text = await response.text();
      let errorData: any;
      try {
        errorData = JSON.parse(text);
      } catch {
        errorData = { message: text };
      }
      return { _error: true, status: response.status, data: errorData };
    }
    return response.json();
  } catch (error: any) {
    return { _error: true, error: error.message };
  }
}

async function main() {
  console.log('✨ Sprint 3.1: "New User Wow Path" End-to-End Proof');
  console.log('='.repeat(60));
  console.log(`API Base: ${API_BASE}`);
  console.log(`Test User: ${TEST_USER_ADDRESS}`);
  console.log('='.repeat(60));
  console.log('');

  // 1. Health check
  console.log('[1/4] Checking /health...');
  try {
    const health = await fetchJSON(`${API_BASE}/health`);
    if (health._error) {
      addCheck('Health', false, `Failed: ${health.status || health.error}`);
    } else if (health.ok === true) {
      addCheck('Health', true, 'Backend is healthy', { executionMode: health.executionMode });
    } else {
      addCheck('Health', false, 'Backend returned ok=false');
    }
  } catch (error: any) {
    addCheck('Health', false, `Error: ${error.message}`);
  }

  // 2. Preflight check
  console.log('[2/4] Checking /api/execute/preflight...');
  try {
    const preflight = await fetchJSON(`${API_BASE}/api/execute/preflight`);
    if (preflight._error) {
      addCheck('Preflight', false, `Failed: ${preflight.status || preflight.error}`);
    } else {
      const hasRouting = typeof preflight.routing === 'object';
      const hasDflow = typeof preflight.dflow === 'object';
      const routingMode = preflight.routing?.mode || 'unknown';
      const dflowEnabled = preflight.dflow?.enabled === true;

      addCheck(
        'Preflight',
        hasRouting && hasDflow,
        `Routing mode: ${routingMode}, dFlow enabled: ${dflowEnabled}`,
        {
          routingMode,
          dflowEnabled,
          hasRouting,
          hasDflow,
        }
      );
    }
  } catch (error: any) {
    addCheck('Preflight', false, `Error: ${error.message}`);
  }

  // 3. Event markets check
  console.log('[3/4] Testing event markets endpoint...');
  try {
    const eventMarketsResponse = await fetchJSON(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userMessage: 'Show me top prediction markets',
        userAddress: TEST_USER_ADDRESS,
      }),
    });

    if (eventMarketsResponse._error) {
      addCheck('Event Markets', false, `Failed: ${eventMarketsResponse.status || eventMarketsResponse.error}`);
    } else {
      const routing = eventMarketsResponse.routing;
      const hasRouting = routing != null;
      const hasRequiredFields = routing && 
        typeof routing.source === 'string' &&
        typeof routing.kind === 'string' &&
        typeof routing.ok === 'boolean' &&
        typeof routing.latencyMs === 'number' &&
        typeof routing.mode === 'string' &&
        typeof routing.correlationId === 'string';

      const source = routing?.source || 'unknown';
      const mode = routing?.mode || 'unknown';
      const correlationId = routing?.correlationId || 'missing';
      const latencyMs = routing?.latencyMs || 0;

      addCheck(
        'Event Markets',
        hasRouting && hasRequiredFields,
        `source=${source} mode=${mode} latencyMs=${latencyMs}ms corr=${correlationId.substring(0, 20)}...`,
        {
          source,
          mode,
          correlationId,
          latencyMs,
          hasRouting,
          hasRequiredFields,
        }
      );
    }
  } catch (error: any) {
    addCheck('Event Markets', false, `Error: ${error.message}`);
  }

  // 4. Swap quote check
  console.log('[4/4] Testing swap quote endpoint...');
  try {
    const swapResponse = await fetchJSON(`${API_BASE}/api/execute/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draftId: 'test-new-user-wow',
        userAddress: TEST_USER_ADDRESS,
        authMode: 'session',
        executionRequest: {
          kind: 'swap',
          chain: 'sepolia',
          tokenIn: 'USDC',
          tokenOut: 'WETH',
          amountIn: '10',
        },
      }),
    });

    if (swapResponse._error) {
      addCheck('Swap Quote', false, `Failed: ${swapResponse.status || swapResponse.error}`);
    } else {
      // Routing metadata may be nested in routing.routing
      const routing = swapResponse.routing?.routing || swapResponse.routing;
      const hasRouting = routing != null;
      const hasRequiredFields = routing &&
        typeof routing.source === 'string' &&
        typeof routing.kind === 'string' &&
        typeof routing.ok === 'boolean' &&
        typeof routing.latencyMs === 'number' &&
        typeof routing.mode === 'string' &&
        typeof routing.correlationId === 'string';

      const source = routing?.source || 'unknown';
      const mode = routing?.mode || 'unknown';
      const correlationId = routing?.correlationId || 'missing';
      const latencyMs = routing?.latencyMs || 0;

      addCheck(
        'Swap Quote',
        hasRouting && hasRequiredFields,
        `source=${source} mode=${mode} latencyMs=${latencyMs}ms corr=${correlationId.substring(0, 20)}...`,
        {
          source,
          mode,
          correlationId,
          latencyMs,
          hasRouting,
          hasRequiredFields,
        }
      );
    }
  } catch (error: any) {
    addCheck('Swap Quote', false, `Error: ${error.message}`);
  }

  // Print checklist
  console.log('\n' + '='.repeat(60));
  console.log('NEW USER WOW PATH CHECKLIST');
  console.log('='.repeat(60));
  console.log('');

  checklist.forEach((item, index) => {
    const icon = item.passed ? '✅' : '❌';
    const status = item.passed ? 'PASS' : 'FAIL';
    console.log(`${icon} [${index + 1}] ${item.name}: ${status}`);
    console.log(`   ${item.message}`);
    if (item.details && !item.passed) {
      console.log(`   Details: ${JSON.stringify(item.details, null, 2)}`);
    }
    console.log('');
  });

  // Print routing summary
  const eventMarketsCheck = checklist.find(c => c.name === 'Event Markets');
  const swapQuoteCheck = checklist.find(c => c.name === 'Swap Quote');

  if (eventMarketsCheck && eventMarketsCheck.details) {
    const { source, mode, correlationId } = eventMarketsCheck.details;
    console.log('📊 Routing Summary:');
    console.log(`   EVENT_MARKETS: source=${source.padEnd(8)} mode=${mode.padEnd(12)} corr=${correlationId.substring(0, 30)}...`);
  }

  if (swapQuoteCheck && swapQuoteCheck.details) {
    const { source, mode, correlationId } = swapQuoteCheck.details;
    console.log(`   SWAP_QUOTE:    source=${source.padEnd(8)} mode=${mode.padEnd(12)} corr=${correlationId.substring(0, 30)}...`);
  }

  console.log('');

  // Final verdict
  const allPassed = checklist.every(c => c.passed);
  const passedCount = checklist.filter(c => c.passed).length;
  const totalCount = checklist.length;

  console.log('='.repeat(60));
  if (allPassed) {
    console.log(`🎉 ALL CHECKS PASSED (${passedCount}/${totalCount})`);
    console.log('   Ready for demo! ✨');
    process.exit(0);
  } else {
    console.log(`⚠️  SOME CHECKS FAILED (${passedCount}/${totalCount} passed)`);
    console.log('   Review failures above before demo');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
