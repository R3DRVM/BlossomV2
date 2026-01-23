/**
 * Fallback Provider Implementations
 * Wraps existing Polymarket/Kalshi and 1inch/deterministic functionality
 */

import {
  MarketDataProvider,
  QuoteProvider,
  NormalizedEventMarket,
  NormalizedSwapQuote,
} from './types';
import { fetchKalshiMarkets, fetchPolymarketMarkets, RawPredictionMarket } from '../services/predictionData';
import { getSwapRoutingDecision as get1inchRoutingDecision, RoutingDecision } from '../quotes/evmQuote';
import { DEFAULT_SWAP_SLIPPAGE_BPS, ROUTING_MODE } from '../config';

/**
 * Convert RawPredictionMarket to NormalizedEventMarket
 */
function normalizeMarket(market: RawPredictionMarket): NormalizedEventMarket {
  return {
    id: market.id,
    title: market.title,
    yesPrice: market.yesPrice,
    noPrice: market.noPrice,
    volume24hUsd: market.volume24hUsd,
    openInterestUsd: market.openInterestUsd,
    source: market.source.toLowerCase(),
    isLive: market.isLive || false,
  };
}

/**
 * Fallback Market Data Provider (Polymarket + Kalshi)
 */
export class FallbackMarketDataProvider implements MarketDataProvider {
  name = 'fallback';

  isAvailable(): boolean {
    return true; // Always available (has static fallback)
  }

  async getEventMarkets(): Promise<NormalizedEventMarket[]> {
    try {
      const [kalshiMarkets, polymarketMarkets] = await Promise.all([
        fetchKalshiMarkets(),
        fetchPolymarketMarkets(),
      ]);

      const normalized = [
        ...kalshiMarkets.map(normalizeMarket),
        ...polymarketMarkets.map(normalizeMarket),
      ];

      // Sort by volume/liquidity
      return normalized.sort((a, b) => {
        const aValue = a.volume24hUsd || a.openInterestUsd || 0;
        const bValue = b.volume24hUsd || b.openInterestUsd || 0;
        return bValue - aValue;
      });
    } catch (error: any) {
      console.warn('[FallbackMarketDataProvider] Error fetching markets:', error.message);
      return [];
    }
  }
}

/**
 * Fallback Quote Provider (1inch + deterministic)
 */
export class FallbackQuoteProvider implements QuoteProvider {
  name = 'fallback';

  isAvailable(): boolean {
    return true; // Always available (has deterministic fallback)
  }

  async getSwapQuote(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    slippageBps?: number;
    chainId?: number;
  }): Promise<NormalizedSwapQuote | null> {
    try {
      // Determine token symbols and decimals based on known addresses
      // For demo tokens, we know the symbols
      const tokenInSymbol = params.tokenIn.toLowerCase().includes('usdc') ? 'USDC' : 'WETH';
      const tokenOutSymbol = params.tokenOut.toLowerCase().includes('usdc') ? 'USDC' : 'WETH';
      const tokenInDecimals = tokenInSymbol === 'USDC' ? 6 : 18;
      const tokenOutDecimals = tokenOutSymbol === 'USDC' ? 6 : 18;
      
      // Use the existing routing decision function which handles 1inch and fallback
      const decision: RoutingDecision = await get1inchRoutingDecision({
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        tokenInSymbol,
        tokenOutSymbol,
        tokenInDecimals,
        tokenOutDecimals,
        amountIn: params.amountIn,
        slippageBps: params.slippageBps || DEFAULT_SWAP_SLIPPAGE_BPS,
      });

      return {
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn,
        amountOut: decision.expectedOut,
        minAmountOut: decision.minOut,
        slippageBps: decision.slippageBps,
        route: decision.route,
        routeSummary: decision.routeSummary,
        gas: decision.gas,
        source: decision.routingSource as 'dflow' | '1inch' | 'deterministic',
      };
    } catch (error: any) {
      console.warn('[FallbackQuoteProvider] Error getting quote:', error.message);
      return null;
    }
  }

  async getEventQuote(): Promise<null> {
    // Fallback doesn't support event quotes
    return null;
  }
}

