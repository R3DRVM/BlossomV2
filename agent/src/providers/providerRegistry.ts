/**
 * Provider Registry
 * Central selection logic for market data and quote providers
 */

import {
  MarketDataProvider,
  QuoteProvider,
  ProviderStatus,
} from './types';
import { DflowMarketDataProvider, DflowQuoteProvider } from './dflowProvider';
import { FallbackMarketDataProvider, FallbackQuoteProvider } from './fallbackProvider';
import {
  DFLOW_ENABLED,
  DFLOW_REQUIRE,
  ROUTING_MODE,
} from '../config';
import { isDflowCapabilityAvailable, getDflowCapabilities } from '../integrations/dflow/dflowClient';

// Singleton instances
let marketDataProvider: MarketDataProvider | null = null;
let quoteProvider: QuoteProvider | null = null;

/**
 * Get the market data provider based on configuration
 * @throws Error if DFLOW_REQUIRE=true and dFlow is unavailable
 */
export function getMarketDataProvider(): MarketDataProvider {
  if (marketDataProvider) {
    return marketDataProvider;
  }

  // Try dFlow first if enabled
  if (DFLOW_ENABLED) {
    const dflowProvider = new DflowMarketDataProvider();
    if (dflowProvider.isAvailable()) {
      marketDataProvider = dflowProvider;
      console.log('[ProviderRegistry] Using dFlow for market data');
      return marketDataProvider;
    }

    // dFlow enabled but not available
    if (DFLOW_REQUIRE) {
      throw new Error(
        'dFlow is required but events markets capability is not configured. ' +
        'Set DFLOW_EVENTS_MARKETS_PATH or disable DFLOW_REQUIRE.'
      );
    }

    console.warn('[ProviderRegistry] dFlow enabled but events markets unavailable, using fallback');
  }

  // Use fallback
  marketDataProvider = new FallbackMarketDataProvider();
  console.log('[ProviderRegistry] Using fallback for market data (Polymarket + Kalshi)');
  return marketDataProvider;
}

/**
 * Get the quote provider based on configuration
 * @throws Error if DFLOW_REQUIRE=true and dFlow is unavailable
 */
export function getQuoteProvider(): QuoteProvider {
  if (quoteProvider) {
    return quoteProvider;
  }

  // Check ROUTING_MODE first
  if (ROUTING_MODE === 'dflow' || DFLOW_ENABLED) {
    const dflowProvider = new DflowQuoteProvider();
    if (dflowProvider.isAvailable()) {
      quoteProvider = dflowProvider;
      console.log('[ProviderRegistry] Using dFlow for quotes');
      return quoteProvider;
    }

    // dFlow requested but not available
    if (ROUTING_MODE === 'dflow' && DFLOW_REQUIRE) {
      throw new Error(
        'dFlow routing is required but not configured. ' +
        'Set DFLOW_API_KEY and DFLOW_BASE_URL or change ROUTING_MODE.'
      );
    }

    console.warn('[ProviderRegistry] dFlow quotes unavailable, using fallback');
  }

  // Use fallback
  quoteProvider = new FallbackQuoteProvider();
  console.log('[ProviderRegistry] Using fallback for quotes (1inch + deterministic)');
  return quoteProvider;
}

/**
 * Get provider status for preflight
 */
export function getProviderStatus(): ProviderStatus {
  const dflowCaps = getDflowCapabilities();
  
  // Determine market data provider
  let marketDataProviderName = 'fallback';
  let marketDataAvailable = true;
  let marketDataFallback: string | undefined;

  if (DFLOW_ENABLED && dflowCaps.eventsMarkets) {
    marketDataProviderName = 'dflow';
  } else if (DFLOW_ENABLED) {
    marketDataFallback = 'Polymarket + Kalshi';
  }

  // Determine quote provider
  let quoteProviderName = 'fallback';
  let quoteAvailable = true;
  let quoteFallback: string | undefined;
  let swapsAvailable = true;
  let eventsAvailable = false;

  if (ROUTING_MODE === 'dflow' && dflowCaps.enabled) {
    quoteProviderName = 'dflow';
    swapsAvailable = dflowCaps.swapsQuotes;
    eventsAvailable = dflowCaps.eventsQuotes;
    if (!swapsAvailable) {
      quoteFallback = '1inch + deterministic';
    }
  } else if (ROUTING_MODE === 'hybrid') {
    quoteProviderName = '1inch';
    quoteFallback = 'deterministic';
  } else {
    quoteProviderName = 'deterministic';
  }

  return {
    marketData: {
      provider: marketDataProviderName,
      available: marketDataAvailable,
      fallback: marketDataFallback,
    },
    quotes: {
      provider: quoteProviderName,
      available: quoteAvailable,
      fallback: quoteFallback,
      capabilities: {
        swaps: swapsAvailable,
        events: eventsAvailable,
      },
    },
  };
}

/**
 * Reset provider cache (for testing)
 */
export function resetProviders(): void {
  marketDataProvider = null;
  quoteProvider = null;
}

/**
 * Check if dFlow is the active provider for a capability
 */
export function isDflowActiveFor(capability: 'marketData' | 'swapQuotes' | 'eventQuotes'): boolean {
  const status = getProviderStatus();
  
  switch (capability) {
    case 'marketData':
      return status.marketData.provider === 'dflow';
    case 'swapQuotes':
      return status.quotes.provider === 'dflow' && status.quotes.capabilities.swaps;
    case 'eventQuotes':
      return status.quotes.provider === 'dflow' && status.quotes.capabilities.events;
    default:
      return false;
  }
}


