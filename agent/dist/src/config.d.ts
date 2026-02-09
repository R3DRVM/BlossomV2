/**
 * Backend Configuration
 * Centralized config for execution mode and ETH testnet settings
 *
 * V1/V1.1 Default: eth_testnet (testnet-only by default)
 * SIM mode: Internal dev-only, requires ALLOW_SIM_MODE=true
 */
import type { Address } from 'viem';
declare let EXECUTION_MODE: 'sim' | 'eth_testnet';
export { EXECUTION_MODE };
export declare const ETH_TESTNET_CHAIN_ID: number;
export declare const ETH_TESTNET_RPC_URL: string | undefined;
export declare const ETH_RPC_FALLBACK_URLS: string[];
export declare const EXECUTION_ROUTER_ADDRESS: string | undefined;
export declare const MOCK_SWAP_ADAPTER_ADDRESS: string | undefined;
export declare const UNISWAP_V3_ADAPTER_ADDRESS: string | undefined;
export declare const WETH_WRAP_ADAPTER_ADDRESS: string | undefined;
export declare const REDACTED_ADDRESS_SEPOLIA: string | undefined;
export declare const WETH_ADDRESS_SEPOLIA: string | undefined;
export declare const SOLANA_NETWORK: "devnet" | "mainnet-beta";
export declare const SOLANA_RPC_URL: string;
export declare const SOLANA_PROGRAM_ID: string | undefined;
export declare const SOLANA_BUSDC_MINT: string | undefined;
export declare const SOLANA_BUSDC_DECIMALS: number;
export declare const SOLANA_MINT_AUTHORITY_PRIVATE_KEY: string | undefined;
export declare const SOLANA_BUSDC_VAULT_ADDRESS: string | undefined;
export declare const DEMO_BUSDC_ADDRESS: string | undefined;
export declare const DEMO_REDACTED_ADDRESS: string | undefined;
export declare const DEMO_WETH_ADDRESS: string | undefined;
export declare const DEMO_SWAP_ROUTER_ADDRESS: string | undefined;
export declare const DEMO_LEND_VAULT_ADDRESS: string | undefined;
export declare const DEMO_LEND_ADAPTER_ADDRESS: string | undefined;
export declare const DEMO_PERP_ENGINE_ADDRESS: Address | undefined;
export declare const DEMO_PERP_ADAPTER_ADDRESS: Address | undefined;
export declare const DEMO_EVENT_ENGINE_ADDRESS: Address | undefined;
export declare const DEMO_EVENT_ADAPTER_ADDRESS: Address | undefined;
export declare const DEMO_PERP_COLLATERAL_ADDRESS: Address;
export declare const DEMO_EVENT_MARKET_ID: string;
export declare const PROOF_ADAPTER_ADDRESS: string | undefined;
export declare const DFLOW_ENABLED: boolean;
export declare const DFLOW_API_KEY: string | undefined;
export declare const DFLOW_BASE_URL: string | undefined;
export declare const DFLOW_QUOTE_API_URL: string;
export declare const DFLOW_PREDICTION_API_URL: string;
export declare const DFLOW_EVENTS_MARKETS_PATH: string | undefined;
export declare const DFLOW_EVENTS_QUOTE_PATH: string | undefined;
export declare const DFLOW_SWAPS_QUOTE_PATH: string | undefined;
export declare const DFLOW_REQUIRE: boolean;
export declare const LENDING_EXECUTION_MODE: 'demo' | 'real';
export declare const AAVE_POOL_ADDRESS: string | undefined;
export declare const LENDING_RATE_SOURCE: 'defillama' | 'aave' | 'none';
export declare const AAVE_SEPOLIA_POOL_ADDRESS: Address | undefined;
export declare const AAVE_ADAPTER_ADDRESS: Address | undefined;
export declare const AAVE_REDACTED_ADDRESS: string | undefined;
export declare const AAVE_WETH_ADDRESS: Address | undefined;
export declare const ERC20_PULL_ADAPTER_ADDRESS: string | undefined;
export declare const UNISWAP_ADAPTER_ADDRESS: string | undefined;
export declare const DEFAULT_SWAP_SLIPPAGE_BPS: number;
export declare const ONEINCH_API_KEY: string | undefined;
export declare const ONEINCH_BASE_URL: string;
export declare const ROUTING_MODE: 'hybrid' | 'deterministic' | 'dflow';
export declare const EXECUTION_SWAP_MODE: 'demo' | 'real';
export declare const UNISWAP_V3_ROUTER_ADDRESS: string;
export declare const ROUTING_REQUIRE_LIVE_QUOTE: boolean;
export declare const EXECUTION_AUTH_MODE: string;
export declare const RELAYER_PRIVATE_KEY: string | undefined;
export declare const V1_DEMO: boolean;
export declare const EXECUTION_DISABLED: boolean;
export declare const BLOSSOM_FEE_BPS: number;
export declare const AAVE_POOL_ADDRESS_SEPOLIA: string;
/**
 * Require ETH testnet configuration when in eth_testnet mode
 * Throws a clear error if required variables are missing
 */
export declare function requireEthTestnetConfig(): void;
/**
 * Require relayer configuration when in session mode
 * Throws a clear error if required variables are missing
 */
export declare function requireRelayerConfig(): void;
/**
 * Task 4: Validate contract configuration for eth_testnet
 * Checks chainId, router address, and adapter addresses
 * Throws clear errors if configuration is invalid
 */
export declare function validateEthTestnetConfig(): Promise<void>;
export declare const HYPERLIQUID_ENABLED: boolean;
export declare const HYPERLIQUID_TESTNET_RPC_URL: string;
export declare const HYPERLIQUID_TESTNET_CHAIN_ID: number;
export declare const HYPERLIQUID_EXCHANGE_URL: string;
export declare const HYPERLIQUID_INFO_URL: string;
export declare const HYPERLIQUID_BUILDER_ADDRESS: Address | undefined;
export declare const HYPERLIQUID_BUILDER_PRIVATE_KEY: string | undefined;
export declare const HYPERLIQUID_MOCK_HYPE_ADDRESS: Address | undefined;
export declare const HYPERLIQUID_BUSDC_ADDRESS: Address | undefined;
export declare const HYPERLIQUID_BUSDC_DECIMALS: number;
export declare const HYPERLIQUID_MINT_AUTHORITY_PRIVATE_KEY: string | undefined;
export declare const HYPERLIQUID_RATE_LIMIT_MARKET_CREATION: number;
export declare const HYPERLIQUID_RATE_LIMIT_POSITION: number;
export declare const HYPERLIQUID_RATE_LIMIT_QUOTE: number;
export declare const HYPERLIQUID_DEFAULT_MAX_LEVERAGE: number;
export declare const HYPERLIQUID_DEFAULT_MAKER_FEE_BPS: number;
export declare const HYPERLIQUID_DEFAULT_TAKER_FEE_BPS: number;
export declare const HYPERLIQUID_MIN_BOND_HYPE: bigint;
/**
 * Require Hyperliquid configuration when using HIP-3 features
 * Throws a clear error if required variables are missing
 */
export declare function requireHyperliquidConfig(): void;
/**
 * Validate Hyperliquid configuration
 * Checks builder address format and API connectivity
 */
export declare function validateHyperliquidConfig(): Promise<void>;
export declare const ERC8004_ENABLED: boolean;
export declare const ERC8004_IDENTITY_REGISTRY_SEPOLIA: Address | undefined;
export declare const ERC8004_REPUTATION_REGISTRY_SEPOLIA: Address | undefined;
export declare const ERC8004_VALIDATION_REGISTRY_SEPOLIA: Address | undefined;
export declare const ERC8004_AGENT_ID: bigint | undefined;
export declare const ERC8004_AGENT_URI: string;
export declare const ERC8004_AUTO_FEEDBACK: boolean;
export declare const ERC8004_FEEDBACK_MIN_USD: number;
export declare const ERC8004_REQUIRE_VALIDATION: boolean;
/**
 * Require ERC-8004 configuration when using ERC-8004 features
 * Throws a clear error if required variables are missing
 */
export declare function requireERC8004Config(): void;
/**
 * Validate ERC-8004 configuration
 * Checks address formats and configuration values
 */
export declare function validateERC8004Config(): Promise<void>;
//# sourceMappingURL=config.d.ts.map