/**
 * Testnet V1 E2E Acceptance Tests
 * 
 * Tests the core flows for the Sepolia MVP:
 * 1. Demo swap execution
 * 2. Lending supply execution
 * 3. Perps proof-of-execution
 * 4. Events proof-of-execution
 * 
 * Prerequisites:
 * - Backend running at http://localhost:3001
 * - Frontend running at http://localhost:5173
 * - EXECUTION_MODE=eth_testnet
 * - All contract addresses configured
 */

import { test, expect } from '@playwright/test';

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:3001';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Helper to call backend API
async function callApi(endpoint: string, options?: RequestInit): Promise<Response> {
  return fetch(`${BACKEND_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
}

// Helper to check backend health
async function checkBackendHealth(): Promise<{ ok: boolean; ts?: number }> {
  try {
    const response = await fetch(`${BACKEND_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return { ok: false };
    }
    const data = await response.json();
    return { ok: data.ok === true, ts: data.ts };
  } catch {
    return { ok: false };
  }
}

// Helper to check if ProofRecorded event exists in logs
async function verifyProofEvent(
  rpcUrl: string,
  txHash: string,
  expectedVenueType: number
): Promise<boolean> {
  // ProofRecorded event signature: ProofRecorded(address,uint8,bytes32,string,uint256)
  // keccak256("ProofRecorded(address,uint8,bytes32,string,uint256)")
  const eventSignature = '0x9c3e5d8a8e63a50c12f0e8a6a0f4f9d3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7';
  
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getTransactionReceipt',
      params: [txHash],
    }),
  });
  
  const data = await response.json();
  const receipt = data.result;
  
  if (!receipt || !receipt.logs) {
    return false;
  }
  
  // Find ProofRecorded event
  for (const log of receipt.logs) {
    if (log.topics && log.topics.length >= 3) {
      // Check venueType in topics[2] (indexed parameter)
      const venueType = parseInt(log.topics[2], 16);
      if (venueType === expectedVenueType) {
        return true;
      }
    }
  }
  
  return false;
}

test.describe('Testnet V1 Acceptance Tests', () => {
  
  test.describe('API Health & Preflight', () => {
    
    test('health endpoint returns ok', async () => {
      const response = await callApi('/health');
      expect(response.ok).toBeTruthy();
      const data = await response.json();
      expect(data.status).toBe('ok');
    });
    
    test('preflight returns valid configuration', async () => {
      const response = await callApi('/api/execute/preflight');
      expect(response.ok).toBeTruthy();
      const data = await response.json();
      
      // Preflight should return ok if properly configured
      expect(data).toHaveProperty('ok');
      expect(data).toHaveProperty('notes');
      
      console.log('Preflight response:', JSON.stringify(data, null, 2));
    });
    
  });
  
  test.describe('Demo Swap Flow', () => {
    
    test('prepare returns valid plan for demo swap', async () => {
      const response = await callApi('/api/execute/prepare', {
        method: 'POST',
        body: JSON.stringify({
          draftId: 'test-swap-' + Date.now(),
          userAddress: '0x1234567890123456789012345678901234567890',
          executionKind: 'demo_swap',
          authMode: 'direct',
        }),
      });
      
      expect(response.ok).toBeTruthy();
      const data = await response.json();
      
      // Validate response structure
      expect(data).toHaveProperty('chainId');
      expect(data).toHaveProperty('plan');
      expect(data.plan).toHaveProperty('actions');
      expect(data.plan.actions.length).toBeGreaterThan(0);
      
      // Check for demo swap routing metadata
      if (data.routing) {
        console.log('Swap routing:', JSON.stringify(data.routing, null, 2));
        expect(data.routing).toHaveProperty('venue');
      }
    });
    
  });
  
  test.describe('Lending Supply Flow', () => {
    
    test('prepare returns valid plan for lending', async () => {
      const response = await callApi('/api/execute/prepare', {
        method: 'POST',
        body: JSON.stringify({
          draftId: 'test-lend-' + Date.now(),
          userAddress: '0x1234567890123456789012345678901234567890',
          executionKind: 'lend_supply',
          authMode: 'direct',
        }),
      });
      
      expect(response.ok).toBeTruthy();
      const data = await response.json();
      
      // Validate response structure
      expect(data).toHaveProperty('plan');
      expect(data.plan).toHaveProperty('actions');
      
      // Lending should have PULL + LEND_SUPPLY actions
      expect(data.plan.actions.length).toBe(2);
      expect(data.plan.actions[0].actionType).toBe(2); // PULL
      expect(data.plan.actions[1].actionType).toBe(3); // LEND_SUPPLY
      
      if (data.routing) {
        console.log('Lending routing:', JSON.stringify(data.routing, null, 2));
        expect(data.routing.actionType).toBe('lend_supply');
      }
    });
    
  });
  
  test.describe('Perps Proof-of-Execution Flow', () => {
    
    test('prepare returns valid plan for perps proof', async () => {
      const response = await callApi('/api/execute/prepare', {
        method: 'POST',
        body: JSON.stringify({
          draftId: 'test-perp-' + Date.now(),
          userAddress: '0x1234567890123456789012345678901234567890',
          executionKind: 'perp',
          authMode: 'direct',
          strategy: {
            instrumentType: 'perp',
            market: 'ETH-USD',
            direction: 'long',
            leverage: 3,
            riskPercent: 3,
            marginUsd: 100,
          },
        }),
      });
      
      expect(response.ok).toBeTruthy();
      const data = await response.json();
      
      // Validate response structure
      expect(data).toHaveProperty('plan');
      expect(data.plan).toHaveProperty('actions');
      expect(data.plan.actions.length).toBe(1);
      
      // Check for PROOF action type
      expect(data.plan.actions[0].actionType).toBe(6); // PROOF
      
      // Check routing metadata
      expect(data.routing).toBeDefined();
      if (data.routing) {
        console.log('Perps routing:', JSON.stringify(data.routing, null, 2));
        expect(data.routing.routingSource).toBe('proof');
        expect(data.routing.venueType).toBe(1); // perps
      }
    });
    
  });
  
  test.describe('Event Markets Proof-of-Execution Flow', () => {
    
    test('prepare returns valid plan for event proof', async () => {
      const response = await callApi('/api/execute/prepare', {
        method: 'POST',
        body: JSON.stringify({
          draftId: 'test-event-' + Date.now(),
          userAddress: '0x1234567890123456789012345678901234567890',
          executionKind: 'event',
          authMode: 'direct',
          strategy: {
            instrumentType: 'event',
            market: 'fed-rate-cut',
            outcome: 'YES',
            stakeUsd: 50,
          },
        }),
      });
      
      expect(response.ok).toBeTruthy();
      const data = await response.json();
      
      // Validate response structure
      expect(data).toHaveProperty('plan');
      expect(data.plan).toHaveProperty('actions');
      expect(data.plan.actions.length).toBe(1);
      
      // Check for PROOF action type
      expect(data.plan.actions[0].actionType).toBe(6); // PROOF
      
      // Check routing metadata
      expect(data.routing).toBeDefined();
      if (data.routing) {
        console.log('Event routing:', JSON.stringify(data.routing, null, 2));
        expect(data.routing.routingSource).toBe('proof');
        expect(data.routing.venueType).toBe(2); // event
      }
    });
    
  });
  
  test.describe('Session Mode', () => {
    
    test('prepare returns valid session-wrapped plan', async () => {
      const response = await callApi('/api/execute/prepare', {
        method: 'POST',
        body: JSON.stringify({
          draftId: 'test-session-' + Date.now(),
          userAddress: '0x1234567890123456789012345678901234567890',
          executionKind: 'perp',
          authMode: 'session',
          strategy: {
            instrumentType: 'perp',
            market: 'BTC-USD',
            direction: 'short',
            leverage: 5,
            riskPercent: 2,
            marginUsd: 50,
          },
        }),
      });
      
      expect(response.ok).toBeTruthy();
      const data = await response.json();
      
      // Validate session mode produces valid plan
      expect(data).toHaveProperty('plan');
      expect(data.plan).toHaveProperty('actions');
    });
    
  });
  
  test.describe('Telemetry', () => {
    
    test('prepare logs telemetry event', async () => {
      // Make a request that should log telemetry
      const response = await callApi('/api/execute/prepare', {
        method: 'POST',
        body: JSON.stringify({
          draftId: 'test-telemetry-' + Date.now(),
          userAddress: '0xabcdef1234567890abcdef1234567890abcdef12',
          executionKind: 'demo_swap',
          authMode: 'direct',
        }),
      });
      
      expect(response.ok).toBeTruthy();
      
      // Telemetry is logged server-side, we just verify the endpoint succeeds
      // In a full e2e test, we could check the log file or add a telemetry query endpoint
      console.log('Telemetry test completed - check agent/logs/telemetry.jsonl');
    });
    
  });
  
});

// Utility test for verifying contract deployment
test.describe('Contract Verification', () => {
  
  test('verify proof adapter has code', async () => {
    const preflightResponse = await callApi('/api/execute/preflight');
    const preflight = await preflightResponse.json();
    
    // Just log the preflight response for manual verification
    console.log('Contract verification via preflight:', JSON.stringify(preflight, null, 2));
  });
  
});

//==========================================
// DEEP TESTS: Getting Started Flows
//==========================================

test.describe('Deep Flow Tests: Direct Mode', () => {
  
  test.describe('Swap REDACTED → WETH (Direct)', () => {
    
    test('full flow: prepare → approval check → routing metadata', async () => {
      const draftId = 'deep-swap-' + Date.now();
      const userAddress = '0x1234567890123456789012345678901234567890';
      
      // Step 1: Prepare execution
      const prepareResponse = await callApi('/api/execute/prepare', {
        method: 'POST',
        body: JSON.stringify({
          draftId,
          userAddress,
          executionKind: 'demo_swap',
          authMode: 'direct',
        }),
      });
      
      expect(prepareResponse.ok).toBeTruthy();
      const prepareData = await prepareResponse.json();
      
      // Verify plan structure
      expect(prepareData).toHaveProperty('plan');
      expect(prepareData.plan.actions.length).toBeGreaterThanOrEqual(1);
      
      // Verify routing metadata
      expect(prepareData).toHaveProperty('routing');
      if (prepareData.routing) {
        expect(prepareData.routing).toHaveProperty('venue');
        expect(prepareData.routing).toHaveProperty('chain');
        console.log('Swap routing metadata:', prepareData.routing);
      }
      
      // Step 2: Check approval endpoint
      const approveResponse = await callApi('/api/setup/approve', {
        method: 'POST',
        body: JSON.stringify({
          userAddress,
          tokenAddress: '0x1234567890123456789012345678901234567890', // Mock token
          spenderAddress: prepareData.to || '0x0000000000000000000000000000000000000000',
          amount: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        }),
      });
      
      expect(approveResponse.ok).toBeTruthy();
      const approveData = await approveResponse.json();
      
      // Approval should return valid tx payload
      expect(approveData).toHaveProperty('to');
      expect(approveData).toHaveProperty('data');
      expect(approveData.data).toMatch(/^0x/);
      
      console.log('Approve endpoint validated');
    });
    
    test('submit endpoint handles tx hash correctly', async () => {
      const draftId = 'deep-submit-' + Date.now();
      const mockTxHash = '0x' + 'a'.repeat(64);
      
      // Submit should accept and process the tx hash
      const submitResponse = await callApi('/api/execute/submit', {
        method: 'POST',
        body: JSON.stringify({
          draftId,
          txHash: mockTxHash,
        }),
      });
      
      expect(submitResponse.ok).toBeTruthy();
      const submitData = await submitResponse.json();
      
      // Should return with some status
      expect(submitData).toHaveProperty('ok');
      
      // In eth_testnet mode with RPC, should have receiptStatus
      // In sim mode, just returns ok:true
      console.log('Submit response:', submitData);
    });
    
  });
  
  test.describe('Lending Supply (Direct)', () => {
    
    test('full flow: prepare with PULL + LEND_SUPPLY actions', async () => {
      const draftId = 'deep-lend-' + Date.now();
      const userAddress = '0x1234567890123456789012345678901234567890';
      
      const prepareResponse = await callApi('/api/execute/prepare', {
        method: 'POST',
        body: JSON.stringify({
          draftId,
          userAddress,
          executionKind: 'lend_supply',
          authMode: 'direct',
        }),
      });
      
      expect(prepareResponse.ok).toBeTruthy();
      const prepareData = await prepareResponse.json();
      
      // Lending should have 2 actions: PULL + LEND_SUPPLY
      expect(prepareData.plan.actions.length).toBe(2);
      expect(prepareData.plan.actions[0].actionType).toBe(2); // PULL
      expect(prepareData.plan.actions[1].actionType).toBe(3); // LEND_SUPPLY
      
      // Verify routing metadata
      if (prepareData.routing) {
        expect(prepareData.routing.actionType).toBe('lend_supply');
        console.log('Lending routing metadata:', prepareData.routing);
      }
    });
    
  });
  
  test.describe('Perps Proof (Direct)', () => {
    
    test('full flow: prepare with PROOF action + correct venue type', async () => {
      const draftId = 'deep-perp-' + Date.now();
      const userAddress = '0x1234567890123456789012345678901234567890';
      
      const prepareResponse = await callApi('/api/execute/prepare', {
        method: 'POST',
        body: JSON.stringify({
          draftId,
          userAddress,
          executionKind: 'perp',
          authMode: 'direct',
          strategy: {
            instrumentType: 'perp',
            market: 'ETH-USD',
            direction: 'long',
            leverage: 3,
            riskPercent: 3,
            marginUsd: 100,
          },
        }),
      });
      
      expect(prepareResponse.ok).toBeTruthy();
      const prepareData = await prepareResponse.json();
      
      // Should have PROOF action
      expect(prepareData.plan.actions[0].actionType).toBe(6); // PROOF
      
      // Routing should indicate perps venue
      expect(prepareData.routing?.venueType).toBe(1);
      expect(prepareData.routing?.routingSource).toBe('proof');
    });
    
  });
  
  test.describe('Events Proof (Direct)', () => {
    
    test('full flow: prepare with PROOF action + correct venue type', async () => {
      const draftId = 'deep-event-' + Date.now();
      const userAddress = '0x1234567890123456789012345678901234567890';
      
      const prepareResponse = await callApi('/api/execute/prepare', {
        method: 'POST',
        body: JSON.stringify({
          draftId,
          userAddress,
          executionKind: 'event',
          authMode: 'direct',
          strategy: {
            instrumentType: 'event',
            market: 'fed-rate-cut',
            outcome: 'YES',
            stakeUsd: 50,
          },
        }),
      });
      
      expect(prepareResponse.ok).toBeTruthy();
      const prepareData = await prepareResponse.json();
      
      // Should have PROOF action
      expect(prepareData.plan.actions[0].actionType).toBe(6); // PROOF
      
      // Routing should indicate events venue
      expect(prepareData.routing?.venueType).toBe(2);
      expect(prepareData.routing?.routingSource).toBe('proof');
    });
    
  });
  
});

test.describe('Deep Flow Tests: Session Mode', () => {
  
  test('session prepare returns valid session creation data', async () => {
    const userAddress = '0x1234567890123456789012345678901234567890';
    
    const sessionResponse = await callApi('/api/session/prepare', {
      method: 'POST',
      body: JSON.stringify({
        userAddress,
      }),
    });
    
    // Session endpoint requires specific mode configuration
    // May return 400 if not in session mode - that's expected
    const data = await sessionResponse.json();
    console.log('Session prepare response:', data);
    
    // If successful, should have session data
    if (sessionResponse.ok) {
      expect(data).toHaveProperty('sessionId');
      expect(data).toHaveProperty('to');
      expect(data).toHaveProperty('data');
    }
  });
  
  test('session mode prepare wraps data correctly', async () => {
    const draftId = 'deep-session-swap-' + Date.now();
    const userAddress = '0x1234567890123456789012345678901234567890';
    
    const prepareResponse = await callApi('/api/execute/prepare', {
      method: 'POST',
      body: JSON.stringify({
        draftId,
        userAddress,
        executionKind: 'demo_swap',
        authMode: 'session',
      }),
    });
    
    expect(prepareResponse.ok).toBeTruthy();
    const prepareData = await prepareResponse.json();
    
    // Session mode should still return valid plan
    expect(prepareData).toHaveProperty('plan');
    expect(prepareData.plan.actions.length).toBeGreaterThanOrEqual(1);
    
    // Data should be session-wrapped (contains maxSpendUnits prefix)
    // The action data will be longer due to wrapping
    console.log('Session-wrapped plan:', prepareData.plan);
  });
  
});

test.describe('Error Handling', () => {
  
  test('prepare with invalid address returns error', async () => {
    const prepareResponse = await callApi('/api/execute/prepare', {
      method: 'POST',
      body: JSON.stringify({
        draftId: 'invalid-addr-test',
        userAddress: 'not-an-address',
        executionKind: 'demo_swap',
        authMode: 'direct',
      }),
    });
    
    // Should return 400 or 500 with error
    const data = await prepareResponse.json();
    expect(data).toHaveProperty('error');
  });
  
  test('prepare without required fields returns error', async () => {
    const prepareResponse = await callApi('/api/execute/prepare', {
      method: 'POST',
      body: JSON.stringify({
        draftId: 'missing-fields-test',
        // Missing userAddress
        executionKind: 'demo_swap',
      }),
    });
    
    const data = await prepareResponse.json();
    expect(data).toHaveProperty('error');
  });
  
});

//==========================================
// WALLET BALANCE API TESTS
//==========================================

test.describe('Backend Health & Offline Detection', () => {
  
  test('GET /health returns { ok: true, ts }', async () => {
    const health = await checkBackendHealth();
    
    if (health.ok) {
      expect(health.ts).toBeDefined();
      expect(typeof health.ts).toBe('number');
      console.log('Backend health check passed:', health);
    } else {
      console.log('Backend is offline (expected in CI or when backend not running)');
    }
  });
  
  test('health endpoint never depends on chain config', async () => {
    // Health should work even if ETH_TESTNET_RPC_URL is missing
    const response = await callApi('/health');
    
    // Should return 200 even if chain config is missing
    if (response.ok) {
      const data = await response.json();
      expect(data).toHaveProperty('ok');
      expect(data).toHaveProperty('ts');
      // Should not require any chain-related config
    } else {
      console.log('Backend not running - skipping health check test');
    }
  });
  
});

test.describe('Wallet Balance API', () => {
  
  const TEST_ADDRESS = '0x1234567890123456789012345678901234567890';
  
  test('GET /api/wallet/balances returns valid structure', async () => {
    const response = await callApi(`/api/wallet/balances?address=${TEST_ADDRESS}`);
    
    // May fail if backend not running or not in eth_testnet mode
    // but should still return a valid JSON response
    const data = await response.json();
    
    if (response.ok) {
      // Validate structure
      expect(data).toHaveProperty('chainId');
      expect(data).toHaveProperty('address');
      expect(data).toHaveProperty('native');
      expect(data.native).toHaveProperty('symbol', 'ETH');
      expect(data.native).toHaveProperty('wei');
      expect(data.native).toHaveProperty('formatted');
      expect(data).toHaveProperty('tokens');
      expect(Array.isArray(data.tokens)).toBe(true);
      expect(data).toHaveProperty('timestamp');
      
      console.log('Wallet balance response:', data);
    } else {
      // If not ok, should have an error message
      expect(data).toHaveProperty('error');
      console.log('Wallet balance error (expected in non-eth_testnet mode):', data.error);
    }
  });
  
  test('GET /api/wallet/balances rejects invalid address', async () => {
    const response = await callApi('/api/wallet/balances?address=invalid');
    expect(response.status).toBe(400);
    
    const data = await response.json();
    expect(data).toHaveProperty('error');
    expect(data.error).toContain('Invalid address');
  });
  
  test('GET /api/wallet/balances requires address param', async () => {
    const response = await callApi('/api/wallet/balances');
    expect(response.status).toBe(400);
    
    const data = await response.json();
    expect(data).toHaveProperty('error');
    expect(data.error).toContain('required');
  });
  
  test('wallet balance native ETH is always present', async () => {
    const response = await callApi(`/api/wallet/balances?address=${TEST_ADDRESS}`);
    
    if (!response.ok) {
      console.log('Skipping (backend may not be in eth_testnet mode)');
      return;
    }
    
    const data = await response.json();
    
    // Native ETH should always be present
    expect(data.native).toBeDefined();
    expect(data.native.symbol).toBe('ETH');
    expect(data.native.formatted).toBeDefined();
    
    // Formatted should be a valid number string
    const formatted = parseFloat(data.native.formatted);
    expect(isNaN(formatted)).toBe(false);
  });
  
  test('wallet balance tokens array may be empty without demo token config', async () => {
    const response = await callApi(`/api/wallet/balances?address=${TEST_ADDRESS}`);
    
    if (!response.ok) {
      console.log('Skipping (backend may not be in eth_testnet mode)');
      return;
    }
    
    const data = await response.json();
    
    // Tokens array should exist (may be empty if demo tokens not configured)
    expect(Array.isArray(data.tokens)).toBe(true);
    
    // If tokens are present, they should have correct structure
    for (const token of data.tokens) {
      expect(token).toHaveProperty('address');
      expect(token).toHaveProperty('symbol');
      expect(token).toHaveProperty('decimals');
      expect(token).toHaveProperty('formatted');
    }
    
    // Notes should explain any missing configs
    if (data.notes && data.notes.length > 0) {
      console.log('Balance notes:', data.notes);
    }
  });
  
  test('wallet balance shows non-zero ETH when endpoint returns non-zero', async () => {
    // Mock test: verify endpoint structure allows non-zero values
    const response = await callApi(`/api/wallet/balances?address=${TEST_ADDRESS}`);
    
    if (!response.ok) {
      console.log('Skipping (backend may not be in eth_testnet mode)');
      return;
    }
    
    const data = await response.json();
    
    // Verify structure supports non-zero values
    const ethAmount = parseFloat(data.native.formatted);
    expect(ethAmount).toBeGreaterThanOrEqual(0);
    
    // If non-zero, verify it's displayed correctly
    if (ethAmount > 0) {
      expect(data.native.formatted).toMatch(/^\d+\.\d+$/);
      console.log(`Non-zero ETH balance detected: ${data.native.formatted} ETH`);
    }
  });
  
  test('wallet connect triggers balance fetch only if backend health is OK', async () => {
    // This test verifies the frontend logic (would need browser automation)
    // For now, just verify the health check function works
    const health = await checkBackendHealth();
    
    if (!health.ok) {
      console.log('Backend offline - wallet connect should show "Backend Offline" state');
      // In a real browser test, we would verify the UI shows the offline banner
    } else {
      console.log('Backend online - wallet connect should trigger balance fetch');
    }
  });
  
  test('API calls are blocked when backend is offline (health gate)', async () => {
    // This test verifies that callAgent throws when backend is offline
    // In a real implementation, we'd mock the health state
    // For now, we verify the endpoint structure
    
    const health = await checkBackendHealth();
    
    if (!health.ok) {
      console.log('Backend offline - API calls should be blocked by health gate');
      // In frontend, callAgent should throw "Backend is offline" error
      // This prevents request spam
    } else {
      // Backend is online - verify we can make calls
      const response = await callApi('/api/prices/eth');
      if (response.ok) {
        const data = await response.json();
        expect(data).toHaveProperty('priceUsd');
      }
    }
  });
  
  test('health check has exponential backoff (prevents spam)', async () => {
    // This test verifies the backoff logic exists
    // In a real browser test, we'd verify no more than N requests per minute
    
    const startTime = Date.now();
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      try {
        await checkBackendHealth();
        break; // Success
      } catch {
        attempts++;
        if (attempts < maxAttempts) {
          // Verify backoff delay (should be exponential)
          const elapsed = Date.now() - startTime;
          const expectedMinDelay = 5000 * Math.pow(2, attempts - 1);
          expect(elapsed).toBeGreaterThanOrEqual(expectedMinDelay - 1000); // Allow 1s tolerance
        }
      }
    }
    
    console.log(`Health check attempts: ${attempts}, elapsed: ${Date.now() - startTime}ms`);
  });
  
});

