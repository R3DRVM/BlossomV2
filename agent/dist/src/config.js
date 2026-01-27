/**
 * Backend Configuration
 * Centralized config for execution mode and ETH testnet settings
 *
 * V1/V1.1 Default: eth_testnet (testnet-only by default)
 * SIM mode: Internal dev-only, requires ALLOW_SIM_MODE=true
 */
// Load environment variables FIRST (before reading process.env)
// This ensures .env.local is loaded before config values are evaluated
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const agentDir = resolve(__dirname, '..');
const rootDir = resolve(agentDir, '..');
// Load .env files with precedence (most specific first)
// Precedence: agent/.env.local → agent/.env → root/.env.local → root/.env
const envFiles = [
    resolve(agentDir, '.env.local'),
    resolve(agentDir, '.env'),
    resolve(rootDir, '.env.local'),
    resolve(rootDir, '.env'),
];
let loadedEnvFile = null;
for (const envFile of envFiles) {
    const result = config({ path: envFile });
    if (!result.error) {
        loadedEnvFile = envFile;
        break; // First successful load wins
    }
}
// Log which env file was loaded (or if none)
if (loadedEnvFile) {
    console.log(`📄 [config] Loaded environment from: ${loadedEnvFile}`);
}
else {
    console.log(`⚠️  [config] No .env file found (using system environment variables)`);
}
// Default to eth_testnet for V1/V1.1 (testnet-only by default)
const ALLOW_SIM_MODE = process.env.ALLOW_SIM_MODE === 'true';
const requestedMode = process.env.EXECUTION_MODE;
let EXECUTION_MODE;
if (requestedMode === 'sim') {
    if (ALLOW_SIM_MODE) {
        EXECUTION_MODE = 'sim';
    }
    else {
        // Auto-switch to eth_testnet if SIM requested but not allowed
        EXECUTION_MODE = 'eth_testnet';
        console.log('⚠️  EXECUTION_MODE=sim ignored (ALLOW_SIM_MODE not set). Using eth_testnet.');
    }
}
else {
    // Default to eth_testnet (V1/V1.1 behavior)
    EXECUTION_MODE = requestedMode || 'eth_testnet';
}
export { EXECUTION_MODE };
export const ETH_TESTNET_CHAIN_ID = parseInt(process.env.ETH_TESTNET_CHAIN_ID || '11155111', 10); // Sepolia default
export const ETH_TESTNET_RPC_URL = process.env.ETH_TESTNET_RPC_URL;
// RPC Failover Configuration
// Primary: ETH_TESTNET_RPC_URL (recommend Alchemy for reliability)
// Fallbacks: ETH_RPC_FALLBACK_URLS (comma-separated) OR individual vars
// Order: Primary -> ETH_RPC_FALLBACK_URLS -> ALCHEMY_RPC_URL -> INFURA_RPC_URL -> public RPC
const collectFallbackUrls = () => {
    const urls = [];
    // 1. Explicit fallback list (comma-separated)
    if (process.env.ETH_RPC_FALLBACK_URLS) {
        urls.push(...process.env.ETH_RPC_FALLBACK_URLS.split(',').map(u => u.trim()).filter(Boolean));
    }
    // 2. Individual provider URLs (if not already primary)
    const primary = process.env.ETH_TESTNET_RPC_URL || '';
    if (process.env.ALCHEMY_RPC_URL && !primary.includes('alchemy')) {
        urls.push(process.env.ALCHEMY_RPC_URL);
    }
    if (process.env.INFURA_RPC_URL && !primary.includes('infura')) {
        urls.push(process.env.INFURA_RPC_URL);
    }
    // 3. Public Sepolia RPCs as last resort (no API key required, multiple for redundancy)
    const publicRpcs = [
        'https://ethereum-sepolia-rpc.publicnode.com',
        'https://1rpc.io/sepolia',
        'https://rpc.sepolia.org',
    ];
    for (const rpc of publicRpcs) {
        try {
            if (!urls.some(u => u.includes(new URL(rpc).hostname))) {
                urls.push(rpc);
            }
        }
        catch { /* ignore invalid URLs */ }
    }
    // Dedupe and filter out primary
    return [...new Set(urls)].filter(u => u !== primary && u.length > 0);
};
export const ETH_RPC_FALLBACK_URLS = collectFallbackUrls();
export const EXECUTION_ROUTER_ADDRESS = process.env.EXECUTION_ROUTER_ADDRESS;
export const MOCK_SWAP_ADAPTER_ADDRESS = process.env.MOCK_SWAP_ADAPTER_ADDRESS;
export const UNISWAP_V3_ADAPTER_ADDRESS = process.env.UNISWAP_V3_ADAPTER_ADDRESS;
export const WETH_WRAP_ADAPTER_ADDRESS = process.env.WETH_WRAP_ADAPTER_ADDRESS;
export const REDACTED_ADDRESS_SEPOLIA = process.env.REDACTED_ADDRESS_SEPOLIA;
export const WETH_ADDRESS_SEPOLIA = process.env.WETH_ADDRESS_SEPOLIA;
// Demo swap venue (deterministic for investor demos)
// Default addresses for Sepolia (safe fallback)
const DEFAULT_DEMO_TOKENS = {
    sepolia: {
        usdc: '0x942eF9C37469a43077C6Fb5f23a258a6D88599cD',
        weth: '0x5FB58E6E0adB7002a6E0792BE3aBE084922c9939',
    }
};
// Use env vars if set, otherwise fallback to defaults for Sepolia
export const DEMO_REDACTED_ADDRESS = process.env.DEMO_REDACTED_ADDRESS ||
    (ETH_TESTNET_CHAIN_ID === 11155111 ? DEFAULT_DEMO_TOKENS.sepolia.usdc : undefined);
export const DEMO_WETH_ADDRESS = process.env.DEMO_WETH_ADDRESS ||
    (ETH_TESTNET_CHAIN_ID === 11155111 ? DEFAULT_DEMO_TOKENS.sepolia.weth : undefined);
export const DEMO_SWAP_ROUTER_ADDRESS = process.env.DEMO_SWAP_ROUTER_ADDRESS;
// Demo lending venue (deterministic for investor demos)
export const DEMO_LEND_VAULT_ADDRESS = process.env.DEMO_LEND_VAULT_ADDRESS;
export const DEMO_LEND_ADAPTER_ADDRESS = process.env.DEMO_LEND_ADAPTER_ADDRESS;
// Demo perps venue (real on-chain perps for testnet)
export const DEMO_PERP_ENGINE_ADDRESS = process.env.DEMO_PERP_ENGINE_ADDRESS;
export const DEMO_PERP_ADAPTER_ADDRESS = process.env.DEMO_PERP_ADAPTER_ADDRESS;
// Proof-of-execution adapter (for perps/events until real adapters exist)
export const PROOF_ADAPTER_ADDRESS = process.env.PROOF_ADAPTER_ADDRESS;
// dFlow Integration
export const DFLOW_ENABLED = process.env.DFLOW_ENABLED === 'true';
export const DFLOW_API_KEY = process.env.DFLOW_API_KEY;
// Legacy single URL (deprecated, kept for backwards compatibility)
export const DFLOW_BASE_URL = process.env.DFLOW_BASE_URL;
// dFlow has TWO separate API endpoints:
export const DFLOW_QUOTE_API_URL = process.env.DFLOW_QUOTE_API_URL || 'https://a.quote-api.dflow.net';
export const DFLOW_PREDICTION_API_URL = process.env.DFLOW_PREDICTION_API_URL || 'https://prediction-markets-api.dflow.net';
export const DFLOW_EVENTS_MARKETS_PATH = process.env.DFLOW_EVENTS_MARKETS_PATH;
export const DFLOW_EVENTS_QUOTE_PATH = process.env.DFLOW_EVENTS_QUOTE_PATH;
export const DFLOW_SWAPS_QUOTE_PATH = process.env.DFLOW_SWAPS_QUOTE_PATH;
export const DFLOW_REQUIRE = process.env.DFLOW_REQUIRE === 'true';
// Lending configuration
export const LENDING_EXECUTION_MODE = process.env.LENDING_EXECUTION_MODE || 'demo';
export const AAVE_POOL_ADDRESS = process.env.AAVE_POOL_ADDRESS; // Optional, for real mode later
export const LENDING_RATE_SOURCE = process.env.LENDING_RATE_SOURCE || 'defillama';
// Aave Sepolia integration (testnet V1)
export const AAVE_SEPOLIA_POOL_ADDRESS = process.env.AAVE_SEPOLIA_POOL_ADDRESS;
export const AAVE_ADAPTER_ADDRESS = process.env.AAVE_ADAPTER_ADDRESS;
export const AAVE_REDACTED_ADDRESS = process.env.AAVE_REDACTED_ADDRESS || DEMO_REDACTED_ADDRESS; // Use demo REDACTED if not set
export const AAVE_WETH_ADDRESS = process.env.AAVE_WETH_ADDRESS; // Aave-supported WETH on Sepolia
// Adapter addresses
export const ERC20_PULL_ADAPTER_ADDRESS = process.env.ERC20_PULL_ADAPTER_ADDRESS;
export const UNISWAP_ADAPTER_ADDRESS = process.env.UNISWAP_ADAPTER_ADDRESS || UNISWAP_V3_ADAPTER_ADDRESS;
// Swap configuration
export const DEFAULT_SWAP_SLIPPAGE_BPS = parseInt(process.env.DEFAULT_SWAP_SLIPPAGE_BPS || '50', 10); // 0.50% default
// 1inch Routing Configuration (hybrid model)
export const ONEINCH_API_KEY = process.env.ONEINCH_API_KEY;
export const ONEINCH_BASE_URL = process.env.ONEINCH_BASE_URL || 'https://api.1inch.dev';
// Routing mode: 'hybrid' uses 1inch for routing intelligence, 'dflow' uses dFlow, 'deterministic' uses fixed demo quotes
export const ROUTING_MODE = process.env.ROUTING_MODE || 'hybrid';
// Execution swap mode: 'demo' executes via DemoSwapRouter, 'real' uses Uniswap V3 on Sepolia
export const EXECUTION_SWAP_MODE = process.env.EXECUTION_SWAP_MODE || 'demo';
// Uniswap V3 SwapRouter02 address on Sepolia (for real swap execution)
export const UNISWAP_V3_ROUTER_ADDRESS = process.env.UNISWAP_V3_ROUTER_ADDRESS ||
    process.env.SEPOLIA_UNISWAP_V3_ROUTER ||
    '0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008'; // Official Uniswap V3 SwapRouter02 on Sepolia
// If true, fail when live quote fails. If false, gracefully fall back to deterministic quote.
export const ROUTING_REQUIRE_LIVE_QUOTE = process.env.ROUTING_REQUIRE_LIVE_QUOTE === 'true';
// V1: Default to session mode for eth_testnet (one-click execution)
// Can be overridden with EXECUTION_AUTH_MODE=direct for testing
export const EXECUTION_AUTH_MODE = process.env.EXECUTION_AUTH_MODE ||
    (EXECUTION_MODE === 'eth_testnet' ? 'session' : 'direct');
export const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY;
// V1 Demo Mode: Session-only execution, block direct mode
export const V1_DEMO = process.env.V1_DEMO === 'true';
// Emergency Kill Switch: Block all execution if enabled
export const EXECUTION_DISABLED = process.env.EXECUTION_DISABLED === 'true';
// Devnet Fee Configuration (25 bps = 0.25% default)
// Valid range: 10-50 bps (0.10% - 0.50%)
const rawFeeBps = parseInt(process.env.BLOSSOM_FEE_BPS || '25', 10);
export const BLOSSOM_FEE_BPS = Math.min(50, Math.max(10, isNaN(rawFeeBps) ? 25 : rawFeeBps));
// Aave V3 Pool on Sepolia (single config constant, validated at startup)
export const AAVE_POOL_ADDRESS_SEPOLIA = process.env.AAVE_POOL_ADDRESS_SEPOLIA ||
    '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951'; // Official Aave V3 Pool on Sepolia
/**
 * Require ETH testnet configuration when in eth_testnet mode
 * Throws a clear error if required variables are missing
 */
export function requireEthTestnetConfig() {
    if (EXECUTION_MODE !== 'eth_testnet') {
        return; // Not required in other modes
    }
    const missing = [];
    if (!EXECUTION_ROUTER_ADDRESS) {
        missing.push('EXECUTION_ROUTER_ADDRESS');
    }
    if (!MOCK_SWAP_ADAPTER_ADDRESS) {
        missing.push('MOCK_SWAP_ADAPTER_ADDRESS');
    }
    if (missing.length > 0) {
        throw new Error(`ETH testnet mode requires the following environment variables: ${missing.join(', ')}. ` +
            `Please set them in your .env file or environment.`);
    }
}
/**
 * Require relayer configuration when in session mode
 * Throws a clear error if required variables are missing
 */
export function requireRelayerConfig() {
    if (EXECUTION_MODE !== 'eth_testnet' || EXECUTION_AUTH_MODE !== 'session') {
        return; // Not required in other modes
    }
    const missing = [];
    if (!RELAYER_PRIVATE_KEY) {
        missing.push('RELAYER_PRIVATE_KEY');
    }
    if (!ETH_TESTNET_RPC_URL) {
        missing.push('ETH_TESTNET_RPC_URL');
    }
    if (missing.length > 0) {
        throw new Error(`Session mode requires the following environment variables: ${missing.join(', ')}. ` +
            `Please set them in your .env file or environment.`);
    }
}
/**
 * Task 4: Validate contract configuration for eth_testnet
 * Checks chainId, router address, and adapter addresses
 * Throws clear errors if configuration is invalid
 */
export async function validateEthTestnetConfig() {
    if (EXECUTION_MODE !== 'eth_testnet') {
        return; // Not required in other modes
    }
    const errors = [];
    // Validate chainId
    if (ETH_TESTNET_CHAIN_ID !== 11155111) {
        errors.push(`ETH_TESTNET_CHAIN_ID must be 11155111 (Sepolia), got ${ETH_TESTNET_CHAIN_ID}`);
    }
    // Validate router address format
    if (EXECUTION_ROUTER_ADDRESS) {
        if (!/^0x[a-fA-F0-9]{40}$/.test(EXECUTION_ROUTER_ADDRESS)) {
            errors.push(`EXECUTION_ROUTER_ADDRESS has invalid format: ${EXECUTION_ROUTER_ADDRESS}`);
        }
    }
    else {
        errors.push('EXECUTION_ROUTER_ADDRESS is required for eth_testnet mode');
    }
    // Validate adapter addresses format (if set)
    const adapterAddresses = [
        { name: 'MOCK_SWAP_ADAPTER_ADDRESS', value: MOCK_SWAP_ADAPTER_ADDRESS },
        { name: 'UNISWAP_V3_ADAPTER_ADDRESS', value: UNISWAP_V3_ADAPTER_ADDRESS },
        { name: 'WETH_WRAP_ADAPTER_ADDRESS', value: WETH_WRAP_ADAPTER_ADDRESS },
        { name: 'ERC20_PULL_ADAPTER_ADDRESS', value: ERC20_PULL_ADAPTER_ADDRESS },
        { name: 'PROOF_ADAPTER_ADDRESS', value: PROOF_ADAPTER_ADDRESS },
    ];
    for (const { name, value } of adapterAddresses) {
        if (value && !/^0x[a-fA-F0-9]{40}$/.test(value)) {
            errors.push(`${name} has invalid format: ${value}`);
        }
    }
    // Validate RPC URL is set and accessible
    if (!ETH_TESTNET_RPC_URL) {
        errors.push('ETH_TESTNET_RPC_URL is required for eth_testnet mode');
    }
    else if (ETH_TESTNET_RPC_URL && !ETH_TESTNET_RPC_URL.startsWith('http')) {
        errors.push(`ETH_TESTNET_RPC_URL must be a valid HTTP/HTTPS URL, got: ${ETH_TESTNET_RPC_URL.substring(0, 50)}...`);
    }
    // V1: Validate Aave Pool address (if using real Aave)
    if (AAVE_POOL_ADDRESS_SEPOLIA && !/^0x[a-fA-F0-9]{40}$/.test(AAVE_POOL_ADDRESS_SEPOLIA)) {
        errors.push(`AAVE_POOL_ADDRESS_SEPOLIA has invalid format: ${AAVE_POOL_ADDRESS_SEPOLIA}`);
    }
    if (errors.length > 0) {
        throw new Error(`ETH testnet configuration validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}\n` +
            `Please check your .env file and ensure all addresses are correct Sepolia contract addresses.`);
    }
}
//# sourceMappingURL=config.js.map