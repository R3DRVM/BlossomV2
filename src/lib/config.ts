/**
 * Feature flags and configuration
 */

export const USE_AGENT_BACKEND =
  import.meta.env.VITE_USE_AGENT_BACKEND === 'true';

// V1/V1.1 Default: eth_testnet (testnet-only by default)
// SIM mode: Internal dev-only, requires VITE_ALLOW_SIM_MODE=true
const ALLOW_SIM_MODE = import.meta.env.VITE_ALLOW_SIM_MODE === 'true';
const requestedMode = import.meta.env.VITE_EXECUTION_MODE;

export const executionMode: string = 
  (requestedMode === 'sim' && ALLOW_SIM_MODE) 
    ? 'sim' 
    : (requestedMode || 'eth_testnet');

export const ethTestnetChainId = 11155111; // Sepolia

export const ethTestnetRpcUrl =
  import.meta.env.VITE_ETH_TESTNET_RPC_URL;

export const executionAuthMode: 'direct' | 'session' =
  (import.meta.env.VITE_EXECUTION_AUTH_MODE as 'direct' | 'session') || 'direct';

// Dev warning: Alert if session mode is needed but not configured
if (import.meta.env.DEV && executionMode === 'eth_testnet' && executionAuthMode === 'direct') {
  console.warn('[Config] ETH_TESTNET mode detected but VITE_EXECUTION_AUTH_MODE is not set to "session".');
  console.warn('[Config] One-click execution will not be available. Set VITE_EXECUTION_AUTH_MODE=session in .env.local');
}

export const ethTestnetIntent: 'mock' | 'swap_usdc_weth' | 'swap_weth_usdc' =
  (import.meta.env.VITE_ETH_TESTNET_INTENT as 'mock' | 'swap_usdc_weth' | 'swap_weth_usdc') || 'mock';

export const fundingRouteMode: 'manual' | 'atomic' =
  (import.meta.env.VITE_FUNDING_ROUTE_MODE as 'manual' | 'atomic') || 'manual';

export const forceDemoPortfolio: boolean =
  import.meta.env.VITE_FORCE_DEMO_PORTFOLIO === 'true';/**
 * Enable demo swap execution path (PULL + SWAP with demo tokens)
 * When true and execution mode is eth_testnet, executes via DemoSwapRouter
 */
export const enableDemoSwap: boolean =
  import.meta.env.VITE_ENABLE_DEMO_SWAP === 'true';