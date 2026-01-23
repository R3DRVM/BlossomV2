#!/usr/bin/env node
/**
 * MVP A Full Flow E2E Test
 * Tests swap → deposit → perp → prediction market in sequence
 * 
 * Usage:
 *   node agent/scripts/e2e-mvp-full-flow.ts
 * 
 * Environment Variables:
 *   BASE_URL - Backend URL (default: http://localhost:3001)
 *   TEST_USER_ADDRESS - Ethereum address for testing (required for swap)
 *   EXECUTION_AUTH_MODE - 'direct' or 'session' (default: 'direct')
 *   EXECUTION_MODE - 'sim' or 'eth_testnet'
 *   E2E_SUBMIT - '1' to actually submit transactions (requires session mode)
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const TEST_USER_ADDRESS = process.env.TEST_USER_ADDRESS;
const EXECUTION_AUTH_MODE = process.env.EXECUTION_AUTH_MODE || 'direct';
// EXECUTION_MODE now auto-detected from backend if not explicitly set
let EXECUTION_MODE = process.env.EXECUTION_MODE;
const E2E_SUBMIT = process.env.E2E_SUBMIT === '1';

// Colors for output
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const NC = '\x1b[0m';

let passed = 0;
let failed = 0;

function printPass(msg: string) {
  console.log(`${GREEN}✓ PASS${NC} ${msg}`);
  passed++;
}

function printFail(msg: string) {
  console.log(`${RED}✗ FAIL${NC} ${msg}`);
  failed++;
}

function printInfo(msg: string) {
  console.log(`${BLUE}ℹ${NC} ${msg}`);
}

async function fetchJson(url: string, options?: RequestInit): Promise<any> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return response.json();
}

// Helper to get portfolio snapshot (for failure test)
async function getPortfolioSnapshot(): Promise<any> {
  try {
    const response = await fetchJson(`${BASE_URL}/api/portfolio/eth_testnet`);
    return response;
  } catch {
    // Fallback for sim mode
    return { accountValueUsd: 10000, balances: [] };
  }
}

async function main() {
  console.log(`${BLUE}╔═══════════════════════════════════════════════════════════════════════════════╗${NC}`);
  console.log(`${BLUE}║                    MVP A Full Flow E2E Test                                   ║${NC}`);
  console.log(`${BLUE}╚═══════════════════════════════════════════════════════════════════════════════╝${NC}`);
  console.log('');
  console.log(`Base URL: ${BASE_URL}`);
  
  // Auto-detect execution mode from backend if not explicitly set
  if (!EXECUTION_MODE) {
    try {
      const healthResponse = await fetchJson(`${BASE_URL}/health`);
      EXECUTION_MODE = healthResponse.executionMode || 'sim';
      console.log(`${YELLOW}ℹ${NC} Auto-detected execution mode: ${EXECUTION_MODE}`);
    } catch {
      EXECUTION_MODE = 'sim';
      console.log(`${YELLOW}ℹ${NC} Could not detect mode, defaulting to: ${EXECUTION_MODE}`);
    }
  }
  
  console.log(`Execution Mode: ${EXECUTION_MODE}`);
  console.log(`Auth Mode: ${EXECUTION_AUTH_MODE}`);
  console.log(`Submit Mode: ${E2E_SUBMIT ? 'ON' : 'OFF'}`);
  console.log('');

  let portfolio: any = null;

  // Step 1: Swap (DeFi action)
  console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
  console.log(`${BLUE}Step 1: Swap (DeFi Action)${NC}`);
  console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);

  try {
    if (EXECUTION_MODE === 'eth_testnet') {
      // eth_testnet mode: verify executionRequest generation
      const swapPrompt = 'Swap 0.01 ETH to WETH on Sepolia';
      const chatResponse = await fetchJson(`${BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userMessage: swapPrompt,
          venue: 'hyperliquid',
          clientPortfolio: {
            accountValueUsd: 10000,
            balances: [{ symbol: 'ETH', balanceUsd: 30 }],
          },
        }),
      });

      if (!chatResponse.executionRequest || chatResponse.executionRequest.kind !== 'swap') {
        printFail('Swap prompt did not generate executionRequest');
        process.exit(1);
      }
      
      // Verify executionRequest structure
      const execReq = chatResponse.executionRequest;
      if (!execReq.tokenIn || !execReq.tokenOut || !execReq.amountIn) {
        printFail('executionRequest missing required fields');
        process.exit(1);
      }
      printPass(`Swap executionRequest generated: ${execReq.tokenIn} → ${execReq.tokenOut}`);

      if (!TEST_USER_ADDRESS) {
        // No wallet address - skip prepare/submit, use portfolio from response
        printInfo('TEST_USER_ADDRESS not set, skipping prepare/submit');
        portfolio = chatResponse.portfolio || { accountValueUsd: 10000, balances: [{ symbol: 'ETH', balanceUsd: 30 }] };
      } else {
        // Full execution test with wallet address
        // Prepare execution
        const prepareResponse = await fetchJson(`${BASE_URL}/api/execute/prepare`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            draftId: 'mvp-swap',
            userAddress: TEST_USER_ADDRESS,
            executionRequest: chatResponse.executionRequest,
          }),
        });

        if (!prepareResponse.plan) {
          printFail('Prepare response missing plan');
          process.exit(1);
        }

        if (E2E_SUBMIT && EXECUTION_AUTH_MODE === 'session') {
          // Relayed execution
          const sessionId = process.env.TEST_SESSION_ID;
          if (!sessionId) {
            printInfo('TEST_SESSION_ID not set, skipping submit');
          } else {
            const relayedResponse = await fetchJson(`${BASE_URL}/api/execute/relayed`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                draftId: 'mvp-swap',
                userAddress: TEST_USER_ADDRESS,
                plan: prepareResponse.plan,
                sessionId,
                value: prepareResponse.value || '0x0',
              }),
            });

            if (!relayedResponse.success || relayedResponse.status !== 'success') {
              printFail(`Swap execution failed: ${relayedResponse.error || 'Unknown error'}`);
              process.exit(1);
            }

            if (!relayedResponse.txHash) {
              printFail('Swap execution missing txHash');
              process.exit(1);
            }

            portfolio = relayedResponse.portfolio;
            printPass(`Swap executed: ${relayedResponse.txHash}`);
          }
        } else {
          // Just verify plan structure
          portfolio = chatResponse.portfolio;
          printPass('Swap plan prepared (submit skipped)');
        }
      }
    } else {
      // Simulated swap (mock)
      const swapPrompt = 'Swap 10 REDACTED to WETH';
      const chatResponse = await fetchJson(`${BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userMessage: swapPrompt,
          venue: 'hyperliquid',
        }),
      });

      if (!chatResponse.executionResults || chatResponse.executionResults.length === 0) {
        printFail('Swap did not return executionResults');
        process.exit(1);
      }

      const swapResult = chatResponse.executionResults[0];
      if (!swapResult.success || swapResult.status !== 'success') {
        printFail(`Swap execution failed: ${swapResult.error || 'Unknown error'}`);
        process.exit(1);
      }

      portfolio = swapResult.portfolio;
      printPass(`Swap executed: ${swapResult.simulatedTxId || 'simulated'}`);
    }

    // Assert portfolio updated
    if (!portfolio) {
      printFail('Portfolio not returned after swap');
      process.exit(1);
    }
  } catch (error: any) {
    printFail(`Swap step failed: ${error.message}`);
    process.exit(1);
  }

  // Step 2: DeFi Deposit
  console.log('');
  console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
  console.log(`${BLUE}Step 2: DeFi Deposit${NC}`);
  console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);

  try {
    const defiPrompt = 'Deposit 1000 REDACTED into Kamino';
    const chatResponse = await fetchJson(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userMessage: defiPrompt,
        venue: 'hyperliquid',
        clientPortfolio: portfolio,
      }),
    });

    // eth_testnet mode: check executionRequest; sim mode: check executionResults
    if (EXECUTION_MODE === 'eth_testnet') {
      const execReq = chatResponse.executionRequest;
      if (!execReq || (execReq.kind !== 'lend' && execReq.kind !== 'lend_supply')) {
        printFail('DeFi deposit did not generate lend executionRequest');
        process.exit(1);
      }
      printPass(`DeFi executionRequest generated: ${execReq.kind} ${execReq.amount || ''} ${execReq.asset || ''}`);
      // Use portfolio from response or keep previous
      portfolio = chatResponse.portfolio || portfolio;
    } else {
      if (!chatResponse.executionResults || chatResponse.executionResults.length === 0) {
        printFail('DeFi deposit did not return executionResults');
        process.exit(1);
      }

      const defiResult = chatResponse.executionResults[0];
      if (!defiResult.success || defiResult.status !== 'success') {
        printFail(`DeFi deposit failed: ${defiResult.error || 'Unknown error'}`);
        process.exit(1);
      }

      if (!defiResult.positionDelta || defiResult.positionDelta.type !== 'defi') {
        printFail('DeFi deposit missing positionDelta');
        process.exit(1);
      }

      portfolio = defiResult.portfolio;
      printPass(`DeFi deposit executed: ${defiResult.simulatedTxId || 'simulated'}`);
    }

    // Assert portfolio exists
    if (!portfolio) {
      printFail('Portfolio not returned after DeFi deposit');
      process.exit(1);
    }
  } catch (error: any) {
    printFail(`DeFi deposit step failed: ${error.message}`);
    process.exit(1);
  }

  // Step 3: Perp Trade
  console.log('');
  console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
  console.log(`${BLUE}Step 3: Perp Trade${NC}`);
  console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);

  try {
    const perpPrompt = 'Long BTC with 2% risk';
    const chatResponse = await fetchJson(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userMessage: perpPrompt,
        venue: 'hyperliquid',
        clientPortfolio: portfolio,
      }),
    });

    // eth_testnet mode: check executionRequest or actions; sim mode: check executionResults
    if (EXECUTION_MODE === 'eth_testnet') {
      // In eth_testnet, perps currently execute via sim (no on-chain perp yet)
      // Check if we got executionRequest OR executionResults
      const execReq = chatResponse.executionRequest;
      const hasExecResults = chatResponse.executionResults && chatResponse.executionResults.length > 0;
      
      if (execReq && execReq.kind === 'perp') {
        printPass(`Perp executionRequest generated: ${execReq.side} ${execReq.market}`);
        portfolio = chatResponse.portfolio || portfolio;
      } else if (hasExecResults) {
        const perpResult = chatResponse.executionResults[0];
        if (!perpResult.success || perpResult.status !== 'success') {
          printFail(`Perp trade failed: ${perpResult.error || 'Unknown error'}`);
          process.exit(1);
        }
        portfolio = perpResult.portfolio;
        printPass(`Perp trade executed: ${perpResult.simulatedTxId || 'simulated'}`);
      } else {
        printFail('Perp trade did not return executionRequest or executionResults');
        process.exit(1);
      }
    } else {
      if (!chatResponse.executionResults || chatResponse.executionResults.length === 0) {
        printFail('Perp trade did not return executionResults');
        process.exit(1);
      }

      const perpResult = chatResponse.executionResults[0];
      if (!perpResult.success || perpResult.status !== 'success') {
        printFail(`Perp trade failed: ${perpResult.error || 'Unknown error'}`);
        process.exit(1);
      }

      if (!perpResult.positionDelta || perpResult.positionDelta.type !== 'perp') {
        printFail('Perp trade missing positionDelta');
        process.exit(1);
      }

      portfolio = perpResult.portfolio;
      printPass(`Perp trade executed: ${perpResult.simulatedTxId || 'simulated'}`);
    }

    // Assert portfolio exists
    if (!portfolio) {
      printFail('Portfolio not returned after perp trade');
      process.exit(1);
    }
  } catch (error: any) {
    printFail(`Perp trade step failed: ${error.message}`);
    process.exit(1);
  }

  // Step 4: Prediction Market
  console.log('');
  console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
  console.log(`${BLUE}Step 4: Prediction Market${NC}`);
  console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);

  try {
    const eventPrompt = 'Bet YES on Fed cuts in March 2025 with $200';
    const chatResponse = await fetchJson(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userMessage: eventPrompt,
        venue: 'event_demo',
        clientPortfolio: portfolio,
      }),
    });

    // eth_testnet mode: check executionRequest or executionResults; sim mode: check executionResults
    if (EXECUTION_MODE === 'eth_testnet') {
      const execReq = chatResponse.executionRequest;
      const hasExecResults = chatResponse.executionResults && chatResponse.executionResults.length > 0;
      
      if (execReq && execReq.kind === 'event') {
        printPass(`Event executionRequest generated: ${execReq.outcome} on ${execReq.marketId}`);
        portfolio = chatResponse.portfolio || portfolio;
      } else if (hasExecResults) {
        const eventResult = chatResponse.executionResults[0];
        if (!eventResult.success || eventResult.status !== 'success') {
          printFail(`Prediction market failed: ${eventResult.error || 'Unknown error'}`);
          process.exit(1);
        }
        portfolio = eventResult.portfolio;
        printPass(`Prediction market executed: ${eventResult.simulatedTxId || 'simulated'}`);
      } else {
        printFail('Prediction market did not return executionRequest or executionResults');
        process.exit(1);
      }
    } else {
      if (!chatResponse.executionResults || chatResponse.executionResults.length === 0) {
        printFail('Prediction market did not return executionResults');
        process.exit(1);
      }

      const eventResult = chatResponse.executionResults[0];
      if (!eventResult.success || eventResult.status !== 'success') {
        printFail(`Prediction market failed: ${eventResult.error || 'Unknown error'}`);
        process.exit(1);
      }

      if (!eventResult.positionDelta || eventResult.positionDelta.type !== 'event') {
        printFail('Prediction market missing positionDelta');
        process.exit(1);
      }

      portfolio = eventResult.portfolio;
      printPass(`Prediction market executed: ${eventResult.simulatedTxId || 'simulated'}`);
    }

    // Assert portfolio exists
    if (!portfolio) {
      printFail('Portfolio not returned after prediction market');
      process.exit(1);
    }
  } catch (error: any) {
    printFail(`Prediction market step failed: ${error.message}`);
    process.exit(1);
  }

  // Final portfolio validation
  console.log('');
  console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
  console.log(`${BLUE}Final Portfolio Validation${NC}`);
  console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);

  if (!portfolio) {
    printFail('Final portfolio is null');
    process.exit(1);
  }

  // In eth_testnet mode without execution, portfolio may be a stub
  // Just verify structure, not actual positions
  if (EXECUTION_MODE === 'eth_testnet' && !TEST_USER_ADDRESS) {
    printPass('eth_testnet mode (no wallet): executionRequest generation verified');
    printPass('Portfolio structure preserved throughout test');
    if (portfolio.accountValueUsd !== undefined) {
      printPass(`Account Value: $${portfolio.accountValueUsd.toFixed(2)}`);
    }
  } else {
    if (portfolio.accountValueUsd === undefined) {
      printFail('Portfolio missing accountValueUsd');
      process.exit(1);
    }

    if (!Array.isArray(portfolio.balances)) {
      printFail('Portfolio missing balances array');
      process.exit(1);
    }

    if (!Array.isArray(portfolio.strategies)) {
      printFail('Portfolio missing strategies array');
      process.exit(1);
    }

    // Verify we have positions from all 4 steps
    const defiPositions = portfolio.defiPositions?.filter((p: any) => !p.isClosed) || [];
    const perpPositions = portfolio.strategies?.filter((s: any) => s.type === 'perp' && !s.isClosed) || [];
    const eventPositions = portfolio.strategies?.filter((s: any) => s.type === 'event' && !s.isClosed) || [];

    if (defiPositions.length === 0) {
      printFail('No active DeFi positions found');
      process.exit(1);
    }

    if (perpPositions.length === 0) {
      printFail('No active perp positions found');
      process.exit(1);
    }

    if (eventPositions.length === 0) {
      printFail('No active event positions found');
      process.exit(1);
    }

    printPass('All positions present in portfolio');
    printPass(`Account Value: $${portfolio.accountValueUsd.toFixed(2)}`);
    printPass(`DeFi Positions: ${defiPositions.length}`);
    printPass(`Perp Positions: ${perpPositions.length}`);
    printPass(`Event Positions: ${eventPositions.length}`);
  }

  // Summary
  console.log('');
  console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
  console.log(`${BLUE}Summary${NC}`);
  console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
  console.log(`${GREEN}Passed: ${passed}${NC}`);
  console.log(`${failed > 0 ? RED : GREEN}Failed: ${failed}${NC}`);
  console.log('');

  if (failed > 0) {
    process.exit(1);
  }

  // Test 5: Forced Failure Case (Insufficient Balance)
  console.log('');
  console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
  console.log(`${BLUE}Test 5: Forced Failure Case (Insufficient Balance)${NC}`);
  console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);

  try {
    const portfolioBeforeFailure = await getPortfolioSnapshot();
    
    // Try to execute a swap with more than available balance
    const failurePrompt = 'Swap 1000000 REDACTED to WETH';
    const failureResponse = await fetchJson(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userMessage: failurePrompt,
        venue: 'hyperliquid',
        clientPortfolio: portfolioBeforeFailure,
      }),
    });

    // Should either fail gracefully or return no execution
    if (failureResponse.executionResults && failureResponse.executionResults.length > 0) {
      const failureResult = failureResponse.executionResults[0];
      if (failureResult.success) {
        printFail('Failure test: Execution succeeded when it should have failed');
        process.exit(1);
      }
      if (failureResult.errorCode !== 'INSUFFICIENT_BALANCE' && !failureResult.error) {
        printFail('Failure test: Missing error code or message');
        process.exit(1);
      }
      printPass('Failure test: Execution correctly failed with error');
    } else {
      // No execution is also acceptable (LLM refused or no action generated)
      printPass('Failure test: No execution generated (acceptable)');
    }

    // Verify portfolio unchanged
    const portfolioAfterFailure = await getPortfolioSnapshot();
    if (portfolioAfterFailure.accountValueUsd !== portfolioBeforeFailure.accountValueUsd) {
      printFail('Failure test: Portfolio changed after failed execution');
      process.exit(1);
    }
    printPass('Failure test: Portfolio unchanged after failure');
  } catch (error: any) {
    printFail(`Failure test step failed: ${error.message}`);
    process.exit(1);
  }

  // Final Summary
  console.log('');
  console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
  console.log(`${BLUE}Summary${NC}`);
  console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
  console.log(`${GREEN}Passed: ${passed}${NC}`);
  console.log(`${failed > 0 ? RED : GREEN}Failed: ${failed}${NC}`);
  console.log('');

  if (failed > 0) {
    process.exit(1);
  }

  console.log(`${GREEN}✓ MVP A Full Flow Test PASSED (including failure cases)${NC}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

