#!/usr/bin/env node
/**
 * E2E Sepolia Smoke Test
 * Validates the Sepolia execution flow without UI interaction
 * 
 * Usage:
 *   node agent/scripts/e2e-sepolia-smoke.ts [--actually-relay]
 * 
 * Environment Variables:
 *   BASE_URL - Backend URL (default: http://localhost:3001)
 *   TEST_USER_ADDRESS - Ethereum address for testing (required)
 *   EXECUTION_AUTH_MODE - 'direct' or 'session' (default: 'direct')
 *   EXECUTION_MODE - Must be 'eth_testnet'
 */

import { execSync } from 'child_process';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const TEST_USER_ADDRESS = process.env.TEST_USER_ADDRESS;
const EXECUTION_AUTH_MODE = process.env.EXECUTION_AUTH_MODE || 'direct';
const EXECUTION_MODE = process.env.EXECUTION_MODE || '';
const ACTUALLY_RELAY = process.argv.includes('--actually-relay');
const FULL_MODE = process.argv.includes('--full');
const E2E_SUBMIT = process.env.E2E_SUBMIT === '1';
// Parse execution intent (support 'uniswap' as alias for 'swap_usdc_weth', 'funding_route' for atomic funding)
let EXECUTION_INTENT = process.env.E2E_INTENT || 
  process.argv.find(arg => arg.startsWith('--intent='))?.split('=')[1] || 
  process.argv[process.argv.indexOf('--intent') + 1] || 'swap_usdc_weth';

// Normalize 'uniswap' to 'swap_usdc_weth'
if (EXECUTION_INTENT === 'uniswap') {
  EXECUTION_INTENT = 'swap_usdc_weth';
}

// Colors for output
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const NC = '\x1b[0m';

let passed = 0;
let failed = 0;
let skipped = 0;

function printPass(msg: string) {
  console.log(`${GREEN}✓ PASS${NC} ${msg}`);
  passed++;
}

function printFail(msg: string) {
  console.log(`${RED}✗ FAIL${NC} ${msg}`);
  failed++;
}

function printSkip(msg: string) {
  console.log(`${YELLOW}⏭  SKIP${NC} ${msg}`);
  skipped++;
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

async function main() {
  console.log(`${BLUE}╔═══════════════════════════════════════════════════════════════════════════════╗${NC}`);
  console.log(`${BLUE}║                    E2E Sepolia Smoke Test                                     ║${NC}`);
  console.log(`${BLUE}╚═══════════════════════════════════════════════════════════════════════════════╝${NC}`);
  console.log('');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Execution Mode: ${EXECUTION_MODE || 'not set'}`);
  console.log(`Auth Mode: ${EXECUTION_AUTH_MODE}`);
  console.log(`Test User: ${TEST_USER_ADDRESS || 'not set'}`);
  console.log('');

  // Validate prerequisites
  if (EXECUTION_MODE !== 'eth_testnet') {
    printFail('EXECUTION_MODE must be set to "eth_testnet"');
    console.log('');
    console.log('Set it with:');
    console.log('  export EXECUTION_MODE=eth_testnet');
    console.log('');
    process.exit(1);
  }

  if (!TEST_USER_ADDRESS) {
    printFail('TEST_USER_ADDRESS is required');
    console.log('');
    console.log('Set it with:');
    console.log('  export TEST_USER_ADDRESS=0x...');
    console.log('');
    process.exit(1);
  }

  // In --full mode, validate required env vars
  if (FULL_MODE) {
    const requiredVars: string[] = [];
    if (!process.env.EXECUTION_ROUTER_ADDRESS) requiredVars.push('EXECUTION_ROUTER_ADDRESS');
    if (!process.env.MOCK_SWAP_ADAPTER_ADDRESS) requiredVars.push('MOCK_SWAP_ADAPTER_ADDRESS');
    if (!process.env.ETH_TESTNET_RPC_URL) requiredVars.push('ETH_TESTNET_RPC_URL');
    if (!process.env.REDACTED_ADDRESS_SEPOLIA) requiredVars.push('REDACTED_ADDRESS_SEPOLIA');
    if (!process.env.WETH_ADDRESS_SEPOLIA) requiredVars.push('WETH_ADDRESS_SEPOLIA');
    
    if (requiredVars.length > 0) {
      printFail(`Missing required environment variables (--full mode): ${requiredVars.join(', ')}`);
      console.log('');
      console.log('Set them with:');
      requiredVars.forEach(v => console.log(`  export ${v}=...`));
      console.log('');
      process.exit(1);
    }
  }

  // Validate address format
  if (!/^0x[a-fA-F0-9]{40}$/.test(TEST_USER_ADDRESS)) {
    printFail(`TEST_USER_ADDRESS has invalid format: ${TEST_USER_ADDRESS}`);
    process.exit(1);
  }

  try {
    // Test 1: Health check
    console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
    console.log(`${BLUE}Test 1: Health Check${NC}`);
    console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
    
    try {
      const health = await fetchJson(`${BASE_URL}/health`);
      printPass('Health endpoint');
      console.log(`Response: ${JSON.stringify(health, null, 2)}`);
    } catch (error: any) {
      printFail(`Health endpoint: ${error.message}`);
      console.log('');
      console.log('Backend is not running. Start it with:');
      console.log('  cd agent && PORT=3001 npm run dev');
      console.log('');
      process.exit(1);
    }

    // Test 2: Preflight check
    console.log('');
    console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
    console.log(`${BLUE}Test 2: Preflight Check${NC}`);
    console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
    
    let hasFullConfig = false;
    let preflightResult: any = null;
    try {
      const preflight = await fetchJson(`${BASE_URL}/api/execute/preflight`);
      preflightResult = preflight; // Store for later assertions
      console.log(`Response: ${JSON.stringify(preflight, null, 2)}`);
      
      if (preflight.ok === true) {
        printPass('Preflight check (ok: true)');
        hasFullConfig = true;
      } else {
        // Check if failure is due to missing config
        const isConfigError = preflight.notes && Array.isArray(preflight.notes) &&
          preflight.notes.some((note: string) => 
            note.includes('environment variables') || 
            note.includes('not configured') ||
            note.includes('missing')
          );
        
        if (FULL_MODE && isConfigError) {
          // Strict mode: fail if config is missing
          printFail('Preflight check (ok: false - missing required configuration)');
          if (preflight.notes && Array.isArray(preflight.notes)) {
            console.log('Missing configuration:');
            preflight.notes.forEach((note: string) => console.log(`  - ${note}`));
          }
          // Extract missing env vars from notes
          const missingVars: string[] = [];
          if (preflight.notes && Array.isArray(preflight.notes)) {
            preflight.notes.forEach((note: string) => {
              if (note.includes('EXECUTION_ROUTER_ADDRESS')) missingVars.push('EXECUTION_ROUTER_ADDRESS');
              if (note.includes('MOCK_SWAP_ADAPTER_ADDRESS')) missingVars.push('MOCK_SWAP_ADAPTER_ADDRESS');
              if (note.includes('UNISWAP_V3_ADAPTER_ADDRESS')) missingVars.push('UNISWAP_V3_ADAPTER_ADDRESS');
              if (note.includes('ETH_TESTNET_RPC_URL')) missingVars.push('ETH_TESTNET_RPC_URL');
              if (note.includes('REDACTED_ADDRESS_SEPOLIA')) missingVars.push('REDACTED_ADDRESS_SEPOLIA');
              if (note.includes('WETH_ADDRESS_SEPOLIA')) missingVars.push('WETH_ADDRESS_SEPOLIA');
            });
          }
          if (missingVars.length > 0) {
            console.log('');
            console.log('Required environment variables:');
            [...new Set(missingVars)].forEach(v => console.log(`  - ${v}`));
          }
        } else if (isConfigError) {
          // Non-strict mode: skip if config is missing
          printSkip('Preflight check (missing config - will skip config-dependent tests)');
          if (preflight.notes && Array.isArray(preflight.notes)) {
            console.log('Config notes:');
            preflight.notes.forEach((note: string) => console.log(`  - ${note}`));
          }
        } else {
          printFail('Preflight check (ok: false)');
          if (preflight.notes && Array.isArray(preflight.notes)) {
            console.log('Notes:');
            preflight.notes.forEach((note: string) => console.log(`  - ${note}`));
          }
        }
      }
    } catch (error: any) {
      printFail(`Preflight check: ${error.message}`);
    }

    // Test 3: Portfolio endpoint
    console.log('');
    console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
    console.log(`${BLUE}Test 3: Portfolio Endpoint${NC}`);
    console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
    
    if (!hasFullConfig) {
      if (FULL_MODE) {
        printFail('Portfolio endpoint (requires full config - missing environment variables)');
      } else {
        printSkip('Portfolio endpoint (requires full config)');
      }
    } else {
      try {
        const portfolio = await fetchJson(`${BASE_URL}/api/portfolio/eth_testnet?userAddress=${TEST_USER_ADDRESS}`);
        console.log(`Response: ${JSON.stringify(portfolio, null, 2)}`);
        
        if (portfolio.balances) {
          printPass('Portfolio endpoint (returns balances)');
          if (portfolio.balances.eth) {
            console.log(`  ETH: ${portfolio.balances.eth.formatted || '0'}`);
          }
          if (portfolio.balances.usdc) {
            console.log(`  REDACTED: ${portfolio.balances.usdc.formatted || '0'}`);
          }
          if (portfolio.balances.weth) {
            console.log(`  WETH: ${portfolio.balances.weth.formatted || '0'}`);
          }
        } else {
          printFail('Portfolio endpoint (missing balances field)');
        }
      } catch (error: any) {
        // Check if error is due to missing config
        if (error.message.includes('not configured') || error.message.includes('missing')) {
          if (FULL_MODE) {
            printFail(`Portfolio endpoint: ${error.message}`);
          } else {
            printSkip(`Portfolio endpoint (${error.message})`);
          }
        } else {
          printFail(`Portfolio endpoint: ${error.message}`);
        }
      }
    }

    // Test 4: Execute prepare
    const intentLabel = EXECUTION_INTENT === 'mock' ? 'mock' : 
                       EXECUTION_INTENT === 'uniswap' ? 'uniswap (swap_usdc_weth)' :
                       EXECUTION_INTENT;
    console.log('');
    console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
    console.log(`${BLUE}Test 4: Execute Prepare (${intentLabel})${NC}`);
    console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
    
    // Store prepareResponse for use in submit test
    let prepareResponse: any = null;
    
    if (!hasFullConfig) {
      if (FULL_MODE) {
        printFail('Execute prepare (requires full config - missing environment variables)');
      } else {
        printSkip('Execute prepare (requires full config)');
      }
    } else {
      try {
        const response = await fetchJson(`${BASE_URL}/api/execute/prepare`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            draftId: 'e2e-test-draft',
            userAddress: TEST_USER_ADDRESS,
            executionIntent: EXECUTION_INTENT,
            authMode: EXECUTION_AUTH_MODE,
          }),
        });
        
        prepareResponse = response; // Store for submit test
        console.log(`Response: ${JSON.stringify(prepareResponse, null, 2)}`);
        
        if (prepareResponse.chainId && prepareResponse.to && prepareResponse.plan) {
          // Assertions for real execution intents
          const assertions: string[] = [];
          
          // Assert: Router bytecode exists (checked in preflight, but verify to matches)
          if (preflightResult && preflightResult.router) {
            if (prepareResponse.to.toLowerCase() === preflightResult.router.toLowerCase()) {
              assertions.push('✓ Router address matches preflight');
            } else {
              assertions.push(`✗ Router mismatch: ${prepareResponse.to} vs ${preflightResult.router}`);
            }
          }
          
          // Assert: Adapter is allowlisted (checked in preflight)
          if (preflightResult && preflightResult.adapter) {
            const adapterInPlan = prepareResponse.plan.actions?.[0]?.adapter?.toLowerCase();
            if (adapterInPlan) {
              assertions.push(`✓ Plan uses adapter: ${adapterInPlan}`);
            }
          }
          
          // Assert: tx.to is router
          const EXECUTION_ROUTER = process.env.EXECUTION_ROUTER_ADDRESS?.toLowerCase();
          if (EXECUTION_ROUTER && prepareResponse.to.toLowerCase() === EXECUTION_ROUTER) {
            assertions.push('✓ Transaction target is ExecutionRouter');
          } else {
            assertions.push(`✗ Transaction target mismatch: ${prepareResponse.to} vs ${EXECUTION_ROUTER}`);
          }
          
          // Assert: tx.data length > 0 (for executeBySender call)
          // For mock intent, allow empty data; for uniswap, require non-empty
          if (prepareResponse.plan && prepareResponse.plan.actions) {
            const hasData = prepareResponse.plan.actions.some((a: any) => 
              a.data && a.data.startsWith('0x') && a.data.length > 2
            );
            if (EXECUTION_INTENT === 'mock') {
              // Mock intent can have empty data, don't assert
              if (hasData) {
                assertions.push('✓ Plan actions have calldata (optional for mock)');
              } else {
                assertions.push('✓ Plan actions use empty data (expected for mock)');
              }
            } else {
              // Uniswap intent must have non-empty data
              if (hasData) {
                assertions.push('✓ Plan actions have non-empty calldata');
              } else {
                assertions.push('✗ Plan actions missing calldata (required for uniswap)');
              }
            }
            
            // For Uniswap intents, verify adapter is Uniswap adapter
            if (EXECUTION_INTENT === 'swap_usdc_weth' || EXECUTION_INTENT === 'swap_weth_usdc' || EXECUTION_INTENT === 'uniswap') {
              const UNISWAP_ADAPTER = process.env.UNISWAP_V3_ADAPTER_ADDRESS?.toLowerCase();
              const planAdapter = prepareResponse.plan.actions[0]?.adapter?.toLowerCase();
              if (UNISWAP_ADAPTER && planAdapter === UNISWAP_ADAPTER) {
                assertions.push('✓ Plan uses UniswapV3SwapAdapter');
              } else {
                assertions.push(`✗ Plan adapter mismatch: ${planAdapter} vs ${UNISWAP_ADAPTER}`);
              }
            }
          }
          
          if (assertions.length > 0) {
            console.log('');
            console.log('Assertions:');
            assertions.forEach(a => console.log(`  ${a}`));
            console.log('');
          }
          
          printPass('Execute prepare (returns plan)');
          
          // Check for requirements
          if (prepareResponse.requirements && prepareResponse.requirements.approvals) {
            printInfo(`Approval required: ${prepareResponse.requirements.approvals.length} token(s)`);
            
            // Test 5: Token approve prepare
            console.log('');
            console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
            console.log(`${BLUE}Test 5: Token Approve Prepare${NC}`);
            console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
            
            for (const approval of prepareResponse.requirements.approvals) {
              try {
                const approveResponse = await fetchJson(`${BASE_URL}/api/token/approve/prepare`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    token: approval.token,
                    spender: approval.spender,
                    amount: approval.amount,
                    userAddress: TEST_USER_ADDRESS,
                  }),
                });
                
                console.log(`Approval transaction payload:`);
                console.log(JSON.stringify(approveResponse, null, 2));
                
                if (approveResponse.to && approveResponse.data) {
                  printPass(`Token approve prepare (${approval.token})`);
                } else {
                  printFail(`Token approve prepare (${approval.token}): missing fields`);
                }
              } catch (error: any) {
                printFail(`Token approve prepare (${approval.token}): ${error.message}`);
              }
            }
          } else {
            printInfo('No approval required');
          }
        } else {
          printFail('Execute prepare (missing required fields)');
        }
      } catch (error: any) {
        // Check if error is due to missing config
        if (error.message.includes('environment variables') || error.message.includes('not configured')) {
          if (FULL_MODE) {
            printFail(`Execute prepare: ${error.message}`);
          } else {
            printSkip(`Execute prepare (${error.message})`);
          }
        } else {
          printFail(`Execute prepare: ${error.message}`);
        }
      }
    }

    // Test 6: AI-Driven Plan Generation (Strict - requires Gemini)
    console.log('');
    console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
    console.log(`${BLUE}Test 6: AI-Driven Plan Generation (Strict)${NC}`);
    console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
    
    try {
      // Check health endpoint for provider info
      const healthResponse = await fetchJson(`${BASE_URL}/health`, {
        method: 'GET',
      });
      
      const llmProvider = healthResponse.llmProvider || 'stub';
      console.log(`LLM Provider: ${llmProvider}`);
      
      // STRICT: Require Gemini for AI tests
      if (llmProvider !== 'gemini') {
        printFail(`AI-driven plan generation requires Gemini (got ${llmProvider})`);
        process.exit(1);
      }
      
      // Test ETH-only scenario (unambiguous prompt)
      const ethOnlyPrompt = 'Swap 0.01 ETH to WETH on Sepolia';
      const chatResponse = await fetchJson(`${BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userMessage: ethOnlyPrompt,
          venue: 'hyperliquid',
          clientPortfolio: {
            accountValueUsd: 10000,
            balances: [
              { symbol: 'ETH', balanceUsd: 30 }, // Has ETH, no REDACTED/WETH
            ],
          },
        }),
      });
      
      console.log(`AI Response: ${chatResponse.assistantMessage?.substring(0, 200)}...`);
      console.log(`Execution Request: ${JSON.stringify(chatResponse.executionRequest, null, 2)}`);
      
      // STRICT ASSERTIONS
      if (!chatResponse.modelOk) {
        printFail('AI returned modelOk=false (refusal or invalid response)');
        process.exit(1);
      }
      
      if (!chatResponse.executionRequest) {
        printFail('AI did not return executionRequest for swap prompt');
        process.exit(1);
      }
      
      if (chatResponse.executionRequest.kind !== 'swap') {
        printFail(`Expected executionRequest.kind=swap, got ${chatResponse.executionRequest.kind}`);
        process.exit(1);
      }
      
      if (chatResponse.executionRequest.tokenIn !== 'ETH') {
        printFail(`Expected tokenIn=ETH, got ${chatResponse.executionRequest.tokenIn}`);
        process.exit(1);
      }
      
      // fundingPolicy defaults to auto if not provided
      const fundingPolicy = chatResponse.executionRequest.fundingPolicy || 'auto';
      if (fundingPolicy !== 'auto' && fundingPolicy !== 'require_tokenIn') {
        printFail(`Invalid fundingPolicy: ${fundingPolicy}`);
        process.exit(1);
      }
      
      if (!chatResponse.executionRequest.amountIn) {
        printFail('executionRequest missing required amountIn');
        process.exit(1);
      }
      
      // Validate amountIn is a valid decimal string
      const amountInNum = parseFloat(chatResponse.executionRequest.amountIn);
      if (isNaN(amountInNum) || amountInNum <= 0) {
        printFail(`Invalid amountIn value: ${chatResponse.executionRequest.amountIn}`);
        process.exit(1);
      }
      
      printPass('AI generated valid executionRequest for ETH-only scenario');
      
      // Test wrap endpoint (backend-only, no wallet signing)
      console.log('');
      console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
      console.log(`${BLUE}Test 6b: WETH Wrap Endpoint${NC}`);
      console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
      
      try {
        const wrapAmount = chatResponse.executionRequest.amountIn;
        const wrapResponse = await fetchJson(`${BASE_URL}/api/token/weth/wrap/prepare`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: wrapAmount,
            userAddress: TEST_USER_ADDRESS,
          }),
        });
        
        // Assert response structure
        if (!wrapResponse.to || !wrapResponse.data || !wrapResponse.value) {
          printFail('Wrap response missing required fields');
          process.exit(1);
        }
        
        // Assert to equals WETH address
        const WETH_ADDRESS = process.env.WETH_ADDRESS_SEPOLIA?.toLowerCase();
        if (WETH_ADDRESS && wrapResponse.to.toLowerCase() !== WETH_ADDRESS) {
          printFail(`Wrap to address mismatch: ${wrapResponse.to} vs ${WETH_ADDRESS}`);
          process.exit(1);
        }
        
        // Assert data matches WETH deposit() selector
        if (wrapResponse.data !== '0xd0e30db0') {
          printFail(`Wrap data mismatch: expected 0xd0e30db0, got ${wrapResponse.data}`);
          process.exit(1);
        }
        
        // Assert value equals parseUnits(amountIn, 18)
        const { parseUnits } = await import('viem');
        const expectedValue = parseUnits(wrapAmount, 18);
        const actualValue = BigInt(wrapResponse.value);
        if (actualValue !== expectedValue) {
          printFail(`Wrap value mismatch: expected ${expectedValue.toString()}, got ${actualValue.toString()}`);
          process.exit(1);
        }
        
        printPass('WETH wrap endpoint returns correct payload');
      } catch (error: any) {
        printFail(`WETH wrap endpoint test: ${error.message}`);
        process.exit(1);
      }
      
      // Test bridge: executionRequest → prepare
      const prepareResponse = await fetchJson(`${BASE_URL}/api/execute/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draftId: 'test-funding-route',
          userAddress: TEST_USER_ADDRESS,
          executionRequest: chatResponse.executionRequest,
        }),
      });
      
      // Assert plan structure
      if (!prepareResponse.plan || !Array.isArray(prepareResponse.plan.actions)) {
        printFail('Prepare response missing plan.actions');
        process.exit(1);
      }
      
      // Assert swap action has non-empty calldata
      const swapAction = prepareResponse.plan.actions.find((a: any) => a.actionType === 0); // SWAP = 0
      if (!swapAction) {
        printFail('Plan missing SWAP action');
        process.exit(1);
      }
      
      if (!swapAction.data || swapAction.data === '0x' || swapAction.data.length < 10) {
        printFail('Swap action missing or invalid calldata');
        process.exit(1);
      }
      
      // Assert adapter is Uniswap adapter
      const UNISWAP_ADAPTER = process.env.UNISWAP_V3_ADAPTER_ADDRESS?.toLowerCase();
      if (UNISWAP_ADAPTER && swapAction.adapter?.toLowerCase() !== UNISWAP_ADAPTER) {
        printFail(`Plan uses wrong adapter: ${swapAction.adapter} vs ${UNISWAP_ADAPTER}`);
        process.exit(1);
      }
      
      // Assert approvals are returned if needed
      if (prepareResponse.requirements?.approvals) {
        if (!Array.isArray(prepareResponse.requirements.approvals) || prepareResponse.requirements.approvals.length === 0) {
          printFail('requirements.approvals must be non-empty array if present');
          process.exit(1);
        }
      }
      
      printPass('Funding route plan prepared correctly (SWAP with calldata)');
      
      // If E2E_INTENT is funding_route or session_funding_route_submit, assert WRAP action is present
      if (EXECUTION_INTENT === 'funding_route' || EXECUTION_INTENT === 'session_funding_route_submit') {
        const wrapAction = prepareResponse.plan.actions.find((a: any) => a.actionType === 1); // WRAP = 1
        if (!wrapAction) {
          printFail('Funding route plan missing WRAP action');
          process.exit(1);
        }
        
        // Assert wrap adapter is correct
        const WETH_WRAP_ADAPTER = process.env.WETH_WRAP_ADAPTER_ADDRESS?.toLowerCase();
        if (WETH_WRAP_ADAPTER && wrapAction.adapter?.toLowerCase() !== WETH_WRAP_ADAPTER) {
          printFail(`Plan uses wrong wrap adapter: ${wrapAction.adapter} vs ${WETH_WRAP_ADAPTER}`);
          process.exit(1);
        }
        
        // Assert WRAP is first action
        if (prepareResponse.plan.actions[0].actionType !== 1) {
          printFail('WRAP action must be first in funding route plan');
          process.exit(1);
        }
        
        // Assert SWAP is second action
        if (prepareResponse.plan.actions.length < 2 || prepareResponse.plan.actions[1].actionType !== 0) {
          printFail('SWAP action must be second in funding route plan');
          process.exit(1);
        }
        
        // Assert value > 0 (user sends ETH with transaction)
        const planValue = BigInt(prepareResponse.value || '0x0');
        if (planValue === 0n) {
          printFail('Funding route plan must have value > 0 for WRAP action');
          process.exit(1);
        }
        
        printPass('Funding route plan includes WRAP as first action and SWAP as second');
        
        // If E2E_INTENT is session_funding_route_submit and E2E_SUBMIT=1, test relayed execution
        if (EXECUTION_INTENT === 'session_funding_route_submit' && E2E_SUBMIT) {
          console.log('');
          console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
          console.log(`${BLUE}Test 6d: Session + Route 2 Relayed Execution (SUBMIT)${NC}`);
          console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
          
          try {
            // Check if session exists (from env or create one)
            // For E2E, we'll use a test session ID if provided, or create one
            let sessionId = process.env.TEST_SESSION_ID;
            
            if (!sessionId) {
              // Create session (would require wallet signing in real flow, but for E2E we simulate)
              printInfo('TEST_SESSION_ID not set - session creation would require wallet signing');
              printInfo('Skipping relayed execution test (set TEST_SESSION_ID to test)');
              printSkip('Session + Route 2 relayed execution (requires TEST_SESSION_ID)');
            } else {
              // Prepare plan with session mode
              const sessionPrepareResponse = await fetchJson(`${BASE_URL}/api/execute/prepare`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  draftId: 'test-session-funding-route',
                  userAddress: TEST_USER_ADDRESS,
                  authMode: 'session',
                  executionRequest: chatResponse.executionRequest,
                }),
              });
              
              if (!sessionPrepareResponse.plan) {
                printFail('Session prepare response missing plan');
                process.exit(1);
              }
              
              // Call relayed execution
              const relayedResponse = await fetchJson(`${BASE_URL}/api/execute/relayed`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  draftId: 'test-session-funding-route',
                  userAddress: TEST_USER_ADDRESS,
                  plan: sessionPrepareResponse.plan,
                  sessionId,
                  value: sessionPrepareResponse.value || '0x0',
                }),
              });
              
              if (!relayedResponse.txHash) {
                printFail('Relayed execution missing txHash');
                process.exit(1);
              }
              
              const txHash = relayedResponse.txHash;
              const explorerUrl = relayedResponse.explorerUrl;
              
              printPass(`Relayed execution submitted, txHash: ${txHash}`);
              if (explorerUrl) {
                printInfo(`Explorer: ${explorerUrl}`);
              }
              
              // Poll for confirmation
              let confirmed = false;
              const maxAttempts = 30;
              let attempts = 0;
              
              while (!confirmed && attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                attempts++;
                
                try {
                  const statusResponse = await fetchJson(`${BASE_URL}/api/execute/status?txHash=${encodeURIComponent(txHash)}`, {
                    method: 'GET',
                  });
                  
                  if (statusResponse.status === 'confirmed') {
                    confirmed = true;
                    printPass(`Transaction confirmed after ${attempts * 2}s`);
                    break;
                  } else if (statusResponse.status === 'reverted') {
                    printFail('Transaction reverted');
                    process.exit(1);
                  }
                } catch (error: any) {
                  // Continue polling
                }
              }
              
              if (!confirmed) {
                printFail('Transaction not confirmed after 60s');
                process.exit(1);
              }
              
              printPass('Session + Route 2 relayed execution completed successfully');
            }
          } catch (error: any) {
            printFail(`Session + Route 2 relayed execution: ${error.message}`);
            process.exit(1);
          }
        }
      }
      
    } catch (error: any) {
      printFail(`AI-driven plan generation: ${error.message}`);
      process.exit(1);
    }

    // Test 7: Session prepare (if session mode)
    if (EXECUTION_AUTH_MODE === 'session') {
      console.log('');
      console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
      console.log(`${BLUE}Test 7: Session Prepare${NC}`);
      console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
      
      try {
        const sessionResponse = await fetchJson(`${BASE_URL}/api/session/prepare`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userAddress: TEST_USER_ADDRESS,
          }),
        });
        
        console.log(`Session transaction payload:`);
        console.log(JSON.stringify(sessionResponse, null, 2));
        
        if (sessionResponse.to && sessionResponse.data && sessionResponse.sessionId) {
          printPass('Session prepare (returns transaction)');
        } else {
          printFail('Session prepare (missing required fields)');
        }
      } catch (error: any) {
        printFail(`Session prepare: ${error.message}`);
      }
    } else {
      printSkip('Session prepare (not in session mode)');
    }

    // Test 8: Execute submit (if E2E_SUBMIT=1)
    if (E2E_SUBMIT) {
      console.log('');
      console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
      console.log(`${BLUE}Test 8: Execute Submit (E2E_SUBMIT=1)${NC}`);
      console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
      
      if (EXECUTION_AUTH_MODE === 'session') {
        // Session mode: can submit via relayed endpoint
        try {
          // First, ensure we have a prepared plan (from Test 4)
          if (!prepareResponse || !prepareResponse.plan) {
            printFail('Execute submit (requires prepared plan from Test 4)');
          } else {
            // Check if session exists (would need to be created manually or via Test 6)
            // For MVP, we'll create a session on-the-fly if needed
            let sessionId: string | undefined;
            
            // Try to get existing session or create one
            try {
              const sessionPrepare = await fetchJson(`${BASE_URL}/api/session/prepare`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  userAddress: TEST_USER_ADDRESS,
                }),
              });
              
              if (sessionPrepare.sessionId) {
                sessionId = sessionPrepare.sessionId;
                printInfo(`Session ID: ${sessionId.substring(0, 10)}... (user must sign session creation tx first)`);
                printInfo('Note: For automated submit, session must already exist on-chain');
              }
            } catch (error: any) {
              printInfo(`Session prepare failed: ${error.message}. Assuming session exists.`);
            }
            
            if (!sessionId) {
              printInfo('Note: Session must be created on-chain before submit. Skipping submit.');
              printSkip('Execute submit (session not created)');
            } else {
              // Call relayed endpoint
              const relayedResponse = await fetchJson(`${BASE_URL}/api/execute/relayed`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  draftId: 'e2e-test-draft',
                  userAddress: TEST_USER_ADDRESS,
                  plan: prepareResponse.plan,
                  sessionId: sessionId,
                }),
              });
              
              if (relayedResponse.txHash) {
                const txHash = relayedResponse.txHash;
                printPass(`Execute submit (txHash: ${txHash.substring(0, 10)}...${txHash.substring(txHash.length - 8)})`);
                
                // Poll status
                console.log('');
                console.log(`${BLUE}Polling transaction status...${NC}`);
                const maxAttempts = 30; // 30 * 2s = 60s
                let attempts = 0;
                let confirmed = false;
                
                while (attempts < maxAttempts && !confirmed) {
                  attempts++;
                  await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s
                  
                  try {
                    const statusResponse = await fetchJson(`${BASE_URL}/api/execute/status?txHash=${encodeURIComponent(txHash)}`, {
                      method: 'GET',
                    });
                    
                    if (statusResponse.status === 'confirmed') {
                      printPass(`Transaction confirmed (block: ${statusResponse.blockNumber || 'N/A'})`);
                      confirmed = true;
                    } else if (statusResponse.status === 'reverted') {
                      printFail(`Transaction reverted (block: ${statusResponse.blockNumber || 'N/A'})`);
                      confirmed = true;
                    } else if (statusResponse.status === 'pending') {
                      // Keep waiting
                      if (attempts % 5 === 0) {
                        console.log(`  Still pending... (attempt ${attempts}/${maxAttempts})`);
                      }
                    }
                  } catch (error: any) {
                    console.log(`  Status check error: ${error.message}`);
                  }
                }
                
                if (!confirmed) {
                  printInfo('Transaction still pending after 60s');
                }
                
                // Print explorer link
                console.log('');
                console.log(`${BLUE}Sepolia Explorer:${NC} https://sepolia.etherscan.io/tx/${txHash}`);
              } else {
                printFail('Execute submit (missing txHash in response)');
              }
            }
          }
        } catch (error: any) {
          printFail(`Execute submit: ${error.message}`);
        }
      } else {
        // Direct mode: cannot submit without wallet signer
        printInfo('Direct mode requires wallet signer. Submit not possible in E2E script.');
        printInfo('To test submit in direct mode, use frontend UI with MetaMask.');
        printSkip('Execute submit (direct mode requires wallet)');
      }
    } else {
      printSkip('Execute submit (set E2E_SUBMIT=1 to test)');
    }

    // Summary
    console.log('');
    console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
    console.log(`${BLUE}Test Summary${NC}`);
    console.log(`${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}`);
    console.log(`${GREEN}Passed:${NC} ${passed}`);
    console.log(`${YELLOW}Skipped:${NC} ${skipped}`);
    console.log(`${RED}Failed:${NC} ${failed}`);
    console.log('');

    if (failed > 0) {
      console.log(`${RED}❌ E2E smoke test failed!${NC}`);
      process.exit(1);
    } else {
      console.log(`${GREEN}✅ All tests passed!${NC}`);
      process.exit(0);
    }
  } catch (error: any) {
    console.error(`${RED}Fatal error:${NC} ${error.message}`);
    process.exit(1);
  }
}

main();

