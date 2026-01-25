/**
 * Provider Registry
 * Central selection logic for market data and quote providers
 */
import { MarketDataProvider, QuoteProvider, ProviderStatus } from './types';
/**
 * Get the market data provider based on configuration
 * @throws Error if DFLOW_REQUIRE=true and dFlow is unavailable
 */
export declare function getMarketDataProvider(): MarketDataProvider;
/**
 * Get the quote provider based on configuration
 * @throws Error if DFLOW_REQUIRE=true and dFlow is unavailable
 */
export declare function getQuoteProvider(): QuoteProvider;
/**
 * Get provider status for preflight
 */
export declare function getProviderStatus(): ProviderStatus;
/**
 * Reset provider cache (for testing)
 */
export declare function resetProviders(): void;
/**
 * Check if dFlow is the active provider for a capability
 */
export declare function isDflowActiveFor(capability: 'marketData' | 'swapQuotes' | 'eventQuotes'): boolean;
//# sourceMappingURL=providerRegistry.d.ts.map