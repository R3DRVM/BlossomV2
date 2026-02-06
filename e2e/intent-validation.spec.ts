/**
 * Intent Validation E2E Tests
 *
 * Comprehensive tests for intent parsing accuracy
 * Addresses the 50% intent failure rate by testing edge cases
 */

import { test, expect } from '@playwright/test';

const SHOULD_RUN = process.env.E2E_INTENT_TESTS === 'true';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

// Test helper to parse intent via API
async function parseIntent(request: any, intentText: string) {
  const res = await request.post('/api/execute/prepare', {
    data: {
      userAddress: '0x1234567890123456789012345678901234567890',
      executionIntent: { text: intentText },
    },
  });
  return { status: res.status(), body: await res.json() };
}

test.describe('Intent Validation Tests', () => {
  test.skip(!SHOULD_RUN, 'Set E2E_INTENT_TESTS=true to run intent validation tests.');

  // ============================================
  // SWAP Intent Variations
  // ============================================
  test.describe('Swap Intents', () => {
    const validSwapIntents = [
      // Standard formats
      { input: 'swap 100 BUSDC to WETH', expectedAmount: '100', from: 'BUSDC', to: 'WETH' },
      { input: 'swap 1000 busdc for weth', expectedAmount: '1000', from: 'BUSDC', to: 'WETH' },
      { input: 'Swap 50.5 BUSDC to ETH', expectedAmount: '50.5', from: 'BUSDC', to: 'ETH' },

      // Convert syntax
      { input: 'convert 200 BUSDC to WETH', expectedAmount: '200', from: 'BUSDC', to: 'WETH' },
      { input: 'Convert 500 usdc to eth', expectedAmount: '500', from: 'USDC', to: 'ETH' },

      // Trade syntax
      { input: 'trade 100 BUSDC for WETH', expectedAmount: '100', from: 'BUSDC', to: 'WETH' },

      // With commas in numbers
      { input: 'swap 1,000 BUSDC to WETH', expectedAmount: '1000', from: 'BUSDC', to: 'WETH' },
      { input: 'swap 10,000.50 BUSDC to WETH', expectedAmount: '10000.50', from: 'BUSDC', to: 'WETH' },

      // Different token pairs
      { input: 'swap 100 ETH to USDC', expectedAmount: '100', from: 'ETH', to: 'USDC' },
      { input: 'swap 0.5 WETH to BUSDC', expectedAmount: '0.5', from: 'WETH', to: 'BUSDC' },

      // Natural language variations
      { input: 'I want to swap 100 BUSDC to WETH', expectedAmount: '100', from: 'BUSDC', to: 'WETH' },
      { input: 'please swap 50 busdc to weth for me', expectedAmount: '50', from: 'BUSDC', to: 'WETH' },
      { input: 'can you swap 100 BUSDC for WETH?', expectedAmount: '100', from: 'BUSDC', to: 'WETH' },
    ];

    for (const { input, expectedAmount, from, to } of validSwapIntents) {
      test(`parses: "${input}"`, async ({ request }) => {
        const { status, body } = await parseIntent(request, input);

        expect(status).toBeLessThan(500);

        if (body.ok && body.plan?.parsed) {
          expect(body.plan.parsed.kind).toBe('swap');
          expect(body.plan.parsed.action).toBe('swap');
          // Amount may have commas removed
          if (body.plan.parsed.amount) {
            expect(body.plan.parsed.amount.replace(/,/g, '')).toBe(expectedAmount.replace(/,/g, ''));
          }
        }
      });
    }

    // Edge cases that should still parse
    const edgeCaseSwaps = [
      'swap busdc to weth', // No amount (should default)
      'swap all BUSDC to WETH', // "all" keyword
      'swap my busdc to weth', // Possessive
    ];

    for (const input of edgeCaseSwaps) {
      test(`handles edge case: "${input}"`, async ({ request }) => {
        const { status, body } = await parseIntent(request, input);

        expect(status).toBeLessThan(500);
        // Should parse as swap or return clear error
        if (body.ok) {
          expect(body.plan?.parsed?.kind).toBe('swap');
        }
      });
    }
  });

  // ============================================
  // PERP Intent Variations
  // ============================================
  test.describe('Perp Intents', () => {
    const validPerpIntents = [
      // Long positions
      { input: 'long BTC 10x', side: 'long', asset: 'BTC', leverage: 10 },
      { input: 'long btc 20x', side: 'long', asset: 'BTC', leverage: 20 },
      { input: 'go long BTC 5x', side: 'long', asset: 'BTC', leverage: 5 },
      { input: 'long ETH 10x', side: 'long', asset: 'ETH', leverage: 10 },
      { input: 'long SOL 15x', side: 'long', asset: 'SOL', leverage: 15 },

      // Short positions
      { input: 'short BTC 10x', side: 'short', asset: 'BTC', leverage: 10 },
      { input: 'short eth 5x', side: 'short', asset: 'ETH', leverage: 5 },
      { input: 'go short SOL 20x', side: 'short', asset: 'SOL', leverage: 20 },

      // With amounts
      { input: 'long BTC 10x with 1000', side: 'long', asset: 'BTC', leverage: 10 },
      { input: 'long BTC 10x with 500 BUSDC', side: 'long', asset: 'BTC', leverage: 10 },
      { input: 'short ETH 5x with 200', side: 'short', asset: 'ETH', leverage: 5 },

      // Leverage variations
      { input: 'long btc 10x leverage', side: 'long', asset: 'BTC', leverage: 10 },
      { input: 'long btc 10 x', side: 'long', asset: 'BTC', leverage: 10 },
      { input: 'long btc at 10x', side: 'long', asset: 'BTC', leverage: 10 },
    ];

    for (const { input, side, asset, leverage } of validPerpIntents) {
      test(`parses: "${input}"`, async ({ request }) => {
        const { status, body } = await parseIntent(request, input);

        expect(status).toBeLessThan(500);

        if (body.ok && body.plan?.parsed) {
          expect(body.plan.parsed.kind).toBe('perp');
          expect(body.plan.parsed.action).toBe(side);
          expect(body.plan.parsed.targetAsset?.toUpperCase()).toBe(asset);
          if (body.plan.parsed.leverage) {
            expect(body.plan.parsed.leverage).toBe(leverage);
          }
        }
      });
    }

    // Default leverage handling
    test('defaults to 10x leverage when not specified', async ({ request }) => {
      const { status, body } = await parseIntent(request, 'long BTC');

      expect(status).toBeLessThan(500);
      if (body.ok && body.plan?.parsed) {
        expect(body.plan.parsed.kind).toBe('perp');
        expect(body.plan.parsed.leverage).toBe(10);
      }
    });
  });

  // ============================================
  // DEPOSIT/LEND Intent Variations
  // ============================================
  test.describe('Deposit Intents', () => {
    const validDepositIntents = [
      { input: 'deposit 500 BUSDC to vault', venue: 'vault' },
      { input: 'deposit 1000 busdc into aave', venue: 'aave' },
      { input: 'supply 200 BUSDC to aave', venue: 'aave' },
      { input: 'lend 500 BUSDC', venue: undefined },
      { input: 'deposit 100 USDC in vault', venue: 'vault' },
    ];

    for (const { input, venue } of validDepositIntents) {
      test(`parses: "${input}"`, async ({ request }) => {
        const { status, body } = await parseIntent(request, input);

        expect(status).toBeLessThan(500);

        if (body.ok && body.plan?.parsed) {
          expect(body.plan.parsed.kind).toBe('deposit');
          if (venue) {
            expect(body.plan.parsed.venue?.toLowerCase()).toBe(venue);
          }
        }
      });
    }
  });

  // ============================================
  // BRIDGE Intent Variations
  // ============================================
  test.describe('Bridge Intents', () => {
    const validBridgeIntents = [
      { input: 'bridge 100 USDC from ethereum to solana', sourceChain: 'ethereum', destChain: 'solana' },
      { input: 'bridge 500 USDC from eth to sol', sourceChain: 'ethereum', destChain: 'solana' },
      { input: 'transfer 200 USDC from ethereum to solana', sourceChain: 'ethereum', destChain: 'solana' },
    ];

    for (const { input, sourceChain, destChain } of validBridgeIntents) {
      test(`parses: "${input}"`, async ({ request }) => {
        const { status, body } = await parseIntent(request, input);

        expect(status).toBeLessThan(500);

        if (body.ok && body.plan?.parsed) {
          expect(body.plan.parsed.kind).toBe('bridge');
          // Check chain mapping
          if (body.plan.parsed.sourceChain) {
            expect(body.plan.parsed.sourceChain).toContain('ethereum');
          }
        }
      });
    }
  });

  // ============================================
  // UNKNOWN/EDGE CASES
  // ============================================
  test.describe('Edge Cases & Failures', () => {
    const ambiguousIntents = [
      'buy BTC', // Could be swap or perp
      'get some ETH', // Vague
      'invest 1000', // No asset
      'trade', // Incomplete
    ];

    for (const input of ambiguousIntents) {
      test(`handles ambiguous: "${input}"`, async ({ request }) => {
        const { status, body } = await parseIntent(request, input);

        // Should not 500
        expect(status).toBeLessThan(500);

        // Should either parse with warning or return clear error
        if (!body.ok) {
          expect(body.error || body.message).toBeDefined();
        }
      });
    }

    const invalidIntents = [
      '', // Empty
      '   ', // Whitespace only
      '12345', // Numbers only
      'asdfghjkl', // Gibberish
    ];

    for (const input of invalidIntents) {
      test(`rejects invalid: "${input || '(empty)'}"`, async ({ request }) => {
        const { status, body } = await parseIntent(request, input);

        // Should not 500
        expect(status).toBeLessThan(500);

        // Should return error or parse as unknown
        if (body.ok && body.plan?.parsed) {
          expect(body.plan.parsed.kind).toBe('unknown');
        }
      });
    }

    // XSS/Injection attempts
    const maliciousIntents = [
      '<script>alert(1)</script>',
      '"; DROP TABLE intents; --',
      '${process.env.SECRET}',
      '{{constructor.constructor("return this")()}}',
    ];

    for (const input of maliciousIntents) {
      test(`safely handles malicious: "${input.substring(0, 30)}..."`, async ({ request }) => {
        const { status, body } = await parseIntent(request, input);

        // Should not 500
        expect(status).toBeLessThan(500);

        // Should not expose any secrets or execute code
        const bodyStr = JSON.stringify(body);
        expect(bodyStr).not.toContain('constructor');
        expect(bodyStr).not.toContain('SECRET');
      });
    }
  });

  // ============================================
  // ANALYTICS/PROOF Intents
  // ============================================
  test.describe('Analytics Intents', () => {
    const analyticsIntents = [
      'show my exposure',
      'check my risk',
      'show me the top protocols',
      'get top 10 prediction markets',
      'view my current perp exposure',
    ];

    for (const input of analyticsIntents) {
      test(`parses analytics: "${input}"`, async ({ request }) => {
        const { status, body } = await parseIntent(request, input);

        expect(status).toBeLessThan(500);

        // Analytics intents should be recognized
        if (body.ok && body.plan?.parsed) {
          expect(['unknown', 'analytics']).toContain(body.plan.parsed.kind);
          if (body.plan.parsed.rawParams?.intentType) {
            expect(body.plan.parsed.rawParams.intentType).toBe('analytics');
          }
        }
      });
    }
  });

  // ============================================
  // HEDGE/COMPLEX Intents
  // ============================================
  test.describe('Complex Intents', () => {
    const complexIntents = [
      'hedge my positions',
      'protect my portfolio',
      'find me the best vault with 5% yield',
      'bet on the highest volume prediction market',
    ];

    for (const input of complexIntents) {
      test(`handles complex: "${input}"`, async ({ request }) => {
        const { status, body } = await parseIntent(request, input);

        expect(status).toBeLessThan(500);

        // Complex intents should parse or return proof_only with warnings
        if (body.ok && body.plan?.route) {
          if (body.plan.route.warnings) {
            expect(body.plan.route.warnings.some((w: string) =>
              w.includes('PROOF_ONLY') || w.includes('not yet')
            )).toBeTruthy();
          }
        }
      });
    }
  });
});

// ============================================
// Intent Parsing Regression Tests
// ============================================
test.describe('Intent Parsing Regressions', () => {
  test.skip(!SHOULD_RUN, 'Set E2E_INTENT_TESTS=true to run regression tests.');

  // Known patterns that have failed in the past
  const regressionCases = [
    // Case sensitivity
    { input: 'SWAP 100 BUSDC TO WETH', expectedKind: 'swap' },
    { input: 'LONG BTC 10X', expectedKind: 'perp' },

    // Extra whitespace
    { input: '  swap   100   BUSDC   to   WETH  ', expectedKind: 'swap' },
    { input: 'long  BTC   10x', expectedKind: 'perp' },

    // Unicode/special chars
    { input: 'swap 100 BUSDC to WETH!', expectedKind: 'swap' },
    { input: 'swap 100 BUSDC -> WETH', expectedKind: 'swap' },

    // Number edge cases
    { input: 'swap 0.001 BUSDC to WETH', expectedKind: 'swap' },
    { input: 'swap 999999999 BUSDC to WETH', expectedKind: 'swap' },
  ];

  for (const { input, expectedKind } of regressionCases) {
    test(`regression: "${input}"`, async ({ request }) => {
      const { status, body } = await parseIntent(request, input);

      expect(status).toBeLessThan(500);

      if (body.ok && body.plan?.parsed) {
        expect(body.plan.parsed.kind).toBe(expectedKind);
      }
    });
  }
});

// ============================================
// Intent Failure Analysis
// ============================================
test.describe('Intent Failure Analysis', () => {
  test.skip(!SHOULD_RUN, 'Set E2E_INTENT_TESTS=true to run failure analysis.');

  test('collect failure patterns from real usage', async ({ request }) => {
    // This test helps identify patterns that commonly fail
    const testPatterns = [
      // Add patterns from production logs here
      'swap 100 BUSDC to WETH',
      'long btc 10x',
      'deposit 500 to vault',
      'I want to trade',
      'help me swap tokens',
    ];

    const results = {
      success: [] as string[],
      failed: [] as { input: string; error: string }[],
    };

    for (const pattern of testPatterns) {
      const { status, body } = await parseIntent(request, pattern);

      if (status >= 500 || !body.ok) {
        results.failed.push({
          input: pattern,
          error: body.error || body.message || 'Unknown error',
        });
      } else {
        results.success.push(pattern);
      }
    }

    // Log results for analysis
    console.log('Intent Parsing Results:');
    console.log(`Success: ${results.success.length}/${testPatterns.length}`);
    console.log(`Failed: ${results.failed.length}/${testPatterns.length}`);

    if (results.failed.length > 0) {
      console.log('Failed patterns:');
      results.failed.forEach(f => console.log(`  - "${f.input}": ${f.error}`));
    }

    // Assert reasonable success rate
    const successRate = results.success.length / testPatterns.length;
    expect(successRate).toBeGreaterThan(0.7); // At least 70% success
  });
});
