#!/usr/bin/env tsx
/**
 * Proof: Telemetry DB
 * Verifies that the SQLite telemetry database works correctly.
 *
 * Invariants:
 * 1. Database initializes successfully
 * 2. User upsert creates/updates users
 * 3. Session tracking works
 * 4. Execution logging works
 * 5. Summary aggregation works
 */

import { randomBytes } from 'crypto';

interface ProofResult {
  name: string;
  pass: boolean;
  detail: string;
}

const results: ProofResult[] = [];

function assert(name: string, condition: boolean, detail: string): void {
  results.push({ name, pass: condition, detail });
  if (!condition) {
    console.log(`  ❌ ${name}: ${detail}`);
  } else {
    console.log(`  ✅ ${name}: ${detail}`);
  }
}

async function main(): Promise<void> {
  console.log('============================================================');
  console.log('PROOF: Telemetry Database');
  console.log('============================================================\n');

  try {
    // Import telemetry module
    const {
      initDatabase,
      closeDatabase,
      upsertUser,
      getUser,
      listUsers,
      upsertSession,
      getLatestSession,
      createExecution,
      updateExecution,
      getExecution,
      listExecutions,
      logRequest,
      getTelemetrySummary,
    } = await import('../telemetry/db');

    // P1: Database initializes
    console.log('P1: Database initialization');
    let db;
    try {
      db = initDatabase();
      assert('P1-a', !!db, 'Database instance created');
    } catch (e) {
      assert('P1-a', false, `Failed to initialize: ${(e as Error).message}`);
      throw e;
    }

    // P2: User operations
    console.log('\nP2: User operations');
    const testAddress = `0x${randomBytes(20).toString('hex')}`;

    const user1 = upsertUser(testAddress, { source: 'test', timestamp: Date.now() });
    assert('P2-a', !!user1, `User created with ID: ${user1.id}`);
    assert('P2-b', user1.address === testAddress.toLowerCase(), 'Address normalized to lowercase');

    // Upsert same user again
    const user2 = upsertUser(testAddress, { updated: true });
    assert('P2-c', user2.address === user1.address, 'Upsert returns same user');

    // Get user
    const fetchedUser = getUser(testAddress);
    assert('P2-d', !!fetchedUser, 'User can be fetched by address');
    assert('P2-e', fetchedUser!.address === testAddress.toLowerCase(), 'Fetched address matches');

    // List users
    const users = listUsers(10);
    assert('P2-f', users.length > 0, `Listed ${users.length} users`);

    // P3: Session operations
    console.log('\nP3: Session operations');
    const sessionId = `0x${randomBytes(32).toString('hex')}`;
    const expiresAt = Math.floor(Date.now() / 1000) + 86400; // 24h from now

    const session = upsertSession(testAddress, sessionId, 'active', expiresAt);
    assert('P3-a', !!session, `Session created with ID: ${session.id}`);
    assert('P3-b', session.status === 'active', 'Session status is active');
    assert('P3-c', session.expires_at === expiresAt, 'Session expiry set correctly');

    // Update session
    const updatedSession = upsertSession(testAddress, sessionId, 'revoked', expiresAt);
    assert('P3-d', updatedSession.status === 'revoked', 'Session status updated');

    // Get latest session
    const latestSession = getLatestSession(testAddress);
    assert('P3-e', !!latestSession, 'Latest session retrieved');
    assert('P3-f', latestSession!.session_id === sessionId, 'Latest session ID matches');

    // P4: Execution operations
    console.log('\nP4: Execution operations');
    const execution = createExecution({
      userAddress: testAddress,
      draftId: 'draft-123',
      correlationId: `corr-${Date.now()}`,
      action: 'LEND_SUPPLY',
      token: 'WETH',
      amountUnits: '1000000000000000',
      mode: 'eth_testnet',
    });
    assert('P4-a', !!execution, `Execution created with ID: ${execution.id}`);
    assert('P4-b', execution.status === 'prepared', 'Initial status is prepared');

    // Update execution
    updateExecution(execution.id, {
      status: 'confirmed',
      txHash: '0x1234567890abcdef',
      latencyMs: 1500,
    });

    const updatedExec = getExecution(execution.id);
    assert('P4-c', updatedExec?.status === 'confirmed', 'Execution status updated');
    assert('P4-d', updatedExec?.tx_hash === '0x1234567890abcdef', 'TX hash saved');
    assert('P4-e', updatedExec?.latency_ms === 1500, 'Latency saved');

    // List executions
    const executions = listExecutions(10);
    assert('P4-f', executions.length > 0, `Listed ${executions.length} executions`);

    // P5: Request logging
    console.log('\nP5: Request logging');
    logRequest({
      endpoint: '/api/test',
      method: 'GET',
      userAddress: testAddress,
      correlationId: 'test-corr',
      statusCode: 200,
      latencyMs: 50,
    });
    assert('P5-a', true, 'Request logged without error');

    // P6: Summary aggregation
    console.log('\nP6: Summary aggregation');
    const summary = getTelemetrySummary();
    assert('P6-a', typeof summary.totalUsers === 'number', `Total users: ${summary.totalUsers}`);
    assert('P6-b', typeof summary.totalExecutions === 'number', `Total executions: ${summary.totalExecutions}`);
    assert('P6-c', typeof summary.successRate === 'number', `Success rate: ${summary.successRate.toFixed(1)}%`);
    assert('P6-d', Array.isArray(summary.recentExecutions), `Recent executions: ${summary.recentExecutions.length}`);

    // Cleanup
    closeDatabase();

  } catch (e) {
    console.error('Fatal error:', e);
    results.push({ name: 'FATAL', pass: false, detail: (e as Error).message });
  }

  // Summary
  console.log('\n============================================================');
  console.log('SUMMARY');
  console.log('============================================================');

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;

  console.log(`\nPassed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);

  if (failed > 0) {
    console.log('\nFailed proofs:');
    for (const r of results.filter(r => !r.pass)) {
      console.log(`  - ${r.name}: ${r.detail}`);
    }
    process.exit(1);
  }

  console.log('\n✅ All telemetry DB proofs passed');
  process.exit(0);
}

main().catch(e => {
  console.error('Proof execution failed:', e);
  process.exit(1);
});
